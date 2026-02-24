import type { Env } from '../types';
import { parseHTML } from 'linkedom';

interface HandlerResult {
  title: string | null;
  content: string | null;
  metadata: Record<string, unknown>;
  error?: string;
}

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export async function extractInstagram(url: string, env: Env): Promise<HandlerResult> {
  // Primary: Jina Reader (best for JS-rendered pages)
  try {
    const headers: Record<string, string> = { 'X-Return-Format': 'markdown' };
    if (env.JINA_API_KEY) headers['Authorization'] = `Bearer ${env.JINA_API_KEY}`;
    const res = await fetch(`https://r.jina.ai/${url}`, { headers });
    if (res.ok) {
      const text = await res.text();
      // Filter out login pages and CAPTCHA warnings
      if (text && text.length > 100 && !text.includes('requiring CAPTCHA') && !text.includes('Log in to Instagram')) {
        return {
          title: 'Instagram Post',
          content: text,
          metadata: { extractor: 'jina' },
        };
      }
    }
  } catch {
    // Fall through to HTML scrape
  }

  // Fallback: Fetch HTML and parse og: meta tags
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': BROWSER_UA,
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

      // If there's an og:image, try to describe it with CF AI Vision
      if (ogImage && env.AI) {
        try {
          const imgRes = await fetch(ogImage, { headers: { 'User-Agent': BROWSER_UA } });
          if (imgRes.ok) {
            const imgBytes = await imgRes.arrayBuffer();
            const sizeMB = imgBytes.byteLength / (1024 * 1024);
            if (sizeMB <= 5) {
              const aiResult = (await env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', {
                messages: [
                  {
                    role: 'user',
                    content: [
                      { type: 'image_url', image_url: { url: ogImage } },
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
    // Fall through
  }

  return {
    title: null,
    content: null,
    metadata: {},
    error: 'Instagram extraction limited — full captions require login. This is a known v1 limitation.',
  };
}
