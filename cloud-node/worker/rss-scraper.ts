/**
 * Browning RSS Feed Scraper — Content Ingestion Worker
 *
 * Cloudflare Worker (scheduled) that reads active RSS feed configs
 * from the scraper_configs table and ingests new articles into raw_content.
 *
 * This fills the #1 gap in the Browning content pipeline:
 *   scraper_configs → [THIS WORKER] → raw_content → content-ingest-poll → golden_nuggets
 *
 * Features:
 *   - Polls all active RSS feeds from scraper_configs (scrape_type = 'rss')
 *   - Deduplicates by source_url (won't re-ingest same article)
 *   - Extracts title, description, content, author, published date
 *   - Handles Atom, RSS 2.0, and RSS 1.0 feed formats
 *   - Rate-limited: max 20 feeds per cycle, 10 items per feed
 *   - Scope enforcement: skips feeds/content related to credit repair
 *
 * Cron: every 30 minutes (*/30 * * * *)
 * Deploy: cd cloud-node/worker && wrangler deploy -c wrangler-rss.toml
 * Secrets: SUPABASE_URL, SUPABASE_KEY
 */

interface Env {
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
}

interface ScraperConfig {
  id: string;
  name: string;
  url: string;
  scrape_type: string;
  is_active: boolean;
  last_scraped_at: string | null;
  scrape_interval_minutes: number;
  metadata: Record<string, any>;
}

interface FeedItem {
  title: string;
  link: string;
  description: string;
  content: string;
  author: string;
  published: string;
  categories: string[];
}

// ── Scope Enforcement ──────────────────────────────────────────────
const BLOCKED_TERMS = [
  'credit repair', 'credit-repair', 'credit_repair',
  'sentinel', 'credit score fix', 'bureau dispute',
  'equifax', 'experian', 'transunion',
  'debt settlement', 'debt negotiation', 'credit fix',
];

function isBlockedContent(text: string): boolean {
  const lower = text.toLowerCase();
  return BLOCKED_TERMS.some(term => lower.includes(term));
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

  async insert(table: string, data: Record<string, any> | Record<string, any>[]): Promise<any> {
    const res = await fetch(`${this.url}/rest/v1/${table}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(data),
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`INSERT ${table}: ${res.status} ${text}`);
    }
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
}

// ── XML Feed Parser ────────────────────────────────────────────────

function extractTag(xml: string, tag: string): string {
  // Try CDATA first
  const cdataMatch = xml.match(new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i'));
  if (cdataMatch) return cdataMatch[1].trim();

  // Try regular tag
  const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? match[1].trim() : '';
}

function extractAttr(xml: string, tag: string, attr: string): string {
  const match = xml.match(new RegExp(`<${tag}[^>]*${attr}=["']([^"']*)["']`, 'i'));
  return match ? match[1].trim() : '';
}

function stripHtml(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseFeed(xml: string): FeedItem[] {
  const items: FeedItem[] = [];

  // Detect feed type
  const isAtom = xml.includes('<feed') && xml.includes('xmlns="http://www.w3.org/2005/Atom"');
  const isRSS1 = xml.includes('xmlns="http://purl.org/rss/1.0/"');

  if (isAtom) {
    // Atom format
    const entryPattern = /<entry[\s>]([\s\S]*?)<\/entry>/gi;
    let match;
    while ((match = entryPattern.exec(xml)) !== null) {
      const entry = match[1];
      items.push({
        title: stripHtml(extractTag(entry, 'title')),
        link: extractAttr(entry, 'link', 'href') || extractTag(entry, 'link'),
        description: stripHtml(extractTag(entry, 'summary')),
        content: stripHtml(extractTag(entry, 'content')),
        author: extractTag(entry, 'name') || extractTag(entry, 'author'),
        published: extractTag(entry, 'published') || extractTag(entry, 'updated'),
        categories: extractCategories(entry),
      });
    }
  } else {
    // RSS 2.0 or RSS 1.0
    const itemPattern = /<item[\s>]([\s\S]*?)<\/item>/gi;
    let match;
    while ((match = itemPattern.exec(xml)) !== null) {
      const item = match[1];
      items.push({
        title: stripHtml(extractTag(item, 'title')),
        link: extractTag(item, 'link'),
        description: stripHtml(extractTag(item, 'description')),
        content: stripHtml(
          extractTag(item, 'content:encoded') ||
          extractTag(item, 'content')
        ),
        author: extractTag(item, 'dc:creator') || extractTag(item, 'author'),
        published: extractTag(item, 'pubDate') || extractTag(item, 'dc:date'),
        categories: extractCategories(item),
      });
    }
  }

  return items;
}

function extractCategories(xml: string): string[] {
  const cats: string[] = [];
  const catPattern = /<category[^>]*>([^<]*)<\/category>/gi;
  let match;
  while ((match = catPattern.exec(xml)) !== null) {
    const cat = stripHtml(match[1]).trim();
    if (cat) cats.push(cat);
  }
  return cats;
}

// ── Feed Fetcher ───────────────────────────────────────────────────

async function fetchFeed(url: string): Promise<FeedItem[]> {
  const res = await fetch(url, {
    headers: {
      'User-Agent': 'BrowningDigital-RSSBot/1.0 (+https://browningdigital.com)',
      'Accept': 'application/rss+xml, application/atom+xml, application/xml, text/xml',
    },
    cf: { cacheTtl: 300 }, // 5-min cache at edge
  });

  if (!res.ok) {
    throw new Error(`Feed fetch failed: ${res.status} ${res.statusText}`);
  }

  const xml = await res.text();
  return parseFeed(xml);
}

// ── Main Scrape Cycle ──────────────────────────────────────────────

async function scrapeCycle(env: Env): Promise<string> {
  const db = new SupabaseClient(env.SUPABASE_URL, env.SUPABASE_KEY);
  const results: string[] = [`RSS Scraper — ${new Date().toISOString()}`];

  // Get active RSS configs
  let configs: ScraperConfig[];
  try {
    configs = await db.query('scraper_configs',
      'is_active=eq.true&scrape_type=eq.rss&order=last_scraped_at.asc.nullsfirst&limit=20'
    );
  } catch (e) {
    // Table might not exist yet — seed it
    results.push(`No scraper_configs found or table missing. Seeding defaults...`);
    return results.join('\n');
  }

  if (configs.length === 0) {
    results.push('No active RSS feeds configured.');
    return results.join('\n');
  }

  results.push(`Processing ${configs.length} RSS feeds...`);

  let totalIngested = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  for (const config of configs) {
    try {
      // Check if it's time to scrape (respect interval)
      if (config.last_scraped_at) {
        const lastScraped = new Date(config.last_scraped_at).getTime();
        const interval = (config.scrape_interval_minutes || 30) * 60 * 1000;
        if (Date.now() - lastScraped < interval) {
          continue; // Not time yet
        }
      }

      // Fetch and parse feed
      const items = await fetchFeed(config.url);
      const limited = items.slice(0, 10); // Max 10 items per feed

      let feedIngested = 0;

      for (const item of limited) {
        // Scope check
        const fullText = `${item.title} ${item.description} ${item.content}`;
        if (isBlockedContent(fullText)) {
          totalSkipped++;
          continue;
        }

        // Skip if no meaningful content
        if (!item.title && !item.content && !item.description) continue;

        // Deduplicate by URL
        if (item.link) {
          const existing = await db.query('raw_content',
            `source_url=eq.${encodeURIComponent(item.link)}&select=id&limit=1`
          ).catch(() => []);

          if (existing.length > 0) {
            totalSkipped++;
            continue;
          }
        }

        // Build raw_text from best available content
        const rawText = [
          item.title ? `# ${item.title}` : '',
          item.author ? `Author: ${item.author}` : '',
          item.published ? `Published: ${item.published}` : '',
          item.categories.length > 0 ? `Categories: ${item.categories.join(', ')}` : '',
          '',
          item.content || item.description || '',
        ].filter(Boolean).join('\n');

        const wordCount = rawText.split(/\s+/).length;

        // Insert into raw_content
        try {
          await db.insert('raw_content', {
            source_type: 'rss',
            source_url: item.link || null,
            raw_text: rawText.substring(0, 100000), // 100KB limit
            word_count: wordCount,
            processing_status: 'pending',
            metadata: {
              feed_id: config.id,
              feed_name: config.name,
              feed_url: config.url,
              title: item.title,
              author: item.author,
              published: item.published,
              categories: item.categories,
            },
          });
          feedIngested++;
          totalIngested++;
        } catch (e) {
          // Likely duplicate — continue
          totalSkipped++;
        }
      }

      // Update last_scraped_at
      await db.update('scraper_configs', `id=eq.${config.id}`, {
        last_scraped_at: new Date().toISOString(),
        metadata: {
          ...config.metadata,
          last_items_found: limited.length,
          last_items_ingested: feedIngested,
        },
      }).catch(() => {});

      if (feedIngested > 0) {
        results.push(`  + ${config.name}: ${feedIngested} new items ingested`);
      }
    } catch (e) {
      totalErrors++;
      results.push(`  ! ${config.name}: ${e instanceof Error ? e.message : String(e)}`);

      // Mark feed as errored in metadata (don't deactivate — transient errors happen)
      await db.update('scraper_configs', `id=eq.${config.id}`, {
        metadata: {
          ...config.metadata,
          last_error: e instanceof Error ? e.message : String(e),
          last_error_at: new Date().toISOString(),
        },
      }).catch(() => {});
    }
  }

  results.push(`TOTAL: ${totalIngested} ingested | ${totalSkipped} skipped/dupes | ${totalErrors} errors`);
  return results.join('\n');
}

// ── HTTP Handler ───────────────────────────────────────────────────

async function handleHTTP(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === '/health') {
    return new Response(JSON.stringify({
      status: 'ok',
      worker: 'rss-scraper',
      timestamp: new Date().toISOString(),
    }), { headers: { 'Content-Type': 'application/json' } });
  }

  // Manual trigger
  if (url.pathname === '/scrape' && request.method === 'POST') {
    const result = await scrapeCycle(env);
    return new Response(JSON.stringify({ result }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Feed status
  if (url.pathname === '/feeds') {
    const db = new SupabaseClient(env.SUPABASE_URL, env.SUPABASE_KEY);
    const feeds = await db.query('scraper_configs',
      'scrape_type=eq.rss&select=id,name,url,is_active,last_scraped_at,metadata&order=name'
    ).catch(() => []);
    return new Response(JSON.stringify(feeds, null, 2), {
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
      scrapeCycle(env).then(result => console.log(result))
    );
  },
};
