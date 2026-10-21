/* ===== 06d-sim.js ===== */
/* ============================================================
   06d-sim.js - games played in the head

   A bot that looks ahead needs a game it can play forward and throw
   away: a copy of the table that nobody is watching, that writes nothing
   down, and that cannot reach back and touch the real one.

   fork() makes that copy from the same plain-data snapshot undo and
   saving use, so it is as faithful as a saved game — plus the handful of
   "this turn" counters a save does not need. The copy has its own random
   generator, seeded by whoever asked for it, so thinking about a shuffle
   never moves the real game's shuffles along, and it says nothing: no
   events, no log lines, no state notices. A replay recorder wraps the
   methods of the game it records and no other, so a copy is never on the
   record either.

   determinise() deals the cards a player cannot see — the other hands,
   every library's order — afresh from the cards that could be there, so a
   bot thinking about its opponent's next turn is thinking about a hand
   they might hold rather than the one they do.

   drive() plays a copy forward with whatever players it is given, one
   decision at a time, until a stopping point.
   ============================================================ */
'use strict';
(function (MTG) {
  const Game = MTG.rules.Game;
  const noop = function () {};
  const nothing = function () { return null; };

  /** Stop a game telling anyone anything: events, log lines and notices go nowhere. */
  function silence(g) {
    g._ev = nothing; g._evPush = nothing; g._evSettle = noop; g._evBaseline = noop; g._evRebase = noop;
    g._evInit = function () { this.events = []; };
    g.logEvent = noop;
    g.emit = noop;
    g.isScratch = true;
    return g;
  }

  /* A card is shared, never copied: it is read-only to the engine and the
     largest thing in the game. Everything else plain is copied, so the
     scratch game has no list or record in common with the real one. */
  function isCard(v) { return v.type_line !== undefined || v.oracle_id !== undefined || v.card_faces !== undefined; }
  function plainCopy(v, depth) {
    if (v == null || typeof v !== 'object') return v;
    if ((depth || 0) > 12) return v;
    if (Array.isArray(v)) return v.map(x => plainCopy(x, (depth || 0) + 1));
    const proto = Object.getPrototypeOf(v);
    if (proto !== Object.prototype && proto !== null) return v;     // a game object, a set: left alone
    if (isCard(v)) return v;
    const out = {};
    for (const k in v) out[k] = plainCopy(v[k], (depth || 0) + 1);
    return out;
  }

  // what a turn remembers that a saved game does not need
  const GAME_EXTRAS = ['turnHistory', 'spellsLastTurn', 'combatsThisTurn', '_combatTurn', '_lastLifeLost', '_lastDamageDealt'];
  const PRIMITIVE = { number: 1, string: 1, boolean: 1 };

  /**
   * A private copy of a game, to play forward and throw away.
   * `seed` seeds its random generator (and the bots that sit in it).
   */
  function fork(game, seed) {
    const snap = game.snapshot();
    snap.log = [];
    snap.stack = snap.stack.map(it => plainCopy(it));
    snap.pendingTriggers = snap.pendingTriggers.map(t => plainCopy(t));
    snap.prevention = plainCopy(snap.prevention);
    if (snap.resolving) snap.resolving = plainCopy(snap.resolving);
    const g = silence(new Game(snap.config));
    g.restore(snap);
    g.config.seed = (seed >>> 0) || 1;
    g.rng.s = g.config.seed;
    for (const k of GAME_EXTRAS) if (game[k] !== undefined) g[k] = plainCopy(game[k]);
    for (const p of game.players) {
      const q = g.player(p.id);
      if (!q) continue;
      for (const k of Object.keys(p)) {
        if (q[k] !== undefined) continue;
        const v = p[k];
        if (PRIMITIVE[typeof v]) q[k] = v;
        else if (Array.isArray(v) && k !== 'sideboard') q[k] = plainCopy(v);
      }
    }
    for (const o of game.objects.values()) {
      const c = g.objects.get(o.id);
      if (!c) continue;
      for (const k of Object.keys(o)) {
        if (c[k] !== undefined || k.charCodeAt(0) === 95 /* _ */) continue;
        if (PRIMITIVE[typeof o[k]]) c[k] = o[k];
      }
    }
    return g;
  }

  /**
   * Deal the hidden cards again, as `viewer` would have to imagine them:
   * each opponent's hand comes from the cards that could be in it (their
   * hand and library together, less anything `known` says the viewer has
   * seen go there), and every library — the viewer's own too — is
   * shuffled, because nobody knows the order of a library.
   */
  function determinise(g, viewer, rng, known) {
    for (const p of g.players) {
      const z = g.zones[p.id];
      if (!z) continue;
      if (p.id === viewer) { rng.shuffle(z.library); continue; }
      const open = [];
      const hidden = [];
      // (a card revealed to the viewer, still in that hand, is that card: knownTo)
      z.hand.forEach((o, i) => { if (!(known && known.has(o.id)) && !g._knows(o, viewer)) { open.push(i); hidden.push(o); } });
      if (!open.length) { rng.shuffle(z.library); continue; }
      const pool = hidden.concat(z.library);
      rng.shuffle(pool);
      open.forEach((i, k) => { const o = pool[k]; z.hand[i] = o; o.zone = 'hand'; });
      z.library = pool.slice(open.length);
      for (const o of z.library) o.zone = 'library';
    }
    return g;
  }

  const clock = () => (typeof performance !== 'undefined' && performance.now ? performance.now() : Date.now());

  /** One decision by whoever the game is waiting on. */
  function act(g, players) {
    if (g.mulliganPhase) {
      for (const p of g.players) if (!p.keptHand && players[p.id]) { players[p.id].doMulligan(); return; }
      return;
    }
    const ch = g.pendingChoice;
    if (ch) { const b = players[ch.playerId]; if (b) b.doChoice(ch); return; }
    const pp = g.priorityPlayer;
    if (pp && players[pp.id]) players[pp.id].doPriority();
  }

  /** What a table does when the one it waits on cannot act: the simplest legal move. */
  function nudge(g) {
    const ch = g.pendingChoice;
    if (ch && ch.type === 'declareAttackers') { if (!g.declareAttackers(ch.playerId, [])) g.resolveChoice(ch.playerId, {}); }
    else if (ch && ch.type === 'declareBlockers') g.declareBlockers(ch.playerId, []);
    else if (ch) g.resolveChoice(ch.playerId, {});
    else if (g.priorityPlayer) g.passPriority(g.priorityPlayer.id);
  }

  /**
   * Play a game forward with these players ({ playerId: bot }) until
   * `stop(g)` says so, the game ends, or `maxSteps` decisions have been
   * made, or the clock passes `deadline` (a performance.now() time, a
   * safety net only). Returns how many decisions it took, or -1 if it got
   * stuck or ran out of time.
   */
  function drive(g, players, stop, maxSteps, deadline) {
    const limit = maxSteps || 3000;
    for (let i = 0; i < limit; i++) {
      if (g.over || (stop && stop(g))) return i;
      if (deadline && i && clock() > deadline) return -1;
      const v = g.stateVersion;
      act(g, players);
      if (g.stateVersion === v) {
        nudge(g);
        if (g.stateVersion === v) return -1;
      }
    }
    return -1;
  }

  /* Looking ahead asks the card reader about the same few dozen cards
     millions of times, and its own memory is keyed by a string built
     afresh on every call. This remembers the answer on the card object
     itself (by way of a WeakMap), in front of the reader's memory and
     forgetting whenever that is cleared, so the answers are the same
     ones, only quicker to find. */
  const O = MTG.oracle;
  if (O && O.analyze && !O.analyze._quick) {
    const inner = O.analyze;
    let memo = new WeakMap();
    const quick = function (card, faceIndex) {
      if (!card || typeof card !== 'object') return inner(card, faceIndex);
      let m = memo.get(card);
      if (!m) { m = []; memo.set(card, m); }
      const f = faceIndex || 0;
      let r = m[f];
      if (r === undefined) { r = inner(card, faceIndex); m[f] = r; }
      return r;
    };
    quick._quick = true;
    O.analyze = quick;
    if (O.clearCache) {
      const clear = O.clearCache;
      O.clearCache = function () { memo = new WeakMap(); return clear.apply(this, arguments); };
    }
  }

  MTG.sim = { fork, determinise, drive, silence, plainCopy };
})(window.MTG);
