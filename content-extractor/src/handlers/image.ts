import type { Env } from '../types';

interface HandlerResult {
  title: string | null;
  content: string | null;
  metadata: Record<string, unknown>;
  error?: string;
}

export async function extractImage(url: string, env: Env): Promise<HandlerResult> {
  try {
    const res = await fetch(url);
    if (!res.ok) {
      return { title: null, content: null, metadata: {}, error: `Failed to fetch image: ${res.status}` };
    }

    const imageBytes = await res.arrayBuffer();
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const sizeMB = imageBytes.byteLength / (1024 * 1024);

    if (sizeMB > 10) {
      return { title: null, content: null, metadata: { sizeMB }, error: 'Image exceeds 10MB limit' };
    }

    // Convert to base64 for Workers AI
    const base64 = Buffer.from(imageBytes).toString('base64');
    const dataUrl = `data:${contentType};base64,${base64}`;

    const aiResult = (await env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', {
      messages: [
        {
          role: 'user',
          content: [
            { type: 'image', image: dataUrl },
            {
              type: 'text',
              text: 'Describe this image in detail. If there is text visible, transcribe all of it exactly.',
            },
          ],
        },
      ],
    })) as { response?: string };

    return {
      title: 'Image Description',
      content: aiResult.response || 'No description generated',
      metadata: { extractor: 'cf-workers-ai-vision', contentType, sizeMB },
    };
  } catch (e) {
    return { title: null, content: null, metadata: {}, error: `Image extraction failed: ${(e as Error).message}` };
  }
}
