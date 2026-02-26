/**
 * SocialMediaExtractor — Platform-specific content extraction for walled-garden sites.
 *
 * Free services can rip Instagram reels and Facebook posts — so can we.
 * This module detects social media URLs and uses the best free extraction method
 * for each platform (oEmbed APIs, embed pages, alternative frontends, JSON APIs).
 *
 * Supported platforms:
 * - Twitter/X    → fxtwitter API + oEmbed (both free, no auth)
 * - YouTube      → oEmbed (free, no auth)
 * - TikTok       → oEmbed (free, no auth)
 * - Reddit       → JSON API (free, append .json)
 * - Instagram    → embed page scraping + ddinstagram alternative frontend
 * - Facebook     → embed plugin page + mobile og:tags
 * - Threads      → embed page scraping
 * - LinkedIn     → og:meta tag extraction
 *
 * Falls back to null when all methods fail — caller should then try Jina/content-extractor.
 */

import { logger } from '../../utils/logger.js';

// ============================================================================
// Types
// ============================================================================

export type SocialPlatform =
  | 'instagram'
  | 'facebook'
  | 'twitter'
  | 'tiktok'
  | 'youtube'
  | 'reddit'
  | 'linkedin'
  | 'threads';

export interface SocialExtractionResult {
  title: string;
  content: string;
  content_type: string;
  platform: SocialPlatform;
  metadata: {
    author?: string;
    author_url?: string;
    thumbnail_url?: string;
    embed_html?: string;
    original_url: string;
    extraction_method: string;
    platform: string;
    [key: string]: any;
  };
}

// ============================================================================
// Platform Detection
// ============================================================================

const PLATFORM_PATTERNS: { platform: SocialPlatform; patterns: RegExp[] }[] = [
  {
    platform: 'instagram',
    patterns: [
      /(?:www\.)?instagram\.com\/(p|reel|reels|tv|stories)\//i,
      /(?:www\.)?instagram\.com\/[\w.]+\/?$/i,
      /(?:www\.)?instagr\.am\//i,
    ]
  },
  {
    platform: 'facebook',
    patterns: [
      /(?:www\.|m\.|web\.)?facebook\.com\//i,
      /(?:www\.)?fb\.com\//i,
      /(?:www\.)?fb\.watch\//i,
    ]
  },
  {
    platform: 'twitter',
    patterns: [
      /(?:www\.)?(?:twitter|x)\.com\/\w+\/status\//i,
      /(?:www\.)?(?:twitter|x)\.com\/\w+\/?$/i,
    ]
  },
  {
    platform: 'tiktok',
    patterns: [
      /(?:www\.)?tiktok\.com\/@[\w.]+\/video\//i,
      /(?:www\.)?tiktok\.com\/t\//i,
      /(?:vm\.)?tiktok\.com\//i,
    ]
  },
  {
    platform: 'youtube',
    patterns: [
      /(?:www\.)?youtube\.com\/watch/i,
      /(?:www\.)?youtube\.com\/shorts\//i,
      /(?:www\.)?youtube\.com\/live\//i,
      /youtu\.be\//i,
    ]
  },
  {
    platform: 'reddit',
    patterns: [
      /(?:www\.|old\.|new\.)?reddit\.com\/r\//i,
      /redd\.it\//i,
    ]
  },
  {
    platform: 'linkedin',
    patterns: [
      /(?:www\.)?linkedin\.com\/(?:posts|feed|pulse)\//i,
    ]
  },
  {
    platform: 'threads',
    patterns: [
      /(?:www\.)?threads\.net\//i,
    ]
  },
];

/**
 * Detect the social media platform from a URL.
 * Returns null for non-social URLs.
 */
export function detectPlatform(url: string): SocialPlatform | null {
  for (const { platform, patterns } of PLATFORM_PATTERNS) {
    for (const pattern of patterns) {
      if (pattern.test(url)) return platform;
    }
  }
  return null;
}

// ============================================================================
// Helpers
// ============================================================================

/** Decode unicode escapes like \u00e9 in JSON strings */
function decodeUnicodeEscapes(str: string): string {
  return str.replace(/\\u([\dA-Fa-f]{4})/g, (_m, hex) =>
    String.fromCharCode(parseInt(hex, 16))
  );
}

/** Strip HTML tags to get plain text */
function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

/** Decode HTML entities like &amp; &#39; &quot; etc. */
function decodeHtmlEntities(str: string): string {
  return str
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#x27;/g, "'")
    .replace(/&#(\d+);/g, (_m, code) => String.fromCharCode(parseInt(code, 10)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_m, hex) => String.fromCharCode(parseInt(hex, 16)));
}

/**
 * Resolve short/redirect URLs (fb.watch, redd.it, etc.) to their full destination.
 * Follows redirects via HEAD request and returns the final URL.
 */
async function resolveShortUrl(url: string): Promise<string> {
  try {
    const res = await safeFetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
    }, 10000);
    if (res?.url && res.url !== url) {
      return res.url;
    }
  } catch {
    // If HEAD fails, try GET
    try {
      const res = await safeFetch(url, {
        redirect: 'follow',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        },
      }, 10000);
      if (res?.url && res.url !== url) {
        return res.url;
      }
    } catch {
      // Fall through
    }
  }
  return url;
}

/** Safely fetch with timeout */
async function safeFetch(url: string, init?: RequestInit, timeoutMs = 15000): Promise<Response | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...init, signal: controller.signal });
    return res;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// ============================================================================
// Platform-Specific Extractors
// ============================================================================

/**
 * Twitter/X — fxtwitter API (rich JSON) + oEmbed (free, no auth).
 */
async function extractTwitter(url: string): Promise<SocialExtractionResult | null> {
  const normalizedUrl = url.replace(/(?:www\.)?x\.com/, 'twitter.com');

  // Method 1: fxtwitter API — richest data
  const statusMatch = url.match(/(?:twitter|x)\.com\/(\w+)\/status\/(\d+)/i);
  if (statusMatch) {
    const [, username, statusId] = statusMatch;
    try {
      const res = await safeFetch(
        `https://api.fxtwitter.com/${username}/status/${statusId}`,
        { headers: { 'User-Agent': 'BrowningDigital-ContentPipeline/1.0' } }
      );
      if (res?.ok) {
        const data = await res.json() as any;
        const tweet = data.tweet;
        if (tweet) {
          const mediaInfo = tweet.media?.all?.map((m: any) =>
            m.type === 'video' ? `[Video: ${m.url}]` : `[Image: ${m.url}]`
          ).join('\n') || '';

          return {
            title: `${tweet.author?.name || username} on X`,
            content: `${tweet.text || ''}${mediaInfo ? '\n\n' + mediaInfo : ''}`,
            content_type: tweet.media?.videos?.length ? 'social_video' : 'social_post',
            platform: 'twitter',
            metadata: {
              author: tweet.author?.name || username,
              author_url: `https://twitter.com/${username}`,
              thumbnail_url: tweet.media?.all?.[0]?.thumbnail_url,
              original_url: url,
              extraction_method: 'fxtwitter_api',
              platform: 'twitter',
              likes: tweet.likes,
              retweets: tweet.retweets,
              replies: tweet.replies,
              created_at: tweet.created_at,
            }
          };
        }
      }
    } catch (e) {
      logger.debug('CONTENT', 'fxtwitter API failed, trying oEmbed', {}, e as Error);
    }
  }

  // Method 2: Twitter oEmbed — always works for public tweets
  try {
    const res = await safeFetch(
      `https://publish.twitter.com/oembed?url=${encodeURIComponent(normalizedUrl)}&omit_script=true`
    );
    if (res?.ok) {
      const data = await res.json() as any;
      const textContent = stripHtml(data.html || '');
      return {
        title: `${data.author_name || 'Tweet'} on X`,
        content: textContent,
        content_type: 'social_post',
        platform: 'twitter',
        metadata: {
          author: data.author_name,
          author_url: data.author_url,
          original_url: url,
          extraction_method: 'twitter_oembed',
          platform: 'twitter',
        }
      };
    }
  } catch (e) {
    logger.debug('CONTENT', 'Twitter oEmbed failed', {}, e as Error);
  }

  return null;
}

/**
 * YouTube — oEmbed (free, no auth needed).
 */
async function extractYouTube(url: string): Promise<SocialExtractionResult | null> {
  try {
    const res = await safeFetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`
    );
    if (res?.ok) {
      const data = await res.json() as any;
      return {
        title: data.title || 'YouTube Video',
        content: `${data.title}\n\nBy: ${data.author_name}\n\nURL: ${url}`,
        content_type: 'social_video',
        platform: 'youtube',
        metadata: {
          author: data.author_name,
          author_url: data.author_url,
          thumbnail_url: data.thumbnail_url,
          embed_html: data.html,
          original_url: url,
          extraction_method: 'youtube_oembed',
          platform: 'youtube',
          width: data.width,
          height: data.height,
        }
      };
    }
  } catch (e) {
    logger.debug('CONTENT', 'YouTube oEmbed failed', {}, e as Error);
  }

  // Fallback: noembed
  try {
    const res = await safeFetch(
      `https://noembed.com/embed?url=${encodeURIComponent(url)}`
    );
    if (res?.ok) {
      const data = await res.json() as any;
      if (!data.error) {
        return {
          title: data.title || 'YouTube Video',
          content: `${data.title}\n\nBy: ${data.author_name}\n\nURL: ${url}`,
          content_type: 'social_video',
          platform: 'youtube',
          metadata: {
            author: data.author_name,
            author_url: data.author_url,
            thumbnail_url: data.thumbnail_url,
            original_url: url,
            extraction_method: 'noembed',
            platform: 'youtube',
          }
        };
      }
    }
  } catch (e) {
    logger.debug('CONTENT', 'noembed fallback failed', {}, e as Error);
  }

  return null;
}

/**
 * TikTok — oEmbed (free, no auth needed).
 */
async function extractTikTok(url: string): Promise<SocialExtractionResult | null> {
  try {
    const res = await safeFetch(
      `https://www.tiktok.com/oembed?url=${encodeURIComponent(url)}`
    );
    if (res?.ok) {
      const data = await res.json() as any;
      return {
        title: data.title || 'TikTok Video',
        content: `${data.title}\n\nBy: ${data.author_name}\n\nURL: ${url}`,
        content_type: 'social_video',
        platform: 'tiktok',
        metadata: {
          author: data.author_name,
          author_url: data.author_unique_id
            ? `https://www.tiktok.com/@${data.author_unique_id}`
            : undefined,
          thumbnail_url: data.thumbnail_url,
          embed_html: data.html,
          original_url: url,
          extraction_method: 'tiktok_oembed',
          platform: 'tiktok',
        }
      };
    }
  } catch (e) {
    logger.debug('CONTENT', 'TikTok oEmbed failed', {}, e as Error);
  }

  return null;
}

/**
 * Reddit — Append .json to URL for free API access.
 */
async function extractReddit(url: string): Promise<SocialExtractionResult | null> {
  try {
    // Resolve redd.it short URLs to full reddit.com URLs first
    let resolvedUrl = url;
    if (/redd\.it\//i.test(url)) {
      resolvedUrl = await resolveShortUrl(url);
      logger.debug('CONTENT', `Resolved Reddit short URL: ${url} → ${resolvedUrl}`);
    }
    let jsonUrl = resolvedUrl.replace(/\?.*$/, '');
    if (!jsonUrl.endsWith('/')) jsonUrl += '/';
    jsonUrl += '.json';

    const res = await safeFetch(jsonUrl, {
      headers: { 'User-Agent': 'BrowningDigital-ContentPipeline/1.0' }
    });
    if (res?.ok) {
      const data = await res.json() as any;
      const post = Array.isArray(data)
        ? data[0]?.data?.children?.[0]?.data
        : data?.data?.children?.[0]?.data;

      if (post) {
        const selftext = post.selftext || '';
        const isVideo = post.is_video || post.post_hint === 'hosted:video';
        const isImage = post.post_hint === 'image';

        let content = `${post.title || ''}\n\n`;
        if (selftext) content += selftext + '\n\n';
        if (post.url && post.url !== url) content += `Link: ${post.url}\n`;
        content += `\nr/${post.subreddit} • ${post.score} points • ${post.num_comments} comments`;

        return {
          title: post.title || 'Reddit Post',
          content: content.trim(),
          content_type: isVideo ? 'social_video' : isImage ? 'social_image' : 'social_post',
          platform: 'reddit',
          metadata: {
            author: post.author,
            author_url: `https://www.reddit.com/user/${post.author}`,
            thumbnail_url: post.thumbnail !== 'self' && post.thumbnail !== 'default'
              ? post.thumbnail
              : undefined,
            original_url: url,
            extraction_method: 'reddit_json',
            platform: 'reddit',
            subreddit: post.subreddit,
            score: post.score,
            num_comments: post.num_comments,
            is_video: isVideo,
          }
        };
      }
    }
  } catch (e) {
    logger.debug('CONTENT', 'Reddit JSON failed', {}, e as Error);
  }

  return null;
}

/**
 * Instagram — embed page scraping + ddinstagram alternative frontend.
 * The embed page at /p/{shortcode}/embed/captioned/ is public — no auth.
 */
async function extractInstagram(url: string): Promise<SocialExtractionResult | null> {
  const shortcodeMatch = url.match(/instagram\.com\/(p|reel|reels|tv)\/([A-Za-z0-9_-]+)/i);

  // Method 1: Instagram embed page (public HTML)
  if (shortcodeMatch) {
    const urlType = shortcodeMatch[1]; // p, reel, reels, or tv
    const shortcode = shortcodeMatch[2];
    try {
      const embedUrl = `https://www.instagram.com/${urlType}/${shortcode}/embed/captioned/`;
      const res = await safeFetch(embedUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'text/html,application/xhtml+xml',
          'Accept-Language': 'en-US,en;q=0.9',
        }
      });

      if (res?.ok) {
        const html = await res.text();

        const captionMatch = html.match(/<div class="Caption"[^>]*>([\s\S]*?)<\/div>/i)
          || html.match(/"caption":\s*\{[^}]*"text":\s*"([^"]*?)"/i)
          || html.match(/"edge_media_to_caption":\s*\{"edges":\s*\[\s*\{"node":\s*\{"text":\s*"([^"]*?)"/i);

        const usernameMatch = html.match(/"username":\s*"([^"]+)"/i)
          || html.match(/class="UsernameText"[^>]*>([^<]+)/i);

        const isVideo = html.includes('"is_video":true') || /\/reel/i.test(url);

        const caption = captionMatch
          ? decodeUnicodeEscapes(
              (captionMatch[1] || '')
                .replace(/<[^>]+>/g, ' ')
                .replace(/\\n/g, '\n')
                .trim()
            )
          : '';
        const username = usernameMatch
          ? (usernameMatch[1] || '').trim()
          : '';

        if (caption || username) {
          return {
            title: username ? `${username} on Instagram` : 'Instagram Post',
            content: caption || `Instagram ${isVideo ? 'reel/video' : 'post'} by ${username || 'unknown'}`,
            content_type: isVideo ? 'social_video' : 'social_post',
            platform: 'instagram',
            metadata: {
              author: username || undefined,
              author_url: username ? `https://www.instagram.com/${username}/` : undefined,
              original_url: url,
              extraction_method: 'instagram_embed',
              platform: 'instagram',
              shortcode,
            }
          };
        }
      }
    } catch (e) {
      logger.debug('CONTENT', 'Instagram embed extraction failed', {}, e as Error);
    }
  }

  // Method 2: ddinstagram.com (alternative frontend, like fxtwitter for Instagram)
  try {
    const altUrl = url.replace(/(?:www\.)?instagram\.com/, 'ddinstagram.com');
    const res = await safeFetch(altUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'text/html',
      },
    });

    if (res?.ok) {
      const html = await res.text();

      const ogDesc = html.match(/<meta\s+(?:property|name)="og:description"\s+content="([^"]*?)"/i)
        || html.match(/content="([^"]*?)"\s+(?:property|name)="og:description"/i);
      const ogTitle = html.match(/<meta\s+(?:property|name)="og:title"\s+content="([^"]*?)"/i)
        || html.match(/content="([^"]*?)"\s+(?:property|name)="og:title"/i);
      const ogImage = html.match(/<meta\s+(?:property|name)="og:image"\s+content="([^"]*?)"/i)
        || html.match(/content="([^"]*?)"\s+(?:property|name)="og:image"/i);

      if (ogDesc || ogTitle) {
        const isVideo = /\/reel/i.test(url) || html.includes('og:video');
        return {
          title: decodeHtmlEntities(ogTitle?.[1] || 'Instagram Post'),
          content: decodeHtmlEntities(ogDesc?.[1] || ogTitle?.[1] || ''),
          content_type: isVideo ? 'social_video' : 'social_post',
          platform: 'instagram',
          metadata: {
            thumbnail_url: ogImage?.[1],
            original_url: url,
            extraction_method: 'ddinstagram',
            platform: 'instagram',
          }
        };
      }
    }
  } catch (e) {
    logger.debug('CONTENT', 'ddinstagram fallback failed', {}, e as Error);
  }

  return null;
}

/**
 * Facebook — embed plugin page + mobile og:tags.
 * The embed plugin endpoint is public and renders post text.
 */
async function extractFacebook(url: string): Promise<SocialExtractionResult | null> {
  // Resolve fb.watch and fb.com short URLs to full facebook.com URLs first
  let resolvedUrl = url;
  if (/fb\.watch\//i.test(url) || /fb\.com\//i.test(url)) {
    resolvedUrl = await resolveShortUrl(url);
    logger.debug('CONTENT', `Resolved Facebook short URL: ${url} → ${resolvedUrl}`);
  }

  const isVideo = /\/videos\/|\/watch\/|fb\.watch/i.test(url);

  // Method 1: Facebook embed plugin page (public)
  try {
    const embedUrl = `https://www.facebook.com/plugins/post.php?href=${encodeURIComponent(resolvedUrl)}&show_text=true&width=500`;
    const res = await safeFetch(embedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      }
    });

    if (res?.ok) {
      const html = await res.text();
      const textChunks: string[] = [];

      // Facebook embed pages contain post text in specific class patterns
      const storyMatches = html.match(/<div[^>]*class="[^"]*_5pbx[^"]*"[^>]*>([\s\S]*?)<\/div>/gi);
      if (storyMatches) {
        for (const match of storyMatches) {
          const text = stripHtml(match);
          if (text) textChunks.push(text);
        }
      }

      const userContentMatches = html.match(/<div[^>]*class="[^"]*userContent[^"]*"[^>]*>([\s\S]*?)<\/div>/gi);
      if (userContentMatches) {
        for (const match of userContentMatches) {
          const text = stripHtml(match);
          if (text) textChunks.push(text);
        }
      }

      // Also check for message JSON embedded in the page
      const jsonMsg = html.match(/"message":\s*\{"text":\s*"([^"]+)"/);
      if (jsonMsg) {
        textChunks.push(decodeUnicodeEscapes(jsonMsg[1].replace(/\\n/g, '\n')));
      }

      const authorMatch = html.match(/<(?:a|span)[^>]*class="[^"]*profileLink[^"]*"[^>]*>([^<]+)/i)
        || html.match(/"name":\s*"([^"]+)"/);

      const content = textChunks.join('\n\n').trim();
      const author = authorMatch?.[1] || '';

      if (content || author) {
        return {
          title: author ? `${author} on Facebook` : 'Facebook Post',
          content: content || `Facebook ${isVideo ? 'video' : 'post'} by ${author || 'unknown'}`,
          content_type: isVideo ? 'social_video' : 'social_post',
          platform: 'facebook',
          metadata: {
            author: author || undefined,
            original_url: url,
            extraction_method: 'facebook_embed',
            platform: 'facebook',
          }
        };
      }
    }
  } catch (e) {
    logger.debug('CONTENT', 'Facebook embed extraction failed', {}, e as Error);
  }

  // Method 2: Mobile Facebook (simpler HTML, og:tags)
  try {
    const mobileUrl = resolvedUrl.replace(/(?:www\.|m\.|web\.)?facebook\.com/, 'm.facebook.com');
    const res = await safeFetch(mobileUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
        'Accept': 'text/html',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });

    if (res?.ok) {
      const html = await res.text();

      const ogDesc = html.match(/<meta\s+(?:property|name)="og:description"\s+content="([^"]*?)"/i)
        || html.match(/content="([^"]*?)"\s+(?:property|name)="og:description"/i);
      const ogTitle = html.match(/<meta\s+(?:property|name)="og:title"\s+content="([^"]*?)"/i)
        || html.match(/content="([^"]*?)"\s+(?:property|name)="og:title"/i);
      const ogImage = html.match(/<meta\s+(?:property|name)="og:image"\s+content="([^"]*?)"/i)
        || html.match(/content="([^"]*?)"\s+(?:property|name)="og:image"/i);

      if (ogDesc || ogTitle) {
        return {
          title: decodeHtmlEntities(ogTitle?.[1] || 'Facebook Post'),
          content: decodeHtmlEntities(ogDesc?.[1] || ogTitle?.[1] || ''),
          content_type: isVideo ? 'social_video' : 'social_post',
          platform: 'facebook',
          metadata: {
            thumbnail_url: ogImage?.[1],
            original_url: url,
            extraction_method: 'facebook_mobile',
            platform: 'facebook',
          }
        };
      }
    }
  } catch (e) {
    logger.debug('CONTENT', 'Facebook mobile fallback failed', {}, e as Error);
  }

  return null;
}

/**
 * Threads — embed page scraping (same Meta infrastructure as Instagram).
 */
async function extractThreads(url: string): Promise<SocialExtractionResult | null> {
  const postMatch = url.match(/threads\.net\/@?([\w.]+)\/post\/([A-Za-z0-9_-]+)/i);
  if (!postMatch) return null;

  const [, username, postId] = postMatch;

  try {
    const embedUrl = `https://www.threads.net/@${username}/post/${postId}/embed/`;
    const res = await safeFetch(embedUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html',
      }
    });

    if (res?.ok) {
      const html = await res.text();
      const textMatch = html.match(/"text":\s*"([^"]*?)"/i);
      const caption = textMatch?.[1]
        ? decodeUnicodeEscapes(textMatch[1].replace(/\\n/g, '\n').trim())
        : '';

      return {
        title: `${username} on Threads`,
        content: caption || `Threads post by ${username}`,
        content_type: 'social_post',
        platform: 'threads',
        metadata: {
          author: username,
          author_url: `https://www.threads.net/@${username}`,
          original_url: url,
          extraction_method: 'threads_embed',
          platform: 'threads',
        }
      };
    }
  } catch (e) {
    logger.debug('CONTENT', 'Threads embed extraction failed', {}, e as Error);
  }

  return null;
}

/**
 * LinkedIn — og:meta tag extraction via Googlebot UA.
 */
async function extractLinkedIn(url: string): Promise<SocialExtractionResult | null> {
  try {
    const res = await safeFetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        'Accept': 'text/html',
      },
    });

    if (res?.ok) {
      const html = await res.text();

      const ogDesc = html.match(/<meta\s+(?:property|name)="og:description"\s+content="([^"]*?)"/i)
        || html.match(/content="([^"]*?)"\s+(?:property|name)="og:description"/i);
      const ogTitle = html.match(/<meta\s+(?:property|name)="og:title"\s+content="([^"]*?)"/i)
        || html.match(/content="([^"]*?)"\s+(?:property|name)="og:title"/i);
      const ogImage = html.match(/<meta\s+(?:property|name)="og:image"\s+content="([^"]*?)"/i)
        || html.match(/content="([^"]*?)"\s+(?:property|name)="og:image"/i);

      if (ogDesc || ogTitle) {
        return {
          title: decodeHtmlEntities(ogTitle?.[1] || 'LinkedIn Post'),
          content: decodeHtmlEntities(ogDesc?.[1] || ogTitle?.[1] || ''),
          content_type: 'social_post',
          platform: 'linkedin',
          metadata: {
            thumbnail_url: ogImage?.[1],
            original_url: url,
            extraction_method: 'linkedin_og',
            platform: 'linkedin',
          }
        };
      }
    }
  } catch (e) {
    logger.debug('CONTENT', 'LinkedIn extraction failed', {}, e as Error);
  }

  return null;
}

// ============================================================================
// Extraction Router
// ============================================================================

const EXTRACTORS: Record<SocialPlatform, (url: string) => Promise<SocialExtractionResult | null>> = {
  twitter: extractTwitter,
  youtube: extractYouTube,
  tiktok: extractTikTok,
  reddit: extractReddit,
  instagram: extractInstagram,
  facebook: extractFacebook,
  threads: extractThreads,
  linkedin: extractLinkedIn,
};

/**
 * Extract content from a social media URL.
 * Returns null if the URL is not a recognized social platform or all extraction methods fail.
 * Caller should fall back to Jina/content-extractor when this returns null.
 */
export async function extractSocialContent(url: string): Promise<SocialExtractionResult | null> {
  const platform = detectPlatform(url);
  if (!platform) return null;

  logger.info('CONTENT', `Social extraction: ${platform}`, { url });

  const extractor = EXTRACTORS[platform];
  if (!extractor) return null;

  try {
    const result = await extractor(url);
    if (result) {
      logger.info('CONTENT', `Social extraction succeeded: ${result.metadata.extraction_method}`, {
        platform,
        title: result.title,
        content_length: result.content.length,
      });
    } else {
      logger.warn('CONTENT', `Social extraction: all methods failed for ${platform}`, { url });
    }
    return result;
  } catch (error) {
    logger.error('CONTENT', `Social extraction error for ${platform}`, { url }, error as Error);
    return null;
  }
}
