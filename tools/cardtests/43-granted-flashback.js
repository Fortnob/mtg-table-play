/* Flashback given "until end of turn" (Snapcaster Mage): this turn only, for the card's mana cost, and exiled after. */
'use strict';
module.exports = (test) => {
  test('Granted flashback: Snapcaster Mage — cast it back this turn, exiled after; gone next turn', (mk, t) => {
    t.auto('Snapcaster Mage');
    const T = mk();
    const bolt = T.grave('A', 'Lightning Bolt');
    const other = T.grave('A', 'Shock');
    T.answer('pickTarget', { targets: [{ kind: 'object', id: bolt.id }] });
    T.mana('A', 'U1');
    T.cast('A', T.hand('A', 'Snapcaster Mage'));
    t.ok(bolt.flashbackGrant, 'the Bolt has flashback');
    t.no(other.flashbackGrant, 'the Shock does not');
    const use = T.g.altUsesFor('A', bolt.id).find(u => u.via === 'flashback');
    t.ok(use, 'flashback is offered');
    T.mana('A', 'R');
    const life = T.life('B');
    T.cast('A', bolt, { via: 'flashback', targets: ['B'] });
    t.eq(T.life('B'), life - 3, 'it resolved');
    t.zone(bolt, 'exile', 'exiled after, not back to the graveyard');
  });

  test('Granted flashback: Snapcaster Mage — the leave ends with the turn', (mk, t) => {
    const T = mk();
    const bolt = T.grave('A', 'Lightning Bolt');
    T.answer('pickTarget', { targets: [{ kind: 'object', id: bolt.id }] });
    T.mana('A', 'U1');
    T.cast('A', T.hand('A', 'Snapcaster Mage'));
    t.ok(T.g.altUsesFor('A', bolt.id).some(u => u.via === 'flashback'), 'this turn: offered');
    T.nextTurn('B');
    T.nextTurn('A');
    t.no(T.g.altUsesFor('A', bolt.id).some(u => u.via === 'flashback'), 'a later turn: not offered');
    T.mana('A', 'R');
    t.no(T.g.castSpell('A', bolt.id, { auto: true }), 'and it can\'t be cast from the graveyard');
  });
};
