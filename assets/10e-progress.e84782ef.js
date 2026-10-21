/* ===== 10e-progress.js ===== */
'use strict';
/* ============================================================
   10e-progress.js - quests, the weekly track, the login streak, the inbox,
   mastery, the ranked ladder, stats and achievements

   What playing earns over time, the way MTG Arena keeps it, all in this
   browser (MTG.store 'progress'). A game's events are counted as the table
   shows them (seeEvents), and the game's end settles them (gameEnded).
   Rewards do not drop straight into the wallet: they wait in the inbox to
   be claimed, so getting them is a moment of its own. The screens are
   src/10f-ui-progress.js.
   ============================================================ */
(function (MTG) {
  const KEY = 'progress';
  const E = () => MTG.economy;
  const COLORS = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };
  const today = () => new Date().toISOString().slice(0, 10);
  const dayDiff = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 86400000);
  /** The ISO week, as "2026-W41": the weekly track and its resets. */
  function weekOf(d) {
    d = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() + 4 - day);
    const y = d.getUTCFullYear();
    const wk = Math.ceil(((d - Date.UTC(y, 0, 1)) / 86400000 + 1) / 7);
    return `${y}-W${String(wk).padStart(2, '0')}`;
  }
  /** A season is a calendar month. */
  const seasonOf = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const seasonName = (s) => { const [y, m] = s.split('-'); return new Date(+y, +m - 1, 1).toLocaleString(undefined, { month: 'long', year: 'numeric' }); };

  /* ---------------- what there is to earn ---------------- */
  /** Daily quests: what to do, how much, and what it pays. */
  const QUESTS = [
    { kind: 'castColor', goal: 20, reward: 5000, xp: 500, text: (q) => `Cast ${q.goal} ${COLORS[q.color]} spells` },
    { kind: 'castColor2', goal: 25, reward: 7500, xp: 750, text: (q) => `Cast ${q.goal} ${COLORS[q.color]} or ${COLORS[q.color2]} spells` },
    { kind: 'win', goal: 2, reward: 7500, xp: 750, text: (q) => `Win ${q.goal} games` },
    { kind: 'play', goal: 3, reward: 5000, xp: 500, text: (q) => `Play ${q.goal} games` },
    { kind: 'lands', goal: 15, reward: 5000, xp: 500, text: (q) => `Play ${q.goal} lands` },
    { kind: 'attack', goal: 25, reward: 5000, xp: 500, text: (q) => `Attack with ${q.goal} creatures` },
    { kind: 'damage', goal: 40, reward: 5000, xp: 500, text: (q) => `Deal ${q.goal} damage to opponents` },
    { kind: 'creatures', goal: 15, reward: 5000, xp: 500, text: (q) => `Cast ${q.goal} creature spells` },
    { kind: 'draw', goal: 20, reward: 5000, xp: 500, text: (q) => `Draw ${q.goal} cards` },
  ];
  const MAX_QUESTS = 3;
  /** The weekly track: rewards at these numbers of wins. */
  const WEEKLY = [
    { wins: 1, shards: 2500 }, { wins: 2, pack: 1 }, { wins: 3, shards: 2500 }, { wins: 4, pack: 1 }, { wins: 5, shards: 5000 },
    { wins: 6, pack: 1 }, { wins: 7, wc: 'uncommon' }, { wins: 8, pack: 1 }, { wins: 9, shards: 5000 }, { wins: 10, wc: 'rare' },
    { wins: 11, pack: 1 }, { wins: 12, shards: 7500 }, { wins: 13, pack: 2 }, { wins: 14, wc: 'rare' }, { wins: 15, shards: 10000, pack: 3 },
  ];
  /** The login streak: a gift for each day in a row, the seventh the best. */
  const LOGIN = [1000, 1500, 2000, 2500, 3000, 4000, { shards: 5000, pack: 1 }];
  /** Mastery: a thousand XP a level, fifty levels a season. */
  const XP_LEVEL = 1000, LEVELS = 50;
  const XP = { play: 100, win: 250 };
  function masteryReward(level) {
    if (level % 10 === 0) return { pack: 3, shards: 5000 };
    if (level % 5 === 0) return { wc: level % 20 === 0 ? 'mythic' : 'rare', pack: 1 };
    if (level % 2 === 0) return { pack: 1 };
    return { shards: 1500 + level * 50 };
  }
  /** The ranked ladder: tiers of four divisions, six steps each, and Mythic above. */
  const TIERS = ['Bronze', 'Silver', 'Gold', 'Platinum', 'Diamond', 'Mythic'];
  const STEPS = 6;
  /** What each tier pays at the season's end. */
  const RANK_REWARD = { Bronze: { shards: 2500 }, Silver: { shards: 5000, pack: 1 }, Gold: { shards: 7500, pack: 2 },
    Platinum: { shards: 10000, pack: 3 }, Diamond: { shards: 15000, pack: 4, wc: 'rare' }, Mythic: { shards: 25000, pack: 5, wc: 'mythic' } };
  /** How hard ranked opponents are, by tier. */
  const RANK_DIFFICULTY = { Bronze: 3, Silver: 4, Gold: 5, Platinum: 7, Diamond: 8, Mythic: 10 };
  /** The ladders, each climbed on its own: Standard, Modern, Pauper, and
      Commander (one against one, the way Brawl is played ranked on Arena).
      `key` is where each is kept; Standard keeps the old place, so a rank
      already earned stays. */
  const LADDERS = [
    { id: 'standard', key: 'ranked', name: 'Standard' }, { id: 'modern', key: 'rankedModern', name: 'Modern' },
    { id: 'pauper', key: 'rankedPauper', name: 'Pauper' }, { id: 'commander', key: 'rankedCommander', name: 'Commander' },
  ];
  const ladderOf = (id) => LADDERS.find(l => l.id === id) || LADDERS[0];
  /** The best tier reached on any ladder, as an index into TIERS. */
  const bestTier = (p) => Math.max(...LADDERS.map(L => TIERS.indexOf((p[L.key] || {}).best || 'Bronze')));

  /** Achievements: what you did, the title it earns, and a few Shards. */
  const ACHIEVEMENTS = [
    { id: 'first-win', name: 'First Blood', text: 'Win a game.', test: (s) => s.wins >= 1, shards: 1000 },
    { id: 'wins-10', name: 'Duelist', text: 'Win 10 games.', test: (s) => s.wins >= 10, shards: 2500, title: 'Duelist' },
    { id: 'wins-50', name: 'Veteran', text: 'Win 50 games.', test: (s) => s.wins >= 50, shards: 7500, title: 'Veteran' },
    { id: 'wins-200', name: 'Champion', text: 'Win 200 games.', test: (s) => s.wins >= 200, shards: 20000, title: 'Champion' },
    { id: 'games-25', name: 'Regular', text: 'Play 25 games.', test: (s) => s.games >= 25, shards: 2500, title: 'Regular' },
    { id: 'spells-500', name: 'Spellslinger', text: 'Cast 500 spells.', test: (s) => s.spells >= 500, shards: 5000, title: 'Spellslinger' },
    { id: 'damage-1000', name: 'Relentless', text: 'Deal 1,000 damage to opponents.', test: (s) => s.damage >= 1000, shards: 5000, title: 'Relentless' },
    { id: 'packs-10', name: 'Pack Rat', text: 'Open 10 packs.', test: (s, e) => e.opened >= 10, shards: 2000, title: 'Pack Rat' },
    { id: 'packs-100', name: 'Hoarder', text: 'Open 100 packs.', test: (s, e) => e.opened >= 100, shards: 10000, title: 'Hoarder' },
    { id: 'mythic-pull', name: 'Struck Gold', text: 'Open a mythic in a pack.', test: (s) => s.mythicsPulled >= 1, shards: 1500 },
    { id: 'foil-mythic', name: 'Shimmering', text: 'Open a foil mythic.', test: (s) => s.foilMythics >= 1, shards: 5000, title: 'Shimmering' },
    { id: 'collect-500', name: 'Collector', text: 'Own 500 different cards.', test: (s, e) => Object.keys(e.col || {}).length >= 500, shards: 5000, title: 'Collector' },
    { id: 'collect-2000', name: 'Archivist', text: 'Own 2,000 different cards.', test: (s, e) => Object.keys(e.col || {}).length >= 2000, shards: 20000, title: 'Archivist' },
    { id: 'set-complete', name: 'Completionist', text: 'Own a playset of every card in a set.', test: (s) => (s.setsCompleted || 0) >= 1, shards: 10000, title: 'Completionist' },
    { id: 'quests-10', name: 'Dutiful', text: 'Finish 10 daily quests.', test: (s) => s.quests >= 10, shards: 3000, title: 'Dutiful' },
    { id: 'streak-7', name: 'Faithful', text: 'Log in seven days running.', test: (s, e, p) => p.login.streak >= 7, shards: 3000, title: 'Faithful' },
    { id: 'weekly-15', name: 'Tireless', text: 'Finish the weekly track.', test: (s) => s.weeklyDone >= 1, shards: 5000, title: 'Tireless' },
    { id: 'gold', name: 'Gilded', text: 'Reach Gold in ranked.', test: (s, e, p) => bestTier(p) >= 2, shards: 5000, title: 'Gilded' },
    { id: 'mythic', name: 'Mythic', text: 'Reach Mythic in ranked.', test: (s, e, p) => bestTier(p) >= TIERS.indexOf('Mythic'), shards: 25000, title: 'Mythic' },
    { id: 'mastery-25', name: 'Devoted', text: 'Reach mastery level 25.', test: (s, e, p) => p.level >= 25, shards: 5000, title: 'Devoted' },
    { id: 'draft-7', name: 'Draft Master', text: 'Win seven games in a draft event.', test: (s) => s.draftPerfect >= 1, shards: 10000, title: 'Draft Master' },
    { id: 'gauntlet', name: 'Gauntlet Runner', text: 'Clear the gauntlet.', test: (s) => s.gauntlets >= 1, shards: 10000, title: 'Gauntlet Runner' },
    { id: 'puzzle-5', name: 'Puzzler', text: 'Solve 5 challenges.', test: (s, e, p) => Object.keys(p.puzzles || {}).length >= 5, shards: 5000, title: 'Puzzler' },
    { id: 'commanders-5', name: 'Many Faces', text: 'Win with 5 different commanders.', test: (s) => Object.keys(s.commanderWins || {}).length >= 5, shards: 7500, title: 'Many Faces' },
  ];

  /* ---------------- the record ---------------- */
  let state = null;
  const blank = () => ({
    v: 1,
    quests: [], questDay: '', rerollDay: '',
    weekly: { week: '', wins: 0, paid: 0 },
    login: { last: '', streak: 0 },
    inbox: [],
    xp: 0, level: 0, season: '', masteryPaid: 0,
    ranked: { season: '', tier: 'Bronze', div: 4, step: 0, best: 'Bronze', paidSeason: '' },
    rankedModern: { season: '', tier: 'Bronze', div: 4, step: 0, best: 'Bronze', paidSeason: '' },
    rankedPauper: { season: '', tier: 'Bronze', div: 4, step: 0, best: 'Bronze', paidSeason: '' },
    rankedCommander: { season: '', tier: 'Bronze', div: 4, step: 0, best: 'Bronze', paidSeason: '' },
    stats: { games: 0, wins: 0, spells: 0, damage: 0, lands: 0, draws: 0, quests: 0, weeklyDone: 0, mythicsPulled: 0, foilMythics: 0,
      setsCompleted: 0, draftPerfect: 0, gauntlets: 0, byFormat: {}, byDeck: {}, commanderWins: {}, shardsEarned: 0 },
    achievements: {}, title: '', setsDone: [],
    puzzles: {},
    event: null, gauntlet: null,
  });
  function load() {
    if (state) return state;
    const b = blank();
    state = Object.assign(b, MTG.store.get(KEY, null) || {});
    for (const k of ['weekly', 'login', 'ranked', 'rankedModern', 'rankedPauper', 'rankedCommander', 'stats']) state[k] = Object.assign(b[k], state[k] || {});
    rollOver();
    return state;
  }
  function save(why) {
    MTG.store.set(KEY, state);
    if (MTG.bus) MTG.bus.emit('progress:changed', { why: why || null });
  }
  let seq = 0;
  /** Something into the inbox, to be claimed. */
  function mail(title, body, reward, kind) {
    load();
    state.inbox.push({ id: 'm' + Date.now().toString(36) + (++seq), title, body: body || '', reward: reward || {}, kind: kind || 'reward', at: Date.now() });
    if (state.inbox.length > 60) state.inbox.splice(0, state.inbox.length - 60);
  }

  /* ---------------- a new day, a new week, a new season ---------------- */
  function rollOver() {
    const now = new Date();
    const d = today();
    // the login streak, and the day's gift
    if (state.login.last !== d) {
      const gap = state.login.last ? dayDiff(state.login.last, d) : 99;
      state.login.streak = gap === 1 ? state.login.streak + 1 : 1;
      state.login.last = d;
      const day = ((state.login.streak - 1) % 7);
      const g = LOGIN[day];
      const reward = typeof g === 'number' ? { shards: g } : g;
      mail(`Day ${state.login.streak} login reward`, state.login.streak > 1 ? `${state.login.streak} days in a row. Come back tomorrow for more.` : 'Welcome back. Come back tomorrow for more.', reward, 'login');
    }
    // a new quest each day, up to three waiting
    if (state.questDay !== d) {
      state.questDay = d;
      if (state.quests.length < MAX_QUESTS) state.quests.push(newQuest());
      while (state.quests.length < 2) state.quests.push(newQuest());
    }
    // the weekly track
    const wk = weekOf(now);
    if (state.weekly.week !== wk) state.weekly = { week: wk, wins: 0, paid: 0 };
    // the season: mastery and ranked both turn over with the month
    const se = seasonOf(now);
    if (state.season !== se) {
      if (state.season && state.level) mail(`${seasonName(state.season)} mastery`, `You reached level ${state.level}. A new season has begun.`, {}, 'season');
      state.season = se; state.xp = 0; state.level = 0; state.masteryPaid = 0;
    }
    // each ladder pays for the tier it finished in
    for (const L of LADDERS) {
      const r = state[L.key];
      if (r.season === se) continue;
      if (r.season && r.paidSeason !== r.season) {
        const t = r.tier;
        mail(`${seasonName(r.season)} ${L.name} ranked rewards`, `You finished the season in ${t}${t === 'Mythic' ? '' : ' ' + r.div}.`, RANK_REWARD[t], 'season');
      }
      // a new season starts a little below where the last ended
      const ti = TIERS.indexOf(r.tier);
      Object.assign(r, { season: se, tier: TIERS[Math.max(0, ti - 1)] || 'Bronze', div: 4, step: 0, paidSeason: r.season });
      if (!r.best) r.best = r.tier;
    }
    MTG.store.set(KEY, state);
  }

  function newQuest() {
    const have = new Set((state.quests || []).map(q => q.kind));
    const pool = QUESTS.filter(q => !have.has(q.kind));
    const t = pool[Math.floor(Math.random() * pool.length)] || QUESTS[0];
    const cols = Object.keys(COLORS);
    const c = cols[Math.floor(Math.random() * 5)];
    let c2 = cols[Math.floor(Math.random() * 5)];
    if (c2 === c) c2 = cols[(cols.indexOf(c) + 1) % 5];
    return { id: 'q' + Date.now().toString(36) + (++seq), kind: t.kind, goal: t.goal, n: 0, reward: t.reward, xp: t.xp, color: c, color2: c2 };
  }
  const questText = (q) => (QUESTS.find(t => t.kind === q.kind) || QUESTS[0]).text(q);

  /** Swap one quest for another, once a day. */
  function reroll(id) {
    load();
    if (state.rerollDay === today()) return { ok: false, why: 'You can swap one quest a day.' };
    const i = state.quests.findIndex(q => q.id === id);
    if (i < 0) return { ok: false, why: 'That quest is gone.' };
    // a new one, not the same kind as the others (nor the one it replaces)
    const keep = state.quests.slice();
    const q = newQuest();
    keep[i] = q;
    state.quests = keep;
    state.rerollDay = today();
    save('reroll');
    return { ok: true };
  }

  /* ---------------- a game, as it happens ---------------- */
  /* The counts of the game being played: what the events have shown so far.
     Kept apart per game, and put down when the game ends (or is left). */
  let cur = null;
  function seeEvents(view, meId, gameKey) {
    if (!view || !meId || view.replay || view.spectating) return;
    if (!cur || cur.key !== gameKey) cur = { key: gameKey, seq: 0, c: { spells: 0, colors: {}, lands: 0, attack: 0, damage: 0, creatures: 0, draws: 0 }, opp: new Set((view.players || []).filter(p => p.id !== meId).map(p => p.id)) };
    const c = cur.c;
    for (const e of (view.events || [])) {
      if (!(e.seq > cur.seq)) continue;
      cur.seq = e.seq;
      if (e.type === 'cast' && e.controller === meId && !e.copy) {
        c.spells++;
        const card = e.card || {};
        const cols = card.colors || (card.card_faces && card.card_faces[0] && card.card_faces[0].colors) || [];
        for (const k of cols) c.colors[k] = (c.colors[k] || 0) + 1;
        const tl = String((card.card_faces && card.card_faces[0] && card.card_faces[0].type_line) || card.type_line || '');
        if (/\bCreature\b/.test(tl)) c.creatures++;
      } else if (e.type === 'zone' && e.to === 'battlefield' && e.from === 'hand' && e.controller === meId) {
        const tl = String((e.card && (e.card.type_line || (e.card.card_faces && e.card.card_faces[0].type_line))) || '');
        if (/\bLand\b/.test(tl)) c.lands++;
      } else if (e.type === 'attack' && e.player === meId) {
        c.attack += (e.attackers || []).length;
      } else if (e.type === 'damage' && cur.opp.has(e.target)) {
        c.damage += e.amount || 0;
      } else if (e.type === 'draw' && e.player === meId) {
        c.draws += e.count || 1;
      }
    }
  }
  /** The counts, into the daily quests. Returns the quests finished by them. */
  function applyCounts(c, won, played) {
    const done = [];
    for (const q of state.quests) {
      const before = q.n;
      if (q.kind === 'castColor') q.n += c.colors[q.color] || 0;
      else if (q.kind === 'castColor2') q.n += (c.colors[q.color] || 0) + (c.colors[q.color2] || 0);
      else if (q.kind === 'win') q.n += won ? 1 : 0;
      else if (q.kind === 'play') q.n += played ? 1 : 0;
      else if (q.kind === 'lands') q.n += c.lands;
      else if (q.kind === 'attack') q.n += c.attack;
      else if (q.kind === 'damage') q.n += c.damage;
      else if (q.kind === 'creatures') q.n += c.creatures;
      else if (q.kind === 'draw') q.n += c.draws;
      if (before < q.goal && q.n >= q.goal) done.push(q);
    }
    for (const q of done) {
      mail('Quest complete', questText(q), { shards: q.reward, xp: q.xp }, 'quest');
      state.stats.quests++;
    }
    state.quests = state.quests.filter(q => q.n < q.goal);
    return done;
  }

  /**
   * A game is over: the counts go into the quests, a win onto the weekly
   * track and the ranked ladder, XP into mastery, the numbers into the
   * stats, and anything newly earned into the inbox. `o` says how it went:
   * { won, format, deck, commander, ranked, mode }. Returns what changed,
   * for the result screen.
   */
  function gameEnded(o) {
    load();
    o = o || {};
    const c = (cur && cur.c) || { spells: 0, colors: {}, lands: 0, attack: 0, damage: 0, creatures: 0, draws: 0 };
    cur = null;
    const st = state.stats;
    st.games++; if (o.won) st.wins++;
    st.spells += c.spells; st.damage += c.damage; st.lands += c.lands; st.draws += c.draws;
    const f = o.format || 'other';
    st.byFormat[f] = st.byFormat[f] || { g: 0, w: 0 };
    st.byFormat[f].g++; if (o.won) st.byFormat[f].w++;
    if (o.deck) {
      const k = String(o.deck).slice(0, 60);
      st.byDeck[k] = st.byDeck[k] || { g: 0, w: 0, f };
      st.byDeck[k].g++; if (o.won) st.byDeck[k].w++;
    }
    if (o.won && o.commander) st.commanderWins[o.commander] = (st.commanderWins[o.commander] || 0) + 1;
    const out = { quests: applyCounts(c, !!o.won, true), xp: 0, levels: [], weekly: null, ranked: null };
    // the weekly track
    if (o.won) {
      state.weekly.wins++;
      for (const r of WEEKLY) {
        if (r.wins === state.weekly.wins && state.weekly.paid < r.wins) {
          state.weekly.paid = r.wins;
          mail(`Weekly win ${r.wins} of 15`, r.wins === 15 ? 'The weekly track is done: well played. It starts again on Monday.' : `${15 - r.wins} more wins this week for the rest.`, pickReward(r), 'weekly');
          out.weekly = r;
          if (r.wins === 15) st.weeklyDone++;
        }
      }
    }
    // mastery
    out.xp = o.won ? XP.win : XP.play;
    out.levels = addXp(out.xp);
    // ranked
    if (o.ranked) out.ranked = rankResult(!!o.won, typeof o.ranked === 'string' ? o.ranked : 'standard', o.performance);
    out.achievements = checkAchievements();
    save('game');
    return out;
  }
  /** Left a game before it ended: the counts so far still count for quests. */
  function gameLeft() {
    load();
    if (!cur) return;
    const c = cur.c;
    cur = null;
    applyCounts(c, false, false);
    save('left');
  }
  const pickReward = (r) => {
    const out = {};
    if (r.shards) out.shards = r.shards;
    if (r.pack) out.pack = r.pack;
    if (r.wc) out.wc = r.wc;
    return out;
  };

  /* ---------------- mastery ---------------- */
  function addXp(n) {
    state.xp += n;
    const levels = [];
    while (state.level < LEVELS && state.xp >= (state.level + 1) * XP_LEVEL) {
      state.level++;
      levels.push(state.level);
      mail(`Mastery level ${state.level}`, `${seasonName(state.season)} mastery.`, masteryReward(state.level), 'mastery');
    }
    return levels;
  }

  /* ---------------- ranked ---------------- */
  /** A ranked game's result: decisive wins compound after a short winning streak. */
  function rankResult(won, ladderId, performance) {
    const L = ladderOf(ladderId);
    const r = state[L.key];
    const before = { tier: r.tier, div: r.div, step: r.step };
    const strongWin = !!won && performance && (performance.turns <= 8 ||
      performance.margin >= Math.max(10, performance.startingLife / 2));
    r.strongWinStreak = strongWin ? (Number(r.strongWinStreak) || 0) + 1 : 0;
    const bonus = strongWin && r.strongWinStreak >= 3 ? 1 : 0;
    if (r.tier === 'Mythic') {
      r.step = Math.max(0, r.step + (won ? 1 + bonus : -1));
    } else if (won) {
      r.step += (TIERS.indexOf(r.tier) <= 1 ? 2 : 1) + bonus;
      while (r.step >= STEPS && r.tier !== 'Mythic') {
        r.step -= STEPS;
        if (r.div > 1) r.div--;
        else { r.tier = TIERS[TIERS.indexOf(r.tier) + 1]; r.div = r.tier === 'Mythic' ? 0 : 4; }
      }
      if (TIERS.indexOf(r.tier) > TIERS.indexOf(r.best)) {
        r.best = r.tier;
        mail(`Reached ${r.tier} in ${L.name}`, 'A new best rank this season.', { shards: 2500 * TIERS.indexOf(r.tier) }, 'ranked');
      }
    } else if (r.tier !== 'Bronze') {
      // no falling below a tier once reached
      r.step = Math.max(0, r.step - 1);
    }
    return { ladder: L.id, ladderName: L.name, before, after: { tier: r.tier, div: r.div, step: r.step },
      strongWinStreak: r.strongWinStreak, bonus };
  }
  const rankLabel = (r) => r.tier === 'Mythic' ? `Mythic` : `${r.tier} ${r.div}`;
  /** Where the next rank is: how many wins, and its name; null at Mythic. */
  function nextRank(r) {
    if (r.tier === 'Mythic') return null;
    const per = TIERS.indexOf(r.tier) <= 1 ? 2 : 1;
    const wins = Math.max(1, Math.ceil((STEPS - r.step) / per));
    const label = r.div > 1 ? `${r.tier} ${r.div - 1}` : TIERS[TIERS.indexOf(r.tier) + 1];
    return { wins, label };
  }
  /** Days until the week (Monday) and the season (the month) turn over. */
  function untilReset(now) {
    now = now || new Date();
    const day = 86400000;
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    const week = ((8 - now.getDay()) % 7) || 7;
    const season = Math.max(1, Math.round((new Date(now.getFullYear(), now.getMonth() + 1, 1) - midnight) / day));
    return { week, season };
  }

  /* ---------------- achievements and set completion ---------------- */
  function checkAchievements() {
    const got = [];
    const eco = E() ? E().state : {};
    for (const a of ACHIEVEMENTS) {
      if (state.achievements[a.id]) continue;
      let ok = false;
      try { ok = a.test(state.stats, eco, state); } catch (e) { ok = false; }
      if (!ok) continue;
      state.achievements[a.id] = Date.now();
      got.push(a);
      mail(`Achievement: ${a.name}`, a.text + (a.title ? ` You can now use the title "${a.title}".` : ''), a.shards ? { shards: a.shards } : {}, 'achievement');
    }
    return got;
  }
  /**
   * After packs or crafting: a set whose every card you own a playset of
   * (or every card of one rarity) pays out once, and the last of those
   * gives the set's own sleeve.
   */
  async function checkSets(codes) {
    load();
    const eco = E();
    for (const code of codes || []) {
      if (!code) continue;
      let pool;
      try { pool = await MTG.scry.setPool(code); } catch (e) { continue; }
      if (!pool || !pool.all) continue;
      const names = new Map();
      for (const c of pool.all) if (!eco.isBasic(c.name)) names.set(c.name, eco.rarityOf(c));
      for (const r of ['common', 'uncommon', 'rare', 'mythic', 'all']) {
        const key = code + ':' + r;
        if (state.setsDone.includes(key)) continue;
        const list = [...names].filter(([, rr]) => r === 'all' || rr === r);
        if (!list.length) continue;
        if (!list.every(([n]) => eco.owned(n) >= 4)) continue;
        state.setsDone.push(key);
        const setName = pool.name || code.toUpperCase();
        const reward = r === 'all' ? { shards: 25000, sleeve: 'set-' + code } : { shards: { common: 5000, uncommon: 7500, rare: 15000, mythic: 15000 }[r] };
        if (r === 'all') state.stats.setsCompleted++;
        mail(r === 'all' ? `Set complete: ${setName}` : `${setName}: every ${r}`, r === 'all' ? 'A playset of every card in the set. The set’s own sleeve is yours.' : `You own a playset of every ${r} in ${setName}.`, reward, 'set');
      }
    }
    checkAchievements();
    save('sets');
  }
  /** Pulls worth an achievement, from opening a pack. */
  function notePulls(cards) {
    load();
    for (const it of cards || []) {
      if (it.rarity === 'mythic') { state.stats.mythicsPulled++; if (it.foil) state.stats.foilMythics++; }
    }
    checkAchievements();
    save('pulls');
  }

  /* ---------------- the inbox ---------------- */
  /** What a reward is, in words. */
  function describe(rw) {
    const bits = [];
    if (rw.shards) bits.push(`${rw.shards.toLocaleString()} Shards`);
    if (rw.pack) bits.push(`${rw.pack} pack${rw.pack === 1 ? '' : 's'}`);
    if (rw.wc) bits.push(`a ${rw.wc} wildcard`);
    if (rw.xp) bits.push(`${rw.xp} XP`);
    if (rw.sleeve) bits.push('a sleeve');
    return bits.join(', ') || 'nothing to collect';
  }
  /** Claim one: the goods into your wallet and hoard. `setFor` names the newest set for packs. */
  function claim(id, newestSet) {
    load();
    const i = state.inbox.findIndex(m => m.id === id);
    if (i < 0) return null;
    const m = state.inbox[i];
    const rw = m.reward || {};
    const eco = E();
    if (rw.shards) eco.addShards(rw.shards, 'reward');
    if (rw.shards) state.stats.shardsEarned += rw.shards;
    if (rw.pack) for (let k = 0; k < rw.pack; k++) eco.state.packs.push({ id: MTG.uid('pk'), set: newestSet ? newestSet.code : null, name: newestSet ? newestSet.name : '', newest: 0, kind: 'play' });
    if (rw.wc) eco.state.wc[rw.wc]++;
    if (rw.sleeve) { const sl = eco.state.sleeves; if (!sl.owned.includes(rw.sleeve)) sl.owned.push(rw.sleeve); }
    let levels = [];
    if (rw.xp) levels = addXp(rw.xp);
    eco.save();
    state.inbox.splice(i, 1);
    save('claim');
    return { m, levels };
  }

  /* ---------------- titles ---------------- */
  const titles = () => { load(); return ACHIEVEMENTS.filter(a => a.title && state.achievements[a.id]).map(a => a.title); };
  function setTitle(t) { load(); state.title = t && titles().includes(t) ? t : ''; save('title'); }

  /** Shards a game paid, kept for the stats. */
  function noteEarned(n) { load(); state.stats.shardsEarned += n || 0; save(); }

  MTG.progress = {
    QUESTS, WEEKLY, LOGIN, XP_LEVEL, LEVELS, XP, TIERS, STEPS, RANK_REWARD, RANK_DIFFICULTY, ACHIEVEMENTS, LADDERS,
    get state() { return load(); },
    /** A ladder's standing: 'standard' or 'commander'. */
    ladder: (id) => load()[ladderOf(id).key],
    nextRank, untilReset,
    save: () => save(),
    questText, reroll, seeEvents, gameEnded, gameLeft, mail, claim, describe, masteryReward,
    rankLabel, titles, setTitle, checkSets, notePulls, noteEarned, checkAchievements: () => { load(); const g = checkAchievements(); save(); return g; },
    weekOf, seasonName, seasonOf,
    inboxCount: () => load().inbox.length,
  };
})(window.MTG);
