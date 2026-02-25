/**
 * Browning Cloud Node — Content Queue Poster
 *
 * Cloudflare Worker (scheduled) that reads from the content_queue table
 * and actually posts content to social platforms via their APIs.
 *
 * Supported platforms:
 *   - Twitter/X (OAuth 2.0 — post tweets and threads)
 *   - LinkedIn (OAuth 2.0 — share posts)
 *
 * Runs on a cron trigger every 15 minutes.
 * Each run processes up to 5 queued items.
 *
 * Credentials are stored in Supabase claude_system_state:
 *   - twitter_credentials: { api_key, api_secret, access_token, access_secret }
 *   - linkedin_credentials: { access_token, person_urn }
 *
 * Deploy: cd cloud-node/worker && wrangler deploy -c wrangler-poster.toml
 * Secrets: wrangler secret put SUPABASE_URL, SUPABASE_KEY
 */

interface Env {
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
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

interface PlatformCredentials {
  twitter?: {
    api_key: string;
    api_secret: string;
    access_token: string;
    access_secret: string;
  };
  linkedin?: {
    access_token: string;
    person_urn: string;  // e.g., "urn:li:person:abc123"
  };
}

export default {
  // ── Cron trigger (every 15 minutes) ──
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(processQueue(env));
  },

  // ── HTTP trigger (manual/testing) ──
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return json({ status: 'ok', service: 'content-queue-poster' });
    }

    if (url.pathname === '/post' && request.method === 'POST') {
      // Require auth
      const auth = request.headers.get('Authorization');
      if (!auth) return json({ error: 'Unauthorized' }, 401);

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

  // Fetch credentials from claude_system_state
  const creds = await loadCredentials(env);

  // Fetch queued items (due now or past due)
  const items = await supabaseQuery<QueueItem>(env, 'content_queue',
    'status=eq.queued&or=(scheduled_for.is.null,scheduled_for.lte.now())&order=created_at.asc&limit=5'
  );

  if (!items.length) {
    return { processed: 0, results: [] };
  }

  for (const item of items) {
    try {
      // Mark as processing (prevent double-posting)
      await supabasePatch(env, 'content_queue', item.id, { status: 'scheduled' });

      let postResult: PostResult;

      switch (item.platform) {
        case 'twitter':
        case 'x':
          postResult = await postToTwitter(item, creds.twitter);
          break;
        case 'linkedin':
          postResult = await postToLinkedIn(item, creds.linkedin);
          break;
        default:
          postResult = { success: false, error: `Unsupported platform: ${item.platform}` };
      }

      if (postResult.success) {
        await supabasePatch(env, 'content_queue', item.id, {
          status: 'posted',
          posted_at: new Date().toISOString(),
          metadata: { ...item.metadata, post_id: postResult.post_id, platform_url: postResult.url },
        });
        results.push({ id: item.id, platform: item.platform, status: 'posted', post_id: postResult.post_id });
      } else {
        await supabasePatch(env, 'content_queue', item.id, {
          status: 'failed',
          metadata: { ...item.metadata, error: postResult.error, failed_at: new Date().toISOString() },
        });
        results.push({ id: item.id, platform: item.platform, status: 'failed', error: postResult.error });
      }
    } catch (err: any) {
      await supabasePatch(env, 'content_queue', item.id, {
        status: 'failed',
        metadata: { ...item.metadata, error: err.message, failed_at: new Date().toISOString() },
      });
      results.push({ id: item.id, platform: item.platform, status: 'error', error: err.message });
    }
  }

  return { processed: results.length, results };
}

// ── Twitter/X posting (OAuth 1.0a User Context) ──

interface PostResult {
  success: boolean;
  post_id?: string;
  url?: string;
  error?: string;
}

async function postToTwitter(item: QueueItem, creds?: PlatformCredentials['twitter']): Promise<PostResult> {
  if (!creds?.access_token) {
    return { success: false, error: 'Twitter credentials not configured. Store twitter_credentials in claude_system_state.' };
  }

  const text = formatForTwitter(item);

  // Twitter API v2 — Create Tweet
  // Uses OAuth 2.0 Bearer Token (User Access Token)
  const response = await fetch('https://api.twitter.com/2/tweets', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${creds.access_token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ text }),
  });

  if (!response.ok) {
    const err = await response.text();
    // If OAuth 2.0 bearer doesn't work, the user needs OAuth 1.0a
    if (response.status === 401 || response.status === 403) {
      return {
        success: false,
        error: `Twitter auth failed (${response.status}). Ensure twitter_credentials has a valid User Access Token with tweet.write scope. Error: ${err.substring(0, 200)}`,
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

function formatForTwitter(item: QueueItem): string {
  let text = item.body;

  // Append hashtags if they fit
  if (item.hashtags?.length) {
    const hashtagStr = item.hashtags.map(h => h.startsWith('#') ? h : `#${h}`).join(' ');
    if (text.length + hashtagStr.length + 2 <= 280) {
      text = `${text}\n\n${hashtagStr}`;
    }
  }

  // Truncate to 280 chars (Twitter limit)
  if (text.length > 280) {
    text = text.substring(0, 277) + '...';
  }

  return text;
}

// ── LinkedIn posting ──

async function postToLinkedIn(item: QueueItem, creds?: PlatformCredentials['linkedin']): Promise<PostResult> {
  if (!creds?.access_token || !creds?.person_urn) {
    return { success: false, error: 'LinkedIn credentials not configured. Store linkedin_credentials in claude_system_state with access_token and person_urn.' };
  }

  const text = formatForLinkedIn(item);

  // LinkedIn Share API v2
  const shareData: any = {
    author: creds.person_urn,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text },
        shareMediaCategory: 'NONE',
      },
    },
    visibility: {
      'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC',
    },
  };

  const response = await fetch('https://api.linkedin.com/v2/ugcPosts', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${creds.access_token}`,
      'Content-Type': 'application/json',
      'X-Restli-Protocol-Version': '2.0.0',
    },
    body: JSON.stringify(shareData),
  });

  if (!response.ok) {
    const err = await response.text();
    if (response.status === 401) {
      return {
        success: false,
        error: `LinkedIn auth failed. Access token may be expired (they expire every 60 days). Refresh it in claude_system_state. Error: ${err.substring(0, 200)}`,
      };
    }
    return { success: false, error: `LinkedIn API error ${response.status}: ${err.substring(0, 200)}` };
  }

  const postId = response.headers.get('x-restli-id') || 'unknown';

  return {
    success: true,
    post_id: postId,
    url: `https://www.linkedin.com/feed/update/${postId}`,
  };
}

function formatForLinkedIn(item: QueueItem): string {
  let text = '';

  // LinkedIn allows longer posts — add title if present
  if (item.title) {
    text = `${item.title}\n\n`;
  }
  text += item.body;

  // Append hashtags
  if (item.hashtags?.length) {
    const hashtagStr = item.hashtags.map(h => h.startsWith('#') ? h : `#${h}`).join(' ');
    text += `\n\n${hashtagStr}`;
  }

  // LinkedIn has a 3000 char limit
  if (text.length > 3000) {
    text = text.substring(0, 2997) + '...';
  }

  return text;
}

// ── Credential loading ──

async function loadCredentials(env: Env): Promise<PlatformCredentials> {
  const creds: PlatformCredentials = {};

  try {
    // Fetch twitter credentials
    const twitterRows = await supabaseQuery(env, 'claude_system_state',
      "state_key=eq.twitter_credentials&select=state_value");
    if (twitterRows.length && twitterRows[0].state_value) {
      creds.twitter = typeof twitterRows[0].state_value === 'string'
        ? JSON.parse(twitterRows[0].state_value)
        : twitterRows[0].state_value;
    }
  } catch { /* Twitter creds not available */ }

  try {
    // Fetch linkedin credentials
    const linkedinRows = await supabaseQuery(env, 'claude_system_state',
      "state_key=eq.linkedin_credentials&select=state_value");
    if (linkedinRows.length && linkedinRows[0].state_value) {
      creds.linkedin = typeof linkedinRows[0].state_value === 'string'
        ? JSON.parse(linkedinRows[0].state_value)
        : linkedinRows[0].state_value;
    }
  } catch { /* LinkedIn creds not available */ }

  return creds;
}

// ── Queue stats ──

async function getQueueStats(env: Env): Promise<any> {
  const queued = await supabaseQuery(env, 'content_queue', 'status=eq.queued&select=id&limit=100');
  const posted = await supabaseQuery(env, 'content_queue', 'status=eq.posted&select=id&limit=100');
  const failed = await supabaseQuery(env, 'content_queue', 'status=eq.failed&select=id&limit=100');

  return {
    queued: queued.length,
    posted: posted.length,
    failed: failed.length,
    platforms_configured: {
      twitter: 'check claude_system_state for twitter_credentials',
      linkedin: 'check claude_system_state for linkedin_credentials',
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
  if (!res.ok) throw new Error(`Supabase query failed: ${res.status}`);
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
  if (!res.ok) throw new Error(`Supabase patch failed: ${res.status}`);
}

function json(data: any, status = 200): Response {
  return new Response(JSON.stringify(data, null, 2), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}
