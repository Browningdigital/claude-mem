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
  video: extractAudio, // Same handler — Groq Whisper handles both
  threads: extractThreads,
  tiktok: extractTiktok,
  instagram: extractInstagram,
  linkedin: extractLinkedin,
  loom: extractLoom,
};

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

  // 4. Cache result
  await putCache(env, url, contentType, result.title, result.content, result.metadata, result.error);

  // 5. Return
  return {
    url,
    content_type: contentType,
    title: result.title,
    content: result.content,
    metadata: result.metadata,
    cached: false,
    extracted_at: new Date().toISOString(),
    error: result.error,
    paywalled: result.paywalled,
  };
}
