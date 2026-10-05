/* Mana with strings attached, and mana that comes with more. */
'use strict';
module.exports = (test) => {
  test('Cavern of Souls pays for the chosen type, and the spell cannot be countered', (mk, t) => {
    const T = mk();
    T.hand('A', 'Grizzly Bears'); T.hand('A', 'Grizzly Bears');
    const cav = T.put('A', 'Cavern of Souls', 'battlefield', { etb: true });
    cav.tapped = false;
    t.eq(cav.chosenType, 'Bear');
    const bear = T.zone('A', 'hand')[0];
    T.mana('A', '1');
    T.cast('A', bear, { resolve: false });
    t.ok(cav.tapped, 'the Cavern paid the green');
    T.g.passPriority('A', true);
    T.mana('B', 'UU');
    T.cast('B', T.hand('B', 'Counterspell'), { targets: [T.stackTarget(bear)] });
    t.zone(bear, 'battlefield', 'it could not be countered');
  });

  test('Cavern of Souls mana will not pay for a sorcery', (mk, t) => {
    const T = mk();
    T.hand('A', 'Grizzly Bears');
    const cav = T.put('A', 'Cavern of Souls', 'battlefield', { etb: true });
    cav.tapped = false;
    T.g.tapForMana('A', cav.id, 1, 'U');
    T.mana('A', '2');
    t.no(T.g.castSpell('A', T.hand('A', 'Divination').id, { auto: true }), 'Divination cannot use it');
  });

  test('Wild Growth adds an extra green', (mk, t) => {
    const T = mk();
    const forest = T.bf('A', 'Forest');
    const wg = T.bf('A', 'Wild Growth');
    wg.attachedTo = forest.id; forest.attachments.push(wg.id);
    T.g.tapForMana('A', forest.id, 0);
    t.eq(T.player('A').pool.G, 2);
  });

  test('Blazemire Verge: the second colour needs a Swamp or Mountain', (mk, t) => {
    const T = mk();
    const v = T.bf('A', 'Blazemire Verge');
    t.no(T.g.tapForMana('A', v.id, 1), 'no {B} without the type');
    T.bf('A', 'Swamp');
    t.ok(T.g.tapForMana('A', v.id, 1), 'with a Swamp');
  });

  test('Idol of Oblivion draws only after a token', (mk, t) => {
    const T = mk();
    const idol = T.bf('A', 'Idol of Oblivion');
    t.no(T.g.activateAbility('A', idol.id, 0, {}), 'no token yet');
    T.g._createNamedToken('A', { token: 'Treasure', n: 1 });
    T.activate('A', idol, 0);
    t.eq(T.zone('A', 'hand').length, 1);
  });
};
