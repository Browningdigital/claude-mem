import type { Env } from '../types';
import { parseHTML } from 'linkedom';

interface HandlerResult {
  title: string | null;
  content: string | null;
  metadata: Record<string, unknown>;
  error?: string;
}

/** Strip Threads page chrome: navigation, login prompts, footers, empty links */
function cleanThreadsContent(raw: string): string {
  return raw
    // Remove empty markdown links (navigation icons)
    .replace(/\[]\([^)]*\)\s*/g, '')
    // Remove image links with CDN URLs (profile pics, thumbnails)
    .replace(/\[!\[Image[^\]]*\]\([^)]*\)\]\([^)]*\)\s*/g, '')
    .replace(/!\[Image[^\]]*\]\([^)]*\)\s*/g, '')
    // Remove login/signup prompts
    .replace(/Log in or sign up for Threads[^\n]*/gi, '')
    .replace(/See what people are talking about[^\n]*/gi, '')
    .replace(/\[Log in[^\]]*\]\([^)]*\)\s*/gi, '')
    .replace(/\[Sign up[^\]]*\]\([^)]*\)\s*/gi, '')
    // Remove footer: terms, privacy, cookies
    .replace(/\*\s+©[^\n]*/g, '')
    .replace(/\*\s+\[Threads Terms\][^\n]*/g, '')
    .replace(/\*\s+\[Privacy Policy\][^\n]*/g, '')
    .replace(/\*\s+\[Cookies Policy\][^\n]*/g, '')
    .replace(/\*\s+Report a problem[^\n]*/g, '')
    // Remove "Thread === X views" navigation artifacts
    .replace(/\[Thread\s*={2,}[^\]]*\]\([^)]*\)\s*/g, '')
    // Remove standalone navigation links to threads.com base
    .replace(/\[]\(https:\/\/www\.threads\.com\/?\)\s*/g, '')
    .replace(/\[]\(https:\/\/www\.threads\.com\/search\)\s*/g, '')
    // Remove lines that are just separator bars
    .replace(/^={3,}\s*$/gm, '')
    // Remove lines that are just numbers (engagement counts without labels)
    .replace(/^\d{1,3}\s*$/gm, '')
    // Collapse excessive blank lines
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Parse author handle from Threads URL */
function parseThreadsUrl(url: string): { author: string | null } {
  try {
    const match = new URL(url).pathname.match(/@([^/]+)/);
    return { author: match ? match[1] : null };
  } catch {
    return { author: null };
  }
}

/** Parse engagement numbers from raw Threads page text */
function parseEngagement(text: string): Record<string, number | null> {
  // Threads shows: replies reposts quotes likes (as bare numbers in sequence)
  // Look for a pattern of 3-5 numbers on the same or adjacent lines near the post
  const numbers = text.match(/\b(\d{1,3}(?:,\d{3})*(?:\.\d+)?[KkMm]?)\b/g);
  // This is fragile — only use if we can confidently identify the pattern
  return { replies: null, reposts: null, quotes: null, likes: null };
}

export async function extractThreads(url: string, env: Env): Promise<HandlerResult> {
  const { author } = parseThreadsUrl(url);

  // Primary: Jina Reader with content cleaning
  try {
    const headers: Record<string, string> = { 'X-Return-Format': 'markdown' };
    if (env.JINA_API_KEY) headers['Authorization'] = `Bearer ${env.JINA_API_KEY}`;
    const res = await fetch(`https://r.jina.ai/${url}`, { headers });
    if (res.ok) {
      const rawText = await res.text();
      if (rawText && rawText.length > 50) {
        const cleaned = cleanThreadsContent(rawText);
        // After cleaning, check if we have real content (not just login page remnants)
        if (cleaned.length > 30 && !cleaned.toLowerCase().includes('log in') && !cleaned.toLowerCase().includes('join threads')) {
          return {
            title: author ? `@${author} on Threads` : null,
            content: cleaned,
            metadata: {
              extractor: 'jina-cleaned',
              author: author || undefined,
            },
          };
        }
      }
    }
  } catch {
    // Fall through to HTML scrape
  }

  // Fallback: Fetch HTML and parse embedded data (og:meta, script tags)
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        Accept: 'text/html',
      },
      redirect: 'follow',
    });

    if (res.ok) {
      const html = await res.text();
      const { document } = parseHTML(html);

      const ogDesc = document.querySelector('meta[property="og:description"]')?.getAttribute('content');
      const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
      const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute('content');

      // Filter out login page descriptions
      if (ogDesc && ogDesc.length > 20 && !ogDesc.startsWith('Join Threads') && !ogDesc.startsWith('Log in')) {
        const metadata: Record<string, unknown> = {
          extractor: 'threads-og-meta',
          author: author || undefined,
        };
        if (ogImage) metadata.image = ogImage;

        return {
          title: ogTitle && !ogTitle.toLowerCase().includes('log in')
            ? ogTitle
            : (author ? `@${author} on Threads` : null),
          content: ogDesc,
          metadata,
        };
      }

      // Try __NEXT_DATA__ or other script blocks for full post text
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        const text = script.textContent || '';
        if (text.includes('"text"') && text.includes('threads')) {
          try {
            const json = JSON.parse(text);
            const postText = findNestedText(json);
            if (postText) {
              return {
                title: ogTitle || (author ? `@${author} on Threads` : null),
                content: postText,
                metadata: {
                  extractor: 'threads-script-json',
                  author: author || undefined,
                },
              };
            }
          } catch {
            // Not valid JSON, skip
          }
        }
      }
    }
  } catch {
    // Fall through
  }

  return {
    title: null,
    content: null,
    metadata: {},
    error: 'Threads extraction failed — content may require JavaScript rendering. Try pasting the post text directly.',
  };
}

function findNestedText(obj: unknown, depth = 0): string | null {
  if (depth > 10 || !obj || typeof obj !== 'object') return null;
  if (Array.isArray(obj)) {
    for (const item of obj) {
      const found = findNestedText(item, depth + 1);
      if (found) return found;
    }
    return null;
  }
  const record = obj as Record<string, unknown>;
  if (typeof record['text'] === 'string' && (record['text'] as string).length > 10) {
    return record['text'] as string;
  }
  for (const value of Object.values(record)) {
    const found = findNestedText(value, depth + 1);
    if (found) return found;
  }
  return null;
}
