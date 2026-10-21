/* ===== 02b-cardlang.js ===== */
/* ============================================================
   02b-cardlang.js - card pictures in another language

   Scryfall has most cards printed in several languages, and the picture
   is what a player actually reads at the table. With a language other
   than English chosen in Options, each printing that comes on screen is
   looked up once in that language: the same set and collector number
   first, and failing that any printing of the card in it, preferring one
   with the same painting. The answer is kept in IndexedDB beside the
   rest of the card data, so the next game asks nothing. Where there is
   no printing in that language the English picture simply stays.

   A picture found is loaded before it is shown, so a card never goes
   blank while it changes language. Then every picture of that card on
   the page is swapped where it stands, whichever screen drew it, and
   'scryfall:images' tells the table to look again.

   Only the pictures change. The card the game runs on, with the rules
   text the engine reads, is always the English one.

   English costs nothing: MTG.scry.cardLang is null and imageUrl never
   comes here at all.
   ============================================================ */
'use strict';
(function (MTG) {
  const U = MTG.util;

  /* The languages Scryfall prints cards in that a player is likely to
     read: [Scryfall's code, the name in English, the name in itself]. */
  const LANGS = [
    ['en', 'English', 'English'], ['es', 'Spanish', 'Español'], ['fr', 'French', 'Français'],
    ['de', 'German', 'Deutsch'], ['it', 'Italian', 'Italiano'], ['pt', 'Portuguese', 'Português'],
    ['ja', 'Japanese', '日本語'], ['ko', 'Korean', '한국어'], ['ru', 'Russian', 'Русский'],
    ['zhs', 'Simplified Chinese', '简体中文'], ['zht', 'Traditional Chinese', '繁體中文'],
  ];
  const CODES = new Set(LANGS.map(l => l[0]));
  // the sizes that carry the printed words; the art crop is the same painting in every language
  const SIZES = ['small', 'normal', 'large', 'png', 'border_crop'];
  const STORE = 'images';                         // a store of 02-scryfall.js's database, unused until now
  const FOUND_TTL = 1000 * 60 * 60 * 24 * 60;     // a printing found stays found
  const NONE_TTL = 1000 * 60 * 60 * 24 * 7;       // a new set's translations arrive over the weeks after it
  const RETRY_MS = 1000 * 60 * 3;                 // after a failed lookup (offline, most likely)
  const MAX_OTHERS = 12;                          // other printings kept per card, to match a painting from

  /** The language chosen in Options, or null for English (or anything not offered). */
  function chosen() {
    const l = MTG.settings && MTG.settings.cardLang;
    return l && l !== 'en' && CODES.has(l) ? l : null;
  }

  /** A card's pictures, kept small: {t: urls} for one picture, {f: [urls, …]} for one per face. */
  function picturesOf(c) {
    if (!c || c.image_status === 'missing' || c.image_status === 'placeholder') return null;
    const keep = (iu) => {
      if (!iu || !iu.normal) return null;
      const o = {};
      for (const s of SIZES) if (iu[s]) o[s] = iu[s];
      return o;
    };
    if (c.image_uris) { const t = keep(c.image_uris); return t ? { t } : null; }
    if (c.card_faces && c.card_faces.length && c.card_faces[0].image_uris) {
      const f = c.card_faces.map(x => keep(x.image_uris));
      return f[0] ? { f } : null;
    }
    return null;
  }

  /** One size of one face, from what picturesOf kept. */
  function pick(img, size, face) {
    if (!img) return '';
    const urls = img.t || (img.f && (img.f[face || 0] || img.f[0]));
    if (!urls) return '';
    return urls[size] || urls.normal || urls.large || '';
  }

  /** `text` with the address that starts `base` (whatever query follows it) changed to `to`. */
  function swapUrl(text, base, to) {
    const at = text.indexOf(base);
    if (at < 0) return text;
    let end = at + base.length;
    while (end < text.length && !/["')\s]/.test(text[end])) end++;
    return text.slice(0, at) + to + text.slice(end);
  }

  class CardLang {
    constructor(scry) {
      this.scry = scry;
      this.known = new Map();       // 'ja|neo|123' -> {img} or {none}
      this.waiting = new Map();     // the same key -> the lookup under way
      this.failedAt = new Map();    // the same key -> when it last failed
      this.oracle = new Map();      // 'ja|o|<oracle id>' -> the lookup of the card's other printings
      this.loaded = new Set();      // pictures found and loaded, ready to be shown
      this.broken = new Set();      // pictures found that would not load
      this.toSwap = [];             // [card, pictures] loaded since the page was last gone over
      this._tell = U.debounce(() => { this._swapAll(); MTG.bus.emit('scryfall:images'); }, 150);
    }

    get lang() { return chosen(); }

    /** Where a card's lookup is kept, or null for something with no printings to look up (a token). */
    keyOf(card, lang) {
      if (!card || card._isToken || !card.set || card.collector_number == null || card.collector_number === '') return null;
      if (/^(token|double_faced_token|emblem|art_series)$/.test(card.layout || '')) return null;
      if (/^(tkn|emb)$/.test(card.set)) return null;
      return lang + '|' + String(card.set).toLowerCase() + '|' + String(card.collector_number);
    }

    /**
     * A card's picture in the chosen language, or '' to show the English
     * one: because there is none, because it has not been found and
     * loaded yet (the lookup starts here), or because it would not load.
     */
    imageUrl(card, size, face) {
      const lang = chosen();
      if (!lang || !card || size === 'art_crop') return '';
      if (card.lang === lang) return '';                  // already printed in it
      const key = this.keyOf(card, lang);
      if (!key) return '';
      const e = this.known.get(key);
      if (e === undefined) { this.lookup(card, lang, key); return ''; }
      if (!e.img || !this.loaded.has(pick(e.img, 'normal', 0))) return '';
      return pick(e.img, size || 'normal', face);
    }

    /** Look a printing up: the cache on this device first, then Scryfall. One lookup per printing at a time. */
    lookup(card, lang, key) {
      if (this.waiting.has(key)) return this.waiting.get(key);
      const failed = this.failedAt.get(key);
      if (failed && Date.now() - failed < RETRY_MS) return Promise.resolve(null);
      const p = (async () => {
        let e = await this.scry.db.get(STORE, key);
        if (!e || Date.now() - (e._t || 0) > (e.img ? FOUND_TTL : NONE_TTL)) {
          e = await this._ask(card, lang);
          e._t = Date.now();
          await this.scry.db.put(STORE, key, e);
        }
        this.known.set(key, e);
        this.failedAt.delete(key);
        if (e.img) this._load(card, e.img);
        return e;
      })().catch(() => {
        // the English picture until the next try, a few minutes on
        this.known.delete(key);
        this.failedAt.set(key, Date.now());
        return null;
      }).finally(() => { this.waiting.delete(key); });
      this.waiting.set(key, p);
      return p;
    }

    /** What Scryfall has: the same printing in that language, else another printing of the card in it. */
    async _ask(card, lang) {
      const path = '/cards/' + encodeURIComponent(String(card.set).toLowerCase()) + '/' +
        encodeURIComponent(String(card.collector_number)) + '/' + lang;
      // nobody is waiting on a translation: it goes when the queue is free, and failing says nothing
      const same = await this.scry._fetch(path, { low: true, quiet: true });
      const own = picturesOf(same);
      if (own) return { img: own };
      const others = card.oracle_id ? await this._others(card.oracle_id, lang) : [];
      if (!others.length) return { none: true };
      const like = card.illustration_id && others.find(x => x.ill === card.illustration_id);
      return { img: (like || others[0]).img, other: true };
    }

    /** Every printing of a card in a language, newest first, kept per card so each printing need not ask again. */
    _others(oracleId, lang) {
      const key = lang + '|o|' + oracleId;
      if (this.oracle.has(key)) return this.oracle.get(key);
      const p = (async () => {
        const hit = await this.scry.db.get(STORE, key);
        if (hit && Date.now() - (hit._t || 0) < NONE_TTL) return hit.list || [];
        const q = new URLSearchParams({ q: `oracleid:${oracleId} lang:${lang}`, unique: 'prints', order: 'released', dir: 'desc' });
        const data = await this.scry._fetch('/cards/search?' + q.toString(), { low: true, quiet: true });
        const list = [];
        for (const c of (data && data.data) || []) {
          if (c.lang !== lang) continue;
          const img = picturesOf(c);
          if (img) list.push({ ill: c.illustration_id || (c.card_faces && c.card_faces[0] && c.card_faces[0].illustration_id) || null, img });
          if (list.length >= MAX_OTHERS) break;
        }
        await this.scry.db.put(STORE, key, { list, _t: Date.now() });
        return list;
      })();
      this.oracle.set(key, p);
      // a failure is not kept: the next printing of the card asks again
      p.catch(() => this.oracle.delete(key));
      return p;
    }

    /** Load a picture found before showing it; one that will not load is never shown. */
    _load(card, img) {
      const url = pick(img, 'normal', 0);
      if (!url || this.broken.has(url)) return;
      const ready = () => { this.loaded.add(url); this.toSwap.push([card, img]); this._tell(); };
      if (this.loaded.has(url) || typeof Image === 'undefined') { ready(); return; }
      const probe = new Image();
      probe.decoding = 'async';
      probe.onload = ready;
      probe.onerror = () => { this.broken.add(url); };
      probe.src = url;
    }

    /**
     * Every picture of the cards just loaded, wherever it is on the page
     * (a card's face drawn as a background, or an <img>), changed to the
     * same size in the new language.
     */
    _swapAll() {
      const list = this.toSwap.splice(0);
      if (!list.length || typeof document === 'undefined' || !chosen()) return;
      const quote = (s) => s.replace(/["\\]/g, '\\$&');
      for (const [card, img] of list) {
        const faces = img.f ? img.f.length : 1;
        for (let f = 0; f < faces; f++) {
          for (const size of SIZES) {
            const en = this.scry._imageUrl(card, size, f);
            const to = pick(img, size, f);
            if (!en || !to || en === to) continue;
            const base = en.split('?')[0];
            for (const n of document.querySelectorAll(`[style*="${quote(base)}"]`)) {
              const bg = n.style && n.style.backgroundImage;
              if (bg && bg.includes(base)) n.style.backgroundImage = swapUrl(bg, base, to.replace(/"/g, '%22'));
            }
            for (const n of document.querySelectorAll(`img[src^="${quote(base)}"]`)) n.src = to;
          }
        }
      }
    }
  }

  const cl = new CardLang(MTG.scry);
  let was = chosen();
  /* MTG.scry.cardLang is set only while a language other than English is
     chosen, so for English imageUrl does no more than look at it. */
  MTG.scry.cardLang = was ? cl : null;
  MTG.bus.on('settings:changed', () => {
    const now = chosen();
    if (now === was) return;
    was = now;
    MTG.scry.cardLang = now ? cl : null;
    // whatever is on screen looks again, in the new language or back in English
    MTG.bus.emit('scryfall:images');
  });

  MTG.cardLang = {
    LANGS,
    /** For the Options list: [code, "Japanese (日本語)"]. */
    options: () => LANGS.map(([code, name, own]) => [code, own === name ? name : `${name} (${own})`]),
    get current() { return chosen() || 'en'; },
    client: cl,
    _picturesOf: picturesOf,
    _swapUrl: swapUrl,
  };
})(window.MTG);
