'use strict';
/* ============================================================
   10d-ui-store.js - the Store, the Collection and opening packs

   The screens for what src/10c-economy.js keeps: a Store laid out like
   MTG Arena's (a featured set, every set's boosters, today's deals), the
   Collection (every card you own, or a set's cards with the ones you lack
   greyed out, and wildcards to craft them), and the pack opening: the pack
   torn open, the cards dealt face down, the commons turned over by
   themselves and the rares left glowing for you to turn.
   ============================================================ */
(function (MTG) {
  const { el, util: U } = MTG;
  const UI = MTG.ui;
  const E = () => MTG.economy;
  const RAR = ['common', 'uncommon', 'rare', 'mythic'];
  const RAR_NAME = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', mythic: 'Mythic' };
  const fmtN = (n) => Number(n || 0).toLocaleString();

  /** The Shard: a little faceted crystal. */
  /* (each one its own gradient: one shared by id stops drawing when the
     copy that defines it is hidden) */
  let shardSeq = 0;
  const shardSvg = () => {
    const id = 'shg' + (++shardSeq);
    return `<svg class="shard-ico" viewBox="0 0 24 24" aria-hidden="true"><defs><linearGradient id="${id}" x1="0" y1="0" x2="1" y2="1">` +
      '<stop offset="0" stop-color="#c8a6ff"/><stop offset=".55" stop-color="#7d4ae0"/><stop offset="1" stop-color="#3d1f8a"/></linearGradient></defs>' +
      `<path d="M12 2l6.5 6.2L12 22 5.5 8.2z" fill="url(#${id})"/>` +
      '<path d="M12 2l6.5 6.2H5.5z" fill="#fff" opacity=".35"/><path d="M12 8.2V22L5.5 8.2z" fill="#000" opacity=".18"/></svg>';
  };
  UI.shardIcon = shardSvg;
  const shards = (n, cls) => el('span', { class: 'shards' + (cls ? ' ' + cls : ''), html: shardSvg() + `<b>${fmtN(n)}</b>` });
  /** A wildcard's face, coloured by rarity. */
  const wcIcon = (r, n) => el('span', { class: 'wc-ico wc-' + r, title: `${RAR_NAME[r]} wildcards`, html: `<i></i>${n != null ? `<b>${fmtN(n)}</b>` : ''}` });

  /* ---------------- the balance in the top bar ---------------- */
  /**
   * The Shards you have, always in view: it counts up when Shards come in,
   * with their sound, and takes you to the Store.
   */
  UI.shardChip = function (onClick) {
    const val = el('b', { text: fmtN(E().shards()) });
    const chip = el('button', { type: 'button', class: 'shard-chip', title: 'Shards: spend them in the Store', 'aria-label': 'Shards', onclick: onClick }, [
      el('span', { html: shardSvg() }), val,
    ]);
    let shown = E().shards(), anim = null;
    MTG.bus.on('economy:changed', (ev) => {
      const to = ev.shards;
      if (anim) cancelAnimationFrame(anim);
      if (ev.delta > 0) {
        chip.classList.remove('gain'); void chip.offsetWidth; chip.classList.add('gain');
        if (ev.why !== 'open' && ev.why !== 'cards') MTG.sfx('shards', { intensity: Math.min(1, ev.delta / 1000) });
        const from = shown, t0 = performance.now(), dur = 900;
        const step = (t) => {
          const k = Math.min(1, (t - t0) / dur);
          shown = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
          val.textContent = fmtN(shown);
          if (k < 1) anim = requestAnimationFrame(step);
        };
        anim = requestAnimationFrame(step);
      } else { shown = to; val.textContent = fmtN(to); }
    });
    return chip;
  };

  /* ---------------- set art, for packs ---------------- */
  const ART_KEY = 'packart';
  const artCache = MTG.store.get(ART_KEY, {}) || {};
  const artWaiting = new Map();
  /** A striking card from a set, for the front of its packs: its best-known mythic or rare. */
  function setArt(code) {
    if (artCache[code]) return Promise.resolve(artCache[code]);
    if (artWaiting.has(code)) return artWaiting.get(code);
    const p = (async () => {
      let found = [];
      try { found = await MTG.scry.search(`set:${code} (r:mythic or r:rare) -t:land`, { max: 6, order: 'edhrec', unique: 'cards' }); } catch (e) { found = []; }
      const c = found.find(x => MTG.scry.imageUrl(x, 'art_crop', 0)) || null;
      const art = c ? { url: MTG.scry.imageUrl(c, 'art_crop', 0), name: c.name } : null;
      if (art) { artCache[code] = art; MTG.store.set(ART_KEY, artCache); }
      return art;
    })();
    artWaiting.set(code, p);
    return p;
  }

  /** A booster, drawn: the art, the set's symbol and name, the crimped foil. */
  function boosterEl(setInfo, kind, opts) {
    opts = opts || {};
    const art = el('div', { class: 'bp-art' });
    const node = el('div', { class: 'booster' + (kind === 'collector' ? ' collector' : '') + (opts.big ? ' big' : '') }, [
      art,
      el('div', { class: 'bp-foil' }),
      el('div', { class: 'bp-crimp top' }), el('div', { class: 'bp-crimp bottom' }),
      el('div', { class: 'bp-label' }, [
        setInfo && setInfo.icon_svg_uri ? el('img', { class: 'bp-icon', src: setInfo.icon_svg_uri, alt: '' }) : null,
        el('div', { class: 'bp-name', text: setInfo ? (setInfo.name || String(setInfo.code || '').toUpperCase()) : 'Booster' }),
        el('div', { class: 'bp-kind', text: kind === 'collector' ? 'Collector Booster' : 'Play Booster' }),
      ].filter(Boolean)),
    ]);
    if (setInfo && setInfo.code) setArt(setInfo.code).then(a => { if (a) art.style.backgroundImage = 'url("' + a.url.replace(/"/g, '%22') + '")'; });
    return node;
  }

  /* ---------------- the Store ---------------- */
  let storeTab = 'featured';
  /**
   * The Store screen into `host`. `opts.onOpenPacks` goes to the pack
   * opening; the screen redraws itself when the balance changes.
   */
  UI.renderStore = async function (host, opts) {
    opts = opts || {};
    const S = E();
    host.innerHTML = '';
    const head = el('div', { class: 'store-head' }, [
      el('div', { class: 'store-title' }, [el('h1', { text: 'Store' }), el('p', { class: 'dim', text: 'Spend Shards on boosters and cards. You earn Shards by playing: ' +
        `${S.REWARD.play} a game, ${S.REWARD.win} more for a win, and ${S.REWARD.firstWin} for your first win each day.` })]),
      el('div', { class: 'store-wallet' }, [
        shards(S.shards(), 'big'),
        el('div', { class: 'wc-row' }, RAR.map(r => wcIcon(r, S.wildcards()[r]))),
        openPacksButton(opts.onOpenPacks),
      ]),
    ]);
    const tabs = el('div', { class: 'store-tabs', role: 'tablist' });
    const body = el('div', { class: 'store-body' });
    const TABS = [['featured', 'Featured'], ['packs', 'Packs'], ['deals', 'Daily deals']];
    const show = (id) => {
      storeTab = id;
      for (const b of tabs.children) b.setAttribute('aria-selected', b.dataset.tab === id ? 'true' : 'false');
      body.innerHTML = '';
      if (id === 'featured') featured(body, opts);
      else if (id === 'packs') packsTab(body, opts);
      else deals(body);
    };
    for (const [id, label] of TABS) tabs.appendChild(el('button', { type: 'button', role: 'tab', class: 'store-tab', dataset: { tab: id }, text: label, onclick: () => { MTG.sfx('click'); show(id); } }));
    host.append(el('div', { class: 'store' }, [head, tabs, body]));
    show(storeTab);
    if (S.isWelcome) welcome(opts);
    // the wallet follows the balance while this screen is up
    const off = MTG.bus.on('economy:changed', () => {
      if (!host.isConnected) { if (off) off(); return; }
      const w = host.querySelector('.store-wallet');
      if (w) w.replaceWith(el('div', { class: 'store-wallet' }, [shards(S.shards(), 'big'),
        el('div', { class: 'wc-row' }, RAR.map(r => wcIcon(r, S.wildcards()[r]))), openPacksButton(opts.onOpenPacks)]));
    });
  };

  function openPacksButton(onOpen) {
    const n = E().packs().length;
    return el('button', { type: 'button', class: 'btn' + (n ? ' primary glow-btn' : ''), disabled: !n,
      text: n ? `Open packs (${n})` : 'No packs to open', onclick: () => onOpen && onOpen() });
  }

  function welcome(opts) {
    const S = E();
    const m = UI.modal({
      title: 'Welcome to the Store',
      content: el('div', { class: 'welcome-gift' }, [
        el('p', { text: 'To get you started, you have:' }),
        el('ul', {}, [
          el('li', {}, [shards(S.START.shards), document.createTextNode(' Shards')]),
          el('li', { text: `${S.START.packs} booster packs of the newest sets` }),
          el('li', {}, [document.createTextNode('Wildcards: '), ...RAR.map(r => wcIcon(r, S.START.wildcards[r]))]),
          el('li', { text: 'Every card in the starter decks, in your collection' }),
        ]),
        el('p', { class: 'dim', text: 'Decks are built from the cards you own; a wildcard crafts a card you are missing. You can turn that off in Options.' }),
      ]),
      buttons: [
        { label: 'Later', onClick: (mm) => { S.welcomed(); mm.close(); } },
        { label: 'Open my packs', class: 'primary', onClick: (mm) => { S.welcomed(); mm.close(); if (opts.onOpenPacks) opts.onOpenPacks(); } },
      ],
    });
    return m;
  }

  async function featured(body, opts) {
    const sets = await MTG.scry.draftableSets().catch(() => []);
    if (!sets.length) { body.appendChild(el('p', { class: 'dim', text: 'The sets could not be loaded. Check the connection, or download the card database in Options.' })); return; }
    const s = sets[0];
    const hero = el('section', { class: 'store-hero' });
    const bg = el('div', { class: 'hero-art' });
    setArt(s.code).then(a => { if (a) bg.style.backgroundImage = 'url("' + a.url.replace(/"/g, '%22') + '")'; });
    hero.append(bg, el('div', { class: 'hero-shade' }), el('div', { class: 'hero-in' }, [
      boosterEl(s, 'play', { big: true }),
      el('div', { class: 'hero-copy' }, [
        el('div', { class: 'eyebrow', text: 'New set' }),
        el('h2', { text: s.name }),
        el('p', { class: 'dim', text: `Released ${s.released_at}. Play Boosters: fourteen cards, a rare or mythic in every pack, and a foil.` }),
        el('div', { class: 'hero-buy' }, [
          buyBtn(s, 'play', 1), buyBtn(s, 'play', 10), buyBtn(s, 'collector', 1),
        ]),
      ]),
    ]));
    body.appendChild(hero);
    // bundles: packs of the last few sets together
    const bundles = el('div', { class: 'store-grid bundles' });
    const offers = [
      { title: 'Starter bundle', sub: `5 packs of ${s.name}, and a rare wildcard`, cost: 5000, give: () => { E().buyPacks(s, 'play', 5); } , wc: 'rare' },
      { title: 'Collector’s trio', sub: `3 Collector Boosters of ${s.name}`, cost: 7500, give: () => { E().buyPacks(s, 'collector', 3); } },
    ];
    if (sets[1]) offers.push({ title: 'Catch-up bundle', sub: `6 packs of ${sets[1].name}`, cost: 6000, give: () => { E().buyPacks(sets[1], 'play', 6); } });
    for (const o of offers) {
      bundles.appendChild(el('div', { class: 'store-card bundle' }, [
        el('div', { class: 'sc-title', text: o.title }),
        el('div', { class: 'sc-sub dim', text: o.sub }),
        el('button', { type: 'button', class: 'btn primary buy', html: shardSvg() + ' ' + fmtN(o.cost), onclick: async () => {
          if (E().shards() < o.cost) return notEnough(o.cost);
          if (!await UI.confirm(`Buy the ${o.title} for ${fmtN(o.cost)} Shards?`, 'Store')) return;
          // the bundle's price, not the packs' own: Shards in for the difference, then the packs bought
          const packsCost = o.title.startsWith('Collector') ? E().PRICES.collector * 3 : E().PRICES.pack * (o.title.startsWith('Catch') ? 6 : 5);
          E().addShards(packsCost - o.cost, 'bundle');
          o.give();
          if (o.wc) { E().state.wc[o.wc]++; E().save(); }
          bought(o.title);
          if (opts.onChange) opts.onChange();
        } }),
      ]));
    }
    body.appendChild(el('h3', { class: 'store-h', text: 'Bundles' }));
    body.appendChild(bundles);
    body.appendChild(el('h3', { class: 'store-h', text: 'Recent sets' }));
    const grid = el('div', { class: 'store-grid packs' });
    for (const st of sets.slice(1, 7)) grid.appendChild(packTile(st));
    body.appendChild(grid);
  }

  function notEnough(cost) {
    MTG.sfx('reject');
    UI.error(`That costs ${fmtN(cost)} Shards; you have ${fmtN(E().shards())}. Play some games to earn more.`);
  }
  function bought(what) {
    MTG.sfx('purchase');
    UI.ok(`Bought: ${what}.`);
  }
  function buyBtn(s, kind, qty) {
    const each = kind === 'collector' ? E().PRICES.collector : E().PRICES.pack;
    const label = (kind === 'collector' ? 'Collector' : qty === 1 ? '1 pack' : `${qty} packs`);
    return el('button', { type: 'button', class: 'btn buy' + (kind === 'play' && qty === 1 ? ' primary' : ''), onclick: () => buy(s, kind, qty) }, [
      el('span', { text: label }), el('span', { class: 'buy-price', html: shardSvg() + fmtN(each * qty) }),
    ]);
  }
  async function buy(s, kind, qty) {
    const each = kind === 'collector' ? E().PRICES.collector : E().PRICES.pack;
    if (E().shards() < each * qty) return notEnough(each * qty);
    const r = E().buyPacks(s, kind, qty);
    if (!r.ok) return UI.error(r.why);
    bought(`${qty} ${kind === 'collector' ? 'Collector Booster' : 'pack'}${qty > 1 ? 's' : ''} of ${s.name}`);
  }

  function packTile(s) {
    return el('div', { class: 'store-card pack-tile' }, [
      boosterEl(s, 'play'),
      el('div', { class: 'sc-title', text: s.name }),
      el('div', { class: 'pack-buys' }, [buyBtn(s, 'play', 1), buyBtn(s, 'play', 10), buyBtn(s, 'collector', 1)]),
    ]);
  }

  async function packsTab(body) {
    const sets = await MTG.scry.draftableSets().catch(() => []);
    if (!sets.length) { body.appendChild(el('p', { class: 'dim', text: 'The sets could not be loaded.' })); return; }
    const search = el('input', { type: 'search', placeholder: 'Find a set…', class: 'store-search', 'aria-label': 'Find a set' });
    const grid = el('div', { class: 'store-grid packs' });
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      grid.innerHTML = '';
      for (const s of sets.filter(x => !q || x.name.toLowerCase().includes(q) || x.code === q).slice(0, 48)) grid.appendChild(packTile(s));
    };
    search.addEventListener('input', draw);
    body.append(search, grid);
    draw();
  }

  async function deals(body) {
    const wrap = el('div', { class: 'store-grid deals' }, [el('p', { class: 'dim', text: 'Finding today’s deals…' })]);
    body.append(el('p', { class: 'dim', text: 'Three cards from recent sets, new every day. A card you already have four of cannot be bought.' }), wrap);
    let items = [];
    try {
      items = await E().dailyDeals(async () => {
        const sets = (await MTG.scry.draftableSets()).slice(0, 6);
        const code = (i) => sets[i % sets.length].code;
        const pick = async (q) => { const r = await MTG.scry.search(q, { max: 40, order: 'edhrec', unique: 'cards' }); return r[Math.floor(Math.random() * Math.min(r.length, 20))]; };
        const out = [];
        for (const [q, i] of [['r:mythic', 0], ['r:rare', 1], ['r:rare', 2]]) {
          try { const c = await pick(`set:${code(i)} ${q} -t:land`); if (c) out.push(c); } catch (e) { /* skip */ }
        }
        return out;
      });
    } catch (e) { items = []; }
    wrap.innerHTML = '';
    if (!items.length) { wrap.appendChild(el('p', { class: 'dim', text: 'No deals could be found today. Check the connection.' })); return; }
    items.forEach((d, i) => {
      const card = d.card || { name: d.name, id: d.id };
      const url = MTG.scry.imageUrl(card, 'normal', 0);
      const have = E().owned(d.name);
      const tile = el('div', { class: 'store-card deal' + (d.bought ? ' sold' : '') }, [
        el('div', { class: 'deal-img', style: url ? { backgroundImage: 'url("' + url.replace(/"/g, '%22') + '")' } : null }),
        el('div', { class: 'sc-title', text: d.name }),
        el('div', { class: 'sc-sub dim', text: `${RAR_NAME[d.r] || ''} · you have ${have}` }),
        el('button', { type: 'button', class: 'btn primary buy', disabled: d.bought || have >= 4, html: d.bought ? 'Bought' : shardSvg() + ' ' + fmtN(d.price),
          onclick: () => {
            const r = E().buyDeal(i);
            if (!r.ok) return UI.error(r.why);
            bought(d.name);
            body.innerHTML = '';
            deals(body);
          } }),
      ]);
      if (card) UI.attachPreview(tile, card, 0);
      wrap.appendChild(tile);
    });
  }

  /* ---------------- opening packs ---------------- */
  /**
   * The pack opening, over everything: the pack, torn open with a click;
   * the cards dealt face down; commons and uncommons turned over in turn,
   * rares and mythics left glowing until you turn them. Then the next pack,
   * or done. `onClose` is told when it closes.
   */
  UI.openPacks = async function (onClose) {
    const S = E();
    const sets = await MTG.scry.draftableSets().catch(() => []);
    const setInfo = (code) => sets.find(s => s.code === code) || { code, name: String(code || '').toUpperCase() };
    const overlay = el('div', { class: 'pack-open', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Opening packs' });
    const stage = el('div', { class: 'po-stage' });
    const foot = el('div', { class: 'po-foot' });
    const count = el('div', { class: 'po-count' });
    const close = () => {
      document.removeEventListener('keydown', onKey);
      overlay.classList.add('closing');
      setTimeout(() => overlay.remove(), 260);
      if (onClose) onClose();
    };
    overlay.append(el('div', { class: 'po-rays' }), stage, count, foot,
      el('button', { type: 'button', class: 'btn ghost sm po-x', text: 'Close', onclick: close }));
    document.body.appendChild(overlay);
    let onKey = () => {};
    document.addEventListener('keydown', (e) => onKey(e));

    const nextPack = () => {
      const left = S.packs();
      if (!left.length) return close();
      // the welcome packs: the newest sets, named now
      const p = left[0];
      const info = p.set ? setInfo(p.set) : (sets[p.newest || 0] || sets[0]);
      stage.innerHTML = ''; foot.innerHTML = '';
      count.textContent = `${left.length} pack${left.length === 1 ? '' : 's'} to open`;
      const pack = boosterEl(info, p.kind, { big: true });
      pack.classList.add('po-pack');
      const hint = el('div', { class: 'po-hint', text: 'Click the pack to open it' });
      stage.append(pack, hint);
      MTG.sfx('pack_shake');
      let opening = false;
      const open = async () => {
        if (opening) return;
        opening = true;
        hint.remove();
        pack.classList.add('shaking');
        MTG.sfx('pack_shake');
        let res;
        try {
          [res] = await Promise.all([
            S.openPack(p.id, async () => info),
            new Promise(r => setTimeout(r, 650)),
          ]);
        } catch (e) {
          opening = false;
          pack.classList.remove('shaking');
          UI.error(e.message || String(e));
          return;
        }
        pack.classList.remove('shaking');
        pack.classList.add('torn');
        overlay.classList.add('burst');
        MTG.sfx('pack_tear');
        setTimeout(() => overlay.classList.remove('burst'), 900);
        setTimeout(() => { pack.remove(); deal(res, info); }, 520);
      };
      pack.addEventListener('click', open);
      onKey = (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); open(); } else if (e.key === 'Escape') close(); };
    };

    const deal = (res, info) => {
      const items = res.cards.concat(res.bonus.map(r => ({ wildcard: r, track: true })));
      const grid = el('div', { class: 'po-grid', style: { '--cols': String(Math.min(7, Math.ceil(items.length / 2))) } });
      stage.appendChild(grid);
      count.textContent = `${info.name || ''}${S.packs().length ? ` · ${S.packs().length} more to open` : ''}`;
      const tiles = items.map((it, i) => {
        const big = it.wildcard ? (it.wildcard === 'rare' || it.wildcard === 'mythic') : (it.rarity === 'rare' || it.rarity === 'mythic');
        const r = it.wildcard || it.rarity;
        const front = el('div', { class: 'po-front' });
        if (it.wildcard) {
          front.classList.add('wc-face', 'wc-' + it.wildcard);
          front.append(el('div', { class: 'wc-big' }), el('div', { class: 'wc-label', text: `${RAR_NAME[it.wildcard]} wildcard` }),
            it.track ? el('div', { class: 'wc-sub', text: 'Wildcard track' }) : null);
        } else {
          const url = MTG.scry.imageUrl(it.card, 'normal', 0);
          if (url) front.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
          else front.appendChild(UI.cardFallback(it.card, 0));
          if (it.foil) front.appendChild(el('div', { class: 'po-foil' }));
        }
        const tags = el('div', { class: 'po-tags' }, [
          it.isNew ? el('span', { class: 'po-new', text: 'New' }) : null,
          it.shards ? el('span', { class: 'po-dup', html: `+${shardSvg()}${fmtN(it.shards)}` }) : null,
        ].filter(Boolean));
        const t = el('button', { type: 'button', class: `po-card r-${r}${big ? ' big' : ''}`, style: { '--i': String(i) },
          'aria-label': it.wildcard ? `${RAR_NAME[it.wildcard]} wildcard` : 'A card, face down' }, [
          el('div', { class: 'po-inner' }, [el('div', { class: 'po-back' }), front]),
          tags,
        ]);
        t._item = it; t._big = big; t._flipped = false;
        t.addEventListener('click', () => flip(t));
        if (it.card) UI.attachPreview(t, it.card, 0);
        grid.appendChild(t);
        return t;
      });
      let flips = 0;
      const flip = (t) => {
        if (t._flipped) return;
        t._flipped = true;
        t.classList.add('flipped');
        t.setAttribute('aria-label', t._item.card ? t._item.card.name : `${RAR_NAME[t._item.wildcard]} wildcard`);
        const it = t._item;
        if (it.wildcard) MTG.sfx('wildcard');
        else if (it.rarity === 'mythic') { MTG.sfx('reveal_mythic'); sparkle(t, 'mythic'); }
        else if (it.rarity === 'rare') { MTG.sfx('reveal_rare'); sparkle(t, 'rare'); }
        else MTG.sfx('card_flip', { index: flips });
        flips++;
        if (it.isNew && (it.rarity === 'rare' || it.rarity === 'mythic')) setTimeout(() => MTG.sfx('new_card'), 380);
        if (it.shards) setTimeout(() => MTG.sfx('shards', { intensity: 0.2 }), 300);
        refreshFoot();
      };
      const revealAll = () => {
        tiles.filter(t => !t._flipped).forEach((t, k) => setTimeout(() => flip(t), k * 160));
      };
      const refreshFoot = () => {
        foot.innerHTML = '';
        const hidden = tiles.filter(t => !t._flipped);
        if (hidden.length) foot.appendChild(el('button', { type: 'button', class: 'btn', text: 'Reveal all', onclick: revealAll }));
        const more = S.packs().length;
        if (more) foot.appendChild(el('button', { type: 'button', class: 'btn primary', text: `Open next pack (${more})`, onclick: () => { MTG.sfx('click'); nextPack(); } }));
        foot.appendChild(el('button', { type: 'button', class: 'btn' + (more ? '' : ' primary'), text: 'Done', onclick: close }));
      };
      refreshFoot();
      // dealt in, then the small ones turned over one after another
      requestAnimationFrame(() => grid.classList.add('dealt'));
      const auto = tiles.filter(t => !t._big);
      auto.forEach((t, k) => setTimeout(() => { if (overlay.isConnected) flip(t); }, 700 + k * 130));
      const bigs = tiles.filter(t => t._big);
      if (bigs.length) setTimeout(() => { for (const t of bigs) if (!t._flipped) t.classList.add('waiting'); }, 700 + auto.length * 130);
      onKey = (e) => {
        if (e.key === 'Escape') return close();
        if (e.key !== ' ' && e.key !== 'Enter') return;
        e.preventDefault();
        const next = tiles.find(t => !t._flipped);
        if (next) flip(next);
        else if (S.packs().length) nextPack();
        else close();
      };
    };

    /** Light thrown off a rare or mythic as it turns over. */
    const sparkle = (t, kind) => {
      if (document.documentElement.dataset.reducedMotion === '1') return;
      const b = el('div', { class: 'po-burst ' + kind });
      for (let i = 0; i < 14; i++) {
        const a = (i / 14) * Math.PI * 2;
        b.appendChild(el('i', { style: { '--dx': (Math.cos(a) * (60 + Math.random() * 50)).toFixed(0) + 'px', '--dy': (Math.sin(a) * (60 + Math.random() * 50)).toFixed(0) + 'px', '--d': (Math.random() * 0.15).toFixed(2) + 's' } }));
      }
      t.appendChild(b);
      setTimeout(() => b.remove(), 1200);
      if (kind === 'mythic') { overlay.classList.remove('quake'); void overlay.offsetWidth; overlay.classList.add('quake'); }
    };

    nextPack();
  };

  /* ---------------- the Collection ---------------- */
  const colState = { set: '', rarity: '', color: '', show: 'owned', q: '' };
  /**
   * The Collection into `host`: the cards you own, or a set's cards with
   * what you lack greyed out; four pips under each for the copies held; a
   * click to look closer or craft one with a wildcard.
   */
  UI.renderCollection = async function (host) {
    const S = E();
    host.innerHTML = '';
    const col = S.collection();
    const uniq = Object.keys(col).length;
    const copies = Object.values(col).reduce((a, e) => a + (e.n || 0), 0);
    const setSel = el('select', { 'aria-label': 'Set' }, [el('option', { value: '', text: 'All my cards' })]);
    MTG.scry.draftableSets().then(sets => {
      for (const s of sets.slice(0, 80)) setSel.appendChild(el('option', { value: s.code, text: s.name, selected: s.code === colState.set }));
    }).catch(() => {});
    const search = el('input', { type: 'search', placeholder: 'Search by name…', value: colState.q, 'aria-label': 'Search the collection' });
    const chips = (list, key) => el('div', { class: 'seg mini' }, list.map(([v, label]) => el('button', { type: 'button', class: 'seg-btn' + (colState[key] === v ? ' on' : ''), text: label,
      onclick: () => { colState[key] = v; UI.renderCollection(host); } })));
    const grid = el('div', { class: 'col-grid' });
    const status = el('div', { class: 'col-status dim' });
    host.append(el('div', { class: 'collection' }, [
      el('div', { class: 'col-head' }, [
        el('div', {}, [el('h1', { text: 'Collection' }), el('p', { class: 'dim', text: `${fmtN(uniq)} different cards, ${fmtN(copies)} in all. Basic lands are free and unlimited.` })]),
        el('div', { class: 'store-wallet' }, [shards(S.shards()), el('div', { class: 'wc-row' }, RAR.map(r => wcIcon(r, S.wildcards()[r])))]),
      ]),
      el('div', { class: 'col-filters' }, [
        setSel, search,
        chips([['', 'Any rarity'], ['common', 'C'], ['uncommon', 'U'], ['rare', 'R'], ['mythic', 'M']], 'rarity'),
        chips([['', 'Any colour'], ['W', 'W'], ['U', 'U'], ['B', 'B'], ['R', 'R'], ['G', 'G'], ['M', 'Multi'], ['C', 'Colourless']], 'color'),
        colState.set ? chips([['owned', 'Owned'], ['all', 'All'], ['missing', 'Missing']], 'show') : null,
      ].filter(Boolean)),
      status, grid,
    ]));
    setSel.addEventListener('change', () => { colState.set = setSel.value; colState.show = setSel.value ? 'all' : 'owned'; UI.renderCollection(host); });
    let tm = null;
    search.addEventListener('input', () => { clearTimeout(tm); tm = setTimeout(() => { colState.q = search.value.trim(); drawGrid(); }, 200); });

    let cards = [];
    status.textContent = 'Loading…';
    if (colState.set) {
      try { const pool = await MTG.scry.setPool(colState.set); cards = (pool && pool.all) || []; } catch (e) { cards = []; }
      const seen = new Set();
      cards = cards.filter(c => !S.isBasic(c.name) && !seen.has(c.name) && seen.add(c.name));
    } else {
      // the owned cards, looked up by printing (or name), in batches
      const names = Object.keys(col).filter(n => (col[n].n || 0) > 0);
      const ids = names.map(n => col[n].id ? { id: col[n].id } : { name: n });
      try { const r = await MTG.scry.collection(ids); cards = (r.cards || []).filter(Boolean); } catch (e) { cards = []; }
    }
    const colourOf = (c) => {
      const cs = c.colors || (c.card_faces && c.card_faces[0] && c.card_faces[0].colors) || [];
      return cs.length > 1 ? 'M' : cs.length ? cs[0] : 'C';
    };
    let shown = 120;
    const drawGrid = () => {
      const q = colState.q.toLowerCase();
      let list = cards.filter(c => (!colState.rarity || S.rarityOf(c) === colState.rarity) &&
        (!colState.color || colourOf(c) === colState.color) && (!q || c.name.toLowerCase().includes(q)));
      if (colState.set && colState.show === 'owned') list = list.filter(c => S.owned(c.name) > 0);
      if (colState.set && colState.show === 'missing') list = list.filter(c => S.owned(c.name) < 4);
      list.sort((a, b) => (a.cmc || 0) - (b.cmc || 0) || a.name.localeCompare(b.name));
      if (colState.set) {
        const have = cards.filter(c => S.owned(c.name) > 0).length;
        const full = cards.filter(c => S.owned(c.name) >= 4).length;
        status.innerHTML = '';
        status.append(el('span', { text: `${have} of ${cards.length} cards owned (${Math.round(100 * have / Math.max(1, cards.length))}%), ${full} with a full playset. ` }),
          el('span', { class: 'col-bar' }, [el('i', { style: { width: (100 * have / Math.max(1, cards.length)).toFixed(1) + '%' } })]));
      } else status.textContent = list.length ? `${list.length} cards` : 'No cards match.';
      grid.innerHTML = '';
      for (const c of list.slice(0, shown)) grid.appendChild(colTile(c, host));
      if (list.length > shown) grid.appendChild(el('button', { type: 'button', class: 'btn col-more', text: `Show more (${list.length - shown})`, onclick: () => { shown += 120; drawGrid(); } }));
    };
    drawGrid();
  };

  function colTile(c, host) {
    const S = E();
    const n = Math.min(4, S.owned(c.name));
    const url = MTG.scry.imageUrl(c, 'normal', 0);
    const t = el('button', { type: 'button', class: 'col-card' + (n ? '' : ' unowned') + ' r-' + S.rarityOf(c), title: c.name }, [
      el('div', { class: 'col-img', style: url ? { backgroundImage: 'url("' + url.replace(/"/g, '%22') + '")' } : null }, url ? [] : [UI.cardFallback(c, 0)]),
      el('div', { class: 'col-pips' }, [0, 1, 2, 3].map(i => el('i', { class: i < n ? 'on' : '' }))),
    ]);
    UI.attachPreview(t, c, 0);
    t.addEventListener('click', () => cardDetail(c, () => UI.renderCollection(host)));
    return t;
  }

  /** One card, closer: how many you own, and a wildcard to craft another. */
  function cardDetail(c, after) {
    const S = E();
    const r = S.rarityOf(c);
    const have = S.owned(c.name);
    const wc = S.wildcards()[r];
    const url = MTG.scry.imageUrl(c, 'normal', 0);
    const m = UI.modal({
      title: c.name,
      content: el('div', { class: 'col-detail' }, [
        el('div', { class: 'col-detail-img', style: url ? { backgroundImage: 'url("' + url.replace(/"/g, '%22') + '")' } : null }),
        el('div', {}, [
          el('p', { text: `${RAR_NAME[r]} · you own ${Math.min(4, have)} of 4.` }),
          el('p', { class: 'dim' }, [document.createTextNode('Crafting takes one '), wcIcon(r, null), document.createTextNode(` ${r} wildcard. You have ${wc}.`)]),
        ]),
      ]),
      buttons: [
        { label: 'Close', onClick: (mm) => mm.close() },
        { label: have >= 4 ? 'You have a playset' : `Craft (${RAR_NAME[r]} wildcard)`, class: 'primary', onClick: (mm) => {
          if (have >= 4) return mm.close();
          const res = S.craft(c);
          if (!res.ok) { MTG.sfx('reject'); return UI.error(res.why); }
          MTG.sfx('wildcard');
          UI.ok(`Crafted ${c.name}.`);
          mm.close();
          if (after) after();
        } },
      ],
    });
    return m;
  }
  UI.cardCraftDetail = cardDetail;

  /* ---------------- decks and the collection ---------------- */
  /**
   * Before a deck is played: whether the collection holds it. When it does
   * not, the missing cards are listed with what the wildcards would craft,
   * and the player crafts them, turns collection rules off, or goes back.
   * Resolves true when the deck may be played.
   */
  UI.checkCollection = async function (deck) {
    const S = E();
    if (!S.rulesOn() || !deck) return true;
    let miss = S.missingFor(deck);
    if (!miss.length) return true;
    const need = S.wildcardsFor(miss);
    const have = S.wildcards();
    const enough = RAR.every(r => have[r] >= need[r]);
    const list = el('ul', { class: 'miss-list' }, miss.slice(0, 40).map(m => el('li', {}, [wcIcon(m.rarity, null), document.createTextNode(` ${m.name} — need ${m.need}, have ${m.have}`)])));
    return new Promise((resolve) => {
      const m = UI.modal({
        title: 'Cards you don’t own',
        content: el('div', {}, [
          el('p', { text: `${deck.name || 'This deck'} uses ${miss.reduce((a, m) => a + m.need - m.have, 0)} cards your collection doesn’t have.` }),
          list,
          el('p', { class: 'dim' }, [document.createTextNode('Wildcards needed: '), ...RAR.filter(r => need[r]).map(r => el('span', {}, [wcIcon(r, null), document.createTextNode(` ${need[r]} (you have ${have[r]})  `)]))]),
        ]),
        buttons: [
          { label: 'Back', onClick: (mm) => mm.close() },
          { label: 'Play anyway (turn collection rules off)', onClick: (mm) => { MTG.setSetting('useCollection', false); mm._onClose = null; mm.close(); resolve(true); } },
          { label: enough ? 'Craft them' : 'Craft what I can', class: 'primary', onClick: (mm) => {
            const left = S.craftMissing(deck);
            MTG.sfx('wildcard');
            mm._onClose = null;
            mm.close();
            if (!left.length) { UI.ok('Crafted. The deck is complete.'); resolve(true); }
            else { UI.error(`Still missing ${left.length} card${left.length === 1 ? '' : 's'}: not enough wildcards.`); resolve(false); }
          } },
        ],
      });
      m._onClose = () => resolve(false);
    });
  };
})(window.MTG);
