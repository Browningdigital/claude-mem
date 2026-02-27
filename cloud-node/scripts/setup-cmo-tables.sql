-- ============================================================
-- BROWNING CMO AGENT — Database Migration
-- ============================================================
-- Creates tables for the CMO/COO autonomous agent system:
--   - serp_tracking: keyword ranking monitoring
--   - serp_history: historical position data
--   - cmo_reports: daily/weekly CMO reports
--   - Seed data for scraper_configs (RSS feeds)
--   - Seed data for serp_tracking (initial keywords)
--
-- Run AFTER setup-product-pipeline.sql and setup-missing-tables.sql.
-- ============================================================

-- ── SERP Tracking ──
-- Tracks keyword positions in search results
CREATE TABLE IF NOT EXISTS serp_tracking (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    keyword                 TEXT NOT NULL,
    target_url              TEXT NOT NULL,
    current_position        INTEGER,
    previous_position       INTEGER,
    best_position           INTEGER,
    is_active               BOOLEAN DEFAULT true,
    check_frequency_hours   INTEGER DEFAULT 6,
    checked_at              TIMESTAMPTZ,
    metadata                JSONB DEFAULT '{}',
    created_at              TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_serp_tracking_keyword_url
    ON serp_tracking(keyword, target_url);
CREATE INDEX IF NOT EXISTS idx_serp_tracking_active
    ON serp_tracking(is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_serp_tracking_position
    ON serp_tracking(current_position ASC NULLS LAST);

ALTER TABLE serp_tracking ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full access serp_tracking" ON serp_tracking
    FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE serp_tracking IS 'SERP keyword tracking for Browning Digital CMO agent. Monitored by serp-monitor worker.';

-- ── SERP History ──
-- Historical record of every position check
CREATE TABLE IF NOT EXISTS serp_history (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    keyword_id      UUID REFERENCES serp_tracking(id) ON DELETE CASCADE,
    keyword         TEXT NOT NULL,
    target_url      TEXT NOT NULL,
    position        INTEGER,
    source          TEXT,  -- 'valueserp', 'google_direct', etc.
    top_results     JSONB DEFAULT '[]',
    checked_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_serp_history_keyword
    ON serp_history(keyword_id, checked_at DESC);
CREATE INDEX IF NOT EXISTS idx_serp_history_date
    ON serp_history(checked_at DESC);

ALTER TABLE serp_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full access serp_history" ON serp_history
    FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE serp_history IS 'Historical SERP position data for trend analysis.';

-- ── CMO Reports ──
-- Stores daily/weekly CMO reports for dashboard and historical review
CREATE TABLE IF NOT EXISTS cmo_reports (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    report_type     TEXT NOT NULL CHECK (report_type IN ('daily', 'weekly', 'monthly', 'adhoc')),
    report_date     DATE NOT NULL,
    revenue_data    JSONB DEFAULT '{}',
    pipeline_data   JSONB DEFAULT '{}',
    content_data    JSONB DEFAULT '{}',
    serp_data       JSONB DEFAULT '{}',
    actions_taken   JSONB DEFAULT '[]',
    summary         TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_cmo_reports_date_type
    ON cmo_reports(report_date, report_type);
CREATE INDEX IF NOT EXISTS idx_cmo_reports_date
    ON cmo_reports(report_date DESC);

ALTER TABLE cmo_reports ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role full access cmo_reports" ON cmo_reports
    FOR ALL USING (auth.role() = 'service_role');

COMMENT ON TABLE cmo_reports IS 'CMO agent daily/weekly reports for Browning Digital.';

-- ── Add missing columns to scraper_configs if they don't exist ──
ALTER TABLE scraper_configs ADD COLUMN IF NOT EXISTS scrape_type TEXT DEFAULT 'rss';
ALTER TABLE scraper_configs ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;
ALTER TABLE scraper_configs ADD COLUMN IF NOT EXISTS last_scraped_at TIMESTAMPTZ;
ALTER TABLE scraper_configs ADD COLUMN IF NOT EXISTS scrape_interval_minutes INTEGER DEFAULT 30;

-- ── Seed RSS Feeds ──
-- Default feeds for the Browning Digital content pillars
-- These are high-quality sources for systems_automation, revenue_systems, content_marketing, founder_ops, web_premium

INSERT INTO scraper_configs (name, url, scrape_type, is_active, scrape_interval_minutes, metadata)
VALUES
    -- AI & Automation (systems_automation pillar)
    ('Hacker News - AI', 'https://hnrss.org/newest?q=AI+agent+automation&points=50', 'rss', true, 60,
     '{"pillar": "systems_automation", "priority": "high"}'),
    ('Simon Willison Blog', 'https://simonwillison.net/atom/everything/', 'rss', true, 120,
     '{"pillar": "systems_automation", "priority": "high"}'),
    ('The Batch (Andrew Ng)', 'https://www.deeplearning.ai/the-batch/feed/', 'rss', true, 360,
     '{"pillar": "systems_automation", "priority": "medium"}'),

    -- Revenue & Business (revenue_systems pillar)
    ('Indie Hackers', 'https://www.indiehackers.com/feed.xml', 'rss', true, 120,
     '{"pillar": "revenue_systems", "priority": "high"}'),
    ('SaaS Club', 'https://saasclub.io/feed/', 'rss', true, 360,
     '{"pillar": "revenue_systems", "priority": "medium"}'),

    -- Content Marketing (content_marketing pillar)
    ('Ahrefs Blog', 'https://ahrefs.com/blog/feed/', 'rss', true, 360,
     '{"pillar": "content_marketing", "priority": "high"}'),
    ('Moz Blog', 'https://moz.com/blog/feed', 'rss', true, 360,
     '{"pillar": "content_marketing", "priority": "medium"}'),

    -- Founder Ops (founder_ops pillar)
    ('Paul Graham Essays', 'http://www.aaronsw.com/2002/feeds/pgessays.rss', 'rss', true, 1440,
     '{"pillar": "founder_ops", "priority": "high"}'),

    -- Web & Dev (web_premium pillar)
    ('Cloudflare Blog', 'https://blog.cloudflare.com/rss/', 'rss', true, 360,
     '{"pillar": "web_premium", "priority": "high"}'),
    ('Supabase Blog', 'https://supabase.com/blog/rss.xml', 'rss', true, 360,
     '{"pillar": "web_premium", "priority": "high"}'),
    ('Vercel Blog', 'https://vercel.com/atom', 'rss', true, 360,
     '{"pillar": "web_premium", "priority": "medium"}')
ON CONFLICT DO NOTHING;

-- ── Seed SERP Keywords ──
-- Initial keywords to track for Browning Digital properties

INSERT INTO serp_tracking (keyword, target_url, check_frequency_hours, metadata)
VALUES
    -- Brand keywords
    ('browning digital', 'https://browningdigital.com', 24, '{"type": "brand"}'),
    ('browning digital ai', 'https://browningdigital.com', 24, '{"type": "brand"}'),

    -- Product keywords (systems_automation)
    ('ai automation starter kit', 'https://browningdigital.com', 6, '{"type": "product", "pillar": "systems_automation"}'),
    ('zero cost ai infrastructure', 'https://browningdigital.com', 6, '{"type": "product", "pillar": "systems_automation"}'),
    ('ai agent business stack', 'https://browningdigital.com', 6, '{"type": "product", "pillar": "systems_automation"}'),
    ('claude code automation', 'https://browningdigital.com', 12, '{"type": "product", "pillar": "systems_automation"}'),

    -- Content keywords (founder_ops)
    ('solopreneur ai tools', 'https://browningdigital.com', 6, '{"type": "content", "pillar": "founder_ops"}'),
    ('ai for small business', 'https://browningdigital.com', 12, '{"type": "content", "pillar": "founder_ops"}'),
    ('automate business with ai', 'https://browningdigital.com', 12, '{"type": "content", "pillar": "founder_ops"}'),

    -- SEO target keywords (web_premium)
    ('cloudflare workers tutorial', 'https://browningdigital.com', 12, '{"type": "seo", "pillar": "web_premium"}'),
    ('supabase cloudflare workers', 'https://browningdigital.com', 12, '{"type": "seo", "pillar": "web_premium"}')
ON CONFLICT (keyword, target_url) DO NOTHING;

-- ── Helpful Views ──

-- SERP dashboard view
CREATE OR REPLACE VIEW serp_dashboard AS
SELECT
    st.keyword,
    st.target_url,
    st.current_position,
    st.previous_position,
    st.best_position,
    CASE
        WHEN st.current_position IS NULL THEN 'not_ranked'
        WHEN st.previous_position IS NULL THEN 'new'
        WHEN st.current_position < st.previous_position THEN 'improved'
        WHEN st.current_position > st.previous_position THEN 'dropped'
        ELSE 'stable'
    END as trend,
    st.checked_at,
    st.metadata->>'type' as keyword_type,
    st.metadata->>'pillar' as pillar
FROM serp_tracking st
WHERE st.is_active = true
ORDER BY st.current_position ASC NULLS LAST;

-- CMO overview view
CREATE OR REPLACE VIEW cmo_overview AS
SELECT
    (SELECT COUNT(*) FROM products WHERE status = 'deployed') as products_live,
    (SELECT COUNT(*) FROM products WHERE status = 'building') as products_building,
    (SELECT COUNT(*) FROM golden_nuggets WHERE pipeline_stage = 'backlog' AND status IN ('new', 'reviewed')) as nuggets_ready,
    (SELECT COUNT(*) FROM content_queue WHERE status = 'queued') as content_queued,
    (SELECT COALESCE(SUM(amount), 0) FROM product_sales WHERE created_at > NOW() - INTERVAL '30 days') as revenue_30d,
    (SELECT COUNT(*) FROM scraper_configs WHERE is_active = true AND scrape_type = 'rss') as rss_feeds_active,
    (SELECT COUNT(*) FROM serp_tracking WHERE is_active = true) as keywords_tracked,
    (SELECT AVG(current_position) FROM serp_tracking WHERE current_position IS NOT NULL AND is_active = true) as avg_serp_position;
