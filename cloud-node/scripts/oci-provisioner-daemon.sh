#!/usr/bin/env bash
# ============================================================
# OCI ARM Provisioner Daemon — UNKILLABLE VERSION
# ============================================================
# Battle-hardened daemon that retries OCI ARM instance creation
# until capacity is available. Designed to run unattended.
#
# Features:
#   - Signal-trapped (survives SIGHUP/SIGTERM/SIGPIPE)
#   - Flock-based mutex (only one instance runs)
#   - Cron watchdog companion auto-resurrects it
#   - Multi-AD cycling with rate-limit backoff
#   - Success markers for other tools to detect completion
#
# Usage:
#   Normally launched by oci-provision-launch.sh, not directly.
#   But can be run standalone if OCI CLI is configured:
#     ./oci-provisioner-daemon.sh
#
# Requires:
#   - OCI CLI installed and configured (~/.oci/config)
#   - SSH public key at SSH_KEY_FILE path
#   - cloud-init.sh in same directory (optional)
# ============================================================

set -u

PIDFILE="/tmp/oci-provisioner.pid"
LOGFILE="/tmp/provision-retry.log"
LOCKFILE="/tmp/oci-provisioner.lock"

# ── Configuration (override via env vars or defaults) ──
COMPARTMENT_ID="${OCI_COMPARTMENT_ID:-}"
SUBNET_ID="${OCI_SUBNET_ID:-}"
IMAGE_ID="${OCI_IMAGE_ID:-}"
SSH_KEY_FILE="${OCI_SSH_KEY_FILE:-$HOME/.ssh/oci_instance.pub}"
CLOUD_INIT="${OCI_CLOUD_INIT:-$(cd "$(dirname "$0")" && pwd)/cloud-init.sh}"

# Multi-AD: comma-separated or auto-detect
if [[ -n "${OCI_ADS:-}" ]]; then
    IFS=',' read -ra ADS <<< "$OCI_ADS"
else
    ADS=()
fi

SHAPE="${OCI_SHAPE:-VM.Standard.A1.Flex}"
OCPUS="${OCI_OCPUS:-4}"
MEMORY_GB="${OCI_MEMORY_GB:-24}"
BOOT_VOLUME_GB="${OCI_BOOT_VOLUME_GB:-100}"
DISPLAY_NAME="${OCI_DISPLAY_NAME:-browning-cloud-node}"
RETRY_INTERVAL="${OCI_RETRY_INTERVAL:-45}"

# ── Validate required config ──
if [[ -z "$COMPARTMENT_ID" || -z "$SUBNET_ID" || -z "$IMAGE_ID" ]]; then
    echo "ERROR: Required env vars not set. Need OCI_COMPARTMENT_ID, OCI_SUBNET_ID, OCI_IMAGE_ID"
    echo "Run oci-provision-launch.sh instead — it sets everything up."
    exit 1
fi

if [[ ! -f "$SSH_KEY_FILE" ]]; then
    echo "ERROR: SSH public key not found at $SSH_KEY_FILE"
    exit 1
fi

# ── Auto-detect ADs if not provided ──
if [[ ${#ADS[@]} -eq 0 ]]; then
    AD_LIST=$(oci iam availability-domain list --compartment-id "$COMPARTMENT_ID" 2>/dev/null \
        | python3 -c "import sys,json; [print(d['name']) for d in json.load(sys.stdin)['data']]" 2>/dev/null) || true
    if [[ -n "$AD_LIST" ]]; then
        mapfile -t ADS <<< "$AD_LIST"
    else
        echo "ERROR: Could not detect availability domains. Set OCI_ADS env var."
        exit 1
    fi
fi

# ── Trap signals: ignore SIGHUP/SIGTERM so session death can't kill us ──
trap '' HUP TERM PIPE

# ── Acquire lock (only one instance runs at a time) ──
exec 200>"$LOCKFILE"
flock -n 200 || { echo "Another instance is already running (lockfile: $LOCKFILE)"; exit 0; }

# ── Write PID ──
echo $$ > "$PIDFILE"

# ── Build metadata ──
SSH_KEY=$(cat "$SSH_KEY_FILE")
METADATA="{\"ssh_authorized_keys\": \"$SSH_KEY\"}"
if [[ -f "$CLOUD_INIT" ]]; then
    CLOUD_INIT_B64=$(base64 -w 0 "$CLOUD_INIT")
    METADATA="{\"ssh_authorized_keys\": \"$SSH_KEY\", \"user_data\": \"$CLOUD_INIT_B64\"}"
fi

# ── Resume from last attempt count ──
LAST_ATTEMPT=$(grep -c "^.*Attempt #" "$LOGFILE" 2>/dev/null || echo 0)
attempt=$LAST_ATTEMPT

log() { echo "$(date): $*" >> "$LOGFILE"; }

log "════════════════════════════════════════"
log "DAEMON starting (PID $$, resuming from attempt #$attempt)"
log "Shape: $SHAPE ($OCPUS OCPU / ${MEMORY_GB}GB)"
log "ADs: ${ADS[*]}"
log "Signals trapped: HUP, TERM, PIPE (unkillable)"
log "════════════════════════════════════════"

# ── SUCCESS handler ──
on_success() {
    local instance_id="$1" ad="$2" ip="$3"
    log ""
    log "========================================"
    log "  INSTANCE CREATED SUCCESSFULLY!"
    log "========================================"
    log "Instance ID: $instance_id"
    log "Public IP:   $ip"
    log "AD:          $ad"
    log "Attempt:     #$attempt"
    log ""
    log "SSH: ssh -i ${SSH_KEY_FILE%.pub} ubuntu@$ip"

    # Remove cron watchdog — we're done
    crontab -l 2>/dev/null | grep -v 'oci-provisioner' | crontab - 2>/dev/null || true

    # Write success markers (other tools can check these)
    echo "$instance_id" > /tmp/oci-instance-created.id
    echo "$ip" > /tmp/oci-instance-created.ip
    echo "$ad" > /tmp/oci-instance-created.ad

    rm -f "$PIDFILE" "$LOCKFILE"
    exit 0
}

# ── Main retry loop ──
while true; do
    for AD in "${ADS[@]}"; do
        attempt=$((attempt + 1))

        log "Attempt #$attempt — $AD ($OCPUS OCPU / ${MEMORY_GB}GB)"

        RESULT=$(oci compute instance launch \
            --compartment-id "$COMPARTMENT_ID" \
            --availability-domain "$AD" \
            --shape "$SHAPE" \
            --shape-config "{\"ocpus\": $OCPUS, \"memoryInGBs\": $MEMORY_GB}" \
            --image-id "$IMAGE_ID" \
            --subnet-id "$SUBNET_ID" \
            --boot-volume-size-in-gbs "$BOOT_VOLUME_GB" \
            --display-name "$DISPLAY_NAME" \
            --metadata "$METADATA" \
            --assign-public-ip true \
            2>&1) || true

        # Check for success
        if echo "$RESULT" | grep -q '"lifecycle-state"'; then
            INSTANCE_ID=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])" 2>/dev/null)
            PUBLIC_IP=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin)['data']; print(d.get('primary-public-ip','pending'))" 2>/dev/null || echo "pending")
            on_success "$INSTANCE_ID" "$AD" "$PUBLIC_IP"
        fi

        # Parse failure reason
        if echo "$RESULT" | grep -qi "out of host capacity\|out of capacity\|InternalError\|LimitExceeded"; then
            log "  → Out of capacity"
        elif echo "$RESULT" | grep -qi "TooManyRequests\|429\|rate"; then
            log "  → Rate limited — backing off 120s"
            sleep 120
            continue
        else
            ERROR_MSG=$(echo "$RESULT" | head -5 | tr '\n' ' ')
            log "  → Error: $ERROR_MSG"
        fi

        sleep "$RETRY_INTERVAL"
    done
done
