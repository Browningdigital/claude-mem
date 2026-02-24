import type { Env } from '../types';
import { Readability } from '@mozilla/readability';
import { parseHTML } from 'linkedom';

interface HandlerResult {
  title: string | null;
  content: string | null;
  metadata: Record<string, unknown>;
  error?: string;
  paywalled?: boolean;
}

function jinaHeaders(env: Env): Record<string, string> {
  const headers: Record<string, string> = { 'X-Return-Format': 'markdown' };
  if (env.JINA_API_KEY) headers['Authorization'] = `Bearer ${env.JINA_API_KEY}`;
  return headers;
}

export async function extractWebpage(url: string, env: Env): Promise<HandlerResult> {
  // Primary: Jina Reader (free, ~20 RPM without key, 100 RPM with free key)
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, { headers: jinaHeaders(env) });
    if (res.ok) {
      const text = await res.text();
      if (text && text.length > 100) {
        const titleMatch = text.match(/^#\s+(.+)$/m);
        return {
          title: titleMatch?.[1] || null,
          content: text,
          metadata: { extractor: 'jina' },
        };
      }
    }
  } catch {
    // Fall through to in-Worker Readability
  }

  // Fallback: linkedom + @mozilla/readability (runs entirely in-Worker, zero external calls)
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ContentExtractor/1.0)',
        Accept: 'text/html',
      },
      redirect: 'follow',
    });
    if (res.ok) {
      const html = await res.text();
      const { document } = parseHTML(html);
      const reader = new Readability(document as any);
      const article = reader.parse();
      if (article?.textContent && article.textContent.length > 100) {
        return {
          title: article.title || null,
          content: article.textContent,
          metadata: { extractor: 'readability', length: article.length },
        };
      }
    }
  } catch {
    // Fall through to paywall bypass
  }

  // Fallback: Paywall bypass chain (Archive.today → Freedium)
  try {
    const { extractPaywalled } = await import('./paywall');
    return await extractPaywalled(url, env);
  } catch {
    // Final fallback
  }

  return {
    title: null,
    content: null,
    metadata: {},
    error: 'All extraction methods failed (Jina, Readability, paywall bypass)',
    paywalled: true,
  };
}
