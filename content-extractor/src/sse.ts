import type { Env } from './types';
import { handleMcp } from './mcp';

/**
 * SSE (Server-Sent Events) transport for MCP protocol.
 * Claude Desktop and Claude Code connect to remote MCP servers via SSE.
 *
 * Protocol:
 * 1. Client opens GET /sse — server sends `endpoint` event with POST URL
 * 2. Client sends JSON-RPC requests to the POST URL
 * 3. Server responds inline (not via SSE stream — Streamable HTTP pattern)
 *
 * This implements the "Streamable HTTP" MCP transport that Claude uses.
 */

export function handleSseEndpoint(baseUrl: string): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      // Send the endpoint event immediately
      const messageEndpoint = `${baseUrl}/mcp`;
      controller.enqueue(encoder.encode(`event: endpoint\ndata: ${messageEndpoint}\n\n`));

      // Keep connection alive with periodic pings
      const interval = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(': ping\n\n'));
        } catch {
          clearInterval(interval);
        }
      }, 30000);

      // Clean up after 5 minutes (Claude will reconnect)
      setTimeout(() => {
        clearInterval(interval);
        try {
          controller.close();
        } catch { /* already closed */ }
      }, 5 * 60 * 1000);
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'Access-Control-Allow-Origin': '*',
    },
  });
}
