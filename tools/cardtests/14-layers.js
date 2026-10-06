/* Continuous effects in layer order (CR 613): copy, control, type, colour,
   abilities, then power and toughness (set, modify with counters, switch),
   oldest first within a layer unless one effect depends on another.

   Many of these are XMage's own layer tests (vendor/xmage/Mage.Tests,
   MIT licensed), ported: the same cards, the same expected results. Each
   says which one it came from. */
'use strict';
module.exports = (test) => {
  const types = (o) => o.analysis().types;
  const subs = (o) => o.analysis().subtypes;
  const pt = (T, o) => T.g.powerOf(o) + '/' + T.g.toughnessOf(o);
  /** Every colour of mana one permanent could tap for. */
  const manaOf = (T, o) => {
    const out = new Set();
    for (const ab of T.g.manaAbilitiesOf(o)) {
      const got = T.g._manaOptions(ab, o, o.controller);
      for (const c of got.produces) out.add(c);
    }
    return Array.from(out).sort().join('');
  };
  /** Put an Aura or Equipment on something without casting it. */
  const attach = (T, a, host) => {
    a.attachedTo = host.id;
    host.attachments = (host.attachments || []).concat(a.id);
    a.ts = T.g._stampNew();
    T.g.bumpBoard();
  };

  /* ---------- layer 4: types, and what depends on what ---------- */

  test('Layers: Blood Moon makes Urborg a Mountain, and nothing is a Swamp (XMage LayerTests)', (mk, t) => {
    const T = mk();
    T.bf('A', 'Blood Moon');
    const urborg = T.bf('A', 'Urborg, Tomb of Yawgmoth');
    const plains = T.bf('A', 'Plains');
    t.ok(subs(urborg).includes('Mountain'), 'Urborg is a Mountain');
    t.no(subs(urborg).includes('Swamp'), 'Urborg is no Swamp');
    t.no(subs(plains).includes('Swamp'), 'the Plains is not a Swamp: Urborg has no ability left');
    t.eq(manaOf(T, plains), 'W');
    t.eq(manaOf(T, urborg), 'R');
  });

  test('Layers: Urborg older than Blood Moon changes nothing: Blood Moon goes first (CR 613.8)', (mk, t) => {
    const T = mk();
    const urborg = T.bf('A', 'Urborg, Tomb of Yawgmoth');
    const plains = T.bf('A', 'Plains');
    T.bf('B', 'Blood Moon');
    t.eq(subs(urborg).join(' '), 'Mountain');
    t.no(subs(plains).includes('Swamp'));
    t.eq(manaOf(T, plains), 'W');
  });

  test('Layers: Urborg alone makes every land a Swamp that taps for black', (mk, t) => {
    const T = mk();
    T.bf('A', 'Urborg, Tomb of Yawgmoth');
    const plains = T.bf('B', 'Plains');
    t.ok(subs(plains).includes('Swamp'));
    t.eq(manaOf(T, plains), 'BW');
    t.ok(T.g._matchesCategory(plains, 'swamp'), 'it answers to "Swamp"');
  });

  test('Layers: Blood Moon on a dual land taps for red only; a basic is untouched', (mk, t) => {
    const T = mk();
    T.bf('A', 'Blood Moon');
    const vents = T.bf('B', 'Steam Vents');
    const island = T.bf('B', 'Island');
    t.eq(subs(vents).join(' '), 'Mountain');
    t.eq(manaOf(T, vents), 'R');
    t.eq(manaOf(T, island), 'U');
  });

  test('Layers: Spreading Seas, then Blood Moon: the land is a Mountain (XMage BloodMoonTest)', (mk, t) => {
    const T = mk();
    const vents = T.bf('B', 'Steam Vents');
    const seas = T.bf('A', 'Spreading Seas');
    attach(T, seas, vents);
    T.bf('A', 'Blood Moon');
    t.eq(manaOf(T, vents), 'R');
  });

  test('Layers: Blood Moon, then Spreading Seas: the land is an Island (XMage BloodMoonTest)', (mk, t) => {
    const T = mk();
    const vents = T.bf('B', 'Steam Vents');
    T.bf('A', 'Blood Moon');
    const seas = T.bf('A', 'Spreading Seas');
    attach(T, seas, vents);
    t.eq(subs(vents).join(' '), 'Island');
    t.eq(manaOf(T, vents), 'U');
  });

  test('Layers: Urborg, Animate Land and Ovinize: a 0/1 Swamp creature (XMage LayerTests)', (mk, t) => {
    const T = mk();
    const urborg = T.bf('A', 'Urborg, Tomb of Yawgmoth');
    T.bf('A', 'Forest');
    T.mana('A', 'G');
    T.cast('A', T.hand('A', 'Animate Land'), { targets: [urborg] });
    T.mana('A', 'U1');
    T.cast('A', T.hand('A', 'Ovinize'), { targets: [urborg] });
    t.ok(types(urborg).includes('Creature'), 'a creature');
    t.ok(subs(urborg).includes('Swamp'), 'its own effect applied in layer 4, before it lost the ability in 6');
    t.eq(pt(T, urborg), '0/1');
    t.eq(T.g.manaAbilitiesOf(urborg).length, 0, 'no abilities, mana ones included');
  });

  test('Layers: Enchanted Evening before Opalescence, whatever the timestamps (XMage LayerTests)', (mk, t) => {
    for (const evening of [true, false]) {
      const T = mk();
      const swamp = T.bf('A', 'Swamp');
      T.bf('A', 'Glorious Anthem');
      let ev = null;
      if (evening) ev = T.bf('A', 'Enchanted Evening');
      T.bf('A', 'Opalescence');
      if (!evening) ev = T.bf('A', 'Enchanted Evening');
      t.ok(types(swamp).includes('Enchantment') && types(swamp).includes('Creature'), 'the Swamp is an enchantment creature');
      t.eq(pt(T, swamp), '1/1', 'mana value 0, and the anthem');
      t.eq(pt(T, ev), '6/6', 'Enchanted Evening: mana value 5, and the anthem');
    }
  });

  test('Layers: Imprisoned in the Moon makes a creature a colourless land that taps for {C}', (mk, t) => {
    const T = mk();
    const angel = T.bf('B', 'Serra Angel');
    const moon = T.bf('A', 'Imprisoned in the Moon');
    attach(T, moon, angel);
    t.eq(types(angel).join(' '), 'Land');
    t.eq(subs(angel).length, 0, 'no creature types without the creature type');
    t.eq(angel.analysis().colors.length, 0, 'colourless');
    t.no(T.g.hasKw(angel, 'flying'));
    t.eq(manaOf(T, angel), 'C');
    T.g.checkStateBasedActions();
    t.zone(angel, 'battlefield', 'a land with no toughness does not die');
  });

  test('Layers: Imprisoned in the Moon on an Urza land keeps the land type, taps for {C} (XMage ImprisonedInTheMoonTest)', (mk, t) => {
    const T = mk();
    const mine = T.bf('B', "Urza's Mine");
    const moon = T.bf('A', 'Imprisoned in the Moon');
    attach(T, moon, mine);
    t.ok(subs(mine).includes('Mine'), 'still a Mine');
    t.eq(T.g.manaAbilitiesOf(mine).length, 1, 'only the {C} it was given');
  });

  test('Layers: Lignify makes a Sliver Hivelord a 0/4 Treefolk with nothing else (XMage LignifyTest)', (mk, t) => {
    const T = mk();
    const lord = T.bf('B', 'Sliver Hivelord');
    T.mana('A', 'G1');
    T.cast('A', T.hand('A', 'Lignify'), { targets: [lord] });
    t.eq(pt(T, lord), '0/4');
    t.eq(subs(lord).join(' '), 'Treefolk', 'a Treefolk and not a Sliver');
    t.no(T.g.hasKw(lord, 'indestructible'), 'its ability is gone');
  });

  test('Layers: Darksteel Mutation: a 0/1 Insect artifact creature with indestructible and nothing else', (mk, t) => {
    const T = mk();
    const angel = T.bf('B', 'Serra Angel');
    const mut = T.bf('A', 'Darksteel Mutation');
    attach(T, mut, angel);
    t.eq(types(angel).slice().sort().join(' '), 'Artifact Creature');
    t.eq(subs(angel).join(' '), 'Insect');
    t.eq(pt(T, angel), '0/1');
    t.ok(T.g.hasKw(angel, 'indestructible'), 'what it was given with the effect stays');
    t.no(T.g.hasKw(angel, 'flying'));
  });

  /* ---------- Opalescence and Humility ---------- */

  test('Layers: Opalescence animates other non-Aura enchantments at their mana value (XMage OpalescenceTest)', (mk, t) => {
    const T = mk();
    const chef = T.bf('A', 'Dockside Chef');
    const alms = T.bf('A', 'Alms');
    const opal = T.bf('A', 'Opalescence');
    const amok = T.bf('B', 'Amok');
    t.eq(pt(T, chef), '1/1');
    t.ok(alms.analysis().isCreature);
    t.eq(pt(T, alms), '1/1');
    t.eq(pt(T, amok), '2/2');
    t.no(opal.analysis().isCreature, 'not itself');
  });

  test('Layers: when Opalescence goes, so does its effect (XMage OpalescenceTest)', (mk, t) => {
    const T = mk();
    const chef = T.bf('A', 'Dockside Chef');
    const alms = T.bf('A', 'Alms');
    const opal = T.bf('A', 'Opalescence');
    t.ok(alms.analysis().isCreature);
    T.g.moveObject(opal, 'graveyard');
    t.eq(pt(T, chef), '1/2');
    t.no(alms.analysis().isCreature);
  });

  test('Layers: Humility older than Opalescence: Humility is a 4/4 with no abilities', (mk, t) => {
    const T = mk();
    const hum = T.bf('A', 'Humility');
    const opal = T.bf('A', 'Opalescence');
    const bear = T.bf('B', 'Grizzly Bears');
    t.ok(hum.analysis().isCreature);
    t.eq(pt(T, hum), '4/4', 'Opalescence sets it later');
    t.eq(pt(T, bear), '1/1');
    t.no(opal.analysis().isCreature);
    t.eq(hum.analysis().abilities.length, 0, 'Humility has lost its own ability, but its effect carries on (CR 613.6)');
  });

  test('Layers: Humility newer than Opalescence: everything is 1/1, Humility too', (mk, t) => {
    const T = mk();
    T.bf('A', 'Opalescence');
    const hum = T.bf('A', 'Humility');
    const bear = T.bf('B', 'Grizzly Bears');
    t.eq(pt(T, hum), '1/1');
    t.eq(pt(T, bear), '1/1');
  });

  test('Layers: Humility takes a lord\'s anthem away along with its other abilities', (mk, t) => {
    const T = mk();
    const marshal = T.bf('A', 'Benalish Marshal');
    const bear = T.bf('A', 'Grizzly Bears');
    t.eq(pt(T, bear), '3/3');
    T.bf('B', 'Humility');
    t.eq(pt(T, bear), '1/1', 'the Marshal has no ability to give');
    t.eq(pt(T, marshal), '1/1');
  });

  test('Layers: Humility, then an anthem: 7c comes after 7b', (mk, t) => {
    const T = mk();
    T.bf('B', 'Humility');
    T.bf('A', 'Glorious Anthem');
    const angel = T.bf('A', 'Serra Angel');
    t.eq(pt(T, angel), '2/2');
    t.no(T.g.hasKw(angel, 'flying'));
    t.no(T.g.hasKw(angel, 'vigilance'));
  });

  test('Layers: under Humility, counters and a Giant Growth still count', (mk, t) => {
    const T = mk();
    T.bf('B', 'Humility');
    const bear = T.bf('A', 'Grizzly Bears', { counters: { '+1/+1': 1 } });
    t.eq(pt(T, bear), '2/2');
    T.mana('A', 'G');
    T.cast('A', T.hand('A', 'Giant Growth'), { targets: [bear] });
    t.eq(pt(T, bear), '5/5');
  });

  test('Layers: Humility over a characteristic-defining ability: Nightmare is 1/1', (mk, t) => {
    const T = mk();
    T.bf('A', 'Swamp'); T.bf('A', 'Swamp'); T.bf('A', 'Swamp');
    const nm = T.bf('A', 'Nightmare');
    t.eq(pt(T, nm), '3/3');
    t.ok(T.g.hasKw(nm, 'flying'));
    T.bf('B', 'Humility');
    t.eq(pt(T, nm), '1/1', 'no ability defines it any more (7a), and Humility sets it (7b)');
    t.no(T.g.hasKw(nm, 'flying'));
  });

  test('Layers: "loses all abilities", then a keyword granted later: it has the keyword', (mk, t) => {
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    T.bf('B', 'Humility');
    T.mana('A', 'U');
    T.cast('A', T.hand('A', 'Jump'), { targets: [bear] });
    t.ok(T.g.hasKw(bear, 'flying'), 'Jump is newer than Humility');
  });

  test('Layers: a keyword granted, then "loses all abilities": it is gone', (mk, t) => {
    const T = mk();
    const bear = T.bf('A', 'Grizzly Bears');
    T.mana('A', 'U');
    T.cast('A', T.hand('A', 'Jump'), { targets: [bear] });
    t.ok(T.g.hasKw(bear, 'flying'));
    T.mana('A', 'U1');
    T.cast('A', T.hand('A', 'Ovinize'), { targets: [bear] });
    t.no(T.g.hasKw(bear, 'flying'), 'Ovinize is newer');
    t.eq(pt(T, bear), '0/1');
  });

  test('Layers: a static keyword grant newer than Humility survives it; an older one does not', (mk, t) => {
    const T = mk();
    T.bf('A', 'Levitation');
    const older = T.bf('A', 'Grizzly Bears');
    T.bf('B', 'Humility');
    t.no(T.g.hasKw(older, 'flying'), 'Levitation is older than Humility');
    const T2 = mk();
    T2.bf('B', 'Humility');
    T2.bf('A', 'Levitation');
    const bear = T2.bf('A', 'Grizzly Bears');
    t.ok(T2.g.hasKw(bear, 'flying'), 'Levitation is newer');
  });

  test('Layers: Humility leaves rules laid on a creature from outside (Pacifism)', (mk, t) => {
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'W1');
    T.cast('A', T.hand('A', 'Pacifism'), { targets: [bear] });
    T.bf('A', 'Humility');
    t.ok(T.g._hasFlag(bear, 'cantAttack'), 'Pacifism is not an ability of the Bears');
  });

  test('Layers: Godhead of Awe makes every other creature 1/1', (mk, t) => {
    const T = mk();
    const god = T.bf('A', 'Godhead of Awe');
    const angel = T.bf('B', 'Serra Angel');
    t.eq(pt(T, angel), '1/1');
    t.ok(T.g.hasKw(angel, 'flying'), 'base power and toughness only');
    t.eq(pt(T, god), '4/4');
  });

  /* ---------- layer 7: set, modify, switch ---------- */

  test('Layers: Giant Growth, then Turn to Frog: a 4/4 Frog (7b before 7c)', (mk, t) => {
    const T = mk();
    const angel = T.bf('B', 'Serra Angel');
    T.mana('A', 'G');
    T.cast('A', T.hand('A', 'Giant Growth'), { targets: [angel] });
    T.mana('A', 'U1');
    T.cast('A', T.hand('A', 'Turn to Frog'), { targets: [angel] });
    t.eq(pt(T, angel), '4/4');
  });

  test('Layers: Turn to Frog, then Giant Growth: a 4/4 Frog too', (mk, t) => {
    const T = mk();
    const angel = T.bf('B', 'Serra Angel');
    T.mana('A', 'U1');
    T.cast('A', T.hand('A', 'Turn to Frog'), { targets: [angel] });
    T.mana('A', 'G');
    T.cast('A', T.hand('A', 'Giant Growth'), { targets: [angel] });
    t.eq(pt(T, angel), '4/4');
  });

  test('Layers: Turn to Frog: a blue Frog with no abilities, until the turn ends (XMage TurnToFrogTest)', (mk, t) => {
    const T = mk();
    const angel = T.bf('B', 'Serra Angel');
    T.mana('A', 'U1');
    T.cast('A', T.hand('A', 'Turn to Frog'), { targets: [angel] });
    t.eq(subs(angel).join(' '), 'Frog');
    t.eq(angel.analysis().colors.join(''), 'U');
    t.no(T.g.hasKw(angel, 'flying'));
    t.no(T.g.hasKw(angel, 'vigilance'));
    t.eq(pt(T, angel), '1/1');
    T.nextTurn('B');
    t.eq(pt(T, angel), '4/4');
    t.ok(T.g.hasKw(angel, 'flying'));
    t.eq(subs(angel).join(' '), 'Angel');
  });

  test('Layers: Turn to Frog on a creature that is getting -2/-0 is a -1/1 (XMage TurnToFrogTest)', (mk, t) => {
    const T = mk();
    const wurm = T.bf('B', 'Craw Wurm');
    wurm.effects.push({ p: -2, t: 0, until: 'eot' });
    T.mana('A', 'U1');
    T.cast('A', T.hand('A', 'Turn to Frog'), { targets: [wurm] });
    t.eq(pt(T, wurm), '-1/1');
  });

  test('Layers: a creature that loses all abilities loses its mana ability', (mk, t) => {
    const T = mk();
    const elf = T.bf('A', 'Llanowar Elves');
    t.eq(T.g.manaAbilitiesOf(elf).length, 1);
    T.mana('A', 'U1');
    T.cast('A', T.hand('A', 'Ovinize'), { targets: [elf] });
    t.eq(T.g.manaAbilitiesOf(elf).length, 0);
  });

  test('Layers: Twisted Image switches power and toughness; a 0/8 wall dies', (mk, t) => {
    const T = mk();
    const wall = T.bf('B', 'Wall of Stone');
    T.mana('A', 'U');
    T.cast('A', T.hand('A', 'Twisted Image'), { targets: [wall] });
    t.zone(wall, 'graveyard', 'an 8/0');
  });

  test('Layers: switching comes after pumps and counters, whatever came first (7d)', (mk, t) => {
    for (const growFirst of [true, false]) {
      const T = mk();
      const turtle = T.bf('A', 'Horned Turtle', { counters: { '+1/+1': 1 } });
      const grow = () => { T.mana('A', 'G'); T.cast('A', T.hand('A', 'Giant Growth'), { targets: [turtle] }); };
      if (growFirst) grow();
      T.mana('A', 'U');
      T.cast('A', T.hand('A', 'Twisted Image'), { targets: [turtle] });
      if (!growFirst) grow();
      t.eq(pt(T, turtle), '8/5', 'a 1/4 with a counter and +3/+3 is 5/8, switched');
    }
  });

  test('Layers: switched twice is back where it started', (mk, t) => {
    const T = mk();
    const turtle = T.bf('A', 'Horned Turtle');
    T.mana('A', 'UU');
    T.cast('A', T.hand('A', 'Twisted Image'), { targets: [turtle] });
    t.eq(pt(T, turtle), '4/1');
    T.cast('A', T.hand('A', 'Twisted Image'), { targets: [turtle] });
    t.eq(pt(T, turtle), '1/4');
  });

  test('Layers: counters on a creature whose base power and toughness is set (Lignify)', (mk, t) => {
    const T = mk();
    const angel = T.bf('B', 'Serra Angel', { counters: { '+1/+1': 2 } });
    T.mana('A', 'G1');
    T.cast('A', T.hand('A', 'Lignify'), { targets: [angel] });
    t.eq(pt(T, angel), '2/6');
    T.mana('A', 'G');
    T.cast('A', T.hand('A', 'Giant Growth'), { targets: [angel] });
    t.eq(pt(T, angel), '5/9');
  });

  test('Layers: Animate Land makes a 3/3 land creature that dies to damage like one', (mk, t) => {
    const T = mk();
    const forest = T.bf('A', 'Forest');
    T.mana('A', 'G');
    T.cast('A', T.hand('A', 'Animate Land'), { targets: [forest] });
    t.ok(types(forest).includes('Land') && types(forest).includes('Creature'));
    t.eq(pt(T, forest), '3/3');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: [forest] });
    t.zone(forest, 'graveyard');
  });

  test('Layers: Merfolk Trickster: the creature it taps loses all abilities until end of turn', (mk, t) => {
    const T = mk();
    const angel = T.bf('B', 'Serra Angel');
    T.mana('A', 'UU');
    T.cast('A', T.hand('A', 'Merfolk Trickster'));
    t.ok(angel.tapped);
    t.no(T.g.hasKw(angel, 'flying'));
    T.nextTurn('B');
    t.ok(T.g.hasKw(angel, 'flying'));
  });

  /* ---------- layer 1: copies ---------- */

  test('Layers: a Clone copies the card, not the counters or the Aura on it', (mk, t) => {
    const T = mk();
    const giant = T.bf('B', 'Hill Giant', { counters: { '+1/+1': 2 } });
    T.mana('A', 'W');
    T.cast('A', T.hand('A', 'Holy Strength'), { targets: [giant] });
    t.eq(pt(T, giant), '6/7');
    T.mana('A', 'U3');
    const clone = T.hand('A', 'Clone');
    T.cast('A', clone);
    t.eq(clone.name, 'Hill Giant');
    t.eq(pt(T, clone), '3/3');
  });

  test('Layers: a Clone of a frog copies what is printed (copiable values, CR 707.2)', (mk, t) => {
    const T = mk();
    const angel = T.bf('B', 'Serra Angel');
    T.mana('A', 'U1');
    T.cast('A', T.hand('A', 'Turn to Frog'), { targets: [angel] });
    T.mana('A', 'U3');
    const clone = T.hand('A', 'Clone');
    T.cast('A', clone);
    t.eq(clone.name, 'Serra Angel');
    t.eq(pt(T, clone), '4/4');
    t.ok(T.g.hasKw(clone, 'flying'));
  });

  test('Layers: Mirrorweave makes every other creature a copy until end of turn, counters still on them', (mk, t) => {
    const T = mk();
    const giant = T.bf('A', 'Hill Giant');
    const bear = T.bf('B', 'Grizzly Bears', { counters: { '+1/+1': 1 } });
    const elf = T.bf('B', 'Llanowar Elves');
    T.mana('A', 'WU2');
    T.cast('A', T.hand('A', 'Mirrorweave'), { targets: [giant] });
    t.eq(bear.name, 'Hill Giant');
    t.eq(elf.name, 'Hill Giant');
    t.eq(pt(T, bear), '4/4', 'a 3/3 Hill Giant with its counter');
    t.eq(T.g.manaAbilitiesOf(elf).length, 0, 'no longer an Elf with a mana ability');
    T.nextTurn('B');
    t.eq(bear.name, 'Grizzly Bears');
    t.eq(pt(T, bear), '3/3');
    t.eq(elf.name, 'Llanowar Elves');
  });

  test('Layers: a Clone under Mirrorweave goes back to being what it copied, not a Clone', (mk, t) => {
    const T = mk();
    const angel = T.bf('B', 'Serra Angel');
    T.mana('A', 'U3');
    const clone = T.hand('A', 'Clone');
    T.cast('A', clone);
    t.eq(clone.name, 'Serra Angel');
    const giant = T.bf('A', 'Hill Giant');
    T.mana('A', 'WU2');
    T.cast('A', T.hand('A', 'Mirrorweave'), { targets: [giant] });
    t.eq(clone.name, 'Hill Giant');
    t.eq(angel.name, 'Hill Giant');
    T.nextTurn('B');
    t.eq(clone.name, 'Serra Angel', 'a copy of the Angel again');
    t.eq(angel.name, 'Serra Angel');
    T.g.moveObject(clone, 'hand');
    t.eq(clone.name, 'Clone', 'and itself once it leaves');
  });

  /* ---------- layer 2: control ---------- */

  test('Layers: Control Magic takes a creature, and gives it back when it leaves', (mk, t) => {
    const T = mk();
    const giant = T.bf('B', 'Hill Giant');
    T.mana('A', 'UU2');
    const cm = T.hand('A', 'Control Magic');
    T.cast('A', cm, { targets: [giant] });
    t.eq(giant.controller, 'A');
    T.g.moveObject(cm, 'graveyard');
    T.g.checkStateBasedActions();
    t.eq(giant.controller, 'B');
  });

  test('Layers: Threaten on a creature under Control Magic: the newer wins, then the older again', (mk, t) => {
    const T = mk();
    const giant = T.bf('B', 'Hill Giant');
    T.mana('A', 'UU2');
    T.cast('A', T.hand('A', 'Control Magic'), { targets: [giant] });
    t.eq(giant.controller, 'A');
    T.mana('B', 'R2');
    // B casts on A's turn only with flash; do it on B's own turn
    T.nextTurn('B');
    T.mana('B', 'R2');
    T.cast('B', T.hand('B', 'Threaten'), { targets: [giant] });
    t.eq(giant.controller, 'B', 'Threaten is newer');
    T.nextTurn('A');
    t.eq(giant.controller, 'A', 'Threaten is over, and Control Magic still holds it');
  });

  test('Layers: Control Magic newer than a lasting control effect wins over it', (mk, t) => {
    const T = mk();
    const giant = T.bf('B', 'Hill Giant');
    giant.effects.push({ control: 'B', until: null, ts: T.g._stampNew() });
    T.mana('A', 'UU2');
    const cm = T.hand('A', 'Control Magic');
    T.cast('A', cm, { targets: [giant] });
    t.eq(giant.controller, 'A');
  });

  test('Layers: Switcheroo exchanges control of two creatures for good', (mk, t) => {
    const T = mk();
    const mine = T.bf('A', 'Grizzly Bears');
    const theirs = T.bf('B', 'Serra Angel');
    T.mana('A', 'U4');
    T.cast('A', T.hand('A', 'Switcheroo'), { targets: [mine, theirs] });
    t.eq(mine.controller, 'B');
    t.eq(theirs.controller, 'A');
    T.nextTurn('B');
    t.eq(theirs.controller, 'A', 'no end to it');
  });

  test('Layers: Act of Treason ends with the turn', (mk, t) => {
    const T = mk();
    const giant = T.bf('B', 'Hill Giant');
    T.mana('A', 'R2');
    T.cast('A', T.hand('A', 'Act of Treason'), { targets: [giant] });
    t.eq(giant.controller, 'A');
    t.ok(T.g.hasKw(giant, 'haste'));
    T.nextTurn('B');
    t.eq(giant.controller, 'B');
  });

  /* ---------- state-based actions on attachments (CR 704.5m, 704.5n) ---------- */

  test('Layers: a creature that stops being a creature loses its Pacifism and its Equipment', (mk, t) => {
    const T = mk();
    const bear = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'W1');
    const pac = T.hand('A', 'Pacifism');
    T.cast('A', pac, { targets: [bear] });
    const bs = T.bf('B', 'Bonesplitter');
    attach(T, bs, bear);
    const moon = T.bf('A', 'Imprisoned in the Moon');
    attach(T, moon, bear);
    T.g.checkStateBasedActions();
    t.zone(pac, 'graveyard', 'Pacifism can only enchant a creature');
    t.zone(bs, 'battlefield', 'the Equipment stays');
    t.eq(bs.attachedTo, null, 'but comes off');
    t.eq(moon.attachedTo, bear.id, 'Imprisoned in the Moon can enchant a land');
  });

  test('Layers: Bitter Chill on Adept Watershaper: the Aura goes when the creature does', (mk, t) => {
    const T = mk();
    const ws = T.bf('B', 'Adept Watershaper');
    T.mana('A', 'U1');
    const chill = T.hand('A', 'Bitter Chill');
    T.cast('A', chill, { targets: [ws] });
    t.eq(chill.attachedTo, ws.id);
    const bs = T.bf('B', 'Bonesplitter');
    attach(T, bs, ws);
    T.g.moveObject(ws, 'exile');
    T.g.checkStateBasedActions();
    T.resolve();
    t.zone(chill, 'graveyard');
    t.zone(bs, 'battlefield');
    t.eq(bs.attachedTo, null);
  });
};
