/* ============================================================
   12b-ui-table-fx.js - the table in motion

   A game of Magic is mostly invisible: numbers change, things point at
   other things, a spell waits to resolve, and the engine does all of it in
   the time it takes to draw one frame. This is the part of the table that
   turns that back into something a person can watch.

   Views are played back as beats. Each one comes with the game's own
   events since the last (src/06b-events.js) — what was cast, what moved
   from where to where, what dealt damage to what — and is given as long
   as those deserve: an opponent's spell is held up in the middle long
   enough to read, an attack takes a moment, a step going by takes none.
   A view without its events (the first one, or after a gap) is worked out
   the old way, by comparing it with the one before. If views pile up
   faster than they can be shown the beats get shorter, so the table is
   never far behind the game.

   Cards move by FLIP: where every card was is measured, the table is
   redrawn, and the difference is played backwards. Because each card keeps
   one element for its whole life, that is enough to fly a card from a hand
   to the stack to the battlefield without knowing anything about rules.
   ============================================================ */
'use strict';
(function (MTG) {
  const { el, util: U } = MTG;
  const UI = MTG.ui;
  const Table = UI.Table;
  const { stepKey, idNum, truncate, possessive, CARD_RATIO } = Table.helpers;
  const EASE = 'cubic-bezier(.22,.8,.24,1)';
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  Object.assign(Table.prototype, {

    _motionOff() {
      return !!(MTG.settings.reduceMotion || MTG.settings.animateDraws === false ||
        (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches));
    },

    /* ---------------- the beats ---------------- */

    async _pump() {
      if (this._pumping) return;
      this._pumping = true;
      try {
        while (this.queue.length && !this._destroyed) {
          let next = this.queue.shift();
          /* A view that changes nothing worth seeing — a step going by, a
             land being tapped for a spell that is about to appear anyway — is
             passed over for the one after it, which carries the same change. */
          while (this.queue.length && this.view && this._minor(this.view, next)) {
            // what happened in the view passed over still happened
            const skipped = next;
            next = this.queue.shift();
            next.events = skipped.events && next.events ? skipped.events.concat(next.events) : null;
          }
          await this._present(next);
        }
      } catch (e) {
        console.error('[table]', e);
      } finally {
        this._pumping = false;
      }
    },

    /** How quickly beats play: slower when the table is idle, much faster when it is behind. */
    _pace() {
      const q = this.queue.length;
      let f = MTG.settings.animSpeed != null ? MTG.settings.animSpeed : 1;
      if (this.paceScale) f *= this.paceScale;          // a replay played faster or slower
      if (this._motionOff()) f *= 0.5;
      if (q > 8) f *= 0.08;
      else if (q > 4) f *= 0.35;
      else if (q > 2) f *= 0.7;
      return f;
    },

    _minor(prev, next) {
      if (!prev || !next) return false;
      if (prev.turn !== next.turn || prev.activePlayer !== next.activePlayer) return false;
      if (prev.over !== next.over || prev.mulliganPhase !== next.mulliganPhase) return false;
      const ids = (list) => (list || []).map(x => x.id).join(',');
      if (ids(prev.stack) !== ids(next.stack)) return false;
      if (ids(prev.battlefield) !== ids(next.battlefield)) return false;
      const pc = (v) => v.pendingChoice ? v.pendingChoice.type + v.pendingChoice.playerId : '';
      if (pc(prev) !== pc(next)) return false;
      const combat = (v) => v.battlefield.map(o => (o.attacking || '') + (o.blocking || []).join('+') + ':' + (o.damage || 0)).join('|');
      if (combat(prev) !== combat(next)) return false;
      for (const p of next.players) {
        const q = prev.players.find(x => x.id === p.id);
        if (!q || q.life !== p.life || q.handSize !== p.handSize || (q.graveyard || []).length !== (p.graveyard || []).length ||
            (q.exile || []).length !== (p.exile || []).length || q.hasLost !== p.hasLost) return false;
      }
      // it is your move now: that is never something to skip past
      if (next.priorityPlayer === this.meId && prev.priorityPlayer !== this.meId) return false;
      return true;
    },

    /**
     * What happened between two views, and how long to dwell on it. The
     * events found here also feed the caption and the history down the left.
     */
    _plan(prev, next) {
      if (prev && Array.isArray(next.events) && !next.events.some(e => e.type === 'restore')) return this._planEvents(prev, next);
      const me = this.meId;
      const b = { hold: 0, spot: null, events: [], turn: false };
      if (!prev) return b;
      const name = (pid) => { const p = next.players.find(x => x.id === pid); return pid === me ? 'You' : (p ? p.name : 'Someone'); };
      const hold = (ms) => { b.hold = Math.max(b.hold, ms); };

      if (next.turn !== prev.turn || next.activePlayer !== prev.activePlayer) {
        b.turn = true;
        hold(next.activePlayer === me ? 1100 : 900);
      }

      const had = new Set((prev.stack || []).map(s => s.id));
      for (const s of (next.stack || [])) {
        if (had.has(s.id)) continue;
        const trigger = String(s.id).startsWith('tr');
        const kind = s.kind === 'ability' ? (trigger ? 'trigger' : 'ability') : 'cast';
        const targets = (s.targets || []).map(t => this.targetName(t)).filter(Boolean);
        b.events.push({ kind, who: s.controller, card: s.card, name: s.name, targets,
          text: `${name(s.controller)} ${kind === 'cast' ? 'cast' + (s.controller === me ? '' : 's') : kind === 'trigger' ? '— trigger:' : 'activate' + (s.controller === me ? '' : 's')} ${s.name}${targets.length ? ' → ' + targets.join(', ') : ''}` });
        if (s.controller !== me) {
          b.spot = { stackId: s.id, objId: s.kind !== 'ability' ? s.objId : null, trigger };
          hold(s.kind === 'ability' ? 1000 : 1500);
        } else hold(160);
      }
      const now = new Set((next.stack || []).map(s => s.id));
      for (const s of (prev.stack || [])) {
        if (now.has(s.id)) continue;
        if (s.countered) b.events.push({ kind: 'countered', who: s.controller, card: s.card, name: s.name, text: `${s.name} is countered` });
        hold(260);
      }

      const atkPrev = prev.battlefield.filter(o => o.attacking).length;
      const attackers = next.battlefield.filter(o => o.attacking);
      if (attackers.length && !atkPrev) {
        const who = attackers[0].controller;
        b.events.push({ kind: 'attack', who, card: attackers[0].card, name: `${attackers.length} attacker${attackers.length === 1 ? '' : 's'}`,
          text: `${name(who)} attack${who === me ? '' : 's'} with ${attackers.length === 1 ? attackers[0].card.name : attackers.length + ' creatures'}` });
        hold(900);
      }
      const blk = (v) => v.battlefield.filter(o => (o.blocking || []).length).length;
      if (blk(next) > blk(prev)) {
        const bl = next.battlefield.filter(o => (o.blocking || []).length);
        const who = bl[0].controller;
        b.events.push({ kind: 'block', who, card: bl[0].card, name: `${bl.length} blocker${bl.length === 1 ? '' : 's'}`,
          text: `${name(who)} block${who === me ? '' : 's'} with ${bl.length === 1 ? bl[0].card.name : bl.length + ' creatures'}` });
        hold(900);
      } else if (attackers.length && atkPrev && prev.step === 'declareAttackers' && next.step !== 'declareAttackers' && !blk(next)) {
        // no blocks is news too, if you are the one attacking
        if (attackers[0].controller === me) { b.events.push({ kind: 'noblock', who: null, text: 'No blocks' }); hold(500); }
      }

      // what left the battlefield, and where to
      const nowIds = new Set(next.battlefield.map(o => o.id));
      for (const o of prev.battlefield) {
        if (nowIds.has(o.id)) continue;
        const loc = this.locate(o.id, next);
        const where = loc ? loc.zone : 'library';
        if (o.isToken && !loc) continue;
        if (o.power == null && where === 'graveyard' && !(this.analysis(o) || {}).isCreature && (this.analysis(o) || {}).isLand) continue;
        const verb = where === 'graveyard' ? (o.power != null ? 'dies' : 'is put into a graveyard')
          : where === 'exile' ? 'is exiled' : where === 'hand' ? 'returns to hand' : where === 'library' ? 'goes into a library' : 'leaves';
        b.events.push({ kind: where === 'graveyard' && o.power != null ? 'died' : 'left', who: o.controller, card: o.card, name: o.card.name, text: `${o.card.name} ${verb}` });
        hold(420);
      }
      // what arrived without passing through the stack: lands, tokens, things put onto it
      const prevIds = new Set(prev.battlefield.map(o => o.id));
      const stackObjs = new Set((prev.stack || []).map(s => s.objId));
      for (const o of next.battlefield) {
        if (prevIds.has(o.id) || stackObjs.has(o.id)) continue;
        const a = this.analysis(o);
        if (a && a.isLand) {
          if (o.controller !== me) { b.events.push({ kind: 'land', who: o.controller, card: o.card, name: o.card.name, text: `${name(o.controller)} plays ${o.card.name}` }); hold(500); }
          continue;
        }
        if (o.isToken) { b.events.push({ kind: 'token', who: o.controller, card: o.card, name: o.card.name, text: `${name(o.controller)} create${o.controller === me ? '' : 's'} ${o.card.name}` }); hold(320); continue; }
        b.events.push({ kind: 'enter', who: o.controller, card: o.card, name: o.card.name, text: `${o.card.name} enters the battlefield` });
        hold(380);
      }

      for (const p of next.players) {
        const q = prev.players.find(x => x.id === p.id);
        if (!q) continue;
        if (q.life !== p.life) hold(Math.abs(p.life - q.life) >= 5 ? 700 : 450);
        if (!q.hasLost && p.hasLost) { b.events.push({ kind: 'lost', who: p.id, text: `${name(p.id)} ${p.id === me ? 'lose' : 'loses'}${p.lossReason ? ' — ' + p.lossReason : ''}` }); hold(1200); }
      }
      // combat damage lands on creatures too
      const dmg = (v) => v.battlefield.reduce((s, o) => s + (o.damage || 0), 0);
      if (dmg(next) > dmg(prev)) hold(450);
      return b;
    },

    /**
     * The same, from the events themselves. Nothing has to be guessed: a
     * card that went from a library to a graveyard says so, damage says
     * where it came from, and a spell going on the stack is a cast even if
     * it has already resolved by the time this view is shown.
     */
    _planEvents(prev, next) {
      const me = this.meId;
      const b = { hold: 0, spot: null, events: [], turn: false, fromEvents: true,
        moves: new Map(), damage: [], life: new Map(), counters: [] };
      const name = (pid) => { const p = next.players.find(x => x.id === pid) || prev.players.find(x => x.id === pid); return pid === me ? 'You' : (p ? p.name : 'Someone'); };
      const hold = (ms) => { b.hold = Math.max(b.hold, ms); };
      const s = (pid) => (pid === me ? '' : 's');
      const known = (id) => this.objIn(id, next) || this.objIn(id, prev);
      const cardOf = (e) => e.card || (known(e.objId) || {}).card || null;
      const cardName = (id) => { const o = known(id); return o && o.card ? o.card.name : null; };
      const liveStack = new Set((next.stack || []).map(x => x.id));
      for (const e of next.events) {
        switch (e.type) {
          case 'turn': b.turn = true; hold(e.player === me ? 1100 : 900); break;
          case 'cast': case 'activate': case 'trigger': {
            const kind = e.type === 'cast' ? 'cast' : e.type === 'trigger' ? 'trigger' : 'ability';
            const targets = (e.targets || []).map(t => this.targetName(t)).filter(Boolean);
            const verb = kind === 'cast' ? 'cast' + s(e.controller) : kind === 'trigger' ? '— trigger:' : 'activate' + s(e.controller);
            b.events.push({ kind, who: e.controller, card: cardOf(e), name: e.name, targets,
              text: `${name(e.controller)} ${verb} ${e.name}${targets.length ? ' → ' + targets.join(', ') : ''}` });
            if (e.controller !== me) {
              // held up in the middle while it is still there to be held up
              if (liveStack.has(e.stackId)) b.spot = { stackId: e.stackId, objId: kind === 'cast' ? e.objId : null, trigger: kind === 'trigger' };
              hold(kind === 'cast' ? 1500 : 1000);
            } else hold(160);
            break;
          }
          case 'resolve': hold(260); break;
          case 'counter':
            b.events.push({ kind: 'countered', who: e.controller, card: cardOf(e), name: e.name, text: `${e.name} is countered` });
            hold(260);
            break;
          case 'attack': {
            const first = e.attackers[0];
            const c = cardOf({ objId: first.objId });
            b.events.push({ kind: 'attack', who: e.player, card: c, name: `${e.attackers.length} attacker${e.attackers.length === 1 ? '' : 's'}`,
              text: `${name(e.player)} attack${s(e.player)} with ${e.attackers.length === 1 ? (c ? c.name : 'a creature') : e.attackers.length + ' creatures'}` });
            hold(900);
            break;
          }
          case 'block': {
            const first = e.blocks[0];
            const c = cardOf({ objId: first.objId });
            b.events.push({ kind: 'block', who: e.player, card: c, name: `${e.blocks.length} blocker${e.blocks.length === 1 ? '' : 's'}`,
              text: `${name(e.player)} block${s(e.player)} with ${e.blocks.length === 1 ? (c ? c.name : 'a creature') : e.blocks.length + ' creatures'}` });
            hold(900);
            break;
          }
          case 'leave': {
            const c = cardOf(e);
            if (e.isToken && e.to !== 'graveyard') break;
            const a = c ? MTG.oracle.analyze(c, 0) : null;
            if (!e.died && e.to === 'graveyard' && a && a.isLand && !a.isCreature) break;
            const verb = e.died ? 'dies' : e.to === 'graveyard' ? 'is put into a graveyard' : e.to === 'exile' ? 'is exiled'
              : e.to === 'hand' ? 'returns to hand' : e.to === 'library' ? 'goes into a library' : 'leaves';
            const nm = c ? c.name : (cardName(e.objId) || 'A permanent');
            b.events.push({ kind: e.died ? 'died' : 'left', who: e.controller, card: c, name: nm, text: `${nm} ${verb}` });
            hold(420);
            break;
          }
          case 'enter': {
            if (e.from === 'stack') break;               // it was cast, and said so then
            const c = cardOf(e);
            const a = c ? MTG.oracle.analyze(c, 0) : null;
            const nm = c ? c.name : 'A permanent';
            if (a && a.isLand) {
              if (e.controller !== me) { b.events.push({ kind: 'land', who: e.controller, card: c, name: nm, text: `${name(e.controller)} plays ${nm}` }); hold(500); }
              break;
            }
            b.events.push({ kind: 'enter', who: e.controller, card: c, name: nm, text: `${nm} enters the battlefield` });
            hold(380);
            break;
          }
          case 'token': {
            const c = cardOf(e);
            const nm = c ? c.name : 'a token';
            b.events.push({ kind: 'token', who: e.controller, card: c, name: nm, text: `${name(e.controller)} create${s(e.controller)} ${nm}` });
            hold(320);
            break;
          }
          case 'zone': b.moves.set(e.objId, e); break;
          case 'damage': b.damage.push(e); hold(450); break;
          case 'life': {
            b.life.set(e.player, (b.life.get(e.player) || 0) + e.delta);
            hold(Math.abs(b.life.get(e.player)) >= 5 ? 700 : 450);
            break;
          }
          case 'counters': b.counters.push(e); break;
          case 'lose':
            b.events.push({ kind: 'lost', who: e.player, text: `${name(e.player)} ${e.player === me ? 'lose' : 'loses'}${e.reason ? ' — ' + e.reason : ''}` });
            hold(1200);
            break;
          default: break;
        }
      }
      // no blocks is news too, if you are the one attacking
      const attackers = next.battlefield.filter(o => o.attacking);
      if (attackers.length && prev.step === 'declareAttackers' && next.step !== 'declareAttackers' &&
          !next.battlefield.some(o => (o.blocking || []).length) && attackers[0].controller === me) {
        b.events.push({ kind: 'noblock', who: null, text: 'No blocks' }); hold(500);
      }
      return b;
    },

    async _present(next) {
      const prev = this.view;
      const beat = this._plan(prev, next);
      // a plan for an action that the game has moved past is no longer yours to finish
      if (prev && (!next.pendingChoice || next.pendingChoice.type !== 'declareAttackers')) this.attackPlan = null;
      if (prev && (!next.pendingChoice || next.pendingChoice.type !== 'declareBlockers')) this.blockPlan = null;
      if (prev && (!next.pendingChoice || !/^(discard|discardToHandSize)$/.test(next.pendingChoice.type))) this.discardSel = [];
      if (prev && (!next.pendingChoice || next.pendingChoice.type !== 'sacrifice')) this.sacSel = [];
      if (this.targeting && this.targeting.legal && !(next.pendingChoice && next.pendingChoice.type === 'pickTarget')) this.targeting = null;

      this.view = next;
      if (beat.spot) this.spot = beat.spot;
      else if (this.spot && !(next.stack || []).some(s => s.id === this.spot.stackId)) this.spot = null;
      // where each card that moved really came from and went to, for the flights
      this._moves = beat.moves || null;
      this.render();
      this._moves = null;
      this._report(prev, next, beat);

      const ms = beat.hold * this._pace();
      if (ms > 30) await sleep(ms);
      if (beat.spot && this.spot === beat.spot) {
        this.spot = null;
        if (!this.queue.length && !this._destroyed) this.render();
      }
    },

    /** Everything said about a beat that is not a card moving. */
    _report(prev, next, beat) {
      if (!prev) return;
      if (beat.turn) this._turnBanner(next);
      if (beat.fromEvents) this._eventFloats(prev, next, beat);
      else this._lifeFloats(prev, next);
      this._boardFloats(prev, next, beat.fromEvents);
      for (const e of beat.events) this.pushHistory(e);
      this._voice(prev, next, beat);
      // what you did yourself needs no announcing, except where it ended up
      const told = beat.events.filter(e => e.text &&
        (e.who !== this.meId || ['attack', 'died', 'lost', 'countered', 'noblock'].includes(e.kind)));
      const line = told.length ? told[told.length - 1] : null;
      if (line && !(beat.spot && (line.kind === 'cast' || line.kind === 'ability' || line.kind === 'trigger'))) this.say(line.text, line.kind);
      // anything the engine could not do itself is said loudly, once
      const fresh = (next.log || []).slice(-(Math.max(0, (next.log || []).length - (prev.log || []).length) || 0));
      for (const e of fresh) if (e.type === 'manual') this.say(e.text, 'manual', 6000);
      // a board wipe is worth feeling
      const gone = prev.battlefield.filter(o => !next.battlefield.some(x => x.id === o.id) && o.power != null).length;
      if (gone >= 3) this.flash('wipe');
      if (!prev.over && next.over) this._gameOverFx(next);
    },

    /**
     * What a beat sounds like, and the small touches that go with it: the
     * same for the host and for every guest, because it is worked out from
     * the same events at the moment they are shown (src/12f-ui-feel.js).
     */
    _voice(prev, next, beat) {
      if (MTG.feel) MTG.feel.beat(this, prev, next, beat);
    },

    /* ---------------- motion ---------------- */

    _snapshot() {
      const cards = new Map();
      for (const n of this.arena.querySelectorAll('.cv[data-id]')) {
        const r = U.rect(n);
        if (r.width) cards.set(n.dataset.id, r);
      }
      return { cards, piles: this._pileRects(), hands: this._handRects(), view: this._lastShown || null };
    },

    /** A player's portrait: the biggest one on screen, when there is a nameplate and a board. */
    orbFor(pid) {
      let best = null, bw = 0;
      for (const n of this.arena.querySelectorAll(`.life-orb[data-player="${CSS.escape(String(pid))}"]`)) {
        const w = U.rect(n).width;
        if (w > bw) { bw = w; best = n; }
      }
      return best;
    },

    _pileRects() {
      const m = new Map();
      for (const n of this.arena.querySelectorAll('.pile[data-pile]')) {
        const r = U.rect(n);
        if (r.width) m.set(n.dataset.pile, r);
      }
      return m;
    },
    _handRects() {
      const m = new Map();
      for (const [pid, s] of this.seats) if (s.hud && s.hud._hand) {
        const r = U.rect(s.hud._hand);
        if (r.width || r.height) m.set(pid, r);
      }
      // an opponent whose board is not in view: their nameplate is where their hand is
      for (const [pid, plate] of (this._plates || new Map())) {
        if (m.has(pid) || !plate.isConnected) continue;
        const pr = U.rect(plate);
        if (pr.width) m.set(pid, pr);
      }
      const r = U.rect(this.handHost);
      if (r.width) m.set(this.meId, { left: r.left + r.width / 2 - 60, top: r.bottom - 120, width: 120, height: 168 });
      return m;
    },

    /** Where a card that has just appeared should come in from. */
    _originFor(id, before) {
      const prevView = before.view;
      const now = this.locate(id, this.view);
      if (!now) return null;
      const mv = this._moves && this._moves.get(id);
      if (mv && mv.from) {
        const who = mv.fromOwner || mv.owner;
        if (mv.from === 'library') return before.piles.get(who + '/library') || null;
        if (mv.from === 'graveyard' || mv.from === 'exile') return before.piles.get(who + '/' + mv.from) || null;
        if (mv.from === 'hand') return before.hands.get(who) || null;
        if (mv.from === 'command') return null;
      }
      if (prevView) {
        const was = this.locate(id, prevView);
        if (was && (was.zone === 'graveyard' || was.zone === 'exile')) return before.piles.get(was.player + '/' + was.zone) || null;
        if (was && was.zone === 'hand') return before.hands.get(was.player) || null;
        if (was && was.zone === 'command') return null;
      }
      if (now.o && now.o.isToken) return 'pop';
      if (now.zone === 'stack') return 'pop';
      const owner = (now.o && (now.o.owner || now.o.controller)) || now.player;
      return before.piles.get(owner + '/library') || null;
    },

    /** Which pile a card that has gone should fall into. */
    _destFor(id, before) {
      const loc = this.locate(id, this.view);
      const piles = this._pileRects();
      const mv = this._moves && this._moves.get(id);
      if (mv && mv.to && !loc) {
        // somewhere this view does not show: a library, or a hand that is not yours
        const who = mv.toOwner || mv.owner;
        if (mv.to === 'library') return { rect: piles.get(who + '/library') || null, zone: 'library' };
        if (mv.to === 'hand') return { rect: this._handRects().get(who) || null, zone: 'hand' };
        if (mv.to === 'graveyard' || mv.to === 'exile') return { rect: piles.get(who + '/' + mv.to) || null, zone: mv.to };
      }
      if (loc && (loc.zone === 'graveyard' || loc.zone === 'exile')) return { rect: piles.get(loc.player + '/' + loc.zone), zone: loc.zone };
      if (loc && loc.zone === 'hand') {
        const hands = this._handRects();
        return { rect: hands.get(loc.player), zone: 'hand' };
      }
      const prevView = before.view;
      const was = prevView ? this.locate(id, prevView) : null;
      const owner = was && was.o ? (was.o.owner || was.player) : (was ? was.player : null);
      if (was && was.o && was.o.isToken) return { rect: null, zone: 'gone' };
      return { rect: owner ? piles.get(owner + '/library') : null, zone: 'library' };
    },

    _flip(before, gone) {
      const layer = this.fxLayer;
      const moves = [];
      for (const n of this.arena.querySelectorAll('.cv[data-id]')) {
        const r = U.rect(n);
        if (!r.width) continue;
        const id = n.dataset.id;
        const was = before.cards.get(id);
        if (was) {
          const dx = (was.left + was.width / 2) - (r.left + r.width / 2);
          const dy = (was.top + was.height / 2) - (r.top + r.height / 2);
          const s = was.width / r.width;
          if (Math.abs(dx) < 1.5 && Math.abs(dy) < 1.5 && Math.abs(s - 1) < 0.02) continue;
          moves.push({ n, from: `translate(${dx}px, ${dy}px) scale(${s})`, far: Math.hypot(dx, dy) > 220 });
        } else {
          const from = this._originFor(id, before);
          if (from === 'pop') moves.push({ n, from: 'scale(.55)', fade: true, pop: true });
          else if (from) {
            const dx = (from.left + from.width / 2) - (r.left + r.width / 2);
            const dy = (from.top + from.height / 2) - (r.top + r.height / 2);
            moves.push({ n, from: `translate(${dx}px, ${dy}px) scale(${Math.max(0.25, from.width / r.width)})`, fade: true, far: true });
          }
        }
      }
      /* A board wipe or a new turn can move dozens of cards at once. Only so
         many fly at a time, the far journeys and arrivals first; the rest
         simply are where they are, which on a phone is the difference
         between a smooth beat and a dropped second. */
      const cap = MTG.isPhone() ? 10 : 28;
      if (moves.length > cap) {
        moves.sort((x, y) => (y.far ? 2 : 0) + (y.fade ? 1 : 0) - (x.far ? 2 : 0) - (x.fade ? 1 : 0));
        moves.length = cap;
      }
      for (const m of moves) {
        const holder = m.n.closest('.unit, .hslot, .stack-item, .spot-card, .cmd-slot') || m.n;
        holder.classList.add('moving');
        const a = m.n.animate([
          { transform: m.from, opacity: m.fade ? 0.15 : 1 },
          { transform: 'none', opacity: 1 },
        ], { duration: m.pop ? 380 : m.far ? 560 : 340, easing: EASE });
        const done = () => holder.classList.remove('moving');
        a.finished.then(done, done);
        setTimeout(done, 900);
      }

      /* A card that has gone is flown out as a copy of itself, because the
         real one is about to be taken off the page. One that died comes
         apart on the way. */
      if (gone.length > (MTG.isPhone() ? 8 : 14)) return;
      for (const g of gone) {
        const was = before.cards.get(g.id);
        if (!was) continue;
        const dest = this._destFor(g.id, before);
        const prevLoc = before.view ? this.locate(g.id, before.view) : null;
        const dying = !!(prevLoc && prevLoc.zone === 'battlefield' && dest.zone === 'graveyard');
        const ghost = g.node.cloneNode(true);
        ghost.classList.remove('playable', 'targetable', 'candidate', 'chosen', 'attacking', 'blocking', 'declared-atk', 'declared-blk');
        ghost.classList.add('cv-ghost');
        if (dying) ghost.classList.add('dying');
        if (dest.zone === 'exile') ghost.classList.add('exiling');
        Object.assign(ghost.style, { left: was.left + 'px', top: was.top + 'px', width: was.width + 'px', height: was.height + 'px' });
        layer.appendChild(ghost);
        const to = dest.rect;
        const frames = to
          ? [{ transform: 'none', opacity: 1, offset: 0 },
             ...(dying ? [{ transform: 'scale(1.06)', opacity: 1, offset: 0.25 }] : []),
             { transform: `translate(${to.left + to.width / 2 - (was.left + was.width / 2)}px, ${to.top + to.height / 2 - (was.top + was.height / 2)}px) scale(${Math.max(0.2, to.width / was.width)}) rotate(${dying ? 8 : 0}deg)`, opacity: 0.1, offset: 1 }]
          : [{ transform: 'none', opacity: 1 }, { transform: 'scale(.6)', opacity: 0 }];
        const a = ghost.animate(frames, { duration: dying ? 760 : 520, easing: EASE, delay: dying ? 60 : 0 });
        a.finished.then(() => ghost.remove(), () => ghost.remove());
        /* A tab that is not drawing never finishes an animation, and a copy
           waiting on one would stay on the table for good; a timer is the
           backstop. */
        setTimeout(() => ghost.remove(), 1600);
      }
    },

    /* ---------------- what combat is about to do ----------------
       Working out who dies in a block is the sum every player does before
       committing, and the one a new player most often gets wrong. So while
       attacks and blocks are being chosen, and after they are declared, the
       table does it for you: a skull on anything the damage would kill, and
       the damage a player is about to take written under their portrait.
       It is the plain arithmetic of the creatures as they stand — a trick
       cast in response can always change it. */
    predictCombat() {
      const v = this.view, live = this.live || v;
      if (!v) return null;
      const byId = new Map(v.battlefield.map(o => [o.id, o]));
      const has = (o, k) => (o.keywords || []).some(w => String(w).toLowerCase() === k);
      const pairs = [];      // {a, blockers:[], defender}
      const ch = live.pendingChoice && live.pendingChoice.playerId === this.meId ? live.pendingChoice : null;
      if (ch && ch.type === 'declareBlockers' && this.blockPlan) {
        for (const id of (ch.attackers || [])) {
          const a = byId.get(id);
          if (!a) continue;
          const bl = this.blockPlan.declarations.filter(d => (d.attackerIds || []).includes(id)).map(d => byId.get(d.blockerId)).filter(Boolean);
          pairs.push({ a, blockers: bl, defender: a.attacking || this.meId });
        }
      } else if (ch && ch.type === 'declareAttackers' && this.attackPlan) {
        for (const d of this.attackPlan.declarations) {
          const a = byId.get(d.attackerId);
          if (a) pairs.push({ a, blockers: [], defender: d.defenderId, unblockedGuess: true });
        }
      } else {
        const attackers = v.battlefield.filter(o => o.attacking);
        if (!attackers.length || !/declareBlockers|firstStrikeDamage/.test(v.step)) return null;
        for (const a of attackers) {
          const bl = v.battlefield.filter(o => (o.blocking || []).includes(a.id));
          pairs.push({ a, blockers: bl, defender: a.attacking });
        }
      }
      if (!pairs.length) return null;
      const dmg = new Map();               // creature id -> damage it would take
      const toPlayer = new Map();          // player id -> damage
      const hit = (id, n) => dmg.set(id, (dmg.get(id) || 0) + n);
      const lethal = (o, src) => Math.max(0, (o.toughness || 0) - (o.damage || 0) - (dmg.get(o.id) || 0)) || (has(src, 'deathtouch') ? 1 : 0);
      const dies = new Set();
      const isDead = (o) => dies.has(o.id);
      const strike = (first) => {
        for (const pr of pairs) {
          const a = pr.a;
          const fsA = has(a, 'first strike') || has(a, 'double strike');
          const dsA = has(a, 'double strike');
          if (!isDead(a) && (first ? fsA : (!fsA || dsA))) {
            let left = Math.max(0, a.power || 0);
            const alive = pr.blockers.filter(b => !isDead(b));
            if (!pr.blockers.length) {
              if (left) toPlayer.set(pr.defender, (toPlayer.get(pr.defender) || 0) + left);
            } else {
              for (const b of alive) {
                if (!left) break;
                const need = has(a, 'deathtouch') ? 1 : Math.max(1, lethal(b, a));
                const give = alive.indexOf(b) === alive.length - 1 && !has(a, 'trample') ? left : Math.min(left, need);
                hit(b.id, give);
                if (has(a, 'deathtouch') && give > 0) dmg.set(b.id, Math.max(dmg.get(b.id), 999));
                left -= give;
              }
              if (left && has(a, 'trample')) toPlayer.set(pr.defender, (toPlayer.get(pr.defender) || 0) + left);
            }
          }
          for (const b of pr.blockers) {
            if (isDead(b)) continue;
            const fsB = has(b, 'first strike') || has(b, 'double strike');
            const dsB = has(b, 'double strike');
            if (first ? fsB : (!fsB || dsB)) {
              hit(a.id, Math.max(0, b.power || 0));
              if (has(b, 'deathtouch') && (b.power || 0) > 0) dmg.set(a.id, Math.max(dmg.get(a.id), 999));
            }
          }
        }
        for (const [id, n] of dmg) {
          const o = byId.get(id);
          if (o && !has(o, 'indestructible') && n + (o.damage || 0) >= (o.toughness || 0) && (o.toughness || 0) >= 0) dies.add(id);
        }
      };
      strike(true);
      strike(false);
      return { dies, toPlayer, guess: pairs.some(p => p.unblockedGuess) };
    },

    markCombat() {
      const p = this.predictCombat();
      const dies = p ? p.dies : new Set();
      for (const [id, n] of this.els) n.classList.toggle('doomed', dies.has(id));
      for (const orb of this.arena.querySelectorAll('.life-orb')) {
        const n = p ? (p.toPlayer.get(orb.dataset.player) || 0) : 0;
        let tag = orb.querySelector('.orb-incoming');
        if (!n) { if (tag) tag.remove(); continue; }
        const player = this.view.players.find(x => x.id === orb.dataset.player);
        const fatal = player && n >= player.life;
        if (!tag) { tag = el('div', { class: 'orb-incoming' }); orb.appendChild(tag); }
        tag.textContent = (p.guess ? 'up to ' : '') + '−' + n;
        tag.classList.toggle('fatal', !!fatal);
        tag.title = fatal ? 'That would be lethal' : `${n} damage incoming`;
      }
    },

    /* ---------------- sizes ----------------
       Every seat's cards are sized from the room it has and what is standing
       in it, worked out from the numbers rather than by measuring and
       shrinking: a few reads of the container, one write of a variable. */
    _fitAll() {
      this._lastShown = this.view;
      const phone = MTG.isPhone();
      // sizes from the resize observer, not read (and the layout forced) afresh every render
      const vh = this.sizeOf(this.arena).h || U.viewH();
      const scale = U.clamp(MTG.settings.cardScale || 1, 0.6, 2);
      const maxCw = Math.min(phone ? 76 : 128, vh * (phone ? 0.11 : 0.125)) * scale;
      const backScale = 0.78;
      for (const [, s] of this.seats) {
        if (!s.counts || !s.field.isConnected) continue;
        const box = this.sizeOf(s.field);
        const W = box.w - 16;
        const H = box.h - 8;
        if (W <= 0 || H <= 0) continue;
        const gap = 0.1;
        const sum = (list) => list.reduce((a, x) => a + x, 0) + Math.max(0, list.length - 1) * gap;
        const front = sum(s.counts.front);
        const back = (sum(s.counts.lands) + sum(s.counts.others) + (s.counts.lands.length && s.counts.others.length ? 0.5 : 0)) * backScale;
        const widest = Math.max(front, back, 1);
        const atts = Math.max(0, ...this.view.battlefield.filter(o => o.controller === s.root.dataset.seat).map(o => this._attachSpread(o)));
        const tall = CARD_RATIO * (1 + backScale) + 0.32 + atts * 0.2;
        let cw = Math.min(W / widest, H / tall, maxCw);
        // a board peeking in from the side is smaller, and cut off at the edge rather than shrunk to fit
        if (s.root.classList.contains('peek')) cw = Math.min(H / tall, maxCw) * 0.6;
        cw = Math.max(phone ? 26 : 34, cw);
        const want = cw.toFixed(1) + 'px';
        if (s.field.style.getPropertyValue('--cw') !== want) s.field.style.setProperty('--cw', want);
      }
    },

    /* ---------------- arrows ---------------- */

    /** Redraw for as long as cards are still moving under the arrows. */
    chaseArrows() {
      cancelAnimationFrame(this._arrowRaf);
      const until = performance.now() + 650;
      const step = () => {
        this.renderArrows();
        if (performance.now() < until && !this._destroyed) this._arrowRaf = requestAnimationFrame(step);
      };
      this._arrowRaf = requestAnimationFrame(step);
    },

    renderArrows() {
      const svg = this.svg;
      const v = this.view;
      while (svg.childNodes.length > 1) svg.removeChild(svg.lastChild);
      if (!v) return;
      const ar = U.rect(this.arena);
      svg.setAttribute('viewBox', `0 0 ${ar.width} ${ar.height}`);
      const box = (n) => { if (!n) return null; const r = U.rect(n); return r.width ? { x: r.left - ar.left + r.width / 2, y: r.top - ar.top + r.height / 2, w: r.width, h: r.height } : null; };
      const cardBox = (id) => box(this.els.get(id) && this.els.get(id).isConnected ? this.els.get(id) : null);
      const orbBox = (pid) => box(this.orbFor(pid));
      const defBox = (id) => cardBox(id) || orbBox(id);

      const paired = new Set();
      for (const o of v.battlefield) {
        if (!o.attacking) continue;
        const a = cardBox(o.id);
        if (!a) continue;
        const blockers = v.battlefield.filter(x => (x.blocking || []).includes(o.id));
        if (blockers.length) {
          for (const bl of blockers) { const b = cardBox(bl.id); if (b) { this._arrow(b, a, 'blk'); paired.add(bl.id); } }
          continue;
        }
        const b = defBox(o.attacking);
        if (b) this._arrow(a, b, 'atk');
      }
      for (const o of v.battlefield) {
        if (paired.has(o.id)) continue;
        for (const aid of (o.blocking || [])) { const a = cardBox(o.id), b = cardBox(aid); if (a && b) this._arrow(a, b, 'blk'); }
      }
      // plans you are still making are drawn dashed
      if (this.attackPlan) for (const d of this.attackPlan.declarations) {
        const a = cardBox(d.attackerId), b = defBox(d.defenderId);
        if (a && b) this._arrow(a, b, 'atk', true);
      }
      if (this.blockPlan) for (const d of this.blockPlan.declarations) {
        const a = cardBox(d.blockerId), b = cardBox((d.attackerIds || [])[0]);
        if (a && b) this._arrow(a, b, 'blk', true);
      }
      const ptr = this._pointer ? { x: this._pointer.x - ar.left, y: this._pointer.y - ar.top, w: 0, h: 0 } : null;
      if (this.blockPlan && this.blockPlan.pendingBlocker && ptr) {
        const a = cardBox(this.blockPlan.pendingBlocker);
        if (a) this._arrow(a, ptr, 'blk', true, true);
      }

      // whatever is on the stack points at what it chose
      for (const s of (v.stack || [])) {
        const src = (s.objId && cardBox(s.objId)) || box(this.arena.querySelector(`.ability-chip[data-stack="${CSS.escape(String(s.id))}"]`));
        if (!src) continue;
        for (const t of (s.targets || [])) {
          const b = t.kind === 'player' ? orbBox(t.id) : t.kind === 'stack'
            ? (() => { const it = (v.stack || []).find(x => x.id === t.id); return it ? (cardBox(it.objId) || box(this.arena.querySelector(`.ability-chip[data-stack="${CSS.escape(String(t.id))}"]`))) : null; })()
            : cardBox(t.id);
          if (b) this._arrow(src, b, 'tgt');
        }
      }
      // damage just dealt, for a moment
      if (this._zaps && this._zaps.length) {
        const now = performance.now();
        this._zaps = this._zaps.filter(z => z.until > now);
        const at = (r) => ({ x: r.left - ar.left + r.width / 2, y: r.top - ar.top + r.height / 2, w: r.width, h: r.height });
        for (const z of this._zaps) this._arrow(at(z.from), at(z.to), 'zap');
      }
      // and the target you are choosing follows the pointer
      const t = this.targeting;
      if (t) {
        const src = cardBox(t.source) || (this._dropAt ? { x: this._dropAt.x - ar.left, y: this._dropAt.y - ar.top, w: 0, h: 0 } : null);
        if (src) {
          for (const c of t.chosen) {
            const b = c.kind === 'player' ? orbBox(c.id) : cardBox(c.id);
            if (b) this._arrow(src, b, 'tgt');
          }
          if (ptr) this._arrow(src, ptr, 'aim', true, true);
        }
      }
    },

    hideAim() { this._dropAt = null; this.renderArrows(); },

    /** One arrow: a bowed line from the edge of one thing to the edge of another. */
    _arrow(a, b, cls, dashed, toPoint) {
      const ns = 'http://www.w3.org/2000/svg';
      let x1 = a.x, y1 = a.y, x2 = b.x, y2 = b.y;
      const dx = x2 - x1, dy = y2 - y1;
      const len = Math.hypot(dx, dy) || 1;
      if (len < 20) return;
      // start and finish at the edges, not the middles, so the cards stay readable
      const pull = (bx) => bx && bx.w ? Math.min(bx.w, bx.h) * 0.42 : 0;
      const s0 = Math.min(pull(a), len * 0.3), s1 = toPoint ? 0 : Math.min(pull(b), len * 0.3);
      x1 += dx / len * s0; y1 += dy / len * s0;
      x2 -= dx / len * s1; y2 -= dy / len * s1;
      const bow = Math.min(70, len * 0.18);
      const mx = (x1 + x2) / 2 - (dy / len) * bow;
      const my = (y1 + y2) / 2 + (dx / len) * bow;
      const d = `M ${x1.toFixed(1)} ${y1.toFixed(1)} Q ${mx.toFixed(1)} ${my.toFixed(1)} ${x2.toFixed(1)} ${y2.toFixed(1)}`;
      const under = document.createElementNS(ns, 'path');
      under.setAttribute('d', d);
      under.setAttribute('class', 'arrow-glow ' + cls);
      const p = document.createElementNS(ns, 'path');
      p.setAttribute('d', d);
      p.setAttribute('class', 'arrow ' + cls + (dashed ? ' dashed' : ''));
      p.setAttribute('marker-end', `url(#arw-${cls})`);
      this.svg.append(under, p);
    },

    /* ---------------- what just happened ---------------- */

    /** A line across the middle of the table saying what just happened. */
    say(text, kind, ms) {
      if (!text) return;
      const c = this.caption;
      c.innerHTML = '';
      c.appendChild(el('span', { class: 'cap-' + (kind || 'info'), html: this.logHtml(text) }));
      c.classList.remove('on'); void c.offsetWidth; c.classList.add('on');
      clearTimeout(this._captionTimer);
      this._captionTimer = setTimeout(() => c.classList.remove('on'), ms || 2600);
    },

    pushHistory(e) {
      if (!e || !e.kind || e.kind === 'noblock') return;
      e.key = 'h' + (++this._histN || (this._histN = 1));
      this.history.unshift(e);
      if (this.history.length > 16) this.history.length = 16;
      this.renderRail();
    },

    /** The last few things that happened, down the left edge, newest on top. */
    renderRail() {
      const host = this.rail;
      const sig = this.history.map(h => h.key).join(',');
      if (host._sig === sig) return;
      host._sig = sig;
      host.innerHTML = '';
      host.appendChild(el('button', { type: 'button', class: 'rail-log', title: 'Game log (L)', 'aria-label': 'Open the game log',
        onclick: () => this.toggleDrawer() }, [el('span', { text: 'Log' })]));
      const ICON = { cast: '✦', ability: '⚙', trigger: '↯', attack: '⚔', block: '⛨', died: '☠',
        left: '⇢', land: '▲', token: '✦', enter: '⬇', countered: '⊘', lost: '⚑' };
      for (const h of this.history.slice(0, 10)) {
        const url = h.card ? (MTG.scry.imageUrl(h.card, 'art_crop', 0) ||
          ((h.card._isToken || h.card.layout === 'token') ? (Table.helpers.tokenArtUrl(h.card) || '') : '')) : '';
        const mine = h.who === this.meId;
        host.appendChild(el('div', {
          class: 'hist-item k-' + h.kind + (mine ? ' mine' : ' theirs') + (url ? '' : ' no-art'),
          title: h.text || '', dataset: h.card ? { preview: h.key } : {},
        }, [
          el('div', { class: 'hi-art', style: url ? { backgroundImage: 'url("' + url.replace(/"/g, '%22') + '")' } : null }),
          el('span', { class: 'hi-icon', text: ICON[h.kind] || '•' }),
        ]));
      }
    },

    /**
     * Numbers and marks from the events: damage where it landed (with a
     * line from whatever dealt it, unless it was a creature in combat,
     * which has its arrow already), life where it changed, counters where
     * they went.
     */
    _eventFloats(prev, next, beat) {
      for (const d of beat.damage) {
        if (d.target.kind === 'object') {
          const n = this.els.get(d.target.id);
          if (n && n.isConnected) {
            // the number is as big as the blow
            this.float(n, '-' + d.amount, 'dmg', Math.min(1, d.amount / 8));
            n.classList.remove('hit'); void n.offsetWidth; n.classList.add('hit');
            setTimeout(() => n.classList.remove('hit'), 520);
          }
        }
        if (!d.combat) this.zap(d.source, d.target);
      }
      for (const [pid, delta] of beat.life) {
        if (!delta) continue;
        const orb = this.orbFor(pid);
        if (!orb) continue;
        orb.classList.remove('hurt', 'healed'); void orb.offsetWidth;
        orb.classList.add(delta < 0 ? 'hurt' : 'healed');
        setTimeout(() => orb.classList.remove('hurt', 'healed'), 800);
        this.float(orb, (delta > 0 ? '+' : '') + delta, delta < 0 ? 'life-down' : 'life-up', Math.min(1, Math.abs(delta) / 8));
      }
      // counters, added up per permanent and kind so a big swing is one number
      const sum = new Map();
      for (const c of beat.counters) {
        if (!c.objId) continue;
        const k = c.objId + '|' + c.kind;
        sum.set(k, (sum.get(k) || 0) + c.delta);
      }
      for (const [k, d] of sum) {
        if (!d) continue;
        const [id, kind] = k.split('|');
        const n = this.els.get(id);
        if (!n || !n.isConnected) continue;
        if (kind === '+1/+1' || kind === '-1/-1') {
          const x = kind === '+1/+1' ? d : -d;
          this.float(n, `${x > 0 ? '+' : ''}${x}/${x > 0 ? '+' : ''}${x}`, x > 0 ? 'buff' : 'dmg');
        } else if (kind === 'loyalty' || kind === 'defense') this.float(n, (d > 0 ? '+' : '') + d, d > 0 ? 'buff' : 'dmg');
      }
    },

    /** A quick line from a source to whatever it dealt damage to. */
    zap(sourceId, target) {
      if (this._motionOff() || !sourceId) return;
      const box = (n) => { if (!n || !n.isConnected) return null; const r = U.rect(n); return r.width ? r : null; };
      // a spell has usually gone by the time its damage is shown: it comes from where it was held up
      const from = box(this.els.get(sourceId)) || box(this.spotHost.querySelector('.spot-card')) || box(this.stackCol.lastElementChild);
      const to = target.kind === 'player' ? box(this.orbFor(target.id)) : box(this.els.get(target.id));
      if (!from || !to) return;
      this._zaps = (this._zaps || []).filter(z => z.until > performance.now());
      this._zaps.push({ from, to, until: performance.now() + 700 });
      this.renderArrows();
      clearTimeout(this._zapTimer);
      this._zapTimer = setTimeout(() => { if (!this._destroyed) this.renderArrows(); }, 720);
    },

    /** Floating numbers where life changed, and a jolt to the portrait. */
    _lifeFloats(prev, next) {
      for (const p of next.players) {
        const was = prev.players.find(x => x.id === p.id);
        if (!was || was.life === p.life) continue;
        const d = p.life - was.life;
        const orb = this.orbFor(p.id);
        if (!orb) continue;
        orb.classList.remove('hurt', 'healed'); void orb.offsetWidth;
        orb.classList.add(d < 0 ? 'hurt' : 'healed');
        setTimeout(() => orb.classList.remove('hurt', 'healed'), 800);
        this.float(orb, (d > 0 ? '+' : '') + d, d < 0 ? 'life-down' : 'life-up', Math.min(1, Math.abs(d) / 8));
      }
    },

    _boardFloats(prev, next, fromEvents) {
      const old = new Map(prev.battlefield.map(o => [o.id, o]));
      for (const o of next.battlefield) {
        const was = old.get(o.id);
        if (!was) continue;
        const n = this.els.get(o.id);
        if (!n || !n.isConnected) continue;
        if (!fromEvents && (o.damage || 0) > (was.damage || 0)) {
          this.float(n, '-' + ((o.damage || 0) - (was.damage || 0)), 'dmg');
          n.classList.remove('hit'); void n.offsetWidth; n.classList.add('hit');
          setTimeout(() => n.classList.remove('hit'), 520);
        }
        const c1 = ((was.counters || {})['+1/+1'] || 0) - ((was.counters || {})['-1/-1'] || 0);
        const c2 = ((o.counters || {})['+1/+1'] || 0) - ((o.counters || {})['-1/-1'] || 0);
        if (!fromEvents && c1 !== c2) this.float(n, (c2 > c1 ? '+' : '') + (c2 - c1) + '/' + (c2 > c1 ? '+' : '') + (c2 - c1), c2 > c1 ? 'buff' : 'dmg');
        const l1 = (was.counters || {}).loyalty, l2 = (o.counters || {}).loyalty;
        if (!fromEvents && l1 != null && l2 != null && l1 !== l2) this.float(n, (l2 > l1 ? '+' : '') + (l2 - l1), l2 > l1 ? 'buff' : 'dmg');
        if (o.power != null && was.power != null && (o.power !== was.power || o.toughness !== was.toughness) && c1 === c2) {
          const dp = o.power - was.power, dt = o.toughness - was.toughness;
          if (dp || dt) this.float(n, `${dp >= 0 ? '+' : ''}${dp}/${dt >= 0 ? '+' : ''}${dt}`, dp + dt >= 0 ? 'buff' : 'dmg');
        }
      }
    },

    /** A number that floats off whatever it happened to. */
    float(node, text, cls, size) {
      if (!node) return;
      const r = U.rect(node);
      if (!r.width) return;
      const ar = U.rect(this.arena);
      const f = el('div', {
        class: 'fx-float ' + (cls || ''), text: String(text),
        style: { left: (r.left - ar.left + r.width / 2) + 'px', top: (r.top - ar.top + r.height * 0.4) + 'px',
          fontSize: size != null ? (1.1 + size * 0.9).toFixed(2) + 'em' : null },
      });
      this.fxLayer.appendChild(f);
      setTimeout(() => f.remove(), 1500);
    },

    flash(kind) {
      if (this._motionOff()) return;
      const f = el('div', { class: 'fx-flash ' + (kind || '') });
      this.fxLayer.appendChild(f);
      setTimeout(() => f.remove(), 600);
    },

    /** The turn changing hands is the biggest thing that happens, so it gets a banner. */
    _turnBanner(v) {
      const p = v.players.find(x => x.id === v.activePlayer);
      if (!p) return;
      const mine = v.activePlayer === this.meId;
      const b = el('div', { class: 'fx-turn' + (mine ? ' mine' : '') }, [
        el('div', { class: 'ft-line' }),
        el('div', { class: 'ft-who', text: mine ? 'Your turn' : `${possessive(p.name)} turn` }),
        el('div', { class: 'ft-n', text: 'Turn ' + v.turn }),
      ]);
      this.fxLayer.appendChild(b);
      setTimeout(() => b.remove(), 1700);
    },

    /** A permanent that just did something lights up for a moment. */
    pulse(objId) {
      const n = this.els.get(objId);
      if (!n || !n.isConnected || this._motionOff()) return;
      n.classList.remove('pulsed'); void n.offsetWidth; n.classList.add('pulsed');
      setTimeout(() => n.classList.remove('pulsed'), 800);
    },

    _gameOverFx(v) {
      // the result screen is drawn by the decision layer; this is the flourish under it
      this.flash(v.winners.includes(this.meId) ? 'win' : 'lose');
      /* Shards for the game, once: for a seat that played it, not for a
         replay or someone watching */
      if (!v.replay && !v.spectating && this.me && MTG.economy) {
        const won = (v.winners || []).includes(this.meId);
        this._reward = MTG.economy.awardGame({ won });
        if (this._reward) setTimeout(() => MTG.sfx('shards', { intensity: Math.min(1, this._reward.total / 4000) }), 1400);
        // quests, the weekly track, mastery, ranked (src/10e-progress.js)
        if (this._reward && MTG.progress) {
          const app = MTG.app || {};
          const sess = app.session;
          const seat = sess && sess.seat ? sess.seat('me') : null;
          const deck = seat && seat.deck;
          if (this._reward) MTG.progress.noteEarned(this._reward.total);
          this._progress = MTG.progress.gameEnded({
            won, format: (sess && sess.formatId) || app.clientFormatId || null,
            deck: deck && deck.name, commander: deck && deck.commanders && deck.commanders[0] ? deck.commanders[0].name : null,
            // which ladder: 'standard' or 'commander'
            ranked: sess && sess.mode && sess.mode.ranked ? (sess.mode.ladder || 'standard') : null,
          });
          if (MTG.app && MTG.app.onGameRecorded) MTG.app.onGameRecorded(won, this._progress);
          // the result screen, drawn again with all of it (an event's record, a challenge solved)
          this._overStamp = (this._overStamp || 0) + 1;
          setTimeout(() => { if (this.view && this.view.over) this.render(); }, 0);
          if (this._progress.levels && this._progress.levels.length && UI.levelUp) setTimeout(() => UI.levelUp(this._progress.levels[this._progress.levels.length - 1]), 2600);
        }
      }
    },
  });
})(window.MTG);
