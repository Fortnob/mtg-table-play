/* ============================================================
   02a-carddb.js - the card database: Scryfall's bulk card data,
   downloaded once, kept in IndexedDB and searched here.

   With it the bots build their decks, the draft opens its packs and
   the deck builder searches without asking Scryfall anything, which is
   quicker, works offline, and keeps several bots building at once well
   clear of Scryfall's rate limit. Without it everything still works the
   old way, one live request at a time.

   The bulk file is every printing (or one printing per card), close to
   600 MB of JSON. It is kept packed: the rules text of a card once, and
   each printing as a short row that points at it. Image addresses are
   rebuilt from a printing's id rather than stored. The search engine
   reads the subset of Scryfall's query syntax the app itself writes,
   and says so when a query goes beyond it, so the caller can ask
   Scryfall instead.
   ============================================================ */
'use strict';
(function (MTG) {
  const U = MTG.util;
  const API = 'https://api.scryfall.com';
  const DB_NAME = 'mtgtable-carddb';
  const DB_VER = 1;
  const SCHEMA = 1;                       // the packed layout; a change means downloading again
  const ROWS = 4000;                      // rows per stored chunk
  const PART = 4 << 20;                   // bytes per saved piece of a download in progress

  /* The two files worth having. Every printing is what drafts need, since a
     booster is made of one set's printings; one printing per card is a
     third of the size and enough for everything else. */
  const KINDS = {
    default_cards: { path: 'default-cards', name: 'Every printing', blurb: 'Every English printing of every card. Drafts, set lists and the art picker work offline too.' },
    oracle_cards: { path: 'oracle-cards', name: 'One printing per card', blurb: 'One printing of each card. Bots and the deck builder work offline; drafts still ask Scryfall.' },
  };

  /* ---------------- the packed layout ----------------
     A card is a row of fields in a fixed order; a printing is another,
     pointing at its card by number. Arrays rather than objects, because
     IndexedDB would otherwise write every field name a hundred thousand
     times over. */
  const OF = ['oracle_id', 'name', 'layout', 'mana_cost', 'cmc', 'type_line', 'oracle_text', 'colors',
    'color_identity', 'color_indicator', 'keywords', 'power', 'toughness', 'loyalty', 'defense',
    'produced_mana', 'legalities', 'reserved', 'edhrec_rank', 'penny_rank', 'hand_modifier',
    'life_modifier', 'game_changer', 'card_faces', 'all_parts'];
  const FF = ['name', 'mana_cost', 'type_line', 'oracle_text', 'colors', 'color_indicator',
    'power', 'toughness', 'loyalty', 'defense', 'cmc'];
  const PF = ['id', 'oracle', 'set', 'collector_number', 'rarity', 'released_at', 'lang', 'flags',
    'games', 'border_color', 'frame', 'frame_effects', 'promo_types', 'finishes', 'artist',
    'illustration_id', 'flavor_text', 'watermark', 'img', 'faces', 'prices'];
  const ix = (list) => { const o = {}; list.forEach((k, i) => { o[k] = i; }); return o; };
  const O = ix(OF), F = ix(FF), P = ix(PF);

  const FLAG = { digital: 1, booster: 2, full_art: 4, textless: 8, promo: 16, variation: 32,
    reprint: 64, oversized: 128, highres_image: 256, story_spotlight: 512, acorn: 1024 };
  const GAMES = ['paper', 'mtgo', 'arena', 'astral', 'sega'];
  const FINISHES = ['nonfoil', 'foil', 'etched', 'glossy'];
  const LEGAL = { legal: 'l', not_legal: 'n', banned: 'b', restricted: 'r' };
  const LEGAL_BACK = { l: 'legal', n: 'not_legal', b: 'banned', r: 'restricted' };
  const IMG_SIZES = ['small', 'normal', 'large', 'art_crop', 'png'];
  // things that are cards in the database but not cards a search turns up unless asked
  // the reprint lists: real printings, but nobody's idea of what a card looks like
  const REPRINT_LISTS = new Set(['plst', 'plist', 'mb1', 'mb2', 'fmb1', 'sld', 'slc', 'sld2', 'pz1', 'pz2']);
  const EXTRA_LAYOUTS = new Set(['token', 'double_faced_token', 'emblem', 'art_series', 'planar', 'scheme', 'vanguard']);

  const nn = (v) => (v === undefined ? null : v);
  const bits = (list, names) => { let b = 0; for (const x of (list || [])) { const i = names.indexOf(x); if (i >= 0) b |= 1 << i; } return b; };
  const unbits = (b, names) => names.filter((_, i) => b & (1 << i));
  const imgUrl = (id, side, size, ts) =>
    `https://cards.scryfall.io/${size}/${side}/${id[0]}/${id[1]}/${id}.${size === 'png' ? 'png' : 'jpg'}?${ts}`;

  /** The time stamp of a set of image addresses that follow the usual pattern, or null. */
  function imgStamp(iu, id, side) {
    const m = /\?(\d+)$/.exec((iu && iu.normal) || '');
    if (!m) return null;
    for (const s of IMG_SIZES) if (iu[s] !== imgUrl(id, side, s, m[1])) return null;
    return m[1];
  }
  const pickImg = (iu) => iu ? { small: iu.small, normal: iu.normal, large: iu.large, art_crop: iu.art_crop, png: iu.png } : undefined;

  /**
   * Packs Scryfall card objects, one at a time, into the stored layout.
   * Used by the download in the browser and by the tools in Node.
   */
  class Packer {
    constructor(kind) {
      this.kind = kind || 'default_cards';
      this.formats = null;
      this.oracles = [];
      this.prints = [];
      this.sets = {};
      this.oIndex = new Map();
      this.count = 0;
    }
    add(c) {
      if (!c || c.object !== 'card' || !c.id) return;
      this.count++;
      const faces = c.card_faces || null;
      const oid = c.oracle_id || (faces && faces[0] && faces[0].oracle_id) || ('id:' + c.id);
      if (!this.formats && c.legalities) this.formats = Object.keys(c.legalities);
      let oi = this.oIndex.get(oid);
      if (oi === undefined) {
        oi = this.oracles.length;
        this.oIndex.set(oid, oi);
        const row = new Array(OF.length).fill(null);
        for (const k of OF) row[O[k]] = nn(c[k]);
        row[O.oracle_id] = oid;
        row[O.legalities] = this.formats ? this.formats.map(f => LEGAL[(c.legalities || {})[f]] || 'n').join('') : '';
        row[O.card_faces] = faces ? faces.map(f => FF.map(k => nn(f[k]))) : null;
        row[O.all_parts] = c.all_parts ? c.all_parts.map(p => [p.id, p.component, p.name, p.type_line]) : null;
        if (row[O.reserved] === false) row[O.reserved] = null;
        if (row[O.game_changer] === false) row[O.game_changer] = null;
        if (row[O.keywords] && !row[O.keywords].length) row[O.keywords] = null;
        this.oracles.push(row);
      } else if (c.all_parts && !this.oracles[oi][O.all_parts]) {
        this.oracles[oi][O.all_parts] = c.all_parts.map(p => [p.id, p.component, p.name, p.type_line]);
      }
      let flags = 0;
      for (const k of Object.keys(FLAG)) if (c[k] === true) flags |= FLAG[k];
      if (c.security_stamp === 'acorn') flags |= FLAG.acorn;
      // images: a time stamp when the addresses follow the pattern, the addresses themselves when not
      let img = null;
      if (c.image_uris) {
        const ts = imgStamp(c.image_uris, c.id, 'front');
        img = ts ? ts : { top: pickImg(c.image_uris) };
      } else if (faces && faces[0] && faces[0].image_uris) {
        const stamps = faces.map((f, i) => imgStamp(f.image_uris, c.id, i ? 'back' : 'front'));
        img = stamps.every(s => s && s === stamps[0]) ? 'f' + stamps[0] : { faces: faces.map(f => pickImg(f.image_uris) || null) };
      }
      let fx = null;
      if (faces) {
        fx = faces.map(f => [nn(f.artist), nn(f.illustration_id), nn(f.flavor_text), nn(f.watermark)]);
        if (fx.every(r => r.every(v => v == null))) fx = null;
      }
      const pr = c.prices ? [nn(c.prices.usd), nn(c.prices.usd_foil), nn(c.prices.eur), nn(c.prices.tix)] : null;
      const row = [
        c.id, oi, c.set, c.collector_number, c.rarity, c.released_at, c.lang === 'en' ? null : c.lang, flags,
        bits(c.games, GAMES), c.border_color === 'black' ? null : nn(c.border_color), nn(c.frame),
        c.frame_effects && c.frame_effects.length ? c.frame_effects : null,
        c.promo_types && c.promo_types.length ? c.promo_types : null,
        bits(c.finishes, FINISHES), nn(c.artist), nn(c.illustration_id), nn(c.flavor_text), nn(c.watermark),
        img, fx, pr && pr.some(v => v != null) ? pr : null,
      ];
      this.prints.push(row);
      const s = this.sets[c.set] || (this.sets[c.set] = [c.set_name, c.set_type, c.released_at, 0, 0, 0]);
      s[3]++;
      if (c.digital) s[4]++;
      if (c.booster) s[5]++;
      if (c.released_at && (!s[2] || c.released_at < s[2])) s[2] = c.released_at;
    }
    /** One line of a JSONL (or the old one-card-a-line JSON array) file. */
    addLine(line) {
      let t = line.trim();
      if (!t || t === '[' || t === ']') return;
      if (t[0] === '[') t = t.slice(1);
      if (t.endsWith(',')) t = t.slice(0, -1);
      if (t.endsWith(']')) t = t.slice(0, -1);
      if (!t) return;
      this.add(JSON.parse(t));
    }
    finish() {
      return { schema: SCHEMA, kind: this.kind, formats: this.formats || [], oracles: this.oracles, prints: this.prints, sets: this.sets };
    }
  }

  /* ---------------- the query language ----------------
     A recursive descent over Scryfall's syntax: words, key:value terms with
     the usual comparisons, quotes, /regular expressions/, negation, brackets
     and "or". Anything it does not know is an Unsupported error, never a
     silent wrong answer. */
  class Unsupported extends Error {}

  function tokenize(q) {
    const out = [];
    let i = 0;
    const s = String(q || '');
    const readValue = () => {
      if (s[i] === '"') {
        const j = s.indexOf('"', i + 1);
        const v = s.slice(i + 1, j < 0 ? s.length : j);
        i = j < 0 ? s.length : j + 1;
        return { v, quoted: true };
      }
      if (s[i] === '/') {
        let j = i + 1;
        while (j < s.length && s[j] !== '/') j += s[j] === '\\' ? 2 : 1;
        const v = s.slice(i + 1, Math.min(j, s.length));
        i = Math.min(j + 1, s.length);
        return { v, regex: true };
      }
      let j = i;
      while (j < s.length && !/\s/.test(s[j]) && s[j] !== ')') j++;
      const v = s.slice(i, j);
      i = j;
      return { v };
    };
    while (i < s.length) {
      const ch = s[i];
      if (/\s/.test(ch)) { i++; continue; }
      if (ch === '(') { out.push({ t: '(' }); i++; continue; }
      if (ch === ')') { out.push({ t: ')' }); i++; continue; }
      if (ch === '-' && i + 1 < s.length && !/\s/.test(s[i + 1])) { out.push({ t: '-' }); i++; continue; }
      if (ch === '!' && s[i + 1] !== '=') {
        i++;
        const v = readValue();
        out.push({ t: 'term', key: 'name', op: '!', v: v.v, quoted: v.quoted });
        continue;
      }
      if (ch === '"' || ch === '/') {
        const v = readValue();
        out.push({ t: 'term', key: 'name', op: ':', v: v.v, regex: v.regex, quoted: v.quoted });
        continue;
      }
      const m = /^([a-zA-Z_]+)(!=|<=|>=|:|=|<|>)/.exec(s.slice(i, i + 40));
      if (m) {
        i += m[0].length;
        const v = readValue();
        out.push({ t: 'term', key: m[1].toLowerCase(), op: m[2], v: v.v, regex: v.regex, quoted: v.quoted });
        continue;
      }
      const v = readValue();
      if (!v.v) { i++; continue; }
      const low = v.v.toLowerCase();
      if (low === 'or') out.push({ t: 'or' });
      else if (low === 'and') { /* the default anyway */ }
      else out.push({ t: 'term', key: 'name', op: ':', v: v.v });
    }
    return out;
  }

  /** The tree of a query, and the settings it carries (order:, unique: and so on). */
  function parse(q) {
    const toks = tokenize(q);
    const directives = {};
    let i = 0;
    const DIRECTIVE = new Set(['order', 'unique', 'dir', 'include', 'prefer', 'display', 'sort']);
    function orExpr() {
      const items = [andExpr()];
      while (toks[i] && toks[i].t === 'or') { i++; items.push(andExpr()); }
      return items.length === 1 ? items[0] : { type: 'or', items };
    }
    function andExpr() {
      const items = [];
      while (i < toks.length && toks[i].t !== ')' && toks[i].t !== 'or') {
        const u = unary();
        if (u) items.push(u);
      }
      return items.length === 1 ? items[0] : { type: 'and', items };
    }
    function unary() {
      const t = toks[i];
      if (t.t === '-') { i++; const u = unary(); return u ? { type: 'not', item: u } : null; }
      if (t.t === '(') {
        i++;
        const e = orExpr();
        if (toks[i] && toks[i].t === ')') i++;
        return e;
      }
      i++;
      if (t.t === 'term' && DIRECTIVE.has(t.key)) {
        const k = t.key === 'sort' ? 'order' : t.key;
        directives[k] = String(t.v).toLowerCase();
        return null;
      }
      return { type: 'term', key: t.key, op: t.op, v: t.v, regex: !!t.regex, quoted: !!t.quoted };
    }
    let ast = orExpr();
    // a stray closing bracket: carry on with the rest, as Scryfall does
    while (i < toks.length) { i++; const more = orExpr(); ast = { type: 'and', items: [ast, more] }; }
    return { ast, directives };
  }

  /* ---------------- values ---------------- */
  const COLOR_BIT = { w: 1, u: 2, b: 4, r: 8, g: 16 };
  const COLOR_WORDS = {
    white: 'w', blue: 'u', black: 'b', red: 'r', green: 'g', colorless: 'c', colourless: 'c',
    multicolor: 'm', multicolour: 'm', multi: 'm', gold: 'm',
    azorius: 'wu', dimir: 'ub', rakdos: 'br', gruul: 'rg', selesnya: 'gw', orzhov: 'wb', izzet: 'ur',
    golgari: 'bg', boros: 'rw', simic: 'gu', bant: 'gwu', esper: 'wub', grixis: 'ubr', jund: 'brg',
    naya: 'rgw', abzan: 'wbg', jeskai: 'urw', sultai: 'bgu', mardu: 'rwb', temur: 'gur',
    silverquill: 'wb', prismari: 'ur', witherbloom: 'bg', lorehold: 'rw', quandrix: 'gu',
  };
  const colorBits = (list) => { let b = 0; for (const c of (list || [])) b |= COLOR_BIT[String(c).toLowerCase()] || 0; return b; };
  const popcount = (b) => { let n = 0; while (b) { n += b & 1; b >>= 1; } return n; };
  function parseColors(v) {
    let s = String(v).toLowerCase().replace(/[{}\s]/g, '');
    if (/^\d+$/.test(s)) return { count: parseInt(s, 10) };
    if (COLOR_WORDS[s]) s = COLOR_WORDS[s];
    if (s === 'm') return { multi: true };
    if (s === 'c') return { bits: 0 };
    if (!/^[wubrg]+$/.test(s)) throw new Unsupported('colour "' + v + '"');
    let b = 0;
    for (const ch of s) b |= COLOR_BIT[ch];
    return { bits: b };
  }
  function cmpNum(a, op, b) {
    switch (op) {
      case ':': case '=': return a === b;
      case '!=': return a !== b;
      case '<': return a < b;
      case '>': return a > b;
      case '<=': return a <= b;
      case '>=': return a >= b;
    }
    return false;
  }
  /** Card colours against a colour value. `within` makes ':' mean "fits inside" (identity). */
  function colorTest(val, op, within) {
    if (val.count != null) return (b) => cmpNum(popcount(b), op === ':' ? '=' : op, val.count);
    if (val.multi) {
      if (op === ':' || op === '=' || op === '>=') return (b) => popcount(b) >= 2;
      if (op === '!=' || op === '<') return (b) => popcount(b) < 2;
      throw new Unsupported('colour comparison');
    }
    const v = val.bits;
    let o = op;
    if (o === ':') o = within ? '<=' : (v === 0 ? '=' : '>=');
    switch (o) {
      case '=': return (b) => b === v;
      case '!=': return (b) => b !== v;
      case '>=': return (b) => (b & v) === v;
      case '<=': return (b) => (b & ~v) === 0;
      case '>': return (b) => (b & v) === v && b !== v;
      case '<': return (b) => (b & ~v) === 0 && b !== v;
    }
    throw new Unsupported('colour comparison');
  }
  const RARITY = { common: 0, c: 0, uncommon: 1, u: 1, rare: 2, r: 2, special: 3, s: 3, mythic: 4, m: 4, bonus: 5, b: 5 };
  const RARITY_RANK = { common: 0, uncommon: 1, rare: 2, special: 3, mythic: 4, bonus: 5 };
  const statNum = (v) => {
    if (v == null) return null;
    const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };
  const stripReminder = (t) => t.replace(/\([^)]*\)/g, '');
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const lc = (s) => String(s == null ? '' : s).toLowerCase();
  // names ignore punctuation, so "jaces" and "jace's" find the same card
  const bare = (s) => U.normName(s).replace(/[^a-z0-9 ]+/g, '');
  const PERMANENT = /\b(Artifact|Creature|Enchantment|Land|Planeswalker|Battle)\b/;
  const slugOf = (n) => lc(n).normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  /* ---------------- the searchable index ----------------
     Built in memory from the packed rows. Everything a search compares is
     worked out once here — lower-cased text, colour bit masks, numbers —
     so a query over a hundred thousand printings is a quick loop. */
  class Index {
    constructor(data, info) {
      this.info = info || {};
      this.kind = data.kind;
      this.formats = data.formats;
      this.fmtIx = ix(data.formats);
      this.O = data.oracles;
      this.P = data.prints;
      this.setTable = data.sets;
      this.cache = new Map();            // printing index -> card object
      this.legalCache = new Map();
      this.results = new Map();          // query -> printing indices
      this.R = new Array(this.O.length);
      this.byId = new Map();
      this.byOracle = new Map();
      this.names = new Map();
      this.setCn = null;
      const prints = this.O.map(() => []);
      for (let pi = 0; pi < this.P.length; pi++) {
        const p = this.P[pi];
        this.byId.set(p[P.id], pi);
        prints[p[P.oracle]].push(pi);
      }
      for (let oi = 0; oi < this.O.length; oi++) {
        const o = this.O[oi];
        const faces = o[O.card_faces] || [];
        const texts = o[O.oracle_text] != null ? [o[O.oracle_text]] : faces.map(f => f[F.oracle_text] || '');
        const text = texts.join('\n');
        const front = faces[0];
        const pw = [], tg = [], ly = [], df = [];
        // the number to compare, and the printed value beside it for pow=* and the like
        const add = (arr, v) => { if (v != null) { arr.push(statNum(v)); (arr.raw || (arr.raw = [])).push(String(v).toLowerCase()); } };
        add(pw, o[O.power]); add(tg, o[O.toughness]); add(ly, o[O.loyalty]); add(df, o[O.defense]);
        for (const f of faces) { add(pw, f[F.power]); add(tg, f[F.toughness]); add(ly, f[F.loyalty]); add(df, f[F.defense]); }
        const type = o[O.type_line] || faces.map(f => f[F.type_line] || '').join(' // ');
        const r = {
          oi, name: o[O.name], nameL: U.normName(o[O.name]), nameB: bare(o[O.name]),
          faceNames: faces.map(f => U.normName(f[F.name])),
          type: lc(type), typeRaw: type,
          text: lc(stripReminder(text)), full: lc(text), textRaw: text,
          kw: (o[O.keywords] || []).map(lc),
          // the whole card's colours (both faces of a double-faced card), then each face's own:
          // Scryfall counts a colour search as a match when any of them fits
          cs: [o[O.colors] != null ? colorBits(o[O.colors]) : faces.reduce((b, f) => b | colorBits(f[F.colors]), 0)]
            .concat(faces.filter(f => f[F.colors] != null).map(f => colorBits(f[F.colors]))),
          id: colorBits(o[O.color_identity]),
          cind: colorBits(o[O.color_indicator] || (front && front[F.color_indicator])),
          cmc: o[O.cmc] != null ? o[O.cmc] : (front && front[F.cmc]) || 0,
          pow: pw, tou: tg, loy: ly, def: df,
          mana: o[O.mana_cost] != null ? o[O.mana_cost] : faces.map(f => f[F.mana_cost] || '').join(' // '),
          edh: o[O.edhrec_rank] != null ? o[O.edhrec_rank] : Infinity,
          extra: EXTRA_LAYOUTS.has(o[O.layout]),
          prints: prints[oi],
          tilde: null,
        };
        this.R[oi] = r;
        this.byOracle.set(o[O.oracle_id], oi);
      }
      // each card's printings, the one to show first at the front
      for (const r of this.R) {
        if (r.prints.length < 2) continue;
        const score = new Map(r.prints.map(pi => [pi, this._prefer(pi)]));
        r.prints.sort((a, b) => (score.get(b) - score.get(a)) ||
          String(this.P[b][P.released_at] || '').localeCompare(String(this.P[a][P.released_at] || '')) ||
          cnCompare(this.P[a][P.collector_number], this.P[b][P.collector_number]));
      }
      // names: a real card wins a name it shares with a token
      for (let pass = 0; pass < 2; pass++) {
        for (const r of this.R) {
          if ((pass === 0) === r.extra) continue;
          for (const k of [r.nameL, ...r.faceNames]) if (k && !this.names.has(k)) this.names.set(k, r.oi);
        }
      }
    }

    get cardCount() { return this.O.length; }
    get printCount() { return this.P.length; }
    get hasPrintings() { return this.kind !== 'oracle_cards'; }

    /** How much a printing is the one people mean by the card's name. */
    _prefer(pi) {
      const p = this.P[pi];
      const f = p[P.flags];
      const st = (this.setTable[p[P.set]] || [])[1];
      const fe = p[P.frame_effects] || [];
      let s = 0;
      if (!p[P.lang]) s += 1 << 12;
      if (!(f & FLAG.digital)) s += 1 << 11;
      if (p[P.games] & 1) s += 1 << 10;
      if (!(f & FLAG.variation)) s += 1 << 9;
      if (!(f & FLAG.promo)) s += 1 << 8;
      if (!/^(promo|memorabilia|token|alchemy|funny|box|masterpiece|treasure_chest|minigame)$/.test(st || '') &&
        !REPRINT_LISTS.has(p[P.set])) s += 1 << 7;
      if (!p[P.border_color] || p[P.border_color] === 'white') s += 1 << 6;
      if (!fe.some(x => /showcase|extendedart|inverted|etched|fullart|textless|borderless/.test(x))) s += 1 << 5;
      if (!(f & (FLAG.full_art | FLAG.textless))) s += 1 << 4;
      if (!(f & FLAG.oversized)) s += 1 << 3;
      if (f & FLAG.highres_image) s += 1 << 2;
      return s;
    }

    /* ---- card objects ----
       The same shape MTG.scry.slim makes, so nothing downstream can tell a
       card from here from one Scryfall sent. One object per printing per
       session, so a card compares equal to itself. */
    card(pi) {
      if (pi == null || pi < 0) return null;
      let c = this.cache.get(pi);
      if (c) return c;
      const p = this.P[pi], o = this.O[p[P.oracle]];
      const id = p[P.id];
      const setRow = this.setTable[p[P.set]] || [];
      const flags = p[P.flags];
      const pr = p[P.prices];
      c = {
        id, oracle_id: o[O.oracle_id], name: o[O.name], lang: p[P.lang] || 'en', layout: o[O.layout],
        mana_cost: nu(o[O.mana_cost]), cmc: nu(o[O.cmc]), type_line: nu(o[O.type_line]), oracle_text: nu(o[O.oracle_text]),
        colors: nu(o[O.colors]), color_identity: nu(o[O.color_identity]), keywords: o[O.keywords] || [],
        power: nu(o[O.power]), toughness: nu(o[O.toughness]), loyalty: nu(o[O.loyalty]), defense: nu(o[O.defense]),
        produced_mana: nu(o[O.produced_mana]), legalities: this._legal(o[O.legalities]), reserved: !!o[O.reserved],
        set: p[P.set], set_name: setRow[0], set_type: setRow[1], collector_number: p[P.collector_number],
        rarity: p[P.rarity], released_at: p[P.released_at], digital: !!(flags & FLAG.digital), games: unbits(p[P.games], GAMES),
        border_color: p[P.border_color] || 'black', frame: nu(p[P.frame]), frame_effects: nu(p[P.frame_effects]),
        promo_types: nu(p[P.promo_types]), finishes: unbits(p[P.finishes], FINISHES),
        full_art: !!(flags & FLAG.full_art), textless: !!(flags & FLAG.textless),
        artist: nu(p[P.artist]), illustration_id: nu(p[P.illustration_id]), flavor_text: nu(p[P.flavor_text]),
        scryfall_uri: `https://scryfall.com/card/${p[P.set]}/${encodeURIComponent(p[P.collector_number])}/${slugOf(o[O.name])}`,
        edhrec_rank: nu(o[O.edhrec_rank]), penny_rank: nu(o[O.penny_rank]),
        hand_modifier: nu(o[O.hand_modifier]), life_modifier: nu(o[O.life_modifier]),
        prices: pr ? { usd: pr[0], usd_foil: pr[1], eur: pr[2], tix: pr[3] } : null,
        _t: Date.now(),
      };
      if (o[O.game_changer]) c.game_changer = true;
      const img = p[P.img];
      if (typeof img === 'string' && img[0] !== 'f') {
        c.image_uris = {};
        for (const s of IMG_SIZES) c.image_uris[s] = imgUrl(id, 'front', s, img);
      } else if (img && img.top) c.image_uris = img.top;
      const faces = o[O.card_faces];
      if (faces) {
        const fx = p[P.faces];
        c.card_faces = faces.map((f, i) => {
          const out = {};
          for (const k of FF) if (f[F[k]] != null) out[k] = f[F[k]];
          const x = fx && fx[i];
          if (x) {
            if (x[2] != null) out.flavor_text = x[2];
            if (x[0] != null) out.artist = x[0];
            if (x[1] != null) out.illustration_id = x[1];
            if (x[3] != null) out.watermark = x[3];
          }
          if (typeof img === 'string' && img[0] === 'f') {
            out.image_uris = {};
            for (const s of IMG_SIZES) out.image_uris[s] = imgUrl(id, i ? 'back' : 'front', s, img.slice(1));
          } else if (img && img.faces && img.faces[i]) out.image_uris = img.faces[i];
          return out;
        });
      }
      if (o[O.all_parts]) c.all_parts = o[O.all_parts].map(a => ({ id: a[0], component: a[1], name: a[2], type_line: a[3] }));
      this.cache.set(pi, c);
      return c;
    }
    _legal(s) {
      let l = this.legalCache.get(s);
      if (!l) {
        l = {};
        this.formats.forEach((f, i) => { l[f] = LEGAL_BACK[s[i]] || 'not_legal'; });
        Object.freeze(l);
        this.legalCache.set(s, l);
      }
      return l;
    }

    /* ---- lookups ---- */
    byIdCard(id) { const pi = this.byId.get(id); return pi === undefined ? null : this.card(pi); }
    /** A card by name: exact, then without punctuation. Its usual printing. */
    byNameCard(name, set) {
      const key = U.normName(name);
      let oi = this.names.get(key);
      if (oi === undefined) oi = this.names.get(U.normName(U.frontName(name)));
      if (oi === undefined) {
        const b = bare(name);
        if (b.length >= 3) {
          for (const r of this.R) if (r.nameB === b && !r.extra) { oi = r.oi; break; }
        }
      }
      if (oi === undefined) return null;
      const r = this.R[oi];
      if (set) {
        const s = String(set).toLowerCase();
        const pi = r.prints.find(i => this.P[i][P.set] === s);
        return pi === undefined ? null : this.card(pi);
      }
      return this.card(r.prints[0]);
    }
    bySetNumber(set, cn) {
      if (!this.setCn) {
        this.setCn = new Map();
        for (let pi = 0; pi < this.P.length; pi++) {
          const p = this.P[pi];
          const k = p[P.set] + ':' + String(p[P.collector_number]).toLowerCase();
          if (!this.setCn.has(k)) this.setCn.set(k, pi);
        }
      }
      const pi = this.setCn.get(String(set).toLowerCase() + ':' + String(cn).toLowerCase());
      return pi === undefined ? null : this.card(pi);
    }
    autocomplete(q, n) {
      const k = U.normName(q);
      if (k.length < 2) return [];
      const starts = [], within = [];
      for (const r of this.R) {
        if (r.extra) continue;
        if (r.nameL.startsWith(k)) starts.push(r);
        else if (within.length < 40 && r.nameL.includes(k)) within.push(r);
      }
      const by = (a, b) => (a.edh - b.edh) || (a.nameL < b.nameL ? -1 : 1);
      return starts.sort(by).concat(within.sort(by)).slice(0, n || 20).map(r => r.name);
    }
    setList() {
      return Object.entries(this.setTable).map(([code, s]) => ({
        code, name: s[0], set_type: s[1], released_at: s[2], card_count: s[3],
        digital: s[3] > 0 && s[4] === s[3], booster: s[5] > 0,
        icon_svg_uri: `https://svgs.scryfall.io/sets/${code}.svg`, parent_set_code: null, block: null, block_code: null,
      }));
    }

    /* ---- search ---- */
    /**
     * Run a query. Returns printing indices in order, or throws Unsupported
     * when the query asks for something this engine does not do.
     * opts: { unique, order, dir, includeExtras, includeVariations, max }
     */
    query(q, opts) {
      opts = opts || {};
      const key = [q, opts.unique, opts.order, opts.dir, opts.includeExtras, opts.includeVariations].join('\u0001');
      const hit = this.results.get(key);
      if (hit) { this.results.delete(key); this.results.set(key, hit); return hit; }
      const { ast, directives } = parse(q);
      const unique = directives.unique || opts.unique || 'cards';
      const order = directives.order || opts.order || 'name';
      const dir = directives.dir || opts.dir || 'auto';
      if (!/^(cards|art|prints)$/.test(unique)) throw new Unsupported('unique:' + unique);
      const ctx = { extras: false };
      const node = ast ? this._compile(ast, ctx, false) : null;
      const extras = !!(opts.includeExtras || ctx.extras || /extras/.test(directives.include || ''));
      const variations = !!(opts.includeVariations || /variations/.test(directives.include || '') || unique === 'prints');
      const conj = !node ? [] : node.and ? node.items : [node];
      const oF = conj.filter(n => n.lvl === 'o').map(n => n.fn);
      const pF = conj.filter(n => n.lvl !== 'o').map(n => n.fn);
      const out = [];
      const P_ = this.P;
      // unique:art keeps each picture once, from the printing it first appeared in, as Scryfall does
      const seenArt = unique === 'art' ? new Map() : null;
      for (const r of this.R) {
        if (r.extra && !extras) continue;
        let ok = true;
        for (const f of oF) if (!f(r, null)) { ok = false; break; }
        if (!ok) continue;
        for (const pi of r.prints) {
          const p = P_[pi];
          if (!variations && (p[P.flags] & FLAG.variation)) continue;
          let pass = true;
          for (const f of pF) if (!f(r, p)) { pass = false; break; }
          if (!pass) continue;
          if (unique === 'cards') { out.push(pi); break; }
          if (seenArt) {
            const art = p[P.illustration_id] || (p[P.faces] && p[P.faces][0] && p[P.faces][0][1]) || p[P.id];
            const at = seenArt.get(art);
            if (at !== undefined) {
              if (String(p[P.released_at] || '') < String(P_[out[at]][P.released_at] || '')) out[at] = pi;
              continue;
            }
            seenArt.set(art, out.length);
          }
          out.push(pi);
        }
      }
      this._sort(out, order, dir);
      this.results.set(key, out);
      if (this.results.size > 300) this.results.delete(this.results.keys().next().value);
      return out;
    }
    search(q, opts) {
      opts = opts || {};
      const ids = this.query(q, opts);
      const max = opts.max || 175;
      return ids.slice(0, max).map(pi => this.card(pi));
    }

    _sort(list, order, dir) {
      const P_ = this.P, R = this.R;
      const r = (pi) => R[P_[pi][P.oracle]];
      // printings that share a name come newest first
      const byName = (a, b) => {
        const x = r(a).nameL, y = r(b).nameL;
        return x < y ? -1 : x > y ? 1 : String(P_[b][P.released_at] || '').localeCompare(String(P_[a][P.released_at] || ''));
      };
      const bySet = (a, b) => {
        const pa = P_[a], pb = P_[b];
        return (pa[P.set] < pb[P.set] ? -1 : pa[P.set] > pb[P.set] ? 1 : 0) || cnCompare(pa[P.collector_number], pb[P.collector_number]);
      };
      const num = (f) => (a, b) => (f(a) - f(b)) || byName(a, b);
      const price = (pi) => { const pr = P_[pi][P.prices]; const n = pr ? parseFloat(pr[0]) : NaN; return Number.isFinite(n) ? n : Infinity; };
      let cmp, desc = dir === 'desc';
      switch (order) {
        case 'edhrec': cmp = (a, b) => { const x = r(a).edh, y = r(b).edh; return x === y ? byName(a, b) : x < y ? -1 : 1; }; break;
        case 'cmc': case 'mv': cmp = num(pi => r(pi).cmc); break;
        case 'set': cmp = bySet; break;
        case 'released': cmp = (a, b) => String(P_[a][P.released_at] || '').localeCompare(String(P_[b][P.released_at] || '')) || bySet(a, b);
          if (dir === 'auto') desc = true; break;
        case 'rarity': cmp = num(pi => RARITY_RANK[P_[pi][P.rarity]] || 0); if (dir === 'auto') desc = true; break;
        case 'power': cmp = num(pi => (r(pi).pow[0] != null ? r(pi).pow[0] : -99)); break;
        case 'toughness': cmp = num(pi => (r(pi).tou[0] != null ? r(pi).tou[0] : -99)); break;
        case 'color': cmp = num(pi => r(pi).cs[0]); break;
        // white, blue, black, red, green, then several colours, then none; by mana value within each
        case 'colormv': {
          const grp = (b) => { const n = popcount(b); return n === 0 ? 6 : n > 1 ? 5 : [1, 2, 4, 8, 16].indexOf(b); };
          cmp = (a, b) => (grp(r(a).cs[0]) - grp(r(b).cs[0])) || (r(a).cmc - r(b).cmc) || byName(a, b);
          break;
        }
        case 'usd': cmp = num(price); break;
        case 'artist': cmp = (a, b) => String(P_[a][P.artist] || '').localeCompare(String(P_[b][P.artist] || '')) || byName(a, b); break;
        default: cmp = byName;
      }
      list.sort(desc ? (a, b) => cmp(b, a) : cmp);
    }

    /* ---- turning a query tree into tests ----
       Each test is (card, printing) -> boolean and says whether it needs the
       printing at all ('o' = no). A query that is all card-level tests is
       judged once per card rather than once per printing. */
    _compile(n, ctx, neg) {
      if (n.type === 'and' || n.type === 'or') {
        const items = n.items.map(x => this._compile(x, ctx, neg));
        const lvl = items.every(x => x.lvl === 'o') ? 'o' : 'p';
        const fns = items.map(x => x.fn);
        const fn = n.type === 'and'
          ? (r, p) => { for (const f of fns) if (!f(r, p)) return false; return true; }
          : (r, p) => { for (const f of fns) if (f(r, p)) return true; return false; };
        return { lvl, fn, and: n.type === 'and', items };
      }
      if (n.type === 'not') {
        const x = this._compile(n.item, ctx, !neg);
        const f = x.fn;
        return { lvl: x.lvl, fn: (r, p) => !f(r, p) };
      }
      return this._term(n, ctx, neg);
    }

    _term(t, ctx, neg) {
      const key = t.key, op = t.op;
      const raw = String(t.v == null ? '' : t.v);
      const v = raw.toLowerCase();
      const O_ = (fn) => ({ lvl: 'o', fn });
      const P_ = (fn) => ({ lvl: 'p', fn });
      const rx = () => { try { return new RegExp(raw, 'i'); } catch (e) { throw new Unsupported('regex ' + raw); } };
      const nums = (getter) => {
        const other = { pow: 'pow', power: 'pow', tou: 'tou', toughness: 'tou', loy: 'loy', loyalty: 'loy', cmc: 'cmc', mv: 'cmc' }[v];
        if (other) return O_((r) => { const a = getter(r), b = other === 'cmc' ? [r.cmc] : r[other]; return a.some(x => b.some(y => cmpNum(x, op, y))); });
        if (!/^-?\d+(\.\d+)?$/.test(v)) {
          // a printed value such as * or 1+*: the same words, or not
          if (/^[0-9x*+\-²]+$/.test(v) && (op === ':' || op === '=')) return O_((r) => (getter(r).raw || []).includes(v));
          if (/^[0-9x*+\-²]+$/.test(v) && op === '!=') return O_((r) => !(getter(r).raw || []).includes(v));
          throw new Unsupported(key + ' ' + raw);
        }
        const b = parseFloat(v);
        return O_((r) => getter(r).some(x => cmpNum(x, op, b)));
      };
      switch (key) {
        case 'name': case 'n': {
          if (op === '!') {
            const k = U.normName(raw);
            return O_((r) => r.nameL === k || r.faceNames.includes(k));
          }
          if (t.regex) { const re = rx(); return O_((r) => re.test(r.name)); }
          const k = U.normName(raw), b = bare(raw);
          return O_((r) => r.nameL.includes(k) || (b && r.nameB.includes(b)));
        }
        case 'o': case 'oracle': case 'fo': case 'fulloracle': {
          const full = key === 'fo' || key === 'fulloracle';
          if (t.regex) { const re = rx(); return O_((r) => re.test(full ? r.textRaw : stripReminder(r.textRaw))); }
          if (v.includes('~')) return O_((r) => this._tilde(r, full).includes(v));
          return O_(full ? (r) => r.full.includes(v) : (r) => r.text.includes(v));
        }
        case 't': case 'type': {
          if (!neg && /\b(token|emblem|plane|phenomenon|scheme|vanguard|dungeon|card)\b/.test(v)) ctx.extras = true;
          if (t.regex) { const re = rx(); return O_((r) => re.test(r.typeRaw)); }
          // whole words: t:plane is not a planeswalker
          const re = new RegExp('(^|[^a-z])' + esc(v) + '($|[^a-z])');
          return O_((r) => r.type.includes(v) && re.test(r.type));
        }
        case 'kw': case 'keyword':
          return O_((r) => r.kw.includes(v));
        case 'c': case 'color': case 'colour': {
          const test = colorTest(parseColors(v), op, false);
          return O_((r) => r.cs.some(test));
        }
        case 'id': case 'identity': case 'ci': case 'commander': {
          const test = colorTest(parseColors(v), op, true);
          return O_((r) => test(r.id));
        }
        case 'in': throw new Unsupported('in:');
        case 'cmc': case 'mv': case 'manavalue': {
          if (v === 'even' || v === 'odd') { const want = v === 'even' ? 0 : 1; return O_((r) => r.cmc % 2 === want); }
          if (!/^\d+(\.\d+)?$/.test(v)) throw new Unsupported('mana value ' + raw);
          const b = parseFloat(v);
          return O_((r) => cmpNum(r.cmc, op, b));
        }
        case 'pow': case 'power': return nums(r => r.pow);
        case 'tou': case 'toughness': return nums(r => r.tou);
        case 'loy': case 'loyalty': return nums(r => r.loy);
        case 'def': case 'defense': return nums(r => r.def);
        case 'm': case 'mana': {
          const want = manaSymbols(raw);
          return O_((r) => {
            const have = manaSymbols(r.mana);
            for (const [s, n] of want) if ((have.get(s) || 0) < n) return false;
            return op === '=' ? manaTotal(have) === manaTotal(want) : true;
          });
        }
        case 'legal': case 'f': case 'format': case 'banned': case 'restricted': {
          const fi = this.fmtIx[v];
          if (fi === undefined) throw new Unsupported('format ' + raw);
          const want = key === 'banned' ? 'b' : key === 'restricted' ? 'r' : null;
          return O_((r) => { const s = this.O[r.oi][O.legalities][fi]; return want ? s === want : (s === 'l' || s === 'r'); });
        }
        case 'r': case 'rarity': {
          const b = RARITY[v];
          if (b === undefined) throw new Unsupported('rarity ' + raw);
          return P_((r, p) => cmpNum(RARITY_RANK[p[P.rarity]], op, b));
        }
        case 's': case 'set': case 'e': case 'edition': {
          if (!neg) ctx.extras = true;
          return P_((r, p) => p[P.set] === v);
        }
        case 'cn': case 'number': {
          if (/^\d+$/.test(v) && op !== ':' && op !== '=') { const b = parseInt(v, 10); return P_((r, p) => cmpNum(parseInt(p[P.collector_number], 10), op, b)); }
          return P_((r, p) => String(p[P.collector_number]).toLowerCase() === v);
        }
        case 'st': case 'settype':
          return P_((r, p) => ((this.setTable[p[P.set]] || [])[1] || '') === v);
        case 'game': {
          const gi = GAMES.indexOf(v);
          if (gi < 0) throw new Unsupported('game ' + raw);
          return P_((r, p) => !!(p[P.games] & (1 << gi)));
        }
        case 'lang': case 'language': {
          if (v === 'any') return O_(() => true);
          return P_((r, p) => (p[P.lang] || 'en') === v);
        }
        case 'oracleid': {
          if (!neg) ctx.extras = true;
          return O_((r) => this.O[r.oi][O.oracle_id] === v);
        }
        case 'a': case 'artist':
          return P_((r, p) => lc(p[P.artist]).includes(v));
        case 'ft': case 'flavor':
          return P_((r, p) => lc(p[P.flavor_text]).includes(v));
        case 'year': {
          if (!/^\d{4}$/.test(v)) throw new Unsupported('year ' + raw);
          const b = parseInt(v, 10);
          return P_((r, p) => cmpNum(parseInt(String(p[P.released_at] || '0').slice(0, 4), 10), op, b));
        }
        case 'produces': {
          const val = parseColors(v === 'c' ? 'c' : v);
          if (val.bits === 0) return O_((r) => (this.O[r.oi][O.produced_mana] || []).includes('C'));
          const want = val.bits || 0;
          return O_((r) => (colorBits(this.O[r.oi][O.produced_mana]) & want) === want);
        }
        case 'is': case 'not': case 'has': {
          const res = this._is(v, ctx, neg !== (key === 'not'));
          if (key === 'not') { const f = res.fn; return { lvl: res.lvl, fn: (r, p) => !f(r, p) }; }
          return res;
        }
      }
      throw new Unsupported(key + ':');
    }

    _is(v, ctx, neg) {
      const O_ = (fn) => ({ lvl: 'o', fn });
      const P_ = (fn) => ({ lvl: 'p', fn });
      const flag = (b) => P_((r, p) => !!(p[P.flags] & b));
      const layout = (re) => O_((r) => re.test(this.O[r.oi][O.layout] || ''));
      const fe = (re) => P_((r, p) => (p[P.frame_effects] || []).some(x => re.test(x)));
      switch (v) {
        case 'digital': return flag(FLAG.digital);
        case 'paper': return P_((r, p) => !!(p[P.games] & 1));
        case 'booster': return flag(FLAG.booster);
        case 'promo': return flag(FLAG.promo);
        case 'reprint': return flag(FLAG.reprint);
        case 'fullart': return flag(FLAG.full_art);
        case 'textless': return flag(FLAG.textless);
        case 'oversized': return flag(FLAG.oversized);
        case 'variation': return flag(FLAG.variation);
        case 'spotlight': return flag(FLAG.story_spotlight);
        case 'hires': return flag(FLAG.highres_image);
        case 'funny': return P_((r, p) => !!(p[P.flags] & FLAG.acorn) || p[P.border_color] === 'silver' ||
          ((this.setTable[p[P.set]] || [])[1] === 'funny'));
        case 'token': if (!neg) ctx.extras = true; return layout(/^(token|double_faced_token)$/);
        case 'emblem': if (!neg) ctx.extras = true; return layout(/^emblem$/);
        case 'dfc': case 'doublefaced': return layout(/^(transform|modal_dfc|double_faced_token|reversible_card|meld)$/);
        case 'mdfc': case 'modal': return layout(/^modal_dfc$/);
        case 'tdfc': case 'transform': return layout(/^transform$/);
        case 'split': return layout(/^split$/);
        case 'flip': return layout(/^flip$/);
        case 'meld': return layout(/^meld$/);
        case 'adventure': return layout(/^adventure$/);
        case 'leveler': return layout(/^leveler$/);
        case 'saga': return O_((r) => /\bsaga\b/.test(r.type));
        case 'permanent': return O_((r) => PERMANENT.test(r.typeRaw.split('//')[0]));
        case 'spell': return O_((r) => !/\bland\b/.test(r.type.split('//')[0]) && (/\b(instant|sorcery)\b/.test(r.type) || PERMANENT.test(r.typeRaw)));
        case 'historic': return O_((r) => /\b(legendary|artifact|saga)\b/.test(r.type));
        case 'vanilla': return O_((r) => /\bcreature\b/.test(r.type) && !r.textRaw.trim());
        case 'frenchvanilla': return O_((r) => /\bcreature\b/.test(r.type) && !!r.textRaw.trim() &&
          r.textRaw.split('\n').every(l => { const s = l.replace(/\([^)]*\)/g, '').trim().toLowerCase(); return !s || s.split(/,\s*/).every(k => r.kw.includes(k.replace(/ \d+$/, ''))); }));
        case 'reserved': return O_((r) => !!this.O[r.oi][O.reserved]);
        case 'gamechanger': case 'gc': return O_((r) => !!this.O[r.oi][O.game_changer]);
        case 'partner': return O_((r) => r.kw.includes('partner') || /\bpartner\b/.test(r.text));
        case 'companion': return O_((r) => r.kw.includes('companion'));
        case 'commander': return O_((r) => this._commander(r));
        case 'showcase': return fe(/^showcase$/);
        case 'extendedart': case 'extended': return fe(/^extendedart$/);
        case 'etched': return P_((r, p) => !!(p[P.finishes] & 4));
        case 'foil': return P_((r, p) => !!(p[P.finishes] & 2));
        case 'nonfoil': return P_((r, p) => !!(p[P.finishes] & 1));
        case 'borderless': return P_((r, p) => p[P.border_color] === 'borderless');
        case 'colorshifted': return fe(/^colorshifted$/);
      }
      throw new Unsupported('is:' + v);
    }

    /** Can be your commander: a legendary creature, a Background, or a card that says so. */
    _commander(r) {
      const front = r.typeRaw.split('//')[0];
      // the melded half of a meld pair never starts the game anywhere
      const o = this.O[r.oi];
      if (o[O.layout] === 'meld' && (o[O.all_parts] || []).some(a => a[1] === 'meld_result' && a[2] === o[O.name])) return false;
      if (/\bLegendary\b/.test(front) && /\bCreature\b/.test(front)) return true;
      if (/can be your commander/i.test(r.textRaw)) return true;
      // a Background goes in the command zone beside the commander that chose it
      if (/\bLegendary\b/.test(front) && /\bBackground\b/.test(front)) return true;
      // Grist and its like: a creature everywhere but the battlefield
      if (/\bLegendary\b/.test(front) && /isn't on the battlefield, it's a [^.]*creature/i.test(r.textRaw)) return true;
      // the rule since 2025: a legendary Vehicle or Spacecraft with power and toughness
      if (/\bLegendary\b/.test(front) && /\b(Vehicle|Spacecraft)\b/.test(front) && r.pow.length && r.tou.length) return true;
      return false;
    }

    _tilde(r, full) {
      const k = full ? 'tildeFull' : 'tilde';
      if (r[k] == null) {
        let t = full ? r.full : r.text;
        const names = [r.nameL, ...r.faceNames].filter(Boolean).sort((a, b) => b.length - a.length);
        for (const n of names) t = t.split(n).join('~');
        r[k] = t;
      }
      return r[k];
    }
  }

  function cnCompare(a, b) {
    const x = parseInt(a, 10), y = parseInt(b, 10);
    if (x !== y && Number.isFinite(x) && Number.isFinite(y)) return x - y;
    return String(a).localeCompare(String(b));
  }
  function nu(v) { return v === null ? undefined : v; }
  function manaSymbols(s) {
    const m = new Map();
    let str = String(s || '').toUpperCase();
    if (!/[{}]/.test(str)) str = str.replace(/(\d+|[WUBRGCXS])/g, '{$1}');
    for (const x of str.match(/\{[^}]+\}/g) || []) m.set(x, (m.get(x) || 0) + 1);
    return m;
  }
  function manaTotal(m) { let n = 0; for (const v of m.values()) n += v; return n; }

  /* ---------------- IndexedDB ---------------- */
  function openDb() {
    return new Promise((resolve) => {
      if (typeof indexedDB === 'undefined' || !indexedDB) return resolve(null);
      let req;
      try { req = indexedDB.open(DB_NAME, DB_VER); } catch (e) { return resolve(null); }
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const s of ['meta', 'chunks', 'dl']) if (!db.objectStoreNames.contains(s)) db.createObjectStore(s);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    });
  }
  const done = (tx) => new Promise((res, rej) => { tx.oncomplete = () => res(); tx.onerror = () => rej(tx.error); tx.onabort = () => rej(tx.error || new Error('aborted')); });
  const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

  /* ---------------- the database as the app sees it ---------------- */
  const DB = {
    KINDS, Packer, Index, Unsupported, parse,
    idx: null,                 // the Index, once loaded
    info: null,                // what was downloaded, and when
    job: null,                 // a download in progress: { phase, got, total, cards, kind, error }
    latest: null,              // Scryfall's newest file, when checked
    _db: null, _loading: null, _abort: null,

    has() { return !!this.idx; },
    /** Loads the stored database once; resolves true when there is one. */
    ready() {
      if (this.idx) return Promise.resolve(true);
      if (!this._loading) this._loading = this._load().catch((e) => { console.warn('[carddb] could not load', e); return false; });
      return this._loading;
    },
    async _idb() {
      if (this._db === null) this._db = (await openDb()) || false;
      return this._db || null;
    },
    async _load() {
      const db = await this._idb();
      if (!db) return false;
      const info = await reqP(db.transaction('meta').objectStore('meta').get('info'));
      if (!info || info.schema !== SCHEMA) return false;
      const t0 = Date.now();
      const tx = db.transaction('chunks');
      const os = tx.objectStore('chunks');
      const [keys, vals] = await Promise.all([reqP(os.getAllKeys()), reqP(os.getAll())]);
      const data = { kind: info.kind, formats: info.formats, oracles: [], prints: [], sets: {} };
      const order = keys.map((k, i) => [String(k), i]).sort((a, b) => (a[0] < b[0] ? -1 : 1));
      for (const [k, i] of order) {
        if (k[0] === 'o') for (const r of vals[i]) data.oracles.push(r);
        else if (k[0] === 'p') for (const r of vals[i]) data.prints.push(r);
        else if (k === 'sets') data.sets = vals[i];
      }
      if (data.oracles.length !== info.oracles || data.prints.length !== info.prints) {
        console.warn('[carddb] stored database is incomplete; ignoring it');
        return false;
      }
      this.use(data, info);
      this.loadMs = Date.now() - t0;
      return true;
    },
    /** Put packed data to use (the download does this, and so do the Node tools). */
    use(data, info) {
      this.idx = new Index(data, info || { kind: data.kind });
      this.info = info || { kind: data.kind, oracles: data.oracles.length, prints: data.prints.length };
      MTG.bus.emit('carddb:changed', this.status());
      return this.idx;
    },
    status() {
      return {
        present: !!this.idx, info: this.info, job: this.job, latest: this.latest,
        cards: this.idx ? this.idx.cardCount : 0, prints: this.idx ? this.idx.printCount : 0,
      };
    },

    /* ---- the query side, for MTG.scry ---- */
    /** Whether a query is one to answer here rather than ask Scryfall. */
    answers(q, opts) {
      if (!this.idx) return false;
      try {
        const { directives } = parse(q);
        const unique = directives.unique || (opts && opts.unique) || 'cards';
        // one printing per card cannot list a set or a card's printings
        if (!this.idx.hasPrintings && (unique !== 'cards' || /(^|[\s(-])(s|set|e|edition|cn|number|oracleid|is:booster)[:=]/i.test(q))) return false;
        return true;
      } catch (e) { return false; }
    },
    search(q, opts) { return this.idx.search(q, opts); },

    /* ---- Scryfall's list of bulk files ---- */
    async bulkInfo(kind) {
      const res = await fetch(API + '/bulk-data/' + KINDS[kind].path, { headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error('Scryfall: ' + res.status + ' ' + res.statusText);
      const j = await res.json();
      return {
        kind, updated_at: j.updated_at,
        uri: j.jsonl_download_uri || j.download_uri,
        size: j.compressed_size || j.size || 0,
      };
    },
    /** Is there a newer file than the one stored? Resolves to the newer file's details, or null. */
    async checkUpdate() {
      if (!this.info) return null;
      try { this.latest = await this.bulkInfo(this.info.kind); } catch (e) { return null; }
      MTG.bus.emit('carddb:changed', this.status());
      return this.latest && this.latest.updated_at > (this.info.updated_at || '') ? this.latest : null;
    },

    /* ---- downloading ----
       In three steps: the compressed file is fetched in pieces that are
       saved as they arrive (so a closed tab or a dropped connection picks
       up where it left off), then unpacked and packed card by card, then
       written out. The old database stays in use until the new one is
       complete. */
    async download(kind, onProgress) {
      if (this.job && /download|unpack|store/.test(this.job.phase)) return this._jobPromise;
      kind = KINDS[kind] ? kind : 'default_cards';
      const job = this.job = { phase: 'download', kind, got: 0, total: 0, cards: 0, error: null, started: Date.now() };
      const ctl = this._abort = new AbortController();
      const tell = () => { if (onProgress) onProgress(job); MTG.bus.emit('carddb:progress', job); };
      this._jobPromise = (async () => {
        try {
          const db = await this._idb();
          const meta = await this.bulkInfo(kind);
          job.total = meta.size; job.updated_at = meta.updated_at; tell();
          const parts = await this._fetchFile(db, meta, job, ctl.signal, tell);
          job.phase = 'unpack'; job.got = 0; tell();
          const data = await this._unpack(parts, kind, job, ctl.signal, tell);
          job.phase = 'store'; tell();
          const info = {
            schema: SCHEMA, kind, updated_at: meta.updated_at, uri: meta.uri, download: meta.size,
            oracles: data.oracles.length, prints: data.prints.length, formats: data.formats, savedAt: Date.now(),
          };
          if (db) info.stored = await this._write(db, data, info);
          if (db) await this._clearDl(db);
          this.use(data, info);
          this.latest = { kind, updated_at: meta.updated_at, uri: meta.uri, size: meta.size };
          job.phase = 'done'; tell();
          return true;
        } catch (e) {
          job.phase = ctl.signal.aborted ? 'cancelled' : 'error';
          job.error = ctl.signal.aborted ? null : (e && e.message) || String(e);
          tell();
          return false;
        } finally {
          this._abort = null;
          MTG.bus.emit('carddb:changed', this.status());
        }
      })();
      return this._jobPromise;
    },
    cancel() { if (this._abort) this._abort.abort(); },

    async _fetchFile(db, meta, job, signal, tell) {
      // a download already under way for this very file carries on from where it stopped
      let state = db ? await reqP(db.transaction('dl').objectStore('dl').get('state')) : null;
      if (!state || state.uri !== meta.uri) {
        if (db) await this._clearDl(db);
        state = { uri: meta.uri, got: 0, parts: 0 };
      }
      const parts = [];
      if (db && state.parts) {
        const os = db.transaction('dl').objectStore('dl');
        for (let i = 0; i < state.parts; i++) parts.push(await reqP(os.get(i)));
        if (parts.some(p => !p)) { parts.length = 0; state = { uri: meta.uri, got: 0, parts: 0 }; await this._clearDl(db); }
      }
      job.got = state.got; job.resumed = state.got > 0; tell();
      const save = async (buf) => {
        parts.push(buf);
        state.got += buf.byteLength; state.parts = parts.length;
        if (!db) return;
        const tx = db.transaction('dl', 'readwrite');
        tx.objectStore('dl').put(buf, parts.length - 1);
        tx.objectStore('dl').put(state, 'state');
        await done(tx);
      };
      for (let attempt = 0; ; attempt++) {
        try {
          const headers = state.got ? { Range: 'bytes=' + state.got + '-' } : {};
          const res = await fetch(meta.uri, { headers, signal });
          if (!res.ok) throw new Error('The download failed: ' + res.status + ' ' + res.statusText);
          if (state.got && res.status !== 206) {
            // the server sent the whole file again; start over with it
            parts.length = 0; state = { uri: meta.uri, got: 0, parts: 0 };
            if (db) await this._clearDl(db);
          }
          const len = parseInt(res.headers.get('content-length') || '0', 10);
          if (len) job.total = state.got + len;
          const reader = res.body.getReader();
          let pend = [], pendBytes = 0;
          const flush = async () => {
            if (!pendBytes) return;
            const buf = new Uint8Array(pendBytes);
            let o = 0;
            for (const c of pend) { buf.set(c, o); o += c.byteLength; }
            pend = []; pendBytes = 0;
            await save(buf.buffer);
          };
          for (;;) {
            const { done: end, value } = await reader.read();
            if (end) break;
            pend.push(value); pendBytes += value.byteLength;
            job.got = state.got + pendBytes; tell();
            if (pendBytes >= PART) await flush();
          }
          await flush();
          return parts;
        } catch (e) {
          if (signal.aborted) throw e;
          // a dropped connection: try again from the last saved piece
          if (attempt >= 4) throw e;
          job.retry = attempt + 1; tell();
          await U.sleep(1500 * (attempt + 1));
        }
      }
    },

    async _unpack(parts, kind, job, signal, tell) {
      const blob = new Blob(parts);
      const head = new Uint8Array(await blob.slice(0, 2).arrayBuffer());
      const gz = head[0] === 0x1f && head[1] === 0x8b;
      job.total = blob.size;
      let read = 0;
      const counter = new TransformStream({ transform(chunk, ctl) { read += chunk.byteLength; ctl.enqueue(chunk); } });
      let stream = blob.stream().pipeThrough(counter);
      if (gz) {
        if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unpack the download (it has no DecompressionStream).');
        stream = stream.pipeThrough(new DecompressionStream('gzip'));
      }
      const reader = stream.pipeThrough(new TextDecoderStream()).getReader();
      const packer = new Packer(kind);
      let rest = '', last = Date.now();
      for (;;) {
        if (signal.aborted) { reader.cancel(); throw new Error('cancelled'); }
        const { done: end, value } = await reader.read();
        if (end) break;
        const text = rest + value;
        const lines = text.split('\n');
        rest = lines.pop();
        for (const l of lines) packer.addLine(l);
        // let the page breathe: the unpacking is a long loop on the main thread
        if (Date.now() - last > 40) {
          job.got = read; job.cards = packer.count; tell();
          await U.sleep(0);
          last = Date.now();
        }
      }
      if (rest.trim()) packer.addLine(rest);
      job.got = read; job.cards = packer.count; tell();
      if (packer.count < 1000) throw new Error('The download did not look like Scryfall card data.');
      return packer.finish();
    },

    /** Writes the packed rows; returns roughly how many bytes they take. */
    async _write(db, data, info) {
      let tx = db.transaction(['meta', 'chunks'], 'readwrite');
      tx.objectStore('meta').delete('info');
      tx.objectStore('chunks').clear();
      await done(tx);
      let bytes = 0;
      const chunks = [];
      for (let i = 0; i < data.oracles.length; i += ROWS) chunks.push(['o' + String(i / ROWS).padStart(4, '0'), data.oracles.slice(i, i + ROWS)]);
      for (let i = 0; i < data.prints.length; i += ROWS) chunks.push(['p' + String(i / ROWS).padStart(4, '0'), data.prints.slice(i, i + ROWS)]);
      chunks.push(['sets', data.sets]);
      for (let i = 0; i < chunks.length; i += 8) {
        tx = db.transaction('chunks', 'readwrite');
        const os = tx.objectStore('chunks');
        for (const [k, v] of chunks.slice(i, i + 8)) { os.put(v, k); bytes += JSON.stringify(v).length; }
        await done(tx);
        await U.sleep(0);
      }
      info.stored = bytes;
      tx = db.transaction('meta', 'readwrite');
      tx.objectStore('meta').put(info, 'info');
      await done(tx);
      return bytes;
    },
    async _clearDl(db) {
      const tx = db.transaction('dl', 'readwrite');
      tx.objectStore('dl').clear();
      await done(tx);
    },
    /** A download that stopped part way, if there is one: how far it got. */
    async pending() {
      const db = await this._idb();
      if (!db) return null;
      try {
        const s = await reqP(db.transaction('dl').objectStore('dl').get('state'));
        return s && s.got ? s : null;
      } catch (e) { return null; }
    },
    /** Forget the database (and any half-finished download). */
    async remove() {
      this.cancel();
      const db = await this._idb();
      if (db) {
        const tx = db.transaction(['meta', 'chunks', 'dl'], 'readwrite');
        tx.objectStore('meta').clear(); tx.objectStore('chunks').clear(); tx.objectStore('dl').clear();
        await done(tx);
      }
      this.idx = null; this.info = null; this.job = null; this.latest = null; this._loading = null;
      MTG.bus.emit('carddb:changed', this.status());
    },
  };

  MTG.cardDb = DB;
  // read the stored database in once the page has settled, so the first search need not wait for it
  if (typeof indexedDB !== 'undefined' && indexedDB) setTimeout(() => DB.ready(), 1200);
})(window.MTG);
