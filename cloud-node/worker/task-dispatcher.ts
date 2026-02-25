/**
 * Browning Cloud Node — Task Dispatcher Worker
 *
 * Cloudflare Worker that accepts tasks from iPhone (or any client),
 * queues them in Supabase, and the VPS task-watcher picks them up
 * to execute via Claude Code headless.
 *
 * Endpoints:
 *   GET  /              — Web dashboard (mobile-first UI)
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
  ALLOWED_ORIGIN?: string;   // restrict CORS origin (default: '*' — set to your domain in production)
}

// ── Input validation constants ──
const MAX_PROMPT_LENGTH = 50000;   // 50KB prompt limit
const MAX_TIMEOUT_MINUTES = 120;   // 2 hour max
const MAX_REPO_LENGTH = 500;
const MAX_BRANCH_LENGTH = 200;
const VALID_URL_PATTERN = /^https?:\/\//;

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

    // Auth check — skip for health and the web UI (UI authenticates via cookie/token in form)
    const isPublicRoute = path === '/health' || (path === '/' && request.method === 'GET');
    if (!isPublicRoute) {
      // Check bearer header OR cookie token (for form submissions from the dashboard)
      const authHeader = request.headers.get('Authorization');
      const cookieToken = getCookie(request, 'node_token');
      const validAuth = (authHeader && authHeader === `Bearer ${env.TASK_AUTH_TOKEN}`)
        || (cookieToken && cookieToken === env.TASK_AUTH_TOKEN);

      if (!validAuth) {
        // If it's a browser form POST without auth, redirect to login
        if (request.method === 'POST' && path === '/login') {
          return handleLogin(request, env);
        }
        if (request.headers.get('Accept')?.includes('text/html')) {
          return new Response(renderLoginPage(), {
            headers: { 'Content-Type': 'text/html' },
          });
        }
        return json({ error: 'Unauthorized' }, 401);
      }
    }

    try {
      // GET / — Web dashboard
      if (request.method === 'GET' && path === '/') {
        return new Response(renderLoginPage(), {
          headers: { 'Content-Type': 'text/html' },
        });
      }

      // GET /dashboard — Authenticated web dashboard
      if (request.method === 'GET' && path === '/dashboard') {
        const tasks = await supabaseQuery(env, 'cloud_node_tasks', 'order=created_at.desc&limit=20');
        return new Response(renderDashboard(tasks), {
          headers: { 'Content-Type': 'text/html' },
        });
      }

      // POST /task — Submit new task (API or form)
      if (request.method === 'POST' && path === '/task') {
        let body: Task;
        const contentType = request.headers.get('Content-Type') || '';

        if (contentType.includes('application/x-www-form-urlencoded')) {
          // Form submission from dashboard
          const formData = await request.formData();
          body = {
            prompt: formData.get('prompt') as string,
            repo: (formData.get('repo') as string) || undefined,
            branch: (formData.get('branch') as string) || undefined,
            priority: (formData.get('priority') as Task['priority']) || 'normal',
            timeout_minutes: parseInt(formData.get('timeout') as string) || 30,
            skip_permissions: formData.get('skip_permissions') === 'on',
          };
        } else {
          body = await request.json() as Task;
        }

        if (!body.prompt) {
          return json({ error: 'prompt is required' }, 400);
        }

        // ── Input validation ──
        if (body.prompt.length > MAX_PROMPT_LENGTH) {
          return json({ error: `prompt exceeds ${MAX_PROMPT_LENGTH} character limit` }, 400);
        }
        if (body.repo && (!VALID_URL_PATTERN.test(body.repo) || body.repo.length > MAX_REPO_LENGTH)) {
          return json({ error: 'repo must be a valid HTTP(S) URL' }, 400);
        }
        if (body.branch && (body.branch.length > MAX_BRANCH_LENGTH || /[;&|`$]/.test(body.branch))) {
          return json({ error: 'invalid branch name' }, 400);
        }
        const timeoutMin = Math.min(Math.max(body.timeout_minutes || 30, 1), MAX_TIMEOUT_MINUTES);

        const task = {
          prompt: body.prompt,
          repo: body.repo || null,
          branch: body.branch || null,
          working_dir: body.working_dir || null,
          priority: body.priority || 'normal',
          skip_permissions: body.skip_permissions ?? false,
          continue_session: body.continue_session ?? false,
          timeout_minutes: timeoutMin,
          status: 'queued',
          output: null,
          error: null,
          created_at: new Date().toISOString(),
          started_at: null,
          completed_at: null,
        };

        const result = await supabaseInsert(env, 'cloud_node_tasks', task);

        // If form submission, redirect to dashboard
        if (contentType.includes('application/x-www-form-urlencoded')) {
          return new Response(null, {
            status: 302,
            headers: { 'Location': '/dashboard' },
          });
        }
        return json({ success: true, task_id: result[0]?.id, task: result[0] }, 201);
      }

      // GET /task/:id — Get task status
      if (request.method === 'GET' && path.match(/^\/task\/[a-f0-9-]+$/)) {
        const taskId = path.split('/')[2];
        const result = await supabaseQuery(env, 'cloud_node_tasks', `id=eq.${taskId}`);
        if (!result.length) return json({ error: 'Task not found' }, 404);
        return json({ task: result[0] });
      }

      // GET /tasks — List recent tasks (with pagination)
      if (request.method === 'GET' && path === '/tasks') {
        const limit = Math.min(parseInt(url.searchParams.get('limit') || '20'), 100);
        const offset = parseInt(url.searchParams.get('offset') || '0');
        const status = url.searchParams.get('status');
        let filter = `order=created_at.desc&limit=${limit}&offset=${offset}`;
        if (status && /^[a-z]+$/.test(status)) filter += `&status=eq.${status}`;
        const result = await supabaseQuery(env, 'cloud_node_tasks', filter);
        return json({ tasks: result, count: result.length, offset, limit });
      }

      // POST /task/:id/cancel — Cancel a task
      if (request.method === 'POST' && path.match(/^\/task\/[a-f0-9-]+\/cancel$/)) {
        const taskId = path.split('/')[2];
        const result = await supabaseUpdate(env, 'cloud_node_tasks', taskId, {
          status: 'cancelled',
          completed_at: new Date().toISOString(),
        });

        // If browser request, redirect back to dashboard
        if (request.headers.get('Accept')?.includes('text/html')) {
          return new Response(null, {
            status: 302,
            headers: { 'Location': '/dashboard' },
          });
        }
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

function corsHeaders(env?: Env): Record<string, string> {
  const origin = env?.ALLOWED_ORIGIN || '*';
  return {
    'Access-Control-Allow-Origin': origin,
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

function getCookie(request: Request, name: string): string | null {
  const cookies = request.headers.get('Cookie') || '';
  const match = cookies.match(new RegExp(`${name}=([^;]+)`));
  return match ? match[1] : null;
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  const formData = await request.formData();
  const token = formData.get('token') as string;

  if (token === env.TASK_AUTH_TOKEN) {
    return new Response(null, {
      status: 302,
      headers: {
        'Location': '/dashboard',
        'Set-Cookie': `node_token=${token}; Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=604800`,
      },
    });
  }

  return new Response(renderLoginPage('Invalid token'), {
    status: 401,
    headers: { 'Content-Type': 'text/html' },
  });
}

// ── HTML Templates (mobile-first) ──

function renderLoginPage(error?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>Cloud Node</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro', system-ui, sans-serif;
    background: #0a0a0f;
    color: #e0e0e0;
    min-height: 100dvh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 20px;
  }
  .login-card {
    width: 100%;
    max-width: 380px;
    background: #141420;
    border: 1px solid #2a2a3a;
    border-radius: 16px;
    padding: 32px 24px;
  }
  h1 {
    font-size: 20px;
    font-weight: 600;
    color: #00d4ff;
    margin-bottom: 4px;
  }
  .subtitle { font-size: 13px; color: #666; margin-bottom: 24px; }
  label { font-size: 13px; color: #888; display: block; margin-bottom: 6px; }
  input[type="password"] {
    width: 100%;
    padding: 14px 16px;
    background: #0a0a0f;
    border: 1px solid #2a2a3a;
    border-radius: 10px;
    color: #fff;
    font-size: 16px;
    -webkit-appearance: none;
  }
  input:focus { outline: none; border-color: #00d4ff; }
  button {
    width: 100%;
    padding: 14px;
    background: #00d4ff;
    color: #000;
    border: none;
    border-radius: 10px;
    font-size: 16px;
    font-weight: 600;
    margin-top: 16px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  button:active { opacity: 0.8; }
  .error { color: #ff4444; font-size: 13px; margin-top: 12px; }
</style>
</head>
<body>
<div class="login-card">
  <h1>Cloud Node</h1>
  <p class="subtitle">Browning Digital</p>
  <form method="POST" action="/login">
    <label for="token">Access Token</label>
    <input type="password" id="token" name="token" placeholder="Paste your token" autocomplete="off" required>
    <button type="submit">Sign In</button>
    ${error ? `<p class="error">${error}</p>` : ''}
  </form>
</div>
</body>
</html>`;
}

function renderDashboard(tasks: any[]): string {
  const taskRows = tasks.map(t => {
    const status = t.status;
    const statusColor = {
      queued: '#ffa500',
      running: '#00d4ff',
      completed: '#00ff88',
      failed: '#ff4444',
      timeout: '#ff8800',
      cancelled: '#666',
    }[status] || '#666';

    const age = getRelativeTime(t.created_at);
    const prompt = (t.prompt || '').substring(0, 80) + ((t.prompt || '').length > 80 ? '...' : '');

    return `
      <div class="task" onclick="toggleTask(this)">
        <div class="task-header">
          <span class="status-dot" style="background:${statusColor}"></span>
          <span class="task-prompt">${escapeHtml(prompt)}</span>
          <span class="task-age">${age}</span>
        </div>
        <div class="task-detail" style="display:none">
          <div class="detail-row"><span class="detail-label">ID</span><span class="detail-value">${t.id}</span></div>
          <div class="detail-row"><span class="detail-label">Status</span><span class="detail-value" style="color:${statusColor}">${status}</span></div>
          <div class="detail-row"><span class="detail-label">Priority</span><span class="detail-value">${t.priority || 'normal'}</span></div>
          ${t.repo ? `<div class="detail-row"><span class="detail-label">Repo</span><span class="detail-value">${escapeHtml(t.repo)}</span></div>` : ''}
          ${t.started_at ? `<div class="detail-row"><span class="detail-label">Started</span><span class="detail-value">${new Date(t.started_at).toLocaleString()}</span></div>` : ''}
          ${t.completed_at ? `<div class="detail-row"><span class="detail-label">Completed</span><span class="detail-value">${new Date(t.completed_at).toLocaleString()}</span></div>` : ''}
          ${t.output ? `<div class="detail-output"><span class="detail-label">Output</span><pre>${escapeHtml(t.output.substring(0, 2000))}</pre></div>` : ''}
          ${t.error ? `<div class="detail-output"><span class="detail-label">Error</span><pre class="error-pre">${escapeHtml(t.error.substring(0, 1000))}</pre></div>` : ''}
          ${status === 'queued' || status === 'running' ? `<form method="POST" action="/task/${t.id}/cancel" class="cancel-form"><button type="submit" class="cancel-btn">Cancel</button></form>` : ''}
        </div>
      </div>`;
  }).join('');

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-status-bar-style" content="black-translucent">
<title>Cloud Node</title>
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, 'SF Pro', system-ui, sans-serif;
    background: #0a0a0f;
    color: #e0e0e0;
    min-height: 100dvh;
    padding: 0 0 100px 0;
  }
  .header {
    position: sticky;
    top: 0;
    background: #0a0a0f;
    border-bottom: 1px solid #1a1a2a;
    padding: 16px 20px;
    z-index: 10;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .header h1 { font-size: 18px; color: #00d4ff; font-weight: 600; }
  .refresh-btn {
    background: none;
    border: 1px solid #2a2a3a;
    color: #888;
    padding: 6px 12px;
    border-radius: 8px;
    font-size: 13px;
    cursor: pointer;
  }

  /* New task form */
  .new-task {
    padding: 16px 20px;
    border-bottom: 1px solid #1a1a2a;
  }
  textarea {
    width: 100%;
    min-height: 80px;
    padding: 14px 16px;
    background: #141420;
    border: 1px solid #2a2a3a;
    border-radius: 12px;
    color: #fff;
    font-size: 16px;
    font-family: inherit;
    resize: vertical;
    -webkit-appearance: none;
  }
  textarea:focus { outline: none; border-color: #00d4ff; }
  textarea::placeholder { color: #444; }

  .form-row {
    display: flex;
    gap: 8px;
    margin-top: 10px;
  }
  .form-row input, .form-row select {
    flex: 1;
    padding: 10px 12px;
    background: #141420;
    border: 1px solid #2a2a3a;
    border-radius: 10px;
    color: #fff;
    font-size: 14px;
    -webkit-appearance: none;
  }
  select { color: #888; }
  .form-row input:focus, .form-row select:focus { outline: none; border-color: #00d4ff; }

  .submit-btn {
    width: 100%;
    padding: 14px;
    background: #00d4ff;
    color: #000;
    border: none;
    border-radius: 10px;
    font-size: 16px;
    font-weight: 600;
    margin-top: 10px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .submit-btn:active { opacity: 0.8; }

  .toggle-row {
    display: flex;
    gap: 16px;
    margin-top: 10px;
    padding: 0 4px;
  }
  .toggle-row label {
    font-size: 13px;
    color: #888;
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .toggle-row input[type="checkbox"] { width: 18px; height: 18px; accent-color: #00d4ff; }

  /* Advanced toggle */
  .advanced-toggle {
    font-size: 13px;
    color: #555;
    margin-top: 10px;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .advanced-fields { display: none; }
  .advanced-fields.show { display: block; }

  /* Task list */
  .section-label {
    font-size: 12px;
    color: #555;
    text-transform: uppercase;
    letter-spacing: 1px;
    padding: 16px 20px 8px;
  }
  .task {
    padding: 14px 20px;
    border-bottom: 1px solid #111118;
    cursor: pointer;
    -webkit-tap-highlight-color: transparent;
  }
  .task:active { background: #141420; }
  .task-header {
    display: flex;
    align-items: center;
    gap: 10px;
  }
  .status-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    flex-shrink: 0;
  }
  .task-prompt {
    flex: 1;
    font-size: 14px;
    color: #ccc;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .task-age {
    font-size: 12px;
    color: #555;
    flex-shrink: 0;
  }

  .task-detail {
    margin-top: 12px;
    padding-top: 12px;
    border-top: 1px solid #1a1a2a;
  }
  .detail-row {
    display: flex;
    justify-content: space-between;
    padding: 4px 0;
  }
  .detail-label { font-size: 12px; color: #555; }
  .detail-value { font-size: 12px; color: #aaa; text-align: right; max-width: 60%; word-break: break-all; }
  .detail-output { margin-top: 8px; }
  .detail-output pre {
    margin-top: 4px;
    padding: 10px;
    background: #0a0a0f;
    border: 1px solid #1a1a2a;
    border-radius: 8px;
    font-size: 11px;
    color: #aaa;
    white-space: pre-wrap;
    word-break: break-word;
    max-height: 300px;
    overflow-y: auto;
    -webkit-overflow-scrolling: touch;
  }
  .error-pre { border-color: #331111; color: #ff6666; }
  .cancel-form { margin-top: 10px; }
  .cancel-btn {
    width: 100%;
    padding: 10px;
    background: transparent;
    border: 1px solid #ff4444;
    color: #ff4444;
    border-radius: 8px;
    font-size: 14px;
    cursor: pointer;
  }

  .empty {
    text-align: center;
    color: #444;
    padding: 40px 20px;
    font-size: 14px;
  }
</style>
</head>
<body>
<div class="header">
  <h1>Cloud Node</h1>
  <button class="refresh-btn" onclick="location.reload()">Refresh</button>
</div>

<div class="new-task">
  <form method="POST" action="/task">
    <textarea name="prompt" placeholder="What should Claude do?" required></textarea>
    <div class="advanced-toggle" onclick="document.getElementById('adv').classList.toggle('show')">
      Advanced options...
    </div>
    <div id="adv" class="advanced-fields">
      <div class="form-row">
        <input type="text" name="repo" placeholder="Repo URL (optional)">
        <input type="text" name="branch" placeholder="Branch">
      </div>
      <div class="form-row">
        <select name="priority">
          <option value="normal">Normal</option>
          <option value="high">High</option>
          <option value="critical">Critical</option>
          <option value="low">Low</option>
        </select>
        <input type="number" name="timeout" placeholder="Timeout (min)" value="30" min="1" max="120">
      </div>
      <div class="toggle-row">
        <label><input type="checkbox" name="skip_permissions"> Skip permissions</label>
      </div>
    </div>
    <button type="submit" class="submit-btn">Send to Node</button>
  </form>
</div>

<div class="section-label">Recent Tasks</div>
${tasks.length === 0 ? '<div class="empty">No tasks yet. Send one above.</div>' : taskRows}

<script>
function toggleTask(el) {
  const detail = el.querySelector('.task-detail');
  if (detail) detail.style.display = detail.style.display === 'none' ? 'block' : 'none';
}
// Auto-refresh every 10s if any tasks are running/queued
const hasActive = ${JSON.stringify(tasks.some(t => t.status === 'running' || t.status === 'queued'))};
if (hasActive) setTimeout(() => location.reload(), 10000);
</script>
</body>
</html>`;
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function getRelativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diffSec = Math.floor((now - then) / 1000);
  if (diffSec < 60) return 'now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)}m`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h`;
  return `${Math.floor(diffSec / 86400)}d`;
}
