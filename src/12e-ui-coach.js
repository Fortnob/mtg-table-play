/* ============================================================
   12e-ui-coach.js - the first-game walkthrough
   A guided first game is an ordinary game against a gentle bot, with a
   few coach marks laid over the real table: a ring round the thing that
   matters and a sentence beside it, at the moment it first matters. There
   is no script and no pretend engine. Each mark waits for its moment in
   the game (your first land, your first attack, their first spell),
   points at whatever is really there, and goes away when you have done
   it, when you say you have got it, or when the moment has passed.

   It can be skipped at any point, played again from the options, and is
   remembered once it has been seen through.
   ============================================================ */
'use strict';
(function (MTG) {
  const { el, util: U } = MTG;
  const UI = MTG.ui;

  const touch = () => MTG.isTouch();

  /* The marks, in the order a first game usually meets them. `when` says
     whether this is its moment; `at` finds what to point at; `done` says
     the player has got it (so it can go without a click). */
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
      text: () => (touch() ? 'Tap' : 'Click (or drag)') + ' a land in your hand to put it on the table. Lands make the mana that pays for everything else, and you may play one each turn.',
      when: (t, v) => myMain(t, v) && !!handCard(t, v, a => a.isLand),
      at: (t, v) => handCard(t, v, a => a.isLand),
      done: (t, v) => t.me && t.me.landsPlayed > 0,
    },
    {
      id: 'cast', title: 'Cast a creature',
      text: () => 'Glowing cards are ones you can play right now. ' + (touch() ? 'Tap' : 'Click') +
        ' this creature to cast it; the game taps your lands to pay for it.',
      when: (t, v) => myMain(t, v) && !!handCard(t, v, a => a.isCreature),
      at: (t, v) => handCard(t, v, a => a.isCreature),
      done: (t, v) => v.battlefield.some(o => o.controller === t.meId && o.power != null),
    },
    {
      id: 'button', title: 'The big button',
      text: () => 'It always says what pressing it will do next: go to combat, end your turn, let a spell resolve. ' +
        (touch() ? '' : 'Space does the same. ') + 'When nothing in your hand glows, press it to move on.',
      when: (t, v) => myMain(t, v) && !(v.playable || []).length && (v.turn || 0) >= 1,
      at: (t) => t.dock && t.dock._main,
      // pressing it is the lesson: the main phase going by means it was pressed
      done: (t, v) => !myMain(t, v),
    },
    {
      id: 'attack', title: 'Attack',
      text: () => (touch() ? 'Tap' : 'Click') + ' your creatures to send them in, then press Attack. Anything the other player does not block deals its damage to them.',
      when: (t, v) => mine(t, v, 'declareAttackers') && ((v.pendingChoice.candidates || []).length > 0),
      at: (t, v) => t.els.get((v.pendingChoice.candidates || [])[0]) || (t.dock && t.dock._main),
      done: (t, v) => !mine(t, v, 'declareAttackers'),
    },
    {
      id: 'block', title: 'Block',
      text: () => 'They are attacking. ' + (touch() ? 'Tap' : 'Click') + ' one of your creatures, then the attacker it should stand in front of. Or press No blocks and take the damage.',
      when: (t, v) => mine(t, v, 'declareBlockers') && ((v.pendingChoice.candidates || []).length > 0),
      at: (t, v) => t.els.get((v.pendingChoice.candidates || [])[0]) || (t.dock && t.dock._main),
      done: (t, v) => !mine(t, v, 'declareBlockers'),
    },
    {
      id: 'stack', title: 'The stack',
      text: () => 'A spell waits here before it happens, so the other player can answer it. If you have an instant you can cast it now; otherwise pass and let it resolve.',
      when: (t, v) => (v.stack || []).some(s => s.controller !== t.meId) && v.priorityPlayer === t.meId && !v.pendingChoice,
      at: (t) => t.stackCol && t.stackCol.classList.contains('on') ? t.stackCol : null,
      done: (t, v) => !(v.stack || []).length,
    },
    {
      id: 'read', title: 'Reading a card',
      text: () => touch()
        ? 'Press and hold any card to read it at full size, with what is true of it right now.'
        : 'Hover any card to read it, with what is true of it right now. Double-click, or press I, for a closer look.',
      when: (t, v) => v.battlefield.some(o => o.controller !== t.meId && o.card),
      at: (t, v) => {
        const o = v.battlefield.find(x => x.controller !== t.meId && x.power != null) || v.battlefield.find(x => x.controller !== t.meId);
        return o ? t.els.get(o.id) : null;
      },
    },
    {
      id: 'log', title: 'What just happened',
      text: () => 'The last few things that happened run down this side. Open the log for the whole game' + (touch() ? '.' : ' (or press L).'),
      when: (t, v) => (v.turn || 0) >= 4,
      at: (t) => {
        const b = t.rail && t.rail.querySelector('.rail-log');
        return b && b.offsetParent ? b : t.menuBtn;
      },
    },
  ];

  function mine(t, v, type) {
    const ch = v.pendingChoice;
    return !!(ch && ch.type === type && ch.playerId === t.meId && !ch.waiting);
  }
  function myMain(t, v) {
    return v.activePlayer === t.meId && v.priorityPlayer === t.meId && v.step === 'main' &&
      !(v.stack || []).length && !v.pendingChoice;
  }
  /** A card in your hand that can be played now and is what `test` asks for. */
  function handCard(t, v, test) {
    const me = t.me;
    if (!me) return null;
    for (const id of (v.playable || [])) {
      const o = me.hand.find(x => x.id === id);
      const a = o && t.analysis(o);
      if (a && test(a)) { const n = t.els.get(id); if (n && n.isConnected) return n; }
    }
    return null;
  }

  class Coach {
    constructor(table) {
      this.t = table;
      this.seen = new Set();          // marks done with
      this.shown = new Map();         // how often each has been put up
      this.current = null;
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

    tick() {
      const t = this.t;
      if (this._stopped) return;
      if (t._destroyed) { this.stop(); return; }
      const v = t.live;
      if (!v || !t._ready()) { if (this.current) this.place(); return; }
      if (v.over) { this.finish(); return; }
      // the mark on screen: gone once its job is done, or once its moment has passed
      if (this.current) {
        const m = this.current.mark;
        if (m.done && m.done(t, v)) this.close('done');
        else if (!m.when(t, v)) this.close('passed');
        else { this.place(); return; }
        return;
      }
      // a new mark waits for the table to settle: nothing flying, no turn banner across it
      if (t.arena.querySelector('.moving, .fx-turn')) return;
      for (const m of MARKS) {
        if (this.seen.has(m.id)) continue;
        if ((this.shown.get(m.id) || 0) >= 2) continue;      // offered twice and let go by: enough
        if (!m.when(t, v)) continue;
        const anchor = m.at(t, v);
        if (!anchor) continue;
        this.show(m, anchor);
        return;
      }
      if (MARKS.every(m => this.seen.has(m.id) || (this.shown.get(m.id) || 0) >= 2)) this.finish();
    }

    show(mark, anchor) {
      this.shown.set(mark.id, (this.shown.get(mark.id) || 0) + 1);
      this.current = { mark, anchor };
      const n = MARKS.findIndex(m => m.id === mark.id) + 1;
      this.bubble.innerHTML = '';
      this.bubble.append(
        el('div', { class: 'coach-step', text: `${n} of ${MARKS.length}` }),
        el('div', { class: 'coach-title', text: mark.title }),
        el('div', { class: 'coach-text', text: mark.text() }),
        el('div', { class: 'coach-foot' }, [
          el('button', { type: 'button', class: 'coach-skip', text: 'Skip the walkthrough', onclick: () => this.skip() }),
          el('button', { type: 'button', class: 'btn sm primary coach-ok', text: 'Got it', onclick: () => this.close('ok') }),
        ]),
      );
      this.ring.classList.add('on');
      this.bubble.classList.add('on');
      this.place();
      MTG.sfx('click');
    }

    /** Put the ring round the anchor and the bubble beside it, wherever they are now. */
    place() {
      const cur = this.current;
      if (!cur) return;
      const t = this.t;
      let a = cur.anchor;
      if (!a || !a.isConnected) {
        const v = t.live || t.view;
        a = v ? cur.mark.at(t, v) : null;
        if (!a) { this.ring.classList.remove('on'); return; }
        cur.anchor = a;
      }
      const ar = t.arena.getBoundingClientRect();
      const r = a.getBoundingClientRect();
      if (!r.width) return;
      const pad = 6;
      Object.assign(this.ring.style, {
        left: (r.left - ar.left - pad) + 'px', top: (r.top - ar.top - pad) + 'px',
        width: (r.width + pad * 2) + 'px', height: (r.height + pad * 2) + 'px',
      });
      this.ring.classList.add('on');
      const b = this.bubble;
      const bw = b.offsetWidth, bh = b.offsetHeight;
      // above if it fits, else below, else beside: never over the thing it points at
      let x = r.left - ar.left + r.width / 2 - bw / 2;
      let y = r.top - ar.top - bh - 18;
      let side = 'above';
      if (y < 10) { y = r.bottom - ar.top + 18; side = 'below'; }
      if (y + bh > ar.height - 10) {
        y = U.clamp(r.top - ar.top + r.height / 2 - bh / 2, 10, ar.height - bh - 10);
        x = r.left - ar.left - bw - 18;
        side = 'left';
        if (x < 10) { x = r.right - ar.left + 18; side = 'right'; }
      }
      b.style.left = U.clamp(x, 10, ar.width - bw - 10) + 'px';
      b.style.top = U.clamp(y, 10, ar.height - bh - 10) + 'px';
      b.dataset.side = side;
    }

    /**
     * Put the mark away. Done or understood, it is not shown again; a
     * moment that simply went by leaves it to come round once more.
     */
    close(why) {
      const cur = this.current;
      if (cur && why !== 'passed') this.seen.add(cur.mark.id);
      this.current = null;
      this.ring.classList.remove('on');
      this.bubble.classList.remove('on');
      clearTimeout(this._next);
      this._next = setTimeout(() => this.tick(), 600);
    }

    skip() {
      MTG.setSetting('tutorialDone', true);
      this.stop();
      UI.toast('Walkthrough off. You can play it again from Options.');
    }

    finish() {
      if (this._stopped) return;
      MTG.setSetting('tutorialDone', true);
      this.stop();
      UI.ok('That is the walkthrough done. Options has it again whenever you like.');
    }

    stop() {
      this._stopped = true;
      clearInterval(this._timer);
      clearTimeout(this._next);
      window.removeEventListener('resize', this._onResize);
      if (this._ro) this._ro.disconnect();
      this.ring.remove();
      this.bubble.remove();
      if (this.t.coach === this) this.t.coach = null;
    }
  }

  UI.Coach = Coach;
  UI.COACH_MARKS = MARKS;
})(window.MTG);
