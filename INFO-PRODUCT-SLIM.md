# INFO PRODUCT — Project Instructions (Token-Optimized)

## IDENTITY
You are working with Devin Browning, founder of Browning Digital. Building and selling digital info products through a pure HTML/CSS/JS storefront on Cloudflare.

## WHAT'S LIVE RIGHT NOW
- **Product:** Zero-Cost AI Infrastructure Kit — $47 (PayPal, 3x installments, crypto)
- **Storefront:** shop.browningdigital.com (pure HTML, Cloudflare Pages)
- **Sales Engine:** browning-sales-engine.devin-b58.workers.dev
- **Task Dispatcher:** browning-cloud-node-dispatcher.devin-b58.workers.dev
- **Content Poster:** content-queue-poster.devin-b58.workers.dev (cron */15)
- **OCI Provisioner:** cron worker, every 1 min, us-chicago-1
- **Database:** Supabase wcdyvukzlxxkgvxomaxr.supabase.co
- **Cloudflare account:** b58ddf38aeebb77c0ec4c829ea42adf5

## REPO
`Browningdigital/claude-mem` — the `cloud-node/` directory has everything:
- `site/` — pure HTML storefront (LIVE)
- `worker/` — all 4 Cloudflare Workers (sales-engine.ts, task-dispatcher.ts, content-queue-poster.ts, oci-provisioner.ts)
- `agent/` — autonomous agent identity + workflows
- `products/` — product definitions
- `scripts/` — cloud-init, provisioner, setup scripts
- `services/` — systemd unit files
- `relay/` — WebSocket chat relay

## CREDENTIALS — FETCH ON DEMAND ONLY
Never ask Devin for keys. Only fetch when you actually need them:

1. Try Browning Memory MCP: `get_credentials("cloudflare")` (or supabase, github, paypal, coinbase, etc.)
2. If MCP down, direct query:
```
POST https://api.supabase.com/v1/projects/wcdyvukzlxxkgvxomaxr/database/query
Authorization: Bearer sbp_77f3a4025505ccf2e7dfa518913224b79fab3dd1
{"query": "SELECT state_value FROM claude_system_state WHERE state_key = '<key_name>'"}
```

## DESIGN RULES (NON-NEGOTIABLE)
- **NEVER** use SvelteKit, React, Next.js, or any framework for storefronts, landing pages, sales funnels, checkout flows, or upsell pages
- Pure HTML/CSS/JS only. Zero build step. CDN-native. Dark mode default.
- Bleeding-edge native CSS: scroll-driven animations, View Transitions, @property gradients, container queries
- Study conversion patterns from: Gumroad, Sellix, Shopify top themes, drop culture brands, Apple product pages
- Mobile-first. Under 50KB. Sticky bottom CTAs. No component libraries. No loading spinners.
- Copy hierarchy: headline sells, subhead qualifies, bullets prove, CTA closes

## DATABASE TABLES (reference only — don't query unless needed)
products, product_sales, cloud_node_tasks, scheduled_tasks, content_queue, golden_nuggets, raw_content, v2_gold_content, rm_ai_learnings, claude_system_state, revenue_daily, provisioner_logs

## SALES ENGINE ENDPOINTS
POST /api/checkout, POST /api/paypal/capture, POST /webhooks/paypal, POST /webhooks/coinbase, GET /api/products, GET /api/product/<slug>, GET /api/delivery/<id>, GET /api/stats, GET /health

## PRODUCT PIPELINE
**Live:** Zero-Cost AI Infra Kit ($47)
**Ready:** Pro ($297), Premium DFY ($997), AI Business Stack ($47/$297), Session Continuity ($497), Golden Nugget System ($27/$497), 12th Man QA ($47/$197)
**Upsell:** Order bump → post-purchase upsell → email drip → bundle

## SESSION BEHAVIOR — KEEP IT LEAN
- Do NOT run a startup sequence. Do NOT call load_full_context unless you specifically need historical context.
- Do NOT call log_session or log_event unless Devin asks you to track something.
- Fetch credentials only when a task requires them, not preemptively.
- Read code files only when you need to modify or reference them.
- If Devin asks what's deployed or what exists, reference THIS document first before querying anything.

## TECH STACK
- Workers: TypeScript + Hono + Cloudflare Workers
- Internal tools only: SvelteKit + Tailwind (admin panels, dashboards — never sales pages)
- Database: Supabase PostgreSQL with RLS
- Deploy: `wrangler deploy` for Workers, `wrangler pages deploy` for Pages
- Secrets: `wrangler secret put` — never hardcode

## WORKER SECRETS REFERENCE
**Sales Engine** (wrangler-sales.toml): SUPABASE_URL, SUPABASE_KEY, PAYPAL_CLIENT_ID, PAYPAL_SECRET, PAYPAL_MODE, COINBASE_API_KEY, COINBASE_WEBHOOK_SECRET, STORE_URL, WEBHOOK_SECRET
**Task Dispatcher** (wrangler.toml): SUPABASE_URL, SUPABASE_KEY, TASK_AUTH_TOKEN, ALLOWED_ORIGIN
**Content Poster** (wrangler-poster.toml): SUPABASE_URL, SUPABASE_KEY, POSTER_AUTH_TOKEN
**OCI Provisioner** (wrangler-oci.toml): OCI_PRIVATE_KEY, OCI_TENANCY_OCID, OCI_USER_OCID, OCI_FINGERPRINT, OCI_SSH_PUBLIC_KEY, SUPABASE_URL, SUPABASE_KEY
