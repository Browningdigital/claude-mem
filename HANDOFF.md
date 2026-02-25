# SESSION HANDOFF — Feb 25, 2026 ~04:50 UTC

## WHAT'S HAPPENING RIGHT NOW

**OCI ARM Provisioner** is running (PID 3552) trying to grab a free-tier ARM instance in `us-chicago-1`. 85+ attempts, ALL out of capacity. No instance has been created yet — verified directly via OCI API (no RUNNING, PROVISIONING, or STARTING instances exist).

**Daemon is alive BUT will die when this container goes dormant.** Cron watchdog (`* * * * *`) exists but dies with the container too.

## THE #1 PROBLEM: 86% DOWNTIME

This container environment sleeps when no active session is connected. Timeline analysis shows the provisioner has only been active ~14% of the time since it started (~19.5 hours ago). We've missed capacity windows during the 16+ hours of dormancy.

**The previous session identified the fix: build a Cloudflare Worker with a cron trigger to replace the bash daemon.** User explicitly approved this ("Cloudflare is my entire ecosystem — stop asking and build"). The Worker was being built when context was lost.

## WHAT NEEDS TO HAPPEN NEXT (PRIORITY ORDER)

### 1. BUILD THE CLOUDFLARE WORKER PROVISIONER (CRITICAL)
- Worker with `cron = "* * * * *"` trigger (every minute)
- OCI REST API with RSA-SHA256 request signing (Web Crypto API)
- Cycles through all 3 ADs: `NvCA:US-CHICAGO-1-AD-1`, `AD-2`, `AD-3`
- Checks if instance exists before launching (avoid duplicates)
- Logs to Supabase `oci_provisioner_log` table
- Deploy to `oci-provisioner.devin-b58.workers.dev`
- This replaces the bash daemon entirely — runs 24/7 on Cloudflare edge

### 2. Set Worker Secrets
All OCI config is in `/tmp/oci-provisioner.env`. Secrets needed:
- `OCI_PRIVATE_KEY` — at `/root/.oci/oci_api_key.pem` (PKCS8 RSA key)
- `OCI_TENANCY_OCID` — `ocid1.tenancy.oc1..aaaaaaaavdyv4edz5ucgy7obwwqnpief3hs3gssmgprbukebzzw22p4dclta`
- `OCI_USER_OCID` — `ocid1.user.oc1..aaaaaaaa255joztqwt44675onpaslffma7jwntpvi4fmmsafmzcrsm5znycq`
- `OCI_FINGERPRINT` — `2b:a7:a2:b0:7d:88:c9:92:2a:63:89:8a:61:e1:3f:13`
- `OCI_COMPARTMENT_ID` — same as tenancy OCID (root compartment)
- `OCI_SUBNET_ID` — `ocid1.subnet.oc1.us-chicago-1.aaaaaaaa2fsougo5gfvf4iejp26wrevsyldjw4ij2iydrmadx3cjgvafchga`
- `OCI_IMAGE_ID` — `ocid1.image.oc1.us-chicago-1.aaaaaaaasgxseqzzng27gzr3cmxntq3zjl3jrq6k3n5zx23pde5b2d2tflqa`
- `OCI_SSH_PUBLIC_KEY` — at `/root/.ssh/oci_instance.pub`
- `SUPABASE_URL`, `SUPABASE_KEY` — from Browning Memory credentials

### 3. Cloud-init Tokens Still Placeholder
`cloud-init.sh` has `REPLACE_ME_WITH_TUNNEL_TOKEN` and `REPLACE_ME_WITH_PASSWORD`. When the instance IS created:
- Instance creation succeeds (SSH key in metadata works)
- Cloud-init bootstrap FAILS (exits on placeholder check)
- Manual SSH bootstrap required after instance creation
- To fix: create a Cloudflare Tunnel token and set `TUNNEL_TOKEN` in the env file before the daemon bakes metadata

## INFRASTRUCTURE STATUS (ALL GREEN)

| Component | Status |
|-----------|--------|
| OCI CLI auth | Working (user + tenancy + PEM key valid) |
| VCN/Subnet | AVAILABLE (`browning-public-subnet` in Chicago) |
| Image | AVAILABLE (Ubuntu 24.04 aarch64) |
| SSH Key | Present at `/root/.ssh/oci_instance.pub` |
| A1 Core Limit | 41 available, 0 used |
| Cron Watchdog | Active (`* * * * *`) |
| OCI Config | `/root/.oci/config` — region `us-chicago-1` |

## PROVISIONER SCRIPT AUDIT (CLEAN)

Scripts at `cloud-node/scripts/`:
- `oci-provisioner-daemon.sh` — main retry loop, signal-trapped, flock mutex, multi-AD cycling. **No bugs found.**
- `oci-provisioner-watchdog.sh` — cron companion, checks PID, clears stale locks, restarts daemon. **Works correctly when cron is alive.**
- `oci-provision-launch.sh` — one-time launcher that auto-detects ADs and writes env file.
- `provision-oracle.sh` — standalone version (predecessor to daemon).
- `cloud-init.sh` — bootstrap script (installs Docker, code-server, cloudflared, etc). **Has placeholder tokens.**

## INSTANCE CONFIG

- Shape: `VM.Standard.A1.Flex` (4 OCPU / 24 GB RAM / 100 GB boot)
- Region: `us-chicago-1`
- Display name: `browning-cloud-node`
- 3 ADs cycling: AD-1, AD-2, AD-3
- Retry interval: 45 seconds between attempts

## GIT STATE

- Branch: `claude/review-cloud-setup-vhfUp`
- Clean working tree
- Latest commit: `c013040 feat: sticky mobile CTA`
- No uncommitted changes

## DO NOT

- Do NOT use GitHub Actions (user explicitly said no — quota concern)
- Do NOT ask, just build the Cloudflare Worker
- Do NOT delete the bash daemon scripts — keep as fallback
- Do NOT hardcode secrets in source — use `wrangler secret put`
