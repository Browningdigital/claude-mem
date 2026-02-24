import type { Env } from '../types';

interface HandlerResult {
  title: string | null;
  content: string | null;
  metadata: Record<string, unknown>;
  error?: string;
  paywalled?: boolean;
}

export async function extractWebpage(url: string, env: Env): Promise<HandlerResult> {
  // Primary: Jina Reader
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        Authorization: `Bearer ${env.JINA_API_KEY}`,
        'X-Return-Format': 'markdown',
      },
    });

    if (res.ok) {
      const text = await res.text();
      // Jina returns markdown directly
      const titleMatch = text.match(/^#\s+(.+)$/m);
      return {
        title: titleMatch?.[1] || null,
        content: text,
        metadata: { extractor: 'jina', status: res.status },
      };
    }
  } catch {
    // Fall through to Diffbot
  }

  // Fallback: Diffbot
  try {
    const res = await fetch(
      `https://api.diffbot.com/v3/analyze?token=${env.DIFFBOT_TOKEN}&url=${encodeURIComponent(url)}`
    );

    if (res.ok) {
      const data = (await res.json()) as {
        objects?: Array<{ title?: string; text?: string; type?: string }>;
      };
      const obj = data.objects?.[0];
      return {
        title: obj?.title || null,
        content: obj?.text || null,
        metadata: { extractor: 'diffbot', type: obj?.type },
      };
    }
  } catch {
    // Fall through to error
  }

  // Fallback: Paywall bypass chain (Archive.today → Freedium → retry Jina)
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
    error: 'All extraction methods failed (Jina, Diffbot, paywall bypass)',
    paywalled: true,
  };
}
