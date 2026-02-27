# SESSION HANDOFF — Feb 27, 2026

## WHAT WAS HAPPENING

Devin asked for a status check on the **Browning Empire social accounts** infrastructure and then pivoted to **setting up Azure as a temporary cloud-node** while waiting for the OCI ARM instance to provision.

## SOCIAL ACCOUNTS STATUS (COMPREHENSIVE AUDIT DONE)

### Built & Production-Ready (5 platforms)
| Platform | Method | Status |
|----------|--------|--------|
| Twitter/X | OAuth 1.0a HMAC-SHA1 | Ready |
| LinkedIn | Community Management API v2 | Ready |
| Threads | Meta Graph API (two-step publish) | Ready |
| Facebook Pages | Graph API | Ready |
| Instagram | Content Publishing API | Ready |

**Workers deployed:**
- `content-queue-poster` — 15-min cron, handles all 5 platforms
- `browning-legal` — FB/GDPR compliance (privacy policy, data deletion)
- `browning-api-bridge` — API proxy for egress-restricted envs
- `sales-engine` — PayPal/Coinbase integrated with content queue

**Supporting infra:**
- Content scoring engine (7 Browning pillars)
- `content_queue`, `raw_content`, `golden_nuggets`, `scraper_configs` tables all live
- Content ingest polling script ready (`content-ingest-poll.sh`)

### Remaining Gaps
1. **RSS feed scraper worker** — schema exists in `scraper_configs`, no worker polling feeds yet
2. **TikTok / YouTube posting** — extraction works, no upload/post capability
3. **Reddit / Discord / Telegram posting** — not built
4. **Engagement analytics** — no automated metric pull-back from platforms
5. **Account management UI** — everything is direct SQL, no dashboard
6. **Multi-account support** — single account per platform only
7. **Media hosting** — external URLs only, no CDN upload pipeline
8. **Hashtag generation** — manual only, no AI-powered extraction
9. **Scheduling precision** — 15-min cron granularity, no timezone support

## AZURE SETUP — IN PROGRESS

### Context
- OCI ARM instance (4 OCPU / 24GB) still hasn't provisioned (capacity issues in us-chicago-1)
- Devin has an Azure account with **$200 in credits**
- Plan: spin up **B2pts v2 ARM VM** (free tier, closest to OCI target arch) as temporary cloud-node

### What Was Decided
- Azure VM will temporarily run: cloud-node agent, content ingest polling, task dispatch, relay server, cron jobs
- Region: likely East US (pending confirmation)
- Image: Ubuntu 24.04 ARM

### WHAT NEEDS TO HAPPEN NEXT (PICK UP HERE)

1. **Devin needs to install Azure CLI on Windows:**
   ```cmd
   winget install -e --id Microsoft.AzureCLI
   ```
   Then close/reopen terminal, run `az login`, then `az account show` and share output.

2. **Once authenticated, provision the VM:**
   - Resource group: `browning-cloud-rg`
   - VM: B2pts v2 ARM (Ubuntu 24.04)
   - SSH key setup
   - Install Node.js, git, wrangler
   - Clone claude-mem
   - Deploy cloud-node services
   - Set up cron jobs (content-ingest-poll.sh every 15min)

3. **After VM is running, deploy cloud-node stack:**
   - Content polling cron
   - Task dispatch
   - Relay server for iPhone
   - Cloudflare Tunnel (if needed for web access)

## OCI PROVISIONER STATUS (UNCHANGED)

- Still waiting on capacity in `us-chicago-1`
- Cloudflare Worker provisioner was planned (approved by Devin) but not yet built
- Bash daemon scripts still at `cloud-node/scripts/` as fallback
- All OCI infra (VCN, subnet, image, SSH key) verified working
- See previous handoff for full OCI config details

## GIT STATE

- Branch: `claude/integrate-rss-infrastructure-PryET`
- Clean working tree
- Latest commit: `f07a7fc Add branded app icon`
- No uncommitted changes this session (research/planning only)

## DO NOT

- Do NOT ask for API keys — retrieve from Browning Memory or `claude_system_state`
- Do NOT push to main without permission
- Do NOT delete the OCI bash daemon scripts — keep as fallback
- Do NOT hardcode secrets in source — use `wrangler secret put`
- Do NOT skip the Azure CLI install step — Devin doesn't have it yet
