import type { ContentType } from './types';

function hostMatches(host: string, domain: string): boolean {
  return host === domain || host === `www.${domain}` || host.endsWith(`.${domain}`);
}

export function detectContentType(url: string): ContentType {
  const u = new URL(url);
  const host = u.hostname.toLowerCase();
  const path = u.pathname.toLowerCase();

  if (hostMatches(host, 'youtube.com') || hostMatches(host, 'youtu.be')) return 'youtube';
  if (hostMatches(host, 'loom.com')) return 'loom';
  if (hostMatches(host, 'tiktok.com')) return 'tiktok';
  if (hostMatches(host, 'twitter.com') || hostMatches(host, 'x.com')) return 'twitter';
  if (hostMatches(host, 'threads.net')) return 'threads';
  if (hostMatches(host, 'instagram.com')) return 'instagram';
  if (hostMatches(host, 'linkedin.com')) return 'linkedin';
  if (hostMatches(host, 'reddit.com') || hostMatches(host, 'redd.it')) return 'reddit';
  if (path.match(/\.pdf$/i)) return 'pdf';
  if (path.match(/\.(png|jpg|jpeg|gif|webp|svg|bmp)$/i)) return 'image';
  if (path.match(/\.(mp3|wav|ogg|m4a|flac|aac)$/i)) return 'audio';
  if (path.match(/\.(mp4|webm|mov|avi|mkv)$/i)) return 'video';
  return 'webpage';
}

export async function detectContentTypeWithHead(url: string): Promise<ContentType> {
  const staticType = detectContentType(url);
  if (staticType !== 'webpage') return staticType;

  try {
    const res = await fetch(url, { method: 'HEAD', redirect: 'follow' });
    const ct = res.headers.get('content-type') || '';
    if (ct.includes('application/pdf')) return 'pdf';
    if (ct.startsWith('image/')) return 'image';
    if (ct.startsWith('audio/')) return 'audio';
    if (ct.startsWith('video/')) return 'video';
  } catch {
    // Fall through to webpage
  }
  return 'webpage';
}
