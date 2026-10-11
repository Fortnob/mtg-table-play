/* What a card asks to be done by hand: the card waits for its controller to say it is done. */
'use strict';
module.exports = (test) => {
  test('A part done by hand is asked of a person, and the card waits for it', (mk, t) => {
    const T = mk();
    const g = T.g;
    // a card of its own, with a sentence in the middle no engine will ever read
    const card = { id: 'test-byhand', oracle_id: 'test-byhand', name: 'Test of Hands', type_line: 'Sorcery', mana_cost: '', cmc: 0,
      colors: [], color_identity: [], keywords: [], layout: 'normal', rarity: 'common', set: 'tst', legalities: {},
      oracle_text: 'Draw a card. Each player sings a song about their favorite land. You gain 3 life.' };
    const o = g._register(new T.MTG.rules.GObj(card, 'A', 'hand'));
    g.zones.A.hand.push(o);
    const life = T.life('A');
    t.ok(g.castSpell('A', o.id, { auto: true }), 'cast');
    for (let i = 0; i < 6 && g.stack.length && !g.pendingChoice; i++) g.passPriority(g.priorityPlayer.id, true);
    const ch = g.pendingChoice;
    t.ok(ch && ch.type === 'byHand' && ch.playerId === 'A', 'asked of its controller: ' + JSON.stringify(ch && ch.type));
    t.eq(T.life('A'), life, 'the rest of the card waits');
    g.resolveChoice('A', { done: true });
    t.eq(T.life('A'), life + 3, 'and happens once it is done');
    t.no(g.pendingChoice, 'nothing left waiting');
    // (the by-hand line in the log is this test's point, not a card falling through)
    g.log = g.log.filter(l => !/resolve this by hand/.test(l.text));
  });
};
