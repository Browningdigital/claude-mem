import type { Env } from '../types';

interface HandlerResult {
  title: string | null;
  content: string | null;
  metadata: Record<string, unknown>;
  error?: string;
}

export async function extractAudio(url: string, env: Env): Promise<HandlerResult> {
  // Fetch the audio/video file
  const res = await fetch(url);
  if (!res.ok) {
    return { title: null, content: null, metadata: {}, error: `Failed to fetch media: ${res.status}` };
  }

  const mediaBytes = await res.arrayBuffer();
  const sizeMB = mediaBytes.byteLength / (1024 * 1024);
  const contentType = res.headers.get('content-type') || 'audio/mpeg';

  if (sizeMB > 25) {
    return {
      title: null,
      content: null,
      metadata: { sizeMB },
      error: `File is ${sizeMB.toFixed(1)}MB — exceeds 25MB limit. Download and split the file, then paste individual chunk URLs.`,
    };
  }

  // Primary: Groq Whisper
  try {
    const formData = new FormData();
    const blob = new Blob([mediaBytes], { type: contentType });
    const ext = contentType.split('/')[1]?.split(';')[0] || 'mp3';
    formData.append('file', blob, `audio.${ext}`);
    formData.append('model', 'whisper-large-v3');

    const groqRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` },
      body: formData,
    });

    if (groqRes.ok) {
      const data = (await groqRes.json()) as { text?: string };
      if (data.text) {
        return {
          title: 'Audio Transcription',
          content: data.text,
          metadata: { extractor: 'groq-whisper', sizeMB, contentType },
        };
      }
    }
  } catch {
    // Fall through to CF AI Whisper
  }

  // Fallback: CF Workers AI Whisper
  try {
    const aiResult = (await (env.AI as any).run('@cf/openai/whisper-large-v3-turbo', {
      audio: Array.from(new Uint8Array(mediaBytes)),
    })) as { text?: string };

    if (aiResult.text) {
      return {
        title: 'Audio Transcription',
        content: aiResult.text,
        metadata: { extractor: 'cf-workers-ai-whisper', sizeMB, contentType },
      };
    }
  } catch {
    // Final fallback failed
  }

  return {
    title: null,
    content: null,
    metadata: { sizeMB, contentType },
    error: 'All audio transcription methods failed',
  };
}
