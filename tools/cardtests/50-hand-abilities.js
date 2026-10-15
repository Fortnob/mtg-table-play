/* Abilities used from the hand. A Spirit Guide ("Exile this card from your hand: Add {R}.") is a mana source a person
   can spend on a spell: what they could cast counts it, and paying for them uses it last of all, only once they have
   said yes ("Exile Simian Spirit Guide from your hand to cast Lightning Bolt?"), as a Treasure is. Exiled by hand, its
   mana arrives at once. And the rest of the family: "{2}, Exile this card from your hand: …" on the stack, channel,
   and the costs that exile another card from your hand (Force of Will, the Shoals, Solitude's evoke). */
'use strict';
module.exports = (test) => {
  const sacAsked = (T) => T.asked.filter(ch => ch.purpose === 'sacMana');
  const pool = (T, pid) => { const p = T.player(pid || 'A').pool; return ['W', 'U', 'B', 'R', 'G', 'C'].reduce((k, c) => k + (p[c] || 0), 0); };

  test('Spirit Guide: a spell its mana pays for can be cast, and the Guide is exiled for it once you say yes', (mk, t) => {
    const T = mk();
    const g = T.g;
    const sg = T.hand('A', 'Simian Spirit Guide');
    const bolt = T.hand('A', 'Lightning Bolt');
    t.ok(g.playableNow('A').some(x => x.kind === 'cast' && x.objId === bolt.id), 'Lightning Bolt is castable with the Guide in hand');
    t.ok(g.canPayNow('A', '{R}', { forSpell: bolt }), 'the cost can be paid');
    const life = T.life('B');
    T.cast('A', bolt, { targets: ['B'] });
    t.eq(sacAsked(T).length, 1, 'asked once');
    t.zone(sg, 'exile', 'the Guide');
    t.zone(bolt, 'graveyard');
    t.eq(T.life('B'), life - 3, 'it resolved');
  });

  test('Spirit Guide: the question names it, and comes before anything is done', (mk, t) => {
    const T = mk();
    const g = T.g;
    const sg = T.hand('A', 'Simian Spirit Guide');
    const bolt = T.hand('A', 'Lightning Bolt');
    t.ok(g.castSpell('A', bolt.id, { auto: true, targets: [{ kind: 'player', id: 'B' }] }), 'the cast is taken, as a question');
    const ch = g.pendingChoice;
    t.ok(ch && ch.type === 'confirm' && ch.purpose === 'sacMana' && ch.playerId === 'A', 'A is asked');
    t.eq(ch.prompt, 'Exile Simian Spirit Guide from your hand to cast Lightning Bolt?', 'the question');
    t.eq(ch.yesLabel, 'Exile and cast', 'yes');
    t.eq(ch.sacMana && ch.sacMana.ids.join(), sg.id, 'it names the Guide');
    t.zone(sg, 'hand', 'the Guide');
    t.zone(bolt, 'hand', 'the Bolt');
    t.eq(pool(T), 0, 'no mana made yet');
    // no: all as it was
    g.resolveChoice('A', { yes: false });
    t.zone(sg, 'hand', 'the Guide after a no');
    t.zone(bolt, 'hand', 'the Bolt after a no');
    t.eq(g.stack.length, 0, 'nothing on the stack');
    t.no(g.pendingChoice, 'no question left');
  });

  test('Spirit Guide: lands are tapped first, a Treasure before the Guide, and the Guide never pays for itself', (mk, t) => {
    const T = mk();
    const g = T.g;
    // Hill Giant {3}{R}: three Mountains and the Guide
    const m = [T.bf('A', 'Mountain'), T.bf('A', 'Mountain'), T.bf('A', 'Mountain')];
    const sg = T.hand('A', 'Simian Spirit Guide');
    const giant = T.hand('A', 'Hill Giant');
    T.cast('A', giant, {});
    t.ok(m.every(x => x.tapped), 'the Mountains tapped');
    t.zone(sg, 'exile', 'the Guide paid the rest');
    t.zone(giant, 'battlefield');
    // a Treasure and a Guide: the Treasure goes
    const T2 = mk();
    T2.g._createNamedToken('A', { token: 'Treasure', n: 1 });
    const sg2 = T2.hand('A', 'Elvish Spirit Guide');
    const bolt = T2.hand('A', 'Lightning Bolt');
    T2.cast('A', bolt, { targets: ['B'] });
    t.zone(sg2, 'hand', 'the Guide is kept when a Treasure pays');
    t.eq(T2.bfOf('A').filter(x => x.name === 'Treasure').length, 0, 'the Treasure was spent');
    // a Simian alone can't pay for its own {2}{R}
    const T3 = mk();
    const lone = T3.hand('A', 'Simian Spirit Guide');
    T3.hand('A', 'Elvish Spirit Guide');
    t.no(T3.g.canPayNow('A', '{2}{R}', { forSpell: lone }), 'not castable off itself');
    t.ok(T3.g.whyNotPlayable('A', lone.id), 'the cast has a reason it cannot be made');
    t.ok(T3.g.playableNow('A').some(x => x.kind === 'cycle' && x.objId === lone.id), 'its Exile for mana still can');
  });

  test('Spirit Guide: two of them pay for a two-colour spell; mixed with a Treasure, the question says both', (mk, t) => {
    const T = mk();
    const s = T.hand('A', 'Simian Spirit Guide'), e = T.hand('A', 'Elvish Spirit Guide');
    const bears = T.hand('A', 'Grizzly Bears');     // {1}{G}
    T.cast('A', bears, {});
    t.eq(T.asked.find(ch => ch.purpose === 'sacMana').prompt, 'Exile Elvish Spirit Guide and Simian Spirit Guide from your hand to cast Grizzly Bears?', 'both named');
    t.zone(s, 'exile'); t.zone(e, 'exile'); t.zone(bears, 'battlefield');
    const T2 = mk();
    T2.g._createNamedToken('A', { token: 'Treasure', n: 1 });
    T2.hand('A', 'Simian Spirit Guide');
    const giant2 = T2.hand('A', 'Hill Giant');         // {3}{R}: no lands, so not enough
    t.no(T2.g.canPayNow('A', '{3}{R}', { forSpell: giant2 }), 'not castable when they can\'t pay for it all');
    t.no(T2.g.castSpell('A', giant2.id, { auto: true }), 'and not cast');
    t.no(T2.g.pendingChoice, 'nor asked about');
    const T3 = mk();
    T3.bf('A', 'Mountain'); T3.bf('A', 'Mountain');
    T3.g._createNamedToken('A', { token: 'Treasure', n: 1 });
    T3.hand('A', 'Simian Spirit Guide');
    T3.cast('A', T3.hand('A', 'Hill Giant'), {});
    const ch = sacAsked(T3)[0];
    t.eq(ch && ch.prompt, 'Sacrifice a Treasure and exile Simian Spirit Guide from your hand to cast Hill Giant?', 'a Treasure and a Guide');
    t.eq(ch && ch.yesLabel, 'Sacrifice and cast', 'the yes for both');
  });

  test("Spirit Guide: a bot's auto-pay is as it was (it uses a Guide by its own choice)", (mk, t) => {
    const T = mk();
    const g = T.g;
    g.player('A').isBot = true;
    T.hand('A', 'Simian Spirit Guide');
    const bolt = T.hand('A', 'Lightning Bolt');
    t.no(g.canPayNow('A', '{R}', { forSpell: bolt }), "a bot's auto-pay doesn't count the Guide");
  });

  test('Spirit Guide: exiled by hand mid-payment, its mana stays in the pool and pays from there', (mk, t) => {
    const T = mk();
    const g = T.g;
    const sg = T.hand('A', 'Simian Spirit Guide');
    const bolt = T.hand('A', 'Lightning Bolt');
    t.ok(g.altUsesFor('A', sg.id).some(u => u.kind === 'cycle' && u.channel && u.mana && u.cost === ''), 'offered as a mana use');
    t.ok(g.cycleCard('A', sg.id, { auto: true, channel: true, targets: [] }), 'exiled');
    t.zone(sg, 'exile');
    t.eq(T.player('A').pool.R, 1, '{R} in the pool');
    const life = T.life('B');
    T.cast('A', bolt, { targets: ['B'], fromPool: true });
    t.eq(sacAsked(T).length, 0, 'nothing to ask: the pool pays');
    t.eq(T.life('B'), life - 3, 'the Bolt resolved');
  });

  test('Spirit Guide: an activated ability paid with it asks too', (mk, t) => {
    const T = mk();
    const g = T.g;
    const sg = T.hand('A', 'Simian Spirit Guide');
    // Shivan Dragon's firebreathing: {R}
    const dragon = T.bf('A', 'Shivan Dragon');
    const p0 = g.powerOf(dragon);
    T.activate('A', dragon, 0, {});
    t.eq(sacAsked(T).length, 1, 'asked');
    t.zone(sg, 'exile');
    t.eq(g.powerOf(dragon), p0 + 1, 'pumped');
  });

  test('"{2}, Exile this card from your hand": Shattered Seraph gives a land its three colours, and is cast from exile', (mk, t) => {
    const T = mk();
    const g = T.g;
    const plains = T.bf('A', 'Plains'); T.bf('A', 'Island'); T.bf('A', 'Swamp');
    const seraph = T.hand('A', 'Shattered Seraph');
    t.ok(g.cycleCard('A', seraph.id, { auto: true, channel: true, targets: [{ kind: 'object', id: plains.id }] }), 'used');
    t.zone(seraph, 'exile');
    t.eq(g.stack.length, 1, 'on the stack');
    T.resolve();
    t.ok(g.manaAbilitiesOf(plains).some(ab => /\{W\}, \{U\}, or \{B\}/.test(ab.text || '')), 'the Plains has the new ability');
  });

  /* where a person with smart stops gets to act in their own turn: the steps, up to the main phase */
  const myStops = (T, at0) => {
    const g = T.g;
    g.player('B').isBot = true;
    g.setAutoPass('A', { enabled: true, untilStackChange: true, stops: T.MTG.DEFAULT_STOPS, fullControl: false, smart: true });
    const at = [];
    for (let i = 0; i < 200; i++) {
      T.settle();
      const p = g.priorityPlayer;
      if (!p) break;
      if (g.turn > 1 && g.activePlayer.id === 'A' && p.id === 'A') { at.push(g.step); if (at0) at0(g.step); if (g.step === 'main') break; }
      g.passPriority(p.id, true);
    }
    return at;
  };

  test('Forecast: a card that could forecast stops you in your upkeep, the one step it works in', (mk, t) => {
    const T = mk();
    for (const n of ['Plains', 'Island', 'Plains', 'Island']) T.bf('A', n);
    const pride = T.hand('A', 'Pride of the Clouds');      // Forecast — {2}{W}{U}: a 1/1 Bird
    let offered = false;
    t.eq(myStops(T, (step) => { if (step === 'upkeep') offered = T.g.altUsesFor('A', pride.id).some(u => u.forecast); }).join(), 'upkeep,main', 'stopped in the upkeep');
    t.ok(offered, 'forecast offered there');
    // with nothing to forecast, the upkeep goes by as ever
    const T2 = mk();
    for (const n of ['Plains', 'Island']) T2.bf('A', n);
    T2.hand('A', 'Pride of the Clouds');                   // not enough mana for it
    t.eq(myStops(T2).join(), 'main', 'no stop when it could not be paid for');
  });

  test('Solitude: evoked by exiling a white card from your hand, not for nothing', (mk, t) => {
    const T = mk();
    const g = T.g;
    const bears = T.bf('B', 'Grizzly Bears');
    const sol = T.hand('A', 'Solitude');
    const stp = T.hand('A', 'Swords to Plowshares');
    T.hand('A', 'Lightning Bolt');
    const use = g.altUsesFor('A', sol.id).find(u => u.via === 'evoke');
    t.ok(use && use.cost === '' && use.alt && use.alt.exileFromHand, 'evoke offered as exiling a card, no mana');
    T.cast('A', sol, { via: 'evoke', targets: [bears] });
    t.zone(stp, 'exile', 'Swords exiled to pay');
    t.zone(sol, 'graveyard', 'Solitude sacrificed');
    t.zone(bears, 'exile', 'the Bears exiled by its trigger');
    // with no white card to give up, no evoke
    const T2 = mk();
    const sol2 = T2.hand('A', 'Solitude');
    T2.hand('A', 'Lightning Bolt');
    t.no(T2.g.altUsesFor('A', sol2.id).some(u => u.via === 'evoke'), 'not offered without a white card');
  });
};
