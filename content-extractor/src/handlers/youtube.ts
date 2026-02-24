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
    // Handle /watch?v=, /shorts/, /live/
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

  // Primary: youtube-transcript (Innertube API)
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
    // Fall through to Supadata
  }

  // Fallback: Supadata API
  try {
    const res = await fetch(`https://api.supadata.ai/v1/youtube/transcript?videoId=${videoId}&text=true`, {
      headers: { 'x-api-key': env.GROQ_API_KEY }, // Reusing key slot — update if separate key exists
    });
    if (res.ok) {
      const data = (await res.json()) as { content?: string };
      if (data.content) {
        return {
          title: null,
          content: data.content,
          metadata: { extractor: 'supadata', videoId },
        };
      }
    }
  } catch {
    // Fall through
  }

  return {
    title: null,
    content: null,
    metadata: { videoId },
    error: 'No captions available. Paste audio file URL for transcription.',
  };
}
