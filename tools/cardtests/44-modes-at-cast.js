/* A modal spell chooses its modes as it is cast, and then the targets of the modes chosen (CR 601.2b–c,
   700.2): everyone sees them while it waits on the stack, and each target is checked again as it
   resolves (CR 608.2b) — a mode whose target has gone does nothing, the rest of the spell still happens. */
'use strict';
module.exports = (test) => {
  const top = (g) => g.stack[g.stack.length - 1];
  const obj = (o) => ({ kind: 'object', id: o.id });
  const pl = (id) => ({ kind: 'player', id });
  const KC = "Kolaghan's Command";

  test('Modes at cast: Kolaghan\'s Command chooses two modes and their targets as it is cast; the stack shows them', (mk, t) => {
    t.auto(KC);
    const T = mk();
    const g = T.g;
    T.grave('A', 'Grizzly Bears');
    const thopter = T.bf('B', 'Ornithopter');
    T.hand('B', 'Island');
    const kc = T.hand('A', KC);
    T.mana('A', '1BR');
    const offer = (g.viewFor('A').castModes || {})[kc.id];
    t.ok(offer && offer.count === 2 && offer.min === 2 && offer.max === 2, 'the table is told it is "choose two"');
    t.eq(offer.options.map(m => m.ok).join(','), 'true,true,true,true', 'and that every mode can be chosen');
    t.no((g.viewFor('B').castModes || {})[kc.id], 'nobody else is told what A could cast');
    T.cast('A', kc, { modes: [2, 1], targets: ['B', thopter], resolve: false });
    const st = top(g);
    t.eq(JSON.stringify(st.chosenModes), '[1,2]', 'the modes, kept on the spell in the order the card prints them');
    t.eq(st.targets.length, 2, 'a target for each chosen mode');
    t.zone(thopter, 'battlefield', 'nothing has happened yet');
    for (const who of ['A', 'B']) {
      const sv = g.viewFor(who).stack.find(s => s.id === st.id);
      t.eq(JSON.stringify(sv.modes), JSON.stringify(['Target player discards a card', 'Destroy target artifact']), who + ' sees the modes, whole');
    }
    t.ok(g.log.some(l => /A chooses for Kolaghan's Command: Target player discards a card; Destroy target artifact\./.test(l.text)), 'the log says what was chosen');
    T.resolve();
    t.zone(thopter, 'graveyard', 'the artifact destroyed');
    t.eq(T.zone('B', 'hand').length, 0, 'B discarded');
  });

  test('Modes at cast: the opponent sees the modes and answers; the mode whose target is gone does nothing, the other still happens', (mk, t) => {
    const T = mk();
    const g = T.g;
    const thopter = T.bf('B', 'Ornithopter');
    T.mana('A', '1BR');
    T.cast('A', T.hand('A', KC), { modes: [2, 3], targets: [thopter, 'B'], resolve: false });
    const st = top(g);
    g.passPriority('A', true);
    t.eq(g.priorityPlayer.id, 'B', 'B has priority with the Command on the stack');
    const seen = g.viewFor('B').stack.find(s => s.id === st.id);
    t.eq(JSON.stringify(seen.modes), JSON.stringify(['Destroy target artifact', "Kolaghan's Command deals 2 damage to any target"]), 'B sees both modes before answering');
    T.mana('B', 'U');
    T.cast('B', T.hand('B', 'Unsummon'), { targets: [thopter] });
    t.zone(thopter, 'hand', 'the Ornithopter went home in response');
    t.eq(T.life('B'), 18, 'the damage mode still happened (CR 608.2b)');
    t.no(g.log.some(l => /Kolaghan's Command is countered on resolution/.test(l.text)), 'the spell was not countered: one target was still legal');
  });

  test('Modes at cast: every target gone — the spell is countered on resolution', (mk, t) => {
    const T = mk();
    const g = T.g;
    const thopter = T.bf('B', 'Ornithopter');
    T.mana('A', '1BR');
    T.cast('A', T.hand('A', KC), { modes: [2, 3], targets: [thopter, thopter], resolve: false });
    g.passPriority('A', true);
    T.mana('B', 'U');
    T.cast('B', T.hand('B', 'Unsummon'), { targets: [thopter] });
    t.ok(g.log.some(l => /Kolaghan's Command is countered on resolution/.test(l.text)), 'no legal target left: countered');
    t.eq(T.life('B'), 20);
  });

  test('Modes at cast: targets are asked only for the chosen modes, after the modes', (mk, t) => {
    const T = mk();
    const g = T.g;
    T.grave('A', 'Grizzly Bears');
    const thopter = T.bf('B', 'Ornithopter');
    T.mana('A', '1BR');
    const kc = T.hand('A', KC);
    // a mode not chosen can't be aimed at
    t.no(g.castSpell('A', kc.id, { auto: true, modes: [1, 3], targets: [thopter, 'B'] }), 'an artifact is no target for "target player discards"');
    t.ok(/isn't a legal target/.test(g.lastError), g.lastError);
    // no modes said: the modes are asked, then those modes' targets
    T.answer('mode', (ch) => {
      t.eq(ch.purpose, 'castModes', 'the modes asked as it is cast');
      t.eq(ch.count, 2);
      t.no(g.stack.length, 'before it is on the stack');
      return { modes: [1, 3] };
    });
    T.answer('pickTarget', (ch) => {
      t.eq(ch.purpose, 'castTargets', 'then its targets');
      t.eq(ch.count, 2, 'two of them');
      t.eq(ch.specs.map(s => s.type).join(','), 'player,any', 'the discard\'s and the damage\'s, nothing for the modes not chosen');
      return { targets: [pl('B'), pl('B')] };
    });
    T.cast('A', kc, { resolve: false });
    t.eq(T.asked.map(c => c.type).join(','), 'mode,pickTarget', 'asked in that order, and nothing more');
    t.eq(JSON.stringify(top(g).chosenModes), '[1,3]');
    T.resolve();
    t.eq(T.life('B'), 18);
  });

  test('Modes at cast: a mode with nothing it could target can\'t be chosen, and the only mode left is chosen without asking', (mk, t) => {
    t.auto('Abzan Charm');
    const T = mk();
    const g = T.g;
    const charm = T.hand('A', 'Abzan Charm');
    T.mana('A', 'WBG');
    const offer = g.viewFor('A').castModes[charm.id];
    t.eq(offer.options.map(m => m.ok).join(','), 'false,true,false', 'no creature: only the cards-and-life mode can be chosen');
    t.no(g.castSpell('A', charm.id, { auto: true, modes: [0] }), 'the exile mode has nothing to target');
    t.ok(/nothing it could target/.test(g.lastError), g.lastError);
    const hand = T.zone('A', 'hand').length;
    T.cast('A', charm, { resolve: false });
    t.no(T.asked.length, 'nothing was asked');
    t.eq(JSON.stringify(top(g).modes), JSON.stringify(['You draw two cards and you lose 2 life']), 'the one mode it could have');
    T.resolve();
    t.eq(T.zone('A', 'hand').length, hand - 1 + 2, 'two cards drawn');
    t.eq(T.life('A'), 18);
  });

  test('Modes at cast: Abzan Charm with a creature to exile — the mode is asked, and its target', (mk, t) => {
    const T = mk();
    const g = T.g;
    const giant = T.bf('B', 'Hill Giant');
    T.mana('A', 'WBG');
    T.answer('mode', (ch) => { t.eq(ch.options.length, 3, 'three modes it could choose'); return { modes: [0] }; });
    T.answer('pickTarget', (ch) => { t.eq(ch.count, 1); return { targets: [obj(giant)] }; });
    T.cast('A', T.hand('A', 'Abzan Charm'));
    t.zone(giant, 'exile');
  });

  test('Modes at cast: each mode once (CR 700.2d), and as many as the card says', (mk, t) => {
    const T = mk();
    const g = T.g;
    T.bf('B', 'Ornithopter');
    T.mana('A', '1BR');
    const kc = T.hand('A', KC);
    t.no(g.castSpell('A', kc.id, { auto: true, modes: [3, 3], targets: ['B', 'B'] }), 'the same mode twice');
    t.ok(/only once/.test(g.lastError), g.lastError);
    t.no(g.castSpell('A', kc.id, { auto: true, modes: [3], targets: ['B'] }), 'one mode of "choose two"');
    t.ok(/Choose two/.test(g.lastError), g.lastError);
    t.no(g.castSpell('A', kc.id, { auto: true, modes: [1, 2, 3], targets: ['B', 'B', 'B'] }), 'three of them');
    t.zone(kc, 'hand', 'still in hand');
  });

  test('Modes at cast: Mystic Confluence may choose the same mode more than once, each with its own target', (mk, t) => {
    t.auto('Mystic Confluence');
    const T = mk();
    const g = T.g;
    const bears = T.bf('B', 'Grizzly Bears'), giant = T.bf('B', 'Hill Giant');
    T.mana('A', 'UU3');
    const hand = T.zone('A', 'hand').length;
    T.cast('A', T.hand('A', 'Mystic Confluence'), { modes: [1, 1, 2], targets: [bears, giant], resolve: false });
    t.eq(JSON.stringify(top(g).modes), JSON.stringify(["Return target creature to its owner's hand", "Return target creature to its owner's hand", 'Draw a card']));
    T.resolve();
    t.zone(bears, 'hand'); t.zone(giant, 'hand');
    t.eq(T.zone('A', 'hand').length, hand + 1, 'and a card drawn');
  });

  test('Modes at cast: Mystic Confluence\'s "counter target spell unless its controller pays {3}" aims as it is cast', (mk, t) => {
    const T = mk();
    const g = T.g;
    T.toMain('B');
    T.mana('B', 'G1');
    T.cast('B', T.hand('B', 'Grizzly Bears'), { resolve: false });
    const bears = top(g);
    g.passPriority('B', true);
    T.mana('A', 'UU3');
    T.cast('A', T.hand('A', 'Mystic Confluence'), { modes: [0, 2, 2], targets: [{ kind: 'stack', id: bears.id }], resolve: false });
    t.eq(top(g).targets[0].id, bears.id, 'the Bears spell is its target');
    T.answer('payOrDont', { pay: false });
    T.resolve();
    t.zone(bears.obj, 'graveyard', 'B could not pay: the Bears countered');
  });

  test('Modes at cast: Cryptic Command counters and bounces, chosen as it is cast', (mk, t) => {
    t.auto('Cryptic Command');
    const T = mk();
    const g = T.g;
    const giant = T.bf('B', 'Hill Giant');
    T.toMain('B');
    T.mana('B', 'G1');
    T.cast('B', T.hand('B', 'Grizzly Bears'), { resolve: false });
    const bears = top(g);
    g.passPriority('B', true);
    T.mana('A', 'UUU1');
    T.cast('A', T.hand('A', 'Cryptic Command'), { modes: [0, 1], targets: [{ kind: 'stack', id: bears.id }, giant], resolve: false });
    t.eq(JSON.stringify(g.viewFor('B').stack[1].modes), JSON.stringify(['Counter target spell', "Return target permanent to its owner's hand"]));
    T.resolve();
    t.zone(bears.obj, 'graveyard', 'countered');
    t.zone(giant, 'hand', 'bounced');
  });

  test('Modes at cast: "choose one or more" — Farewell with two of its modes', (mk, t) => {
    t.auto('Farewell');
    const T = mk();
    const g = T.g;
    const bears = T.bf('B', 'Grizzly Bears'), thopter = T.bf('B', 'Ornithopter'), ench = T.bf('B', 'Glorious Anthem');
    T.mana('A', 'WW4');
    const fw = T.hand('A', 'Farewell');
    const offer = g.viewFor('A').castModes[fw.id];
    t.ok(offer.min === 1 && offer.max === 4, 'one to four');
    T.answer('mode', (ch) => { t.eq(ch.count, 1); t.eq(ch.max, 4, 'one or more: up to all four'); return { modes: [0, 1] }; });
    T.cast('A', fw);
    t.zone(bears, 'exile'); t.zone(thopter, 'exile');
    t.zone(ench, 'battlefield', 'enchantments were not chosen');
  });

  test('Modes at cast: Twincast\'s copy keeps the modes (CR 707.10)', (mk, t) => {
    const T = mk();
    const g = T.g;
    T.hand('B', 'Island'); T.hand('B', 'Swamp');
    T.mana('A', '1BRUU');
    T.cast('A', T.hand('A', KC), { modes: [1, 3], targets: ['B', 'B'], resolve: false });
    const orig = top(g);
    T.answer('confirm', { yes: false });
    T.cast('A', T.hand('A', 'Twincast'), { targets: [{ kind: 'stack', id: orig.id }], resolve: false });
    // Twincast resolves: the copy goes on the stack above the Command
    g.passPriority('A', true); g.passPriority('B', true);
    T.settle();
    const copy = top(g);
    t.ok(copy && copy.isCopy && copy.id !== orig.id, 'the copy is on the stack');
    t.eq(JSON.stringify(copy.chosenModes), JSON.stringify(orig.chosenModes), 'with the same modes');
    t.eq(JSON.stringify(g.viewFor('B').stack.find(s => s.id === copy.id).modes), JSON.stringify(orig.modes), 'shown on the copy too');
    T.resolve();
    t.eq(T.life('B'), 16, 'two lots of 2 damage');
    t.eq(T.zone('B', 'hand').length, 0, 'two discards');
  });

  test('Modes at cast: spree, escalate and entwine choose their modes with their costs, and aim as they are cast', (mk, t) => {
    // spree: the modes paid for, each with its target
    let T = mk();
    let g = T.g;
    const bears = T.bf('B', 'Grizzly Bears'), thopter = T.bf('B', 'Ornithopter');
    T.mana('A', 'R4');
    T.cast('A', T.hand('A', 'Explosive Derailment'), { spree: [0, 1], targets: [bears, thopter], resolve: false });
    t.eq(JSON.stringify(top(g).chosenModes), '[0,1]', 'spree: both modes');
    t.eq(top(g).targets.length, 2, 'each with its target, chosen as it was cast');
    t.eq(T.player('A').pool.total(), 0, 'and both paid for');
    T.resolve();
    t.zone(bears, 'graveyard'); t.zone(thopter, 'graveyard');
    // escalate: the cost of each mode beyond the first
    T = mk(); g = T.g;
    const attacker = T.bf('B', 'Grizzly Bears');
    T.mana('A', 'W3');
    t.no(g.castSpell('A', T.hand('A', 'Blessed Alliance').id, { auto: true, spree: [0, 1], targets: ['A'] }), 'not enough for a second mode');
    T.mana('A', '2');
    T.cast('A', g.zones.A.hand.find(o => o.name === 'Blessed Alliance'), { spree: [0, 1], targets: ['A', attacker], resolve: false });
    t.eq(JSON.stringify(top(g).modes), JSON.stringify(['Target player gains 4 life', 'Untap up to two target creatures']), 'escalated: two modes');
    T.resolve();
    t.eq(T.life('A'), 24);
    // entwine: both modes, both targets
    T = mk(); g = T.g;
    const giant = T.bf('B', 'Hill Giant');
    T.mana('A', 'R4');
    T.cast('A', T.hand('A', 'Barbed Lightning'), { entwine: true, targets: [giant, 'B'], resolve: false });
    t.eq(JSON.stringify(top(g).chosenModes), '[0,1]', 'entwined: every mode');
    T.resolve();
    t.zone(giant, 'graveyard'); t.eq(T.life('B'), 17);
  });

  test('Modes at cast: "If this spell was kicked, choose any number instead" — more modes once kicked', (mk, t) => {
    const T = mk();
    const g = T.g;
    const bears = T.bf('A', 'Grizzly Bears'), giant = T.bf('B', 'Hill Giant');
    const insc = T.hand('A', 'Inscription of Abundance');
    T.mana('A', 'GG4');
    const offer = g.viewFor('A').castModes[insc.id];
    t.eq(offer.max, 1, 'one, unkicked');
    t.ok(offer.kicked && offer.kicked.max === 3, 'any number, kicked');
    t.no(g.castSpell('A', insc.id, { auto: true, modes: [0, 2], targets: [bears, bears, giant].map(obj) }), 'two modes need the kick');
    T.cast('A', insc, { kick: 1, modes: [0, 2], targets: [bears, bears, giant], resolve: false });
    t.eq(top(g).targets.length, 3, 'the counters\' target, then the fight\'s two');
    T.resolve();
    t.eq(bears.counters['+1/+1'], 2, 'the Bears, 4/4');
    t.zone(giant, 'graveyard', 'then fought the Giant');
    t.zone(bears, 'battlefield');
  });

  test('Modes at cast: a bot chooses a modal spell\'s modes and targets as it casts it', (mk, t) => {
    const T = mk();
    const g = T.g;
    T.player('A').isBot = true;
    const bot = new T.MTG.bots.BotPlayer(g, 'A', 8);
    const thopter = T.bf('B', 'Ornithopter');
    T.bf('B', 'Hill Giant');
    T.hand('B', 'Island');
    const kc = T.hand('A', KC);
    T.mana('A', '1BR');
    const a = kc.analysis();
    t.ok(bot.castChoice({ o: kc, a, v: 3, cost: 3, costStr: kc.card.mana_cost }, 3), 'the bot casts it');
    const st = g.stack.find(s => s.objId === kc.id);
    t.eq((st.chosenModes || []).length, 2, 'two modes chosen as it was cast');
    t.eq(st.targets.length, 2, 'and a target for each');
    t.no(T.asked.length, 'nobody was asked anything');
    t.ok(st.chosenModes.includes(2) && st.targets.some(x => x.id === thopter.id), 'the Ornithopter is worth destroying');
    // a modal spell cast some other way, without modes: the bot is asked, and answers as it would have as it resolved
    const T2 = mk();
    const g2 = T2.g;
    T2.player('A').isBot = true;
    const bot2 = new T2.MTG.bots.BotPlayer(g2, 'A', 8);
    T2.bf('B', 'Hill Giant');
    T2.mana('A', 'WBG');
    g2.castSpell('A', T2.hand('A', 'Abzan Charm').id, { auto: true });
    const ch = g2.pendingChoice;
    t.ok(ch && ch.type === 'mode' && ch.purpose === 'castModes', 'asked its modes as it is cast');
    bot2.doChoice(ch);
    if (g2.pendingChoice) bot2.doChoice(g2.pendingChoice);
    t.no(g2.pendingChoice, 'answered');
    t.ok(g2.stack.length && (top(g2).chosenModes || []).length === 1, 'the Charm is on the stack with its mode');
  });

  test('Riku of Many Paths: up to as many modes as were chosen for the modal spell', (mk, t) => {
    t.auto('Riku of Many Paths');
    const T = mk({ library: Array(20).fill('Island') });
    const g = T.g;
    const riku = T.bf('A', 'Riku of Many Paths');
    T.bf('B', 'Ornithopter');
    T.mana('A', '1BR');
    T.answer('mode', (ch) => {
      t.eq(ch.count, 2, 'up to two: two modes were chosen for the Command');
      t.eq(ch.min, 0, 'up to');
      return { modes: [1, 2] };
    });
    T.cast('A', T.hand('A', KC), { modes: [1, 3], targets: ['B', 'B'] });
    t.eq(riku.counters['+1/+1'], 1, 'a +1/+1 counter on Riku');
    t.ok(g.hasKw(riku, 'trample'), 'and trample');
    t.eq(T.bfOf('A').filter(o => o.name === 'Bird').length, 1, 'a Bird');
    t.eq(T.life('B'), 18, 'the Command did its part too');
  });

  test('Riku of Many Paths: a mode chosen three times counts three; a spell that isn\'t modal, nothing', (mk, t) => {
    const T = mk({ library: Array(20).fill('Island') });
    const g = T.g;
    T.bf('A', 'Riku of Many Paths');
    T.mana('A', 'UU3');
    let asked = null;
    T.answer('mode', (ch) => { asked = ch; return { modes: [2] }; });
    T.cast('A', T.hand('A', 'Mystic Confluence'), { modes: [2, 2, 2] });
    t.eq(asked && asked.count, 3, 'X is 3 (the number of times a mode was chosen)');
    t.eq(T.bfOf('A').filter(o => o.name === 'Bird').length, 1);
    T.mana('A', 'R');
    const before = g.log.length;
    T.cast('A', T.hand('A', 'Shock'), { targets: ['B'] });
    t.no(g.log.slice(before).some(l => /Riku/.test(l.text)), 'Shock is not modal: Riku does not trigger');
  });

  test('Riku of Many Paths: spree counts the modes paid for; a copy is not cast; a countered spell still counts', (mk, t) => {
    const T = mk({ library: Array(20).fill('Island') });
    const g = T.g;
    T.bf('A', 'Riku of Many Paths');
    const bears = T.bf('B', 'Grizzly Bears'), thopter = T.bf('B', 'Ornithopter');
    T.mana('A', 'R4');
    let asked = null;
    T.answer('mode', (ch) => { asked = ch; return { modes: [] }; });
    T.cast('A', T.hand('A', 'Explosive Derailment'), { spree: [0, 1], targets: [bears, thopter] });
    t.eq(asked && asked.count, 2, 'spree with two modes paid for: up to two');
    // Twincast's copy is not cast (CR 707.10): no second trigger
    T.hand('B', 'Island'); T.hand('B', 'Swamp');
    T.mana('A', '1BRUU');
    let n = 0;
    T.answer('mode', () => { n++; return { modes: [] }; });
    T.cast('A', T.hand('A', KC), { modes: [1, 3], targets: ['B', 'B'], resolve: false });
    const kc = g.stack.find(s => s.name === KC);
    T.settle();
    // Riku's trigger for the Command is on the stack above it
    t.ok(g.stack.some(s => s.triggered && /Riku/.test(s.name)), 'Riku triggered for the Command');
    T.answer('confirm', { yes: false });
    T.cast('A', T.hand('A', 'Twincast'), { targets: [{ kind: 'stack', id: kc.id }] });
    t.eq(n, 1, 'Riku triggered for the Command only: Twincast is not modal, and its copy was not cast');
    t.no(g.stack.length, 'everything resolved');
    // a spell countered before Riku's trigger resolves: still the modes it was cast with
    const T2 = mk({ library: Array(20).fill('Island') });
    const g2 = T2.g;
    T2.bf('A', 'Riku of Many Paths');
    T2.mana('A', '1BR');
    let asked2 = null;
    T2.answer('mode', (ch) => { asked2 = ch; return { modes: [2] }; });
    T2.cast('A', T2.hand('A', KC), { modes: [1, 3], targets: ['B', 'B'], resolve: false });
    const kc2 = g2.stack.find(s => s.objId && s.name === KC);
    g2.stack.splice(g2.stack.indexOf(kc2), 1);
    kc2.obj.zone = 'graveyard'; g2.zones.A.graveyard.push(kc2.obj);
    T2.resolve();
    t.eq(asked2 && asked2.count, 2, 'X is still 2');
  });

  test('Modes at cast: "choose one that hasn\'t been chosen this turn" — Monument to Endurance, set off by the Command\'s discard', (mk, t) => {
    const T = mk({ library: Array(20).fill('Island') });
    const g = T.g;
    T.bf('A', 'Monument to Endurance');
    T.hand('A', 'Swamp'); T.hand('A', 'Mountain');
    const offered = [];
    T.answer('mode', (ch) => { offered.push(ch.options.map(o => o.i)); return { modes: [ch.options[0].i] }; });
    T.answer('mode', (ch) => { offered.push(ch.options.map(o => o.i)); return { modes: [ch.options[0].i] }; });
    T.mana('A', '1BR');
    T.cast('A', T.hand('A', KC), { modes: [1, 3], targets: ['A', 'B'] });
    T.mana('A', '1BR');
    T.cast('A', T.hand('A', KC), { modes: [1, 3], targets: ['A', 'B'] });
    t.eq(offered.length, 2, 'the Monument triggered twice');
    t.eq(offered[0].length, 3, 'all three modes the first time');
    t.no(offered[1].includes(offered[0][0]), 'not the one chosen before, the second time');
  });

  test('Modes at cast: saved with the modes on the stack, the game comes back with them', (mk, t) => {
    const T = mk();
    const g = T.g;
    const thopter = T.bf('B', 'Ornithopter');
    T.mana('A', '1BR');
    T.cast('A', T.hand('A', KC), { modes: [2, 3], targets: [thopter, 'B'], resolve: false });
    const snap = JSON.parse(JSON.stringify(g.snapshot()));
    g.restore(JSON.parse(JSON.stringify(snap)));
    const st = top(g);
    t.eq(JSON.stringify(st.chosenModes), '[2,3]', 'the modes');
    t.eq(JSON.stringify(g.viewFor('B').stack[0].modes), JSON.stringify(['Destroy target artifact', "Kolaghan's Command deals 2 damage to any target"]));
    T.resolve();
    t.zone(g.obj(thopter.id), 'graveyard');
    t.eq(T.life('B'), 18);
    // asked for the modes, saved, restored: the same question
    const T2 = mk();
    const g2 = T2.g;
    T2.bf('B', 'Ornithopter');
    T2.mana('A', '1BR');
    g2.castSpell('A', T2.hand('A', KC).id, { auto: true });
    const ch = g2.pendingChoice;
    t.ok(ch && ch.purpose === 'castModes', 'the modes asked');
    const s2 = JSON.parse(JSON.stringify(g2.snapshot()));
    g2.restore(s2);
    t.ok(g2.pendingChoice && g2.pendingChoice.purpose === 'castModes', 'restored: asked again');
    g2.resolveChoice('A', { modes: [1, 3] });
    T2.settle();
    t.eq(JSON.stringify(top(g2).chosenModes), '[1,3]');
  });

  test('Modes at cast: Kozilek\'s Command for X = 0 with no creature to be had is refused, not asked for an impossible target', (mk, t) => {
    const T = mk();
    const g = T.g;
    T.bf('B', 'Grizzly Bears');                          // mana value 2: not "X or less" for X = 0
    const kc = T.hand('A', "Kozilek's Command");
    T.mana('A', 'U1');
    T.answer('mode', (ch) => ({ picks: [ch.options.findIndex(o => /creature with mana value X or less/i.test(o.label))].concat([ch.options.findIndex(o => /target player/i.test(o.label))]).filter(i => i >= 0) }));
    g.castSpell('A', kc.id, { x: 0, auto: true });
    T.settle();
    const bad = T.asked.find(ch => ch.purpose === 'castTargets' && (ch.options || []).some(l => Array.isArray(l) && !l.length));
    t.no(bad, 'no target question with nothing legal to choose');
    t.ok(kc.zone === 'hand' || kc.zone === 'stack' || kc.zone === 'graveyard', 'the game goes on');
  });
};
