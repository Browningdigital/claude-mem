import type { Env } from '../types';

interface HandlerResult {
  title: string | null;
  content: string | null;
  metadata: Record<string, unknown>;
  error?: string;
}

interface RedditPostData {
  title?: string;
  selftext?: string;
  author?: string;
  subreddit?: string;
  score?: number;
  upvote_ratio?: number;
  num_comments?: number;
  created_utc?: number;
  permalink?: string;
  url?: string;
  is_video?: boolean;
  media?: { reddit_video?: { fallback_url?: string } };
  post_hint?: string;
  link_flair_text?: string;
  over_18?: boolean;
}

interface RedditCommentData {
  body?: string;
  author?: string;
  score?: number;
  created_utc?: number;
  replies?: { data?: { children?: RedditCommentChild[] } };
}

interface RedditCommentChild {
  kind: string;
  data: RedditCommentData;
}

function parseRedditUrl(url: string): { path: string; isComment: boolean } | null {
  try {
    const u = new URL(url);
    let path = u.pathname;
    // Normalize: strip trailing slash
    if (path.endsWith('/')) path = path.slice(0, -1);
    const isComment = /\/comments\/[a-z0-9]+/.test(path);
    return { path, isComment };
  } catch {
    return null;
  }
}

function formatComments(children: RedditCommentChild[], depth = 0, maxDepth = 3): string {
  if (depth > maxDepth) return '';
  const lines: string[] = [];

  for (const child of children) {
    if (child.kind !== 't1' || !child.data.body) continue;
    // Skip deleted/removed
    if (child.data.body === '[deleted]' || child.data.body === '[removed]') continue;

    const indent = '  '.repeat(depth);
    const score = child.data.score != null ? ` (${child.data.score} pts)` : '';
    lines.push(`${indent}**u/${child.data.author}**${score}:`);
    // Indent comment body
    const bodyLines = child.data.body.split('\n').map((l) => `${indent}${l}`);
    lines.push(...bodyLines);
    lines.push('');

    // Recurse into replies
    if (child.data.replies?.data?.children) {
      const nested = formatComments(child.data.replies.data.children, depth + 1, maxDepth);
      if (nested) lines.push(nested);
    }
  }

  return lines.join('\n');
}

export async function extractReddit(url: string, env: Env): Promise<HandlerResult> {
  const parsed = parseRedditUrl(url);
  if (!parsed) {
    return { title: null, content: null, metadata: {}, error: 'Could not parse Reddit URL' };
  }

  // Primary: Reddit JSON API (free, no auth, no rate limit issues for single requests)
  // old.reddit.com is more reliable for JSON responses
  try {
    const jsonUrl = `https://old.reddit.com${parsed.path}.json`;
    const res = await fetch(jsonUrl, {
      headers: {
        'User-Agent': 'ContentExtractor/2.0 (knowledge-capture tool)',
        Accept: 'application/json',
      },
    });

    if (res.ok) {
      const data = await res.json() as unknown;

      // Reddit returns an array: [post_listing, comments_listing]
      if (Array.isArray(data) && data.length >= 1) {
        const postListing = data[0];
        const postChild = postListing?.data?.children?.[0];
        if (postChild?.kind === 't3' && postChild.data) {
          const post = postChild.data as RedditPostData;
          const parts: string[] = [];

          // Post body
          if (post.selftext && post.selftext.length > 0) {
            parts.push(post.selftext);
          } else if (post.url && post.url !== `https://www.reddit.com${post.permalink}`) {
            // Link post — include the linked URL
            parts.push(`**Linked:** ${post.url}`);
          }

          // Media info
          if (post.is_video && post.media?.reddit_video?.fallback_url) {
            parts.push(`\n**Video:** ${post.media.reddit_video.fallback_url}`);
          }
          if (post.post_hint === 'image' && post.url) {
            parts.push(`\n**Image:** ${post.url}`);
          }

          // Comments (if this is a comments page)
          if (parsed.isComment && Array.isArray(data) && data.length >= 2) {
            const commentListing = data[1];
            const commentChildren = commentListing?.data?.children as RedditCommentChild[] | undefined;
            if (commentChildren && commentChildren.length > 0) {
              const commentsText = formatComments(commentChildren);
              if (commentsText) {
                parts.push(`\n---\n\n## Comments\n\n${commentsText}`);
              }
            }
          }

          const content = parts.join('\n\n') || post.title || 'No content';

          return {
            title: post.title || null,
            content,
            metadata: {
              extractor: 'reddit-json',
              author: post.author,
              subreddit: post.subreddit,
              score: post.score,
              upvote_ratio: post.upvote_ratio,
              num_comments: post.num_comments,
              flair: post.link_flair_text || null,
              nsfw: post.over_18 || false,
              created: post.created_utc ? new Date(post.created_utc * 1000).toISOString() : null,
            },
          };
        }
      }

      // Subreddit listing (not a single post)
      if (Array.isArray((data as any)?.data?.children)) {
        const listing = (data as any).data;
        const posts = listing.children
          .filter((c: any) => c.kind === 't3')
          .slice(0, 25)
          .map((c: any) => {
            const p = c.data as RedditPostData;
            const score = p.score != null ? ` [${p.score} pts]` : '';
            return `- **${p.title}**${score} — u/${p.author}\n  ${p.selftext ? p.selftext.slice(0, 200) + (p.selftext.length > 200 ? '...' : '') : `(${p.post_hint || 'link'}: ${p.url})`}`;
          });

        return {
          title: `r/${listing.children[0]?.data?.subreddit || 'reddit'} — Top Posts`,
          content: posts.join('\n\n'),
          metadata: {
            extractor: 'reddit-json',
            subreddit: listing.children[0]?.data?.subreddit,
            post_count: posts.length,
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
    // Final fallback failed
  }

  return {
    title: null,
    content: null,
    metadata: {},
    error: 'All Reddit extraction methods failed (JSON API, Jina)',
  };
}
