import type { Env } from '../types';

interface HandlerResult {
  title: string | null;
  content: string | null;
  metadata: Record<string, unknown>;
  error?: string;
}

export async function extractInstagram(url: string, env: Env): Promise<HandlerResult> {
  // Instagram oEmbed via Facebook Graph API
  try {
    const token = env.META_THREADS_TOKEN; // Reuse Meta token
    const res = await fetch(
      `https://graph.facebook.com/v18.0/instagram_oembed?url=${encodeURIComponent(url)}&access_token=${token}`
    );

    if (res.ok) {
      const data = (await res.json()) as {
        title?: string;
        author_name?: string;
        thumbnail_url?: string;
        html?: string;
      };

      let content = data.title || '';

      // If there's a thumbnail, try to describe it with CF AI Vision
      if (data.thumbnail_url && env.AI) {
        try {
          const imgRes = await fetch(data.thumbnail_url);
          if (imgRes.ok) {
            const imgBytes = await imgRes.arrayBuffer();
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
        } catch {
          // Image description failed, continue with text only
        }
      }

      return {
        title: `Instagram post by ${data.author_name || 'Unknown'}`,
        content: content || 'No caption available (Instagram requires login for full content)',
        metadata: {
          extractor: 'instagram-oembed',
          author: data.author_name,
          hasThumbnail: !!data.thumbnail_url,
          partial: true,
        },
      };
    }
  } catch {
    // Fall through
  }

  return {
    title: null,
    content: null,
    metadata: { partial: true },
    error: 'Instagram extraction failed — full caption extraction requires Instaloader (v2 feature)',
  };
}
