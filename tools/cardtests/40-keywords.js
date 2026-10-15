/* Keywords the reader calls automated have to do what they say, end to end:
   from the right zone, for the right cost, with their rider. */
'use strict';
module.exports = (test) => {
  test('Keywords: embalm exiles the card and makes a white Zombie token copy with no mana cost, as a sorcery', (mk, t) => {
    t.auto('Labyrinth Guardian');
    const T = mk();
    const g = T.g;
    const o = T.grave('A', 'Labyrinth Guardian');
    const use = g.altUsesFor('A', o.id).find(u => /^Embalm/.test(u.label));
    t.ok(use, 'embalm is offered from the graveyard');
    t.no(g.altUsesFor('A', o.id).some(u => u.via === 'embalm'), 'and not as a way to cast the card');
    T.mana('A', 'UUU3');
    const before = g.stack.length;
    T.cast('A', o, { via: use.via, resolve: false });
    t.zone(o, 'exile', 'the card is exiled to pay');
    t.no(g.stack.some(s => s.kind === 'spell'), 'nothing was cast');
    t.ok(g.stack.length > before, 'an ability is on the stack');
    T.resolve();
    const tok = T.bfOf('A').find(x => x.isToken && x.name === 'Labyrinth Guardian');
    t.ok(tok, 'a token copy entered');
    t.eq((tok.analysis().colors || []).join(''), 'W', 'white');
    t.ok(g._hasCreatureType(tok, 'Zombie') && g._hasCreatureType(tok, 'Illusion'), 'a Zombie as well as its own types');
    t.eq(tok.card.mana_cost, '', 'no mana cost');
    t.eq(g.powerOf(tok), 2, 'its own size');
  });

  test('Keywords: eternalize makes a 4/4 black Zombie token copy; not at instant speed', (mk, t) => {
    t.auto('Proven Combatant');
    const T = mk();
    const g = T.g;
    const o = T.grave('A', 'Proven Combatant');
    const use = g.altUsesFor('A', o.id).find(u => /^Eternalize/.test(u.label));
    t.ok(use, 'eternalize is offered from the graveyard');
    T.mana('A', 'UU4');
    T.toMain('A', 'end');
    t.no(g.canCast('A', o.id, use.via).ok, 'only as a sorcery');
    T.nextTurn('A');
    T.mana('A', 'UU4');
    T.cast('A', o, { via: use.via });
    t.zone(o, 'exile');
    const tok = T.bfOf('A').find(x => x.isToken && x.name === 'Proven Combatant');
    t.ok(tok, 'a token copy entered');
    t.eq((tok.analysis().colors || []).join(''), 'B', 'black');
    t.eq(g.powerOf(tok) + '/' + g.toughnessOf(tok), '4/4', '4/4');
    t.ok(g._hasCreatureType(tok, 'Zombie'), 'a Zombie');
  });
};
