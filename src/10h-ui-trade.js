/* ============================================================
   10h-ui-trade.js - the trade window, the wishlist, and the history
   of trades (src/09d-trade.js holds the logic)

   The trade window: what you give and what you get at the top, each
   side's confirmation under it, and the two binders below, your
   friend's first, with the cards you want picked out and put first.
   On a phone the halves stack and the binders are tabs, the same as on
   a desktop.

   The wishlist is marked with a Want button on a card's full view (the
   card sheet, src/10-ui-core.js) and in the Collection's card window
   (src/10d-ui-store.js), and listed in the Friends window.
   ============================================================ */
'use strict';
(function (MTG) {
  const { el } = MTG;
  const UI = MTG.ui;
  const T = MTG.trade;
  const E = () => MTG.economy;
  const RAR = ['mythic', 'rare', 'uncommon', 'common', ''];
  const RAR_LETTER = { common: 'C', uncommon: 'U', rare: 'R', mythic: 'M' };
  const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6-4.4-4.2 6-.8z" fill="currentColor"/></svg>';
  const STAR_O = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.2l2.6 5.5 6 .8-4.4 4.2 1.1 6-5.3-2.9-5.3 2.9 1.1-6-4.4-4.2 6-.8z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>';
  const fmtN = (n) => Number(n || 0).toLocaleString();

  /* ---------------- a card, looked up to be looked at ---------------- */
  /* A friend says which printing a card is; it is believed only if that
     printing is the card named. */
  const front = (n) => String(n || '').split(' // ')[0];
  const sameCard = (c, name) => !!c && (c.name === name || front(c.name) === front(name));
  const cards = new Map();      // name -> Promise of a Scryfall card (or null)
  function cardFor(name, id) {
    if (!cards.has(name)) {
      const p = (id ? MTG.scry.byId(id, { low: true, quiet: true }) : Promise.resolve(null))
        .then(c => (sameCard(c, name) ? c : MTG.scry.byName(name)))
        .then(c => (sameCard(c, name) ? c : null))
        .catch(() => null);
      cards.set(name, p);
    }
    return cards.get(name);
  }
  /** Many cards at once ([{ name, id }]), in one request, before their thumbnails ask one at a time. */
  function prime(list) {
    const todo = list.filter(x => !cards.has(x.name));
    if (!todo.length) return;
    const batch = MTG.scry.collection(todo.map(x => (x.id ? { id: x.id } : { name: x.name })))
      .then(r => (r && r.cards) || []).catch(() => []);
    todo.forEach((x, i) => cards.set(x.name, batch.then(cs => (sameCard(cs[i], x.name) ? cs[i] : null))));
  }
  async function look(name, id) {
    let c = await cardFor(name, id);
    if (!c) { try { c = await MTG.scry.byName(name); } catch (e) { c = null; } if (!sameCard(c, name)) c = null; }
    if (c) UI.cardSheet(c);
    else UI.error(`${name} could not be looked up just now.`);
  }
  /** A small piece of a card's art, filled in once it has been looked up. */
  function thumb(name, id) {
    const t = el('span', { class: 'tr-thumb', 'aria-hidden': 'true' });
    cardFor(name, id).then((c) => { if (c) UI.setArt(t, c); });
    return t;
  }
  const cardButton = (name, id) => el('button', { type: 'button', class: 'tr-card', text: name, title: 'Look at ' + name, onclick: () => look(name, id) });

  /* ---------------- the wishlist: a button and a mark ---------------- */
  const isToken = (c) => /token|emblem|art_series/.test(String(c.layout || '')) || /\bToken\b|\bEmblem\b/.test(String(c.type_line || ''));
  /** Want / Wanted, for a card; null for a card nobody collects (a basic land, a token). */
  UI.wishButton = function (card, opts) {
    opts = opts || {};
    if (!card || !card.name || isToken(card) || (E() && E().isBasic(card.name))) return null;
    const b = el('button', { type: 'button', class: 'btn ' + (opts.size || 'sm') + ' wish-btn' });
    const draw = () => {
      const on = T.wish.has(card.name);
      b.classList.toggle('on', on);
      b.setAttribute('aria-pressed', on ? 'true' : 'false');
      b.innerHTML = `${on ? STAR : STAR_O}<span>${on ? 'Wanted' : 'Want'}</span>`;
      b.title = on ? 'On your wishlist: click to take it off' : 'Put it on your wishlist, for trading with friends';
    };
    b.addEventListener('click', (e) => {
      // the card sheet closes on any click; this one is not for it
      e.stopPropagation();
      const on = T.wish.toggle(card);
      draw();
      MTG.sfx(on ? 'confirm' : 'click');
      UI.toast(on ? `${card.name} is on your wishlist.` : `${card.name} is off your wishlist.`, on ? 'ok' : '', 2400);
    });
    draw();
    return b;
  };
  /** A star on a card you want (the Collection's tiles); null on one you do not. */
  UI.wishMark = function (name) {
    return T.wish.has(name) ? el('span', { class: 'wish-mark', title: 'On your wishlist', 'aria-label': 'On your wishlist', html: STAR }) : null;
  };
  // the Collection's stars follow the wishlist without drawing the whole grid again
  MTG.bus.on('wishlist:changed', () => {
    for (const t of document.querySelectorAll('#screen-collection .col-card')) {
      const name = t.getAttribute('title');
      const have = t.querySelector('.wish-mark');
      const want = T.wish.has(name);
      if (want && !have) t.appendChild(UI.wishMark(name));
      else if (!want && have) have.remove();
    }
  });

  /* ---------------- the Friends window's Wishlist tab ---------------- */
  UI.wishlistTab = function (body) {
    const list = el('div', { class: 'wl-list' });
    body.append(
      el('p', { class: 'small muted fr-intro', text: 'The cards you want. Mark one with Want on its full view (press and hold a card, or open it in your Collection). When you trade, these are picked out in your friend’s cards.' }),
      list,
    );
    const refresh = () => {
      list.innerHTML = '';
      const wants = T.wish.list().sort((a, b) => a.name.localeCompare(b.name));
      prime(wants);
      if (!wants.length) {
        list.appendChild(el('div', { class: 'fr-empty' }, [el('b', { text: 'Nothing on your wishlist yet.' }),
          el('span', { text: 'Find a card in your Collection, or anywhere you can see it whole, and press Want.' })]));
        return;
      }
      for (const w of wants) {
        const have = Math.min(4, E().owned(w.name) || 0);
        list.appendChild(el('div', { class: 'wl-row' }, [
          thumb(w.name, w.id),
          el('div', { class: 'wl-who' }, [
            cardButton(w.name, w.id),
            el('div', { class: 'wl-meta', text: [w.r ? w.r[0].toUpperCase() + w.r.slice(1) : '', w.s ? w.s.toUpperCase() : '', have ? `you have ${have}` : 'you have none'].filter(Boolean).join(' · ') }),
          ]),
          el('button', { type: 'button', class: 'btn sm ghost', text: 'Remove', onclick: () => T.wish.remove(w.name) }),
        ]));
      }
    };
    refresh();
    return { refresh };
  };

  /* ---------------- the Friends window's Trades tab: the history ---------------- */
  const listOf = (items) => (items && items.length ? items.map(c => `${c.n} × ${c.name}`).join(', ') : 'nothing');
  UI.tradesTab = function (body) {
    const list = el('div', { class: 'th-list' });
    body.append(el('p', { class: 'small muted fr-intro', text: 'Trades with your friends. To start one, press Trade beside a friend who is online.' }), list);
    const refresh = () => {
      list.innerHTML = '';
      const pend = T.pending();
      const log = T.log();
      const live = T.current();
      if (live && (live.state === 'open' || live.state === 'asking' || live.state === 'committing')) {
        list.appendChild(el('div', { class: 'th-row live' }, [
          el('div', { class: 'th-text' }, [el('b', { text: `Trading with ${live.name} now` }), el('span', { class: 'dim', text: live.state === 'asking' ? 'Waiting for them to say yes.' : 'The window is where you left it.' })]),
          el('button', { type: 'button', class: 'btn sm primary', text: 'Open', onclick: () => UI.openTrade(live) }),
        ]));
      }
      for (const p of pend) {
        if (live && live.id === p.id && live.state !== 'closed') continue;
        list.appendChild(el('div', { class: 'th-row pending' }, [
          el('div', { class: 'th-text' }, [
            el('b', { text: `Waiting to finish with ${p.name || 'a friend'}` }),
            el('span', { text: `You give ${listOf(p.give)}; you get ${listOf(p.get)}.` }),
            el('span', { class: 'dim', text: 'It settles by itself when you are both online: either it goes through on both sides or on neither.' }),
          ]),
        ]));
      }
      for (const l of log) {
        list.appendChild(el('div', { class: 'th-row ' + (l.state === 'done' ? 'done' : 'failed') }, [
          el('div', { class: 'th-text' }, [
            el('b', { text: `${l.state === 'done' ? 'Traded with' : 'Did not go through with'} ${l.name || 'a friend'}` }),
            l.state === 'done' ? el('span', { text: `You gave ${listOf(l.gave)}; you got ${listOf(l.got)}.` }) : el('span', { text: l.why || '' }),
            l.shards ? el('span', { class: 'dim', text: `Copies past four turned into ${fmtN(l.shards)} Shards.` }) : null,
          ].filter(Boolean)),
          el('span', { class: 'th-date', text: new Date(l.at || Date.now()).toLocaleDateString() }),
        ]));
      }
      if (!list.children.length) list.appendChild(el('div', { class: 'fr-empty' }, [el('b', { text: 'No trades yet.' }), el('span', { text: 'Your friend sees your cards and you see theirs; each of you picks what to give and what to ask for, and both confirm.' })]));
    };
    refresh();
    return { refresh };
  };

  /* ============================================================
     The trade window
     ============================================================ */
  let tw = null;
  UI.tradeWindowFor = (s) => (tw && tw.s === s ? tw : null);
  UI.openTrade = function (s) {
    if (tw && tw.s === s) return tw.m;
    if (tw) tw.m.close();
    const status = el('div', { class: 'tr-status', 'aria-live': 'polite' });
    const deal = el('div', { class: 'tr-deal' });
    const binders = el('div', { class: 'tr-binders' });
    const m = UI.modal({ title: `Trade with ${s.name}`, className: 'trade-modal', width: 'min(1000px, 98vw)',
      content: el('div', { class: 'tr-wrap' }, [status, deal, binders]) });
    const leave = m.button('Close', () => close(), 'ghost');
    const confirm = m.button('Confirm trade', () => doConfirm(), 'primary');
    const w = tw = { s, m, view: { tab: 'theirs', q: '', wanted: false, shown: 120 } };
    function close() {
      if (T.current() === s && (s.state === 'open' || s.state === 'asking' || s.state === 'asked')) T.cancel(s);
      m.close();
    }
    const offs = [T.on('update', (x) => { if (x === s) soon(); }), MTG.bus.on('wishlist:changed', () => soon())];
    /* Putting the window away (its cross, Escape) leaves the trade open, to
       go and look at your decks, say; it is there again under Trade beside
       the friend. Only Cancel trade ends it. */
    m._onClose = () => {
      offs.forEach(f => f());
      if (tw === w) tw = null;
    };
    let queued = false;
    function soon() { if (queued) return; queued = true; requestAnimationFrame(() => { queued = false; draw(); }); }

    function draw() {
      const st = s.state;
      const mine = T.iConfirmed(s), theirs = T.theyConfirmed(s);
      const finishing = st === 'committing' || (st === 'open' && mine && theirs);
      status.className = 'tr-status st-' + st + (finishing ? ' finishing' : '');
      status.textContent =
        st === 'asking' ? `Waiting for ${s.name} to say yes…`
          : st === 'closed' ? (s.why || 'The trade is closed.')
            : st === 'done' ? 'Done. The cards have changed hands.'
              : finishing ? 'Both confirmed. Finishing the trade…'
                : mine ? `You confirmed. Waiting for ${s.name}…`
                  : theirs ? `${s.name} confirmed this deal. Confirm it too, or change it.`
                    : 'Pick what you give and what you would like from each other’s cards. Any change unconfirms you both.';
      // a card in the deal that is no longer there to give: said, since it is why Confirm will not go
      const bad = st === 'open' && !finishing && (s.L.size || s.F.size) ? T.problems(s) : '';
      if (bad) { status.textContent = bad + ' Take it out, or put in fewer.'; status.classList.add('warn'); }
      const editable = st === 'open' && !finishing;
      drawDeal(editable);
      if (st === 'open' || st === 'committing') drawBinders(editable);
      else binders.innerHTML = '';
      binders.hidden = !(st === 'open' || st === 'committing');
      confirm.hidden = !(st === 'open');
      confirm.disabled = finishing || !!T.problems(s);
      confirm.textContent = mine ? 'Change my mind' : 'Confirm trade';
      confirm.className = 'btn ' + (mine ? '' : 'primary');
      // closing while it finishes leaves it to finish: the journal sees it through
      leave.textContent = st === 'open' || st === 'asking' ? 'Cancel trade' : 'Close';
    }

    function drawDeal(editable) {
      deal.innerHTML = '';
      if (s.state === 'asking' || (s.state === 'closed' && !s.L.size && !s.F.size)) { deal.hidden = true; return; }
      deal.hidden = false;
      const done = s.state === 'done' && s.result;
      const give = done ? new Map(s.result.gave.map(c => [c.name, c.n])) : T.give(s);
      const get = done ? new Map(s.result.got.map(c => [c.name, c.n])) : T.get(s);
      const warn = new Map(T.deckWarnings(s).map(x => [x.name, x]));
      prime([...give.keys()].map(n => ({ name: n, id: (s.mine.get(n) || {}).id })).concat([...get.keys()].map(n => ({ name: n, id: (s.theirs.get(n) || {}).id }))));
      const half = (title, map, side, from, cls) => {
        const total = [...map.values()].reduce((a, n) => a + n, 0);
        const rows = [...map].sort((a, b) => a[0].localeCompare(b[0])).map(([name, n]) => {
          const c = from.get(name) || {};
          const w = side === 'give' ? warn.get(name) : null;
          return el('div', { class: 'tr-line' + (w ? ' warn' : '') }, [
            thumb(name, c.id),
            el('div', { class: 'tr-line-main' }, [
              cardButton(name, c.id),
              w ? el('div', { class: 'tr-warn', text: `${w.decks.map(d => d.name).join(', ')} ${w.decks.length === 1 ? 'uses' : 'use'} ${w.keep}; you would keep ${w.left}.` }) : null,
            ].filter(Boolean)),
            el('span', { class: 'tr-x', text: '×' + n }),
            editable ? el('div', { class: 'tr-step' }, [
              el('button', { type: 'button', class: 'btn xs', text: '−', 'aria-label': `One fewer ${name}`, onclick: () => T.setCount(s, side, name, n - 1) }),
              el('button', { type: 'button', class: 'btn xs', text: '+', 'aria-label': `One more ${name}`, disabled: !(c.n > n), onclick: () => T.setCount(s, side, name, n + 1) }),
            ]) : null,
          ].filter(Boolean));
        });
        return el('section', { class: 'tr-half ' + cls }, [
          el('div', { class: 'tr-half-head' }, [
            el('h3', { text: title }),
            el('span', { class: 'tr-total', text: total ? `${total} card${total === 1 ? '' : 's'}` : '' }),
          ]),
          rows.length ? el('div', { class: 'tr-lines' }, rows) : el('div', { class: 'tr-none', text: side === 'give' ? 'Nothing yet. Add from your cards below.' : 'Nothing yet. Add from their cards below.' }),
        ]);
      };
      const mine = T.iConfirmed(s), theirs = T.theyConfirmed(s);
      const tick = (on, label) => el('span', { class: 'tr-ok' + (on ? ' on' : ''), text: (on ? '✓ ' : '') + label + (on ? ' confirmed' : ' not yet') });
      deal.append(half('You give', give, 'give', s.mine, 'give'), half('You get', get, 'get', s.theirs, 'get'));
      if (s.state === 'open') deal.appendChild(el('div', { class: 'tr-oks' }, [tick(mine, 'You'), tick(theirs, s.name)]));
      if (done && s.result.shards) deal.appendChild(el('p', { class: 'small muted tr-shards', text: `Copies past four turned into ${fmtN(s.result.shards)} Shards.` }));
    }

    function drawBinders(editable) {
      const v = w.view;
      const keepFocus = document.activeElement && document.activeElement.classList.contains('tr-search');
      const caret = keepFocus ? document.activeElement.selectionStart : null;
      // the deal changes under you as you pick: the list stays where you had scrolled it
      const was = binders.querySelector('.tr-list');
      const keepTop = was && !v.fresh ? was.scrollTop : 0;
      v.fresh = false;
      binders.innerHTML = '';
      const wants = T.wish.names();
      const theirsList = [...s.theirs.values()];
      const mineList = [...s.mine.values()];
      const wantedTheirs = theirsList.filter(c => wants.has(c.name)).length;
      const wantedMine = mineList.filter(c => s.theirWants.has(c.name)).length;
      const tabs = el('div', { class: 'seg tr-tabs', role: 'tablist' }, [
        ['theirs', `${s.name}’s cards`, theirsList.length, wantedTheirs],
        ['mine', 'Your cards', mineList.length, wantedMine],
      ].map(([id, label, n, wn]) => el('button', { type: 'button', role: 'tab', class: 'seg-btn' + (v.tab === id ? ' on' : ''), 'aria-selected': v.tab === id ? 'true' : 'false',
        onclick: () => { v.tab = id; v.shown = 120; v.fresh = true; draw(); } }, [
        el('span', { text: label }), el('span', { class: 'tr-tab-n', text: ` ${fmtN(n)}` }),
        wn ? el('span', { class: 'tr-tab-w', title: id === 'theirs' ? 'Cards you want' : 'Cards they want', html: `${STAR}${wn}` }) : null,
      ].filter(Boolean))));
      const search = el('input', { type: 'search', class: 'tr-search', placeholder: 'Find a card…', value: v.q, 'aria-label': 'Find a card' });
      search.addEventListener('input', () => { v.q = search.value; v.shown = 120; drawList(); });
      const only = el('label', { class: 'tr-only' }, [
        el('input', { type: 'checkbox', checked: v.wanted }),
        el('span', { text: v.tab === 'theirs' ? 'Only cards I want' : 'Only cards they want' }),
      ]);
      only.firstChild.addEventListener('change', () => { v.wanted = only.firstChild.checked; v.shown = 120; drawList(); });
      const list = el('div', { class: 'tr-list', role: 'list' });
      binders.append(el('div', { class: 'tr-bar' }, [tabs, search, only]), list);
      if (keepFocus) { search.focus(); try { search.setSelectionRange(caret, caret); } catch (e) {} }

      function drawList() {
        list.innerHTML = '';
        const theirs = v.tab === 'theirs';
        const src = theirs ? theirsList : mineList;
        const marked = theirs ? wants : s.theirWants;
        const inDeal = theirs ? T.get(s) : T.give(s);
        const q = v.q.trim().toLowerCase();
        if (!src.length) {
          list.appendChild(el('div', { class: 'tr-none', text: theirs ? (s.state === 'open' ? `Waiting for ${s.name}’s cards…` : '') : 'Gathering your cards…' }));
          return;
        }
        const rows = src.filter(c => (!q || c.name.toLowerCase().includes(q)) && (!v.wanted || marked.has(c.name)))
          .sort((a, b) => (marked.has(b.name) - marked.has(a.name)) || (RAR.indexOf(a.r) - RAR.indexOf(b.r)) || a.name.localeCompare(b.name));
        if (!rows.length) { list.appendChild(el('div', { class: 'tr-none', text: v.wanted ? (theirs ? 'None of the cards you want.' : 'None of the cards they want.') : 'No card by that name.' })); return; }
        for (const c of rows.slice(0, v.shown)) {
          const n = inDeal.get(c.name) || 0;
          const want = marked.has(c.name);
          const kept = !theirs && c.keep ? c.keep : 0;
          list.appendChild(el('div', { class: 'tr-row' + (want ? ' wanted' : '') + (n ? ' picked' : ''), role: 'listitem' }, [
            el('span', { class: 'tr-rar r-' + (c.r || 'x'), title: c.r || '', text: RAR_LETTER[c.r] || '·' }),
            el('div', { class: 'tr-row-main' }, [
              cardButton(c.name, c.id),
              el('div', { class: 'tr-row-meta' }, [
                c.s ? el('span', { text: c.s.toUpperCase() }) : null,
                el('span', { text: theirs ? `they have ${c.n}` : `${c.n} to trade` }),
                kept ? el('span', { class: 'tr-deck', text: `decks use ${kept}`, title: (c.decks || []).map(d => `${d.name}: ${d.n}`).join(', ') }) : null,
                want ? el('span', { class: 'tr-want', html: `${STAR}<span>${theirs ? 'you want it' : 'they want it'}</span>` }) : null,
              ].filter(Boolean)),
            ]),
            n ? el('span', { class: 'tr-in', text: `${n} in` }) : null,
            editable ? el('button', { type: 'button', class: 'btn xs tr-add', text: '+', disabled: n >= c.n,
              'aria-label': theirs ? `Ask for a ${c.name}` : `Offer a ${c.name}`, title: theirs ? 'Ask for one' : 'Offer one',
              onclick: () => T.setCount(s, theirs ? 'get' : 'give', c.name, n + 1) }) : null,
          ].filter(Boolean)));
        }
        if (rows.length > v.shown) list.appendChild(el('button', { type: 'button', class: 'btn sm ghost tr-more', text: `Show more (${rows.length - v.shown})`, onclick: () => { v.shown += 200; drawList(); } }));
      }
      drawList();
      if (keepTop) list.scrollTop = keepTop;
    }

    async function doConfirm() {
      if (T.iConfirmed(s)) { T.unconfirm(s); return; }
      const warn = T.deckWarnings(s);
      if (warn.length && !await deckCheck(warn)) return;
      const bad = T.confirm(s);
      if (bad) { MTG.sfx('reject'); UI.error(bad); }
      else MTG.sfx('confirm');
    }
    draw();
    return m;
  };

  /** Trading away cards a saved deck uses: said plainly, and asked. Resolves yes or no. */
  function deckCheck(warn) {
    return new Promise((res) => {
      let done = false;
      const settle = (v) => { if (!done) { done = true; res(v); } };
      const m = UI.modal({
        title: 'Cards your decks use', width: 'min(520px, 96vw)',
        content: el('div', null, [
          el('p', { style: { marginTop: 0 }, text: 'Some of what you give is in your saved decks. After the trade they would be short, unless you build the cards again.' }),
          el('ul', { class: 'tr-warn-list' }, warn.map(w => el('li', null, [
            el('b', { text: w.name }),
            el('span', { text: `: ${w.decks.map(d => `${d.name} (${d.n})`).join(', ')}. You have ${w.owned}, give ${w.n}, keep ${w.left}.` }),
          ]))),
        ]),
        buttons: [
          { label: 'Keep them', onClick: () => { settle(false); m.close(); } },
          { label: 'Trade anyway', class: 'primary', onClick: () => { settle(true); m.close(); } },
        ],
      });
      m._onClose = () => settle(false);
    });
  }
})(window.MTG);
