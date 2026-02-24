#!/usr/bin/env bash
# ============================================================
# OCI Provisioner Watchdog — runs via cron every minute
# ============================================================
# If the daemon is dead, restart it.
# If instance already created, do nothing.
#
# Install into cron:
#   echo "* * * * * $(pwd)/oci-provisioner-watchdog.sh" | crontab -
# ============================================================

PIDFILE="/tmp/oci-provisioner.pid"
SUCCESS_MARKER="/tmp/oci-instance-created.id"
LOGFILE="/tmp/provision-retry.log"
DAEMON="$(cd "$(dirname "$0")" && pwd)/oci-provisioner-daemon.sh"
ENV_FILE="/tmp/oci-provisioner.env"

# Already succeeded? Done.
if [[ -f "$SUCCESS_MARKER" ]]; then
    exit 0
fi

# Check if daemon is running
if [[ -f "$PIDFILE" ]]; then
    PID=$(cat "$PIDFILE")
    if kill -0 "$PID" 2>/dev/null; then
        exit 0
    fi
fi

# Daemon is dead — resurrect it
echo "$(date): WATCHDOG — Daemon dead, restarting" >> "$LOGFILE"

# Source env file if it exists (contains OCI_* vars from launcher)
if [[ -f "$ENV_FILE" ]]; then
    set -a
    source "$ENV_FILE"
    set +a
fi

# Start as fully detached daemon
setsid nohup "$DAEMON" </dev/null >/dev/null 2>&1 &
disown

sleep 1
echo "$(date): WATCHDOG — Daemon restarted (PID: $(cat "$PIDFILE" 2>/dev/null || echo 'pending'))" >> "$LOGFILE"
