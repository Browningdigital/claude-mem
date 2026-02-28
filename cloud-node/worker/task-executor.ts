/**
 * Browning Task Executor — The Missing Hands
 *
 * Polls cloud_node_tasks, calls Claude, writes results back.
 * This is what makes the CMO orchestrator actually ACT.
 *
 * Cron: Every 2 minutes
 * Deploy: wrangler deploy -c wrangler-executor.toml
 * Secrets: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_KEY, EXECUTOR_AUTH_TOKEN
 */

interface Env {
  ANTHROPIC_API_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  EXECUTOR_AUTH_TOKEN?: string;
}

interface CloudNodeTask {
  id: string;
  prompt: string;
  priority: string;
  status: string;
  task_type?: string;
  created_at: string;
}

// ── Supabase ───────────────────────────────────────────────────────
class DB {
  private url: string;
  constructor(url: string, private key: string) {
    this.url = url.replace(/\/$/, '');
  }
  private h(extra: Record<string, string> = {}) {
    return { apikey: this.key, Authorization: `Bearer ${this.key}`, 'Content-Type': 'application/json', Prefer: 'return=representation', ...extra };
  }
  async query<T = any>(table: string, params = ''): Promise<T[]> {
    const r = await fetch(`${this.url}/rest/v1/${table}${params ? '?' + params : ''}`, { headers: this.h() });
    if (!r.ok) throw new Error(`GET ${table}: ${r.status} ${await r.text()}`);
    return r.json();
  }
  async update(table: string, params: string, data: Record<string, any>): Promise<any> {
    const r = await fetch(`${this.url}/rest/v1/${table}?${params}`, { method: 'PATCH', headers: this.h(), body: JSON.stringify(data) });
    if (!r.ok) throw new Error(`PATCH ${table}: ${r.status} ${await r.text()}`);
    return r.json();
  }
  async insert(table: string, data: Record<string, any>): Promise<any> {
    const r = await fetch(`${this.url}/rest/v1/${table}`, { method: 'POST', headers: this.h(), body: JSON.stringify(data) });
    if (!r.ok) throw new Error(`POST ${table}: ${r.status} ${await r.text()}`);
    return r.json();
  }
}

// ── Claude Call (with prompt caching) ─────────────────────────────
const SYSTEM_PROMPT = `You are the autonomous CMO/COO operator for Browning Digital, run by Devin Browning.

BUSINESS:
- Products: zero-cost-ai-kit ($47), claude-code-money-machine ($19), faceless-playbook ($19), zero-cost-ai-agent ($29), advanced-automation-masterclass ($97/$47/$27)
- Store: shop.browningdigital.com
- Payment: PayPal + Coinbase Commerce (NO STRIPE EVER)
- Stack: Cloudflare Workers + Supabase + SvelteKit

MANDATE: Grow revenue through digital channels. Every output must be immediately executable. No placeholders, no hedging, no "you should consider."

SCOPE: Digital products, SEO, content, ads, email, CRO, landing pages, product launches.
OFF LIMITS: Credit repair, SENTINEL, bureau disputes — never touch these.

When generating content for content_queue, output a JSON array with objects: { platform, content, title?, product_id? }
Valid platforms: twitter, linkedin, reddit, email`;

async function callClaude(apiKey: string, prompt: string, taskType?: string): Promise<string> {
  const model = taskType === 'strategy' ? 'claude-opus-4-6' : 'claude-sonnet-4-6';

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
      'anthropic-beta': 'prompt-caching-2024-07-31',
    },
    body: JSON.stringify({
      model,
      max_tokens: 4096,
      system: [{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
      messages: [{ role: 'user', content: prompt }],
    }),
  });

  if (!res.ok) throw new Error(`Anthropic ${res.status}: ${await res.text()}`);
  const data = await res.json() as any;
  const cached = data.usage?.cache_read_input_tokens ?? 0;
  console.log(`[executor] ${model}: ${data.usage?.input_tokens}in (${cached} cached) / ${data.usage?.output_tokens}out`);
  return data.content?.[0]?.text ?? '';
}

// ── Parse Output ───────────────────────────────────────────────────
function extractJSONArray(raw: string): any[] | null {
  const clean = raw.replace(/^```[\w]*\n?/gm, '').replace(/^```$/gm, '').trim();
  try { const p = JSON.parse(clean); if (Array.isArray(p)) return p; } catch {}
  const m = clean.match(/\[[\s\S]+\]/);
  if (m) { try { const p = JSON.parse(m[0]); if (Array.isArray(p)) return p; } catch {} }
  return null;
}

async function writeResults(db: DB, raw: string, task: CloudNodeTask): Promise<void> {
  const taskType = task.task_type ?? 'content';

  if (taskType === 'content') {
    const rows = extractJSONArray(raw);
    if (rows && rows.length > 0) {
      let written = 0;
      for (const row of rows) {
        if (!row.content) continue;
        try {
          await db.insert('content_queue', {
            platform: row.platform ?? 'twitter',
            content: row.content,
            title: row.title ?? null,
            status: 'queued',
            source: 'cmo-executor',
            product_id: row.product_id ?? null,
            created_at: new Date().toISOString(),
          });
          written++;
        } catch (e) { console.error('[executor] content insert failed:', e); }
      }
      console.log(`[executor] Wrote ${written} content rows to content_queue`);
      return;
    }
    console.warn('[executor] Content task returned no JSON array — storing as report');
  }

  // Fallback: store as cmo_report
  await db.insert('cmo_reports', {
    report_date: new Date().toISOString().split('T')[0],
    report_type: taskType,
    content: raw.substring(0, 50000),
    source: 'task-executor',
    task_id: task.id,
    created_at: new Date().toISOString(),
  }).catch(e => console.warn('[executor] cmo_reports insert failed:', e));
}

// ── Claim + Execute ────────────────────────────────────────────────
async function claimAndRun(db: DB, task: CloudNodeTask, apiKey: string): Promise<void> {
  // CAS: only claim if still queued
  const claimed = await db.update('cloud_node_tasks',
    `id=eq.${task.id}&status=eq.queued`,
    { status: 'running', started_at: new Date().toISOString() }
  ).catch(() => []);

  if (!claimed || (Array.isArray(claimed) && claimed.length === 0)) {
    console.log(`[executor] Task ${task.id} already claimed`);
    return;
  }

  console.log(`[executor] Running ${task.id} (${task.task_type ?? 'content'} / ${task.priority})`);

  try {
    const response = await callClaude(apiKey, task.prompt, task.task_type);
    await writeResults(db, response, task);
    await db.update('cloud_node_tasks', `id=eq.${task.id}`, {
      status: 'completed',
      completed_at: new Date().toISOString(),
    });
    console.log(`[executor] Task ${task.id} completed`);
  } catch (err) {
    const msg = String(err).substring(0, 500);
    console.error(`[executor] Task ${task.id} failed:`, msg);
    await db.update('cloud_node_tasks', `id=eq.${task.id}`, {
      status: 'failed',
      failed_at: new Date().toISOString(),
      error: msg,
    }).catch(() => {});
  }
}

async function reclaimStale(db: DB): Promise<void> {
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
  const stale = await db.query<CloudNodeTask>('cloud_node_tasks',
    `status=eq.running&started_at=lt.${tenMinAgo}&select=id`
  ).catch(() => []);
  for (const t of stale) {
    await db.update('cloud_node_tasks', `id=eq.${t.id}&status=eq.running`, { status: 'queued', started_at: null }).catch(() => {});
    console.log(`[executor] Reclaimed stale task ${t.id}`);
  }
}

async function runCycle(env: Env): Promise<void> {
  const db = new DB(env.SUPABASE_URL, env.SUPABASE_KEY);
  await reclaimStale(db);

  const tasks = await db.query<CloudNodeTask>('cloud_node_tasks',
    'status=eq.queued&order=priority.desc,created_at.asc&limit=3&select=id,prompt,priority,status,task_type,created_at'
  ).catch(e => { console.error('[executor] query failed:', e); return [] as CloudNodeTask[]; });

  if (tasks.length === 0) { console.log('[executor] No queued tasks'); return; }
  console.log(`[executor] Processing ${tasks.length} task(s)`);

  for (const task of tasks) {
    await claimAndRun(db, task, env.ANTHROPIC_API_KEY);
  }
}

// ── Handlers ───────────────────────────────────────────────────────
export default {
  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runCycle(env));
  },

  async fetch(request: Request, env: Env, _ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    const auth = request.headers.get('Authorization')?.replace('Bearer ', '') ?? '';
    if (env.EXECUTOR_AUTH_TOKEN && auth !== env.EXECUTOR_AUTH_TOKEN) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
    }

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', ts: new Date().toISOString() }), { headers: { 'Content-Type': 'application/json' } });
    }

    if (url.pathname === '/run' && request.method === 'POST') {
      runCycle(env).catch(e => console.error('[executor] manual run error:', e));
      return new Response(JSON.stringify({ triggered: true, ts: new Date().toISOString() }), { headers: { 'Content-Type': 'application/json' } });
    }

    if (url.pathname === '/queue' && request.method === 'GET') {
      const db = new DB(env.SUPABASE_URL, env.SUPABASE_KEY);
      const tasks = await db.query('cloud_node_tasks',
        'status=in.(queued,running,failed)&order=created_at.desc&limit=20&select=id,task_type,priority,status,created_at,error'
      ).catch(() => []);
      return new Response(JSON.stringify(tasks), { headers: { 'Content-Type': 'application/json' } });
    }

    return new Response('not found', { status: 404 });
  },
};
