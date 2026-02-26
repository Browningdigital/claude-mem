#!/usr/bin/env bash
# ============================================================
# Browning Cloud Node — Scheduled Task Dispatcher
# ============================================================
# Checks the scheduled_tasks table for tasks that are due,
# dispatches them to cloud_node_tasks for the task-watcher.
#
# Uses the existing scheduled_tasks schema with:
#   task_name, task_config (jsonb with prompt), schedule_cron,
#   is_active, last_run_at, next_run_at, total_runs
#
# Cron entry (every minute):
#   * * * * * /home/agent/claude-mem/cloud-node/scripts/scheduled-dispatcher.sh
# ============================================================

set -euo pipefail

LOCKFILE="/tmp/scheduled-dispatcher.lock"
LOGFILE="/tmp/scheduled-dispatcher.log"

# Prevent overlapping runs
exec 200>"$LOCKFILE"
flock -n 200 || exit 0

log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" >> "$LOGFILE"; }

# ── Validate required env vars ──
: "${SUPABASE_URL:?SUPABASE_URL env var is required}"
: "${SUPABASE_KEY:?SUPABASE_KEY env var is required}"

# ── All logic in Python for clean JSON handling ──
python3 - "$SUPABASE_URL" "$SUPABASE_KEY" << 'PYEOF'
import json, urllib.request, datetime, sys, os

URL = sys.argv[1].rstrip("/") + "/rest/v1"
KEY = sys.argv[2]
HEADERS = {
    "apikey": KEY,
    "Authorization": f"Bearer {KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation"
}

# Cron -> minutes interval map (known patterns + fallback parser)
INTERVALS = {
    "*/5 * * * *": 5,
    "*/10 * * * *": 10,
    "*/15 * * * *": 15,
    "*/30 * * * *": 30,
    "0 * * * *": 60,
    "0 */2 * * *": 120,
    "0 */3 * * *": 180,
    "0 */4 * * *": 240,
    "0 */6 * * *": 360,
    "0 */8 * * *": 480,
    "0 */12 * * *": 720,
    "0 0 * * *": 1440,       # daily at midnight
    "0 9 * * *": 1440,       # daily at 9am
    "0 14 * * *": 1440,      # daily at 2pm
    "0 9 * * 1": 10080,      # weekly Monday 9am
    "0 0 1 * *": 43200,      # monthly 1st
    "0 0 15 * *": 43200,     # monthly 15th
}

def parse_cron_interval(cron_expr):
    """Parse a cron expression into approximate minutes until next run."""
    if cron_expr in INTERVALS:
        return INTERVALS[cron_expr]
    parts = cron_expr.split()
    if len(parts) != 5:
        return 360  # default 6 hours
    minute, hour, dom, month, dow = parts
    # */N minute patterns
    if minute.startswith("*/"):
        try: return int(minute[2:])
        except: pass
    # */N hour patterns
    if hour.startswith("*/"):
        try: return int(hour[2:]) * 60
        except: pass
    # Specific hour patterns (daily)
    if hour.isdigit() and minute.isdigit() and dom == "*" and dow == "*":
        return 1440  # daily
    # Specific dow patterns (weekly)
    if dow != "*":
        return 10080  # weekly
    # Specific dom patterns (monthly)
    if dom != "*":
        return 43200  # monthly
    return 360  # default fallback

def api_get(path, params=""):
    req = urllib.request.Request(f"{URL}/{path}?{params}", headers=HEADERS)
    resp = urllib.request.urlopen(req)
    return json.loads(resp.read())

def api_post(path, data):
    req = urllib.request.Request(f"{URL}/{path}", data=json.dumps(data).encode(), headers=HEADERS)
    resp = urllib.request.urlopen(req)
    return json.loads(resp.read())

def api_patch(path, params, data):
    req = urllib.request.Request(f"{URL}/{path}?{params}", data=json.dumps(data).encode(), method="PATCH", headers=HEADERS)
    resp = urllib.request.urlopen(req)
    return json.loads(resp.read())

# Get due tasks
try:
    tasks = api_get("scheduled_tasks", "is_active=eq.true&or=(next_run_at.is.null,next_run_at.lte.now())&limit=5")
except Exception as e:
    print(f"ERROR fetching tasks: {e}", file=sys.stderr)
    sys.exit(0)

if not tasks:
    sys.exit(0)

now = datetime.datetime.utcnow()

for task in tasks:
    config = task.get("task_config") or {}
    prompt = config.get("prompt", "")
    if not prompt:
        continue

    name = task.get("task_name", "unknown")
    cron = task.get("schedule_cron", "0 */6 * * *")
    interval = parse_cron_interval(cron)

    # Check only_if_pending flag
    if config.get("only_if_pending"):
        try:
            pending = api_get("raw_content", "processing_status=eq.pending&select=id&limit=1")
            if not pending:
                # No pending content — skip but update next_run
                next_run = (now + datetime.timedelta(minutes=interval)).isoformat() + "Z"
                api_patch("scheduled_tasks", f"id=eq.{task['id']}", {"next_run_at": next_run})
                continue
        except:
            pass

    # Dispatch to cloud_node_tasks
    try:
        task_data = {
            "prompt": prompt,
            "priority": "normal",
            "skip_permissions": config.get("skip_permissions", True),
            "timeout_minutes": config.get("timeout_minutes", 30),
            "status": "queued",
            "created_at": now.isoformat() + "Z"
        }
        result = api_post("cloud_node_tasks", task_data)
        dispatched_id = result[0]["id"] if isinstance(result, list) else result["id"]

        # Update scheduled_task
        next_run = (now + datetime.timedelta(minutes=interval)).isoformat() + "Z"
        api_patch("scheduled_tasks", f"id=eq.{task['id']}", {
            "last_run_at": now.isoformat() + "Z",
            "last_run_status": "dispatched",
            "next_run_at": next_run,
            "total_runs": (task.get("total_runs") or 0) + 1
        })
        print(f"  + {name} -> {dispatched_id}")
    except Exception as e:
        err = e.read().decode() if hasattr(e, "read") else str(e)
        print(f"  ! {name}: {err[:200]}")
PYEOF

log "Dispatch cycle complete"
