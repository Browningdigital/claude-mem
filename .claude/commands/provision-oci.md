# OCI ARM Instance Provisioner

Launch or manage the Oracle Cloud ARM instance provisioner daemon.

## What This Does

Starts an unkillable background daemon that retries OCI ARM instance creation
(VM.Standard.A1.Flex — Always Free tier) until capacity is available. The daemon:
- Cycles through all availability domains in the region
- Survives session disconnects (signal-trapped + cron watchdog)
- Auto-fetches OCI credentials from Supabase if not set
- Stops itself when an instance is successfully created

## Usage

The provisioner scripts live at: `cloud-node/scripts/`

### Quick Start (run the launcher)

```bash
# Launch — sets up OCI CLI, creds, SSH keys, cron, and daemon in one command
./cloud-node/scripts/oci-provision-launch.sh

# Check status
./cloud-node/scripts/oci-provision-launch.sh --status

# View logs
./cloud-node/scripts/oci-provision-launch.sh --logs

# Stop everything
./cloud-node/scripts/oci-provision-launch.sh --stop
```

### With Custom Config

```bash
export OCI_COMPARTMENT_ID='ocid1.tenancy.oc1...'
export OCI_SUBNET_ID='ocid1.subnet.oc1...'
export OCI_IMAGE_ID='ocid1.image.oc1...'
export OCI_OCPUS=4
export OCI_MEMORY_GB=24
./cloud-node/scripts/oci-provision-launch.sh
```

### Files

| File | Purpose |
|------|---------|
| `oci-provision-launch.sh` | One-command setup: installs deps, fetches creds, starts daemon |
| `oci-provisioner-daemon.sh` | The unkillable retry daemon (signal-trapped, flock-guarded) |
| `oci-provisioner-watchdog.sh` | Cron companion that resurrects the daemon if killed |
| `provision-oracle.sh` | Simpler standalone version (env-var driven, no daemon mode) |
| `cloud-init.sh` | Bootstrap script injected into new instances via user-data |
| `bootstrap.sh` | Full OS setup script (run manually after SSH) |

### Success Detection

When the instance is created, these marker files appear:
- `/tmp/oci-instance-created.id` — Instance OCID
- `/tmp/oci-instance-created.ip` — Public IP address
- `/tmp/oci-instance-created.ad` — Availability domain used

### Credential Flow

1. Checks env vars first (`OCI_COMPARTMENT_ID`, etc.)
2. Falls back to Supabase: `claude_system_state` → `oracle_cloud_credentials`
3. Writes `~/.oci/config` if OCI CLI isn't configured
4. Generates SSH keypair if missing

### To Store OCI Credentials in Supabase

```sql
INSERT INTO claude_system_state (state_key, state_value)
VALUES ('oracle_cloud_credentials', '{
  "compartment_id": "ocid1.tenancy.oc1...",
  "subnet_id": "ocid1.subnet.oc1...",
  "image_id": "ocid1.image.oc1...",
  "tenancy": "ocid1.tenancy.oc1...",
  "user": "ocid1.user.oc1...",
  "fingerprint": "xx:xx:xx:...",
  "region": "us-chicago-1",
  "key_content": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----",
  "availability_domains": "NvCA:US-CHICAGO-1-AD-1,NvCA:US-CHICAGO-1-AD-2,NvCA:US-CHICAGO-1-AD-3"
}')
ON CONFLICT (state_key)
DO UPDATE SET state_value = EXCLUDED.state_value, updated_at = NOW();
```
