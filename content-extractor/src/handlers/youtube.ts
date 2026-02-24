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

export async function extractYoutube(url: string, _env: Env): Promise<HandlerResult> {
  const videoId = extractVideoId(url);
  if (!videoId) {
    return { title: null, content: null, metadata: {}, error: 'Could not extract YouTube video ID' };
  }

  // youtube-transcript calls YouTube's Innertube API directly — no API key needed
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
    // Innertube API may be blocked or video has no captions
  }

  return {
    title: null,
    content: null,
    metadata: { videoId },
    error: 'No captions available for this video. If you have the audio file URL, paste that instead for transcription.',
  };
}
