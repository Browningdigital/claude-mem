/**
 * ContentIngestService - Bridge to Browning Digital content pipeline
 *
 * Connects claude-mem to the Supabase-backed content ingestion infrastructure:
 * - RSS feeds (scraper_configs → raw_content)
 * - Golden nuggets (high-value extracted insights)
 * - Content queue (scheduled social posts)
 * - Content library (approved content pieces)
 * - Content stream log (processing telemetry)
 *
 * Architecture:
 * - Reads from Supabase via REST API (no direct pg connection needed)
 * - Caches results locally with TTL to avoid hammering Supabase
 * - Exposes typed methods for route handlers and MCP tools
 */

import { logger } from '../../utils/logger.js';

// Supabase project config (from Browning Memory)
const SUPABASE_URL = 'https://wcdyvukzlxxkgvxomaxr.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndjZHl2dWt6bHh4a2d2eG9tYXhyIiwicm9sZSI6ImFub24iLCJpYXQiOjE3MzgwMTk5ODUsImV4cCI6MjA1MzU5NTk4NX0.8eR3Ky7P7tXjHPLbMh1V8KO7xO_iSWPaJB_PqNUN5IM';

// Management API for direct SQL (fallback)
const MGMT_API_URL = 'https://api.supabase.com/v1/projects/wcdyvukzlxxkgvxomaxr/database/query';
const MGMT_API_KEY = 'sbp_77f3a4025505ccf2e7dfa518913224b79fab3dd1';

// Cache TTL (5 minutes for feeds, 1 minute for queue)
const CACHE_TTL_FEEDS = 5 * 60 * 1000;
const CACHE_TTL_QUEUE = 60 * 1000;

// ============================================================================
// Content Scoring Engine — Pillars & Signals (from Autonomous Engine v5)
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

interface PillarMatch {
  pillar: string;
  matches: number;
  score: number;
}

interface ContentScore {
  total: number;
  tier: string;
  breakdown: Record<string, number>;
  pillarMatches: PillarMatch[];
  signals: Record<string, any>;
  opportunity: string;
}

interface BridgeResult {
  bridged: boolean;
  reason?: string;
  score?: number;
  tier?: string;
  pillars?: string[];
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export interface ScraperConfig {
  id: string;
  name: string;
  status: string;
  config: Record<string, any>;
  last_run: string | null;
  items_collected: number;
  error_count: number;
  created_at: string;
}

export interface RawContentItem {
  id: string;
  source_type: string;
  raw_text: string;
  metadata: Record<string, any>;
  processing_status: string;
  word_count: number;
  content_hash: string | null;
  created_at: string;
  updated_at: string;
}

export interface GoldenNugget {
  id: string;
  nugget_type: string;
  category: string | null;
  title: string;
  description: string;
  detailed_explanation: string | null;
  priority: number | null;
  pipeline_stage: string | null;
  status: string | null;
  created_at: string;
}

export interface ContentQueueItem {
  id: string;
  platform: string;
  content_type: string | null;
  title: string | null;
  body: string;
  status: string | null;
  scheduled_for: string | null;
  created_at: string;
}

export interface ContentLibraryItem {
  id: string;
  content_type: string;
  title: string;
  slug: string | null;
  content: string | null;
  description: string | null;
  status: string | null;
  created_at: string;
}

export interface ProcessedInsight {
  id: string;
  raw_content_id: string;
  relevance_score: number | null;
  nugget_score: number | null;
  topic_tags: string[] | null;
  actionable_points: string[] | null;
  is_golden_nugget: boolean | null;
  created_at: string;
}

export interface ContentFeedSummary {
  scraper_configs: ScraperConfig[];
  recent_content: RawContentItem[];
  golden_nuggets: GoldenNugget[];
  content_queue: ContentQueueItem[];
  pipeline_stats: {
    total_raw_content: number;
    total_processed: number;
    total_nuggets: number;
    total_queued: number;
    total_library: number;
  };
}

export class ContentIngestService {
  private cache: Map<string, CacheEntry<any>> = new Map();

  /**
   * Execute SQL query via Supabase Management API
   */
  private async querySupabase<T>(sql: string): Promise<T[]> {
    try {
      const response = await fetch(MGMT_API_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${MGMT_API_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ query: sql })
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Supabase API error (${response.status}): ${errorText}`);
      }

      const data = await response.json() as T[];
      return data;
    } catch (error) {
      logger.error('CONTENT', 'Supabase query failed', { sql: sql.substring(0, 100) }, error as Error);
      throw error;
    }
  }

  /**
   * Get cached data or fetch fresh
   */
  private async getCached<T>(key: string, ttl: number, fetcher: () => Promise<T>): Promise<T> {
    const cached = this.cache.get(key);
    if (cached && (Date.now() - cached.timestamp) < ttl) {
      return cached.data;
    }

    const data = await fetcher();
    this.cache.set(key, { data, timestamp: Date.now() });
    return data;
  }

  /**
   * Clear all cached data
   */
  clearCache(): void {
    this.cache.clear();
  }

  // ============================================================================
  // Scraper Configs
  // ============================================================================

  async getScraperConfigs(): Promise<ScraperConfig[]> {
    return this.getCached('scraper_configs', CACHE_TTL_FEEDS, async () => {
      return this.querySupabase<ScraperConfig>(
        `SELECT id, name, status, config, last_run, items_collected, error_count, created_at
         FROM scraper_configs ORDER BY name`
      );
    });
  }

  async getRSSFeedConfig(): Promise<ScraperConfig | null> {
    const configs = await this.getScraperConfigs();
    return configs.find(c => c.id === 'rss') || null;
  }

  // ============================================================================
  // Raw Content
  // ============================================================================

  async getRecentContent(limit: number = 20, sourceType?: string): Promise<RawContentItem[]> {
    const cacheKey = `raw_content_${limit}_${sourceType || 'all'}`;
    return this.getCached(cacheKey, CACHE_TTL_FEEDS, async () => {
      const whereClause = sourceType
        ? `WHERE source_type = '${sourceType.replace(/'/g, "''")}'`
        : '';
      return this.querySupabase<RawContentItem>(
        `SELECT id, source_type, raw_text, metadata, processing_status, word_count, content_hash, created_at, updated_at
         FROM raw_content ${whereClause}
         ORDER BY created_at DESC LIMIT ${limit}`
      );
    });
  }

  async searchContent(query: string, limit: number = 10): Promise<RawContentItem[]> {
    // Use ILIKE for search across raw_text and metadata title
    const escapedQuery = query.replace(/'/g, "''");
    return this.querySupabase<RawContentItem>(
      `SELECT id, source_type, raw_text, metadata, processing_status, word_count, content_hash, created_at, updated_at
       FROM raw_content
       WHERE raw_text ILIKE '%${escapedQuery}%'
          OR metadata->>'title' ILIKE '%${escapedQuery}%'
          OR metadata->>'source' ILIKE '%${escapedQuery}%'
       ORDER BY created_at DESC LIMIT ${limit}`
    );
  }

  // ============================================================================
  // Golden Nuggets
  // ============================================================================

  async getGoldenNuggets(limit: number = 20, stage?: string): Promise<GoldenNugget[]> {
    const cacheKey = `nuggets_${limit}_${stage || 'all'}`;
    return this.getCached(cacheKey, CACHE_TTL_FEEDS, async () => {
      const whereClause = stage
        ? `WHERE pipeline_stage = '${stage.replace(/'/g, "''")}'`
        : '';
      return this.querySupabase<GoldenNugget>(
        `SELECT id, nugget_type, category, title, description, detailed_explanation,
                priority, pipeline_stage, status, created_at
         FROM golden_nuggets ${whereClause}
         ORDER BY COALESCE(priority, 0) DESC, created_at DESC LIMIT ${limit}`
      );
    });
  }

  async searchNuggets(query: string, limit: number = 10): Promise<GoldenNugget[]> {
    const escapedQuery = query.replace(/'/g, "''");
    return this.querySupabase<GoldenNugget>(
      `SELECT id, nugget_type, category, title, description, detailed_explanation,
              priority, pipeline_stage, status, created_at
       FROM golden_nuggets
       WHERE title ILIKE '%${escapedQuery}%'
          OR description ILIKE '%${escapedQuery}%'
       ORDER BY COALESCE(priority, 0) DESC, created_at DESC LIMIT ${limit}`
    );
  }

  // ============================================================================
  // Content Queue (scheduled posts)
  // ============================================================================

  async getContentQueue(status?: string, limit: number = 20): Promise<ContentQueueItem[]> {
    const cacheKey = `queue_${status || 'all'}_${limit}`;
    return this.getCached(cacheKey, CACHE_TTL_QUEUE, async () => {
      const whereClause = status
        ? `WHERE status = '${status.replace(/'/g, "''")}'`
        : '';
      return this.querySupabase<ContentQueueItem>(
        `SELECT id, platform, content_type, title, body, status, scheduled_for, created_at
         FROM content_queue ${whereClause}
         ORDER BY COALESCE(scheduled_for, created_at) ASC LIMIT ${limit}`
      );
    });
  }

  // ============================================================================
  // Content Library (approved pieces)
  // ============================================================================

  async getContentLibrary(limit: number = 20): Promise<ContentLibraryItem[]> {
    return this.getCached(`library_${limit}`, CACHE_TTL_FEEDS, async () => {
      return this.querySupabase<ContentLibraryItem>(
        `SELECT id, content_type, title, slug, content, description, status, created_at
         FROM content_library
         ORDER BY created_at DESC LIMIT ${limit}`
      );
    });
  }

  // ============================================================================
  // Processed Insights
  // ============================================================================

  async getProcessedInsights(limit: number = 20): Promise<ProcessedInsight[]> {
    return this.getCached(`insights_${limit}`, CACHE_TTL_FEEDS, async () => {
      return this.querySupabase<ProcessedInsight>(
        `SELECT id, raw_content_id, relevance_score, nugget_score, topic_tags,
                actionable_points, is_golden_nugget, created_at
         FROM processed_insights
         ORDER BY COALESCE(nugget_score, 0) DESC, created_at DESC LIMIT ${limit}`
      );
    });
  }

  // ============================================================================
  // Pipeline Stats & Feed Summary
  // ============================================================================

  async getPipelineStats(): Promise<ContentFeedSummary['pipeline_stats']> {
    return this.getCached('pipeline_stats', CACHE_TTL_FEEDS, async () => {
      const results = await this.querySupabase<Record<string, number>>(
        `SELECT
          (SELECT COUNT(*) FROM raw_content) as total_raw_content,
          (SELECT COUNT(*) FROM raw_content WHERE processing_status = 'processed') as total_processed,
          (SELECT COUNT(*) FROM golden_nuggets) as total_nuggets,
          (SELECT COUNT(*) FROM content_queue WHERE status = 'queued') as total_queued,
          (SELECT COUNT(*) FROM content_library) as total_library`
      );
      return results[0] as ContentFeedSummary['pipeline_stats'];
    });
  }

  async getContentFeedSummary(): Promise<ContentFeedSummary> {
    const [scraperConfigs, recentContent, goldenNuggets, contentQueue, pipelineStats] =
      await Promise.all([
        this.getScraperConfigs(),
        this.getRecentContent(10),
        this.getGoldenNuggets(10),
        this.getContentQueue('queued', 10),
        this.getPipelineStats()
      ]);

    return {
      scraper_configs: scraperConfigs,
      recent_content: recentContent,
      golden_nuggets: goldenNuggets,
      content_queue: contentQueue,
      pipeline_stats: pipelineStats
    };
  }

  // ============================================================================
  // Content Extractor Integration
  // ============================================================================

  async getExtractions(limit: number = 20): Promise<any[]> {
    return this.getCached(`extractions_${limit}`, CACHE_TTL_FEEDS, async () => {
      return this.querySupabase(
        `SELECT id, url, content_type, title, extracted_at, expires_at, error
         FROM extractions
         ORDER BY extracted_at DESC NULLS LAST LIMIT ${limit}`
      );
    });
  }

  // ============================================================================
  // Manual Share → raw_content Bridge (scoring + pipeline injection)
  // ============================================================================

  /**
   * Score content against Browning Digital content pillars.
   * Ported from Autonomous Engine v5 with +15 curator bonus for manual shares.
   */
  scoreContent(text: string): ContentScore {
    if (!text || text.length < 50) return { total: 0, tier: 'skip', breakdown: {}, pillarMatches: [], signals: {}, opportunity: 'none' };
    const lower = text.toLowerCase();
    const words = lower.split(/\s+/);
    if (words.length < 15) return { total: 0, tier: 'skip', breakdown: {}, pillarMatches: [], signals: {}, opportunity: 'none' };

    const pillarMatches: PillarMatch[] = [];
    for (const [key, pillar] of Object.entries(CONTENT_PILLARS)) {
      let mc = 0;
      for (const kw of pillar.keywords) {
        const escaped = kw.replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&');
        const rx = new RegExp('\\b' + escaped + '\\b', 'gi');
        const m = lower.match(rx);
        if (m) mc += m.length;
      }
      if (mc > 0) pillarMatches.push({ pillar: key, matches: mc, score: Math.min(mc * 3 * pillar.weight, 30) | 0 });
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
        if (['would pay for', 'take my money', 'desperately need', 'someone should build'].includes(sig)) buyingIntent = true;
      }
    }
    const marketScore = Math.min((painFound.length * 3) + (buyingIntent ? 8 : 0), 20);

    const curatorBonus = 15;
    const total = Math.max(0, alignmentScore + actionScore + signalScore + marketScore + curatorBonus);
    const tier = total >= 65 ? 'gold' : total >= 40 ? 'silver' : total >= 20 ? 'bronze' : 'noise';
    const opportunity = painFound.length >= 3 && buyingIntent ? 'high' : painFound.length >= 2 ? 'medium' : painFound.length >= 1 ? 'low' : 'none';

    return {
      total, tier,
      breakdown: { alignment: alignmentScore, actionability: actionScore, signal: signalScore, market: marketScore, curator_bonus: curatorBonus },
      pillarMatches,
      signals: { painFound, buyingIntent, hasFramework, hasMetrics, hasFirstPerson, noiseHits, actionHits },
      opportunity
    };
  }

  /**
   * Bridge shared content into raw_content for the scoring pipeline.
   * Called by the content-extractor worker after saving to uploads/extractions.
   */
  async bridgeToRawContent(url: string, title: string, content: string, contentType: string, source: string = 'ios-shortcut'): Promise<BridgeResult> {
    try {
      const text = (title || '') + '\n\n' + (content || '');
      const score = this.scoreContent(text);
      if (score.tier === 'skip') return { bridged: false, reason: 'skip_tier' };

      const contentHash = this.hashStr(url + (title || ''));
      const words = (content || '').split(/\s+/).length;

      // Check for duplicates
      const existing = await this.querySupabase<{ id: string }>(
        `SELECT id FROM raw_content WHERE content_hash = '${contentHash}' LIMIT 1`
      );
      if (existing.length > 0) return { bridged: false, reason: 'duplicate', score: score.total, tier: score.tier };

      // Insert into raw_content
      const metadata = JSON.stringify({
        title: title || url,
        url,
        source,
        content_type: contentType,
        score: score.total,
        score_tier: score.tier,
        score_breakdown: score.breakdown,
        pillar_tags: score.pillarMatches.slice(0, 3).map(p => p.pillar),
        pain_signals: score.signals.painFound,
        product_opportunity: score.opportunity,
        has_buying_intent: score.signals.buyingIntent,
        shared_at: new Date().toISOString(),
        engine_version: 5,
        bridge: 'content-extractor-v1'
      }).replace(/'/g, "''");

      const rawText = (content || '').substring(0, 8000).replace(/'/g, "''");
      const escapedHash = contentHash.replace(/'/g, "''");
      const escapedTitle = (title || url).replace(/'/g, "''");

      await this.querySupabase(
        `INSERT INTO raw_content (source_type, raw_text, metadata, processing_status, word_count, token_estimate, content_hash)
         VALUES ('manual_share', '${rawText}', '${metadata}'::jsonb, 'processed', ${words}, ${Math.ceil(words * 1.3)}, '${escapedHash}')`
      );

      logger.info('CONTENT', `Bridged manual share: ${title || url} → score ${score.total} (${score.tier})`, {
        url, score: score.total, tier: score.tier,
        pillars: score.pillarMatches.slice(0, 3).map(p => p.pillar)
      });

      return { bridged: true, score: score.total, tier: score.tier, pillars: score.pillarMatches.slice(0, 3).map(p => p.pillar) };
    } catch (error) {
      logger.error('CONTENT', 'Bridge to raw_content failed', { url }, error as Error);
      return { bridged: false, reason: (error as Error).message };
    }
  }

  private hashStr(s: string): string {
    let h = 0;
    for (let i = 0; i < s.length; i++) {
      h = ((h << 5) - h + s.charCodeAt(i)) | 0;
    }
    return 'h' + Math.abs(h).toString(36);
  }

  async getManualShares(limit: number = 20): Promise<RawContentItem[]> {
    return this.getCached(`manual_shares_${limit}`, CACHE_TTL_FEEDS, async () => {
      return this.querySupabase<RawContentItem>(
        `SELECT id, source_type, raw_text, metadata, processing_status, word_count, content_hash, created_at, updated_at
         FROM raw_content WHERE source_type = 'manual_share'
         ORDER BY (metadata->>'score')::int DESC NULLS LAST, created_at DESC
         LIMIT ${limit}`
      );
    });
  }

  // ============================================================================
  // Formatted output for MCP/context injection
  // ============================================================================

  // ============================================================================
  // Browning Memory — claude_memories (cross-session persistence)
  // ============================================================================

  /**
   * Load high-importance memories from Browning Memory for context injection.
   * These persist across sessions and survive context compaction.
   */
  async getCoreMemories(limit: number = 10): Promise<{ topic: string; content: string; memory_type: string; importance: number; tags: string[] }[]> {
    const cacheKey = `core_memories_${limit}`;
    return this.getCached(cacheKey, CACHE_TTL_FEEDS, async () => {
      return this.querySupabase<{ topic: string; content: string; memory_type: string; importance: number; tags: string[] }>(
        `SELECT topic, content, memory_type, importance, tags
         FROM claude_memories
         WHERE is_archived = false
         ORDER BY importance DESC, created_at DESC
         LIMIT ${limit}`
      );
    });
  }

  /**
   * Generate a memory context block for injection into sessions.
   * This gives every new session immediate access to critical state.
   */
  async generateMemoryContext(): Promise<string> {
    try {
      const memories = await this.getCoreMemories(6);
      if (memories.length === 0) return '';

      const lines: string[] = [];
      lines.push('# Browning Memory — Persistent Context');
      lines.push('');
      for (const mem of memories) {
        lines.push(`## ${mem.topic} [${mem.memory_type}]`);
        lines.push(mem.content);
        lines.push('');
      }
      return lines.join('\n');
    } catch (error) {
      logger.debug('CONTENT', 'Memory context loading skipped', {}, error as Error);
      return '';
    }
  }

  /**
   * Generate a formatted content feed digest for context injection.
   * This is what gets injected into Claude sessions alongside memory observations.
   */
  async generateContentDigest(): Promise<string> {
    try {
      const [nuggets, queue, stats] = await Promise.all([
        this.getGoldenNuggets(5),
        this.getContentQueue('queued', 5),
        this.getPipelineStats()
      ]);

      const lines: string[] = [];
      lines.push('# Content Pipeline Status');
      lines.push('');
      lines.push(`| Metric | Count |`);
      lines.push(`|--------|-------|`);
      lines.push(`| Raw content | ${stats.total_raw_content} |`);
      lines.push(`| Processed | ${stats.total_processed} |`);
      lines.push(`| Golden nuggets | ${stats.total_nuggets} |`);
      lines.push(`| Queued posts | ${stats.total_queued} |`);
      lines.push(`| Library items | ${stats.total_library} |`);

      if (nuggets.length > 0) {
        lines.push('');
        lines.push('## Top Golden Nuggets');
        lines.push('');
        lines.push('| Priority | Type | Title |');
        lines.push('|----------|------|-------|');
        for (const n of nuggets) {
          lines.push(`| ${n.priority || '-'} | ${n.nugget_type} | ${n.title} |`);
        }
      }

      if (queue.length > 0) {
        lines.push('');
        lines.push('## Upcoming Scheduled Posts');
        lines.push('');
        lines.push('| Platform | Title | Scheduled |');
        lines.push('|----------|-------|-----------|');
        for (const q of queue) {
          const scheduled = q.scheduled_for
            ? new Date(q.scheduled_for).toLocaleDateString()
            : 'unscheduled';
          lines.push(`| ${q.platform} | ${q.title || q.body.substring(0, 50)} | ${scheduled} |`);
        }
      }

      return lines.join('\n');
    } catch (error) {
      logger.error('CONTENT', 'Failed to generate content digest', {}, error as Error);
      return '# Content Pipeline\n\n_Unable to load content pipeline data._';
    }
  }
}
