/* Load the game engine (no UI) into Node, for simulations and tests.
   Scryfall responses are cached on disk under tools/.cache so repeated
   runs are fast and polite to the API. */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');
// MTG_CACHE_DIR points the cache somewhere else (an empty one shows what a
// fresh checkout, or CI, has to fetch)
const CACHE = process.env.MTG_CACHE_DIR ? path.resolve(process.env.MTG_CACHE_DIR) : path.join(__dirname, '.cache');
fs.mkdirSync(CACHE, { recursive: true });

const ENGINE_MODULES = [
  '00-core.js', '01-audio.js', '02-scryfall.js', '02a-carddb.js', '18-scripts.js', '19-cardlib.js', '03-oracle.js',
  '04-formats.js', '05-decklist.js', '06-rules.js', '06a-choice.js', '06b-events.js', '06c-replay.js', '06d-sim.js', '07-draft.js', '07b-sealed.js', '07c-jumpstart.js', '08-bots.js', '15-combos.js', '15a-brackets.js', '15b-themes.js', '16-advisor.js',
];

function installShims() {
  const g = globalThis;
  g.window = g;
  const store = new Map();
  g.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    key: (i) => Array.from(store.keys())[i],
    get length() { return store.size; },
  };
  const fakeEl = () => {
    const n = {
      style: { setProperty() {}, removeProperty() {} }, dataset: {}, children: [],
      classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
      setAttribute() {}, removeAttribute() {}, getAttribute: () => null, hasAttribute: () => false,
      toggleAttribute() {},
      appendChild(c) { this.children.push(c); return c; }, addEventListener() {}, removeEventListener() {},
      querySelector: () => null, querySelectorAll: () => [],
    };
    return n;
  };
  g.document = {
    documentElement: fakeEl(), body: fakeEl(), head: fakeEl(),
    createElement: fakeEl, createTextNode: (t) => ({ textContent: t }),
    querySelector: () => null, querySelectorAll: () => [],
    addEventListener() {}, removeEventListener() {},
  };
  g.addEventListener = g.addEventListener || (() => {});
  g.removeEventListener = g.removeEventListener || (() => {});
  g.innerHeight = 900; g.innerWidth = 1440;
  g.location = { search: '', href: 'http://localhost/' };

  const realFetch = g.fetch;
  let live = 0, lastLive = 0, misses = 0;
  g.fetch = async (url, opts) => {
    opts = opts || {};
    const key = crypto.createHash('sha1').update(String(url) + '|' + (opts.body || '')).digest('hex');
    const file = path.join(CACHE, key + '.json');
    if (fs.existsSync(file)) {
      const body = fs.readFileSync(file, 'utf8');
      const status = body === '__404__' ? 404 : 200;
      return {
        ok: status === 200, status, statusText: status === 200 ? 'OK' : 'Not Found',
        json: async () => JSON.parse(body),
      };
    }
    // offline, a request the cache cannot answer is a miss: a bot deck built
    // from it is built from less than it would have had
    if (process.env.OFFLINE) { misses++; return { ok: false, status: 404, statusText: 'offline', json: async () => ({}) }; }
    live++;
    /* Scryfall's hard limits: two a second for search, named, random and
       collection, ten a second for everything else. A 429 shuts the door
       for thirty seconds, so it is waited out here rather than handed to
       the client, whose short backoff would only knock again too soon. */
    const slow = /\/cards\/(search|named|random|collection)/.test(String(url));
    let res, t0;
    for (let attempt = 0; ; attempt++) {
      const gap = slow ? 550 : 120;
      const wait = lastLive + gap - Date.now();
      lastLive = Math.max(Date.now(), lastLive + gap);
      if (wait > 0) await new Promise(r => setTimeout(r, wait));
      t0 = Date.now();
      res = await realFetch(url, Object.assign({}, opts, {
        headers: Object.assign({ 'User-Agent': 'mtg-table-sim/1.0', 'Accept': 'application/json' }, opts.headers || {}),
      }));
      // FETCH_LOG=1 lists every live request on stderr, with how long it took
      if (process.env.FETCH_LOG) console.error(`[fetch] ${res.status} ${Date.now() - t0}ms ${opts.method || 'GET'} ${String(url).slice(0, 160)}`);
      if (res.status !== 429 || attempt >= 3) break;
      const after = parseInt(res.headers && res.headers.get && res.headers.get('retry-after'), 10);
      const pause = (after > 0 ? after : 30) * 1000 + 1000;
      console.error(`[fetch] Scryfall says slow down; waiting ${Math.round(pause / 1000)}s`);
      lastLive = Date.now() + pause;
    }
    if (res.status === 404) { fs.writeFileSync(file, '__404__'); return res; }
    if (!res.ok) return res;
    const text = await res.text();
    fs.writeFileSync(file, text);
    return { ok: true, status: 200, statusText: 'OK', json: async () => JSON.parse(text) };
  };
  g.__liveFetches = () => live;
  g.__offlineMisses = () => misses;
}

function load(opts) {
  opts = opts || {};
  installShims();
  // opts.modules loads a subset (the search test needs only the card data)
  const code = (opts.modules || ENGINE_MODULES).map(m => `/* ===== ${m} ===== */\n` + fs.readFileSync(path.join(SRC, m), 'utf8')).join('\n');
  vm.runInThisContext(code, { filename: 'engine.js' });
  const MTG = globalThis.MTG;
  if (MTG.settings) MTG.settings.botSpeed = 0;
  /* Alchemy's conjure makes a card from its name in the middle of a game, so
     the engine needs a way to look one up there and then: from the bulk file. */
  let byName = null;
  MTG.cardLookup = (name) => {
    if (!byName) {
      byName = new Map();
      const zlib = require('zlib');
      const file = path.join(ROOT, 'tools', 'oracle-cards.jsonl.gz');
      if (fs.existsSync(file)) {
        for (const line of zlib.gunzipSync(fs.readFileSync(file)).toString('utf8').split('\n')) {
          if (!line.trim()) continue;
          const c = JSON.parse(line);
          if (c.layout === 'art_series' || c.layout === 'token' || c.layout === 'double_faced_token') continue;
          const k = String(c.name).toLowerCase();
          if (!byName.has(k)) byName.set(k, c);
          if (c.name.includes(' // ')) { const f = c.name.split(' // ')[0].toLowerCase(); if (!byName.has(f)) byName.set(f, c); }
        }
      }
    }
    const c = byName.get(String(name).toLowerCase());
    return c ? (MTG.scry && MTG.scry.slim ? MTG.scry.slim(c) : c) : null;
  };
  // the request queue spaces live calls out; cached ones need no gap
  // (the fetch shim does that spacing itself, for live requests only)
  if (MTG.scry && MTG.scry.q) { MTG.scry.q.gap = 0; MTG.scry.q.slowGap = 0; }
  /* A request the shim is holding back after a 429 can wait half a minute;
     the client's twenty-second patience would call that a dead connection. */
  if (MTG.scry && MTG.scry._withTimeout) {
    const withTimeout = MTG.scry._withTimeout.bind(MTG.scry);
    MTG.scry._withTimeout = (promise, ms) => withTimeout(promise, Math.max(ms || 0, 150000));
  }
  return MTG;
}

module.exports = { load, ROOT, SRC };
