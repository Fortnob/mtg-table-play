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
  const { stepKey, idNum, truncate, possessive, faceName, CARD_RATIO } = Table.helpers;
  const EASE = 'cubic-bezier(.22,.8,.24,1)';
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  // what a view can carry and still have nothing in it to see (_worth)
  const TRIVIAL_EVENT = new Set(['step', 'priority', 'log', 'tap', 'untap', 'mana', 'zone', 'phase', 'draw', 'shuffle', 'choice']);
  // how long the turn passing has the middle of the table to itself (A5)
  const TURN_HOLD = 900;
  // why a player is out, in words (src/06b-events.js)
  const lossWords = (reason, from) => (MTG.events && MTG.events.lossWords ? MTG.events.lossWords(reason, from) : String(reason || ''));
  const lowerFirst = (t) => (t ? t.charAt(0).toLowerCase() + t.slice(1) : t);
  /** The beat's line for a player out of the game: who, and why where it is known. */
  const lostEvent = (who, name, me, reason, from) => {
    const why = lossWords(reason, from);
    return { kind: 'lost', who, reason: reason || '', from: from || null,
      text: `${name} ${who === me ? 'lose' : 'loses'}${why ? ' — ' + lowerFirst(why) : ''}` };
  };

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
        this._wakeIdle();
      }
    },

    /**
     * A view arriving. A view that changes nothing worth seeing from the
     * one waiting before it (a priority pass, a step) takes that one's
     * place rather than queueing behind it, with the events of both, so a
     * turn going by is a few views to show and not forty.
     */
    _enqueue(view) {
      const q = this.queue;
      const last = q[q.length - 1];
      if (last && this.view && !this._worth(view) && this._minor(last, view)) {
        view.events = last.events ? last.events.concat(view.events) : null;
        q[q.length - 1] = view;
        // it is as old as the one it replaced
        if (this._queuedAt && this._queuedAt.has(last)) this._queuedAt.set(view, this._queuedAt.get(last));
      } else q.push(view);
      if (!this._queuedAt) this._queuedAt = new WeakMap();
      if (!this._queuedAt.has(view)) this._queuedAt.set(view, performance.now());
    },

    /**
     * How quickly beats play: slower when the table is idle, much faster
     * when it is behind. Behind is counted in things worth seeing still
     * waiting, not in views: a turn changing hands is forty views of steps
     * and priority going by, and counting those played the one death among
     * them at a twelfth of its time. Only if the oldest thing worth seeing
     * has waited for seconds does the table hurry regardless, so it is
     * never a whole turn behind the game.
     */
    _pace() {
      let q = 0, oldest = 0;
      for (const v of this.queue) {
        if (!this._worth(v)) continue;
        q++;
        if (!oldest) oldest = (this._queuedAt && this._queuedAt.get(v)) || 0;
      }
      let f = MTG.settings.animSpeed != null ? MTG.settings.animSpeed : 1;
      if (this.paceScale) f *= this.paceScale;          // a replay played faster or slower
      if (this._motionOff()) f *= 0.5;
      const late = oldest ? performance.now() - oldest : 0;
      if (q > 8 || late > 8000) f *= 0.08;
      else if (q > 4 || late > 4000) f *= 0.35;
      else if (q > 2) f *= 0.7;
      return f;
    },

    /**
     * Whether a view carries something to see: anything but steps,
     * priority, lines of the log, lands tapping and cards moving between
     * hidden places. A view that came without its events is worked out
     * from the picture and counts.
     */
    _worth(v) {
      if (!v || !Array.isArray(v.events)) return true;
      for (const e of v.events) if (!TRIVIAL_EVENT.has(e.type)) return true;
      return false;
    },

    /**
     * Resolves once the table has shown everything it has been given and
     * let the last thing worth seeing sit for a moment: 400 ms after
     * something small, 900 ms after a spell resolving or a creature dying.
     * The bots wait on it (BotRunner.waitFor, src/14-app.js) so that what
     * they do next does not land on top of what they did last. Never
     * longer than `cap`, so a hidden tab or a stuck beat cannot hold the
     * game up.
     */
    whenIdle(cap) {
      const ms = cap || 6000;
      const limit = performance.now() + ms;
      return new Promise((resolve) => {
        let over = false;
        const done = (ok) => { if (!over) { over = true; clearTimeout(backstop); resolve(ok); } };
        // a hidden tab, a beat that never ends: the game goes on regardless
        const backstop = setTimeout(() => done(false), ms);
        const check = () => {
          if (over) return;
          // nobody is watching a hidden tab, whose timers the browser slows to a crawl
          if (this._destroyed || (typeof document !== 'undefined' && document.hidden)) return done(false);
          const now = performance.now();
          if (now >= limit) return done(false);
          if (!this.queue.length && !this._pumping) {
            const rest = (this._settleAt || 0) - now;
            if (rest <= 0) return done(true);
            setTimeout(check, rest + 5);
            return;
          }
          // the pump says when it runs dry
          (this._idleWaiters = this._idleWaiters || []).push(check);
        };
        check();
      });
    },

    _wakeIdle() {
      const w = this._idleWaiters;
      if (!w || !w.length) return;
      this._idleWaiters = [];
      for (const f of w) f();
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

      /* (an undo that went back across a turn is a cut to where it was: no turn passing to see — restore) */
      const restored = Array.isArray(next.events) && next.events.some(e => e.type === 'restore');
      if (!restored && (next.turn !== prev.turn || next.activePlayer !== prev.activePlayer)) {
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
          text: `${name(who)} attack${who === me ? '' : 's'} with ${attackers.length === 1 ? faceName(attackers[0]) : attackers.length + ' creatures'}` });
        hold(900);
      }
      const blk = (v) => v.battlefield.filter(o => (o.blocking || []).length).length;
      if (blk(next) > blk(prev)) {
        const bl = next.battlefield.filter(o => (o.blocking || []).length);
        const who = bl[0].controller;
        b.events.push({ kind: 'block', who, card: bl[0].card, name: `${bl.length} blocker${bl.length === 1 ? '' : 's'}`,
          text: `${name(who)} block${who === me ? '' : 's'} with ${bl.length === 1 ? faceName(bl[0]) : bl.length + ' creatures'}` });
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
        b.events.push({ kind: where === 'graveyard' && o.power != null ? 'died' : 'left', who: o.controller, card: o.card, name: faceName(o), text: `${faceName(o)} ${verb}` });
        hold(420);
      }
      // what arrived without passing through the stack: lands, tokens, things put onto it
      const prevIds = new Set(prev.battlefield.map(o => o.id));
      const stackObjs = new Set((prev.stack || []).map(s => s.objId));
      for (const o of next.battlefield) {
        if (prevIds.has(o.id) || stackObjs.has(o.id)) continue;
        const a = this.analysis(o);
        if (a && a.isLand) {
          if (o.controller !== me) { b.events.push({ kind: 'land', who: o.controller, card: o.card, name: faceName(o), text: `${name(o.controller)} plays ${faceName(o)}` }); hold(500); }
          continue;
        }
        if (o.isToken) { b.events.push({ kind: 'token', who: o.controller, card: o.card, name: faceName(o), text: `${name(o.controller)} create${o.controller === me ? '' : 's'} ${faceName(o)}` }); hold(320); continue; }
        b.events.push({ kind: 'enter', who: o.controller, card: o.card, name: faceName(o), text: `${faceName(o)} enters the battlefield` });
        hold(380);
      }

      for (const p of next.players) {
        const q = prev.players.find(x => x.id === p.id);
        if (!q) continue;
        if (q.life !== p.life) hold(Math.abs(p.life - q.life) >= 5 ? 700 : 450);
        if (!q.hasLost && p.hasLost) { b.events.push(lostEvent(p.id, name(p.id), me, p.lossReason, p.lossFrom)); hold(1200); }
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
     *
     * Each thing an opponent puts on the stack is a moment of its own (a
     * `sub`), held up in the middle in the order it happened: one still on
     * the stack over the board as it now is, one already gone (cast and
     * resolved between two views, as a guest often sees them) over the
     * board as it was, before its result. Triggers that do nothing to
     * anybody else — mana, a card drawn, a scry — are not held up at all
     * (_quietAbility). The beat's own hold is for its results.
     */
    _planEvents(prev, next) {
      const me = this.meId;
      const b = { hold: 0, spot: null, subs: [], events: [], turn: false, fromEvents: true,
        moves: new Map(), damage: [], life: new Map(), counters: [], leaving: [], weight: 0, luck: false };
      const name = (pid) => { const p = next.players.find(x => x.id === pid) || prev.players.find(x => x.id === pid); return pid === me ? 'You' : (p ? p.name : 'Someone'); };
      const hold = (ms) => { b.hold = Math.max(b.hold, ms); };
      // how long the bots give the table after this beat (whenIdle): longer after a spell or a death
      const weigh = (w) => { b.weight = Math.max(b.weight, w); };
      const s = (pid) => (pid === me ? '' : 's');
      const known = (id) => this.objIn(id, next) || this.objIn(id, prev);
      const cardOf = (e) => e.card || (known(e.objId) || {}).card || null;
      const cardName = (id) => { const o = known(id); return o && o.card ? faceName(o) : null; };
      // the face it shows (faceName), else the card's name
      const nameOf = (id, c) => cardName(id) || (c ? c.name : null);
      const liveStack = new Set((next.stack || []).map(x => x.id));
      const multi = (next.players || []).length > 2;
      const evs = next.events;
      // what came before, for why something left (_causeOf)
      const back = (this._evBack || []).concat(evs);
      const off = back.length - evs.length;
      for (let i = 0; i < evs.length; i++) {
        const e = evs[i];
        switch (e.type) {
          case 'turn': b.turn = true; hold(TURN_HOLD); weigh(400); break;
          case 'cast': case 'activate': case 'trigger': {
            const kind = e.type === 'cast' ? 'cast' : e.type === 'trigger' ? 'trigger' : 'ability';
            const targets = (e.targets || []).map(t => this.targetName(t)).filter(Boolean);
            const verb = kind === 'cast' ? 'cast' + s(e.controller) : kind === 'trigger' ? '— trigger:' : 'activate' + s(e.controller);
            const entry = { kind, who: e.controller, card: cardOf(e), name: e.name, targets,
              text: `${name(e.controller)} ${verb} ${e.name}${targets.length ? ' → ' + targets.join(', ') : ''}` };
            b.events.push(entry);
            if (e.controller === me) { hold(160); break; }
            // B8: a trigger that only helps its own controller goes by in the rail and the log
            if (kind !== 'cast' && this._quietAbility(e)) { entry.quiet = true; hold(200); break; }
            entry.spotted = true;
            weigh(900);
            // the same trigger several times over is one moment, ×N
            const last = b.subs[b.subs.length - 1];
            if (last && last.kind === 'spot' && last.e.type === e.type && last.e.controller === e.controller && last.e.name === e.name &&
                (last.e.text || '') === (e.text || '') && !(e.targets || []).length && !(last.e.targets || []).length &&
                last.live === liveStack.has(e.stackId)) {
              last.n++;
              break;
            }
            b.subs.push({ kind: 'spot', e, entry, n: 1, live: liveStack.has(e.stackId), stackId: e.stackId,
              objId: kind === 'cast' ? e.objId : null, trigger: kind === 'trigger', who: e.controller,
              hold: kind === 'cast' ? 1500 : 1150 });
            break;
          }
          case 'resolve': hold(260); weigh(e.kind === 'spell' ? 900 : 400); break;
          case 'counter':
            b.events.push({ kind: 'countered', who: e.controller, card: cardOf(e), name: e.name, text: `${e.name} is countered` });
            // long enough to read the stamp on it before it goes (A8)
            hold(1000); weigh(900);
            break;
          case 'attack': {
            const first = e.attackers[0];
            const c = cardOf({ objId: first.objId });
            /* No words for an attack on you, or your own: the creatures stepping forward and their arrows say it
               (A9). One between two other players in a bigger game is said, and whom it is at. */
            const atMe = e.player === me || e.attackers.some(a => a.defender === me || (known(a.defender) || {}).controller === me);
            const at = multi && !atMe ? next.players.find(x => x.id === first.defender) : null;
            b.events.push({ kind: 'attack', who: e.player, card: c, name: `${e.attackers.length} attacker${e.attackers.length === 1 ? '' : 's'}`,
              quiet: !multi || atMe,
              text: `${name(e.player)} attack${s(e.player)}${at ? ' ' + at.name : ''} with ${e.attackers.length === 1 ? (nameOf(first.objId, c) || 'a creature') : e.attackers.length + ' creatures'}` });
            hold(900); weigh(400);
            break;
          }
          case 'block': {
            const first = e.blocks[0];
            const c = cardOf({ objId: first.objId });
            const atkBy = (known((first.attackers || [])[0]) || {}).controller;
            b.events.push({ kind: 'block', who: e.player, card: c, name: `${e.blocks.length} blocker${e.blocks.length === 1 ? '' : 's'}`,
              quiet: !multi || e.player === me || atkBy === me,
              text: `${name(e.player)} block${s(e.player)} with ${e.blocks.length === 1 ? (nameOf(first.objId, c) || 'a creature') : e.blocks.length + ' creatures'}` });
            hold(900); weigh(400);
            break;
          }
          case 'leave': {
            const c = cardOf(e);
            if (e.isToken && e.to !== 'graveyard') break;
            const a = c ? MTG.oracle.analyze(c, 0) : null;
            if (!e.died && e.to === 'graveyard' && a && a.isLand && !a.isCreature) break;
            const verb = e.died ? 'dies' : e.to === 'graveyard' ? 'is put into a graveyard' : e.to === 'exile' ? 'is exiled'
              : e.to === 'hand' ? 'returns to hand' : e.to === 'library' ? 'goes into a library' : 'leaves';
            // (the face it showed as it left: a transformed card dies as its back face)
            const was = this.objIn(e.objId, prev);
            const nm = (was && was.card ? faceName(was) : null) || nameOf(e.objId, c) || 'A permanent';
            // A3: and why, where the events say
            const why = this._causeOf(e, nm, back, off + i);
            b.events.push({ kind: e.died ? 'died' : 'left', who: e.controller, card: c, name: nm, cause: why ? why.text : null,
              source: why ? why.source : null, objId: e.objId, text: `${nm} ${verb}${why ? ' — ' + why.text : ''}`,
              // a Treasure, a Clue, a Food used up is no news; it goes to the rail
              quiet: !!e.isToken && !e.died });
            b.leaving.push(e.objId);
            hold(e.died ? 700 : 450); weigh(e.died ? 900 : 400);
            break;
          }
          case 'enter': {
            if (e.from === 'stack') break;               // it was cast, and said so then
            const c = cardOf(e);
            const a = c ? MTG.oracle.analyze(c, 0) : null;
            const nm = nameOf(e.objId, c) || 'A permanent';
            if (a && a.isLand) {
              // a land an opponent plays lands with a thud and goes in the rail; it needs no words (A7)
              if (e.controller !== me) { b.events.push({ kind: 'land', who: e.controller, card: c, name: nm, quiet: true, text: `${name(e.controller)} plays ${nm}` }); hold(500); weigh(400); }
              break;
            }
            b.events.push({ kind: 'enter', who: e.controller, card: c, name: nm, text: `${nm} enters the battlefield` });
            hold(380); weigh(400);
            break;
          }
          case 'token': {
            const c = cardOf(e);
            const nm = nameOf(e.objId, c) || 'a token';
            b.events.push({ kind: 'token', who: e.controller, card: c, name: nm, text: `${name(e.controller)} create${s(e.controller)} ${nm}` });
            hold(320); weigh(400);
            break;
          }
          case 'zone': b.moves.set(e.objId, e); break;
          case 'damage': b.damage.push(e); hold(450); weigh(400); break;
          case 'life': {
            b.life.set(e.player, (b.life.get(e.player) || 0) + e.delta);
            hold(Math.abs(b.life.get(e.player)) >= 5 ? 700 : 450); weigh(400);
            break;
          }
          case 'counters': b.counters.push(e); break;
          case 'lose':
            b.events.push(lostEvent(e.player, name(e.player), me, e.reason, e.from));
            hold(1200); weigh(900);
            break;
          // coins and dice: shown in the middle (src/12f-ui-feel.js), a moment of their own (_present)
          case 'roll': case 'coin': b.luck = true; weigh(400); break;
          default: break;
        }
      }
      // no blocks is news too, if you are the one attacking
      const attackers = next.battlefield.filter(o => o.attacking);
      if (attackers.length && prev.step === 'declareAttackers' && next.step !== 'declareAttackers' &&
          !next.battlefield.some(o => (o.blocking || []).length) && attackers[0].controller === me) {
        b.events.push({ kind: 'noblock', who: null, text: 'No blocks' }); hold(500);
      }
      // several things died at once: one line for them all
      const died = b.events.filter(x => x.kind === 'died');
      if (died.length > 1) {
        const cause = died.every(x => x.cause === died[0].cause) ? died[0].cause : null;
        const names = died.map(x => x.name);
        const all = names.length > 4 ? `${names.length} creatures` : names.slice(0, -1).join(', ') + ' and ' + names[names.length - 1];
        died[died.length - 1].sum = `${all} die${cause ? ' — ' + cause : ''}`;
      }
      return b;
    },

    /**
     * An ability an opponent's permanent put on the stack that is no news to
     * anybody else: it targets nothing and only makes mana, draws or looks
     * at its own controller's cards, or the like. Said in the rail and the
     * log; not held up in the middle (B8).
     */
    _quietAbility(e) {
      if ((e.targets || []).length) return false;
      const text = String(e.text || '').replace(/\([^)]*\)/g, ' ');
      if (!text.trim()) return false;
      // anything that reaches past its controller is news
      if (/opponent|each player|each other player|target|each creature|all creatures|each permanent|all permanents|destroy|exile|sacrific|discard|damage|loses? .*life|the game|owner'?s? hand|counter (it|that|target)|gain control|tap (all|each|up to)|copy|attack|fight/i.test(text)) return false;
      return /\badd\b|draws? (a|an|one|two|three|\d+) cards?|\bscry\b|\bsurveil\b|untap (it|this|~)|you gain \d+ life|investigate|create (a|an) (treasure|clue|food|blood)|look at the top/i.test(text);
    },

    /**
     * Why something left the battlefield, from the events before it (and
     * just after: a sacrifice is written down as it is made): a rule
     * ("legend rule", "0 toughness"), the damage that did it and from
     * what, or the spell or ability resolving at the time. Null when it
     * cannot be told, which is then simply not said.
     * @returns {{text: string, source: string|null}|null}
     */
    _causeOf(e, nm, back, at) {
      const id = e.objId;
      const has = (x) => !!(nm && x && x.text && x.text.indexOf(nm) >= 0);
      let rule = null, resolving = null, sac = null, settled = false;
      for (let i = at - 1, n = 0; i >= 0 && n < 160; i--, n++) {
        const x = back[i];
        if (x.type === 'turn' || (x.type === 'leave' && x.objId === id)) break;
        // anything before priority last passed belongs to an earlier moment
        if (x.type === 'priority' || x.type === 'step') settled = true;
        if (settled) continue;
        if (x.type === 'log' && x.kind === 'sba' && !rule && has(x)) rule = x;
        if (x.type === 'log' && x.kind === 'sacrifice' && !sac && has(x)) sac = x;
        if (x.type === 'resolve' && !resolving) resolving = x;
      }
      /* just after: a sacrifice is logged once made, and a spell cast or an ability activated straight after it is
         what it was paid for (a Treasure for mana, a creature for a cost) — not whatever resolved a while before */
      let paid = null;
      for (let i = at + 1; i < back.length && i < at + 8; i++) {
        const x = back[i];
        if (x.type === 'priority' || x.type === 'turn' || x.type === 'step' || x.type === 'resolve') break;
        if (x.type === 'log' && x.kind === 'sacrifice' && has(x) && !sac) sac = x;
        if ((x.type === 'cast' || x.type === 'activate') && !paid) paid = x;
      }
      if (paid) resolving = null;
      // what dealt it damage this turn
      const hurt = [];
      for (let i = at - 1, n = 0; i >= 0 && n < 400; i--, n++) {
        const x = back[i];
        if (x.type === 'turn') break;
        if (x.type === 'damage' && x.target && x.target.kind === 'object' && x.target.id === id) hurt.push(x);
      }
      const byDamage = () => {
        if (!hurt.length) return null;
        const total = hurt.reduce((m, x) => m + (x.amount || 0), 0);
        const srcs = [...new Set(hurt.map(x => x.sourceName || ''))];
        if (srcs.length === 1 && srcs[0]) return { text: `${srcs[0]} (${total} damage)`, source: hurt[0].source || null };
        if (hurt.every(x => x.combat)) return { text: 'in combat', source: null };
        return { text: `${total} damage`, source: null };
      };
      // (a trigger is named by its source: "Flametongue Kavu", not the start of its words)
      const what = resolving ? String(resolving.name || '').split(' \u2014 ')[0] : '';
      if (rule) {
        const t = rule.text;
        if (/^Legend rule/i.test(t)) return { text: 'legend rule', source: null };
        if (/\(toughness -?\d+\)/.test(t)) return { text: resolving ? `${what} (0 toughness)` : '0 toughness', source: resolving ? resolving.objId || null : null };
        if (/damage/.test(t)) return byDamage() || { text: 'lethal damage', source: null };
        if (/0 loyalty/.test(t)) return { text: 'no loyalty left', source: null };
        if (/sacrificed/.test(t)) return { text: 'sacrificed — ' + ((t.match(/\(([^)]*)\)/) || [])[1] || 'a rule'), source: null };
        if (/enchanted|attached/.test(t)) return { text: 'what it was attached to is gone', source: null };
      }
      if (sac) return { text: resolving && resolving.objId !== id ? `sacrificed to ${what}` : paid ? `sacrificed for ${String(paid.name || '').split(' \u2014 ')[0]}` : 'sacrificed', source: null };
      if (resolving && resolving.objId !== id) {
        if (e.died && hurt.some(x => x.source === resolving.objId || x.sourceName === resolving.name || x.sourceName === what)) return byDamage();
        return { text: (e.died || e.to === 'graveyard' ? 'destroyed by ' : '') + what, source: resolving.objId || null };
      }
      return e.died ? byDamage() : null;
    },

    /** Keep the latest events, for the causes of what happens next (_causeOf). */
    _remember(evs) {
      if (!Array.isArray(evs) || !evs.length) return;
      const keep = (this._evBack || []).concat(evs.filter(e => e.type !== 'tap' && e.type !== 'untap' && e.type !== 'zone'));
      this._evBack = keep.length > 400 ? keep.slice(-300) : keep;
    },

    /**
     * One beat: its moments one at a time, in order, each given its time —
     * whatever an opponent put on the stack and is gone already, held up
     * over the board as it was; the board as it now is, with what happened
     * said; coins and dice; the turn passing; then whatever is on the stack
     * now, one after another. The middle of the table never shows two of
     * these at once (A2, A5, A7).
     */
    async _present(next) {
      const prev = this.view;
      const beat = this._plan(prev, next);
      // a plan for an action that the game has moved past is no longer yours to finish
      if (prev && (!next.pendingChoice || next.pendingChoice.type !== 'declareAttackers')) this.attackPlan = null;
      if (prev && (!next.pendingChoice || next.pendingChoice.type !== 'declareBlockers')) this.blockPlan = null;
      if (prev && (!next.pendingChoice || !/^(discard|discardToHandSize)$/.test(next.pendingChoice.type))) this.discardSel = [];
      if (prev && (!next.pendingChoice || next.pendingChoice.type !== 'sacrifice')) this.sacSel = [];
      if (this.targeting && this.targeting.legal && !(next.pendingChoice && next.pendingChoice.type === 'pickTarget')) this.targeting = null;
      if (beat.fromEvents) this._remember(next.events);
      // (a picture worked out by comparison holds up its newest spell, as it always did)
      const subs = beat.subs || (beat.spot ? [{ kind: 'spot', live: true, stackId: beat.spot.stackId, objId: beat.spot.objId, trigger: beat.spot.trigger, n: 1, hold: beat.hold, who: null }] : []);
      const spots = subs.filter(x => x.kind === 'spot');
      const line = prev ? this._beatLine(next, beat) : null;
      // whatever the last beat said is done with once this one has something of its own (A7)
      if (line || spots.length || beat.turn) this._captionDone();

      // 1. what was cast and is gone already, over the board as it was
      if (prev) for (const sp of spots.filter(x => !x.live)) {
        if (this._destroyed) return;
        await this._spotBeat(sp, true);
      }
      if (this._destroyed) return;

      // 2. the board as it is now
      const live = spots.filter(x => x.live && (next.stack || []).some(s => s.id === x.stackId));
      // its first spell straight into the middle, unless something is to be said or seen first
      const first = live.length && !line && !beat.turn && !beat.luck ? live[0] : null;
      this.view = next;
      /* A view the table jumps to rather than plays out to — a replay scrubbed to another turn (which asks for no
         motion before handing it over), an undo — changes whose board is in view without the turn to it. */
      this._focusCut = !!this._noMotionOnce || (Array.isArray(next.events) && next.events.some(e => e.type === 'restore'));
      if (first) { this._swingFor(first, next); this._spotOn(first); }
      else if (this.spot && !(next.stack || []).some(s => s.id === this.spot.stackId)) this._spotOff();
      // where each card that moved really came from, and where whatever is leaving last stood
      this._moves = beat.moves || null;
      const lastAt = new Map();
      for (const id of (beat.leaving || [])) { const n = this.els.get(id); if (n && n.isConnected) { const r = U.rect(n); if (r.width) lastAt.set(id, r); } }
      beat.lastAt = lastAt;
      this.render();
      this._moves = null;
      this._focusCut = false;
      this._report(prev, next, beat, line);
      const shownAt = performance.now();

      // 3. coins and dice, then the turn passing, each on its own
      if (beat.luck && prev) await this._luckWait();
      if (beat.turn && prev) {
        await this._hold(TURN_HOLD, 'turn');
        this._turnBandOff();
      }
      if (this._destroyed) return;
      // 4. what is on the stack now, one at a time; the first once what was said has been read
      if (first) await this._hold(first.hold, 'spot');
      else if (live.length && line) await this._hold(Math.max(700, beat.hold), 'line');
      for (const sp of live) {
        if (sp === first || this._destroyed) continue;
        await this._spotBeat(sp, false);
      }
      if (this._destroyed) return;
      // 5. and what happened, for as long as it deserves
      if (!live.length) {
        const pace = this._pace();
        const rest = beat.hold * pace - (performance.now() - shownAt);
        if (rest > 30) await this._hold(rest / Math.max(0.01, pace), 'result');
      }
      if (this.spot && spots.some(x => x.stackId === this.spot.stackId)) {
        this._spotOff();
        if (!this.queue.length && !this._destroyed) this.render();
      }
      this._swingBack(next, beat.turn);
      // the bots give the table a moment after anything worth seeing (whenIdle)
      if (beat.weight) {
        const base = (MTG.settings.animSpeed != null ? MTG.settings.animSpeed : 1) * (this.paceScale || 1);
        this._settleAt = performance.now() + beat.weight * base * (this._pace() < 0.5 ? 0.3 : 1);
      }
      this._flushSay();
    },

    /**
     * Wait for a moment of a beat to be seen: `ms` at the table's pace. A
     * click on the table cuts it short (_beatClick), so nobody is kept
     * waiting on the show.
     */
    _hold(ms, what) {
      const t = ms * this._pace();
      if (this._holdTrace) this._holdTrace(what, ms, t);
      if (!(t > 30)) return Promise.resolve();
      return new Promise((resolve) => {
        const done = () => { clearTimeout(timer); if (this._skipHold === done) this._skipHold = null; resolve(undefined); };
        const timer = setTimeout(done, t);
        this._skipHold = done;
      });
    },

    /** The coins and dice of this beat, landed and read (a click puts them away), before anything else is shown. */
    _luckWait() {
      const q = MTG.feel && MTG.feel._luckQueue;
      if (!q) return Promise.resolve();
      if (this._holdTrace) this._holdTrace('luck', 0, 0);
      return new Promise((resolve) => {
        const done = () => { clearTimeout(timer); if (this._skipHold === done) this._skipHold = null; resolve(undefined); };
        const timer = setTimeout(done, 4000);
        this._skipHold = done;
        q.then(done, done);
      });
    },

    /** A pointer pressed while a moment is held: on the thing held up, or anywhere while the table is catching up, moves it on. */
    _beatClick(e) {
      if (!this._skipHold) return;
      const sr = this.spotHost.classList.contains('on') ? U.rect(this.spotHost) : null;
      const onSpot = !!sr && e.clientX >= sr.left && e.clientX <= sr.right && e.clientY >= sr.top && e.clientY <= sr.bottom;
      if (onSpot || !this._ready()) this._skipHold();
    },

    /** Hold one thing an opponent put on the stack up in the middle for its time; `ghost` when it is gone already. */
    async _spotBeat(sp, ghost) {
      // in a bigger game, the board it is aimed at is brought into view for it (A10)
      this._swingFor(sp, this.view);
      this._spotOn(sp, ghost);
      // (heard now: a spell gone before its picture came is not heard again with its result)
      if (ghost && sp.e && MTG.feel && MTG.feel.cue) MTG.feel.cue(this, sp.e);
      this.render();
      await this._hold(sp.hold, ghost ? 'ghost' : 'spot');
      this._spotOff();
      if (ghost) this.render();
    },

    _spotOn(sp, ghost) {
      this.spot = Object.assign({}, sp, { ghost: !!ghost });
      if (this.accessSay && sp.entry && sp.who !== this.meId) this.accessSay(sp.entry.text + (sp.n > 1 ? ` (${sp.n} times)` : '') + '.');
      this._actingPlate(sp.who, true);
    },
    _spotOff() {
      if (this.spot) this._actingPlate(this.spot.who, false);
      this.spot = null;
      for (const n of this.arena.querySelectorAll('.spot-target')) n.classList.remove('spot-target');
    },

    /** The nameplate along the top of whoever is acting, in a bigger game, lit while their moment is up (A10). */
    _actingPlate(pid, on) {
      const plate = pid && this._plates && this._plates.get(pid);
      if (plate) plate.classList.toggle('casting', !!on);
    },

    /**
     * A10: in a game of more than two, what is held up should be seen
     * landing. When it is aimed at a board that is not in view (not yours,
     * not the one looked at), the table turns to that board for the moment
     * and back after. Never while you are choosing something, never away
     * from a board you picked yourself, and not with less motion asked for
     * (the caster's nameplate lights instead).
     */
    _swingFor(sp, v) {
      if (!v || (v.players || []).length < 3 || this._pinned || this.targeting || this._motionOff()) return false;
      if (MTG.settings.splitOpponents) return false;
      const ch = (this.live || v).pendingChoice;
      if (ch && ch.playerId === this.meId) return false;
      const ts = (sp.e ? sp.e.targets : ((v.stack || []).find(s => s.id === sp.stackId) || {}).targets) || [];
      let want = null;
      for (const t of ts) {
        const pid = t.kind === 'player' ? t.id : t.kind === 'object' ? (this.objIn(t.id, v) || {}).controller : null;
        // aimed at you, or at the board in view: that is in view already
        if (!pid || pid === this.meId || pid === this.focusSeat) return false;
        want = want || pid;
      }
      if (!want || !(v.players || []).some(p => p.id === want && !p.hasLost)) return false;
      // (kept until what it did has been seen: _swingBack)
      this._beatFocus = want;
      this._beatFocusFor = sp.stackId;
      this._beatFocusUntil = performance.now() + 8000;
      return true;
    },

    /** The board turned to for something held up (A10) is turned away from once what it did has been shown. */
    _swingBack(next, turned) {
      if (!this._beatFocus) return;
      const still = (next.stack || []).some(s => s.id === this._beatFocusFor);
      if (still && !turned && performance.now() < (this._beatFocusUntil || 0)) return;
      this._beatFocus = null;
      this._beatFocusFor = null;
      if (!this._destroyed) this.render();
    },

    /** The words for a beat in the middle of the table, if it has any: what you did yourself needs none, except where it ended up. */
    _beatLine(next, beat) {
      const out = this._eliminations(next, beat);
      const told = beat.events.filter(e => e.text && !e.quiet && !e.spotted && !out.includes(e) &&
        (e.who !== this.meId || ['attack', 'died', 'lost', 'countered', 'noblock'].includes(e.kind)));
      const line = told.length ? told[told.length - 1] : null;
      if (line && beat.spot && !beat.subs && (line.kind === 'cast' || line.kind === 'ability' || line.kind === 'trigger')) return null;
      return line ? { text: line.sum || line.text, kind: line.kind } : null;
    },

    /** Everything said about a beat that is not a card moving. */
    _report(prev, next, beat, line) {
      if (!prev) return;
      if (beat.turn) this._turnChange(next);
      if (beat.fromEvents) this._eventFloats(prev, next, beat);
      else this._lifeFloats(prev, next);
      this._boardFloats(prev, next, beat.fromEvents);
      for (const e of beat.events) this.pushHistory(e);
      this._voice(prev, next, beat);
      // somebody out of a game that goes on without them has a callout of their own
      const out = this._eliminations(next, beat);
      if (out.length) this._eliminatedCallout(out);
      if (line) this.say(line.text, line.kind);
      // what left, and what made it: a line from the thing that did it to where it stood (A3)
      for (const e of beat.events) {
        if ((e.kind !== 'died' && e.kind !== 'left') || !e.source) continue;
        const to = beat.lastAt && beat.lastAt.get(e.objId);
        if (to && !(beat.damage || []).some(d => d.target && d.target.id === e.objId && !d.combat)) this.zap(e.source, null, to);
      }
      // anything the engine could not do itself is said loudly, once
      /* the entries after the last one the table had seen: the view carries only the last 200, so once
         it is full a count of new lines comes to nothing — and slice(-0) is the whole log, which said
         every "resolve this by hand" again on every tap (Yusri, Fortune's Flame) */
      const pl = prev.log || [], nl = next.log || [];
      const lastSeen = pl[pl.length - 1];
      let at = -1;
      if (lastSeen) for (let i = nl.length - 1; i >= 0; i--) { const x = nl[i]; if (x.t === lastSeen.t && x.type === lastSeen.type && x.text === lastSeen.text) { at = i; break; } }
      // and should that line have gone (a long log trimmed), only what came after it in time: never the whole log again
      const fresh = !lastSeen ? nl : at >= 0 ? nl.slice(at + 1) : nl.filter(x => (x.t || 0) > (lastSeen.t || 0));
      for (const e of fresh) if (e.type === 'manual') this.say(e.text, 'manual', 6000);
      // a board wipe is worth feeling
      const gone = prev.battlefield.filter(o => !next.battlefield.some(x => x.id === o.id) && o.power != null).length;
      if (gone >= 3) this.flash('wipe');
      if (!prev.over && next.over) this._gameOverFx(next);
    },

    /**
     * The players another player at the table sees put out of the game in
     * this beat, for the callout: only in a game of three or more, where
     * the game goes on without them (with two, the game is simply over),
     * and not the last one out, whose loss is the end of the game and has
     * its own screen. Your own loss is on your own seat already.
     */
    _eliminations(next, beat) {
      if (!next || (next.players || []).length < 3 || next.over) return [];
      return beat.events.filter(e => e.kind === 'lost' && e.who !== this.meId);
    },

    /** "Mira has been eliminated", and why, across the table for a few seconds; said to a screen reader too. */
    _eliminatedCallout(out) {
      const v = this.view;
      const rows = out.map(e => {
        const p = (v.players || []).find(x => x.id === e.who);
        const why = lossWords(e.reason, e.from);
        return { name: p ? p.name : 'A player', why };
      });
      const node = el('div', { class: 'fx-out', 'aria-hidden': 'true' }, [
        el('div', { class: 'fo-line' }),
        ...rows.map(r => el('div', { class: 'fo-row' }, [
          el('div', { class: 'fo-who', text: `${r.name} has been eliminated` }),
          r.why ? el('div', { class: 'fo-why', text: r.why }) : null,
        ].filter(Boolean))),
      ]);
      if (this._outCallout) this._outCallout.remove();
      this._outCallout = node;
      this.fxLayer.appendChild(node);
      clearTimeout(this._outTimer);
      this._outTimer = setTimeout(() => { node.remove(); if (this._outCallout === node) this._outCallout = null; }, 3600);
      if (this.accessSay) this.accessSay(rows.map(r => `${r.name} has been eliminated${r.why ? ': ' + lowerFirst(r.why) : ''}.`).join(' '), true);
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
        // the size its marks and numbers were drawn at, which came from its row and not from the effects layer
        try { const cs = getComputedStyle(g.node); for (const k of ['--w', '--cw']) { const val = cs.getPropertyValue(k); if (val) ghost.style.setProperty(k, val.trim()); } } catch (e) { /* drawn at the layer's size */ }
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
      /* the engine's rule (_lethalLeft, _hasLethalDamage): toughness, or power under Zilortha, Strength Incarnate
         ("Lethal damage dealt to creatures you control is determined by their power"), where a 0-power one dies to any */
      const stat = (o) => (o.lethalByPower ? o.power : o.toughness) || 0;
      const lethal = (o, src) => Math.max(o.lethalByPower ? 1 : 0, stat(o) - (o.damage || 0) - (dmg.get(o.id) || 0)) || (has(src, 'deathtouch') ? 1 : 0);
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
          if (o && !has(o, 'indestructible') && n + (o.damage || 0) >= stat(o) && (o.lethalByPower ? n + (o.damage || 0) > 0 : (o.toughness || 0) >= 0)) dies.add(id);
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
        const peek = s.root.classList.contains('peek');
        /* One long row shrinks every card to fit it. When that leaves them
           well short of full size and there is height to spare, the rows
           wrap instead — the creatures in two or three rows, the lands and
           the rest likewise — at the biggest size at which they all fit. */
        let rows = { front: 1, back: 1 };
        if (!peek && cw < maxCw * 0.85) {
          for (let c = Math.floor(maxCw); c >= cw * 1.06; c--) {
            const l = this._fieldRows(s.counts, (W - 2) / c, backScale, atts);
            if ((l.front > 1 || l.back > 1) && l.tall * c <= H) { rows = l; cw = c; break; }
          }
        }
        s.field.classList.toggle('wrap-front', rows.front > 1);
        s.field.classList.toggle('wrap-back', rows.back > 1);
        // a board peeking in from the side is smaller, and cut off at the edge rather than shrunk to fit
        if (peek) cw = Math.min(H / tall, maxCw) * 0.6;
        cw = Math.max(phone ? 26 : 34, cw);
        const want = cw.toFixed(1) + 'px';
        if (s.field.style.getPropertyValue('--cw') !== want) s.field.style.setProperty('--cw', want);
        // how wide each wrapped lane is, so its rows come out even
        for (const k of ['front', 'lands', 'others']) {
          const w = rows.widths ? Math.ceil(rows.widths[k] * cw) + 'px' : '';
          if (s.field.style.getPropertyValue('--' + k + '-w') !== w) s.field.style.setProperty('--' + k + '-w', w);
        }
      }
    },

    /**
     * How many rows a seat's permanents wrap into across `room` card widths
     * (the widths in `counts`, as renderField sets them), the way the
     * browser breaks a wrapping row: the creatures' row, and the lands and
     * the rest, which share a row while they fit on one and otherwise each
     * take rows of their own. `tall` is the height that needs, in card
     * widths; `widths` the narrowest each lane can be and keep that many
     * rows, so they come out even rather than a full row and a straggler.
     */
    _fieldRows(counts, room, backScale, atts) {
      const ROW_GAP = 0.12;
      const lines = (list, gap, w) => {
        let n = 0, at = 0;
        for (const x of list) {
          if (!n || at + gap + x > w) { n++; at = x; } else at += gap + x;
        }
        return n;
      };
      // the narrowest width that still takes no more rows than `room` does
      const even = (list, gap) => {
        const n = lines(list, gap, room);
        let lo = Math.max(0, ...list), hi = room;
        if (n <= 1) return hi;
        for (let i = 0; i < 18; i++) { const mid = (lo + hi) / 2; if (lines(list, gap, mid) <= n) hi = mid; else lo = mid; }
        return hi + 0.02;
      };
      const sum = (list, gap) => list.reduce((a, x) => a + x, 0) + Math.max(0, list.length - 1) * gap;
      const lands = counts.lands.map(x => x * backScale), others = counts.others.map(x => x * backScale);
      const front = Math.max(1, lines(counts.front, 0.1, room));
      const both = lands.length && others.length;
      const back = Math.max(1, sum(lands, 0.08) + sum(others, 0.08) + (both ? 0.5 : 0) <= room ? 1
        : lines(lands, 0.08, room) + lines(others, 0.08, room));
      const tall = front * CARD_RATIO + back * CARD_RATIO * backScale + (front + back - 2) * ROW_GAP + 0.32 + atts * 0.2;
      return { front, back, tall, widths: { front: even(counts.front, 0.1), lands: even(lands, 0.08), others: even(others, 0.08) } };
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
      // an attacker picked up: its arrow follows the pointer, and whatever it can attack glows
      const pend = this.attackPlan && this.attackPlan.pending;
      if (pend && ptr) {
        const a = cardBox(pend);
        if (a) this._arrow(a, ptr, 'atk', true, true);
      }
      const chA = (this.live || v).pendingChoice;
      const canHit = new Set(pend && chA && chA.type === 'declareAttackers' ? (chA.defenders || []).map(d => d.id) : []);
      for (const n of this.arena.querySelectorAll('.atk-target')) n.classList.remove('atk-target');
      for (const id of canHit) {
        const plate = this._plates && this._plates.get(id);
        if (plate) plate.classList.add('atk-target');
        for (const n of this.arena.querySelectorAll(`.life-orb[data-player="${CSS.escape(String(id))}"]`)) n.classList.add('atk-target');
        const c = this.els && this.els.get(id);
        if (c) c.classList.add('atk-target');
      }
      if (this.blockPlan && this.blockPlan.pendingBlocker && ptr) {
        const a = cardBox(this.blockPlan.pendingBlocker);
        if (a) this._arrow(a, ptr, 'blk', true, true);
      }

      // what is held up in the middle points from there at what it chose, gone already or not (A2, A6)
      const sp = this.spot;
      const spotBox = sp ? (box(this.spotHost.querySelector('.spot-card')) || box(this.spotHost.querySelector('.spot-cap'))) : null;
      if (sp && spotBox) {
        const item = sp.ghost ? sp.e : (v.stack || []).find(x => x.id === sp.stackId);
        for (const t of ((item && item.targets) || [])) {
          const b = t.kind === 'player' ? orbBox(t.id) : t.kind === 'stack'
            ? box(this.stackCol.querySelector(`[data-stack="${CSS.escape(String(t.id))}"]`)) : cardBox(t.id);
          if (b) this._arrow(spotBox, b, 'tgt');
        }
      }
      // whatever is on the stack points at what it chose
      for (const s of (v.stack || [])) {
        if (sp && spotBox && !sp.ghost && s.id === sp.stackId) continue;
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

    /**
     * A line across the middle of the table saying what just happened.
     *
     * The middle of the table says one thing at a time (A7): while a card
     * is held up there, the turn is passing or dice are rolling, a line
     * waits its turn (_flushSay) — or, if it has waited too long to still
     * be news, is only read out to a screen reader. A line the engine
     * could not act on by itself ('manual') never waits.
     */
    say(text, kind, ms) {
      if (!text) return;
      if (kind !== 'manual' && this._slotBusy()) {
        const q = this._sayQ = (this._sayQ || []).filter(x => x.text !== text);
        q.push({ text, kind, ms, at: performance.now() });
        if (q.length > 3) q.shift();
        return;
      }
      this._showCaption(text, kind, ms);
    },

    _showCaption(text, kind, ms) {
      const c = this.caption;
      c.innerHTML = '';
      c.appendChild(el('span', { class: 'cap-' + (kind || 'info'), html: this.logHtml(text) }));
      c.classList.remove('on'); void c.offsetWidth; c.classList.add('on');
      this._capKind = kind || 'info';
      this._capUntil = performance.now() + (ms || 2600);
      clearTimeout(this._captionTimer);
      this._captionTimer = setTimeout(() => c.classList.remove('on'), ms || 2600);
    },

    /** Something else has the middle of the table: a card held up, the turn passing, coins or dice. */
    _slotBusy() {
      return !!(this.spot || this._turnBand || (this.arena && this.arena.querySelector('.luck-reveal:not(.out)')));
    },

    /** The line that waited for the middle of the table, now it is free; one too old to be news is only read out. */
    _flushSay() {
      const q = this._sayQ;
      if (!q || !q.length || this._slotBusy()) return;
      this._sayQ = [];
      const now = performance.now();
      const fresh = q.filter(x => now - x.at < 3000);
      for (const x of q) if (!fresh.includes(x) || x !== fresh[fresh.length - 1]) { if (this.accessSay) this.accessSay(x.text.replace(/<[^>]*>/g, '')); }
      const last = fresh[fresh.length - 1];
      if (last) this._showCaption(last.text, last.kind, last.ms);
    },

    /** A caption never outlives its beat: the next one with something to say takes it down (a 'manual' line stays its time). */
    _captionDone() {
      const c = this.caption;
      if (!c || !c.classList.contains('on')) return;
      if (this._capKind === 'manual' && performance.now() < (this._capUntil || 0)) return;
      clearTimeout(this._captionTimer);
      c.classList.remove('on');
    },

    pushHistory(e) {
      if (!e || !e.kind || e.kind === 'noblock') return;
      e.key = 'h' + (++this._histN || (this._histN = 1));
      if (e.turn == null && this.view) e.turn = this.view.turn;     // (older turns are drawn fainter: renderRail)
      this.history.unshift(e);
      if (this.history.length > 16) this.history.length = 16;
      this.renderRail();
    },

    /** The last few things that happened, down the left edge, newest on top. */
    renderRail() {
      const host = this.rail;
      const turnNow = this.view ? this.view.turn : null;
      const isOld = (h) => h.turn != null && turnNow != null && h.turn < turnNow;
      const sig = this.history.map(h => h.key).join(',');
      if (host._sig === sig) {
        // a new turn: the ones before it fade, without coming in again
        for (const n of host.querySelectorAll('.hist-item')) { const h = this.history.find(x => x.key === n._key); if (h) n.classList.toggle('old', isOld(h)); }
        return;
      }
      host._sig = sig;
      host.innerHTML = '';
      host.appendChild(el('button', { type: 'button', class: 'rail-log', title: 'Game log (L)', 'aria-label': 'Open the game log',
        onclick: () => this.toggleDrawer() }, [el('span', { text: 'Log' })]));
      const ICON = { cast: '✦', ability: '⚙', trigger: '↯', attack: '⚔', block: '⛨', died: '☠',
        left: '⇢', land: '▲', token: '✦', enter: '⬇', countered: '⊘', lost: '⚑' };
      // the last six, quieter than they were: anything from before this turn faded (each says it all when pointed at)
      for (const h of this.history.slice(0, 6)) {
        const url = h.card ? (MTG.scry.imageUrl(h.card, 'art_crop', 0) ||
          ((h.card._isToken || h.card.layout === 'token') ? (Table.helpers.tokenArtUrl(h.card) || '') : '')) : '';
        const mine = h.who === this.meId;
        const item = host.appendChild(el('div', {
          class: 'hist-item k-' + h.kind + (mine ? ' mine' : ' theirs') + (url ? '' : ' no-art') + (isOld(h) ? ' old' : ''),
          title: h.text || '', dataset: h.card ? { preview: h.key } : {},
        }, [
          el('div', { class: 'hi-art', style: url ? { backgroundImage: 'url("' + url.replace(/"/g, '%22') + '")' } : null }),
          el('span', { class: 'hi-icon', text: ICON[h.kind] || '•' }),
        ]));
        item._key = h.key;
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
        if (!d.combat) this.zap(d.source, d.target, beat.lastAt && d.target.kind === 'object' ? beat.lastAt.get(d.target.id) : null);
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

    /**
     * A quick line from a source to whatever it dealt damage to; `at`, where
     * that was, for something that has gone from the table with the blow.
     */
    zap(sourceId, target, at) {
      if (this._motionOff() || !sourceId) return;
      const box = (n) => { if (!n || !n.isConnected) return null; const r = U.rect(n); return r.width ? r : null; };
      // a spell has usually gone by the time its damage is shown: it comes from where it was held up
      const from = box(this.els.get(sourceId)) || box(this.spotHost.querySelector('.spot-card')) || box(this.stackCol.lastElementChild);
      const to = (target ? (target.kind === 'player' ? box(this.orbFor(target.id)) : box(this.els.get(target.id))) : null) || at || null;
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

    /**
     * The turn changing hands is the biggest thing that happens, so it is seen: the board of the player whose turn
     * it now is comes in the way a board you turn to does (renderSeats) — from the side, settling, a band of light
     * across it in their colour — and a banner says whose turn it is. Once, as the turn passes (a beat that plays
     * it, never a re-render, an undo or a replay scrubbed to another turn); nothing waits on it.
     */
    _turnChange(v) {
      this._turnBanner(v);
      this._turnSweep(v);
    },

    _turnBanner(v) {
      const p = v.players.find(x => x.id === v.activePlayer);
      if (!p) return;
      const mine = v.activePlayer === this.meId;
      const b = el('div', { class: 'fx-turn' + (mine ? ' mine' : '') }, [
        el('div', { class: 'ft-line' }),
        el('div', { class: 'ft-who', text: mine ? 'Your turn' : `${possessive(p.name)} turn` }),
        el('div', { class: 'ft-n', text: 'Turn ' + v.turn }),
        el('div', { class: 'ft-line low' }),
      ]);
      // a turn passing quickly (the table catching up) replaces the banner before it
      if (this._turnBand) this._turnBand.remove();
      this._turnBand = b;
      this.fxLayer.appendChild(b);
      /* It is a moment of its own in the beats (_present: TURN_HOLD), and goes when its moment is over
         (_turnBandOff) so that nothing is held up under it; this is only the backstop. */
      setTimeout(() => { b.remove(); if (this._turnBand === b) { this._turnBand = null; this._flushSay(); } }, 2400);
    },

    /** The turn's banner, done: it goes quickly, and the middle of the table is free for what comes next. */
    _turnBandOff() {
      const b = this._turnBand;
      if (!b) return;
      this._turnBand = null;
      b.classList.add('out');
      setTimeout(() => b.remove(), this._motionOff() ? 0 : 220);
      this._flushSay();
    },

    /** The new active player's board, sweeping in: from the side it was turned to from (the right, round the table). */
    _turnSweep(v) {
      const s = this.seats.get(v.activePlayer);
      const node = s && s.root;
      // their nameplate on the strip across the top glows (all a board not in view, or only peeking in, gets)
      const plate = this._plates && this._plates.get(v.activePlayer);
      if (plate && plate.isConnected) {
        plate.classList.remove('turn-now'); void plate.offsetWidth; plate.classList.add('turn-now');
        clearTimeout(plate._turnAnim);
        plate._turnAnim = setTimeout(() => plate.classList.remove('turn-now'), 1300);
      }
      // the board whose turn it was is done coming in, if a short turn has not let it finish
      for (const [id, o] of this.seats) {
        if (id === v.activePlayer || !o._turnAnim) continue;
        clearTimeout(o._turnAnim); o._turnAnim = null;
        o.root.classList.remove('turn-in-r', 'turn-in-l', 'turn-fade');
      }
      if (!node || !node.isConnected || node.classList.contains('peek')) return;
      const still = this._motionOff();
      const fromLeft = node.classList.contains('focus-in-l');
      clearTimeout(s._focusAnim);
      clearTimeout(s._turnAnim);
      node.classList.remove('focus-in-r', 'focus-in-l', 'seat-fade', 'turn-in-r', 'turn-in-l', 'turn-fade');
      void node.offsetWidth;   // start it again, for a turn straight after a turn
      node.classList.add(still ? 'turn-fade' : fromLeft ? 'turn-in-l' : 'turn-in-r');
      s._turnAnim = setTimeout(() => node.classList.remove('turn-in-r', 'turn-in-l', 'turn-fade'), 1000);
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
