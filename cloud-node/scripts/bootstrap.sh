#!/usr/bin/env bash
# Browning Cloud Node — Full Bootstrap
# Run this on a fresh Ubuntu 22.04 ARM64 instance (Oracle Cloud Free Tier).
# Sets up: Claude Code, code-server, tmux, mosh, cloudflared, Playwright, task watcher.
#
# Usage (as ubuntu user):
#   curl -fsSL <raw-url>/bootstrap.sh | bash
#
# Or clone and run:
#   git clone https://github.com/Browningdigital/claude-mem.git
#   cd claude-mem/cloud-node/scripts
#   chmod +x bootstrap.sh && ./bootstrap.sh

set -euo pipefail

# ──────────────────────────────────────────────
# Configuration
# ──────────────────────────────────────────────
AGENT_USER="agent"
CODE_SERVER_PORT=8080
TTYD_PORT=7681
NODE_VERSION="20"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

log() { echo -e "${GREEN}[$(date '+%H:%M:%S')]${NC} $1"; }
warn() { echo -e "${YELLOW}[$(date '+%H:%M:%S')] WARNING:${NC} $1"; }
err() { echo -e "${RED}[$(date '+%H:%M:%S')] ERROR:${NC} $1"; }

# ──────────────────────────────────────────────
# Step 1: System update + base packages
# ──────────────────────────────────────────────
log "Step 1/9: Updating system and installing base packages..."
sudo apt update && sudo DEBIAN_FRONTEND=noninteractive apt upgrade -y
sudo DEBIAN_FRONTEND=noninteractive apt install -y \
    build-essential \
    curl \
    wget \
    git \
    tmux \
    mosh \
    htop \
    jq \
    unzip \
    ufw \
    fail2ban \
    ca-certificates \
    gnupg \
    lsb-release \
    xvfb \
    fonts-liberation \
    libasound2 \
    libatk-bridge2.0-0 \
    libatk1.0-0 \
    libcups2 \
    libdbus-1-3 \
    libdrm2 \
    libgbm1 \
    libgtk-3-0 \
    libnspr4 \
    libnss3 \
    libx11-xcb1 \
    libxcomposite1 \
    libxdamage1 \
    libxrandr2 \
    xdg-utils

# ──────────────────────────────────────────────
# Step 2: Create agent user
# ──────────────────────────────────────────────
log "Step 2/9: Creating agent user..."
if ! id "$AGENT_USER" &>/dev/null; then
    sudo adduser --disabled-password --gecos "Cloud Node Agent" "$AGENT_USER"
    sudo usermod -aG sudo "$AGENT_USER"
    # Allow passwordless sudo for agent
    echo "$AGENT_USER ALL=(ALL) NOPASSWD:ALL" | sudo tee /etc/sudoers.d/$AGENT_USER
    # Copy SSH keys from current user
    sudo mkdir -p /home/$AGENT_USER/.ssh
    sudo cp ~/.ssh/authorized_keys /home/$AGENT_USER/.ssh/ 2>/dev/null || warn "No SSH keys to copy — add manually later"
    sudo chown -R $AGENT_USER:$AGENT_USER /home/$AGENT_USER/.ssh
    sudo chmod 700 /home/$AGENT_USER/.ssh
    sudo chmod 600 /home/$AGENT_USER/.ssh/authorized_keys 2>/dev/null || true
    log "Created user: $AGENT_USER"
else
    log "User $AGENT_USER already exists, skipping."
fi

# ──────────────────────────────────────────────
# Step 3: Firewall hardening
# ──────────────────────────────────────────────
log "Step 3/9: Configuring firewall..."
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow ssh
sudo ufw allow 60000:61000/udp  # mosh
# No need to open 8080/7681 — cloudflared tunnel handles access
sudo ufw --force enable
sudo systemctl enable fail2ban
sudo systemctl start fail2ban
log "Firewall active. Only SSH + Mosh ports open. All other access via Cloudflare Tunnel."

# ──────────────────────────────────────────────
# Step 4: Install Node.js
# ──────────────────────────────────────────────
log "Step 4/9: Installing Node.js ${NODE_VERSION}..."
if ! command -v node &>/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | sudo -E bash -
    sudo apt install -y nodejs
fi
log "Node.js $(node --version) installed."

# ──────────────────────────────────────────────
# Step 5: Install Claude Code
# ──────────────────────────────────────────────
log "Step 5/9: Installing Claude Code..."
# Install as agent user (idempotent — skip if already installed)
if sudo -u "$AGENT_USER" bash -c '[[ -f "$HOME/.local/bin/claude" ]]'; then
    log "Claude Code already installed, skipping."
else
    sudo -u "$AGENT_USER" bash -c '
        curl -fsSL https://claude.ai/install.sh | bash
        grep -q "/.local/bin" ~/.bashrc || echo "export PATH=\"\$HOME/.local/bin:\$PATH\"" >> ~/.bashrc
        grep -q "/.local/bin" ~/.profile || echo "export PATH=\"\$HOME/.local/bin:\$PATH\"" >> ~/.profile
    '
    # Verify
    if sudo -u "$AGENT_USER" bash -c '[[ -f "$HOME/.local/bin/claude" ]]'; then
        log "Claude Code installed successfully."
    else
        err "Claude Code installation FAILED — install manually after bootstrap."
    fi
fi
log "Auth required on first run: sudo -iu $AGENT_USER claude"

# ──────────────────────────────────────────────
# Step 6: Install code-server
# ──────────────────────────────────────────────
log "Step 6/9: Installing code-server..."
curl -fsSL https://code-server.dev/install.sh | sh

# Configure code-server for agent user
sudo -u "$AGENT_USER" mkdir -p /home/$AGENT_USER/.config/code-server
CODE_SERVER_PASSWORD=$(openssl rand -hex 16)

sudo -u "$AGENT_USER" tee /home/$AGENT_USER/.config/code-server/config.yaml > /dev/null <<EOF
bind-addr: 127.0.0.1:${CODE_SERVER_PORT}
auth: password
password: ${CODE_SERVER_PASSWORD}
cert: false
EOF

sudo systemctl enable --now code-server@${AGENT_USER}
log "code-server running on 127.0.0.1:${CODE_SERVER_PORT}"
log "Password saved to /home/$AGENT_USER/.config/code-server/config.yaml"
echo ""
echo -e "${YELLOW}  code-server password: ${CODE_SERVER_PASSWORD}${NC}"
echo -e "${YELLOW}  Save this! You'll need it for browser access.${NC}"
echo ""

# ──────────────────────────────────────────────
# Step 7: Install ttyd (lightweight web terminal)
# ──────────────────────────────────────────────
log "Step 7/9: Installing ttyd..."
TTYD_VERSION="1.7.7"
TTYD_URL="https://github.com/tsl0922/ttyd/releases/download/${TTYD_VERSION}/ttyd.aarch64"
sudo wget -qO /usr/local/bin/ttyd "$TTYD_URL"
sudo chmod +x /usr/local/bin/ttyd

# ttyd systemd service (runs tmux attach for agent user)
sudo tee /etc/systemd/system/ttyd.service > /dev/null <<EOF
[Unit]
Description=ttyd - Web Terminal
After=network.target

[Service]
Type=simple
User=${AGENT_USER}
ExecStart=/usr/local/bin/ttyd --port ${TTYD_PORT} --interface 127.0.0.1 --credential agent:\${TTYD_PASSWORD} tmux new-session -A -s main
Restart=always
RestartSec=5
Environment=TERM=xterm-256color
EnvironmentFile=/home/${AGENT_USER}/.config/ttyd.env

[Install]
WantedBy=multi-user.target
EOF

# Generate ttyd password
TTYD_PASSWORD=$(openssl rand -hex 16)
sudo -u "$AGENT_USER" mkdir -p /home/$AGENT_USER/.config
echo "TTYD_PASSWORD=${TTYD_PASSWORD}" | sudo -u "$AGENT_USER" tee /home/$AGENT_USER/.config/ttyd.env > /dev/null

sudo systemctl daemon-reload
sudo systemctl enable --now ttyd
log "ttyd running on 127.0.0.1:${TTYD_PORT}"
echo -e "${YELLOW}  ttyd password: agent:${TTYD_PASSWORD}${NC}"

# ──────────────────────────────────────────────
# Step 8: Install cloudflared
# ──────────────────────────────────────────────
log "Step 8/9: Installing cloudflared..."
ARCH=$(dpkg --print-architecture)
curl -L --output /tmp/cloudflared.deb "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}.deb"
sudo dpkg -i /tmp/cloudflared.deb
rm /tmp/cloudflared.deb
log "cloudflared installed. Configure tunnel next — see cloud-node/scripts/setup-tunnel.sh"

# ──────────────────────────────────────────────
# Step 9: Install Playwright (headless Chrome)
# ──────────────────────────────────────────────
log "Step 9/9: Installing Playwright + headless Chromium..."
sudo -u "$AGENT_USER" bash -c '
    export PATH="$HOME/.local/bin:$PATH"
    cd ~
    npx --yes playwright install --with-deps chromium
'
log "Playwright + Chromium installed for headless browser automation."

# ──────────────────────────────────────────────
# Setup tmux config for agent
# ──────────────────────────────────────────────
log "Configuring tmux..."
sudo -u "$AGENT_USER" tee /home/$AGENT_USER/.tmux.conf > /dev/null <<'EOF'
# Browning Cloud Node — tmux config
set -g default-terminal "xterm-256color"
set -g history-limit 50000
set -g mouse on
set -g status-interval 5

# Status bar
set -g status-style 'bg=#1a1a2e fg=#e0e0e0'
set -g status-left '#[fg=#00d4ff,bold] NODE #[fg=#888888]| #S '
set -g status-right '#[fg=#888888]%H:%M #[fg=#00d4ff]%b %d'
set -g status-left-length 30

# Easier splits
bind | split-window -h -c "#{pane_current_path}"
bind - split-window -v -c "#{pane_current_path}"

# Quick reload
bind r source-file ~/.tmux.conf \; display "Config reloaded"
EOF

# ──────────────────────────────────────────────
# Summary
# ──────────────────────────────────────────────
echo ""
echo -e "${BLUE}========================================${NC}"
echo -e "${BLUE}  BROWNING CLOUD NODE — BOOTSTRAP DONE ${NC}"
echo -e "${BLUE}========================================${NC}"
echo ""
echo -e "  ${GREEN}Installed:${NC}"
echo "    - Claude Code (auth required: sudo -iu $AGENT_USER claude)"
echo "    - code-server on 127.0.0.1:${CODE_SERVER_PORT}"
echo "    - ttyd on 127.0.0.1:${TTYD_PORT}"
echo "    - cloudflared (tunnel setup needed)"
echo "    - Playwright + Chromium (headless)"
echo "    - tmux + mosh"
echo "    - ufw + fail2ban"
echo ""
echo -e "  ${YELLOW}Next steps:${NC}"
echo "    1. Authenticate Claude Code:"
echo "       sudo -iu $AGENT_USER claude"
echo ""
echo "    2. Set up Cloudflare Tunnel:"
echo "       sudo -iu $AGENT_USER bash cloud-node/scripts/setup-tunnel.sh"
echo ""
echo "    3. Set up the task watcher (iPhone → VPS dispatch):"
echo "       Deploy cloud-node/worker/ to Cloudflare Workers"
echo "       Install cloud-node/services/task-watcher on this server"
echo ""
echo -e "  ${YELLOW}Passwords (also in config files):${NC}"
echo "    code-server: ${CODE_SERVER_PASSWORD}"
echo "    ttyd:        agent:${TTYD_PASSWORD}"
echo ""
echo "  Save these passwords securely!"
echo ""
