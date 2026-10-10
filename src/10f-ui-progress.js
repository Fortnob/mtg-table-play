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
        el('div', { class: 'ph-sub' }, [titleSel, el('span', { class: 'dim', text: `Mastery level ${S.level} · ${P().rankLabel(S.ranked)}` })]),
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
    const TABS = [['overview', 'Overview'], ['quests', 'Quests'], ['mastery', 'Mastery'], ['ranked', 'Ranked'], ['achievements', 'Achievements']];
    const show = (id) => {
      tab = id;
      for (const b of tabs.children) b.setAttribute('aria-selected', b.dataset.tab === id ? 'true' : 'false');
      body.innerHTML = '';
      ({ overview, quests, mastery, ranked, achievements })[id](body, opts);
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

  /* -- mastery: the season's fifty levels -- */
  function mastery(body) {
    const S = P().state;
    const into = S.xp - S.level * P().XP_LEVEL;
    body.appendChild(el('section', { class: 'panel' }, [
      el('h3', { text: `${P().seasonName(S.season)} mastery: level ${S.level} of ${P().LEVELS}` }),
      el('p', { class: 'dim', text: `${P().XP.win} XP a win, ${P().XP.play} a game, more for quests. ${fmtN(P().XP_LEVEL - into)} XP to the next level. The track starts again each month.` }),
    ]));
    const grid = el('div', { class: 'mastery-track' });
    for (let lv = 1; lv <= P().LEVELS; lv++) {
      const got = S.level >= lv;
      grid.appendChild(el('div', { class: 'mt-node' + (got ? ' got' : '') + (S.level + 1 === lv ? ' next' : '') + (lv % 10 === 0 ? ' big' : '') }, [
        el('b', { text: String(lv) }), rewardChips(P().masteryReward(lv)),
        S.level + 1 === lv ? el('span', { class: 'mt-bar' }, [el('i', { style: { width: (100 * into / P().XP_LEVEL).toFixed(0) + '%' } })]) : null,
      ].filter(Boolean)));
    }
    body.appendChild(grid);
    setTimeout(() => { const n = grid.querySelector('.mt-node.next'); if (n) n.scrollIntoView({ block: 'nearest', inline: 'center' }); }, 50);
  }

  /* -- ranked: the ladder against the bots -- */
  function ranked(body, opts) {
    const S = P().state, r = S.ranked;
    const ti = P().TIERS.indexOf(r.tier);
    const crest = el('div', { class: 'rank-crest t-' + r.tier.toLowerCase() }, [el('span', { text: r.tier }), r.tier === 'Mythic' ? null : el('b', { text: String(r.div) })].filter(Boolean));
    const steps = el('div', { class: 'rank-steps' }, Array.from({ length: P().STEPS }, (_, i) => el('i', { class: i < r.step ? 'on' : '' })));
    body.appendChild(el('section', { class: 'panel ranked' }, [
      el('div', { class: 'rank-main' }, [crest, el('div', {}, [
        el('h3', { text: `${P().rankLabel(r)}` }),
        r.tier === 'Mythic' ? el('p', { text: `Mythic, ${r.step} wins clear.` }) : steps,
        el('p', { class: 'dim', text: `${P().seasonName(r.season)} season. Best this season: ${r.best}. A win moves you up a step (two in Bronze and Silver); a loss moves you down one, but never out of a tier you have reached. Opponents get stronger as you climb.` }),
        el('div', { class: 'rank-play' }, [
          el('span', { class: 'tiny dim rank-play-label', text: 'Play ranked:' }),
          el('button', { type: 'button', class: 'btn primary hero-btn', html: '<span>Standard</span>', onclick: () => opts.onRanked && opts.onRanked('standard') }),
          el('button', { type: 'button', class: 'btn', text: 'Modern', onclick: () => opts.onRanked && opts.onRanked('modern') }),
          el('button', { type: 'button', class: 'btn', text: 'Pauper', onclick: () => opts.onRanked && opts.onRanked('pauper') }),
        ]),
      ])]),
    ]));
    body.appendChild(el('section', { class: 'panel' }, [el('h3', { text: 'Season rewards' }), el('p', { class: 'dim', text: 'Paid at the end of the month, for the tier you finish in.' }),
      el('div', { class: 'rank-rewards' }, P().TIERS.map((t, i) => el('div', { class: 'rr' + (i <= ti ? ' got' : '') }, [
        el('div', { class: 'rank-crest small t-' + t.toLowerCase() }, [el('span', { text: t })]), rewardChips(P().RANK_REWARD[t]),
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
