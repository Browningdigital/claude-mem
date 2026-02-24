#!/usr/bin/env bash
# ============================================================
# OCI Provision Launcher — One Command Setup
# ============================================================
# Sets up EVERYTHING needed to run the ARM provisioner daemon:
#   1. Installs OCI CLI (if missing)
#   2. Pulls OCI credentials from Browning Memory / Supabase
#   3. Writes ~/.oci/config
#   4. Generates SSH keypair (if missing)
#   5. Writes env file for daemon
#   6. Starts the daemon + cron watchdog
#
# Usage:
#   ./oci-provision-launch.sh                    # auto-fetch creds from Supabase
#   ./oci-provision-launch.sh --status           # check current status
#   ./oci-provision-launch.sh --stop             # kill daemon + remove cron
#   ./oci-provision-launch.sh --logs             # tail the retry log
#
# Or set env vars to skip Supabase lookup:
#   OCI_COMPARTMENT_ID=... OCI_SUBNET_ID=... OCI_IMAGE_ID=... ./oci-provision-launch.sh
# ============================================================

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DAEMON="$SCRIPT_DIR/oci-provisioner-daemon.sh"
WATCHDOG="$SCRIPT_DIR/oci-provisioner-watchdog.sh"
ENV_FILE="/tmp/oci-provisioner.env"
LOGFILE="/tmp/provision-retry.log"
PIDFILE="/tmp/oci-provisioner.pid"
SUCCESS_ID="/tmp/oci-instance-created.id"
SUCCESS_IP="/tmp/oci-instance-created.ip"

# ── Supabase config for credential lookup ──
SUPABASE_API="https://api.supabase.com/v1/projects/wcdyvukzlxxkgvxomaxr/database/query"
SUPABASE_TOKEN="sbp_77f3a4025505ccf2e7dfa518913224b79fab3dd1"

# ── Colors ──
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; CYAN='\033[0;36m'; NC='\033[0m'

info()  { echo -e "${CYAN}[INFO]${NC} $*"; }
ok()    { echo -e "${GREEN}[OK]${NC} $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC} $*"; }
err()   { echo -e "${RED}[ERROR]${NC} $*"; }

# ══════════════════════════════════════════
# Subcommands
# ══════════════════════════════════════════

cmd_status() {
    echo ""
    echo "═══════════════════════════════════════"
    echo "  OCI Provisioner Status"
    echo "═══════════════════════════════════════"

    if [[ -f "$SUCCESS_ID" ]]; then
        ok "Instance created!"
        echo "  Instance ID: $(cat "$SUCCESS_ID")"
        echo "  Public IP:   $(cat "$SUCCESS_IP" 2>/dev/null || echo 'unknown')"
        echo "  AD:          $(cat /tmp/oci-instance-created.ad 2>/dev/null || echo 'unknown')"
        return 0
    fi

    if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
        ok "Daemon is running (PID $(cat "$PIDFILE"))"
    else
        warn "Daemon is NOT running"
    fi

    # Check cron
    if crontab -l 2>/dev/null | grep -q 'oci-provisioner'; then
        ok "Watchdog cron is active"
    else
        warn "Watchdog cron is NOT installed"
    fi

    # Last attempt
    if [[ -f "$LOGFILE" ]]; then
        ATTEMPTS=$(grep -c "Attempt #" "$LOGFILE" 2>/dev/null || echo 0)
        LAST_LINE=$(tail -1 "$LOGFILE" 2>/dev/null || echo "no log")
        echo "  Attempts so far: $ATTEMPTS"
        echo "  Last log entry:  $LAST_LINE"
    else
        echo "  No log file yet."
    fi
    echo ""
}

cmd_stop() {
    info "Stopping provisioner..."
    # Remove cron
    crontab -l 2>/dev/null | grep -v 'oci-provisioner' | crontab - 2>/dev/null || true
    ok "Watchdog cron removed"

    # Kill daemon
    if [[ -f "$PIDFILE" ]]; then
        PID=$(cat "$PIDFILE")
        kill -9 "$PID" 2>/dev/null || true
        rm -f "$PIDFILE" /tmp/oci-provisioner.lock
        ok "Daemon killed (PID $PID)"
    else
        warn "No daemon PID found"
    fi
}

cmd_logs() {
    if [[ -f "$LOGFILE" ]]; then
        tail -50 "$LOGFILE"
    else
        echo "No log file at $LOGFILE"
    fi
}

# Handle subcommands
case "${1:-}" in
    --status|-s) cmd_status; exit 0 ;;
    --stop)      cmd_stop; exit 0 ;;
    --logs|-l)   cmd_logs; exit 0 ;;
    --help|-h)
        echo "Usage: $0 [--status|--stop|--logs|--help]"
        echo ""
        echo "  (no args)   Launch the provisioner daemon"
        echo "  --status    Check daemon status and attempt count"
        echo "  --stop      Kill daemon and remove cron watchdog"
        echo "  --logs      Tail the last 50 log lines"
        exit 0 ;;
esac

# ══════════════════════════════════════════
# Pre-flight checks
# ══════════════════════════════════════════

# Already running?
if [[ -f "$SUCCESS_ID" ]]; then
    ok "Instance already created!"
    cmd_status
    exit 0
fi

if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    warn "Daemon already running (PID $(cat "$PIDFILE")). Use --status or --stop."
    exit 0
fi

# ── Step 1: OCI CLI ──
if ! command -v oci &>/dev/null; then
    info "Installing OCI CLI..."
    pip install oci-cli 2>/dev/null || pip3 install oci-cli 2>/dev/null
    ok "OCI CLI installed"
else
    ok "OCI CLI found: $(which oci)"
fi

# ── Step 2: OCI credentials ──
if [[ -z "${OCI_COMPARTMENT_ID:-}" || -z "${OCI_SUBNET_ID:-}" || -z "${OCI_IMAGE_ID:-}" ]]; then
    info "Fetching OCI credentials from Supabase..."

    OCI_CREDS=$(curl -sf -X POST "$SUPABASE_API" \
        -H "Authorization: Bearer $SUPABASE_TOKEN" \
        -H "Content-Type: application/json" \
        --data-binary '{"query": "SELECT state_value FROM claude_system_state WHERE state_key = '\''oracle_cloud_credentials'\''"}' \
        2>/dev/null) || true

    if [[ -n "$OCI_CREDS" ]] && echo "$OCI_CREDS" | python3 -c "import sys,json; json.load(sys.stdin)" &>/dev/null; then
        # Parse the JSON credential blob
        CRED_JSON=$(echo "$OCI_CREDS" | python3 -c "
import sys, json
rows = json.load(sys.stdin)
if rows and len(rows) > 0:
    val = rows[0].get('state_value', '{}')
    if isinstance(val, str):
        print(val)
    else:
        print(json.dumps(val))
" 2>/dev/null) || true

        if [[ -n "$CRED_JSON" ]]; then
            # Extract individual fields
            extract() { echo "$CRED_JSON" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('$1',''))" 2>/dev/null; }

            OCI_COMPARTMENT_ID="${OCI_COMPARTMENT_ID:-$(extract compartment_id)}"
            OCI_SUBNET_ID="${OCI_SUBNET_ID:-$(extract subnet_id)}"
            OCI_IMAGE_ID="${OCI_IMAGE_ID:-$(extract image_id)}"
            OCI_TENANCY="${OCI_TENANCY:-$(extract tenancy)}"
            OCI_USER="${OCI_USER:-$(extract user)}"
            OCI_FINGERPRINT="${OCI_FINGERPRINT:-$(extract fingerprint)}"
            OCI_REGION="${OCI_REGION:-$(extract region)}"
            OCI_KEY_CONTENT="${OCI_KEY_CONTENT:-$(extract key_content)}"
            OCI_ADS="${OCI_ADS:-$(extract availability_domains)}"

            ok "Credentials loaded from Supabase"
        fi
    fi

    # Still missing? Try generic credential store
    if [[ -z "${OCI_COMPARTMENT_ID:-}" ]]; then
        warn "oracle_cloud_credentials not found. Trying 'oracle' key..."
        OCI_CREDS=$(curl -sf -X POST "$SUPABASE_API" \
            -H "Authorization: Bearer $SUPABASE_TOKEN" \
            -H "Content-Type: application/json" \
            --data-binary '{"query": "SELECT state_value FROM claude_system_state WHERE state_key LIKE '\''%oracle%'\'' OR state_key LIKE '\''%oci%'\''"}' \
            2>/dev/null) || true

        if [[ -n "$OCI_CREDS" ]]; then
            info "Found credential rows — printing for manual extraction:"
            echo "$OCI_CREDS" | python3 -m json.tool 2>/dev/null || echo "$OCI_CREDS"
        fi
    fi
fi

# Final validation
if [[ -z "${OCI_COMPARTMENT_ID:-}" || -z "${OCI_SUBNET_ID:-}" || -z "${OCI_IMAGE_ID:-}" ]]; then
    err "Missing required OCI configuration."
    echo ""
    echo "Set these env vars and re-run:"
    echo "  export OCI_COMPARTMENT_ID='ocid1.tenancy.oc1...'      # Tenancy/Compartment OCID"
    echo "  export OCI_SUBNET_ID='ocid1.subnet.oc1...'            # Subnet OCID"
    echo "  export OCI_IMAGE_ID='ocid1.image.oc1...'              # Ubuntu ARM64 image OCID"
    echo ""
    echo "Optional:"
    echo "  export OCI_ADS='AD-1,AD-2,AD-3'                       # Comma-separated ADs (auto-detected if omitted)"
    echo "  export OCI_OCPUS=4                                     # CPU count (default: 4)"
    echo "  export OCI_MEMORY_GB=24                                # RAM in GB (default: 24)"
    echo "  export OCI_SSH_KEY_FILE=~/.ssh/oci_instance.pub        # SSH public key path"
    exit 1
fi

# ── Step 3: OCI CLI config ──
if [[ ! -f "$HOME/.oci/config" ]] && [[ -n "${OCI_TENANCY:-}" ]]; then
    info "Writing OCI CLI config..."
    mkdir -p "$HOME/.oci"
    chmod 700 "$HOME/.oci"

    # Write API key if provided
    OCI_KEY_PATH="$HOME/.oci/oci_api_key.pem"
    if [[ -n "${OCI_KEY_CONTENT:-}" ]]; then
        echo "$OCI_KEY_CONTENT" > "$OCI_KEY_PATH"
        chmod 600 "$OCI_KEY_PATH"
    fi

    cat > "$HOME/.oci/config" <<OCIEOF
[DEFAULT]
user=${OCI_USER:-}
fingerprint=${OCI_FINGERPRINT:-}
tenancy=${OCI_TENANCY:-}
region=${OCI_REGION:-us-chicago-1}
key_file=${OCI_KEY_PATH}
OCIEOF
    chmod 600 "$HOME/.oci/config"
    ok "OCI CLI config written to ~/.oci/config"
elif [[ -f "$HOME/.oci/config" ]]; then
    ok "OCI CLI config exists"
fi

# ── Step 4: SSH key ──
SSH_KEY_FILE="${OCI_SSH_KEY_FILE:-$HOME/.ssh/oci_instance.pub}"
if [[ ! -f "$SSH_KEY_FILE" ]]; then
    info "Generating SSH keypair..."
    mkdir -p "$(dirname "$SSH_KEY_FILE")"
    ssh-keygen -t ed25519 -f "${SSH_KEY_FILE%.pub}" -N "" -C "oci-provisioner-$(date +%Y%m%d)"
    ok "SSH key generated at $SSH_KEY_FILE"
else
    ok "SSH key found: $SSH_KEY_FILE"
fi

# ── Step 5: Write env file for daemon ──
info "Writing daemon env file..."
cat > "$ENV_FILE" <<ENVEOF
OCI_COMPARTMENT_ID=${OCI_COMPARTMENT_ID}
OCI_SUBNET_ID=${OCI_SUBNET_ID}
OCI_IMAGE_ID=${OCI_IMAGE_ID}
OCI_SSH_KEY_FILE=${SSH_KEY_FILE}
OCI_CLOUD_INIT=${SCRIPT_DIR}/cloud-init.sh
OCI_ADS=${OCI_ADS:-}
OCI_SHAPE=${OCI_SHAPE:-VM.Standard.A1.Flex}
OCI_OCPUS=${OCI_OCPUS:-4}
OCI_MEMORY_GB=${OCI_MEMORY_GB:-24}
OCI_BOOT_VOLUME_GB=${OCI_BOOT_VOLUME_GB:-100}
OCI_DISPLAY_NAME=${OCI_DISPLAY_NAME:-browning-cloud-node}
OCI_RETRY_INTERVAL=${OCI_RETRY_INTERVAL:-45}
ENVEOF
ok "Env file written to $ENV_FILE"

# ── Step 6: Make scripts executable ──
chmod +x "$DAEMON" "$WATCHDOG"

# ── Step 7: Install cron watchdog ──
info "Installing cron watchdog..."
# Remove any existing oci-provisioner cron entry first
EXISTING_CRON=$(crontab -l 2>/dev/null | grep -v 'oci-provisioner' || true)
echo "$EXISTING_CRON
* * * * * $WATCHDOG" | crontab -
ok "Watchdog cron installed (runs every 60s)"

# ── Step 8: Launch daemon ──
info "Starting provisioner daemon..."

# Source env into current shell for daemon
set -a
source "$ENV_FILE"
set +a

# Launch as detached daemon
setsid nohup "$DAEMON" </dev/null >/dev/null 2>&1 &
disown

sleep 2

if [[ -f "$PIDFILE" ]] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    ok "Daemon running (PID $(cat "$PIDFILE"))"
else
    err "Daemon failed to start. Check $LOGFILE"
    tail -10 "$LOGFILE" 2>/dev/null
    exit 1
fi

echo ""
echo "═══════════════════════════════════════════════"
echo "  OCI ARM Provisioner — LAUNCHED"
echo "═══════════════════════════════════════════════"
echo ""
echo "  Monitor:  $0 --status"
echo "  Logs:     $0 --logs"
echo "  Stop:     $0 --stop"
echo "  Log file: $LOGFILE"
echo ""
echo "  The daemon will retry every ${OCI_RETRY_INTERVAL:-45}s across"
echo "  all availability domains until capacity is found."
echo "  Cron watchdog will resurrect it if killed."
echo ""
