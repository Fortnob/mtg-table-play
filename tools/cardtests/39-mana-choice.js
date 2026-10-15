/* Mana a person taps for by hand, where the source lets them choose: the colour (or bundle) they pick goes with
   the tap, since a mana ability can't stop to ask, and the engine keeps it only when it is one the source offers.
   The table learns what each of its controller's sources offers from the view (manaChoices). */
'use strict';
module.exports = (test) => {
  const keys = (g, pid, o, i) => g.manaChoicesAt(pid, o, i || 0).map(x => x.key).join(',');
  const pool = (T, pid) => { const p = T.player(pid).pool; return ['W', 'U', 'B', 'R', 'G', 'C'].map(c => c.repeat(p[c] || 0)).join(''); };

  test("Mana choice: Kibo's Banana adds {G} or {R}, as its controller says", (mk, t) => {
    const T = mk({ library: Array(30).fill('Forest') });
    const g = T.g;
    const kibo = T.bf('A', 'Kibo, Uktabi Prince');
    T.activate('A', kibo, 0);
    const bananas = g.battlefield.filter(o => o.name === 'Banana' && o.controller === 'A');
    kibo.tapped = false;
    T.activate('A', kibo, 0);
    t.eq(keys(g, 'A', bananas[0]), 'R,G', 'Banana: {R} or {G}');
    t.ok(g.tapForMana('A', bananas[0].id, 0, 'G'), 'tapped for green');
    t.eq(pool(T, 'A'), 'G', 'green, as asked');
    t.zone(bananas[0], 'graveyard', 'Banana: sacrificed');
    t.eq(T.life('A'), 22, 'Banana: 2 life');
    const second = g.battlefield.find(o => o.name === 'Banana' && o.controller === 'A');
    t.ok(second, 'another Banana');
    t.ok(g.tapForMana('A', second.id, 0, 'R'), 'tapped for red');
    t.eq(pool(T, 'A'), 'RG', 'red too');
  });

  test('Mana choice: Birds of Paradise, each colour', (mk, t) => {
    const T = mk();
    const g = T.g;
    for (const c of ['W', 'U', 'B', 'R', 'G']) {
      const b = T.bf('A', 'Birds of Paradise');
      t.eq(keys(g, 'A', b), 'W,U,B,R,G', 'any colour');
      t.ok(g.tapForMana('A', b.id, 0, c), 'tapped');
    }
    t.eq(pool(T, 'A'), 'WUBRG', 'one of each, as asked');
  });

  test("Mana choice: Arcane Signet, only the commander's colours; anything else is ignored", (mk, t) => {
    const T = mk();
    const g = T.g;
    const cmd = T.bf('A', 'Kibo, Uktabi Prince');      // {R}{G}… Kibo is red-green
    cmd.isCommander = true;
    const s1 = T.bf('A', 'Arcane Signet'), s2 = T.bf('A', 'Arcane Signet');
    const ids = (g.manaChoicesAt('A', s1, 0)).map(x => x.key).sort().join('');
    t.eq(ids, (cmd.card.color_identity || []).slice().sort().join(''), "the commander's colours");
    t.ok(g.tapForMana('A', s1.id, 0, 'G'), 'tapped for green');
    t.eq(pool(T, 'A'), 'G');
    t.ok(g.tapForMana('A', s2.id, 0, 'U'), 'tapped, asking for blue');
    t.ok(T.player('A').pool.U === 0, 'no blue: not in the identity');
    t.eq(T.player('A').pool.total(), 2, 'but mana all the same, of a colour it may make');
    t.ok(/^[RG]+$/.test(pool(T, 'A')), 'red or green: ' + pool(T, 'A'));
  });

  test('Mana choice: a filter land offers whole bundles, and makes the one picked', (mk, t) => {
    const T = mk();
    const g = T.g;
    const gate = T.bf('A', 'Mystic Gate');
    t.eq(keys(g, 'A', gate, 1), 'WW,WU,UU', '{W}{W}, {W}{U} or {U}{U}');
    t.eq(keys(g, 'A', gate, 0), '', '{T}: Add {C}: nothing to choose');
    T.mana('A', 'U');
    t.ok(g.tapForMana('A', gate.id, 1, 'WU'), 'tapped for {W}{U}');
    t.eq(pool(T, 'A'), 'WU', 'the bundle picked');
    const gate2 = T.bf('A', 'Mystic Gate');
    T.mana('A', 'W');
    t.ok(g.tapForMana('A', gate2.id, 1, 'UU'), 'tapped for {U}{U}');
    t.eq(pool(T, 'A'), 'WUUU');
  });

  test('Mana choice: Relic of Sauron, two in any combination, as picked', (mk, t) => {
    const T = mk();
    const g = T.g;
    const r = T.bf('A', 'Relic of Sauron');
    t.eq(keys(g, 'A', r), 'UU,UB,UR,BB,BR,RR', 'each combination');
    t.ok(g.tapForMana('A', r.id, 0, 'BR'), 'tapped');
    t.eq(pool(T, 'A'), 'BR', 'one black, one red');
  });

  test("Mana choice: Brigid, Doun's Mind — X {G} or X {W}", (mk, t) => {
    const T = mk({ library: Array(30).fill('Island') });
    const g = T.g;
    const br = T.bf('A', "Brigid, Clachan's Heart // Brigid, Doun's Mind");
    br.face = 1; br._chr = null; g.bumpBoard();
    T.bf('A', 'Grizzly Bears'); T.bf('A', 'Hill Giant');
    const opts = g.manaChoicesAt('A', br, 0);
    t.eq(opts.map(x => x.key).join(','), 'G,W', 'green or white');
    t.eq(opts[0].mana, '{G}{G}', 'X = 2, shown');
    t.ok(g.tapForMana('A', br.id, 0, 'W'), 'tapped for white');
    t.eq(pool(T, 'A'), 'WW');
  });

  test('Mana choice: Exotic Orchard and Reflecting Pool, only what those lands could make', (mk, t) => {
    const T = mk();
    const g = T.g;
    T.bf('B', 'Island'); T.bf('B', 'Swamp');
    T.bf('A', 'Forest'); T.bf('A', 'Wastes');
    const orch = T.bf('A', 'Exotic Orchard');
    const pool2 = T.bf('A', 'Reflecting Pool');
    t.eq(keys(g, 'A', orch), 'U,B', "an opponent's lands: blue or black");
    t.eq(keys(g, 'A', pool2).split(',').sort().join(','), 'C,G', 'your lands, any type: green or colourless');
    t.ok(g.tapForMana('A', orch.id, 0, 'B'), 'orchard');
    t.ok(g.tapForMana('A', pool2.id, 0, 'C'), 'pool');
    t.eq(pool(T, 'A'), 'BC');
  });

  test('Mana choice: a Treasure (sacrificed for it) makes the colour picked', (mk, t) => {
    const T = mk();
    const g = T.g;
    g._createNamedToken('A', { token: 'Treasure', n: 1 });
    const tr = g.battlefield.find(o => o.controller === 'A' && o.name === 'Treasure');
    t.ok(tr, 'a Treasure');
    t.eq(keys(g, 'A', tr), 'W,U,B,R,G', 'any colour');
    t.ok(g.tapForMana('A', tr.id, 0, 'U'), 'cracked');
    t.eq(pool(T, 'A'), 'U');
    t.zone(tr, 'graveyard', 'sacrificed');
  });

  test("Mana choice: the view says what each source offers, to its controller only", (mk, t) => {
    const T = mk();
    const g = T.g;
    const b = T.bf('A', 'Birds of Paradise');
    const f = T.bf('A', 'Forest');
    const gate = T.bf('A', 'Mystic Gate');
    const theirs = T.bf('B', 'Birds of Paradise');
    const va = g.viewFor('A'), vb = g.viewFor('B');
    const find = (v, o) => v.battlefield.find(x => x.id === o.id);
    t.eq(JSON.stringify(find(va, b).manaChoices), JSON.stringify([{ i: 0, options: ['W', 'U', 'B', 'R', 'G'].map(c => ({ key: c, mana: '{' + c + '}' })) }]), 'the Birds, to A');
    t.no(find(va, f).manaChoices, 'a Forest: nothing to choose');
    t.eq((find(va, gate).manaChoices || []).map(x => x.i).join(), '1', 'the filter ability only');
    t.no(find(vb, b).manaChoices, "not to B: A's Birds");
    t.no(find(va, theirs).manaChoices, "nor to A: B's Birds");
    t.ok(find(vb, theirs).manaChoices, "B's own Birds, to B");
  });
};
