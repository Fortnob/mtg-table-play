/* ============================================================
   12f-ui-feel.js - what the table sounds and feels like

   Every beat the table shows comes with the game's events for it (see
   src/06b-events.js and the beats in src/12b-ui-table-fx.js). This turns
   those same events into what you hear and the small physical touches you
   see: a land thudding down, a spell rushing to the stack in its own
   colours, a creature slamming onto the table as hard as it is big, a blow
   landing where it lands.

   One source for all of it. The host and every guest hear the same thing
   for the same event, because they hear it from the same place — the
   moment the table shows it, not the moment the engine did it. The engine
   still says 'sfx' as it goes, but nobody listens any more.

   A beat's sounds are laid out in the order things happened, a few
   hundredths of a second apart, and squeezed into the time the beat is
   held for. Things that happen in a heap (six lands tapped, twelve damage
   from four creatures) are voiced as one sound that knows how many. When
   the table is behind, only the sounds that matter most are kept.

   Everything visual is cheap — a class for a moment, a handful of
   elements in the effects layer — capped in number, lighter on a phone,
   and still (not moving) for anyone who has asked for less motion.
   ============================================================ */
'use strict';
(function (MTG) {
  const { el } = MTG;
  const UI = MTG.ui;
  const Table = UI.Table;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const rnd = (a, b) => a + Math.random() * (b - a);

  const COLORS = ['W', 'U', 'B', 'R', 'G'];
  const BASIC = { Plains: 'W', Island: 'U', Swamp: 'B', Mountain: 'R', Forest: 'G' };
  /* The light each colour gives off. Black glows violet, because a black glow is no glow. */
  const LIGHT = { W: '#fff1c2', U: '#69b4ff', B: '#b08cff', R: '#ff6a3d', G: '#5fd38a', C: '#d6dce8' };

  /** A card's colours, from what it says or else what it costs. */
  function colorsOf(card) {
    if (!card) return [];
    const face = card.card_faces && card.card_faces[0];
    let cs = (card.colors && card.colors.length ? card.colors : (face && face.colors)) || [];
    if (!cs.length) {
      const cost = card.mana_cost || (face && face.mana_cost) || '';
      cs = COLORS.filter(c => cost.indexOf('{' + c) >= 0 || cost.indexOf('/' + c + '}') >= 0);
    }
    return cs.filter(c => COLORS.includes(c));
  }
  /** What colour a land is: its basic types, else what it makes. */
  function landColors(card) {
    if (!card) return ['C'];
    const t = card.type_line || '';
    let cs = Object.keys(BASIC).filter(k => t.indexOf(k) >= 0).map(k => BASIC[k]);
    if (!cs.length && card.produced_mana) cs = card.produced_mana.filter(c => COLORS.includes(c));
    if (!cs.length && card.color_identity) cs = card.color_identity.filter(c => COLORS.includes(c));
    return cs.length ? cs : ['C'];
  }
  const manaValue = (card) => card ? (card.cmc != null ? card.cmc : (card.card_faces && card.card_faces[0] && card.card_faces[0].cmc) || 0) : 0;
  const analyse = (card) => { try { return card ? MTG.oracle.analyze(card, 0) : null; } catch (e) { return null; } };

  const Feel = MTG.feel = {
    trace: [],              // the last beats: which events became which sounds
    _live: 0,               // effect elements on screen just now

    /* ---------------- a beat ---------------- */

    beat(t, prev, next, beat) {
      if (!prev || !next) return;
      const motion = !t._motionOff();
      const info = { casts: [], resolves: [], counters: [], enters: [], deaths: [], hits: [], life: new Map(),
        marks: [], pulses: [], myDamage: 0, turnMine: false };
      const cues = beat.fromEvents ? this._fromEvents(t, prev, next, info, motion) : this._fromDiff(t, prev, next, beat, info);
      this._lastWord(t, prev, next, cues, info);
      const pace = t._pace();
      const played = this._schedule(cues, beat, pace);
      MTG.audio.tension(next.over ? 0 : (next.stack || []).length);
      try { this._visuals(t, prev, next, info, motion); } catch (e) { console.error('[feel]', e); }
      this.trace.push({ from: (next.events && next.events[0] || {}).seq, to: (next.events && next.events.length ? next.events[next.events.length - 1].seq : null),
        events: beat.fromEvents ? next.events.map(e => e.type) : null, sounds: played });
      if (this.trace.length > 80) this.trace.splice(0, 20);
    },

    /**
     * The sounds for a beat that came with its events. Each sound gets a
     * place in time (`at`, milliseconds into the beat), an importance
     * (`pri`) for when not everything can be played, and the event that
     * asked for it (`why`), for anyone checking.
     */
    _fromEvents(t, prev, next, info, motion) {
      const me = t.meId;
      const out = [];
      let clock = 0;
      const add = (name, opt, pri, why, gap, delay) => {
        const c = { name, opt: opt || {}, at: clock + (delay || 0), pri, why };
        out.push(c);
        clock += gap == null ? 70 : gap;
        return c;
      };
      const pan = (pid) => (pid == null ? null : t.panFor(pid));
      const known = (id) => t.objIn(id, next) || t.objIn(id, prev);
      const stackCard = (e) => { const s = (prev.stack || []).concat(next.stack || []).find(x => x.id === e.stackId); return s ? s.card : null; };
      const cardOf = (e) => e.card || (known(e.objId) || {}).card || stackCard(e) || null;
      /* A card that flies to where it lands should be heard landing, not leaving. */
      const FLIGHT = motion ? 230 : 0;
      const evs = next.events;

      // what the beat holds, looked at first so related events are voiced as one
      const attackers = new Set(), fromStack = new Set(), hurtPlayers = new Set();
      for (const e of evs) {
        if (e.type === 'attack') for (const a of e.attackers) attackers.add(a.objId);
        if (e.type === 'enter' && e.from === 'stack') fromStack.add(e.objId);
        if (e.type === 'damage' && e.target && e.target.kind === 'player') hurtPlayers.add(e.target.id);
      }
      const opening = !!(next.mulliganPhase || prev.mulliganPhase);

      // sounds that gather up everything of one kind in the beat
      const heap = new Map();
      const gather = (key, make, more) => {
        const c = heap.get(key);
        if (c) { more(c); return c; }
        const n = make();
        heap.set(key, n);
        return n;
      };

      /* A die or a coin: what came up floats off the player who rolled or
         flipped, a beat after the sound, so it reads as the result. */
      let luckAt = 0;
      const luck = (e, text) => {
        const at = 260 + 380 * luckAt++;
        setTimeout(() => { const orb = t.orbFor && t.orbFor(e.player); if (orb && t.float) t.float(orb, text, 'fx-luck', 0.5); }, at);
      };

      let hitsVoiced = 0;
      for (const e of evs) {
        switch (e.type) {
          case 'turn':
            info.turnMine = e.player === me;
            add(e.player === me ? 'turn_mine' : 'turn_theirs', { pan: e.player === me ? null : pan(e.player) }, 9, 'turn', 180);
            break;
          case 'cast': {
            const card = cardOf(e);
            const colors = colorsOf(card);
            add('cast', { pan: pan(e.controller), colors, intensity: clamp(manaValue(card) / 7, 0.15, 1), copy: !!e.copy }, 7, 'cast', 120);
            info.casts.push({ objId: e.objId, stackId: e.stackId, colors });
            break;
          }
          case 'activate': case 'trigger':
            add(e.type, { pan: pan(e.controller) }, 4, e.type, 60);
            if (e.objId) info.pulses.push(e.objId);
            break;
          case 'resolve': {
            if (e.countered) break;
            const card = cardOf(e);
            if (e.objId) info.pulses.push(e.objId);
            if (e.kind !== 'spell') { add('resolve', { pan: pan(e.controller), ability: true, colors: colorsOf(card) }, 2, 'resolve', 40); break; }
            info.resolves.push({ objId: e.objId, colors: colorsOf(card), entered: fromStack.has(e.objId) });
            // a permanent spell is heard arriving instead
            if (fromStack.has(e.objId)) break;
            add('resolve', { pan: pan(e.controller), colors: colorsOf(card) }, 6, 'resolve', 90);
            break;
          }
          case 'counter':
            add('counter', { pan: pan(e.controller) }, 8, 'counter', 150);
            info.counters.push({ objId: e.objId, stackId: e.stackId });
            break;
          case 'enter': {
            const o = t.objIn(e.objId, next);
            const card = e.card || (o && o.card);
            const a = analyse(card);
            const flew = e.from && e.from !== 'battlefield' && e.from !== 'command';
            const delay = flew ? FLIGHT : 0;
            const p = pan(e.controller);
            if (a && a.isLand && !a.isCreature) {
              add('land', { pan: p, colors: landColors(card) }, 6, 'enter', 90, delay);
              info.enters.push({ objId: e.objId, kind: 'land', delay });
            } else if ((o && o.power != null) || (a && a.isCreature)) {
              const w = clamp(((o && o.power) || 0) / 8, 0, 1);
              add('enter', { pan: p, colors: colorsOf(card), intensity: w }, 6, 'enter', 90, delay);
              info.enters.push({ objId: e.objId, kind: 'creature', weight: w, delay });
            } else {
              add('settle', { pan: p, colors: colorsOf(card) }, 5, 'enter', 80, delay);
              info.enters.push({ objId: e.objId, kind: 'other', delay });
            }
            break;
          }
          case 'token':
            gather('token:' + e.controller, () => add('token', { pan: pan(e.controller), count: 1 }, 5, 'token', 80), c => { c.opt.count++; });
            info.enters.push({ objId: e.objId, kind: 'token', delay: 0 });
            break;
          case 'leave': {
            const p = pan(e.controller);
            if (e.died) {
              const o = t.objIn(e.objId, prev);
              const w = clamp(((o && o.power) || 0) / 8, 0, 1);
              gather('die', () => add('die', { pan: p, intensity: w, count: 1 }, 8, 'leave', 110), c => {
                c.opt.count++;
                c.opt.intensity = Math.max(c.opt.intensity, w);
                // three at once is a board wipe, and sounds like one
                if (c.opt.count >= 3) { c.name = 'wipe'; c.pri = 8; c.opt.pan = null; }
              });
              info.deaths.push(e.objId);
            } else if (e.to === 'exile') gather('exile', () => add('exile', { pan: p }, 6, 'leave', 90), () => {});
            else if (e.to === 'hand' || e.to === 'library') gather('bounce', () => add('bounce', { pan: p }, 5, 'leave', 80), () => {});
            else if (e.to === 'graveyard' && !e.isToken) gather('destroy', () => add('destroy', { pan: p }, 5, 'leave', 90), () => {});
            break;
          }
          case 'zone': {
            const p = pan(e.owner);
            if (e.from === 'hand' && e.to === 'graveyard') gather('discard', () => add('discard', { pan: p }, 4, 'zone', 70), () => {});
            else if (e.from === 'library' && e.to === 'graveyard') gather('mill', () => add('mill', { pan: p, count: 1 }, 3, 'zone', 70), c => { c.opt.count++; });
            else if (e.from === 'library' && e.to === 'exile') gather('exile', () => add('exile', { pan: p }, 4, 'zone', 70), () => {});
            else if (e.from === 'graveyard' && e.to === 'hand') gather('bounce', () => add('bounce', { pan: p }, 4, 'zone', 70), () => {});
            break;
          }
          case 'damage': {
            const tg = e.target || {};
            const p = tg.kind === 'player' ? pan(tg.id) : pan((known(tg.id) || {}).controller);
            const mine = tg.kind === 'player' && tg.id === me;
            if (mine) info.myDamage += e.amount;
            info.hits.push({ source: e.source, target: tg, amount: e.amount, combat: !!e.combat });
            if (e.combat) {
              // each blow is its own sound, up to four; any more are added to the last
              if (hitsVoiced < 4) {
                hitsVoiced++;
                const c = add('hit', { pan: p, intensity: clamp(e.amount / 8, 0, 1), me: mine, amount: e.amount }, 7, 'damage', 85);
                heap.set('hit', c);
              } else {
                const c = heap.get('hit');
                c.opt.amount += e.amount;
                c.opt.intensity = clamp(c.opt.amount / 8, 0, 1);
              }
            } else {
              gather('burn:' + (tg.kind || '') + tg.id, () => add('burn', { pan: p, intensity: clamp(e.amount / 8, 0, 1), amount: e.amount }, 6, 'damage', 90),
                c => { c.opt.amount += e.amount; c.opt.intensity = clamp(c.opt.amount / 8, 0, 1); });
            }
            break;
          }
          case 'life': {
            const was = info.life.get(e.player);
            info.life.set(e.player, { delta: (was ? was.delta : 0) + e.delta, life: e.life });
            break;
          }
          case 'counters': {
            if (e.player) {
              if (e.kind === 'poison' && e.delta > 0) gather('poison', () => add('poison', { pan: pan(e.player) }, 6, 'counters', 90), () => {});
              break;
            }
            const owner = (known(e.objId) || {}).controller;
            gather(e.delta > 0 ? 'cadd' : 'crem', () => add(e.delta > 0 ? 'counter_add' : 'counter_remove', { pan: pan(owner) }, 3, 'counters', 60), () => {});
            info.marks.push({ objId: e.objId, delta: e.delta });
            break;
          }
          case 'tap': {
            if (attackers.has(e.objId)) break;
            const o = known(e.objId);
            const a = o ? t.analysis(o) : null;
            if (a && a.isLand) {
              gather('mana:' + e.controller, () => add('mana', { pan: pan(e.controller), count: 1, colors: landColors(o.card).slice(0, 1) }, 3, 'tap', 60),
                c => { c.opt.count++; c.opt.colors.push(landColors(o.card)[0]); });
            } else gather('tap:' + e.controller, () => add('tap', { pan: pan(e.controller) }, 2, 'tap', 50), () => {});
            break;
          }
          case 'untap':
            gather('untap:' + e.controller, () => add('untap', { pan: pan(e.controller), count: 1 }, 2, 'untap', 60), c => {
              c.opt.count++;
              if (c.opt.count >= 3) c.name = 'untap_all';
            });
            break;
          case 'attack':
            add('attack', { pan: pan(e.player), intensity: clamp(e.attackers.length / 5, 0, 1) }, 8, 'attack', 200);
            break;
          case 'block':
            add('block', { pan: pan(e.player) }, 7, 'block', 140);
            break;
          case 'draw': {
            const p = e.player === me ? null : pan(e.player);
            if (opening || e.count >= 4) gather('deal:' + e.player, () => add('deal', { pan: p, count: e.count }, 4, 'draw', 120), () => {});
            else if (e.player === me) for (let i = 0; i < Math.min(3, e.count || 1); i++) add('draw', {}, 4, 'draw', 75);
            else gather('draw:' + e.player, () => add('draw', { pan: p, quiet: true }, 2, 'draw', 60), () => {});
            break;
          }
          case 'shuffle':
            gather('shuffle', () => add('shuffle', { pan: e.player === me ? null : pan(e.player) }, 3, 'shuffle', 120), () => {});
            break;
          case 'lose':
            // somebody out while the game goes on; the last one out is said by the end of the game
            if (e.player !== me && !evs.some(x => x.type === 'gameOver')) add('eliminated', { pan: pan(e.player) }, 8, 'lose', 200);
            break;
          case 'gameOver': {
            const won = (e.winners || []).includes(me);
            const seated = !!t.me && !(next.spectating);
            add(won || !seated ? 'win' : 'lose', {}, 10, 'gameOver', 0, 120);
            break;
          }
          case 'roll': add('dice', { pan: pan(e.player) }, 5, 'roll', 120); luck(e, `\u{1F3B2} d${e.sides}: ${e.result}`); break;
          case 'coin': add('coin', { pan: pan(e.player) }, 5, 'coin', 120); luck(e, `\u{1FA99} ${e.result === 'heads' ? 'Heads' : 'Tails'}`); break;
          case 'control': add('steal', { pan: pan(e.to) }, 6, 'control', 100); break;
          case 'cue': add(e.name, { pan: pan(e.player) }, 5, 'cue', 90); break;
          default: break;
        }
      }
      /* Life that changed without anything hitting anybody: drained,
         paid, gained. A blow already says what it did to a life total. */
      for (const [pid, l] of info.life) {
        if (!l.delta || hurtPlayers.has(pid)) continue;
        const k = clamp(Math.abs(l.delta) / 10, 0, 1);
        if (l.delta > 0) add('life_gain', { pan: pan(pid), intensity: k }, 6, 'life', 90);
        else {
          add('life_loss', { pan: pan(pid), intensity: k }, 6, 'life', 90);
          if (pid === me) info.myDamage += -l.delta;
        }
      }
      return out;
    },

    /**
     * The sounds for a beat worked out by comparing two views, when the
     * events for it are not to be had (the first view, after an undo, or
     * after a gap in a guest's stream).
     */
    _fromDiff(t, prev, next, beat, info) {
      const me = t.meId;
      const out = [];
      let clock = 0;
      const add = (name, opt, pri, why) => { out.push({ name, opt: opt || {}, at: clock, pri, why }); clock += 80; };
      const pan = (pid) => (pid == null ? null : t.panFor(pid));
      if ((next.events || []).some(e => e.type === 'restore')) add('undo', {}, 6, 'restore');
      if (beat.turn) { info.turnMine = next.activePlayer === me; add(info.turnMine ? 'turn_mine' : 'turn_theirs', {}, 9, 'turn'); }
      const SOUND = { cast: 'cast', ability: 'activate', trigger: 'trigger', attack: 'attack', block: 'block', died: 'die',
        land: 'land', token: 'token', countered: 'counter', left: 'exile', enter: 'enter', lost: 'eliminated' };
      for (const e of beat.events) {
        const name = SOUND[e.kind];
        if (!name || (e.kind === 'lost' && e.who === me)) continue;
        const colors = e.kind === 'land' ? landColors(e.card) : colorsOf(e.card);
        add(name, { pan: pan(e.who), colors }, 6, 'diff:' + e.kind);
      }
      for (const p of next.players) {
        const q = prev.players.find(x => x.id === p.id);
        if (!q || q.life === p.life) continue;
        const d = p.life - q.life;
        info.life.set(p.id, { delta: d, life: p.life });
        add(d > 0 ? 'life_gain' : 'life_loss', { pan: pan(p.id), intensity: clamp(Math.abs(d) / 10, 0, 1) }, 6, 'diff:life');
        if (d < 0 && p.id === me) info.myDamage += -d;
      }
      const mine = next.players.find(p => p.id === me), was = prev.players.find(p => p.id === me);
      if (mine && was && mine.handSize > was.handSize && next.turn === prev.turn) add('draw', {}, 4, 'diff:hand');
      if (!prev.over && next.over) add((next.winners || []).includes(me) || !t.me ? 'win' : 'lose', {}, 10, 'diff:over');
      return out;
    },

    /** The last thing a beat says: that it is your move now, or that you are being asked something. */
    _lastWord(t, prev, next, cues, info) {
      const me = t.meId;
      if (next.over || next.mulliganPhase || !t.me) return;
      const end = cues.reduce((m, c) => Math.max(m, c.at), 0) + (cues.length ? 110 : 0);
      const ch = next.pendingChoice;
      const asked = ch && ch.playerId === me && !ch.waiting;
      // one question leading into the next (a mode, then its target) is one moment
      const wasAsked = !!(prev.pendingChoice && prev.pendingChoice.playerId === me);
      if (asked && !wasAsked) { cues.push({ name: 'choice', opt: {}, at: end, pri: 5, why: 'choice' }); return; }
      /* The ping is for a chance to answer somebody else: their spell
         waiting on the stack, or a stop in their turn. Priority coming back
         after your own spell resolves is not news, and your own turn's
         call already says it is you. */
      if (next.priorityPlayer !== me || prev.priorityPlayer === me || ch || info.turnMine) return;
      const top = (next.stack || [])[(next.stack || []).length - 1];
      if (top ? top.controller !== me : next.activePlayer !== me) {
        cues.push({ name: 'priority', opt: {}, at: end, pri: 3, why: 'priority' });
      }
    },

    /** Play a beat's sounds, in order, inside the time the beat is shown for. */
    _schedule(cues, beat, pace) {
      if (!cues.length) return [];
      let list = cues.map((c, i) => Object.assign(c, { i }));
      // when the table is behind, only what matters most
      const max = pace < 0.15 ? 2 : pace < 0.5 ? 3 : 7;
      if (list.length > max) {
        // the most important first, and one of each kind before a second of any
        const seen = new Set();
        const rank = list.slice().sort((a, b) => b.pri - a.pri || a.i - b.i);
        const firsts = rank.filter(c => !seen.has(c.name) && seen.add(c.name));
        list = firsts.concat(rank.filter(c => !firsts.includes(c))).slice(0, max).sort((a, b) => a.i - b.i);
      }
      const shown = (beat.hold || 0) * pace;
      const budget = pace >= 0.5 ? clamp(shown * 0.9, 260, 700) : clamp(shown * 0.9, 0, 300);
      // a beat starts at nought; a first sound held back for a card's flight keeps its wait
      const span = Math.max(...list.map(c => c.at));
      const k = span > budget ? budget / span : 1;
      /* Beats played back quickly, one after another, would pile their
         sounds on top of each other: when the last moment has been busy,
         only the bigger things are heard. */
      const now = performance.now();
      const recent = this._recent = (this._recent || []).filter(x => x > now - 400);
      const played = [];
      for (const c of list) {
        const at = Math.round(c.at * k);
        const when = now + at;
        const busy = recent.filter(x => x > when - 300).length;
        if ((busy >= 9 && c.pri < 8) || (busy >= 5 && c.pri < 6)) continue;
        recent.push(when);
        MTG.sfx(c.name, Object.assign({}, c.opt, { at: at / 1000, why: c.why }));
        played.push({ name: c.name, at, why: c.why });
      }
      return played;
    },

    /* ---------------- what you see ---------------- */

    _cap() { return MTG.isPhone() ? 24 : 70; },

    /** One element in the effects layer for a moment, if there is room for it. */
    _spawn(t, cls, style, ms) {
      if (this._live >= this._cap()) return null;
      const n = el('div', { class: cls });
      // custom properties have to be set one by one; the rest can be assigned
      for (const k in style) {
        if (k.startsWith('--')) n.style.setProperty(k, style[k]);
        else n.style[k] = style[k];
      }
      t.fxLayer.appendChild(n);
      this._live++;
      this._after(ms, () => { n.remove(); this._live--; });
      return n;
    },

    /** A class on an element for as long as its effect lasts, started over if it is already running. */
    _mark(n, cls, ms, vars) {
      if (!n || !n.isConnected) return;
      if (vars) for (const k in vars) n.style.setProperty(k, vars[k]);
      // starting it again only costs a reflow when it is already running
      if (n.classList.contains(cls)) { n.classList.remove(cls); void n.offsetWidth; }
      n.classList.add(cls);
      clearTimeout(n['_feel_' + cls]);
      n['_feel_' + cls] = this._after(ms, () => {
        n.classList.remove(cls);
        if (vars) for (const k in vars) n.style.removeProperty(k);
      });
    },

    /** Tidy up after an effect, unless the table is being held still to be looked at. */
    _after(ms, fn) {
      return setTimeout(() => { if (this._frozen) this._frozen.push(fn); else fn(); }, ms);
    },

    /**
     * Hold every effect where it is, for a screenshot or a closer look:
     * animations pause and nothing is tidied away until it is let go.
     * MTG.feel.freeze(true) ... MTG.feel.freeze(false).
     */
    freeze(on) {
      if (on) {
        this._frozen = this._frozen || [];
        this._paused = document.getAnimations().filter(a => a.playState === 'running');
        for (const a of this._paused) a.pause();
        return;
      }
      const later = this._frozen || [];
      this._frozen = null;
      for (const a of this._paused || []) { try { a.play(); } catch (e) { /* gone */ } }
      this._paused = null;
      for (const fn of later) fn();
    },

    _at(t, r) {
      const ar = MTG.util.rect(t.arena);
      return { x: r.left - ar.left + r.width / 2, y: r.top - ar.top + r.height / 2, w: r.width, h: r.height };
    },

    _visuals(t, prev, next, info, motion) {
      const me = t.meId;
      const phone = MTG.isPhone();
      const card = (id) => { const n = t.els.get(id); return n && n.isConnected ? n : null; };
      const ghost = (id, dying) => t.fxLayer.querySelector(`.cv-ghost${dying ? '.dying' : ''}[data-id="${CSS.escape(String(id))}"]`);
      const glow = (cs) => ({ '--feel-c1': LIGHT[cs[0] || 'C'], '--feel-c2': LIGHT[cs[1] || cs[0] || 'C'] });

      /* Everything is measured first and changed after, so the page is laid
         out once for all of it rather than once per effect. */
      const writes = [];
      const mark = (...a) => writes.push(() => this._mark(...a));
      const spawn = (...a) => writes.push(() => this._spawn(...a));

      // whatever spoke lights up for a moment, so you can see which card it was
      for (const id of new Set(info.pulses)) writes.push(() => t.pulse(id));

      // a spell on its way to the stack, glowing in its own colours
      for (const c of info.casts) {
        const n = card(c.objId) || t.arena.querySelector(`.ability-chip[data-stack="${CSS.escape(String(c.stackId))}"]`);
        if (n) mark(n, motion ? 'feel-cast' : 'feel-cast-still', 1100, glow(c.colors));
      }
      // and a burst where it resolved
      if (motion) for (const r of info.resolves.slice(0, 3)) {
        const n = card(r.objId) || ghost(r.objId);
        const box = n ? MTG.util.rect(n) : MTG.util.rect((t.stackCol.firstElementChild || t.stackCol));
        if (!box.width) continue;
        const p = this._at(t, box);
        spawn(t, 'feel-burst', { left: p.x + 'px', top: p.y + 'px', '--feel-s': Math.round(Math.max(p.w, 60) * 1.6) + 'px',
          '--feel-c1': LIGHT[r.colors[0] || 'C'], '--feel-c2': LIGHT[r.colors[1] || r.colors[0] || 'C'] }, 700);
      }
      // a countered spell goes grey, shrinks, and smokes
      for (const c of info.counters) {
        const n = card(c.objId) || t.arena.querySelector(`.stack-item .ability-chip[data-stack="${CSS.escape(String(c.stackId))}"]`) || ghost(c.objId);
        if (!n) continue;
        mark(n, 'feel-fizzle', 900);
        if (!motion) continue;
        const p = this._at(t, MTG.util.rect(n));
        for (let i = 0; i < (phone ? 3 : 6); i++) {
          spawn(t, 'feel-smoke', { left: (p.x + rnd(-0.3, 0.3) * p.w) + 'px', top: (p.y + rnd(-0.2, 0.3) * p.h) + 'px',
            '--feel-dx': rnd(-20, 20) + 'px', '--feel-dy': rnd(-70, -30) + 'px', animationDelay: Math.round(rnd(0, 160)) + 'ms' }, 1100);
        }
      }

      // arrivals: a land settles, a creature slams down, a token pops
      for (const e of info.enters) {
        const n = card(e.objId);
        if (!n) continue;
        const cls = e.kind === 'land' ? 'feel-settle' : e.kind === 'creature' ? 'feel-slam' : e.kind === 'token' ? 'feel-pop' : 'feel-settle';
        if (!motion) { mark(n, 'feel-arrive-still', 600); continue; }
        mark(n, cls, 1100 + (e.delay || 0), { '--feel-delay': (e.delay || 0) + 'ms', '--feel-w': String(e.weight || 0) });
      }

      // deaths come apart: a few shards off the card as it falls
      if (motion) {
        const shards = phone ? 5 : 11;
        for (const id of info.deaths.slice(0, phone ? 1 : 3)) {
          const g = ghost(id, true);
          if (!g) continue;
          const p = this._at(t, MTG.util.rect(g));
          const o = t.objIn(id, prev);
          const cs = colorsOf(o && o.card);
          for (let i = 0; i < shards; i++) {
            const a = rnd(0, Math.PI * 2), d = rnd(30, 90);
            spawn(t, 'feel-shard', {
              left: (p.x + rnd(-0.4, 0.4) * p.w) + 'px', top: (p.y + rnd(-0.4, 0.4) * p.h) + 'px',
              '--feel-dx': Math.round(Math.cos(a) * d) + 'px', '--feel-dy': Math.round(Math.sin(a) * d * 0.6 + 50) + 'px',
              '--feel-r': Math.round(rnd(-200, 200)) + 'deg', '--feel-c1': LIGHT[cs[i % Math.max(1, cs.length)] || 'R'],
              animationDelay: Math.round(160 + rnd(0, 140)) + 'ms',
            }, 1300);
          }
        }
      }

      // blows: the card that took one shakes as hard as it was hit, and sparks where it landed
      let sparks = 0;
      for (const h of info.hits) {
        const tg = h.target.kind === 'player' ? t.orbFor(h.target.id) : card(h.target.id);
        if (!tg) continue;
        const amp = clamp(1.5 + h.amount * 1.1, 2, 10);
        if (h.target.kind !== 'player') mark(tg, motion ? 'feel-shake' : 'feel-hit-still', 520, { '--feel-amp': amp.toFixed(1) + 'px' });
        if (!motion || sparks >= (phone ? 2 : 5)) continue;
        sparks++;
        const tb = MTG.util.rect(tg);
        const src = h.source && card(h.source);
        const p = this._at(t, tb);
        let x = p.x, y = p.y;
        if (src) {
          const s = this._at(t, MTG.util.rect(src));
          const dx = s.x - p.x, dy = s.y - p.y, len = Math.hypot(dx, dy) || 1;
          const reach = Math.min(p.w, p.h) * 0.45;
          x += dx / len * reach; y += dy / len * reach;
        }
        spawn(t, 'feel-spark' + (h.combat ? '' : ' burn'), { left: x + 'px', top: y + 'px',
          '--feel-s': Math.round(clamp(26 + h.amount * 9, 30, 110)) + 'px', '--feel-r': Math.round(rnd(0, 90)) + 'deg' }, 600);
      }
      // and when it is you being hurt, the edges of the table go red for a moment
      if (info.myDamage > 0) {
        const a = clamp(0.28 + info.myDamage * 0.07, 0.28, 0.85);
        spawn(t, 'feel-vignette' + (motion ? '' : ' still'), { '--feel-a': a.toFixed(2) }, motion ? 900 : 500);
      }

      // counters going on or off: a small tick on the card
      for (const m of info.marks.slice(0, 6)) {
        const n = card(m.objId);
        if (n) mark(n, m.delta > 0 ? 'feel-plus' : 'feel-minus', 700);
      }

      // life totals count their way to the new number
      for (const [pid, l] of info.life) {
        if (!l.delta) continue;
        writes.push(() => this._countLife(t, pid, l.life - l.delta, l.life, motion));
      }

      // your turn: a warm light comes up on your side of the table
      if (info.turnMine && t.myWrap) mark(t.myWrap, motion ? 'feel-turn' : 'feel-turn-still', 1700);

      // and when the table is waiting on you, the big button breathes
      const ch = next.pendingChoice;
      const mine = !next.over && !next.mulliganPhase && !!t.me &&
        ((ch && ch.playerId === me && !ch.waiting) || (!ch && next.priorityPlayer === me));
      const had = t.arena.classList.contains('feel-prio');
      if (mine && !had && motion) {
        const b = t.dock.querySelector('.big-btn');
        const r = b && MTG.util.rect(b);
        if (r && r.width) {
          const p = this._at(t, r);
          spawn(t, 'feel-ripple', { left: p.x + 'px', top: p.y + 'px', width: r.width + 'px', height: r.height + 'px' }, 1000);
        }
      }
      if (mine !== had) writes.push(() => t.arena.classList.toggle('feel-prio', mine));
      for (const w of writes) w();
    },

    /** Count a life total from one number to the next, rather than jumping. */
    _countLife(t, pid, from, to, motion) {
      const orbs = t.arena.querySelectorAll(`.life-orb[data-player="${CSS.escape(String(pid))}"]`);
      const steps = Math.abs(to - from);
      const ms = motion ? Math.min(1100, 260 + steps * 70) : Math.min(500, 120 + steps * 30);
      for (const orb of orbs) {
        const num = orb.querySelector('.orb-life');
        if (!num) continue;
        cancelAnimationFrame(num._feelRaf);
        this._mark(orb, to < from ? 'feel-down' : 'feel-up', ms + 250);
        const t0 = performance.now();
        const tick = (now) => {
          if (!num.isConnected) return;
          const k = clamp((now - t0) / ms, 0, 1);
          const e = 1 - Math.pow(1 - k, 2);
          if (k < 1) {
            const v = String(Math.round(from + (to - from) * e));
            if (num.textContent !== v) num.textContent = v;
            num._feelRaf = requestAnimationFrame(tick);
          } else {
            // the number the table has now, which a later beat may already have moved on
            const p = t.view && t.view.players.find(x => x.id === pid);
            num.textContent = String(p ? p.life : to);
          }
        };
        num.textContent = String(from);
        num._feelRaf = requestAnimationFrame(tick);
      }
    },

    /* ---------------- your hand ---------------- */

    /** Ticks under the fingers as they run along the hand, and a shake for a card dropped where it cannot go. */
    _wireHand(t) {
      const host = t.handHost;
      let last = null, lastAt = 0;
      host.addEventListener('pointerover', (e) => {
        if (e.pointerType === 'touch') return;
        const cv = e.target.closest && e.target.closest('.hslot > .cv');
        if (!cv || cv === last) return;
        last = cv;
        const now = performance.now();
        if (now - lastAt < 45 || host.querySelector('.hslot.dragging')) return;
        lastAt = now;
        const r = MTG.util.rect(cv);
        const x = ((r.left + r.width / 2) / (MTG.util.viewW() || 1)) * 2 - 1;
        MTG.sfx('hover', { pan: x * 0.5, pitch: 0.92 + (x + 1) * 0.08 });
      });
      host.addEventListener('pointerleave', () => { last = null; });
      host.addEventListener('pointerdown', (e) => {
        if (e.button !== 0 || !(e.target.closest && e.target.closest('.hslot .cv'))) return;
        let lifted = false;
        const watch = () => {
          if (lifted || !host.querySelector('.hslot.dragging')) return;
          lifted = true;
          MTG.sfx('pickup');
        };
        const up = (ev) => {
          document.removeEventListener('pointermove', watch, true);
          document.removeEventListener('pointerup', up, true);
          const slot = host.querySelector('.hslot.dragging');
          if (!slot) return;
          const over = MTG.util.pt(ev).y < MTG.util.rect(host).top - 30;
          if (over && !slot.classList.contains('will-play')) {
            const cv = slot.querySelector('.cv');
            MTG.sfx('reject');
            // after the hand has taken the card back
            setTimeout(() => this._mark(cv, t._motionOff() ? 'feel-hit-still' : 'feel-reject', 520), 0);
          } else if (!over) MTG.sfx('draw', { quiet: true });
        };
        document.addEventListener('pointermove', watch, true);
        document.addEventListener('pointerup', up, true);
      }, true);
    },

    /* ---------------- options ---------------- */

    /**
     * The Sound section of the options, and the in-game sound menu: master,
     * interface, game and room volumes, the room on or off, and every sound
     * in the palette to try.
     */
    soundRows(prefix) {
      // the in-game menu can be open over the options page, so its ids are its own
      prefix = prefix || 'opt-';
      const S = MTG.settings;
      const A = MTG.audio;
      const val = (k, d) => (S[k] == null ? d : S[k]);
      const pct = (v) => Math.round(v * 100) + '%';
      const slider = (key, label, help, dflt, set) => {
        const v = val(key, dflt);
        const out = el('span', { class: 'opt-value', text: pct(v) });
        const input = el('input', { type: 'range', min: '0', max: '1', step: '.05', value: String(v), id: prefix + key,
          'aria-label': label, 'aria-valuetext': pct(v) });
        input.addEventListener('input', () => {
          const x = parseFloat(input.value);
          out.textContent = pct(x);
          input.setAttribute('aria-valuetext', pct(x));
          set(x);
        });
        // a sound to judge the new level by, once the slider is let go
        input.addEventListener('change', () => MTG.sfx(key === 'volUi' ? 'confirm' : key === 'volAmb' ? 'priority' : 'land', { colors: ['G'] }));
        return el('div', { class: 'opt-row stacked' }, el('div', { class: 'grow' }, [
          el('div', { class: 'opt-label' }, [el('span', { text: label }), out]), input,
          help ? el('div', { class: 'opt-help', text: help }) : null,
        ].filter(Boolean)));
      };
      const toggle = (id, label, help, on, set) => {
        const input = el('input', { type: 'checkbox', class: 'switch', role: 'switch', checked: on, id });
        input.addEventListener('change', () => set(input.checked));
        return el('label', { class: 'opt-row', for: id }, [
          el('div', { class: 'grow' }, [el('div', { class: 'opt-label', text: label }), help ? el('div', { class: 'opt-help', text: help }) : null].filter(Boolean)),
          input,
        ]);
      };
      const test = el('div', { class: 'feel-test' });
      for (const [title, list] of A.CATALOGUE) {
        test.appendChild(el('div', { class: 'feel-test-row' }, [
          el('span', { class: 'feel-test-head', text: title }),
          el('div', { class: 'sound-chips' }, list.map(([name, opt, label]) => el('button', {
            type: 'button', class: 'chip', text: label || name.replace(/_/g, ' '),
            onclick: () => { A._ensure(); MTG.sfx(name, Object.assign({}, opt)); },
          }))),
        ]));
      }
      const all = el('button', { type: 'button', class: 'btn sm', text: 'Play the whole palette', onclick: () => {
        A._ensure();
        let i = 0;
        const flat = [].concat(...A.CATALOGUE.map(([, l]) => l));
        clearInterval(Feel._tour);
        Feel._tour = setInterval(() => {
          if (i >= flat.length) { clearInterval(Feel._tour); return; }
          const [name, opt] = flat[i++];
          MTG.sfx(name, Object.assign({}, opt));
        }, 650);
      } });
      return [
        slider('volume', 'Master volume', null, 0.5, (x) => A.setVolume(x)),
        toggle(prefix + 'muted', 'Mute everything', null, !!S.muted, (on) => A.setMuted(on)),
        slider('volGame', 'Game', 'Cards, spells, combat and life.', 1, (x) => A.setLevel('volGame', x)),
        slider('volUi', 'Interface', 'Clicks, hovers, and the ping when it is your move.', 0.7, (x) => A.setLevel('volUi', x)),
        toggle(prefix + 'ambience', 'Music', 'A quiet score: warmer and more melodic on the menus, sparser and lower under a game.', val('ambience', true), (on) => A.setAmbience(on)),
        slider('volAmb', 'Music', null, 0.35, (x) => A.setLevel('volAmb', x)),
        el('div', { class: 'opt-row stacked' }, el('div', { class: 'grow' }, [
          el('div', { class: 'opt-label', text: 'Sound test' }),
          el('div', { class: 'opt-help', text: 'Every sound the table makes. Spells and lands take the colour of their mana.' }),
          test, el('div', { class: 'row wrap', style: { marginTop: '8px' } }, [all]),
        ])),
      ];
    },
  };

  /* ---------------- hooks into the table ----------------
     Wrapped rather than written into the table itself: the hand is wired
     when the table is built, the room starts with the first view and goes
     quiet when the table closes. */
  const base = { _build: Table.prototype._build, update: Table.prototype.update, destroy: Table.prototype.destroy };
  Table.prototype._build = function () {
    const r = base._build.apply(this, arguments);
    try { Feel._wireHand(this); } catch (e) { console.error('[feel]', e); }
    return r;
  };
  Table.prototype.update = function (view) {
    if (!this._feelOn) { this._feelOn = true; MTG.audio.ambience(true, 'table'); }
    return base.update.apply(this, arguments);
  };
  Table.prototype.destroy = function () {
    MTG.audio.quiet();
    return base.destroy.apply(this, arguments);
  };

  Feel.colorsOf = colorsOf;
  Feel.landColors = landColors;
})(window.MTG);
