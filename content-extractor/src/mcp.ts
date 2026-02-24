import type { Env } from './types';
import { extractContent } from './extract';

interface JsonRpcRequest {
  jsonrpc: string;
  id: number | string;
  method: string;
  params?: Record<string, unknown>;
}

const TOOL_DEFINITION = {
  name: 'extract_content',
  description:
    'Extract text content from any URL — articles, PDFs, YouTube videos, Threads posts, Twitter/X, images, audio, video, and more. Returns clean text or Markdown regardless of media type.',
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
};

export async function handleMcp(request: Request, env: Env): Promise<Response> {
  if (request.method === 'GET') {
    return Response.json({
      name: 'content-extractor',
      version: '1.0.0',
      description: 'Universal link-to-content extraction MCP server',
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
          serverInfo: { name: 'content-extractor', version: '1.0.0' },
        },
      });

    case 'notifications/initialized':
      return new Response(null, { status: 204 });

    case 'tools/list':
      return Response.json({
        jsonrpc: '2.0',
        id,
        result: { tools: [TOOL_DEFINITION] },
      });

    case 'tools/call': {
      const toolName = (params as Record<string, unknown>)?.name as string;
      const args = (params as Record<string, unknown>)?.arguments as Record<string, string>;

      if (toolName !== 'extract_content') {
        return Response.json({
          jsonrpc: '2.0',
          id,
          error: { code: -32601, message: `Unknown tool: ${toolName}` },
        });
      }

      const url = args?.url;
      if (!url) {
        return Response.json({
          jsonrpc: '2.0',
          id,
          error: { code: -32602, message: 'Missing required parameter: url' },
        });
      }

      try {
        const result = await extractContent(url, env);
        const text = result.error
          ? `Error extracting ${url}: ${result.error}${result.content ? '\n\nPartial content:\n' + result.content : ''}`
          : `# ${result.title || 'Extracted Content'}\n\n**Source:** ${result.url}\n**Type:** ${result.content_type}\n**Cached:** ${result.cached}\n\n---\n\n${result.content}`;

        return Response.json({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text }],
          },
        });
      } catch (e) {
        return Response.json({
          jsonrpc: '2.0',
          id,
          result: {
            content: [{ type: 'text', text: `Extraction failed: ${(e as Error).message}` }],
            isError: true,
          },
        });
      }
    }

    default:
      return Response.json({
        jsonrpc: '2.0',
        id,
        error: { code: -32601, message: `Method not found: ${method}` },
      });
  }
}
