import type { Env } from '../types';
import { extractWebpage } from './webpage';

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
 * Extract article body text from HTML. Prefers <article> content,
 * falls back to <body> content.
 */
function extractBodyText(html: string): string | null {
  // Try <article> first
  const articleMatch = html.match(/<article[\s\S]*?>([\s\S]*?)<\/article>/i);
  if (articleMatch) {
    const text = stripHtml(articleMatch[1]);
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
 * Attempt extraction via Archive.today.
 * Returns null if the archive is unavailable or content is too short.
 */
async function tryArchiveToday(url: string): Promise<HandlerResult | null> {
  try {
    const archiveUrl = `https://archive.ph/${url}`;
    const res = await fetch(archiveUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html',
      },
      redirect: 'follow',
    });

    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return null;

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
 * Attempt extraction via Freedium (Medium paywall bypass).
 * Returns null if the request fails or content is too short.
 */
async function tryFreedium(url: string): Promise<HandlerResult | null> {
  try {
    const freediumUrl = `https://freedium.cfd/${url}`;
    const res = await fetch(freediumUrl, {
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html',
      },
      redirect: 'follow',
    });

    if (!res.ok) return null;

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('text/html')) return null;

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
 * Cascade:
 *  1. Archive.today — general-purpose cached article lookup
 *  2. Freedium — Medium-specific paywall bypass (only tried for Medium URLs)
 *  3. Jina Reader — fall back to the existing webpage handler
 *
 * Sets `paywalled: true` when no strategy returns full content.
 */
export async function extractPaywalled(url: string, env: Env): Promise<HandlerResult> {
  // 1. Archive.today
  const archiveResult = await tryArchiveToday(url);
  if (archiveResult) return archiveResult;

  // 2. Freedium (Medium only)
  if (isMediumUrl(url)) {
    const freediumResult = await tryFreedium(url);
    if (freediumResult) return freediumResult;
  }

  // 3. Fall back to existing webpage handler (Jina Reader / Diffbot)
  const webpageResult = await extractWebpage(url, env);

  // If the fallback also failed to get content, flag as paywalled
  if (!webpageResult.content) {
    return {
      ...webpageResult,
      paywalled: true,
      error: webpageResult.error || 'All paywall bypass strategies failed',
    };
  }

  return webpageResult;
}
