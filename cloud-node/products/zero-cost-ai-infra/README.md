# Zero-Cost AI Autonomous Infrastructure — Starter Kit

Deploy a fully autonomous AI agent on free-tier cloud infrastructure. No monthly bills. No manual babysitting. Your AI works 24/7 while you sleep.

## What You Get

- **Auto-provisioning scripts** — One command spins up an Oracle Cloud ARM instance (4 OCPU, 24GB RAM, free forever)
- **Cloudflare Tunnel setup** — Secure access to your agent from anywhere, no exposed ports
- **Task dispatch system** — Queue tasks via API, your agent picks them up and executes autonomously
- **Scheduled automation** — Cron-like system that dispatches recurring tasks (daily reports, content processing, data extraction)
- **Session continuity** — Agent maintains context across sessions using Supabase (free tier: 500MB, 50k monthly active users)
- **Chat relay** — WebSocket server so you can talk to your agent through any interface
- **Agent identity template** — Pre-built CLAUDE.md that defines your agent's personality, goals, and operating rules

## Architecture

```
┌─────────────────────────────────────┐
│  Oracle Cloud ARM (Free Tier)       │
│  4 OCPU • 24GB RAM • 200GB disk    │
│                                     │
│  ┌─────────────┐  ┌──────────────┐  │
│  │ Claude Code  │  │ Task Watcher │  │
│  │ (headless)   │←─│ (polls DB)   │  │
│  └─────────────┘  └──────────────┘  │
│         ↑                ↑          │
│  ┌──────┴──────┐  ┌──────┴───────┐  │
│  │ Chat Relay  │  │  Scheduler   │  │
│  │ (WebSocket) │  │ (systemd)    │  │
│  └─────────────┘  └──────────────┘  │
│         ↑                           │
│  ┌──────┴──────────────────────┐    │
│  │ Cloudflare Tunnel           │    │
│  │ (Zero Trust Access)         │    │
│  └─────────────────────────────┘    │
└─────────────────────────────────────┘
          ↕
┌─────────────────────────────────────┐
│  Supabase (Free Tier)               │
│  Tasks • State • Memory • Logs      │
└─────────────────────────────────────┘
```

## Quick Start

### Prerequisites
- Oracle Cloud free account (cloud.oracle.com)
- Cloudflare account (free plan works)
- Supabase account (free tier)
- Anthropic API key (for Claude)

### 1. Clone and Configure

```bash
git clone <this-repo>
cd zero-cost-ai-infra
cp .env.example .env
# Edit .env with your API keys
```

### 2. Set Up Supabase

```bash
# Run the schema migration
./scripts/setup-db.sh
```

This creates the tables: `cloud_node_tasks`, `scheduled_tasks`, `claude_system_state`

### 3. Provision the Instance

```bash
# Configure OCI CLI
./scripts/setup-oci.sh

# Launch the provisioner (retries until capacity is available)
./scripts/provision.sh
```

The provisioner handles everything: instance creation, cloud-init bootstrap, Cloudflare tunnel setup, code-server installation, task-watcher activation.

### 4. Define Your Agent

Edit `agent/CLAUDE.md` to define:
- What your agent does
- What data it has access to
- What decisions it can make autonomously
- What requires your approval

### 5. Queue Your First Task

```bash
curl -X POST "$SUPABASE_URL/rest/v1/cloud_node_tasks" \
  -H "apikey: $SUPABASE_KEY" \
  -H "Authorization: Bearer $SUPABASE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"prompt": "Hello! Check all systems and report status.", "status": "queued"}'
```

Your agent picks it up within 30 seconds.

## What's Included

```
├── agent/
│   ├── CLAUDE.md              # Agent identity template
│   └── workflows/             # Reusable workflow templates
│       ├── daily-ops.md       # Daily health check
│       └── custom-workflow.md # Template for your own workflows
├── scripts/
│   ├── cloud-init.sh          # Instance bootstrap (runs on first boot)
│   ├── task-watcher.sh        # Polls Supabase for tasks, executes via Claude
│   ├── scheduled-dispatcher.sh # Dispatches recurring tasks
│   ├── provision.sh           # OCI instance provisioner
│   └── setup-db.sh            # Supabase schema setup
├── services/
│   ├── task-watcher.service   # systemd service for task watcher
│   ├── scheduled-dispatcher.service
│   └── scheduled-dispatcher.timer
├── relay/
│   └── server.js              # WebSocket chat relay
├── .env.example               # Configuration template
└── README.md                  # This file
```

## Cost Breakdown

| Service | Tier | Monthly Cost |
|---------|------|-------------|
| Oracle Cloud ARM | Always Free | $0 |
| Cloudflare Tunnel | Free plan | $0 |
| Supabase | Free tier | $0 |
| Anthropic API | Pay-per-use | ~$5-50* |

*API cost depends on usage. A typical autonomous agent running 10-20 tasks/day costs $5-15/month.

## FAQ

**Q: Why Oracle Cloud instead of AWS/GCP/Azure?**
Oracle's Always Free tier includes ARM instances with 4 OCPU and 24GB RAM — permanently free, not a trial. No other provider offers this.

**Q: What if Oracle doesn't have capacity?**
The provisioner includes automatic retry with exponential backoff. It will keep trying until capacity opens up. In our experience, Chicago and Phoenix regions have the best availability.

**Q: Can I use GPT-4 instead of Claude?**
The task-watcher is built around Claude Code CLI, but the architecture works with any LLM that has a CLI or API. You'd need to modify `task-watcher.sh` to call your preferred model.

**Q: Is this secure?**
Yes. Cloudflare Tunnel means no ports are exposed to the internet. Zero Trust Access policies control who can reach your services. All API keys are stored as environment variables, never in code.

## License

MIT — Use it however you want.
