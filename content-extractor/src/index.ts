import { Hono } from 'hono';
import { cors } from 'hono/cors';
import type { Env } from './types';
import { handleMcp } from './mcp';
import { extractContent } from './extract';

type HonoEnv = { Bindings: Env };

const app = new Hono<HonoEnv>();

app.use('*', cors());

// Health check
app.get('/api/status', (c) => {
  return c.json({ status: 'ok', service: 'content-extractor', version: '1.0.0' });
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

// MCP endpoint
app.all('/mcp', async (c) => {
  return handleMcp(c.req.raw, c.env);
});

export default app;
