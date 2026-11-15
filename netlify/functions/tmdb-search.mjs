// Netlify Function: movie search on TMDB (API v3). Only this one endpoint is implemented.
// The token is read from the server environment and is never logged or returned.
const json = (body, status = 200, extra = {}) => new Response(JSON.stringify(body), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': status === 200 ? 'public, max-age=600' : 'no-store', ...extra }
});

export default async (req) => {
  if (req.method !== 'GET') return json({ error: 'method_not_allowed' }, 405, { allow: 'GET' });

  const token = process.env.TMDB_READ_ACCESS_TOKEN;
  if (!token) return json({ error: 'not_configured' }, 503);

  const url = new URL(req.url);
  const title = (url.searchParams.get('title') || '').trim().replace(/\s+/g, ' ');
  const year = (url.searchParams.get('year') || '').trim();
  if (!title || title.length > 120) return json({ error: 'invalid_title' }, 400);
  if (year && !/^(18|19|20|21)\d\d$/.test(year)) return json({ error: 'invalid_year' }, 400);

  const q = new URLSearchParams({ query: title, include_adult: 'false', language: 'en-US', page: '1' });
  if (year) q.set('year', year);

  let res;
  try {
    res = await fetch('https://api.themoviedb.org/3/search/movie?' + q, {
      headers: { accept: 'application/json', Authorization: 'Bearer ' + token },
      signal: AbortSignal.timeout(8000)
    });
  } catch {
    return json({ error: 'unreachable' }, 502);
  }
  if (res.status === 401 || res.status === 403) return json({ error: 'invalid_credentials' }, 502);
  if (res.status === 429) return json({ error: 'rate_limited' }, 429, { 'retry-after': res.headers.get('retry-after') || '10' });
  if (!res.ok) return json({ error: 'upstream_error' }, 502);

  let data;
  try { data = await res.json(); } catch { return json({ error: 'bad_response' }, 502); }
  if (!data || !Array.isArray(data.results)) return json({ error: 'bad_response' }, 502);

  const results = data.results.slice(0, 8)
    .filter(m => m && Number.isInteger(m.id) && typeof m.title === 'string')
    .map(m => {
      const date = /^\d{4}-\d\d-\d\d$/.test(m.release_date || '') ? m.release_date : null;
      return {
        id: m.id,
        title: m.title.slice(0, 200),
        originalTitle: typeof m.original_title === 'string' ? m.original_title.slice(0, 200) : m.title.slice(0, 200),
        releaseDate: date,
        year: date ? +date.slice(0, 4) : null,
        posterPath: /^\/[A-Za-z0-9_-]+\.(jpg|png)$/.test(m.poster_path || '') ? m.poster_path : null
      };
    });
  return json({ results });
};

export const config = { path: '/api/tmdb-search' };
