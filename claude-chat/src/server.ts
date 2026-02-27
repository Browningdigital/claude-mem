import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { createNodeWebSocket } from "@hono/node-ws";
import { serve } from "@hono/node-server";
import type { WSContext } from "hono/ws";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { ClaudeBridge } from "./claude-bridge.js";

const execFileAsync = promisify(execFile);

const app = new Hono();
const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });

const bridges = new Map<WSContext, ClaudeBridge>();

// ===== API Routes =====

// List sessions
app.get("/api/sessions", async (c) => {
  try {
    const { stdout } = await execFileAsync("claude", [
      "sessions",
      "list",
      "--output-format",
      "json",
    ]);
    const sessions = JSON.parse(stdout);
    return c.json(
      Array.isArray(sessions)
        ? sessions.map((s: Record<string, unknown>) => ({
            id: s.id || s.session_id,
            label: s.label || s.title || s.cwd || "",
            date: s.date || s.created_at || "",
          }))
        : []
    );
  } catch {
    try {
      const { stdout } = await execFileAsync("claude", [
        "sessions",
        "list",
      ]);
      const lines = stdout.trim().split("\n").filter(Boolean);
      return c.json(
        lines.map((line) => {
          const parts = line.trim().split(/\s+/);
          return { id: parts[0], label: parts.slice(1).join(" ") };
        })
      );
    } catch {
      return c.json([]);
    }
  }
});

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

  // Auto-open browser on Windows/macOS
  const open =
    process.platform === "win32"
      ? "start"
      : process.platform === "darwin"
        ? "open"
        : "xdg-open";
  if (process.env.NO_OPEN !== "1") {
    import("node:child_process").then(({ exec }) => {
      exec(`${open} http://localhost:${info.port}`);
    });
  }
});

injectWebSocket(server);
