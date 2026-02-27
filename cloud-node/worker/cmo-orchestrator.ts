/**
 * Browning CMO Orchestrator — The Autonomous Brain
 *
 * This is the central nervous system of the Browning Digital CMO/COO agent.
 * It runs on multiple cron schedules and coordinates all revenue-driving
 * operations: content, SEO, CRO, ads, product pipeline, and reporting.
 *
 * SCOPE ENFORCEMENT:
 *   - Digital products, SEO, SERP, CRO, ads, content, dev, UI/UX, sales/marketing
 *   - Credit repair (SENTINEL/C&C) is EXPLICITLY OFF-LIMITS
 *
 * Cron schedules:
 *   Every 15 min: content queue management, RSS scrape trigger
 *   Hourly:       pipeline check, engagement pull, SEO signal processing
 *   Daily 9am:    full daily ops report
 *   Weekly Mon:   weekly strategy review + product pipeline advancement
 *
 * Deploy: cd cloud-node/worker && wrangler deploy -c wrangler-cmo.toml
 * Secrets: SUPABASE_URL, SUPABASE_KEY, CMO_AUTH_TOKEN
 */

interface Env {
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  CMO_AUTH_TOKEN?: string;
  ANTHROPIC_API_KEY?: string;
}

// ── Scope Enforcement ──────────────────────────────────────────────
const BLOCKED_DOMAINS = [
  'credit repair', 'credit-repair', 'credit_repair',
  'sentinel', 'c&c', 'dispute', 'bureau',
  'equifax', 'experian', 'transunion',
  'credit score', 'credit report', 'credit fix',
  'debt settlement', 'debt negotiation',
] as const;

const CMO_SCOPE = {
  allowed: [
    'digital_products', 'seo', 'serp', 'cro', 'ads',
    'content', 'dev', 'ui_ux', 'sales', 'marketing',
    'social_media', 'email', 'landing_pages', 'analytics',
    'product_pipeline', 'revenue_tracking', 'rss', 'scraping',
  ],
  pillars: [
    'systems_automation', 'revenue_systems', 'content_marketing',
    'founder_ops', 'web_premium',
  ],
} as const;

function isScopeViolation(text: string): boolean {
  const lower = text.toLowerCase();
  return BLOCKED_DOMAINS.some(term => lower.includes(term));
}

// ── Supabase Client ────────────────────────────────────────────────
class SupabaseClient {
  private url: string;
  private key: string;

  constructor(url: string, key: string) {
    this.url = url.replace(/\/$/, '');
    this.key = key;
  }

  private headers(extra: Record<string, string> = {}): Record<string, string> {
    return {
      'apikey': this.key,
      'Authorization': `Bearer ${this.key}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation',
      ...extra,
    };
  }

  async query(table: string, params: string = ''): Promise<any[]> {
    const sep = params ? '?' : '';
    const res = await fetch(`${this.url}/rest/v1/${table}${sep}${params}`, {
      headers: this.headers(),
    });
    if (!res.ok) throw new Error(`Supabase GET ${table}: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async insert(table: string, data: Record<string, any>): Promise<any> {
    const res = await fetch(`${this.url}/rest/v1/${table}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Supabase INSERT ${table}: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async update(table: string, params: string, data: Record<string, any>): Promise<any> {
    const res = await fetch(`${this.url}/rest/v1/${table}?${params}`, {
      method: 'PATCH',
      headers: this.headers(),
      body: JSON.stringify(data),
    });
    if (!res.ok) throw new Error(`Supabase PATCH ${table}: ${res.status} ${await res.text()}`);
    return res.json();
  }

  async rpc(fn: string, params: Record<string, any> = {}): Promise<any> {
    const res = await fetch(`${this.url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(params),
    });
    if (!res.ok) throw new Error(`Supabase RPC ${fn}: ${res.status} ${await res.text()}`);
    return res.json();
  }
}

// ── CMO Operations ─────────────────────────────────────────────────

interface CMOReport {
  revenue_today: number;
  revenue_week: number;
  revenue_month: number;
  sales_today: number;
  products_deployed: number;
  products_building: number;
  products_backlog: number;
  content_queued: number;
  content_posted_today: number;
  pending_content: number;
  failed_tasks_24h: number;
  top_performer: string | null;
  rss_feeds_active: number;
  nuggets_unpackaged: number;
}

async function gatherDailyReport(db: SupabaseClient): Promise<CMOReport> {
  const [
    revToday, revWeek, revMonth,
    productsDeployed, productsBuilding, productsBacklog,
    contentQueued, contentPostedToday, pendingContent,
    failedTasks, topPerformer, rssFeeds, nuggets,
  ] = await Promise.all([
    // Revenue
    db.query('product_sales', 'select=amount&created_at=gte.' + todayISO()).catch(() => []),
    db.query('product_sales', 'select=amount&created_at=gte.' + weekAgoISO()).catch(() => []),
    db.query('product_sales', 'select=amount&created_at=gte.' + monthAgoISO()).catch(() => []),
    // Products
    db.query('products', 'select=id&status=eq.deployed').catch(() => []),
    db.query('products', 'select=id&status=eq.building').catch(() => []),
    db.query('products', 'select=id&status=in.(draft,review)').catch(() => []),
    // Content
    db.query('content_queue', 'select=id&status=eq.queued').catch(() => []),
    db.query('content_queue', 'select=id&status=eq.posted&posted_at=gte.' + todayISO()).catch(() => []),
    db.query('raw_content', 'select=id&processing_status=eq.pending').catch(() => []),
    // System health
    db.query('cloud_node_tasks', 'select=id&status=eq.failed&created_at=gte.' + dayAgoISO()).catch(() => []),
    // Top performer
    db.query('content_queue', 'select=title,engagement&status=eq.posted&order=posted_at.desc&limit=1').catch(() => []),
    // RSS
    db.query('scraper_configs', 'select=id&is_active=eq.true').catch(() => []),
    // Unpackaged nuggets
    db.query('golden_nuggets', 'select=id&status=in.(new,reviewed)&pipeline_stage=eq.backlog').catch(() => []),
  ]);

  const sum = (rows: any[]) => rows.reduce((s, r) => s + (parseFloat(r.amount) || 0), 0);

  return {
    revenue_today: sum(revToday),
    revenue_week: sum(revWeek),
    revenue_month: sum(revMonth),
    sales_today: revToday.length,
    products_deployed: productsDeployed.length,
    products_building: productsBuilding.length,
    products_backlog: productsBacklog.length,
    content_queued: contentQueued.length,
    content_posted_today: contentPostedToday.length,
    pending_content: pendingContent.length,
    failed_tasks_24h: failedTasks.length,
    top_performer: topPerformer[0]?.title || null,
    rss_feeds_active: rssFeeds.length,
    nuggets_unpackaged: nuggets.length,
  };
}

// ── Content Pipeline Operations ────────────────────────────────────

async function checkContentPipeline(db: SupabaseClient): Promise<string[]> {
  const actions: string[] = [];

  // Check for stale queued content (queued > 2 hours, should have been posted)
  const twoHoursAgo = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const stale = await db.query('content_queue',
    `select=id,platform,title&status=eq.queued&created_at=lte.${twoHoursAgo}&limit=10`
  ).catch(() => []);

  if (stale.length > 0) {
    actions.push(`WARNING: ${stale.length} content items queued for 2+ hours without posting. Poster worker may be stuck.`);
  }

  // Check for products without recent content
  const productsNeedingContent = await db.query('products',
    'select=id,name,slug&status=eq.deployed&limit=20'
  ).catch(() => []);

  for (const product of productsNeedingContent) {
    const recentContent = await db.query('content_queue',
      `select=id&product_id=eq.${product.id}&created_at=gte.${weekAgoISO()}&limit=1`
    ).catch(() => []);

    if (recentContent.length === 0) {
      actions.push(`CONTENT GAP: Product "${product.name}" has no content in the last 7 days.`);
    }
  }

  // Check content balance (80/20 rule)
  const recentContent = await db.query('content_queue',
    `select=product_id&status=eq.posted&posted_at=gte.${weekAgoISO()}`
  ).catch(() => []);

  const promotional = recentContent.filter(c => c.product_id !== null).length;
  const total = recentContent.length || 1;
  const promoRatio = promotional / total;

  if (promoRatio > 0.3) {
    actions.push(`BALANCE WARNING: ${Math.round(promoRatio * 100)}% promotional content this week. Target is 20%. Queue more value content.`);
  }

  return actions;
}

// ── Product Pipeline Operations ────────────────────────────────────

async function checkProductPipeline(db: SupabaseClient): Promise<string[]> {
  const actions: string[] = [];

  // Check for nuggets ready to package
  const readyNuggets = await db.query('golden_nuggets',
    'select=id,title,productization_potential,estimated_value&status=in.(new,reviewed)&pipeline_stage=eq.backlog&order=priority.desc&limit=5'
  ).catch(() => []);

  if (readyNuggets.length > 0) {
    actions.push(`PRODUCT OPPORTUNITY: ${readyNuggets.length} unpackaged nuggets in backlog. Top: "${readyNuggets[0].title}"`);
  }

  // Check for stalled builds
  const stalledBuilds = await db.query('product_pipeline',
    `select=product_id,stage,started_at&stage=eq.building&started_at=lte.${threeDaysAgoISO()}`
  ).catch(() => []);

  if (stalledBuilds.length > 0) {
    actions.push(`STALLED: ${stalledBuilds.length} products stuck in "building" stage for 3+ days.`);
  }

  // Check revenue per product (identify winners to scale)
  const productRevenue = await db.query('product_sales',
    `select=product_id,product_name,amount&created_at=gte.${monthAgoISO()}`
  ).catch(() => []);

  const revenueByProduct: Record<string, { name: string; total: number; count: number }> = {};
  for (const sale of productRevenue) {
    const id = sale.product_id || 'unknown';
    if (!revenueByProduct[id]) revenueByProduct[id] = { name: sale.product_name, total: 0, count: 0 };
    revenueByProduct[id].total += parseFloat(sale.amount) || 0;
    revenueByProduct[id].count++;
  }

  const winners = Object.values(revenueByProduct)
    .filter(p => p.count >= 3)
    .sort((a, b) => b.total - a.total);

  if (winners.length > 0) {
    actions.push(`TOP SELLER: "${winners[0].name}" — $${winners[0].total.toFixed(2)} from ${winners[0].count} sales. Consider upsell/tier expansion.`);
  }

  return actions;
}

// ── RSS Feed Trigger ───────────────────────────────────────────────

async function triggerRSSIngestion(db: SupabaseClient): Promise<string> {
  // Check how many feeds are active
  const feeds = await db.query('scraper_configs',
    'select=id,name,url,scrape_type&is_active=eq.true&scrape_type=eq.rss'
  ).catch(() => []);

  if (feeds.length === 0) {
    return 'No active RSS feeds configured.';
  }

  // The rss-scraper worker handles the actual scraping on its own cron.
  // CMO just verifies it's running and flags issues.
  const recentIngests = await db.query('raw_content',
    `select=id&source_type=eq.rss&created_at=gte.${dayAgoISO()}&limit=1`
  ).catch(() => []);

  if (recentIngests.length === 0 && feeds.length > 0) {
    return `WARNING: ${feeds.length} RSS feeds active but no RSS content ingested in 24h. Check rss-scraper worker.`;
  }

  return `RSS: ${feeds.length} feeds active, ingestion running normally.`;
}

// ── SEO/SERP Analysis ──────────────────────────────────────────────

async function checkSERPMetrics(db: SupabaseClient): Promise<string[]> {
  const actions: string[] = [];

  // Check for tracked keywords and their positions
  const keywords = await db.query('serp_tracking',
    'select=keyword,current_position,previous_position,target_url,checked_at&order=checked_at.desc&limit=50'
  ).catch(() => []);

  if (keywords.length === 0) {
    actions.push('SEO: No SERP tracking data yet. serp-monitor worker will populate this.');
    return actions;
  }

  // Find improvements
  const improved = keywords.filter(k =>
    k.previous_position && k.current_position < k.previous_position
  );
  if (improved.length > 0) {
    actions.push(`SEO WIN: ${improved.length} keywords improved. Best: "${improved[0].keyword}" moved from #${improved[0].previous_position} to #${improved[0].current_position}`);
  }

  // Find drops
  const dropped = keywords.filter(k =>
    k.previous_position && k.current_position > k.previous_position + 5
  );
  if (dropped.length > 0) {
    actions.push(`SEO ALERT: ${dropped.length} keywords dropped 5+ positions. Worst: "${dropped[0].keyword}" from #${dropped[0].previous_position} to #${dropped[0].current_position}`);
  }

  // Find quick win opportunities (position 4-20, could push to page 1)
  const quickWins = keywords.filter(k =>
    k.current_position >= 4 && k.current_position <= 20
  );
  if (quickWins.length > 0) {
    actions.push(`SEO OPPORTUNITY: ${quickWins.length} keywords in striking distance (pos 4-20). Focus content on: "${quickWins[0].keyword}"`);
  }

  return actions;
}

// ── Dispatch Autonomous Task ───────────────────────────────────────

async function dispatchTask(db: SupabaseClient, prompt: string, priority: string = 'normal'): Promise<string | null> {
  // Scope check — never dispatch credit repair work
  if (isScopeViolation(prompt)) {
    console.error('SCOPE VIOLATION: Attempted to dispatch blocked task:', prompt.substring(0, 100));
    return null;
  }

  try {
    const result = await db.insert('cloud_node_tasks', {
      prompt,
      priority,
      skip_permissions: true,
      timeout_minutes: 30,
      status: 'queued',
      created_at: new Date().toISOString(),
    });

    const id = Array.isArray(result) ? result[0]?.id : result?.id;
    return id || null;
  } catch (e) {
    console.error('Failed to dispatch task:', e);
    return null;
  }
}

// ── Daily Report Writer ────────────────────────────────────────────

async function writeDailyReport(db: SupabaseClient, report: CMOReport): Promise<void> {
  const today = new Date().toISOString().split('T')[0];

  try {
    // Upsert to revenue_daily
    await db.insert('revenue_daily', {
      date: today,
      total_revenue: report.revenue_today,
      total_sales: report.sales_today,
      products_deployed: report.products_deployed,
      content_posted: report.content_posted_today,
      notes: JSON.stringify({
        revenue_week: report.revenue_week,
        revenue_month: report.revenue_month,
        content_queued: report.content_queued,
        pending_content: report.pending_content,
        failed_tasks: report.failed_tasks_24h,
        rss_feeds: report.rss_feeds_active,
        nuggets_ready: report.nuggets_unpackaged,
      }),
    }).catch(async () => {
      // If insert fails (duplicate), update instead
      await db.update('revenue_daily', `date=eq.${today}`, {
        total_revenue: report.revenue_today,
        total_sales: report.sales_today,
        products_deployed: report.products_deployed,
        content_posted: report.content_posted_today,
      });
    });
  } catch (e) {
    console.error('Failed to write daily report:', e);
  }
}

// ── Weekly Strategy Review ─────────────────────────────────────────

async function weeklyStrategyReview(db: SupabaseClient): Promise<string> {
  const actions: string[] = [];

  // Content performance this week
  const weeklyContent = await db.query('content_queue',
    `select=platform,title,engagement&status=eq.posted&posted_at=gte.${weekAgoISO()}&order=posted_at.desc`
  ).catch(() => []);

  const platformCounts: Record<string, number> = {};
  for (const c of weeklyContent) {
    platformCounts[c.platform] = (platformCounts[c.platform] || 0) + 1;
  }

  actions.push(`WEEKLY CONTENT: ${weeklyContent.length} posts across ${Object.keys(platformCounts).length} platforms`);
  for (const [platform, count] of Object.entries(platformCounts)) {
    actions.push(`  ${platform}: ${count} posts`);
  }

  // Product pipeline movement
  const pipelineMovement = await db.query('product_pipeline',
    `select=stage,product_id&started_at=gte.${weekAgoISO()}`
  ).catch(() => []);

  const stageCounts: Record<string, number> = {};
  for (const p of pipelineMovement) {
    stageCounts[p.stage] = (stageCounts[p.stage] || 0) + 1;
  }

  if (Object.keys(stageCounts).length > 0) {
    actions.push('PIPELINE MOVEMENT:');
    for (const [stage, count] of Object.entries(stageCounts)) {
      actions.push(`  ${stage}: ${count} products`);
    }
  }

  // Revenue trend (this week vs last week)
  const thisWeekRev = await db.query('product_sales',
    `select=amount&created_at=gte.${weekAgoISO()}`
  ).catch(() => []);
  const lastWeekRev = await db.query('product_sales',
    `select=amount&created_at=gte.${twoWeeksAgoISO()}&created_at=lt.${weekAgoISO()}`
  ).catch(() => []);

  const thisTotal = thisWeekRev.reduce((s: number, r: any) => s + (parseFloat(r.amount) || 0), 0);
  const lastTotal = lastWeekRev.reduce((s: number, r: any) => s + (parseFloat(r.amount) || 0), 0);

  if (lastTotal > 0) {
    const change = ((thisTotal - lastTotal) / lastTotal * 100).toFixed(1);
    actions.push(`REVENUE TREND: $${thisTotal.toFixed(2)} this week vs $${lastTotal.toFixed(2)} last week (${parseFloat(change) >= 0 ? '+' : ''}${change}%)`);
  } else {
    actions.push(`REVENUE: $${thisTotal.toFixed(2)} this week`);
  }

  return actions.join('\n');
}

// ── Auto-generate Content Tasks ────────────────────────────────────

async function autoGenerateContent(db: SupabaseClient): Promise<string | null> {
  // Find products that need content
  const products = await db.query('products',
    'select=id,name,description,tier,price,pillar,landing_page_url&status=eq.deployed&limit=5'
  ).catch(() => []);

  if (products.length === 0) return null;

  // Check which products have no content this week
  const needsContent: typeof products = [];
  for (const product of products) {
    const recent = await db.query('content_queue',
      `select=id&product_id=eq.${product.id}&created_at=gte.${weekAgoISO()}&limit=1`
    ).catch(() => []);

    if (recent.length === 0) {
      needsContent.push(product);
    }
  }

  if (needsContent.length === 0) return null;

  // Get gold content for inspiration
  const goldContent = await db.query('v2_gold_content',
    'select=title,summary,content_pillars,score&status=eq.candidate&order=score.desc&limit=5'
  ).catch(() => []);

  const prompt = `## Auto Content Generation Task (CMO Orchestrator)

Generate social media content for products that need promotion this week.

### Products needing content:
${needsContent.map(p => `- **${p.name}** (${p.tier}, $${p.price}) — ${p.pillar}\n  Landing: ${p.landing_page_url || 'needs page'}\n  Description: ${p.description || 'none'}`).join('\n')}

### Gold content for inspiration:
${goldContent.map(g => `- "${g.title}" (score: ${g.score}, pillars: ${(g.content_pillars || []).join(', ')})\n  ${g.summary || ''}`).join('\n')}

### Rules:
- 80% value content, 20% promotional
- Each product gets 2-3 social posts (Twitter thread + LinkedIn post minimum)
- Include hooks, key takeaways, and natural CTAs
- Never mention credit repair, credit scores, or debt — stay in CMO scope
- Queue all content into content_queue table with status 'queued'

### Platforms to target:
- Twitter/X: Threads and hot takes (2-3x per product)
- LinkedIn: Framework posts and case studies (1x per product)

Generate the SQL INSERT statements for content_queue.`;

  return prompt;
}

// ── Date Utilities ─────────────────────────────────────────────────

function todayISO(): string {
  return new Date().toISOString().split('T')[0] + 'T00:00:00Z';
}

function dayAgoISO(): string {
  return new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
}

function weekAgoISO(): string {
  return new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
}

function twoWeeksAgoISO(): string {
  return new Date(Date.now() - 14 * 24 * 60 * 60 * 1000).toISOString();
}

function monthAgoISO(): string {
  return new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
}

function threeDaysAgoISO(): string {
  return new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
}

// ── Cron Handler ───────────────────────────────────────────────────

type CronFrequency = 'every_15_min' | 'hourly' | 'daily' | 'weekly';

function classifyCron(cron: string): CronFrequency {
  // */15 * * * * → every 15 min
  if (cron.includes('*/15')) return 'every_15_min';
  // 0 * * * * → hourly
  if (cron.match(/^0 \* \* \* \*$/)) return 'hourly';
  // 0 9 * * 1 → weekly (Monday 9am)
  if (cron.match(/^\d+ \d+ \* \* 1$/)) return 'weekly';
  // 0 9 * * * → daily
  if (cron.match(/^\d+ \d+ \* \* \*$/)) return 'daily';
  return 'hourly'; // default
}

async function handleCron(cron: string, env: Env): Promise<void> {
  const db = new SupabaseClient(env.SUPABASE_URL, env.SUPABASE_KEY);
  const frequency = classifyCron(cron);
  const results: string[] = [`CMO Orchestrator — ${frequency} cycle — ${new Date().toISOString()}`];

  try {
    switch (frequency) {
      case 'every_15_min': {
        // Light check: content queue health, stale items
        const pipeline = await checkContentPipeline(db);
        results.push(...pipeline);

        // RSS status
        const rss = await triggerRSSIngestion(db);
        results.push(rss);
        break;
      }

      case 'hourly': {
        // Medium check: pipeline, SERP, content gaps
        const pipeline = await checkContentPipeline(db);
        results.push(...pipeline);

        const product = await checkProductPipeline(db);
        results.push(...product);

        const serp = await checkSERPMetrics(db);
        results.push(...serp);

        // Auto-generate content if needed
        const contentPrompt = await autoGenerateContent(db);
        if (contentPrompt) {
          const taskId = await dispatchTask(db, contentPrompt, 'normal');
          if (taskId) {
            results.push(`AUTO-CONTENT: Dispatched content generation task ${taskId}`);
          }
        }
        break;
      }

      case 'daily': {
        // Full daily ops: report, revenue snapshot, all checks
        const report = await gatherDailyReport(db);
        results.push(
          `REVENUE: $${report.revenue_today.toFixed(2)} today | $${report.revenue_week.toFixed(2)} this week | $${report.revenue_month.toFixed(2)} this month`,
          `SALES: ${report.sales_today} today`,
          `PIPELINE: ${report.products_deployed} deployed | ${report.products_building} building | ${report.products_backlog} backlog`,
          `CONTENT: ${report.content_posted_today} posted today | ${report.content_queued} queued`,
          `HEALTH: ${report.failed_tasks_24h} failed tasks (24h) | ${report.pending_content} content pending processing`,
          `RSS: ${report.rss_feeds_active} feeds active`,
          `NUGGETS: ${report.nuggets_unpackaged} unpackaged (ready for product creation)`,
          report.top_performer ? `TOP PERFORMER: ${report.top_performer}` : 'No top performer data yet',
        );

        await writeDailyReport(db, report);

        // Run all subsystem checks
        const pipeline = await checkContentPipeline(db);
        results.push(...pipeline);
        const product = await checkProductPipeline(db);
        results.push(...product);
        const serp = await checkSERPMetrics(db);
        results.push(...serp);

        // Dispatch content generation if gaps found
        const contentPrompt = await autoGenerateContent(db);
        if (contentPrompt) {
          const taskId = await dispatchTask(db, contentPrompt, 'high');
          if (taskId) results.push(`AUTO-CONTENT: Dispatched content generation task ${taskId}`);
        }

        // If there are unpackaged nuggets and no products building, dispatch product creation
        if (report.nuggets_unpackaged > 0 && report.products_building === 0) {
          const nuggetPrompt = `## Auto Product Creation Task (CMO Orchestrator)

Pick the highest-priority unpackaged golden nugget and create a Micro/Starter tier product from it.

Follow the package-nugget workflow:
1. SELECT the top nugget from golden_nuggets (pipeline_stage='backlog', status in new/reviewed)
2. RESEARCH supporting content from raw_content and v2_gold_content
3. BUILD the product (guide/template/checklist)
4. DEPLOY landing page on Cloudflare Pages
5. SET UP checkout via sales-engine
6. QUEUE 5 social posts for launch
7. UPDATE golden_nuggets and product_pipeline tables

SCOPE: Digital products only. Never touch credit repair, debt, or bureau-related content.`;

          const taskId = await dispatchTask(db, nuggetPrompt, 'normal');
          if (taskId) results.push(`AUTO-PRODUCT: Dispatched product creation task ${taskId}`);
        }
        break;
      }

      case 'weekly': {
        // Full weekly review
        const review = await weeklyStrategyReview(db);
        results.push(review);

        // Also run daily checks
        const report = await gatherDailyReport(db);
        results.push(
          `WEEKLY SNAPSHOT:`,
          `  Revenue: $${report.revenue_month.toFixed(2)} (30d)`,
          `  Products: ${report.products_deployed} live`,
          `  Nuggets: ${report.nuggets_unpackaged} ready to package`,
        );

        await writeDailyReport(db, report);
        break;
      }
    }
  } catch (e) {
    results.push(`ERROR: ${e instanceof Error ? e.message : String(e)}`);
  }

  // Log the CMO cycle to claude_events
  try {
    await db.insert('claude_events', {
      description: results.join('\n'),
      event_type: frequency === 'daily' ? 'milestone' : 'action',
      importance: frequency === 'daily' || frequency === 'weekly' ? 'high' : 'low',
      metadata: { source: 'cmo-orchestrator', frequency, timestamp: new Date().toISOString() },
    });
  } catch (e) {
    // Non-fatal — don't fail the whole cycle over logging
    console.error('Failed to log CMO event:', e);
  }

  console.log(results.join('\n'));
}

// ── HTTP Handler (status dashboard + manual triggers) ──────────────

async function handleHTTP(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  // Health check
  if (path === '/health') {
    return new Response(JSON.stringify({
      status: 'ok',
      worker: 'cmo-orchestrator',
      scope: CMO_SCOPE.allowed,
      blocked: BLOCKED_DOMAINS.slice(0, 5),
      timestamp: new Date().toISOString(),
    }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Auth check for all other routes
  const auth = request.headers.get('Authorization');
  if (!env.CMO_AUTH_TOKEN || auth !== `Bearer ${env.CMO_AUTH_TOKEN}`) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const db = new SupabaseClient(env.SUPABASE_URL, env.SUPABASE_KEY);

  // Status dashboard
  if (path === '/status' || path === '/') {
    const report = await gatherDailyReport(db);
    return new Response(JSON.stringify(report, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Manual trigger
  if (path === '/trigger' && request.method === 'POST') {
    const body = await request.json() as { frequency?: string };
    const freq = body.frequency || 'hourly';
    const fakeCron = freq === 'daily' ? '0 9 * * *' :
                     freq === 'weekly' ? '0 9 * * 1' :
                     freq === '15min' ? '*/15 * * * *' : '0 * * * *';

    // Run async — don't block the response
    const ctx = { waitUntil: (p: Promise<any>) => p };
    ctx.waitUntil(handleCron(fakeCron, env));

    return new Response(JSON.stringify({ triggered: freq, timestamp: new Date().toISOString() }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // Scope check endpoint
  if (path === '/scope-check' && request.method === 'POST') {
    const body = await request.json() as { text: string };
    const violation = isScopeViolation(body.text || '');
    return new Response(JSON.stringify({ text: body.text, violation, scope: CMO_SCOPE }), {
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
    ctx.waitUntil(handleCron(event.cron, env));
  },
};
