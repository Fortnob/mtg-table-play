/* ===== 06f-planechase.js ===== */
'use strict';
/* ============================================================
   06f-planechase.js - Planechase (CR 901), a game variant

   With the house rule on (config.planechase), each player brings a planar
   deck of plane and phenomenon cards (CR 901.3) besides their deck. The
   planar deck waits face down in its owner's command zone (zones[pid].planar,
   the top first: CR 901.4); a face-up plane or phenomenon sits in its
   owner's command zone too, marked `planeUp`, and is controlled by the
   planar controller — normally the player whose turn it is (CR 901.6). Its
   abilities work from there the way an emblem's do (CR 901.7): standing
   rules, triggers, "you" its controller.

   Once every opening hand is kept, the starting player turns their top
   card face up until it is a plane (CR 901.5), with nothing triggering. On
   their turn, in a main phase with the stack empty, the active player may
   roll the planar die, a special action costing {0} the first time each
   turn and {1} more each time after (CR 901.9): one face planeswalks (the
   planeswalking ability goes on the stack, CR 901.8), one makes chaos ensue
   (each face-up plane's chaos ability triggers, CR 311.7), four do nothing.
   To planeswalk is to put each face-up plane and phenomenon on the bottom
   of its owner's planar deck and turn the top card of your own face up
   (CR 701.31): "When you planeswalk away from …" and "When you planeswalk
   to …" / "When you encounter …" trigger. A face-up phenomenon with nothing
   of its own waiting to resolve sends the planar controller on as a
   state-based action (CR 704.6f). A player leaving the game takes their
   planar cards with them; a face-up one that goes has the planar controller
   turn up the top of their planar deck (CR 901.10).

   Susan Foreman: "If you would planeswalk, instead look at the top two
   cards of your planar deck, put one on the bottom of your planar deck and
   the other on top, then planeswalk." (planeswalkLookTwo) — the card she
   keeps on top is the one walked to.

   What the table sees is view.planechase (_planarView); the die is rolled
   with the planarDie intent (rollPlanarDie), and comes out as a 'roll' event
   with `planar` set to the face it showed.
   ============================================================ */
(function (MTG) {
  const { Game } = MTG.rules;
  const truncate = (s, n) => { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '\u2026' : s; };
  const U_cap = (s) => { s = String(s || ''); return s.charAt(0).toUpperCase() + s.slice(1); };

  /** A plane or phenomenon card (Scryfall's planar layout). */
  function isPlanarCard(c) {
    if (!c) return false;
    return c.layout === 'planar' || /^(?:Plane|Phenomenon)\b/.test(String(c.type_line || ''));
  }
  function isPhenomenonCard(c) { return !!c && /^Phenomenon\b/.test(String(c.type_line || '')); }
  /* The planar die (CR 901.3a): one face the Planeswalker symbol, one the chaos symbol, four blank. A d6 to the
     table, the face it showed said beside its number. */
  const FACE_OF = (n) => (n === 1 ? 'pw' : n === 2 ? 'chaos' : 'blank');
  const FACE_WORDS = { pw: 'the Planeswalker symbol', chaos: 'chaos', blank: 'a blank' };
  // the planeswalking ability (CR 901.8): no source, controlled by whoever rolled
  const WALK_TEXT = 'Whenever you roll the Planeswalker symbol on the planar die, planeswalk.';

  /* A planar deck as a deck brings it: cards, or { card, qty } entries (one of each: CR 901.3). */
  function planarCards(list) {
    const out = [];
    for (const e of (list || [])) {
      const c = e && (e.card || e);
      if (!c || !c.name || !isPlanarCard(c)) continue;
      const n = Math.max(1, Math.min(1, Number(e.qty) || 1));
      for (let i = 0; i < n; i++) out.push(c);
    }
    return out;
  }

  Object.assign(Game.prototype, {
    /** Is this a Planechase game? */
    planechaseOn() { return !!(this.config && this.config.planechase); },
    /** A player's planar deck, the top first (an empty list for none). */
    planarDeck(pid) {
      // (not made here: a look must not change the game — _loadPlanar and _faceDown make it)
      const z = this.zones[pid];
      return (z && z.planar) || [];
    },
    /** The face-up planes and phenomena, oldest first. */
    facePlanes() {
      const out = [];
      for (const p of this.players) for (const o of ((this.zones[p.id] || {}).command || [])) if (o.planeUp) out.push(o);
      return out.sort((a, b) => (a.ts || 0) - (b.ts || 0));
    },
    /** The planar controller (CR 901.6): the active player, or the next player still in the game. */
    planarController() {
      const order = this.turnOrder.length ? this.turnOrder : this.players.map(p => p.id);
      const at = Math.max(0, this.activeIndex);
      for (let k = 0; k < order.length; k++) {
        const p = this.player(order[(at + k) % order.length]);
        if (p && !p.hasLost) return p.id;
      }
      return null;
    },
    /** Deceptive Divination: is a face-up plane making every sorcery an instant? (once for each state of the board) */
    _sorceriesAsInstants() {
      if (!this.planechaseOn()) return false;
      if (this.__sorcInstKey === this._boardKey) return this.__sorcInst;
      this.__sorcInstKey = this._boardKey; this.__sorcInst = false;
      this.__sorcInst = this.facePlanes().some(pl => !!this._staticOp(pl, 'sorceryAsInstant'));
      return this.__sorcInst;
    },
    /** Every face-up plane and phenomenon is the planar controller's (CR 901.6), whoever owns it. */
    _planarSync() {
      const pc = this.planarController();
      if (!pc) return;
      let changed = false;
      for (const o of this.facePlanes()) if (o.controller !== pc) { o.controller = pc; changed = true; }
      if (changed) this.bumpBoard();
    },

    /** The planar deck a deck brings, face down in its owner's command zone (CR 901.4), shuffled. */
    _loadPlanar(pid, list) {
      const z = this.zones[pid];
      if (!z) return;
      z.planar = [];
      // (one of each name: CR 901.3)
      const seen = new Set();
      for (const c of planarCards(list)) {
        if (seen.has(c.name)) continue;
        seen.add(c.name);
        const o = this._register(new MTG.rules.GObj(c, pid, 'planar'));
        z.planar.push(o);
      }
      this.rng.shuffle(z.planar);
    },

    /* ---------- the start (CR 901.5) ---------- */
    /** As each turn begins: the starting plane on the first, and the planar controller for the turn. */
    _planarTurnBegins(ap) {
      if (!this.planechaseOn()) return;
      const st = this.planar || (this.planar = { walks: 0 });
      if (!st.started) {
        st.started = true;
        this._startingPlane(ap.id);
      }
      // Fixed Point in Time: "until your next turn" — over as that player's turn begins
      if (st.fixedPoint && st.fixedPoint === ap.id) st.fixedPoint = null;
      this._planarSync();
    },
    /** The starting player turns cards up until a plane comes up (phenomena to the bottom); nothing triggers. */
    _startingPlane(pid) {
      const deck = this._walkDeckOf(pid);
      for (let guard = 0; guard < 60 && deck.length; guard++) {
        const o = deck.shift();
        if (isPhenomenonCard(o.card)) {
          o.knownTo = ['*'];
          deck.push(o);
          this.logEvent('rules', `${this.player(pid).name} turns ${o.name} face up and puts it on the bottom of the planar deck.`);
          continue;
        }
        this._faceUp(o, { start: true });
        this.logEvent('rules', `The game begins on ${o.name}.`);
        this.emit('planeswalk', { playerId: pid, from: [], to: [o], start: true });
        return o;
      }
      return null;
    },

    /* ---------- the planar die (CR 901.9) ---------- */
    /** What the next roll of the planar die costs this player: {0}, then {1} more each time this turn. */
    planarDieCost(pid) {
      const p = this.player(pid);
      const r = p && p.planarRolls;
      return r && r.turn === this.turn ? (r.n || 0) : 0;
    },
    /** Why this player can't roll the planar die now, or null. */
    planarDieBlock(pid) {
      if (!this.planechaseOn()) return 'This is not a Planechase game.';
      if (this.over || !this.started || this.mulliganPhase) return 'Not now.';
      if (this.pendingChoice) return 'Answer the question first.';
      const why = this._sorcerySpeedBlock(pid);
      if (why) return why === 'Only on your turn.' ? 'Only the player whose turn it is may roll the planar die.' : why;
      return null;
    },
    /** May this player roll the planar die now, and pay for it? */
    canRollPlanarDie(pid) {
      if (this.planarDieBlock(pid)) return false;
      const n = this.planarDieCost(pid);
      return n === 0 || this.canPayNow(pid, '{' + n + '}');
    },
    /** The special action (CR 116.2i): pay for it, then roll. */
    rollPlanarDie(pid, opts) {
      if (this._sacGateWanted(pid, opts)) return this._sacGated(pid, { kind: 'planarDie', opts: opts || {} }, () => this.rollPlanarDie(pid, opts));
      opts = opts || {};
      const why = this.planarDieBlock(pid);
      if (why) return this.fail(why);
      const p = this.player(pid);
      const n = this.planarDieCost(pid);
      if (n > 0 && !this.payMana(pid, '{' + n + '}', Object.assign({ auto: true }, opts))) return this.fail(`Not enough mana to roll the planar die ({${n}}).`);
      p.planarRolls = { turn: this.turn, n: n + 1 };
      if (n > 0) this.logEvent('rules', `${p.name} pays {${n}} to roll the planar die.`);
      this._rollPlanar(pid);
      this.checkStateBasedActions();
      this._resetPriority();
      this.touch();
      return true;
    },
    /** Roll the planar die for this player (the special action, or an effect): the face it shows, and what follows. */
    _rollPlanar(pid, opts) {
      opts = opts || {};
      const p = this.player(pid);
      if (!p || !this.planechaseOn()) return null;
      const n = this.rng.range(1, 6);
      let face = FACE_OF(n);
      this.logEvent('rules', `${p.name} rolls the planar die: ${FACE_WORDS[face]}.`);
      this.emit('roll', Object.assign({ playerId: p.id, sides: 6, result: n, rolls: [n], ignored: [], group: this._newRollGroup(), of: 1, planar: face },
        opts.source ? { sourceId: opts.source.id, sourceName: opts.source.name } : { sourceId: null, sourceName: null }));
      const st = this.planar || (this.planar = { walks: 0 });
      st.lastRoll = { pid, face, turn: this.turn };
      // Chaotic Aether: "each blank roll of the planar die is a {CHAOS} roll until a player planeswalks away from a plane"
      if (face === 'blank' && st.aether) { face = 'chaos'; this.logEvent('rules', 'Chaotic Aether makes the blank a chaos roll.'); }
      // a die rolled, though its number means nothing (CR 901.9d): "whenever you roll one or more dice" triggers
      this._fire('youRoll', pid, { amount: null, amounts: [], dieIndex: 0, playerId: pid, planar: true });
      // Ten Wizards Mountain, Stairs to Infinity: "Whenever you roll the planar die"; Pompeii: "a blank"
      this._fire('youRollPlanar', pid, { playerId: pid, planarFace: face });
      if (face === 'blank') this._fire('youRollPlanarBlank', pid, { playerId: pid });
      if (face === 'chaos') this._chaosEnsues(pid);
      if (face === 'pw') {
        this.pendingTriggers.push({ id: this._uid('tr'), kind: 'ability', obj: null, objId: null, abilityIndex: -1, controller: pid,
          name: 'Planar die — planeswalk', effects: [{ op: 'planeswalk', fromDie: true }], auto: true, abilityText: WALK_TEXT,
          planarWalk: true, triggerData: { event: 'planarDie' } });
      }
      return face;
    },

    /* ---------- chaos (CR 311.7) ---------- */
    /** Chaos ensues: each face-up plane's chaos ability triggers, controlled by the planar controller. */
    _chaosEnsues(pid) {
      if (!this.planechaseOn()) return;
      this.logEvent('rules', 'Chaos ensues.');
      this._fire('chaosEnsues', this.planarController() || pid, { playerId: pid });
    },
    /** "Chaos ensues on that plane" (The Fertile Lands of Saulvinia), "each of the revealed cards' chaos abilities
        triggers" (Pools of Becoming): the chaos abilities of this card, wherever it is (CR 311.7). */
    _chaosOn(o, pid) {
      const a = o && o.analysis();
      if (!a) return;
      a.abilities.forEach((ab, i) => {
        if (ab.kind !== 'triggered' || ab.event !== 'chaosEnsues') return;
        this.pendingTriggers.push({ id: this._uid('tr'), kind: 'ability', obj: o, objId: o.id, abilityIndex: i, controller: pid,
          name: `${o.name} \u2014 ${truncate(MTG.oracle.abilityLabel(ab, o), 50)}`,
          effects: ab.effects, auto: !!ab.auto, abilityText: MTG.oracle.abilityLabel(ab, o), optional: ab.optional,
          triggerData: { event: 'chaosEnsues' } });
      });
    },

    /* ---------- planeswalking (CR 701.31) ---------- */
    /** The deck a player planeswalks from: their own, or (none of their own) the next one round the table that has cards. */
    _walkDeckOf(pid) {
      const own = this.planarDeck(pid);
      if (own.length || !this.planechaseOn()) return own;
      const order = this.turnOrder.length ? this.turnOrder : this.players.map(p => p.id);
      const at = Math.max(0, order.indexOf(pid));
      for (let k = 1; k < order.length; k++) {
        const d = this.planarDeck(order[(at + k) % order.length]);
        if (d.length) return d;
      }
      return own;
    },
    /** Susan Foreman: the permanent of this player's that says "If you would planeswalk, instead look at the top two …". */
    _planeswalkLook(pid) {
      for (const o of this._withEmblems(this.battlefield)) {
        if (o.controller !== pid || o.phasedOut) continue;
        if (this._staticOp(o, 'planeswalkLookTwo')) return o;
      }
      return null;
    },
    /** The question Susan Foreman asks: of the top two cards of the planar deck, which stays on top. */
    _planarTopAsk(pid, src) {
      const two = this._walkDeckOf(pid).slice(0, 2);
      return { type: 'choose', kind: 'objects', playerId: pid, purpose: 'planarTop', zone: 'command', min: 1, max: 1,
        items: this._chooseItems(two), sourceId: src.id, sourceName: src.name, sourceCard: src.card,
        prompt: `${src.name}: you look at the top two cards of your planar deck. Choose the one to put on top — you planeswalk to it. The other goes to the bottom of your planar deck.` };
    },
    /** Susan Foreman's answer: the card kept on top, the other to the bottom, and then the planeswalk itself. */
    _planarTopKeep(pid, keepId) {
      const deck = this._walkDeckOf(pid);
      const two = deck.slice(0, 2);
      const keep = two.find(o => o.id === keepId) || two[0];
      const other = two.find(o => o !== keep);
      if (other) {
        deck.splice(deck.indexOf(other), 1);
        deck.push(other);
        if (keep) { deck.splice(deck.indexOf(keep), 1); deck.unshift(keep); }
        this.logEvent('rules', `${this.player(pid).name} looks at the top two cards of their planar deck and puts one on the bottom.`);
      }
      // what they saw: the card on top is theirs to know until it turns up, the one under is everybody's soon enough
      for (const o of two) o.knownTo = [pid];
    },
    /**
     * Planeswalk, for this player (CR 701.31). From an effect (ctx), a question Susan Foreman asks is asked the way an
     * effect asks (SUSPEND); otherwise it is queued, and the walk is made once it is answered. Returns SUSPEND, or
     * whether a walk happened.
     */
    _planeswalk(pid, opts) {
      opts = opts || {};
      if (!this.planechaseOn()) return false;
      const st = this.planar || (this.planar = { walks: 0 });
      /* Only the planar controller planeswalks (CR 701.31a) — but the planeswalking ability is the roller's, and the
         roller is always the active player: so is the planar controller, unless they have left */
      const pc = this.planarController();
      if (pid !== pc && !opts.anyone) {
        this.logEvent('rules', `${(this.player(pid) || {}).name || 'A player'} can't planeswalk: only the planar controller can.`);
        return false;
      }
      // Fixed Point in Time: "if a player would planeswalk as a result of rolling the planar die, chaos ensues instead"
      if (opts.fromDie && st.fixedPoint) {
        this.logEvent('rules', 'Fixed Point in Time: instead of planeswalking, chaos ensues.');
        this._chaosEnsues(pid);
        return false;
      }
      // Susan Foreman: look at the top two first, one kept on top (when there are two to choose between)
      const susan = opts.looked ? null : this._planeswalkLook(pid);
      if (susan && this._walkDeckOf(pid).length >= 2) {
        if (opts.ctx) {
          const got = this._choose(this._planarTopAsk(pid, susan), 'planarTop');
          if (got === MTG.rules.SUSPEND) return got;
          this._planarTopKeep(pid, got && got.picks && got.picks[0]);
        } else {
          if (st.walking) return false;
          st.walking = { pid, opts: { fromDie: !!opts.fromDie, sba: !!opts.sba } };
          const p = this.player(pid);
          if (p && p.isBot && !this.resolving) {
            const ask = MTG.choice.normalize(this._planarTopAsk(pid, susan));
            const ans = this._decideChoose(pid, ask);
            st.walking = null;
            this._planarTopKeep(pid, ans && ans.picks && ans.picks[0]);
          } else {
            this.queueChoice(MTG.choice.normalize(this._planarTopAsk(pid, susan)));
            return false;
          }
        }
      } else if (susan) {
        this.logEvent('rules', `${susan.name}: ${(this.player(pid) || {}).name} looks at the top of their planar deck.`);
      }
      return this._walk(pid, opts);
    },
    /** Susan Foreman's question answered at the table (not mid-effect): the card on top, then the walk. */
    _planarTopAnswered(ch, pick) {
      const st = this.planar || (this.planar = { walks: 0 });
      const w = st.walking;
      st.walking = null;
      if (!w || w.pid !== ch.playerId) return;
      this._planarTopKeep(ch.playerId, pick);
      this._walk(ch.playerId, Object.assign({}, w.opts, { looked: true }));
      // what the walk set off goes on the stack, and the turn's player has priority again
      if (!this.resolving) { this.checkStateBasedActions(); this._resetPriority(); }
    },
    /**
     * The walk itself: every face-up plane and phenomenon to the bottom of its owner's planar deck, then the top card
     * of this player's turned face up (`two`: Spatial Merging's two at once — the cards to turn up, given).
     */
    _walk(pid, opts) {
      opts = opts || {};
      const st = this.planar || (this.planar = { walks: 0 });
      const p = this.player(pid);
      const away = opts.keep ? [] : this.facePlanes();
      // "When you planeswalk away from …": seen from the plane as it goes (CR 603.10)
      for (const o of away) this._fire('planeswalkAway', o.controller, { source: o, object: o, playerId: pid });
      const fromPlane = away.some(o => !isPhenomenonCard(o.card));
      for (const o of away) this._faceDown(o);
      st.walks = (st.walks || 0) + 1;
      // Chaotic Aether: until a player planeswalks away from a plane
      if (fromPlane && st.aether) st.aether = false;
      // "until a player planeswalks" (CR 901.11): those effects end
      this._planarWalkEnds();
      const deck = this._walkDeckOf(pid);
      const to = [];
      if (opts.cards) {
        for (const o of opts.cards) { const i = deck.indexOf(o); if (i >= 0) { deck.splice(i, 1); to.push(o); } }
      } else if (deck.length) to.push(deck.shift());
      for (const o of to) this._faceUp(o, {});
      this.logEvent('rules', `${p ? p.name : 'The planar controller'} planeswalks${away.length ? ' away from ' + away.map(o => o.name).join(' and ') : ''}${to.length ? ' to ' + to.map(o => o.name).join(' and ') : ''}.`);
      this.emit('sfx', 'planeswalk');
      this.emit('planeswalk', { playerId: pid, from: away, to });
      // "When you planeswalk to …", "When you encounter …"
      for (const o of to) this._fire('planeswalkTo', o.controller, { source: o, object: o, playerId: pid });
      this.bumpBoard();
      return to.length > 0 || away.length > 0;
    },
    /** A card off a planar deck, face up in its owner's command zone, a new object (CR 901.7a), the planar controller's. */
    _faceUp(o, opts) {
      const deck = this.planarDeck(o.owner);
      const i = deck.indexOf(o);
      if (i >= 0) deck.splice(i, 1);
      o.zone = 'command';
      o.planeUp = true;
      o.knownTo = null;
      o.counters = {}; o.effects = []; o.markers = {}; o.note = '';
      o.controller = this.planarController() || o.owner;
      o.ts = this._stampNew();
      o.planeswalkedToTurn = opts && opts.start ? null : this.turn;
      this.zones[o.owner].command.push(o);
      this.bumpBoard();
    },
    /** A face-up plane or phenomenon to the bottom of its owner's planar deck, face down (its counters kept for
        whatever looks back at it as it went: Mount Keralia). */
    _faceDown(o) {
      this._removeFromZone(o);
      o.planeUp = false;
      o.zone = 'planar';
      o.controller = o.owner;
      const z = this.zones[o.owner];
      if (z) (z.planar || (z.planar = [])).push(o);
      this.bumpBoard();
    },
    /** "until a player planeswalks": the effects that last that long end. */
    _planarWalkEnds() {
      const st = this.planar || {};
      const n = st.walks || 0;
      for (const o of this.battlefield) {
        if ((o.effects || []).some(e => e && e.untilWalk != null && e.untilWalk < n)) {
          o.effects = o.effects.filter(e => !(e && e.untilWalk != null && e.untilWalk < n));
          o._chr = null;
        }
        // Unyaro, The Doctor's Childhood Barn: phased out until a player planeswalks
        if (o.phasedOut && o.phasedOutBy === 'planeswalk') { o.phasedOut = false; o.phasedOutBy = null; }
      }
      for (const p of this.players) {
        if (p.planarHolds) { p.planarHolds = p.planarHolds.filter(h => h.untilWalk == null || h.untilWalk >= n); if (!p.planarHolds.length) p.planarHolds = null; }
      }
      this.bumpBoard();
    },

    /* ---------- state-based action (CR 704.6f) ---------- */
    /** A face-up phenomenon with nothing of its own waiting to resolve: the planar controller planeswalks. */
    _planarSba() {
      if (!this.planechaseOn() || !this.started) return false;
      const st = this.planar || {};
      if (st.walking) return false;
      /* Aretopolis: "When Aretopolis has ten or more scroll counters on it, planeswalk." — a state trigger of a face-up
         plane (CR 603.8), put on the stack once while it holds */
      for (const o of this.facePlanes()) {
        const stt = this._staticOp(o, 'stateTrigger');
        if (!stt || !stt.minCounter || (Number(o.counters[stt.minCounter.kind]) || 0) < stt.minCounter.n) continue;
        if (this.pendingTriggers.concat(this.stack).some(x => x && x.objId === o.id && x.stateTrigger)) continue;
        this.pendingTriggers.push({ id: this._uid('tr'), kind: 'ability', obj: o, objId: o.id, abilityIndex: -1, stateTrigger: true,
          controller: o.controller, name: `${o.name} — ${stt.label || 'state trigger'}`, auto: true,
          effects: stt.effects, abilityText: `When ${o.name} has ${stt.label || 'that'}`, triggerData: { event: 'stateTrigger' } });
      }
      const ph = this.facePlanes().filter(o => isPhenomenonCard(o.card));
      if (!ph.length) return false;
      for (const o of ph) {
        if (this.pendingTriggers.some(t => t.objId === o.id)) return false;
        if (this.stack.some(s => s.kind !== 'spell' && s.objId === o.id)) return false;
        // (mid-resolution of its own trigger)
        if (this.resolving && this.resolving.ctx && this.resolving.ctx.obj === o) return false;
      }
      const pc = this.planarController();
      if (!pc) return false;
      const did = this._planeswalk(pc, { sba: true });
      return did === true;
    },

    /* ---------- leaving the game (CR 901.10) ---------- */
    _planarPlayerLeaves(p) {
      if (!this.planechaseOn()) return;
      const gone = this.facePlanes().filter(o => o.owner === p.id);
      for (const o of this.planarDeck(p.id).slice()) { o.zone = null; }
      if (this.zones[p.id]) this.zones[p.id].planar = [];
      for (const o of gone) { this._removeFromZone(o); o.zone = null; o.planeUp = false; }
      const pc = this.planarController();
      this._planarSync();
      if (gone.length && pc) {
        // the planar controller turns the top card of their planar deck face up: they have planeswalked (CR 901.11a)
        this.logEvent('rules', `${gone.map(o => o.name).join(' and ')} ${gone.length > 1 ? 'leave' : 'leaves'} the game with ${p.name}.`);
        this._walk(pc, { keep: true });
      }
    },

    /* ---------- what each player sees ---------- */
    /** view.planechase: the face-up planes for everybody, each planar deck's size, and the die as this player may use it. */
    _planarView(viewer, ser, decides) {
      if (!this.planechaseOn()) return undefined;
      const st = this.planar || {};
      const pc = this.planarController();
      const me = this.player(viewer);
      const myTurn = !!me && this.activePlayer && this.activePlayer.id === viewer;
      const out = {
        controller: pc,
        planes: this.facePlanes().map(o => Object.assign(ser(o), { phenomenon: isPhenomenonCard(o.card) || undefined })),
        decks: Object.fromEntries(this.players.map(q => [q.id, this.planarDeck(q.id).length])),
        walks: st.walks || 0,
      };
      if (myTurn) {
        out.dieCost = this.planarDieCost(viewer);
        out.canRoll = !!decides && this.canRollPlanarDie(viewer);
      }
      if (st.lastRoll) out.lastRoll = { player: st.lastRoll.pid, face: st.lastRoll.face, turn: st.lastRoll.turn };
      if (st.aether) out.chaoticAether = true;
      if (st.fixedPoint) out.fixedPoint = st.fixedPoint;
      return out;
    },
  });

  /** The effect ops (from _runEffect): planeswalk, chaos ensues, roll the planar die, Chaotic Aether, Fixed Point in Time. */
  Object.assign(Game.prototype, {
    /* ---------- what the planes and phenomena do that nothing else does ---------- */
    /** "until a player planeswalks" (CR 901.11): a hold of this kind on this player (Celestine Reef, Eloren Wilds, Agyrem). */
    _planarHeld(pid, kind) {
      const p = this.player(pid);
      return !!(p && p.planarHolds && p.planarHolds.some(h => h.kind === kind));
    },
    /** Why this spell can't be cast, by what a face-up plane says (Eloren Wilds' hold, Prahv, Skybreen) — or null. */
    _planarCastBlock(pid, o, a) {
      if (this._planarHeld(pid, 'cantCast')) return "You can't cast spells until a player planeswalks.";
      for (const pl of this.facePlanes()) {
        for (const e of this._staticOpsAll(pl, 'planarRule')) {
          // Prahv: "If you attacked with creatures this turn, you can't cast spells." (only the turn's player attacks)
          if (e.rule === 'noCastAfterAttack' && pl.controller === pid && this.activePlayer && this.activePlayer.id === pid &&
            ((this.turnHistory || {}).attackers || 0) > 0) return `${pl.name}: you attacked with creatures this turn, so you can't cast spells.`;
          // Skybreen: "Spells that share a card type with the top card of a library can't be cast."
          if (e.rule === 'topTypeLock' && a) {
            const mine = (a.types || []).map(t => String(t).toLowerCase());
            for (const q of this.players) {
              if (q.hasLost) continue;
              const top = ((this.zones[q.id] || {}).library || [])[0];
              const ta = top && top.analysis();
              const shared = ta && (ta.types || []).map(t => String(t).toLowerCase()).find(t => mine.includes(t));
              if (shared) return `${pl.name}: the top card of ${q.name}'s library is ${/^[aeiou]/.test(shared) ? 'an' : 'a'} ${shared} card, so ${shared} spells can't be cast.`;
            }
          }
        }
      }
      return null;
    },
    /** Prahv: "If you cast a spell this turn, you can't attack with creatures." — true when this creature can't attack. */
    _planarAttackBlock(o) {
      for (const pl of this.facePlanes()) {
        for (const e of this._staticOpsAll(pl, 'planarRule')) {
          if (e.rule === 'noAttackAfterCast' && pl.controller === o.controller && ((this.player(o.controller) || {}).spellsCastThisTurn || 0) > 0) return true;
        }
      }
      return false;
    },
    /** Edge of Malacol: "If a creature you control would untap during your untap step, put two +1/+1 counters on it instead." */
    _planarUntapInstead(o) {
      if (!(this.characteristics(o) || {}).isCreature) return false;
      for (const pl of this.facePlanes()) {
        for (const e of this._staticOpsAll(pl, 'planarRule')) {
          if (e.rule !== 'untapToCounters' || pl.controller !== o.controller) continue;
          this.addCounters(o, '+1/+1', e.n || 2);
          this.logEvent('step', `${pl.name}: ${o.name} stays tapped and gets ${e.n || 2} +1/+1 counters instead.`);
          return true;
        }
      }
      return false;
    },
    /** Mount Keralia: damage a plane of that name would deal to a shielded player's permanents is prevented. */
    _planarShielded(source, o) {
      if (!source || !isPlanarCard(source.card)) return false;
      const p = this.player(o.controller);
      return !!(p && p.planarHolds && p.planarHolds.some(h => h.kind === 'planeShield' && h.name === source.name));
    },
    /** Stensia: "Whenever a creature deals damage to one or more players for the first time each turn" — once a turn each. */
    _planarHitPlayer(source, p) {
      if (source.zone !== 'battlefield' || !(this.characteristics(source) || {}).isCreature) return;
      if (source._firstHitTurn === this.turn) return;
      source._firstHitTurn = this.turn;
      this._fire('creatureFirstHitsPlayer', null, { object: source, objController: source.controller, player: p.id });
    },
    /** Trail of the Mage-Rings: "Instant and sorcery spells have rebound." — handed out from a face-up plane. */
    _planarRebound(item) {
      const o = item && item.obj;
      if (!o) return false;
      return this.facePlanes().some(pl => {
        const g = this._staticOp(pl, 'grantCastKeyword');
        return !!g && g.keyword === 'rebound' && (g.anyPlayer || pl.controller === item.controller) && this._cardFitsWords(o, g.filter || 'spell');
      });
    },
    /** Sea of Sand: "Players reveal each card they draw." */
    _planarDrawn(p, o) {
      if (!o || !this.facePlanes().some(pl => this._staticOp(pl, 'revealDraws'))) return;
      this._know(o, '*');
      this.logEvent('rules', `${p.name} reveals ${o.name} as they draw it.`);
    },
    /** The cards from the top of this player's planar deck down to the n-th plane card (fewer, if the deck runs out),
        and the planes among them. Nothing moves: asked twice over a question, it is the same cards both times. */
    _planarRevealUntil(pid, n) {
      const deck = this.planarDeck(pid);
      const seen = [], planes = [];
      for (const o of deck) {
        seen.push(o);
        if (!isPhenomenonCard(o.card)) planes.push(o);
        if (planes.length >= n) break;
      }
      return { seen, planes };
    },
    /** These cards of a planar deck, shown to everybody, then put on its bottom (in this order). */
    _planarToBottom(pid, cards) {
      const deck = this.planarDeck(pid);
      for (const o of cards) { const i = deck.indexOf(o); if (i >= 0) { deck.splice(i, 1); deck.push(o); } }
    },
    _planarShow(pid, cards, words) {
      for (const o of cards) this._know(o, '*');
      if (cards.length) this.logEvent('rules', `${(this.player(pid) || {}).name} reveals ${words || ''}${cards.map(o => o.name).join(', ')}.`);
    },
    /** The ops of {op: 'planar', what}: see each case. */
    _planarDo(e, ctx, targets) {
      const pid = ctx.controller, me = this.player(pid);
      const st = this.planar || (this.planar = { walks: 0 });
      const SUSPEND = MTG.rules.SUSPEND;
      switch (e.what) {
        /* Celestine Reef ("you can't lose the game and your opponents can't win the game"), Eloren Wilds ("target player
           can't cast spells"), Agyrem ("creatures can't attack you") — each until a player planeswalks */
        case 'hold': {
          const t = e.who === 'target' ? (targets || []).find(x => x && x.kind === 'player') : null;
          const p = t ? this.player(t.id) : me;
          if (!p) return null;
          // (Mount Keralia: "this game" — no planeswalk ends it, the plane's name kept: forGame)
          (p.planarHolds = p.planarHolds || []).push(Object.assign({ kind: e.kind, untilWalk: e.forGame ? null : (st.walks || 0) },
            e.forGame && ctx.obj ? { name: ctx.obj.name } : {}));
          const say = { cantLose: `${p.name} can't lose the game, and their opponents can't win it`, cantCast: `${p.name} can't cast spells`,
            notAttacked: `creatures can't attack ${p.name}` }[e.kind];
          if (e.kind === 'planeShield') this.logEvent('rules', `For the rest of the game, damage planes named ${(ctx.obj && ctx.obj.name) || 'this'} would deal to permanents ${p.name} controls is prevented.`);
          else this.logEvent('rules', `Until a player planeswalks, ${say || e.kind}.`);
          return null;
        }
        // Unyaro: "They phase out until a player planeswalks." — every creature
        case 'phaseOutCreatures': {
          const all = this.battlefield.filter(o => !o.phasedOut && (this.characteristics(o) || {}).isCreature);
          for (const o of all) {
            o.phasedOut = true; o.phasedOutBy = 'planeswalk'; o.phasedTurn = this.turn;
            for (const id of (o.attachments || [])) { const at = this.obj(id); if (at && !at.phasedOut) { at.phasedOut = true; at.phasedOutBy = 'planeswalk'; at.phasedTurn = this.turn; } }
          }
          if (all.length) this.logEvent('rules', `${all.length} creature${all.length === 1 ? '' : 's'} phase${all.length === 1 ? 's' : ''} out until a player planeswalks.`);
          this.bumpBoard();
          return null;
        }
        // Time Distortion, Temple of Atropos: "reverse the game's turn order" — the turn's player and priority stay where they are
        case 'reverseTurnOrder': {
          const ap = this.turnOrder[this.activeIndex], pp = this.priorityIndex != null ? this.turnOrder[this.priorityIndex] : null;
          this.turnOrder.reverse();
          this.activeIndex = this.turnOrder.indexOf(ap);
          if (pp != null && this.turnOrder.includes(pp)) this.priorityIndex = this.turnOrder.indexOf(pp);
          this.logEvent('rules', `The turn order is reversed: ${this.turnOrder.map(id => (this.player(id) || {}).name).join(' \u2192 ')}.`);
          this.bumpBoard();
          return null;
        }
        // Unleash the Flux: "each player sacrifices a nonland permanent of their choice, then you flip a coin. If you lose the flip, repeat this process."
        case 'flux': {
          if (!this.battlefield.some(o => !o.phasedOut && !(this.characteristics(o) || {}).isLand)) {
            this.logEvent('rules', 'There are no nonland permanents left to sacrifice.');
            return null;
          }
          this._spliceNext([{ op: 'sacrificeChoice', n: 1, who: 'each', filter: 'nonland permanent' },
            { op: 'flipCoin', otherwise: [{ op: 'planar', what: 'flux' }] }]);
          return null;
        }
        // Stairs to Infinity: "reveal the top card of your planar deck. You may put it on the bottom of your planar deck."
        case 'topMayBottom': {
          const top = this.planarDeck(pid)[0];
          if (!top) return null;
          if (!this._doneHere('pcTopShow')) this._planarShow(pid, [top], 'the top card of their planar deck: ');
          const yes = this._ask({ type: 'confirm', playerId: pid, purpose: 'planarBottom', yesLabel: 'Bottom', noLabel: 'Keep on top',
            prompt: `${(ctx.obj && ctx.obj.name) || 'Stairs to Infinity'}: put ${top.name} on the bottom of your planar deck?` }, 'pcBottom');
          if (yes === SUSPEND) return yes;
          if (yes) { this._planarToBottom(pid, [top]); this.logEvent('rules', `${me.name} puts ${top.name} on the bottom of their planar deck.`); }
          return null;
        }
        /* The Fertile Lands of Saulvinia: until a plane is revealed, chaos ensues on it; Pools of Becoming: the top three,
           each one's chaos abilities trigger — then the revealed cards go to the bottom */
        case 'chaosFromDeck': {
          const shown = e.top ? this.planarDeck(pid).slice(0, e.top) : this._planarRevealUntil(pid, e.planes || 1).seen;
          this._planarShow(pid, shown, e.top ? 'the top of their planar deck: ' : '');
          const on = e.top ? shown : shown.filter(o => !isPhenomenonCard(o.card)).slice(-1);
          this._planarToBottom(pid, shown);
          for (const o of on) this._chaosOn(o, pid);
          return null;
        }
        // Norn's Seedcore: "Planeswalk to it, except don't planeswalk away from any plane." — the rest to the bottom
        case 'walkToAlso': {
          const { seen, planes } = this._planarRevealUntil(pid, 1);
          this._planarShow(pid, seen);
          this._planarToBottom(pid, seen.filter(o => !planes.includes(o)));
          if (planes.length) this._walk(pid, { cards: planes, keep: true });
          return null;
        }
        // Spatial Merging: "Simultaneously planeswalk to both of them." — the rest to the bottom
        case 'merge': {
          const { seen, planes } = this._planarRevealUntil(pid, e.n || 2);
          this._planarShow(pid, seen);
          this._planarToBottom(pid, seen.filter(o => !planes.includes(o)));
          if (planes.length) this._walk(pid, { cards: planes });
          return null;
        }
        /* Interplanar Tunnel: "Put a plane card from among them on top of your planar deck, then put the rest of the revealed
           cards on the bottom in a random order." */
        case 'tunnel': {
          const { seen, planes } = this._planarRevealUntil(pid, e.n || 5);
          if (!seen.length) return null;
          if (!this._doneHere('pcTunnelShow')) this._planarShow(pid, seen);
          let keep = planes[0] || null;
          if (planes.length > 1) {
            const got = this._choose({ playerId: pid, purpose: 'planarTunnel', kind: 'objects', zone: 'command', min: 1, max: 1,
              items: this._chooseItems(planes), sourceId: ctx.obj ? ctx.obj.id : undefined, sourceName: (ctx.obj && ctx.obj.name) || 'Interplanar Tunnel',
              prompt: `${(ctx.obj && ctx.obj.name) || 'Interplanar Tunnel'}: choose the plane to put on top of your planar deck — you planeswalk to it next.` }, 'pcTunnel');
            if (got === SUSPEND) return got;
            keep = planes.find(o => got && got.picks && got.picks[0] === o.id) || planes[0];
          }
          const rest = seen.filter(o => o !== keep);
          this.rng.shuffle(rest);
          const deck = this.planarDeck(pid);
          this._planarToBottom(pid, rest);
          if (keep) { deck.splice(deck.indexOf(keep), 1); deck.unshift(keep); this.logEvent('rules', `${me.name} puts ${keep.name} on top of their planar deck.`); }
          return null;
        }
        // The Western Cloud: the tokens just made each deal the damage, a source each
        case 'tokensDeal': {
          const made = this.battlefield.filter(o => o.isToken && o.controller === pid && o.name === e.token).sort((x, y) => (y.ts || 0) - (x.ts || 0)).slice(0, e.count || 1);
          this._spliceNext(made.map(o => ({ op: 'damage', n: e.n || 1, each: e.each, fromObjId: o.id })));
          return null;
        }
        // Furnace Layer: "select target player at random" — "that player" from here on
        case 'randomPlayer': {
          const live = this.players.filter(q => !q.hasLost);
          if (!live.length) return null;
          if (ctx.chosenPlayer == null || !this._doneHere('pcRandom')) ctx.chosenPlayer = live[this.rng.range(0, live.length - 1)].id;
          this.logEvent('rules', `${(this.player(ctx.chosenPlayer) || {}).name} is selected at random.`);
          return null;
        }
        // Norn's Dominion: "then remove all fate counters from all permanents"
        case 'clearCounters': {
          for (const o of this.battlefield) if (o.counters && o.counters[e.kind]) { delete o.counters[e.kind]; o._chr = null; }
          this.bumpBoard();
          return null;
        }
        /* The Maelstrom: the top card revealed if you like; a permanent card may go onto the battlefield; a card revealed
           and not put there goes to the bottom */
        case 'maelstrom': {
          const z = this.zones[pid];
          const top = z && z.library[0];
          if (!top) return null;
          const look = this._ask({ type: 'confirm', playerId: pid, purpose: 'maelstromReveal', prompt: `${(ctx.obj && ctx.obj.name) || 'The Maelstrom'}: reveal the top card of your library?` }, 'pcMaelA');
          if (look === SUSPEND) return look;
          if (!look) return null;
          if (!this._doneHere('pcMaelShow')) { this._know(top, '*'); this.logEvent('rules', `${me.name} reveals ${top.name}.`); }
          const perm = (top.analysis() || {}).isPermanent;
          let put = false;
          if (perm) {
            put = this._ask({ type: 'confirm', playerId: pid, purpose: 'maelstromPut', prompt: `${(ctx.obj && ctx.obj.name) || 'The Maelstrom'}: put ${top.name} onto the battlefield?` }, 'pcMaelB');
            if (put === SUSPEND) return put;
          }
          if (put) this.moveObject(top, 'battlefield', { controller: pid });
          else { z.library.splice(z.library.indexOf(top), 1); z.library.push(top); this.logEvent('rules', `${me.name} puts ${top.name} on the bottom of their library.`); }
          return null;
        }
        /* Grand Ossuary: "each player exiles all creatures they control and creates X 1/1 green Saproling creature tokens,
           where X is the total power of the creatures they exiled this way" */
        case 'ossuary': {
          for (const q of this.players.filter(x => !x.hasLost)) {
            const theirs = this.battlefield.filter(o => o.controller === q.id && !o.phasedOut && (this.characteristics(o) || {}).isCreature);
            const power = theirs.reduce((k, o) => k + Math.max(0, this.powerOf(o)), 0);
            for (const o of theirs) this.moveObject(o, 'exile');
            if (theirs.length) this.logEvent('rules', `${q.name} exiles ${theirs.length} creature${theirs.length === 1 ? '' : 's'} (total power ${power}).`);
            if (power > 0) this._createToken(q.id, { n: power, pt: '1/1', colorWords: ['green'], subtypes: 'Saproling', keywords: [] });
          }
          return null;
        }
        // Dalek Intensive Care: "exile a non-Dalek creature you control. If you do, …"
        case 'exileYoursThen': {
          const pool = this.battlefield.filter(o => o.controller === pid && !o.phasedOut && (this.characteristics(o) || {}).isCreature &&
            this._cardFitsWords(o, e.filter || 'creature'));
          if (!pool.length) { this.logEvent('rules', `${me.name} has no ${e.filter || 'creature'} to exile.`); return null; }
          let pick = pool[0];
          if (pool.length > 1) {
            const got = this._choose({ playerId: pid, purpose: 'exileYours', kind: 'objects', zone: 'battlefield', min: 1, max: 1, items: this._chooseItems(pool),
              prompt: `${(ctx.obj && ctx.obj.name) || 'Effect'}: exile a ${e.filter || 'creature'} you control.` }, 'pcExile');
            if (got === SUSPEND) return got;
            pick = pool.find(o => got && got.picks && got.picks[0] === o.id) || pool[0];
          }
          this.moveObject(pick, 'exile');
          this.logEvent('rules', `${me.name} exiles ${pick.name}.`);
          if (pick.zone === 'exile') this._spliceNext(e.then || []);
          return null;
        }
        // The Dining Car: "sacrifice a creature with the least toughness among creatures you control" — a choice among the tied
        case 'sacLeast': {
          const mine = this.battlefield.filter(o => o.controller === pid && !o.phasedOut && (this.characteristics(o) || {}).isCreature && this._canSacrifice(o));
          if (!mine.length) return null;
          const val = (o) => e.stat === 'power' ? this.powerOf(o) : this.toughnessOf(o);
          const least = Math.min(...mine.map(val));
          const pool = mine.filter(o => val(o) === least);
          let pick = pool[0];
          if (pool.length > 1) {
            const got = this._choose({ playerId: pid, purpose: 'sacrificeLeast', kind: 'objects', zone: 'battlefield', min: 1, max: 1, items: this._chooseItems(pool),
              prompt: `${(ctx.obj && ctx.obj.name) || 'Effect'}: sacrifice a creature with the least ${e.stat || 'toughness'} (${least}).` }, 'pcLeast');
            if (got === SUSPEND) return got;
            pick = pool.find(o => got && got.picks && got.picks[0] === o.id) || pool[0];
          }
          this._sacrificeNow(pid, [pick], ctx);
          return null;
        }
        // Minamo: "each player may return a blue card from their graveyard to their hand" — in turn order, from the planar controller
        case 'eachMayReturn': {
          const order = this.turnOrder.length ? this.turnOrder : this.players.map(q => q.id);
          const at = Math.max(0, order.indexOf(pid));
          for (let k = 0; k < order.length; k++) {
            const q = this.player(order[(at + k) % order.length]);
            if (!q || q.hasLost) continue;
            const pool = ((this.zones[q.id] || {}).graveyard || []).filter(c => this._cardFitsWords(c, e.filter || 'card'));
            if (!pool.length) continue;
            const got = this._choose({ playerId: q.id, purpose: 'mayReturn', kind: 'objects', zone: 'graveyard', min: 0, max: 1, optional: true,
              items: this._chooseItems(pool), prompt: `${(ctx.obj && ctx.obj.name) || 'Effect'}: you may return a ${e.filter || ''} card from your graveyard to your hand.` }, 'pcRet' + q.id);
            if (got === SUSPEND) return got;
            const c = pool.find(x => got && got.picks && got.picks[0] === x.id);
            if (c && !this._doneHere('pcRetDone' + q.id)) { this.moveObject(c, 'hand'); this.logEvent('rules', `${q.name} returns ${c.name} to their hand.`); }
          }
          return null;
        }
        // The Great Aerie: each of the two deals damage equal to its toughness to the other
        case 'toughnessBite': {
          const objs = (targets || []).filter(t => t && t.kind === 'object').map(t => this.obj(t.id)).filter(o => o && o.zone === 'battlefield');
          if (objs.length < 2) { this.logEvent('rules', 'There is no other creature to deal damage to.'); return null; }
          const [a, b] = objs;
          const ta = this.toughnessOf(a), tb = this.toughnessOf(b);
          if (ta > 0) this.dealDamageToObject(b, ta, a);
          if (tb > 0) this.dealDamageToObject(a, tb, b);
          return null;
        }
        // City of the Daleks: a token for each opponent, attacking that one this turn if able, hasty, sacrificed at the end step
        case 'tokenAtEachOpponent': {
          for (const foe of this.opponentsOf(pid)) {
            const before = new Set(this.battlefield.map(o => o.id));
            this._createToken(pid, Object.assign({}, e.token));
            for (const o of this.battlefield.filter(x => !before.has(x.id) && x.isToken && x.controller === pid)) {
              o.mustAttackPlayer = foe.id;
              o.sacAtEndOfTurn = this.turn;
              o.effects.push({ keywords: ['Haste'], until: 'eot' });
              o._chr = null;
            }
          }
          this.bumpBoard();
          return null;
        }
        // Kharasha Foothills: "you may sacrifice any number of creatures. If you do, CARDNAME deals that much damage to target creature."
        case 'sacAnyDamage': {
          const t0 = (targets || []).find(x => x && x.kind === 'object');
          const victim = t0 && this.obj(t0.id);
          const mine = this.battlefield.filter(o => o.controller === pid && !o.phasedOut && (this.characteristics(o) || {}).isCreature && this._canSacrifice(o));
          if (!mine.length) return null;
          const got = this._choose({ playerId: pid, purpose: 'sacrificeAny', kind: 'objects', zone: 'battlefield', min: 0, max: mine.length, optional: true,
            items: this._chooseItems(mine), prompt: `${(ctx.obj && ctx.obj.name) || 'Effect'}: sacrifice any number of creatures — that much damage to ${victim ? victim.name : 'the target'}.` }, 'pcSacAny');
          if (got === SUSPEND) return got;
          const picks = mine.filter(o => got && (got.picks || []).includes(o.id));
          if (!picks.length) return null;
          this._sacrificeNow(pid, picks, ctx);
          if (victim && victim.zone === 'battlefield') this.dealDamageToObject(victim, picks.length, ctx.obj || null);
          return null;
        }
        // The Wilds: a Food for the sacrifice, two for one of toughness 4 or more
        case 'wildsFood': {
          const s0 = (this._lastSacrificed || [])[0];
          if (!s0) return null;
          this._spliceNext([{ op: 'createNamedToken', token: 'Food', n: s0.toughness >= 4 ? 2 : 1 }]);
          return null;
        }
        /* Two Streams Facility: each player chooses green anchor or red waterfall (mode choose), or each one's choice turns
           to the other (mode swap) — kept as player.planarStream */
        case 'stream': {
          const order = this.turnOrder.length ? this.turnOrder : this.players.map(q => q.id);
          const at = Math.max(0, order.indexOf(pid));
          for (let k = 0; k < order.length; k++) {
            const q = this.player(order[(at + k) % order.length]);
            if (!q || q.hasLost) continue;
            if (e.mode === 'swap') {
              if (q.planarStream) q.planarStream = q.planarStream === 'anchor' ? 'waterfall' : 'anchor';
              continue;
            }
            const got = this._choose({ playerId: q.id, purpose: 'planarStream', kind: 'options', min: 1, max: 1,
              options: [{ label: 'Green anchor', value: 'anchor' }, { label: 'Red waterfall', value: 'waterfall' }],
              prompt: `${(ctx.obj && ctx.obj.name) || 'Two Streams Facility'}: green anchor (an additional land each turn) or red waterfall (your creatures get +2/+0 and haste)?` }, 'pcStream' + q.id);
            if (got === SUSPEND) return got;
            const i = got && got.picks ? got.picks[0] : 0;
            q.planarStream = i === 1 || i === 'waterfall' ? 'waterfall' : 'anchor';
          }
          this.logEvent('rules', this.players.filter(q => !q.hasLost && q.planarStream).map(q => `${q.name}: ${q.planarStream === 'anchor' ? 'green anchor' : 'red waterfall'}`).join(', ') + '.');
          this.bumpBoard();
          return null;
        }
        // Bad Wolf Bay: "cards can't enter from exile this turn"
        case 'noEnterFromExile': {
          st.noExileEnter = this.turn;
          this.logEvent('rules', 'Cards can\'t enter from exile this turn.');
          return null;
        }
        // Talon Gates: "remove two time counters from each suspended card you own" — the last one off, it is cast
        case 'untime': {
          for (const o of ((this.zones[pid] || {}).exile || []).slice()) {
            if (o.suspendedBy !== pid || !o.counters.time) continue;
            const k = Math.min(e.n || 1, o.counters.time);
            for (let i = 0; i < k; i++) { o.counters.time--; this._fire('timeCounterRemoved', o.owner, { object: o, source: o }); }
            this.logEvent('rules', `${o.name}: ${o.counters.time} time counter${o.counters.time === 1 ? '' : 's'} left.`);
            if (o.counters.time <= 0) this._castFromSuspend(pid, o);
          }
          this.bumpBoard();
          return null;
        }
        // Glimmervoid Basin: "Each player except that creature's controller creates a token that's a copy of that creature."
        case 'copyForOthers': {
          const t0 = (targets || []).find(x => x && x.kind === 'object');
          const c = t0 && this.obj(t0.id);
          if (!c || c.zone !== 'battlefield') return null;
          for (const q of this.players) {
            if (q.hasLost || q.id === c.controller) continue;
            this._runEffect({ op: 'copyPermanent', _forced: c, n: 1, grant: [] }, Object.assign({}, ctx, { controller: q.id }));
          }
          return null;
        }
        /* Caught in a Parallel Universe: each player chooses a creature of the player to their left, then each makes a copy
           of the one chosen, with menace — the choices first, the tokens together after */
        case 'parallel': {
          const sc = this._specCtx();
          const order = this.turnOrder.filter(id => { const q = this.player(id); return q && !q.hasLost; });
          const at = Math.max(0, order.indexOf(pid));
          const picks = [];
          for (let k = 0; k < order.length; k++) {
            const q = this.player(order[(at + k) % order.length]);
            const left = sc.sideOf(q.id, 'left');
            const pool = this.battlefield.filter(o => o.controller === left && !o.phasedOut && (this.characteristics(o) || {}).isCreature);
            if (!pool.length) continue;
            let c = pool[0];
            if (pool.length > 1) {
              const got = this._choose({ playerId: q.id, purpose: 'parallelPick', kind: 'objects', zone: 'battlefield', min: 1, max: 1, items: this._chooseItems(pool),
                prompt: `${(ctx.obj && ctx.obj.name) || 'Caught in a Parallel Universe'}: choose a creature ${(this.player(left) || {}).name} controls — you get a copy of it, with menace.` }, 'pcPar' + q.id);
              if (got === SUSPEND) return got;
              c = pool.find(o => got && got.picks && got.picks[0] === o.id) || pool[0];
            }
            picks.push([q.id, c]);
          }
          for (const [qid, c] of picks) this._runEffect({ op: 'copyPermanent', _forced: c, n: 1, grant: (e.grant || []).slice() }, Object.assign({}, ctx, { controller: qid }));
          return null;
        }
        /* Human—Time Lord Meta-Crisis: each player chooses one or two of their creatures; a copy of the first, not legendary,
           with +1/+1 counters equal to the second's power */
        case 'metaCrisis': {
          const order = this.turnOrder.filter(id => { const q = this.player(id); return q && !q.hasLost; });
          const at = Math.max(0, order.indexOf(pid));
          const picks = [];
          for (let k = 0; k < order.length; k++) {
            const q = this.player(order[(at + k) % order.length]);
            const pool = this.battlefield.filter(o => o.controller === q.id && !o.phasedOut && (this.characteristics(o) || {}).isCreature);
            if (!pool.length) continue;
            let chosen = [pool[0]];
            if (pool.length > 1) {
              const got = this._choose({ playerId: q.id, purpose: 'metaCrisisPick', kind: 'objects', zone: 'battlefield', min: 1, max: 2, ordered: true, items: this._chooseItems(pool),
                prompt: `${(ctx.obj && ctx.obj.name) || 'Meta-Crisis'}: choose one or two of your creatures — a copy of the first, with +1/+1 counters equal to the second's power.` }, 'pcMeta' + q.id);
              if (got === SUSPEND) return got;
              const ids = (got && (got.order || got.picks)) || [];
              chosen = ids.map(id => pool.find(o => o.id === id)).filter(Boolean);
              if (!chosen.length) chosen = [pool[0]];
            }
            picks.push([q.id, chosen[0], chosen[1] ? Math.max(0, this.powerOf(chosen[1])) : 0]);
          }
          for (const [qid, first, n] of picks) {
            const before = new Set(this.battlefield.map(o => o.id));
            this._runEffect({ op: 'copyPermanent', _forced: first, n: 1, grant: [], nonLegendary: true }, Object.assign({}, ctx, { controller: qid }));
            const tok = this.battlefield.find(o => !before.has(o.id) && o.controller === qid);
            if (tok && n > 0) this.addCounters(tok, '+1/+1', n);
          }
          return null;
        }
        // Lair of the Ashen Idol: "sacrifice a creature. If you can't, planeswalk."
        case 'sacOrWalk': {
          const can = this.battlefield.some(o => o.controller === pid && !o.phasedOut && (this.characteristics(o) || {}).isCreature && this._canSacrifice(o));
          if (can) { this._spliceNext([{ op: 'sacrificeChoice', n: 1, who: 'you', filter: 'creature' }]); return null; }
          this.logEvent('rules', `${me.name} can't sacrifice a creature.`);
          const r = this._planeswalk(pid, { ctx });
          return r === SUSPEND ? r : null;
        }
        /* The Matrix of Time: "that card's owner loses 3 life and exiles the top card of their library" — the card played from
           among those exiled with it; the new one exiled with it too */
        case 'matrixToll': {
          const c = this.obj((ctx.triggerData || {}).objectId);
          const owner = c && this.player(c.owner);
          if (!owner || owner.hasLost) return null;
          this.changeLife(owner, -(e.n || 3));
          this.logEvent('life', `${owner.name} loses ${e.n || 3} life.`);
          const top = ((this.zones[owner.id] || {}).library || [])[0];
          if (top) {
            this.moveObject(top, 'exile');
            if (top.zone === 'exile' && ctx.obj) { top.exiledWithId = ctx.obj.id; top.exiledWithTs = ctx.obj.ts; }
            this.logEvent('exile', `${owner.name} exiles ${top.name} from the top of their library.`);
          }
          return null;
        }
        /* Happy Yargle Day!: "if that player doesn't control a creature named Yargle, Glutton of Urborg, that player puts a
           bargle counter on a creature they control. It becomes a copy of Yargle, Glutton of Urborg, except it isn't legendary."
           — the player whose end step it is */
        case 'yargle': {
          const q = this.activePlayer;
          if (!q || q.hasLost) return null;
          const creatures = this.battlefield.filter(o => o.controller === q.id && !o.phasedOut && (this.characteristics(o) || {}).isCreature);
          if (creatures.some(o => o.name === e.name)) return null;
          if (!creatures.length) return null;
          let c = creatures[0];
          if (creatures.length > 1) {
            const got = this._choose({ playerId: q.id, purpose: 'yargleCopy', kind: 'objects', zone: 'battlefield', min: 1, max: 1, items: this._chooseItems(creatures),
              prompt: `${(ctx.obj && ctx.obj.name) || 'Effect'}: put a ${e.counter || 'bargle'} counter on a creature you control. It becomes a copy of ${e.name}, except it isn't legendary.` }, 'pcYg');
            if (got === SUSPEND) return got;
            c = creatures.find(o => got && got.picks && got.picks[0] === o.id) || creatures[0];
          }
          this.addCounters(c, e.counter || 'bargle', 1);
          const card = this._cardByName(e.name);
          if (!card) { this.logEvent('rules', `There is no card named ${e.name} to copy.`); return null; }
          const was = c.name;
          c.printedCard = c.printedCard || c.card;
          c.copyOf = card;
          c.card = this._copyExcept(card, c.printedCard, { nonLegendary: true });
          c.face = 0; c.copyUntilTurn = null; c.copyUntilTurnOf = null; c.copyBefore = null;
          c._chr = null;
          this.bumpBoard();
          this.logEvent('rules', `${was} becomes a copy of ${e.name}, except it isn't legendary.`);
          return null;
        }
        /* Imaginary Friends: "exile cards from the top of your library until you reveal a nonland card. You may cast that card
           without paying its mana cost, but only as another card following this plane's first ability. Put the rest on the
           bottom of your library in a random order." — those not cast, the nonland card among them */
        case 'imaginaryChaos': {
          const z = this.zones[pid];
          const r = this.resolving;
          if (r) r.marks = r.marks || {};
          const mk = r ? r.index + ':ifEx' : null;
          let stx = r ? r.marks[mk] : null;
          if (!stx) {
            const ex = [];
            let hit = null;
            while (z.library.length) {
              const c = z.library[0];
              this.moveObject(c, 'exile');
              if (c.zone !== 'exile') break;
              ex.push(c.id);
              if (!(c.analysis() || {}).isLand) { hit = c.id; break; }
            }
            stx = { ex, hit };
            if (r) r.marks[mk] = stx;
            if (ex.length) this.logEvent('exile', `${me.name} exiles ${ex.map(id => (this.obj(id) || {}).name).join(', ')} from the top of their library.`);
          }
          const hit = stx.hit ? this.obj(stx.hit) : null;
          if (hit && hit.zone === 'exile') {
            const cands = this._imaginaryCandidates(pid, hit);
            if (!cands.length) this.logEvent('rules', `There is no other card with ${hit.name}'s type and mana cost to cast it as.`);
            else {
              const got = this._choose({ playerId: pid, purpose: 'castAs', kind: 'options', min: 0, max: 1, optional: true, noneLabel: 'Don\u2019t cast it',
                options: cands.map((c, i) => ({ i, label: c.name, cards: [c] })),
                prompt: `${(ctx.obj && ctx.obj.name) || 'Imaginary Friends'}: you may cast ${hit.name} without paying its mana cost, but only as another card with the same type and mana cost — which?` }, 'ifAs');
              if (got === SUSPEND) return got;
              const pick = got && (got.picks || []).length ? cands[got.picks[0]] : null;
              if (pick) {
                if (!this._doneHere('ifSwap')) this._castAsSwap(hit, pick);
                const tg = this._askSpellTargets(pid, hit, 'ifT');
                if (tg === SUSPEND) return tg;
                const ok = tg ? this.castSpell(pid, hit.id, { alternative: 'resolution', free: true, costOverride: '', targets: tg, auto: true }) : false;
                if (!ok || hit.zone !== 'stack') this._castAsRevert(hit);
              }
            }
          }
          const rest = stx.ex.map(id => this.obj(id)).filter(c => c && c.zone === 'exile');
          this.rng.shuffle(rest);
          for (const c of rest) this.moveObject(c, 'library', { toBottom: true });
          if (rest.length) this.logEvent('rules', `${me.name} puts ${MTG.oracle.nounCount(rest.length, 'card')} on the bottom of their library in a random order.`);
          return null;
        }
        /* Singing Towers of Darillium: "you may cast a foretold card you own from exile without paying its mana cost this turn"
           — one of them, cast at its own speed (a lot: the first cast uses the leave up) */
        case 'freeForetold': {
          const gid = this._uid('ff');
          const mine = ((this.zones[pid] || {}).exile || []).filter(c => c.owner === pid && c.foretold);
          for (const c of mine) { c.freeCastBy = pid; c.freeCastTurn = this.turn; c.impulseGroup = gid; }
          this.logEvent('rules', mine.length ? `${me.name} may cast one of their foretold cards without paying its mana cost this turn.` : `${me.name} has no foretold card in exile.`);
          return null;
        }
        /* sAnS mERcY: "each player chooses a nonblack creature they control. Destroy those creatures." — chosen in turn order,
           destroyed together */
        case 'eachChooseDestroy': {
          const order = this.turnOrder.length ? this.turnOrder : this.players.map(q => q.id);
          const at = Math.max(0, order.indexOf(pid));
          const picks = [];
          for (let k = 0; k < order.length; k++) {
            const q = this.player(order[(at + k) % order.length]);
            if (!q || q.hasLost) continue;
            const pool = this.battlefield.filter(o => o.controller === q.id && !o.phasedOut && (this.characteristics(o) || {}).isCreature && this._cardFitsWords(o, e.filter || 'creature'));
            if (!pool.length) continue;
            let c = pool[0];
            if (pool.length > 1) {
              const got = this._choose({ playerId: q.id, purpose: 'chooseToDestroy', kind: 'objects', zone: 'battlefield', min: 1, max: 1, harmful: true, items: this._chooseItems(pool),
                prompt: `${(ctx.obj && ctx.obj.name) || 'Effect'}: choose a ${e.filter || 'creature'} you control. It is destroyed.` }, 'pcCD' + q.id);
              if (got === SUSPEND) return got;
              c = pool.find(o => got && got.picks && got.picks[0] === o.id) || pool[0];
            }
            picks.push(c);
          }
          if (picks.length) this.logEvent('rules', `Chosen: ${picks.map(o => o.name).join(', ')}.`);
          for (const o of picks) {
            if (o.zone !== 'battlefield') continue;
            if (this.hasKw(o, 'indestructible')) { this.logEvent('rules', `${o.name} is indestructible.`); continue; }
            if (this._totemArmor(o) || this._regenerated(o)) continue;
            this.moveObject(o, 'graveyard');
          }
          return null;
        }
        /* Morphic Tide: each player's permanents counted and shuffled into their library, that many cards revealed; the
           artifacts, creatures, lands and planeswalkers among them onto the battlefield, then the enchantments, the rest to
           the bottom (tokens count, and cease to exist) */
        case 'morphicTide': {
          const order = this.turnOrder.length ? this.turnOrder : this.players.map(q => q.id);
          const at = Math.max(0, order.indexOf(pid));
          const live = [];
          for (let k = 0; k < order.length; k++) { const q = this.player(order[(at + k) % order.length]); if (q && !q.hasLost) live.push(q); }
          const counts = new Map(live.map(q => [q.id, this.battlefield.filter(o => o.owner === q.id).length]));
          for (const q of live) {
            for (const o of this.battlefield.filter(x => x.owner === q.id)) this.moveObject(o, 'library');
            this.rng.shuffle(this.zones[q.id].library);
            this.logEvent('rules', `${q.name} shuffles ${MTG.oracle.nounCount(counts.get(q.id), 'permanent')} into their library.`);
          }
          const shown = new Map();
          for (const q of live) {
            const cards = this.zones[q.id].library.slice(0, counts.get(q.id));
            shown.set(q.id, cards);
            this._planarShow(q.id, cards);
          }
          const isA = (c, words) => words.some(w => this._cardFitsWords(c, w));
          for (const wave of [['artifact', 'creature', 'land', 'planeswalker'], ['enchantment']]) {
            for (const q of live) for (const c of shown.get(q.id)) if (c.zone === 'library' && isA(c, wave)) this.moveObject(c, 'battlefield', { controller: q.id });
          }
          for (const q of live) {
            const lib = this.zones[q.id].library;
            for (const c of shown.get(q.id)) { const i = lib.indexOf(c); if (i >= 0) { lib.splice(i, 1); lib.push(c); } }
          }
          this.bumpBoard();
          return null;
        }
        /* The Doctor's Childhood Barn: "Untap those permanents. They phase out. They can't phase in for as long as CARDNAME
           remains face up. When a player planeswalks, those permanents phase in." — the targets, phased out until a player
           planeswalks (phasedOutBy 'planeswalk': no untap step brings them back) */
        case 'barn': {
          const objs = (targets || []).filter(t => t && t.kind === 'object').map(t => this.obj(t.id)).filter(o => o && o.zone === 'battlefield' && !o.phasedOut);
          for (const o of objs) {
            this._markUntapped(o);
            o.phasedOut = true; o.phasedOutBy = 'planeswalk'; o.phasedTurn = this.turn;
            for (const id of (o.attachments || [])) { const at = this.obj(id); if (at && !at.phasedOut) { at.phasedOut = true; at.phasedOutBy = 'planeswalk'; at.phasedTurn = this.turn; } }
          }
          if (objs.length) this.logEvent('rules', `${objs.map(o => o.name).join(' and ')} untap${objs.length === 1 ? 's' : ''} and phase${objs.length === 1 ? 's' : ''} out until a player planeswalks.`);
          this.bumpBoard();
          return null;
        }
        /* Mondassian Colony Ship: "it gets +1/+1 until end of turn for each other creature its controller controls that shares
           a creature type with it" — the attacker the trigger is about, counted as it resolves */
        case 'kinPump': {
          const o = this.obj((ctx.triggerData || {}).objectId);
          if (!o || o.zone !== 'battlefield') return null;
          const k = this.battlefield.filter(x => x !== o && !x.phasedOut && x.controller === o.controller &&
            (this.characteristics(x) || {}).isCreature && this._shareCreatureType(o, x)).length;
          if (k > 0) {
            o.effects.push({ p: k * (e.n || 1), t: k * (e.n || 1), until: 'eot' });
            o._chr = null;
            this.bumpBoard();
            this.logEvent('rules', `${o.name} gets +${k * (e.n || 1)}/+${k * (e.n || 1)} until end of turn.`);
          }
          return null;
        }
        /* Enigma Ridges: "each player who controls fewer lands than the player who controls the most lands searches their
           library for a number of basic land cards less than or equal to the difference, reveals them, puts them into their
           hand, then shuffles" — the counts as it resolves, each in turn order from you */
        case 'landCatchUp': {
          const order = this.turnOrder.length ? this.turnOrder : this.players.map(q => q.id);
          const live = order.map(id => this.player(id)).filter(q => q && !q.hasLost);
          const lands = (q) => this.battlefield.filter(x => x.controller === q.id && !x.phasedOut && (x.analysis() || {}).isLand).length;
          const counts = new Map(live.map(q => [q.id, lands(q)]));
          const most = Math.max(0, ...counts.values());
          const at = Math.max(0, live.findIndex(q => q.id === pid));
          const list = [];
          for (let k = 0; k < live.length; k++) {
            const q = live[(at + k) % live.length];
            const diff = most - counts.get(q.id);
            if (diff > 0) list.push({ op: 'tutor', n: diff, upTo: true, filter: 'basic land', to: 'hand', reveal: true, who: 'player', pid: q.id,
              prompt: `Search your library for up to ${MTG.oracle.nounCount(diff, 'basic land card')}.` });
          }
          this._spliceNext(list);
          return null;
        }
        /* The Pit: "each player creates their choice of a 3/3 white Angel creature token with flying or a 6/6 black Demon
           creature token with …" — chosen in turn order from you, then all made together (e.tokens: the createToken ops) */
        case 'eachTokenChoice': {
          const toks = e.tokens || [];
          if (!toks.length) return null;
          const say = (tk) => `${tk.pt ? tk.pt + ' ' : ''}${(tk.colorWords || []).join(' and ')} ${tk.subtypes || ''}`.replace(/\s+/g, ' ').trim() +
            ((tk.keywords || []).length ? ' with ' + tk.keywords.map(k => String(k).toLowerCase()).join(', ') : '') +
            (tk.grantedText ? ` and "${tk.grantedText}"` : '');
          const order = this.turnOrder.length ? this.turnOrder : this.players.map(q => q.id);
          const at = Math.max(0, order.indexOf(pid));
          const picks = [];
          for (let k = 0; k < order.length; k++) {
            const q = this.player(order[(at + k) % order.length]);
            if (!q || q.hasLost) continue;
            const got = this._choose({ playerId: q.id, purpose: 'tokenChoice', kind: 'options', min: 1, max: 1,
              options: toks.map((tk, i) => ({ label: U_cap(say(tk)), value: i })),
              // (for the bots: each token's size, and whether it asks something of you each turn)
              tokenInfo: toks.map(tk => ({ pt: tk.pt || '', drawback: /sacrifice|damage to you|lose/i.test(tk.grantedText || '') })),
              prompt: `${(ctx.obj && ctx.obj.name) || 'Effect'}: which token do you create — ${toks.map(say).join(', or ')}?` }, 'pcTok' + q.id);
            if (got === SUSPEND) return got;
            const i = got && got.picks ? Number(got.picks[0]) || 0 : 0;
            picks.push([q.id, toks[Math.min(Math.max(0, i), toks.length - 1)]]);
          }
          for (const [qid, tk] of picks) this._runEffect(Object.assign({}, tk), Object.assign({}, ctx, { controller: qid }));
          return null;
        }
        default: return null;
      }
    },
    _planarOp(e, ctx, targets) {
      const pid = ctx.controller;
      const st = this.planar || (this.planar = { walks: 0 });
      if (!this.planechaseOn()) {
        // (outside a Planechase game, nothing happens: Start the TARDIS, Fractured Powerstone)
        if (e.op === 'planeswalk' || e.op === 'rollPlanarDie' || e.op === 'chaosEnsues') this.logEvent('rules', 'This is not a Planechase game: nothing happens.');
        return null;
      }
      switch (e.op) {
        case 'planeswalk': {
          // "You may planeswalk." (Start the TARDIS, TARDIS)
          if (e.optional) {
            const yes = this._ask({ type: 'confirm', playerId: pid, prompt: 'Planeswalk?', purpose: 'mayPlaneswalk' }, 'mayWalk');
            if (yes === MTG.rules.SUSPEND) return yes;
            if (!yes) return null;
          }
          const r = this._planeswalk(pid, { ctx, fromDie: !!e.fromDie, anyone: !!e.fromDie });
          return r === MTG.rules.SUSPEND ? r : null;
        }
        case 'chaosEnsues': this._chaosEnsues(pid); return null;
        case 'rollPlanarDie': this._rollPlanar(pid, { source: ctx.obj || null }); return null;
        case 'chaoticAether': st.aether = true; this.logEvent('rules', 'Until a player planeswalks away from a plane, each blank roll of the planar die is a chaos roll.'); return null;
        case 'fixedPoint': st.fixedPoint = pid; return null;
        case 'planar': return this._planarDo(e, ctx, targets);
        default: return null;
      }
    },
  });

  MTG.planar = { isPlanarCard, isPhenomenonCard, planarCards, FACE_OF };
})(window.MTG);
