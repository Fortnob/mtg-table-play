/* ============================================================
   11b-ui-playtest.js - trying a deck out: what the player sees
   A Playtest tab in the deck builder, with a sample hand, the odds
   of the lands in an opening seven and a way into a practice game;
   the practice game itself, at the real table against the Goldfish;
   and the little tally on the table that says how it is going. The
   arithmetic and the Goldfish are in src/16a-playtest.js.
   ============================================================ */
'use strict';
(function (MTG) {
  const { el } = MTG;
  const UI = MTG.ui;

  const pct = (p, places) => {
    if (p >= 0.9995) return '100%';
    if (p > 0 && p < (places ? 0.0005 : 0.005)) return '<' + (places ? '0.1' : '1') + '%';
    return (p * 100).toFixed(places || 0) + '%';
  };
  const plural = (n, one, many) => `${n} ${n === 1 ? one : (many || one + 's')}`;

  /* ---------------- the builder's Playtest tab ---------------- */

  /**
   * Built the first time the tab is opened. `api.deck()` is the deck as it
   * is being edited, so the hand and the odds follow every change; a hand
   * dealt from a deck that has changed since is dealt again.
   */
  function playtestPane(host, api) {
    const P = MTG.playtest;
    const deck = () => api.deck();
    const handBox = el('section', { class: 'panel pt-box pt-hand-box' });
    const oddsBox = el('section', { class: 'panel pt-box pt-odds-box' });
    // a deck built in a draft goes on to its game from here, so there is no practice game to leave for
    const playBox = api.opts && api.opts.finish ? null : el('section', { class: 'panel pt-box pt-play-box' });
    host.append(...[handBox, oddsBox, playBox].filter(Boolean));
    let hand = null, sig = '', pick = null, onDraw = false;

    const signature = () => (deck().main || []).map(e => (e.card && e.card.id) + '×' + e.qty).join('|');
    const freeMulligans = () => {
      // by the rules for the format's usual table: a Brawl or a Commander game has a free first mulligan
      try { const F = MTG.formats, f = F.FORMATS[deck().format]; return F.freeMulligansFor(f, F.houseDefaults(deck().format), (f && f.defaultPlayers) || 2); } catch (e) { return 0; }
    };
    function ensureHand(fresh) {
      const s = signature();
      if (!fresh && hand && s === sig) return;
      sig = s;
      hand = new P.SampleHand(deck(), { freeMulligans: freeMulligans() });
    }

    function drawHand() {
      const size = P.landCount(deck()).size;
      const head = el('h3', null, [el('span', { text: 'Sample hand' })]);
      if (!size) {
        handBox.replaceChildren(head, el('p', { class: 'small muted', style: { margin: 0 }, text: 'Put some cards in the deck and a hand is dealt from it here.' }));
        return;
      }
      const lands = hand.lands();
      head.appendChild(el('span', { class: 'tiny dim', text: `${plural(lands, 'land')} in ${plural(hand.hand.length, 'card')}` }));
      const kept = hand.handSize - Math.max(0, hand.mulligans - hand.free);
      const status = hand.toBottom > 0
        ? `Mulligan to ${Math.max(0, kept)}: tap ${hand.toBottom === 1 ? 'the card' : hand.toBottom + ' cards'} to put on the bottom.`
        : hand.draws ? `Kept ${Math.max(0, kept)}, then drew ${plural(hand.draws, 'card')}. ${plural(hand.library.length, 'card')} left in the library.`
        : hand.mulligans ? `Kept ${Math.max(0, kept)} after ${plural(hand.mulligans, 'mulligan')}.`
        : `The opening ${hand.handSize === 7 ? 'seven' : hand.handSize}.`;
      const grid = el('div', { class: 'pt-hand' + (hand.toBottom > 0 ? ' choosing' : ''), role: 'group', 'aria-label': 'The hand' });
      hand.hand.forEach((x, i) => {
        const drawn = !hand.toBottom && i >= kept;
        const tile = el('button', {
          type: 'button', class: 'pt-card' + (drawn ? ' drawn' : ''),
          'aria-label': hand.toBottom > 0 ? `Put ${x.card.name} on the bottom` : `${x.card.name}: read it`,
          title: hand.toBottom > 0 ? `Put ${x.card.name} on the bottom` : x.card.name,
          onclick: () => {
            if (hand.toBottom > 0) { if (hand.bottom(x.key)) { MTG.sfx('click'); drawHand(); } return; }
            UI.cardSheet(x.card);
          },
        }, [UI.cardImage(x.card, 'normal'), drawn ? el('span', { class: 'pt-tag', text: 'drawn' }) : null].filter(Boolean));
        UI.attachPreview(tile, x.card, 0);
        grid.appendChild(tile);
      });
      const bottom = hand.bottomed.length
        ? el('p', { class: 'tiny dim pt-bottom', text: 'On the bottom: ' + hand.bottomed.map(x => x.card.name).join(', ') + '.' })
        : null;
      const btn = (label, fn, cls, off, title) => el('button', { type: 'button', class: 'btn sm' + (cls ? ' ' + cls : ''), text: label, disabled: !!off, title: title || null, onclick: fn });
      const ctl = el('div', { class: 'pt-ctl' }, [
        btn('New hand', () => { ensureHand(true); MTG.sfx('shuffle'); drawHand(); }, 'primary'),
        btn('Mulligan', () => { if (hand.mulligan()) { MTG.sfx('shuffle'); drawHand(); } }, '',
          hand.draws > 0 || hand.mulligans >= hand.handSize, hand.draws ? 'A hand you have drawn on is kept' : 'Shuffle back and draw seven, then put one more on the bottom'),
        btn('Draw a card', () => { if (hand.draw()) { MTG.sfx('draw'); drawHand(); } }, '',
          hand.toBottom > 0 || !hand.library.length, hand.toBottom > 0 ? 'Put the cards on the bottom first' : 'Draw the next card'),
      ]);
      handBox.replaceChildren(...[head, el('p', { class: 'small muted pt-status', 'aria-live': 'polite', text: status }), grid, bottom, ctl].filter(Boolean));
    }

    function drawOdds() {
      const o = P.openingOdds(deck());
      const head = el('h3', null, [el('span', { text: `Lands in the opening ${o.drawn === 7 || !o.size ? 'seven' : o.drawn}` })]);
      if (!o.size) { oddsBox.replaceChildren(head, el('p', { class: 'small muted', style: { margin: 0 }, text: 'Nothing to count yet.' })); return; }
      head.appendChild(el('span', { class: 'tiny dim', text: `${plural(o.lands, 'land')} in ${o.size} (${pct(o.lands / o.size)})` }));
      const ex = o.exactly;
      const likeliest = ex.indexOf(Math.max(...ex));
      if (pick == null || pick > o.drawn) pick = likeliest;
      const top = Math.max(...ex) || 1;
      const bars = el('div', { class: 'curve-bar pt-odds', role: 'group', 'aria-label': 'Chance of each number of lands' }, ex.map((p, k) => el('button', {
        type: 'button', class: 'curve-col' + (k === pick ? ' on' : '') + (p < 0.0005 ? ' empty' : ''),
        title: `Exactly ${plural(k, 'land')}: ${pct(p, 1)}`, 'aria-label': `${plural(k, 'land')}: ${pct(p, 1)}`, 'aria-pressed': k === pick ? 'true' : 'false',
        onclick: () => { pick = k; drawOdds(); },
      }, [
        el('b', { text: pct(p), style: { bottom: (p / top * 100) + '%' } }),
        el('i', { class: 'curve-fill', style: { height: (p / top * 100) + '%' } }),
        el('span', { text: String(k) }),
      ])));
      // what most players would keep: two to four lands in sixty, two to five in a hundred
      const hi = o.size >= 80 ? 5 : 4;
      const say = el('p', { class: 'small pt-odds-say' }, [
        el('b', { text: pct(ex[pick], 1) }), ` chance of exactly ${plural(pick, 'land')}`,
        pick > 0 && pick < o.drawn ? [', ', el('b', { text: pct(P.between(ex, pick), 1) }), ` of ${pick} or more`] : null,
        '. ',
        el('span', { class: 'muted', text: `Two to ${hi === 5 ? 'five' : 'four'} lands, a hand most would keep: ${pct(P.between(ex, 2, hi))}.` }),
      ].flat().filter(x => x != null));
      oddsBox.replaceChildren(head, bars, say);
    }

    function drawPlay() {
      if (!playBox) return;
      const size = P.landCount(deck()).size;
      const box = el('label', { class: 'row small pt-draw' }, [
        el('input', { type: 'checkbox', checked: onDraw, style: { width: 'auto' }, onchange: (e) => { onDraw = e.target.checked; } }),
        el('span', { text: 'Go second (on the draw)' }),
      ]);
      playBox.replaceChildren(
        el('h3', null, [el('span', { text: 'Practice game' })]),
        el('p', { class: 'small muted', style: { marginTop: 0 }, text:
          'Play the deck out at the table against the Goldfish, an opponent that does nothing and cannot lose. '
          + 'The table counts the damage and says on which turn you would have won.' }),
        el('div', { class: 'pt-ctl' }, [
          box,
          el('span', { class: 'grow' }),
          el('button', {
            type: 'button', class: 'btn primary sm', text: 'Practice game', disabled: !size,
            title: size ? 'Start a solo game with this deck' : 'Put some cards in the deck first',
            onclick: async () => {
              const d = deck(), o = api.opts || {};
              /* the game plays the deck as it is now, saved or not; changes
                 not saved come back with "Back to the deck", still unsaved,
                 but leaving the game any other way loses them, so say so */
              const left = await api.leave({
                title: 'Practise without saving?',
                message: 'Your changes are not saved. The practice game plays the deck as it is now, and “Back to the deck” brings the changes back, but leaving the game any other way loses them.',
                discard: 'Practise without saving', save: 'Save and practise',
              });
              if (!left) return;
              const base = api.baseline();
              UI.practiceGame(d, { onDraw, back: () => UI.deckBuilder(d, Object.assign({}, o, { baseline: base })) });
            },
          }),
        ]),
      );
    }

    const all = () => { ensureHand(); drawHand(); drawOdds(); drawPlay(); };
    return {
      show: all,
      // every edit redraws the builder; a tab out of sight catches up when it is next opened
      refresh() { if (host.classList.contains('active')) all(); },
    };
  }

  UI.deckPanes = UI.deckPanes || [];
  UI.deckPanes.push({ id: 'playtest', label: 'Playtest', mount: playtestPane });

  /* ---------------- the practice game ---------------- */

  /**
   * A solo game with this deck (or the saved deck with this id) against
   * the Goldfish. `opts.onDraw` goes second; `opts.back` is where the
   * table's "Back to the deck" leads. Any deck will do, legal or not:
   * trying out a deck that is not finished is half the point.
   */
  UI.practiceGame = async function (deck, opts) {
    opts = opts || {};
    const App = MTG.app;
    const F = MTG.practice;
    if (!App || !App.Session) return UI.error('The table is not ready yet.');
    if (MTG.net && MTG.net.online) return UI.error('A practice game is played alone: leave the room you are in first.');
    if (typeof deck === 'string') {
      const busy = UI.busy('Loading deck');
      try { deck = await MTG.decks.load(deck); } finally { busy.close(); }
      if (!deck) return UI.error('That deck could not be loaded.');
    }
    if (!deck || !MTG.playtest.libraryOf(deck).length) return UI.error('Put some cards in the deck first.');
    if (!await UI.checkAutomation(deck, { onEdit: (d) => UI.deckBuilder(d, {}) })) return;
    if (App.session && App.session.botRunner) App.session.botRunner.stop();
    // a deck from a format the table does not know (an old link, say) is tried out as Standard
    const formatId = MTG.formats.list().some(f => f.id === deck.format) ? deck.format : 'standard';
    const sess = App.session = new App.Session(formatId, null);
    sess.mode = { practice: true };
    sess.practiceOnDraw = !!opts.onDraw;
    sess.addLocalHost(App.myName);
    const me = sess.seat('me');
    me.deck = deck;
    me.deckValid = MTG.formats.validate(deck, sess.fmt);
    sess.roster.push({ id: F.SEAT, kind: 'bot', name: 'Goldfish', difficulty: 1, personality: '',
      deck: F.emptyDeck(formatId), deckValid: null, peerId: null });
    sess.onStarted = (g) => F.setup(g, { onDraw: !!sess.practiceOnDraw });
    // where the table's "Back to the deck" leads; a game picked up again later has none
    sess.practiceBack = opts.back || null;
    // straight to the game: a drafted deck's format would otherwise begin with a draft
    await sess.startGame();
  };

  /** The decks list's way in: a small button on a deck box. `d` is an index entry. */
  UI.practiceButton = function (d) {
    return el('button', {
      type: 'button', class: 'btn xs ghost', text: 'Practice',
      title: 'Play this deck alone against an opponent that does nothing, to see how fast it wins',
      onclick: () => UI.practiceGame(d.id, { back: () => MTG.app && MTG.app.showScreen('decks') }),
    });
  };

  /** Leave the practice game, for the deck it came from when there is one. */
  function leave(toDeck) {
    const sess = MTG.app.session;
    const go = toDeck && sess ? sess.practiceBack : null;
    MTG.app.leaveGame();
    if (go) go();
  }

  const canAgain = () => {
    const sess = MTG.app && MTG.app.session;
    const me = sess && sess.seat('me');
    return !!(me && me.deck);
  };

  /** Another game with the same deck, freshly shuffled. */
  function again(onDraw) {
    const sess = MTG.app && MTG.app.session;
    if (!sess) return;
    sess.practiceOnDraw = !!onDraw;
    sess.onStarted = (g) => MTG.practice.setup(g, { onDraw: !!sess.practiceOnDraw });
    sess.match = null;
    if (sess.botRunner) sess.botRunner.stop();
    sess.startGame();
  }

  /* ---------------- the tally on the table ----------------
     A chip in the corner of the table: your turn and the damage so far
     against what would have won, and once it would have, on which turn.
     A tap opens the turn-by-turn count and the ways out. */

  function killWords(t) {
    const k = t.kill;
    if (!k) return null;
    const how = k.how === 'poison' ? 'Ten poison counters' : k.how === 'commander' ? 'Lethal commander damage' : `${t.target} damage`;
    return k.resumed ? `${how}, before this game was picked up again` : `${how} by your turn ${k.turn}`;
  }

  function chipFor(g, t) {
    const App = MTG.app;
    const table = App && App.table;
    if (!table || !table.arena || !App.session || App.session.game !== g) return;
    let chip = table.arena.querySelector(':scope > .practice-chip');
    if (!chip) {
      chip = el('button', { type: 'button', class: 'practice-chip', onclick: () => sheet(g, t) });
      table.arena.appendChild(chip);
    }
    const k = t.kill;
    chip.classList.toggle('won', !!k);
    const text = !k ? `Turn ${t.turn || 1} · ${t.dealt}/${t.target}`
      : k.resumed ? `Won · ${t.dealt} dealt`
      : `Won on turn ${k.turn}` + (k.how === 'poison' ? ' (poison)' : k.how === 'commander' ? ' (commander)' : '');
    if (chip._text === text) return;
    chip._text = text;
    chip.replaceChildren(el('span', { class: 'pc-tag', text: 'Practice' }), el('span', { class: 'pc-line', text }));
    chip.setAttribute('aria-label', `Practice game: ${k ? killWords(t) : `${t.dealt} of ${t.target} damage by your turn ${t.turn || 1}`}. Open the count.`);
  }

  function sheet(g, t) {
    const rows = [];
    let prev = 0;
    for (let i = 1; i < t.byTurn.length; i++) {
      const v = t.byTurn[i];
      if (v == null) continue;
      rows.push(el('tr', { class: t.kill && !t.kill.resumed && t.kill.turn === i ? 'kill' : '' }, [
        el('td', { text: String(i) }), el('td', { text: v - prev ? '+' + (v - prev) : '–' }), el('td', { text: String(v) }),
      ]));
      prev = v;
    }
    const extra = [t.poison ? `${t.poison} poison` : null, t.commander ? `${t.commander} commander damage` : null].filter(Boolean);
    const body = el('div', { class: 'practice-sheet' }, [
      el('p', { class: 'pr-head', text: t.kill ? killWords(t) + '.' : `${t.dealt} of ${t.target} damage by your turn ${t.turn || 1}.` }),
      extra.length ? el('p', { class: 'small muted', text: 'And ' + extra.join(', ') + '.' }) : null,
      rows.length ? el('table', { class: 'pr-table' }, [
        el('thead', null, el('tr', null, [el('th', { text: 'Your turn' }), el('th', { text: 'Dealt' }), el('th', { text: 'In all' })])),
        el('tbody', null, rows),
      ]) : el('p', { class: 'small muted', text: 'The count starts with your first turn.' }),
      el('p', { class: 'tiny dim', text: 'The Goldfish does nothing and cannot lose, so play on as long as you like. Damage is counted as the life it has lost; '
        + 'a card that says you win the game does not end a practice game.' }),
      // a game picked up from the home screen has no decks to deal again from
      canAgain() ? el('div', { class: 'pt-ctl' }, [
        el('button', { type: 'button', class: 'btn sm', text: 'Again, going first', onclick: () => { m.close(); again(false); } }),
        el('button', { type: 'button', class: 'btn sm', text: 'Again, going second', onclick: () => { m.close(); again(true); } }),
      ]) : null,
    ].filter(Boolean));
    const buttons = [{ label: 'Leave', onClick: () => { m.close(); leave(false); } }];
    if (MTG.app.session && MTG.app.session.practiceBack) buttons.push({ label: 'Back to the deck', onClick: () => { m.close(); leave(true); } });
    buttons.push({ label: 'Play on', class: 'primary', onClick: () => m.close() });
    const m = UI.modal({ title: 'Practice game', width: '460px', className: 'practice-modal', content: body, buttons });
  }

  // the Goldfish has sat down (src/16a-playtest.js): keep its tally on the table
  MTG.bus.on('practice:seat', (g, t) => {
    let told = !!t.kill;
    const paint = () => {
      chipFor(g, t);
      // the moment it would have won, said once
      if (t.kill && !told && MTG.app && MTG.app.session && MTG.app.session.game === g) {
        told = true;
        UI.ok(`${killWords(t)}: that would have won.`);
      }
    };
    t.on(paint);
    // the table is built just after the seat, so look again once it is
    setTimeout(paint, 0);
  });
})(window.MTG);
