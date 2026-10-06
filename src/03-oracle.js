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
    'Afflict', 'Annihilator', 'Undying', 'Persist', 'Modular', 'Riot', 'Extort',
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
  ]);
  const IMPLEMENTED_LOWER = new Set(Array.from(IMPLEMENTED_KEYWORDS).map(k => k.toLowerCase()));
  /* A keyword the engine can honour when it is handed out: one of the
     above, or ward with its price ("ward {2}", "ward—pay 2 life"). */
  function kwKnown(k) {
    const w = String(k || '').trim();
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
    'Replicate', 'Splice', 'Conspire']);

  const CAST_KEYWORDS = new Set(['Flash', 'Split second', 'Convoke', 'Improvise', 'Delve', 'Affinity',
    'Kicker', 'Multikicker', 'Entwine', 'Escalate', 'Overload', 'Buyback', 'Flashback',
    'Aftermath', 'Jump-start', 'Retrace', 'Madness', 'Miracle', 'Foretell', 'Disturb',
    'Evoke', 'Prowl', 'Surge', 'Spectacle', 'Awaken', 'Bestow', 'Emerge', 'Casualty',
    'Cleave', 'Blitz', 'Dash', 'Embalm', 'Eternalize', 'Unearth', 'Adventure', 'Suspend',
    'Cycling', 'Transmute', 'Morph', 'Megamorph', 'Disguise', 'Prototype', 'Impending',
    'Offering', 'Splice', 'Spree', 'Gift', 'Plot', 'Freerunning', 'Warp',
    'Retrace', 'Offspring', 'Squad', 'Encore', 'Mutate', 'Escape', 'Mayhem', 'Harmonize', 'Bargain', 'Ninjutsu',
    'Replicate', 'Conspire']);

  /* Keyword names are title-cased before they are looked up, which turns
     "Split second" into "Split Second". Compare in lower case so a keyword
     of more than one word is not quietly lost. */
  const CAST_LOWER = new Set(Array.from(CAST_KEYWORDS).map(k => k.toLowerCase()));
  const RUN_CAST_LOWER = new Set(Array.from(RUN_CAST_KEYWORDS).map(k => k.toLowerCase()));

  const KEYWORD_PATTERNS = [
    // simple flags, matched as whole comma-separated clauses
    /^(Increment|Flying|First strike|Double strike|Deathtouch|Lifelink|Menace|Reach|Trample|Vigilance|Haste|Defender|Indestructible|Hexproof|Shroud|Flash|Fear|Intimidate|Skulk|Horsemanship|Shadow|Changeling|Devoid|Exalted|Battle cry|Melee|Myriad|Undying|Persist|Infect|Wither|Ingest|Prowess|Extort|Cascade|Storm|Conspire|Delirium|Landfall|Riot|Afterlife|Mentor|Afflict|Amass|Boast|Daybound|Nightbound|Decayed|Disturb|Training|Compleated|Toxic|Backup|Bargain|Craft|Delve|Convoke|Improvise|Annihilator|Banding|Soulbond|Soulshift|Rampage|Provoke|Renown|Rebound|Recover|Replicate|Ripple|Scavenge|Soulbond|Sunburst|Totem armor|Vanishing|Fading|Graft|Modular|Sunburst|Echo|Haunt|Hideaway|Absorb|Bushido|Flanking|Bloodthirst|Champion|Devour|Evolve|Extort|Fabricate|Ferocious|Formidable|Frenzy|Gravestorm|Kinship|Living weapon|Poisonous|Reinforce|Tribute|Unleash|Vigilance|Wither|Enrage|Mutate|Companion|Encore|Demonstrate|Squad|Read ahead|Ravenous|Prototype|Toxic|Corrupted|For Mirrodin!|Bargain|Valiant|Saddle|Station|Mobilize|Job select|Max speed|Start your engines!|Exhaust|Harmonize|Eerie|Manifest dread|Survival|Threshold|Hellbent|Metalcraft|Morbid|Revolt|Spell mastery|Fateful hour|Will of the council|Council's dilemma|Melee|Partner|Friends forever|Choose a Background|Doctor's companion|Eternalize|Embalm|Foretell|Boast|Cleave|Casualty|Blitz|Connive|Enlist|Hideaway|Alliance|Celebration|Descend|Fathomless descent|Corrupted|Coven|Blood|Investigate|Clue|Food|Treasure|Incubate|Map|Junk|Offspring|Impending|Manifest|Flurry|Living metal|Umbra armor|Retrace|Jump-start|Split second|Spaceflight|Phasing|Cipher|Spree)$/i,
    // parameterised keywords with a number
    /^(Annihilator|Bushido|Modular|Rampage|Vanishing|Fading|Graft|Soulshift|Poisonous|Devour|Ripple|Bloodthirst|Amass|Afflict|Toxic|Squad|Casualty|Backup|Reinforce|Renown|Tribute|Frenzy|Absorb|Crew|Ward|Shield|Flanking|Dredge|Suspend|Storm|Cascade|Exhaust|Saddle|Station|Fabricate|Afterlife|Mobilize|Firebending|Repair|Teamwork|Hideaway)\s+\d+$/i,
    // parameterised keywords with a cost
    /^(Kicker|Multikicker|Echo|Cycling|Flashback|Buyback|Madness|Morph|Megamorph|Disguise|Unearth|Embalm|Eternalize|Evoke|Bestow|Dash|Blitz|Emerge|Entwine|Escape|Foretell|Miracle|Overload|Prowl|Recover|Replicate|Retrace|Scavenge|Spectacle|Surge|Transmute|Splice|Awaken|Aftermath|Jump-start|Level up|Outlast|Monstrosity|Adapt|Channel|Transfigure|Ninjutsu|Prototype|Freerunning|Warp|Impending|Plot|Disturb|Cleave|Bargain|Craft|Forecast|Offering|Provoke|Offspring|Encore|Squad|Meditate|Mutate|Mayhem|Harmonize)(?:\s+|\s*\u2014\s*)\S.*$/i,
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
    const lab = String(str).match(/^(Boast|Exhaust|Renew)\s*(?:\u2014|--|-)\s*(.+)$/i);
    if (lab) { cost.label = lab[1].toLowerCase(); str = lab[2]; }
    const parts = str.split(/,\s*(?![^{]*\})/);
    for (let p of parts) {
      p = p.trim();
      if (!p) continue;
      p = p.replace(/^Pay\s+(?=\{)/i, '');       // "Pay {2}" is just {2}
      if (/^(\{[^}]+\})+$/.test(p)) {
        const syms = MANA.parse(p);
        const manaSyms = syms.filter(s => s !== 'T' && s !== 'Q' && s !== 'E');
        if (syms.includes('T')) cost.tap = true;
        if (syms.includes('Q')) cost.untap = true;
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
      if ((m = p.match(/^Discard (a|an|your hand|\d+|X) ?(.*)$/i))) { cost.discard = { n: /^\d+$/.test(m[1]) ? +m[1] : (/hand/i.test(m[1]) ? 'all' : 1), filter: m[2] || 'card' }; continue; }
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
      // "Exert this land": it does not untap during your next untap step
      if (/^Exert (?:this|CARDNAME|this (?:land|creature|artifact|permanent))$/i.test(p)) { cost.exert = true; continue; }
      if ((m = p.match(/^Remove (a|an|one|two|three|four|five|\d+|X) (.+?) counters? from/i))) {
        cost.removeCounters = { n: WORDN(m[1]), kind: m[2] }; continue;
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
  const TGT_WITH = "(?: (?:with|without) [a-z0-9'+/ ]{2,40})?";
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
      else if (/^(?:artifact|enchantment)$/i.test(w)) e.addTypes.push(U.titleCase(w));
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
    } else if ((m = s.match(/^ with ([a-z ,']+?) and "([^"]+)"/))) {
      const k = kwText(m[1]);
      if (!k) return null;
      e.keywords = k; e.grantedText = m[2]; s = s.slice(m[0].length);
    } else if ((m = s.match(/^ with ([a-z ,']+?)(?=$|,| that| for each )/))) {
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
    return !!(probe && probe.fullyAutomated && probe.abilities.length &&
      probe.abilities.every(ab => ab.kind === 'triggered'));
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
    { re: /^Target creature connives(?: (one|two|three|\d+))?\.?$/i,
      make: (m) => ({ op: 'connive', n: m[1] ? num(m[1]) : 1, targets: [{ type: 'creature' }] }) },

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
    { re: /^(?:[A-Za-z][-A-Za-z0-9',\u2019\. ]{0,44}?\s)?deals? (one|two|three|four|five|six|seven|eight|nine|ten|\d+|X) damage to each (creature your opponents control|creature you control|creature|opponent|player|creature and each planeswalker|creature and each player|creature, planeswalker, and player)\.?$/i,
      make: (m) => ({ op: 'damage', n: num(m[1]), each: m[2].toLowerCase() }) },

    // --- counters ---
    { re: /^Put (a|one|two|three|\d+|X) \+1\/\+1 counters? on (?:up to one )?((?:another )?target creature|(?:another )?target creature you control|it|this creature|CARDNAME|each creature you control)\.?$/i,
      make: (m) => ({ op: 'counters', kind: '+1/+1', n: num(m[1]), targets: /target/.test(m[2]) ? [targetSpec(m[2])] : null, scope: /each/.test(m[2]) ? 'yourCreatures' : (/it|this/.test(m[2]) ? 'self' : null) }) },
    { re: /^Put (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) (-1\/-1|\+1\/\+1|[a-z ]+) counters? on ((?:another )?target [a-z ]+|it|this creature|this (?:enchantment|artifact|permanent|land|Vehicle)|CARDNAME)\.?$/i,
      make: (m) => ({ op: 'counters', kind: m[2], n: num(m[1]), targets: /target/.test(m[3]) ? [targetSpec(m[3])] : null, scope: /it|this/.test(m[3]) ? 'self' : null }) },

    // --- removal / zone changes ---
    /* ===== exile that comes back when the jailer leaves ===== */
    { re: /^Exile (target [a-z0-9 '-]+?|another target [a-z0-9 '-]+?) until (?:CARDNAME|this (?:creature|enchantment|artifact|permanent|Aura)) leaves the battlefield\.?$/i,
      make: (m) => ({ op: 'exileUntilLeaves', targets: [targetSpec(m[1].replace(/^another /i, ''))] }) },
    { re: /^Return the exiled cards? to the battlefield under (?:its owner'?s|their owners'?|your) control\.?$/i,
      make: () => ({ op: 'returnExiled' }) },
    { re: /^Return (?:that card|the exiled card) to the battlefield under (?:its owner'?s|your) control\.?$/i,
      make: () => ({ op: 'returnExiled' }) },
    { re: /^Destroy (target [a-z0-9 '-]+?)\.?$/i,
      make: (m) => ({ op: 'destroy', targets: [targetSpec(m[1])] }) },
    { re: /^Destroy (X|\d+) (target [a-z0-9 '-]+?)s\.?$/i,
      make: (m) => ({ op: 'destroy', count: num(m[1]), targets: [targetSpec(m[2])] }) },
    { re: /^Destroy (target [a-z0-9 '-]+?)\. It can't be regenerated\.?$/i,
      make: (m) => ({ op: 'destroy', noRegen: true, targets: [targetSpec(m[1])] }) },
    { re: /^Exile (target [a-z0-9 '-]+?)\.?$/i,
      make: (m) => ({ op: 'exile', targets: [targetSpec(m[1])] }) },
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
    { re: /^Regenerate (?:CARDNAME)\.?$/i, make: () => ({ op: 'regenerate', scope: 'self' }) },

    // --- pump ---
    { re: /^((?:Another )?[Tt]arget creature(?: you control| an opponent controls)?|Target attacking creature|Target blocking creature|CARDNAME|This creature|It|That creature) gets ([+-][\dX]+)\/([+-][\dX]+) until end of turn\.?$/i,
      make: (m) => ({ op: 'pump', p: +m[2], t: +m[3], duration: 'eot',
        targets: /^(?:another )?target/i.test(m[1]) ? [targetSpec(m[1])] : null,
        scope: /^this/i.test(m[1]) ? 'self' : (/^(it|that creature)$/i.test(m[1]) ? 'lastTarget' : null) }) },
    { re: /^Creatures you control get ([+-]\d+)\/([+-]\d+) until end of turn\.?$/i,
      make: (m) => ({ op: 'pump', p: +m[1], t: +m[2], duration: 'eot', scope: 'yourCreatures' }) },
    { re: /^((?:Another )?[Tt]arget creature(?: you control| an opponent controls)?|Target attacking creature|Target blocking creature|CARDNAME|This creature|It|That creature) gains ([a-z ,]+) until end of turn\.?$/i,
      make: (m) => ({ op: 'grantKeyword', keywords: m[2].split(/,| and /).map(s => U.titleCase(s.trim())).filter(Boolean),
        duration: 'eot',
        targets: /^(?:another )?target/i.test(m[1]) ? [targetSpec(m[1])] : null,
        scope: /^this/i.test(m[1]) ? 'self' : (/^(it|that creature)$/i.test(m[1]) ? 'lastTarget' : null) }) },
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
    { re: /^Each opponent mills (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+|X) cards?\.?$/i, make: (m) => ({ op: 'mill', n: num(m[1]), who: 'opponents' }) },
    { re: /^Target player mills (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+|X) cards?\.?$/i, make: (m) => ({ op: 'mill', n: num(m[1]), who: 'target', targets: [{ type: 'player' }] }) },

    // --- tokens ---
    /* Every creature token sentence, in one reading: how many, tapped or
       not, size, colours, types, keywords, a granted ability, attacking,
       and "where X is the number of …". */
    { re: /^Create .+ creature tokens?\b.*$/i, make: (m) => parseTokenSentence(m[0]) },
    { re: /^Create (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+|X) (Treasure|Clue|Food|Blood|Map|Junk|Powerstone|Incubator|Gold|Shard|Walker) tokens?\.?$/i,
      make: (m) => ({ op: 'createNamedToken', n: num(m[1]), token: m[2] }) },

    // --- sentences that need no action from the engine ---
    { re: /^(?:They|It) can'?t be regenerated\.?$/i, make: () => ({ op: 'noop' }) },
    { re: /^(?:This|That) creature can'?t be regenerated\.?$/i, make: () => ({ op: 'noop' }) },
    { re: /^Activate (?:this ability )?only as a sorcery\.?$/i, make: () => ({ op: 'noop' }) },
    { re: /^Activate (?:this ability )?only any time you could cast a sorcery\.?$/i, make: () => ({ op: 'noop' }) },
    { re: /^Activate (?:this ability )?only once each turn\.?$/i, make: () => ({ op: 'noop' }) },
    { re: /^Activate (?:this ability )?only during (?:your turn|combat|your upkeep)\.?$/i, make: () => ({ op: 'noop' }) },
    { re: /^Cast (?:CARDNAME|this spell) only (?:before|during|after) [^.]*\.?$/i, make: () => ({ op: 'noop' }) },
    { re: /^Until end of turn, you don'?t lose this mana as steps and phases end\.?$/i, make: () => ({ op: 'noop' }) },
    { re: /^You may choose new targets for (?:the|that) copy\.?$/i, make: () => ({ op: 'noop' }) },
    { re: /^(?:Then )?shuffle your library\.?$/i, make: () => ({ op: 'shuffle' }) },
    { re: /^If you do, .*$/i, make: (m) => ({ op: 'manual', text: m[0] }) },
    { re: /^Activate only during your turn\.?$/i, make: () => ({ op: 'noop' }) },
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
      make: () => ({ op: 'destroyAll', what: 'creature' }) },
    { re: /^Destroy all (creatures|artifacts|enchantments|lands|planeswalkers|nonland permanents|permanents)\.?(?: They can'?t be regenerated\.?)?$/i,
      make: (m) => ({ op: 'destroyAll', what: m[1].toLowerCase() }) },
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
    { re: /^Each opponent sacrifices (a|one|two|\d+) (creature|permanent|artifact|enchantment|land)s? of their choice\.?$/i,
      make: (m) => ({ op: 'sacrificeChoice', n: num(m[1]), who: 'opponents', filter: m[2].toLowerCase() }) },
    { re: /^Target player sacrifices (a|one|two|\d+) (creature|permanent|artifact|enchantment|land)s?\.?$/i,
      make: (m) => ({ op: 'sacrificeChoice', n: num(m[1]), who: 'target', filter: m[2].toLowerCase(), targets: [{ type: 'player' }] }) },

    // --- fight, control, counters on many things ---
    { re: /^(?:It|CARDNAME|This creature) fights (up to one )?(target creature(?: you don'?t control| an opponent controls)?|another target creature)\.?$/i,
      make: (m) => ({ op: 'fightSelf', targets: [Object.assign(targetSpec(m[2]), m[1] ? { upTo: true } : {})] }) },
    { re: /^Target creature you control fights target creature you don'?t control\.?$/i,
      make: () => ({ op: 'fight', targets: [{ type: 'creature', controller: 'you' }, { type: 'creature', controller: 'opponent' }] }) },
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
    /* Liquimetal Torque and friends: one more card type for the turn */
    { re: /^(target [a-z ]+?) becomes an? (artifact|enchantment|creature|land) in addition to its other types until end of turn\.?$/i,
      make: (m) => { const t = tgt(m[1]); return t ? { op: 'addTypes', types: [U.titleCase(m[2])], duration: 'eot', targets: [t] } : null; } },
    /* Maze of Ith */
    { re: /^Prevent all combat damage that would be dealt to and dealt by (?:that creature|it) this turn\.?$/i,
      make: () => ({ op: 'flagEot', scope: 'lastTarget', flags: ['noDamage', 'noDamageTaken'] }) },
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
      make: (m) => ({ op: 'grantKeyword', keywords: ['Haste'], scope: 'thatObject', duration: m[1] ? 'eot' : 'permanent' }) },
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
    { re: /^Put target creature card from a graveyard onto the battlefield under your control\.?$/i,
      make: () => ({ op: 'reanimate', mine: true, targets: [{ type: 'creature', zone: 'graveyard' }] }) },
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
    { re: /^Look at the top (a|one|two|three|four|five|six|seven|\d+) cards? of your library\.?$/i,
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
    { re: /^Put one of them into your hand and the rest on the bottom of your library(?: in any order| in a random order)?\.?$/i,
      make: () => ({ op: 'takeFromLooked', n: 1, filter: 'any', to: 'hand', rest: 'bottom' }) },
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
    { re: /^Exile (target [a-z0-9 '-]+?), then return (?:it|that card) to the battlefield under (?:its owner'?s|your) control\.?$/i,
      make: (m) => ({ op: 'blink', targets: [targetSpec(m[1])] }) },
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
    { re: /^Return (?:this (?:Equipment|Aura|artifact|creature|permanent)|CARDNAME) to (?:its|their) owner'?s hand\.?$/i,
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
    { re: /^Put (a|an|one|two|three|\d+) ([+\-]\d\/[+\-]\d|[a-z ]+?) counters? on (each [-a-zA-Z' ]+?)\.?$/i,
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
    { re: /^Exile (?:target|a) card from a graveyard\.?$/i,
      make: () => ({ op: 'exileFromGraveyard', n: 1, who: 'any' }) },
    { re: /^Exile (target [a-z ]+? card) from (?:a|your|target player'?s) graveyard\.?$/i,
      make: (m) => ({ op: 'exileFromGraveyard', n: 1, who: 'any', filter: m[1].replace(/^target /, '').replace(/ card$/, '') }) },

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
    { re: /^Shuffle (?:this (?:artifact|card)|CARDNAME) and your graveyard into (?:their|its) owner'?s library\.?$/i,
      make: () => ({ op: 'graveyardToLibrary', withSelf: true }) },
    { re: /^Shuffle your graveyard into your library\.?$/i, make: () => ({ op: 'graveyardToLibrary' }) },
    { re: /^This spell can'?t be countered\.?$/i, make: () => ({ op: 'cantBeCountered' }) },
    { re: /^Put all ([a-z ]+?) cards revealed this way into your hand and the rest into your graveyard\.?$/i,
      make: (m) => ({ op: 'sortRevealed', filter: m[1].trim().toLowerCase(), keep: 'hand', rest: 'graveyard' }) },


    { re: /^(Target creature(?: you control| an opponent controls)?|CARDNAME|This creature|It|That creature) gets ([+-][\dX]+)\/([+-][\dX]+) and (?:gains|has) ([a-z, ']+?) until end of turn\.?$/i,
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
    { re: /^(?:[A-Za-z][-A-Za-z0-9',’\. ]{0,44}?\s)?deals? (one|two|three|four|five|\d+) damage to (?:that player|them)\.?$/i,
      make: (m) => ({ op: 'damage', n: num(m[1]), toTriggerPlayer: true }) },
    { re: /^(?:CARDNAME|This (?:creature|Equipment|artifact|enchantment)) deals damage to that player equal to the number of cards in their hand\.?$/i,
      make: () => ({ op: 'damage', n: { cardsInHand: 'triggerPlayer' }, toTriggerPlayer: true }) },
    { re: /^(?:They|That player) mills? (a|one|two|three|four|five|six|seven|eight|nine|ten|\d+) cards?\.?$/i,
      make: (m) => ({ op: 'mill', who: 'triggerPlayer', n: num(m[1]) }) },
    { re: /^(?:They|That player) mills? that many cards\.?$/i,
      make: () => ({ op: 'mill', who: 'triggerPlayer', n: 'triggerAmount' }) },
    { re: /^You may have (?:that player|them) lose (one|two|three|\d+) life\.?$/i,
      make: (m) => ({ op: 'may', then: [{ op: 'loseLife', who: 'triggerPlayer', n: num(m[1]) }] }) },
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
    { re: /^After this (?:main )?phase, there are (two|three) additional combat phases( followed by an additional main phase)?\.?$/i,
      make: (m) => ({ op: 'extraCombat', count: num(m[1]), withMain: !!m[2] }) },
    { re: /^Untap all creatures (?:you control )?that attacked this turn\.?$/i, make: () => ({ op: 'untapAttackedThisTurn' }) },
    { re: /^Untap all attacking creatures\.?$/i, make: () => ({ op: 'untapAttacking' }) },
    /* Splendid Reclamation, Aftermath Analyst, Lumra */
    { re: /^(?:Then )?[Rr]eturn all ((?:land|creature|artifact|enchantment|permanent|nonland permanent)(?: and\/or (?:land|creature|artifact|enchantment))?) cards from your graveyard to the battlefield( tapped)?(?: under your control)?\.?$/,
      make: (m) => ({ op: 'massReanimate', filter: m[1].toLowerCase().replace(/ and\/or /g, ' or '), yours: true, tapped: !!m[2] }) },
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
    { re: /^(?:Then )?[Aa]mass ([A-Za-z]+ )?(\d+)\.?$/i,
      make: (m) => ({ op: 'amass', n: +m[2], kind: (m[1] || 'Zombie').trim() }) },
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
    { re: /^(?:You may )?[Pp]ut an? ([-a-z, ]*?)card from your hand onto the battlefield\.?$/i,
      make: (m) => ({ op: 'permanentFromHand', filter: (m[1] || '').trim().toLowerCase() || 'any', who: 'you' }) },
    { re: /^Each player may put an? ([-a-z, ]*?)card from their hand onto the battlefield\.?$/i,
      make: (m) => ({ op: 'permanentFromHand', filter: (m[1] || '').trim().toLowerCase() || 'any', who: 'each' }) },
    { re: /^That creature gains ([a-z, ']+?)\.?$/i,
      make: (m) => ({ op: 'grantKeyword', scope: 'thatObject',
        keywords: m[1].split(/,| and /).map(x => U.titleCase(x.trim())).filter(Boolean), duration: null }) },

    /* ===== damage split between things ===== */
    { re: /^(?:[A-Za-z][-A-Za-z0-9',’\. ]{0,44}?\s)?deals? (one|two|three|four|five|six|\d+|X) damage divided as you choose among (?:one or two targets|any number of targets?|any number of target creatures(?: and\/or planeswalkers)?|two or three targets)\.?$/i,
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
    { re: /^You may reveal an? ([-a-z ]*?)card from among them and put it into your hand\.?$/i,
      make: (m) => ({ op: 'takeFromLooked', n: 1, filter: (m[1] || '').trim().toLowerCase() || 'any',
        to: 'hand', optional: true }) },
    { re: /^You choose an? ([-a-z ]*?)card from it\.?$/i,
      make: (m) => ({ op: 'chooseFromHand', filter: (m[1] || 'nonland').trim().toLowerCase() }) },
    { re: /^That player discards that card\.?$/i, make: () => ({ op: 'discardChosen' }) },
    { re: /^Exile that card\.?$/i, make: () => ({ op: 'exileChosen' }) },
    { re: /^Attach it to target creature you control\.?$/i, make: () => ({ op: 'attachSelf' }) },
    { re: /^Attach (?:CARDNAME|it) to (target creature you control|target creature)\.?$/i,
      make: () => ({ op: 'attachSelf' }) },
    { re: /^If that (?:creature|permanent)(?: or planeswalker)? would die this turn, exile it instead\.?$/i,
      make: () => ({ op: 'exileIfItDies' }) },
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
      make: (m) => {
        const e = { op: 'etbAsCopy', what: m[2].trim().toLowerCase() };
        if (!/^(?:(?:nonland |nonlegendary )?(?:creature|artifact|enchantment|land|equipment|permanent|planeswalker)(?: or (?:creature|artifact|enchantment|planeswalker))?)$/.test(e.what)) return null;
        if (m[1]) e.tapped = true;
        if (m[3]) e.yours = true;
        /* the exceptions the table can honour; anything else ("it has
           haste", "it has 'when this becomes the target …'") is left for a
           person rather than quietly dropped */
        if (m[4]) {
          const ex = m[4].trim();
          const add = ex.match(/^it'?s an? ([A-Z][a-z]+(?: [A-Z][a-z]+)*) in addition to its other types$/);
          if (add) e.addTypes = add[1].split(' ');
          else if (/^it isn'?t legendary$/i.test(ex)) e.nonLegendary = true;
          else return null;
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
    { re: /^Choose a creature type\.?$/i, make: () => ({ op: 'noop' }) },
    { re: /^You may pay ((?:\{[^}]+\})+) rather than pay (?:CARDNAME|this spell)'?s mana cost\.?$/i,
      make: () => ({ op: 'noop' }) },
    { re: /^Destroy all ([A-Z][a-z]+s)\.?$/i,
      make: (m) => ({ op: 'destroyAll', what: m[1].toLowerCase() }) },
    { re: /^Counter (target (?:[a-z-]+, )*(?:or )?[a-z-]+(?: or [a-z-]+)? spell)\.?$/i,
      make: (m) => ({ op: 'counterSpell', targets: [Object.assign(targetSpec(m[1]), { type: 'spell', zone: 'stack' })] }) },
    { re: /^Prevent all combat damage that would be dealt by (target [a-z ]+? creature) this turn\.?$/i,
      make: (m) => ({ op: 'restrict', flag: 'noDamage', targets: [targetSpec(m[1])] }) },
    { re: /^(?:CARDNAME|This creature) can'?t be blocked this turn\.?$/i,
      make: () => ({ op: 'grantKeyword', keywords: ['Unblockable'], duration: 'eot', scope: 'self' }) },
    { re: /^(?:CARDNAME|This creature) can block only creatures with flying\.?$/i,
      make: () => ({ op: 'continuous', layer: 6, scope: { self: true }, flag: 'blocksFliersOnly' }) },
    { re: /^This ability triggers only once each turn\.?$/i, make: () => ({ op: 'noop' }) },
    { re: /^Venture into the dungeon\.?$/i, make: () => ({ op: 'manual', text: 'Venture into the dungeon.' }) },

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
    { re: /^Return (it|that (?:card|creature|permanent)) to the battlefield under (?:its owner'?s|your) control at the beginning of the next end step\.?$/i,
      make: () => ({ op: 'delayed', event: 'eachEndStep', subject: 'lastTarget',
        name: 'Return it at end of turn', effects: [{ op: 'returnThat' }] }) },
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
        scope: /^this/i.test(m[1]) ? 'self' : (/^it$/i.test(m[1]) ? 'lastTarget' : null) }) },

    /* ===== regeneration and damage prevention ===== */
    { re: /^Regenerate (target [a-z0-9 '-]+?|this creature|it)\.?$/i,
      make: (m) => ({ op: 'regenerate',
        targets: /^target/i.test(m[1]) ? [targetSpec(m[1])] : null,
        scope: /^target/i.test(m[1]) ? null : (/^it$/i.test(m[1]) ? 'lastTarget' : 'self') }) },
    { re: /^Prevent all combat damage that would be dealt this turn\.?$/i,
      make: () => ({ op: 'preventDamage', combatOnly: true }) },
    { re: /^Prevent all damage that would be dealt this turn\.?$/i,
      make: () => ({ op: 'preventDamage' }) },
    { re: /^Prevent all (combat )?damage that would be dealt to you this turn\.?$/i,
      make: (m) => ({ op: 'preventDamage', combatOnly: !!m[1], to: 'you' }) },
    { re: /^Prevent the next (\d+) damage that would be dealt to (any target|target creature|target player|you) this turn\.?$/i,
      make: (m) => ({ op: 'preventNext', n: +m[1],
        targets: /^target|^any/i.test(m[2]) ? [targetSpec(m[2])] : null, to: /^you$/i.test(m[2]) ? 'you' : null }) },

    /* ===== combat restrictions ===== */
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
    { re: /^Goad each creature (?:your opponents control|target opponent controls)\.?$/i,
      make: () => ({ op: 'goad', scope: 'opponentCreatures' }) },
    { re: /^(?:Target creature|It|That creature|This creature) doesn'?t untap during (?:its controller'?s|your) next untap step\.?$/i,
      make: () => ({ op: 'noUntap', scope: 'lastTarget' }) },

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
  function countOf(phrase, mult) {
    const p = String(phrase || '').trim();
    const k = mult == null ? 1 : mult;
    let m;
    if ((m = p.match(/^card in (your|target opponent'?s|target player'?s|that player'?s) hand$/i)))
      return { cardsInHand: /^your/i.test(m[1]) ? 'you' : 'target', mult: k };
    if (/^card in your graveyard$/i.test(p)) return { cardsInGraveyard: 'you', mult: k };
    if (/^opponent you have$/i.test(p)) return { opponents: true, mult: k };
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
    if ((m = p.match(/^(?:its|that creature's|that permanent's|the creature's) (power|toughness|mana value)$/i)))
      return done({ ofTrigger: STAT[m[1].toLowerCase()] });
    if ((m = p.match(/^(?:CARDNAME's|this creature's) (power|toughness)$/i))) return done({ ofSelf: m[1].toLowerCase() });
    if (/^the number of cards in your hand$/i.test(p)) return done({ cardsInHand: 'you', mult: 1 });
    if (/^the number of cards in your graveyard$/i.test(p)) return done({ cardsInGraveyard: 'you', mult: 1 });
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
      return sc0;
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
    const orig = String(phrase).replace(/^(?:another |other )?target\s+/i, '').trim();
    const p = orig.toLowerCase();
    const spec = { type: 'permanent', filter: p, zone: zone || 'battlefield' };
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
    const mx = p.match(/with (?:mana value|converted mana cost) (\d+)$/);
    if (mx) spec.mv = +mx[1];
    const withClause = (orig.match(/\s+(?:with|without)\s+.*$/i) || [''])[0];
    const known = spec.maxMv != null || spec.minMv != null || spec.mv != null || spec.maxPower != null || spec.minPower != null ||
      spec.maxToughness != null || spec.minToughness != null || spec.withKeyword || spec.withoutKeyword || spec.withCounter;
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
    const cols = a.colors || [];
    if (spec.colors && !spec.colors.some(c => cols.includes(c))) return false;
    if (spec.notColors && spec.notColors.some(c => cols.includes(c))) return false;
    if (spec.colorless && cols.length) return false;
    if (spec.multicolored && cols.length < 2) return false;
    if (spec.monocolored && cols.length !== 1) return false;
    if (spec.controller === 'you' && obj.controller !== me) return false;
    if (spec.controller === 'opponent' && obj.controller === me) return false;
    if (spec.maxMv != null && (obj.card.cmc || 0) > spec.maxMv) return false;
    if (spec.minMv != null && (obj.card.cmc || 0) < spec.minMv) return false;
    if (spec.mv != null && (obj.card.cmc || 0) !== spec.mv) return false;
    if (spec.attacking && !obj.attacking) return false;
    if (spec.blocking && !(obj.blocking || []).length) return false;
    if (spec.inCombat && !obj.attacking && !(obj.blocking || []).length) return false;
    if (spec.tapped != null && !!obj.tapped !== spec.tapped) return false;
    if (spec.maxPower != null && pow() > spec.maxPower) return false;
    if (spec.minPower != null && pow() < spec.minPower) return false;
    if (spec.maxToughness != null && tou() > spec.maxToughness) return false;
    if (spec.minToughness != null && tou() < spec.minToughness) return false;
    if (spec.withKeyword && !kw(spec.withKeyword)) return false;
    if (spec.withoutKeyword && kw(spec.withoutKeyword)) return false;
    if (spec.withCounter && !(Number((obj.counters || {})[spec.withCounter]) > 0)) return false;
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
      .replace(/^(?:That|The) (?:creature|permanent|land|artifact|enchantment|spell|planeswalker)'s controller\b/, 'Its controller');
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
    /* "If the gift was promised, permanents you control also gain
       indestructible": "also" says how the sentence relates to the one
       before it, not what it does. */
    if (!depth && / also /.test(s)) {
      const again = parseEffectSentence(s.replace(/ also /, ' '), 1);
      if (again) return again;
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
      const helps = again && ((again.op === 'counters' && /^\+/.test(String(again.kind || ''))) ||
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
  const COMBO_RULES = [
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
    const s = String(line).trim().replace(/\.$/, '');
    const m = s.match(/^(?:Each )?([A-Za-z ,]*?)\s*spells? (you cast |your opponents cast |each opponent casts |an opponent casts )?(of the chosen type )?(?:that'?s ([a-z ,]+?) )?costs? \{(\d+)\} (more|less) to cast$/i);
    if (!m) return null;
    const words = (m[1] + ' ' + (m[4] || '')).replace(/,/g, ' ').trim().toLowerCase()
      .replace(/\band\b/g, 'or');
    for (const w of words.split(/\s+/).filter(Boolean)) {
      if (!/^(?:or|creature|noncreature|artifact|nonartifact|enchantment|instant|sorcery|legendary|historic|white|blue|black|red|green|colorless|multicolored|planeswalker|land|aura|equipment|vehicle|kindred)$/.test(w)) return null;
    }
    if (/historic/.test(words)) return null;
    const who = /opponent/i.test(m[2] || '') ? 'opponents' : /you cast/i.test(m[2] || '') ? 'you' : 'all';
    const amount = (+m[5]) * (/less/i.test(m[6]) ? -1 : 1);
    return { op: 'costMod', who, words: words || 'spell', chosenType: !!m[3], amount };
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
    const optional = !!m[1];
    /* "Pay 5 life or pay {2}", "sacrifice a creature, discard a card, or
       pay 4 life": a choice of prices, made as the spell is cast. Each one
       has to be a price the table can take by itself. ("Sacrifice an
       artifact or creature" is one price, with two kinds of thing.) */
    const parts = what.split(/,? or (?=(?:sacrifice|discard|pay|exile|return|reveal|tap)\b)|, (?=(?:sacrifice|discard|pay|exile|return|reveal|tap)\b)/i);
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
    if ((k = what.match(/^reveal (?:a|an) ([A-Za-z -]+?) card from your hand$/i))) return { reveal: { filter: k[1].trim() }, optional };
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
    /\s+and\s+(?=(?:create|draw|put|exile|destroy|return|gain|lose|discard|mill|sacrifice|tap|untap|scry|surveil|amass|proliferate|investigate|connive|add)s?\b)/i,
  ];
  const SUBJECTS = /^(Target player|Target opponent|Target creature'?s? controller|Each opponent|Each player|That player|You)\b/i;

  function tidy(part) {
    let t = String(part).trim().replace(/[.,]$/, '');
    if (!t) return '';
    return t.charAt(0).toUpperCase() + t.slice(1) + '.';
  }

  function parseCompound(sentence) {
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
      if (e) return [e];
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
      const may = s.match(/^You may (.+?)\.$/i);
      const ifDo = next.match(/^If you do,?\s*(.+)$/i);
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
      const unless = s.match(/^(.+?) unless (its controller|that player|they|you|target player|this creature's controller) pays? (\{[^}]+\}(?:\{[^}]+\})*|\d+ life)\.?$/i);
      if (unless) {
        const inner = parseSentenceList(splitSentences(unless[1].trim() + '.'));
        const cost = /life$/i.test(unless[3]) ? { life: parseInt(unless[3], 10) } : unless[3];
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
    return { effects: folded, auto: auto && !folded.some(hasManualStep) };
  }

  /* A generated script describes a card's shape, and some of the shapes it
     writes lose what the effect was pointed at ("untap two target lands"
     as an untap of nothing). Those are not trusted: better that the card
     asks for help than that it quietly does the wrong thing. */
  const NEEDS_AIM = new Set(['destroy', 'exile', 'bounce', 'tap', 'untap', 'counters', 'pump', 'grantKeyword', 'regrowth',
    'reanimate', 'gainControl', 'fight', 'bite', 'copySpell', 'counterSpell', 'restrict', 'regenerate']);
  function generatedScriptSound(script) {
    const ok = (e) => {
      if (!e || typeof e !== 'object') return true;
      if (e.op === 'manual') return false;
      if (NEEDS_AIM.has(e.op) && !(e.targets && e.targets.length) && !e.scope && !e.each && !e.self && !e.toSelf) return false;
      if (e.op === 'damage' && !(e.targets && e.targets.length) && !e.each && !e.toSelf && !e.toTriggerPlayer && !e.scope) return false;
      for (const k of ['list', 'then', 'otherwise', 'effects']) if (Array.isArray(e[k]) && !e[k].every(ok)) return false;
      return !Array.isArray(e.modes) || e.modes.every(m => (m.effects || []).every(ok));
    };
    return (script.abilities || []).concat(script.add || []).every(ab => (ab.effects || []).every(ok));
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
  const NOT_ABILITY_WORDS = new Set(['boast', 'exhaust', 'max speed', 'channel', 'companion', 'forecast', 'renew',
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
      if (e && e.insteadOf) {
        const prev = out.pop();
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
        }
        continue;
      }
      if (e && e.noRegenRider) {
        for (let i = out.length - 1; i >= 0; i--) {
          if (out[i].op === 'damage' || out[i].op === 'destroy' || out[i].op === 'destroyAll') { out[i].noRegen = true; break; }
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
      if (m) { const list = rule.make(m); for (const e of list) e.text = cleaned; return { effects: list, auto: true }; }
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
    return String(t || '')
      .split(/(?<=\.)\s+(?=[A-Z"“])/)
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
    [/^(?:this|CARDNAME|this permanent|this creature|this artifact) is untapped$/i, () => ({ kind: 'selfUntapped' })],
    [/^(?:this|CARDNAME|this permanent|this creature|this artifact) is tapped$/i, () => ({ kind: 'selfTapped' })],
    [/^(?:this creature|CARDNAME) is attacking$/i, () => ({ kind: 'selfAttacking' })],
    [/^it'?s your turn$/i, () => ({ kind: 'yourTurn' })],
    [/^it'?s the first combat phase of the turn$/i, () => ({ kind: 'firstCombat' })],
    [/^it'?s not your turn$/i, () => ({ kind: 'notYourTurn' })],
    // counting the board
    [/^you control (\w+) or more ([a-z]+?)s$/i, (m) => ({ kind: 'control', what: m[2], n: num(m[1]) })],
    [/^you control (?:an?|one or more) ([a-z]+?)s?$/i, (m) => ({ kind: 'control', what: m[1], n: 1 })],
    [/^you control (\w+) or fewer ([a-z]+?)s$/i, (m) => ({ kind: 'control', what: m[2], n: num(m[1]), cmp: 'atMost' })],
    [/^you control no ([a-z]+?)s$/i, (m) => ({ kind: 'control', what: m[1], n: 0, cmp: 'atMost' })],
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
    [/^(?:CARDNAME|this spell|it) was kicked (\w+) or more times$/i, (m) => ({ kind: 'kicked', n: num(m[1]) })],
    [/^(?:CARDNAME|this spell|it) wasn'?t kicked$/i, () => ({ kind: 'kicked', n: 0, cmp: 'atMost' })],
    [/^(?:CARDNAME|this spell|it) was bought back$/i, () => ({ kind: 'boughtBack' })],
    [/^you have the city'?s blessing$/i, () => ({ kind: 'cityBlessing' })],
    [/^you control (\w+) or more lands with different names$/i, (m) => ({ kind: 'landNames', n: num(m[1]) })],
    [/^it doesn'?t have the same name as another creature you control or a creature card in your graveyard$/i, () => ({ kind: 'triggerNameUnique' })],
    [/^it'?s your first, second, or third turn of the game$/i, () => ({ kind: 'earlyTurn', n: 3 })],
    [/^(?:CARDNAME|this creature)'?s power is (\w+) or greater$/i, (m) => ({ kind: 'selfPower', n: num(m[1]) })],
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
    if (k) f.minMv = +k[1];
    return f;
  }

  const TRIGGER_PATTERNS = [
    { re: /^When(?:ever)? an opponent casts a spell from anywhere other than their hand(?:,| )/i, event: 'opponentCastSpell', extra: { notFromHand: true } },
    { re: /^When(?:ever)? you cast a spell from anywhere other than your hand(?:,| )/i, event: 'youCastSpell', extra: { notFromHand: true } },
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
    { re: new RegExp('^When(?:ever)? ' + SUBJ + ' enters or attacks(?:,| )', 'i'),
      event: 'permEnters', also: 'permAttacks', filt: (m) => subjectFilter(m[1]) },
    { re: new RegExp('^When(?:ever)? ' + SUBJ + ' enters?(?: the battlefield)?( under your control| under an opponent\'s control)?(?:,| )', 'i'),
      event: 'permEnters', filt: (m) => {
        const f = subjectFilter(m[1]);
        if (f && m[2]) f.who = /your/i.test(m[2]) ? 'you' : 'opponent';
        return f;
      } },
    { re: new RegExp('^When(?:ever)? ' + SUBJ + ' (?:dies|die|is put into a graveyard from the battlefield|are put into a graveyard from the battlefield)(?:,| )', 'i'),
      event: 'permDies', filt: (m) => subjectFilter(m[1]) },
    { re: new RegExp('^When(?:ever)? ' + SUBJ + ' leaves? the battlefield(?:,| )', 'i'),
      event: 'permLeaves', filt: (m) => subjectFilter(m[1]) },
    { re: new RegExp('^When(?:ever)? ' + SUBJ + ' attacks?(?:,| )', 'i'),
      event: 'permAttacks', filt: (m) => subjectFilter(m[1]) },
    { re: new RegExp('^When(?:ever)? ' + SUBJ + ' blocks?(?:,| )', 'i'),
      event: 'permBlocks', filt: (m) => subjectFilter(m[1]) },
    { re: new RegExp('^When(?:ever)? ' + SUBJ + ' deals? combat damage to a player(?:,| )', 'i'),
      event: 'permCombatDamage', filt: (m) => subjectFilter(m[1]) },
    /* --- spells being cast, by whom and of what kind --- */
    { re: /^When(?:ever)? you cast (?:a|an) ([a-zA-Z ,-]*?)spell( with (?:mana value|converted mana cost) \d+ or (?:greater|more))?, /i,
      event: 'youCastSpell', filt: (m) => spellFilter(m[1], m[2]) },
    { re: /^When(?:ever)? you cast (?:a|an) ([a-zA-Z ,-]*?)spell of the chosen type, /i,
      event: 'youCastSpell', filt: (m) => spellFilter(m[1] + ' of the chosen type') },
    { re: /^When(?:ever)? you cast or copy (?:a|an) ([a-zA-Z ,-]*?)spell, /i,
      event: 'youCastSpell', also: 'youCopySpell', filt: (m) => spellFilter(m[1]) },
    { re: /^When(?:ever)? an opponent casts (?:a|an) ([a-zA-Z ,-]*?)spell( with (?:mana value|converted mana cost) \d+ or (?:greater|more))?, /i,
      event: 'opponentCastSpell', filt: (m) => spellFilter(m[1], m[2]) },
    { re: /^When(?:ever)? a player casts (?:a|an) ([a-zA-Z ,-]*?)spell( with (?:mana value|converted mana cost) \d+ or (?:greater|more))?, /i,
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

    /* --- what the other side of the table is doing --- */
    { re: /^When(?:ever)? an opponent draws a card(?:,| )/i, event: 'opponentDraw' },
    { re: /^When(?:ever)? a(?:nother)? creature an opponent controls dies(?:,| )/i, event: 'opponentCreatureDies' },
    { re: /^When(?:ever)? a(?:nother)? creature you control enters(?: the battlefield)?(?:,| )/i, event: 'yourCreatureEtb' },
    { re: /^When(?:ever)? a(?:n)? (?:nontoken )?permanent you control enters(?: the battlefield)?(?:,| )/i, event: 'yourPermanentEtb' },
    { re: /^When(?:ever)? you discard a card(?:,| )/i, event: 'youDiscard' },
    { re: /^When(?:ever)? an opponent casts their first ([a-zA-Z ]*?)spell each turn(?:,| )/i, event: 'opponentFirstSpell',
      filt: (m) => spellFilter(m[1]), extra: { firstOfKind: true } },
    { re: /^When(?:ever)? a player casts their second spell each turn(?:,| )/i, event: 'anySecondSpell' },
    { re: /^When(?:ever)? an opponent casts their second spell each turn(?:,| )/i, event: 'opponentSecondSpell' },
    { re: /^At the beginning of your next end step(?:,| )/i, event: 'yourEndStep' },
    { re: /^At the beginning of the next end step(?:,| )/i, event: 'eachEndStep' },
    { re: /^At the beginning of your next main phase(?:,| )/i, event: 'yourMain1' },
    { re: /^At the beginning of each player'?s upkeep(?:,| )/i, event: 'eachUpkeep' },
    { re: /^When(?:ever)? equipped creature dies(?:,| )/i, event: 'equippedDies' },
    { re: /^When(?:ever)? enchanted creature dies(?:,| )/i, event: 'equippedDies' },
    { re: /^When(?:ever)? (?:this creature|this permanent|this artifact|this enchantment|~|CARDNAME) enters(?: the battlefield)?(?:,| )/i, event: 'etb', self: true },
    { re: /^When(?:ever)? (?:this creature|this permanent|~|CARDNAME) dies(?:,| )/i, event: 'dies', self: true },
    { re: /^When(?:ever)? (?:this creature|~|CARDNAME) attacks(?:,| )/i, event: 'attacks', self: true },
    { re: /^When(?:ever)? (?:this creature|~|CARDNAME) blocks(?:,| )/i, event: 'blocks', self: true },
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
    { re: /^When(?:ever)? you put one or more \+1\/\+1 counters on (?:a|another) creature you control(?:,| )/i, event: 'countersPut',
      filt: (m) => ({ words: 'creature', who: 'you', other: /another/i.test(m[0]) }), extra: { counterKind: '+1/+1' } },
    { re: /^When(?:ever)? an opponent searches their library(?:,| )/i, event: 'opponentSearches' },
    { re: /^At the beginning of your precombat main phase(?:,| )/i, event: 'yourMain1' },
    { re: /^At the beginning of each opponent'?s upkeep(?:,| )/i, event: 'opponentUpkeep' },
    { re: /^At the beginning of your (?:postcombat )?main phase(?:,| )/i, event: 'yourMain1' },
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

  function _analyze(card, faceIndex) {
    const face = faceOf(card, faceIndex);
    const name = face.name || card.name;
    const typeLine = face.type_line || card.type_line || '';
    const tl = parseTypeLine(typeLine);
    const rawText = face.oracle_text || card.oracle_text || '';
    // Scryfall uses typographic apostrophes and dashes; normalise them so the
    // rule patterns below (written with plain ASCII) actually match real cards.
    let text = normalizePunct(rawText)
      .replace(new RegExp(escapeRe(normalizePunct(U.frontName(name))), 'g'), 'CARDNAME');
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
    let totalLines = 0, autoLines = 0;
    const spreeModes = [];
    // "Choose up to five {P} worth of modes": the budget, and the priced modes under it
    let pawBudget = 0;
    const pawModes = [];

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
      const chan = line.match(/^Channel\s*(?:\u2014|--|-)\s*([^:]+):\s*([\s\S]+)$/i) ||
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
          sorcerySpeed: /Activate only as a sorcery|Activate only during your turn|and only as a sorcery/i.test(line),
        };
        /* "{1}{B}: Return this card from your graveyard to the battlefield
           tapped." An ability that works from the graveyard and nowhere
           else, offered there the way flashback is. */
        if ((cost.exile && cost.exile.fromGraveyard) ||
            /\b(?:this card|CARDNAME) from your graveyard\b/i.test(m[2])) ab.fromGraveyard = true;
        for (const o of only) {
          ab.only = Object.assign({}, ab.only, o.when ? { when: o.when } : null, o.cond ? { cond: o.cond } : null, o.once ? { once: true } : null);
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
          body = body.replace(/^return it to (the battlefield|its owner'?s hand)/i, 'Return CARDNAME to $1');
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
        const linked = /\bIf you (?:do|don'?t)\b/i.test(body) || /\bthis way\b/i.test(body);
        const optional = !linked && /^you may /i.test(body);
        const parsed = parseEffects(optional ? body.replace(/^you may /i, '').replace(/^(\w)/, (c) => c.toUpperCase()) : body);
        if (saddledOnly) condition = condition ? [].concat(condition, { kind: 'saddled' }) : { kind: 'saddled' };
        if (whileCond) condition = condition ? [].concat(condition, whileCond) : whileCond;
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
      out.abilities.push({
        kind: 'spell', text: spreeModes.map(m => '+ ' + m.cost + ' \u2014 ' + m.label).join('\n'),
        auto: spreeModes.every(m => m.auto),
        effects: [{ op: 'modal', spree: true, count: spreeModes.length,
          modes: spreeModes.map(m => ({ label: m.label, effects: m.effects, auto: m.auto })) }],
      });
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

    /* A script for this card replaces or adds to what the lines gave us. It is
       written in the same vocabulary, so from here on nothing can tell the
       difference. A hand-written one is deliberate and always wins; a
       generated one only steps in where reading the text fell short. */
    let script = MTG.scripts && MTG.scripts.scriptFor(name);
    const readWholeCard = totalLines > 0 && autoLines >= totalLines - 0.001;
    const gen = !script && !readWholeCard && MTG.cardlib ? MTG.cardlib.generatedFor(MTG.scripts.keyFor(name)) : null;
    /* A generated script written line by line stands in for exactly the
       lines the reading above could not manage, and nothing else: what was
       read stays as it was read. Each replacement goes where the line's own
       abilities were, so the card keeps its printed order. */
    if (gen && gen.lines) {
      for (const li of lineInfo) {
        if (li.auto) continue;
        const shared = gen.lines[U.hash(li.text)];
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
    if (/enters with a ([a-z]+) counter on it for each time it was kicked/i.test(text)) {
      out.entersWithCounters = { kind: text.match(/enters with a ([a-z]+) counter on it for each time it was kicked/i)[1], n: 'kicked' };
    }
    const kickedEtb = text.match(/If (?:CARDNAME|this creature|this spell|it) was kicked, (?:it|CARDNAME) enters(?: the battlefield)? with (a|an|one|two|three|four|X|\d+) ([+\-0-9/a-z' ]+?) counters? on (?:it|them)/i);
    if (kickedEtb) out.entersWithCounters = { kind: kickedEtb[2].trim(), n: num(kickedEtb[1]), ifKicked: true };
    /* "…enters with X +1/+1 counters on it, where X is the number of
       creatures you control." The number is worked out as it arrives. */
    const etbPer = text.match(/enters(?: the battlefield)? with X ([+\-0-9/a-z' ]+?) counters? on (?:it|them),? where X is the number of ([-a-z' ]+?) you control/i);
    if (etbPer) out.entersWithCounters = { kind: etbPer[1].trim(), n: { per: etbPer[2].trim().toLowerCase() } };
    let etbm = text.match(/enters with (a|an|one|two|three|four|X|\d+) \+1\/\+1 counters?/i);
    if (etbm && !out.entersWithCounters) out.entersWithCounters = { kind: '+1/+1', n: num(etbm[1]) };
    etbm = text.match(/enters with (a|an|one|two|three|\d+) ([a-z ]+?) counters?/i);
    if (etbm && !out.entersWithCounters) out.entersWithCounters = { kind: etbm[2].trim(), n: num(etbm[1]) };
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
    for (const ab of out.abilities) {
      if (!ab.auto || !JSON.stringify(ab.effects || []).includes('"triggerObject"')) continue;
      if (ab.kind === 'triggered' && !ab.self) continue;
      ab.auto = false;
      autoLines--;
    }
    // only now, with every footnote folded into its line, is the count final
    out.autoCoverage = totalLines === 0 ? 1 : U.clamp(autoLines / totalLines, 0, 1);
    out.fullyAutomated = out.autoCoverage >= 0.999;
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
    let rest = raw.replace(/^all /i, '').replace(/^each (other )?(creature|artifact|land|permanent|enchantment)\b/i, (x, o, n) => (o || '') + n + 's');
    /* "Creatures you control of the chosen type": whatever this permanent
       was told as it entered */
    const chosen = rest.match(/ of the chosen (type|colou?r)\b/i);
    if (chosen) {
      if (/type/i.test(chosen[1])) sc.chosenType = true; else sc.chosenColor = true;
      rest = rest.replace(/ of the chosen (?:type|colou?r)\b/i, '');
    }
    // who controls them
    const W = rest.match(/ (you control|your opponents control|your team controls|you don'?t control|an opponent controls|target player controls|target opponent controls|defending player controls)$/i);
    if (W) {
      sc.who = /^(?:you control|your team)/i.test(W[1]) ? 'you' : /^target/i.test(W[1]) ? 'target' : 'opponents';
      rest = rest.slice(0, W.index);
    }
    // and what they have
    let m;
    for (let pass = 0; pass < 2; pass++) {
      if ((m = rest.match(/ with power (\d+) or (greater|more|less)$/i))) {
        if (/less/i.test(m[2])) sc.maxPower = +m[1]; else sc.minPower = +m[1];
        rest = rest.slice(0, m.index);
      } else if ((m = rest.match(/ with (?:mana value|converted mana cost) (\d+) or (less|greater|more)$/i))) {
        if (/less/i.test(m[2])) sc.maxMv = +m[1]; else sc.minMv = +m[1];
        rest = rest.slice(0, m.index);
      } else if ((m = rest.match(/ with (?:one or more |a )?counters? on (?:it|them)$/i))) {
        sc.withAnyCounter = true; rest = rest.slice(0, m.index);
      } else if ((m = rest.match(/ with an? ([+\-0-9/a-z]+) counter on (?:it|them)$/i)) ||
          (m = rest.match(/ with ([+\-0-9/a-z]+) counters on them$/i))) {
        sc.withCounter = m[1]; rest = rest.slice(0, m.index);
      } else if ((m = rest.match(/ (with|without) (flying|first strike|double strike|deathtouch|lifelink|trample|haste|vigilance|menace|reach|defender|hexproof|indestructible)$/i))) {
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
      if (!/^[A-Z][a-z'-]+s$/.test(w) || words.length > 2) return null;
      sc.subtype = w.toLowerCase().replace(/ves$/, 'f').replace(/s$/, '');
      sc.what = 'permanent';
      words.pop();
    } else if (nouns.length === 1) sc.what = nouns[0];
    else { sc.what = 'permanent'; sc.anyOf = nouns; }
    const COL = { white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' };
    for (const w of words) {
      const lw = w.toLowerCase();
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
  const CONTINUOUS_RULES = [
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
    { re: /^(.+?) gets? \+(\d+)\/\+(\d+) for each ([-a-zA-Z0-9+/' ]+?) and (?:has|have) ([a-z, ']+?)\.?$/i,
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
    { re: /^If an? ((?:red |green |white |blue |black )?(?:source|creature)) you control would deal damage to (a permanent or player|an opponent or a permanent an opponent controls), it deals (double|triple|that much damage plus (?:one|two|three|\d+))(?: that damage)?(?: to that (?:permanent or player|player or permanent))? instead\.?$/i,
      make: (m) => {
        const words = m[1].toLowerCase().replace(/\bsource\b/, '').trim();
        const plus = m[3].match(/plus (\w+)/i);
        return Object.assign({ op: 'replace', id: 'dmg' + m[3].slice(0, 6), event: 'damage', who: 'you',
          toOpponent: /opponent/i.test(m[2]), sourceWords: words || null },
          plus ? { how: 'add', n: num(plus[1]) } : { how: m[3].toLowerCase() });
      } },
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
    { re: /^((?:Artifacts|Creatures|Lands|Permanents|Nonland permanents)(?: and (?:artifacts|creatures|lands|nonbasic lands))?) your opponents control enter (?:the battlefield )?tapped\.?$/i,
      make: (m) => ({ op: 'replace', id: 'etbTapOpp', event: 'enters', who: 'opponents', how: 'tapped',
        whatAny: m[1].toLowerCase().replace(/^nonland permanents$/, 'nonland').split(/ and /).map(w => w.replace(/s$/, '')) }) },
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
    return null;
  }

  /* Ops that make sense as a permanent's standing rule rather than a one-off. */
  const STATIC_OPS = new Set(['continuous', 'replace', 'taxSpells', 'extraLand',
    'chooseTypeOnEnter', 'chooseColorOnEnter', 'uncounterable', 'castRestrict', 'extraManaOnTap', 'etbTappedUnlessCond',
    'skipStep', 'etbTapped', 'cantBlock', 'cantAttack', 'mustAttack', 'mustBlock', 'noop', 'sequence',
    'evasion', 'attackRequires', 'cantBeCountered', 'noMaxHandSize', 'peekTop', 'optionalUntap',
    'blocksExtra',
    'cumulativeUpkeep', 'activateOnly', 'etbTappedUnlessLife', 'etbTappedUnlessOpponents',
    'etbTappedUnlessReveal', 'etbAsCopy',
    'exploit', 'ascend', 'sacUnlessControl', 'noLifeGain', 'playerHexproof', 'leyline']);

  function parseStatic(line, ctx) {
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
      { re: /^CARDNAME attacks each (?:combat|turn) if able\.?$/i, eff: { op: 'mustAttack' }, auto: true },
      { re: /^CARDNAME blocks each (?:combat|turn) if able\.?$/i, eff: { op: 'mustBlock' }, auto: true },
      /* The counters are already put on by the enters-with replacement the
         card-level scan found; this rule is here so the sentence that says
         so counts as read rather than as a line nobody could parse. */
      { re: /^(?:CARDNAME|This creature|This permanent|It) enters(?: the battlefield)? with (?:a|an|one|two|three|four|five|X|\d+) [+\-0-9/a-z' ]+ counters? on (?:it|him|her|them)\.?$/i,
        eff: { op: 'noop' }, auto: true },
      { re: /^(?:CARDNAME|This (?:artifact|creature|permanent)) enters(?: the battlefield)? with a [a-z]+ counter on it for each time it was kicked\.?$/i,
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
      { re: /^(?:CARDNAME|This creature) can'?t attack unless defending player controls an? ([A-Za-z][A-Za-z' -]*?)\.?$/i,
        make: (m) => ({ op: 'attackRequires', defenderControls: m[1].trim().toLowerCase() }), auto: true },
      { re: /^CARDNAME can'?t be countered\.?$/i, eff: { op: 'cantBeCountered' }, auto: true },
      /* The cost machinery reads this off the card itself; the sentence is
         here so it counts as read rather than as a line nobody could
         parse. */
      { re: /^[A-Za-z ,]*spells? you cast costs? \{\d+\} less to cast\.?$/i, eff: { op: 'noop' }, auto: true },
      { re: /^Exploit$/i, eff: { op: 'exploit' }, auto: true },
      { re: /^Ascend$/i, eff: { op: 'ascend' }, auto: true },
      { re: /^When you control no ([A-Za-z]+)s?, sacrifice (?:CARDNAME|this creature|this permanent)\.?$/i,
        make: (m) => ({ op: 'sacUnlessControl', what: m[1].toLowerCase() }), auto: true },
      { re: /^You have no maximum hand size\.?$/i, eff: { op: 'noMaxHandSize' }, auto: true },
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
      /* "Equip {2}" is an activated ability with a target, not a footnote:
         pay the cost at sorcery speed and the Equipment moves. */
      if (eff.op === 'equip' || eff.op === 'fortify' || eff.op === 'reconfigure') {
        /* "Equip legendary creature {3}", "Equip commander {3}": the creature
           it may go on is narrower than usual */
        const spec = { type: 'creature', controller: 'you' };
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

  /** What to write on the button for an ability that came without prose. */
  function abilityLabel(ab) {
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
    abilityLabel, describeEffects, condOf,
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


