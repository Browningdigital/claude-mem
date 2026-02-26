#!/usr/bin/env bash
# Browning Cloud Node — Cloudflare Access Setup
# Creates Zero Trust access policies to protect code-server and ttyd.
# Only allows devin@browningdigital.com via email OTP.
#
# Uses Cloudflare API with your existing credentials.

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'
log() { echo -e "${GREEN}[$(date '+%H:%M:%S')]${NC} $1"; }

ACCOUNT_ID="b58ddf38aeebb77c0ec4c829ea42adf5"
DOMAIN=""  # Set your domain, e.g., browningdigital.com
ALLOWED_EMAIL="devin@browningdigital.com"

# Auth — use global API key
CF_AUTH_EMAIL="devin@browningdigital.com"
CF_AUTH_KEY=""  # Will be fetched from task-watcher env or prompted

if [[ -z "$DOMAIN" ]]; then
    read -rp "Enter your Cloudflare domain (e.g., browningdigital.com): " DOMAIN
fi

if [[ -z "$CF_AUTH_KEY" ]]; then
    # Try environment or task-watcher env file
    if [[ -f /etc/browning/task-watcher.env ]]; then
        source /etc/browning/task-watcher.env 2>/dev/null || true
    fi
    if [[ -z "$CF_AUTH_KEY" ]]; then
        read -rsp "Enter Cloudflare Global API Key: " CF_AUTH_KEY
        echo ""
        if [[ -z "$CF_AUTH_KEY" ]]; then
            echo "FATAL: Cloudflare API key is required."
            exit 1
        fi
    fi
fi

cf_api() {
    local method="$1"
    local endpoint="$2"
    local data="${3:-}"

    local args=(
        -s
        -X "$method"
        -H "X-Auth-Email: ${CF_AUTH_EMAIL}"
        -H "X-Auth-Key: ${CF_AUTH_KEY}"
        -H "Content-Type: application/json"
    )

    if [[ -n "$data" ]]; then
        args+=(-d "$data")
    fi

    curl "${args[@]}" "https://api.cloudflare.com/client/v4${endpoint}"
}

# ──────────────────────────────────────────────
# Step 1: Create Access Application for code-server
# ──────────────────────────────────────────────
log "Creating Access application for code.${DOMAIN}..."

CODE_APP=$(cf_api POST "/accounts/${ACCOUNT_ID}/access/apps" "{
    \"name\": \"Cloud Node - VS Code\",
    \"domain\": \"code.${DOMAIN}\",
    \"type\": \"self_hosted\",
    \"session_duration\": \"24h\",
    \"auto_redirect_to_identity\": true
}")

CODE_APP_ID=$(echo "$CODE_APP" | jq -r '.result.id // empty')
if [[ -n "$CODE_APP_ID" ]]; then
    log "Created Access app: $CODE_APP_ID"
else
    log "App may already exist: $(echo "$CODE_APP" | jq -r '.errors[0].message // "unknown"')"
    # Try to find existing
    EXISTING=$(cf_api GET "/accounts/${ACCOUNT_ID}/access/apps")
    CODE_APP_ID=$(echo "$EXISTING" | jq -r ".result[] | select(.domain==\"code.${DOMAIN}\") | .id" || true)
    log "Using existing app: $CODE_APP_ID"
fi

# ──────────────────────────────────────────────
# Step 2: Create Access Application for ttyd
# ──────────────────────────────────────────────
log "Creating Access application for term.${DOMAIN}..."

TERM_APP=$(cf_api POST "/accounts/${ACCOUNT_ID}/access/apps" "{
    \"name\": \"Cloud Node - Terminal\",
    \"domain\": \"term.${DOMAIN}\",
    \"type\": \"self_hosted\",
    \"session_duration\": \"24h\",
    \"auto_redirect_to_identity\": true
}")

TERM_APP_ID=$(echo "$TERM_APP" | jq -r '.result.id // empty')
if [[ -n "$TERM_APP_ID" ]]; then
    log "Created Access app: $TERM_APP_ID"
else
    log "App may already exist."
    EXISTING=$(cf_api GET "/accounts/${ACCOUNT_ID}/access/apps")
    TERM_APP_ID=$(echo "$EXISTING" | jq -r ".result[] | select(.domain==\"term.${DOMAIN}\") | .id" || true)
    log "Using existing app: $TERM_APP_ID"
fi

# ──────────────────────────────────────────────
# Step 3: Create Allow policy for both apps (email OTP)
# ──────────────────────────────────────────────
create_policy() {
    local app_id="$1"
    local app_name="$2"

    log "Creating allow policy for ${app_name}..."
    cf_api POST "/accounts/${ACCOUNT_ID}/access/apps/${app_id}/policies" "{
        \"name\": \"Allow Devin\",
        \"decision\": \"allow\",
        \"include\": [{
            \"email\": {
                \"email\": \"${ALLOWED_EMAIL}\"
            }
        }],
        \"precedence\": 1
    }" > /dev/null
}

if [[ -n "$CODE_APP_ID" ]]; then
    create_policy "$CODE_APP_ID" "code-server"
fi
if [[ -n "$TERM_APP_ID" ]]; then
    create_policy "$TERM_APP_ID" "terminal"
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}  CLOUDFLARE ACCESS CONFIGURED${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo "  Protected endpoints:"
echo "    https://code.${DOMAIN} → email OTP → code-server"
echo "    https://term.${DOMAIN} → email OTP → ttyd"
echo ""
echo "  Only ${ALLOWED_EMAIL} can access."
echo "  On iPhone: visit the URL → enter email → check inbox for OTP → in."
echo ""
