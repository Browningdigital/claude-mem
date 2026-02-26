// oci-provisioner.ts — Cloudflare Worker
// Hammers all 3 Chicago ADs every minute until an A1.Flex instance lands.

const SHAPE = "VM.Standard.A1.Flex";
const OCPUS = 4;
const MEMORY_GB = 24;
const BOOT_VOLUME_GB = 100;
const DISPLAY_NAME = "browning-cloud-node";

// Discord webhook for instant notification on success
const DISCORD_WEBHOOK = ""; // Set via env.DISCORD_WEBHOOK if available

interface Env {
  OCI_REGION: string;
  OCI_ADS: string;
  OCI_COMPARTMENT_ID: string;
  OCI_TENANCY_OCID: string;
  OCI_USER_OCID: string;
  OCI_FINGERPRINT: string;
  OCI_PRIVATE_KEY: string;
  OCI_IMAGE_ID: string;
  OCI_SUBNET_ID: string;
  OCI_SSH_PUBLIC_KEY: string;
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  DISCORD_WEBHOOK?: string;
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    const region = env.OCI_REGION || "us-chicago-1";
    const host = `iaas.${region}.oraclecloud.com`;
    const ads = (env.OCI_ADS || "").split(",").filter(Boolean);

    if (ads.length === 0) {
      await log(env, "error", "No ADs configured in OCI_ADS");
      return;
    }

    // Check if we already have an instance
    try {
      const instances = await ociGet(
        env,
        host,
        `/20160918/instances?compartmentId=${encodeURIComponent(env.OCI_COMPARTMENT_ID)}&lifecycleState=RUNNING`
      );
      if (instances.length > 0) {
        await log(env, "exists", `Instance RUNNING: ${instances[0].id} — provisioner job done`);
        return;
      }
      for (const state of ["PROVISIONING", "STARTING"]) {
        const pending = await ociGet(
          env,
          host,
          `/20160918/instances?compartmentId=${encodeURIComponent(env.OCI_COMPARTMENT_ID)}&lifecycleState=${state}`
        );
        if (pending.length > 0) {
          await log(env, "pending", `Instance ${state}: ${pending[0].id} — waiting`);
          return;
        }
      }
    } catch (e: any) {
      await log(env, "error", `List check failed: ${e.message?.substring(0, 300)}`);
    }

    // TRY ALL ADs EVERY TICK — not just one
    const results: string[] = [];
    for (const ad of ads) {
      const launchBody = {
        compartmentId: env.OCI_COMPARTMENT_ID,
        availabilityDomain: ad,
        shape: SHAPE,
        shapeConfig: { ocpus: OCPUS, memoryInGBs: MEMORY_GB },
        sourceDetails: {
          sourceType: "image",
          imageId: env.OCI_IMAGE_ID,
          bootVolumeSizeInGBs: BOOT_VOLUME_GB,
        },
        createVnicDetails: {
          subnetId: env.OCI_SUBNET_ID,
          assignPublicIp: true,
        },
        displayName: DISPLAY_NAME,
        metadata: {
          ssh_authorized_keys: env.OCI_SSH_PUBLIC_KEY,
        },
      };

      try {
        const result = await ociPost(env, host, "/20160918/instances", launchBody);
        if (result && result.id) {
          const ip = result.primaryPublicIp || "pending";
          const msg = `INSTANCE CREATED! id=${result.id} ad=${ad} ip=${ip} state=${result.lifecycleState}`;
          await log(env, "success", msg);
          await notifyDiscord(env, msg);
          return; // Done — got one!
        }
        await log(env, "error", `Unexpected launch response: ${JSON.stringify(result).substring(0, 300)}`);
      } catch (e: any) {
        const msg = e.message || "";
        if (/out of (?:host )?capacity/i.test(msg) || /InternalError/i.test(msg)) {
          results.push(`${ad}: no capacity`);
        } else if (/TooManyRequests|429/i.test(msg)) {
          results.push(`${ad}: rate limited`);
        } else if (/LimitExceeded/i.test(msg)) {
          await log(env, "limit", `Shape limit exceeded — instance may already exist`);
          return;
        } else {
          await log(env, "error", `Launch failed — ${ad}: ${msg.substring(0, 400)}`);
          return; // Unknown error — stop and log, don't spam
        }
      }
    }

    // Single consolidated log entry for all ADs tried this tick
    if (results.length > 0) {
      await log(env, "retry", results.join(" | "));
    }
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/status") {
      try {
        const region = env.OCI_REGION || "us-chicago-1";
        const host = `iaas.${region}.oraclecloud.com`;
        const instances = await ociGet(
          env,
          host,
          `/20160918/instances?compartmentId=${encodeURIComponent(env.OCI_COMPARTMENT_ID)}&lifecycleState=RUNNING`
        );
        if (instances.length > 0) {
          return Response.json({
            status: "instance_running",
            instanceId: instances[0].id,
            displayName: instances[0].displayName,
            timeCreated: instances[0].timeCreated,
          });
        }

        // Get recent log stats
        const logStats = await getLogStats(env);
        return Response.json({
          status: "searching",
          message: "No instance yet — cron hitting ALL 3 ADs every minute",
          ...logStats,
        });
      } catch (e: any) {
        return Response.json({ status: "error", message: e.message }, { status: 500 });
      }
    }

    return Response.json({
      service: "oci-arm-provisioner",
      status: "running",
      strategy: "all-3-ADs-every-tick",
      region: env.OCI_REGION || "us-chicago-1",
      shape: SHAPE,
      config: `${OCPUS} OCPU / ${MEMORY_GB}GB RAM / ${BOOT_VOLUME_GB}GB boot`,
      cron: "every minute",
      endpoints: { "/": "health", "/status": "instance check" },
    });
  },
};

// --- OCI API helpers ---

async function ociGet(env: Env, host: string, path: string): Promise<any> {
  const date = new Date().toUTCString();
  const headersToSign = ["date", "(request-target)", "host"];
  const headerValues: Record<string, string> = { date, host };
  const signingString = headersToSign
    .map((h) => {
      if (h === "(request-target)") return `(request-target): get ${path}`;
      return `${h}: ${headerValues[h]}`;
    })
    .join("\n");

  const signature = await rsaSign(env.OCI_PRIVATE_KEY, signingString);
  const keyId = `${env.OCI_TENANCY_OCID}/${env.OCI_USER_OCID}/${env.OCI_FINGERPRINT}`;

  const res = await fetch(`https://${host}${path}`, {
    method: "GET",
    headers: {
      date,
      host,
      authorization: `Signature version="1",keyId="${keyId}",algorithm="rsa-sha256",headers="${headersToSign.join(" ")}",signature="${signature}"`,
    },
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GET ${res.status}: ${text.substring(0, 500)}`);
  return JSON.parse(text);
}

async function ociPost(env: Env, host: string, path: string, body: any): Promise<any> {
  const date = new Date().toUTCString();
  const bodyStr = JSON.stringify(body);
  const bodyBytes = new TextEncoder().encode(bodyStr);
  const bodyHash = await sha256Base64(bodyBytes);

  const headersToSign = ["date", "(request-target)", "host", "content-length", "content-type", "x-content-sha256"];
  const headerValues: Record<string, string> = {
    date,
    host,
    "content-length": bodyBytes.length.toString(),
    "content-type": "application/json",
    "x-content-sha256": bodyHash,
  };

  const signingString = headersToSign
    .map((h) => {
      if (h === "(request-target)") return `(request-target): post ${path}`;
      return `${h}: ${headerValues[h]}`;
    })
    .join("\n");

  const signature = await rsaSign(env.OCI_PRIVATE_KEY, signingString);
  const keyId = `${env.OCI_TENANCY_OCID}/${env.OCI_USER_OCID}/${env.OCI_FINGERPRINT}`;

  const res = await fetch(`https://${host}${path}`, {
    method: "POST",
    headers: {
      date,
      host,
      "content-type": "application/json",
      "content-length": bodyBytes.length.toString(),
      "x-content-sha256": bodyHash,
      authorization: `Signature version="1",keyId="${keyId}",algorithm="rsa-sha256",headers="${headersToSign.join(" ")}",signature="${signature}"`,
    },
    body: bodyStr,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`POST ${res.status}: ${text.substring(0, 500)}`);
  return JSON.parse(text);
}

// --- Crypto helpers ---

async function sha256Base64(data: Uint8Array): Promise<string> {
  const hash = await crypto.subtle.digest("SHA-256", data);
  return uint8ToBase64(new Uint8Array(hash));
}

async function rsaSign(pem: string, data: string): Promise<string> {
  const key = await importPKCS8(pem);
  const encoded = new TextEncoder().encode(data);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, encoded);
  return uint8ToBase64(new Uint8Array(sig));
}

let _cachedKey: CryptoKey | null = null;
let _cachedPem = "";
async function importPKCS8(pem: string): Promise<CryptoKey> {
  if (_cachedKey && _cachedPem === pem) return _cachedKey;
  const pemBody = pem
    .replace(/-----BEGIN (?:RSA )?PRIVATE KEY-----/g, "")
    .replace(/-----END (?:RSA )?PRIVATE KEY-----/g, "")
    .replace(/\s/g, "");
  const binary = base64ToUint8(pemBody);
  _cachedKey = await crypto.subtle.importKey(
    "pkcs8",
    binary.buffer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"]
  );
  _cachedPem = pem;
  return _cachedKey;
}

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

function base64ToUint8(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

// --- Logging ---

async function log(env: Env, level: string, message: string): Promise<void> {
  console.log(`[oci-provisioner] [${level}] ${message}`);
  if (!env.SUPABASE_URL || !env.SUPABASE_KEY) return;
  try {
    await fetch(`${env.SUPABASE_URL}/rest/v1/oci_provisioner_log`, {
      method: "POST",
      headers: {
        apikey: env.SUPABASE_KEY,
        Authorization: `Bearer ${env.SUPABASE_KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify({
        level,
        message,
        created_at: new Date().toISOString(),
      }),
    });
  } catch {
    // Fire and forget
  }
}

async function notifyDiscord(env: Env, message: string): Promise<void> {
  const webhook = env.DISCORD_WEBHOOK;
  if (!webhook) return;
  try {
    await fetch(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: `🎉 **OCI Provisioner Success!**\n\`\`\`\n${message}\n\`\`\``,
      }),
    });
  } catch {
    // Best effort
  }
}

async function getLogStats(env: Env): Promise<Record<string, any>> {
  if (!env.SUPABASE_URL || !env.SUPABASE_KEY) return {};
  try {
    const res = await fetch(
      `${env.SUPABASE_URL}/rest/v1/oci_provisioner_log?select=level,created_at&order=created_at.desc&limit=1`,
      {
        headers: {
          apikey: env.SUPABASE_KEY,
          Authorization: `Bearer ${env.SUPABASE_KEY}`,
        },
      }
    );
    const rows = await res.json() as any[];
    return { lastAttempt: rows[0]?.created_at, lastLevel: rows[0]?.level };
  } catch {
    return {};
  }
}
