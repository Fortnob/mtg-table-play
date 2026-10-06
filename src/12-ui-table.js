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
    upkeep: 'Your permanents have untapped. Anything that happens “at the beginning of your upkeep” happens now.',
    draw: 'The player whose turn it is draws a card.',
    main1: 'Play a land (one a turn) and cast creatures, sorceries and anything else.',
    beginCombat: 'The last moment to act before attackers are chosen.',
    declareAttackers: 'The player whose turn it is chooses which creatures attack.',
    declareBlockers: 'The defending player chooses which creatures block which attackers.',
    combatDamage: 'Creatures deal their damage. Attackers nobody blocked hit the player.',
    main2: 'A second main phase: cast what you held back during combat.',
    end: 'End-of-turn abilities happen, then the next player takes their turn.',
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

  class Table {
    /**
     * @param {HTMLElement} root
     * @param {string} meId
     * @param {(intent: MTG.Intent) => void} send  host applies locally, client sends over net
     */
    constructor(root, meId, send) {
      this.root = root;
      this.meId = meId;
      this.send = send;
      this.view = null;              // what is on screen
      this.live = null;              // the newest view to arrive
      this.queue = [];               // views waiting to be shown
      this.els = new Map();          // object id -> its card element
      this.wraps = new Map();        // id -> the slot a card sits in (a unit on the field, a slot in hand)
      this.seats = new Map();        // player id -> that seat's elements
      this.targeting = null;         // {need, specs, chosen:[], onDone, label, source}
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
      this.live = view;
      this.queue.push(view);
      if (!this.view) { this._pump(); return; }
      this._pump();
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
      }
      return null;
    }

    analysis(o) { return o && o.card ? MTG.oracle.analyze(o.card, o.face || 0) : null; }

    /* ---------------- render ---------------- */
    /** @this {MTG.TableInstance} */
    render() {
      const v = this.view;
      if (!v || this._destroyed) return;
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

      this.renderSeats(others);
      this.renderHand();
      this.renderStack();
      this.renderSpot();
      this.renderMeHud();
      this.renderDock();
      this.renderBanner();
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
      n.classList.toggle('tapped', !!o.tapped);
      n.classList.toggle('sick', !!o.summoningSick && o.zone === 'battlefield' && o.power != null);
      n.classList.toggle('attacking', !!o.attacking);
      n.classList.toggle('blocking', !!(o.blocking && o.blocking.length));
      n.classList.toggle('token', !!o.isToken);
      n.classList.toggle('is-cmd', !!o.isCommander);
      n.setAttribute('aria-label', hidden ? 'A face-down card' : UI.describeCard(o.card, o));

      // what is printed on top of the card: its numbers and what is on it
      const sig = [o.power, o.toughness, o.damage, JSON.stringify(o.counters || {}), o.zone, o.isCommander ? 1 : 0, hidden ? 1 : 0].join('|');
      if (n._marks === sig) return;
      n._marks = sig;
      for (const m of n.querySelectorAll(':scope > .cv-mark')) m.remove();
      if (hidden || o.zone !== 'battlefield') return;
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
      let shown = !multi || split ? others : others.filter(p => p.id === this.focusSeat);
      let below = null;
      if (watching && multi && !split) {
        // nobody is sitting here, so the near side shows the next seat round
        const i = others.findIndex(p => p.id === this.focusSeat);
        below = others[(i + 1) % others.length];
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
        this.renderOppHud(p, s);
        this.renderField(p, s, false);
        kids.push(s.root);
      }
      this.place(this.oppWrap, kids);
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
      const ids = others.map(p => p.id);
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
          plate._sub = el('span', { class: 'op-sub' });
          plate._flags = el('span', { class: 'op-flags' });
          plate.append(plate._num, plate._orb, el('span', { class: 'op-who' }, [plate._name, plate._sub]), plate._flags);
          plate.addEventListener('click', (e) => {
            e.stopPropagation();
            if (this.targeting) {
              const pl = this.view.players.find(x => x.id === p.id);
              if (pl && this.isTargetablePlayer(pl)) return this.aimAtPlayer(p.id);
            }
            if (this.choosePlayer(p.id)) return;
            const live = this.live || this.view;
            const c = live.pendingChoice;
            if (c && c.type === 'declareAttackers' && c.playerId === this.meId && (c.defenders || []).some(d => d.id === p.id)) {
              if (!this.attackPlan) this.attackPlan = { declarations: [], defenderId: p.id };
              this.attackPlan.defenderId = p.id;
            }
            this.setFocus(p.id, true);
          });
          this._plates.set(p.id, plate);
        }
        const seatNo = order.indexOf(p.id) + 1;
        plate._num.textContent = String(seatNo);
        plate.title = `${p.name} \u2014 seat ${seatNo} (press ${seatNo} to look at this board)`;
        plate.setAttribute('aria-selected', this.focusSeat === p.id ? 'true' : 'false');
        this.paintOrb(plate._orb, p);
        plate._name.textContent = p.name;
        plate._sub.textContent = p.hasLost ? 'out of the game' : `${p.handSize} in hand \u00b7 ${p.librarySize} in library`;
        const flags = [];
        if (v.activePlayer === p.id) flags.push(['turn', '\u25b6 turn']);
        if (v.battlefield.some(o => o.controller === p.id && o.attacking === this.meId)) flags.push(['atk', '\u2694 you']);
        if (ch && ch.playerId === p.id) flags.push(['think', 'deciding']);
        if (p.poison) flags.push(['bad', `\u2620 ${p.poison}`]);
        const toMe = this.me ? Object.entries(this.me.commanderDamage || {})
          .filter(([cid]) => { const o = this.objIn(cid); return o && o.owner === p.id; })
          .reduce((m, [, n]) => Math.max(m, n || 0), 0) : 0;
        if (toMe) flags.push(['cmd', `${toMe} cmd`]);
        if (v.monarch === p.id) flags.push(['crown', '\u265b']);
        const sig = JSON.stringify(flags);
        if (plate._flags._sig !== sig) {
          plate._flags._sig = sig;
          plate._flags.innerHTML = '';
          for (const [cls, text] of flags) plate._flags.appendChild(el('i', { class: cls, text }));
        }
        plate.classList.toggle('focused', this.focusSeat === p.id && !this.arena.classList.contains('split'));
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
      host._hint.innerHTML = MTG.isTouch() ? '' : `<kbd>\u2190</kbd><kbd>\u2192</kbd> or <kbd>1</kbd>\u2013<kbd>${Math.min(8, order.length)}</kbd>`;
      host._split.textContent = MTG.settings.splitOpponents ? 'One board' : 'All boards';
      host._split.style.display = others.length <= 3 ? '' : 'none';
      this.place(host, kids.concat([host._hint, host._split]));
    }

    /** Look at the next or previous opponent's board. */
    cycleFocus(dir) {
      const others = this._opponents();
      if (others.length < 2) return;
      const i = Math.max(0, others.findIndex(p => p.id === this.focusSeat));
      const next = others[(i + dir + others.length) % others.length];
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
        if (o.faceDown || (a && a.isCreature) || o.power != null) creatures.push(o);
        else if (a && a.isLand) lands.push(o);
        else others.push(o);
      }
      const byAge = (x, y) => idNum(x.id) - idNum(y.id);
      creatures.sort(byAge); others.sort(byAge); lands.sort(byAge);

      this.place(s.front, creatures.map(o => this.unitFor(o)));
      this.place(s.others, others.map(o => this.unitFor(o)));

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
        front: creatures.map(o => (o.tapped ? CARD_RATIO : 1) + this._attachSpread(o) * 0.25),
        lands: groups.map(g => (g.list[0].tapped ? CARD_RATIO : 1) + (g.list.length - 1) * 0.2),
        others: others.map(o => (o.tapped ? CARD_RATIO : 1) + this._attachSpread(o) * 0.25),
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
        hud._who.append(
          el('div', { class: 'hud-name', text: p.name }),
          el('div', { class: 'hud-sub', text: sub }),
        );
      }
      // their hand: the backs, one per card, so a card leaving it is seen to leave
      const backs = (p.hand || []).map(o => this.cardEl(Object.assign({ hidden: true }, o)));
      this.place(hud._hand, backs);
      hud._hand.dataset.n = String(p.handSize);
      this.renderPiles(hud._piles, p, false);
      this.renderCommand(hud._cmd, p, false);
      this.paintFlags(hud._flags, p);
    }

    seatSub(p) {
      const v = this.view;
      if (p.hasLost) return 'Out of the game' + (p.lossReason ? ' — ' + p.lossReason : '');
      const bits = [];
      if (p.isBot) bits.push((MTG.bots && MTG.bots.diffCfg ? MTG.bots.diffCfg(p.botDifficulty).label : 'Bot') + ' bot');
      if (p.connected === false) bits.push('disconnected');
      const ch = v.pendingChoice;
      if (ch && ch.playerId === p.id) bits.push('deciding…');
      else if (!ch && v.priorityPlayer === p.id && !v.mulliganPhase) bits.push(p.isBot ? 'thinking…' : 'has priority');
      return bits.join(' · ');
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
      const url = card ? (MTG.scry.imageUrl(card, 'art_crop', 0) || '') : '';
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
      orb.setAttribute('aria-label', `${p.name}: ${p.life} life`);
      orb.title = `${p.name} — ${p.life} life`;
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

    paintFlags(host, p) {
      const v = this.view;
      const flags = [
        v.monarch === p.id ? ['crown', '♛ Monarch', 'Draws a card at the end of their turn'] : null,
        v.initiative === p.id ? ['init', '✦ Initiative', 'Has the initiative'] : null,
        p.poison ? ['bad', `☠ ${p.poison} poison`, 'Ten poison counters and they lose'] : null,
        p.energy ? ['', `⚡ ${p.energy}`, 'Energy'] : null,
        p.experience ? ['', `★ ${p.experience}`, 'Experience counters'] : null,
      ].filter(Boolean);
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
      if (pool) host.appendChild(el('span', { class: 'flag pool', html: pool, title: 'Floating mana' }));
    }

    /** Library, graveyard and exile, as piles you can see the size of and open. */
    renderPiles(host, p, mine) {
      const gy = p.graveyard || [], ex = p.exile || [];
      const sig = [p.librarySize, gy.length, gy.length ? gy[gy.length - 1].id : '', ex.length, ex.length ? ex[ex.length - 1].id : '', p.topCard ? p.topCard.id : ''].join('|');
      if (host._sig === sig) return;
      host._sig = sig;
      host.innerHTML = '';
      const pile = (zone, label, n, top) => {
        const node = el('button', {
          type: 'button', class: 'pile ' + zone + (n ? '' : ' empty'),
          dataset: { pile: p.id + '/' + zone },
          title: `${label}: ${n}`, 'aria-label': `${p.name} ${label.toLowerCase()}, ${n} card${n === 1 ? '' : 's'}`,
          onclick: () => { if (zone !== 'library') this.openZone(p, zone); },
        }, [
          el('div', { class: 'pile-card' + (top ? '' : ' back') }),
          el('span', { class: 'pile-n', text: String(n) }),
          el('span', { class: 'pile-label', text: label }),
        ]);
        const face = node.firstChild;
        if (top && top.card) {
          const url = MTG.scry.imageUrl(top.card, 'small', top.face || 0);
          if (url) face.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
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
      if (h._who._sig !== me.name + '|' + me.handSize) {
        h._who._sig = me.name + '|' + me.handSize;
        h._who.innerHTML = '';
        h._who.append(el('div', { class: 'hud-name', text: me.name }),
          el('div', { class: 'hud-sub', text: `${me.handSize} in hand` }));
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
      const cards = UI.sortCards(me.hand.filter(o => !o.hidden), MTG.settings.handSort || 'cmc');
      const n = cards.length;
      const width = this.sizeOf(this.handHost).w || 800;
      // the card width the stylesheet chose, read once per layout rather than once per render
      // (a resize clears it; even asking the window its size can force a layout)
      const layout = String(MTG.settings.cardScale || 1);
      if (this._handCw == null || this._handCwFor !== layout) {
        this._handCw = parseFloat(getComputedStyle(this.arena).getPropertyValue('--hand-w')) || 132;
        this._handCwFor = layout;
      }
      const cw = this._handCw;
      const room = Math.max(cw, width - 40);
      const step = n > 1 ? Math.min(cw * 0.82, (room - cw) / (n - 1)) : 0;
      const spread = Math.min(2.6, 18 / Math.max(1, n));
      const kids = cards.map((o, i) => {
        const w = this.wrapFor('h:' + o.id, 'hslot');
        const off = i - (n - 1) / 2;
        w.style.setProperty('--x', (off * step).toFixed(1) + 'px');
        w.style.setProperty('--r', (off * spread).toFixed(2) + 'deg');
        w.style.setProperty('--y', (Math.abs(off) * Math.abs(off) * spread * 0.9).toFixed(1) + 'px');
        w.style.zIndex = String(10 + i);
        this.place(w, [this.cardEl(o)]);
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
        const who = v.players.find(p => p.id === s.controller);
        // a spell is its own card; an ability is a chip that names where it came from
        if (this.spot && this.spot.stackId === s.id) {
          // held up in the middle for now; the stack keeps its place
          this.place(w, [el('div', { class: 'stack-ph' })]);
        } else if (s.kind !== 'ability' && s.objId) {
          const o = Object.assign({ id: s.objId, card: s.card, zone: 'stack' });
          this.place(w, [this.cardEl(o), this._stackLabel(s, who, i === 0)]);
        } else {
          let chip = w.querySelector(':scope > .ability-chip');
          if (!chip) chip = this._abilityChip(s);
          this.place(w, [chip, this._stackLabel(s, who, i === 0)]);
        }
        return w;
      });
      this.place(this.stackCol, kids);
      this.stackCol.classList.toggle('on', items.length > 0);
      this.stackCol.dataset.n = String(items.length);
    }

    _stackLabel(s, who, top) {
      const targets = (s.targets || []).map(t => this.targetName(t)).filter(Boolean);
      return el('div', { class: 'stack-cap' }, [
        el('span', { class: 'who', text: who ? (who.id === this.meId ? 'You' : who.name) : '' }),
        targets.length ? el('span', { class: 'tg', text: '→ ' + targets.join(', ') }) : null,
        top ? el('span', { class: 'next', text: s.countered ? 'countered' : 'resolves next' }) : null,
      ].filter(Boolean));
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

    _abilityChip(s) {
      const url = s.card ? MTG.scry.imageUrl(s.card, 'art_crop', 0) : '';
      return el('div', { class: 'ability-chip', dataset: { stack: s.id } }, [
        el('div', { class: 'ac-art', style: url ? { backgroundImage: 'url("' + url.replace(/"/g, '%22') + '")' } : null }),
        el('div', { class: 'ac-text' }, [
          el('div', { class: 'ac-name', text: s.name || (s.card ? s.card.name : 'Ability') }),
          el('div', { class: 'ac-body', html: MTG.mana.textHtml(truncate(s.abilityText || '', 140)) }),
        ]),
      ]);
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
          item.kind === 'ability' && item.abilityText ? el('div', { class: 'spot-ab', html: MTG.mana.textHtml(truncate(item.abilityText, 160)) }) : null,
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
        d._turn = el('div', { class: 'dock-turn' });
        d._strip = el('div', { class: 'phase-strip', role: 'list', 'aria-label': 'Steps of the turn' });
        d._main = el('button', { type: 'button', class: 'big-btn', onclick: () => this.primaryAction() }, [
          el('span', { class: 'bb-label' }), el('span', { class: 'bb-sub' }),
        ]);
        d._row = el('div', { class: 'dock-row' });
        // for anyone still learning: what is going on, in a sentence
        d._hint = el('div', { class: 'dock-hint', 'aria-live': 'polite' });
        d.append(d._turn, d._strip, d._main, d._hint, d._row);
      }
      const ap = v.players.find(p => p.id === v.activePlayer);
      const mine = v.activePlayer === this.meId;
      const turnSig = (ap ? ap.name : '') + '|' + mine + '|' + v.turn;
      if (d._turn._sig !== turnSig) {
        d._turn._sig = turnSig;
        d._turn.innerHTML = '';
        d._turn.append(
          el('span', { class: 'dt-who' + (mine ? ' mine' : ''), text: mine ? 'Your turn' : `${possessive(ap ? ap.name : '—')} turn` }),
          el('span', { class: 'dt-n', text: 'Turn ' + (v.turn || 1) }),
        );
      }
      this.renderStrip(d._strip);
      const act = this.primaryInfo();
      d._main.className = 'big-btn ' + (act.cls || '');
      d._main.disabled = !!act.disabled;
      d._main.querySelector('.bb-label').textContent = act.label;
      d._main.querySelector('.bb-sub').textContent = act.sub || '';
      d._main.title = act.title || '';
      const hint = MTG.settings.beginnerHints === false ? '' : this.beginnerHint(act);
      if (d._hint.textContent !== hint) d._hint.textContent = hint;
      d._hint.classList.toggle('on', !!hint);

      d._row.innerHTML = '';
      const small = (text, title, fn, cls) => el('button', { type: 'button', class: 'dock-btn ' + (cls || ''), text, title, onclick: fn });
      const live = this.live || v;
      if (act.secondary) d._row.appendChild(small(act.secondary.label, act.secondary.title || '', act.secondary.fn, 'alt'));
      if (live.canUndo) d._row.appendChild(small('↶ Undo', `Take back ${live.undoLabel || 'the last action'} (Ctrl+Z)`, () => this.send({ kind: 'undo' })));
      if (live.fullControl) {
        d._row.appendChild(small(live.fullControlSticky ? 'Full control • locked' : 'Full control', 'Nothing is passed for you. Ctrl toggles it, Ctrl+Shift locks it.',
          () => this.send({ kind: 'fullControl', on: false }), 'flagged'));
      }
      if (live.yielding) {
        d._row.appendChild(small(live.yielding === 'turn' ? 'Passing to end of turn' : 'Passing until a response', 'Click to take priority back',
          () => this.send({ kind: 'yield', mode: null }), 'flagged'));
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
      const sig = cur + '|' + mineNow + '|' + JSON.stringify(stops);
      if (host._sig === sig) return;
      host._sig = sig;
      host.innerHTML = '';
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
          `${escapeHtml(PHASE_HELP[key] || '')}${stopNote ? `<span class="tip-note">${escapeHtml(stopNote)}</span>` : ''}`, { cls: 'step' });
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
      if (this.targeting) {
        const t = this.targeting;
        const upTo = (t.specs || []).some(sp => sp && sp.upTo);
        if (upTo) return { label: t.chosen.length ? 'Done' : 'No targets', cls: 'go', sub: t.label };
        return { label: 'Choose a target', disabled: true, cls: 'idle', sub: t.label,
          secondary: t.legal ? null : { label: 'Cancel', fn: () => { this.cancelTargeting(); this.render(); } } };
      }
      const ch = live.pendingChoice;
      if (ch && ch.playerId === this.meId && !ch.waiting) {
        if (ch.type === 'declareAttackers') {
          const n = this.attackPlan ? this.attackPlan.declarations.length : 0;
          const all = (ch.candidates || []).length;
          return {
            label: n ? `Attack` : 'No attacks', sub: n ? `${n} attacker${n === 1 ? '' : 's'}` : 'skip combat',
            cls: n ? 'go attack' : 'pass',
            secondary: n < all ? { label: 'All attack', fn: () => this.attackAll(ch) }
              : { label: 'Clear', fn: () => { this.attackPlan.declarations = []; this.render(); } },
          };
        }
        if (ch.type === 'declareBlockers') {
          const n = this.blockPlan ? this.blockPlan.declarations.length : 0;
          return { label: n ? 'Block' : 'No blocks', sub: n ? `${n} blocker${n === 1 ? '' : 's'}` : 'take the damage',
            cls: n ? 'go block' : 'pass',
            secondary: n ? { label: 'Clear', fn: () => { this.blockPlan = { declarations: [], pendingBlocker: null }; this.render(); } } : null };
        }
        if (ch.type === 'discard' || ch.type === 'discardToHandSize') {
          const need = ch.count || 1;
          return { label: 'Discard', sub: `${this.discardSel.length}/${need} chosen`, cls: 'go', disabled: this.discardSel.length !== need };
        }
        if (ch.type === 'choose') return this.choosePrimary(ch);
        if (ch.type === 'sacrifice') {
          const need = ch.count || 1;
          return { label: 'Sacrifice', sub: `${this.sacSel.length}/${need} chosen`, cls: 'go', disabled: this.sacSel.length !== need };
        }
        return { label: 'Decide', disabled: true, cls: 'idle', sub: 'answer the question above' };
      }
      if (ch && ch.waiting) {
        const who = v.players.find(p => p.id === ch.playerId);
        return { label: 'Waiting', disabled: true, cls: 'idle wait', sub: `${who ? who.name : 'someone'} is deciding` };
      }
      if (live.priorityPlayer !== this.meId) {
        const pp = v.players.find(p => p.id === live.priorityPlayer);
        return { label: v.activePlayer === this.meId ? 'Waiting' : 'Their turn', disabled: true, cls: 'idle wait',
          sub: pp ? `${pp.name} ${pp.isBot ? 'is thinking' : 'has priority'}` : '' };
      }
      if ((live.stack || []).length) {
        const top = live.stack[live.stack.length - 1];
        const mine = top.controller === this.meId;
        return { label: 'Resolve', cls: mine ? 'go' : 'pass', sub: top.name,
          title: 'Let the top of the stack resolve (Space)',
          secondary: { label: 'Pass until response', title: 'Keep passing until somebody adds to the stack (Enter)', fn: () => this.send({ kind: 'yield', mode: 'response' }) } };
      }
      const k = stepKey(live);
      const myTurn = live.activePlayer === this.meId;
      if (myTurn && k === 'main1') {
        const could = live.battlefield.some(o => o.controller === this.meId && o.power != null && !o.tapped && !o.summoningSick && o.power > 0);
        return could
          ? { label: 'To combat', cls: 'go', sub: 'declare attackers', secondary: { label: 'End turn', title: 'Pass to the end of the turn (Shift+Enter)', fn: () => this.send({ kind: 'yield', mode: 'turn' }) } }
          : { label: 'End turn', cls: 'go', sub: 'nothing can attack', yieldTurn: true };
      }
      if (myTurn && k === 'main2') return { label: 'End turn', cls: 'go', sub: 'pass to the next player' };
      if (!myTurn) return { label: 'Pass', cls: 'pass', sub: STEP_WORDS[k] || '',
        secondary: { label: 'Pass turn', title: 'Take no more actions this turn (Shift+Enter)', fn: () => this.send({ kind: 'yield', mode: 'turn' }) } };
      return { label: 'Next', cls: 'pass', sub: STEP_WORDS[k] || '' };
    }

    /**
     * The same moment in plain English, for the line under the big button:
     * what is happening and what you could do about it. Short, and never a
     * rule you need to know already. Beginner hints turn it off.
     */
    beginnerHint(act) {
      const v = this.view, live = this.live || v;
      if (!v || v.over || v.spectating || v.replay || !this.me) return '';
      if (v.mulliganPhase) return 'Keep a hand with two to five lands. A mulligan shuffles and deals a new hand, one card smaller.';
      if (this.targeting) return 'Click a glowing card or player to choose it.';
      const ch = live.pendingChoice;
      if (ch && ch.playerId === this.meId && !ch.waiting) {
        if (ch.type === 'declareAttackers') return 'Click your creatures to attack with them. Attackers that aren’t blocked deal their damage to the player.';
        if (ch.type === 'declareBlockers') return 'Click one of your creatures, then the attacker it should block. Attackers you don’t block hit you.';
        if (/discard/.test(ch.type)) return 'Click the cards to discard, then confirm.';
        if (ch.type === 'sacrifice') return 'Click the permanent to sacrifice.';
        return 'Answer the question on screen to carry on.';
      }
      if (ch && ch.waiting) return 'Your opponent is making a choice.';
      if (live.priorityPlayer !== this.meId) {
        const pp = v.players.find(p => p.id === live.priorityPlayer);
        return pp && pp.isBot ? `${pp.name} is deciding what to do.` : 'Waiting for the other player.';
      }
      const stack = live.stack || [];
      if (stack.length) {
        const top = stack[stack.length - 1];
        return top.controller === this.meId
          ? 'Your spell is on the stack. It happens once everyone passes.'
          : `${top.name} is waiting to happen. Cast an instant to respond, or pass to let it resolve.`;
      }
      const k = stepKey(live);
      const myTurn = live.activePlayer === this.meId;
      if (myTurn && (k === 'main1' || k === 'main2')) {
        const me = this.me;
        const land = me && me.landsPlayed < (me.maxLands || 1) && (live.playable || []).some(id => {
          const o = me.hand.find(x => x.id === id);
          const a = o && this.analysis(o);
          return a && a.isLand;
        });
        if (land) return 'Play a land from your hand: you can play one each turn. Glowing cards can be played now.';
        if ((live.playable || []).length) return k === 'main1'
          ? 'Glowing cards can be played now. When you are done, go to combat to attack.'
          : 'Cast anything you held back, then end your turn.';
        return k === 'main1' && act && /combat/i.test(act.label || '')
          ? 'Nothing more to play. Go to combat and choose your attackers.'
          : 'Nothing more to play this turn. End your turn to pass to the next player.';
      }
      if (!myTurn) return (live.playable || []).length
        ? 'It’s their turn. You can cast instants now, or pass.'
        : 'It’s their turn. Pass to let it carry on.';
      if (k === 'combatDamage' || k === 'firstStrikeDamage') return 'Combat damage is dealt. Attackers nobody blocked hit the player.';
      return 'Press the button to move on to the next step.';
    }

    /** @this {MTG.TableInstance} */
    primaryAction() {
      const v = this.view, live = this.live || v;
      if (!v || v.over || v.mulliganPhase) return;
      if (this.targeting) {
        const t = this.targeting;
        if ((t.specs || []).some(sp => sp && sp.upTo)) { this.targeting = null; t.onDone(t.chosen); this.render(); }
        return;
      }
      const ch = live.pendingChoice;
      if (ch && ch.playerId === this.meId && !ch.waiting) {
        if (ch.type === 'declareAttackers') {
          this.send({ kind: 'declareAttackers', declarations: (this.attackPlan || { declarations: [] }).declarations });
          this.attackPlan = null;
          return;
        }
        if (ch.type === 'declareBlockers') {
          this.send({ kind: 'declareBlockers', declarations: (this.blockPlan || { declarations: [] }).declarations });
          this.blockPlan = null;
          return;
        }
        if ((ch.type === 'discard' || ch.type === 'discardToHandSize') && this.discardSel.length === (ch.count || 1)) {
          this.send({ kind: 'choice', data: { cardIds: this.discardSel.slice() } });
          this.discardSel = [];
          return;
        }
        if (ch.type === 'choose') { this.chooseConfirm(ch); return; }
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

    attackAll(ch) {
      if (!this.attackPlan) this.attackPlan = { declarations: [], defenderId: (ch.defenders[0] || {}).id };
      this.attackPlan.declarations = ch.candidates.map(id => ({ attackerId: id, defenderId: this.attackPlan.defenderId }));
      MTG.sfx('ui_attack');
      this.render();
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
      for (const [id, n] of this.els) {
        const loc = n.parentElement;
        const inHand = !!(loc && loc.classList.contains('hslot'));
        n.classList.toggle('playable', playable.has(id) && !this.targeting && !ch);
        let target = false, cand = false, chosen = false;
        if (this.targeting) {
          const o = this.objIn(id);
          target = !!(o && o.zone === 'battlefield' && this.isTargetable(o));
          if (this.targeting.chosen.some(t => t.id === id)) chosen = true;
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
          } else if (ch.type === 'choose') {
            ({ cand, chosen } = this.chooseMark(ch, id));
          }
        }
        n.classList.toggle('targetable', target);
        n.classList.toggle('candidate', cand && !chosen);
        n.classList.toggle('chosen', chosen);
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
        const chip = e.target.closest('.ability-chip');
        if (chip) return;
        if (this._popover && !e.target.closest('.arena-pop')) this.closePopover();
      });
      a.addEventListener('contextmenu', (e) => {
        const cv = e.target.closest('.cv');
        if (!cv) return;
        e.preventDefault();
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
        else if (chip && chip.dataset.preview) this.hoverCard(chip, e);
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
        this._pointer = { x: e.clientX, y: e.clientY };
        if (this.targeting || (this.blockPlan && this.blockPlan.pendingBlocker)) this.renderArrows();
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
      const start = { x: e.clientX, y: e.clientY };
      let dragging = false;
      const move = (ev) => {
        const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
        if (!dragging && Math.hypot(dx, dy) > 10) {
          dragging = true;
          slot.classList.add('dragging');
          this.hidePreview();
          this.hideTip();
        }
        if (dragging) {
          slot.style.setProperty('--dx', dx + 'px');
          slot.style.setProperty('--dy', dy + 'px');
          const over = ev.clientY < this.handHost.getBoundingClientRect().top - 30;
          slot.classList.toggle('will-play', over && (this.live.playable || []).includes(id));
        }
      };
      const up = (ev) => {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        if (!dragging) return;
        this._suppressClick = true;
        setTimeout(() => { this._suppressClick = false; }, 0);
        const over = ev.clientY < this.handHost.getBoundingClientRect().top - 30;
        slot.classList.remove('dragging', 'will-play');
        if (over) {
          const o = this.objIn(id);
          if (o) {
            // let the card stay where it was dropped while the play is worked out
            this._dropAt = { id, x: ev.clientX, y: ev.clientY };
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
        if (d) { this.attackPlan.defenderId = pid; this.render(); return; }
      }
      if (pid !== this.meId && this._opponents().length > 1) this.setFocus(pid);
    }

    /** @this {MTG.TableInstance} */
    onCardClick(id, e, node) {
      const loc = this.locate(id);
      if (!loc) return;
      this.closePopover();
      const live = this.live || this.view;
      if (this.targeting) {
        if (loc.zone !== 'battlefield') return;
        if (!this.isTargetable(loc.o)) return UI.error('Not a legal target for that.');
        this.targeting.chosen.push({ kind: 'object', id });
        MTG.sfx('click');
        if (this.targeting.chosen.length >= this.targeting.need) {
          const t = this.targeting; this.targeting = null; t.onDone(t.chosen);
        }
        return this.render();
      }
      if (!this._ready()) return;
      const ch = live.pendingChoice;
      if (ch && ch.playerId === this.meId && !ch.waiting) {
        if ((ch.type === 'discard' || ch.type === 'discardToHandSize') && loc.zone === 'hand' && loc.player === this.meId) {
          if ((ch.count || 1) === 1) { this.discardSel = []; return this.send({ kind: 'choice', data: { cardIds: [id] } }); }
          toggleIn(this.discardSel, id, ch.count);
          return this.render();
        }
        if (ch.type === 'choose' && this.chooseClick(ch, id)) return;
        if (ch.type === 'sacrifice' && loc.zone === 'battlefield' && loc.o.controller === this.meId) {
          if ((ch.count || 1) === 1) { this.sacSel = []; return this.send({ kind: 'choice', data: { cardIds: [id] } }); }
          toggleIn(this.sacSel, id, ch.count);
          return this.render();
        }
        if (ch.type === 'declareAttackers' && (ch.candidates || []).includes(id)) {
          if (!this.attackPlan) this.attackPlan = { declarations: [], defenderId: (ch.defenders[0] || {}).id };
          const list = this.attackPlan.declarations;
          const i = list.findIndex(d => d.attackerId === id);
          if (i >= 0) list.splice(i, 1);
          else { list.push({ attackerId: id, defenderId: this.attackPlan.defenderId }); MTG.sfx('ui_attack'); }
          return this.render();
        }
        if (ch.type === 'declareBlockers') {
          if (!this.blockPlan) this.blockPlan = { declarations: [], pendingBlocker: null };
          const bp = this.blockPlan;
          if ((ch.candidates || []).includes(id) && loc.o.controller === this.meId) {
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
      if (loc.zone === 'hand' && loc.player === this.meId) return this.playFromHand(loc.o);
      if (loc.zone === 'command' && loc.player === this.meId) {
        if ((live.playable || []).includes(id)) return this.playFromHand(loc.o);
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
        const real = (a.abilities || []).find(x => x.kind === 'castModifier' && /^(morph|megamorph|disguise)$/i.test(x.keyword || '') && x.arg);
        if (real) uses.push({ label: 'Turn face up', cost: real.arg, fn: () => this.send({ kind: 'turnFaceUp', objId: o.id }) });
      } else {
        acts.forEach((ab) => {
          const idx = a.manaAbilities.length + acts.indexOf(ab);
          const c = ab.cost || {};
          const cost = ab.kind === 'loyalty'
            ? (c.loyalty > 0 ? '+' + c.loyalty : String(c.loyalty || 0))
            : (typeof c === 'string' ? c : (c.raw || ''));
          // the cost is shown on its own, so the text is what comes after the colon
          const text = String(ab.text || '').replace(/^[^:]*:\s*/, '') || MTG.oracle.abilityLabel(ab);
          uses.push({ label: MTG.oracle.abilityLabel(ab), cost, loyalty: ab.kind === 'loyalty',
            text, fn: () => this.activate(o, a, idx, ab) });
        });
        if (!o.tapped) a.manaAbilities.forEach((ab, i) => {
          uses.push({ label: 'Add mana', text: MTG.oracle.abilityLabel(ab), mana: true, fn: () => this.send({ kind: 'mana', objId: o.id, index: i }) });
        });
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
      if (a.isLand) { MTG.sfx('ui_play'); return this.send({ kind: 'playLand', objId: o.id }); }
      this.beginCast(o, a);
    }

    /* ---- targets ---- */
    isTargetablePlayer(p) {
      const t = this.targeting;
      if (!t || !p || p.hasLost) return false;
      if (t.legal) return t.legal.has('player:' + p.id);
      const spec = t.specs[t.chosen.length] || {};
      if (t.chosen.some(c => c.kind === 'player' && c.id === p.id)) return false;
      if (spec.type === 'player' || spec.type === 'any') {
        if (spec.controller === 'opponent' && p.id === this.meId) return false;
        if (spec.controller === 'you' && p.id !== this.meId) return false;
        return true;
      }
      if (spec.type === 'opponent') return p.id !== this.meId;
      return false;
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
      if (t.legal) return t.legal.has('object:' + o.id);
      const spec = t.specs[t.chosen.length];
      if (!spec) return false;
      if (t.chosen.some(c => c.id === o.id)) return false;
      const a = this.analysis(o);
      return MTG.oracle.matchesSpec(spec, o, a, this.meId, VIEW_SPEC_CTX);
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
        return s ? s.name : 'a spell';
      }
      const o = this.objIn(t.id);
      return o && o.card ? o.card.name : 'something';
    }

    activate(o, a, index, ab) {
      const specs = [];
      for (const e of (ab.effects || [])) for (const s of (e.targets || [])) specs.push(s);
      this.closePopover();
      if (!specs.length) return this.send({ kind: 'activate', objId: o.id, index, targets: [] });
      this.startTargeting({
        need: specs.length, specs, label: `${o.card.name}: choose ${specs.length === 1 ? 'a target' : specs.length + ' targets'}`,
        source: o.id, cardName: o.card.name,
        onDone: (targets) => this.send({ kind: 'activate', objId: o.id, index, targets }),
      });
    }

    startTargeting(t) {
      this.targeting = Object.assign({ chosen: [] }, t);
      this.render();
      // a spell with exactly one legal target in the whole game takes it
      const live = this.view;
      if (!t.legal && t.need === 1 && !(t.specs[0] || {}).upTo && MTG.settings.autoTarget !== false) {
        const objs = live.battlefield.filter(o => this.isTargetable(o));
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
      const r = anchor.getBoundingClientRect();
      const pop = el('div', { class: 'arena-pop', role: 'menu' }, [
        el('div', { class: 'pop-title', text: o.card.name }),
        ...uses.map(u => el('button', {
          type: 'button', class: 'pop-item' + (u.mana ? ' mana' : '') + (u.loyalty ? ' loy' : ''), role: 'menuitem',
          onclick: (e) => { e.stopPropagation(); this.closePopover(); u.fn(); },
        }, [
          u.cost ? el('span', { class: 'pop-cost', html: u.loyalty
            ? `<b class="loy-cost${/^-/.test(u.cost) ? ' minus' : ''}">${escapeHtml(u.cost)}</b>`
            : MTG.mana.textHtml(u.cost) }) : null,
          el('span', { class: 'pop-label', html: MTG.mana.textHtml(truncate(u.text || u.label, 120)) }),
        ].filter(Boolean))),
      ]);
      this.arena.appendChild(pop);
      const ar = this.arena.getBoundingClientRect();
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
      const ar = this.arena.getBoundingClientRect();
      const r = anchor.getBoundingClientRect();
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
        return s ? { id: s.objId, card: s.card } : null;
      })();
      if (!o && node.dataset.preview) {
        const h = this.history.find(x => x.key === node.dataset.preview);
        if (h && h.card) o = { card: h.card };
      }
      if (!o && node.dataset.stack) {
        const s = (this.view.stack || []).find(x => x.id === node.dataset.stack);
        if (s && s.card) o = { card: s.card, abilityText: s.abilityText };
      }
      if (!o || !o.card || o.hidden) return;
      const p = this.preview;
      p.innerHTML = '';
      const faces = o.card.card_faces && o.card.card_faces.length > 1 && o.card.card_faces[0].image_uris ? o.card.card_faces.length : 1;
      const imgs = el('div', { class: 'pv-imgs' });
      for (let i = 0; i < faces; i++) {
        const url = MTG.scry.imageUrl(o.card, 'large', faces > 1 ? i : (o.face || 0)) || MTG.scry.imageUrl(o.card, 'normal', i);
        if (url) imgs.appendChild(el('img', { src: url, alt: o.card.name }));
        else imgs.appendChild(UI.cardTextBlock(o.card, i));
      }
      p.appendChild(imgs);
      const notes = this.cardNotes(o);
      if (notes.length || MTG.settings.alwaysCardText || o.abilityText) {
        p.appendChild(el('div', { class: 'pv-notes' }, [
          o.abilityText ? el('div', { class: 'pv-ab', html: MTG.mana.textHtml(o.abilityText) }) : null,
          ...notes.map(([cls, text]) => el('div', { class: 'pv-note ' + cls, text })),
          MTG.settings.alwaysCardText ? UI.cardTextBlock(o.card, o.face || 0) : null,
        ].filter(Boolean)));
      }
      const r = node.getBoundingClientRect();
      const left = r.left + r.width / 2 > window.innerWidth / 2;
      p.classList.toggle('left', left);
      p.classList.toggle('right', !left);
      p.classList.add('on');
      this._hoverNode = node;
    }

    cardNotes(o) {
      const out = [];
      if (o.zone !== 'battlefield' && !this.view.battlefield.some(x => x.id === o.id)) return out;
      const a = this.analysis(o);
      if (o.power != null && a && (String(o.power) !== String(a.power) || String(o.toughness) !== String(a.toughness)))
        out.push(['pt', `Now ${o.power}/${o.toughness} (printed ${a.power}/${a.toughness})`]);
      if (o.damage) out.push(['bad', `${o.damage} damage marked`]);
      const printed = new Set(((a && a.keywords) || []).map(k => String(k.keyword || k).toLowerCase()));
      const granted = (o.keywords || []).filter(k => !printed.has(String(k).toLowerCase()));
      if (granted.length) out.push(['good', 'Has ' + granted.map(k => U.titleCase ? U.titleCase(String(k)) : k).join(', ')]);
      for (const [k, n] of Object.entries(o.counters || {})) if (n) out.push(['', `${n} ${k} counter${n === 1 ? '' : 's'}`]);
      if (o.summoningSick && o.power != null) out.push(['dim', 'Summoning sick — can’t attack or tap this turn']);
      if (o.tapped) out.push(['dim', 'Tapped']);
      if (o.attacking) out.push(['bad', 'Attacking ' + this.targetName({ kind: this.view.players.some(p => p.id === o.attacking) ? 'player' : 'object', id: o.attacking })]);
      if ((o.blocking || []).length) out.push(['info', 'Blocking ' + o.blocking.map(id => this.targetName({ kind: 'object', id })).join(', ')]);
      const atts = this.view.battlefield.filter(x => x.attachedTo === o.id);
      if (atts.length) out.push(['', 'With ' + atts.map(x => x.card.name).join(', ')]);
      if (o.attachedTo) out.push(['', 'Attached to ' + this.targetName({ kind: 'object', id: o.attachedTo })]);
      if (o.controller !== o.owner) {
        const ow = this.view.players.find(p => p.id === o.owner);
        out.push(['info', `Owned by ${ow ? ow.name : 'someone else'}`]);
      }
      if (o.note) out.push(['', o.note]);
      if (a && !a.fullyAutomated) out.push(['warn', 'Some of this card’s text is not automated.']);
      return out;
    }

    showCard(id) {
      const o = this.objIn(id) || (() => {
        const s = (this.view.stack || []).find(x => x.objId === id || x.id === id);
        return s && s.card ? { id, card: s.card } : null;
      })();
      if (!o || !o.card || o.hidden) return;
      this.hidePreview();
      if (MTG.isPhone()) return UI.cardSheet(o.card);
      const card = o.card;
      const faces = card.card_faces && card.card_faces.length > 1 && card.card_faces[0].image_uris ? card.card_faces.length : 1;
      const imgs = el('div', { class: 'cardview-imgs' });
      for (let i = 0; i < faces; i++) {
        const url = MTG.scry.imageUrl(card, 'large', faces > 1 ? i : (o.face || 0));
        imgs.appendChild(url ? el('img', { src: url, alt: card.name }) : UI.cardFallback(card, i));
      }
      const notes = this.cardNotes(o);
      const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); };
      const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
      const back = el('div', { class: 'cardview', onclick: close }, [
        el('div', { class: 'cardview-inner', onclick: (e) => e.stopPropagation() }, [
          imgs,
          el('div', { class: 'cardview-side' }, [
            el('h3', { text: card.name }),
            el('div', { class: 'cv-type', text: card.type_line || '' }),
            el('div', { class: 'cv-text', html: MTG.mana.textHtml(card.oracle_text || (card.card_faces || []).map(f => f.oracle_text).join('\n\n') || '') }),
            notes.length ? el('div', { class: 'cv-notes' }, notes.map(([cls, text]) => el('div', { class: 'pv-note ' + cls, text }))) : null,
            el('div', { class: 'cv-meta', text: `${card.set_name || ''}${card.artist ? ' · ' + card.artist : ''}` }),
            el('div', { class: 'row', style: { marginTop: 'auto' } }, [
              el('button', { class: 'btn sm', text: 'Choose art…', onclick: () => { close(); UI.pickArt(card); } }),
              el('span', { class: 'grow' }),
              el('button', { class: 'btn sm primary', text: 'Close', onclick: close }),
            ]),
          ].filter(Boolean)),
        ]),
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
          if (use.kind === 'cycle') items.push([use.label, () => this.send({ kind: 'cycle', objId: o.id })]);
          else if (use.kind === 'plot') items.push([use.label, () => this.send({ kind: 'plot', objId: o.id })]);
          else if (use.kind === 'suspend') items.push([use.label, () => this.send({ kind: 'suspend', objId: o.id })]);
          else if (use.kind === 'transmute') items.push([use.label, () => this.send({ kind: 'transmute', objId: o.id })]);
          else if (use.kind === 'cast' && use.via === 'morph') items.push([use.label, () => this.send({ kind: 'cast', objId: o.id, targets: [], via: 'morph' })]);
          else if (use.kind === 'cast') items.push([use.label, () => this.beginCast(o, a, use.via)]);
        }
      } else if ((loc.zone === 'graveyard' || loc.zone === 'exile') && mine) {
        for (const use of ((live.uses || {})[o.id] || [])) {
          if (use.kind === 'cast') items.push([use.label, () => this.beginCast(o, a, use.via)]);
          if (use.kind === 'encore') items.push([use.label, () => this.send({ kind: 'encore', objId: o.id })]);
        }
      } else if (loc.zone === 'battlefield' && mine && a) {
        const acts = (a.abilities || []).filter(x => x.kind === 'activated' || x.kind === 'loyalty');
        a.manaAbilities.forEach((ab, i) => items.push([`Mana: ${truncate(MTG.oracle.abilityLabel(ab), 42)}`, () => this.send({ kind: 'mana', objId: o.id, index: i })]));
        acts.forEach((ab) => {
          const idx = a.manaAbilities.length + acts.indexOf(ab);
          items.push([truncate(MTG.oracle.abilityLabel(ab), 52), () => this.activate(o, a, idx, ab)]);
        });
      }
      items.push(['Look at this card', () => this.showCard(o.id)]);
      if (mine) {
        const manual = this.manualItems(o, loc.zone);
        if (manual.length) items.push('-', ['By hand ▸', (ev) => UI.contextMenu(ev || e, manual, { title: 'Move or mark by hand' })]);
      }
      UI.contextMenu(e || { clientX: window.innerWidth / 2, clientY: window.innerHeight / 2 }, items, { title: o.card ? o.card.name : 'Card' });
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
        const uses = mine ? ((live.uses || {})[o.id] || []) : [];
        const tile = el('button', { type: 'button', class: 'zone-tile' + (uses.length ? ' usable' : ''), title: o.card.name }, [
          el('div', { class: 'zt-img', style: { backgroundImage: 'url("' + (MTG.scry.imageUrl(o.card, 'normal', o.face || 0) || '').replace(/"/g, '%22') + '")' } }),
          uses.length ? el('span', { class: 'zt-use', text: uses[0].label }) : null,
        ].filter(Boolean));
        tile.addEventListener('click', (e) => {
          if (mine) { m.close(); this.cardMenu(o.id, e); } else { this.showCard(o.id); }
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
      UI.contextMenu(e, [
        ['Game log  (L)', () => this.toggleDrawer(true, 'log')],
        MTG.net && MTG.net.online ? ['Chat', () => this.toggleDrawer(true, 'chat')] : null,
        [`Sort hand by ${nextSort[1]}`, () => { MTG.setSetting('handSort', nextSort[0]); this.render(); }],
        [`Pace: ${paceName(MTG.settings.animSpeed)}  → ${paceName(nextPace(MTG.settings.animSpeed))}`,
          () => MTG.setSetting('animSpeed', nextPace(MTG.settings.animSpeed))],
        [`Bots: ${botPaceName(MTG.settings.botSpeed)}  → ${botPaceName(nextBotPace(MTG.settings.botSpeed))}`,
          () => MTG.setSetting('botSpeed', nextBotPace(MTG.settings.botSpeed))],
        [live.fullControl ? 'Full control: on' : 'Full control: off  (Ctrl)', () => this.send({ kind: 'fullControl', on: !live.fullControl, sticky: !live.fullControl })],
        this.isReplay ? null : ['Table tools ▸', (ev) => this.toolsMenu(ev || e)],
        MTG.app.canSaveReplay && MTG.app.canSaveReplay() ? ['Save replay', () => MTG.app.saveReplay()] : null,
        '-',
        this.isReplay ? ['Stop watching', () => MTG.app.leaveGame({ keepSave: true })] : ['Save and leave', () => MTG.app.exitToMenu()],
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
        ['Flip a coin', () => this.send({ kind: 'manual', action: 'coin' })],
        ['Untap everything', () => this.send({ kind: 'manual', action: 'untapAll' })],
      ], { title: 'Table tools — for by-hand fixes' });
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
      return MTG.mana.textHtml ? h.replace(/\{[^}]+\}/g, (m) => MTG.mana.html(m)) : h;
    }

    /** @this {MTG.TableInstance} */
    addChat(msg) {
      this.chat.push(msg);
      if (this.drawerOpen && this.drawerTab === 'chat') { this._drawerSig = null; this.renderDrawer(); }
      else if (msg && msg.text) this.say(`${msg.from}: ${msg.text}`, 'chat');
    }

    /* For the app: it asks a table to close its side panel on a layout change. */
    closeSide() { this.toggleDrawer(false); }

    /** Bring an opponent's board forward; a choice you make holds until the turn changes. */
    setFocus(id, pin) {
      if (!id) { this._pinned = null; this.render(); return; }
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
  const BOT_PACES = [[250, 'snappy'], [600, 'normal'], [1100, 'deliberate']];
  const botPaceName = (v) => (BOT_PACES.find(p => p[0] === (v == null ? 600 : v)) || [0, 'custom'])[1];
  const nextBotPace = (v) => { const i = BOT_PACES.findIndex(p => p[0] === (v == null ? 600 : v)); return BOT_PACES[(i + 1) % BOT_PACES.length][0]; };

  function toggleIn(list, id, max) {
    const i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1);
    else if (list.length < (max || 1)) list.push(id);
  }
  function poolHtml(pool) {
    if (!pool) return '';
    return ['W', 'U', 'B', 'R', 'G', 'C'].map(c => pool[c] ? `<i class="pip pip-${c.toLowerCase()}">${pool[c]}</i>` : '').join('');
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
