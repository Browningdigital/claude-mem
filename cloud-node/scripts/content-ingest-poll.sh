#!/usr/bin/env bash
# ============================================================
# Content Ingestion Poller
# ============================================================
# Checks for new unprocessed content in the raw_content table
# that was dropped via the universal content ingestion system
# (content-ingest.devin-b58.workers.dev).
#
# When new content is found, dispatches a cloud_node_task to:
#   1. Process the raw content
#   2. Extract golden nuggets
#   3. Score and categorize for the product pipeline
#   4. Update CLAUDE.md context with new insights
#
# Runs every 15 minutes via cron:
#   */15 * * * * /home/agent/claude-mem/cloud-node/scripts/content-ingest-poll.sh
# ============================================================

set -euo pipefail

SUPABASE_API="${SUPABASE_ADMIN_API:-https://api.supabase.com/v1/projects/wcdyvukzlxxkgvxomaxr/database/query}"
SUPABASE_TOKEN="${SUPABASE_ADMIN_TOKEN:?SUPABASE_ADMIN_TOKEN env var is required}"
SUPABASE_URL="${SUPABASE_URL:?SUPABASE_URL env var is required}"
SUPABASE_KEY="${SUPABASE_KEY:?SUPABASE_KEY env var is required}"

LOGFILE="/tmp/content-ingest-poll.log"
LOCKFILE="/tmp/content-ingest-poll.lock"

# Rotate log if > 1MB
if [[ -f "$LOGFILE" ]] && [[ $(stat -f%z "$LOGFILE" 2>/dev/null || stat -c%s "$LOGFILE" 2>/dev/null || echo 0) -gt 1048576 ]]; then
    mv "$LOGFILE" "${LOGFILE}.old"
fi

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOGFILE"; }

# Prevent overlapping runs (with timeout — don't wait forever)
exec 200>"$LOCKFILE"
flock -w 300 200 || { log "Lock held for >5 min, skipping"; exit 0; }

supabase_sql() {
    curl -sf --max-time 30 -X POST "$SUPABASE_API" \
        -H "Authorization: Bearer $SUPABASE_TOKEN" \
        -H "Content-Type: application/json" \
        --data-binary "$(python3 -c "import json,sys; print(json.dumps({'query': sys.stdin.read()}))" <<< "$1")"
}

# ── Check for new unprocessed content ──
PENDING=$(supabase_sql "
    SELECT COUNT(*) as cnt
    FROM raw_content
    WHERE processing_status = 'pending'
") || true

PENDING_COUNT=$(echo "$PENDING" | python3 -c "import sys,json; r=json.load(sys.stdin); print(r[0]['cnt'] if r else 0)" 2>/dev/null || echo 0)

if [[ "$PENDING_COUNT" == "0" ]]; then
    exit 0
fi

log "Found $PENDING_COUNT new content items to process"

# ── Get sample of new content for the processing task ──
SAMPLE=$(supabase_sql "
    SELECT id, source_type, LEFT(raw_text, 200) as preview, word_count, metadata
    FROM raw_content
    WHERE processing_status = 'pending'
    ORDER BY created_at ASC
    LIMIT 10
") || true

SAMPLE_TEXT=$(echo "$SAMPLE" | python3 -c "
import sys, json
rows = json.load(sys.stdin)
for r in rows:
    src = r.get('source_type', 'unknown')
    preview = (r.get('preview', '') or '')[:100]
    wc = r.get('word_count', 0)
    print(f'- [{src}] ({wc} words) {preview}...')
" 2>/dev/null || echo "Content details unavailable")

# ── Dispatch processing task ──
TASK_PROMPT=$(cat <<'TASKEOF'
## Content Processing Task (Auto-dispatched)

New content has been dropped into the universal ingestion system. Process it now.

### What to do:

1. **Fetch all pending content**:
```sql
SELECT id, source_type, raw_text, metadata, word_count
FROM raw_content
WHERE processing_status = 'pending'
ORDER BY created_at ASC;
```

2. **For each item, analyze and extract**:
   - Key insights and patterns
   - Productization opportunities (match to revenue pillars)
   - Target audience signals
   - Competitive intelligence
   - Actionable frameworks or templates

3. **Create golden nuggets** for high-value extractions:
```sql
INSERT INTO golden_nuggets (
    nugget_type, title, description, detailed_explanation,
    implementation_steps, target_audience, productization_potential,
    estimated_value, status, pipeline_stage
) VALUES (...);
```

4. **Score content** using the v2 gold scoring system:
   - Score 70+ = gold tier (insert into v2_gold_content)
   - Assign content pillars: systems_automation, revenue_systems, content_marketing, founder_ops, web_premium
   - Extract signals (engagement potential, virality, depth)

5. **Generate content queue items** from high-scoring pieces:
   - Create 2-3 social post drafts per gold-tier piece
   - Queue them in content_queue (platform: twitter, linkedin, reddit)
   - Include hooks, key takeaways, and product tie-ins

6. **Mark as processed**:
```sql
UPDATE raw_content SET processing_status = 'processed', updated_at = NOW()
WHERE id IN (...processed ids...);
```

7. **Log results**: How many processed, nuggets created, content queued.

### Context for scoring:
TASKEOF
)

# Append the sample content info
FULL_PROMPT="${TASK_PROMPT}

### New content sample (${PENDING_COUNT} total pending):
${SAMPLE_TEXT}"

# Insert task
TASK_DATA=$(python3 -c "
import json, datetime
prompt = open('/dev/stdin').read()
print(json.dumps({
    'prompt': prompt,
    'priority': 'high',
    'skip_permissions': True,
    'timeout_minutes': 45,
    'status': 'queued',
    'created_at': datetime.datetime.utcnow().isoformat() + 'Z'
}))
" <<< "$FULL_PROMPT")

RESULT=$(curl -sf -X POST "${SUPABASE_URL}/rest/v1/cloud_node_tasks" \
    -H "apikey: ${SUPABASE_KEY}" \
    -H "Authorization: Bearer ${SUPABASE_KEY}" \
    -H "Content-Type: application/json" \
    -H "Prefer: return=representation" \
    -d "$TASK_DATA" 2>/dev/null) || true

if echo "$RESULT" | grep -q '"id"'; then
    TASK_ID=$(echo "$RESULT" | python3 -c "import sys,json; r=json.load(sys.stdin); print(r[0]['id'] if isinstance(r,list) else r['id'])" 2>/dev/null || echo "unknown")
    log "Dispatched content processing task: $TASK_ID ($PENDING_COUNT items)"
else
    log "ERROR: Failed to dispatch task: $RESULT"
fi
