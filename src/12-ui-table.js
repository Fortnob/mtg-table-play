/* ============================================================
   12-ui-table.js - the game table
   Renders a redacted game view and turns clicks into intents. The same
   code runs for the host (acting on the local engine) and for clients
   (sending intents over the wire).

   The table is laid out the way a digital card game is: the other side
   across the top, yours along the bottom, your hand fanned along the very
   bottom edge, and one big button that always says what pressing it will
   do. Two ideas carry most of it.

   Every card is one element for as long as it exists. The engine gives each
   object an id that survives moving between zones, so the element for a
   card in your opponent's hand is the same element that flies into the
   middle when they cast it and the same one that lands on the battlefield
   when it resolves. Nothing is rebuilt; things move.

   And the table shows events, not just states. Views arrive as fast as the
   engine makes them, which is far faster than a person can follow, so they
   are queued and played back one beat at a time: a spell is held up in the
   middle long enough to read, an attack lunges, the turn changing hands
   gets a banner. When the table is waiting on you the queue is empty and
   nothing is in your way.

   This file is the shell, the layout and the input. The motion lives in
   12b-ui-table-fx.js and the questions the game asks in 12c-ui-table-ask.js.
   ============================================================ */
'use strict';
(function (MTG) {
  const { el, util: U } = MTG;
  /**
   * One line under a card being looked at; its words now (textnow) with their mana symbols.
   * @param {[string, string]} note
   */
  function noteNode(note) {
    const [cls, text] = note;
    if (cls === 'textnow') {
      return el('div', { class: 'pv-note info pv-textnow' }, [el('b', { text: 'Its text now: ' }),
        el('span', { html: MTG.mana.textHtml(String(text)) })]);
    }
    return el('div', { class: 'pv-note ' + cls, text });
  }

  /**
   * A card's perpetual changes (Alchemy) in words: a short badge and the
   * full list for the tooltip.
   * @param {any} p
   */
  /** A small eye: a hidden card somebody knows. */
  function eyeIcon() {
    const n = el('i', { class: 'eye', 'aria-hidden': 'true' });
    n.innerHTML = '<svg viewBox="0 0 24 24" width="1em" height="1em"><path fill="currentColor" d="M12 5C6.5 5 2.7 9.2 1.5 12c1.2 2.8 5 7 10.5 7s9.3-4.2 10.5-7C21.3 9.2 17.5 5 12 5zm0 11.2A4.2 4.2 0 1 1 12 7.8a4.2 4.2 0 0 1 0 8.4zm0-6.6a2.4 2.4 0 1 0 0 4.8 2.4 2.4 0 0 0 0-4.8z"/></svg>';
    return n;
  }
  function perpetualWords(p) {
    const sign = (n) => (n >= 0 ? '+' + n : String(n));
    const short = [], long = [];
    if (p.basePt) { short.push(`${p.basePt[0]}/${p.basePt[1]}`); long.push(`base power and toughness ${p.basePt[0]}/${p.basePt[1]}`); }
    if (p.pt && (p.pt[0] || p.pt[1])) { short.push(`${sign(p.pt[0])}/${sign(p.pt[1])}`); long.push(`gets ${sign(p.pt[0])}/${sign(p.pt[1])}`); }
    for (const k of (p.keywords || [])) { short.push(U.titleCase(k)); long.push('has ' + k); }
    for (const k of (p.lose || [])) long.push('loses ' + k);
    if (p.costDelta) { short.push(p.costDelta < 0 ? `cost ${p.costDelta}` : `cost +${p.costDelta}`); long.push(p.costDelta < 0 ? `costs {${-p.costDelta}} less` : `costs {${p.costDelta}} more`); }
    if ((p.types || []).length) long.push('is also ' + p.types.join(' '));
    if (p.spendAny) long.push('mana of any type can be spent to cast it');
    for (const t of (p.text || [])) long.push('"' + t + '"');
    if (!short.length && long.length) short.push('changed');
    return { short: short.join(' · '), long };
  }

  /** The spell printed on a prepare card, as its own face (or null). */
  const preparedFace = (o) => {
    const c = o && o.card;
    return c && c.layout === 'prepare' && c.card_faces && c.card_faces[1] ? c.card_faces[1] : null;
  };
  const UI = MTG.ui;

  /* The table only ever sees a snapshot, so a target spec asking about
     power or keywords is answered from the snapshot's own numbers. */
  const VIEW_SPEC_CTX = {
    powerOf: (o) => (o && o.power) || 0,
    toughnessOf: (o) => (o && o.toughness) || 0,
    hasKw: (o, k) => !!(o && (o.keywords || []).some(w => String(w).toLowerCase() === k)),
  };

  /* The turn as a strip of stops. Only the steps a person ever acts in are
     shown; the rest go by underneath. */
  const STRIP = [
    ['upkeep', 'Upkeep'], ['draw', 'Draw'], ['main1', 'Main'],
    ['beginCombat', 'Combat'], ['declareAttackers', 'Attack'], ['declareBlockers', 'Block'],
    ['combatDamage', 'Damage'], ['main2', 'Main 2'], ['end', 'End'],
  ];
  const STEP_WORDS = {
    untap: 'Untap', upkeep: 'Upkeep', draw: 'Draw', main1: 'First main phase', main2: 'Second main phase',
    beginCombat: 'Beginning of combat', declareAttackers: 'Declare attackers', declareBlockers: 'Declare blockers',
    firstStrikeDamage: 'First-strike damage', combatDamage: 'Combat damage', endCombat: 'End of combat',
    end: 'End step', cleanup: 'Cleanup',
  };
  /* What each step is for, in a sentence, for anyone still learning the turn. */
  const PHASE_HELP = {
    upkeep: 'Everything the player whose turn it is controls has just untapped. Anything that happens “at the beginning of your upkeep” happens now.',
    draw: 'The player whose turn it is draws a card.',
    main1: 'Play a land (one a turn) and cast creatures, sorceries and anything else.',
    beginCombat: 'The last moment to act before attackers are chosen.',
    declareAttackers: 'The player whose turn it is chooses which creatures attack. Attacking taps them, unless they have vigilance.',
    declareBlockers: 'The defending player chooses which creatures block which attackers. Blocking does not tap them.',
    combatDamage: 'Creatures deal damage equal to their power. Attackers nobody blocked hit the player.',
    main2: 'A second main phase: cast what you held back during combat.',
    end: 'End-of-turn abilities happen, damage wears off, then the next player takes their turn.',
  };
  function stepKey(v) {
    if (!v) return '';
    return v.step === 'main' ? (v.phase === 'precombat' ? 'main1' : 'main2') : v.step;
  }
  const idNum = (id) => parseInt(String(id).replace(/\D+/g, ''), 10) || 0;
  const CARD_RATIO = 88 / 63;

  /* ---------------- token art ----------------
     The engine makes tokens out of words — a 3/3 red Elemental, a Treasure —
     and words have no picture. Scryfall has a printed token for nearly all of
     them, so the first time one appears it is looked up by name, size and
     colour, and the answer is kept for every game after. Until it arrives
     (or if there is none) the token wears a frame of its own colours. */
  const TOKEN_ART = { key: 'tokenArt.v1', map: null, pending: new Set(), listeners: new Set() };
  function tokenKey(card) {
    return [card.name, card.power || '', card.toughness || '', (card.colors || []).join('')].join('|');
  }
  function tokenArtUrl(card) {
    if (!TOKEN_ART.map) TOKEN_ART.map = MTG.store.get(TOKEN_ART.key, {}) || {};
    const k = tokenKey(card);
    if (Object.prototype.hasOwnProperty.call(TOKEN_ART.map, k)) {
      // a picture that cannot load (offline, most likely) leaves the token its frame
      const url = TOKEN_ART.map[k];
      return url && (!MTG.scry.imageUsable || MTG.scry.imageUsable(url, 'normal')) ? url : null;
    }
    if (!TOKEN_ART.pending.has(k) && MTG.scry && MTG.scry.search) fetchTokenArt(card, k);
    return null;
  }
  // pictures that failed to load: whatever is on the table looks again, and writes those cards out
  if (MTG.bus) MTG.bus.on('scryfall:images', () => { for (const fn of TOKEN_ART.listeners) fn(); });
  async function fetchTokenArt(card, k) {
    TOKEN_ART.pending.add(k);
    const name = String(card.name || '').replace(/"/g, '');
    const colours = (card.colors || []).join('').toLowerCase();
    const tries = [];
    if (card.power != null && card.power !== '') tries.push(`t:token !"${name}" pow=${card.power} tou=${card.toughness} c=${colours || 'c'}`);
    tries.push(`t:token !"${name}"`);
    try {
      let url = '';
      for (const q of tries) {
        const found = await MTG.scry.search(q + ' -is:digital', { unique: 'art', max: 6 });
        const pick = (found || []).find(c => c.image_uris && c.image_uris.normal && (c.layout === 'token' || !c.card_faces));
        if (pick) { url = pick.image_uris.normal; break; }
      }
      TOKEN_ART.map[k] = url;
      MTG.store.set(TOKEN_ART.key, TOKEN_ART.map);
      for (const fn of TOKEN_ART.listeners) fn();
    } catch (e) {
      /* offline, or Scryfall said no: the frame will do, and it is asked again next game */
    } finally {
      TOKEN_ART.pending.delete(k);
    }
  }
  const TOKEN_HUES = { W: ['#f4ecd2', '#b9a67a'], U: ['#5f9bd6', '#1f3f6b'], B: ['#6f6278', '#211a28'],
    R: ['#e2694d', '#6b1f14'], G: ['#5fae6c', '#1d4a27'], M: ['#e6c66a', '#7a5a1a'], C: ['#9ea7b5', '#3a404b'] };
  function tokenFrame(card) {
    const cols = card.colors || [];
    const [hi, lo] = TOKEN_HUES[cols.length > 1 ? 'M' : (cols[0] || 'C')] || TOKEN_HUES.C;
    return el('div', { class: 'token-face', style: { '--tk-hi': hi, '--tk-lo': lo } }, [
      el('div', { class: 'tk-name', text: card.name }),
      el('div', { class: 'tk-glyph', text: /Treasure/.test(card.name) ? '◆' : /Clue/.test(card.name) ? '⚲'
        : /Food/.test(card.name) ? '❦' : /Artifact/.test(card.type_line || '') && !/Creature/.test(card.type_line || '') ? '⚙' : '✦' }),
      el('div', { class: 'tk-type', text: String(card.type_line || '').replace(/^Token\s+/, '') }),
      card.oracle_text ? el('div', { class: 'tk-text', html: MTG.mana.textHtml(card.oracle_text) }) : null,
    ].filter(Boolean));
  }

  /* What a player controlling another (Mindslaver) still only ever does as themselves: no `as` on these (CR 722.6). */
  const OWN_INTENTS = new Set(['chat', 'concede', 'leave', 'autoPass', 'setDeck', 'profile']);

  class Table {
    /**
     * @param {HTMLElement} root
     * @param {string} meId
     * @param {(intent: MTG.Intent) => void} send  host applies locally, client sends over net
     */
    constructor(root, meId, send) {
      this.root = root;
      /* Mindslaver (CR 722): while this player controls another, the table can sit in that player's seat (_actAs):
         meId is then theirs, the view shown is the one they would have, and what is done is sent for them (`as`).
         ownId is always this table's own player. */
      this.ownId = meId;
      this.meId = meId;
      this._actAs = null;
      this.raw = null;               // the newest view as it came, before a seat in it was chosen
      this.send = (intent) => send(this._actAs && intent && !OWN_INTENTS.has(intent.kind) ? Object.assign({}, intent, { as: this._actAs }) : intent);
      this.view = null;              // what is on screen
      this.live = null;              // the newest view to arrive
      this.queue = [];               // views waiting to be shown
      this.els = new Map();          // object id -> its card element
      this.wraps = new Map();        // id -> the slot a card sits in (a unit on the field, a slot in hand)
      this.seats = new Map();        // player id -> that seat's elements
      this.targeting = null;         // {need, specs, chosen:[], onDone, label, source}
      this.paying = null;            // a spell or ability held until you have tapped lands for it (12c)
      this.convoking = null;         // creatures (or artifacts) being chosen on the board to pay for a spell (12c)
      this.tapOverride = null;       // the first-game walkthrough's say on tapping lands, for that game only
      this.attackPlan = null;        // {declarations:[], defenderId}
      this.blockPlan = null;         // {declarations:[], pendingBlocker}
      this.discardSel = [];
      this.sacSel = [];
      this.mulliganBottom = [];
      this.chat = [];
      this.history = [];             // the recent events down the left edge
      this.focusSeat = null;         // an opponent given most of the far side
      this.spot = null;              // the card held up in the middle of the table
      this.drawerTab = 'log';
      this._build();
    }

    /* ---------------- shell ---------------- */
    _build() {
      this.root.innerHTML = '';
      this.root.classList.add('table-screen', 'arena-screen');
      /** @type {(cls: string, attrs?: Record<string, any> | null, ...ignored: any[]) => HTMLElement} */
      const div = (cls, attrs) => el('div', Object.assign({ class: cls }, attrs || {}));

      this.arena = div('arena');
      this.bg = div('arena-bg', { 'aria-hidden': 'true' }, []);
      this.bg.append(div('arena-sigil'), div('arena-mist'));
      this.oppWrap = div('opp-wrap', { role: 'region', 'aria-label': 'Opponents' });
      this.myWrap = div('my-wrap', { role: 'region', 'aria-label': 'Your battlefield' });
      this.midline = div('midline', { 'aria-hidden': 'true' });
      this.caption = div('table-caption', { role: 'status', 'aria-live': 'polite' });
      this.board = div('arena-board', null);
      this.board.append(this.oppWrap, this.midline, this.myWrap);

      this.stackCol = div('stack-col', { role: 'region', 'aria-label': 'The stack' });
      this.spotHost = div('spotlight', { 'aria-hidden': 'true' });
      this.handHost = div('hand-fan', { role: 'region', 'aria-label': 'Your hand' });
      this.meHud = div('me-hud', { role: 'group', 'aria-label': 'You' });
      this.dock = div('action-dock', { role: 'region', 'aria-label': 'What to do now' });
      this.banner = div('arena-banner', { role: 'status', 'aria-live': 'assertive' });
      this.decision = div('decision-host');
      this.rail = div('history-rail', { role: 'log', 'aria-label': 'What just happened' });
      this.drawer = div('arena-drawer', { role: 'complementary', 'aria-label': 'Game log and chat' });
      this.fxLayer = div('arena-fx', { 'aria-hidden': 'true' });
      this.overlay = div('arena-overlay');
      this.menuBtn = el('button', {
        class: 'arena-menu-btn', type: 'button', title: 'Game menu', 'aria-label': 'Game menu',
        html: '<span></span><span></span><span></span>',
        onclick: (e) => this.gameMenu(e),
      });

      const ns = 'http://www.w3.org/2000/svg';
      this.svg = document.createElementNS(ns, 'svg');
      this.svg.setAttribute('class', 'arena-arrows');
      this.svg.setAttribute('aria-hidden', 'true');
      const defs = document.createElementNS(ns, 'defs');
      for (const cls of ['atk', 'tgt', 'blk', 'aim', 'zap']) {
        const mk = document.createElementNS(ns, 'marker');
        mk.setAttribute('id', 'arw-' + cls);
        mk.setAttribute('viewBox', '0 0 10 10');
        mk.setAttribute('refX', '6'); mk.setAttribute('refY', '5');
        mk.setAttribute('markerWidth', '4'); mk.setAttribute('markerHeight', '4');
        mk.setAttribute('orient', 'auto-start-reverse');
        const path = document.createElementNS(ns, 'path');
        path.setAttribute('d', 'M 0 0 L 10 5 L 0 10 L 2.5 5 z');
        path.setAttribute('class', 'head ' + cls);
        mk.appendChild(path);
        defs.appendChild(mk);
      }
      this.svg.appendChild(defs);

      this.oppStrip = div('opp-strip', { role: 'tablist', 'aria-label': 'Opponents — choose whose board to look at' });
      // a short note beside whatever you are pointing at: why a card cannot be played, what a step is
      this.tipEl = div('arena-tip', { role: 'tooltip', id: 'arenaTip' });
      this.arena.append(this.bg, this.oppStrip, this.board, this.caption, this.stackCol, this.svg, this.spotHost,
        this.meHud, this.handHost, this.dock, this.rail, this.drawer, this.banner,
        this.decision, this.overlay, this.fxLayer, this.menuBtn, this.tipEl);
      this.root.appendChild(this.arena);

      this.preview = el('div', { class: 'arena-preview', 'aria-hidden': 'true' });
      document.body.appendChild(this.preview);

      this._wireInput();
      // a token's picture arriving from Scryfall is a reason to repaint it
      this._onTokenArt = U.debounce(() => {
        for (const n of this.els.values()) if (n._url && n._url.startsWith('token:')) n._url = null;
        if (this.view && !this._destroyed) this.render();
      }, 250);
      TOKEN_ART.listeners.add(this._onTokenArt);
      this._keys();
    }

    /** @this {MTG.TableInstance} */
    _keys() {
      this._onKey = (e) => {
        if (/input|textarea|select/i.test((e.target.tagName || ''))) return;
        if (document.querySelector('.modal-back')) return;      // a dialog has the keyboard
        if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
          e.preventDefault();
          this.send({ kind: 'undo' });
          return;
        }
        /* Ctrl is full control for this step, Ctrl+Shift locks it on —
           the same two gestures as Arena, and the same meaning: nothing is
           passed for you until you say so. */
        if ((e.key === 'Control' || e.key === 'Meta') && !e.repeat) {
          const on = !(this.live && this.live.fullControl) || e.shiftKey;
          this.send({ kind: 'fullControl', on, sticky: e.shiftKey });
          return;
        }
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        if (e.key === ' ') { e.preventDefault(); this.primaryAction(); }
        else if (e.key === 'Enter') {
          e.preventDefault();
          if (this._ready()) this.send({ kind: 'yield', mode: e.shiftKey ? 'turn' : 'response' });
        } else if (e.key === 'Escape') {
          if (this.preview.classList.contains('on')) this.hidePreview();
          // a question that only waits on a mana tap (which colour): put down, nothing tapped
          if (this.asking && this.asking.escape) { this.asking = null; this.render(); return; }
          if (this.paying) { this.cancelPay(); return; }
          if (this.convoking) { this.convokeCancel(); return; }
          if (this.targeting && !this.targeting.legal) { this.cancelTargeting(); this.render(); return; }
          if (this._popover) { this.closePopover(); return; }
          if (this.drawerOpen) { this.toggleDrawer(false); return; }
        } else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
          e.preventDefault();
          this.cycleFocus(e.key === 'ArrowLeft' ? -1 : 1);
        } else if (/^[1-8]$/.test(e.key)) {
          this.focusSeatNumber(parseInt(e.key, 10));
        } else if (e.key.toLowerCase() === 'z') { e.preventDefault(); this.send({ kind: 'undo' }); }
        else if (e.key.toLowerCase() === 'l') this.toggleDrawer();
      };
      document.addEventListener('keydown', this._onKey);
      const rerender = U.debounce(() => { if (this.view) this.render(); }, 80);
      this._onResize = () => { this._handCw = null; rerender(); };
      /* Sizes that only change when the layout does (the hand's width, each
         seat's field, the arena) are measured once and kept, and an observer
         says when they change. Reading them fresh in the middle of every
         render made the browser lay the page out again two or three times
         a render, which is most of what a render cost on a phone. */
      this._sizes = new WeakMap();
      this._ro = window.ResizeObserver ? new ResizeObserver((entries) => {
        let changed = false;
        for (const e of entries) {
          const n = e.target, was = this._sizes.get(n);
          const now = { w: n.clientWidth, h: n.clientHeight };
          if (!was || was.w !== now.w || was.h !== now.h) { this._sizes.set(n, now); changed = true; }
        }
        if (changed && !this._destroyed) this._onResize();
      }) : null;
      /* The stack runs down the side from the top to just above the dock, scrolling past that (and on a phone from
         under the question asked up top); how tall the dock is (a respond panel, a long question on its button) and
         the question are told to the stylesheet, which needs no render for it. */
      this._dockRO = window.ResizeObserver ? new ResizeObserver(() => {
        for (const [n, prop] of [[this.dock, '--dock-h'], [this.banner, '--banner-h']]) {
          const h = n.offsetHeight;
          if (h !== n._seenH) { n._seenH = h; this.arena.style.setProperty(prop, h + 'px'); }
        }
      }) : null;
      if (this._dockRO) { this._dockRO.observe(this.dock); this._dockRO.observe(this.banner); }
      window.addEventListener('resize', this._onResize);
    }

    /**
     * A node's size as last laid out: measured the first time it is asked
     * for, then kept up to date by the resize observer rather than read
     * (and the layout forced) on every render.
     */
    sizeOf(n) {
      if (!this._ro) return { w: n.clientWidth, h: n.clientHeight };
      let s = this._sizes.get(n);
      if (!s) {
        s = { w: n.clientWidth, h: n.clientHeight };
        this._ro.observe(n);
        if (s.w || s.h) this._sizes.set(n, s);
      }
      return s;
    }

    /** @this {MTG.TableInstance} */
    destroy() {
      if (this._ro) this._ro.disconnect();
      if (this._dockRO) this._dockRO.disconnect();
      document.removeEventListener('keydown', this._onKey);
      window.removeEventListener('resize', this._onResize);
      document.removeEventListener('pointermove', this._onAimMove);
      cancelAnimationFrame(this._arrowRaf);
      clearTimeout(this._captionTimer);
      this._destroyed = true;
      TOKEN_ART.listeners.delete(this._onTokenArt);
      this.queue.length = 0;
      if (this.preview) this.preview.remove();
      this.closePopover();
      this.fxLayer.innerHTML = '';
    }

    /* ---------------- data in ----------------
       A view is queued rather than drawn: the pump plays them back in order,
       holding each one for as long as what happened in it deserves. */
    /** @this {MTG.TableInstance} */
    update(view) {
      /* A guest told the host how it likes to be passed for when it joined
         the lobby, before there was a game to tell. The first view is the
         moment there is one, so it is said again here — and again after a
         reconnect, which builds a new table. */
      if (!this.live && MTG.net && MTG.net.isClient && view && !view.spectating) {
        this.send({ kind: 'autoPass', cfg: MTG.autoPassConfig() });
      }
      // Mindslaver: the seat to show, of this player's own and those it controls (_followSeat)
      this.raw = view;
      const was = this._actAs;
      this._followSeat(view);
      view = this._seatView(view);
      if (this._actAs !== was && this.view) { this._seatChanged(view); return; }
      this.live = view;
      this.queue.push(view);
      if (!this.view) { this._pump(); return; }
      this._pump();
    }

    /* ---- Mindslaver: acting for a player this one controls (CR 722) ----
       The table follows whoever has the decision to make — this player, or one they control — and moves to that seat
       when it changes hands; the bar at the top switches seats by hand in between. */
    _followSeat(raw) {
      const ids = ((raw && raw.controlling) || []).map(c => c.id);
      if (this._actAs && !ids.includes(this._actAs)) this._setSeat(null);
      if (!ids.length) { this._decider = null; return; }
      const ch = raw.pendingChoice;
      const decider = raw.over || raw.mulliganPhase ? null : ch ? ch.playerId : raw.priorityPlayer;
      if (decider === this._decider) return;
      this._decider = decider;
      if (ids.includes(decider)) this._setSeat(decider);
      else if (decider === this.ownId) this._setSeat(null);
    }
    _setSeat(pid) {
      this._actAs = pid && pid !== this.ownId ? pid : null;
      this.meId = this._actAs || this.ownId;
    }
    /** The view to show: this player's own, or the seat of the player it is acting for (with the parts they share). */
    _seatView(raw) {
      const c = this._actAs && ((raw && raw.controlling) || []).find(x => x.id === this._actAs);
      if (!c) return raw;
      return Object.assign({}, c.view, {
        config: raw.config, log: raw.log, events: raw.events, eventSeq: raw.eventSeq, game: raw.game,
        match: raw.match, clock: raw.clock, spectating: raw.spectating, controlling: raw.controlling, seatOf: raw.you,
      });
    }
    /** Sit in another seat: a cut, not a flight, with nothing half done in the old one carried over. */
    _seatChanged(v) {
      this.targeting = null; this.paying = null; this.convoking = null; this.asking = null;
      this.attackPlan = null; this.blockPlan = null; this.discardSel = []; this.sacSel = [];
      this.focusSeat = null; this.spot = null;
      this.closePopover();
      this.hidePreview();
      for (const st of this.seats.values()) st.root.remove();
      this.seats.clear();
      for (const n of this.els.values()) n.remove();
      this.els.clear();
      for (const w of this.wraps.values()) w.remove();
      this.wraps.clear();
      this.meHud.innerHTML = '';
      this.meHud._built = false;
      this.queue.length = 0;
      this.view = v;
      this.live = v;
      this._noMotionOnce = true;
      this.render();
    }
    /** Act for a player this one controls, or (null) as itself again. */
    actAs(pid) {
      if (!this.raw) return;
      const was = this._actAs;
      this._setSeat(pid);
      if (this._actAs !== was) this._seatChanged(this._seatView(this.raw));
    }
    /** A player this one controls whose decision is the one to make now, while the table is in its own seat. */
    _ctlDecider() {
      const live = this.live;
      if (this._actAs || !live || !live.controlling || live.over) return null;
      const ch = live.pendingChoice;
      const d = ch ? ch.playerId : live.priorityPlayer;
      return live.controlling.find(c => c.id === d) || null;
    }
    /** Is this table's own player controlled by somebody else right now (and so can do nothing)? */
    controlledNow() {
      const v = this.view;
      if (!v || v.seatOf) return null;
      const me = v.players.find(p => p.id === this.ownId);
      return me && me.controlledBy ? (v.players.find(p => p.id === me.controlledBy) || { id: me.controlledBy, name: 'Another player' }) : null;
    }
    /** The bar across the top while anyone at this table is being controlled by, or controlling, this player. */
    renderControl() {
      const v = this.view;
      const ctl = (v && !v.over && v.controlling) || [];
      const by = this.controlledNow();
      let bar = this._ctlBar;
      if (!ctl.length && !by) {
        this.arena.classList.remove('acting-for', 'controlled');
        if (bar) { bar.remove(); this._ctlBar = null; }
        return;
      }
      if (!bar) {
        // (on the line between the two sides of the table, clear of everybody's life and name)
        bar = this._ctlBar = el('div', { class: 'ctl-bar', role: 'status', 'aria-live': 'polite' });
        this.board.appendChild(bar);
      }
      this.arena.classList.toggle('acting-for', !!this._actAs);
      this.arena.classList.toggle('controlled', !!by);
      const acting = this._actAs && ctl.find(c => c.id === this._actAs);
      const sig = by ? 'by:' + by.id : (acting ? 'as:' + acting.id : 'own') + '|' + ctl.map(c => c.id + ':' + c.name).join(',');
      if (bar._sig === sig) return;
      bar._sig = sig;
      bar.innerHTML = '';
      if (by) {
        bar.className = 'ctl-bar controlled';
        bar.append(el('div', { class: 'ctl-text' }, [
          el('b', { text: `${by.name} is controlling you this turn.` }),
          el('span', { text: ` ${by.name} makes all your decisions until the turn ends. You can still concede.` }),
        ]));
        return;
      }
      bar.className = 'ctl-bar' + (acting ? ' acting' : '');
      const names = ctl.map(c => c.name);
      bar.append(el('div', { class: 'ctl-text' }, acting ? [
        el('b', { text: `You are controlling ${acting.name} this turn.` }),
        el('span', { text: ` This is ${possessive(acting.name)} seat: what you do here, ${acting.name} does, with ${possessive(acting.name)} cards and mana.` }),
      ] : [
        el('b', { text: `You are controlling ${names.join(' and ')} this turn.` }),
        el('span', { text: ' You make their decisions; the table moves to their seat when one is theirs to make.' }),
      ]));
      const btns = el('div', { class: 'ctl-btns' });
      if (acting) btns.append(el('button', { type: 'button', class: 'btn sm', text: 'Your own seat', title: 'Back to your own hand and board', onclick: () => this.actAs(null) }));
      for (const c of ctl) if (!acting || c.id !== acting.id) {
        btns.append(el('button', { type: 'button', class: 'btn sm primary', text: `Act as ${c.name}`, title: `Sit in ${possessive(c.name)} seat: their hand, their board, their decisions`, onclick: () => this.actAs(c.id) }));
      }
      bar.append(btns);
    }

    get me() { return this.view && this.view.players.find(p => p.id === this.meId); }
    get isMyTurn() { return this.view && this.view.activePlayer === this.meId; }
    get hasPriority() { return this.live && this.live.priorityPlayer === this.meId; }
    /** Whether what is on screen is the game as it stands, so a click means what it looks like. */
    _ready() { return !!this.live && this.view === this.live && !this.queue.length; }

    objIn(id, v) {
      v = v || this.view;
      if (!v) return null;
      let o = v.battlefield.find(x => x.id === id);
      if (o) return o;
      for (const p of v.players)
        for (const z of ['hand', 'graveyard', 'exile', 'command'])
          { const f = (p[z] || []).find(x => x.id === id); if (f) return f; }
      for (const p of v.players) if (p.topCard && p.topCard.id === id) return p.topCard;
      return null;
    }

    /** Which zone, and whose, an object is in on a given view. */
    locate(id, v) {
      v = v || this.view;
      if (!v) return null;
      const bf = v.battlefield.find(x => x.id === id);
      if (bf) return { zone: 'battlefield', player: bf.controller, o: bf };
      const st = (v.stack || []).find(s => s.objId === id || s.id === id);
      if (st) return { zone: 'stack', player: st.controller, item: st };
      for (const p of v.players) {
        for (const z of ['hand', 'graveyard', 'exile', 'command']) {
          const f = (p[z] || []).find(x => x.id === id);
          if (f) return { zone: z, player: p.id, o: f };
        }
        // the top of a library, where it is shown (Fblthp, Lost on the Range: plotted from there)
        if (p.topCard && p.topCard.id === id) return { zone: 'library', player: p.id, o: p.topCard };
      }
      return null;
    }

    analysis(o) {
      // (Yedora, Grave Gardener: face down as a Forest land, a Forest is all it is — faceDownLand)
      if (o && o.faceDown && o.faceDownLand) return MTG.oracle.faceDownAnalysis(o.faceDownLand);
      // (a text-changing effect, layer 3: the abilities its words give it now — textCard)
      return o && o.card ? MTG.oracle.analyze(o.textCard || o.card, o.face || 0) : null;
    }

    /**
     * Whether the game taps your lands for you when you cast something:
     * your own setting (Options, Tap lands for me), unless the first-game
     * walkthrough has its own say for this one game. It never writes the
     * setting, so nothing it does can outlast the game.
     */
    autoTap() {
      if (this.tapOverride != null) return !!this.tapOverride;
      return MTG.settings.autoTapLands !== false;
    }

    /* ---------------- render ---------------- */
    /** @this {MTG.TableInstance} */
    render() {
      const v = this.view;
      if (!v || this._destroyed) return;
      // a spell waiting for mana whose moment has gone, or that has gone through, is put down
      this._payStale();
      /* Which opponent is in view is worked out before anything is measured,
         so a change of view is a cut rather than every card flying off. */
      if (this.view && this._opponents().length > 1) this._chooseFocus(this._opponents());
      const before = (this._motionOff() || this._noMotionOnce) ? null : this._snapshot();
      this._noMotionOnce = false;
      this._used = new Set();

      this.arena.classList.toggle('my-turn', v.activePlayer === this.meId);
      this.arena.classList.toggle('watching', !!(v.spectating || !this.me));
      const others = this._opponents();
      this.arena.dataset.opponents = String(others.length);
      this.arena.classList.toggle('has-focus', !!this.focusSeat);
      // combat: the table's light draws in on the battlefield, as it does on Arena, until the fighting is done
      const v0 = this.view;
      this.arena.classList.toggle('in-combat', !!v0 && (v0.phase === 'combat' || ['declareAttackers', 'declareBlockers', 'firstStrikeDamage', 'combatDamage'].includes(v0.step)) && v0.step !== 'endCombat');

      this.renderSeats(others);
      this.renderHand();
      this.renderStack();
      this.renderSpot();
      this.renderMeHud();
      this.renderDock();
      this.renderBanner();
      this.renderControl();
      this.renderDecision();
      this.renderRail();
      if (this.drawerOpen) this.renderDrawer();
      this.markInteractive();

      // anything that did not find a place this time has left the table
      const gone = [];
      for (const [id, node] of this.els) {
        if (this._used.has(id)) continue;
        gone.push({ id, node });
      }
      this._fitAll();
      // a card that has gone cannot still be the one you are reading
      if (this._hoverNode && !this._hoverNode.isConnected) this.hidePreview();
      // and a note about a card is only as good as the moment it was made in
      if (this._tipFor && (!this._tipFor.isConnected || this._tipFor.closest('.hslot'))) this.hideTip();
      if (before) this._flip(before, gone);
      for (const g of gone) { g.node.remove(); this.els.delete(g.id); }
      for (const [id, w] of this.wraps) if (!this._usedWraps || !this._usedWraps.has(id)) { w.remove(); this.wraps.delete(id); }
      this._usedWraps = null;
      this.chaseArrows();
      // a spell waiting for mana goes once the lands you tapped have paid for it
      this._payReady();
      // the walkthrough, if one is running, follows what is on the table
      if (this.coach) this.coach.onRender();
    }

    _opponents() {
      const v = this.view;
      const order = v.turnOrder && v.turnOrder.length ? v.turnOrder : v.players.map(p => p.id);
      /* Seats run in turn order starting after you, so the player whose
         turn comes next sits nearest your left hand, the way they would
         round a real table. */
      const at = order.indexOf(this.meId);
      const rotated = at >= 0 ? order.slice(at + 1).concat(order.slice(0, at)) : order.slice();
      const others = rotated.filter(id => id !== this.meId);
      if (this.focusSeat && !others.includes(this.focusSeat)) this.focusSeat = null;
      return others.map(id => v.players.find(p => p.id === id)).filter(Boolean);
    }

    /* ---- cards ---- */

    /** The element for an object, made the first time it is seen. */
    cardEl(o) {
      let n = this.els.get(o.id);
      if (!n) {
        n = el('div', { class: 'cv', dataset: { id: o.id }, tabindex: '0', role: 'button' }, [
          el('div', { class: 'cv-body' }, [
            el('div', { class: 'cv-face' }),
            el('div', { class: 'cv-shine' }),
          ]),
        ]);
        this.els.set(o.id, n);
      }
      this._used.add(o.id);
      this.paintCard(n, o);
      return n;
    }

    /** Bring a card element up to date with the object it shows. */
    /** @this {MTG.TableInstance} */
    paintCard(n, o) {
      const hidden = !!(o.hidden || o.faceDown || !o.card);
      const face = n.firstChild.firstChild;
      const isToken = !hidden && (o.card._isToken || o.card.layout === 'token');
      const url = hidden ? 'back' : (MTG.scry.imageUrl(o.card, 'normal', o.face || 0) ||
        (isToken ? (tokenArtUrl(o.card) || 'token:' + tokenKey(o.card)) : ('text:' + o.card.name)));
      if (n._url !== url) {
        const wasBack = n._url === 'back';
        n._url = url;
        face.innerHTML = '';
        face.style.backgroundImage = '';
        face.className = 'cv-face';
        face._sleeve = null;
        if (hidden) {
          face.classList.add('back');
          face.appendChild(el('div', { class: 'back-ring' }, el('div', { class: 'back-pip' })));
        } else if (url.startsWith('token:')) {
          face.appendChild(tokenFrame(o.card));
        } else if (url.startsWith('text:')) {
          face.appendChild(UI.cardFallback(o.card, o.face || 0));
        } else {
          face.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
        }
        // a card turned face up turns over, rather than changing its picture
        if (wasBack && !hidden && !this._motionOff()) {
          n.classList.remove('flipping'); void n.offsetWidth; n.classList.add('flipping');
          setTimeout(() => n.classList.remove('flipping'), 520);
        }
      }
      // a card of yours, face up, in the style you gave it (the Collection)
      const style = !hidden && o.card && o.owner === this.meId && MTG.economy ? MTG.economy.styleFor(o.card.name) : null;
      if ((face._style || null) !== style || (style && !face.classList.contains('cstyle'))) {
        for (const c of [...face.classList]) if (c === 'cstyle' || c.startsWith('cs-')) face.classList.remove(c);
        if (style) face.classList.add('cstyle', 'cs-' + style);
        face._style = style;
      }
      // a face-down card wears its owner's sleeve
      if (hidden && UI.applySleeve) UI.applySleeve(face, MTG.app && MTG.app.sleeveFor ? MTG.app.sleeveFor(o.owner || o.controller) : null);
      n.classList.toggle('tapped', !!o.tapped);
      // summoning sick: a creature that cannot attack or tap yet (haste lets it)
      const sickNow = !!o.summoningSick && o.zone === 'battlefield' && o.power != null &&
        !(o.keywords || []).some(w => String(w).toLowerCase() === 'haste');
      n.classList.toggle('sick', sickNow);
      /* its mark, though, only where it matters to you: your own creature, on your turn (an opponent's can block
         all the same, and Arena marks neither); its label still says it */
      const sickMark = sickNow && o.controller === this.meId && !!this.view && this.view.activePlayer === this.meId;
      n.classList.toggle('attacking', !!o.attacking);
      n.classList.toggle('blocking', !!(o.blocking && o.blocking.length));
      n.classList.toggle('token', !!o.isToken);
      // an Oathbreaker's Signature Spell is framed in the command zone as its Oathbreaker is
      n.classList.toggle('is-cmd', !!(o.isCommander || o.isSignature));
      /* the game runs nearly every card by itself, so that goes without saying: only a card that needs a hand is
         marked (below), and its label says so too */
      const byHand = !hidden && !!UI.autoInfo && !UI.autoInfo(o.card).auto;
      n.setAttribute('aria-label', hidden ? 'A face-down card' : UI.describeCard(o.card, o) + (byHand ? ', needs a hand' : ''));

      // what is printed on top of the card: its numbers and what is on it
      const sig = [o.power, o.toughness, o.damage, JSON.stringify(o.counters || {}), o.zone, o.isCommander ? 1 : 0, hidden ? 1 : 0, o.prepared ? 1 : 0, JSON.stringify(o.seenBy || ''), o.owner || '', o.pairedWith || '', (o.melded || []).join('+'), o.face || 0, JSON.stringify(o.chosen || null), JSON.stringify(o.perpetual || null), o.intensity == null ? '' : o.intensity, o.band || '', (o.keywords || []).join(','), sickMark ? 1 : 0, byHand ? 1 : 0, o.textNow || ''].join('|');
      if (n._marks === sig) return;
      n._marks = sig;
      for (const m of n.querySelectorAll(':scope > .cv-mark')) m.remove();
      if (hidden) return;
      // a card the game can't run all of: the hand, bottom left (UI.autoBadge); the deck builder shows the tick too
      const auto = byHand && UI.autoBadge ? UI.autoBadge(o.card, { corner: true }) : null;
      if (auto) { auto.classList.add('cv-mark', 'cv-auto'); n.appendChild(auto); }
      // Alchemy: a perpetual change shows wherever the card is, in hand too
      if (o.perpetual) {
        const d = perpetualWords(o.perpetual);
        if (d.short) n.appendChild(el('div', { class: 'cv-mark cv-perpetual', text: '∞ ' + d.short, title: 'Perpetually: ' + d.long.join('; ') }));
      }
      // Alchemy: how intense it is now
      if (o.intensity != null) n.appendChild(el('div', { class: 'cv-mark cv-intensity', text: '◆ ' + o.intensity, title: `Intensity ${o.intensity}` }));
      // layer 3: a text-changing effect has changed its words (Mind Bend; Deadpool, Trading Card)
      if (o.textNow != null) n.appendChild(el('div', { class: 'cv-mark cv-textnow', text: '✎', title: 'Its text now: ' + o.textNow }));
      /* a card in a hand that others know (revealed, or looked at): an opponent's shown face up to you, your own that
         somebody has seen — marked with an eye, and who knows it on hover (seenBy) */
      if (o.zone === 'hand') {
        const sl = this.seenLabel(o);
        if (sl) n.appendChild(el('div', { class: 'cv-mark cv-seen' + (sl.all ? ' all' : ''), title: sl.long, 'aria-label': sl.long }, [eyeIcon(), el('span', { text: sl.short })]));
      }
      if (o.zone !== 'battlefield') return;
      const a = this.analysis(o);
      if (o.power != null && o.toughness != null) {
        const base = a ? [parseInt(a.power, 10), parseInt(a.toughness, 10)] : [NaN, NaN];
        const left = o.toughness - (o.damage || 0);
        const pt = el('div', { class: 'cv-mark cv-pt' }, [
          el('b', { class: o.power > base[0] ? 'up' : o.power < base[0] ? 'down' : '', text: String(o.power) }),
          el('i', { text: '/' }),
          el('b', { class: (o.damage ? 'hurt' : (o.toughness > base[1] ? 'up' : o.toughness < base[1] ? 'down' : '')), text: String(left) }),
        ]);
        n.appendChild(pt);
      }
      // its keywords at a glance, printed or given (src/12i-ui-keywords.js), and the mark of a creature not ready yet
      if (UI.keywordIcons) { const kws = UI.keywordIcons(o.keywords); if (kws) n.appendChild(kws); }
      if (sickMark && UI.sickMark) n.appendChild(UI.sickMark());
      const c = o.counters || {};
      if (c.loyalty != null && !(a && a.isCreature)) {
        n.appendChild(el('div', { class: 'cv-mark cv-loy', text: String(c.loyalty) }));
      }
      if (c.defense != null) n.appendChild(el('div', { class: 'cv-mark cv-def', text: String(c.defense) }));
      const chips = [];
      for (const [k, num] of Object.entries(c)) {
        if (!num || k === 'loyalty' || k === 'defense') continue;
        const plus = /^\+\d/.test(k), minus = /^-\d/.test(k);
        chips.push(el('span', { class: 'chip' + (plus ? ' plus' : minus ? ' minus' : ''), title: `${num} ${k} counter${num === 1 ? '' : 's'}`,
          text: (plus || minus) ? (num > 1 ? `${k} ×${num}` : k) : `${num} ${k}` }));
      }
      if (chips.length) n.appendChild(el('div', { class: 'cv-mark cv-chips' }, chips));
      // a Room with one door still locked says which, and what it takes to open
      const faces = o.card && o.card.card_faces;
      if (o.card && o.card.layout === 'split' && faces && faces.length === 2 && (o.face === 0 || o.face === 1 || o.face === 3) &&
          faces.every(f => /\bRoom\b/.test(f.type_line || ''))) {
        // face 3: put onto the battlefield without being cast, both doors shut
        const shut = o.face === 3 ? faces : [faces[1 - o.face]];
        n.appendChild(el('div', { class: 'cv-mark cv-locked', text: '\u{1F512} ' + (shut.length > 1 ? 'Both doors locked' : shut[0].name),
          title: shut.map(f => `${f.name} is locked. Unlock it for ${f.mana_cost || 'its cost'} as a sorcery.`).join('\n') }));
      }
      /* What it chose as it entered: the name Pithing Needle stops, the
         player Stuffy Doll hurts, the type a Lord pumps. */
      if (o.chosen) {
        const c = o.chosen;
        const COLOUR = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };
        const bits = [c.name && `Named: ${c.name}`, c.player && `Player: ${c.player}`, c.type && c.type,
          c.color && (COLOUR[c.color] || c.color), c.cardType && c.cardType, c.number != null && `Number: ${c.number}`,
          c.parity && (c.parity === 'odd' ? 'Odd' : 'Even')].filter(Boolean);
        if (bits.length) n.appendChild(el('div', { class: 'cv-mark cv-chosen', text: bits.join(' \u00b7 '), title: 'Chosen as it entered: ' + bits.join(', ') }));
      }
      // banding: attacking as one band with the others that share its label
      if (o.band) {
        const mates = this.view.battlefield.filter(x => x.band === o.band && x.id !== o.id).map(x => x.card.name);
        n.appendChild(el('div', { class: 'cv-mark cv-paired cv-band', text: '⚑ Band', title: mates.length ? 'In a band with ' + mates.join(', ') : 'In a band' }));
      }
      if (o.pairedWith) {
        const mate = this.objIn(o.pairedWith);
        n.appendChild(el('div', { class: 'cv-mark cv-paired', text: '⚭ Paired',
          title: mate && mate.card ? `Paired with ${mate.card.name} (soulbond)` : 'Paired (soulbond)' }));
      }
      // meld: one permanent that is two cards (Brisela, Voice of Nightmares is Gisela and Bruna)
      if (o.melded && o.melded.length) {
        n.appendChild(el('div', { class: 'cv-mark cv-paired cv-melded', text: '\u29d3 Melded',
          title: `Melded from ${o.melded.join(' and ')}: it leaves the battlefield as those two cards` }));
      }
      if (o.prepared) {
        const sp = preparedFace(o);
        n.appendChild(el('div', { class: 'cv-mark cv-prepared', text: 'Prepared',
          title: sp ? `Can cast a copy of ${sp.name} ${sp.mana_cost || ''}` : 'Prepared' }));
      }
    }

    /** A slot that holds one card in place: keyed so it survives redraws. */
    wrapFor(key, cls) {
      this._usedWraps = this._usedWraps || new Set();
      this._usedWraps.add(key);
      let w = this.wraps.get(key);
      if (!w) {
        w = el('div', { class: cls, dataset: { wrap: key } });
        this.wraps.set(key, w);
      } else if (w.className !== cls) w.className = cls;
      return w;
    }

    /** Put exactly these children in this order, moving rather than rebuilding. */
    place(parent, kids) {
      let i = 0;
      for (const k of kids) {
        const at = parent.children[i];
        if (at !== k) parent.insertBefore(k, at || null);
        i++;
      }
      while (parent.children.length > kids.length) parent.removeChild(parent.lastChild);
    }

    /* ---- seats ---- */

    seatFor(p, mine) {
      let s = this.seats.get(p.id);
      if (s) return s;
      const div = (cls) => el('div', { class: cls });
      s = { root: el('div', { class: 'seat ' + (mine ? 'mine' : 'theirs'), dataset: { seat: p.id } }) };
      s.field = div('seat-field');
      s.front = div('field-row front');
      s.back = div('field-row back');
      s.lands = div('row-part lands');
      s.others = div('row-part others');
      s.back.append(s.lands, s.others);
      if (mine) s.field.append(s.front, s.back);
      else s.field.append(s.back, s.front);
      if (!mine) {
        s.hud = div('seat-hud');
        s.root.append(s.hud, s.field);
      } else {
        s.root.append(s.field);
      }
      this.seats.set(p.id, s);
      return s;
    }

    /** @this {MTG.TableInstance} */
    renderSeats(others) {
      const v = this.view;
      const live = new Set();
      /* One opponent sits across from you in full. With more than that, the
         far side becomes a strip of nameplates — everyone's life, hand and
         whose turn it is, always in view — and one of their boards at a
         time, chosen from the strip, with the arrow keys or by seat number,
         and following whoever is taking their turn until you choose. Two or
         three opponents can also be laid out side by side. */
      const multi = others.length > 1;
      const split = multi && others.length <= 3 && !!MTG.settings.splitOpponents && !MTG.isPhone();
      const watching = !this.me;
      if (multi) this._chooseFocus(others);
      else this.focusSeat = null;
      this.arena.classList.toggle('multi', multi);
      this.arena.classList.toggle('split', split);
      this.renderOppStrip(multi ? others : []);
      /* A player out of the game keeps a nameplate, marked defeated, but
         their board is no longer one to look at (CR 800.4a took everything
         on it away): only those still playing are shown, side by side or
         one at a time. */
      const playing = multi ? others.filter(p => !p.hasLost) : others;
      let shown = !multi ? others : split ? playing : playing.filter(p => p.id === this.focusSeat);
      /* With room to spare, the boards either side of the one in view peek
         in from the edges, smaller: you see what the rest of the table has
         without leaving the board you are looking at, and a card there can
         still be read or aimed at. Click one to bring it forward. */
      const peek = multi && !split && !watching && !MTG.isPhone() && MTG.settings.peekOpponents !== false &&
        (this.sizeOf(this.arena).w || 0) >= 1150;
      const peekSide = new Map();
      if (peek && playing.length > 1) {
        const i = Math.max(0, playing.findIndex(p => p.id === this.focusSeat));
        const n = playing.length;
        const left = playing[(i - 1 + n) % n], right = playing[(i + 1) % n];
        // two opponents: the other one sits on whichever side it does round the table
        if (n === 2) peekSide.set((i === 0 ? right : left).id, i === 0 ? 'right' : 'left');
        else { peekSide.set(left.id, 'left'); peekSide.set(right.id, 'right'); }
        const at = (side) => playing.find(p => peekSide.get(p.id) === side);
        shown = [at('left'), playing[i], at('right')].filter(Boolean);
      }
      let below = null;
      if (watching && multi && !split) {
        // nobody is sitting here, so the near side shows the next seat round still playing
        const i = playing.findIndex(p => p.id === this.focusSeat);
        below = playing.length ? playing[(i + 1) % playing.length] : null;
        if (below && below.id === this.focusSeat) below = null;
      } else if (watching && !multi) {
        shown = [];
        below = others[0] || null;
      }
      const kids = [];
      for (const p of shown) {
        const s = this.seatFor(p, false);
        live.add(p.id);
        s.root.classList.toggle('active-turn', v.activePlayer === p.id);
        s.root.classList.toggle('dead', !!p.hasLost);
        s.root.classList.toggle('focused', multi && !split && this.focusSeat === p.id);
        const side = peekSide.get(p.id) || null;
        s.root.classList.toggle('peek', !!side);
        s.root.classList.toggle('peek-left', side === 'left');
        s.root.classList.toggle('peek-right', side === 'right');
        s.root.dataset.name = p.name;
        if (!s._peekClick) {
          s._peekClick = true;
          /* Anywhere on it brings it forward, its cards included, unless the
             card clicked is one being asked for right now: a target, an
             attacker to block, a card to choose. */
          s.root.addEventListener('click', (e) => {
            if (!s.root.classList.contains('peek')) return;
            const cv = e.target.closest && e.target.closest('.cv');
            if (cv && cv.matches('.targetable, .candidate, .chosen')) return;
            e.stopPropagation();
            this.setFocus(p.id, true);
          });
        }
        this.renderOppHud(p, s);
        this.renderField(p, s, false);
        kids.push(s.root);
      }
      this.place(this.oppWrap, kids);
      // how tall the HUD across from you is on a phone, rows wrapped and all: the prompt banner sits under it
      const tall = shown.map(p => this.seats.get(p.id)).find(s => s && s.hud && s.hud._h);
      const hudH = tall ? tall.hud._h + 'px' : '';
      if (this._oppHudH !== hudH) {
        this._oppHudH = hudH;
        if (hudH) this.arena.style.setProperty('--opp-hud-h', hudH);
        else this.arena.style.removeProperty('--opp-hud-h');
      }
      /* Another board brought forward comes in from its side of the table,
         the short way round (the next seat along from the right), settling
         as it arrives: you can see which way you turned. Without motion it
         fades up where it is. Not for a view the table jumped to (an undo, a
         replay scrubbed to another turn: _focusCut), which is a cut. */
      if (multi && !split && this.focusSeat) {
        const was = this._shownFocus;
        this._shownFocus = this.focusSeat;
        const s = this.seats.get(this.focusSeat);
        if (was && was !== this.focusSeat && s && !this._focusCut) {
          const n = others.length, a = others.findIndex(p => p.id === was), b = others.findIndex(p => p.id === this.focusSeat);
          const fromRight = a < 0 || b < 0 || (b - a + n) % n <= n / 2;
          s.root.classList.remove('focus-in-r', 'focus-in-l', 'seat-fade', 'turn-in-r', 'turn-in-l', 'turn-fade');
          void s.root.offsetWidth;   // start it again, for a quick second turn
          s.root.classList.add(this._motionOff() ? 'seat-fade' : fromRight ? 'focus-in-r' : 'focus-in-l');
          clearTimeout(s._focusAnim);
          s._focusAnim = setTimeout(() => s.root.classList.remove('focus-in-r', 'focus-in-l', 'seat-fade'), 620);
        }
      } else this._shownFocus = null;
      const me = this.me;
      if (me) {
        const s = this.seatFor(me, true);
        live.add(me.id);
        s.root.classList.toggle('active-turn', v.activePlayer === me.id);
        this.renderField(me, s, true);
        this.place(this.myWrap, [s.root]);
      } else if (below) {
        const s = this.seatFor(below, false);
        live.add(below.id);
        s.root.classList.toggle('active-turn', v.activePlayer === below.id);
        this.renderOppHud(below, s);
        this.renderField(below, s, false);
        this.place(this.myWrap, [s.root]);
      } else this.place(this.myWrap, []);
      for (const id of [...this.seats.keys()]) if (!live.has(id)) this.seats.delete(id);
    }

    /**
     * Whose board to show. Until you pick one yourself the table follows the
     * game: the player taking their turn, or on your turn whoever you are
     * attacking or whoever just put something on the stack. A choice you
     * make lasts until the turn changes hands.
     */
    _chooseFocus(others) {
      const v = this.view;
      const alive = others.filter(p => !p.hasLost);
      /* only a board still in the game can be looked at: one being looked
         at whose player has just lost goes back to the table's own choice */
      const ids = (alive.length ? alive : others).map(p => p.id);
      if (this._pinned && (this._pinned.turn !== v.turn || !ids.includes(this._pinned.id))) this._pinned = null;
      if (this._pinned) { this.focusSeat = this._pinned.id; return; }
      let want = null;
      if (ids.includes(v.activePlayer)) want = v.activePlayer;
      if (!want) {
        const top = (v.stack || [])[(v.stack || []).length - 1];
        if (top && top.controller !== this.meId && ids.includes(top.controller)) want = top.controller;
      }
      if (!want && this.attackPlan && this.attackPlan.defenderId && ids.includes(this.attackPlan.defenderId)) want = this.attackPlan.defenderId;
      if (!want && ids.includes(this.focusSeat)) want = this.focusSeat;
      if (!want) want = (alive[0] || others[0]).id;
      if (want !== this.focusSeat && this.focusSeat) this._noMotionOnce = true;
      this.focusSeat = want;
    }

    /** The row of nameplates across the top when there is more than one opponent. */
    /** @this {MTG.TableInstance} */
    renderOppStrip(others) {
      const host = this.oppStrip;
      const v = this.view;
      if (!others.length) { this.place(host, []); host.classList.remove('on'); return; }
      host.classList.add('on');
      const order = v.turnOrder && v.turnOrder.length ? v.turnOrder : v.players.map(p => p.id);
      const ch = v.pendingChoice;
      this._plates = this._plates || new Map();
      const kids = others.map((p) => {
        let plate = this._plates.get(p.id);
        if (!plate) {
          plate = el('button', { type: 'button', class: 'oplate', role: 'tab', dataset: { seat: p.id } });
          plate._num = el('span', { class: 'op-num' });
          plate._orb = this.lifeOrb(p);
          plate._orb.classList.add('mini');
          plate._name = el('span', { class: 'op-name' });
          // how many cards in hand, as a chip; the library's size is in the title, the label and a tapped portrait's tip
          plate._sub = el('span', { class: 'op-hand', 'aria-hidden': 'true' });
          plate._flags = el('span', { class: 'op-flags', 'aria-hidden': 'true' });
          plate.append(plate._num, plate._orb, el('span', { class: 'op-who' }, [plate._name]), plate._sub, plate._flags);
          plate.addEventListener('click', (e) => {
            e.stopPropagation();
            // out of the game: nothing of theirs to look at, aim at or attack
            const now = this.view.players.find(x => x.id === p.id);
            if (now && now.hasLost) return;
            if (this.targeting) {
              const pl = this.view.players.find(x => x.id === p.id);
              if (pl && this.isTargetablePlayer(pl)) return this.aimAtPlayer(p.id);
            }
            if (this.choosePlayer(p.id)) return;
            const live = this.live || this.view;
            const c = live.pendingChoice;
            if (c && c.type === 'declareAttackers' && c.playerId === this.meId && (c.defenders || []).some(d => d.id === p.id)) {
              if (!this.attackPlan) this.attackPlan = { declarations: [], defenderId: p.id, pending: null };
              // an attacker picked up goes at the player whose plate is clicked
              if (this.attackPlan.pending) { this._attackAt(this.attackPlan.pending, p.id); this.render(); return; }
              this.attackPlan.defenderId = p.id;
            }
            this.setFocus(p.id, true);
          });
          this._plates.set(p.id, plate);
        }
        const seatNo = order.indexOf(p.id) + 1;
        plate._num.textContent = String(seatNo);
        const bot = this.botWords(p);
        plate.title = p.hasLost ? `${p.name} \u2014 seat ${seatNo}, out of the game`
          : `${p.name} \u2014 seat ${seatNo}${bot ? ', ' + bot : ''}\n${p.handSize} in hand \u00b7 ${p.librarySize} in library` +
            (MTG.isTouch() ? '' : `\n(press ${seatNo} to look at this board)`);
        plate.setAttribute('aria-selected', this.focusSeat === p.id && !p.hasLost ? 'true' : 'false');
        if (p.hasLost) plate.setAttribute('aria-disabled', 'true'); else plate.removeAttribute('aria-disabled');
        this.paintOrb(plate._orb, p);
        plate._name.textContent = p.name;
        plate._sub.textContent = p.hasLost ? 'Out' : String(p.handSize);
        plate._sub.classList.toggle('out', !!p.hasLost);
        const flags = [];
        if (v.activePlayer === p.id) flags.push(['turn', '\u25b6 turn', 'their turn']);
        if (v.battlefield.some(o => o.controller === p.id && o.attacking === this.meId)) flags.push(['atk', '\u2694 you', 'attacking you']);
        if (p.poison) flags.push(['bad', `\u2620 ${p.poison}`, `${p.poison} poison`]);
        const toMe = this.me ? Object.entries(this.me.commanderDamage || {})
          .filter(([cid]) => { const o = this.objIn(cid); return o && o.owner === p.id; })
          .reduce((m, [, n]) => Math.max(m, n || 0), 0) : 0;
        if (toMe) flags.push(['cmd', `${toMe} cmd`, `${toMe} commander damage to you`]);
        if (v.monarch === p.id) flags.push(['crown', '\u265b', 'the monarch']);
        // said whole for a screen reader: what the plate shows, and what it now leaves to the title
        const acting = ch ? ch.playerId === p.id : (v.priorityPlayer === p.id && !v.mulliganPhase && !v.over);
        plate.setAttribute('aria-label', p.hasLost ? `${p.name}, seat ${seatNo}, out of the game`
          : [`${p.name}, seat ${seatNo}`, `${p.life} life`, `${p.handSize} in hand`, `${p.librarySize} in library`, bot,
            ...flags.map(f => f[2]), acting ? (ch ? 'deciding' : 'thinking') : ''].filter(Boolean).join(', '));
        const sig = JSON.stringify(flags);
        if (plate._flags._sig !== sig) {
          plate._flags._sig = sig;
          plate._flags.innerHTML = '';
          for (const [cls, text] of flags) plate._flags.appendChild(el('i', { class: cls, text }));
        }
        plate.classList.toggle('focused', this.focusSeat === p.id && !p.hasLost && !this.arena.classList.contains('split'));
        plate.classList.toggle('turn', v.activePlayer === p.id);
        plate.classList.toggle('dead', !!p.hasLost);
        plate.classList.toggle('pinned', !!(this._pinned && this._pinned.id === p.id));
        return plate;
      });
      for (const id of [...this._plates.keys()]) if (!others.some(p => p.id === id)) this._plates.delete(id);
      if (!host._hint) {
        host._hint = el('div', { class: 'op-hint' });
        host._split = el('button', { type: 'button', class: 'op-split', title: 'Show every opponent side by side',
          onclick: (e) => { e.stopPropagation(); MTG.setSetting('splitOpponents', !MTG.settings.splitOpponents); this._noMotionOnce = true; this.render(); } });
      }
      // (the keys for this are in the keyboard help, ?, and each plate's title: not printed beside the plates)
      host._hint.innerHTML = '';
      host._split.textContent = MTG.settings.splitOpponents ? 'One board' : 'All boards';
      host._split.style.display = others.length <= 3 ? '' : 'none';
      this.place(host, kids.concat([host._hint, host._split]));
    }

    /** Look at the next or previous opponent's board. */
    cycleFocus(dir) {
      const all = this._opponents();
      if (all.length < 2) return;
      // round the players still in the game; a defeated seat is passed over
      const others = all.filter(p => !p.hasLost);
      if (!others.length) return;
      const i = others.findIndex(p => p.id === this.focusSeat);
      const next = others[i < 0 ? (dir > 0 ? 0 : others.length - 1) : (i + dir + others.length) % others.length];
      this.setFocus(next.id, true);
    }

    /** Look at a seat by its number in turn order. */
    focusSeatNumber(n) {
      const v = this.view;
      if (!v) return;
      const order = v.turnOrder && v.turnOrder.length ? v.turnOrder : v.players.map(p => p.id);
      const id = order[n - 1];
      if (!id || id === this.meId) return;
      if (this._opponents().length < 2) return;
      this.setFocus(id, true);
    }

    /**
     * One player's permanents, in the two rows a digital table uses:
     * creatures at the front where they can reach across, and everything
     * else behind them — lands to one side, gathered into piles of the same
     * card, and artifacts and enchantments to the other.
     */
    renderField(p, s, mine) {
      const v = this.view;
      const ids = new Set(v.battlefield.map(o => o.id));
      const lands = [], creatures = [], others = [];
      for (const o of v.battlefield) {
        if (o.controller !== p.id) continue;
        // an Aura or Equipment sits on whatever it is attached to
        if (o.attachedTo && ids.has(o.attachedTo)) continue;
        const a = this.analysis(o);
        if ((o.faceDown && !o.faceDownLand) || (a && a.isCreature) || o.power != null) creatures.push(o);
        else if (a && a.isLand) lands.push(o);
        else others.push(o);
      }
      const byAge = (x, y) => idNum(x.id) - idNum(y.id);
      creatures.sort(byAge); others.sort(byAge); lands.sort(byAge);

      /* Tokens pile up too: ten Soldiers are one stack with a count on it,
         not ten cards across the felt. Only copies alike in all you can see
         share a pile: the same token, the same size, tapped or not, nothing
         on or attached to it, not attacking or blocking or chosen to;
         anything else stands on its own, where it can be told apart. Ones
         made this turn pile with the older ones all the same (being new is
         not a difference in the token): the ready ones on top, and the pile
         says how many cannot attack yet. Each card of a pile can still be
         clicked. */
      const planned = new Set([].concat(
        (this.attackPlan ? this.attackPlan.declarations.map(d => d.attackerId).concat(this.attackPlan.pending || []) : []),
        (this.blockPlan ? this.blockPlan.declarations.map(d => d.blockerId).concat(this.blockPlan.pendingBlocker || []) : [])));
      const pileable = (o) => o.isToken && !planned.has(o.id) && !(o.counters && Object.keys(o.counters).some(k => o.counters[k])) &&
        !v.battlefield.some(x => x.attachedTo === o.id) && !o.damage && !o.attacking && !(o.blocking || []).length;
      const piles = (list) => {
        const out = [], at = new Map();
        for (const o of list) {
          const key = pileable(o)
            ? [p.id, o.card.name, o.power, o.toughness, o.tapped ? 't' : 'u', (o.keywords || []).join(','), o.faceDown ? 'fd' : ''].join('|')
            : 'solo:' + o.id;
          let g = at.get(key);
          if (!g) { g = { key, list: [] }; at.set(key, g); out.push(g); }
          g.list.push(o);
        }
        return out;
      };
      const pileEls = (groups) => groups.map(g => {
        if (g.list.length === 1) return this.unitFor(g.list[0]);
        const w = this.wrapFor('tp:' + g.key, 'token-pile' + (g.list[0].tapped ? ' tapped' : ''));
        w.style.setProperty('--n', String(g.list.length));
        w.dataset.n = '\u00d7' + g.list.length;
        // the new ones underneath, the ready ones on top; how many are new, when some are and some are not
        const sick = g.list.filter(o => o.summoningSick && !(o.keywords || []).includes('haste'));
        const list = sick.concat(g.list.filter(o => !sick.includes(o)));
        // (said on your own, on your turn, as the mark on one card is: paintCard)
        if (sick.length && sick.length < list.length && list[0].power != null && list[0].controller === this.meId &&
          this.view.activePlayer === this.meId) w.dataset.sick = sick.length + ' new';
        else delete w.dataset.sick;
        this.place(w, list.map(o => this.unitFor(o)));
        return w;
      });
      const frontPiles = piles(creatures), otherPiles = piles(others);
      this.place(s.front, pileEls(frontPiles));
      this.place(s.others, pileEls(otherPiles));

      /* Lands pile up: eight Forests are one pile you can count, not eight
         cards across the felt. Only plain copies share a pile — anything with
         a counter, an aura or damage on it stands on its own — and tapped
         ones pile apart from untapped, because that is what you count. */
      const plain = (o) => !(o.counters && Object.keys(o.counters).some(k => o.counters[k])) &&
        !v.battlefield.some(x => x.attachedTo === o.id) && !o.damage && !o.attacking &&
        !(o.blocking || []).length && o.power == null;
      const groups = [], index = new Map();
      for (const o of lands) {
        const key = plain(o) ? `${p.id}|${o.card.name}|${o.tapped ? 't' : 'u'}` : 'solo:' + o.id;
        let g = index.get(key);
        if (!g) { g = { key, list: [] }; index.set(key, g); groups.push(g); }
        g.list.push(o);
      }
      const groupEls = groups.map(g => {
        const w = this.wrapFor('lg:' + g.key, 'land-pile' + (g.list.length > 1 ? ' many' : '') + (g.list[0].tapped ? ' tapped' : ''));
        w.style.setProperty('--n', String(g.list.length));
        this.place(w, g.list.map(o => this.unitFor(o)));
        return w;
      });
      this.place(s.lands, groupEls);
      s.counts = {
        front: frontPiles.map(g => g.list.length > 1 ? (g.list[0].tapped ? CARD_RATIO : 1) + (g.list.length - 1) * 0.2
          : (g.list[0].tapped ? CARD_RATIO : 1) + this._attachSpread(g.list[0]) * 0.25),
        lands: groups.map(g => (g.list[0].tapped ? CARD_RATIO : 1) + (g.list.length - 1) * 0.2),
        others: otherPiles.map(g => g.list.length > 1 ? (g.list[0].tapped ? CARD_RATIO : 1) + (g.list.length - 1) * 0.2
          : (g.list[0].tapped ? CARD_RATIO : 1) + this._attachSpread(g.list[0]) * 0.25),
      };
    }

    _attachSpread(o) {
      return this.view.battlefield.filter(x => x.attachedTo === o.id).length;
    }

    /** A permanent and whatever is attached to it, as one unit on the field. */
    unitFor(o) {
      const v = this.view;
      const atts = v.battlefield.filter(x => x.attachedTo === o.id).sort((a, b) => idNum(a.id) - idNum(b.id));
      const w = this.wrapFor('u:' + o.id, 'unit' + (o.tapped ? ' tapped' : '') + (atts.length ? ' has-atts' : ''));
      w.style.setProperty('--atts', String(atts.length));
      const kids = atts.map((x, i) => {
        const n = this.cardEl(x);
        n.classList.add('attached');
        n.style.setProperty('--ai', String(atts.length - i));
        return n;
      });
      const host = this.cardEl(o);
      host.classList.remove('attached');
      host.style.setProperty('--ai', '0');
      kids.push(host);
      this.place(w, kids);
      return w;
    }

    /* ---- their HUD ---- */

    renderOppHud(p, s) {
      const v = this.view;
      const hud = s.hud;
      if (!hud._built) {
        hud._built = true;
        hud._who = el('div', { class: 'hud-who' });
        hud._orb = this.lifeOrb(p);
        hud._hand = el('div', { class: 'ohand', title: 'Cards in hand' });
        hud._piles = el('div', { class: 'piles' });
        hud._cmd = el('div', { class: 'cmd-zone' });
        hud._flags = el('div', { class: 'hud-flags' });
        hud.append(hud._piles, hud._orb, hud._who, hud._hand, hud._cmd, hud._flags);
      }
      this.paintOrb(hud._orb, p);
      // rebuilt only when what it says has changed: most renders change nothing here
      const sub = this.seatSub(p);
      if (hud._who._sig !== p.name + '|' + sub) {
        hud._who._sig = p.name + '|' + sub;
        hud._who.innerHTML = '';
        // (a line under the name only when there is something to say: out of the game, disconnected)
        hud._who.append(...[
          el('div', { class: 'hud-name', text: p.name }),
          sub ? el('div', { class: 'hud-sub', text: sub }) : null,
        ].filter(Boolean));
      }
      // their hand: the backs, one per card, so a card leaving it is seen to
      // leave; face up when it is revealed to you (Telepathy, Seer's Vision)
      // (and a card in it you know — revealed, or seen when you looked — face up, marked, for as long as it stays there)
      const shown = (p.hand || []).some(o => !o.hidden && o.card);
      const all = shown && (p.hand || []).every(o => !o.hidden && o.card);
      const backs = (p.hand || []).map(o => this.cardEl(!o.hidden && o.card ? o : Object.assign({ hidden: true }, o)));
      this.place(hud._hand, backs);
      hud._hand.dataset.n = String(p.handSize);
      hud._hand.classList.toggle('revealed', shown);
      hud._hand.classList.toggle('partly', shown && !all);
      hud._hand.title = all ? 'Their hand, revealed' : shown ? 'Their hand: the cards you know are face up' : 'Cards in hand';
      this.renderPiles(hud._piles, p, false);
      this.renderCommand(hud._cmd, p, false);
      this.paintFlags(hud._flags, p);
      this.fitOppHand(hud, s, shown, backs.length, p.name + (MTG.isPhone() ? '' : '|' + sub));
    }

    /**
     * A hand shown face up is wide. Where their row has no room for it beside
     * the rest (a phone, a seat side by side with others), it takes a row of
     * its own under them, its cards spread across that row, so it covers
     * neither their command zone nor their flags and every card in it can be
     * read and tapped. On a phone the HUD's height is kept too (what does not
     * fit across wraps onto another row, and the prompt banner sits under
     * it). Measured only when something that changes the answer does: the
     * seat's width, the cards, the command zone, the flags, the name.
     */
    fitOppHand(hud, s, shown, n, who) {
      hud._hand.style.setProperty('--n', String(Math.max(1, n)));
      const phone = MTG.isPhone();
      if (!(shown && n) && !phone) {
        hud._fitSig = null;
        hud._h = 0;
        hud.classList.remove('hand-row');
        return;
      }
      const seatW = this.sizeOf(s.root).w || 0;
      const sig = [seatW, shown ? 'shown' : '', n, hud._cmd.childElementCount, hud._flags.textContent, who].join('|');
      if (!seatW || hud._fitSig === sig) return;
      hud._fitSig = sig;
      hud.classList.remove('hand-row');
      if (shown && n) {
        // laid out in one row: does it all fit across?
        const cs = getComputedStyle(hud);
        let need = (parseFloat(cs.paddingLeft) || 0) + (parseFloat(cs.paddingRight) || 0), k = 0;
        for (const c of hud.children) { const w = c.offsetWidth; if (w) { need += w; k++; } }
        need += Math.max(0, k - 1) * (parseFloat(cs.columnGap) || 0) + 10;   // and the count beside the hand
        hud.classList.toggle('hand-row', need > hud.clientWidth);
      }
      hud._h = phone ? hud.offsetHeight : 0;
    }

    seatSub(p) {
      const v = this.view;
      // why, in words (the engine keeps a short name for it)
      const why = { life: 'no life left', poison: 'ten poison counters', deck: 'drew from an empty library', commander: '21 commander damage',
        concede: 'conceded', timeout: 'left the game', time: 'ran out of time' }[p.lossReason] || p.lossReason;
      if (p.hasLost) return 'Defeated' + (why ? ' — ' + why : '');
      /* Who is acting is the ring turning round their portrait (paintOrb) and the line on the big button, said
         once; how good a bot is and how it plays is on the portrait, pointed at or held (botWords) */
      return p.connected === false ? 'disconnected' : '';
    }

    /** "Steady bot · Aggressive": how good a bot is and how it plays, or '' for a person. */
    botWords(p) {
      if (!p || !p.isBot) return '';
      const lvl = MTG.bots && MTG.bots.diffCfg ? MTG.bots.diffCfg(p.botDifficulty).label : 'Bot';
      const pers = p.botPersonality && MTG.bots && MTG.bots.PERSONALITIES && MTG.bots.PERSONALITIES[p.botPersonality];
      return lvl + ' bot' + (pers ? ' · ' + pers.label : '');
    }

    lifeOrb(p) {
      const orb = el('button', { type: 'button', class: 'life-orb', dataset: { player: p.id } }, [
        el('div', { class: 'orb-art' }),
        el('div', { class: 'orb-ring' }),
        el('div', { class: 'orb-life' }),
      ]);
      return orb;
    }

    /** The portrait and the number that matters most at the table. */
    paintOrb(orb, p) {
      const v = this.view;
      orb.dataset.player = p.id;
      const art = orb.querySelector('.orb-art');
      const card = this.portraitCard(p);
      const chosen = MTG.app && MTG.app.avatarFor ? MTG.app.avatarFor(p.id) : null;
      // a frame they bought, around the portrait
      const frame = MTG.app && MTG.app.frameFor ? MTG.app.frameFor(p.id) : null;
      if ((orb.dataset.frame || '') !== (frame || '')) {
        orb.dataset.frame = frame || '';
        let fx = orb.querySelector(':scope > .frame-fx');
        if (frame) {
          if (!fx) { fx = el('span', { class: 'frame-fx', 'aria-hidden': 'true' }); orb.appendChild(fx); }
          fx.className = 'frame-fx f-' + frame;
        } else if (fx) fx.remove();
      }
      const url = chosen || (card ? (MTG.scry.imageUrl(card, 'art_crop', 0) || '') : '');
      if (art._url !== url) {
        art._url = url;
        art.style.backgroundImage = url ? 'url("' + url.replace(/"/g, '%22') + '")' : '';
        art.textContent = url ? '' : (p.name || '?')[0].toUpperCase();
        art.style.setProperty('--seat-hue', UI.avatarColor(p.name));
      }
      const life = orb.querySelector('.orb-life');
      if (life.textContent !== String(p.life)) life.textContent = String(p.life);
      orb.classList.toggle('low', p.life <= 5);
      orb.classList.toggle('turn', v.activePlayer === p.id);
      const waiting = v.pendingChoice ? v.pendingChoice.playerId === p.id
        : (v.priorityPlayer === p.id && !v.mulliganPhase && !v.over);
      orb.classList.toggle('acting', !!waiting);
      orb.classList.toggle('dead', !!p.hasLost);
      const bot = this.botWords(p);
      const acting = waiting ? (v.pendingChoice ? 'deciding' : p.isBot ? 'thinking' : 'has priority') : '';
      orb.setAttribute('aria-label', `${p.name}: ${p.life} life` + (bot ? `, ${bot}` : '') + (acting ? `, ${acting}` : ''));
      orb.title = `${p.name} — ${p.life} life` + (bot ? `\n${bot}` : '');
    }

    /** A face for a seat: their commander, else the strongest thing they have shown. */
    portraitCard(p) {
      if (p.portrait) return p.portrait;
      const cmd = (p.command || []).find(o => o.isCommander) ||
        this.view.battlefield.find(o => o.isCommander && o.owner === p.id);
      if (cmd && cmd.card) return cmd.card;
      this._portraits = this._portraits || new Map();
      if (this._portraits.has(p.id)) return this._portraits.get(p.id);
      // a portrait is chosen once, from the first creature they put down
      const first = this.view.battlefield.filter(o => o.owner === p.id && o.power != null && !o.isToken && o.card)
        .sort((a, b) => idNum(a.id) - idNum(b.id))[0];
      if (first) { this._portraits.set(p.id, first.card); return first.card; }
      return null;
    }

    /** "Tempted by the Ring twice; Frodo is the Ring-bearer." */
    ringTip(p) {
      const n = p.ringLevel || 0;
      const bearer = p.ringBearer ? this.objIn(p.ringBearer) : null;
      return `The Ring has tempted them ${n === 1 ? 'once' : n === 2 ? 'twice' : n + ' times'}` +
        (bearer && bearer.card ? `; ${bearer.card.name} is the Ring-bearer` : '; no Ring-bearer');
    }

    paintFlags(host, p) {
      const v = this.view;
      const flags = [
        v.monarch === p.id ? ['crown', '♛ Monarch', 'Draws a card at the end of their turn'] : null,
        v.initiative === p.id ? ['init', '✦ Initiative', 'Has the initiative'] : null,
        p.poison ? ['bad', `☠ ${p.poison} poison`, 'Ten poison counters and they lose'] : null,
        p.energy ? ['', `⚡ ${p.energy}`, 'Energy'] : null,
        p.experience ? ['', `★ ${p.experience}`, 'Experience counters'] : null,
        p.rad ? ['bad', `☢ ${p.rad} rad`, 'Rad counters: at the start of their precombat main phase they mill that many, and lose 1 life and 1 rad for each nonland card milled'] : null,
        p.cityBlessing ? ['crown', '✶ City’s blessing', 'Has the city’s blessing for the rest of the game'] : null,
        p.enduringStory ? ['crown', '❧ Enduring story', 'Has an enduring story for the rest of the game'] : null,
        p.ringLevel ? ['crown', `◎ Ring ${p.ringLevel}`, this.ringTip(p)] : null,
        p.speed ? ['', p.speed >= 4 ? '» Max speed' : `» Speed ${p.speed}`,
          p.speed >= 4 ? 'Speed 4, as fast as it goes' : 'Goes up by one, once each of their turns, when an opponent loses life; it stops at 4'] : null,
        // Sen Triplets: no spells and no abilities, mana abilities included, for the turn
        p.lockedOut ? ['bad', '⊘ Locked', "Can't cast spells or activate abilities this turn (mana abilities included)"] : null,
      ].filter(Boolean);
      // a dungeon: which room they are in, and how many they have finished
      const done = typeof p.dungeonsCompleted === 'number' ? p.dungeonsCompleted : (p.dungeonsCompleted || []).length;
      if (p.dungeon) {
        flags.push(['dungeon', `⛫ ${p.dungeon.room}`,
          `In ${p.dungeon.name}, at ${p.dungeon.room}` + (done ? ` · ${done} dungeon${done === 1 ? '' : 's'} completed` : '')]);
      } else if (done) {
        flags.push(['dungeon', `⛫ ${done} done`, `${done} dungeon${done === 1 ? '' : 's'} completed`]);
      }
      // Curses: Auras that enchant this player
      const curses = (v.battlefield || []).filter(o => o.attachedTo === p.id);
      if (curses.length) flags.push(['bad', `⛧ ${curses.length === 1 ? curses[0].card.name : curses.length + ' curses'}`,
        'Enchanted by ' + curses.map(o => o.card.name).join(', ')]);
      const cmdDmg = Object.entries(p.commanderDamage || {}).filter(([, n]) => n > 0);
      for (const [cid, n] of cmdDmg) {
        const o = this.objIn(cid);
        flags.push(['cmd', `⚔ ${n}`, `${n} commander damage from ${o && o.card ? o.card.name : 'a commander'}`]);
      }
      const pool = poolHtml(p.pool);
      const sig = JSON.stringify(flags) + pool;
      if (host._sig === sig) return;
      host._sig = sig;
      host.innerHTML = '';
      for (const [cls, text, title] of flags) host.appendChild(el('span', { class: 'flag ' + cls, text, title }));
      if (pool) host.appendChild(manaFloat(p.pool, host._poolWas));
      host._poolWas = Object.assign({}, p.pool || {});
    }

    /** Library, graveyard and exile, as piles you can see the size of and open. */
    renderPiles(host, p, mine) {
      const gy = p.graveyard || [], ex = p.exile || [];
      const sleeve = MTG.app && MTG.app.sleeveFor ? MTG.app.sleeveFor(p.id) : null;
      const sig = [p.librarySize, gy.length, gy.length ? gy[gy.length - 1].id : '', ex.length, ex.length ? ex[ex.length - 1].id : '', p.topCard ? p.topCard.id : '', p.topCard ? JSON.stringify(p.topCard.seenBy || '') : '', sleeve ? sleeve.id : ''].join('|');
      if (host._sig === sig) return;
      host._sig = sig;
      host.innerHTML = '';
      /* Arena's quiet piles: an empty one is a faint outline (still there to open) with no "0" on it, and the
         size of a library is shown when it is pointed at or tapped, or when it is running low (10 or fewer) */
      const LOW = 10;
      const pile = (zone, label, n, top) => {
        const quiet = zone === 'library' && n > LOW;
        const node = el('button', {
          type: 'button', class: 'pile ' + zone + (n ? '' : ' empty') + (zone === 'library' && n && n <= LOW ? ' low' : '') + (quiet ? ' quiet' : ''),
          dataset: { pile: p.id + '/' + zone },
          title: `${label}: ${n}`, 'aria-label': `${p.name} ${label.toLowerCase()}, ${n} card${n === 1 ? '' : 's'}`,
          onclick: (e) => {
            if (zone !== 'library') return this.openZone(p, zone);
            // a tap shows how many are left, for a moment
            if (quiet) { node.classList.add('peek'); clearTimeout(node._peekT); node._peekT = setTimeout(() => node.classList.remove('peek'), 2200); }
            /* the top card of your library, when it can be played or plotted from there (Fblthp, Lost on the Range);
               an opponent's, when you may play it (Xanathar, Guild Kingpin) */
            const live = this.live || this.view;
            const tc = top && ((live.playable || []).includes(top.id) || ((live.uses || {})[top.id] || []).length) ? top : null;
            if (tc) this.cardMenu(tc.id, e);
            // a top card you know, to read at full size
            else if (top && top.card) this.showCard(top.id);
          },
        }, [
          el('div', { class: 'pile-card' + (top ? '' : ' back') }),
          el('span', { class: 'pile-n', text: String(n) }),
          el('span', { class: 'pile-label', text: label }),
        ]);
        const face = node.firstChild;
        // the library wears its owner's sleeve
        if (zone === 'library' && !top && n && UI.applySleeve) UI.applySleeve(face, sleeve);
        if (top && top.card) {
          const url = MTG.scry.imageUrl(top.card, 'small', top.face || 0);
          if (url) face.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
          /* the top of a library shown face up: revealed to everybody, or to you alone (you may look at it, you looked) —
             said on the pile, and the card is there to read */
          if (zone === 'library') {
            const sl = this.seenLabel(top) || { all: false, short: 'Only you', long: 'Only you can see this card' };
            node.classList.add('known');
            node.appendChild(el('span', { class: 'pile-tag' + (sl.all ? ' all' : '') }, [eyeIcon(), el('span', { text: sl.short })]));
            node.title = `${label}: ${n}. On top: ${top.card.name}. ${sl.long}.`;
            node.setAttribute('aria-label', `${p.name} library, ${n} card${n === 1 ? '' : 's'}. On top: ${top.card.name}. ${sl.long}.`);
          }
        }
        if (n > 1) node.style.setProperty('--depth', String(Math.min(4, Math.ceil(n / 8))));
        return node;
      };
      host.append(
        pile('library', 'Library', p.librarySize, p.topCard || null),
        pile('graveyard', 'Graveyard', gy.length, gy[gy.length - 1]),
      );
      if (ex.length) host.append(pile('exile', 'Exile', ex.length, ex[ex.length - 1]));
    }

    /** The command zone: the commander face up, with its tax, castable from here. */
    renderCommand(host, p, mine) {
      const cmd = (p.command || []).filter(o => o.card);
      const kids = cmd.map(o => {
        const w = this.wrapFor('cmd:' + o.id, 'cmd-slot');
        const tax = ((p.commanderCasts || {})[o.id] || 0) * 2;
        w.dataset.tax = tax ? '+' + tax : '';
        this.place(w, [this.cardEl(o)]);
        return w;
      });
      this.place(host, kids);
    }

    /* ---- your HUD ---- */
    renderMeHud() {
      const me = this.me;
      const h = this.meHud;
      if (!me) { h.innerHTML = ''; h._built = false; return; }
      if (!h._built) {
        h._built = true;
        h.innerHTML = '';
        h._orb = this.lifeOrb(me);
        h._who = el('div', { class: 'hud-who' });
        h._piles = el('div', { class: 'piles' });
        h._cmd = el('div', { class: 'cmd-zone' });
        h._flags = el('div', { class: 'hud-flags' });
        h.append(h._orb, el('div', { class: 'hud-col' }, [
          h._who, el('div', { class: 'hud-row' }, [h._piles, h._cmd]), h._flags,
        ]));
      }
      this.paintOrb(h._orb, me);
      // blocks that would leave you dead: your portrait says so too (lethalBlocks)
      const ch = (this.live || this.view).pendingChoice;
      const lethal = ch && ch.type === 'declareBlockers' ? this.lethalBlocks(ch) : null;
      h._orb.classList.toggle('lethal', !!lethal);
      let lc = h._orb.querySelector(':scope > .lethal-chip');
      if (lethal && !lc) { lc = el('span', { class: 'lethal-chip', 'aria-hidden': 'true', text: 'Lethal' }); h._orb.appendChild(lc); }
      else if (!lethal && lc) lc.remove();
      // your name; how many cards you hold is the hand itself, right there
      if (h._who._sig !== me.name) {
        h._who._sig = me.name;
        h._who.innerHTML = '';
        h._who.append(el('div', { class: 'hud-name', text: me.name }));
      }
      this.paintFlags(h._flags, me);
      this.renderPiles(h._piles, me, true);
      this.renderCommand(h._cmd, me, true);
    }

    /* ---- your hand, fanned along the bottom ---- */
    renderHand() {
      const v = this.view;
      const me = this.me;
      if (!me || v.spectating) { this.place(this.handHost, []); return; }
      // the opening hand is shown big in the middle until it is kept
      if (v.mulliganPhase && !me.keptHand) { this.place(this.handHost, []); return; }
      /* After the hand, the cards in exile you may play right now: an
         adventurer back from its adventure, an impulse draw, a plotted card.
         They play from there like any card in hand, and say where they are. */
      const sortBy = MTG.settings.handSort || 'cmc';
      const fromExile = (me.exile || []).filter(o => !o.hidden && o.card && (v.playable || []).includes(o.id));
      const cards = UI.sortCards(me.hand.filter(o => !o.hidden), sortBy).concat(UI.sortCards(fromExile, sortBy));
      const n = cards.length;
      const width = this.sizeOf(this.handHost).w || 800;
      // the card width the stylesheet chose, read once per layout rather than once per render
      // (a resize clears it; even asking the window its size can force a layout)
      const layout = String(MTG.settings.cardScale || 1);
      if (this._handCw == null || this._handCwFor !== layout) {
        // --hand-w is an expression (clamp of the screen height), which only a laid-out box resolves
        const probe = el('div', { style: { position: 'absolute', visibility: 'hidden', width: 'var(--hand-w)', height: '0' } });
        this.arena.appendChild(probe);
        this._handCw = probe.offsetWidth || 132;
        probe.remove();
        this._handCwFor = layout;
      }
      const cw = this._handCw;
      const room = Math.max(cw, width - 40);
      const step = n > 1 ? Math.min(cw * 0.82, (room - cw) / (n - 1)) : 0;
      const spread = Math.min(2.6, 18 / Math.max(1, n));
      const kids = cards.map((o, i) => {
        const exiled = o.zone === 'exile';
        const w = this.wrapFor('h:' + o.id, 'hslot' + (exiled ? ' from-exile' : ''));
        const off = i - (n - 1) / 2;
        w.style.setProperty('--x', (off * step).toFixed(1) + 'px');
        w.style.setProperty('--r', (off * spread).toFixed(2) + 'deg');
        w.style.setProperty('--y', (Math.abs(off) * Math.abs(off) * spread * 0.9).toFixed(1) + 'px');
        w.style.zIndex = String(10 + i);
        if (exiled && !w._tag) w._tag = el('span', { class: 'hslot-tag', text: o.card.layout === 'adventure' ? 'Adventure' : 'From exile' });
        this.place(w, exiled ? [this.cardEl(o), w._tag] : [this.cardEl(o)]);
        return w;
      });
      this.place(this.handHost, kids);
      this.handHost.dataset.n = String(n);
    }

    /* ---- the stack, down the right-hand side ---- */
    renderStack() {
      const v = this.view;
      const items = (v.stack || []).slice().reverse();     // top of the stack first
      const kids = items.map((s, i) => {
        const key = 'st:' + s.id;
        const w = this.wrapFor(key, 'stack-item' + (i === 0 ? ' top' : '') + (s.countered ? ' countered' : '') +
          (s.controller === this.meId ? ' mine' : ' theirs') + (s.kind === 'ability' ? ' ability' : ' spell'));
        w.dataset.stack = s.id;
        // (the modes chosen as it was cast, under the pointer when it is not the top, whose caption says them)
        const said = (s.modes || []).length ? 'Chosen: ' + s.modes.join('; ') : '';
        if (w.title !== said) w.title = said;
        w.classList.toggle('targetable', !!(this.targeting && this.isTargetableStack(s)));
        const who = v.players.find(p => p.id === s.controller);
        // a spell is its own card; an ability is a chip that names where it came from
        if (this.spot && this.spot.stackId === s.id) {
          // held up in the middle for now; the stack keeps its place
          this.place(w, [el('div', { class: 'stack-ph' })]);
        } else if (s.kind !== 'ability' && s.objId) {
          const o = Object.assign({ id: s.objId, card: s.card, zone: 'stack' });
          this.place(w, [i === 0 ? this._batchRow(s) : null, this.cardEl(o), this._stackLabel(s, who, i === 0)].filter(Boolean));
        } else {
          let chip = w.querySelector(':scope > .ability-chip');
          if (!chip) chip = this._abilityChip(s);
          // (the top of a batch of your triggers: what can be done with the lot, above it)
          this.place(w, [i === 0 ? this._batchRow(s) : null, chip, this._stackLabel(s, who, i === 0)].filter(Boolean));
        }
        return w;
      });
      this.place(this.stackCol, kids);
      // something new on top: the column, scrolled down to read what is under it, comes back up to show it
      const topId = items.length ? items[0].id : null;
      if (topId !== this._stackTop) { this._stackTop = topId; if (topId) this.stackCol.scrollTop = 0; }
      /* shown only with something in it to see: a lone item held up in the spotlight is the stack for now, so the
         column (its label, its glow, the gap kept for that item) waits until the spotlight lets it go */
      this.stackCol.classList.toggle('on', items.some(s => !(this.spot && this.spot.stackId === s.id)));
      this.stackCol.dataset.n = String(items.length);
    }

    _stackLabel(s, who, top) {
      const targets = (s.targets || []).map(t => this.targetName(t)).filter(Boolean);
      return el('div', { class: 'stack-cap' }, [
        el('span', { class: 'who', text: who ? (who.id === this.meId ? 'You' : who.name) : '' }),
        // (a spell's or a trigger's modes, chosen as it went on the stack: whole, never cut short)
        (s.modes || []).length ? el('span', { class: 'tg', html: MTG.mana.textHtml(s.modes.join('; ')) }) : null,
        targets.length ? el('span', { class: 'tg', text: '→ ' + targets.join(', ') }) : null,
        top ? el('span', { class: 'next', text: s.countered ? 'countered' : 'resolves next' }) : null,
      ].filter(Boolean));
    }
    /** Under the top of a batch of your triggers: how many there are, and what can be done with the lot of them. */
    _batchRow(s) {
      const live = this.live || this.view;
      if (!s.batch) return null;
      const n = (live.stack || []).filter(x => x.batch === s.batch).length;
      if (n < 2) return null;
      const acts = this.batchActions(live);
      return el('div', { class: 'stack-batch' }, [
        el('span', { class: 'sb-n', text: `×${n}` }),
        ...acts.map(b => el('button', { type: 'button', class: 'stack-act', text: b.label, title: b.title, onclick: (e) => { e.stopPropagation(); b.fn(); } })),
      ]);
    }

    /** A picture of a card that is not one of the table's own: the source of an ability, say. */
    staticCard(card) {
      if (!card) return null;
      const url = MTG.scry.imageUrl(card, 'normal', 0);
      if (!url) return null;
      return el('div', { class: 'cv static' }, el('div', { class: 'cv-body' }, [
        el('div', { class: 'cv-face', style: { backgroundImage: 'url("' + url.replace(/"/g, '%22') + '")' } }),
      ]));
    }

    /** An ability on the stack: where it came from, and every word of what it does (the column scrolls, the text wraps). */
    _abilityChip(s) {
      const url = s.card ? MTG.scry.imageUrl(s.card, 'art_crop', 0) : '';
      const name = this.stackName(s) || 'Ability';
      const text = s.abilityText || '';
      return el('div', { class: 'ability-chip', dataset: { stack: s.id } }, [
        el('div', { class: 'ac-art', style: url ? { backgroundImage: 'url("' + url.replace(/"/g, '%22') + '")' } : null }),
        el('div', { class: 'ac-text' }, [
          el('div', { class: 'ac-name', text: name }),
          // (a trigger named by its own words, a mana rider's, says them once)
          text && text !== name ? el('div', { class: 'ac-body', html: MTG.mana.textHtml(text) }) : null,
        ].filter(Boolean)),
      ]);
    }

    /**
     * What a spell or ability on the stack is called at the table. The engine names an ability by its source and
     * the start of its words ("Atraxa, Grand Unifier — When Atraxa, Grand Unifier enters, reveal the t…"); where
     * those words are the ability's own, cut short or not, it is called by its source alone, and its whole text
     * is shown beside it rather than the start of it.
     */
    stackName(s) {
      if (!s) return '';
      const name = String(s.name || '');
      const src = s.card && s.card.name;
      if (s.kind === 'ability' && name.includes(' \u2014 ')) {
        const at = name.indexOf(' \u2014 ');
        const head = name.slice(0, at), rest = name.slice(at + 3).replace(/\u2026$/, '').trim().toLowerCase();
        const words = String(s.abilityText || '').toLowerCase();
        if (!rest || (words && words.startsWith(rest)) || /\u2026$/.test(name)) return head || src || name;
      }
      return name || src || '';
    }

    /* ---- the card held up in the middle ---- */
    renderSpot() {
      const sp = this.spot;
      const v = this.view;
      if (!sp) { this.place(this.spotHost, []); this.spotHost.classList.remove('on'); return; }
      const item = (v.stack || []).find(s => s.id === sp.stackId);
      if (!item) { this.spot = null; this.place(this.spotHost, []); this.spotHost.classList.remove('on'); return; }
      const who = v.players.find(p => p.id === item.controller);
      const w = this.wrapFor('spot', 'spot-card');
      let body;
      if (item.kind !== 'ability' && item.objId) body = this.cardEl({ id: item.objId, card: item.card, zone: 'stack' });
      else body = this.staticCard(item.card) || this._abilityChip(item);
      const targets = (item.targets || []).map(t => this.targetName(t)).filter(Boolean);
      const verb = item.kind === 'ability' ? (sp.trigger ? 'triggers' : 'activates') : 'casts';
      this.place(w, [body]);
      this.place(this.spotHost, [
        w,
        el('div', { class: 'spot-cap' }, [
          el('div', { class: 'spot-who', text: `${who ? (who.id === this.meId ? 'You' : who.name) : 'Someone'} ${verb}` }),
          el('div', { class: 'spot-name', text: item.kind === 'ability' && item.card ? item.card.name : (item.name || (item.card ? item.card.name : '')) }),
          // (all of it: a long trigger, Emrakul's or Sen Triplets', is read here as it arrives)
          item.kind === 'ability' && item.abilityText ? el('div', { class: 'spot-ab', html: MTG.mana.textHtml(item.abilityText) }) : null,
          (item.modes || []).length ? el('div', { class: 'spot-ab', html: MTG.mana.textHtml(item.modes.join('; ')) }) : null,
          targets.length ? el('div', { class: 'spot-tg', text: 'targeting ' + targets.join(', ') }) : null,
        ].filter(Boolean)),
      ]);
      this.spotHost.classList.add('on');
    }

    /* ---- the dock: the button, the turn and the steps ---- */
    renderDock() {
      const v = this.view;
      const d = this.dock;
      if (!d._built) {
        d._built = true;
        // whose turn and its number: the steps bar's colour shows the one, pointing at it the other; read out, both
        d._turn = el('div', { class: 'dock-turn sr-only' });
        d._strip = el('div', { class: 'phase-strip', role: 'list', 'aria-label': 'Steps of the turn' });
        d._main = el('button', { type: 'button', class: 'big-btn', onclick: () => this.primaryAction() }, [
          el('span', { class: 'bb-label' }), el('span', { class: 'bb-sub' }),
          // the priority timer, running out along the button's foot
          el('span', { class: 'bb-timer', 'aria-hidden': 'true' }),
        ]);
        // an opponent's spell to answer: what it is, what it is aimed at, and what you could answer with
        d._respond = el('div', { class: 'dock-respond', hidden: true, role: 'status', 'aria-live': 'polite' });
        // anything you do at the table starts the timer again
        const bump = () => { if (d._timerKey) this._startPriorityTimer(d._timerSecs, d._timerKey); };
        this.arena.addEventListener('pointerdown', bump, true);
        this.arena.addEventListener('keydown', bump, true);
        // a second choice as big as the first, above it ("All attack" over "No attacks")
        d._above = el('button', { type: 'button', class: 'big-btn above', hidden: true, onclick: () => { if (d._above._fn) d._above._fn(); } }, [
          el('span', { class: 'bb-label' }), el('span', { class: 'bb-sub' }),
        ]);
        d._row = el('div', { class: 'dock-row' });
        d.append(d._turn, d._strip, d._respond, d._above, d._main, d._row);
      }
      const ap = v.players.find(p => p.id === v.activePlayer);
      const mine = v.activePlayer === this.meId;
      const turnSig = (ap ? ap.name : '') + '|' + mine + '|' + v.turn;
      if (d._turn._sig !== turnSig) {
        d._turn._sig = turnSig;
        d._turn.innerHTML = '';
        d._turn.append(
          el('span', { class: 'dt-who' + (mine ? ' mine' : ''), text: (mine ? 'Your turn' : `${possessive(ap ? ap.name : '—')} turn`) + ', ' }),
          el('span', { class: 'dt-n', text: 'turn ' + (v.turn || 1) }),
        );
      }
      this.renderStrip(d._strip);
      const act = this.primaryInfo();
      d._main.className = 'big-btn ' + (act.cls || '') + (d._timerKey ? ' timing' : '');
      d._main.disabled = !!act.disabled;
      d._main.querySelector('.bb-label').textContent = act.label;
      d._main.querySelector('.bb-sub').textContent = act.sub || '';
      d._main.title = act.title || '';
      this._renderRespond(d);
      /* The priority timer: only where passing is the natural thing to do
         and nothing is being chosen (an opponent's spell to answer or not, a
         step of their turn), never on your own main phases. A new moment
         starts it afresh. */
      const live0 = this.live || v;
      const secs = this.timerSecs();
      const want = act.timer && !act.disabled && secs > 0 && !v.replay && !v.spectating && !this.targeting && !this.paying;
      const key = want ? [live0.turn, live0.phase, live0.step, (live0.stack || []).map(s => s.id).join(','), live0.priorityPlayer].join('|') : null;
      if (key !== d._timerKey) {
        clearTimeout(d._timerT);
        d._timerKey = key;
        d._main.classList.remove('timing');
        if (key) this._startPriorityTimer(secs, key);
      }
      d._above.hidden = !act.above;
      if (act.above) {
        d._above.className = 'big-btn above ' + (act.above.cls || '');
        d._above.querySelector('.bb-label').textContent = act.above.label;
        d._above.querySelector('.bb-sub').textContent = act.above.sub || '';
        d._above._fn = act.above.fn;
      }

      d._row.innerHTML = '';
      const small = (text, title, fn, cls) => el('button', { type: 'button', class: 'dock-btn ' + (cls || ''), text, title, onclick: fn });
      const live = this.live || v;
      if (act.secondary) d._row.appendChild(small(act.secondary.label, act.secondary.title || '', act.secondary.fn, 'alt'));
      if (this.undoShown(live)) d._row.appendChild(small('↶ Undo', `Take back ${live.undoLabel || 'the last action'} (Ctrl+Z)`, () => this.send({ kind: 'undo' })));
      if (live.fullControl) {
        d._row.appendChild(small(live.fullControlSticky ? 'Full control • locked' : 'Full control', 'Nothing is passed for you. Ctrl toggles it, Ctrl+Shift locks it.',
          () => this.send({ kind: 'fullControl', on: false }), 'flagged'));
      }
      if (live.yielding) {
        d._row.appendChild(small(live.yielding === 'turn' ? 'Passing to end of turn' : live.yielding === 'batch' ? 'Resolving the rest' : 'Passing until a response', 'Click to take priority back',
          () => this.send({ kind: 'yield', mode: null }), 'flagged'));
      }
      const chip = this.autoChip(live);
      if (chip) d._row.appendChild(chip);
    }

    /**
     * What you answered once for the rest of the turn or of a batch (live.autoAnswers), as one small chip:
     * the answer and ✕ to be asked again; with more than one, how many, and a menu to take any of them back.
     */
    autoChip(live) {
      const list = live.autoAnswers || [];
      if (!list.length) return null;
      const one = list.length === 1;
      const chip = el('button', { type: 'button', class: 'dock-btn auto-chip',
        title: one ? `Answered for you: ${list[0].text}. Click to be asked again.` : list.map(a => a.text).join('\n'),
        'aria-label': one ? `Answered for you: ${list[0].text}. Ask me again` : `${list.length} answers given for you. Choose one to be asked again`,
        onclick: (e) => {
          if (one) return this.send({ kind: 'auto', act: 'clear', id: list[0].id });
          UI.contextMenu(e, list.map(a => [`Ask again: ${a.text}`, () => this.send({ kind: 'auto', act: 'clear', id: a.id })])
            .concat(['-', ['Ask again for all of them', () => this.send({ kind: 'auto', act: 'clear', id: 'all' })]]), { title: 'Answered for you' });
        } }, [
        el('span', { class: 'ac-k', text: 'auto' }),
        el('span', { class: 'ac-t', text: one ? list[0].text : `${list.length} answers` }),
        el('span', { class: 'ac-x', 'aria-hidden': 'true', text: one ? '✕' : '▾' }),
      ]);
      return chip;
    }

    /**
     * Three or more of your same trigger on the stack, the top one of them yours to resolve: let the rest
     * resolve without stopping ("Resolve the rest"), or — an optional one — say no to all of them ("Decline
     * the rest"). Neither while a question is asked or something is being aimed.
     */
    batchActions(live) {
      const st = live.stack || [];
      const top = st[st.length - 1];
      if (live.over || !top || !top.batch || top.controller !== this.meId || live.priorityPlayer !== this.meId || live.pendingChoice || this.targeting || live.yielding) return [];
      const n = st.filter(x => x.batch === top.batch).length;
      if (n < 2) return [];
      const name = (top.card && top.card.name) || String(top.name || '').split(' \u2014 ')[0];
      const out = [{ label: 'Resolve the rest', title: `Let the ${n} ${name} triggers resolve one after another. It stops if an opponent responds or one of them asks you something.`,
        fn: () => this.send({ kind: 'yield', mode: 'batch' }) }];
      const declined = (live.autoAnswers || []).some(a => a.batch === top.batch && a.kind === 'may');
      if (top.optional && !declined) out.push({ label: 'Decline the rest', title: `Say no to all ${n} of the ${name} triggers as they resolve`,
        fn: () => this.send({ kind: 'auto', act: 'decline', batch: top.batch }) });
      return out;
    }

    /**
     * How long the game waits before passing for you, in seconds (0: never). Against bots nobody is kept
     * waiting, so it is off unless you asked for it (botTimer); with people at the table, priorityTimer.
     */
    timerSecs() {
      const v = this.view;
      const people = (v.players || []).some(p => p.id !== this.meId && !p.isBot);
      const S = MTG.settings;
      return people ? (S.priorityTimer == null ? 15 : +S.priorityTimer) : (+S.botTimer || 0);
    }

    /**
     * Undo, when taking back is yours to do now: your own decision, something done this turn (not last turn's
     * play, nor the hand you kept), and not the pass that let an opponent's turn carry on (that would wind their
     * turn back).
     */
    undoShown(live) {
      if (!live.canUndo || live.over) return false;
      const ch = live.pendingChoice;
      const deciding = ch ? ch.playerId === this.meId && !ch.waiting : live.priorityPlayer === this.meId;
      if (!deciding) return false;
      if (live.undoTurn != null && live.undoTurn !== live.turn) return false;
      return live.activePlayer === this.meId || live.undoLabel !== 'passing';
    }

    /** The priority timer, from the top: it runs over `secs`, and then the button presses itself. Like Arena's
        rope it is only seen for the last few seconds (ROPE), burning down along the button's foot. */
    _startPriorityTimer(secs, key) {
      const d = this.dock;
      if (!d || !d._main) return;
      clearTimeout(d._timerT);
      d._timerSecs = secs;
      const ROPE = 6;
      d._main.style.setProperty('--t', Math.min(secs, ROPE) + 's');
      d._main.style.setProperty('--t-wait', Math.max(0, secs - ROPE) + 's');
      d._main.classList.remove('timing');
      void d._main.offsetWidth;   // the bar starts again from full
      d._main.classList.add('timing');
      d._timerT = setTimeout(() => {
        if (d._timerKey !== key || this.targeting || this.paying || d._main.disabled) return;
        d._timerKey = null;
        d._main.classList.remove('timing');
        this.primaryAction();
      }, secs * 1000);
    }

    /**
     * An opponent's spell or ability waiting on you: it slides in over the
     * button, the card, who it is from and what it is aimed at, and under it
     * whatever you could answer it with, each a click to cast or use.
     */
    _renderRespond(d) {
      const v = this.view, live = this.live || v;
      const top = (live.stack || [])[(live.stack || []).length - 1];
      const ch = live.pendingChoice;
      const show = !!top && top.controller !== this.meId && live.priorityPlayer === this.meId && !ch && !this.targeting && !this.paying && !v.replay;
      const playable = show ? (live.playable || []).filter(id => {
        const o = this.objIn(id);
        return o && !/\bLand\b/.test((o.card && o.card.type_line) || '') && (o.zone === 'hand' || o.zone === 'battlefield' || o.zone === 'command' || o.zone === 'graveyard' || o.zone === 'exile');
      }) : [];
      const sig = show ? top.id + '|' + playable.join(',') : '';
      if (d._respond._sig === sig) return;
      d._respond._sig = sig;
      d._respond.hidden = !show;
      d._respond.innerHTML = '';
      if (!show) return;
      const who = v.players.find(p => p.id === top.controller);
      const card = top.card || ((this.objIn(top.objId) || {}).card) || null;
      const aims = (top.targets || []).map(tg => tg.kind === 'player'
        ? (tg.id === this.meId ? 'you' : ((v.players.find(p => p.id === tg.id) || {}).name || 'a player'))
        : tg.kind === 'object' ? (((this.objIn(tg.id) || {}).card || {}).name || 'a permanent') : 'a spell');
      const art = el('span', { class: 'dr-art', 'aria-hidden': 'true' });
      if (card && UI.setArt) UI.setArt(art, card);
      const head = el('div', { class: 'dr-head' }, [
        art,
        el('div', { class: 'dr-text' }, [
          el('span', { class: 'dr-who', text: `${who ? who.name : 'An opponent'} ${top.kind === 'spell' || !top.kind ? 'casts' : 'uses'}` }),
          el('b', { class: 'dr-name', text: this.stackName(top) || (card && card.name) || 'something' }),
          aims.length ? el('span', { class: 'dr-aim', text: '\u2192 ' + aims.join(', ') }) : null,
        ].filter(Boolean)),
      ]);
      if (card) UI.attachPreview(head, card, 0);
      d._respond.appendChild(head);
      if (playable.length) {
        d._respond.appendChild(el('div', { class: 'dr-could', text: 'You could respond with' }));
        d._respond.appendChild(el('div', { class: 'dr-row' }, playable.slice(0, 6).map((id) => {
          const o = this.objIn(id);
          const b = el('button', { type: 'button', class: 'dr-opt', title: o.card.name, onclick: (e) => {
            e.stopPropagation();
            const node = this.els && this.els.get(id);
            this.onCardClick(id, e, node || null);
          } }, [el('span', { class: 'dr-opt-art', 'aria-hidden': 'true' }), el('span', { class: 'dr-opt-name', text: o.card.name })]);
          if (UI.setArt) UI.setArt(b.firstChild, o.card);
          UI.attachPreview(b, o.card, 0);
          return b;
        })));
      }
    }

    renderStrip(host) {
      const v = this.view;
      const cur = stepKey(v);
      const order = STRIP.map(s => s[0]);
      const at = order.indexOf(cur === 'firstStrikeDamage' ? 'combatDamage' : cur === 'endCombat' ? 'combatDamage' : cur === 'cleanup' ? 'end' : cur);
      const stops = MTG.settings.stops || MTG.DEFAULT_STOPS;
      const mineNow = v.activePlayer === this.meId;
      const stoppable = new Set(MTG.STOP_STEPS.map(([k]) => k));
      const sig = cur + '|' + mineNow + '|' + v.turn + '|' + JSON.stringify(stops);
      if (host._sig === sig) return;
      host._sig = sig;
      host.innerHTML = '';
      // whose turn it is, in the bar's colour; which turn, when it is pointed at
      const ap = (v.players || []).find(p => p.id === v.activePlayer);
      const turnWords = `Turn ${v.turn || 1} \u00b7 ${mineNow ? 'your turn' : possessive(ap ? ap.name : 'their') + ' turn'}`;
      host.classList.toggle('theirs', !mineNow);
      host.setAttribute('aria-label', 'Steps of the turn. ' + turnWords);
      STRIP.forEach(([key, label], i) => {
        const side = mineNow ? 'yours' : 'theirs';
        const stop = !!((stops[side] || {})[key]);
        const stopNote = stoppable.has(key) ? `${stop ? 'The game stops here' : 'Passed through'} on ${mineNow ? 'your' : 'their'} turn. Click to change.` : '';
        const b = el('button', {
          type: 'button', role: 'listitem',
          class: 'ps' + (i === at ? ' now' : i < at ? ' done' : '') + (stop ? ' stop' : ''),
          'aria-label': `${STEP_WORDS[key] || label}. ${PHASE_HELP[key] || ''} ${stopNote}`,
          onclick: () => { if (stoppable.has(key)) this.toggleStop(mineNow ? 'yours' : 'theirs', key); },
        }, [el('i'), el('span', { text: label })]);
        // what the step is for, in a sentence, while you point at it
        const tip = () => this.showTip(b, `<b class="tip-head">${escapeHtml(STEP_WORDS[key] || label)}${i === at ? ' · now' : ''}</b>` +
          `${escapeHtml(PHASE_HELP[key] || '')}${stopNote ? `<span class="tip-note">${escapeHtml(stopNote)}</span>` : ''}` +
          `<span class="tip-note">${escapeHtml(turnWords)}</span>`, { cls: 'step' });
        b.addEventListener('pointerenter', (e) => { if (e.pointerType !== 'touch') tip(); });
        b.addEventListener('focus', tip);
        b.addEventListener('pointerleave', () => this.hideTip());
        b.addEventListener('blur', () => this.hideTip());
        host.appendChild(b);
      });
    }

    toggleStop(side, key) {
      const stops = JSON.parse(JSON.stringify(MTG.settings.stops || MTG.DEFAULT_STOPS));
      stops[side] = stops[side] || {};
      if (stops[side][key]) delete stops[side][key]; else stops[side][key] = true;
      MTG.setSetting('stops', stops);
      this.send({ kind: 'autoPass', cfg: MTG.autoPassConfig() });
      MTG.sfx('click');
      this.dock._strip._sig = null;
      this.renderStrip(this.dock._strip);
    }

    /**
     * What the big button does right now, and what it says. The button is
     * the one place the table tells you what will happen next, so the label
     * is never "OK": it names the step it moves you to or the thing it
     * confirms.
     * @this {MTG.TableInstance}
     */
    primaryInfo() {
      const v = this.view, live = this.live || v;
      if (v.over) return { label: 'Game over', disabled: true, cls: 'idle' };
      if (v.spectating || v.replay || !this.me) return { label: v.replay ? 'Replay' : 'Watching', disabled: true, cls: 'idle' };
      if (v.mulliganPhase) return { label: 'Mulligan', disabled: true, cls: 'idle', sub: 'choose your opening hand' };
      // Mindslaver: somebody else is making your decisions this turn
      const by = this.controlledNow();
      if (by) return { label: 'Waiting', disabled: true, cls: 'idle wait', sub: `${by.name} is controlling you` };
      // …or the decision is one you make for a player you control, from their seat
      const cd = this._ctlDecider();
      if (cd) return { label: `Act as ${cd.name}`, cls: 'go', sub: `${possessive(cd.name)} decision to make` };
      if (this.targeting) {
        const t = this.targeting;
        const upTo = (t.specs || []).some(sp => sp && sp.upTo);
        // strive and "X targets": not done until the first ones are chosen
        const short = (t.minChosen || 0) - t.chosen.length;
        if (upTo && short > 0) return { label: `Choose ${short} more`, disabled: true, cls: 'idle', sub: t.label,
          secondary: { label: 'Cancel', fn: () => { this.cancelTargeting(); this.render(); } } };
        if (upTo) return { label: t.chosen.length ? 'Done' : 'No targets', cls: 'go', sub: t.label };
        return { label: 'Choose a target', disabled: true, cls: 'idle', sub: t.label,
          secondary: t.legal ? null : { label: 'Cancel', fn: () => { this.cancelTargeting(); this.render(); } } };
      }
      // creatures tapped to convoke: done, or the game picks them
      if (this.convoking) {
        const n = this.convoking.picks.length;
        return { label: 'Done', cls: 'go', sub: n ? `${n} tapping` : '', title: n ? `Cast it, ${n} tapping for it (Space)` : 'Cast it; the game picks what taps (Space)',
          secondary: { label: 'Cancel', title: 'Leave it in your hand (Esc)', fn: () => this.convokeCancel() } };
      }
      // a spell waiting for you to tap lands: or the game taps the rest
      if (this.paying) return { label: 'Pay for me', cls: 'go',
        title: 'Let the game tap lands for the rest of the cost (Space)',
        secondary: { label: 'Cancel', title: 'Leave it for now (Esc)', fn: () => this.cancelPay() } };
      const ch = live.pendingChoice;
      if (ch && ch.playerId === this.meId && !ch.waiting) {
        if (ch.type === 'declareAttackers') {
          const n = this.attackPlan ? this.attackPlan.declarations.length : 0;
          const all = (ch.candidates || []).length;
          return {
            label: n ? `Attack` : 'No attacks', sub: n > 1 ? `${n} attackers` : '',
            cls: n ? 'go attack' : 'pass',
            // everything in at once, as big a choice as attacking with none ("Attack", when there is one to send)
            above: n < all ? { label: all === 1 ? 'Attack' : 'All attack', cls: 'go attack', fn: () => this.attackAll(ch),
              title: all === 1 ? 'Attack with your creature' : `Attack with all ${all} of your creatures` } : null,
            secondary: n ? { label: 'Clear', fn: () => { this.attackPlan.declarations = []; this.render(); } } : null,
          };
        }
        if (ch.type === 'declareBlockers') {
          const n = this.blockPlan ? this.blockPlan.declarations.length : 0;
          /* what gets through would end the game for you: said in red, and pressing takes a second press */
          const lethal = this.lethalBlocks(ch);
          if (lethal && this._lethalArmed === lethal.key) return { label: n ? 'Block anyway' : 'No blocks', sub: 'press again', cls: 'pass lethal armed',
            title: `${lethal.through} damage gets through and you have ${lethal.life} life. Press again to confirm.` };
          return { label: n ? 'Block' : 'No blocks', sub: lethal ? 'Lethal' : n > 1 ? `${n} blockers` : '',
            cls: (n ? 'go block' : 'pass') + (lethal ? ' lethal' : ''),
            title: lethal ? `${lethal.through} damage gets through and you have ${lethal.life} life` : '',
            secondary: n ? { label: 'Clear', fn: () => { this.blockPlan = { declarations: [], pendingBlocker: null }; this.render(); } } : null };
        }
        if (ch.type === 'discard' || ch.type === 'discardToHandSize') {
          const need = ch.count || 1;
          // (Ormos, Archive Keeper: "cards with different names")
          const names = ch.differentNames ? this.discardSel.map(id => (this.objIn(id) || {}).name) : [];
          if (new Set(names).size !== names.length) return { label: 'Discard', sub: 'They must all have different names.', cls: 'go', disabled: true };
          return { label: 'Discard', sub: `${this.discardSel.length}/${need} chosen`, cls: 'go', disabled: this.discardSel.length !== need };
        }
        if (this.chooseHere(ch)) return this.choosePrimary(ch);
        if (ch.type === 'sacrifice') {
          const need = ch.count || 1;
          return { label: ch.exileInstead ? 'Exile' : 'Sacrifice', sub: `${this.sacSel.length}/${need} chosen`, cls: 'go', disabled: this.sacSel.length !== need };
        }
        return { label: 'Decide', disabled: true, cls: 'idle', sub: 'answer the question above' };
      }
      if (ch && ch.waiting) {
        const who = v.players.find(p => p.id === ch.playerId);
        // (Mindslaver: a controlled player's decisions are their controller's to make)
        const by = who && who.controlledBy ? v.players.find(p => p.id === who.controlledBy) : null;
        return { label: 'Waiting', disabled: true, cls: 'idle wait', sub: by ? `${by.name} is deciding for ${who.name}` : `${who ? who.name : 'someone'} is deciding` };
      }
      if (live.priorityPlayer !== this.meId) {
        const pp = v.players.find(p => p.id === live.priorityPlayer);
        return { label: v.activePlayer === this.meId ? 'Waiting' : 'Their turn', disabled: true, cls: 'idle wait',
          sub: pp ? `${pp.name} ${pp.isBot ? 'is thinking' : 'has priority'}` : '' };
      }
      if ((live.stack || []).length) {
        const top = live.stack[live.stack.length - 1];
        const mine = top.controller === this.meId;
        // someone else's spell: you are being asked whether to answer it
        // (someone else's: the panel above the button says what it is)
        return { label: 'Resolve', cls: mine ? 'go' : 'pass respond', sub: mine ? this.stackName(top) : '', timer: !mine,
          title: 'Let the top of the stack resolve (Space)',
          secondary: { label: 'Pass until response', title: 'Keep passing until somebody adds to the stack (Enter)', fn: () => this.send({ kind: 'yield', mode: 'response' }) } };
      }
      const k = stepKey(live);
      const myTurn = live.activePlayer === this.meId;
      if (myTurn && k === 'main1') {
        const could = live.battlefield.some(o => o.controller === this.meId && o.power != null && !o.tapped && !o.summoningSick && o.power > 0);
        return could
          ? { label: 'Attack', cls: 'go', title: 'Go to combat and choose attackers (Space)', secondary: { label: 'End turn', title: 'Pass to the end of the turn (Shift+Enter)', fn: () => this.send({ kind: 'yield', mode: 'turn' }) } }
          : { label: 'End turn', cls: 'go', title: 'Nothing of yours can attack: pass to the next player (Space)', yieldTurn: true };
      }
      if (myTurn && k === 'main2') return { label: 'End turn', cls: 'go', title: 'Pass to the next player (Space)' };
      if (!myTurn) return { label: 'Pass', cls: 'pass', title: `Let them carry on${STEP_WORDS[k] ? ' from ' + STEP_WORDS[k].toLowerCase() : ''} (Space)`, timer: true,
        secondary: { label: 'Pass turn', title: 'Take no more actions this turn (Shift+Enter)', fn: () => this.send({ kind: 'yield', mode: 'turn' }) } };
      return { label: 'Next', cls: 'pass', title: STEP_WORDS[k] ? `On from ${STEP_WORDS[k].toLowerCase()} (Space)` : '' };
    }

    /** @this {MTG.TableInstance} */
    primaryAction() {
      const v = this.view, live = this.live || v;
      if (!v || v.over || v.mulliganPhase || this.controlledNow()) return;
      const cd = this._ctlDecider();
      if (cd) { this.actAs(cd.id); return; }
      if (this.targeting) {
        const t = this.targeting;
        if ((t.specs || []).some(sp => sp && sp.upTo) && t.chosen.length >= (t.minChosen || 0)) { this.targeting = null; t.onDone(t.chosen); this.render(); }
        return;
      }
      if (this.convoking) { this.convokeDone(false); return; }
      if (this.paying) { this.payForMe(); return; }
      const ch = live.pendingChoice;
      if (ch && ch.playerId === this.meId && !ch.waiting) {
        if (ch.type === 'declareAttackers') {
          this.send({ kind: 'declareAttackers', declarations: (this.attackPlan || { declarations: [] }).declarations });
          this.attackPlan = null;
          return;
        }
        if (ch.type === 'declareBlockers') {
          const lethal = this.lethalBlocks(ch);
          if (lethal && this._lethalArmed !== lethal.key) { this._lethalArmed = lethal.key; MTG.sfx('click'); this.render(); return; }
          this._lethalArmed = null;
          this.send({ kind: 'declareBlockers', declarations: (this.blockPlan || { declarations: [] }).declarations });
          this.blockPlan = null;
          return;
        }
        if ((ch.type === 'discard' || ch.type === 'discardToHandSize') && this.discardSel.length === (ch.count || 1)) {
          this.send({ kind: 'choice', data: { cardIds: this.discardSel.slice() } });
          this.discardSel = [];
          return;
        }
        if (this.chooseHere(ch)) { this.chooseConfirm(ch); return; }
        if (ch.type === 'sacrifice' && this.sacSel.length === (ch.count || 1)) {
          this.send({ kind: 'choice', data: { cardIds: this.sacSel.slice() } });
          this.sacSel = [];
        }
        return;
      }
      if (live.priorityPlayer !== this.meId) return;
      const info = this.primaryInfo();
      if (info.yieldTurn) { this.send({ kind: 'yield', mode: 'turn' }); return; }
      this.send({ kind: 'pass' });
    }

    /**
     * Your blockers question, when the attackers that get through as the blocks stand now would deal you at least
     * your life: { through, life, key } (key: these blocks, so a change of blocks asks again), else null. Combat
     * damage only, as printed on the table: trample, lifelink and the like are not worked out.
     */
    lethalBlocks(ch) {
      const me = this.me;
      if (!ch || ch.type !== 'declareBlockers' || ch.playerId !== this.meId || ch.blockingPlayer || !me) return null;
      const blocked = new Set([].concat(...((this.blockPlan && this.blockPlan.declarations) || []).map(d => d.attackerIds || [d.attackerId])));
      let through = 0;
      for (const id of ch.attackers || []) {
        const o = this.objIn(id);
        if (!o || blocked.has(id) || (o.attacking && o.attacking !== this.meId)) continue;
        through += Math.max(0, o.power || 0);
      }
      if (!through || through < me.life) return null;
      return { through, life: me.life, key: (ch.attackers || []).join(',') + '|' + [...blocked].sort().join(',') };
    }

    attackAll(ch) {
      if (!this.attackPlan) this.attackPlan = { declarations: [], defenderId: this._defaultDefender(ch), pending: null };
      // everything not already sent somewhere goes at the one in view (or the last one chosen)
      const plan = this.attackPlan;
      const sent = new Set(plan.declarations.map(d => d.attackerId));
      for (const id of ch.candidates) if (!sent.has(id)) plan.declarations.push({ attackerId: id, defenderId: plan.defenderId });
      plan.pending = null;
      MTG.sfx('ui_attack');
      this.render();
    }

    /** Who an attacker goes at unless told otherwise: the opponent whose board is in view, else the first who can be attacked. */
    _defaultDefender(ch) {
      const defs = ch.defenders || [];
      return (defs.find(d => d.id === this.focusSeat) || defs[0] || {}).id;
    }

    /** An attacker sent at a player, planeswalker or battle: the arrow goes in, and that one is the default for the next. */
    _attackAt(attackerId, defenderId) {
      const plan = this.attackPlan;
      if (!plan || !attackerId || !defenderId) return;
      plan.declarations = plan.declarations.filter(d => d.attackerId !== attackerId);
      plan.declarations.push({ attackerId, defenderId });
      plan.defenderId = defenderId;
      plan.pending = null;
      MTG.sfx('ui_attack');
    }

    /* ---- the marks that say what you can do with each card ---- */
    /** @this {MTG.TableInstance} */
    markInteractive() {
      const v = this.view, live = this.live || v;
      const ready = this._ready();
      const playable = new Set(ready ? (live.playable || []) : []);
      const ch = ready && live.pendingChoice && live.pendingChoice.playerId === this.meId && !live.pendingChoice.waiting ? live.pendingChoice : null;
      const atk = this.attackPlan ? new Set(this.attackPlan.declarations.map(d => d.attackerId)) : null;
      const blk = this.blockPlan ? new Set(this.blockPlan.declarations.map(d => d.blockerId)) : null;
      // a spell waiting for mana: it is marked, and what could tap to pay for it glows
      // (and a question about Treasures the game would sacrifice for you: those glow — sacMana)
      const paySrc = this.paying && ready ? new Set(this.manaSources().map(o => o.id))
        : ch && ch.sacMana && Array.isArray(ch.sacMana.ids) ? new Set(ch.sacMana.ids) : null;
      // creatures tapped to convoke: what each pays, on the card
      const conv = this.convoking ? this.convokeSums() : null;
      for (const [id, n] of this.els) {
        const loc = n.parentElement;
        const inHand = !!(loc && loc.classList.contains('hslot'));
        n.classList.toggle('playable', playable.has(id) && !this.targeting && !ch && !this.paying && !this.convoking);
        n.classList.toggle('pay-source', !!(paySrc && paySrc.has(id)));
        n.classList.toggle('paying', !!(this.paying && this.paying.objId === id));
        let target = false, cand = false, chosen = false;
        if (this.targeting) {
          const o = this.objIn(id);
          target = !!(o && o.zone === 'battlefield' && this.isTargetable(o));
          if (!o) { const loc = this.locate(id); if (loc && loc.zone === 'stack' && loc.item) target = this.isTargetableStack(loc.item); }
          if (this.targeting.chosen.some(t => t.id === id)) chosen = true;
        } else if (conv) {
          cand = this.convoking.cand.has(id) && !!this.objIn(id);
          chosen = conv.pays.has(id);
        } else if (ch) {
          if (ch.type === 'declareAttackers') { cand = (ch.candidates || []).includes(id); chosen = !!(atk && atk.has(id)); }
          else if (ch.type === 'declareBlockers') {
            cand = (ch.candidates || []).includes(id) || (!!this.blockPlan && !!this.blockPlan.pendingBlocker && (ch.attackers || []).includes(id));
            chosen = !!(blk && blk.has(id)) || (this.blockPlan && this.blockPlan.pendingBlocker === id);
          } else if (ch.type === 'sacrifice') {
            const o = this.objIn(id);
            cand = !!(o && o.zone === 'battlefield' && o.controller === this.meId);
            chosen = this.sacSel.includes(id);
          } else if (ch.type === 'discard' || ch.type === 'discardToHandSize') {
            cand = inHand; chosen = this.discardSel.includes(id);
          } else if (this.chooseHere(ch)) {
            ({ cand, chosen } = this.chooseMark(ch, id));
          }
        }
        n.classList.toggle('targetable', target);
        n.classList.toggle('candidate', cand && !chosen);
        n.classList.toggle('chosen', chosen);
        this._convokeMark(n, conv && chosen ? conv.pays.get(id) : null);
        n.classList.toggle('declared-atk', !!(atk && atk.has(id)));
        n.classList.toggle('declared-blk', !!(blk && blk.has(id)));
      }
      // a player you could point at glows
      for (const orb of this.arena.querySelectorAll('.life-orb')) {
        const p = v.players.find(x => x.id === orb.dataset.player);
        const pick = p ? this.chooseOrb(p.id) : {};
        orb.classList.toggle('targetable', !!(p && (this.isTargetablePlayer(p) || (pick.cand && !pick.chosen))));
        orb.classList.toggle('chosen', !!pick.chosen);
      }
      this.handHost.classList.toggle('choosing', !!(ch && (ch.type === 'discard' || ch.type === 'discardToHandSize')));
      this.markCombat();
    }

    /** The symbol a creature tapped to convoke pays, on its card ({G}, or {1}); null takes it off. */
    _convokeMark(n, sym) {
      let tag = n._convokeTag;
      if (!sym) { if (tag) { tag.remove(); n._convokeTag = null; } n.classList.remove('convoking'); return; }
      if (!tag) { tag = n._convokeTag = el('div', { class: 'cv-convoke', 'aria-hidden': 'true' }); }
      if (tag._sym !== sym) { tag._sym = sym; tag.innerHTML = MTG.mana.html('{' + sym + '}'); }
      if (tag.parentElement !== n) n.appendChild(tag);
      n.classList.add('convoking');
    }

    /* ---------------- input ---------------- */
    /** @this {MTG.TableInstance} */
    _wireInput() {
      const a = this.arena;
      a.addEventListener('click', (e) => {
        if (this._suppressClick) { this._suppressClick = false; return; }
        const orb = e.target.closest('.life-orb');
        if (orb) { this.onOrbClick(orb.dataset.player, e); return; }
        const cv = e.target.closest('.cv');
        if (cv && a.contains(cv)) { this.onCardClick(cv.dataset.id, e, cv); return; }
        const onStack = this.targeting && e.target.closest('[data-stack]');
        if (onStack) { this.aimAtStack(onStack.dataset.stack); return; }
        const chip = e.target.closest('.ability-chip');
        if (chip) return;
        if (this._popover && !e.target.closest('.arena-pop')) this.closePopover();
      });
      a.addEventListener('contextmenu', (e) => {
        const cv = e.target.closest('.cv');
        if (!cv) return;
        e.preventDefault();
        /* A card in your hand is read on a right-click: it is what you are
           deciding whether to play. What else it can do (cycling, plot,
           suspend, a face-down cast) waits under Actions in that view. */
        const loc = this.locate(cv.dataset.id);
        if (loc && loc.zone === 'hand' && loc.player === this.meId) { this.showCard(cv.dataset.id, { actions: true }); return; }
        this.cardMenu(cv.dataset.id, e);
      });
      a.addEventListener('dblclick', (e) => {
        const cv = e.target.closest('.cv');
        if (cv) this.showCard(cv.dataset.id);
      });
      // hover: the side preview for the board and the stack, a lift for the hand
      a.addEventListener('pointerover', (e) => {
        if (e.pointerType === 'touch') return;
        const cv = e.target.closest('.cv');
        const chip = e.target.closest('.ability-chip, .hist-item');
        if (cv) this.hoverCard(cv, e);
        // (an ability on the stack: the card it came from, with the ability's words)
        else if (chip && (chip.dataset.preview || chip.dataset.stack)) this.hoverCard(chip, e);
      });
      a.addEventListener('pointerout', (e) => {
        const cv = e.target.closest('.cv, .ability-chip, .hist-item');
        if (!cv) return;
        if (e.relatedTarget && cv.contains(e.relatedTarget)) return;
        this.unhoverCard(cv);
      });
      a.addEventListener('pointerdown', (e) => this.onPointerDown(e));
      /* Every card can be reached with Tab: Enter does what a click would,
         I reads it at full size, and the menu key opens everything else. */
      a.addEventListener('keydown', (e) => {
        const cv = e.target.closest && e.target.closest('.cv');
        if (!cv || e.target !== cv) return;
        if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); this.onCardClick(cv.dataset.id, e, cv); }
        else if (e.key.toLowerCase() === 'i') { e.preventDefault(); e.stopPropagation(); this.showCard(cv.dataset.id); }
        else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
          e.preventDefault(); e.stopPropagation();
          const r = cv.getBoundingClientRect();
          this.cardMenu(cv.dataset.id, { clientX: r.right, clientY: r.top, preventDefault() {} });
        }
      });
      this._onAimMove = (e) => {
        this._pointer = U.pt(e);
        if (this.targeting || (this.blockPlan && this.blockPlan.pendingBlocker) || (this.attackPlan && this.attackPlan.pending)) this.renderArrows();
      };
      document.addEventListener('pointermove', this._onAimMove, { passive: true });
      // touch: hold a card to read it
      let lp = null;
      a.addEventListener('touchstart', (e) => {
        const cv = e.target.closest('.cv');
        if (!cv) return;
        const t = e.touches[0];
        lp = { x: t.clientX, y: t.clientY, timer: setTimeout(() => { lp = null; this._suppressClick = true; this.showCard(cv.dataset.id); }, 430) };
      }, { passive: true });
      const cancel = (e) => {
        if (!lp) return;
        const t = e.touches && e.touches[0];
        if (e.type === 'touchmove' && t && Math.hypot(t.clientX - lp.x, t.clientY - lp.y) < 9) return;
        clearTimeout(lp.timer); lp = null;
      };
      a.addEventListener('touchmove', cancel, { passive: true });
      a.addEventListener('touchend', cancel);
      a.addEventListener('touchcancel', cancel);
    }

    /**
     * Drag a card out of your hand and let go over the table to play it —
     * the gesture every digital card game has taught people. A click still
     * works; the drag is there because it is what a hand reaches for.
     */
    onPointerDown(e) {
      if (e.button !== 0) return;
      const cv = e.target.closest('.hslot .cv');
      if (!cv || !this._ready()) return;
      const slot = cv.parentElement;
      const id = cv.dataset.id;
      const start = U.pt(e);
      let dragging = false;
      const move = (ev) => {
        const at = U.pt(ev);
        const dx = at.x - start.x, dy = at.y - start.y;
        if (!dragging && Math.hypot(dx, dy) > 10) {
          dragging = true;
          slot.classList.add('dragging');
          this.hidePreview();
          this.hideTip();
        }
        if (dragging) {
          slot.style.setProperty('--dx', dx + 'px');
          slot.style.setProperty('--dy', dy + 'px');
          const over = at.y < U.rect(this.handHost).top - 30;
          slot.classList.toggle('will-play', over && (this.live.playable || []).includes(id));
        }
      };
      const up = (ev) => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        if (!dragging) return;
        this._suppressClick = true;
        setTimeout(() => { this._suppressClick = false; }, 0);
        const at = U.pt(ev);
        const over = at.y < U.rect(this.handHost).top - 30;
        slot.classList.remove('dragging', 'will-play');
        if (over) {
          const o = this.objIn(id);
          if (o) {
            // let the card stay where it was dropped while the play is worked out
            this._dropAt = { id, x: at.x, y: at.y };
            this.playFromHand(o);
          }
        }
        slot.style.removeProperty('--dx');
        slot.style.removeProperty('--dy');
      };
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    }

    /** @this {MTG.TableInstance} */
    onOrbClick(pid, e) {
      if (this.targeting) {
        const p = this.view.players.find(x => x.id === pid);
        if (p && this.isTargetablePlayer(p)) return this.aimAtPlayer(pid);
        return UI.error('Not a legal target for that.');
      }
      if (this._ready() && this.choosePlayer(pid)) return;
      const ch = this.live && this.live.pendingChoice;
      if (ch && ch.type === 'declareAttackers' && ch.playerId === this.meId && this.attackPlan) {
        // pointing at a player chooses who the next attackers go at
        const d = (ch.defenders || []).find(x => x.id === pid);
        if (d) {
          if (this.attackPlan.pending) this._attackAt(this.attackPlan.pending, pid);
          else this.attackPlan.defenderId = pid;
          this.render(); return;
        }
      }
      // an opponent's portrait: who they are, for a moment (what the seat no longer prints: a bot's level and
      // style, and the sizes of their hand and library)
      if (pid !== this.meId) this.seatTip(pid, e && e.target && e.target.closest ? e.target.closest('.life-orb') : null);
      if (pid !== this.meId && this._opponents().length > 1) this.setFocus(pid);
      // your own portrait, with nothing else to do: your name and picture
      else if (pid === this.meId && !this.view.spectating && MTG.app && MTG.app.editProfile) MTG.app.editProfile();
    }

    /** @this {MTG.TableInstance} */
    onCardClick(id, e, node) {
      const loc = this.locate(id);
      if (!loc) return;
      this.closePopover();
      const live = this.live || this.view;
      if (this.targeting) {
        if (loc.zone === 'stack' && loc.item) return this.aimAtStack(loc.item.id);
        if (loc.zone !== 'battlefield') return;
        if (!this.isTargetable(loc.o)) return UI.error('Not a legal target for that.');
        this.targeting.chosen.push({ kind: 'object', id });
        MTG.sfx('click');
        if (this.targeting.chosen.length >= this.targeting.need) {
          const t = this.targeting; this.targeting = null; t.onDone(t.chosen);
        }
        return this.render();
      }
      // tapping creatures for a spell: they are clicked where they stand; the spell clicked again goes back
      if (this.convoking) {
        if (this.convokeToggle(id)) return;
        if (id === this.convoking.steps.o.id) return this.convokeCancel();
        if (loc.zone === 'battlefield') UI.error('That cannot be tapped to pay for it.');
        return;
      }
      if (!this._ready()) return;
      const ch = live.pendingChoice;
      if (ch && ch.playerId === this.meId && !ch.waiting) {
        if ((ch.type === 'discard' || ch.type === 'discardToHandSize') && loc.zone === 'hand' && loc.player === this.meId) {
          if ((ch.count || 1) === 1) { this.discardSel = []; return this.send({ kind: 'choice', data: { cardIds: [id] } }); }
          toggleIn(this.discardSel, id, ch.count);
          return this.render();
        }
        if (this.chooseHere(ch) && this.chooseClick(ch, id)) return;
        if (ch.type === 'sacrifice' && loc.zone === 'battlefield' && loc.o.controller === this.meId) {
          if ((ch.count || 1) === 1) { this.sacSel = []; return this.send({ kind: 'choice', data: { cardIds: [id] } }); }
          toggleIn(this.sacSel, id, ch.count);
          return this.render();
        }
        if (ch.type === 'declareAttackers') {
          const defs = ch.defenders || [];
          if (!this.attackPlan) this.attackPlan = { declarations: [], defenderId: this._defaultDefender(ch), pending: null };
          const plan = this.attackPlan;
          // an attacker picked up, and a planeswalker or battle pointed at: it goes there
          if (plan.pending && defs.some(d => d.id === id)) { this._attackAt(plan.pending, id); return this.render(); }
          if ((ch.candidates || []).includes(id)) {
            const i = plan.declarations.findIndex(d => d.attackerId === id);
            // one already going in: clicked again, it stays home
            if (i >= 0) { plan.declarations.splice(i, 1); if (plan.pending === id) plan.pending = null; return this.render(); }
            // only one thing to attack: it goes straight at it
            if (defs.length <= 1) { this._attackAt(id, (defs[0] || {}).id); return this.render(); }
            /* more than one: it is picked up, an arrow follows the pointer,
               and the player at the top (or a planeswalker) clicked next is
               what it attacks; clicked again, it is put down */
            plan.pending = plan.pending === id ? null : id;
            MTG.sfx('click');
            return this.render();
          }
        }
        if (ch.type === 'declareBlockers') {
          if (!this.blockPlan) this.blockPlan = { declarations: [], pendingBlocker: null };
          const bp = this.blockPlan;
          // (Odric, Master Tactician: another player's creatures, blocking as this player says — blockingPlayer)
          if ((ch.candidates || []).includes(id) && loc.o.controller === (ch.blockingPlayer || this.meId)) {
            // clicking a blocker that is already assigned takes the block back
            const had = bp.declarations.findIndex(d => d.blockerId === id);
            if (had >= 0 && bp.pendingBlocker !== id) { bp.declarations.splice(had, 1); bp.pendingBlocker = null; return this.render(); }
            bp.pendingBlocker = bp.pendingBlocker === id ? null : id;
            /* With only one attacker there is nothing to choose between:
               picking the blocker is the whole decision. */
            if (bp.pendingBlocker && (ch.attackers || []).length === 1) {
              bp.declarations.push({ blockerId: id, attackerIds: [ch.attackers[0]] });
              bp.pendingBlocker = null;
              MTG.sfx('ui_block');
            }
            return this.render();
          }
          if (bp.pendingBlocker && (ch.attackers || []).includes(id)) {
            const existing = bp.declarations.find(d => d.blockerId === bp.pendingBlocker);
            if (existing) existing.attackerIds = [id];
            else bp.declarations.push({ blockerId: bp.pendingBlocker, attackerIds: [id] });
            bp.pendingBlocker = null;
            MTG.sfx('ui_block');
            return this.render();
          }
        }
        return;
      }
      // the spell waiting for mana, clicked again: it goes back to waiting in your hand
      if (this.paying && this.paying.objId === id && loc.zone !== 'battlefield') return this.cancelPay();
      if (loc.zone === 'hand' && loc.player === this.meId) return this.playFromHand(loc.o);
      // Sen Triplets: a card in another player's revealed hand that you may cast or play this turn
      if (loc.zone === 'hand' && (live.playable || []).includes(id)) return this.playFromHand(loc.o);
      if (loc.zone === 'exile' && loc.player === this.meId && (live.playable || []).includes(id)) {
        return ((live.uses || {})[id] || []).length ? this.cardMenu(id, e) : this.playFromHand(loc.o);
      }
      // flashback and the like, or The Great Work's leave into any graveyard: the ways to cast it from there
      if (loc.zone === 'graveyard' && (live.playable || []).includes(id) && ((live.uses || {})[id] || []).length) return this.cardMenu(id, e);
      if (loc.zone === 'command' && loc.player === this.meId) {
        // a companion: {3} to put it into your hand, when that can be done now (CR 702.139)
        if (loc.o.companion) return (live.playable || []).includes(id) ? this.useCompanion(loc.o) : this.showCard(id);
        /* More than the ordinary cast to offer from here (Derevi's ability from
           the command zone, Yuriko's commander ninjutsu): the card's own menu
           offers each, the cast first */
        const more = this._commandZoneAbilities(loc.o).length || ((live.uses || {})[id] || []).some(u => u.kind === 'cast');
        if ((live.playable || []).includes(id)) return more ? this.cardMenu(id, e) : this.playFromHand(loc.o);
        return this.showCard(id);
      }
      if (loc.zone === 'battlefield' && loc.o.controller === this.meId) return this.onMyPermanent(loc.o, node, e);
      if (loc.zone === 'stack' || loc.zone === 'battlefield') return this.showCard(id);
    }

    /**
     * Clicking one of your own permanents. A land taps for mana; anything
     * with abilities offers them right there beside the card, with their
     * costs, rather than in a menu of table tools.
     */
    onMyPermanent(o, node, e) {
      const a = this.analysis(o);
      if (!a) return;
      const live = this.live || this.view;
      const acts = (a.abilities || []).filter(x => x.kind === 'activated' || x.kind === 'loyalty');
      const uses = [];
      if (o.faceDown) {
        // (Kozilek, the Broken Reality: a manifested creature card, for its mana cost — the engine says what it costs)
        const real = (a.abilities || []).find(x => x.kind === 'castModifier' && /^(morph|megamorph|disguise)$/i.test(x.keyword || '') && x.arg);
        const upCost = o.upCost || (real && real.arg);
        if (upCost) uses.push({ label: 'Turn face up', cost: upCost, fn: () => this.send({ kind: 'turnFaceUp', objId: o.id }) });
        // (Yedora, Grave Gardener: a face-down Forest land is tapped for {G} like any other — faceDownLand)
        if (o.faceDownLand && !o.tapped) a.manaAbilities.forEach((ab, i) => uses.push({ label: 'Add mana', text: MTG.oracle.abilityLabel(ab, o), mana: true, fn: () => this.tapMana(o, i, ab) }));
      } else {
        /* Marvin, an Equipment's "has '{T}: …'": what it was given beyond its printed
           abilities comes after them, each with the engine's index for it (o.gained) */
        const gained = (o.gained && o.gained.list) || [];
        const gActs = gained.filter(g => !g.mana), gMana = gained.filter(g => g.mana);
        const actBase = o.gained ? o.gained.manaBase : a.manaAbilities.length;
        acts.concat(gActs.map(g => g.ability)).forEach((ab, k) => {
          const idx = k < acts.length ? actBase + k : gActs[k - acts.length].i;
          const c = ab.cost || {};
          const cost = ab.kind === 'loyalty'
            ? (c.loyaltyX < 0 ? '−X' : c.loyalty > 0 ? '+' + c.loyalty : c.loyalty < 0 ? '−' + -c.loyalty : '0')
            : (typeof c === 'string' ? c : (c.raw || ''));
          // a minus ability needs that much loyalty to pay (CR 606.6)
          const short = ab.kind === 'loyalty' && c.loyalty < 0 && -c.loyalty > ((o.counters || {}).loyalty || 0);
          // the cost is shown on its own, so the text is what comes after the colon
          // a Room's locked door reads "Unlock <door>", its cost shown beside it
          const raw = ab.special === 'unlock' ? String(ab.text || '').replace(/:\s*[^:]*$/, '')
            : String(ab.text || '').replace(/^[^:]*:\s*/, '');
          const text = (raw && MTG.oracle.named ? MTG.oracle.named(raw, o) : raw) || MTG.oracle.abilityLabel(ab, o);
          uses.push({ label: MTG.oracle.abilityLabel(ab, o), cost, loyalty: ab.kind === 'loyalty',
            text, off: short ? `Needs ${-c.loyalty} loyalty; it has ${(o.counters || {}).loyalty || 0}.` : null,
            fn: () => this.activate(o, a, idx, ab) });
        });
        a.manaAbilities.concat(gMana.map(g => g.ability)).forEach((ab, k) => {
          const i = k < a.manaAbilities.length ? k : gMana[k - a.manaAbilities.length].i;
          const xs = this._abilityX(o, ab);
          if (o.tapped && !xs) return;
          // a storage land's counters come off a number at a time: that one asks how many
          if (xs) {
            const c = ab.cost || {};
            uses.push({ label: MTG.oracle.abilityLabel(ab, o), cost: c.mana || '',
              text: MTG.oracle.named ? MTG.oracle.named(String(ab.text || '').replace(/^[^:]*:\s*/, ''), o) : ab.text,
              fn: () => this.activate(o, a, i, ab) });
            return;
          }
          uses.push({ label: 'Add mana', text: MTG.oracle.abilityLabel(ab, o), mana: true, fn: () => this.tapMana(o, i, ab) });
        });
        // Yavimaya, Urborg: the mana a land type it was given adds (the engine's index for it)
        if (!o.tapped) for (const m of (o.manaExtra || [])) uses.push({ label: 'Add mana', text: m.label, mana: true, fn: () => this.tapMana(o, m.i, null) });
        // prepared: a copy of the spell printed with it, cast from here
        for (const use of ((live.uses || {})[o.id] || [])) {
          if (use.kind !== 'cast' || use.via !== 'prepared') continue;
          const sp = preparedFace(o);
          uses.unshift({ label: use.label, cost: use.cost || '',
            text: sp ? `Cast a copy of ${sp.name}: ${sp.oracle_text || ''}` : use.label,
            fn: () => this.castPrepared(o) });
        }
      }
      if (!uses.length) return this.showCard(o.id);
      /* A plain land is one tap and nothing else to ask about. */
      if (uses.length === 1 && uses[0].mana) return uses[0].fn();
      if (!(live.priorityPlayer === this.meId) && !uses.every(u => u.mana)) {
        // abilities wait for priority; the popover still shows what it can do
      }
      this.popover(node, o, uses);
    }

    /** @this {MTG.TableInstance} */
    playFromHand(o) {
      const a = this.analysis(o);
      if (!a) return;
      if (!this._ready()) return;
      const live = this.live;
      if (!(live.playable || []).includes(o.id)) {
        const alt = (live.uses || {})[o.id] || [];
        if (alt.length) return this.cardMenu(o.id, null);
        // the engine's own reason, where it gave one: a tap on a phone is the only way to ask
        const why = this.whyNot(o.id);
        if (why) return UI.toast(why.text);
        if (live.priorityPlayer !== this.meId) return UI.toast('Wait for priority to play that.');
        if (a.isLand) return UI.toast((this.me && this.me.landsPlayed >= this.me.maxLands) ? 'You have already played a land this turn.' : 'Lands can be played in your main phase with the stack empty.');
        return UI.toast(a.isInstant || a.has('flash') ? 'You cannot pay for that right now.' : 'You cannot cast that right now.');
      }
      if (a.isLand) {
        // a channel land (Otawara): play it, or channel it
        const chans = ((live.uses || {})[o.id] || []).filter(u => u.kind === 'cycle');
        if (chans.length && o.zone === 'hand') {
          const me = this.me;
          const canLand = me && live.activePlayer === this.meId && live.step === 'main' && !(live.stack || []).length &&
            me.landsPlayed < (me.maxLands || 1);
          /** @type {Array<[string, () => void]>} */
          const items = chans.map(u => [u.label, () => this._cycleUse(o, a, u)]);
          if (canLand) items.unshift(['Play this land', () => { MTG.sfx('ui_play'); this.send({ kind: 'playLand', objId: o.id }); }]);
          if (items.length === 1) return items[0][1]();
          const n = this.els.get(o.id);
          const r = n ? n.getBoundingClientRect() : null; /* screen pixels, like a pointer */
          return UI.contextMenu(r ? { clientX: r.left + r.width / 2, clientY: r.top, preventDefault() {} } : null, items, { title: o.card.name });
        }
        MTG.sfx('ui_play'); return this.send({ kind: 'playLand', objId: o.id });
      }
      if (this._landBack(o)) return this._spellOrLand(o, a);
      const halves = (live.splitFaces || {})[o.id];
      // (Halvar, God of Battle // Sword of the Realms: either face of a modal double-faced card — mdfcBack)
      if ((o.card.layout === 'split' || o.card.layout === 'adventure' || o.card.layout === 'modal_dfc') && halves && halves.length) return this._castHalf(o, halves);
      /* Another way to cast it from where it is (spectacle, evoke, surge,
         morph face down…): offered beside the ordinary cast, which comes
         first, rather than left in a right-click menu nobody opens. */
      if (o.zone === 'hand') {
        const alts = ((live.uses || {})[o.id] || []).filter(u => ['cast', 'cycle', 'suspend', 'plot', 'foretell'].includes(u.kind));
        if (alts.length) {
          /* the ordinary cast, when it could be made right now: the engine's
             reason covers cost, and its timing is checked here because a card
             with another way in (sneak in combat) is not "unplayable" */
          const sorcerySpeed = live.activePlayer === this.meId && live.step === 'main' && !(live.stack || []).length;
          const normal = !this.whyNot(o.id) && (sorcerySpeed || a.isInstant || a.has('flash'));
          /** @type {Array<[string, () => void]>} */
          const items = alts.map(u => [u.label, () => (u.kind === 'cycle' ? this._cycleUse(o, a, u)
            : u.kind === 'suspend' ? this._suspendUse(o, u)
            : u.kind === 'plot' ? this.send({ kind: 'plot', objId: o.id })
            : u.kind === 'foretell' ? this.send({ kind: 'foretell', objId: o.id })
            : u.via === 'morph' ? this.send({ kind: 'cast', objId: o.id, targets: [], via: 'morph' })
            : this.castUse(o, a, u))]);
          if (normal) items.unshift([`Cast it ${a.manaCost || o.card.mana_cost || ''}`.trim(), () => this.beginCast(o, a)]);
          // (foretelling exiles the card: never done on a bare click, always picked from the menu)
          if (items.length === 1 && alts[0].kind !== 'foretell') return items[0][1]();
          const n = this.els.get(o.id);
          const r = n ? n.getBoundingClientRect() : null; /* screen pixels, like a pointer */
          return UI.contextMenu(r ? { clientX: r.left + r.width / 2, clientY: r.top, preventDefault() {} } : null, items, { title: o.card.name });
        }
      }
      this.beginCast(o, a);
    }

    /** A split card: the half that can be cast, or a choice of the two. @this {MTG.TableInstance} */
    _castHalf(o, halves) {
      const faces = o.card.card_faces || [];
      const go = (f) => this.beginCast(o, MTG.oracle.analyze(o.card, f), null, f);
      const fused = ((this.live || this.view).fusable || []).includes(o.id);
      if (halves.length === 1 && !fused) return go(halves[0]);
      /** @type {Array<[string, () => void]>} */
      const items = halves.map(f => [`Cast ${faces[f] ? faces[f].name : 'half ' + (f + 1)} ${faces[f] ? faces[f].mana_cost || '' : ''}`, () => go(f)]);
      // fuse: both halves as one spell, both costs paid, the left half's targets first
      if (fused && faces.length > 1) {
        items.push([`Cast both, fused ${faces[0].mana_cost || ''}${faces[1].mana_cost || ''}`,
          () => this.beginCast(o, MTG.oracle.analyze(o.card, 0), 'fuse')]);
      }
      const n = this.els.get(o.id);
      const r = n ? n.getBoundingClientRect() : null; /* screen pixels, like a pointer */
      UI.contextMenu(r ? { clientX: r.left + r.width / 2, clientY: r.top, preventDefault() {} } : null, items, { title: o.card.name });
    }

    /** An alternative cast: a use that names a face (aftermath's other half) is cast as that face. @this {MTG.TableInstance} */
    castUse(o, a, use) {
      if (use.face != null) return this.beginCast(o, MTG.oracle.analyze(o.card, use.face) || a, use.via, use.face);
      // Unearth: an ability of the card, not a spell — no targets or X of the card's to ask about
      if (use.via === 'unearth') return this.send({ kind: 'cast', objId: o.id, targets: [], via: 'unearth' });
      /* Sneak: an unblocked attacker goes back to hand. With more than one,
         which one is yours to say. */
      if (use.via === 'sneak') {
        const v = this.live || this.view;
        const free = v.battlefield.filter(x => x.controller === this.meId && x.attacking && !(x.blockedBy || []).length);
        const go = (rid) => this.beginCast(o, a, 'sneak', undefined, rid ? { returnId: rid } : {});
        if (free.length <= 1) return go(free[0] && free[0].id);
        /** @type {Array<[string, () => void]>} */
        const items = free.map(x => [`Return ${x.card.name}`, () => go(x.id)]);
        return UI.contextMenu(null, items, { title: `Sneak ${o.card.name}: return which attacker?` });
      }
      return this.beginCast(o, a, use.via);
    }

    /** Cast a copy of a prepared permanent's spell: targets and X are the spell's. @this {MTG.TableInstance} */
    castPrepared(o) {
      const sp = MTG.oracle.analyze(o.card, 1);
      if (!sp) return UI.toast('Nothing to cast.');
      this.beginCast(o, sp, 'prepared');
    }

    /** A modal double-faced card with a land on its back: the land side, if one can go down now. */
    _landBack(o) {
      const faces = o && o.card && o.card.card_faces;
      if (!(o.card.layout === 'modal_dfc' && faces && faces[1] && /\bLand\b/.test(faces[1].type_line || '') &&
        !/\bLand\b/.test(faces[0].type_line || ''))) return null;
      const v = this.live, me = this.me;
      const canLand = me && v.activePlayer === this.meId && /^main/.test(v.step || '') && !(v.stack || []).length &&
        me.landsPlayed < (me.maxLands || 1);
      return canLand ? faces[1] : null;
    }

    /** Cast the front, or play the back as this turn's land. @this {MTG.TableInstance} */
    _spellOrLand(o, a) {
      const faces = o.card.card_faces;
      // the reason the engine gives is the front's: none means it can be cast as well
      const castable = !this.whyNot(o.id);
      /** @type {Array<[string, () => void]>} */
      const items = [
        [`Play ${faces[1].name} as a land`, () => { MTG.sfx('ui_play'); this.send({ kind: 'playLand', objId: o.id, face: 1 }); }],
      ];
      if (castable) items.unshift([`Cast ${faces[0].name}`, () => this.beginCast(o, a)]);
      if (items.length === 1) return items[0][1]();
      const n = this.els.get(o.id);
      const r = n ? n.getBoundingClientRect() : null; /* screen pixels, like a pointer */
      UI.contextMenu(r ? { clientX: r.left + r.width / 2, clientY: r.top, preventDefault() {} } : null, items, { title: o.card.name });
    }

    /* ---- targets ---- */
    isTargetablePlayer(p) {
      const t = this.targeting;
      if (!t || !p || p.hasLost) return false;
      // (Ravager of the Fells: the targets in order — a player only where the words want one)
      if (t.legal && t.slots && (t.specs || []).some(s => s && s.sameControllerAsPrev)) return (t.slots[t.chosen.length] || []).some(x => x.kind === 'player' && x.id === p.id);
      if (t.legal) return t.legal.has('player:' + p.id);
      const spec = t.specs[t.chosen.length] || {};
      if (t.chosen.some(c => c.kind === 'player' && c.id === p.id)) return false;
      if (spec.type === 'player' || spec.type === 'any') {
        if (spec.controller === 'opponent' && p.id === this.meId) return false;
        // ("target opponent or planeswalker": not you — opponentOrWalker)
        if (spec.type === 'any' && spec.opponent && p.id === this.meId) return false;
        if (spec.controller === 'you' && p.id !== this.meId) return false;
        return true;
      }
      if (spec.type === 'opponent') return p.id !== this.meId;
      return false;
    }
    /**
     * A spell or ability on the stack as a target: "counter target spell",
     * "noncreature spell", "spell an opponent controls", "activated or
     * triggered ability". Read leniently (the engine checks the target
     * again as the spell is cast), so nothing legal is ever left dark.
     * @this {MTG.TableInstance}
     */
    isTargetableStack(s) {
      const t = this.targeting;
      if (!t || !s) return false;
      if (t.legal) return t.legal.has('stack:' + s.id);
      const spec = t.specs[t.chosen.length];
      if (!spec || !(spec.type === 'spell' || spec.zone === 'stack' || spec.type === 'spellOrPermanent')) return false;
      if (t.chosen.some(c => c.kind === 'stack' && c.id === s.id)) return false;
      if (s.objId && s.objId === t.source) return false;           // a spell does not target itself
      if (spec.controller === 'you' && s.controller !== this.meId) return false;
      if (spec.controller === 'opponent' && s.controller === this.meId) return false;
      if (s.kind === 'ability') {
        if (!spec.abilities) return false;
        if (spec.abilityKind) return (spec.abilityKind === 'triggered') === !!s.triggered;
        return true;
      }
      if (spec.noSpells) return false;
      const card = s.card || {};
      const mv = card.cmc || 0;
      if (spec.maxMv != null && mv > spec.maxMv) return false;
      if (spec.minMv != null && mv < spec.minMv) return false;
      if (spec.mv != null && mv !== spec.mv) return false;
      const a = MTG.oracle.analyze(card, s.face || 0) || {};
      const want = String(spec.filter || '').toLowerCase().replace(/\s+(?:with|without)\s+.*$/, '')
        .replace(/\s+(?:you control|an opponent controls|your opponents control|you don'?t control)$/, '').replace(/^target\s+/, '').trim();
      if (!want || want === 'spell' || want === 'any' || spec.type === 'spellOrPermanent') return true;
      const colours = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
      const has = (w) => {
        if (w === 'creature') return !!a.isCreature;
        if (w === 'instant') return !!a.isInstant;
        if (w === 'sorcery') return !!a.isSorcery;
        if (w === 'artifact') return !!a.isArtifact;
        if (w === 'enchantment') return !!a.isEnchantment;
        if (w === 'planeswalker') return !!a.isPlaneswalker;
        if (w === 'permanent') return !!a.isPermanent;
        if (colours[w]) return (card.colors || []).includes(colours[w]);
        if (w === 'multicolored') return (card.colors || []).length > 1;
        if (w === 'colorless') return !(card.colors || []).length;
        return null;                                               // a word this does not know: no say
      };
      // "noncreature spell", "instant or sorcery spell", "red or green spell"
      const words = want.replace(/\bspells?\b/g, '').trim();
      if (/^non/.test(words)) { const r = has(words.slice(3).replace(/^-/, '')); return r == null ? true : !r; }
      const alts = words.split(/\s+or\s+|,\s*/).map(x => x.trim()).filter(Boolean);
      const answers = alts.map(has).filter(r => r != null);
      return !answers.length || answers.some(Boolean);
    }
    /** @this {MTG.TableInstance} */
    aimAtStack(id) {
      const t = this.targeting;
      if (!t) return;
      const s = ((this.live || this.view).stack || []).find(x => x.id === id || x.objId === id);
      if (!s) return;
      if (!this.isTargetableStack(s)) return UI.error('Not a legal target for that.');
      t.chosen.push({ kind: 'stack', id: s.id });
      MTG.sfx('click');
      if (t.chosen.length >= t.need) { this.targeting = null; t.onDone(t.chosen); }
      this.render();
    }

    aimAtPlayer(pid) {
      const t = this.targeting;
      if (!t) return;
      t.chosen.push({ kind: 'player', id: pid });
      MTG.sfx('click');
      if (t.chosen.length >= t.need) { this.targeting = null; t.onDone(t.chosen); }
      this.render();
    }
    isTargetable(o) {
      const t = this.targeting;
      if (!t) return false;
      // Ravager of the Fells: "a creature that player or that planeswalker's controller controls" — in order, under the first one's
      if (t.legal && t.slots && (t.specs || []).some(s => s && s.sameControllerAsPrev)) {
        const sp = t.specs[t.chosen.length];
        if (!(t.slots[t.chosen.length] || []).some(x => x.kind === 'object' && x.id === o.id)) return false;
        const prev = t.chosen[t.chosen.length - 1];
        if (!sp || !sp.sameControllerAsPrev || !prev) return true;
        const p = prev.kind === 'object' ? this.objIn(prev.id) : null;
        return o.controller === (prev.kind === 'player' ? prev.id : p && p.controller);
      }
      if (t.legal) return t.legal.has('object:' + o.id);
      const spec = t.specs[t.chosen.length];
      if (!spec) return false;
      if (t.chosen.some(c => c.id === o.id)) return false;
      // "controlled by different players" (Run Away Together): not a second one of the same player's
      if (t.specs.some(s => s && s.differentControllers) && t.chosen.some(c => {
        const x = c.kind === 'object' ? this.objIn(c.id) : null;
        return x && x.controller === o.controller;
      })) return false;
      // Burglar's Plot: shares a card type with the one chosen before it (shareCardType)
      if (spec.shareCardType && t.chosen.length) {
        const prev = t.chosen[t.chosen.length - 1];
        const p = prev && prev.kind === 'object' ? this.objIn(prev.id) : null;
        const kinds = (x) => /** @type {string[]} */ (String((x && x.card && x.card.type_line) || '').split('—')[0].match(/\b(?:Artifact|Battle|Creature|Enchantment|Land|Planeswalker|Kindred)\b/g) || []);
        if (p && !kinds(o).some(s => kinds(p).includes(s))) return false;
      }
      // Secret Tunnel: shares a creature type with the one chosen before it
      if (spec.sharesTypeWithPrev && t.chosen.length) {
        const prev = t.chosen[t.chosen.length - 1];
        const p = prev && prev.kind === 'object' ? this.objIn(prev.id) : null;
        const subs = (x) => { const tl = String((x && x.card && x.card.type_line) || ''); return tl.includes('—') ? tl.split('—')[1].trim().split(/\s+/) : []; };
        if (p && !subs(o).some(s => subs(p).includes(s))) return false;
      }
      // Goblin Welder: owned by whoever controlled the first; Bioshift: the same controller as the first
      if ((spec.ownedByPrevController || spec.sameControllerAsPrev) && t.chosen.length) {
        const prev = t.chosen[t.chosen.length - 1];
        const p = prev && prev.kind === 'object' ? this.objIn(prev.id) : null;
        if (p && spec.ownedByPrevController && o.owner !== p.controller) return false;
        if (p && spec.sameControllerAsPrev && o.controller !== p.controller) return false;
        // (Ravager of the Fells: "that player" — the player chosen first)
        if (prev && prev.kind === 'player' && spec.sameControllerAsPrev && o.controller !== prev.id) return false;
      }
      // Gaea's Blessing, Dwell on the Past: cards from the graveyard of the player already chosen
      if (spec.ownedByTargetPlayer) {
        const pl = t.chosen.find(c => c.kind === 'player');
        if (pl && o.owner !== pl.id) return false;
      }
      // Callidus Assassin: one with the same name as the card aiming
      if (spec.sameNameAsSource) {
        const src = t.source ? this.objIn(t.source) : null;
        if (src && src.card && o.card && src.card.name !== o.card.name) return false;
      }
      /* Shroud, an opponent's hexproof, protection from what is aiming:
         not lit, since the engine would refuse it (CR 702.11, 702.16, 702.18) */
      if (o.zone === 'battlefield' && !this._canAimAt(o)) return false;
      const a = this.analysis(o);
      return MTG.oracle.matchesSpec(this._notedSpec(spec), o, a, this.meId, VIEW_SPEC_CTX);
    }

    /** Whether what is choosing targets may point at this permanent at all. */
    _canAimAt(o) {
      const kw = (o.keywords || []).map(k => String(k).toLowerCase());
      // (Autumn Willow: "as though it didn't have shroud" for you — shroudOpen)
      if (kw.includes('shroud') && !o.shroudOpen) return false;
      if (o.controller !== this.meId && kw.includes('hexproof')) return false;
      const t = this.targeting;
      const src = t && t.source ? this.objIn(t.source) : null;
      const cols = (src && src.card && (src.card.colors || [])) || [];
      const NAME = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
      for (const k of kw) {
        const m = /^(protection|hexproof) from (.+)$/.exec(k);
        if (!m || (m[1] === 'hexproof' && o.controller === this.meId)) continue;
        // "protection from black and from green": each quality on its own
        for (const what of m[2].split(/\s*(?:,|\band\b|\bor\b)\s*(?:from\s+)?/).map(x => x.trim()).filter(Boolean)) {
          if (what === 'everything') return false;
          if (NAME[what] && cols.includes(NAME[what])) return false;
          if ((what === 'all colors' || what === 'each color') && cols.length) return false;
          if (what === 'multicolored' && cols.length > 1) return false;
          if (what === 'monocolored' && cols.length === 1) return false;
          // Emrakul, the World Anew: "protection from spells"; the Promised End: "from instants"
          if (what === 'spells' && t && t.spell) return false;
          const TYPE = { instants: 'Instant', sorceries: 'Sorcery', enchantments: 'Enchantment', planeswalkers: 'Planeswalker' }[what];
          if (TYPE && src && src.card && new RegExp('\\b' + TYPE + '\\b').test(src.card.type_line || '')) return false;
        }
      }
      return true;
    }

    /* Regicide's colour, Custodi Peacekeeper's power cap: a target spec
       that depends on what you noted while drafting, made concrete the
       way the engine does it, so only what is legal lights up. */
    _notedSpec(spec) {
      if (!spec || !(spec.notedColors || spec.notedMaxPower)) return spec;
      const notes = (this.me && this.me.draftNotes) || {};
      const out = Object.assign({}, spec, { notedColors: null, notedMaxPower: null });
      if (spec.notedColors) {
        const cols = (notes[spec.notedColors] || {}).colors || [];
        out.colors = cols.length ? cols.slice() : ['-'];
      }
      if (spec.notedMaxPower) out.maxPower = ((notes[spec.notedMaxPower] || {}).numbers || []).reduce((m, k) => Math.max(m, Number(k) || 0), 0);
      return out;
    }
    /** @this {MTG.TableInstance} */
    cancelTargeting() { this.targeting = null; this.hideAim(); }

    targetName(t) {
      if (!t) return '';
      if (t.kind === 'player') {
        const p = this.view.players.find(x => x.id === t.id);
        return p ? (p.id === this.meId ? 'you' : p.name) : 'a player';
      }
      if (t.kind === 'stack') {
        const s = (this.view.stack || []).find(x => x.id === t.id);
        return s ? this.stackName(s) : 'a spell';
      }
      const o = this.objIn(t.id);
      return o && o.card ? o.card.name : 'something';
    }

    /**
     * @this {MTG.TableInstance}
     * @param {any} o @param {any} a @param {number} index @param {any} ab
     * @param {number=} x the X of its cost, once chosen
     * @param {number=} split how much of the second colour, once chosen
     */
    activate(o, a, index, ab, x, split) {
      this.closePopover();
      // an ability whose cost has an X (mana, or counters taken off) asks for it first
      const asks = x == null ? this._abilityX(o, ab, index) : null;
      if (asks) return this._askNumber(`${escapeHtml(o.card.name)}: ${asks.label}`, asks.sub, asks.min || 0, asks.max, asks.start != null ? asks.start : asks.max,
        (n) => this.activate(o, a, index, ab, n), o.card);
      /* "Add X mana in any combination of {U} and/or {B}": how much of the
         second colour, the rest the first. Asked only when the amount is
         known now (X, or a number); otherwise the engine splits it. */
      const mix = split == null ? (ab.effects || []).find(e => e && e.op === 'addManaChoice' && (e.choices || []).length === 2) : null;
      if (mix) {
        const total = mix.n === 'X' ? (x || 0) : (typeof mix.n === 'number' ? mix.n : null);
        if (total != null && total > 0) {
          const [c1, c2] = mix.choices.map(c => (Array.isArray(c) ? c[0] : c));
          return this._askNumber(`${escapeHtml(o.card.name)}: how much ${MTG.mana.html('{' + c2 + '}')}?`,
            `The rest is {${c1}}: ${total} mana in all.`, 0, total, 0,
            (n) => this.activate(o, a, index, ab, x, n), o.card, (n) => `{${c1}}\u00d7${total - n} \u00b7 {${c2}}\u00d7${n}`);
        }
      }
      /* "Add three mana in any combination of colors" (or "of different
         colors"): a colour for each, chosen now, since a mana ability can't
         stop to ask. Only when the amount is known now. */
      const anyMix = split == null ? (ab.effects || []).find(e => e && e.op === 'addManaAny' && !e.sameColor && !e.commanderIdentity) : null;
      if (anyMix) {
        const total = anyMix.amount === 'X' ? (x || 0) : (typeof anyMix.amount === 'number' ? anyMix.amount : 0);
        if (total > 1) return this._askColours(o.card.name, total, !!anyMix.distinct, (cols) => this.activate(o, a, index, ab, x, cols), o.card, 'Activate');
      }
      /* "Remove a counter from this creature", of any kind: which kind comes
         off, when it has more than one (a -1/-1 counter is not a +1/+1) */
      const kindSet = !!this._actKind && this._actKind.id === o.id && this._actKind.index === index;
      if (((ab.cost || {}).removeCounters || {}).kind === '*' && !kindSet) {
        const kinds = this._counterKinds(o);
        if (kinds.length > 1) {
          return this._askCounterKind(o.card, kinds, (k) => {
            this._actKind = { id: o.id, index, kind: k };
            this.activate(o, a, index, ab, x, split == null ? undefined : split);
          });
        }
      }
      /** @type {any} */
      const more = Object.assign({}, x != null ? { x } : {}, split != null ? { manaSplit: split } : {});
      if (kindSet && this._actKind.kind) more.counterKind = this._actKind.kind;
      // a cost the table would otherwise pay from what is to hand (Forensic Researcher, City of Shadows...)
      if (!this._costAsked) {
        const rows = (((this.live || this.view).costPicks || {})[o.id] || []).filter(r => r.index === index);
        if (rows.length) {
          return this.askCostPicks(rows, x || 0, o.card, (chosen) => {
            this._costAsked = chosen;
            try { this.activate(o, a, index, ab, x, split == null ? undefined : split); } finally { this._costAsked = null; }
          });
        }
      }
      if (this._costAsked) Object.assign(more, this._costAsked);
      this._actKind = null;
      const specs = [];
      for (const s of this._effectTargets(ab.effects)) {
        if (!s.multi) { specs.push(s); continue; }
        // "X target lands" (Mishra's Helix): as many as the X paid, or as many as there are
        const plain = Object.assign({}, s, { multi: null });
        const legal = this._countLegal(plain);
        const n = s.multi.count === 'X' ? Math.min(x || 0, legal) : legal;
        for (let i = 0; i < n; i++) specs.push(s.multi.exact === false || s.multi.count === 'any' ? Object.assign({}, plain, { upTo: true }) : plain);
      }
      // its mana is paid the way you pay: by the game, or from the lands you tap (12c)
      const cost = this._abilityManaCost(ab);
      if (!specs.length) return this.payThen({ kind: 'activate', objId: o.id, index, targets: [], ...more }, cost, o.card);
      this.startTargeting({
        need: specs.length, specs, label: `${o.card.name}: choose ${specs.length === 1 ? 'a target' : specs.length + ' targets'}`,
        source: o.id, cardName: o.card.name,
        onDone: (targets) => this.payThen({ kind: 'activate', objId: o.id, index, targets, ...more }, cost, o.card),
      });
    }

    /** The mana part of an ability's cost, without the tap symbols ("{2}, {T}" is {2}). */
    _abilityManaCost(ab) {
      const c = (ab && ab.cost) || {};
      return String(typeof c === 'string' ? c : (c.mana || '')).replace(/\{[TQ]\}/g, '');
    }

    /** The target specs in a list of effects, sequences walked into, in order. */
    _effectTargets(effects) {
      const out = [];
      const walk = (list) => {
        for (const e of (list || [])) {
          if (!e) continue;
          if (e.op === 'sequence') { walk(e.list); continue; }
          // (Diaochan, Artful Beauty: "of an opponent's choice" — theirs to choose, asked once it is activated: chosenBy)
          for (const s of (e.targets || [])) if (s && !s.chosenBy) out.push(s);
        }
      };
      walk(effects);
      return out;
    }

    /**
     * Cycling, or channel and forecast, which go through the same door: the
     * card is discarded (or, for forecast, shown) for its ability, and an
     * ability that points at something asks for that first.
     * @this {MTG.TableInstance}
     */
    _cycleUse(o, a, use, x) {
      if (!use.channel) return this.send({ kind: 'cycle', objId: o.id, channel: false });
      const eff = use.forecast ? ((a.forecast || {}).effects) : ((a.channel || {}).effects);
      let specs = this._effectTargets(eff);
      /* Shigeki, Jukai Visionary: "Channel — {X}{X}{G}{G}": X first, as much as can be paid for each {X} (and,
         for "X target cards", no more than there are), then that many targets (channelX) */
      const xs = use.forecast ? 0 : (String(use.cost || '').match(/\{X\}/g) || []).length;
      if (xs && x == null) {
        const fixed = MTG.mana.cmc(String(use.cost).replace(/\{X\}/g, ''));
        let max = Math.max(0, Math.floor((this.manaHere() - fixed) / xs));
        const many = specs.find(s => s.multi && s.multi.count === 'X');
        if (many) max = Math.min(max, this._countLegal(Object.assign({}, many, { multi: null })));
        return this._askNumber(`${escapeHtml(o.card.name)}: choose X`, `X is paid ${xs === 1 ? 'once' : xs + ' times'}. You can afford up to ${max}.`, 0, max, max,
          (n) => this._cycleUse(o, a, use, n), o.card);
      }
      specs = specs.flatMap(s => (s.multi && s.multi.count === 'X' ? Array.from({ length: x || 0 }, () => Object.assign({}, s, { multi: null })) : [s]));
      const send = (targets) => this.send(Object.assign({ kind: 'cycle', objId: o.id, channel: true, targets }, xs ? { x: x || 0 } : {}));
      if (!specs.length) return send([]);
      this.startTargeting({
        need: specs.length, specs, source: o.id, cardName: o.card.name,
        label: `${o.card.name}: choose ${specs.length === 1 ? 'a target' : specs.length + ' targets'}`,
        onDone: send,
      });
    }

    /**
     * The X an ability's cost asks for, if any: "{X}: ..." pays X mana, and a
     * storage land's "Remove X storage counters" takes that many off. Returns
     * { label, sub, max } or null. `index`: the ability's, for the cost picks
     * the table offers for it (Jetfire, Ingenious Scientist).
     * @this {MTG.TableInstance}
     * @param {any} o
     * @param {any} ab
     * @param {number=} index
     */
    _abilityX(o, ab, index) {
      const c = (ab && ab.cost) || {};
      /* Jetfire, Ingenious Scientist: "Remove one or more +1/+1 counters from among artifacts you control" — how many,
         up to every one among them (the costPicks row for this ability says which they are); one way only: not asked */
      const rs = c.removeCounterSpread;
      if (rs && (rs.n === 'X' || rs.n === 'any')) {
        const row = (((this.live || this.view).costPicks || {})[o.id] || []).find(r => r.kind === 'counterSpread' && (index == null || r.index === index));
        const have = ((row && row.candidates) || []).reduce((k, id) => k + (Number(((this.objIn(id) || {}).counters || {})[rs.kind]) || 0), 0);
        const min = rs.min || 0;
        if (have <= min) return null;
        return { label: `remove how many ${rs.kind} counters?`, sub: `From among ${MTG.oracle.nounPlural(rs.filter)} you control: there are ${have}.`, max: have, min };
      }
      // a planeswalker's "-X": as many loyalty counters as you like, up to all of them
      if (ab && ab.kind === 'loyalty' && c.loyaltyX < 0) {
        const have = Number((o.counters || {}).loyalty) || 0;
        return { label: 'choose X', sub: `X loyalty comes off. It has ${have}.`, max: have, start: 0 };
      }
      const rc = c.removeCounters;
      if (rc && (rc.n === 'X' || rc.n === 'any')) {
        const kind = String(rc.kind || '').replace(/\s+counters?$/i, '').trim();
        const have = Number((o.counters || {})[kind]) || 0;
        // (Arcee, Sharpshooter: "Remove one or more" — from one: min)
        return Object.assign({ label: `remove how many ${kind} counters?`, sub: `It has ${have}.`, max: have }, rc.min ? { min: rc.min } : {});
      }
      // Gix, Yawgmoth Praetor: "Discard X cards" — up to the cards in your hand
      if (c.discard && c.discard.n === 'X') {
        const have = ((this.me && this.me.hand) || []).length;
        return { label: 'discard how many cards?', sub: `X is the number of cards you discard. You have ${have} in hand.`, max: have, start: Math.min(1, have) };
      }
      // Hazel of the Rootbloom: "Tap X untapped tokens you control" — up to the untapped tokens you have
      if (c.tapCreatures && c.tapCreatures.n === 'X' && c.tapCreatures.filter === 'token') {
        const have = ((this.view && this.view.battlefield) || []).filter(x => x.controller === this.meId && x.isToken && !x.tapped && x.id !== o.id).length;
        return { label: 'tap how many tokens?', sub: `X is the number of untapped tokens you tap. You have ${have}.`, max: have };
      }
      // Glacian, Powerstone Engineer: "Tap X untapped artifacts you control"
      if (c.tapCreatures && c.tapCreatures.n === 'X' && c.tapCreatures.filter === 'artifact') {
        const have = ((this.view && this.view.battlefield) || []).filter(x => x.controller === this.meId && !x.tapped && x.id !== o.id &&
          /\bArtifact\b/.test(String((x.card || {}).type_line || ''))).length;
        return { label: 'tap how many artifacts?', sub: `X is the number of untapped artifacts you tap. You have ${have}.`, max: have };
      }
      if (/\{X\}/.test(String(c.mana || ''))) {
        const fixed = MTG.mana.cmc(String(c.mana).replace(/\{X\}/g, ''));
        // Gogo, Master of Mimicry: "{X}{X}" pays X twice, and "X can't be 0"
        const xs = (String(c.mana).match(/\{X\}/g) || []).length;
        const max = Math.max(0, Math.floor((this.manaHere() - fixed - (c.tap && !o.tapped && this._makesMana(o) ? 1 : 0)) / xs));
        const min = Math.max(0, ...(ab.effects || []).map(e => (e && e.xMin) || 0));
        return { label: 'choose X', sub: `You can afford up to ${max}.`, max: Math.max(min, max), min };
      }
      return null;
    }
    /** Whether tapping this permanent for its own cost also takes a mana source away. */
    _makesMana(o) {
      const a = this.analysis(o);
      return !!(a && a.manaAbilities && a.manaAbilities.length);
    }

    /**
     * Suspend, and Suspend X: X time counters, and X in the cost too, so
     * ask how many (at least one, at most what the mana here pays for).
     * @this {MTG.TableInstance}
     */
    _suspendUse(o, use) {
      if (!use.xCost) return this.send({ kind: 'suspend', objId: o.id });
      const fixed = MTG.mana.cmc(String(use.xCost).replace(/\{X\}/g, ''));
      const per = (String(use.xCost).match(/\{X\}/g) || []).length || 1;
      const max = Math.max(1, Math.floor((this.manaHere() - fixed) / per));
      this._askNumber(`${o.card.name}: suspend with how many time counters?`, `X is both the time counters and the {X} in ${use.xCost}. You can afford up to ${max}.`,
        1, max, max, (x) => this.send({ kind: 'suspend', objId: o.id, x }), o.card);
    }

    /** The kinds of counter on a permanent, with how many of each. */
    _counterKinds(o) {
      return Object.entries((o && o.counters) || {}).filter(([, n]) => Number(n) > 0).map(([kind, n]) => ({ kind, n: Number(n) }));
    }

    /**
     * Which kind of counter comes off, for a cost that takes "a counter":
     * a button a kind, with how many there are. `done` gets the kind, or
     * null to leave it to the game. @this {MTG.TableInstance}
     */
    _askCounterKind(card, kinds, done) {
      const word = (k) => (/counters?$/i.test(k) ? k : k + ' counter');
      const key = 'ckind:' + (card ? card.name : '') + ':' + kinds.map(k => k.kind + k.n).join(',');
      this.asking = { base: key, key, build: () => this.panel(`${escapeHtml(card ? card.name : 'Cost')}: remove which counter?`,
        'It has more than one kind.', null, [
          { label: 'Let the game choose', fn: () => { this.asking = null; this.render(); done(null); } },
          ...kinds.map((k, i) => ({ label: `${word(k.kind)} (${k.n})`, cls: i === 0 ? 'primary' : '',
            fn: () => { this.asking = null; this.render(); done(k.kind); } })),
        ], { card }) };
      this.render();
    }

    /**
     * Tap a source for mana. "Add two mana in any combination of colors"
     * asks for the colours first: a mana ability can't stop to ask, so
     * they go with the tap. @this {MTG.TableInstance}
     */
    tapMana(o, i, ab) {
      const mix = ab && (ab.effects || []).find(e => e && e.op === 'addManaAny' && !e.sameColor && !e.commanderIdentity &&
        typeof e.amount === 'number' && e.amount > 1);
      if (mix) return this._askColours(o.card.name, mix.amount, !!mix.distinct, (cols) => this.send({ kind: 'mana', objId: o.id, index: i, split: cols }), o.card);
      /* "Add {R} or {G}", "one mana of any color": which, chosen now and sent with the tap. While a spell
         waits for mana, the one the cost still needs is taken without asking; otherwise, with more than one
         to choose from, the person is asked (o.manaChoices: what the engine says this source offers). */
      const opts = (((o.manaChoices || []).find(m => m.i === i)) || {}).options || [];
      const go = (key) => this.send(Object.assign({ kind: 'mana', objId: o.id, index: i }, key ? { choice: key } : {}));
      if (opts.length < 2) return go(null);
      if (this.paying) return go(this._manaChoiceForPay(o, opts));
      this._askManaChoice(o, opts, go);
    }

    /**
     * Which of a source's options to take while a spell waits for mana (the paying banner): the one that
     * lets what is owed be paid from the pool and the other glowing sources, else the one that pays most of
     * the coloured part, else — any colour will do — the one the cards in hand want most. Among equals, the
     * colour the other sources can't make. It only ever settles what the person would have had to pick
     * anyway: whichever of equals is taken, the same is still owed. @this {MTG.TableInstance}
     */
    _manaChoiceForPay(o, opts) {
      const p = this.paying;
      /** @type {any} */
      const me = this.me || {};
      const cost = p && p.intent.x ? p.cost.replace(/\{X\}/g, '{' + p.intent.x + '}') : String((p && p.cost) || '');
      const poolSrc = [];
      for (const c of ['W', 'U', 'B', 'R', 'G', 'C']) for (let k = 0; k < ((me.pool || {})[c] || 0); k++) poolSrc.push(c === 'C' ? '' : c);
      // the other sources that could still pay, by the mana their card says they make
      const others = this.manaSources().filter(x => x.id !== o.id)
        .map(x => (((x.card || {}).produced_mana) || []).filter(c => 'WUBRG'.indexOf(c) >= 0).join(''));
      const payable = MTG.rules && MTG.rules.Game && MTG.rules.Game.prototype._payableFrom;
      const coversWith = (key, more) => !!payable && payable.call(null, poolSrc.concat(key.split('').map(c => (c === 'C' ? '' : c)), more), cost);
      // how many coloured pips are still unpaid, the pool (and this) spent on them first
      const unpaid = (have) => {
        const left = have.slice();
        let n = 0;
        const pips = MTG.mana.parse(cost).map(sym => sym.split('/').filter(c => 'WUBRG'.indexOf(c) >= 0))
          .filter(cols => cols.length).sort((a, b) => a.length - b.length);
        for (const cols of pips) {
          const at = left.findIndex(c => c && cols.indexOf(c) >= 0);
          if (at >= 0) left.splice(at, 1); else n++;
        }
        return n;
      };
      const before = unpaid(poolSrc);
      const want = {};
      for (const h of (me.hand || [])) for (const sym of MTG.mana.parse(((h && h.card) || {}).mana_cost || '')) for (const c of 'WUBRG') if (sym.indexOf(c) >= 0) want[c] = (want[c] || 0) + 1;
      const scarce = (key) => key.split('').reduce((k, c) => k + others.filter(s => s.indexOf(c) >= 0).length, 0);
      const rank = (x) => [
        coversWith(x.key, []) ? 1 : 0,                               // pays it all now
        coversWith(x.key, others) ? 1 : 0,                           // leaves it payable with what else glows
        before - unpaid(poolSrc.concat(x.key.split(''))),             // coloured pips it pays
        -scarce(x.key),                                               // a colour nothing else here makes
        x.key.split('').reduce((k, c) => k + (want[c] || 0), 0),      // what the hand wants
      ];
      let best = opts[0], bestR = rank(opts[0]);
      for (const x of opts.slice(1)) {
        const r = rank(x);
        for (let k = 0; k < r.length; k++) { if (r[k] === bestR[k]) continue; if (r[k] > bestR[k]) { best = x; bestR = r; } break; }
      }
      return best.key;
    }

    /**
     * What a source tapped by hand adds, when it lets you choose (Kibo's Banana's {R} or {G}, Birds of
     * Paradise, a filter land's {W}{W}, {W}{U} or {U}{U}): the mana a button each, with the card's art like
     * every other question here. One press picks it and taps; Cancel or Esc leaves it untapped.
     * @this {MTG.TableInstance}
     */
    _askManaChoice(o, opts, go) {
      const name = (o.card && o.card.name) || 'Mana';
      const key = 'manapick:' + o.id + ':' + opts.map(x => x.key).join(',');
      const done = (k) => { this.asking = null; this.render(); MTG.sfx('click'); go(k); };
      this.asking = { base: key, key, escape: true, build: () => this.panel(`${escapeHtml(name)}: add which mana?`,
        opts.length === 5 ? 'Any colour.' : 'Choose what it adds.',
        el('div', { class: 'mana-picks', role: 'group', 'aria-label': 'Mana to add' }, opts.map((x, k) => el('button', {
          type: 'button', class: 'mana-pick' + (x.key.length > 1 || x.mana.length > 3 ? ' wide' : ''),
          html: MTG.mana.html(x.mana), title: 'Add ' + x.mana, 'aria-label': 'Add ' + x.mana, 'data-mana': x.key,
          autofocus: k === 0 ? true : null, onclick: () => done(x.key),
        }))),
        [{ label: 'Cancel', fn: () => { this.asking = null; this.render(); } }], { card: o.card, cls: 'mana-ask' }) };
      this.render();
    }

    /**
     * A colour for each of `total` mana: the generic options panel, a colour
     * a row, picked as often as wanted (or once each, for "different
     * colors"), then on with the letters. @this {MTG.TableInstance}
     */
    _askColours(name, total, distinct, onDone, card, verb) {
      const NAMES = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green' };
      const cols = Object.keys(NAMES);
      const s = MTG.choice.normalize({ kind: 'options', min: total, max: total, repeat: !distinct,
        options: cols.map(c => ({ label: `{${c}} ${NAMES[c]}` })) });
      const sel = { picks: [] };
      const key = 'cols:' + name + ':' + total;
      const title = `${escapeHtml(name)}: ${total} mana`;
      const sub = distinct ? `Choose ${total} different colours.` : 'Choose a colour for each; the same one as often as you like.';
      this.asking = { base: key, escape: true, get key() { return key + ':' + sel.picks.join(','); }, build: () => {
        const pr = MTG.choice.progress(s, sel.picks);
        return this.panel(title, escapeHtml(sub) + `<br><span class="choose-status${pr.ok ? '' : ' short'}">${escapeHtml(pr.text)}</span>`,
          this.chooseBody(s, sel, {
            onPick: (k) => {
              const n = sel.picks.filter(p => p === k).length;
              if (MTG.choice.canAdd(s, sel.picks, k)) sel.picks.push(k);
              else if (n) sel.picks.splice(sel.picks.lastIndexOf(k), 1);
              this.render();
            },
            onLess: (k) => { const i = sel.picks.lastIndexOf(k); if (i >= 0) sel.picks.splice(i, 1); this.render(); },
          }),
          [
            { label: 'Cancel', fn: () => { this.asking = null; this.render(); } },
            { label: verb || 'Add mana', cls: 'primary', disabled: !pr.ok, fn: () => { this.asking = null; this.render(); onDone(sel.picks.map(k => cols[k])); } },
          ], { card });
      } };
      this.render();
    }

    /** A number to pick, between min and max: a stepper, then on with it. @this {MTG.TableInstance} */
    _askNumber(title, sub, min, max, start, onDone, card, explain) {
      let n = U.clamp(start, min, max);
      const key = 'num:' + title;
      this.asking = { base: key, get key() { return key + ':' + n; }, build: () => this.panel(title, escapeHtml(sub || ''),
        el('div', { class: 'x-pick' }, [
          el('button', { type: 'button', class: 'btn', text: '\u2212', disabled: n <= min, onclick: () => { n = Math.max(min, n - 1); this.render(); }, 'aria-label': 'Fewer' }),
          el('div', { class: 'x-val', text: String(n) }),
          el('button', { type: 'button', class: 'btn', text: '+', disabled: n >= max, onclick: () => { n = Math.min(max, n + 1); this.render(); }, 'aria-label': 'More' }),
          max > min + 1 ? el('button', { type: 'button', class: 'btn xs ghost', text: `max (${max})`, onclick: () => { n = max; this.render(); } }) : null,
          explain ? el('div', { class: 'x-explain', html: MTG.mana.textHtml(explain(n)) }) : null,
        ].filter(Boolean)),
        [
          { label: 'Cancel', fn: () => { this.asking = null; this.render(); } },
          { label: 'Activate', cls: 'primary', fn: () => { this.asking = null; this.render(); onDone(n); } },
        ], { card }) };
      this.render();
    }

    startTargeting(t) {
      this.targeting = Object.assign({ chosen: [] }, t);
      this.render();
      // a spell with exactly one legal target in the whole game takes it
      const live = this.view;
      if (!t.legal && t.need === 1 && !(t.specs[0] || {}).upTo && MTG.settings.autoTarget !== false) {
        const objs = live.battlefield.filter(o => this.isTargetable(o)).concat((live.stack || []).filter(s => this.isTargetableStack(s)));
        const players = live.players.filter(p => this.isTargetablePlayer(p));
        if (objs.length + players.length === 0) {
          UI.error('There is nothing it could target.');
          this.cancelTargeting();
          this.render();
        }
      }
    }

    /* ---------------- the popover beside a permanent ---------------- */
    popover(anchor, o, uses) {
      this.closePopover();
      const r = U.rect(anchor);
      const pop = el('div', { class: 'arena-pop', role: 'menu' }, [
        el('div', { class: 'pop-title', text: o.card.name }),
        ...uses.map(u => el('button', {
          type: 'button', class: 'pop-item' + (u.mana ? ' mana' : '') + (u.loyalty ? ' loy' : ''), role: 'menuitem',
          disabled: !!u.off, title: u.off || null,
          onclick: (e) => { e.stopPropagation(); this.closePopover(); u.fn(); },
        }, [
          u.cost ? el('span', { class: 'pop-cost', html: u.loyalty
            ? `<b class="loy-cost${/^[-−]/.test(u.cost) ? ' minus' : ''}">${escapeHtml(u.cost)}</b>`
            : MTG.mana.textHtml(u.cost) }) : null,
          el('span', { class: 'pop-label', html: MTG.mana.textHtml(truncate(u.text || u.label, 120)) }),
        ].filter(Boolean))),
      ]);
      this.arena.appendChild(pop);
      const ar = U.rect(this.arena);
      const pw = pop.offsetWidth, ph = pop.offsetHeight;
      let x = r.right + 10 - ar.left, y = r.top - ar.top + r.height / 2 - ph / 2;
      if (x + pw > ar.width - 10) x = r.left - ar.left - pw - 10;
      y = U.clamp(y, 10, ar.height - ph - 10);
      pop.style.left = x + 'px';
      pop.style.top = y + 'px';
      this._popover = pop;
      MTG.sfx('click');
    }
    closePopover() { if (this._popover) { this._popover.remove(); this._popover = null; } }

    /* ---------------- reading a card ---------------- */

    hoverCard(node, e) {
      clearTimeout(this._hoverT);
      if (node.closest('.hslot')) {                                   // the hand lifts its own cards
        this.hidePreview();
        // and a card that cannot be played says why, once you have rested on it
        this._hoverT = setTimeout(() => this.handTip(node), 320);
        return;
      }
      if (node.closest('.mull-hand')) return;
      this._hoverT = setTimeout(() => this.showPreview(node), node.closest('.stack-col, .spotlight') ? 60 : 220);
    }
    /** @type {(node?: Element) => void} */
    unhoverCard() { clearTimeout(this._hoverT); this.hidePreview(); this.hideTip(); }

    /**
     * Why a card of yours cannot be played right now, as the engine sees it
     * ({text, html}), or null if it can be, or if there is nothing to say.
     * Waiting for priority names who has it; not enough mana shows what is
     * missing, colour by colour.
     */
    whyNot(id) {
      const live = this.live || this.view;
      if (!live || live.over || live.mulliganPhase || live.spectating || live.replay || !this.me) return null;
      if ((live.playable || []).includes(id)) return null;
      const why = (live.unplayable || {})[id];
      if (!why) return null;
      if (why.code === 'priority') {
        const ch = live.pendingChoice;
        const who = live.players.find(p => p.id === (ch ? ch.playerId : live.priorityPlayer));
        const text = ch && ch.playerId !== this.meId
          ? `Waiting: ${who ? who.name : 'someone'} is making a choice.`
          : `Waiting for priority: ${who && who.id !== this.meId ? who.name + (who.isBot ? ' is thinking.' : ' has it.') : 'it comes back to you shortly.'}`;
        return { text, html: escapeHtml(text) };
      }
      if (why.code === 'mana' && why.missing) {
        const m = why.missing;
        const syms = ['W', 'U', 'B', 'R', 'G'].map(c => (`{${c}}`).repeat(m[c] || 0)).join('') + (m.generic ? `{${m.generic}}` : '');
        const words = ['W', 'U', 'B', 'R', 'G'].filter(c => m[c]).map(c => `${m[c]} ${MTG.mana.COLOR_NAMES[c].toLowerCase()}`)
          .concat(m.generic ? [`${m.generic} more of any colour`] : []);
        if (syms) return { text: `Not enough mana: you need ${words.join(' and ')}.`, html: `Not enough mana. You need ${MTG.mana.html(syms)} more.` };
      }
      return { text: why.text, html: escapeHtml(why.text) };
    }

    /** The reason a card in your hand cannot be played, held up above it. */
    handTip(node) {
      if (!node || !node.isConnected || this.targeting || !this._ready()) return;
      const why = this.whyNot(node.dataset.id);
      if (!why) return;
      const html = `<b class="tip-head">Can’t play this yet</b>${why.html}`;
      this.showTip(node, html, { cls: 'why' });
      // the card is still rising out of the fan; measure again once it has
      clearTimeout(this._tipAgain);
      this._tipAgain = setTimeout(() => { if (this._tipFor === node && node.matches(':hover')) this.showTip(node, html, { cls: 'why' }); }, 260);
    }

    /** A small note pinned above (or below) a node on the table. */
    showTip(anchor, html, opts) {
      opts = opts || {};
      const tip = this.tipEl;
      if (!tip || !anchor || !anchor.isConnected) return;
      tip.className = 'arena-tip on' + (opts.cls ? ' ' + opts.cls : '');
      tip.innerHTML = html;
      const ar = U.rect(this.arena);
      const r = U.rect(anchor);
      const tw = tip.offsetWidth, th = tip.offsetHeight;
      let x = r.left - ar.left + r.width / 2 - tw / 2;
      let y = r.top - ar.top - th - 10;
      if (y < 8) { y = r.bottom - ar.top + 10; tip.classList.add('below'); }
      x = U.clamp(x, 8, ar.width - tw - 8);
      tip.style.left = x + 'px';
      tip.style.top = y + 'px';
      anchor.setAttribute('aria-describedby', 'arenaTip');
      this._tipFor = anchor;
    }
    /** A portrait tapped: the player in a few words, beside it, for a moment. */
    seatTip(pid, anchor) {
      const p = (this.view.players || []).find(x => x.id === pid);
      if (!p || !anchor) return;
      const bot = this.botWords(p);
      this.showTip(anchor, `<b class="tip-head">${escapeHtml(p.name)} · ${p.life} life</b>` + (bot ? `${escapeHtml(bot)}<br>` : '') +
        `${p.handSize} in hand · ${p.librarySize} in library`, { cls: 'seat' });
      clearTimeout(this._seatTipT);
      this._seatTipT = setTimeout(() => { if (this._tipFor === anchor) this.hideTip(); }, 2600);
    }
    hideTip() {
      if (this.tipEl) this.tipEl.classList.remove('on');
      if (this._tipFor) { this._tipFor.removeAttribute('aria-describedby'); this._tipFor = null; }
    }
    hidePreview() { this.preview.classList.remove('on'); }

    /**
     * The big card at the side of the screen, and underneath it what is true
     * about it right now that the printed card cannot tell you: its real
     * power, the counters on it, what it has been given and what it is doing.
     */
    showPreview(node) {
      if (!MTG.settings.showOracleOnHover) return;
      // nothing under a full-screen panel is what you are looking at
      if (this.decision.classList.contains('full')) return;
      let o = null;
      if (node.dataset.id) o = this.objIn(node.dataset.id) || (() => {
        const s = (this.view.stack || []).find(x => x.objId === node.dataset.id);
        return s ? { id: s.objId, card: s.card, textNow: s.textNow } : null;
      })();
      if (!o && node.dataset.preview) {
        const h = this.history.find(x => x.key === node.dataset.preview);
        if (h && h.card) o = { card: h.card };
      }
      if (!o && node.dataset.stack) {
        const s = (this.view.stack || []).find(x => x.id === node.dataset.stack);
        if (s && s.card) o = { card: s.card, abilityText: s.abilityText, textNow: s.kind === 'spell' ? s.textNow : undefined };
      }
      if (!o || !o.card || o.hidden) return;
      const p = this.preview;
      p.innerHTML = '';
      const faces = o.card.card_faces && o.card.card_faces.length > 1 && o.card.card_faces[0].image_uris ? o.card.card_faces.length : 1;
      const imgs = el('div', { class: 'pv-imgs' });
      for (let i = 0; i < faces; i++) {
        const url = MTG.scry.imageUrl(o.card, UI.bigSize(Math.min(300, U.viewH() * 0.3)), faces > 1 ? i : (o.face || 0)) || MTG.scry.imageUrl(o.card, 'normal', i);
        if (url) imgs.appendChild(el('img', { src: url, alt: o.card.name }));
        else imgs.appendChild(UI.cardTextBlock(o.card, i));
      }
      const main = el('div', { class: 'pv-main' }, [imgs]);
      const notes = this.cardNotes(o);
      // a modal spell or trigger on the stack: the modes chosen for it, as its caption says them
      const onStack = node.closest('.stack-col, .spotlight') ? (this.view.stack || []).find(x => (node.dataset.stack && x.id === node.dataset.stack) ||
        (node.dataset.id && x.objId === node.dataset.id)) : null;
      const modes = onStack && (onStack.modes || []).length ? 'Chosen: ' + onStack.modes.join('; ') : '';
      if (notes.length || MTG.settings.alwaysCardText || o.abilityText || modes) {
        main.appendChild(el('div', { class: 'pv-notes' }, [
          o.abilityText ? el('div', { class: 'pv-ab', html: MTG.mana.textHtml(o.abilityText) }) : null,
          modes ? el('div', { class: 'pv-ab', html: MTG.mana.textHtml(modes) }) : null,
          ...notes.map(noteNode),
          MTG.settings.alwaysCardText ? UI.cardTextBlock(o.card, o.face || 0) : null,
        ].filter(Boolean)));
      }
      // what its keywords mean to the card's left, the tokens it makes to its right
      const sides = UI.cardSides(o.card, { keywords: o.keywords, auto: true });
      p.classList.remove('stacked');
      p.replaceChildren(...[sides.keywords, main, sides.tokens].filter(Boolean));
      const r = U.rect(node);
      const left = r.left + r.width / 2 > U.viewW() / 2;
      p.classList.toggle('left', left);
      p.classList.toggle('right', !left);
      p.classList.add('on');
      /* no room for a column each side, or they would cover the card being
         looked at: both in one, toward the middle of the table; and if even
         that covers it, the card alone, as it always was */
      if (sides.keywords || sides.tokens) {
        const hits = (b) => b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top;
        let b = U.rect(p);
        if (b.left < 4 || b.right > U.viewW() - 4 || hits(b)) {
          p.classList.add('stacked');
          p.replaceChildren(main, UI.stackSides(sides));
          b = U.rect(p);
          if (hits(b)) { p.classList.remove('stacked'); p.replaceChildren(main); }
        }
        UI.fitSides(p);
      }
      this._hoverNode = node;
    }

    /**
     * Who knows a card in a hand or on top of a library, in words: { short, long, all } or null when there is nothing
     * to say (your own hand card nobody else has seen). `seenBy` is 'all' for a revealed card, else the players who
     * looked; a card of somebody else's you can see is one you know.
     */
    seenLabel(o) {
      if (!o || o.hidden || !o.card) return null;
      const me = this.meId;
      const by = o.seenBy;
      const nameOf = (id) => (id === me ? 'you' : ((this.view.players || []).find(p => p.id === id) || {}).name || 'a player');
      const list = (ids) => ids.length < 3 ? ids.join(' and ') : ids.slice(0, -1).join(', ') + ' and ' + ids[ids.length - 1];
      const lib = o.zone === 'library';
      const where = lib ? 'on top of the library' : 'in this hand';
      if (by === 'all') return { all: true, short: 'Revealed', long: `Revealed: everybody knows this card is ${where}` };
      const others = (Array.isArray(by) ? by : []).filter(id => id !== o.owner || lib);
      if (o.owner === me) {
        if (lib) {
          const rest = others.filter(id => id !== me);
          return { all: false, short: rest.length ? 'Seen' : 'Only you', long: rest.length ? `Known to ${list(['you'].concat(rest.map(nameOf)))}` : 'Only you can see this card' };
        }
        return others.length ? { all: false, short: 'Seen', long: `Seen by ${list(others.map(nameOf))}: they know this card is in your hand` } : null;
      }
      const rest = others.filter(id => id !== me);
      return { all: false, short: 'Seen', long: `You ${lib ? 'know' : 'saw'} this card${rest.length ? ` (so ${rest.length === 1 ? 'does' : 'do'} ${list(rest.map(nameOf))})` : ''}: it is still ${where}` };
    }

    cardNotes(o) {
      const out = [];
      /* layer 3 (CR 612): words a text-changing effect has changed (Mind Bend;
         Deadpool, Trading Card) are what the card says now, not what is printed */
      if (o.textNow != null) out.push(['textnow', o.textNow]);
      // who knows a card in a hand or on top of a library
      if (o.zone === 'hand' || o.zone === 'library') { const sl = this.seenLabel(o); if (sl) out.push(['info', sl.long]); }
      if (o.zone !== 'battlefield' && !this.view.battlefield.some(x => x.id === o.id)) return out;
      const a = this.analysis(o);
      if (o.power != null && a && (String(o.power) !== String(a.power) || String(o.toughness) !== String(a.toughness)))
        out.push(['pt', `Now ${o.power}/${o.toughness} (printed ${a.power}/${a.toughness})`]);
      if (o.damage) out.push(['bad', `${o.damage} damage marked`]);
      const printed = new Set(((a && a.keywords) || []).map(k => String(k.keyword || k).toLowerCase()));
      const granted = (o.keywords || []).filter(k => !printed.has(String(k).toLowerCase()));
      if (granted.length) out.push(['good', 'Has ' + granted.map(k => U.titleCase ? U.titleCase(String(k)) : k).join(', ')]);
      for (const [k, n] of Object.entries(o.counters || {})) if (n) out.push(['', `${n} ${k} counter${n === 1 ? '' : 's'}`]);
      if (o.summoningSick && o.power != null) out.push(['dim', 'Summoning sick: can’t attack, or use abilities with the tap symbol, this turn']);
      if (o.tapped) out.push(['dim', 'Tapped']);
      if (o.attacking) out.push(['bad', 'Attacking ' + this.targetName({ kind: this.view.players.some(p => p.id === o.attacking) ? 'player' : 'object', id: o.attacking })]);
      if ((o.blocking || []).length) out.push(['info', 'Blocking ' + o.blocking.map(id => this.targetName({ kind: 'object', id })).join(', ')]);
      const atts = this.view.battlefield.filter(x => x.attachedTo === o.id);
      if (atts.length) out.push(['', 'With ' + atts.map(x => x.card.name).join(', ')]);
      if (o.perpetual) {
        const d = perpetualWords(o.perpetual);
        if (d.long.length) out.push(['info', 'Perpetually: ' + d.long.join('; ')]);
      }
      if (o.attachedTo) {
        const onPlayer = this.view.players.some(p => p.id === o.attachedTo);   // a Curse enchants a player
        out.push(['', (onPlayer ? 'Enchanting ' : 'Attached to ') + this.targetName({ kind: onPlayer ? 'player' : 'object', id: o.attachedTo })]);
      }
      if (o.controller !== o.owner) {
        const ow = this.view.players.find(p => p.id === o.owner);
        out.push(['info', `Owned by ${ow ? ow.name : 'someone else'}`]);
      }
      if (o.note) out.push(['', o.note]);
      if (a && !a.fullyAutomated) out.push(['warn', 'Some of this card’s text is not automated.']);
      return out;
    }

    showCard(id, opts) {
      opts = opts || {};
      const o = this.objIn(id) || (() => {
        const s = (this.view.stack || []).find(x => x.objId === id || x.id === id);
        return s && s.card ? { id, card: s.card } : null;
      })();
      if (!o || !o.card || o.hidden) return;
      this.hidePreview();
      if (MTG.isPhone()) return UI.cardSheet(o.card, { keywords: o.keywords, onActions: opts.actions ? (ev) => this.cardMenu(id, ev) : null });
      const card = o.card;
      const faces = card.card_faces && card.card_faces.length > 1 && card.card_faces[0].image_uris ? card.card_faces.length : 1;
      const imgs = el('div', { class: 'cardview-imgs' });
      for (let i = 0; i < faces; i++) {
        const url = MTG.scry.imageUrl(card, UI.bigSize(Math.min(U.viewH() * 0.78, 560) * 63 / 88), faces > 1 ? i : (o.face || 0));
        imgs.appendChild(url ? el('img', { src: url, alt: card.name }) : UI.cardFallback(card, i));
      }
      const notes = this.cardNotes(o);
      // keywords to the card's left where there is room (otherwise in the panel), tokens in the panel to its right
      const sides = UI.cardSides(card, { keywords: o.keywords });
      // beside the card only when the card, the keywords and the panel all fit (a double-faced card is two wide)
      const imgH = Math.min(U.viewH() * 0.78, 560);
      const roomy = UI.roomForSides() && 264 + 22 + faces * imgH * 63 / 88 + (faces - 1) * 10 + 22 + 320 <= U.viewW() * 0.94;
      const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); };
      const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
      const back = el('div', { class: 'cardview', onclick: close }, [
        el('div', { class: 'cardview-inner', onclick: (e) => e.stopPropagation() }, [
          roomy ? sides.keywords : null,
          imgs,
          el('div', { class: 'cardview-side' }, [
            el('h3', { text: card.name }),
            el('div', { class: 'cv-type', text: card.type_line || '' }),
            el('div', { class: 'cv-text', html: MTG.mana.textHtml(card.oracle_text || (card.card_faces || []).map(f => f.oracle_text).join('\n\n') || '') }),
            notes.length ? el('div', { class: 'cv-notes' }, notes.map(noteNode)) : null,
            sides.tokens,
            roomy ? null : sides.keywords,
            el('div', { class: 'cv-meta', text: `${card.set_name || ''}${card.artist ? ' · ' + card.artist : ''}` }),
            // its rulings (src/10g-rulings.js)
            UI.rulingsBox ? UI.rulingsBox(card) : null,
            el('div', { class: 'row', style: { marginTop: 'auto' } }, [
              el('button', { class: 'btn sm', text: 'Choose art…', onclick: () => { close(); UI.pickArt(card); } }),
              el('span', { class: 'grow' }),
              // everything else it can do, as the right-click once showed (opened from your hand)
              opts.actions ? el('button', { class: 'btn sm', text: 'Actions…', onclick: (ev) => {
                const r = ev.currentTarget.getBoundingClientRect();
                close();
                this.cardMenu(id, { clientX: r.left, clientY: r.top, preventDefault() {} });
              } }) : null,
              el('button', { class: 'btn sm primary', text: 'Close', onclick: close }),
            ]),
          ].filter(Boolean)),
        ].filter(Boolean)),
      ]);
      document.addEventListener('keydown', onKey, true);
      document.body.appendChild(back);
    }

    /**
     * Right-click on a card: everything it can do, then everything you can
     * do to it by hand. The second half is a toolbox for the rare card the
     * rules engine does not carry out itself, so it sits behind a heading
     * rather than among the real choices.
     * @this {MTG.TableInstance}
     */
    cardMenu(id, e) {
      const loc = this.locate(id);
      if (!loc || !loc.o) { if (loc) this.showCard(id); return; }
      const o = loc.o;
      const mine = loc.player === this.meId;
      const a = this.analysis(o);
      const items = [];
      const live = this.live || this.view;
      if (loc.zone === 'hand' && mine) {
        if (a && a.isLand) items.push(['Play this land', () => this.playFromHand(o)]);
        else items.push(['Cast it', () => this.playFromHand(o)]);
        for (const use of ((live.uses || {})[o.id] || [])) {
          if (use.kind === 'cycle') items.push([use.label, () => this._cycleUse(o, a, use)]);
          else if (use.kind === 'plot') items.push([use.label, () => this.send({ kind: 'plot', objId: o.id })]);
          else if (use.kind === 'foretell') items.push([use.label, () => this.send({ kind: 'foretell', objId: o.id })]);
          else if (use.kind === 'suspend') items.push([use.label, () => this._suspendUse(o, use)]);
          else if (use.kind === 'transmute') items.push([use.label, () => this.send({ kind: 'transmute', objId: o.id })]);
          else if (use.kind === 'cast' && use.via === 'morph') items.push([use.label, () => this.send({ kind: 'cast', objId: o.id, targets: [], via: 'morph' })]);
          else if (use.kind === 'cast') items.push([use.label, () => this.castUse(o, a, use)]);
        }
      } else if ((loc.zone === 'graveyard' || loc.zone === 'exile') && (mine ||
          // The Great Work: an opponent's instant or sorcery you may cast from their graveyard
          (loc.zone === 'graveyard' && ((live.uses || {})[o.id] || []).length))) {
        if (loc.zone === 'exile' && (live.playable || []).includes(o.id) && !((live.uses || {})[o.id] || []).length) {
          items.push([a && a.isLand ? 'Play this land' : 'Cast it', () => this.playFromHand(o)]);
        }
        for (const use of ((live.uses || {})[o.id] || [])) {
          if (use.kind === 'cast') items.push([use.label, () => this.castUse(o, a, use)]);
          if (use.kind === 'encore') items.push([use.label, () => this.send({ kind: 'encore', objId: o.id })]);
        }
      } else if (loc.zone === 'library' && mine) {
        // the top of your library: played from there, or plotted (Fblthp, Lost on the Range)
        if ((live.playable || []).includes(o.id) && !((live.uses || {})[o.id] || []).length) {
          items.push([a && a.isLand ? 'Play this land' : 'Cast it', () => this.playFromHand(o)]);
        }
        for (const use of ((live.uses || {})[o.id] || [])) if (use.kind === 'plot') items.push([use.label, () => this.send({ kind: 'plot', objId: o.id })]);
      } else if (loc.zone === 'command' && mine && o.companion) {
        // the companion, revealed outside the game: {3} into your hand, once a game, when you could cast a sorcery
        items.push(['Put it into your hand ({3})', () => this.useCompanion(o)]);
      } else if (loc.zone === 'command' && mine && !o.agenda && (o.isCommander || o.isSignature)) {
        items.push(['Cast it', () => this.playFromHand(o)]);
        // Yuriko's commander ninjutsu, from here as from a hand
        for (const use of ((live.uses || {})[o.id] || [])) if (use.kind === 'cast') items.push([use.label, () => this.castUse(o, a, use)]);
        // Derevi: "{1}{G}{W}{U}: Put Derevi onto the battlefield from the command zone."
        for (const [ab, idx] of this._commandZoneAbilities(o)) items.push([truncate(MTG.oracle.abilityLabel(ab, o), 52), () => this.activate(o, a, idx, ab)]);
      } else if (loc.zone === 'command' && mine && o.agenda) {
        items.push(['Turn this hidden agenda face up', () => this.send({ kind: 'manual', action: 'revealAgenda', objId: o.id })]);
      } else if (loc.zone === 'battlefield' && mine && a) {
        const acts = (a.abilities || []).filter(x => x.kind === 'activated' || x.kind === 'loyalty');
        // (Marvin: what it was given beyond its printed abilities, by the engine's index for each: o.gained)
        const gained = (o.gained && o.gained.list) || [];
        const gActs = gained.filter(g => !g.mana), gMana = gained.filter(g => g.mana);
        a.manaAbilities.forEach((ab, i) => items.push([`Mana: ${truncate(MTG.oracle.abilityLabel(ab, o), 42)}`, () => this.tapMana(o, i, ab)]));
        for (const g of gMana) items.push([`Mana: ${truncate(MTG.oracle.abilityLabel(g.ability, o), 42)}`, () => this.tapMana(o, g.i, g.ability)]);
        for (const m of (o.manaExtra || [])) items.push([`Mana: ${truncate(m.label, 42)}`, () => this.tapMana(o, m.i, null)]);
        const actBase = o.gained ? o.gained.manaBase : a.manaAbilities.length;
        acts.concat(gActs.map(g => g.ability)).forEach((ab, k) => {
          const idx = k < acts.length ? actBase + k : gActs[k - acts.length].i;
          items.push([truncate(MTG.oracle.abilityLabel(ab, o), 52), () => this.activate(o, a, idx, ab)]);
        });
        for (const use of ((live.uses || {})[o.id] || [])) {
          if (use.kind === 'cast' && use.via === 'prepared') items.unshift([use.label, () => this.castPrepared(o)]);
        }
      }
      items.push(['Look at this card', () => this.showCard(o.id)]);
      if (mine) {
        const manual = this.manualItems(o, loc.zone);
        if (manual.length) items.push('-', ['By hand ▸', (ev) => UI.contextMenu(ev || e, manual, { title: 'Move or mark by hand' })]);
      }
      UI.contextMenu(e || { clientX: window.innerWidth / 2, clientY: window.innerHeight / 2 }, items, { title: o.card ? o.card.name : 'Card' });
    }

    /** A card's abilities that work from the command zone, each with the index activateAbility takes. */
    _commandZoneAbilities(o) {
      const a = this.analysis(o);
      if (!a) return [];
      const acts = (a.abilities || []).filter(x => x.kind === 'activated' || x.kind === 'loyalty');
      return acts.filter(x => x.fromCommandZone).map(x => [x, (a.manaAbilities || []).length + acts.indexOf(x)]);
    }

    /** The companion into your hand: the game pays the {3} (CR 702.139). */
    useCompanion(o) {
      MTG.sfx('ui_play');
      this.send({ kind: 'companion', objId: o.id });
    }

    manualItems(o, zone) {
      const send = (action, extra) => () => this.send(Object.assign({ kind: 'manual', action, objId: o.id }, extra || {}));
      const items = [];
      if (zone === 'battlefield') {
        items.push([o.tapped ? 'Untap' : 'Tap', send('tap')]);
        items.push(['Add a +1/+1 counter', send('counter', { kind2: '+1/+1', n: 1 })]);
        items.push(['Add a counter…', async () => {
          const k = await UI.prompt('Counter kind', '+1/+1');
          if (!k) return;
          const n = parseInt(await UI.prompt('How many? (negative removes)', '1'), 10) || 1;
          this.send({ kind: 'manual', action: 'counter', objId: o.id, kind2: k, n });
        }]);
        if (o.card && o.card.card_faces && o.card.card_faces.length > 1) items.push(['Transform', send('transform')]);
      }
      if (zone !== 'graveyard') items.push(['To graveyard', send('move', { zone: 'graveyard' })]);
      if (zone !== 'exile') items.push(['To exile', send('move', { zone: 'exile' })]);
      if (zone !== 'hand') items.push(['To hand', send('move', { zone: 'hand' })]);
      if (zone !== 'battlefield') items.push(['To battlefield', send('move', { zone: 'battlefield' })]);
      items.push(['To top of library', send('move', { zone: 'library' })]);
      items.push(['To bottom of library', send('move', { zone: 'library', toBottom: true })]);
      if (zone === 'hand') items.push(['Reveal it', send('reveal')]);
      const a = this.analysis(o);
      if (a && a.needsManual) items.push(['Resolve its text by hand…', () => this.manualResolve(o, a)]);
      return items;
    }

    manualResolve(o, a) {
      const lines = a.abilities.filter(x => !x.auto && x.kind !== 'castModifier');
      const list = el('div');
      for (const ab of lines) list.appendChild(el('div', { class: 'panel', style: { marginBottom: '8px' } }, [
        el('div', { html: MTG.mana.textHtml(ab.text) }),
      ]));
      list.appendChild(el('p', { class: 'tiny dim', text: 'Use the table tools in the game menu to carry this out, then mark it resolved.' }));
      const m = UI.modal({
        title: 'By hand — ' + o.card.name, width: '600px', content: list,
        buttons: [{ label: 'Mark resolved', class: 'primary', onClick: () => {
          this.send({ kind: 'manual', action: 'resolveManual', text: o.card.name });
          m.close();
        } }],
      });
    }

    openZone(p, zone) {
      const objs = (p[zone] || []).filter(o => !o.hidden && o.card);
      const mine = p.id === this.meId;
      const live = this.live || this.view;
      const grid = el('div', { class: 'zone-grid' });
      for (const o of objs.slice().reverse()) {
        // (The Great Work: an opponent's graveyard holds cards you may cast too)
        const uses = mine || zone === 'graveyard' ? ((live.uses || {})[o.id] || []) : [];
        const tile = el('button', { type: 'button', class: 'zone-tile' + (uses.length ? ' usable' : ''), title: o.card.name }, [
          el('div', { class: 'zt-img', style: { backgroundImage: 'url("' + (MTG.scry.imageUrl(o.card, 'normal', o.face || 0) || '').replace(/"/g, '%22') + '")' } }),
          uses.length ? el('span', { class: 'zt-use', text: uses[0].label }) : null,
        ].filter(Boolean));
        tile.addEventListener('click', (e) => {
          if (mine || uses.length) { m.close(); this.cardMenu(o.id, e); } else { this.showCard(o.id); }
        });
        UI.attachPreview(tile, o.card, o.face || 0);
        grid.appendChild(tile);
      }
      if (!objs.length) grid.appendChild(el('div', { class: 'empty-note', text: 'Nothing here.' }));
      const m = UI.modal({ title: `${mine ? 'Your' : p.name + '’s'} ${zone} · ${objs.length}`, width: '900px', content: grid });
    }

    /* ---------------- the game menu ---------------- */
    /** @this {MTG.TableInstance} */
    gameMenu(e) {
      const concede = async () => { if (await UI.confirm('Concede this game?')) this.send({ kind: 'concede' }); };
      const sorts = [['cmc', 'mana value'], ['type', 'type'], ['color', 'colour'], ['name', 'name']];
      const cur = MTG.settings.handSort || 'cmc';
      const nextSort = sorts[(sorts.findIndex(s => s[0] === cur) + 1) % sorts.length];
      /** @type {Partial<MTG.View>} */
      const live = this.live || this.view || {};
      /* a phone has no keys to press: its menu leaves the shortcuts off (a
         touch screen with a mouse about, a laptop's, likely has a keyboard too) */
      const keys = !MTG.isTouch() || !!(window.matchMedia && window.matchMedia('(any-pointer: fine)').matches);
      const key = (k) => keys ? '  ' + k : '';
      UI.contextMenu(e, [
        ['Game log' + key('(L)'), () => this.toggleDrawer(true, 'log')],
        UI.keyboardHelp && keys ? ['Keyboard  (?)', () => UI.keyboardHelp()] : null,
        MTG.net && MTG.net.online ? ['Chat', () => this.toggleDrawer(true, 'chat')] : null,
        [`Sort hand by ${nextSort[1]}`, () => { MTG.setSetting('handSort', nextSort[0]); this.render(); }],
        [`Pace: ${paceName(MTG.settings.animSpeed)}  → ${paceName(nextPace(MTG.settings.animSpeed))}`,
          () => MTG.setSetting('animSpeed', nextPace(MTG.settings.animSpeed))],
        [`Bots: ${botPaceName(MTG.settings.botSpeed)}  → ${botPaceName(nextBotPace(MTG.settings.botSpeed))}`,
          () => MTG.setSetting('botSpeed', nextBotPace(MTG.settings.botSpeed))],
        [live.fullControl ? 'Full control: on' : 'Full control: off' + key('(Ctrl)'), () => this.send({ kind: 'fullControl', on: !live.fullControl, sticky: !live.fullControl })],
        this.isReplay ? null : ['Table tools ▸', (ev) => this.toolsMenu(ev || e)],
        MTG.app.canSaveReplay && MTG.app.canSaveReplay() ? ['Save replay', () => MTG.app.saveReplay()] : null,
        '-',
        // (a finished game has nothing left to save)
        this.isReplay ? ['Stop watching', () => MTG.app.leaveGame({ keepSave: true })] : [this.view.over ? 'Leave the game' : 'Save and leave', () => MTG.app.exitToMenu()],
        this.me && !this.view.over && !this.isReplay ? ['Concede', concede] : null,
      ].filter(Boolean), { title: 'Game' });
    }

    toolsMenu(e) {
      const ask = async (q, def) => parseInt(await UI.prompt(q, def), 10);
      UI.contextMenu(e, [
        ['Draw a card', () => this.send({ kind: 'manual', action: 'draw', n: 1 })],
        ['Mill N…', async () => { const n = await ask('Mill how many?', '1'); if (n) this.send({ kind: 'manual', action: 'mill', n }); }],
        ['Shuffle library', () => this.send({ kind: 'manual', action: 'shuffle' })],
        '-',
        ['Gain life…', async () => { const n = await ask('Gain how much life?', '1'); if (n) this.send({ kind: 'manual', action: 'life', n }); }],
        ['Lose life…', async () => { const n = await ask('Lose how much life?', '1'); if (n) this.send({ kind: 'manual', action: 'life', n: -n }); }],
        ['Add poison…', async () => { const n = await ask('Poison counters to add', '1'); if (n) this.send({ kind: 'manual', action: 'poison', n }); }],
        ['Add energy…', async () => { const n = await ask('Energy to add', '1'); if (n) this.send({ kind: 'manual', action: 'energy', n }); }],
        ['Create a token…', () => this.tokenDialog()],
        '-',
        ['Become the monarch', () => this.send({ kind: 'manual', action: 'monarch' })],
        ['Take the initiative', () => this.send({ kind: 'manual', action: 'initiative' })],
        ['Roll a d20', () => this.send({ kind: 'manual', action: 'roll', sides: 20 })],
        ['Roll other dice ▸', (ev) => this.diceMenu(ev || e)],
        ['Flip a coin', () => this.send({ kind: 'manual', action: 'coin' })],
        ['Untap everything', () => this.send({ kind: 'manual', action: 'untapAll' })],
      ], { title: 'Table tools — for by-hand fixes' });
    }

    /** Dice rolled by hand, one or a few together: everybody sees them land in the middle of the table. */
    diceMenu(e) {
      const roll = (sides, n) => () => this.send(Object.assign({ kind: 'manual', action: 'roll', sides }, n > 1 ? { n } : {}));
      UI.contextMenu(e, [
        ['Roll a d4', roll(4)], ['Roll a d6', roll(6)], ['Roll two d6', roll(6, 2)], ['Roll a d8', roll(8)],
        ['Roll a d10', roll(10)], ['Roll a d12', roll(12)], ['Roll two d20', roll(20, 2)],
      ], { title: 'Roll dice' });
    }

    tokenDialog() {
      const pt = el('input', { type: 'text', value: '1/1' });
      const sub = el('input', { type: 'text', value: 'Soldier' });
      const kw = el('input', { type: 'text', placeholder: 'flying, vigilance' });
      const col = el('input', { type: 'text', placeholder: 'white' });
      const n = el('input', { type: 'number', value: '1', min: '1', max: '20' });
      const m = UI.modal({
        title: 'Create a token', width: '460px',
        content: el('div', null, [
          el('label', { class: 'field' }, [el('span', { text: 'Power/toughness' }), pt]),
          el('label', { class: 'field' }, [el('span', { text: 'Creature types' }), sub]),
          el('label', { class: 'field' }, [el('span', { text: 'Colours (words, comma separated)' }), col]),
          el('label', { class: 'field' }, [el('span', { text: 'Keywords' }), kw]),
          el('label', { class: 'field' }, [el('span', { text: 'How many' }), n]),
        ]),
        buttons: [{ label: 'Create', class: 'primary', onClick: () => {
          this.send({ kind: 'manual', action: 'token', token: {
            n: parseInt(n.value, 10) || 1, pt: pt.value || '1/1', subtypes: sub.value || 'Creature',
            colorWords: col.value.split(/,\s*/).filter(Boolean),
            keywords: kw.value.split(/,\s*/).filter(Boolean),
          } });
          m.close();
        } }],
      });
    }

    /* ---------------- the drawer: log and chat ---------------- */
    toggleDrawer(on, tab) {
      this.drawerOpen = on == null ? !this.drawerOpen : !!on;
      if (tab) this.drawerTab = tab;
      this.arena.classList.toggle('drawer-open', this.drawerOpen);
      this._drawerSig = null;
      if (this.drawerOpen) this.renderDrawer();
    }

    renderDrawer() {
      const v = this.view;
      const d = this.drawer;
      if (!d._built) {
        d._built = true;
        d._tabs = el('div', { class: 'drawer-tabs' });
        d._body = el('div', { class: 'drawer-body' });
        d._input = el('input', { type: 'text', placeholder: 'Say something…', class: 'drawer-input' });
        d._input.addEventListener('keydown', (e) => {
          if (e.key !== 'Enter' || !d._input.value.trim()) return;
          this.send({ kind: 'chat', text: d._input.value.trim() });
          d._input.value = '';
        });
        d.append(d._tabs, d._body, d._input);
      }
      const online = !!(MTG.net && MTG.net.online);
      d._tabs.innerHTML = '';
      for (const [id, label] of [['log', 'Log'], online ? ['chat', 'Chat'] : null].filter(Boolean)) {
        d._tabs.appendChild(el('button', { type: 'button', class: 'dtab' + (this.drawerTab === id ? ' on' : ''), text: label,
          onclick: () => { this.drawerTab = id; this._drawerSig = null; this.renderDrawer(); } }));
      }
      d._tabs.appendChild(el('span', { class: 'grow' }));
      d._tabs.appendChild(el('button', { type: 'button', class: 'dtab close', text: '✕', title: 'Close (L)', onclick: () => this.toggleDrawer(false) }));
      d._input.style.display = this.drawerTab === 'chat' ? '' : 'none';
      const sig = this.drawerTab + (this.drawerTab === 'log' ? v.log.length + ':' + (v.log.length ? v.log[v.log.length - 1].text : '') : this.chat.length);
      if (sig === this._drawerSig) return;
      this._drawerSig = sig;
      d._body.innerHTML = '';
      if (this.drawerTab === 'log') {
        let turn = null;
        for (const e of v.log.slice(-200)) {
          if (e.turn !== turn && e.turn) { turn = e.turn; d._body.appendChild(el('div', { class: 'log-turn', text: 'Turn ' + turn })); }
          d._body.appendChild(el('div', { class: 'log-line t-' + e.type, html: this.logHtml(e.text) }));
        }
      } else {
        for (const c of this.chat.slice(-100)) {
          d._body.appendChild(el('div', { class: 'chat-msg' }, [el('b', { text: c.from + ' ' }), el('span', { text: c.text })]));
        }
      }
      d._body.scrollTop = d._body.scrollHeight;
    }

    /** A log line with the players' names picked out. */
    logHtml(text) {
      let h = escapeHtml(text || '');
      for (const p of this.view.players) {
        if (!p.name) continue;
        const re = new RegExp('\\b' + p.name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\b', 'g');
        h = h.replace(re, `<b class="${p.id === this.meId ? 'me' : 'them'}">${escapeHtml(p.id === this.meId ? p.name : p.name)}</b>`);
      }
      // symbols in a line of words sit on the words' middle (.pip.in-text), not on their baseline as a cost does
      return MTG.mana.textHtml ? h.replace(/\{[^}]+\}/g, (m) => MTG.mana.html(m).replace(/class="pip /g, 'class="pip in-text ')) : h;
    }

    /** @this {MTG.TableInstance} */
    addChat(msg) {
      this.chat.push(msg);
      if (this.drawerOpen && this.drawerTab === 'chat') { this._drawerSig = null; this.renderDrawer(); }
      else if (msg && msg.text) this.say(`${msg.from}: ${msg.text}`, 'chat');
    }

    /* For the app: it asks a table to close its side panel on a layout change. */
    closeSide() { this.toggleDrawer(false); }

    /** Whether a player's board can be brought forward: not once they are out of the game. */
    canLookAt(id) {
      const p = this.view && this.view.players.find(x => x.id === id);
      return !!p && !p.hasLost;
    }

    /** Bring an opponent's board forward; a choice you make holds until the turn changes. */
    setFocus(id, pin) {
      if (!id) { this._pinned = null; this.render(); return; }
      if (!this.canLookAt(id)) return;
      if (pin) this._pinned = { id, turn: this.view ? this.view.turn : 0 };
      if (this.focusSeat === id) { if (pin) this.render(); return; }
      this.focusSeat = id;
      MTG.sfx('click');
      // the old board leaving is not its cards dying, so nothing flies anywhere
      this._noMotionOnce = true;
      this.render();
    }

    /**
     * Where a seat sits in the stereo field. Your own seat is in front of you
     * and centred; the others spread left to right the way they do on screen,
     * so a spell cast across the table arrives from over there.
     */
    panFor(playerId) {
      if (!playerId || playerId === this.meId || !this.view) return 0;
      const others = this._opponents();
      const i = others.findIndex(p => p.id === playerId);
      if (i < 0) return 0;
      if (others.length === 1) return 0;
      return -0.6 + (1.2 * i) / (others.length - 1);
    }
  }

  /* How long the table dwells on each moment, and how long a bot thinks
     before it acts: three steps each, cycled from the game menu. */
  const PACES = [[0.55, 'quick'], [1, 'normal'], [1.6, 'relaxed']];
  const paceName = (v) => (PACES.find(p => p[0] === (v == null ? 1 : v)) || [0, 'custom'])[1];
  const nextPace = (v) => { const i = PACES.findIndex(p => p[0] === (v == null ? 1 : v)); return PACES[(i + 1) % PACES.length][0]; };
  // the bots' speed: the same named steps as Options (MTG.BOT_PACES), one setting for every bot
  const BOT_PACES = MTG.BOT_PACES;
  const botPaceName = (v) => (BOT_PACES.find(p => p[0] === (v == null ? 1500 : v)) || [0, 'custom'])[1].toLowerCase();
  const nextBotPace = (v) => { const i = BOT_PACES.findIndex(p => p[0] === (v == null ? 1500 : v)); return BOT_PACES[(i + 1) % BOT_PACES.length][0]; };

  function toggleIn(list, id, max) {
    const i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1);
    else if (list.length < (max || 1)) list.push(id);
  }
  /**
   * Mana made and not yet spent, as Arena shows it: a glowing orb for each
   * one by the player, in its colour with its symbol, the ones just made
   * popping in. More than six of a colour is six orbs and a count.
   */
  function manaFloat(pool, was) {
    was = was || {};
    const orbs = [];
    for (const c of ['W', 'U', 'B', 'R', 'G', 'C']) {
      const n = pool[c] || 0;
      for (let i = 0; i < Math.min(n, 6); i++) {
        const more = i === 5 && n > 6 ? n - 5 : 0;
        orbs.push(el('span', { class: 'mana-orb mo-' + c.toLowerCase() + (i >= (was[c] || 0) ? ' new' : ''), style: { animationDelay: (i * 50) + 'ms' } }, [
          el('i', { class: 'pip pip-' + c.toLowerCase(), text: c }),
          more ? el('b', { class: 'mo-more', text: '+' + more }) : null,
        ].filter(Boolean)));
      }
    }
    const total = Object.values(pool).reduce((a, n) => a + (n || 0), 0);
    return el('span', { class: 'flag pool mana-float', 'aria-label': `Mana pool: ${total} mana not yet spent`,
      title: 'Mana pool: mana made and not yet spent. It empties at the end of each step.' }, orbs);
  }
  function poolHtml(pool) {
    if (!pool) return '';
    return ['W', 'U', 'B', 'R', 'G', 'C'].map(c => pool[c] ? `<i class="pip pip-n pip-${c.toLowerCase()}">${pool[c]}</i>` : '').join('');
  }
  /** "Mira’s", but "the Goblins’": a name ending in s takes the apostrophe alone. */
  function possessive(name) { name = String(name || ''); return /s$/i.test(name) ? name + '’' : name + '’s'; }
  function truncate(s, n) { s = String(s || ''); return s.length > n ? s.slice(0, n - 1) + '…' : s; }
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  Table.helpers = { stepKey, idNum, truncate, possessive, tokenArtUrl, escapeHtml, STEP_WORDS, CARD_RATIO, VIEW_SPEC_CTX };
  UI.Table = Table;
})(window.MTG);
