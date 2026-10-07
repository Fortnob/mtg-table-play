/* ============================================================
   03-oracle.js - Oracle text understanding ("hybrid automation")
   Turns Scryfall oracle_text into structured abilities the engine can
   execute. Anything it cannot confidently parse is flagged manual:true
   and the players resolve it with the assisted tools, exactly like
   a real tabletop game.
   ============================================================ */
'use strict';
(function (MTG) {
  const U = MTG.util;
  const MANA = MTG.mana;

  /* ---------------- type line ---------------- */
  const SUPERTYPES = ['Basic', 'Legendary', 'Ongoing', 'Snow', 'World', 'Host', 'Elite'];
  const CARD_TYPES = ['Artifact', 'Battle', 'Conspiracy', 'Creature', 'Dungeon', 'Enchantment',
    'Instant', 'Kindred', 'Tribal', 'Land', 'Phenomenon', 'Plane', 'Planeswalker',
    'Scheme', 'Sorcery', 'Vanguard', 'Emblem', 'Token'];

  function parseTypeLine(line) {
    const res = { supertypes: [], types: [], subtypes: [], raw: line || '' };
    if (!line) return res;
    // only look at the front face for a "//" type line
    const front = line.split('//')[0].trim();
    const [left, right] = front.split(/\s+[—-]\s+/);
    for (const w of (left || '').split(/\s+/)) {
      if (!w) continue;
      if (SUPERTYPES.includes(w)) res.supertypes.push(w);
      else if (CARD_TYPES.includes(w)) res.types.push(w);
      else if (w !== '//') res.types.push(w);
    }
    if (right) res.subtypes = right.split(/\s+/).filter(Boolean);
    return res;
  }

  /* ---------------- keyword abilities ---------------- */
  // Keywords the engine actually implements in combat / SBA / casting.
  const IMPLEMENTED_KEYWORDS = new Set([
    // evasion, combat and static keywords the rules engine enforces
    'Flying', 'First strike', 'Double strike', 'Deathtouch', 'Lifelink', 'Menace',
    'Reach', 'Trample', 'Vigilance', 'Haste', 'Defender', 'Indestructible',
    'Hexproof', 'Shroud', 'Flash', 'Fear', 'Intimidate', 'Skulk', 'Horsemanship', 'Landwalk',
    'Shadow', 'Changeling', 'Devoid', 'Protection', 'Ward', 'Infect',
    // triggered / replacement keywords the engine now runs
    'Prowess', 'Exalted', 'Battle cry', 'Melee', 'Mentor', 'Training', 'Evolve',
    'Afflict', 'Annihilator', 'Undying', 'Persist', 'Modular', 'Riot', 'Extort', 'Graft', 'Backup', 'Phasing', 'Devour', 'Recover', 'Ravenous', 'Provoke', 'Read ahead',
    'Bloodthirst', 'Cascade', 'Storm', 'Amass', 'Convoke', 'Improvise', 'Delve',
    'Affinity', 'Toxic', 'Myriad', 'Enlist',
    // keywords the engine now runs on its own
    'Afterlife', 'Fabricate', 'Mobilize', 'Firebending', 'Living metal',
    'Totem armor', 'Umbra armor',
    // speed: it starts the engine, and the engine keeps count
    'Start your engines!',
    // combat keywords the engine now keeps
    'Flanking', 'Wither',
    // they turn over with day and night
    'Daybound', 'Nightbound',
    // a draw replaced by digging a card back out of the graveyard
    'Dredge',
    // hidden under the land as it enters, played for free later
    'Hideaway',
    // a spell that encodes itself on a creature and is cast again from there
    'Cipher',
    // a +1/+1 counter for going after the player with the most life
    'Dethrone',
    // two creatures paired while one player controls both
    'Soulbond',
    // counters for creature cards of its type revealed from hand
    'Amplify',
    // a counter for each colour of mana spent to cast it
    'Sunburst',
    // it can't block, and goes at end of combat after it attacks
    'Decayed',
  ]);
  const IMPLEMENTED_LOWER = new Set(Array.from(IMPLEMENTED_KEYWORDS).map(k => k.toLowerCase()));
  /* A keyword the engine can honour when it is handed out: one of the
     above, or ward with its price ("ward {2}", "ward—pay 2 life"). */
  /* Keywords that work because the card's own reading builds them an
     ability (provoke, graft, backup …): handed to another permanent, there
     is no such ability on it, so they can't be handed out yet. */
  const PRINTED_ONLY = new Set(['provoke', 'graft', 'backup', 'devour', 'recover', 'ravenous']);
  function kwKnown(k) {
    const w = String(k || '').trim();
    if (PRINTED_ONLY.has(w.toLowerCase().replace(/\s+\d+$/, ''))) return false;
    // toxic N handed out: the engine adds every instance up
    if (/^toxic \d+$/i.test(w)) return true;
    return IMPLEMENTED_LOWER.has(w.toLowerCase()) || /^ward\s*(?:(?:\{[^}]+\})+|(?:\u2014|-)\s*pay \d+ life)$/i.test(w) ||
      /^(?:plains|island|swamp|mountain|forest|nonbasic land|desert)walk$/i.test(w);
  }
  // Keywords that change how a card may be cast/played.
  /* The cast keywords the engine actually honours when you go to cast the
     card — the rest are printed on the card and resolved by hand. */
  const RUN_CAST_KEYWORDS = new Set(['Flash', 'Convoke', 'Improvise', 'Delve', 'Affinity',
    'Flashback', 'Escape', 'Aftermath', 'Jump-start', 'Disturb', 'Unearth', 'Embalm',
    'Eternalize', 'Foretell', 'Cycling',
    /* paid on the way down: an extra cost you may pay as the spell is cast,
       and the card's own text asks afterwards whether you did */
    'Kicker', 'Multikicker', 'Buyback', 'Entwine',
    // cheaper ways in, each with a string attached
    'Evoke', 'Dash',
    // for less, once an opponent has lost life this turn
    'Spectacle',
    // face down for three, and up again for the printed cost
    'Morph', 'Megamorph', 'Disguise',
    // discarded, and cast from there instead
    'Madness',
    // a creature that can arrive as an Aura instead
    'Bestow',
    // cheap and fast, and gone by the end of the turn
    'Blitz',
    // played from the graveyard for the printed cost, plus a card
    'Retrace',
    // cast during the declare blockers step, an unblocked attacker returned to hand
    'Sneak',
    // set aside now, cast later
    'Plot', 'Suspend', 'Warp',
    // thrown away to go and find something that costs the same
    'Transmute',
    // copies bought on the way down
    'Offspring', 'Squad', 'Casualty',
    // and one last swing from the graveyard
    'Encore',
    // back from the graveyard the turn it was discarded, or for a harmony of creatures
    'Mayhem', 'Harmonize',
    // something given up as it is cast, for a better spell
    'Bargain',
    // an unblocked attacker swapped for a Ninja
    'Ninjutsu',
    // modes, each with a price of its own
    'Spree',
    // cast onto another creature, and the two become one
    'Mutate',
    // a cheaper way in once your Assassin has connected
    'Freerunning',
    // nothing can answer it
    'Split second',
    // cast again from exile at your next upkeep
    'Rebound',
    /* asked as the spell is cast, as generic questions (docs/choices.md):
       how many copies, which cards' words to add, which creatures to tap */
    'Replicate', 'Splice', 'Conspire',
    /* another player may pay part of it (CR 702.132): an offer, and with
       nobody making it the spell is cast as printed */
    'Assist']);

  const CAST_KEYWORDS = new Set(['Flash', 'Split second', 'Convoke', 'Improvise', 'Delve', 'Affinity',
    'Kicker', 'Multikicker', 'Entwine', 'Escalate', 'Overload', 'Buyback', 'Flashback',
    'Aftermath', 'Jump-start', 'Retrace', 'Madness', 'Miracle', 'Foretell', 'Disturb',
    'Evoke', 'Prowl', 'Surge', 'Spectacle', 'Awaken', 'Bestow', 'Emerge', 'Casualty',
    'Cleave', 'Blitz', 'Dash', 'Embalm', 'Eternalize', 'Unearth', 'Adventure', 'Suspend',
    'Cycling', 'Transmute', 'Morph', 'Megamorph', 'Disguise', 'Prototype', 'Impending',
    'Offering', 'Splice', 'Spree', 'Gift', 'Plot', 'Freerunning', 'Warp',
    'Retrace', 'Offspring', 'Squad', 'Encore', 'Mutate', 'Escape', 'Mayhem', 'Harmonize', 'Bargain', 'Ninjutsu',
    'Replicate', 'Conspire', 'Assist', 'Sneak']);

  /* Keyword names are title-cased before they are looked up, which turns
     "Split second" into "Split Second". Compare in lower case so a keyword
     of more than one word is not quietly lost. */
  const CAST_LOWER = new Set(Array.from(CAST_KEYWORDS).map(k => k.toLowerCase()));
  const RUN_CAST_LOWER = new Set(Array.from(RUN_CAST_KEYWORDS).map(k => k.toLowerCase()));

  const KEYWORD_PATTERNS = [
    // simple flags, matched as whole comma-separated clauses
    /^(Increment|Flying|First strike|Double strike|Deathtouch|Lifelink|Menace|Reach|Trample|Vigilance|Haste|Defender|Indestructible|Hexproof|Shroud|Flash|Fear|Intimidate|Skulk|Horsemanship|Shadow|Changeling|Devoid|Exalted|Battle cry|Melee|Myriad|Undying|Persist|Infect|Wither|Ingest|Prowess|Extort|Cascade|Storm|Conspire|Delirium|Landfall|Riot|Afterlife|Mentor|Afflict|Amass|Boast|Daybound|Nightbound|Decayed|Disturb|Training|Compleated|Toxic|Backup|Bargain|Craft|Delve|Convoke|Improvise|Annihilator|Banding|Soulbond|Soulshift|Rampage|Provoke|Renown|Rebound|Recover|Replicate|Ripple|Scavenge|Soulbond|Sunburst|Totem armor|Vanishing|Fading|Graft|Modular|Sunburst|Echo|Haunt|Hideaway|Absorb|Bushido|Flanking|Bloodthirst|Champion|Devour|Evolve|Extort|Fabricate|Ferocious|Formidable|Frenzy|Gravestorm|Kinship|Living weapon|Poisonous|Reinforce|Tribute|Unleash|Vigilance|Wither|Enrage|Mutate|Companion|Encore|Demonstrate|Squad|Read ahead|Ravenous|Prototype|Toxic|Corrupted|For Mirrodin!|Bargain|Valiant|Saddle|Station|Mobilize|Job select|Max speed|Start your engines!|Exhaust|Harmonize|Eerie|Manifest dread|Survival|Threshold|Hellbent|Metalcraft|Morbid|Revolt|Spell mastery|Fateful hour|Will of the council|Council's dilemma|Melee|Partner|Friends forever|Choose a Background|Doctor's companion|Eternalize|Embalm|Foretell|Boast|Cleave|Casualty|Blitz|Connive|Enlist|Hideaway|Alliance|Celebration|Descend|Fathomless descent|Corrupted|Coven|Blood|Investigate|Clue|Food|Treasure|Incubate|Map|Junk|Offspring|Impending|Manifest|Flurry|Living metal|Umbra armor|Retrace|Jump-start|Split second|Spaceflight|Phasing|Cipher|Spree|Assist|Dethrone)$/i,
    // parameterised keywords with a number
    /^(Annihilator|Bushido|Modular|Rampage|Vanishing|Fading|Graft|Soulshift|Poisonous|Devour|Ripple|Bloodthirst|Amass|Afflict|Toxic|Squad|Casualty|Backup|Reinforce|Renown|Tribute|Frenzy|Absorb|Crew|Ward|Shield|Flanking|Dredge|Suspend|Storm|Cascade|Exhaust|Saddle|Station|Fabricate|Afterlife|Mobilize|Firebending|Repair|Teamwork|Hideaway|Amplify)\s+\d+$/i,
    // parameterised keywords with a cost
    /^(Kicker|Multikicker|Echo|Cycling|Flashback|Buyback|Madness|Morph|Megamorph|Disguise|Unearth|Embalm|Eternalize|Evoke|Bestow|Dash|Blitz|Emerge|Entwine|Escape|Foretell|Miracle|Overload|Prowl|Recover|Replicate|Retrace|Scavenge|Spectacle|Surge|Transmute|Splice|Awaken|Aftermath|Jump-start|Level up|Outlast|Monstrosity|Adapt|Channel|Transfigure|Ninjutsu|Prototype|Freerunning|Warp|Impending|Plot|Disturb|Cleave|Bargain|Craft|Forecast|Offering|Provoke|Offspring|Encore|Squad|Meditate|Mutate|Mayhem|Harmonize|Sneak)(?:\s+|\s*\u2014\s*)\S.*$/i,
  ];

  function splitKeywordLine(line) {
    // "Flying, first strike, trample" -> three
    return line.split(/,\s*(?![^(]*\))/).map(s => s.trim()).filter(Boolean);
  }

  function matchKeyword(clause) {
    const c = clause.replace(/\s*\([^)]*\)\s*$/, '').trim();   // strip reminder text
    for (const re of KEYWORD_PATTERNS) {
      const m = c.match(re);
      if (m) {
        const base = U.titleCase(m[1]);
        /* "Escape—{2}{B}, …" hangs its cost off a dash rather than a
           space; the dash is punctuation, not part of the cost. */
        const arg = c.slice(m[1].length).replace(/^\s*\u2014\s*/, '').trim();
        return { keyword: base, arg: arg || null, text: c };
      }
    }
    // Protection from X / Ward - N
    let m = c.match(/^Protection from (.+)$/i);
    if (m) return { keyword: 'Protection', arg: m[1], text: c };
    m = c.match(/^Ward\s*[—-]?\s*(.+)$/i);
    if (m) return { keyword: 'Ward', arg: m[1], text: c };
    m = c.match(/^Landwalk$|^(\w+)walk$/i);
    if (m) return { keyword: 'Landwalk', arg: m[1], text: c };
    /* Typecycling: "Mountaincycling {2}", "Basic landcycling {2}" — cycling
       that fetches the land instead of drawing. */
    m = c.match(/^((?:basic land|plains|island|swamp|mountain|forest|land|wizard|slith|dragon|cleric|[a-z]+)cycling)\s+(\{[^}]+\}(?:\{[^}]+\})*|\d+)$/i);
    if (m) return { keyword: U.titleCase(m[1]), arg: m[2], text: c };
    /* "Suspend 4—{1}{R}": a number of turns and a price, in one clause. */
    m = c.match(/^(Suspend)\s+(\d+\s*[\u2014-]\s*(?:\{[^}]+\})+)$/i);
    if (m) return { keyword: 'Suspend', arg: m[2], text: c };
    return null;
  }

  /** "three" and "3" both mean 3, and "a" means one. */
  const WORDN = (w) => {
    const words = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5,
      six: 6, seven: 7, eight: 8, nine: 9, ten: 10, x: 1, another: 1 };
    const k = String(w || '').trim().toLowerCase();
    return words[k] != null ? words[k] : (parseInt(k, 10) || 1);
  };

  /* ---------------- cost parsing ---------------- */
  // Splits an activated-ability cost like "{2}{U}, {T}, Sacrifice a creature"
  function parseCost(str) {
    const cost = { mana: '', tap: false, untap: false, sacSelf: false, sacrifice: null,
      discard: null, life: 0, exile: null, removeCounters: null, other: [], raw: str };
    if (!str) return cost;
    /* "Boast — {1}{R}", "Exhaust — {2}{G}", "Renew — {2}{B}, Exile this
       card from your graveyard": a label that says when the ability may be
       used, in front of an ordinary cost. */
    const lab = String(str).match(/^(Boast|Exhaust|Renew|Power-up)\s*(?:\u2014|--|-)\s*(.+)$/i);
    if (lab) { cost.label = lab[1].toLowerCase(); str = lab[2]; }
    const parts = str.split(/,\s*(?![^{]*\})/);
    for (let p of parts) {
      p = p.trim();
      if (!p) continue;
      p = p.replace(/^Pay\s+(?=\{)/i, '');       // "Pay {2}" is just {2}
      // "Pay eight {E}": energy, counted in words
      const en = p.match(/^Pay (one|two|three|four|five|six|seven|eight|nine|ten|\d+) \{E\}$/i);
      if (en) { cost.energy = (cost.energy || 0) + num(en[1]); continue; }
      if (/^(\{[^}]+\})+$/.test(p)) {
        const syms = MANA.parse(p);
        const manaSyms = syms.filter(s => s !== 'T' && s !== 'Q' && s !== 'E');
        if (syms.includes('T')) cost.tap = true;
        if (syms.includes('Q')) cost.untap = true;
        // "Pay {E}{E}": energy, not mana, and not free either
        const energy = syms.filter(s => s === 'E').length;
        if (energy) cost.energy = (cost.energy || 0) + energy;
        if (manaSyms.length) cost.mana += manaSyms.map(s => '{' + s + '}').join('');
        continue;
      }
      let m;
      // "Sacrifice this", "Sacrifice this artifact", "Sacrifice CARDNAME" —
      // all of them mean the permanent whose ability this is
      if (/^Sacrifice (this|~|it|CARDNAME)\b/i.test(p)) { cost.sacSelf = true; continue; }
      if ((m = p.match(/^Sacrifice (a|an|another|one|two|three|four|five|six|ten|\d+|X) (other )?(.+)$/i))) {
        const word = m[1].toLowerCase();
        cost.sacrifice = { n: word === 'x' ? 'X' : word === 'another' ? 1 : WORDN(word) || 1,
          filter: m[3].replace(/\band\/or\b/g, 'or').replace(/s\b/g, '').trim(),
          another: /another/i.test(m[1]) || !!m[2] };
        continue;
      }
      if ((m = p.match(/^Discard (a|an|your hand|two|three|\d+|X) ?(.*)$/i))) { cost.discard = { n: /^\d+$/.test(m[1]) ? +m[1] : /^(?:two|three)$/i.test(m[1]) ? num(m[1]) : (/hand/i.test(m[1]) ? 'all' : 1), filter: m[2] || 'card' }; continue; }
      if ((m = p.match(/^Pay (\d+) life$/i))) { cost.life = +m[1]; continue; }
      if ((m = p.match(/^Exile (.+)$/i))) {
        /* The exile costs the table can pay by itself: the card doing the
           asking, or a few cards out of the graveyard. Anything else stays
           a note for the player. */
        const what = m[1].trim();
        let ex = null;
        if (/^(this card|this|it|CARDNAME|this artifact|this creature|this enchantment|this land)( from your graveyard)?$/i.test(what)) {
          ex = { what: 'self' };
          if (/from your graveyard$/i.test(what)) ex.fromGraveyard = true;
        }
        else if ((m = what.match(/^(a|an|one|two|three|four|five|X|\d+)\s*([-a-z' ]*?)\s*cards? from your graveyard$/i)))
          ex = { what: 'graveyard', n: WORDN(m[1]), filter: (m[2] || '').trim().toLowerCase() || 'card' };
        else if (/^the top card of your library$/i.test(what)) ex = { what: 'libraryTop', n: 1 };
        if (ex) { cost.exile = ex; continue; }
        cost.other.push(p);
        continue;
      }
      // "Put a -1/-1 counter on this creature": a counter as the price
      if ((m = p.match(/^Put (a|an|one|two|\d+) ([+\-0-9/a-z]+) counters? on (?:this creature|CARDNAME|this artifact|this permanent)$/i))) {
        cost.putCounters = { n: WORDN(m[1]), kind: m[2].toLowerCase() };
        continue;
      }
      // "Return this creature to its owner's hand": the permanent itself as the price
      if (/^Return (?:this (?:creature|artifact|enchantment|permanent|Aura|land)|CARDNAME) to its owner'?s hand$/i.test(p)) { cost.returnSelf = true; continue; }
      /* "Return a land you control to its owner's hand", "Return two Islands
         you control to their owner's hand": permanents bounced as the price */
      if ((m = p.match(/^Return (a|an|one|two|three) (?:untapped )?([A-Za-z -]+?) you control to (?:its|their) owner'?s'? hands?$/i))) {
        const w = m[2].trim().replace(/ies$/, 'y').replace(/s$/, '');
        cost.returnOwn = { n: WORDN(m[1]), filter: w.toLowerCase(), untapped: /untapped/i.test(p) || undefined };
        continue;
      }
      // Blight N: N -1/-1 counters on a creature you control, as the price
      if ((m = p.match(/^Blight (\d+)$/i))) { cost.blight = +m[1]; continue; }
      // "Exert this land": it does not untap during your next untap step
      if (/^Exert (?:this|CARDNAME|this (?:land|creature|artifact|permanent))$/i.test(p)) { cost.exert = true; continue; }
      if ((m = p.match(/^Remove (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+|X|any number of) (.+?) counters? from/i))) {
        // the storage lands: "Remove X storage counters", "Remove any number of storage counters"
        cost.removeCounters = { n: m[1] === 'X' ? 'X' : /^any number of$/i.test(m[1]) ? 'any' : /^(?:six|seven|eight|nine|ten)$/i.test(m[1]) ? num(m[1]) : WORDN(m[1]), kind: m[2] }; continue;
      }
      /* "Tap an untapped creature you control", "Tap two untapped
         Merfolk you control": other permanents tapped as part of the
         price, the way convoke taps them for a spell. */
      if ((m = p.match(/^Tap (a|an|another|one|two|three|four|five|six|seven|eight|nine|ten|X|\d+) (other )?untapped ([A-Za-z -]+?) you control$/i))) {
        const word = m[1].toLowerCase();
        // "Elves" is an Elf and "Allies" an Ally; "Merfolk" is both
        const noun = m[3].trim().replace(/ves$/, 'f').replace(/ies$/, 'y').replace(/([^s])s$/, '$1');
        cost.tapCreatures = { n: word === 'x' ? 'X' : word === 'another' ? 1 : WORDN(word),
          filter: noun, another: word === 'another' || !!m[2] };
        continue;
      }
      cost.other.push(p);
    }
    return cost;
  }

  function costIsAutomatable(cost) {
    return cost.other.length === 0 && (!cost.exile || !!cost.exile.what);
  }

  /* A mana ability is one that could add mana and has no target (CR 605.1a).
     "{T}: Add {U} or {R}. This land deals 1 damage to you." is still one —
     the damage comes with the mana, it does not wait on the stack — so a
     few things that happen alongside the mana are allowed to come with it. */
  const MANA_OPS = new Set(['addMana', 'addManaAny', 'addManaChoice', 'addManaPer', 'addManaChosen',
    'addManaAmong', 'addManaDevotion', 'addManaX', 'addManaEachColor']);
  function isManaAbility(effects) {
    if (!effects || !effects.length) return false;
    if (!effects.some(e => MANA_OPS.has(e.op))) return false;
    return effects.every(e => {
      if (e.targets && e.targets.length) return false;
      if (MANA_OPS.has(e.op)) return true;
      if (e.op === 'damage') return !!e.toSelf;
      if (e.op === 'loseLife') return e.who === 'you';
      if (e.op === 'counters' || e.op === 'tap' || e.op === 'untap') return e.scope === 'self';
      return e.op === 'noop' || e.op === 'chooseColor' || e.op === 'sacrificeSelf' || e.op === 'spendOnly';
    });
  }

  /* ---------------- effect parsing ---------------- */
  // A small, deliberately conservative vocabulary. Each returns an effect
  // descriptor the rules engine knows how to execute.
  /* Target phrases as they are actually printed: a noun, sometimes a couple
     of adjectives, sometimes who controls it, sometimes one restriction. */
  const TGT_ADJ = "(?:attacking|blocking|tapped|untapped|nonland|nontoken|nonlegendary|legendary|token|face-down|blocked|unblocked|red|green|blue|white|black|colorless|multicolored|monocolored|artifact|enchantment|creature|land|other)";
  const TGT_NOUN = "(?:creature|player|opponent|planeswalker|battle|permanent)";
  const TGT_WHO = "(?: (?:you control|an opponent controls|you don't control|your opponents control|a player controls))?";
  // "with mana value X or less": the one capital a "with" clause can carry
  const TGT_WITH = "(?: (?:with|without) [a-z0-9'+/ ]{2,40}(?:X(?: or less| or greater)?)?)?";
  const TGT = "(?:any (?:other )?target|(?:another )?target (?:" + TGT_ADJ + " )*" + TGT_NOUN +
    "(?:,? (?:or )?" + TGT_NOUN + ")*" + TGT_WHO + TGT_WITH + ")";

  /** A target phrase the engine can be trusted with, or null. */
  function tgt(phrase) {
    const spec = targetSpec(phrase);
    return spec && spec.unknown ? null : spec;
  }

  /* "Create two 1/1 white Spirit creature tokens with flying." Read a piece
     at a time; anything this does not recognise leaves the sentence
     unread rather than making a token that is not the one printed. */
  const TOKEN_COLORS = /^(?:white|blue|black|red|green|colorless)$/i;
  function parseTokenSentence(sentence) {
    let s = String(sentence).trim().replace(/\.$/, '');
    let m = s.match(/^Create (a|an|one|two|three|four|five|six|seven|eight|nine|ten|X|\d+) /i);
    if (!m) return null;
    const e = { op: 'createToken', n: num(m[1]), keywords: [] };
    s = s.slice(m[0].length);
    if ((m = s.match(/^tapped /i))) { e.tapped = true; s = s.slice(m[0].length); }
    if (!(m = s.match(/^([\dX*]+\/[\dX*]+) /))) return null;
    e.pt = m[1];
    s = s.slice(m[0].length);
    // the words up to "creature token(s)": colours, then types
    if (!(m = s.match(/^(.+?) creature tokens?/i))) return null;
    const words = m[1].replace(/,/g, ' ').split(/\s+/).filter(w => w && !/^and$/i.test(w));
    s = s.slice(m[0].length);
    e.colorWords = [];
    const subs = [];
    e.addTypes = [];
    for (const w of words) {
      if (TOKEN_COLORS.test(w)) e.colorWords.push(w.toLowerCase());
      else if (/^(?:artifact|enchantment|land)$/i.test(w)) e.addTypes.push(U.titleCase(w));
      else if (/^legendary$/i.test(w)) e.legendary = true;
      else if (/^snow$/i.test(w)) e.snow = true;
      else if (/^[A-Z][A-Za-z'-]*$/.test(w)) subs.push(w);
      else return null;
    }
    e.subtypes = subs.join(' ') || 'Creature';
    if ((m = s.match(/^ named ([A-Z][^,.]*?)(?= with|,|$| that)/))) { e.name = m[1].trim(); s = s.slice(m[0].length); }
    // keywords and a granted ability in quotes, in either order
    const kwText = (t) => {
      const kws = keywordList(t);
      if (!kws.length || !KW_LIST.test(t)) return null;
      if (!kws.every(k => kwKnown(k) || /^protection from /i.test(k))) return null;
      return kws;
    };
    if ((m = s.match(/^ with "([^"]+)"/))) {
      e.grantedText = m[1]; s = s.slice(m[0].length);
    } else if ((m = s.match(/^ with ([a-z0-9 ,']+?) and "([^"]+)"/))) {
      const k = kwText(m[1]);
      if (!k) return null;
      e.keywords = k; e.grantedText = m[2]; s = s.slice(m[0].length);
    } else if ((m = s.match(/^ with ([a-z0-9 ,']+?)(?=$|,| that| for each )/))) {
      const k = kwText(m[1]);
      if (!k) return null;
      e.keywords = k; s = s.slice(m[0].length);
    }
    if ((m = s.match(/^,? that(?:'s| is| are)(?: tapped and)? attacking/i))) {
      e.attacking = true;
      if (/tapped/i.test(m[0])) e.tapped = true;
      s = s.slice(m[0].length);
    }
    if ((m = s.match(/^ for each ([-a-zA-Z0-9+/' ]+?)$/i))) {
      const c = countOf(m[1]);
      if (!c) return null;
      e.count = c;
      s = s.slice(m[0].length);
    }
    if ((m = s.match(/^, where X is the number of ([-a-zA-Z' ]+?) (you control|your opponents control|on the battlefield)$/i))) {
      e.countBy = m[1].trim().toLowerCase();
      if (!/you control/i.test(m[2])) return null;
      s = s.slice(m[0].length);
    } else if ((m = s.match(/^, where X is (.+)$/i)) && e.n === 'X') {
      const k = amountOf(m[1]);
      if (!k) return null;
      e.n = k;
      s = s.slice(m[0].length);
    } else if ((m = s.match(/^, where X is (.+)$/i)) && /^X\/X$/i.test(e.pt || '')) {
      // Shark Typhoon: "an X/X … token, where X is that spell's mana value"
      const k = amountOf(m[1]);
      if (!k) return null;
      e.ptX = k;
      s = s.slice(m[0].length);
    }
    if (s.trim()) return null;
    /* A token handed an ability has to be able to use it: the text is
       read as the token's own card would be, and has to read whole. */
    if (e.grantedText) {
      const probe = analyze({ id: 'tokentext:' + U.hash(e.grantedText), name: e.subtypes, type_line: 'Token Creature',
        oracle_text: e.grantedText, keywords: [], layout: 'token' });
      if (!probe || !probe.fullyAutomated) return null;
    }
    return e;
  }

  /**
   * One line read as if it were a card of its own, then made conditional:
   * a triggered ability gets the condition as an "if", an activated or mana
   * ability is only there while it holds, a standing rule or a keyword only
   * applies while it holds. Returns whether the whole line was understood.
   */
  function gateGranted(out, rest, cond, typeLine, card) {
    const probe = analyze({ id: (card.id || card.name) + ':gate:' + U.hash(rest + JSON.stringify(cond)), name: 'Probe', type_line: typeLine,
      oracle_text: rest, power: out.power, toughness: out.toughness, keywords: [], layout: 'normal' });
    if (!probe) return false;
    let ok = probe.fullyAutomated;
    const both = (c) => (c ? [].concat(c, cond) : cond);
    for (const ab0 of probe.abilities) {
      const ab = Object.assign({}, ab0, { text: rest });
      if (ab.kind === 'triggered') ab.condition = both(ab.condition);
      else if (ab.kind === 'activated' || ab.kind === 'loyalty') ab.levelCond = both(ab.levelCond);
      else if (ab.kind === 'static') {
        const effs = (ab.effects || []).flatMap(e => (e.op === 'sequence' ? e.list : [e]));
        if (!effs.every(e => e.op === 'continuous')) { ok = false; ab.auto = false; }
        ab.effects = effs.map(e => Object.assign({}, e, { cond: both(e.cond) }));
      } else { ok = false; ab.auto = false; }
      out.abilities.push(ab);
    }
    for (const ab0 of probe.manaAbilities) out.manaAbilities.push(Object.assign({}, ab0, { levelCond: both(ab0.levelCond) }));
    const kws = probe.keywords.map(k => k.text || k.keyword);
    if (kws.length) {
      if (!kws.every(kwKnown)) ok = false;
      out.abilities.push({ kind: 'static', text: rest, auto: kws.every(kwKnown),
        effects: [{ op: 'continuous', layer: 6, scope: { self: true }, grant: kws, cond }] });
    }
    return ok;
  }

  /* Words in quotation marks that a permanent can be handed and the engine
     can run as its own: triggered abilities, read whole, as if they were
     printed on a card of their own. */
  function grantableText(text) {
    const probe = analyze({ id: 'granted:' + U.hash(text), name: 'Granted', type_line: 'Creature',
      oracle_text: text, keywords: [], layout: 'token' });
    // triggered and activated abilities: the engine adds either to the permanent's own
    return !!(probe && probe.fullyAutomated && probe.abilities.length &&
      probe.abilities.every(ab => ab.kind === 'triggered' || ab.kind === 'activated'));
  }

  /* When a spell may be cast: the words after "Cast this spell only".
     Steps and turns the table keeps, or a condition it can check; anything
     else is not read. */
  function castWindowOf(phrase) {
    let p = String(phrase || '').trim().replace(/\.$/, '');
    const w = {};
    let m;
    if ((m = p.match(/^(.*?),? and only if (.+)$/i)) || (m = p.match(/^()if (.+)$/i))) {
      const ifs = m[2];
      p = m[1].trim();
      if (/^you'?ve been attacked this step$/i.test(ifs)) w.attackedYou = true;
      // Illusory Angel: this spell is not counted yet as it is cast
      else if (/^you'?ve cast another spell this turn$/i.test(ifs)) w.cond = { kind: 'spellsCast', n: 1 };
      else if (/^a creature is attacking you$/i.test(ifs)) w.attackedYou = true;
      else { const c = condOf(ifs); if (!c) return null; w.cond = c; }
      if (!p) return w;
    }
    const FORMS = [
      [/^during combat$/i, { phase: 'combat' }],
      [/^during combat before blockers are declared$/i, { phase: 'combat', before: 'declareBlockers' }],
      [/^during combat after blockers are declared$/i, { phase: 'combat', from: 'declareBlockers' }],
      [/^during combat on (?:your|an opponent'?s) turn$/i, { phase: 'combat' }],
      [/^during combat on your turn before blockers are declared$/i, { phase: 'combat', before: 'declareBlockers' }],
      [/^during (?:the|your) declare attackers step$/i, { step: 'declareAttackers' }],
      [/^during the declare blockers step$/i, { step: 'declareBlockers' }],
      [/^during the declare blockers step on an opponent'?s turn$/i, { step: 'declareBlockers' }],
      [/^during (?:your|an opponent'?s) turn$/i, {}],
      [/^during an opponent'?s turn,? before attackers are declared$/i, { before: 'declareAttackers' }],
      [/^during an opponent'?s upkeep$/i, { step: 'upkeep' }],
      [/^during an opponent'?s turn after their upkeep step$/i, { afterUpkeep: true }],
      [/^during your end step$/i, { step: 'end' }],
      [/^after combat$/i, { afterCombat: true }],
      [/^before the combat damage step$/i, { before: 'firstStrikeDamage' }],
      [/^before blockers are declared$/i, { before: 'declareBlockers' }],
      [/^before attackers are declared$/i, { before: 'declareAttackers' }],
      [/^before combat or during combat before blockers are declared$/i, { before: 'declareBlockers' }],
    ];
    for (const [re, v] of FORMS) {
      if (!re.test(p)) continue;
      Object.assign(w, v);
      if (/on your turn|^during your (?:turn|declare|end)/i.test(p)) w.yours = true;
      if (/opponent'?s (?:turn|upkeep)/i.test(p)) w.theirs = true;
      return w;
    }
    return null;
  }

  /** Point a target-less trigger's "it" at what the trigger is about. */
  function itIsTheTrigger(effects, scope) {
    if (!scope) return;
    /* "Whenever this creature attacks, it gains double strike until end of
       turn": with nothing before it, "it" is what the trigger is about */
    const g0 = (effects || [])[0];
    if (g0 && g0.op === 'grantLast' && !g0.plural) {
      Object.assign(g0, { op: 'grantKeyword', duration: g0.until === 'eot' ? 'eot' : 'permanent', scope });
      delete g0.until; delete g0.plural;
    }
    let targeted = false;
    const walk = (list, fn) => { for (const e of list || []) { if (!e) continue; fn(e); walk(e.list, fn); walk(e.then, fn); walk(e.otherwise, fn); } };
    walk(effects, (e) => { if (e.targets && e.targets.length) targeted = true; });
    if (targeted) return;
    const ops = ['pump', 'grantKeyword', 'counters', 'tap', 'untap', 'restrict']
      .concat(scope === 'triggerObject' ? ['destroy', 'exile', 'bounce', 'noUntap', 'copyPermanent'] : []);
    walk(effects, (e) => { if (e.scope === 'lastTarget' && ops.includes(e.op)) e.scope = scope; });
    // "Untap it." in a trigger about another permanent: that one, not this
    /* …unless the sentence before was about this one: "put a +1/+1 counter
       on Gwenna and untap it" */
    let prevSelf = false;
    if (scope === 'triggerObject') walk(effects, (e) => {
      if (e.scope === 'self' && ops.includes(e.op) && !prevSelf && /\b(?:it|that (?:creature|permanent|land))\b/i.test(e.text || '') && !/\bthis\b|CARDNAME/.test(e.text || '')) e.scope = scope;
      prevSelf = e.scope === 'self' && /\bthis\b|CARDNAME/.test(e.text || '');
    });
  }

  /* An emblem's words the table can run: triggered abilities, and standing
     rules that change what permanents are (the engine counts those from the
     command zone). */
  function emblemText(text) {
    const probe = analyze({ id: 'emblemprobe:' + U.hash(text), name: 'Emblem', type_line: 'Emblem',
      oracle_text: text, keywords: [], layout: 'emblem' });
    // standing rules the engine asks of a player's emblems as well as their permanents
    const PLAYER_STATICS = ['noMaxHandSize', 'freeFromHand', 'playerHexproof', 'costMod'];
    return !!(probe && probe.fullyAutomated && probe.abilities.length && probe.abilities.every(ab => ab.kind === 'triggered' ||
      (ab.kind === 'static' && (ab.effects || []).every(e => e.op === 'continuous' || PLAYER_STATICS.includes(e.op) ||
        (e.op === 'sequence' && (e.list || []).every(x => x.op === 'continuous'))))));
  }

  /* Reveal until (Hermit Druid, The Regalia, Balustrade Spy, Polymorph):
     whose library, what is looked for and how many, where the found card or
     cards go, and where the rest go. Anything else is not read. */
  function revealUntilOf(text) {
    let t = String(text).trim().replace(/\s*X can'?t be 0\.?$/i, '');
    const who0 = t.match(/^(Its controller|That creature'?s controller|That player|Defending player|Target player|Target opponent|Each opponent|Reveal)/i);
    if (!who0) return null;
    const w = who0[1].toLowerCase();
    const who = w === 'reveal' ? 'you' : /each opponent/.test(w) ? 'opponents' : /^target/.test(w) ? 'target'
      : /controller/.test(w) ? 'targetController' : 'triggerPlayer';
    const m = t.match(/until (?:you|they) reveal (an?|one|two|three|four|five|X) ([a-z ,]+?) cards?(?:, where X is (.+?))?(,|\.) ([\s\S]+)$/i);
    if (!m) return null;
    const e = { op: 'revealUntil', who, filter: m[2].replace(/,? or /g, ' or ').trim().toLowerCase() };
    if (/^X$/i.test(m[1])) { if (m[3]) { const k = amountOf(m[3]); if (!k) return null; e.n = k; } else e.n = 'X'; }
    else e.n = /^an?$/i.test(m[1]) ? 1 : num(m[1]);
    if (who === 'target') e.targets = [{ type: 'player', opponent: /opponent/.test(w) }];
    let rest = m[5].trim();
    // "then puts those cards into their graveyard": everything revealed
    if (m[4] === ',' && /^then puts? (?:those cards|all cards revealed this way) into (?:their|your) graveyard\.?$/i.test(rest)) {
      return Object.assign(e, { dest: 'graveyard', rest: 'graveyard' });
    }
    if (m[4] !== '.') return null;
    const put = rest.match(/^(?:(?:The|That) player puts?|Put) (?:that card|it|those (?:[a-z ]+ )?cards) (into (?:your|their) hand|onto the battlefield(?: tapped)?(?: under (?:your|their|its owner'?s) control)?)(?: and (?:the rest|all other cards revealed this way) (on the bottom of (?:your|their) library in a random order|into (?:your|their) graveyard)|, then shuffles? (?:the rest|all other cards revealed this way) into (?:your|their) library)\.?$/i);
    if (!put) return null;
    e.dest = /hand/i.test(put[1]) ? 'hand' : 'battlefield';
    e.tapped = /tapped/i.test(put[1]);
    if (/their control/i.test(put[1]) || (w !== 'reveal' && !/your control/i.test(put[1]))) e.toOwner = true;
    e.rest = put[2] ? (/graveyard/i.test(put[2]) ? 'graveyard' : 'bottom') : 'shuffle';
    return e;
  }

  /* "Until end of turn, whenever you cast a spell, copy it", "Whenever a
     creature dies this turn, …": a triggered ability that lasts the turn,
     kept as an emblem that goes at cleanup. Nothing in it may point back
     at the card or at something chosen before it. */
  function turnTrigger(text) {
    const t = String(text).trim();
    let body = null, once = false;
    let m = t.match(/^(?:Until end of turn|This turn), (whenever [\s\S]+)$/i);
    if (m) body = 'W' + m[1].slice(1);
    // Galvanic Iteration: "When you next cast an instant or sorcery spell this turn, copy that spell." — once
    else if ((m = t.match(/^When you next (cast [^,"]+?) this turn, ([\s\S]+)$/i))) { body = 'Whenever you ' + m[1] + ', ' + m[2]; once = true; }
    // Twinferno: "When you cast your next instant or sorcery spell this turn, …"
    else if ((m = t.match(/^When you cast your next ([^,"]+?) this turn, ([\s\S]+)$/i))) { body = 'Whenever you cast ' + (/^[aeiou]/i.test(m[1]) ? 'an ' : 'a ') + m[1] + ', ' + m[2]; once = true; }
    else if ((m = t.match(/^((?:Whenever|At the beginning of) [^,"]+?) this turn, ([\s\S]+)$/))) body = m[1] + ', ' + m[2];
    if (!body || /\bCARDNAME\b|\bthis (?:creature|spell|card|enchantment|artifact)\b/i.test(body)) return null;
    const head = body.split(',')[0];
    if (/\bthat (?:player|creature|permanent|card)\b|\bchosen\b/i.test(head)) return null;
    body = body.replace(/\.?$/, '.');
    return emblemText(body) ? Object.assign({ op: 'getEmblem', emblemText: body, thisTurn: true, name: once ? 'Next spell this turn' : 'Until end of turn' }, once ? { once: true } : {}) : null;
  }

  /* "Search your library for up to two basic land cards, put them onto the
     battlefield tapped, then shuffle." A search comes in a dozen phrasings:
     who searches, how many, of what, and where they go. This reads the
     sentence a piece at a time and gives up on anything it has not seen
     before, rather than swallowing the end of a sentence it did not
     understand (which is how Gamble used to forget its discard). */
  function parseSearch(sentence) {
    let s = String(sentence).trim().replace(/\.$/, '');
    const e = { op: 'tutor' };
    let m = s.match(/^(?:(You may )?[Ss]earch your library|Its controller (may )?search(?:es)? their library|That player (may )?search(?:es)? their library) for /i);
    if (!m) return null;
    if (m[1] || m[2] || m[3]) e.optional = true;
    if (/^(?:Its controller|That player)/i.test(s)) e.who = 'targetController';
    s = s.slice(m[0].length);
    m = s.match(/^(up to )?(a|an|one|two|three|four|five|X|\d+|any number of) /i);
    if (!m) return null;
    e.n = /any number/i.test(m[2]) ? 99 : num(m[2]);
    if (m[1]) e.upTo = true;
    s = s.slice(m[0].length);
    m = s.match(/^([-a-zA-Z', ]*?)\s*cards?\b/);
    if (!m) return null;
    let desc = m[1].trim().toLowerCase().replace(/,$/, '');
    s = s.slice(m[0].length);
    let q;
    while ((q = s.match(/^,? (?:with (?:mana value|converted mana cost) (X|\d+) or less|with (?:mana value|converted mana cost) (X|\d+) or (?:greater|more)|with (?:mana value|converted mana cost) (X|\d+)|with different names|that share a land type|with a basic land type|that (?:is|are) (?:a )?([a-z]+)|with (power|toughness) (\d+) or (less|greater))/i))) {
      if (q[5]) e[(q[7] === 'less' ? 'max' : 'min') + (q[5] === 'power' ? 'Power' : 'Toughness')] = +q[6];
      if (q[1]) e.maxMv = q[1] === 'X' ? 'X' : +q[1];
      if (q[2]) e.minMv = +q[2];
      if (q[3]) e.mv = q[3] === 'X' ? 'X' : +q[3];
      if (/share a land type/i.test(q[0])) e.shareType = true;
      if (/different names/i.test(q[0])) e.differentNames = true;
      if (/basic land type/i.test(q[0])) e.basicType = true;
      if (q[4]) desc = (desc + ' ' + q[4]).trim();
      s = s.slice(q[0].length);
    }
    // "a basic Plains, Island, or Swamp card" is basic every time it says a type
    if (/^basic /.test(desc) && /,| or /.test(desc) && desc !== 'basic land') {
      desc = desc.replace(/^basic /, '').split(/\s*,\s*(?:or\s+)?|\s+or\s+/).filter(Boolean)
        .map(w => 'basic ' + w).join(' or ');
    }
    e.filter = desc || 'any';
    s = s.replace(/^,? (?:and )?reveal (?:it|them|that card|those cards|the cards)/i, '');
    if ((m = s.match(/^,? (?:and |then )?put (?:it|them|that card|those cards|the card|the cards|one of them|that land|those lands) (onto the battlefield|into your hand|into their hand|into your graveyard|into their graveyard)( tapped)?(?: under (?:your|their|its owner'?s) control)?/i))) {
      e.to = /battlefield/i.test(m[1]) ? 'battlefield' : /graveyard/i.test(m[1]) ? 'graveyard' : 'hand';
      if (m[2]) e.tapped = true;
    } else if ((m = s.match(/^,? (?:and )?put one onto the battlefield( tapped)? and the other into your hand/i))) {
      e.to = 'split';
      e.split = { battlefield: 1, tapped: !!m[1] };
    } else if ((m = s.match(/^[,.]? (?:[Tt]hen )?(?:[Ss]huffle)(?: your library)?,? (?:and )?(?:then )?put (?:it|that card|the card|them|those cards) on top(?: of (?:it|your library))?(?: in any order)?/))) {
      e.to = 'top';
    } else if ((m = s.match(/^,? (?:and )?put (?:it|that card) on top of your library/i))) {
      e.to = 'top';
    } else return null;
    s = s.slice(m[0].length);
    // Gamble's catch
    let after = null;
    if ((m = s.match(/^,? (?:and )?discard a card at random/i))) {
      after = { op: 'discard', n: 1, who: 'you', random: true };
      s = s.slice(m[0].length);
    }
    s = s.replace(/^,? (?:and |then )?shuffles?(?: (?:your|their) library)?/i, '');
    // the Capenna lands: "…then shuffle and you gain 1 life"
    if ((m = s.match(/^,? and you gain (one|two|three|\d+) life$/i))) {
      after = { op: 'gainLife', n: num(m[1]), who: 'you' };
      s = '';
    }
    if (s.trim()) return null;
    const what = e.filter === 'any' ? 'card' : e.filter + ' card';
    e.prompt = 'Search your library for ' + (e.n === 1 ? (/^[aeiou]/.test(what) ? 'an ' : 'a ') : (e.upTo ? 'up to ' : '') + e.n + ' ') +
      what + (e.n === 1 ? '' : 's') + '.';
    return after ? { op: 'sequence', list: [e, after] } : e;
  }

  const EFFECT_RULES = [
    /* --- searching a library, in all the shapes it gets printed in --- */
    { re: /^(?:You may )?[Ss]earch your library for .+$/, make: (m) => parseSearch(m[0]) },
    { re: /^Its controller (?:may )?search(?:es)? their library for .+$/i, make: (m) => parseSearch(m[0]) },
    { re: /^That player (?:may )?search(?:es)? their library for .+$/i, make: (m) => parseSearch(m[0]) },

    // --- mana ---
    { re: /^Add (\{[^}]+\}(?:\{[^}]+\})*)\.?$/i,
      make: (m) => ({ op: 'addMana', symbols: MANA.parse(m[1]) }) },
    { re: /^Add (\{[^}]+\}) or (\{[^}]+\})\.?$/i,
      make: (m) => ({ op: 'addManaChoice', choices: [MANA.parse(m[1]), MANA.parse(m[2])] }) },
    { re: /^Add (\{[^}]+\}), (\{[^}]+\}), or (\{[^}]+\})\.?$/i,
      make: (m) => ({ op: 'addManaChoice', choices: [MANA.parse(m[1]), MANA.parse(m[2]), MANA.parse(m[3])] }) },
    { re: /^Add one mana of any color\.?$/i,
      make: () => ({ op: 'addManaAny', amount: 1 }) },
    { re: /^Add (one|two|three|four|five|six|seven|eight|nine|ten|\d+) mana of any one color\.?$/i,
      make: (m) => ({ op: 'addManaAny', amount: num(m[1]), sameColor: true }) },
    { re: /^Add (one|two|three|four|five|six|seven|eight|nine|ten|\d+) mana in any combination of colors\.?$/i,
      make: (m) => ({ op: 'addManaAny', amount: num(m[1]) }) },
    // Sanctum Weaver: "Add X mana of any one color, where X is the number of enchantments you control."
    { re: /^Add X mana of any one colou?r, where X is the number of ([-a-zA-Z' ]+? you control)\.?$/i,
      make: (m) => { const sc = scopeOf(m[1]); return sc ? { op: 'addManaX', x: 'count', scope: sc } : null; } },
    // The Eternity Elevator: "Add X mana of any one color, where X is the number of charge counters on CARDNAME."
    { re: /^Add X mana of any one colou?r, where X is the number of ([a-z]+) counters on (?:CARDNAME|this (?:artifact|creature|land|permanent))\.?$/i,
      make: (m) => ({ op: 'addManaX', x: 'counters', counter: m[1].toLowerCase() }) },
    // Marwyn: "Add an amount of {G} equal to CARDNAME's power."
    { re: /^Add an amount of \{([WUBRGC])\} equal to (?:CARDNAME'?s?|this creature'?s|its) power\.?$/i,
      make: (m) => ({ op: 'addManaX', x: 'power', symbol: m[1].toUpperCase() }) },
    // Castle Garenbrig: "Add six {G}."
    { re: /^Add (two|three|four|five|six|seven|eight|nine|ten) (\{[WUBRGC]\})\.?$/i,
      make: (m) => ({ op: 'addMana', symbols: Array.from({ length: num(m[1]) }, () => m[2].replace(/[{}]/g, '').toUpperCase()) }) },
    { re: /^Add one mana of any color in your commander's color identity\.?$/i,
      make: () => ({ op: 'addManaAny', amount: 1, commanderIdentity: true }) },
    /* "Spend this mana only to cast a creature spell of the chosen type,
       and that spell can't be countered." — the mana's own restriction,
       kept with the ability that makes it. */
    { re: /^Spend this mana only to cast (?:an? )?([a-zA-Z ]+?) spells?( of the chosen type)?(,? and (?:that spell|it) can'?t be countered)?(?: or activate (?:an ability|abilities) of ([^.]+))?\.?$/i,
      make: (m) => {
        const words = m[1].trim().toLowerCase();
        if (!/^(?:creature|artifact|legendary|instant or sorcery|instant|sorcery|enchantment|colorless|noncreature|dragon|[a-z]+ creature|(?:colorless )?[a-z]+)$/.test(words)) return null;
        const out = { op: 'spendOnly', words: words + ' spell', chosenType: !!m[2], uncounterable: !!m[3] };
        /* "…or activate abilities of creatures" (Castle Garenbrig, Eldrazi
           Temple): the same mana may pay for those permanents' abilities. */
        if (m[4]) {
          let of = m[4].trim().toLowerCase().replace(/\s+you control$/, '').replace(/^(?:an? )/, '');
          if (/ (?:source )?of the chosen type$/.test(of)) { out.abilitiesChosenType = true; of = of.replace(/ (?:source )?of the chosen type$/, ''); }
          if (/^(?:colorless )?[a-z]+$/.test(of)) out.abilitiesOf = of.replace(/([^s])s$/, '$1');
        }
        return out;
      } },
    { re: /^Spend this mana only to activate abilities\.?$/i, make: () => ({ op: 'spendOnly', open: true, noSpells: true }) },
    { re: /^This mana can'?t be spent to cast (?:a |an )?non(artifact|creature) spells?\.?$/i,
      make: (m) => ({ op: 'spendOnly', words: m[1].toLowerCase() + ' spell' }) },
    { re: /^When that mana is spent to cast a creature spell that shares a creature type with your commander, scry 1\.?$/i,
      make: () => ({ op: 'spendOnly', rider: 'ancestryScry', open: true }) },
    /* Arena of Glory */
    { re: /^If any of that mana is spent on a creature spell, it gains haste until end of turn\.?$/i,
      make: () => ({ op: 'spendOnly', rider: 'hasteCreature', open: true }) },
    /* Three Tree City: as much as there are creatures of the chosen type */
    { re: /^Add an amount of mana of that color equal to the number of ([a-z ]+?) of the chosen type\.?$/i,
      make: (m) => { const sc = scopeOf(m[1] + ' of the chosen type'); return sc ? { op: 'addManaX', x: 'count', scope: sc } : null; } },
    /* mana whose colours depend on the table */
    { re: /^Add one mana of any (color|type) that a land an opponent controls could produce\.?$/i,
      make: (m) => ({ op: 'addManaAmong', from: 'opponentLands', amount: 1, anyType: /type/i.test(m[1]) }) },
    { re: /^Add one mana of any (color|type) that a land you control could produce\.?$/i,
      make: (m) => ({ op: 'addManaAmong', from: 'yourLands', amount: 1, anyType: /type/i.test(m[1]) }) },
    { re: /^Add one mana of any color among legendary creatures and planeswalkers you control\.?$/i,
      make: () => ({ op: 'addManaAmong', from: 'yourLegends', amount: 1 }) },
    { re: /^Add one mana of any colou?r among legendary permanents you control\.?$/i,
      make: () => ({ op: 'addManaAmong', from: 'yourLegends', anyLegend: true, amount: 1 }) },
    { re: /^Add one mana of any of the exiled card'?s colors\.?$/i,
      make: () => ({ op: 'addManaAmong', from: 'exiledCard', amount: 1 }) },
    { re: /^For each color among permanents you control, add one mana of that color\.?$/i,
      make: () => ({ op: 'addManaEachColor' }) },
    { re: /^Add X mana of any one color, where X is (?:CARDNAME'?s?|this creature'?s|its) power\.?$/i,
      make: () => ({ op: 'addManaX', x: 'power' }) },
    { re: /^Add X mana in any combination of colors, where X is the greatest power among creatures you control\.?$/i,
      make: () => ({ op: 'addManaX', x: 'greatestPower' }) },
    { re: /^Add an amount of mana of that color equal to your devotion to that color\.?$/i,
      make: () => ({ op: 'addManaDevotion' }) },

    // --- draw / discard ---
    { re: /^(?:You )?draws? (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+|X) cards?\.?$/i,
      make: (m) => ({ op: 'draw', n: num(m[1]), who: 'you' }) },
    { re: /^Each player draws (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+|X) cards?\.?$/i,
      make: (m) => ({ op: 'draw', n: num(m[1]), who: 'each' }) },
    { re: /^Each opponent draws (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+|X) cards?\.?$/i,
      make: (m) => ({ op: 'draw', n: num(m[1]), who: 'opponents' }) },
    // Cut a Deal: every opponent draws, so you draw one for each of them
    { re: /^Each opponent draws a card, then you draw a card for each opponent who drew a card this way\.?$/i,
      make: () => [{ op: 'draw', n: 1, who: 'opponents' }, { op: 'draw', who: 'you', n: { opponents: true, mult: 1 } }] },
    { re: /^Target player draws (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+|X) cards?\.?$/i,
      make: (m) => ({ op: 'draw', n: num(m[1]), who: 'target' , targets: [{ type: 'player' }] }) },
    { re: /^(?:You )?discards? (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?\.?$/i,
      make: (m) => ({ op: 'discard', n: num(m[1]), who: 'you' }) },
    { re: /^Each opponent discards (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?\.?$/i,
      make: (m) => ({ op: 'discard', n: num(m[1]), who: 'opponents' }) },
    { re: /^Target (?:player|opponent) discards (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+|X) cards?\.?$/i,
      make: (m) => ({ op: 'discard', n: num(m[1]), who: 'target', targets: [{ type: 'player' }] }) },

    // --- life ---
    { re: /^(?:CARDNAME |You )?gains? (one|two|three|four|five|six|seven|eight|nine|ten|\d+|X) life\.?$/i,
      make: (m) => ({ op: 'gainLife', n: num(m[1]), who: 'you' }) },
    { re: /^(?:You )?loses? (one|two|three|four|five|six|seven|eight|nine|ten|\d+|X) life\.?$/i,
      make: (m) => ({ op: 'loseLife', n: num(m[1]), who: 'you' }) },
    { re: /^Each opponent loses (one|two|three|four|five|six|seven|eight|nine|ten|\d+|X) life\.?$/i,
      make: (m) => ({ op: 'loseLife', n: num(m[1]), who: 'opponents' }) },
    { re: /^Target player (?:or planeswalker )?loses (one|two|three|four|five|six|seven|eight|nine|ten|\d+|X) life\.?$/i,
      make: (m) => ({ op: 'loseLife', n: num(m[1]), who: 'target', targets: [{ type: 'player' }] }) },
    { re: /^Target player gains (one|two|three|four|five|six|seven|eight|nine|ten|\d+|X) life\.?$/i,
      make: (m) => ({ op: 'gainLife', n: num(m[1]), who: 'target', targets: [{ type: 'player' }] }) },
    { re: /^Target opponent loses (one|two|three|four|five|six|seven|eight|nine|ten|\d+|X) life\.?$/i,
      make: (m) => ({ op: 'loseLife', n: num(m[1]), who: 'target', targets: [{ type: 'player', opponent: true }] }) },
    { re: /^Each player gains (one|two|three|four|five|six|seven|eight|nine|ten|\d+|X) life\.?$/i,
      make: (m) => ({ op: 'gainLife', n: num(m[1]), who: 'each' }) },
    // Brass Squire: "Attach target Equipment you control to target creature you control."
    { re: /^Attach target Equipment you control to target creature you control\.?$/i,
      make: () => ({ op: 'attachEquipment', targets: [{ type: 'permanent', controller: 'you', filter: 'Equipment you control', subtypes: ['equipment'] }, { type: 'creature', controller: 'you' }] }) },
    // Beacon of Immortality: "Double target player's life total."
    { re: /^Double target player'?s life total\.?$/i, make: () => ({ op: 'doubleLife', targets: [{ type: 'player' }] }) },
    // Geode Rager: "goad each creature target player controls"
    { re: /^Goad each creature (target player|target opponent|that player) controls\.?$/i,
      make: (m) => (/^target/i.test(m[1]) ? { op: 'goad', scope: { who: 'target', what: 'creature' }, targets: [{ type: 'player', opponent: /opponent/i.test(m[1]) }] }
        : { op: 'goad', scope: { who: 'target', what: 'creature', thatPlayer: true } }) },
    // Kellogg, Merieke Ri Berit: "for as long as you control this creature"
    { re: /^(?:Gain|You gain) control of (target [a-z ]+?) for as long as you control (?:CARDNAME|this creature|this artifact|this enchantment|this permanent)\.?$/i,
      make: (m) => ({ op: 'gainControl', until: null, whileSrc: true, targets: [targetSpec(m[1])] }) },
    // Amazing Acrobatics: "Tap one or two target creatures."
    { re: /^Tap one or two target creatures\.?$/i, make: () => ({ op: 'tap', targets: [{ type: 'creature' }, { type: 'creature', upTo: true, distinct: true }] }) },
    // Kheru Goldkeeper: "Put two +1/+1 counters and a flying counter on target creature."
    { re: /^Put (a|an|one|two|three|\d+) ([+\-0-9/a-z]+) counters? and (a|an|one|two) ([a-z ]+?) counters? on (target creature(?: you control)?)\.?$/i,
      make: (m) => ({ op: 'sequence', list: [{ op: 'counters', kind: m[2].toLowerCase(), n: num(m[1]), targets: [targetSpec(m[5])] },
        { op: 'counters', kind: m[4].toLowerCase(), n: num(m[3]), scope: 'lastTarget' }] }) },
    // Children of Korlis: "You gain life equal to the life you've lost this turn."
    { re: /^You gain life equal to the life you'?ve lost this turn\.?$/i, make: () => ({ op: 'gainLife', who: 'you', n: { lifeLostThisTurn: 'you' } }) },
    // Wall of Reverence: "gain life equal to the power of target creature you control"
    { re: /^(?:You )?[Gg]ain life equal to the power of (target creature(?: you control)?)\.?$/,
      make: (m) => ({ op: 'gainLife', who: 'you', n: { ofTarget: 'power' }, targets: [targetSpec(m[1])] }) },
    // Quandrix Command, Dwell on the Past: cards from a graveyard shuffled back
    { re: /^Target player shuffles up to (one|two|three|four|five) target cards from their graveyard into their library\.?$/i,
      make: (m) => ({ op: 'shuffleGraveCards', targets: [{ type: 'player' }].concat(Array.from({ length: num(m[1]) },
        () => ({ type: 'card', zone: 'graveyard', filter: 'card', upTo: true, distinct: true }))) }) },
    // Gimli's Reckless Might: "fights up to one target creature you don't control"
    { re: /^(Target (?:attacking )?creature you control) fights up to one (target creature (?:you don'?t control|an opponent controls))\.?$/i,
      make: (m) => ({ op: 'fight', targets: [targetSpec(m[1]), Object.assign(targetSpec(m[2]), { upTo: true })] }) },
    // Beacon of Unrest: "…from a graveyard onto the battlefield under your control"
    { re: /^Put target (artifact or creature|creature|artifact) card from a graveyard onto the battlefield under your control\.?$/i,
      make: (m) => ({ op: 'reanimate', targets: [Object.assign(targetSpec('target ' + m[1]), { zone: 'graveyard' })] }) },
    // Wrong Turn, Harmless Offering: "Target opponent gains control of target creature (you control)."
    { re: /^Target (opponent|player) gains control of (target (?:creature|permanent|artifact)(?: you control)?)\.?$/i,
      make: (m) => ({ op: 'giveControl', targets: [{ type: 'player', opponent: /opponent/i.test(m[1]) }, targetSpec(m[2])] }) },
    // Counterflux: "Counter target spell you don't control."
    { re: /^Counter target spell you don'?t control\.?$/i, make: () => ({ op: 'counterSpell', targets: [{ type: 'spell', zone: 'stack', filter: 'spell', controller: 'opponent' }] }) },
    // Ashling's Command: "2 damage to each creature target player controls"
    { re: /^(?:CARDNAME|This creature|It) deals (\d+|X) damage to each creature target (player|opponent) controls\.?$/i,
      make: (m) => ({ op: 'damage', n: num(m[1]), scope: { who: 'target', what: 'creature' }, targets: [{ type: 'player', opponent: /opponent/i.test(m[2]) }] }) },
    // Ominous Cemetery: "Target creature's owner shuffles it into their library."
    { re: /^(Target (?:creature|permanent|nonland permanent))'s owner shuffles it into their library\.?$/i,
      make: (m) => ({ op: 'toLibrary', where: 'shuffle', targets: [targetSpec(m[1])] }) },
    // Tangle: "Each attacking creature doesn't untap during its controller's next untap step."
    { re: /^Each attacking creature doesn'?t untap during its controller'?s next untap step\.?$/i,
      make: () => ({ op: 'noUntap', scope: { who: 'all', what: 'creature', attacking: true } }) },
    // Words of Wisdom: "You draw two cards, then each other player draws a card."
    { re: /^You draw (a|one|two|three|\d+) cards?, then each other player draws (a|one|two|\d+) cards?\.?$/i,
      make: (m) => [{ op: 'draw', n: num(m[1]), who: 'you' }, { op: 'draw', n: num(m[2]), who: 'opponents' }] },
    // Magnetic Theft: "Attach target Equipment to target creature."
    { re: /^Attach target Equipment to target creature\.?$/i,
      make: () => ({ op: 'attachEquipment', targets: [{ type: 'permanent', filter: 'Equipment', subtypes: ['equipment'] }, { type: 'creature' }] }) },
    // Hellrider: "deals 1 damage to the player or planeswalker it's attacking"
    { re: /^(?:CARDNAME|This creature) deals (\d+) damage to the player or planeswalker it'?s attacking\.?$/i,
      make: (m) => ({ op: 'damage', n: +m[1], toDefenderOf: 'triggerObject' }) },
    { re: /^(?:It|That creature) deals damage equal to its power to the player or planeswalker it'?s attacking\.?$/i,
      make: () => ({ op: 'damage', n: { ofTrigger: 'power' }, fromTrigger: true, toDefenderOf: 'triggerObject' }) },
    // Hex: "Destroy six target creatures."
    { re: /^Destroy (two|three|four|five|six) target ([a-z ]+?)s\.?$/i,
      make: (m) => { const t = tgt('target ' + m[2]); return t ? { op: 'destroy', targets: Array.from({ length: num(m[1]) }, () => Object.assign({}, t, { distinct: true })) } : null; } },
    // Door to Nothingness
    { re: /^Target (player|opponent) loses the game\.?$/i, make: (m) => ({ op: 'loseGameTarget', targets: [{ type: 'player', opponent: /opponent/i.test(m[1]) }] }) },
    // Marching Duodrone, Grismold: "each player creates a Treasure token"
    { re: /^Each player creates (a|an|one|two|\d+) (Treasure|Clue|Food|Blood|Map|Gold|Powerstone|Junk) tokens?\.?$/i,
      make: (m) => ({ op: 'createNamedToken', token: U.titleCase(m[2]), n: num(m[1]), who: 'each' }) },
    { re: /^Each player creates (.+)$/i,
      make: (m) => { const inner = parseTokenSentence('Create ' + m[1]); return inner ? Object.assign(inner, { who: 'each' }) : null; } },
    // Into the Fire: "2 damage to each creature, planeswalker, and battle"
    { re: /^(?:CARDNAME|This creature|It) deals (\d+|X) damage to each creature, planeswalker, and battle\.?$/i,
      make: (m) => ({ op: 'damage', n: num(m[1]), scope: { who: 'all', what: 'permanent', anyOf: ['creature', 'planeswalker', 'battle'] } }) },
    // Kaya's Guile: "Exile all opponents' graveyards."
    { re: /^Exile all opponents'? graveyards\.?$/i, make: () => ({ op: 'exileGraveyard', who: 'opponents' }) },
    // Memnarch: "Target permanent becomes an artifact in addition to its other types." — for good
    { re: /^(target [a-z ]+?) becomes an? (artifact|enchantment|creature|land) in addition to its other types\.?$/i,
      make: (m) => { const t = tgt(m[1]); return t ? { op: 'addTypes', types: [U.titleCase(m[2])], targets: [t] } : null; } },
    /* Roles (CR 303.7): "Create a Wicked Role token attached to target
       creature you control" — an Aura token with the Role's words */
    { re: /^Create an? (Cursed|Monster|Royal|Sorcerer|Virtuous|Wicked|Young Hero) Role token attached to (up to one (?:other )?|another )?(target creature(?: you control| an opponent controls| you don'?t control)?|it|that creature|enchanted creature|equipped creature)\.?$/i,
      make: (m) => {
        const role = U.titleCase(m[1].toLowerCase()).replace('Young hero', 'Young Hero');
        if (/^target/i.test(m[3])) return { op: 'createRole', role, targets: [Object.assign(targetSpec(m[3]), m[2] && /up to/i.test(m[2]) ? { upTo: true } : {}, m[2] && /other|another/i.test(m[2]) ? { another: true } : {})] };
        return { op: 'createRole', role, on: /enchanted|equipped/i.test(m[3]) ? 'attached' : 'it' };
      } },
    // Luminous Guardian: "This creature can block an additional creature this turn."
    { re: /^(?:CARDNAME|This creature) can block an additional (?:creature|(\w+) creatures) this turn\.?$/i,
      make: (m) => ({ op: 'blocksExtraEot', n: m[1] ? num(m[1]) : 1 }) },
    // Azorius Arrester: "detain target creature an opponent controls" (CR 701.35)
    { re: /^Detain (target [a-z ]+?)\.?$/i,
      make: (m) => { const t = tgt(m[1]); return t ? { op: 'sequence', list: [{ op: 'restrict', flag: 'cantAttackOrBlock', duration: 'nextTurn', targets: [t] },
        { op: 'restrict', flag: 'cantActivate', duration: 'nextTurn', scope: 'lastTarget' }] } : null; } },
    // Mobile Fort: "gets +3/-1 until end of turn and can attack this turn as though it didn't have defender"
    { re: /^(?:CARDNAME|This creature) gets ([+-]\d+)\/([+-]\d+) until end of turn and can attack this turn as though it didn'?t have defender\.?$/i,
      make: (m) => ({ op: 'sequence', list: [{ op: 'pump', p: pmNum(m[1]), t: pmNum(m[2]), duration: 'eot', scope: 'self' },
        { op: 'restrict', flag: 'attackDespiteDefender', scope: 'self' }] }) },
    // Rhonas's Last Stand: "Creatures you control don't untap during your next untap step."
    { re: /^(Creatures|Lands|Permanents|Artifacts) you control don'?t untap during your next untap step\.?$/i,
      make: (m) => ({ op: 'noUntap', scope: { who: 'you', what: m[1].toLowerCase().replace(/s$/, '') } }) },
    // Stir the Grave: "Return target creature card with mana value 3 or less from your graveyard to the battlefield."
    { re: /^Return (target [a-z ]+?) card with (?:mana value|converted mana cost) (\d+|X) or less from your graveyard to the battlefield( tapped)?\.?$/i,
      make: (m) => { const t = tgt(m[1] + ' with mana value ' + m[2] + ' or less'); return t ? { op: 'reanimate', tapped: !!m[3], targets: [Object.assign(t, { zone: 'graveyard', controller: 'you' })] } : null; } },
    // Counterbore, Sowing Salt, Quash: the rest of that card's name, from everywhere it could be
    { re: /^Search its controller'?s graveyard, hand, and library for (?:all|any number of) cards with the same name as that (?:spell|card|permanent|land|creature) and exile them\.?$/i,
      make: () => ({ op: 'exileNamedEverywhere' }) },
    { re: /^Then that player shuffles\.?$/i, make: () => ({ op: 'noop' }) },
    // Kozilek: "if you have fewer than seven cards in hand, draw cards equal to the difference"
    { re: /^(?:If you have fewer than (\w+) cards in hand, )?draw cards equal to the difference\.?$/i,
      make: (m) => ({ op: 'draw', who: 'you', n: { handTo: m[1] ? num(m[1]) : 7 } }) },
    // the Rings: "put a +1/+1 counter on equipped creature if it's red"
    { re: /^Put an? ([+\-0-9/a-z]+) counter on (equipped|enchanted) creature if it'?s (white|blue|black|red|green|an? [A-Z][a-z]+)\.?$/i,
      make: (m) => ({ op: 'counters', kind: m[1].toLowerCase(), n: 1, scope: 'attached', ifHost: m[3].replace(/^an? /i, '').toLowerCase() }) },
    // Sacrifice: "Add an amount of {B} equal to the sacrificed creature's mana value."
    { re: /^Add an amount of (\{[WUBRGC]\}) equal to the sacrificed (?:creature|artifact|permanent)'s mana value\.?$/i,
      make: (m) => ({ op: 'addManaPer', symbol: MANA.parse(m[1])[0], per: { ofSacrificed: 'mv' } }) },
    // Bile Blight: "Target creature and all other creatures with the same name as that creature get -3/-3 until end of turn."
    { re: /^(Target creature) and all other creatures with the same name as that creature get ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
      make: (m) => ({ op: 'pumpSameName', p: pmNum(m[2]), t: pmNum(m[3]), targets: [targetSpec(m[1])] }) },
    // Vigilant Martyr: "Counter target spell that targets an enchantment."
    { re: /^Counter target spell that targets an? (enchantment|creature|artifact|land|planeswalker|permanent)( you control)?\.?$/i,
      make: (m) => ({ op: 'counterSpell', targets: [Object.assign({ type: 'spell', zone: 'stack', filter: 'spell', targetsWhat: m[1].toLowerCase() },
        m[2] ? { targetsYour: 'permanent' } : {})] }) },
    // Ratchet Bomb, Blast Zone, Engineered Explosives
    { re: /^Destroy each nonland permanent with mana value equal to the number of ([a-z]+) counters on (?:this artifact|this land|CARDNAME)\.?$/i,
      make: (m) => ({ op: 'destroyByCounterMv', counter: m[1].toLowerCase() }) },
    // Countervailing Winds: "unless its controller pays {1} for each card in your graveyard"
    { re: /^Counter target spell unless its controller pays \{1\} for each (.+?)\.?$/i,
      make: (m) => { const c = countOf(m[1]); return c ? { op: 'unlessPays', who: 'spellController', cost: '{1}', costPer: c,
        then: [{ op: 'counterSpell', targets: [{ type: 'spell', zone: 'stack', filter: 'spell' }] }] } : null; } },
    // Burning Inquiry: "Each player draws three cards, then discards three cards at random."
    { re: /^Each player draws (a|one|two|three|\d+) cards?, then discards (a|one|two|three|\d+) cards? at random\.?$/i,
      make: (m) => [{ op: 'draw', n: num(m[1]), who: 'each' }, { op: 'discard', n: num(m[2]), who: 'each', random: true }] },
    // Aether Gale: "Return six target nonland permanents to their owners' hands."
    { re: /^Return (two|three|four|five|six) target ([a-z ]+?)s to their owners'? hands\.?$/i,
      make: (m) => { const t = tgt('target ' + m[2]); return t ? { op: 'bounce', targets: Array.from({ length: num(m[1]) }, () => Object.assign({}, t, { distinct: true })) } : null; } },
    // Maelstrom Pulse, Echoing Calm: "…and all other permanents with the same name as that permanent"
    { re: /^Destroy (target [a-z ]+?) and all other ([a-z]+)s with the same name as that \2\.?$/i,
      make: (m) => { const t = tgt(m[1]); return t ? { op: 'destroySameName', targets: [t] } : null; } },
    // Final Act: "Each opponent loses all counters."
    { re: /^Each opponent loses all counters\.?$/i, make: () => ({ op: 'clearPlayerCounters', who: 'opponents' }) },
    // Exhume: each player's own pick, all at once
    { re: /^Each player puts a creature card from their graveyard onto the battlefield\.?$/i, make: () => ({ op: 'exhume' }) },
    // Metallurgic Summonings: "Return all instant and sorcery cards from your graveyard to your hand."
    { re: /^Return all ([a-z]+(?: and [a-z]+)?) cards from your graveyard to your hand\.?$/i,
      make: (m) => ({ op: 'regrowthAll', filter: m[1].toLowerCase().replace(/ and /, ' or ') }) },
    // Open the Vaults: from every graveyard, under their owners' control
    { re: /^Return all ([a-z]+(?: and [a-z]+)?) cards from all graveyards to the battlefield under their owners'? control\.?$/i,
      make: (m) => ({ op: 'massReanimate', filter: m[1].toLowerCase().replace(/ and /, ' or '), yours: false }) },
    // Hexplate Wallbreaker: "Untap each attacking creature."
    { re: /^Untap each attacking creature\.?$/i, make: () => ({ op: 'untapAll', scope: { who: 'all', what: 'creature', attacking: true } }) },
    // Vines of Vastwood: "can't be the target of spells or abilities your opponents control this turn" is hexproof
    { re: /^(Target creature|Target permanent) can'?t be the target of spells or abilities your opponents control this turn\.?$/i,
      make: (m) => ({ op: 'grantKeyword', keywords: ['Hexproof'], duration: 'eot', targets: [targetSpec(m[1])] }) },
    // Rootcast Apprenticeship: "Target player creates a 1/1 green Squirrel creature token."
    { re: /^Target (player|opponent) creates (.+)$/i,
      make: (m) => { const inner = parseTokenSentence('Create ' + m[2]); return inner ? Object.assign(inner, { who: 'target', targets: [{ type: 'player', opponent: /opponent/i.test(m[1]) }] }) : null; } },
    // Sower of Temptation: "for as long as this creature remains on the battlefield"
    { re: /^(?:Gain|You gain) control of (target [a-z ]+?) for as long as (?:CARDNAME|this creature) remains on the battlefield\.?$/i,
      make: (m) => ({ op: 'gainControl', until: null, whileSrc: true, whileOnBf: true, targets: [targetSpec(m[1])] }) },
    // Fertilid: someone else's search, onto the battlefield tapped
    { re: /^Target player searches their library for a basic land card, puts it onto the battlefield tapped, then shuffles\.?$/i,
      make: () => ({ op: 'tutor', who: 'target', n: 1, filter: 'basic land', to: 'battlefield', tapped: true, targets: [{ type: 'player' }] }) },
    // Naya Charm: "Return target card from a graveyard to its owner's hand."
    { re: /^Return target (card|creature card|artifact card|instant or sorcery card) from a graveyard to its owner'?s hand\.?$/i,
      make: (m) => ({ op: 'regrowth', targets: [Object.assign(targetSpec('target ' + m[1].replace(/ card$/, '')), { zone: 'graveyard' })] }) },
    // Kenrith: "Put target creature card from a graveyard onto the battlefield under its owner's control."
    { re: /^Put target creature card from a graveyard onto the battlefield under its owner'?s control\.?$/i,
      make: () => ({ op: 'reanimate', ownerControl: true, targets: [{ type: 'creature', zone: 'graveyard' }] }) },
    { re: /^Each opponent gains (one|two|three|\d+) life\.?$/i, make: (m) => ({ op: 'gainLife', n: num(m[1]), who: 'opponents' }) },
    { re: /^Each player gets (a|one|two|\d+) poison counters?\.?$/i, make: (m) => ({ op: 'poison', n: num(m[1]), who: 'each' }) },
    { re: /^Discard (?:all the cards in your hand|your hand)\.?$/i, make: () => ({ op: 'discard', n: 'all', who: 'you' }) },
    // Soul's Majesty: "Draw cards equal to the power of target creature you control."
    { re: /^Draw cards equal to the power of (target creature(?: you control)?)\.?$/i,
      make: (m) => ({ op: 'draw', who: 'you', n: { ofTarget: 'power' }, targets: [targetSpec(m[1])] }) },
    // Immaculate Magistrate: "Put a +1/+1 counter on target creature for each Elf you control."
    { re: /^Put an? ([+\-0-9/a-z]+) counter on (target creature(?: you control)?) for each (.+?)\.?$/i,
      make: (m) => { const c = countOf(m[3]); return c ? { op: 'counters', kind: m[1].toLowerCase(), n: c, targets: [targetSpec(m[2])] } : null; } },
    // Tyrannize, Wit's End: "Target player discards their hand."
    { re: /^(Target player|Target opponent|Each player|Each opponent) discards (?:their|his or her) hand\.?$/i,
      make: (m) => (/^target/i.test(m[1]) ? { op: 'discard', n: 'all', who: 'target', targets: [{ type: 'player', opponent: /opponent/i.test(m[1]) }] }
        : { op: 'discard', n: 'all', who: /opponent/i.test(m[1]) ? 'opponents' : 'each' }) },
    // Infernal Contract: "You lose half your life, rounded up."
    { re: /^You lose half your life, rounded (up|down)\.?$/i, make: (m) => ({ op: 'loseLife', n: { halfLife: 'you', up: /up/i.test(m[1]) }, who: 'you' }) },
    // Blessed Wind: "Target player's life total becomes 20."
    { re: /^Target player'?s life total becomes (\d+)\.?$/i, make: (m) => ({ op: 'setLife', n: +m[1], who: 'target', targets: [{ type: 'player' }] }) },
    // Traumatize, Cut Your Losses: "mills half their library, rounded down"
    { re: /^Target (player|opponent) mills half their library, rounded (down|up)\.?$/i,
      make: (m) => ({ op: 'mill', who: 'target', n: { halfLibrary: 'target', up: /up/i.test(m[2]) }, targets: [{ type: 'player', opponent: /opponent/i.test(m[1]) }] }) },
    // Gilder Bairn: "Double the number of each kind of counter on target permanent."
    { re: /^Double the number of each kind of counter on (target [a-z ]+?)\.?$/i,
      make: (m) => ({ op: 'doubleCounters', allKinds: true, targets: [targetSpec(m[1])] }) },
    // Heartless Act, Glissa Sunslayer: "Remove up to three counters from target creature."
    { re: /^Remove up to (one|two|three|four|\d+) counters? from (target [a-z ]+?)\.?$/i,
      make: (m) => ({ op: 'removeCountersFrom', n: num(m[1]), upTo: true, kind: null, targets: [targetSpec(m[2])] }) },
    // Quiet Disrepair: "Destroy enchanted creature."
    { re: /^Destroy enchanted (creature|permanent|artifact|land)\.?$/i, make: () => ({ op: 'destroy', scope: 'attached' }) },
    // Puffer Extract: "Destroy it at the beginning of the next end step."
    { re: /^Destroy (it|that creature) at the beginning of the next end step\.?$/i,
      make: () => ({ op: 'delayed', event: 'eachEndStep', subject: 'lastTarget', name: 'Destroy it at end of turn',
        effects: [{ op: 'destroyThat' }] }) },
    // Geist of Saint Traft: "Exile that token at end of combat."
    { re: /^Exile (?:that token|it|them|those tokens) at end of combat\.?$/i, make: () => ({ op: 'exileMadeEoc' }) },
    // Path of Peace: "Destroy target creature. Its owner gains 4 life."
    { re: /^Its owner gains (one|two|three|four|five|six|seven|eight|nine|ten|\d+) life\.?$/i,
      make: (m) => ({ op: 'gainLife', n: num(m[1]), who: 'targetOwner' }) },

    { re: /^You gain life equal to the life lost this way\.?$/i, make: () => ({ op: 'gainLife', n: 'lastLifeLost', who: 'you' }) },
    { re: /^You gain (?:that much|the same amount of) life\.?$/i, make: () => ({ op: 'gainLife', n: 'lastLifeLost', who: 'you' }) },
    /* "Whenever you gain life, target opponent loses that much life." —
       the amount is the one that set the trigger off. */
    { re: /^(Target opponent|Target player|Each opponent) loses that much life\.?$/i,
      make: (m) => ({ op: 'loseLife', n: 'triggerAmount', who: /each/i.test(m[1]) ? 'opponents' : 'target',
        targets: /each/i.test(m[1]) ? undefined : [{ type: 'player', opponent: /opponent/i.test(m[1]) }] }) },

    /* "It gains haste." — whatever the sentence before this one was about. */
    { re: /^(?:It|They) gains? ([a-z, ']+?)(?: until end of turn)?\.?$/i,
      make: (m) => {
        if (!KW_LIST.test(m[1])) return null;
        const kws = keywordList(m[1]);
        if (!kws.every(k => kwKnown(k))) return null;
        return { op: 'grantLast', keywords: kws, until: /until end of turn/i.test(m[0]) ? 'eot' : null, plural: /^They/i.test(m[0]) };
      } },
    /* "Exile enchanted creature." */
    { re: /^Exile enchanted (?:creature|permanent)\.?$/i,
      make: () => ({ op: 'exile', scope: 'attached' }) },

    /* Support N (CR 701.33): a counter on each of a few other creatures. */
    { re: /^Support (one|two|three|four|\d+)\.?$/i,
      make: (m) => ({ op: 'counters', kind: '+1/+1', n: 1,
        targets: Array.from({ length: num(m[1]) },
          () => Object.assign(targetSpec('creature'), { upTo: true, other: true })) }) },

    /* Class cards (CR 716): "{1}{W}: Level 2" buys the next level, and
       everything printed under it comes with it. */
    { re: /^Level (\d+)\.?$/i, make: (m) => ({ op: 'classLevel', to: +m[1] }) },

    /* "Untap those creatures." — the ones the sentence before was about. */
    { re: /^Untap (?:those|them|these) creatures\.?$/i, make: () => ({ op: 'untapThose' }) },

    /* Connive (CR 702.153). */
    { re: /^(?:It|CARDNAME|This creature) connives(?: (one|two|three|\d+))?\.?$/i,
      make: (m) => ({ op: 'connive', n: m[1] ? num(m[1]) : 1, scope: 'self' }) },
    { re: /^(Target creature(?: you control)?) connives(?: (one|two|three|\d+|X))?\.?$/i,
      make: (m) => ({ op: 'connive', n: m[2] ? num(m[2]) : 1, targets: [targetSpec(m[1])] }) },

    /* "…copy that spell." */
    { re: /^Copy that spell\.?$/i, make: () => ({ op: 'copyThatSpell' }) },
    { re: /^You may copy that spell\.?$/i, make: () => ({ op: 'may', then: [{ op: 'copyThatSpell' }] }) },

    /* Incubate N: an Incubator token with that many counters waiting on
       it (CR 701.52). */
    { re: /^Incubate (one|two|three|four|five|\d+|X)\.?$/i,
      make: (m) => ({ op: 'createNamedToken', token: 'Incubator', n: 1, withCounters: num(m[1]) }) },
    /* Unearth-style: it gets itself back. */
    { re: /^Return (?:CARDNAME|this card) from your graveyard to the battlefield( tapped)?( with a finality counter on (?:it|him|her|them))?\.?$/i,
      make: (m) => (m[2] ? { op: 'returnSelfFromGrave', tapped: !!m[1], counter: 'finality' } : { op: 'returnSelfFromGrave', tapped: !!m[1] }) },
    /* the self-dies return ("When this creature dies, return it to the
       battlefield tapped under its owner's control with a +1/+1 counter on
       it"), with the "it" already read as the creature itself */
    { re: /^Return CARDNAME to the battlefield( tapped)?( and transformed)?( under (?:its owner'?s|your) control)?(?: with (a|an|one|two|three) ([+\-0-9/a-z]+) counters? on it)?\.?$/i,
      make: (m) => Object.assign({ op: 'returnSelfFromGrave', tapped: !!m[1] }, m[2] ? { transformed: true } : {},
        /owner/i.test(m[3] || '') ? { owner: true } : {},
        m[4] ? { counter: m[5].toLowerCase(), n: num(m[4]) } : {}) },
    { re: /^Return CARDNAME to its owner'?s hand\.?$/i, make: () => ({ op: 'selfFromGraveyard', to: 'hand' }) },

    /* Day and night, and everything else that turns over. */
    { re: /^Transform (?:CARDNAME|this creature|this permanent|it)\.?$/i,
      make: () => ({ op: 'transform', self: true }) },

    // --- damage ---
    // the subject may be the card's own name, "it", "this creature", etc.
    { re: new RegExp("^(?:[A-Za-z][-A-Za-z0-9',\u2019. ]{0,44}?\\s)?deals? (one|two|three|four|five|six|seven|eight|nine|ten|\\d+|X) damage to (" + TGT + ")\\.?$", 'i'),
      make: (m) => { const t = tgt(m[2]); return t ? { op: 'damage', n: num(m[1]), targets: [t] } : null; } },
    { re: /^(?:[A-Za-z][-A-Za-z0-9',\u2019\. ]{0,44}?\s)?deals? (one|two|three|four|five|six|seven|eight|nine|ten|\d+|X) damage to each (creature your opponents control|creature you control|creature|opponent|player|creature and each planeswalker|creature and each player|creature, planeswalker, and player|opponent and each creature they control)\.?$/i,
      make: (m) => ({ op: 'damage', n: num(m[1]), each: m[2].toLowerCase() }) },

    // --- counters ---
    { re: /^Put (a|one|two|three|\d+|X) \+1\/\+1 counters? on (?:up to one )?((?:another )?target creature|(?:another )?target creature you control|it|this creature|CARDNAME|each creature you control)\.?$/i,
      make: (m) => ({ op: 'counters', kind: '+1/+1', n: num(m[1]), targets: /target/.test(m[2]) ? [targetSpec(m[2])] : null, scope: /each/.test(m[2]) ? 'yourCreatures' : (/it|this|CARDNAME/.test(m[2]) ? 'self' : null) }) },
    /* Qarsi Revenant: "Put a flying counter, a deathtouch counter, and a
       lifelink counter on target creature." — one target, several kinds */
    { re: /^Put ((?:an? (?:[a-z]+|first strike|double strike) counter,? )+and an? (?:[a-z]+|first strike|double strike) counter) on ((?:another )?target [a-z ]+)\.?$/i,
      make: (m) => {
        const kinds = [...m[1].matchAll(/an? ((?:first |double )?[a-z]+) counter/gi)].map(x => x[1].toLowerCase());
        return { op: 'sequence', list: kinds.map((k, i) => (i === 0
          ? { op: 'counters', kind: k, n: 1, targets: [targetSpec(m[2])] }
          : { op: 'counters', kind: k, n: 1, scope: 'lastTarget' })) };
      } },
    { re: /^Put (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) (-1\/-1|\+1\/\+1|(?:first|double) strike|[a-z]+) counters? on ((?:another )?target [a-z ]+|it|this creature|this (?:enchantment|artifact|permanent|land|Vehicle)|CARDNAME)\.?$/i,
      make: (m) => ({ op: 'counters', kind: m[2], n: num(m[1]), targets: /target/.test(m[3]) ? [targetSpec(m[3])] : null, scope: /it|this|CARDNAME/.test(m[3]) ? 'self' : null }) },

    // --- removal / zone changes ---
    /* ===== exile that comes back when the jailer leaves ===== */
    { re: /^Exile (up to one )?(target [a-z0-9 ,'-]+?|(?:another|other) target [a-z0-9 ,'-]+?) until (?:CARDNAME|this (?:creature|enchantment|artifact|permanent|Aura)) leaves the battlefield\.?$/i,
      make: (m) => ({ op: 'exileUntilLeaves', targets: [Object.assign(targetSpec(m[2].replace(/^(?:another|other) /i, '')), m[1] ? { upTo: true } : {},
        /^(?:another|other) /i.test(m[2]) ? { another: true } : {})] }) },
    // Ixalan's Binding's kin, en masse: "exile all artifacts your opponents control until this … leaves"
    { re: /^Exile (all|each) ([a-z0-9 ,'-]+?) until (?:CARDNAME|this (?:creature|enchantment|artifact|permanent)) leaves the battlefield\.?$/i,
      make: (m) => {
        const words = /^each$/i.test(m[1]) ? m[2].replace(/^([a-z]+(?: [a-z]+)??) ?(permanent|creature|artifact|enchantment|land)\b/i, (x) => x + 's') : m[2];
        const sc = scopeOf(words);
        return sc ? { op: 'exileAllUntilLeaves', scope: sc } : null;
      } },
    // Oubliette: "target creature phases out until this enchantment leaves the battlefield"
    { re: /^(target [a-z ]+?) phases out until (?:CARDNAME|this (?:creature|enchantment|artifact|permanent)) leaves the battlefield\.?$/i,
      make: (m) => ({ op: 'phaseOutUntilLeaves', targets: [targetSpec(m[1])] }) },
    { re: /^Return the exiled cards? to the battlefield under (?:its owner'?s|their owners'?|your) control\.?$/i,
      make: () => ({ op: 'returnExiled' }) },
    { re: /^Return (?:that card|the exiled card) to the battlefield under (?:its owner'?s|your) control\.?$/i,
      make: () => ({ op: 'returnExiled' }) },
    { re: /^Destroy (target [a-z0-9 '-]+?)\.?$/i,
      make: (m) => ({ op: 'destroy', targets: [targetSpec(m[1])] }) },
    { re: /^Destroy (X|\d+) (target [a-z0-9 '-]+?)s\.?$/i,
      make: (m) => (m[1] === 'X'
        // "Destroy X target artifacts": X of them, the X paid
        ? { op: 'destroy', targets: [Object.assign(targetSpec(m[2]), { multi: { count: 'X', exact: true } })] }
        : { op: 'destroy', targets: Array.from({ length: +m[1] }, () => targetSpec(m[2])) }) },
    { re: /^Destroy (target [a-z0-9 '-]+?)\. It can't be regenerated\.?$/i,
      make: (m) => ({ op: 'destroy', noRegen: true, targets: [targetSpec(m[1])] }) },
    { re: /^Exile (target [a-z0-9 '-]+?)\.?$/i,
      make: (m) => ({ op: 'exile', targets: [targetSpec(m[1])] }) },
    // Solitude: "Exile up to one other target creature."
    { re: /^(Exile|Destroy) up to one (other |another )?target ([a-z0-9 '-]+?)\.?$/i,
      make: (m) => ({ op: m[1].toLowerCase(), targets: [Object.assign(targetSpec('target ' + m[3]), { upTo: true }, m[2] ? { another: true } : {})] }) },
    // Bottomless Pool: "Return up to one target creature to its owner's hand."
    { re: /^Return up to one (other )?target ([a-z ]+?) to its owner'?s hand\.?$/i,
      make: (m) => ({ op: 'bounce', targets: [Object.assign(targetSpec('target ' + m[2]), { upTo: true }, m[1] ? { another: true } : {})] }) },
    // Ulamog: "Defending player exiles the top twenty cards of their library."
    { re: /^(Defending player|Target player|Each opponent) exiles the top (\w+) cards of their library\.?$/i,
      make: (m) => (typeof num(m[2]) === 'number' ? Object.assign({ op: 'exileTop', n: num(m[2]),
        who: /defending/i.test(m[1]) ? 'defending' : /each/i.test(m[1]) ? 'opponents' : 'target' },
        /^target/i.test(m[1]) ? { targets: [{ type: 'player' }] } : {}) : null) },
    // Flare of Malice, Soul Shatter
    // Myrkul's Edict, Professor Onyx, Consumed by Greed, Olórin's Searing Light: the biggest by power
    { re: /^(Each opponent|Target opponent) (sacrifices|exiles) a creature with the greatest power among creatures (?:that player|they) controls?\.?$/i,
      make: (m) => Object.assign({ op: 'sacGreatestMv', what: ['creature'], by: 'power' },
        /^target/i.test(m[1]) ? { who: 'target', targets: [{ type: 'player', opponent: true }] } : {},
        /exile/i.test(m[2]) ? { exile: true } : {}) },
    { re: /^Each opponent sacrifices an? (creature or planeswalker|creature) with the greatest mana value among (?:creatures and planeswalkers|creatures) they control\.?$/i,
      make: (m) => ({ op: 'sacGreatestMv', what: m[1].toLowerCase().split(' or ') }) },
    // Homeward Path
    { re: /^Each player gains control of all creatures they own\.?$/i, make: () => ({ op: 'controlToOwners' }) },
    // Hellkite Tyrant
    { re: /^Gain control of all artifacts that player controls\.?$/i, make: () => ({ op: 'stealAllArtifacts' }) },
    // Wound Reflection: "each opponent loses life equal to the life they lost this turn"
    { re: /^Each opponent loses life equal to the life they lost this turn\.?$/i, make: () => ({ op: 'woundReflection' }) },
    /* "Exile two target permanents", "destroy up to three target
       artifacts", "return up to two target creatures to their owners'
       hands": the same effect pointed at a list. */
    { re: /^(Destroy|Exile|Return) (up to )?(two|three|four|five) target ([a-z][a-z '-]*?)s(?: and\/or ([a-z]+?)s)?( to their owners'? hands?)?\.?$/i,
      make: (m) => {
        const verb = m[1].toLowerCase();
        if ((verb === 'return') !== !!m[6]) return null;
        const op = verb === 'return' ? 'bounce' : verb;
        const what = m[5] ? m[4] + ' or ' + m[5] : m[4];
        return { op, targets: Array.from({ length: num(m[3]) },
          () => Object.assign(targetSpec(what), m[2] ? { upTo: true } : {})) };
      } },
    /* Decimate: one of each, each its own target */
    { re: /^(Destroy|Exile) (target [a-z]+(?:, target [a-z]+)+,? and target [a-z]+)\.?$/i,
      make: (m) => ({ op: m[1].toLowerCase(), targets: m[2].split(/,? (?:and )?(?=target )/i).map(x => targetSpec(x.trim())) }) },
    { re: /^(?:Its|Their) owner shuffles (?:their|his or her) graveyard into (?:their|his or her) library\.?$/i,
      make: () => ({ op: 'graveyardToLibrary' }) },
    { re: /^Return (target [a-z0-9 '-]+?) to (its|their) owner's hand\.?$/i,
      make: (m) => ({ op: 'bounce', targets: [targetSpec(m[1])] }) },
    { re: /^Return (target [a-z0-9 '-]+?) from your graveyard to your hand\.?$/i,
      make: (m) => ({ op: 'regrowth', targets: [Object.assign(targetSpec(m[1], 'graveyard'), { controller: 'you' })] }) },
    { re: /^Counter (target spell|target creature spell|target noncreature spell|target instant or sorcery spell|target activated or triggered ability)\.?$/i,
      make: (m) => ({ op: 'counterSpell', targets: [targetSpec(m[1])] }) },
    { re: /^Sacrifice (this creature|this artifact|this permanent|~)\.?$/i,
      make: () => ({ op: 'sacrificeSelf' }) },

    // --- tapping ---
    { re: /^Tap (target [a-z0-9 '-]+?)\.?$/i, make: (m) => ({ op: 'tap', targets: [targetSpec(m[1])] }) },
    /* "up to two target creatures" — the same effect, pointed at a list,
       and the player may point at fewer. */
    { re: /^Tap up to (one|two|three|\d+) target ([a-z][a-z '-]*?)s\.?$/i,
      make: (m) => ({ op: 'tap', targets: Array.from({ length: num(m[1]) },
        () => Object.assign(targetSpec(m[2]), { upTo: true })) }) },
    { re: /^Untap up to (one|two|three|\d+) target ([a-z][a-z '-]*?)s\.?$/i,
      make: (m) => ({ op: 'untap', targets: Array.from({ length: num(m[1]) },
        () => Object.assign(targetSpec(m[2]), { upTo: true })) }) },
    { re: /^Return up to (one|two|three|\d+) target ([a-z][a-z '-]*?) cards? from your graveyard to your hand\.?$/i,
      make: (m) => ({ op: 'regrowth', targets: Array.from({ length: num(m[1]) },
        () => Object.assign(targetSpec(m[2], 'graveyard'), { upTo: true, controller: 'you' })) }) },
    { re: /^Each player discards (a|one|two|three|\d+) cards?\.?$/i,
      make: (m) => ({ op: 'discard', n: num(m[1]), who: 'each' }) },
    { re: /^Each opponent discards (a|one|two|three|\d+) cards?\.?$/i,
      make: (m) => ({ op: 'discard', n: num(m[1]), who: 'opponents' }) },
    { re: /^Untap ((?:another )?target [a-z0-9 '-]+?)\.?$/i, make: (m) => ({ op: 'untap', targets: [targetSpec(m[1])] }) },
    { re: /^Untap (?:CARDNAME|this (?:creature|permanent|artifact|land|enchantment)|it|~)\.?$/i,
      make: () => ({ op: 'untap', scope: 'self' }) },
    { re: /^Tap (?:CARDNAME|this (?:creature|permanent|artifact|land|enchantment)|it|~)\.?$/i,
      make: () => ({ op: 'tap', scope: 'self' }) },
    { re: /^Exile (?:CARDNAME|this (?:creature|permanent|artifact|land|enchantment)|~)\.?$/i,
      make: () => ({ op: 'exileSelf' }) },
    { re: /^Transform (?:CARDNAME|this (?:creature|permanent|artifact|land|enchantment)|~)\.?$/i,
      make: () => ({ op: 'transformSelf' }) },
    { re: /^Shuffle (?:CARDNAME|this card|it) into (?:its|their) owner'?s library\.?$/i,
      make: () => ({ op: 'selfToLibrary', shuffle: true }) },
    { re: /^Return (?:CARDNAME|this card) from your graveyard to your hand\.?$/i,
      make: () => ({ op: 'selfFromGraveyard', to: 'hand' }) },
    { re: /^Return (?:CARDNAME|this card) from your graveyard to the battlefield\.?$/i,
      make: () => ({ op: 'selfFromGraveyard', to: 'battlefield' }) },
    { re: /^Sacrifice (?:CARDNAME|it)\.?$/i, make: () => ({ op: 'sacrificeSelf' }) },
    { re: /^Regenerate (?:CARDNAME|this permanent|this artifact|this land)\.?$/i, make: () => ({ op: 'regenerate', scope: 'self' }) },

    // --- pump ---
    { re: /^((?:Another )?[Tt]arget creature(?: you control| an opponent controls)?|Target attacking creature|Target blocking creature|CARDNAME|This creature|It|That creature) gets ([+-][\dX]+)\/([+-][\dX]+) until end of turn\.?$/i,
      make: (m) => ({ op: 'pump', p: pmNum(m[2]), t: pmNum(m[3]), duration: 'eot',
        targets: /^(?:another )?target/i.test(m[1]) ? [targetSpec(m[1])] : null,
        scope: /^(?:this|CARDNAME)/i.test(m[1]) ? 'self' : (/^(it|that creature)$/i.test(m[1]) ? 'lastTarget' : null) }) },
    { re: /^Creatures you control get ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
      make: (m) => ({ op: 'pump', p: +m[1], t: +m[2], duration: 'eot', scope: 'yourCreatures' }) },
    { re: /^((?:Another )?[Tt]arget creature(?: you control| an opponent controls)?|Target attacking creature|Target blocking creature|CARDNAME|This creature|It|That creature) gains ([a-z ,]+) until end of turn\.?$/i,
      make: (m) => ({ op: 'grantKeyword', keywords: m[2].split(/,| and /).map(s => U.titleCase(s.trim())).filter(Boolean),
        duration: 'eot',
        targets: /^(?:another )?target/i.test(m[1]) ? [targetSpec(m[1])] : null,
        scope: /^(?:this|CARDNAME)/i.test(m[1]) ? 'self' : (/^(it|that creature)$/i.test(m[1]) ? 'lastTarget' : null) }) },
    /* the same for any other kind of target ("target permanent you
       control", "target legendary creature"), with keywords the table
       knows */
    { re: /^((?:Another )?[Tt]arget [a-z ]+?) gains ([a-z ,]+) until end of turn\.?$/i,
      make: (m) => {
        const kws = keywordList(m[2]);
        if (!kws.every(k => kwKnown(k) || /^protection from /i.test(k))) return null;
        return { op: 'grantKeyword', keywords: kws, duration: 'eot', targets: [targetSpec(m[1])] };
      } },

    // --- library manipulation ---
    { re: /^Scry (\d+)\.?$/i, make: (m) => ({ op: 'scry', n: +m[1] }) },
    { re: /^Surveil (\d+)\.?$/i, make: (m) => ({ op: 'surveil', n: +m[1] }) },
    { re: /^Mill (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+|X) cards?\.?$/i, make: (m) => ({ op: 'mill', n: num(m[1]), who: 'you' }) },
    { re: /^(?:Then )?[Ll]earn\.?$/, make: () => ({ op: 'learn' }) },
    /* "Tap two target creatures." */
    { re: /^(Tap|Untap) (two|three|four) target ([a-z][a-z '-]*?)s\.?$/i,
      make: (m) => ({ op: m[1].toLowerCase(), targets: Array.from({ length: num(m[2]) }, () => targetSpec('target ' + m[3])) }) },
    { re: /^(Target player|Each player) shuffles their graveyard into their library\.?$/i,
      make: (m) => (/^target/i.test(m[1]) ? { op: 'graveyardToLibrary', who: 'target', targets: [{ type: 'player' }] }
        : { op: 'graveyardToLibrary', who: 'each' }) },
    /* "This creature loses flying until end of turn." */
    { re: /^(target creature|CARDNAME|this creature) loses ([a-z ,]+?) until end of turn\.?$/i,
      make: (m) => {
        const kws = keywordList(m[2]);
        if (!kws.length || !kws.every(kwKnown)) return null;
        const tgt = /^target/i.test(m[1]);
        return { op: 'loseKeyword', keywords: kws, duration: 'eot', targets: tgt ? [targetSpec(m[1])] : null, scope: tgt ? null : 'self' };
      } },
    /* "Up to two target creatures each get +1/+1 and gain lifelink until
       end of turn": one pump for the lot, then the same ones gain it */
    { re: /^(Up to )?(two|three|four) target ([a-z][a-z '-]*?)s each get ([+-]\d+)\/([+-]\d+)(?: and gain ([a-z ,]+?))? until end of turn\.?$/i,
      make: (m) => {
        const kws = m[6] ? keywordList(m[6]) : [];
        if (m[6] && (!kws.length || !kws.every(kwKnown))) return null;
        const pump = { op: 'pump', p: pmNum(m[4]), t: pmNum(m[5]), duration: 'eot',
          targets: Array.from({ length: num(m[2]) }, () => Object.assign(targetSpec('target ' + m[3]), m[1] ? { upTo: true } : {})) };
        return kws.length ? { op: 'sequence', list: [pump, { op: 'grantKeyword', keywords: kws, duration: 'eot', scope: 'lastGroup' }] } : pump;
      } },
    /* Melt Terrain, Ionize: "… deals 2 damage to that land's controller" */
    { re: /^(?:CARDNAME|This (?:creature|artifact|enchantment|spell|Aura|Equipment)|It) deals (\d+|X) damage to that (?:spell|land|artifact|creature|permanent|enchantment|planeswalker)'s controller\.?$/i,
      make: (m) => ({ op: 'damage', n: num(m[1]), toAffectedController: true }) },
    /* "Destroy it." after a trigger about a permanent: that permanent */
    { re: /^Destroy (?:it|that land|that permanent|that artifact)\.?$/i,
      make: () => ({ op: 'destroy', scope: 'lastTarget' }) },
    /* "Create a token that's a copy of that creature": the one the trigger is about */
    { re: /^Create a token that'?s a copy of (?:it|that creature|that artifact|that permanent)\.?$/i,
      make: () => ({ op: 'copyPermanent', n: 1, scope: 'lastTarget', grant: [] }) },
    /* "You get an emblem with 'Creatures you control get +2/+2 and have
       flying.'" — one or more abilities in quotation marks */
    { re: /^You get an emblem with ("[^"]+"(?:,? and "[^"]+")*)\.?$/i,
      make: (m) => {
        const text = [...m[1].matchAll(/"([^"]+)"/g)].map(x => x[1].trim())
          // Liliana of the Dark Realms: "Swamps you control have '{T}: Add {B}{B}{B}{B}.'" — the inner quotation
          .map(x => x.replace(/ (has|have) '(.+)'\.?$/, ' $1 "$2"')).join('\n');
        return emblemText(text) ? { op: 'getEmblem', emblemText: text } : null;
      } },
    { re: /^Each opponent mills (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+|X) cards?\.?$/i, make: (m) => ({ op: 'mill', n: num(m[1]), who: 'opponents' }) },
    /* "You may put a creature card from among the milled cards into your
       hand": one of what the mill just put in the graveyard */
    { re: /^(?:Then )?(you may )?(?:put|return) (?:a|an|one|up to one) ([a-z, ]*?)card from among (?:the milled cards|the cards milled this way|those cards) (?:into|to) your hand\.?$/i,
      make: (m) => ({ op: 'takeFromMilled', n: 1, filter: m[2].trim() || 'any', optional: !!m[1] }) },
    // Smuggler's Surprise: "You may put up to two creature and/or land cards from among the milled cards into your hand."
    { re: /^(?:Then )?(you may )?(?:put|return) up to (two|three|four) ([a-z, \/]*?)cards from among (?:the milled cards|the cards milled this way|them) (?:into|to) your hand\.?$/i,
      make: (m) => ({ op: 'takeFromMilled', n: num(m[2]), filter: m[3].replace(/ and\/or /g, ' or ').trim() || 'any', optional: true }) },
    { re: /^Target player mills (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+|X) cards?\.?$/i, make: (m) => ({ op: 'mill', n: num(m[1]), who: 'target', targets: [{ type: 'player' }] }) },

    // --- tokens ---
    /* Every creature token sentence, in one reading: how many, tapped or
       not, size, colours, types, keywords, a granted ability, attacking,
       and "where X is the number of …". */
    { re: /^Create .+ creature tokens?\b.*$/i, make: (m) => parseTokenSentence(m[0]) },
    // Mahadi: "Create a Treasure token for each creature that died this turn."
    { re: /^Create (?:a|an|one) (tapped )?(Treasure|Clue|Food|Blood|Map|Junk|Powerstone|Gold|Shard) token for each (.+?)\.?$/i,
      make: (m) => { const c = countOf(m[3]); return c ? Object.assign({ op: 'createNamedToken', n: c, token: m[2] }, m[1] ? { tapped: true } : {}) : null; } },
    { re: /^Create (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+|X) (Treasure|Clue|Food|Blood|Map|Junk|Powerstone|Incubator|Gold|Shard|Walker) tokens?\.?$/i,
      make: (m) => ({ op: 'createNamedToken', n: num(m[1]), token: m[2] }) },

    // --- sentences that need no action from the engine ---
    /* "They can't be regenerated": a rider on the destruction before it,
       folded into it as the sentences are put together */
    { re: /^(?:They|It) can'?t be regenerated\.?$/i, make: () => ({ op: 'noop', noRegenRider: true }) },
    { re: /^(?:This|That) creature can'?t be regenerated\.?$/i, make: () => ({ op: 'noop', noRegenRider: true }) },
    { re: /^Activate (?:this ability )?only as a sorcery\.?$/i, make: () => ({ op: 'noop' }) },
    { re: /^Activate (?:this ability )?only any time you could cast a sorcery\.?$/i, make: () => ({ op: 'noop' }) },
    // "Activate only once each turn", "Activate no more than twice each turn": counted, each turn
    { re: /^Activate (?:this ability )?only once each turn\.?$/i, make: () => ({ op: 'activateOnly', perTurn: 1 }) },
    { re: /^Activate (?:this ability )?no more than (twice|three times|four times) each turn\.?$/i,
      make: (m) => ({ op: 'activateOnly', perTurn: /twice/i.test(m[1]) ? 2 : /three/i.test(m[1]) ? 3 : 4 }) },
    /* "Activate only during your turn" (any time in it, not only as a
       sorcery), "only during combat", "only during your upkeep" */
    { re: /^Activate (?:this ability )?only during (your turn|combat|your upkeep)\.?$/i,
      make: (m) => ({ op: 'activateOnly', when: /turn/i.test(m[1]) ? 'yourTurn' : /combat/i.test(m[1]) ? 'combat' : 'yourUpkeep' }) },
    // Vivi Ornitier, Nimbleclaw Adept: two restrictions at once
    { re: /^Activate (?:this ability )?only (during your turn|as a sorcery) and only once each turn\.?$/i,
      make: (m) => Object.assign({ op: 'activateOnly', perTurn: 1 }, /turn/i.test(m[1]) ? { when: 'yourTurn' } : {}) },
    /* "Cast this spell only during combat": when it may be cast (CR 601.3),
       kept by the table as the spell is cast */
    { re: /^Cast (?:CARDNAME|this spell) only (?!from )(.+?)\.?$/i,
      make: (m) => { const w = castWindowOf(m[1]); return w ? { op: 'noop', castWindow: w } : null; } },
    { re: /^Until end of turn, you don'?t lose this mana as steps and phases end\.?$/i, make: () => ({ op: 'noop' }) },
    { re: /^You may choose new targets for (?:the|that) cop(?:y|ies)\.?$/i, make: () => ({ op: 'noop' }) },
    { re: /^(?:Then )?shuffle your library\.?$/i, make: () => ({ op: 'shuffle' }) },
    { re: /^If you do, .*$/i, make: (m) => ({ op: 'manual', text: m[0] }) },
    /* Restrictions that belong to the ability above them, and that the
       engine can actually keep: a window in the turn, or something you
       have to control. */
    { re: /^Activate (?:this ability )?only during your turn, before attackers are declared\.?$/i,
      make: () => ({ op: 'activateOnly', when: 'beforeAttackers' }) },
    { re: /^Activate (?:this ability )?only during (?:your|the) (?:upkeep|end step|main phase)\.?$/i,
      make: (m) => ({ op: 'activateOnly', when: (m[0].match(/upkeep|end step|main phase/i) || [''])[0].toLowerCase().replace(' ', '') }) },
    /* "…only if there are four or more card types among cards in your
       graveyard and only as a sorcery": the sorcery half is read off the
       line by the ability itself. */
    { re: /^Activate (?:this ability )?only if (.+?) and only as a sorcery\.?$/i,
      make: (m) => { const c = condOf(m[1]); return c ? { op: 'activateOnly', cond: c } : null; } },
    { re: /^Activate (?:this ability )?only as a sorcery and only if (.+?)\.?$/i,
      make: (m) => { const c = condOf(m[1]); return c ? { op: 'activateOnly', cond: c } : null; } },
    { re: /^Activate (?:this ability )?only if (.+?)\.?$/i,
      make: (m) => { const c = condOf(m[1]); return c ? { op: 'activateOnly', cond: c } : null; } },
    { re: /^Any player may activate this ability\.?$/i, make: () => ({ op: 'activateOnly', anyPlayer: true }) },
    { re: /^(?:Untap|Tap) that creature\.?$/i, make: (m) => ({ op: /^Untap/i.test(m[0]) ? 'untap' : 'tap', scope: 'lastTarget' }) },
    { re: /^Then shuffle\.?$/i, make: () => ({ op: 'shuffle' }) },

    // --- mass removal ---
    { re: /^Destroy all creatures\.?(?: They can'?t be regenerated\.?)?$/i,
      make: (m) => Object.assign({ op: 'destroyAll', what: 'creature' }, /regenerated/i.test(m[0]) ? { noRegen: true } : {}) },
    { re: /^Destroy all (creatures|artifacts|enchantments|lands|planeswalkers|nonland permanents|permanents)\.?(?: They can'?t be regenerated\.?)?$/i,
      make: (m) => Object.assign({ op: 'destroyAll', what: m[1].toLowerCase() }, /regenerated/i.test(m[0]) ? { noRegen: true } : {}) },
    { re: /^Exile all (creatures|artifacts|enchantments|nonland permanents|permanents)\.?$/i,
      make: (m) => ({ op: 'exileAll', what: m[1].toLowerCase() }) },
    { re: /^Return all (creatures|artifacts|enchantments|nonland permanents|permanents) to their owners'? hands?\.?$/i,
      make: (m) => ({ op: 'bounceAll', what: m[1].toLowerCase() }) },
    { re: /^Each player sacrifices (a|one|two|\d+) creatures?\.?$/i,
      make: (m) => ({ op: 'sacrificeChoice', n: num(m[1]), who: 'each', filter: 'creature' }) },
    /* "Sacrifice a creature." on its own — you, choosing, as part of what
       this card does rather than as a cost. */
    { re: /^Sacrifice (a|an|one|two|\d+) (?:other )?(creature|permanent|artifact|enchantment|land|token)s?\.?$/i,
      make: (m) => ({ op: 'sacrificeChoice', n: num(m[1]), who: 'you', filter: m[2].toLowerCase(),
        other: /other/i.test(m[0]) }) },
    { re: /^Sacrifice another creature\.?$/i,
      make: () => ({ op: 'sacrificeChoice', n: 1, who: 'you', filter: 'creature', other: true }) },
    /* Shuffle riders: the engine shuffles when it searches, so the sentence
       that says so is describing what already happened. */
    { re: /^(?:Then that player shuffles|Then shuffle|That player shuffles|Shuffle your library|Then shuffle your library)\b.*$/i,
      make: () => ({ op: 'noop' }) },
    { re: /^If you search(?:ed)? your library this way, shuffle(?: it)?\.?$/i, make: () => ({ op: 'noop' }) },
    { re: /^Each opponent sacrifices (a|one|two|\d+) (creature|permanent|artifact|enchantment|land)s?\.?$/i,
      make: (m) => ({ op: 'sacrificeChoice', n: num(m[1]), who: 'opponents', filter: m[2].toLowerCase() }) },
    { re: /^Target player sacrifices (a|one|two|\d+) (creature|permanent|artifact|enchantment|land)s? of their choice\.?$/i,
      make: (m) => ({ op: 'sacrificeChoice', n: num(m[1]), who: 'target', filter: m[2].toLowerCase(), targets: [{ type: 'player' }] }) },
    // Pick Your Poison: "Each opponent sacrifices a creature with flying of their choice."
    { re: /^Each opponent sacrifices (a|one|two|\d+) (creature|permanent|artifact)s? with (flying|reach|deathtouch|trample|haste|defender) of their choice\.?$/i,
      make: (m) => ({ op: 'sacrificeChoice', n: num(m[1]), who: 'opponents', filter: m[2].toLowerCase(), keyword: m[3].toLowerCase() }) },
    { re: /^Each opponent sacrifices (a|one|two|\d+) (creature|permanent|artifact|enchantment|land)s? of their choice\.?$/i,
      make: (m) => ({ op: 'sacrificeChoice', n: num(m[1]), who: 'opponents', filter: m[2].toLowerCase() }) },
    { re: /^Target player sacrifices (a|one|two|\d+) (creature|permanent|artifact|enchantment|land)s?\.?$/i,
      make: (m) => ({ op: 'sacrificeChoice', n: num(m[1]), who: 'target', filter: m[2].toLowerCase(), targets: [{ type: 'player' }] }) },

    // --- fight, control, counters on many things ---
    { re: /^(?:It|CARDNAME|This creature) fights (up to one )?(target creature(?: you don'?t control| an opponent controls)?|another target creature)\.?$/i,
      make: (m) => ({ op: 'fightSelf', targets: [Object.assign(targetSpec(m[2]), m[1] ? { upTo: true } : {})] }) },
    { re: /^Target creature you control fights target creature you don'?t control\.?$/i,
      make: () => ({ op: 'fight', targets: [{ type: 'creature', controller: 'you' }, { type: 'creature', controller: 'opponent' }] }) },
    // Domri Rade, Clash of Titans: two targets, the second never the first
    { re: /^(Target creature(?: you control)?) fights (another target creature|target creature an opponent controls)\.?$/i,
      make: (m) => ({ op: 'fight', targets: [targetSpec(m[1]), Object.assign(targetSpec(m[2].replace(/^another /i, '')), { distinct: true })] }) },
    /* "Target creature deals damage to itself equal to its power." */
    { re: /^Target creature deals damage to itself equal to its power\.?$/i,
      make: () => ({ op: 'selfBite', targets: [{ type: 'creature' }] }) },

    /* A one-sided fight: it hits, and nothing hits it back. */
    { re: /^Target creature you control deals damage equal to its power to target creature(?: you don'?t control| an opponent controls)?\.?$/i,
      make: () => ({ op: 'bite',
        targets: [{ type: 'creature', controller: 'you' },
          Object.assign(targetSpec('creature'), /you don'?t control|an opponent controls/i.test('') ? {} : {})] }) },
    { re: /^Target creature you control deals damage equal to its power to (?:target )?(?:each )?(player|opponent|target player|any target)\.?$/i,
      make: (m) => ({ op: 'bite', toPlayer: true,
        targets: [{ type: 'creature', controller: 'you' }, { type: 'player' }] }) },
    { re: /^Gain control of target (creature|permanent|artifact)(?: until end of turn)?\.?$/i,
      make: (m) => ({ op: 'gainControl', until: /until end of turn/i.test(m[0]) ? 'eot' : null, targets: [targetSpec('target ' + m[1])] }) },
    // Archmage's Charm: "...with mana value 1 or less"
    { re: /^Gain control of (target (?:nonland )?(?:creature|permanent|artifact) with mana value \d+ or less)\.?$/i,
      make: (m) => ({ op: 'gainControl', until: null, targets: [targetSpec(m[1])] }) },
    /* Threaten: "Untap target creature and gain control of it until end of turn." */
    { re: /^Untap (target [a-z' ]+?) and gain control of it until end of turn\.?$/i,
      make: (m) => ({ op: 'gainControl', until: 'eot', untap: true, targets: [targetSpec(m[1])] }) },
    { re: /^Gain control of (target [a-z' ]+?) until end of turn\. Untap (?:it|that creature)\.?$/i,
      make: (m) => ({ op: 'gainControl', until: 'eot', untap: true, targets: [targetSpec(m[1])] }) },
    /* What a creature is, for the rest of the turn: Turn to Frog, Ovinize,
       Animate Land, Merfolk Trickster's "It loses all abilities until end of
       turn". Each part in its layer (becomesEff). */
    { re: /^(?:Until end of turn, )?((?:another )?target (?:creature|land|artifact|permanent)(?: you control| an opponent controls| you don'?t control)?|it|that creature|CARDNAME|this creature|this land|creatures your opponents control|all creatures|each creature|other creatures you control) ((?:loses?|becomes?|has|have|gains?|is|are) .+?)(?: until end of turn)?\.?$/i,
      make: (m) => {
        if (!/until end of turn/i.test(m[0])) return null;
        const eff = becomesEff(m[2]);
        if (!eff || !(eff.loseAll || eff.setPt || eff.setCreatureTypes || eff.addTypes || eff.setTypes)) return null;
        return becomesSubject(m[1], eff, 'eot');
      } },
    /* Twisted Image: power and toughness switched (layer 7d) */
    { re: /^Switch (target creature|CARDNAME|this creature|it)'s power and toughness until end of turn\.?$/i,
      make: (m) => becomesSubject(m[1], { switchPt: true }, 'eot') },
    /* Switcheroo: both change hands at once (CR 701.12b) */
    { re: /^Exchange control of two target (creatures|artifacts|lands|permanents|enchantments)\.?$/i,
      make: (m) => {
        const one = m[1].replace(/s$/, '');
        return { op: 'exchangeControl', targets: [targetSpec('target ' + one), targetSpec('another target ' + one)] };
      } },
    /* Mirrorweave: a copy effect on every other creature, for the turn */
    { re: /^Each other creature becomes a copy of (target [a-z ]+?) until end of turn\.?$/i,
      make: (m) => ({ op: 'becomeCopyAll', duration: 'eot', targets: [targetSpec(m[1])] }) },
    { re: /^Untap target creature\. It gains haste until end of turn\.?$/i,
      make: () => ({ op: 'untapHaste', targets: [{ type: 'creature' }] }) },
    { re: /^Proliferate\.?$/i, make: () => ({ op: 'proliferate' }) },
    // Contagion Engine: "Proliferate twice."
    { re: /^Proliferate (twice|three times)\.?$/i, make: (m) => ({ op: 'sequence', list: Array.from({ length: /twice/i.test(m[1]) ? 2 : 3 }, () => ({ op: 'proliferate' })) }) },
    { re: /^Put a \+1\/\+1 counter on each creature you control\.?$/i,
      make: () => ({ op: 'counters', kind: '+1/+1', n: 1, scope: 'yourCreatures' }) },
    { re: /^(?:Each creature you control|Creatures you control) gets? ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
      make: (m) => ({ op: 'pump', p: +m[1], t: +m[2], duration: 'eot', scope: 'yourCreatures' }) },
    { re: /^(?:Each creature|All creatures) gets? ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
      make: (m) => ({ op: 'pump', p: +m[1], t: +m[2], duration: 'eot', scope: 'allCreatures' }) },
    { re: /^Tap all creatures (?:your opponents control|target player controls)\.?$/i,
      make: () => ({ op: 'tapAll', what: 'creatures', who: 'opponents' }) },

    // --- library and graveyard ---
    { re: /^Return target creature card from your graveyard to the battlefield\.?$/i,
      make: () => ({ op: 'reanimate', targets: [{ type: 'creature', zone: 'graveyard', controller: 'you' }] }) },
    { re: /^Return target card from your graveyard to your hand\.?$/i,
      make: () => ({ op: 'regrowth', targets: [{ type: 'card', zone: 'graveyard', controller: 'you' }] }) },
    { re: /^Exile target player'?s graveyard\.?$/i,
      make: () => ({ op: 'exileGraveyard', targets: [{ type: 'player' }] }) },
    { re: /^Exile all cards from all graveyards\.?$/i, make: () => ({ op: 'exileGraveyard', who: 'all' }) },
    { re: /^Draw a card, then discard a card\.?$/i, make: () => ({ op: 'drawDiscard', n: 1 }) },

    // --- blink / flicker ---
    { re: /^Exile (target creature you control|target creature|target nonland permanent you control|CARDNAME)[,.]? (?:then )?returns? (?:it|that card) to the battlefield(?: under (?:its owner'?s|your) control)?(?: at the beginning of the next end step)?\.?$/i,
      make: (m) => ({ op: 'blink', targets: /CARDNAME/i.test(m[1]) ? [] : [targetSpec(m[1])], self: /CARDNAME/i.test(m[1]) }) },

    // --- drain ---
    { re: /^Each opponent loses (one|two|three|four|five|six|seven|eight|nine|ten|\d+|X) life and you gain (?:that much|\1) life\.?$/i,
      make: (m) => ({ op: 'drain', n: num(m[1]), who: 'opponents' }) },
    { re: /^Target (?:player|opponent) loses (one|two|three|four|five|six|seven|eight|nine|ten|\d+|X) life and you gain (?:that much|\1) life\.?$/i,
      make: (m) => ({ op: 'drain', n: num(m[1]), who: 'target', targets: [{ type: 'player' }] }) },
    { re: /^Each opponent loses (one|two|three|four|five|six|seven|eight|nine|ten|\d+|X) life\. You gain life equal to the life lost this way\.?$/i,
      make: (m) => ({ op: 'drain', n: num(m[1]), who: 'opponents' }) },

    // --- copying a spell ---
    { re: /^Copy target (instant or sorcery|instant|sorcery) spell( you control)?\.?(?: You may choose new targets for the copy\.?)?$/i,
      make: (m) => ({ op: 'copySpell', targets: [Object.assign({ type: 'spell', zone: 'stack', filter: m[1].toLowerCase() },
        m[2] ? { controller: 'you' } : {})] }) },
    /* Strionic Resonator, Lithoform Engine: an ability copied on the stack.
       The copy's targets are offered again as it is made. */
    { re: /^Copy target (activated or triggered|triggered|activated) ability( you control)?\.?(?: You may choose new targets for the copy\.?)?$/i,
      make: (m) => ({ op: 'copySpell', targets: [Object.assign({ type: 'spell', zone: 'stack', filter: 'ability', abilities: true, noSpells: true },
        /^(?:triggered|activated)$/i.test(m[1]) ? { abilityKind: m[1].toLowerCase() } : {}, m[2] ? { controller: 'you' } : {})] }) },
    { re: /^Copy target (?:instant or sorcery spell|instant spell, sorcery spell), activated ability, or triggered ability( you control)?\.?(?: You may choose new targets for the copy\.?)?$/i,
      make: (m) => ({ op: 'copySpell', targets: [Object.assign({ type: 'spell', zone: 'stack', filter: 'instant or sorcery', abilities: true },
        m[1] ? { controller: 'you' } : {})] }) },
    { re: /^(?:You may )?[Dd]raw that many cards\.?$/, make: () => ({ op: 'draw', who: 'you', n: 'triggerAmount' }) },
    /* Tragic Slip: the morbid half replaces the first */
    { re: /^That creature gets ([+-]\d+)\/([+-]\d+) until end of turn instead if (.+?)\.?$/i,
      make: (m) => { const cond = condOf(m[3]); return cond ? { op: 'noop', insteadOf: { cond, effects: [{ op: 'pump', p: +m[1], t: +m[2], duration: 'eot', scope: 'lastTarget' }] } } : null; } },
    /* Myr Retriever and Junk Diver: never itself */
    { re: /^Return another target ([a-z ]+?) card from your graveyard to your hand\.?$/i,
      make: (m) => ({ op: 'regrowth', targets: [Object.assign(targetSpec('another target ' + m[1]), { zone: 'graveyard', controller: 'you' })] }) },
    /* Essence Flux */
    { re: /^If it'?s an? ([A-Z][a-z]+|creature|artifact), put a \+1\/\+1 counter on it\.?$/,
      make: (m) => ({ op: 'ifLastWas', filter: m[1].toLowerCase(), then: [{ op: 'counters', kind: '+1/+1', n: 1, scope: 'lastTarget' }] }) },
    /* Defile */
    { re: /^(Target creature) gets ([+-])(\d+)\/([+-])(\d+) until end of turn for each ([A-Za-z ]+?) you control\.?$/i,
      make: (m) => {
        const c = countOf(m[6] + ' you control');
        if (!c) return null;
        const sp = (sign, k) => Object.assign({}, c, { mult: (sign === '-' ? -1 : 1) * +k });
        return { op: 'pump', p: sp(m[2], m[3]), t: sp(m[4], m[5]), duration: 'eot', targets: [targetSpec(m[1])] };
      } },
    /* Fists of Flame: "Until end of turn, target creature gains trample and
       gets +1/+0 for each card you've drawn this turn." */
    { re: /^(?:Until end of turn, )?(target creature(?: you control)?) (?:gains ([a-z ,]+?) and )?gets ([+-])(\d+)\/([+-])(\d+)(?: until end of turn)? for each (.+?)\.?$/i,
      make: (m) => {
        if (!/^Until end of turn/i.test(m[0]) && !/until end of turn for each/i.test(m[0])) return null;
        if (/ you control$/i.test(m[7])) return null;       // the rule above
        const c = countOf(m[7]);
        if (!c || c.scope) return null;
        const sp = (sign, k) => Object.assign({}, c, { mult: (sign === '-' ? -1 : 1) * +k });
        const pump = { op: 'pump', p: sp(m[3], m[4]), t: sp(m[5], m[6]), duration: 'eot', targets: [targetSpec(m[1])] };
        if (!m[2]) return pump;
        const kws = keywordList(m[2]);
        if (!kws.length || !kws.every(kwKnown)) return null;
        return { op: 'sequence', list: [pump, { op: 'grantKeyword', keywords: kws, duration: 'eot', scope: 'lastTarget' }] };
      } },
    /* "Those creatures gain flying until your next turn" */
    { re: /^(Those creatures|They|It|CARDNAME|Creatures you control|Target creature(?: you control)?) gains? ([a-z ,]+?) until your next turn\.?$/i,
      make: (m) => {
        const kws = keywordList(m[2]);
        if (!kws.length || !kws.every(kwKnown)) return null;
        const w = m[1].toLowerCase();
        const g = { op: 'grantKeyword', keywords: kws, duration: 'nextTurn' };
        if (/^target/.test(w)) g.targets = [targetSpec(m[1])];
        else if (w === 'cardname') g.scope = 'self';
        else if (w === 'it') g.scope = 'lastTarget';
        else if (w === 'creatures you control') g.scope = 'yourCreatures';
        else g.scope = 'lastGroup';
        return g;
      } },
    /* Unbreakable Formation: "each of those creatures" */
    { re: /^Put a \+1\/\+1 counter on each of those creatures and they gain ([a-z ,]+?) until end of turn\.?$/i,
      make: (m) => {
        const kws = keywordList(m[1]);
        if (!kws.every(kwKnown)) return null;
        return { op: 'sequence', list: [{ op: 'counters', kind: '+1/+1', n: 1, scope: 'lastGroup' },
          { op: 'grantKeyword', keywords: kws, duration: 'eot', scope: 'lastGroup' }] };
      } },
    /* Sheoldred, Whispering One: "that player" is the one whose upkeep it is */
    { re: /^[Tt]hat player sacrifices an? ([a-z ]+?) of their choice\.?$/,
      make: (m) => ({ op: 'sacrificeChoice', who: 'triggerPlayer', n: 1, filter: m[1].toLowerCase() }) },
    { re: /^Activate only as an instant\.?$/i, make: () => ({ op: 'noop' }) },
    /* Yawgmoth */
    { re: /^Put a -1\/-1 counter on up to one target creature and draw a card\.?$/i,
      make: () => ({ op: 'sequence', list: [{ op: 'counters', kind: '-1/-1', n: 1, targets: [{ type: 'creature', upTo: true, filter: 'creature' }] },
        { op: 'draw', n: 1, who: 'you' }] }) },
    /* Dragon Tempest */
    { re: /^(?:It|CARDNAME) deals X damage to (any target|target [a-z ]+?), where X is the number of ([A-Za-z ]+?) you control\.?$/,
      make: (m) => { const t = tgt(m[1]); const c = countOf(m[2] + ' you control'); return t && c ? { op: 'damage', n: c, targets: [t] } : null; } },
    { re: /^You may play (?:that card|it|those cards|them|the exiled cards?) this turn\.?$/i, make: () => ({ op: 'impulseLast', duration: 'eot' }) },
    { re: /^(?:Until the end of your next turn, you may play (?:that card|it|those cards|them)|You may play (?:that card|it|those cards|them) until the end of your next turn)\.?$/i,
      make: () => ({ op: 'impulseLast', duration: 'nextTurn' }) },
    // Inti: "You may play that card until your next end step."
    { re: /^You may play (?:that card|it|those cards|them) until your next end step\.?$/i,
      make: () => ({ op: 'impulseLast', duration: 'nextEnd' }) },
    { re: /^You may play (?:that card|it|those cards|them) for as long as (?:it remains|they remain) exiled\.?$/i,
      make: () => ({ op: 'impulseLast', duration: 'exiled' }) },
    { re: /^Untap them\.?$/i, make: () => ({ op: 'untap', scope: 'lastGroup' }) },
    { re: /^(?:Those creatures|They) don'?t untap during their controllers?'?s? next untap step\.?$/i, make: () => ({ op: 'noUntap', scope: 'lastGroup' }) },
    { re: /^(?:This land|This creature|This artifact|CARDNAME) doesn'?t untap during your next untap step\.?$/i, make: () => ({ op: 'noUntap', scope: 'self' }) },
    { re: /^They'?re still lands\.?$/i, make: () => ({ op: 'noop' }) },
    { re: /^Activate only as a sorcery\.?"?$/i, make: () => ({ op: 'noop' }) },
    { re: /^Activate (?:this ability )?only once\.?$/i, make: () => ({ op: 'activateOnly', once: true }) },
    /* Lathril: "create that many 1/1 green Elf Warrior creature tokens" */
    { re: /^Create that many (.+? creature tokens?(?: with [a-z ,]+)?)\.?$/i,
      make: (m) => { const t = parseTokenSentence('Create two ' + m[1].replace(/\btoken\b/, 'tokens')); return t ? Object.assign(t, { n: 'triggerAmount' }) : null; } },
    /* Threefold Thunderhulk: "equal to its power" */
    { re: /^Create a number of (.+? creature tokens?(?: with [a-z ,]+)?) equal to (?:its|CARDNAME'?s|this creature'?s) power\.?$/i,
      make: (m) => { const t = parseTokenSentence('Create two ' + m[1].replace(/\btoken\b/, 'tokens')); return t ? Object.assign(t, { n: { ofSelf: 'power' } }) : null; } },
    /* Chart a Course */
    { re: /^Then discard (a card|two cards) unless (.+?)\.?$/i,
      make: (m) => { const c = condOf(m[2]); return c ? { op: 'ifCond', cond: { kind: 'not', cond: c }, then: [{ op: 'discard', n: /two/i.test(m[1]) ? 2 : 1, who: 'you' }] } : null; } },
    /* Gleaming Splendor */
    { re: /^Two target players each draw a card\.?$/i, make: () => ({ op: 'draw', n: 1, who: 'target', targets: [{ type: 'player' }, { type: 'player' }] }) },
    /* Night of the Sweets' Revenge and kin */
    { re: /^Creatures you control get \+X\/\+X until end of turn, where X is the number of ([A-Za-z ]+?) you control\.?$/i,
      make: (m) => { const c = countOf(m[1] + ' you control'); return c ? { op: 'pump', p: c, t: c, duration: 'eot', scope: 'yourCreatures' } : null; } },
    /* Aerith Gainsborough, Halana and Alena */
    { re: /^Put X (\+1\/\+1|[a-z]+) counters on each ([a-z ]+?), where X is the number of (\+1\/\+1|[a-z]+) counters on (?:CARDNAME|this creature|it)\.?$/i,
      make: (m) => { const sc = scopeOf(m[2].replace(/\bcreature\b/, 'creatures')); return sc ? { op: 'counters', kind: m[1].toLowerCase(), n: { countersOnSelf: m[3].toLowerCase() }, scope: sc } : null; } },
    { re: /^Put X (\+1\/\+1|[a-z]+) counters on ((?:another )?target creature(?: you control)?), where X is (?:CARDNAME|this creature)'?s power\.?$/i,
      make: (m) => ({ op: 'counters', kind: m[1].toLowerCase(), n: { ofSelf: 'power' }, targets: [targetSpec(m[2])] }) },
    /* Mossborn Hydra, Bristly Bill */
    { re: /^Double the number of (\+1\/\+1|[a-z]+) counters on (this creature|CARDNAME|each creature you control)\.?$/i,
      make: (m) => ({ op: 'doubleCounters', kind: m[1].toLowerCase(), scope: /each/i.test(m[2]) ? 'yourCreatures' : 'self' }) },
    /* Ouroboroid */
    { re: /^Put X (\+1\/\+1|[a-z]+) counters on each creature you control, where X is (?:this creature|CARDNAME)'?s power\.?$/i,
      make: (m) => ({ op: 'counters', kind: m[1].toLowerCase(), n: { ofSelf: 'power' }, scope: 'yourCreatures' }) },
    /* Tarrian's Soulcleaver */
    { re: /^Put (a|an|one|two|three|\d+) (\+1\/\+1|[a-z]+) counters? on (?:equipped|enchanted) creature\.?$/i,
      make: (m) => ({ op: 'counters', kind: m[2].toLowerCase(), n: num(m[1]), scope: 'attached' }) },
    /* Rite of Replication's kicker */
    { re: /^If this spell was kicked, create (two|three|four|five|\d+) of those tokens instead\.?$/i,
      make: (m) => ({ op: 'noop', insteadOf: { cond: { kind: 'kicked', n: 1 }, effects: [{ op: 'copyPermanent', n: num(m[1]), targets: [{ type: 'creature' }] }] } }) },
    /* Ghalta, Stampede Tyrant */
    { re: /^Put any number of (creature|artifact|permanent|land) cards from your hand onto the battlefield\.?$/i,
      make: (m) => ({ op: 'permanentFromHand', filter: m[1].toLowerCase() === 'permanent' ? 'any' : m[1].toLowerCase(), who: 'you', any: true }) },
    /* Buster Sword */
    { re: /^(?:[Tt]hen )?[Yy]ou may cast a spell from your hand with mana value less than or equal to (?:that damage|the damage dealt) without paying its mana cost\.?$/,
      make: () => ({ op: 'castFree', from: 'hand', upTo: 1, maxMv: 'triggerAmount' }) },
    /* "Draw a card if you've gained 3 or more life this turn." */
    { re: /^(Draw (?:a card|two cards)|Create .+? tokens?|You gain \w+ life|Scry \w+) if (.+?)\.?$/,
      make: (m) => {
        const cond = condOf(m[2]);
        const inner = cond && parseEffectSentence(m[1] + '.', 1);
        return inner && inner.op !== 'manual' ? { op: 'ifCond', cond, then: [inner] } : null;
      } },
    /* the newer mechanics, each a word for a small procedure */
    { re: /^Discover (one|two|three|four|five|six|seven|eight|nine|ten|\d+)\.?$/i, make: (m) => ({ op: 'discover', n: num(m[1]) }) },
    { re: /^Discover X, where X is (?:that spell'?s|its) mana value\.?$/i, make: () => ({ op: 'discover', n: { ofTrigger: 'mv' } }) },
    { re: /^[Ee]arthbend (one|two|three|four|five|six|\d+|X)\.?$/,
      make: (m) => ({ op: 'earthbend', n: num(m[1]), targets: [{ type: 'land', controller: 'you', filter: 'land you control' }] }) },
    { re: /^[Aa]irbend (up to one )?(other )?(target [a-z ]+?)\.?$/,
      make: (m) => { const t = tgt(m[3]); return t ? { op: 'airbend', targets: [Object.assign(t, m[1] ? { upTo: true } : {}, m[2] ? { another: true } : {})] } : null; } },
    { re: /^[Mm]anifest dread\.?$/, make: () => ({ op: 'manifestDread' }) },
    { re: /^(?:Otherwise, )?[Ss]uspect (it|that creature|target creature(?: an opponent controls)?)\.?$/,
      make: (m) => (/^target/i.test(m[1]) ? { op: 'suspect', targets: [targetSpec(m[1])] } : { op: 'suspect', scope: 'lastTarget' }) },
    { re: /^(?:CARDNAME|This creature|It) endures (one|two|three|four|five|\d+|X)\.?$/i,
      make: (m) => ({ op: 'endure', n: num(m[1]), scope: /^It$/i.test(m[0].split(' ')[0]) ? 'triggerObject' : 'self' }) },
    // Warden of the Grove: "it endures X, where X is the number of counters on this creature"
    { re: /^(CARDNAME|This creature|It) endures X, where X is (.+?)\.?$/i,
      make: (m) => { const k = amountOf(m[2]); return k ? { op: 'endure', n: k, scope: /^It$/i.test(m[1]) ? 'triggerObject' : 'self' } : null; } },
    /* Alesha, Who Laughs at Fate: "Return target creature card with mana
       value less than or equal to CARDNAME's power from your graveyard to
       the battlefield." */
    { re: /^Return target ([a-z ]*?creature) card with mana value less than or equal to (?:CARDNAME|this creature)'?s power from your graveyard to the battlefield\.?$/i,
      make: (m) => ({ op: 'reanimate', targets: [Object.assign(targetSpec('target ' + m[1]), { zone: 'graveyard', controller: 'you', maxMvSourcePower: true })] }) },
    /* Liquimetal Torque and friends: one more card type for the turn */
    { re: /^(target [a-z ]+?) becomes an? (artifact|enchantment|creature|land) in addition to its other types until end of turn\.?$/i,
      make: (m) => { const t = tgt(m[1]); return t ? { op: 'addTypes', types: [U.titleCase(m[2])], duration: 'eot', targets: [t] } : null; } },
    /* Maze of Ith */
    { re: /^Prevent all combat damage that would be dealt to and dealt by (?:that creature|it) this turn\.?$/i,
      make: () => ({ op: 'flagEot', scope: 'lastTarget', flags: ['noDamage', 'noDamageTaken'] }) },
    // Moonlight Geist: the same, said of itself or of a target
    { re: /^Prevent all combat damage that would be dealt to and dealt by (CARDNAME|this creature|target creature) this turn\.?$/i,
      make: (m) => (/^target/i.test(m[1]) ? { op: 'flagEot', targets: [{ type: 'creature' }], flags: ['noDamage', 'noDamageTaken'] }
        : { op: 'flagEot', scope: 'self', flags: ['noDamage', 'noDamageTaken'] }) },
    // Koma, Cosmos Serpent: "Tap target permanent. Its activated abilities can't be activated this turn."
    { re: /^Its activated abilities can'?t be activated this turn\.?$/i, make: () => ({ op: 'flagEot', scope: 'lastTarget', flags: ['cantActivate'] }) },
    // Gideon: "Prevent all damage that would be dealt to him this turn."
    { re: /^Prevent all damage that would be dealt to (?:him|her|it|CARDNAME|this creature) this turn\.?$/i,
      make: () => ({ op: 'flagEot', scope: 'self', flags: ['noDamageTaken', 'noNoncombatTaken'] }) },
    // Compelled Duel: "gets +3/+3 until end of turn and must be blocked this turn if able"
    { re: /^(Target creature) gets ([+-]\d+)\/([+-]\d+) until end of turn and must be blocked this turn if able\.?$/i,
      make: (m) => ({ op: 'sequence', list: [{ op: 'pump', p: pmNum(m[2]), t: pmNum(m[3]), duration: 'eot', targets: [targetSpec(m[1])] },
        { op: 'restrict', flag: 'lure', scope: 'lastTarget' }] }) },
    // Wave of Reckoning: "Each creature deals damage to itself equal to its power."
    { re: /^Each creature deals damage to itself equal to its power\.?$/i, make: () => ({ op: 'selfDamageAll' }) },
    /* Chandra, Flamecaller: "Exile them at the beginning of the next end
       step" — the tokens this just made, each of them */
    // Baleful Mastery: "an opponent draws a card" — the one you choose
    { re: /^An opponent draws (a|one|two|three) cards?\.?$/i, make: (m) => ({ op: 'draw', who: 'anOpponent', n: num(m[1]) }) },
    // Whip of Erebos: "If it would leave the battlefield, exile it instead of putting it anywhere else."
    { re: /^If (?:it|that creature|the creature) would leave the battlefield, exile it instead of putting it anywhere else\.?$/i,
      make: () => ({ op: 'leaveExile' }) },
    { re: /^(?:It|That creature) gains "If this (?:permanent|creature|land) would leave the battlefield, exile it instead of putting it anywhere else\.?"\.?$/i,
      make: () => ({ op: 'leaveExile' }) },
    // Tidehollow Sculler, the Champions: "return the exiled card to its owner's hand"
    { re: /^Return the exiled cards? to (?:its|their) owners?'?s?'? hands?\.?$/i, make: () => ({ op: 'returnHeld' }) },
    // Ghostway, Eerie Interlude: "Return those cards to the battlefield under their owner's control at the beginning of the next end step."
    { re: /^Return (?:those cards|the exiled cards|them) to the battlefield under (?:their|its) owner'?s'? control at the beginning of the next end step\.?$/i,
      make: () => ({ op: 'delayed', event: 'eachEndStep', subject: 'exiledNow', name: 'Return them at end of turn', effects: [{ op: 'returnThat' }] }) },
    { re: /^(Exile|Sacrifice) (?:them|those (?:creatures|tokens)) at the beginning of the next end step\.?$/i,
      make: (m) => ({ op: 'delayed', event: 'eachEndStep', subject: 'made', name: m[1] + ' them at end of turn',
        effects: [/^exile/i.test(m[1]) ? { op: 'exile', scope: 'thatObject' } : { op: 'sacrificeThat' }] }) },
    // Farrel's Zealot, Laccolith Titan: "This creature assigns no combat damage this turn."
    { re: /^(?:CARDNAME|This creature|It) assigns no combat damage this turn\.?$/i,
      make: () => ({ op: 'flagEot', scope: 'self', flags: ['noDamage'] }) },
    // Shielded Passage: all damage, combat or not
    { re: /^Prevent all damage that would be dealt to (target creature|target permanent) this turn\.?$/i,
      make: (m) => ({ op: 'flagEot', targets: [targetSpec(m[1])], flags: ['noDamageTaken', 'noNoncombatTaken'] }) },
    // Cinder Wall: "When this creature blocks, destroy it at end of combat."
    { re: /^Destroy (?:it|CARDNAME|this creature) at end of combat\.?$/i, make: () => ({ op: 'destroyAtEndOfCombat', scope: 'self' }) },
    // Bleeding Edge: "Up to one target creature gets -2/-2 until end of turn."
    { re: /^Up to one target creature gets ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
      make: (m) => ({ op: 'pump', p: pmNum(m[1]), t: pmNum(m[2]), duration: 'eot', targets: [{ type: 'creature', upTo: true }] }) },
    // Creeping Tar Pit: "It can't be blocked this turn." — itself, or the target before it
    { re: /^It can'?t be blocked this turn\.?$/i, make: () => ({ op: 'restrict', flag: 'unblockable', scope: 'self' }) },
    // Heroic Teamwork: "One or two target creatures each get +2/+1 until end of turn."
    { re: /^One or two target creatures each get ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
      make: (m) => ({ op: 'pump', p: pmNum(m[1]), t: pmNum(m[2]), duration: 'eot', targets: [{ type: 'creature' }, { type: 'creature', upTo: true }] }) },
    // Alley Grifters, Silent Skimmer: "defending player discards a card", "defending player loses 2 life"
    { re: /^(?:the )?defending player discards (a|one|two|\d+) cards?\.?$/i, make: (m) => ({ op: 'discard', n: num(m[1]), who: 'defending' }) },
    { re: /^(?:the )?defending player loses (\d+) life\.?$/i, make: (m) => ({ op: 'loseLife', n: +m[1], who: 'defending' }) },
    // Weapon Rack, Simic Fluxmage: "Move a +1/+1 counter from this onto target creature."
    { re: /^Move (a|an|one|two|\d+) ([+\-0-9/a-z]+) counters? from (?:CARDNAME|this (?:creature|artifact|permanent)) onto (target [a-z ]+?)\.?$/i,
      make: (m) => ({ op: 'moveCounterFromSelf', n: num(m[1]), kind: m[2].toLowerCase(), targets: [targetSpec(m[3])] }) },
    // Spinal Parasite: "Remove a counter from target permanent."
    { re: /^Remove (a|an|one|two|three|\d+) ((?:[+\-0-9/a-z]+ )?)counters? from (target [a-z ]+?)\.?$/i,
      make: (m) => ({ op: 'removeCountersFrom', n: num(m[1]), kind: (m[2] || '').trim().toLowerCase() || null, targets: [targetSpec(m[3])] }) },
    // Fire Prophecy: "Put a card from your hand on the bottom of your library."
    { re: /^Put (a|one|two) cards? from your hand on the bottom of your library\.?$/i,
      make: (m) => ({ op: 'handToBottom', n: num(m[1]) }) },
    // Phantom Wings: "Return enchanted creature to its owner's hand."
    { re: /^Return enchanted (creature|permanent) to its owner'?s hand\.?$/i, make: () => ({ op: 'bounceAttached' }) },
    // Solfatara: "Target player can't play lands this turn."
    { re: /^(Target player|Target opponent|Each opponent) can'?t play lands this turn\.?$/i,
      make: (m) => (/^each/i.test(m[1]) ? { op: 'noLandsTurn', who: 'opponents' } : { op: 'noLandsTurn', who: 'target', targets: [{ type: 'player', opponent: /opponent/i.test(m[1]) }] }) },
    /* Second Harvest */
    { re: /^For each token you control, create a token that'?s a copy of that permanent\.?$/i,
      make: () => ({ op: 'copyEachToken' }) },
    /* Nesting Grounds */
    { re: /^Move a counter from (target permanent you control) onto a second target permanent\.?$/i,
      make: () => ({ op: 'moveCounter', targets: [{ type: 'permanent', controller: 'you', filter: 'permanent you control' }, { type: 'permanent', filter: 'permanent' }] }) },
    /* Ghostly Flicker and its kin */
    { re: /^Exile (two|three) target ((?:artifacts|creatures|lands|enchantments)(?:,? (?:and\/or |or )?(?:artifacts|creatures|lands|enchantments))*) you control, then return (?:those cards|them) to the battlefield under your control\.?$/i,
      make: (m) => {
        const kinds = m[2].replace(/and\/or|or|,/g, ' ').split(/\s+/).filter(Boolean).map(w => w.replace(/s$/, ''));
        const spec = { type: 'permanent', controller: 'you', filter: kinds.join(' or ') + ' you control', anyOf: kinds };
        const out = [];
        for (let i = 0; i < num(m[1]); i++) out.push(Object.assign({}, spec));
        return { op: 'blink', targets: out };
      } },
    /* the d20 Dragons */
    { re: /^[Rr]oll a d(4|6|8|10|12|20)\.?$/, make: (m) => ({ op: 'rollDie', sides: +m[1] }) },
    // coins: several at once, or until one is lost, counting the wins
    { re: /^Flip (two|three|four|five|\d+) coins\.?$/i, make: (m) => ({ op: 'flipCoins', n: num(m[1]) }) },
    { re: /^Flip a coin until you lose a flip\.?$/i, make: () => ({ op: 'flipCoins', untilLose: true }) },
    // "For each flip you won, create a token that's a copy of that creature."
    { re: /^For each flip you (?:win|won), (.+)$/i,
      make: (m) => { const pe = parseSentenceList(splitSentences(m[1].charAt(0).toUpperCase() + m[1].slice(1))); return pe.auto && pe.effects.length ? { op: 'repeatPerFlip', effects: pe.effects } : null; } },
    { re: /^(?:You )?[Cc]reate a number of (Treasure|Food|Clue|Blood|Gold) tokens equal to the result\.?$/,
      make: (m) => ({ op: 'createNamedToken', token: m[1], n: 'lastRoll' }) },
    { re: /^Draw cards equal to the result\.?$/i, make: () => ({ op: 'draw', who: 'you', n: 'lastRoll' }) },
    { re: /^Create a number of (.+? creature tokens?(?: with [a-z ,]+)?) equal to the result\.?$/i,
      make: (m) => { const t = parseTokenSentence('Create two ' + m[1].replace(/tokens?/, 'tokens')); return t ? Object.assign(t, { n: 'lastRoll' }) : null; } },
    /* Noxious Revival */
    { re: /^Put target card from a graveyard on top of its owner'?s library\.?$/i,
      make: () => ({ op: 'toLibrary', where: 'top', targets: [{ type: 'permanent', filter: 'card', zone: 'graveyard' }] }) },
    /* Dramatic Reversal */
    { re: /^Untap all nonland permanents you control\.?$/i, make: () => ({ op: 'untapAll', what: 'nonland' }) },
    /* Chain Reaction */
    { re: /^CARDNAME deals X damage to each creature, where X is the number of creatures on the battlefield\.?$/i,
      make: () => ({ op: 'damage', each: 'creature', n: countSpec('creatures', 1, 'any') }) },
    /* Wishclaw Talisman */
    { re: /^An opponent gains control of (?:this artifact|CARDNAME|this permanent)\.?$/i, make: () => ({ op: 'giveSelfToOpponent' }) },
    /* Valakut Awakening */
    { re: /^Put any number of cards from your hand on the bottom of your library, then draw that many cards plus (one|two|three|\d+)\.?$/i,
      make: (m) => ({ op: 'bottomThenDraw', plus: num(m[1]) }) },
    /* "Whenever another creature you control enters, put a +1/+1 counter on
       that creature": the creature the trigger is about */
    { re: /^Put (a|an|one|two|three|four|\d+) (\+1\/\+1|[a-z]+) counters? on that (?:creature|permanent)\.?$/i,
      make: (m) => ({ op: 'counters', kind: m[2].toLowerCase(), n: num(m[1]), scope: 'triggerObject' }) },
    /* Plaguecrafter */
    { re: /^Each player sacrifices an? (creature or planeswalker|creature|artifact or creature) of their choice\. Each player who can'?t discards a card\.?$/i,
      make: (m) => ({ op: 'sacrificeChoice', who: 'each', n: 1, filter: m[1].toLowerCase(), orDiscard: true }) },
    /* Forgotten Ancient: its counters handed out one at a time */
    { re: /^Move any number of (\+1\/\+1|[a-z]+) counters from (?:this creature|CARDNAME) onto other creatures\.?$/i,
      make: (m) => ({ op: 'moveCountersOut', kind: m[1].toLowerCase() }) },
    /* Overlord of the Hauntwoods: a land token of every basic type */
    { re: /^Create a (tapped )?colorless land token named ([A-Z][a-z]+) that is every basic land type\.?$/,
      make: (m) => ({ op: 'landToken', name: m[2], tapped: !!m[1], subtypes: ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'] }) },
    /* Sevinne's Reclamation: the spell copies itself as it resolves */
    { re: /^Copy this spell(?: and (?:you )?may choose (?:a )?new targets? for the copy)?\.?$/i,
      make: () => ({ op: 'copySpell', self: true }) },
    /* Helm of the Host: a copy of the equipped creature that is not
       legendary, and it has haste for good. */
    { re: /^Create a token that'?s a copy of equipped creature(, except (?:the token|it) isn'?t legendary)?\.?$/i,
      make: (m) => ({ op: 'copyPermanent', of: 'attached', nonLegendary: !!m[1] }) },
    { re: /^(?:That token|The token) gains haste( until end of turn)?\.?$/i,
      make: (m) => ({ op: 'grantKeyword', keywords: ['Haste'], scope: 'thatToken', duration: m[1] ? 'eot' : 'permanent' }) },
    /* Selvala, Heart of the Wilds */
    { re: /^[Ii]ts controller may draw a card if its power is greater than each other creature'?s power\.?$/,
      make: () => ({ op: 'drawIfBiggest' }) },
    /* Adeline: a token for each opponent, attacking that opponent */
    { re: /^[Ff]or each opponent, (create an? .+? creature token) that'?s tapped and attacking that player(?: or a planeswalker they control)?\.?$/,
      make: (m) => {
        const tok = parseTokenSentence(m[1].replace(/^c/, 'C'));
        return tok && tok.n === 1 ? Object.assign(tok, { tapped: true, attacking: true, forEachOpponent: true }) : null;
      } },
    /* "Double target creature's power and toughness until end of turn",
       "double the power of each creature you control": +X/+X where X is
       what it has now. */
    { re: /^Double (target [a-z ]+?)'s? power( and toughness)? until end of turn\.?$/i,
      make: (m) => { const t = tgt(m[1]); return t ? { op: 'doublePT', toughness: !!m[2], targets: [t] } : null; } },
    { re: /^Double the power( and toughness)? of (target [a-z ]+?) until end of turn\.?$/i,
      make: (m) => { const t = tgt(m[2]); return t ? { op: 'doublePT', toughness: !!m[1], targets: [t] } : null; } },
    { re: /^Double the power( and toughness)? of each ((?:other )?creature you control) until end of turn\.?$/i,
      make: (m) => { const sc = scopeOf(m[2].replace(/\bcreature\b/, 'creatures')); return sc ? { op: 'doublePT', toughness: !!m[1], scope: sc } : null; } },
    { re: /^Double CARDNAME'?s? power( and toughness)? until end of turn\.?$/i,
      make: (m) => ({ op: 'doublePT', toughness: !!m[1], scope: 'self' }) },
    /* Etali, Villainous Wealth, Improvisation Capstone: cards exiled off
       the top of a library, and then cast from there for nothing. */
    { re: /^Exile the top (card|(two|three|four|five|X|\d+) cards) of each player'?s library\.?$/i,
      make: (m) => ({ op: 'exileTop', who: 'each', n: m[2] ? num(m[2]) : 1 }) },
    { re: /^Each player exiles cards from the top of their library until they exile a nonland card\.?$/i,
      make: () => ({ op: 'exileTop', who: 'each', untilNonland: true }) },
    { re: /^Exile cards from the top of your library until you exile a nonland card\.?$/i,
      make: () => ({ op: 'exileTop', who: 'you', untilNonland: true }) },
    { re: /^Exile cards from the top of your library until you exile cards with total mana value (\d+) or greater\.?$/i,
      make: (m) => ({ op: 'exileTop', who: 'you', totalMv: +m[1] }) },
    { re: /^(Target opponent|Target player) exiles the top (card|(two|three|four|five|X|\d+) cards) of their library\.?$/i,
      make: (m) => ({ op: 'exileTop', who: 'target', n: m[3] ? num(m[3]) : 1, targets: [{ type: 'player', opponent: /opponent/i.test(m[1]) }] }) },
    { re: /^You may cast any number of (?:spells|instant and\/or sorcery spells)( with mana value (X|\d+) or less)? from among (?:them|those cards|the nonland cards exiled this way|cards exiled this way|the exiled cards) without paying their mana costs\.?$/i,
      make: (m) => Object.assign({ op: 'castFree' }, m[2] ? { maxMv: num(m[2]) } : {},
        /instant and\/or sorcery/i.test(m[0]) ? { filter: 'instant or sorcery' } : {}) },
    { re: /^You may cast (?:a|up to one) spell( with mana value (X|\d+) or less)? from among (?:them|those cards|the revealed cards|cards revealed this way|the exiled cards|cards exiled this way) without paying its mana cost\.?$/i,
      make: (m) => Object.assign({ op: 'castFree', upTo: 1 }, m[2] ? { maxMv: num(m[2]) } : {}) },
    { re: /^Each player discards their hand,? then draws seven cards\.?$/i, make: () => ({ op: 'wheel', n: 7 }) },
    { re: /^Each player discards their hand,? then draws cards equal to the greatest number of cards a player discarded this way\.?$/i,
      make: () => ({ op: 'wheel', n: 'mostDiscarded' }) },
    { re: /^Each player discards their hand,? then draws that many cards\.?$/i, make: () => ({ op: 'wheel', n: 'sameDiscarded' }) },
    { re: /^Look at the top (two|three|four|five|\d+) cards of (?:your|target player'?s) library,? (?:then|and) put them back in any order\.?$/i,
      make: (m) => (/target player/i.test(m[0]) ? null : { op: 'arrangeTop', n: num(m[1]) }) },

    // --- counterspell variants ---
    { re: /^Counter target spell unless its controller pays (\{[^}]+\}(?:\{[^}]+\})*)\.?$/i,
      make: (m) => ({ op: 'counterUnless', cost: m[1], targets: [{ type: 'spell' }] }) },
    { re: /^Counter target (creature|noncreature|instant or sorcery|artifact|enchantment) spell\.?$/i,
      make: (m) => ({ op: 'counterSpell', targets: [{ type: 'spell', filter: m[1] }] }) },

    // --- life ---
    { re: /^Your life total becomes (\d+)\.?$/i, make: (m) => ({ op: 'setLife', n: +m[1] }) },
    { re: /^Each opponent'?s life total becomes (\d+)\.?$/i, make: (m) => ({ op: 'setLife', n: +m[1], who: 'opponents' }) },

    // --- static/global that the engine tracks ---
    { re: /^You may play an additional land(?: on each of your turns)?\.?$/i, make: () => ({ op: 'extraLand', n: 1 }) },
    { re: /^You may play (two|three) additional lands(?: on each of your turns| this turn)?\.?$/i, make: (m) => ({ op: 'extraLand', n: num(m[1]) }) },
    { re: /^Take an extra turn after this one\.?$/i, make: () => ({ op: 'extraTurn' }) },
    // Final Fortune: "At the beginning of that turn's end step, you lose the game."
    { re: /^At the beginning of that turn'?s end step, you lose the game\.?$/i,
      make: () => ({ op: 'delayed', event: 'yourEndStep', forPlayer: 'you', nextTurn: true, name: 'You lose the game', effects: [{ op: 'loseGame' }] }) },
    // Time Warp: "Target player takes an extra turn after this one."
    { re: /^Target player takes an extra turn after this one\.?$/i, make: () => ({ op: 'extraTurn', who: 'target', targets: [{ type: 'player' }] }) },
    // Time Stretch: "Target player takes two extra turns after this one."
    { re: /^Target player takes (two|three) extra turns after this one\.?$/i, make: (m) => ({ op: 'extraTurn', n: num(m[1]), who: 'target', targets: [{ type: 'player' }] }) },
    { re: /^Untap all (creatures|lands|permanents) you control\.?$/i, make: (m) => ({ op: 'untapAll', what: m[1] }) },
    { re: /^Shuffle your library\.?$/i, make: () => ({ op: 'shuffle' }) },

    /* ===== targets that name more than one type ===== */
    { re: /^Tap (target (?:[a-z-]+, )+(?:or )?[a-z-]+(?: [a-z-]+)?)\.?$/i,
      make: (m) => ({ op: 'tap', targets: [targetSpec(m[1])] }) },
    { re: /^Untap (target (?:[a-z-]+, )+(?:or )?[a-z-]+(?: [a-z-]+)?)\.?$/i,
      make: (m) => ({ op: 'untap', targets: [targetSpec(m[1])] }) },
    { re: /^Destroy (target (?:[a-z-]+, )+(?:or )?[a-z-]+(?: [a-z-]+)?)\.?(?: It can'?t be regenerated\.?)?$/i,
      make: (m) => ({ op: 'destroy', noRegen: /can'?t be regenerated/i.test(m[0]), targets: [targetSpec(m[1])] }) },
    { re: /^Destroy (target (?:[a-z-]+, )+(?:or )?[a-z-]+)\.?(?: It can'?t be regenerated\.?)?$/i,
      make: (m) => ({ op: 'destroy', noRegen: /can'?t be regenerated/i.test(m[0]), targets: [targetSpec(m[1])] }) },
    { re: /^Destroy (target [a-z-]+ or [a-z-]+)\.?(?: It can'?t be regenerated\.?)?$/i,
      make: (m) => ({ op: 'destroy', noRegen: /can'?t be regenerated/i.test(m[0]), targets: [targetSpec(m[1])] }) },
    { re: /^Exile (target (?:[a-z-]+, )+(?:or )?[a-z-]+)\.?$/i,
      make: (m) => ({ op: 'exile', targets: [targetSpec(m[1])] }) },
    { re: /^Exile (target [a-z-]+ or [a-z-]+)\.?$/i,
      make: (m) => ({ op: 'exile', targets: [targetSpec(m[1])] }) },
    { re: /^Return (?:up to one )?(target (?:[a-z-]+, )+(?:or )?[a-z-]+) to (?:its|their) owner'?s hand\.?$/i,
      make: (m) => ({ op: 'bounce', targets: [targetSpec(m[1])] }) },
    { re: /^Return (?:up to one )?(target [a-z-]+ or [a-z-]+) to (?:its|their) owner'?s hand\.?$/i,
      make: (m) => ({ op: 'bounce', targets: [targetSpec(m[1])] }) },

    /* ===== the sentence after a removal spell, about the thing removed ===== */
    { re: /^Its controller gains life equal to its (power|toughness)\.?$/i,
      make: (m) => ({ op: 'gainLife', who: 'targetController', n: { ofLast: m[1].toLowerCase() } }) },
    { re: /^You gain life equal to its (power|toughness)\.?$/i,
      make: (m) => ({ op: 'gainLife', who: 'you', n: { ofLast: m[1].toLowerCase() } }) },
    { re: /^Its controller loses (one|two|three|four|five|\d+) life\.?$/i,
      make: (m) => ({ op: 'loseLife', who: 'targetController', n: num(m[1]) }) },
    { re: /^Its controller creates (a|an|one|two|three|four|\d+) ([\dX*]+\/[\dX*]+) ((?:(?:white|blue|black|red|green|colorless)(?:,? and |, | ))*)(.+?) creature tokens?(?: with ([a-z, ]+))?\.?$/i,
      make: (m) => ({ op: 'createToken', who: 'targetController', n: num(m[1]), pt: m[2],
        colorWords: (m[3].match(/\b(white|blue|black|red|green|colorless)\b/gi) || []), subtypes: m[4],
        keywords: m[5] ? keywordList(m[5]) : [] }) },
    /* the sentences after a counterspell, about the spell it countered */
    // Cityscape Leveler: "Its controller creates a tapped Powerstone token."
    { re: /^Its controller creates (a|an|one|two|three|four|\d+) tapped (Treasure|Clue|Food|Blood|Map|Gold|Powerstone|Junk) tokens?\.?$/i,
      make: (m) => ({ op: 'createNamedToken', token: U.titleCase(m[2]), n: num(m[1]), who: 'targetController', tapped: true }) },
    { re: /^Its controller creates (a|an|one|two|three|four|\d+) (Treasure|Clue|Food|Blood|Map|Gold|Powerstone|Junk) tokens?\.?$/i,
      make: (m) => ({ op: 'createNamedToken', who: 'targetController', n: num(m[1]),
        token: m[2].charAt(0).toUpperCase() + m[2].slice(1).toLowerCase() }) },
    { re: /^If that spell is countered this way, exile it instead of putting it into its owner'?s graveyard\.?$/i,
      make: () => ({ op: 'noop', counterExileRider: true }) },
    { re: /^(?:Its controller|That spell'?s controller|That player) may draw up to (one|two|three) cards? at the beginning of the next turn'?s upkeep\.?$/i,
      make: (m) => ({ op: 'delayed', event: 'eachUpkeep', nextTurn: true, name: 'Draw up to ' + num(m[1]),
        effects: [{ op: 'drawUpTo', n: num(m[1]), who: 'targetController' }] }) },
    { re: /^Its controller (?:may )?searches? their library for a basic land card, puts? (?:that card|it) onto the battlefield tapped, then shuffles?\.?$/i,
      make: () => ({ op: 'fetchBasic', n: 1, tapped: true, who: 'targetController', optional: true }) },

    /* ===== mana that counts something ===== */
    { re: /^Add (\{[^}]+\}) for each ([-a-z' ]+?) you control\.?$/i,
      make: (m) => ({ op: 'addManaPer', symbol: MANA.parse(m[1])[0], per: countSpec(m[2], 1) }) },
    { re: /^Add (\{[^}]+\}) for each ([-a-z' ]+?) on the battlefield\.?$/i,
      make: (m) => ({ op: 'addManaPer', symbol: MANA.parse(m[1])[0], per: countSpec(m[2], 1, 'any') }) },
    // anything else counted: "for each card named CARDNAME in each graveyard"
    { re: /^Add (\{[WUBRGC]\}) for each (.+?)\.?$/i,
      make: (m) => { const c = countOf(m[2]); return c ? { op: 'addManaPer', symbol: MANA.parse(m[1])[0], per: c } : null; } },
    // Culling Ritual: "Add {B} or {G} for each permanent destroyed this way."
    { re: /^Add (\{[WUBRGC]\}) or (\{[WUBRGC]\}) for each (.+?)\.?$/i,
      make: (m) => { const c = countOf(m[3]); return c ? { op: 'addManaChoice', choices: [MANA.parse(m[1]), MANA.parse(m[2])], n: c } : null; } },

    /* ===== damage aimed at whoever controls the source ===== */
    { re: /^(?:[A-Za-z][-A-Za-z0-9',’\. ]{0,44}?\s)?deals? (one|two|three|four|five|\d+) damage to you\.?$/i,
      make: (m) => ({ op: 'damage', n: num(m[1]), toSelf: true }) },
    { re: /^(?:[A-Za-z][-A-Za-z0-9',’\. ]{0,44}?\s)?deals? (one|two|three|four|five|\d+) damage to its controller\.?$/i,
      make: (m) => ({ op: 'damage', n: num(m[1]), toSelf: true }) },

    /* ===== wider sweepers ===== */
    { re: /^Destroy all ([a-z]+s) with (?:mana value|converted mana cost) (\d+|X) or less\.?$/i,
      make: (m) => ({ op: 'destroyAll', what: m[1].toLowerCase(), maxMv: m[2] === 'X' ? 'X' : +m[2] }) },
    { re: /^Destroy all ([a-z]+s) with power (\d+) or (greater|more)\.?$/i,
      make: (m) => ({ op: 'destroyAll', what: m[1].toLowerCase(), minPower: +m[2] }) },
    // Expel the Interlopers: "…with power greater than or equal to the chosen number"
    { re: /^Destroy all ([a-z]+s) with power greater than or equal to the chosen number\.?$/i,
      make: (m) => ({ op: 'destroyAll', what: m[1].toLowerCase(), minPower: 'chosen' }) },
    { re: /^Choose a number between (\d+) and (\d+)\.?$/i, make: (m) => ({ op: 'chooseNumberNow', min: +m[1], max: +m[2] }) },
    // Brave the Elements: "White creatures you control gain protection from the chosen color until end of turn."
    { re: /^((?:white |blue |black |red |green )?creatures you control) gain protection from the chosen colou?r until end of turn\.?$/i,
      make: (m) => { const sc = scopeOf(m[1]); return sc ? { op: 'grantProtChosen', scope: sc, duration: 'eot' } : null; } },
    { re: /^Destroy all ([a-z]+s) with power (\d+) or less\.?$/i,
      make: (m) => ({ op: 'destroyAll', what: m[1].toLowerCase(), maxPower: +m[2] }) },
    { re: /^Destroy each ((?:[a-z]+, )+(?:and )?[a-z]+) with (?:mana value|converted mana cost) (\d+|X) or less\.?$/i,
      make: (m) => ({ op: 'destroyAll', what: m[1].toLowerCase(), maxMv: m[2] === 'X' ? 'X' : +m[2] }) },
    { re: /^Destroy all ((?:[a-z]+s, )+(?:and )?[a-z]+s)\.?$/i,
      make: (m) => ({ op: 'destroyAll', what: m[1].toLowerCase() }) },
    { re: /^Exile all graveyards\.?$/i, make: () => ({ op: 'exileGraveyard', who: 'all' }) },
    { re: /^Exile (?:all|each) (?:player'?s|players'?) graveyards?\.?$/i, make: () => ({ op: 'exileGraveyard', who: 'all' }) },
    { re: /^All creatures get ([+-][\dX]+)\/([+-][\dX]+) until end of turn\.?$/i,
      make: (m) => ({ op: 'pump', p: pmNum(m[1]), t: pmNum(m[2]), duration: 'eot', scope: 'allCreatures' }) },
    { re: /^Each other player sacrifices (a|one|two|\d+) ([a-z]+)(?: of their choice)?\.?$/i,
      make: (m) => ({ op: 'sacrificeChoice', n: num(m[1]), who: 'opponents', filter: m[2].toLowerCase() }) },
    { re: /^Each player sacrifices (a|one|two|\d+) ([a-z]+) of their choice\.?$/i,
      make: (m) => ({ op: 'sacrificeChoice', n: num(m[1]), who: 'each', filter: m[2].toLowerCase() }) },


    /* ===== a graveyard anybody can reach into ===== */
    { re: /^Put target creature card from (a|an opponent'?s) graveyard onto the battlefield under your control(?: with an? ([a-z+\-0-9/]+) counter on it)?\.?$/i,
      make: (m) => Object.assign({ op: 'reanimate', mine: true, targets: [Object.assign({ type: 'creature', zone: 'graveyard' }, /opponent/i.test(m[1]) ? { controller: 'opponent' } : {})] },
        m[2] ? { counter: m[2].toLowerCase() } : {}) },
    { re: /^Return target creature card from a graveyard to the battlefield under your control\.?$/i,
      make: () => ({ op: 'reanimate', mine: true, targets: [{ type: 'creature', zone: 'graveyard' }] }) },

    /* ===== looking at somebody's hand, and taking something out of it ===== */
    { re: /^Look at target (?:player|opponent)'?s hand\.?$/i,
      make: () => ({ op: 'revealHand', targets: [{ type: 'player' }] }) },

    /* ===== a sweep that spares one kind of creature ===== */
    { re: /^(?:CARDNAME|This spell) deals (\d+) damage to each creature without ([a-z]+)\.?$/i,
      make: (m) => ({ op: 'damage', n: num(m[1]), each: 'creature', without: m[2].toLowerCase() }) },
    { re: /^(?:CARDNAME|This spell) deals (\d+) damage to each creature with ([a-z]+)\.?$/i,
      make: (m) => ({ op: 'damage', n: num(m[1]), each: 'creature', withKw: m[2].toLowerCase() }) },

    /* ===== reading the top of a library ===== */
    { re: /^Look at the top (a|one|two|three|four|five|six|seven|\d+|X) cards? of your library\.?$/i,
      make: (m) => ({ op: 'lookAt', n: num(m[1]), keep: 0 }) },
    { re: /^Reveal the top (a|one|two|three|four|five|\d+) cards? of your library and put (?:that card|them) into your hand\.?$/i,
      make: (m) => ({ op: 'drawFromTop', n: num(m[1]) }) },
    { re: /^Exile the top (a|one|two|three|\d+)? ?cards? of your library face down\.?$/i,
      make: (m) => ({ op: 'impulse', n: m[1] ? num(m[1]) : 1, play: false, faceDown: true }) },
    { re: /^Put (?:up to )?(a|one|two|three|\d+) ([-a-z' ]*?)cards? (?:with (?:mana value|converted mana cost) (\d+) or less )?from among them onto the battlefield and the rest on the bottom of your library in a random order\.?$/i,
      make: (m) => ({ op: 'takeFromLooked', n: num(m[1]), filter: (m[2] || '').trim().toLowerCase() || 'any',
        maxMv: m[3] ? +m[3] : null, to: 'battlefield', rest: 'bottomRandom' }) },
    { re: /^Put (?:up to )?(a|one|two|three|\d+) ([-a-z' ]*?)cards? from among them into your hand and the rest (?:on the bottom of your library|into your graveyard)[^.]*\.?$/i,
      make: (m) => ({ op: 'takeFromLooked', n: num(m[1]), filter: (m[2] || '').trim().toLowerCase() || 'any',
        to: 'hand', rest: /graveyard/i.test(m[0]) ? 'graveyard' : 'bottom' }) },
    { re: /^Put (one|two|three) of them into your hand and the rest on the bottom of your library(?: in any order| in a random order)?\.?$/i,
      make: (m) => ({ op: 'takeFromLooked', n: num(m[1]), filter: 'any', to: 'hand', rest: 'bottom' }) },
    { re: /^Put one of them into your hand and the other on the bottom of your library\.?$/i,
      make: () => ({ op: 'takeFromLooked', n: 1, filter: 'any', to: 'hand', rest: 'bottom' }) },
    { re: /^Put (?:them|those cards) back in any order\.?$/i, make: () => ({ op: 'putBackLooked' }) },
    { re: /^Put one of them on top of your library and the rest on the bottom in a random order\.?$/i,
      make: () => ({ op: 'takeFromLooked', n: 1, to: 'top', rest: 'bottomRandom' }) },

    /* ===== whoever the trigger was about ===== */
    { re: /^(?:They|That player) loses? (one|two|three|four|five|\d+) life\.?$/i,
      make: (m) => ({ op: 'loseLife', who: 'triggerPlayer', n: num(m[1]) }) },
    { re: /^(?:They|That player) draws? an additional card\.?$/i,
      make: () => ({ op: 'draw', who: 'triggerPlayer', n: 1 }) },
    { re: /^(?:They|That player) draws? (a|one|two|three|\d+) cards?\.?$/i,
      make: (m) => ({ op: 'draw', who: 'triggerPlayer', n: num(m[1]) }) },
    { re: /^(?:They|That player) discards? (a|one|two|three|\d+) cards?\.?$/i,
      make: (m) => ({ op: 'discard', who: 'triggerPlayer', n: num(m[1]) }) },
    { re: /^You lose life equal to (?:its|that card'?s|that permanent'?s|that creature'?s|the exiled card'?s) (?:mana value|converted mana cost)\.?$/i,
      make: () => ({ op: 'loseLife', who: 'you', n: { ofLast: 'mv' } }) },

    /* ===== blink, in the longer phrasings ===== */
    { re: /^Exile (up to one )?((?:other |another )?target [a-z0-9 '-]+?), then return (?:it|that card) to the battlefield under (?:its owner'?s|your) control\.?$/i,
      make: (m) => ({ op: 'blink', targets: [Object.assign(targetSpec(m[2]), m[1] ? { upTo: true } : {})] }) },
    // Aethergeode Miner: "Exile this creature, then return it to the battlefield under its owner's control."
    { re: /^Exile (?:this creature|this permanent|this artifact|CARDNAME), then return (?:it|that card) to the battlefield under (?:its owner'?s|your) control\.?$/i,
      make: () => ({ op: 'blink', self: true }) },
    { re: /^Exile (another target [a-z0-9 '-]+?)\.?$/i,
      make: (m) => ({ op: 'exile', targets: [targetSpec(m[1].replace(/^another /i, ''))] }) },
    { re: /^Destroy (another target [a-z0-9 '-]+?)\.?$/i,
      make: (m) => ({ op: 'destroy', targets: [targetSpec(m[1].replace(/^another /i, ''))] }) },

    /* ===== counters as a resource ===== */
    { re: /^Put (a|one|two|three|\d+) ([+\-]\d\/[+\-]\d|[a-z ]+?) counters? on (?:CARDNAME|this creature|this permanent)\.?$/i,
      make: (m) => ({ op: 'counters', kind: m[2].trim(), n: num(m[1]), scope: 'self' }) },


    /* ===== what an aura or equipment is stuck to ===== */
    { re: /^Tap (enchanted|equipped) creature\.?$/i, make: () => ({ op: 'tap', scope: 'attached' }) },
    { re: /^Untap (enchanted|equipped) creature\.?$/i, make: () => ({ op: 'untap', scope: 'attached' }) },
    { re: /^Destroy (enchanted|equipped) creature\.?$/i, make: () => ({ op: 'destroy', scope: 'attached' }) },
    { re: /^Return (?:this (?:Equipment|Aura|artifact|creature|permanent|enchantment)|CARDNAME) to (?:its|their) owner'?s hand\.?$/i,
      make: () => ({ op: 'bounce', scope: 'self' }) },
    { re: /^Sacrifice (?:this (?:Equipment|Aura|artifact|creature|permanent|enchantment|land|token))\.?$/i,
      make: () => ({ op: 'sacrificeSelf' }) },

    /* ===== damage aimed at a list of things ===== */
    { re: /^(?:[A-Za-z][-A-Za-z0-9',’\. ]{0,44}?\s)?deals? (one|two|three|four|five|six|seven|eight|nine|ten|\d+|X) damage to (target (?:[a-z-]+, )*(?:or )?[a-z-]+(?: or [a-z-]+)?)\.?$/i,
      make: (m) => ({ op: 'damage', n: num(m[1]), targets: [targetSpec(m[2])] }) },
    { re: /^(?:[A-Za-z][-A-Za-z0-9',’\. ]{0,44}?\s)?deals? (one|two|three|four|five|\d+) damage to (any target|target creature|target player) and (one|two|three|four|five|\d+) damage to you\.?$/i,
      make: (m) => ({ op: 'sequence', list: [
        { op: 'damage', n: num(m[1]), targets: [targetSpec(m[2])] },
        { op: 'damage', n: num(m[3]), toSelf: true }] }) },

    /* ===== counters on a whole category ===== */
    { re: /^Put (a|one|two|three|\d+) ([+\-]\d\/[+\-]\d|[a-z ]+?) counters? on each ([-a-z' ]+?) you control\.?$/i,
      make: (m) => (/\bother\b|\bwith/i.test(m[3]) ? null
        : { op: 'counters', kind: m[2].trim(), n: num(m[1]), scope: 'yourMatching', filter: m[3].trim() }) },
    /* "a -1/-1 counter on each creature your opponents control", "on each
       other creature": any group the table can name */
    { re: /^Put (a|an|one|two|three|\d+|X) ([+\-]\d\/[+\-]\d|[a-z ]+?) counters? on (each [-a-zA-Z' ]+?)\.?$/i,
      make: (m) => {
        const sc = massScopeOf(m[3]);
        if (!sc) return null;
        return { op: 'counters', kind: m[2].trim(), n: num(m[1]), scope: sc };
      } },
    { re: /^Put (a|an|one|two|three|\d+) ([+\-]\d\/[+\-]\d|[a-z ]+?) counters? on each of up to (two|three|four|\d+) target ([a-z ]+?)s\.?$/i,
      make: (m) => ({ op: 'counters', kind: m[2].trim(), n: num(m[1]),
        targets: Array.from({ length: num(m[3]) }, () => Object.assign(targetSpec(m[4]), { upTo: true })) }) },

    /* ===== graveyards ===== */
    { re: /^Each player exiles their graveyard\.?$/i, make: () => ({ op: 'exileGraveyard', who: 'all' }) },
    { re: /^Target player exiles (a|one|two|\d+) cards? from their graveyard\.?$/i,
      make: (m) => ({ op: 'exileFromGraveyard', n: num(m[1]), who: 'target', targets: [{ type: 'player' }] }) },
    /* "Exile target card from a graveyard": the card is chosen as a
       target, from whichever graveyard, as the spell or ability is put on
       the stack */
    { re: /^Exile (up to one )?target ((?:[a-z]+ )*?)card from (a|your|an opponent's) graveyard\.?$/i,
      make: (m) => {
        const spec = m[2].trim() ? targetSpec('target ' + m[2].trim(), 'graveyard') : { type: 'permanent', filter: 'card', zone: 'graveyard' };
        if (spec.unknown) return null;
        if (/your/i.test(m[3])) spec.controller = 'you';
        if (/opponent/i.test(m[3])) spec.controller = 'opponent';
        if (m[1]) spec.upTo = true;
        return { op: 'exile', targets: [spec] };
      } },
    { re: /^Exile a card from a graveyard\.?$/i,
      make: () => ({ op: 'exile', targets: [{ type: 'permanent', filter: 'card', zone: 'graveyard' }] }) },
    /* "Exile up to two target cards from a single graveyard": whichever
       graveyard the first one is in, the others must share */
    { re: /^Exile up to (two|three|four|five) target cards from a single graveyard\.?$/i,
      make: (m) => ({ op: 'exile', sameGraveyard: true,
        targets: Array.from({ length: num(m[1]) }, () => ({ type: 'permanent', filter: 'card', zone: 'graveyard', upTo: true })) }) },

    /* ===== keyword actions that make a thing ===== */
    { re: /^Investigate\.?$/i, make: () => ({ op: 'createNamedToken', n: 1, token: 'Clue' }) },
    { re: /^Investigate (two|three|\d+) times\.?$/i, make: (m) => ({ op: 'createNamedToken', n: num(m[1]), token: 'Clue' }) },
    /* The named artifact tokens come dressed in different words on
       different cards — "a colorless Treasure artifact token with
       '{T}, Sacrifice this artifact: Add one mana of any color.'" is the
       same Treasure as "a Treasure token", and some arrive tapped. */
    { re: /^Create (a|an|one|two|three|four|five|six|seven|eight|nine|ten|\d+) (tapped )?(?:colorless |white |blue |black |red |green |legendary )*(Treasure|Clue|Food|Blood|Map|Junk|Powerstone|Incubator|Gold|Shard|Walker|Lander) (?:artifact |enchantment |creature )*tokens?(?: with "[^"]*")?\.?$/i,
      make: (m) => ({ op: 'createNamedToken', n: num(m[1]), token: m[3], tapped: !!m[2] }) },
    { re: /^Populate\.?$/i, make: () => ({ op: 'populate' }) },


    /* ===== cost changes other spells feel ===== */
    { re: /^([A-Za-z]* ?)spells? (?:your opponents cast |you cast )?costs? \{(\d+)\} more to cast\.?$/i,
      make: (m) => ({ op: 'taxSpells', amount: +m[2], filter: (m[1] || '').trim().toLowerCase(),
        who: /your opponents cast/i.test(m[0]) ? 'opponents' : (/you cast/i.test(m[0]) ? 'you' : 'all') }) },

    /* ===== odds and ends that come up a lot ===== */
    { re: /^You may play an additional land this turn\.?$/i, make: () => ({ op: 'extraLand', n: 1 }) },
    // Summer Bloom: "You may play up to three additional lands this turn."
    { re: /^You may play up to (two|three|four) additional lands this turn\.?$/i, make: (m) => ({ op: 'extraLand', n: num(m[1]) }) },
    { re: /^Shuffle (?:this (?:artifact|card)|CARDNAME) and your graveyard into (?:their|its) owner'?s library\.?$/i,
      make: () => ({ op: 'graveyardToLibrary', withSelf: true }) },
    { re: /^Shuffle your graveyard into your library\.?$/i, make: () => ({ op: 'graveyardToLibrary' }) },
    { re: /^This spell can'?t be countered\.?$/i, make: () => ({ op: 'cantBeCountered' }) },
    { re: /^Put all ([a-z ]+?) cards revealed this way into your hand and the rest into your graveyard\.?$/i,
      make: (m) => ({ op: 'sortRevealed', filter: m[1].trim().toLowerCase(), keep: 'hand', rest: 'graveyard' }) },


    { re: /^(Target (?:attacking |blocking |attacking or blocking )?creature(?: you control| you don'?t control| an opponent controls)?|CARDNAME|This creature|It|That creature) gets ([+-][\dX]+)\/([+-][\dX]+) and (?:gains|has) ([a-z, ']+?) until end of turn\.?$/i,
      make: (m) => ({ op: 'sequence', list: [
        { op: 'pump', p: pmNum(m[2]), t: pmNum(m[3]), duration: 'eot',
          targets: /^target/i.test(m[1]) ? [targetSpec(m[1])] : null,
          scope: /^target/i.test(m[1]) ? null : (/^(it|that creature)$/i.test(m[1]) ? 'lastTarget' : 'self') },
        { op: 'grantKeyword', keywords: m[4].split(/,| and /).map(x => U.titleCase(x.trim())).filter(Boolean),
          duration: 'eot',
          targets: /^target/i.test(m[1]) ? [targetSpec(m[1])] : null,
          scope: /^target/i.test(m[1]) ? null : (/^(it|that creature)$/i.test(m[1]) ? 'lastTarget' : 'self') }] }) },
    { re: /^(Target creature(?: you control)?|CARDNAME|This creature) gains ([a-z, ']+?) and gets ([+-][\dX]+)\/([+-][\dX]+) until end of turn\.?$/i,
      make: (m) => ({ op: 'sequence', list: [
        { op: 'grantKeyword', keywords: m[2].split(/,| and /).map(x => U.titleCase(x.trim())).filter(Boolean),
          duration: 'eot', targets: /^target/i.test(m[1]) ? [targetSpec(m[1])] : null,
          scope: /^target/i.test(m[1]) ? null : 'self' },
        { op: 'pump', p: pmNum(m[3]), t: pmNum(m[4]), duration: 'eot',
          targets: /^target/i.test(m[1]) ? [targetSpec(m[1])] : null,
          scope: /^target/i.test(m[1]) ? null : 'self' }] }) },

    /* ===== a pump and a grant in the same breath ===== */
    { re: /^(Creatures you control|Creatures your opponents control|All creatures|Each creature you control) (?:get|gets) ([+-][\dX]+)\/([+-][\dX]+) and (?:gain|gains|have|has) ([a-z, ']+?) until end of turn\.?$/i,
      make: (m) => ({ op: 'sequence', list: [
        { op: 'pump', p: pmNum(m[2]), t: pmNum(m[3]), duration: 'eot', scope: massScope(m[1]) },
        { op: 'grantKeyword', keywords: m[4].split(/,| and /).map(x => U.titleCase(x.trim())).filter(Boolean),
          duration: 'eot', scope: massScope(m[1]) }] }) },
    { re: /^(Creatures you control|Creatures your opponents control|All creatures) (?:gain|gains|have|has) ([a-z, ']+?) and (?:get|gets) ([+-][\dX]+)\/([+-][\dX]+) until end of turn\.?$/i,
      make: (m) => ({ op: 'sequence', list: [
        { op: 'grantKeyword', keywords: m[2].split(/,| and /).map(x => U.titleCase(x.trim())).filter(Boolean),
          duration: 'eot', scope: massScope(m[1]) },
        { op: 'pump', p: pmNum(m[3]), t: pmNum(m[4]), duration: 'eot', scope: massScope(m[1]) }] }) },
    { re: /^(Creatures you control|All creatures) (?:gain|gains) ([a-z, ']+?) and (?:get|gets) \+X\/\+X until end of turn, where X is the number of ([-a-z' ]+?) you control\.?$/i,
      make: (m) => ({ op: 'sequence', list: [
        { op: 'grantKeyword', keywords: m[2].split(/,| and /).map(x => U.titleCase(x.trim())).filter(Boolean),
          duration: 'eot', scope: massScope(m[1]) },
        { op: 'pump', p: countSpec(m[3], 1), t: countSpec(m[3], 1), duration: 'eot', scope: massScope(m[1]) }] }) },

    /* ===== counters a permanent brings with it ===== */
    { re: /^(?:CARDNAME|This (?:creature|artifact|permanent|enchantment)) enters(?: the battlefield)? with (a|one|two|three|four|five|X|\d+) ((?:[+-]\d\/[+-]\d)|[a-z ]+?) counters? on it\.?$/i,
      make: (m) => ({ op: 'etbCounters', kind: m[2].trim(), n: num(m[1]) }) },

    /* ===== reanimation with a filter ===== */
    { re: /^Return (target [a-z0-9 '-]+? card)(?: with (?:mana value|converted mana cost) (\d+) or less)? from your graveyard to the battlefield\.?$/i,
      make: (m) => ({ op: 'reanimate', targets: [Object.assign(targetSpec(m[1].replace(/ card$/, '')),
        { zone: 'graveyard', controller: 'you' }, m[2] ? { maxMv: +m[2] } : {})] }) },

    /* ===== counting things other than permanents ===== */
    { re: /^You gain (one|two|three|\d+) life for each spell you'?ve cast this turn\.?$/i,
      make: (m) => ({ op: 'gainLife', who: 'you', n: { spellsThisTurn: num(m[1]) } }) },
    { re: /^Create X (Treasure|Clue|Food|Blood|Powerstone) tokens?, where X is the number of ([-a-z' ]+?) (?:your opponents control|you control)\.?$/i,
      make: (m) => ({ op: 'createNamedToken', token: m[1],
        n: countSpec(m[2], 1, /your opponents control/i.test(m[0]) ? 'opponents' : 'you') }) },

    /* ===== the small leftovers ===== */
    { re: /^(?:Then )?[Ss]huffle\.?$/i, make: () => ({ op: 'shuffle' }) },
    { re: /^Put (a|one|two|three|\d+) cards? from your hand on top of your library(?: in any order)?\.?$/i,
      make: (m) => ({ op: 'handToTop', n: num(m[1]) }) },


    /* ===== a land that gets up and attacks ===== */
    { re: /^(?:This (?:land|permanent|artifact)|CARDNAME) becomes an? ([\dX*]+\/[\dX*]+)((?: (?:white|blue|black|red|green|colorless|and))*) ([A-Za-z][-A-Za-z ]*?) creature(?: with ([a-z, ']+?))? until end of turn\.?$/i,
      make: (m) => ({ op: 'animate', pt: m[1],
        colorWords: (m[2] || '').match(/white|blue|black|red|green|colorless/gi) || [],
        subtypes: m[3].replace(/\s*\b(artifact|enchantment)\b\s*/gi, ' ').trim(),
        addTypes: (m[3].match(/\b(artifact|enchantment)\b/gi) || []).map(U.titleCase),
        keywords: m[4] ? m[4].split(/,| and /).map(x => U.titleCase(x.trim())).filter(Boolean) : [],
        duration: 'eot' }) },
    { re: /^It'?s still a land\.?$/i, make: () => ({ op: 'noop' }) },

    /* ===== whoever set the trigger off ===== */
    { re: /^(?:[A-Za-z][-A-Za-z0-9',’\. ]{0,44}?\s)?deals? (one|two|three|four|five|\d+|X) damage to (?:that player|them)\.?$/i,
      make: (m) => ({ op: 'damage', n: num(m[1]), toTriggerPlayer: true }) },
    { re: /^(?:CARDNAME|This (?:creature|Equipment|artifact|enchantment)) deals damage to that player equal to the number of cards in their hand\.?$/i,
      make: () => ({ op: 'damage', n: { cardsInHand: 'triggerPlayer' }, toTriggerPlayer: true }) },
    { re: /^(?:They|That player) mills? (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?\.?$/i,
      make: (m) => ({ op: 'mill', who: 'triggerPlayer', n: num(m[1]) }) },
    { re: /^(?:They|That player) mills? that many cards\.?$/i,
      make: () => ({ op: 'mill', who: 'triggerPlayer', n: 'triggerAmount' }) },
    { re: /^You may have (?:that player|them) lose (one|two|three|\d+) life\.?$/i,
      make: (m) => ({ op: 'may', then: [{ op: 'loseLife', who: 'triggerPlayer', n: num(m[1]) }] }) },
    // Blood Money: "For each nontoken creature destroyed this way, you create a tapped Treasure token."
    { re: /^For each nontoken creature destroyed this way, you create an? (tapped )?(Treasure|Clue|Food) token\.?$/i,
      make: (m) => Object.assign({ op: 'createNamedToken', token: m[2], n: { sweptNontoken: true, mult: 1 } }, m[1] ? { tapped: true } : {}) },
    // Jarad: "Each opponent loses life equal to the sacrificed creature's power."
    { re: /^Each opponent loses life equal to the sacrificed creature'?s (power|toughness|mana value)\.?$/i,
      make: (m) => ({ op: 'loseLife', who: 'opponents', n: { ofSacrificed: ({ power: 'power', toughness: 'toughness', 'mana value': 'mv' })[m[1].toLowerCase()] } }) },
    // Decree of Pain: "Draw a card for each creature destroyed this way."
    // Bane of Progress: "Put a +1/+1 counter on this creature for each permanent destroyed this way."
    { re: /^Put an? ([+\-0-9/a-z]+) counter on (?:this creature|CARDNAME) for each (?:creature|permanent|artifact) (?:destroyed|exiled|returned) this way\.?$/i,
      make: (m) => ({ op: 'counters', kind: m[1].toLowerCase(), n: { lastSweep: true, mult: 1 }, scope: 'self' }) },
    { re: /^Draw (a|one|two) cards? for each (?:creature|permanent|artifact) (?:destroyed|exiled|returned) this way\.?$/i,
      make: (m) => ({ op: 'draw', who: 'you', n: { lastSweep: true, mult: num(m[1]) } }) },
    { re: /^You gain (one|two|three|\d+) life for each (?:creature|permanent|artifact) (?:destroyed|exiled|returned) this way\.?$/i,
      make: (m) => ({ op: 'gainLife', who: 'you', n: { lastSweep: true, mult: num(m[1]) } }) },
    { re: /^You have no maximum hand size for the rest of the game\.?$/i, make: () => ({ op: 'noMaxHandForever' }) },
    /* Overwhelming Stampede: X is worked out once, as it resolves */
    { re: /^Until end of turn, creatures you control gain ([a-z, ']+?) and get \+X\/\+X, where X is (.+?)\.?$/i,
      make: (m) => {
        const k = amountOf(m[2]);
        const kws = keywordList(m[1]);
        if (!k || !kws.every(x => kwKnown(x))) return null;
        return { op: 'sequence', list: [
          { op: 'pump', p: k, t: k, duration: 'eot', scope: 'yourCreatures' },
          { op: 'grantKeyword', keywords: kws, duration: 'eot', scope: 'yourCreatures' }] };
      } },
    /* Bident of Thassa */
    { re: /^Creatures your opponents control attack this turn if able\.?$/i, make: () => ({ op: 'opponentsMustAttack' }) },
    { re: /^(Each opponent|Target player|Target opponent) gets? (a|one|two|three|\d+) poison counters?\.?$/i,
      make: (m) => Object.assign({ op: 'poison', n: num(m[2]), who: /^each/i.test(m[1]) ? 'opponents' : 'target' },
        /^target/i.test(m[1]) ? { targets: [{ type: /opponent/i.test(m[1]) ? 'opponent' : 'player' }] } : {}) },
    { re: /^You gain life equal to the damage dealt this way\.?$/i, make: () => ({ op: 'gainLife', who: 'you', n: 'lastDamage' }) },
    { re: /^Create a number of (tapped )?(Treasure|Clue|Food|Blood) tokens equal to (.+?)\.?$/i,
      make: (m) => {
        const k = amountOf(m[3]);
        return k ? { op: 'createNamedToken', token: m[2], n: k, tapped: !!m[1] } : null;
      } },
    { re: /^For each ([-a-zA-Z' ]+?) you control, create an? (tapped )?(Treasure|Clue|Food|Blood) token\.?$/i,
      make: (m) => {
        const c = countOf(m[1] + ' you control');
        return c ? { op: 'createNamedToken', token: m[3], n: c, tapped: !!m[2] } : null;
      } },
    { re: /^Each player may play an additional land on each of their turns\.?$/i, make: () => ({ op: 'extraLand', n: 1, all: true }) },
    { re: /^Exile each opponent'?s graveyard\.?$/i, make: () => ({ op: 'exileGraveyard', who: 'opponents' }) },
    { re: /^Each opponent exiles their graveyard\.?$/i, make: () => ({ op: 'exileGraveyard', who: 'opponents' }) },
    { re: /^Return (target [a-z ]*?creature card) from your graveyard to the battlefield with an? ([+\-0-9/a-z]+) counter on it\.?$/i,
      make: (m) => ({ op: 'reanimate', counter: m[2].toLowerCase(), targets: [targetSpec(m[1].replace(/ card$/, ''), 'graveyard')].map(t => Object.assign(t, { controller: 'you' })) }) },
    /* more combat */
    { re: /^After this (?:main )?phase, there is an additional combat phase( followed by an additional main phase)?\.?$/i,
      make: (m) => ({ op: 'extraCombat', count: 1, withMain: !!m[1] }) },
    // Great Train Heist: "If it's your combat phase, there is an additional combat phase after this phase."
    { re: /^If it'?s your main phase, there is an additional combat phase after this phase(, followed by an additional main phase)?\.?$/i,
      make: (m) => ({ op: 'extraCombat', count: 1, withMain: !!m[1], inMain: true }) },
    { re: /^If it'?s your combat phase, there is an additional combat phase after this phase\.?$/i,
      make: () => ({ op: 'extraCombat', count: 1, inCombat: true }) },
    { re: /^After this (?:main )?phase, there are (two|three) additional combat phases( followed by an additional main phase)?\.?$/i,
      make: (m) => ({ op: 'extraCombat', count: num(m[1]), withMain: !!m[2] }) },
    { re: /^Untap all creatures (?:you control )?that attacked this turn\.?$/i, make: () => ({ op: 'untapAttackedThisTurn' }) },
    { re: /^Untap all attacking creatures\.?$/i, make: () => ({ op: 'untapAttacking' }) },
    /* Splendid Reclamation, Aftermath Analyst, Lumra */
    // Knights' Charge: "Return all Knight creature cards from your graveyard to the battlefield."
    { re: /^Return all ([A-Z][a-z]+) creature cards from your graveyard to the battlefield( tapped)?\.?$/,
      make: (m) => ({ op: 'massReanimate', filter: m[1].toLowerCase() + ' creature', yours: true, tapped: !!m[2] }) },
    // Primevals' Glorious Rebirth, Raise the Past: "all legendary permanent cards", "with mana value 2 or less"
    { re: /^[Rr]eturn all ((?:legendary|nonlegendary|historic) (?:permanent|creature|artifact) |(?:creature|artifact|enchantment|permanent) )cards with (?:mana value|converted mana cost) (\d+) or less from your graveyard to the battlefield\.?$|^[Rr]eturn all (legendary (?:permanent|creature|artifact)) cards from your graveyard to the battlefield\.?$/,
      make: (m) => (m[3] ? { op: 'massReanimate', filter: m[3].toLowerCase(), yours: true }
        : { op: 'massReanimate', filter: m[1].trim().toLowerCase(), maxMv: +m[2], yours: true }) },
    { re: /^(?:Then )?[Rr]eturn all ((?:land|creature|artifact|enchantment|permanent|nonland permanent)(?: (?:and\/or|and) (?:land|creature|artifact|enchantment))?) cards from your graveyard to the battlefield( tapped)?(?: under your control)?\.?$/,
      make: (m) => ({ op: 'massReanimate', filter: m[1].toLowerCase().replace(/ (?:and\/or|and) /g, ' or '), yours: true, tapped: !!m[2] }) },
    /* "Sacrifice it. When you do, search …": the reflexive half, which
       follows straight on from the cost it waited for */
    { re: /^When you do, (.+)$/i,
      make: (m) => {
        const inner = parseSentenceList(splitSentences(U.titleCase(m[1].charAt(0)) + m[1].slice(1)));
        if (!inner.auto || !inner.effects.length) return null;
        return inner.effects.length === 1 ? inner.effects[0] : { op: 'sequence', list: inner.effects };
      } },
    { re: /^You may cast spells this turn as though they had flash\.?$/i, make: () => ({ op: 'flashThisTurn' }) },
    /* ===== "equal to …": a number worked out as it happens ===== */
    { re: /^(?:You )?[Dd]raws? cards equal to (.+?)(?:, then discard (a|one|two|three|\d+) cards?)?\.?$/,
      make: (m) => {
        const k = amountOf(m[1]);
        if (!k) return null;
        const draw = { op: 'draw', n: k, who: 'you' };
        return m[2] ? { op: 'sequence', list: [draw, { op: 'discard', n: num(m[2]), who: 'you' }] } : draw;
      } },
    { re: /^(Target player|Each opponent|You) mills? cards equal to (.+?)\.?$/i,
      make: (m) => {
        const k = amountOf(m[2]);
        if (!k) return null;
        const who = /^target/i.test(m[1]) ? 'target' : /opponent/i.test(m[1]) ? 'opponents' : 'you';
        return Object.assign({ op: 'mill', n: k, who }, who === 'target' ? { targets: [{ type: 'player' }] } : {});
      } },
    { re: /^(?:Then )?[Yy]ou (gain|lose) life equal to (.+?)\.?$/,
      make: (m) => {
        const k = amountOf(m[2]);
        if (!k) return null;
        return { op: /gain/i.test(m[1]) ? 'gainLife' : 'loseLife', n: k, who: 'you' };
      } },
    { re: /^(CARDNAME|This creature|It|That creature|Target creature you control) deals damage equal to (.+?) to (any target|any other target|target [a-z' ]+?|each opponent|each other creature|each creature|each other creature and each opponent)\.?$/i,
      make: (m) => {
        const k = amountOf(m[2]);
        if (!k) return null;
        const e = { op: 'damage', n: k };
        // "it" in a trigger about another creature is that creature dealing it
        if (/^(it|that creature)$/i.test(m[1])) e.fromTrigger = true;
        /* Vein Drinker: "This creature deals damage equal to its power" —
           its own power, in an activated ability as much as in a trigger */
        if (/^(CARDNAME|This creature)$/i.test(m[1]) && k.ofTrigger && k.ofTrigger !== 'mv' && !k.plus) e.n = { ofSelf: k.ofTrigger };
        if (/^target/i.test(m[1])) {
          e.fromTarget = true; e.targets = [targetSpec(m[1])];
          // "its power" is the power of the creature dealing it
          if (k.ofTrigger) e.n = { ofTarget: k.ofTrigger };
        }
        if (/^each other creature and each opponent$/i.test(m[3])) { e.each = 'creature opponent'; e.eachOther = true; }
        else if (/^each opponent$/i.test(m[3])) e.each = 'opponent';
        else if (/^each (?:other )?creature$/i.test(m[3])) { e.each = 'creature'; if (/other/i.test(m[3])) e.eachOther = true; }
        else e.targets = (e.targets || []).concat([targetSpec(m[3])]);
        return e;
      } },
    { re: /^Defending player reveals the top card of their library\.?$/i,
      make: () => ({ op: 'noop' }) },

    /* ===== keyword actions ===== */
    { re: /^(?:Then )?[Aa]mass ([A-Za-z]+ )?(\d+|X)\.?$/i,
      make: (m) => ({ op: 'amass', n: m[2] === 'X' ? 'X' : +m[2], kind: (m[1] || 'Zombie').trim() }) },
    { re: /^(?:Then )?[Cc]onnive\.?$/i, make: () => ({ op: 'connive', n: 1 }) },
    { re: /^(?:Then )?[Cc]onnive (\d+)\.?$/i, make: (m) => ({ op: 'connive', n: +m[1] }) },
    { re: /^[Ss]cry (\d+), then draw (a|one|two|three|\d+) cards?\.?$/i,
      make: (m) => ({ op: 'sequence', list: [{ op: 'scry', n: +m[1] }, { op: 'draw', n: num(m[2]), who: 'you' }] }) },

    /* ===== reading and revealing, with the number left out ===== */
    { re: /^Reveal the top card of your library and put (?:that card|it) into your hand\.?$/i,
      make: () => ({ op: 'drawFromTop', n: 1 }) },
    { re: /^Reveal the top card of your library\.?$/i, make: () => ({ op: 'reveal', n: 1, from: 'library' }) },
    { re: /^Until end of turn, you may (?:cast|play) that (?:card|spell)\.?$/i, make: () => ({ op: 'markImpulse', duration: 'eot' }) },
    { re: /^(?:You may )?[Cc]ast that card(?: without paying its mana cost)?\.?$/i, make: () => ({ op: 'markImpulse', duration: 'eot' }) },
    { re: /^Until the end of your next turn, you may (?:cast|play) that (?:card|spell)\.?$/i, make: () => ({ op: 'markImpulse' }) },
    { re: /^Exile the top card of (?:that player'?s|target player'?s) library\.?$/i,
      make: () => ({ op: 'impulse', n: 1, play: false, whose: 'triggerPlayer' }) },



    /* ===== putting a card from hand straight onto the battlefield ===== */
    { re: /^(?:Then )?(?:[Yy]ou may )?[Pp]ut an? ([-a-z, ]*?)card from your hand onto the battlefield( tapped)?\.?$/i,
      make: (m) => Object.assign({ op: 'permanentFromHand', filter: (m[1] || '').trim().toLowerCase() || 'any', who: 'you' }, m[2] ? { tapped: true } : {}) },
    // Smuggler's Surprise: "You may put up to two creature cards from your hand onto the battlefield."
    { re: /^(?:[Yy]ou may )?[Pp]ut up to (two|three|four) ([-a-z, ]*?)cards from your hand onto the battlefield( tapped)?\.?$/i,
      make: (m) => Object.assign({ op: 'permanentFromHand', n: num(m[1]), filter: (m[2] || '').trim().toLowerCase() || 'any', who: 'you' }, m[3] ? { tapped: true } : {}) },
    /* Lively Dirge: "Return up to two creature cards with total mana value 4
       or less from your graveyard to the battlefield." Chosen, not targeted. */
    { re: /^Return up to (two|three|four) ([a-z]+) cards with total mana value (\d+) or less from your graveyard to the battlefield\.?$/i,
      make: (m) => ({ op: 'reanimateChosen', n: num(m[1]), what: m[2].toLowerCase(), totalMv: +m[3] }) },
    /* "Put target creature on the top or bottom of its owner's library":
       the one who resolves it chooses; "its owner puts it on their choice
       of the top or bottom" is the owner's choice */
    { re: /^Put (target [a-z ]+?) on (?:the )?top or bottom of its owner'?s library\.?$/i,
      make: (m) => ({ op: 'topOrBottom', targets: [targetSpec(m[1])] }) },
    { re: /^(Target [a-z ]+?)'s owner puts it on (?:their choice of )?the top or bottom of their library\.?$/i,
      make: (m) => ({ op: 'topOrBottom', ownerChooses: true, targets: [targetSpec(m[1])] }) },
    { re: /^Each player may put an? ([-a-z, ]*?)card from their hand onto the battlefield\.?$/i,
      make: (m) => ({ op: 'permanentFromHand', filter: (m[1] || '').trim().toLowerCase() || 'any', who: 'each' }) },
    { re: /^That creature gains ([a-z, ']+?)\.?$/i,
      make: (m) => ({ op: 'grantKeyword', scope: 'thatObject',
        keywords: m[1].split(/,| and /).map(x => U.titleCase(x.trim())).filter(Boolean), duration: null }) },

    /* ===== damage split between things ===== */
    { re: /^(?:[A-Za-z][-A-Za-z0-9',’\. ]{0,44}?\s)?deals? (one|two|three|four|five|six|\d+|X) damage divided as you choose among (?:one or two targets|one, two, or three targets|any number of targets?|any number of target creatures(?: and\/or planeswalkers)?|two or three targets)\.?$/i,
      make: (m) => ({ op: 'damageDivided', n: num(m[1]) }) },
    { re: /^(?:[A-Za-z][-A-Za-z0-9',’\. ]{0,44}?\s)?deals? (X|\d+) damage divided evenly, rounded down, among any number of targets\.?$/i,
      make: (m) => ({ op: 'damageDivided', n: num(m[1]), evenly: true }) },

    { re: /^Exile this Saga, then return it to the battlefield transformed under your control\.?$/i,
      make: () => ({ op: 'transformSelf' }) },


    /* ===== "as this enters" is a choice made on the way in ===== */
    { re: /^Its controller may search their library for a basic land card, puts? (?:it|that card) onto the battlefield( tapped)?, then shuffles?\.?$/i,
      make: (m) => ({ op: 'fetchBasic', n: 1, tapped: !!m[1], who: 'targetController', optional: true }) },
    { re: /^Evoke—Exile an? ([a-z]+) card from your hand\.?$/i, make: () => ({ op: 'noop' }) },

    /* ===== wider sweeps with an exception ===== */
    // Wave Goodbye: "Return each creature without a +1/+1 counter on it to its owner's hand."
    { re: /^Return each (creature|nonland permanent) without an? ([+\-0-9/a-z]+) counter on it to its owner'?s hand\.?$/i,
      make: (m) => ({ op: 'bounceAll', what: m[1].toLowerCase() + 's', withoutCounter: m[2].toLowerCase() }) },
    // Winds of Rath: "Destroy all creatures that aren't enchanted."
    { re: /^Destroy all creatures that aren'?t enchanted\.?$/i, make: () => ({ op: 'destroyAll', what: 'creature', unenchanted: true }) },
    { re: /^Destroy each ([a-z]+(?:land)? permanents?|[a-z]+s) without an? ([a-z ]+?) counter on it\.?$/i,
      make: (m) => ({ op: 'destroyAll', what: m[1].toLowerCase(), withoutCounter: m[2].trim() }) },

    { re: /^A creature dealt damage this way can'?t be regenerated this turn\.?$/i,
      make: () => ({ op: 'noop', noRegenRider: true }) },

    /* ===== giving something of your own back ===== */
    // the Karoo lands: "return a land you control to its owner's hand"
    { re: /^Return an? ([a-z][a-z ]*?) you control to (?:its|their) owner'?s hand\.?$/i,
      make: (m) => ({ op: 'returnOwn', filter: m[1].trim().toLowerCase(), n: 1 }) },
    { re: /^Return (two|three|\d+) ([a-z][a-z ]*?) you control to (?:its|their) owner'?s hand\.?$/i,
      make: (m) => ({ op: 'returnOwn', filter: m[2].trim().toLowerCase(), n: num(m[1]) }) },
    { re: /^Return (?:CARDNAME|this permanent|this creature|this land) to (?:its|their) owner'?s hand\.?$/i,
      make: () => ({ op: 'returnOwn', self: true, n: 1 }) },

    /* ===== crowns, counters and looking at your own library ===== */
    { re: /^(?:You|you) becomes? the monarch\.?$/i, make: () => ({ op: 'becomeMonarch' }) },
    { re: /^(?:You|you) takes? the initiative\.?$/i, make: () => ({ op: 'takeInitiative' }) },
    { re: /^(?:You|you) gets? ((?:\{E\})+)\.?$/i,
      make: (m) => ({ op: 'energy', n: (m[1].match(/\{E\}/g) || []).length }) },
    { re: /^Look at the top (a|an|one|two|three|four|five|six|seven|\d+) cards? of your library\.?$/i,
      make: (m) => ({ op: 'lookTop', n: num(m[1]) }) },
    { re: /^Look at the top card of your library\.?$/i, make: () => ({ op: 'lookTop', n: 1 }) },
    // Mishra's Bauble: "Look at the top card of target player's library."
    { re: /^Look at the top card of target player'?s library\.?$/i, make: () => ({ op: 'lookTop', n: 1, who: 'target', targets: [{ type: 'player' }] }) },
    { re: /^Monstrosity (\d+)\.?$/i, make: (m) => ({ op: 'monstrosity', n: +m[1] }) },
    { re: /^(?:It|CARDNAME|This creature) explores\.?$/i, make: () => ({ op: 'explore', n: 1 }) },
    { re: /^(?:It|CARDNAME|This creature) explores, then it explores again\.?$/i,
      make: () => ({ op: 'sequence', list: [{ op: 'explore', n: 1 }, { op: 'explore', n: 1 }] }) },
    { re: /^(Target creature you control) explores\.?$/i, make: (m) => ({ op: 'explore', n: 1, targets: [targetSpec(m[1])] }) },
    { re: /^Choose a color\.?$/i, make: () => ({ op: 'chooseColor' }) },
    { re: /^Add one mana of the chosen color\.?$/i, make: () => ({ op: 'addManaChosen', n: 1 }) },
    // the Thriving lands: their own colour, or the one chosen as they entered
    { re: /^Add \{([WUBRG])\} or one mana of the chosen colou?r\.?$/i, make: (m) => ({ op: 'addManaChosen', n: 1, orSymbol: m[1].toUpperCase() }) },
    { re: /^Add (two|three|\d+) mana of the chosen color\.?$/i, make: (m) => ({ op: 'addManaChosen', n: num(m[1]) }) },
    { re: /^Flip a coin\.?$/i, make: () => ({ op: 'flipCoin' }) },
    /* The Ring tempts you (CR 701.52): the emblem gains a level and you
       name a Ring-bearer. */
    { re: /^The Ring tempts you\.?$/i, make: () => ({ op: 'ringTempts' }) },

    /* Clash (CR 701.23): both players look at the top of their library and
       the bigger mana value wins. */
    { re: /^Clash with an opponent\.?$/i, make: () => ({ op: 'clash' }) },
    { re: /^If you win(?: the clash)?, (.+)$/i,
      make: (m) => {
        const inner = parseSentenceList(splitSentences(U.titleCase(m[1].charAt(0)) + m[1].slice(1)));
        if (!inner.auto || !inner.effects.length) return null;
        return { op: 'noop', flipRider: { win: true, effects: inner.effects, of: 'clash' } };
      } },
    /* "If you win the flip, …" is the sentence after the flip, and belongs
       to it rather than standing on its own. */
    { re: /^If you (win|lose) the flip, (.+)$/i,
      make: (m) => {
        const inner = parseSentenceList(splitSentences(U.titleCase(m[2].charAt(0)) + m[2].slice(1)));
        if (!inner.auto || !inner.effects.length) return null;
        return { op: 'noop', flipRider: { win: /win/i.test(m[1]), effects: inner.effects } };
      } },
    { re: /^Flip a coin\. If you win the flip, (.+?)(?:\. If you lose the flip, (.+?))?\.?$/i,
      make: (m) => {
        const win = parseSentenceList(splitSentences(U.titleCase(m[1].charAt(0)) + m[1].slice(1)));
        if (!win.auto || !win.effects.length) return null;
        const lose = m[2] ? parseSentenceList(splitSentences(U.titleCase(m[2].charAt(0)) + m[2].slice(1))) : null;
        if (lose && !lose.auto) return null;
        return { op: 'flipCoin', then: win.effects, otherwise: lose ? lose.effects : [] };
      } },
    { re: /^Explore\.?$/i, make: () => ({ op: 'explore', n: 1 }) },
    { re: /^Regenerate (?:enchanted|equipped) creature\.?$/i,
      make: () => ({ op: 'regenerate', scope: 'attached' }) },
    { re: /^(?:Enchanted|Equipped) creature gets ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
      make: (m) => ({ op: 'pump', p: +m[1], t: +m[2], scope: 'attached' }) },
    { re: /^(?:CARDNAME|This creature|This permanent) gets ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
      make: (m) => ({ op: 'pump', p: +m[1], t: +m[2], scope: 'self' }) },
    { re: /^(?:CARDNAME|This creature) gains ([a-z ]+) until end of turn\.?$/i,
      make: (m) => ({ op: 'grant', keywords: [U.titleCase(m[1].trim())], scope: 'self' }) },
    { re: /^Up to one target creature can'?t be blocked this turn\.?$/i,
      make: () => ({ op: 'restrict', flag: 'unblockable', targets: [{ type: 'creature', upTo: true, filter: 'creature' }] }) },
    { re: /^Target creature can'?t be blocked this turn\.?$/i,
      make: () => ({ op: 'restrict', flag: 'unblockable', targets: [{ type: 'creature' }] }) },
    { re: /^Target creature with power (\d+) or less can'?t be blocked this turn\.?$/i,
      make: (m) => ({ op: 'restrict', flag: 'unblockable', targets: [{ type: 'creature', maxPower: +m[1] }] }) },

    /* ===== a condition on the state of the game ===== */
    { re: /^If (.+?), (?:it|CARDNAME|this spell) deals (\d+) damage instead\.?$/i,
      make: (m) => {
        const cond = condOf(m[1]);
        if (!cond) return null;
        return { op: 'noop', insteadRider: { op: 'damage', cond, n: +m[2] } };
      } },
    { re: /^If (.+?), (?:you )?(?:instead )?(?:draw|gain) .*instead\.?$/i, make: () => null },
    { re: /^Untap that (?:land|permanent|creature|artifact)\.?$/i, make: () => ({ op: 'untap', scope: 'lastAffected' }) },
    /* Scute Swarm: "If you control six or more lands, create a token that's
       a copy of this creature instead." — the sentence before, swapped out
       when the condition holds */
    { re: /^If (.+?), (.+?) instead\.?$/i,
      make: (m) => {
        const cond = condOf(m[1]);
        if (!cond) return null;
        const inner = parseEffectSentence(m[2].charAt(0).toUpperCase() + m[2].slice(1) + '.');
        if (!inner || inner.op === 'manual') return null;
        return { op: 'noop', insteadOf: { cond, effects: [inner] } };
      } },
    // Martial Coup: "If X is 5 or more, destroy all other creatures."
    { re: /^If X is (\d+) or more, (.+)$/i,
      make: (m) => {
        const inner = parseSentenceList(splitSentences(m[2].charAt(0).toUpperCase() + m[2].slice(1)));
        if (!inner.auto || !inner.effects.length) return null;
        // "all other creatures": other than the ones this spell just made
        for (const x of inner.effects) if (x.op === 'destroyAll' && x.scope && x.scope.other) { x.exceptMade = true; delete x.scope.other; }
        return { op: 'ifCond', cond: { kind: 'xAtLeast', n: +m[1] }, then: inner.effects };
      } },
    /* "If the gift was promised, instead return target nonland permanent
       an opponent controls to its owner's hand." The same swap, with the
       word in front. */
    { re: /^If (.+?), instead (.+?)\.?$/i,
      make: (m) => {
        const cond = condOf(m[1]);
        if (!cond) return null;
        const parsed = parseSentenceList(splitSentences(m[2].charAt(0).toUpperCase() + m[2].slice(1) + '.'));
        if (!parsed.auto || !parsed.effects.length) return null;
        return { op: 'noop', insteadOf: { cond, effects: parsed.effects } };
      } },
    /* Cabal Ritual: "Add {B}{B}{B}{B}{B} instead if there are seven or more
       cards in your graveyard." */
    { re: /^(Add (?:\{[^}]+\})+) instead if (.+?)\.?$/i,
      make: (m) => {
        const cond = condOf(m[2]);
        const inner = parseEffectSentence(m[1] + '.');
        return cond && inner ? { op: 'noop', insteadOf: { cond, effects: [inner] } } : null;
      } },
    /* Chaos Warp's second half and its relatives */
    { re: /^The owner of (target [a-z ]+?) shuffles it into their library, then reveals the top card of their library\.?$/i,
      make: (m) => ({ op: 'sequence', list: [{ op: 'toLibrary', where: 'shuffle', targets: [targetSpec(m[1])] },
        { op: 'revealTopPut', who: 'lastOwner', filter: 'permanent' }] }) },
    { re: /^If it'?s a permanent card, they put it onto the battlefield\.?$/i, make: () => ({ op: 'noop' }) },
    /* Herald's Horn: "If it's a creature card of the chosen type, you may
       reveal it and put it into your hand." after looking at the top card */
    { re: /^If it'?s an? ([a-z ]+?) card( of the chosen type)?, you may reveal it and put it into your hand\.?$/i,
      make: (m) => ({ op: 'topIfToHand', filter: m[1].trim().toLowerCase(), chosenType: !!m[2] }) },
    /* "Change the target of target spell or ability with a single target." */
    { re: /^Change the target of (target (?:spell|activated ability|triggered ability|spell or ability|instant or sorcery spell)) with a single target\.?$/i,
      make: (m) => ({ op: 'retarget', single: true, targets: [{ type: 'spell', zone: 'stack', filter: m[1].toLowerCase().replace(/^target /, '').replace(/ or (?:activated |triggered )?ability/, ''), abilities: /ability/i.test(m[1]) }] }) },
    { re: /^You may choose new targets for (target (?:spell|spell or ability|instant or sorcery spell))\.?$/i,
      make: (m) => ({ op: 'retarget', optional: true, targets: [{ type: 'spell', zone: 'stack', filter: m[1].toLowerCase().replace(/^target /, '').replace(/ or (?:activated |triggered )?ability/, ''), abilities: /ability/i.test(m[1]) }] }) },
    /* Rishkar's Expertise */
    { re: /^You may cast a(?:n)? ([a-z ]*?)(?:spell|card) with (?:mana value|converted mana cost) (\d+|X) or less from your hand without paying its mana cost\.?$/i,
      make: (m) => ({ op: 'castFreeFromHand', filter: (m[1] || '').trim().toLowerCase() || 'card', maxMv: m[2] === 'X' ? 'X' : +m[2] }) },
    /* Malakir Rebirth: a creature that comes back once */
    { re: /^Until end of turn, (target creature|that creature) gains "When this creature dies, return it to the battlefield tapped under its owner'?s control\."\.?$/i,
      make: (m) => ({ op: 'grantDiesReturn', tapped: true, targets: /^target/i.test(m[1]) ? [{ type: 'creature' }] : undefined, scope: /^that/i.test(m[1]) ? 'lastTarget' : undefined }) },
    { re: /^Choose target creature\.?$/i, make: () => ({ op: 'noop', targets: [{ type: 'creature' }] }) },
    { re: /^You may play the exiled card without paying its mana cost(?: if (.+?))?\.?$/i,
      make: (m) => {
        const cond = m[1] ? condOf(m[1]) : null;
        if (m[1] && !cond) return null;
        return { op: 'playHidden', cond };
      } },
    { re: /^The next spell you cast this turn can'?t be countered\.?$/i, make: () => ({ op: 'nextSpellUncounterable' }) },
    { re: /^One or two target creatures can'?t block this turn\.?$/i,
      make: () => ({ op: 'restrict', flag: 'cantBlock', targets: [{ type: 'creature' }, { type: 'creature', upTo: true }] }) },
    { re: /^(?:A creature|Creatures) destroyed this way can'?t be regenerated\.?$/i, make: () => ({ op: 'noop', noRegenRider: true }) },
    { re: /^Its controller manifests the top card of their library\.?$/i, make: () => ({ op: 'manifest', who: 'targetController' }) },
    { re: /^Manifest the top card of your library\.?$/i, make: () => ({ op: 'manifest' }) },
    { re: /^(?:That creature'?s controller|Its controller) sacrifices it\.?$/i, make: () => ({ op: 'sacAttached' }) },
    { re: /^Untap (up to )?(one|two|three|four|five|\d+) (lands|creatures|artifacts|permanents)( you control)?\.?$/i,
      make: (m) => ({ op: 'untapChosen', n: num(m[2]), upTo: !!m[1], filter: m[3].replace(/s$/, '') }) },
    { re: /^(?:Then )?[Ii]f (.+?), (.+)$/,
      make: (m) => {
        const cond = condOf(m[1]);
        if (!cond) return null;
        const rest = m[2].replace(/^(\w)/, (c) => c.toUpperCase());
        const inner = parseSentenceList(splitSentences(rest));
        if (!inner.auto || !inner.effects.length) return null;
        return { op: 'ifCond', cond, then: inner.effects };
      } },

    /* ===== a condition on the thing just handled ===== */
    { re: /^If it was an? ([a-z ]+?) card, (.+)$/i,
      make: (m) => ({ op: 'ifLastWas', filter: m[1].trim().toLowerCase(),
        then: parseSentenceList(splitSentences(U.titleCase(m[2].charAt(0)) + m[2].slice(1))).effects }) },
    { re: /^If it'?s an? ([a-z ]+?) card, that player puts it into their hand\.?$/i,
      make: (m) => ({ op: 'ifLastWas', filter: m[1].trim().toLowerCase(), who: 'triggerPlayer',
        then: [{ op: 'toHandThat' }] }) },

    /* ===== putting a card back into a library at a depth ===== */
    { re: /^Put (?:CARDNAME|this card|it) into its owner'?s library (second|third|fourth|fifth|sixth|seventh) from the top\.?$/i,
      make: (m) => ({ op: 'selfToLibraryDepth',
        depth: { second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7 }[m[1].toLowerCase()] }) },

    /* ===== flashback granted to something in a graveyard ===== */
    { re: /^[Tt]arget instant or sorcery card in your graveyard gains flashback until end of turn\.?$/i,
      make: () => ({ op: 'grantFlashback', targets: [{ type: 'any', zone: 'graveyard', filter: 'instant or sorcery' }] }) },
    { re: /^The flashback cost is equal to its mana cost\.?$/i, make: () => ({ op: 'noop' }) },

    /* ===== mana that arrives later ===== */
    { re: /^At the beginning of your next main phase, add an amount of (\{[^}]+\}) equal to that spell'?s mana value\.?$/i,
      make: (m) => ({ op: 'delayed', event: 'yourMain1', forPlayer: 'you', nextTurn: false,
        name: 'Add mana for the countered spell',
        effects: [{ op: 'addManaPer', symbol: MANA.parse(m[1])[0], per: { counteredMv: true } }] }) },


    /* ===== the sentences that come up most often across the whole card pool ===== */
    { re: /^Put the rest on the bottom of your library in (?:a random|any) order\.?$/i,
      make: (m) => ({ op: "restToBottom", random: /random/i.test(m[0]) }) },
    { re: /^Put the rest into your graveyard\.?$/i, make: () => ({ op: 'restToGraveyard' }) },
    // Shigeki, Silverback Elder: "You may put a land card from among them onto the battlefield tapped."
    { re: /^You may put an? ([-a-z ]*?)card from among them onto the battlefield( tapped)?\.?$/i,
      make: (m) => ({ op: 'takeFromLooked', n: 1, filter: (m[1] || '').trim().toLowerCase() || 'any',
        to: 'battlefield', tapped: !!m[2], optional: true, rest: 'keep' }) },
    // Ghastly Remains, Zodiac Dragon: a card that goes back to its owner's hand by its own words
    { re: /^Return (?:it|this card) to your hand\.?$/i, make: () => ({ op: 'returnItToHand' }) },
    // Vein Drinker: "That creature deals damage equal to its power to this creature."
    { re: /^That creature deals damage equal to its power to (?:this creature|CARDNAME)\.?$/i,
      make: () => ({ op: 'damage', n: { ofTarget: 'power' }, fromTarget: true, toSelf2: true }) },
    { re: /^You may reveal an? ([-a-z ]*?)card from among them and put it into your hand\.?$/i,
      make: (m) => ({ op: 'takeFromLooked', n: 1, filter: (m[1] || '').trim().toLowerCase() || 'any',
        to: 'hand', optional: true }) },
    { re: /^You choose an? ([-a-z ]*?)card from it\.?$/i,
      make: (m) => ({ op: 'chooseFromHand', filter: (m[1] || 'nonland').trim().toLowerCase() }) },
    { re: /^That player discards that card\.?$/i, make: () => ({ op: 'discardChosen' }) },
    { re: /^Exile that card\.?$/i, make: () => ({ op: 'exileChosen' }) },
    { re: /^Attach it to target creature you control\.?$/i, make: () => ({ op: 'attachSelf' }) },
    /* "Whenever a creature you control enters, you may attach this
       Equipment to it." */
    { re: /^Attach (?:this Equipment|this Aura|CARDNAME) to (?:it|that creature)\.?$/i, make: () => ({ op: 'attachSelf', scope: 'triggerObject' }) },
    /* Inspiring Refrain: "Exile it with three time counters on it" — the
       spell suspended as it resolves */
    { re: /^Exile (?:CARDNAME|this spell|it) with (two|three|four|five|\d+) time counters on it\.?$/i,
      make: (m) => ({ op: 'suspendSelf', n: num(m[1]) }) },
    { re: /^Attach (?:CARDNAME|it) to (target creature you control|target creature)\.?$/i,
      make: () => ({ op: 'attachSelf' }) },
    { re: /^If that (?:creature|permanent)(?: or planeswalker)? would die this turn, exile it instead\.?$/i,
      make: () => ({ op: 'exileIfItDies' }) },
    // Yamabushi's Flame: "If a creature dealt damage this way would die this turn, exile it instead."
    { re: /^If a (?:creature|permanent)(?: or planeswalker)? dealt damage this way would die this turn, exile it instead\.?$/i,
      make: () => ({ op: 'exileIfItDies', dealtThisWay: true }) },
    { re: /^(?:You )?[Dd]raw a card at the beginning of the next turn'?s upkeep\.?$/,
      make: () => ({ op: 'delayed', event: 'eachUpkeep', nextTurn: true, name: 'Draw a card',
        effects: [{ op: 'draw', n: 1, who: 'you' }] }) },
    { re: /^Adapt (\d+)\.?$/i, make: (m) => ({ op: 'adapt', n: +m[1] }) },
    { re: /^Remove a (-1\/-1|\+1\/\+1|[a-z ]+?) counter from (?:CARDNAME|this creature)\.?$/i,
      make: (m) => ({ op: 'counters', kind: m[1].trim(), n: -1, scope: 'self' }) },
    { re: /^(?:CARDNAME|This permanent|This creature) can'?t be blocked by more than one creature\.?$/i,
      make: () => ({ op: 'continuous', layer: 6, scope: { self: true }, grant: ['Menace'] }) },
    { re: /^(?:CARDNAME|This land) enters(?: the battlefield)? tapped unless you control (two|three|one|\d+) or fewer other lands\.?$/i,
      make: (m) => ({ op: 'etbTappedUnlessLands', n: num(m[1]) }) },
    { re: /^(?:CARDNAME|This land) enters(?: the battlefield)? tapped unless you control an? ((?:basic )?[A-Za-z]+)(?: or an? ([A-Za-z]+))?\.?$/i,
      make: (m) => ({ op: 'etbTappedUnlessType', types: [m[1], m[2]].filter(Boolean).map(x => x.toLowerCase()) }) },
    /* Shifting Woodland: "This land becomes a copy of target permanent card
       in your graveyard until end of turn." */
    { re: /^(?:This land|CARDNAME|This permanent) becomes a copy of (target [a-z ]+? card in your graveyard) until end of turn\.?$/i,
      make: (m) => ({ op: 'becomeCopy', eot: true, targets: [Object.assign(targetSpec(m[1].replace(/ card in your graveyard$/, '')),
        { zone: 'graveyard', controller: 'you' })] }) },
    /* Clones: "You may have CARDNAME enter the battlefield as a copy of
       any creature on the battlefield." */
    { re: /^You may have (?:CARDNAME|this (?:creature|artifact|enchantment|land|Equipment|permanent)) enter(?: the battlefield)?( tapped)? as a copy of (?:any|a|an|another) ([a-z ]+?)( you control)?(?: on the battlefield)?(?:, except (.+?))?\.?$/i,
      make: (m0) => {
        /* Mockingbird: "…with mana value less than or equal to the amount
           of mana spent to cast this creature" */
        const spentRe = / with mana value less than or equal to the amount of mana spent to cast (?:this creature|CARDNAME)/i;
        const upToSpent = spentRe.test(m0[0]);
        const m = upToSpent ? m0[0].replace(spentRe, '').match(/^You may have (?:CARDNAME|this (?:creature|artifact|enchantment|land|Equipment|permanent)) enter(?: the battlefield)?( tapped)? as a copy of (?:any|a|an|another) ([a-z ]+?)( you control)?(?: on the battlefield)?(?:, except (.+?))?\.?$/i) : m0;
        if (!m) return null;
        const e = { op: 'etbAsCopy', what: m[2].trim().toLowerCase() };
        if (upToSpent) e.upToSpent = true;
        if (!/^(?:(?:nonland |nonlegendary )?(?:creature|artifact|enchantment|land|equipment|permanent|planeswalker)(?: or (?:creature|artifact|enchantment|planeswalker))?)$/.test(e.what)) return null;
        if (m[1]) e.tapped = true;
        if (m[3]) e.yours = true;
        /* the exceptions the table can honour; anything else ("it has
           haste", "it has 'when this becomes the target …'") is left for a
           person rather than quietly dropped */
        if (m[4]) {
          /* one or more clauses joined by "and": a type added, legendary
             taken away, or something it has ("it has flying", "it has
             '…'"), which the copy carries as words of its own */
          let ex = m[4].trim();
          while (ex) {
            let c;
            if ((c = ex.match(/^it'?s an? ([A-Z][a-z]+(?: [A-Z][a-z]+)*) in addition to its other types/))) e.addTypes = c[1].split(' ');
            else if ((c = ex.match(/^it isn'?t legendary/i))) e.nonLegendary = true;
            // Sakashima the Impostor, Chameleon: "its name is CARDNAME", "it's legendary in addition to its other types"
            else if ((c = ex.match(/^(?:its|his|her) name is CARDNAME/i))) e.keepName = true;
            else if ((c = ex.match(/^it'?s legendary in addition to its other types/i))) e.addLegendary = true;
            // Sakashima of a Thousand Faces: "it has CARDNAME's other abilities"
            else if ((c = ex.match(/^it has CARDNAME'?s other abilities/i))) e.keepOwn = true;
            else if ((c = ex.match(/^it has "([^"]+)"/))) (e.addText = e.addText || []).push(c[1].replace(/\bthis creature\b/g, 'CARDNAME'));
            else if ((c = ex.match(/^it has (flying|haste|hexproof|trample|vigilance|deathtouch|lifelink|first strike|menace|reach|indestructible)(?=,? and |$)/i)))
              (e.addText = e.addText || []).push(c[1][0].toUpperCase() + c[1].slice(1));
            else return null;
            ex = ex.slice(c[0].length).replace(/^,?\s*(?:and\s+)?/, '').trim();
          }
        }
        return e;
      } },
    { re: /^(?:CARDNAME|This creature|This permanent|This artifact) is indestructible\.?$/i,
      make: () => ({ op: 'continuous', layer: 6, scope: { self: true }, grant: ['Indestructible'] }) },
    { re: /^You have hexproof\.?$/i, make: () => ({ op: 'playerHexproof' }) },
    /* Dawn's Truce, Veil of Summer: the player as well as their things,
       for the rest of the turn. */
    { re: /^You gain hexproof until end of turn\.?$/i, make: () => ({ op: 'hexproofYou' }) },
    /* "Until end of turn, target creature gains 'When this creature dies,
       return it to the battlefield tapped under its owner's control.'" An
       ability handed over for the turn, run as the creature's own. */
    { re: /^(?:Until end of turn, )?(target [a-z ,]+?|CARDNAME|this creature|equipped creature|enchanted creature|creatures you control)(?: gets? ([+-]\d+)\/([+-]\d+) and)? gains? "([^"]+)"( until end of turn)?\.?$/i,
      make: (m) => {
        if (!/^Until end of turn/i.test(m[0]) && !m[5]) return null;
        if (!grantableText(m[4])) return null;
        const who = m[1];
        const g = { op: 'grantAbility', ability: m[4], duration: 'eot' };
        if (/^target /i.test(who)) { const t = tgt(who); if (!t) return null; g.targets = [t]; }
        else if (/^(?:CARDNAME|this creature)$/i.test(who)) g.scope = 'self';
        else if (/^(?:equipped|enchanted) creature$/i.test(who)) g.scope = 'attached';
        else g.scope = 'yourCreatures';
        if (!m[2]) return g;
        return { op: 'sequence', list: [g,
          { op: 'pump', p: +m[2], t: +m[3], duration: 'eot', scope: g.targets ? 'lastTarget' : g.scope }] };
      } },
    { re: /^You and (permanents you control|creatures you control|other permanents you control) gain ([a-z, ]+?) until end of turn\.?$/i,
      make: (m) => {
        const kws = keywordList(m[2]);
        const scope = scopeOf(m[1]);
        if (!scope || !kws.length || !kws.every(k => /^(?:hexproof|indestructible|shroud)$/i.test(k))) return null;
        return { op: 'sequence', list: [{ op: 'hexproofYou' },
          { op: 'grantKeyword', keywords: kws, duration: 'eot', scope }] };
      } },
    /* A rule about building the deck, not about playing the game — the
       deck builder reads it, the table has nothing to do. */
    { re: /^CARDNAME can be your commander\.?$/i, make: () => ({ op: 'noop' }) },
    { re: /^A deck can have any number of cards named CARDNAME\.?$/i, make: () => ({ op: 'noop' }) },
    /* The Leylines: free, if you drew one (CR 103.6). */
    { re: /^If (?:CARDNAME|this card) is in your opening hand, you may begin the game with it on the battlefield\.?$/i,
      make: () => ({ op: 'leyline' }) },
    { re: /^Play with the top card of your library revealed\.?$/i,
      make: () => ({ op: 'peekTop', revealed: true }) },
    { re: /^Players can'?t gain life\.?$/i,
      make: () => ({ op: 'noLifeGain', who: 'all' }) },
    { re: /^Your opponents can'?t gain life\.?$/i,
      make: () => ({ op: 'noLifeGain', who: 'opponents' }) },
    { re: /^You control enchanted creature\.?$/i,
      make: () => ({ op: 'continuous', layer: 2, scope: { attached: true }, control: 'you' }) },
    { re: /^([A-Za-z]+) spells you cast cost \{(\d+)\} less to cast\.?$/i,
      make: (m) => ({ op: 'taxSpells', amount: -(+m[2]), filter: m[1].toLowerCase(), who: 'you' }) },
    { re: /^(?:CARDNAME|This creature)'?s power is equal to the number of ([-a-z' ]+?) you control\.?$/i,
      make: (m) => ({ op: 'continuous', layer: 7, cda: true, scope: { self: true },
        setPt: { p: countSpec(m[1], 1), t: null, keepToughness: true } }) },
    { re: /^Any player may have (?:CARDNAME|this creature) deal (\d+) damage to them\.?$/i,
      make: () => ({ op: 'manual', text: 'Any player may take the damage.' }) },


    /* ===== the last of the frequent shapes ===== */
    { re: /^(?:Target (?:opponent|player)) reveals their hand\.?$/i, make: () => ({ op: 'revealHand' }) },
    // a generic question about players; "that player" afterwards is the one chosen
    { re: /^Choose an opponent\.?$/i, make: () => ({ op: 'chooseOpponent' }) },
    // "You and that player each draw three cards": you, and the opponent chosen
    { re: /^You and that player each draw (\w+) cards?\.?$/i,
      make: (m) => ({ op: 'sequence', list: [{ op: 'draw', n: num(m[1]), who: 'you' }, { op: 'draw', n: num(m[1]), who: 'triggerPlayer' }] }) },
    { re: /^Name a (?:nonland )?card\.?$/i, make: () => ({ op: 'noop' }) },
    /* "Choose a creature type." as an effect: the spell or ability remembers
       it, for "of the chosen type" after it */
    { re: /^Choose a creature type\.?$/i, make: () => ({ op: 'chooseTypeNow' }) },
    // Distant Melody: "Draw a card for each permanent you control of that type."
    { re: /^Draw a card for each (permanent|creature) you control of that type\.?$/i,
      make: (m) => ({ op: 'draw', who: 'you', n: { scope: { who: 'you', chosenType: true, what: m[1].toLowerCase() }, mult: 1 } }) },
    // Kindred Dominance, Raise the Palisade: "… all creatures that aren't of the chosen type"
    { re: /^(Destroy|Exile) all creatures that aren'?t of the chosen type\.?$/i,
      make: (m) => ({ op: m[1].toLowerCase() + 'All', what: 'creature', notChosenType: true }) },
    { re: /^Return all creatures that aren'?t of the chosen type to their owners'? hands\.?$/i,
      make: () => ({ op: 'bounceAll', what: 'creatures', notChosenType: true }) },
    { re: /^You may pay ((?:\{[^}]+\})+) rather than pay (?:CARDNAME|this spell)'?s mana cost\.?$/i,
      make: () => ({ op: 'noop' }) },
    { re: /^Destroy all ([A-Z][a-z]+s)\.?$/i,
      make: (m) => ({ op: 'destroyAll', what: m[1].toLowerCase() }) },
    { re: /^Counter (target (?:[a-z-]+, )*(?:or )?[a-z-]+(?: or [a-z-]+)? spell)\.?$/i,
      make: (m) => ({ op: 'counterSpell', targets: [Object.assign(targetSpec(m[1]), { type: 'spell', zone: 'stack' })] }) },
    { re: /^Prevent all combat damage that would be dealt by (target (?:[a-z ]+? )?creature) this turn\.?$/i,
      make: (m) => ({ op: 'restrict', flag: 'noDamage', targets: [targetSpec(m[1])] }) },
    { re: /^(?:CARDNAME|This creature) can'?t be blocked this turn\.?$/i,
      make: () => ({ op: 'grantKeyword', keywords: ['Unblockable'], duration: 'eot', scope: 'self' }) },
    { re: /^(?:CARDNAME|This creature) can block only creatures with flying\.?$/i,
      make: () => ({ op: 'continuous', layer: 6, scope: { self: true }, flag: 'blocksFliersOnly' }) },
    { re: /^This ability triggers only once each turn\.?$/i, make: () => ({ op: 'noop' }) },
    { re: /^(?:Then )?[Vv]enture into the dungeon\.?$/, make: () => ({ op: 'venture' }) },
    { re: /^(?:Then )?[Vv]enture into Undercity\.?$/, make: () => ({ op: 'venture', undercity: true }) },
    { re: /^Each player loses (\d+|X) life\.?$/i, make: (m) => ({ op: 'loseLife', n: num(m[1]), who: 'each' }) },
    /* Stifle, Disallow: abilities on the stack as targets */
    { re: /^Counter target (activated or triggered|activated|triggered) ability(?: you don'?t control)?\.?$/i,
      make: (m) => ({ op: 'counterSpell', targets: [Object.assign({ type: 'spell', zone: 'stack', filter: 'ability', abilities: true, noSpells: true },
        /^activated or/i.test(m[1]) ? {} : { abilityKind: m[1].toLowerCase() }, /don'?t control/i.test(m[0]) ? { controller: 'opponent' } : {})] }) },
    { re: /^Counter target spell, activated ability, or triggered ability\.?$/i,
      make: () => ({ op: 'counterSpell', targets: [{ type: 'spell', zone: 'stack', filter: 'spell', abilities: true }] }) },
    { re: /^Its controller (mills|draws) (a|one|two|three|four|five|\d+) cards?\.?$/i,
      make: (m) => ({ op: /mills/i.test(m[1]) ? 'mill' : 'draw', n: num(m[2]), who: 'targetController' }) },
    { re: /^(Each player|Shuffle your) (?:shuffles their )?hand and graveyard into (?:their|your) library, then (?:draws?) (seven|five|four|three|\d+) cards\.?$/i,
      make: (m) => ({ op: 'twister', who: /^each/i.test(m[1]) ? 'each' : 'you', n: num(m[2]) }) },
    { re: /^Discard all the cards in your hand, then draw that many cards\.?$/i, make: () => ({ op: 'wheel', who: 'you', n: 'sameDiscarded' }) },
    { re: /^Target creature can'?t be regenerated this turn\.?$/i, make: () => ({ op: 'noRegen', targets: [{ type: 'creature', filter: 'creature', zone: 'battlefield' }] }) },
    /* "Target creature becomes black until end of turn." */
    { re: /^(Target creature|Target permanent|This creature|CARDNAME) becomes (white|blue|black|red|green|colorless)( until end of turn)?\.?$/i,
      make: (m) => {
        const col = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G', colorless: null }[m[2].toLowerCase()];
        const tgt = /^target/i.test(m[1]);
        return { op: 'becomes', duration: m[3] ? 'eot' : 'permanent', eff: { setColors: col ? [col] : [] },
          targets: tgt ? [targetSpec(m[1])] : null, scope: tgt ? null : 'self' };
      } },
    { re: /^(?:You may )?[Rr]eturn another (creature|permanent|land|artifact|enchantment) you control to its owner'?s hand\.?$/,
      make: (m) => ({ op: 'returnOwn', filter: m[1].toLowerCase(), n: 1, other: true }) },
    { re: /^(?:This creature|CARDNAME) can attack this turn as though it didn'?t have defender\.?$/i,
      make: () => ({ op: 'restrict', flag: 'attackDespiteDefender', scope: 'self' }) },
    // the storage lands: "Add X mana in any combination of {G} and/or {W}" — X counters removed
    { re: /^Add X mana in any combination of \{([WUBRGC])\} and\/or \{([WUBRGC])\}\.?$/i,
      make: (m) => ({ op: 'addManaChoice', choices: [[m[1].toUpperCase()], [m[2].toUpperCase()]], n: 'X' }) },
    /* "Add three mana in any combination of {R} and/or {G}": three times one or the other */
    { re: /^Add (two|three|four|five) mana in any combination of \{([WUBRGC])\} and\/or \{([WUBRGC])\}\.?$/i,
      make: (m) => Array.from({ length: num(m[1]) }, () => ({ op: 'addManaChoice', choices: [[m[2].toUpperCase()], [m[3].toUpperCase()]] })) },
    /* "until your next turn": gone as the controller's next turn begins */
    { re: /^(Target creature|It|That creature) can'?t (attack|block|attack or block) until your next turn\.?$/i,
      make: (m) => ({ op: 'restrict', flag: m[2] === 'block' ? 'cantBlock' : m[2] === 'attack' ? 'cantAttack' : 'cantAttackOrBlock',
        duration: 'nextTurn', targets: /^target/i.test(m[1]) ? [{ type: 'creature' }] : null, scope: /^target/i.test(m[1]) ? null : 'lastTarget' }) },
    { re: /^(Target creature|It|That creature) gets ([+-]\d+)\/([+-]\d+) until your next turn\.?$/i,
      make: (m) => ({ op: 'pump', p: pmNum(m[2]), t: pmNum(m[3]), duration: 'nextTurn',
        targets: /^target/i.test(m[1]) ? [targetSpec(m[1])] : null, scope: /^target/i.test(m[1]) ? null : 'lastTarget' }) },

    /* ===== copies ===== */
    { re: /^Create a token that'?s a copy of (another target [a-z0-9 '-]+?|target [a-z0-9 '-]+?|CARDNAME|this creature)(?:, except it (?:has|gains) ([a-z, ']+))?\.?$/i,
      make: (m) => ({ op: 'copyPermanent', n: 1,
        targets: /^(?:another )?target/i.test(m[1]) ? [targetSpec(m[1].replace(/^another /i, ''))] : null,
        self: /CARDNAME|this creature/i.test(m[1]),
        grant: m[2] ? m[2].split(/,| and /).map(x => U.titleCase(x.trim())).filter(Boolean) : [] }) },
    { re: /^Create (two|three|\d+) tokens that are copies of (target [a-z0-9 '-]+?)(?:, except they (?:have|gain) ([a-z, ']+))?\.?$/i,
      make: (m) => ({ op: 'copyPermanent', n: num(m[1]), targets: [targetSpec(m[2])],
        grant: m[3] ? m[3].split(/,| and /).map(x => U.titleCase(x.trim())).filter(Boolean) : [] }) },

    /* ===== notes left for later (CR 603.7) ===== */
    { re: /^Sacrifice (it|that (?:creature|token|permanent)|this creature) at the beginning of the next end step\.?$/i,
      make: () => ({ op: 'delayed', event: 'eachEndStep', subject: 'lastTarget',
        name: 'Sacrifice it at end of turn', effects: [{ op: 'sacrificeThat' }] }) },
    { re: /^Exile (it|that (?:creature|token|permanent)) at the beginning of the next end step\.?$/i,
      make: () => ({ op: 'delayed', event: 'eachEndStep', subject: 'lastTarget',
        name: 'Exile it at end of turn', effects: [{ op: 'exile', scope: 'thatObject' }] }) },
    { re: /^Return (it|that (?:card|creature|permanent)) to the battlefield( tapped)? under (?:its owner'?s|your) control( with an? ([+\-0-9/a-z]+) counter on it)? at the beginning of the next end step\.?$/i,
      make: (m) => ({ op: 'delayed', event: 'eachEndStep', subject: 'lastTarget',
        name: 'Return it at end of turn', effects: [Object.assign({ op: 'returnThat' }, m[3] ? { counter: m[4].toLowerCase() } : {}, m[2] ? { tapped: true } : {})] }) },
    /* Luminous Broodmoth: "Whenever a creature … dies, return it to the
       battlefield under its owner's control with a flying counter on it" —
       the card the trigger is about, back from where it went */
    { re: /^Return (?:it|that card) to the battlefield( tapped)? under (its owner'?s|your) control( with an? ([+\-0-9/a-z]+) counter on it)?\.?$/i,
      make: (m) => Object.assign({ op: 'returnTriggerCard', yours: /your/i.test(m[2]) }, m[1] ? { tapped: true } : {}, m[3] ? { counter: m[4].toLowerCase() } : {}) },
    { re: /^(?:Put|Return) (?:that card|it) into your hand at the beginning of your next end step\.?$/i,
      make: () => ({ op: 'delayed', event: 'yourEndStep', forPlayer: 'you', nextTurn: true, subject: 'lastTarget',
        name: 'Put it into your hand', effects: [{ op: 'toHandThat' }] }) },
    { re: /^At the beginning of the next end step, sacrifice (it|that (?:creature|token|permanent))\.?$/i,
      make: () => ({ op: 'delayed', event: 'eachEndStep', subject: 'lastTarget',
        name: 'Sacrifice it at end of turn', effects: [{ op: 'sacrificeThat' }] }) },

    /* ===== small things with no moving parts ===== */
    { re: /^Skip your draw step\.?$/i, make: () => ({ op: 'skipDraw' }) },
    { re: /^(?:This land|This permanent|This artifact|CARDNAME) enters tapped\.?$/i, make: () => ({ op: 'etbTapped' }) },
    { re: /^Reveal the top (a|one|two|three|four|five|\d+) cards? of your library\.?$/i,
      make: (m) => ({ op: 'reveal', n: num(m[1]), from: 'library' }) },
    { re: /^You win the game\.?$/i, make: () => ({ op: 'winGame' }) },
    { re: /^You lose the game\.?$/i, make: () => ({ op: 'loseGame' }) },
    { re: /^Each opponent loses the game\.?$/i, make: () => ({ op: 'winGame' }) },

    /* ===== counts that depend on the board ("... for each creature you control") ===== */
    { re: /^You gain (one|two|three|four|five|six|seven|eight|nine|ten|\d+) life for each ([-a-z' ]+?) you control\.?$/i,
      make: (m) => ({ op: 'gainLife', who: 'you', n: countSpec(m[2], num(m[1])) }) },
    { re: /^Each opponent loses (one|two|three|four|five|six|seven|eight|nine|ten|\d+) life for each ([-a-z' ]+?) you control\.?$/i,
      make: (m) => ({ op: 'loseLife', who: 'opponents', n: countSpec(m[2], num(m[1])) }) },
    { re: /^Draw a card for each ([-a-z' ]+?) you control\.?$/i,
      make: (m) => ({ op: 'draw', who: 'you', n: countSpec(m[1], 1) }) },
    { re: /^Draw cards? equal to the number of ([-a-z' ]+?) you control\.?$/i,
      make: (m) => ({ op: 'draw', who: 'you', n: countSpec(m[1], 1) }) },
    { re: /^You gain life equal to the number of ([-a-z' ]+?) you control\.?$/i,
      make: (m) => ({ op: 'gainLife', who: 'you', n: countSpec(m[1], 1) }) },
    { re: /^(?:[A-Za-z][-A-Za-z0-9',’\. ]{0,44}?\s)?deals? damage equal to the number of ([-a-z' ]+?) you control to (any target|target creature|target player|target opponent|target planeswalker)\.?$/i,
      make: (m) => ({ op: 'damage', n: countSpec(m[1], 1), targets: [targetSpec(m[2])] }) },
    { re: /^(Target creature(?: you control)?|This creature|It) gets \+X\/\+X until end of turn, where X is the number of ([-a-z' ]+?) you control\.?$/i,
      make: (m) => ({ op: 'pump', p: countSpec(m[2], 1), t: countSpec(m[2], 1), duration: 'eot',
        targets: /^target/i.test(m[1]) ? [targetSpec(m[1])] : null,
        scope: /^(?:this|CARDNAME)/i.test(m[1]) ? 'self' : (/^it$/i.test(m[1]) ? 'lastTarget' : null) }) },

    /* ===== regeneration and damage prevention ===== */
    /* "Manifest dread, then put a +1/+1 counter on that creature": what
       follows is done to the creature just manifested */
    { re: /^Manifest dread, then (.+)$/i,
      make: (m) => {
        const rest = parseEffectSentence(m[1].charAt(0).toUpperCase() + m[1].slice(1));
        if (!rest || rest.op === 'manual' || hasManualStep(rest)) return null;
        const re = (x) => { if (x && /^(?:self|triggerObject|lastTarget)$/.test(x.scope) && !x.targets) x.scope = 'thatObject'; (x.list || []).forEach(re); };
        re(rest);
        return { op: 'sequence', list: [{ op: 'manifestDread' }, rest] };
      } },
    /* Bonfire of the Damned, the Chandras: "deals N damage to target player
       (or planeswalker) and each creature that player (or that planeswalker's
       controller) controls" */
    { re: /^(?:CARDNAME|It) deals (\d+|X) damage to (target player(?: or planeswalker)?) and each (creature(?: and planeswalker)?) (?:that player|they)(?: or that planeswalker'?s controller)? controls?\.?$/i,
      make: (m) => ({ op: 'damageAndTheirs', n: num(m[1]), andPlaneswalkers: /planeswalker/i.test(m[3]),
        targets: [/planeswalker/i.test(m[2]) ? targetSpec('target player or planeswalker') : { type: 'player' }] }) },
    // Tezzeret the Seeker, The Antiquities War: every artifact a 5/5 creature for the turn
    { re: /^Artifacts you control become artifact creatures with base power and toughness (\d+)\/(\d+) until end of turn\.?$/i,
      make: (m) => ({ op: 'animateAll', scope: { who: 'you', what: 'artifact' }, p: +m[1], t: +m[2], duration: 'eot' }) },
    // Capenna Express: "This Vehicle becomes an artifact creature until end of turn." — not crewed, just a creature
    { re: /^(?:This Vehicle|CARDNAME) becomes an artifact creature until end of turn\.?$/i,
      make: () => ({ op: 'addTypes', types: ['Creature'], subtypes: [], duration: 'eot', scope: 'self' }) },
    // Bridge from Below: "exile this card" — from the graveyard it works in
    { re: /^Exile (?:this card|CARDNAME)\.?$/i, make: () => ({ op: 'exileSelfAnywhere' }) },
    // Stuffy Doll: "it deals that much damage to the chosen player", "deals 1 damage to itself"
    { re: /^(?:CARDNAME|This creature|It) deals (that much|\d+) damage to the chosen player\.?$/i,
      make: (m) => ({ op: 'damage', n: /that much/i.test(m[1]) ? 'triggerAmount' : +m[1], toChosenPlayer: true }) },
    { re: /^(?:CARDNAME|This creature) deals (\d+) damage to itself\.?$/i, make: (m) => ({ op: 'damage', n: +m[1], toSelf2: true }) },
    // Abomination: "destroy that creature at end of combat"
    { re: /^Destroy that creature at end of combat\.?$/i, make: () => ({ op: 'destroyAtEndOfCombat', scope: 'triggerObject' }) },
    // Rabid Elephant: "it gets +2/+2 until end of turn for each creature blocking it"
    { re: /^(?:It|CARDNAME|This creature) gets \+(\d+)\/\+(\d+) until end of turn for each creature blocking it\.?$/i,
      make: (m) => ({ op: 'pumpPerBlocker', p: +m[1], t: +m[2] }) },
    // the Mana Batteries: "Add {U}, then add an additional {U} for each charge counter removed this way."
    { re: /^Add \{([WUBRGC])\}, then add an additional \{\1\} for each ([a-z]+) counter removed this way\.?$/i,
      make: (m) => ({ op: 'sequence', list: [{ op: 'addMana', symbols: [m[1].toUpperCase()] }, { op: 'addManaPer', symbol: m[1].toUpperCase(), per: { removedCounters: true, mult: 1 } }] }) },
    // Inferno Elemental: "this creature deals 3 damage to that creature"
    { re: /^(?:CARDNAME|This creature|It) deals (\d+) damage to that creature\.?$/i, make: (m) => ({ op: 'damage', n: +m[1], toTriggerObject: true }) },
    // Plaxmanta: "sacrifice it unless {G} was spent to cast it"
    { re: /^Sacrifice (?:it|CARDNAME|this creature) unless \{([WUBRG])\} was spent to cast (?:it|this creature|CARDNAME)\.?$/i,
      make: (m) => ({ op: 'ifCond', cond: { kind: 'not', cond: { kind: 'manaSpentAtLeast', n: 1, color: m[1].toUpperCase(), of: 'this' } }, then: [{ op: 'sacrificeSelf' }] }) },
    /* Dragon Fangs, Eagle's Rescue: "return this card from your graveyard to
       the battlefield attached to that creature / target creature …" */
    { re: /^(You may )?[Rr]eturn (?:this card|CARDNAME) from your graveyard to the battlefield attached to (that creature|it|target [a-z0-9 ]+)\.?$/,
      make: (m) => {
        const e = /^target/i.test(m[2]) ? { op: 'returnSelfAttached', targets: [targetSpec(m[2])] } : { op: 'returnSelfAttached', scope: 'triggerObject' };
        return m[1] ? { op: 'may', then: [e] } : e;
      } },
    // the Wards: "This effect doesn't remove this Aura." — protection that keeps it on
    { re: /^This effect doesn'?t remove (?:this Aura|CARDNAME)\.?$/i, make: () => ({ op: 'noop', keepAura: true }) },
    // Star Pupil: "put its counters on target creature you control"
    { re: /^Put its counters on (target [a-z ]+?)\.?$/i, make: (m) => ({ op: 'putItsCounters', targets: [targetSpec(m[1])] }) },
    /* Removed from combat (CR 506.4) */
    { re: /^Remove (target (?:attacking |blocking |attacking or blocking )?creature(?: you control| defending player controls)?|it|this creature|CARDNAME|enchanted creature) from combat\.?$/i,
      make: (m) => (/^target/i.test(m[1]) ? { op: 'removeFromCombat', targets: [targetSpec(m[1])] }
        : { op: 'removeFromCombat', scope: /^it$/i.test(m[1]) ? 'lastTarget' : /^enchanted/i.test(m[1]) ? 'attached' : 'self' }) },
    // Reconnaissance: "Remove target attacking creature you control from combat and untap it."
    { re: /^Remove (target (?:attacking |blocking |attacking or blocking )?creature(?: you control)?) from combat and untap it\.?$/i,
      make: (m) => ({ op: 'sequence', list: [{ op: 'removeFromCombat', targets: [targetSpec(m[1])] }, { op: 'untap', scope: 'lastTarget' }] }) },
    // Gustcloak, Stunning Strike: "untap it and remove it from combat"; "tap enchanted creature and remove it from combat"
    { re: /^(?:You may )?(untap|tap) (it|this creature|CARDNAME|enchanted creature|that creature) and remove it from combat\.?$/i,
      make: (m) => {
        const sc = /^enchanted/i.test(m[2]) ? 'attached' : /^that/i.test(m[2]) ? 'triggerObject' : 'self';
        const list = [{ op: m[1].toLowerCase(), scope: sc }, { op: 'removeFromCombat', scope: sc }];
        return /^You may/i.test(m[0]) ? { op: 'may', then: list } : { op: 'sequence', list };
      } },
    // Ezuri, Renegade Leader: "Regenerate another target Elf."
    { re: /^Regenerate another (target [A-Za-z0-9 ,'-]+?)\.?$/i,
      make: (m) => { const t = tgt(m[1]); return t ? { op: 'regenerate', targets: [Object.assign(t, { another: true })] } : null; } },
    { re: /^Regenerate (target [a-z0-9 ,'-]+?|this creature|it)\.?$/i,
      make: (m) => ({ op: 'regenerate',
        targets: /^target/i.test(m[1]) ? [targetSpec(m[1])] : null,
        scope: /^target/i.test(m[1]) ? null : (/^it$/i.test(m[1]) ? 'lastTarget' : 'self') }) },
    { re: /^Prevent all combat damage that would be dealt this turn\.?$/i,
      make: () => ({ op: 'preventDamage', combatOnly: true }) },
    { re: /^Prevent all damage that would be dealt this turn\.?$/i,
      make: () => ({ op: 'preventDamage' }) },
    { re: /^Prevent all (combat )?damage that would be dealt to you this turn\.?$/i,
      make: (m) => ({ op: 'preventDamage', combatOnly: !!m[1], to: 'you' }) },
    { re: /^Prevent the next (\d+) damage that would be dealt to (any target|target creature|target player|you|CARDNAME|this creature) this turn\.?$/i,
      make: (m) => ({ op: 'preventNext', n: +m[1],
        targets: /^target|^any/i.test(m[2]) ? [targetSpec(m[2])] : null, to: /^you$/i.test(m[2]) ? 'you' : null,
        self: /^(?:CARDNAME|this creature)$/i.test(m[2]) || undefined }) },
    /* "Target creature can't block this creature this turn." */
    { re: /^(Target creature|Up to one target creature) can'?t block (?:CARDNAME|this creature) this turn\.?$/i,
      make: (m) => ({ op: 'cantBlockThis', targets: [Object.assign(targetSpec('target creature'), /^up to/i.test(m[1]) ? { upTo: true } : {})] }) },

    /* ===== combat restrictions ===== */
    /* Sundering Eruption: "Creatures without flying can't block this turn"
       — a group, not a target */
    { re: /^((?:All |Each )?(?:other )?(?:[a-z]+ )*?creatures(?: [a-z0-9' ]+?)?) can'?t (block|attack|attack or block) this turn\.?$/i,
      make: (m) => {
        if (/^(?:target|it|that|those|they)\b/i.test(m[1])) return null;
        // Orim's Chant: plain "creatures can't attack this turn" has a rule of its own
        if (/^(?:all )?creatures$/i.test(m[1]) && m[2] === 'attack') return null;
        const scope = scopeOf(m[1]);
        if (!scope || scope.self || scope.attached) return null;
        return { op: 'restrict', flag: m[2] === 'block' ? 'cantBlock' : m[2] === 'attack' ? 'cantAttack' : 'cantAttackOrBlock', scope };
      } },
    // Keeper of Keys: "Creatures you control can't be blocked this turn."
    { re: /^((?:All |Each )?(?:other )?(?:[a-z]+ )*?creatures(?: [a-z' ]+?)?) can'?t be blocked this turn\.?$/i,
      make: (m) => {
        if (/^(?:target|it|that|those|they)\b/i.test(m[1])) return null;
        const scope = scopeOf(m[1]);
        return scope && !scope.self && !scope.attached ? { op: 'restrict', flag: 'unblockable', scope } : null;
      } },
    { re: /^(Target creature|It|That creature) can'?t block this turn\.?$/i,
      make: (m) => ({ op: 'restrict', flag: 'cantBlock', targets: /^target/i.test(m[1]) ? [{ type: 'creature' }] : null, scope: /^target/i.test(m[1]) ? null : 'lastTarget' }) },
    { re: /^(Target creature|It|That creature) can'?t attack or block this turn\.?$/i,
      make: (m) => ({ op: 'restrict', flag: 'cantAttackOrBlock', targets: /^target/i.test(m[1]) ? [{ type: 'creature' }] : null, scope: /^target/i.test(m[1]) ? null : 'lastTarget' }) },
    { re: /^(Target creature|It|That creature) can'?t attack this turn\.?$/i,
      make: (m) => ({ op: 'restrict', flag: 'cantAttack', targets: /^target/i.test(m[1]) ? [{ type: 'creature' }] : null, scope: /^target/i.test(m[1]) ? null : 'lastTarget' }) },
    { re: /^(Target creature|It|That creature) blocks this turn if able\.?$/i,
      make: (m) => ({ op: 'restrict', flag: 'mustBlock', targets: /^target/i.test(m[1]) ? [{ type: 'creature' }] : null, scope: /^target/i.test(m[1]) ? null : 'lastTarget' }) },
    { re: /^(Target creature|It|That creature) attacks this turn if able\.?$/i,
      make: (m) => ({ op: 'restrict', flag: 'mustAttackEot', targets: /^target/i.test(m[1]) ? [{ type: 'creature' }] : null, scope: /^target/i.test(m[1]) ? null : 'lastTarget' }) },
    { re: /^Goad (target creature(?: an opponent controls)?)\.?$/i,
      make: (m) => ({ op: 'goad', targets: [targetSpec(m[1])] }) },
    { re: /^Goad (?:each creature|all creatures) (?:your opponents control|target opponent controls)\.?$/i,
      make: () => ({ op: 'goad', scope: 'opponentCreatures' }) },
    { re: /^(Target creature|Target permanent|Target land|Target artifact|It|That creature|This creature) doesn'?t untap during (?:its controller'?s|your) next untap step\.?$/i,
      make: (m) => (/^target/i.test(m[1]) ? { op: 'noUntap', targets: [targetSpec(m[1])] }
        : { op: 'noUntap', scope: /^(?:this|CARDNAME)/i.test(m[1]) ? 'self' : 'lastTarget' }) },
    /* "Target creature phases out." */
    { re: /^(Target (?:creature|permanent|nonland permanent|artifact|creature you control|permanent you control)|This creature|CARDNAME) phases out\.?$/i,
      make: (m) => (/^target/i.test(m[1]) ? { op: 'phaseOut', targets: [targetSpec(m[1])] }
        : { op: 'phaseOut', scope: { self: true } }) },
    { re: /^Discard your hand\.?$/i, make: () => ({ op: 'discardHand' }) },
    // "Put a +1/+1 counter on target creature. It phases out." — the spell's own target
    { re: /^It phases out\.?$/i, make: () => ({ op: 'phaseOut' }) },
    // Rosie Cotton: "put a +1/+1 counter on target creature you control other than CARDNAME"
    { re: /^Put an? ([+\-0-9/]+) counter on target creature you control other than (?:CARDNAME|[A-Z][\w ,'-]+)\.?$/,
      make: (m) => ({ op: 'counters', kind: m[1], n: 1, targets: [Object.assign(targetSpec('target creature you control'), { another: true })] }) },
    // Stomp, Skullcrack: "Damage can't be prevented this turn."
    { re: /^Damage can'?t be prevented this turn\.?$/i, make: () => ({ op: 'noPreventionTurn' }) },
    // Skullcrack: "Players can't gain life this turn."
    { re: /^(Players|Your opponents|Each opponent) can'?t gain life this turn\.?$/i,
      make: (m) => ({ op: 'noLifeGainTurn', who: /^players/i.test(m[1]) ? 'all' : 'opponents' }) },
    // Starfall Invocation: "return a creature card put into your graveyard this way to the battlefield under your control"
    { re: /^[Rr]eturn an? ([a-z]+) card put into your graveyard this way to the battlefield under your control\.?$/,
      make: (m) => ({ op: 'returnSwept', filter: m[1].toLowerCase() }) },
    /* Drakuseth: "CARDNAME deals 4 damage to any target and 3 damage to each
       of up to two other targets." — one amount for each target, in order */
    { re: /^(?:CARDNAME|This creature|It) deals (\d+) damage to any target and (\d+) damage to each of up to (two|three) other targets\.?$/i,
      make: (m) => ({ op: 'damageSplit', amounts: [+m[1]].concat(Array.from({ length: num(m[3]) }, () => +m[2])),
        targets: [{ type: 'any', filter: 'any target', zone: 'battlefield' }].concat(Array.from({ length: num(m[3]) }, () => ({ type: 'any', filter: 'any target', zone: 'battlefield', upTo: true }))) }) },
    // Earthquake's kin: "2 damage to each creature without flying and each player"; Delete, Magmaquake
    { re: /^(?:CARDNAME|This creature|It) deals (\d+|X) damage to (each (?:creature (?:with|without) [a-z ]+?|[a-z]+ creature)) and each (player|opponent|planeswalker)\.?$/i,
      make: (m) => {
        const sc = massScopeOf(m[2]);
        if (!sc) return null;
        const second = /planeswalker/i.test(m[3]) ? { op: 'damage', n: num(m[1]), scope: { who: 'all', what: 'planeswalker' } } : { op: 'damage', n: num(m[1]), each: m[3].toLowerCase() };
        return [{ op: 'damage', n: num(m[1]), scope: sc }, second];
      } },
    // Prismari Charm: "1 damage to each of one or two targets"
    { re: /^(?:CARDNAME|This creature|It) deals (\d+) damage to each of one or two targets\.?$/i,
      make: (m) => ({ op: 'damage', n: +m[1], targets: [{ type: 'any', filter: 'any target', zone: 'battlefield' }, { type: 'any', filter: 'any target', zone: 'battlefield', upTo: true, distinct: true }] }) },
    // Terminus: "Put all creatures on the bottom of their owners' libraries."
    { re: /^Put all creatures on the bottom of their owners'? libraries\.?$/i, make: () => ({ op: 'bottomAll', scope: { who: 'all', what: 'creature' } }) },
    // Praetor's Counsel: "Return all cards from your graveyard to your hand."
    { re: /^Return all cards from your graveyard to your hand\.?$/i, make: () => ({ op: 'regrowthAll', filter: 'card' }) },
    // Runeflare Trap: "damage to target player equal to the number of cards in that player's hand"
    { re: /^(?:CARDNAME|This creature|It) deals damage to (target (?:player|opponent)) equal to the number of cards in (?:that player'?s|their) hand\.?$/i,
      make: (m) => ({ op: 'damage', n: { cardsInHand: 'target', mult: 1 }, targets: [{ type: 'player', opponent: /opponent/i.test(m[1]) }] }) },
    // "{1}{U}: This creature gets +1/+0 until end of turn and can't be blocked this turn."
    { re: /^(?:CARDNAME|This creature) gets ([+-]\d+)\/([+-]\d+) until end of turn and can'?t be blocked this turn\.?$/i,
      make: (m) => ({ op: 'sequence', list: [{ op: 'pump', p: pmNum(m[1]), t: pmNum(m[2]), duration: 'eot', scope: 'self' },
        { op: 'restrict', flag: 'unblockable', scope: 'self' }] }) },
    // Jaya's Immolating Inferno: "X damage to each of up to three targets"
    { re: /^(?:CARDNAME|This creature|It) deals (\d+|X) damage to each of up to (two|three|four) targets\.?$/i,
      make: (m) => ({ op: 'damage', n: num(m[1]), targets: Array.from({ length: num(m[2]) }, () => ({ type: 'any', filter: 'any target', zone: 'battlefield', upTo: true, distinct: true })) }) },
    // Vraska's Fall: "…sacrifices a creature or planeswalker of their choice and gets a poison counter."
    { re: /^Each opponent sacrifices an? ([a-z ]+?) of their choice and gets (a|one|two|\d+) poison counters?\.?$/i,
      make: (m) => { const sac = parseEffectSentence('Each opponent sacrifices a ' + m[1] + '.', 1);
        return sac && sac.op !== 'manual' ? [sac, { op: 'poison', n: num(m[2]), who: 'opponents' }] : null; } },
    // Hydra's Growth: "double the number of +1/+1 counters on enchanted creature"
    { re: /^Double the number of ([+\-0-9/a-z]+) counters on enchanted creature\.?$/i,
      make: (m) => ({ op: 'doubleCounters', kind: m[1].toLowerCase(), scope: 'attached' }) },
    // Arc Trail: "2 damage to any target and 1 damage to any other target" — two different targets
    { re: /^(?:CARDNAME|This creature|It) deals (\d+) damage to any target and (\d+) damage to any other target\.?$/i,
      make: (m) => ({ op: 'damageSplit', amounts: [+m[1], +m[2]],
        targets: [{ type: 'any', filter: 'any target', zone: 'battlefield' }, { type: 'any', filter: 'any target', zone: 'battlefield', distinct: true }] }) },
    // Lunge: "2 damage to target creature and 2 damage to target player or planeswalker"
    { re: /^(?:CARDNAME|This creature|It) deals (\d+) damage to (target [a-z ]+?) and (\d+) damage to (target [a-z ]+?)\.?$/i,
      make: (m) => { const a = tgt(m[2]), b = tgt(m[4]); return a && b ? { op: 'damageSplit', amounts: [+m[1], +m[3]], targets: [a, b] } : null; } },
    // Chandra's Outrage: "…to target creature and 2 damage to that creature's controller"
    { re: /^(?:CARDNAME|This creature|It) deals (\d+) damage to (target [a-z ]+?) and (\d+) damage to (?:that (?:creature|permanent|planeswalker|artifact)'s|its) controller\.?$/i,
      make: (m) => { const a = tgt(m[2]); return a ? [{ op: 'damage', n: +m[1], targets: [a] }, { op: 'damage', n: +m[3], toAffectedController: true }] : null; } },
    /* Blight N: N -1/-1 counters on a creature that player controls, of
       their choice ("Whenever this creature attacks, blight 1") */
    { re: /^(?:You )?blight (\d+)\.?$/i, make: (m) => ({ op: 'blight', n: +m[1], who: 'you' }) },
    { re: /^(Target opponent|Target player|Each opponent|Each player) blights? (\d+)\.?$/i,
      make: (m) => (/^target/i.test(m[1]) ? { op: 'blight', n: +m[2], who: 'target', targets: [{ type: 'player', opponent: /opponent/i.test(m[1]) }] }
        : { op: 'blight', n: +m[2], who: /opponent/i.test(m[1]) ? 'opponents' : 'each' }) },
    // Chronosavant, Unstable Hulk: "You skip your next turn."
    { re: /^(You|Target player|Target opponent) skips? (?:your|their) next turn\.?$/i,
      make: (m) => (/^you$/i.test(m[1]) ? { op: 'skipTurn', who: 'you' } : { op: 'skipTurn', who: 'target', targets: [{ type: 'player', opponent: /opponent/i.test(m[1]) }] }) },
    // Chronostutter: "Put target creature into its owner's library second from the top."
    { re: /^Put (target [a-z ]+?) into its owner'?s library second from the top\.?$/i,
      make: (m) => { const a = tgt(m[1]); return a && !/spell/i.test(m[1]) ? { op: 'toLibrary', where: 'second', targets: [a] } : null; } },
    // Assassin's Strike: "Destroy target creature. Its controller discards a card."
    { re: /^Its controller discards (a|one|two|three|\d+) cards?\.?$/i,
      make: (m) => ({ op: 'discard', n: num(m[1]), who: 'targetController' }) },
    // Flint Golem: "defending player mills three cards"
    { re: /^Defending player mills (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?\.?$/i,
      make: (m) => ({ op: 'mill', n: num(m[1]), who: 'defending' }) },
    // Terisian Mindbreaker: "defending player mills half their library, rounded up"
    { re: /^Defending player mills half their library, rounded (up|down)\.?$/i,
      make: (m) => ({ op: 'mill', who: 'defending', n: { halfLibrary: 'defending', up: /up/i.test(m[1]) } }) },
    // Hammer of Nazahn: "attach that Equipment to target creature you control"
    { re: /^Attach that Equipment to (target creature(?: you control)?)\.?$/i,
      make: (m) => ({ op: 'attachThat', targets: [targetSpec(m[1])] }) },
    /* The Gitrog Monster, Karoo, Quickling, Solitary Confinement: "sacrifice
       it unless you sacrifice a land / return an untapped Plains you control
       to its owner's hand / discard a card" */
    { re: /^Sacrifice (?:it|CARDNAME|this (?:creature|enchantment|land|artifact|permanent)) unless you (sacrifice|discard|return) (an?|another) (untapped )?([A-Za-z -]+?)( card)?( you control)?( to its owner'?s hand)?\.?$/i,
      make: (m) => {
        const how = m[1].toLowerCase();
        if ((how === 'return') !== !!m[7]) return null;
        if (how === 'discard' ? !!m[6] : !!m[5]) return null;
        let filter = m[4].trim().toLowerCase();
        if (how === 'discard' && filter === 'card') filter = 'card';
        if (!/^(?:card|land|creature|artifact|enchantment|permanent|non-lair land|basic land|plains|island|swamp|mountain|forest|[a-z]+ creature|[a-z]+ card)$/.test(filter)) return null;
        return { op: 'sacSelfUnless', how, filter, untapped: !!m[3], another: /another/i.test(m[2]) };
      } },
    /* Field of Ruin: "Each player searches their library for a basic land
       card, puts it onto the battlefield, then shuffles." The same search,
       once for each player, from their own library. */
    { re: /^Each player (may )?searches their library for (.+?), puts? (it|them) onto the battlefield( tapped)?, then shuffles\.?$/i,
      make: (m) => {
        const one = parseSearch('Search your library for ' + m[2] + ', put ' + m[3] + ' onto the battlefield' + (m[4] || '') + ', then shuffle.');
        if (!one || one.op !== 'tutor') return null;
        if (m[1]) one.optional = true;
        return { op: 'eachPlayerTutor', tutor: one };
      } },
    /* Consuming Aberration, Balustrade Spy: "each opponent reveals cards
       from the top of their library until they reveal a land card, then
       puts those cards into their graveyard" */
    { re: /^(?:Each opponent|Target player|Target opponent|That player|Defending player) reveals cards from the top of their library until they reveal .+$/i,
      make: (m) => revealUntilOf(m[0]) },
    // Mirror Entity: "Until end of turn, creatures you control have base power and toughness X/X and gain all creature types."
    { re: /^Until end of turn, creatures you control have base power and toughness (X|\d+)\/(X|\d+)( and gain all creature types)?\.?$/i,
      make: (m) => ({ op: 'setBaseAll', p: m[1] === 'X' ? 'X' : +m[1], t: m[2] === 'X' ? 'X' : +m[2], allTypes: !!m[3] }) },
    // All Is Dust: "Each player sacrifices all permanents they control that are one or more colors."
    { re: /^Each player sacrifices all permanents they control that are one or more colou?rs\.?$/i, make: () => ({ op: 'sacrificeColored' }) },
    // Fell the Mighty: "Destroy all creatures with power greater than target creature's power."
    { re: /^Destroy all creatures with power greater than target creature'?s power\.?$/i,
      make: () => ({ op: 'destroyAll', what: 'creature', aboveTargetPower: true, targets: [{ type: 'creature' }] }) },
    // Insurrection: "Untap all creatures and gain control of them until end of turn."
    { re: /^Untap all creatures and gain control of them until end of turn\.?$/i, make: () => ({ op: 'threatenAll' }) },
    // Temur Battle Rage: "That creature also gains trample until end of turn if you control a creature with power 4 or greater."
    { re: /^That creature also gains ([a-z ]+?) until end of turn if (.+?)\.?$/i,
      make: (m) => {
        const cond = condOf(m[2]);
        const kws = keywordList(m[1]);
        if (!cond || !kws.length || !kws.every(kwKnown)) return null;
        return { op: 'ifCond', cond, then: [{ op: 'grantKeyword', keywords: kws, duration: 'eot', scope: 'lastTarget' }] };
      } },
    // The Locust God: "When this dies, return it to its owner's hand at the beginning of the next end step."
    { re: /^Return (?:CARDNAME|it) to (its owner'?s hand|the battlefield under (?:its owner'?s|your) control) at the beginning of the next end step\.?$/i,
      make: (m) => ({ op: 'delayed', event: 'eachEndStep', subject: 'self', name: /hand/i.test(m[1]) ? 'Return it to hand' : 'Return it to the battlefield',
        effects: [{ op: 'selfFromGraveyard', to: /hand/i.test(m[1]) ? 'hand' : 'battlefield' }] }) },
    // Humble Defector: "Target opponent gains control of this creature."
    { re: /^Target (opponent|player) gains control of (?:this creature|CARDNAME|this artifact|this permanent)\.?$/i,
      make: (m) => ({ op: 'giveSelf', targets: [{ type: 'player', opponent: /opponent/i.test(m[1]) }] }) },
    // Suture Priest: "you may have that player lose 1 life" — the controller of the creature that entered
    { re: /^Have (?:that player|its controller) lose (one|two|three|\d+) life\.?$/i,
      make: (m) => ({ op: 'loseLife', who: 'triggerObjController', n: num(m[1]) }) },
    /* "Counter that spell": the spell already targeted (Stubborn Denial's
       "instead"), or the one a cast trigger is about (Boromir) */
    { re: /^Counter that spell\.?$/i, make: () => ({ op: 'counterSpell', thatSpell: true }) },
    /* Tribute to the World Tree: "…if its power is 3 or greater. Otherwise,
       put two +1/+1 counters on it." — the other branch of the sentence before */
    { re: /^Otherwise, (.+)$/i,
      make: (m) => {
        const inner = parseSentenceList(splitSentences(m[1].charAt(0).toUpperCase() + m[1].slice(1)));
        return inner.auto && inner.effects.length ? { op: 'noop', otherwiseOf: inner.effects } : null;
      } },
    // Uro, Kroxa: "When this enters, sacrifice it unless it escaped."
    { re: /^Sacrifice (?:it|CARDNAME|this creature) unless it escaped\.?$/i, make: () => ({ op: 'sacUnlessEscaped' }) },
    /* Xenagos, God of Revels: "Another target creature you control gains
       haste and gets +X/+X until end of turn, where X is that creature's power." */
    { re: /^((?:Another )?target creature(?: you control)?)(?: gains ([a-z ]+?) and)? gets \+X\/\+X until end of turn, where X is (?:its|that creature'?s) power\.?$/i,
      make: (m) => {
        const kws = m[2] ? keywordList(m[2]) : [];
        if (m[2] && (!kws.length || !kws.every(kwKnown))) return null;
        const pump = { op: 'pump', p: { ofTarget: 'power' }, t: { ofTarget: 'power' }, duration: 'eot', targets: [targetSpec(m[1])] };
        return kws.length ? { op: 'sequence', list: [pump, { op: 'grantKeyword', keywords: kws, duration: 'eot', scope: 'lastTarget' }] } : pump;
      } },
    // Legion Warboss: "That token gains haste until end of turn and attacks this combat if able."
    { re: /^That (?:token|creature) gains haste until end of turn and attacks this combat if able\.?$/i,
      make: () => ({ op: 'sequence', list: [{ op: 'grantKeyword', keywords: ['Haste'], scope: 'thatToken', duration: 'eot' },
        { op: 'restrict', flag: 'mustAttackEot', scope: 'thatToken' }] }) },
    // Obscuring Haze: "Prevent all damage that would be dealt this turn by creatures your opponents control."
    { re: /^Prevent all damage that would be dealt this turn by creatures your opponents control\.?$/i,
      make: () => ({ op: 'preventDamage', fromOpponentCreatures: true }) },
    // Gingerbrute: "This creature can't be blocked this turn except by creatures with haste."
    { re: /^(CARDNAME|This creature|Target creature(?: you control)?) can'?t be blocked this turn except by creatures with (haste|flying)\.?$/i,
      make: (m) => Object.assign({ op: 'restrict', flag: /haste/i.test(m[2]) ? 'exceptByHaste' : 'exceptByFlying' },
        /^target/i.test(m[1]) ? { targets: [targetSpec(m[1])] } : { scope: 'self' }) },
    // Wan Shi Tong: "Then draw half X cards, rounded down."
    { re: /^(?:Then )?[Dd]raw half X cards, rounded (down|up)\.?$/i,
      make: (m) => ({ op: 'draw', n: { half: 'X', up: /up/i.test(m[1]) } }) },
    // Unstoppable Slasher: "they lose half their life, rounded up"
    { re: /^(They|That player|Each opponent|Target player|Target opponent) loses? half (?:their|his or her) life, rounded (up|down)\.?$/i,
      make: (m) => {
        const who = /^each/i.test(m[1]) ? 'opponents' : /^target/i.test(m[1]) ? 'target' : 'triggerPlayer';
        return Object.assign({ op: 'loseLife', who, n: { halfLife: who, up: /up/i.test(m[2]) } },
          who === 'target' ? { targets: [{ type: 'player', opponent: /opponent/i.test(m[1]) }] } : {});
      } },
    // one sentence of a longer text: "Whenever a creature dies this turn, …"
    { re: /^(?:Until end of turn|This turn), whenever .+$|^(?:Whenever|At the beginning of) [^,"]+? this turn, .+$/i, make: (m) => turnTrigger(m[0]) },
    // Charming Prince: "Exile another target creature you own."
    { re: /^Exile (another )?target (creature|permanent|nonland permanent) you own\.?$/i,
      make: (m) => ({ op: 'exile', targets: [Object.assign(targetSpec((m[1] ? 'another ' : '') + 'target ' + m[2].toLowerCase()), { owner: 'you' })] }) },
    /* Grab the Prize: "If the discarded card wasn't a land card, …" — the
       card discarded to cast it */
    { re: /^If the discarded card (was|wasn'?t) an? ([a-z]+) card, (.+)$/i,
      make: (m) => {
        const inner = parseEffects(m[3].replace(/^(\w)/, (c) => c.toUpperCase()));
        return inner.auto ? { op: 'ifDiscarded', type: m[2].toLowerCase(), not: /n'?t/i.test(m[1]), then: inner.effects } : null;
      } },
    /* Thirst for Knowledge: "Then discard two cards unless you discard an artifact card." */
    { re: /^(?:Then )?[Dd]iscard (two|three) cards unless you discard an? ([a-z]+) card\.?$/,
      make: (m) => ({ op: 'discardUnlessType', n: num(m[1]), type: m[2].toLowerCase() }) },
    // Murderous Rider: "When this creature dies, put it on the bottom of its owner's library."
    { re: /^Put (?:it|CARDNAME|this card) on the bottom of its owner'?s library\.?$/i, make: () => ({ op: 'selfToLibrary', bottom: true }) },
    // Intruder Alarm
    { re: /^Untap all creatures\.?$/i, make: () => ({ op: 'untapAll', scope: { who: 'all', what: 'creature' } }) },
    // Port Razer: "untap each creature you control"
    { re: /^Untap each ([a-z ]+?)\.?$/i, make: (m) => { const sc = massScopeOf('each ' + m[1]); return sc && !sc.self ? { op: 'untapAll', scope: sc } : null; } },
    // Varragoth, Bloodsky Sire: a tutor for somebody else, onto the top
    { re: /^Target player searches their library for a card, then shuffles and puts that card on top\.?$/i,
      make: () => ({ op: 'tutor', who: 'target', n: 1, filter: 'any', to: 'top', targets: [{ type: 'player' }] }) },
    // Combat Celebrant: "Untap all other creatures you control"
    { re: /^Untap all (other [a-z ]+?)\.?$/i, make: (m) => { const sc = scopeOf(m[1]); return sc && !sc.self ? { op: 'untapAll', scope: sc } : null; } },
    /* Kardur, Doomscourge: attacking each combat, and a player other than
       you, until your next turn, is what goading is (CR 701.15) */
    { re: /^Until your next turn, creatures your opponents control attack each combat if able and attack a player other than you if able\.?$/i,
      make: () => ({ op: 'goad', scope: 'opponentCreatures' }) },
    // Quantum Misalignment: "...except it isn't legendary"
    { re: /^Create a token that'?s a copy of (target creature(?: you control)?), except (?:it|the token) isn'?t legendary\.?$/i,
      make: (m) => ({ op: 'copyPermanent', n: 1, targets: [targetSpec(m[1])], grant: [], nonLegendary: true }) },
    /* Relic of Sauron: "Add two mana in any combination of {U}, {B}, and/or {R}." */
    { re: /^Add (two|three|four) mana in any combination of \{([WUBRGC])\}, \{([WUBRGC])\},? and\/or \{([WUBRGC])\}\.?$/i,
      make: (m) => Array.from({ length: num(m[1]) }, () => ({ op: 'addManaChoice', choices: [[m[2].toUpperCase()], [m[3].toUpperCase()], [m[4].toUpperCase()]] })) },
    // Staff of Compleation: "Destroy target permanent you own."
    { re: /^Destroy target (permanent|creature|artifact|land) you own\.?$/i,
      make: (m) => ({ op: 'destroy', targets: [Object.assign(targetSpec('target ' + m[1].toLowerCase()), { owner: 'you' })] }) },
    // Dark Deal: "…then draws that many cards minus one"
    { re: /^Each player discards all the cards in their hand, then draws that many cards minus one\.?$/i,
      make: () => ({ op: 'wheel', n: 'sameMinusOne' }) },
    /* Waterlogged Teachings: "an instant card or a card with flash" */
    { re: /^Search your library for an instant card or a card with flash, reveal it, put it into your hand, then shuffle\.?$/i,
      make: () => ({ op: 'tutor', n: 1, filter: 'any', instantOrFlash: true, to: 'hand' }) },
    // Rebuff the Wicked: "Counter target spell that targets a permanent you control."
    { re: /^Counter target spell that targets an? (permanent|creature) you control\.?$/i,
      make: (m) => ({ op: 'counterSpell', targets: [{ type: 'spell', zone: 'stack', filter: 'spell', targetsYour: m[1].toLowerCase() }] }) },
    // Dawn Charm: "Counter target spell that targets you."
    { re: /^Counter target spell that targets you\.?$/i,
      make: () => ({ op: 'counterSpell', targets: [{ type: 'spell', zone: 'stack', filter: 'spell', targetsYour: 'you', orYou: true }] }) },
    // Hindering Light: "Counter target spell that targets you or a permanent you control."
    { re: /^Counter target spell that targets you or an? (permanent|creature) you control\.?$/i,
      make: (m) => ({ op: 'counterSpell', targets: [{ type: 'spell', zone: 'stack', filter: 'spell', targetsYour: m[1].toLowerCase(), orYou: true }] }) },
    // Siren Stormtamer: "Counter target spell or ability that targets you or a creature you control."
    { re: /^Counter target spell or ability that targets (you or )?an? (permanent|creature) you control\.?$/i,
      make: (m) => ({ op: 'counterSpell', targets: [{ type: 'spell', zone: 'stack', filter: 'spell', abilities: true,
        targetsYour: m[2].toLowerCase(), orYou: !!m[1] }] }) },
    /* Bloodforged Battle-Axe: "create a token that's a copy of this Equipment" */
    { re: /^Create a token that'?s a copy of (?:this (?:Equipment|artifact|creature|enchantment|permanent)|CARDNAME)\.?$/i,
      make: () => ({ op: 'copyPermanent', n: 1, self: true, grant: [] }) },
    // Miirym: "create a token that's a copy of it, except the token isn't legendary"
    { re: /^Create a token that'?s a copy of (?:it|that creature), except (?:the token|it) isn'?t legendary\.?$/i,
      make: () => ({ op: 'copyPermanent', n: 1, scope: 'lastTarget', grant: [], nonLegendary: true }) },
    /* Electroduplicate: "...except it has haste and 'At the beginning of the
       end step, sacrifice this token.'" (it goes at the first end step) */
    { re: /^Create a token that'?s a copy of (target creature(?: you control)?), except it has haste and "At the beginning of the end step, sacrifice this (?:token|creature)\."\.?$/i,
      make: (m) => [{ op: 'copyPermanent', n: 1, targets: [targetSpec(m[1])], grant: ['Haste'] },
        { op: 'delayed', event: 'eachEndStep', subject: 'lastTarget', name: 'Sacrifice it at end of turn', effects: [{ op: 'sacrificeThat' }] }] },
    /* Molten Duplication, Vaultborn Tyrant: "...except it's an artifact in addition to its other types" */
    { re: /^Create a token that'?s a copy of (target (?:artifact or creature|creature|artifact)(?: you control)?|it), except it'?s an? (artifact|enchantment) in addition to its other types\.?$/i,
      make: (m) => Object.assign({ op: 'copyPermanent', n: 1, grant: [], addTypes: [U.titleCase(m[2])] },
        /^it$/i.test(m[1]) ? { self: true } : { targets: [targetSpec(m[1])] }) },
    // a spell-cast trigger's "copy it": the spell that was cast
    { re: /^Copy it\.?$/i, make: () => ({ op: 'copyThatSpell' }) },
    // Thousand-Year Storm: "copy it for each other instant and sorcery spell you've cast before it this turn"
    { re: /^Copy (?:it|that spell) for each other (instant and sorcery|instant or sorcery|noncreature)? ?spell you'?ve cast before it this turn\.?$/i,
      make: (m) => ({ op: 'copyThatSpell', n: { castBefore: (m[1] || 'spell').replace(' and ', ' or ') } }) },
    /* Tyrite Sanctum: "Target legendary creature becomes a God in addition to its other types." */
    { re: /^(Target (?:legendary )?creature(?: you control)?) becomes an? ([A-Z][a-z]+) in addition to its other types\.?$/,
      make: (m) => ({ op: 'becomes', duration: 'permanent', eff: { addSubtypes: [m[2]] }, targets: [targetSpec(m[1])] }) },
    /* Endurance: "puts all the cards from their graveyard on the bottom of their library in a random order" */
    { re: /^(Up to one target player|Target player) puts all the cards from their graveyard on the bottom of their library in a random order\.?$/i,
      make: (m) => ({ op: 'graveyardToLibrary', who: 'target', bottom: true, targets: [Object.assign({ type: 'player' }, /^up to/i.test(m[1]) ? { upTo: true } : {})] }) },
    /* Noxious Gearhulk: "If a creature is destroyed this way, you gain
       life equal to its toughness." */
    { re: /^If (?:a creature|it|that creature|a permanent) (?:is|was) destroyed this way, (.+)$/i,
      make: (m) => { const inner = parseEffects(m[1].replace(/^(\w)/, (c) => c.toUpperCase())); return inner.auto ? { op: 'ifDestroyed', then: inner.effects } : null; } },
    { re: /^Create that many (Treasure|Clue|Food|Blood|Gold|Map|Powerstone) tokens\.?$/i,
      make: (m) => ({ op: 'createNamedToken', n: 'triggerAmount', token: U.titleCase(m[1]) }) },
    { re: /^Target (player|opponent) creates (a|one|two|three|\d+) (Treasure|Clue|Food|Blood|Gold|Map) tokens?\.?$/i,
      make: (m) => ({ op: 'createNamedToken', n: num(m[2]), token: U.titleCase(m[3]), who: 'target',
        targets: [/opponent/i.test(m[1]) ? { type: 'player', opponent: true } : { type: 'player' }] }) },
    /* Irenicus's Vile Duplication: "…except the token has flying and it isn't legendary" */
    { re: /^Create a token that'?s a copy of (target creature(?: you control)?), except (?:the token|it) has ([a-z ]+?) and (?:it|the token) isn'?t legendary\.?$/i,
      make: (m) => {
        const kws = keywordList(m[2]);
        if (!kws.length || !kws.every(kwKnown)) return null;
        return { op: 'copyPermanent', n: 1, targets: [targetSpec(m[1])], grant: kws, nonLegendary: true };
      } },
    /* Krosan Verge: "a Forest card and a Plains card", one search each way */
    { re: /^Search your library for an? ([A-Z][a-z]+) card and an? ([A-Z][a-z]+) card, put them onto the battlefield( tapped)?, then shuffle\.?$/,
      make: (m) => [m[1], m[2]].map(t => ({ op: 'tutor', n: 1, filter: t.toLowerCase(), to: 'battlefield', tapped: !!m[3] })) },
    /* Rituals that last: "Until end of turn, you don't lose this mana as
       steps and phases end." */
    { re: /^Until end of turn, you don'?t lose (?:this|that|unspent) mana as steps and phases end\.?$/i, make: () => ({ op: 'keepMana' }) },
    /* "Target land becomes the basic land type of your choice until end of turn." */
    { re: /^(Target land|This land|CARDNAME) becomes the basic land type of your choice until end of turn\.?$/i,
      make: (m) => (/^target/i.test(m[1]) ? { op: 'becomeBasicType', targets: [targetSpec('target land')] } : { op: 'becomeBasicType', scope: 'self' }) },
    { re: /^(Target creature|Up to one target creature) blocks (?:CARDNAME|this creature) this turn if able\.?$/i,
      make: (m) => ({ op: 'mustBlockThis', targets: [Object.assign(targetSpec('target creature'), /^up to/i.test(m[1]) ? { upTo: true } : {})] }) },
    { re: /^All creatures able to block (target creature|CARDNAME|this creature) this turn do so\.?$/i,
      make: (m) => (/^target/i.test(m[1]) ? { op: 'restrict', flag: 'lure', targets: [targetSpec('target creature')] }
        : { op: 'restrict', flag: 'lure', scope: 'self' }) },
    { re: /^(?:CARDNAME|This creature|It) becomes prepared\.?$/i, make: () => ({ op: 'becomePrepared' }) },
    { re: /^Regenerate each creature you control\.?$/i, make: () => ({ op: 'regenerate', scope: 'yourCreatures' }) },

    /* ===== zone movement ===== */
    { re: /^Put (target [a-z0-9 '-]+?) on (?:the )?(top|bottom) of (?:its|their) owner'?s library\.?$/i,
      make: (m) => ({ op: 'toLibrary', where: m[2].toLowerCase(), targets: [targetSpec(m[1])] }) },
    { re: /^Shuffle (target [a-z0-9 '-]+?) into (?:its|their) owner'?s library\.?$/i,
      make: (m) => ({ op: 'toLibrary', where: 'shuffle', targets: [targetSpec(m[1])] }) },
    { re: /^Return (?:CARDNAME|this creature|this permanent|this artifact|it) to (?:its|their) owner'?s hand\.?$/i,
      make: () => ({ op: 'bounce', scope: 'self' }) },
    { re: /^Return all (creature|artifact|enchantment|land|planeswalker) cards from your graveyard to your hand\.?$/i,
      make: (m) => ({ op: 'graveyardSweep', what: m[1].toLowerCase(), to: 'hand' }) },
    { re: /^Return all (creature|artifact|enchantment|land) cards from your graveyard to the battlefield\.?$/i,
      make: (m) => ({ op: 'graveyardSweep', what: m[1].toLowerCase(), to: 'battlefield' }) },
    { re: /^(?:You may put|Put) a land card from your hand onto the battlefield\.?$/i,
      make: () => ({ op: 'landFromHand', n: 1 }) },
    { re: /^Exile the top (?:(\w+) )?cards? of your library\.?$/i,
      make: (m) => ({ op: 'impulse', n: m[1] ? num(m[1]) : 1, play: false }) },

    /* ===== mass effects across two types ===== */
    { re: /^Destroy all (creatures|artifacts|enchantments|lands|planeswalkers) and (?:all )?(creatures|artifacts|enchantments|lands|planeswalkers)\.?(?: They can'?t be regenerated\.?)?$/i,
      make: (m) => ({ op: 'destroyAll', what: m[1].toLowerCase() + ' and ' + m[2].toLowerCase() }) },
    { re: /^Exile all (creatures|artifacts|enchantments|lands|planeswalkers) and (?:all )?(creatures|artifacts|enchantments|lands|planeswalkers)\.?$/i,
      make: (m) => ({ op: 'exileAll', what: m[1].toLowerCase() + ' and ' + m[2].toLowerCase() }) },
    { re: /^Creatures (you control|your opponents control) gain ([a-z ,]+) until end of turn\.?$/i,
      make: (m) => ({ op: 'grantKeyword', duration: 'eot',
        keywords: m[2].split(/,| and /).map(s => U.titleCase(s.trim())).filter(Boolean),
        scope: /you control/i.test(m[1]) ? 'yourCreatures' : 'opponentCreatures' }) },
    { re: /^Creatures your opponents control get ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
      make: (m) => ({ op: 'pump', p: +m[1], t: +m[2], duration: 'eot', scope: 'opponentCreatures' }) },

    /* ===== odds and ends ===== */
    { re: /^Double the number of ([+-]\d+\/[+-]\d+|[a-z ]+?) counters on (target [a-z0-9 '-]+?)\.?$/i,
      make: (m) => ({ op: 'doubleCounters', kind: m[1].trim(), targets: [targetSpec(m[2])] }) },
    { re: /^Draw (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?, then discard (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?\.?$/i,
      make: (m) => ({ op: 'drawDiscard', n: num(m[1]), discard: num(m[2]) }) },
    { re: /^(?:You )?draws? (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? and (?:you )?loses? (one|two|three|four|five|six|seven|eight|nine|ten|\d+) life\.?$/i,
      make: (m) => ({ op: 'sequence', list: [{ op: 'draw', n: num(m[1]), who: 'you' }, { op: 'loseLife', n: num(m[2]), who: 'you' }] }) },
    { re: /^Target (?:creature|permanent) deals damage equal to its power to (any target|another target creature|target creature|target player|target opponent|target planeswalker)\.?$/i,
      make: (m) => ({ op: 'damageByPower', targets: [{ type: 'creature' }, targetSpec(m[1].replace(/^another /i, ''))] }) },
    { re: /^Target player (?:puts|mills) the top (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of (?:their|his or her) library into (?:their|his or her) graveyard\.?$/i,
      make: (m) => ({ op: 'mill', n: num(m[1]), who: 'target', targets: [{ type: 'player' }] }) },
    { re: /^Each player (?:puts|mills) the top (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards? of (?:their|his or her) library into (?:their|his or her) graveyard\.?$/i,
      make: (m) => ({ op: 'mill', n: num(m[1]), who: 'each' }) },
    { re: /^Each player mills (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?\.?$/i,
      make: (m) => ({ op: 'mill', n: num(m[1]), who: 'each' }) },

    /* ===== the second sweep of the most-played cards ===== */
    { re: /^Its controller gains (one|two|three|four|five|six|seven|\d+) life\.?$/i,
      make: (m) => ({ op: 'gainLife', who: 'targetController', n: num(m[1]) }) },
    /* "Gray Merchant": X is your devotion to a colour */
    { re: /^Each opponent loses X life, where X is your devotion to (white|blue|black|red|green)\.?$/i,
      make: (m) => ({ op: 'loseLife', who: 'opponents', n: { devotion: COLOR_WORD[m[1].toLowerCase()] } }) },
    { re: /^(?:You )?[Dd]raw cards equal to the greatest power among ([-a-zA-Z ]+?)\.?$/,
      make: (m) => { const sc = scopeOf(m[1]); return sc ? { op: 'draw', who: 'you', n: { greatestPower: sc } } : null; } },
    /* "Draw a card for each creature you control with a +1/+1 counter on it." */
    { re: /^(?:You )?[Dd]raw a card for each ([-a-zA-Z0-9+/ ]+?)\.?$/,
      make: (m) => { const c = countOf(m[1]); return c ? { op: 'draw', who: 'you', n: c } : null; } },
    { re: /^You gain (one|two|three|four|five|\d+) life for each ([-a-zA-Z0-9+/ ]+?)\.?$/i,
      make: (m) => { const c = countOf(m[2], num(m[1])); return c ? { op: 'gainLife', who: 'you', n: c } : null; } },
    { re: /^Each opponent loses (one|two|three|four|five|\d+) life for each ([-a-zA-Z0-9+/ ]+?)\.?$/i,
      make: (m) => { const c = countOf(m[2], num(m[1])); return c ? { op: 'loseLife', who: 'opponents', n: c } : null; } },
    { re: /^Add (\{[^}]+\}) for each ([-a-zA-Z0-9+/' ]+?)\.?$/i,
      make: (m) => {
        const c = countOf(m[2]);
        if (!c) return null;
        const e = { op: 'addManaPer', symbol: MANA.parse(m[1])[0], per: c };
        if (c.cardsInHand === 'target') e.targets = [{ type: 'player', opponent: /opponent/i.test(m[2]) }];
        return e;
      } },
    /* Everflowing Chalice */
    { re: /^Add (\{[^}]+\}) for each ([a-z]+) counter on (?:CARDNAME|this \w+)\.?$/i,
      make: (m) => ({ op: 'addManaPer', symbol: MANA.parse(m[1])[0], per: { countersOnSelf: m[2].toLowerCase() } }) },
    /* "Exile that creature." — the one the sentence before pointed at */
    { re: /^(Exile|Destroy|Tap|Untap) (?:that|the) (?:creature|permanent|artifact|land)\.?$/i,
      make: (m) => ({ op: m[1].toLowerCase(), scope: 'lastTarget' }) },
    /* the edicts, with whatever kind of permanent they name */
    { re: /^(Each player|Each opponent|Each other player|Target player|Target opponent) sacrifices? (a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|\d+) ([a-z ,/-]+?)(?: of their choice)?\.?$/i,
      make: (m) => {
        const filter = m[3].trim().toLowerCase().replace(/s$/, '').replace(/s or /g, ' or ').replace(/and\/or/g, 'or');
        for (const w of filter.split(/[\s,]+/)) {
          if (!/^(?:creature|artifact|enchantment|land|planeswalker|permanent|nontoken|token|nonland|noncreature|or|attacking|battle|legendary|nonlegendary)$/.test(w)) return null;
        }
        const who = /^each player/i.test(m[1]) ? 'each' : /^target/i.test(m[1]) ? 'target' : 'opponents';
        return { op: 'sacrificeChoice', n: num(m[2]), who, filter,
          targets: who === 'target' ? [{ type: 'player', opponent: /opponent/i.test(m[1]) }] : undefined };
      } },
    { re: /^Put an? (indestructible|flying|first strike|deathtouch|lifelink|trample|hexproof|menace|reach|vigilance|shield|stun) counter on (CARDNAME|this creature|target [a-z ]+)\.?$/i,
      make: (m) => ({ op: 'counters', kind: m[1].toLowerCase(), n: 1,
        scope: /^target/i.test(m[2]) ? undefined : 'self', targets: /^target/i.test(m[2]) ? [targetSpec(m[2])] : undefined }) },
    /* Living Death */
    { re: /^Each player exiles all creature cards from their graveyard, then sacrifices all creatures they control, then puts all cards they exiled this way onto the battlefield\.?$/i,
      make: () => ({ op: 'livingDeath' }) },
    { re: /^Put all creature cards from all graveyards onto the battlefield under your control\.?$/i,
      make: () => ({ op: 'massReanimate', mine: true }) },
    /* "Those creatures gain indestructible until end of turn." — the ones the
       sentence before counted */
    { re: /^(?:Those|These) creatures (gain|get) (.+?) until end of turn\.?$/i,
      make: (m) => {
        if (/^gain/i.test(m[1])) {
          if (!KW_LIST.test(m[2])) return null;
          const kws = keywordList(m[2]);
          if (!kws.every(k => kwKnown(k))) return null;
          return { op: 'grantKeyword', keywords: kws, duration: 'eot', scope: 'lastGroup' };
        }
        const pt = m[2].match(/^([+-]\d+)\/([+-]\d+)$/);
        return pt ? { op: 'pump', p: +pt[1], t: +pt[2], duration: 'eot', scope: 'lastGroup' } : null;
      } },
    /* Shadowspear: "Permanents your opponents control lose hexproof and
       indestructible until end of turn." */
    { re: /^(.+?) (?:lose|loses) ([a-z, ']+?) until end of turn\.?$/i,
      make: (m) => {
        const sc = massScopeOf(m[1]);
        if (!sc || !KW_LIST.test(m[2])) return null;
        return { op: 'loseKeyword', keywords: keywordList(m[2]), duration: 'eot', scope: sc };
      } },
    { re: /^You and target opponent each draw (a|one|two|three) cards?\.?$/i,
      make: (m) => ({ op: 'sequence', list: [{ op: 'draw', n: num(m[1]), who: 'you' },
        { op: 'draw', n: num(m[1]), who: 'target', targets: [{ type: 'player', opponent: true }] }] }) },
    { re: /^Attach (?:CARDNAME|it|this Equipment) to (target [a-zA-Z ,'-]+)\.?$/,
      make: (m) => ({ op: 'attachSelf', targets: [targetSpec(m[1])] }) },
    { re: /^Put (?:CARDNAME|this artifact|this card|it) on top of its owner'?s library\.?$/i,
      make: () => ({ op: 'selfToLibraryDepth', depth: 0 }) },
    { re: /^Put your commander into your hand from the command zone\.?$/i, make: () => ({ op: 'commanderToHand' }) },
    /* "Create a Food token or a Treasure token." — one or the other, chosen */
    { re: /^Create (?:a|an) (Treasure|Clue|Food|Blood|Map|Junk|Powerstone) token or (?:a|an) (Treasure|Clue|Food|Blood|Map|Junk|Powerstone) token\.?$/i,
      make: (m) => ({ op: 'modal', count: 1, modes: [m[1], m[2]].map(t => ({ label: 'Create a ' + t + ' token',
        effects: [{ op: 'createNamedToken', n: 1, token: U.titleCase(t) }], auto: true })) }) },
    /* "Put target artifact card from your graveyard on top of your library." */
    { re: /^Put (target [a-z ]+? card) from your graveyard on top of your library\.?$/i,
      make: (m) => ({ op: 'toLibrary', where: 'top', targets: [Object.assign(targetSpec(m[1], 'graveyard'), { controller: 'you' })] }) },
    { re: /^Return (target [a-zA-Z0-9 ,'-]+? card(?: with (?:mana value|converted mana cost) \d+ or less)?) from your graveyard to the battlefield( tapped)?\.?$/,
      make: (m) => ({ op: 'reanimate', tapped: !!m[2], targets: [Object.assign(targetSpec(m[1].replace(/ card\b/, ''), 'graveyard'), { controller: 'you' })] }) },
    /* Pyroblast and its kin: a counter or a removal spell that only works on
       one colour. The target is legal either way; the effect checks. */
    { re: /^Counter target spell if it'?s (white|blue|black|red|green)\.?$/i,
      make: (m) => ({ op: 'counterSpell', ifColor: COLOR_WORD[m[1].toLowerCase()], targets: [{ type: 'spell', zone: 'stack', filter: 'spell' }] }) },
    { re: /^Destroy target permanent if it'?s (white|blue|black|red|green)\.?$/i,
      make: (m) => ({ op: 'destroy', ifColor: COLOR_WORD[m[1].toLowerCase()], targets: [{ type: 'permanent', zone: 'battlefield', filter: 'permanent' }] }) },
    { re: /^Your opponents can'?t cast spells this turn\.?$/i, make: () => ({ op: 'silence', who: 'opponents' }) },
    // Orim's Chant: "Target player can't cast spells this turn."
    { re: /^Target (player|opponent) can'?t cast spells this turn\.?$/i, make: (m) => ({ op: 'silence', who: 'target', targets: [{ type: 'player', opponent: /opponent/i.test(m[1]) }] }) },
    // Render Silent: "Counter target spell. Its controller can't cast spells this turn."
    { re: /^Its controller can'?t cast spells this turn\.?$/i, make: () => ({ op: 'silence', who: 'targetController' }) },
    // Taunt from the Rampart: "Until your next turn, those creatures can't block."
    { re: /^Until your next turn, those creatures can'?t (block|attack)\.?$/i,
      make: (m) => ({ op: 'restrict', flag: /block/i.test(m[1]) ? 'cantBlock' : 'cantAttack', duration: 'nextTurn', scope: 'lastGroup' }) },
    // Orim's Chant, kicked: "creatures can't attack this turn"
    { re: /^Creatures can'?t attack this turn\.?$/i, make: () => ({ op: 'noAttacksTurn' }) },
    // Ranger-Captain of Eos: only the noncreature ones
    { re: /^Your opponents can'?t cast noncreature spells this turn\.?$/i, make: () => ({ op: 'silence', who: 'opponents', noncreature: true }) },

    /* ===== the general shapes of a one-off group effect =====
       "Permanents you control gain hexproof and indestructible until end of
       turn", "Other creatures you control get +1/+1 until end of turn": the
       group is read with the same scope words a static ability uses. */
    { re: /^(.+?) (?:gain|gains) ([a-z, ']+?) until end of turn\.?$/i,
      make: (m) => {
        const sc = massScopeOf(m[1]);
        if (!sc || !KW_LIST.test(m[2])) return null;
        const kws = keywordList(m[2]);
        if (!kws.every(k => kwKnown(k))) return null;
        return { op: 'grantKeyword', keywords: kws, duration: 'eot', scope: sc };
      } },
    { re: /^(.+?) (?:get|gets) ([+-][\dX]+)\/([+-][\dX]+) until end of turn\.?$/i,
      make: (m) => {
        const sc = massScopeOf(m[1]);
        if (!sc) return null;
        return { op: 'pump', p: pmNum(m[2]), t: pmNum(m[3]), duration: 'eot', scope: sc };
      } },
    { re: /^(.+?) (?:get|gets) ([+-][\dX]+)\/([+-][\dX]+) and (?:gain|gains) ([a-z, ']+?) until end of turn\.?$/i,
      make: (m) => {
        const sc = massScopeOf(m[1]);
        if (!sc || !KW_LIST.test(m[4])) return null;
        const kws = keywordList(m[4]);
        if (!kws.every(k => kwKnown(k))) return null;
        return { op: 'sequence', list: [
          { op: 'pump', p: pmNum(m[2]), t: pmNum(m[3]), duration: 'eot', scope: sc },
          { op: 'grantKeyword', keywords: kws, duration: 'eot', scope: Object.assign({}, sc) }] };
      } },
    { re: /^(.+?) (?:gain|gains) ([a-z, ']+?) and (?:get|gets) ([+-][\dX]+)\/([+-][\dX]+) until end of turn\.?$/i,
      make: (m) => {
        const sc = massScopeOf(m[1]);
        if (!sc || !KW_LIST.test(m[2])) return null;
        const kws = keywordList(m[2]);
        if (!kws.every(k => kwKnown(k))) return null;
        return { op: 'sequence', list: [
          { op: 'grantKeyword', keywords: kws, duration: 'eot', scope: sc },
          { op: 'pump', p: pmNum(m[3]), t: pmNum(m[4]), duration: 'eot', scope: Object.assign({}, sc) }] };
      } },
    /* "Destroy each artifact you don't control", "Return each nonland
       permanent you don't control to its owner's hand" — overload's way of
       saying it, and a few cards' printed one. */
    { re: /^(Destroy|Exile) (each [a-zA-Z0-9 ,'/+-]+?)\.?(?: They can'?t be regenerated\.?)?$/,
      make: (m) => {
        const sc = eachScope(m[2]);
        if (!sc) return null;
        return { op: /Destroy/.test(m[1]) ? 'destroyAll' : 'exileAll', scope: sc, what: sc.what,
          noRegen: /regenerated/i.test(m[0]) };
      } },
    { re: /^(Destroy|Exile) all ([a-zA-Z0-9 ,'/+-]+?)\.?(?: They can'?t be regenerated\.?)?$/,
      make: (m) => {
        const sc = scopeOf(m[2]);
        if (!sc || sc.self || sc.attached) return null;
        return { op: /Destroy/.test(m[1]) ? 'destroyAll' : 'exileAll', scope: sc, what: sc.what,
          noRegen: /regenerated/i.test(m[0]) };
      } },
    { re: /^Return (?:each|all) ([a-zA-Z0-9 ,'/+-]+?) to (?:its owner'?s|their owners'?|their owner'?s) hands?\.?$/,
      make: (m) => { const sc = eachScope(m[1]); return sc ? { op: 'bounceAll', scope: sc, what: sc.what } : null; } },
    { re: /^(?:[A-Za-z][-A-Za-z0-9',\. ]{0,44}?\s)?deals? (one|two|three|four|five|six|seven|eight|nine|ten|\d+|X) damage to each ([a-zA-Z0-9 ,'/+-]+?)\.?$/,
      make: (m) => {
        if (/\b(?:player|opponent)s?\b/i.test(m[2])) return null;
        const sc = eachScope(m[2]);
        return sc ? { op: 'damage', n: num(m[1]), scope: sc } : null;
      } },
    { re: /^Counter (target [a-zA-Z ,'/-]*?spells?(?: with [^.]+)?)\.?$/,
      make: (m) => ({ op: 'counterSpell', targets: [targetSpec(m[1])] }) },
    /* The plain removal verbs with any target phrase the target reader can
       check word for word: "Destroy target artifact, enchantment, or
       nonbasic land an opponent controls." */
    { re: /^(Destroy|Exile|Tap|Untap) (up to one )?(target [a-zA-Z0-9 ,'/+-]+?)\.?(?: (?:It|They) can'?t be regenerated\.)?$/,
      make: (m) => {
        const op = { Destroy: 'destroy', Exile: 'exile', Tap: 'tap', Untap: 'untap' }[m[1]];
        const spec = targetSpec(m[3]);
        if (m[2]) spec.upTo = true;
        return { op, targets: [spec], noRegen: /regenerated/.test(m[0]) || undefined };
      } },
    { re: /^Return (target [a-zA-Z0-9 ,'/+-]+?) to (?:its|their) owner'?s'? hands?\.?$/,
      make: (m) => ({ op: 'bounce', targets: [targetSpec(m[1])] }) },
    { re: /^(?:[A-Za-z][-A-Za-z0-9',. ]{0,44}?\s)?deals? (one|two|three|four|five|six|seven|eight|nine|ten|\d+|X) damage to (target [a-zA-Z0-9 ,'/+-]+?)\.?$/,
      make: (m) => ({ op: 'damage', n: num(m[1]), targets: [targetSpec(m[2])] }) },
    /* "return a creature or planeswalker card from your graveyard to your
       hand": not a target — chosen as it happens */
    { re: /^(?:Then )?[Rr]eturn (a|an|one|two|up to one|up to two) ([a-zA-Z ,]+?) cards? from your graveyard to (your hand|the battlefield)\.?$/,
      make: (m) => ({ op: 'graveyardPick', n: num(m[1].replace(/^up to /, '')), upTo: /^up to/.test(m[1]),
        filter: m[2].trim().toLowerCase(), to: /hand/.test(m[3]) ? 'hand' : 'battlefield' }) },
    /* "Until end of turn, creatures you control gain trample" is the same
       sentence with its time at the front. */
    { re: /^Until end of turn, (.+?) (gain|gains|get|gets) (.+?)\.?$/i,
      make: (m) => parseEffectSentence(m[1].charAt(0).toUpperCase() + m[1].slice(1) + ' ' + m[2] + ' ' + m[3] + ' until end of turn.') },
  ];

  /** "each nonland permanent you don't control" -> the scope of the plural. */
  function eachScope(phrase) {
    const p = String(phrase).trim().replace(/^(?:each|all) /i, '');
    return scopeOf(p.replace(/\b(creature|permanent|artifact|enchantment|land|planeswalker|battle)\b(?!s)/, '$1s'));
  }

  /* "for each creature you control with a +1/+1 counter on it", "for each
     tapped land your opponents control", "for each card in target
     opponent's hand": a number the engine counts as the effect resolves. */
  /** Which spell "spent to cast …" means: this one, the one a trigger is about, or whichever "it" is. */
  function spentOf(w) {
    const t = String(w).toLowerCase();
    return t === 'that spell' ? 'that' : (t === 'it' ? 'it' : 'this');
  }

  /** A count that can be made with no effect resolving: what is on the table, in a hand or a graveyard. */
  function plainCount(c) {
    return !!c && ['scope', 'cardsInHand', 'cardsInGraveyard', 'opponents', 'domain', 'colorsAmongYours', 'per', 'attachedOf']
      .some(k => c[k] != null) || !!(c && c.sum && c.sum.every(plainCount));
  }

  function countOf(phrase, mult) {
    const p = String(phrase || '').trim();
    const k = mult == null ? 1 : mult;
    let m;
    if ((m = p.match(/^card in (your|target opponent'?s|target player'?s|that player'?s) hand$/i)))
      return { cardsInHand: /^your/i.test(m[1]) ? 'you' : 'target', mult: k };
    if (/^card in your graveyard$/i.test(p)) return { cardsInGraveyard: 'you', mult: k };
    // Converge: "where X is the number of colors of mana spent to cast this spell"
    if ((m = p.match(/^colou?rs? of mana spent to cast (this spell|that spell|it|CARDNAME)$/i))) return { colorsSpent: true, of: spentOf(m[1]), mult: k };
    // Verazol: "for each mana spent to cast it"
    if ((m = p.match(/^mana spent to cast (this spell|that spell|it|CARDNAME)$/i))) return { manaSpent: true, of: spentOf(m[1]), mult: k };
    // Mahadi: "for each creature that died this turn"
    if (/^creatures? that died this turn$/i.test(p)) return { diedThisTurn: true, mult: k };
    // Fountain of Cho: "for each storage counter removed this way"
    if (/^[a-z+\-0-9/]+ counters? removed this way$/i.test(p)) return { removedCounters: true, mult: k };
    // Rite of Flame: "for each card named CARDNAME in each graveyard"
    if (/^card named CARDNAME in (?:each graveyard|all graveyards)$/i.test(p)) return { namedInGraveyards: true, mult: k };
    // Culling Ritual: "for each permanent destroyed this way"
    if (/^(?:permanent|creature) (?:destroyed|exiled|returned) this way$/i.test(p)) return { lastSweep: true, mult: k };
    // "for each land card in your graveyard"
    if ((m = p.match(/^([a-z]+) card in your graveyard$/i))) return { cardsInGraveyard: 'you', filter: m[1].toLowerCase(), mult: k };
    // Kor Spiritdancer: "for each Aura attached to it"
    if ((m = p.match(/^(Aura|Equipment) attached to (?:it|this creature|CARDNAME)$/))) return { attachedOf: m[1], mult: k };
    // Thran Power Suit: "for each Aura and Equipment attached to it"
    if (/^Aura and Equipment attached to (?:it|this creature|CARDNAME)$/.test(p)) return { attachedOf: ['Aura', 'Equipment'], mult: k };
    /* Multani: "for each land you control and each land card in your
       graveyard" — two counts added together */
    if ((m = p.match(/^(.+?) and each (.+)$/i))) {
      const a = countOf(m[1]), b = countOf(m[2]);
      if (a && b) return { sum: [a, b], mult: k };
    }
    if (/^opponent you have$/i.test(p)) return { opponents: true, mult: k };
    if (/^card you'?ve drawn this turn$/i.test(p)) return { drawnThisTurn: 'you', mult: k };
    if (/^colou?r among permanents you control$/i.test(p)) return { colorsAmongYours: true, mult: k };
    if (/^card in your hand$/i.test(p)) return { cardsInHand: 'you', mult: k };
    if ((m = p.match(/^([+\-0-9/a-z]+) counter on (?:this creature|this artifact|this permanent|CARDNAME|it)$/i)))
      return { countersOnSelf: m[1].toLowerCase(), mult: k };
    let sc = eachScope(p);
    if (!sc) sc = scopeOf(p.replace(/\b([A-Z][a-z'-]+)\b(?=(?: you control| your opponents control|$))/, '$1s'));
    if (!sc || sc.self || sc.attached) return null;
    return { scope: sc, mult: k };
  }

  /**
   * "Equal to …" and "where X is …": a number the engine works out as the
   * effect happens. Returns the shape n() reads, or null for anything this
   * does not know how to count.
   */
  function amountOf(phrase) {
    let p = String(phrase || '').trim().replace(/\.$/, '');
    let plus = 0;
    const pl = p.match(/^(.+?) plus (one|two|three|four|five|\d+)$/i);
    if (pl) { p = pl[1]; plus = num(pl[2]); if (typeof plus !== 'number') return null; }
    const done = (v) => (v == null ? null : plus ? Object.assign({}, v, { plus }) : v);
    let m;
    const STAT = { power: 'power', toughness: 'toughness', 'mana value': 'mv', 'converted mana cost': 'mv' };
    if ((m = p.match(/^the sacrificed (?:creature|artifact|permanent|land)'s (power|toughness|mana value)$/i)))
      return done({ ofSacrificed: STAT[m[1].toLowerCase()] });
    // the creature the trigger is about: "that creature's power", "its power"
    if ((m = p.match(/^(?:its|that creature's|that permanent's|the creature's|that spell's) (power|toughness|mana value)$/i)))
      return done({ ofTrigger: STAT[m[1].toLowerCase()] });
    if ((m = p.match(/^(?:CARDNAME's|this creature's) (power|toughness)$/i))) return done({ ofSelf: m[1].toLowerCase() });
    if (/^the number of cards in your hand$/i.test(p)) return done({ cardsInHand: 'you', mult: 1 });
    // Rackling: "3 minus the number of cards in their hand"
    if ((m = p.match(/^(\d+) minus the number of cards in (?:their|that player'?s) hand$/i))) return done({ minusHand: +m[1] });
    // Storm Herd: "where X is your life total"
    if (/^your life total$/i.test(p)) return done({ lifeTotal: 'you' });
    // "the amount of mana spent to cast this spell / that spell / it / her"
    if ((m = p.match(/^the amount of mana spent to cast (this spell|that spell|it|her|him|CARDNAME|this creature)$/i)))
      return done({ manaSpent: true, of: spentOf(m[1]), mult: 1 });
    if (/^the number of cards in your graveyard$/i.test(p)) return done({ cardsInGraveyard: 'you', mult: 1 });
    // "the number of counters on this creature": every kind
    if (/^the number of counters on (?:this creature|this artifact|this permanent|CARDNAME)$/i.test(p)) return done({ countersOnSelf: '*', mult: 1 });
    if ((m = p.match(/^the number of ([+\-0-9/a-z]+) counters on (?:this creature|this artifact|this enchantment|this permanent|CARDNAME|it)$/i)))
      return done({ countersOnSelf: m[1].toLowerCase(), mult: 1 });
    if ((m = p.match(/^the greatest power among (creatures you control|creatures your opponents control|creatures)$/i))) {
      const sc = scopeOf(m[1]);
      return sc ? done({ greatestPower: sc }) : null;
    }
    if ((m = p.match(/^your devotion to (white|blue|black|red|green)$/i)))
      return done({ devotion: { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' }[m[1].toLowerCase()] });
    if ((m = p.match(/^the number of (.+)$/i))) {
      const c = countOf(m[1]);
      return c ? done(c) : null;
    }
    return null;
  }

  /** A group on the battlefield named the way a one-off effect names it. */
  function massScopeOf(phrase) {
    const p = String(phrase).trim();
    if (/^(?:target|it|they|that|this|CARDNAME|enchanted|equipped)\b/i.test(p)) return null;
    if (/^each /i.test(p)) {
      const sc0 = scopeOf(p.replace(/^each (other )?/i, (x, o) => (o ? 'other ' : '')).replace(/^(other )?([a-z]+)/i, '$1$2s'));
      // "each green creature that entered this turn": the noun is not the first word
      return sc0 || scopeOf(p);
    }
    return scopeOf(p);
  }

  /** A count the engine works out at resolution: "for each creature you control". */
  function countSpec(phrase, mult, who) {
    return { per: String(phrase || '').toLowerCase().trim(),
      mult: mult == null ? 1 : mult, who: who || 'you' };
  }

  // the engine works X out at resolution, so keep it as a marker here
  const BIG_WORDS = { eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16,
    seventeen: 17, eighteen: 18, nineteen: 19, twenty: 20 };
  function num(w) {
    const big = BIG_WORDS[String(w || '').trim().toLowerCase()];
    return big != null ? big : U.numWord(w, 'X');
  }

  /** "Creatures you control" -> the scope word the engine uses for a mass pump. */
  function massScope(phrase) {
    const p = String(phrase).toLowerCase();
    if (/opponents control/.test(p)) return 'opponentCreatures';
    if (/^all creatures|^each creature\b(?! you)/.test(p)) return 'allCreatures';
    return 'yourCreatures';
  }

  /** "+3" -> 3, "-X" -> the marker, so a pump can be worked out later. */
  function pmNum(w) {
    const s = String(w).trim();
    if (/X/i.test(s)) return s.startsWith('-') ? { negX: true } : { posX: true };
    return parseInt(s, 10) || 0;
  }

  const COLOR_WORD = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
  const SPEC_TYPES = ['creature', 'artifact', 'enchantment', 'land', 'planeswalker', 'battle', 'permanent'];
  /* Words a target phrase can carry that this knows how to check. Anything
     else marks the phrase unknown, because a target this cannot check is
     one it would offer wrongly. */
  const SPEC_FLAGS = new Set(['attacking', 'blocking', 'tapped', 'untapped', 'token', 'nontoken', 'legendary',
    'nonlegendary', 'basic', 'nonbasic', 'nonland', 'noncreature', 'nonartifact', 'nonenchantment',
    'snow', 'colorless', 'multicolored', 'monocolored', 'face-down']);
  const SPEC_FILLER = new Set(['a', 'an', 'or', 'and', 'and/or', 'target', 'other', 'another', 'of', 'card', 'cards',
    'one', 'two', 'three', 'up', 'to']);

  function targetSpec(phrase, zone) {
    // "target creature that was dealt damage this turn"
    const damaged = /\s+that was dealt damage this turn$/i.test(String(phrase));
    if (damaged) phrase = String(phrase).replace(/\s+that was dealt damage this turn$/i, '');
    const orig = String(phrase).replace(/^(?:another |other )?target\s+/i, '').trim();
    const p = orig.toLowerCase();
    const spec = { type: 'permanent', filter: p, zone: zone || 'battlefield' };
    if (damaged) spec.damagedThisTurn = true;
    /* "another target creature", "any other target": never the thing
       whose ability this is (CR 115.5) */
    if (/^(?:another|other) target /i.test(String(phrase).trim()) || /^any other target$/.test(p)) spec.another = true;
    if (/^any (?:other )?target$/.test(p)) { spec.type = 'any'; return spec; }
    /* "target planeswalker and up to one target artifact" is two targets,
       not one that may be either */
    if (/\btarget\b/.test(p)) spec.unknown = true;
    // the "with" clauses come last and say one checkable thing each
    const pw = p.match(/with (?:mana value|converted mana cost) (\d+) or less/);
    if (pw) spec.maxMv = +pw[1];
    // Blue Sun's Twilight, Spell Blast: "with mana value X (or less)", the X it was cast with
    const px = p.match(/with (?:mana value|converted mana cost) x( or less| or greater)?$/i);
    if (px) { if (!px[1]) spec.mv = 'X'; else if (/less/.test(px[1])) spec.maxMv = 'X'; else spec.minMv = 'X'; }
    const pp = p.match(/with power (\d+) or less/);
    if (pp) spec.maxPower = +pp[1];
    const pg = p.match(/with power (\d+) or (?:greater|more)/);
    if (pg) spec.minPower = +pg[1];
    const tg = p.match(/with toughness (\d+) or less/);
    if (tg) spec.maxToughness = +tg[1];
    const mg = p.match(/with (?:mana value|converted mana cost) (\d+) or (?:greater|more)/);
    if (mg) spec.minMv = +mg[1];
    const tm = p.match(/with toughness (\d+) or (?:greater|more)/);
    if (tm) spec.minToughness = +tm[1];
    /* "target creature with flying", "target creature without flying" */
    const KW = 'flying|first strike|double strike|deathtouch|lifelink|menace|reach|trample|vigilance|haste|defender|indestructible|hexproof|shroud|flash|infect|wither|shadow|fear|intimidate|horsemanship|skulk|changeling|islandwalk|swampwalk|forestwalk|mountainwalk|plainswalk';
    const wk = p.match(new RegExp('with (?:' + KW + ')\\b'));
    if (wk) spec.withKeyword = wk[0].replace(/^with /, '');
    const wo = p.match(new RegExp("without (?:" + KW + ")\\b"));
    if (wo) spec.withoutKeyword = wo[0].replace(/^without /, '');
    const wc = p.match(/with an? ([+\-0-9/a-z]+) counter on it/);
    if (wc) spec.withCounter = wc[1];
    // Heartless Act: "target creature with no counters on it"
    if (/with no counters on it$/.test(p)) spec.noCounters = true;
    // Cut Down: "with total power and toughness 5 or less"; Warping Wail: "with power or toughness 1 or less"
    const tpt = p.match(/with total power and toughness (\d+) or less$/);
    if (tpt) spec.maxPtSum = +tpt[1];
    const pot = p.match(/with power or toughness (\d+) or less$/);
    if (pot) spec.maxPowerOrToughness = +pot[1];
    // Repel Calamity: "with power or toughness 4 or greater"
    const pog = p.match(/with power or toughness (\d+) or (?:greater|more)$/);
    if (pog) spec.minPowerOrToughness = +pog[1];
    const mx = p.match(/with (?:mana value|converted mana cost) (\d+)$/);
    if (mx) spec.mv = +mx[1];
    const withClause = (orig.match(/\s+(?:with|without)\s+.*$/i) || [''])[0];
    const known = spec.maxMv != null || spec.minMv != null || spec.mv != null || spec.maxPower != null || spec.minPower != null ||
      spec.maxToughness != null || spec.minToughness != null || spec.withKeyword || spec.withoutKeyword || spec.withCounter || spec.noCounters ||
      spec.maxPtSum != null || spec.maxPowerOrToughness != null || spec.minPowerOrToughness != null;
    /* A "with ..." clause nobody above claimed is a restriction this cannot
       read. Saying so is better than quietly offering an illegal target. */
    if (withClause && !known) spec.unknown = true;
    let rest = orig.slice(0, orig.length - withClause.length);
    // who controls it
    const ctl = rest.match(/\s+(you control|you don'?t control|an opponent controls|your opponents control|defending player controls)$/i);
    if (ctl) {
      spec.controller = /^you control/i.test(ctl[1]) ? 'you' : 'opponent';
      rest = rest.slice(0, ctl.index);
    }
    const types = [];
    if (/\battacking or blocking\b/i.test(rest)) { spec.inCombat = true; rest = rest.replace(/\battacking or blocking\b/i, ''); }
    for (const w of rest.split(/[\s,]+/).filter(Boolean)) {
      const lw = w.toLowerCase();
      const bare = lw.replace(/s$/, '');
      if (SPEC_FILLER.has(lw)) continue;
      if (SPEC_TYPES.includes(bare)) { types.push(bare); continue; }
      if (bare === 'player') { types.push('player'); continue; }
      if (bare === 'opponent') { types.push('player'); spec.opponent = true; continue; }
      if (bare === 'spell') { types.push('spell'); continue; }
      if (lw === 'instant' || lw === 'sorcery') { spec.spellish = true; continue; }
      if (COLOR_WORD[lw]) { (spec.colors = spec.colors || []).push(COLOR_WORD[lw]); continue; }
      if (/^non-?/.test(lw) && COLOR_WORD[lw.replace(/^non-?/, '')]) {
        (spec.notColors = spec.notColors || []).push(COLOR_WORD[lw.replace(/^non-?/, '')]);
        continue;
      }
      if (SPEC_FLAGS.has(lw)) {
        if (lw === 'attacking') spec.attacking = true;
        else if (lw === 'blocking') spec.blocking = true;
        else if (lw === 'tapped') spec.tapped = true;
        else if (lw === 'untapped') spec.tapped = false;
        else if (lw === 'nonland') spec.nonland = true;
        else if (lw === 'nontoken') spec.nontoken = true;
        else if (lw === 'token') spec.token = true;
        else if (lw === 'nonlegendary') spec.nonlegendary = true;
        else if (lw === 'legendary') spec.legendary = true;
        else if (lw === 'nonbasic') spec.nonbasic = true;
        else if (lw === 'basic') spec.basic = true;
        else if (lw === 'noncreature') spec.notType = (spec.notType || []).concat('creature');
        else if (lw === 'nonartifact') spec.notType = (spec.notType || []).concat('artifact');
        else if (lw === 'nonenchantment') spec.notType = (spec.notType || []).concat('enchantment');
        else if (lw === 'colorless') spec.colorless = true;
        else if (lw === 'multicolored') spec.multicolored = true;
        else if (lw === 'monocolored') spec.monocolored = true;
        else if (lw === 'face-down') spec.faceDown = true;
        else spec.unknown = true;
        continue;
      }
      // "non-Human": anything but that creature type
      if (/^non-[A-Z]/.test(w)) { spec.notSubtype = w.slice(4).toLowerCase(); continue; }
      // a creature type or other subtype is printed with a capital: "target Goblin"
      if (/^[A-Z][a-z'-]+$/.test(w) && w !== 'CARDNAME') {
        (spec.subtypes = spec.subtypes || []).push(lw.replace(/ves$/, 'f').replace(/s$/, ''));
        continue;
      }
      spec.unknown = true;
    }
    const permTypes = types.filter(t => SPEC_TYPES.includes(t));
    if (types.includes('spell')) {
      spec.type = 'spell'; spec.zone = 'stack';
      /* "target spell or nonland permanent an opponent controls" is either
         kind of thing (Sink into Stupor) */
      if (permTypes.includes('permanent') && !types.includes('player')) { spec.type = 'spellOrPermanent'; spec.zone = 'any'; }
      else if (types.includes('player') || permTypes.length) {
        if (types.includes('player') || permTypes.some(t => t === 'permanent')) spec.unknown = true;
      }
    } else if (types.includes('player')) {
      if (permTypes.length) { spec.type = 'any'; spec.anyOf = permTypes; }
      else spec.type = 'player';
    } else if (permTypes.length > 1) {
      spec.type = 'permanent'; spec.anyOf = permTypes;
    } else if (permTypes.length === 1) {
      spec.type = permTypes[0];
    }
    if (spec.spellish && spec.type !== 'spell') {
      // "an instant or sorcery card" is a card in a graveyard or a hand, never a permanent
      spec.cardTypes = ['instant', 'sorcery'].filter(t => p.includes(t)).concat(permTypes);
      if ((zone || 'battlefield') === 'battlefield') spec.unknown = true;
    }
    return spec;
  }

  /**
   * Does this permanent fit a target spec the parser produced? The engine,
   * the bots and the targeting cursor all ask the same question, so they all
   * ask it here. `me` is the id of whoever is choosing, for "you control".
   */
  function matchesSpec(spec, obj, analysis, me, ctx) {
    const a = analysis;
    if (!spec || !a) return false;
    /* Power, toughness and keywords are what the permanent has *now*, not
       what was printed on it, so the caller lends the game's own answers
       when it has them. */
    const pow = () => (ctx && ctx.powerOf ? ctx.powerOf(obj) : parseInt(a.power, 10) || 0);
    const tou = () => (ctx && ctx.toughnessOf ? ctx.toughnessOf(obj) : parseInt(a.toughness, 10) || 0);
    const kw = (k) => (ctx && ctx.hasKw ? !!ctx.hasKw(obj, k)
      : (a.keywords || []).some(x => String(x).toLowerCase() === k));
    const isType = (t) => (a.types || []).some(x => x.toLowerCase() === t);
    if (spec.type === 'player' || spec.type === 'spell') return false;
    /* "Any target" is a creature, a planeswalker, a battle or a player
       (CR 115.4) — never a land or an artifact that is only that. A card
       in a graveyard is not a permanent at all, so this only asks on the
       battlefield. */
    if (spec.type === 'any' && !spec.anyOf && obj.zone === 'battlefield' &&
        !(a.isCreature || a.isPlaneswalker || a.isBattle)) return false;
    if (spec.type === 'creature' && !a.isCreature) return false;
    if (spec.type === 'artifact' && !a.isArtifact) return false;
    if (spec.type === 'enchantment' && !a.isEnchantment) return false;
    if (spec.type === 'land' && !a.isLand) return false;
    if (spec.type === 'planeswalker' && !a.isPlaneswalker) return false;
    if (spec.type === 'battle' && !a.isBattle) return false;
    if (spec.anyOf && !spec.anyOf.some(w => w === 'permanent' || w === 'player' || isType(w))) return false;
    if (spec.cardTypes && spec.cardTypes.length && !spec.cardTypes.some(isType)) return false;
    if (spec.notType && spec.notType.some(isType)) return false;
    if (spec.notSubtype && (a.subtypes || []).some(t => t.toLowerCase() === spec.notSubtype)) return false;
    if (spec.subtypes && !spec.subtypes.some(st => (a.subtypes || []).some(t => t.toLowerCase() === st))) return false;
    if (spec.nonlegendary && (a.supertypes || []).includes('Legendary')) return false;
    if (spec.legendary && !(a.supertypes || []).includes('Legendary')) return false;
    if (spec.nonbasic && (a.supertypes || []).includes('Basic')) return false;
    if (spec.basic && !(a.supertypes || []).includes('Basic')) return false;
    if (spec.nonland && a.isLand) return false;
    if (spec.nontoken && obj.isToken) return false;
    if (spec.token && !obj.isToken) return false;
    if (spec.faceDown && !obj.faceDown) return false;
    if (spec.commander && !obj.isCommander) return false;
    if (spec.name && obj.name !== spec.name) return false;
    // "target permanent you own"
    if (spec.owner === 'you' && obj.owner !== me) return false;
    const cols = a.colors || [];
    if (spec.colors && !spec.colors.some(c => cols.includes(c))) return false;
    if (spec.notColors && spec.notColors.some(c => cols.includes(c))) return false;
    if (spec.colorless && cols.length) return false;
    if (spec.multicolored && cols.length < 2) return false;
    if (spec.monocolored && cols.length !== 1) return false;
    if (spec.controller === 'you' && obj.controller !== me) return false;
    // one particular player's ("that player controls"), settled as the effect resolves
    if (spec.controllerId && obj.controller !== spec.controllerId) return false;
    if (spec.controller === 'opponent' && obj.controller === me) return false;
    // X: the one this was cast with, when it is known yet; any, until then
    const xv = (v) => (v === 'X' ? (ctx && ctx.x != null ? ctx.x : null) : v);
    const mvMax = xv(spec.maxMv), mvMin = xv(spec.minMv), mvIs = xv(spec.mv);
    if (mvMax != null && (obj.card.cmc || 0) > mvMax) return false;
    if (mvMin != null && (obj.card.cmc || 0) < mvMin) return false;
    if (mvIs != null && (obj.card.cmc || 0) !== mvIs) return false;
    if (spec.attacking && !obj.attacking) return false;
    if (spec.blocking && !(obj.blocking || []).length) return false;
    if (spec.inCombat && !obj.attacking && !(obj.blocking || []).length) return false;
    if (spec.tapped != null && !!obj.tapped !== spec.tapped) return false;
    if (spec.damagedThisTurn && !obj.damagedThisTurn) return false;
    if (spec.maxPower != null && pow() > spec.maxPower) return false;
    if (spec.maxPtSum != null && pow() + tou() > spec.maxPtSum) return false;
    if (spec.maxPowerOrToughness != null && pow() > spec.maxPowerOrToughness && tou() > spec.maxPowerOrToughness) return false;
    if (spec.minPowerOrToughness != null && pow() < spec.minPowerOrToughness && tou() < spec.minPowerOrToughness) return false;
    if (spec.minPower != null && pow() < spec.minPower) return false;
    if (spec.maxToughness != null && tou() > spec.maxToughness) return false;
    if (spec.minToughness != null && tou() < spec.minToughness) return false;
    if (spec.withKeyword && !kw(spec.withKeyword)) return false;
    if (spec.withoutKeyword && kw(spec.withoutKeyword)) return false;
    if (spec.withCounter && !(Number((obj.counters || {})[spec.withCounter]) > 0)) return false;
    if (spec.noCounters && Object.values(obj.counters || {}).some(v => Number(v) > 0)) return false;
    return true;
  }

  function hasUnknownTarget(e) {
    if (!e || typeof e !== 'object') return false;
    if ((e.targets || []).some(t => t && t.unknown)) return true;
    for (const k of ['list', 'then', 'otherwise', 'effects']) {
      if (Array.isArray(e[k]) && e[k].some(hasUnknownTarget)) return true;
    }
    return Array.isArray(e.modes) && e.modes.some(m => (m.effects || []).some(hasUnknownTarget));
  }

  /** Try to convert one sentence into an executable effect. */
  function parseEffectSentence(sentence, depth) {
    /* A token creature calls itself "this token"; to every rule here that
       is the same creature as "this creature". */
    const s = sentence.trim().replace(/\s+/g, ' ').replace(/^[a-z]/, (c) => c.toUpperCase())
      .replace(/\b([Tt])his token\b/g, '$1his creature')
      // Wan Shi Tong: "put X +1/+1 counters on him" — a character card means itself
      .replace(/ counters? on (?:him|her)\b/g, (x) => x.replace(/him|her/, 'CARDNAME'))
      .replace(/^(?:That|The) (?:creature|permanent|land|artifact|enchantment|spell|planeswalker)'s controller\b/, 'Its controller')
      // Aethersphere Harvester: "This Vehicle gains lifelink" — a permanent talking about itself
      .replace(/^This (?:Vehicle|Spacecraft|permanent) (gains|gets|has) /, 'This creature $1 ')
      // "Each opponent mills fourteen cards": the big number words as digits
      .replace(/\b(eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty)\b/gi, (w) => String(BIG_WORDS[w.toLowerCase()]))
      // Faith & Grief: "target artifact and/or enchantment cards" — either kind, as "or" says
      .replace(/\b(artifact|creature|enchantment|land|planeswalker|instant|sorcery|battle) and\/or (artifact|creature|enchantment|land|planeswalker|instant|sorcery|battle)( cards?\b)/gi, '$1 or $2$3')
      // Aurelia: "each of your opponents" is each opponent
      .replace(/\beach of your opponents\b/g, 'each opponent');
    if (!s) return null;
    for (const rule of EFFECT_RULES) {
      const m = s.match(rule.re);
      if (!m) continue;
      // a rule may match the shape of a sentence and still decide it cannot
      // read it (an unknown condition, an unknown scope); then the next rule
      // gets its turn rather than the sentence being lost
      const eff = rule.make(m);
      if (!eff) continue;
      /* A target with words in it this cannot check would be offered
         wrongly; better that the sentence is not read at all. */
      if (hasUnknownTarget(eff)) continue;
      eff.text = s;
      return eff;
    }
    /* "You create a Treasure token" is "Create a Treasure token" said by
       somebody: read it without the subject. */
    if (!depth && /^You (?:create|draw|put|exile|return|sacrifice|search|scry|surveil|mill|look|reveal|discard|untap|tap|proliferate|investigate|amass|shuffle|choose|destroy|counter|copy|attach)\b/.test(s)) {
      const again = parseEffectSentence(s.replace(/^You (\w)/, (x, c) => c.toUpperCase()), 1);
      if (again) return again;
    }
    /* "Until end of turn, this land becomes a 3/4 Elemental creature with
       reach" is "This land becomes ... until end of turn" said the other
       way round. */
    if (!depth && /^Until end of turn, /i.test(s) && !/until end of turn/i.test(s.slice(18))) {
      const again = parseEffectSentence(s.replace(/^Until end of turn, /i, '').replace(/\.?$/, ' until end of turn.'), 1);
      if (again) return again;
    }
    /* "If the gift was promised, permanents you control also gain
       indestructible": "also" says how the sentence relates to the one
       before it, not what it does. */
    // "Then discard two cards": "then" only says it comes after
    if (!depth && /^Then /.test(s)) {
      const again = parseEffectSentence(s.replace(/^Then (\w)/, (x, c) => c.toUpperCase()), 1);
      if (again) return again;
    }
    if (!depth && / also /.test(s)) {
      const again = parseEffectSentence(s.replace(/ also /, ' '), 1);
      if (again) return again;
    }
    /* "Tap any number of target creatures", "Return any number of target
       lands you control to their owner's hand": the sentence read for one
       target, and the picking done as it resolves — any number of the
       things it could have targeted. */
    const anyN = !depth && s.match(/\bany number of (other )?target ((?:[a-z]+ )*?)(creatures|artifacts|enchantments|lands|permanents|planeswalkers|players|cards)( [^,.]*)?/i);
    if (anyN && !/divided|damage/i.test(s)) {
      const one = s.replace(anyN[0], (anyN[1] ? 'another ' : '') + 'target ' + anyN[2] + anyN[3].replace(/s$/, '') + (anyN[4] || '').replace(/\bthey control\b/, 'it controls').replace(/\btheir owners?'?s?\b/, "its owner's"))
        .replace(/\bto their owners'? hands?\b/i, "to its owner's hand");
      const inner = parseEffectSentence(oneOfThem(one, s.indexOf(anyN[0]) === 0), 1);
      const holder = inner && inner.op !== 'manual' && !hasManualStep(inner) && sharedTarget(inner);
      if (holder && holder.targets[0].type !== 'player') {
        holder.anyFrom = Object.assign({}, holder.targets[0], { upTo: true });
        delete holder.targets;
        inner.text = s;
        return inner;
      }
    }
    /* "Tap X target creatures", "Up to X target creatures phase out": the
       sentence read for one target, and that target made a variable number
       of them — X of them, or up to X (the X paid) */
    const xN = !depth && s.match(/\b(up to )?X target ((?:[a-z]+ )*?)(creatures|artifacts|enchantments|lands|permanents|planeswalkers|cards)( [^,.]*)?/i);
    if (xN && !/divided|\bwhere X\b|\beach of\b/i.test(s)) {
      const atStart = s.indexOf(xN[0]) === 0;
      let one = s.replace(xN[0], 'target ' + xN[2] + xN[3].replace(/s$/, '') + (xN[4] || '').replace(/\bthey control\b/, 'it controls'))
        .replace(/\bto their owners'? hands?\b/i, "to its owner's hand");
      const inner = parseEffectSentence(oneOfThem(one, atStart), 1);
      const holder = inner && inner.op !== 'manual' && !hasManualStep(inner) && sharedTarget(inner);
      if (holder && holder.targets[0].type !== 'player') {
        holder.targets = [Object.assign({}, holder.targets[0], { multi: { count: 'X', exact: !xN[1] } })];
        delete holder.targets[0].upTo;
        inner.text = s;
        return inner;
      }
    }
    /* "You draw X cards and lose X life, where X is the number of colors of
       mana spent to cast this spell": the sentence read with X in it, and
       every X then made the number the rider names. */
    const wx = !depth && s.match(/^(.+?), where X is ([^,]+?)\.?$/);
    if (wx && !/\bwhere X\b/.test(wx[1])) {
      const k = amountOf(wx[2]);
      const inner = k && parseEffectSentence(wx[1] + '.', 0);
      if (inner && inner.op !== 'manual' && !hasManualStep(inner) && fillX(inner, k)) { inner.text = s; return inner; }
    }
    /* Dawnsire: "deals 100 damage to up to one target creature" — read with
       "target", and the one target made optional */
    if (!depth && /\bup to one target\b/i.test(s) && (s.match(/\btarget\b/gi) || []).length === 1) {
      const inner = parseEffectSentence(s.replace(/\bup to one target\b/i, 'target'), 1);
      if (inner && inner.op !== 'manual' && !hasManualStep(inner) && (inner.targets || []).length === 1) {
        inner.targets = [Object.assign({}, inner.targets[0], { upTo: true })];
        inner.text = s;
        return inner;
      }
    }
    /* Cinder Strike: "It deals 4 damage to that creature instead if this
       spell's additional cost was paid" — the same as "If …, … instead" */
    const lateIf = !depth && s.match(/^(.+?) instead if (.+?)\.?$/i);
    if (lateIf) {
      const inner = parseEffectSentence('If ' + lateIf[2] + ', ' + lateIf[1].charAt(0).toLowerCase() + lateIf[1].slice(1) + ' instead.', 1);
      // the rider is folded into the sentence before it, as "If …, … instead" is
      if (inner && inner.op === 'noop' && (inner.insteadOf || inner.insteadRider)) { inner.text = s; return inner; }
    }
    /* Pest Infestation, Heliod's Intervention: "twice X" — read with X, then doubled */
    if (!depth && /\b(?:twice|two times) X\b/.test(s) && !/\bwhere X\b/.test(s)) {
      const inner = parseEffectSentence(s.replace(/\b(?:twice|two times) X\b/g, 'X'), 1);
      if (inner && inner.op !== 'manual' && !hasManualStep(inner) && fillX(inner, { xTimes: 2 })) { inner.text = s; return inner; }
    }
    // Laccolith Whelp: "have it deal damage equal to its power to target creature"
    const hi = !depth && s.match(/^Have (it|CARDNAME|this creature) (deal|gain|fight) (.+)$/i);
    if (hi) {
      const inner = parseEffectSentence((/^it$/i.test(hi[1]) ? 'It' : 'CARDNAME') + ' ' + hi[2].toLowerCase() + 's ' + hi[3], 1);
      if (inner && inner.op !== 'manual' && !hasManualStep(inner)) { inner.text = s; return inner; }
    }
    // Duelist's Heritage: "have target attacking creature gain double strike"; "have target player mill two cards"
    const hv = !depth && s.match(/^Have (target [a-z ]+?) (gain|mill|draw|lose|discard|sacrifice) (.+)$/i);
    if (hv) {
      const inner = parseEffectSentence(U.titleCase(hv[1].charAt(0)) + hv[1].slice(1) + ' ' + hv[2].toLowerCase() + 's ' + hv[3], 1);
      if (inner && inner.op !== 'manual' && !hasManualStep(inner)) { inner.text = s; return inner; }
    }
    /* "…and you may return up to one target creature card": the half of a
       compound sentence that is a choice of its own. */
    const may = !depth && s.match(/^You may (?!pay\b|cast\b|play\b|have\b|spend\b|choose\b|activate\b)(.+)$/);
    if (may) {
      const inner = parseEffectSentence(U.titleCase(may[1].charAt(0)) + may[1].slice(1), 1);
      if (inner && inner.op !== 'manual') return { op: 'may', then: [inner], text: s };
    }
    /* "Put a +1/+1 counter on a creature you control": the creature is
       chosen as this happens, not targeted. Read as the targeted sentence
       would be, the target becomes a generic question (docs/choices.md):
       the same kind of thing, picked without targeting it. Only for what
       helps whatever is picked, so choosing and targeting differ in
       nothing but the word. */
    const pick = !depth && !/\b(?:target|each|all|another|other)\b/i.test(s) &&
      s.match(/^(.*?\b)an? ((?:[a-z]+ )?(?:creature|artifact|enchantment|land|planeswalker|permanent)) (you control)\b(.*)$/i);
    if (pick) {
      const again = parseEffectSentence(pick[1] + 'target ' + pick[2] + ' ' + pick[3] + pick[4], 1);
      // a counter that helps: +1/+1, or a keyword one (Titan of Industry's shield counter)
      const helps = again && ((again.op === 'counters' && /^(?:\+|shield|flying|indestructible|lifelink|deathtouch|trample|vigilance|first strike|double strike|hexproof|menace|reach|haste)/.test(String(again.kind || ''))) ||
        again.op === 'pump' || again.op === 'grantKeyword' || again.op === 'untap');
      if (helps && (again.targets || []).length === 1 && !again.scope) {
        const spec = again.targets[0];
        delete again.targets;
        again.chooseFrom = spec;
        again.text = s;
        return again;
      }
    }
    return null;
  }

  /* Idioms that span more than one sentence. Matched against the whole
     cleaned text before it is split up, because splitting them loses the link
     between the halves ("You may discard a card. If you do, draw a card."). */
  /* Voting (CR 701.38): each player, starting with you, votes for one of two
     words; the words with the votes decide what happens */
  const voteBody = (t) => {
    const pe = parseSentenceList(splitSentences(t.charAt(0).toUpperCase() + t.slice(1).replace(/\.?$/, '.')));
    return pe.auto && pe.effects.length ? pe.effects : null;
  };
  const COMBO_RULES = [
    // Duneblast, Mount Doom: "Choose up to one creature. Destroy the rest."; Divine Reckoning: each player's own
    { re: /^Choose up to (one|two|three) creatures?(?:, then|\. Destroy) (?:destroy )?the rest\.?$/i,
      make: (m) => [{ op: 'keepDestroyRest', n: num(m[1]), who: 'you' }] },
    { re: /^Each player chooses (a|one|two) creatures? they control\. Destroy the rest\.?$/i,
      make: (m) => [{ op: 'keepDestroyRest', n: num(m[1]), who: 'each' }] },
    // Peer into the Abyss: two halves, rounded up
    { re: /^Target player draws cards equal to half the number of cards in their library and loses half their life\. Round up each time\.?$/i,
      make: () => [{ op: 'draw', who: 'target', n: { halfLibrary: 'target', up: true }, targets: [{ type: 'player' }] },
        { op: 'loseLife', who: 'target', n: { halfLife: 'target', up: true } }] },
    // Plea for Power, Tyrant's Choice: "If A gets more votes, …. If B gets more votes or the vote is tied, …."
    { re: /^Starting with you, each player votes for ([a-z]+) or ([a-z]+)\. If \1 gets more votes, (.+?)\. If \2 gets more votes or the vote is tied, (.+?)\.?$/i,
      make: (m) => { const a = voteBody(m[3]), b = voteBody(m[4]); return a && b ? [{ op: 'vote', choices: [m[1], m[2]], mode: 'most', thenA: a, thenB: b, tieB: true }] : null; } },
    // Tivit, Capital Punishment: "For each A vote, …. For each B vote, …."
    { re: /^Starting with you, each player votes for ([a-z]+) or ([a-z]+)\. For each \1 vote, (.+?)\. For each \2 vote, (.+?)\.?$/i,
      make: (m) => { const a = voteBody(m[3]), b = voteBody(m[4]); return a && b ? [{ op: 'vote', choices: [m[1], m[2]], mode: 'each', thenA: a, thenB: b }] : null; } },
    // Council's Judgment
    { re: /^Starting with you, each player votes for an? (nonland permanent|creature|permanent) you don'?t control\. (Exile|Destroy) each (?:permanent|creature) with the most votes or tied for most votes\.?$/i,
      make: (m) => [{ op: 'voteObjects', words: m[1].toLowerCase(), notYours: true, then: m[2].toLowerCase() }] },
    // Syphon Mind: "Each other player discards a card. You draw a card for each card discarded this way."
    { re: /^Each (?:other player|opponent) discards a card\. You draw a card for each card discarded this way\.?$/i,
      make: () => [{ op: 'syphonMind' }] },
    // Hydroid Krasis: "you gain half X life and draw half X cards. Round down each time."
    { re: /^You gain half X life and draw half X cards\. Round (down|up) each time\.?$/i,
      make: (m) => [{ op: 'gainLife', who: 'you', n: { half: 'X', up: /up/i.test(m[1]) } }, { op: 'draw', who: 'you', n: { half: 'X', up: /up/i.test(m[1]) } }] },
    /* Run Away Together: "Choose two target creatures controlled by
       different players. Return those creatures to their owners' hands." */
    { re: /^Choose two target (creatures|permanents|nonland permanents) controlled by different players\. Return those (?:creatures|permanents) to their owners'? hands\.?$/i,
      make: (m) => {
        const one = () => Object.assign(targetSpec('target ' + m[1].replace(/s$/, '')), { differentControllers: true });
        return [{ op: 'bounce', targets: [one(), one()] }];
      } },
    /* Circle of Protection, Pentagram of the Ages, Deflecting Palm: "The
       next time a (red) source of your choice would deal damage to you this
       turn, prevent that damage." — and what follows from it */
    { re: /^The next time an? (?:(white|blue|black|red|green) )?source of your choice would deal damage to you this turn, prevent that damage\.(?: (You gain life equal to the damage prevented this way|If damage is prevented this way, (?:CARDNAME|this spell) deals that much damage to that source'?s controller)\.)?$/i,
      make: (m) => [Object.assign({ op: 'preventSourceOnce' },
        m[1] ? { color: { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' }[m[1].toLowerCase()] } : {},
        m[2] && /gain life/i.test(m[2]) ? { gainLife: true } : {}, m[2] && /deals that much/i.test(m[2]) ? { reflect: true } : {})] },
    /* Sword of Wealth and Power: "Create a Treasure token. When you next
       cast an instant or sorcery spell this turn, copy that spell. …" —
       what comes first, then the turn's trigger */
    { re: /^((?:[^.]+\.\s+)+?)(When you next cast [^,"]+? this turn, [\s\S]+)$/i,
      make: (m) => {
        const pre = parseSentenceList(splitSentences(m[1].trim()));
        const e = turnTrigger(m[2]);
        return pre.auto && e ? [...pre.effects, e] : null;
      } },
    /* "Reveal cards from the top of your library until you reveal a
       creature card. Put that card into your hand and the rest on the
       bottom of your library in a random order." Dig until one fits (or
       two, or X); "Its controller reveals …" after a Polymorph. */
    { re: /^((?:[^.]+\.\s+)*?)((?:(?:Its|That creature'?s) controller|That player|Defending player|Target player|Each opponent)? ?[Rr]eveals? cards from the top of (?:your|their) library until (?:you|they) reveal [^.]+(?:\.\s+(?:Put|The player puts|That player puts)[^.]+)?\.?)(?:\s+([\s\S]+))?$/,
      make: (m) => {
        const e = revealUntilOf(m[2]);
        if (!e) return null;
        // what comes before (Polymorph's "Destroy target creature.") and after (Skyserpent Seeker's counter)
        const pre = m[1] && m[1].trim() ? parseSentenceList(splitSentences(m[1].trim())) : { effects: [], auto: true };
        const post = m[3] && m[3].trim() ? parseSentenceList(splitSentences(m[3].trim())) : { effects: [], auto: true };
        if (!pre.auto || !post.auto) return null;
        return [...pre.effects, e, ...post.effects];
      } },
    /* Disciple of Bolas: "Sacrifice another creature. You gain X life and
       draw X cards, where X is that creature's power." — the sacrifice
       happens first, so its power is known */
    { re: /^Sacrifice (another )?creature\. You gain X life and draw X cards, where X is that creature'?s power\.?$/i,
      make: (m) => [{ op: 'sacThen', filter: 'creature', other: !!m[1], then: [
        { op: 'gainLife', who: 'you', n: { ofSacrificed: 'power' } }, { op: 'draw', who: 'you', n: { ofSacrificed: 'power' } }] }] },
    // Astral Cornucopia: "Choose a color. Add one mana of that color for each charge counter on this artifact."
    { re: /^Choose a colou?r\. Add one mana of that colou?r for each ([a-z]+) counter on (?:this (?:artifact|creature|permanent|land)|CARDNAME)\.?$/i,
      make: (m) => [{ op: 'addManaX', x: 'counters', counter: m[1].toLowerCase() }] },
    // Eldrazi Monument: "Sacrifice a creature. If you can't, sacrifice this artifact."
    { re: /^Sacrifice an? (creature|artifact|land|permanent)\. If you can'?t, sacrifice (?:this (?:artifact|creature|enchantment|permanent)|CARDNAME)\.?$/i,
      make: (m) => [{ op: 'sacOrSelf', filter: m[1].toLowerCase() }] },
    /* Tezzeret, Cruel Captain: "Untap target artifact or creature. If it's
       an artifact creature, put a +1/+1 counter on it." — the target */
    { re: /^Untap (target (?:artifact or creature|creature|artifact|permanent))\. If it'?s an? (artifact creature|creature|artifact), put a \+1\/\+1 counter on it\.?$/i,
      make: (m) => [{ op: 'untap', targets: [targetSpec(m[1])] },
        { op: 'ifLastWas', ofTarget: true, filter: m[2].toLowerCase(), then: [{ op: 'counters', kind: '+1/+1', n: 1, scope: 'lastTarget' }] }] },
    /* Great Train Heist: "Choose target opponent. Whenever a creature you
       control deals combat damage to that player this turn, …" — a turn's
       trigger that watches the one player */
    { re: /^Choose target opponent\. (Whenever [^,"]+?) to that player this turn, ([^"]+)$/i,
      make: (m) => {
        const e = turnTrigger(m[1] + ' to an opponent this turn, ' + m[2]);
        return e ? [Object.assign(e, { targets: [{ type: 'player', opponent: true }], onlyTarget: true })] : null;
      } },
    // a triggered ability for the rest of the turn (Jace Reawakened, Bonus Round)
    { re: /^(?:Until end of turn|This turn), whenever [\s\S]+$|^(?:Whenever|At the beginning of) [^,"]+? this turn, [\s\S]+$|^When you next cast [^,"]+? this turn, [\s\S]+$|^When you cast your next [^,"]+? this turn, [\s\S]+$/i,
      make: (m) => { const e = turnTrigger(m[0]); return e ? [e] : null; } },
    /* Final Showdown: "Choose a creature you control. It gains indestructible
       until end of turn." Chosen, not targeted: read as the targeted
       sentence would be, then asked as a generic question. */
    /* Season of Weaving: "Choose an artifact or creature you control.
       Create a token that's a copy of it." */
    { re: /^Choose an? (artifact or creature|creature|artifact|nonland permanent|permanent) you control\. Create a token that'?s a copy of it\.?$/i,
      make: (m) => {
        const spec = targetSpec('target ' + m[1] + ' you control');
        if (!spec || spec.unknown) return null;
        delete spec.upTo;
        return [{ op: 'copyPermanent', n: 1, grant: [], scope: 'lastTarget', chooseFrom: spec }];
      } },
    { re: /^Choose an? ((?:[a-z]+ )?(?:creature|artifact|permanent)) you control\. (?:It|That creature) (gains|gets) ([^.]+)\.?$/i,
      make: (m) => {
        const again = parseEffectSentence('Target ' + m[1] + ' you control ' + m[2] + ' ' + m[3] + '.', 1);
        if (!again || !(again.op === 'pump' || again.op === 'grantKeyword') || (again.targets || []).length !== 1 || again.scope) return null;
        again.chooseFrom = again.targets[0];
        delete again.targets;
        return [again];
      } },
    /* Eldritch Evolution: "with mana value X or less, where X is 2 plus the sacrificed creature's mana value" */
    { re: /^Search your library for an? ([a-z ]+?) card with mana value X or less, where X is (one|two|three|\d+) plus the sacrificed creature'?s mana value\. Put that card onto the battlefield, then shuffle\.( Exile CARDNAME\.)?$/i,
      make: (m) => [{ op: 'tutor', n: 1, filter: m[1].toLowerCase(), to: 'battlefield', maxMv: { ofSacrificed: 'mv', plus: num(m[2]) },
        prompt: 'Search your library for a ' + m[1].toLowerCase() + ' card.' }].concat(m[3] ? [{ op: 'exileSelf' }] : []) },
    /* Emry, Conduit of Worlds: a card from the graveyard, castable this turn */
    { re: /^Choose target ([a-z ]+?) card in your graveyard\. (?:You may cast that card this turn|If you haven'?t cast a spell this turn, you may cast that card)\.?$/i,
      make: (m) => [{ op: 'mayCastFromGraveyard', targets: [Object.assign(targetSpec('target ' + m[1]), { zone: 'graveyard', controller: 'you' })] }] },
    /* Expressive Iteration */
    { re: /^Look at the top three cards of your library\. Put one of them into your hand, put one of them on the bottom of your library, and exile one of them\. You may play the exiled card this turn\.?$/i,
      make: () => [{ op: 'lookAt', n: 3, keep: 0 },
        { op: 'takeFromLooked', n: 1, filter: 'any', to: 'hand', rest: 'keep' },
        { op: 'takeFromLooked', n: 1, filter: 'any', to: 'exile', rest: 'bottom', playable: true }] },
    /* Forbidden Alchemy, Professor Onyx */
    { re: /^Look at the top (\w+) cards of your library\. Put (one|two|three) of them into your hand and the (?:rest|other|others) into your graveyard\.?$/i,
      make: (m) => [{ op: 'lookAt', n: num(m[1]), keep: 0 }, { op: 'takeFromLooked', n: num(m[2]), filter: 'any', to: 'hand', rest: 'graveyard' }] },
    { re: /^[Dd]iscard a card\. If you do, draw a card\.?$/, make: () => [{ op: 'rummage' }] },
    /* Grisly Salvage: "Reveal the top five cards of your library. You may put
       a creature or land card from among them into your hand. Put the rest
       into your graveyard." */
    { re: /^(?:Reveal|Look at) the top (\w+) cards of your library\. You may put an? ([a-z ]+?) card from among them into your hand\. Put the rest into your graveyard\.?$/i,
      make: (m) => [{ op: 'lookAt', n: num(m[1]), keep: 0 }, { op: 'takeFromLooked', n: 1, filter: m[2].trim().toLowerCase(), to: 'hand', rest: 'graveyard' }] },
    /* "Look at the top card of your library. If it's a creature card, you
       may reveal it and put it into your hand." */
    { re: /^(?:Look at|Reveal) the top card of your library\. If it'?s an? ([a-z ]+?) card, (you may )?(?:reveal it and )?put it (into your hand|onto the battlefield)( tapped)?\.(?: Otherwise, (draw a card|you may put (?:it|that card) (?:into your graveyard|on the bottom of your library))\.)?$/i,
      make: (m) => {
        const otherwise = !m[5] ? null : /^draw/i.test(m[5]) ? [{ op: 'draw', n: 1, who: 'you' }]
          : [{ op: 'mayMoveLooked', to: /graveyard/i.test(m[5]) ? 'graveyard' : 'bottom' }];
        return [{ op: 'lookAt', n: 1, keep: 0 },
          Object.assign({ op: 'takeFromLooked', n: 1, filter: m[1].trim().toLowerCase(), to: /hand/i.test(m[3]) ? 'hand' : 'battlefield', rest: 'keep' },
            m[2] ? {} : { mustTake: true }, m[4] ? { tapped: true } : {}, otherwise ? { otherwise } : {})];
      } },
    /* Midnight Tilling: "Mill four cards, then you may return a permanent
       card from among them to your hand." */
    { re: /^Mill (two|three|four|five|six|\d+) cards(?:, then|\. Then|\.) (you may )?(?:put|return) (?:a|an) ([a-z, ]*?)card from among (?:them|the milled cards|the cards milled this way) (?:into|to) your hand\.?$/i,
      make: (m) => [{ op: 'mill', n: num(m[1]), who: 'you' },
        { op: 'takeFromMilled', n: 1, filter: m[3].replace(/,? or /g, ' or ').replace(/, /g, ' or ').trim() || 'any', optional: !!m[2] }] },
    /* Fable of the Mirror-Breaker: "You may discard up to two cards. If you
       do, draw that many cards." */
    { re: /^You may discard up to (one|two|three|four|\d+) cards?\. If you do, draw that many cards\.?$/i,
      make: (m) => [{ op: 'discardUpToDraw', n: num(m[1]) }] },
    /* Dig Through Time, Stock Up */
    { re: /^Look at the top (\w+) cards of your library\. Put (two|three) of them into your hand and the rest on the bottom of your library in (?:any|a random) order\.?$/i,
      make: (m) => [{ op: 'lookAt', n: num(m[1]), keep: 0 }, { op: 'takeFromLooked', n: num(m[2]), filter: 'any', to: 'hand', rest: 'bottom' }] },
    { re: /^Each player sacrifices an? (creature or planeswalker|creature|artifact or creature) of their choice\. Each player who can'?t discards a card\.?$/i,
      make: (m) => [{ op: 'sacrificeChoice', who: 'each', n: 1, filter: m[1].toLowerCase(), orDiscard: true }] },
    /* Dauthi Voidwalker */
    { re: /^Choose an exiled card an opponent owns with an? ([a-z]+) counter on it\. You may play it this turn without paying its mana cost\.?$/i,
      make: (m) => [{ op: 'playExiledFree', counter: m[1].toLowerCase() }] },
    /* Coiling Oracle, Risen Reef, Explorer's Scope: the top card, onto the
       battlefield if it is a land, and perhaps into the hand if not */
    { re: /^(?:Look at|Reveal) the top card of your library\. If it'?s a land card, (you may )?put it onto the battlefield( tapped)?\.(?: (If you don'?t put the card onto the battlefield|Otherwise), put (?:it|that card) into your hand\.)?$/i,
      make: (m) => [{ op: 'topLand', may: !!m[1], tapped: !!m[2], elseHand: !!m[3] }] },
    /* Urza's Tower and its partners: more mana with the whole set out */
    { re: /^Add \{C\}\. If you control an Urza'?s ([A-Za-z-]+) and an Urza'?s ([A-Za-z-]+), add (\{C\}(?:\{C\})+) instead\.?$/i,
      make: (m) => [{ op: 'addMana', symbols: ['C'],
        tron: { names: [m[1], m[2]].map(x => "urza's " + x.toLowerCase().replace(/-/g, ' ')), symbols: MANA.parse(m[3]) } }] },
    /* The Enduring creatures of Duskmourn: back as an enchantment, and only
       ever once as a creature */
    { re: /^[Ii]f it was a creature, return it to the battlefield under its owner'?s control\. It'?s an enchantment\.?$/,
      make: () => [{ op: 'returnAsEnchantment' }] },
    /* Pact of Negation: the bill comes next turn. */
    { re: /^At the beginning of your next upkeep, pay ((?:\{[^}]+\})+)\. If you don'?t, you lose the game\.?$/i,
      make: (m) => [{ op: 'delayed', event: 'yourUpkeep', forPlayer: 'you', nextTurn: true, name: 'Pay ' + m[1] + ' or lose the game',
        effects: [{ op: 'unlessPays', who: 'you', cost: m[1], prompt: 'Pay ' + m[1] + '? If you don\'t, you lose the game.', then: [{ op: 'loseGame' }] }] }] },
    /* The reveal-or-tapped lands: "you may reveal an Elf card from your
       hand. If you don't, CARDNAME enters tapped." Revealing costs
       nothing, so the table does it whenever it can. */
    { re: /^[Yy]ou may reveal an? ([A-Za-z]+)(?: or an? ([A-Za-z]+))? card from your hand\. If you don'?t, CARDNAME enters(?: the battlefield)? tapped\.?$/i,
      make: (m) => [{ op: 'etbTappedUnlessReveal',
        types: [m[1], m[2]].filter(Boolean).map(x => x.toLowerCase()) }] },
    { re: /^[Yy]ou may reveal an? ([A-Za-z]+) card from your hand\. CARDNAME enters(?: the battlefield)? tapped unless you revealed an? [A-Za-z]+ card this way or you control an? ([A-Za-z]+)\.?$/i,
      make: (m) => [{ op: 'etbTappedUnlessReveal', types: [m[1].toLowerCase()],
        orControl: m[2].toLowerCase() }] },
    { re: /^You may discard a card\. If you do, draw a card\.?$/i,
      make: () => [{ op: 'drawDiscard', n: 1, discard: 1 }] },
    { re: /^Target (?:opponent|player) reveals their hand\. You choose an? ([a-z][a-z, -]*?) card from it\. (?:Exile that card|That player discards that card)\.?$/i,
      make: (m) => [{ op: 'handAttack', filter: m[1].replace(/,/g, ' ').toLowerCase(),
        to: /Exile that card/i.test(m[0]) ? 'exile' : 'graveyard', targets: [{ type: 'player' }] }] },
    /* a search whose answer goes on top of the library, which is two sentences
       on every card that does it */
    { re: /^(?:You may )?[Ss]earch your library for (?:a|an|up to one) ([-a-z' ]*?)cards?(?: and reveal (?:it|that card))?\. Shuffle(?: your library)?,? (?:and )?(?:then )?put (?:it|that card|the card) on top of it\.?$/i,
      make: (m) => [{ op: 'tutor', n: 1, filter: (m[1] || '').trim().toLowerCase() || 'any', to: 'top' }] },
    { re: /^(?:You may )?[Ss]earch your library for (?:a|an|up to one) ([-a-z' ]*?)cards?(?: and reveal (?:it|that card))?\. (?:Then shuffle|Shuffle)(?: your library)?\. Put (?:it|that card|the card) on top of it\.?$/i,
      make: (m) => [{ op: 'tutor', n: 1, filter: (m[1] || '').trim().toLowerCase() || 'any', to: 'top' }] },
    /* look at a few, keep one, bury the rest */
    { re: /^Look at the top (\w+) cards? of your library\. Put one of them into your hand and the (?:rest|other) on the bottom of your library(?: in any order| in a random order)?\.?$/i,
      make: (m) => [{ op: 'lookAt', n: num(m[1]), keep: 0 },
        { op: 'takeFromLooked', n: 1, filter: 'any', to: 'hand', rest: 'bottom' }] },
    { re: /^Look at the top (\w+) cards? of your library\. Put one of them into your hand, (?:put )?one of them on the bottom of your library, and exile one of them\.?$/i,
      make: (m) => [{ op: 'lookAt', n: num(m[1]), keep: 0 },
        { op: 'takeFromLooked', n: 1, filter: 'any', to: 'hand', rest: 'keep' },
        { op: 'takeFromLooked', n: 1, filter: 'any', to: 'exile', rest: 'bottom' }] },
    { re: /^Look at the top card of your library\. You may put (?:it|that card) into your graveyard\.?$/i,
      make: () => [{ op: 'surveil', n: 1 }] },
    { re: /^Exile the top (?:(\w+) )?cards? of your library\. Until the end of your next turn, you may play (?:that card|them|those cards)\.?$/i,
      make: (m) => [{ op: 'impulse', n: m[1] ? num(m[1]) : 1, play: true }] },
    { re: /^Exile the top (?:(\w+) )?cards? of your library\. You may play (?:that card|them|those cards) this turn\.?$/i,
      make: (m) => [{ op: 'impulse', n: m[1] ? num(m[1]) : 1, play: true, duration: 'eot' }] },
    { re: /^Destroy target creature\. Its controller (?:loses|gains) (\w+) life\.?$/i,
      make: (m) => [{ op: 'destroy', targets: [{ type: 'creature' }] },
        { op: 'loseLife', n: num(m[1]), who: 'targetController' }] },
    { re: /^Draw a card\. You lose (\w+) life\.?$/i,
      make: (m) => [{ op: 'draw', n: 1, who: 'you' }, { op: 'loseLife', n: num(m[1]), who: 'you' }] },
  ];

  /** Split an ability's effect text into sentences and parse each. */
  /* ---------------- modal spells ----------------
     "Choose one —" and its relatives. The modes are bullet lines, so this has
     to happen before the text is cut into sentences. */
  const MODE_COUNT = {
    one: 1, two: 2, three: 3, four: 4,
    'one or more': 1, 'one or both': 1, 'two or more': 2,
    'up to one': 1, 'up to two': 2, 'up to three': 3, 'up to four': 4,
  };

  function parseModal(cleaned) {
    /* Monument to Endurance: "choose one that hasn't been chosen (this turn)" —
       each mode once, for good or until the turn ends */
    const nc = cleaned.match(/^Choose one that hasn'?t been chosen( this turn)?(?:\.|\s*[-\u2014]+)\s*([\s\S]*)$/i);
    if (nc) {
      const inner = parseModal('Choose one \u2014 ' + nc[2]);
      if (inner) inner.effects[0].notChosen = nc[1] ? 'turn' : 'ever';
      return inner;
    }
    const m = cleaned.match(/^Choose ([a-z ]+?)(?:\.|\s*[-\u2014]+)\s*([\s\S]*)$/i);
    if (!m) return null;
    const word = m[1].trim().toLowerCase().replace(/^(one|two|three|four) or more$/, '$1 or more');
    const count = MODE_COUNT[word];
    if (!count) return null;
    let rest = m[2].replace(/(^|\n)\*\s+/g, '$1\u2022 ');
    const repeatable = /same mode more than once/i.test(rest);
    /* "Choose one - A; or B; or C." puts the modes in one sentence. */
    if (!/\u2022/.test(rest) && /;\s*or\s/i.test(rest)) {
      rest = '\u2022 ' + rest.replace(/;\s*or\s+/gi, '\n\u2022 ');
    }
    const bullets = rest.split(/\s*\u2022\s*/).map(x => x.trim()).filter(Boolean);
    // the first chunk may be the "you may choose the same mode" note, not a mode
    /* "If you control a commander as you cast this spell, you may choose
       both instead." — the Will cycle: a note on how many, not a mode. */
    let commanderCount = null, otherCount = null;
    const modes = bullets.filter(b => {
      if (/^You may choose the same mode/i.test(b)) return false;
      const cm = b.match(/^If you control a commander as you cast this spell, you may choose (both|any number|two|three)(?: of them)? instead\.?$/i);
      if (cm) { commanderCount = /both|two/i.test(cm[1]) ? 2 : /three/i.test(cm[1]) ? 3 : 99; return false; }
      /* Flame of Anor: "If you control a Wizard as you cast this spell,
         you may choose two instead." The same note, about something else. */
      const om = b.match(/^If (.+?) as you cast this spell, you may choose (both|any number|two|three)(?: of them)? instead\.?$/i);
      const oc = om && condOf(om[1]);
      if (oc) { otherCount = { cond: oc, count: /both|two/i.test(om[2]) ? 2 : /three/i.test(om[2]) ? 3 : 99 }; return false; }
      return true;
    });
    if (modes.length < 2) return null;
    const out = [];
    for (const label of modes) {
      const named = label.match(/^([A-Z][A-Za-z' ,-]{1,40}?) \u2014 ([\s\S]+)$/);
      const body = named ? named[2] : label;
      const parsed = parseEffects(body);
      out.push({ label: label.replace(/\.$/, ''), effects: parsed.effects, auto: parsed.auto });
    }
    return {
      effects: [Object.assign({ op: 'modal', count, repeatable, modes: out, text: cleaned },
        /or more$/.test(word) ? { max: out.length } : {},
        commanderCount ? { countIf: { cond: { kind: 'controlCommander' }, count: commanderCount } } : otherCount ? { countIf: otherCount } : {})],
      auto: out.every(x => x.auto),
    };
  }

  /* ---------------- optional and conditional text ----------------
     "You may X. If you do, Y." is one thought split over two sentences, and
     losing the link between the halves is what used to make it unautomatable.
     A cost the card asks you to pay ("discard a card", "sacrifice a creature",
     "pay 3 life") becomes a real cost, so Y only happens if X actually did. */
  const COST_PHRASES = [
    { re: /^discard (a|one|two|three|\d+) ([a-z ]*?)cards?$/i,
      make: (m) => ({ discard: num(m[1]), filter: (m[2] || '').trim() || 'card' }) },
    { re: /^sacrifice (a|an|one|two|three|\d+) ([-a-z ]+?)$/i,
      make: (m) => ({ sacrifice: { n: num(m[1]), filter: m[2].trim() } }) },
    { re: /^pay (\d+) life$/i, make: (m) => ({ life: +m[1] }) },
    { re: /^blight (\d+)$/i, make: (m) => ({ blight: +m[1] }) },
    // Sarkhan, Dragon Ascendant: "you may behold a Dragon. If you do, …"
    { re: /^behold (a|an) ([A-Za-z -]+?)$/i, make: (m) => ({ behold: { n: 1, filter: m[2].trim().toLowerCase() } }) },
    // the Processors: "put a card an opponent owns from exile into that player's graveyard"
    { re: /^put (a|one|two|three) cards? (?:an opponent owns|your opponents own) from exile into (?:that player'?s|their owners'?) graveyards?$/i,
      make: (m) => ({ process: num(m[1]) }) },
    // Academy Rector: "When this creature dies, you may exile it. If you do, …"
    { re: /^exile (?:it|this card|CARDNAME)(?: from your graveyard)?$/i, make: () => ({ exileSelf: true }) },
    { re: /^exile (a|an|one|two|three) ([a-z ]*?)cards? from your graveyard$/i,
      make: (m) => ({ exileGrave: { n: num(m[1]), filter: (m[2] || '').trim().toLowerCase() || 'card' } }) },
    { re: /^pay (\{[^}]+\}(?:\{[^}]+\})*)$/i, make: (m) => ({ mana: m[1] }) },
    { re: /^pay (\{[^}]+\}(?:\{[^}]+\})*) and (\d+) life$/i, make: (m) => ({ mana: m[1], life: +m[2] }) },
    { re: /^pay (\{[^}]+\}(?:\{[^}]+\})*) and discard a card$/i, make: (m) => ({ mana: m[1], discard: 1, filter: 'card' }) },
    { re: /^remove (a|an|one|two|three|\d+) ([+\-0-9/a-z]+) counters? from (?:it|this creature|CARDNAME|this artifact|this enchantment|this permanent)$/i,
      make: (m) => ({ removeCounter: { n: num(m[1]), kind: m[2].toLowerCase() } }) },
  ];

  function asCost(phrase) {
    const p = String(phrase).trim().replace(/\.$/, '');
    for (const c of COST_PHRASES) { const m = p.match(c.re); if (m) return c.make(m); }
    return null;
  }

  /* Another way to pay for the spell, printed on it: "If you control a
     commander, you may cast this spell without paying its mana cost", "You
     may pay 1 life and exile a blue card from your hand rather than pay this
     spell's mana cost". Returns the alternative, or null for one this cannot
     pay. The engine offers it as one more way to cast the card. */
  function parseAltCost(line) {
    let s = String(line).trim().replace(/\.$/, '');
    let cond = null, m;
    if ((m = s.match(/^If (.+?), (you may .+)$/i))) {
      cond = altCond(m[1]);
      if (!cond) return null;
      s = m[2].charAt(0).toUpperCase() + m[2].slice(1);
    }
    if ((m = s.match(/^(.+?) if (.+)$/i)) && /rather than pay/i.test(m[1])) {
      cond = altCond(m[2]);
      if (!cond) return null;
      s = m[1];
    }
    const alt = { cond };
    if (/^You may cast (?:this spell|CARDNAME) without paying its mana cost$/i.test(s)) {
      alt.mana = ''; alt.label = 'Cast without paying its mana cost';
      return alt;
    }
    m = s.match(/^You may (.+?) rather than pay (?:this spell|CARDNAME)'?s mana cost$/i);
    if (!m) return null;
    const parts = m[1].split(/,? and /i);
    for (const part of parts) {
      let k;
      if ((k = part.match(/^pay ((?:\{[^}]+\})+)$/i))) alt.mana = k[1];
      else if ((k = part.match(/^pay (\d+) life$/i))) alt.life = +k[1];
      else if ((k = part.match(/^exile (a|an|one|two) ([a-z ]+?) cards? from your hand$/i)))
        alt.exileFromHand = { n: num(k[1]), filter: k[2].trim() };
      else if ((k = part.match(/^sacrifice (a|an|one|two|three) ([A-Za-z ]+?)s?$/i)))
        alt.sacrifice = { n: num(k[1]), filter: k[2].trim().toLowerCase() };
      else if ((k = part.match(/^discard (a|an|one|two) ([a-z ]*?)cards?$/i)))
        alt.discard = { n: num(k[1]), filter: k[2].trim() || 'card' };
      // Daze, Gush, the Borderposts: "return an Island you control to its owner's hand"
      else if ((k = part.match(/^return (a|an|one|two) ([A-Za-z ]+?) you control to (?:its|their) owner'?s'? hands?$/i)))
        alt.returnOwn = { n: num(k[1]), filter: k[2].trim().toLowerCase().replace(/ies$/, 'y').replace(/([^s])s$/, '$1') };
      else return null;
    }
    if (alt.mana == null) alt.mana = '';
    alt.label = 'Pay the alternative cost: ' + m[1].replace(/^./, (c) => c.toLowerCase());
    return alt;
  }
  /* The few conditions an alternative cost hangs on. */
  function altCond(phrase) {
    const p = String(phrase).trim();
    if (/^you control a commander$/i.test(p)) return { kind: 'controlCommander' };
    if (/^it'?s not your turn$/i.test(p)) return { kind: 'notYourTurn' };
    if (/^it'?s your turn$/i.test(p)) return { kind: 'yourTurn' };
    let m;
    if ((m = p.match(/^an opponent cast (\w+) or more spells this turn$/i))) return { kind: 'opponentSpells', n: num(m[1]) };
    if ((m = p.match(/^there are (\w+) or more creatures on the battlefield$/i)))
      return { kind: 'control', what: 'creature', n: num(m[1]), who: 'any' };
    return condOf(p);
  }

  /* ---------------- what spells cost ----------------
     "Noncreature spells cost {1} more to cast", "Creature spells you cast of
     the chosen type cost {1} less to cast": a standing change to the price
     of other spells, which the engine adds up as each spell is cast. */
  function parseCostMod(line) {
    let s = String(line).trim().replace(/\.$/, '');
    // Defense Grid: "…cost {3} more to cast except during its controller's turn"
    const offTurn = / except during its controller'?s turn$/i.test(s);
    s = s.replace(/ except during its controller'?s turn$/i, '');
    // Goreclaw: "Creature spells you cast with power 4 or greater cost {2} less to cast"
    const pw = s.match(/ with power (\d+) or greater(?= costs?)/i);
    if (pw) s = s.replace(pw[0], '');
    const m = s.match(/^(?:Each )?([A-Za-z ,]*?)\s*spells? (you cast |your opponents cast |each opponent casts |an opponent casts )?(of the chosen type )?(?:that'?s ([a-z ,]+?) )?costs? \{(\d+|[WUBRG])\} (more|less) to cast$/i);
    if (!m) return null;
    const words = (m[1] + ' ' + (m[4] || '')).replace(/,/g, ' ').trim().toLowerCase()
      .replace(/\band\b/g, 'or');
    for (const w of words.split(/\s+/).filter(Boolean)) {
      if (!/^(?:or|creature|noncreature|artifact|nonartifact|enchantment|instant|sorcery|legendary|historic|white|blue|black|red|green|colorless|multicolored|planeswalker|land|aura|equipment|vehicle|kindred)$/.test(w)) return null;
    }
    if (/historic/.test(words)) return null;
    const who = /opponent/i.test(m[2] || '') ? 'opponents' : /you cast/i.test(m[2] || '') ? 'you' : 'all';
    // Andradite Leech: "Black spells you cast cost {B} more to cast" — coloured mana on top
    if (/^[WUBRG]$/.test(m[5])) {
      if (/less/i.test(m[6]) || m[3] || offTurn || pw) return null;
      return { op: 'costMod', who, words: words || 'spell', chosenType: false, amount: 0, symbols: '{' + m[5] + '}' };
    }
    const amount = (+m[5]) * (/less/i.test(m[6]) ? -1 : 1);
    return Object.assign({ op: 'costMod', who, words: words || 'spell', chosenType: !!m[3], amount }, offTurn ? { offTurn: true } : {},
      pw ? { minPower: +pw[1] } : {});
  }

  /* "This spell costs {1} less to cast for each artifact you control",
     "…if you control a commander", "This spell costs {X} less to cast,
     where X is the greatest power among creatures you control." */
  function parseSelfCost(line) {
    const s = String(line).trim().replace(/\.$/, '');
    let m = s.match(/^(?:This spell|CARDNAME) costs \{(\d+)\} (less|more) to cast for each (.+)$/i);
    if (m) {
      let phrase = m[3].trim();
      const field = / on the battlefield$/i.test(phrase);
      phrase = phrase.replace(/ on the battlefield$/i, '');
      const c = countOf(phrase);
      if (!c) return null;
      if (field && c.scope) c.scope.who = 'all';
      return { amount: (+m[1]) * (/less/i.test(m[2]) ? -1 : 1), per: c };
    }
    m = s.match(/^(?:This spell|CARDNAME) costs \{(\d+)\} (less|more) to cast if (.+)$/i);
    if (m) {
      const cond = altCond(m[3]);
      return cond ? { amount: (+m[1]) * (/less/i.test(m[2]) ? -1 : 1), cond } : null;
    }
    m = s.match(/^(?:This spell|CARDNAME) costs \{X\} less to cast, where X is the (greatest|total) power (?:among|of) (creatures you control)$/i);
    if (m) return { amount: -1, x: /total/i.test(m[1]) ? 'totalPower' : 'greatestPower', scope: scopeOf(m[2]) };
    m = s.match(/^(?:This spell|CARDNAME) costs \{X\} less to cast, where X is the number of (.+)$/i);
    if (m) { const c = countOf(m[1].replace(/s\b/, '')) || countOf(m[1]); return c ? { amount: -1, per: c } : null; }
    return null;
  }

  /* "As an additional cost to cast this spell, sacrifice a creature." A
     price paid as the spell is cast, on top of its mana (CR 601.2f), and
     one the table actually takes rather than reads out. Returns the cost,
     or null for a price this cannot pay by itself. */
  function parseAdditionalCost(line) {
    const m = String(line).match(/^As an additional cost to cast (?:this spell|CARDNAME),\s*(you may )?(.+?)\.?$/i);
    if (!m) return undefined;
    const what = m[2].trim();
    // Plumb the Forbidden: a second sentence about the price is more than a price
    if (/\.\s/.test(what)) return null;
    const optional = !!m[1];
    /* "Pay 5 life or pay {2}", "sacrifice a creature, discard a card, or
       pay 4 life": a choice of prices, made as the spell is cast. Each one
       has to be a price the table can take by itself. ("Sacrifice an
       artifact or creature" is one price, with two kinds of thing.) */
    const parts = what.split(/,? or (?=(?:sacrifice|discard|pay|exile|return|reveal|tap|behold)\b)|, (?=(?:sacrifice|discard|pay|exile|return|reveal|tap|behold)\b)/i);
    if (parts.length < 2 || optional) return oneAdditionalCost(what, optional);
    const choice = [];
    for (const part of parts) {
      const c = oneAdditionalCost(part.trim(), false);
      if (!c) return null;
      delete c.optional;
      c.label = part.trim().replace(/^./, (x) => x.toUpperCase());
      choice.push(c);
    }
    return { choice, optional: false };
  }
  function oneAdditionalCost(what, optional) {
    let k;
    if ((k = what.match(/^pay ((?:\{[^}]+\})+)$/i))) return { mana: k[1], optional };
    if ((k = what.match(/^blight (\d+)$/i))) return { blight: +k[1], optional };
    if ((k = what.match(/^reveal (?:a|an) ([A-Za-z -]+?) card from your hand$/i))) return { reveal: { filter: k[1].trim() }, optional };
    // Lorwyn: "behold a Kithkin" — one you control, or one shown from your hand; "and exile it" takes it too
    if ((k = what.match(/^behold (a|an|one|two|three) ([A-Za-z -]+?)( and exile it)?$/i)))
      return { behold: { n: num(k[1]), filter: k[2].trim().toLowerCase().replace(/s$/, ''), exile: !!k[3] }, optional };
    if ((k = what.match(/^tap (a|an|one|two|three) untapped ([A-Za-z -]+?) you control$/i))) {
      return { tapCreatures: { n: num(k[1]), filter: k[2].trim().replace(/ies$/, 'y').replace(/([^s])s$/, '$1') }, optional };
    }
    if ((k = what.match(/^sacrifice (a|an|one|two|three|X|\d+) (.+)$/i))) {
      const filter = k[2].replace(/^(?:other|another) /i, '').replace(/s$/, '');
      return { sacrifice: { n: num(k[1]), filter, another: /^(?:other|another) /i.test(k[2]) }, optional };
    }
    if ((k = what.match(/^sacrifice another (.+)$/i))) return { sacrifice: { n: 1, filter: k[1], another: true }, optional };
    if ((k = what.match(/^discard (a|an|one|two|three|X|\d+) ([a-z ]*?)cards?$/i)))
      return { discard: { n: num(k[1]), filter: k[2].trim() || 'card' }, optional };
    if (/^discard your hand$/i.test(what)) return { discard: { n: 'all', filter: 'card' }, optional };
    if ((k = what.match(/^pay (X|\d+) life$/i))) return { life: k[1] === 'X' ? 'X' : +k[1], optional };
    if ((k = what.match(/^exile (a|an|one|two|three|X|\d+) ([a-z ]*?)cards? from your graveyard$/i)))
      return { exile: { what: 'graveyard', n: num(k[1]), filter: k[2].trim() || 'card' }, optional };
    if ((k = what.match(/^return (a|an) ([a-z ]+?) you control to its owner'?s hand$/i)))
      return { returnOwn: { n: 1, filter: k[2].trim() }, optional };
    return null;
  }

  /* ---------------- compound sentences ----------------
     "Scry 2, then draw two cards." and "Target player draws two cards and
     loses 2 life." are two effects wearing one sentence. Splitting is only
     safe when both halves parse on their own, so that is the test: try the
     split, and keep it only if both sides came back understood. A half that
     begins with a bare verb inherits the subject of the first half, because
     "loses 2 life" means nothing without knowing who. */
  const COMPOUND_SEPS = [
    /,\s+then\s+/i,
    /,\s+and\s+/i,
    /\s+and\s+then\s+/i,
    /\s+and\s+(?=(?:you|each|target|that|all|they|it)\b)/i,
    // Combat Celebrant: "…and after this phase, there is an additional combat phase"
    /\s+and\s+(?=after this phase\b)/i,
    /\s+and\s+(?=(?:create|draw|put|exile|destroy|return|gain|lose|discard|mill|sacrifice|tap|untap|scry|surveil|amass|proliferate|investigate|connive|add|blight)s?\b)/i,
  ];
  const SUBJECTS = /^(Target player|Target opponent|Target creature'?s? controller|Each opponent|Each player|That player|You)\b/i;

  function tidy(part) {
    let t = String(part).trim().replace(/[.,]$/, '');
    if (!t) return '';
    return t.charAt(0).toUpperCase() + t.slice(1) + '.';
  }

  /* "Any number of target creatures each get +1/+1 and gain indestructible"
     said of one of them: "Target creature gets +1/+1 and gains …" */
  /* "Target creature gets +1/+1 and gains indestructible" read as two
     effects aimed at the same target: the first keeps the target, the rest
     act on what it touched. Returns the effect holding the one target. */
  function sharedTarget(inner) {
    if (!inner) return null;
    if ((inner.targets || []).length === 1) return inner;
    if (inner.op !== 'sequence') return null;
    const list = inner.list || [];
    const key = (e) => JSON.stringify((e.targets || [])[0] || null);
    if (!list.length || list.some(e => (e.targets || []).length !== 1 || key(e) !== key(list[0]))) return null;
    for (const e of list.slice(1)) { delete e.targets; e.scope = 'lastGroup'; }
    return list[0];
  }

  function oneOfThem(one, atStart) {
    if (!atStart) return one;
    return one.replace(/^(target [a-z ',]+?) (?:each )?(get|gain|phase|become|have|can't)\b/i, (x, a, v) => a + ' ' + (/can't/i.test(v) ? v : v === 'have' ? 'has' : v + 's'))
      .replace(/ and (get|gain|have) /, (x, v) => ' and ' + (v === 'have' ? 'has' : v + 's') + ' ')
      .replace(/^t/, 'T');
  }

  /** Every X in an effect made the number a "where X is …" names; how many there were. */
  function fillX(eff, k) {
    let used = 0;
    const sub = (o) => {
      if (!o || typeof o !== 'object') return;
      for (const key of Object.keys(o)) {
        if (key === 'text') continue;
        // a target's "mana value X" is the cast X; a count put there could not be checked (Spellstutter Sprite)
      if (o[key] === 'X' && /^(?:mv|maxMv|minMv)$/.test(key)) { used = -1e9; continue; }
      if (o[key] === 'X' && key !== 'pt') { o[key] = k; used++; }
        // "+X/+0", "-X/-0": the sign kept, the number from the rider
        else if (o[key] && (o[key].posX || o[key].negX) && !o[key].by) { o[key] = Object.assign({}, o[key], { by: k }); used++; }
        else if (typeof o[key] === 'object') sub(o[key]);
      }
    };
    sub(eff);
    return used > 0 ? used : 0;
  }

  function parseCompound(sentence) {
    /* "You gain X life and draw X cards, where X is …": both halves read
       with X in them, and the rider fills in both. */
    const wx = sentence.match(/^(.+?), where X is ([^,]+?)\.?$/);
    if (wx && !/bwhere Xb/.test(wx[1])) {
      const k = amountOf(wx[2]);
      const both = k && parseCompound(wx[1] + '.');
      if (both && both.every(x => x.op !== 'manual' && !hasManualStep(x))) {
        const used = both.map(x => fillX(x, k));
        if (used.some(Boolean)) return both;
      }
      return null;
    }
    for (const sep of COMPOUND_SEPS) {
      const parts = sentence.split(sep);
      if (parts.length !== 2) continue;
      const left = tidy(parts[0]);
      let rightRaw = parts[1];
      const a = parseEffectSentence(left);
      if (!a) continue;
      /* "Target player draws two cards and loses 2 life": the second half
         has no subject of its own, so it borrows the first half's. Read on
         its own it would mean that *you* lose the life. */
      const subj = (left.match(SUBJECTS) || [])[1];
      const bareVerb = /^(?:loses?|gains?|draws?|discards?|mills?|sacrifices?|creates?|shuffles?|puts?|returns?|exiles?|reveals?|searches?|gets?|takes?|scrys?|surveils?)\b/i.test(rightRaw.trim());
      let b = null;
      let lent = false;
      if (subj && bareVerb && !/^you$/i.test(subj)) { b = parseEffectSentence(tidy(subj + ' ' + rightRaw.trim())); lent = !!b; }
      if (!b) b = parseEffectSentence(tidy(rightRaw));
      if (!b && subj) { b = parseEffectSentence(tidy(subj + ' ' + rightRaw.trim())); lent = !!b; }
      /* The borrowed "target player" is the same player, not a second
         one to choose. */
      if (b && lent && /^target/i.test(subj) && b.targets) delete b.targets;
      if (b) return [a, b];
    }
    return null;
  }

  /** Parse a list of sentences, joining the ones that belong together. */
  function parseSentenceList(sentences) {
    const effects = [];
    let auto = sentences.length > 0;
    const parseOne = (s) => {
      // a sentence the vocabulary knows whole beats any way of cutting it up
      const e = parseEffectSentence(s);
      // a rule may read one sentence as several steps, handed back as a list
      if (e) return Array.isArray(e) ? e.map(x => Object.assign(x, { text: x.text || s })) : [e];
      const compound = parseCompound(s);
      if (compound) return compound;
      // not read: a manual step, unless a later fold finds it a home
      return [{ op: 'manual', text: s }];
    };

    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i];
      const next = sentences[i + 1] || '';

      /* "That player may pay {2}. If the player doesn't, you create a
         Treasure token." — somebody else's choice, with a price on it. */
      const theyMay = s.match(/^(That player|They|Its controller|Target opponent|That spell'?s controller) may pay ((?:\{[^}]+\})+|\d+ life)\.$/i);
      const theyDont = next.match(/^If (?:the player|they|that player|he or she|its controller) (?:doesn'?t|don'?t|does not|do not),?\s*(.+)$/i);
      if (theyMay && theyDont) {
        const rest = U.titleCase(theyDont[1].charAt(0)) + theyDont[1].slice(1);
        const inner = parseSentenceList(splitSentences(rest));
        const cost = /life$/i.test(theyMay[2]) ? { life: parseInt(theyMay[2], 10) } : theyMay[2];
        effects.push({ op: 'unlessPays', who: 'target', cost, then: inner.effects, text: s + ' ' + next });
        if (!inner.auto) auto = false;
        i++;
        continue;
      }

      // "You may X. If you do, Y."
      // Ripples of Undeath: "Then you may pay {1} and 3 life. If you do, …"
      const may = s.match(/^(?:Then )?You may (.+?)\.$/i);
      /* "When you do" (a reflexive trigger, CR 603.12) is read as "if you
         do": what follows happens once the choice is made and paid for */
      // (not "If you don't", which is its own sentence)
      const ifDo = next.match(/^(?:If|When) you do(?![a-z'’]),?\s*(.+)$/i);
      /* "You may sacrifice another creature. If you do, you gain X life and
         draw X cards, where X is that creature's power." The sacrifice is
         asked for as the ability resolves, and X is read off what went. */
      const sacMay = may && ifDo && may[1].match(/^sacrifice (a|an|another) ([a-z ]+?)$/i);
      if (sacMay) {
        let tt = U.titleCase(ifDo[1].charAt(0)) + ifDo[1].slice(1);
        let xv = null;
        const w = tt.match(/^(.*?),? where X is (?:that creature'?s|the sacrificed creature'?s|its) (power|toughness|mana value)\.?$/i);
        if (w) { tt = w[1] + '.'; xv = { ofSacrificed: /mana/i.test(w[2]) ? 'mv' : w[2].toLowerCase() }; }
        const tp = parseSentenceList(splitSentences(tt));
        const swapX = (list) => {
          for (const e of list || []) {
            if (!e || typeof e !== 'object') continue;
            for (const k of Object.keys(e)) if (e[k] === 'X' && xv) e[k] = Object.assign({}, xv);
            for (const k of ['then', 'otherwise', 'list']) if (Array.isArray(e[k])) swapX(e[k]);
          }
        };
        const usesX = JSON.stringify(tp.effects).includes('"X"');
        if (tp.auto && (!usesX || xv)) {
          swapX(tp.effects);
          effects.push({ op: 'may', text: s + ' ' + next, then: [{ op: 'sacThen', filter: sacMay[2].trim(), other: /another/i.test(sacMay[1]), then: tp.effects }] });
          i++;
          continue;
        }
      }
      if (may && ifDo) {
        const cost = asCost(may[1]);
        const thenText = U.titleCase(ifDo[1].charAt(0)) + ifDo[1].slice(1);
        const thenPart = parseSentenceList(splitSentences(thenText));
        if (cost) {
          effects.push({ op: 'mayPay', pay: cost, then: thenPart.effects, text: s + ' ' + next });
          if (!thenPart.auto) auto = false;
        } else {
          const innerText = U.titleCase(may[1].charAt(0)) + may[1].slice(1) + '.';
          const inner = parseSentenceList(splitSentences(innerText));
          effects.push({ op: 'may', then: inner.effects.concat(thenPart.effects), text: s + ' ' + next });
          if (!inner.auto || !thenPart.auto) auto = false;
        }
        i++;                                   // both sentences are accounted for
        continue;
      }

      // "You may pay 2 life. If you don't, it enters tapped."
      const ifDont = next.match(/^If you don'?t,?\s*(.+)$/i);
      if (may && ifDont) {
        const cost = asCost(may[1]);
        const elseText = U.titleCase(ifDont[1].charAt(0)) + ifDont[1].slice(1);
        const elsePart = parseSentenceList(splitSentences(elseText));
        if (cost) {
          effects.push({ op: 'mayPay', pay: cost, then: [], otherwise: elsePart.effects, text: s + ' ' + next });
          if (!elsePart.auto) auto = false;
          i++;
          continue;
        }
      }

      // "... unless <someone> pays <cost>."
      const unless = s.match(/^(.+?) unless (its controller|that player|they|you|target player|this creature's controller) pays? (\{[^}]+\}(?:\{[^}]+\})*|\d+ life)\.?$/i) ||
        // Painful Quandary: "…unless they discard a card"
        s.match(/^(.+?) unless (that player|they|target player) (discards?) a card\.?$/i);
      if (unless) {
        const inner = parseSentenceList(splitSentences(unless[1].trim() + '.'));
        const cost = /^discard/i.test(unless[3]) ? { discard: 1 } : /life$/i.test(unless[3]) ? { life: parseInt(unless[3], 10) } : unless[3];
        effects.push({ op: 'unlessPays', who: /^you$/i.test(unless[2]) ? 'you'
            : /that player|target player|they/i.test(unless[2]) ? 'target' : 'spellController',
          cost, then: inner.effects, text: s });
        if (!inner.auto) auto = false;
        continue;
      }

      // a bare "You may X." with no follow-on
      const bareMay = s.match(/^You may (.+?)\.$/i);
      if (bareMay && !asCost(bareMay[1])) {
        const innerText = U.titleCase(bareMay[1].charAt(0)) + bareMay[1].slice(1) + '.';
        const inner = parseSentenceList(splitSentences(innerText));
        if (inner.auto) { effects.push({ op: 'may', then: inner.effects, text: s }); continue; }
      }

      effects.push(...parseOne(s));
    }
    const folded = foldRiders(effects);
    /* Miraculous Recovery: "Return target creature card … to the
       battlefield. Put a +1/+1 counter on it." After a sentence with a
       target, "it" is that target, not this card. */
    folded.forEach((e, i) => {
      if (!e || (e.op !== 'counters' && e.op !== 'restrict') || e.scope !== 'self' || e.targets) return;
      if (!/\bit\b/i.test(e.text || '') || /\bthis\b|CARDNAME/.test(e.text || '')) return;
      if (folded.slice(0, i).some(x => x && (x.targets || []).some(t => t && t.type !== 'player'))) e.scope = 'lastTarget';
    });
    return { effects: folded, auto: auto && !folded.some(hasManualStep) };
  }

  /* A generated script describes a card's shape, and some of the shapes it
     writes lose what the effect was pointed at ("untap two target lands"
     as an untap of nothing). Those are not trusted: better that the card
     asks for help than that it quietly does the wrong thing. */
  const NEEDS_AIM = new Set(['destroy', 'exile', 'bounce', 'tap', 'untap', 'counters', 'pump', 'grantKeyword', 'regrowth',
    'reanimate', 'gainControl', 'fight', 'bite', 'copySpell', 'counterSpell', 'restrict', 'regenerate']);
  function generatedScriptSound(script) {
    /* An effect inside one that carries the targets ("if you control three
       artifacts, 4 damage instead") acts on what that one chose. */
    const ok = (e, aimed) => {
      if (!e || typeof e !== 'object') return true;
      if (e.op === 'manual') return false;
      const has = aimed || !!(e.targets && e.targets.length);
      if (NEEDS_AIM.has(e.op) && !has && !e.scope && !e.each && !e.self && !e.toSelf) return false;
      if (e.op === 'damage' && !has && !e.each && !e.toSelf && !e.toTriggerPlayer && !e.toAffectedController && !e.scope) return false;
      for (const k of ['list', 'then', 'otherwise', 'effects']) if (Array.isArray(e[k]) && !e[k].every(x => ok(x, has))) return false;
      return !Array.isArray(e.modes) || e.modes.every(m => (m.effects || []).every(x => ok(x, false)));
    };
    return (script.abilities || []).concat(script.add || []).every(ab => (ab.effects || []).every(x => ok(x, false)));
  }

  /* The same, for the abilities standing in for one line: and a line that
     prints an intervening "if" or an "Activate only if" has to have kept it. */
  function generatedLineSound(abs, line) {
    if (!generatedScriptSound({ abilities: abs })) return false;
    if (/^(?:When|Whenever|At)[^,\n]*, if /.test(line) &&
        !abs.some(x => x.kind === 'triggered' && (x.condition || x.intervening))) return false;
    if (/Activate only if/.test(line) && !abs.some(x => x.only && x.only.cond)) return false;
    return true;
  }

  /** Does this effect, or anything inside it, still need a person? */
  function hasManualStep(e) {
    if (!e || typeof e !== 'object') return false;
    if (e.op === 'manual') return true;
    if (e.insteadOf) return true;
    for (const k of ['list', 'then', 'otherwise', 'effects']) {
      if (Array.isArray(e[k]) && e[k].some(hasManualStep)) return true;
    }
    return Array.isArray(e.modes) && e.modes.some(m => (m.effects || []).some(hasManualStep));
  }

  /**
   * A card's lines are usually one ability each, but a modal spell's modes are
   * bullet lines belonging to the "Choose one —" above them, and a Saga's
   * chapters belong to the Saga. Glue those back together before anything
   * tries to read a line as an ability on its own.
   */
  /* Ability words ("Landfall", "Threshold", "Magecraft") are printed in
     italics before a dash and mean nothing by the rules: the sentence after
     the dash is the whole ability. Cutting the word off lets the rest be
     read like any other line. Keywords that only look like ability words
     (Companion, Max speed, To solve) are deliberately absent. */
  const ABILITY_WORDS = new Set(['adamant', 'addendum', 'alliance', 'battalion', 'bloodrush',
    'celebration', 'channel', 'chroma', 'cohort', 'constellation', 'converge', "council's dilemma",
    'corrupted', 'coven', 'delirium', 'descend', 'domain', 'eerie', 'enrage', 'fateful hour',
    'fathomless descent', 'ferocious', 'flurry', 'formidable', 'grandeur', 'hellbent', 'heroic',
    'imprint', 'inspired', 'join forces', 'kinship', 'landfall', 'lieutenant', 'magecraft',
    'metalcraft', 'morbid', 'pack tactics', 'paradox', 'parley', 'radiance', 'raid', 'rally',
    'revolt', 'secret council', 'spell mastery', 'strive', 'survival', 'sweep', 'tempting offer',
    'threshold', 'undergrowth', 'underdog', 'valiant', 'void', 'will of the council',
    'will of the planeswalkers']);
  /* Labels that look like ability words but change how the ability works:
     an exhaust ability is used once, a boast only after attacking, a
     channel ability from the hand. They stay on the line. */
  const NOT_ABILITY_WORDS = new Set(['boast', 'exhaust', 'power-up', 'max speed', 'channel', 'companion', 'forecast', 'renew',
    'to solve', 'solved', 'visit', 'prize', 'eminence', 'mono eminence', 'bloodrush', 'spree', 'level up']);
  function stripAbilityWord(line) {
    const m = String(line).match(/^([A-Za-z][A-Za-z' ]{2,30}?)\s*(?:\u2014|--|-)\s+([\s\S]+)$/);
    if (!m) return line;
    const word = m[1].trim().toLowerCase().replace(/\s+\d+$/, '');
    // a Saga's chapter numbers are not labels, and some labels are rules
    if (/^[IVX]+$/.test(m[1].trim()) || NOT_ABILITY_WORDS.has(word)) return line;
    /* A flavour word ("Avoidance \u2014", "Siege Monster \u2014") is an ability word
       in all but name: any short label in front of a trigger or a static
       rule goes, unless it is one of the keywords above. */
    const flavour = !NOT_ABILITY_WORDS.has(word) && word.split(/\s+/).length <= 4 &&
      !KEYWORD_PATTERNS.some(re => re.test(m[1].trim())) &&
      /^(?:When|Whenever|At the|As long as|If |\{|Each |Creatures |You |This |Other |CARDNAME|Target |Your )/.test(m[2].trim());
    if (!ABILITY_WORDS.has(word) && !flavour) return line;
    const rest = m[2].trim();
    return rest.charAt(0).toUpperCase() + rest.slice(1);
  }

  const CHOOSING = /Choose (?:one|two|three|four|up to|any|odd|even)/i;
  function groupLines(lines) {
    const out = [];
    for (const line of lines) {
      const prev = out[out.length - 1];
      if (prev && /^\u2022/.test(line)) { out[out.length - 1] = prev + '\n' + line; continue; }
      /* Some sources write a mode's bullet as an asterisk, and some write
         the later modes as ";\nor ..." clauses. Either way the mode belongs
         to the "Choose one" line above it, not to a rule of its own. */
      if (prev && /^\*\s/.test(line) && (CHOOSING.test(prev) || /^\*\s/m.test(prev))) {
        out[out.length - 1] = prev + '\n\u2022 ' + line.replace(/^\*\s*/, ''); continue;
      }
      if (prev && /^or\s/i.test(line) && CHOOSING.test(prev)) {
        out[out.length - 1] = prev.replace(/;$/, '') + '\n\u2022 ' + line.replace(/^or\s+/i, ''); continue;
      }
      if (prev && /^Choose /i.test(prev) && !/\u2022/.test(prev) && /^[IVX]+(,\s*[IVX]+)* \u2014/.test(line) === false
          && /^You may choose the same mode/i.test(line)) { out[out.length - 1] = prev + '\n' + line; continue; }
      out.push(line);
    }
    return out;
  }

  /* A sentence that only qualifies the one before it ("a creature dealt
     damage this way can't be regenerated this turn") is folded into it. */
  function foldRiders(effects) {
    const out = [];
    for (const e of effects) {
      /* "Create a 0/1 colorless Eldrazi Spawn creature token. It has
         'Sacrifice this token: Add {C}.'" — the ability is part of the
         token, said a sentence later. */
      const has = e && e.op === 'manual' && String(e.text || '').match(/^(?:It has|They have|Those tokens have) "([^"]+)"\.?$/i);
      const host = has && out[out.length - 1];
      if (host && host.op === 'createToken' && !host.grantedText) {
        const probe = analyze({ id: 'tokentext:' + U.hash(has[1]), name: host.subtypes || 'Token', type_line: 'Token Creature',
          oracle_text: has[1], keywords: [], layout: 'token' });
        if (probe && probe.fullyAutomated) { host.grantedText = has[1]; continue; }
      }
      /* "…deals 2 damage to any target. If this spell was kicked, it deals
         4 damage instead." The second sentence is not another effect; it is
         the first one's number, with a question attached. */
      /* A coin flip and what it decides are one thought: the sentences
         after it say what each side means. */
      // "Otherwise, …": the branch the condition before it didn't take
      if (e && e.otherwiseOf) {
        const prev = out[out.length - 1];
        if (prev && prev.op === 'ifCond' && !(prev.otherwise && prev.otherwise.length)) { prev.otherwise = e.otherwiseOf; continue; }
      }
      if (e && e.insteadOf) {
        const prev = out.pop();
        /* Exhibition Tidecaller: "target player mills three cards. If …, that
           player mills ten cards instead" — the same player, chosen once */
        if (prev && prev.who === 'target' && prev.targets) {
          for (const x of e.insteadOf.effects) if (x.who === 'triggerPlayer' && x.op === prev.op && !x.targets) { x.who = 'target'; x.targets = prev.targets; }
        }
        /* Cinder Strike: "…to target creature. It deals 4 damage to that
           creature instead if …" — in a spell, "that creature" is the target */
        if (prev && prev.op === 'damage' && (prev.targets || []).length === 1 && prev.targets[0].type !== 'player') {
          for (const x of e.insteadOf.effects) if (x.op === 'damage' && x.toTriggerObject && !x.targets) { delete x.toTriggerObject; x.targets = prev.targets; }
        }
        if (prev) out.push({ op: 'ifCond', cond: e.insteadOf.cond, then: e.insteadOf.effects, otherwise: [prev] });
        // with nothing before it on this line, the line before this one is what it replaces
        else out.push(e);
        continue;
      }
      if (e && e.flipRider) {
        const host = e.flipRider.of || 'flipCoin';
        for (let i = out.length - 1; i >= 0; i--) {
          if (out[i].op !== host) continue;
          const key = e.flipRider.win ? 'then' : 'otherwise';
          out[i][key] = (out[i][key] || []).concat(e.flipRider.effects);
          break;
        }
        continue;
      }
      if (e && e.insteadRider) {
        for (let i = out.length - 1; i >= 0; i--) {
          if (out[i].op === e.insteadRider.op) {
            const was = out[i].n;
            out[i].n = { ifCond: e.insteadRider.cond, then: e.insteadRider.n, otherwise: was };
            break;
          }
        }
        continue;
      }
      /* "If that spell is countered this way, exile it instead…" changes
         where the countered spell goes, so it travels with the counter. */
      if (e && e.counterExileRider) {
        for (let i = out.length - 1; i >= 0; i--) {
          if (out[i].op === 'counterSpell') { out[i].exileIt = true; break; }
          // Syncopate: the counter sits inside "unless its controller pays {X}"
          const inner = out[i].op === 'unlessPays' && (out[i].then || []).find(x => x && x.op === 'counterSpell');
          if (inner) { inner.exileIt = true; break; }
        }
        continue;
      }
      if (e && e.noRegenRider) {
        const hits = (x) => x && (x.op === 'damage' || x.op === 'destroy' || x.op === 'destroyAll');
        for (let i = out.length - 1; i >= 0; i--) {
          // "…destroy target creature and …" read as a sequence: the destruction inside it
          const inner = out[i].op === 'sequence' ? (out[i].list || []).slice().reverse().find(hits) : null;
          if (hits(out[i]) || inner) { (inner || out[i]).noRegen = true; break; }
        }
        continue;
      }
      out.push(e);
    }
    return out;
  }

  /* The table and the bots work out what a spell will point at by reading
     its whole text again. A spell the analysis read line by line — or one a
     script replaced — would come back different that way, so the analysis
     leaves its answer here, keyed by the very text they will ask about. */
  const SPELL_TEXT = new Map();

  function parseEffects(text) {
    const known = SPELL_TEXT.get(text);
    /* Another card's reading of the same words: a copy, because whatever
       folds riders into this card's effects must not reach back into that
       card's (Precognitive Perception's addendum once gave Jace's Ingenuity
       a main-phase condition). */
    if (known) return { effects: JSON.parse(JSON.stringify(known.effects)), auto: known.auto };
    const cleaned = stripReminder(text);
    for (const rule of COMBO_RULES) {
      const m = cleaned.match(rule.re);
      if (!m) continue;
      const list = rule.make(m);
      if (!list) continue;
      for (const e of list) e.text = cleaned;
      return { effects: list, auto: true };
    }
    const modal = parseModal(cleaned);
    if (modal) return modal;
    return parseSentenceList(splitSentences(cleaned));
  }

  /** Straighten quotes and dashes so ASCII rule patterns match Scryfall text. */
  /* Card text does not always arrive as clean prose: some sources wrap
     reminder text in <i> tags and spell their dashes as HTML entities. The
     rules below are written for the printed characters, so put those back
     before anything tries to read a line. */
  const ENTITIES = {
    '&mdash;': '\u2014', '&ndash;': '-', '&bull;': '\u2022', '&minus;': '-',
    '&amp;': '&', '&quot;': '"', '&apos;': "'", '&nbsp;': ' ',
    '&lsquo;': "'", '&rsquo;': "'", '&ldquo;': '"', '&rdquo;': '"',
  };
  function normalizePunct(t) {
    return String(t || '')
      .replace(/<\/?[a-z][^>]*>/gi, '')
      .replace(/&[a-z]+;/gi, (e) => (ENTITIES[e.toLowerCase()] != null ? ENTITIES[e.toLowerCase()] : e))
      .replace(/[\u2018\u2019\u02bc]/g, "'")
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/\u2212/g, '-');
  }
  function stripReminder(t) { return normalizePunct(t).replace(/\s*\([^()]*\)/g, '').trim(); }

  function splitSentences(t) {
    // keep "{1}, {T}:" style intact; split on period followed by space+capital
    // (or a quotation closed after its period: 'with "This token can't block." Creatures …')
    return String(t || '')
      .split(/(?<=\.["”]?)\s+(?=[A-Z"“])/)
      .map(s => s.trim())
      .filter(Boolean);
  }

  /* ---------------- conditions ----------------
     "if you control three or more artifacts", "as long as this is untapped",
     "if a creature died this turn". Cards ask a small number of questions
     about the state of the game, in a small number of phrasings; these turn
     the phrasing into the question, and the engine answers it. Anything not
     in here is not a condition this can read, and the line stays manual. */

  const COND_RULES = [
    [/^(?:this|CARDNAME|this permanent|this creature|this artifact|this land) is untapped$/i, () => ({ kind: 'selfUntapped' })],
    [/^(?:this|CARDNAME|this permanent|this creature|this artifact|this land) is tapped$/i, () => ({ kind: 'selfTapped' })],
    [/^(?:this creature|CARDNAME) is attacking$/i, () => ({ kind: 'selfAttacking' })],
    // what the permanent itself is: monstrous, equipped, enchanted, and its counters
    [/^(?:this creature|CARDNAME) is (monstrous|equipped|enchanted)$/i, (m) => ({ kind: 'selfIs', what: m[1].toLowerCase() })],
    [/^it'?s not a token$/i, () => ({ kind: 'selfIs', what: 'nontoken' })],
    // Massacre Girl, Known Killer: "Whenever a creature … dies, if its toughness was less than 1, …"
    [/^its toughness was less than (\d+)$/i, (m) => ({ kind: 'triggerToughnessBelow', n: +m[1] })],
    [/^you'?re the monarch$/i, () => ({ kind: 'monarch' })],
    // Sneak: "if this creature's sneak cost was paid"
    [/^(?:this creature|this spell|CARDNAME)'?s sneak cost was paid$/i, () => ({ kind: 'sneaked' })],
    // Triskaidekaphile: "if you have exactly thirteen cards in your hand"
    [/^you have exactly (\w+) cards in your hand$/i, (m) => (typeof num(m[1]) === 'number'
      ? [{ kind: 'hand', n: num(m[1]), cmp: 'atLeast' }, { kind: 'hand', n: num(m[1]), cmp: 'atMost' }] : null)],
    // Righteous Valkyrie: "you have at least 7 life more than your starting life total"
    [/^you have at least (\w+) life more than your starting life total$/i, (m) => ({ kind: 'lifeAboveStart', n: num(m[1]) })],
    // Runaway Steam-Kin: "this creature has fewer than three +1/+1 counters on it"
    [/^(?:this creature|CARDNAME) has fewer than (\w+) ([+\-0-9/a-z]+) counters on it$/i,
      (m) => (typeof num(m[1]) === 'number' ? { kind: 'selfCounters', n: num(m[1]) - 1, cmp: 'atMost', counter: m[2].toLowerCase() } : null)],
    // Jadar: "you control no creatures with decayed"
    [/^you control no creatures with ([a-z]+)$/i, (m) => { const sc = scopeOf('creatures you control with ' + m[1]); return sc ? { kind: 'control', scope: sc, n: 0, cmp: 'atMost' } : null; }],
    // Boromir, Vexing Bauble: "if no mana was spent to cast it"
    [/^no mana was spent to cast (?:it|that spell)$/i, () => ({ kind: 'triggerNoMana' })],
    // Agent of Treachery: "you control three or more permanents you don't own"
    [/^you control (\w+) or more permanents you don'?t own$/i, (m) => (typeof num(m[1]) === 'number' ? { kind: 'controlNotOwned', n: num(m[1]) } : null)],
    // Essence Channeler: "you've lost life this turn"; Bloodchief Ascension: "an opponent lost 2 or more life this turn"
    [/^you'?ve lost life this turn$/i, () => ({ kind: 'lostLife', who: 'you', n: 1 })],
    [/^an opponent lost (\w+) or more life this turn$/i, (m) => (typeof num(m[1]) === 'number' ? { kind: 'lostLife', who: 'opponent', n: num(m[1]) } : null)],
    [/^an opponent lost life this turn$/i, () => ({ kind: 'lostLife', who: 'opponent', n: 1 })],
    // Vengevine: "if it's the second creature spell you cast this turn"
    [/^it'?s the (second|third) creature spell you(?:'ve)? cast this turn$/i, (m) => ({ kind: 'nthCreatureSpell', n: /second/i.test(m[1]) ? 2 : 3 })],
    // the Backgrounds: "if no opponent has more life than that player"
    [/^no opponent has more life than that player$/i, () => ({ kind: 'attackedMostLife' })],
    // Bridge from Below: "if this card is in your graveyard" — where it works from
    [/^(?:this card|CARDNAME) is in your graveyard$/i, () => ({ kind: 'selfInGraveyard' })],
    // Jace, Wielder of Mysteries: "if your library has no cards in it"
    [/^your library has no cards in it$/i, () => ({ kind: 'libraryEmpty' })],
    // Adamant: "at least three white mana was spent to cast this spell"; "five or more mana was spent to cast that spell"
    [/^(?:at least )?(\w+)(?: or more)? (?:(white|blue|black|red|green|colorless) )?mana was spent to cast (this spell|that spell|it|CARDNAME)$/i,
      (m) => (typeof num(m[1]) === 'number' ? Object.assign({ kind: 'manaSpentAtLeast', n: num(m[1]), of: spentOf(m[3]) },
        m[2] ? { color: { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G', colorless: 'C' }[m[2].toLowerCase()] } : {}) : null)],
    // Unstoppable Slasher: "When this creature dies, if it had no counters on it, …"
    [/^it had no counters on it$/i, () => ({ kind: 'diedNoCounters' })],
    // the depletion lands: "if there are no depletion counters on this land"
    [/^there are no ([+\-0-9/a-z]+) counters on (?:this creature|this land|this artifact|this enchantment|this permanent|CARDNAME)$/i,
      (m) => ({ kind: 'selfCounters', n: 0, cmp: 'atMost', counter: m[1].toLowerCase() })],
    [/^(?:this creature|CARDNAME) has (\w+) or more ([+\-0-9/a-z]+) counters on it$/i, (m) => ({ kind: 'selfCounters', n: num(m[1]), counter: m[2].toLowerCase() })],
    // an Aura's condition on what it enchants, by its printed colour or type
    [/^enchanted (?:creature|permanent) is (white|blue|black|red|green)$/i, (m) => ({ kind: 'attachedIs', color: { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' }[m[1].toLowerCase()] })],
    [/^enchanted (?:creature|permanent) is (?:an? )?(legendary|creature|artifact|land|Equipment|enchantment)$/i, (m) => ({ kind: 'attachedIs', what: m[1].toLowerCase() })],
    [/^(?:equipped|enchanted) creature is attacking$/i, () => ({ kind: 'attachedIs', attacking: true })],
    [/^it'?s your turn$/i, () => ({ kind: 'yourTurn' })],
    [/^it'?s the first combat phase of the turn$/i, () => ({ kind: 'firstCombat' })],
    [/^it'?s not your turn$/i, () => ({ kind: 'notYourTurn' })],
    // counting the board
    [/^you control (\w+) or more ([a-z]+?)s$/i, (m) => ({ kind: 'control', what: m[2], n: num(m[1]) })],
    // Valakut: "if you control at least five other Mountains" (the one that entered among them)
    [/^you control at least (\w+) other ([A-Za-z]+?)s$/i, (m) => ({ kind: 'control', what: m[2].toLowerCase(), n: num(m[1]) + 1 })],
    // the Turbulent lands: "unless your opponents control eight or more lands"
    [/^your opponents control (\w+) or more ([a-z]+?)s$/i, (m) => ({ kind: 'control', what: m[2], n: num(m[1]), who: 'opponents' })],
    [/^you control (?:an?|one or more) ([a-z]+?)s?$/i, (m) => ({ kind: 'control', what: m[1], n: 1 })],
    [/^you control (\w+) or fewer ([a-z]+?)s$/i, (m) => ({ kind: 'control', what: m[2], n: num(m[1]), cmp: 'atMost' })],
    [/^you control no ([a-z]+?)s$/i, (m) => ({ kind: 'control', what: m[1], n: 0, cmp: 'atMost' })],
    /* Grixis Grimblade, the Runemarks: "you control another multicolored
       permanent", "you control a black or green permanent" — any group the
       scope words can describe */
    [/^you control (another|an?|one or more) ([a-zA-Z ,'-]+?)$/i, (m) => {
      const words = m[2].replace(/\b(permanent|creature|artifact|enchantment|land|planeswalker)\b(?!s)/g, '$1s');
      const sc = scopeOf((/^another$/i.test(m[1]) ? 'other ' : '') + words + ' you control');
      return sc ? { kind: 'control', scope: sc, n: 1 } : null;
    }],
    [/^you control a creature with power (\d+) or greater$/i, (m) => ({ kind: 'controlPower', n: +m[1] })],
    [/^you control an? ([A-Za-z]+) or an? ([A-Za-z]+)$/i, (m) => ({ kind: 'controlAny', what: [m[1], m[2]].map(x => x.toLowerCase()) })],
    [/^you control (\w+) or more other ([A-Za-z]+?)s$/i, (m) => ({ kind: 'control', what: m[2], n: num(m[1]) + 1 })],
    [/^you created a token this turn$/i, () => ({ kind: 'createdToken' })],
    [/^creatures you control have total power (\d+) or greater$/i, (m) => ({ kind: 'totalPower', n: +m[1] })],
    [/^you cast it$/i, () => ({ kind: 'wasCast' })],
    [/^this spell was cast from (?:a|your) graveyard$/i, () => ({ kind: 'castFromGraveyard' })],
    [/^(?:CARDNAME|this \w+) has (\w+) or more ([+\-0-9/a-z]+) counters on it$/i, (m) => ({ kind: 'selfCounters', counter: m[2], n: num(m[1]) })],
    [/^(?:CARDNAME|this \w+) has counters on it$/i, () => ({ kind: 'selfCounters', n: 1 })],
    [/^you attacked with (\w+) or more creatures this turn$/i, (m) => ({ kind: 'attackedWith', n: num(m[1]) })],
    [/^you control a legendary creature$/i, () => ({ kind: 'controlLegend' })],
    [/^you control another creature named (?:CARDNAME|.+)$/i,
      () => ({ kind: 'controlNamed', name: 'CARDNAME', other: true, n: 1 })],
    // the graveyard
    [/^there are (\w+) or more cards in your graveyard$/i, (m) => ({ kind: 'graveyard', n: num(m[1]) })],
    [/^(\w+) or more cards are in your graveyard$/i, (m) => ({ kind: 'graveyard', n: num(m[1]) })],
    [/^you have (\w+) or more cards in your graveyard$/i, (m) => ({ kind: 'graveyard', n: num(m[1]) })],
    [/^(?:there are )?(\w+) or more card types (?:are )?among cards in your graveyard$/i,
      (m) => ({ kind: 'graveyardTypes', n: num(m[1]) })],
    [/^you have (\w+) or more ([a-z]+?) cards? in your graveyard$/i,
      (m) => ({ kind: 'graveyard', what: m[2], n: num(m[1]) })],
    // hand and life
    [/^you have no cards in hand$/i, () => ({ kind: 'hand', n: 0, cmp: 'atMost' })],
    [/^you have (\w+) or (?:more|fewer) cards in hand$/i,
      (m) => ({ kind: 'hand', n: num(m[1]), cmp: /fewer/i.test(m[0]) ? 'atMost' : 'atLeast' })],
    [/^you have (\d+) or (?:more|less) life$/i,
      (m) => ({ kind: 'life', n: +m[1], cmp: /less/i.test(m[0]) ? 'atMost' : 'atLeast' })],
    [/^you(?:'ve)? gained (\w+) or more life this turn$/i, (m) => ({ kind: 'lifeGained', n: num(m[1]) })],
    [/^an opponent has (\d+) or less life$/i, (m) => ({ kind: 'opponentLife', n: +m[1], cmp: 'atMost' })],
    // Land Tax, Gift of Estates and the other catch-up cards
    [/^an opponent controls more ([a-z]+?)s than you$/i, (m) => ({ kind: 'opponentMore', what: m[1] })],
    // what has already happened this turn
    [/^(?:a|another) creature died this turn$/i, () => ({ kind: 'morbid' })],
    [/^a permanent you controlled left the battlefield this turn$/i, () => ({ kind: 'revolt' })],
    [/^you attacked (?:with a creature )?this turn$/i, () => ({ kind: 'raid' })],
    [/^you had a land enter(?: the battlefield)?(?: under your control)? this turn$/i, () => ({ kind: 'landfall' })],
    [/^you'?ve cast (\w+) or more spells this turn$/i, (m) => ({ kind: 'spellsCast', n: num(m[1]) })],
    // paid for on the way down
    [/^(?:CARDNAME|this spell|it) was kicked$/i, () => ({ kind: 'kicked', n: 1 })],
    // an optional additional cost, paid, is counted as the spell's kicker
    [/^this spell'?s additional cost was paid$/i, () => ({ kind: 'kicked', n: 1 })],
    // Baleful Mastery: "If the {1}{B} cost was paid" — the alternative cost
    [/^the (?:\{[^}]+\})+ cost was paid$/i, () => ({ kind: 'altPaid' })],
    // Delayed Blast Fireball: "If this spell was cast from exile"
    [/^this spell was cast from exile$/i, () => ({ kind: 'castFromExile' })],
    // Osseous Exhale: "If a Dragon was beheld" — the optional behold was paid
    [/^an? [A-Za-z ]+ was beheld$/i, () => ({ kind: 'kicked', n: 1 })],
    [/^(?:CARDNAME|this spell|it) was kicked (\w+) or more times$/i, (m) => ({ kind: 'kicked', n: num(m[1]) })],
    [/^(?:CARDNAME|this spell|it) wasn'?t kicked$/i, () => ({ kind: 'kicked', n: 0, cmp: 'atMost' })],
    [/^(?:CARDNAME|this spell|it) was bought back$/i, () => ({ kind: 'boughtBack' })],
    [/^you have the city'?s blessing$/i, () => ({ kind: 'cityBlessing' })],
    [/^you'?ve completed a dungeon$/i, () => ({ kind: 'completedDungeon' })],
    [/^you control (\w+) or more lands with different names$/i, (m) => ({ kind: 'landNames', n: num(m[1]) })],
    [/^it doesn'?t have the same name as another creature you control or a creature card in your graveyard$/i, () => ({ kind: 'triggerNameUnique' })],
    [/^it'?s your first, second, or third turn of the game$/i, () => ({ kind: 'earlyTurn', n: 3 })],
    [/^(?:CARDNAME|this creature)'?s power is (\w+) or greater$/i, (m) => ({ kind: 'selfPower', n: num(m[1]) })],
    // Jace's Phantasm: "an opponent has ten or more cards in their graveyard"
    [/^an opponent has (\w+) or more cards in their graveyard$/i, (m) => ({ kind: 'opponentGraveyard', n: num(m[1]) })],
    // the Myojin: "if you cast it from your hand"
    [/^you cast it from your hand$/i, () => ({ kind: 'castFromHand' })],
    // Gathering Place: "this land entered this turn or you control a basic land"
    [/^(?:this land|CARDNAME) entered this turn or (?:if )?you control a basic land$/i, () => ({ kind: 'any', of: [{ kind: 'selfEnteredThisTurn' }, { kind: 'control', what: 'basic land', n: 1 }] })],
    // Young Hero Role: "if its toughness is 3 or less"
    [/^(?:its|CARDNAME'?s|this creature'?s) toughness is (\w+) or less$/i, (m) => ({ kind: 'selfToughnessMax', n: num(m[1]) })],
    [/^this is the (second|third|fourth|fifth) time this ability has resolved this turn$/i,
      (m) => ({ kind: 'nthResolution', n: { second: 2, third: 3, fourth: 4, fifth: 5 }[m[1].toLowerCase()] })],
    [/^you control your commander$/i, () => ({ kind: 'controlCommander' })],
    [/^there are (\w+) or more permanent cards in your graveyard$/i, (m) => ({ kind: 'graveyardPermanents', n: num(m[1]) })],
    [/^you descended this turn$/i, () => ({ kind: 'descended' })],
    [/^this spell was bargained$/i, () => ({ kind: 'bargained' })],
    [/^(?:CARDNAME|it) was bargained$/i, () => ({ kind: 'bargained' })],
    [/^you cast this spell during your main phase$/i, () => ({ kind: 'castInMain' })],
    [/^its power is (\w+) or greater$/i, (m) => ({ kind: 'triggerPower', n: num(m[1]) })],
    // gift (CR 702.174): promised as the spell was cast
    [/^the gift was promised$/i, () => ({ kind: 'gift' })],
    [/^the gift wasn'?t promised$/i, () => ({ kind: 'gift', none: true })],
    /* The old werewolves ask what happened last turn, not this one. */
    [/^no spells were cast last turn$/i, () => ({ kind: 'spellsLastTurn', n: 0, cmp: 'atMost' })],
    [/^a player cast (\w+) or more spells last turn$/i, (m) => ({ kind: 'spellsLastTurn', n: num(m[1]), most: true })],
  ];

  /** A condition phrase -> the question the engine can answer, or null. */
  function condOf(phrase) {
    const p = String(phrase || '').trim().replace(/[.,]$/, '');
    for (const [re, make] of COND_RULES) {
      const m = p.match(re);
      if (m) { const c = make(m); if (c) return c; }
    }
    return null;
  }

  /* ---------------- trigger conditions ---------------- */

  /* The thing a trigger is watching: "another nontoken creature you
     control", "a creature an opponent controls", "one or more Goblins".
     Read into a filter the engine checks against whatever set the trigger
     off; null for words this does not know, which leaves the line manual
     rather than watching for the wrong thing. */
  const SUBJ_WORDS = new Set(['creature', 'creatures', 'artifact', 'artifacts', 'enchantment', 'enchantments',
    'land', 'lands', 'planeswalker', 'planeswalkers', 'permanent', 'permanents', 'battle', 'battles',
    'token', 'tokens', 'nontoken', 'legendary', 'nonland', 'noncreature', 'nonartifact', 'snow', 'basic',
    'nonbasic', 'white', 'blue', 'black', 'red', 'green', 'colorless', 'multicolored', 'or', 'and/or',
    'equipment', 'aura', 'vehicle', 'nonlegendary']);
  function subjectFilter(raw) {
    let p = String(raw || '').trim();
    const f = {};
    let m;
    if ((m = p.match(/^(?:this creature|CARDNAME|this permanent|this artifact|this land|this enchantment) or (another .+)$/i))) { f.selfOk = true; p = m[1]; }
    /* Kutzil: "creatures you control each with power greater than its base power" */
    if (/ each with power greater than its base power$/i.test(p)) { f.pumped = true; p = p.replace(/ each with power greater than its base power$/i, ''); }
    if (/^another /i.test(p)) { f.other = true; p = p.replace(/^another /i, ''); }
    else if (/^one or more other /i.test(p)) { f.other = true; f.batch = true; p = p.replace(/^one or more other /i, ''); }
    else if (/^one or more /i.test(p)) { f.batch = true; p = p.replace(/^one or more /i, ''); }
    else if (/^(?:a|an) /i.test(p)) p = p.replace(/^(?:a|an) /i, '');
    else return null;
    if (/ of the chosen type\b/i.test(p)) { f.chosenType = true; p = p.replace(/ of the chosen type\b/i, ''); }
    const who = (q) => {
      if (/ you control$/.test(q)) { f.who = 'you'; return q.replace(/ you control$/, ''); }
      if (/ (?:an opponent controls|your opponents control|you don'?t control)$/.test(q)) {
        f.who = 'opponent'; return q.replace(/ (?:an opponent controls|your opponents control|you don'?t control)$/, '');
      }
      return q;
    };
    // "with power 4 or greater" sometimes comes after "you control" and sometimes before
    for (let pass = 0; pass < 2; pass++) {
      p = who(p);
      if ((m = p.match(/ with power (\d+) or (greater|more|less)$/))) {
        if (/less/.test(m[2])) f.maxPower = +m[1]; else f.minPower = +m[1];
        p = p.slice(0, m.index);
      } else if ((m = p.match(/ with (?:mana value|converted mana cost) (\d+) or (greater|more)$/))) {
        f.minMv = +m[1]; p = p.slice(0, m.index);
      } else if ((m = p.match(/ with (?:mana value|converted mana cost) (\d+) or less$/))) {
        f.maxMv = +m[1]; p = p.slice(0, m.index);
      } else if ((m = p.match(/ with (flying|deathtouch|lifelink|trample|haste|first strike|vigilance|menace|reach|defender)$/i))) {
        f.keyword = m[1].toLowerCase(); p = p.slice(0, m.index);
      } else if ((m = p.match(/ without (flying|deathtouch|lifelink|trample|haste|first strike|vigilance|menace|reach|defender)$/i))) {
        // Luminous Broodmoth: "a creature you control without flying"
        f.noKeyword = m[1].toLowerCase(); p = p.slice(0, m.index);
      } else if ((m = p.match(/ with an? ([+\-0-9/a-z]+) counter on it$/i))) {
        f.withCounter = m[1]; p = p.slice(0, m.index);
      }
    }
    const words = p.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
    if (!words.length) return null;
    for (const w of words) {
      if (SUBJ_WORDS.has(w.toLowerCase()) && w === w.toLowerCase()) continue;
      // a creature type is printed with a capital: "a Goblin", "another Elf"
      if (/^[A-Z][a-z'-]+s?$/.test(w) && w !== 'CARDNAME') continue;
      // "a non-Wall creature"
      if (/^non-[A-Z][a-z'-]+$/.test(w)) continue;
      return null;
    }
    if (words.includes('nontoken')) f.nontoken = true;
    f.words = words.filter(w => w !== 'nontoken').join(' ').toLowerCase();
    if (!f.words) f.words = 'permanent';
    return f;
  }
  const SUBJ = "((?:this creature or |CARDNAME or |this permanent or |this land or |this artifact or |this enchantment or )?(?:another|an?|one or more(?: other)?) [A-Za-z0-9 ,/'+-]+?)";

  /* "a noncreature spell", "an instant or sorcery spell", "a spell with mana
     value 4 or greater". */
  const SPELL_WORDS = new Set(['creature', 'noncreature', 'instant', 'sorcery', 'artifact', 'enchantment',
    'planeswalker', 'land', 'legendary', 'kindred', 'tribal', 'white', 'blue', 'black', 'red', 'green',
    'colorless', 'multicolored', 'monocolored', 'nonartifact', 'or', 'and/or', 'permanent', 'battle', 'aura',
    'equipment', 'vehicle']);
  function spellFilter(raw, mv) {
    const chosenType = / of the chosen type/i.test(String(raw || ''));
    const words = String(raw || '').replace(/ of the chosen type/i, '').replace(/,/g, ' ').split(/\s+/).filter(Boolean);
    for (const w of words) {
      if (SPELL_WORDS.has(w.toLowerCase()) && w === w.toLowerCase()) continue;
      if (/^[A-Z][a-z'-]+$/.test(w)) continue;
      return null;
    }
    const f = { words: words.join(' ').toLowerCase() || 'spell' };
    if (chosenType) f.chosenType = true;
    const k = String(mv || '').match(/(\d+) or (?:greater|more)/);
    // Gwenna: "a creature spell with power 5 or greater"
    if (k) { if (/power/i.test(mv)) f.minPower = +k[1]; else f.minMv = +k[1]; }
    return f;
  }

  const TRIGGER_PATTERNS = [
    { re: /^When(?:ever)? an opponent casts a spell from anywhere other than their hand(?:,| )/i, event: 'opponentCastSpell', extra: { notFromHand: true } },
    { re: /^When(?:ever)? you cast a spell from anywhere other than your hand(?:,| )/i, event: 'youCastSpell', extra: { notFromHand: true } },
    // Double Vision: "Whenever you cast your first instant or sorcery spell each turn"
    { re: /^Whenever you cast your first ([a-z ]+?) spell each turn,? /i, event: 'youCastSpell',
      extraOf: (m) => ({ spellFilter: m[1].toLowerCase(), firstOfKindYou: true }) },
    // Nalfeshnee: "Whenever you cast a spell from exile"
    { re: /^Whenever you cast a spell from exile,? /i, event: 'youCastSpell', extra: { fromExileOnly: true } },
    // the Backgrounds: "Whenever this creature attacks a player", "enters or leaves the battlefield"
    { re: /^Whenever (?:this creature|CARDNAME) attacks a player,? /i, event: 'attacks', self: true, extra: { attacksPlayer: true } },
    { re: /^When (?:this creature|CARDNAME) enters or leaves the battlefield,? /i, event: 'etb', self: true, also: 'ltb' },
    // Tavern Scoundrel, Zndrsplt: winning and losing coin flips
    { re: /^Whenever you win a coin flip,? /i, event: 'youWinFlip' },
    { re: /^Whenever you lose a coin flip,? /i, event: 'youLoseFlip' },
    { re: /^Whenever a player wins a coin flip,? /i, event: 'anyWinFlip' },
    // Talion: "with mana value, power, or toughness equal to the chosen number"
    { re: /^Whenever an opponent casts a spell with mana value, power, or toughness equal to the chosen number,? /i, event: 'opponentCastSpell', extra: { chosenNumberHit: true } },
    // Heroic: "Whenever you cast a spell that targets this creature"
    { re: /^Whenever you cast a spell that targets (?:this creature|CARDNAME),? /i, event: 'youCastSpell', extra: { targetsSelf: true } },
    // Rooms: "When you unlock this door" (one door), "Whenever you fully unlock a Room"
    { re: /^When you unlock door ([01]),? /i, event: 'unlockDoor', self: true, extraOf: (m) => ({ door: +m[1] }) },
    { re: /^Whenever you fully unlock a Room,? /i, event: 'youFullyUnlock' },
    // No Mercy, Mikaeus: "Whenever a creature deals damage to you"
    { re: /^Whenever (?:a|an) ([A-Za-z ]+?) deals damage to you,/i, event: 'youDealtDamage', aboutObject: true,
      filt: (m) => ({ words: m[1].toLowerCase() }) },
    // City of Traitors: "When you play another land"
    { re: /^When(?:ever)? you play (another|a) land,/i, event: 'youPlayLand', extraOf: (m) => (/another/i.test(m[1]) ? { notSelf: true } : {}) },
    // the Eldrazi titans: a trigger from the stack, as the spell is cast
    { re: /^When you cast (?:this spell|CARDNAME),? /i, event: 'castSelf' },
    { re: /^Whenever (?:CARDNAME|this creature) attacks for the first time each turn,? /i, event: 'attacks', self: true,
      extra: { firstAttack: true } },
    // a cycled card's own trigger, from the graveyard it has just gone to
    { re: /^When you cycle (?:this card|CARDNAME),? /i, event: 'cycleSelf' },
    { re: /^Whenever you cycle or discard (?:a|another) card,? /i, event: 'youDiscard' },   // cycling discards too
    { re: /^Whenever you cycle (?:a|another) card,? /i, event: 'youCycle' },
    { re: /^When (?:CARDNAME|this (?:card|creature)) is put into a graveyard from anywhere,? /i, event: 'selfToGraveyard' },
    { re: /^When(?:ever)? (?:this land|CARDNAME) enters untapped(?:,| )/i, event: 'etb', self: true,
      extra: { condition: { kind: 'selfUntapped' } } },
    { re: /^Whenever you create or sacrifice a token(?:,| )/i, event: 'youCreateToken', also: 'youSacToken' },
    { re: /^Whenever you create (?:a|one or more) tokens?(?:,| )/i, event: 'youCreateToken' },
    { re: /^Whenever you sacrifice a token(?:,| )/i, event: 'youSacToken' },
    { re: /^When(?:ever)? (?:this creature|CARDNAME) attacks or becomes the target of a spell(?:,| )/i,
      event: 'attacks', also: 'becomesTarget', self: true, extra: { bySpellOnly: true } },
    { re: /^When(?:ever)? (?:this creature|CARDNAME) becomes the target of a spell(?: or ability)?(?: an opponent controls)?(?:,| )/i,
      event: 'becomesTarget', self: true, extraOf: (m) => ({ bySpellOnly: !/or ability/i.test(m[0]), byOpponent: /opponent/i.test(m[0]) }) },
    /* --- the general shapes, watching for a kind of thing --- */
    // Amulet of Vigor: "Whenever a permanent you control enters tapped"
    { re: /^When(?:ever)? a permanent you control enters tapped,? /i, event: 'permEnters',
      filt: () => ({ who: 'you', words: 'permanent' }), extra: { enteredTapped: true } },
    { re: new RegExp('^When(?:ever)? ' + SUBJ + ' enters or attacks(?:,| )', 'i'),
      event: 'permEnters', also: 'permAttacks', filt: (m) => subjectFilter(m[1]) },
    { re: new RegExp('^When(?:ever)? ' + SUBJ + ' enters?(?: the battlefield)?( under your control| under an opponent\'s control)?(?:,| )', 'i'),
      event: 'permEnters', filt: (m) => {
        const f = subjectFilter(m[1]);
        if (f && m[2]) f.who = /your/i.test(m[2]) ? 'you' : 'opponent';
        return f;
      } },
    /* Nether Traitor, Bridge from Below: "is put into your graveyard / an
       opponent's graveyard from the battlefield" — dying, with whose it was */
    { re: new RegExp('^When(?:ever)? ' + SUBJ + ' (?:is|are) put into (your|an opponent\'s) graveyard from the battlefield(?:,| )', 'i'),
      event: 'permDies', filt: (m) => { const f = subjectFilter(m[1]); if (f) f.who = /your/i.test(m[2]) ? 'you' : 'opponent'; return f; } },
    { re: new RegExp('^When(?:ever)? ' + SUBJ + ' (?:dies|die|is put into a graveyard from the battlefield|are put into a graveyard from the battlefield)(?:,| )', 'i'),
      event: 'permDies', filt: (m) => subjectFilter(m[1]) },
    // Dour Port-Mage: "leave the battlefield without dying"; Soulherder: "is exiled from the battlefield"
    { re: new RegExp('^When(?:ever)? ' + SUBJ + ' leaves? the battlefield without dying(?:,| )', 'i'),
      event: 'permLeaves', extra: { notDying: true }, filt: (m) => subjectFilter(m[1]) },
    { re: new RegExp('^When(?:ever)? ' + SUBJ + ' (?:is|are) exiled from the battlefield(?:,| )', 'i'),
      event: 'permLeaves', extra: { toZoneOnly: 'exile' }, filt: (m) => subjectFilter(m[1]) },
    { re: new RegExp('^When(?:ever)? ' + SUBJ + ' leaves? the battlefield(?:,| )', 'i'),
      event: 'permLeaves', filt: (m) => subjectFilter(m[1]) },
    // "attacks alone": the only attacker this combat (before plain "attacks")
    { re: /^When(?:ever)? (?:this creature|~|CARDNAME) attacks alone,? /i, event: 'attacksAlone', self: true },
    { re: new RegExp('^When(?:ever)? ' + SUBJ + ' attacks alone,? ', 'i'),
      event: 'attacksAlone', filt: (m) => subjectFilter(m[1]) },
    { re: new RegExp('^When(?:ever)? ' + SUBJ + ' attacks?(?:,| )', 'i'),
      event: 'permAttacks', filt: (m) => subjectFilter(m[1]) },
    { re: /^When(?:ever)? a creature you control deals combat damage to an opponent,? /i, event: 'yourCreatureCombatDamage' },
    // Magda: "Whenever a Dwarf you control becomes tapped"
    { re: new RegExp('^When(?:ever)? ' + SUBJ + ' becomes tapped,? ', 'i'),
      event: 'becomesTapped', filt: (m) => subjectFilter(m[1]) },
    { re: new RegExp('^When(?:ever)? ' + SUBJ + ' blocks?(?:,| )', 'i'),
      event: 'permBlocks', filt: (m) => subjectFilter(m[1]) },
    { re: new RegExp('^When(?:ever)? ' + SUBJ + ' deals? combat damage to a player(?:,| )', 'i'),
      event: 'permCombatDamage', filt: (m) => subjectFilter(m[1]) },
    /* --- spells being cast, by whom and of what kind --- */
    { re: /^When(?:ever)? you cast (?:a|an) ([a-zA-Z ,-]*?)spell( with (?:mana value|converted mana cost|power) \d+ or (?:greater|more))?, /i,
      event: 'youCastSpell', filt: (m) => spellFilter(m[1], m[2]) },
    { re: /^When(?:ever)? you cast (?:a|an) ([a-zA-Z ,-]*?)spell of the chosen type, /i,
      event: 'youCastSpell', filt: (m) => spellFilter(m[1] + ' of the chosen type') },
    { re: /^When(?:ever)? you cast or copy (?:a|an) ([a-zA-Z ,-]*?)spell, /i,
      event: 'youCastSpell', also: 'youCopySpell', filt: (m) => spellFilter(m[1]) },
    { re: /^When(?:ever)? an opponent casts (?:a|an) ([a-zA-Z ,-]*?)spell( with (?:mana value|converted mana cost|power) \d+ or (?:greater|more))?, /i,
      event: 'opponentCastSpell', filt: (m) => spellFilter(m[1], m[2]) },
    { re: /^When(?:ever)? a player casts (?:a|an) ([a-zA-Z ,-]*?)spell( with (?:mana value|converted mana cost|power) \d+ or (?:greater|more))?, /i,
      event: 'anyCastSpell', filt: (m) => spellFilter(m[1], m[2]) },

    /* --- one ability, two ways to set it off --- */
    { re: /^When(?:ever)? (?:this (?:Aura|Equipment|Vehicle|Saga|land|token|Food|Clue|Treasure|Spacecraft|Planet))\s+enters(?: the battlefield)?(?:,| )/i,
      event: 'etb', self: true },
    { re: /^As (?:CARDNAME|this (?:land|creature|artifact|enchantment|permanent)) enters(?: the battlefield)?(?:,| )/i,
      event: 'etb', self: true },
    { re: /^When(?:ever)? (?:this (?:Aura|Equipment|Vehicle|Saga|land|token))\s+(?:dies|is put into a graveyard from the battlefield)(?:,| )/i,
      event: 'dies', self: true },
    { re: /^When(?:ever)? (?:this (?:Aura|Equipment|Vehicle|Saga|land|token))\s+leaves the battlefield(?:,| )/i,
      event: 'ltb', self: true },
    { re: /^When(?:ever)? (?:CARDNAME|this creature|this permanent) is turned face up(?:,| )/i,
      event: 'turnedFaceUp', self: true },
    { re: /^Landfall\s*[-\u2014]\s*When(?:ever)? a land (?:you control )?enters(?: the battlefield)?(?:,| )/i, event: 'landfall' },
    { re: /^When(?:ever)? a land you control enters(?: the battlefield)?(?:,| )/i, event: 'landfall' },
    { re: /^When(?:ever)? a land enters under your control(?:,| )/i, event: 'landfall' },
    { re: /^When(?:ever)? (?:equipped|enchanted) creature deals combat damage to a player(?: or planeswalker)?(?:,| )/i, event: 'equippedCombatDamage' },
    { re: /^When(?:ever)? (?:equipped|enchanted) creature deals damage to (?:a player|an opponent)(?:,| )/i, event: 'equippedDealsDamage',
      extra: { toOpponent: true } },
    { re: /^When(?:ever)? (?:equipped|enchanted) creature attacks(?:,| )/i, event: 'permAttacks', filt: () => ({ words: 'creature', equipped: true }) },
    { re: /^When(?:ever)? an opponent draws their (second|third) card each turn(?:,| )/i, event: 'opponentDraw',
      extraOf: (m) => ({ drawNth: /second/i.test(m[1]) ? 2 : 3 }) },
    { re: /^When(?:ever)? an opponent loses life(?:,| )/i, event: 'opponentLosesLife' },
    { re: /^At the beginning of each player'?s draw step(?:,| )/i, event: 'eachDrawStep' },
    { re: /^When(?:ever)? you sacrifice an? ([A-Za-z]+)(?:,| )/i, event: 'youSacrifice',
      filt: (m) => (/^permanent$/i.test(m[1]) ? { words: 'permanent' } : subjectFilter('a ' + m[1])) },
    { re: /^When(?:ever)? a player casts a spell(?: with (?:mana value|converted mana cost) \d+ or less)?(?:,| )/i, event: 'anyCastSpell' },
    { re: /^When(?:ever)? a player casts their first spell during each of your turns(?:,| )/i, event: 'anyCastSpell' },
    { re: /^When(?:ever)? (?:this creature|this permanent|this artifact|~|CARDNAME) enters or attacks(?:,| )/i,
      event: 'etb', self: true, also: 'attacks' },
    { re: /^When(?:ever)? (?:this creature|this permanent|this artifact|~|CARDNAME) enters or dies(?:,| )/i,
      event: 'etb', self: true, also: 'dies' },
    { re: /^When(?:ever)? (?:this creature|this permanent|this artifact|~|CARDNAME) enters or is put into a graveyard from the battlefield(?:,| )/i,
      event: 'etb', self: true, also: 'dies' },
    { re: /^When(?:ever)? (?:this creature|this permanent|this artifact|~|CARDNAME) is put into a graveyard from the battlefield(?:,| )/i,
      event: 'dies', self: true },
    { re: /^When(?:ever)? (?:this creature|~|CARDNAME) attacks or blocks(?:,| )/i,
      event: 'attacks', self: true, also: 'blocks' },
    /* "Whenever this creature blocks a creature with flying", "blocks or
       becomes blocked by a creature": one trigger for each creature on the
       other side, which is "that creature" */
    { re: new RegExp('^When(?:ever)? (?:this creature|~|CARDNAME) blocks or becomes blocked by ' + SUBJ + ', ', 'i'),
      event: 'blocksCreature', also: 'blockedByCreature', self: true, aboutObject: true, filt: (m) => subjectFilter(m[1]) },
    { re: new RegExp('^When(?:ever)? (?:this creature|~|CARDNAME) blocks ' + SUBJ + ', ', 'i'),
      event: 'blocksCreature', self: true, aboutObject: true, filt: (m) => subjectFilter(m[1]) },
    { re: new RegExp('^When(?:ever)? (?:this creature|~|CARDNAME) becomes blocked by ' + SUBJ + ', ', 'i'),
      event: 'blockedByCreature', self: true, aboutObject: true, filt: (m) => subjectFilter(m[1]) },
    { re: /^When(?:ever)? (?:this creature|~|CARDNAME) blocks or becomes blocked,? /i,
      event: 'blocks', self: true, also: 'becomesBlocked' },

    /* --- what the other side of the table is doing --- */
    { re: /^When(?:ever)? an opponent draws a card(?:,| )/i, event: 'opponentDraw' },
    { re: /^When(?:ever)? a(?:nother)? creature an opponent controls dies(?:,| )/i, event: 'opponentCreatureDies' },
    { re: /^When(?:ever)? a(?:nother)? creature you control enters(?: the battlefield)?(?:,| )/i, event: 'yourCreatureEtb' },
    { re: /^When(?:ever)? a(?:n)? (?:nontoken )?permanent you control enters(?: the battlefield)?(?:,| )/i, event: 'yourPermanentEtb' },
    { re: /^When(?:ever)? you discard a card(?:,| )/i, event: 'youDiscard' },
    // Inti: "Whenever you discard one or more cards" — once for the lot
    { re: /^Whenever you discard one or more cards,? /i, event: 'youDiscard', extra: { batch: true } },
    { re: /^When(?:ever)? an opponent casts their first ([a-zA-Z ]*?)spell each turn(?:,| )/i, event: 'opponentFirstSpell',
      filt: (m) => spellFilter(m[1]), extra: { firstOfKind: true } },
    { re: /^When(?:ever)? a player casts their second spell each turn(?:,| )/i, event: 'anySecondSpell' },
    { re: /^When(?:ever)? you cast your second spell each turn(?:,| )/i, event: 'anySecondSpell', extra: { castByYou: true } },
    /* curses and auras on someone else's creature: that player's upkeep */
    { re: /^At the beginning of the upkeep of enchanted (?:creature|permanent|artifact|land|planeswalker)'s controller,? /i,
      event: 'eachUpkeep', extra: { enchantedController: true } },
    { re: /^At the beginning of enchanted player's upkeep,? /i, event: 'eachUpkeep', extra: { enchantedPlayer: true } },
    { re: /^At the beginning of each player's end step,? /i, event: 'eachEndStep' },
    { re: /^At the beginning of (?:your second main phase|each of your postcombat main phases|your postcombat main phase),? /i, event: 'yourMain2' },
    { re: /^When(?:ever)? (?:this creature|~|CARDNAME) is dealt (combat )?damage,? /i, event: 'isDealtDamage', self: true,
      extraOf: (m) => (/combat/i.test(m[0]) ? { combatOnly: true } : {}) },
    { re: /^When (?:this creature|~|CARDNAME) exploits a creature,? /i, event: 'exploits', self: true },
    /* an Aura or Equipment watching the creature it is on */
    { re: /^When(?:ever)? (?:enchanted|equipped) (?:creature|land|permanent|artifact) (becomes tapped|deals combat damage|deals damage|is dealt damage|becomes blocked),? /i,
      event: 'becomesTapped', aboutObject: true,
      extraOf: (m) => {
        const w = m[1].toLowerCase();
        return { event: w === 'becomes tapped' ? 'becomesTapped' : w === 'is dealt damage' ? 'isDealtDamage'
          : w === 'becomes blocked' ? 'becomesBlocked' : 'dealsDamage', ofEnchanted: true, combatOnly: w === 'deals combat damage' || undefined };
      } },
    { re: /^When(?:ever)? a creature dealt damage by (?:this creature|~|CARDNAME) this turn dies,? /i, event: 'permDies',
      filt: () => ({ words: 'creature' }), extra: { damagedByMe: true } },
    { re: /^When(?:ever)? a player cycles a card,? /i, event: 'anyCycle' },
    // Waste Not: "Whenever an opponent discards a creature card"
    { re: /^When(?:ever)? an opponent discards an? (creature|land|noncreature, nonland|artifact|instant or sorcery) card,? /i,
      event: 'opponentDiscards', extraOf: (m) => ({ discardWords: m[1].toLowerCase().replace(/,\s*/g, ' ') }) },
    { re: /^When(?:ever)? a player discards a card,? /i, event: 'anyDiscard' },
    { re: /^When(?:ever)? (?:this creature|~|CARDNAME) deals combat damage to an opponent,? /i, event: 'combatDamageToPlayer', self: true },
    { re: /^At the beginning of each opponent's end step,? /i, event: 'eachEndStep', extra: { notYourTurn: true } },
    { re: /^At the beginning of combat on each opponent's turn,? /i, event: 'eachCombatBegin', extra: { notYourTurn: true } },
    { re: /^When(?:ever)? you(?:'re| are) dealt damage,? /i, event: 'playerDealtDamage', extra: { youOnly: true } },
    { re: /^When(?:ever)? you lose life,? /i, event: 'youLoseLife' },
    { re: /^At the beginning of each player's (?:first|precombat) main phase,? /i, event: 'eachMain1' },
    /* "Whenever this creature deals combat damage to a creature, destroy
       that creature": "that creature" is the one it hit */
    { re: /^When(?:ever)? (?:this creature|~|CARDNAME) deals (combat )?damage to a creature,? /i, event: 'dealsDamageToCreature', self: true,
      aboutObject: true, extraOf: (m) => (/combat/i.test(m[0]) ? { combatOnly: true } : {}) },
    { re: /^When(?:ever)? (?:this creature|~|CARDNAME) becomes monstrous,? /i, event: 'becomesMonstrous', self: true },
    { re: /^When(?:ever)? you scry or surveil,? /i, event: 'youScry', also: 'youSurveil' },
    { re: /^When(?:ever)? you scry,? /i, event: 'youScry' },
    { re: /^When(?:ever)? you surveil,? /i, event: 'youSurveil' },
    { re: /^When(?:ever)? an opponent discards a card,? /i, event: 'opponentDiscards' },
    /* battalion, by its words: "Whenever this creature and at least two other creatures attack" */
    { re: /^When(?:ever)? (?:this creature|~|CARDNAME) and at least (one|two|three|four) other creatures attack,? /i,
      event: 'attacks', self: true, extraOf: (m) => ({ minAttackers: num(m[1]) + 1 }) },
    { re: /^When(?:ever)? (?:this creature|~|CARDNAME) is put into your graveyard from the battlefield,? /i, event: 'dies', self: true },
    { re: /^When(?:ever)? a creature you control becomes blocked,? /i, event: 'becomesBlocked', filt: () => ({ who: 'you', words: 'creature' }) },
    { re: /^When(?:ever)? an opponent casts their second spell each turn(?:,| )/i, event: 'opponentSecondSpell' },
    { re: /^At the beginning of your next end step(?:,| )/i, event: 'yourEndStep' },
    { re: /^At the beginning of the next end step(?:,| )/i, event: 'eachEndStep' },
    { re: /^At the beginning of your next main phase(?:,| )/i, event: 'yourMain1' },
    { re: /^At the beginning of each player'?s upkeep(?:,| )/i, event: 'eachUpkeep' },
    { re: /^When(?:ever)? equipped creature dies(?:,| )/i, event: 'equippedDies' },
    { re: /^When(?:ever)? enchanted creature dies(?:,| )/i, event: 'equippedDies' },
    { re: /^When(?:ever)? (?:this creature|this permanent|this artifact|this enchantment|~|CARDNAME) enters(?: the battlefield)?(?:,| )/i, event: 'etb', self: true },
    { re: /^When(?:ever)? (?:this creature|this permanent|~|CARDNAME) dies(?:,| )/i, event: 'dies', self: true },
    // (before "attacks", which would read the rest as the effect)
    { re: /^When(?:ever)? (?:this creature|~|CARDNAME) attacks and isn'?t blocked,? /i, event: 'attacksUnblocked', self: true },
    { re: /^When(?:ever)? (?:this creature|~|CARDNAME) attacks(?:,| )/i, event: 'attacks', self: true },
    { re: /^When(?:ever)? (?:this creature|~|CARDNAME) blocks(?:,| )/i, event: 'blocks', self: true },
    { re: /^When(?:ever)? (?:this creature|~|CARDNAME) deals combat damage to a player or planeswalker,? /i, event: 'combatDamageToPlayer', also: 'combatDamageToPlaneswalker', self: true },
    { re: /^When(?:ever)? (?:this creature|~|CARDNAME) deals combat damage to a player(?:,| )/i, event: 'combatDamageToPlayer', self: true },
    { re: /^Whenever (?:a|another) creature you control deals combat damage to a player(?:,| )/i, event: 'yourCreatureCombatDamage' },
    { re: /^Whenever one or more creatures you control deal combat damage to a player(?:,| )/i, event: 'yourCreatureCombatDamage' },
    { re: /^When(?:ever)? (?:this creature|this land|this artifact|this permanent|~|CARDNAME) becomes tapped(?:,| )/i, event: 'becomesTapped', self: true },
    { re: /^When(?:ever)? (?:this creature|this land|this artifact|this permanent|~|CARDNAME) becomes untapped(?:,| )/i, event: 'becomesUntapped', self: true },
    { re: /^When(?:ever)? (?:this permanent|this creature|~|CARDNAME) leaves the battlefield(?:,| )/i, event: 'ltb', self: true },
    { re: /^When(?:ever)? another creature enters(?: the battlefield)?(?: under your control)?(?:,| )/i, event: 'otherCreatureEtb' },
    { re: /^When(?:ever)? a creature enters(?: the battlefield)?(?: under your control)?(?:,| )/i, event: 'anyCreatureEtb' },
    { re: /^When(?:ever)? a(?:nother)? creature you control dies(?:,| )/i, event: 'yourCreatureDies' },
    { re: /^When(?:ever)? a creature dies(?:,| )/i, event: 'anyCreatureDies' },
    { re: /^When(?:ever)? a land enters(?: the battlefield)? under your control(?:,| )/i, event: 'landfall' },
    { re: /^When(?:ever)? you (?:cast|play) (?:a|an|your first) ([a-z ]*?)spell(?:,| )/i, event: 'youCastSpell' },
    { re: /^When(?:ever)? an opponent casts a spell(?:,| )/i, event: 'opponentCastSpell' },
    { re: /^When(?:ever)? you gain life(?:,| )/i, event: 'youGainLife' },
    { re: /^When(?:ever)? you draw a card(?:,| )/i, event: 'youDraw' },
    // Spiteful Visions: "Whenever a player draws a card"
    { re: /^When(?:ever)? a player draws a card(?:,| )/i, event: 'anyDraw' },
    { re: /^At the beginning of your upkeep(?:,| )/i, event: 'yourUpkeep' },
    { re: /^At the beginning of each upkeep(?:,| )/i, event: 'eachUpkeep' },
    { re: /^At the beginning of your end step(?:,| )/i, event: 'yourEndStep' },
    { re: /^At the beginning of (?:the|each) end step(?:,| )/i, event: 'eachEndStep' },
    { re: /^At the beginning of your first main phase(?:,| )/i, event: 'yourMain1' },
    { re: /^When(?:ever)? this creature mutates(?:,| )/i, event: 'mutates', self: true },
    { re: /^When this Class becomes level (\d+)(?:,| )/i, event: 'classLevel', self: true, atLevel: true },
    { re: /^When(?:ever)? CARDNAME mutates(?:,| )/i, event: 'mutates', self: true },
    { re: /^At the beginning of each end step(?:,| )/i, event: 'eachEndStep' },
    { re: /^At the beginning of your draw step(?:,| )/i, event: 'yourDrawStep' },
    { re: /^At the beginning of combat on your turn(?:,| )/i, event: 'yourCombatBegin' },
    { re: /^At the beginning of each combat(?:,| )/i, event: 'eachCombatBegin' },
    { re: /^When(?:ever)? a player sacrifices a permanent(?:,| )/i, event: 'anySacrifice' },
    { re: /^When(?:ever)? you commit a crime(?:,| )/i, event: 'youCommitCrime' },
    { re: /^When(?:ever)? you draw your second card each turn(?:,| )/i, event: 'youDraw', extra: { drawNth: 2 } },
    { re: /^When(?:ever)? (?:this creature|CARDNAME) becomes crewed(?: for the first time each turn)?(?:,| )/i, event: 'becomesCrewed', self: true },
    { re: /^When(?:ever)? (?:this creature|CARDNAME) becomes saddled(?: for the first time each turn)?(?:,| )/i, event: 'becomesSaddled', self: true },
    { re: /^When(?:ever)? (?:one or more \+1\/\+1 counters are put on|you put one or more \+1\/\+1 counters on) (?:this creature|CARDNAME)(?:,| )/i, event: 'countersPut', self: true,
      extra: { counterKind: '+1/+1' } },
    /* Fathom Mage: "Whenever a +1/+1 counter is put on this creature" —
       once for each counter */
    { re: /^When(?:ever)? an? \+1\/\+1 counter is put on (?:this creature|CARDNAME)(?:,| )/i, event: 'countersPut', self: true,
      extra: { counterKind: '+1/+1', perAmount: true } },
    { re: /^When(?:ever)? you put one or more \+1\/\+1 counters on (?:a|another) creature you control(?:,| )/i, event: 'countersPut',
      filt: (m) => ({ words: 'creature', who: 'you', other: /another/i.test(m[0]) }), extra: { counterKind: '+1/+1' } },
    { re: /^When(?:ever)? an opponent searches their library(?:,| )/i, event: 'opponentSearches' },
    { re: /^At the beginning of your precombat main phase(?:,| )/i, event: 'yourMain1' },
    { re: /^At the beginning of each opponent'?s upkeep(?:,| )/i, event: 'opponentUpkeep' },
    { re: /^At the beginning of your (?:postcombat )?main phase(?:,| )/i, event: 'yourMain1' },
    { re: /^Whenever a player plays a land,? /i, event: 'anyPlayLand' },
    { re: /^Whenever an opponent plays a land,? /i, event: 'opponentPlaysLand' },
    // Twenty-Toed Toad, Aurelia: "Whenever you / a player attack(s) with three or more creatures"
    { re: /^Whenever you attack with (two|three|four|five|six|\d+) or more creatures,? /i, event: 'youAttack', extraOf: (m) => ({ minAttackers: num(m[1]) }) },
    { re: /^Whenever a player attacks with (two|three|four|five|six|\d+) or more creatures,? /i, event: 'anyPlayerAttacks', extraOf: (m) => ({ minAttackers: num(m[1]) }) },
    { re: /^When(?:ever)? you attack(?:,| )/i, event: 'youAttack' },
    { re: /^When(?:ever)? (?:a|one or more) creatures? you control attacks?(?:,| )/i, event: 'yourCreatureAttacks' },
    { re: /^When(?:ever)? (?:this creature|~|CARDNAME) becomes blocked(?:,| )/i, event: 'becomesBlocked', self: true },
    { re: /^When(?:ever)? (?:this creature|~|CARDNAME) becomes the target of a spell or ability(?:,| )/i, event: 'becomesTarget', self: true },
    { re: /^When(?:ever)? (?:this creature|~|CARDNAME) deals damage(?:,| )/i, event: 'dealsDamage', self: true },
    { re: /^When(?:ever)? you sacrifice (?:a|another) (?:permanent|creature)(?:,| )/i, event: 'youSacrifice' },
    { re: /^When(?:ever)? you cast your first spell (?:during|each) (?:each turn|turn|opponent'?s turn)(?:,| )/i, event: 'firstSpellEachTurn' },
    { re: /^At end of combat(?:,| )/i, event: 'endOfCombat' },
    { re: /^When(?:ever)? an? (?:artifact|enchantment) enters(?: the battlefield)?(?: under your control)?(?:,| )/i, event: 'permanentEtb' },
    { re: /^When(?:ever)? (?:this creature|~|CARDNAME) transforms(?:,| )/i, event: 'transforms', self: true },
  ];

  /* ---------------- the main analyser ---------------- */

  /**
   * analyze(card) -> {
   *   types, subtypes, supertypes,
   *   isPermanent, isLand, isCreature, ...
   *   keywords: [{keyword, arg}],
   *   abilities: [ability...],
   *   manaAbilities: [ability...],
   *   autoCoverage: 0..1     how much of the card the engine can run itself
   * }
   */
  const cache = new Map();
  function analyze(card, faceIndex) {
    if (!card) return null;
    const key = card.id + ':' + (faceIndex || 0);
    if (cache.has(key)) return cache.get(key);
    const res = _analyze(card, faceIndex || 0);
    cache.set(key, res);
    /* A card is only as automated as its other face: Venat transforms
       into Hydaelyn, an adventure is cast from the same card. If the side
       the card can turn into still needs a person, so does the card. */
    if (!faceIndex && res.fullyAutomated && card.card_faces && card.card_faces.length > 1 &&
        /^(?:transform|modal_dfc|adventure|split|flip)$/.test(card.layout || '')) {
      const other = analyze(card, 1);
      if (other && !other.fullyAutomated) { res.fullyAutomated = false; res.otherFaceManual = true; }
    }
    return res;
  }

  function faceOf(card, i) {
    if (card.card_faces && card.card_faces.length) {
      // adventure/split: the "main" face is 0; flip/transform also 0 as printed
      return card.card_faces[i] || card.card_faces[0];
    }
    return card;
  }

  /** A Room (CR 709.5): a split enchantment whose halves are doors. */
  function isRoom(card) {
    return !!(card && card.layout === 'split' && card.card_faces && card.card_faces.length === 2 &&
      card.card_faces.every(f => /\bRoom\b/.test(f.type_line || card.type_line || '')));
  }
  /* A Room with both doors unlocked is both halves at once: their words
     together, read as one card, each door's "when you unlock this door"
     kept as its own. */
  function roomBoth(card) {
    const [a, b] = card.card_faces;
    const door = (f, i) => normalizePunct(f.oracle_text || '').replace(/When you unlock this door/g, 'When you unlock door ' + i).replace(/\b[Tt]his Room\b/g, 'CARDNAME');
    return { id: card.id + ':both', name: card.name, layout: 'normal', type_line: a.type_line || card.type_line,
      mana_cost: (a.mana_cost || '') + (b.mana_cost || ''), cmc: card.cmc, colors: card.colors, color_identity: card.color_identity,
      oracle_text: door(a, 0) + '\n' + door(b, 1), keywords: card.keywords || [], legalities: card.legalities, roomOf: card.id };
  }

  function _analyze(card, faceIndex) {
    if (faceIndex === 2 && isRoom(card)) {
      const both = _analyze(roomBoth(card), 0);
      both.isRoom = true; both.roomFull = true;
      return both;
    }
    /* face 3: a Room that came onto the battlefield without being cast, both
       doors locked (CR 709.5d) — nothing but the two unlocks */
    if (faceIndex === 3 && isRoom(card)) {
      const shut = Object.assign({}, _analyze(roomBoth(card), 0));
      shut.isRoom = true; shut.roomLocked = true;
      shut.abilities = card.card_faces.map((f, d) => ({ kind: 'activated', special: 'unlock', door: d, sorcerySpeed: true,
        cost: parseCost(f.mana_cost || '{0}'), effects: [{ op: 'unlockDoor', door: d }], text: `Unlock ${f.name}: ${f.mana_cost || '{0}'}`, auto: true }));
      shut.manaAbilities = []; shut.keywords = []; shut.keywordSet = new Set(); shut.has = () => false;
      shut.entersWithCounters = null;
      return shut;
    }
    const face = faceOf(card, faceIndex);
    const name = face.name || card.name;
    const typeLine = face.type_line || card.type_line || '';
    const tl = parseTypeLine(typeLine);
    const rawText = face.oracle_text || card.oracle_text || '';
    // Scryfall uses typographic apostrophes and dashes; normalise them so the
    // rule patterns below (written with plain ASCII) actually match real cards.
    let text = normalizePunct(rawText)
      .replace(new RegExp(escapeRe(normalizePunct(U.frontName(name))), 'g'), 'CARDNAME');
    // a Room's door: "this door" is the one this half is
    if (isRoom(card)) text = text.replace(/When you unlock this door/g, 'When you unlock door ' + faceIndex).replace(/\b[Tt]his Room\b/g, 'CARDNAME');
    /* A legend calls itself by its short name: "Toski attacks each combat
       if able", "When Loran enters". That is the card talking about itself
       just as much as its full name is. */
    if (tl.supertypes.includes('Legendary')) {
      const full = normalizePunct(U.frontName(name));
      const short = full.includes(',') ? full.split(',')[0].trim()
        : (/^([A-Z][a-z'-]+) (?:of|the|from|to)\b/.exec(full) || [])[1];
      if (short && short.length >= 3 && short !== full && !/^(?:The|A|An)$/.test(short)) {
        text = text.replace(new RegExp('\\b' + escapeRe(short) + '\\b(?!,)', 'g'), 'CARDNAME');
      }
    }

    const out = {
      name, faceIndex,
      typeLine, supertypes: tl.supertypes, types: tl.types, subtypes: tl.subtypes,
      manaCost: face.mana_cost != null ? face.mana_cost : card.mana_cost,
      mv: card.cmc != null ? card.cmc : MANA.cmc(face.mana_cost || ''),
      colors: face.colors || card.colors || [],
      colorIdentity: card.color_identity || [],
      power: face.power != null ? face.power : card.power,
      toughness: face.toughness != null ? face.toughness : card.toughness,
      loyalty: face.loyalty != null ? face.loyalty : card.loyalty,
      defense: face.defense != null ? face.defense : card.defense,
      oracleText: rawText,
      oracleTextParsed: text,
      keywords: [], abilities: [], manaAbilities: [],
      grantedKeywords: new Set(),
    };
    /* What the card is, its own name aside: its cost, card types, numbers
       and words with the name read as CARDNAME and reminder text gone. Two
       cards with the same fingerprint are the same card under two names
       (a Universes Beyond printing and its Universes Within twin). */
    out.fingerprint = U.hash([out.manaCost || '', tl.supertypes.join(' '), tl.types.join(' '), out.power || '', out.toughness || '',
      out.loyalty || '', out.defense || '', stripReminder(text).replace(/\s+/g, ' ').trim()].join('|'));

    out.isLand = tl.types.includes('Land');
    out.isCreature = tl.types.includes('Creature');
    out.isArtifact = tl.types.includes('Artifact');
    out.isEnchantment = tl.types.includes('Enchantment');
    out.isPlaneswalker = tl.types.includes('Planeswalker');
    out.isBattle = tl.types.includes('Battle');
    out.isInstant = tl.types.includes('Instant');
    out.isSorcery = tl.types.includes('Sorcery');
    out.isBasicLand = tl.supertypes.includes('Basic') && out.isLand;
    out.isLegendary = tl.supertypes.includes('Legendary');
    out.isPermanent = out.isLand || out.isCreature || out.isArtifact || out.isEnchantment || out.isPlaneswalker || out.isBattle;
    out.isSpellCard = !out.isLand;
    out.isAura = tl.subtypes.includes('Aura');
    out.isEquipment = tl.subtypes.includes('Equipment');
    out.isVehicle = tl.subtypes.includes('Vehicle');
    out.isSaga = tl.subtypes.includes('Saga');
    out.isToken = tl.types.includes('Token');

    /* --- a land with a basic land type taps for that colour (CR 305.6):
       basics, and the duals, shocks and triomes that only print the rule
       as reminder text --- */
    if (out.isLand && tl.subtypes.some(st => MANA.COLOR_OF_BASIC[st])) {
      const map = MANA.COLOR_OF_BASIC;
      for (const st of tl.subtypes) {
        if (map[st]) out.manaAbilities.push({
          kind: 'mana', auto: true, text: '{T}: Add {' + map[st] + '}.',
          cost: parseCost('{T}'), effects: [{ op: 'addMana', symbols: [map[st]] }],
        });
      }
    }

    /* --- walk the text, line by line --- */
    const lines = groupLines(String(text).split('\n')
      .map(l => l.trim())
      /* A granted ability in quotes can be split across lines, which
         leaves one of them wearing half a quotation mark. The mark is not
         part of the rule. */
      .map(l => {
        const opens = (l.match(/"/g) || []).length;
        if (opens % 2 === 0) return l;
        return l.replace(/^"/, '').replace(/"$/, '');
      })
      .map(stripAbilityWord)
      // a line that is nothing but brackets is reminder text for the line above
      .filter(l => l && !/^\(.*\)$/.test(l))
      /* A line that is a name with its reminder text after it is still
         just a name. */
      .map(l => (/^CARDNAME\s*\([^)]*\)$/.test(l) ? 'CARDNAME' : l))
      /* Some sources print a face's name on a line of its own above its
         rules. A name is not an ability. */
      .filter(l => l !== 'CARDNAME')
      /* Reminder text explains a rule; it is not one. Taken off here so
         that "Creatures you control have trample. (Each of those…)" reads
         as the static ability it is. */
      .map(l => l.replace(/\s*\((?![^()]*\)\s*:)[^()]*\)/g, '').trim())
      .filter(Boolean));
    /* A level band printed over several lines ("LEVEL 1-3", "0/3",
       "Defender") is one band: put it back together. */
    for (let i = 0; i < lines.length; i++) {
      if (!/^LEVEL\s+\d+(?:\s*-\s*\d+|\s*\+)$/i.test(lines[i]) || !/^\d+\/\d+$/.test(lines[i + 1] || '')) continue;
      let j = i + 2;
      const extra = [];
      while (j < lines.length && !/^LEVEL\s+\d+/i.test(lines[j])) extra.push(lines[j++]);
      lines.splice(i, j - i, [lines[i], lines[i + 1]].concat(extra.length ? [extra.join(' ')] : []).join(' '));
    }
    /* Up the Beanstalk: "When this enchantment enters and whenever you cast
       a spell with mana value 5 or greater, draw a card." Two triggers that
       do the same thing: read as two lines. */
    for (let i = 0; i < lines.length; i++) {
      const two = lines[i].match(/^(When(?:ever)? [^,"]+?) and (whenever [^,"]+?), ([^"]+)$/);
      if (!two) continue;
      lines.splice(i, 1, two[1] + ', ' + two[3], 'W' + two[2].slice(1) + ', ' + two[3]);
      i++;
    }
    let totalLines = 0, autoLines = 0;
    const spreeModes = [];
    // "Choose up to five {P} worth of modes": the budget, and the priced modes under it
    let pawBudget = 0;
    const pawModes = [];

    /* A die's results ("1—9 | Draw a card." under "Roll a d20."): the rows
       belong to the line that rolls, read once its ability is */
    const dieTables = [];
    for (let i = 0; i < lines.length; i++) {
      const row = lines[i].match(/^(\d+)(?:\s*[\u2014\u2013-]\s*(\d+))?\s*\|\s*([\s\S]+)$/);
      if (!row) continue;
      let h = i - 1;
      while (h >= 0 && lines[h] === null) h--;
      if (h < 0) continue;
      let tb = dieTables.find(x => x.at === h);
      if (!tb) {
        if (!/\broll(?:s)? a d\d+\b/i.test(lines[h])) continue;
        tb = { at: h, head: lines[h], rows: [] };
        dieTables.push(tb);
      }
      // "1 | Trapped! — You lose 3 life.": the row's name is flavour
      tb.rows.push({ min: +row[1], max: row[2] ? +row[2] : +row[1], text: row[3].trim().replace(/^[A-Z][^—|.]{0,40}?\s*—\s+/, '') });
      lines[i] = null;
    }
    for (let i = lines.length - 1; i >= 0; i--) if (lines[i] === null) lines.splice(i, 1);
    /* Where each line's abilities start, and how much of it was read: a
       generated script can then stand in for just the lines that were not. */
    const lineMarks = [];
    for (const line of lines) {
      lineMarks.push({ text: line, ab: out.abilities.length, mana: out.manaAbilities.length, auto: autoLines });
      totalLines++;
      /* "12+ | {G}, {T}: Add {G} for each creature you control." (station)
         and "Max speed — This creature has double strike." An ordinary
         line that only counts once a condition holds: the line is read on
         its own and the condition is put on whatever it turns out to be. */
      const gateStation = line.match(/^(\d+)\+\s*\|\s*([\s\S]+)$/);
      const gateSpeed = line.match(/^Max speed\s*(?:\u2014|--|-)\s*([\s\S]+)$/i);
      if (gateStation || gateSpeed) {
        const cond = gateStation ? { kind: 'selfCounters', counter: 'charge', n: +gateStation[1] } : { kind: 'maxSpeed' };
        const rest = gateStation ? gateStation[2] : gateSpeed[1];
        if (gateStation) out.stationLevels = (out.stationLevels || []).concat(+gateStation[1]);
        if (gateGranted(out, rest, cond, typeLine, card)) autoLines++;
        continue;
      }
      // Loyalty abilities:  "+1: Draw a card."
      let m = line.match(/^([+-]?[\dX]+|0):\s*([\s\S]+)$/);
      if (m && out.isPlaneswalker) {
        const parsed = parseEffects(m[2]);
        out.abilities.push({
          kind: 'loyalty', cost: { loyalty: m[1] === '0' ? 0 : parseInt(m[1], 10) },
          text: line, effects: parsed.effects, auto: parsed.auto, sorcerySpeed: true,
        });
        if (parsed.auto) autoLines++;
        continue;
      }

      /* A level band (CR 711): "LEVEL 1-3 / 4/4 / trample" says what the
         creature is while it has that many level counters, and some bands
         hand it a whole ability as well. This comes before the activated
         case because a band can have a colon in it. */
      const band = line.match(/^LEVEL\s+(\d+)(?:\s*-\s*(\d+)|\s*\+)\s+(\d+)\/(\d+)\s*([\s\S]*)$/i);
      if (band) {
        const cond = { kind: 'levelRange', min: +band[1] };
        if (band[2]) cond.max = +band[2];
        const [kws, rest] = takeKeywords(band[5] || '');
        const known = kws.filter(k => kwKnown(k) || /^protection from /i.test(k));
        out.abilities.push({
          kind: 'static', text: line, auto: known.length === kws.length,
          effects: [{ op: 'continuous', layer: 7, scope: { self: true }, cond,
            setPt: { p: +band[3], t: +band[4] }, grant: known.length ? known : undefined }],
        });
        let ok = known.length === kws.length;
        if (rest) {
          ok = false;
          /* An ability the band hands out only while the creature is at
             that level. */
          const act = rest.match(/^([^:\n]{1,120}):\s*([\s\S]+)$/);
          if (act && /\{|Sacrifice|Discard|Pay \d+ life|Remove/i.test(act[1]) && !/"/.test(act[1])) {
            const cost = parseCost(act[1]);
            const parsed = parseEffects(act[2]);
            const isMana = isManaAbility(parsed.effects);
            const ab = { kind: isMana ? 'mana' : 'activated', cost, text: rest, levelCond: cond,
              effects: parsed.effects, auto: parsed.auto && costIsAutomatable(cost) };
            if (isMana) out.manaAbilities.push(ab); else out.abilities.push(ab);
            ok = !!ab.auto;
          } else {
            let trig2 = null;
            for (const t of TRIGGER_PATTERNS) if (t.re.test(rest)) { trig2 = t; break; }
            if (trig2) {
              const parsed = parseEffects(rest.replace(trig2.re, '').trim());
              out.abilities.push({ kind: 'triggered', event: trig2.event, also: trig2.also || null,
                self: !!trig2.self, text: rest, effects: parsed.effects, auto: parsed.auto,
                condition: cond });
              ok = parsed.auto;
            } else {
              const st2 = parseStatic(rest, out);
              const asEff = st2 || (() => {
                const p2 = parseEffects(rest);
                return p2.auto && p2.effects.length ? { kind: 'static', auto: true, effects: p2.effects } : null;
              })();
              if (asEff && asEff.auto && (asEff.effects || []).every(e => e.op === 'continuous')) {
                for (const e of asEff.effects) e.cond = e.cond ? [].concat(e.cond, cond) : cond;
                out.abilities.push(Object.assign({}, asEff, { text: rest }));
                ok = true;
              } else {
                out.abilities.push({ kind: 'static', text: rest, auto: false,
                  effects: [{ op: 'manual', text: rest }] });
              }
            }
          }
        }
        if (ok) autoLines++;
        continue;
      }

      /* Channel (Boseiju and its kin): an ability used from the hand by
         discarding the card, cheaper for each legend you control. */
      /* Reinforce N (CR 702.77): discard it for N +1/+1 counters on a
         creature, an ability from the hand like channel */
      const reinf = line.match(/^Reinforce (one|two|three|four|five|X|\d+)\s*(?:\u2014|--|-)\s*((?:\{[^}]+\})+)/i);
      if (reinf && !/X/i.test(reinf[1])) {
        out.channel = { cost: reinf[2], effects: [{ op: 'counters', kind: '+1/+1', n: num(reinf[1]), targets: [targetSpec('target creature')] }] };
        out.abilities.push({ kind: 'castModifier', keyword: 'Channel', arg: reinf[2], text: line, auto: true, effects: [] });
        autoLines++;
        continue;
      }
      // bloodrush is channel by another name: discard it to pump an attacker
      const chan = line.match(/^(?:Channel|Bloodrush)\s*(?:\u2014|--|-)\s*([^:]+):\s*([\s\S]+)$/i) ||
        line.match(/^((?:\{[^}]+\})*,?\s*Discard (?:this card|CARDNAME)):\s*([\s\S]+)$/i);
      if (chan) {
        const cost = parseCost(chan[1]);
        let body = chan[2];
        let reduce = null;
        const red = body.match(/\s*This ability costs \{(\d+)\} less to activate for each ([^.]+)\.?$/i);
        if (red) { reduce = { amount: +red[1], per: countOf(red[2]) }; body = body.slice(0, red.index); }
        const parsed = parseEffects(body);
        const costOk = cost.other.every(x => /^Discard (?:this card|CARDNAME)$/i.test(x)) && (!red || !!reduce.per);
        out.channel = { cost: cost.mana || '', effects: parsed.effects, reduce };
        const okc = parsed.auto && costOk;
        out.abilities.push({ kind: 'castModifier', keyword: 'Channel', arg: cost.mana || '', text: line, auto: okc, effects: [] });
        if (okc) autoLines++;
        continue;
      }

      /* "Exile this card from your hand: Add {R}." The Spirit Guides: a
         mana ability that works from the hand, the card itself the cost. */
      const guide = line.match(/^Exile (?:this card|CARDNAME) from your hand:\s*([\s\S]+)$/i);
      if (guide) {
        const parsed = parseEffects(guide[1]);
        const okg = parsed.auto && parsed.effects.length > 0 && parsed.effects.every(e => MANA_OPS.has(e.op));
        out.channel = { cost: '', effects: parsed.effects, exile: true, mana: okg };
        out.abilities.push({ kind: 'castModifier', keyword: 'Exile from hand', arg: '', text: line, auto: okg, effects: [] });
        if (okg) autoLines++;
        continue;
      }

      // Activated ability:  "cost: effect"
      m = line.match(/^([^:\n]{1,120}):\s*([\s\S]+)$/);
      /* A colon inside quotation marks belongs to an ability the card is
         handing out ("Lands you control have \"{T}: Add {G}.\""), not to an
         ability of the card itself. */
      if (m && /"/.test(m[1])) m = null;
      if (m && /\{|Sacrifice|Discard|Pay \d+ life|Remove|Exile|Tap an? |Tap \w+ untapped|Return|Put an? [-+]\d\/[-+]\d counter on this/i.test(m[1]) && !/^(?:When|Whenever|At|As|If)\b/.test(m[1])) {
        const cost = parseCost(m[1]);
        const parsed = parseEffects(m[2]);
        /* "Activate only if you control five or more lands" is a footnote on
           this ability, printed in the same breath; it is kept with the
           ability rather than run as one of its effects. */
        const only = parsed.effects.filter(e => e.op === 'activateOnly');
        const spend = parsed.effects.find(e => e.op === 'spendOnly');
        const effects = parsed.effects.filter(e => e.op !== 'activateOnly' && e.op !== 'spendOnly');
        const ab = {
          kind: isManaAbility(effects) ? 'mana' : 'activated', cost, text: line,
          effects, auto: parsed.auto && costIsAutomatable(cost),
          sorcerySpeed: /Activate only as a sorcery|and only as a sorcery/i.test(line),
        };
        /* "{1}{B}: Return this card from your graveyard to the battlefield
           tapped." An ability that works from the graveyard and nowhere
           else, offered there the way flashback is. */
        if ((cost.exile && cost.exile.fromGraveyard) ||
            /\b(?:this card|CARDNAME) from your graveyard\b/i.test(m[2])) ab.fromGraveyard = true;
        for (const o of only) {
          ab.only = Object.assign({}, ab.only, o.when ? { when: o.when } : null, o.cond ? { cond: o.cond } : null, o.once ? { once: true } : null,
            o.perTurn ? { perTurn: o.perTurn } : null);
          if (o.anyPlayer) ab.anyPlayer = true;
        }
        /* a rider with no restriction (Path of Ancestry) still travels with the mana */
        if (spend) ab.spendOnly = spend.open ? { rider: spend.rider, open: true } : spend;
        if (ab.kind === 'mana') out.manaAbilities.push(ab); else out.abilities.push(ab);
        if (ab.auto) autoLines++;
        continue;
      }

      // A Saga chapter: "I — ..." or "II, III — ..."
      const chap = line.match(/^([IVX]+(?:\s*,\s*[IVX]+)*)\s*[-\u2014]\s*(.+)$/);
      if (chap && out.isSaga) {
        const chapters = chap[1].split(/\s*,\s*/).map(romanValue).filter(Boolean);
        const parsed = parseEffects(chap[2]);
        out.abilities.push({
          kind: 'chapter', chapters, text: line,
          effects: parsed.effects, auto: parsed.auto,
        });
        if (parsed.auto) autoLines++;
        continue;
      }

      /* Tiered (CR 702.183): "• Cure — {0} — …" lines, a mode each with a
         price of its own, and exactly one of them bought. Spree's
         machinery with a limit of one. */
      const tierHead = !out.isPermanent && line.match(/^Tiered\s*\n([\s\S]+)$/);
      if (tierHead) {
        const rows = tierHead[1].split(/\n/).map(r => r.trim()).filter(Boolean)
          .map(r => r.match(/^\u2022\s*([^\u2014]+?)\s*\u2014\s*((?:\{[^}]+\})+)\s*\u2014\s*([\s\S]+)$/));
        if (rows.length && rows.every(Boolean)) {
          for (const r of rows) {
            const parsed = parseEffects(r[3].trim());
            spreeModes.push({ cost: r[2], label: r[1] + ' \u2014 ' + r[3].trim().replace(/\.$/, ''),
              effects: parsed.effects, auto: parsed.auto });
          }
          out.tiered = true;
          if (spreeModes.every(m => m.auto)) autoLines++;
          continue;
        }
      }
      /* Spree (CR 702.171): each "+ {cost} — effect" line is a mode with a
         price of its own, and you buy at least one as you cast the spell. */
      const spree = line.match(/^\+\s*((?:\{[^}]+\})+)\s*(?:\u2014|--|-)\s*([\s\S]+)$/);
      if (spree) {
        const parsed = parseEffects(spree[2].trim());
        spreeModes.push({ cost: spree[1], label: spree[2].trim().replace(/\.$/, ''),
          effects: parsed.effects, auto: parsed.auto });
        if (parsed.auto) autoLines++;
        continue;
      }

      /* "Choose up to five {P} worth of modes. You may choose the same mode
         more than once." Each "{P}{P} — …" line under it is a mode priced in
         paw prints; which ones, and how often, is a generic question asked
         as the spell resolves (docs/choices.md). */
      const pawHead = !out.isPermanent && line.match(/^Choose up to (\w+) \{P\} worth of modes\.(?:\s*You may choose the same mode more than once\.)?$/i);
      if (pawHead) {
        pawBudget = WORDN(pawHead[1]);
        autoLines++;
        continue;
      }
      const paw = pawBudget && line.match(/^((?:\{P\})+)\s*(?:—|--|-)\s*([\s\S]+)$/);
      if (paw) {
        const parsed = parseEffects(paw[2].trim());
        pawModes.push({ weight: paw[1].length / 3, label: paw[2].trim().replace(/\.$/, ''), effects: parsed.effects, auto: parsed.auto });
        if (parsed.auto) autoLines++;
        continue;
      }

      /* "As this land enters, you may pay 2 life. If you don't, it enters
         tapped." is not a trigger at all: it is decided on the way in
         (CR 614.12), so the replacement reading gets the first look. */
      if (/^As (?:CARDNAME|this (?:land|creature|artifact|enchantment|permanent|Aura)) enters/i.test(line)) {
        const st0 = parseStatic(line, out);
        if (st0 && st0.auto) { out.abilities.push(st0); autoLines++; continue; }
      }

      /* Rite of Harmony: an instant whose words begin "Whenever … this
         turn" is a spell that sets up a trigger, not a trigger itself */
      if (!out.isPermanent && /^(?:Whenever|At the beginning of) [^,"]+? this turn, /.test(line)) {
        const parsed = parseEffects(line);
        out.abilities.push({ kind: 'spell', text: line, effects: parsed.effects, auto: parsed.auto });
        if (parsed.auto) autoLines++;
        continue;
      }
      /* Exert (CR 701.43): "You may exert this creature as it attacks. When
         you do, …" — an attack trigger you may take, exerting it first */
      const ex = line.match(/^(If (?:this creature|CARDNAME) hasn'?t been exerted this turn, )?[Yy]ou may exert (?:this creature|CARDNAME|it) as it attacks\. When you do, ([\s\S]+)$/);
      if (ex) {
        const parsed = parseEffects(ex[2].replace(/^(\w)/, (c) => c.toUpperCase()));
        itIsTheTrigger(parsed.effects, 'self');
        out.abilities.push({ kind: 'triggered', event: 'attacks', self: true, optional: true, exert: true, exertOnce: !!ex[1],
          text: line, effects: [{ op: 'exertSelf' }].concat(parsed.effects), auto: parsed.auto, condition: null });
        if (parsed.auto) autoLines++;
        continue;
      }
      // Triggered ability
      let trig = null, objFilter;
      /* "Whenever this Vehicle attacks", "Whenever this Mount attacks
         while saddled": the permanent itself, whatever it calls itself. */
      let tline = line.replace(/^(When(?:ever)? )this (?:Vehicle|Mount|Spacecraft)\b/, '$1this creature');
      let saddledOnly = false, whileCond = null;
      if (/^When(?:ever)? this creature attacks while saddled,/i.test(tline)) {
        saddledOnly = true;
        tline = tline.replace(/ while saddled,/i, ',');
      }
      const wm = tline.match(/^(When(?:ever)? (?:this creature|CARDNAME) attacks) while (.+?), /i);
      if (wm && condOf(wm[2])) { whileCond = condOf(wm[2]); tline = tline.replace(/ while .+?, /, ', '); }
      for (const t of TRIGGER_PATTERNS) {
        const hit = tline.match(t.re);
        if (!hit) continue;
        /* A general shape names what it is watching; if those words
           cannot be read, a narrower pattern further down may still know
           the line. */
        if (t.filt) { objFilter = t.filt(hit); if (!objFilter) continue; }
        trig = t;
        break;
      }
      if (trig) {
        let body = tline.replace(trig.re, '').trim();
        /* "When this creature dies, return it to the battlefield": "it" is
           the creature that died, and nothing else. */
        if (trig.self && (trig.event === 'dies' || trig.also === 'dies')) {
          body = body.replace(/^((?:if it had [^,]+, )?)return it to (the battlefield|its owner'?s hand)/i, '$1Return CARDNAME to $2');
        }
        // "Whenever this creature attacks, double its power": its own power
        if (trig.self) body = body.replace(/^double its power/i, "double CARDNAME's power");
        /* "This ability triggers only once each turn." is about the
           trigger, not something it does. */
        let oncePerTurn = false;
        if (/\s*This ability triggers only once each turn\.?$/i.test(body)) {
          oncePerTurn = true;
          body = body.replace(/\s*This ability triggers only once each turn\.?$/i, '');
        }
        /* "…you may draw that many cards. Do this only once each turn." The
           choice can only be taken once a turn, which for a "may" is the
           same as the ability only working once a turn. */
        if (/^you may .*\. Do this only once each turn\.?$/i.test(body)) {
          oncePerTurn = true;
          body = body.replace(/\s*Do this only once each turn\.?$/i, '');
        }
        /* An intervening "if" clause (CR 603.4): the trigger only goes on the
           stack when it holds, and is checked again on resolution. */
        let condition = null;
        const iff = body.match(/^if (.+?), (.+)$/i);
        if (iff) {
          const c = condOf(iff[1]);
          if (c) { condition = c; body = iff[2].replace(/^(\w)/, (ch) => ch.toUpperCase()); }
        }
        // "you may X. If you do, Y" is one thought: leave both halves together
        /* "…this way" points back at the sentence before it, so the two
           halves have to be read together rather than one at a time. */
        const linked = /\b(?:If you (?:do|don'?t)|When you do)\b/i.test(body) || /\bthis way\b/i.test(body);
        const optional = !linked && /^you may /i.test(body);
        const parsed = parseEffects(optional ? body.replace(/^you may /i, '').replace(/^(\w)/, (c) => c.toUpperCase()) : body);
        if (saddledOnly) condition = condition ? [].concat(condition, { kind: 'saddled' }) : { kind: 'saddled' };
        if (whileCond) condition = condition ? [].concat(condition, whileCond) : whileCond;
        /* "Whenever this creature attacks, it gets +2/+0": with nothing
           targeted, "it" is the creature the trigger is about, this one or
           the one that set it off, not a target that was never chosen */
        itIsTheTrigger(parsed.effects, trig.aboutObject ? 'triggerObject' : trig.self ? 'self' : (objFilter ? 'triggerObject' : null));
        const lvlHit = trig.atLevel ? line.match(trig.re) : null;
        out.abilities.push({
          kind: 'triggered', event: trig.event, also: trig.also || null, self: !!trig.self, optional,
          text: line, effects: parsed.effects, auto: parsed.auto, condition,
          atLevel: lvlHit ? +lvlHit[1] : undefined,
          objFilter: objFilter || undefined, oncePerTurn: oncePerTurn || undefined,
          ...(trig.extra || {}), ...(trig.extraOf ? trig.extraOf(line.match(trig.re)) : {}),
          intervening: !condition && /if |unless /i.test(body.split('.')[0] || ''),
        });
        if (parsed.auto) autoLines++;
        continue;
      }

      /* Gift (CR 702.174): as the spell is cast you may promise an opponent
         a present, and the card does more if you did. What they get is kept
         on the analysis; casting asks the question and resolution hands it
         over. */
      const giftLine = line.match(/^Gift (a card|an extra turn|an? (?:tapped )?(?:Fish|Food|Treasure|Clue|Octopus))$/i);
      if (giftLine) {
        out.gift = giftLine[1].replace(/^an? /i, '').toLowerCase();
        out.abilities.push({ kind: 'castModifier', keyword: 'Gift', arg: out.gift, text: line, auto: true, effects: [] });
        autoLines++;
        continue;
      }

      /* Craft (CR 702.167): "Craft with artifact {3}{W}" — pay, exile this
         and the materials (other permanents you control and/or cards in
         your graveyard), and it returns transformed. The materials are
         chosen as the ability resolves. */
      const craft = line.match(/^Craft with (.+?) ((?:\{[^}]+\})+)$/i);
      if (craft) {
        const mat = String(craft[1]).trim();
        let spec = null, mm;
        const one = (w) => w.replace(/^an? /i, '').trim();
        if ((mm = mat.match(/^one or more ([a-z]+?)s?$/i))) spec = { words: mm[1] === 'creature' || mm[1] === 'Dinosaur' ? mm[1] : mm[1], min: 1, max: 99 };
        else if (/^one or more$/i.test(mat)) spec = { words: 'permanent', min: 1, max: 99 };
        else if ((mm = mat.match(/^(two|three|four|five|six) ([a-z]+?)s$/i))) spec = { words: mm[2], min: num(mm[1]), max: num(mm[1]) };
        else if (/^(?:an? )?[A-Za-z]+$/.test(mat)) spec = { words: one(mat), min: 1, max: 1 };
        if (spec && /^dinosaur$/i.test(spec.words)) spec.words = 'Dinosaur';
        out.abilities.push({ kind: 'activated', cost: parseCost(craft[2]), sorcerySpeed: true, craft: spec,
          effects: [{ op: 'craft', materials: spec }], text: line, auto: !!spec });
        if (spec) autoLines++;
        continue;
      }
      /* Partner with NAME (CR 702.124j): a deck rule, and as it enters you
         may search your library for the partner, reveal it and take it */
      if (/^Partner\s*(?:\u2014|-)\s*(?:Friends forever|Character select|Survivors)$/i.test(line)) {
        out.keywords.push({ keyword: 'Partner', arg: null, text: line });
        autoLines++;
        continue;
      }
      const pw = line.match(/^Partner with ([^(]+?)\s*$/);
      if (pw) {
        out.keywords.push({ keyword: 'Partner with', arg: pw[1], text: line });
        out.abilities.push({ kind: 'triggered', event: 'etb', self: true, optional: true, text: line,
          effects: [{ op: 'tutor', n: 1, filter: 'named', named: pw[1].trim(), to: 'hand', reveal: true }], auto: true });
        autoLines++;
        continue;
      }
      /* Keyword line? A keyword whose cost has a comma in it ("Escape—{2}{B},
         Exile three other cards from your graveyard") has to be read whole
         before the line is cut up at its commas. */
      const whole = matchKeyword(line);
      const clauses = whole ? [line] : splitKeywordLine(line);
      const kws = whole ? [whole] : clauses.map(matchKeyword);
      if (kws.length && kws.every(Boolean)) {
        for (const k of kws) {
          out.keywords.push(k);
          // "Mountaincycling {2}" is cycling with a different pay-off
          const cycles = /cycling$/i.test(k.keyword) && !!k.arg;
          const lower = k.keyword.toLowerCase();
          /* Partner, Choose a Background: rules for building the deck,
             which do nothing once the game is under way */
          const deckOnly = !k.arg && ['partner', 'friends forever', 'choose a background', "doctor's companion"].includes(lower);
          if (IMPLEMENTED_LOWER.has(lower) || RUN_CAST_LOWER.has(lower) || cycles || deckOnly) {
            autoLines += 1 / kws.length;
          }
          /* "Level up {2}{G}" is an activated ability with a sorcery-speed
             restriction, not a way of casting the card (CR 702.87). */
          if (lower === 'level up' && k.arg) {
            out.abilities.push({ kind: 'activated', cost: parseCost(k.arg),
              text: k.text, sorcerySpeed: true, auto: true,
              effects: [{ op: 'counters', kind: 'level', n: 1, scope: 'self' }] });
            autoLines += 1 / kws.length;
            continue;
          }
          /* The keywords that are really an ability of their own, written out
             as the ability the rules say they are. */
          const kn = parseInt(k.arg, 10);
          const blank = () => ({ mana: '', tap: false, untap: false, sacSelf: false, sacrifice: null, discard: null, life: 0,
            exile: null, removeCounters: null, other: [], raw: '' });
          const gen = (ab) => { out.abilities.push(Object.assign({ auto: true, text: k.text }, ab)); autoLines += 1 / kws.length; };
          // Crew N (CR 702.122): tap other creatures with total power N, and it is a creature for the turn
          if (lower === 'crew' && kn >= 0) {
            gen({ kind: 'activated', cost: Object.assign(blank(), { raw: 'Crew ' + kn, tapCreatures: { n: 'any', totalPower: kn, filter: 'creature', another: true } }),
              effects: [{ op: 'crewed' }] });
            continue;
          }
          // Saddle N (CR 702.171): the same, as a sorcery, and it is saddled
          if (lower === 'saddle' && kn >= 0) {
            gen({ kind: 'activated', sorcerySpeed: true, cost: Object.assign(blank(), { raw: 'Saddle ' + kn, tapCreatures: { n: 'any', totalPower: kn, filter: 'creature', another: true } }),
              effects: [{ op: 'saddled' }] });
            continue;
          }
          // Echo (CR 702.30): pay it again at your next upkeep or lose it
          if (lower === 'echo' && k.arg) {
            gen({ kind: 'triggered', event: 'yourUpkeep', condition: { kind: 'echoDue' }, effects: [{ op: 'echo', cost: k.arg }] });
            continue;
          }
          // Bushido N (CR 702.45)
          if (lower === 'bushido' && kn > 0) {
            gen({ kind: 'triggered', event: 'blocks', also: 'becomesBlocked', self: true,
              effects: [{ op: 'pump', p: kn, t: kn, duration: 'eot', scope: 'self' }] });
            continue;
          }
          // Living weapon (CR 702.92) and For Mirrodin! (CR 702.163): a body to carry it
          if (lower === 'living weapon' || lower === 'for mirrodin!') {
            gen({ kind: 'triggered', event: 'etb', self: true,
              effects: [lower === 'living weapon'
                ? { op: 'germ', pt: '0/0', colorWords: ['black'], subtypes: 'Phyrexian Germ' }
                : { op: 'germ', pt: '2/2', colorWords: ['red'], subtypes: 'Rebel' }] });
            continue;
          }
          // Soulshift N (CR 702.46)
          if (lower === 'soulshift' && kn >= 0) {
            gen({ kind: 'triggered', event: 'dies', self: true, optional: true,
              effects: [{ op: 'regrowth', targets: [{ type: 'permanent', zone: 'graveyard', controller: 'you', filter: 'Spirit card', subtypes: ['spirit'], maxMv: kn }] }] });
            continue;
          }
          // Outlast (CR 702.107)
          if (lower === 'outlast' && k.arg) {
            const cost = parseCost(k.arg + ', {T}');
            gen({ kind: 'activated', sorcerySpeed: true, cost, effects: [{ op: 'counters', kind: '+1/+1', n: 1, scope: 'self' }] });
            continue;
          }
          // Fading (CR 702.32) and vanishing (CR 702.63): a clock of counters
          if ((lower === 'fading' || lower === 'vanishing') && kn > 0) {
            const kind = lower === 'fading' ? 'fade' : 'time';
            out.entersWithCounters = { kind, n: kn };
            gen({ kind: 'triggered', event: 'yourUpkeep', effects: [{ op: 'clockTick', kind, vanishing: lower === 'vanishing' }] });
            continue;
          }
          // Rampage N (CR 702.23): +N/+N for each blocker after the first
          if (lower === 'rampage' && kn > 0) {
            gen({ kind: 'triggered', event: 'becomesBlocked', self: true, effects: [{ op: 'rampage', n: kn }] });
            continue;
          }
          // Ingest (CR 702.115): the player it hits exiles their top card
          if (lower === 'ingest') {
            gen({ kind: 'triggered', event: 'combatDamageToPlayer', self: true, effects: [{ op: 'impulse', n: 1, whose: 'triggerPlayer', play: false }] });
            continue;
          }
          // Unleash (CR 702.98): a counter if you like, and then it can't block
          if (lower === 'unleash') {
            gen({ kind: 'static', effects: [{ op: 'unleash' },
              { op: 'continuous', layer: 6, scope: { self: true }, flag: 'cantBlock', cond: { kind: 'selfCounters', counter: '+1/+1', n: 1 } }] });
            continue;
          }
          // Renown N (CR 702.112)
          if (lower === 'renown' && kn > 0) {
            gen({ kind: 'triggered', event: 'combatDamageToPlayer', self: true, condition: { kind: 'notRenowned' },
              effects: [{ op: 'counters', kind: '+1/+1', n: kn, scope: 'self' }, { op: 'renowned' }] });
            continue;
          }
          /* Impending N (CR 702.176): cast for less, it waits with time
             counters and is not a creature until they are gone. */
          if (lower === 'impending' && k.arg) {
            const im = String(k.arg).match(/^(\d+)\s*[\u2014-]\s*((?:\{[^}]+\})+)$/);
            if (im) {
              out.impending = { n: +im[1], cost: im[2] };
              out.abilities.push({ kind: 'castModifier', keyword: 'Impending', arg: k.arg, text: k.text, auto: true });
              out.abilities.push({ kind: 'triggered', event: 'yourEndStep', auto: true, condition: { kind: 'selfCounters', counter: 'time', n: 1 },
                text: "At the beginning of your end step, if this permanent's impending, remove a time counter from it.",
                effects: [{ op: 'counters', kind: 'time', n: -1, scope: 'self' }] });
              autoLines += 1 / kws.length;
              continue;
            }
          }
          /* Prototype (CR 702.160): a smaller version for a smaller price */
          if (lower === 'prototype' && k.arg) {
            const pm = String(k.arg).match(/^((?:\{[^}]+\})+)\s*[\u2014-]\s*(\d+)\/(\d+)$/);
            if (pm) {
              out.prototype = { cost: pm[1], power: pm[2], toughness: pm[3] };
              out.abilities.push({ kind: 'castModifier', keyword: 'Prototype', arg: k.arg, text: k.text, auto: true });
              autoLines += 1 / kws.length;
              continue;
            }
          }
          /* Increment: a spell that cost more than this creature's power or
             toughness puts a +1/+1 counter on it. */
          if (lower === 'increment') {
            out.abilities.push({ kind: 'triggered', event: 'youCastSpell', auto: true, text: 'Increment',
              effects: [{ op: 'increment' }] });
            autoLines += 1 / kws.length;
            continue;
          }
          /* Station (CR 702.184): tap another creature you control, and put
             charge counters equal to its power on this, as a sorcery. */
          if (lower === 'station') {
            out.abilities.push({ kind: 'activated', text: 'Station', sorcerySpeed: true, auto: true,
              cost: { mana: '', tap: false, untap: false, sacSelf: false, sacrifice: null, discard: null, life: 0, exile: null,
                removeCounters: null, other: [], raw: 'Tap another creature you control', tapCreatures: { n: 1, filter: 'creature', another: true } },
              effects: [{ op: 'counters', kind: 'charge', n: { ofTapped: 'power' }, scope: 'self' }] });
            autoLines += 1 / kws.length;
            continue;
          }
          /* Scavenge (CR 702.97): exiled from the graveyard as a sorcery,
             it leaves its power behind as +1/+1 counters. */
          if (lower === 'scavenge' && k.arg && /^\d+$/.test(String(out.power))) {
            const cost = parseCost(k.arg);
            cost.exile = { what: 'self', fromGraveyard: true };
            out.abilities.push({ kind: 'activated', cost, text: k.text, sorcerySpeed: true, auto: true, fromGraveyard: true,
              effects: [{ op: 'counters', kind: '+1/+1', n: +out.power, targets: [targetSpec('target creature')] }] });
            autoLines += 1 / kws.length;
            continue;
          }
          if (CAST_LOWER.has(lower) || cycles) {
            out.abilities.push({ kind: 'castModifier', keyword: k.keyword, arg: k.arg, text: k.text,
              auto: RUN_CAST_LOWER.has(lower) || cycles });
          }
        }
        continue;
      }

      /* Another way to pay for it: offered by the engine as a way to cast
         the card, like flashback or evoke. */
      if (/rather than pay|without paying its mana cost/i.test(line) && !/^When|^Whenever|^At /i.test(line)) {
        const alt = parseAltCost(line);
        if (alt) {
          (out.altCosts = out.altCosts || []).push(alt);
          out.abilities.push({ kind: 'castModifier', text: line, auto: true, effects: [] });
          autoLines++;
          continue;
        }
      }

      /* An extra price for casting the spell: kept on the analysis, where
         casting reads it, and paid by the table rather than by hand. */
      const extraCost = parseAdditionalCost(line);
      if (extraCost !== undefined) {
        if (extraCost) out.additionalCost = extraCost;
        out.abilities.push({ kind: 'castModifier', text: line, auto: !!extraCost, effects: [] });
        if (extraCost) autoLines++;
        continue;
      }

      // Static ability we can partly understand
      const st = parseStatic(line, out);
      if (st) { out.abilities.push(st); if (st.auto) autoLines++; continue; }

      // Strive: "This spell costs {1}{U} more to cast for each target beyond the first."
      const strive = !out.isPermanent && line.match(/^(?:This spell|CARDNAME) costs ((?:\{[^}]+\})+) more to cast for each target beyond the first\.?$/i);
      if (strive) {
        out.strive = strive[1];
        out.abilities.push({ kind: 'castModifier', keyword: 'Strive', arg: strive[1], text: line, auto: true, effects: [] });
        autoLines++;
        continue;
      }
      /* A line about what the spell costs is read by the cost machinery,
         not by the effect vocabulary — on an instant as much as on a
         permanent, so this comes before the "the line is the spell" case. */
      if (/^(?:This spell|CARDNAME) costs \{[\dX]+\} (?:less|more) to cast/i.test(line)) {
        const sc = parseSelfCost(line);
        if (sc) (out.selfCost = out.selfCost || []).push(sc);
        out.abilities.push({ kind: 'castModifier', text: line, auto: !!sc, effects: [] });
        if (sc) autoLines++;
        continue;
      }

      /* Aftermath (CR 702.127): this half is cast only from the graveyard,
         then exiled, which the table offers there */
      if (!out.isPermanent && /^Aftermath$/i.test(line)) {
        out.abilities.push({ kind: 'castModifier', keyword: 'Aftermath', text: line, auto: true, effects: [] });
        autoLines++;
        continue;
      }
      /* Spider Climb: "You may cast this spell as though it had flash. If you
         cast it any time a sorcery couldn't have been cast, the controller of
         the permanent it becomes sacrifices it at the beginning of the next
         cleanup step." Flash, with the price kept on the permanent. */
      if (/^You may cast this spell as though it had flash\. If you cast it any time a sorcery couldn'?t have been cast, the controller of the permanent it becomes sacrifices it at the beginning of the next cleanup step\.?$/i.test(line)) {
        out.flashSacrifice = true;
        out.abilities.push({ kind: 'castModifier', keyword: 'Flash', text: line, auto: true, effects: [] });
        autoLines++;
        continue;
      }
      /* Escalate (CR 702.120): the cost of each mode beyond the first —
         the modes are chosen and paid for as the spell is cast */
      const esc = !out.isPermanent && line.match(/^Escalate ((?:\{[^}]+\})+)$/i);
      if (esc) {
        out.escalate = esc[1];
        out.abilities.push({ kind: 'castModifier', keyword: 'Escalate', arg: esc[1], text: line, auto: true, effects: [] });
        autoLines++;
        continue;
      }
      // Fuse (CR 702.102): both halves of a split card cast together from hand, which the table offers
      if (!out.isPermanent && /^Fuse$/i.test(line)) {
        out.abilities.push({ kind: 'castModifier', keyword: 'Fuse', text: line, auto: true, effects: [] });
        autoLines++;
        continue;
      }
      if (!out.isPermanent && /^Affinity for [a-z ]+$/i.test(line)) {
        out.abilities.push({ kind: 'castModifier', text: line, auto: true, effects: [] });
        autoLines++;
        continue;
      }
      // For an instant or sorcery the line IS the spell's effect.
      if (!out.isPermanent) {
        const parsed = parseEffects(line);
        out.abilities.push({ kind: 'spell', text: line, effects: parsed.effects, auto: parsed.auto });
        if (parsed.auto) autoLines++;
        continue;
      }

      // the cost machinery reads these lines itself, so they are not misses
      if (/^(?:This spell|CARDNAME) costs \{\d+\} (?:less|more) to cast/i.test(line) ||
          /^As an additional cost to cast this spell/i.test(line) ||
          /^Affinity for /i.test(line)) {
        out.abilities.push({ kind: 'castModifier', text: line, auto: true, effects: [] });
        autoLines++;
        continue;
      }

      /* A permanent's unparsed line might still be something the effect
         vocabulary understands as a standing rule — a spell tax, an extra land
         drop, a skipped step. Only ops that mean something as a static ability
         are accepted here; a line that parses as "draw a card" is not one. */
      const asEffect = parseEffects(line);
      if (asEffect.auto && asEffect.effects.every(e => STATIC_OPS.has(e.op))) {
        out.abilities.push({ kind: 'static', text: line, auto: true, effects: asEffect.effects });
        autoLines++;
        continue;
      }

      // Unparsed: manual
      out.abilities.push({ kind: 'static', text: line, auto: false, effects: [{ op: 'manual', text: line }] });
    }

    const lineInfo = lineMarks.map((mk, i) => {
      const nx = lineMarks[i + 1] || { ab: out.abilities.length, mana: out.manaAbilities.length, auto: autoLines };
      const got = nx.auto - mk.auto;
      return { text: mk.text, got, auto: got >= 0.999,
        abilities: out.abilities.slice(mk.ab, nx.ab), mana: out.manaAbilities.slice(mk.mana, nx.mana) };
    });
    Object.defineProperty(out, 'lineInfo', { value: lineInfo, enumerable: false, configurable: true });

    /* Overload (CR 702.96): the same spell with every "target" turned into
       "each", read now so casting it that way has something to run. */
    const ovl = out.abilities.find(x => x.kind === 'castModifier' && /^overload$/i.test(x.keyword || '') && x.arg);
    if (ovl) {
      const each = out.abilities.filter(x => x.kind === 'spell').map(x => x.text).join(' ')
        .replace(/\btarget\b/g, 'each').replace(/\bTarget\b/g, 'Each');
      const parsed = each ? parseEffects(each) : null;
      if (parsed && parsed.auto && parsed.effects.length) {
        out.overloadEffects = parsed.effects;
        ovl.auto = true;
        autoLines++;
      }
    }

    /* A Class card is a stack of levels: everything printed after
       "{1}{W}: Level 2" belongs to level 2 and does nothing before you
       have paid for it (CR 716.2). The lines come in printed order, so the
       marker that came last is the level a line belongs to. */
    {
      const marks = [];
      out.abilities.forEach((ab, i) => {
        const lv = (ab.effects || []).find(e => e.op === 'classLevel');
        if (lv) marks.push({ from: i + 1, level: lv.to });
      });
      if (marks.length) {
        out.isClass = true;
        for (let i = 0; i < out.abilities.length; i++) {
          let level = 0;
          for (const mk of marks) if (mk.from <= i) level = mk.level;
          if (level < 2) continue;
          const ab = out.abilities[i];
          if ((ab.effects || []).some(e => e.op === 'classLevel')) continue;
          const cond = { kind: 'levelRange', min: level - 1 };
          if (ab.kind === 'triggered') ab.condition = ab.condition ? [].concat(ab.condition, cond) : cond;
          else if (ab.kind === 'activated' || ab.kind === 'mana') ab.levelCond = cond;
          else for (const e of (ab.effects || [])) {
            if (e.op === 'continuous') e.cond = e.cond ? [].concat(e.cond, cond) : cond;
          }
        }
        /* And a level can only be bought when you are on the one before. */
        for (const ab of out.abilities) {
          const lv = (ab.effects || []).find(e => e.op === 'classLevel');
          if (!lv) continue;
          ab.sorcerySpeed = true;
          ab.levelCond = { kind: 'levelRange', min: lv.to - 2, max: lv.to - 2 };
        }
      }
    }

    /* The spree modes are one spell between them: you pick the ones you
       paid for as it resolves. */
    if (spreeModes.length) {
      out.spreeModes = spreeModes.map((m, i) => ({ i, cost: m.cost, label: m.label }));
      if (out.tiered) out.spreeOne = true;
      out.abilities.push({
        kind: 'spell', text: spreeModes.map(m => '+ ' + m.cost + ' \u2014 ' + m.label).join('\n'),
        auto: spreeModes.every(m => m.auto),
        effects: [{ op: 'modal', spree: true, count: spreeModes.length,
          modes: spreeModes.map(m => ({ label: m.label, effects: m.effects, auto: m.auto })) }],
      });
    }

    /* Strive: "any number of target creatures", each beyond the first paid
       for — the targets chosen as it is cast, a variable number of them */
    if (out.strive) {
      for (const ab of out.abilities) {
        if (ab.kind !== 'spell') continue;
        const walk = (list) => { for (const e of list || []) { if (!e) continue; if (e.anyFrom) { e.targets = [Object.assign({}, e.anyFrom, { multi: { count: 'any', min: 1, perExtra: out.strive } })]; delete e.targets[0].upTo; delete e.anyFrom; } walk(e.list); } };
        // (the strive spell's group, read as it resolves, is now its targets)
        walk(ab.effects);
      }
      // a strive cost with nothing it can count (Fireball's divided damage) stays with a person
      if (!out.abilities.some(ab => ab.kind === 'spell' && JSON.stringify(ab.effects || []).includes('"perExtra"'))) out._keywordManual = true;
    }
    /* "X target creatures" counts the X paid for a spell; anywhere else
       (an ability, a trigger, "where X is …") it is left for a person */
    for (const ab of out.abilities) {
      const multi = [];
      // inside a mode the targets are asked for as it resolves, one at a time: not there
      const walk = (list, deep) => { for (const e of list || []) { if (!e) continue; for (const t of e.targets || []) if (t && t.multi) multi.push(deep ? { count: 'deep' } : t.multi);
        walk(e.list, deep); walk(e.then, true); walk(e.otherwise, true); for (const m of e.modes || []) walk(m.effects, true); } };
      walk(ab.effects, false);
      if (multi.some(mm => mm.count === 'X' ? !(ab.kind === 'spell' && /\{X\}/.test(out.manaCost || '')) : mm.count !== 'any') ||
          (ab.kind !== 'spell' && /\bX target\b/.test(ab.text || ''))) { ab.auto = false; out._keywordManual = true; }
    }
    // Escalate: the "choose one or more" modes, bought as the spell is cast
    if (out.escalate) {
      const sp = out.abilities.find(ab => ab.kind === 'spell' && (ab.effects || []).length === 1 && ab.effects[0].op === 'modal' && !ab.effects[0].spree);
      const md = sp && sp.effects[0];
      if (md && (md.modes || []).length > 1) {
        md.spree = true;
        out.spreeModes = md.modes.map((m, i) => ({ i, cost: '', label: m.label }));
        out.spreeEscalate = out.escalate;
      }
    }

    if (pawModes.length) {
      out.abilities.push({
        kind: 'spell', text: pawModes.map(m => '{P}'.repeat(m.weight) + ' — ' + m.label).join('\n'),
        auto: pawModes.every(m => m.auto),
        effects: [{ op: 'modal', pawprint: pawBudget, count: pawBudget, repeatable: true,
          modes: pawModes.map(m => ({ label: m.label, weight: m.weight, effects: m.effects, auto: m.auto })) }],
      });
    }

    /* Hideaway N (CR 702.75): as it enters, a card is hidden under it */
    const hide = out.keywords.find(k => /^hideaway$/i.test(k.keyword));
    if (hide) {
      out.abilities.push({ kind: 'triggered', event: 'etb', self: true, auto: true, text: 'Hideaway ' + (hide.arg || 4),
        effects: [{ op: 'hideaway', n: parseInt(hide.arg, 10) || 4 }] });
    }

    /* A Spacecraft with a power and toughness is an artifact creature once
       it has enough charge counters (CR 721.2): the reminder text says how
       many, or the last station line does. */
    if (out.subtypes.includes('Spacecraft') && out.power != null && (out.stationLevels || []).length) {
      const said = String(rawText).match(/It'?s an artifact creature at (\d+)\+/i);
      out.stationCreatureAt = said ? +said[1] : Math.max(...out.stationLevels);
    }
    /* A god that is only a creature with enough devotion: the engine asks
       each time it looks. */
    for (const ab of out.abilities) {
      const nc = (ab.effects || []).find(e => e && e.op === 'notCreatureUnless');
      if (nc) out.notCreatureUnless = { colors: nc.colors, n: nc.n };
    }

    /* The gift itself: a permanent hands it over as it enters, an instant
       or sorcery before it does anything else (CR 702.174b). */
    if (out.gift) {
      const give = { op: 'giveGift', gift: out.gift };
      if (out.isPermanent) {
        out.abilities.push({ kind: 'triggered', event: 'etb', self: true, auto: true, condition: { kind: 'gift' },
          text: 'When this permanent enters, if the gift was promised, the chosen opponent gets the gift.', effects: [give] });
      } else {
        const first = out.abilities.find(x => x.kind === 'spell');
        if (first) first.effects = [give].concat(first.effects || []);
      }
    }

    // Scryfall's own keyword list catches things our line parser missed
    for (const k of (card.keywords || [])) {
      if (!out.keywords.some(x => x.keyword.toLowerCase() === k.toLowerCase()))
        out.keywords.push({ keyword: U.titleCase(k), arg: null, text: k });
    }
    out.keywordSet = new Set(out.keywords.map(k => k.keyword.toLowerCase()));
    if (out.flashSacrifice) out.keywordSet.add('flash');

    /* A script for this card replaces or adds to what the lines gave us. It is
       written in the same vocabulary, so from here on nothing can tell the
       difference. A hand-written one is deliberate and always wins; a
       generated one only steps in where reading the text fell short. */
    let script = MTG.scripts && MTG.scripts.scriptFor(name);
    /* A renamed printing of a card with a hand-written script has the same
       words under another name: the script is the same card's */
    if (!script && MTG.cardlib && MTG.cardlib.scriptByFingerprint && !faceIndex) {
      const twin = MTG.cardlib.scriptByFingerprint(out.fingerprint);
      if (twin && MTG.scripts.keyFor(twin) !== MTG.scripts.keyFor(name)) { script = MTG.scripts.scriptFor(twin); if (script) out.borrowedFrom = twin; }
    }
    // an emblem carries the abilities written out for it when it was made
    if (!script && card._script && card.layout === 'emblem') script = card._script;
    const readWholeCard = totalLines > 0 && autoLines >= totalLines - 0.001;
    let gen = !script && MTG.cardlib ? MTG.cardlib.generatedFor(MTG.scripts.keyFor(name)) : null;
    // the same, for a translated card: its row read for this one
    if (!script && !gen && MTG.cardlib && MTG.cardlib.byFingerprint && !faceIndex) {
      const twin = MTG.cardlib.byFingerprint(out.fingerprint);
      if (twin && twin !== MTG.scripts.keyFor(name)) { gen = MTG.cardlib.generatedFor(twin); if (gen) out.borrowedFrom = twin; }
    }
    /* A generated script written line by line stands in for exactly the
       lines the reading above could not manage, and nothing else: what was
       read stays as it was read. Each replacement goes where the line's own
       abilities were, so the card keeps its printed order. The one
       exception is a line marked as an override: the reading of it is one
       the tests showed wrong (Bastion of Remembrance gaining from every
       opponent, Duress aimed at its caster), and the translation wins. */
    if (gen && gen.lines) {
      const done = new Set();
      for (const li of lineInfo) {
        const key = U.hash(li.text);
        /* A line the translation folded into the one above it ("deals 4
           damage instead if ..."): once that line is in, this one has
           nothing left to do of its own. */
        const head = gen.covered && gen.covered[key];
        if (head) {
          if (!done.has(head)) continue;
          const mine = li.abilities.concat(li.mana);
          out.abilities = out.abilities.filter(x => !mine.includes(x));
          out.manaAbilities = out.manaAbilities.filter(x => !mine.includes(x));
          if (!li.auto) autoLines += 1 - li.got;
          li.auto = true;
          li.generated = true;
          continue;
        }
        if (li.auto && !(gen.override && gen.override[key])) continue;
        const shared = gen.lines[key];
        if (!shared || !shared.length || !generatedLineSound(shared, li.text)) continue;
        // the table's shapes are shared between cards: this card gets its own
        const rep = JSON.parse(JSON.stringify(shared));
        const mine = li.abilities.concat(li.mana);
        if (mine.some(x => x.kind === 'castModifier')) continue;
        const at = mine.length ? out.abilities.indexOf(li.abilities[0]) : -1;
        out.abilities = out.abilities.filter(x => !mine.includes(x));
        out.manaAbilities = out.manaAbilities.filter(x => !mine.includes(x));
        const others = rep.filter(x => x.kind !== 'mana');
        if (at >= 0) out.abilities.splice(Math.min(at, out.abilities.length), 0, ...others);
        else out.abilities.push(...others);
        out.manaAbilities.push(...rep.filter(x => x.kind === 'mana'));
        autoLines += 1 - li.got;
        li.auto = true;
        li.generated = true;
        out.generated = true;
        done.add(key);
      }
    }
    /* A line no translation of this card's own covers, read exactly the same
       on another card that has one (its name read as CARDNAME on both): that
       card's translation does here what it does there. Only an exact line,
       and only one every card that prints it agrees on. */
    if (MTG.cardlib && MTG.cardlib.lineAnywhere && !script) {
      for (const li of lineInfo) {
        if (li.auto) continue;
        const key = U.hash(li.text);
        if (gen && gen.lines && gen.lines[key]) continue;
        const found = MTG.cardlib.lineAnywhere(key);
        if (!found || !found.abilities.length || !generatedLineSound(found.abilities, li.text)) continue;
        const mine = li.abilities.concat(li.mana);
        if (mine.some(x => x.kind === 'castModifier')) continue;
        const rep2 = JSON.parse(JSON.stringify(found.abilities));
        const at = mine.length ? out.abilities.indexOf(li.abilities[0]) : -1;
        out.abilities = out.abilities.filter(x => !mine.includes(x));
        out.manaAbilities = out.manaAbilities.filter(x => !mine.includes(x));
        const others = rep2.filter(x => x.kind !== 'mana');
        if (at >= 0) out.abilities.splice(Math.min(at, out.abilities.length), 0, ...others);
        else out.abilities.push(...others);
        out.manaAbilities.push(...rep2.filter(x => x.kind === 'mana'));
        autoLines += 1 - li.got;
        li.auto = true;
        li.generated = true;
        li.borrowed = found.from;
        out.generated = true;
        (out.borrowedLines = out.borrowedLines || []).push({ line: li.text, from: found.from });
        if (!out.borrowedFrom) out.borrowedFrom = found.from;
      }
    }
    if (!script && gen && gen.abilities && autoLines < totalLines - 0.001) {
      script = gen;
      if (script && !generatedScriptSound(script)) script = null;
      /* A generated script that dropped a condition the card prints — "at
         the beginning of your upkeep, if you control six or more lands",
         "activate only if" — would do its thing every time. Not trusted. */
      if (script) {
        const abs = (script.abilities || []).concat(script.add || []);
        const ifs = (text.match(/^(?:When|Whenever|At)[^,\n]*, if [^,\n]+,/gm) || []).length;
        const conds = abs.filter(x => x.kind === 'triggered' && (x.condition || x.intervening)).length;
        const onlys = (text.match(/Activate only if/g) || []).length;
        const held = abs.filter(x => x.only && x.only.cond).length;
        if (ifs > conds || onlys > held) script = null;
      }
    }
    if (script) {
      if (script.kw) {
        for (const k of script.kw) {
          if (!out.keywords.some(x => x.keyword.toLowerCase() === k.toLowerCase()))
            out.keywords.push({ keyword: k, arg: null, text: k });
        }
      }
      if (script.abilities) {
        const kept = script.keepKeywords ? out.abilities.filter(x => x.kind === 'castModifier') : [];
        out.abilities = kept.concat(script.abilities.filter(x => x.kind !== 'mana'));
        const manas = script.abilities.filter(x => x.kind === 'mana');
        if (manas.length) out.manaAbilities = manas;
      }
      if (script.add) out.abilities = out.abilities.concat(script.add);
      totalLines = 1;
      autoLines = out.abilities.every(x => x.auto || x.kind === 'castModifier') ? 1 : 0;
      out.scripted = true;
      out.generated = !!script.generated;
    }


    // convenience flags used all over the engine
    out.has = (kw) => out.keywordSet.has(String(kw).toLowerCase());
    /* "enters tapped" — but not "enters tapped unless you control a Swamp",
       which is a question asked as it enters, answered below. */
    out.entersTapped = /enters (?:the battlefield )?tapped(?=[.,;\n]|$)/i.test(text) &&
      !out.abilities.some(ab => (ab.effects || []).some(e => /^etbTappedUnless/.test(e.op || '')));

    /* --- replacement effects the engine applies when the card enters --- */
    /* "If this was kicked, it enters with two +1/+1 counters on it." The
       counters only arrive if the extra cost was paid. */
    if (/enters with an? ([+\-0-9/a-z]+) counter on it for each time it was kicked/i.test(text)) {
      out.entersWithCounters = { kind: text.match(/enters with an? ([+\-0-9/a-z]+) counter on it for each time it was kicked/i)[1], n: 'kicked' };
    }
    const kickedEtb = text.match(/If (?:CARDNAME|this creature|this spell|it) was kicked, (?:it|CARDNAME) enters(?: the battlefield)? with (a|an|one|two|three|four|X|\d+) ([+\-0-9/a-z' ]+?) counters? on (?:it|them)/i);
    if (kickedEtb) out.entersWithCounters = { kind: kickedEtb[2].trim(), n: num(kickedEtb[1]), ifKicked: true };
    // Kavu Titan: "…counters on it and with trample" — the keyword for good, kicked
    const kickedKw = text.match(/was kicked, (?:it|CARDNAME) enters(?: the battlefield)? with (?:a|an|one|two|three|four|\d+) [+\-0-9/a-z' ]+? counters? on it and with ([a-z ]+?)\./i);
    if (kickedEtb && kickedKw && KW_LIST.test(kickedKw[1])) out.entersWithCounters.withKeywords = kickedKw[1].split(/,| and /).map(x => U.titleCase(x.trim())).filter(Boolean);
    /* "…enters with X +1/+1 counters on it, where X is the number of
       creatures you control." The number is worked out as it arrives. */
    const etbPer = text.match(/enters(?: the battlefield)? with X ([+\-0-9/a-z' ]+?) counters? on (?:it|them),? where X is the number of ([-a-z' ]+?) you control/i);
    if (etbPer) out.entersWithCounters = { kind: etbPer[1].trim(), n: { per: etbPer[2].trim().toLowerCase() } };
    /* "This creature enters with a +1/+1 counter on it if you attacked this
       turn": the counters, if that holds as it enters */
    const etbIf = text.match(/(?:CARDNAME|This creature) enters(?: the battlefield)? with (a|an|one|two|three|four|\d+) ([+\-0-9/a-z]+) counters? on it if ([^.]+)\./i);
    if (etbIf && !out.entersWithCounters) {
      const c = condOf(etbIf[3]);
      if (c) out.entersWithCounters = { kind: etbIf[2].trim(), n: num(etbIf[1]), cond: c };
    }
    // Ardenvale Paladin: "If at least three white mana was spent to cast this spell, this creature enters with a +1/+1 counter on it."
    const ifEtb = text.match(/\bIf ([^,.]+), (?:CARDNAME|this creature) enters(?: the battlefield)? with (a|an|one|two|three|four|\d+) ([+\-0-9/a-z]+) counters? on it\./i);
    if (ifEtb && !out.entersWithCounters) {
      const c = condOf(ifEtb[1]);
      if (c) out.entersWithCounters = { kind: ifEtb[3].trim(), n: num(ifEtb[2]), cond: c };
    }
    /* Converge, sunburst: a counter for each colour of mana spent to cast it */
    const conv = text.match(/enters(?: the battlefield)? with (an?|two|three) ([+\-0-9/a-z]+) counters? on it for each (colou?r of )?mana spent to cast it/i);
    if (conv && !out.entersWithCounters) {
      const k = typeof num(conv[1]) === 'number' ? num(conv[1]) : 1;
      out.entersWithCounters = { kind: conv[2], n: conv[3] ? { colorsSpent: true, mult: k } : { manaSpent: true, mult: k } };
    }
    // Marath: "enters with a number of +1/+1 counters on it equal to the amount of mana spent to cast it"
    const eqs = text.match(/enters(?: the battlefield)? with a number of ([+\-0-9/a-z]+) counters on it equal to the amount of mana spent to cast it/i);
    if (eqs && !out.entersWithCounters) out.entersWithCounters = { kind: eqs[1], n: { manaSpent: true } };
    // Diregraf Colossus: "enters with a +1/+1 counter on it for each Zombie card in your graveyard"
    const etbEach = text.match(/(?:CARDNAME|This creature|This artifact) enters(?: the battlefield)? with an? ([+\-0-9/a-z]+) counter on it for each ([^.]+?)\./i);
    if (etbEach && !out.entersWithCounters && !/mana spent/i.test(etbEach[2])) {
      const c = countOf(etbEach[2]);
      if (c && plainCount(c)) out.entersWithCounters = { kind: etbEach[1], n: { count: c } };
    }
    if (out.keywordSet.has('sunburst') && !out.entersWithCounters) out.entersWithCounters = { kind: out.isCreature ? '+1/+1' : 'charge', n: { colorsSpent: true } };
    let etbm = text.match(/enters with (a|an|one|two|three|four|X|\d+) \+1\/\+1 counters?/i);
    if (etbm && !out.entersWithCounters) out.entersWithCounters = { kind: '+1/+1', n: num(etbm[1]) };
    etbm = text.match(/enters(?: tapped)? with (a|an|one|two|three|\d+) ([a-z ]+?) counters?/i);
    if (etbm && !out.entersWithCounters) out.entersWithCounters = { kind: etbm[2].trim(), n: num(etbm[1]) };
    /* Graft N (CR 702.58): it enters with N +1/+1 counters, and may hand
       one to each other creature as that creature enters */
    const graftN = out.keywords.some(k => k.keyword === 'Graft') && text.match(/(?:^|\n)Graft (\d+)/);
    if (graftN) {
      out.entersWithCounters = { kind: '+1/+1', n: +graftN[1] };
      out.abilities.push({ kind: 'triggered', event: 'permEnters', objFilter: subjectFilter('another creature'), optional: true,
        condition: { kind: 'selfCounters', n: 1, counter: '+1/+1' }, effects: [{ op: 'graftCounter' }],
        text: 'Whenever another creature enters, you may move a +1/+1 counter from this creature onto it.', auto: true });
    }
    /* Backup N (CR 702.165): as it enters, N +1/+1 counters on target
       creature; another creature also gains the abilities printed below
       the keyword until end of turn */
    const backupAt = out.keywords.some(k => k.keyword === 'Backup') ? text.split('\n').findIndex(l => /^Backup \d+/.test(l)) : -1;
    if (backupAt >= 0) {
      const bn = +text.split('\n')[backupAt].match(/^Backup (\d+)/)[1];
      const below = text.split('\n').slice(backupAt + 1).map(l => stripReminder(l).trim()).filter(Boolean)
        .map(l => l.replace(/\bCARDNAME\b/g, 'this creature'));
      out.abilities.push({ kind: 'triggered', event: 'etb', self: true, text: text.split('\n')[backupAt],
        effects: [{ op: 'counters', kind: '+1/+1', n: bn, targets: [targetSpec('target creature')] }, { op: 'backupGrant', texts: below }],
        auto: below.every(l => grantableText(l) || KW_LIST.test(l)) });
      if (!out.abilities[out.abilities.length - 1].auto) out._keywordManual = true;
    }
    /* Recover {cost} (CR 702.59): from the graveyard, as a creature of yours
       dies, pay to have this card back in hand, or it is exiled */
    const recover = out.keywords.some(k => k.keyword === 'Recover') && text.split('\n').map(l => l.match(/^Recover ((?:\{[^}]+\})+)/)).find(Boolean);
    if (recover) {
      out.abilities.push({ kind: 'triggered', event: 'permDies', objFilter: subjectFilter('a creature you control'), fromGraveyard: true,
        effects: [{ op: 'mayPay', pay: { mana: recover[1] }, then: [{ op: 'selfFromGraveyard', to: 'hand' }], otherwise: [{ op: 'exileSelfAnywhere' }] }],
        text: 'Recover ' + recover[1], auto: true });
      out.graveTriggers = true;
    } else if (/(?:^|\n)Recover\b/.test(text)) out._keywordManual = true;   // "Recover—Pay half your life"
    /* Read ahead (CR 702.155): the Saga may start at any chapter, chosen as
       it is cast; the chapters before it don't happen */
    if (out.keywords.some(k => /^read ahead$/i.test(k.keyword))) {
      out.readAhead = Math.max(1, ...out.abilities.filter(x => x.kind === 'chapter').flatMap(x => x.chapters || [1]));
    }
    /* Provoke (CR 702.39): as it attacks, a creature the defender controls
       may be untapped and made to block it */
    if (out.keywords.some(k => k.keyword === 'Provoke')) {
      out.abilities.push({ kind: 'triggered', event: 'attacks', self: true, optional: true, text: 'Provoke',
        effects: [{ op: 'untap', targets: [Object.assign(targetSpec('target creature an opponent controls'), { upTo: true })] }, { op: 'mustBlockThis', scope: 'lastTarget' }],
        auto: true });
    }
    /* Myriad (CR 702.116): a copy attacking each other opponent, gone when
       combat ends */
    if (out.keywords.some(k => k.keyword === 'Myriad')) {
      out.abilities.push({ kind: 'triggered', event: 'attacks', self: true, text: 'Myriad',
        effects: [{ op: 'myriad' }], auto: true });
    }
    /* Enlist (CR 702.154): as it attacks, another creature of yours may be
       tapped to lend it that creature's power */
    if (out.keywords.some(k => k.keyword === 'Enlist')) {
      out.abilities.push({ kind: 'triggered', event: 'attacks', self: true, text: 'Enlist',
        effects: [{ op: 'enlist' }], auto: true });
    }
    /* Ravenous (CR 702.156): X +1/+1 counters as it enters, and a card if X
       was 5 or more */
    if (out.keywords.some(k => k.keyword === 'Ravenous')) {
      out.entersWithCounters = { kind: '+1/+1', n: 'X' };
      out.abilities.push({ kind: 'triggered', event: 'etb', self: true, condition: { kind: 'xAtLeast', n: 5 },
        effects: [{ op: 'draw', n: 1, who: 'you' }], text: 'Ravenous: when it enters, if X is 5 or more, draw a card.', auto: true });
    }
    // Devour N: how many counters for each creature it eats
    const devourN = out.keywords.some(k => k.keyword === 'Devour') && text.split('\n').map(l => l.match(/^Devour (\d+)/)).find(Boolean);
    if (devourN) out.devour = +devourN[1];
    const modular = out.keywords.find(k => k.keyword === 'Modular');
    if (modular && modular.arg) out.entersWithCounters = { kind: '+1/+1', n: parseInt(modular.arg, 10) || 0 };

    /* --- cost reduction the engine can price at cast time --- */
    out.costReduction = { convoke: false, improvise: false, delve: false, affinity: null, flat: 0, condition: null };
    if (out.keywordSet.has('convoke')) out.costReduction.convoke = true;
    if (out.keywordSet.has('improvise')) out.costReduction.improvise = true;
    if (out.keywordSet.has('delve')) out.costReduction.delve = true;
    const aff = text.match(/Affinity for ([a-z ]+)/i);
    if (aff) out.costReduction.affinity = aff[1].trim().toLowerCase();
    const less = text.match(/(?:This spell|CARDNAME) costs \{(\d+)\} less to cast for each ([^.]+)\./i);
    if (less) { out.costReduction.flat = parseInt(less[1], 10); out.costReduction.condition = less[2].trim(); }

    /* --- what other spells this permanent makes cheaper --- */
    const globalLess = text.match(/([A-Za-z ]*?)spells? you cast costs? \{(\d+)\} less to cast/i);
    if (globalLess) out.globalCostReduction = { amount: parseInt(globalLess[2], 10), filter: (globalLess[1] || '').trim().toLowerCase() };
    /* "Activate only …" is not an ability of its own: it is a footnote on
       the one above it, and the engine needs it there to enforce it. */
    for (let i = 0; i < out.abilities.length; i++) {
      const ab = out.abilities[i];
      const only = (ab.effects || []).find(e => e && e.op === 'activateOnly');
      if (!only) continue;
      let host = null;
      for (let j = i - 1; j >= 0; j--) {
        if (out.abilities[j].kind === 'activated' || out.abilities[j].kind === 'mana') { host = out.abilities[j]; break; }
      }
      // a land's "{T}: Add {G}" lives in the mana list, not with the rest
      if (!host && out.manaAbilities.length) host = out.manaAbilities[out.manaAbilities.length - 1];
      if (!host) continue;
      host.only = Object.assign({}, host.only, only.when ? { when: only.when } : null,
        only.cond ? { cond: only.cond } : null, only.once ? { once: true } : null);
      if (only.anyPlayer) host.anyPlayer = true;
      out.abilities.splice(i, 1); i--;
    }

    /* "Spend this mana only to cast Dragon spells" on a loyalty ability is
       a restriction the table only keeps for mana abilities; elsewhere the
       line is left for a person. */
    for (const ab of out.abilities) {
      if (ab.kind !== 'mana' && (ab.effects || []).some(e => e && e.op === 'spendOnly') && ab.auto) {
        ab.auto = false;
        autoLines--;
      }
    }

    /* "Threshold — Add {B}{B}{B}{B}{B} instead if …" on a line of its own
       replaces the last effect of the line above. */
    for (let i = 1; i < out.abilities.length; i++) {
      const ab = out.abilities[i];
      const effs = ab.effects || [];
      if (effs.length !== 1 || !effs[0].insteadOf) continue;
      const host = out.abilities[i - 1];
      const list = host.effects || [];
      if (!list.length || host.kind !== ab.kind) continue;
      const prev = list.pop();
      list.push({ op: 'ifCond', cond: effs[0].insteadOf.cond, then: effs[0].insteadOf.effects, otherwise: [prev] });
      out.abilities.splice(i, 1); i--;
      autoLines++;
    }

    /* A rider that arrived as its own line ("If this spell was kicked, it
       deals 4 damage instead.") belongs to the effect above it, which is on
       the line before. Folding happens per line first; this catches the
       cards that put the sentence on a line of its own. */
    for (let i = 0; i < out.abilities.length; i++) {
      const ab = out.abilities[i];
      const rider = (ab.effects || []).find(e => e && e.insteadRider);
      if (!rider) continue;
      let folded = false;
      for (let j = i - 1; j >= 0 && !folded; j--) {
        for (const e of (out.abilities[j].effects || [])) {
          if (e.op !== rider.insteadRider.op) continue;
          e.n = { ifCond: rider.insteadRider.cond, then: rider.insteadRider.n, otherwise: e.n };
          folded = true;
          break;
        }
      }
      if (folded) { out.abilities.splice(i, 1); i--; }
    }

    /* "Put a +1/+1 counter on that creature" reads as the creature the
       trigger is about; anywhere else there is no such creature, and the
       line goes back to a person. */
    /* "Destroy it." with nothing targeted and no permanent the trigger is
       about: nothing for "it" to be, so the line goes back to a person */
    for (const ab of out.abilities) {
      if (!ab.auto) continue;
      const js = JSON.stringify(ab.effects || []);
      if (!/"op":"(?:destroy|exile|copyPermanent)",(?:"n":1,)?"scope":"lastTarget"/.test(js) || /"targets":\[\{/.test(js)) continue;
      ab.auto = false;
      autoLines--;
    }
    for (const ab of out.abilities) {
      if (!ab.auto || !JSON.stringify(ab.effects || []).includes('"triggerObject"')) continue;
      if (ab.kind === 'triggered' && !ab.self) continue;
      // a creature's own trigger about another creature: the one it dealt damage to, the one it exploited
      if (ab.kind === 'triggered' && ['dealsDamageToCreature', 'exploits', 'blocksCreature', 'blockedByCreature'].includes(ab.event)) continue;
      ab.auto = false;
      autoLines--;
    }
    // only now, with every footnote folded into its line, is the count final
    /* the die's results put on the roll that reads them */
    for (const tb of dieTables) {
      const ab = out.abilities.find(x => x.text === tb.head) || out.abilities.find(x => x.text && tb.head.includes(x.text));
      let roll = null;
      const walk = (list) => { for (const e of list || []) { if (!e || roll) continue; if (e.op === 'rollDie') roll = e; walk(e.list); walk(e.then); } };
      if (ab) walk(ab.effects);
      const rows = tb.rows.map(r => { const pe = parseEffects(r.text); return { min: r.min, max: r.max, effects: pe.effects, auto: pe.auto }; });
      if (!roll || rows.some(r => !r.auto)) { if (ab) ab.auto = false; out._keywordManual = true; continue; }
      roll.table = rows.map(r => ({ min: r.min, max: r.max, effects: r.effects }));
    }
    /* Reconfigure (CR 702.151): the same price also takes it off again,
       and attached it is no creature */
    for (const ab of out.abilities.slice()) {
      if (ab.kind !== 'activated' || !/^Reconfigure \{/i.test(ab.text || '')) continue;
      out.abilities.push({ kind: 'activated', text: ab.text + ' (unattach)', auto: true, sorcerySpeed: true, onlyAttached: true,
        cost: ab.cost, effects: [{ op: 'unattachSelf' }] });
    }
    // "Cast this spell only during combat": the window, where the table looks for it
    for (const ab of out.abilities) {
      const walk = (list) => { for (const e of list || []) { if (!e) continue; if (e.castWindow) out.castWindow = e.castWindow; walk(e.list); } };
      walk(ab.effects);
    }
    out.autoCoverage = totalLines === 0 ? 1 : U.clamp(autoLines / totalLines, 0, 1);
    out.fullyAutomated = out.autoCoverage >= 0.999;
    // a keyword the reading could do only part of (Backup granting words it can't read, "Recover—Pay half your life")
    if (out._keywordManual) out.fullyAutomated = false;
    /* A Room's locked door: its mana cost, paid any time you could cast a
       sorcery, unlocks it (CR 709.5e) — a special action, offered with the
       Room's abilities */
    /* "door 0" and "door 1" are only how the reading tells the doors apart;
       a player reads the door's name */
    if (isRoom(card) || card.roomOf) {
      const faces = (card.roomOf ? null : card.card_faces) || String(card.name).split(' // ').map(n => ({ name: n }));
      for (const ab of out.abilities) {
        if (typeof ab.text === 'string') ab.text = ab.text.replace(/When you unlock door ([01])/g, (x, d) => 'When you unlock ' + ((faces[+d] || {}).name || 'this door'));
      }
    }
    if (isRoom(card) && (faceIndex === 0 || faceIndex === 1)) {
      const other = card.card_faces[1 - faceIndex];
      out.isRoom = true;
      out.abilities.push({ kind: 'activated', special: 'unlock', door: 1 - faceIndex, sorcerySpeed: true,
        cost: parseCost(other.mana_cost || '{0}'), effects: [{ op: 'unlockDoor', door: 1 - faceIndex }],
        text: `Unlock ${other.name}: ${other.mana_cost || '{0}'}`, auto: true });
    }
    // a prepare card is its creature and its spell: the copy cast later must run too
    if (out.fullyAutomated && card.layout === 'prepare' && !faceIndex && card.card_faces && card.card_faces[1]) {
      const sp = analyze(card, 1);
      if (!sp || !sp.fullyAutomated) out.fullyAutomated = false;
    }
    if (!out.isPermanent) {
      const spellEffects = [];
      let allAuto = true;
      for (const ab of out.abilities) {
        if (ab.kind !== 'spell') continue;
        spellEffects.push(...(ab.effects || []));
        if (!ab.auto) allAuto = false;
      }
      if (spellEffects.length) SPELL_TEXT.set(text, { effects: spellEffects, auto: allAuto });
    }
    out.needsManual = out.abilities.some(a => !a.auto && a.kind !== 'castModifier');
    /* Nether Traitor, Bridge from Below, Recover: a triggered ability that
       works while the card is in its owner's graveyard, and only there */
    for (const ab of out.abilities) {
      if (ab.kind !== 'triggered' || !ab.text) continue;
      if (/^When(?:ever)? (?:this creature|CARDNAME|this card) (?:dies|is put into)/i.test(ab.text)) continue;
      if (/\b(?:return|exile) (?:this card|CARDNAME) from your graveyard\b|\b(?:if|while) (?:this card|CARDNAME) is in your graveyard\b/i.test(ab.text)) {
        ab.fromGraveyard = true;
        out.graveTriggers = true;
      }
    }

    /* --- what an Aura goes on ---
       "Enchant creature" is a targeting restriction, not a footnote: the
       spell chooses its host as it is cast and arrives attached to it. An
       Aura that lands on nothing is put into the graveyard straight away,
       which is what used to happen to every one of them. */
    if (out.isAura) {
      for (const ab of out.abilities) {
        const e = (ab.effects || []).find(x => x.op === 'enchant');
        if (!e) continue;
        const ef = String(e.filter || 'creature');
        out.auraSpec = /card in a graveyard$/i.test(ef)
          ? { type: 'creature', zone: 'graveyard', filter: 'creature card' }
          : targetSpec(ef);
        if (/card in a graveyard$/i.test(ef)) out.auraReanimates = true;
        break;
      }
      if (!out.auraSpec) out.auraSpec = targetSpec('creature');
    }
    out.producesMana = out.manaAbilities.length > 0 || (card.produced_mana || []).length > 0;
    out.producedColors = card.produced_mana || deriveProduced(out);
    return out;
  }

  function deriveProduced(a) {
    const set = new Set();
    for (const ab of a.manaAbilities) for (const e of ab.effects || []) {
      if (e.op === 'addMana') for (const s of e.symbols) for (const c of MANA.COLORS.concat('C')) if (s.includes(c)) set.add(c);
      if (e.op === 'addManaAny' || e.op === 'addManaChoice') MANA.COLORS.forEach(c => set.add(c));
    }
    return Array.from(set);
  }

  /* ---------------- continuous effects (CR 613) ----------------
     A static ability on a permanent changes what other permanents are, for as
     long as it is there. Rather than a special case per phrasing, these all
     become one shape the engine applies in layer order: who it touches, what
     it grants or takes away, and what it does to power and toughness. */

  const SCOPE_WORDS = {
    'creatures you control': { who: 'you', what: 'creature' },
    'other creatures you control': { who: 'you', what: 'creature', other: true },
    'creatures your opponents control': { who: 'opponents', what: 'creature' },
    'creatures your team controls': { who: 'you', what: 'creature' },
    'permanents you control': { who: 'you', what: 'permanent' },
    'other permanents you control': { who: 'you', what: 'permanent', other: true },
    'artifacts you control': { who: 'you', what: 'artifact' },
    'lands you control': { who: 'you', what: 'land' },
    'creatures': { who: 'all', what: 'creature' },
    'all creatures': { who: 'all', what: 'creature' },
    'equipped creature': { attached: true, what: 'creature' },
    'enchanted creature': { attached: true, what: 'creature' },
    'enchanted permanent': { attached: true, what: 'permanent' },
    'enchanted land': { attached: true, what: 'land' },
    'enchanted artifact': { attached: true, what: 'artifact' },
    'fortified land': { attached: true, what: 'land' },
    'this creature': { self: true, what: 'creature' },
    'this artifact': { self: true, what: 'permanent' },
    'this enchantment': { self: true, what: 'permanent' },
    'this vehicle': { self: true, what: 'permanent' },
    'this equipment': { self: true, what: 'permanent' },
    'this land': { self: true, what: 'land' },
    'this permanent': { self: true, what: 'permanent' },
    'cardname': { self: true, what: 'permanent' },
    'nonbasic lands': { who: 'all', what: 'land', nonbasic: true },
  };

  /**
   * "Other non-Human creatures you control" and friends. The words in front of
   * the type narrow it: "Wolf creatures" wants the subtype too, "non-Human
   * creatures" wants everything but.
   */
  const SCOPE_TYPES = 'creature|permanent|artifact|enchantment|land|planeswalker|battle';
  function scopeOf(phrase) {
    const raw = String(phrase).trim().replace(/\.$/, '');
    const p = raw.toLowerCase();
    const direct = SCOPE_WORDS[p];
    if (direct) return Object.assign({}, direct);
    const sc = { who: 'all' };
    /* "Each creature you control with a counter on it" says what "creatures
       you control with counters on them" says */
    let rest = raw.replace(/^all /i, '').replace(/^each (other )?((?:(?:white|blue|black|red|green|nonland|noncreature|nonartifact|nontoken|tapped|untapped) )*)(creature|artifact|land|permanent|enchantment)\b/i, (x, o, a, n) => (o || '') + (a || '') + n + 's');
    // Oran-Rief: "that entered this turn"; Desynchronization: "that's not historic"
    let mm0;
    if ((mm0 = rest.match(/ that entered (?:the battlefield )?this turn$/i))) { sc.enteredThisTurn = true; rest = rest.slice(0, mm0.index); }
    if ((mm0 = rest.match(/ that(?:'s| is| are)(?: not|n'?t) historic$/i))) { sc.notHistoric = true; rest = rest.slice(0, mm0.index); }
    /* "Creatures you control of the chosen type": whatever this permanent
       was told as it entered */
    const chosen = rest.match(/ of the chosen (type|colou?r)\b/i);
    if (chosen) {
      if (/type/i.test(chosen[1])) sc.chosenType = true; else sc.chosenColor = true;
      rest = rest.replace(/ of the chosen (?:type|colou?r)\b/i, '');
    }
    // who controls them
    const W = rest.match(/ (you control|your opponents control|your team controls|you don'?t control|an opponent controls|target player controls|target opponent controls|defending player controls|that player controls)$/i);
    if (W) {
      sc.who = /^(?:you control|your team)/i.test(W[1]) ? 'you' : /^(?:target|that player)/i.test(W[1]) ? 'target' : 'opponents';
      // Cavern-Hoard Dragon: "for each artifact that player controls"
      if (/^that player/i.test(W[1])) sc.thatPlayer = true;
      rest = rest.slice(0, W.index);
    }
    // and what they have
    let m;
    for (let pass = 0; pass < 2; pass++) {
      if ((m = rest.match(/ with power (\d+) or (greater|more|less)$/i))) {
        if (/less/i.test(m[2])) sc.maxPower = +m[1]; else sc.minPower = +m[1];
        rest = rest.slice(0, m.index);
      } else if ((m = rest.match(/ with toughness (\d+) or (greater|more|less)$/i))) {
        // Citywide Bust: "with toughness 4 or greater"
        if (/less/i.test(m[2])) sc.maxToughness = +m[1]; else sc.minToughness = +m[1];
        rest = rest.slice(0, m.index);
      } else if ((m = rest.match(/ with (?:mana value|converted mana cost) (\d+) or (less|greater|more)$/i))) {
        if (/less/i.test(m[2])) sc.maxMv = +m[1]; else sc.minMv = +m[1];
        rest = rest.slice(0, m.index);
      } else if ((m = rest.match(/ with (?:one or more |a )?counters? on (?:it|them)$/i))) {
        sc.withAnyCounter = true; rest = rest.slice(0, m.index);
      } else if ((m = rest.match(/ with an? ([+\-0-9/a-z]+) counter on (?:it|them)$/i)) ||
          (m = rest.match(/ with ([+\-0-9/a-z]+) counters on them$/i))) {
        sc.withCounter = m[1]; rest = rest.slice(0, m.index);
      } else if ((m = rest.match(/ (with|without) (flying|first strike|double strike|deathtouch|lifelink|trample|haste|vigilance|menace|reach|defender|hexproof|indestructible|decayed)$/i))) {
        if (/^without/i.test(m[1])) sc.withoutKeyword = m[2].toLowerCase(); else sc.keyword = m[2].toLowerCase();
        rest = rest.slice(0, m.index);
      }
    }
    if (sc.who === 'all' && W == null && (m = rest.match(/ (you control|your opponents control)$/i))) {
      sc.who = /you control/i.test(m[1]) ? 'you' : 'opponents';
      rest = rest.slice(0, m.index);
    }
    const words = rest.replace(/,/g, ' ').split(/\s+/).filter(Boolean);
    if (!words.length) return null;
    if (/^other$/i.test(words[0])) { sc.other = true; words.shift(); }
    if (!words.length) return null;
    /* The noun at the end says what kind of thing: "creatures",
       "permanents", "artifacts and creatures", or a creature type in the
       plural ("Goblins", "Elves"), which means creatures of that type. */
    const NOUNS = { creatures: 'creature', permanents: 'permanent', artifacts: 'artifact', enchantments: 'enchantment',
      lands: 'land', planeswalkers: 'planeswalker', battles: 'battle', tokens: 'permanent' };
    const nouns = [];
    while (words.length) {
      const w = words[words.length - 1];
      const lw = w.toLowerCase();
      if (NOUNS[lw]) { nouns.unshift(NOUNS[lw]); if (lw === 'tokens') sc.token = true; words.pop(); }
      else if (/^(?:and|or|and\/or)$/i.test(lw) && nouns.length) words.pop();
      else break;
    }
    if (!nouns.length) {
      const w = words[words.length - 1];
      // Lord of Atlantis: "Other Merfolk" — a plural that is the word itself, and a few irregular ones
      const SAME = { merfolk: 'merfolk', kithkin: 'kithkin', moonfolk: 'moonfolk', kor: 'kor', samurai: 'samurai', fish: 'fish',
        sheep: 'sheep', mice: 'mouse', fungi: 'fungus', sphinxes: 'sphinx', octopuses: 'octopus', foxes: 'fox' };
      if (SAME[w.toLowerCase()] && words.length <= 2 && /^[A-Z]/.test(w)) {
        sc.subtype = SAME[w.toLowerCase()]; sc.what = 'permanent'; words.pop();
      } else {
      if (!/^[A-Z][a-z'-]+s$/.test(w) || words.length > 2) return null;
      sc.subtype = w.toLowerCase().replace(/ves$/, 'f').replace(/s$/, '');
      sc.what = 'permanent';
      words.pop();
      }
    } else if (nouns.length === 1) sc.what = nouns[0];
    else { sc.what = 'permanent'; sc.anyOf = nouns; }
    const COL = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
    // "black or green permanents": either colour
    for (let i = 1; i + 1 < words.length; i++) {
      if (/^(?:or|and\/or)$/i.test(words[i]) && COL[words[i - 1].toLowerCase()] && COL[words[i + 1].toLowerCase()]) {
        sc.colorAny = [COL[words[i - 1].toLowerCase()], COL[words[i + 1].toLowerCase()]];
        words.splice(i - 1, 3);
        break;
      }
    }
    for (const w of words) {
      const lw = w.toLowerCase();
      if (lw === 'multicolored') { sc.multicolored = true; continue; }
      if (lw === 'tapped' || lw === 'untapped' || lw === 'attacking' || lw === 'blocking') sc[lw] = true;
      else if (lw === 'nontoken') sc.nontoken = true;
      else if (lw === 'token') sc.token = true;
      else if (lw === 'nonbasic') sc.nonbasic = true;
      else if (lw === 'legendary') sc.legendary = true;
      else if (lw === 'nonlegendary') sc.nonlegendary = true;
      // "artifact creatures": a creature that is an artifact as well
      else if (/^(?:artifact|enchantment|land|creature)$/.test(lw) && sc.what && !sc.anyOf) (sc.alsoType = sc.alsoType || []).push(lw);
      else if (/^non(?:land|creature|artifact|enchantment|planeswalker)$/.test(lw)) (sc.notType = sc.notType || []).push(lw.slice(3));
      else if (COL[lw]) sc.color = COL[lw];
      else if (/^non/.test(lw) && COL[lw.replace(/^non-?/, '')]) sc.notColor = COL[lw.replace(/^non-?/, '')];
      else if (/^[Nn]on-[A-Z]/.test(w)) sc.notSubtype = w.slice(4).toLowerCase();
      else if (/^[A-Z][a-z'-]+$/.test(w) && w !== 'CARDNAME' && w !== 'You') sc.subtype = lw;    // "Wolf creatures"
      else return null;
    }
    return sc;
  }

  const KW_LIST = /^[a-z][a-z' {}0-9]*(?:,\s*[a-z][a-z' {}0-9]*)*(?:,?\s+and\s+[a-z][a-z' {}0-9]*)?$/i;

  /**
   * Take the keywords off the front of a phrase and hand back what is
   * left. "Lifelink Transcendent Master is indestructible." is a keyword
   * and then a sentence, run together the way the printed card runs them.
   */
  function takeKeywords(text) {
    let rest = String(text || '').trim();
    const kws = [];
    for (;;) {
      const prot = rest.match(/^Protection from ([a-z]+(?: and from [a-z]+)*)[.,]?\s*/i);
      if (prot) { kws.push('Protection from ' + prot[1]); rest = rest.slice(prot[0].length); continue; }
      let hit = null;
      for (const k of IMPLEMENTED_KEYWORDS) {
        const re = new RegExp('^' + escapeRe(k) + '[.,]?(?:\\s+|$)', 'i');
        const m = rest.match(re);
        if (m && (!hit || m[0].length > hit[0].length)) hit = m;
      }
      if (!hit) break;
      kws.push(U.titleCase(hit[0].replace(/[.,]\s*$/, '').trim()));
      rest = rest.slice(hit[0].length);
    }
    return [kws, rest.trim()];
  }
  function keywordList(str) {
    /* "protection from black and from green" is one keyword with two
       qualities, not "protection from black" and a keyword called "from
       green". */
    const out = [];
    const rest = String(str).replace(/protection from [a-z]+(?:(?:,|,? and) from [a-z]+)*/gi, (m0) => {
      out.push(U.titleCase(m0)); return '';
    });
    // the protection taken out of the middle leaves a dangling "and" behind
    return out.concat(rest.split(/,\s*|\s+and\s+/).map(x => x.trim()).filter(x => x && !/^and$/i.test(x)).map(U.titleCase));
  }

  /* ---------------- what a permanent becomes (CR 613) ----------------
     "Loses all abilities", "becomes a blue Frog with base power and
     toughness 1/1", "is a Treefolk with base power and toughness 0/4",
     "becomes a 3/3 creature that's still a land", "has base power and
     toughness 1/1": the same few phrases, for a while (Turn to Frog) or for
     good (Lignify, Humility). Each part goes in its own layer: card and
     creature types in 4, colour in 5, abilities in 6, power and toughness
     in 7b. Returns the parts, or null for anything else. */
  function becomesEff(body) {
    const COLORS = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
    const eff = {};
    const text = String(body || '').trim().replace(/\.$/, '');
    // "…and has indestructible, and it loses all other abilities, card types, and creature types"
    const parts = text.split(/,? and (?:it )?(?=(?:loses?|becomes?|has|have|is|are|gains?) )/i);
    let m;
    const typed = (colorWords, words, pt) => {
      const cols = String(colorWords || '').trim().split(/\s+/).filter(Boolean);
      if (cols.length) {
        if (cols.some(c => c !== 'colorless' && !COLORS[c])) return false;
        eff.setColors = cols.includes('colorless') ? [] : cols.map(c => COLORS[c]);
      }
      const ws = String(words || '').trim().split(/\s+/).filter(Boolean);
      const cardTypes = [], creatureTypes = [];
      for (const w of ws) {
        if (/^(?:artifact|enchantment|land|creature)$/i.test(w)) cardTypes.push(w[0].toUpperCase() + w.slice(1).toLowerCase());
        else if (/^[A-Z][a-z'-]+$/.test(w)) creatureTypes.push(w);
        else return false;
      }
      if (cardTypes.length) eff.addTypes = cardTypes;
      if (creatureTypes.length) eff.setCreatureTypes = creatureTypes;
      if (pt) eff.setPt = { p: +pt[0], t: +pt[1] };
      return true;
    };
    for (const part of parts) {
      const p = part.trim();
      if (/^loses? all (?:other )?abilities$/i.test(p)) { eff.loseAll = true; continue; }
      // Darksteel Mutation: its card types and creature types are the ones it was just given
      if (/^loses? all other abilities, card types, and creature types$/i.test(p)) { eff.loseAll = true; eff.onlyTheseTypes = true; continue; }
      if ((m = p.match(/^(?:has|have) base power and toughness (\d+)\/(\d+)$/i))) { eff.setPt = { p: +m[1], t: +m[2] }; continue; }
      if ((m = p.match(/^(?:has|have|gains?) ([a-z, ]+)$/i))) {
        const kws = keywordList(m[1]);
        if (!kws.length || !kws.every(kwKnown)) return null;
        eff.keywords = (eff.keywords || []).concat(kws);
        continue;
      }
      if ((m = p.match(/^(?:becomes?|is|are) (\d+)\/(\d+)$/i))) { eff.setPt = { p: +m[1], t: +m[2] }; continue; }
      // "becomes a 3/3 creature that's still a land", "becomes a 2/2 red Elemental creature"
      if ((m = p.match(/^(?:becomes?|is|are) an? (\d+)\/(\d+) ((?:(?:white|blue|black|red|green|colorless) )*)((?:[A-Za-z'-]+ )*?)creatures?(?: that'?s still an? (?:land|artifact|enchantment))?$/))) {
        if (!typed(m[3], (m[4] + ' Creature').trim(), [m[1], m[2]])) return null;
        continue;
      }
      // "becomes a blue Frog with base power and toughness 1/1", "is an Insect artifact creature with base power and toughness 0/1"
      if ((m = p.match(/^(?:becomes?|is|are) an? ((?:(?:white|blue|black|red|green|colorless) )*)([A-Za-z' -]+?) with base power and toughness (\d+)\/(\d+)$/))) {
        if (!typed(m[1], m[2], [m[3], m[4]])) return null;
        continue;
      }
      return null;
    }
    if (eff.onlyTheseTypes) {
      eff.setTypes = (eff.addTypes || []).slice();
      delete eff.addTypes;
      delete eff.onlyTheseTypes;
    }
    return Object.keys(eff).length ? eff : null;
  }

  /** "Target creature", "it", "this creature", "creatures your opponents control": what a one-off reaches. */
  function becomesSubject(subj, eff, duration) {
    const s = String(subj).trim();
    const out = { op: 'becomes', duration, eff };
    if (/^(?:another )?target /i.test(s)) out.targets = [targetSpec(s)];
    else if (/^(?:it|that creature|that land|that permanent)$/i.test(s)) out.scope = 'lastTarget';
    else if (/^(?:CARDNAME|this creature|this land|this artifact|this permanent)$/i.test(s)) out.scope = 'self';
    else {
      const sc = scopeOf(s.replace(/^each /i, 'all '));
      if (!sc || sc.self || sc.attached) return null;
      out.scope = sc;
    }
    return out;
  }

  const BASIC_TYPES = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];
  /* a restriction that rides along with a bonus: "can't block", "can't be
     blocked", "attacks each combat if able", "can attack as though it
     didn't have defender" */
  function restrictionPart(scope, words) {
    const w = String(words).toLowerCase().replace(/’/g, "'");
    if (/^can'?t block$/.test(w)) return { op: 'continuous', layer: 6, scope, flag: 'cantBlock' };
    if (/^can'?t be blocked$/.test(w)) return { op: 'continuous', layer: 6, scope, grant: ['Unblockable'] };
    if (/^attacks each combat if able$/.test(w)) return { op: 'continuous', layer: 6, scope, flag: 'mustAttackEot' };
    if (/^can attack as though (?:it|they) didn'?t have defender$/.test(w)) return { op: 'continuous', layer: 6, scope, flag: 'attackDespiteDefender' };
    // Leaden Fists: "doesn't untap during its controller's untap step"
    if (/^(?:doesn'?t|don'?t) untap during (?:its|their) controllers?'?s? untap steps?$/.test(w)) return { op: 'continuous', layer: 6, scope, flag: 'noUntap' };
    // Quantum Reduction: "loses all abilities"
    if (/^loses? all abilities$/.test(w)) return { op: 'continuous', layer: 6, scope, loseAll: true };
    if (/^(?:its|their) activated abilities can'?t be activated$/.test(w)) return { op: 'continuous', layer: 6, scope, flag: 'cantActivate' };
    return null;
  }

  const CONTINUOUS_RULES = [
    /* Backgrounds: "Commander creatures you own have '…' / get +1/+1 and
       have …" — the group's rule, for your commanders */
    { re: /^Commander creatures you own (have|get) (.+)$/i,
      make: (m) => {
        const inner = parseContinuous('Creatures you control ' + m[1].toLowerCase() + ' ' + m[2]);
        if (!inner || inner.effects.length !== 1) return null;
        const cmd = (e) => Object.assign(e, { scope: { who: 'you', what: 'creature', commander: true } });
        const e = inner.effects[0];
        if (e.op === 'continuous') return cmd(e);
        if (e.op === 'sequence' && (e.list || []).every(x => x.op === 'continuous')) { e.list.forEach(cmd); return e; }
        return null;
      } },
    /* Soulbond: "As long as this creature is paired with another creature,
       each of those creatures gets +4/+4 / both creatures have flying /
       each of those creatures has '…'" — read as a group's rule, and the
       group is the pair */
    { re: /^As long as (?:CARDNAME|this creature) is paired with another creature, (?:each of those creatures|both creatures) (has|have|gets?|get) (.+)$/i,
      make: (m) => {
        const verb = /^ha/i.test(m[1]) ? 'have' : 'get';
        const inner = parseContinuous('Creatures you control ' + verb + ' ' + m[2]);
        if (!inner || inner.effects.length !== 1) return null;
        const pair = (e) => Object.assign(e, { scope: { paired: true } });
        const e = inner.effects[0];
        if (e.op === 'continuous') return pair(e);
        if (e.op === 'sequence' && (e.list || []).every(x => x.op === 'continuous')) { e.list.forEach(pair); return e; }
        return null;
      } },
    // Archetype of Imagination: "Creatures your opponents control lose flying and can't have or gain flying."
    { re: /^(Creatures your opponents control|Creatures you control|All creatures|Other creatures) lose ([a-z ]+?) and can'?t have or gain \2\.?$/i,
      make: (m) => {
        const scope = scopeOf(/^All creatures$/i.test(m[1]) ? 'creatures' : m[1]);
        const k = m[2].toLowerCase();
        return scope && kwKnown(k) ? { op: 'continuous', layer: 6, scope, lose: [k[0].toUpperCase() + k.slice(1)], cantHave: [k] } : null;
      } },
    // Maha: "Creatures your opponents control have base toughness 1."
    { re: /^(.+?) (?:have|has) base toughness (\d+)\.?$/i,
      make: (m) => { const scope = scopeOf(m[1]); return scope ? { op: 'continuous', layer: 7, scope, setPt: { t: +m[2] } } : null; } },
    // Leyline of the Guildpact: "Each nonland permanent you control is all colors."
    { re: /^(.+?) (?:is|are) all colors\.?$/i,
      make: (m) => {
        // "Each nonland permanent you control" is the group, said one at a time
        const scope = scopeOf(m[1].replace(/^Each (.+?)(permanent|creature|artifact)( you control)$/i, '$1$2s$3'));
        return scope ? { op: 'continuous', layer: 5, scope, setColors: ['W', 'U', 'B', 'R', 'G'] } : null;
      } },
    /* Witness Protection: "Enchanted creature loses all abilities and is a
       green and white Citizen creature with base power and toughness 1/1
       named …" (the name is the table's to show, not a rule) */
    { re: /^Enchanted creature loses all abilities and is an? ((?:white|blue|black|red|green)(?: and (?:white|blue|black|red|green))?) ([A-Z][a-z]+) creature with base power and toughness (\d+)\/(\d+)(?: named [^.]+)?\.?$/,
      make: (m) => {
        const CW = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
        return { op: 'continuous', layer: 4, scope: { attached: true }, loseAll: true, setTypes: ['Creature'], setCreatureTypes: [m[2]],
          setColors: m[1].split(' and ').map(c => CW[c]), setPt: { p: +m[3], t: +m[4] } };
      } },
    { re: /^(.+?) gets? ([+-]\d+)\/([+-]\d+) and (can'?t block|can'?t be blocked|attacks each combat if able|(?:doesn'?t|don'?t) untap during [a-z' ]+ untap steps?|loses? all abilities)\.?$/i,
      make: (m) => {
        const scope = scopeOf(m[1]);
        const part = scope && restrictionPart(Object.assign({}, scope), m[4]);
        if (!part) return null;
        return { op: 'sequence', list: [{ op: 'continuous', layer: 7, scope, pt: { p: pmNum(m[2]), t: pmNum(m[3]) } }, part] };
      } },
    // Stupefying Touch: "Enchanted creature's activated abilities can't be activated."
    { re: /^(Enchanted creature|Enchanted permanent|Equipped creature)'s activated abilities can'?t be activated\.?$/i,
      make: (m) => { const scope = scopeOf(m[1]); return scope ? { op: 'continuous', layer: 6, scope, flag: 'cantActivate' } : null; } },
    // Encrust: "doesn't untap during its controller's untap step and its activated abilities can't be activated"
    { re: /^(Enchanted creature|Enchanted permanent|Enchanted artifact) doesn'?t untap during its controller'?s untap step and its activated abilities can'?t be activated\.?$/i,
      make: (m) => { const scope = scopeOf(m[1]); return scope ? { op: 'sequence', list: [{ op: 'continuous', layer: 6, scope, flag: 'noUntap' },
        { op: 'continuous', layer: 6, scope: Object.assign({}, scope), flag: 'cantActivate' }] } : null; } },
    // Grounded: "Enchanted creature loses flying."
    { re: /^(Enchanted creature|Equipped creature) loses (flying|first strike|trample|deathtouch|lifelink|vigilance|reach|haste|menace|defender|hexproof|indestructible)\.?$/i,
      make: (m) => { const scope = scopeOf(m[1]); return scope ? { op: 'continuous', layer: 6, scope, lose: [U.titleCase(m[2].toLowerCase())] } : null; } },
    // Sandskin, Candletrap: combat damage prevented to and/or by what this enchants
    { re: /^Prevent all combat damage that would be dealt (to and dealt by|by|to) (enchanted creature|equipped creature)\.?$/i,
      make: (m) => {
        const scope = scopeOf(m[2]);
        if (!scope) return null;
        const flags = /to and/i.test(m[1]) ? ['noDamage', 'noDamageTaken'] : /^by/i.test(m[1]) ? ['noDamage'] : ['noDamageTaken'];
        return flags.length === 1 ? { op: 'continuous', layer: 6, scope, flag: flags[0] }
          : { op: 'sequence', list: flags.map(f => ({ op: 'continuous', layer: 6, scope: Object.assign({}, scope), flag: f })) };
      } },
    // "This creature can't be blocked as long as you've drawn two or more cards this turn."
    { re: /^(.+?) can'?t be blocked as long as (.+?)\.?$/i,
      make: (m) => {
        const scope = scopeOf(m[1]);
        const cond = condOf(m[2]);
        return scope && cond ? { op: 'continuous', layer: 6, scope, cond, grant: ['Unblockable'] } : null;
      } },
    { re: /^(.+?) can attack as though (?:it|they) didn'?t have defender\.?$/i,
      make: (m) => { const scope = scopeOf(m[1]); return scope ? restrictionPart(scope, 'can attack as though it didn\'t have defender') : null; } },
    { re: /^(.+?) (?:has|have) ([a-z ,]+?) and can attack as though (?:it|they) didn'?t have defender\.?$/i,
      make: (m) => {
        const scope = scopeOf(m[1]);
        const kws = keywordList(m[2]);
        if (!scope || !kws.length || !kws.every(kwKnown)) return null;
        return { op: 'sequence', list: [{ op: 'continuous', layer: 6, scope, grant: kws },
          restrictionPart(Object.assign({}, scope), 'can attack as though it didn\'t have defender')] };
      } },
    /* Spreading Seas, Magus of the Moon: a land whose land type is set
       loses the old ones, and what its own words gave it (CR 305.7). */
    { re: /^(Enchanted land|Nonbasic lands|Lands you control|Lands your opponents control|All lands) (?:is|are) (?:an? )?(Plains|Island|Swamp|Mountain|Forest)s?\.?$/i,
      make: (m) => {
        const scope = scopeOf(m[1]);
        if (!scope) return null;
        const t = U.titleCase(m[2]);
        return { op: 'continuous', layer: 4, scope, setSubtypes: [t], setMana: [MANA.COLOR_OF_BASIC[t]] };
      } },
    /* Opalescence, March of the Machines, Enchanted Evening: one kind of
       permanent is another kind as well (layer 4), perhaps with its power
       and toughness its mana value (7b). */
    { re: /^(.+?) (?:is|are) (?:an? )?((?:artifact |enchantment )?)(creatures?|artifacts?|enchantments?|lands?) in addition to (?:its|their) other types(?: and (?:has|have) base power and (?:base )?toughness each equal to (?:its|their) mana value)?\.?$/i,
      make: (m) => {
        const scope = eachScope(m[1]);
        if (!scope || scope.self || scope.attached) return null;
        const t = m[3].replace(/s$/i, '');
        const ef = { op: 'continuous', layer: 4, scope, addTypes: [t[0].toUpperCase() + t.slice(1).toLowerCase()] };
        if (/mana value/i.test(m[0])) ef.setPt = { mv: true };
        return ef;
      } },
    { re: /^(.+?) (?:is|are) (?:an? )?(?:artifact )?creatures? with (?:base )?power and toughness each equal to (?:its|their) mana value\.?$/i,
      make: (m) => {
        const scope = eachScope(m[1]);
        if (!scope || scope.self || scope.attached) return null;
        return { op: 'continuous', layer: 4, scope, addTypes: ['Creature'], setPt: { mv: true } };
      } },
    /* Imprisoned in the Moon */
    { re: /^(Enchanted (?:permanent|creature|land)) is an? colorless land with "\{T\}: Add \{C\}\.?" and loses all other card types and abilities\.?$/i,
      make: (m) => {
        const scope = scopeOf(m[1]);
        if (!scope) return null;
        const ab = { kind: 'mana', auto: true, granted: true, cost: parseCost('{T}'), text: '{T}: Add {C}.', effects: [{ op: 'addMana', symbols: ['C'] }] };
        return { op: 'continuous', layer: 4, scope, setTypes: ['Land'], setColors: [], loseAll: true, grantMana: [ab] };
      } },
    /* Humility, Godhead of Awe, Lignify, Darksteel Mutation: what something
       is for as long as the static ability lasts (becomesEff). */
    { re: /^(.+?) ((?:loses?|lose|is|are|has|have) .+)$/i,
      make: (m) => {
        const scope = scopeOf(m[1]);
        if (!scope || scope.self) return null;
        const eff = becomesEff(m[2]);
        if (!eff || !(eff.loseAll || eff.setPt || eff.setCreatureTypes || eff.setTypes)) return null;
        const ef = Object.assign({ op: 'continuous', layer: eff.setTypes || eff.addTypes || eff.setCreatureTypes ? 4 : eff.setColors ? 5 : eff.loseAll ? 6 : 7, scope }, eff);
        // a static ability grants what a resolved effect would call keywords
        if (ef.keywords) { ef.grant = ef.keywords; delete ef.keywords; }
        return ef;
      } },

    { re: /^(.+?) gets? ([+-]\d+)\/([+-]\d+) and loses ([a-z ,]+?)\.?$/i,
      make: (m) => {
        const scope = scopeOf(m[1]);
        const kws = keywordList(m[4]);
        if (!scope || !kws.every(kwKnown)) return null;
        return { op: 'continuous', layer: 7, scope, pt: { p: +m[2], t: +m[3] }, lose: kws };
      } },
    { re: /^As long as equipped creature is legendary, it has ([a-z ,]+?)\.?$/i,
      make: (m) => {
        const kws = keywordList(m[1]);
        if (!kws.every(kwKnown)) return null;
        return { op: 'continuous', layer: 6, scope: { attached: true, legendary: true }, grant: kws };
      } },
    /* Ethereal Armor: a count, and a keyword with it */
    { re: /^(.+?) gets? \+(\d+)\/\+(\d+) for each ([-a-zA-Z0-9+/' ]+?) and (?:has|have) ([a-z, '{}0-9]+?)\.?$/i,
      make: (m) => {
        const scope = scopeOf(m[1]);
        const c = countOf(m[4]);
        const kws = keywordList(m[5]);
        if (!scope || !c || !kws.length || !kws.every(kwKnown)) return null;
        return { op: 'sequence', list: [
          { op: 'continuous', layer: 7, scope, pt: { p: Object.assign({}, c, { mult: +m[2] }), t: Object.assign({}, c, { mult: +m[3] }) } },
          { op: 'continuous', layer: 6, scope: Object.assign({}, scope), grant: kws }] };
      } },
    /* Wonder, Brawn, Anger: a card that does its work from the graveyard,
       usually while you control the right land. */
    { re: /^As long as (?:this card|CARDNAME) is in your graveyard(?: and (.+?))?, (.+)$/i,
      make: (m) => {
        const cond = m[1] ? condOf(m[1]) : null;
        if (m[1] && !cond) return null;
        const inner = parseContinuous(m[2].replace(/^(\w)/, (c) => c.toUpperCase()));
        const ef = inner && inner.effects.length === 1 ? inner.effects[0] : null;
        if (!ef || ef.op !== 'continuous' || ef.scope.self || ef.scope.attached) return null;
        const conds = [].concat(ef.cond || [], cond || []);
        return Object.assign({}, ef, { fromGraveyard: true }, conds.length ? { cond: conds.length === 1 ? conds[0] : conds } : {});
      } },
    /* "This creature gets +1/+0 for each artifact you control." */
    { re: /^(.+?) gets? \+(\d+)\/\+(\d+) for each ([-a-zA-Z0-9+/' ]+?)\.?$/i,
      make: (m) => {
        const scope = scopeOf(m[1]);
        const c = countOf(m[4].replace(/ on the battlefield$/i, '')) ;
        if (!scope || !c) return null;
        if (/ on the battlefield$/i.test(m[4]) && c.scope) c.scope.who = 'all';
        return { op: 'continuous', layer: 7, scope, pt: { p: Object.assign({}, c, { mult: +m[2] }), t: Object.assign({}, c, { mult: +m[3] }) } };
      } },
    /* "Each land is a Swamp in addition to its other land types." (Urborg)
       Every land taps for black as well, because a Swamp does. */
    { re: /^Each (other )?land is an? (Plains|Island|Swamp|Mountain|Forest) in addition to its other (?:land )?types\.?$/i,
      make: (m) => ({ op: 'continuous', layer: 4, scope: { who: 'all', what: 'land', other: !!m[1] },
        addSubtypes: [U.titleCase(m[2])] }) },
    { re: /^(.+?) (?:is|are) every basic land type in addition to (?:its|their) other types\.?$/i,
      make: (m) => {
        const scope = scopeOf(m[1]);
        if (!scope) return null;
        return { op: 'continuous', layer: 4, scope, addSubtypes: BASIC_TYPES.slice() };
      } },
    /* "Lands you control have '{T}: Add one mana of any color.'" — a mana
       ability handed out, which the lands then tap for like their own. */
    /* "Equipped creature gets +1/+0 and has 'Whenever this creature
       attacks, …'": a bonus, perhaps a keyword, and an ability in
       quotation marks, all handed over together. */
    { re: /^(.+?) (?:gets? ([+-][\dX]+)\/([+-][\dX]+) and )?(?:has|have) (?:([a-z, '{}0-9]+?),? and )?"([^"]+)"\.?$/i,
      make: (m) => {
        if (!m[2] && !m[4]) return null;      // the plain shape is the rule below
        const scope = scopeOf(m[1]);
        if (!scope || !grantableText(m[5])) return null;
        const list = [{ op: 'continuous', layer: 6, scope, grantText: m[5] }];
        if (m[4]) {
          const kws = keywordList(m[4]);
          if (!kws.length || !kws.every(k => kwKnown(k))) return null;
          list.push({ op: 'continuous', layer: 6, scope: Object.assign({}, scope), grant: kws });
        }
        if (m[2]) list.push({ op: 'continuous', layer: 7, scope: Object.assign({}, scope), pt: { p: pmNum(m[2]), t: pmNum(m[3]) } });
        return { op: 'sequence', list };
      } },
    /* Diviner's Wand, Ichormoon Gauntlet: 'has "…" and "…"' — two abilities handed out */
    { re: /^(.+?) (?:gets? ([+-]\d+)\/([+-]\d+) and )?(?:has|have) "([^"]+)" and "([^"]+)"\.?$/i,
      make: (m) => {
        const scope = scopeOf(m[1]);
        if (!scope) return null;
        const one = (t) => {
          if (grantableText(t)) return { op: 'continuous', layer: 6, scope: Object.assign({}, scope), grantText: t };
          const qk = matchKeyword(t.replace(/\.$/, ''));
          return qk && kwKnown(qk.text) ? { op: 'continuous', layer: 6, scope: Object.assign({}, scope), grant: [qk.text] } : null;
        };
        const a = one(m[4]), b = one(m[5]);
        if (!a || !b) return null;
        const list = [a, b];
        if (m[2]) list.push({ op: 'continuous', layer: 7, scope: Object.assign({}, scope), pt: { p: pmNum(m[2]), t: pmNum(m[3]) } });
        return { op: 'sequence', list };
      } },
    { re: /^(.+?) (?:has|have) "([^"]+)"\.?$/i,
      make: (m) => {
        const scope = scopeOf(m[1]);
        if (!scope) return null;
        /* a triggered ability handed out: the engine reads it as the
           permanent's own while the static ability lasts */
        if (grantableText(m[2])) return { op: 'continuous', layer: 6, scope, grantText: m[2] };
        /* Hexing Squelcher: 'have "Ward—Pay 2 life."' is a keyword in quotes */
        const qk = matchKeyword(m[2].replace(/\.$/, ''));
        if (qk && kwKnown(qk.text)) return { op: 'continuous', layer: 6, scope, grant: [qk.text] };
        const inner = m[2].match(/^([^:]+):\s*(.+)$/);
        if (!inner) return null;
        const cost = parseCost(inner[1]);
        const parsed = parseEffects(inner[2]);
        if (!parsed.auto || !isManaAbility(parsed.effects) || !costIsAutomatable(cost)) return null;
        /* "Spend this mana only to cast an instant or sorcery spell" is the
           granted ability's own restriction, kept with it as on a printed one */
        const spend = parsed.effects.find(e => e.op === 'spendOnly');
        const ab = { kind: 'mana', auto: true, granted: true, cost, text: m[2], effects: parsed.effects.filter(e => e.op !== 'spendOnly') };
        if (spend) ab.spendOnly = spend.open ? { rider: spend.rider, open: true } : spend;
        return { op: 'continuous', layer: 6, scope, grantMana: [ab] };
      } },
    // Dragon's Rage Channeler: "…gets +2/+2, has flying, and attacks each combat if able."
    { re: /^(.+?) gets? ([+-]\d+)\/([+-]\d+), (?:has|have) ([a-z ]+?),? and attacks? each combat if able\.?$/i,
      make: (m) => {
        const scope = scopeOf(m[1]);
        const kws = keywordList(m[4]);
        if (!scope || !kws.length || !kws.every(kwKnown)) return null;
        return { op: 'continuous', layer: 7, scope, pt: { p: pmNum(m[2]), t: pmNum(m[3]) }, grant: kws, flag: 'mustAttackEot' };
      } },
    // "<scope> get +1/+1 and have flying."
    { re: /^(.+?) gets? ([+-][\dX]+)\/([+-][\dX]+)(?: and (?:has|have) ([a-z, '{}0-9]+?))?\.?$/i,
      make: (m) => {
        const scope = scopeOf(m[1]);
        if (!scope) return null;
        return { op: 'continuous', layer: 7, scope, pt: { p: pmNum(m[2]), t: pmNum(m[3]) },
          grant: m[4] ? keywordList(m[4]) : null };
      } },
    // "<scope> have flying and vigilance."
    { re: /^(.+?) (?:has|have) ([a-z, '{}0-9]+?)\.?$/i,
      make: (m) => {
        const scope = scopeOf(m[1]);
        if (!scope) return null;
        const kws = keywordList(m[2]);
        // Akroma's Memorial: a long list, ending in protection from two colours
        if (!kws.length || !kws.every(k => kwKnown(k) || /^protection from [a-z]+(?: and from [a-z]+)*$/i.test(k))) return null;
        return { op: 'continuous', layer: 6, scope, grant: kws };
      } },
    { re: /^During your turn, (?:CARDNAME|this creature) has ([a-z ,']+?)\.?$/i,
      make: (m) => {
        const kws = keywordList(m[1]);
        if (!kws.every(kwKnown)) return null;
        return { op: 'continuous', layer: 6, scope: { self: true, what: 'creature' }, grant: kws, cond: { kind: 'yourTurn' } };
      } },
    // Razorkin Needlehead: "This creature has first strike during your turn."
    { re: /^(?:CARDNAME|This creature) has ([a-z ,']+?) during your turn\.?$/i,
      make: (m) => {
        const kws = keywordList(m[1]);
        if (!kws.every(k => kwKnown(k))) return null;
        return { op: 'continuous', layer: 6, scope: { self: true, what: 'creature' }, grant: kws, cond: { kind: 'yourTurn' } };
      } },
    // "<scope> can't be blocked and has shroud."
    { re: /^(.+?) can'?t be blocked(?: and (?:has|have) ([a-z, '{}0-9]+?))?\.?$/i,
      make: (m) => {
        const scope = scopeOf(m[1]);
        if (!scope) return null;
        return { op: 'continuous', layer: 6, scope, grant: ['Unblockable'].concat(m[2] ? keywordList(m[2]) : []) };
      } },
    // "<scope> doesn't untap during its controller's untap step."
    { re: /^(.+?) (?:doesn'?t|don'?t) untap during (?:its controller'?s|their controllers'?|your|their) untap steps?\.?$/i,
      make: (m) => {
        const scope = scopeOf(m[1]);
        if (!scope) return null;
        return { op: 'continuous', layer: 6, scope, flag: 'noUntap' };
      } },
    // "As long as this creature is equipped, it has first strike and lifelink."
    { re: /^As long as (?:this creature|CARDNAME) is (equipped|enchanted), it (?:has|gains) ([a-z, '{}0-9]+?)\.?$/i,
      make: (m) => ({ op: 'continuous', layer: 6, scope: { self: true, whileAttached: true }, grant: keywordList(m[2]) }) },
    // "<scope> attack each combat if able."
    { re: /^(.+?) attacks? each combat if able\.?$/i,
      make: (m) => {
        const scope = scopeOf(m[1]);
        if (!scope) return null;
        return { op: 'continuous', layer: 6, scope, flag: 'mustAttackEot' };
      } },
    // "Enchanted creature can't attack or block, and its activated abilities
    // can't be activated." — one sentence, two standing rules
    { re: /^(.+?) can'?t (block|attack|attack or block), and its activated abilities can'?t be activated\.?$/i,
      make: (m) => {
        const scope = scopeOf(m[1]);
        if (!scope) return null;
        const flag = m[2] === 'block' ? 'cantBlock' : m[2] === 'attack' ? 'cantAttack' : 'cantAttackOrBlock';
        return { op: 'sequence', list: [
          { op: 'continuous', layer: 6, scope, flag },
          { op: 'continuous', layer: 6, scope: Object.assign({}, scope), flag: 'cantActivate' },
        ] };
      } },
    // "<scope> can't block." / "can't attack."
    { re: /^(.+?) can'?t (block|attack|attack or block)\.?$/i,
      make: (m) => {
        const scope = scopeOf(m[1]);
        if (!scope) return null;
        const flag = m[2] === 'block' ? 'cantBlock' : m[2] === 'attack' ? 'cantAttack' : 'cantAttackOrBlock';
        return { op: 'continuous', layer: 6, scope, flag };
      } },
    // "<name>'s power and toughness are each equal to the number of X you control."
    { re: /^(?:CARDNAME|This creature)'?s? power and toughness are each equal to the number of ([-a-z' ]+?)(?: you control| on the battlefield)?\.?$/i,
      make: (m) => ({ op: 'continuous', layer: 7, cda: true, scope: { self: true },
        setPt: { p: countSpec(m[1], 1, /on the battlefield/i.test(m[0]) ? 'any' : 'you'),
          t: countSpec(m[1], 1, /on the battlefield/i.test(m[0]) ? 'any' : 'you') } }) },
    { re: /^(?:CARDNAME|This creature)'?s? power is equal to the number of ([-a-z' ]+?)(?: you control| on the battlefield)? and its toughness is equal to that number plus (\d+)\.?$/i,
      make: (m) => ({ op: 'continuous', layer: 7, cda: true, scope: { self: true },
        setPt: { p: countSpec(m[1], 1, 'any'), t: countSpec(m[1], 1, 'any'), tPlus: +m[2] } }) },
    // "<scope> gets +2/+0 as long as you control an artifact."
    { re: /^(.+?) gets? ([+-][\dX]+)\/([+-][\dX]+) as long as (.+?)\.?$/i,
      make: (m) => {
        const scope = scopeOf(m[1]);
        const cond = condOf(m[4]);
        if (!scope || !cond) return null;
        return { op: 'continuous', layer: 7, scope, cond, pt: { p: pmNum(m[2]), t: pmNum(m[3]) } };
      } },
    /* "Each creature you control with a +1/+1 counter on it has trample." */
    { re: /^Each creature you control with an? ([+\-0-9/a-z' ]+?) counter on it (?:has|have) ([a-z, '{}0-9]+?)\.?$/i,
      make: (m) => {
        if (!KW_LIST.test(m[2])) return null;
        const kws = keywordList(m[2]);
        if (!kws.every(k => kwKnown(k))) return null;
        return { op: 'continuous', layer: 6, scope: { who: 'you', what: 'creature', withCounter: m[1].trim() }, grant: kws };
      } },
    // "As long as you control a Forest, this creature has trample."
    { re: /^As long as (.+?), (.+?) (?:has|have|gains?) ([a-z, '{}0-9]+?)\.?$/i,
      make: (m) => {
        const cond = condOf(m[1]);
        const scope = scopeOf(m[2]);
        if (!cond || !scope) return null;
        if (!KW_LIST.test(m[3])) return null;
        const kws = keywordList(m[3]);
        if (!kws.every(k => kwKnown(k))) return null;
        return { op: 'continuous', layer: 6, scope, cond, grant: kws };
      } },
    // "As long as you control three or more artifacts, this creature gets +2/+2."
    { re: /^As long as (.+?), (.+?) gets? ([+-][\dX]+)\/([+-][\dX]+)\.?$/i,
      make: (m) => {
        const cond = condOf(m[1]);
        const scope = scopeOf(m[2]);
        if (!cond || !scope) return null;
        return { op: 'continuous', layer: 7, scope, cond, pt: { p: pmNum(m[3]), t: pmNum(m[4]) } };
      } },
    /* "As long as …, CARDNAME gets +2/+2 and has flying." — one condition,
       two things it does. */
    { re: /^As long as (.+?), (.+?) gets? ([+-][\dX]+)\/([+-][\dX]+) and (?:has|have|gains?) ([a-z, '{}0-9]+?)\.?$/i,
      make: (m) => {
        const cond = condOf(m[1]);
        const scope = scopeOf(m[2]);
        if (!cond || !scope) return null;
        if (!KW_LIST.test(m[5])) return null;
        const kws = keywordList(m[5]);
        if (!kws.every(k => kwKnown(k))) return null;
        return { op: 'continuous', layer: 7, scope, cond, pt: { p: pmNum(m[3]), t: pmNum(m[4]) }, grant: kws };
      } },
    { re: /^(.+?) gets? ([+-][\dX]+)\/([+-][\dX]+) and (?:has|have|gains?) ([a-z, '{}0-9]+?)\.?$/i,
      make: (m) => {
        const scope = scopeOf(m[1]);
        if (!scope) return null;
        if (!KW_LIST.test(m[4])) return null;
        const kws = keywordList(m[4]);
        if (!kws.every(k => kwKnown(k))) return null;
        return { op: 'continuous', layer: 7, scope, pt: { p: pmNum(m[2]), t: pmNum(m[3]) }, grant: kws };
      } },
    // "<scope> has flying as long as you control an Island."
    { re: /^(.+?) (?:has|have) ([a-z, '{}0-9]+?) as long as (.+?)\.?$/i,
      make: (m) => {
        const scope = scopeOf(m[1]);
        const cond = condOf(m[3]);
        if (!scope || !cond) return null;
        if (!KW_LIST.test(m[2])) return null;
        const kws = keywordList(m[2]);
        if (!kws.every(k => kwKnown(k))) return null;
        return { op: 'continuous', layer: 6, scope, cond, grant: kws };
      } },
    // "Prevent all combat damage that would be dealt to and dealt by this creature."
    { re: /^Prevent all combat damage that would be dealt to and dealt by (?:CARDNAME|this creature)\.?$/i,
      make: () => ({ op: 'sequence', list: [
        { op: 'continuous', layer: 6, scope: { self: true, what: 'creature' }, flag: 'noDamage' },
        { op: 'continuous', layer: 6, scope: { self: true, what: 'creature' }, flag: 'noDamageTaken' },
      ] }) },
    { re: /^Prevent all combat damage that would be dealt by (?:CARDNAME|this creature)\.?$/i,
      make: () => ({ op: 'continuous', layer: 6, scope: { self: true, what: 'creature' }, flag: 'noDamage' }) },
    { re: /^Prevent all combat damage that would be dealt to (?:CARDNAME|this creature)\.?$/i,
      make: () => ({ op: 'continuous', layer: 6, scope: { self: true, what: 'creature' }, flag: 'noDamageTaken' }) },
    // the Phantoms: "If damage would be dealt to this creature, prevent that damage. Remove a +1/+1 counter from this creature."
    { re: /^If damage would be dealt to (?:CARDNAME|this creature), prevent that damage\. Remove a \+1\/\+1 counter from (?:CARDNAME|this creature)\.?$/i,
      make: () => ({ op: 'continuous', layer: 6, scope: { self: true, what: 'creature' }, flag: 'phantom' }) },
    // Crystal Barricade: "Prevent all noncombat damage that would be dealt to other creatures you control."
    { re: /^Prevent all noncombat damage that would be dealt to (other creatures you control|creatures you control)\.?$/i,
      make: (m) => ({ op: 'continuous', layer: 6, scope: Object.assign({ who: 'you', what: 'creature' }, /^other/i.test(m[1]) ? { other: true } : {}), flag: 'noNoncombatTaken' }) },
    { re: /^(?:CARDNAME|This creature) gets ([+-])X\/([+-])X, where X is your life total\.?$/i,
      make: (m) => ({ op: 'continuous', layer: 7, scope: { self: true },
        pt: { p: { life: m[1] === '-' ? -1 : 1 }, t: { life: m[2] === '-' ? -1 : 1 } } }) },
  ];

  /* ---------------- replacement effects (CR 614) ----------------
     "If X would happen, Y happens instead." Nothing goes on the stack; the
     event is simply different by the time it arrives. */
  const REPLACEMENT_RULES = [
    { re: /^If an effect would create one or more tokens under your control, it creates twice that many of those tokens instead\.?$/i,
      make: () => ({ op: 'replace', id: 'tokDouble', event: 'createToken', who: 'you', how: 'double' }) },
    /* Innkeeper's Talent, Vorinclex: whoever puts the counters, on any
       permanent or player */
    { re: /^If you would put one or more counters on a permanent or player, put twice that many of each of those kinds of counters on that permanent or player instead\.?$/i,
      make: () => ({ op: 'replace', id: 'cntDoubleYou', event: 'counters', who: 'putter', players: true, how: 'double' }) },
    { re: /^If an opponent would put one or more counters on a permanent or player, they put half that many of each of those kinds of counters on that permanent or player instead, rounded down\.?$/i,
      make: () => ({ op: 'replace', id: 'cntHalfOpp', event: 'counters', who: 'opponentPutter', players: true, how: 'half' }) },
    { re: /^If an effect would put one or more counters on a permanent you control, it puts twice that many of those counters on that permanent instead\.?$/i,
      make: () => ({ op: 'replace', id: 'cntDouble', event: 'counters', who: 'you', how: 'double' }) },
    { re: /^If (?:a card|a card or token|one or more cards?) would be put into (a|your|an opponent'?s) graveyard from anywhere, (?:exile (?:it|them|that card) instead|instead exile (?:it|them))( with an? ([a-z]+) counter on (?:it|them))?\.?$/i,
      make: (m) => Object.assign({ op: 'replace', id: 'gyExile', event: 'zoneChange', toZone: 'graveyard', how: 'toZone', zone: 'exile',
        who: 'all', owner: /opponent/i.test(m[1]) ? 'opponents' : /your/i.test(m[1]) ? 'you' : null }, m[3] ? { withCounter: m[3].toLowerCase() } : {}) },
    /* Hardened Scales and friends: one more counter, or twice as many */
    { re: /^If one or more \+1\/\+1 counters would be put on (?:a|an) (creature|permanent|artifact|artifact or creature) you control, that many plus one \+1\/\+1 counters are put on (?:it|that \w+) instead\.?$/i,
      make: (m) => Object.assign({ op: 'replace', id: 'cntPlus1', event: 'counters', who: 'you', how: 'add', n: 1, counter: '+1/+1' },
        / or /.test(m[1]) ? { whatAny: ['artifact', 'creature'] } : { what: m[1].toLowerCase() }) },
    { re: /^If one or more \+1\/\+1 counters would be put on (?:a|an) (creature|permanent)( you control)?, twice that many \+1\/\+1 counters are put on (?:it|that \w+) instead\.?$/i,
      make: (m) => ({ op: 'replace', id: 'cntDouble11', event: 'counters', who: m[2] ? 'you' : 'all', how: 'double', counter: '+1/+1', what: m[1].toLowerCase() }) },
    { re: /^If one or more tokens would be created under your control, twice that many of those tokens are created instead\.?$/i,
      make: () => ({ op: 'replace', id: 'tokDouble', event: 'createToken', who: 'you', how: 'double' }) },
    { re: /^If one or more (creature |artifact |Treasure )?tokens would be created( under your control)?, (twice|three times) that many of those tokens are created instead\.?$/i,
      make: (m) => ({ op: 'replace', id: 'tokMany', event: 'createToken', who: m[2] ? 'you' : 'all',
        how: /three/i.test(m[3]) ? 'triple' : 'double', tokenWhat: m[1] ? m[1].trim().toLowerCase() : null }) },
    /* Peregrin Took, Xorn, Chatterfang: those tokens, and one more of another kind */
    { re: /^If (?:one or more (artifact |creature )?tokens would be created under your control|you would create one or more (Treasure|Food|Clue) tokens), (?:instead create )?those tokens plus (an additional|that many) ([^.]+?) tokens?(?: are created)?(?: instead)?\.?$/i,
      make: (m) => {
        const named = m[4].match(/^(Treasure|Food|Clue|Blood|Map)$/i);
        let extra = null;
        if (named) extra = { named: U.titleCase(named[1]) };
        else {
          const tok = parseTokenSentence('Create a ' + m[4] + ' token');
          if (!tok || tok.op !== 'createToken') return null;
          extra = { spec: Object.assign({}, tok, { n: 1 }) };
        }
        extra.thatMany = /that many/i.test(m[3]);
        extra.n = 1;
        return { op: 'replace', id: 'tokPlus', event: 'createToken', who: 'you', how: 'plus', extra,
          tokenWhat: (m[1] || m[2] || '').trim().toLowerCase() || null };
      } },
    /* Fiery Emancipation, Twinflame Tyrant, Torbran, Gratuitous Violence */
    { re: /^If an? ((?:red |green |white |blue |black )?(?:source|creature)) you control would deal (noncombat )?damage to (a permanent or player|an opponent or a permanent an opponent controls), it deals (double|triple|that much damage plus (?:one|two|three|\d+))(?: that damage)?(?: to that (?:permanent or player|player or permanent))? instead\.?$/i,
      make: (m0) => {
        // Artist's Talent: "would deal noncombat damage"
        const noncombat = !!m0[2];
        const m = [m0[0], m0[1], m0[3], m0[4]];
        const words = m[1].toLowerCase().replace(/\bsource\b/, '').trim();
        const plus = m[3].match(/plus (\w+)/i);
        return Object.assign({ op: 'replace', id: 'dmg' + m[3].slice(0, 6), event: 'damage', who: 'you',
          toOpponent: /opponent/i.test(m[2]), sourceWords: words || null }, noncombat ? { noncombat: true } : {},
          plus ? { how: 'add', n: num(plus[1]) } : { how: m[3].toLowerCase() });
      } },
    // The Water Crystal: "If an opponent would mill one or more cards, they mill that many cards plus four instead."
    { re: /^If an opponent would mill one or more cards, they mill that many cards plus (one|two|three|four|five|\d+) instead\.?$/i,
      make: (m) => ({ op: 'replace', id: 'millPlus', event: 'mill', who: 'opponents', how: 'add', n: num(m[1]) }) },
    /* Blightsteel Colossus, Nexus of Fate: never stays in a graveyard */
    { re: /^If (?:CARDNAME|this card) would be put into a graveyard from anywhere, reveal (?:CARDNAME|it|this card) and shuffle it into its owner'?s library instead\.?$/i,
      make: () => ({ op: 'shuffleInsteadOfGrave' }) },
    /* Bloodletter of Aclazotz */
    { re: /^If an opponent would lose life( during your turn)?, they lose twice that much life instead\.?$/i,
      make: (m) => Object.assign({ op: 'replace', id: 'lossDouble', event: 'loseLife', who: 'opponents', how: 'double' }, m[1] ? { duringYourTurn: true } : {}) },
    { re: /^If you would gain life, you gain that much life plus (one|two|three|\d+) instead\.?$/i,
      make: (m) => ({ op: 'replace', id: 'lifePlus', event: 'gainLife', who: 'you', how: 'add', n: num(m[1]) }) },
    { re: /^If you would gain life, you gain twice that much life instead\.?$/i,
      make: () => ({ op: 'replace', id: 'lifeDouble', event: 'gainLife', who: 'you', how: 'double' }) },
    /* Authority of the Consuls, Blind Obedience: the other side's arrivals come in tapped */
    // Kismet, Frozen Aether: "Artifacts, creatures, and lands your opponents control enter tapped."
    { re: /^((?:Artifacts|Creatures|Lands|Permanents|Nonland permanents|Nonbasic lands)(?:,? (?:and )?(?:artifacts|creatures|lands|nonbasic lands))*) your opponents control enter (?:the battlefield )?tapped\.?$/i,
      make: (m) => ({ op: 'replace', id: 'etbTapOpp', event: 'enters', who: 'opponents', how: 'tapped',
        whatAny: m[1].toLowerCase().replace(/^nonland permanents$/, 'nonland').split(/,? and |, /).filter(Boolean).map(w => w.replace(/s$/, '')) }) },
    // Possessed Skaab: "If this creature would die, exile it instead."
    { re: /^If (?:CARDNAME|this creature) would die, exile it instead\.?$/i,
      make: () => ({ op: 'replace', id: 'selfDieExile', event: 'zoneChange', who: 'all', self: true, fromZone: 'battlefield', toZone: 'graveyard', how: 'toZone', zone: 'exile' }) },
    { re: /^If a creature would die, exile it instead\.?$/i,
      make: () => ({ op: 'replace', id: 'dieExile', event: 'zoneChange', who: 'all', what: 'creature', how: 'toZone', zone: 'exile' }) },
    { re: /^If a creature dealt damage this way would die this turn, exile it instead\.?$/i,
      make: () => ({ op: 'replace', id: 'dmgExile', event: 'zoneChange', who: 'all', what: 'creature', how: 'toZone', zone: 'exile' }) },
    { re: /^(Permanents|Creatures|Artifacts|Lands) you control enter (?:the battlefield )?tapped\.?$/i,
      make: (m) => ({ op: 'replace', id: 'etbTap', event: 'enters', who: 'you', how: 'tapped', whatAny: [m[1].toLowerCase().replace(/s$/, '')] }) },
    /* "Creature spells you control can't be countered." */
    { re: /^((?:[A-Z][a-z]+ )?(?:creature |noncreature |instant and sorcery |green |blue |red |white |black |[a-z]+ and [a-z]+ )?spells?) you control can'?t be countered\.?$/i,
      make: (m) => ({ op: 'uncounterable', who: 'you', words: m[1].toLowerCase().replace(/ and /g, ' or ') }) },
    { re: /^(?:CARDNAME|This spell) can'?t be countered\.?$/i, make: () => ({ op: 'cantBeCountered' }) },
    /* Silence on a stick: Grand Abolisher, Voice of Victory, Kutzil */
    { re: /^(?:During your turn, )?[Yy]our opponents can'?t cast spells( during your turn)?( or activate abilities of artifacts, creatures, or enchantments)?\.?$/,
      make: (m) => ({ op: 'castRestrict', who: 'opponents', yourTurnOnly: !!m[1] || /^During/.test(m[0]), abilities: !!m[2] }) },
  ];

  function parseReplacement(line) {
    for (const r of REPLACEMENT_RULES) {
      const m = line.match(r.re);
      if (m) return { kind: 'static', text: line, auto: true, effects: [r.make(m)] };
    }
    return null;
  }

  function parseContinuous(line) {
    for (const r of CONTINUOUS_RULES) {
      const m = line.match(r.re);
      if (!m) continue;
      const eff = r.make(m);
      if (eff) return { kind: 'static', text: line, auto: true, effects: [eff] };
    }
    /* "As long as enchanted creature is white, it gets +1/+1 and has
       lifelink": any standing rule this can read, with the condition on
       it. "It" is what the condition is about. */
    const al = line.match(/^As long as (.+?), (.+)$/i);
    if (al) {
      const cond = condOf(al[1]);
      if (!cond) return null;
      const subject = /\b(?:enchanted (?:creature|permanent))\b/i.test(al[1]) ? 'Enchanted creature'
        : /\bequipped creature\b/i.test(al[1]) ? 'Equipped creature' : 'CARDNAME';
      const body = al[2].replace(/^(?:it|this creature)\b/i, subject).replace(/^(\w)/, (c) => c.toUpperCase());
      if (/^As long as/i.test(body)) return null;
      const inner = parseContinuous(body);
      if (!inner) return null;
      const add = (e) => (e.cond ? Object.assign(e, { cond: [].concat(e.cond, cond) }) : Object.assign(e, { cond }));
      for (const e of inner.effects) {
        if (e.op === 'continuous') add(e);
        else if (e.op === 'sequence' && (e.list || []).every(x => x.op === 'continuous')) e.list.forEach(add);
        else return null;
      }
      return { kind: 'static', text: line, auto: true, effects: inner.effects };
    }
    return null;
  }

  /* Ops that make sense as a permanent's standing rule rather than a one-off. */
  const STATIC_OPS = new Set(['continuous', 'replace', 'taxSpells', 'extraLand',
    'chooseTypeOnEnter', 'chooseColorOnEnter', 'chooseModeOnEnter', 'chooseOnEnter', 'nameLockAbilities', 'nameLockSpells',
    'colorLockSpells', 'protChosenColor', 'uncounterable', 'castRestrict', 'extraManaOnTap', 'etbTappedUnlessCond',
    'skipStep', 'etbTapped', 'cantBlock', 'cantAttack', 'mustAttack', 'mustBlock', 'noop', 'sequence',
    'evasion', 'attackRequires', 'blockPowerLimit', 'toughnessDamage', 'drawDouble', 'cantBeCountered', 'noMaxHandSize', 'noLegendRule', 'preventSomeFromColor', 'goadAttached', 'peekTop', 'optionalUntap',
    'blocksExtra',
    'cumulativeUpkeep', 'activateOnly', 'etbTappedUnlessLife', 'etbTappedUnlessOpponents',
    'etbTappedUnlessReveal', 'etbAsCopy',
    'exploit', 'ascend', 'sacUnlessControl', 'noLifeGain', 'playerHexproof', 'leyline',
    'cantAttackAlone', 'cantBlockAlone', 'etbPrepared', 'lure', 'restrictUnless', 'attackTax', 'cantAttackYou', 'abilityCostMod']);

  function parseStatic(line, ctx) {
    /* the Wards: "Enchanted creature has protection from white. This effect
       doesn't remove this Aura." — the protection, and the Aura stays on */
    const keep = line.match(/^(.+?\.) This effect doesn'?t remove (?:this Aura|CARDNAME)\.?$/i);
    if (keep) {
      const inner = parseStatic(keep[1], ctx);
      if (inner && inner.auto) return Object.assign({}, inner, { text: line, effects: (inner.effects || []).concat([{ op: 'keepDespiteProtection' }]) });
    }
    const rep = parseReplacement(line);
    if (rep) return rep;
    const cm = parseCostMod(line);
    if (cm) return { kind: 'static', text: line, auto: true, effects: [cm] };
    const cont = parseContinuous(line);
    if (cont) return cont;
    const rules = [
      { re: /^(?:CARDNAME|This (?:land|creature|artifact|enchantment|permanent)) enters tapped\.?$/i, eff: { op: 'etbTapped' }, auto: true },
      { re: /^(?:CARDNAME|This (?:land|creature|artifact|enchantment|permanent)) enters the battlefield tapped\.?$/i, eff: { op: 'etbTapped' }, auto: true },
      // "…unless you control two or fewer other lands" and its Karoo cousin
      { re: /^(?:CARDNAME|This (?:land|permanent)) enters(?: the battlefield)? tapped unless you control (one|two|three|four|five|\d+) or fewer other lands\.?$/i,
        make: (m) => ({ op: 'etbTappedUnlessLands', n: num(m[1]) }), auto: true },
      { re: /^(?:CARDNAME|This (?:land|permanent)) enters(?: the battlefield)? tapped unless you control an? ((?:basic )?[A-Za-z]+)(?: or an? ([A-Za-z]+))?\.?$/i,
        make: (m) => ({ op: 'etbTappedUnlessType', types: [m[1], m[2]].filter(Boolean).map(x => x.toLowerCase()) }), auto: true },
      { re: /^(?:CARDNAME|This (?:land|permanent)) enters(?: the battlefield)? tapped unless you control two or more basic lands\.?$/i,
        make: () => ({ op: 'etbTappedUnlessLands', n: 1, atLeast: 2 }), auto: true },
      { re: /^(?:CARDNAME|This land) enters(?: the battlefield)? tapped unless (?:you control|there are) (\w+) or more other lands?\.?$/i,
        make: (m) => ({ op: 'etbTappedUnlessLands', n: 1, atLeast: num(m[1]) + 1 }), auto: true },
      { re: /^(?:CARDNAME|This land) enters(?: the battlefield)? tapped unless (?:a|any) player has (\d+) or less life\.?$/i,
        make: (m) => ({ op: 'etbTappedUnlessLife', life: +m[1] }), auto: true },
      { re: /^(?:CARDNAME|This land) enters(?: the battlefield)? tapped unless you have two or more opponents\.?$/i,
        make: () => ({ op: 'etbTappedUnlessOpponents', n: 2 }), auto: true },
      // the shockland question
      { re: /^As (?:CARDNAME|this land) enters(?: the battlefield)?,? you may pay (\d+) life\. If you don'?t, (?:it|CARDNAME|this land) enters(?: the battlefield)? tapped\.?$/i,
        make: (m) => ({ op: 'etbTappedUnlessPay', life: +m[1] }), auto: true },
      // the snarls: show the right basic type from your hand, or wait a turn
      { re: /^As (?:CARDNAME|this land) enters(?: the battlefield)?,? you may reveal an? ([A-Za-z]+)(?: or (?:an? )?([A-Za-z]+))? card from your hand\. If you don'?t, (?:it|CARDNAME|this land) enters(?: the battlefield)? tapped\.?$/i,
        make: (m) => ({ op: 'etbTappedUnlessReveal', types: [m[1], m[2]].filter(Boolean).map(x => x.toLowerCase()) }), auto: true },
      { re: /^As (?:CARDNAME|this (?:land|creature|artifact|enchantment|permanent|Aura|Equipment)) enters(?: the battlefield)?,? choose a creature type\.?$/i,
        eff: { op: 'chooseTypeOnEnter' }, auto: true },
      { re: /^As (?:CARDNAME|this (?:land|creature|artifact|enchantment|permanent|Aura|Equipment)) enters(?: the battlefield)?,? choose a colou?r\.?$/i,
        eff: { op: 'chooseColorOnEnter' }, auto: true },
      // the Gates: "As this land enters, choose a color other than blue."
      { re: /^As (?:CARDNAME|this (?:land|creature|artifact|enchantment|permanent)) enters(?: the battlefield)?,? choose a colou?r other than (white|blue|black|red|green)\.?$/i,
        make: (m) => ({ op: 'chooseColorOnEnter', except: { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' }[m[1].toLowerCase()] }), auto: true },
      /* Pithing Needle, Meddling Mage, Stuffy Doll, Talion: a name, a player
         or a number, chosen as it enters and kept on it */
      { re: /^As (?:CARDNAME|this (?:land|creature|artifact|enchantment|permanent)) enters(?: the battlefield)?,? (?:look at an opponent'?s hand, then )?choose (?:a|any) (nonland )?card name\.?$/i,
        make: (m) => ({ op: 'chooseOnEnter', what: 'name', nonland: !!m[1] }), auto: true },
      { re: /^As (?:CARDNAME|this (?:land|creature|artifact|enchantment|permanent)) enters(?: the battlefield)?,? choose (a player|an opponent)\.?$/i,
        make: (m) => ({ op: 'chooseOnEnter', what: /opponent/i.test(m[1]) ? 'opponent' : 'player' }), auto: true },
      { re: /^As (?:CARDNAME|this (?:land|creature|artifact|enchantment|permanent)) enters(?: the battlefield)?,? choose a number between (\d+) and (\d+)\.?$/i,
        make: (m) => ({ op: 'chooseOnEnter', what: 'number', min: +m[1], max: +m[2] }), auto: true },
      { re: /^Activated abilities of sources with the chosen name can'?t be activated( unless they'?re mana abilities)?\.?$/i,
        make: (m) => ({ op: 'nameLockAbilities', manaOk: !!m[1] }), auto: true },
      { re: /^Spells with the chosen name can'?t be cast\.?$/i, eff: { op: 'nameLockSpells' }, auto: true },
      // Iona: "Your opponents can't cast spells of the chosen color."
      { re: /^Your opponents can'?t cast spells of the chosen colou?r\.?$/i, eff: { op: 'colorLockSpells' }, auto: true },
      // Voice of All, Flickering Ward
      { re: /^(?:CARDNAME|This creature) has protection from the chosen colou?r\.?$/i, eff: { op: 'protChosenColor' }, auto: true },
      { re: /^Enchanted creature has protection from the chosen colou?r\.?$/i, eff: { op: 'protChosenColor', attached: true }, auto: true },
      /* The Sieges: "As this enchantment enters, choose Khans or Dragons.
         • Khans — … • Dragons — …" The permanent has only the abilities of
         the one chosen, so each is read as a card of its own. */
      { re: /^As (?:CARDNAME|this (?:enchantment|artifact|creature|permanent)) enters(?: the battlefield)?,? choose ([A-Z][a-z]+) or ([A-Z][a-z]+)\.\s*\n\s*\u2022\s*\1\s*\u2014\s*([\s\S]+?)\n\s*\u2022\s*\2\s*\u2014\s*([\s\S]+?)\s*$/,
        make: (m) => {
          const modes = [{ name: m[1], text: m[3].trim() }, { name: m[2], text: m[4].trim() }];
          for (const md of modes) {
            const probe = analyze({ id: 'modeprobe:' + U.hash(md.text), name: 'Mode', type_line: (ctx && ctx.typeLine) || 'Enchantment',
              oracle_text: md.text, keywords: [] });
            if (!probe || !probe.fullyAutomated) return null;
          }
          return { op: 'chooseModeOnEnter', modes };
        }, auto: true },
      { re: /^(?:CARDNAME|This creature) is the chosen type in addition to its other types\.?$/i,
        eff: { op: 'continuous', layer: 4, scope: { self: true }, addChosenType: true }, auto: true },
      { re: /^Whenever enchanted (land|Forest|Island|Swamp|Mountain|Plains) is tapped for mana, its controller adds an additional (\{[^}]+\}(?:\{[^}]+\})*|one mana of the chosen color|one mana of any type that land produced|one mana of any color)\.?$/i,
        make: (m) => Object.assign({ op: 'extraManaOnTap', scope: 'attached' },
          /chosen/i.test(m[2]) ? { chosen: true } : /any type/i.test(m[2]) ? { sameType: true } : /any color/i.test(m[2]) ? { anyColor: true } : { symbols: MANA.parse(m[2]) }), auto: true },
      { re: /^Whenever you tap an? (land|Forest|Island|Swamp|Mountain|Plains|basic land) for mana, add (?:an additional )?(\{[^}]+\}(?:\{[^}]+\})*|one (?:additional )?mana of any type that land produced)\.?$/i,
        make: (m) => Object.assign({ op: 'extraManaOnTap', who: 'you', filter: m[1].toLowerCase() },
          /any type/i.test(m[2]) ? { sameType: true } : { symbols: MANA.parse(m[2]) }), auto: true },
      { re: /^(?:CARDNAME|This land) enters(?: the battlefield)? tapped unless (.+?)\.?$/i,
        make: (m) => { const c = condOf(m[1]); return c ? { op: 'etbTappedUnlessCond', cond: c } : { op: 'manual' }; }, auto: true },
      { re: /^Equip (legendary creature|commander|Knight|Samurai|[A-Z][a-z]+) (\{[^}]+\}(?:\{[^}]+\})*)$/,
        make: (m) => ({ op: 'equip', cost: m[2], only: m[1] }), auto: true },
      /* The Theros gods: not a creature until your devotion is high enough.
         The engine asks as it looks at the god (CR 700.5). */
      { re: /^As long as your devotion to (white|blue|black|red|green)(?: and (white|blue|black|red|green))? is less than (\w+), (?:CARDNAME|this creature|it) isn'?t a creature\.?$/i,
        make: (m) => ({ op: 'notCreatureUnless', n: num(m[3]),
          colors: [m[1], m[2]].filter(Boolean).map(c => ({ white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' })[c.toLowerCase()]) }), auto: true },
      /* Cursed Mirror: a copy only until the end of the turn, with haste */
      { re: /^As (?:CARDNAME|this (?:artifact|creature|permanent)) enters, you may have it become a copy of any creature on the battlefield until end of turn(, except it has haste)?\.?$/i,
        make: (m) => Object.assign({ op: 'etbAsCopy', what: 'creature', eot: true }, m[1] ? { haste: true } : {}), auto: true },
      { re: /^Creatures you control can boast twice during each of your turns rather than once\.?$/i, eff: { op: 'boastTwice' }, auto: true },
      { re: /^You may cast spells from your hand without paying their mana costs\.?$/i, eff: { op: 'freeFromHand' }, auto: true },
      // Dracogenesis: "You may cast Dragon spells without paying their mana costs."
      { re: /^You may cast ([A-Z][a-z]+|creature|artifact|enchantment|instant|sorcery) spells without paying their mana costs\.?$/,
        make: (m) => ({ op: 'freeSpells', filter: m[1].toLowerCase() }), auto: true },
      { re: /^Your opponents can'?t cast spells from anywhere other than their hands\.?$/i, eff: { op: 'onlyFromHand' }, auto: true },
      { re: /^Spells your opponents cast that target (?:this creature|CARDNAME) cost an additional (\d+) life to cast\.?$/i,
        make: (m) => ({ op: 'targetLifeTax', life: +m[1] }), auto: true },
      /* Gravecrawler, Squee: the card casts itself from where it lies */
      { re: /^You may cast (?:this card|CARDNAME) from your graveyard( or from exile)?(?: as long as (.+?))?\.?$/i,
        make: (m) => {
          const cond = m[2] ? condOf(m[2]) : null;
          if (m[2] && !cond) return { op: 'manual' };
          return Object.assign({ op: 'castSelfFromGraveyard' }, m[1] ? { exile: true } : {}, cond ? { cond } : {});
        }, auto: true },
      /* Changeling Outcast */
      { re: /^(?:This creature|CARDNAME) can'?t block and can'?t be blocked\.?$/i,
        make: () => ({ op: 'sequence', list: [{ op: 'cantBlock' }, { op: 'continuous', layer: 6, scope: { self: true }, grant: ['Unblockable'] }] }), auto: true },
      /* Brotherhood Regalia */
      { re: /^Equipped creature has ward (\{[^}]+\}), is an? ([A-Z][a-z]+) in addition to its other types, and can'?t be blocked\.?$/,
        make: (m) => ({ op: 'sequence', list: [
          { op: 'continuous', layer: 6, scope: { attached: true }, grant: ['Ward ' + m[1], 'Unblockable'] },
          { op: 'continuous', layer: 4, scope: { attached: true }, addSubtypes: [m[2]] }] }), auto: true },
      { re: /^(?:This artifact|CARDNAME|This permanent) enters with (?:a|an|one|two|three|four|five|\d+) [a-z]+ counters? on it\.?$/i,
        eff: { op: 'noop' }, auto: true },
      /* Maskwood Nexus: every creature type, on the battlefield and off it */
      { re: /^Creatures you control are every creature type\. The same is true for creature spells you control and creature cards you own that aren'?t on the battlefield\.?$/i,
        make: () => ({ op: 'sequence', list: [
          { op: 'continuous', layer: 4, scope: { who: 'you', what: 'creature' }, grant: ['Changeling'] },
          { op: 'everyTypeElsewhere' }] }), auto: true },
      { re: /^Skip your draw step\.?$/i, eff: { op: 'skipStep', step: 'draw', who: 'you' }, auto: true },
      { re: /^Skip your (?:untap|combat|draw) step\.?$/i,
        make: (m) => ({ op: 'skipStep', step: (m[0].match(/untap|combat|draw/i) || [])[0].toLowerCase(), who: 'you' }), auto: true },
      { re: /^Activated abilities of ([a-z]+s)(?: your opponents control| you control)? can'?t be activated\.?$/i,
        make: (m) => ({ op: 'continuous', layer: 6, flag: 'cantActivate',
          scope: Object.assign({ what: m[1].replace(/s$/, '') },
            /your opponents control/i.test(m[0]) ? { who: 'opponents' } : (/you control/i.test(m[0]) ? { who: 'you' } : { who: 'all' })) }), auto: true },
      { re: /^(?:CARDNAME|This creature|This token) can't block\.?$/i, eff: { op: 'cantBlock' }, auto: true },
      { re: /^CARDNAME can't attack\.?$/i, eff: { op: 'cantAttack' }, auto: true },
      /* Shalai: "You, planeswalkers you control, and other creatures you control have hexproof." */
      { re: /^You, planeswalkers you control, and other creatures you control have hexproof\.?$/i,
        make: () => ({ op: 'sequence', list: [{ op: 'playerHexproof' },
          { op: 'continuous', layer: 6, scope: { who: 'you', what: 'planeswalker' }, grant: ['Hexproof'] },
          { op: 'continuous', layer: 6, scope: { who: 'you', what: 'creature', other: true }, grant: ['Hexproof'] }] }), auto: true },
      // Propaganda's words, as the newer cards print them
      { re: /^Creatures can'?t attack you unless their controller pays \{2\} for each (?:creature they control that'?s attacking you|of those creatures)\.?$/i,
        eff: { op: 'attackTax', amount: '{2}' }, auto: true },
      /* Training Grounds, Suppression Field, Power Artifact: what activated
         abilities cost, a few mana either way. "Can't reduce the mana in that
         cost to less than one mana" keeps one. */
      { re: /^(?:Each )?activated abilities of ([a-z ]+?) cost \{(\d+)\} (less|more) to activate( unless they'?re mana abilities)?\.(?: This effect can'?t reduce the mana in that cost to less than one mana\.)?$/i,
        make: (m) => {
          if (/graveyard|chosen name/i.test(m[1])) return null;
          const scope = /^enchanted (creature|artifact|permanent)$/i.test(m[1]) ? { attached: true, what: m[1].split(' ')[1].toLowerCase() } : scopeOf(m[1]);
          if (!scope) return null;
          return { op: 'abilityCostMod', scope, amount: (+m[2]) * (/less/i.test(m[3]) ? -1 : 1), nonMana: !!m[4], minOne: /less than one mana/i.test(m[0]) };
        }, auto: true },
      { re: /^Enchanted (artifact|creature|permanent)'s activated abilities cost \{(\d+)\} (less|more) to activate\.(?: This effect can'?t reduce the mana in that cost to less than one mana\.)?$/i,
        make: (m) => ({ op: 'abilityCostMod', scope: { attached: true, what: m[1].toLowerCase() }, amount: (+m[2]) * (/less/i.test(m[3]) ? -1 : 1),
          minOne: /less than one mana/i.test(m[0]) }), auto: true },
      { re: /^Activated abilities cost \{(\d+)\} more to activate unless they'?re mana abilities\.?$/i,
        make: (m) => ({ op: 'abilityCostMod', scope: { who: 'all', what: 'permanent' }, amount: +m[1], nonMana: true }), auto: true },
      // Zirda: "Abilities you activate that aren't mana abilities cost {2} less to activate."
      { re: /^Abilities you activate that aren'?t mana abilities cost \{(\d+)\} less to activate\.(?: This effect can'?t reduce the mana in that cost to less than one mana\.)?$/i,
        make: (m) => ({ op: 'abilityCostMod', who: 'you', amount: -(+m[1]), nonMana: true, minOne: /less than one mana/i.test(m[0]) }), auto: true },
      // Fighter Class, Arms Scavenger: "Equip abilities you activate cost {1} less to activate."
      { re: /^Equip abilities you activate cost \{(\d+)\} less to activate\.?$/i,
        make: (m) => ({ op: 'abilityCostMod', who: 'you', equip: true, amount: -(+m[1]) }), auto: true },
      // Eidolon of Obstruction: "Loyalty abilities of planeswalkers your opponents control cost {1} more to activate."
      { re: /^Loyalty abilities of planeswalkers your opponents control cost \{(\d+)\} more to activate\.?$/i,
        make: (m) => ({ op: 'abilityCostMod', scope: { who: 'opponents', what: 'planeswalker' }, loyalty: true, amount: +m[1] }), auto: true },
      /* Blazing Archon, Reverence, Spectral Grasp: "Creatures with power 2 or
         less can't attack you", "…or planeswalkers you control" */
      { re: /^(.+?) can'?t attack you( or planeswalkers you control)?\.?$/i,
        make: (m) => {
          if (/^(?:CARDNAME|this creature|it|they)$/i.test(m[1])) return null;
          const scope = scopeOf(m[1]);
          return scope ? { op: 'cantAttackYou', scope, walkers: !!m[2] } : null;
        }, auto: true },
      // the Vows: "Enchanted creature gets +2/+2, has vigilance, and can't attack you or planeswalkers you control."
      { re: /^(Enchanted creature|Equipped creature) gets ([+-]\d+)\/([+-]\d+), has ([a-z ]+?), (?:and )?can'?t attack you or planeswalkers you control(, and can'?t be sacrificed)?\.?$/i,
        make: (m) => {
          const kws = keywordList(m[4]);
          if (!kws.every(k => kwKnown(k)) || m[5]) return null;
          const scope = scopeOf(m[1]);
          return scope ? { op: 'sequence', list: [{ op: 'continuous', layer: 7, scope, pt: { p: pmNum(m[2]), t: pmNum(m[3]) }, grant: kws },
            { op: 'cantAttackYou', scope: Object.assign({}, scope), walkers: true }] } : null;
        }, auto: true },
      // Ghostly Prison, Baird: any generic amount, and planeswalkers as well
      { re: /^Creatures can'?t attack you( or planeswalkers you control)? unless their controller pays \{(\d+)\} for each (?:creature they control that'?s attacking you|of those creatures)\.?$/i,
        make: (m) => ({ op: 'attackTax', amount: '{' + m[2] + '}', walkers: !!m[1] }), auto: true },
      // Elephant Grass: "Nonblack creatures can't attack you unless…" — only those
      { re: /^((?:[A-Za-z]+ )?creatures(?: with [a-z0-9 ]+)?) can'?t attack you( or planeswalkers you control)? unless their controller pays \{(\d+)\} for each (?:creature they control that'?s attacking you|of those creatures)\.?$/i,
        make: (m) => { const scope = scopeOf(m[1]); return scope ? { op: 'attackTax', amount: '{' + m[3] + '}', walkers: !!m[2], scope } : null; }, auto: true },
      /* "This creature can't attack or block unless you control another
         artifact": a condition the engine checks as attackers and
         blockers are chosen */
      { re: /^(?:CARDNAME|This creature) can'?t (attack|block|attack or block) unless (.+?)\.?$/i,
        make: (m) => {
          if (/^defending playerb/i.test(m[2])) return null;      // the old landwalk-like rule below reads those
          const cond = condOf(m[2]);
          return cond ? { op: 'restrictUnless', attack: /attack/i.test(m[1]), block: /block/i.test(m[1]), cond } : null;
        },
        auto: true },
      // a lure: "All creatures able to block this creature do so."
      { re: /^All creatures able to block (?:CARDNAME|this creature) do so\.?$/i, eff: { op: 'lure' }, auto: true },
      /* "Enchanted creature gets +2/+0 and can't block." */
      { re: /^Enchanted creature gets ([+-]\d+)\/([+-]\d+) and (can'?t block|attacks each combat if able|can'?t be blocked)\.?$/i,
        make: (m) => ({ op: 'sequence', list: [
          { op: 'continuous', layer: 7, scope: { attached: true }, pt: { p: pmNum(m[1]), t: pmNum(m[2]) } },
          /can'?t block/i.test(m[3]) ? { op: 'continuous', layer: 6, scope: { attached: true }, flag: 'cantBlock' }
            : /attacks/i.test(m[3]) ? { op: 'continuous', layer: 6, scope: { attached: true }, flag: 'mustAttackEot' }
            : { op: 'continuous', layer: 6, scope: { attached: true }, grant: ['Unblockable'] }] }), auto: true },
      { re: /^All creatures able to block enchanted creature do so\.?$/i,
        eff: { op: 'continuous', layer: 6, scope: { attached: true }, flag: 'lure' }, auto: true },
      /* Prepared (the prepare cards): while it is, its controller may cast
         a copy of the card's spell, which unprepares it */
      { re: /^(?:CARDNAME|This creature) enters prepared\.?$/i, eff: { op: 'etbPrepared' }, auto: true },
      /* "This creature can't be blocked by white creatures", "... by artifact creatures" */
      { re: /^(?:CARDNAME|This creature) can'?t be blocked by ((?:white|blue|black|red|green|artifact|legendary|nonartifact|colorless|multicolored|nonblack|nonwhite)(?: or (?:white|blue|black|red|green))?) creatures\.?$/i,
        make: (m) => {
          const w = m[1].toLowerCase();
          // a card type is the creature's as well ("artifact creatures"), not an alternative to it
          const spec = w === 'artifact' ? { type: 'creature', zone: 'battlefield', cardTypes: ['artifact'] }
            : w === 'nonartifact' ? { type: 'creature', zone: 'battlefield', notType: ['artifact'] }
            : w === 'legendary' ? { type: 'creature', zone: 'battlefield', legendary: true }
            : targetSpec('target ' + w + ' creature');
          if (spec.unknown || spec.anyOf) return null;
          delete spec.filter;
          return { op: 'evasion', notBy: spec };
        }, auto: true },
      /* Control Magic: "You control enchanted creature." (layer 2) */
      { re: /^You control enchanted (creature|permanent|artifact|land|enchantment|planeswalker)\.?$/i,
        make: () => ({ op: 'continuous', layer: 2, scope: { attached: true }, control: 'you' }), auto: true },
      /* "This creature can't attack or block alone." */
      { re: /^(?:CARDNAME|This creature) can'?t (attack|block|attack or block) alone\.?$/i,
        make: (m) => (m[1] === 'attack' ? { op: 'cantAttackAlone' } : m[1] === 'block' ? { op: 'cantBlockAlone' }
          : { op: 'sequence', list: [{ op: 'cantAttackAlone' }, { op: 'cantBlockAlone' }] }), auto: true },
      { re: /^CARDNAME attacks each (?:combat|turn) if able\.?$/i, eff: { op: 'mustAttack' }, auto: true },
      { re: /^CARDNAME blocks each (?:combat|turn) if able\.?$/i, eff: { op: 'mustBlock' }, auto: true },
      /* The counters are already put on by the enters-with replacement the
         card-level scan found; this rule is here so the sentence that says
         so counts as read rather than as a line nobody could parse. */
      { re: /^(?:CARDNAME|This creature|This artifact) enters(?: the battlefield)? with an? [+\-0-9/a-z]+ counter on it for each ([^.]+?)\.?$/i,
        make: (m) => (!/mana spent/i.test(m[1]) && plainCount(countOf(m[1])) ? { op: 'noop' } : null), auto: true },
      { re: /^(?:CARDNAME|This (?:creature|permanent|land|artifact|enchantment|Vehicle)|It) enters(?: the battlefield)? with (?:a|an|one|two|three|four|five|X|\d+) [+\-0-9/a-z' ]+ counters? on (?:it|him|her|them)\.?$/i,
        eff: { op: 'noop' }, auto: true },
      // with a condition the card-level scan could read
      { re: /^(?:CARDNAME|This creature) enters(?: the battlefield)? with (?:a|an|one|two|three|four|\d+) [+\-0-9/a-z]+ counters? on it if ([^.]+)\.?$/i,
        make: (m) => (condOf(m[1]) ? { op: 'noop' } : null), auto: true },
      { re: /^If ([^,.]+), (?:CARDNAME|this creature) enters(?: the battlefield)? with (?:a|an|one|two|three|four|\d+) [+\-0-9/a-z]+ counters? on it\.?$/i,
        make: (m) => (condOf(m[1]) ? { op: 'noop' } : null), auto: true },
      // the vivid lands: tapped, and with counters the card-level scan found
      { re: /^(?:CARDNAME|This (?:land|artifact|permanent)) enters(?: the battlefield)? tapped with (?:a|an|one|two|three|four|five|\d+) [a-z]+ counters? on it\.?$/i,
        eff: { op: 'etbTapped' }, auto: true },
      // Converge
      { re: /^(?:CARDNAME|This (?:creature|artifact|permanent|enchantment)) enters(?: the battlefield)? with (?:an?|two|three) [+\-0-9/a-z]+ counters? on it for each (?:colou?r of )?mana spent to cast it\.?$/i,
        eff: { op: 'noop' }, auto: true },
      { re: /^(?:CARDNAME|This (?:creature|artifact|permanent)) enters(?: the battlefield)? with a number of [+\-0-9/a-z]+ counters on it equal to the amount of mana spent to cast it\.?$/i,
        eff: { op: 'noop' }, auto: true },
      { re: /^(?:CARDNAME|This (?:artifact|creature|permanent)) enters(?: the battlefield)? with an? [+\-0-9/a-z]+ counter on it for each time it was kicked\.?$/i,
        eff: { op: 'noop' }, auto: true },
      { re: /^If (?:CARDNAME|this creature|this spell|it) was kicked, (?:it|CARDNAME) enters(?: the battlefield)? with (?:a|an|one|two|three|four|X|\d+) [+\-0-9/a-z' ]+ counters? on it and with (?:flying|trample|haste|first strike|fear|vigilance|deathtouch|lifelink|menace|reach)\.?$/i,
        eff: { op: 'noop' }, auto: true },
      { re: /^If (?:CARDNAME|this creature|this spell|it) was kicked, (?:it|CARDNAME) enters(?: the battlefield)? with (?:a|an|one|two|three|four|five|X|\d+) [+\-0-9/a-z' ]+ counters? on (?:it|them)\.?$/i,
        eff: { op: 'noop' }, auto: true },
      { re: /^(?:CARDNAME|This creature|It) enters(?: the battlefield)? with X [+\-0-9/a-z' ]+ counters? on (?:it|them),? where X is the number of [-a-z' ]+ you control\.?$/i,
        eff: { op: 'noop' }, auto: true },
      { re: /^(?:CARDNAME|This creature) can'?t be blocked by creatures with power (\d+) or less\.?$/i,
        make: (m) => ({ op: 'evasion', minBlockerPower: +m[1] + 1 }), auto: true },
      { re: /^CARDNAME can'?t be blocked by more than one creature\.?$/i,
        make: () => ({ op: 'evasion', oneBlocker: true }), auto: true },
      { re: /^You may have (?:CARDNAME|this creature) assign its combat damage as though it weren'?t blocked\.?$/i,
        make: () => ({ op: 'continuous', layer: 6, scope: { self: true }, grant: ['Trample'] }), auto: true },
      { re: /^Creatures with power less than (?:CARDNAME'?s?|this creature'?s) power can'?t block it\.?$/i,
        make: () => ({ op: 'evasion', blockerAtLeastMyPower: true }), auto: true },
      { re: /^CARDNAME can'?t be blocked by creatures with power greater than (\d+)\.?$/i,
        make: (m) => ({ op: 'evasion', maxBlockerPower: +m[1] }), auto: true },
      { re: /^(?:CARDNAME|This creature) can block an additional (?:creature|(\w+) creatures) each combat\.?$/i,
        make: (m) => ({ op: 'blocksExtra', n: m[1] ? num(m[1]) : 1 }), auto: true },
      { re: /^(?:CARDNAME|This creature) can block any number of creatures\.?$/i,
        make: () => ({ op: 'blocksExtra', n: 99 }), auto: true },
      // Bouncing Beebles: "can't be blocked as long as defending player controls an artifact"
      // Glittering Lion: "Prevent all damage that would be dealt to this creature."
      { re: /^Prevent all damage that would be dealt to (?:CARDNAME|this creature)\.?$/i,
        make: () => ({ op: 'sequence', list: [
          { op: 'continuous', layer: 6, scope: { self: true, what: 'creature' }, flag: 'noDamageTaken' },
          { op: 'continuous', layer: 6, scope: { self: true, what: 'creature' }, flag: 'noNoncombatTaken' }] }), auto: true },
      // Iron Golem: "attacks or blocks each combat if able"
      { re: /^(?:CARDNAME|This creature) attacks or blocks each combat if able\.?$/i,
        make: () => ({ op: 'sequence', list: [{ op: 'mustAttack' }, { op: 'mustBlock' }] }), auto: true },
      // Doran and kin: combat damage by toughness
      { re: /^Each creature( you control)?( with toughness greater than its power)? assigns combat damage equal to its toughness rather than its power\.?$/i,
        make: (m) => ({ op: 'toughnessDamage', who: m[1] ? 'you' : 'all', ifTougher: !!m[2] }), auto: true },
      // Signal Pest: "can't be blocked except by creatures with flying or reach"
      { re: /^(?:CARDNAME|This creature) can'?t be blocked except by creatures with (flying|reach)(?: or (flying|reach))?\.?$/i,
        make: (m) => ({ op: 'evasion', onlyBy: [m[1].toLowerCase()].concat(m[2] ? [m[2].toLowerCase()] : []) }), auto: true },
      // Dream Prowler: "can't be blocked as long as it's attacking alone"
      { re: /^(?:CARDNAME|This creature) can'?t be blocked as long as it'?s attacking alone\.?$/i,
        eff: { op: 'evasion', attackingAlone: true }, auto: true },
      // Goblin Mutant: "can't block creatures with power 3 or greater"
      { re: /^(?:CARDNAME|This creature) can'?t block creatures with power (\d+) or greater\.?$/i,
        make: (m) => ({ op: 'blockPowerLimit', min: +m[1] }), auto: true },
      { re: /^(?:CARDNAME|This creature) can'?t be blocked as long as defending player controls an? ([A-Za-z][A-Za-z' -]*?)\.?$/i,
        make: (m) => ({ op: 'evasion', defenderControls: m[1].trim().toLowerCase() }), auto: true },
      { re: /^(?:CARDNAME|This creature) can'?t attack unless defending player controls an? ([A-Za-z][A-Za-z' -]*?)\.?$/i,
        make: (m) => ({ op: 'attackRequires', defenderControls: m[1].trim().toLowerCase() }), auto: true },
      { re: /^CARDNAME can'?t be countered\.?$/i, eff: { op: 'cantBeCountered' }, auto: true },
      // a permanent spell's window: "Cast this spell only if a creature died this turn" (Grim Wanderer)
      { re: /^Cast (?:CARDNAME|this spell) only (?!from )(.+?)\.?$/i,
        make: (m) => { const w = castWindowOf(m[1]); return w ? { op: 'noop', castWindow: w } : null; }, auto: true },
      /* The cost machinery reads this off the card itself; the sentence is
         here so it counts as read rather than as a line nobody could
         parse. */
      { re: /^[A-Za-z ,]*spells? you cast costs? \{\d+\} less to cast\.?$/i, eff: { op: 'noop' }, auto: true },
      { re: /^Exploit$/i, eff: { op: 'exploit' }, auto: true },
      { re: /^Ascend$/i, eff: { op: 'ascend' }, auto: true },
      { re: /^When you control no ([A-Za-z]+)s?, sacrifice (?:CARDNAME|this creature|this permanent)\.?$/i,
        make: (m) => ({ op: 'sacUnlessControl', what: m[1].toLowerCase() }), auto: true },
      { re: /^You have no maximum hand size\.?$/i, eff: { op: 'noMaxHandSize' }, auto: true },
      // Anvil of Bogardan: "Players have no maximum hand size."
      { re: /^Players have no maximum hand size\.?$/i, eff: { op: 'noMaxHandSize', all: true }, auto: true },
      // Sphere of Law: "If a red source would deal damage to you, prevent 2 of that damage."
      { re: /^If an? (white|blue|black|red|green) source would deal damage to you, prevent (\d+) of that damage\.?$/i,
        make: (m) => ({ op: 'preventSomeFromColor', color: { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' }[m[1].toLowerCase()], n: +m[2] }), auto: true },
      // Psychic Impetus: "Enchanted creature gets +2/+2 and is goaded."
      // Redemption Arc: "Enchanted creature has indestructible and is goaded."
      { re: /^(?:Enchanted|Equipped) creature has ([a-z ,]+?) and is goaded\.?$/i,
        make: (m) => { const kws = keywordList(m[1]); return kws.length && kws.every(kwKnown) ? { op: 'sequence', list: [{ op: 'goadAttached' },
          { op: 'continuous', layer: 6, scope: { attached: true, what: 'creature' }, grant: kws }] } : null; }, auto: true },
      { re: /^(?:Enchanted|Equipped) creature (?:gets ([+-]\d+)\/([+-]\d+) and )?is goaded\.?$/i,
        make: (m) => (m[1] ? { op: 'sequence', list: [{ op: 'goadAttached' }, { op: 'continuous', layer: 7, scope: { attached: true, what: 'creature' }, pt: { p: +m[1], t: +m[2] } }] } : { op: 'goadAttached' }), auto: true },
      { re: /^The "legend rule" doesn'?t apply to permanents you control\.?$/i, eff: { op: 'noLegendRule' }, auto: true },
      { re: /^The "legend rule" doesn'?t apply\.?$/i, eff: { op: 'noLegendRule', all: true }, auto: true },
      // Troll of Khazad-dûm, Pathrazer of Ulamog
      { re: /^(?:CARDNAME|This creature) can'?t be blocked except by (two|three|four|five) or more creatures\.?$/i,
        make: (m) => ({ op: 'minBlockers', n: num(m[1]) }), auto: true },
      // Silent Arbiter, Crawlspace, Caverns of Despair
      { re: /^No more than (one|two|three) creatures? can attack( you)? each combat\.?$/i,
        make: (m) => ({ op: 'attackLimit', n: num(m[1]), you: !!m[2] }), auto: true },
      { re: /^No more than (one|two|three) creatures? can block each combat\.?$/i,
        make: (m) => ({ op: 'blockLimit', n: num(m[1]) }), auto: true },
      // Glacial Chasm
      { re: /^Prevent all damage that would be dealt to you\.?$/i, eff: { op: 'preventAllToYou' }, auto: true },
      // Deafening Silence, Rule of Law, Eidolon of Rhetoric
      { re: /^Each player can'?t cast more than one (noncreature )?spell each turn\.?$/i,
        make: (m) => ({ op: 'spellLimit', n: 1, noncreature: !!m[1] }), auto: true },
      // Brave the Sands
      { re: /^Each creature you control can block an additional creature each combat\.?$/i, eff: { op: 'groupBlocksExtra' }, auto: true },
      // Platinum Angel
      { re: /^You can'?t lose the game and your opponents can'?t win the game\.?$/i, eff: { op: 'cantLose' }, auto: true },
      // Iroas, Losheel: "Prevent all (combat) damage that would be dealt to attacking (artifact) creatures you control."
      { re: /^Prevent all (combat )?damage that would be dealt to attacking (artifact )?creatures you control\.?$/i,
        make: (m) => {
          const scope = Object.assign({ who: 'you', what: 'creature', attacking: true }, m[2] ? { cardTypes: ['artifact'] } : {});
          const list = [{ op: 'continuous', layer: 6, scope, flag: 'noDamageTaken' }];
          if (!m[1]) list.push({ op: 'continuous', layer: 6, scope: Object.assign({}, scope), flag: 'noNoncombatTaken' });
          return list.length === 1 ? list[0] : { op: 'sequence', list };
        }, auto: true },
      // Dolmen Gate: "Prevent all combat damage that would be dealt to attacking creatures you control."
      { re: /^Prevent all combat damage that would be dealt to attacking creatures you control\.?$/i,
        eff: { op: 'continuous', layer: 6, scope: { who: 'you', what: 'creature', attacking: true }, flag: 'noDamageTaken' }, auto: true },
      // Arwen: "Each other creature you control enters with a number of additional +1/+1 counters on it equal to CARDNAME's toughness."
      { re: /^Each other creature you control enters with a number of additional \+1\/\+1 counters on it equal to (?:CARDNAME|this creature)'?s toughness\.?$/i,
        eff: { op: 'entersExtra', what: 'creature', other: true, counter: '+1/+1', bySourceToughness: true }, auto: true },
      /* Metallic Mimic, Giada, Renata, Oath of Gideon: "Each other creature
         you control (of the chosen type) enters with an additional +1/+1
         counter on it (for each Angel you already control)." */
      { re: /^(Each other|Each|Other) ((?:nontoken |non-[A-Z][a-z]+ )?(?:[A-Z][a-z]+ )?(?:creature|planeswalker|Vehicle|[A-Z][a-z]+)s?) you control( of the chosen type)? enters? with an additional (\+1\/\+1|loyalty) counter on (?:it|them)(?: for each ([A-Za-z]+) you already control)?\.?$/,
        make: (m) => {
          let what = m[2].replace(/s$/, '').trim();
          const nontoken = /^nontoken /.test(what);
          what = what.replace(/^nontoken /, '');
          if (/^non-/.test(what)) what = what.replace(/^non-([A-Z][a-z]+) /, 'non$1 ');
          return Object.assign({ op: 'entersExtra', what: what.toLowerCase(), other: /other/i.test(m[1]), counter: m[4].toLowerCase() },
            nontoken ? { nontoken: true } : {}, m[3] ? { chosenType: true } : {}, m[5] ? { per: m[5].replace(/s$/, '').toLowerCase() } : {});
        }, auto: true },
      // "This creature must be blocked if able."
      { re: /^(?:CARDNAME|This creature) must be blocked if able\.?$/i, eff: { op: 'mustBeBlocked' }, auto: true },
      // Champion of Lambholt: "Creatures with power less than this creature's power can't block creatures you control."
      { re: /^Creatures with power less than (?:this creature|CARDNAME)'?s power can'?t block creatures you control\.?$/i,
        eff: { op: 'smallCantBlock' }, auto: true },
      // Frenzied Baloth: "Combat damage can't be prevented."
      { re: /^Combat damage can'?t be prevented\.?$/i, eff: { op: 'noCombatPrevention' }, auto: true },
      // Woe Strider: "This creature escapes with two +1/+1 counters on it."
      { re: /^(?:CARDNAME|This creature) escapes with (a|an|one|two|three|four|five|\d+) ([+\-0-9/a-z]+) counters? on it\.?$/i,
        make: (m) => ({ op: 'escapesWith', n: num(m[1]), kind: m[2].toLowerCase() }), auto: true },
      // Jin-Gitaxias, Core Augur: "Each opponent's maximum hand size is reduced by seven."
      // Twenty-Toed Toad: "Your maximum hand size is twenty." — seven, raised to it
      { re: /^Your maximum hand size is (eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|twenty)\.?$/i,
        make: (m) => ({ op: 'handSizeMod', who: 'you', n: num(m[1]) - 7 }), auto: true },
      { re: /^(Each opponent'?s|Your) maximum hand size is (reduced|increased) by (one|two|three|four|five|six|seven|\d+)\.?$/i,
        make: (m) => ({ op: 'handSizeMod', who: /opponent/i.test(m[1]) ? 'opponents' : 'you', n: (/reduced/i.test(m[2]) ? -1 : 1) * num(m[3]) }), auto: true },
      { re: /^You may look at the top card of your library any time\.?$/i,
        eff: { op: 'peekTop' }, auto: true },
      { re: /^(?:CARDNAME|This land) enters tapped\. As it enters, choose a colou?r(?: other than (white|blue|black|red|green))?\.?$/i,
        make: (m) => ({ op: 'chooseColorOnEnter', except: m[1] ? { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' }[m[1].toLowerCase()] : null }), auto: true },
      /* Leyline of Anticipation, Vedalken Orrery, Sigarda's Aid */
      { re: /^You may cast (spells|((?:[A-Za-z]+ )+?)spells(?: and ((?:[A-Za-z]+ )+?)spells)?) as though they had flash\.?$/i,
        make: (m) => ({ op: 'flashGrant', filter: m[2] ? [m[2], m[3]].filter(Boolean).map(x => x.trim().toLowerCase().replace(/ and /g, ' or ')).join(' or ') : null }), auto: true },
      /* Seedborn Muse's smaller cousins */
      { re: /^Untap all (artifacts|creatures|permanents) you control during each other player'?s untap step\.?$/i,
        make: (m) => ({ op: 'untapOnEveryUntapStep', filter: m[1].toLowerCase().replace(/s$/, '') }), auto: true },
      { re: /^Untap (?:CARDNAME|this (?:artifact|creature|permanent|land)) during each other player'?s untap step\.?$/i,
        eff: { op: 'untapOnEveryUntapStep', selfOnly: true }, auto: true },
      /* Laboratory Maniac, Jace, Wielder of Mysteries */
      /* Thought Reflection, Teferi's Ageless Insight: each draw (but, for
         some, the first one in your draw step) is two */
      { re: /^If you would draw a card( except the first one you draw in each of your draw steps)?, draw two cards instead\.?$/i,
        make: (m) => ({ op: 'drawDouble', exceptFirst: !!m[1] }), auto: true },
      { re: /^If you would draw a card while your library has no cards in it, you win the game instead\.?$/i,
        eff: { op: 'winOnEmptyDraw' }, auto: true },
      /* Torpor Orb, Hushbringer, Elesh Norn: arrivals that set nothing off */
      { re: /^(Creatures|Permanents) entering(?: the battlefield)?( or dying)? don'?t cause abilities( of permanents your opponents control)? to trigger\.?$/i,
        make: (m) => ({ op: 'noEnterTriggers', what: /creature/i.test(m[1]) ? 'creature' : 'permanent',
          dying: !!m[2], opponentsOnly: !!m[3] }), auto: true },
      /* Panharmonicon and its kin: one cause, one more trigger */
      { re: /^If an? ((?:[a-z]+ or )?[a-z]+) entering(?: the battlefield)? causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time\.?$/i,
        make: (m) => ({ op: 'triggerDouble', cause: 'enter', what: m[1].toLowerCase() }), auto: true },
      { re: /^If an? ((?:[a-z]+ or )?[a-z]+) dying causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time\.?$/i,
        make: (m) => ({ op: 'triggerDouble', cause: 'die', what: m[1].toLowerCase() }), auto: true },
      { re: /^If a creature attacking causes a triggered ability of a permanent you control to trigger, that ability triggers an additional time\.?$/i,
        eff: { op: 'triggerDouble', cause: 'attack' }, auto: true },
      // Delney: "If a triggered ability of a creature you control with power 2 or less triggers, …"
      { re: /^If a triggered ability of a creature you control with power (\d+) or less triggers, that ability triggers an additional time\.?$/i,
        make: (m) => ({ op: 'triggerDouble', cause: 'source', what: 'creature', maxPower: +m[1] }), auto: true },
      // Delney: "Creatures you control with power 2 or less can't be blocked by creatures with power 3 or greater."
      { re: /^Creatures you control with power (\d+) or less can'?t be blocked by creatures with power (\d+) or greater\.?$/i,
        make: (m) => ({ op: 'groupEvasion', maxPower: +m[1], maxBlockerPower: +m[2] - 1 }), auto: true },
      { re: /^If a triggered ability of an? ((?:another )?[A-Za-z]+(?: (?:or (?:another )?)?[A-Za-z]+)*) you control triggers, that ability triggers an additional time\.?$/i,
        make: (m) => {
          const w = m[1].trim();
          if (/\bwith\b/i.test(w)) return null;
          return { op: 'triggerDouble', cause: 'source', what: w.replace(/\banother /gi, '').toLowerCase(), other: /another/i.test(w) };
        }, auto: true },
      /* Crucible of Worlds, Courser of Kruphix, Bolas's Citadel, Mystic
         Forge: standing leave to use a card from somewhere other than the
         hand. */
      { re: /^(During your turn, )?you may play lands from your graveyard\.?$/i,
        make: (m) => ({ op: 'playFrom', zone: 'graveyard', what: 'land', duringYourTurn: !!m[1] }), auto: true },
      { re: /^(During your turn, )?you may play lands from the top of your library\.?$/i,
        make: (m) => ({ op: 'playFrom', zone: 'top', what: 'land', duringYourTurn: !!m[1] }), auto: true },
      { re: /^(During your turn, )?you may play lands and cast spells from the top of your library\.?(?: If you cast a spell this way, pay life equal to its mana value rather than pay its mana cost\.?)?$/i,
        make: (m) => ({ op: 'playFrom', zone: 'top', what: 'any', duringYourTurn: !!m[1],
          payLife: /pay life equal/i.test(m[0]) }), auto: true },
      { re: /^(During your turn, )?you may cast ((?:[a-z]+ )*?)spells(?: and ((?:[a-z]+ )*?)spells)? from the top of your library\.?$/i,
        make: (m) => ({ op: 'playFrom', zone: 'top', what: 'spell', duringYourTurn: !!m[1],
          filter: [m[2], m[3]].filter(Boolean).map(x => x.trim()).join(' or ') || null }), auto: true },
      { re: /^You may choose not to untap (?:CARDNAME|this creature|this artifact|this land) during your untap step\.?$/i,
        eff: { op: 'optionalUntap' }, auto: true },
      { re: /^Cumulative upkeep\s*[-\u2014]?\s*(?:Pay\s+)?((?:\{[^}]+\})+)\.?$/i,
        make: (m) => (/^(?:\{E\})+$/i.test(m[1])
          ? { op: 'cumulativeUpkeep', energy: (m[1].match(/\{E\}/gi) || []).length }
          : { op: 'cumulativeUpkeep', cost: m[1] }), auto: true },
      { re: /^Cumulative upkeep\s*[-\u2014]?\s*Pay (\d+) life\.?$/i,
        make: (m) => ({ op: 'cumulativeUpkeep', life: +m[1] }), auto: true },
      { re: /^CARDNAME can't attack or block unless you pay/i, eff: { op: 'manual' }, auto: false },
      { re: /^Other creatures you control get \+(\d+)\/\+(\d+)\.?$/i,
        make: (m) => ({ op: 'anthem', p: +m[1], t: +m[2], scope: 'otherYourCreatures' }), auto: true },
      { re: /^Creatures you control get \+(\d+)\/\+(\d+)\.?$/i,
        make: (m) => ({ op: 'anthem', p: +m[1], t: +m[2], scope: 'yourCreatures' }), auto: true },
      { re: /^Equipped creature gets \+(\d+)\/\+(\d+)\.?$/i,
        make: (m) => ({ op: 'equipBonus', p: +m[1], t: +m[2] }), auto: true },
      { re: /^Enchanted creature gets \+(\d+)\/\+(\d+)\.?$/i,
        make: (m) => ({ op: 'auraBonus', p: +m[1], t: +m[2] }), auto: true },
      { re: /^Equip(?:\s*[-\u2014]\s*[^{]*)? (\{[^}]+\}(?:\{[^}]+\})*)$/i,
        make: (m) => ({ op: 'equip', cost: m[1] }), auto: true },
      // "Equip 2" is the same sentence with the braces left off
      { re: /^Equip (\d+)$/i, make: (m) => ({ op: 'equip', cost: '{' + m[1] + '}' }), auto: true },
      { re: /^Fortify (\{[^}]+\}(?:\{[^}]+\})*)$/i,
        make: (m) => ({ op: 'fortify', cost: m[1] }), auto: true },
      { re: /^Reconfigure (\{[^}]+\}(?:\{[^}]+\})*)$/i,
        make: (m) => ({ op: 'reconfigure', cost: m[1] }), auto: true },
      { re: /^Enchant (.+)$/i, make: (m) => ({ op: 'enchant', filter: m[1] }), auto: true },
      { re: /^Enchant (.+)$/i, make: (m) => ({ op: 'enchant', filter: m[1] }), auto: true },
    ];
    for (const r of rules) {
      const m = line.match(r.re);
      if (!m) continue;
      const eff = r.make ? r.make(m) : r.eff;
      // a rule that matched the words but could not read them: try the next one
      if (!eff) continue;
      /* "Equip {2}" is an activated ability with a target, not a footnote:
         pay the cost at sorcery speed and the Equipment moves. */
      if (eff.op === 'equip' || eff.op === 'fortify' || eff.op === 'reconfigure') {
        /* "Equip legendary creature {3}", "Equip commander {3}": the creature
           it may go on is narrower than usual */
        // Fortify: a land you control, not a creature
        const spec = eff.op === 'fortify' ? { type: 'land', controller: 'you', filter: 'land you control' } : { type: 'creature', controller: 'you' };
        // Reconfigure: another creature, never itself
        if (eff.op === 'reconfigure') spec.another = true;
        if (eff.only === 'legendary creature') spec.legendary = true;
        else if (eff.only === 'commander') spec.commander = true;
        else if (eff.only) spec.subtypes = [eff.only.toLowerCase()];
        return {
          kind: 'activated', text: line, auto: true, sorcerySpeed: true,
          cost: parseCost(eff.cost),
          targets: [spec],
          effects: [{ op: 'attachSelf', targets: [spec] }],
        };
      }
      return { kind: 'static', text: line, auto: !!r.auto && eff.op !== 'manual', effects: [eff] };
    }
    return null;
  }

  const ROMAN = { I: 1, II: 2, III: 3, IV: 4, V: 5, VI: 6 };
  function romanValue(r) { return ROMAN[String(r).trim().toUpperCase()] || 0; }

  function escapeRe(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /* ---------------- exported ---------------- */

  /* ---------------- describing an ability in short ----------------
     A card script carries structure, not prose: a generated ability knows it
     puts two +1/+1 counters on a creature but has no sentence saying so. The
     table still has to write something on a menu button, so this says what an
     ability does in as few words as it can. It is a label, never a rule. */

  const SYM = (s) => String(s || '');
  const plural = (n, w) => n + ' ' + w + (Math.abs(n) === 1 ? '' : 's');
  const signed = (n) => (n > 0 ? '+' : '') + n;

  const DESCRIBE = {
    addMana: (e) => 'Add ' + (e.symbols || []).map(x => '{' + x + '}').join(''),
    addManaAny: (e) => 'Add ' + (e.amount > 1 ? e.amount + ' mana of any one colour' : 'one mana of any colour'),
    addManaChoice: (e) => 'Add ' + (e.choices || []).map(c => '{' + c.join('') + '}').join(' or '),
    draw: (e) => 'Draw ' + plural(num(e.n) || 1, 'card'),
    damage: (e) => 'Deal ' + (e.amount != null ? e.amount : e.n || 1) + ' damage',
    damageDivided: (e) => 'Deal ' + (e.amount || 1) + ' damage divided',
    destroy: () => 'Destroy it',
    destroyAll: (e) => 'Destroy all ' + (e.what || 'permanents'),
    exile: () => 'Exile it',
    bounce: () => 'Return it to hand',
    tap: () => 'Tap it',
    untap: () => 'Untap it',
    tapAll: () => 'Tap them',
    untapAll: () => 'Untap them',
    gainLife: (e) => 'Gain ' + (num(e.n) || 0) + ' life',
    loseLife: (e) => 'Lose ' + (num(e.n) || 0) + ' life',
    drain: (e) => 'Drain ' + (num(e.n) || 0),
    scry: (e) => 'Scry ' + (num(e.n) || 1),
    surveil: (e) => 'Surveil ' + (num(e.n) || 1),
    mill: (e) => 'Mill ' + plural(num(e.n) || 1, 'card'),
    discard: (e) => 'Discard ' + plural(num(e.n) || 1, 'card'),
    counters: (e) => 'Put ' + plural(num(e.n) || 1, (e.kind || '+1/+1') + ' counter'),
    etbCounters: (e) => 'Enters with ' + plural(num(e.n) || 1, (e.kind || '+1/+1') + ' counter'),
    pump: (e, o) => signed(num(e.p) || 0) + '/' + signed(num(e.t) || 0) +
      ((o && o.standing) || e.duration === 'permanent' ? '' : ' until end of turn'),
    grantKeyword: (e) => 'Gains ' + (e.keywords || [e.keyword]).filter(Boolean).join(', '),
    createToken: (e) => 'Create ' + (num(e.n) || 1) + ' ' + (e.pt ? e.pt + ' ' : '') +
      (e.subtypes || 'token'),
    createNamedToken: (e) => 'Create ' + (num(e.n) || 1) + ' ' + (e.name || 'token'),
    token: (e) => 'Create a token',
    regenerate: () => 'Regenerate it',
    fight: () => 'Fight',
    counterSpell: () => 'Counter it',
    gainControl: () => 'Gain control of it',
    tutor: (e) => 'Search for ' + (e.filter && e.filter !== 'any' ? 'a ' + e.filter : 'a card'),
    reanimate: () => 'Return it to the battlefield',
    regrowth: () => 'Return it to your hand',
    sacrificeSelf: () => 'Sacrifice it',
    etbTapped: () => 'Enters tapped',
    proliferate: () => 'Proliferate',
    shuffle: () => 'Shuffle',
    blink: () => 'Exile it, then return it',
    attachSelf: () => 'Attach',
    may: (e, o) => describeEffects(e.then, o),
    modal: (e) => 'Choose ' + (e.count || 1),
    continuous: (e) => (e.grant && e.grant.length) ? 'Grants ' + e.grant.join(', ') : 'Static bonus',
  };

  /** A few words for a list of effects. */
  function describeEffects(effects, opts) {
    const bits = [];
    for (const e of (effects || [])) {
      if (!e || !e.op) continue;
      const f = DESCRIBE[e.op];
      const t = f ? f(e, opts) : null;
      if (t) bits.push(t);
      if (bits.length >= 3) break;
    }
    return bits.join(', ');
  }

  /**
   * Rules text as a player reads it: the "CARDNAME" the reading puts in for
   * a card's own name made the name of the object it is on now (a copy's
   * name, a face's), or the card's.
   */
  function named(text, who) {
    if (text == null || !/CARDNAME/.test(text)) return text;
    const nm = typeof who === 'string' ? who : who && (who.name || (who.card && who.card.name));
    return String(text).replace(/CARDNAME/g, nm || 'this');
  }

  /** What to write on the button for an ability; given the object, with its name in it. */
  function abilityLabel(ab, who) {
    const t = abilityLabelRaw(ab);
    return who === undefined ? t : named(t, who);
  }
  function abilityLabelRaw(ab) {
    if (!ab) return '';
    if (ab.text) return ab.text;
    const parts = [];
    const c = ab.cost || {};
    if (ab.kind === 'loyalty') parts.push(signed(c.loyalty || 0));
    else {
      if (c.mana) parts.push(SYM(c.mana));
      if (c.tap) parts.push('{T}');
      if (c.untap) parts.push('{Q}');
      if (c.sacSelf) parts.push('Sacrifice this');
      if (c.sacrifice) parts.push('Sacrifice a ' + (c.sacrifice.filter || 'permanent'));
      if (c.discard) parts.push('Discard ' + plural(c.discard.n === 'all' ? 1 : (c.discard.n || 1), 'card'));
      if (c.life) parts.push('Pay ' + c.life + ' life');
    }
    const body = describeEffects(ab.effects, { standing: ab.kind === 'static' }) || 'Ability';
    return parts.length ? parts.join(', ') + ': ' + body : body;
  }

  /* A face-down permanent is a 2/2 creature with no name, no types beyond
     Creature, and no text (CR 708.2). Rather than teach forty call sites
     about it, it is described here as an ordinary analysis, so everything
     downstream — combat, damage, the bots — sees a creature. */
  const FACE_DOWN_CARD = {
    id: '__facedown__', oracle_id: '__facedown__', name: 'Face-down card',
    type_line: 'Creature', oracle_text: '', mana_cost: '', cmc: 0,
    colors: [], color_identity: [], keywords: [], legalities: {},
    rarity: 'common', layout: 'normal', power: '2', toughness: '2',
  };
  function faceDownAnalysis() { return analyze(FACE_DOWN_CARD); }

  MTG.oracle = {
    analyze, normalizePunct, faceDownAnalysis,
    abilityLabel, named, describeEffects, condOf,
    parseTypeLine, scopeOf,
    parseCost,
    parseEffects,
    parseEffectSentence,
    stripReminder,
    splitSentences,
    targetSpec,
    matchesSpec,
    num,
    IMPLEMENTED_KEYWORDS,
    clearCache: () => cache.clear(),
    /** Rough "how automated is this deck" figure for the UI. */
    deckCoverage(cards) {
      if (!cards.length) return 0;
      let t = 0;
      for (const c of cards) { const a = analyze(c); t += a ? a.autoCoverage : 0; }
      return t / cards.length;
    },
  };
})(window.MTG);


