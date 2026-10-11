/* ============================================================
   15b-themes.js - what a Commander deck is about, in a few words
   "+1/+1 counters · Lifegain · Tokens": the handful of things a deck
   leans on, read off its cards. Each theme is a few patterns over a
   card's rules text, type line and keywords; a deck's cards are counted
   against each one, its commander counting several times over (it is
   what the deck is built around), and the themes that pass their own
   bar are named, the most marked first. Card draw and ramp are in every
   deck, so their bars are high: they are named only where a deck has far
   more of them than usual.

   It reads Scryfall's cards (oracle_text, type_line, card_faces) and
   MTGJSON's (text, type), so the Store's printed Commander decks and
   your own read the same way. Also how popular a deck's commander is:
   its rank on EDHREC, the lower the more decks run it.
   ============================================================ */
'use strict';
(function (MTG) {
  /* Bump when the themes change: a deck list remembers its tags with the
     version that made them (src/11-ui-deck.js), and the Store's printed
     decks are read again by tools/precons.js. */
  const VERSION = 2;
  const COMMANDER_WEIGHT = 4;
  const MAX_TAGS = 5;

  /** A card's words, type, keywords and mana value, the same whichever source it came from. */
  function facts(c) {
    const faces = c.card_faces && c.card_faces.length ? c.card_faces : [c];
    const name = String(c.name || '');
    let text = faces.map(f => f.oracle_text != null ? f.oracle_text : f.text || '').join('\n');
    if (!text && c.text) text = c.text;
    // reminder text says what a keyword does, not what the deck does
    text = text.replace(/\([^)]*\)/g, '');
    // "When Llanowar Elves enters": the card's own name read as "this", so it is not taken for the elves it makes
    for (const n of new Set([name].concat(name.split(' // '), faces.map(f => f.name || '')))) {
      if (n && n.length > 2) text = text.split(n).join('this');
      const short = n.split(',')[0];
      if (short && short !== n && short.length > 3) text = text.split(short).join('this');
    }
    const type = String(c.type_line || faces.map(f => f.type_line || '').filter(Boolean).join(' // ') || c.type || '');
    const kw = new Set((c.keywords || []).map(k => String(k).toLowerCase()));
    const mv = Number(c.cmc != null ? c.cmc : c.manaValue != null ? c.manaValue : c.convertedManaCost) || 0;
    return { raw: text, text: text.toLowerCase(), type: type.toLowerCase(), typeLine: type, kw, mv };
  }

  const has = (f, re) => re.test(f.text);
  const isType = (f, word) => new RegExp('\\b' + word + '\\b').test(f.type);
  const anyKw = (f, list) => list.some(k => f.kw.has(k));
  const NON_CREATURE_TOKENS = /create[^.]*\b(treasure|food|clue|blood|map|gold|powerstone|incubator|junk|shard|lander)\b[^.]*token/;

  /* Each theme: its tag, the bar a deck's count must reach to be named, and
     what a card scores toward it (0 for nothing, 2 for a card that pays
     the theme off rather than only taking part). A theme whose name depends
     on what its cards are (Storm or Spell copying, Enchantress or
     Enchantments) says so with `kind`, and its label reads the kinds counted. */
  const THEMES = [
    { id: 'counters', label: '+1/+1 counters', bar: 11, score: (f) =>
      has(f, /(whenever|for each|with) [^.]*\+1\/\+1 counter|double the number of|proliferate|counters? on it[^.]*instead/) ? 2
        : has(f, /\+1\/\+1 counter/) || anyKw(f, ['proliferate', 'evolve', 'adapt', 'modular', 'graft', 'bolster', 'support', 'outlast', 'training', 'mentor', 'riot', 'backup']) ? 1 : 0 },
    { id: 'minus', label: '-1/-1 counters', bar: 6, score: (f) => has(f, /-1\/-1 counter/) || anyKw(f, ['wither', 'persist']) ? 1 : 0 },
    { id: 'poison', label: 'Infect & poison', bar: 6, score: (f) => anyKw(f, ['infect', 'toxic', 'poisonous']) || has(f, /poison counter/) ? 1 : 0 },
    { id: 'lifegain', label: 'Lifegain', bar: 9, score: (f) =>
      has(f, /whenever you gain life|if you would gain life|life you gained|you've gained life/) ? 2
        : has(f, /\byou gain \w+ life|\bgain \w+ life|\bgains? that much life|\blifelink\b/) || f.kw.has('lifelink') ? 1 : 0 },
    { id: 'tokens', label: 'Tokens', bar: 10, score: (f) =>
      has(f, /whenever (one or more )?(a )?(creature )?tokens?|tokens you control|for each [^.]*token|populate/) ? 2
        : has(f, /\bcreates? [^.]*\btokens?\b/) && !NON_CREATURE_TOKENS.test(f.text) || anyKw(f, ['populate', 'amass', 'fabricate', 'afterlife', 'myriad', 'encore']) ? 1 : 0 },
    // anthems: the whole team made bigger at once
    { id: 'gowide', label: 'Go wide', bar: 7, score: (f) =>
      has(f, /(other )?creatures you control get \+\d|creatures you control get \+x|each (other )?creature you control gets \+/) || f.kw.has('battle cry') ? 1 : 0 },
    { id: 'treasure', label: 'Treasure', bar: 7, score: (f) => has(f, /treasures? you control|whenever [^.]*treasure|sacrifice a treasure/) ? 2 : has(f, /\btreasure tokens?\b/) ? 1 : 0 },
    { id: 'storm', label: (k) => (k.storm ? 'Storm' : 'Spell copying'), bar: 5,
      kind: (f) => (f.kw.has('storm') ? 'storm' : null), score: (f) =>
      f.kw.has('storm') || has(f, /\bcopy (target|that|it|each) [^.]*\b(instant|sorcery|spell)|copies of (it|that spell)|magecraft|whenever you cast or copy/) || f.kw.has('magecraft') ? 1 : 0 },
    { id: 'spells', label: 'Instants & sorceries', bar: 26, score: (f) =>
      has(f, /instant (or|and) sorcery spell|instant or sorcery card|instants? and sorcer(y|ies)|noncreature spell/) || anyKw(f, ['prowess', 'magecraft']) ? 2
        : isType(f, 'instant') || isType(f, 'sorcery') ? 1 : 0 },
    { id: 'cascade', label: 'Cascade', bar: 4, score: (f) => f.kw.has('cascade') || has(f, /\bcascade\b/) ? 1 : 0 },
    { id: 'recursion', label: 'Recursion', bar: 8, score: (f) =>
      has(f, /return[^.]*card[^.]*from your graveyard to your hand|you may (cast|play) [^.]*from your graveyard|return[^.]*(artifact|enchantment|permanent|land) card[^.]*from your graveyard to the battlefield/)
        || anyKw(f, ['unearth', 'embalm', 'eternalize', 'escape', 'disturb', 'encore', 'undying', 'persist', 'retrace', 'jump-start', 'flashback']) ? 1 : 0 },
    // creatures brought back to the battlefield, not to hand
    { id: 'reanimator', label: 'Reanimator', bar: 6, score: (f) =>
      has(f, /(return|put)[^.]*creature cards? [^.]*from (your|a|any|their|an opponent's) graveyards? (to|onto) the battlefield|reanimate/) ? 1 : 0 },
    { id: 'graveyard', label: 'Graveyard', bar: 9, score: (f) =>
      has(f, /cards? in your graveyard|from your graveyard|\bmill\b|\bmills\b|leaves your graveyard|put into your graveyard from/) || anyKw(f, ['mill', 'surveil', 'dredge', 'delirium', 'threshold', 'descend']) ? 1 : 0 },
    { id: 'sacrifice', label: 'Sacrifice', bar: 9, score: (f) =>
      has(f, /whenever you sacrifice/) ? 2
        : has(f, /\bsacrifice (a|another|an|two|three|x|any number of) [^.]*?(creature|artifact|permanent|token)/) || anyKw(f, ['exploit', 'casualty', 'devour', 'emerge']) ? 1 : 0 },
    // a creature's death drains the table, or pays off some other way
    { id: 'aristocrats', label: 'Aristocrats', bar: 6, score: (f) =>
      has(f, /whenever (a|another|one or more) (other )?(nontoken )?creatures? (you control )?(dies|die)[^.]*(loses? \w+ life|deals? \w+ damage|draw)/) ? 2
        : has(f, /whenever (a|another|one or more) (other )?(nontoken )?creatures? (you control )?(dies|die)/) ? 1 : 0 },
    { id: 'blink', label: 'Blink', bar: 6, score: (f) =>
      has(f, /exile [^.]*(you control|you own)[^.]*(then )?return (it|that card|them|those cards) to the battlefield|exile [^.]*, then return [^.]* to the battlefield/) ? 2
        : has(f, /return (it|that card|them|the exiled card) to the battlefield under (its owner's|your) control at the beginning of the next end step/) ? 1 : 0 },
    { id: 'clones', label: 'Clones', bar: 5, score: (f) =>
      has(f, /enters? as a copy of|becomes? a copy of|create a token that's a copy of (target|another|a|that) (creature|permanent|nonlegendary)/) ? 1 : 0 },
    // lands entering: landfall
    { id: 'landfall', label: 'Landfall', bar: 7, score: (f) =>
      f.kw.has('landfall') || has(f, /whenever (a|one or more) lands? (you control )?enters?/) ? 1 : 0 },
    // more lands than one a turn, from the graveyard or the top of the library
    { id: 'landdrops', label: 'Extra land drops', bar: 6, score: (f) =>
      has(f, /play (an|two|any number of) additional lands?|you may play lands from|land cards? from your graveyard|play lands from your graveyard|put a land card from your hand onto the battlefield/) ? 1 : 0 },
    { id: 'artifacts', label: 'Artifacts', bar: 24, score: (f) =>
      has(f, /whenever (you cast an|an|another|one or more) artifacts?|artifacts? you control|for each artifact|artifact spells?/) || f.kw.has('affinity') || f.kw.has('improvise') ? 2
        : isType(f, 'artifact') && !isType(f, 'land') ? 1 : 0 },
    { id: 'enchantments', label: (k) => (k.enchantress >= 3 ? 'Enchantress' : 'Enchantments'), bar: 18,
      kind: (f) => (has(f, /whenever you cast an enchantment spell|whenever an enchantment (you control )?enters|enchantment[^.]*, draw a card/) || f.kw.has('constellation') ? 'enchantress' : null),
      score: (f) =>
      has(f, /whenever (you cast an|an|another) enchantment|enchantments? you control|for each enchantment|enchantment spells?/) || f.kw.has('constellation') ? 2
        : isType(f, 'enchantment') ? 1 : 0 },
    { id: 'voltron', label: (k) => (k.aura > k.equipment * 2 ? 'Auras' : k.equipment > k.aura * 2 ? 'Equipment' : 'Equipment & Auras'), bar: 11,
      kind: (f) => (isType(f, 'equipment') ? 'equipment' : isType(f, 'aura') ? 'aura' : null), score: (f) =>
      has(f, /equipped creature|enchanted creature gets|whenever [^.]* becomes equipped|equipment you control|auras? you control|attach/) && !isType(f, 'creature') || isType(f, 'equipment') || isType(f, 'aura') && has(f, /enchanted creature (gets|has)/) ? 1 : 0 },
    { id: 'vehicles', label: 'Vehicles', bar: 6, score: (f) => isType(f, 'vehicle') || f.kw.has('crew') || has(f, /\bvehicles?\b/) ? 1 : 0 },
    // planeswalkers, and what pays them off: not "creatures and planeswalkers you control", which every protection spell says
    { id: 'superfriends', label: 'Superfriends', bar: 9, score: (f) =>
      has(f, /loyalty abilit|loyalty counters? on (each|target|it|that)|planeswalker spells?|whenever you (cast|activate)[^.]*planeswalker/) ? 2 : isType(f, 'planeswalker') ? 1 : 0 },
    { id: 'fliers', label: 'Fliers', bar: 16, score: (f) => isType(f, 'creature') && f.kw.has('flying') || has(f, /creatures? with flying (you control|get)/) ? 1 : 0 },
    { id: 'combat', label: 'Attacking', bar: 13, score: (f) =>
      has(f, /additional combat phase|whenever (you attack|one or more creatures you control attack)|attacking creatures you control get/) ? 2
        : has(f, /whenever [^.]* attacks|\battacking creature/) || anyKw(f, ['battle cry', 'myriad', 'melee', 'exalted', 'dethrone', 'annihilator']) ? 1 : 0 },
    { id: 'bigspells', label: 'Big spells', bar: 11, score: (f) => !isType(f, 'land') && f.mv >= 7 ? 1 : 0 },
    { id: 'burn', label: 'Direct damage', bar: 10, score: (f) =>
      has(f, /deals? (\d+|x|that much) damage to (each opponent|each player|any target|target player|target opponent)|deals damage to each opponent/) ? 1 : 0 },
    { id: 'drain', label: 'Drain', bar: 7, score: (f) => has(f, /each opponent loses \w+ life|target opponent loses \w+ life|loses \w+ life and you gain/) ? 1 : 0 },
    { id: 'counterspells', label: 'Counterspells', bar: 7, score: (f) => has(f, /\bcounter target\b[^.]*spell|\bcounter (it|that spell)\b/) ? 1 : 0 },
    { id: 'theft', label: 'Theft', bar: 6, score: (f) => has(f, /gain control of|cast [^.]*(spells?|cards?) (you don't own|an opponent owns)|exile[^.]*an opponent[^.]*you may cast|spells? you cast but don't own/) ? 1 : 0 },
    { id: 'goad', label: 'Goad', bar: 4, score: (f) => f.kw.has('goad') || has(f, /\bgoad/) ? 1 : 0 },
    // gifts for the whole table: everyone draws, everyone ramps
    { id: 'grouphug', label: 'Group hug', bar: 5, score: (f) =>
      has(f, /each player (draws|may draw|adds|may put a land|gains \w+ life|creates)|target (player|opponent) draws|each opponent (draws|may draw)|that player (draws|may draw|creates)|\bgifts? an? |an opponent of your choice draws/) || anyKw(f, ['gift']) ? 1 : 0 },
    { id: 'pillowfort', label: 'Pillow fort', bar: 5, score: (f) =>
      has(f, /creatures can't attack you|can't attack you or planeswalkers you control unless|prevent all combat damage that would be dealt to you|attacks? you[^.]*pays? \{/) ? 1 : 0 },
    { id: 'stax', label: 'Stax', bar: 5, score: (f) =>
      has(f, /(players|your opponents|each opponent|each player) can't (cast|search|draw|untap|activate|gain life|play)|spells (your opponents cast )?cost \{\d\} more|don't untap during their controllers'|can't cast more than one spell each turn|enter the battlefield tapped|enter tapped/) && !isType(f, 'land') ? 1 : 0 },
    { id: 'wheels', label: 'Wheels', bar: 3, score: (f) =>
      has(f, /each player (discards|shuffles) (their|his or her) hand[^.]*(then )?draws?|draws? seven cards|each player draws (seven|that many)/) ? 1 : 0 },
    { id: 'extraturns', label: 'Extra turns', bar: 3, score: (f) => has(f, /take an extra turn|takes? an extra turn after this one/) ? 1 : 0 },
    { id: 'discard', label: 'Discard', bar: 6, score: (f) => has(f, /(each|target) (opponent|player) discards|each opponent discards/) ? 1 : 0 },
    { id: 'mill', label: 'Mill', bar: 6, score: (f) => has(f, /(target|each) (player|opponent)s? mills?|target player puts the top/) ? 1 : 0 },
    { id: 'impulse', label: 'Exile and cast', bar: 8, score: (f) => has(f, /exile the top [^.]*(you may (play|cast)|until (the )?end of (your next|the next|this) turn)|you may (play|cast) (that card|those cards|it) (this turn|until)/) ? 1 : 0 },
    { id: 'draw', label: 'Card draw', bar: 22, score: (f) => has(f, /whenever [^.]*draw|draw (a|an additional|two|three|four|x|that many) cards?/) ? 1 : 0 },
    { id: 'ramp', label: 'Ramp', bar: 20, score: (f) => !isType(f, 'land') && (has(f, /\badd \{|\badd (one|two|three|x) mana|\badds? [^.]*mana of any|search your library for [^.]*\blands?\b[^.]*battlefield|put [^.]*land cards? [^.]*onto the battlefield/)) ? 1 : 0 },
  ];
  /* Themes that say much the same thing: the stronger of the two is named. */
  const SAME = [['recursion', 'graveyard'], ['reanimator', 'graveyard'], ['sacrifice', 'aristocrats'], ['ramp', 'treasure']];

  /* A creature type as a deck would name it: Elves, Wolves, Sphinxes. */
  const PLURAL = { Elf: 'Elves', Dwarf: 'Dwarves', Wolf: 'Wolves', Werewolf: 'Werewolves', Fungus: 'Fungi', Mouse: 'Mice', Ox: 'Oxen',
    Octopus: 'Octopuses', Cyclops: 'Cyclopes', Sphinx: 'Sphinxes', Fox: 'Foxes', Thopter: 'Thopters', Dryad: 'Dryads', Elk: 'Elk',
    Sheep: 'Sheep', Fish: 'Fish', Squid: 'Squid', Moonfolk: 'Moonfolk', Kithkin: 'Kithkin', Merfolk: 'Merfolk', Djinn: 'Djinn',
    Leviathan: 'Leviathans', Phoenix: 'Phoenixes', Ninja: 'Ninjas', Samurai: 'Samurai', Kor: 'Kor', Vedalken: 'Vedalken', Aetherborn: 'Aetherborn', Hero: 'Heroes',
    Eldrazi: 'Eldrazi', Jellyfish: 'Jellyfish', Badger: 'Badgers', Viashino: 'Viashino', Azra: 'Azra', Licid: 'Licids' };
  const plural = (t) => PLURAL[t] || (/(s|x|ch|sh)$/.test(t) ? t + 'es' : /[^aeiou]y$/.test(t) ? t.slice(0, -1) + 'ies' : t + 's');
  // the creature types of more than one word, kept whole
  const TWO_WORD = /\bTime Lord\b/g;
  const subtypes = (typeLine) => typeLine.split(' // ').filter(p => /creature|kindred|tribal/i.test(p))
    .flatMap(p => (p.split(/\s+[—-]\s+/)[1] || '').replace(TWO_WORD, (m) => m.replace(' ', '_')).split(/\s+/))
    .filter(Boolean).map(s => s.replace('_', ' '));
  // too common to be a deck's plan unless the deck says so loudly
  const COMMON_TYPE_BAR = { Human: true };
  const TYPAL_BAR = 11;

  /**
   * The themes a deck leans on, strongest first: [{ id, label, score, ratio }],
   * at most `max` of them (5). `deck`: { commanders: [card], main: [{ card, qty }] }.
   * Kept on the deck object, so asking again costs nothing.
   */
  const cache = new WeakMap();
  function themes(deck, max) {
    max = max || MAX_TAGS;
    if (!deck) return [];
    const hit = cache.get(deck);
    if (hit && hit.max === max) return hit.out;
    const counts = new Map(THEMES.map(t => [t.id, 0]));
    const kinds = new Map(THEMES.map(t => [t.id, {}]));
    const typeCount = new Map(), cmdTypes = new Set();
    const rows = [].concat((deck.commanders || []).filter(Boolean).map(c => ({ card: c, qty: 1, cmd: true })),
      (deck.main || []).filter(e => e && e.card).map(e => ({ card: e.card, qty: e.qty || 1 })));
    const read = rows.map(r => ({ r, f: facts(r.card) }));
    for (const { r, f } of read) {
      if (/\bbasic\b/.test(f.type) && isType(f, 'land')) continue;
      const w = r.cmd ? COMMANDER_WEIGHT : r.qty;
      for (const t of THEMES) {
        const s = t.score(f);
        if (s) counts.set(t.id, counts.get(t.id) + s * w);
        const k = t.kind && t.kind(f);
        if (k) { const m = kinds.get(t.id); m[k] = (m[k] || 0) + r.qty; }
      }
      for (const st of subtypes(f.typeLine)) {
        typeCount.set(st, (typeCount.get(st) || 0) + (r.cmd ? 1 : r.qty));
        if (r.cmd) cmdTypes.add(st);
      }
    }
    // a creature type is a theme when the deck is full of it and its cards talk about it
    const typal = [];
    for (const [st, n] of typeCount) {
      if (n < 6) continue;
      const word = new RegExp('\\b(' + st + '|' + plural(st) + ')\\b');
      let said = 0;
      for (const { r, f } of read) if (word.test(f.raw)) said += r.cmd ? COMMANDER_WEIGHT : 1;
      const need = COMMON_TYPE_BAR[st] ? said >= 8 : said >= 3;
      if (need) typal.push({ id: 'type:' + st, label: plural(st), score: n, ratio: n / TYPAL_BAR + (cmdTypes.has(st) ? 0.1 : 0) });
    }
    const all = THEMES.map(t => ({ id: t.id, label: typeof t.label === 'function' ? t.label(Object.assign({ storm: 0, enchantress: 0, aura: 0, equipment: 0 }, kinds.get(t.id))) : t.label,
      score: counts.get(t.id), ratio: counts.get(t.id) / t.bar }))
      .concat(typal)
      .sort((a, b) => b.ratio - a.ratio);
    let out = all.filter(t => t.ratio >= 1);
    // no more than one creature type, and two themes that say the same thing said once
    const firstType = out.find(t => t.id.startsWith('type:'));
    out = out.filter(t => !t.id.startsWith('type:') || t === firstType);
    for (const [a, b] of SAME) {
      const ia = out.findIndex(t => t.id === a), ib = out.findIndex(t => t.id === b);
      if (ia >= 0 && ib >= 0) out.splice(Math.max(ia, ib), 1);
    }
    // a deck with one clear theme still gets a second word when one comes close
    if (out.length < 2) for (const t of all) { if (out.length >= 2) break; if (t.ratio >= 0.7 && !out.includes(t) && !t.id.startsWith('type:')) out.push(t); }
    out = out.slice(0, max);
    cache.set(deck, { max, out });
    return out;
  }

  /** The tags alone, as words. */
  const tags = (deck, max) => themes(deck, max).map(t => t.label);

  /**
   * How popular a deck's commander is by Scryfall's word: its EDHREC rank
   * among all cards (lower is more popular), the better of two partners';
   * Infinity when none is known. The Store orders its printed decks by
   * EDHREC's own list of commanders instead, where it has them
   * (tools/precons.js); this is what is left when it does not.
   */
  function rank(commanders) {
    let best = Infinity;
    for (const c of commanders || []) {
      const r = c && (c.edhrec_rank != null ? c.edhrec_rank : c.edhrecRank);
      if (r != null && r > 0 && r < best) best = r;
    }
    return best;
  }

  /** A deck's colour identity, in WUBRG order, from its commanders: "WU", "" for colourless. */
  function identity(commanders) {
    const got = new Set();
    for (const c of commanders || []) for (const x of (c && (c.color_identity || c.colorIdentity)) || []) got.add(x);
    return ['W', 'U', 'B', 'R', 'G'].filter(x => got.has(x)).join('');
  }

  /**
   * Printed decks, each name once. A deck printed again (Commander
   * Anthology Volume II reprinting Commander 2014's Built From Scratch) is
   * shown as its latest printing, with that printing's set and art; decks
   * are the same when their names are, whatever the case of the letters.
   * `list`: [{ name, date }] in any order, which is kept.
   */
  function distinct(list) {
    const latest = new Map();
    const keyOf = (d) => String(d.name || '').toLowerCase().trim();
    for (const d of list) {
      const k = keyOf(d);
      if (!latest.has(k) || String(d.date || '') > String(latest.get(k).date || '')) latest.set(k, d);
    }
    return list.filter(d => latest.get(keyOf(d)) === d);
  }

  MTG.themes = { VERSION, THEMES, facts, themes, tags, rank, identity, plural, distinct };
})(window.MTG);
