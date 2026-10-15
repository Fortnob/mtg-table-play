/* ============================================================
   02e-tokenart.js - which printed token a token on the table is

   The engine makes tokens out of words: a 1/1 white Spirit with flying,
   a 2/2 black Zombie with decayed, a Treasure. Words have no picture, so
   one is found among Scryfall's printed tokens. A printed token is only
   that token when everything printed on it is: its name, power and
   toughness, colours, type line (in any order) and rules text. The rules
   text is compared without reminder text, punctuation or case, with the
   token's own name, "this creature", "this token" and the like all one,
   and with keywords on a line together counted in any order. A token
   with no abilities matches only printed tokens with no rules text.

   One looser match is allowed, and only when nothing matches exactly: a
   printed star/star token (made for "an X/X … token", its size set by what made
   it) whose every other word is the same.

   When nothing matches, there is no picture: the table draws the token
   (tokenFrame in 12-ui-table.js) rather than show a different one.

   The first matching picture is kept on this device (tokenArt.v3, keyed by
   everything compared). A player may choose another of the matching
   printings for each kind of token (tokenArtChoice.v1, this device only,
   never sent to anyone); it is shown for every such token on their table.
   ============================================================ */
'use strict';
(function (MTG) {
  const U = MTG.util;
  // v3: chosen again without the joke sets' tokens (MTG.jokes)
  const CACHE_KEY = 'tokenArt.v3';
  const CHOICE_KEY = 'tokenArtChoice.v1';
  const CACHE_MAX = 400;

  /* ---------------- what is compared ---------------- */

  const plain = (s) => String(s == null ? '' : s)
    .replace(/[‘’ʼ`´]/g, "'").replace(/[“”]/g, '"')
    .replace(/[‐‑‒–−]/g, '-');
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  /** Lower case, no quotes or punctuation, single spaces; mana symbols ({T}, {2}) kept. */
  const squash = (s) => s.toLowerCase().replace(/["']/g, '').replace(/[^a-z0-9{}+\-/*\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const NUMBERS = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve',
    'thirteen', 'fourteen', 'fifteen', 'sixteen', 'seventeen', 'eighteen', 'nineteen', 'twenty'];
  const NUMBER_WORDS = new RegExp('\\b(?:' + NUMBERS.join('|') + ')\\b', 'gi');
  // words no keyword line has: a sentence that lost its full stop ("This creature can't block")
  const NOT_KEYWORD = /\b(?:this|you|your|when|whenever|each|gets?|gains?|deals?|can'?t|may|if|dies)\b/i;

  /**
   * Rules text as it is compared: { kws: sorted keywords, lines: sorted other abilities }.
   * Reminder text goes; the token's name, CARDNAME and "this creature/token/artifact/…" are all "this".
   */
  function rulesText(text, name) {
    let s = plain(text);
    for (let i = 0; i < 3; i++) s = s.replace(/\([^()]*\)/g, ' ');
    s = s.replace(/\bCARDNAME\b|~/g, 'this');
    const n = plain(name).trim();
    if (n) s = s.replace(new RegExp('(^|[^A-Za-z])' + esc(n) + '(?![A-Za-z])', 'gi'), '$1this');
    s = s.replace(/\bthis (?:creature|token|artifact|enchantment|permanent|land|vehicle|planeswalker)\b/gi, 'this');
    // "create fourteen Treasure tokens" and "create 14 Treasure tokens" say the same
    s = s.replace(NUMBER_WORDS, (w) => String(NUMBERS.indexOf(w.toLowerCase())));
    const kws = new Set(), lines = [];
    for (const raw of s.split(/\n+/)) {
      const line = raw.replace(/\s+/g, ' ').trim();
      if (!line) continue;
      // "Flying, deathtouch": a list of keywords (no sentence, no cost, nothing quoted, a few words each)
      const parts = line.split(/[,;]/).map(squash).filter(Boolean);
      if (!/[.:"]/.test(line) && !NOT_KEYWORD.test(line) && parts.every(k => k.split(' ').length <= 4)) {
        for (const k of parts) kws.add(k);
        continue;
      }
      const w = squash(line);
      if (w) lines.push(w);
    }
    return { kws: [...kws].sort(), lines: lines.sort() };
  }

  /** One face of a card (a token in play, or a printed one), as the words compared. */
  function facts(card, face) {
    const faces = card && card.card_faces && card.card_faces.length > 1 ? card.card_faces : null;
    const f = faces ? (faces[face || 0] || faces[0]) : (card || {});
    const pick = (k) => (f[k] != null ? f[k] : (card || {})[k]);
    const name = plain(pick('name')).trim();
    const power = pick('power'), toughness = pick('toughness');
    const pt = power == null || power === '' ? '' : String(power) + '/' + String(toughness == null ? '' : toughness);
    const colors = (pick('colors') || []).map(c => String(c).toUpperCase()).sort().join('');
    const types = plain(pick('type_line')).replace(/\s-\s|—/g, ' ').toLowerCase()
      .split(/\s+/).filter(w => w && w !== 'token' && w !== '-').sort().join(' ');
    const rt = rulesText(pick('oracle_text'), name);
    /* A token with no name of its own is named for its subtypes (CR 111.4), and printings name the same one
       differently ("Wurm", "Phyrexian Wurm"): with its types compared, any such name is the same name. */
    const typeWords = new Set(types.split(' '));
    const unnamed = !!name && name.toLowerCase().split(/\s+/).every(w => typeWords.has(w));
    return { name, nameKey: unnamed ? '' : name.toLowerCase(), pt, colors, types, typeWords: [...typeWords], kws: rt.kws, lines: rt.lines,
      text: rt.kws.join(', ') + (rt.lines.length ? '\n' + rt.lines.join('\n') : '') };
  }

  /** The kind of token, as a key: everything compared (the words hashed, to keep it short). */
  function key(card, face) {
    const f = facts(card, face);
    return [f.name.toLowerCase(), f.pt, f.colors, U.hash(f.nameKey + '|' + f.types + '|' + f.text)].join('|');
  }

  /**
   * Is the printed face `p` this token (`t`, both from facts)? 'exact'; 'size' when it differs only in
   * being printed star/star for a token whose size an effect set; '' when it is a different token.
   */
  function compare(t, p) {
    if (t.nameKey !== p.nameKey || t.colors !== p.colors || t.types !== p.types || t.text !== p.text) return '';
    if (t.pt === p.pt) return 'exact';
    if (t.pt && /^\*\/\*$/.test(p.pt)) return 'size';
    return '';
  }

  /** A printed card's faces, each with its own picture (a double-faced token is two tokens). */
  function printedFaces(c) {
    if (!c) return [];
    if (c.card_faces && c.card_faces.length > 1) {
      return c.card_faces.map((f, i) => ({ i, facts: facts(c, i), img: f.image_uris || (i === 0 ? c.image_uris : null),
        illustration: f.illustration_id || (i === 0 ? c.illustration_id : null), artist: f.artist || c.artist }));
    }
    return [{ i: 0, facts: facts(c, 0), img: c.image_uris, illustration: c.illustration_id, artist: c.artist }];
  }

  /**
   * The printings in `list` that are this token, one per piece of art, newest first as the list is:
   * { list, how: 'exact' | 'size' | '' } — exact ones when there are any, else the star/star ones.
   */
  function options(card, list, face) {
    const want = facts(card, face);
    const out = { exact: [], size: [] };
    const seen = { exact: new Set(), size: new Set() };
    for (const c of list || []) {
      if (!c || c.digital || c.layout === 'art_series') continue;
      // never a joke set's token (Unfinity's, Unstable's): they are not in the game (MTG.jokes)
      if (MTG.jokes && !MTG.jokes.printOk(c)) continue;
      for (const f of printedFaces(c)) {
        const how = compare(want, f.facts);
        if (!how || !f.img || !f.img.normal) continue;
        const art = f.illustration || (c.id + ':' + f.i);
        if (seen[how].has(art)) continue;
        seen[how].add(art);
        out[how].push({ id: c.id, face: f.i, url: f.img.normal, art: f.img.art_crop || '', large: f.img.large || '',
          set: c.set, set_name: c.set_name, collector_number: c.collector_number, artist: f.artist || '',
          released_at: c.released_at || '', dfc: c.card_faces && c.card_faces.length > 1 ? 1 : 0,
          name: f.facts.name, type_line: (c.card_faces && c.card_faces[f.i] ? c.card_faces[f.i].type_line : c.type_line) || '',
          oracle_text: (c.card_faces && c.card_faces[f.i] ? c.card_faces[f.i].oracle_text : c.oracle_text) || '' });
      }
    }
    // a token printed on its own before one sharing a card with another (the order otherwise kept)
    for (const k of ['exact', 'size']) out[k] = out[k].map((o, n) => [o, n]).sort((a, b) => a[0].dfc - b[0].dfc || a[1] - b[1]).map(x => x[0]);
    if (out.exact.length) return { list: out.exact, how: 'exact' };
    if (out.size.length) return { list: out.size, how: 'size' };
    return { list: [], how: '' };
  }

  const COLOR_WORD = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };
  /**
   * The Scryfall search that finds every printing that could be this token: the name, the colours, the size
   * (or star/star), and each keyword. What comes back is checked word for word (options); this only narrows it.
   */
  function query(card, face) {
    const f = facts(card, face);
    // its types (which name a token with no name of its own, however it was printed), and a name of its own
    const parts = ['t:token'].concat(f.typeWords.filter(w => /^[a-z][a-z'-]*$/.test(w)).map(w => 't:' + w.replace(/'/g, '')),
      f.nameKey ? ['!"' + f.name.replace(/"/g, '') + '"'] : [], ['c=' + (f.colors ? f.colors.toLowerCase() : 'c')]);
    const [p, t] = f.pt.split('/');
    if (/^\d+$/.test(p || '') && /^\d+$/.test(t || '')) parts.push(`(pow=${p} or pow=*)`, `(tou=${t} or tou=*)`);
    for (const k of f.kws) if (/^[a-z][a-z ]*$/.test(k) && k.length <= 24) parts.push(k.includes(' ') ? `o:"${k}"` : 'o:' + k);
    parts.push('-is:digital');
    return parts.join(' ');
  }

  /** "1/1 white Spirit · Flying": the token, said briefly (the chooser's line). */
  function describe(card, face) {
    const f = facts(card, face);
    const raw = card && card.card_faces && card.card_faces.length > 1 ? (card.card_faces[face || 0] || {}) : (card || {});
    const cols = f.colors ? f.colors.split('').map(c => COLOR_WORD[c] || c).join(' and ') : 'colorless';
    const type = plain(raw.type_line || '').replace(/^Token\s+/, '');
    const words = String(raw.oracle_text || '').replace(/\s*\([^()]*\)/g, '').replace(/\n+/g, ' · ').trim();
    return [f.pt, cols, f.name, type && !type.endsWith(f.name) ? '(' + type + ')' : ''].filter(Boolean).join(' ') +
      (words ? ' · ' + words : ' · no abilities');
  }

  /** A token of the engine's making, with no picture of its own (a copy of a card has the card's). */
  function drawn(card) {
    if (!card || !(card._isToken || card.layout === 'token')) return false;
    return !(card.image_uris || (card.card_faces || []).some(f => f && f.image_uris));
  }

  /* ---------------- looking them up ---------------- */

  const looked = new Map();      // key -> Promise<{ list, how }>
  /** Every printing that is this token ({ list, how }), from Scryfall (one search, kept for this visit). */
  function lookup(card, face) {
    const k = key(card, face);
    if (looked.has(k)) return looked.get(k);
    const p = Promise.resolve().then(async () => {
      if (!MTG.scry || !MTG.scry.search) return { list: [], how: '' };
      const found = await MTG.scry.search(query(card, face), { unique: 'art', order: 'released', dir: 'desc', max: 175, quiet: true, low: true });
      return options(card, found, face);
    });
    looked.set(k, p);
    p.catch(() => looked.delete(k));
    return p;
  }

  const listeners = new Set();
  const tell = () => { for (const fn of listeners) { try { fn(); } catch (e) { /* one screen's trouble is its own */ } } };
  // pictures that failed to load: whatever shows tokens looks again
  if (MTG.bus) MTG.bus.on('scryfall:images', tell);

  let cache = null, choices = null;
  const cacheMap = () => cache || (cache = (MTG.store && MTG.store.get(CACHE_KEY, {})) || {});
  const choiceMap = () => choices || (choices = (MTG.store && MTG.store.get(CHOICE_KEY, {})) || {});
  const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const offline = () => !!(MTG.scry && MTG.scry.offline) || (typeof navigator !== 'undefined' && navigator.onLine === false);
  const usable = (url) => !!url && (!MTG.scry || !MTG.scry.imageUsable || MTG.scry.imageUsable(url, 'normal'));
  const pending = new Set();

  /**
   * The picture for this token, or null for the drawn frame (none matches, it has not come yet, or it
   * cannot load). The first time a kind of token is seen it is looked up; listeners hear when it comes.
   */
  function url(card, face) {
    const k = key(card, face);
    const mine = choiceMap()[k];
    if (mine) return usable(mine) ? mine : null;
    const m = cacheMap();
    if (has(m, k)) return usable(m[k]) ? m[k] : null;
    if (!pending.has(k) && MTG.scry && MTG.scry.search) {
      pending.add(k);
      lookup(card, face).then((r) => {
        const got = (r.list[0] && r.list[0].url) || '';
        // "none" is only believed from Scryfall itself: offline, the next game asks again
        if (!got && offline()) return;
        delete m[k];
        m[k] = got;
        const keys = Object.keys(m);
        for (let i = 0; i < keys.length - CACHE_MAX; i++) delete m[keys[i]];
        if (MTG.store) MTG.store.set(CACHE_KEY, m);
        tell();
      }).catch(() => { /* offline, or Scryfall said no: the frame will do, and it is asked again next game */ })
        .then(() => pending.delete(k));
    }
    return null;
  }

  /** The art this player chose for this kind of token, or null. */
  const chosen = (card, face) => choiceMap()[key(card, face)] || null;
  /** Remember `opt` (one of lookup's list, or a picture's url) for every token of this kind; null goes back to the default. */
  function choose(card, face, opt) {
    const m = choiceMap(), k = key(card, face);
    const u = opt && (typeof opt === 'string' ? opt : opt.url);
    if (u) m[k] = u; else delete m[k];
    if (MTG.store) MTG.store.set(CHOICE_KEY, m);
    tell();
  }

  MTG.tokenArt = {
    facts, key, compare, options, query, describe, drawn, lookup, url, chosen, choose,
    /** The picture shown with no choice made (null while unknown). */
    defaultUrl(card, face) { const m = cacheMap(), k = key(card, face); return has(m, k) ? (m[k] || null) : null; },
    onChange(fn) { listeners.add(fn); },
    offChange(fn) { listeners.delete(fn); },
    _reset() { cache = null; choices = null; looked.clear(); pending.clear(); },
  };
})(window.MTG);
