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
  /** A price in dollars: cents under a hundred, whole dollars above. */
  const fmtUsd = (n) => '$' + (n < 100 ? n.toFixed(2) : Math.round(n).toLocaleString());

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
    const chip = el('button', { type: 'button', class: 'shard-chip', title: 'Shards: a click adds 10,000 and opens the Store', 'aria-label': 'Shards: add 10,000 and open the Store', onclick: onClick }, [
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
      } else if (ev.delta < 0) {
        // spent: counted down, crystals clicking out
        MTG.sfx('shards_spend');
        chip.classList.remove('spend'); void chip.offsetWidth; chip.classList.add('spend');
        const from = shown, t0 = performance.now(), dur = 700;
        const step = (t) => {
          const k = Math.min(1, (t - t0) / dur);
          shown = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 2)));
          val.textContent = fmtN(shown);
          if (k < 1) anim = requestAnimationFrame(step);
        };
        anim = requestAnimationFrame(step);
      } else { shown = to; val.textContent = fmtN(to); }
    });
    return chip;
  };

  /**
   * Your hoard in the top bar, beside the Shards: a little heap of your
   * unopened boosters and how many. Bought packs fly here; as each lands
   * the heap jumps, the count ticks up with a "+1" and the rim flashes.
   * Click it to open them.
   */
  UI.hoardChip = function (onClick) {
    const heap = el('span', { class: 'hc-heap' });
    const count = el('b', { class: 'hc-n' });
    const chip = el('button', { type: 'button', class: 'hoard-chip', title: 'Your packs: click to open them', 'aria-label': 'Your packs',
      onclick: () => { if (E().packs().length) onClick && onClick(); else MTG.sfx('reject'); } }, [heap, count]);
    let shown = E().packs().length;
    const draw = () => {
      const packs = E().packs();
      heap.innerHTML = '';
      const seen = new Set();
      const order = packs.filter(p => { const k = (p.set || 'n' + (p.newest || 0)) + p.kind; if (seen.has(k)) return false; seen.add(k); return true; })
        .concat(packs).slice(0, Math.min(3, packs.length));
      Promise.all([MTG.scry.draftableSets().catch(() => []), MTG.scry.packSets().catch(() => [])]).then(([sets, sold]) => {
        heap.innerHTML = '';
        order.forEach((p, k) => {
          const info = p.set ? (sold.find(s => s.code === p.set) || { code: p.set }) : (sets[p.newest || 0] || null);
          const b = boosterEl(info, p.kind);
          b.style.setProperty('--k', String(k - (order.length - 1) / 2));
          heap.appendChild(b);
        });
        if (!order.length) heap.appendChild(el('span', { class: 'hc-empty' }));
      });
      chip.classList.toggle('empty', !packs.length);
    };
    const setCount = (n) => { count.textContent = String(n); };
    draw(); setCount(shown);
    /* a pack arriving (UI.purchaseDialog's flight lands here): the count
       goes up one at a time, as each lands */
    chip.landOne = () => {
      shown = Math.min(E().packs().length, shown + 1);
      setCount(shown);
      const plus = el('span', { class: 'hc-plus', text: '+1' });
      chip.appendChild(plus);
      setTimeout(() => plus.remove(), 900);
      chip.classList.remove('arrive'); void chip.offsetWidth; chip.classList.add('arrive');
    };
    MTG.bus.on('economy:changed', (ev) => {
      const n = E().packs().length;
      draw();
      // packs bought fly in and count themselves; anything else (opened, granted) shows at once
      if (ev.why === 'buy' || ev.why === 'bundle') return;
      shown = n; setCount(n);
    });
    // after a flight, whatever has not been counted is
    chip.settle = () => { shown = E().packs().length; setCount(shown); };
    return chip;
  };

  /** How far along the wildcard track you are: a rare every six packs, a mythic every thirty. */
  UI.wildcardTrack = function () {
    const S = E();
    const t = S.state.track || { rare: 0, mythic: 0 };
    const bar = (r, n, of) => el('div', { class: 'wt-row', title: `${RAR_NAME[r]} wildcard in ${of - n} more pack${of - n === 1 ? '' : 's'}` }, [
      el('span', { class: 'wt-gem', html: gemSvg(r) }),
      el('span', { class: 'wt-bar' }, [el('i', { style: { width: (100 * n / of).toFixed(0) + '%' } })]),
      el('span', { class: 'wt-n', text: `${n}/${of}` }),
    ]);
    return el('div', { class: 'wc-track', 'aria-label': 'Wildcard track' }, [
      el('div', { class: 'wt-title', text: 'Wildcard track' }),
      bar('rare', t.rare % S.WC_TRACK.rare, S.WC_TRACK.rare),
      bar('mythic', t.mythic % S.WC_TRACK.mythic, S.WC_TRACK.mythic),
    ]);
  };

  /* ---------------- art for packs and decks, each its own ----------------
     Every set's packs (Play and Collector apart) and every Commander deck
     wears an illustration no other one does. The first to ask for an
     illustration has it, and anyone after takes its next choice; told
     apart by Scryfall's illustration id (its first eight hex digits), so a
     reprint of the same picture counts as the same. Kept, so each keeps its
     picture from then on. */
  const ART_KEY = 'artclaims7';
  for (const old of ['artclaims', 'artclaims2', 'artclaims3', 'artclaims4', 'artclaims5']) MTG.store.del(old);   // the claims of earlier ways of choosing
  const artReg = MTG.store.get(ART_KEY, null) || { by: {}, ill: {} };
  const artWaiting = new Map();
  /**
   * The art for `key`: the one it has, or the first of `candidates`
   * ({ url, name, ill }) whose illustration nobody else has. Null when all
   * are taken.
   */
  function claimArt(key, candidates) {
    if (artReg.by[key]) return artReg.by[key];
    for (const c of candidates || []) {
      if (!c || !c.url) continue;
      const id = c.ill ? String(c.ill).replace(/-/g, '').slice(0, 8).toLowerCase() : c.url;
      if (artReg.ill[id] && artReg.ill[id] !== key) continue;
      artReg.by[key] = { url: c.url, name: c.name || '', ill: id };
      artReg.ill[id] = key;
      MTG.store.set(ART_KEY, artReg);
      return artReg.by[key];
    }
    return null;
  }
  /* Never a pack's face: the numbered chase printings (serialized, the
     headliners, double rainbow, gleaming gold), one of a handful, and the
     promos, which no pack holds at all. */
  const NOT_A_PULL = new Set(['serialized', 'headliner', 'doublerainbow', 'gleaminggold',
    'playpromo', 'prerelease', 'promopack', 'buyabox', 'bundle', 'datestamped', 'stamped', 'judgegift', 'league',
    'convention', 'tourney', 'release', 'instore', 'event', 'giftbox', 'setpromo', 'wizardsplaynetwork', 'premiereshop', 'intropack']);
  const artOf = (c) => {
    if (!c || (c.promo_types || []).some(t => NOT_A_PULL.has(t)) || /z$/i.test(String(c.collector_number || '')) || /^A-/.test(c.name || '')) return null;
    const url = MTG.scry.imageUrl(c, 'art_crop', 0);
    const ill = c.illustration_id || (c.card_faces && c.card_faces[0] && c.card_faces[0].illustration_id) || null;
    return url ? { url, name: c.name, ill } : null;
  };
  /**
   * A set's pictures chosen ahead of time (src/10d0-packart.js, written by
   * tools/packart.js): each 40 hex digits, a card id without its dashes and
   * the first 8 of its illustration id. The art crop comes straight from
   * the id, so nothing is asked of Scryfall but the picture itself.
   */
  function preArt(code) {
    const s = MTG.packArt && MTG.packArt[code];
    if (!s) return null;
    const out = [];
    for (let i = 0; i + 40 <= s.length; i += 40) {
      const h = s.slice(i, i + 32);
      const id = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
      out.push({ url: `https://cards.scryfall.io/art_crop/front/${id[0]}/${id[1]}/${id}.jpg`, name: '', ill: s.slice(i + 32, i + 40) });
    }
    return out;
  }
  /* A picture whose subject is off to one side (Black Lotus, Ancestral
     Recall: MTG.artFocus) is centred on it in a box of the given shape
     (width over height), as far as the picture reaches: "cover" scales a
     tall box's picture to its height, so only the across matters there,
     and a wide box's to its width, so only the down. '' for the rest. */
  const ART_ASPECT = 563 / 451;   // Scryfall's art crops, near enough
  /* A picture chosen by eye (MTG.packArtChosen) brings its own point and
     zoom, set for a pack: in a tall box it is placed so; in a wide one (the
     Store's banner) its point is kept and the zoom left, being for a pack. */
  function artPlacement(a, boxAspect) {
    if (!a || !(boxAspect > 0)) return null;
    const f = a.focus || (MTG.artFocus && MTG.artFocus[String(a.ill || '').slice(0, 8)]);
    const zoom = a.zoom > 1 && boxAspect < 1 ? a.zoom : 1;
    if (!f && zoom === 1) return null;
    // the picture against the box, across and down: "cover", times the zoom
    const rw = Math.max(1, ART_ASPECT / boxAspect) * zoom, rh = Math.max(1, boxAspect / ART_ASPECT) * zoom;
    const along = (at, r) => (r <= 1 ? 50 : Math.max(0, Math.min(100, (at / 100 * r - 0.5) / (r - 1) * 100)));
    return {
      pos: `${along(f ? f[0] : 50, rw).toFixed(1)}% ${along(f ? f[1] : 50, rh).toFixed(1)}%`,
      size: zoom > 1 ? `${(rw * 100).toFixed(2)}% ${(rh * 100).toFixed(2)}%` : null,
    };
  }
  /** Paint a claimed picture into a box, centred on its subject where one is known. */
  function paintArt(node, a, boxAspect) {
    if (!a || !node) return;
    node.style.backgroundImage = 'url("' + a.url.replace(/"/g, '%22') + '")';
    const at = artPlacement(a, boxAspect || (node.offsetWidth && node.offsetHeight ? node.offsetWidth / node.offsetHeight : 0));
    if (at) { node.style.backgroundPosition = at.pos; if (at.size) node.style.backgroundSize = at.size; }
  }

  /* The pictures chosen by eye (src/10d2-packchoice.js) are their packs'
     first of all, placed as chosen: two packs may share one, if that is
     what was chosen. */
  for (const [key, v] of Object.entries(MTG.packArtChosen || {})) {
    const h = v[0], id = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
    artReg.by['set:' + key] = { url: `https://cards.scryfall.io/art_crop/front/${id[0]}/${id[1]}/${id}.jpg`, name: '', ill: v[1], focus: [v[2], v[3]], zoom: v[4] };
    artReg.ill[v[1]] = 'set:' + key;
  }
  MTG.store.set(ART_KEY, artReg);
  /* A face chosen by hand (Black Lotus for Alpha, Ancestral Recall for
     Beta) is that set's before any other pack picks: Unlimited reprints the
     same pictures and would otherwise take them if its packs were seen first. */
  for (const code of MTG.packArtReserved || []) claimArt('set:' + code, (preArt(code) || []).slice(0, 1));

  /**
   * A striking card from a set, for the front of its packs: its best-known
   * mythic or rare whose picture no other pack or deck wears (the Collector
   * Booster another again), else any card of the set that is free. From
   * the list made ahead of time; a set newer than the list is looked up,
   * behind anything the player is waiting on.
   */
  /* Every set on sale has its picture handed out at once, in one order:
     the hand-chosen ones first (above), then the sets from newest to
     oldest, their Play Boosters before their Collector Boosters. So each
     pack wears the same picture whichever shelf is looked at first, and
     the picture tools/packfocus.py --final shows it wearing. */
  let assigned = null;
  const assignAll = () => assigned || (assigned = MTG.scry.packSets().then((sets) => {
    for (const s of sets) claimArt('set:' + s.code, preArt(s.code));
    for (const s of sets) if (E().hasCollector(s)) claimArt('set:' + s.code + ':collector', preArt(s.code));
  }).catch(() => {}));

  function setArt(code, kind) {
    const key = 'set:' + code + (kind === 'collector' ? ':collector' : '');
    if (artReg.by[key]) return Promise.resolve(artReg.by[key]);
    return assignAll().then(() => artFor(code, kind, key));
  }
  function artFor(code, kind, key) {
    if (artReg.by[key]) return artReg.by[key];
    const ready = claimArt(key, preArt(code));
    if (ready) return ready;
    if (artWaiting.has(key)) return artWaiting.get(key);
    const p = (async () => {
      const look = async (q, max) => { try { return await MTG.scry.search(q, { max, order: 'edhrec', unique: 'art', low: true, quiet: true }); } catch (e) { return []; } };
      let art = claimArt(key, (await look(`set:${code} (r:mythic or r:rare) -t:land`, 40)).map(artOf));
      if (!art) art = claimArt(key, (await look(`set:${code}`, 120)).map(artOf));
      artWaiting.delete(key);
      return art;
    })();
    artWaiting.set(key, p);
    return p;
  }

  /**
   * A booster, drawn the way a real one is printed: the set's art over the
   * whole front, "Magic: The Gathering" across the top, the set's name and
   * symbol where its logo goes, the kind of booster and its card count on
   * the band at the bottom, and crimped foil at both ends.
   */
  /* Pack art fetched only as a booster comes into view: a shelf of every
     set would otherwise ask for two hundred searches at once. */
  const lazyArt = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver((entries) => {
    for (const en of entries) {
      if (!en.isIntersecting || !en.target._loadArt) continue;
      lazyArt.unobserve(en.target);
      const load = en.target._loadArt;
      en.target._loadArt = null;
      load();
    }
  }, { rootMargin: '300px' }) : null;

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
    const paint = () => setArt(setInfo.code, kind).then(a => paintArt(art, a, 5 / 8.6));
    if (setInfo && setInfo.code) {
      const had = artReg.by['set:' + setInfo.code + (kind === 'collector' ? ':collector' : '')];
      if (had || !opts.lazy || !lazyArt) paint();
      else { node._loadArt = paint; lazyArt.observe(node); }
    }
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
        `${fmtN(S.REWARD.play)} a game, ${fmtN(S.REWARD.win)} more for a win, and ${fmtN(S.REWARD.firstWin)} for your first win each day. Hold Shift to buy packs five at a time.` })]),
      el('div', { class: 'store-wallet' }, [
        shards(S.shards(), 'big'),
        el('div', { class: 'wc-col' }, [el('div', { class: 'wc-row' }, RAR.map(r => wcIcon(r, S.wildcards()[r]))), UI.wildcardTrack()]),
        openPacksButton(opts.onOpenPacks),
      ]),
    ]);
    const tabs = el('div', { class: 'store-tabs', role: 'tablist' });
    const body = el('div', { class: 'store-body' });
    const TABS = [['featured', 'Featured'], ['packs', 'Packs'], ['precons', 'Commander decks'], ['sleeves', 'Sleeves'], ['frames', 'Frames'], ['wildcards', 'Wildcards'], ['deals', 'Daily deals']];
    const show = (id) => {
      storeTab = id;
      for (const b of tabs.children) b.setAttribute('aria-selected', b.dataset.tab === id ? 'true' : 'false');
      body.innerHTML = '';
      if (id === 'featured') featured(body, Object.assign({}, opts, { go: (t) => { MTG.sfx('click'); show(t); window.scrollTo({ top: 0 }); } }));
      else if (id === 'packs') packsTab(body, opts);
      else if (id === 'precons') preconsTab(body);
      else if (id === 'sleeves') sleevesTab(body);
      else if (id === 'wildcards') wildcardsTab(body);
      else if (id === 'frames') UI.framesTab(body, UI.purchaseDialog);
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
        el('div', { class: 'wc-col' }, [el('div', { class: 'wc-row' }, RAR.map(r => wcIcon(r, S.wildcards()[r]))), UI.wildcardTrack()]), openPacksButton(opts.onOpenPacks)]));
    });
  };

  function openPacksButton(onOpen) { return UI.packHoard(onOpen); }

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

  /* ---------------- the Featured tab ----------------
     The newest set; bundles, each cheaper than its parts and covering a
     different corner of the game; the recent sets, one row of them,
     however wide the screen; and a row from every other tab, each with
     the way to the rest of it. */
  const BUNDLE_OFF = 0.12;       // a bundle costs this much less than what is in it
  const STARTER_OFF = 0.15;      // the starter bundle a little less again

  /**
   * Today's bundles, from the sets on sale (newest first): each { id,
   * title, blurb, parts: [{ set, kind, n }], wc: { rarity: n }, off }. One
   * that cannot be made (no masters sets yet, say) is left out.
   */
  function bundleOffers(sets) {
    const S = E();
    const core = sets.filter(s => s.set_type === 'expansion' || s.set_type === 'core');
    const masters = sets.filter(s => s.set_type === 'masters');
    const eternal = sets.filter(s => s.set_type === 'eternal');
    const collectors = sets.filter(s => S.hasCollector(s));
    const day = Math.floor(Date.now() / 864e5);
    // a set from each age of the game, a different one each day
    const ages = [['1993', '1998'], ['1998', '2005'], ['2005', '2012'], ['2012', '2019'], ['2019', '9999']];
    const aged = ages.map(([a, b], i) => {
      const list = core.filter(s => (s.released_at || '') >= a && (s.released_at || '') < b);
      return list.length ? list[(day + i * 7) % list.length] : null;
    }).filter(Boolean);
    const n3 = (list) => list.slice(0, 3);
    const newest = core[0];
    const words = ['', 'one', 'two', 'three', 'four', 'five', 'six'];
    return [
      core.length >= 3 && { id: 'starter', title: 'Starter bundle', off: STARTER_OFF,
        blurb: 'Two packs of each of the three newest sets, a rare wildcard and two uncommon ones: a bit of everything to start a collection with.',
        parts: n3(core).map(s => ({ set: s, kind: 'play', n: 2 })), wc: { rare: 1, uncommon: 2 } },
      newest && { id: 'newest', title: `${newest.name} bundle`, off: BUNDLE_OFF,
        blurb: S.hasCollector(newest) ? 'Six Play Boosters of the newest set, and a Collector Booster of it.' : 'Eight Play Boosters of the newest set.',
        parts: S.hasCollector(newest) ? [{ set: newest, kind: 'play', n: 6 }, { set: newest, kind: 'collector', n: 1 }] : [{ set: newest, kind: 'play', n: 8 }] },
      core.length >= 6 && { id: 'sampler', title: 'Standard sampler', off: BUNDLE_OFF,
        blurb: 'A pack of each of the six newest sets.', parts: core.slice(0, 6).map(s => ({ set: s, kind: 'play', n: 1 })) },
      collectors.length >= 3 && { id: 'collector', title: 'Collector’s trio', off: BUNDLE_OFF,
        blurb: 'A Collector Booster of each of the three newest sets that have them.', parts: n3(collectors).map(s => ({ set: s, kind: 'collector', n: 1 })) },
      masters.length >= 3 && { id: 'masters', title: 'Masters collection', off: BUNDLE_OFF,
        blurb: 'A pack of each of the three newest Masters and remastered sets.', parts: n3(masters).map(s => ({ set: s, kind: 'play', n: 1 })) },
      aged.length >= 4 && { id: 'ages', title: 'Through the ages', off: BUNDLE_OFF,
        blurb: 'A pack from each age of the game, from its first years to now. Different every day.', parts: aged.map(s => ({ set: s, kind: 'play', n: 1 })) },
      eternal.length >= 2 && { id: 'eternal', title: 'Worlds beyond', off: BUNDLE_OFF,
        blurb: `A pack of each of the ${words[Math.min(3, eternal.length)]} newest Eternal sets, made for formats where every card is legal.`, parts: n3(eternal).map(s => ({ set: s, kind: 'play', n: 1 })) },
      { id: 'wildcards', title: 'Wildcard chest', off: BUNDLE_OFF,
        blurb: 'Four uncommon wildcards, two rare and a mythic: the cards you are missing, crafted.', parts: [], wc: { uncommon: 4, rare: 2, mythic: 1 } },
    ].filter(Boolean);
  }
  const packsIn = (b) => b.parts.reduce((t, p) => t + p.n, 0);
  /** What is in a bundle, in a line. */
  function bundleContents(b) {
    const bits = b.parts.map(p => `${p.n > 1 ? p.n + ' × ' : ''}${p.set.name}${p.kind === 'collector' ? ' Collector' : ''}`);
    const wcs = Object.entries(b.wc || {}).filter(([, n]) => n > 0).map(([r, n]) => `${n} ${RAR_NAME[r].toLowerCase()} wildcard${n > 1 ? 's' : ''}`);
    return bits.concat(wcs).join(' · ');
  }
  /** What a bundle's parts cost apart, and what it costs: sets priced by appraisal are appraised first. */
  async function bundlePrice(b) {
    const S = E();
    await Promise.all(b.parts.map(p => (S.needsAppraisal(p.set) ? S.appraise(p.set).catch(() => 1) : null)));
    const full = b.parts.reduce((t, p) => t + S.packPrice(p.set, p.kind) * p.n, 0)
      + Object.entries(b.wc || {}).reduce((t, [r, n]) => t + (S.WC_PRICES[r] || 0) * n, 0);
    return { full, cost: Math.round(full * (1 - b.off) / 50) * 50 };
  }
  /** A bundle to look at: its packs fanned out (two of a set at most), its wildcards beside them. */
  function bundleVisual(b) {
    const v = el('div', { class: 'bundle-visual' });
    const shown = b.parts.flatMap(p => Array.from({ length: Math.min(p.n, 2) }, () => p)).slice(0, 6);
    const wcs = Object.entries(b.wc || {}).filter(([, n]) => n > 0);
    if (shown.length) {
      const fan = el('div', { class: 'bv-fan' });
      shown.forEach((p, i) => {
        const bo = boosterEl(p.set, p.kind, { lazy: true });
        bo.style.setProperty('--k', String(i - (shown.length - 1) / 2));
        fan.appendChild(bo);
      });
      v.appendChild(fan);
    } else if (wcs.length) {
      // all wildcards: the cards themselves, fanned
      const faces = wcs.flatMap(([r, n]) => Array.from({ length: Math.min(n, 2) }, () => r)).slice(0, 5);
      const fan = el('div', { class: 'bv-fan' });
      faces.forEach((r, i) => {
        const f = el('div', { class: 'wc-tile-face bv-wc' }, [UI.wildcardFace(r)]);
        f.style.setProperty('--k', String(i - (faces.length - 1) / 2));
        fan.appendChild(f);
      });
      v.appendChild(fan);
    }
    if (wcs.length) {
      v.appendChild(el('div', { class: 'bv-wcs' }, wcs.map(([r, n]) => el('span', { class: 'bv-gem',
        html: UI.wildcardIconHtml(r) + `<b>×${n}</b>`, title: `${n} ${RAR_NAME[r]} wildcard${n > 1 ? 's' : ''}` }))));
    }
    const total = packsIn(b);
    if (total) v.appendChild(el('span', { class: 'bv-count', text: `${total} pack${total > 1 ? 's' : ''}` }));
    return v;
  }
  function bundleCard(b) {
    const btn = el('button', { type: 'button', class: 'btn primary buy', html: shardSvg() + ' \u2026', disabled: true, 'aria-label': 'Buy the ' + b.title });
    const was = el('s', { class: 'bundle-was dim' });
    const card = el('div', { class: 'store-card bundle' }, [
      bundleVisual(b),
      el('div', { class: 'sc-title', text: b.title }),
      el('div', { class: 'sc-sub dim', text: b.blurb }),
      el('div', { class: 'bundle-has', text: bundleContents(b) }),
      el('div', { class: 'bundle-buy' }, [btn, was, el('span', { class: 'pack-tag bonus', text: `Save ${Math.round(b.off * 100)}%` })]),
    ]);
    bundlePrice(b).then(({ full, cost }) => {
      btn.disabled = false;
      btn.innerHTML = shardSvg() + ' ' + fmtN(cost);
      was.textContent = fmtN(full);
      was.title = 'What it all costs bought apart';
      btn.onclick = () => UI.purchaseDialog({
        title: b.title, sub: bundleContents(b), cost, fly: Math.max(1, packsIn(b)), to: packsIn(b) ? 'hoard' : null,
        visual: bundleVisual(b), buy: () => E().buyBundle(b.parts, b.wc, cost),
      });
    }).catch(() => { btn.textContent = 'Unavailable'; });
    return card;
  }

  /**
   * A grid that only ever shows one row: as many tiles as fit across (each
   * at least `minW` wide, `gap` apart), and again when the width changes.
   * `make(item)` draws a tile.
   */
  function oneRow(cls, items, make, minW, gap) {
    const grid = el('div', { class: 'store-grid one-row ' + cls });
    let shown = -1;
    const fit = () => {
      const w = grid.clientWidth;
      if (!w) return;
      const n = Math.max(1, Math.min(items.length, Math.floor((w + gap) / (minW + gap))));
      if (n === shown) return;
      shown = n;
      grid.replaceChildren(...items.slice(0, n).map(make));
    };
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => { if (!grid.isConnected && shown >= 0) { ro.disconnect(); return; } fit(); });
      ro.observe(grid);
    } else grid.replaceChildren(...items.slice(0, 4).map(make));
    return grid;
  }
  /** A section of the featured page: its heading, the way to its whole tab, and its row. */
  function shelf(title, tab, go, row) {
    return el('section', { class: 'store-shelf' }, [
      el('div', { class: 'store-h-row' }, [
        el('h3', { class: 'store-h', text: title }),
        tab ? el('button', { type: 'button', class: 'btn ghost sm see-all', text: 'See all \u203a', onclick: () => go(tab) }) : null,
      ].filter(Boolean)),
      row,
    ]);
  }
  /** A small tile that leads to its tab. */
  const miniTile = (go, tab, label, visual, title, sub) => el('button', { type: 'button', class: 'store-card mini', 'aria-label': label, onclick: () => go(tab) }, [
    visual, el('div', { class: 'sc-title', text: title }), sub ? el('div', { class: 'sc-sub dim', html: sub }) : null,
  ].filter(Boolean));

  /**
   * A list in the day's own order: the same all day, a new one tomorrow.
   * `salt` names the shelf, so each shelf is stirred its own way.
   */
  function dailyShuffle(list, salt) {
    const d = new Date();
    let h = 2166136261;
    for (const ch of `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}|${salt}`) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
    const rnd = () => {
      h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909);
      return ((h ^= h >>> 16) >>> 0) / 4294967296;
    };
    const out = list.slice();
    for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; }
    return out;
  }

  /* The featured page. The new set, the bundles, the recent sets, the
     day's deals and the wildcards are what they are; the Commander decks,
     sleeves and frames come in a new order each day, so the page shows
     something different every time you come back to it. */
  async function featured(body, opts) {
    const go = opts.go || (() => {});
    const [sets, onSale] = await Promise.all([MTG.scry.draftableSets().catch(() => []), MTG.scry.packSets().catch(() => [])]);
    if (!sets.length) { body.appendChild(el('p', { class: 'dim', text: 'The sets could not be loaded. Check the connection, or download the card database in Options.' })); return; }
    const S = E();
    const s = sets[0];
    const hero = el('section', { class: 'store-hero' });
    const bg = el('div', { class: 'hero-art' });
    setArt(s.code).then(a => paintArt(bg, a));
    hero.append(bg, el('div', { class: 'hero-shade' }), el('div', { class: 'hero-in' }, [
      boosterEl(s, 'play', { big: true }),
      el('div', { class: 'hero-copy' }, [
        el('div', { class: 'eyebrow', text: 'New set' }),
        el('h2', { text: s.name }),
        el('p', { class: 'dim', text: `Released ${s.released_at}. Play Boosters: fourteen cards, a rare or mythic in every pack, and a foil.` }),
        el('div', { class: 'hero-buy' }, [
          buyBtn(s, 'play', 1), buyBtn(s, 'play', 10), S.hasCollector(s) ? buyBtn(s, 'collector', 1) : null,
        ].filter(Boolean)),
      ]),
    ]));
    body.appendChild(hero);

    // bundles, each cheaper than what is in it
    const bundles = el('div', { class: 'store-grid bundles' }, bundleOffers(onSale.length ? onSale : sets).map(bundleCard));
    body.appendChild(shelf('Bundles', null, go, bundles));

    // the recent sets: one row of them, however wide the screen
    body.appendChild(shelf('Recent sets', 'packs', go, oneRow('packs', sets.slice(1, 13), (st) => packTile(st), 230, 16)));

    // a row from every other tab
    const decks = oneRow('mini', [], () => null, 170, 16);
    body.appendChild(shelf('Commander decks', 'precons', go, decks));
    preconList().then((list) => {
      const row = oneRow('mini', dailyShuffle(list, 'decks').slice(0, 10), (p) => {
        const art = el('div', { class: 'mini-art' });
        const had = artReg.by['deck:' + p.file];
        if (had) art.style.backgroundImage = 'url("' + had.url + '")';
        else preconInfo(p).then((info) => { if (info.art) art.style.backgroundImage = 'url("' + info.art + '")'; }).catch(() => {});
        // a deck here is looked through where it is, like one in its own tab
        const tile = miniTile(go, 'precons', p.name, art, p.name, p.date ? p.date.slice(0, 4) : '');
        tile.onclick = () => inspectPrecon(p);
        tile.title = 'Look through ' + p.name;
        preconMiniMeta(tile, p, go);
        return tile;
      }, 170, 16);
      decks.replaceWith(row);
    }).catch(() => decks.replaceWith(el('p', { class: 'dim', text: 'The deck lists could not be loaded.' })));

    const dealRow = oneRow('mini', [], () => null, 170, 16);
    body.appendChild(shelf('Daily deals', 'deals', go, dealRow));
    S.dailyDeals(makeDeals).then((items) => {
      dealRow.replaceWith(oneRow('mini', items || [], (d) => {
        const card = d.card || { name: d.name, id: d.id };
        const url = MTG.scry.imageUrl(card, 'normal', 0);
        return miniTile(go, 'deals', d.name, el('div', { class: 'deal-img', style: url ? { backgroundImage: 'url("' + url.replace(/"/g, '%22') + '")' } : null }),
          d.name, d.bought ? 'Bought' : shardSvg() + ' ' + fmtN(d.price));
      }, 170, 16));
    }).catch(() => dealRow.replaceWith(el('p', { class: 'dim', text: 'No deals could be found today.' })));

    const art = S.sleeves().art || {};
    const sleeves = dailyShuffle(S.SLEEVES.filter(sl => !S.sleeves().owned.includes(sl.id) && (sl.kind !== 'art' || art[sl.id])), 'sleeves');
    body.appendChild(shelf('Sleeves', 'sleeves', go, oneRow('mini', sleeves, (sl) =>
      miniTile(go, 'sleeves', sl.name + ' sleeve', sleeveFace(sl, art[sl.id]), sl.name,
        shardSvg() + ' ' + fmtN(S.sleevePrice(sl))), 170, 16)));

    const me = (MTG.app && MTG.app.myName) || 'You';
    const frames = dailyShuffle(S.FRAMES.filter(fr => !S.state.frames.owned.includes(fr.id)), 'frames');
    body.appendChild(shelf('Frames', 'frames', go, oneRow('mini', frames, (fr) =>
      miniTile(go, 'frames', fr.name + ' frame', el('div', { class: 'mini-portrait' }, [UI.portrait(me, null, { size: 'lg', avatar: MTG.settings.avatar, frame: fr.id })]),
        fr.name, shardSvg() + ' ' + fmtN(fr.price)), 170, 16)));

    body.appendChild(shelf('Wildcards', 'wildcards', go, oneRow('mini', RAR, (r) =>
      miniTile(go, 'wildcards', RAR_NAME[r] + ' wildcard', el('div', { class: 'wc-tile-face' }, [UI.wildcardFace(r)]),
        `${RAR_NAME[r]} wildcard`, shardSvg() + ' ' + fmtN(S.WC_PRICES[r])), 170, 16)));
  }

  function notEnough(cost) {
    MTG.sfx('reject');
    UI.error(`That costs ${fmtN(cost)} Shards; you have ${fmtN(E().shards())}. Play some games to earn more.`);
  }
  /* Shift held: every pack button buys five times as many, and says so
     while it is held (the whole page knows, through a class on the root). */
  const SHIFT_X = 5;
  const setShift = (on) => document.documentElement.classList.toggle('shift-buy', !!on);
  document.addEventListener('keydown', (e) => { if (e.key === 'Shift') setShift(true); });
  document.addEventListener('keyup', (e) => { if (e.key === 'Shift') setShift(false); });
  window.addEventListener('blur', () => setShift(false));
  function buyBtn(s, kind, qty) {
    const each = E().packPrice(s, kind);
    const label = (n) => (kind === 'collector' ? (n === 1 ? 'Collector' : `${n} Collector`) : n === 1 ? '1 pack' : `${n} packs`);
    const face = (n, cls) => el('span', { class: 'buy-face ' + cls }, [
      el('span', { text: label(n) }), el('span', { class: 'buy-price', html: shardSvg() + fmtN(each * n) }),
    ]);
    return el('button', { type: 'button', class: 'btn buy shiftable' + (kind === 'play' && qty === 1 ? ' primary' : ''),
      title: `Hold Shift to buy ${qty * SHIFT_X}`,
      onclick: (e) => buy(s, kind, e.shiftKey || document.documentElement.classList.contains('shift-buy') ? qty * SHIFT_X : qty) }, [
      face(qty, 'normal'), face(qty * SHIFT_X, 'shifted'),
    ]);
  }
  /** Boosters fanned out, as many as are being bought (up to five shown). */
  function packFan(s, kind, qty) {
    const shown = Math.min(5, qty);
    const fan = el('div', { class: 'pd-fan' });
    for (let i = 0; i < shown; i++) {
      const b = boosterEl(s, kind, { big: shown === 1 });
      b.style.setProperty('--k', String(i - (shown - 1) / 2));
      fan.appendChild(b);
    }
    if (qty > shown) fan.appendChild(el('span', { class: 'po-inv-n', text: '\u00d7' + qty }));
    return fan;
  }
  function buy(s, kind, qty) {
    const each = E().packPrice(s, kind);
    const what = `${qty} ${kind === 'collector' ? 'Collector Booster' : 'Play Booster'}${qty > 1 ? 's' : ''}`;
    UI.purchaseDialog({
      title: what, sub: s.name, visual: packFan(s, kind, qty), cost: each * qty, fly: qty, to: 'hoard',
      buy: () => E().buyPacks(s, kind, qty),
    });
  }

  /**
   * A set's packs on the shelf. `extra`: the sets whose cards its packs may
   * hold besides its own (a Commander deck's new cards, Alchemy's), said in
   * a word on the tile and named in full on hover.
   */
  /* ---------------- Commander decks ----------------
     The preconstructed Commander decks, as printed. MTGJSON keeps their
     lists. Buying one puts every card of it into your collection, and it
     can be saved as a deck ready to play. */
  const MTGJSON = 'https://mtgjson.com/api/v5/';
  /* A deck printed again (Commander Anthology's reprints of older decks)
     is listed once, as its latest printing: one name, one deck
     (MTG.themes.distinct), and a Collector's Edition (the same deck in
     foil and borderless) not at all: the deck it dresses up is there.
     Done to the list itself, so the tab's count, order and search all see
     one. */
  const isCollectors = (p) => /collector'?s?\s*edition/i.test(p.name || '') || /CollectorSEdition/.test(p.file || '');
  const onceEach = (list) => MTG.themes.distinct(list.filter(p => !isCollectors(p)));
  async function preconList() {
    const hit = MTG.store.get('precons', null);
    if (hit && Date.now() - hit.t < 7 * 864e5 && (hit.list || []).length) return onceEach(hit.list);
    const res = await fetch(MTGJSON + 'DeckList.json');
    if (!res.ok) throw new Error('The deck lists could not be loaded.');
    const d = await res.json();
    const list = (d.data || []).filter(x => /commander deck/i.test(x.type || ''))
      .map(x => ({ name: x.name, code: String(x.code || '').toLowerCase(), file: x.fileName, date: x.releaseDate || '' }))
      .sort((a, b) => b.date.localeCompare(a.date));
    MTG.store.set('precons', { t: Date.now(), list });
    return onceEach(list);
  }
  /* A deck's list, fetched once a session (they are small: tens of KB). */
  const deckFiles = new Map();
  function preconFile(p) {
    if (!deckFiles.has(p.file)) {
      deckFiles.set(p.file, fetch(MTGJSON + 'decks/' + encodeURIComponent(p.file) + '.json').then((res) => {
        if (!res.ok) throw new Error('That deck list could not be loaded.');
        return res.json();
      }).then(j => (j && j.data) || {}).catch((e) => { deckFiles.delete(p.file); throw e; }));
    }
    return deckFiles.get(p.file);
  }
  /* ---- who leads a printed deck, what it leans on, how popular it is ----
     Read ahead for the decks printed so far (src/10d4-precons.js, by
     tools/precons.js); a deck printed since is read here from its list
     the first time it is fetched, and remembered on this device. Each is
     [place on EDHREC's list of commanders or 0, [[commander, Scryfall id],
     ...], [tag, ...], colour identity, Scryfall's EDHREC rank or 0]. A deck
     read here has no place on EDHREC's list (it is not to be had from the
     browser), so it goes after the decks that have one. */
  const readMetas = () => MTG.store.get('preconmeta', {}) || {};
  function preconMeta(p) {
    const ahead = MTG.preconIndex && MTG.preconIndex.decks[p.file];
    const fresh = ahead && MTG.preconIndex.v === MTG.themes.VERSION;
    const here = readMetas()[p.file];
    const row = fresh ? ahead : here && here.v === MTG.themes.VERSION ? here.m : ahead || (here && here.m);
    return row ? { rank: row[0] || 0, cmd: row[1] || [], tags: row[2] || [], ident: row[3] != null ? row[3] : null, scry: row[4] || 0 } : null;
  }
  const metaCurrent = (p) => {
    const ahead = MTG.preconIndex && MTG.preconIndex.decks[p.file];
    if (ahead && MTG.preconIndex.v === MTG.themes.VERSION) return true;
    const here = readMetas()[p.file];
    return !!(here && here.v === MTG.themes.VERSION);
  };
  /** A deck's list read for its commander, rank and themes (src/15b-themes.js), and kept. */
  function rememberMeta(p, d) {
    const commanders = d.commander || [];
    const deck = { commanders, main: (d.mainBoard || []).map(c => ({ card: c, qty: Math.max(1, c.count || 1) })) };
    const rank = MTG.themes.rank(commanders);
    const row = [0, commanders.map(c => [c.faceName || U.frontName(c.name), (c.identifiers && c.identifiers.scryfallId) || null]),
      MTG.themes.tags(deck), MTG.themes.identity(commanders), Number.isFinite(rank) ? rank : 0];
    const all = readMetas();
    all[p.file] = { v: MTG.themes.VERSION, m: row };
    MTG.store.set('preconmeta', all);
  }
  /* most popular first: by place on EDHREC's list of commanders; a commander
     not on it after all that are, by Scryfall's rank; one with neither last;
     newest first among equals */
  const rankOf = (p) => {
    const m = preconMeta(p);
    return !m ? 3e6 : m.rank ? m.rank : 1e6 + (m.scry || 1e6);
  };
  const PRECON_SORTS = [
    ['popular', 'Most popular', (a, b) => rankOf(a) - rankOf(b) || b.date.localeCompare(a.date)],
    // by release date, either way
    ['newest', 'Newest first', (a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name)],
    ['oldest', 'Oldest first', (a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name)],
    ['name', 'Name (A\u2013Z)', (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })],
  ];
  /**
   * A tile's commander and themes, once they are known. The whole tile
   * previews the commander under the pointer; a commander's name opens that
   * card in full, rather than the deck.
   */
  function showMeta(p, names, themes, host, onTag) {
    const m = preconMeta(p);
    if (!m || names._shown) return !!m;
    names._shown = true;
    const cards = m.cmd.map(([n, id]) => UI.commanderStub(n, id));
    const look = async (c) => {
      // the preview goes, and the card comes whole from the cache or Scryfall
      if (host) host.dispatchEvent(new PointerEvent('pointerleave'));
      const full = (c.id ? await MTG.scry.byId(c.id, { quiet: true }).catch(() => null) : null) || await MTG.scry.byName(c.name).catch(() => null);
      UI.cardSheet(full || c);
    };
    const box = el('span', { class: 'cmd-names' });
    cards.forEach((c, i) => {
      if (i) box.appendChild(document.createTextNode(' + '));
      box.appendChild(el('span', {
        class: 'cmd-name cmd-look', role: 'button', tabindex: '0', text: U.frontName(c.name), 'aria-label': `Look at ${U.frontName(c.name)}`,
        onclick: (e) => { e.stopPropagation(); look(c); },
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); look(c); } },
      }));
    });
    names.replaceChildren(box);
    // a tag finds the decks like this one; the preview goes as the list changes under it
    themes.replaceChildren(UI.themeLine(m.tags, null, onTag ? (tag) => {
      if (host) host.dispatchEvent(new PointerEvent('pointerleave'));
      onTag(tag);
    } : null));
    if (host && cards[0]) UI.commanderPreview(host, cards[0]);
    return true;
  }
  /* the Featured page's small deck tiles: the same, under the deck's name;
     a tag there opens the Commander decks tab with it searched */
  function preconMiniMeta(tile, p, go) {
    const names = el('div', { class: 'sc-sub mini-cmd' }), themes = el('div', { class: 'mini-themes' });
    tile.append(names, themes);
    const onTag = go ? (tag) => { preconAsk = searchTerm(tag); go('precons'); } : null;
    if (!showMeta(p, names, themes, tile, onTag)) preconInfo(p).then(() => showMeta(p, names, themes, tile, onTag)).catch(() => {});
  }

  /* ---- finding a Commander deck ----
     The search reads words (all of them must be found: in the deck's name,
     its set, its commanders or its themes), "quoted phrases" (a tag such as
     "+1/+1 counters" is put in quotes when it is chosen) and colours. A
     colour named alone, "blue", or chosen with its chip, asks for decks
     that have it, among others: two of them, decks with both. A colour
     identity named in full asks for exactly that one: a guild, shard, wedge
     or four-colour name ("Simic", "Esper", "Glint"), its letters ("WU",
     "BUG"), "mono-red" or "mono red", "colourless", "five-color". */
  let preconAsk = '';
  const searchTerm = (tag) => (/\s/.test(tag) ? `"${tag.toLowerCase()}"` : tag.toLowerCase());
  const COLOR_WORDS = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
  const canonIdent = (s) => ['W', 'U', 'B', 'R', 'G'].filter(c => s.toUpperCase().includes(c)).join('');
  const IDENTITY_NAMES = {
    azorius: 'WU', dimir: 'UB', rakdos: 'BR', gruul: 'RG', selesnya: 'GW', orzhov: 'WB', izzet: 'UR', golgari: 'BG', boros: 'RW', simic: 'GU',
    esper: 'WUB', grixis: 'UBR', jund: 'BRG', naya: 'RGW', bant: 'GWU', abzan: 'WBG', jeskai: 'URW', sultai: 'BGU', mardu: 'RWB', temur: 'GUR',
    glint: 'UBRG', 'glint-eye': 'UBRG', dune: 'WBRG', 'dune-brood': 'WBRG', ink: 'WURG', 'ink-treader': 'WURG',
    witch: 'WUBG', 'witch-maw': 'WUBG', yore: 'WUBR', 'yore-tiller': 'WUBR',
    'five-color': 'WUBRG', 'five-colour': 'WUBRG', '5c': 'WUBRG', rainbow: 'WUBRG', colorless: '', colourless: '',
  };
  /** A search as { terms, exact (an identity, or null), has (colours it must include) }. */
  function readSearch(q) {
    const out = { terms: [], exact: null, has: new Set() };
    const words = [];
    for (const m of String(q || '').toLowerCase().matchAll(/"([^"]+)"|(\S+)/g)) words.push(m[1] != null ? { phrase: m[1].trim() } : { word: m[2] });
    for (let i = 0; i < words.length; i++) {
      const w = words[i].word;
      if (w == null) { if (words[i].phrase) out.terms.push(words[i].phrase); continue; }
      const mono = /^mono-?(white|blue|black|red|green)$/.exec(w);
      const next = words[i + 1] && words[i + 1].word;
      if (mono) out.exact = COLOR_WORDS[mono[1]];
      else if (w === 'mono' && next && COLOR_WORDS[next]) { out.exact = COLOR_WORDS[next]; i++; }
      else if (COLOR_WORDS[w]) out.has.add(COLOR_WORDS[w]);
      else if (Object.prototype.hasOwnProperty.call(IDENTITY_NAMES, w)) out.exact = canonIdent(IDENTITY_NAMES[w]);
      else if (/^[wubrg]{2,5}$/.test(w) && new Set(w).size === w.length) out.exact = canonIdent(w);
      else out.terms.push(w);
    }
    return out;
  }
  /** A deck's cards as its list gives them: name, rarity and how many, enough to price it. */
  const preconRows = (d) => [].concat(d.commander || [], d.mainBoard || [])
    .map(c => ({ name: c.name, rarity: c.rarity, qty: Math.max(1, c.count || 1) }));
  /**
   * What a tile shows: a picture of its own (its commander's, or failing
   * that its rarest other card's whose picture is free; the art crop,
   * straight from the card's Scryfall id) and the rows to price it by.
   */
  async function preconInfo(p) {
    const d = await preconFile(p);
    const RANK = { mythic: 4, special: 4, rare: 3, uncommon: 2, common: 1 };
    const rest = (d.mainBoard || []).filter(c => !/\bLand\b/.test(c.type || ''))
      .sort((a, b) => (RANK[b.rarity] || 0) - (RANK[a.rarity] || 0));
    const pick = [].concat(d.commander || [], d.displayCommander || [], rest).map((c) => {
      const id = c && c.identifiers && c.identifiers.scryfallId;
      return id ? { url: `https://cards.scryfall.io/art_crop/front/${id[0]}/${id[1]}/${id}.jpg`, name: c.name, ill: c.identifiers.scryfallIllustrationId || null } : null;
    });
    const art = claimArt('deck:' + p.file, pick);
    if (!metaCurrent(p)) rememberMeta(p, d);
    return { art: art ? art.url : null, rows: preconRows(d) };
  }
  /** A deck's cards, as Scryfall prints them: the commanders, the rest, and all of it with counts. */
  async function preconCards(p) {
    const d = await preconFile(p);
    const rows = [].concat((d.commander || []).map(c => ({ c, cmd: true })), (d.mainBoard || []).map(c => ({ c })));
    const idents = rows.map(({ c }) => (c.identifiers && c.identifiers.scryfallId ? { id: c.identifiers.scryfallId } : { name: c.name }));
    // in the order asked, with a gap for any not found
    const found = ((await MTG.scry.collection(idents)) || {}).cards || [];
    const commanders = [], main = [], all = [];
    rows.forEach(({ c, cmd }, i) => {
      const card = found[i];
      if (!card) return;
      const qty = Math.max(1, c.count || 1);
      all.push({ card, qty });
      if (cmd) commanders.push(card); else main.push({ card, qty });
    });
    if (!all.length) throw new Error('The cards of that deck could not be found.');
    return { commanders, main, all, missing: rows.length - all.length };
  }
  async function preconsTab(body) {
    const S = E();
    const lead = el('p', { class: 'dim', text: 'Loading the deck lists…' });
    body.append(lead);
    let list;
    try { list = await preconList(); }
    catch (e) { lead.textContent = 'The deck lists could not be loaded. Check the connection.'; return; }
    const blurb = 'Every Commander deck as printed, the most popular commanders first. A deck costs less than the wildcards for its cards would, and the cards you already own come off the price. Its cards go into your collection, and you can save it as a deck ready to play.';
    lead.textContent = blurb;
    const sets = await MTG.scry.sets().catch(() => []);
    const setName = (c) => (sets.find(s => s.code === c) || {}).name || c.toUpperCase();
    /* a deck printed since the decks were read ahead has no rank yet: the
       newest few are read now, so they take their places in the order */
    const unread = list.filter(p => !preconMeta(p)).slice(0, 12);
    if (unread.length) {
      lead.textContent = 'Reading the newest decks…';
      let at = 0;
      const next = async () => { while (at < unread.length) { const p = unread[at++]; await preconInfo(p).catch(() => {}); } };
      await Promise.all([next(), next(), next(), next()]);
      lead.textContent = blurb;
    }
    let sortKey = PRECON_SORTS.some(x => x[0] === MTG.settings.preconSort) ? MTG.settings.preconSort : 'popular';
    const sortSel = el('select', { 'aria-label': 'Sort Commander decks by' },
      PRECON_SORTS.map(([k, label]) => el('option', { value: k, text: label, selected: k === sortKey })));
    sortSel.addEventListener('change', () => { sortKey = sortSel.value; MTG.setSetting('preconSort', sortKey); draw(); });
    const search = el('input', { type: 'search', placeholder: 'Find a deck, a commander, a theme or colours…', class: 'store-search',
      'aria-label': 'Find a Commander deck', value: preconAsk,
      title: 'Every word must be found. Colours: "blue" for decks with blue in them; "Simic", "WU", "mono-red" or "colourless" for exactly those colours.' });
    preconAsk = '';
    // a tag chosen on a tile joins the search, unless it is there already
    const addTag = (tag) => {
      const term = searchTerm(tag);
      if (!readSearch(search.value).terms.includes(term.replace(/"/g, ''))) search.value = (search.value.trim() + ' ' + term).trim();
      MTG.sfx('click');
      draw();
    };
    /* colour chips: each one asks for decks with that colour (all of those
       chosen); Colourless, for decks with none */
    const chosen = new Set();
    let colourless = false;
    const chips = el('div', { class: 'filter-chips precon-colors', role: 'group', 'aria-label': 'Colours' });
    const drawChips = () => {
      chips.replaceChildren(...['W', 'U', 'B', 'R', 'G', 'C'].map((c) => {
        const on = c === 'C' ? colourless : chosen.has(c);
        const name = c === 'C' ? 'Colourless' : MTG.mana.COLOR_NAMES[c];
        return el('button', { type: 'button', class: 'chip pip-chip' + (on ? ' on' : ''), 'aria-pressed': on ? 'true' : 'false',
          title: c === 'C' ? 'Colourless decks' : `Decks with ${name} in them`, 'aria-label': name,
          onclick: () => {
            if (c === 'C') { colourless = !colourless; if (colourless) chosen.clear(); }
            else { if (chosen.has(c)) chosen.delete(c); else chosen.add(c); colourless = false; }
            drawChips(); draw();
          } }, [UI.pips(c === 'C' ? [] : [c])]);
      }));
    };
    drawChips();
    const grid = el('div', { class: 'store-grid precons' });
    /* each tile's commander and price, fetched as it comes into view, a few at a time */
    let busy = 0;
    const waiting = [];
    const pump = () => {
      while (busy < 4 && waiting.length) {
        const tile = waiting.shift();
        busy++;
        preconInfo(tile._precon.p).then((info) => {
          if (info.art) tile._precon.art.style.backgroundImage = 'url("' + info.art + '")';
          tile._precon.art.classList.add('face');
          tile._showMeta();
          tile._rows = info.rows;
          tile._reprice();
        }).catch(() => {}).finally(() => { busy--; pump(); });
      }
    };
    // what you own changes the prices: each tile shown says again what it costs
    const off = MTG.bus.on('economy:changed', () => {
      if (!grid.isConnected) { off(); return; }
      for (const t of grid.children) if (t._reprice) t._reprice();
    });
    const seen = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        seen.unobserve(en.target);
        waiting.push(en.target);
        pump();
      }
    }, { rootMargin: '200px' });
    /* Pages: whole rows of tiles, about two dozen to a page at as many
       columns as the width holds, counted again when the width changes. A
       pager over the grid and under it; turning a page brings the top of
       the grid into view, the tabs above it staying where they are. */
    let page = 0, hits = [], perPage = 24;
    const pageSize = () => {
      const cols = Math.max(1, Math.floor(((grid.clientWidth || body.clientWidth || 960) + 16) / (220 + 16)));
      return cols * Math.max(1, Math.round(24 / cols));
    };
    const pagers = [el('nav', { class: 'precon-pager', 'aria-label': 'Pages of decks' }), el('nav', { class: 'precon-pager foot', 'aria-label': 'Pages of decks' })];
    const tools = el('div', { class: 'precon-tools' });
    const turnTo = (n) => {
      page = n;
      drawPage();
      MTG.sfx('click');
      // only ever up, to the search over the grid: the page turned from above is already in view
      const view = tools.closest('.screen');
      if (tools.getBoundingClientRect().top < (view ? view.getBoundingClientRect().top : 0)) tools.scrollIntoView({ block: 'start' });
    };
    const drawPager = (nav, pages, from) => {
      const shown = hits.length ? `Showing ${from + 1}\u2013${Math.min(hits.length, from + perPage)} of ${hits.length}` : '';
      const kids = [];
      if (pages > 1) {
        kids.push(el('button', { type: 'button', class: 'btn xs', text: '\u2039 Previous', disabled: page === 0, onclick: () => turnTo(page - 1) }));
        // the first and last pages, and those either side of this one; a gap for the rest
        const want = [...new Set([0, page - 1, page, page + 1, pages - 1])].filter(n => n >= 0 && n < pages).sort((a, b) => a - b);
        want.forEach((n, i) => {
          if (i && n - want[i - 1] > 1) kids.push(el('span', { class: 'pager-gap', text: '\u2026', 'aria-hidden': 'true' }));
          kids.push(el('button', { type: 'button', class: 'chip pager-n' + (n === page ? ' on' : ''), text: String(n + 1),
            'aria-label': `Page ${n + 1}`, 'aria-current': n === page ? 'page' : false, onclick: () => { if (n !== page) turnTo(n); } }));
        });
        kids.push(el('button', { type: 'button', class: 'btn xs', text: 'Next \u203a', disabled: page >= pages - 1, onclick: () => turnTo(page + 1) }));
      }
      kids.push(el('span', { class: 'pager-count dim', text: shown }));
      nav.replaceChildren(...kids);
      nav.hidden = !hits.length;
    };
    const drawPage = () => {
      grid.innerHTML = '';
      const pages = Math.max(1, Math.ceil(hits.length / perPage));
      page = Math.max(0, Math.min(page, pages - 1));
      const from = page * perPage;
      for (const p of hits.slice(from, from + perPage)) {
        const tile = preconTile(p, setName(p.code), addTag);
        tile._precon = { p, art: tile.querySelector('.precon-art') };
        grid.appendChild(tile);
        seen.observe(tile);
      }
      if (!hits.length) grid.appendChild(el('p', { class: 'dim', text: 'No deck like that.' }));
      for (const nav of pagers) drawPager(nav, pages, from);
    };
    if (window.ResizeObserver) {
      const ro = new ResizeObserver(() => {
        if (!grid.isConnected) { ro.disconnect(); return; }
        const size = pageSize();
        if (size === perPage) return;
        // the first deck shown stays on the page shown
        page = Math.floor(page * perPage / size);
        perPage = size;
        drawPage();
      });
      ro.observe(grid);
    }
    // a new search, colour, tag or order starts again at the first page
    const draw = () => {
      const ask = readSearch(search.value);
      for (const c of chosen) ask.has.add(c);
      if (colourless) ask.exact = '';
      // every word by name, set, commander or theme; the colours by the commanders' identity
      const about = (p) => {
        const m = preconMeta(p);
        return [p.name, setName(p.code), p.code].concat(m ? m.cmd.map(c => c[0]).concat(m.tags) : []).join(' \n ').toLowerCase();
      };
      const colours = (p) => {
        if (ask.exact == null && !ask.has.size) return true;
        const m = preconMeta(p);
        if (!m || m.ident == null) return false;
        return (ask.exact == null || m.ident === ask.exact) && [...ask.has].every(c => m.ident.includes(c));
      };
      hits = list.filter(p => colours(p) && (!ask.terms.length || ((text) => ask.terms.every(w => text.includes(w)))(about(p))))
        .sort((PRECON_SORTS.find(x => x[0] === sortKey) || PRECON_SORTS[0])[2]);
      page = 0;
      drawPage();
    };
    search.addEventListener('input', draw);
    tools.append(search, chips, el('label', { class: 'sort-field' }, [el('span', { text: 'Sort' }), sortSel]));
    body.append(tools, pagers[0], grid, pagers[1]);
    perPage = pageSize();
    draw();
  }
  function preconTile(p, setName, onTag) {
    // its own picture at once when it has one; a plain panel until then, never another's
    const art = el('div', { class: 'precon-art' });
    const had = artReg.by['deck:' + p.file];
    if (had) art.style.backgroundImage = 'url("' + had.url + '")';
    const btn = el('button', { type: 'button', class: 'btn primary buy', html: shardSvg() + ' \u2026', 'aria-label': 'Buy ' + p.name });
    const owns = el('div', { class: 'precon-owns dim' });
    const names = el('div', { class: 'precon-cmd' }), themes = el('div', { class: 'precon-themes' });
    btn.addEventListener('click', (e) => { e.stopPropagation(); buyPrecon(p, btn); });
    const tile = el('div', { class: 'store-card precon-tile', role: 'button', tabindex: '0',
      title: `Look through ${p.name}`, 'aria-label': `${p.name}: look through the deck` }, [
      art,
      el('div', { class: 'sc-title', text: p.name }),
      el('div', { class: 'sc-sub dim', text: `${setName}${p.date ? ' · ' + p.date.slice(0, 4) : ''}`, title: `${setName}${p.date ? ', ' + p.date.slice(0, 4) : ''}` }),
      // who leads it and what it leans on, the commander previewed over its name and its picture
      names,
      themes,
      owns,
      el('div', { class: 'precon-buy' }, [btn]),
    ]);
    // the rest of the tile opens the deck, laid out as it would be built
    tile.addEventListener('click', () => inspectPrecon(p));
    tile.addEventListener('keydown', (e) => {
      if ((e.key === 'Enter' || e.key === ' ') && e.target === tile) { e.preventDefault(); inspectPrecon(p); }
    });
    tile._showMeta = () => showMeta(p, names, themes, tile, onTag);
    tile._showMeta();
    // its price for you, and what you have of it already, once its list is in
    tile._reprice = () => {
      if (!tile._rows) return;
      const pr = E().deckPrice(tile._rows);
      const all = pr.owned >= pr.cards;
      // every card of it yours: nothing to pay, and it can still be saved as a deck
      btn.innerHTML = all ? 'Save as a deck' : shardSvg() + ' ' + fmtN(pr.price);
      btn.classList.toggle('primary', !all);
      const was = btn.parentNode.querySelector('.precon-was');
      if (was) was.remove();
      if (!all && pr.price < pr.full) btn.after(el('s', { class: 'precon-was dim', text: fmtN(pr.full) }));
      // as a share, never rounded up to all of it while a card is missing
      const pct = all ? 100 : Math.min(99, Math.round(pr.owned / Math.max(1, pr.cards) * 100));
      owns.textContent = all ? 'All of it in your collection' : `${pct}% in your collection`;
      owns.title = `You own ${pr.owned} of its ${pr.cards} cards, basic lands aside (they are free)`;
    };
    return tile;
  }
  async function buyPrecon(p, btn, have) {
    const S = E();
    let deck = have;
    if (!deck) {
      const busy = UI.busy('Commander deck', `Fetching the list of ${p.name}…`);
      try { deck = await preconCards(p); }
      catch (e) { busy.close(); return UI.error(e.message || String(e)); }
      busy.close();
    }
    const pr = S.deckPrice(deck.all.map(e => ({ name: e.card.name, rarity: e.card.rarity, qty: e.qty })));
    // everything in it yours already: nothing to buy, but it can still be saved as a deck
    if (pr.owned >= pr.cards) return preconBought(p, deck, { ok: true, cards: pr.cards, fresh: 0, price: 0 });
    const face = deck.commanders[0] || (deck.main[0] || {}).card;
    let got = null;
    UI.purchaseDialog({
      title: p.name, sub: 'Commander deck', from: btn, cost: pr.price,
      visual: face ? el('div', { class: 'precon-fly' }, [UI.cardImage(face, 'normal', 0)]) : null,
      buy: () => (got = S.buyDeck(deck)),
      after: () => preconBought(p, deck, got),
    });
  }
  /* A card's place in a built deck: the first of these its front face is. */
  const STACKS = [['Creature', 'Creatures'], ['Planeswalker', 'Planeswalkers'], ['Battle', 'Battles'], ['Instant', 'Instants'],
    ['Sorcery', 'Sorceries'], ['Artifact', 'Artifacts'], ['Enchantment', 'Enchantments'], ['Land', 'Lands']];
  const stackOf = (c) => {
    const t = String((c.card_faces && c.card_faces[0] && c.card_faces[0].type_line) || c.type_line || '');
    const hit = STACKS.find(([k]) => new RegExp('\\b' + k + '\\b').test(t));
    return hit ? hit[0] : 'Other';
  };
  const PER_STACK = 12;

  /**
   * A Commander deck looked through before it is bought, laid out the way
   * it sits built on a table: its commander at full size, the rest in
   * overlapping stacks by type, cheapest at the top, each one read with a
   * click. Beside it, its bracket, its curve and colours and what of it you
   * own, with a switch to mark the cards new to you; under it, the button
   * to buy it.
   */
  async function inspectPrecon(p) {
    const busy = UI.busy('Commander deck', `Laying out ${p.name}…`);
    let deck, sets;
    try { [deck, sets] = await Promise.all([preconCards(p), MTG.scry.sets().catch(() => [])]); }
    catch (e) { busy.close(); return UI.error(e.message || String(e)); }
    busy.close();
    const S = E();
    const built = { name: p.name, format: 'commander', commanders: deck.commanders, main: deck.main, sideboard: [] };
    const setName = (sets.find(s => s.code === p.code) || {}).name || p.code.toUpperCase();
    const isNew = (c) => !S.isBasic(c.name) && S.owned(c.name) < 1;

    const dvCard = (card, qty, big) => {
      const b = el('button', { type: 'button', class: 'dv-card' + (big ? ' big' : ''), 'aria-label': `${qty > 1 ? qty + ' ' : ''}${card.name}` }, [
        UI.cardImage(card, big ? 'large' : 'normal', 0),
        qty > 1 ? el('span', { class: 'dv-qty', text: '\u00d7' + qty }) : null,
        isNew(card) ? el('span', { class: 'dv-new', text: 'new', title: 'Not in your collection yet' }) : null,
      ].filter(Boolean));
      // each card knows what it is, so a purchase can take its "new" away
      b._card = card;
      b.addEventListener('click', () => UI.cardSheet(card));
      UI.attachPreview(b, card, 0);
      return b;
    };

    // the stacks: by type, cheapest first, a long one carried on in the next column
    const groups = new Map();
    for (const e of UI.sortCards(deck.main, 'cmc')) {
      const k = stackOf(e.card);
      if (!groups.has(k)) groups.set(k, []);
      groups.get(k).push(e);
    }
    const order = STACKS.map(x => x[0]).concat(['Other']);
    const stacks = el('div', { class: 'dv-stacks' });
    for (const k of order) {
      const list = groups.get(k);
      if (!list || !list.length) continue;
      const n = U.sum(list.map(e => e.qty));
      const label = (STACKS.find(x => x[0] === k) || [k, 'Other'])[1];
      for (let i = 0; i < list.length; i += PER_STACK) {
        stacks.appendChild(el('div', { class: 'dv-col' }, [
          el('div', { class: 'dv-head' + (i ? ' more' : ''), text: i ? '' : `${label} \u00b7 ${n}` }),
          el('div', { class: 'dv-pile' }, list.slice(i, i + PER_STACK).map(e => dvCard(e.card, e.qty))),
        ]));
      }
    }

    // beside it: the commander, and the deck in numbers
    const curve = [0, 0, 0, 0, 0, 0, 0, 0];
    let lands = 0;
    for (const e of deck.main) {
      if (stackOf(e.card) === 'Land') { lands += e.qty; continue; }
      curve[Math.min(7, Math.floor(e.card.cmc || 0))] += e.qty;
    }
    const top = Math.max(1, ...curve);
    const ident = [...new Set(deck.commanders.flatMap(c => c.color_identity || []))];
    const WUBRG = ['W', 'U', 'B', 'R', 'G'];
    const owned = el('div', { class: 'dv-owned small' });
    // the deck as built, unmarked; a switch marks the cards you do not have yet
    const markNew = el('button', { type: 'button', class: 'btn xs dv-mark', 'aria-pressed': 'false', text: 'Mark the cards new to me' });
    markNew.addEventListener('click', () => {
      const on = body.classList.toggle('marking');
      markNew.setAttribute('aria-pressed', on ? 'true' : 'false');
      markNew.classList.toggle('primary', on);
    });
    const buy = el('button', { type: 'button', class: 'btn primary dv-buy' });
    const was = el('s', { class: 'dim dv-was' });
    const reprice = () => {
      const pr = S.deckPrice(deck.all.map(e => ({ name: e.card.name, rarity: e.card.rarity, qty: e.qty })));
      const all = pr.owned >= pr.cards;
      buy.innerHTML = all ? 'Save as a deck' : `Buy the deck \u00b7 ${shardSvg()} ${fmtN(pr.price)}`;
      was.textContent = !all && pr.price < pr.full ? fmtN(pr.full) : '';
      const fresh = new Set(deck.all.filter(e => isNew(e.card)).map(e => e.card.name)).size;
      owned.textContent = all ? 'Every card of it is in your collection.'
        : `You own ${pr.owned} of its ${pr.cards} cards; ${fresh} ${fresh === 1 ? 'is' : 'are'} new to you.`;
      markNew.hidden = all;
      for (const n of body.querySelectorAll('.dv-card')) {
        const tag = n.querySelector('.dv-new');
        if (tag && n._card && !isNew(n._card)) tag.remove();
      }
    };
    buy.addEventListener('click', () => buyPrecon(p, buy, deck));

    const side = el('aside', { class: 'dv-side' }, [
      el('div', { class: 'dv-cmds' + (deck.commanders.length > 1 ? ' two' : '') }, deck.commanders.map(c => dvCard(c, 1, true))),
      el('div', { class: 'dv-facts' }, [
        el('div', { class: 'row', style: { gap: '8px', flexWrap: 'wrap', alignItems: 'center' } }, [
          UI.bracketPill ? UI.bracketPill(built) : null,
          ident.length ? el('span', { class: 'dv-ident', html: MTG.mana.html(WUBRG.filter(x => ident.includes(x)).map(x => `{${x}}`).join('')) }) : el('span', { class: 'tiny dim', text: 'Colourless' }),
        ].filter(Boolean)),
        UI.themeLine(MTG.themes.tags(built), 'dv-themes'),
        el('div', { class: 'tiny dim', text: `${U.sum(deck.all.map(e => e.qty))} cards \u00b7 ${lands} lands \u00b7 ${setName}${p.date ? ', ' + p.date.slice(0, 4) : ''}` }),
        el('div', { class: 'dv-curve', title: 'Mana curve: spells by mana value' }, curve.map((v, i) => el('div', { class: 'dv-bar' }, [
          el('i', { style: { height: Math.round(v / top * 100) + '%' } }),
          el('b', { text: v ? String(v) : '' }),
          el('span', { text: i === 7 ? '7+' : String(i) }),
        ]))),
        owned,
        markNew,
        deck.missing ? el('div', { class: 'tiny dim', text: `${deck.missing} of its cards could not be found.` }) : null,
      ].filter(Boolean)),
    ]);
    const body = el('div', { class: 'deck-view' }, [side, stacks]);
    reprice();
    const m = UI.modal({ title: p.name, width: '1100px', className: 'deck-view-modal', art: deck.commanders[0] || null, content: body });
    // buying it is always in reach, however far down the stacks go
    m.foot.classList.remove('empty');
    m.foot.append(el('div', { class: 'dv-buyrow' }, [was, buy]));
    const off = MTG.bus.on('economy:changed', () => { if (!body.isConnected) { off(); return; } reprice(); });
    return m;
  }

  /** What the deck brought, and the deck saved if you want it. */
  async function preconBought(p, deck, got) {
    if (!got || !got.ok) return;
    const said = (got.price ? `${got.cards} cards: ${got.fresh} new to your collection.` : `You have every card of it already.`) +
      (deck.missing ? ` (${deck.missing} could not be found.)` : '');
    if (!await UI.confirm(said + ' Save it as a deck, ready to play?', p.name, { yes: 'Save the deck', no: 'Not now' })) return;
    MTG.decks.save({ id: MTG.uid('deck'), name: p.name, format: 'commander', main: deck.main, sideboard: [], commanders: deck.commanders });
    UI.ok(`"${p.name}" is in your decks.`);
  }

  function packTile(s, extra) {
    const S = E();
    // a richer set's packs: priced once it is known what they hold
    if (S.needsAppraisal(s)) {
      const tile = el('div', { class: 'store-card pack-tile' }, [
        boosterEl(s, 'play'),
        el('div', { class: 'sc-title', text: s.name }),
        el('div', { class: 'pack-notes' }, [el('span', { class: 'pack-tag', text: 'Pricing…' })]),
      ]);
      S.appraise(s).catch(() => 1).then(() => { if (tile.isConnected) tile.replaceWith(packTile(s, extra)); });
      return tile;
    }
    const rich = S.packPrice(s, 'play') > S.PRICES.pack;
    const notes = [
      s.digital ? el('span', { class: 'pack-tag', text: 'Digital', title: 'Printed for Magic Online or Arena, never on paper' }) : null,
      rich ? el('span', { class: 'pack-tag bonus', text: 'Rarer cards', title: 'Never sold in ordinary boosters, its packs hold rarer cards than most, and cost accordingly' }) : null,
      extra ? el('span', { class: 'pack-tag bonus', text: '+ ' + extra.short, title: extra.long }) : null,
    ].filter(Boolean);
    // the pack and its name open it up, to see what it holds; the buttons buy
    const look = el('button', { type: 'button', class: 'pack-look', title: `What is in a ${s.name} pack`, 'aria-label': `What is in a ${s.name} pack`,
      onclick: () => packPreview(s, 'play') }, [boosterEl(s, 'play', { lazy: true }), el('div', { class: 'sc-title', text: s.name })]);
    return el('div', { class: 'store-card pack-tile' }, [
      look,
      notes.length ? el('div', { class: 'pack-notes' }, notes) : null,
      // Collector Boosters only where they were made, or could be (see hasCollector)
      el('div', { class: 'pack-buys' }, [buyBtn(s, 'play', 1), buyBtn(s, 'play', 10), S.hasCollector(s) ? buyBtn(s, 'collector', 1) : null].filter(Boolean)),
    ].filter(Boolean));
  }
  /** "Commander cards", "Alchemy cards": what else a set's packs may hold, from the sets folded into it. */
  function extrasNote(kids, all) {
    if (!kids || !kids.length) return null;
    const info = kids.map(c => all.find(s => s.code === c) || { code: c, name: c.toUpperCase() });
    const kinds = new Set(info.map(s => s.set_type === 'commander' ? 'Commander' : s.set_type === 'alchemy' ? 'Alchemy'
      : s.set_type === 'eternal' ? 'Eternal' : s.digital ? 'digital' : 'bonus'));
    // two kinds named ("Commander & Eternal cards"); more than that, or unnamed ones, are bonus cards
    const named = [...kinds].filter(k => k !== 'bonus' && k !== 'digital');
    const short = kinds.size === 1 ? `${[...kinds][0]} cards`
      : named.length === kinds.size && named.length === 2 ? `${named.join(' & ')} cards` : 'bonus cards';
    return { short: short.charAt(0).toUpperCase() + short.slice(1), long: 'Now and then, one of the new cards from ' + info.map(s => s.name).join(', ') + '.' };
  }

  async function packsTab(body) {
    const sets = await MTG.scry.packSets().catch(() => []);
    const hosts = await MTG.scry.packHosts().catch(() => new Map());
    const all = await MTG.scry.sets().catch(() => []);
    if (!sets.length) { body.appendChild(el('p', { class: 'dim', text: 'The sets could not be loaded.' })); return; }
    const search = el('input', { type: 'search', placeholder: 'Find a set…', class: 'store-search', 'aria-label': 'Find a set' });
    // the regular sets first, newest first; the Eternal sets (Assassin's Creed and its like) after them
    const grid = el('div', { class: 'store-grid packs' });
    const eternalHead = el('h3', { class: 'store-sub', text: 'Eternal sets' });
    const eternalBlurb = el('p', { class: 'dim small', text: 'Sets made for the formats that use every card, rather than for Standard.' });
    const eternalGrid = el('div', { class: 'store-grid packs' });
    const draw = () => {
      const q = search.value.trim().toLowerCase();
      grid.innerHTML = ''; eternalGrid.innerHTML = '';
      let eternal = 0;
      for (const s of sets.filter(x => !q || x.name.toLowerCase().includes(q) || x.code === q)) {
        const isEternal = s.set_type === 'eternal';
        if (isEternal) eternal++;
        (isEternal ? eternalGrid : grid).appendChild(packTile(s, extrasNote(hosts.get(s.code), all)));
      }
      eternalHead.hidden = eternalBlurb.hidden = eternalGrid.hidden = !eternal;
    };
    search.addEventListener('input', draw);
    body.append(search, grid, eternalHead, eternalBlurb, eternalGrid);
    draw();
  }

  /* ---------------- what is in a pack ----------------
     A set's pack looked into before it is bought: what each slot holds and
     how often, the rarities to expect, and every card it can hold, the
     most valuable first, each with its chance of being in a pack (by the
     odds the packs are made with, MTG.draft.packOdds). */
  const PV_ORDER = ['mythic', 'rare', 'uncommon', 'common'];
  const PV_RAR = { mythic: 'Mythic', rare: 'Rare', uncommon: 'Uncommon', common: 'Common' };
  const pctOf = (p) => (p >= 0.995 ? '100%' : p >= 0.01 ? +(p * 100).toFixed(1) + '%' : +(p * 100).toFixed(2) + '%');
  /** "in every pack", "1 in 3 packs", "1 in 1,240 packs". */
  const oddsOf = (p) => (p >= 0.995 ? 'every pack' : p >= 0.5 ? `${Math.round(p * 100)}% of packs` : `1 in ${fmtN(Math.max(2, Math.round(1 / Math.max(p, 1e-6))))} packs`);
  /** A slot of a pack, in words: "3 uncommons", "1 foil wildcard: …". */
  function slotWords(sl) {
    const mixText = Object.entries(sl.mix).filter(([, p]) => p > 0).sort((a, b) => b[1] - a[1])
      .map(([r, p]) => `${PV_RAR[r] || r} ${pctOf(p)}`).join(', ');
    const foil = sl.foil ? 'foil ' : '';
    const many = sl.n > 1;
    switch (sl.pick) {
      case 'common': case 'commonOrList': case 'commonOrLand': return `${sl.n} ${foil}common${many ? 's' : ''}`;
      case 'uncommon': return `${sl.n} ${foil}uncommon${many ? 's' : ''}`;
      case 'variantUncommon': return `${sl.n} ${foil}uncommon${many ? 's' : ''} in a special printing`;
      case 'rareMythic': return `${sl.n} ${foil}rare or mythic (${mixText})`;
      case 'variantRare': return `${sl.n} ${foil}rare or mythic in a special printing (${mixText})`;
      case 'wildcard': return `${sl.n} ${foil}card of any rarity (${mixText})`;
      case 'land': return `${sl.n} ${foil}card in place of the basic land (${mixText})`;
    }
    return `${sl.n} ${foil}card${many ? 's' : ''}`;
  }

  async function packPreview(s, kind) {
    const S = E();
    const D = MTG.draft;
    kind = kind === 'collector' && S.hasCollector(s) ? 'collector' : 'play';
    const busy = UI.busy(s.name, 'Looking into the pack…');
    let pool, bonus, variants;
    try {
      [pool, bonus, variants] = await Promise.all([
        MTG.scry.setPool(s.code),
        MTG.scry.packExtras(s.code).catch(() => null),
        kind === 'collector' ? MTG.scry.setVariants(s.code).catch(() => null) : Promise.resolve(null),
      ]);
    } catch (e) { busy.close(); return UI.error(e.message || String(e)); }
    busy.close();
    if (!pool || !pool.all || pool.all.length < 20) return UI.error(`The cards of ${s.name} could not be loaded.`);
    const spec = kind === 'collector' ? D.COLLECTOR_BOOSTER : D.boosterSpecFor(s);
    const odds = D.packOdds(spec, pool, { bonus, variants });

    // every card it can hold, with its chance and its worth
    const rarOf = (c) => (PV_ORDER.includes(c.rarity) ? c.rarity : c.rarity === 'special' || c.rarity === 'bonus' ? 'mythic' : 'common');
    const seen = new Set();
    const items = [];
    const add = (c, folded) => {
      if (!c || S.isBasic(c.name) || seen.has(c.name)) return;
      seen.add(c.name);
      items.push({ card: c, rarity: rarOf(c), folded, chance: odds.chance(rarOf(c), folded), value: S.cardValue({ card: c }) });
    };
    for (const c of pool.all) add(c, false);
    for (const c of (bonus && bonus.all) || []) add(c, true);
    items.sort((a, b) => (b.value - a.value) || (PV_ORDER.indexOf(a.rarity) - PV_ORDER.indexOf(b.rarity)) || a.card.name.localeCompare(b.card.name));

    /* -- beside the cards: the pack, its price, what is in it -- */
    const side = el('aside', { class: 'pv-side' }, [
      el('div', { class: 'pv-pack' }, [boosterEl(s, kind, { big: true })]),
      S.hasCollector(s) ? el('div', { class: 'pv-kind', role: 'radiogroup', 'aria-label': 'Kind of booster' }, [['play', 'Play Booster'], ['collector', 'Collector']].map(([k, label]) =>
        el('button', { type: 'button', role: 'radio', class: 'chip' + (kind === k ? ' on' : ''), 'aria-checked': kind === k ? 'true' : 'false', text: label,
          onclick: () => { if (k !== kind) { m.close(); packPreview(s, k); } } }))) : null,
      el('div', { class: 'pv-buys' }, kind === 'collector' ? [buyBtn(s, 'collector', 1)] : [buyBtn(s, 'play', 1), buyBtn(s, 'play', 10)]),
      el('div', { class: 'tiny dim', text: `${s.name}${s.released_at ? ', ' + s.released_at.slice(0, 4) : ''} \u00b7 ${spec.size} cards a pack` }),
      el('section', { class: 'pv-block' }, [
        el('h4', { text: 'In every pack' }),
        el('ul', { class: 'pv-slots' }, odds.slots.map(sl => el('li', { text: slotWords(sl) }))),
      ]),
      el('section', { class: 'pv-block' }, [
        el('h4', { text: 'The rarities' }),
        el('div', { class: 'pv-rar' }, PV_ORDER.filter(r => odds.expect[r] > 0).map(r => el('div', { class: 'pv-rar-row r-' + r }, [
          el('i', { class: 'pv-gem', 'aria-hidden': 'true' }),
          el('b', { text: PV_RAR[r] }),
          el('span', { class: 'grow', text: `${+odds.expect[r].toFixed(2)} a pack` }),
          el('span', { class: 'dim', text: odds.atLeast[r] >= 0.995 ? 'in every pack' : `in ${pctOf(odds.atLeast[r])} of packs` }),
        ])).concat(odds.atLeast.rarePlus >= 0.995 ? [el('div', { class: 'pv-rar-row tiny dim', text: 'A rare or a mythic in every pack.' })] : [])),
      ]),
      el('ul', { class: 'pv-notes tiny dim' }, [
        bonus && bonus.all && bonus.all.length ? el('li', { text: `Now and then a card folded in from another set takes a slot (${pctOf(D.BONUS_RATE.rareMythic)} of rares, less often in the others); those are marked "extra" below.` }) : null,
        (s.released_at || '9999') >= '2003-07-28' && kind !== 'collector' ? el('li', { text: `About ${pctOf(S.VINTAGE_RATE)} of packs have a card in an old-frame printing.` }) : null,
        el('li', { text: 'A rare or mythic you already have four of comes as one of the set\u2019s you have not, while there are any.' }),
      ].filter(Boolean)),
    ].filter(Boolean));

    /* -- the cards, the most valuable first, a page at a time -- */
    let rarOn = null;
    const chips = el('div', { class: 'search-chips pv-chips' });
    const grid = el('div', { class: 'pv-grid' });
    const more = el('div', { class: 'search-more' });
    const count = el('span', { class: 'tiny dim' });
    let list = items, shown = 0;
    const PAGE = 48;
    const tile = (it) => {
      const own = S.owned(it.card.name);
      const t = el('button', { type: 'button', class: 'pv-card r-' + it.rarity + (it.folded ? ' folded' : ''), 'aria-label': it.card.name }, [
        el('div', { class: 'pv-img' }, [UI.cardImage(it.card, 'normal', 0)]),
        el('div', { class: 'pv-meta' }, [
          el('i', { class: 'pv-gem', title: PV_RAR[it.rarity], 'aria-hidden': 'true' }),
          el('b', { class: 'pv-price', text: it.value ? '$' + (it.value >= 100 ? Math.round(it.value).toLocaleString() : it.value.toFixed(2)) : '\u2014' }),
          el('span', { class: 'pv-odds', text: oddsOf(it.chance), title: `About ${pctOf(it.chance)} of packs` }),
        ]),
        it.folded ? el('span', { class: 'pv-tag', text: 'extra', title: 'Folded in from another set: it takes a slot now and then' }) : null,
        own ? el('span', { class: 'pv-own', text: own === Infinity ? 'free' : '\u00d7' + Math.min(own, 4), title: `You own ${Math.min(own, 4)}` }) : null,
      ].filter(Boolean));
      t.addEventListener('click', () => UI.cardSheet(it.card));
      UI.attachPreview(t, it.card, 0);
      return t;
    };
    const page = () => {
      const next = list.slice(shown, shown + PAGE);
      for (const it of next) grid.insertBefore(tile(it), more);
      shown += next.length;
      more.textContent = shown < list.length ? 'Scroll for more' : '';
    };
    const draw = () => {
      list = rarOn ? items.filter(it => it.rarity === rarOn) : items;
      grid.innerHTML = '';
      grid.appendChild(more);
      shown = 0;
      page();
      count.textContent = `${list.length} card${list.length === 1 ? '' : 's'}, the most valuable first`;
      chips.innerHTML = '';
      chips.append(...[[null, 'All']].concat(PV_ORDER.filter(r => items.some(it => it.rarity === r)).map(r => [r, PV_RAR[r]])).map(([r, label]) =>
        el('button', { type: 'button', class: 'chip' + (rarOn === r ? ' on' : ''), 'aria-pressed': rarOn === r ? 'true' : 'false', text: label,
          onclick: () => { rarOn = r; draw(); } })), el('span', { class: 'grow' }), count);
    };
    const seen2 = new IntersectionObserver((en) => { if (en.some(e => e.isIntersecting) && shown < list.length) { page(); seen2.unobserve(more); seen2.observe(more); } }, { rootMargin: '400px' });
    draw();
    const main = el('div', { class: 'pv-main' }, [chips, grid]);
    const body = el('div', { class: 'pack-view' }, [side, main]);
    const m = UI.modal({ title: `${s.name}: ${kind === 'collector' ? 'Collector Booster' : spec.id === 'play' ? 'Play Booster' : 'Draft Booster'}`, width: '1100px', className: 'pack-view-modal', content: body });
    seen2.observe(more);
    const off = MTG.bus.on('economy:changed', () => { if (!body.isConnected) { off(); seen2.disconnect(); } });
    return m;
  }

  /** Today's deals, the first time they are asked for: a mythic and two rares from recent sets. */
  async function makeDeals() {
    const sets = (await MTG.scry.draftableSets()).slice(0, 6);
    const code = (i) => sets[i % sets.length].code;
    const pick = async (q) => { const r = await MTG.scry.search(q, { max: 40, order: 'edhrec', unique: 'cards' }); return r[Math.floor(Math.random() * Math.min(r.length, 20))]; };
    const out = [];
    for (const [q, i] of [['r:mythic', 0], ['r:rare', 1], ['r:rare', 2]]) {
      try { const c = await pick(`set:${code(i)} ${q} -t:land`); if (c) out.push(c); } catch (e) { /* skip */ }
    }
    return out;
  }
  async function deals(body) {
    const wrap = el('div', { class: 'store-grid deals' }, [el('p', { class: 'dim', text: 'Finding today’s deals…' })]);
    body.append(el('p', { class: 'dim', text: 'Three cards from recent sets, new every day. A card you already have four of cannot be bought.' }), wrap);
    let items = [];
    try { items = await E().dailyDeals(makeDeals); } catch (e) { items = []; }
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
          onclick: () => UI.purchaseDialog({
            title: d.name, sub: `${RAR_NAME[d.r] || ''} · daily deal`, cost: d.price,
            visual: el('div', { class: 'deal-img', style: url ? { backgroundImage: 'url("' + url.replace(/"/g, '%22') + '")' } : null }),
            buy: () => E().buyDeal(i),
            after: () => { body.innerHTML = ''; deals(body); },
          }) }),
      ]);
      if (card) UI.attachPreview(tile, card, 0);
      wrap.appendChild(tile);
    });
  }

  /* ---------------- buying: one click, with weight ---------------- */
  /* The button that was pressed, so a purchase can start from it. */
  let lastPressed = null;
  document.addEventListener('pointerdown', (e) => {
    const b = e.target && e.target.closest && e.target.closest('button, .art-option');
    if (b) lastPressed = b;
  }, true);

  /**
   * Buy, at once: no window. The weight is in the moment instead: the
   * button stamps down and throws sparks, the room jolts, the Shards drain
   * from the chip, and the goods fly out of the button into your hoard of
   * packs (or your wallet), landing one by one. `o.visual` is what flies;
   * `o.buy()` makes the purchase and says { ok, why }; `o.fly` how many fly.
   * (Named as before, so every buy button goes through it.)
   */
  UI.purchaseDialog = function (o) {
    const S = E();
    const from = o.from || lastPressed;
    const deny = (why) => {
      MTG.sfx('reject');
      if (from) { from.classList.remove('denied'); void from.offsetWidth; from.classList.add('denied'); }
      UI.error(why);
    };
    if (S.shards() < o.cost) return deny(`That costs ${fmtN(o.cost)} Shards; you have ${fmtN(S.shards())}. Play some games to earn more.`);
    const r = o.buy();
    if (!r || !r.ok) return deny((r && r.why) || 'That could not be bought.');
    MTG.sfx('purchase');
    if (from) {
      from.classList.remove('stamp'); void from.offsetWidth; from.classList.add('stamp');
      sparksAt(from);
    }
    const app = document.getElementById('app') || document.body;
    app.classList.remove('jolt'); void app.offsetWidth; app.classList.add('jolt');
    setTimeout(() => app.classList.remove('jolt'), 400);
    // the stamp, the sparks and the flight say it was bought; no note on top
    flyFrom(from, o.visual, o.fly || 1, o.to);
    if (o.after) setTimeout(() => o.after(), 60);
  };

  /** Sparks thrown off the button that was pressed. */
  function sparksAt(node) {
    if (document.documentElement.dataset.reducedMotion === '1') return;
    const r = node.getBoundingClientRect();
    const b = el('div', { class: 'buy-sparks', style: { left: (r.left + r.width / 2) + 'px', top: (r.top + r.height / 2) + 'px' } });
    for (let i = 0; i < 16; i++) {
      const a = (i / 16) * Math.PI * 2 + Math.random() * 0.4;
      const d = 30 + Math.random() * 45;
      b.appendChild(el('i', { style: { '--dx': (Math.cos(a) * d).toFixed(0) + 'px', '--dy': (Math.sin(a) * d * 0.7).toFixed(0) + 'px', '--d': (Math.random() * 0.08).toFixed(2) + 's' } }));
    }
    b.appendChild(el('b'));
    document.body.appendChild(b);
    setTimeout(() => b.remove(), 900);
  }

  /** The goods fly out of the button into your hoard (packs) or your wallet. */
  function flyFrom(from, visual, n, to) {
    const chip = document.querySelector('.hoard-chip');
    const chipShown = chip && chip.offsetParent !== null;
    const where = () => (to === 'hoard' && chipShown ? chip : (document.querySelector('.pack-hoard') || document.querySelector('.store-wallet') || document.querySelector('.shard-chip')));
    const target = where();
    if (!target || !from) return;
    const fr = from.getBoundingClientRect();
    const count = Math.min(10, Math.max(1, n));
    const proto = visual && (visual.querySelector ? (visual.querySelector('.booster, .wc-tile-face, .sleeve-tile-face, .deal-img') || visual) : null);
    for (let i = 0; i < count; i++) {
      const ghost = proto ? proto.cloneNode(true) : el('div', { class: 'booster' });
      ghost.classList.add('fly-ghost', 'from-button');
      const w = 54, h = Math.round(w * 1.55);
      Object.assign(ghost.style, { left: (fr.left + fr.width / 2 - w / 2) + 'px', top: (fr.top + fr.height / 2 - h / 2) + 'px', width: w + 'px', height: h + 'px', opacity: '0' });
      document.body.appendChild(ghost);
      const jitter = (Math.random() - 0.5) * 40;
      setTimeout(() => {
        const tgt = where() || target;
        const tr = tgt.getBoundingClientRect();
        const dx = tr.left + tr.width / 2 - (fr.left + fr.width / 2) + jitter, dy = tr.top + tr.height / 2 - (fr.top + fr.height / 2);
        ghost.style.opacity = '1';
        ghost.style.transform = `translate(${dx}px, ${dy}px) rotate(${(i % 2 ? 1 : -1) * (8 + Math.random() * 10)}deg) scale(.8)`;
      }, 40 + i * 85);
      setTimeout(() => {
        ghost.remove();
        MTG.sfx('pack_land', { index: i });
        const tgt = where() || target;
        if (tgt.landOne) tgt.landOne();
        else { tgt.classList.remove('landed'); void tgt.offsetWidth; tgt.classList.add('landed'); }
      }, 640 + i * 85);
    }
    // the count catches up with however many were bought (more than ten fly as ten)
    setTimeout(() => { const c = document.querySelector('.hoard-chip'); if (c && c.settle) c.settle(); }, 760 + count * 85);
  }

  /**
   * Your packs, as a hoard: the boosters themselves heaped up, the newest
   * sets on top, more of them the more you have, and how many. Click it to
   * open them.
   */
  UI.packHoard = function (onOpen) {
    const S = E();
    const packs = S.packs();
    const n = packs.length;
    const node = el('button', { type: 'button', class: 'pack-hoard' + (n ? '' : ' empty'), disabled: !n,
      title: n ? `Your packs: ${n}. Click to open them.` : 'No packs yet. Buy some here.', 'aria-label': n ? `Open your ${n} packs` : 'No packs',
      onclick: () => { if (n && onOpen) onOpen(); } });
    const heap = el('div', { class: 'ph-heap' });
    // one of each set first, then the rest, at most nine on the heap
    const seen = new Set();
    const order = packs.filter(p => { const k = (p.set || 'new' + (p.newest || 0)) + p.kind; if (seen.has(k)) return false; seen.add(k); return true; })
      .concat(packs).slice(0, Math.min(9, n));
    Promise.all([MTG.scry.draftableSets().catch(() => []), MTG.scry.packSets().catch(() => [])]).then(([sets, sold]) => {
      order.forEach((p, k) => {
        const info = p.set ? (sold.find(s => s.code === p.set) || { code: p.set, name: p.name || '' }) : (sets[p.newest || 0] || sets[0] || null);
        const b = boosterEl(info, p.kind);
        // a heap: wider at the bottom, each one a little askew
        const row = k < 4 ? 0 : k < 7 ? 1 : 2;
        const inRow = row === 0 ? k : row === 1 ? k - 4 : k - 7;
        const across = row === 0 ? 4 : row === 1 ? 3 : 2;
        const seed = (k * 37) % 11 - 5;
        b.style.setProperty('--hx', ((inRow - (across - 1) / 2) * 22 + seed * 0.8).toFixed(1) + 'px');
        b.style.setProperty('--hy', (-row * 16 - Math.abs(seed) * 0.3).toFixed(1) + 'px');
        b.style.setProperty('--hr', (seed * 2.2).toFixed(1) + 'deg');
        b.style.zIndex = String(1 + row * 10 + inRow);
        heap.appendChild(b);
      });
    });
    node.append(heap, el('div', { class: 'ph-label' }, [
      el('b', { text: n ? `${n} pack${n === 1 ? '' : 's'}` : 'No packs' }),
      el('span', { text: n ? 'Open' : 'Buy some below' }),
    ]));
    return node;
  };

  /* ---------------- sleeves ---------------- */
  /** What a sleeve draws with: a background, and the colour of its rim. */
  UI.sleeveBg = function (sl) {
    if (!sl) return null;
    // a woven one is drawn from this app's own picture of it, found by its name
    if (sl.kind === 'pattern') { const known = E().sleeveById(sl.id); return (known && known.kind === 'pattern' && known.css) || sl.css || null; }
    if (sl.kind === 'art' && sl.art) {
      // the picture is wider than the card: where to look in it, if the sleeve says
      const known = E().sleeveById(sl.id);
      return `url("${String(sl.art).replace(/"/g, '%22')}") ${(known && known.at) || '50% 30%'} / cover no-repeat, #111`;
    }
    // a GIF of your own: the part of it you chose, moving
    if (sl.kind === 'custom' && sl.anim && sl.crop) {
      const c = sl.crop, pct = (n) => (n * 100).toFixed(3) + '%';
      const px = c.w < 1 ? c.x / (1 - c.w) : 0, py = c.h < 1 ? c.y / (1 - c.h) : 0;
      return `url("${sl.anim}") ${pct(px)} ${pct(py)} / ${pct(1 / c.w)} ${pct(1 / c.h)} no-repeat, #111`;
    }
    if (sl.kind === 'custom' && sl.img) return `url("${sl.img}") center / cover no-repeat, #111`;
    return null;
  };
  /** Put a sleeve on a card back (or take it off, with null). */
  UI.applySleeve = function (node, sl) {
    const bg = UI.sleeveBg(sl);
    const key = bg ? (sl.id + ':' + (sl.anim || sl.art || (sl.img ? sl.img.length : '') || '')) : '';
    if (node._sleeve === key) return;
    node._sleeve = key;
    node.classList.toggle('sleeved', !!bg);
    // a foil has light sliding across it (store.css), told by the sleeve itself, not by what was sent
    const known = bg && sl.kind === 'pattern' ? E().sleeveById(sl.id) : null;
    if (known && known.fx) node.dataset.sleeveFx = known.fx; else delete node.dataset.sleeveFx;
    if (bg) { node.style.setProperty('--sleeve-bg', bg); node.style.setProperty('--sleeve-rim', sl.rim || '#c9a24a'); }
    else { node.style.removeProperty('--sleeve-bg'); node.style.removeProperty('--sleeve-rim'); }
  };
  /** A sleeve to show in the Store: card-shaped, with the sleeve on it. */
  function sleeveFace(sl, art) {
    const face = el('div', { class: 'sleeve-tile-face card-back' });
    const worn = sl ? (sl.kind === 'pattern' ? { id: sl.id, kind: 'pattern', css: sl.css, rim: sl.rim }
      : sl.kind === 'art' ? (art ? { id: sl.id, kind: 'art', art, rim: sl.rim } : null)
      : (E().sleeves().custom ? Object.assign({ id: 'custom', kind: 'custom', img: E().sleeves().custom, rim: sl.rim }, E().customAnim()) : null)) : null;
    if (worn) UI.applySleeve(face, worn);
    else if (sl && sl.kind === 'custom') face.appendChild(el('div', { class: 'sleeve-upload-hint', html: '<b>+</b><span>Your picture</span>' }));
    return face;
  }

  async function sleevesTab(body) {
    const S = E();
    const list = S.SLEEVES;
    // the art sleeves' pictures, looked up once
    const arts = list.filter(x => x.kind === 'art');
    const known = S.sleeves().art || {};
    const missing = arts.filter(x => !known[x.id]);
    if (missing.length) {
      try {
        const res = await MTG.scry.collection(missing.map(x => x.print ? { set: x.print[0], collector_number: x.print[1] } : { name: x.card }));
        missing.forEach((x, i) => { const c = (res.cards || [])[i]; const u = c && MTG.scry.imageUrl(c, 'art_crop', 0); if (u) S.noteSleeveArt(x.id, u); });
      } catch (e) { /* drawn without them */ }
    }
    // a set's own sleeve, earned by completing the set: its art is the set's
    for (const id of S.sleeves().owned.filter(x => /^set-/.test(x))) {
      if (!(S.sleeves().art || {})[id]) { const a = await setArt(id.slice(4)); if (a) S.noteSleeveArt(id, a.url); }
    }
    const art = S.sleeves().art || {};
    body.innerHTML = '';
    body.appendChild(el('p', { class: 'dim', text: `Sleeves go over the back of your cards, on the table and in your packs, and the other players see them. Sleeves are ${fmtN(S.PRICES.sleeve)} Shards, a foil ${fmtN(S.PRICES.sleeveFoil)}; a sleeve of your own picture is ${fmtN(S.PRICES.sleeveCustom)}.` }));
    const redraw = () => sleevesTab(body);
    const on = S.sleeves().on;
    // in shelves: yours to start with and earned, the woven ones, the foils, card art, your own
    const earned = S.sleeves().owned.filter(x => /^set-/.test(x)).map(id => S.sleeveById(id));
    const shelves = [
      ['Yours', [null].concat(earned)],
      ['Woven', list.filter(sl => sl.kind === 'pattern' && !sl.fx)],
      ['Foil', list.filter(sl => sl.kind === 'pattern' && sl.fx === 'foil')],
      ['Card art', list.filter(sl => sl.kind === 'art')],
      ['Your own picture', list.filter(sl => sl.kind === 'custom')],
    ];
    for (const [title, items] of shelves) {
      if (!items.length) continue;
      const grid = el('div', { class: 'store-grid sleeves' });
      body.append(el('h3', { class: 'store-h', text: title }), grid);
      for (const sl of items) sleeveTile(grid, sl);
    }
    function sleeveTile(grid, sl) {
      // the plain back
      if (!sl) {
        grid.appendChild(el('div', { class: 'store-card sleeve-tile' + (!on ? ' worn' : '') }, [
          el('div', { class: 'sleeve-tile-face card-back' }, [el('div', { class: 'back-ring' }, el('div', { class: 'back-pip' }))]),
          el('div', { class: 'sc-title', text: 'Classic back' }),
          el('button', { type: 'button', class: 'btn' + (!on ? '' : ' primary'), disabled: !on, text: !on ? 'Wearing' : 'Wear', onclick: () => { S.equipSleeve(null); MTG.sfx('confirm'); redraw(); } }),
        ]));
        return;
      }
      const owned = S.sleeves().owned.includes(sl.id);
      const worn = on === sl.id;
      const custom = sl.kind === 'custom';
      const price = S.sleevePrice(sl);
      const face = sleeveFace(sl, art[sl.id]);
      const btns = [];
      if (!owned) {
        btns.push(el('button', { type: 'button', class: 'btn primary buy', html: shardSvg() + ' ' + fmtN(price), onclick: () => UI.purchaseDialog({
          title: custom ? 'Custom sleeve' : `${sl.name} sleeve`,
          sub: custom ? 'Upload any picture and crop it to the back of your cards. Yours to change whenever you like.'
            : sl.fx === 'foil' ? 'A foil for the back of your cards, the light sliding across it.' : 'For the back of your cards.',
          visual: sleeveFace(sl, art[sl.id]), cost: price,
          buy: () => S.buySleeve(sl.id),
          after: () => {
            if (custom) chooseCustom(redraw);
            else { S.equipSleeve(sl.id); redraw(); }
          },
        }) }));
      } else {
        if (custom) btns.push(el('button', { type: 'button', class: 'btn', text: S.sleeves().custom ? 'Change picture' : 'Choose picture', onclick: () => chooseCustom(redraw) }));
        btns.push(el('button', { type: 'button', class: 'btn' + (worn ? '' : ' primary'), disabled: worn || (custom && !S.sleeves().custom), text: worn ? 'Wearing' : 'Wear',
          onclick: () => { S.equipSleeve(sl.id); MTG.sfx('confirm'); redraw(); } }));
      }
      grid.appendChild(el('div', { class: 'store-card sleeve-tile' + (worn ? ' worn' : '') + (custom ? ' custom' : '') + (sl.fx ? ' fx' : '') }, [
        face,
        el('div', { class: 'sc-title', text: sl.name }),
        custom ? el('div', { class: 'sc-sub dim', text: 'Upload and crop your own; a GIF keeps moving' })
          : sl.card && sl.card !== sl.name ? el('div', { class: 'sc-sub dim', text: sl.card }) : null,
        el('div', { class: 'pack-buys' }, btns),
      ].filter(Boolean)));
    }
  }

  /**
   * Your own sleeve: a picture from this device, cropped to a card. A GIF
   * stays a GIF and keeps moving: the crop is kept as where to look in it,
   * and its first frame as the still.
   */
  const GIF_MAX = 4 * 1024 * 1024;
  function chooseCustom(after) {
    const file = el('input', { type: 'file', accept: 'image/*', class: 'sr-only' });
    document.body.appendChild(file);
    file.addEventListener('change', async () => {
      const f = file.files && file.files[0];
      file.remove();
      if (!f) return;
      if (!/^image\//.test(f.type)) return UI.error('That file is not a picture.');
      const gif = f.type === 'image/gif';
      if (gif && f.size > GIF_MAX) return UI.error(`That GIF is ${(f.size / 1048576).toFixed(1)} MB; a sleeve can be up to 4 MB.`);
      let buf = null;
      if (gif) { try { buf = await f.arrayBuffer(); } catch (e) { return UI.error('That GIF could not be read.'); } }
      UI.avatarCropper(f, { x: 0.5, y: 0.5, z: 1 }, gif ? 'your moving sleeve' : 'your sleeve', async (data, crop) => {
        const ok = await E().setCustomSleeve(data, gif ? { buf, type: f.type, crop } : null);
        E().equipSleeve('custom');
        MTG.sfx('confirm');
        if (gif && !ok) UI.error('The GIF could not be kept in this browser; its first frame is your sleeve instead.');
        else UI.ok(gif ? 'Your sleeve is on, and moving.' : 'Your sleeve is on.');
        if (after) after();
      }, null, { card: true, moving: gif });
    });
    file.click();
  }

  /* ---------------- opening packs ---------------- */
  const RANK = { common: 0, uncommon: 1, rare: 2, mythic: 3 };
  /* The order cards come out in: wildcards (rarest first), then the Power
     Nine, then the rest. Before Exodus a set symbol said nothing of a card's
     rarity, so nobody opening those packs knew a common from a rare by
     looking: their cards go by value alone. The rest by rarity, then value. */
  const RARITY_SHOWN = '1998-06-15';   // Exodus, the first set symbol coloured by rarity
  const POWER_NINE = new Set(['Black Lotus', 'Ancestral Recall', 'Time Walk', 'Timetwister',
    'Mox Pearl', 'Mox Sapphire', 'Mox Jet', 'Mox Ruby', 'Mox Emerald']);
  const isPower = (it) => !!(it.card && POWER_NINE.has(it.card.name));
  const isVintage = (it) => !!(it.card && (it.card.released_at || '9999') < RARITY_SHOWN);
  const haulTier = (it) => (it.wildcard ? 0 : isPower(it) ? 1 : isVintage(it) ? 2 : 3);
  function haulOrder(a, b) {
    const ta = haulTier(a), tb = haulTier(b);
    if (ta !== tb) return ta - tb;
    if (ta === 0) return RANK[b.wildcard] - RANK[a.wildcard];
    if (ta === 3 && RANK[b.rarity] !== RANK[a.rarity]) return (RANK[b.rarity] || 0) - (RANK[a.rarity] || 0);
    return E().cardValue(b) - E().cardValue(a) || a.card.name.localeCompare(b.card.name);
  }
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
  /** A wildcard's gem, small, for a count beside it. */
  UI.wildcardIconHtml = (r) => gemSvg(r);

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
    const sold = await MTG.scry.packSets().catch(() => sets);
    const setInfo = (p) => (p.set ? (sold.find(s => s.code === p.set) || { code: p.set, name: p.name || String(p.set).toUpperCase() })
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
    let onKey = () => {};
    const keyHandler = (e) => onKey(e);
    document.addEventListener('keydown', keyHandler);
    document.body.appendChild(overlay);
    overlay.addEventListener('contextmenu', (e) => e.preventDefault());
    /* Under the top bar, which stays: your packs are a place in the game
       like the Store, not a window over it. Its menu goes where it says,
       and takes the packs away with it. */
    const topbar = document.querySelector('.topbar');
    /* the top bar's bottom is measured on the screen, and the interface is
       zoomed to fit big screens, so it is turned back into the page's own
       pixels (the overlay's on-screen height against its own) */
    // the shelf of your packs sits under the top bar; opening them takes the whole screen
    const place = () => {
      if (!overlay.classList.contains('shelf') || !topbar || topbar.offsetParent === null) { overlay.style.top = '0px'; return; }
      const zoom = (overlay.getBoundingClientRect().height / (overlay.offsetHeight || 1)) || 1;
      overlay.style.top = Math.max(0, topbar.getBoundingClientRect().bottom / zoom) + 'px';
    };
    place();
    window.addEventListener('resize', place);
    // the bar grows and shrinks with what is on it (a phone's second row, a Shard count gaining a digit)
    const barWatch = topbar && window.ResizeObserver ? new ResizeObserver(() => place()) : null;
    if (barWatch) barWatch.observe(topbar);
    const navAway = (e) => { if (e.target.closest('.topnav-btn, .brand')) close(true); };
    if (topbar) topbar.addEventListener('click', navAway, true);
    const close = (leaving) => {
      if (inspecting && !leaving) return closeInspect();
      window.removeEventListener('resize', place);
      if (barWatch) barWatch.disconnect();
      if (topbar) topbar.removeEventListener('click', navAway, true);
      document.removeEventListener('keydown', keyHandler);
      overlay.classList.add('closing');
      setTimeout(() => overlay.remove(), 300);
      if (onClose) onClose();
    };
    const setBackdrop = (info) => {
      if (!info || !info.code) return;
      setArt(info.code).then(a => paintArt(backdrop, a, U.viewW() / Math.max(1, U.viewH())));
    };

    /* ---- right-click: the card held up to the light ---- */
    let inspecting = null;
    let earlyHurry = false;   // a click while a pack tears: straight on to its cards, turned over as they always are
    const inspect = (card) => {
      if (!card) return;
      closeInspect();
      MTG.sfx('inspect');
      const url = MTG.scry.imageUrl(card, UI.bigSize(U.viewH() * 0.78 * 63 / 88), 0) || MTG.scry.imageUrl(card, 'normal', 0);
      // with room, what its keywords mean to its left and the tokens it makes to its right; without, under it
      const sides = UI.cardSides(card);
      const wide = !!(sides.keywords || sides.tokens) && UI.roomForSides();
      const face = el('div', { class: 'poi-card', style: url ? { backgroundImage: 'url("' + url.replace(/"/g, '%22') + '")' } : null }, url ? [] : [UI.cardFallback(card, 0)]);
      // as tall as it can be with a column either side still on the screen
      if (wide) face.style.height = Math.round(Math.min(0.78 * U.viewH(), (0.96 * U.viewW() - 570) * 88 / 63)) + 'px';
      const big = el('div', { class: 'po-inspect' }, [
        el('div', { class: 'poi-row' + (wide ? ' sides' : '') }, [sides.keywords, face, sides.tokens].filter(Boolean)),
        el('div', { class: 'poi-name', text: card.name }),
        el('div', { class: 'poi-sub', text: `${RAR_NAME[S.rarityOf(card)]} · you own ${Math.min(4, S.owned(card.name))} of 4 · right-click or Esc to put it down` }),
      ]);
      big.addEventListener('click', closeInspect);
      // reading a box or turning to the next token keeps the card up; right-click still puts it down
      for (const s of [sides.keywords, sides.tokens]) if (s) s.addEventListener('click', (e) => e.stopPropagation());
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
    /* The cards of every set on the shelf, fetched while the shelf is
       looked at (once a visit), so the first pack of a set opens at once
       rather than after a wait on the connection. */
    const warmed = new Set();
    const warm = (gs) => {
      for (const g of gs) {
        const code = g.info && g.info.code;
        if (!code || warmed.has(g.key)) continue;
        warmed.add(g.key);
        MTG.scry.setPool(code).catch(() => null);
        MTG.scry.packExtras(code).catch(() => null);
        if (g.kind === 'collector') MTG.scry.setVariants(code).catch(() => null);
        MTG.scry.setVintage(code).catch(() => null);
      }
    };
    const inventory = () => {
      const gs = groups();
      if (!gs.length) return close();
      warm(gs);
      stage.className = 'po-stage inv';
      overlay.classList.add('shelf');
      place();
      stage.innerHTML = ''; foot.innerHTML = ''; head.innerHTML = '';
      const total = S.packs().length;
      head.append(el('div', { class: 'po-pagehead' }, [
        el('div', {}, [
          el('h1', { text: 'Your packs' }),
          el('p', { class: 'dim', text: `${total} unopened, from ${gs.length} ${gs.length === 1 ? 'kind' : 'kinds'} of booster. Open them one at a time, a set at once, or every one together.` }),
        ]),
        total > 1 ? el('button', { type: 'button', class: 'btn primary po-openall', text: `Open all ${total}`, onclick: () => openAll('all') }) : null,
      ].filter(Boolean)));
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
      foot.appendChild(el('button', { type: 'button', class: 'btn', text: 'Done', onclick: () => close() }));
      onKey = (e) => { if (e.key === 'Escape') close(); };
    };

    /* ---- one pack ---- */
    const openOne = (g) => {
      overlay.classList.remove('shelf');
      place();
      const p = (groups().find(x => x.key === g.key) || { packs: [] }).packs[0];
      if (!p) return inventory();
      const info = setInfo(p);
      setBackdrop(info);
      stage.className = 'po-stage one';
      stage.innerHTML = ''; stage.scrollTop = 0; foot.innerHTML = ''; head.innerHTML = '';
      head.append(el('div', { class: 'po-title', text: info.name }), el('div', { class: 'po-sub', text: (p.kind === 'collector' ? 'Collector Booster' : 'Play Booster') }));
      const pack = boosterEl(info, p.kind, { big: true });
      pack.classList.add('po-pack');
      const hint = el('div', { class: 'po-hint', text: 'Click the pack to open it' });
      const wrap = el('div', { class: 'po-packwrap' }, [pack]);
      stage.append(el('div', { class: 'po-spot' }), wrap, hint);
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
        // a click from here on skips the rest of the tearing, straight to the cards (the next tick: this click is still going up)
        earlyHurry = false;
        setTimeout(() => { stage.onclick = () => { earlyHurry = true; wrap.classList.add('hurry'); }; }, 0);
        const pause = async (ms) => { for (let t = 0; t < ms && !earlyHurry; t += 30) await sleep(30); };
        hint.classList.add('gone');
        /* Opened the way a pack is: gripped, a twist, the top torn off along
           a ragged line, and the cards pulled up out of it as the wrapper
           falls away; then they are dealt from there. */
        pack.classList.add('grip');
        overlay.classList.add('tense');
        MTG.sfx('pack_charge', { dur: reduced() ? 0.2 : 0.7 });
        let res;
        try {
          [res] = await Promise.all([S.openPack(p.id, async () => info), pause(reduced() ? 100 : 320)]);
        } catch (e) {
          opening = false;
          stage.onclick = null;
          pack.classList.remove('grip');
          overlay.classList.remove('tense');
          hint.classList.remove('gone');
          return UI.error(e.message || String(e));
        }
        overlay.classList.remove('tense');
        if (reduced()) { pack.classList.add('torn'); await sleep(50); return deal(res, g, info); }
        // the torn edge, a little below the top: a ragged line, left to right
        const edge = [];
        for (let x = 0; x <= 100; x += 4) edge.push([x, 13 + (x % 8 === 0 ? -1 : 1) * (0.5 + Math.random() * 1.3)]);
        const at = (pts) => pts.map(([x, y]) => `${x}% ${y.toFixed(1)}%`).join(', ');
        const piece = (cls, clip) => {
          const c = pack.cloneNode(true);
          c.classList.remove('po-pack', 'grip');
          c.classList.add('po-part', cls);
          c.style.clipPath = clip;
          c.style.setProperty('--rx', '0deg'); c.style.setProperty('--ry', '0deg');
          return c;
        };
        const strip = piece('tear-top', `polygon(0% 0%, 100% 0%, ${at(edge.slice().reverse())})`);
        const body = piece('body', `polygon(${at(edge)}, 100% 100%, 0% 100%)`);
        // the cards inside, face down in your sleeves
        const rise = el('div', { class: 'po-rise' }, [0, 1, 2].map((k) => {
          const b = el('div', { class: 'po-back' }, [el('div', { class: 'back-ring' }, el('div', { class: 'back-pip' }))]);
          UI.applySleeve(b, S.sleeveWorn());
          b.style.setProperty('--n', String(k));
          return b;
        }));
        // flecks of foil off the tear
        const flecks = el('div', { class: 'po-flecks' }, Array.from({ length: 16 }, (_, i) => el('i', { style: {
          '--x': (8 + i * 5.6).toFixed(0) + '%', '--dx': ((Math.random() - 0.3) * 120).toFixed(0) + 'px',
          '--dy': (-30 - Math.random() * 90).toFixed(0) + 'px', '--r': (Math.random() * 540).toFixed(0) + 'deg', '--d': (i * 0.018).toFixed(3) + 's' } })));
        wrap.append(rise, body, strip, flecks);
        pack.style.visibility = 'hidden';
        MTG.sfx('pack_tear');
        requestAnimationFrame(() => { body.classList.add('open'); rise.classList.add('up'); });
        await pause(520);
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
      /* What the card goes for, near mint (the market price, in its finish):
         over it once it is turned. The One Ring, 1 of 1, has no price. */
      const usd = it.card ? E().cardValue(it) : 0;
      const price = it.serial ? el('div', { class: 'po-price serial', text: 'Priceless', title: 'There is only one' })
        : usd > 0 ? el('div', { class: 'po-price' + (usd >= 20 ? ' hi' : usd >= 3 ? ' mid' : ''), text: fmtUsd(usd),
          title: `${fmtUsd(usd)} each, near mint${it.foil ? ', foil' : ''}` }) : null;
      const t = el('button', { type: 'button', class: `po-card r-${r}${big ? ' big' : ''}`, 'aria-label': 'A card, face down', style: {
        '--i': String(i),
        '--ox': ((cols - 1) / 2 - col).toFixed(2), '--oy': ((rows - 1) / 2 - row).toFixed(2),
        transformOrigin: `${col === 0 ? 'left' : col === cols - 1 ? 'right' : 'center'} ${rows === 1 ? 'center' : row === 0 ? 'top' : row === rows - 1 ? 'bottom' : 'center'}`,
      } }, [
        el('div', { class: 'po-inner' }, [
          (() => { const b = el('div', { class: 'po-back' }, [el('div', { class: 'back-ring' }, el('div', { class: 'back-pip' }))]); UI.applySleeve(b, S.sleeveWorn()); return b; })(),
          front,
        ]),
        price,
        el('div', { class: 'po-tags' }, [
          it.count > 1 ? el('span', { class: 'po-count-tag', text: '×' + it.count }) : null,
          it.isNew ? el('span', { class: 'po-new', text: 'New' }) : null,
          it.serial ? el('span', { class: 'po-bonus serial', text: it.serial === '1/1' ? '1 of 1' : it.serial }) : null,
          it.card && it.card._vintage ? el('span', { class: 'po-bonus vintage', text: 'Vintage' }) : null,
          it.card && it.card._bonus ? el('span', { class: 'po-bonus', text: it.card.set_type === 'commander' ? 'Commander'
            : it.card.set_type === 'alchemy' ? 'Alchemy' : it.card.digital ? 'Digital' : 'Bonus' }) : null,
          it.shards ? el('span', { class: 'po-dup', html: `+${shardSvg()}${fmtN(it.shards)}` }) : null,
        ].filter(Boolean)),
      ]);
      t._item = it; t._big = big; t._flipped = false;
      t.addEventListener('mouseenter', () => { if (t._flipped) MTG.sfx('hover'); });
      t.addEventListener('contextmenu', (e) => { e.preventDefault(); if (t._flipped && it.card) inspect(it.card); });
      // turned over, a click holds it up to the light too (a face-down one is turned over instead)
      t.addEventListener('click', () => { if (t._flipped && it.card && Date.now() - (t._flippedAt || 0) > 250) inspect(it.card); });
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
      // silent: turned with the rest of a haul at once, which makes its one sound for all of them
      const flip = async (t, quick, silent) => {
        if (t._flipped || t._charging) return;
        const it = t._item;
        const r = it.wildcard || it.rarity;
        const pan = Math.max(-0.7, Math.min(0.7, -parseFloat(t.style.getPropertyValue('--ox')) / 4 || 0));
        if (t._big && !quick && !reduced() && !(after.hurried && after.hurried())) {
          t._charging = true;
          t.classList.add('charging');
          MTG.sfx(r === 'mythic' ? 'charge_mythic' : 'charge_rare');
          await sleep(r === 'mythic' ? 600 : 360);
          t.classList.remove('charging');
          t._charging = false;
        }
        t._flipped = true;
        t._flippedAt = Date.now();
        t.classList.remove('waiting');
        t.classList.add('flipped');
        t.setAttribute('aria-label', it.card ? it.card.name : `${RAR_NAME[it.wildcard]} wildcard`);
        if (silent) {
          if (it.wildcard === 'mythic' || it.rarity === 'mythic') burst(t, 'mythic');
          flips++;
          after();
          return;
        }
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
      stage.innerHTML = ''; stage.scrollTop = 0; foot.innerHTML = '';
      const all = res.cards.concat(res.bonus.map(r => ({ wildcard: r, track: true })));
      // wildcards and the Power Nine first; a pack from before rarity was shown by value, any other as it was packed
      const rest = all.filter(it => haulTier(it) > 1);
      const vintagePack = (info && info.released_at ? info.released_at : '9999') < RARITY_SHOWN;
      const items = all.filter(it => haulTier(it) <= 1).sort(haulOrder)
        .concat(vintagePack ? rest.slice().sort((a, b) => E().cardValue(b) - E().cardValue(a)) : rest);
      const cols = Math.min(8, Math.ceil(items.length / 2));
      const grid = el('div', { class: 'po-grid', style: { '--cols': String(cols), '--rows': String(Math.ceil(items.length / cols)) } });
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
        foot.appendChild(el('button', { type: 'button', class: 'btn' + (!hidden.length && !same ? ' primary' : ''), text: 'Done', onclick: () => close() }));
      };
      /* A click while the cards are being dealt or turned (on the table,
         not on a card) hurries them: eight times the pace, and a rare turns
         without gathering itself first. */
      let pace = 1;
      const hurry = () => { if (pace > 1) return; pace = 8; grid.classList.add('hurry'); };
      refresh.hurried = () => pace > 1;
      // waits that shrink the moment a click hurries them, even one already begun
      const paced = async (ms) => { for (let left = ms; left > 0;) { const step = pace > 1 ? 10 : 40; await sleep(step); left -= step * pace; } };
      const flip = flipper(tiles, refresh);
      for (const t of tiles) t.addEventListener('click', () => flip(t));
      stage.onclick = (e) => { if (!(e.target.closest && e.target.closest('.po-card'))) hurry(); };
      // the tearing skipped: the cards are still dealt and turned over at their own pace, the unveiling being the point
      earlyHurry = false;
      let revealing = false;
      const revealAll = async () => {
        if (revealing) return hurry();
        revealing = true;
        for (const t of tiles.filter(x => !x._flipped)) { if (!overlay.isConnected) return; flip(t, true); await paced(70); }
      };
      refresh();
      // dealt out of the pack, one after another
      requestAnimationFrame(() => requestAnimationFrame(() => grid.classList.add('dealt')));
      (async () => {
        await paced(60);
        for (const t of tiles) {
          const pan = Math.max(-0.7, Math.min(0.7, -parseFloat(t.style.getPropertyValue('--ox')) / 4 || 0));
          if (pace === 1) MTG.sfx('card_deal', { pan });
          await paced(32);
        }
        await paced(160);
        // dealt: from now on a card comes up and goes back at once
        setTimeout(() => grid.classList.add('settled'), 300 / pace);
        for (const t of tiles.filter(x => !x._big)) {
          if (!overlay.isConnected) return;
          flip(t, pace > 1);
          await paced(75);
        }
        for (const t of tiles) if (t._big && !t._flipped) t.classList.add('waiting');
      })();
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
    /* Every pack of one set (a group), or with 'all' every pack you have:
       torn open in a row, then everything they held laid out together. */
    const openAll = async (g) => {
      overlay.classList.remove('shelf');
      place();
      const gs = g === 'all' ? groups() : [groups().find(x => x.key === g.key)].filter(Boolean);
      const each = gs.flatMap(x => x.packs.map(p => ({ p, g: x })));
      const packs = each.map(x => x.p);
      if (!packs.length) return inventory();
      const info = gs.length === 1 ? gs[0].info : { code: gs[0].info.code, name: 'All your packs' };
      setBackdrop(gs[0].info);
      stage.className = 'po-stage all';
      stage.innerHTML = ''; stage.scrollTop = 0; foot.innerHTML = ''; head.innerHTML = '';
      head.append(el('div', { class: 'po-title', text: info.name }), el('div', { class: 'po-sub', text: `Opening ${packs.length} packs…` }));
      /* The packs as a pile, the one being opened on top: each tears off in
         turn and the next unopened one comes up behind the rest, so every
         pack is seen as it opens, whatever its set. */
      const fan = el('div', { class: 'po-fan pile' });
      const DEPTH = Math.min(5, packs.length);
      const pile = [];
      const restack = () => pile.forEach((b, j) => { b.style.setProperty('--j', String(j)); b.style.zIndex = String(20 - j); });
      const comeUp = (k) => {
        if (k >= packs.length) return;
        const b = boosterEl(each[k].g.info, each[k].g.kind);
        fan.appendChild(b);
        pile.push(b);
      };
      for (let k = 0; k < DEPTH; k++) comeUp(k);
      restack();
      stage.appendChild(fan);
      /* Clicking again (or Enter, or Space) while the packs tear goes
         straight to the cards: those of the packs torn so far are laid out
         and turned over, and the rest of the packs go on opening behind
         them, each one's cards filled in where they belong (a card already
         there counts up, a new one takes its place in the order) and turned
         as they come. A click while the cards turn turns them all at once. */
      let skip = false, revealNow = null, haul = false;
      const skipAll = () => {
        if (revealNow) { revealNow(); return; }
        if (skip) return;
        skip = true;
        layHaul();
      };
      const onSkip = (e) => { if (e.target && e.target.closest && e.target.closest('.po-x, .po-foot button')) return; skipAll(); };
      // from the next click on: the one that pressed Open all is still on its way up through the overlay
      setTimeout(() => overlay.addEventListener('click', onSkip), 0);
      onKey = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); skipAll(); } };
      head.querySelector('.po-sub').textContent = `Opening ${packs.length} packs… click to skip`;
      warm(gs);
      // the whole tearing in about a second and a half, however many packs there are
      const tearGap = Math.max(12, Math.min(120, Math.round(1500 / packs.length)));

      /* ---- the haul: everything, together, the same card once with how many ---- */
      const merged = new Map();
      const wcs = { common: 0, uncommon: 0, rare: 0, mythic: 0 };
      const wcItems = {};
      const wcItem = (r) => Object.assign(wcItems[r] = wcItems[r] || { wildcard: r, count: 0 }, { count: wcs[r] });
      const keyOf = (it) => it.wildcard ? 'wc:' + it.wildcard : it.card.name + (it.foil ? '|f' : '');
      let shardsIn = 0, fresh = 0, total = 0, opened = 0;
      // a pack's cards into the haul: the keys of the items it added or added to
      const absorb = (res) => {
        const touched = new Set();
        opened++;
        for (const it of res.cards) {
          total++;
          if (it.wildcard) { wcs[it.wildcard]++; touched.add('wc:' + it.wildcard); continue; }
          const key = keyOf(it);
          const m = merged.get(key) || Object.assign({}, it, { count: 0, shards: 0, isNew: false });
          m.count++; m.shards += it.shards || 0; m.isNew = m.isNew || it.isNew;
          merged.set(key, m);
          touched.add(key);
          shardsIn += it.shards || 0;
          if (it.isNew) fresh++;
        }
        for (const r of res.bonus) { wcs[r]++; touched.add('wc:' + r); }
        return touched;
      };
      // wildcards, the Power Nine, cards from before rarity was shown by value, then by rarity and value
      const itemsNow = () => [...merged.values()].concat(RAR.filter(r => wcs[r]).map(wcItem)).sort(haulOrder);
      const headline = (done) => {
        head.innerHTML = '';
        const v = [...merged.values()].reduce((n, it) => n + E().cardValue(it) * (it.count || 1), 0);
        head.append(el('div', { class: 'po-title', text: `${info.name}: ${opened} ${done ? '' : `of ${packs.length} `}pack${(done ? opened : packs.length) === 1 ? '' : 's'}${done ? '' : '…'}` }),
          el('div', { class: 'po-sub' }, [
            document.createTextNode(`${total} cards · ${fresh} new`),
            v > 0 ? document.createTextNode(` · ${fmtUsd(v)} near mint`) : null,
            shardsIn ? el('span', { html: ` · +${shardSvg()}${fmtN(shardsIn)} for extra copies` }) : null,
            ...RAR.filter(r => wcs[r]).map(r => el('span', { class: 'po-wcsum' }, [wcIcon(r, wcs[r])])),
          ].filter(Boolean)));
      };
      const colsFor = (n) => Math.max(4, Math.min(10, Math.ceil(Math.sqrt(n * 1.8))));
      const tileOf = new Map();
      let grid = null, tiles = [], flip = null, waveOver = false, loopDone = false, allAtOnce = false, liveGap = 60;
      // the clicks that skip, done with once the cards are all turned and every pack is open
      const quiet = () => { if (waveOver && loopDone) overlay.removeEventListener('click', onSkip); };

      /* The haul laid out: the cards so far, dealt and turned over, the best
         of them first; what comes after is filled in by fill(). */
      const layHaul = () => {
        haul = true;
        const items = itemsNow();
        const cols = colsFor(items.length);
        stage.className = 'po-stage all summary';
        stage.innerHTML = ''; stage.scrollTop = 0;
        headline(loopDone);
        // dealt in about a second, however many there are
        grid = el('div', { class: 'po-grid many', style: { '--cols': String(cols), '--step': Math.max(2, Math.min(12, 1000 / Math.max(1, items.length))).toFixed(1) + 'ms' } });
        stage.appendChild(grid);
        tiles = items.map((it, i) => cardTile(it, i, items.length, cols));
        tiles.forEach((t) => { tileOf.set(keyOf(t._item), t); grid.appendChild(t); });
        foot.innerHTML = '';
        if (S.packs().length) foot.appendChild(el('button', { type: 'button', class: 'btn', text: 'Back to packs', onclick: () => { MTG.sfx('click'); inventory(); } }));
        foot.appendChild(el('button', { type: 'button', class: 'btn primary', text: 'Done', onclick: () => close() }));
        flip = flipper(tiles, () => {});
        // the packs still to open, filled in over about two seconds
        liveGap = Math.max(25, Math.min(110, Math.round(1800 / Math.max(1, packs.length - opened))));
        /* skipped: every card there turned over at once, with one sound for
           the lot (the rarest there is), and no stagger to wait out */
        revealNow = () => {
          allAtOnce = true;
          const down = tiles.filter(t => !t._flipped);
          waveOver = true;
          quiet();
          if (!down.length) return;
          grid.classList.add('instant', 'dealt', 'settled');
          for (const t of down) flip(t, true, true);
          const has = (r) => down.some(t => (t._item.wildcard || t._item.rarity) === r);
          MTG.sfx(has('mythic') ? 'reveal_mythic' : has('rare') ? 'reveal_rare' : 'card_flip');
          requestAnimationFrame(() => requestAnimationFrame(() => grid.classList.remove('instant')));
        };
        // the whole haul from the top, wherever the list of packs was scrolled to
        requestAnimationFrame(() => requestAnimationFrame(() => { grid.classList.add('dealt'); stage.scrollTop = 0; }));
        setTimeout(() => grid.classList.add('settled'), 500 + Math.min(1200, tiles.length * 6));
        // the best of it turned over first, with its sound; the rest in a quick wave
        const best = tiles.filter(t => t._big);
        const rest = tiles.filter(t => !t._big);
        let at = 250;
        const bestGap = Math.max(25, Math.min(200, Math.round(1500 / Math.max(1, best.length))));
        const restGap = Math.max(4, Math.min(30, Math.round(1000 / Math.max(1, rest.length))));
        for (const t of best) { setTimeout(() => { if (overlay.isConnected) flip(t, true, bestGap < 60 && t !== best[0]); }, at); at += bestGap; }
        rest.forEach((t, k) => setTimeout(() => { if (overlay.isConnected) flip(t, true, restGap < 20 && k % 6 !== 0); }, at + k * restGap));
        // once the wave has run its course (and every pack is open), a click is a click again
        setTimeout(() => { waveOver = true; quiet(); }, at + rest.length * restGap + 300);
      };

      /** A tile's count and its Shards brought up to date, with a nudge. */
      const retag = (t, it) => {
        const tags = t.querySelector('.po-tags');
        if (!tags) return;
        let c = tags.querySelector('.po-count-tag');
        if (it.count > 1) {
          if (!c) { c = el('span', { class: 'po-count-tag' }); tags.prepend(c); }
          c.textContent = '×' + it.count;
        }
        let d = tags.querySelector('.po-dup');
        if (it.shards) {
          if (!d) { d = el('span', { class: 'po-dup' }); tags.appendChild(d); }
          d.innerHTML = `+${shardSvg()}${fmtN(it.shards)}`;
        }
        t.classList.remove('bump'); void t.offsetWidth; t.classList.add('bump');
      };
      /* A pack opened after the haul was laid out: its cards filled in, a
         card already there counting up, a new one put in its place in the
         order and turned over as it lands. */
      const fill = (touched) => {
        headline(false);
        const comers = [];
        for (const key of touched) {
          const it = key.startsWith('wc:') ? wcItem(key.slice(3)) : merged.get(key);
          const had = tileOf.get(key);
          if (had) { retag(had, it); continue; }
          const t = cardTile(it, 0, 1, 1);
          t.classList.add('late');
          const before = tiles.find(x => haulOrder(it, x._item) < 0) || null;
          grid.insertBefore(t, before);
          tiles.splice(before ? tiles.indexOf(before) : tiles.length, 0, t);
          tileOf.set(key, t);
          comers.push(t);
        }
        grid.style.setProperty('--cols', String(colsFor(tiles.length)));
        comers.sort((a, b) => haulOrder(a._item, b._item));
        comers.forEach((t, k) => setTimeout(() => { if (overlay.isConnected) flip(t, true, allAtOnce || k > 0); }, allAtOnce ? 0 : 120 + k * 45));
      };

      const results = [];
      let failed = null;
      for (let i = 0; i < packs.length; i++) {
        let res;
        try { res = await S.openPack(packs[i].id, async () => each[i].g.info); } catch (e) { failed = e; break; }
        if (!overlay.isConnected) return;
        results.push(res);
        const touched = absorb(res);
        if (haul) { fill(touched); if (i < packs.length - 1) await sleep(reduced() ? 0 : liveGap); continue; }
        // the top pack tears away and the next comes up
        const top = pile.shift();
        if (top) {
          if (reduced()) top.remove();
          else { top.classList.add('rip'); setTimeout(() => top.remove(), 450); }
        }
        comeUp(i + DEPTH);
        restack();
        const sub = head.querySelector('.po-sub');
        if (sub) sub.textContent = `Opening ${i + 1} of ${packs.length}… click to skip`;
        if (tearGap >= 40 || i % Math.ceil(40 / tearGap) === 0) MTG.sfx('pack_tear_quick', { pan: (i % 3 - 1) * 0.3 });
        await sleep(reduced() ? 10 : tearGap);
      }
      loopDone = true;
      if (failed && !results.length && !haul) { overlay.removeEventListener('click', onSkip); UI.error(failed.message || String(failed)); return inventory(); }
      if (!haul) {
        overlay.classList.remove('flash', 'quake'); void overlay.offsetWidth; overlay.classList.add('flash', 'quake');
        MTG.sfx('boom');
        await sleep(reduced() ? 50 : 300);
        layHaul();
      }
      headline(true);
      quiet();
      if (failed) UI.error(`Some packs could not be opened: ${failed.message || failed}`);
      // Enter or Space: the cards at once while they are still turning, and away once they are all up
      onKey = (e) => {
        if (e.key === 'Escape') { e.preventDefault(); close(); return; }
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (tiles.some(t => !t._flipped)) skipAll(); else close(); }
      };
    };

    inventory();
  };

  /* ---------------- emotes ---------------- */
  /** What can be said across the table, quickly. */
  const EMOTES = [
    { id: 'hello', text: 'Hello!' }, { id: 'luck', text: 'Good luck!' }, { id: 'nice', text: 'Nice play.' },
    { id: 'think', text: 'Thinking…' }, { id: 'oops', text: 'Oops.' }, { id: 'wow', text: 'Wow!' },
    { id: 'thanks', text: 'Thanks!' }, { id: 'gg', text: 'Good game.' },
  ];
  UI.EMOTES = EMOTES;
  let lastEmote = 0;
  /** A speech bubble by a player's portrait for a moment. */
  UI.showEmote = function (pid, id) {
    const em = EMOTES.find(e => e.id === id);
    if (!em) return;
    const orbs = [...document.querySelectorAll(`.life-orb[data-player="${CSS.escape(String(pid))}"]`)];
    const orb = orbs.sort((a, b) => b.getBoundingClientRect().width - a.getBoundingClientRect().width)[0];
    if (!orb) return;
    const r = orb.getBoundingClientRect();
    const below = r.top < 140;
    const b = el('div', { class: 'emote-bubble' + (below ? ' below' : ''), text: em.text,
      style: { left: (r.left + r.width / 2) + 'px', top: (below ? r.bottom + 10 : r.top - 10) + 'px' } });
    document.body.appendChild(b);
    MTG.sfx('chat');
    setTimeout(() => b.classList.add('out'), 2600);
    setTimeout(() => b.remove(), 3100);
  };
  /**
   * The emote button by your portrait, put on the table once: a click
   * opens the wheel, an emote is said (and sent to the others online).
   */
  UI.mountEmotes = function (table) {
    if (table._emoteBtn || !table.arena || table.view && (table.view.spectating || table.view.replay)) return;
    const btn = el('button', { type: 'button', class: 'emote-btn', title: 'Say something', 'aria-label': 'Emotes', html: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h0A2.5 2.5 0 0 1 3 13.5v-8z" fill="currentColor"/></svg>' });
    let wheel = null;
    const close = () => { if (wheel) { wheel.remove(); wheel = null; } };
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      if (wheel) return close();
      wheel = el('div', { class: 'emote-wheel' }, EMOTES.map(em => el('button', { type: 'button', class: 'emote-opt', text: em.text, onclick: (ev) => {
        ev.stopPropagation();
        close();
        if (Date.now() - lastEmote < 1500) return;
        lastEmote = Date.now();
        if (MTG.app && MTG.app.sendEmote) MTG.app.sendEmote(em.id);
      } })));
      table.arena.appendChild(wheel);
      setTimeout(() => document.addEventListener('click', close, { once: true }), 0);
    });
    table.arena.appendChild(btn);
    table._emoteBtn = btn;
  };

  /* ---------------- frames ---------------- */
  /** The frames, to buy and wear (in the Store). */
  UI.framesTab = function (body, purchase) {
    const S = E();
    body.appendChild(el('p', { class: 'dim', text: 'A frame goes around your portrait, at the table and in the menus, and the other players see it.' }));
    const grid = el('div', { class: 'store-grid frames' });
    const on = S.frameWorn();
    const redraw = () => { body.innerHTML = ''; UI.framesTab(body, purchase); };
    const name = (MTG.app && MTG.app.myName) || 'You';
    grid.appendChild(el('div', { class: 'store-card frame-tile' + (!on ? ' worn' : '') }, [
      UI.portrait(name, null, { size: 'lg', avatar: MTG.settings.avatar }),
      el('div', { class: 'sc-title', text: 'No frame' }),
      el('button', { type: 'button', class: 'btn' + (on ? ' primary' : ''), disabled: !on, text: on ? 'Wear' : 'Wearing', onclick: () => { S.equipFrame(null); MTG.sfx('confirm'); redraw(); } }),
    ]));
    for (const fr of S.FRAMES) {
      const owned = S.state.frames.owned.includes(fr.id);
      const worn = on === fr.id;
      grid.appendChild(el('div', { class: 'store-card frame-tile' + (worn ? ' worn' : '') }, [
        UI.portrait(name, null, { size: 'lg', avatar: MTG.settings.avatar, frame: fr.id }),
        el('div', { class: 'sc-title', text: fr.name }),
        fr.text ? el('div', { class: 'sc-sub dim', text: fr.text }) : null,
        owned
          ? el('button', { type: 'button', class: 'btn' + (worn ? '' : ' primary'), disabled: worn, text: worn ? 'Wearing' : 'Wear', onclick: () => { S.equipFrame(fr.id); MTG.sfx('confirm'); redraw(); } })
          : el('button', { type: 'button', class: 'btn primary buy', html: (UI.shardIcon ? UI.shardIcon() : '') + ' ' + fr.price.toLocaleString(), onclick: () => purchase({
            title: `${fr.name} frame`, cost: fr.price, visual: UI.portrait(name, null, { size: 'lg', avatar: MTG.settings.avatar, frame: fr.id }),
            buy: () => S.buyFrame(fr.id), after: redraw }) }),
      ].filter(Boolean)));
    }
    body.appendChild(grid);
  };

  /* ---------------- card styles ---------------- */
  /** A card's styles, in its close-up: each to try on, buy, or wear. */
  UI.cardStyles = function (card, after) {
    const S = E();
    const url = MTG.scry.imageUrl(card, 'normal', 0);
    const owned = S.owned(card.name) > 0;
    const on = S.styleFor(card.name);
    const box = el('div', { class: 'style-picker' }, [el('div', { class: 'opt-label', text: 'Card styles' }),
      el('div', { class: 'opt-help', text: owned ? 'A style goes on this card wherever you play it.' : 'Own the card to give it a style.' })]);
    const row = el('div', { class: 'style-row' });
    const mk = (st) => {
      const has = st ? S.ownsStyle(card.name, st.id) : true;
      const wearing = st ? on === st.id : !on;
      const face = el('div', { class: 'style-face cv-face' + (st ? ' cstyle cs-' + st.id : ''), style: url ? { backgroundImage: 'url("' + url.replace(/"/g, '%22') + '")' } : null });
      return el('div', { class: 'style-opt' + (wearing ? ' on' : '') }, [
        el('div', { class: 'style-thumb' }, [face]),
        el('b', { text: st ? st.name : 'Plain' }),
        !owned ? null : has
          ? el('button', { type: 'button', class: 'btn xs' + (wearing ? '' : ' primary'), disabled: wearing, text: wearing ? 'On' : 'Use', onclick: () => { S.setStyle(card.name, st ? st.id : null); MTG.sfx('confirm'); if (after) after(); } })
          : el('button', { type: 'button', class: 'btn xs primary buy', html: (UI.shardIcon ? UI.shardIcon() : '') + st.price.toLocaleString(), onclick: () => UI.purchaseDialog({
            title: `${st.name}: ${card.name}`, cost: st.price, visual: face.cloneNode(true), buy: () => S.buyStyle(card.name, st.id), after }) }),
      ].filter(Boolean));
    };
    row.appendChild(mk(null));
    for (const st of S.STYLES) row.appendChild(mk(st));
    box.appendChild(row);
    return box;
  };

  /* ---------------- the Collection ---------------- */
  // rarities: any number of them at once (none is every rarity); sort: how the cards are laid out
  const colState = { set: '', rarities: [], color: '', show: 'owned', q: '', sort: 'color' };
  const COL_SORTS = [['color', 'Colour'], ['mv', 'Mana value'], ['name', 'Name'], ['rarity', 'Rarity'], ['copies', 'Copies owned'], ['new', 'Newest']];
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
    MTG.scry.packSets().then(sets => {
      for (const s of sets.slice(0, 80)) setSel.appendChild(el('option', { value: s.code, text: s.name, selected: s.code === colState.set }));
    }).catch(() => {});
    const search = el('input', { type: 'search', placeholder: 'Search by name…', value: colState.q, 'aria-label': 'Search the collection' });
    // a colour reads as its mana symbol, its name on hover
    const chipFace = (key, v, label) => key === 'color' && /^[WUBRGMC]$/.test(v)
      ? { title: label, 'aria-label': label, html: `<i class="pip pip-${v.toLowerCase()}">${v}</i>` } : { text: label };
    const chips = (list, key) => el('div', { class: 'seg mini' }, list.map(([v, label]) => el('button', Object.assign({ type: 'button', class: 'seg-btn' + (colState[key] === v ? ' on' : '') }, chipFace(key, v, label), {
      onclick: () => { colState[key] = v; UI.renderCollection(host); } }))));
    /* Rarities: any of them together, each letter in its rarity's colour;
       "Any rarity" lets them all through again. */
    const RAR_WORD = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', mythic: 'Mythic' };
    const rarityChips = el('div', { class: 'seg mini rar-chips', role: 'group', 'aria-label': 'Rarity' }, [
      el('button', { type: 'button', class: 'seg-btn' + (colState.rarities.length ? '' : ' on'), text: 'Any rarity', 'aria-pressed': String(!colState.rarities.length),
        onclick: () => { colState.rarities = []; UI.renderCollection(host); } }),
      ...['common', 'uncommon', 'rare', 'mythic'].map(r => {
        const on = colState.rarities.includes(r);
        return el('button', { type: 'button', class: 'seg-btn rar-' + r + (on ? ' on' : ''), text: r[0].toUpperCase(), 'aria-label': RAR_WORD[r], 'aria-pressed': String(on),
          onclick: () => {
            colState.rarities = on ? colState.rarities.filter(x => x !== r) : colState.rarities.concat(r);
            // all four is the same as any
            if (colState.rarities.length === 4) colState.rarities = [];
            UI.renderCollection(host);
          } });
      }),
    ]);
    const sortSel = el('select', { class: 'col-sort', 'aria-label': 'Sort by' },
      COL_SORTS.map(([v, label]) => el('option', { value: v, text: 'Sort: ' + label, selected: colState.sort === v })));
    sortSel.addEventListener('change', () => { colState.sort = sortSel.value; drawGrid(); });
    const grid = el('div', { class: 'col-grid' });
    const status = el('div', { class: 'col-status dim' });
    host.append(el('div', { class: 'collection' }, [
      el('div', { class: 'col-head' }, [
        el('div', {}, [el('h1', { text: 'Collection' }), el('p', { class: 'dim', text: `${fmtN(uniq)} different cards, ${fmtN(copies)} in all. Basic lands are free and unlimited.` })]),
        el('div', { class: 'store-wallet' }, [shards(S.shards()), el('div', { class: 'wc-col' }, [el('div', { class: 'wc-row' }, RAR.map(r => wcIcon(r, S.wildcards()[r]))), UI.wildcardTrack()])]),
      ]),
      el('div', { class: 'col-filters' }, [
        setSel, search, sortSel,
        rarityChips,
        chips([['', 'Any colour'], ['W', 'White'], ['U', 'Blue'], ['B', 'Black'], ['R', 'Red'], ['G', 'Green'], ['M', 'Multicolour'], ['C', 'Colourless']], 'color'),
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
      // (the first visit asks Scryfall in batches: how far it has got, so the wait is not a blank)
      const progress = (got, all) => { if (all && got < all) status.textContent = `Loading… ${fmtN(got)} of ${fmtN(all)} cards`; };
      try { const r = await MTG.scry.collection(ids, progress); cards = (r.cards || []).filter(Boolean); } catch (e) { cards = []; }
    }
    const colourOf = (c) => {
      const cs = c.colors || (c.card_faces && c.card_faces[0] && c.card_faces[0].colors) || [];
      return cs.length > 1 ? 'M' : cs.length ? cs[0] : 'C';
    };
    let shown = 120;
    const drawGrid = () => {
      const q = colState.q.toLowerCase();
      let list = cards.filter(c => (!colState.rarities.length || colState.rarities.includes(S.rarityOf(c))) &&
        (!colState.color || colourOf(c) === colState.color) && (!q || c.name.toLowerCase().includes(q)));
      if (colState.set && colState.show === 'owned') list = list.filter(c => S.owned(c.name) > 0);
      if (colState.set && colState.show === 'missing') list = list.filter(c => S.owned(c.name) < 4);
      /* Colour (white, blue, black, red, green, then gold and colourless,
         lands last), then mana value from least to most, then name; or by
         whatever the Sort says first, with that order behind it. */
      const order = { W: 0, U: 1, B: 2, R: 3, G: 4, M: 5, C: 6 };
      const rank = { mythic: 0, rare: 1, uncommon: 2, common: 3 };
      const rarityRank = (c) => { const r = rank[S.rarityOf(c)]; return r == null ? 4 : r; };
      const isLandCard = (c) => /\bLand\b/.test(String((c.card_faces && c.card_faces[0] && c.card_faces[0].type_line) || c.type_line || ''));
      const mv = (c) => (c.cmc != null ? c.cmc : ((c.card_faces && c.card_faces[0] && c.card_faces[0].cmc) || 0));
      const byColour = (a, b) => (isLandCard(a) - isLandCard(b)) || (order[colourOf(a)] - order[colourOf(b)]);
      const byMv = (a, b) => mv(a) - mv(b);
      const byName = (a, b) => a.name.localeCompare(b.name);
      const SORTS = {
        color: (a, b) => byColour(a, b) || byMv(a, b) || byName(a, b),
        mv: (a, b) => (isLandCard(a) - isLandCard(b)) || byMv(a, b) || byColour(a, b) || byName(a, b),
        name: byName,
        rarity: (a, b) => (rarityRank(a) - rarityRank(b)) || byColour(a, b) || byMv(a, b) || byName(a, b),
        copies: (a, b) => (S.owned(b.name) - S.owned(a.name)) || byColour(a, b) || byMv(a, b) || byName(a, b),
        new: (a, b) => String(b.released_at || '').localeCompare(String(a.released_at || '')) || byColour(a, b) || byMv(a, b) || byName(a, b),
      };
      list.sort(SORTS[colState.sort] || SORTS.color);
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

  /**
   * A card's picture that does not give up: the printing you own, and if
   * that has no picture or it will not load (a printing whose picture was
   * not out yet when the card data was saved, a request that failed), the
   * card's usual printing from Scryfall; only failing both, the card
   * written out. Loaded lazily, so a long collection asks for what is on
   * screen.
   */
  function cardPic(c, cls) {
    const box = el('div', { class: cls });
    const img = el('img', { alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' });
    let tried = false;
    const words = () => { img.remove(); if (!box.querySelector('.card-fallback')) box.appendChild(UI.cardFallback(c, 0)); };
    const usual = async () => {
      if (tried) return words();
      tried = true;
      try {
        const other = await MTG.scry.byName(c.name);
        const u = other && MTG.scry.imageUrl(other, 'normal', 0);
        if (u && u !== img.getAttribute('src')) { img.src = u; return; }
      } catch (e) { /* no other picture to be had */ }
      words();
    };
    img.addEventListener('error', usual);
    const url = MTG.scry.imageUrl(c, 'normal', 0);
    box.appendChild(img);
    if (url) img.src = url; else usual();
    return box;
  }

  function colTile(c, host) {
    const S = E();
    const n = Math.min(4, S.owned(c.name));
    const t = el('button', { type: 'button', class: 'col-card' + (n ? '' : ' unowned') + ' r-' + S.rarityOf(c), title: c.name }, [
      cardPic(c, 'col-img'),
      el('div', { class: 'col-pips' }, [0, 1, 2, 3].map(i => el('i', { class: i < n ? 'on' : '' }))),
      UI.wishMark ? UI.wishMark(c.name) : null,
    ]);
    UI.attachPreview(t, c, 0);
    t.addEventListener('click', () => cardDetail(c, () => UI.renderCollection(host)));
    return t;
  }

  /** One card, closer: how many you own, and a wildcard to craft another. */
  function cardDetail(c, after) {
    let mm = null;
    const reopen = () => { if (mm) mm.close(); cardDetail(c, after); if (after) after(); };
    const S = E();
    const r = S.rarityOf(c);
    const have = S.owned(c.name);
    const wc = S.wildcards()[r];
    const m = mm = UI.modal({
      title: c.name,
      content: el('div', { class: 'col-detail' }, [
        cardPic(c, 'col-detail-img'),
        el('div', {}, [
          el('p', { text: `${RAR_NAME[r]} · you own ${Math.min(4, have)} of 4.` }),
          el('p', { class: 'dim' }, [document.createTextNode('Crafting takes one '), wcIcon(r, null), document.createTextNode(` ${r} wildcard. You have ${wc}.`)]),
          UI.cardStyles(c, reopen),
          UI.wishButton ? UI.wishButton(c) : null,
        ]),
      ]),
      buttons: [
        { label: 'Close', onClick: (mm) => mm.close() },
        { label: have >= 4 ? 'You have a playset' : `Craft (${RAR_NAME[r]} wildcard)`, class: 'primary', onClick: (mm) => {
          if (have >= 4) return mm.close();
          const res = S.craft(c);
          if (!res.ok) { MTG.sfx('reject'); return UI.error(res.why); }
          MTG.sfx('wildcard');
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
   * Craft all: every copy a deck lacks, with how many of each wildcard it
   * uses. When you lack wildcards, the window offers to buy the rest with
   * Shards (if you can afford them). `o.playAnyway` adds the way out for a
   * game about to start. Resolves true when the deck is complete (or is to
   * be played anyway).
   */
  UI.craftAllDialog = function (deck, o) {
    o = o || {};
    const S = E();
    const plan = S.craftPlan(deck);
    if (!plan.missing.length) return Promise.resolve(true);
    return new Promise((resolve) => {
      let buyShort = plan.shortCost > 0 && plan.canAfford;
      const rows = el('div', { class: 'craft-rows' });
      const draw = () => {
        rows.innerHTML = '';
        for (const r of RAR) {
          if (!plan.need[r]) continue;
          const short = plan.short[r];
          rows.appendChild(el('div', { class: 'craft-row' + (short ? ' short' : '') }, [
            wcIcon(r, null),
            el('span', { class: 'cr-name', text: `${RAR_NAME[r]} wildcards` }),
            el('span', { class: 'cr-need', text: `uses ${plan.need[r]}` }),
            el('span', { class: 'cr-have dim', text: `you have ${plan.have[r]}` }),
            short ? el('span', { class: 'cr-short', html: buyShort ? `buy ${short} for ${shardSvg()}${fmtN(short * S.WC_PRICES[r])}` : `${short} short` }) : null,
          ].filter(Boolean)));
        }
      };
      draw();
      const list = el('ul', { class: 'miss-list' }, plan.missing.slice(0, 60).map(m => el('li', {}, [wcIcon(m.rarity, null), document.createTextNode(` ${m.name}: need ${m.need}, have ${m.have}`)])));
      const buyBox = plan.shortCost > 0 ? el('label', { class: 'craft-buy' + (plan.canAfford ? '' : ' off') }, [
        el('input', { type: 'checkbox', class: 'switch', checked: buyShort, disabled: !plan.canAfford, onchange: (e) => { buyShort = e.target.checked; draw(); setLabel(); } }),
        el('span', { html: plan.canAfford
          ? `Buy the wildcards I lack with Shards: ${shardSvg()}<b>${fmtN(plan.shortCost)}</b> (you have ${fmtN(S.shards())})`
          : `Buying the wildcards you lack would cost ${shardSvg()}<b>${fmtN(plan.shortCost)}</b>; you have ${fmtN(S.shards())}.` }),
      ]) : null;
      const m = UI.modal({
        title: o.title || 'Craft all',
        className: 'craft-modal',
        content: el('div', { class: 'craft-all' }, [
          el('p', { text: `${deck.name || 'This deck'} needs ${plan.copies} card${plan.copies === 1 ? '' : 's'} your collection doesn’t have.` }),
          rows, buyBox, list,
        ].filter(Boolean)),
      });
      m._onClose = () => resolve(false);
      m.button('Cancel', (mm) => mm.close(), 'ghost');
      if (o.playAnyway) m.button('Play anyway (collection rules off)', (mm) => { MTG.setSetting('useCollection', false); mm._onClose = null; mm.close(); resolve(true); }, 'ghost');
      const go = m.button('', () => {
        const res = S.craftAll(deck, buyShort);
        if (res.why) { MTG.sfx('reject'); return UI.error(res.why); }
        MTG.sfx('wildcard');
        if (buyShort && plan.shortCost) setTimeout(() => MTG.sfx('purchase'), 120);
        m._onClose = null;
        m.close();
        if (res.ok) resolve(true);
        else { UI.error(`Still missing ${res.left.length} card${res.left.length === 1 ? '' : 's'}: not enough wildcards.`); resolve(false); }
      }, 'primary');
      const setLabel = () => {
        const uses = RAR.filter(r => plan.need[r]).map(r => `${Math.min(plan.need[r], buyShort ? plan.need[r] : plan.have[r])} ${r}`).join(', ');
        const whole = plan.enough || buyShort;
        go.textContent = whole ? `Craft all (${uses})` : `Craft what I can (${uses})`;
        go.disabled = !RAR.some(r => plan.need[r] && (buyShort || plan.have[r]));
      };
      setLabel();
    });
  };

  /**
   * Before a deck is played: whether the collection holds it. When it does
   * not, the craft-all window, with a way to play anyway. Starter decks and
   * the bots' decks never come here (see App.collectionAllows).
   */
  UI.checkCollection = async function (deck) {
    const S = E();
    if (!S.rulesOn() || !deck) return true;
    if (!S.missingFor(deck).length) return true;
    return UI.craftAllDialog(deck, { title: 'Cards you don’t own', playAnyway: true });
  };

  /* ---------------- the Store: wildcards ---------------- */
  function wildcardsTab(body) {
    const S = E();
    body.appendChild(el('p', { class: 'dim', text: 'A wildcard crafts any one card of its rarity. Packs give them now and then; here they are for Shards.' }));
    const grid = el('div', { class: 'store-grid wildcards' });
    for (const r of RAR) {
      const price = S.WC_PRICES[r];
      const face = () => el('div', { class: 'wc-tile-face' }, [UI.wildcardFace(r)]);
      const buyN = (n) => el('button', { type: 'button', class: 'btn buy' + (n === 1 ? ' primary' : ''), onclick: () => UI.purchaseDialog({
        title: `${n} ${RAR_NAME[r]} wildcard${n > 1 ? 's' : ''}`, sub: `You have ${S.wildcards()[r]}.`, cost: price * n, fly: Math.min(n, 5),
        visual: face(), buy: () => S.buyWildcards(r, n), after: () => { body.innerHTML = ''; wildcardsTab(body); },
      }) }, [el('span', { text: n === 1 ? '1' : '×' + n }), el('span', { class: 'buy-price', html: shardSvg() + fmtN(price * n) })]);
      grid.appendChild(el('div', { class: 'store-card wc-tile' }, [
        face(),
        el('div', { class: 'sc-title', text: `${RAR_NAME[r]} wildcard` }),
        el('div', { class: 'sc-sub dim', text: `You have ${S.wildcards()[r]}` }),
        el('div', { class: 'pack-buys' }, [buyN(1), buyN(5)]),
      ]));
    }
    body.appendChild(grid);
  }

})(window.MTG);
