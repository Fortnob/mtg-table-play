/* ============================================================
   06c-replay.js - games on the record

   The engine is a deterministic machine: the same seed, the same decks and
   the same actions in the same order give the same game, card for card.
   So a whole game can be kept as very little — how it was set up, and
   every action anybody took — and played again later, to watch, or to
   walk a bug report up to the turn where it went wrong.

   Recording happens at the engine's own door. People act through the
   table, bots call the engine directly, and both end up calling the same
   handful of Game methods, so those are what is wrapped: the outermost
   call of each is written down with its arguments, as data. Calls the
   engine makes to itself while handling one are not, because playing the
   outer one back makes them again.

   A replay file is JSON:

     { kind: 'mtg-table-replay', v: 1, config, settings, setup, decks,
       cards: [...], actions: [[method, ...args], ...], final }

   `setup` is the game as it stood when recording began (a snapshot with
   everything left at its default taken out), `cards` the card objects it
   refers to — a printing from Scryfall by its id alone, anything made up
   at the table (a token) in full — and `final` a fingerprint of how it
   ended, to tell whether a playback came out the same.
   ============================================================ */
'use strict';
(function (MTG) {
  const U = MTG.util;
  const { Game, GObj, Player } = MTG.rules;

  /** Everything that changes a game from outside it. */
  const MUTATORS = [
    'start', 'mulligan', 'keepHand', 'setAutoPass', 'setFullControl', 'setYield', 'autoAnswer', 'setHoldPriority',
    'passPriority', 'playLand', 'encoreCard', 'plotCard', 'foretellCard', 'suspendCard', 'transmuteCard', 'turnFaceUp', 'companionToHand', 'rollPlanarDie',
    'cycleCard', 'castSpell', 'activateAbility', 'tapForMana', 'payMana', 'declareAttackers',
    'declareBlockers', 'changeLife', 'addPoison', 'addCounters', 'moveObject', 'drawCards',
    'checkStateBasedActions', 'playerLoses', 'concede', 'resolveChoice', 'manual', 'setConnected',
    'logEvent', 'setMonarch', 'takeInitiative', 'setDayNight', 'castVote', 'pushUndo', 'dropUndo', 'undo',
  ];
  // the settings the engine reads, which belong to the game rather than the person watching it
  const SETTINGS = ['autoTapLands', 'commanderToZone'];

  const SCRY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

  /* ---------------- arguments as data ----------------
     Almost everything passed to the engine is already plain data — ids,
     numbers, choices. The odd call hands over an object or a player
     itself, and those are written as their ids. */
  function enc(v) {
    if (v == null || typeof v !== 'object') return typeof v === 'function' ? null : v;
    if (v instanceof GObj) return { $o: v.id };
    if (v instanceof Player) return { $p: v.id };
    if (Array.isArray(v)) return v.map(enc);
    const out = {};
    for (const k in v) { const x = v[k]; if (typeof x !== 'function' && x !== undefined) out[k] = enc(x); }
    return out;
  }
  function dec(v, g) {
    if (v == null || typeof v !== 'object') return v;
    if (Array.isArray(v)) return v.map(x => dec(x, g));
    if (v.$o && Object.keys(v).length === 1) return g.obj(v.$o) || null;
    if (v.$p && Object.keys(v).length === 1) return g.player(v.$p) || null;
    const out = {};
    for (const k in v) out[k] = dec(v[k], g);
    return out;
  }

  /* ---------------- cards ----------------
     A card from Scryfall is written as its id and looked up again on the
     way back in; a card the table made up is written whole. */
  function cardTable() {
    const list = [], index = new Map();
    return {
      list,
      ref(card) {
        if (!card) return null;
        if (index.has(card)) return index.get(card);
        const plain = SCRY_ID.test(String(card.id || '')) && !card._isToken;
        const i = list.length;
        list.push(plain ? { s: card.id } : { c: card });
        index.set(card, i);
        return i;
      },
    };
  }

  /** The default value of every field of a snapshot, for a game with this config. */
  function defaults(config) {
    const g = new Game(Object.assign({}, config, { seed: 1 }));
    g.addPlayer({ id: '__p', name: '' });
    g._register(new GObj({ name: '' }, '__p', 'library'));
    const snap = g.snapshot();
    return { obj: snap.objs[0], player: snap.players[0] };
  }
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const ALWAYS_OBJ = new Set(['id', 'card', 'owner', 'zone']);
  const ALWAYS_PLAYER = new Set(['id', 'name']);

  /** A snapshot with the cards taken out to the table and the defaults left off. */
  function packSetup(snap, cards) {
    const d = defaults(snap.config);
    const out = Object.assign({}, snap);
    out.log = [];
    out.objs = snap.objs.map(o => {
      const r = {};
      for (const k in o) {
        if (k === 'card' || k === 'printedCard' || k === 'copyOf') { if (o[k]) r[k] = cards.ref(o[k]); continue; }
        if (ALWAYS_OBJ.has(k) || !same(o[k], d.obj[k])) r[k] = o[k];
      }
      return r;
    });
    out.players = snap.players.map(p => {
      const r = {};
      for (const k in p) if (ALWAYS_PLAYER.has(k) || !same(p[k], d.player[k])) r[k] = p[k];
      return r;
    });
    return out;
  }
  function unpackSetup(setup, cards) {
    const d = defaults(setup.config);
    const snap = Object.assign({}, setup);
    snap.objs = setup.objs.map(o => {
      const r = JSON.parse(JSON.stringify(d.obj));
      for (const k in o) r[k] = o[k];
      for (const k of ['card', 'printedCard', 'copyOf']) if (typeof o[k] === 'number') r[k] = cards[o[k]];
      return r;
    });
    snap.players = setup.players.map(p => Object.assign(JSON.parse(JSON.stringify(d.player)), p));
    return snap;
  }

  /** How a game stands, as one short string: every seat's view of it, log times aside. */
  function fingerprint(g) {
    const ids = g.players.map(p => p.id).concat(['__watching']);
    const views = ids.map(id => {
      const v = g.viewFor(id);
      v.log = (v.log || []).map(l => l.type + ':' + l.text);
      return v;
    });
    /* A printing is the same printing however it was fetched: the card
       cache stamps each one with when it arrived, which is not the game. */
    const text = JSON.stringify(views, (k, x) => ((k === 'card' || k === 'printedCard' || k === 'copyOf') && x && typeof x === 'object' ? (x.id || x.name || '?') : x));
    return { v: g.stateVersion, turn: g.turn, over: !!g.over, hash: U.hash(text) };
  }

  /* ---------------- recording ---------------- */
  class Recorder {
    constructor(g, meta) {
      this.g = g;
      this.meta = meta || {};
      this.depth = 0;
      this.on = true;
      this.actions = [];
      this.cards = cardTable();
      this.setup = packSetup(g.snapshot(), this.cards);
      this.settings = {};
      for (const k of SETTINGS) this.settings[k] = MTG.settings ? MTG.settings[k] : undefined;
      this.decks = {};
      for (const p of g.players) {
        if (p.sideboard && p.sideboard.length) this.decks[p.id] = { sideboard: p.sideboard.map(e => [this.cards.ref(e.card), e.qty]) };
      }
      this.started = Date.now();
      this._wrap();
    }
    _wrap() {
      const rec = this, g = this.g;
      for (const m of MUTATORS) {
        const orig = Game.prototype[m];
        if (typeof orig !== 'function') continue;
        g[m] = function () {
          if (rec.depth === 0 && rec.on) rec._note(m, Array.from(arguments));
          rec.depth++;
          try { return orig.apply(this, arguments); } finally { rec.depth--; }
        };
      }
    }
    _note(m, args) {
      let a;
      if (m === 'dropUndo') a = [(this.g._undo || []).indexOf(args[0])];
      else a = enc(args);
      while (a.length && a[a.length - 1] == null) a.pop();
      this.actions.push([m].concat(a));
    }
    stop() {
      this.on = false;
      for (const m of MUTATORS) if (Object.prototype.hasOwnProperty.call(this.g, m)) delete this.g[m];
    }
    /** The replay as plain data, ready for JSON. */
    toJSON() {
      const g = this.g;
      return {
        kind: 'mtg-table-replay', v: 1,
        createdAt: new Date(this.started).toISOString(),
        meta: Object.assign({
          players: g.players.map(p => ({ id: p.id, name: p.name, isBot: !!p.isBot })),
          formatId: g.config.formatId, turns: g.turn, winners: (g.winners || []).slice(),
        }, this.meta),
        config: JSON.parse(JSON.stringify(g.config)),
        settings: Object.assign({}, this.settings),
        setup: this.setup,
        decks: this.decks,
        cards: this.cards.list.map(c => (c.s ? c.s : c.c)),
        actions: this.actions.slice(),
        final: fingerprint(g),
      };
    }
  }

  /* ---------------- playing back ---------------- */

  /**
   * Turn the card table back into cards. Scryfall printings are looked up
   * through the card cache (and the network, if they are not in it);
   * `lookup` can supply them instead.
   */
  async function resolveCards(data, lookup) {
    const out = new Array(data.cards.length).fill(null);
    const want = [];
    data.cards.forEach((c, i) => {
      if (typeof c !== 'string') { out[i] = c; return; }
      const got = lookup ? lookup(c) : null;
      if (got) out[i] = got; else want.push(i);
    });
    if (want.length) {
      if (!MTG.scry || !MTG.scry.collection) throw new Error('Card data is needed to play this replay.');
      const { cards } = await MTG.scry.collection(want.map(i => ({ id: data.cards[i] })));
      want.forEach((i, k) => { out[i] = cards[k] || null; });
      const missing = want.filter(i => !out[i]).length;
      if (missing) throw new Error(`${missing} card${missing === 1 ? '' : 's'} in this replay could not be found.`);
    }
    return out;
  }

  class Replay extends MTG.Emitter {
    /** @param data   a replay, as saved
        @param cards  the card table, resolved (resolveCards) */
    constructor(data, cards) {
      super();
      if (!data || data.kind !== 'mtg-table-replay') throw new Error('That is not a replay file.');
      this.data = data;
      this.cards = cards;
      this.total = data.actions.length;
      this.reset();
    }
    /** Back to the moment recording began. */
    reset() {
      const data = this.data;
      const g = new Game(JSON.parse(JSON.stringify(data.config)));
      g.restore(unpackSetup(data.setup, this.cards));
      // a restore counts as a change of its own; this one is the same moment, not a new one
      g.stateVersion = data.setup.stateVersion || 0;
      for (const [pid, d] of Object.entries(data.decks || {})) {
        const p = g.player(pid);
        if (p && d.sideboard) p.sideboard = d.sideboard.map(([i, qty]) => ({ card: this.cards[i], qty }));
      }
      this.game = g;
      this.index = 0;
      this.errors = [];
      this.emit('reset', g);
      return g;
    }
    get done() { return this.index >= this.total; }
    /** Apply the next action. False once there are none left. */
    step() {
      if (this.done) return false;
      const [m, ...args] = this.data.actions[this.index++];
      const g = this.game;
      const keep = {};
      const S = MTG.settings || {};
      for (const k of SETTINGS) { keep[k] = S[k]; if (k in (this.data.settings || {})) S[k] = this.data.settings[k]; }
      try {
        if (m === 'dropUndo') g.dropUndo((g._undo || [])[args[0]]);
        else if (typeof g[m] === 'function' && MUTATORS.includes(m)) g[m].apply(g, dec(args, g));
        else this.errors.push({ at: this.index - 1, error: 'unknown action ' + m });
      } catch (e) {
        this.errors.push({ at: this.index - 1, error: String(e && e.message || e) });
      } finally {
        for (const k of SETTINGS) S[k] = keep[k];
      }
      this.emit('step', this.index);
      return true;
    }
    /** Play on until `stop(game)` says so, or the end. */
    runUntil(stop) {
      while (!this.done && !(stop && stop(this.game))) this.step();
      return this.game;
    }
    /** The game as it stood when turn `n` began (or as late as the replay goes). */
    seekTurn(n) {
      if (this.game.turn >= n) this.reset();
      return this.runUntil(g => g.turn >= n);
    }
    /** Did playing it back end where the recording did? */
    verify() {
      const f = this.data.final;
      if (!f) return { ok: true, unknown: true };
      const now = fingerprint(this.game);
      return { ok: now.hash === f.hash && now.v === f.v, now, then: f };
    }
  }

  /** Start recording a game. Call before game.start() for a whole game. */
  function record(game, meta) { return new Recorder(game, meta); }

  /** Read a replay file (text or parsed) and get it ready to play. */
  async function open(json, opts) {
    opts = opts || {};
    const data = typeof json === 'string' ? JSON.parse(json) : json;
    if (!data || data.kind !== 'mtg-table-replay') throw new Error('That is not a replay file.');
    if (data.v !== 1) throw new Error('That replay was made by a newer version of the table.');
    const cards = await resolveCards(data, opts.lookup);
    return new Replay(data, cards);
  }

  MTG.replay = Object.assign(MTG.replay || {}, {
    record, open, Replay, Recorder, resolveCards, fingerprint, MUTATORS, SETTINGS,
    _pack: { packSetup, unpackSetup, enc, dec },
  });
})(window.MTG);
