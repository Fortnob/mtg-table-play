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
const CACHE = path.join(__dirname, '.cache');
fs.mkdirSync(CACHE, { recursive: true });

const ENGINE_MODULES = [
  '00-core.js', '01-audio.js', '02-scryfall.js', '18-scripts.js', '19-cardlib.js', '03-oracle.js',
  '04-formats.js', '05-decklist.js', '06-rules.js', '07-draft.js', '08-bots.js', '15-combos.js', '16-advisor.js',
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
  let live = 0, lastLive = 0;
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
    if (process.env.OFFLINE) return { ok: false, status: 404, statusText: 'offline', json: async () => ({}) };
    live++;
    // Scryfall asks for no more than ~10 requests a second
    const wait = lastLive + 120 - Date.now();
    lastLive = Math.max(Date.now(), lastLive + 120);
    if (wait > 0) await new Promise(r => setTimeout(r, wait));
    const res = await realFetch(url, Object.assign({}, opts, {
      headers: Object.assign({ 'User-Agent': 'mtg-table-sim/1.0', 'Accept': 'application/json' }, opts.headers || {}),
    }));
    if (res.status === 404) { fs.writeFileSync(file, '__404__'); return res; }
    if (!res.ok) return res;
    const text = await res.text();
    fs.writeFileSync(file, text);
    return { ok: true, status: 200, statusText: 'OK', json: async () => JSON.parse(text) };
  };
  g.__liveFetches = () => live;
}

function load(opts) {
  opts = opts || {};
  installShims();
  const code = ENGINE_MODULES.map(m => `/* ===== ${m} ===== */\n` + fs.readFileSync(path.join(SRC, m), 'utf8')).join('\n');
  vm.runInThisContext(code, { filename: 'engine.js' });
  const MTG = globalThis.MTG;
  MTG.settings.botSpeed = 0;
  // the request queue spaces live calls ~120ms apart; cached ones need no gap
  // (the fetch shim does that spacing itself, for live requests only)
  if (MTG.scry && MTG.scry.q) MTG.scry.q.gap = 0;
  return MTG;
}

module.exports = { load, ROOT, SRC };
