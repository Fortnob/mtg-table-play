/* ============================================================
   06b-events.js - what happened, as data

   The engine changes the game in a great many places, and for a long
   time the only record of it was the log: a line of English for a person
   to read. Everything else that wanted to know what had happened — the
   table's animations, a guest's sound, the history down the side — had to
   work it out again by comparing one picture of the game with the next.

   This is the record as data instead. Every game keeps a numbered stream
   of typed events:

     { seq, turn, type, ...what happened }

   cast, activate, trigger, resolve, counter      the stack
   zone, enter, leave, token, control             things moving
   damage, life, counters, tap, untap             things changing
   attack, block                                  combat
   draw, shuffle                                  libraries
   turn, step, priority, choice, gameOver, lose   the game going on
   cue                                            a sound with no other event to carry it
   log                                            a line of the old log

   Some of these are said by the engine where they happen (a spell going
   on the stack, damage being dealt). The rest are noticed: before each
   event is written down and whenever the game settles, the engine looks
   at where every object is, what is tapped, what counters are on what and
   every life total, and writes down what is different. A card that moved
   by any of the hundred routes a card can move is caught that way, with
   where it came from and where it went.

   The stream is kept in a ring, and handed out per player through
   eventsFor(), which hides exactly what that player is not allowed to
   know: a card going somewhere hidden travels as an id and nothing more.
   ============================================================ */
'use strict';
(function (MTG) {
  const Game = MTG.rules.Game;
  const RING = 3000;
  const PLAYER_ZONES = ['library', 'hand', 'graveyard', 'exile', 'command'];
  const PUBLIC = new Set(['battlefield', 'graveyard', 'exile', 'stack', 'command']);
  // engine sounds that are worth a 'cue' event, because no other event says the same thing
  const CUES = new Set(['crown', 'daynight', 'transform']);

  const base = {
    emit: Game.prototype.emit,
    logEvent: Game.prototype.logEvent,
    touch: Game.prototype.touch,
    start: Game.prototype.start,
  };

  /** Targets as plain data, whatever shape the stack keeps them in. */
  const plainTargets = (ts) => (ts || []).map(t => (typeof t === 'string' ? { kind: 'object', id: t }
    : t ? { kind: t.kind || 'object', id: t.id } : null)).filter(Boolean);

  const countersKey = (c) => {
    let s = '';
    for (const k in c) if (c[k]) s += k + '=' + c[k] + ';';
    return s;
  };

  // the zones a card can be seen in by everybody, face up
  const EVERYONE = new Set(['battlefield', 'graveyard', 'exile', 'command']);
  const zoneOwner = (w) => { const i = w.indexOf('|'); return i >= 0 && i < w.length - 1 ? w.slice(i + 1) : null; };
  const blockKey = (o) => (o.blocking && o.blocking.length ? o.blocking.join(',') : '');

  /* A spell is taken off the stack a moment before it lands wherever it is
     going, a card being searched for is out of its library while it is
     looked at, and a token that has left the battlefield is filed nowhere.
     In those moments an object is in no list at all; it is wherever it
     last said it was. */
  const whereOf = (o, where) => where.get(o.id) || (!o.zone ? 'gone'
    : o.zone === 'battlefield' || o.zone === 'stack' ? o.zone + '|' : o.zone + '|' + o.owner);

  /** What is worth remembering about an object, to notice when it changes. */
  function shadowOf(o, w, was) {
    const zone = w === 'gone' ? 'gone' : w.slice(0, w.indexOf('|'));
    const field = zone === 'battlefield';
    let creature = was ? was.creature : false;
    if (field && (!was || was.zone !== 'battlefield')) {
      try { const a = o.analysis(); creature = !!(a && a.isCreature); } catch (e) { creature = false; }
    }
    const key = countersKey(o.counters || {});
    return {
      w, zone, tapped: field && !!o.tapped, controller: o.controller,
      counters: key, c: was && was.counters === key ? was.c : Object.assign({}, o.counters || {}),
      attacking: field ? (o.attacking || null) : null, blocking: field ? blockKey(o) : '',
      creature, faceDown: !!o.faceDown, isToken: !!o.isToken,
    };
  }
  /** Nothing about it has changed since the last look. */
  function same(was, o, w) {
    if (was.w !== w || was.controller !== o.controller || was.faceDown !== !!o.faceDown) return false;
    if (was.zone === 'battlefield') {
      if (was.tapped !== !!o.tapped || was.attacking !== (o.attacking || null) || was.blocking !== blockKey(o)) return false;
    }
    return was.counters === countersKey(o.counters || {});
  }

  Object.assign(Game.prototype, {

    /* ---------------- writing it down ---------------- */

    /** Write an event down, after anything that changed on the way to it. */
    _ev(type, data) {
      if (!this.events) this._evInit();
      this._evSettle();
      return this._evPush(type, data);
    },

    _evInit() {
      this.events = [];
      this.eventSeq = this.eventSeq || 0;
    },

    _evPush(type, data) {
      if (!this.events) this._evInit();
      const e = Object.assign({ seq: ++this.eventSeq, turn: this.turn, type }, data || {});
      this.events.push(e);
      if (this.events.length > RING) this.events.splice(0, this.events.length - RING + 500);
      base.emit.call(this, 'event', e);
      return e;
    },

    /** Called from the damage routines, once the damage is really going to be dealt. */
    _evDamage(source, target, amount, combat) {
      if (!(amount > 0)) return;
      // Ratonhnhaké꞉ton: "hasn't dealt damage yet" — the permanent remembers it has
      if (source && source.zone === 'battlefield') source._dealtDamage = true;
      // (Ruric Thar, Magecrusher: "haven't dealt combat damage yet")
      if (combat && source && source.zone === 'battlefield') source._dealtCombatDamage = true;
      this._ev('damage', {
        source: source ? source.id : null, sourceName: source ? source.name : null,
        target, amount, combat: !!combat,
      });
    },

    /** Where everything is, by object id: zone, and whose zone ('hand|p1'). */
    _evWhere() {
      const where = new Map();
      for (const o of this.battlefield) where.set(o.id, 'battlefield|');
      for (const it of this.stack) if (it.kind === 'spell' && it.obj && !where.has(it.obj.id)) where.set(it.obj.id, 'stack|');
      for (const pid in this.zones) {
        const z = this.zones[pid];
        for (const k of PLAYER_ZONES) {
          const list = z[k];
          if (!list || !list.length) continue;
          const tag = k + '|' + pid;
          for (const o of list) where.set(o.id, tag);
        }
      }
      return where;
    },

    /** Take the game as it stands as the starting point, without saying anything about it. */
    _evBaseline() {
      if (!this.events) this._evInit();
      if (this.rng) this._evWatchShuffles();
      const sh = { objs: new Map(), players: new Map(), countered: new Set(), choice: this.pendingChoice || null };
      const where = this._evWhere();
      for (const o of this.objects.values()) sh.objs.set(o.id, shadowOf(o, whereOf(o, where), null));
      for (const p of this.players) sh.players.set(p.id, { life: p.life, poison: p.poison || 0 });
      for (const it of this.stack) if (it.countered) sh.countered.add(it.id);
      this._evShadow = sh;
    },

    /**
     * Notice what has changed since the last look, and write it down. This
     * runs before every event the engine says itself, so the stream stays
     * in the order things happened.
     */
    _evSettle() {
      if (this._evSettling) return;
      const sh = this._evShadow;
      if (!sh) { if (this.started || this.objects.size) this._evBaseline(); return; }
      this._evSettling = true;
      const out = [];
      try {
        const where = this._evWhere();
        const attacks = [], blocks = [];
        for (const o of this.objects.values()) {
          const w = whereOf(o, where);
          const was = sh.objs.get(o.id);
          if (was && same(was, o, w)) continue;
          const now = shadowOf(o, w, was);
          sh.objs.set(o.id, now);
          const owner = o.owner, controller = o.controller;
          if (!was) {
            // something new: a token, a copy, a card that came from outside the game
            if (now.zone === 'battlefield') {
              out.push([o.isToken ? 'token' : 'enter', { objId: o.id, from: null, owner, controller, card: o.card,
                faceDown: !!o.faceDown, tapped: !!o.tapped, isToken: !!o.isToken, isCopy: !!o.isCopy }]);
              for (const k of Object.keys(now.c)) if (now.c[k]) out.push(['counters', { objId: o.id, kind: k, delta: now.c[k], total: now.c[k] }]);
            } else if (now.zone !== 'gone' && now.zone !== 'stack') {
              out.push(['zone', { objId: o.id, from: null, to: now.zone, owner, controller, toOwner: zoneOwner(w), card: o.card, faceDown: !!o.faceDown }]);
            }
            continue;
          }
          if (was.w !== now.w) {
            /* A token that leaves the battlefield is never filed anywhere,
               but it did go somewhere first: the zone it was sent to. */
            const to = now.zone === 'gone' ? (o.zone && o.zone !== was.zone ? o.zone : 'gone') : now.zone;
            if (was.zone === 'battlefield' && now.zone !== 'battlefield') {
              out.push(['leave', { objId: o.id, to, owner, controller: was.controller, card: o.card,
                faceDown: was.faceDown, isToken: was.isToken, died: to === 'graveyard' && was.creature }]);
            }
            out.push(['zone', { objId: o.id, from: was.zone, to, owner, controller,
              fromOwner: zoneOwner(was.w), toOwner: zoneOwner(w), card: o.card, faceDown: !!o.faceDown,
              gone: now.zone === 'gone' || undefined }]);
            if (now.zone === 'battlefield') {
              out.push(['enter', { objId: o.id, from: was.zone, owner, controller, card: o.card,
                faceDown: !!o.faceDown, tapped: !!o.tapped, isToken: !!o.isToken }]);
            }
          }
          const field = now.zone === 'battlefield';
          if (field && was.zone === 'battlefield') {
            if (was.tapped !== now.tapped) out.push([now.tapped ? 'tap' : 'untap', { objId: o.id, controller }]);
            if (was.controller !== now.controller) out.push(['control', { objId: o.id, from: was.controller, to: now.controller }]);
          }
          if (field && now.attacking && now.attacking !== was.attacking) attacks.push({ objId: o.id, defender: now.attacking });
          if (field && now.blocking && now.blocking !== was.blocking) blocks.push({ objId: o.id, attackers: (o.blocking || []).slice() });
          /* Counters are worth saying wherever they can be seen: on the
             battlefield, and on a suspended card in exile. A card leaving
             the battlefield loses its counters, which is not news; one
             arriving with some ("enters with three +1/+1 counters") is. */
          if (was.counters !== now.counters && EVERYONE.has(now.zone) && (now.zone === was.zone || field)) {
            const before = now.zone === was.zone ? was.c : {};
            const kinds = new Set(Object.keys(before).concat(Object.keys(now.c)));
            for (const k of kinds) {
              const d = (now.c[k] || 0) - (before[k] || 0);
              if (d) out.push(['counters', { objId: o.id, kind: k, delta: d, total: now.c[k] || 0 }]);
            }
          }
        }
        if (attacks.length) out.push(['attack', { player: (this.obj(attacks[0].objId) || {}).controller || null, attackers: attacks }]);
        if (blocks.length) out.push(['block', { player: (this.obj(blocks[0].objId) || {}).controller || null, blocks }]);
        for (const p of this.players) {
          const was = sh.players.get(p.id);
          const poison = p.poison || 0;
          if (was && was.life === p.life && was.poison === poison) continue;
          if (was && was.life !== p.life) out.push(['life', { player: p.id, delta: p.life - was.life, life: p.life }]);
          if (was && was.poison !== poison) out.push(['counters', { player: p.id, kind: 'poison', delta: poison - was.poison, total: poison }]);
          sh.players.set(p.id, { life: p.life, poison });
        }
        for (const it of this.stack) {
          if (!it.countered || sh.countered.has(it.id)) continue;
          sh.countered.add(it.id);
          out.push(['counter', { stackId: it.id, objId: it.objId || null, controller: it.controller, name: it.name }]);
        }
        if (this.pendingChoice !== sh.choice) {
          sh.choice = this.pendingChoice || null;
          const ch = sh.choice;
          if (ch) out.push(['choice', { player: ch.playerId, kind: ch.type }]);
        }
      } finally { this._evSettling = false; }
      for (const [type, data] of out) this._evPush(type, data);
    },

    /** After an undo or a load the whole game has jumped: start looking again from here. */
    _evRebase() {
      this._evBaseline();
      this._evPush('restore', {});
    },

    /* ---------------- handing it out ---------------- */

    /**
     * The events after `since` as one player may know them, or null when
     * some of them have already fallen out of the ring (the caller then
     * works from the pictures alone). Pass no `since` to get nothing and
     * just learn where the stream is up to.
     */
    eventsFor(viewer, since) {
      if (!this.events) this._evInit();
      this._evSettle();
      const list = this.events;
      if (since == null || since >= this.eventSeq) return [];
      if (!list.length || list[0].seq > since + 1) return null;
      const out = [];
      // the ring is in order, so the start can be found rather than searched for
      let i = list.length - (this.eventSeq - since);
      if (i < 0) i = 0;
      for (; i < list.length; i++) {
        const r = redact(list[i], viewer);
        if (r) out.push(r);
      }
      return out;
    },
  });

  /* ---------------- who may know what ----------------
     The rules of a hidden zone, applied to one event and one viewer:
     a card in a hand is its owner's to see, a library is nobody's, a
     face-down card is its controller's (in exile, its owner's), and
     everything else on the table is everybody's. */
  function sees(viewer, zone, e) {
    if (e.faceDown) {
      const who = (zone === 'battlefield' || zone === 'stack') ? e.controller : e.owner;
      return viewer === who;
    }
    if (zone === 'hand') return viewer === (e.toOwner || e.owner);
    // (a planar deck, face down: nobody's to see — src/06f-planechase.js)
    if (zone === 'library' || zone === 'planar') return false;
    return true;
  }

  function redact(e, viewer) {
    switch (e.type) {
      case 'zone': {
        if (sees(viewer, e.to === 'gone' ? 'battlefield' : e.to, e)) return e;
        const r = Object.assign({}, e, { hidden: true });
        delete r.card;
        return r;
      }
      case 'enter': case 'token': case 'leave':
        if (!e.faceDown || sees(viewer, 'battlefield', e)) return e;
        return Object.assign({}, e, { card: null, hidden: true });
      case 'cast':
        if (!e.faceDown || viewer === e.controller) return e;
        return Object.assign({}, e, { card: null, name: 'A face-down spell', hidden: true });
      case 'trigger': case 'activate':
        if (!e.faceDown || viewer === e.controller) return e;
        return Object.assign({}, e, { card: null, hidden: true });
      // a die rolled in secret: seen rolled, by everybody, but what it came up is its roller's
      case 'roll':
        if (!e.secret || viewer === e.player) return e;
        return Object.assign({}, e, { result: null, rolls: e.rolls.map(() => null), ignored: [], hidden: true });
      default:
        return e;
    }
  }

  /* ---------------- where the engine already speaks ----------------
     The engine has always announced some things to whoever was listening
     — a spell going on the stack, a turn beginning. Those announcements
     are where the typed events for them are written. */
  Game.prototype.emit = function (ev, a, b) {
    switch (ev) {
      case 'stack:add': {
        const it = a;
        if (!it) break;
        const trigger = it.kind !== 'spell' && String(it.id).startsWith('tr');
        const o = it.obj || null;
        this._ev(it.kind === 'spell' ? 'cast' : trigger ? 'trigger' : 'activate', {
          stackId: it.id, objId: it.objId || null, controller: it.controller, name: it.name,
          // a face-down spell, or an ability of a face-down permanent, is its controller's to read
          card: o ? o.card : null, faceDown: !!(o && o.faceDown),
          targets: plainTargets(it.targets), copy: !!it.isCopy || undefined,
          text: it.kind !== 'spell' ? (it.abilityText || null) : undefined,
        });
        break;
      }
      case 'stack:resolve':
        if (a) this._ev('resolve', { stackId: a.id, objId: a.objId || null, controller: a.controller, name: a.name, kind: a.kind, countered: !!a.countered || undefined });
        break;
      case 'turn:begin': this._ev('turn', { player: a ? a.id : null, n: this.turn }); break;
      case 'step:begin': this._ev('step', { phase: a, step: b, player: this.activePlayer ? this.activePlayer.id : null }); break;
      case 'priority': {
        const pid = a ? a.id : null;
        const last = this.events && this.events[this.events.length - 1];
        // a priority pass that changed nothing is not worth a second line
        if (!(last && last.type === 'priority' && last.player === pid && last.depth === this.stack.length)) {
          this._ev('priority', { player: pid, depth: this.stack.length });
        }
        break;
      }
      case 'draw': if (a && a.player) this._ev('draw', { player: a.player.id, count: a.n }); break;
      case 'game:over': this._ev('gameOver', { winners: (a || []).slice() }); break;
      case 'player:lost': if (a) this._ev('lose', Object.assign({ player: a.id, reason: a.lossReason || '' }, a.lossFrom ? { from: a.lossFrom } : {})); break;
      /* a die: the result kept, every die rolled and the ones ignored (Pixie Guide, Wyll), for which card;
         a coin: heads or tails, won or lost, ignored (Krark's Thumb's other coin), for which card */
      /* (the dice rolled together share a `group`, `of` dice in all; a die rolled in secret is its roller's to read — redact) */
      case 'roll': if (a) this._ev('roll', Object.assign({ player: a.playerId, sides: a.sides, result: a.result,
        rolls: a.rolls || [a.result], ignored: a.ignored || [], group: a.group || 0, of: a.of || 1,
        source: a.sourceId || null, sourceName: a.sourceName || null }, a.secret ? { secret: true } : {},
        // the planar die: the face it showed (src/06f-planechase.js)
        a.planar ? { planar: a.planar } : {})); break;
      /* Planechase: a planeswalk — the planes and phenomena turned face down, and those turned face up (the starting
         plane is one turned up with nothing turned down: `start`) */
      case 'planeswalk': if (a) this._ev('planeswalk', Object.assign({ player: a.playerId || null,
        from: (a.from || []).map(o => ({ objId: o.id, name: o.name, card: o.card })),
        to: (a.to || []).map(o => ({ objId: o.id, name: o.name, card: o.card })) }, a.start ? { start: true } : {})); break;
      case 'coin': if (a) this._ev('coin', { player: a.playerId, result: a.result, won: a.won != null ? !!a.won : a.result === 'heads',
        ignored: !!a.ignored, source: a.sourceId || null, sourceName: a.sourceName || null, byHand: a.byHand || undefined }); break;
      case 'manual': if (a) this._ev('manual', { player: a.controller || null, text: String(a.text || '') }); break;
      /* A few moments have a sound but nothing else in the stream to hang
         it on — the crown changing hands, day becoming night, a card
         turning over. They are written down as cues, so a guest hears them
         as well as the host. */
      case 'sfx': if (CUES.has(a)) this._ev('cue', { name: a, player: b && b.player != null ? b.player : null }); break;
      default: break;
    }
    return base.emit.apply(this, arguments);
  };

  /* The log is one of the things written into the stream: a guest's log is
     built from these, so there is one record and not two. */
  Game.prototype.logEvent = function (type, text) {
    base.logEvent.call(this, type, text);
    this._ev('log', { kind: type, text: String(text) });
  };

  Game.prototype.touch = function () {
    this._evSettle();
    return base.touch.apply(this, arguments);
  };

  Game.prototype.start = function () {
    if (!this.started) this._evBaseline();
    return base.start.apply(this, arguments);
  };

  /* A library being shuffled is said by the generator that shuffles it, so
     that none of the dozen places that shuffle a library can forget to. */
  const baseShuffle = MTG.RNG.prototype.shuffle;
  Game.prototype._evWatchShuffles = function () {
    if (this.rng._watched) return;
    const game = this;
    this.rng._watched = true;
    this.rng.shuffle = function (arr) {
      const r = baseShuffle.call(this, arr);
      for (const pid in game.zones) {
        if (game.zones[pid].library === arr) { if (game.started) game._ev('shuffle', { player: pid }); break; }
      }
      return r;
    };
  };
  const baseAddPlayer = Game.prototype.addPlayer;
  Game.prototype.addPlayer = function () {
    this._evWatchShuffles();
    return baseAddPlayer.apply(this, arguments);
  };

  /* ---------------- plain words ----------------
     One line for an event, for captions and the history. `name(pid)` gives
     a player's name as the reader should see it ("You" for `me`), and
     `card(id)` the name of an object if it is known. */
  function describe(e, me, name, card) {
    name = name || ((x) => x || 'Someone');
    card = card || (() => null);
    const s = (pid) => (pid === me ? '' : 's');
    const cn = (id, fb) => (e.card && e.card.name) || card(id) || fb || 'a card';
    switch (e.type) {
      case 'cast': return `${name(e.controller)} cast${s(e.controller)} ${e.name}`;
      case 'activate': return `${name(e.controller)} activate${s(e.controller)} ${e.name}`;
      case 'trigger': return `${name(e.controller)} — trigger: ${e.name}`;
      case 'resolve': return `${e.name} resolves`;
      case 'counter': return `${e.name} is countered`;
      case 'damage': return `${e.sourceName || 'Something'} deals ${e.amount} to ${e.target.kind === 'player' ? name(e.target.id) : card(e.target.id) || 'a permanent'}`;
      case 'life': return `${name(e.player)} ${e.delta > 0 ? 'gain' : 'lose'}${s(e.player)} ${Math.abs(e.delta)} life`;
      case 'draw': return `${name(e.player)} draw${s(e.player)} ${e.count === 1 ? 'a card' : e.count + ' cards'}`;
      case 'shuffle': return `${name(e.player)} shuffle${s(e.player)}`;
      case 'token': return `${name(e.controller)} create${s(e.controller)} ${cn(e.objId, 'a token')}`;
      case 'enter': return `${cn(e.objId)} enters the battlefield`;
      case 'leave': return `${cn(e.objId)} ${e.died ? 'dies' : e.to === 'exile' ? 'is exiled' : e.to === 'hand' ? 'returns to hand'
        : e.to === 'library' ? 'goes into a library' : e.to === 'graveyard' ? 'is put into a graveyard' : 'leaves'}`;
      case 'attack': return `${name(e.player)} attack${s(e.player)} with ${e.attackers.length === 1 ? cn(e.attackers[0].objId, 'a creature') : e.attackers.length + ' creatures'}`;
      case 'block': return `${name(e.player)} block${s(e.player)} with ${e.blocks.length === 1 ? cn(e.blocks[0].objId, 'a creature') : e.blocks.length + ' creatures'}`;
      case 'gameOver': return (e.winners || []).length ? `${e.winners.map(name).join(', ')} win${e.winners.length === 1 ? s(e.winners[0]) : ''}` : 'The game is a draw';
      case 'lose': { const why = lossWords(e.reason, e.from); return `${name(e.player)} lose${s(e.player)}${why ? ' — ' + why.charAt(0).toLowerCase() + why.slice(1) : ''}`; }
      case 'log': return e.text;
      default: return '';
    }
  }

  /**
   * Why a player is out of the game, in a few words for a person: "Life
   * total reached 0", "Commander damage from Atraxa (Mira)". `reason` is
   * the engine's (Game#playerLoses); `from`, where known, who or what did
   * it. A reason the engine wrote out itself ("a card said so") is kept,
   * with a capital.
   */
  function lossWords(reason, from) {
    switch (reason || '') {
      case '': return '';
      case 'life': return 'Life total reached 0';
      case 'poison': return 'Ten poison counters';
      case 'deck': return 'Drew from an empty library';
      case 'commander': return from ? `Commander damage from ${from}` : 'Commander damage';
      case 'concede': return 'Conceded';
      case 'timeout': return 'Left the game';
      case 'time': return 'Ran out of time';
      default: { const r = String(reason); return r.charAt(0).toUpperCase() + r.slice(1); }
    }
  }

  MTG.events = { redact, sees, describe, lossWords, PUBLIC, RING };
})(window.MTG);
