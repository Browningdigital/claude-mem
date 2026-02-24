import type { Env } from './types';
import { getSupabase } from './cache';

/**
 * Upload handler: accepts any file, processes it through the appropriate
 * extraction pipeline, stores analyzed content in Supabase with a short ID,
 * and saves to Browning Memory.
 */

const BROWNING_MEMORY_MCP = 'https://browningdigital.com/api/mcp';

function generateShortId(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let id = '';
  for (let i = 0; i < 8; i++) {
    id += chars[Math.floor(Math.random() * chars.length)];
  }
  return id;
}

function detectFileType(filename: string, mimeType: string): string {
  const ext = filename.split('.').pop()?.toLowerCase() || '';

  if (['pdf'].includes(ext) || mimeType === 'application/pdf') return 'pdf';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'heic', 'heif'].includes(ext) || mimeType.startsWith('image/')) return 'image';
  if (['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac', 'wma'].includes(ext) || mimeType.startsWith('audio/')) return 'audio';
  if (['mp4', 'webm', 'mov', 'avi', 'mkv', 'wmv', 'm4v'].includes(ext) || mimeType.startsWith('video/')) return 'video';
  if (['txt', 'md', 'csv', 'log', 'json', 'xml', 'yaml', 'yml', 'toml', 'ini', 'cfg'].includes(ext)) return 'text';
  if (['html', 'htm'].includes(ext)) return 'html';
  if (['js', 'ts', 'jsx', 'tsx', 'py', 'rb', 'go', 'rs', 'java', 'c', 'cpp', 'h', 'cs', 'swift', 'kt', 'sh', 'bash', 'zsh', 'fish', 'sql', 'r', 'lua', 'php'].includes(ext)) return 'code';
  if (['doc', 'docx', 'odt', 'rtf'].includes(ext)) return 'document';
  if (['xls', 'xlsx', 'ods'].includes(ext)) return 'spreadsheet';
  if (['ppt', 'pptx', 'odp'].includes(ext)) return 'presentation';

  return 'binary';
}

async function processFile(
  file: File,
  env: Env
): Promise<{ title: string; content: string; fileType: string; metadata: Record<string, unknown> }> {
  const fileType = detectFileType(file.name, file.type);
  const sizeMB = file.size / (1024 * 1024);
  const metadata: Record<string, unknown> = {
    filename: file.name,
    mimeType: file.type,
    sizeMB: Math.round(sizeMB * 100) / 100,
    fileType,
  };

  // Size guard
  if (sizeMB > 25) {
    throw new Error(`File is ${sizeMB.toFixed(1)}MB — exceeds 25MB limit`);
  }

  const bytes = await file.arrayBuffer();

  switch (fileType) {
    case 'pdf': {
      // CF AI toMarkdown
      const result = await env.AI.toMarkdown([{ name: file.name, blob: new Blob([bytes], { type: 'application/pdf' }) }]);
      const first = result?.[0];
      if (first && 'data' in first && first.data) {
        return { title: file.name, content: first.data, fileType, metadata: { ...metadata, extractor: 'cf-ai-tomarkdown' } };
      }
      throw new Error('PDF extraction failed');
    }

    case 'image': {
      // CF AI Vision via image description
      try {
        const aiResult = (await env.AI.run('@cf/meta/llama-3.2-11b-vision-instruct', {
          messages: [{
            role: 'user',
            content: [
              { type: 'image_url', image_url: { url: `data:${file.type || 'image/jpeg'};base64,${arrayBufferToBase64(bytes)}` } },
              { type: 'text', text: 'Describe this image in detail. If there is text visible, transcribe all of it exactly. Include layout, colors, and any notable elements.' },
            ],
          }],
        })) as { response?: string };

        if (aiResult.response) {
          return { title: file.name, content: aiResult.response, fileType, metadata: { ...metadata, extractor: 'cf-ai-vision' } };
        }
      } catch {
        // Fall through to toMarkdown
      }

      // Fallback: toMarkdown OCR
      const result = await env.AI.toMarkdown([{ name: file.name, blob: new Blob([bytes], { type: file.type || 'image/png' }) }]);
      const first = result?.[0];
      if (first && 'data' in first && first.data) {
        return { title: file.name, content: first.data, fileType, metadata: { ...metadata, extractor: 'cf-ai-tomarkdown' } };
      }
      throw new Error('Image processing failed');
    }

    case 'audio':
    case 'video': {
      // Groq Whisper
      if (env.GROQ_API_KEY) {
        const formData = new FormData();
        const ext = file.name.split('.').pop() || 'mp3';
        formData.append('file', new Blob([bytes], { type: file.type || 'audio/mpeg' }), `upload.${ext}`);
        formData.append('model', 'whisper-large-v3-turbo');

        const groqRes = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${env.GROQ_API_KEY}` },
          body: formData,
        });

        if (groqRes.ok) {
          const data = (await groqRes.json()) as { text?: string };
          if (data.text) {
            return { title: file.name, content: data.text, fileType, metadata: { ...metadata, extractor: 'groq-whisper' } };
          }
        }
      }

      // Fallback: CF AI Whisper
      try {
        const aiResult = (await (env.AI as any).run('@cf/openai/whisper-large-v3-turbo', {
          audio: Array.from(new Uint8Array(bytes)),
        })) as { text?: string };

        if (aiResult.text) {
          return { title: file.name, content: aiResult.text, fileType, metadata: { ...metadata, extractor: 'cf-ai-whisper' } };
        }
      } catch { /* fall through */ }

      throw new Error('Audio/video transcription failed. Set GROQ_API_KEY for reliable transcription.');
    }

    case 'text':
    case 'code':
    case 'html': {
      const text = new TextDecoder().decode(bytes);
      return { title: file.name, content: text, fileType, metadata: { ...metadata, extractor: 'text-decode' } };
    }

    case 'document':
    case 'spreadsheet':
    case 'presentation': {
      // CF AI toMarkdown handles Office formats
      const result = await env.AI.toMarkdown([{ name: file.name, blob: new Blob([bytes], { type: file.type }) }]);
      const first = result?.[0];
      if (first && 'data' in first && first.data) {
        return { title: file.name, content: first.data, fileType, metadata: { ...metadata, extractor: 'cf-ai-tomarkdown' } };
      }
      throw new Error(`${fileType} extraction failed — unsupported format`);
    }

    default: {
      // Try toMarkdown as a catch-all
      try {
        const result = await env.AI.toMarkdown([{ name: file.name, blob: new Blob([bytes], { type: file.type }) }]);
        const first = result?.[0];
        if (first && 'data' in first && first.data) {
          return { title: file.name, content: first.data, fileType: 'binary', metadata: { ...metadata, extractor: 'cf-ai-tomarkdown' } };
        }
      } catch { /* fall through */ }

      // Last resort: try reading as text
      try {
        const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
        if (text.length > 10) {
          return { title: file.name, content: text, fileType: 'text', metadata: { ...metadata, extractor: 'text-decode-fallback' } };
        }
      } catch { /* not text */ }

      throw new Error(`Cannot extract content from ${file.name} (${file.type || 'unknown type'})`);
    }
  }
}

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary);
}

export interface UploadResult {
  id: string;
  link: string;
  title: string;
  content_type: string;
  content_length: number;
  metadata: Record<string, unknown>;
  memory_saved: boolean;
  created_at: string;
}

export async function handleUpload(request: Request, env: Env, baseUrl: string): Promise<Response> {
  if (request.method !== 'POST') {
    return Response.json({ error: 'POST required' }, { status: 405 });
  }

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return Response.json({ error: 'Invalid form data — send multipart/form-data with a "file" field' }, { status: 400 });
  }

  const file = formData.get('file') as File | null;
  if (!file) {
    return Response.json({ error: 'No file uploaded — include a "file" field' }, { status: 400 });
  }

  try {
    const { title, content, fileType, metadata } = await processFile(file, env);
    const shortId = generateShortId();
    const now = new Date().toISOString();

    // Store in Supabase
    const sb = getSupabase(env);
    await sb.from('uploads').upsert({
      id: shortId,
      title,
      content,
      content_type: fileType,
      metadata,
      created_at: now,
      expires_at: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString(), // 90 days
    });

    // Save to Browning Memory
    let memorySaved = false;
    try {
      const contentForMemory = content.slice(0, 8000);
      await fetch(BROWNING_MEMORY_MCP, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: Date.now(),
          method: 'tools/call',
          params: {
            name: 'remember',
            arguments: {
              topic: `Upload: ${title}`,
              content: `**File:** ${title}\n**Type:** ${fileType}\n**Size:** ${metadata.sizeMB}MB\n**Upload ID:** ${shortId}\n**Link:** ${baseUrl}/c/${shortId}\n\n${contentForMemory}${content.length > 8000 ? '\n\n[... truncated]' : ''}`,
              tags: ['upload', fileType, 'extracted', shortId],
              memory_type: 'reference',
              importance: 'normal',
            },
          },
        }),
      });
      memorySaved = true;
    } catch {
      // Memory save failed, but upload succeeded
    }

    const result: UploadResult = {
      id: shortId,
      link: `${baseUrl}/c/${shortId}`,
      title,
      content_type: fileType,
      content_length: content.length,
      metadata,
      memory_saved: memorySaved,
      created_at: now,
    };

    return Response.json(result);
  } catch (e) {
    return Response.json({ error: (e as Error).message }, { status: 422 });
  }
}

export async function getUploadedContent(id: string, env: Env): Promise<{
  id: string;
  title: string;
  content: string;
  content_type: string;
  metadata: Record<string, unknown>;
  created_at: string;
} | null> {
  const sb = getSupabase(env);
  const { data, error } = await sb
    .from('uploads')
    .select('*')
    .eq('id', id)
    .single();

  if (error || !data) return null;
  return data;
}
