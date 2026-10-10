/* ============================================================
   16a-playtest.js - trying a deck out before it meets anybody
   Two ways in. Sample hands: shuffle, draw seven, mulligan the
   London way, draw on, and the odds of the lands in an opening
   hand. And the practice game ("goldfishing"): the deck played out
   at the real table against a seat that does nothing and cannot
   lose, to see on which turn it would have won.

   This half is the arithmetic and the engine's side, with nothing
   on screen, so the tools can test it (tools/decktoolstest.js); what
   the player sees is src/11b-ui-playtest.js.
   ============================================================ */
'use strict';
(function (MTG) {
  /* ---------------- what counts as a land ----------------
     A card you could play as your land for the turn: a land, or a modal
     double-faced card with a land on its back (Shatterskull Smashing),
     which most people count as one when they count their lands. */
  function isLand(card) {
    if (!card) return false;
    const faces = card.card_faces && card.card_faces.length ? card.card_faces : null;
    const front = (faces ? faces[0].type_line : null) || String(card.type_line || '').split('//')[0];
    if (/\bLand\b/.test(front || '')) return true;
    return card.layout === 'modal_dfc' && !!faces && faces.some(f => /\bLand\b/.test(f.type_line || ''));
  }

  /** The main deck, card by card: what a library is shuffled from. */
  function libraryOf(deck) {
    const out = [];
    for (const e of (deck && deck.main) || []) for (let i = 0; i < (e.qty || 0); i++) out.push(e.card);
    return out;
  }

  /** How many cards, and how many of them lands, in the main deck. */
  function landCount(deck) {
    let lands = 0, size = 0;
    for (const e of (deck && deck.main) || []) {
      size += e.qty || 0;
      if (isLand(e.card)) lands += e.qty || 0;
    }
    return { lands, size };
  }

  /* ---------------- the odds ----------------
     Drawing without putting back is the hypergeometric distribution: of
     `size` cards with `lands` lands among them, the chance that `drawn`
     cards hold exactly k lands. Worked in logarithms, so a 250-card deck
     does not overflow anything. */
  const LOGF = [0];
  function logFact(n) {
    for (let i = LOGF.length; i <= n; i++) LOGF[i] = LOGF[i - 1] + Math.log(i);
    return LOGF[n];
  }
  const logChoose = (n, k) => (k < 0 || k > n) ? -Infinity : logFact(n) - logFact(k) - logFact(n - k);

  /** The chance of exactly k lands in `drawn` cards from `size` with `lands` lands. */
  function exactly(k, lands, size, drawn) {
    if (drawn > size || k < 0 || k > drawn) return 0;
    const v = logChoose(lands, k) + logChoose(size - lands, drawn - k) - logChoose(size, drawn);
    return v === -Infinity ? 0 : Math.exp(v);
  }

  /**
   * For each number of lands from 0 to `drawn`, the chance of exactly that
   * many in an opening hand of `drawn` (seven unless said) from this deck.
   */
  function openingOdds(deck, drawn) {
    const { lands, size } = landCount(deck);
    drawn = Math.min(drawn == null ? 7 : drawn, size);
    const out = [];
    for (let k = 0; k <= drawn; k++) out.push(exactly(k, lands, size, drawn));
    return { lands, size, drawn, exactly: out };
  }

  /** The chance of at least k (and at most `most`, when given) from a list of exact chances. */
  function between(exact, k, most) {
    let p = 0;
    for (let i = k; i < exact.length && (most == null || i <= most); i++) p += exact[i];
    return Math.min(1, p);
  }

  /* ---------------- sample hands ----------------
     A hand dealt the way the table deals one: seven from the shuffled
     main deck, and a London mulligan is seven again with one more card
     to put on the bottom each time (the free mulligans a format gives
     first). The cards to bottom are chosen, as at the table, before
     drawing on. */
  class SampleHand {
    /** `opts.seed` makes the shuffles repeatable; `opts.freeMulligans` as the format has them. */
    constructor(deck, opts) {
      opts = opts || {};
      this.deck = deck;
      this.rng = new MTG.RNG(opts.seed == null ? (Date.now() >>> 0) : opts.seed);
      this.free = opts.freeMulligans || 0;
      this.handSize = opts.handSize || 7;
      this.reset();
    }
    /** A fresh shuffle and a fresh seven. */
    reset() {
      this.mulligans = 0;
      this._uid = 0;
      this.library = this.rng.shuffle(libraryOf(this.deck).map(card => ({ key: 'c' + (++this._uid), card })));
      this.hand = [];
      this.bottomed = [];
      this.draws = 0;
      this._deal();
    }
    _deal() {
      this.hand = this.library.splice(0, this.handSize);
      this.toBottom = Math.max(0, Math.min(this.hand.length, this.mulligans - this.free));
    }
    /** Shuffle the hand back and take seven more, with one more to put back. */
    mulligan() {
      if (this.draws) return false;           // a hand drawn on from is a hand kept
      // (what was put on the bottom is in the library already)
      this.library = this.rng.shuffle(this.library.concat(this.hand));
      this.bottomed = [];
      this.mulligans++;
      this._deal();
      return true;
    }
    /** Put one card of the hand on the bottom, while the mulligan says some go. */
    bottom(key) {
      if (this.toBottom <= 0) return false;
      const i = this.hand.findIndex(x => x.key === key);
      if (i < 0) return false;
      const [x] = this.hand.splice(i, 1);
      this.library.push(x);
      this.bottomed.push(x);
      this.toBottom--;
      return true;
    }
    /** Draw the next card, once the cards to bottom have gone. */
    draw() {
      if (this.toBottom > 0 || !this.library.length) return null;
      // the cards put on the bottom come up last, as they would
      const x = this.library.shift();
      const was = this.bottomed.indexOf(x);
      if (was >= 0) this.bottomed.splice(was, 1);
      this.hand.push(x);
      this.draws++;
      return x;
    }
    /** How many lands are in the hand now. */
    lands() { return this.hand.filter(x => isLand(x.card)).length; }
    /** Whether the hand is settled: nothing left to put on the bottom. */
    get kept() { return this.toBottom === 0; }
  }

  /* ---------------- the practice game ----------------
     The opponent is a seat called the Goldfish: no cards, plenty of life,
     and an emblem that says it cannot lose, so drawing from its empty
     library each turn costs it nothing. It never casts, attacks or
     blocks; it keeps its hand, passes, and answers only what it is made
     to answer (a sacrifice, say), the way any bot would. */
  const SEAT = 'goldfish';
  const LIFE = 1000;
  const EMBLEM = {
    id: 'emblem:goldfish', name: 'Emblem — Goldfish', layout: 'emblem', type_line: 'Emblem',
    oracle_text: 'You can’t lose the game and your opponents can’t win the game.',
    mana_cost: '', cmc: 0, colors: [], color_identity: [], keywords: [],
    rarity: 'common', set: 'emb', set_name: 'Emblem', collector_number: '0', image_uris: null,
  };

  /** Whether a seat at the table is the practice opponent (saved games keep the id, so this holds after a resume). */
  const isSeat = (r) => !!r && r.id === SEAT;

  /**
   * The Goldfish's deck: nothing, and its emblem, which starts the game in
   * the command zone the way a drafted conspiracy does (the one way into
   * the command zone a deck has), so a saved game keeps it.
   */
  function emptyDeck(formatId) {
    return {
      id: 'deck_goldfish', name: 'Nothing', format: formatId || 'standard',
      main: [], sideboard: [], commanders: [], companion: null,
      conspiracies: [{ card: EMBLEM }],
    };
  }

  const BotPlayer = MTG.bots && MTG.bots.BotPlayer;
  /**
   * The Goldfish's runner. It is a bot so the table's bot runner can drive
   * it, but all it does by choice is pass: no spell, no attack, no block.
   * A question only it can answer gets a bot's answer (with no attack or
   * block in it), so the game never waits on it.
   */
  class Sitter extends BotPlayer {
    constructor(game, playerId) {
      super(game, playerId, 1, null, { personality: 'none' });
    }
    async tick() {
      const g = this.game;
      if (this.busy || g.over) return false;
      const me = this.me;
      if (!me || me.hasLost) return false;
      const was = g.stateVersion;
      this.busy = true;
      try {
        // an empty library is no reason to lose (the emblem sees to that); the flag is let go so it is not asked about again
        if (me.drewFromEmpty) me.drewFromEmpty = false;
        if (g.mulliganPhase && !me.keptHand) { g.keepHand(this.pid, []); return g.stateVersion !== was; }
        const ch = g.pendingChoice;
        if (ch && ch.playerId === this.pid) {
          const still = ch.type === 'declareAttackers' || ch.type === 'declareBlockers';
          // nothing attacks or blocks unless the rules make it (an empty plan, then whatever must)
          this.doChoice(ch, still ? [] : undefined);
          return g.stateVersion !== was;
        }
        if (g.priorityPlayer && g.priorityPlayer.id === this.pid) {
          g.passPriority(this.pid);
          return g.stateVersion !== was;
        }
      } finally { this.busy = false; }
      return false;
    }
  }

  /**
   * Once the game has begun (Session.onStarted): the Goldfish's life, and
   * who goes first. `opts.onDraw` puts the player on the draw. A fresh
   * game only; a resumed one has all this in its snapshot already.
   */
  function setup(g, opts) {
    opts = opts || {};
    const fish = g.player(SEAT);
    if (!fish) return;
    fish.life = LIFE;
    fish.drewFromEmpty = false;
    const first = opts.onDraw ? SEAT : (opts.me || 'me');
    if (g.turnOrder && g.turnOrder.includes(first)) {
      while (g.turnOrder[0] !== first) g.turnOrder.push(g.turnOrder.shift());
      const p = g.player(first);
      g.logEvent('rules', `Practice game: ${p ? p.name : 'you'} ${opts.onDraw ? 'goes second' : 'goes first'}.`);
    }
  }

  /**
   * Seat the Goldfish at a table's bot runner, in place of a bot (seatBot
   * in src/14-app.js asks), and start its tally. Returns the Sitter.
   */
  function seat(g, runner, r) {
    const s = new Sitter(g, r.id);
    runner.bots.set(r.id, s);
    const p = g.player(r.id);
    if (p) p.botPersonality = null;
    // the table's tally of how it is going (src/11b-ui-playtest.js) listens for this
    MTG.bus.emit('practice:seat', g, tally(g));
    return s;
  }

  /* ---------------- how it went ----------------
     What the deck has done to the Goldfish, turn by turn: life taken
     (it starts at LIFE, so whatever it is short of that), poison, and the
     most commander damage from one commander. The turn is the player's
     own count of turns, as "a turn-four win" means it. The kill is the
     first of the player's turns by which any of them would have won a
     real game: the format's starting life, ten poison, or the commander
     damage rule. */
  const tallies = new WeakMap();
  function tally(g, opts) {
    if (tallies.has(g)) return tallies.get(g);
    opts = opts || {};
    const t = {
      me: opts.me || 'me',
      target: opts.target || (g.config && g.config.startingLife) || 20,
      byTurn: [],         // [turn] -> life taken by the end of it
      kill: null,         // { turn, how }
      dealt: 0, poison: 0, commander: 0, turn: 0,
      listeners: new Set(),
    };
    const read = () => {
      const fish = g.player(SEAT), me = g.player(t.me);
      if (!fish || !me) return;
      t.turn = me.turnsTaken || 0;
      // nothing counts before your first turn: the Goldfish's life is only set once the game has begun
      if (!t.turn) return;
      t.dealt = Math.max(0, LIFE - fish.life);
      t.poison = fish.poison || 0;
      t.commander = Math.max(0, ...Object.values(fish.commanderDamage || {}).map(Number).filter(Number.isFinite));
      t.byTurn[t.turn] = t.dealt;
      if (!t.kill) {
        const cmdRule = g.config && g.config.commanderDamage;
        const how = t.dealt >= t.target ? 'damage' : t.poison >= 10 ? 'poison' : (cmdRule && t.commander >= cmdRule) ? 'commander' : null;
        if (how) t.kill = { turn: t.turn, how, resumed: !!t._resumed };
      }
      for (const fn of t.listeners) { try { fn(t); } catch (e) { console.warn('[practice]', e); } }
    };
    // a game picked up again may already be past the kill; its turn is not known, only that it happened
    if (g.turn > 0) { t._resumed = true; read(); t._resumed = false; }
    g.on('state', read);
    t.read = read;
    t.on = (fn) => { t.listeners.add(fn); return () => t.listeners.delete(fn); };
    tallies.set(g, t);
    return t;
  }

  MTG.playtest = { isLand, landCount, libraryOf, exactly, openingOdds, between, SampleHand };
  MTG.practice = { SEAT, LIFE, EMBLEM, isSeat, emptyDeck, Sitter, setup, seat, tally };
})(window.MTG);
