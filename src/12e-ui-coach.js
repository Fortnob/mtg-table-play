/* ============================================================
   12e-ui-coach.js - the first-game walkthrough
   A guided first game is an ordinary game against a gentle bot, with a
   few coach marks laid over the real table: a ring round the thing that
   matters and a sentence beside it, at the moment it first matters. There
   is no script and no pretend engine. Each mark waits for its moment in
   the game (your first land, your first attack, their first spell),
   points at whatever is really there, and goes away when you have done
   it, when you say you have got it, or when the moment has passed.

   Mana is paid by hand to begin with. The game does not tap lands for you
   in this game until you have tapped your own and cast two spells with
   the mana; then a mark says it will from now on, and does. That is the
   walkthrough's say for this one game only (the table's tapOverride): the
   Tap lands for me setting is never written, so whatever you chose in
   Options is what every other game uses, and what this one goes back to
   if the walkthrough is skipped.

   It can be skipped at any point, played again from Tutorials or Options,
   and is remembered once it has been seen through.
   ============================================================ */
'use strict';
(function (MTG) {
  const { el, util: U } = MTG;
  const UI = MTG.ui;

  const touch = () => MTG.isTouch();
  // what a finger does to a card, and what a mouse does
  const press = () => (touch() ? 'Tap' : 'Click');

  /* The marks, in the order a first game usually meets them. `when` says
     whether this is its moment; `at` finds what to point at; `done` says
     the player has got it (so it can go without a click). Each is given
     the table, the view and the coach. `byHand` marks belong to the part
     of the first game where lands are tapped by hand; `wide` ones point at
     things a phone's table leaves out. */
  const MARKS = [
    {
      id: 'hand', title: 'Your opening hand',
      text: () => 'Seven cards to start. A good hand has two to five lands; this deck was built for you, so keep it and see.',
      when: (t, v) => v.mulliganPhase && t.me && !t.me.keptHand,
      at: (t) => Array.from(t.decision.querySelectorAll('button')).find(b => /^Keep/.test(b.textContent)) || null,
      done: (t, v) => !v.mulliganPhase || (t.me && t.me.keptHand),
    },
    {
      id: 'land', title: 'Play a land',
      text: () => (touch() ? 'Tap a land in your hand to put it on the table.' : 'Click a land in your hand, or drag it onto the table, to play it.') +
        ' Lands make the mana that pays for everything else. You may play one each turn.',
      when: (t, v) => myMain(t, v) && !!handCard(t, v, a => a.isLand),
      at: (t, v) => handCard(t, v, a => a.isLand),
      done: (t) => t.me && t.me.landsPlayed > 0,
    },
    {
      id: 'tap', title: 'Tap a land for mana', byHand: true,
      text: (t) => {
        const o = payLand(t);
        const name = o && o.card ? o.card.name : 'land';
        const makes = o && o.card && BASIC_MANA[o.card.name] ? BASIC_MANA[o.card.name] : 'its mana';
        return `Spells cost mana, and lands make it. ${press()} your ${name} to tap it for ${makes}. ` +
          'It turns sideways: tapped means used, and it stays that way until your next turn.';
      },
      when: (t, v, c) => c.byHand && !t.autoTap() && myMain(t, v) && poolTotal(t) === 0 && !!payLand(t) &&
        (!!t.paying || !!handCard(t, v, a => !a.isLand)),
      at: (t) => { const o = payLand(t); return o ? t.els.get(o.id) || null : null; },
      done: (t) => poolTotal(t) > 0,
    },
    {
      id: 'pool', title: 'Your mana pool', byHand: true,
      text: () => 'The mana you make waits here, in your mana pool, until you spend it. It drains away when this step of the turn ends, so spend it now.',
      when: (t, v, c) => c.byHand && !t.autoTap() && myPriority(t, v) && poolTotal(t) > 0 && !t.paying,
      at: (t) => onScreen(t.meHud.querySelector('.flag.pool')),
      done: (t) => poolTotal(t) === 0,
    },
    {
      id: 'cast', title: 'Cast a creature',
      text: (t) => (t.autoTap()
        ? `Glowing cards can be played now. ${press()} this creature to cast it; the game taps your lands to pay its cost, in its top right corner.`
        : `${press()} this creature to cast it. Its cost, in its top right corner, is paid from your mana pool.`),
      when: (t, v) => myMain(t, v) && !t.paying && !!castableCreature(t, v),
      at: (t, v) => castableCreature(t, v),
      done: (t, v) => v.battlefield.some(o => o.controller === t.meId && o.power != null),
    },
    {
      id: 'sick', title: 'Summoning sickness',
      text: () => 'A creature can’t attack on the turn it arrives, nor use an ability with {T}, the tap symbol, in its cost. It is ready from your next turn.',
      // (with nothing left to play the game moves on by itself, so this need not wait for your priority)
      when: (t, v) => !v.pendingChoice && !!sickOne(t, v),
      at: (t, v) => { const o = sickOne(t, v); return o ? t.els.get(o.id) || null : null; },
      done: (t, v) => !sickOne(t, v),
    },
    {
      id: 'button', title: 'The big button',
      text: () => 'It always says what pressing it does next: To combat, End turn, Resolve, Pass. ' +
        (touch() ? '' : 'Space presses it too. ') + 'When you have nothing more to play, press it to move on.',
      // once this turn's land is down; with nothing at all to play, the game moves on without you
      when: (t, v) => myMain(t, v) && !t.paying && !!(t.me && t.me.landsPlayed > 0),
      at: (t) => t.dock && t.dock._main,
      // pressing it is the lesson: the main phase going by means it was pressed
      done: (t, v) => !myMain(t, v),
    },
    {
      id: 'untap', title: 'Your turn again',
      text: () => 'Each turn starts with the untap step: everything of yours that was tapped turns straight again, ready to use. Then you draw a card.',
      when: (t, v, c) => v.activePlayer === t.meId && myPriority(t, v) && c.myTurns.size >= 2 && !!myLand(t, v),
      at: (t, v) => { const o = myLand(t, v); return o ? t.els.get(o.id) || null : null; },
    },
    {
      id: 'attack', title: 'Attack',
      text: () => `${press()} your creatures to choose attackers, then press Attack. Attacking taps them, unless they have vigilance. ` +
        'Each one nobody blocks deals its damage to the other player.',
      when: (t, v) => mine(t, v, 'declareAttackers') && ((v.pendingChoice.candidates || []).length > 0),
      at: (t, v) => t.els.get((v.pendingChoice.candidates || [])[0]) || (t.dock && t.dock._main),
      done: (t, v) => !mine(t, v, 'declareAttackers'),
    },
    {
      id: 'block', title: 'Block',
      text: () => `They are attacking. ${press()} one of your creatures, then the attacker it should block; when only one attacks, your creature is enough. ` +
        'Blocking doesn’t tap it. Or press No blocks and take the damage.',
      when: (t, v) => mine(t, v, 'declareBlockers') && ((v.pendingChoice.candidates || []).length > 0),
      at: (t, v) => t.els.get((v.pendingChoice.candidates || [])[0]) || (t.dock && t.dock._main),
      done: (t, v) => !mine(t, v, 'declareBlockers'),
    },
    {
      id: 'fight', title: 'A fight',
      text: () => 'A blocker and its attacker deal damage to each other equal to their power, the first number. ' +
        'Damage at least equal to a creature’s toughness, the second number, destroys it; less wears off at the end of the turn.',
      when: (t, v) => !v.pendingChoice && !!blocker(v),
      at: (t, v) => { const o = blocker(v); return o ? t.els.get(o.id) || null : null; },
    },
    {
      id: 'life', title: 'Life',
      text: (t, v, c) => `Damage to a player comes off their life, shown on their portrait. Everyone starts at ${c.startLife}; a player at 0 loses the game.`,
      when: (t, v, c) => !v.pendingChoice && !!hurt(t, v, c),
      at: (t, v, c) => hurt(t, v, c),
    },
    {
      id: 'stack', title: 'The stack',
      text: () => 'Their spell waits here on the stack before it happens, so you get a chance to answer it with an instant. ' +
        'If you have nothing to cast, press Resolve and it happens.',
      when: (t, v) => (v.stack || []).some(s => s.controller !== t.meId) && v.priorityPlayer === t.meId && !v.pendingChoice,
      at: (t) => t.stackCol && t.stackCol.classList.contains('on') ? t.stackCol : null,
      done: (t, v) => !(v.stack || []).length,
    },
    {
      id: 'read', title: 'Reading a card',
      text: () => touch()
        ? 'Tap one of their cards, or press and hold any card, to see it full size with its rulings.'
        : 'Point at any card to see it larger, with what is true of it right now. Click one of theirs, or right-click one in your hand, to open it in full, rulings and all; right-click one of yours on the table for everything you can do with it.',
      when: (t, v) => v.battlefield.some(o => o.controller !== t.meId && o.card),
      at: (t, v) => {
        const o = v.battlefield.find(x => x.controller !== t.meId && x.power != null) || v.battlefield.find(x => x.controller !== t.meId);
        return o ? t.els.get(o.id) : null;
      },
    },
    {
      id: 'auto', title: 'Tapping for you', byHand: true, times: 9,
      text: () => 'That is how mana works: tap lands, then spend what they make. From now on in this game, the game taps your lands for you: just choose a glowing card. ' +
        (MTG.settings.autoTapLands !== false
          ? 'Tap lands for me, in Options under Gameplay, turns this off if you would rather do it yourself.'
          : 'Your own setting, Tap lands for me in Options, is off, so your next games go back to tapping by hand.'),
      // its moment holds while it is up: showing it is what turns tapping for you on
      when: (t, v, c) => c.byHand && (c.isUp('auto') || (!t.autoTap() && c.casts.size >= 2)) &&
        myPriority(t, v) && !(v.stack || []).length && !t.paying,
      at: (t, v) => { const o = myLand(t, v); return (o && t.els.get(o.id)) || (t.dock && t.dock._main); },
      onShow: (t, c) => { c.seen.add('auto'); t.tapOverride = true; redraw(t); },
    },
    {
      id: 'phases', title: 'The turn', wide: true,
      text: () => 'A turn runs along this bar: upkeep, draw, main, combat, a second main, the end. ' +
        'The lit step is where the game is now' + (touch() ? '.' : '; point at one to read what happens in it.'),
      when: (t, v, c) => c.myTurns.size >= 2 && myPriority(t, v) && !(v.stack || []).length,
      at: (t) => onScreen(t.dock && t.dock._strip),
    },
    {
      id: 'stops', title: 'Stops', wide: true,
      text: () => 'A dot over a step is a stop: the game waits for you there whenever you could do something. ' +
        `Elsewhere it moves on by itself, unless the other player does something you could answer. ${press()} a step to add a stop or take one away.`,
      when: (t, v, c) => c.myTurns.size >= 3 && myPriority(t, v) && !(v.stack || []).length,
      at: (t) => onScreen(t.dock && t.dock._strip),
    },
    {
      id: 'undo', title: 'Undo',
      text: () => 'Played something by mistake? Undo takes back the last thing you did' + (touch() ? '.' : ' (so does Ctrl+Z).'),
      when: (t, v) => (v.turn || 0) >= 2 && !!v.canUndo && myPriority(t, v) && !t.paying && !!undoButton(t),
      at: (t) => undoButton(t),
    },
    {
      id: 'menu', title: 'The game menu',
      text: () => 'This menu has the whole game log' + (touch() ? '' : ' (L)') + ', how fast the table and the bots move, Save and leave, and Concede. ' +
        'Options, behind the gear in the top corner, has everything else; going there saves this game to come back to.',
      when: (t, v, c) => c.myTurns.size >= 3 && myPriority(t, v) && !(v.stack || []).length,
      at: (t) => onScreen(t.menuBtn),
    },
  ];

  const BASIC_MANA = { Plains: '{W}', Island: '{U}', Swamp: '{B}', Mountain: '{R}', Forest: '{G}' };

  function mine(t, v, type) {
    const ch = v.pendingChoice;
    return !!(ch && ch.type === type && ch.playerId === t.meId && !ch.waiting);
  }
  function myPriority(t, v) { return v.priorityPlayer === t.meId && !v.pendingChoice; }
  function myMain(t, v) {
    return v.activePlayer === t.meId && myPriority(t, v) && v.step === 'main' && !(v.stack || []).length;
  }
  /** A node that is on the screen, or null: a phone leaves some of the table out. */
  function onScreen(n) { return n && n.isConnected && n.offsetParent ? n : null; }
  /** A card in your hand that can be played now and is what `test` asks for. */
  function handCard(t, v, test) {
    const me = t.me;
    if (!me) return null;
    for (const id of (v.playable || [])) {
      const o = me.hand.find(x => x.id === id);
      const a = o && t.analysis(o);
      if (a && test(a, o)) { const n = t.els.get(id); if (n && n.isConnected) return n; }
    }
    return null;
  }
  /** A creature to cast: by hand, only once the mana in your pool pays for it. */
  function castableCreature(t, v) {
    return handCard(t, v, (a, o) => a.isCreature && (t.autoTap() || t.poolCovers(o.card.mana_cost || a.manaCost || '')));
  }
  const poolTotal = (t) => { const p = (t.me && t.me.pool) || {}; return ['W', 'U', 'B', 'R', 'G', 'C'].reduce((n, c) => n + (p[c] || 0), 0); };
  /** An untapped land of yours that could tap for mana now. */
  function payLand(t) {
    return t.manaSources().find(o => { const a = t.analysis(o); return a && a.isLand; }) || null;
  }
  const myLand = (t, v) => v.battlefield.find(o => o.controller === t.meId && (() => { const a = t.analysis(o); return a && a.isLand; })()) || null;
  const sickOne = (t, v) => v.battlefield.find(o => o.controller === t.meId && o.power != null && o.summoningSick) || null;
  const blocker = (v) => v.battlefield.find(o => (o.blocking || []).length) || null;
  /** The portrait of a player who has taken damage, theirs before yours. */
  function hurt(t, v, c) {
    const them = v.players.find(p => p.id !== t.meId && p.life < c.startLife);
    if (them) return onScreen(t.oppWrap.querySelector(`.life-orb[data-player="${them.id}"]`)) || onScreen(t.oppStrip.querySelector(`.life-orb[data-player="${them.id}"]`));
    const me = t.me;
    return me && me.life < c.startLife ? onScreen(t.meHud.querySelector('.life-orb')) : null;
  }
  const undoButton = (t) => onScreen(Array.from((t.dock && t.dock._row && t.dock._row.querySelectorAll('button')) || []).find(b => /Undo/.test(b.textContent)) || null);

  /** Draw the table again once the render that may be under way has finished. */
  const redraw = (t) => setTimeout(() => { if (!t._destroyed && t.view) t.render(); }, 0);

  /** A note's words, with mana symbols drawn as they are on the cards. */
  const rich = (s) => U.esc(String(s || '')).replace(/\{[^}]+\}/g, (m) => MTG.mana.html(m));

  class Coach {
    /**
     * `opts` puts other notes over a game the same way (the tutorials,
     * src/14b-lessons.js): its own `marks`, a `name` for the step count,
     * `skipLabel` for the button that puts the notes away, and what happens
     * when they finish or are put away (`onFinish`, `onSkip`, each given
     * the coach). A mark may say how many times it is offered (`times`,
     * two by default), name its own button (`ok`), take the focus when it
     * comes up (`focus`), for a note that waits to be read, and do
     * something as it comes up (`onShow`). Only the first game, which has
     * no marks of its own, teaches paying for spells by hand.
     */
    constructor(table, opts) {
      this.t = table;
      this.opts = opts || {};
      this.byHand = !this.opts.marks;
      const wide = !MTG.isPhone();
      this.marks = (this.opts.marks || MARKS).filter(m => (wide || !m.wide) && (this.byHand || !m.byHand));
      this.seen = new Set();          // marks done with
      this.shown = new Map();         // how often each has been put up
      this.current = null;
      this.casts = new Set();         // spells you cast while tapping lands by hand
      this.myTurns = new Set();       // the turns that have been yours
      this.startLife = null;
      // the first game starts with lands tapped by hand, for this game only
      if (this.byHand) table.tapOverride = false;
      this.ring = el('div', { class: 'coach-ring', 'aria-hidden': 'true' });
      this.bubble = el('div', { class: 'coach-bubble', role: 'dialog', 'aria-live': 'polite', 'aria-label': 'Walkthrough' });
      table.arena.append(this.ring, this.bubble);
      this._onResize = U.debounce(() => this.place(), 60);
      window.addEventListener('resize', this._onResize);
      // the arena changes size without the window doing so (a phone turning, the drawer opening)
      if (window.ResizeObserver) { this._ro = new ResizeObserver(this._onResize); this._ro.observe(table.arena); }
      // the table settles a beat after each view; the marks follow
      this._timer = setInterval(() => this.tick(), 400);
      table.coach = this;
    }

    /** Called by the table after every render, and on a timer for the moments between. */
    onRender() { this.tick(); }

    /** Whether this mark is the one on the table now. */
    isUp(id) { return !!(this.current && this.current.mark.id === id); }

    /** What the game has done that the marks count: your turns, and the spells you paid for by hand. */
    watch(t, v) {
      if (this.startLife == null && v.players && v.players.length) this.startLife = Math.max(...v.players.map(p => p.life || 0));
      if (v.activePlayer === t.meId && !v.mulliganPhase) this.myTurns.add(v.turn);
      if (this.byHand && !t.autoTap()) {
        for (const s of (v.stack || [])) if (s.controller === t.meId && s.kind !== 'ability') this.casts.add(s.id);
      }
    }

    tick() {
      const t = this.t;
      if (this._stopped) return;
      if (t._destroyed) { this.stop(); return; }
      // every view the table shows is seen, so a spell that resolves at once is still counted
      if (t.view) this.watch(t, t.view);
      const v = t.live;
      if (!v || !t._ready()) { if (this.current) this.place(); return; }
      if (v.over) { this.finish(); return; }
      // the mark on screen: gone once its job is done, or once its moment has passed
      if (this.current) {
        const m = this.current.mark;
        if (m.done && m.done(t, v, this)) this.close('done');
        else if (!m.when(t, v, this)) this.close('passed');
        else { this.place(); return; }
        return;
      }
      // a new mark waits for the table to settle: nothing flying, no turn banner across it
      if (t.arena.querySelector('.moving, .fx-turn')) return;
      for (const m of this.marks) {
        if (this.seen.has(m.id)) continue;
        if ((this.shown.get(m.id) || 0) >= (m.times || 2)) continue;      // offered twice and let go by: enough
        if (!m.when(t, v, this)) continue;
        // its moment has come with its job done already: nothing to show
        if (m.done && m.done(t, v, this)) { this.seen.add(m.id); continue; }
        const anchor = m.at(t, v, this);
        if (!anchor) continue;
        this.show(m, anchor);
        return;
      }
      // (once the game taps lands for you, the marks about tapping them by hand are behind you)
      if (this.marks.every(m => this.seen.has(m.id) || (this.shown.get(m.id) || 0) >= (m.times || 2) || (m.byHand && t.autoTap()))) this.finish();
    }

    show(mark, anchor) {
      this.shown.set(mark.id, (this.shown.get(mark.id) || 0) + 1);
      this.current = { mark, anchor };
      const t = this.t;
      const n = this.marks.findIndex(m => m.id === mark.id) + 1;
      const ok = el('button', { type: 'button', class: 'btn sm primary coach-ok', text: mark.ok || 'Got it', onclick: () => this.close('ok') });
      this.bubble.innerHTML = '';
      this.bubble.append(
        el('div', { class: 'coach-step', text: (this.opts.name ? this.opts.name + ' · ' : '') + `${n} of ${this.marks.length}` }),
        el('div', { class: 'coach-title', text: mark.title }),
        el('div', { class: 'coach-text', html: rich(mark.text(t, t.live || t.view, this)) }),
        el('div', { class: 'coach-foot' }, [
          el('button', { type: 'button', class: 'coach-skip', text: this.opts.skipLabel || 'Skip the walkthrough', onclick: () => this.skip() }),
          ok,
        ]),
      );
      this.ring.classList.add('on');
      this.bubble.classList.add('on');
      this.place();
      if (mark.focus) { try { ok.focus({ preventScroll: true }); } catch (e) { /* gone */ } }
      MTG.sfx('click');
      if (mark.onShow) mark.onShow(t, this);
    }

    /** Put the ring round the anchor and the bubble beside it, wherever they are now. */
    place() {
      const cur = this.current;
      if (!cur) return;
      const t = this.t;
      let a = cur.anchor;
      if (!a || !a.isConnected) {
        const v = t.live || t.view;
        a = v ? cur.mark.at(t, v, this) : null;
        if (!a) { this.ring.classList.remove('on'); return; }
        cur.anchor = a;
      }
      const ar = U.rect(t.arena);
      const r = U.rect(a);
      if (!r.width) return;
      const pad = 6;
      Object.assign(this.ring.style, {
        left: (r.left - ar.left - pad) + 'px', top: (r.top - ar.top - pad) + 'px',
        width: (r.width + pad * 2) + 'px', height: (r.height + pad * 2) + 'px',
      });
      this.ring.classList.add('on');
      const b = this.bubble;
      const bw = b.offsetWidth, bh = b.offsetHeight;
      /* Never over the thing it points at, and never over the big button —
         on a phone there is little room and the button is what the next
         step usually asks you to press. Each side is tried in turn and the
         first that covers neither wins. */
      const rel = (q) => ({ l: q.left - ar.left, t: q.top - ar.top, r: q.right - ar.left, b: q.bottom - ar.top });
      const A = rel(r);
      const dockEl = t.dock;
      const avoid = [A];
      if (dockEl && !dockEl.contains(a)) { const d = U.rect(dockEl); if (d.width) avoid.push(rel(d)); }
      // on a phone the app's own corner buttons sit along the top edge
      const top0 = MTG.isPhone() ? 58 : 10;
      const fit = (x, y) => ({ x: U.clamp(x, 10, ar.width - bw - 10), y: U.clamp(y, top0, ar.height - bh - 10) });
      const hits = (p) => avoid.some(q => p.x < q.r + 4 && p.x + bw > q.l - 4 && p.y < q.b + 4 && p.y + bh > q.t - 4);
      const midX = A.l + (A.r - A.l) / 2 - bw / 2, midY = A.t + (A.b - A.t) / 2 - bh / 2;
      const tries = [
        ['above', midX, A.t - bh - 18],
        ['below', midX, A.b + 18],
        ['left', A.l - bw - 18, midY],
        ['right', A.r + 18, midY],
        ['top', ar.width / 2 - bw / 2, top0],
      ];
      let pick = null;
      for (const [side, x, y] of tries) {
        const p = fit(x, y);
        if (!hits(p)) { pick = Object.assign(p, { side }); break; }
      }
      if (!pick) { const p = fit(tries[0][1], tries[0][2]); pick = Object.assign(p, { side: 'above' }); }
      b.style.left = pick.x + 'px';
      b.style.top = pick.y + 'px';
      b.dataset.side = pick.side;
    }

    /**
     * Put the mark away. Done or understood, it is not shown again; a
     * moment that simply went by leaves it to come round once more.
     */
    close(why) {
      const cur = this.current;
      if (cur && why !== 'passed') this.seen.add(cur.mark.id);
      if (cur && this.opts.onClose) this.opts.onClose(cur.mark, why);
      this.current = null;
      this.ring.classList.remove('on');
      this.bubble.classList.remove('on');
      clearTimeout(this._next);
      this._next = setTimeout(() => this.tick(), 600);
    }

    skip() {
      if (this.opts.onSkip) { this.stop(); this.opts.onSkip(this); return; }
      const wasByHand = this.byHand && !this.t.autoTap();
      MTG.setSetting('tutorialDone', true);
      this.stop();
      UI.toast('Walkthrough off. Options, under Gameplay, has it again.' +
        (wasByHand && this.t.autoTap() ? ' From here the game taps your lands for you, as your Options say.' : ''));
    }

    finish() {
      if (this._stopped) return;
      if (this.opts.onFinish) { this.stop(); this.opts.onFinish(this); return; }
      MTG.setSetting('tutorialDone', true);
      this.stop();
      if (MTG.lessons) UI.toast('That is the walkthrough done. The tutorials go further: the stack, combat tricks, blocking and counterspells.', 'ok', 6500);
      else UI.ok('That is the walkthrough done. Options has it again whenever you like.');
    }

    stop() {
      this._stopped = true;
      clearInterval(this._timer);
      clearTimeout(this._next);
      window.removeEventListener('resize', this._onResize);
      if (this._ro) this._ro.disconnect();
      this.ring.remove();
      this.bubble.remove();
      const t = this.t;
      if (t.coach === this) t.coach = null;
      // tapping by hand was this walkthrough's, for this game: your own setting has it back
      if (this.byHand && t.tapOverride != null) {
        t.tapOverride = null;
        redraw(t);
      }
    }
  }

  UI.Coach = Coach;
  UI.COACH_MARKS = MARKS;
})(window.MTG);
