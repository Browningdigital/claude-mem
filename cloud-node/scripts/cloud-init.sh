#!/usr/bin/env bash
# ============================================================
# BROWNING CLOUD NODE — CLOUD-INIT BOOTSTRAP
# ============================================================
# Paste this ENTIRE script into Oracle Cloud Console:
#   Compute → Create Instance → Show Advanced Options →
#   Management → Cloud-Init Script → Paste Custom Script
#
# BEFORE PASTING: Replace the two placeholder values below:
#   1. TUNNEL_TOKEN  — from Cloudflare Zero Trust Dashboard
#   2. CODE_SERVER_PASSWORD — any password you want
#
# The instance will fully configure itself on first boot.
# After ~15 minutes, access your IDE at your Cloudflare domain.
# ============================================================

set -euo pipefail
exec > /var/log/cloud-init-browning.log 2>&1

# ──────────────────────────────────────────────
# FILL THESE IN BEFORE PASTING INTO ORACLE
# ──────────────────────────────────────────────
TUNNEL_TOKEN="eyJhIjoiYjU4ZGRmMzhhZWViYjc3YzBlYzRjODI5ZWE0MmFkZjUiLCJ0IjoiNjgwMGMyZTctZjI2Yi00MDgxLThmNWUtYTk5NGI4YWMzMWE2IiwicyI6IkFnQXNnNDVEUmlUbTVJeWM5L3o2dDdqYnN5VEsrcndVa2l2dXhKYVRCZ3M9In0="
CODE_SERVER_PASSWORD="BrwN-Cl0ud-2026!"   # Set by provisioner
# ──────────────────────────────────────────────

AGENT_USER="agent"
NODE_VERSION="20"

echo "$(date): Browning Cloud Node bootstrap starting..."

# ── Step 1: System packages ──
apt-get update
DEBIAN_FRONTEND=noninteractive apt-get upgrade -y
DEBIAN_FRONTEND=noninteractive apt-get install -y \
    build-essential curl wget git tmux mosh htop jq unzip \
    ufw fail2ban ca-certificates gnupg lsb-release \
    xvfb fonts-liberation libasound2 libatk-bridge2.0-0 \
    libatk1.0-0 libcups2 libdbus-1-3 libdrm2 libgbm1 \
    libgtk-3-0 libnspr4 libnss3 libx11-xcb1 libxcomposite1 \
    libxdamage1 libxrandr2 xdg-utils

echo "$(date): Base packages installed."

# ── Step 2: Create agent user ──
if ! id "$AGENT_USER" &>/dev/null; then
    adduser --disabled-password --gecos "Cloud Node Agent" "$AGENT_USER"
    usermod -aG sudo "$AGENT_USER"
    echo "$AGENT_USER ALL=(ALL) NOPASSWD:ALL" > /etc/sudoers.d/$AGENT_USER
    # Copy SSH keys from ubuntu user
    mkdir -p /home/$AGENT_USER/.ssh
    cp /home/ubuntu/.ssh/authorized_keys /home/$AGENT_USER/.ssh/ 2>/dev/null || true
    chown -R $AGENT_USER:$AGENT_USER /home/$AGENT_USER/.ssh
    chmod 700 /home/$AGENT_USER/.ssh
    chmod 600 /home/$AGENT_USER/.ssh/authorized_keys 2>/dev/null || true
fi
echo "$(date): Agent user created."

# ── Step 3: Firewall ──
ufw default deny incoming
ufw default allow outgoing
ufw allow ssh
ufw allow 60000:61000/udp  # mosh
ufw --force enable
systemctl enable fail2ban
systemctl start fail2ban
echo "$(date): Firewall configured."

# ── Step 4: Node.js ──
curl -fsSL https://deb.nodesource.com/setup_${NODE_VERSION}.x | bash -
apt-get install -y nodejs
echo "$(date): Node.js $(node --version) installed."

# ── Step 5: Claude Code ──
sudo -u "$AGENT_USER" bash -c '
    curl -fsSL https://claude.ai/install.sh | bash
    echo "export PATH=\"\$HOME/.local/bin:\$PATH\"" >> ~/.bashrc
    echo "export PATH=\"\$HOME/.local/bin:\$PATH\"" >> ~/.profile
'
echo "$(date): Claude Code installed."

# ── Step 6: code-server ──
curl -fsSL https://code-server.dev/install.sh | sh

sudo -u "$AGENT_USER" mkdir -p /home/$AGENT_USER/.config/code-server
sudo -u "$AGENT_USER" tee /home/$AGENT_USER/.config/code-server/config.yaml > /dev/null <<CSEOF
bind-addr: 127.0.0.1:8080
auth: password
password: ${CODE_SERVER_PASSWORD}
cert: false
CSEOF

systemctl enable --now code-server@${AGENT_USER}
echo "$(date): code-server running on 127.0.0.1:8080."

# ── Step 7: ttyd (web terminal) ──
TTYD_URL="https://github.com/tsl0922/ttyd/releases/download/1.7.7/ttyd.aarch64"
wget -qO /usr/local/bin/ttyd "$TTYD_URL"
chmod +x /usr/local/bin/ttyd

cat > /etc/systemd/system/ttyd.service <<TTEOF
[Unit]
Description=ttyd - Web Terminal
After=network.target

[Service]
Type=simple
User=${AGENT_USER}
ExecStart=/usr/local/bin/ttyd --port 7681 --interface 127.0.0.1 tmux new-session -A -s main
Restart=always
RestartSec=5
Environment=TERM=xterm-256color

[Install]
WantedBy=multi-user.target
TTEOF

systemctl daemon-reload
systemctl enable --now ttyd
echo "$(date): ttyd running on 127.0.0.1:7681."

# ── Step 8: cloudflared with tunnel token ──
ARCH=$(dpkg --print-architecture)
curl -L --output /tmp/cloudflared.deb \
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${ARCH}.deb"
dpkg -i /tmp/cloudflared.deb
rm /tmp/cloudflared.deb

# Install as service using the dashboard-generated token (no interactive login needed)
cloudflared service install "$TUNNEL_TOKEN"
systemctl enable cloudflared
systemctl start cloudflared
echo "$(date): cloudflared tunnel active."

# ── Step 9: Playwright + Chromium ──
sudo -u "$AGENT_USER" bash -c '
    export PATH="$HOME/.local/bin:$PATH"
    cd ~
    npx --yes playwright install --with-deps chromium 2>&1 || true
'
echo "$(date): Playwright installed."

# ── Step 9b: noVNC + virtual desktop (live screen view from iPhone) ──
DEBIAN_FRONTEND=noninteractive apt-get install -y \
    x11vnc tigervnc-standalone-server openbox \
    xterm dbus-x11 at-spi2-core

# Install noVNC
git clone https://github.com/novnc/noVNC.git /opt/noVNC 2>/dev/null || true
git clone https://github.com/novnc/websockify.git /opt/noVNC/utils/websockify 2>/dev/null || true

# Set VNC password for agent
sudo -u "$AGENT_USER" bash -c '
    mkdir -p ~/.vnc
    echo "'${CODE_SERVER_PASSWORD}'" | vncpasswd -f > ~/.vnc/passwd
    chmod 600 ~/.vnc/passwd
'

# Xvfb virtual display service (1280x720 for mobile-friendly viewing)
cat > /etc/systemd/system/xvfb.service <<XVEOF
[Unit]
Description=Xvfb Virtual Display
After=network.target

[Service]
Type=simple
ExecStart=/usr/bin/Xvfb :99 -screen 0 1280x720x24 -ac
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
XVEOF

# Openbox window manager (lightweight — runs on the virtual display)
cat > /etc/systemd/system/openbox.service <<OBEOF
[Unit]
Description=Openbox Window Manager
After=xvfb.service
Requires=xvfb.service

[Service]
Type=simple
User=${AGENT_USER}
Environment=DISPLAY=:99
ExecStart=/usr/bin/openbox
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
OBEOF

# x11vnc — captures the virtual display and serves VNC
cat > /etc/systemd/system/x11vnc.service <<VNEOF
[Unit]
Description=x11vnc VNC Server
After=xvfb.service openbox.service
Requires=xvfb.service

[Service]
Type=simple
User=${AGENT_USER}
Environment=DISPLAY=:99
ExecStart=/usr/bin/x11vnc -display :99 -rfbauth /home/${AGENT_USER}/.vnc/passwd -forever -shared -noxdamage -rfbport 5900 -localhost
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
VNEOF

# noVNC — web frontend for VNC (connects to x11vnc on port 5900)
cat > /etc/systemd/system/novnc.service <<NVEOF
[Unit]
Description=noVNC Web Client
After=x11vnc.service
Requires=x11vnc.service

[Service]
Type=simple
User=${AGENT_USER}
ExecStart=/opt/noVNC/utils/novnc_proxy --listen 6080 --vnc localhost:5900
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
NVEOF

systemctl daemon-reload
systemctl enable xvfb openbox x11vnc novnc
systemctl start xvfb
sleep 2
systemctl start openbox x11vnc novnc

echo "$(date): noVNC live desktop running on 127.0.0.1:6080."

# ── Step 10: tmux config ──
sudo -u "$AGENT_USER" tee /home/$AGENT_USER/.tmux.conf > /dev/null <<'TMEOF'
set -g default-terminal "xterm-256color"
set -g history-limit 50000
set -g mouse on
set -g status-style 'bg=#1a1a2e fg=#e0e0e0'
set -g status-left '#[fg=#00d4ff,bold] NODE #[fg=#888888]| #S '
set -g status-right '#[fg=#888888]%H:%M #[fg=#00d4ff]%b %d'
bind | split-window -h -c "#{pane_current_path}"
bind - split-window -v -c "#{pane_current_path}"
TMEOF

# ── Step 11: Clone claude-mem repo for CLAUDE.md context ──
sudo -u "$AGENT_USER" bash -c '
    cd ~
    git clone https://github.com/Browningdigital/claude-mem.git 2>/dev/null || true
'

# ── Step 12: Task watcher setup ──
sudo -u "$AGENT_USER" mkdir -p /home/$AGENT_USER/.config /home/$AGENT_USER/workspace

# Env file — PLACEHOLDER credentials: fill in after bootstrap via
# Browning Memory MCP or Supabase Management API.
# The task-watcher won't start until Claude Code is authenticated anyway.
cat > /home/$AGENT_USER/.config/task-watcher.env <<TWEOF
SUPABASE_URL=https://wcdyvukzlxxkgvxomaxr.supabase.co
SUPABASE_KEY=<FILL_SERVICE_ROLE_KEY>
SUPABASE_ADMIN_API=https://api.supabase.com/v1/projects/wcdyvukzlxxkgvxomaxr/database/query
SUPABASE_ADMIN_TOKEN=<FILL_ADMIN_TOKEN>
WORKSPACE_DIR=/home/agent/workspace
CLAUDE_MEM_REPO=/home/agent/claude-mem
POLL_INTERVAL=5
MAX_CONCURRENT=2
TWEOF
chmod 600 /home/$AGENT_USER/.config/task-watcher.env
chown $AGENT_USER:$AGENT_USER /home/$AGENT_USER/.config/task-watcher.env

# Install task watcher service
cp /home/$AGENT_USER/claude-mem/cloud-node/services/task-watcher.service /etc/systemd/system/ 2>/dev/null || true
if [[ -f /etc/systemd/system/task-watcher.service ]]; then
    systemctl daemon-reload
    systemctl enable task-watcher
    echo "$(date): Task watcher installed (not started — auth Claude Code first)."
else
    echo "$(date): Task watcher service file not found — install manually after cloning repo."
fi

# Install scheduled task dispatcher (autonomous agent rhythm)
cp /home/$AGENT_USER/claude-mem/cloud-node/services/scheduled-dispatcher.service /etc/systemd/system/ 2>/dev/null || true
cp /home/$AGENT_USER/claude-mem/cloud-node/services/scheduled-dispatcher.timer /etc/systemd/system/ 2>/dev/null || true
chmod +x /home/$AGENT_USER/claude-mem/cloud-node/scripts/scheduled-dispatcher.sh 2>/dev/null || true
chmod +x /home/$AGENT_USER/claude-mem/cloud-node/scripts/content-ingest-poll.sh 2>/dev/null || true
if [[ -f /etc/systemd/system/scheduled-dispatcher.timer ]]; then
    systemctl daemon-reload
    systemctl enable scheduled-dispatcher.timer
    echo "$(date): Scheduled dispatcher installed (starts after Claude Code auth)."
fi

# ── Step 12b: Chat relay server (interactive Claude Code from iPhone) ──
RELAY_TOKEN=$(openssl rand -hex 32)

sudo -u "$AGENT_USER" bash -c "
    cd ~/claude-mem/cloud-node/relay
    npm install --production 2>&1 || true
"

# Relay env file — PLACEHOLDER key: fill in after bootstrap
cat > /home/$AGENT_USER/.config/relay.env <<RLEOF
RELAY_PORT=3000
RELAY_AUTH_TOKEN=${RELAY_TOKEN}
WORKSPACE_DIR=/home/${AGENT_USER}/workspace
CLAUDE_MEM_REPO=/home/${AGENT_USER}/claude-mem
SUPABASE_URL=https://wcdyvukzlxxkgvxomaxr.supabase.co
SUPABASE_KEY=<FILL_SERVICE_ROLE_KEY>
MAX_CONCURRENT=3
RLEOF
chmod 600 /home/$AGENT_USER/.config/relay.env
chown $AGENT_USER:$AGENT_USER /home/$AGENT_USER/.config/relay.env

# Relay systemd service
cat > /etc/systemd/system/cloud-node-relay.service <<RSEOF
[Unit]
Description=Browning Cloud Node — Chat Relay
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${AGENT_USER}
WorkingDirectory=/home/${AGENT_USER}/claude-mem/cloud-node/relay
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
EnvironmentFile=/home/${AGENT_USER}/.config/relay.env
StandardOutput=journal
StandardError=journal
SyslogIdentifier=cloud-node-relay

[Install]
WantedBy=multi-user.target
RSEOF

systemctl daemon-reload
systemctl enable cloud-node-relay
# Don't start yet — Claude Code auth needed first
echo "$(date): Chat relay installed. Token: ${RELAY_TOKEN}"

# ── Step 13: Write status beacon ──
sudo -u "$AGENT_USER" tee /home/$AGENT_USER/node-status.json > /dev/null <<NSEOF
{
    "status": "bootstrapped",
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "relay_token": "${RELAY_TOKEN}",
    "services": {
        "code_server": "running (127.0.0.1:8080)",
        "ttyd": "running (127.0.0.1:7681)",
        "chat_relay": "installed (127.0.0.1:3000)",
        "novnc": "running (127.0.0.1:6080)",
        "cloudflared": "running (tunnel active)",
        "claude_code": "installed (auth required)",
        "task_watcher": "installed (start after claude auth)",
        "playwright": "installed"
    },
    "next_steps": [
        "1. Open code.yourdomain.com in Safari — authenticate Claude Code in terminal",
        "2. Run: sudo systemctl start cloud-node-relay task-watcher",
        "3. Open chat.yourdomain.com — log in with relay token above",
        "4. Open screen.yourdomain.com — see live VPS desktop"
    ]
}
NSEOF

echo ""
echo "============================================"
echo "  BROWNING CLOUD NODE — BOOTSTRAP COMPLETE"
echo "============================================"
echo ""
echo "  Relay token: ${RELAY_TOKEN}"
echo "  (Also saved in ~/node-status.json)"
echo ""
echo "  After authenticating Claude Code, start services:"
echo "    sudo systemctl start cloud-node-relay task-watcher"
echo ""
echo "$(date): Bootstrap finished."
