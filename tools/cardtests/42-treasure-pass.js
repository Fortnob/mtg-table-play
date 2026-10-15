/* Sources that sacrifice themselves for mana (Treasure) count as mana you could spend: the table doesn't pass for you,
   and paying uses them only when your taps can't cover the cost. Paying for a person, the game never sacrifices one
   without asking first ("Sacrifice 3 Treasures to cast Lightning Bolt?"); a bot is never asked. */
'use strict';
module.exports = (test) => {
  const token = (T, name, pid) => { T.g._createNamedToken(pid || 'A', { token: name, n: 1 }); return T.bfOf(pid || 'A').filter(x => x.isToken && x.name === name).pop(); };
  const treasure = (T, pid) => token(T, 'Treasure', pid);
  const sacAsked = (T) => T.asked.filter(ch => ch.purpose === 'sacMana');

  test('Treasure: counts as mana for what you could cast, and is spent to cast it once you say yes', (mk, t) => {
    const T = mk();
    const g = T.g;
    T.bf('A', 'Mountain', { tapped: true });
    const tr = treasure(T);
    const bolt = T.hand('A', 'Lightning Bolt');
    t.ok(g.playableNow('A').some(x => x.kind === 'cast' && x.objId === bolt.id), 'Lightning Bolt is castable with the Treasure');
    t.ok(g.canPayNow('A', '{R}', { forSpell: bolt }), 'the cost can be paid');
    const life = T.life('B');
    T.cast('A', bolt, { targets: ['B'] });
    t.eq(sacAsked(T).length, 1, 'asked once');
    t.zone(bolt, 'graveyard');
    t.eq(T.life('B'), life - 3, 'it resolved');
    t.no(T.bfOf('A').includes(tr), 'the Treasure was sacrificed to pay');
  });

  test('Treasure: the question comes before anything is paid, and says what goes for what', (mk, t) => {
    const T = mk();
    const g = T.g;
    const land = T.bf('A', 'Mountain', { tapped: true });
    const tr = treasure(T);
    const bolt = T.hand('A', 'Lightning Bolt');
    t.ok(g.castSpell('A', bolt.id, { auto: true, targets: [{ kind: 'player', id: 'B' }] }), 'the cast is taken, as a question');
    const ch = g.pendingChoice;
    t.ok(ch && ch.type === 'confirm' && ch.purpose === 'sacMana' && ch.playerId === 'A', 'A is asked');
    t.eq(ch.prompt, 'Sacrifice a Treasure to cast Lightning Bolt?', 'the question');
    t.eq(ch.yesLabel, 'Sacrifice and cast', 'yes');
    t.eq(ch.noLabel, 'Cancel', 'no');
    t.eq(ch.sacMana && ch.sacMana.ids.join(), tr.id, 'it names the Treasure');
    t.eq(ch.sourceId, bolt.id, 'the spell is shown with it');
    t.zone(bolt, 'hand', 'nothing cast yet');
    t.ok(T.bfOf('A').includes(tr) && !tr.tapped, 'the Treasure is untouched');
    t.ok(land.tapped, 'the land as it was');
    t.eq(g.stack.length, 0, 'nothing on the stack');
    // only the player asked sees what is asked
    const mine = g.viewFor('A').pendingChoice, theirs = g.viewFor('B').pendingChoice;
    t.ok(mine && mine.sacMana && mine.prompt === ch.prompt, "A's view has the question");
    t.ok(theirs && theirs.waiting && !theirs.sacMana && !theirs.prompt, "B's view only says A is choosing");
  });

  test('Treasure: Cancel leaves everything as it was', (mk, t) => {
    const T = mk();
    const g = T.g;
    T.bf('A', 'Mountain', { tapped: true });
    const tr = treasure(T);
    const bolt = T.hand('A', 'Lightning Bolt');
    const life = T.life('B');
    T.answer('confirm', { yes: false });
    T.cast('A', bolt, { targets: ['B'] });
    t.eq(sacAsked(T).length, 1, 'asked');
    t.zone(bolt, 'hand', 'the card is back in hand');
    t.ok(T.bfOf('A').includes(tr) && !tr.tapped, 'the Treasure stays');
    t.eq(T.life('B'), life, 'nothing happened');
    t.eq(g.stack.length, 0, 'nothing on the stack');
    t.no(g.pendingChoice, 'no question left');
    const pool = g.player('A').pool;
    t.eq(['W', 'U', 'B', 'R', 'G', 'C'].reduce((k, c) => k + (pool[c] || 0), 0), 0, 'no mana made');
    t.eq(g.priorityPlayer && g.priorityPlayer.id, 'A', 'still A to act');
  });

  test('Treasure: a no undoes what the attempt did before paying (a Defiler’s life)', (mk, t) => {
    const T = mk();
    const life = T.life('A');
    // Defiler of Faith: 2 life for {W} less, paid as the spell is cast — not lost when the cast is called off
    T.bf('A', 'Defiler of Faith');
    const plains = [T.bf('A', 'Plains'), T.bf('A', 'Plains'), T.bf('A', 'Plains')];
    const trs = [treasure(T), treasure(T)];
    const angel = T.hand('A', 'Serra Angel');      // {3}{W}{W}: {3}{W} with the life
    T.answer('choose', { picks: [0] });
    T.answer('confirm', { yes: false });
    T.cast('A', angel, {});
    const asked = sacAsked(T);
    t.eq(asked.length, 1, 'asked');
    t.eq(asked[0].prompt, 'Sacrifice a Treasure to cast Serra Angel?', 'one Treasure, with the life paid');
    t.zone(angel, 'hand', 'not cast');
    t.eq(T.life('A'), life, 'no life paid');
    t.ok(plains.every(x => !x.tapped), 'no land tapped');
    t.ok(trs.every(x => T.bfOf('A').includes(x)), 'the Treasures stay');
  });

  test('Treasure: lands that can pay are tapped first, the Treasure kept, nobody asked', (mk, t) => {
    const T = mk();
    const land = T.bf('A', 'Mountain');
    const tr = treasure(T);
    const bolt = T.hand('A', 'Lightning Bolt');
    T.cast('A', bolt, { targets: ['B'] });
    t.eq(sacAsked(T).length, 0, 'never asked');
    t.ok(land.tapped, 'the Mountain paid');
    t.ok(T.bfOf('A').includes(tr), 'the Treasure is still there');
  });

  test('Treasure: a Treasure pays the part the lands can’t', (mk, t) => {
    const T = mk();
    const land = T.bf('A', 'Forest');
    const tr = treasure(T);
    const o = T.hand('A', 'Lightning Bolt');
    t.ok(T.g.canPayNow('A', '{R}{G}'), '{R}{G} with a Forest and a Treasure');
    t.no(T.g.canPayNow('A', '{R}{R}'), 'but not {R}{R}');
    T.cast('A', o, { targets: ['B'] });
    t.eq(sacAsked(T).length, 1, 'asked about the Treasure');
    t.no(land.tapped, 'the Forest can’t make red: untouched');
    t.no(T.bfOf('A').includes(tr), 'the Treasure made the red');
  });

  test('Treasure: the question counts them, by name, once for the cast', (mk, t) => {
    const T = mk();
    const g = T.g;
    const trs = [treasure(T), treasure(T), treasure(T)];
    const o = T.hand('A', 'Hill Giant');      // {3}{R}
    T.bf('A', 'Mountain');
    T.cast('A', o, {});
    const asked = sacAsked(T);
    t.eq(asked.length, 1, 'one question for the cast, not one per Treasure');
    t.eq(asked[0].prompt, 'Sacrifice 3 Treasures to cast Hill Giant?', 'the count and the name');
    t.zone(o, 'battlefield');
    t.ok(trs.every(x => !T.bfOf('A').includes(x)), 'all three went');
    void g;
  });

  test('Treasure: several kinds are named apart', (mk, t) => {
    const T = mk();
    treasure(T); treasure(T); token(T, 'Gold');
    const o = T.hand('A', 'Hill Giant');      // {3}{R}
    T.bf('A', 'Mountain');
    T.answer('confirm', { yes: false });
    T.cast('A', o, {});
    const asked = sacAsked(T);
    t.eq(asked.length, 1, 'asked');
    t.eq(asked[0].prompt, 'Sacrifice 2 Treasures and a Gold token to cast Hill Giant?', 'Treasures and a Gold token');
    t.zone(o, 'hand');
  });

  test('Treasure: a bot spends it without being asked', (mk, t) => {
    const T = mk();
    T.g.player('A').isBot = true;
    T.bf('A', 'Mountain', { tapped: true });
    const tr = treasure(T);
    const bolt = T.hand('A', 'Lightning Bolt');
    T.cast('A', bolt, { targets: ['B'] });
    t.eq(sacAsked(T).length, 0, 'not asked');
    t.zone(bolt, 'graveyard');
    t.no(T.bfOf('A').includes(tr), 'the Treasure paid');
  });

  test('Treasure: tapped by hand, it is yours to spend: nothing asked', (mk, t) => {
    const T = mk();
    const g = T.g;
    const tr = treasure(T);
    const bolt = T.hand('A', 'Lightning Bolt');
    t.ok(g.tapForMana('A', tr.id, 0, 'R'), 'tapped for red by hand');
    T.cast('A', bolt, { targets: ['B'], fromPool: true, auto: false });
    t.eq(sacAsked(T).length, 0, 'not asked');
    t.zone(bolt, 'graveyard');
    t.no(T.bfOf('A').includes(tr), 'gone: it was sacrificed as it was tapped');
  });

  test('Treasure: an activated ability paid with one asks too', (mk, t) => {
    const T = mk();
    const icy = T.bf('A', 'Icy Manipulator');     // {1}, {T}: Tap target artifact, creature, or land.
    const tr = treasure(T);
    const bear = T.bf('B', 'Grizzly Bears');
    T.answer('confirm', { yes: false });
    T.activate('A', icy, 0, { targets: [bear] });
    let asked = sacAsked(T);
    t.eq(asked.length, 1, 'asked');
    t.eq(asked[0].prompt, 'Sacrifice a Treasure to activate Icy Manipulator’s ability?', 'the question');
    t.eq(asked[0].yesLabel, 'Sacrifice and activate', 'yes');
    t.no(icy.tapped, 'cancelled: Icy Manipulator untapped');
    t.ok(T.bfOf('A').includes(tr), 'the Treasure stays');
    T.activate('A', icy, 0, { targets: [bear] });
    asked = sacAsked(T);
    t.eq(asked.length, 2, 'asked again');
    t.ok(icy.tapped && bear.tapped, 'activated, and it resolved');
    t.no(T.bfOf('A').includes(tr), 'the Treasure paid');
  });

  test('Treasure: a price a question offers says what paying it sacrifices (Mana Leak)', (mk, t) => {
    const T = mk();
    const g = T.g;
    const trs = [treasure(T), treasure(T), treasure(T)];
    T.bf('A', 'Forest'); T.bf('A', 'Forest');
    T.bf('B', 'Island'); T.bf('B', 'Island');
    const bear = T.hand('A', 'Grizzly Bears');
    T.cast('A', bear, { resolve: false });
    t.eq(sacAsked(T).length, 0, 'the lands paid for the Bears');
    const leak = T.hand('B', 'Mana Leak');
    g.passPriority('A');
    t.ok(g.castSpell('B', leak.id, { auto: true, targets: [T.stackTarget(bear)] }), 'Mana Leak');
    T.answer('payOrDont', (ch) => {
      t.eq(ch.prompt, 'Pay {3}? Paying it sacrifices 3 Treasures.', 'the note');
      t.eq(ch.sacMana && ch.sacMana.n, 3, 'three of them');
      t.no(ch.auto, 'not offered as an answer for the rest of the turn');
      return { pay: true };
    });
    T.resolve();
    t.ok(T.asked.some(ch => ch.type === 'payOrDont'), 'asked to pay');
    t.eq(sacAsked(T).length, 0, 'no second question');
    t.zone(bear, 'battlefield', 'paid: the Bears resolved');
    t.ok(trs.every(x => !T.bfOf('A').includes(x)), 'the Treasures paid');
  });

  test('Treasure: a ward paid as the spell is cast is asked about with the cast', (mk, t) => {
    const T = mk();
    const terror = T.bf('B', 'Tolarian Terror');   // Ward {2}
    T.bf('A', 'Mountain');
    const trs = [treasure(T), treasure(T)];
    const bolt = T.hand('A', 'Lightning Bolt');
    T.cast('A', bolt, { targets: [terror] });
    const asked = sacAsked(T);
    t.eq(asked.length, 1, 'asked once');
    t.eq(asked[0].prompt, 'Sacrifice 2 Treasures to cast Lightning Bolt?', 'the question');
    t.zone(bolt, 'graveyard');
    t.eq(terror.damage, 3, 'not countered');
    t.ok(trs.every(x => !T.bfOf('A').includes(x)), 'the Treasures paid the ward');
  });

  test('Treasure: a ward asked as its trigger resolves says what paying sacrifices, and the yes pays', (mk, t) => {
    const T = mk();
    const terror = T.bf('B', 'Tolarian Terror');   // Ward {2}
    for (let k = 0; k < 4; k++) T.bf('A', 'Mountain');
    const trs = [treasure(T), treasure(T)];
    const fk = T.hand('A', 'Flametongue Kavu');     // {3}{R}: 4 damage to target creature as it enters
    T.answer('pickTarget', { targets: [{ kind: 'object', id: terror.id }] });
    T.cast('A', fk, {});
    t.eq(sacAsked(T).length, 0, 'the lands paid for the Kavu');
    const ward = T.asked.find(ch => ch.purpose === 'wardPrice');
    t.ok(ward && /Paying it sacrifices 2 Treasures\.$/.test(ward.prompt), 'the ward question names them: ' + (ward && ward.prompt));
    t.ok(ward && !ward.auto, 'not offered for the rest of the turn');
    t.eq(terror.damage, 4, 'paid: the Kavu hit');
    t.ok(trs.every(x => !T.bfOf('A').includes(x)), 'the Treasures paid the ward');
  });

  test('Treasure: an attack that costs mana asks before a Treasure pays for it', (mk, t) => {
    const T = mk();
    const g = T.g;
    T.bf('B', 'Ghostly Prison');
    const bear = T.bf('A', 'Grizzly Bears');
    const trs = [treasure(T), treasure(T)];
    for (let k = 0; k < 40 && !(g.pendingChoice && g.pendingChoice.type === 'declareAttackers'); k++) g.passPriority(g.priorityPlayer.id, true);
    t.ok(g.pendingChoice && g.pendingChoice.type === 'declareAttackers', 'declaring attackers');
    const decl = [{ attackerId: bear.id, defenderId: 'B' }];
    t.ok(g.declareAttackers('A', decl), 'taken, as a question');
    t.eq(g.pendingChoice.purpose, 'sacMana', 'asked');
    t.eq(g.pendingChoice.prompt, 'Sacrifice 2 Treasures to pay for the attack?', 'the question');
    g.resolveChoice('A', { yes: false });
    t.ok(g.pendingChoice && g.pendingChoice.type === 'declareAttackers', 'no: declaring attackers again');
    t.no(bear.attacking, 'nothing attacks yet');
    t.ok(trs.every(x => T.bfOf('A').includes(x)), 'the Treasures stay');
    g.declareAttackers('A', decl);
    g.resolveChoice('A', { yes: true });
    t.ok(bear.attacking, 'yes: the Bears attack');
    t.ok(trs.every(x => !T.bfOf('A').includes(x)), 'paid with the Treasures');
  });
};
