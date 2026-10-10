/* ============================================================
   05a-decklink.js - a deck as a link
   The whole list packed into the address, after #deck=, so a deck
   can be sent as one link and opened straight into someone's decks.
   No server is involved: whoever has the link has the deck.

   A card is written as its printing, set code and collector number,
   so the art the sender chose comes with it and the link stays short
   (a hundred-card Commander deck is a few hundred characters); a card
   with no printing to name is written by name instead. The cards of a
   set go together, each collector number as its distance from the one
   before, in as few bytes as it fits. That, rather than a general
   compressor, is what makes the link small: there is nothing left over
   for one to find.

   The first character is the version of the packing. A link made today
   must still open after the packing changes, so a new packing takes a
   new version and the readers for the old ones stay (READERS below).
   ============================================================ */
'use strict';
(function (MTG) {
  const VERSION = '1';
  const SECTIONS = ['commanders', 'companion', 'main', 'sideboard'];
  // what a link may ask for, so a hand-made one cannot fill the table with a million cards
  const MAX_COPIES = 250, MAX_CARDS = 1000, MAX_NAME = 100;

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  /* ---------------- bytes ---------------- */
  class Writer {
    constructor() { this.b = []; }
    /** A whole number in as few bytes as it fits: seven bits a byte, the top bit saying more follow. */
    uint(n) {
      n = Math.max(0, Math.floor(n));
      while (n > 127) { this.b.push((n % 128) | 128); n = Math.floor(n / 128); }
      this.b.push(n);
    }
    bytes(u) { for (const x of u) this.b.push(x); }
    str(s) { const u = enc.encode(String(s || '')); this.uint(u.length); this.bytes(u); }
  }
  const broken = () => new Error('This deck link is broken or cut short. Ask for it to be sent again.');
  class Reader {
    constructor(b) { this.b = b; this.i = 0; }
    byte() { if (this.i >= this.b.length) throw broken(); return this.b[this.i++]; }
    uint() {
      let n = 0, mul = 1;
      for (let k = 0; k < 6; k++) {
        const x = this.byte();
        n += (x & 127) * mul;
        if (x < 128) return n;
        mul *= 128;
      }
      throw broken();
    }
    take(n) {
      if (this.i + n > this.b.length) throw broken();
      const out = this.b.slice(this.i, this.i + n);
      this.i += n;
      return out;
    }
    str() { return dec.decode(this.take(this.uint())); }
  }

  /** One byte to catch a link that lost or changed a character on its way. */
  function checkByte(bytes, n) {
    let h = 0;
    for (let i = 0; i < n; i++) h = (h * 31 + bytes[i] + 7) & 255;
    return h;
  }

  /* ---------------- URL-safe text ---------------- */
  /* base64 with - and _ for + and /, and no padding: every character is
     one a link carries as it is, in an address bar, a chat or an email. */
  const ABC = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const ABC_AT = new Map(Array.from(ABC, (c, i) => [c, i]));
  function toText(bytes) {
    let out = '';
    for (let i = 0; i < bytes.length; i += 3) {
      const n = (bytes[i] << 16) | ((bytes[i + 1] || 0) << 8) | (bytes[i + 2] || 0);
      out += ABC[(n >> 18) & 63] + ABC[(n >> 12) & 63];
      if (i + 1 < bytes.length) out += ABC[(n >> 6) & 63];
      if (i + 2 < bytes.length) out += ABC[n & 63];
    }
    return out;
  }
  function fromText(s) {
    const out = [];
    let acc = 0, bits = 0;
    for (const c of s) {
      const v = ABC_AT.get(c);
      if (v == null) throw broken();
      acc = (acc << 6) | v; bits += 6;
      if (bits >= 8) { bits -= 8; out.push((acc >> bits) & 255); }
    }
    return Uint8Array.from(out);
  }

  /* ---------------- a deck's cards, as the link holds them ---------------- */

  /** A collector number that is a plain number goes in as one; "123a", "★1" and their kind as text. */
  const plainNumber = (cn) => /^(0|[1-9]\d{0,8})$/.test(String(cn));

  /** [{qty, card}] -> groups by set, the copies of one printing added together. */
  function groupsOf(list) {
    const bySet = new Map();
    const byName = new Map();
    for (const e of list) {
      const c = e && e.card;
      const qty = Math.max(1, Math.floor((e && e.qty) || 1));
      if (!c) continue;
      if (c.set && c.collector_number != null && c.collector_number !== '') {
        const set = String(c.set).toLowerCase(), cn = String(c.collector_number);
        if (!bySet.has(set)) bySet.set(set, new Map());
        const m = bySet.get(set);
        m.set(cn, (m.get(cn) || 0) + qty);
      } else if (c.name) {
        byName.set(c.name, (byName.get(c.name) || 0) + qty);
      }
    }
    const out = [];
    for (const [set, m] of bySet) {
      const nums = [], texts = [];
      for (const [cn, qty] of m) (plainNumber(cn) ? nums : texts).push({ cn, qty });
      nums.sort((a, b) => Number(a.cn) - Number(b.cn));
      out.push({ set, entries: nums.concat(texts) });
    }
    if (byName.size) out.push({ set: '', entries: Array.from(byName, ([name, qty]) => ({ name, qty })) });
    return out;
  }

  function sectionList(deck, key) {
    if (key === 'commanders') return (deck.commanders || []).map(card => ({ card, qty: 1 }));
    if (key === 'companion') return deck.companion ? [{ card: deck.companion, qty: 1 }] : [];
    return (deck[key] || []).slice();
  }

  /**
   * The deck as the text after #deck=: its name, format, commanders,
   * companion, main deck and sideboard. What it was printed in comes too;
   * the maybeboard, the cover and the art choices stay behind.
   */
  function encode(deck) {
    const w = new Writer();
    w.str(deck.format || '');
    w.str(Array.from(String(deck.name || '').trim()).slice(0, MAX_NAME).join(''));
    for (const key of SECTIONS) {
      const groups = groupsOf(sectionList(deck, key));
      w.uint(groups.length);
      for (const g of groups) {
        w.str(g.set);
        w.uint(g.entries.length);
        let prev = 0;
        for (const e of g.entries) {
          const many = e.qty > 1 ? 2 : 0;
          if (!g.set) { w.uint(e.qty - 1); w.str(e.name); continue; }
          /* low bit: the number is text; next bit: more than one copy;
             the rest: how far the number is from the one before, or how
             long the text is */
          if (plainNumber(e.cn)) {
            const n = Number(e.cn);
            w.uint((n - prev) * 4 + many);
            prev = n;
          } else {
            const u = enc.encode(e.cn);
            w.uint(u.length * 4 + many + 1);
            if (many) w.uint(e.qty - 2);
            w.bytes(u);
            continue;
          }
          if (many) w.uint(e.qty - 2);
        }
      }
    }
    w.b.push(checkByte(w.b, w.b.length));
    return VERSION + toText(w.b);
  }

  /* ---------------- reading a link ---------------- */

  /**
   * The readers, one for each version a link has ever been written in.
   * Each turns the bytes into the same plain shape:
   *   { name, format, commanders, companion, main, sideboard }, each
   * section a list of { qty, set, cn } or { qty, name }.
   */
  const READERS = {
    1(r) {
      const out = { name: '', format: '', commanders: [], companion: [], main: [], sideboard: [] };
      out.format = r.str();
      out.name = r.str();
      let cards = 0;
      const count = (qty) => {
        if (qty > MAX_COPIES) throw new Error(`This deck link asks for ${qty} copies of one card, which is more than a deck can hold.`);
        cards += qty;
        if (cards > MAX_CARDS) throw new Error('This deck link holds more cards than any deck can.');
        return qty;
      };
      for (const key of SECTIONS) {
        const groups = r.uint();
        for (let g = 0; g < groups; g++) {
          const set = r.str();
          const n = r.uint();
          let prev = 0;
          for (let k = 0; k < n; k++) {
            if (!set) { const qty = count(r.uint() + 1); out[key].push({ qty, name: r.str() }); continue; }
            const head = r.uint();
            const many = Math.floor(head / 2) % 2 === 1;
            const isText = head % 2 === 1;
            const rest = Math.floor(head / 4);
            const qty = count(many ? r.uint() + 2 : 1);
            let cn;
            if (isText) cn = dec.decode(r.take(rest));
            else { prev += rest; cn = String(prev); }
            out[key].push({ qty, set, cn });
          }
        }
      }
      return out;
    },
  };

  /** The text after #deck= -> the deck it holds (see READERS). Throws, in words for the player, when it cannot. */
  function decode(text) {
    text = String(text || '').trim();
    const version = text.charAt(0);
    const read = READERS[version];
    if (!read) {
      throw new Error(version && /[2-9A-Za-z]/.test(version)
        ? 'This deck link was made by a newer version of the table. Reload the page to update it, then open the link again.'
        : 'That is not a deck link.');
    }
    // whatever a chat tacked on after it (a full stop, a closing bracket) is not part of the deck
    const bytes = fromText(text.slice(1).replace(/[^A-Za-z0-9_-][\s\S]*$/, ''));
    if (bytes.length < 2 || bytes[bytes.length - 1] !== checkByte(bytes, bytes.length - 1)) throw broken();
    const r = new Reader(bytes.subarray(0, bytes.length - 1));
    const out = read(r);
    if (r.i !== r.b.length) throw broken();
    out.version = Number(version) || version;
    out.size = SECTIONS.reduce((n, k) => n + out[k].reduce((a, e) => a + e.qty, 0), 0);
    return out;
  }

  /** The deck's text out of an address's #fragment, or null when there is none. */
  function fromHash(hash) {
    const m = /(?:^#|[#&])deck=([^&]*)/.exec(String(hash || ''));
    if (!m) return null;
    try { return decodeURIComponent(m[1]); } catch (e) { return m[1]; }
  }

  /** The link itself: this page's address with the deck after it. */
  function url(deck, base) {
    const here = base || (typeof location !== 'undefined' ? String(location.href).split('#')[0] : '');
    return here + '#deck=' + encode(deck);
  }

  /**
   * A decoded link as a real deck: its cards looked up (the card database,
   * the cache, then Scryfall). Resolves { deck, missing }, missing being
   * [{name, qty}] for whatever could not be found.
   */
  async function resolve(data, opts) {
    opts = opts || {};
    const flat = [];
    for (const key of SECTIONS) for (const e of data[key]) flat.push({ key, e });
    const ids = flat.map(({ e }) => e.name ? { name: e.name } : { set: e.set, collector_number: e.cn });
    const { cards } = await MTG.scry.collection(ids, opts.onProgress);
    const deck = {
      id: MTG.uid('deck'), name: data.name || 'Shared deck', format: data.format,
      main: [], sideboard: [], commanders: [], companion: null,
      source: 'link', createdAt: Date.now(),
    };
    const missing = [];
    flat.forEach(({ key, e }, i) => {
      const card = cards[i];
      if (!card) { missing.push({ name: e.name || `${String(e.set).toUpperCase()} #${e.cn}`, qty: e.qty }); return; }
      if (key === 'commanders') deck.commanders.push(card);
      else if (key === 'companion') deck.companion = card;
      else {
        const had = deck[key].find(x => x.card.id === card.id);
        if (had) had.qty += e.qty; else deck[key].push({ card, qty: e.qty });
      }
    });
    return { deck, missing };
  }

  MTG.decklink = { VERSION, encode, decode, fromHash, url, resolve };
})(window.MTG);
