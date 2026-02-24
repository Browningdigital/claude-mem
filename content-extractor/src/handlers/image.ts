import type { Env } from '../types';

interface HandlerResult {
  title: string | null;
  content: string | null;
  metadata: Record<string, unknown>;
  error?: string;
}

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export async function extractImage(url: string, env: Env): Promise<HandlerResult> {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': BROWSER_UA,
        Accept: 'image/*,*/*',
      },
    });
    if (!res.ok) {
      return { title: null, content: null, metadata: {}, error: `Failed to fetch image: ${res.status}` };
    }

    const imageBytes = await res.arrayBuffer();
    const contentType = res.headers.get('content-type') || 'image/jpeg';
    const sizeMB = imageBytes.byteLength / (1024 * 1024);

    if (sizeMB > 10) {
      return { title: null, content: null, metadata: { sizeMB }, error: 'Image exceeds 10MB limit' };
    }

    // Primary: CF Workers AI Llama Vision via image URL
    try {
      const aiResult = (await env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', {
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url } },
              {
                type: 'text',
                text: 'Describe this image in detail. If there is text visible, transcribe all of it exactly.',
              },
            ],
          },
        ],
      })) as { response?: string };

      if (aiResult.response) {
        return {
          title: 'Image Description',
          content: aiResult.response,
          metadata: { extractor: 'cf-workers-ai-vision', contentType, sizeMB },
        };
      }
    } catch {
      // Fall through to toMarkdown
    }

    // Fallback: CF AI toMarkdown (handles images with OCR)
    try {
      const ext = contentType.split('/')[1]?.split(';')[0] || 'png';
      const result = await env.AI.toMarkdown([{
        name: `image.${ext}`,
        blob: new Blob([imageBytes], { type: contentType }),
      }]);
      const first = result?.[0];
      if (first && 'data' in first && first.data) {
        return {
          title: 'Image Content',
          content: first.data,
          metadata: { extractor: 'cf-ai-tomarkdown', contentType, sizeMB },
        };
      }
    } catch {
      // Fall through to Jina
    }

    // Fallback 2: Jina Reader (can sometimes handle image URLs)
    try {
      const headers: Record<string, string> = { 'X-Return-Format': 'markdown' };
      if (env.JINA_API_KEY) headers['Authorization'] = `Bearer ${env.JINA_API_KEY}`;
      const jinaRes = await fetch(`https://r.jina.ai/${url}`, { headers });
      if (jinaRes.ok) {
        const text = await jinaRes.text();
        if (text && text.length > 20) {
          return {
            title: 'Image Content',
            content: text,
            metadata: { extractor: 'jina', contentType, sizeMB },
          };
        }
      }
    } catch {
      // Final fallback failed
    }

    return {
      title: null,
      content: null,
      metadata: { contentType, sizeMB },
      error: 'All image extraction methods failed',
    };
  } catch (e) {
    return { title: null, content: null, metadata: {}, error: `Image extraction failed: ${(e as Error).message}` };
  }
}
