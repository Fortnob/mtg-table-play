/* Costs that are not mana, mana abilities that do something else as well,
   and the lands that ask a question as they enter. */
'use strict';
module.exports = (test) => {
  test('Polluted Delta finds an Island (either type will do)', (mk, t) => {
    const T = mk();
    const d = T.bf('A', 'Polluted Delta');
    T.activate('A', d, 0);
    t.zone(d, 'graveyard');
    const lands = T.bfOf('A');
    t.eq(lands.length, 1, 'a land was fetched');
    t.ok(/Island|Swamp/.test(lands[0].card.type_line), 'it is an Island or a Swamp');
    t.no(lands[0].tapped, 'fetched untapped');
    t.eq(T.life('A'), 19, 'paid 1 life');
  });

  test('Shivan Reef taps for red and pings its controller, without the stack', (mk, t) => {
    const T = mk();
    T.put('A', 'Shivan Reef', 'battlefield');
    const bolt = T.hand('A', 'Lightning Bolt');
    T.cast('A', bolt, { targets: ['B'] });
    t.eq(T.life('B'), 17);
    t.eq(T.life('A'), 19, 'the painland dealt 1');
  });

  test('Talisman pays a coloured cost through auto-tap', (mk, t) => {
    const T = mk();
    T.bf('A', 'Talisman of Creativity');
    const bolt = T.hand('A', 'Lightning Bolt');
    T.cast('A', bolt, { targets: ['B'] });
    t.eq(T.life('B'), 17);
    t.eq(T.life('A'), 19);
  });

  test('Temple of the False God needs five lands', (mk, t) => {
    const T = mk();
    const temple = T.bf('A', 'Temple of the False God');
    t.no(T.g.tapForMana('A', temple.id, 0), 'refused with no other lands');
    for (let i = 0; i < 4; i++) T.bf('A', 'Wastes');
    t.ok(T.g.tapForMana('A', temple.id, 0), 'allowed with five');
    t.eq(T.player('A').pool.C, 2);
  });

  test('Ashnod\'s Altar sacrifices a creature for its mana', (mk, t) => {
    const T = mk();
    const altar = T.bf('A', "Ashnod's Altar");
    T.bf('A', 'Grizzly Bears');
    t.ok(T.g.tapForMana('A', altar.id, 0));
    T.settle();
    t.eq(T.player('A').pool.C, 2);
    t.eq(T.zone('A', 'graveyard').length, 1, 'the Bears were sacrificed');
  });

  test('Ashnod\'s Altar cannot be used with nothing to sacrifice', (mk, t) => {
    const T = mk();
    const altar = T.bf('A', "Ashnod's Altar");
    t.no(T.g.tapForMana('A', altar.id, 0));
    t.eq(T.player('A').pool.C, 0);
  });

  test('Village Rites asks for its sacrifice', (mk, t) => {
    const T = mk();
    const rites = T.hand('A', 'Village Rites');
    const bear = T.bf('A', 'Grizzly Bears');
    T.bf('A', 'Llanowar Elves');
    T.mana('A', 'B');
    T.answer('sacrifice', (ch) => ({ cardIds: [bear.id] }));
    T.cast('A', rites);
    t.zone(bear, 'graveyard');
    t.eq(T.bfOf('A').length, 1, 'only the Bears went');
    t.eq(T.zone('A', 'hand').length, 2);
  });

  test('Village Rites cannot be cast without a creature', (mk, t) => {
    const T = mk();
    const rites = T.hand('A', 'Village Rites');
    T.mana('A', 'B');
    t.no(T.g.castSpell('A', rites.id, { auto: true }));
  });

  test('Thrill of Possibility discards as it is cast', (mk, t) => {
    const T = mk();
    const thrill = T.hand('A', 'Thrill of Possibility');
    const fodder = T.hand('A', 'Grizzly Bears');
    T.mana('A', 'R1');
    T.cast('A', thrill);
    t.zone(fodder, 'graveyard');
    t.eq(T.zone('A', 'hand').length, 2);
  });

  test('Toxic Deluge takes X life', (mk, t) => {
    const T = mk();
    const tox = T.hand('A', 'Toxic Deluge');
    const bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'B2');
    T.cast('A', tox, { x: 2 });
    t.eq(T.life('A'), 18);
    t.zone(bear, 'graveyard');
  });

  test('Watery Grave: pay 2 life to enter untapped', (mk, t) => {
    const T = mk();
    const g = T.hand('A', 'Watery Grave');
    T.answer('confirm', { yes: true });
    T.playLand('A', g);
    t.no(g.tapped, 'untapped');
    t.eq(T.life('A'), 18);
  });

  test('Watery Grave: decline and it enters tapped', (mk, t) => {
    const T = mk();
    const g = T.hand('A', 'Watery Grave');
    T.answer('confirm', { yes: false });
    T.playLand('A', g);
    t.ok(g.tapped, 'tapped');
    t.eq(T.life('A'), 20);
  });

  test('Watery Grave taps for blue or black', (mk, t) => {
    const T = mk();
    const g = T.bf('A', 'Watery Grave');
    T.g.tapForMana('A', g.id, 1);
    t.eq(T.player('A').pool.B, 1);
  });

  test('Choked Estuary reveals an Island and enters untapped', (mk, t) => {
    const T = mk();
    const c = T.hand('A', 'Choked Estuary');
    T.hand('A', 'Island');
    T.playLand('A', c);
    t.no(c.tapped);
  });

  test('Choked Estuary with nothing to reveal enters tapped', (mk, t) => {
    const T = mk();
    const c = T.hand('A', 'Choked Estuary');
    T.playLand('A', c);
    t.ok(c.tapped);
  });

  test('Exploration allows a second land, every turn', (mk, t) => {
    const T = mk();
    T.bf('A', 'Exploration');
    T.playLand('A', T.hand('A', 'Forest'));
    T.playLand('A', T.hand('A', 'Forest'));
    t.no(T.g.canPlayLand('A'), 'no third');
  });

  test('Explore\'s extra land lasts one turn', (mk, t) => {
    const T = mk();
    const ex = T.hand('A', 'Explore');
    T.mana('A', 'G1');
    T.cast('A', ex);
    t.eq(T.g.landAllowance(T.player('A')), 2);
    T.nextTurn('A');
    t.eq(T.g.landAllowance(T.player('A')), 1);
  });
};
