'use strict';
/* ============================================================
   12h-ui-rematch.js - the end of a game: written down, and played again

   Two things happen as a game ends. It is written into your record
   (src/10g-history.js): the host and every guest each keep their own,
   so this runs at every table, from the views it is shown. A seat that
   is knocked out of a game of several is written down there and then,
   in case it leaves before the end.

   And the table can go again. Rematch (on the result screen) starts the
   same table over: the same seats, the same decks (the bots keep theirs),
   the same house rules. Alone, that is all there is to it. With other
   people at the table the host offers it and each guest says yes or no;
   anyone who says no, or has gone, is left out, and the host chooses
   whether a bot takes the empty seat or it stays empty. The messages:

     host -> guest   { t: 'rematch:offer', id, from }
     guest -> host   { t: 'rematch:answer', id, yes }
     host -> guest   { t: 'rematch:off', id, left }   called off, or under way without you
   ============================================================ */
(function (MTG) {
  const { el } = MTG;
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
    // a new game arriving puts away an offer still open from the last one
    if (offerBox && view && !view.over) dropOffer();
    return base.update.apply(this, arguments);
  };

  /* ---------------- the rematch: the host ---------------- */
  let asking = null;      // the offer out, while the host waits on answers

  /**
   * Get the table ready to go again: a deck for every seat that needs
   * one, and the people at it asked. Resolves true to start the game, or
   * false if it is called off.
   */
  async function gather(sess) {
    // a game picked up from a save does not have your deck with it
    const me = sess.seat('me');
    if (me && !me.deck && sess.fmt.kind !== 'limited') {
      UI.toast('Choose a deck for the rematch.');
      const deck = await new Promise((res) => {
        const m = UI.pickDeck(sess.formatId, res);
        // closed without a choice is no rematch (a choice closes the window first, then answers)
        m._onClose = () => setTimeout(() => res(null), 0);
      });
      if (!deck) return false;
      me.deck = deck;
      me.deckValid = MTG.formats.validate(deck, sess.fmt);
    }
    const guests = sess.roster.filter(r => r.kind === 'remote');
    if (!guests.length || !net.isHost) return true;
    return offer(sess, guests);
  }

  /** Ask every guest; wait for their answers, or for the host to go on without them. */
  function offer(sess, guests) {
    if (asking) asking.cancel();
    const id = MTG.uid('rm');
    const A = app();
    /** @type {Map<string, { seat: any, answer: string, fill: boolean }>} answer: waiting, yes, no, gone */
    const state = new Map();
    for (const r of guests) {
      const here = !!(r.peerId && net.conns.has(r.peerId));
      state.set(r.id, { seat: r, answer: here ? 'waiting' : 'gone', fill: true });
      if (here) net.send(r.peerId, { t: 'rematch:offer', id, from: A.myName || 'The host' });
    }
    return new Promise((resolve) => {
      let done = false;
      const list = el('div', { class: 'rematch-list' });
      const note = el('p', { class: 'small muted rematch-note' });
      const m = UI.modal({
        title: 'Rematch', width: '520px', className: 'rematch-modal',
        content: el('div', null, [
          el('p', { class: 'small muted', style: { marginTop: 0 }, text: 'The same table again: the same seats, the same decks and the same house rules. The others are being asked.' }),
          list, note,
        ]),
        buttons: [
          { label: 'Call it off', onClick: () => finish(false) },
          { label: 'Start', class: 'primary', onClick: () => finish(true) },
        ],
      });
      m._onClose = () => finish(false);
      const startBtn = m.foot.querySelector('.btn.primary');
      const minPlayers = sess.fmt.minPlayers || 2;

      const draw = () => {
        list.innerHTML = '';
        const out = [...state.values()].filter(s => s.answer === 'no' || s.answer === 'gone');
        const staying = sess.roster.length - out.length;
        for (const s of state.values()) {
          const words = { waiting: 'Waiting for an answer…', yes: 'In', no: 'Not this time', gone: 'No longer here' }[s.answer];
          const row = el('div', { class: 'rematch-row a-' + s.answer }, [
            UI.portrait(s.seat.name, null, { avatar: s.seat.avatar || null }),
            el('div', { class: 'rr-who' }, [el('b', { text: s.seat.name }), el('span', { class: 'rr-answer', text: words })]),
          ]);
          if (s.answer === 'no' || s.answer === 'gone') {
            // with too few left, the empty seat has to be a bot
            const must = staying + out.filter(x => x.fill && x !== s).length < minPlayers;
            if (must) s.fill = true;
            row.appendChild(el('div', { class: 'rr-seat', role: 'group', 'aria-label': `${s.seat.name}’s seat` }, [
              el('button', { type: 'button', class: 'chip' + (s.fill ? ' on' : ''), text: 'A bot takes it', 'aria-pressed': s.fill ? 'true' : 'false',
                onclick: () => { s.fill = true; draw(); } }),
              el('button', { type: 'button', class: 'chip' + (!s.fill ? ' on' : ''), text: 'Leave it empty', disabled: must, 'aria-pressed': !s.fill ? 'true' : 'false',
                title: must ? `This format needs at least ${minPlayers} players` : '', onclick: () => { s.fill = false; draw(); } }),
            ]));
          }
          list.appendChild(row);
        }
        const waiting = [...state.values()].filter(s => s.answer === 'waiting').length;
        note.textContent = waiting
          ? 'Start now and anyone who has not answered is left out.'
          : out.length ? 'Everyone has answered.' : '';
        if (startBtn) startBtn.textContent = waiting ? 'Start without waiting' : 'Start';
        // everyone in: no reason to wait for a click
        if (!waiting && !out.length) setTimeout(() => finish(true), 400);
      };

      const finish = (go) => {
        if (done) return;
        done = true;
        asking = null;
        offOff();
        if (!m._closed) { m._onClose = null; m.close(); }
        if (!go) {
          // anyone still deciding, or waiting to play, is told; whoever said no needs no telling
          for (const s of state.values()) if ((s.answer === 'waiting' || s.answer === 'yes') && s.seat.peerId) net.send(s.seat.peerId, { t: 'rematch:off', id });
          resolve(false);
          return;
        }
        // whoever is not in is left out; a bot takes the seat, or it goes
        for (const s of state.values()) {
          if (s.answer === 'yes') continue;
          if (s.seat.peerId && net.conns.has(s.seat.peerId)) net.send(s.seat.peerId, { t: 'rematch:off', id, left: true });
          const at = sess.roster.indexOf(s.seat);
          if (at < 0) continue;
          if (s.fill) {
            const bot = sess.addBot(MTG.settings.lobbyBotLevel || 5, MTG.settings.lobbyBotStyle || '');
            // after a draft there is nothing to build from, so the bot plays the deck the seat drafted
            if (sess.fmt.kind === 'limited' && s.seat.deck) bot.deck = s.seat.deck;
            sess.roster.splice(sess.roster.indexOf(bot), 1);
            sess.roster.splice(at, 1, bot);
          } else sess.roster.splice(at, 1);
        }
        sess.broadcastLobby();
        resolve(true);
      };

      // the answers, and anyone who goes while they are being waited for
      const onMsg = (from, msg) => {
        if (!msg || msg.t !== 'rematch:answer' || msg.id !== id) return;
        const s = [...state.values()].find(x => x.seat.peerId === from);
        if (!s || s.answer === 'gone') return;
        s.answer = msg.yes ? 'yes' : 'no';
        draw();
      };
      const onLeave = (peerId) => {
        const s = [...state.values()].find(x => x.seat.peerId === peerId);
        if (s) { s.answer = 'gone'; draw(); }
      };
      const offs = [net.on('message', onMsg), net.on('peer:leave', onLeave)];
      const offOff = () => offs.forEach(f => f());
      asking = { cancel: () => finish(false) };
      draw();
    });
  }

  /* ---------------- the rematch: a guest ---------------- */
  let offerBox = null;
  /** Put the question away without answering it: the host has moved on. */
  function dropOffer() {
    if (!offerBox) return;
    offerBox._onClose = null;
    offerBox.close();
    offerBox = null;
  }
  net.on('message', (from, msg) => {
    if (!msg || !net.isClient || from !== 'host') return;
    if (msg.t === 'rematch:offer') {
      dropOffer();
      let answered = false;
      const answer = (yes) => {
        if (answered) return;
        answered = true;
        net.send(null, { t: 'rematch:answer', id: msg.id, yes: !!yes });
        if (yes) UI.toast('You are in. The game starts when the host is ready.', 'ok', 4000);
      };
      const box = offerBox = UI.modal({
        title: 'Rematch?', width: '420px', className: 'rematch-modal',
        content: el('p', { style: { margin: 0 }, text: `${msg.from || 'The host'} wants to play again: the same table, the same decks and the same house rules.` }),
        buttons: [
          { label: 'Not this time', onClick: () => box.close() },
          { label: 'Play again', class: 'primary', onClick: () => { answer(true); box.close(); } },
        ],
      });
      // closed any other way is a no, so the host is not left waiting
      box._onClose = () => { if (offerBox === box) offerBox = null; answer(false); };
      MTG.sfx('notify');
      return;
    }
    if (msg.t === 'rematch:off') {
      dropOffer();
      UI.toast(msg.left ? 'The rematch has started without you.' : 'The host called off the rematch.', '', 4000);
    }
  });

  MTG.rematch = { gather, modeOf };
})(window.MTG);
