# BROWNING DIGITAL — INFO PRODUCT PROJECT BIBLE

**Last Updated:** February 26, 2026
**Owner:** Devin Browning (devin@browningdigital.com)
**Repo:** `Browningdigital/claude-mem`
**Live Storefront:** https://shop.browningdigital.com

---

## WHAT THIS IS

Complete operational document for Browning Digital's info product business. Every worker, every endpoint, every secret, every decision.

**If you're a new Claude session: this is your single source of truth.** Don't ask what's already answered here. Don't rebuild what's built. Don't use SvelteKit for anything a customer sees.

The mission: **sell digital products that help people run autonomous AI agents on free infrastructure.** We sell the infrastructure we run on. We eat our own cooking.

---

## THE PRODUCT

### Zero-Cost AI Infrastructure Kit — Starter ($47)

Production-ready starter kit: provisions, configures, and manages an autonomous AI agent on 100% free-tier cloud infrastructure.

**What the buyer gets:**
1. Auto-Provisioning Engine — One-command Oracle Cloud ARM launch with auto-retry
2. Cloudflare Tunnel + Zero Trust — Secure access from anywhere, no exposed ports
3. Task Dispatch System — API-driven task queue, 30-second pickup, retry logic
4. Scheduled Automation — systemd-based cron scheduler for recurring jobs
5. Chat Relay (iPhone-ready) — WebSocket for real-time agent communication
6. Agent Identity Framework — Pre-built CLAUDE.md defining agent personality, goals, autonomy
7. Systemd Services + Health Monitoring — Auto-restart, watchdog, security hardening
8. Complete Setup Guide — Zero to running agent

**The stack buyers deploy:**

| Component | Spec | Monthly Cost |
|-----------|------|-------------|
| Oracle Cloud ARM | 4 OCPU, 24GB RAM, 200GB SSD | $0 (Always Free) |
| Cloudflare Tunnel | Zero Trust networking | $0 |
| Supabase | PostgreSQL + task queue + state | $0 (Free tier) |
| Anthropic API | Claude Code headless | ~$5-15/mo |

**Who buys:** Solopreneurs, AI developers, side project builders, anyone paying $50-200/mo for cloud they could get free.

**Payment options:** PayPal one-time, 3x installments ($15.67/mo), Crypto (BTC/ETH/USDC). 48-hour money-back guarantee.

---

## THE BUSINESS MODEL

### Revenue Pillars

| Pillar | Focus | Product Types |
|--------|-------|---------------|
| `systems_automation` | AI workflows, agent architectures | Starter kits, templates, DFY setups |
| `revenue_systems` | Monetization, pricing, growth | Playbooks, courses, consulting |
| `content_marketing` | Distribution, hooks, viral mechanics | Content templates, social strategies |
| `founder_ops` | Solo founder efficiency | Tool configs, workflow templates |
| `web_premium` | Premium web products | Micro SaaS tools, premium templates |

### Product Tiers

| Tier | Price | Format |
|------|-------|--------|
| Micro | $7-27 | PDF, checklist, single template |
| Starter | $27-97 | Template bundle, code repo |
| Pro | $97-297 | Full course, video walkthrough |
| Premium | $297-997 | DFY setup, comprehensive system |
| Enterprise | $997-2997 | White-glove setup, ongoing support |

Start Micro/Starter → ship fast → let revenue data dictate what scales up.

---

## INFRASTRUCTURE MAP

```
┌──────────────────────────────────────────────────────┐
│                 CLOUDFLARE EDGE                       │
│                                                      │
│  Pages: shop.browningdigital.com                     │
│  (Pure HTML/CSS/JS — zero framework)                 │
│       │                                              │
│       │ POST /api/checkout                           │
│       ▼                                              │
│  Workers:                                            │
│  ├─ browning-sales-engine    (payments)              │
│  ├─ cloud-node-dispatcher    (task queue + UI)       │
│  ├─ content-queue-poster     (social, cron */15)     │
│  └─ oci-provisioner          (instance spin-up, */1) │
└──────────────────────────────────────────────────────┘
         │                    │
         ▼                    ▼
┌─────────────────┐  ┌────────────────────────────────┐
│ Payment APIs     │  │ Oracle Cloud (Always Free ARM)  │
│ • PayPal REST    │  │ 4 OCPU • 24GB RAM • 200GB SSD  │
│ • Coinbase       │  │                                 │
│   Commerce       │  │  Claude Code (headless)         │
└─────────────────┘  │  Task Watcher (polls DB)         │
                     │  Scheduled Dispatcher (systemd)   │
                     │  Chat Relay (WebSocket)           │
                     │  Cloudflare Tunnel (Zero Trust)   │
                     └────────────────────────────────────┘
                                  │
                                  ▼
                     ┌────────────────────────────────┐
                     │ Supabase (Free Tier)            │
                     │ wcdyvukzlxxkgvxomaxr            │
                     │                                 │
                     │ products, product_sales,        │
                     │ cloud_node_tasks,               │
                     │ scheduled_tasks, content_queue,  │
                     │ golden_nuggets, raw_content,     │
                     │ v2_gold_content, rm_ai_learnings,│
                     │ claude_system_state,             │
                     │ revenue_daily, provisioner_logs  │
                     └────────────────────────────────┘
```

### Deployment URLs

| Service | URL | Type |
|---------|-----|------|
| Storefront | `shop.browningdigital.com` | Cloudflare Pages |
| Sales Engine | `browning-sales-engine.devin-b58.workers.dev` | Worker |
| Task Dispatcher | `browning-cloud-node-dispatcher.devin-b58.workers.dev` | Worker |
| Content Poster | `content-queue-poster.devin-b58.workers.dev` | Worker (cron) |
| OCI Provisioner | cron-only, no public URL | Worker (cron) |
| Browning Memory | `browningdigital.com/api/mcp` | MCP Server |
| Supabase | `wcdyvukzlxxkgvxomaxr.supabase.co` | Database |

**Cloudflare Account:** `b58ddf38aeebb77c0ec4c829ea42adf5` (slug: `devin-b58`)

---

## STOREFRONT

**Location:** `cloud-node/site/index.html` + `cloud-node/site/success/index.html`
**Deployed to:** Cloudflare Pages → `shop.browningdigital.com`
**Tech:** Pure HTML/CSS/JS. Zero framework. Zero build step.

### Landing Page (index.html)

**Design:** Dark gradient hero (#1a1a2e → #16213e → #0f3460), pink/magenta accent (#ff90e8) for CTAs, Inter font, two-column desktop → single-column mobile with purchase card on top.

**Copy structure:**
- Cover card: "STARTER KIT" badge → "Zero-Cost AI Infrastructure" → specs
- 6-item grid (Auto-Provisioner, Cloudflare Tunnel, Task Dispatcher, Cron Scheduler, Chat Relay, Agent Identity)
- Headline: "Stop paying for AI infrastructure."
- 8 "What's Included" items with descriptions
- Architecture diagram
- FAQ accordion (6 questions)
- Creator card (Devin Browning bio)

**Social proof:** "127+ people bought this", savings callout ($1,800/yr), 48-hour guarantee, creator credibility.

**Mobile:** Sticky bottom CTA bar (IntersectionObserver triggers when purchase card scrolls away). Thumb-zone optimized.

**Checkout form:** Name (optional), Email (required), payment method toggle (PayPal / 3 Payments / Crypto), dynamic pay button.

**API call:**
```
POST https://browning-sales-engine.devin-b58.workers.dev/api/checkout
{
  "product_slug": "zero-cost-ai-infra",
  "payment_method": "paypal" | "installment" | "coinbase",
  "customer_email": "...",
  "customer_name": "...",
  "installment_count": 3
}
```

### Success Page (success/index.html)

Three states: Loading (spinner) → Success (green check + download) → Error (red + contact support).

Query params: `?token=<order_id>` (PayPal capture), `?plan=true` (installment), `?method=crypto`.

---

## SALES ENGINE WORKER

**Location:** `cloud-node/worker/sales-engine.ts`
**Config:** `cloud-node/worker/wrangler-sales.toml`
**URL:** `browning-sales-engine.devin-b58.workers.dev`

### Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/products` | List deployed products |
| GET | `/api/product/<slug>` | Single product |
| POST | `/api/checkout` | Create payment intent |
| POST | `/api/paypal/capture` | Capture after approval |
| POST | `/webhooks/paypal` | PayPal event receiver |
| POST | `/webhooks/coinbase` | Coinbase event receiver |
| GET | `/api/delivery/<saleId>` | Download link (token-protected) |
| GET | `/api/stats` | Revenue analytics |
| GET | `/health` | Health check |

### Secrets

```
SUPABASE_URL, SUPABASE_KEY, PAYPAL_CLIENT_ID, PAYPAL_SECRET,
PAYPAL_MODE, COINBASE_API_KEY, COINBASE_WEBHOOK_SECRET,
STORE_URL, WEBHOOK_SECRET
```

### Webhook Setup

**PayPal:** URL `…/webhooks/paypal`, events `PAYMENT.CAPTURE.COMPLETED` + `PAYMENT.SALE.COMPLETED`, RSA signature verification.

**Coinbase:** URL `…/webhooks/coinbase`, events `charge:confirmed` + `charge:resolved`, HMAC-SHA256 verification.

---

## PAYMENT FLOWS

### PayPal One-Time ($47)
```
Customer → POST /api/checkout {paypal} → Create PayPal Order →
→ approve_url → Customer approves at PayPal →
→ /success?token=<id> → POST /api/paypal/capture →
→ Insert product_sales → Generate delivery token → Show download
```

### Installments (3x $15.67)
```
Customer → POST /api/checkout {installment} →
→ Create/reuse PayPal billing plan (cached in product metadata) →
→ Create subscription → approve_url → Customer approves →
→ /success?plan=true → Webhook handles each installment payment
```

### Crypto (BTC/ETH/USDC)
```
Customer → POST /api/checkout {coinbase} →
→ Create Coinbase charge ($47 fixed) → checkout_url →
→ Customer pays → Webhook charge:confirmed →
→ Insert product_sales → /success?method=crypto
```

---

## OCI PROVISIONER WORKER

**Location:** `cloud-node/worker/oci-provisioner.ts`
**Config:** `cloud-node/worker/wrangler-oci.toml`
**Trigger:** Cron every 1 minute

Continuously attempts to provision an Oracle Cloud ARM instance (free tier is capacity-constrained). Cycles availability domains, retries until it lands one.

**Instance:** VM.Standard.A1.Flex, 4 OCPU, 24GB RAM, 100GB boot, us-chicago-1

**Logic:** Check RUNNING → exit if found. Check PROVISIONING/STARTING → exit if pending. Pick AD via `minute % AD_count`. Call LaunchInstance. Log result (success/retry/rate_limit/error).

**Signing:** RSA-SHA256, OCI Signature Version 1.

**Secrets:** `OCI_PRIVATE_KEY, OCI_TENANCY_OCID, OCI_USER_OCID, OCI_FINGERPRINT, OCI_SSH_PUBLIC_KEY, SUPABASE_URL, SUPABASE_KEY`

**Endpoints:** GET `/` (info), GET `/status` (instance check)

---

## TASK DISPATCHER WORKER

**Location:** `cloud-node/worker/task-dispatcher.ts`
**Config:** `cloud-node/worker/wrangler.toml`
**URL:** `browning-cloud-node-dispatcher.devin-b58.workers.dev`

Web dashboard + API for dispatching tasks to the autonomous agent.

**Endpoints:** Login (`/`), Dashboard (`/dashboard`), Submit task (`POST /task`), Get task (`/task/:id`), List tasks (`/tasks`), Cancel (`POST /task/:id/cancel`), Health (`/health`).

**Auth:** Bearer token or cookie (`node_token`). Token set via `TASK_AUTH_TOKEN` secret.

**Task fields:** prompt (max 50KB), repo, branch, priority (low/normal/high/critical), timeout (1-120min), skip_permissions, continue_session.

**Secrets:** `SUPABASE_URL, SUPABASE_KEY, TASK_AUTH_TOKEN, ALLOWED_ORIGIN`

---

## CONTENT QUEUE POSTER WORKER

**Location:** `cloud-node/worker/content-queue-poster.ts`
**Config:** `cloud-node/worker/wrangler-poster.toml`
**Trigger:** Cron every 15 minutes, processes up to 5 items per run.

**Platforms:** Twitter/X (OAuth 1.0a HMAC-SHA1), LinkedIn (v2 Bearer token). Credentials stored in `claude_system_state`.

**Secrets:** `SUPABASE_URL, SUPABASE_KEY, POSTER_AUTH_TOKEN`

---

## ON-INSTANCE SERVICES (Cloud Node)

Run on Oracle ARM instance, managed by systemd:

| Service | What It Does |
|---------|-------------|
| `task-watcher.service` | Polls `cloud_node_tasks` every 30s, executes via Claude Code headless |
| `scheduled-dispatcher.service` | Checks `scheduled_tasks` for due items, inserts into task queue |
| `cloud-node-relay.service` | WebSocket chat relay for real-time agent communication |
| Cloudflare Tunnel (`cloudflared`) | Secure access to code-server, relay, services — no exposed ports |

**Bootstrap:** `cloud-node/scripts/cloud-init.sh` runs on first boot — installs Node, Claude CLI, code-server, tunnel, systemd services.

---

## AGENT IDENTITY

**Location:** `cloud-node/agent/CLAUDE.md`

The autonomous agent is a revenue-generating business partner, not a chatbot. Runs 24/7 on dedicated ARM. Has full system access, credentials, Playwright, entire Browning infrastructure.

**Data assets:** 902 ingested articles, 19 golden nuggets (validated product ideas), 15 gold-tier content pieces, 10 AI market learnings.

**Autonomy:** Full autonomy to build products from validated nuggets, deploy landing pages, post content, price under $100. Notifies Devin for pricing over $100. Asks permission to spend money.

**Workflows:** `daily-ops.md` (revenue + pipeline + health), `content-generation.md` (source → generate → queue → measure), `package-nugget.md` (select → research → build → deploy → distribute → measure).

---

## DATABASE SCHEMA

**Supabase:** `wcdyvukzlxxkgvxomaxr.supabase.co`

| Table | Purpose |
|-------|---------|
| `products` | Catalog (name, slug, price, tier, status, delivery_url, metadata) |
| `product_sales` | Every sale (amount, source, customer_email, payment_id) |
| `cloud_node_tasks` | Task queue (prompt, status, output, error, priority) |
| `scheduled_tasks` | Recurring task definitions |
| `content_queue` | Social post queue (platform, body, status, engagement) |
| `golden_nuggets` | Validated product ideas with pricing |
| `raw_content` | 902+ ingested articles |
| `v2_gold_content` | Scored content (score >= 75 = gold) |
| `rm_ai_learnings` | AI market insights with confidence |
| `claude_system_state` | Key-value: credentials, config, state |
| `revenue_daily` | Daily revenue snapshots |
| `provisioner_logs` | OCI attempt history |

---

## SECRETS & CREDENTIALS

**Never ask Devin for keys.** Lookup order:
1. `get_credentials("key")` via Browning Memory MCP
2. Direct Supabase query on `claude_system_state`
3. Token creator for Cloudflare (auto-generate scoped tokens)
4. Ask Devin only if all fail

**Supabase Management API (fallback when MCP is down):**
```
POST https://api.supabase.com/v1/projects/wcdyvukzlxxkgvxomaxr/database/query
Authorization: Bearer sbp_77f3a4025505ccf2e7dfa518913224b79fab3dd1
{"query": "SELECT state_key, state_value FROM claude_system_state WHERE state_key = 'cloudflare_credentials'"}
```

**Available keys:** `cloudflare`, `supabase`, `github`, `anthropic`, `openai`, `discord`, `twitter_credentials`, `linkedin_credentials`, `paypal`, `coinbase`

---

## PRODUCT PIPELINE

### Live Now
- Zero-Cost AI Infrastructure Kit — Starter ($47) ✓

### Ready to Ship
1. Zero-Cost AI Infra — Pro ($297 course) / Premium ($997 DFY)
2. Zero-Overhead AI Business Stack ($47 repo, $297 course)
3. AI Session Continuity System (open-source + $497 course)
4. Golden Nugget Content System ($27 template, $497 system)
5. 12th Man QA Methodology ($47 doc, $197 guide)

### Upsell Strategy
- Order bump at checkout (Pro tier, discounted)
- Post-purchase upsell page (DFY at $697 "just bought" price)
- Email drip: 3 days → case studies → Pro tier offer
- Bundle: all starter kits at 40% off

---

## DESIGN PHILOSOPHY (NON-NEGOTIABLE)

**Never use SvelteKit, React, Next.js, or any framework for customer-facing pages.** Pure HTML/CSS/JS only.

Study and apply: Gumroad (clean, minimal), Sellix (dark mode, exclusive feel), Shopify top converters (urgency, sticky CTAs), drop culture brands (scarcity), Apple (progressive disclosure), Stripe Checkout (trust).

**Rules:** Bleeding-edge native CSS. Copy hierarchy is king. Social proof is structural. Mobile-first. Under 50KB. Dark mode default. Checkout is sacred. Upsell while wallet is open.

**Never:** Component libraries. 6+ nav links on sales pages. Stock SVG blobs. Price below fold on mobile. "Learn More" instead of "Buy Now". Loading spinners.

---

## BUILD TIMELINE (Last ~10 Days)

| When | What | Commit |
|------|------|--------|
| Feb 16 | Cloud Node — $0 always-on dev environment | `ccb4a68` |
| Feb 16 | iPhone-only setup flow | `74dc01b` |
| Feb 17 | Mobile-first task dispatcher dashboard | `1fb6613` |
| Feb 17 | Chat relay + live screen view | `06be6d5` |
| Feb 18 | Cloudflare Tunnel live | `5347016` |
| Feb 18 | OCI provisioner daemon + watchdog | `c860890` |
| Feb 19 | Multi-AD cycling, cloud-init | `e3b067f` |
| Feb 20 | **First product defined** ($47 kit) | `6bd1b07` |
| Feb 21 | Autonomous agent identity + pipeline | `d9f64e4` |
| Feb 22 | Infrastructure gap close (security, tables, social) | `4652f71` |
| Feb 23 | **Sales Engine** (PayPal + crypto + installments) | `c565715` |
| Feb 23 | 42-gap audit (sales, content, security, SQL) | `078b0c8` |
| Feb 24 | **Pure HTML storefront** — zero framework | `61fddab` |
| Feb 24 | Sticky mobile CTA | `c013040` |
| Feb 25 | **OCI provisioner → Cloudflare Worker** | `1fa9123` |
| Feb 25 | Design philosophy locked in permanently | `db68651` |

**The arc:** Free infra → iPhone control → product definition → sales engine → storefront → provisioner migration → design philosophy lock.

---

## CURRENT STATUS & NEXT STEPS

### What's Live
- Storefront at shop.browningdigital.com (pure HTML)
- Sales Engine Worker (PayPal + Coinbase + installments)
- Task Dispatcher Worker
- Content Queue Poster Worker (cron running)
- OCI Provisioner Worker (cron running)

### Needs Attention
- PayPal mode: verify `live` vs `sandbox`
- Coinbase webhook URL: confirm registered in Commerce dashboard
- Product delivery: verify `delivery_url` in `products` table
- Email on purchase: no transactional email trigger yet
- Social credentials: Twitter + LinkedIn need populating in `claude_system_state`
- OCI instance: confirm provisioner has landed an instance
- Analytics: no tracking on storefront yet

### Immediate Next Steps
1. Test end-to-end checkout (live purchase)
2. Set up delivery asset (the actual downloadable kit)
3. Add post-purchase email (transactional service)
4. Build post-purchase upsell page (Pro at $297)
5. Populate content queue with launch posts
6. Drive first traffic
