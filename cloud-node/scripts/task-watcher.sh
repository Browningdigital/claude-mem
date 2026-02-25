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
#   SUPABASE_URL      — https://wcdyvukzlxxkgvxomaxr.supabase.co
#   SUPABASE_KEY      — service_role_key
#   WORKSPACE_DIR     — /home/agent/workspace
#   CLAUDE_MEM_REPO   — /home/agent/claude-mem (repo with CLAUDE.md)

set -euo pipefail

POLL_INTERVAL="${POLL_INTERVAL:-5}"
MAX_CONCURRENT="${MAX_CONCURRENT:-2}"
WORKSPACE_DIR="${WORKSPACE_DIR:-/home/agent/workspace}"
CLAUDE_MEM_REPO="${CLAUDE_MEM_REPO:-/home/agent/claude-mem}"
RUNNING_TASKS=0

log() { echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1"; }

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
    curl -s -X POST \
        "https://api.supabase.com/v1/projects/wcdyvukzlxxkgvxomaxr/database/query" \
        -H "Authorization: Bearer sbp_77f3a4025505ccf2e7dfa518913224b79fab3dd1" \
        -H "Content-Type: application/json" \
        --data-binary "{\"query\": $(echo "$query" | jq -Rs .)}"
}

# ── Session management ──

register_session() {
    local task_id="$1"
    local prompt="$2"
    local session_id="cloud-node-${task_id}"

    # Register session in claude_sessions
    supabase_sql "INSERT INTO claude_sessions (session_id, started_at, status, goals, session_type, priority) VALUES ('${session_id}', NOW(), 'active', ARRAY['${prompt:0:200}'], 'build', 'normal') ON CONFLICT (session_id) DO NOTHING"

    echo "$session_id"
}

write_handoff() {
    local task_id="$1"
    local session_id="$2"
    local prompt="$3"
    local output="$4"
    local status="$5"

    # Write handoff
    local output_escaped
    output_escaped=$(echo "$output" | head -c 5000 | jq -Rsa .)

    supabase_sql "INSERT INTO session_handoffs (session_source, quick_context, what_we_did, current_state, next_steps) VALUES ('Cloud Node', 'Headless task: ${prompt:0:100}', ${output_escaped}, '${status}', '')"

    # End session
    supabase_sql "UPDATE claude_sessions SET status = 'completed', ended_at = NOW(), outcomes = ARRAY['${status}'] WHERE session_id = '${session_id}'"
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
curl -s -X POST "https://api.supabase.com/v1/projects/wcdyvukzlxxkgvxomaxr/database/query" \\
  -H "Authorization: Bearer sbp_77f3a4025505ccf2e7dfa518913224b79fab3dd1" \\
  -H "Content-Type: application/json" \\
  --data-binary '{"query": "SELECT state_key, state_value FROM claude_system_state WHERE state_key = '"'"'<key>'"'"'"}'
\`\`\`

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

    # Clone repo if specified
    if [[ -n "$repo" ]]; then
        log "  Cloning $repo..."
        git clone "$repo" "$task_dir/repo" 2>/dev/null || true
        if [[ -n "$branch" ]]; then
            cd "$task_dir/repo" && git checkout "$branch" 2>/dev/null || true
        fi
        working_dir="${task_dir}/repo"
    fi

    local exec_dir="${working_dir:-$task_dir}"
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
    echo "$full_prompt" | timeout "${timeout_sec}" $claude_cmd \
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

    # Escape JSON strings
    local output_json error_json
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

    log "DONE task ${task_id}: status=${status} (exit_code=${exit_code})"

    RUNNING_TASKS=$((RUNNING_TASKS - 1))
}

# ── Main loop ──

log "Task watcher started. Polling every ${POLL_INTERVAL}s. Max concurrent: ${MAX_CONCURRENT}."
log "Workspace: ${WORKSPACE_DIR}"
log "CLAUDE.md source: ${CLAUDE_MEM_REPO}"

# Keep claude-mem repo up to date
if [[ -d "${CLAUDE_MEM_REPO}/.git" ]]; then
    cd "$CLAUDE_MEM_REPO" && git pull --ff-only 2>/dev/null || true
    log "claude-mem repo updated."
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
