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
import { logger } from '../../../../utils/logger.js';

const CONTENT_INGEST_HEALTH_URL = 'https://content-ingest.devin-b58.workers.dev/health';
const CONTENT_EXTRACTOR_BASE = 'https://content-extractor.devin-b58.workers.dev';

export class ContentRoutes extends BaseRouteHandler {
  constructor(
    private contentService: ContentIngestService
  ) {
    super();
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
   * Proxies to the content-extractor worker: extract → store → return link
   */
  private handleShare = this.wrapHandler(async (req: Request, res: Response): Promise<void> => {
    const { url, title, source } = req.body;

    if (!url) {
      this.badRequest(res, 'url is required');
      return;
    }

    logger.info('CONTENT', 'Share received', { url, title, source });

    try {
      // Step 1: Extract content from URL
      const extractRes = await fetch(
        `${CONTENT_EXTRACTOR_BASE}/api/extract?url=${encodeURIComponent(url)}`
      );

      if (!extractRes.ok) {
        const errorText = await extractRes.text();
        res.status(extractRes.status).json({
          success: false,
          error: `Extraction failed: ${errorText}`
        });
        return;
      }

      const extracted = await extractRes.json() as Record<string, any>;

      // Step 2: Store the extracted content
      const storeRes = await fetch(`${CONTENT_EXTRACTOR_BASE}/api/upload-url`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url,
          title: title || extracted.title || url,
          content: extracted.content || '',
          content_type: extracted.content_type || 'article',
          metadata: {
            ...extracted.metadata,
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
        title: stored.title || extracted.title || url,
        link: stored.link,
        content_type: stored.content_type || extracted.content_type,
        content_length: stored.content_length
      });
    } catch (error) {
      logger.error('CONTENT', 'Share processing failed', { url }, error as Error);
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
}
