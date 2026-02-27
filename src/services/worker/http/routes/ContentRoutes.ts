/**
 * Content Routes
 *
 * HTTP API routes bridging claude-mem to the Browning Digital content pipeline.
 * Exposes RSS feeds, golden nuggets, content queue, and pipeline stats.
 *
 * Endpoints:
 * - GET /api/content/feed      — Full content feed summary (configs + recent + nuggets + queue + stats)
 * - GET /api/content/digest    — Formatted digest for context injection
 * - GET /api/content/raw       — Raw content items (paginated)
 * - GET /api/content/nuggets   — Golden nuggets (filterable by stage)
 * - GET /api/content/queue     — Content queue (filterable by status)
 * - GET /api/content/library   — Content library
 * - GET /api/content/search    — Search raw content and nuggets
 * - GET /api/content/stats     — Pipeline statistics
 * - GET /api/content/scrapers  — Scraper configs (RSS, Reddit, Twitter)
 * - GET /api/content/health    — Content-ingest worker health check
 */

import express, { Request, Response } from 'express';
import { BaseRouteHandler } from '../BaseRouteHandler.js';
import { ContentIngestService } from '../../ContentIngestService.js';
import { ContentScraperService } from '../../ContentScraperService.js';
import { extractSocialContent, detectPlatform } from '../../SocialMediaExtractor.js';
import { logger } from '../../../../utils/logger.js';

const CONTENT_INGEST_HEALTH_URL = 'https://content-ingest.devin-b58.workers.dev/health';
const CONTENT_EXTRACTOR_BASE = 'https://content-extractor.devin-b58.workers.dev';

export class ContentRoutes extends BaseRouteHandler {
  private scraperService: ContentScraperService;

  constructor(
    private contentService: ContentIngestService
  ) {
    super();
    this.scraperService = new ContentScraperService();
  }

  setupRoutes(app: express.Application): void {
    app.get('/api/content/feed', this.handleGetFeed.bind(this));
    app.get('/api/content/digest', this.handleGetDigest.bind(this));
    app.get('/api/content/raw', this.handleGetRawContent.bind(this));
    app.get('/api/content/nuggets', this.handleGetNuggets.bind(this));
    app.get('/api/content/queue', this.handleGetQueue.bind(this));
    app.get('/api/content/library', this.handleGetLibrary.bind(this));
    app.get('/api/content/search', this.handleSearch.bind(this));
    app.get('/api/content/stats', this.handleGetStats.bind(this));
    app.get('/api/content/scrapers', this.handleGetScrapers.bind(this));
    app.get('/api/content/health', this.handleHealthCheck.bind(this));
    app.post('/api/content/cache/clear', this.handleClearCache.bind(this));

    // Share endpoint (iOS Share Sheet / mobile-first)
    app.post('/api/content/share', this.handleShare.bind(this));
    app.get('/api/content/share', this.handleShareGet.bind(this));

    // Scraper trigger endpoints
    app.post('/api/content/scrape', this.handleScrapeAll.bind(this));
    app.post('/api/content/scrape/:type', this.handleScrapeSingle.bind(this));
    app.get('/api/content/scraper-status', this.handleScraperStatus.bind(this));

    // Oracle COO/CMO agent endpoints
    app.get('/api/oracle/dashboard', this.handleOracleDashboard.bind(this));
    app.post('/api/oracle/scrape', this.handleOracleScrape.bind(this));
    app.get('/api/oracle/opportunities', this.handleOracleOpportunities.bind(this));
    app.post('/api/oracle/promote', this.handleOraclePromote.bind(this));
    app.post('/api/oracle/config', this.handleOracleConfig.bind(this));
  }

  /**
   * GET /api/content/feed — Full content feed summary
   */
  private handleGetFeed = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const summary = await this.contentService.getContentFeedSummary();
    res.json(summary);
  });

  /**
   * GET /api/content/digest — Formatted content digest for context injection
   */
  private handleGetDigest = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const digest = await this.contentService.generateContentDigest();
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    res.send(digest);
  });

  /**
   * GET /api/content/raw?limit=20&source_type=url_fetch
   */
  private handleGetRawContent = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);
    const sourceType = req.query.source_type as string | undefined;
    const items = await this.contentService.getRecentContent(limit, sourceType);
    res.json({ items, count: items.length });
  });

  /**
   * GET /api/content/nuggets?limit=20&stage=research
   */
  private handleGetNuggets = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);
    const stage = req.query.stage as string | undefined;
    const nuggets = await this.contentService.getGoldenNuggets(limit, stage);
    res.json({ nuggets, count: nuggets.length });
  });

  /**
   * GET /api/content/queue?status=queued&limit=20
   */
  private handleGetQueue = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);
    const status = req.query.status as string | undefined;
    const items = await this.contentService.getContentQueue(status, limit);
    res.json({ items, count: items.length });
  });

  /**
   * GET /api/content/library?limit=20
   */
  private handleGetLibrary = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const limit = Math.min(parseInt(req.query.limit as string, 10) || 20, 100);
    const items = await this.contentService.getContentLibrary(limit);
    res.json({ items, count: items.length });
  });

  /**
   * GET /api/content/search?query=...&limit=10
   * Searches across raw_content and golden_nuggets
   */
  private handleSearch = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const query = req.query.query as string;
    if (!query) {
      this.badRequest(res, 'query parameter is required');
      return;
    }

    const limit = Math.min(parseInt(req.query.limit as string, 10) || 10, 50);

    const [contentResults, nuggetResults] = await Promise.all([
      this.contentService.searchContent(query, limit),
      this.contentService.searchNuggets(query, limit)
    ]);

    res.json({
      content: { items: contentResults, count: contentResults.length },
      nuggets: { items: nuggetResults, count: nuggetResults.length }
    });
  });

  /**
   * GET /api/content/stats — Pipeline statistics
   */
  private handleGetStats = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const stats = await this.contentService.getPipelineStats();
    res.json(stats);
  });

  /**
   * GET /api/content/scrapers — Scraper configurations
   */
  private handleGetScrapers = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const configs = await this.contentService.getScraperConfigs();
    res.json({ configs, count: configs.length });
  });

  /**
   * GET /api/content/health — Check content-ingest worker health
   */
  private handleHealthCheck = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    try {
      const response = await fetch(CONTENT_INGEST_HEALTH_URL);
      if (!response.ok) {
        res.json({
          status: 'unhealthy',
          worker_status: response.status,
          message: `Content-ingest worker returned ${response.status}`
        });
        return;
      }

      const workerHealth = await response.json();
      const stats = await this.contentService.getPipelineStats();

      res.json({
        status: 'healthy',
        content_ingest_worker: workerHealth,
        pipeline_stats: stats
      });
    } catch (error) {
      logger.error('CONTENT', 'Health check failed', {}, error as Error);
      res.json({
        status: 'unreachable',
        message: 'Content-ingest worker is unreachable',
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  /**
   * POST /api/content/cache/clear — Clear content cache
   */
  private handleClearCache = this.wrapHandler((req: Request, res: Response): void => {
    this.contentService.clearCache();
    logger.info('CONTENT', 'Content cache cleared');
    res.json({ success: true, message: 'Content cache cleared' });
  });

  /**
   * POST /api/content/share — Share a URL from iOS Share Sheet / mobile
   * Body: { url: string, title?: string, source?: string }
   *
   * Flow:
   * 1. Detect if URL is a social media platform (Instagram, Facebook, Twitter, etc.)
   * 2. If social: use built-in SocialMediaExtractor (oEmbed, embed pages, alt frontends)
   * 3. If not social or social extraction fails: fall back to Jina via content-extractor worker
   * 4. Store extracted content via content-extractor /api/upload-url
   */
  private handleShare = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const { url, title, source } = req.body;

    if (!url) {
      this.badRequest(res, 'url is required');
      return;
    }

    const platform = detectPlatform(url);
    logger.info('CONTENT', 'Share received', { url, title, source, platform: platform || 'non-social' });

    try {
      let extractedTitle: string = title || url;
      let extractedContent: string = '';
      let extractedContentType: string = 'article';
      let extractedMetadata: Record<string, any> = {};

      // Step 1: Try social media extraction first (if applicable)
      if (platform) {
        const socialResult = await extractSocialContent(url);
        if (socialResult) {
          extractedTitle = title || socialResult.title;
          extractedContent = socialResult.content;
          extractedContentType = socialResult.content_type;
          extractedMetadata = socialResult.metadata;
          logger.info('CONTENT', `Social extraction succeeded for ${platform}`, {
            method: socialResult.metadata.extraction_method,
            content_length: socialResult.content.length,
          });
        } else {
          logger.warn('CONTENT', `Social extraction failed for ${platform}, falling back to Jina`, { url });
        }
      }

      // Step 2: Fall back to Jina/content-extractor if not social or social extraction failed
      if (!extractedContent) {
        const extractRes = await fetch(
          `${CONTENT_EXTRACTOR_BASE}/api/extract?url=${encodeURIComponent(url)}`
        );

        if (!extractRes.ok) {
          const errorText = await extractRes.text();
          res.status(extractRes.status).json({
            success: false,
            error: `Extraction failed: ${errorText}`,
            platform: platform || undefined,
          });
          return;
        }

        const extracted = await extractRes.json() as Record<string, any>;
        extractedTitle = title || extracted.title || url;
        extractedContent = extracted.content || '';
        extractedContentType = extracted.content_type || 'article';
        extractedMetadata = extracted.metadata || {};
      }

      // Step 3: Store the extracted content
      const storeRes = await fetch(`${CONTENT_EXTRACTOR_BASE}/api/upload-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          title: extractedTitle,
          content: extractedContent,
          content_type: extractedContentType,
          metadata: {
            ...extractedMetadata,
            shared_from: source || 'ios-share-sheet',
            shared_at: new Date().toISOString()
          }
        })
      });

      if (!storeRes.ok) {
        const errorText = await storeRes.text();
        res.status(storeRes.status).json({
          success: false,
          error: `Storage failed: ${errorText}`
        });
        return;
      }

      const stored = await storeRes.json() as Record<string, any>;

      res.json({
        success: true,
        id: stored.id,
        title: stored.title || extractedTitle,
        link: stored.link,
        content_type: stored.content_type || extractedContentType,
        content_length: stored.content_length,
        platform: platform || undefined,
        extraction_method: extractedMetadata.extraction_method || 'jina',
      });
    } catch (error) {
      logger.error('CONTENT', 'Share processing failed', { url, platform: platform || 'non-social' }, error as Error);
      res.status(500).json({
        success: false,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  });

  /**
   * GET /api/content/share?url=... — Share via GET (for iOS Shortcuts that use GET)
   */
  private handleShareGet = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const url = req.query.url as string;
    const title = req.query.title as string | undefined;
    const source = (req.query.source as string) || 'ios-shortcut';

    if (!url) {
      this.badRequest(res, 'url query parameter is required');
      return;
    }

    // Delegate to POST handler logic
    req.body = { url, title, source };
    await this.handleShare(req, res);
  });

  // ============================================================================
  // Scraper Trigger Endpoints
  // ============================================================================

  /**
   * POST /api/content/scrape — Trigger full scrape across all active configs
   */
  private handleScrapeAll = this.wrapHandler(async (_req: Request, res: Response): Promise<void> => {
    logger.info('CONTENT', 'Full scrape triggered');
    const results = await this.scraperService.runAll();
    this.contentService.clearCache();
    res.json({ success: true, results });
  });

  /**
   * POST /api/content/scrape/:type — Trigger a specific scraper (rss, threads, twitter, reddit)
   */
  private handleScrapeSingle = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const type = req.params.type;
    logger.info('CONTENT', `Single scrape triggered: ${type}`);
    const result = await this.scraperService.runSingle(type);
    this.contentService.clearCache();
    res.json({ success: true, result });
  });

  /**
   * GET /api/content/scraper-status — All scraper configs with last_run + items_collected
   */
  private handleScraperStatus = this.wrapHandler(async (_req: Request, res: Response): Promise<void> => {
    const configs = await this.contentService.getScraperConfigs();
    res.json({
      configs: configs.map(c => ({
        id: c.id,
        name: c.name,
        status: c.status,
        last_run: c.last_run,
        items_collected: c.items_collected,
        error_count: c.error_count,
      })),
      count: configs.length
    });
  });

  // ============================================================================
  // Oracle COO/CMO Agent Endpoints
  // ============================================================================

  /**
   * GET /api/oracle/dashboard — Full pipeline status for oracle agent decision-making
   */
  private handleOracleDashboard = this.wrapHandler(async (_req: Request, res: Response): Promise<void> => {
    const [stats, scraperConfigs, recentGold, queue, nuggets] = await Promise.all([
      this.contentService.getPipelineStats(),
      this.contentService.getScraperConfigs(),
      this.contentService.getRecentContent(20, undefined),
      this.contentService.getContentQueue('queued', 10),
      this.contentService.getGoldenNuggets(10),
    ]);

    // Filter to gold/silver tier content
    const goldContent = recentGold.filter(c => {
      const tier = (c.metadata as any)?.score_tier;
      return tier === 'gold' || tier === 'silver';
    });

    res.json({
      pipeline_stats: stats,
      scraper_status: scraperConfigs.map(c => ({
        id: c.id, name: c.name, status: c.status,
        last_run: c.last_run, items_collected: c.items_collected, error_count: c.error_count
      })),
      top_content: goldContent.slice(0, 10).map(c => ({
        id: c.id, source_type: c.source_type,
        title: (c.metadata as any)?.title,
        score: (c.metadata as any)?.score,
        tier: (c.metadata as any)?.score_tier,
        pillars: (c.metadata as any)?.pillar_tags,
        opportunity: (c.metadata as any)?.product_opportunity,
        created_at: c.created_at,
      })),
      queued_posts: queue,
      recent_nuggets: nuggets.slice(0, 5),
      timestamp: new Date().toISOString()
    });
  });

  /**
   * POST /api/oracle/scrape — Oracle-triggered scrape with optional targeting
   * Body: { type?: string, priority?: 'high'|'normal', terms?: string[] }
   */
  private handleOracleScrape = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const { type } = req.body;
    logger.info('CONTENT', 'Oracle scrape triggered', { type });

    if (type) {
      const result = await this.scraperService.runSingle(type);
      this.contentService.clearCache();
      res.json({ success: true, result });
    } else {
      const results = await this.scraperService.runAll();
      this.contentService.clearCache();
      res.json({ success: true, results });
    }
  });

  /**
   * GET /api/oracle/opportunities — Scored opportunities for oracle decision-making
   * Returns gold/silver tier content with pain signals and buying intent
   */
  private handleOracleOpportunities = this.wrapHandler(async (_req: Request, res: Response): Promise<void> => {
    const content = await this.contentService.getRecentContent(50);
    const opportunities = content
      .filter(c => {
        const meta = c.metadata as any;
        return meta?.score_tier === 'gold' || meta?.score_tier === 'silver';
      })
      .map(c => {
        const meta = c.metadata as any;
        return {
          id: c.id,
          title: meta?.title,
          url: meta?.url,
          score: meta?.score,
          tier: meta?.score_tier,
          pillars: meta?.pillar_tags,
          pain_signals: meta?.pain_signals,
          opportunity: meta?.product_opportunity,
          has_buying_intent: meta?.has_buying_intent,
          source_type: c.source_type,
          word_count: c.word_count,
          created_at: c.created_at,
        };
      })
      .sort((a, b) => (b.score || 0) - (a.score || 0));

    res.json({ opportunities, count: opportunities.length });
  });

  /**
   * POST /api/oracle/promote — Promote a raw_content item or nugget to content_queue
   * Body: { content_id: string, platform: string, post_body?: string, scheduled_for?: string }
   */
  private handleOraclePromote = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const { content_id, platform, post_body, scheduled_for } = req.body;
    if (!content_id || !platform) {
      this.badRequest(res, 'content_id and platform are required');
      return;
    }

    // This inserts directly via SQL since ContentIngestService doesn't have a queue insert method
    const MGMT_API_URL = 'https://api.supabase.com/v1/projects/wcdyvukzlxxkgvxomaxr/database/query';
    const MGMT_API_KEY = 'sbp_77f3a4025505ccf2e7dfa518913224b79fab3dd1';

    const body = (post_body || '').replace(/'/g, "''");
    const scheduled = scheduled_for ? `'${scheduled_for}'` : 'NULL';

    const response = await fetch(MGMT_API_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${MGMT_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `INSERT INTO content_queue (platform, body, status, scheduled_for, metadata) VALUES ('${platform.replace(/'/g, "''")}', '${body}', 'queued', ${scheduled}, '{"promoted_from": "${content_id}", "promoted_by": "oracle"}'::jsonb) RETURNING id`
      })
    });

    const result = await response.json();
    logger.info('CONTENT', 'Oracle promoted content to queue', { content_id, platform });
    res.json({ success: true, queued: result });
  });

  /**
   * POST /api/oracle/config — Update scraper config dynamically
   * Body: { scraper_id: string, updates: { accounts?: string[], search_terms?: string[] } }
   */
  private handleOracleConfig = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const { scraper_id, updates } = req.body;
    if (!scraper_id || !updates) {
      this.badRequest(res, 'scraper_id and updates are required');
      return;
    }

    const MGMT_API_URL = 'https://api.supabase.com/v1/projects/wcdyvukzlxxkgvxomaxr/database/query';
    const MGMT_API_KEY = 'sbp_77f3a4025505ccf2e7dfa518913224b79fab3dd1';

    const setClauses: string[] = [];
    if (updates.accounts) {
      setClauses.push(`config = jsonb_set(config, '{accounts}', '${JSON.stringify(updates.accounts).replace(/'/g, "''")}'::jsonb)`);
    }
    if (updates.search_terms) {
      setClauses.push(`config = jsonb_set(config, '{search_terms}', '${JSON.stringify(updates.search_terms).replace(/'/g, "''")}'::jsonb)`);
    }

    if (setClauses.length === 0) {
      this.badRequest(res, 'No valid updates provided (accounts or search_terms)');
      return;
    }

    await fetch(MGMT_API_URL, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${MGMT_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        query: `UPDATE scraper_configs SET ${setClauses.join(', ')} WHERE id = '${scraper_id.replace(/'/g, "''")}'`
      })
    });

    logger.info('CONTENT', 'Oracle updated scraper config', { scraper_id, updates: Object.keys(updates) });
    res.json({ success: true, scraper_id, updated: Object.keys(updates) });
  });
}
