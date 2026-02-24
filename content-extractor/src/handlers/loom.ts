import type { Env } from '../types';

interface HandlerResult {
  title: string | null;
  content: string | null;
  metadata: Record<string, unknown>;
  error?: string;
}

export async function extractLoom(url: string, env: Env): Promise<HandlerResult> {
  // Fetch the Loom share page and extract transcript from embedded JSON
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; ContentExtractor/1.0)',
      },
    });

    if (!res.ok) {
      return { title: null, content: null, metadata: {}, error: `Failed to fetch Loom page: ${res.status}` };
    }

    const html = await res.text();

    // Extract title
    const titleMatch = html.match(/<title>([^<]+)<\/title>/i);
    const title = titleMatch?.[1]?.replace(' | Loom', '').trim() || null;

    // Look for transcript in page JSON data
    const transcriptMatch = html.match(/"transcript":\s*"((?:[^"\\]|\\.)*)"/);
    if (transcriptMatch?.[1]) {
      const transcript = transcriptMatch[1]
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
      return {
        title,
        content: transcript,
        metadata: { extractor: 'loom-page-scrape' },
      };
    }

    // Look for video download URL and send to Groq Whisper
    const videoUrlMatch = html.match(/"url":\s*"(https:\/\/[^"]*\.mp4[^"]*)"/);
    if (videoUrlMatch?.[1] && env.GROQ_API_KEY) {
      try {
        const videoRes = await fetch(videoUrlMatch[1]);
        if (videoRes.ok) {
          const videoBytes = await videoRes.arrayBuffer();
          const sizeMB = videoBytes.byteLength / (1024 * 1024);

          if (sizeMB <= 25) {
            const formData = new FormData();
            formData.append('file', new Blob([videoBytes], { type: 'video/mp4' }), 'loom.mp4');
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
                  title,
                  content: data.text,
                  metadata: { extractor: 'loom-groq-whisper', sizeMB },
                };
              }
            }
          }
        }
      } catch {
        // Whisper fallback failed
      }
    }

    return {
      title,
      content: null,
      metadata: {},
      error: 'No transcript found in Loom page and video transcription failed',
    };
  } catch (e) {
    return { title: null, content: null, metadata: {}, error: `Loom extraction failed: ${(e as Error).message}` };
  }
}
