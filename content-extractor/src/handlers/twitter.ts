import type { Env } from '../types';

interface HandlerResult {
  title: string | null;
  content: string | null;
  metadata: Record<string, unknown>;
  error?: string;
}

interface VxTweetData {
  text?: string;
  user_name?: string;
  user_screen_name?: string;
  date?: string;
  likes?: number;
  retweets?: number;
  replies?: number;
  mediaURLs?: string[];
  media_urls?: string[];
  qrt?: { text?: string; user_screen_name?: string };
}

function parseTweetUrl(url: string): { username: string; tweetId: string } | null {
  const match = url.match(/(?:twitter\.com|x\.com)\/([^/]+)\/status\/(\d+)/);
  if (!match) return null;
  return { username: match[1], tweetId: match[2] };
}

function formatTweetContent(data: VxTweetData): { content: string; metadata: Record<string, unknown> } {
  let content = data.text || '';

  if (data.qrt?.text) {
    content += `\n\n> Quoted @${data.qrt.user_screen_name}:\n> ${data.qrt.text}`;
  }

  const mediaUrls = data.mediaURLs || data.media_urls || [];
  if (mediaUrls.length > 0) {
    content += `\n\n[Media: ${mediaUrls.join(', ')}]`;
  }

  return {
    content,
    metadata: {
      author: data.user_name,
      handle: data.user_screen_name,
      date: data.date,
      likes: data.likes,
      retweets: data.retweets,
      replies: data.replies,
      mediaCount: mediaUrls.length,
    },
  };
}

export async function extractTwitter(url: string, env: Env): Promise<HandlerResult> {
  const parsed = parseTweetUrl(url);
  if (!parsed) {
    return { title: null, content: null, metadata: {}, error: 'Could not parse tweet URL' };
  }

  // Primary: vxTwitter API (no auth, free, fast)
  try {
    const res = await fetch(`https://api.vxtwitter.com/${parsed.username}/status/${parsed.tweetId}`);
    if (res.ok) {
      const ct = res.headers.get('content-type') || '';
      if (ct.includes('application/json')) {
        const data = (await res.json()) as VxTweetData;
        if (data.text) {
          const { content, metadata } = formatTweetContent(data);
          return {
            title: `@${data.user_screen_name}: Tweet`,
            content,
            metadata: { ...metadata, extractor: 'vxtwitter' },
          };
        }
      }
    }
  } catch {
    // Fall through to fxtwitter
  }

  // Fallback 1: fxtwitter API (same data, different host)
  try {
    const res = await fetch(`https://api.fxtwitter.com/${parsed.username}/status/${parsed.tweetId}`);
    if (res.ok) {
      const wrapper = (await res.json()) as { tweet?: VxTweetData };
      const data = wrapper.tweet;
      if (data?.text) {
        const { content, metadata } = formatTweetContent(data);
        return {
          title: `@${data.user_screen_name}: Tweet`,
          content,
          metadata: { ...metadata, extractor: 'fxtwitter' },
        };
      }
    }
  } catch {
    // Fall through to Jina
  }

  // Fallback 2: Jina Reader
  try {
    const headers: Record<string, string> = { 'X-Return-Format': 'markdown' };
    if (env.JINA_API_KEY) headers['Authorization'] = `Bearer ${env.JINA_API_KEY}`;
    const res = await fetch(`https://r.jina.ai/${url}`, { headers });
    if (res.ok) {
      const text = await res.text();
      if (text && text.length > 50) {
        return {
          title: `@${parsed.username}: Tweet`,
          content: text,
          metadata: { extractor: 'jina', handle: parsed.username, tweetId: parsed.tweetId },
        };
      }
    }
  } catch {
    // Final fallback failed
  }

  return { title: null, content: null, metadata: { tweetId: parsed.tweetId }, error: 'All Twitter extraction methods failed (vxTwitter, fxTwitter, Jina)' };
}
