import type { Env } from '../types';

interface HandlerResult {
  title: string | null;
  content: string | null;
  metadata: Record<string, unknown>;
  error?: string;
}

export async function extractTiktok(url: string, _env: Env): Promise<HandlerResult> {
  // TikTok oEmbed API — returns title (video description) + author
  try {
    const res = await fetch(`https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`);
    if (res.ok) {
      const data = (await res.json()) as {
        title?: string;
        author_name?: string;
        author_url?: string;
        thumbnail_url?: string;
      };

      const content = data.title || 'No description available';

      return {
        title: `TikTok by ${data.author_name || 'Unknown'}`,
        content: `${content}\n\n[Note: Full audio transcription unavailable in v1 — TikTok audio extraction requires yt-dlp which cannot run in a Worker]`,
        metadata: {
          extractor: 'tiktok-oembed',
          author: data.author_name,
          authorUrl: data.author_url,
          partial: true,
        },
      };
    }
  } catch {
    // Fall through
  }

  return {
    title: null,
    content: null,
    metadata: {},
    error: 'TikTok oEmbed API failed',
  };
}
