/* What an audit of the cards automated for Commander found: merge seams that
   left a reading unreachable, and words the engine counted as done but did
   not do. Each test plays the card against what it says. */
'use strict';
module.exports = (test) => {
  /* Pass priority until something is on the stack whose name says it is this card's. */
  const untilOnStack = (T, re) => {
    const g = T.g;
    for (let i = 0; i < 200 && !g.stack.some(s => re.test(s.name || '')); i++) {
      T.settle();
      if (g.stack.some(s => re.test(s.name || ''))) break;
      const p = g.priorityPlayer;
      if (!p) break;
      g.passPriority(p.id, true);
    }
    return g.stack.find(s => re.test(s.name || ''));
  };

  test('Audit: Silent Skimmer — the defending player loses 2 life even once it has left combat', (mk, t) => {
    t.auto('Silent Skimmer');
    const T = mk({ players: ['A', 'B', 'C'], library: Array(20).fill('Plains') });
    T.toMain('A');
    const sk = T.bf('A', 'Silent Skimmer'); sk.summoningSick = false;
    T.answer('declareAttackers', () => [{ attackerId: sk.id, defenderId: 'C' }]);
    t.ok(untilOnStack(T, /Silent Skimmer/), 'its attack trigger is on the stack');
    T.g.moveObject(sk, 'hand');
    T.resolve();
    t.eq(T.life('C'), 18, 'C, the player it attacked, loses 2');
    t.eq(T.life('B'), 20, 'B loses nothing');
  });

  test('Audit: a bot pays Mogis with a creature once its life is short (its answer had been overwritten)', (mk, t) => {
    t.auto('Mogis, God of Slaughter');
    const run = (life) => {
      const T = mk();
      const mo = T.bf('A', 'Mogis, God of Slaughter');
      const bears = T.bf('B', 'Grizzly Bears');
      T.player('B').life = life; T.player('B').isBot = true;
      const bot = new T.MTG.bots.BotPlayer(T.g, 'B', 8);
      T.g._runEffects(mo.analysis().abilities.find(a => a.kind === 'triggered').effects,
        { controller: 'A', obj: mo, name: 'Mogis', kind: 'ability', triggerData: { player: 'B', playerId: 'B' } });
      const ch = T.g.pendingChoice;
      t.ok(ch && ch.playerId === 'B', 'B is asked');
      bot.doChoice(ch);
      T.settle();
      return { T, bears };
    };
    const low = run(6);
    t.zone(low.bears, 'graveyard', 'at 6 life the bot sacrifices the Bears');
    t.eq(low.T.life('B'), 6, 'and takes no damage');
    const high = run(20);
    t.zone(high.bears, 'battlefield', 'at 20 life it keeps the Bears');
    t.eq(high.T.life('B'), 18, 'and takes 2');
  });

  /* ---- ward: only {N} and "Pay N life" were ever taken; any other price let the spell through free ---- */

  test('Audit: Valgavoth, Terror Eater — "Ward—Sacrifice three nonland permanents", or the spell is countered', (mk, t) => {
    t.auto('Valgavoth, Terror Eater');
    const play = (pay) => {
      const T = mk({ library: Array(20).fill('Swamp') });
      T.toMain('B');
      const val = T.bf('A', 'Valgavoth, Terror Eater');
      const mine = ['Grizzly Bears', 'Sol Ring', 'Glorious Anthem', 'Hill Giant'].map(n => T.bf('B', n));
      T.bf('B', 'Swamp');
      if (pay) T.answer('choose', (ch) => ({ picks: ch.purpose === 'wardPay' ? mine.slice(0, 3).map(o => o.id) : [] }));
      else T.answer('choose', { picks: [] });
      T.mana('B', '1BB');
      T.cast('B', T.hand('B', 'Murder'), { targets: [val] });
      t.ok(T.asked.some(c => c.purpose === 'wardPay' && c.playerId === 'B'), 'the player who targeted it is asked');
      return { T, val, mine };
    };
    const paid = play(true);
    t.zone(paid.val, 'graveyard', 'paid: Murder resolves');
    t.eq(paid.mine.filter(o => o.zone !== 'battlefield').length, 3, 'paid: three of B\'s nonland permanents sacrificed (exiled, by Valgavoth)');
    const not = play(false);
    t.zone(not.val, 'battlefield', 'not paid: Murder is countered');
    t.eq(not.mine.filter(o => o.zone === 'battlefield').length, 4, 'not paid: nothing sacrificed');
  });

  test('Audit: Westgate Regent — "Ward—Discard a card"', (mk, t) => {
    t.auto('Westgate Regent');
    const T = mk();
    T.toMain('B');
    const wr = T.bf('A', 'Westgate Regent');
    const card = T.hand('B', 'Grizzly Bears');
    T.answer('choose', (ch) => ({ picks: ch.purpose === 'wardPay' ? [card.id] : [] }));
    T.mana('B', '1BB');
    T.cast('B', T.hand('B', 'Murder'), { targets: [wr] });
    t.zone(card, 'graveyard', 'the card discarded');
    t.zone(wr, 'graveyard', 'and Murder resolves');
    // nothing to discard: countered
    const T2 = mk();
    T2.toMain('B');
    const wr2 = T2.bf('A', 'Westgate Regent');
    T2.mana('B', '1BB');
    T2.cast('B', T2.hand('B', 'Murder'), { targets: [wr2] });
    t.zone(wr2, 'battlefield', 'an empty hand cannot pay: countered');
  });

  test('Audit: Raubahn — "Pay life equal to Raubahn\'s power"; life short of it can\'t be paid', (mk, t) => {
    t.auto('Raubahn, Bull of Ala Mhigo');
    const T = mk();
    T.toMain('B');
    const r = T.bf('A', 'Raubahn, Bull of Ala Mhigo');
    const pw = T.g.powerOf(r);
    T.mana('B', '1BB');
    T.cast('B', T.hand('B', 'Murder'), { targets: [r] });
    t.eq(T.life('B'), 20 - pw, 'B paid life equal to its power');
    t.zone(r, 'graveyard');
    const T2 = mk();
    T2.toMain('B');
    const r2 = T2.bf('A', 'Raubahn, Bull of Ala Mhigo');
    T2.player('B').life = T2.g.powerOf(r2) - 1;
    T2.mana('B', '1BB');
    T2.cast('B', T2.hand('B', 'Murder'), { targets: [r2] });
    t.zone(r2, 'battlefield', 'too little life: countered');
    t.eq(T2.life('B'), T2.g.powerOf(r2) - 1, 'and no life paid');
  });

  test('Audit: ward counters an activated ability that targets it, too', (mk, t) => {
    t.auto('Gavony Dawnguard');
    const T = mk();
    T.toMain('B');
    const d = T.bf('A', 'Gavony Dawnguard');
    const ps = T.bf('B', 'Prodigal Sorcerer'); ps.summoningSick = false;
    T.activate('B', ps, 0, { targets: [d] });
    t.eq(d.damage || 0, 0, 'no {1} to pay: the ping is countered');
    ps.tapped = false;
    T.mana('B', '1');
    T.activate('B', ps, 0, { targets: [d] });
    t.eq(d.damage || 0, 1, 'with {1}: paid, and it deals 1');
  });

  test('Audit: a ward price no part of the table takes leaves the card to its players', (mk, t) => {
    const a = (n) => mk().MTG.oracle.analyze(require('../harness').card(n));
    t.no(a('Titania, Rugged Rumbler').fullyAutomated, '"Discard a card or pay {2}"');
    t.no(a('Axebane Ferox').fullyAutomated, '"Collect evidence 4"');
  });
};
