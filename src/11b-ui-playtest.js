/* ============================================================
   11b-ui-playtest.js - trying a deck out: what the player sees
   A Playtest tab in the deck builder, with a sample hand and the
   odds of the lands in an opening seven. The arithmetic is in
   src/16a-playtest.js.
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
    host.append(handBox, oddsBox);
    let hand = null, sig = '', pick = null;

    const signature = () => (deck().main || []).map(e => (e.card && e.card.id) + '×' + e.qty).join('|');
    const freeMulligans = () => {
      try { return MTG.formats.houseDefaults(deck().format).freeMulligans || 0; } catch (e) { return 0; }
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

    const all = () => { ensureHand(); drawHand(); drawOdds(); };
    return {
      show: all,
      // every edit redraws the builder; a tab out of sight catches up when it is next opened
      refresh() { if (host.classList.contains('active')) all(); },
    };
  }

  UI.deckPanes = UI.deckPanes || [];
  UI.deckPanes.push({ id: 'playtest', label: 'Playtest', mount: playtestPane });
})(window.MTG);
