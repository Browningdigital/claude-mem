import type { Env } from '../types';
import { parseHTML } from 'linkedom';

interface HandlerResult {
  title: string | null;
  content: string | null;
  metadata: Record<string, unknown>;
  error?: string;
}

export async function extractThreads(url: string, env: Env): Promise<HandlerResult> {
  // Primary: Jina Reader (most reliable for JS-rendered social content)
  try {
    const headers: Record<string, string> = { 'X-Return-Format': 'markdown' };
    if (env.JINA_API_KEY) headers['Authorization'] = `Bearer ${env.JINA_API_KEY}`;
    const res = await fetch(`https://r.jina.ai/${url}`, { headers });
    if (res.ok) {
      const text = await res.text();
      // Jina sometimes returns login pages — check for actual content
      if (text && text.length > 50 && !text.includes('Log in') && !text.includes('Join Threads')) {
        return {
          title: 'Threads Post',
          content: text,
          metadata: { extractor: 'jina' },
        };
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

      // Filter out login page descriptions
      if (ogDesc && ogDesc.length > 20 && !ogDesc.startsWith('Join Threads') && !ogDesc.startsWith('Log in')) {
        return {
          title: ogTitle || 'Threads Post',
          content: ogDesc,
          metadata: { extractor: 'threads-og-meta' },
        };
      }

      // Try __NEXT_DATA__ or other script blocks
      const scripts = document.querySelectorAll('script');
      for (const script of scripts) {
        const text = script.textContent || '';
        if (text.includes('"text"') && text.includes('threads')) {
          try {
            const json = JSON.parse(text);
            const postText = findNestedText(json);
            if (postText) {
              return {
                title: ogTitle || 'Threads Post',
                content: postText,
                metadata: { extractor: 'threads-script-json' },
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
