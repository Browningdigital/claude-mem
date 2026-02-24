import type { Env } from '../types';

interface HandlerResult {
  title: string | null;
  content: string | null;
  metadata: Record<string, unknown>;
  error?: string;
  paywalled?: boolean;
}

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * Strip HTML tags from a string, collapsing whitespace.
 */
function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<nav[\s\S]*?<\/nav>/gi, '')
    .replace(/<footer[\s\S]*?<\/footer>/gi, '')
    .replace(/<header[\s\S]*?<\/header>/gi, '')
    .replace(/<aside[\s\S]*?<\/aside>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Extract a title from HTML by looking for <title> or <h1> tags.
 */
function extractTitle(html: string): string | null {
  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (titleMatch) {
    const cleaned = stripHtml(titleMatch[1]);
    if (cleaned.length > 0) return cleaned;
  }

  const h1Match = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1Match) {
    const cleaned = stripHtml(h1Match[1]);
    if (cleaned.length > 0) return cleaned;
  }

  return null;
}

/**
 * Extract article body text from HTML. Prefers <article>, then <main>,
 * falls back to <body> content.
 */
function extractBodyText(html: string): string | null {
  // Try <article> first
  const articleMatch = html.match(/<article[\s\S]*?>([\s\S]*?)<\/article>/i);
  if (articleMatch) {
    const text = stripHtml(articleMatch[1]);
    if (text.length > 100) return text;
  }

  // Try <main>
  const mainMatch = html.match(/<main[\s\S]*?>([\s\S]*?)<\/main>/i);
  if (mainMatch) {
    const text = stripHtml(mainMatch[1]);
    if (text.length > 100) return text;
  }

  // Fall back to <body>
  const bodyMatch = html.match(/<body[\s\S]*?>([\s\S]*?)<\/body>/i);
  if (bodyMatch) {
    const text = stripHtml(bodyMatch[1]);
    if (text.length > 100) return text;
  }

  return null;
}

/**
 * Determine whether the given URL is a Medium article (or custom-domain Medium).
 */
function isMediumUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    return (
      host === 'medium.com' ||
      host.endsWith('.medium.com') ||
      parsed.pathname.includes('/@')
    );
  } catch {
    return false;
  }
}

/**
 * Attempt extraction via Google Webcache.
 * Google caches most public pages and serves them without paywall JS.
 */
async function tryGoogleCache(url: string): Promise<HandlerResult | null> {
  try {
    const cacheUrl = `https://webcache.googleusercontent.com/search?q=cache:${encodeURIComponent(url)}`;
    const res = await fetch(cacheUrl, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      redirect: 'follow',
    });

    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html')) return null;

    const html = await res.text();
    const title = extractTitle(html);
    const content = extractBodyText(html);
    if (!content || content.length < 100) return null;

    return {
      title,
      content,
      metadata: { extractor: 'google-cache', cache_url: cacheUrl },
    };
  } catch {
    return null;
  }
}

/**
 * Attempt extraction via 12ft.io (paywall ladder).
 * Free, no auth needed, strips soft paywalls.
 */
async function try12ft(url: string): Promise<HandlerResult | null> {
  try {
    const proxyUrl = `https://12ft.io/${url}`;
    const res = await fetch(proxyUrl, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      redirect: 'follow',
    });

    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html')) return null;

    const html = await res.text();
    const title = extractTitle(html);
    const content = extractBodyText(html);
    if (!content || content.length < 100) return null;

    return {
      title,
      content,
      metadata: { extractor: '12ft.io', proxy_url: proxyUrl },
    };
  } catch {
    return null;
  }
}

/**
 * Attempt extraction via Archive.today.
 */
async function tryArchiveToday(url: string): Promise<HandlerResult | null> {
  try {
    const archiveUrl = `https://archive.ph/${url}`;
    const res = await fetch(archiveUrl, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      redirect: 'follow',
    });

    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html')) return null;

    const html = await res.text();
    const title = extractTitle(html);
    const content = extractBodyText(html);
    if (!content) return null;

    return {
      title,
      content,
      metadata: { extractor: 'archive.today', archive_url: archiveUrl },
    };
  } catch {
    return null;
  }
}

/**
 * Attempt extraction via Wayback Machine (Internet Archive).
 * Checks for the most recent snapshot and extracts from it.
 */
async function tryWaybackMachine(url: string): Promise<HandlerResult | null> {
  try {
    // Check availability
    const checkUrl = `https://archive.org/wayback/available?url=${encodeURIComponent(url)}`;
    const checkRes = await fetch(checkUrl, {
      headers: { 'User-Agent': 'ContentExtractor/2.0 (knowledge-capture)' },
    });

    if (!checkRes.ok) return null;
    const checkData = (await checkRes.json()) as {
      archived_snapshots?: { closest?: { url?: string; available?: boolean } };
    };

    const snapshot = checkData.archived_snapshots?.closest;
    if (!snapshot?.available || !snapshot.url) return null;

    // Fetch the archived page
    const res = await fetch(snapshot.url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      redirect: 'follow',
    });

    if (!res.ok) return null;
    const html = await res.text();
    const title = extractTitle(html);
    const content = extractBodyText(html);
    if (!content || content.length < 100) return null;

    return {
      title,
      content,
      metadata: { extractor: 'wayback-machine', archive_url: snapshot.url },
    };
  } catch {
    return null;
  }
}

/**
 * Attempt extraction via Freedium (Medium paywall bypass).
 */
async function tryFreedium(url: string): Promise<HandlerResult | null> {
  try {
    const freediumUrl = `https://freedium.cfd/${url}`;
    const res = await fetch(freediumUrl, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'text/html' },
      redirect: 'follow',
    });

    if (!res.ok) return null;
    const ct = res.headers.get('content-type') || '';
    if (!ct.includes('text/html')) return null;

    const html = await res.text();
    const title = extractTitle(html);
    const content = extractBodyText(html);
    if (!content) return null;

    return {
      title,
      content,
      metadata: { extractor: 'freedium', freedium_url: freediumUrl },
    };
  } catch {
    return null;
  }
}

/**
 * Paywall bypass chain for web articles.
 *
 * Cascade (all free, zero cost):
 *  1. Google Webcache — cached version without paywall JS
 *  2. 12ft.io — paywall ladder, strips soft paywalls
 *  3. Archive.today — general-purpose cached article lookup
 *  4. Wayback Machine — Internet Archive snapshots
 *  5. Freedium — Medium-specific paywall bypass (only for Medium URLs)
 *
 * Called as a last resort from extractWebpage.
 * Sets `paywalled: true` when no strategy returns full content.
 */
export async function extractPaywalled(url: string, _env: Env): Promise<HandlerResult> {
  // 1. Google Webcache — fastest, most reliable for recent articles
  const googleResult = await tryGoogleCache(url);
  if (googleResult) return googleResult;

  // 2. 12ft.io — soft paywall bypass
  const twelveFtResult = await try12ft(url);
  if (twelveFtResult) return twelveFtResult;

  // 3. Archive.today
  const archiveResult = await tryArchiveToday(url);
  if (archiveResult) return archiveResult;

  // 4. Wayback Machine
  const waybackResult = await tryWaybackMachine(url);
  if (waybackResult) return waybackResult;

  // 5. Freedium (Medium only)
  if (isMediumUrl(url)) {
    const freediumResult = await tryFreedium(url);
    if (freediumResult) return freediumResult;
  }

  return {
    title: null,
    content: null,
    metadata: {},
    paywalled: true,
    error: 'All paywall bypass strategies exhausted (Google Cache, 12ft.io, Archive.today, Wayback Machine, Freedium)',
  };
}
