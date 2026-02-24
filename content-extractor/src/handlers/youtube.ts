import type { Env } from '../types';

interface HandlerResult {
  title: string | null;
  content: string | null;
  metadata: Record<string, unknown>;
  error?: string;
}

function extractVideoId(url: string): string | null {
  const u = new URL(url);
  if (u.hostname.includes('youtu.be')) {
    return u.pathname.slice(1).split('/')[0];
  }
  if (u.hostname.includes('youtube.com')) {
    const v = u.searchParams.get('v');
    if (v) return v;
    const pathMatch = u.pathname.match(/\/(shorts|live|embed)\/([a-zA-Z0-9_-]+)/);
    if (pathMatch) return pathMatch[2];
  }
  return null;
}

export async function extractYoutube(url: string, env: Env): Promise<HandlerResult> {
  const videoId = extractVideoId(url);
  if (!videoId) {
    return { title: null, content: null, metadata: {}, error: 'Could not extract YouTube video ID' };
  }

  // Primary: youtube-transcript (calls YouTube Innertube API — no key needed)
  try {
    const { YoutubeTranscript } = await import('youtube-transcript');
    const transcript = await YoutubeTranscript.fetchTranscript(videoId);
    if (transcript && transcript.length > 0) {
      const text = transcript.map((t: { text: string }) => t.text).join(' ');
      return {
        title: null,
        content: text,
        metadata: {
          extractor: 'youtube-transcript',
          videoId,
          segments: transcript.length,
        },
      };
    }
  } catch {
    // Innertube may be blocked or video has no captions — fall through
  }

  // Fallback 1: Supadata API (100 credits/month free)
  try {
    const res = await fetch(`https://api.supadata.ai/v1/youtube/transcript?url=https://www.youtube.com/watch?v=${videoId}&text=true`);
    if (res.ok) {
      const data = (await res.json()) as { content?: string; lang?: string };
      if (data.content && data.content.length > 20) {
        return {
          title: null,
          content: data.content,
          metadata: { extractor: 'supadata', videoId, lang: data.lang },
        };
      }
    }
  } catch {
    // Fall through to Jina
  }

  // Fallback 2: Jina Reader (handles YouTube pages, extracts visible text/description)
  try {
    const headers: Record<string, string> = { 'X-Return-Format': 'markdown' };
    if (env.JINA_API_KEY) headers['Authorization'] = `Bearer ${env.JINA_API_KEY}`;
    const res = await fetch(`https://r.jina.ai/${url}`, { headers });
    if (res.ok) {
      const text = await res.text();
      if (text && text.length > 100) {
        return {
          title: null,
          content: text,
          metadata: { extractor: 'jina', videoId },
        };
      }
    }
  } catch {
    // Final fallback failed
  }

  return {
    title: null,
    content: null,
    metadata: { videoId },
    error: 'No captions available for this video. If you have the audio file URL, paste that instead for transcription.',
  };
}
