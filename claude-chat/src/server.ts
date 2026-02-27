import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { createNodeWebSocket } from "@hono/node-ws";
import { serve } from "@hono/node-server";
import type { WSContext } from "hono/ws";
import { exec, execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, stat, readFile } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
import { ClaudeBridge } from "./claude-bridge.js";

const execFileAsync = promisify(execFile);

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

const bridges = new Map<WSContext, ClaudeBridge>();

// ===== Session scanning — last 2 hours, with last message =====

interface ActiveSession {
  id: string;
  project: string;
  cwd: string;
  lastMessage: string;
  lastMessageRole: "user" | "assistant";
  lastActivity: string; // ISO timestamp
  messageCount: number;
}

const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

/** Decode a Claude project folder name back to a path */
function decodeProjectDir(name: string): string {
  if (/^[A-Z]-/.test(name)) {
    const parts = name.split("-");
    return parts[0] + ":\\" + parts.slice(1).join("\\");
  }
  return name.replace(/^-/, "/").replace(/-/g, "/");
}

/** Extract project name from a decoded path */
function projectName(decodedPath: string): string {
  const parts = decodedPath.split(/[/\\]/).filter(Boolean);
  return parts[parts.length - 1] || decodedPath;
}

/** Extract text content from a transcript message */
function extractText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .filter((c: any) => c.type === "text")
      .map((c: any) => c.text)
      .join("\n");
  }
  return "";
}

/** Strip system-reminder tags and clean whitespace */
function cleanText(text: string): string {
  return text
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Read last N lines from a file efficiently (read from end) */
async function readLastLines(filePath: string, maxLines: number): Promise<string[]> {
  const content = await readFile(filePath, "utf-8");
  const lines = content.trim().split("\n");
  return lines.slice(-maxLines);
}

/** Scan for sessions active in the last 2 hours with last message */
async function scanActiveSessions(): Promise<ActiveSession[]> {
  const sessions: ActiveSession[] = [];
  const claudeDir = join(homedir(), ".claude", "projects");
  const cutoff = Date.now() - TWO_HOURS_MS;

  let projects: string[];
  try {
    projects = await readdir(claudeDir);
  } catch {
    return [];
  }

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
        const fstat = await stat(filePath);

        // Skip files not modified in last 2 hours
        if (fstat.mtime.getTime() < cutoff) continue;

        // Read last 50 lines to find last meaningful message
        const lastLines = await readLastLines(filePath, 50);
        if (!lastLines.length) continue;

        // Parse first line for session metadata
        let sessionId = file.replace(".jsonl", "");
        const cwd = decodeProjectDir(project);

        try {
          const firstContent = await readFile(filePath, "utf-8");
          const firstLine = firstContent.split("\n")[0];
          if (firstLine) {
            const first = JSON.parse(firstLine);
            if (first.sessionId) sessionId = first.sessionId;
          }
        } catch { /* use filename as ID */ }

        // Walk backward through last lines to find last user and assistant messages
        let lastMessage = "";
        let lastMessageRole: "user" | "assistant" = "assistant";
        let lastTimestamp = fstat.mtime.toISOString();
        let messageCount = 0;

        for (let i = lastLines.length - 1; i >= 0; i--) {
          try {
            const entry = JSON.parse(lastLines[i]);

            if (entry.timestamp) lastTimestamp = entry.timestamp;

            if (entry.type === "user" || entry.type === "assistant") {
              messageCount++;
              if (!lastMessage && entry.message?.content) {
                const text = cleanText(extractText(entry.message.content));
                if (text) {
                  lastMessage = text;
                  lastMessageRole = entry.type;
                }
              }
            }
          } catch { /* skip unparseable lines */ }
        }

        // Count total messages (rough — scan all lines for type)
        try {
          const fullContent = await readFile(filePath, "utf-8");
          const allLines = fullContent.trim().split("\n");
          messageCount = 0;
          for (const line of allLines) {
            try {
              const e = JSON.parse(line);
              if (e.type === "user" || e.type === "assistant") messageCount++;
            } catch { /* skip */ }
          }
        } catch { /* use partial count */ }

        if (!lastMessage) lastMessage = "(no messages yet)";

        // Truncate preview
        if (lastMessage.length > 200) {
          lastMessage = lastMessage.slice(0, 200) + "...";
        }

        sessions.push({
          id: sessionId,
          project: projectName(cwd),
          cwd,
          lastMessage,
          lastMessageRole,
          lastActivity: lastTimestamp,
          messageCount,
        });
      } catch {
        // corrupt or unreadable, skip
      }
    }
  }

  // Sort newest first
  sessions.sort(
    (a, b) => new Date(b.lastActivity).getTime() - new Date(a.lastActivity).getTime()
  );

  // Dedupe by session ID
  const seen = new Set<string>();
  return sessions.filter((s) => {
    if (seen.has(s.id)) return false;
    seen.add(s.id);
    return true;
  });
}

// ===== API Routes =====

app.get("/api/sessions", async (c) => {
  try {
    const sessions = await scanActiveSessions();
    return c.json(sessions);
  } catch {
    return c.json([]);
  }
});

app.get("/api/info", (c) =>
  c.json({
    cwd: process.cwd(),
    home: homedir(),
    platform: process.platform,
  })
);

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

// Static files
app.use("/*", serveStatic({ root: "./public" }));

const PORT = parseInt(process.env.PORT || "3456");

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`\n  Claude Chat → http://localhost:${info.port}\n`);

  if (process.env.NO_OPEN !== "1") {
    const url = `http://localhost:${info.port}`;
    if (process.platform === "win32") {
      exec(`start "" "${url}"`);
    } else if (process.platform === "darwin") {
      exec(`open "${url}"`);
    } else {
      exec(`xdg-open "${url}"`);
    }
  }
});

injectWebSocket(server);
