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
COMPARTMENT_ID=""          # OCI Console → Identity → Compartments → root compartment OCID
AVAILABILITY_DOMAIN=""     # OCI Console → Compute → Availability Domains (e.g., "Iztk:US-ASHBURN-AD-1")
SUBNET_ID=""               # OCI Console → Networking → VCN → Subnet OCID
IMAGE_ID=""                # Ubuntu 22.04 Minimal aarch64 — find at: OCI Console → Compute → Images → filter "Ubuntu" + "aarch64"
SSH_PUBLIC_KEY_FILE="$HOME/.ssh/id_rsa.pub"

# Instance spec (Always Free ARM maximums)
SHAPE="VM.Standard.A1.Flex"
OCPUS=4
MEMORY_GB=24
BOOT_VOLUME_GB=100         # Free tier allows up to 200GB total (can use 2x100GB)
DISPLAY_NAME="browning-cloud-node"

# Retry config
RETRY_INTERVAL=60          # seconds between attempts
MAX_RETRIES=0              # 0 = unlimited (keep trying until success)
LOG_FILE="/tmp/oracle-provision.log"

# ──────────────────────────────────────────────
# Validation
# ──────────────────────────────────────────────
if [[ -z "$COMPARTMENT_ID" || -z "$AVAILABILITY_DOMAIN" || -z "$SUBNET_ID" || -z "$IMAGE_ID" ]]; then
    echo "ERROR: Fill in COMPARTMENT_ID, AVAILABILITY_DOMAIN, SUBNET_ID, and IMAGE_ID before running."
    echo ""
    echo "To find these values:"
    echo "  COMPARTMENT_ID:     OCI Console → Identity & Security → Compartments → copy root OCID"
    echo "  AVAILABILITY_DOMAIN: OCI Console → Compute → Instances → Create Instance → look at AD dropdown"
    echo "  SUBNET_ID:          OCI Console → Networking → Virtual Cloud Networks → your VCN → Subnets → copy OCID"
    echo "  IMAGE_ID:           OCI Console → Compute → Images → search 'Canonical Ubuntu 22.04 Minimal aarch64'"
    exit 1
fi

if ! command -v oci &> /dev/null; then
    echo "ERROR: OCI CLI not installed. Install from: https://docs.oracle.com/en-us/iaas/Content/API/SDKDocs/cliinstall.htm"
    exit 1
fi

if [[ ! -f "$SSH_PUBLIC_KEY_FILE" ]]; then
    echo "ERROR: SSH public key not found at $SSH_PUBLIC_KEY_FILE"
    echo "Generate one: ssh-keygen -t ed25519"
    exit 1
fi

SSH_KEY=$(cat "$SSH_PUBLIC_KEY_FILE")

# ──────────────────────────────────────────────
# Provision loop
# ──────────────────────────────────────────────
attempt=0
echo "$(date): Starting Oracle Cloud ARM provisioner" | tee -a "$LOG_FILE"
echo "Shape: $SHAPE ($OCPUS OCPUs, ${MEMORY_GB}GB RAM, ${BOOT_VOLUME_GB}GB boot)" | tee -a "$LOG_FILE"
echo "Retry interval: ${RETRY_INTERVAL}s" | tee -a "$LOG_FILE"
echo "" | tee -a "$LOG_FILE"

while true; do
    attempt=$((attempt + 1))

    if [[ $MAX_RETRIES -gt 0 && $attempt -gt $MAX_RETRIES ]]; then
        echo "$(date): Max retries ($MAX_RETRIES) reached. Giving up." | tee -a "$LOG_FILE"
        exit 1
    fi

    echo "$(date): Attempt #$attempt..." | tee -a "$LOG_FILE"

    RESULT=$(oci compute instance launch \
        --compartment-id "$COMPARTMENT_ID" \
        --availability-domain "$AVAILABILITY_DOMAIN" \
        --shape "$SHAPE" \
        --shape-config "{\"ocpus\": $OCPUS, \"memoryInGBs\": $MEMORY_GB}" \
        --image-id "$IMAGE_ID" \
        --subnet-id "$SUBNET_ID" \
        --boot-volume-size-in-gbs "$BOOT_VOLUME_GB" \
        --display-name "$DISPLAY_NAME" \
        --metadata "{\"ssh_authorized_keys\": \"$SSH_KEY\"}" \
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
        echo "$(date): Out of capacity. Retrying in ${RETRY_INTERVAL}s..." | tee -a "$LOG_FILE"
    else
        echo "$(date): Unexpected error:" | tee -a "$LOG_FILE"
        echo "$RESULT" | tee -a "$LOG_FILE"
        echo "Retrying in ${RETRY_INTERVAL}s..." | tee -a "$LOG_FILE"
    fi

    sleep "$RETRY_INTERVAL"
done
