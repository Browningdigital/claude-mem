import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type { CachedExtraction, ContentType, Env } from './types';

export function getSupabase(env: Env): SupabaseClient {
  return createClient(env.SUPABASE_URL, env.SUPABASE_KEY);
}

export async function getCached(env: Env, url: string): Promise<CachedExtraction | null> {
  const sb = getSupabase(env);
  const { data, error } = await sb
    .from('extractions')
    .select('*')
    .eq('url', url)
    .gt('expires_at', new Date().toISOString())
    .single();

  if (error || !data) return null;
  return data as CachedExtraction;
}

export async function putCache(
  env: Env,
  url: string,
  contentType: ContentType,
  title: string | null,
  content: string | null,
  metadata: Record<string, unknown>,
  error?: string
): Promise<void> {
  const sb = getSupabase(env);
  await sb.from('extractions').upsert(
    {
      url,
      content_type: contentType,
      title,
      content,
      metadata,
      error: error || null,
      extracted_at: new Date().toISOString(),
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
    },
    { onConflict: 'url_hash' }
  );
}
