'use strict';
/* ============================================================
   12h-ui-rematch.js - the end of a game, written down

   As a game ends it is written into your record (src/10g-history.js):
   the host and every guest each keep their own, so this runs at every
   table, from the views it is shown. A seat that is knocked out of a
   game of several is written down there and then, in case it leaves
   before the end.
   ============================================================ */
(function (MTG) {
  const UI = MTG.ui;
  const Table = UI.Table;
  const net = MTG.net;
  const app = () => MTG.app || {};

  /* ---------------- into the record ---------------- */
  // when each game was first seen, so a table built again mid-game (a guest reconnecting) keeps its start
  const starts = new Map();

  /** What kind of game this is, for the record; null for one that is not written down. */
  function modeOf(sess) {
    if (net.isClient) return 'online';
    const m = sess && sess.mode;
    if (m && m.challenge) return null;          // a puzzle, not a game against a deck
    if (m && m.ranked) return 'ranked';
    if (m && m.event) return 'event';
    if (m && m.gauntlet) return 'gauntlet';
    if (sess && sess.roster && sess.roster.some(r => r.kind === 'remote')) return 'online';
    return 'quick';
  }

  /** The commanders a player is seen to have, from the view. */
  function commandersIn(v, p) {
    const names = new Set();
    for (const o of (p.command || [])) if (o.isCommander && o.card) names.add(o.card.name);
    for (const o of (v.battlefield || [])) if (o.isCommander && o.owner === p.id && o.card && !o.faceDown) names.add(o.card.name);
    return names.size ? [...names].join(' + ') : null;
  }
  const deckCmd = (deck) => (deck && (deck.commanders || []).length ? deck.commanders.map(c => c.name).join(' + ') : null);

  /** One game, as the record has it, from the view of the seat that played it. */
  function entryFor(t, v, result) {
    const A = app();
    const sess = A.session;
    const mode = modeOf(sess);
    if (!mode) return null;
    const me = v.players.find(p => p.id === t.meId);
    const seat = (id) => (sess && sess.seat ? sess.seat(id) : null);
    // a guest knows the table from what the host says in the lobby
    const member = (id) => (net.isClient && (A.lobbyMembers || []).find(m => m.id === id)) || null;
    // your deck: the host has it on your seat; a guest kept the one it sent, unless the host has another
    // for it now (a deck built after a draft)
    let deck = null;
    const mine = seat(t.meId), mm = member(t.meId);
    const sent = net.isClient && A.clientDeck;
    if (mine && mine.deck) deck = { id: mine.deck.id, name: mine.deck.name, cmd: deckCmd(mine.deck) };
    else if (sent && (!mm || !mm.deckName || mm.deckName === sent.name)) deck = { id: sent.id, name: sent.name, cmd: deckCmd(sent) };
    else if (mm && mm.deckName) deck = { id: null, name: mm.deckName, cmd: null };
    if (deck && !deck.cmd && me) deck.cmd = commandersIn(v, me);
    const opp = v.players.filter(p => p.id !== t.meId).map(p => {
      const s = seat(p.id), mm = member(p.id);
      return {
        name: p.name, bot: !!p.isBot, level: p.isBot ? p.botDifficulty : null,
        deck: (s && s.deck && s.deck.name) || (mm && mm.deckName) || null,
        cmd: (s && deckCmd(s.deck)) || commandersIn(v, p),
      };
    });
    const m = v.match;
    return {
      key: v.game ? 'g:' + v.game : null, kind: 'game',
      format: (sess && sess.formatId) || A.clientFormatId || (v.config && v.config.formatId) || null,
      mode, result, deck, opp, turns: v.turn,
      ms: starts.has(v.game) ? Date.now() - starts.get(v.game) : null,
      game: m && m.best > 1 ? { n: m.gameNumber, of: m.best } : null,
    };
  }

  /** A match that has been decided, as the record has it: the score from your side. */
  function matchFor(game, v, meId) {
    const m = v.match;
    if (!m || !m.decided || m.best < 2) return null;
    const need = Math.ceil(m.best / 2);
    const mine = (m.scores.find(s => s.id === meId) || { wins: 0 }).wins;
    const theirs = Math.max(0, ...m.scores.filter(s => s.id !== meId).map(s => s.wins));
    const result = mine >= need ? 'win' : theirs >= need ? 'loss' : 'draw';
    return Object.assign({}, game, { key: game.key ? game.key + ':match' : null, kind: 'match', result, score: `${mine}–${theirs}`, game: null, turns: null, ms: null });
  }

  /** Look at a view as it arrives: a game ended (or ended for you) is written down, once. */
  function noteView(t, v) {
    if (!v || v.replay || v.spectating || !MTG.history) return;
    const me = v.players && v.players.find(p => p.id === t.meId);
    if (!me) return;
    if (v.game && !starts.has(v.game) && !v.over) starts.set(v.game, Date.now());
    if (!v.over && !me.hasLost) return;
    if (t._recorded) return;
    t._recorded = true;
    const result = v.over ? (!(v.winners || []).length ? 'draw' : v.winners.includes(t.meId) ? 'win' : 'loss') : 'loss';
    const game = entryFor(t, v, result);
    if (!game) return;
    MTG.history.record(game);
    const match = v.over ? matchFor(game, v, t.meId) : null;
    if (match) MTG.history.record(match);
  }

  const base = { update: Table.prototype.update };
  Table.prototype.update = function (view) {
    try { noteView(this, view); } catch (e) { console.warn('[history]', e); }
    return base.update.apply(this, arguments);
  };

  MTG.rematch = { modeOf };
})(window.MTG);
