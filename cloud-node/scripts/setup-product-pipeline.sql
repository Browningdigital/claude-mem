-- ============================================================
-- BROWNING CLOUD NODE — Product Pipeline Database Migration
-- ============================================================
-- Run once against Supabase to create the product business tables.
-- These tables power the autonomous product creation, deployment,
-- and revenue tracking system.
-- ============================================================

-- ── Product catalog ──
-- Every product the agent builds and deploys
CREATE TABLE IF NOT EXISTS products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    slug TEXT UNIQUE NOT NULL,
    description TEXT,
    tier TEXT CHECK (tier IN ('micro', 'starter', 'pro', 'premium', 'enterprise')),
    price NUMERIC(10,2) NOT NULL DEFAULT 0,
    currency TEXT DEFAULT 'USD',
    pillar TEXT, -- systems_automation, revenue_systems, content_marketing, founder_ops, web_premium
    format TEXT, -- pdf, notion, code_repo, video_course, saas, template, workshop
    status TEXT DEFAULT 'draft' CHECK (status IN ('draft', 'building', 'review', 'deployed', 'paused', 'retired')),
    landing_page_url TEXT,
    checkout_url TEXT,
    delivery_url TEXT, -- download link or access URL
    source_nugget_id UUID, -- FK to golden_nuggets
    content JSONB DEFAULT '{}', -- the actual product content/assets
    metadata JSONB DEFAULT '{}', -- extra data (file list, word count, etc.)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    deployed_at TIMESTAMPTZ,
    first_sale_at TIMESTAMPTZ
);

-- ── Product sales ──
-- Every transaction tracked
CREATE TABLE IF NOT EXISTS product_sales (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    product_id UUID REFERENCES products(id),
    product_name TEXT NOT NULL,
    amount NUMERIC(10,2) NOT NULL,
    currency TEXT DEFAULT 'USD',
    source TEXT, -- lemon_squeezy, stripe, gumroad, paypal, manual
    customer_email TEXT,
    customer_name TEXT,
    payment_id TEXT, -- external payment reference
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Product pipeline ──
-- Tracks the journey from nugget to deployed product
CREATE TABLE IF NOT EXISTS product_pipeline (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nugget_id UUID, -- source golden_nugget
    product_id UUID REFERENCES products(id),
    stage TEXT DEFAULT 'selected' CHECK (stage IN ('selected', 'researching', 'building', 'reviewing', 'deploying', 'deployed', 'promoting', 'optimizing')),
    priority INTEGER DEFAULT 50, -- 1-100, higher = more urgent
    assigned_session TEXT, -- cloud-node session working on it
    notes TEXT,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    completed_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Content queue ──
-- Social posts and marketing content queued for distribution
CREATE TABLE IF NOT EXISTS content_queue (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    platform TEXT NOT NULL, -- twitter, linkedin, reddit, youtube, telegram, discord
    content_type TEXT DEFAULT 'post', -- post, thread, article, video_script, story
    title TEXT,
    body TEXT NOT NULL,
    media_urls JSONB DEFAULT '[]',
    product_id UUID REFERENCES products(id), -- what product this promotes (optional)
    hashtags TEXT[],
    status TEXT DEFAULT 'queued' CHECK (status IN ('draft', 'queued', 'scheduled', 'posted', 'failed')),
    scheduled_for TIMESTAMPTZ,
    posted_at TIMESTAMPTZ,
    engagement JSONB DEFAULT '{}', -- likes, shares, comments, clicks
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Scheduled tasks ──
-- Recurring autonomous tasks (cron-like)
CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name TEXT NOT NULL,
    description TEXT,
    prompt TEXT NOT NULL, -- the task prompt to execute
    schedule TEXT NOT NULL, -- cron expression: "0 */6 * * *" = every 6 hours
    enabled BOOLEAN DEFAULT true,
    last_run TIMESTAMPTZ,
    next_run TIMESTAMPTZ,
    run_count INTEGER DEFAULT 0,
    last_status TEXT,
    last_output TEXT,
    timeout_minutes INTEGER DEFAULT 30,
    skip_permissions BOOLEAN DEFAULT false,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Revenue dashboard ──
-- Daily revenue snapshots for trend analysis
CREATE TABLE IF NOT EXISTS revenue_daily (
    date DATE PRIMARY KEY,
    total_revenue NUMERIC(10,2) DEFAULT 0,
    total_sales INTEGER DEFAULT 0,
    products_deployed INTEGER DEFAULT 0,
    content_posted INTEGER DEFAULT 0,
    new_leads INTEGER DEFAULT 0,
    top_product TEXT,
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ── Indexes ──
CREATE INDEX IF NOT EXISTS idx_products_status ON products(status);
CREATE INDEX IF NOT EXISTS idx_products_status_price ON products(status, price);
CREATE INDEX IF NOT EXISTS idx_products_pillar ON products(pillar);
CREATE INDEX IF NOT EXISTS idx_product_sales_created ON product_sales(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_product_sales_product ON product_sales(product_id);
CREATE INDEX IF NOT EXISTS idx_product_sales_payment ON product_sales(payment_id);
CREATE INDEX IF NOT EXISTS idx_content_queue_status ON content_queue(status, scheduled_for);
CREATE INDEX IF NOT EXISTS idx_content_queue_platform ON content_queue(platform, status);
CREATE INDEX IF NOT EXISTS idx_scheduled_tasks_next ON scheduled_tasks(next_run) WHERE enabled = true;
CREATE INDEX IF NOT EXISTS idx_pipeline_stage ON product_pipeline(stage);

-- ── Row Level Security ──
-- Enable RLS on all product pipeline tables
ALTER TABLE products ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_sales ENABLE ROW LEVEL SECURITY;
ALTER TABLE product_pipeline ENABLE ROW LEVEL SECURITY;
ALTER TABLE content_queue ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduled_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE revenue_daily ENABLE ROW LEVEL SECURITY;

-- service_role bypasses RLS; anon gets read-only on products
CREATE POLICY "anon can read deployed products" ON products
    FOR SELECT USING (status = 'deployed');

CREATE POLICY "service_role full access products" ON products
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role full access product_sales" ON product_sales
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role full access product_pipeline" ON product_pipeline
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role full access content_queue" ON content_queue
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role full access scheduled_tasks" ON scheduled_tasks
    FOR ALL USING (auth.role() = 'service_role');

CREATE POLICY "service_role full access revenue_daily" ON revenue_daily
    FOR ALL USING (auth.role() = 'service_role');

-- ── Update golden_nuggets for pipeline tracking ──
ALTER TABLE golden_nuggets ADD COLUMN IF NOT EXISTS pipeline_stage TEXT DEFAULT 'backlog';
ALTER TABLE golden_nuggets ADD COLUMN IF NOT EXISTS product_id UUID;
ALTER TABLE golden_nuggets ADD COLUMN IF NOT EXISTS priority INTEGER DEFAULT 50;

-- ── Helpful views ──
CREATE OR REPLACE VIEW revenue_summary AS
SELECT
    date_trunc('day', created_at)::date as day,
    COUNT(*) as sales,
    SUM(amount) as revenue,
    COUNT(DISTINCT product_id) as unique_products
FROM product_sales
GROUP BY 1
ORDER BY 1 DESC;

CREATE OR REPLACE VIEW pipeline_status AS
SELECT
    gn.title as nugget,
    gn.pipeline_stage,
    gn.productization_potential,
    gn.target_audience,
    p.name as product_name,
    p.status as product_status,
    p.price,
    p.tier
FROM golden_nuggets gn
LEFT JOIN products p ON gn.product_id = p.id
ORDER BY gn.priority DESC NULLS LAST, gn.created_at ASC;
