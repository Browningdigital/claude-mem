-- Browning Cloud Node — Task Queue Table
-- Run this in Supabase SQL Editor or via Management API.

CREATE TABLE IF NOT EXISTS cloud_node_tasks (
    id              UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    prompt          TEXT NOT NULL,
    repo            TEXT,
    branch          TEXT,
    working_dir     TEXT,
    priority        TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'critical')),
    skip_permissions BOOLEAN DEFAULT false,
    continue_session BOOLEAN DEFAULT false,
    timeout_minutes  INTEGER DEFAULT 30,
    status          TEXT DEFAULT 'queued' CHECK (status IN ('queued', 'running', 'completed', 'failed', 'timeout', 'cancelled')),
    output          TEXT,
    error           TEXT,
    created_at      TIMESTAMPTZ DEFAULT NOW(),
    started_at      TIMESTAMPTZ,
    completed_at    TIMESTAMPTZ
);

-- Index for the watcher's polling query
CREATE INDEX IF NOT EXISTS idx_cloud_node_tasks_status_created
    ON cloud_node_tasks (status, created_at ASC)
    WHERE status = 'queued';

-- Index for listing recent tasks
CREATE INDEX IF NOT EXISTS idx_cloud_node_tasks_created
    ON cloud_node_tasks (created_at DESC);

-- RLS: only service_role can access (Worker + watcher both use service_role_key)
ALTER TABLE cloud_node_tasks ENABLE ROW LEVEL SECURITY;

-- Allow full access via service_role (bypasses RLS by default)
-- No anon/authenticated policies = locked down to service_role only

COMMENT ON TABLE cloud_node_tasks IS 'Task queue for Browning Cloud Node — iPhone dispatches tasks, VPS watcher executes via Claude Code headless.';
