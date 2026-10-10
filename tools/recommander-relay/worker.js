/* A relay between MTG Table and Recommander's public API.

   Recommander (https://recommander.cards) answers only its own website from
   a browser, so the app asks through this: a Cloudflare Worker that takes
   the app's request, sends it on to the one Recommander endpoint, and hands
   the answer back with the headers a browser needs to read it.

   It is not an open proxy: it only ever calls the recommend endpoint, only
   for requests from the app's own pages (ALLOWED), and only with a small
   JSON body. The same deck asked about twice in ten minutes is answered
   from Cloudflare's cache rather than asking Recommander again, which keeps
   well inside their rate limits.

   Setting it up is in README.md beside this file. */

const API = 'https://api.recommander.cards/public-release/api/decks/recommend/top';
// the pages that may use the relay: the published app, and the app run locally
const ALLOWED = ['https://fortnob.github.io', 'http://localhost:8765', 'http://127.0.0.1:8765'];
const MAX_BODY = 64 * 1024;
const CACHE_SECONDS = 600;

async function digest(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get('Origin') || '';
    const allowed = ALLOWED.includes(origin);
    const cors = allowed ? {
      'Access-Control-Allow-Origin': origin,
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'content-type',
      'Access-Control-Expose-Headers': 'Retry-After',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin',
    } : {};
    const json = (status, obj, extra) => new Response(JSON.stringify(obj), {
      status, headers: Object.assign({ 'content-type': 'application/json' }, cors, extra || {}),
    });

    if (request.method === 'OPTIONS') return new Response(null, { status: allowed ? 204 : 403, headers: cors });
    if (!allowed) return json(403, { result_code: 'error_unauthorized', error: { messages: ['This relay serves MTG Table only.'] } });
    if (request.method !== 'POST') return json(405, { result_code: 'error_invalid_request', error: { messages: ['POST only.'] } });

    const body = await request.text();
    if (body.length > MAX_BODY) return json(413, { result_code: 'error_invalid_request', error: { messages: ['That deck is too large to ask about.'] } });
    try { JSON.parse(body); } catch (e) { return json(400, { result_code: 'error_invalid_request', error: { messages: ['Not JSON.'] } }); }

    // the same question asked again soon is answered from the cache
    const cache = caches.default;
    const key = new Request('https://relay.cache/' + await digest(body));
    const hit = await cache.match(key);
    if (hit) return new Response(hit.body, { status: 200, headers: Object.assign({ 'content-type': 'application/json' }, cors) });

    let up;
    try {
      up = await fetch(API, { method: 'POST', headers: { 'content-type': 'application/json' }, body });
    } catch (e) {
      return json(502, { result_code: 'error_backend_downstream', error: { messages: ['Recommander could not be reached.'] } });
    }
    const text = await up.text();
    const extra = up.headers.get('Retry-After') ? { 'Retry-After': up.headers.get('Retry-After') } : {};
    if (up.ok) {
      ctx.waitUntil(cache.put(key, new Response(text, {
        headers: { 'content-type': 'application/json', 'cache-control': 'max-age=' + CACHE_SECONDS },
      })));
    }
    return new Response(text, { status: up.status, headers: Object.assign({ 'content-type': 'application/json' }, cors, extra) });
  },
};
