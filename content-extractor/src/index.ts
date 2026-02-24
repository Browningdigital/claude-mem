import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';
import { handleMcp } from './mcp';
import { handleSseEndpoint } from './sse';
import { extractContent } from './extract';

type HonoEnv = { Bindings: Env };

const app = new Hono<HonoEnv>();

app.use('*', cors());

// Health check
app.get('/api/status', (c) => {
  return c.json({ status: 'ok', service: 'content-extractor', version: '2.0.0' });
});

// REST API
app.get('/api/extract', async (c) => {
  const url = c.req.query('url');
  if (!url) {
    return c.json({ error: 'Missing required parameter: url' }, 400);
  }

  try {
    new URL(url);
  } catch {
    return c.json({ error: 'Invalid URL' }, 400);
  }

  try {
    const result = await extractContent(url, c.env);
    return c.json(result);
  } catch (e) {
    return c.json({ error: 'Extraction failed', reason: (e as Error).message }, 500);
  }
});

// MCP endpoint (JSON-RPC over HTTP POST, info via GET)
app.all('/mcp', async (c) => {
  return handleMcp(c.req.raw, c.env);
});

// SSE endpoint for Claude Desktop / Claude Code MCP remote server protocol
app.get('/sse', (c) => {
  const baseUrl = new URL(c.req.url).origin;
  return handleSseEndpoint(baseUrl);
});

// Landing page with setup instructions
app.get('/', (c) => {
  return c.html(`<!DOCTYPE html>
<html>
<head><title>Content Extractor MCP</title>
<style>body{font-family:system-ui;max-width:720px;margin:40px auto;padding:0 20px;background:#0d1117;color:#c9d1d9}
h1{color:#58a6ff}a{color:#58a6ff}code{background:#161b22;padding:2px 6px;border-radius:4px;font-size:14px}
pre{background:#161b22;padding:16px;border-radius:8px;overflow-x:auto}
.status{display:inline-block;width:8px;height:8px;border-radius:50%;background:#3fb950;margin-right:6px}</style>
</head>
<body>
<h1><span class="status"></span> Content Extractor MCP v2.0</h1>
<p>Universal link-to-content extraction. Drop any URL, get clean Markdown.</p>

<h2>Tools</h2>
<ul>
<li><b>extract_content</b> — Extract text from any URL</li>
<li><b>extract_and_remember</b> — Extract + save to Browning Memory</li>
<li><b>batch_extract</b> — Extract multiple URLs at once</li>
</ul>

<h2>Supported Content Types</h2>
<p>Webpages, PDFs, YouTube (transcripts), Twitter/X, Threads, Instagram, LinkedIn, TikTok, Loom, Images (AI vision), Audio/Video (Whisper transcription)</p>

<h2>Connect to Claude Desktop</h2>
<p>Add to your <code>claude_desktop_config.json</code>:</p>
<pre><code>{
  "mcpServers": {
    "content-extractor": {
      "url": "${new URL(c.req.url).origin}/sse"
    }
  }
}</code></pre>

<h2>API</h2>
<ul>
<li><code>GET /api/extract?url=...</code> — REST API</li>
<li><code>POST /mcp</code> — MCP JSON-RPC</li>
<li><code>GET /sse</code> — SSE transport for Claude Desktop</li>
<li><code>GET /api/status</code> — Health check</li>
</ul>
</body></html>`);
});

export default app;
