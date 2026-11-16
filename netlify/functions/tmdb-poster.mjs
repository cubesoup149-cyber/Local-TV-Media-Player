// Netlify Function: same-origin poster download proxy for TMDB artwork.
// Only fetches image.tmdb.org/t/p/<allowed size>/<file>.jpg|png. No secret is involved (the image CDN is public).
const ERR = (error, status) => new Response(JSON.stringify({ error }), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' } });
const SIZES = new Set(['w185', 'w342', 'w500']);

export default async (req) => {
  if (req.method !== 'GET') return ERR('method_not_allowed', 405);
  const q = new URL(req.url).searchParams;
  const path = q.get('path') || '', size = q.get('size') || 'w342';
  if (!SIZES.has(size)) return ERR('invalid_size', 400);
  if (!/^\/[A-Za-z0-9_-]{5,60}\.(jpg|png)$/.test(path)) return ERR('invalid_path', 400);

  let res;
  try { res = await fetch('https://image.tmdb.org/t/p/' + size + path, { signal: AbortSignal.timeout(8000) }); }
  catch { return ERR('unreachable', 502); }
  if (res.status === 404) return ERR('not_found', 404);
  if (!res.ok) return ERR('upstream_error', 502);

  const type = (res.headers.get('content-type') || '').split(';')[0].trim();
  if (!/^image\/(jpeg|png|webp)$/.test(type)) return ERR('bad_response', 502);
  const buf = await res.arrayBuffer();
  if (buf.byteLength < 500 || buf.byteLength > 3_000_000) return ERR('bad_response', 502);
  return new Response(buf, { status: 200, headers: { 'content-type': type, 'cache-control': 'public, max-age=86400' } });
};

export const config = { path: '/api/tmdb-poster' };
