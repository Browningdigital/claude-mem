#!/usr/bin/env bash
# Browning Cloud Node — Cloudflare Tunnel Setup
# Exposes code-server + ttyd through Cloudflare with zero open ports.
#
# Prerequisites:
#   - cloudflared installed (done by bootstrap.sh)
#   - A domain managed by Cloudflare (browningdigital.com or similar)
#
# Usage: ./setup-tunnel.sh

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

log() { echo -e "${GREEN}[$(date '+%H:%M:%S')]${NC} $1"; }

TUNNEL_NAME="browning-cloud-node"
DOMAIN=""  # e.g., browningdigital.com

echo ""
echo "Cloudflare Tunnel Setup for Browning Cloud Node"
echo "================================================"
echo ""

# ──────────────────────────────────────────────
# Step 1: Authenticate with Cloudflare
# ──────────────────────────────────────────────
if [[ ! -f "$HOME/.cloudflared/cert.pem" ]]; then
    log "Authenticating with Cloudflare..."
    echo "A browser URL will appear. Open it on your phone/laptop to authorize."
    cloudflared tunnel login
else
    log "Already authenticated with Cloudflare."
fi

# ──────────────────────────────────────────────
# Step 2: Create tunnel
# ──────────────────────────────────────────────
EXISTING=$(cloudflared tunnel list --output json 2>/dev/null | jq -r ".[] | select(.name==\"$TUNNEL_NAME\") | .id" || true)

if [[ -n "$EXISTING" ]]; then
    TUNNEL_ID="$EXISTING"
    log "Tunnel '$TUNNEL_NAME' already exists: $TUNNEL_ID"
else
    log "Creating tunnel: $TUNNEL_NAME"
    cloudflared tunnel create "$TUNNEL_NAME"
    TUNNEL_ID=$(cloudflared tunnel list --output json | jq -r ".[] | select(.name==\"$TUNNEL_NAME\") | .id")
    log "Tunnel created: $TUNNEL_ID"
fi

# ──────────────────────────────────────────────
# Step 3: Write tunnel config
# ──────────────────────────────────────────────
log "Writing tunnel configuration..."

if [[ -z "$DOMAIN" ]]; then
    read -rp "Enter your Cloudflare domain (e.g., browningdigital.com): " DOMAIN
fi

CREDS_FILE="$HOME/.cloudflared/${TUNNEL_ID}.json"

mkdir -p "$HOME/.cloudflared"
cat > "$HOME/.cloudflared/config.yml" <<EOF
tunnel: ${TUNNEL_ID}
credentials-file: ${CREDS_FILE}

ingress:
  # VS Code (code-server) — full IDE in browser
  - hostname: code.${DOMAIN}
    service: http://localhost:8080
    originRequest:
      noTLSVerify: true

  # Web terminal (ttyd) — lightweight Claude Code CLI
  - hostname: term.${DOMAIN}
    service: http://localhost:7681
    originRequest:
      noTLSVerify: true

  # Catch-all
  - service: http_status:404
EOF

log "Config written to $HOME/.cloudflared/config.yml"
echo ""
echo "  Routes:"
echo "    code.${DOMAIN} → code-server (VS Code IDE)"
echo "    term.${DOMAIN} → ttyd (web terminal)"
echo ""

# ──────────────────────────────────────────────
# Step 4: Create DNS routes
# ──────────────────────────────────────────────
log "Creating DNS routes..."
cloudflared tunnel route dns "$TUNNEL_NAME" "code.${DOMAIN}" 2>/dev/null || warn "DNS route code.${DOMAIN} may already exist"
cloudflared tunnel route dns "$TUNNEL_NAME" "term.${DOMAIN}" 2>/dev/null || warn "DNS route term.${DOMAIN} may already exist"

# ──────────────────────────────────────────────
# Step 5: Install as system service
# ──────────────────────────────────────────────
log "Installing cloudflared as system service..."
sudo cloudflared service install
sudo systemctl enable cloudflared
sudo systemctl start cloudflared

log "Tunnel is LIVE."
echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  TUNNEL ACTIVE${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "  Access from iPhone Safari:"
echo "    IDE:      https://code.${DOMAIN}"
echo "    Terminal: https://term.${DOMAIN}"
echo ""
echo -e "${YELLOW}  IMPORTANT: Set up Cloudflare Access to protect these endpoints.${NC}"
echo "  Go to: https://one.dash.cloudflare.com → Access → Applications"
echo "  Create a self-hosted app for code.${DOMAIN} and term.${DOMAIN}"
echo "  Add an email OTP policy for devin@browningdigital.com"
echo ""
echo "  Or run the access setup via API — see cloud-node/scripts/setup-access.sh"
echo ""
