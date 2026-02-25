#!/usr/bin/env bash
# Browning Cloud Node — Task Watcher
# Polls Supabase for queued tasks and executes them via Claude Code headless.
# Each task runs with FULL Browning system capabilities:
#   - CLAUDE.md loaded (credentials, memory, session logging)
#   - Session registered in claude_sessions
#   - Handoff written on completion
#   - MCP fallback via Supabase direct API
#
# Runs as a systemd service on the VPS.
#
# Required env vars (set in /home/agent/.config/task-watcher.env):
#   SUPABASE_URL        — https://wcdyvukzlxxkgvxomaxr.supabase.co
#   SUPABASE_KEY        — service_role_key
#   SUPABASE_ADMIN_API  — Supabase Management API URL
#   SUPABASE_ADMIN_TOKEN — Supabase Management API token
#   WORKSPACE_DIR       — /home/agent/workspace
#   CLAUDE_MEM_REPO     — /home/agent/claude-mem (repo with CLAUDE.md)

set -euo pipefail

POLL_INTERVAL="${POLL_INTERVAL:-5}"
MAX_CONCURRENT="${MAX_CONCURRENT:-2}"
WORKSPACE_DIR="${WORKSPACE_DIR:-/home/agent/workspace}"
CLAUDE_MEM_REPO="${CLAUDE_MEM_REPO:-/home/agent/claude-mem}"
MAX_RETRY="${MAX_RETRY:-2}"
RUNNING_TASKS=0

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"; }

# SQL-safe string escaping (prevent SQL injection)
sql_escape() { echo "$1" | sed "s/'/''/g"; }

mkdir -p "$WORKSPACE_DIR"

# ── Supabase helpers ──

supabase_query() {
    local filter="$1"
    curl -s "${SUPABASE_URL}/rest/v1/cloud_node_tasks?${filter}" \
        -H "apikey: ${SUPABASE_KEY}" \
        -H "Authorization: Bearer ${SUPABASE_KEY}" \
        -H "Content-Type: application/json"
}

supabase_update() {
    local task_id="$1"
    local data="$2"
    curl -s -X PATCH "${SUPABASE_URL}/rest/v1/cloud_node_tasks?id=eq.${task_id}" \
        -H "apikey: ${SUPABASE_KEY}" \
        -H "Authorization: Bearer ${SUPABASE_KEY}" \
        -H "Content-Type: application/json" \
        -H "Prefer: return=representation" \
        -d "$data"
}

supabase_sql() {
    local query="$1"
    local api_url="${SUPABASE_ADMIN_API:-https://api.supabase.com/v1/projects/wcdyvukzlxxkgvxomaxr/database/query}"
    local api_token="${SUPABASE_ADMIN_TOKEN:-}"
    if [[ -z "$api_token" ]]; then
        log "WARNING: SUPABASE_ADMIN_TOKEN not set — supabase_sql calls will fail"
        return 1
    fi
    curl -s --max-time 30 -X POST "$api_url" \
        -H "Authorization: Bearer $api_token" \
        -H "Content-Type: application/json" \
        --data-binary "{\"query\": $(echo "$query" | jq -Rs .)}"
}

# ── Session management ──

register_session() {
    local task_id="$1"
    local prompt="$2"
    local session_id="cloud-node-${task_id}"
    local safe_prompt
    safe_prompt=$(sql_escape "${prompt:0:200}")

    # Register session in claude_sessions
    supabase_sql "INSERT INTO claude_sessions (session_id, started_at, status, goals, session_type, priority) VALUES ('${session_id}', NOW(), 'active', ARRAY['${safe_prompt}'], 'build', 'normal') ON CONFLICT (session_id) DO NOTHING" 2>/dev/null || true

    echo "$session_id"
}

write_handoff() {
    local task_id="$1"
    local session_id="$2"
    local prompt="$3"
    local output="$4"
    local status="$5"

    local safe_prompt safe_status
    safe_prompt=$(sql_escape "${prompt:0:100}")
    safe_status=$(sql_escape "$status")

    # Write handoff — output is JSON-escaped to prevent injection
    local output_escaped
    output_escaped=$(echo "$output" | head -c 5000 | jq -Rsa .)

    supabase_sql "INSERT INTO session_handoffs (session_source, quick_context, what_we_did, current_state, next_steps) VALUES ('Cloud Node', 'Headless task: ${safe_prompt}', ${output_escaped}, '${safe_status}', '')" 2>/dev/null || true

    # End session
    supabase_sql "UPDATE claude_sessions SET status = 'completed', ended_at = NOW(), outcomes = ARRAY['${safe_status}'] WHERE session_id = '${session_id}'" 2>/dev/null || true
}

# ── Build the full-capability prompt ──

build_prompt() {
    local task_prompt="$1"
    local session_id="$2"
    local task_id="$3"

    # Load agent identity if available
    local agent_identity=""
    local agent_file="${CLAUDE_MEM_REPO}/cloud-node/agent/CLAUDE.md"
    if [[ -f "$agent_file" ]]; then
        agent_identity=$(cat "$agent_file")
    fi

    # Pull latest revenue stats for agent context
    local revenue_context=""
    revenue_context=$(supabase_sql "SELECT COALESCE(SUM(amount),0) as total, COALESCE(COUNT(*),0) as sales FROM product_sales WHERE created_at > NOW() - INTERVAL '30 days'" 2>/dev/null | python3 -c "
import sys, json
try:
    r = json.load(sys.stdin)
    if r: print(f'Revenue (30d): \${r[0][\"total\"]} from {r[0][\"sales\"]} sales')
except: print('Revenue: No data yet — go make the first sale.')
" 2>/dev/null) || revenue_context="Revenue: No data yet — go make the first sale."

    # Pull pipeline status
    local pipeline_status=""
    pipeline_status=$(supabase_sql "SELECT status, COUNT(*) as cnt FROM golden_nuggets GROUP BY status" 2>/dev/null | python3 -c "
import sys, json
try:
    r = json.load(sys.stdin)
    parts = [f'{row[\"cnt\"]} {row[\"status\"]}' for row in r]
    print('Pipeline: ' + ', '.join(parts))
except: print('Pipeline: 19 nuggets awaiting packaging')
" 2>/dev/null) || pipeline_status="Pipeline: 19 nuggets awaiting packaging"

    cat <<PROMPT
${agent_identity}

---

## SESSION CONTEXT (Auto-injected by task-watcher)

- Session ID: ${session_id}
- Task ID: ${task_id}
- Execution mode: Headless (no human in the loop)
- Environment: Ubuntu ARM64, Oracle Cloud
- ${revenue_context}
- ${pipeline_status}

## Credentials & Memory Access
Query Supabase directly for any credentials:
\`\`\`bash
curl -s -X POST "\${SUPABASE_ADMIN_API}" \\
  -H "Authorization: Bearer \${SUPABASE_ADMIN_TOKEN}" \\
  -H "Content-Type: application/json" \\
  --data-binary '{"query": "SELECT state_key, state_value FROM claude_system_state WHERE state_key = '"'"'<key>'"'"'"}'
\`\`\`

Environment variables available: SUPABASE_URL, SUPABASE_KEY, SUPABASE_ADMIN_API, SUPABASE_ADMIN_TOKEN

Available keys: cloudflare, supabase, github, anthropic, openai, discord, railway, fly, deepgram, coinbase, paypal, admin

## Session Logging (MANDATORY)
\`\`\`bash
curl -s -X POST "${SUPABASE_URL}/rest/v1/claude_events" \\
  -H "apikey: ${SUPABASE_KEY}" \\
  -H "Authorization: Bearer ${SUPABASE_KEY}" \\
  -H "Content-Type: application/json" \\
  -d '{"session_id": "${session_id}", "description": "what happened", "event_type": "action", "importance": "medium"}'
\`\`\`

## YOUR TASK
${task_prompt}
PROMPT
}

# ── Task execution ──

execute_task() {
    local task_json="$1"
    local task_id prompt repo branch working_dir skip_perms continue_sess timeout_min

    task_id=$(echo "$task_json" | jq -r '.id')
    prompt=$(echo "$task_json" | jq -r '.prompt')
    repo=$(echo "$task_json" | jq -r '.repo // empty')
    branch=$(echo "$task_json" | jq -r '.branch // empty')
    working_dir=$(echo "$task_json" | jq -r '.working_dir // empty')
    skip_perms=$(echo "$task_json" | jq -r '.skip_permissions // false')
    continue_sess=$(echo "$task_json" | jq -r '.continue_session // false')
    timeout_min=$(echo "$task_json" | jq -r '.timeout_minutes // 30')

    log "EXECUTING task ${task_id}: ${prompt:0:80}..."

    # Register Browning session
    local session_id
    session_id=$(register_session "$task_id" "$prompt")
    log "  Session: $session_id"

    # Mark as running
    supabase_update "$task_id" "{\"status\":\"running\",\"started_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"}" > /dev/null

    # Set up working directory
    local task_dir="${WORKSPACE_DIR}/${task_id}"
    mkdir -p "$task_dir"

    # Clone repo if specified (with timeout)
    if [[ -n "$repo" ]]; then
        log "  Cloning $repo..."
        timeout 120 git clone "$repo" "$task_dir/repo" 2>/dev/null || log "  WARNING: git clone failed for $repo"
        if [[ -n "$branch" && -d "$task_dir/repo" ]]; then
            git -C "$task_dir/repo" checkout "$branch" 2>/dev/null || true
        fi
        if [[ -d "$task_dir/repo" ]]; then
            working_dir="${task_dir}/repo"
        fi
    fi

    local exec_dir="${working_dir:-$task_dir}"
    # Validate exec_dir exists
    if [[ ! -d "$exec_dir" ]]; then
        log "  WARNING: exec_dir $exec_dir does not exist, falling back to task_dir"
        exec_dir="$task_dir"
    fi
    local output_file="${task_dir}/output.txt"
    local error_file="${task_dir}/error.txt"

    # Copy CLAUDE.md into working directory for context
    if [[ -f "${CLAUDE_MEM_REPO}/CLAUDE.md" ]]; then
        cp "${CLAUDE_MEM_REPO}/CLAUDE.md" "${exec_dir}/CLAUDE.md" 2>/dev/null || true
    fi
    if [[ -d "${CLAUDE_MEM_REPO}/.claude" ]]; then
        cp -r "${CLAUDE_MEM_REPO}/.claude" "${exec_dir}/.claude" 2>/dev/null || true
    fi

    # Build full-capability prompt
    local full_prompt
    full_prompt=$(build_prompt "$prompt" "$session_id" "$task_id")

    # Build claude command
    local claude_cmd="claude -p"
    if [[ "$skip_perms" == "true" ]]; then
        claude_cmd="$claude_cmd --dangerously-skip-permissions"
    fi
    if [[ "$continue_sess" == "true" ]]; then
        claude_cmd="$claude_cmd --continue"
    fi
    claude_cmd="$claude_cmd --output-format text"

    # Execute with timeout
    local timeout_sec=$((timeout_min * 60))
    local exit_code=0

    cd "$exec_dir"
    echo "$full_prompt" | timeout --kill-after=30 "${timeout_sec}" $claude_cmd \
        > "$output_file" 2> "$error_file" || exit_code=$?

    # Read output (truncate if huge)
    local output=""
    local error=""
    if [[ -f "$output_file" ]]; then
        output=$(head -c 50000 "$output_file")
    fi
    if [[ -f "$error_file" ]]; then
        error=$(head -c 10000 "$error_file")
    fi

    # Determine status
    local status="completed"
    if [[ $exit_code -eq 124 ]]; then
        status="timeout"
        error="Task exceeded ${timeout_min} minute timeout"
    elif [[ $exit_code -ne 0 ]]; then
        status="failed"
    fi

    # Escape JSON strings (with truncation indicator)
    local output_json error_json
    local output_len=${#output}
    if [[ $output_len -ge 49000 ]]; then
        output="${output}

[OUTPUT TRUNCATED — original was ${output_len} bytes. First 50KB shown.]"
    fi
    output_json=$(echo "$output" | jq -Rsa .)
    error_json=$(echo "$error" | jq -Rsa .)

    # Update task in Supabase
    supabase_update "$task_id" "{
        \"status\":\"${status}\",
        \"output\":${output_json},
        \"error\":${error_json},
        \"completed_at\":\"$(date -u +%Y-%m-%dT%H:%M:%SZ)\"
    }" > /dev/null

    # Write Browning handoff
    write_handoff "$task_id" "$session_id" "$prompt" "$output" "$status"

    # Retry logic — requeue failed tasks (up to MAX_RETRY attempts)
    if [[ "$status" == "failed" ]]; then
        local retry_count
        retry_count=$(echo "$task_json" | jq -r '.metadata.retry_count // 0' 2>/dev/null || echo 0)
        if [[ "$retry_count" -lt "$MAX_RETRY" ]]; then
            local new_retry=$((retry_count + 1))
            log "RETRY task ${task_id}: attempt ${new_retry}/${MAX_RETRY}"
            # Requeue with incremented retry count
            local retry_data
            retry_data=$(jq -n --arg prompt "$prompt" --arg repo "$repo" --arg branch "$branch" \
                --argjson retry "$new_retry" --argjson timeout "$timeout_min" \
                '{prompt: $prompt, repo: ($repo // null), branch: ($branch // null),
                  priority: "normal", timeout_minutes: $timeout, status: "queued",
                  metadata: {retry_count: $retry, original_task_id: "'"$task_id"'"},
                  created_at: (now | todate)}')
            curl -s -X POST "${SUPABASE_URL}/rest/v1/cloud_node_tasks" \
                -H "apikey: ${SUPABASE_KEY}" -H "Authorization: Bearer ${SUPABASE_KEY}" \
                -H "Content-Type: application/json" -H "Prefer: return=minimal" \
                -d "$retry_data" > /dev/null 2>&1 || true
        else
            log "FAILED task ${task_id}: max retries (${MAX_RETRY}) exhausted"
        fi
    fi

    log "DONE task ${task_id}: status=${status} (exit_code=${exit_code})"

    RUNNING_TASKS=$((RUNNING_TASKS - 1))
}

# ── Main loop ──

log "Task watcher started. Polling every ${POLL_INTERVAL}s. Max concurrent: ${MAX_CONCURRENT}."
log "Workspace: ${WORKSPACE_DIR}"
log "CLAUDE.md source: ${CLAUDE_MEM_REPO}"

# Keep claude-mem repo up to date (with timeout to prevent hangs)
if [[ -d "${CLAUDE_MEM_REPO}/.git" ]]; then
    timeout 30 git -C "$CLAUDE_MEM_REPO" pull --ff-only 2>/dev/null || log "WARNING: claude-mem repo update failed or timed out"
    log "claude-mem repo synced."
fi

while true; do
    # Poll for queued tasks
    if [[ $RUNNING_TASKS -lt $MAX_CONCURRENT ]]; then
        TASKS=$(supabase_query "status=eq.queued&order=created_at.asc&limit=$((MAX_CONCURRENT - RUNNING_TASKS))")

        if [[ "$TASKS" != "[]" && -n "$TASKS" ]]; then
            TASK_COUNT=$(echo "$TASKS" | jq 'length')

            for i in $(seq 0 $((TASK_COUNT - 1))); do
                TASK=$(echo "$TASKS" | jq ".[$i]")
                RUNNING_TASKS=$((RUNNING_TASKS + 1))
                execute_task "$TASK" &
            done
        fi
    fi

    sleep "$POLL_INTERVAL"
done
