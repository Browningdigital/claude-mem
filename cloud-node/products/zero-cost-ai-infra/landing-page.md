# Landing Page Content — Zero-Cost AI Autonomous Infrastructure

## Headline
**Your AI Agent Runs 24/7 on Infrastructure That Costs $0/Month**

## Subheadline
Deploy a fully autonomous AI agent on Oracle Cloud's free ARM tier — 4 CPU cores, 24GB RAM, forever free. No DevOps experience required.

## Problem
You want an AI agent that works autonomously — processing data, generating content, monitoring systems, executing tasks while you sleep. But cloud infrastructure costs $50-200/month, and setting it up takes days of DevOps work you don't want to do.

## Solution
This starter kit gives you production-ready scripts that provision, configure, and manage an autonomous AI agent on 100% free-tier infrastructure. One command to deploy. Runs indefinitely.

## What's Inside

- **Auto-provisioning scripts** — Handles Oracle Cloud instance creation with automatic retry when capacity is limited
- **Cloudflare Tunnel** — Secure remote access without exposing ports. Access your agent from any device.
- **Task dispatch system** — Queue tasks via simple API calls. Your agent picks them up and executes within 30 seconds.
- **Scheduled automation** — Built-in cron system for recurring tasks (daily reports, data processing, content generation)
- **Agent identity framework** — Template for defining what your AI can and can't do autonomously
- **Chat relay** — Talk to your running agent via WebSocket from any interface
- **Session continuity** — Agent maintains context across restarts using Supabase free tier

## Who This Is For

- **Solopreneurs** who want AI automation without monthly cloud bills
- **AI developers** building autonomous agents who need reliable infrastructure
- **Side project builders** who want their AI to work while they sleep
- **Anyone** paying $50+/month for cloud compute they could get for free

## The Stack (All Free Tier)

| Component | What It Does | Cost |
|-----------|-------------|------|
| Oracle Cloud ARM | 4 OCPU, 24GB RAM compute | $0/mo |
| Cloudflare Tunnel | Secure networking | $0/mo |
| Supabase | Database + task queue | $0/mo |
| Your LLM API | The AI brain | ~$5-15/mo |

## What You'll Build

A self-healing autonomous agent that:
- Picks up tasks from a queue and executes them
- Runs scheduled jobs (daily reports, content processing)
- Recovers automatically from crashes (systemd watchdog)
- Accessible from anywhere via secure tunnel
- Maintains context across sessions

## Social Proof
"Built and battle-tested by Browning Digital. This exact infrastructure runs our autonomous content engine, processes hundreds of documents, and manages multiple SaaS products — all on zero-cost infrastructure."

## CTA
**Get the Starter Kit — $47**

Includes: All scripts, templates, setup guide, and the agent identity framework. Clone, configure, deploy.

## Guarantee
If you can't get it running within 48 hours, email me and I'll help you debug it personally or refund you. No questions.
