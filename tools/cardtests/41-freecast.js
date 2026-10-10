/* A spell cast without paying its mana cost is still cast (CR 601.2f):
   the price starts from nothing, every increase goes on top of it (a
   Thalia's tax, Trinisphere's floor), and that much is paid as it is cast,
   mid-resolution if that is where it is cast; what can't be paid isn't
   cast. */
'use strict';
module.exports = (test) => {
  test('Free casts: cascade with nothing taxing it pays nothing', (mk, t) => {
    const T = mk();
    const div = T.top('A', 'Divination');
    T.mana('A', 'RG2C');
    T.cast('A', T.hand('A', 'Bloodbraid Elf'), { resolve: false });
    T.resolve();
    t.no(div.zone === 'library', 'Divination was cast');
    t.eq(T.player('A').pool.total(), 1, 'the spare mana is still there');
  });

  test("Free casts: cascade under Thalia pays its {1} for a noncreature spell", (mk, t) => {
    const T = mk();
    T.bf('B', 'Thalia, Guardian of Thraben');
    const div = T.top('A', 'Divination');
    T.mana('A', 'RG2C');
    T.cast('A', T.hand('A', 'Bloodbraid Elf'));
    t.no(div.zone === 'library', 'Divination was cast');
    t.ok(T.g.log.some(l => /pays \{1\} to cast Divination/.test(l.text)), 'its tax was paid');
    t.eq(T.player('A').pool.total(), 0, 'with the spare mana');
  });

  test('Free casts: under Thalia with nothing to pay with, the cascaded card is not cast', (mk, t) => {
    const T = mk();
    T.bf('B', 'Thalia, Guardian of Thraben');
    const div = T.top('A', 'Divination');
    T.mana('A', 'RG2');
    T.cast('A', T.hand('A', 'Bloodbraid Elf'));
    t.zone(div, 'library', 'it went to the bottom instead');
  });

  test('Free casts: Trinisphere makes a cascaded spell cost three', (mk, t) => {
    let T = mk();
    T.bf('B', 'Trinisphere');
    let div = T.top('A', 'Divination');
    T.mana('A', 'RG2CC');
    T.cast('A', T.hand('A', 'Bloodbraid Elf'));
    t.zone(div, 'library', 'two spare mana are not enough');
    T = mk();
    T.bf('B', 'Trinisphere');
    div = T.top('A', 'Divination');
    T.mana('A', 'RG2CCC');
    T.cast('A', T.hand('A', 'Bloodbraid Elf'));
    t.no(div.zone === 'library', 'three are');
    t.ok(T.g.log.some(l => /pays \{3\} to cast Divination/.test(l.text)));
  });
};
