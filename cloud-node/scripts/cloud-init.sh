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
TUNNEL_TOKEN="PASTE_YOUR_TUNNEL_TOKEN_HERE"
CODE_SERVER_PASSWORD="PICK_A_PASSWORD"
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

# Env file — credentials will be fetched from Supabase on first task
sudo -u "$AGENT_USER" tee /home/$AGENT_USER/.config/task-watcher.env > /dev/null <<TWEOF
SUPABASE_URL=https://wcdyvukzlxxkgvxomaxr.supabase.co
SUPABASE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6IndjZHl2dWt6bHh4a2d2eG9tYXhyIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2OTY1OTc2OCwiZXhwIjoyMDg1MjM1NzY4fQ.AnjP6QLSbjVjXOKLtL2icevxM3gV1Ab0LtGdQVuzP2U
WORKSPACE_DIR=/home/agent/workspace
CLAUDE_MEM_REPO=/home/agent/claude-mem
POLL_INTERVAL=5
MAX_CONCURRENT=2
TWEOF

# Install task watcher service
cp /home/$AGENT_USER/claude-mem/cloud-node/services/task-watcher.service /etc/systemd/system/ 2>/dev/null || true
if [[ -f /etc/systemd/system/task-watcher.service ]]; then
    systemctl daemon-reload
    systemctl enable task-watcher
    # Don't start yet — Claude Code needs to be authenticated first
    echo "$(date): Task watcher installed (not started — auth Claude Code first)."
else
    echo "$(date): Task watcher service file not found — install manually after cloning repo."
fi

# ── Step 13: Write status beacon ──
# Writes a status file that you can check from Cloudflare Worker
sudo -u "$AGENT_USER" tee /home/$AGENT_USER/node-status.json > /dev/null <<NSEOF
{
    "status": "bootstrapped",
    "timestamp": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
    "services": {
        "code_server": "running (127.0.0.1:8080)",
        "ttyd": "running (127.0.0.1:7681)",
        "cloudflared": "running (tunnel active)",
        "claude_code": "installed (auth required)",
        "task_watcher": "installed (start after claude auth)",
        "playwright": "installed"
    },
    "next_steps": [
        "1. Open code.yourdomain.com in Safari",
        "2. Open terminal in code-server",
        "3. Run: claude (to authenticate)",
        "4. Run: sudo systemctl start task-watcher"
    ]
}
NSEOF

echo ""
echo "============================================"
echo "  BROWNING CLOUD NODE — BOOTSTRAP COMPLETE"
echo "============================================"
echo ""
echo "  Open your Cloudflare domain in Safari to access the IDE."
echo "  Then authenticate Claude Code from the terminal tab."
echo ""
echo "$(date): Bootstrap finished."
