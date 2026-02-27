import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { createNodeWebSocket } from "@hono/node-ws";
import { serve } from "@hono/node-server";
import type { WSContext } from "hono/ws";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
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
          const content = await readFile(filePath, "utf-8");
          const firstLine = content.split("\n")[0];
          if (!firstLine) continue;

          const entry = JSON.parse(firstLine);
          const sessionId = entry.sessionId || file.replace(".jsonl", "");
          const cwd = entry.cwd || project.replace(/-/g, "/");
          const date = entry.timestamp || "";
          const label =
            entry.slug ||
            cwd.split("/").pop() ||
            sessionId.slice(0, 8);

          sessions.push({ id: sessionId, label, date, cwd });
        } catch {
          // corrupt file, skip
        }
      }
    }
  } catch {
    // ~/.claude/projects doesn't exist
  }

  // Sort newest first
  sessions.sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  );
  return sessions;
}

// ===== API Routes =====

// List sessions — try CLI first, fall back to filesystem scan
app.get("/api/sessions", async (c) => {
  // Method 1: CLI
  try {
    const { stdout } = await execFileAsync(
      "claude",
      ["sessions", "list", "--output-format", "json"],
      { env: { ...process.env, CLAUDECODE: "" } }
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
    // CLI failed, try filesystem
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

// Health check for auto-reconnect
app.get("/api/ping", (c) => c.json({ ok: true }));

// ===== WebSocket =====
app.get(
  "/ws",
  upgradeWebSocket(() => ({
    onOpen(_event, ws) {
      const bridge = new ClaudeBridge();
      bridges.set(ws, bridge);
      ws.send(JSON.stringify({ type: "connected" }));
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

  // Auto-open browser on Windows/macOS (unless suppressed)
  if (process.env.NO_OPEN !== "1") {
    const open =
      process.platform === "win32"
        ? "start"
        : process.platform === "darwin"
          ? "open"
          : "xdg-open";
    import("node:child_process").then(({ exec }) => {
      exec(`${open} http://localhost:${info.port}`);
    });
  }
});

injectWebSocket(server);
