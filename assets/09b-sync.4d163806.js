/* ===== 09b-sync.js ===== */
/* ============================================================
   09b-sync.js - keeping a guest's table up to date, cheaply

   A view of the game is mostly the same as the last one: one land has
   turned sideways, priority has moved on. And most of a view, by weight,
   is the card text and image links of every card on the table, which
   never change at all. So a guest is sent

     - each card's data once, the first time it sees that card, and after
       that a short key standing in for it;
     - each view as the difference from the last one it has said it has
       (an ack), field by field, with lists of things matched up by id;
     - a whole view now and then anyway, and whenever it asks for one
       because something did not add up;
     - the game's events since the last view, which is what its table
       animates from and what its log is built from.

   The host keeps one Encoder per guest; the guest keeps one Decoder. A
   message is

     { t: 'sv', g, n, b, p | s, c, e, l }

   g  which game (a new game starts the stream again)
   n  this view's number, per guest
   b  the number of the view this is a difference from (absent: whole view)
   p  the difference;  s  the whole view (with cards as keys)
   c  card data the guest has not had yet, by key
   e  events since the last message; l  the log, with whole views only
   ============================================================ */
'use strict';
(function (MTG) {
  const U = MTG.util;

  const FULL_EVERY = 200;         // a whole view at least this often (in messages)
  const KEEP_BASES = 24;          // how many recent views a guest holds on to

  /* ---------------- card keys ----------------
     A card's key is a hash of what it says, worked out once per card
     object. The same printing fetched twice is the same card; the card
     cache's note of when it fetched it is left out. */
  const keys = new WeakMap();
  const noStamp = (k, v) => (k === '_t' ? undefined : v);
  function cardKey(card) {
    let k = keys.get(card);
    if (!k) { k = U.hash(JSON.stringify(card, noStamp)) + (card.id ? String(card.id).slice(0, 4) : ''); keys.set(card, k); }
    return k;
  }
  const CARD_FIELDS = new Set(['card', 'printedCard']);

  /** A copy of `x` with every card swapped for its key; new cards are put in `out`. */
  function strip(x, known, out) {
    if (x == null || typeof x !== 'object') return x;
    if (Array.isArray(x)) return x.map(v => strip(v, known, out));
    const r = {};
    for (const k in x) {
      const v = x[k];
      if (v === undefined || typeof v === 'function') continue;
      if (CARD_FIELDS.has(k) && v && typeof v === 'object' && !Array.isArray(v)) {
        const key = cardKey(v);
        if (!known.has(key)) { known.add(key); out[key] = v; }
        r[k] = '~' + key;
      } else r[k] = strip(v, known, out);
    }
    return r;
  }
  /** The other way: keys back into cards. Always a fresh copy, so the table may do as it likes with it. */
  function dress(x, cards) {
    if (x == null || typeof x !== 'object') return x;
    if (Array.isArray(x)) return x.map(v => dress(v, cards));
    const r = {};
    for (const k in x) {
      const v = x[k];
      if (CARD_FIELDS.has(k) && typeof v === 'string' && v[0] === '~') r[k] = cards.get(v.slice(1)) || null;
      else r[k] = dress(v, cards);
    }
    return r;
  }

  /* ---------------- differences ----------------
     A patch mirrors the shape of what it changes. A plain object is a set
     of changes to an object's fields; an array is an instruction:
       ['=', value]          replace with this
       ['-']                 take this field away
       ['#', order, {id: patch}]
                             a list of things with ids: the new order
                             (0 if it has not changed), and the changes to
                             each, new ones as ['=', thing] */
  const isObj = (x) => x !== null && typeof x === 'object' && !Array.isArray(x);
  function equal(a, b) {
    if (a === b) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
    if (Array.isArray(a) !== Array.isArray(b)) return false;
    if (Array.isArray(a)) {
      if (a.length !== b.length) return false;
      for (let i = 0; i < a.length; i++) if (!equal(a[i], b[i])) return false;
      return true;
    }
    for (const k in a) if (a[k] !== undefined && !equal(a[k], b[k])) return false;
    for (const k in b) if (b[k] !== undefined && a[k] === undefined) return false;
    return true;
  }
  function keyed(list) {
    if (!list.length) return null;
    const m = new Map();
    for (const x of list) {
      if (!isObj(x) || (typeof x.id !== 'string' && typeof x.id !== 'number') || m.has(x.id)) return null;
      m.set(x.id, x);
    }
    return m;
  }
  function diff(a, b) {
    if (a === b) return undefined;
    if (Array.isArray(a) && Array.isArray(b)) {
      const am = keyed(a), bm = am && keyed(b);
      if (am && bm) {
        const order = b.map(x => x.id);
        const sameOrder = a.length === b.length && a.every((x, i) => x.id === order[i]);
        const ch = {};
        let any = false;
        for (const x of b) {
          const y = am.get(x.id);
          const d = y ? diff(y, x) : ['=', x];
          if (d !== undefined) { ch[x.id] = d; any = true; }
        }
        if (sameOrder && !any) return undefined;
        return ['#', sameOrder ? 0 : order, ch];
      }
      return equal(a, b) ? undefined : ['=', b];
    }
    if (isObj(a) && isObj(b)) {
      let out;
      for (const k in b) {
        if (b[k] === undefined) continue;
        const d = a[k] === undefined ? ['=', b[k]] : diff(a[k], b[k]);
        if (d !== undefined) (out || (out = {}))[k] = d;
      }
      for (const k in a) if (a[k] !== undefined && b[k] === undefined) (out || (out = {}))[k] = ['-'];
      return out;
    }
    return equal(a, b) ? undefined : ['=', b];
  }
  function apply(a, p) {
    if (p === undefined) return a;
    if (Array.isArray(p)) {
      if (p[0] === '=') return p[1];
      if (p[0] === '#') {
        const base = new Map((a || []).map(x => [x.id, x]));
        const order = p[1] || (a || []).map(x => x.id);
        return order.map(id => {
          const d = p[2][id];
          return d === undefined ? base.get(id) : apply(base.get(id), d);
        });
      }
      return a;
    }
    const out = Object.assign({}, a || {});
    for (const k in p) {
      const d = p[k];
      if (Array.isArray(d) && d[0] === '-') delete out[k];
      else out[k] = apply(out[k], d);
    }
    return out;
  }

  /** Everything in a view that is state, rather than news. */
  function stateOf(view) {
    const s = Object.assign({}, view);
    delete s.events; delete s.eventSeq; delete s.log;
    return s;
  }

  /* ---------------- the host's side ---------------- */
  class Encoder {
    constructor() {
      this.known = new Set();       // card keys this guest has
      this.n = 0;
      this.sent = new Map();        // n -> stripped view, until acknowledged
      this.acked = null;            // {n, view}
      this.floor = 0;               // the last whole view sent: no difference is taken from anything older
      this.sinceFull = 0;
      this.game = null;
      this.wantFull = true;
      this.wantLog = true;
    }
    /** Build the message that brings this guest up to `view`. */
    encode(view) {
      const g = String(view.game || (view.config ? view.config.seed : ''));
      if (g !== this.game) { this.game = g; this.wantFull = true; this.wantLog = true; this.sent.clear(); this.acked = null; }
      const cards = {};
      const state = strip(stateOf(view), this.known, cards);
      const events = view.events ? strip(view.events, this.known, cards) : null;
      const n = ++this.n;
      const msg = { t: 'sv', g, n };
      /* The base is the newest view the guest has said it has — unless a
         whole view has gone out since, which the guest drops everything
         older for. Until that one is acknowledged it is the base itself:
         the channel delivers in order, so it is there before this is, and
         if it somehow is not, the guest asks again. */
      const base = this.acked && this.acked.n >= this.floor ? this.acked
        : this.floor && this.sent.has(this.floor) ? { n: this.floor, view: this.sent.get(this.floor) } : null;
      if (!this.wantFull && base && this.sinceFull < FULL_EVERY) {
        msg.b = base.n;
        msg.p = diff(base.view, state) || {};
        this.sinceFull++;
      } else {
        msg.s = state;
        // the log only when the guest is starting over; otherwise it has it already, from the events
        if (this.wantLog) msg.l = (view.log || []).slice(-150);
        this.wantLog = false;
        this.sinceFull = 0;
        this.wantFull = false;
        this.floor = n;
      }
      if (Object.keys(cards).length) msg.c = cards;
      if (events) { msg.e = events; msg.es = view.eventSeq; } else msg.e = null;
      this.sent.set(n, state);
      while (this.sent.size > KEEP_BASES * 2) {
        const k = this.sent.keys().next().value;
        if (k === this.floor) break;
        this.sent.delete(k);
      }
      return msg;
    }
    /** The guest has view `n`: later differences can be taken from it. */
    ack(n) {
      if (this.acked && n <= this.acked.n) return;
      const view = this.sent.get(n);
      if (!view) return;
      this.acked = { n, view };
      for (const k of Array.from(this.sent.keys())) if (k < n) this.sent.delete(k);
    }
    /** Something went wrong at the other end: the next message is a whole view. */
    resync() { this.wantFull = true; this.wantLog = true; }
  }

  /* ---------------- the guest's side ---------------- */
  class Decoder {
    constructor() {
      this.cards = new Map();
      this.views = new Map();       // n -> stripped view
      this.last = 0;
      this.game = null;
      this.log = [];
      this.eventSeq = null;
    }
    /**
     * Read one message. Returns { view, ack } with the whole view rebuilt,
     * or { resync: true } when this message cannot be read on top of what
     * is held (and a whole view has to be asked for).
     */
    decode(msg) {
      if (msg.c) for (const k in msg.c) this.cards.set(k, msg.c[k]);
      if (msg.g !== this.game) {
        // a new game: nothing held is any use as a base
        if (!msg.s) { const first = !this.asked; this.asked = true; return { resync: first, skip: true }; }
        this.game = msg.g; this.views.clear(); this.log = []; this.eventSeq = null;
      }
      let state;
      if (msg.s) { state = msg.s; this.asked = false; }
      else {
        /* A difference from a view this side does not have cannot be read.
           One whole view is asked for, and anything that arrives before it
           is let go. A gap in the numbering on its own is no reason: a
           difference is from the view it names, whatever came between. */
        const base = this.views.get(msg.b);
        if (!base) { const first = !this.asked; this.asked = true; return { resync: first, skip: true }; }
        state = apply(base, msg.p);
      }
      this.last = msg.n;
      this.views.set(msg.n, state);
      // the host never goes back further than the base it has just used
      const floor = msg.b != null ? msg.b : msg.n;
      for (const k of Array.from(this.views.keys())) if (k < floor) this.views.delete(k);
      while (this.views.size > KEEP_BASES) this.views.delete(this.views.keys().next().value);
      const view = dress(state, this.cards);
      let events = msg.e ? dress(msg.e, this.cards) : null;
      // events are a stream: a hole in it means the table should not trust them
      if (events && events.length && this.eventSeq != null && events[0].seq > this.eventSeq + 1) events = null;
      if (msg.es != null) this.eventSeq = msg.es;
      else if (events && events.length) this.eventSeq = events[events.length - 1].seq;
      view.events = events;
      if (msg.l) this.log = msg.l.slice();
      else if (events) for (const e of events) if (e.type === 'log') this.log.push({ turn: e.turn, type: e.kind, text: e.text });
      if (this.log.length > 300) this.log.splice(0, this.log.length - 200);
      view.log = this.log.slice(-200);
      return { view, ack: msg.n };
    }
  }

  MTG.sync = { Encoder, Decoder, diff, apply, strip, dress, cardKey, equal, stateOf };
})(window.MTG);
