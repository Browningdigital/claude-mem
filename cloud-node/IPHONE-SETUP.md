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

   **Hostname 1 (IDE):**
   - Subdomain: `code`
   - Domain: `browningdigital.com` (or your domain)
   - Service Type: `HTTP`
   - URL: `localhost:8080`

   **Hostname 2 (Terminal):**
   - Click **Add a public hostname**
   - Subdomain: `term`
   - Domain: `browningdigital.com`
   - Service Type: `HTTP`
   - URL: `localhost:7681`

9. Save tunnel.

### Lock it down with Access

10. Go to **Access** → **Applications** → **Add an application**
11. Select **Self-hosted**
12. Application name: `Cloud Node IDE`
13. Application domain: `code.browningdigital.com`
14. Session duration: `24 hours`
15. Click **Next** → Add a policy:
    - Policy name: `Allow Devin`
    - Action: `Allow`
    - Include: `Emails` → `devin@browningdigital.com`
16. Save.
17. **Repeat steps 10-16** for `term.browningdigital.com`

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

## Phase 4: Authenticate Claude Code (2 min)

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
6. Start the task watcher:
   ```bash
   sudo systemctl start task-watcher
   ```

**Done.** Your cloud node is fully operational.

---

## Phase 5: Deploy Task Dispatcher Worker (5 min from code-server terminal)

1. In code-server terminal:
   ```bash
   cd ~/claude-mem/cloud-node/worker

   # Generate an auth token for the dispatcher
   TASK_TOKEN=$(openssl rand -hex 32)
   echo "Your task auth token: $TASK_TOKEN"
   echo "SAVE THIS — you need it for the iOS Shortcut"

   # Set secrets
   npx wrangler secret put SUPABASE_URL
   # paste: https://wcdyvukzlxxkgvxomaxr.supabase.co

   npx wrangler secret put SUPABASE_KEY
   # paste the service_role_key (it's in task-watcher.env)

   npx wrangler secret put TASK_AUTH_TOKEN
   # paste the $TASK_TOKEN you generated above

   # Deploy
   npx wrangler deploy
   ```
2. Note the Worker URL (e.g., `cloud-node-dispatcher.devin-b58.workers.dev`)

---

## Phase 6: Bookmark the Dashboard (1 min)

The dispatcher Worker has a built-in mobile dashboard.

1. Open Safari → go to your Worker URL (e.g., `cloud-node-dispatcher.devin-b58.workers.dev`)
2. Enter your `TASK_AUTH_TOKEN` to log in
3. Tap the **Share** button → **Add to Home Screen**
4. Name it: `Cloud Node`

Now you have a Home Screen app for dispatching tasks — type a prompt, hit Send, watch status update in real-time.

---

## How it all connects

```
iPhone Safari                    Cloudflare                     Oracle ARM (24GB)
─────────────                    ──────────                     ─────────────────

code.browningdigital.com  ──→  Tunnel + Access  ──→  code-server (IDE)
term.browningdigital.com  ──→  Tunnel + Access  ──→  ttyd (terminal)

Cloud Node dashboard      ──→  Dispatcher Worker ──→  Supabase queue
(Home Screen bookmark)                                    ↓
                                                      Task Watcher
                                                         ↓
                                                      Claude Code (headless)
                                                      + full Browning context
                                                      + credentials
                                                      + session logging
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
