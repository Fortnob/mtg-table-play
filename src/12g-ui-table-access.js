/* ============================================================
   12g-ui-table-access.js - the table by keyboard and screen reader

   Every card on the table could already be reached with Tab, and Enter
   did what a click does. This is the rest of what playing without a
   mouse, or without seeing the screen, takes:

   - Moving round the table by rows. The arrow keys go along a row and
     up and down between rows; a letter jumps to each part (H your hand,
     B your battlefield, O theirs, S the stack, P the players, Q the
     question being asked); N goes to the next thing you could use or
     choose right now. ? lists every key.
   - What happens, said. Each new line of the game log goes to a polite
     live region, W says how the game stands, and every card's label says
     what it can do at the moment: be played, attack, block, be targeted.
   - Focus that follows the game. A question in the middle of the table
     takes the focus; a choice made on the board (attackers, blockers, a
     target) puts it on the first thing that can be chosen; and when the
     moment is over, or the card under it leaves, it goes back somewhere
     sensible rather than falling off the page.

   The table's own methods are wrapped, not rewritten, the way the sound
   is (src/12f-ui-feel.js). Nothing here moves on its own, so there is
   nothing for reduced motion to turn off.
   ============================================================ */
'use strict';
(function (MTG) {
  const { el, util: U } = MTG;
  const UI = MTG.ui;
  const Table = UI.Table;
  const { stepKey, possessive, STEP_WORDS } = Table.helpers;

  const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
  const visible = (n) => !!(n && n.isConnected && n.getClientRects().length);
  const focusOn = (n) => { if (n && n.focus) { try { n.focus({ preventScroll: true }); } catch (e) { /* gone */ } } };
  const centreX = (n) => { const r = n.getBoundingClientRect(); return r.left + r.width / 2; };

  /* Whether the last thing touched was the keyboard. A choice on the board
     takes the focus only then, or while the focus is on the table already,
     so nobody playing by touch sees a card rise out of the hand by itself. */
  let byKeys = false;
  document.addEventListener('keydown', () => { byKeys = true; }, true);
  document.addEventListener('pointerdown', () => { byKeys = false; }, true);

  /** A log line as it should be heard: no rules of dashes, mana symbols in words. */
  function spoken(text) {
    let s = String(text || '').replace(/^-+\s*|\s*-+$/g, '').trim();
    s = s.replace(/(\{[^}]+\})+/g, (m) => {
      if (m === '{T}') return 'tap';
      if (m === '{Q}') return 'untap';
      return MTG.mana && MTG.mana.speak ? MTG.mana.speak(m) : m;
    });
    return s;
  }

  /* ---------------- the list of keys ---------------- */
  const KEYS = [
    ['At the table', [
      [['Space'], 'Press the big button: pass, resolve, attack, block or confirm'],
      [['Enter'], 'Pass until somebody responds. On a card or a button, Enter uses that instead'],
      [['Shift', 'Enter'], 'Pass to the end of the turn'],
      [['Ctrl'], 'Full control for this step: nothing is passed for you. Ctrl+Shift keeps it on'],
      [['Z'], 'Undo (Ctrl+Z works too)'],
      [['Esc'], 'Cancel choosing a target; close a menu, the log or a card'],
      [['W'], 'Say how the game stands: the turn, life, the stack and what is being asked'],
      [['L'], 'Open or close the game log'],
      [['?'], 'This list'],
    ]],
    ['Moving round the table', [
      [['H'], 'Your hand'],
      [['B'], 'Your battlefield'],
      [['O'], 'Your opponent’s battlefield'],
      [['S'], 'The stack, top first'],
      [['P'], 'The players, one after another, you first'],
      [['Q'], 'The question being asked, or the big button when nothing is'],
      [['N'], 'The next card or player you can use or choose right now (Shift+N goes back)'],
      [['←', '→'], 'The card to the left or right'],
      [['↑', '↓'], 'The row above or below: their side, the stack, your side, your hand'],
      [['Home', 'End'], 'The first or last card in the row'],
      [['1', '–', '8'], 'Look at another opponent’s board (←, → do it too away from the cards)'],
    ]],
    ['On a card or a player', [
      [['Enter'], 'What a click does: play it, attack or block with it, choose it, use its ability'],
      [['I'], 'Read it at full size'],
      [['M'], 'Everything else it can do, and the by-hand tools (so does the menu key)'],
    ]],
    ['Choosing', [
      [['Enter'], 'Attacking: on each creature to send in, again to hold it back; then Space'],
      [['Enter'], 'Blocking: on your creature, then on the attacker it blocks; two can block one; then Space'],
      [['N', 'Enter'], 'A target: N to the next thing that can be chosen, Enter to choose it'],
      [['N', 'Enter'], 'Convoke: on each creature to tap for the spell, again to take it back; then Space'],
      [['Tab'], 'A question in the middle of the table takes the focus; Tab goes between its answers'],
    ]],
  ];

  /** Every key, in a window: on ?, from the game menu and from Options. */
  UI.keyboardHelp = function () {
    const groups = KEYS.map(([title, rows]) => el('section', { class: 'kh-group' }, [
      el('h3', { class: 'kh-title', text: title }),
      el('dl', { class: 'kh-list' }, rows.flatMap(([keys, what]) => [
        el('dt', { class: 'kh-keys' }, keys.map(k => k === '–' ? el('span', { class: 'kh-to', text: 'to' }) : el('kbd', { class: 'kbd', text: k }))),
        el('dd', { class: 'kh-what', text: what }),
      ])),
    ]));
    const note = el('p', { class: 'kh-note', text: 'With a screen reader, switch to focus mode (forms mode) at the table so the letters reach the game. ' +
      'Each new line of the game log is read out as it happens, and every card says what it can do right now.' });
    const m = UI.modal({ title: 'Keyboard', width: '720px', className: 'kh-modal', content: el('div', { class: 'kh-body' }, groups.concat([note])) });
    m.button('Close', (mm) => mm.close(), 'primary');
    return m;
  };

  Object.assign(Table.prototype, {

    /* ---------------- the rows ---------------- */

    /**
     * The table as rows to move along, top to bottom: each opponent's
     * portrait, hand and piles, their back row and their front row, the
     * stack, your front row and back row, your portrait and piles, and
     * your hand. Only what is on screen.
     */
    accessRows() {
      const rows = [];
      const add = (key, nodes) => { const list = nodes.filter(n => n && visible(n)); if (list.length) rows.push({ key, nodes: list }); };
      const cards = (host) => (host ? Array.from(host.querySelectorAll('.cv[data-id]')) : []);
      const hudOf = (hud) => (hud ? [hud.querySelector('.life-orb'), ...cards(hud.querySelector('.ohand')),
        ...hud.querySelectorAll('.pile'), ...cards(hud.querySelector('.cmd-zone'))] : []);
      for (const root of Array.from(this.oppWrap.children)) {
        const id = root.dataset.seat;
        add('hud:' + id, hudOf(root.querySelector('.seat-hud')));
        add('back:' + id, cards(root.querySelector('.field-row.back')));
        add('front:' + id, cards(root.querySelector('.field-row.front')));
      }
      add('stack', Array.from(this.stackCol.querySelectorAll('.stack-item')).map(w => w.querySelector(':scope > .cv, :scope > .ability-chip')));
      for (const root of Array.from(this.myWrap.children)) {
        const id = root.dataset.seat;
        add('front:' + id, cards(root.querySelector('.field-row.front')));
        add('back:' + id, cards(root.querySelector('.field-row.back')));
        // watching: the seat below is somebody else's, with its own portrait
        add('hud:' + id, hudOf(root.querySelector('.seat-hud')));
      }
      if (this.me) add('hud:' + this.meId, hudOf(this.meHud));
      add('hand', cards(this.handHost));
      return rows;
    },

    /** Where a node sits among the rows: {rows, r, c}, or null when it is in none of them. */
    accessFind(node, rows) {
      rows = rows || this.accessRows();
      for (let r = 0; r < rows.length; r++) {
        const c = rows[r].nodes.indexOf(node);
        if (c >= 0) return { rows, r, c };
      }
      return null;
    },

    /** Move along a row (dx), between rows (dy) or to an end of the row (edge -1 / 1). False when not on a row. */
    accessMove(dx, dy, edge) {
      const at = this.accessFind(document.activeElement);
      if (!at) return false;
      const row = at.rows[at.r].nodes;
      if (edge) { focusOn(row[edge < 0 ? 0 : row.length - 1]); return true; }
      if (dx) { focusOn(row[U.clamp(at.c + dx, 0, row.length - 1)]); return true; }
      const to = at.rows[at.r + dy];
      if (!to) return true;               // the top or the bottom of the table: stay put
      // the card nearest the one you were on, left to right
      const x = centreX(row[at.c]);
      let best = to.nodes[0], d = Infinity;
      for (const n of to.nodes) { const dd = Math.abs(centreX(n) - x); if (dd < d) { d = dd; best = n; } }
      focusOn(best);
      return true;
    },

    /** Straight to a part of the table, or a word saying it is empty. */
    accessJump(which) {
      const rows = this.accessRows();
      const opp = this.focusSeat || ((this._opponents()[0] || {}).id);
      const me = this.me ? this.meId : ((this.myWrap.firstChild && this.myWrap.firstChild.dataset.seat) || '');
      const plan = {
        hand: [['hand'], 'Your hand is empty.'],
        mine: [['front:' + me, 'back:' + me], 'There is nothing on your battlefield.'],
        theirs: [['front:' + opp, 'back:' + opp, 'hud:' + opp], 'There is nothing on their battlefield.'],
        stack: [['stack'], 'The stack is empty.'],
      }[which];
      for (const k of plan[0]) {
        const row = rows.find(x => x.key === k);
        if (row) { focusOn(row.nodes[0]); return; }
      }
      this.accessSay(plan[1], true);
    },

    /** The players' portraits in turn, you first, then everyone else. */
    accessPlayers(dir) {
      const seen = new Set(), list = [];
      const orbs = [this.meHud, this.oppWrap, this.myWrap, this.oppStrip]
        .flatMap(h => Array.from(h.querySelectorAll('.life-orb')));
      for (const o of orbs) {
        const pid = o.dataset.player;
        if (!pid || seen.has(pid) || !visible(o)) continue;
        seen.add(pid);
        list.push(o);
      }
      if (!list.length) return;
      const i = list.indexOf(document.activeElement);
      focusOn(list[i < 0 ? 0 : (i + dir + list.length) % list.length]);
    },

    /** What can be used or chosen right now, in the order the rows run. */
    accessActionable() {
      const list = [];
      for (const r of this.accessRows()) for (const n of r.nodes) {
        if (n.matches('.playable, .targetable, .candidate, .chosen, .life-orb.targetable') || (n.closest('.stack-item.targetable'))) list.push(n);
      }
      // a player chosen from the strip at a bigger table
      for (const o of this.oppStrip.querySelectorAll('.life-orb.targetable, .life-orb.chosen')) if (visible(o) && !list.includes(o)) list.push(o);
      return list;
    },

    accessNext(dir) {
      const list = this.accessActionable();
      if (!list.length) { this.accessSay('Nothing can be used or chosen right now.', true); return; }
      const i = list.indexOf(document.activeElement);
      focusOn(list[i < 0 ? (dir > 0 ? 0 : list.length - 1) : (i + dir + list.length) % list.length]);
    },

    /* ---------------- the question ---------------- */

    /** What is being asked of you right now, as a key that changes when the question does ('' for nothing). */
    accessQuestion() {
      const v = this.view, live = this.live || v;
      if (!v) return '';
      const host = this.decision;
      if (host.classList.contains('on') && host.firstChild) return 'panel:' + (host._base || host._key || '');
      if (this.targeting) return 'aim:' + (this.targeting.cardName || this.targeting.label || '');
      if (this.convoking) return 'convoke:' + this.convoking.steps.o.id;
      const ch = live && live.pendingChoice;
      if (ch && ch.playerId === this.meId && !ch.waiting) {
        if (ch.type === 'declareBlockers' && this.blockPlan && this.blockPlan.pendingBlocker) return 'blk:' + this.blockPlan.pendingBlocker;
        return 'ch:' + ch.type + ':' + (ch.prompt || '') + ':' + v.turn;
      }
      return '';
    },

    /** Where the focus goes for a question: an answer in the panel, else the first thing on the board that answers it. */
    accessQuestionTarget() {
      const host = this.decision;
      if (host.classList.contains('on') && host.firstChild) {
        const primary = host.querySelector('.dp-buttons .btn.primary:not([disabled])');
        if (primary && visible(primary)) return primary;
        const all = Array.from(host.querySelectorAll(FOCUSABLE)).filter(visible);
        return all.find(n => !n.closest('.dp-buttons')) || all[0] || null;
      }
      const list = this.accessActionable();
      return list.find(n => n.matches('.targetable, .candidate')) || list[0] || null;
    },

    /** Q: to the question, or to the big button when there is none. */
    accessFocusQuestion() {
      const t = this.accessQuestion() ? this.accessQuestionTarget() : null;
      focusOn(t || (this.dock && this.dock._main));
    },

    /* ---------------- saying things ---------------- */

    /**
     * Something said. `now` replaces whatever was being said (an answer to
     * a key); otherwise it is added to the running log of the game.
     */
    accessSay(text, now) {
      if (!text) return;
      if (now) {
        const n = this.srNow;
        if (!n) return;
        n.textContent = '';
        // emptied and filled again a moment later, so the same words twice are still read twice
        clearTimeout(this._srNowT);
        this._srNowT = setTimeout(() => { n.textContent = text; }, 40);
        return;
      }
      const log = this.srLog;
      if (!log) return;
      log.appendChild(el('p', { text }));
      while (log.childNodes.length > 12) log.removeChild(log.firstChild);
    },

    /** New lines of the game log since the last view shown, read out. */
    accessAnnounce() {
      const v = this.view;
      const log = (v && v.log) || [];
      const key = (e) => (e ? e.t + '|' + e.text : '');
      const last = key(log[log.length - 1]);
      if (this._srSeen === undefined) { this._srSeen = last; return; }   // the game so far is in the log, not read out
      if (last === this._srSeen) return;
      let i = log.length - 1;
      while (i >= 0 && key(log[i]) !== this._srSeen) i--;
      // an undo, or a gap longer than the log: just the latest
      const fresh = i < 0 ? log.slice(-1) : log.slice(i + 1);
      this._srSeen = last;
      const lines = fresh.filter(e => e.type !== 'mana').map(e => spoken(e.text)).filter(Boolean);
      if (!lines.length) return;
      const said = lines.length > 8 ? [`${lines.length - 8} things happened, then:`].concat(lines.slice(-8)) : lines;
      this.accessSay(said.join(' '));
    },

    /** W: how the game stands, in a few sentences. */
    accessSummary() {
      const v = this.view;
      if (!v) return '';
      const live = this.live || v;
      const bits = [];
      const ap = v.players.find(p => p.id === v.activePlayer);
      const whose = !ap ? 'their turn' : ap.id === this.meId ? 'your turn' : `${possessive(ap.name)} turn`;
      bits.push(`Turn ${v.turn || 1}, ${whose}, ${String(STEP_WORDS[stepKey(v)] || 'starting').toLowerCase()}.`);
      const order = (this.me ? [this.me] : []).concat(this._opponents());
      for (const p of order) {
        const mine = p.id === this.meId;
        const creatures = v.battlefield.filter(o => o.controller === p.id && o.power != null).length;
        const lands = v.battlefield.filter(o => o.controller === p.id && o.card && /\bLand\b/.test(o.card.type_line || '')).length;
        const extra = [p.poison ? `${p.poison} poison` : '', p.hasLost ? 'out of the game' : ''].filter(Boolean).join(', ');
        bits.push(`${mine ? 'You have' : p.name + ' has'} ${p.life} life, ${p.handSize} card${p.handSize === 1 ? '' : 's'} in hand, ` +
          `${creatures} creature${creatures === 1 ? '' : 's'} and ${lands} land${lands === 1 ? '' : 's'}${extra ? ', ' + extra : ''}.`);
      }
      const stack = (live.stack || []).slice().reverse();
      if (stack.length) {
        bits.push('On the stack, top first: ' + stack.map(s => {
          const who = v.players.find(p => p.id === s.controller);
          const tg = (s.targets || []).map(t => this.targetName(t)).filter(Boolean);
          return `${!who ? 'their' : who.id === this.meId ? 'your' : possessive(who.name)} ${s.name || (s.card ? s.card.name : 'ability')}` +
            (tg.length ? ' targeting ' + tg.join(' and ') : '');
        }).join('; ') + '.');
      }
      const banner = this.banner && this.banner.classList.contains('on') ? this.banner.textContent.trim() : '';
      if (banner) bits.push(banner.replace(/\s+/g, ' ') + (/[.!?]$/.test(banner) ? '' : '.'));
      if (!v.over) {
        const act = this.primaryInfo();
        if (act && act.label) bits.push(`The big button says ${act.label}${act.sub ? ', ' + act.sub : ''}${act.disabled ? ', and cannot be pressed yet' : ''}.`);
      }
      return bits.join(' ');
    },

    /* ---------------- labels ---------------- */

    /**
     * Each card's label, from the table's own description of it, with where
     * it is when the region does not say (whose it is, what it targets on
     * the stack) and what it can do right now.
     */
    accessLabels() {
      const v = this.view, live = this.live || v;
      if (!v) return;
      const ch = live.pendingChoice && live.pendingChoice.playerId === this.meId && !live.pendingChoice.waiting ? live.pendingChoice : null;
      const names = new Map(v.players.map(p => [p.id, p.id === this.meId ? 'you' : p.name]));
      const ctrl = new Map(v.battlefield.map(o => [o.id, o.controller]));
      const onStack = new Map((v.stack || []).filter(s => s.objId).map(s => [s.objId, s]));
      const top = (v.stack || [])[(v.stack || []).length - 1];
      const pending = this.blockPlan && this.blockPlan.pendingBlocker;
      // whose: "Mira’s Grizzly Bears", and "Mira’s face-down card"
      const relabel = (n, extra, whose) => {
        const now = n.getAttribute('aria-label') || '';
        if (now !== n._ariaFull) n._ariaBase = now;     // painted again since: a fresh description
        const base = whose ? `${whose} ${n._ariaBase.replace(/^A /, '')}` : n._ariaBase;
        const full = extra.length ? base + '. ' + extra.join(', ') : base;
        if (full !== now) n.setAttribute('aria-label', full);
        n._ariaFull = full;
      };
      for (const [id, n] of this.els) {
        if (!n.isConnected) continue;
        const bits = [];
        const c = ctrl.get(id);
        const whose = c && c !== this.meId ? (names.get(c) ? possessive(names.get(c)) : 'Their') : null;
        const s = onStack.get(id);
        if (s) {
          const tg = (s.targets || []).map(t => this.targetName(t)).filter(Boolean);
          bits.push(`on the stack, ${s.controller === this.meId ? 'yours' : 'cast by ' + (names.get(s.controller) || 'them')}` +
            (tg.length ? ', targeting ' + tg.join(' and ') : '') + (s === top ? ', resolves next' : ''));
        }
        if (n.closest('.hslot.from-exile')) bits.push('in exile, playable');
        if (n.classList.contains('playable')) bits.push('can be played');
        // tapping lands by hand: the spell held for its mana, and what could pay for it
        if (n.classList.contains('paying')) bits.push('waiting for its mana');
        if (n.classList.contains('pay-source')) bits.push('can be tapped for mana');
        if (n.classList.contains('targetable')) bits.push('can be chosen as the target');
        // tapping creatures to convoke: what can tap, and what each one tapping pays
        const conv = this.convoking;
        if (conv && n.classList.contains('candidate')) bits.push('can be tapped to pay for it');
        else if (conv && n.classList.contains('chosen')) bits.push(`tapping to pay ${n._convokeTag ? spoken('{' + n._convokeTag._sym + '}') : 'for it'}, press Enter to take it back`);
        else if (n.classList.contains('candidate')) {
          bits.push(!ch ? 'can be chosen' : ch.type === 'declareAttackers' ? 'can attack'
            : ch.type === 'declareBlockers' ? (pending && pending !== id ? 'press Enter to block it' : 'can block')
            : /discard/.test(ch.type) ? 'can be discarded' : ch.type === 'sacrifice' ? 'can be sacrificed' : 'can be chosen');
        }
        if (n.classList.contains('chosen') && !conv) {
          bits.push(ch && ch.type === 'declareAttackers' ? 'attacking, press Enter to hold it back'
            : ch && ch.type === 'declareBlockers' ? (pending === id ? 'blocking: now choose the attacker' : 'blocking') : 'chosen');
        } else if (n.classList.contains('declared-blk')) bits.push('blocking');
        relabel(n, bits, whose);
      }
      // the players: who can be chosen
      for (const orb of this.arena.querySelectorAll('.life-orb')) {
        const bits = [];
        const p = v.players.find(x => x.id === orb.dataset.player);
        if (p && v.activePlayer === p.id) bits.push(p.id === this.meId ? 'your turn' : 'their turn');
        if (p && p.handSize != null) bits.push(`${p.handSize} card${p.handSize === 1 ? '' : 's'} in hand`);
        if (orb.classList.contains('chosen')) bits.push('chosen');
        else if (orb.classList.contains('targetable')) bits.push('can be chosen');
        relabel(orb, bits);
      }
      // an ability on the stack is a chip, not a card: it is given a name and a place in the order
      for (const chip of this.stackCol.querySelectorAll('.stack-item > .ability-chip')) {
        const w = chip.parentElement;
        const s = (v.stack || []).find(x => x.id === w.dataset.stack);
        if (!s) continue;
        if (!chip.hasAttribute('tabindex')) { chip.tabIndex = 0; chip.setAttribute('role', 'button'); }
        const tg = (s.targets || []).map(t => this.targetName(t)).filter(Boolean);
        // "Mira’s Llanowar Elves ability: …"
        const who = s.controller === this.meId ? 'Your' : names.get(s.controller) ? possessive(names.get(s.controller)) : 'Their';
        const label = `${who} ${s.card ? s.card.name + ' ' : ''}ability: ` +
          spoken(s.abilityText || s.name || '').replace(/\.\s*$/, '') + (tg.length ? '. Targeting ' + tg.join(' and ') : '') + (s === top ? '. Resolves next' : '') +
          (w.classList.contains('targetable') ? '. Can be chosen as the target' : '');
        if (chip.getAttribute('aria-label') !== label) chip.setAttribute('aria-label', label);
      }
      // each side of the table, and its two rows, named for moving round by group
      for (const root of [...this.oppWrap.children, ...this.myWrap.children]) {
        const p = v.players.find(x => x.id === root.dataset.seat);
        const name = !p ? 'A player’s side' : p.id === this.meId ? 'Your side' : `${possessive(p.name)} side`;
        if (root.getAttribute('aria-label') !== name) { root.setAttribute('role', 'group'); root.setAttribute('aria-label', name); }
        for (const row of root.querySelectorAll(':scope .field-row')) {
          if (!row.hasAttribute('aria-label')) {
            row.setAttribute('role', 'group');
            row.setAttribute('aria-label', row.classList.contains('front') ? 'Creatures' : 'Lands and other permanents');
          }
        }
      }
      // a question in the middle is a group named by its title
      const panel = this.decision.querySelector(':scope > .dpanel');
      if (panel && !panel.hasAttribute('role')) {
        const title = panel.querySelector('.dp-title'), sub = panel.querySelector('.dp-sub');
        panel.setAttribute('role', 'group');
        panel.setAttribute('aria-label', [title && title.textContent, sub && sub.textContent].filter(Boolean).join('. ') || 'A question');
      }
    },

    /* ---------------- focus ---------------- */

    /**
     * Where the focus is on the table, before a render, so it can be put
     * back if the render takes it away. Read from the elements alone, with
     * nothing measured: this runs before every render while a card has the
     * focus, and a phone feels every layout forced.
     */
    accessMemo() {
      const a = document.activeElement;
      if (!a || a === document.body || !this.arena.contains(a)) return null;
      if (this.decision.contains(a)) {
        return { where: 'decision', i: Array.from(this.decision.querySelectorAll(FOCUSABLE)).indexOf(a), key: this.decision._base || this.decision._key };
      }
      const cv = a.closest('.cv[data-id]');
      if (cv) {
        const seat = cv.closest('.seat');
        const host = cv.closest('.hand-fan, .stack-col, .field-row, .seat-hud, .me-hud');
        const part = !host ? null : host.matches('.hand-fan') ? 'hand' : host.matches('.stack-col') ? 'stack'
          : host.matches('.me-hud') ? 'hud:' + this.meId
          : seat ? (host.matches('.front') ? 'front:' : host.matches('.back') ? 'back:' : 'hud:') + seat.dataset.seat : null;
        const c = host ? Array.from(host.querySelectorAll('.cv[data-id]')).indexOf(cv) : 0;
        return { where: 'card', id: cv.dataset.id, row: part, c: Math.max(0, c) };
      }
      if (a.classList.contains('life-orb')) return { where: 'orb', pid: a.dataset.player };
      if (a.closest('.arena-pop')) return { where: 'pop', anchor: this._popover && this._popover._anchor };
      // the small buttons under the big one are made again on every render
      if (a.closest('.action-dock')) return { where: 'dock', text: a.textContent };
      return { where: 'other' };
    },

    /** Focus the render took away, put back: the same card wherever it went, or its neighbour, or the question's next answer. */
    accessRestore(memo) {
      if (memo.where === 'decision' && this.decision.classList.contains('on') && this.decision.firstChild) {
        const list = Array.from(this.decision.querySelectorAll(FOCUSABLE)).filter(visible);
        if (list.length) { focusOn(list[U.clamp(memo.i, 0, list.length - 1)]); return; }
      }
      if (memo.where === 'card') {
        const same = this.els.get(memo.id);
        // the same card wherever it went, unless that is the spell held up in the middle for a moment
        if (same && visible(same) && !same.closest('[aria-hidden="true"]')) { focusOn(same); return; }
        const rows = this.accessRows();
        const row = rows.find(r => r.key === memo.row);
        if (row) { focusOn(row.nodes[U.clamp(memo.c, 0, row.nodes.length - 1)]); return; }
      }
      if (memo.where === 'orb') {
        const orb = this.arena.querySelector(`.life-orb[data-player="${CSS.escape(memo.pid)}"]`);
        if (orb && visible(orb)) { focusOn(orb); return; }
      }
      if (memo.where === 'pop' && memo.anchor && visible(memo.anchor)) { focusOn(memo.anchor); return; }
      if (memo.where === 'dock') {
        const same = Array.from(this.dock.querySelectorAll('button:not([disabled])')).find(b => b.textContent === memo.text);
        if (same && visible(same)) { focusOn(same); return; }
      }
      // back where it was before a question took it, else the big button
      const back = this._srReturn;
      this._srReturn = null;
      if (back && visible(back) && !this.decision.contains(back)) { focusOn(back); return; }
      if (this.dock && this.dock._main && visible(this.dock._main)) focusOn(this.dock._main);
    },

    /** A new question takes the focus: an answer in the panel, or the first thing to choose on the board. */
    accessFollow() {
      const key = this.accessQuestion();
      if (key === this._srAsked) return;
      if (key && !this._ready()) return;          // the table is still catching up: ask again when it has
      this._srAsked = key;
      // the question is over; anything the focus was to go back to has had its chance
      if (!key) { this._srReturn = null; return; }
      const a = document.activeElement;
      // somebody busy elsewhere (typing, a window, a menu, reading a card) is left to it
      if (a && (/input|textarea|select/i.test(a.tagName) || a.isContentEditable)) return;
      if (document.querySelector('.modal-back, .ctx-menu, .cardview')) return;
      const onTable = !!(a && this.arena.contains(a) && a !== this.arena);
      if (!key.startsWith('panel:') && !byKeys && !onTable) return;
      const target = this.accessQuestionTarget();
      if (!target || target === a) return;
      if (onTable && !this.decision.contains(a)) this._srReturn = a;
      focusOn(target);
    },

    /** After every render: labels, what is said, and the focus. */
    accessAfterRender(memo) {
      if (this._destroyed || !this.view) return;
      this.accessLabels();
      this.accessAnnounce();
      const a = document.activeElement;
      if (memo && (!a || a === document.body || !a.isConnected)) this.accessRestore(memo);
      this.accessFollow();
    },

    /* ---------------- the keys ---------------- */

    /**
     * A key, before the table's own handler sees it. True when it has been
     * dealt with here (or must be left to the browser, like Space on a
     * button), false to let the table's handler have it.
     */
    accessKey(e) {
      if (this._destroyed || !this.view) return false;
      const t = e.target || document.body;
      if (/input|textarea|select/i.test(t.tagName || '') || t.isContentEditable) return false;
      if (document.querySelector('.modal-back')) return false;
      // a card held up to read, or a menu, has the keyboard: nothing goes on behind it
      if (document.querySelector('.cardview, .ctx-menu')) return true;
      if (e.ctrlKey || e.metaKey || e.altKey) return false;
      const k = e.key;
      const done = () => { e.preventDefault(); return true; };
      // Space and Enter on a real button belong to the button
      if ((k === ' ' || k === 'Enter') && t.closest && t.closest('button, a[href], summary, [role="menuitem"]')) return true;
      if (k === '?') { UI.keyboardHelp(); return done(); }
      // the popover beside a permanent: up and down its abilities
      if (this._popover && this._popover.contains(t) && /^Arrow(Up|Down)$|^(Home|End)$/.test(k)) {
        const items = Array.from(this._popover.querySelectorAll('button:not([disabled])'));
        const i = items.indexOf(t);
        const j = k === 'Home' ? 0 : k === 'End' ? items.length - 1 : U.clamp(i + (k === 'ArrowUp' ? -1 : 1), 0, items.length - 1);
        focusOn(items[j]);
        return done();
      }
      // a question in the middle: the arrows go through its answers
      if (this.decision.contains(t) && /^Arrow/.test(k)) {
        const items = Array.from(this.decision.querySelectorAll(FOCUSABLE)).filter(visible);
        const i = items.indexOf(t.closest(FOCUSABLE) || t);
        if (i >= 0) focusOn(items[U.clamp(i + (k === 'ArrowLeft' || k === 'ArrowUp' ? -1 : 1), 0, items.length - 1)]);
        return done();
      }
      // an ability on the stack: Enter aims at it while a target is being chosen
      const chip = t.closest && t.closest('.stack-item > .ability-chip');
      if (chip && k === 'Enter') {
        if (this.targeting) this.aimAtStack(chip.parentElement.dataset.stack);
        return done();
      }
      if (k === 'ArrowLeft' || k === 'ArrowRight') return this.accessMove(k === 'ArrowLeft' ? -1 : 1, 0) ? done() : false;
      if (k === 'ArrowUp' || k === 'ArrowDown') return this.accessMove(0, k === 'ArrowUp' ? -1 : 1) ? done() : false;
      if (k === 'Home' || k === 'End') return this.accessMove(0, 0, k === 'Home' ? -1 : 1) ? done() : false;
      const cv = t.closest && t.closest('.cv[data-id]');
      switch (k.toLowerCase()) {
        case 'h': this.accessJump('hand'); return done();
        case 'b': this.accessJump('mine'); return done();
        case 'o': this.accessJump('theirs'); return done();
        case 's': this.accessJump('stack'); return done();
        case 'p': this.accessPlayers(e.shiftKey ? -1 : 1); return done();
        case 'q': this.accessFocusQuestion(); return done();
        case 'n': this.accessNext(e.shiftKey ? -1 : 1); return done();
        case 'w': this.accessSay(this.accessSummary(), true); return done();
        case 'm':
          if (!cv) return false;
          { const r = cv.getBoundingClientRect(); this.cardMenu(cv.dataset.id, { clientX: r.right, clientY: r.top, preventDefault() {} }); }
          return done();
        default: return false;
      }
    },
  });

  /* ---------------- hooks into the table ---------------- */
  const base = {
    _build: Table.prototype._build, _keys: Table.prototype._keys, render: Table.prototype.render,
    popover: Table.prototype.popover, closePopover: Table.prototype.closePopover, showCard: Table.prototype.showCard,
  };

  Table.prototype._build = function () {
    const r = base._build.apply(this, arguments);
    try {
      // what happens, read out as it happens; and the answers to W and the jumps
      this.srLog = el('div', { class: 'sr-only', role: 'log', 'aria-live': 'polite', 'aria-relevant': 'additions', 'aria-label': 'What happens' });
      this.srNow = el('div', { class: 'sr-only', role: 'status', 'aria-live': 'polite', 'aria-atomic': 'true' });
      this.arena.append(this.srLog, this.srNow);
      this.arena.setAttribute('aria-label', 'The game table. Press question mark for the keys.');
      if (!this.arena.hasAttribute('role')) this.arena.setAttribute('role', 'region');
      // that log says each thing once; the caption across the middle and the icons down the side would say it again
      this.caption.setAttribute('aria-live', 'off');
      this.caption.removeAttribute('role');
      this.rail.setAttribute('aria-live', 'off');
      // the opening hand's cards are chosen with Enter or Space, as a click on them would
      this.arena.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        const slot = e.target.closest && e.target.closest('.mslot');
        if (!slot || !e.target.matches('.cv') || typeof slot.onclick !== 'function') return;
        e.preventDefault(); e.stopPropagation();
        slot.onclick(e);
      }, true);
    } catch (e) { console.error('[access]', e); }
    return r;
  };

  Table.prototype._keys = function () {
    const r = base._keys.apply(this, arguments);
    const theirs = this._onKey;
    document.removeEventListener('keydown', theirs);
    this._onKey = (e) => {
      let mine = false;
      try { mine = this.accessKey(e); } catch (err) { console.error('[access]', err); }
      if (!mine) theirs(e);
    };
    document.addEventListener('keydown', this._onKey);
    return r;
  };

  Table.prototype.render = function () {
    let memo = null;
    try { memo = this.view && !this._destroyed ? this.accessMemo() : null; } catch (e) { memo = null; }
    const r = base.render.apply(this, arguments);
    try { this.accessAfterRender(memo); } catch (e) { console.error('[access]', e); }
    return r;
  };

  /* The abilities beside a permanent: the first one takes the focus when
     it was opened from the keyboard, and closing it gives the focus back
     to the card. */
  Table.prototype.popover = function (anchor) {
    const from = document.activeElement;
    const r = base.popover.apply(this, arguments);
    const pop = this._popover;
    if (pop) {
      pop._anchor = anchor;
      const title = pop.querySelector('.pop-title');
      if (title) pop.setAttribute('aria-label', title.textContent + ': its abilities');
      if (byKeys || (from && this.arena.contains(from) && from !== this.arena)) focusOn(pop.querySelector('button:not([disabled])'));
    }
    return r;
  };
  Table.prototype.closePopover = function () {
    const pop = this._popover;
    const had = !!(pop && pop.contains(document.activeElement));
    const r = base.closePopover.apply(this, arguments);
    if (had && pop._anchor && visible(pop._anchor)) focusOn(pop._anchor);
    return r;
  };

  /* A card held up to read is a dialog: named, holding the focus while it
     is open, and handing it back when it closes. */
  Table.prototype.showCard = function () {
    const from = document.activeElement;
    const had = new Set(document.querySelectorAll('body > .cardview'));
    const r = base.showCard.apply(this, arguments);
    const view = Array.from(document.querySelectorAll('body > .cardview')).find(n => !had.has(n));
    if (view) {
      const name = view.querySelector('h3');
      view.setAttribute('role', 'dialog');
      view.setAttribute('aria-modal', 'true');
      view.setAttribute('aria-label', name ? name.textContent : 'A card');
      const close = view.querySelector('.btn.primary') || view.querySelector('button');
      focusOn(close);
      view.addEventListener('keydown', (e) => {
        if (e.key !== 'Tab') return;
        const items = Array.from(view.querySelectorAll(FOCUSABLE)).filter(visible);
        if (!items.length) return;
        const i = items.indexOf(document.activeElement);
        e.preventDefault();
        focusOn(items[(i + (e.shiftKey ? -1 : 1) + items.length) % items.length]);
      });
      // closed: the focus goes back to the card it was opened from
      const watch = new MutationObserver(() => {
        if (view.isConnected) return;
        watch.disconnect();
        if (from && visible(from) && (document.activeElement === document.body || !document.activeElement)) focusOn(from);
      });
      watch.observe(document.body, { childList: true });
    }
    return r;
  };

  Table.accessKeys = KEYS;
})(window.MTG);
