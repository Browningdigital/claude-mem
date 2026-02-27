/**
 * ContentScraperService — Database-driven content scraper orchestrator.
 *
 * Reads scraper_configs from Supabase, executes each scraper type (RSS, Threads,
 * Twitter, Reddit), scores content through the V5 scoring engine, and inserts
 * into raw_content for downstream processing.
 *
 * Designed to be triggered via HTTP (`POST /api/content/scrape`) by the Oracle
 * COO/CMO agent or by a cron heartbeat.
 */

import { logger } from '../../utils/logger.js';

// Supabase Management API (direct SQL)
const MGMT_API_URL = 'https://api.supabase.com/v1/projects/wcdyvukzlxxkgvxomaxr/database/query';
const MGMT_API_KEY = 'sbp_77f3a4025505ccf2e7dfa518913224b79fab3dd1';

// Content extractor worker (for full article extraction)
const EXTRACTOR_URL = 'https://content-extractor.devin-b58.workers.dev';

// ============================================================================
// Types
// ============================================================================

interface ScraperConfig {
  id: string;
  name: string;
  status: string;
  config: Record<string, any>;
  last_run: string | null;
  items_collected: number;
  error_count: number;
}

interface IngestResult {
  source: string;
  items_found: number;
  items_inserted: number;
  items_skipped: number;
  errors: string[];
  duration_ms: number;
}

interface RSSItem {
  title: string;
  link: string;
  description: string;
  pubDate?: string;
}

// ============================================================================
// Scoring Engine (imported from ContentIngestService pattern)
// ============================================================================

const CONTENT_PILLARS: Record<string, { weight: number; keywords: string[] }> = {
  fractional_cmo: { weight: 1.0, keywords: ['fractional cmo','fractional marketing','marketing leadership','marketing strategy','go-to-market','gtm','brand positioning','marketing audit','marketing budget','marketing roadmap','demand gen','demand generation','growth strategy','marketing consultant','outsourced marketing','marketing direction'] },
  revenue_systems: { weight: 1.0, keywords: ['revenue','mrr','arr','recurring revenue','subscription','pricing strategy','pricing model','payment system','checkout','conversion rate','sales funnel','landing page','a/b test','upsell','ltv','cac','churn','retention','digital product','productized service','course','template','info product','passive income','automated sales','sales page','stripe','lemon squeezy','high-ticket','premium pricing'] },
  systems_automation: { weight: 1.0, keywords: ['automation','automate','workflow','system','sop','n8n','zapier','make.com','api','integration','no-code','low-code','serverless','cloudflare workers','supabase','webhook','cron','ai agent','ai automation','llm','chatbot','mcp','claude','gpt','ai tool'] },
  web_premium: { weight: 0.9, keywords: ['web design','website','landing page','ui','ux','frontend','gsap','animation','scroll','interactive','conversion','cro','web performance','core web vitals','nextjs','react','tailwind','responsive','design system'] },
  content_marketing: { weight: 1.0, keywords: ['content marketing','content strategy','newsletter','blog','social media','linkedin','twitter','copywriting','email marketing','nurture sequence','content calendar','distribution','seo','organic traffic','lead magnet','thought leadership','personal brand','audience building'] },
  founder_ops: { weight: 1.0, keywords: ['solopreneur','bootstrapped','indie','side project','solo founder','one-person business','lifestyle business','quit my job','first customer','mvp','launch','revenue milestone','profit','burn rate','runway'] },
  vertical_saas: { weight: 0.8, keywords: ['saas','micro-saas','vertical saas','niche software','industry specific','b2b saas','b2c saas','app development','ios app','android app','mobile app','chrome extension','plugin','marketplace'] }
};

const PAIN_SIGNALS = ['frustrated','struggling','looking for','wish there was','alternative to','hate','broken','need help','anyone know','how do i','can\'t figure','spent hours','wasted time','too expensive','overpriced','switching from','migrating from','fed up','pain point','bottleneck','nightmare','impossible','what tool','recommend a','best way to','how to automate','manual process','time sink','help wanted','feature request','bug report','workaround','hack','duct tape','would pay for','take my money','desperately need','someone should build'];
const ACTION_SIGNALS = ['step by step','how to','tutorial','guide','framework','template','checklist','playbook','blueprint','strategy','case study','breakdown','analysis','lesson learned','mistake','what worked','what didn\'t','revenue numbers','exact process','here\'s how','my approach'];
const NOISE_SIGNALS = ['upvote','follow me','dm me','check my profile','free trial','limited time','act now','click here','sign up now','subscribe','like and share','tag a friend','giveaway','discount code','promo code','affiliate','sponsored'];

function scoreContent(text: string): { total: number; tier: string; pillarTags: string[]; opportunity: string } {
  if (!text || text.length < 50) return { total: 0, tier: 'skip', pillarTags: [], opportunity: 'none' };
  const lower = text.toLowerCase();
  const words = lower.split(/\s+/);
  if (words.length < 15) return { total: 0, tier: 'skip', pillarTags: [], opportunity: 'none' };

  const pillarMatches: { pillar: string; score: number }[] = [];
  for (const [key, pillar] of Object.entries(CONTENT_PILLARS)) {
    let mc = 0;
    for (const kw of pillar.keywords) {
      const escaped = kw.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
      const rx = new RegExp('\\b' + escaped + '\\b', 'gi');
      const m = lower.match(rx);
      if (m) mc += m.length;
    }
    if (mc > 0) pillarMatches.push({ pillar: key, score: Math.min(mc * 3 * pillar.weight, 30) | 0 });
  }
  pillarMatches.sort((a, b) => b.score - a.score);
  const alignmentScore = Math.min(pillarMatches[0]?.score || 0, 30);

  let actionHits = 0;
  for (const sig of ACTION_SIGNALS) if (lower.includes(sig)) actionHits++;
  const hasFramework = /\d+[\s]*(step|phase|stage|pillar|principle)/i.test(text);
  const hasMetrics = /\$[\d,]+|\d+%|\d+x|\d+k\b/i.test(text);
  const actionScore = Math.min((actionHits * 4) + (hasFramework ? 8 : 0) + (hasMetrics ? 5 : 0) + (actionHits >= 2 ? 3 : 0), 25);

  const hasFirstPerson = /\bi\s+(built|created|launched|grew|made|sold|earned|learned|tried|failed|started)/i.test(text);
  const hasSpecifics = hasMetrics || /\b(revenue|customers?|users?|subscribers?|conversion|traffic)\b/i.test(lower);
  let noiseHits = 0;
  for (const sig of NOISE_SIGNALS) if (lower.includes(sig)) noiseHits++;
  const isFluff = words.length > 100 && actionHits === 0 && pillarMatches.length === 0;
  const signalScore = Math.min((hasFirstPerson ? 8 : 0) + (hasSpecifics ? 7 : 0) + (words.length > 200 ? 5 : 0) + (words.length > 500 ? 3 : 0) - (noiseHits * 4) - (isFluff ? 10 : 0), 25);

  const painFound: string[] = [];
  let buyingIntent = false;
  for (const sig of PAIN_SIGNALS) {
    if (lower.includes(sig)) {
      painFound.push(sig);
      if (['would pay for','take my money','desperately need','someone should build'].includes(sig)) buyingIntent = true;
    }
  }
  const marketScore = Math.min((painFound.length * 3) + (buyingIntent ? 8 : 0), 20);

  const total = Math.max(0, alignmentScore + actionScore + signalScore + marketScore);
  const tier = total >= 65 ? 'gold' : total >= 40 ? 'silver' : total >= 20 ? 'bronze' : 'noise';
  const opportunity = painFound.length >= 3 && buyingIntent ? 'high' : painFound.length >= 2 ? 'medium' : painFound.length >= 1 ? 'low' : 'none';
  const pillarTags = pillarMatches.slice(0, 3).map(p => p.pillar);

  return { total, tier, pillarTags, opportunity };
}

// ============================================================================
// Helpers
// ============================================================================

function hashStr(s: string): string {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return 'h' + Math.abs(h).toString(36);
}

function escapeSql(s: string): string {
  return s.replace(/'/g, "''");
}

async function safeFetch(url: string, init?: RequestInit, timeoutMs = 15000): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function decodeEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code, 10)));
}

// ============================================================================
// ContentScraperService
// ============================================================================

export class ContentScraperService {

  private async querySupabase<T>(sql: string): Promise<T[]> {
    const response = await fetch(MGMT_API_URL, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${MGMT_API_KEY}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ query: sql })
    });
    if (!response.ok) {
      throw new Error(`Supabase query failed: ${response.status}`);
    }
    return await response.json() as T[];
  }

  private async logEvent(eventType: string, source: string, message: string, details: Record<string, any>, processingTimeMs?: number): Promise<void> {
    try {
      await this.querySupabase(
        `INSERT INTO content_stream_log (event_type, stream_source, status, message, details, processing_time_ms)
         VALUES ('${escapeSql(eventType)}', '${escapeSql(source)}', 'completed', '${escapeSql(message)}', '${escapeSql(JSON.stringify(details))}'::jsonb, ${processingTimeMs || 0})`
      );
    } catch {
      // Non-critical, don't fail the scrape
    }
  }

  // ============================================================================
  // Config Management
  // ============================================================================

  async getActiveConfigs(): Promise<ScraperConfig[]> {
    return this.querySupabase<ScraperConfig>(
      `SELECT id, name, status, config, last_run, items_collected, error_count FROM scraper_configs WHERE status = 'active' ORDER BY name`
    );
  }

  private async updateScraperStatus(id: string, result: IngestResult): Promise<void> {
    await this.querySupabase(
      `UPDATE scraper_configs SET
        last_run = NOW(),
        items_collected = items_collected + ${result.items_inserted},
        error_count = ${result.errors.length > 0 ? 'error_count + 1' : '0'}
      WHERE id = '${escapeSql(id)}'`
    );
  }

  private async insertRawContent(
    sourceType: string, rawText: string, metadata: Record<string, any>,
    wordCount: number, contentHash: string
  ): Promise<boolean> {
    // Dedup check
    const existing = await this.querySupabase<{ id: string }>(
      `SELECT id FROM raw_content WHERE content_hash = '${escapeSql(contentHash)}' LIMIT 1`
    );
    if (existing.length > 0) return false;

    await this.querySupabase(
      `INSERT INTO raw_content (source_type, raw_text, metadata, processing_status, word_count, token_estimate, content_hash)
       VALUES ('${escapeSql(sourceType)}', '${escapeSql(rawText.substring(0, 8000))}', '${escapeSql(JSON.stringify(metadata))}'::jsonb, 'processed', ${wordCount}, ${Math.ceil(wordCount * 1.3)}, '${escapeSql(contentHash)}')`
    );
    return true;
  }

  // ============================================================================
  // RSS Feed Scraper
  // ============================================================================

  async runRSSFeeds(config: ScraperConfig): Promise<IngestResult> {
    const start = Date.now();
    const result: IngestResult = { source: 'rss', items_found: 0, items_inserted: 0, items_skipped: 0, errors: [], duration_ms: 0 };
    const feeds = config.config.feeds || [];

    for (const feed of feeds) {
      try {
        const res = await safeFetch(feed.url, {
          headers: { 'User-Agent': 'BrowningDigital-ContentBot/1.0', 'Accept': 'application/rss+xml, application/xml, text/xml' }
        });
        if (!res?.ok) {
          result.errors.push(`${feed.name}: HTTP ${res?.status || 'timeout'}`);
          continue;
        }

        const xml = await res.text();
        const items = this.parseRSSItems(xml);
        result.items_found += items.length;

        for (const item of items.slice(0, 10)) { // Cap at 10 per feed per run
          try {
            const text = (item.title || '') + '\n\n' + (item.description || '');
            const score = scoreContent(text);
            if (score.tier === 'skip' || score.tier === 'noise') { result.items_skipped++; continue; }

            const contentHash = hashStr(item.link + item.title);
            const words = text.split(/\s+/).length;
            const metadata = {
              title: item.title,
              url: item.link,
              source: feed.name,
              feed_url: feed.url,
              pillar: feed.pillar,
              published: item.pubDate,
              content_type: 'article',
              score: score.total,
              score_tier: score.tier,
              pillar_tags: score.pillarTags,
              product_opportunity: score.opportunity,
              engine_version: 5,
              scraper: 'rss_v1'
            };

            const inserted = await this.insertRawContent('rss', text, metadata, words, contentHash);
            if (inserted) { result.items_inserted++; } else { result.items_skipped++; }
          } catch (e) {
            result.errors.push(`${feed.name}/${item.title}: ${(e as Error).message}`);
          }
        }
      } catch (e) {
        result.errors.push(`${feed.name}: ${(e as Error).message}`);
      }
    }

    result.duration_ms = Date.now() - start;
    return result;
  }

  private parseRSSItems(xml: string): RSSItem[] {
    const items: RSSItem[] = [];
    // Match <item> blocks in RSS or <entry> blocks in Atom
    const itemBlocks = xml.match(/<item[\s>]([\s\S]*?)<\/item>/gi) || [];
    const entryBlocks = xml.match(/<entry[\s>]([\s\S]*?)<\/entry>/gi) || [];

    for (const block of [...itemBlocks, ...entryBlocks]) {
      const title = this.extractTag(block, 'title');
      const link = this.extractLink(block);
      const description = this.extractTag(block, 'description') || this.extractTag(block, 'summary') || this.extractTag(block, 'content');
      const pubDate = this.extractTag(block, 'pubDate') || this.extractTag(block, 'published') || this.extractTag(block, 'updated');

      if (title && link) {
        items.push({
          title: decodeEntities(stripHtml(title)),
          link: decodeEntities(link),
          description: description ? decodeEntities(stripHtml(description)).substring(0, 2000) : '',
          pubDate
        });
      }
    }
    return items;
  }

  private extractTag(xml: string, tag: string): string | null {
    // Handle CDATA sections
    const cdataMatch = xml.match(new RegExp(`<${tag}[^>]*>\\s*<!\\[CDATA\\[([\\s\\S]*?)\\]\\]>\\s*</${tag}>`, 'i'));
    if (cdataMatch) return cdataMatch[1].trim();
    // Regular tag
    const match = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
    return match ? match[1].trim() : null;
  }

  private extractLink(xml: string): string {
    // RSS <link>
    const linkTag = xml.match(/<link>([^<]+)<\/link>/i);
    if (linkTag) return linkTag[1].trim();
    // Atom <link href="...">
    const atomLink = xml.match(/<link[^>]*href="([^"]+)"[^>]*\/?>/i);
    if (atomLink) return atomLink[1].trim();
    // GUID as fallback
    const guid = xml.match(/<guid[^>]*>([^<]+)<\/guid>/i);
    if (guid && guid[1].startsWith('http')) return guid[1].trim();
    return '';
  }

  // ============================================================================
  // Threads Scraper (Tier 2: embed page scraping)
  // ============================================================================

  async runThreadsScraper(config: ScraperConfig): Promise<IngestResult> {
    const start = Date.now();
    const result: IngestResult = { source: 'threads', items_found: 0, items_inserted: 0, items_skipped: 0, errors: [], duration_ms: 0 };
    const accounts: string[] = config.config.accounts || [];
    const searchTerms: string[] = config.config.search_terms || [];

    // Tier 1: Check if we have Threads API credentials
    const threadsToken = await this.getThreadsToken();
    if (threadsToken) {
      return this.runThreadsAPI(config, threadsToken, result, start);
    }

    // Tier 2: Scrape account profile pages for recent posts
    for (const handle of accounts) {
      try {
        // Fetch the profile page to find recent post IDs
        const profileRes = await safeFetch(`https://www.threads.net/@${handle}`, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html',
            'Accept-Language': 'en-US,en;q=0.9',
          }
        });

        if (!profileRes?.ok) {
          result.errors.push(`@${handle}: HTTP ${profileRes?.status || 'timeout'}`);
          continue;
        }

        const html = await profileRes.text();
        // Extract post IDs from profile HTML — look for post links
        const postIds = this.extractThreadsPostIds(html, handle);
        result.items_found += postIds.length;

        // Extract content from each post via embed
        for (const postId of postIds.slice(0, 5)) { // Cap at 5 per account
          try {
            const embedRes = await safeFetch(`https://www.threads.net/@${handle}/post/${postId}/embed/`, {
              headers: {
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'text/html',
              }
            });

            if (!embedRes?.ok) continue;
            const embedHtml = await embedRes.text();
            const textMatch = embedHtml.match(/"text":\s*"([^"]*?)"/i);
            if (!textMatch?.[1]) continue;

            const postText = textMatch[1].replace(/\\n/g, '\n').replace(/\\u([\dA-Fa-f]{4})/g,
              (_m: string, hex: string) => String.fromCharCode(parseInt(hex, 16))
            ).trim();

            if (postText.length < 30) continue;

            const score = scoreContent(postText);
            if (score.tier === 'skip') { result.items_skipped++; continue; }

            const contentHash = hashStr(`threads:${handle}:${postId}`);
            const words = postText.split(/\s+/).length;
            const metadata = {
              title: `@${handle} on Threads`,
              url: `https://www.threads.net/@${handle}/post/${postId}`,
              source: 'threads',
              author: handle,
              content_type: 'threads',
              score: score.total,
              score_tier: score.tier,
              pillar_tags: score.pillarTags,
              product_opportunity: score.opportunity,
              engine_version: 5,
              scraper: 'threads_embed_v1'
            };

            const inserted = await this.insertRawContent('threads', postText, metadata, words, contentHash);
            if (inserted) { result.items_inserted++; } else { result.items_skipped++; }
          } catch (e) {
            result.errors.push(`@${handle}/${postId}: ${(e as Error).message}`);
          }
        }
      } catch (e) {
        result.errors.push(`@${handle}: ${(e as Error).message}`);
      }
    }

    // Tier 3: DuckDuckGo discovery for search terms
    for (const term of searchTerms.slice(0, 5)) { // Cap at 5 terms per run
      try {
        const ddgRes = await safeFetch(
          `https://html.duckduckgo.com/html/?q=site%3Athreads.net+${encodeURIComponent(term)}`,
          { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120.0.0.0' } }
        );
        if (!ddgRes?.ok) continue;

        const ddgHtml = await ddgRes.text();
        // Extract threads.net URLs from DDG results
        const urlMatches = ddgHtml.match(/threads\.net\/@[\w.]+\/post\/[A-Za-z0-9_-]+/gi) || [];
        const uniqueUrls = [...new Set(urlMatches)];
        result.items_found += uniqueUrls.length;

        for (const path of uniqueUrls.slice(0, 3)) {
          try {
            const url = `https://www.${path}`;
            const postMatch = path.match(/@([\w.]+)\/post\/([A-Za-z0-9_-]+)/);
            if (!postMatch) continue;
            const [, username, postId] = postMatch;

            const embedRes = await safeFetch(`https://www.threads.net/@${username}/post/${postId}/embed/`, {
              headers: { 'User-Agent': 'Mozilla/5.0 Chrome/120.0.0.0', 'Accept': 'text/html' }
            });
            if (!embedRes?.ok) continue;

            const embedHtml = await embedRes.text();
            const textMatch = embedHtml.match(/"text":\s*"([^"]*?)"/i);
            if (!textMatch?.[1]) continue;

            const postText = textMatch[1].replace(/\\n/g, '\n').replace(/\\u([\dA-Fa-f]{4})/g,
              (_m: string, hex: string) => String.fromCharCode(parseInt(hex, 16))
            ).trim();
            if (postText.length < 30) continue;

            const score = scoreContent(postText);
            if (score.tier === 'skip') { result.items_skipped++; continue; }

            const contentHash = hashStr(`threads:${username}:${postId}`);
            const words = postText.split(/\s+/).length;
            const metadata = {
              title: `@${username} on Threads`,
              url,
              source: 'threads_discovery',
              author: username,
              search_term: term,
              content_type: 'threads',
              score: score.total,
              score_tier: score.tier,
              pillar_tags: score.pillarTags,
              product_opportunity: score.opportunity,
              engine_version: 5,
              scraper: 'threads_ddg_v1'
            };

            const inserted = await this.insertRawContent('threads', postText, metadata, words, contentHash);
            if (inserted) { result.items_inserted++; } else { result.items_skipped++; }
          } catch {
            // Individual post extraction failure, continue
          }
        }
      } catch (e) {
        result.errors.push(`DDG:${term}: ${(e as Error).message}`);
      }
    }

    result.duration_ms = Date.now() - start;
    return result;
  }

  private extractThreadsPostIds(html: string, handle: string): string[] {
    const ids: string[] = [];
    // Look for post links in the profile HTML
    const pattern = new RegExp(`@${handle.replace(/\./g, '\\.')}/post/([A-Za-z0-9_-]+)`, 'gi');
    let match;
    while ((match = pattern.exec(html)) !== null) {
      if (!ids.includes(match[1])) ids.push(match[1]);
    }
    // Also try JSON-LD or embedded data
    const jsonPostIds = html.match(/"code":\s*"([A-Za-z0-9_-]+)"/gi) || [];
    for (const jp of jsonPostIds) {
      const id = jp.match(/"code":\s*"([A-Za-z0-9_-]+)"/i)?.[1];
      if (id && !ids.includes(id)) ids.push(id);
    }
    return ids.slice(0, 10);
  }

  private async getThreadsToken(): Promise<string | null> {
    try {
      const rows = await this.querySupabase<{ state_value: string }>(
        `SELECT state_value FROM claude_system_state WHERE state_key = 'threads_credentials' LIMIT 1`
      );
      if (rows.length > 0) {
        const creds = JSON.parse(rows[0].state_value);
        return creds.access_token || null;
      }
    } catch {}
    return null;
  }

  private async runThreadsAPI(
    config: ScraperConfig, token: string, result: IngestResult, start: number
  ): Promise<IngestResult> {
    const searchTerms: string[] = config.config.search_terms || [];

    for (const term of searchTerms) {
      try {
        const since = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString().split('T')[0];
        const res = await safeFetch(
          `https://graph.threads.net/threads/search?q=${encodeURIComponent(term)}&since=${since}&fields=id,text,username,timestamp&access_token=${token}`,
          { headers: { 'Accept': 'application/json' } }
        );
        if (!res?.ok) {
          result.errors.push(`API:${term}: HTTP ${res?.status}`);
          continue;
        }

        const data = await res.json() as any;
        const posts = data.data || [];
        result.items_found += posts.length;

        for (const post of posts) {
          if (!post.text || post.text.length < 30) continue;
          const score = scoreContent(post.text);
          if (score.tier === 'skip') { result.items_skipped++; continue; }

          const contentHash = hashStr(`threads_api:${post.id}`);
          const words = post.text.split(/\s+/).length;
          const metadata = {
            title: `@${post.username} on Threads`,
            url: `https://www.threads.net/@${post.username}/post/${post.id}`,
            source: 'threads_api',
            author: post.username,
            search_term: term,
            content_type: 'threads',
            published: post.timestamp,
            score: score.total,
            score_tier: score.tier,
            pillar_tags: score.pillarTags,
            product_opportunity: score.opportunity,
            engine_version: 5,
            scraper: 'threads_api_v1'
          };

          const inserted = await this.insertRawContent('threads', post.text, metadata, words, contentHash);
          if (inserted) { result.items_inserted++; } else { result.items_skipped++; }
        }
      } catch (e) {
        result.errors.push(`API:${term}: ${(e as Error).message}`);
      }
    }

    result.duration_ms = Date.now() - start;
    return result;
  }

  // ============================================================================
  // Twitter/X Scraper (via fxtwitter API)
  // ============================================================================

  async runTwitterScraper(config: ScraperConfig): Promise<IngestResult> {
    const start = Date.now();
    const result: IngestResult = { source: 'twitter', items_found: 0, items_inserted: 0, items_skipped: 0, errors: [], duration_ms: 0 };
    const searchTerms: string[] = config.config.search_terms || [];
    const accounts: string[] = config.config.accounts || [];

    // Search terms via fxtwitter search
    for (const term of searchTerms.slice(0, 15)) { // Cap searches per run
      try {
        const res = await safeFetch(
          `https://api.fxtwitter.com/search?q=${encodeURIComponent(term)}&limit=10`,
          { headers: { 'Accept': 'application/json' } }
        );
        if (!res?.ok) continue;

        const data = await res.json() as any;
        const tweets = data.tweets || data.results || [];
        result.items_found += tweets.length;

        for (const tweet of tweets) {
          const text = tweet.text || tweet.content || '';
          if (text.length < 30) continue;

          const score = scoreContent(text);
          if (score.tier === 'skip' || score.tier === 'noise') { result.items_skipped++; continue; }

          const tweetUrl = tweet.url || `https://x.com/${tweet.author?.screen_name || 'unknown'}/status/${tweet.id}`;
          const contentHash = hashStr(`twitter:${tweet.id || tweetUrl}`);
          const words = text.split(/\s+/).length;
          const metadata = {
            title: `@${tweet.author?.screen_name || 'unknown'}: Tweet`,
            url: tweetUrl,
            source: 'twitter',
            author: tweet.author?.screen_name || tweet.user?.screen_name,
            search_term: term,
            content_type: 'twitter',
            likes: tweet.likes || tweet.favorite_count,
            retweets: tweet.retweets || tweet.retweet_count,
            score: score.total,
            score_tier: score.tier,
            pillar_tags: score.pillarTags,
            product_opportunity: score.opportunity,
            engine_version: 5,
            scraper: 'twitter_fxtwitter_v1'
          };

          const inserted = await this.insertRawContent('x_api', text, metadata, words, contentHash);
          if (inserted) { result.items_inserted++; } else { result.items_skipped++; }
        }
      } catch (e) {
        result.errors.push(`twitter:${term}: ${(e as Error).message}`);
      }
    }

    // Individual accounts — fetch latest tweet
    for (const handle of accounts.slice(0, 10)) {
      try {
        const res = await safeFetch(
          `https://api.fxtwitter.com/${handle}`,
          { headers: { 'Accept': 'application/json' } }
        );
        if (!res?.ok) continue;

        const data = await res.json() as any;
        const tweet = data.tweet || data;
        const text = tweet.text || '';
        if (text.length < 30) continue;

        result.items_found++;
        const score = scoreContent(text);
        if (score.tier === 'skip' || score.tier === 'noise') { result.items_skipped++; continue; }

        const contentHash = hashStr(`twitter:${tweet.id || handle}`);
        const words = text.split(/\s+/).length;
        const metadata = {
          title: `@${handle}: Tweet`,
          url: tweet.url || `https://x.com/${handle}`,
          source: 'twitter',
          author: handle,
          content_type: 'twitter',
          score: score.total,
          score_tier: score.tier,
          pillar_tags: score.pillarTags,
          engine_version: 5,
          scraper: 'twitter_fxtwitter_v1'
        };

        const inserted = await this.insertRawContent('x_api', text, metadata, words, contentHash);
        if (inserted) { result.items_inserted++; } else { result.items_skipped++; }
      } catch (e) {
        result.errors.push(`twitter:@${handle}: ${(e as Error).message}`);
      }
    }

    result.duration_ms = Date.now() - start;
    return result;
  }

  // ============================================================================
  // Reddit Scraper (via .json API)
  // ============================================================================

  async runRedditScraper(config: ScraperConfig): Promise<IngestResult> {
    const start = Date.now();
    const result: IngestResult = { source: 'reddit', items_found: 0, items_inserted: 0, items_skipped: 0, errors: [], duration_ms: 0 };
    const subreddits: string[] = config.config.subreddits || [];
    const minScore = config.config.min_score || 10;

    for (const sub of subreddits) {
      try {
        const res = await safeFetch(
          `https://www.reddit.com/r/${sub}/hot.json?limit=25`,
          {
            headers: {
              'User-Agent': 'BrowningDigital-ContentBot/1.0 (Cloudflare Worker)',
              'Accept': 'application/json',
            }
          }
        );
        if (!res?.ok) {
          result.errors.push(`r/${sub}: HTTP ${res?.status || 'timeout'}`);
          continue;
        }

        const data = await res.json() as any;
        const posts = data?.data?.children || [];
        result.items_found += posts.length;

        for (const child of posts) {
          const post = child.data;
          if (!post) continue;
          if (post.score < minScore) continue;
          if (post.over_18 || post.stickied) continue;

          const text = (post.title || '') + '\n\n' + (post.selftext || '');
          if (text.length < 50) continue;

          const score = scoreContent(text);
          if (score.tier === 'skip' || score.tier === 'noise') { result.items_skipped++; continue; }

          const contentHash = hashStr(`reddit:${post.id}`);
          const words = text.split(/\s+/).length;
          const metadata = {
            title: post.title,
            url: `https://www.reddit.com${post.permalink}`,
            source: `r/${sub}`,
            author: post.author,
            subreddit: sub,
            content_type: 'reddit',
            reddit_score: post.score,
            num_comments: post.num_comments,
            upvote_ratio: post.upvote_ratio,
            score: score.total,
            score_tier: score.tier,
            pillar_tags: score.pillarTags,
            product_opportunity: score.opportunity,
            engine_version: 5,
            scraper: 'reddit_json_v1'
          };

          const inserted = await this.insertRawContent('reddit_api', text, metadata, words, contentHash);
          if (inserted) { result.items_inserted++; } else { result.items_skipped++; }
        }
      } catch (e) {
        result.errors.push(`r/${sub}: ${(e as Error).message}`);
      }
    }

    result.duration_ms = Date.now() - start;
    return result;
  }

  // ============================================================================
  // Master Orchestrator
  // ============================================================================

  async runAll(): Promise<Record<string, IngestResult>> {
    const results: Record<string, IngestResult> = {};
    const configs = await this.getActiveConfigs();
    logger.info('SCRAPER', `Starting scrape run with ${configs.length} active configs`);

    const scraperMap: Record<string, (config: ScraperConfig) => Promise<IngestResult>> = {
      rss: (c) => this.runRSSFeeds(c),
      threads: (c) => this.runThreadsScraper(c),
      twitter: (c) => this.runTwitterScraper(c),
      reddit: (c) => this.runRedditScraper(c),
    };

    // Run all scrapers in parallel
    const promises = configs
      .filter(c => scraperMap[c.id])
      .map(async (config) => {
        try {
          const scraper = scraperMap[config.id];
          const result = await scraper(config);
          results[config.id] = result;
          await this.updateScraperStatus(config.id, result);
          await this.logEvent('scrape', config.id,
            `${config.id}: found=${result.items_found} inserted=${result.items_inserted} skipped=${result.items_skipped}`,
            { items_found: result.items_found, items_inserted: result.items_inserted, items_skipped: result.items_skipped, errors: result.errors },
            result.duration_ms
          );
          logger.info('SCRAPER', `${config.id}: found=${result.items_found} inserted=${result.items_inserted} skipped=${result.items_skipped} errors=${result.errors.length} (${result.duration_ms}ms)`);
        } catch (e) {
          results[config.id] = {
            source: config.id,
            items_found: 0, items_inserted: 0, items_skipped: 0,
            errors: [(e as Error).message],
            duration_ms: 0
          };
          logger.error('SCRAPER', `${config.id} failed`, {}, e as Error);
        }
      });

    await Promise.all(promises);

    // Summary
    const totalInserted = Object.values(results).reduce((sum, r) => sum + r.items_inserted, 0);
    const totalFound = Object.values(results).reduce((sum, r) => sum + r.items_found, 0);
    logger.info('SCRAPER', `Scrape run complete: ${totalFound} found, ${totalInserted} inserted across ${Object.keys(results).length} sources`);

    return results;
  }

  async runSingle(type: string): Promise<IngestResult> {
    const configs = await this.querySupabase<ScraperConfig>(
      `SELECT id, name, status, config, last_run, items_collected, error_count FROM scraper_configs WHERE id = '${escapeSql(type)}'`
    );
    if (configs.length === 0) {
      return { source: type, items_found: 0, items_inserted: 0, items_skipped: 0, errors: [`No config found for ${type}`], duration_ms: 0 };
    }

    const scraperMap: Record<string, (config: ScraperConfig) => Promise<IngestResult>> = {
      rss: (c) => this.runRSSFeeds(c),
      threads: (c) => this.runThreadsScraper(c),
      twitter: (c) => this.runTwitterScraper(c),
      reddit: (c) => this.runRedditScraper(c),
    };

    const scraper = scraperMap[type];
    if (!scraper) {
      return { source: type, items_found: 0, items_inserted: 0, items_skipped: 0, errors: [`No scraper implementation for ${type}`], duration_ms: 0 };
    }

    const result = await scraper(configs[0]);
    await this.updateScraperStatus(type, result);
    await this.logEvent('scrape', type, '', {
      items_found: result.items_found,
      items_inserted: result.items_inserted,
      items_skipped: result.items_skipped,
      errors: result.errors.length,
      duration_ms: result.duration_ms
    });
    return result;
  }
}
