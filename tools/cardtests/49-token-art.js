/* Token art (src/02e-tokenart.js): a token on the table is shown as a printed token only when everything
   printed on it is the token's — name, power and toughness, colours, types and abilities — and the art a
   player may choose for it is only ever another printing of that same token. Checked against Scryfall's
   own tokens (every printed token in the bulk file), with tokens made the way the engine makes them. */
'use strict';
const { tokens, card, engine } = require('../harness');

module.exports = (test) => {
  let printed = null;
  const all = () => printed || (printed = tokens().map(c => engine().scry.slim(c)));
  const TA = () => engine().tokenArt;
  /** The token a card's words make, made by the engine. */
  const fromCard = (T, name) => {
    const MTG = engine();
    const found = [];
    const visit = (v, d) => {
      if (!v || typeof v !== 'object' || d > 14) return;
      if (Array.isArray(v)) { v.forEach(x => visit(x, d + 1)); return; }
      if (v.op === 'createToken' && v.pt) found.push(v);
      for (const k of Object.keys(v)) if (k !== 'card') visit(v[k], d + 1);
    };
    visit(MTG.oracle.analyze(card(name)).abilities, 0);
    if (!found.length) throw new Error(name + ' makes no token the engine reads');
    T.g._createToken('A', Object.assign({}, found[0], { n: 1, who: undefined, countBy: null, attacking: false, tapped: false, blockingTriggerObject: false }));
    return T.bfOf('A').filter(x => x.isToken).pop();
  };
  const spec = (T, e) => { T.g._createToken('A', Object.assign({ n: 1, addTypes: [], keywords: [] }, e)); return T.bfOf('A').filter(x => x.isToken).pop(); };
  const named = (T, n) => { T.g._createNamedToken('A', { token: n, n: 1 }); return T.bfOf('A').filter(x => x.isToken && x.name === n).pop(); };
  const opts = (o) => TA().options(o.card, all(), o.face || 0);
  /** Every option's printed words, normalised as compared. */
  const words = (r) => [...new Set(r.list.map(x => TA().facts({ name: x.name, type_line: x.type_line, oracle_text: x.oracle_text }).text))];
  const printedLike = (pred) => all().find(c => !c.card_faces && pred(c));

  test('Token art: a 1/1 white Spirit with flying is shown only as a Spirit with flying, and one without as one without', (mk, t) => {
    const T = mk();
    const flier = fromCard(T, 'Lingering Souls');
    const plain = fromCard(T, 'Great Arashin City');
    t.eq(flier.card.oracle_text, 'Flying', 'the engine gave it flying');
    t.eq(plain.card.oracle_text, '', 'and this one nothing');
    const a = opts(flier), b = opts(plain);
    t.eq(a.how, 'exact', 'the flier has printings');
    t.eq(b.how, 'exact', 'so does the plain one');
    t.eq(words(a).join('|'), 'flying', 'every option for the flier says Flying, and nothing else');
    t.eq(words(b).join('|'), '', 'every option for the plain one has no rules text');
    t.ok(a.list.every(x => /^Spirit$/.test(x.name)), 'all of them Spirits');
    const plainPrint = printedLike(c => c.name === 'Spirit' && c.power === '1' && c.toughness === '1' && (c.colors || []).join() === 'W' && !c.oracle_text);
    const flyPrint = printedLike(c => c.name === 'Spirit' && c.power === '1' && c.toughness === '1' && (c.colors || []).join() === 'W' && c.oracle_text === 'Flying');
    t.ok(plainPrint && flyPrint, 'Scryfall has both');
    t.eq(TA().compare(TA().facts(flier.card), TA().facts(plainPrint)), '', 'the flier is not the plain printing');
    t.eq(TA().compare(TA().facts(plain.card), TA().facts(flyPrint)), '', 'nor the plain one the flier');
    t.ok(TA().key(flier.card) !== TA().key(plain.card), 'two kinds, kept apart');
    t.eq(TA().key(flier.card), TA().key(fromCard(T, 'Spectral Procession').card), 'the same kind from another card');
    const q = TA().query(flier.card);
    t.ok(/t:token/.test(q) && /t:spirit/.test(q) && /c=w\b/.test(q) && /o:flying/.test(q) && /pow=1/.test(q), 'the search narrows by type, colour, size and keyword: ' + q);
  });

  test('Token art: a 2/2 black Zombie with decayed against a plain one (reminder text ignored)', (mk, t) => {
    const T = mk();
    const decayed = spec(T, { pt: '2/2', colorWords: ['black'], subtypes: 'Zombie', keywords: ['Decayed'] });
    const plain = fromCard(T, "Gisa's Bidding");
    t.eq(decayed.card.oracle_text, 'Decayed', 'the engine writes it without its reminder');
    const a = opts(decayed), b = opts(plain);
    t.eq(a.how, 'exact', 'decayed Zombies are printed');
    t.ok(a.list.every(x => /^Decayed \(This creature can't block/.test(x.oracle_text)), 'and each one shown has decayed, its reminder text and all');
    t.eq(b.how, 'exact', 'plain Zombies are printed');
    t.eq(words(b).join('|'), '', 'and none shown for a plain one has any rules text');
    t.no(b.list.some(x => /Decayed/.test(x.oracle_text)), 'a plain Zombie is never shown decayed');
  });

  test('Token art: Treasure and Clue match their printings, "this artifact" and "this token" alike', (mk, t) => {
    const T = mk();
    for (const [n, want] of [['Treasure', '{T}, Sacrifice this token: Add one mana of any color.'], ['Clue', '{2}, Sacrifice this token: Draw a card.']]) {
      const o = named(T, n);
      t.ok(/this artifact/.test(o.card.oracle_text), n + ': the engine says "this artifact"');
      const r = opts(o);
      t.eq(r.how, 'exact', n + ' matches');
      t.ok(r.list.some(x => x.oracle_text === want), n + ': the current printing is among them');
      t.ok(r.list.every(x => x.name === n && /Token Artifact — /.test(x.type_line)), n + ': only ' + n + ' tokens');
      const q = TA().query(o.card);
      t.ok(/t:token/.test(q) && new RegExp('t:' + n.toLowerCase()).test(q) && /c=c/.test(q) && !/pow=/.test(q), n + ': its search ' + q);
    }
    // a Treasure with more to it (T'Challa's Vibranium is not a Treasure; a Treasure with words added is not one either)
    const o = named(T, 'Treasure');
    const odd = Object.assign({}, o.card, { oracle_text: o.card.oracle_text + '\nWhen this artifact is put into a graveyard, you gain 1 life.' });
    t.eq(TA().options(odd, all()).how, '', 'a Treasure with another ability matches no printed Treasure');
  });

  test('Token art: a 3/3 green Beast is only the plain 3/3 green Beast', (mk, t) => {
    const T = mk();
    const o = fromCard(T, 'Beast Within');
    const r = opts(o);
    t.eq(r.how, 'exact', 'printed');
    t.eq(words(r).join('|'), '', 'no rules text on any of them');
    const deathtouch = printedLike(c => c.name === 'Beast' && c.power === '3' && (c.colors || []).join() === 'B');
    t.ok(deathtouch, 'Scryfall has a 3/3 black Beast with deathtouch');
    t.eq(TA().compare(TA().facts(o.card), TA().facts(deathtouch)), '', 'which is not this one');
    const big = printedLike(c => c.name === 'Beast' && c.power === '4' && c.toughness === '4' && (c.colors || []).join() === 'G' && !c.oracle_text);
    t.eq(TA().compare(TA().facts(o.card), TA().facts(big)), '', 'nor is the 4/4');
  });

  test('Token art: a granted ability in quotes (Eldrazi Spawn) matches the printing that says it', (mk, t) => {
    const T = mk();
    const o = fromCard(T, 'Pawn of Ulamog');
    t.ok(/Sacrifice this token: Add \{C\}/.test(o.card.oracle_text), 'the engine gives it the quoted ability');
    const r = opts(o);
    t.eq(r.how, 'exact', 'printed');
    t.ok(r.list.length && r.list.every(x => /^Sacrifice this creature: Add \{C\}\.$/.test(x.oracle_text)), 'every option is the Spawn with that ability');
    const bare = Object.assign({}, o.card, { oracle_text: '' });
    t.eq(TA().options(bare, all()).how, '', 'a 0/1 Eldrazi Spawn without it matches none');
  });

  test('Token art: a multicoloured token matches its colours exactly', (mk, t) => {
    const T = mk();
    const o = fromCard(T, "Kaya's Guile");
    t.eq((o.card.colors || []).slice().sort().join(''), 'BW', 'a white and black Spirit');
    const r = opts(o);
    t.eq(r.how, 'exact', 'printed');
    t.ok(r.list.length > 0, 'at least one');
    const white = printedLike(c => c.name === 'Spirit' && c.power === '1' && (c.colors || []).join() === 'W' && c.oracle_text === 'Flying');
    t.eq(TA().compare(TA().facts(o.card), TA().facts(white)), '', 'the white Spirit with flying is not it');
    t.ok(/c=bw/.test(TA().query(o.card)), 'its search asks for exactly white and black');
    const beast = spec(T, { pt: '4/4', colorWords: ['red', 'green'], subtypes: 'Beast', keywords: ['Trample'] });
    t.eq(opts(beast).how, 'exact', 'the 4/4 red and green Beast with trample is printed too');
    t.eq(words(opts(beast)).join('|'), 'trample', 'with trample');
  });

  test('Token art: type line words and keywords count in any order; a token with no text needs a printing with none', (mk, t) => {
    const T = mk();
    const thopter = fromCard(T, 'Whirler Rogue');
    const print = printedLike(c => c.name === 'Thopter' && c.power === '1' && !(c.colors || []).length && c.oracle_text === 'Flying');
    t.ok(print, 'the colourless Thopter with flying');
    const F = (c) => TA().facts(c);
    t.eq(TA().compare(F(thopter.card), F(print)), 'exact', 'is the Thopter');
    const shuffled = Object.assign({}, print, { type_line: 'Token Creature Artifact — Thopter' });
    t.eq(TA().compare(F(thopter.card), F(shuffled)), 'exact', 'with its types in another order too');
    const noArtifact = Object.assign({}, print, { type_line: 'Token Creature — Thopter' });
    t.eq(TA().compare(F(thopter.card), F(noArtifact)), '', 'but not without Artifact');
    const insects = fromCard(T, 'Hornet Queen');
    t.eq(insects.card.oracle_text, 'Flying, Deathtouch', 'the engine lists them in its own way');
    const r = opts(insects);
    t.eq(r.how, 'exact', 'and still matches "Flying, deathtouch"');
    const swapped = Object.assign({}, insects.card, { oracle_text: 'Deathtouch\nFlying' });
    t.eq(TA().key(swapped), TA().key(insects.card), 'one to a line, the other way round, is the same token');
    // reminder text, the token's name for "this creature", punctuation and case
    const soldier = spec(T, { pt: '1/1', colorWords: ['green', 'white'], subtypes: 'Human Soldier', keywords: ['Training'] });
    t.eq(opts(soldier).how, 'exact', 'Training matches "Training (Whenever this creature attacks …)"');
    const goblin = spec(T, { pt: '1/1', colorWords: ['red'], subtypes: 'Goblin', grantedText: 'Goblin can’t block' });
    t.eq(opts(goblin).how, 'exact', '"Goblin can’t block" is "This creature can\'t block."');
    // no text at all
    const saproling = fromCard(T, 'Sprout Swarm');
    const sr = opts(saproling);
    t.eq(sr.how, 'exact', 'the Saproling is printed');
    t.eq(words(sr).join('|'), '', 'each with no rules text');
    const withText = Object.assign({}, print, { name: 'Saproling', type_line: 'Token Creature — Saproling', colors: ['G'], oracle_text: 'Haste' });
    t.eq(TA().compare(F(saproling.card), F(withText)), '', 'a printed Saproling with an ability is not it');
  });

  test('Token art: a different size never matches; a printed */* stands in only when nothing matches exactly', (mk, t) => {
    const T = mk();
    const ooze = spec(T, { pt: '5/5', colorWords: ['green'], subtypes: 'Ooze' });
    const r = opts(ooze);
    t.eq(r.how, 'size', 'no 5/5 green Ooze is printed, the */* one is offered');
    t.ok(r.list.length > 0 && r.list.every(x => x.name === 'Ooze' && x.oracle_text === ''), 'a green Ooze with no abilities, as this one');
    const spirit = spec(T, { pt: '1/1', colorWords: ['white'], subtypes: 'Spirit' });
    t.eq(opts(spirit).how, 'exact', 'a 1/1 white Spirit has its own, so the */* one is not used');
    const two = spec(T, { pt: '2/2', colorWords: ['green'], subtypes: 'Saproling' });
    t.eq(opts(two).how, '', 'a 2/2 Saproling is no 1/1 Saproling: nothing, and so the drawn frame');
  });

  test('Token art: the picture is chosen per kind of token, kept on this device, and the old cache is not read', (mk, t) => {
    const T = mk();
    const MTG = engine();
    const tk = TA();
    MTG.store.set('tokenArt.v2', {});
    const o = fromCard(T, 'Lingering Souls');
    const k = tk.key(o.card);
    // with nothing found before (an entry saying none), the frame
    MTG.store.set('tokenArt.v3', { [k]: '' });
    tk._reset();
    t.eq(tk.url(o.card), null, 'no picture: the drawn frame');
    MTG.store.set('tokenArt.v3', { [k]: 'https://cards.scryfall.io/normal/front/a/b/spirit.jpg' });
    tk._reset();
    t.eq(tk.url(o.card), 'https://cards.scryfall.io/normal/front/a/b/spirit.jpg', 'the one found');
    tk.choose(o.card, 0, { url: 'https://cards.scryfall.io/normal/front/c/d/other.jpg' });
    t.eq(tk.url(o.card), 'https://cards.scryfall.io/normal/front/c/d/other.jpg', 'the one chosen');
    t.eq(tk.url(fromCard(T, 'Spectral Procession').card), 'https://cards.scryfall.io/normal/front/c/d/other.jpg', 'for every such token');
    t.eq(MTG.store.get('tokenArtChoice.v1', {})[k], 'https://cards.scryfall.io/normal/front/c/d/other.jpg', 'kept');
    const plain = fromCard(T, 'Great Arashin City');
    MTG.store.set('tokenArt.v3', Object.assign(MTG.store.get('tokenArt.v3', {}), { [tk.key(plain.card)]: '' }));
    tk._reset();
    t.eq(tk.url(plain.card), null, 'not for a Spirit without flying');
    tk.choose(o.card, 0, null);
    t.eq(tk.url(o.card), 'https://cards.scryfall.io/normal/front/a/b/spirit.jpg', 'back to the default');
    t.ok(tk.drawn(o.card), 'a token of the engine\'s is drawn (no picture of its own)');
    t.no(tk.drawn(card('Grizzly Bears')), 'a card is not');
    MTG.store.del('tokenArt.v3'); MTG.store.del('tokenArtChoice.v1'); MTG.store.del('tokenArt.v2');
    tk._reset();
  });
};
