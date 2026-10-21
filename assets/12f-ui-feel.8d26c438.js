/* ===== 12f-ui-feel.js ===== */
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
        marks: [], pulses: [], myDamage: 0, turnMine: false, attacks: [], blocks: [], exiles: [], bounces: [], out: [], luck: [] };
      const cues = beat.fromEvents ? this._fromEvents(t, prev, next, info, motion) : this._fromDiff(t, prev, next, beat, info);
      this._lastWord(t, prev, next, cues, info);
      const pace = t._pace();
      const played = this._schedule(cues, beat, pace);
      MTG.audio.tension(next.over ? 0 : (next.stack || []).length);
      try { this._visuals(t, prev, next, info, motion); } catch (e) { console.error('[feel]', e); }
      // coins flipped and dice rolled: shown in the middle of the table, landing on what they landed on
      if (info.luck.length) try { this._luckReveal(t, info.luck, motion); } catch (e) { console.error('[feel]', e); }
      // an undo takes back whatever coins and dice were still on show
      else if ((next.events || []).some(e => e.type === 'restore')) this.luckClear(t);
      this.trace.push({ from: (next.events && next.events[0] || {}).seq, to: (next.events && next.events.length ? next.events[next.events.length - 1].seq : null),
        events: beat.fromEvents ? next.events.map(e => e.type) : null, sounds: played });
      if (this.trace.length > 80) this.trace.splice(0, 20);
    },

    /**
     * The sound of one spell or ability going on the stack, heard as the
     * table holds it up — for one that was gone again before the table
     * showed the board it left (12b: _spotBeat). Its beat then does not
     * play it a second time.
     */
    cue(t, e) {
      if (!e) return;
      (t._voiced = t._voiced || new WeakSet()).add(e);
      const pan = e.controller == null ? null : t.panFor(e.controller);
      if (e.type === 'cast') {
        const card = e.card || null;
        MTG.sfx('cast', { pan, colors: colorsOf(card), intensity: clamp(manaValue(card) / 7, 0.15, 1), copy: !!e.copy, why: 'cast' });
      } else MTG.sfx(e.type === 'trigger' ? 'trigger' : 'activate', { pan, why: e.type });
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
            // (heard already, as it was held up before its result: cue)
            if (t._voiced && t._voiced.has(e)) { info.casts.push({ objId: e.objId, stackId: e.stackId, colors }); break; }
            add('cast', { pan: pan(e.controller), colors, intensity: clamp(manaValue(card) / 7, 0.15, 1), copy: !!e.copy }, 7, 'cast', 120);
            info.casts.push({ objId: e.objId, stackId: e.stackId, colors });
            break;
          }
          case 'activate': case 'trigger':
            if (!(t._voiced && t._voiced.has(e))) add(e.type, { pan: pan(e.controller) }, 4, e.type, 60);
            if (e.objId) info.pulses.push(e.objId);
            break;
          case 'resolve': {
            if (e.countered) break;
            const card = cardOf(e);
            if (e.objId) info.pulses.push(e.objId);
            if (e.kind !== 'spell') { add('resolve', { pan: pan(e.controller), ability: true, colors: colorsOf(card) }, 2, 'resolve', 40); break; }
            info.resolves.push({ objId: e.objId, colors: colorsOf(card), entered: fromStack.has(e.objId), mv: manaValue(card) });
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
            } else if (e.to === 'exile') { gather('exile', () => add('exile', { pan: p }, 6, 'leave', 90), () => {}); info.exiles.push(e.objId); }
            else if (e.to === 'hand' || e.to === 'library') { gather('bounce', () => add('bounce', { pan: p }, 5, 'leave', 80), () => {}); info.bounces.push(e.objId); }
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
            for (const a of e.attackers) info.attacks.push({ objId: a.objId, defender: a.defender });
            break;
          case 'block':
            add('block', { pan: pan(e.player) }, 7, 'block', 140);
            for (const b of (e.blocks || [])) info.blocks.push({ objId: b.objId, attackers: b.attackers || [] });
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
            info.out.push(e.player);
            break;
          case 'gameOver': {
            const won = (e.winners || []).includes(me);
            const seated = !!t.me && !(next.spectating);
            add(won || !seated ? 'win' : 'lose', {}, 10, 'gameOver', 0, 120);
            break;
          }
          // (a die is heard as the table shows it thrown, in _luckShow, which may be a moment after this beat)
          case 'roll': info.luck.push(e); break;
          case 'coin': add('coin', { pan: pan(e.player) }, 5, 'coin', 120); info.luck.push(e); break;
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

    /**
     * Coins and dice, shown for what they came up, in the middle of the
     * table for everyone at it: a coin for each flip that spins and lands
     * heads (a win) or tails (a loss), and a die for each roll, labelled
     * with its size, that flicks through numbers in its range — quickly at
     * first, then slower — and lands on what the engine rolled. The result
     * was decided before any of this; the table only shows it, and nothing
     * waits for it. The dice of one moment sit side by side on one line
     * (the dice rolled together, one `group`, close up), whoever rolled
     * them; with more than one coin, the wins counted. A die rolled in
     * secret lands, for anybody but its roller, on a question mark. One
     * player's flips of a moment are shown together; another moment's wait
     * their turn. It sits over the table and any question that opens, but
     * takes no clicks: a click anywhere puts it away early. With less
     * motion asked for, the results are simply shown.
     */
    _luckReveal(t, list, motion) {
      const reveals = [];
      for (const e of list) {
        const last = reveals[reveals.length - 1];
        // dice rolled in the same moment share a line, whoever rolled them; coins stay with their flipper
        const allDice = !!last && e.type === 'roll' && last.items.every(x => x.type === 'roll');
        if (last && (last.player === e.player || allDice)) last.items.push(e);
        else reveals.push({ player: e.player, items: [e] });
      }
      // (an undo or a replay's jump in the meantime takes them back: luckClear)
      const gen = this._luckGen || 0;
      for (const g of reveals) {
        const run = () => new Promise((done) => {
          if (gen !== (this._luckGen || 0) || t._destroyed || !t.arena || !t.arena.isConnected) { done(); return; }
          this._luckShow(t, g.items, motion, done);
        });
        // one at a time, in the order they happened
        this._luckQueue = (this._luckQueue || Promise.resolve()).then(run, run);
      }
    },

    /** How long a die flicks through numbers before it lands, in ms (the dice sound is as long). */
    _luckFlip: 1050,

    /** One reveal of _luckReveal: built, shown, and put away again, then `done`. */
    _luckShow(t, items, motion, done) {
      const v = t.view || {};
      const nameOf = (pid) => { const p = (v.players || []).find(x => x.id === pid); return p ? (p.id === t.meId ? 'You' : p.name) : 'A player'; };
      const players = Array.from(new Set(items.map(e => e.player)));
      const one = players.length === 1;
      const mine = one && players[0] === t.meId;
      const name = nameOf(players[0]);
      const coins = items.filter(e => e.type === 'coin'), dice = items.filter(e => e.type === 'roll');
      // a win is the event's to say (heads, as the engine has it); a coin Krark's Thumb set aside counts for nothing
      const wins = (e) => (e.won != null ? !!e.won : e.result === 'heads');
      const counted = coins.filter(e => !e.ignored);
      const won = counted.filter(wins).length;
      // "a d20", "two d6", "a d20 and two d6": each die rolled once (the one Wyll adds is shown, not counted)
      const NUM = ['', 'a', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
      const diceWords = (ds) => {
        const by = new Map();
        for (const e of ds) by.set(e.sides, (by.get(e.sides) || 0) + 1);
        const parts = Array.from(by, ([s, n]) => (NUM[n] || String(n)) + ' d' + s);
        return parts.length > 1 ? parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1] : parts[0] || '';
      };
      const from = one ? (items.find(e => e.sourceName) || {}).sourceName : null;
      const head = (from ? from + ': ' : '') + (one ? [
        counted.length ? `${name} ${mine ? 'flip' : 'flips'} ${counted.length === 1 ? 'a coin' : counted.length + ' coins'}` : '',
        dice.length ? `${counted.length ? ' and ' : name + ' '}${mine ? 'roll' : 'rolls'} ${diceWords(dice)}` : '',
      ].join('') : `${players.map(nameOf).join(' and ')} roll ${diceWords(dice)}`);

      const row = el('div', { class: 'lr-row', 'aria-hidden': 'true' });
      // for a screen reader: what came up, said once everything has landed rather than every number on the way
      const said = el('span', { class: 'sr-only' });
      const box = el('div', { class: 'luck-reveal' + (motion ? '' : ' still'), role: 'status', 'aria-live': 'polite' }, [
        el('div', { class: 'lr-head', text: head }), row, said,
      ]);
      const timers = [];
      const later = (fn, ms) => timers.push(setTimeout(fn, ms));
      const results = [];
      let at = 0, landing = 0, set = null, setKey = null;
      const mayDrop = dice.some(e => (e.rolls || []).length > 1);
      for (const e of items) {
        if (e.type === 'coin') {
          const delay = motion ? at : 0;
          at += 140;
          setKey = null;
          const heads = e.result === 'heads', win = wins(e);
          row.appendChild(el('div', { class: 'lr-coin-wrap' + (e.ignored ? ' ignored' : '') }, [
            el('div', { class: 'lr-coin ' + (heads ? 'heads' : 'tails'), style: { animationDelay: delay + 'ms' } }, [
              el('span', { class: 'lr-face lr-h', html: '<i>\u2600</i>' }), el('span', { class: 'lr-face lr-t', html: '<i>\u263E</i>' }),
            ]),
            el('span', { class: 'lr-say ' + (e.ignored ? '' : win ? 'win' : 'loss'), style: { animationDelay: (delay + 900) + 'ms' },
              text: (heads ? 'Heads' : 'Tails') + ' \u00b7 ' + (e.ignored ? 'ignored' : win ? 'won' : 'lost') }),
          ]));
          results.push(`${heads ? 'heads' : 'tails'}${e.ignored ? ', ignored' : ''}`);
          landing = Math.max(landing, delay + 1000);
          continue;
        }
        // the dice of one roll together, a little apart from the next roll's, each roll its roller's when there are several
        const key = e.group ? e.player + '#' + e.group : 'seq' + e.seq;
        if (key !== setKey) {
          setKey = key;
          if (set) at += 80;
          const line = el('div', { class: 'lr-dice' });
          set = el('div', { class: 'lr-set' }, [one ? null : el('span', { class: 'lr-who', text: nameOf(e.player) }), line].filter(Boolean));
          set._line = line;
          row.appendChild(set);
        }
        // every die rolled (two for an advantage), the ones set aside faded once they land
        const sides = e.sides || 20;
        const rolls = (e.rolls && e.rolls.length ? e.rolls : [e.result]).slice();
        const dropped = (e.ignored || []).slice();
        for (const r of rolls) {
          const delay = motion ? at : 0;
          at += 90;
          const di = r == null ? -1 : dropped.indexOf(r);
          const out = di >= 0 && rolls.length > 1;
          if (out) dropped.splice(di, 1);
          const shown = r == null ? '?' : String(r);
          const face = el('b', { text: motion ? String(1 + Math.floor(Math.random() * sides)) : shown });
          const die = el('div', { class: 'lr-die' + (sides === 6 ? ' d6' : sides === 4 ? ' d4' : ''), 'data-sides': String(sides),
            style: { animationDelay: delay + 'ms' } }, [face]);
          const say = el('span', { class: 'lr-say', text: 'd' + sides });
          // (room kept under every die for "dropped" when any may be, so nothing moves as they land)
          const wrap = el('div', { class: 'lr-die-wrap' }, [die, say, mayDrop ? el('span', { class: 'lr-drop', text: 'dropped' }) : null].filter(Boolean));
          set._line.appendChild(wrap);
          const land = () => {
            face.textContent = shown;
            die.dataset.result = shown;
            die.style.animationDelay = '0ms';
            die.classList.add('landed');
            if (out) wrap.classList.add('ignored');
          };
          if (motion) {
            /* the numbers it flicks through: every face but the one showing, quickly and then slower and slower,
               until it lands on the one the engine rolled */
            /* (by the clock, but a moment the page was too busy to draw in — the next question opening, say — does not
               count, so the numbers are always seen going by) */
            let spent = 0, last = 0, wait = 0;
            const tick = () => {
              const now = performance.now();
              if (last) spent += Math.min(now - last, wait + 50);
              last = now;
              const k = spent / this._luckFlip;
              if (k >= 1) { land(); return; }
              let n = 1 + Math.floor(Math.random() * sides);
              if (sides > 1 && String(n) === face.textContent) n = n % sides + 1;
              face.textContent = String(n);
              // 32ms apart at first, a quarter of a second by the end
              wait = Math.max(16, Math.min((1 - k) * this._luckFlip, 32 + 240 * k * k));
              later(tick, wait);
            };
            later(tick, delay);
            landing = Math.max(landing, delay + this._luckFlip + 250);
          } else land();
          if (!out) results.push(`d${sides}: ${r == null ? 'rolled in secret' : r}`);
        }
      }
      if (counted.length > 1) box.appendChild(el('div', { class: 'lr-tally', style: { animationDelay: (motion ? at + 900 : 0) + 'ms' }, text: `${won} of ${counted.length} won` }));
      /* sized to sit on one line in the middle of the table, whatever the screen: a phone's dice smaller, a handful
         smaller still */
      const n = row.querySelectorAll('.lr-die, .lr-coin').length;
      const sets = row.querySelectorAll('.lr-set').length;
      const room = Math.min(Math.max(240, (t.arena.clientWidth || 360) - 64), 760) - Math.max(0, sets - 1) * 14;
      const size = clamp(Math.floor(room / Math.max(1, n) / 1.25), 26, MTG.isPhone() ? 50 : 64);
      box.style.setProperty('--lr-size', size + 'px');
      box.style.setProperty('--lr-gap', Math.round(size * 0.25) + 'px');
      t.arena.appendChild(box);
      // dice heard as they are thrown: a rattle as long as the flicking, and a knock as each lands (a coin is heard with its beat)
      if (dice.length) MTG.sfx('dice', { count: dice.length, pan: one && players[0] !== t.meId ? t.panFor(players[0]) : null });
      later(() => { said.textContent = `${head}: ${results.join(', ')}.` + (counted.length > 1 ? ` ${won} of ${counted.length} won.` : ''); }, motion ? landing : 0);
      /* It takes no clicks of its own: a question that opens under it (the d20's row: "scry 2") is answered
         straight through it, and a click or tap anywhere puts it away. */
      let gone = false;
      const close = () => {
        if (gone) return;
        gone = true;
        for (const id of timers) clearTimeout(id);
        document.removeEventListener('pointerdown', close, true);
        box.classList.add('out');
        setTimeout(() => { box.remove(); done(); }, motion ? 260 : 0);
      };
      box._close = close;
      document.addEventListener('pointerdown', close, true);
      // a moment to read what came up, then away
      // (held while the table is frozen for a closer look: MTG.feel.freeze)
      this._after(motion ? Math.max(landing, at + 1000) + 1500 : 1800 + 60 * n, close);
    },

    /** Put away every coin and die on show and any still to come: an undo, or a replay jumping, has taken them back. */
    luckClear(t) {
      this._luckGen = (this._luckGen || 0) + 1;
      const root = (t && t.arena) || document;
      for (const b of Array.from(root.querySelectorAll('.luck-reveal'))) { if (b._close) b._close(); else b.remove(); }
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

      /* What something attacking is aimed at: a player's life orb, or a
         planeswalker or battle on the table. */
      const targetOf = (id) => {
        if (id == null) return null;
        if ((next.players || []).some(p => p.id === id)) return t.orbFor(id);
        return card(id);
      };
      // the whole table, for the heaviest moments
      const quake = (amp) => { if (motion && amp > 0) mark(t.arena, 'feel-quake', 520, { '--feel-q': clamp(amp, 1, 9).toFixed(1) + 'px' }); };

      /* Under attack: whatever an attacker is aimed at keeps a red ring and
         the number coming at it, for as long as they are attacking. */
      const aimed = new Map();
      for (const o of (next.battlefield || [])) if (o.attacking) aimed.set(o.attacking, (aimed.get(o.attacking) || 0) + 1);
      writes.push(() => {
        const was = t._feelAimed || new Set();
        const now = new Set();
        for (const [id, n] of aimed) {
          const nodes = (next.players || []).some(p => p.id === id)
            ? [...t.arena.querySelectorAll(`.life-orb[data-player="${CSS.escape(String(id))}"]`)] : [card(id)].filter(Boolean);
          for (const node of nodes) { node.classList.add('under-attack'); node.dataset.attackers = '\u2694 ' + n; now.add(node); }
        }
        for (const node of was) if (!now.has(node)) { node.classList.remove('under-attack'); delete node.dataset.attackers; }
        t._feelAimed = now;
      });

      /* The charge: each attacker lunges at what it is attacking, and what
         it is attacking flinches. */
      // one after another down the line, a rolling charge, not all at once
      let wave = 0;
      for (const a of info.attacks.slice(0, 12)) {
        const n = card(a.objId);
        const tg = targetOf(a.defender);
        if (!n) continue;
        if (motion && tg) {
          const s = this._at(t, MTG.util.rect(n)), d = this._at(t, MTG.util.rect(tg));
          const dx = d.x - s.x, dy = d.y - s.y, len = Math.hypot(dx, dy) || 1, reach = Math.min(46, len * 0.22);
          const lag = 75 * wave++;
          mark(n, 'feel-lunge', 620 + lag, { '--feel-lx': (dx / len * reach).toFixed(1) + 'px', '--feel-ly': (dy / len * reach).toFixed(1) + 'px', '--feel-lag': lag + 'ms' });
        }
        if (tg) mark(tg, motion ? 'feel-threat' : 'feel-threat-still', 900);
      }

      /* A block: the blocker steps out to meet its attacker, the two meet
         with a clang, and the attacker is checked in its stride. */
      const toward = (fromNode, toNode, most, share) => {
        const s = this._at(t, MTG.util.rect(fromNode)), d = this._at(t, MTG.util.rect(toNode));
        const dx = d.x - s.x, dy = d.y - s.y, len = Math.hypot(dx, dy) || 1, reach = Math.min(most, len * share);
        return { '--feel-lx': (dx / len * reach).toFixed(1) + 'px', '--feel-ly': (dy / len * reach).toFixed(1) + 'px', mid: { x: s.x + dx / 2, y: s.y + dy / 2 } };
      };
      for (const b of info.blocks.slice(0, 10)) {
        const n = card(b.objId), foe = card(b.attackers[0]);
        if (!n || !foe || !motion) continue;
        const v = toward(n, foe, 40, 0.3);
        mark(n, 'feel-lunge', 620, { '--feel-lx': v['--feel-lx'], '--feel-ly': v['--feel-ly'], '--feel-lag': '0ms' });
        const back = toward(foe, n, 14, 0.12);
        mark(foe, 'feel-recoil', 520, { '--feel-lx': back['--feel-lx'], '--feel-ly': back['--feel-ly'] });
        spawn(t, 'feel-clang', { left: v.mid.x + 'px', top: v.mid.y + 'px', animationDelay: '260ms' }, 800);
      }

      /* Combat damage: each creature that deals it strikes at what it hits,
         so an attacker and its blocker go at each other at once. */
      if (motion) {
        const struck = new Set();
        for (const h of info.hits) {
          if (!h.combat || !h.source || struck.has(h.source)) continue;
          const n = card(h.source);
          const tg = h.target.kind === 'player' ? t.orbFor(h.target.id) : card(h.target.id);
          if (!n || !tg) continue;
          struck.add(h.source);
          const v = toward(n, tg, 52, 0.35);
          mark(n, 'feel-strike', 460, { '--feel-lx': v['--feel-lx'], '--feel-ly': v['--feel-ly'] });
        }
      }

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
        // the bigger the spell, the bigger the light it lands with
        spawn(t, 'feel-burst', { left: p.x + 'px', top: p.y + 'px', '--feel-s': Math.round(Math.max(p.w, 60) * (1.6 + clamp(r.mv || 0, 0, 10) * 0.12)) + 'px',
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

      /* Deaths come apart: a crack of light, the card breaking into shards
         that fly further the bigger it was, and dust where it stood. A big
         creature falling, or a board being wiped, jolts the table. */
      if (motion) {
        let biggest = 0;
        for (const id of info.deaths.slice(0, phone ? 2 : 4)) {
          const g = ghost(id, true);
          if (!g) continue;
          const p = this._at(t, MTG.util.rect(g));
          const o = t.objIn(id, prev);
          const cs = colorsOf(o && o.card);
          const w = clamp(((o && o.power) || 0) / 8, 0, 1);
          biggest = Math.max(biggest, (o && o.power) || 0);
          spawn(t, 'feel-crack', { left: p.x + 'px', top: p.y + 'px', width: p.w + 'px', height: p.h + 'px' }, 700);
          spawn(t, 'feel-dust', { left: p.x + 'px', top: (p.y + p.h * 0.35) + 'px', '--feel-s': Math.round(p.w * (1.4 + w)) + 'px', animationDelay: '180ms' }, 1100);
          const shards = phone ? 7 : 16;
          for (let i = 0; i < shards; i++) {
            const a = rnd(0, Math.PI * 2), d = rnd(40, 110) * (1 + w * 0.7);
            spawn(t, 'feel-shard', {
              left: (p.x + rnd(-0.4, 0.4) * p.w) + 'px', top: (p.y + rnd(-0.4, 0.4) * p.h) + 'px',
              '--feel-dx': Math.round(Math.cos(a) * d) + 'px', '--feel-dy': Math.round(Math.sin(a) * d * 0.6 + 60) + 'px',
              '--feel-r': Math.round(rnd(-260, 260)) + 'deg', '--feel-c1': LIGHT[cs[i % Math.max(1, cs.length)] || 'R'],
              '--feel-z': rnd(0.9, 1.9).toFixed(2), animationDelay: Math.round(140 + rnd(0, 140)) + 'ms',
            }, 1400);
          }
        }
        if (info.deaths.length >= 3) quake(7);
        else if (biggest >= 5) quake(2 + biggest * 0.5);
      }

      /* Exile: the card is taken up in a column of light, motes rising off
         it. Back to a hand or library: a swirl where it was. */
      for (const id of info.exiles.slice(0, phone ? 2 : 4)) {
        const g = ghost(id);
        const n = g || card(id);
        if (!n || !motion) continue;
        const p = this._at(t, MTG.util.rect(n));
        if (!p.w) continue;
        spawn(t, 'feel-pillar', { left: p.x + 'px', top: p.y + 'px', width: Math.round(p.w * 1.15) + 'px', height: Math.round(p.h * 2.4) + 'px' }, 900);
        for (let i = 0; i < (phone ? 6 : 12); i++) {
          spawn(t, 'feel-mote', { left: (p.x + rnd(-0.45, 0.45) * p.w) + 'px', top: (p.y + rnd(-0.3, 0.4) * p.h) + 'px',
            '--feel-dy': Math.round(-rnd(60, 140)) + 'px', '--feel-dx': Math.round(rnd(-14, 14)) + 'px', animationDelay: Math.round(rnd(0, 260)) + 'ms' }, 1300);
        }
      }
      for (const id of info.bounces.slice(0, 3)) {
        const g = ghost(id);
        if (!g || !motion) continue;
        const p = this._at(t, MTG.util.rect(g));
        if (p.w) spawn(t, 'feel-swirl', { left: p.x + 'px', top: p.y + 'px', '--feel-s': Math.round(p.w * 1.5) + 'px' }, 700);
      }

      // blows: the card that took one shakes as hard as it was hit, and sparks where it landed
      let sparks = 0;
      for (const h of info.hits) {
        const tg = h.target.kind === 'player' ? t.orbFor(h.target.id) : card(h.target.id);
        if (!tg) continue;
        const amp = clamp(1.5 + h.amount * 1.1, 2, 10);
        if (h.target.kind !== 'player') {
          mark(tg, motion ? 'feel-shake' : 'feel-hit-still', 520, { '--feel-amp': amp.toFixed(1) + 'px' });
          if (motion) mark(tg, 'feel-hurt', 520);
        } else {
          // a player hit: the life orb jolts and goes red, and a shockwave rings out from it
          mark(tg, motion ? 'feel-orb-hit' : 'feel-orb-hit-still', 650, { '--feel-amp': clamp(2 + h.amount * 0.9, 3, 12).toFixed(1) + 'px' });
          if (motion) {
            const ob = this._at(t, MTG.util.rect(tg));
            spawn(t, 'feel-shock', { left: ob.x + 'px', top: ob.y + 'px', '--feel-s': Math.round(clamp(80 + h.amount * 16, 90, 260)) + 'px' }, 750);
          }
        }
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
      // and when it is you being hurt, the edges of the table go red for a moment, and a big hit shakes it
      if (info.myDamage >= 3) quake(1 + info.myDamage * 0.7);
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
        // life gained glows green, sparkles rising off the orb
        if (l.delta > 0 && motion) {
          const orb = t.orbFor(pid);
          if (!orb) continue;
          mark(orb, 'feel-heal', 900);
          const ob = this._at(t, MTG.util.rect(orb));
          for (let i = 0; i < Math.min(phone ? 4 : 9, 3 + l.delta); i++) {
            spawn(t, 'feel-mote heal', { left: (ob.x + rnd(-0.4, 0.4) * ob.w) + 'px', top: (ob.y + rnd(-0.1, 0.3) * ob.h) + 'px',
              '--feel-dy': Math.round(-rnd(40, 90)) + 'px', '--feel-dx': Math.round(rnd(-10, 10)) + 'px', animationDelay: Math.round(rnd(0, 300)) + 'ms' }, 1200);
          }
        }
      }
      // a player out: their orb cracks and goes dark
      for (const pid of info.out) {
        const orb = t.orbFor(pid);
        if (orb) mark(orb, 'feel-ko', 1600);
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
      return [
        slider('volume', 'Master volume', null, 0.5, (x) => A.setVolume(x)),
        slider('volGame', 'Game', 'Cards, spells, combat and life.', 1, (x) => A.setLevel('volGame', x)),
        slider('volUi', 'Interface', 'Clicks, hovers, and the ping when it is your move.', 0.7, (x) => A.setLevel('volUi', x)),
        slider('volAmb', 'Music', 'A quiet score: warmer and more melodic on the menus, sparser and lower under a game.', 0.35, (x) => A.setLevel('volAmb', x)),
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
    // the emote button by your portrait
    try { if (UI.mountEmotes && this.arena) UI.mountEmotes(this); } catch (e) { /* no matter */ }
    // quests count what happens, as it happens (src/10e-progress.js)
    try { if (MTG.progress && view) { this._gameKey = this._gameKey || MTG.uid('g'); MTG.progress.seeEvents(view, this.meId, this._gameKey); } } catch (e) { /* never in the way of the game */ }
    return base.update.apply(this, arguments);
  };
  Table.prototype.destroy = function () {
    MTG.audio.quiet();
    // left before the end: what was done still counts for quests
    try { if (MTG.progress && this.view && !this.view.over) MTG.progress.gameLeft(); } catch (e) { /* no matter */ }
    return base.destroy.apply(this, arguments);
  };

  Feel.colorsOf = colorsOf;
  Feel.landColors = landColors;
})(window.MTG);
