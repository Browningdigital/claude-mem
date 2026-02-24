/**
 * Browning Cloud Node — Task Dispatcher Worker
 *
 * Cloudflare Worker that accepts tasks from iPhone (or any client),
 * queues them in Supabase, and the VPS task-watcher picks them up
 * to execute via Claude Code headless.
 *
 * Endpoints:
 *   POST /task          — Submit a new task
 *   GET  /task/:id      — Get task status + output
 *   GET  /tasks         — List recent tasks
 *   POST /task/:id/cancel — Cancel a running task
 *   GET  /health        — Health check
 *
 * Deploy: wrangler deploy
 * Secrets: wrangler secret put SUPABASE_URL, SUPABASE_KEY, TASK_AUTH_TOKEN
 */

interface Env {
  SUPABASE_URL: string;
  SUPABASE_KEY: string;       // service_role_key for full access
  TASK_AUTH_TOKEN: string;    // bearer token for auth (generate: openssl rand -hex 32)
}

interface Task {
  id?: string;
  prompt: string;
  repo?: string;              // optional git repo to clone/work in
  branch?: string;            // optional branch
  working_dir?: string;       // optional working directory
  priority?: 'low' | 'normal' | 'high' | 'critical';
  skip_permissions?: boolean; // use --dangerously-skip-permissions (default: false)
  continue_session?: boolean; // use --continue flag
  timeout_minutes?: number;   // max execution time (default: 30)
  status?: string;
  output?: string;
  error?: string;
  created_at?: string;
  started_at?: string;
  completed_at?: string;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS for iPhone Safari
    if (request.method === 'OPTIONS') {
      return new Response(null, {
        headers: corsHeaders(),
      });
    }

    // Auth check (skip health)
    if (path !== '/health') {
      const authHeader = request.headers.get('Authorization');
      if (!authHeader || authHeader !== `Bearer ${env.TASK_AUTH_TOKEN}`) {
        return json({ error: 'Unauthorized' }, 401);
      }
    }

    try {
      // POST /task — Submit new task
      if (request.method === 'POST' && path === '/task') {
        const body = await request.json() as Task;

        if (!body.prompt) {
          return json({ error: 'prompt is required' }, 400);
        }

        const task = {
          prompt: body.prompt,
          repo: body.repo || null,
          branch: body.branch || null,
          working_dir: body.working_dir || null,
          priority: body.priority || 'normal',
          skip_permissions: body.skip_permissions ?? false,
          continue_session: body.continue_session ?? false,
          timeout_minutes: body.timeout_minutes || 30,
          status: 'queued',
          output: null,
          error: null,
          created_at: new Date().toISOString(),
          started_at: null,
          completed_at: null,
        };

        const result = await supabaseInsert(env, 'cloud_node_tasks', task);
        return json({ success: true, task_id: result[0]?.id, task: result[0] }, 201);
      }

      // GET /task/:id — Get task status
      if (request.method === 'GET' && path.match(/^\/task\/[a-f0-9-]+$/)) {
        const taskId = path.split('/')[2];
        const result = await supabaseQuery(env, 'cloud_node_tasks', `id=eq.${taskId}`);
        if (!result.length) return json({ error: 'Task not found' }, 404);
        return json({ task: result[0] });
      }

      // GET /tasks — List recent tasks
      if (request.method === 'GET' && path === '/tasks') {
        const limit = url.searchParams.get('limit') || '20';
        const status = url.searchParams.get('status');
        let filter = `order=created_at.desc&limit=${limit}`;
        if (status) filter += `&status=eq.${status}`;
        const result = await supabaseQuery(env, 'cloud_node_tasks', filter);
        return json({ tasks: result, count: result.length });
      }

      // POST /task/:id/cancel — Cancel a task
      if (request.method === 'POST' && path.match(/^\/task\/[a-f0-9-]+\/cancel$/)) {
        const taskId = path.split('/')[2];
        const result = await supabaseUpdate(env, 'cloud_node_tasks', taskId, {
          status: 'cancelled',
          completed_at: new Date().toISOString(),
        });
        return json({ success: true, task: result[0] });
      }

      // GET /health
      if (path === '/health') {
        return json({ status: 'ok', service: 'browning-cloud-node-dispatcher', timestamp: new Date().toISOString() });
      }

      return json({ error: 'Not found' }, 404);

    } catch (err: any) {
      return json({ error: err.message || 'Internal error' }, 500);
    }
  },
};

// ── Supabase helpers ──

async function supabaseInsert(env: Env, table: string, data: any): Promise<any[]> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST',
    headers: supabaseHeaders(env),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Supabase insert failed: ${await res.text()}`);
  return res.json();
}

async function supabaseQuery(env: Env, table: string, filter: string): Promise<any[]> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    headers: supabaseHeaders(env),
  });
  if (!res.ok) throw new Error(`Supabase query failed: ${await res.text()}`);
  return res.json();
}

async function supabaseUpdate(env: Env, table: string, id: string, data: any): Promise<any[]> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH',
    headers: supabaseHeaders(env),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Supabase update failed: ${await res.text()}`);
  return res.json();
}

function supabaseHeaders(env: Env): Record<string, string> {
  return {
    'apikey': env.SUPABASE_KEY,
    'Authorization': `Bearer ${env.SUPABASE_KEY}`,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation',
  };
}

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  };
}

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: {
      'Content-Type': 'application/json',
      ...corsHeaders(),
    },
  });
}
