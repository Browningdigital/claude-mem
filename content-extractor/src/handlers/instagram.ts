import type { Env } from '../types';
import { parseHTML } from 'linkedom';

interface HandlerResult {
  title: string | null;
  content: string | null;
  metadata: Record<string, unknown>;
  error?: string;
}

export async function extractInstagram(url: string, env: Env): Promise<HandlerResult> {
  // Primary: Fetch HTML and parse og: meta tags
  // Instagram pages include og:description (caption) and og:image (thumbnail) even without login
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
        Accept: 'text/html',
      },
      redirect: 'follow',
    });

    if (res.ok) {
      const html = await res.text();
      const { document } = parseHTML(html);

      const ogDesc = document.querySelector('meta[property="og:description"]')?.getAttribute('content');
      const ogTitle = document.querySelector('meta[property="og:title"]')?.getAttribute('content');
      const ogImage = document.querySelector('meta[property="og:image"]')?.getAttribute('content');

      let content = ogDesc || '';

      // If there's an og:image, try to describe it with CF AI Vision (free tier)
      if (ogImage && env.AI) {
        try {
          const imgRes = await fetch(ogImage);
          if (imgRes.ok) {
            const imgBytes = await imgRes.arrayBuffer();
            const sizeMB = imgBytes.byteLength / (1024 * 1024);
            if (sizeMB <= 5) {
              const base64 = Buffer.from(imgBytes).toString('base64');
              const contentType = imgRes.headers.get('content-type') || 'image/jpeg';
              const dataUrl = `data:${contentType};base64,${base64}`;

              const aiResult = (await env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', {
                messages: [
                  {
                    role: 'user',
                    content: [
                      { type: 'image', image: dataUrl },
                      { type: 'text', text: 'Describe this Instagram post image in detail. Transcribe any visible text.' },
                    ],
                  },
                ],
              })) as { response?: string };

              if (aiResult.response) {
                content += `\n\n**Image Description:** ${aiResult.response}`;
              }
            }
          }
        } catch {
          // Vision failed, continue with text only
        }
      }

      if (content.length > 10) {
        return {
          title: ogTitle || 'Instagram Post',
          content,
          metadata: {
            extractor: 'instagram-og-meta',
            hasImage: !!ogImage,
          },
        };
      }
    }
  } catch {
    // Fall through to Jina
  }

  // Fallback: Jina Reader (free)
  try {
    const headers: Record<string, string> = { 'X-Return-Format': 'markdown' };
    if (env.JINA_API_KEY) headers['Authorization'] = `Bearer ${env.JINA_API_KEY}`;
    const res = await fetch(`https://r.jina.ai/${url}`, { headers });
    if (res.ok) {
      const text = await res.text();
      if (text && text.length > 50) {
        return {
          title: 'Instagram Post',
          content: text,
          metadata: { extractor: 'jina' },
        };
      }
    }
  } catch {
    // Fall through
  }

  return {
    title: null,
    content: null,
    metadata: {},
    error: 'Instagram extraction limited — full captions require login. og:description and image description extracted where available.',
  };
}
