/**
 * Browning Cloud Node — Content Queue Poster
 *
 * Cloudflare Worker (scheduled) that reads from the content_queue table
 * and posts content to social platforms via their APIs.
 *
 * Supported platforms:
 *   - Twitter/X (OAuth 1.0a — proper HMAC-SHA1 signature)
 *   - LinkedIn (Community Management API v2 — /rest/posts)
 *   - Threads (Meta Graph API — two-step container + publish)
 *
 * Runs on a cron trigger every 15 minutes.
 * Each run processes up to 5 queued items.
 *
 * Credentials stored in Supabase claude_system_state:
 *   - twitter_credentials: { api_key, api_secret, access_token, access_secret }
 *   - linkedin_credentials: { access_token, person_urn }
 *   - threads_credentials: { app_id, app_secret, user_access_token, threads_user_id }
 *
 * Deploy: cd cloud-node/worker && wrangler deploy -c wrangler-poster.toml
 * Secrets: SUPABASE_URL, SUPABASE_KEY, POSTER_AUTH_TOKEN
 */

interface Env {
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  POSTER_AUTH_TOKEN?: string;
}

interface QueueItem {
  id: string;
  platform: string;
  content_type: string;
  title: string | null;
  body: string;
  media_urls: string[];
  hashtags: string[] | null;
  product_id: string | null;
  status: string;
  scheduled_for: string | null;
  metadata: Record<string, any>;
}

interface PostResult {
  success: boolean;
  post_id?: string;
  url?: string;
  error?: string;
}

interface TwitterCreds {
  api_key: string;      // Consumer Key
  api_secret: string;   // Consumer Secret
  access_token: string; // User Access Token
  access_secret: string; // User Access Token Secret
}

interface LinkedInCreds {
  access_token: string;
  person_urn: string;  // e.g., "urn:li:person:abc123"
}

interface ThreadsCreds {
  app_id: string;
  app_secret: string;
  user_access_token: string;
  threads_user_id: string;
}

interface PlatformCredentials {
  twitter?: TwitterCreds;
  linkedin?: LinkedInCreds;
  threads?: ThreadsCreds;
}

export default {
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(processQueue(env));
  },

  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({ status: 'ok', service: 'content-queue-poster' });
    }

    if (url.pathname === '/post' && request.method === 'POST') {
      const auth = request.headers.get('Authorization');
      const expected = env.POSTER_AUTH_TOKEN;
      if (!expected || !auth || auth !== `Bearer ${expected}`) {
        return json({ error: 'Unauthorized' }, 401);
      }
      const result = await processQueue(env);
      return json(result);
    }

    if (url.pathname === '/status') {
      const stats = await getQueueStats(env);
      return json(stats);
    }

    return json({ error: 'Not found' }, 404);
  },
};

// ── Main processing loop ──

async function processQueue(env: Env): Promise<{ processed: number; results: any[] }> {
  const results: any[] = [];

  // Recover stuck items (scheduled > 10 minutes ago = stuck)
  await recoverStuckItems(env);

  const creds = await loadCredentials(env);

  const items = await supabaseQuery<QueueItem>(env, 'content_queue',
    'status=eq.queued&or=(scheduled_for.is.null,scheduled_for.lte.now())&order=created_at.asc&limit=5'
  );

  if (!items.length) {
    console.log('Content queue: no items to process');
    return { processed: 0, results: [] };
  }

  console.log(`Content queue: processing ${items.length} items`);

  for (const item of items) {
    try {
      await supabasePatch(env, 'content_queue', item.id, {
        status: 'scheduled',
        metadata: { ...item.metadata, processing_started: new Date().toISOString() },
      });

      let postResult: PostResult;

      switch (item.platform) {
        case 'twitter':
        case 'x':
          postResult = await postToTwitter(item, creds.twitter);
          break;
        case 'linkedin':
          postResult = await postToLinkedIn(item, creds.linkedin);
          break;
        case 'threads':
          postResult = await postToThreads(item, creds.threads);
          break;
        default:
          postResult = { success: false, error: `Unsupported platform: ${item.platform}` };
      }

      // Retry once on transient failures
      if (!postResult.success && isTransientError(postResult.error)) {
        console.log(`Retrying ${item.platform} post for ${item.id} after transient error`);
        await new Promise(r => setTimeout(r, 2000));
        switch (item.platform) {
          case 'twitter': case 'x':
            postResult = await postToTwitter(item, creds.twitter);
            break;
          case 'linkedin':
            postResult = await postToLinkedIn(item, creds.linkedin);
            break;
          case 'threads':
            postResult = await postToThreads(item, creds.threads);
            break;
        }
      }

      if (postResult.success) {
        await supabasePatch(env, 'content_queue', item.id, {
          status: 'posted',
          posted_at: new Date().toISOString(),
          metadata: { ...item.metadata, post_id: postResult.post_id, platform_url: postResult.url },
        });
        console.log(`Posted to ${item.platform}: ${postResult.post_id}`);
        results.push({ id: item.id, platform: item.platform, status: 'posted', post_id: postResult.post_id });
      } else {
        await supabasePatch(env, 'content_queue', item.id, {
          status: 'failed',
          metadata: { ...item.metadata, error: postResult.error, failed_at: new Date().toISOString() },
        });
        console.error(`Failed to post to ${item.platform}: ${postResult.error}`);
        results.push({ id: item.id, platform: item.platform, status: 'failed', error: postResult.error });
      }
    } catch (err: any) {
      await supabasePatch(env, 'content_queue', item.id, {
        status: 'failed',
        metadata: { ...item.metadata, error: err.message, failed_at: new Date().toISOString() },
      });
      console.error(`Exception posting ${item.id}: ${err.message}`);
      results.push({ id: item.id, platform: item.platform, status: 'error', error: err.message });
    }
  }

  return { processed: results.length, results };
}

function isTransientError(error?: string): boolean {
  if (!error) return false;
  return /timeout|network|5\d\d|ECONNRESET|fetch failed/i.test(error);
}

// ── Recover stuck items ──

async function recoverStuckItems(env: Env): Promise<void> {
  try {
    // Items stuck in 'scheduled' for > 10 minutes are considered failed
    const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const stuck = await supabaseQuery<QueueItem>(env, 'content_queue',
      `status=eq.scheduled&metadata->>processing_started=lt.${tenMinAgo}&limit=10`
    );
    for (const item of stuck) {
      await supabasePatch(env, 'content_queue', item.id, {
        status: 'queued',
        metadata: { ...item.metadata, recovered_from_stuck: new Date().toISOString() },
      });
      console.log(`Recovered stuck item ${item.id}`);
    }
  } catch (err: any) {
    console.error(`Failed to recover stuck items: ${err.message}`);
  }
}

// ══════════════════════════════════════
// TWITTER/X — OAuth 1.0a (HMAC-SHA1)
// ══════════════════════════════════════

async function postToTwitter(item: QueueItem, creds?: TwitterCreds): Promise<PostResult> {
  if (!creds?.api_key || !creds?.api_secret || !creds?.access_token || !creds?.access_secret) {
    return {
      success: false,
      error: 'Twitter credentials incomplete. Need api_key, api_secret, access_token, access_secret in claude_system_state twitter_credentials.',
    };
  }

  const text = formatForTwitter(item);
  const url = 'https://api.twitter.com/2/tweets';
  const method = 'POST';
  const body = JSON.stringify({ text });

  // Generate OAuth 1.0a signature
  const authHeader = await generateOAuth1Header(creds, method, url);

  const response = await fetch(url, {
    method,
    headers: {
      'Authorization': authHeader,
      'Content-Type': 'application/json',
    },
    body,
  });

  if (!response.ok) {
    const err = await response.text();
    if (response.status === 429) {
      return { success: false, error: `Twitter rate limit hit. Retry later. ${err.substring(0, 100)}` };
    }
    if (response.status === 401 || response.status === 403) {
      return {
        success: false,
        error: `Twitter auth failed (${response.status}). Check api_key/api_secret/access_token/access_secret. Error: ${err.substring(0, 200)}`,
      };
    }
    return { success: false, error: `Twitter API error ${response.status}: ${err.substring(0, 200)}` };
  }

  const data: any = await response.json();
  const tweetId = data.data?.id;

  return {
    success: true,
    post_id: tweetId,
    url: tweetId ? `https://twitter.com/i/web/status/${tweetId}` : undefined,
  };
}

// OAuth 1.0a HMAC-SHA1 signature generation
async function generateOAuth1Header(creds: TwitterCreds, method: string, url: string): Promise<string> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const nonce = crypto.randomUUID().replace(/-/g, '');

  const params: Record<string, string> = {
    oauth_consumer_key: creds.api_key,
    oauth_nonce: nonce,
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: timestamp,
    oauth_token: creds.access_token,
    oauth_version: '1.0',
  };

  // Build signature base string
  const paramString = Object.keys(params)
    .sort()
    .map(k => `${percentEncode(k)}=${percentEncode(params[k])}`)
    .join('&');

  const baseString = `${method}&${percentEncode(url)}&${percentEncode(paramString)}`;
  const signingKey = `${percentEncode(creds.api_secret)}&${percentEncode(creds.access_secret)}`;

  // HMAC-SHA1
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(signingKey),
    { name: 'HMAC', hash: 'SHA-1' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, encoder.encode(baseString));
  const signature = btoa(String.fromCharCode(...new Uint8Array(sig)));

  // Build Authorization header
  const authParams = {
    ...params,
    oauth_signature: signature,
  };

  const headerValue = Object.keys(authParams)
    .sort()
    .map(k => `${percentEncode(k)}="${percentEncode(authParams[k])}"`)
    .join(', ');

  return `OAuth ${headerValue}`;
}

function percentEncode(str: string): string {
  return encodeURIComponent(str)
    .replace(/!/g, '%21')
    .replace(/\*/g, '%2A')
    .replace(/'/g, '%27')
    .replace(/\(/g, '%28')
    .replace(/\)/g, '%29');
}

function formatForTwitter(item: QueueItem): string {
  let text = item.body;

  if (item.hashtags?.length) {
    const hashtagStr = item.hashtags.map(h => h.startsWith('#') ? h : `#${h}`).join(' ');
    if (text.length + hashtagStr.length + 2 <= 280) {
      text = `${text}\n\n${hashtagStr}`;
    }
  }

  if (text.length > 280) {
    text = text.substring(0, 277) + '...';
  }

  return text;
}

// ══════════════════════════════════════
// LINKEDIN — Community Management API v2
// ══════════════════════════════════════

async function postToLinkedIn(item: QueueItem, creds?: LinkedInCreds): Promise<PostResult> {
  if (!creds?.access_token || !creds?.person_urn) {
    return {
      success: false,
      error: 'LinkedIn credentials not configured. Store linkedin_credentials in claude_system_state with access_token and person_urn.',
    };
  }

  const text = formatForLinkedIn(item);

  // LinkedIn Community Management API (replaces deprecated UGC Posts)
  const postData = {
    author: creds.person_urn,
    commentary: text,
    visibility: 'PUBLIC',
    distribution: {
      feedDistribution: 'MAIN_FEED',
      targetEntities: [],
      thirdPartyDistributionChannels: [],
    },
    lifecycleState: 'PUBLISHED',
  };

  const response = await fetch('https://api.linkedin.com/rest/posts', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${creds.access_token}`,
      'Content-Type': 'application/json',
      'LinkedIn-Version': '202401',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify(postData),
  });

  if (!response.ok) {
    const err = await response.text();
    if (response.status === 429) {
      return { success: false, error: `LinkedIn rate limit hit. Retry later. ${err.substring(0, 100)}` };
    }
    if (response.status === 401) {
      return {
        success: false,
        error: `LinkedIn auth failed. Token may be expired (60-day expiry). Refresh in claude_system_state. Error: ${err.substring(0, 200)}`,
      };
    }
    return { success: false, error: `LinkedIn API error ${response.status}: ${err.substring(0, 200)}` };
  }

  const postId = response.headers.get('x-restli-id') || response.headers.get('x-linkedin-id') || 'unknown';

  return {
    success: true,
    post_id: postId,
    url: `https://www.linkedin.com/feed/update/${postId}`,
  };
}

function formatForLinkedIn(item: QueueItem): string {
  let text = '';

  if (item.title) {
    text = `${item.title}\n\n`;
  }
  text += item.body;

  if (item.hashtags?.length) {
    const hashtagStr = item.hashtags.map(h => h.startsWith('#') ? h : `#${h}`).join(' ');
    text += `\n\n${hashtagStr}`;
  }

  if (text.length > 3000) {
    text = text.substring(0, 2997) + '...';
  }

  return text;
}

// ══════════════════════════════════════
// THREADS — Meta Graph API (two-step publish)
// ══════════════════════════════════════

async function postToThreads(item: QueueItem, creds?: ThreadsCreds): Promise<PostResult> {
  if (!creds?.user_access_token || !creds?.threads_user_id) {
    return {
      success: false,
      error: 'Threads credentials incomplete. Need user_access_token and threads_user_id in claude_system_state threads_credentials.',
    };
  }

  const text = formatForThreads(item);

  // Step 1: Create media container
  const containerParams = new URLSearchParams({
    media_type: 'TEXT',
    text,
    access_token: creds.user_access_token,
  });

  const containerRes = await fetch(
    `https://graph.threads.net/v1.0/${creds.threads_user_id}/threads?${containerParams}`,
    { method: 'POST' },
  );

  if (!containerRes.ok) {
    const err = await containerRes.text();
    if (containerRes.status === 401 || containerRes.status === 190) {
      return {
        success: false,
        error: `Threads auth failed. Token may be expired (60-day long-lived). Refresh in claude_system_state. Error: ${err.substring(0, 200)}`,
      };
    }
    if (containerRes.status === 429) {
      return { success: false, error: `Threads rate limit hit. Retry later. ${err.substring(0, 100)}` };
    }
    return { success: false, error: `Threads container creation failed ${containerRes.status}: ${err.substring(0, 200)}` };
  }

  const containerData: any = await containerRes.json();
  const creationId = containerData.id;

  if (!creationId) {
    return { success: false, error: `Threads container created but no ID returned: ${JSON.stringify(containerData).substring(0, 200)}` };
  }

  // Step 2: Publish the container
  const publishParams = new URLSearchParams({
    creation_id: creationId,
    access_token: creds.user_access_token,
  });

  const publishRes = await fetch(
    `https://graph.threads.net/v1.0/${creds.threads_user_id}/threads_publish?${publishParams}`,
    { method: 'POST' },
  );

  if (!publishRes.ok) {
    const err = await publishRes.text();
    return { success: false, error: `Threads publish failed ${publishRes.status}: ${err.substring(0, 200)}` };
  }

  const publishData: any = await publishRes.json();
  const threadId = publishData.id;

  return {
    success: true,
    post_id: threadId,
    url: threadId ? `https://www.threads.net/post/${threadId}` : undefined,
  };
}

function formatForThreads(item: QueueItem): string {
  let text = '';

  if (item.title) {
    text = `${item.title}\n\n`;
  }
  text += item.body;

  if (item.hashtags?.length) {
    const hashtagStr = item.hashtags.map(h => h.startsWith('#') ? h : `#${h}`).join(' ');
    text += `\n\n${hashtagStr}`;
  }

  // Threads limit is 500 characters
  if (text.length > 500) {
    text = text.substring(0, 497) + '...';
  }

  return text;
}

// ── Credential loading ──

async function loadCredentials(env: Env): Promise<PlatformCredentials> {
  const creds: PlatformCredentials = {};

  try {
    const twitterRows = await supabaseQuery(env, 'claude_system_state',
      "state_key=eq.twitter_credentials&select=state_value");
    if (twitterRows.length && twitterRows[0].state_value) {
      creds.twitter = typeof twitterRows[0].state_value === 'string'
        ? JSON.parse(twitterRows[0].state_value)
        : twitterRows[0].state_value;
    }
  } catch (err: any) {
    console.error(`Failed to load Twitter credentials: ${err.message}`);
  }

  try {
    const linkedinRows = await supabaseQuery(env, 'claude_system_state',
      "state_key=eq.linkedin_credentials&select=state_value");
    if (linkedinRows.length && linkedinRows[0].state_value) {
      creds.linkedin = typeof linkedinRows[0].state_value === 'string'
        ? JSON.parse(linkedinRows[0].state_value)
        : linkedinRows[0].state_value;
    }
  } catch (err: any) {
    console.error(`Failed to load LinkedIn credentials: ${err.message}`);
  }

  try {
    const threadsRows = await supabaseQuery(env, 'claude_system_state',
      "state_key=eq.threads_credentials&select=state_value");
    if (threadsRows.length && threadsRows[0].state_value) {
      creds.threads = typeof threadsRows[0].state_value === 'string'
        ? JSON.parse(threadsRows[0].state_value)
        : threadsRows[0].state_value;
    }
  } catch (err: any) {
    console.error(`Failed to load Threads credentials: ${err.message}`);
  }

  return creds;
}

// ── Queue stats ──

async function getQueueStats(env: Env): Promise<any> {
  const [queued, posted, failed] = await Promise.all([
    supabaseQuery(env, 'content_queue', 'status=eq.queued&select=id&limit=100'),
    supabaseQuery(env, 'content_queue', 'status=eq.posted&select=id&limit=100'),
    supabaseQuery(env, 'content_queue', 'status=eq.failed&select=id&limit=100'),
  ]);

  const creds = await loadCredentials(env);

  return {
    queued: queued.length,
    posted: posted.length,
    failed: failed.length,
    platforms_configured: {
      twitter: !!creds.twitter?.api_key,
      linkedin: !!creds.linkedin?.access_token,
      threads: !!creds.threads?.user_access_token,
    },
  };
}

// ── Supabase helpers ──

async function supabaseQuery<T = any>(env: Env, table: string, filter: string): Promise<T[]> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    headers: {
      'apikey': env.SUPABASE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  if (!res.ok) throw new Error(`Supabase query ${table} failed: ${res.status}`);
  return res.json();
}

async function supabasePatch(env: Env, table: string, id: string, data: any): Promise<void> {
  const res = await fetch(`${env.SUPABASE_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH',
    headers: {
      'apikey': env.SUPABASE_KEY,
      'Authorization': `Bearer ${env.SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal',
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error(`Supabase patch ${table} failed: ${res.status}`);
}

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
