/* A replay's fingerprint (src/06c-replay.js) compares printings, not when the card cache fetched them — wherever a view
   carries a card, a question's sourceCard included. */
'use strict';
const { engine } = require('../harness');
module.exports = (test) => {
  test('Replay fingerprint: a question\'s sourceCard is compared by printing, not by when it was fetched', (mk, t) => {
    const T = mk();
    const o = T.bf('A', 'Grizzly Bears');
    const fp = () => engine().replay.fingerprint(T.g).hash;
    T.g.pendingChoice = { type: 'confirm', playerId: 'A', prompt: 'Test', sourceId: o.id, sourceName: o.name, sourceCard: Object.assign({}, o.card, { _t: 1 }) };
    const a = fp();
    T.g.pendingChoice.sourceCard = Object.assign({}, o.card, { _t: 2 });
    t.eq(fp(), a, 'the same printing fetched at another time');
    T.g.pendingChoice.sourceCard = Object.assign({}, o.card, { _t: 2, id: 'another-printing' });
    t.ok(fp() !== a, 'another printing still counts');
    T.g.pendingChoice = null;
  });
};
