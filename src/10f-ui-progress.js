'use strict';
/* ============================================================
   10f-ui-progress.js - the inbox, and the Profile screen

   The screens for src/10e-progress.js: an inbox in the top bar where what
   you have earned waits to be claimed (and claiming it is a moment), and a
   Profile screen with your stats, the daily quests, the weekly track and
   the login streak, the season's mastery track, the ranked ladder, and
   achievements and the titles they give.
   ============================================================ */
(function (MTG) {
  const { el } = MTG;
  const UI = MTG.ui;
  const P = () => MTG.progress;
  const E = () => MTG.economy;
  const fmtN = (n) => Number(n || 0).toLocaleString();
  const shard = () => (UI.shardIcon ? UI.shardIcon() : '');
  const RAR_NAME = { common: 'Common', uncommon: 'Uncommon', rare: 'Rare', mythic: 'Mythic' };

  /** A reward, drawn: Shards, packs, a wildcard, XP, a sleeve. */
  function rewardChips(rw) {
    rw = rw || {};
    const out = [];
    if (rw.shards) out.push(el('span', { class: 'rw rw-shards', html: `${shard()}<b>${fmtN(rw.shards)}</b>` }));
    if (rw.pack) out.push(el('span', { class: 'rw rw-pack', html: `<i class="rw-pack-ico"></i><b>${rw.pack}</b> pack${rw.pack === 1 ? '' : 's'}` }));
    if (rw.wc) out.push(el('span', { class: 'rw rw-wc', html: `${UI.wildcardIconHtml ? UI.wildcardIconHtml(rw.wc) : ''}<b>${RAR_NAME[rw.wc]}</b> wildcard` }));
    if (rw.xp) out.push(el('span', { class: 'rw rw-xp', html: `<b>${fmtN(rw.xp)}</b> XP` }));
    if (rw.sleeve) out.push(el('span', { class: 'rw rw-sleeve', html: '<i class="rw-sleeve-ico"></i><b>Set sleeve</b>' }));
    return el('span', { class: 'rw-row' }, out);
  }
  UI.rewardChips = rewardChips;

  /* ---------------- the ranks' symbols ---------------- */
  /* Each tier its own shape and its own mark, so a rank reads at a glance
     and at any size: Bronze a shield with one chevron, Silver with two,
     Gold a crowned crest, Platinum a hexagon with a star, Diamond a gem,
     Mythic a burst with a flame. */
  const SHIELD = 'M32 3 L57 11 V35 C57 51 46 62 32 69 C18 62 7 51 7 35 V11 Z';
  const CREST = 'M32 2 L40 9 L57 7 V35 C57 51 46 62 32 69 C18 62 7 51 7 35 V7 L24 9 Z';
  const HEX = 'M32 3 L59 18.5 V51.5 L32 69 L5 51.5 V18.5 Z';
  const GEM = 'M32 2 L61 33 L32 70 L3 33 Z';
  const BURST = (() => {
    const pts = [];
    for (let i = 0; i < 16; i++) {
      const a = -Math.PI / 2 + i * Math.PI / 8, r = i % 2 ? 22 : 34;
      pts.push((32 + r * Math.cos(a)).toFixed(1) + ' ' + (36 + r * Math.sin(a)).toFixed(1));
    }
    return 'M' + pts.join(' L') + ' Z';
  })();
  const EMBLEMS = {
    Bronze: { shape: SHIELD, a: '#eeb27c', b: '#7a4220', rim: '#ffd6b0', ink: '#fff4e8',
      mark: '<path d="M20 45 L32 33 L44 45" fill="none" stroke-width="6.5" stroke-linecap="round" stroke-linejoin="round"/>' },
    Silver: { shape: SHIELD, a: '#f6f8fb', b: '#78808d', rim: '#ffffff', ink: '#2a2f38',
      mark: '<path d="M20 40 L32 28 L44 40 M20 52 L32 40 L44 52" fill="none" stroke-width="6" stroke-linecap="round" stroke-linejoin="round"/>' },
    Gold: { shape: CREST, a: '#ffeaa8', b: '#a8761c', rim: '#fff4c8', ink: '#4a3208',
      mark: '<path d="M17.5 46 L19.5 27 L26.5 35 L32 24 L37.5 35 L44.5 27 L46.5 46 Z" stroke="none"/><rect x="17.5" y="49" width="29" height="4.5" rx="1.6" stroke="none"/>' },
    Platinum: { shape: HEX, a: '#cdf5ee', b: '#2c7a72', rim: '#eafffb', ink: '#ffffff',
      mark: '<path d="M32 19 L36.5 32 L49.5 36 L36.5 40 L32 53 L27.5 40 L14.5 36 L27.5 32 Z" stroke="none"/>' },
    Diamond: { shape: GEM, a: '#d8ecff', b: '#3459c4', rim: '#f0f7ff', ink: '#ffffff',
      mark: '<path d="M20 32 L26.5 24.5 H37.5 L44 32 L32 49 Z" stroke="none"/><path d="M20 32 H44 M26.5 24.5 L29.5 32 L32 49 M37.5 24.5 L34.5 32 L32 49" fill="none" stroke-width="1.5" class="re-facet"/>' },
    Mythic: { shape: BURST, a: '#ffc68f', b: '#b4330c', rim: '#ffe2c6', ink: '#fff3e2',
      mark: '<path d="M32 19 C35 28 43 31 41.5 41.5 C40.5 48.5 36.5 52.5 32 53 C27.5 52.5 23.5 48.5 22.5 41.5 C21.8 35 26.5 31.5 27.5 25.5 C29.5 29.5 30.8 31.5 33 33 C34.2 28 33.4 23 32 19 Z" stroke="none"/>' },
  };
  let emblemSeq = 0;
  /* The Commander ladder's badges are medallions in a laurel wreath, the
     tier's mark at the heart and the division on a ribbon; Standard's are
     the tier's own shield. Both are lit the same way: a bevel round the
     edge, a sheen across the top, a shade at the foot. From Platinum up
     a Standard badge grows wings; Mythic glows. */
  const WREATH = (() => {
    let out = '';
    // seven leaves up each side, along the rim from the foot to near the top, leaning outward
    const leaf = (x, y, rot) => `<ellipse cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" rx="5.6" ry="2.4" transform="rotate(${rot.toFixed(0)} ${x.toFixed(1)} ${y.toFixed(1)})"/>`;
    for (let i = 0; i < 7; i++) {
      const deg = 128 + i * 17, t = deg * Math.PI / 180;
      const x = 32 + 30 * Math.cos(t), y = 35 - 30 * Math.sin(t);
      const rot = -(deg + 90) - 22;
      out += leaf(x, y, rot) + leaf(64 - x, y, 180 - rot);
    }
    return out;
  })();
  const WINGS = '<path d="M9 24 C1 19 -6 25 -6 33 C-2 30 2 30 5 31 C-1 34 -3 41 -1 46 C2 41 6 39 9 39 C5 43 5 48 7 51 C9 46 12 44 14 44 Z"/>' +
    '<path d="M55 24 C63 19 70 25 70 33 C66 30 62 30 59 31 C65 34 67 41 65 46 C62 41 58 39 55 39 C59 43 59 48 57 51 C55 46 52 44 50 44 Z"/>';
  /**
   * A rank's badge. `opts.size` is its width in pixels; `opts.div` puts the
   * division at its foot; `opts.ladder` is 'standard' (a shield, the
   * default) or 'commander' (a medallion in a wreath).
   */
  UI.rankEmblem = function (tier, opts) {
    opts = opts || {};
    const e = EMBLEMS[tier] || EMBLEMS.Bronze;
    const ti = (P().TIERS || []).indexOf(tier);
    const cmd = opts.ladder === 'commander';
    const id = 'rem' + (++emblemSeq);
    const w = opts.size || 48, h = Math.round(w * 74 / 64);
    const facet = tier === 'Diamond' ? e.b : e.ink;
    const shape = cmd ? 'M32 9 A26 26 0 1 1 31.99 9 Z' : e.shape;
    // the mark, smaller inside a medallion, with a shadow under it
    const markAt = cmd ? 'translate(32 35) scale(.74) translate(-32 -37)' : '';
    const mark = `<g transform="${markAt}"><g transform="translate(0 1.4)" fill="rgba(0,0,0,.35)" stroke="rgba(0,0,0,.35)">${e.mark}</g>` +
      `<g fill="${e.ink}" stroke="${e.ink}" style="--facet:${facet}">${e.mark}</g></g>`;
    const seal = !opts.div ? '' : cmd
      ? `<path d="M13 58 H51 L47.5 63.5 L51 69 H13 L16.5 63.5 Z" fill="url(#${id})" stroke="${e.rim}" stroke-width="1.6" stroke-linejoin="round"/>` +
        `<text x="32" y="66.6" text-anchor="middle" font-size="9" font-weight="800" fill="${e.ink}" font-family="system-ui, sans-serif" letter-spacing=".5">${opts.div}</text>`
      : `<circle cx="32" cy="64" r="8.5" fill="#12151c" stroke="${e.rim}" stroke-width="2"/>` +
        `<text x="32" y="67.6" text-anchor="middle" font-size="10.5" font-weight="800" fill="#fff" font-family="system-ui, sans-serif">${opts.div}</text>`;
    const behind = cmd
      ? `<g fill="${e.rim}" opacity=".9">${WREATH}</g><g fill="${e.b}" opacity=".45" transform="translate(0 .8)">${WREATH}</g>`
      : ti >= 3 ? `<g fill="url(#${id}w)" stroke="${e.rim}" stroke-width=".8" opacity=".95">${WINGS}</g>` : '';
    const svg = `<svg viewBox="0 0 64 74" width="${w}" height="${h}" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id="${id}" x1="0" y1="0" x2=".35" y2="1"><stop offset="0" stop-color="${e.a}"/><stop offset="1" stop-color="${e.b}"/></linearGradient>
        <linearGradient id="${id}w" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${e.a}"/><stop offset="1" stop-color="${e.b}" stop-opacity=".7"/></linearGradient>
        <radialGradient id="${id}s" cx=".34" cy=".16" r=".62"><stop offset="0" stop-color="#fff" stop-opacity=".6"/><stop offset=".55" stop-color="#fff" stop-opacity=".08"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient>
        <linearGradient id="${id}d" x1="0" y1="0" x2="0" y2="1"><stop offset=".5" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".32"/></linearGradient>
      </defs>
      ${behind}
      <path d="${shape}" fill="url(#${id})" stroke="${e.rim}" stroke-width="2.6" stroke-linejoin="round"/>
      <path d="${shape}" fill="url(#${id}d)"/>
      <path d="${shape}" fill="none" stroke="rgba(0,0,0,.28)" stroke-width="1.2" transform="translate(32 36) scale(.84) translate(-32 -36)"/>
      <path d="${shape}" fill="none" stroke="rgba(255,255,255,.4)" stroke-width=".9" transform="translate(32 36) scale(.8) translate(-32 -36)"/>
      <path d="${shape}" fill="url(#${id}s)"/>
      ${mark}
      ${seal}
    </svg>`;
    return el('span', {
      class: 'rank-emblem re-' + String(tier).toLowerCase() + (cmd ? ' re-cmd' : '') + (opts.cls ? ' ' + opts.cls : ''), html: svg,
      'aria-label': (cmd ? 'Commander ' : '') + tier + (opts.div ? ' ' + opts.div : ''),
    });
  };

  /** One ladder's standing: its symbol, rank, steps, the next rank, and a button to play it. */
  UI.ladderCard = function (ladderId, onPlay, opts) {
    opts = opts || {};
    const L = P().LADDERS.find(x => x.id === ladderId) || P().LADDERS[0];
    const r = P().ladder(L.id);
    const next = P().nextRank(r);
    const steps = el('div', { class: 'rank-steps' }, Array.from({ length: P().STEPS }, (_, i) => el('i', { class: i < r.step ? 'on' : '' })));
    return el('section', { class: 'panel ladder ladder-' + L.id + (opts.cls ? ' ' + opts.cls : '') }, [
      UI.rankEmblem(r.tier, { size: opts.size || 96, div: r.tier === 'Mythic' ? null : r.div, ladder: L.id }),
      el('div', { class: 'ladder-body' }, [
        el('span', { class: 'ladder-name', text: `${L.name} ranked` }),
        el('h3', { text: P().rankLabel(r) }),
        r.tier === 'Mythic' ? el('p', { class: 'ladder-next', text: `${r.step} win${r.step === 1 ? '' : 's'} clear at the top.` }) : steps,
        next ? el('p', { class: 'ladder-next', text: `${next.wins} more win${next.wins === 1 ? '' : 's'} to ${next.label}` }) : null,
        el('p', { class: 'dim small', text: `Best this season: ${r.best}. ${L.id === 'commander' ? 'One against one, 40 life, with a Commander deck.' : 'One against one, with a Standard deck.'}` }),
        onPlay ? el('button', { type: 'button', class: 'btn primary', text: `Play ${L.name}`, onclick: () => onPlay(L.id) }) : null,
      ].filter(Boolean)),
    ]);
  };

  /** Which ladder to play: both side by side, each with its rank. */
  UI.rankedChooser = function (onPlay) {
    let m = null;
    const pick = (id) => { if (m) m.close(); onPlay(id); };
    m = UI.modal({ title: 'Ranked', width: '760px', className: 'ranked-chooser',
      content: el('div', {}, [
        el('p', { class: 'dim', text: 'Two ladders, each climbed on its own, from Bronze to Mythic. The bots get stronger as you rise.' }),
        el('div', { class: 'ladders' }, P().LADDERS.map(L => UI.ladderCard(L.id, pick, { size: 84 }))),
      ]) });
    return m;
  };

  /* ---------------- the inbox ---------------- */
  const BELL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a6 6 0 0 0-6 6v3.2c0 .9-.3 1.8-.9 2.5L4 16h16l-1.1-1.3a3.9 3.9 0 0 1-.9-2.5V9a6 6 0 0 0-6-6z" fill="currentColor" opacity=".9"/><path d="M9.5 18.5a2.5 2.5 0 0 0 5 0" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>';
  /** The inbox in the top bar: a bell, and how many rewards wait. */
  UI.inboxChip = function () {
    const n = el('b', { class: 'ib-n' });
    const chip = el('button', { type: 'button', class: 'inbox-chip', title: 'Rewards to claim', 'aria-label': 'Inbox', onclick: () => UI.openInbox() }, [
      el('span', { class: 'ib-bell', html: BELL }), n,
    ]);
    let last = -1;
    const draw = () => {
      const c = P().inboxCount();
      n.textContent = c ? String(c) : '';
      chip.classList.toggle('has', !!c);
      if (c > last && last >= 0) { chip.classList.remove('ring'); void chip.offsetWidth; chip.classList.add('ring'); MTG.sfx('notify'); }
      last = c;
    };
    draw();
    MTG.bus.on('progress:changed', draw);
    return chip;
  };

  /** The inbox itself: each reward, and a claim for it or for all. */
  UI.openInbox = function () {
    const list = el('div', { class: 'inbox-list' });
    const m = UI.modal({ title: 'Inbox', content: list, className: 'inbox-modal' });
    const all = m.button('Claim all', () => claimAll(), 'primary');
    m.button('Close', (mm) => mm.close(), 'ghost');
    let newest = null;
    MTG.scry.draftableSets().then(s => { newest = s[0] || null; }).catch(() => {});
    const draw = () => {
      const box = P().state.inbox.slice().reverse();
      list.innerHTML = '';
      all.disabled = !box.length;
      if (!box.length) { list.appendChild(el('div', { class: 'inbox-empty', html: '<b>All caught up.</b><span>Quests, the weekly track, mastery levels and more send their rewards here.</span>' })); return; }
      for (const msg of box) {
        const row = el('div', { class: 'inbox-row k-' + msg.kind }, [
          el('div', { class: 'ir-ico' }),
          el('div', { class: 'ir-text' }, [el('b', { text: msg.title }), msg.body ? el('span', { class: 'dim', text: msg.body }) : null, rewardChips(msg.reward)].filter(Boolean)),
          el('button', { type: 'button', class: 'btn primary sm', text: Object.keys(msg.reward || {}).length ? 'Claim' : 'OK', onclick: () => claimOne(msg.id, row) }),
        ]);
        list.appendChild(row);
      }
    };
    const claimOne = (id, row) => {
      const r = P().claim(id, newest);
      if (!r) return;
      const rw = r.m.reward || {};
      if (row) { row.classList.add('claimed'); burst(row); }
      if (rw.shards) MTG.sfx('shards', { intensity: Math.min(1, rw.shards / 10000) });
      if (rw.pack) setTimeout(() => MTG.sfx('pack_land', {}), 120);
      if (rw.wc) setTimeout(() => MTG.sfx('wildcard'), 80);
      if (!rw.shards && !rw.pack && !rw.wc) MTG.sfx('confirm');
      if (r.levels && r.levels.length) setTimeout(() => levelUp(r.levels[r.levels.length - 1]), 500);
      setTimeout(draw, row ? 380 : 0);
    };
    const claimAll = () => {
      const ids = P().state.inbox.map(x => x.id);
      const rows = [...list.querySelectorAll('.inbox-row')];
      rows.forEach((r, i) => setTimeout(() => { r.classList.add('claimed'); burst(r); }, i * 60));
      let shards = 0, packs = 0, wcs = 0;
      for (const id of ids) {
        const msg = P().state.inbox.find(x => x.id === id);
        if (msg) { shards += (msg.reward || {}).shards || 0; packs += (msg.reward || {}).pack || 0; wcs += (msg.reward || {}).wc ? 1 : 0; }
        P().claim(id, newest);
      }
      MTG.sfx('purchase');
      if (shards) setTimeout(() => MTG.sfx('shards', { intensity: 1 }), 200);
      if (wcs) setTimeout(() => MTG.sfx('wildcard'), 380);
      setTimeout(draw, rows.length * 60 + 300);
      UI.ok(`Claimed: ${[shards && fmtN(shards) + ' Shards', packs && packs + ' pack' + (packs === 1 ? '' : 's'), wcs && wcs + ' wildcard' + (wcs === 1 ? '' : 's')].filter(Boolean).join(', ') || 'everything'}.`);
    };
    draw();
    return m;
  };
  function burst(node) {
    const r = node.getBoundingClientRect();
    const b = el('div', { class: 'buy-sparks', style: { left: (r.right - 60) + 'px', top: (r.top + r.height / 2) + 'px' } });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      b.appendChild(el('i', { style: { '--dx': (Math.cos(a) * 40).toFixed(0) + 'px', '--dy': (Math.sin(a) * 26).toFixed(0) + 'px', '--d': '0s' } }));
    }
    document.body.appendChild(b);
    setTimeout(() => b.remove(), 800);
  }
  /** A mastery level reached: a banner for a moment. */
  function levelUp(level) {
    const b = el('div', { class: 'level-up' }, [el('span', { text: 'Mastery level' }), el('b', { text: String(level) })]);
    document.body.appendChild(b);
    MTG.sfx('reveal_rare');
    setTimeout(() => b.classList.add('out'), 1800);
    setTimeout(() => b.remove(), 2400);
  }
  UI.levelUp = levelUp;

  /* ---------------- the Profile screen ---------------- */
  let tab = 'overview';
  UI.renderProfile = function (host, opts) {
    opts = opts || {};
    const S = P().state;
    host.innerHTML = '';
    const name = (MTG.app && MTG.app.myName) || 'You';
    const lvlPct = Math.min(100, 100 * (S.xp - S.level * P().XP_LEVEL) / P().XP_LEVEL);
    const titleSel = el('select', { class: 'title-select', 'aria-label': 'Your title' }, [el('option', { value: '', text: 'No title' })].concat(
      P().titles().map(t => el('option', { value: t, text: t, selected: S.title === t }))));
    titleSel.addEventListener('change', () => { P().setTitle(titleSel.value); UI.ok(titleSel.value ? `Your title is now "${titleSel.value}".` : 'Title removed.'); });
    const head = el('div', { class: 'profile-head' }, [
      el('button', { type: 'button', class: 'portrait-btn', title: 'Change your name and picture', onclick: () => MTG.app.editProfile && MTG.app.editProfile() },
        [UI.portrait(name, null, { size: 'lg', avatar: MTG.settings.avatar, frame: E().frameWorn() })]),
      el('div', { class: 'ph-who' }, [
        el('h1', { text: name }),
        el('div', { class: 'ph-sub' }, [titleSel, el('span', { class: 'dim', text: `Mastery level ${S.level} · ` + P().LADDERS.map(L => `${L.name} ${P().rankLabel(P().ladder(L.id))}`).join(' · ') })]),
        el('div', { class: 'ph-xp', title: `${fmtN(S.xp)} XP this season` }, [el('i', { style: { width: lvlPct.toFixed(0) + '%' } })]),
      ]),
      el('div', { class: 'ph-actions' }, [
        // friends, your wishlist and your trades (src/10g-ui-social.js)
        UI.openFriends ? el('button', { type: 'button', class: 'btn', html: `${UI.socialIcons.people}<span>Friends</span>`, onclick: () => UI.openFriends() }) : null,
        el('button', { type: 'button', class: 'btn', html: `${BELL}<span>Inbox${S.inbox.length ? ` (${S.inbox.length})` : ''}</span>`, onclick: () => UI.openInbox() }),
      ]),
    ]);
    const tabs = el('div', { class: 'store-tabs', role: 'tablist' });
    const body = el('div', { class: 'profile-body' });
    const TABS = [['overview', 'Overview'], ['history', 'History'], ['quests', 'Quests'], ['mastery', 'Mastery'], ['ranked', 'Ranked'], ['achievements', 'Achievements']];
    const show = (id) => {
      tab = id;
      for (const b of tabs.children) b.setAttribute('aria-selected', b.dataset.tab === id ? 'true' : 'false');
      body.innerHTML = '';
      // every game and match you have finished: src/10h-ui-history.js
      ({ overview, history: UI.renderHistory, quests, mastery, ranked, achievements })[id](body, opts);
    };
    for (const [id, label] of TABS) tabs.appendChild(el('button', { type: 'button', role: 'tab', class: 'store-tab', dataset: { tab: id }, text: label, onclick: () => show(id) }));
    host.append(el('div', { class: 'profile' }, [head, tabs, body]));
    show(opts.tab || tab);
    const off = MTG.bus.on('progress:changed', () => { if (!host.isConnected) { off(); return; } });
  };

  /* -- overview: what you have played, and what you have collected -- */
  function overview(body) {
    const S = P().state, st = S.stats;
    const rate = (w, g) => g ? Math.round(100 * w / g) + '%' : '–';
    const tile = (label, value, sub) => el('div', { class: 'stat-tile' }, [el('b', { text: value }), el('span', { text: label }), sub ? el('i', { text: sub }) : null].filter(Boolean));
    body.appendChild(el('div', { class: 'stat-grid' }, [
      tile('Games', fmtN(st.games)), tile('Wins', fmtN(st.wins), rate(st.wins, st.games) + ' won'),
      tile('Spells cast', fmtN(st.spells)), tile('Damage dealt', fmtN(st.damage)),
      tile('Quests done', fmtN(st.quests)), tile('Packs opened', fmtN(E().state.opened || 0)),
      tile('Cards owned', fmtN(Object.keys(E().collection()).length), 'different'), tile('Shards earned', fmtN(st.shardsEarned)),
    ]));
    // by format and by deck
    const table = (title, rows) => el('section', { class: 'panel stat-table' }, [el('h3', { text: title }),
      rows.length ? el('table', {}, [el('tr', {}, [el('th', { text: '' }), el('th', { text: 'Games' }), el('th', { text: 'Wins' }), el('th', { text: 'Win rate' })]),
        ...rows.map(([k, v]) => el('tr', {}, [el('td', { text: k }), el('td', { text: fmtN(v.g) }), el('td', { text: fmtN(v.w) }), el('td', { text: rate(v.w, v.g) })]))])
        : el('p', { class: 'dim', text: 'Nothing yet: play a game.' })]);
    const fmtName = (id) => ((MTG.formats.get && MTG.formats.get(id)) || {}).name || id;
    body.appendChild(el('div', { class: 'stat-tables' }, [
      table('By format', Object.entries(st.byFormat).map(([k, v]) => [fmtName(k), v]).sort((a, b) => b[1].g - a[1].g)),
      table('Your decks', Object.entries(st.byDeck).sort((a, b) => b[1].w - a[1].w || b[1].g - a[1].g).slice(0, 12)),
    ]));
    // set completion
    const sets = el('section', { class: 'panel set-progress' }, [el('h3', { text: 'Collection by set' }), el('p', { class: 'dim', text: 'Own a playset of every card of a rarity in a set, or of the whole set, for a reward; a whole set also gives the set’s own sleeve.' })]);
    const list = el('div', { class: 'set-rows' }, [el('div', { class: 'dim', text: 'Working it out…' })]);
    sets.appendChild(list);
    body.appendChild(sets);
    setCompletion(list);
  }
  async function setCompletion(list) {
    const eco = E();
    const col = eco.collection();
    const bySet = new Map();
    for (const [, e] of Object.entries(col)) if (e.s && e.n) bySet.set(e.s, (bySet.get(e.s) || 0) + 1);
    const codes = [...bySet.keys()].sort((a, b) => bySet.get(b) - bySet.get(a)).slice(0, 12);
    const sets = await MTG.scry.draftableSets().catch(() => []);
    list.innerHTML = '';
    if (!codes.length) { list.appendChild(el('div', { class: 'dim', text: 'Open some packs to start collecting sets.' })); return; }
    for (const code of codes) {
      let pool = null;
      try { pool = await MTG.scry.setPool(code); } catch (e) { pool = null; }
      if (!pool || !pool.all) continue;
      const names = [...new Set(pool.all.filter(c => !eco.isBasic(c.name)).map(c => c.name))];
      const have = names.filter(n => eco.owned(n) > 0).length;
      const full = names.filter(n => eco.owned(n) >= 4).length;
      const info = sets.find(s => s.code === code) || { name: code.toUpperCase() };
      list.appendChild(el('div', { class: 'set-row' }, [
        info.icon_svg_uri ? el('img', { class: 'sr-icon', src: info.icon_svg_uri, alt: '' }) : el('span'),
        el('span', { class: 'sr-name', text: info.name }),
        el('span', { class: 'sr-bar', title: `${have} of ${names.length} owned; ${full} playsets` }, [
          el('i', { class: 'sr-have', style: { width: (100 * have / names.length).toFixed(1) + '%' } }),
          el('i', { class: 'sr-full', style: { width: (100 * full / names.length).toFixed(1) + '%' } }),
        ]),
        el('span', { class: 'sr-n', text: `${have}/${names.length}` }),
      ]));
    }
  }

  /* -- quests: the day's, the week's, and the streak -- */
  function quests(body) {
    const S = P().state;
    const qs = el('section', { class: 'panel quests' }, [el('h3', { text: 'Daily quests' }),
      el('p', { class: 'dim', text: 'A new quest each day (up to three waiting). Swap one a day if you do not like it.' })]);
    if (!S.quests.length) qs.appendChild(el('div', { class: 'dim', text: 'All done: a new one tomorrow.' }));
    for (const q of S.quests) {
      qs.appendChild(el('div', { class: 'quest' }, [
        el('div', { class: 'q-text' }, [el('b', { text: P().questText(q) }), rewardChips({ shards: q.reward, xp: q.xp })]),
        el('div', { class: 'q-bar' }, [el('i', { style: { width: (100 * Math.min(q.n, q.goal) / q.goal).toFixed(0) + '%' } })]),
        el('span', { class: 'q-n', text: `${Math.min(q.n, q.goal)}/${q.goal}` }),
        el('button', { type: 'button', class: 'btn xs ghost', text: 'Swap', disabled: S.rerollDay === new Date().toISOString().slice(0, 10),
          title: 'Swap this quest for another (once a day)', onclick: () => { const r = P().reroll(q.id); if (!r.ok) return UI.error(r.why); MTG.sfx('confirm'); body.innerHTML = ''; quests(body); } }),
      ]));
    }
    // the weekly track
    const wk = el('section', { class: 'panel weekly' }, [el('h3', { text: `Weekly wins: ${S.weekly.wins} of 15` }),
      el('p', { class: 'dim', text: 'Rewards for wins this week, Monday to Sunday.' })]);
    const track = el('div', { class: 'wk-track' });
    for (const r of P().WEEKLY) {
      const got = S.weekly.wins >= r.wins;
      track.appendChild(el('div', { class: 'wk-node' + (got ? ' got' : '') + (S.weekly.wins + 1 === r.wins ? ' next' : ''), title: P().describe(r) }, [
        el('b', { text: String(r.wins) }), el('i', { class: 'wk-ico ' + (r.wc ? 'w-wc' : r.pack ? 'w-pack' : 'w-shards') }),
      ]));
    }
    wk.appendChild(track);
    // the login streak
    const lg = el('section', { class: 'panel login' }, [el('h3', { text: `Login streak: ${S.login.streak} day${S.login.streak === 1 ? '' : 's'}` }),
      el('p', { class: 'dim', text: 'A gift each day you play, better each day in a row; the seventh is the best.' })]);
    const days = el('div', { class: 'lg-days' });
    const at = ((S.login.streak - 1) % 7) + 1;
    P().LOGIN.forEach((g, i) => {
      const rw = typeof g === 'number' ? { shards: g } : g;
      days.appendChild(el('div', { class: 'lg-day' + (i + 1 <= at ? ' got' : '') + (i + 1 === at ? ' today' : '') }, [el('span', { text: `Day ${i + 1}` }), rewardChips(rw)]));
    });
    lg.appendChild(days);
    body.append(qs, wk, lg);
  }

  /**
   * The season's mastery track: a medallion for each level on a line that
   * fills as you climb, gold where you have been, the next one lit with how
   * far you are into it, every tenth a milestone, and what each one pays
   * beneath it. `opts.window` shows only that many levels round where you
   * are (Home); `opts.onOpen` makes the whole of it a way to the full track.
   */
  UI.masteryTrack = function (opts) {
    opts = opts || {};
    const S = P().state, L = P().LEVELS, XPL = P().XP_LEVEL;
    const into = Math.max(0, S.xp - S.level * XPL);
    const frac = S.level >= L ? 1 : Math.min(1, into / XPL);
    let from = 1, to = L;
    if (opts.window) {
      from = Math.max(1, Math.min(L - opts.window + 1, S.level - 1));
      to = Math.min(L, from + opts.window - 1);
    }
    const rail = el('div', { class: 'mt2-rail' });
    for (let lv = from; lv <= to; lv++) {
      const got = S.level >= lv, next = S.level + 1 === lv;
      // the stretch of line leading up to this level: full once reached, part-way for the next
      const fill = got ? 1 : next ? frac : 0;
      rail.appendChild(el('div', { class: 'mt2-node' + (got ? ' got' : '') + (next ? ' next' : '') + (lv % 10 === 0 ? ' big' : lv % 5 === 0 ? ' mid' : '') }, [
        lv > from || from > 1 ? el('span', { class: 'mt2-link', 'aria-hidden': 'true' }, [el('i', { style: { width: (fill * 100).toFixed(0) + '%' } })]) : null,
        el('span', { class: 'mt2-medal', 'aria-label': `Level ${lv}${got ? ', reached' : next ? `, ${Math.round(frac * 100)}% of the way` : ''}` }, [el('b', { text: String(lv) })]),
        el('div', { class: 'mt2-rw' }, [rewardChips(P().masteryReward(lv))]),
      ].filter(Boolean)));
    }
    const head = el('div', { class: 'mt2-head' }, [
      el('div', { class: 'mt2-title' }, [
        el('span', { class: 'mt2-eyebrow', text: `${P().seasonName(S.season)} mastery` }),
        el('b', { class: 'mt2-level', text: `Level ${S.level}` }),
        el('span', { class: 'mt2-of dim', text: `of ${L}` }),
      ]),
      el('div', { class: 'mt2-next' }, S.level >= L ? [el('span', { text: 'Every level reached this season' })] : [
        el('span', { class: 'mt2-xp', text: `${fmtN(XPL - into)} XP to level ${S.level + 1}` }),
        el('span', { class: 'mt2-bar' }, [el('i', { style: { width: (frac * 100).toFixed(0) + '%' } })]),
      ]),
      opts.onOpen ? el('span', { class: 'mt2-open', text: 'The whole track \u203a' }) : null,
    ].filter(Boolean));
    const box = el(opts.onOpen ? 'button' : 'section', {
      class: 'mt2' + (opts.window ? ' compact' : ''), type: opts.onOpen ? 'button' : null,
      onclick: opts.onOpen || null, 'aria-label': opts.onOpen ? `Mastery level ${S.level}: open the whole track` : null,
    }, [head, rail]);
    // the level you are on in view
    setTimeout(() => { const n = rail.querySelector('.mt2-node.next') || rail.querySelector('.mt2-node.got:last-of-type'); if (n && rail.scrollWidth > rail.clientWidth) rail.scrollLeft = n.offsetLeft - rail.clientWidth / 2 + n.offsetWidth / 2; }, 30);
    return box;
  };

  /* -- mastery: the season's fifty levels -- */
  function mastery(body) {
    body.appendChild(UI.masteryTrack());
    body.appendChild(el('p', { class: 'dim mt2-note', text: `${P().XP.win} XP a win, ${P().XP.play} a game, more for quests. The track starts again each month.` }));
  }

  /* -- ranked: the ladder against the bots -- */
  function ranked(body, opts) {
    const S = P().state;
    const left = P().untilReset().season;
    body.appendChild(el('div', { class: 'ladders' }, P().LADDERS.map(L => UI.ladderCard(L.id, opts.onRanked || null))));
    body.appendChild(el('p', { class: 'dim ladder-rules', text: `${P().seasonName(S.ranked.season)} season, ${left} day${left === 1 ? '' : 's'} left. A win moves you up a step (two in Bronze and Silver); a loss moves you down one, but never out of a tier you have reached. Opponents get stronger as you climb.` }));
    // the best tier on either ladder lights the rewards it has reached; each ladder pays for its own
    const ti = Math.max(...P().LADDERS.map(L => P().TIERS.indexOf(P().ladder(L.id).tier)));
    body.appendChild(el('section', { class: 'panel' }, [el('h3', { text: 'Season rewards' }), el('p', { class: 'dim', text: 'Paid at the end of the month for the tier you finish in, on each ladder.' }),
      el('div', { class: 'rank-rewards' }, P().TIERS.map((t, i) => el('div', { class: 'rr' + (i <= ti ? ' got' : '') }, [
        el('span', { class: 'rr-badges' }, [UI.rankEmblem(t, { size: 46 }), UI.rankEmblem(t, { size: 46, ladder: 'commander' })]),
        el('b', { class: 'rr-name', text: t }), rewardChips(P().RANK_REWARD[t]),
      ])))]));
  }

  /* -- achievements and titles -- */
  function achievements(body) {
    const S = P().state;
    const n = Object.keys(S.achievements).length;
    body.appendChild(el('p', { class: 'dim', text: `${n} of ${P().ACHIEVEMENTS.length} done. Many give a title to show under your name at the table.` }));
    const grid = el('div', { class: 'ach-grid' });
    for (const a of P().ACHIEVEMENTS) {
      const got = S.achievements[a.id];
      grid.appendChild(el('div', { class: 'ach' + (got ? ' got' : '') }, [
        el('div', { class: 'ach-badge', text: got ? '★' : '☆' }),
        el('div', {}, [el('b', { text: a.name }), el('span', { class: 'dim', text: a.text }),
          el('span', { class: 'ach-meta' }, [a.title ? el('span', { class: 'ach-title', text: `Title: ${a.title}` }) : null, a.shards ? rewardChips({ shards: a.shards }) : null].filter(Boolean))]),
      ]));
    }
    body.appendChild(grid);
  }
})(window.MTG);
