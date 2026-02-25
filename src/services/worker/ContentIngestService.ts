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
        ? `WHERE source_type = '${sourceType}'`
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
        ? `WHERE pipeline_stage = '${stage}'`
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
        ? `WHERE status = '${status}'`
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
  // Formatted output for MCP/context injection
  // ============================================================================

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
