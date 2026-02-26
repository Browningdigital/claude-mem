#!/usr/bin/env bash
# Oracle Cloud Free ARM Instance Provisioner
# Retries instance creation until capacity is available.
#
# Prerequisites:
#   1. Oracle Cloud account (upgraded to Pay-As-You-Go — still $0 for Always Free)
#   2. OCI CLI installed: https://docs.oracle.com/en-us/iaas/Content/API/SDKDocs/cliinstall.htm
#   3. Run `oci setup config` to authenticate
#   4. Fill in the variables below from your Oracle Cloud console
#
# Usage: ./provision-oracle.sh

set -euo pipefail

# ──────────────────────────────────────────────
# CONFIGURE THESE — get from Oracle Cloud Console
# ──────────────────────────────────────────────
COMPARTMENT_ID="${OCI_COMPARTMENT_ID:-}"           # OCI Console → Identity → Compartments → root compartment OCID
AVAILABILITY_DOMAIN="${OCI_AVAILABILITY_DOMAIN:-}" # OCI Console → Compute → Availability Domains (e.g., "NvCA:US-CHICAGO-1-AD-1")
SUBNET_ID="${OCI_SUBNET_ID:-}"                     # OCI Console → Networking → VCN → Subnet OCID
IMAGE_ID="${OCI_IMAGE_ID:-}"                        # Ubuntu 24.04 Minimal aarch64 — find at: OCI Console → Compute → Images → filter "Ubuntu" + "aarch64"
SSH_PUBLIC_KEY_FILE="${OCI_SSH_KEY_FILE:-$HOME/.ssh/id_rsa.pub}"

# Instance spec (Always Free ARM maximums)
SHAPE="VM.Standard.A1.Flex"
OCPUS="${OCI_OCPUS:-4}"
MEMORY_GB="${OCI_MEMORY_GB:-24}"
BOOT_VOLUME_GB="${OCI_BOOT_VOLUME_GB:-100}"   # Free tier allows up to 200GB total (can use 2x100GB)
DISPLAY_NAME="${OCI_DISPLAY_NAME:-browning-cloud-node}"

# Retry config
RETRY_INTERVAL="${OCI_RETRY_INTERVAL:-45}"    # seconds between attempts
MAX_RETRIES="${OCI_MAX_RETRIES:-0}"           # 0 = unlimited (keep trying until success)
LOG_FILE="/tmp/oracle-provision.log"

# Multi-AD cycling — tries all ADs in the region before sleeping
CYCLE_ADS="${OCI_CYCLE_ADS:-true}"

# ──────────────────────────────────────────────
# Validation
# ──────────────────────────────────────────────
# Auto-detect ADs if cycling enabled and no specific AD set
if [[ "$CYCLE_ADS" == "true" && -z "$AVAILABILITY_DOMAIN" ]]; then
    echo "Auto-detecting availability domains..."
    AD_LIST=$(oci iam availability-domain list --compartment-id "$COMPARTMENT_ID" 2>/dev/null \
        | python3 -c "import sys,json; [print(d['name']) for d in json.load(sys.stdin)['data']]" 2>/dev/null) || true
    if [[ -n "$AD_LIST" ]]; then
        mapfile -t ADS <<< "$AD_LIST"
        echo "Found ${#ADS[@]} availability domains: ${ADS[*]}"
    else
        echo "ERROR: Could not auto-detect ADs. Set AVAILABILITY_DOMAIN manually."
        exit 1
    fi
elif [[ -n "$AVAILABILITY_DOMAIN" ]]; then
    ADS=("$AVAILABILITY_DOMAIN")
else
    echo "ERROR: Set OCI_AVAILABILITY_DOMAIN or OCI_COMPARTMENT_ID for auto-detect."
    exit 1
fi

if [[ -z "$COMPARTMENT_ID" || -z "$SUBNET_ID" || -z "$IMAGE_ID" ]]; then
    echo "ERROR: Fill in COMPARTMENT_ID, SUBNET_ID, and IMAGE_ID before running."
    echo ""
    echo "Set via environment variables or edit this script:"
    echo "  OCI_COMPARTMENT_ID     OCI Console → Identity & Security → Compartments → root OCID"
    echo "  OCI_SUBNET_ID          OCI Console → Networking → VCN → Subnet OCID"
    echo "  OCI_IMAGE_ID           OCI Console → Compute → Images → 'Canonical Ubuntu 24.04 Minimal aarch64'"
    echo "  OCI_AVAILABILITY_DOMAIN  (optional — auto-detected if OCI_CYCLE_ADS=true)"
    exit 1
fi

if ! command -v oci &> /dev/null; then
    echo "ERROR: OCI CLI not installed. Install: pip install oci-cli"
    exit 1
fi

if [[ ! -f "$SSH_PUBLIC_KEY_FILE" ]]; then
    echo "ERROR: SSH public key not found at $SSH_PUBLIC_KEY_FILE"
    echo "Generate one: ssh-keygen -t ed25519"
    exit 1
fi

SSH_KEY=$(cat "$SSH_PUBLIC_KEY_FILE")

# Cloud-init user data (if cloud-init.sh exists next to this script)
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLOUD_INIT_FILE="${OCI_CLOUD_INIT:-$SCRIPT_DIR/cloud-init.sh}"
METADATA="{\"ssh_authorized_keys\": \"$SSH_KEY\"}"
if [[ -f "$CLOUD_INIT_FILE" ]]; then
    CLOUD_INIT_B64=$(base64 -w 0 "$CLOUD_INIT_FILE")
    METADATA="{\"ssh_authorized_keys\": \"$SSH_KEY\", \"user_data\": \"$CLOUD_INIT_B64\"}"
    echo "Cloud-init script: $CLOUD_INIT_FILE"
fi

# ──────────────────────────────────────────────
# Provision loop — cycles all ADs
# ──────────────────────────────────────────────
attempt=0
echo "$(date): Starting Oracle Cloud ARM provisioner" | tee -a "$LOG_FILE"
echo "Shape: $SHAPE ($OCPUS OCPUs, ${MEMORY_GB}GB RAM, ${BOOT_VOLUME_GB}GB boot)" | tee -a "$LOG_FILE"
echo "ADs: ${ADS[*]}" | tee -a "$LOG_FILE"
echo "Retry interval: ${RETRY_INTERVAL}s between each AD attempt" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

while true; do
    for AD in "${ADS[@]}"; do
        attempt=$((attempt + 1))

        if [[ $MAX_RETRIES -gt 0 && $attempt -gt $MAX_RETRIES ]]; then
            echo "$(date): Max retries ($MAX_RETRIES) reached. Giving up." | tee -a "$LOG_FILE"
            exit 1
        fi

        echo "$(date): Attempt #$attempt — $AD" | tee -a "$LOG_FILE"

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

        if echo "$RESULT" | grep -q '"lifecycle-state"'; then
            INSTANCE_ID=$(echo "$RESULT" | python3 -c "import sys,json; print(json.load(sys.stdin)['data']['id'])")
            PUBLIC_IP=$(echo "$RESULT" | python3 -c "import sys,json; d=json.load(sys.stdin)['data']; print(d.get('primary-public-ip','pending'))" 2>/dev/null || echo "pending")

            echo "" | tee -a "$LOG_FILE"
            echo "========================================" | tee -a "$LOG_FILE"
            echo "  INSTANCE CREATED SUCCESSFULLY!" | tee -a "$LOG_FILE"
            echo "========================================" | tee -a "$LOG_FILE"
            echo "Instance ID: $INSTANCE_ID" | tee -a "$LOG_FILE"
            echo "Public IP:   $PUBLIC_IP" | tee -a "$LOG_FILE"
            echo "AD:          $AD" | tee -a "$LOG_FILE"
            echo "" | tee -a "$LOG_FILE"
            echo "If IP shows 'pending', get it with:" | tee -a "$LOG_FILE"
            echo "  oci compute instance list-vnics --instance-id $INSTANCE_ID | python3 -c \"import sys,json; print(json.load(sys.stdin)['data'][0]['public-ip'])\"" | tee -a "$LOG_FILE"
            echo "" | tee -a "$LOG_FILE"
            echo "SSH in with:" | tee -a "$LOG_FILE"
            echo "  ssh ubuntu@<PUBLIC_IP>" | tee -a "$LOG_FILE"
            echo "" | tee -a "$LOG_FILE"
            echo "Then run the bootstrap script:" | tee -a "$LOG_FILE"
            echo "  curl -fsSL https://raw.githubusercontent.com/Browningdigital/claude-mem/main/cloud-node/scripts/bootstrap.sh | bash" | tee -a "$LOG_FILE"
            exit 0
        fi

        if echo "$RESULT" | grep -qi "out of host capacity\|out of capacity\|InternalError\|LimitExceeded"; then
            echo "$(date): Out of capacity on $AD. Next AD in ${RETRY_INTERVAL}s..." | tee -a "$LOG_FILE"
        else
            echo "$(date): Unexpected error on $AD:" | tee -a "$LOG_FILE"
            echo "$RESULT" | tee -a "$LOG_FILE"
            echo "Next AD in ${RETRY_INTERVAL}s..." | tee -a "$LOG_FILE"
        fi

        sleep "$RETRY_INTERVAL"
    done
done
