/* ===== 10g-history.js ===== */
'use strict';
/* ============================================================
   10g-history.js - the record of games and matches

   Every game you finish, and every match, written down as it ends: when,
   the format, how it was played (a quick game, ranked, an event, the
   gauntlet, online with friends), your deck, who you played and what
   they brought, how it went, how many turns and how long. The table
   writes it (src/12h-ui-rematch.js); the Profile's History tab and the
   deck boxes read it (src/10h-ui-history.js).

   It lives in this browser (MTG.store 'history'), so a profile backup
   carries it. The list keeps the last few hundred; every game is also
   added into its deck's totals as it is written, so a deck's record still
   counts the games that have since fallen off the end of the list.
   ============================================================ */
(function (MTG) {
  const KEY = 'history';
  /** How many games and matches the list keeps. */
  const MAX = 300;
  /** How a game was played, in words. */
  const MODES = { quick: 'Quick game', ranked: 'Ranked', event: 'Draft event', gauntlet: 'Gauntlet', online: 'Online' };
  const RESULTS = { win: 'Won', loss: 'Lost', draw: 'Drawn' };

  let state = null;
  const blank = () => ({ v: 1, entries: [], decks: {}, keys: [] });
  function load() {
    if (state) return state;
    const had = MTG.store.get(KEY, null);
    state = Object.assign(blank(), had && typeof had === 'object' ? had : {});
    if (!Array.isArray(state.entries)) state.entries = [];
    if (!state.decks || typeof state.decks !== 'object') state.decks = {};
    if (!Array.isArray(state.keys)) state.keys = [];
    return state;
  }
  function save() {
    MTG.store.set(KEY, state);
    if (MTG.bus) MTG.bus.emit('history:changed');
  }

  /** A deck's key in the totals: its id when it has one, else its name. */
  function deckKey(deck) {
    if (!deck) return null;
    if (typeof deck === 'string') return deck;
    if (deck.id) return String(deck.id);
    return deck.name ? 'name:' + String(deck.name).slice(0, 60) : null;
  }

  const str = (s, n) => (s == null ? null : String(s).slice(0, n || 80));
  let seq = 0;

  /**
   * Write down a game or a match that has ended. `e` is
   *   { key, kind: 'game' | 'match', format, mode, result: 'win' | 'loss' | 'draw',
   *     deck: { id, name, cmd }, opp: [{ name, bot, level, deck, cmd }],
   *     turns, ms, at, game: { n, of }, score }
   * `key` names the game (or match) so it is written once however many
   * times the table sees it end. Returns the entry, or null if it was
   * already written.
   */
  function record(e) {
    load();
    e = e || {};
    if (e.key) {
      if (state.keys.includes(e.key)) return null;
      state.keys.push(e.key);
      if (state.keys.length > 60) state.keys.splice(0, state.keys.length - 60);
    }
    const kind = e.kind === 'match' ? 'match' : 'game';
    const result = RESULTS[e.result] ? e.result : 'loss';
    const deck = e.deck ? { id: str(e.deck.id, 60), name: str(e.deck.name) || 'A deck', cmd: str(e.deck.cmd, 120) } : null;
    const entry = {
      id: 'h' + Date.now().toString(36) + (++seq),
      kind, at: e.at || Date.now(),
      format: str(e.format, 40) || 'other',
      mode: MODES[e.mode] ? e.mode : 'quick',
      result, deck,
      opp: (e.opp || []).slice(0, 8).map(o => ({
        name: str(o.name, 40) || 'Someone', bot: !!o.bot,
        level: o.bot && Number.isFinite(o.level) ? o.level : null,
        deck: str(o.deck), cmd: str(o.cmd, 120),
      })),
      turns: Number.isFinite(e.turns) ? e.turns : null,
      ms: Number.isFinite(e.ms) && e.ms > 0 ? Math.round(e.ms) : null,
    };
    if (e.game && e.game.of > 1) entry.game = { n: e.game.n | 0, of: e.game.of | 0 };
    if (kind === 'match' && e.score) entry.score = str(e.score, 20);
    state.entries.push(entry);
    // the oldest fall off the list; the deck totals below already hold them
    if (state.entries.length > MAX) state.entries.splice(0, state.entries.length - MAX);
    const k = deckKey(deck);
    if (k) {
      const t = state.decks[k] = state.decks[k] || { name: deck.name, format: entry.format, g: 0, w: 0, l: 0, d: 0, mw: 0, ml: 0, md: 0 };
      t.name = deck.name;
      t.at = entry.at;
      if (kind === 'game') { t.g++; t[result[0]]++; }
      else t['m' + result[0]]++;
    }
    save();
    return entry;
  }

  /**
   * The list, newest first, narrowed by { format, result, kind, deck }
   * (each left out, or 'all', for everything).
   */
  function entries(f) {
    load();
    f = f || {};
    const want = (k, v) => !f[k] || f[k] === 'all' || f[k] === v;
    return state.entries.filter(x => want('format', x.format) && want('result', x.result) && want('kind', x.kind) &&
      (!f.deck || deckKey(x.deck) === f.deck)).reverse();
  }

  /** Wins, losses and draws over some entries (games only). */
  function tally(list) {
    const t = { g: 0, w: 0, l: 0, d: 0 };
    for (const x of list) if (x.kind === 'game') { t.g++; t[x.result[0]]++; }
    return t;
  }

  /** A deck's games: { g, w, l, d, mw, ml, md }, or null if it has never played. Takes a deck, its id or its key. */
  function deckRecord(deck) {
    load();
    const k = deckKey(deck);
    const t = k && state.decks[k];
    return t && (t.g || t.mw || t.ml || t.md) ? Object.assign({}, t) : null;
  }

  /** "7–3, 70%": a record in words (draws, if any, in the middle). */
  function recordText(t) {
    if (!t || !t.g) return '';
    const wl = t.d ? `${t.w}–${t.l}–${t.d}` : `${t.w}–${t.l}`;
    return `${wl}, ${Math.round(100 * t.w / t.g)}%`;
  }

  /** The formats the list has games in, most played first. */
  function formats() {
    load();
    const n = {};
    for (const x of state.entries) n[x.format] = (n[x.format] || 0) + 1;
    return Object.keys(n).sort((a, b) => n[b] - n[a]);
  }

  MTG.history = {
    MAX, MODES, RESULTS,
    get state() { return load(); },
    record, entries, tally, deckRecord, deckKey, recordText, formats,
    /** Forget everything (tests). */
    reset() { state = blank(); save(); },
  };
})(window.MTG);
