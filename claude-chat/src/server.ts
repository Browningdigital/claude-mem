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

// Track active bridges per connection
const bridges = new Map<WSContext, ClaudeBridge>();

// Session listing API
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
    // Fallback: try parsing text output
    try {
      const { stdout } = await execFileAsync("claude", [
        "sessions",
        "list",
      ]);
      const lines = stdout.trim().split("\n").filter(Boolean);
      const sessions = lines.map((line) => {
        const parts = line.trim().split(/\s+/);
        return { id: parts[0], label: parts.slice(1).join(" ") };
      });
      return c.json(sessions);
    } catch {
      return c.json([]);
    }
  }
});

// Serve static frontend
app.use("/*", serveStatic({ root: "./public" }));

// WebSocket endpoint
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
            (event) => {
              try {
                ws.send(JSON.stringify(event));
              } catch {
                // ws closed
              }
            }
          );
        } catch (err: unknown) {
          const errMsg =
            err instanceof Error ? err.message : "Unknown error";
          ws.send(
            JSON.stringify({ type: "error", message: errMsg })
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

const PORT = parseInt(process.env.PORT || "3456");

const server = serve({ fetch: app.fetch, port: PORT }, (info) => {
  console.log(`claude-chat running → http://localhost:${info.port}`);
});

injectWebSocket(server);
