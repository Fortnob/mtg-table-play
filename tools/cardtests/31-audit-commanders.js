/* What an audit of the cards automated for Commander found: merge seams that
   left a reading unreachable, and words the engine counted as done but did
   not do. Each test plays the card against what it says. */
'use strict';
module.exports = (test) => {
  /* Pass priority until something is on the stack whose name says it is this card's. */
  const untilOnStack = (T, re) => {
    const g = T.g;
    for (let i = 0; i < 200 && !g.stack.some(s => re.test(s.name || '')); i++) {
      T.settle();
      if (g.stack.some(s => re.test(s.name || ''))) break;
      const p = g.priorityPlayer;
      if (!p) break;
      g.passPriority(p.id, true);
    }
    return g.stack.find(s => re.test(s.name || ''));
  };

  test('Audit: Silent Skimmer — the defending player loses 2 life even once it has left combat', (mk, t) => {
    t.auto('Silent Skimmer');
    const T = mk({ players: ['A', 'B', 'C'], library: Array(20).fill('Plains') });
    T.toMain('A');
    const sk = T.bf('A', 'Silent Skimmer'); sk.summoningSick = false;
    T.answer('declareAttackers', () => [{ attackerId: sk.id, defenderId: 'C' }]);
    t.ok(untilOnStack(T, /Silent Skimmer/), 'its attack trigger is on the stack');
    T.g.moveObject(sk, 'hand');
    T.resolve();
    t.eq(T.life('C'), 18, 'C, the player it attacked, loses 2');
    t.eq(T.life('B'), 20, 'B loses nothing');
  });

  test('Audit: a bot pays Mogis with a creature once its life is short (its answer had been overwritten)', (mk, t) => {
    t.auto('Mogis, God of Slaughter');
    const run = (life) => {
      const T = mk();
      const mo = T.bf('A', 'Mogis, God of Slaughter');
      const bears = T.bf('B', 'Grizzly Bears');
      T.player('B').life = life; T.player('B').isBot = true;
      const bot = new T.MTG.bots.BotPlayer(T.g, 'B', 8);
      T.g._runEffects(mo.analysis().abilities.find(a => a.kind === 'triggered').effects,
        { controller: 'A', obj: mo, name: 'Mogis', kind: 'ability', triggerData: { player: 'B', playerId: 'B' } });
      const ch = T.g.pendingChoice;
      t.ok(ch && ch.playerId === 'B', 'B is asked');
      bot.doChoice(ch);
      T.settle();
      return { T, bears };
    };
    const low = run(6);
    t.zone(low.bears, 'graveyard', 'at 6 life the bot sacrifices the Bears');
    t.eq(low.T.life('B'), 6, 'and takes no damage');
    const high = run(20);
    t.zone(high.bears, 'battlefield', 'at 20 life it keeps the Bears');
    t.eq(high.T.life('B'), 18, 'and takes 2');
  });

  test('Audit: a bot copies Chain of Smog back only while the other hand has cards to lose', (mk, t) => {
    t.auto('Chain of Smog');
    const run = (cardsInA) => {
      const T = mk();
      T.toMain('A');
      T.player('B').isBot = true;
      const bot = new T.MTG.bots.BotPlayer(T.g, 'B', 8);
      for (let i = 0; i < cardsInA; i++) T.hand('A', 'Island');
      T.mana('A', '1B');
      T.g.castSpell('A', T.hand('A', 'Chain of Smog').id, { auto: true, targets: [{ kind: 'player', id: 'B' }] });
      let ch = null;
      for (let i = 0; i < 20 && !(ch = T.g.pendingChoice && T.g.pendingChoice.purpose === 'chainCopy' ? T.g.pendingChoice : null); i++) {
        if (T.g.pendingChoice) T.settle(); else if (T.g.priorityPlayer) T.g.passPriority(T.g.priorityPlayer.id, true); else break;
      }
      t.ok(ch && ch.playerId === 'B', 'B is offered the copy');
      return bot.confirmChoice(ch);
    };
    t.no(run(0), "A's hand is empty: no copy (two bots would copy it at each other for ever)");
    t.ok(run(2), 'A has cards: copy it back');
  });

  /* ---- undo and saved games: the snapshot listed its fields one by one, and everything else was lost ---- */

  test('Audit: undo keeps what was chosen as a permanent entered (Morophon\'s creature type)', (mk, t) => {
    const T = mk({ library: Array(20).fill('Forest') });
    T.toMain('A');
    T.answer('mode', (ch) => ({ modes: [ch.types.indexOf('Elf')] }));
    const mo = T.put('A', 'Morophon, the Boundless', 'battlefield', { etb: true });
    t.eq(mo.chosenType, 'Elf');
    T.g.pushUndo('a land', 'A');
    T.playLand('A', T.hand('A', 'Forest'));
    t.ok(T.g.undo('A'), 'undone');
    const mo2 = T.g.obj(mo.id);
    t.eq(mo2.chosenType, 'Elf', 'still an Elf after the undo');
    t.eq(T.g.castCost(T.hand('A', 'Llanowar Elves')), '', 'and Elves still cost less');
  });

  test('Audit: a saved game keeps what this turn has seen (spells cast, a creature died, once-each-turn)', (mk, t) => {
    const T = mk({ library: Array(20).fill('Island') });
    T.toMain('A');
    T.bf('A', 'Mikey & Leo, Chaos & Order');
    const bear = T.bf('A', 'Grizzly Bears');
    T.mana('A', 'R');
    T.cast('A', T.hand('A', 'Lightning Bolt'), { targets: [T.bf('B', 'Grizzly Bears')] });
    T.g.addCounters(bear, '+1/+1', 1, { by: 'A' }); T.resolve();
    const hand = T.zone('A', 'hand').length;
    const snap = JSON.parse(JSON.stringify(T.g.snapshot()));
    const g2 = new T.MTG.rules.Game(snap.config);
    t.ok(g2.restore(snap), 'restored');
    t.eq(g2.player('A').spellsCastThisTurn, 1, 'one spell cast this turn');
    t.eq((g2.player('A').spellObjsThisTurn || []).map(o => o.name).join(), 'Lightning Bolt', 'and which');
    t.eq((g2.turnHistory || {}).creaturesDied, 1, 'a creature died this turn');
    // Mikey & Leo: "This ability triggers only once each turn" — already used
    g2.addCounters(g2.obj(bear.id), '+1/+1', 1, { by: 'A' });
    for (let i = 0; i < 20 && (g2.stack.length || g2.pendingTriggers.length); i++) g2.passPriority(g2.priorityPlayer.id, true);
    t.eq(g2.zones.A.hand.length, hand, 'Mikey & Leo does not draw a second time this turn');
  });

  test('Audit: day turning to night between turns does not throw at whoever is listening', (mk, t) => {
    const T = mk({ library: Array(20).fill('Forest') });
    T.nextTurn('B');
    T.g.setDayNight(true, 'test');
    const errs = [];
    T.g.on('state', () => { try { void T.g.step; void T.g.phase.id; } catch (e) { errs.push(e.message); } });
    T.nextTurn('A');
    t.eq(T.g.isDay, false, 'no spells cast: it became night');
    t.eq(errs.join(' / '), '', 'the step and phase could be read throughout');
  });

  test('Audit: Farsight Ritual puts the rest on the bottom in a random order', (mk, t) => {
    t.auto('Farsight Ritual');
    const T = mk({ library: Array(10).fill('Plains') });
    T.toMain('A');
    const a = T.MTG.oracle.analyze(require('../harness').card('Farsight Ritual'));
    const take = JSON.stringify(a.abilities).match(/"op":"takeFromLooked"[^}]*/);
    t.ok(take && /"rest":"bottomRandom"/.test(take[0]), 'read as random: ' + (take && take[0]));
    const top = ['Island', 'Swamp', 'Mountain', 'Forest'].map(n => T.top('A', n)).reverse();
    T.answer('choose', (ch) => ({ picks: ch.items ? ch.items.slice(0, 2).map(x => x.id) : [] }));
    T.mana('A', '2UU');
    T.cast('A', T.hand('A', 'Farsight Ritual'));
    t.eq(top.filter(o => o.zone === 'hand').length, 2, 'two into the hand');
    const lib = T.zone('A', 'library');
    t.eq(lib.slice(-2).filter(o => top.includes(o)).length, 2, 'the other two at the bottom');
    // the same words in the older readings ("Look at the top N cards … the rest on the bottom … in a random order")
    const rest = (txt) => (JSON.stringify(T.MTG.oracle.parseEffects(txt)).match(/"rest":"(\w+)"/) || [])[1];
    t.eq(rest('Look at the top four cards of your library. Put two of them into your hand and the rest on the bottom of your library in a random order.'), 'bottomRandom');
    t.eq(rest('Look at the top three cards of your library. Put one of them into your hand and the rest on the bottom of your library in a random order.'), 'bottomRandom');
    t.eq(rest('Look at the top three cards of your library. Put one of them into your hand and the rest on the bottom of your library in any order.'), 'bottom');
  });

  test('Audit: Prototype X-8 sacrifices the creature that entered, not itself, and conjures its duplicate', (mk, t) => {
    t.auto('Prototype X-8');
    const T = mk({ library: Array(20).fill('Forest') });
    T.toMain('A');
    const x8 = T.bf('A', 'Prototype X-8');
    const bear = T.hand('A', 'Grizzly Bears');
    T.mana('A', '1G');
    T.cast('A', bear);
    t.zone(x8, 'battlefield', 'Prototype X-8 stays');
    t.zone(bear, 'graveyard', 'the Bears that were cast are sacrificed');
    const dup = T.bfOf('A').find(o => o.name === 'Grizzly Bears');
    t.ok(dup && dup !== bear, 'a duplicate conjured onto the battlefield');
    t.ok(dup && T.g._hasCreatureType(dup, 'Robot'), 'the duplicate is a Robot');
    t.no(T.g._hasCreatureType(bear, 'Robot'), 'the sacrificed card is not');
  });

  test('Audit: a card exiled face down shows nobody else its power or keywords (Gonti, Lord of Luxury)', (mk, t) => {
    t.auto('Gonti, Lord of Luxury');
    const T = mk({ players: ['A', 'B', 'C'], library: Array(20).fill('Plains') });
    T.toMain('A');
    for (let i = 0; i < 4; i++) T.top('B', i ? 'Island' : 'Serra Angel');
    T.answer('pickCard', (ch) => ({ cardIds: ch.cards.filter(c => c.name === 'Serra Angel').map(c => c.id) }));
    T.put('A', 'Gonti, Lord of Luxury', 'battlefield', { etb: true });
    T.resolve();
    const angel = T.g.zones.B.exile.find(o => o.name === 'Serra Angel');
    t.ok(angel && angel.faceDownExile, 'the Angel is exiled face down');
    const find = (v) => [].concat(...v.players.map(p => p.exile || [])).find(o => o.id === angel.id);
    const a = find(T.g.viewFor('A'));
    t.eq(a.card.name, 'Serra Angel', 'A, who may look at it, sees it');
    for (const who of ['B', 'C', '__watching']) {
      const x = find(T.g.viewFor(who));
      t.eq(JSON.stringify([x.card.name, x.power, x.toughness, x.keywords]), '["Face-down card",null,null,[]]', who + ' sees only its back');
    }
  });

  /* ---- ward: only {N} and "Pay N life" were ever taken; any other price let the spell through free ---- */

  test('Audit: Valgavoth, Terror Eater — "Ward—Sacrifice three nonland permanents", or the spell is countered', (mk, t) => {
    t.auto('Valgavoth, Terror Eater');
    const play = (pay) => {
      const T = mk({ library: Array(20).fill('Swamp') });
      T.toMain('B');
      const val = T.bf('A', 'Valgavoth, Terror Eater');
      const mine = ['Grizzly Bears', 'Sol Ring', 'Glorious Anthem', 'Hill Giant'].map(n => T.bf('B', n));
      T.bf('B', 'Swamp');
      if (pay) T.answer('choose', (ch) => ({ picks: ch.purpose === 'wardPay' ? mine.slice(0, 3).map(o => o.id) : [] }));
      else T.answer('choose', { picks: [] });
      T.mana('B', '1BB');
      T.cast('B', T.hand('B', 'Murder'), { targets: [val] });
      t.ok(T.asked.some(c => c.purpose === 'wardPay' && c.playerId === 'B'), 'the player who targeted it is asked');
      return { T, val, mine };
    };
    const paid = play(true);
    t.zone(paid.val, 'graveyard', 'paid: Murder resolves');
    t.eq(paid.mine.filter(o => o.zone !== 'battlefield').length, 3, 'paid: three of B\'s nonland permanents sacrificed (exiled, by Valgavoth)');
    const not = play(false);
    t.zone(not.val, 'battlefield', 'not paid: Murder is countered');
    t.eq(not.mine.filter(o => o.zone === 'battlefield').length, 4, 'not paid: nothing sacrificed');
  });

  test('Audit: Westgate Regent — "Ward—Discard a card"', (mk, t) => {
    t.auto('Westgate Regent');
    const T = mk();
    T.toMain('B');
    const wr = T.bf('A', 'Westgate Regent');
    const card = T.hand('B', 'Grizzly Bears');
    T.answer('choose', (ch) => ({ picks: ch.purpose === 'wardPay' ? [card.id] : [] }));
    T.mana('B', '1BB');
    T.cast('B', T.hand('B', 'Murder'), { targets: [wr] });
    t.zone(card, 'graveyard', 'the card discarded');
    t.zone(wr, 'graveyard', 'and Murder resolves');
    // nothing to discard: countered
    const T2 = mk();
    T2.toMain('B');
    const wr2 = T2.bf('A', 'Westgate Regent');
    T2.mana('B', '1BB');
    T2.cast('B', T2.hand('B', 'Murder'), { targets: [wr2] });
    t.zone(wr2, 'battlefield', 'an empty hand cannot pay: countered');
  });

  test('Audit: Raubahn — "Pay life equal to Raubahn\'s power"; life short of it can\'t be paid', (mk, t) => {
    t.auto('Raubahn, Bull of Ala Mhigo');
    const T = mk();
    T.toMain('B');
    const r = T.bf('A', 'Raubahn, Bull of Ala Mhigo');
    const pw = T.g.powerOf(r);
    T.mana('B', '1BB');
    T.cast('B', T.hand('B', 'Murder'), { targets: [r] });
    t.eq(T.life('B'), 20 - pw, 'B paid life equal to its power');
    t.zone(r, 'graveyard');
    const T2 = mk();
    T2.toMain('B');
    const r2 = T2.bf('A', 'Raubahn, Bull of Ala Mhigo');
    T2.player('B').life = T2.g.powerOf(r2) - 1;
    T2.mana('B', '1BB');
    T2.cast('B', T2.hand('B', 'Murder'), { targets: [r2] });
    t.zone(r2, 'battlefield', 'too little life: countered');
    t.eq(T2.life('B'), T2.g.powerOf(r2) - 1, 'and no life paid');
  });

  test('Audit: Axebane Ferox — "Ward—Collect evidence 4"; The Unagi — "Ward—Waterbend {4}"', (mk, t) => {
    t.auto('Axebane Ferox'); t.auto('The Unagi of Kyoshi Island');
    // evidence: B's graveyard holds 5 mana value; the Ferox's ward takes the biggest first
    const T = mk();
    T.toMain('B');
    const fx = T.bf('A', 'Axebane Ferox');
    const big = T.grave('B', 'Craw Wurm'), small = T.grave('B', 'Llanowar Elves');
    T.mana('B', '1BB');
    T.cast('B', T.hand('B', 'Murder'), { targets: [fx] });
    t.zone(big, 'exile', 'evidence collected: Craw Wurm (6)'); t.zone(small, 'graveyard', 'no more than needed');
    t.zone(fx, 'graveyard', 'and Murder resolves');
    const T2 = mk();
    T2.toMain('B');
    const fx2 = T2.bf('A', 'Axebane Ferox');
    T2.grave('B', 'Llanowar Elves');
    T2.mana('B', '1BB');
    T2.cast('B', T2.hand('B', 'Murder'), { targets: [fx2] });
    t.zone(fx2, 'battlefield', 'too little evidence: countered');
    // waterbend {4}: two mana and two creatures tapped
    const W = mk();
    W.toMain('B');
    const un = W.bf('A', 'The Unagi of Kyoshi Island');
    const helpers = [W.bf('B', 'Grizzly Bears'), W.bf('B', 'Hill Giant')];
    W.mana('B', '1BB'); W.mana('B', '2');
    W.cast('B', W.hand('B', 'Murder'), { targets: [un] });
    t.ok(helpers.every(o => o.tapped), 'two creatures tapped to help');
    t.zone(un, 'graveyard', 'waterbent {4}: Murder resolves');
    const W2 = mk();
    W2.toMain('B');
    const un2 = W2.bf('A', 'The Unagi of Kyoshi Island');
    W2.mana('B', '1BB');
    W2.cast('B', W2.hand('B', 'Murder'), { targets: [un2] });
    t.zone(un2, 'battlefield', 'nothing to waterbend with: countered');
  });

  test('Audit: ward counters an activated ability that targets it, too', (mk, t) => {
    t.auto('Gavony Dawnguard');
    const T = mk();
    T.toMain('B');
    const d = T.bf('A', 'Gavony Dawnguard');
    const ps = T.bf('B', 'Prodigal Sorcerer'); ps.summoningSick = false;
    T.activate('B', ps, 0, { targets: [d] });
    t.eq(d.damage || 0, 0, 'no {1} to pay: the ping is countered');
    ps.tapped = false;
    T.mana('B', '1');
    T.activate('B', ps, 0, { targets: [d] });
    t.eq(d.damage || 0, 1, 'with {1}: paid, and it deals 1');
  });

  test('Audit: a ward price no part of the table takes leaves the card to its players', (mk, t) => {
    const a = (n) => mk().MTG.oracle.analyze(require('../harness').card(n));
    // ("Discard a card or pay {2}" is taken now: Titania, Rugged Rumbler — either)
    t.ok(a('Titania, Rugged Rumbler').fullyAutomated, '"Discard a card or pay {2}"');
    t.eq(mk().MTG.oracle.wardPrice('Exile a card from your graveyard'), null, 'a price nothing takes');
    t.eq(mk().MTG.oracle.wardPrice('Discard a card or exile a card from your graveyard'), null, 'nor one half of it');
    // ("Ward—Blight 2" is taken now: Auntie Ool, Cursewretch)
    t.eq(JSON.stringify(mk().MTG.oracle.wardPrice('Blight 2')), '{"blight":2}');
    // and "Ward {1}, haste" is {1}, the haste its own keyword
    t.ok(a('Colorstorm Stallion').fullyAutomated, 'Colorstorm Stallion stays automated');
    t.eq(JSON.stringify(mk().MTG.oracle.wardPrice('{1}, haste')), '{"mana":"{1}"}');
  });

  /* ---- ward on a triggered ability: its targets are chosen as it resolves here, and ward is met then ---- */

  /* B casts Ravenous Chupacabra; its enters trigger is aimed at `name`, A's. */
  const chupacabraAt = (mk, name, opts) => {
    opts = opts || {};
    const T = mk({ library: Array(20).fill('Swamp') });
    T.toMain('B');
    const w = T.bf('A', name);
    if (opts.setup) opts.setup(T, w);
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: w.id }] }));
    if (opts.answer) T.answer(opts.answer.type, opts.answer.data);
    T.mana('B', '2BB');
    if (opts.extra) T.mana('B', opts.extra);
    T.cast('B', T.hand('B', 'Ravenous Chupacabra'));
    return { T, w };
  };

  test('Ward: a triggered ability aimed at a ward {2} creature is countered unless its controller pays', (mk, t) => {
    t.auto('Ravenous Chupacabra'); t.auto('Hulking Raptor');
    const paid = chupacabraAt(mk, 'Hulking Raptor', { extra: '2' });
    const q = paid.T.asked.find(c => c.purpose === 'wardPrice');
    t.ok(q && q.playerId === 'B', 'B, who controls the trigger, is asked');
    t.ok(/\{2\}/.test(q.prompt) && q.objId === paid.w.id, 'with the whole price shown: ' + (q && q.prompt));
    t.zone(paid.w, 'graveyard', 'paid {2}: the Raptor is destroyed');
    t.eq(paid.T.g.player('B').pool.C || 0, 0, 'and the {2} is spent');
    const declined = chupacabraAt(mk, 'Hulking Raptor', { extra: '2', answer: { type: 'confirm', data: (ch) => ({ yes: ch.purpose !== 'wardPrice' }) } });
    t.zone(declined.w, 'battlefield', 'not paid: the trigger is countered and the Raptor lives');
    t.eq(declined.T.g.player('B').pool.C || 0, 2, 'and nothing is paid');
    t.ok(declined.T.g.log.some(l => /countered by Hulking Raptor's ward/.test(l.text)), 'the log says so');
    const broke = chupacabraAt(mk, 'Hulking Raptor');
    t.zone(broke.w, 'battlefield', 'no {2} to pay: countered');
    t.no(broke.T.asked.some(c => c.purpose === 'wardPrice'), 'without asking a price that can\'t be paid');
  });

  test('Ward: a trigger pays "Pay 7 life", "Sacrifice a creature" and "Discard a card" too', (mk, t) => {
    t.auto('Sire of Seven Deaths'); t.auto('Vein Ripper'); t.auto('Westgate Regent');
    const life = chupacabraAt(mk, 'Sire of Seven Deaths');
    t.zone(life.w, 'graveyard', 'paid 7 life: Sire destroyed');
    t.eq(life.T.life('B'), 13, 'B paid 7 life');
    const low = chupacabraAt(mk, 'Sire of Seven Deaths', { setup: (T) => { T.player('B').life = 6; } });
    t.zone(low.w, 'battlefield', 'six life can\'t pay seven: countered');
    t.eq(low.T.life('B'), 6, 'and no life is paid');
    let bears;
    const sac = chupacabraAt(mk, 'Vein Ripper', { setup: (T) => { bears = T.bf('B', 'Grizzly Bears'); },
      answer: { type: 'choose', data: (ch) => ({ picks: ch.purpose === 'wardPay' ? [bears.id] : [] }) } });
    t.ok(sac.T.asked.some(c => c.type === 'choose' && c.purpose === 'wardPay' && c.playerId === 'B'), 'B is asked what to sacrifice');
    t.zone(bears, 'graveyard', 'the Bears sacrificed');
    t.zone(sac.w, 'graveyard', 'and Vein Ripper destroyed');
    let card;
    const nope = chupacabraAt(mk, 'Westgate Regent', { setup: (T) => { card = T.hand('B', 'Grizzly Bears'); },
      answer: { type: 'choose', data: { picks: [] } } });
    t.zone(card, 'hand', 'declined: nothing discarded');
    t.zone(nope.w, 'battlefield', 'and the trigger is countered');
  });

  test('Ward: your own trigger at your own warded creature asks nothing', (mk, t) => {
    t.auto('Flametongue Kavu');
    const T = mk({ library: Array(20).fill('Mountain') });
    T.toMain('A');
    const raptor = T.bf('A', 'Hulking Raptor');
    T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: raptor.id }] }));
    T.mana('A', '3R');
    T.cast('A', T.hand('A', 'Flametongue Kavu'));
    t.no(T.asked.some(c => c.purpose === 'wardPrice'), 'no ward');
    t.zone(raptor, 'graveyard', '4 damage to its own Raptor');
  });

  test('Ward: "up to one target" — Skyclave Apparition at a ward creature', (mk, t) => {
    t.auto('Skyclave Apparition');
    const run = (pay) => {
      const T = mk({ library: Array(20).fill('Plains') });
      T.toMain('B');
      const raptor = T.bf('A', 'Hulking Raptor');
      T.answer('pickTarget', () => ({ targets: [{ kind: 'object', id: raptor.id }] }));
      T.answer('confirm', (ch) => ({ yes: ch.purpose === 'wardPrice' ? pay : true }));
      T.mana('B', '1WW'); T.mana('B', '2');
      T.cast('B', T.hand('B', 'Skyclave Apparition'));
      return raptor;
    };
    t.zone(run(true), 'exile', 'paid: exiled');
    t.zone(run(false), 'battlefield', 'not paid: countered');
  });

  test('Ward: a bot pays for its trigger, and keeps its life when it is short', (mk, t) => {
    const run = (name, life) => {
      let bot;
      return chupacabraAt(mk, name, { extra: '2', setup: (T) => {
        T.player('B').life = life;
        bot = new T.MTG.bots.BotPlayer(T.g, 'B', 8);
      }, answer: { type: 'confirm', data: (ch) => ({ yes: bot.confirmChoice(ch) }) } });
    };
    t.zone(run('Hulking Raptor', 20).w, 'graveyard', 'the bot pays {2}');
    const rich = run('Polterheist', 20);
    t.zone(rich.w, 'graveyard', 'at 20 life the bot pays 3 life');
    t.eq(rich.T.life('B'), 17);
    const poor = run('Polterheist', 9);
    t.zone(poor.w, 'battlefield', 'at 9 life it lets the trigger be countered');
    t.eq(poor.T.life('B'), 9);
  });
  test('Targets: a spell whose target left the battlefield (bounced, or flickered back) is countered on resolution (CR 608.2b)', (mk, t) => {
    const M = mk({ library: Array(30).fill('Island') });
    const g = M.g;
    const bear = M.bf('A', 'Grizzly Bears');
    M.mana('A', 'G');
    const gg = M.hand('A', 'Giant Growth');
    M.cast('A', gg, { targets: [bear], resolve: false });
    M.mana('A', 'W');
    M.cast('A', M.hand('A', 'Cloudshift'), { targets: [bear] });
    t.zone(bear, 'battlefield', 'back from the flicker');
    t.eq(g.powerOf(bear), 2, 'Giant Growth found its target gone: a new object came back');
    t.zone(gg, 'graveyard');
    t.ok(g.log.some(l => /Giant Growth is countered on resolution/.test(l.text || l.msg || String(l))), 'logged as countered');
    // bounced: the same
    M.mana('A', 'G');
    const gg2 = M.hand('A', 'Giant Growth');
    M.cast('A', gg2, { targets: [bear], resolve: false });
    M.mana('A', 'U');
    M.cast('A', M.hand('A', 'Unsummon'), { targets: [bear] });
    t.zone(bear, 'hand');
    t.zone(gg2, 'graveyard');
    // and a target that stays put is still fine
    const bear2 = M.bf('A', 'Grizzly Bears');
    M.mana('A', 'G');
    M.cast('A', M.hand('A', 'Giant Growth'), { targets: [bear2] });
    t.eq(g.powerOf(bear2), 5);
  });
};
