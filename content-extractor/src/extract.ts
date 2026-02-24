import type { ContentType, Env, ExtractionResult } from './types';
import { detectContentTypeWithHead } from './router';
import { getCached, putCache } from './cache';
import { extractWebpage } from './handlers/webpage';
import { extractPdf } from './handlers/pdf';
import { extractYoutube } from './handlers/youtube';
import { extractImage } from './handlers/image';
import { extractTwitter } from './handlers/twitter';
import { extractAudio } from './handlers/audio';
import { extractThreads } from './handlers/threads';
import { extractTiktok } from './handlers/tiktok';
import { extractInstagram } from './handlers/instagram';
import { extractLinkedin } from './handlers/linkedin';
import { extractLoom } from './handlers/loom';

type Handler = (url: string, env: Env) => Promise<{ title: string | null; content: string | null; metadata: Record<string, unknown>; error?: string; paywalled?: boolean }>;

const handlers: Record<ContentType, Handler> = {
  webpage: extractWebpage,
  pdf: extractPdf,
  youtube: extractYoutube,
  image: extractImage,
  twitter: extractTwitter,
  audio: extractAudio,
  video: extractAudio,
  threads: extractThreads,
  tiktok: extractTiktok,
  instagram: extractInstagram,
  linkedin: extractLinkedin,
  loom: extractLoom,
};

/** Generic login/placeholder titles that should be treated as missing */
const JUNK_TITLES = [
  'log in', 'sign in', 'sign up', 'join', 'login',
  'linkedin content', 'threads post', 'tiktok video',
  'image content', 'image description', 'instagram post',
  'extracted content', 'threads • log in',
];

function isJunkTitle(title: string | null): boolean {
  if (!title) return true;
  const lower = title.trim().toLowerCase();
  if (lower.length < 3) return true;
  return JUNK_TITLES.some((j) => lower === j || lower.startsWith(j));
}

/**
 * Try to extract a meaningful title from the content itself.
 * Parses markdown headings, first sentence, etc.
 */
function titleFromContent(content: string | null, contentType: ContentType, url: string): string | null {
  if (!content || content.length < 10) return null;

  // 1. First markdown heading (# Title)
  const headingMatch = content.match(/^#\s+(.+)$/m);
  if (headingMatch) {
    const heading = headingMatch[1].trim();
    // Filter out filenames that are just the markdown artifact (e.g. "# document.pdf")
    if (heading.length > 3 && !heading.match(/^\w+\.\w{2,4}$/)) {
      return heading;
    }
  }

  // 2. For tweets/social: first line or first ~80 chars as title
  if (['twitter', 'threads', 'instagram', 'tiktok'].includes(contentType)) {
    const firstLine = content.split('\n').find((l) => l.trim().length > 10);
    if (firstLine) {
      const clean = firstLine.replace(/^[#*>\-\s]+/, '').trim();
      return clean.length > 80 ? clean.slice(0, 77) + '...' : clean;
    }
  }

  // 3. For webpages/articles: look for bold title pattern or first substantial line
  if (['webpage', 'linkedin', 'pdf'].includes(contentType)) {
    // Try **bold** title
    const boldMatch = content.match(/\*\*(.{5,80})\*\*/);
    if (boldMatch) return boldMatch[1];

    // First substantial line
    const lines = content.split('\n').filter((l) => l.trim().length > 15);
    if (lines.length > 0) {
      const first = lines[0].replace(/^[#*>\-\s]+/, '').trim();
      return first.length > 80 ? first.slice(0, 77) + '...' : first;
    }
  }

  return null;
}

/**
 * Build a descriptive title from the URL when nothing else works.
 */
function titleFromUrl(url: string, contentType: ContentType): string {
  try {
    const u = new URL(url);
    const host = u.hostname.replace('www.', '');

    switch (contentType) {
      case 'youtube': {
        return `YouTube video (${u.searchParams.get('v') || 'unknown'})`;
      }
      case 'twitter': {
        const match = u.pathname.match(/\/([^/]+)\/status\/(\d+)/);
        return match ? `@${match[1]} on X` : `Post on X`;
      }
      case 'threads': {
        const match = u.pathname.match(/@([^/]+)/);
        return match ? `@${match[1]} on Threads` : 'Threads post';
      }
      case 'instagram': {
        const match = u.pathname.match(/@([^/]+)/) || u.pathname.match(/\/([^/]+)\//);
        return match ? `@${match[1]} on Instagram` : 'Instagram post';
      }
      case 'tiktok': {
        const match = u.pathname.match(/@([^/]+)/);
        return match ? `@${match[1]} on TikTok` : 'TikTok video';
      }
      case 'linkedin': {
        const match = u.pathname.match(/\/company\/([^/]+)/);
        if (match) return `${match[1]} — LinkedIn`;
        return `LinkedIn page`;
      }
      case 'pdf': {
        const filename = u.pathname.split('/').pop() || '';
        return filename.replace(/\.pdf$/i, '') || 'PDF document';
      }
      case 'image': {
        const filename = u.pathname.split('/').pop() || '';
        return filename || 'Image';
      }
      case 'audio':
      case 'video': {
        const filename = u.pathname.split('/').pop() || '';
        return filename || `${contentType} file`;
      }
      default:
        return host;
    }
  } catch {
    return contentType;
  }
}

/**
 * Generate a summary title using CF Workers AI when all else fails.
 * Only called when no title could be parsed from content or URL.
 */
async function titleFromAI(content: string, env: Env): Promise<string | null> {
  try {
    const snippet = content.slice(0, 1500);
    const result = (await env.AI.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        {
          role: 'user',
          content: `Generate a short, descriptive title (max 10 words) for this content. Return ONLY the title, nothing else.\n\n${snippet}`,
        },
      ],
      max_tokens: 30,
    })) as { response?: string };

    if (result.response) {
      // Clean up AI response
      let title = result.response.trim().replace(/^["']|["']$/g, '').replace(/^Title:\s*/i, '').trim();
      if (title.length > 80) title = title.slice(0, 77) + '...';
      if (title.length > 3) return title;
    }
  } catch {
    // AI unavailable, fall through
  }
  return null;
}

export async function extractContent(url: string, env: Env): Promise<ExtractionResult> {
  // 1. Check cache
  const cached = await getCached(env, url);
  if (cached) {
    return {
      url: cached.url,
      content_type: cached.content_type as ContentType,
      title: cached.title,
      content: cached.content,
      metadata: cached.metadata,
      cached: true,
      extracted_at: cached.extracted_at,
      error: cached.error || undefined,
    };
  }

  // 2. Detect content type
  const contentType = await detectContentTypeWithHead(url);

  // 3. Route to handler
  const handler = handlers[contentType];
  let result;
  try {
    result = await handler(url, env);
  } catch (e) {
    result = { title: null, content: null, metadata: {}, error: `Handler error: ${(e as Error).message}` };
  }

  // 4. Title resolution chain: handler → content parsing → AI summary → URL fallback
  let title = result.title;

  if (isJunkTitle(title) && result.content) {
    // Try parsing title from content
    const parsed = titleFromContent(result.content, contentType, url);
    if (parsed) {
      title = parsed;
    } else {
      // Try AI-generated summary title
      const aiTitle = await titleFromAI(result.content, env);
      if (aiTitle) {
        title = aiTitle;
      } else {
        // Last resort: build from URL
        title = titleFromUrl(url, contentType);
      }
    }
  } else if (isJunkTitle(title)) {
    title = titleFromUrl(url, contentType);
  }

  // 5. Cache result
  await putCache(env, url, contentType, title, result.content, result.metadata, result.error);

  // 6. Return
  return {
    url,
    content_type: contentType,
    title,
    content: result.content,
    metadata: result.metadata,
    cached: false,
    extracted_at: new Date().toISOString(),
    error: result.error,
    paywalled: result.paywalled,
  };
}
