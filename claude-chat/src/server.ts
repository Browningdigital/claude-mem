import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { createNodeWebSocket } from "@hono/node-ws";
import { serve } from "@hono/node-server";
import type { WSContext } from "hono/ws";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, open, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { createReadStream } from "node:fs";
import { ClaudeBridge } from "./claude-bridge.js";

const execFileAsync = promisify(execFile);

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

const bridges = new Map<WSContext, ClaudeBridge>();

// ===== Session scanning =====

interface SessionInfo {
  id: string;
  label: string;
  date: string;
  cwd: string;
}

/** Read just the first line of a file (efficient — doesn't load the whole thing) */
async function readFirstLine(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    const stream = createReadStream(filePath, { encoding: "utf-8", highWaterMark: 2048 });
    stream.on("data", (chunk: string) => {
      data += chunk;
      const nl = data.indexOf("\n");
      if (nl !== -1) {
        stream.destroy();
        resolve(data.slice(0, nl));
      }
    });
    stream.on("end", () => resolve(data));
    stream.on("error", reject);
  });
}

/** Decode a Claude project folder name back to a path */
function decodeProjectDir(name: string): string {
  // Claude encodes paths like: -home-user-project -> /home/user/project
  // On Windows: C-Users-ssoif-project -> C:\Users\ssoif\project
  if (/^[A-Z]-/.test(name)) {
    // Windows: starts with drive letter
    const parts = name.split("-");
    return parts[0] + ":\\" + parts.slice(1).join("\\");
  }
  // Unix: leading dash = /
  return name.replace(/^-/, "/").replace(/-/g, "/");
}

async function scanSessionFiles(): Promise<SessionInfo[]> {
  const sessions: SessionInfo[] = [];
  const claudeDir = join(homedir(), ".claude", "projects");

  try {
    const projects = await readdir(claudeDir);
    for (const project of projects) {
      const projectDir = join(claudeDir, project);
      let files: string[];
      try {
        files = await readdir(projectDir);
      } catch {
        continue;
      }

      const jsonlFiles = files.filter((f) => f.endsWith(".jsonl"));

      for (const file of jsonlFiles) {
        try {
          const filePath = join(projectDir, file);
          // Get file mtime for sorting (fast, no content read)
          const fstat = await stat(filePath);
          // Read only first line
          const firstLine = await readFirstLine(filePath);
          if (!firstLine) continue;

          const entry = JSON.parse(firstLine);
          const sessionId = entry.sessionId || file.replace(".jsonl", "");
          const cwd = entry.cwd || decodeProjectDir(project);
          const date = entry.timestamp || fstat.mtime.toISOString();
          const slug = entry.slug || "";
          const cwdShort = cwd.split(/[/\\]/).pop() || cwd;
          const label = slug || cwdShort;

          sessions.push({ id: sessionId, label, date, cwd });
        } catch {
          // corrupt or unreadable, skip
        }
      }
    }
  } catch {
    // ~/.claude/projects doesn't exist
  }

  // Sort newest first by date
  sessions.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );

  // Dedupe by session ID (keep newest)
  const seen = new Set<string>();
  return sessions.filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
}

// ===== API Routes =====

// List sessions — try CLI first, fall back to filesystem scan
app.get("/api/sessions", async (c) => {
  // Method 1: CLI (with timeout so it doesn't hang)
  try {
    const { stdout } = await execFileAsync(
      "claude",
      ["sessions", "list", "--output-format", "json"],
      {
        env: { ...process.env, CLAUDECODE: "" },
        timeout: 5000,
      }
    );
    const parsed = JSON.parse(stdout);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return c.json(
        parsed.map((s: Record<string, unknown>) => ({
          id: s.id || s.session_id,
          label: s.label || s.title || s.cwd || "",
          date: s.date || s.created_at || "",
          cwd: s.cwd || "",
        }))
      );
    }
  } catch {
    // CLI failed or timed out, try filesystem
  }

  // Method 2: Filesystem scan
  try {
    const sessions = await scanSessionFiles();
    if (sessions.length) return c.json(sessions);
  } catch {
    // scan failed
  }

  return c.json([]);
});

// Server info — cwd and homedir for the UI
app.get("/api/info", (c) =>
  c.json({
    cwd: process.cwd(),
    home: homedir(),
    platform: process.platform,
  })
);

// Health check — also verifies claude CLI is reachable
app.get("/api/ping", async (c) => {
  let claudeOk = false;
  let claudeVersion = "";
  let claudeError = "";
  try {
    const { stdout } = await execFileAsync("claude", ["--version"], { timeout: 5000 });
    claudeOk = true;
    claudeVersion = stdout.trim();
  } catch (err: unknown) {
    claudeError = err instanceof Error ? err.message : "claude CLI not found";
    if (claudeError.includes("ENOENT")) {
      claudeError = "Claude Code CLI is not installed. Run: npm install -g @anthropic-ai/claude-code";
    }
  }
  return c.json({ ok: true, claude: claudeOk, claudeVersion, claudeError });
});

// ===== WebSocket =====
app.get(
  "/ws",
  upgradeWebSocket(() => ({
    onOpen(_event, ws) {
      const bridge = new ClaudeBridge();
      bridges.set(ws, bridge);
      ws.send(
        JSON.stringify({
          type: "connected",
          cwd: process.cwd(),
          home: homedir(),
          platform: process.platform,
        })
      );
    },

    async onMessage(event, ws) {
      const bridge = bridges.get(ws);
      if (!bridge) return;

      let msg: {
        type: string;
        content?: string;
        images?: { data: string; mime: string }[];
        workingDir?: string;
        sessionId?: string;
      };

      try {
        msg = JSON.parse(
          typeof event.data === "string" ? event.data : event.data.toString()
        );
      } catch {
        ws.send(JSON.stringify({ type: "error", message: "Invalid JSON" }));
        return;
      }

      if (msg.type === "setSession") {
        bridge.setSessionId(msg.sessionId ?? null);
        ws.send(
          JSON.stringify({
            type: "session_set",
            session_id: msg.sessionId,
          })
        );
      } else if (msg.type === "message") {
        const content = msg.content?.trim();
        if (!content) return;

        ws.send(JSON.stringify({ type: "thinking" }));

        try {
          await bridge.send(
            {
              message: content,
              images: msg.images,
              sessionId:
                msg.sessionId || (bridge.currentSessionId ?? undefined),
              workingDir: msg.workingDir,
            },
            (ev) => {
              try {
                ws.send(JSON.stringify(ev));
              } catch {
                // ws closed
              }
            }
          );
        } catch (err: unknown) {
          ws.send(
            JSON.stringify({
              type: "error",
              message: err instanceof Error ? err.message : "Unknown error",
            })
          );
        }
      } else if (msg.type === "abort") {
        bridge.abort();
      }
    },

    onClose(_event, ws) {
      const bridge = bridges.get(ws);
      if (bridge) {
        bridge.abort();
        bridge.cleanup();
        bridges.delete(ws);
      }
    },
  }))
);

// Static files — AFTER api routes so they don't shadow
app.use("/*", serveStatic({ root: "./public" }));

const PORT = parseInt(process.env.PORT || "3456");

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`\n  Claude Chat → http://localhost:${info.port}\n`);

  if (process.env.NO_OPEN !== "1") {
    const url = `http://localhost:${info.port}`;
    import("node:child_process").then(({ exec }) => {
      if (process.platform === "win32") {
        // "start" on Windows needs empty title arg, then the URL
        exec(`start "" "${url}"`);
      } else if (process.platform === "darwin") {
        exec(`open "${url}"`);
      } else {
        exec(`xdg-open "${url}"`);
      }
    });
  }
});

injectWebSocket(server);
