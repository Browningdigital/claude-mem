export type ContentType =
  | 'youtube'
  | 'loom'
  | 'tiktok'
  | 'twitter'
  | 'threads'
  | 'instagram'
  | 'linkedin'
  | 'reddit'
  | 'pdf'
  | 'image'
  | 'audio'
  | 'video'
  | 'webpage';

export interface ExtractionResult {
  url: string;
  content_type: ContentType;
  title: string | null;
  content: string | null;
  metadata: Record<string, unknown>;
  cached: boolean;
  extracted_at: string;
  error?: string;
  paywalled?: boolean;
}

export interface Env {
  AI: Ai;
  SUPABASE_URL: string;
  SUPABASE_KEY: string;
  JINA_API_KEY?: string;   // Optional — Jina works without a key at ~20 RPM
  GROQ_API_KEY?: string;   // Optional — free signup, 8 hrs/day transcription
}

export interface CachedExtraction {
  id: string;
  url: string;
  url_hash: string;
  content_type: string;
  title: string | null;
  content: string | null;
  metadata: Record<string, unknown>;
  extracted_at: string;
  expires_at: string;
  error: string | null;
}
