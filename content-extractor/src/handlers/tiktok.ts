import type { Env } from '../types';

interface HandlerResult {
  title: string | null;
  content: string | null;
  metadata: Record<string, unknown>;
  error?: string;
}

export async function extractTiktok(url: string, env: Env): Promise<HandlerResult> {
  // Primary: TikTok oEmbed API — returns title (video description) + author
  try {
    const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    });
    if (res.ok) {
      const data = (await res.json()) as {
        title?: string;
        author_name?: string;
        author_url?: string;
        thumbnail_url?: string;
      };

      if (data.title) {
        return {
          title: `TikTok by ${data.author_name || 'Unknown'}`,
          content: `${data.title}\n\n[Note: Full audio transcription unavailable in v1 — TikTok audio extraction requires yt-dlp which cannot run in a Worker]`,
          metadata: {
            extractor: 'tiktok-oembed',
            author: data.author_name,
            authorUrl: data.author_url,
            partial: true,
          },
        };
      }
    }
  } catch {
    // Fall through to Jina
  }

  // Fallback: Jina Reader
  try {
    const headers: Record<string, string> = { 'X-Return-Format': 'markdown' };
    if (env.JINA_API_KEY) headers['Authorization'] = `Bearer ${env.JINA_API_KEY}`;
    const res = await fetch(`https://r.jina.ai/${url}`, { headers });
    if (res.ok) {
      const text = await res.text();
      if (text && text.length > 50) {
        return {
          title: 'TikTok Video',
          content: text,
          metadata: { extractor: 'jina', partial: true },
        };
      }
    }
  } catch {
    // Fall through
  }

  return {
    title: null,
    content: null,
    metadata: {},
    error: 'TikTok extraction failed — oEmbed and Jina both unavailable',
  };
}
