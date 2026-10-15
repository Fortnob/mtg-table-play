/* "Choose a card name" (CR 201.3): any card's name may be chosen, but the names offered come only from what
   the chooser can see or knows of — public zones, cards revealed to them or they looked at, their own cards
   wherever they are — never from an opponent's hidden hand or library, which the list (or its order) would
   give away. Any other name is typed in (the question's nameAny, the answer's `name`); what the card must be
   ("nonland") is checked when the card is known, and whatever reads the chosen name works with a typed one. */
'use strict';
const contracts = require('../contracts');
module.exports = (test) => {
  const labels = (ch) => (ch.options || []).map(o => o.label);
  const at = (ch, nm) => labels(ch).indexOf(nm);

  test('Naming: Cabal Therapy offers what A can see and A\'s own cards, never B\'s hidden hand or library', (mk, t) => {
    t.auto('Cabal Therapy');
    const T = mk();
    const g = T.g;
    T.hand('B', 'Lightning Bolt');         // hidden from A
    T.top('B', 'Counterspell');            // hidden from A
    T.grave('B', 'Opt');                   // public
    T.bf('B', 'Grizzly Bears');            // public
    T.bf('B', 'Forest');                   // public, but a land
    T.hand('A', 'Shock');                  // A's own
    T.top('A', 'Giant Growth');            // A's own library
    let asked = null;
    T.answer('choose', (ch) => { asked = ch; return { picks: [at(ch, 'Opt')] }; });
    T.mana('A', 'B');
    T.cast('A', T.hand('A', 'Cabal Therapy'), { targets: ['B'] });
    t.ok(asked && asked.purpose === 'chooseCardName', 'A is asked for a card name');
    t.ok(asked.nameAny && asked.nameAny.nonland === true, 'any nonland card name may be typed in as well');
    for (const nm of ['Opt', 'Grizzly Bears', 'Shock', 'Giant Growth']) t.ok(at(asked, nm) >= 0, nm + ' is offered');
    for (const nm of ['Lightning Bolt', 'Counterspell']) t.eq(at(asked, nm), -1, nm + ' (hidden from A) is not offered');
    t.eq(at(asked, 'Forest'), -1, 'a land is not offered for a nonland name');
    t.ok(at(asked, 'Opt') < at(asked, 'Shock') && at(asked, 'Grizzly Bears') < at(asked, 'Shock'), "B's cards come before A's own");
    t.ok(g.log.some(l => /A names Opt\./.test(l.text)), 'the log says the name');
  });

  test('Naming: a name typed in that is not on offer — Cabal Therapy names a card hidden in B\'s hand and takes every copy', (mk, t) => {
    const T = mk();
    const g = T.g;
    const b1 = T.hand('B', 'Lightning Bolt'), b2 = T.hand('B', 'Lightning Bolt'), opt = T.hand('B', 'Opt');
    let refused = null;
    T.answer('choose', (ch, gg) => {
      t.eq(at(ch, 'Lightning Bolt'), -1, 'the Bolt is not offered');
      // (a land, for a nonland name: refused, saying why, and the question stays)
      refused = gg.resolveChoice('A', { name: 'Forest' }) ? null : gg.lastError;
      return { name: '  lightning   bolt ' };
    });
    T.mana('A', 'B');
    T.cast('A', T.hand('A', 'Cabal Therapy'), { targets: ['B'] });
    t.ok(/Forest is a land card/.test(refused || ''), 'naming a land is refused: ' + refused);
    t.zone(b1, 'graveyard', 'the first Bolt'); t.zone(b2, 'graveyard', 'the second Bolt');
    t.zone(opt, 'hand', 'Opt kept');
    t.ok(g.log.some(l => /A names Lightning Bolt\./.test(l.text)), 'the typed name, as the card is called');
  });

  test('Naming: a card revealed to the chooser, or one they looked at, is offered first; an unknown name typed in is taken as it is', (mk, t) => {
    const T = mk({ players: ['A', 'B', 'C'] });
    const g = T.g;
    const bolt = T.hand('B', 'Lightning Bolt');
    const growth = T.hand('B', 'Giant Growth');
    const doom = T.hand('B', 'Doom Blade');
    T.grave('B', 'Opt');
    g._know(bolt, '*');                    // revealed to everybody
    g._know(growth, 'A');                  // A looked at it
    g._know(doom, 'C');                    // only C knows this one
    let asked = null;
    T.answer('choose', (ch) => { asked = ch; return { name: 'Totally Made-Up Card' }; });
    T.mana('A', 'B');
    T.cast('A', T.hand('A', 'Cabal Therapy'), { targets: ['B'] });
    t.ok(at(asked, 'Lightning Bolt') >= 0 && at(asked, 'Giant Growth') >= 0, 'what A was shown is offered');
    t.eq(at(asked, 'Doom Blade'), -1, 'what only C saw is not');
    t.ok(at(asked, 'Lightning Bolt') < at(asked, 'Opt') && at(asked, 'Giant Growth') < at(asked, 'Opt'), 'a card known in that hand comes first');
    t.eq(contracts.checkChoice(asked, g).filter(v => v.rule === 'choice.privacy').length, 0, 'the privacy contract is kept');
    t.ok(g.log.some(l => /A names Totally Made-Up Card\./.test(l.text)), 'a name nobody knows is taken as typed');
    t.eq(T.zone('B', 'hand').length, 3, 'and nothing is discarded');
  });

  test('Naming: Pithing Needle names a card not yet seen; when it arrives its abilities are stopped', (mk, t) => {
    t.auto('Pithing Needle');
    const T = mk();
    const g = T.g;
    T.hand('B', 'Shivan Dragon');           // hidden from A
    T.bf('B', 'Grizzly Bears');
    let asked = null;
    T.answer('mode', (ch) => { asked = ch; return { name: 'shivan dragon' }; });
    const pn = T.put('A', 'Pithing Needle', 'battlefield', { etb: true });
    t.ok(asked && asked.purpose === 'chooseValue' && asked.nameAny, 'A is asked for a name, and may type one in');
    t.eq(at(asked, 'Shivan Dragon'), -1, "B's hidden Dragon is not offered");
    t.ok(at(asked, 'Grizzly Bears') === 0, "B's permanent is offered first");
    t.eq(pn.chosenName, 'Shivan Dragon', 'the typed name, as the card is called');
    const sh = T.bf('B', 'Shivan Dragon');
    T.mana('B', 'R');
    t.no(g.activateAbility('B', sh.id, sh.analysis().manaAbilities.length, {}), 'firebreathing stopped');
    t.ok(/can't be activated/.test(g.lastError || ''), g.lastError);
  });

  test('Naming: Pithing Needle with nothing in sight still asks, and a name the card library does not know is kept as typed', (mk, t) => {
    const T = mk();
    let asked = null;
    T.answer('mode', (ch) => { asked = ch; return { name: 'Some Unprinted Thing' }; });
    const pn = T.put('A', 'Pithing Needle', 'battlefield', { etb: true });
    t.ok(asked && asked.nameAny, 'asked');
    t.ok(labels(asked).every(nm => nm === 'Pithing Needle' || ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'].includes(nm)), 'only what A can see or owns: ' + labels(asked).join(', '));
    t.eq(pn.chosenName, 'Some Unprinted Thing', 'the name as typed');
  });

  test('Naming: Demonic Consultation takes a typed name; a name that never comes takes the whole library', (mk, t) => {
    const T = mk({ library: Array(20).fill('Island') });
    T.answer('choose', (ch) => ({ name: 'Black Lotus' }));
    T.mana('A', 'B');
    T.cast('A', T.hand('A', 'Demonic Consultation'));
    t.eq(T.zone('A', 'library').length, 0, 'the library is gone');
    t.ok(T.g.log.some(l => /A names Black Lotus; it never comes/.test(l.text)), 'the log says so');
  });

  test('Naming: Isperia names a typed card and finds it in the hand it reveals', (mk, t) => {
    t.auto('Isperia the Inscrutable');
    const T = mk({ library: Array(30).fill('Island') });
    const isp = T.bf('A', 'Isperia the Inscrutable');
    const drake = T.top('A', 'Wind Drake');
    T.hand('B', 'Lightning Bolt');
    T.answer('choose', (ch) => { t.eq(at(ch, 'Lightning Bolt'), -1, 'the hidden Bolt is not offered'); return { name: 'Lightning Bolt' }; });
    T.answer('declareAttackers', () => [{ attackerId: isp.id, defenderId: 'B' }]);
    T.answer('declareBlockers', () => []);
    T.toMain('A', 'endCombat');
    t.zone(drake, 'hand', 'a Bolt revealed: the flier found');
  });

  test('Naming: a bot names only what it can know of — an opponent\'s permanent, a card it saw, never its own', (mk, t) => {
    const T = mk();
    const g = T.g;
    g.player('A').isBot = true;
    T.hand('B', 'Lightning Bolt');          // hidden from the bot
    T.bf('B', 'Prodigal Pyromancer');
    const pn = T.put('A', 'Pithing Needle', 'battlefield', { etb: true });
    t.eq(pn.chosenName, 'Prodigal Pyromancer', 'the Needle names what the opponent has out');
    t.no(T.asked.some(ch => ch.purpose === 'chooseValue'), 'nobody is asked');
    // only its own cards in sight: nothing named, rather than one of its own
    const T2 = mk();
    T2.g.player('A').isBot = true;
    T2.hand('B', 'Lightning Bolt');
    const pn2 = T2.put('A', 'Pithing Needle', 'battlefield', { etb: true });
    t.no(pn2.chosenName, 'nothing of the opponent\'s in sight: no name');
    // Cabal Therapy: a card it saw in the hand first, then what is public
    const T3 = mk();
    T3.g.player('A').isBot = true;
    const bolt = T3.hand('B', 'Lightning Bolt');
    T3.hand('B', 'Doom Blade');
    T3.grave('B', 'Opt');
    T3.g._know(bolt, 'A');
    T3.mana('A', 'B');
    T3.cast('A', T3.hand('A', 'Cabal Therapy'), { targets: ['B'] });
    t.zone(bolt, 'graveyard', 'the Bolt it had seen is named');
    t.eq(T3.zone('B', 'hand').map(o => o.name).join(), 'Doom Blade', 'the card it never saw stays');
  });

  test('Naming: Sorcerous Spyglass looks at the hand, and then what it saw is offered', (mk, t) => {
    t.auto('Sorcerous Spyglass');
    const T = mk();
    const bolt = T.hand('B', 'Lightning Bolt');
    let asked = null;
    T.answer('mode', (ch) => { asked = ch; return { modes: [at(ch, 'Lightning Bolt')] }; });
    const sg = T.put('A', 'Sorcerous Spyglass', 'battlefield', { etb: true });
    t.ok((bolt.knownTo || []).includes('A'), 'A has seen the hand');
    t.ok(at(asked, 'Lightning Bolt') >= 0, 'the Bolt it saw is offered');
    t.eq(sg.chosenName, 'Lightning Bolt');
  });

  test('Naming: the contract catches a name question that offers a card hidden from its player', (mk, t) => {
    const T = mk();
    const g = T.g;
    T.hand('B', 'Lightning Bolt');
    T.bf('B', 'Grizzly Bears');
    const ask = (label) => ({ type: 'choose', playerId: 'A', kind: 'options', purpose: 'chooseCardName', prompt: 'Name a card: choose a card name.',
      options: [{ label, i: 0 }], min: 1, max: 1, nameAny: { nonland: true } });
    const leak = contracts.checkChoice(ask('Lightning Bolt'), g).filter(v => v.rule === 'choice.privacy');
    t.eq(leak.length, 1, 'the hidden Bolt is caught');
    t.eq(contracts.checkChoice(ask('Grizzly Bears'), g).filter(v => v.rule === 'choice.privacy').length, 0, 'a permanent in play is fine');
    t.eq(contracts.checkAnswer(ask('Grizzly Bears'), { name: 'Lightning Bolt' }, g).length, 0, 'a typed answer is a good answer');
    t.ok(contracts.checkAnswer(ask('Grizzly Bears'), { name: 'Forest' }, g).some(v => /land card/.test(v.msg)), 'a land typed for a nonland name is not');
  });

  test('Naming: a suggested number is worked out from what the chooser can see, not the opponents\' libraries', (mk, t) => {
    t.auto('Talion, the Kindly Lord');
    const T = mk();
    for (let i = 0; i < 20; i++) T.top('B', 'Hill Giant');   // mana value 4, hidden
    T.bf('B', 'Grizzly Bears'); T.bf('B', 'Runeclaw Bear');  // mana value 2, in sight
    T.bf('A', 'Talion, the Kindly Lord', { etb: true });
    const q = T.asked.find(ch => ch.purpose === 'chooseValue');
    t.ok(q, 'asked for a number');
    t.eq(q && q.values[0], 2, 'the likeliest is the mana value on the table, not the one hidden in the library');
  });
};
