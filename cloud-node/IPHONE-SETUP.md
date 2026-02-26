# Browning Cloud Node — iPhone-Only Setup (Zero Terminal)

Everything below is done from iPhone Safari. No laptop, no SSH client, no terminal app.

---

## Phase 1: Create Cloudflare Tunnel (5 min)

Do this FIRST — you need the tunnel token before creating the Oracle instance.

1. Open **Safari** → go to `https://one.dash.cloudflare.com`
2. Log in as `devin@browningdigital.com`
3. Go to **Networks** → **Tunnels** → **Create a tunnel**
4. Select **Cloudflared** connector
5. Name it: `browning-cloud-node`
6. Click **Save tunnel**
7. On the install page, find the **token** — it's the long string after `cloudflared service install`. **Copy this token** (long-press → Copy). You'll paste it into the Oracle cloud-init script.
8. Click **Next** to configure public hostnames:

   **Hostname 1 — Chat (your main interface):**
   - Subdomain: `chat`
   - Domain: `browningdigital.com` (or your domain)
   - Service Type: `HTTP`
   - URL: `localhost:3000`

   **Hostname 2 — Live Screen:**
   - Click **Add a public hostname**
   - Subdomain: `screen`
   - Domain: `browningdigital.com`
   - Service Type: `HTTP`
   - URL: `localhost:6080`

   **Hostname 3 — IDE (code-server):**
   - Subdomain: `code`
   - Domain: `browningdigital.com`
   - Service Type: `HTTP`
   - URL: `localhost:8080`

   **Hostname 4 — Terminal (ttyd):**
   - Subdomain: `term`
   - Domain: `browningdigital.com`
   - Service Type: `HTTP`
   - URL: `localhost:7681`

9. Save tunnel.

### Lock it down with Access

10. Go to **Access** → **Applications** → **Add an application**
11. Select **Self-hosted**
12. Application name: `Cloud Node`
13. Application domain: `chat.browningdigital.com`
14. Session duration: `24 hours`
15. Click **Next** → Add a policy:
    - Policy name: `Allow Devin`
    - Action: `Allow`
    - Include: `Emails` → `devin@browningdigital.com`
16. Save.
17. **Repeat steps 10-16** for `screen.browningdigital.com`, `code.browningdigital.com`, `term.browningdigital.com`

---

## Phase 2: Create Oracle Cloud Instance (10 min)

1. Open **Safari** → go to `https://cloud.oracle.com`
2. Sign up for a free account (need a credit card for verification — $0 charged)
3. **Important:** After signup, go to **Billing** → **Upgrade to Pay-As-You-Go**
   - This eliminates idle instance reclamation
   - You still pay $0 for Always Free resources
4. Go to **Compute** → **Instances** → **Create Instance**

### Instance configuration:

| Setting | Value |
|---------|-------|
| Name | `browning-cloud-node` |
| Image | Ubuntu 22.04 Minimal (click **Change Image** → Ubuntu → 22.04 Minimal → **aarch64**) |
| Shape | Click **Change Shape** → Ampere → `VM.Standard.A1.Flex` → **4 OCPUs, 24 GB RAM** |
| Networking | Use default VCN or create one. **Assign public IPv4**: Yes |
| SSH Keys | Click **Paste public keys** → paste your SSH public key (or **Generate** and save the private key to your phone) |

### Paste the cloud-init script:

5. Click **Show Advanced Options** at the bottom
6. Go to the **Management** tab
7. Under **Cloud-init script**, select **Paste cloud-init script**
8. Open this file in another Safari tab: `https://raw.githubusercontent.com/Browningdigital/claude-mem/main/cloud-node/scripts/cloud-init.sh`
9. **Before pasting**, edit these two lines at the top:
   ```
   TUNNEL_TOKEN="paste-your-tunnel-token-from-phase-1"
   CODE_SERVER_PASSWORD="pick-any-password-you-want"
   ```
10. Paste the full script into the Cloud-init field
11. Click **Create**

### If you get "Out of host capacity":
- Try a different **Availability Domain** (dropdown near the top)
- Try a different **Region** (top-right of console — less popular regions like US-Ashburn, Canada, etc.)
- Wait 15 minutes and try again
- The PAYG upgrade significantly improves your chances

---

## Phase 3: Wait + Access (15 min)

The instance will take ~15 minutes to fully bootstrap.

1. In Oracle Console, go to your instance → note the **Public IP**
2. Wait 15 minutes for cloud-init to complete
3. Open Safari → go to `https://code.browningdigital.com`
4. Cloudflare Access will ask for your email → enter `devin@browningdigital.com`
5. Check email for OTP → enter it
6. You're in **code-server** (VS Code in your browser)
7. Enter the `CODE_SERVER_PASSWORD` you chose

---

## Phase 4: Authenticate Claude Code + Start Services (2 min)

This is the one manual step — Claude Code needs a one-time auth.

1. In code-server, open the **Terminal** (hamburger menu → Terminal → New Terminal)
2. Run:
   ```bash
   sudo -iu agent
   claude
   ```
3. Claude Code will show a URL — open it in another Safari tab
4. Log in with your Anthropic account (Claude Pro/Max)
5. Once authenticated, press Ctrl+C to exit
6. Start all services:
   ```bash
   sudo systemctl start cloud-node-relay task-watcher
   ```
7. Get your relay login token:
   ```bash
   cat ~/node-status.json | jq -r .relay_token
   ```
   **Copy this token — you'll need it next.**

---

## Phase 5: Open the Chat Interface (1 min)

1. Open Safari → go to `https://chat.browningdigital.com`
2. Cloudflare Access → email OTP (same as before)
3. Enter the **relay token** from the previous step
4. You're in. Type a message to Claude Code — responses stream in real-time.
5. Tap the **screen icon** (🖥) in the header to see a **live view of the VPS desktop**
   - When Claude opens a browser (Playwright), you see it
   - When files are edited, you see the desktop update
   - Resize the screen panel with S/M/L buttons
6. Tap **Share** → **Add to Home Screen** → name it `Cloud Node`

**Done.** You now have a full AI development environment controlled from your iPhone.

---

## How it all connects

```
iPhone Safari                    Cloudflare Tunnel              Oracle ARM (24GB)
─────────────                    ─────────────────              ─────────────────

chat.browningdigital.com   ──→  Tunnel + Access  ──→  Chat Relay (port 3000)
  Chat with Claude Code                                   ↕ WebSocket
  See live screen view                                 Claude Code CLI
  Manage sessions                                     (full Browning context)

screen.browningdigital.com ──→  Tunnel + Access  ──→  noVNC (port 6080)
  Live desktop feed                                    ↕ VNC
  Watch Playwright browsers                          Xvfb + Openbox
  See file operations                                (virtual desktop)

code.browningdigital.com   ──→  Tunnel + Access  ──→  code-server (port 8080)
  Full VS Code IDE                                   (backup / manual work)

term.browningdigital.com   ──→  Tunnel + Access  ──→  ttyd (port 7681)
  Raw terminal                                       (emergency access)
```

---

## Monthly cost

| Component | Cost |
|-----------|------|
| Oracle ARM (4 OCPU, 24GB, 200GB) | $0 |
| Cloudflare Tunnel + Access | $0 (included in your plan) |
| code-server + ttyd | $0 (open source) |
| Claude Code CLI | $0 |
| **Claude Pro/Max subscription** | **$20-200/mo** |
| **Total** | **$20-200/mo** |

---

## Troubleshooting

**Can't reach code.browningdigital.com after 15 min:**
- Check Oracle Console → Instance → ensure status is "Running"
- Check Cloudflare Dashboard → Tunnels → ensure tunnel shows "Healthy"
- Cloud-init might still be running — wait another 10 min
- If tunnel shows "Down", the instance may still be bootstrapping

**"Out of host capacity" on Oracle:**
- This is the #1 Oracle Free Tier issue
- Switch regions: try Phoenix, Ashburn, Toronto, Sydney
- Switch Availability Domain within the region
- Try at off-peak hours (early morning US time)
- PAYG upgrade is essential

**Claude Code auth URL won't open:**
- Copy the URL from terminal, open in a new Safari tab
- Make sure you're logged into your Anthropic account

**Task watcher not picking up tasks:**
- Check service: `sudo systemctl status task-watcher`
- Check logs: `sudo journalctl -u task-watcher -f`
- Verify env file: `cat ~/.config/task-watcher.env`
