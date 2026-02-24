import type { Env } from './types';
import { extractContent } from './extract';

interface JsonRpcRequest {
  jsonrpc: string;
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

const TOOLS = [
  {
    name: 'extract_content',
    description:
      'Extract text content from any URL — articles, PDFs, YouTube transcripts, Twitter/X posts, Threads, Instagram, LinkedIn, Loom, TikTok, images (AI vision), audio/video (Whisper transcription). Returns clean Markdown regardless of source.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        url: {
          type: 'string',
          description: 'The URL to extract content from',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'extract_and_remember',
    description:
      'Extract content from a URL AND save it to Browning Memory (browningdigital.com). Use this when Alex drops a link and wants the content analyzed, summarized, and stored for future reference. Extracts the content, then stores it as a memory with auto-generated tags.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        url: {
          type: 'string',
          description: 'The URL to extract and remember',
        },
        topic: {
          type: 'string',
          description: 'Optional topic override (auto-generated from title if omitted)',
        },
        tags: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional additional tags (auto-tagged by content type)',
        },
        memory_type: {
          type: 'string',
          enum: ['reference', 'context', 'lesson', 'pattern', 'note'],
          description: 'Memory type (defaults to "reference")',
        },
        importance: {
          type: 'string',
          enum: ['low', 'normal', 'high', 'critical'],
          description: 'Importance level (defaults to "normal")',
        },
      },
      required: ['url'],
    },
  },
  {
    name: 'batch_extract',
    description:
      'Extract content from multiple URLs at once. Pass an array of URLs. Returns all results. Useful when Alex drops several links in one message.',
    inputSchema: {
      type: 'object' as const,
      properties: {
        urls: {
          type: 'array',
          items: { type: 'string' },
          description: 'Array of URLs to extract',
        },
      },
      required: ['urls'],
    },
  },
];

const BROWNING_MEMORY_MCP = 'https://browningdigital.com/api/mcp';

async function callBrowningMemory(toolName: string, args: Record<string, unknown>): Promise<unknown> {
  const res = await fetch(BROWNING_MEMORY_MCP, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'tools/call',
      params: { name: toolName, arguments: args },
    }),
  });
  if (!res.ok) throw new Error(`Browning Memory returned ${res.status}`);
  return res.json();
}

function autoTag(contentType: string, url: string): string[] {
  const tags = [contentType, 'extracted'];
  try {
    const hostname = new URL(url).hostname.replace('www.', '');
    tags.push(hostname);
  } catch { /* ignore */ }
  return tags;
}

function formatResult(result: {
  url: string;
  content_type: string;
  title: string | null;
  content: string | null;
  cached: boolean;
  error?: string;
  paywalled?: boolean;
}): string {
  if (result.error) {
    return `Error extracting ${result.url}: ${result.error}${result.content ? '\n\nPartial content:\n' + result.content : ''}`;
  }
  return `# ${result.title || 'Extracted Content'}\n\n**Source:** ${result.url}\n**Type:** ${result.content_type}\n**Cached:** ${result.cached}\n\n---\n\n${result.content}`;
}

async function handleExtractContent(url: string, env: Env) {
  const result = await extractContent(url, env);
  return { content: [{ type: 'text', text: formatResult(result) }] };
}

async function handleExtractAndRemember(
  args: { url: string; topic?: string; tags?: string[]; memory_type?: string; importance?: string },
  env: Env
) {
  const result = await extractContent(args.url, env);

  if (result.error && !result.content) {
    return {
      content: [{ type: 'text', text: `Extraction failed: ${result.error}` }],
      isError: true,
    };
  }

  // Save to Browning Memory
  const topic = args.topic || result.title || `Extracted: ${result.content_type} from ${new URL(args.url).hostname}`;
  const autoTags = autoTag(result.content_type, args.url);
  const allTags = [...new Set([...autoTags, ...(args.tags || [])])];

  // Truncate content for memory storage (keep it manageable)
  const contentForMemory = (result.content || '').slice(0, 8000);
  const memoryContent = `**Source:** ${args.url}\n**Type:** ${result.content_type}\n**Title:** ${result.title || 'N/A'}\n\n${contentForMemory}${(result.content || '').length > 8000 ? '\n\n[... truncated for memory storage]' : ''}`;

  try {
    await callBrowningMemory('remember', {
      topic,
      content: memoryContent,
      tags: allTags,
      memory_type: args.memory_type || 'reference',
      importance: args.importance || 'normal',
    });
  } catch (e) {
    // Memory save failed but extraction succeeded — still return content
    const text = formatResult(result) + `\n\n---\n**Warning:** Failed to save to Browning Memory: ${(e as Error).message}`;
    return { content: [{ type: 'text', text }] };
  }

  const text = formatResult(result) + `\n\n---\n**Saved to Browning Memory** as "${topic}" with tags: [${allTags.join(', ')}]`;
  return { content: [{ type: 'text', text }] };
}

async function handleBatchExtract(urls: string[], env: Env) {
  const results = await Promise.allSettled(urls.map((url) => extractContent(url, env)));
  const parts: string[] = [];

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    if (r.status === 'fulfilled') {
      parts.push(`## ${i + 1}. ${r.value.title || urls[i]}\n\n${formatResult(r.value)}`);
    } else {
      parts.push(`## ${i + 1}. ${urls[i]}\n\nFailed: ${r.reason}`);
    }
  }

  return { content: [{ type: 'text', text: parts.join('\n\n---\n\n') }] };
}

export async function handleMcp(request: Request, env: Env): Promise<Response> {
  if (request.method === 'GET') {
    return Response.json({
      name: 'content-extractor',
      version: '2.0.0',
      description: 'Universal content extraction MCP server — extract, analyze, and remember content from any URL',
      tools: TOOLS.map((t) => t.name),
    });
  }

  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 });
  }

  let body: JsonRpcRequest;
  try {
    body = (await request.json()) as JsonRpcRequest;
  } catch {
    return Response.json({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
  }
  const { jsonrpc, id, method, params } = body;

  if (jsonrpc !== '2.0') {
    return Response.json({ jsonrpc: '2.0', id, error: { code: -32600, message: 'Invalid JSON-RPC version' } });
  }

  switch (method) {
    case 'initialize':
      return Response.json({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'content-extractor', version: '2.0.0' },
        },
      });

    case 'notifications/initialized':
      return new Response(null, { status: 204 });

    case 'tools/list':
      return Response.json({
        jsonrpc: '2.0',
        id,
        result: { tools: TOOLS },
      });

    case 'tools/call': {
      const toolName = (params as Record<string, unknown>)?.name as string;
      const args = (params as Record<string, unknown>)?.arguments as Record<string, unknown>;

      try {
        let result;

        switch (toolName) {
          case 'extract_content': {
            const url = args?.url as string;
            if (!url) {
              return Response.json({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Missing required: url' } });
            }
            result = await handleExtractContent(url, env);
            break;
          }

          case 'extract_and_remember': {
            const url = args?.url as string;
            if (!url) {
              return Response.json({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Missing required: url' } });
            }
            result = await handleExtractAndRemember(args as { url: string; topic?: string; tags?: string[]; memory_type?: string; importance?: string }, env);
            break;
          }

          case 'batch_extract': {
            const urls = args?.urls as string[];
            if (!urls || !Array.isArray(urls) || urls.length === 0) {
              return Response.json({ jsonrpc: '2.0', id, error: { code: -32602, message: 'Missing required: urls array' } });
            }
            result = await handleBatchExtract(urls, env);
            break;
          }

          default:
            return Response.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Unknown tool: ${toolName}` } });
        }

        return Response.json({ jsonrpc: '2.0', id, result });
      } catch (e) {
        return Response.json({
          jsonrpc: '2.0',
          id,
          result: { content: [{ type: 'text', text: `Tool failed: ${(e as Error).message}` }], isError: true },
        });
      }
    }

    default:
      return Response.json({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${method}` } });
  }
}
