/* Regression coverage for the first batch of newly automated cards. */
'use strict';
module.exports = (test) => {
  test('Collected Company: puts up to two creatures with mana value 3 or less onto the battlefield', (mk, t) => {
    t.auto('Collected Company');
    const T = mk();
    T.top('A', 'Grizzly Bears');
    T.top('A', 'Llanowar Elves');
    T.top('A', 'Colossal Dreadmaw');
    T.top('A', 'Island');
    T.top('A', 'Opt');
    T.top('A', 'Forest');
    T.mana('A', '3G');
    T.cast('A', T.hand('A', 'Collected Company'));
    t.ok(T.g.battlefield.some(o => o.controller === 'A' && o.name === 'Grizzly Bears'), 'puts a legal creature onto the battlefield');
    t.ok(T.g.battlefield.some(o => o.controller === 'A' && o.name === 'Llanowar Elves'), 'puts second legal creature onto the battlefield');
    t.ok(!T.g.battlefield.some(o => o.controller === 'A' && o.name === 'Colossal Dreadmaw'), 'does not take a creature over mana value 3');
  });

  test('Structural Assault: artifact deaths scale its creature damage', (mk, t) => {
    t.auto('Structural Assault');
    const T = mk();
    T.bf('A', 'Ornithopter');
    T.bf('B', 'Sol Ring');
    const bear = T.bf('A', 'Grizzly Bears');
    const elf = T.bf('B', 'Llanowar Elves');
    T.mana('A', '3RR');
    T.cast('A', T.hand('A', 'Structural Assault'));
    t.ok(!T.g.battlefield.includes(bear), 'damages and destroys a 2/2');
    t.ok(!T.g.battlefield.includes(elf), 'damages and destroys a 1/1');
  });

  test('Party Dude: level-ups and Food creation are wired', (mk, t) => {
    t.auto('Party Dude');
    const T = mk();
    const cls = T.bf('A', 'Party Dude', {etb:true});
    T.resolve();
    t.eq(T.g.battlefield.filter(o => o.name === 'Food').length, 2, 'each player gets a Food token');
    T.mana('A', '1G');
    T.activate('A', cls, 1);
    t.eq(cls.counters.level, 1, 'level 2 adds one level counter');
    T.mana('A', '4G');
    T.activate('A', cls, 3);
    t.eq(cls.counters.level, 2, 'level 3 adds a second level counter');
  });

  test('Green Slime: ETB trigger includes an activated/triggered-ability counter', (mk, t) => {
    t.auto('Green Slime');
    const T = mk();
    const c = T.hand('A', 'Green Slime');
    t.ok((c.analysis().abilities || []).some(a => a.kind === 'triggered' && (a.effects || []).some(e => e.op === 'counterSpell')), 'ETB has a counter effect');
  });

  test('Topography Tracker: ETB creates a Map token', (mk, t) => {
    t.auto('Topography Tracker');
    const T = mk();
    T.bf('A', 'Topography Tracker', {etb:true});
    T.resolve();
    t.ok(T.g.battlefield.some(o => o.controller === 'A' && o.name === 'Map'), 'creates a Map token');
  });

  for (const name of ["Anzrag's Rampage", "Titania's Song", "Call to the Kindred", "Tide Shaper", "Deeproot Historian", "Over the Edge"]) {
    test(name + ': card-specific automation is present', (mk, t) => { t.auto(name); });
  }
};
