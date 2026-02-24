import type { Env } from '../types';

interface HandlerResult {
  title: string | null;
  content: string | null;
  metadata: Record<string, unknown>;
  error?: string;
}

export async function extractPdf(url: string, env: Env): Promise<HandlerResult> {
  // Fetch the PDF
  const pdfRes = await fetch(url);
  if (!pdfRes.ok) {
    return { title: null, content: null, metadata: {}, error: `Failed to fetch PDF: ${pdfRes.status}` };
  }

  const pdfBytes = await pdfRes.arrayBuffer();
  const sizeMB = pdfBytes.byteLength / (1024 * 1024);

  if (sizeMB > 25) {
    return { title: null, content: null, metadata: { sizeMB }, error: 'PDF exceeds 25MB limit' };
  }

  // Primary: CF Workers AI toMarkdown
  try {
    const result = await env.AI.toMarkdown([{ name: 'document.pdf', blob: new Blob([pdfBytes], { type: 'application/pdf' }) }]);
    const first = result?.[0];
    if (first && 'data' in first && first.data) {
      return {
        title: null,
        content: first.data,
        metadata: { extractor: 'cf-ai-tomarkdown', sizeMB },
      };
    }
  } catch {
    // Fall through to Jina
  }

  // Fallback: Jina Reader
  try {
    const res = await fetch(`https://r.jina.ai/${url}`, {
      headers: {
        Authorization: `Bearer ${env.JINA_API_KEY}`,
        'X-Return-Format': 'markdown',
      },
    });
    if (res.ok) {
      const text = await res.text();
      return {
        title: null,
        content: text,
        metadata: { extractor: 'jina', sizeMB },
      };
    }
  } catch {
    // Final fallback failed
  }

  return { title: null, content: null, metadata: { sizeMB }, error: 'All PDF extraction methods failed' };
}
