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

# ── All logic in Python for clean JSON handling ──
python3 << 'PYEOF'
import json, urllib.request, datetime, sys

URL = "https://wcdyvukzlxxkgvxomaxr.supabase.co/rest/v1"
KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndjZHl2dWt6bHh4a2d2eG9tYXhyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTY1OTc2OCwiZXhwIjoyMDg1MjM1NzY4fQ.AnjP6QLSbjVjXOKLtL2icevxM3gV1Ab0LtGdQVuzP2U"
HEADERS = {
    "apikey": KEY,
    "Authorization": f"Bearer {KEY}",
    "Content-Type": "application/json",
    "Prefer": "return=representation"
}

# Cron -> minutes interval map
INTERVALS = {
    "*/15 * * * *": 15,
    "*/30 * * * *": 30,
    "0 * * * *": 60,
    "0 */3 * * *": 180,
    "0 */6 * * *": 360,
    "0 */12 * * *": 720,
    "0 14 * * *": 1440,
    "0 9 * * *": 1440,
    "0 9 * * 1": 10080,
}

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
    interval = INTERVALS.get(cron, 360)

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
