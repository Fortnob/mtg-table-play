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
    _planarOp(e, ctx) {
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
        default: return null;
      }
    },
  });

  MTG.planar = { isPlanarCard, isPhenomenonCard, planarCards, FACE_OF };
})(window.MTG);
