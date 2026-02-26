-- ============================================================
-- BROWNING CLOUD NODE — Missing Tables Migration
-- ============================================================
-- These tables are referenced throughout the cloud-node stack
-- (task-watcher, content-ingest-poll, scheduled-dispatcher,
-- relay server, agent CLAUDE.md) but were never created.
--
-- Run AFTER setup-supabase-table.sql and setup-product-pipeline.sql.
-- ============================================================

-- ── claude_sessions ──
-- Tracks every autonomous and interactive session.
-- Used by task-watcher.sh register_session() and write_handoff().
CREATE TABLE IF NOT EXISTS claude_sessions (
    session_id      TEXT PRIMARY KEY,
    started_at      TIMESTAMPTZ DEFAULT NOW(),
    ended_at        TIMESTAMPTZ,
    status          TEXT DEFAULT 'active' CHECK (status IN ('active', 'completed', 'failed', 'abandoned')),
    goals           TEXT[],
    outcomes        TEXT[],
    session_type    TEXT DEFAULT 'build' CHECK (session_type IN ('build', 'ops', 'research', 'maintenance', 'mobile')),
    priority        TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_claude_sessions_status ON claude_sessions(status);
CREATE INDEX IF NOT EXISTS idx_claude_sessions_started ON claude_sessions(started_at DESC);

ALTER TABLE claude_sessions ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE claude_sessions IS 'Session registry for Cloud Node autonomous and interactive sessions. Every task-watcher execution registers here.';

-- ── session_handoffs ──
-- Context bridge between sessions. Written at session end,
-- read at next session start for continuity.
CREATE TABLE IF NOT EXISTS session_handoffs (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_source  TEXT NOT NULL,
    quick_context   TEXT,
    what_we_did     TEXT,
    current_state   TEXT,
    next_steps      TEXT,
    blockers        TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_session_handoffs_created ON session_handoffs(created_at DESC);

ALTER TABLE session_handoffs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE session_handoffs IS 'Session handoff notes — what was done, what to do next. Provides continuity across autonomous sessions.';

-- ── claude_events ──
-- Structured event log for every significant action across all sessions.
-- Used by task-watcher.sh prompt template for mandatory session logging.
CREATE TABLE IF NOT EXISTS claude_events (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id      TEXT REFERENCES claude_sessions(session_id) ON DELETE SET NULL,
    description     TEXT NOT NULL,
    event_type      TEXT DEFAULT 'action' CHECK (event_type IN ('action', 'decision', 'milestone', 'insight', 'error', 'discovery')),
    importance      TEXT DEFAULT 'medium' CHECK (importance IN ('low', 'medium', 'high')),
    metadata        JSONB DEFAULT '{}',
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_claude_events_session ON claude_events(session_id);
CREATE INDEX IF NOT EXISTS idx_claude_events_created ON claude_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_claude_events_type ON claude_events(event_type);

ALTER TABLE claude_events ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE claude_events IS 'Structured event log for all Claude sessions. Every log_event() call writes here.';

-- ── claude_system_state ──
-- Key-value store for credentials, config, and system state.
-- Used by MCP fallback (CLAUDE.md), task-watcher credential lookup,
-- and OCI provision launcher.
CREATE TABLE IF NOT EXISTS claude_system_state (
    state_key       TEXT PRIMARY KEY,
    state_value     JSONB NOT NULL DEFAULT '{}',
    description     TEXT,
    updated_at      TIMESTAMPTZ DEFAULT NOW(),
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE claude_system_state ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE claude_system_state IS 'System state and credential store. Keys: cloudflare, supabase, github, anthropic, openai, discord, oracle_cloud_credentials, etc.';

-- ── golden_nuggets ──
-- High-value content extractions from the ingestion pipeline.
-- Referenced by content-ingest-poll.sh, agent workflows, and product pipeline.
CREATE TABLE IF NOT EXISTS golden_nuggets (
    id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    nugget_type                 TEXT,
    title                       TEXT NOT NULL,
    description                 TEXT,
    detailed_explanation        TEXT,
    implementation_steps        TEXT,
    target_audience             TEXT,
    productization_potential    TEXT,
    estimated_value             TEXT,
    content_pillars             TEXT[],
    score                       INTEGER DEFAULT 0,
    status                      TEXT DEFAULT 'new' CHECK (status IN ('new', 'reviewed', 'packaged', 'published', 'archived')),
    source_content_id           UUID,
    pipeline_stage              TEXT DEFAULT 'backlog',
    product_id                  UUID,
    priority                    INTEGER DEFAULT 50,
    metadata                    JSONB DEFAULT '{}',
    created_at                  TIMESTAMPTZ DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_golden_nuggets_status ON golden_nuggets(status);
CREATE INDEX IF NOT EXISTS idx_golden_nuggets_score ON golden_nuggets(score DESC);
CREATE INDEX IF NOT EXISTS idx_golden_nuggets_pipeline ON golden_nuggets(pipeline_stage);
CREATE INDEX IF NOT EXISTS idx_golden_nuggets_created ON golden_nuggets(created_at DESC);

ALTER TABLE golden_nuggets ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE golden_nuggets IS 'High-value content extractions. Fed by content-ingest-poll, consumed by product pipeline and content-generation workflows.';

-- ── raw_content ──
-- Universal content ingestion landing table.
-- Content drops in via content-ingest.devin-b58.workers.dev.
-- content-ingest-poll.sh polls this for processing_status = 'pending'.
CREATE TABLE IF NOT EXISTS raw_content (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_type         TEXT NOT NULL,
    source_url          TEXT,
    raw_text            TEXT NOT NULL,
    word_count          INTEGER DEFAULT 0,
    processing_status   TEXT DEFAULT 'pending' CHECK (processing_status IN ('pending', 'processing', 'processed', 'failed', 'skipped')),
    processed_by        TEXT,
    metadata            JSONB DEFAULT '{}',
    created_at          TIMESTAMPTZ DEFAULT NOW(),
    updated_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_raw_content_status ON raw_content(processing_status, created_at ASC);
CREATE INDEX IF NOT EXISTS idx_raw_content_source ON raw_content(source_type);
CREATE INDEX IF NOT EXISTS idx_raw_content_created ON raw_content(created_at DESC);

ALTER TABLE raw_content ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE raw_content IS 'Universal content ingestion landing zone. Anything dropped here gets processed by content-ingest-poll into golden_nuggets.';

-- ── v2_gold_content ──
-- Scored and enriched content from the v2 scoring system.
-- Score 70+ content lands here from content-ingest-poll processing.
CREATE TABLE IF NOT EXISTS v2_gold_content (
    id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source_content_id   UUID REFERENCES raw_content(id) ON DELETE SET NULL,
    nugget_id           UUID REFERENCES golden_nuggets(id) ON DELETE SET NULL,
    title               TEXT NOT NULL,
    summary             TEXT,
    score               INTEGER NOT NULL DEFAULT 0,
    content_pillars     TEXT[],
    engagement_signals  JSONB DEFAULT '{}',
    virality_score      INTEGER DEFAULT 0,
    depth_score         INTEGER DEFAULT 0,
    actionability_score INTEGER DEFAULT 0,
    status              TEXT DEFAULT 'candidate' CHECK (status IN ('candidate', 'approved', 'published', 'rejected')),
    metadata            JSONB DEFAULT '{}',
    created_at          TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_v2_gold_score ON v2_gold_content(score DESC);
CREATE INDEX IF NOT EXISTS idx_v2_gold_status ON v2_gold_content(status);
CREATE INDEX IF NOT EXISTS idx_v2_gold_pillars ON v2_gold_content USING GIN(content_pillars);

ALTER TABLE v2_gold_content ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE v2_gold_content IS 'V2 scored content — score 70+ from ingestion pipeline. Feeds social posting and product creation.';

-- ── Helpful views ──

-- Nugget candidates view (used by processing pipeline)
CREATE OR REPLACE VIEW v2_nugget_candidates AS
SELECT
    gc.id,
    gc.title,
    gc.score,
    gc.content_pillars,
    gc.status,
    gn.title as nugget_title,
    gn.pipeline_stage,
    gn.productization_potential
FROM v2_gold_content gc
LEFT JOIN golden_nuggets gn ON gc.nugget_id = gn.id
WHERE gc.status = 'candidate'
ORDER BY gc.score DESC;

-- Content processing queue view
CREATE OR REPLACE VIEW content_processing_queue AS
SELECT
    rc.id,
    rc.source_type,
    LEFT(rc.raw_text, 200) as preview,
    rc.word_count,
    rc.processing_status,
    rc.created_at
FROM raw_content rc
WHERE rc.processing_status = 'pending'
ORDER BY rc.created_at ASC;

-- Active sessions view
CREATE OR REPLACE VIEW active_sessions AS
SELECT
    cs.session_id,
    cs.status,
    cs.goals,
    cs.session_type,
    cs.started_at,
    cs.ended_at,
    COUNT(ce.id) as event_count
FROM claude_sessions cs
LEFT JOIN claude_events ce ON cs.session_id = ce.session_id
GROUP BY cs.session_id, cs.status, cs.goals, cs.session_type, cs.started_at, cs.ended_at
ORDER BY cs.started_at DESC;

-- ── Fix FK references in setup-product-pipeline.sql ──
-- products.source_nugget_id should reference golden_nuggets
-- (safe to run multiple times — IF NOT EXISTS handles it)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.table_constraints
        WHERE constraint_name = 'products_source_nugget_id_fkey'
    ) THEN
        BEGIN
            ALTER TABLE products ADD CONSTRAINT products_source_nugget_id_fkey
                FOREIGN KEY (source_nugget_id) REFERENCES golden_nuggets(id) ON DELETE SET NULL;
        EXCEPTION WHEN others THEN
            NULL;
        END;
    END IF;
END $$;
