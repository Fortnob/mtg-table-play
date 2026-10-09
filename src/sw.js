/* ============================================================
   sw.js - the card pictures kept on this device, and the app itself

   A service worker for the art the table shows: Scryfall's card images,
   the card back and the mana symbols. The first time a picture is wanted
   it is fetched (with CORS, so what is kept is a real, readable picture
   and not an opaque blob the browser counts at many times its size) and
   kept in Cache Storage; after that it comes from the device.

   And the app's page, so a home-screen app opens with no connection:
   always asked of the network first, so an update arrives as it always
   has, and the copy kept here only when the network cannot answer or
   takes too long. Nothing else passes through here: not Scryfall's card
   data, not anything sent.

   Pictures are kept in "generations" of about 24 MB, at most eight of
   them and never more than a fifth of what the browser allows. When the
   newest is full a new one is started; when there are too many, the
   oldest goes, whole. A picture found in an old generation is moved to
   the newest, so the ones still in use stay. The card back and the
   symbols are kept apart and never go.

   A bad answer is never kept and never made up: anything but a whole,
   readable picture is passed through as it came, so the page's own
   fallbacks (the card drawn in text) still happen.

   Loaded in Node by tools/swtest.js for its rules; the listeners only go
   on inside a service worker. Bump VERSION on any change of behaviour,
   and NS (v1 -> v2) to throw away everything kept so far.
   ============================================================ */
'use strict';

const VERSION = 4;
const PREFIX = 'mtg-table-art-';                 // every cache this app has ever owned
const NS = PREFIX + 'v1-';
const PINNED = NS + 'pinned';
const META = NS + 'meta';
const GEN = NS + 'g';
const APP = NS + 'app';                          // the app's page, kept for opening offline
/* "Turned off on this device": made by the page, and outside PREFIX so
   neither the page's sweep nor the worker's own removes it. A worker the
   browser starts again for a page it still controls finds it and keeps
   nothing more. */
const OFF = 'mtg-table-sw-off';
const GEN_BYTES = 24e6, GEN_MAX_N = 600, MAX_GENS = 8, QUOTA_SHARE = 0.2, LOOKUP_MS = 1500;
// a failure slower than this was the connection, not a cached copy without its CORS headers
const SLOW_MS = 3000;
// how long the app's page waits on the network before opening the copy kept here
const PAGE_MS = 4000;
const HOSTS = new Set(['cards.scryfall.io', 'backs.scryfall.io', 'svgs.scryfall.io']);
/* These two send CORS headers only to a request that carries an Origin,
   so a picture the page loaded first (no Origin) can sit in the HTTP
   cache without them for a year: ask them past that cache. */
const RELOAD_HOSTS = new Set(['backs.scryfall.io', 'svgs.scryfall.io']);
// the sizes the table uses; never the large PNGs
const CARD_PATH = /^\/(small|normal|large|art_crop|border_crop)\//;
// kept from the start and never trimmed: the back of every card, and every symbol symbols.css draws
const CARD_BACK = 'https://backs.scryfall.io/large/0/a/0aeebaf5-8c7d-4636-9e82-8c27447861f7.jpg';
const SYMBOLS = ['T', 'Q', 'C'].concat(Array.from({ length: 21 }, (_, i) => String(i)), ['X', 'Y', 'Z']);
const PINNED_URLS = [CARD_BACK].concat(SYMBOLS.map(s => 'https://svgs.scryfall.io/card-symbols/' + s + '.svg'));

/** Whether a request is a card picture this worker keeps: a plain GET of one of the three image hosts. */
function shouldHandle(url, method, mode, hasRange) {
  if (method !== 'GET' || mode === 'navigate' || hasRange) return false;
  let u;
  try { u = new URL(url); } catch (e) { return false; }
  if (u.protocol !== 'https:' || !HOSTS.has(u.hostname)) return false;
  if (u.hostname === 'cards.scryfall.io' && !CARD_PATH.test(u.pathname)) return false;
  return true;
}

/** Whether a request is the app's page itself: a page load of the worker's own folder, or of index.html in it. */
function isAppPage(url, method, mode, scope) {
  if (method !== 'GET' || mode !== 'navigate') return false;
  let u, s;
  try { u = new URL(url); s = new URL(scope); } catch (e) { return false; }
  return u.origin === s.origin && (u.pathname === s.pathname || u.pathname === s.pathname + 'index.html');
}

if (typeof module === 'object' && module.exports) module.exports = { shouldHandle, isAppPage, PINNED_URLS, CARD_BACK, NS, PREFIX, OFF, APP, VERSION };

if (typeof ServiceWorkerGlobalScope !== 'undefined' && self instanceof ServiceWorkerGlobalScope) {
  let st = null;                    // { gens: [names, oldest first], meta: { name: { n, bytes, approx } }, maxGens }
  let loading = null;
  let epoch = 0;                    // bumped by Clear and retire: writes for requests begun before it are dropped
  let chain = Promise.resolve();    // every write, one at a time
  let dirty = false;
  let retired = false;              // told to stand down, or found OFF: the page has turned it off
  let offP = null;
  /** Whether the page has turned it off, read once per start of the worker. */
  const isOff = () => (retired ? Promise.resolve(true)
    : offP || (offP = caches.has(OFF).then((v) => { if (v) retired = true; return v; }, () => false)));
  const inflight = new Map();       // url -> the one fetch of it under way, until what it brought is kept

  const mk = (blob, type) => new Response(blob, { status: 200, headers: { 'Content-Type': type, 'Content-Length': String(blob.size) } });
  const metaKey = () => self.registration.scope + '__art-meta';
  const within = (p, ms) => Promise.race([p.catch(() => null), new Promise(r => setTimeout(() => r(null), ms))]);
  /** A write, after the ones before it; the event is kept alive until it is done. */
  const queue = (event, fn) => {
    const p = chain = chain.then(fn).catch(() => {});
    try { if (event && event.waitUntil) event.waitUntil(p); } catch (e) { /* the event is over: it runs anyway */ }
    return p;
  };
  /** A generation's name: its time of birth, so names sort oldest first and never repeat after a Clear. */
  let lastBorn = 0;
  const newGenName = () => {
    lastBorn = Math.max(Date.now(), lastBorn + 1);
    return GEN + lastBorn.toString(36).padStart(10, '0');
  };

  async function init() {
    if (st) return st;
    if (!loading) {
      const p = loading = (async () => {
        const names = (await caches.keys()).filter(n => n.startsWith(GEN)).sort();
        let saved = {};
        try {
          const r = await caches.match(metaKey(), { cacheName: META });
          if (r) saved = await r.json();
        } catch (e) { saved = {}; }
        const meta = {};
        for (const n of names) {
          if (saved && saved[n]) { meta[n] = saved[n]; continue; }
          // a generation the record does not know: counted, its size guessed
          let k = 0;
          try { if (await caches.has(n)) k = (await (await caches.open(n)).keys()).length; } catch (e) { k = 0; }
          meta[n] = { n: k, bytes: k * 100e3, approx: true };
        }
        let maxGens = MAX_GENS;
        try {
          if (self.navigator && navigator.storage && navigator.storage.estimate) {
            const q = (await navigator.storage.estimate()).quota;
            if (q) maxGens = Math.max(2, Math.min(MAX_GENS, Math.floor(q * QUOTA_SHARE / GEN_BYTES)));
          }
        } catch (e) { maxGens = MAX_GENS; }
        // a Clear or retire reset everything while this was reading: what it read is gone
        if (loading !== p) return st || init();
        st = { gens: names, meta, maxGens };
        return st;
      })();
      p.catch(() => { if (loading === p) loading = null; });
    }
    return loading;
  }

  async function lookup(url) {
    const s = await init();
    const names = [PINNED].concat(s.gens.slice().reverse());
    // the first cache to have it answers; every one saying no is a miss
    return new Promise((resolve) => {
      let left = names.length;
      for (const n of names) {
        caches.match(url, { cacheName: n, ignoreVary: true }).then(r => r, () => null).then((r) => {
          if (r) resolve({ res: r, name: n });
          else if (--left === 0) resolve(null);
        });
      }
    });
  }

  /**
   * A picture from Scryfall, asked for with CORS. A whole, readable image
   * comes back as { blob, type }; anything else that came back is handed
   * on as { res }, to answer the page with as it is; a body cut short is
   * null. A failure to connect is thrown, marked slow when the connection
   * hung or there is none, so nobody tries again.
   */
  async function fetchArt(url) {
    const host = new URL(url).hostname;
    const opts = (cache) => ({ mode: 'cors', credentials: 'omit', referrerPolicy: 'no-referrer', cache });
    const t0 = Date.now();
    const slow = (e) => {
      const yes = Date.now() - t0 > SLOW_MS || (self.navigator && navigator.onLine === false);
      if (yes && e && typeof e === 'object') { try { e.slow = true; } catch (x) { /* frozen */ } }
      return yes;
    };
    let res;
    try { res = await fetch(url, opts(RELOAD_HOSTS.has(host) ? 'reload' : 'default')); }
    catch (e) {
      if (RELOAD_HOSTS.has(host) || slow(e)) throw e;
      // an HTTP-cache copy without its CORS headers fails the check at once: once more, from the server
      try { res = await fetch(url, opts('reload')); } catch (e2) { slow(e2); throw e2; }
    }
    const type = (res.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
    if (res.status !== 200 || res.redirected || res.type !== 'cors' || !/^image\//.test(type)) return { res };
    const blob = await res.blob();
    const len = parseInt(res.headers.get('content-length') || '', 10);
    // empty, or shorter than it said (a compressed SVG may be longer than its header, never shorter)
    if (!blob.size || (Number.isFinite(len) && blob.size < len)) return null;
    return { blob, type };
  }

  async function dropOldest(s) {
    const name = s.gens.shift();
    if (!name) return;
    delete s.meta[name];
    dirty = true;
    await caches.delete(name).catch(() => {});
  }

  /** Keep a picture in the newest generation, starting one when it is full and letting the oldest go. */
  async function store(url, blob, type, ep) {
    const s = await init();
    if (retired || ep !== epoch) return false;
    let cur = s.gens[s.gens.length - 1];
    const m = cur && s.meta[cur];
    if (!cur || !m || m.bytes >= GEN_BYTES || m.n >= GEN_MAX_N) {
      cur = newGenName();
      s.gens.push(cur);
      s.meta[cur] = { n: 0, bytes: 0 };
    }
    let prev = null;
    try {
      const c = await caches.open(cur);
      prev = await c.match(url, { ignoreVary: true }).catch(() => null);
      await c.put(url, mk(blob, type));
    } catch (e) {
      // full up: the oldest goes, and this one is simply not kept
      if (e && e.name === 'QuotaExceededError') await dropOldest(s);
      return false;
    }
    // written over a copy already there: counted once
    const prevSize = prev ? (parseInt(prev.headers.get('content-length') || '', 10) || 0) : 0;
    const mm = s.meta[cur];
    if (mm) { if (!prev) mm.n++; mm.bytes = Math.max(0, mm.bytes + blob.size - prevSize); }
    dirty = true;
    while (s.gens.length > s.maxGens) await dropOldest(s);
    return true;
  }

  /** The card back or a symbol, kept apart for good (one that failed at install, as soon as it is seen). */
  async function pin(url, blob, type, ep) {
    if (retired || ep !== epoch) return false;
    await (await caches.open(PINNED)).put(url, mk(blob, type));
    return true;
  }

  /** A picture still in use, found in an old generation: moved to the newest. */
  async function promote(url, res, from, ep) {
    const s = await init();
    if (retired || ep !== epoch || !s.gens.includes(from)) return;
    let old;
    try {
      old = await caches.open(from);
      if (!(await old.match(url, { ignoreVary: true }))) return;   // an earlier promote moved it
    } catch (e) { return; }
    let blob;
    try { blob = await res.blob(); } catch (e) { return; }
    const type = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
    if (!(await store(url, blob, type, ep))) return;   // not written: it stays where it was
    // the old generation may have gone to make room for it
    if (!s.gens.includes(from)) return;
    try {
      if (await old.delete(url, { ignoreVary: true })) {
        const m = s.meta[from];
        if (m) { m.n = Math.max(0, m.n - 1); m.bytes = Math.max(0, m.bytes - blob.size); }
        dirty = true;
      }
    } catch (e) { /* stays where it was */ }
  }

  /** The record of what each generation holds, written when it has changed. */
  async function flushMeta() {
    if (retired || !dirty || !st) return;
    dirty = false;
    try {
      await (await caches.open(META)).put(metaKey(), new Response(JSON.stringify(st.meta), { headers: { 'Content-Type': 'application/json' } }));
    } catch (e) { dirty = true; }
  }

  async function forget(url) {
    const s = await init();
    for (const n of [PINNED].concat(s.gens)) {
      try {
        if (!(await caches.has(n))) continue;
        if (await (await caches.open(n)).delete(url, { ignoreVary: true })) {
          const m = s.meta[n];
          if (m) { m.n = Math.max(0, m.n - 1); m.bytes = Math.max(0, m.bytes - 100e3); m.approx = true; }
          dirty = true;
        }
      } catch (e) { /* nothing to forget there */ }
    }
  }

  async function clearAll() {
    const names = (await caches.keys()).filter(n => n.startsWith(GEN) || n === META);
    await Promise.all(names.map(n => caches.delete(n).catch(() => {})));
    st = { gens: [], meta: {}, maxGens: st ? st.maxGens : MAX_GENS };
    loading = null;
    dirty = false;
  }

  async function serve(event) {
    const req = event.request, url = req.url;
    const ep = epoch;                                  // a Clear or retire from here on drops this one's write
    // a slow lookup is not given up on: when the network cannot answer, a copy found late still can
    const look = lookup(url).catch(() => null);
    const hit = await within(look, LOOKUP_MS);
    if (hit) {
      const i = st ? st.gens.indexOf(hit.name) : -1;
      if (hit.name !== PINNED && i >= 0 && i < st.gens.length - 2) {
        const copy = hit.res.clone();
        queue(event, () => promote(url, copy, hit.name, ep));
        queue(event, flushMeta);
      }
      return hit.res;
    }
    let p = inflight.get(url), leader = false;
    if (!p) { leader = true; p = fetchArt(url); inflight.set(url, p); }
    const done = () => { if (inflight.get(url) === p) inflight.delete(url); };
    let got;
    try { got = await p; } catch (e) {
      if (leader) done();
      const late = await look;
      if (late) return late.res;
      throw e;
    }
    if (got && got.blob) {
      // the fetch stays in hand until it is kept, so a request in between does not fetch it again
      if (leader) {
        if (PINNED_URLS.includes(url)) queue(event, () => pin(url, got.blob, got.type, ep)).then(done);
        else { queue(event, () => store(url, got.blob, got.type, ep)).then(done); queue(event, flushMeta); }
      }
      return mk(got.blob, got.type);
    }
    if (leader) done();
    // cut short, or Scryfall said no: a copy found late is better
    const late = await look;
    if (late) return late.res;
    // what Scryfall said, as it said it, to the one that asked; anyone else asks again
    if (leader && got && got.res) return got.res;
    return fetch(req);
  }

  /* ---- the app's page ---- */
  // one copy, by the folder's address: "/" and "/index.html", with or without ?sw, are the same page
  const pageKey = () => self.registration.scope;
  const goodPage = (res) => !!res && res.ok && res.type === 'basic' && !res.redirected && /text\/html/i.test(res.headers.get('content-type') || '');
  async function keepPage(res) {
    if (retired || !goodPage(res)) return;
    await (await caches.open(APP)).put(pageKey(), res);
  }
  /**
   * The network first, so an update is never held back; the copy kept here
   * when there is no connection or it has not answered in PAGE_MS (the
   * network still finishes behind it, and its page is kept for next time);
   * with nothing kept, the network however long it takes.
   */
  async function servePage(event) {
    const req = event.request;
    const net = fetch(req).then((res) => {
      if (goodPage(res)) { const copy = res.clone(); queue(event, () => keepPage(copy)); }
      return res;
    });
    const first = await Promise.race([
      net.then((r) => ({ r }), () => ({ failed: true })),
      new Promise((r) => setTimeout(() => r({ slow: true }), PAGE_MS)),
    ]);
    if (first.r) return first.r;
    const kept = await caches.match(pageKey(), { cacheName: APP }).catch(() => null);
    if (kept) return kept;
    return net;
  }
  /** The page as installed, so the first launch without a connection already has it. */
  async function precachePage() {
    try { await keepPage(await fetch(pageKey(), { credentials: 'same-origin' })); } catch (e) { /* the next page load keeps it */ }
  }

  async function precachePinned() {
    const c = await caches.open(PINNED);
    await Promise.allSettled(PINNED_URLS.map(async (u) => {
      if (await c.match(u, { ignoreVary: true })) return;
      const got = await fetchArt(u);
      if (got && got.blob) await c.put(u, mk(got.blob, got.type));
    }));
  }

  self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(Promise.all([precachePinned().catch(() => {}), precachePage()]));
  });

  self.addEventListener('activate', (event) => {
    event.waitUntil(Promise.all([
      self.clients.claim(),
      // caches of an older layout (NS bumped): gone; anything not ours: left alone
      caches.keys().then(names => Promise.all(names.filter(n => n.startsWith(PREFIX) && !n.startsWith(NS))
        .map(n => caches.delete(n).catch(() => {})))),
    ]));
  });

  self.addEventListener('fetch', (event) => {
    const r = event.request;
    if (retired) return;
    if (isAppPage(r.url, r.method, r.mode, self.registration.scope)) {
      event.respondWith(isOff().then(off => (off ? fetch(r) : servePage(event))).catch(() => fetch(r)));
      return;
    }
    if (!shouldHandle(r.url, r.method, r.mode, r.headers.has('range'))) return;
    // anything going wrong in here: the plain network, exactly as without the worker; but a
    // connection that hung, or none at all, has had its one try, so the page's fallback comes at once
    event.respondWith(isOff().then(off => (off ? fetch(r) : serve(event)))
      .catch((e) => ((e && e.slow) ? Response.error() : fetch(r))));
  });

  self.addEventListener('message', (event) => {
    const d = event.data || {};
    const port = event.ports && event.ports[0];
    const reply = (v) => { try { if (port) port.postMessage(v); } catch (e) { /* nobody listening */ } };
    const work = (async () => {
      if (d.type === 'stats') {
        const s = await init();
        let n = 0, bytes = 0, approx = false;
        for (const g of s.gens) { const m = s.meta[g] || {}; n += m.n || 0; bytes += m.bytes || 0; approx = approx || !!m.approx; }
        reply({ v: VERSION, n, bytes, approx, maxBytes: s.maxGens * GEN_BYTES });
      } else if (d.type === 'retire') {
        /* Turned off: unregistering leaves a worker in charge of the pages
           already open, and it would go on keeping pictures. It stops, and
           everything it kept goes, after any write already under way. */
        retired = true;
        epoch++;
        inflight.clear();
        await (chain = chain.then(async () => {
          const names = (await caches.keys()).filter(n => n.startsWith(PREFIX));
          await Promise.all(names.map(n => caches.delete(n).catch(() => {})));
          st = null; loading = null; dirty = false;
        }).catch(() => {}));
        reply({ ok: true });
      } else if (d.type === 'clear') {
        epoch++;
        inflight.clear();
        await (chain = chain.then(clearAll).catch(() => {}));
        reply({ ok: true });
      } else if (d.type === 'forget' && typeof d.url === 'string' && shouldHandle(d.url, 'GET', 'no-cors', false)) {
        /* A picture that would not show. That may have been the network's
           doing and not the kept copy's, so the copy goes only for a whole
           new one, or when Scryfall says the picture is gone; offline, or
           with Scryfall having trouble, it stays. */
        const ep = epoch;
        if (!retired && await lookup(d.url).catch(() => null)) {
          let got = null;
          try { got = await fetchArt(d.url); } catch (e) { got = null; }
          const gone = !!(got && got.res && (got.res.status === 404 || got.res.status === 410));
          if ((got && got.blob) || gone) {
            await (chain = chain.then(async () => {
              if (retired || ep !== epoch) return;
              await forget(d.url);
              if (got && got.blob) {
                if (PINNED_URLS.includes(d.url)) await pin(d.url, got.blob, got.type, ep);
                else await store(d.url, got.blob, got.type, ep);
              }
            }).then(flushMeta).catch(() => {}));
          }
        }
        reply({ ok: true });
      } else reply(null);
    })().catch(() => reply(null));
    try { event.waitUntil(work); } catch (e) { /* replied anyway */ }
  });
}
