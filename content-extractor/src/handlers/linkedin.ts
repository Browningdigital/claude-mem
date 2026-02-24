import type { Env } from '../types';

interface HandlerResult {
  title: string | null;
  content: string | null;
  metadata: Record<string, unknown>;
  error?: string;
}

export async function extractLinkedin(url: string, env: Env): Promise<HandlerResult> {
  // Jina Reader — works on public company pages, job listings, some public posts
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        Authorization: `Bearer ${env.JINA_API_KEY}`,
        'X-Return-Format': 'markdown',
      },
    });

    if (res.ok) {
      const text = await res.text();
      if (text && text.length > 100) {
        const titleMatch = text.match(/^#\s+(.+)$/m);
        return {
          title: titleMatch?.[1] || 'LinkedIn Content',
          content: text,
          metadata: { extractor: 'jina' },
        };
      }
    }
  } catch {
    // Fall through
  }

  return {
    title: null,
    content: null,
    metadata: { partial: true },
    error: 'LinkedIn content is login-walled — could not extract. This is a known v1 limitation.',
  };
}
