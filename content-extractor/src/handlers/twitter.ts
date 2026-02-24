import type { Env } from '../types';

interface HandlerResult {
  title: string | null;
  content: string | null;
  metadata: Record<string, unknown>;
  error?: string;
}

function parseTweetUrl(url: string): { username: string; tweetId: string } | null {
  const match = url.match(/(?:twitter\.com|x\.com)\/([^/]+)\/status\/(\d+)/);
  if (!match) return null;
  return { username: match[1], tweetId: match[2] };
}

export async function extractTwitter(url: string, _env: Env): Promise<HandlerResult> {
  const parsed = parseTweetUrl(url);
  if (!parsed) {
    return { title: null, content: null, metadata: {}, error: 'Could not parse tweet URL' };
  }

  try {
    const res = await fetch(`https://api.vxtwitter.com/${parsed.username}/status/${parsed.tweetId}`);
    if (!res.ok) {
      return { title: null, content: null, metadata: {}, error: `vxTwitter API returned ${res.status}` };
    }

    const data = (await res.json()) as {
      text?: string;
      user_name?: string;
      user_screen_name?: string;
      date?: string;
      likes?: number;
      retweets?: number;
      replies?: number;
      media_urls?: string[];
      qrt?: { text?: string; user_screen_name?: string };
    };

    let content = data.text || '';

    // Include quoted tweet if present
    if (data.qrt?.text) {
      content += `\n\n> Quoted @${data.qrt.user_screen_name}:\n> ${data.qrt.text}`;
    }

    // Note media URLs if present
    if (data.media_urls && data.media_urls.length > 0) {
      content += `\n\n[Media: ${data.media_urls.join(', ')}]`;
    }

    return {
      title: `@${data.user_screen_name}: Tweet`,
      content,
      metadata: {
        extractor: 'vxtwitter',
        author: data.user_name,
        handle: data.user_screen_name,
        date: data.date,
        likes: data.likes,
        retweets: data.retweets,
        replies: data.replies,
        mediaCount: data.media_urls?.length || 0,
      },
    };
  } catch (e) {
    return { title: null, content: null, metadata: {}, error: `Twitter extraction failed: ${(e as Error).message}` };
  }
}
