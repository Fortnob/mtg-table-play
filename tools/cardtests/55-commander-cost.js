/* Commander destinations and visible cost adjustments. */
'use strict';
module.exports = (test) => {
  test('Commander destination: its owner may keep it in the zone it was sent to', (mk, t) => {
    for (const zone of ['graveyard', 'exile', 'hand', 'library']) {
      const T = mk();
      const commander = T.bf('A', 'Grizzly Bears');
      commander.isCommander = true;
      T.answer('confirm', { yes: false });
      T.g.moveObject(commander, zone);
      T.g.checkStateBasedActions();
      t.eq(T.g.pendingChoice && T.g.pendingChoice.purpose, 'commanderZone', `${zone}: owner is asked`);
      T.settle();
      t.zone(commander, zone, `${zone}: declined command zone`);
    }
  });

  test('Commander destination: its owner may choose the command zone', (mk, t) => {
    const T = mk();
    const commander = T.bf('A', 'Grizzly Bears');
    commander.isCommander = true;
    T.answer('confirm', { yes: true });
    T.g.moveObject(commander, 'exile');
    T.g.checkStateBasedActions();
    T.settle();
    t.zone(commander, 'command', 'commander moved from exile');
  });

  test('Cost adjustments: the hand view shows generic reductions and increases', (mk, t) => {
    const T = mk();
    const divination = T.hand('A', 'Divination');
    T.bf('A', 'Baral, Chief of Compliance');
    let view = () => T.g.viewFor('A').players.find(p => p.id === 'A').hand.find(c => c.id === divination.id);
    t.eq(JSON.stringify(view().costAdjustments), JSON.stringify([{ sign: '-', symbol: '1' }]), 'Baral reduces by one');

    const taxed = mk();
    const spell = taxed.hand('A', 'Divination');
    taxed.bf('B', 'Thalia, Guardian of Thraben');
    const shown = taxed.g.viewFor('A').players.find(p => p.id === 'A').hand.find(c => c.id === spell.id);
    t.eq(JSON.stringify(shown.costAdjustments), JSON.stringify([{ sign: '+', symbol: '1' }]), 'Thalia adds one');
  });
};
