'use strict';
/* ============================================================
   12k-ui-planechase.js - Planechase at the table

   In a Planechase game (src/06f-planechase.js) the plane the game is on
   is everybody's to read, whole: its name, its type and every word of its
   text, at the top of the column down the right of the table (where the
   stack sits under it), with the planar die under it. The player whose
   turn it is rolls the die from there, its price beside it ({0} the first
   time each turn, {1} more each time after); anybody else sees whose
   die it is. On a phone it folds to a bar with the plane's name and the
   die, and opens to the whole card.

   The die is shown thrown like any other (src/12f-ui-feel.js), landing on
   the Planeswalker symbol, chaos or a blank (UI.planarFace). A planeswalk
   is shown on the table: the plane gone and the next one arriving, the
   way a card turns over, with a word in the middle of the table saying
   where the game has gone.

   Wrapped round the table rather than written into it: the panel is built
   with it, painted on every render, and a view's planeswalk events start
   the show.
   ============================================================ */
(function (MTG) {
  const { el } = MTG;
  const UI = MTG.ui;
  const Table = UI.Table;
  const OPEN_KEY = 'mtg.planeOpen';

  /* ---------------- the symbols ---------------- */
  /* The Planeswalker symbol: a flame of three strokes. Chaos: eight arrows out of a ring. Drawn in the current
     colour, so a die, a button and a line of text each colour them their own way. */
  const PW_SVG = '<svg viewBox="0 0 24 24" class="pc-sym pc-pw" aria-hidden="true" focusable="false"><path fill="currentColor" d="M12 1.2c1.5 4.4 1.9 9.4 0 21.6-1.9-12.2-1.5-17.2 0-21.6z"/>' +
    '<path fill="currentColor" d="M4.2 5.4c2.9 2.4 4 6.3 3.7 11.9-2.1-3.2-3.5-7-3.7-11.9z"/><path fill="currentColor" d="M19.8 5.4c-2.9 2.4-4 6.3-3.7 11.9 2.1-3.2 3.5-7 3.7-11.9z"/></svg>';
  const CHAOS_SVG = (() => {
    let spokes = '';
    for (let k = 0; k < 8; k++) {
      const a = k * Math.PI / 4;
      const c = Math.cos(a), s = Math.sin(a);
      const p = (r) => (12 + r * c).toFixed(2) + ' ' + (12 + r * s).toFixed(2);
      const tip = (r, d) => (12 + r * c - d * s).toFixed(2) + ' ' + (12 + r * s + d * c).toFixed(2);
      spokes += `<path d="M${p(5.2)}L${p(10.4)}M${tip(8, 2.1)}L${p(10.6)}L${tip(8, -2.1)}"/>`;
    }
    return '<svg viewBox="0 0 24 24" class="pc-sym pc-chaos" aria-hidden="true" focusable="false"><g fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">' +
      '<circle cx="12" cy="12" r="3.2"/>' + spokes + '</g></svg>';
  })();
  const DIE_SVG = '<svg viewBox="0 0 24 24" class="pc-sym pc-die" aria-hidden="true" focusable="false"><rect x="3.5" y="3.5" width="17" height="17" rx="4" fill="none" stroke="currentColor" stroke-width="1.6"/>' +
    '<g transform="translate(6.6 6.6) scale(.45)">' + CHAOS_SVG.replace(/^<svg[^>]*>/, '').replace(/<\/svg>$/, '') + '</g></svg>';
  /** A planar die face drawn: 'pw' the Planeswalker symbol, 'chaos' the chaos symbol, 'blank' nothing. */
  UI.planarFace = (f) => (f === 'pw' ? PW_SVG : f === 'chaos' ? CHAOS_SVG : '<span class="pc-blank" aria-hidden="true"></span>');
  UI.planarFaceWord = (f) => (f === 'pw' ? 'planeswalk' : f === 'chaos' ? 'chaos' : 'blank');
  UI.CHAOS_SVG = CHAOS_SVG; UI.PW_SVG = PW_SVG;

  /* The sound of a planeswalk: the air rushing, rising, and two bells as the new plane arrives. */
  if (MTG.audio && MTG.audio.FX) {
    MTG.audio.FX.planeswalk = function (o) {
      this.noise({ filter: 'bandpass', freq: 260, sweepTo: 3600, dur: 0.85, attack: 0.25, gain: 0.07, q: 1.1, send: 0.6 });
      if (this.bell) {
        this.bell(523, { ratio: 1.5, index: 1.3, dur: 1.0, gain: 0.045, delay: 0.42, send: 0.6, pan: o && o.pan });
        this.bell(784, { ratio: 1.5, index: 1.1, dur: 0.9, gain: 0.035, delay: 0.58, send: 0.6, pan: o && o.pan });
      }
    };
  }

  const remembered = () => { try { const v = localStorage.getItem(OPEN_KEY); return v == null ? null : v === '1'; } catch (e) { return null; } };
  const remember = (on) => { try { localStorage.setItem(OPEN_KEY, on ? '1' : '0'); } catch (e) { /* not kept: no matter */ } };

  Object.assign(Table.prototype, {
    /** Whether the plane's whole card is shown: on a phone it opens and closes; elsewhere it stays open unless folded. */
    _planeOpen() {
      if (this._planeOpenNow != null) return this._planeOpenNow;
      const r = remembered();
      return r == null ? !MTG.isPhone() : (MTG.isPhone() ? false : r);
    },
    _planeToggle(on) {
      this._planeOpenNow = on == null ? !this._planeOpen() : !!on;
      if (!MTG.isPhone()) remember(this._planeOpenNow);
      this._planeKey = null;
      this.renderPlane();
    },
    /** Roll the planar die: paid from the pool when it holds enough, otherwise the game taps for it. */
    rollPlanarDie() {
      const pc = this.view && this.view.planechase;
      if (!pc || !pc.canRoll) return;
      const me = (this.view.players || []).find(p => p.id === this.meId);
      const cost = pc.dieCost || 0;
      const pool = me && me.pool ? Object.values(me.pool).reduce((n, v) => n + (typeof v === 'number' ? v : 0), 0) : 0;
      // (on a phone the card folds away, so the die and what it sets off are seen)
      if (MTG.isPhone()) this._planeOpenNow = false;
      this.send(Object.assign({ kind: 'planarDie' }, cost && pool >= cost && !MTG.settings.autoTapLands ? { fromPool: true } : {}));
    },

    /** The plane panel: every face-up plane whole, whose it is, and the planar die. */
    renderPlane() {
      const host = this.planeHost;
      if (!host) return;
      const v = this.view;
      const pc = v && v.planechase;
      if (!pc || !(pc.planes || []).length) {
        if (host.childNodes.length) host.replaceChildren();
        host.hidden = true;
        this.arena.classList.remove('has-plane');
        this.arena.style.removeProperty('--plane-h');
        this._planeKey = null;
        return;
      }
      const phone = MTG.isPhone();
      // on a phone the open card is over the table: something going on the stack folds it, to be seen
      const depth = (v.stack || []).length;
      if (phone && this._planeOpenNow && depth > (this._pcDepth || 0)) this._planeOpenNow = false;
      this._pcDepth = depth;
      const open = this._planeOpen();
      const key = JSON.stringify([pc.planes.map(p => [p.id, p.card && p.card.id, p.counters, p.controller]), pc.canRoll, pc.dieCost, pc.controller,
        pc.chaoticAether, open, phone, v.activePlayer === this.meId, this.meId]);
      if (key === this._planeKey) return;
      this._planeKey = key;
      host.hidden = false;
      this.arena.classList.add('has-plane');
      host.classList.toggle('open', open);
      const names = pc.planes.map(p => p.card.name);
      const who = (pid) => { const p = (v.players || []).find(x => x.id === pid); return !p ? 'Nobody' : pid === this.meId ? 'You' : p.name; };
      const mine = pc.controller === this.meId;

      /* the bar: folded, the plane's name (both, Spatial Merging) and its kind; open, whose it is this turn (the card
         under it says the rest). A tap folds or opens it. */
      const kind = pc.planes.length > 1 ? 'The planes' : pc.planes[0].phenomenon ? 'Phenomenon' : 'The plane';
      const whose = mine ? 'Yours while it’s your turn' : `${who(pc.controller)}’s this turn`;
      const bar = el('button', { type: 'button', class: 'pc-bar', 'aria-expanded': open ? 'true' : 'false',
        title: open ? 'Fold the plane away' : 'Read the plane',
        'aria-label': `${open ? 'Fold' : 'Read'} the plane: ${names.join(' and ')}`,
        onclick: () => { this._planeToggle(); MTG.sfx('click'); } }, [
        el('span', { class: 'pc-mark', html: PW_SVG }),
        el('span', { class: 'pc-bar-words' }, open ? [
          el('span', { class: 'pc-kicker', text: 'Planechase · ' + kind.replace(/^The /, '') }),
          el('span', { class: 'pc-bar-who', text: whose }),
        ] : [
          el('span', { class: 'pc-kicker', text: kind }),
          el('span', { class: 'pc-bar-name', text: names.join(' · ') }),
        ]),
        el('span', { class: 'pc-chev', 'aria-hidden': 'true' }),
      ]);

      const cards = open ? pc.planes.map(p => {
        const c = p.card || {};
        const art = UI.artUrl ? UI.artUrl(c) : null;
        const counters = Object.entries(p.counters || {}).filter(([, n]) => n > 0);
        const card = el('article', { class: 'pc-card' + (p.phenomenon ? ' phenomenon' : ''), dataset: { id: p.id },
          'aria-label': `${c.name}. ${c.type_line || ''}. ${String(c.oracle_text || '').replace(/\n/g, ' ')}` }, [
          art ? el('div', { class: 'pc-art', style: { backgroundImage: `url("${art}")` }, 'aria-hidden': 'true' }) : null,
          el('div', { class: 'pc-words' }, [
            el('h3', { class: 'pc-name', text: c.name }),
            el('div', { class: 'pc-type', text: c.type_line || '' }),
            el('div', { class: 'pc-text', html: MTG.mana.textHtml(c.oracle_text || '') }),
            counters.length ? el('div', { class: 'pc-counters', text: counters.map(([k, n]) => `${n} ${k} counter${n === 1 ? '' : 's'}`).join(' · ') }) : null,
          ].filter(Boolean)),
        ].filter(Boolean));
        // a press reads it bigger, the way any card on the table is read
        card.addEventListener('click', () => { if (UI.cardSheet) UI.cardSheet(c); });
        return card;
      }) : [];

      // the die: the active player's to roll, at its price; anybody else sees whose it is
      const cost = pc.dieCost;
      const can = !!pc.canRoll;
      const dieBtn = mine || v.activePlayer === this.meId
        ? el('button', { type: 'button', class: 'pc-roll' + (can ? ' can' : ''), disabled: !can,
          title: can ? `Roll the planar die (costs {${cost || 0}}; {1} more each time this turn)`
            : cost && v.step === 'main' && !(v.stack || []).length && v.priorityPlayer === this.meId ? `Not enough mana: the next roll costs {${cost}}`
              : 'In your main phase, with the stack empty, you may roll the planar die',
          'aria-label': `Roll the planar die, costs ${cost || 0}`,
          onclick: () => { this.rollPlanarDie(); } }, [
          el('span', { class: 'pc-roll-die', html: DIE_SVG }),
          el('span', { class: 'pc-roll-words', text: phone && !open ? 'Roll' : 'Roll the planar die' }),
          el('span', { class: 'pc-cost', html: MTG.mana.html('{' + (cost || 0) + '}') }),
        ])
        : el('span', { class: 'pc-whose', text: `${who(v.activePlayer)} may roll the planar die` });
      const foot = el('div', { class: 'pc-foot' }, [
        pc.chaoticAether ? el('span', { class: 'pc-flag', title: 'Chaotic Aether: each blank roll of the planar die is a chaos roll until a player planeswalks away from a plane',
          html: CHAOS_SVG + '<span>Blanks are chaos</span>' }) : null,
        dieBtn,
      ].filter(Boolean));

      host.replaceChildren(bar, ...(open ? [el('div', { class: 'pc-cards' }, cards)] : []), foot);
      // the stack starts under it (table.css: --plane-h)
      requestAnimationFrame(() => {
        if (!host.isConnected || host.hidden) return;
        this.arena.style.setProperty('--plane-h', Math.ceil(host.getBoundingClientRect().height) + 'px');
      });
    },

    /** A planeswalk, shown: the plane panel turns over to the new plane, and the middle of the table says where to —
        after any die still being shown, and one walk after another (two in a moment: a phenomenon, then the next plane). */
    _planeswalkFx(e) {
      const run = () => new Promise((done) => {
        if (this._destroyed || !this.arena || !this.arena.isConnected) { done(); return; }
        const ms = this._planeswalkShow(e);
        setTimeout(done, ms);
      });
      const luck = MTG.feel && MTG.feel._luckQueue;
      this._pcQueue = (this._pcQueue || Promise.resolve()).then(() => luck, () => luck).then(run, run);
    },
    _planeswalkShow(e) {
      const host = this.planeHost;
      if (!host || this._destroyed) return 0;
      const motion = !(this._motionOff && this._motionOff());
      const to = (e.to || []).map(x => x.name).filter(Boolean);
      const from = (e.from || []).map(x => x.name).filter(Boolean);
      if (!to.length && !from.length) return 0;
      if (MTG.sfx) MTG.sfx('planeswalk', { pan: e.player && e.player !== this.meId && this.panFor ? this.panFor(e.player) : null });
      if (motion) {
        host.classList.remove('walking');
        void host.offsetWidth;
        host.classList.add('walking');
        setTimeout(() => host.classList.remove('walking'), 1300);
      }
      const words = e.start ? 'The game begins on' : 'Planeswalk to';
      const who = (pid) => { const p = ((this.view || {}).players || []).find(x => x.id === pid); return !p ? '' : pid === this.meId ? 'You' : p.name; };
      const box = el('div', { class: 'pc-walk' + (motion ? '' : ' still'), role: 'status', 'aria-live': 'polite' }, [
        el('span', { class: 'pc-walk-mark', html: PW_SVG }),
        el('span', { class: 'pc-walk-kicker', text: e.start ? words : `${who(e.player) ? who(e.player) + ' ' + (e.player === this.meId ? 'planeswalk' : 'planeswalks') : 'Planeswalk'}${from.length ? ' away from ' + from.join(' and ') : ''}` }),
        to.length ? el('span', { class: 'pc-walk-name', text: (e.start ? '' : 'to ') + to.join(' and ') }) : null,
      ].filter(Boolean));
      // (under any question that opens, never over it)
      this.arena.appendChild(box);
      setTimeout(() => { box.classList.add('out'); setTimeout(() => box.remove(), 400); }, motion ? 2300 : 1800);
      return motion ? 2700 : 2200;
    },
  });

  /* ---------------- hooks into the table ---------------- */
  const base = { _build: Table.prototype._build, render: Table.prototype.render, update: Table.prototype.update };
  Table.prototype._build = function () {
    const r = base._build.apply(this, arguments);
    this.planeHost = el('section', { class: 'plane-host', role: 'region', 'aria-label': 'Planechase: the plane and the planar die', hidden: true });
    this.arena.appendChild(this.planeHost);
    return r;
  };
  Table.prototype.render = function () {
    const r = base.render.apply(this, arguments);
    try { this.renderPlane(); } catch (e) { console.error('[planechase]', e); }
    return r;
  };
  Table.prototype.update = function (view) {
    const r = base.update.apply(this, arguments);
    // the planeswalks since the last view, each shown once
    try {
      const evs = (view && view.events) || [];
      for (const e of evs) {
        if (e.type !== 'planeswalk' || (this._pcSeen || 0) >= e.seq) continue;
        this._pcSeen = e.seq;
        this._planeswalkFx(e);
      }
    } catch (e) { console.error('[planechase]', e); }
    return r;
  };
})(window.MTG);
