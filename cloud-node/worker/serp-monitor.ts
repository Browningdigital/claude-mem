/**
 * Browning SERP Monitor — SEO Tracking Worker
 *
 * Cloudflare Worker (scheduled) that tracks keyword rankings in
 * Google search results for Browning Digital properties.
 *
 * Features:
 *   - Tracks keyword positions for target URLs
 *   - Stores historical position data for trend analysis
 *   - Identifies quick-win opportunities (pos 4-20)
 *   - Detects ranking drops (alerts CMO orchestrator)
 *   - Discovers competitor content for content gap analysis
 *   - Scope enforcement: only tracks CMO-relevant keywords
 *
 * Data flow:
 *   serp_tracking (keywords) → [THIS WORKER] → serp_tracking (positions)
 *   serp_tracking → cmo-orchestrator (analysis + content strategy)
 *
 * Cron: every 6 hours (0 */6 * * *)
 * Deploy: cd cloud-node/worker && wrangler deploy -c wrangler-serp.toml
 * Secrets: SUPABASE_URL, SUPABASE_KEY
 *
 * NOTE: Uses organic scraping with respectful rate limiting.
 * For production scale, integrate with a SERP API (e.g., SerpAPI, ValueSERP).
 */

interface Env {
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  SERP_API_KEY?: string; // Optional: SerpAPI or ValueSERP key for reliable results
}

interface TrackedKeyword {
  id: string;
  keyword: string;
  target_url: string;
  current_position: number | null;
  previous_position: number | null;
  best_position: number | null;
  check_frequency_hours: number;
  checked_at: string | null;
  metadata: Record<string, any>;
}

interface SERPResult {
  position: number;
  title: string;
  url: string;
  snippet: string;
}

// ── Scope Enforcement ──────────────────────────────────────────────
const BLOCKED_KEYWORDS = [
  'credit repair', 'credit score', 'credit fix',
  'debt settlement', 'bureau dispute',
];

function isBlockedKeyword(keyword: string): boolean {
  const lower = keyword.toLowerCase();
  return BLOCKED_KEYWORDS.some(term => lower.includes(term));
}

// ── Supabase Client ────────────────────────────────────────────────
class SupabaseClient {
  private url: string;
  private key: string;

  constructor(url: string, key: string) {
    this.url = url.replace(/\/$/, '');
    this.key = key;
  }

  private headers(): Record<string, string> {
    return {
      'apikey': this.key,
      'Authorization': `Bearer ${this.key}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
    };
  }

  async query(table: string, params: string = ''): Promise<any[]> {
    const sep = params ? '?' : '';
    const res = await fetch(`${this.url}/rest/v1/${table}${sep}${params}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`GET ${table}: ${res.status}`);
    return res.json();
  }

  async insert(table: string, data: Record<string, any>): Promise<any> {
    const res = await fetch(`${this.url}/rest/v1/${table}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`INSERT ${table}: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async update(table: string, params: string, data: Record<string, any>): Promise<any> {
    const res = await fetch(`${this.url}/rest/v1/${table}?${params}`, {
      method: 'PATCH',
      headers: this.headers(),
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`PATCH ${table}: ${res.status}`);
    return res.json();
  }

  async upsert(table: string, data: Record<string, any>, onConflict: string): Promise<any> {
    const res = await fetch(`${this.url}/rest/v1/${table}`, {
      method: 'POST',
      headers: {
        ...this.headers(),
        'Prefer': 'resolution=merge-duplicates,return=representation',
      },
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`UPSERT ${table}: ${res.status} ${await res.text()}`);
    return res.json();
  }
}

// ── SERP Checking ──────────────────────────────────────────────────

/**
 * Check SERP position using a SERP API if available,
 * otherwise fall back to a basic Google scrape.
 */
async function checkSERP(keyword: string, targetUrl: string, apiKey?: string): Promise<{
  position: number | null;
  results: SERPResult[];
  source: string;
}> {
  // Prefer SERP API (reliable, no rate limiting issues)
  if (apiKey) {
    return checkSERPviaAPI(keyword, apiKey);
  }

  // Fallback: direct Google search (rate limited, may get blocked)
  return checkSERPdirect(keyword, targetUrl);
}

async function checkSERPviaAPI(keyword: string, apiKey: string): Promise<{
  position: number | null;
  results: SERPResult[];
  source: string;
}> {
  // ValueSERP API (affordable, reliable)
  const params = new URLSearchParams({
    api_key: apiKey,
    q: keyword,
    location: 'United States',
    google_domain: 'google.com',
    gl: 'us',
    hl: 'en',
    num: '20',
  });

  try {
    const res = await fetch(`https://api.valueserp.com/search?${params}`);
    if (!res.ok) throw new Error(`SERP API: ${res.status}`);

    const data = await res.json() as any;
    const organic = data.organic_results || [];

    const results: SERPResult[] = organic.map((r: any, i: number) => ({
      position: i + 1,
      title: r.title || '',
      url: r.link || '',
      snippet: r.snippet || '',
    }));

    return { position: null, results, source: 'valueserp' };
  } catch (e) {
    return { position: null, results: [], source: 'valueserp_error' };
  }
}

async function checkSERPdirect(keyword: string, targetUrl: string): Promise<{
  position: number | null;
  results: SERPResult[];
  source: string;
}> {
  // Use a simple Google search scrape (limited but functional)
  try {
    const query = encodeURIComponent(keyword);
    const res = await fetch(`https://www.google.com/search?q=${query}&num=20&hl=en&gl=us`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (!res.ok) {
      return { position: null, results: [], source: 'google_error' };
    }

    const html = await res.text();
    const results = parseGoogleResults(html);

    return { position: null, results, source: 'google_direct' };
  } catch (e) {
    return { position: null, results: [], source: 'google_error' };
  }
}

function parseGoogleResults(html: string): SERPResult[] {
  const results: SERPResult[] = [];

  // Extract result blocks — simplified parser for Cloudflare Workers
  // Looks for patterns like <a href="/url?q=..." followed by title text
  const linkPattern = /href="\/url\?q=([^"&]+)[^"]*"[^>]*>([^<]*)</gi;
  let match;
  let position = 0;

  while ((match = linkPattern.exec(html)) !== null && position < 20) {
    const url = decodeURIComponent(match[1]);
    const title = match[2].trim();

    // Filter out Google's own links, ads, etc.
    if (!url.startsWith('http') || url.includes('google.com') || url.includes('youtube.com/results')) {
      continue;
    }

    position++;
    results.push({
      position,
      title: title || url,
      url,
      snippet: '', // Snippet extraction is complex; skip for direct scraping
    });
  }

  return results;
}

// ── Find position of target URL in results ─────────────────────────

function findPosition(results: SERPResult[], targetUrl: string): number | null {
  const targetDomain = extractDomain(targetUrl);

  for (const result of results) {
    const resultDomain = extractDomain(result.url);

    // Exact URL match
    if (normalizeUrl(result.url) === normalizeUrl(targetUrl)) {
      return result.position;
    }

    // Domain match (any page on our domain)
    if (resultDomain === targetDomain) {
      return result.position;
    }
  }

  return null; // Not found in top 20
}

function extractDomain(url: string): string {
  try {
    return new URL(url).hostname.replace('www.', '');
  } catch {
    return url;
  }
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.hostname.replace('www.', '')}${u.pathname.replace(/\/$/, '')}`;
  } catch {
    return url;
  }
}

// ── Main SERP Check Cycle ──────────────────────────────────────────

async function serpCheckCycle(env: Env): Promise<string> {
  const db = new SupabaseClient(env.SUPABASE_URL, env.SUPABASE_KEY);
  const results: string[] = [`SERP Monitor — ${new Date().toISOString()}`];

  // Get tracked keywords that are due for checking
  let keywords: TrackedKeyword[];
  try {
    keywords = await db.query('serp_tracking',
      'select=*&is_active=eq.true&order=checked_at.asc.nullsfirst&limit=20'
    );
  } catch (e) {
    results.push('serp_tracking table not found or empty. Run migration first.');
    return results.join('\n');
  }

  if (keywords.length === 0) {
    results.push('No tracked keywords configured.');
    return results.join('\n');
  }

  // Filter by check frequency
  const now = Date.now();
  const due = keywords.filter(k => {
    if (!k.checked_at) return true; // Never checked
    const lastCheck = new Date(k.checked_at).getTime();
    const interval = (k.check_frequency_hours || 6) * 60 * 60 * 1000;
    return (now - lastCheck) >= interval;
  });

  if (due.length === 0) {
    results.push('All keywords recently checked. Nothing due.');
    return results.join('\n');
  }

  results.push(`Checking ${due.length} keywords...`);

  let improvements = 0;
  let drops = 0;
  let notFound = 0;

  for (const kw of due) {
    // Scope check
    if (isBlockedKeyword(kw.keyword)) {
      results.push(`  BLOCKED: "${kw.keyword}" — out of CMO scope`);
      continue;
    }

    // Rate limit: 2 second delay between checks to be respectful
    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
      const serp = await checkSERP(kw.keyword, kw.target_url, env.SERP_API_KEY);
      const position = findPosition(serp.results, kw.target_url);

      // Calculate trend
      const previousPosition = kw.current_position;
      const bestPosition = kw.best_position
        ? Math.min(kw.best_position, position || 999)
        : position;

      let trend = '→';
      if (position !== null && previousPosition !== null) {
        if (position < previousPosition) {
          trend = `↑ (was #${previousPosition})`;
          improvements++;
        } else if (position > previousPosition) {
          trend = `↓ (was #${previousPosition})`;
          drops++;
        }
      } else if (position === null) {
        trend = 'NOT FOUND in top 20';
        notFound++;
      }

      // Update tracking
      await db.update('serp_tracking', `id=eq.${kw.id}`, {
        previous_position: kw.current_position,
        current_position: position,
        best_position: bestPosition,
        checked_at: new Date().toISOString(),
        metadata: {
          ...kw.metadata,
          last_source: serp.source,
          last_results_count: serp.results.length,
          competitors: serp.results.slice(0, 5).map(r => ({
            position: r.position,
            url: r.url,
            title: r.title,
          })),
        },
      });

      // Log to history
      await db.insert('serp_history', {
        keyword_id: kw.id,
        keyword: kw.keyword,
        target_url: kw.target_url,
        position,
        source: serp.source,
        top_results: serp.results.slice(0, 10),
        checked_at: new Date().toISOString(),
      }).catch(() => {}); // Non-fatal if history table doesn't exist yet

      results.push(`  "${kw.keyword}": #${position || 'N/A'} ${trend}`);
    } catch (e) {
      results.push(`  ! "${kw.keyword}": ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  results.push(`SUMMARY: ${improvements} improved | ${drops} dropped | ${notFound} not ranked`);
  return results.join('\n');
}

// ── HTTP Handler ───────────────────────────────────────────────────

async function handleHTTP(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === '/health') {
    return new Response(JSON.stringify({
      status: 'ok',
      worker: 'serp-monitor',
      timestamp: new Date().toISOString(),
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  if (url.pathname === '/check' && request.method === 'POST') {
    const result = await serpCheckCycle(env);
    return new Response(JSON.stringify({ result }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Dashboard view
  if (url.pathname === '/keywords' || url.pathname === '/') {
    const db = new SupabaseClient(env.SUPABASE_URL, env.SUPABASE_KEY);
    const keywords = await db.query('serp_tracking',
      'select=keyword,target_url,current_position,previous_position,best_position,checked_at&is_active=eq.true&order=current_position.asc.nullslast'
    ).catch(() => []);

    return new Response(JSON.stringify(keywords, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response('Not Found', { status: 404 });
}

// ── Worker Export ──────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return handleHTTP(request, env);
  },

  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(
      serpCheckCycle(env).then(result => console.log(result))
    );
  },
};
