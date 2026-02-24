import type { Env } from '../types';

interface HandlerResult {
  title: string | null;
  content: string | null;
  metadata: Record<string, unknown>;
  error?: string;
}

function extractThreadsPostId(url: string): string | null {
  // https://www.threads.net/@username/post/XXXXX
  const match = url.match(/threads\.net\/@([^/]+)\/post\/([a-zA-Z0-9_-]+)/);
  if (match) return match[2];
  return null;
}

export async function extractThreads(url: string, env: Env): Promise<HandlerResult> {
  // Primary: Meta Threads API
  if (env.META_THREADS_TOKEN) {
    try {
      // Search for the post using the URL
      const postId = extractThreadsPostId(url);
      if (postId) {
        const res = await fetch(
          `https://graph.threads.net/v1.0/${postId}?fields=id,text,username,timestamp,media_type,shortcode&access_token=${env.META_THREADS_TOKEN}`
        );
        if (res.ok) {
          const data = (await res.json()) as {
            id?: string;
            text?: string;
            username?: string;
            timestamp?: string;
            media_type?: string;
          };
          if (data.text) {
            return {
              title: `@${data.username}: Thread Post`,
              content: data.text,
              metadata: {
                extractor: 'meta-threads-api',
                username: data.username,
                timestamp: data.timestamp,
                mediaType: data.media_type,
              },
            };
          }
        }
      }
    } catch {
      // Fall through to Jina
    }
  }

  // Fallback: Jina Reader
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        Authorization: `Bearer ${env.JINA_API_KEY}`,
        'X-Return-Format': 'markdown',
      },
    });
    if (res.ok) {
      const text = await res.text();
      if (text && text.length > 50) {
        return {
          title: 'Threads Post',
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
    metadata: {},
    error: 'Threads extraction failed — Meta API and Jina both returned no content',
  };
}
