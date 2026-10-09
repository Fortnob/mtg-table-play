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
  const wcIcon = (r, n) => el('span', { class: 'wc-ico wc-' + r, title: `${RAR_NAME[r]} wildcards`, html: gemSvg(r) + (n != null ? `<b>${fmtN(n)}</b>` : '') });

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

  /**
   * A booster, drawn the way a real one is printed: the set's art over the
   * whole front, "Magic: The Gathering" across the top, the set's name and
   * symbol where its logo goes, the kind of booster and its card count on
   * the band at the bottom, and crimped foil at both ends.
   */
  function boosterEl(setInfo, kind, opts) {
    opts = opts || {};
    const collector = kind === 'collector';
    const art = el('div', { class: 'bp-art' });
    const name = setInfo ? (setInfo.name || String(setInfo.code || '').toUpperCase()) : 'Booster';
    const node = el('div', { class: 'booster' + (collector ? ' collector' : '') + (opts.big ? ' big' : '') + (opts.cls ? ' ' + opts.cls : ''),
      title: `${name} ${collector ? 'Collector Booster' : 'Play Booster'}` }, [
      art,
      el('div', { class: 'bp-shade' }),
      el('div', { class: 'bp-foil' }),
      el('div', { class: 'bp-crimp top' }), el('div', { class: 'bp-crimp bottom' }),
      el('div', { class: 'bp-top' }, [el('span', { text: 'Magic' }), el('small', { text: 'The Gathering' })]),
      el('div', { class: 'bp-logo' }, [
        setInfo && setInfo.icon_svg_uri ? el('img', { class: 'bp-icon', src: setInfo.icon_svg_uri, alt: '' }) : null,
        el('div', { class: 'bp-name', text: name }),
      ].filter(Boolean)),
      el('div', { class: 'bp-band' }, [
        el('div', { class: 'bp-kind', text: collector ? 'Collector Booster' : 'Play Booster' }),
        el('div', { class: 'bp-count', text: collector ? '15 cards' : '14 cards' }),
      ]),
      el('div', { class: 'bp-seam' }),
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
  const RANK = { common: 0, uncommon: 1, rare: 2, mythic: 3 };
  const reduced = () => document.documentElement.dataset.reducedMotion === '1' ||
    (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  /** A wildcard's gem: a cut stone in the rarity's colours. */
  function gemSvg(r) {
    const id = 'wg' + (++shardSeq);
    const C = { common: ['#f2f2f2', '#9a9a9a', '#4a4a4a'], uncommon: ['#eef8ff', '#8fb4cc', '#3b5566'],
      rare: ['#fff2c2', '#d9a83a', '#6e4a10'], mythic: ['#ffd9b0', '#f06a22', '#7a1f06'] }[r] || ['#fff', '#999', '#444'];
    return `<svg viewBox="0 0 100 100" class="wc-gem" aria-hidden="true"><defs>` +
      `<linearGradient id="${id}a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${C[0]}"/><stop offset=".5" stop-color="${C[1]}"/><stop offset="1" stop-color="${C[2]}"/></linearGradient>` +
      `<radialGradient id="${id}b" cx=".5" cy=".4" r=".6"><stop offset="0" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs>` +
      `<polygon points="50,4 86,26 86,74 50,96 14,74 14,26" fill="url(#${id}a)" stroke="${C[0]}" stroke-width="1.5"/>` +
      `<polygon points="50,4 86,26 50,38 14,26" fill="#fff" opacity=".28"/><polygon points="14,26 50,38 50,96 14,74" fill="#000" opacity=".12"/>` +
      `<polygon points="86,26 86,74 50,96 50,38" fill="#000" opacity=".26"/><polygon points="50,38 68,49 50,82 32,49" fill="url(#${id}b)" opacity=".75"/>` +
      `<path d="M50 20 L54 46 L80 50 L54 54 L50 80 L46 54 L20 50 L46 46 Z" fill="#fff" opacity=".55"/></svg>`;
  }
  /** A wildcard, as a card of its own: a dark frame in its metal, and its gem. */
  function wildcardFace(r, track) {
    return el('div', { class: 'wc-card wc-' + r }, [
      el('div', { class: 'wc-frame' }),
      el('div', { class: 'wc-title', text: 'Wildcard' }),
      el('div', { class: 'wc-gem-wrap', html: gemSvg(r) }),
      el('div', { class: 'wc-rarity', text: RAR_NAME[r] }),
      track ? el('div', { class: 'wc-note', text: 'Wildcard track reward' }) : null,
    ].filter(Boolean));
  }
  UI.wildcardFace = wildcardFace;

  /**
   * Opening packs, over everything: your packs grouped by set (open one, or
   * all of a set at once); a pack torn open and its cards dealt face down,
   * the commons turned over by themselves and the rares and mythics left
   * to gather themselves and turn when clicked. Hover a card to bring it
   * up, right-click to hold it up to the light. `onClose` is told when it
   * closes.
   */
  UI.openPacks = async function (onClose) {
    const S = E();
    const sets = await MTG.scry.draftableSets().catch(() => []);
    const setInfo = (p) => (p.set ? (sets.find(s => s.code === p.set) || { code: p.set, name: p.name || String(p.set).toUpperCase() })
      : (sets[p.newest || 0] || sets[0] || { code: '', name: 'Booster' }));
    const backdrop = el('div', { class: 'po-backdrop' });
    const stage = el('div', { class: 'po-stage' });
    const head = el('div', { class: 'po-head' });
    const foot = el('div', { class: 'po-foot' });
    const overlay = el('div', { class: 'pack-open', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Opening packs' }, [
      backdrop, el('div', { class: 'po-vignette' }), el('div', { class: 'po-dust' }, Array.from({ length: 26 }, (_, i) => el('i', { style: {
        left: (Math.random() * 100).toFixed(1) + '%', '--t': (9 + Math.random() * 12).toFixed(1) + 's', '--d': (-Math.random() * 20).toFixed(1) + 's',
        '--s': (1 + Math.random() * 2.2).toFixed(1) + 'px' } }))),
      head, stage, foot,
      el('button', { type: 'button', class: 'btn ghost sm po-x', text: 'Close', onclick: () => close() }),
    ]);
    const hadAmbience = !!(MTG.audio && MTG.audio._ambWanted);
    if (MTG.audio && MTG.audio.ambience) MTG.audio.ambience(true);
    let onKey = () => {};
    const keyHandler = (e) => onKey(e);
    document.addEventListener('keydown', keyHandler);
    document.body.appendChild(overlay);
    overlay.addEventListener('contextmenu', (e) => e.preventDefault());
    const close = () => {
      if (inspecting) return closeInspect();
      document.removeEventListener('keydown', keyHandler);
      if (MTG.audio && MTG.audio.ambience && !hadAmbience) MTG.audio.ambience(false);
      overlay.classList.add('closing');
      setTimeout(() => overlay.remove(), 300);
      if (onClose) onClose();
    };
    const setBackdrop = (info) => {
      if (!info || !info.code) return;
      setArt(info.code).then(a => { if (a) backdrop.style.backgroundImage = 'url("' + a.url.replace(/"/g, '%22') + '")'; });
    };

    /* ---- right-click: the card held up to the light ---- */
    let inspecting = null;
    const inspect = (card) => {
      if (!card) return;
      closeInspect();
      MTG.sfx('inspect');
      const url = MTG.scry.imageUrl(card, 'large', 0) || MTG.scry.imageUrl(card, 'normal', 0);
      const big = el('div', { class: 'po-inspect' }, [
        el('div', { class: 'poi-card', style: url ? { backgroundImage: 'url("' + url.replace(/"/g, '%22') + '")' } : null }, url ? [] : [UI.cardFallback(card, 0)]),
        el('div', { class: 'poi-name', text: card.name }),
        el('div', { class: 'poi-sub', text: `${RAR_NAME[S.rarityOf(card)]} · you own ${Math.min(4, S.owned(card.name))} of 4 · right-click or Esc to put it down` }),
      ]);
      big.addEventListener('click', closeInspect);
      big.addEventListener('contextmenu', (e) => { e.preventDefault(); closeInspect(); });
      overlay.appendChild(big);
      inspecting = big;
    };
    function closeInspect() {
      if (!inspecting) return;
      const b = inspecting;
      inspecting = null;
      b.classList.add('closing');
      setTimeout(() => b.remove(), 200);
    }

    /* ---- your packs, by set ---- */
    const groups = () => {
      const m = new Map();
      for (const p of S.packs()) {
        const key = (p.set || 'new' + (p.newest || 0)) + '|' + (p.kind || 'play');
        if (!m.has(key)) m.set(key, { key, info: setInfo(p), kind: p.kind || 'play', packs: [] });
        m.get(key).packs.push(p);
      }
      return [...m.values()];
    };
    const inventory = () => {
      const gs = groups();
      if (!gs.length) return close();
      stage.className = 'po-stage inv';
      stage.innerHTML = ''; foot.innerHTML = ''; head.innerHTML = '';
      head.append(el('div', { class: 'po-title', text: 'Your packs' }), el('div', { class: 'po-sub', text: `${S.packs().length} unopened` }));
      setBackdrop(gs[0].info);
      const grid = el('div', { class: 'po-inv' });
      for (const g of gs) {
        const n = g.packs.length;
        const stack = el('div', { class: 'po-inv-stack' }, [
          n > 2 ? boosterEl(g.info, g.kind, { cls: 'behind b2' }) : null,
          n > 1 ? boosterEl(g.info, g.kind, { cls: 'behind b1' }) : null,
          boosterEl(g.info, g.kind),
          el('span', { class: 'po-inv-n', text: '×' + n }),
        ].filter(Boolean));
        stack.addEventListener('click', () => openOne(g));
        grid.appendChild(el('div', { class: 'po-inv-item' }, [
          stack,
          el('div', { class: 'po-inv-name', text: g.info.name }),
          el('div', { class: 'po-inv-btns' }, [
            el('button', { type: 'button', class: 'btn primary', text: 'Open', onclick: () => openOne(g) }),
            n > 1 ? el('button', { type: 'button', class: 'btn', text: `Open all (${n})`, onclick: () => openAll(g) }) : null,
          ].filter(Boolean)),
        ]));
      }
      stage.appendChild(grid);
      foot.appendChild(el('button', { type: 'button', class: 'btn', text: 'Done', onclick: close }));
      onKey = (e) => { if (e.key === 'Escape') close(); };
    };

    /* ---- one pack ---- */
    const openOne = (g) => {
      const p = (groups().find(x => x.key === g.key) || { packs: [] }).packs[0];
      if (!p) return inventory();
      const info = setInfo(p);
      setBackdrop(info);
      stage.className = 'po-stage one';
      stage.innerHTML = ''; foot.innerHTML = ''; head.innerHTML = '';
      head.append(el('div', { class: 'po-title', text: info.name }), el('div', { class: 'po-sub', text: (p.kind === 'collector' ? 'Collector Booster' : 'Play Booster') }));
      const pack = boosterEl(info, p.kind, { big: true });
      pack.classList.add('po-pack');
      const hint = el('div', { class: 'po-hint', text: 'Click the pack to open it' });
      stage.append(el('div', { class: 'po-spot' }), pack, hint);
      // the pack leans toward the pointer
      pack.addEventListener('pointermove', (e) => {
        const r = pack.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
        pack.style.setProperty('--rx', (-y * 10).toFixed(1) + 'deg');
        pack.style.setProperty('--ry', (x * 14).toFixed(1) + 'deg');
      });
      pack.addEventListener('pointerleave', () => { pack.style.setProperty('--rx', '0deg'); pack.style.setProperty('--ry', '0deg'); });
      MTG.sfx('pack_shake');
      let opening = false;
      const open = async () => {
        if (opening) return;
        opening = true;
        hint.classList.add('gone');
        pack.classList.add('seam');
        MTG.sfx('pack_seam');
        let res;
        try {
          [res] = await Promise.all([S.openPack(p.id, async () => info), sleep(reduced() ? 100 : 620)]);
        } catch (e) {
          opening = false;
          pack.classList.remove('seam');
          hint.classList.remove('gone');
          return UI.error(e.message || String(e));
        }
        pack.classList.remove('seam');
        pack.classList.add('torn');
        overlay.classList.remove('flash'); void overlay.offsetWidth; overlay.classList.add('flash');
        MTG.sfx('pack_tear');
        await sleep(reduced() ? 50 : 480);
        deal(res, g, info);
      };
      pack.addEventListener('click', open);
      onKey = (e) => {
        if (e.key === 'Escape') return close();
        if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); open(); }
      };
    };

    /** A face-down card, ready to be turned. */
    const cardTile = (it, i, n, cols) => {
      const r = it.wildcard || it.rarity;
      const big = r === 'rare' || r === 'mythic';
      const front = el('div', { class: 'po-front' });
      if (it.wildcard) front.appendChild(wildcardFace(it.wildcard, it.track));
      else {
        const url = MTG.scry.imageUrl(it.card, 'normal', 0);
        if (url) front.style.backgroundImage = 'url("' + url.replace(/"/g, '%22') + '")';
        else front.appendChild(UI.cardFallback(it.card, 0));
        if (it.foil) front.appendChild(el('div', { class: 'po-foil' }));
        front.appendChild(el('div', { class: 'po-sheen' }));
      }
      const col = i % cols, row = Math.floor(i / cols), rows = Math.ceil(n / cols);
      const t = el('button', { type: 'button', class: `po-card r-${r}${big ? ' big' : ''}`, 'aria-label': 'A card, face down', style: {
        '--i': String(i),
        '--ox': ((cols - 1) / 2 - col).toFixed(2), '--oy': ((rows - 1) / 2 - row).toFixed(2),
        transformOrigin: `${col === 0 ? 'left' : col === cols - 1 ? 'right' : 'center'} ${rows === 1 ? 'center' : row === 0 ? 'top' : row === rows - 1 ? 'bottom' : 'center'}`,
      } }, [
        el('div', { class: 'po-inner' }, [
          el('div', { class: 'po-back' }, [el('div', { class: 'back-ring' }, el('div', { class: 'back-pip' }))]),
          front,
        ]),
        el('div', { class: 'po-tags' }, [
          it.count > 1 ? el('span', { class: 'po-count-tag', text: '×' + it.count }) : null,
          it.isNew ? el('span', { class: 'po-new', text: 'New' }) : null,
          it.shards ? el('span', { class: 'po-dup', html: `+${shardSvg()}${fmtN(it.shards)}` }) : null,
        ].filter(Boolean)),
      ]);
      t._item = it; t._big = big; t._flipped = false;
      t.addEventListener('mouseenter', () => { if (t._flipped) MTG.sfx('hover'); });
      t.addEventListener('contextmenu', (e) => { e.preventDefault(); if (t._flipped && it.card) inspect(it.card); });
      return t;
    };

    /** Light thrown off a card as it turns: a ring, and motes. */
    const burst = (t, kind) => {
      if (reduced()) return;
      const b = el('div', { class: 'po-burst ' + kind }, [el('div', { class: 'po-ring' })]);
      const n = kind === 'mythic' ? 22 : 14;
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 + Math.random() * 0.3;
        const d = (kind === 'mythic' ? 90 : 65) + Math.random() * 60;
        b.appendChild(el('i', { style: { '--dx': (Math.cos(a) * d).toFixed(0) + 'px', '--dy': (Math.sin(a) * d - 30).toFixed(0) + 'px', '--d': (Math.random() * 0.2).toFixed(2) + 's' } }));
      }
      t.appendChild(b);
      setTimeout(() => b.remove(), 1600);
      if (kind === 'mythic') { overlay.classList.remove('quake'); void overlay.offsetWidth; overlay.classList.add('quake'); }
    };

    /** Turn a card over: a rare or mythic gathers itself first. */
    const flipper = (tiles, after) => {
      let flips = 0;
      const flip = async (t, quick) => {
        if (t._flipped || t._charging) return;
        const it = t._item;
        const r = it.wildcard || it.rarity;
        const pan = Math.max(-0.7, Math.min(0.7, -parseFloat(t.style.getPropertyValue('--ox')) / 4 || 0));
        if (t._big && !quick && !reduced()) {
          t._charging = true;
          t.classList.add('charging');
          MTG.sfx(r === 'mythic' ? 'charge_mythic' : 'charge_rare');
          await sleep(r === 'mythic' ? 820 : 520);
          t.classList.remove('charging');
          t._charging = false;
        }
        t._flipped = true;
        t.classList.remove('waiting');
        t.classList.add('flipped');
        t.setAttribute('aria-label', it.card ? it.card.name : `${RAR_NAME[it.wildcard]} wildcard`);
        if (it.wildcard) { MTG.sfx('wildcard'); burst(t, it.wildcard === 'mythic' ? 'mythic' : 'rare'); }
        else if (it.rarity === 'mythic') { if (!quick || !after.mythicSounded) MTG.sfx('reveal_mythic'); after.mythicSounded = true; burst(t, 'mythic'); }
        else if (it.rarity === 'rare') { if (!quick || !after.rareSounded) MTG.sfx('reveal_rare'); after.rareSounded = true; burst(t, 'rare'); }
        else if (!quick || flips % 3 === 0) MTG.sfx('card_flip', { index: flips, pan });
        flips++;
        if (it.isNew && (r === 'rare' || r === 'mythic') && !quick) setTimeout(() => MTG.sfx('new_card'), 700);
        if (it.shards && !quick) setTimeout(() => MTG.sfx('shards', { intensity: 0.15 }), 450);
        after();
      };
      return flip;
    };

    /* ---- the cards of one pack, dealt ---- */
    const deal = (res, g, info) => {
      stage.className = 'po-stage one dealt-stage';
      stage.innerHTML = ''; foot.innerHTML = '';
      const items = res.cards.concat(res.bonus.map(r => ({ wildcard: r, track: true })));
      const cols = Math.min(8, Math.ceil(items.length / 2));
      const grid = el('div', { class: 'po-grid', style: { '--cols': String(cols) } });
      stage.appendChild(grid);
      const tiles = items.map((it, i) => cardTile(it, i, items.length, cols));
      for (const t of tiles) grid.appendChild(t);
      const refresh = () => {
        foot.innerHTML = '';
        const hidden = tiles.filter(t => !t._flipped);
        if (hidden.length) foot.appendChild(el('button', { type: 'button', class: 'btn', text: 'Reveal all', onclick: revealAll }));
        const same = (groups().find(x => x.key === g.key) || { packs: [] }).packs.length;
        if (same) foot.appendChild(el('button', { type: 'button', class: 'btn' + (hidden.length ? '' : ' primary'), text: `Open next (${same})`, onclick: () => { MTG.sfx('click'); openOne(g); } }));
        if (S.packs().length) foot.appendChild(el('button', { type: 'button', class: 'btn', text: 'Back to packs', onclick: () => { MTG.sfx('click'); inventory(); } }));
        foot.appendChild(el('button', { type: 'button', class: 'btn' + (!hidden.length && !same ? ' primary' : ''), text: 'Done', onclick: close }));
      };
      const flip = flipper(tiles, refresh);
      for (const t of tiles) t.addEventListener('click', () => flip(t));
      const revealAll = () => tiles.filter(t => !t._flipped).forEach((t, k) => setTimeout(() => flip(t, true), k * 140));
      refresh();
      // dealt out of the pack, one after another
      requestAnimationFrame(() => requestAnimationFrame(() => grid.classList.add('dealt')));
      tiles.forEach((t, k) => setTimeout(() => {
        const pan = Math.max(-0.7, Math.min(0.7, -parseFloat(t.style.getPropertyValue('--ox')) / 4 || 0));
        MTG.sfx('card_deal', { pan });
      }, 60 + k * 55));
      const dealt = 60 + tiles.length * 55 + 350;
      // dealt: from now on a card comes up and goes back at once
      setTimeout(() => grid.classList.add('settled'), dealt + 300);
      const auto = tiles.filter(t => !t._big);
      auto.forEach((t, k) => setTimeout(() => { if (overlay.isConnected) flip(t); }, dealt + k * 150));
      setTimeout(() => { for (const t of tiles) if (t._big && !t._flipped) t.classList.add('waiting'); }, dealt + auto.length * 150);
      onKey = (e) => {
        if (e.key === 'Escape') return close();
        if (e.key !== ' ' && e.key !== 'Enter') return;
        e.preventDefault();
        const next = tiles.find(t => !t._flipped && !t._charging);
        if (next) flip(next);
        else if ((groups().find(x => x.key === g.key) || { packs: [] }).packs.length) openOne(g);
        else if (S.packs().length) inventory();
        else close();
      };
    };

    /* ---- every pack of a set at once ---- */
    const openAll = async (g) => {
      const packs = (groups().find(x => x.key === g.key) || { packs: [] }).packs.slice();
      if (!packs.length) return inventory();
      const info = g.info;
      setBackdrop(info);
      stage.className = 'po-stage all';
      stage.innerHTML = ''; foot.innerHTML = ''; head.innerHTML = '';
      head.append(el('div', { class: 'po-title', text: info.name }), el('div', { class: 'po-sub', text: `Opening ${packs.length} packs…` }));
      const fan = el('div', { class: 'po-fan' });
      const shown = Math.min(packs.length, 10);
      const fanned = Array.from({ length: shown }, (_, i) => {
        const b = boosterEl(info, g.kind);
        b.style.setProperty('--k', String(i - (shown - 1) / 2));
        fan.appendChild(b);
        return b;
      });
      stage.appendChild(fan);
      onKey = () => {};
      const results = [];
      let failed = null;
      for (let i = 0; i < packs.length; i++) {
        try { results.push(await S.openPack(packs[i].id, async () => info)); } catch (e) { failed = e; break; }
        const b = fanned[i % shown];
        if (b && !reduced()) { b.classList.remove('rip'); void b.offsetWidth; b.classList.add('rip'); }
        MTG.sfx('pack_tear_quick', { pan: shown > 1 ? ((i % shown) / (shown - 1) - 0.5) : 0 });
        await sleep(reduced() ? 10 : 110);
      }
      if (failed && !results.length) { UI.error(failed.message || String(failed)); return inventory(); }
      overlay.classList.remove('flash'); void overlay.offsetWidth; overlay.classList.add('flash');
      MTG.sfx('pack_tear');
      await sleep(reduced() ? 50 : 420);
      // everything, together: the same card once with how many, rarest first
      const merged = new Map();
      const wcs = { common: 0, uncommon: 0, rare: 0, mythic: 0 };
      let shardsIn = 0, fresh = 0, total = 0;
      for (const res of results) {
        for (const it of res.cards) {
          total++;
          if (it.wildcard) { wcs[it.wildcard]++; continue; }
          const key = it.card.name + (it.foil ? '|f' : '');
          const m = merged.get(key) || Object.assign({}, it, { count: 0, shards: 0, isNew: false });
          m.count++; m.shards += it.shards || 0; m.isNew = m.isNew || it.isNew;
          merged.set(key, m);
          shardsIn += it.shards || 0;
          if (it.isNew) fresh++;
        }
        for (const r of res.bonus) wcs[r]++;
      }
      const items = [...merged.values()].sort((a, b) => RANK[b.rarity] - RANK[a.rarity] || (b.foil ? 1 : 0) - (a.foil ? 1 : 0) || a.card.name.localeCompare(b.card.name));
      for (const r of ['mythic', 'rare', 'uncommon', 'common']) if (wcs[r]) items.unshift({ wildcard: r, count: wcs[r] });
      items.sort((a, b) => RANK[b.wildcard || b.rarity] - RANK[a.wildcard || a.rarity]);
      stage.className = 'po-stage all summary';
      stage.innerHTML = '';
      head.innerHTML = '';
      head.append(el('div', { class: 'po-title', text: `${info.name}: ${results.length} pack${results.length === 1 ? '' : 's'}` }),
        el('div', { class: 'po-sub' }, [
          document.createTextNode(`${total} cards · ${fresh} new`),
          shardsIn ? el('span', { html: ` · +${shardSvg()}${fmtN(shardsIn)} for extra copies` }) : null,
          ...RAR.filter(r => wcs[r]).map(r => el('span', { class: 'po-wcsum' }, [wcIcon(r, wcs[r])])),
        ].filter(Boolean)));
      const cols = Math.max(4, Math.min(10, Math.ceil(Math.sqrt(items.length * 1.8))));
      const grid = el('div', { class: 'po-grid many', style: { '--cols': String(cols) } });
      stage.appendChild(grid);
      const tiles = items.map((it, i) => cardTile(it, i, items.length, cols));
      for (const t of tiles) grid.appendChild(t);
      const refresh = () => {
        foot.innerHTML = '';
        if (S.packs().length) foot.appendChild(el('button', { type: 'button', class: 'btn', text: 'Back to packs', onclick: () => { MTG.sfx('click'); inventory(); } }));
        foot.appendChild(el('button', { type: 'button', class: 'btn primary', text: 'Done', onclick: close }));
      };
      const after = () => {};
      const flip = flipper(tiles, after);
      refresh();
      requestAnimationFrame(() => requestAnimationFrame(() => grid.classList.add('dealt')));
      setTimeout(() => grid.classList.add('settled'), 600 + tiles.length * 12);
      // the best of it turned over first, with its sound; the rest in a quick wave
      const best = tiles.filter(t => t._big);
      const rest = tiles.filter(t => !t._big);
      let at = 400;
      for (const t of best) { setTimeout(() => { if (overlay.isConnected) flip(t, true); }, at); at += 220; }
      rest.forEach((t, k) => setTimeout(() => { if (overlay.isConnected) flip(t, true); }, at + k * 35));
      if (failed) UI.error(`Some packs could not be opened: ${failed.message || failed}`);
      onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); close(); } };
    };

    inventory();
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
