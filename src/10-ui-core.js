/* ============================================================
   10-ui-core.js - shared UI: cards, previews, modals, toasts,
   and the art picker.
   ============================================================ */
'use strict';
(function (MTG) {
  const { el, $, $$, util: U } = MTG;
  const UI = MTG.ui = MTG.ui || {};

  /* ---------------- toasts ---------------- */
  UI.toast = function (msg, kind, ms) {
    const host = $('#toasts') || document.body.appendChild(el('div', { id: 'toasts' }));
    const t = el('div', { class: 'toast' + (kind ? ' ' + kind : '') }, [
      el('i', { class: 'toast-mark', 'aria-hidden': 'true' }),
      el('span', { text: msg }),
    ]);
    host.appendChild(t);
    setTimeout(() => { t.classList.add('leaving'); setTimeout(() => t.remove(), 260); }, ms || 3200);
    if (kind === 'err') MTG.sfx('error');
  };
  UI.error = (m) => UI.toast(m, 'err', 4200);
  UI.ok = (m) => UI.toast(m, 'ok');

  /* ---------------- modal ---------------- */
  /* Windows stack: a card search opened from the deck builder sits on top of
     it. Only the top one answers the keyboard, so Escape closes the window
     you are looking at rather than every window at once. */
  const openModals = [];
  let modalSeq = 0;
  const FOCUSABLE = 'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  /**
   * A window over the app. `opts.className` adds a variant class to the
   * window (the deck builder is one), and `opts.art` — a card — lays that
   * card's art behind the title, the way a screen in a card game is headed.
   */
  /* A right-click that does nothing here does nothing at all: no browser
     menu over the table. Text you can type in or have selected keeps its
     menu, for copying and pasting. */
  document.addEventListener('contextmenu', (e) => {
    if (e.defaultPrevented) return;
    const t = e.target;
    if (t && t.closest && t.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
    const sel = window.getSelection && window.getSelection();
    if (sel && !sel.isCollapsed && String(sel).trim()) return;
    e.preventDefault();
  });

  /* No browser tooltips: a title attribute shows the system's own hover box
     ("Tide Shaper — - and + change how many…"), which looks like nothing else
     here. Whatever sets one, here or later, it comes off as soon as it is
     set. Its words go where a screen reader still finds them: as the name of
     something with no words of its own, or as its description otherwise. */
  function untitle(node) {
    const t = node.getAttribute('title');
    if (t == null) return;
    node.removeAttribute('title');
    if (!t.trim() || node.hasAttribute('aria-label') || node.hasAttribute('aria-labelledby')) return;
    if (!(node.textContent || '').trim()) node.setAttribute('aria-label', t);
    else if (!node.hasAttribute('aria-description')) node.setAttribute('aria-description', t);
  }
  const untitleAll = (root) => {
    if (root.nodeType !== 1) return;
    if (root.hasAttribute('title')) untitle(root);
    root.querySelectorAll('[title]').forEach(untitle);
  };
  if (typeof MutationObserver !== 'undefined' && document.documentElement) {
    untitleAll(document.documentElement);
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'attributes') { if (m.target.nodeType === 1) untitle(m.target); }
        else for (const n of m.addedNodes) untitleAll(n);
      }
    }).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['title'] });
  }

  /* Mana written in words is drawn as its symbols, wherever it turns up:
     "{1}{G}{W}{U}: Put Derevi onto the battlefield" in a menu, "Put it into
     your hand ({3})", a button, a toast, a prompt. What draws its own
     symbols has done so already; this catches the rest as the words reach
     the page. Never inside something you type in, a list of options (which
     holds words only), or a symbol itself. */
  const SYM = /\{(?:\d{1,2}|[WUBRGCSXYZTQE]|[WUBRGC2]\/[WUBRGP]|[WUBRG]\/[WUBRG]\/P)\}/g;
  const KEEP_WORDS = 'textarea, input, select, option, script, style, code, pre, svg, .pip, [contenteditable=""], [contenteditable="true"], .keep-braces';
  function symbolize(t) {
    const s = t.nodeValue;
    if (!s || s.indexOf('{') < 0) return;
    SYM.lastIndex = 0;
    if (!SYM.test(s)) return;
    const p = t.parentNode;
    if (!p || p.nodeType !== 1 || p.closest(KEEP_WORDS)) return;
    const frag = document.createDocumentFragment();
    let at = 0;
    SYM.lastIndex = 0;
    for (let m; (m = SYM.exec(s));) {
      if (m.index > at) frag.appendChild(document.createTextNode(s.slice(at, m.index)));
      const sym = m[0].slice(1, -1);
      const pip = document.createElement('i');
      pip.className = 'pip in-text ' + MTG.mana.pipClasses(sym);
      pip.dataset.sym = sym;
      pip.textContent = MTG.mana.pipText(sym);
      frag.appendChild(pip);
      at = m.index + m[0].length;
    }
    if (at < s.length) frag.appendChild(document.createTextNode(s.slice(at)));
    p.replaceChild(frag, t);
  }
  function symbolizeAll(n) {
    if (n.nodeType === 3) return symbolize(n);
    if (n.nodeType !== 1 || (n.textContent || '').indexOf('{') < 0) return;
    const walk = document.createTreeWalker(n, NodeFilter.SHOW_TEXT);
    const found = [];
    for (let t; (t = walk.nextNode());) if (t.nodeValue.indexOf('{') >= 0) found.push(t);
    found.forEach(symbolize);
  }
  if (typeof MutationObserver !== 'undefined' && document.documentElement && document.createTreeWalker) {
    symbolizeAll(document.documentElement);
    new MutationObserver((muts) => {
      for (const m of muts) {
        if (m.type === 'characterData') symbolize(m.target);
        else for (const n of m.addedNodes) if (n.isConnected) symbolizeAll(n);
      }
    }).observe(document.documentElement, { subtree: true, childList: true, characterData: true });
  }

  UI.modal = function (opts) {
    const id = 'modal-title-' + (++modalSeq);
    const back = el('div', { class: 'modal-back' });
    const body = el('div', { class: 'modal-body' });
    const foot = el('div', { class: 'modal-foot' });
    const head = el('div', { class: 'modal-head' }, [
      el('h2', { id, text: opts.title || '' }),
      opts.closable === false ? null : el('button', {
        class: 'btn ghost sm modal-x', 'aria-label': 'Close', title: 'Close',
        html: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
        onclick: () => api.dismiss(),
      }),
    ]);
    if (opts.art) UI.artBehind(head, opts.art);
    const modal = el('div', {
      class: 'modal' + (opts.className ? ' ' + opts.className : ''),
      role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': id,
      style: opts.width ? { width: opts.width } : null,
    }, [head, body, foot]);
    back.appendChild(modal);

    if (typeof opts.content === 'string') body.innerHTML = opts.content;
    else if (opts.content) body.appendChild(opts.content);

    const returnTo = document.activeElement;
    const api = {
      el: modal, body, foot, head,
      close(val) {
        if (api._closed) return;
        api._closed = true;
        if (MTG.sfx) MTG.sfx('close');
        const i = openModals.indexOf(api);
        if (i >= 0) openModals.splice(i, 1);
        back.remove();
        document.removeEventListener('keydown', onKey);
        if (returnTo && returnTo.isConnected && returnTo.focus && !openModals.length) {
          try { returnTo.focus({ preventScroll: true }); } catch (e) {}
        }
        if (api._onClose) api._onClose(val);
      },
      /* Closed the way a person closes a window (its X, Escape, a click
         beside it, its own Close): `opts.beforeClose` may keep it open, as
         the deck builder does with work not yet saved. Resolves whether it
         closed. */
      async dismiss() {
        if (api._closed) return true;
        if (api._asking) return false;
        if (opts.beforeClose) {
          api._asking = true;
          let go = false;
          try { go = await opts.beforeClose(api); } finally { api._asking = false; }
          if (!go) return false;
        }
        api.close();
        return true;
      },
      setTitle(t) { head.querySelector('h2').textContent = t; },
      button(label, fn, cls) {
        const b = el('button', { class: 'btn ' + (cls || ''), text: label, onclick: () => fn(api) });
        foot.classList.remove('empty');
        foot.appendChild(b); return b;
      },
    };
    for (const b of (opts.buttons || [])) api.button(b.label, b.onClick || (() => api.close()), b.class);
    if (!foot.childNodes.length) foot.classList.add('empty');
    const onKey = (e) => {
      if (openModals[openModals.length - 1] !== api) return;
      if (e.key === 'Escape' && opts.closable !== false) { e.preventDefault(); api.dismiss(); return; }
      if (e.key === 'Enter' && opts.onEnter) opts.onEnter(api);
      // Tab goes round the window rather than out into the page behind it
      if (e.key === 'Tab') {
        const items = Array.from(modal.querySelectorAll(FOCUSABLE)).filter(n => n.offsetParent !== null);
        if (!items.length) return;
        const first = items[0], last = items[items.length - 1];
        if (!modal.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
        else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener('keydown', onKey);
    if (opts.closable !== false) back.addEventListener('mousedown', (e) => { if (e.target === back) back._downOnBack = true; });
    if (opts.closable !== false) back.addEventListener('click', (e) => {
      // a drag that starts in a field and ends outside the window is not a dismissal
      if (e.target === back && back._downOnBack) api.dismiss();
      back._downOnBack = false;
    });
    openModals.push(api);
    document.body.appendChild(back);
    if (MTG.sfx) MTG.sfx('open');
    if (opts.onOpen) opts.onOpen(api);
    // the window itself takes focus, unless it chose a field: a screen reader
    // reads its title, and the next Tab lands on the first control inside
    modal.setAttribute('tabindex', '-1');
    setTimeout(() => {
      // (nor from a window opened over it meanwhile, which has the focus now)
      if (api._closed || modal.contains(document.activeElement) || openModals[openModals.length - 1] !== api) return;
      try { modal.focus({ preventScroll: true }); } catch (e) {}
    }, 40);
    return api;
  };

  /* close() runs _onClose, so a button that closes first and then resolves is
     answering its own promise with the dismissal. Settle before closing, and
     let the first answer win. */
  /** Yes or no; `opts.yes` / `opts.no` name the two buttons for what they do. */
  UI.confirm = function (msg, title, opts) {
    opts = opts || {};
    return new Promise(res => {
      let done = false;
      const settle = (v) => { if (!done) { done = true; res(v); } };
      const m = UI.modal({
        title: title || 'Confirm',
        content: el('p', { text: msg, style: { margin: 0 } }),
        onEnter: () => { settle(true); m.close(); },
        buttons: [
          { label: opts.no || 'Cancel', onClick: () => { settle(false); m.close(); } },
          { label: opts.yes || 'OK', class: 'primary', onClick: () => { settle(true); m.close(); } },
        ],
      });
      m._onClose = () => settle(false);
    });
  };

  /* ---------------- work not yet saved ----------------
     A window holding work that is not kept yet (the deck builder) registers
     a guard: { dirty() -> bool, ask() -> Promise<bool> }. Whatever would
     take the person away from it (the top navigation, joining a friend,
     opening another deck) asks UI.canLeave() first, and closing or
     reloading the tab gets the browser's own "leave this page?" while any
     guard is dirty. */
  const leaveGuards = [];
  UI.guardLeave = function (g) {
    leaveGuards.push(g);
    return () => { const i = leaveGuards.indexOf(g); if (i >= 0) leaveGuards.splice(i, 1); };
  };
  const isDirty = (g) => { try { return !!g.dirty(); } catch (e) { return false; } };
  UI.unsavedWork = () => leaveGuards.some(isDirty);
  /** Resolves true when it is fine to go: nothing unsaved, or each guard let go of its work. */
  UI.canLeave = async function () {
    for (const g of leaveGuards.slice().reverse()) {
      if (isDirty(g) && !await g.ask()) return false;
    }
    return true;
  };
  if (typeof window !== 'undefined' && window.addEventListener) {
    window.addEventListener('beforeunload', (e) => {
      if (!UI.unsavedWork()) return;
      e.preventDefault();
      e.returnValue = '';   // older browsers ask only when something is set here
    });
  }

  /**
   * "Leave without saving?": staying is the default and has the focus, so
   * Enter or Escape keeps the work. Resolves 'stay', 'discard', or 'save'
   * (offered when `opts.canSave`).
   */
  UI.askLeave = function (opts) {
    opts = opts || {};
    return new Promise(res => {
      let done = false;
      const settle = (v) => { if (!done) { done = true; res(v); } };
      const m = UI.modal({
        title: opts.title || 'Leave without saving?',
        className: 'leave-modal', width: '560px',
        content: el('p', { text: opts.message || 'Your changes are not saved. If you leave now, they are lost.', style: { margin: 0 } }),
        buttons: [
          { label: opts.discardLabel || 'Discard and leave', class: 'danger', onClick: () => { settle('discard'); m.close(); } },
          opts.canSave ? { label: opts.saveLabel || 'Save and leave', onClick: () => { settle('save'); m.close(); } } : null,
          { label: 'Stay and keep editing', class: 'primary', onClick: () => { settle('stay'); m.close(); } },
        ].filter(Boolean),
      });
      m._onClose = () => settle('stay');
      const stay = m.foot.lastChild;
      stay.dataset.default = '1';
      setTimeout(() => { if (stay.isConnected) try { stay.focus({ preventScroll: true }); } catch (e) { /* not focusable yet */ } }, 0);
    });
  };

  /**
   * Put some text on the clipboard. The clipboard API needs a secure page,
   * which the app opened from another computer on the network (a phone on
   * the same Wi-Fi) is not, so it falls back to the old copy command.
   * Resolves whether it worked.
   */
  UI.copyText = async function (text) {
    try {
      if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; }
    } catch (e) { /* the old way, below */ }
    const box = el('textarea', { value: text, readonly: true, style: { position: 'fixed', top: '-1000px', opacity: '0' } });
    document.body.appendChild(box);
    box.select();
    box.setSelectionRange(0, text.length);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    box.remove();
    return ok;
  };

  /** Ask for a line of text; `opts.placeholder` is a faint hint in the empty box. */
  UI.prompt = function (msg, def, title, opts) {
    opts = opts || {};
    return new Promise(res => {
      const input = el('input', { type: 'text', class: 'prompt-input', value: def || '', placeholder: opts.placeholder || '', 'aria-label': title || msg });
      let done = false;
      const settle = (v) => { if (!done) { done = true; res(v); } };
      const m = UI.modal({
        title: title || 'Type it in',
        content: el('div', null, [el('p', { text: msg, class: 'small muted' }), input]),
        onEnter: () => { settle(input.value); m.close(); },
        buttons: [
          { label: 'Cancel', onClick: () => { settle(null); m.close(); } },
          { label: 'OK', class: 'primary', onClick: () => { settle(input.value); m.close(); } },
        ],
        onOpen: () => setTimeout(() => input.focus(), 30),
      });
      m._onClose = () => settle(null);
    });
  };

  /**
   * A progress dialog. `opts.onCancel` gives it a way out: long jobs that
   * talk to the network should always have one, because a dialog with no
   * button and a bar that has stopped moving is indistinguishable from a
   * crash, and the person is left with nothing to click.
   */
  UI.busy = function (title, text, opts) {
    opts = opts || {};
    // until something reports progress the bar runs as a sweep, not a stuck 0%
    const bar = el('div', { class: 'progress indeterminate' }, el('div', { style: { width: '0%' } }));
    const label = el('p', { class: 'small muted', text: text || 'Working…', 'aria-live': 'polite' });
    const note = el('p', { class: 'tiny dim', style: { margin: '10px 0 0' }, text: '' });
    const api = {
      cancelled: false,
      set(pct, msg) {
        bar.classList.remove('indeterminate');
        bar.firstChild.style.width = U.clamp(pct * 100, 0, 100) + '%';
        if (msg) label.textContent = msg;
        api._beat();
      },
      text(msg) { label.textContent = msg; api._beat(); },
      close: () => { clearInterval(api._timer); m.close(); },
      /* if nothing has moved for a while, say so rather than sitting there */
      _beat() { api._last = Date.now(); if (note.textContent) note.textContent = ''; },
    };
    const m = UI.modal({
      title: title || 'Please wait', closable: false, className: 'busy-modal',
      content: el('div', { class: 'busy-body' }, [
        el('div', { class: 'busy-sigil', 'aria-hidden': 'true' }, [el('i'), el('i'), el('b')]),
        el('div', { class: 'busy-text' }, [label, bar, note]),
      ]),
      buttons: opts.onCancel ? [{ label: opts.cancelLabel || 'Cancel', onClick: () => {
        api.cancelled = true;
        api.close();
        opts.onCancel();
      } }] : [],
    });
    api._last = Date.now();
    api._timer = setInterval(() => {
      const idle = Date.now() - api._last;
      if (idle > 12000) {
        note.textContent = opts.onCancel
          ? 'This is taking longer than usual. Scryfall may be busy \u2014 you can wait, or cancel and try again.'
          : 'This is taking longer than usual. Scryfall may be busy.';
      }
    }, 4000);
    return api;
  };

  /* ---------------- card rendering ---------------- */

  /* Card faces are painted as background images rather than <img> elements.
     The table re-renders on every state change, and a background image that
     is already in the HTTP cache paints with no flicker and no refetch. */
  const imgStatus = new Map();   // url -> 'pending' | 'ok' | 'bad'
  UI.cardImage = function (card, size, faceIndex) {
    const url = MTG.scry.imageUrl(card, size || 'normal', faceIndex || 0);
    if (!url || imgStatus.get(url) === 'bad') return UI.cardFallback(card, faceIndex || 0);
    const node = el('div', {
      class: 'card-img', role: 'presentation', 'aria-hidden': 'true',
      style: { backgroundImage: 'url("' + url.replace(/"/g, '%22') + '")' },
    });
    if (!imgStatus.has(url)) {
      imgStatus.set(url, 'pending');
      const probe = new Image();
      probe.decoding = 'async';
      probe.onload = () => imgStatus.set(url, 'ok');
      probe.onerror = () => {
        imgStatus.set(url, 'bad');
        MTG.scry.forgetArt(url);
        if (node.isConnected) node.replaceWith(UI.cardFallback(card, faceIndex || 0));
      };
      probe.src = url;
    }
    return node;
  };
  UI.cardFallback = function (card, faceIndex) {
    const a = MTG.oracle.analyze(card, faceIndex || 0) || {};
    return el('div', { class: 'card-fallback' }, [
      el('div', { class: 'cf-name' }, [
        el('span', { text: a.name || card.name }),
        el('span', { class: 'mana', html: ' ' + MTG.mana.html(a.manaCost || card.mana_cost || '') }),
      ]),
      el('div', { class: 'cf-type', text: a.typeLine || card.type_line || '' }),
      el('div', { class: 'cf-text', html: MTG.mana.textHtml((a.oracleText || card.oracle_text || '').slice(0, 320)) }),
      (a.power != null && a.power !== undefined && a.isCreature)
        ? el('div', { class: 'cf-pt', text: `${a.power}/${a.toughness}` }) : null,
    ]);
  };

  /**
   * A card in a slot, with badges. `state` is a battlefield object view
   * ({tapped, counters, damage, power, toughness, ...}) or null for a plain card.
   */
  /** A card, said out loud: name, cost, what it is, and what is on it. */
  UI.describeCard = function (card, state) {
    state = state || {};
    if (state.faceDown) return 'A face-down card';
    const a = MTG.oracle.analyze(card, state.face || 0) || {};
    const bits = [a.name || card.name];
    if (a.manaCost) bits.push(MTG.mana.speak(a.manaCost));
    if (a.typeLine) bits.push(a.typeLine);
    if (state.power != null && state.toughness != null) bits.push(`${state.power} by ${state.toughness}`);
    if (state.tapped) bits.push('tapped');
    if (state.summoningSick) bits.push('summoning sick');
    if (state.attacking) bits.push('attacking');
    if ((state.blocking || []).length) bits.push('blocking');
    for (const [k, n] of Object.entries(state.counters || {})) if (n) bits.push(`${n} ${k} counter${n === 1 ? '' : 's'}`);
    if (state.damage) bits.push(`${state.damage} damage marked`);
    if (state.isCommander) bits.push('your commander');
    if (state.isSignature) bits.push('your Signature Spell');
    return bits.join(', ');
  };

  UI.cardSlot = function (card, state, opts) {
    opts = opts || {};
    state = state || {};
    const interactive = !!(opts.onClick || opts.onContext || opts.onDblClick);
    const slot = el('div', {
      class: 'card-slot' + (state.tapped ? ' tapped' : '') + (opts.class ? ' ' + opts.class : ''),
      dataset: { id: state.id || card.id },
      role: interactive ? 'button' : 'img',
      tabindex: interactive ? '0' : null,
      'aria-label': UI.describeCard(card, state),
    });
    if (interactive) {
      if (opts.onDblClick) {
        slot.addEventListener('dblclick', (e) => { e.preventDefault(); opts.onDblClick(e, card, state); });
      }
      slot.addEventListener('keydown', (e) => {
        // a caller that wants a key for itself says so by returning true
        if (opts.onKey && opts.onKey(e, card, state)) { e.preventDefault(); return; }
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          if (opts.onClick) opts.onClick(e, card, state);
        } else if (e.key === 'ContextMenu' || (e.shiftKey && e.key === 'F10')) {
          e.preventDefault();
          if (opts.onContext) opts.onContext(e, card, state);
        } else if (e.key.toLowerCase() === 'i') {
          e.preventDefault();
          UI.cardSheet(card, { keywords: state.keywords });   // read this one at full size
        }
      });
    }
    const face = state.face || 0;
    slot.appendChild(state.faceDown ? UI.cardBack() : UI.cardImage(card, opts.size || 'normal', face));

    const badges = [];
    if (state.power != null && state.toughness != null)
      badges.push(el('span', { class: 'badge pt', text: `${state.power}/${state.toughness}` }));
    for (const [k, v] of Object.entries(state.counters || {})) {
      if (!v) continue;
      badges.push(el('span', { class: 'badge counter', text: `${v} ${k}` }));
    }
    if (state.damage) badges.push(el('span', { class: 'badge dmg', text: `${state.damage} dmg` }));
    if (state.isCommander) badges.push(el('span', { class: 'badge cmd', text: 'CMD' }));
    if (state.summoningSick && !opts.hideSick) slot.classList.add('sick');
    if (state.attacking) slot.classList.add('attacking');
    if (state.blocking && state.blocking.length) slot.classList.add('blocking');
    if (badges.length) slot.appendChild(el('div', { class: 'badge-row' }, badges));
    if (state.note) slot.appendChild(el('div', { class: 'card-note', text: state.note }));

    UI.attachPreview(slot, card, face);
    if (opts.onClick) slot.addEventListener('click', (e) => opts.onClick(e, card, state));
    if (opts.onContext) slot.addEventListener('contextmenu', (e) => { e.preventDefault(); opts.onContext(e, card, state); });
    // touch: hold any card to blow it up, since a finger has no hover and
    // pinch-zooming a whole board to read one card is miserable
    if (opts.longPress !== false) {
      UI.longPress(slot, () => {
        UI.cardSheet(card, {
          onActions: opts.onContext ? (ev) => opts.onContext(ev, card, state) : null,
          keywords: state.keywords,
        });
      });
    }
    return slot;
  };

  /* The back of a card. It shows up at three sizes now — a face-down
     permanent, a card in someone else's hand, and the stacks on the mat —
     so the ornament is drawn rather than typed, and scales with the card. */
  /* The real back of a Magic card, as Scryfall serves it. Once it has
     loaded, every back in the app wears it (see :root[data-real-backs] in
     style.css); until then, or offline, the drawn back stands in. */
  UI.CARD_BACK = 'https://backs.scryfall.io/large/0/a/0aeebaf5-8c7d-4636-9e82-8c27447861f7.jpg';
  /* Tap, untap, colourless and the generic numbers as printed, from
     Scryfall; once one has loaded they are all used (symbols.css), and
     until then, or offline, the ones drawn in type stand in. */
  if (typeof Image !== 'undefined' && typeof document !== 'undefined') {
    const tap = new Image();
    tap.onload = () => { document.documentElement.dataset.realSymbols = '1'; };
    tap.src = 'https://svgs.scryfall.io/card-symbols/T.svg';
  }
  if (typeof Image !== 'undefined' && typeof document !== 'undefined') {
    const img = new Image();
    img.onload = () => {
      document.documentElement.style.setProperty('--card-back', `url("${UI.CARD_BACK}")`);
      document.documentElement.dataset.realBacks = '1';
    };
    img.src = UI.CARD_BACK;
  }
  UI.cardBack = function () {
    return el('div', { class: 'card-img card-back' }, [
      el('div', { class: 'back-ring' }, el('div', { class: 'back-pip' })),
    ]);
  };

  /* ---------------- automation ----------------
     The table is honest about what it runs by itself. Every card in a list,
     a pack or a search says whether the engine plays all of its text; the
     few that need a person to carry part of it out say so plainly, before
     anyone sits down to a game with them. Reading a card is cheap once, but
     a list redraws on every click, so the answer is kept per card. */
  const autoMemo = new Map();      // oracle id (or name) -> {auto, coverage, manual}
  UI.autoInfo = function (card) {
    if (!card) return null;
    const key = card.oracle_id || card.name || card.id;
    const had = autoMemo.get(key);
    if (had) return had;
    const a = MTG.oracle.analyze(card) || {};
    const manual = (a.abilities || [])
      .filter(x => !x.auto && x.kind !== 'castModifier')
      .map(x => String(x.text || '').replace(/\s+/g, ' ').trim())
      .filter(Boolean);
    const info = {
      auto: a.fullyAutomated !== false,
      coverage: a.autoCoverage == null ? 1 : a.autoCoverage,
      manual: manual.length ? manual : (a.fullyAutomated === false
        ? [a.otherFaceManual ? 'Its other face is resolved by hand.' : 'Part of its text is resolved by hand.'] : []),
    };
    autoMemo.set(key, info);
    return info;
  };
  /** An open hand: the mark for text you carry out yourself. */
  UI.HAND_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' +
    '<path d="M18 11V6a2 2 0 0 0-4 0v5"/><path d="M14 10V4a2 2 0 0 0-4 0v6"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/>' +
    '<path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-6-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></svg>';

  /** Forget every answer: card scripts changed, so the engine reads cards differently. */
  UI.clearAutoCache = function () { autoMemo.clear(); stamp = null; };

  /**
   * A mark for one card: a quiet tick when the game runs all of it, and a
   * plain "by hand" when some of it is yours to carry out. `opts.corner`
   * pins it to the corner of a card picture; `opts.label` spells it out.
   */
  UI.autoBadge = function (card, opts) {
    opts = opts || {};
    const info = UI.autoInfo(card);
    if (!info) return null;
    const tip = info.auto
      ? 'The game runs all of this card by itself.'
      : 'Needs a hand: the game cannot carry out all of this card, so part of it is yours to do with the table tools.\n\n'
        + info.manual.slice(0, 3).map(t => '• ' + (t.length > 140 ? t.slice(0, 139) + '…' : t)).join('\n');
    return el('span', {
      class: 'auto-badge ' + (info.auto ? 'ok' : 'manual') + (opts.corner ? ' corner' : '') + (opts.label ? ' labelled' : ''),
      title: tip, role: 'img', 'aria-label': info.auto ? 'Automated' : 'Needs a hand',
    }, [
      info.auto ? el('i', { 'aria-hidden': 'true', text: '✓' }) : el('i', { 'aria-hidden': 'true', html: UI.HAND_ICON }),
      opts.label ? el('span', { text: info.auto ? 'Automated' : 'By hand' }) : null,
    ].filter(Boolean));
  };

  /**
   * How much of a deck the game runs by itself, counting copies: the main
   * deck and the commanders, since a sideboard is not in play. `manual`
   * lists the cards that need a person, with how many of each.
   */
  UI.deckAutomation = function (deck) {
    const out = { auto: 0, total: 0, manual: [] };
    if (!deck) return out;
    const rows = (deck.commanders || []).map(c => ({ card: c, qty: 1 })).concat(deck.main || []);
    const seen = new Map();
    for (const e of rows) {
      if (!e || !e.card) continue;
      const info = UI.autoInfo(e.card);
      out.total += e.qty;
      if (info.auto) { out.auto += e.qty; continue; }
      const key = e.card.oracle_id || e.card.name;
      const had = seen.get(key);
      if (had) had.qty += e.qty;
      else { const m = { card: e.card, qty: e.qty, lines: info.manual }; seen.set(key, m); out.manual.push(m); }
    }
    return out;
  };

  /** "58/60 automated", as a pill: green when the game runs all of it. */
  UI.autoShare = function (n, of, opts) {
    opts = opts || {};
    const all = of > 0 && n >= of;
    return el('span', {
      class: 'pill auto-share ' + (all ? 'good' : 'warn') + (opts.class ? ' ' + opts.class : ''),
      title: all ? 'The game runs every card in this deck by itself.'
        : `${of - n} card${of - n === 1 ? '' : 's'} in this deck need${of - n === 1 ? 's' : ''} a hand: part of their text is yours to carry out.`,
      text: `${n}/${of} automated`,
    });
  };

  /* Which build of the engine a remembered count belongs to. The engine
     changes as it learns cards, so a count saved by an older build is
     worked out again rather than trusted. */
  let stamp = null;
  UI.autoStamp = function () {
    if (stamp) return stamp;
    let n = 0;
    try { for (const s of document.scripts) if (!s.src) n += s.textContent.length; } catch (e) {}
    stamp = n + ':' + (MTG.scripts && MTG.scripts.count ? MTG.scripts.count() : 0) + ':' +
      Object.keys(MTG.settings.cardScripts || {}).length;
    return stamp;
  };

  /**
   * Before a game: if the deck has cards that need a hand, say which, once.
   * Resolves true to play, false to stay. `opts.onEdit` opens the deck so
   * it can be changed; a deck that has been warned about and not changed
   * is not warned about again.
   */
  UI.checkAutomation = function (deck, opts) {
    opts = opts || {};
    const sum = UI.deckAutomation(deck);
    if (!sum.manual.length) return Promise.resolve(true);
    const sig = (deck.id || deck.name || '') + '|' + sum.manual.map(m => m.card.name).sort().join('|');
    const warned = MTG.store.get('autoWarned', {}) || {};
    if (warned[sig]) return Promise.resolve(true);
    return new Promise((resolve) => {
      let done = false;
      const settle = (v) => {
        if (done) return;
        done = true;
        // only going ahead counts as having been told; editing or closing asks again next time
        if (v === true) { warned[sig] = Date.now(); MTG.store.set('autoWarned', warned); }
        resolve(!!v);
      };
      const list = el('div', { class: 'auto-warn-list' }, sum.manual.map(m => {
        const row = el('div', { class: 'auto-warn-row' }, [
          el('span', { class: 'qty', text: m.qty + '×' }),
          el('div', { class: 'grow' }, [
            el('div', { class: 'auto-warn-name', text: m.card.name }),
            el('div', { class: 'tiny dim', text: m.lines.slice(0, 2).map(t => t.length > 120 ? t.slice(0, 119) + '…' : t).join(' · ') }),
          ]),
        ]);
        UI.attachPreview(row, m.card, 0);
        UI.longPress(row, () => UI.cardSheet(m.card));
        return row;
      }));
      const m = UI.modal({
        title: 'Some cards need a hand', width: '620px', className: 'auto-warn',
        onOpen: (mm) => mm.head.querySelector('h2').prepend(el('span', { class: 'auto-warn-mark', 'aria-hidden': 'true', html: UI.HAND_ICON })),
        content: el('div', null, [
          el('p', { class: 'small muted', style: { marginTop: 0 }, text:
            `The game runs ${sum.auto} of the ${sum.total} cards in ${deck.name ? '“' + deck.name + '”' : 'this deck'} by itself. `
            + 'The ones below have text it cannot carry out: when they come up you resolve that part yourself, with the table tools in the game menu.' }),
          list,
        ]),
        buttons: [
          { label: 'Edit deck', onClick: () => { settle(false); m.close(); if (opts.onEdit) opts.onEdit(deck); } },
          { label: 'Play anyway', class: 'primary', onClick: () => { settle(true); m.close(); } },
        ],
      });
      m._onClose = () => settle(null);
    });
  };

  /**
   * The picture size an enlarged card needs at `cssWidth` page pixels:
   * 'large' (672 wide) only where the screen has the pixels to show it
   * (a phone, a high-density laptop), else 'normal' (488 wide), the size
   * the cards on the table and in lists already use, so the enlarged one
   * is usually on the device already and shows at once.
   */
  UI.bigSize = function (cssWidth) {
    const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1;
    return cssWidth * dpr * U.zoom() > 520 ? 'large' : 'normal';
  };

  /* ---------------- hover preview ---------------- */
  let previewEl = null;
  function ensurePreview() {
    if (previewEl) return previewEl;
    previewEl = el('div', { id: 'preview' });
    document.body.appendChild(previewEl);
    return previewEl;
  }
  /** The card written out in words — used by the hover preview and the phone sheet. */
  UI.cardTextBlock = function (card, faceIndex) {
    const a = MTG.oracle.analyze(card, faceIndex || 0) || {};
    return el('div', { class: 'prev-text' }, [
      el('div', { class: 'prev-head' }, [
        el('strong', { text: a.name || card.name }),
        el('span', { class: 'prev-cost', html: MTG.mana.html(a.manaCost || '') }),
      ]),
      el('div', { class: 'prev-type', text: a.typeLine || card.type_line || '' }),
      el('div', { class: 'prev-body', html: MTG.mana.textHtml(a.oracleText || '') }),
      (a.isCreature && a.power != null)
        ? el('div', { class: 'prev-pt', text: a.power + '/' + a.toughness }) : null,
    ].filter(Boolean));
  };
  const faceCount = (card) => (card.card_faces && card.card_faces.length > 1 ? card.card_faces.length : 1);

  /**
   * A full-screen look at a card. This is what a phone gets instead of hover:
   * press and hold any card and it fills the screen, art and text together.
   */
  UI.cardSheet = function (card, opts) {
    opts = opts || {};
    document.querySelectorAll('.card-sheet').forEach(n => n.remove());
    const body = el('div', { class: 'card-sheet-body' });
    const faces = faceCount(card);
    let gotImage = false;
    for (let i = 0; i < faces; i++) {
      const url = MTG.scry.imageUrl(card, UI.bigSize(420), i) || MTG.scry.imageUrl(card, 'normal', i);
      if (url) { body.appendChild(el('img', { src: url, alt: card.name, class: 'card-sheet-img' })); gotImage = true; }
    }
    for (let i = 0; i < faces; i++) {
      if (!gotImage || MTG.settings.alwaysCardText || MTG.isPhone()) body.appendChild(UI.cardTextBlock(card, i));
    }
    // its rulings under it (src/10g-rulings.js)
    const rulings = UI.rulingsBox ? UI.rulingsBox(card) : null;
    if (rulings) body.appendChild(rulings);
    const close = () => { sheet.remove(); document.removeEventListener('keydown', onEsc, true); };
    // caught on the way down, so Escape closes the card and not the window under it
    const onEsc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); e.preventDefault(); close(); } };
    const foot = el('div', { class: 'card-sheet-foot' });
    // wanted, for trading with friends (src/10h-ui-trade.js)
    const want = UI.wishButton ? UI.wishButton(card) : null;
    if (want) foot.appendChild(want);
    // whatever this card could do stays one tap away from the blown-up view
    if (opts.onActions) {
      foot.appendChild(el('button', {
        class: 'btn card-sheet-act', text: 'Actions…',
        onclick: (e) => { e.stopPropagation(); close(); opts.onActions(e); },
      }));
    }
    foot.appendChild(el('button', { class: 'btn primary card-sheet-close', text: 'Close' }));
    // with room, keywords to the card's left and tokens to its right; without, under it
    const sides = UI.cardSides(card, { keywords: opts.keywords });
    const any = !!(sides.keywords || sides.tokens);
    const inner = 'card-sheet-inner' + (any ? ' has-kw' : '') + (any && UI.roomForSides() ? ' sides' : '');
    const sheet = el('div', { class: 'card-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-label': card.name }, [
      el('div', { class: inner }, [sides.keywords, body, sides.tokens, foot].filter(Boolean)),
    ]);
    sheet.addEventListener('click', close);
    document.addEventListener('keydown', onEsc, true);
    document.body.appendChild(sheet);
    return { close };
  };

  /**
   * Press and hold. A finger has no right button and no hover, so a long press
   * is how a phone reaches a card's menu (or, failing that, a good look at it).
   * Moving more than a few pixels is a scroll, not a press, so it cancels.
   */
  UI.longPress = function (node, fn) {
    let timer = null, sx = 0, sy = 0, fired = false;
    const cancel = () => { clearTimeout(timer); timer = null; };
    node.addEventListener('touchstart', (e) => {
      const t = e.touches[0];
      if (!t) return;
      sx = t.clientX; sy = t.clientY; fired = false;
      timer = setTimeout(() => {
        fired = true;
        node.classList.add('pressed');
        setTimeout(() => node.classList.remove('pressed'), 180);
        if (navigator.vibrate) { try { navigator.vibrate(12); } catch (err) {} }
        fn({ clientX: sx, clientY: sy, preventDefault() {}, longPress: true });
      }, 420);
    }, { passive: true });
    node.addEventListener('touchmove', (e) => {
      const t = e.touches[0];
      if (!t) return;
      if (Math.abs(t.clientX - sx) > 9 || Math.abs(t.clientY - sy) > 9) cancel();
    }, { passive: true });
    node.addEventListener('touchend', (e) => {
      cancel();
      // a long press already did its job; don't also run the tap action
      if (fired) { e.preventDefault(); e.stopPropagation(); }
    });
    node.addEventListener('touchcancel', cancel, { passive: true });
  };

  UI.attachPreview = function (node, card, faceIndex) {
    if (!MTG.settings.showOracleOnHover) return;
    let timer = null, last = null;
    const show = (e) => {
      /* A finger has no hover. Asked of the pointer itself rather than the
         device: a laptop with a touch screen still has a mouse, and the
         mouse should get its preview. */
      if (e.pointerType === 'touch') return;
      const p = ensurePreview();
      p.innerHTML = '';
      const cards = el('div', { class: 'prev-cards' });
      const faces = faceCount(card);
      let gotImage = false;
      for (let i = 0; i < faces; i++) {
        const url = MTG.scry.imageUrl(card, UI.bigSize(320 * (MTG.settings.cardScale || 1)), i) || MTG.scry.imageUrl(card, 'normal', i);
        // placed again once the picture has come, when it has its real size and may run off the bottom
        if (url) { cards.appendChild(el('img', { src: url, alt: card.name, onload: () => { if (last) move(last); } })); gotImage = true; }
      }
      // no art, or the reader asked for text as well: show the card in words
      if (!gotImage || MTG.settings.alwaysCardText) {
        for (let i = 0; i < faces; i++) cards.appendChild(UI.cardTextBlock(card, i));
      }
      // keywords to the card's left, tokens to its right; a window too narrow for both gets one column of them
      const sides = UI.cardSides(card, { auto: true });
      p.classList.remove('stacked');
      p.append(...[sides.keywords, cards, sides.tokens].filter(Boolean));
      p.style.display = 'flex';
      // three columns that fit on neither side of the pointer would cover what is being pointed at
      if (sides.keywords || sides.tokens) {
        const w = p.offsetWidth, pt = U.pt(e), vw = U.viewW();
        if (w > vw - 12 || (pt.x + 14 + w > vw - 6 && pt.x - 14 - w < 6)) {
          p.classList.add('stacked');
          p.replaceChildren(cards, UI.stackSides(sides));
        }
      }
      UI.fitSides(p);
      move(e);
    };
    const move = (e) => {
      if (!previewEl) return;
      last = e;
      const pad = 14;
      const w = previewEl.offsetWidth || 300, h = previewEl.offsetHeight || 420;
      const pt = U.pt(e), vw = U.viewW(), vh = U.viewH();
      let x = pt.x + pad, y = pt.y + pad;
      const flip = x + w > vw - 6;
      if (flip) x = pt.x - w - pad;
      // too wide for either side of the pointer: as near it as the window allows
      if (x < 6) x = Math.max(6, Math.min(pt.x + pad, vw - w - 6));
      previewEl.classList.toggle('flip', flip);
      if (y + h > vh - 6) y = Math.max(6, vh - h - 6);
      previewEl.style.left = x + 'px';
      previewEl.style.top = y + 'px';
    };
    const hide = () => { clearTimeout(timer); last = null; if (previewEl) previewEl.style.display = 'none'; };
    node.addEventListener('pointerenter', (e) => { if (e.pointerType === 'touch') return; timer = setTimeout(() => show(e), 170); });
    node.addEventListener('pointermove', (e) => { if (e.pointerType !== 'touch') move(e); });
    node.addEventListener('pointerleave', hide);
    node.addEventListener('click', hide);
  };

  /* ---------------- a deck's commander, and what the deck leans on ---------------- */

  /**
   * A commander known only by name and Scryfall id (a printed deck's, or
   * one a deck list remembers) as a card enough to preview: its picture
   * straight from the id. UI.commanderPreview fills in the rest.
   */
  UI.commanderStub = function (name, id) {
    const pic = (size) => `https://cards.scryfall.io/${size}/front/${id[0]}/${id[1]}/${id}.jpg`;
    return { name, id: id || null,
      image_uris: id ? { small: pic('small'), normal: pic('normal'), large: pic('large'), art_crop: pic('art_crop') } : undefined };
  };

  /**
   * Hover `node` to see `card`, as attachPreview does anywhere else. A
   * stand-in card (commanderStub) is made whole from the card cache the
   * first time a pointer comes over it, so its words and its back face
   * show too. A finger is left alone, to tap what it was tapping.
   */
  UI.commanderPreview = function (node, card) {
    if (!node || !card) return node;
    let asked = false;
    node.addEventListener('pointerenter', (e) => {
      if (e.pointerType === 'touch' || asked || !card.id || card.oracle_text != null || card.card_faces) return;
      asked = true;
      MTG.scry.byId(card.id, { low: true, quiet: true }).then((full) => { if (full) Object.assign(card, full); }).catch(() => {});
    });
    UI.attachPreview(node, card, 0);
    return node;
  };

  /** A deck's commanders by name, "Rin and Seri + Atraxa", each one previewed on hover. */
  UI.commanderNames = function (cards, cls) {
    const out = el('span', { class: 'cmd-names' + (cls ? ' ' + cls : '') });
    (cards || []).filter(Boolean).forEach((c, i) => {
      if (i) out.appendChild(document.createTextNode(' + '));
      out.appendChild(UI.commanderPreview(el('span', { class: 'cmd-name', text: U.frontName(c.name) }), c));
    });
    return out;
  };

  /**
   * What a deck leans on (src/15b-themes.js), as one short line: "Tokens ·
   * Lifegain · Sacrifice". With `onTag`, each tag is a button of its own that
   * tells it which was chosen, and does nothing else (the deck around it
   * does not open).
   */
  UI.themeLine = function (tags, cls, onTag) {
    const list = (tags || []).filter(Boolean);
    const line = el('div', { class: 'theme-line' + (onTag ? ' picks' : '') + (cls ? ' ' + cls : ''),
      title: list.length ? 'What the deck leans on: ' + list.join(', ') + (onTag ? '. Choose one to find decks like it.' : '') : '', hidden: !list.length });
    if (!onTag) { line.textContent = list.join(' · '); return line; }
    list.forEach((t, i) => {
      if (i) line.appendChild(document.createTextNode(' · '));
      const pick = (e) => { e.preventDefault(); e.stopPropagation(); onTag(t); };
      line.appendChild(el('span', { class: 'theme-tag', role: 'button', tabindex: '0', text: t, 'aria-label': `Find decks that lean on ${t}`,
        onclick: pick, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') pick(e); } }));
    });
    return line;
  };

  /* ---------------- art picker ---------------- */

  /**
   * Let the player choose which printing (and therefore which art) they
   * want for a card. The choice is remembered by oracle id and applied to
   * every deck they import from then on.
   */
  UI.pickArt = async function (card, opts) {
    opts = opts || {};
    return new Promise(async (resolve) => {
      const grid = el('div', { class: 'art-grid' });
      const status = el('div', { class: 'small muted', text: 'Loading printings…' });
      const filterRow = el('div', { class: 'row wrap', style: { marginBottom: '10px' } });
      const m = UI.modal({
        title: 'Choose art — ' + U.frontName(card.name),
        width: '980px',
        content: el('div', null, [filterRow, status, grid]),
        buttons: [{ label: 'Cancel', onClick: () => { m.close(); resolve(null); } }],
      });
      m._onClose = () => resolve(null);

      let prints = [];
      try { prints = await MTG.scry.printings(card); }
      catch (e) { status.textContent = 'Could not load printings: ' + e.message; return; }
      if (!prints.length) { status.textContent = 'No printings found.'; return; }

      const current = (MTG.settings.artPreferences || {})[card.oracle_id] || card.id;
      let query = '';
      let onlyArtVariants = false;
      let onlyVintage = false;
      // the old frame, from Alpha to Scourge and the retro reprints since
      const vintage = (p) => p.frame === '1993' || p.frame === '1997';

      const search = el('input', { type: 'search', placeholder: 'Filter by set, artist or collector number…', style: { maxWidth: '320px' } });
      search.addEventListener('input', U.debounce(() => { query = search.value.toLowerCase(); render(); }, 150));
      const uniqueArt = el('label', { class: 'row small', style: { gap: '5px' } }, [
        el('input', { type: 'checkbox', style: { width: 'auto' }, onchange: (e) => { onlyArtVariants = e.target.checked; render(); } }),
        el('span', { text: 'Unique art only' }),
      ]);
      const vintageOnly = el('label', { class: 'row small', style: { gap: '5px' } }, [
        el('input', { type: 'checkbox', style: { width: 'auto' }, onchange: (e) => { onlyVintage = e.target.checked; render(); } }),
        el('span', { text: 'Vintage frames' }),
      ]);
      filterRow.append(...[search, uniqueArt, prints.some(vintage) ? vintageOnly : null].filter(Boolean));

      function render() {
        grid.innerHTML = '';
        let list = prints;
        if (query) list = list.filter(p =>
          (p.set_name || '').toLowerCase().includes(query) ||
          (p.set || '').toLowerCase().includes(query) ||
          (p.artist || '').toLowerCase().includes(query) ||
          String(p.collector_number).toLowerCase().includes(query));
        if (onlyVintage) list = list.filter(vintage);
        if (onlyArtVariants) {
          const seen = new Set();
          list = list.filter(p => {
            const k = p.illustration_id || (p.card_faces && p.card_faces[0] && p.card_faces[0].illustration_id) || p.id;
            if (seen.has(k)) return false; seen.add(k); return true;
          });
        }
        status.textContent = `${list.length} printing${list.length === 1 ? '' : 's'}`;
        /* Another printing's art costs Shards, unless it is the one the card
           has now, one you pulled from a pack (or crafted, or bought), or
           collection rules are off. */
        const ec = MTG.economy;
        const locked = (p) => !!(ec && ec.rulesOn() && p.id !== card.id && p.id !== current && !ec.ownsArt(p));
        for (const p of list) {
          const url = MTG.scry.imageUrl(p, 'normal', 0);
          const lock = locked(p);
          const opt = el('div', { class: 'art-option' + (p.id === current ? ' chosen' : '') + (lock ? ' locked' : '') }, [
            lock ? el('div', { class: 'art-lock', html: (UI.shardIcon ? UI.shardIcon() : '') + `<b>${ec.artPrice(p).toLocaleString()}</b>` }) : null,
            url ? el('img', { src: url, loading: 'lazy', alt: p.set_name }) : UI.cardFallback(p, 0),
            el('div', { class: 'cap' }, [
              el('div', { text: `${String(p.set).toUpperCase()} · #${p.collector_number}` }),
              el('div', { class: 'dim', text: p.artist || '' }),
              p.full_art ? el('span', { class: 'pill', text: 'full art' }) : null,
              p.border_color === 'borderless' ? el('span', { class: 'pill', text: 'borderless' }) : null,
              vintage(p) ? el('span', { class: 'pill vintage', text: 'vintage' }) : null,
            ]),
          ]);
          const choose = () => {
            if (opts.remember !== false) {
              MTG.settings.artPreferences = MTG.settings.artPreferences || {};
              if (p.oracle_id) MTG.settings.artPreferences[p.oracle_id] = p.id;
              MTG.saveSettings();
            }
            MTG.sfx('click');
            m._onClose = null;
            m.close();
            resolve(p);
          };
          opt.addEventListener('click', () => {
            if (!lock) return choose();
            UI.purchaseDialog({
              title: `${U.frontName(p.name)}: ${p.set_name || String(p.set).toUpperCase()} art`,
              sub: `#${p.collector_number}${p.artist ? ' \u00b7 ' + p.artist : ''}. Art you pull from packs is free.`,
              cost: ec.artPrice(p),
              visual: url ? el('div', { class: 'deal-img', style: { backgroundImage: 'url("' + url.replace(/"/g, '%22') + '")' } }) : UI.cardFallback(p, 0),
              buy: () => ec.buyArt(p),
              after: () => choose(),
            });
          });
          grid.appendChild(opt);
        }
      }
      render();
    });
  };

  /** Bulk art chooser: walk a deck and pick art for each distinct card. */
  UI.manageDeckArt = function (deck, onChange) {
    const listEl = el('div', { style: { maxHeight: 'calc(60 * var(--vh))', overflowY: 'auto' } });
    const m = UI.modal({
      title: 'Card art — ' + deck.name,
      width: '760px',
      content: el('div', null, [
        el('p', { class: 'small muted', text: 'Click a card to choose a different printing. Your choice is remembered and reused whenever that card appears in a deck you import.' }),
        el('div', { class: 'row', style: { marginBottom: '10px' } }, [
          el('button', { class: 'btn sm', text: 'Clear all saved art choices', onclick: async () => {
            if (!await UI.confirm('Forget every saved art preference?')) return;
            MTG.settings.artPreferences = {}; MTG.saveSettings(); UI.ok('Art preferences cleared.');
          } }),
        ]),
        listEl,
      ]),
      buttons: [{ label: 'Done', class: 'primary', onClick: () => m.close() }],
    });

    function render() {
      listEl.innerHTML = '';
      const all = [];
      for (const c of (deck.commanders || [])) all.push({ card: c, qty: 1, cmd: true });
      for (const e of deck.main) all.push(e);
      for (const e of (deck.sideboard || [])) all.push(e);
      const seen = new Set();
      for (const e of all) {
        const key = e.card.oracle_id || e.card.id;
        if (seen.has(key)) continue;
        seen.add(key);
        const row = el('button', { type: 'button', class: 'art-row' }, [
          el('img', { src: MTG.scry.imageUrl(e.card, 'small', 0), class: 'art-row-thumb', alt: '', loading: 'lazy' }),
          el('div', { class: 'grow' }, [
            el('div', { class: 'art-row-name', text: e.card.name + (e.cmd ? '  (commander)' : '') }),
            el('div', { class: 'tiny dim', text: `${String(e.card.set).toUpperCase()} #${e.card.collector_number}${e.card.artist ? ' · ' + e.card.artist : ''}` }),
          ]),
          el('span', { class: 'btn xs', text: 'Change art' }),
        ]);
        UI.setArt(row, e.card);
        row.addEventListener('click', async () => {
          const picked = await UI.pickArt(e.card);
          if (!picked) return;
          swapEverywhere(deck, e.card, picked);
          if (onChange) onChange(deck);
          render();
        });
        listEl.appendChild(row);
      }
    }
    render();
    return m;
  };

  function swapEverywhere(deck, oldCard, newCard) {
    const same = (c) => c.oracle_id ? c.oracle_id === oldCard.oracle_id : c.id === oldCard.id;
    for (const list of [deck.main, deck.sideboard || [], deck.maybeboard || []])
      for (const e of list) if (same(e.card)) e.card = newCard;
    if (deck.commanders) deck.commanders = deck.commanders.map(c => same(c) ? newCard : c);
    if (deck.companion && same(deck.companion)) deck.companion = newCard;
  }
  UI.swapArtEverywhere = swapEverywhere;

  /* ---------------- art ----------------
     Every screen outside the table is headed by card art, the way a card
     game's menus are. Art is always a layer over a drawn gradient: it fades
     in once the picture has arrived, and if it never does (offline, a card
     with no art) the gradient is simply what you see. */

  /** The crop of a card's illustration, or '' if it has none. */
  UI.artUrl = function (card, faceIndex) {
    if (!card) return '';
    if (typeof card === 'string') return card;
    return MTG.scry.imageUrl(card, 'art_crop', faceIndex || 0) || '';
  };

  const artStatus = new Map();   // url -> Promise<boolean>
  function artLoaded(url) {
    if (!artStatus.has(url)) {
      artStatus.set(url, new Promise((res) => {
        const probe = new Image();
        probe.decoding = 'async';
        probe.onload = () => res(true);
        probe.onerror = () => { MTG.scry.forgetArt(url); res(false); };
        probe.src = url;
      }));
    }
    return artStatus.get(url);
  }

  /**
   * Paint a card's art onto `node` (as a background) once it has loaded.
   * `card` may be a card or an image url. Returns the node.
   */
  UI.setArt = function (node, card, faceIndex) {
    const url = UI.artUrl(card, faceIndex);
    node.classList.add('art');
    if (!url) { node.classList.remove('art-on'); return node; }
    node._artUrl = url;
    artLoaded(url).then((ok) => {
      if (!ok || node._artUrl !== url) return;
      node.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
      // a frame later, so the fade actually runs
      requestAnimationFrame(() => node.classList.add('art-on'));
    });
    return node;
  };

  /** A layer of art laid behind everything else in `host`. */
  UI.artBehind = function (host, card, cls) {
    const layer = el('div', { class: 'art-behind' + (cls ? ' ' + cls : ''), 'aria-hidden': 'true' });
    host.classList.add('has-art');
    host.insertBefore(layer, host.firstChild);
    UI.setArt(layer, card);
    return layer;
  };

  /**
   * The card that stands for a deck: its cover if one was chosen, then the
   * commander, then the most striking spell in it — the rarest and most
   * expensive, which is nearly always the card a deck is built around.
   */
  UI.keyCard = function (deck) {
    if (!deck) return null;
    const all = (deck.main || []).map(e => e.card).filter(Boolean);
    if (deck.cover) {
      const c = all.concat(deck.commanders || []).find(x => x.id === deck.cover || x.oracle_id === deck.cover);
      if (c) return c;
    }
    if ((deck.commanders || []).length) return deck.commanders[0];
    const RANK = { mythic: 4, rare: 3, uncommon: 2, common: 1 };
    // a legendary creature's picture says Commander: a deck without one is shown by its other cards, while it has any
    const legend = (c) => /\bLegendary\b/.test(c.type_line || '') && /\bCreature\b/.test(c.type_line || '');
    const pool = all.some(c => !legend(c) && !/\bLand\b/.test(c.type_line || '') && UI.artUrl(c)) ? all.filter(c => !legend(c)) : all;
    let best = null, bestScore = -1;
    for (const c of pool) {
      if (/\bLand\b/.test(c.type_line || '') || !UI.artUrl(c)) continue;
      const score = (RANK[c.rarity] || 1) * 10 + Math.min(9, c.cmc || 0) +
        (/\b(Creature|Planeswalker)\b/.test(c.type_line || '') ? 3 : 0);
      if (score > bestScore) { best = c; bestScore = score; }
    }
    return best || all[0] || null;
  };

  /* A few cards for decoration, fetched once and then served from the card
     cache. Offline this is an empty list and the screens keep their
     gradients. */
  const featured = new Map();    // key -> Promise<card[]>
  UI.featuredCards = function (names) {
    const key = names.join('|');
    if (!featured.has(key)) {
      featured.set(key, MTG.scry.collection(names.map(name => ({ name })))
        .then(r => (r && r.cards) || [])
        .catch(() => []));
    }
    return featured.get(key);
  };

  /**
   * A portrait in a gold ring — the seat at the table, in miniature. With a
   * card, its art fills the ring; without one it is the initial on the
   * player's colour.
   */
  UI.portrait = function (name, card, opts) {
    opts = opts || {};
    const face = el('span', { class: 'portrait-face', text: ((name || '?').trim()[0] || '?').toUpperCase() });
    face.style.setProperty('--seat-hue', opts.color || UI.avatarColor(name));
    // a profile picture they chose, else the art of a card
    if (opts.avatar && UI.isAvatar && UI.isAvatar(opts.avatar)) {
      face.style.backgroundImage = 'url("' + opts.avatar + '")';
      face.classList.add('art-on');
    } else if (card) UI.setArt(face, card);
    return el('span', { class: 'portrait' + (opts.size ? ' ' + opts.size : '') + (opts.frame ? ' framed frame-' + opts.frame : ''), 'aria-hidden': 'true' }, [
      face, el('span', { class: 'portrait-ring' }),
      // a frame they bought: its ring and what is round it (src/cosmetics.css)
      opts.frame ? el('span', { class: 'frame-fx f-' + opts.frame }) : null,
    ]);
  };

  /** Five mana symbols for a colour identity, or a single grey one for none. */
  UI.pips = function (colors, cls) {
    const list = (colors || []).filter(c => /^[WUBRG]$/.test(c));
    return el('span', {
      class: 'pips' + (cls ? ' ' + cls : ''),
      html: list.length
        ? list.map(c => `<i class="pip pip-${c.toLowerCase()}" title="${MTG.mana.COLOR_NAMES[c]}">${c}</i>`).join('')
        : '<i class="pip pip-c" title="Colourless">C</i>',   // the diamond, as for {C}
    });
  };

  /**
   * A ring chart of how much of each colour there is. `counts` is
   * {W, U, B, R, G, C}; slices are drawn in WUBRG order.
   */
  UI.colorPie = function (counts, opts) {
    opts = opts || {};
    const order = ['W', 'U', 'B', 'R', 'G', 'C'];
    const fills = { W: 'var(--w)', U: 'var(--u)', B: 'var(--b)', R: 'var(--r)', G: 'var(--g)', C: '#a9a39a' };
    const total = order.reduce((a, k) => a + (counts[k] || 0), 0);
    const size = opts.size || 120, r = size / 2 - 8, c = 2 * Math.PI * r;
    let svg = `<svg viewBox="0 0 ${size} ${size}" width="${size}" height="${size}" role="img" aria-label="${opts.label || 'Colour split'}">`;
    svg += `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--pie-track, rgba(255,255,255,.07))" stroke-width="13"/>`;
    let at = 0;
    for (const k of order) {
      const n = counts[k] || 0;
      if (!n || !total) continue;
      const len = n / total * c;
      // a hairline gap between slices, so two pale colours do not run together
      svg += `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${fills[k]}" stroke-width="13"
        stroke-dasharray="${Math.max(0, len - 1.5)} ${c}" stroke-dashoffset="${-at}" transform="rotate(-90 ${size / 2} ${size / 2})" aria-label="${k}: ${n}"></circle>`;
      at += len;
    }
    svg += `<text x="50%" y="50%" text-anchor="middle" dominant-baseline="central" class="pie-n">${opts.center != null ? opts.center : total}</text></svg>`;
    return el('div', { class: 'color-pie', html: svg });
  };

  /* ---------------- small helpers ---------------- */
  UI.avatar = function (name, color) {
    const colors = ['#c9a227', '#5aa0e0', '#4caf7d', '#e0574f', '#a87fd0', '#d98a3c', '#41b7b0', '#cf6d9a'];
    const c = color || colors[Math.abs(hash(name)) % colors.length];
    return el('div', { class: 'avatar', style: { background: c }, text: (name || '?')[0].toUpperCase() });
  };
  function hash(s) { let h = 0; for (const ch of String(s || '')) h = (h * 31 + ch.charCodeAt(0)) | 0; return h; }
  UI.avatarColor = function (name) {
    const colors = ['#c9a227', '#5aa0e0', '#4caf7d', '#e0574f', '#a87fd0', '#d98a3c', '#41b7b0', '#cf6d9a'];
    return colors[Math.abs(hash(name)) % colors.length];
  };

  UI.zoneList = function (title, objects, opts) {
    opts = opts || {};
    const grid = el('div', { class: 'card-grid' });
    for (const o of objects) {
      grid.appendChild(UI.cardSlot(o.card, o, {
        onClick: opts.onClick ? (e, c, s) => opts.onClick(e, c, s, m) : null,
      }));
    }
    if (!objects.length) grid.appendChild(el('div', { class: 'empty-note', text: 'Empty.' }));
    const m = UI.modal({ title, width: '920px', content: grid });
    return m;
  };

  /* A pack is read the way it was collated: the commons first, then the
     uncommons, then the rare slot, with any lands after them, and inside
     each of those bands in colour order. Sorting by colour first scatters
     the two cards you are actually choosing between across the pack. */
  const COLOR_RANK = { W: 0, U: 1, B: 2, R: 3, G: 4 };
  const RARITY_RANK = { common: 0, uncommon: 1, special: 1, bonus: 1, rare: 2, mythic: 3 };
  UI.colorBucket = function (card) {
    const tl = card.type_line || '';
    const ci = card.colors && card.colors.length ? card.colors : (card.color_identity || []);
    if (/\bLand\b/.test(tl) && !ci.length) return 7;
    if (!ci.length) return 6;                      // colourless and artifacts
    if (ci.length > 1) return 5;                   // gold
    return COLOR_RANK[ci[0]] != null ? COLOR_RANK[ci[0]] : 6;
  };
  /** Lands come after the spells whatever they are printed at. */
  UI.packBand = function (card) {
    if (/\bLand\b/.test(card.type_line || '')) return 9;
    const r = RARITY_RANK[card.rarity];
    return r != null ? r : 1;
  };
  /* A pack is read rarest first, left to right, the way you look for the
     rare when you open one: mythics, rares, uncommons, commons. Lands come
     after all of them whatever their rarity (rarest land first), and a basic
     at the very end. */
  const rarestFirst = (c) => {
    // the front face says what it is: a spell with a land on its back is a spell, a pathway is a land
    const tl = (c.card_faces && c.card_faces[0] && c.card_faces[0].type_line) || c.type_line || '';
    const r = RARITY_RANK[c.rarity] != null ? RARITY_RANK[c.rarity] : 1;
    if (/\bBasic\b/.test(tl)) return -20;
    if (/\bLand\b/.test(tl)) return -10 + r;
    return r;
  };
  UI.packOrder = function (cards) {
    return cards.slice().sort((a, b) =>
      rarestFirst(b) - rarestFirst(a) ||
      UI.colorBucket(a) - UI.colorBucket(b) ||
      MTG.mana.sortMv(a) - MTG.mana.sortMv(b) ||
      String(a.name).localeCompare(String(b.name)));
  };

  /* ---------------- card filters ----------------
     The rarity and colour pickers the collection and the deck builder's
     search share: any number on at once, none on is everything. */
  const RAR_WORD = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', mythic: 'Mythic' };
  /**
   * Rarity letters, each in its rarity's colour, and "Any rarity" to let
   * them all through again (all four on is the same as none).
   * @param {string[]} on the rarities picked
   * @param {(next: string[]) => void} onChange
   */
  UI.raritySeg = function (on, onChange) {
    return el('div', { class: 'seg mini rar-chips', role: 'group', 'aria-label': 'Rarity' }, [
      el('button', { type: 'button', class: 'seg-btn' + (on.length ? '' : ' on'), text: 'Any rarity', 'aria-pressed': String(!on.length),
        onclick: () => onChange([]) }),
      ...['common', 'uncommon', 'rare', 'mythic'].map(r => {
        const has = on.includes(r);
        return el('button', { type: 'button', class: 'seg-btn rar-' + r + (has ? ' on' : ''), text: r[0].toUpperCase(),
          title: RAR_WORD[r], 'aria-label': RAR_WORD[r], 'aria-pressed': String(has),
          onclick: () => { const next = has ? on.filter(x => x !== r) : on.concat(r); onChange(next.length === 4 ? [] : next); } });
      }),
    ]);
  };
  const COLOUR_WORD = { W: 'White', U: 'Blue', B: 'Black', R: 'Red', G: 'Green', M: 'Multicolour', C: 'Colourless' };
  /**
   * Colour pips; a click puts one on or takes it off, none on is every
   * colour. With opts.identity a shift-click (on a phone, press and hold)
   * puts a colour on as a colour identity instead, the way Commander counts.
   * @param {Map<string, 'c'|'id'>} on each colour picked, as a colour or an identity
   * @param {(colour: string, mode: 'c'|'id') => void} toggle
   */
  UI.colourSeg = function (on, toggle, opts) {
    opts = opts || {};
    return el('div', { class: 'seg mini colour-seg', role: 'group', 'aria-label': 'Colours' }, Object.keys(COLOUR_WORD).map(c => {
      const mode = on.get(c), name = COLOUR_WORD[c];
      const b = el('button', {
        type: 'button', class: 'seg-btn colour-chip' + (mode ? ' on' : '') + (mode === 'id' ? ' ident' : ''),
        title: mode === 'id' ? `${name} in its colour identity. Click to take it off.` : opts.identity ? `${name}. Shift-click (or hold) for colour identity.` : name,
        'aria-label': mode === 'id' ? `${name} colour identity` : name, 'aria-pressed': mode ? 'true' : 'false',
        html: c === 'C' ? '<i class="pip pip-c">C</i>' : `<i class="pip pip-${c.toLowerCase()}">${c}</i>`,
      });
      let held = null, wasHeld = false;
      if (opts.identity) {
        // a press held on a phone is a shift-click
        b.addEventListener('pointerdown', (e) => {
          if (e.pointerType === 'mouse') return;
          wasHeld = false;
          held = setTimeout(() => { held = null; wasHeld = true; toggle(c, 'id'); }, 480);
        });
        const letGo = () => { if (held) { clearTimeout(held); held = null; } };
        b.addEventListener('pointerup', letGo);
        b.addEventListener('pointerleave', letGo);
        b.addEventListener('contextmenu', (e) => { if (wasHeld) e.preventDefault(); });
      }
      b.addEventListener('click', (e) => {
        if (wasHeld) { wasHeld = false; return; }
        toggle(c, opts.identity && (e.shiftKey || mode === 'id') ? 'id' : 'c');
      });
      return b;
    }));
  };

  /** A card's price, as a small tag on its picture (the collection, the deck builder's grids). */
  UI.priceTag = function (card) {
    const p = U.priceOf(card);
    return el('span', { class: 'price-tag' + (p == null ? ' none' : ''), text: p == null ? 'No price' : U.money(p),
      title: p == null ? 'Scryfall has no price for this card' : 'Its price on Scryfall' });
  };
  // rarest first; a special or bonus printing with the mythics' neighbours
  const RARITY_ORDER = { mythic: 0, special: 1, bonus: 1, rare: 2, uncommon: 3, common: 4 };
  UI.rarityOrder = (card) => { const r = RARITY_ORDER[card && card.rarity]; return r == null ? 5 : r; };
  UI.sortCards = function (list, mode) {
    // dearest first, and a card with no price after every card with one
    const price = (card) => { const p = U.priceOf(card); return p == null ? Infinity : -p; };
    const key = {
      // X costs last: what they cost is up to you
      cmc: (o) => [MTG.mana.sortMv(o.card), o.card.name],
      name: (o) => [o.card.name],
      type: (o) => [(o.card.type_line || ''), MTG.mana.sortMv(o.card)],
      color: (o) => [(o.card.color_identity || []).join(''), MTG.mana.sortMv(o.card)],
      rarity: (o) => [UI.rarityOrder(o.card), MTG.mana.sortMv(o.card), o.card.name],
      price: (o) => [price(o.card), MTG.mana.sortMv(o.card), o.card.name],
    }[mode || 'cmc'] || ((o) => [o.card.name]);
    return list.slice().sort((a, b) => {
      const ka = key(a), kb = key(b);
      for (let i = 0; i < ka.length; i++) {
        if (ka[i] < kb[i]) return -1;
        if (ka[i] > kb[i]) return 1;
      }
      return 0;
    });
  };
})(window.MTG);


