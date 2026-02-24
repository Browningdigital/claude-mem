import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';
import { handleMcp } from './mcp';
import { handleSseEndpoint } from './sse';
import { extractContent } from './extract';
import { handleUpload, getUploadedContent } from './upload';
import { renderUploadPage } from './ui';
import { getSupabase } from './cache';

type HonoEnv = { Bindings: Env };

const app = new Hono<HonoEnv>();

app.use('*', cors());

// Health check
app.get('/api/status', (c) => {
  return c.json({ status: 'ok', service: 'content-extractor', version: '3.0.0' });
});

// REST API — extract from URL
app.get('/api/extract', async (c) => {
  const url = c.req.query('url');
  if (!url) return c.json({ error: 'Missing required parameter: url' }, 400);
  try { new URL(url); } catch { return c.json({ error: 'Invalid URL' }, 400); }
  try {
    const result = await extractContent(url, c.env);
    return c.json(result);
  } catch (e) {
    return c.json({ error: 'Extraction failed', reason: (e as Error).message }, 500);
  }
});

// Upload API — file upload
app.post('/api/upload', async (c) => {
  const baseUrl = new URL(c.req.url).origin;
  return handleUpload(c.req.raw, c.env, baseUrl);
});

// Upload API — store URL extraction as upload with short ID
app.post('/api/upload-url', async (c) => {
  const baseUrl = new URL(c.req.url).origin;
  const body = await c.req.json<{
    url: string;
    title: string | null;
    content: string | null;
    content_type: string;
    metadata: Record<string, unknown>;
  }>();

  if (!body.content) {
    return c.json({ error: 'No content to store' }, 400);
  }

  // Generate short ID
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let shortId = '';
  for (let i = 0; i < 8; i++) shortId += chars[Math.floor(Math.random() * chars.length)];

  const now = new Date().toISOString();
  const sb = getSupabase(c.env);

  await sb.from('uploads').upsert({
    id: shortId,
    title: body.title || body.url,
    content: body.content,
    content_type: body.content_type,
    metadata: { ...body.metadata, source_url: body.url },
    created_at: now,
    expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(),
  });

  // Save to Browning Memory
  let memorySaved = false;
  try {
    const contentForMemory = body.content.slice(0, 8000);
    await fetch('https://browningdigital.com/api/mcp', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0', id: Date.now(), method: 'tools/call',
        params: { name: 'remember', arguments: {
          topic: body.title || `Extracted: ${body.url}`,
          content: `**Source:** ${body.url}\n**Type:** ${body.content_type}\n**Upload ID:** ${shortId}\n**Link:** ${baseUrl}/c/${shortId}\n\n${contentForMemory}`,
          tags: ['upload', body.content_type, 'extracted', shortId],
          memory_type: 'reference', importance: 'normal',
        }},
      }),
    });
    memorySaved = true;
  } catch { /* memory save failed */ }

  return c.json({
    id: shortId,
    link: `${baseUrl}/c/${shortId}`,
    title: body.title || body.url,
    content_type: body.content_type,
    content_length: body.content.length,
    metadata: body.metadata,
    memory_saved: memorySaved,
    created_at: now,
  });
});

// Short link — retrieve uploaded/extracted content by ID
app.get('/c/:id', async (c) => {
  const id = c.req.param('id');
  const data = await getUploadedContent(id, c.env);

  if (!data) {
    return c.json({ error: 'Content not found or expired' }, 404);
  }

  // If request accepts JSON (API/Claude call), return JSON
  const accept = c.req.header('Accept') || '';
  if (accept.includes('application/json') || c.req.query('format') === 'json') {
    return c.json(data);
  }

  // For Claude sessions: return structured markdown as text
  if (accept.includes('text/plain') || c.req.query('format') === 'text') {
    const meta = data.metadata || {};
    const headerParts = [`# ${data.title}`, '', `**Type:** ${data.content_type}`];
    if (meta.source_url) headerParts.push(`**Source:** ${meta.source_url}`);
    if (meta.author) headerParts.push(`**Author:** ${meta.author}`);
    if (meta.handle) headerParts.push(`**Handle:** @${meta.handle}`);
    if (meta.subreddit) headerParts.push(`**Subreddit:** r/${meta.subreddit}`);
    if (meta.score != null) headerParts.push(`**Score:** ${meta.score}`);
    if (meta.num_comments != null) headerParts.push(`**Comments:** ${meta.num_comments}`);
    if (meta.likes != null) headerParts.push(`**Likes:** ${meta.likes}`);
    if (meta.retweets != null) headerParts.push(`**Retweets:** ${meta.retweets}`);
    if (meta.date || meta.created) headerParts.push(`**Date:** ${meta.date || meta.created}`);
    headerParts.push(`**Upload ID:** ${id}`);
    headerParts.push('', '---', '');
    return c.text(headerParts.join('\n') + data.content);
  }

  // For browsers: return structured HTML view with metadata
  const meta = data.metadata || {};
  const sourceUrl = (meta.source_url || '') as string;
  const metaParts = [escapeHtml(data.content_type)];
  if (meta.author) metaParts.push(`by ${escapeHtml(String(meta.author))}`);
  if (meta.handle) metaParts.push(`@${escapeHtml(String(meta.handle))}`);
  if (meta.subreddit) metaParts.push(`r/${escapeHtml(String(meta.subreddit))}`);
  metaParts.push(`${data.content.length.toLocaleString()} chars`);
  if (meta.extractor) metaParts.push(`via ${escapeHtml(String(meta.extractor))}`);
  metaParts.push(`ID: ${id}`);

  return c.html(`<!DOCTYPE html><html><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(data.title)}</title>
<style>body{font-family:system-ui;max-width:720px;margin:40px auto;padding:0 20px;background:#0d1117;color:#c9d1d9}
h1{color:#58a6ff;font-size:1.3rem;margin-bottom:4px}
.source{color:#7ee787;font-size:.8rem;margin-bottom:8px;word-break:break-all}
.source a{color:#7ee787;text-decoration:none}
.source a:hover{text-decoration:underline}
.meta{color:#8b949e;font-size:.8rem;margin-bottom:16px;display:flex;flex-wrap:wrap;gap:4px 12px}
.meta span{white-space:nowrap}
.stats{color:#8b949e;font-size:.8rem;margin-bottom:16px;display:flex;gap:16px;flex-wrap:wrap}
.stats span{white-space:nowrap}
pre{background:#161b22;padding:16px;border-radius:8px;overflow-x:auto;white-space:pre-wrap;word-break:break-word;font-size:.85rem;line-height:1.6}
.copy-btn{position:fixed;bottom:20px;right:20px;padding:12px 20px;background:#58a6ff;color:#fff;border:none;border-radius:8px;font-size:.9rem;font-weight:600;cursor:pointer;z-index:10}
.copy-btn:active{background:#4c9aed}</style></head>
<body>
<h1>${escapeHtml(data.title)}</h1>
${sourceUrl ? `<div class="source"><a href="${escapeHtml(sourceUrl)}" target="_blank">${escapeHtml(sourceUrl)}</a></div>` : ''}
<div class="meta">${metaParts.map((p) => `<span>${p}</span>`).join('')}</div>
${renderStats(meta)}
<pre>${escapeHtml(data.content)}</pre>
<button class="copy-btn" onclick="navigator.clipboard.writeText(document.querySelector('pre').textContent);this.textContent='Copied!';setTimeout(()=>this.textContent='Copy All',2000)">Copy All</button>
</body></html>`);
});

// MCP endpoint
app.all('/mcp', async (c) => {
  return handleMcp(c.req.raw, c.env);
});

// SSE endpoint for Claude Desktop / Claude Code
app.get('/sse', (c) => {
  const baseUrl = new URL(c.req.url).origin;
  return handleSseEndpoint(baseUrl);
});

// Upload UI (the drop zone)
app.get('/upload', (c) => {
  const baseUrl = new URL(c.req.url).origin;
  return c.html(renderUploadPage(baseUrl));
});

// Landing page
app.get('/', (c) => {
  return c.redirect('/upload');
});

export default app;

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/** Render engagement stats (likes, retweets, score, etc.) if present in metadata */
function renderStats(meta: Record<string, unknown>): string {
  const parts: string[] = [];
  if (meta.score != null) parts.push(`${meta.score} pts`);
  if (meta.upvote_ratio != null) parts.push(`${Math.round(Number(meta.upvote_ratio) * 100)}% upvoted`);
  if (meta.likes != null) parts.push(`${meta.likes} likes`);
  if (meta.retweets != null) parts.push(`${meta.retweets} retweets`);
  if (meta.replies != null) parts.push(`${meta.replies} replies`);
  if (meta.num_comments != null) parts.push(`${meta.num_comments} comments`);
  if (meta.mediaCount != null && Number(meta.mediaCount) > 0) parts.push(`${meta.mediaCount} media`);
  if (meta.date) parts.push(String(meta.date));
  if (meta.created) parts.push(new Date(String(meta.created)).toLocaleDateString());
  if (parts.length === 0) return '';
  return `<div class="stats">${parts.map((p) => `<span>${escapeHtml(p)}</span>`).join('')}</div>`;
}
