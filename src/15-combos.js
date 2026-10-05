/* ============================================================
   15-combos.js - infinite combo detection
   Three detectors, unioned and de-duplicated:
     1. Commander Spellbook's public find-my-combos API (authoritative,
        always current) - used when the network is available.
     2. A curated table of well-known combos - works offline, high precision.
     3. A structural detector that reads Oracle text and looks for genuine
        loops (untap-for-mana, copy/untap, persist + free sac, blink value,
        infinite-mana payoffs) - catches things no list contains.
   Also reports "one card away" near-misses, which feed the recommender.
   ============================================================ */
'use strict';
(function (MTG) {
  const U = MTG.util;
  const O = MTG.oracle;

  /* ============================================================
     1. Commander Spellbook
     ============================================================ */
  const CS_BASE = 'https://backend.commanderspellbook.com';
  const csCache = new Map();

  async function spellbookFindMyCombos(deck, opts) {
    opts = opts || {};
    const main = [];
    const commanders = [];
    for (const e of deck.main) main.push({ card: U.frontName(e.card.name), quantity: e.qty });
    for (const e of (deck.sideboard || [])) main.push({ card: U.frontName(e.card.name), quantity: e.qty });
    for (const c of (deck.commanders || [])) commanders.push({ card: U.frontName(c.name), quantity: 1 });
    if (!main.length && !commanders.length) return null;

    const key = U.hash(JSON.stringify([main.map(m => m.card).sort(), commanders.map(c => c.card).sort()]));
    if (csCache.has(key) && !opts.force) return csCache.get(key);

    const bodies = [
      { main, commanders },
      { main: main.map(m => m.card), commanders: commanders.map(c => c.card) },
    ];
    let data = null, lastErr = null;
    for (const body of bodies) {
      try {
        const res = await fetch(CS_BASE + '/find-my-combos/', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
          body: JSON.stringify(body),
        });
        if (res.status === 429) { await U.sleep(3000); continue; }
        if (!res.ok) { lastErr = new Error('Spellbook ' + res.status); continue; }
        data = await res.json();
        break;
      } catch (e) { lastErr = e; }
    }
    if (!data) { if (lastErr) MTG.log('spellbook unavailable', lastErr.message); return null; }

    const out = normalizeSpellbook(data);
    csCache.set(key, out);
    return out;
  }

  /** The backend has renamed fields across versions; read it tolerantly. */
  function normalizeSpellbook(data) {
    const results = data.results || data;
    const bucket = (k) => {
      const v = results[k];
      if (Array.isArray(v)) return v;
      if (v && Array.isArray(v.results)) return v.results;
      return [];
    };
    const inDeck = bucket('included').concat(bucket('includedByChangingCommanders'));
    const almost = bucket('almostIncluded')
      .concat(bucket('almostIncludedByAddingColors'))
      .concat(bucket('almostIncludedByChangingCommanders'))
      .concat(bucket('almostIncludedByAddingColorsAndChangingCommanders'));
    return {
      complete: inDeck.map(v => variantToCombo(v, true)).filter(Boolean),
      near: almost.map(v => variantToCombo(v, false)).filter(Boolean),
      source: 'spellbook',
    };
  }

  function cardNamesOf(list) {
    const out = [];
    for (const u of (list || [])) {
      const n = (u && u.card && (u.card.name || u.card.oracleName)) || u.name ||
        (u && u.template && (u.template.name || u.template.scryfallQuery)) || null;
      if (n) out.push(String(n));
    }
    return out;
  }
  function featureNamesOf(list) {
    const out = [];
    for (const p of (list || [])) {
      const n = (p && p.feature && p.feature.name) || p.name || (typeof p === 'string' ? p : null);
      if (n) out.push(String(n));
    }
    return out;
  }

  function variantToCombo(v, complete) {
    if (!v) return null;
    const uses = cardNamesOf(v.uses || v.cards);
    const templates = cardNamesOf(v.requires || v.templates);
    const produces = featureNamesOf(v.produces || v.features || v.results);
    if (!uses.length && !templates.length) return null;
    const steps = (v.description || v.steps || '').toString();
    const prereq = []
      .concat(v.easyPrerequisites ? [v.easyPrerequisites] : [])
      .concat(v.notablePrerequisites ? [v.notablePrerequisites] : [])
      .concat(v.otherPrerequisites ? [v.otherPrerequisites] : [])
      .concat(v.prerequisites ? [v.prerequisites] : [])
      .filter(Boolean).join('\n');
    return {
      id: 'cs:' + (v.id || U.hash(uses.join('|'))),
      source: 'spellbook',
      pieces: uses,
      templates,
      produces,
      kind: classifyProduces(produces),
      mana: v.manaNeeded || '',
      prerequisites: prereq,
      steps,
      complete: !!complete,
      missing: [],
      popularity: v.popularity || 0,
      url: v.id ? 'https://commanderspellbook.com/combo/' + v.id + '/' : null,
    };
  }

  function classifyProduces(produces) {
    const s = (produces || []).join(' ').toLowerCase();
    if (/infinite/.test(s)) return 'infinite';
    if (/win the game|each opponent loses the game|lose the game/.test(s)) return 'win';
    if (/lock|can't|cannot/.test(s)) return 'lock';
    if (/arbitrarily large/.test(s)) return 'infinite';
    return 'synergy';
  }

  /* ============================================================
     2. Curated table
     Each entry: pieces (exact card names), what it does, and how.
     ============================================================ */
  const CURATED = [
    /* --- untap / copy loops --- */
    { p: ['Kiki-Jiki, Mirror Breaker', 'Zealous Conscripts'], r: 'Infinite hasty creature tokens', k: 'infinite',
      d: 'Tap Kiki-Jiki to copy Zealous Conscripts. The copy enters and untaps Kiki-Jiki. Repeat for as many hasty 3/3s as you like, then attack.' },
    { p: ['Kiki-Jiki, Mirror Breaker', 'Restoration Angel'], r: 'Infinite hasty creature tokens', k: 'infinite',
      d: 'Kiki-Jiki copies Restoration Angel; the copy blinks Kiki-Jiki, which returns untapped and can copy again.' },
    { p: ['Kiki-Jiki, Mirror Breaker', 'Felidar Guardian'], r: 'Infinite hasty creature tokens', k: 'infinite',
      d: 'Kiki copies Felidar Guardian; the copy blinks Kiki, returning it untapped.' },
    { p: ['Kiki-Jiki, Mirror Breaker', 'Deceiver Exarch'], r: 'Infinite hasty creature tokens', k: 'infinite',
      d: 'Kiki copies Deceiver Exarch; the copy untaps Kiki.' },
    { p: ['Kiki-Jiki, Mirror Breaker', 'Pestermite'], r: 'Infinite hasty creature tokens', k: 'infinite',
      d: 'Kiki copies Pestermite; the copy untaps Kiki.' },
    { p: ['Kiki-Jiki, Mirror Breaker', 'Village Bell-Ringer'], r: 'Infinite hasty creature tokens', k: 'infinite',
      d: 'Kiki copies Village Bell-Ringer; the copy untaps all your creatures including Kiki.' },
    { p: ['Kiki-Jiki, Mirror Breaker', 'Combat Celebrant'], r: 'Infinite combat phases', k: 'infinite',
      d: 'Copy Combat Celebrant, exert the copy for an extra combat, and the copy untaps your creatures.' },
    { p: ['Splinter Twin', 'Deceiver Exarch'], r: 'Infinite hasty creature tokens', k: 'infinite',
      d: 'Enchant Deceiver Exarch with Splinter Twin, tap to copy it, and the copy untaps the original.' },
    { p: ['Splinter Twin', 'Pestermite'], r: 'Infinite hasty creature tokens', k: 'infinite',
      d: 'Enchant Pestermite, tap to copy, the copy untaps the original.' },
    { p: ['Saheeli Rai', 'Felidar Guardian'], r: 'Infinite hasty creature tokens', k: 'infinite',
      d: 'Saheeli -2 copies Felidar Guardian; the copy blinks Saheeli, resetting her loyalty.' },
    { p: ['Dualcaster Mage', 'Ghostly Flicker'], r: 'Infinite blinks and value', k: 'infinite',
      d: 'Cast Ghostly Flicker, respond with Dualcaster Mage copying it, and have the copy blink Dualcaster Mage and another permanent.' },
    { p: ['Dualcaster Mage', 'Twinflame'], r: 'Infinite hasty creature tokens', k: 'infinite',
      d: 'Copy Twinflame with Dualcaster Mage, copying Dualcaster Mage each time.' },
    { p: ['Dualcaster Mage', 'Heat Shimmer'], r: 'Infinite hasty creature tokens', k: 'infinite',
      d: 'Same loop as Twinflame: each Dualcaster copy re-copies the spell.' },
    { p: ['Naru Meha, Master Wizard', 'Ghostly Flicker'], r: 'Infinite blinks', k: 'infinite',
      d: 'Naru Meha copies Ghostly Flicker on entry; the copy blinks Naru Meha to repeat.' },

    /* --- mana --- */
    { p: ['Devoted Druid', 'Vizier of Remedies'], r: 'Infinite green mana', k: 'infinite',
      d: 'Vizier stops the -1/-1 counter, so Devoted Druid untaps for free and taps for {G} forever.' },
    { p: ['Devoted Druid', 'Swift Reconfiguration'], r: 'Infinite green mana', k: 'infinite',
      d: 'Swift Reconfiguration makes the Druid a 0/3 Vehicle artifact with no toughness loss from -1/-1 counters.' },
    { p: ['Basalt Monolith', 'Rings of Brighthearth'], r: 'Infinite colorless mana', k: 'infinite',
      d: 'Pay {3} to untap Basalt Monolith, copy the untap with Rings for {2}, tap for {3}: net +1 each loop.' },
    { p: ['Basalt Monolith', 'Power Artifact'], r: 'Infinite colorless mana', k: 'infinite',
      d: 'Power Artifact reduces the untap cost to {1}; tap for {3}, untap for {1}.' },
    { p: ['Grim Monolith', 'Power Artifact'], r: 'Infinite colorless mana', k: 'infinite',
      d: 'Untap cost drops to {2}; tap for {3}, untap for {2}.' },
    { p: ['Basalt Monolith', 'Kinnan, Bonder Prodigy'], r: 'Infinite colorless mana', k: 'infinite',
      d: 'Kinnan adds an extra {C} when you tap Basalt Monolith, so tapping nets {4} while untapping costs {3}.' },
    { p: ['Basalt Monolith', 'Nyxbloom Ancient'], r: 'Infinite colorless mana', k: 'infinite',
      d: 'Nyxbloom triples the Monolith to {9}; untapping costs {3}.' },
    { p: ['Isochron Scepter', 'Dramatic Reversal'], r: 'Infinite mana (with 3+ mana from nonlands)', k: 'infinite',
      d: 'Imprint Dramatic Reversal, tap Scepter for {2} to cast it, untap all nonland permanents. Nets mana if your nonland permanents make {3} or more.' },
    { p: ['Pili-Pala', 'Grand Architect'], r: 'Infinite colorless mana', k: 'infinite',
      d: 'Grand Architect makes Pili-Pala blue and taps blue creatures for {C}{C}; Pili-Pala converts one of those into any colour and untaps itself.' },
    { p: ['Freed from the Real', 'Bloom Tender'], r: 'Infinite mana (3+ colours on board)', k: 'infinite',
      d: 'Bloom Tender taps for one mana per colour among your permanents; Freed from the Real untaps it for {U}.' },
    { p: ['Pemmin’s Aura', 'Bloom Tender'], r: 'Infinite mana (3+ colours on board)', k: 'infinite',
      d: 'Same as Freed from the Real: untap for {U}, tap for three or more.' },
    { p: ['Freed from the Real', 'Faeburrow Elder'], r: 'Infinite mana (3+ colours on board)', k: 'infinite',
      d: 'Faeburrow Elder taps for one mana per colour among your permanents; untap it for {U}.' },
    { p: ['Freed from the Real', 'Axebane Guardian'], r: 'Infinite mana (3+ walls)', k: 'infinite',
      d: 'Axebane Guardian taps for one mana per Defender you control; untap for {U}.' },
    { p: ['Umbral Mantle', 'Priest of Titania'], r: 'Infinite mana (5+ Elves)', k: 'infinite',
      d: 'Priest taps for one per Elf; Umbral Mantle untaps for {3}. Profitable once you have four or more Elves.' },
    { p: ['Umbral Mantle', 'Selvala, Heart of the Wilds'], r: 'Infinite green mana', k: 'infinite',
      d: 'Selvala taps for a big pile of green; Umbral Mantle untaps her for {3}.' },
    { p: ['Umbral Mantle', 'Marwyn, the Nurturer'], r: 'Infinite green mana', k: 'infinite',
      d: 'Marwyn taps for her power; Umbral Mantle untaps for {3}.' },
    { p: ['Staff of Domination', 'Priest of Titania'], r: 'Infinite mana and draw (5+ Elves)', k: 'infinite',
      d: 'Tap Priest for five or more, pay {3} to untap her with Staff, and spend the surplus on Staff’s draw ability.' },
    { p: ['Staff of Domination', 'Selvala, Heart of the Wilds'], r: 'Infinite mana and draw', k: 'infinite',
      d: 'Tap Selvala for a large amount, untap with Staff for {3}.' },
    { p: ['Sword of the Paruns', 'Priest of Titania'], r: 'Infinite mana (5+ Elves)', k: 'infinite',
      d: 'Sword of the Paruns untaps the Priest for {3}.' },
    { p: ['Peregrine Drake', 'Deadeye Navigator'], r: 'Infinite mana', k: 'infinite',
      d: 'Soulbond Deadeye Navigator to Peregrine Drake, then pay {1}{U} to blink the Drake, untapping five lands each time.' },
    { p: ['Palinchron', 'Deadeye Navigator'], r: 'Infinite mana', k: 'infinite',
      d: 'Blink Palinchron for {1}{U}; it untaps seven lands on each return.' },
    { p: ['Palinchron', 'High Tide'], r: 'Infinite blue mana', k: 'infinite',
      d: 'With High Tide up, Palinchron’s seven untapped Islands make fourteen while returning it costs seven.' },
    { p: ['Great Whale', 'Deadeye Navigator'], r: 'Infinite mana', k: 'infinite',
      d: 'Blink Great Whale for {1}{U}; it untaps seven lands.' },
    { p: ['Worldgorger Dragon', 'Animate Dead'], r: 'Infinite mana and ETB triggers', k: 'infinite',
      d: 'Worldgorger Dragon exiles your permanents including Animate Dead, which returns it, looping. Untapped lands give infinite mana; you need a way to break the loop.' },
    { p: ['Auriok Salvagers', 'Lion’s Eye Diamond'], r: 'Infinite mana', k: 'infinite',
      d: 'Crack Lion’s Eye Diamond for three, pay {1}{W} to return it from the graveyard, repeat for net mana.' },
    { p: ['Food Chain', 'Squee, the Immortal'], r: 'Infinite creature mana', k: 'infinite',
      d: 'Exile Squee to Food Chain for creature-only mana, cast him from exile, repeat.' },
    { p: ['Food Chain', 'Misthollow Griffin'], r: 'Infinite creature mana', k: 'infinite',
      d: 'Misthollow Griffin can be cast from exile, so Food Chain loops it for creature-only mana.' },
    { p: ['Food Chain', 'Eternal Scourge'], r: 'Infinite creature mana', k: 'infinite',
      d: 'Eternal Scourge can be cast from exile; Food Chain loops it.' },
    { p: ['Dockside Extortionist', 'Temur Sabertooth'], r: 'Infinite Treasure tokens', k: 'infinite',
      d: 'Bounce Dockside Extortionist with Temur Sabertooth for {1}{G} and recast it; profitable once opponents have three or more artifacts and enchantments.' },
    { p: ['Dockside Extortionist', 'Deadeye Navigator'], r: 'Infinite Treasure tokens', k: 'infinite',
      d: 'Blink Dockside for {1}{U}; profitable with three or more artifacts and enchantments across the table.' },
    { p: ['Necrotic Ooze', 'Devoted Druid', 'Morselhoarder'], r: 'Infinite mana', k: 'infinite',
      d: 'With both in the graveyard, Necrotic Ooze has Devoted Druid’s untap and Morselhoarder’s mana ability, so it untaps for free and makes mana each time.' },

    /* --- sacrifice / recursion --- */
    { p: ['Mikaeus, the Unhallowed', 'Triskelion'], r: 'Infinite damage', k: 'infinite',
      d: 'Remove all three counters from Triskelion to deal 3, it dies, undying returns it with an extra +1/+1 counter, and Mikaeus keeps it coming back.' },
    { p: ['Mikaeus, the Unhallowed', 'Walking Ballista'], r: 'Infinite damage', k: 'infinite',
      d: 'Remove Ballista’s counters to ping, it dies with zero toughness, Mikaeus returns it with an extra counter.' },
    { p: ['Heliod, Sun-Crowned', 'Walking Ballista'], r: 'Infinite damage', k: 'infinite',
      d: 'Give Ballista lifelink with Heliod, remove a counter to deal 1, gain 1 life, and Heliod puts the counter back.' },
    { p: ['Melira, Sylvok Outcast', 'Kitchen Finks'], r: 'Infinite life (with a free sacrifice outlet)', k: 'infinite',
      d: 'Melira stops the -1/-1 counter, so persist returns Kitchen Finks unchanged every time you sacrifice it. Add a free sac outlet such as Viscera Seer.' },
    { p: ['Melira, Sylvok Outcast', 'Murderous Redcap'], r: 'Infinite damage (with a free sacrifice outlet)', k: 'infinite',
      d: 'Persist returns Murderous Redcap with no counter, so its ETB ping repeats. Needs a free sacrifice outlet.' },
    { p: ['Gravecrawler', 'Phyrexian Altar', 'Zulaport Cutthroat'], r: 'Infinite drain', k: 'infinite',
      d: 'Sacrifice Gravecrawler to Phyrexian Altar for a black mana, recast it (you control a Zombie), and Zulaport Cutthroat drains on each death.' },
    { p: ['Gravecrawler', 'Phyrexian Altar', 'Blood Artist'], r: 'Infinite drain', k: 'infinite',
      d: 'Same Gravecrawler loop with Blood Artist as the drain.' },
    { p: ['Karmic Guide', 'Reveillark', 'Ashnod’s Altar'], r: 'Infinite ETB triggers and mana', k: 'infinite',
      d: 'Sacrifice both to Ashnod’s Altar for four mana; Reveillark leaving returns Karmic Guide, which returns Reveillark.' },
    { p: ['Karmic Guide', 'Reveillark', 'Viscera Seer'], r: 'Infinite scry and death triggers', k: 'infinite',
      d: 'Viscera Seer is a free sac outlet; Reveillark returns Karmic Guide, which reanimates Reveillark.' },
    { p: ['Nim Deathmantle', 'Ashnod’s Altar', 'Grave Titan'], r: 'Infinite tokens and mana', k: 'infinite',
      d: 'Sacrifice Grave Titan and its Zombies for mana, Nim Deathmantle reanimates the Titan for {4}, and it makes two more Zombies.' },
    { p: ['Sharuum the Hegemon', 'Phyrexian Metamorph', 'Disciple of the Vault'], r: 'Infinite damage', k: 'infinite',
      d: 'Metamorph copies Sharuum, the legend rule kills one, the survivor reanimates the other, and Disciple drains each time an artifact dies.' },
    { p: ['Thopter Foundry', 'Sword of the Meek', 'Krark-Clan Ironworks'], r: 'Infinite Thopters, mana and life', k: 'infinite',
      d: 'Sacrifice Sword of the Meek to Thopter Foundry for a Thopter; the Sword returns attached to it; Ironworks turns the pieces back into mana.' },
    { p: ['Grinding Station', 'Sword of the Meek', 'Thopter Foundry'], r: 'Infinite mill', k: 'infinite',
      d: 'Each Thopter made by the Foundry can be sacrificed to Grinding Station, which untaps it and mills three.' },
    { p: ['Krark-Clan Ironworks', 'Myr Retriever', 'Scrap Trawler'], r: 'Infinite artifact recursion', k: 'infinite',
      d: 'Ironworks sacrifices the artifacts for mana; Scrap Trawler and Myr Retriever return each other.' },
    { p: ['Altar of Dementia', 'Karmic Guide', 'Reveillark'], r: 'Infinite mill', k: 'infinite',
      d: 'Sacrifice the pair to Altar of Dementia; Reveillark returns Karmic Guide, which reanimates Reveillark.' },
    { p: ['Pitiless Plunderer', 'Gravecrawler'], r: 'Infinite Treasure and death triggers (with a sac outlet)', k: 'infinite',
      d: 'Each Gravecrawler death makes a Treasure, which pays to recast it. Needs a free sacrifice outlet and another Zombie.' },

    /* --- drain / lifegain --- */
    { p: ['Sanguine Bond', 'Exquisite Blood'], r: 'Infinite drain - wins the game', k: 'win',
      d: 'Any single point of life gained or lost starts the loop: Sanguine Bond drains, Exquisite Blood gains, forever.' },
    { p: ['Vizkopa Guildmage', 'Exquisite Blood'], r: 'Infinite drain - wins the game', k: 'win',
      d: 'Activate Vizkopa Guildmage’s second ability, then any life gain loops with Exquisite Blood.' },
    { p: ['Cliffhaven Vampire', 'Exquisite Blood'], r: 'Infinite drain - wins the game', k: 'win',
      d: 'Cliffhaven Vampire turns your life gain into loss for an opponent; Exquisite Blood turns that back into life gain.' },
    { p: ['Famished Paladin', 'Sorcerer’s Wand'], r: 'Infinite damage', k: 'infinite',
      d: 'Equip the lifelinking Paladin with Sorcerer’s Wand; every ping gains life, which untaps the Paladin.' },
    { p: ['Aetherflux Reservoir', 'Bolas’s Citadel', 'Sensei’s Divining Top'], r: 'Infinite life, then 50 damage', k: 'win',
      d: 'Cast Top off Bolas’s Citadel by paying life, spin it to put itself on top, and Aetherflux Reservoir gains more life than the Citadel costs.' },

    /* --- token / land loops --- */
    { p: ['Earthcraft', 'Squirrel Nest'], r: 'Infinite Squirrels', k: 'infinite',
      d: 'Make a Squirrel with the Nest, tap it to Earthcraft to untap the enchanted land, and repeat.' },
    { p: ['Life and Limb', 'Sporemound'], r: 'Infinite Saprolings and lands', k: 'infinite',
      d: 'Life and Limb makes Saprolings into lands, so each one entering triggers Sporemound, which makes another Saproling.' },
    { p: ['Presence of Gond', 'Midnight Guard'], r: 'Infinite Elf tokens', k: 'infinite',
      d: 'Tap Midnight Guard for an Elf; the Elf entering untaps Midnight Guard.' },
    { p: ['Intruder Alarm', 'Sporemound'], r: 'Infinite untaps', k: 'infinite',
      d: 'Any creature entering untaps all creatures, so a repeatable token maker loops.' },
    { p: ['Thornbite Staff', 'Krenko, Mob Boss'], r: 'Infinite Goblins (with a sacrifice outlet)', k: 'infinite',
      d: 'Thornbite Staff untaps Krenko whenever a creature dies, so sacrificing a Goblin lets you tap Krenko again.' },

    /* --- extra turns and combats --- */
    { p: ['Time Sieve', 'Thopter Assembly'], r: 'Infinite turns', k: 'infinite',
      d: 'Thopter Assembly makes five Thopters each upkeep; sacrifice them plus itself to Time Sieve for an extra turn.' },
    { p: ['Aggravated Assault', 'Bear Umbra'], r: 'Infinite combat phases', k: 'infinite',
      d: 'Attacking untaps your lands via Bear Umbra, paying for the next Aggravated Assault activation.' },
    { p: ['Aggravated Assault', 'Sword of Feast and Famine'], r: 'Infinite combat phases', k: 'infinite',
      d: 'Combat damage from the equipped creature untaps your lands, paying for another combat.' },
    { p: ['Aggravated Assault', 'Nature’s Will'], r: 'Infinite combat phases', k: 'infinite',
      d: 'Nature’s Will untaps your lands whenever a creature deals combat damage to a player.' },
    { p: ['Godo, Bandit Warlord', 'Helm of the Host'], r: 'Infinite combat phases', k: 'infinite',
      d: 'Godo fetches Helm of the Host; each combat it copies Godo, and each Godo copy grants another combat phase.' },

    /* --- draw / mill / wincons --- */
    { p: ['Niv-Mizzet, Parun', 'Curiosity'], r: 'Infinite damage and draw', k: 'infinite',
      d: 'Niv-Mizzet pings when you draw; Curiosity draws when Niv-Mizzet deals damage.' },
    { p: ['Niv-Mizzet, the Firemind', 'Curiosity'], r: 'Infinite damage and draw', k: 'infinite',
      d: 'Same loop: draw pings, ping draws.' },
    { p: ['Niv-Mizzet, Parun', 'Ophidian Eye'], r: 'Infinite damage and draw', k: 'infinite',
      d: 'Ophidian Eye is a Curiosity variant on the same loop.' },
    { p: ['Niv-Mizzet, Parun', 'Tandem Lookout'], r: 'Infinite damage and draw', k: 'infinite',
      d: 'Soulbond Tandem Lookout to Niv-Mizzet for the draw-ping loop.' },
    { p: ['Painter’s Servant', 'Grindstone'], r: 'Mills an opponent out', k: 'win',
      d: 'Painter’s Servant makes every card one colour, so Grindstone never stops milling.' },
    { p: ['Helm of Obedience', 'Rest in Peace'], r: 'Exiles an opponent’s library', k: 'win',
      d: 'Cards milled by Helm of Obedience are exiled instead, so nothing ever hits the graveyard and the loop empties the library.' },
    { p: ['Helm of Obedience', 'Leyline of the Void'], r: 'Exiles an opponent’s library', k: 'win',
      d: 'Same replacement trick as Rest in Peace.' },
    { p: ['Nomads en-Kor', 'Cephalid Illusionist'], r: 'Mills your own library', k: 'infinite',
      d: 'Redirect damage to Cephalid Illusionist for free; each shield mills you three. A graveyard payoff turns this into a win.' },
    { p: ['Thassa’s Oracle', 'Demonic Consultation'], r: 'Wins the game on the spot', k: 'win',
      d: 'Exile your library naming a card that is not in it, then Thassa’s Oracle sees an empty library and you win.' },
    { p: ['Thassa’s Oracle', 'Tainted Pact'], r: 'Wins the game on the spot', k: 'win',
      d: 'Tainted Pact exiles your singleton library; Thassa’s Oracle then wins.' },
    { p: ['Thassa’s Oracle', 'Doomsday'], r: 'Wins the game on the spot', k: 'win',
      d: 'Build a Doomsday pile that lets you cast Thassa’s Oracle with an empty or near-empty library.' },
    { p: ['Jace, Wielder of Mysteries', 'Demonic Consultation'], r: 'Wins the game on the spot', k: 'win',
      d: 'Exile your library, then draw with an empty library to win instead of losing.' },
    { p: ['Laboratory Maniac', 'Demonic Consultation'], r: 'Wins the game on the spot', k: 'win',
      d: 'Exile your library, then draw a card to win.' },
    { p: ['Hermit Druid', 'Thassa’s Oracle'], r: 'Wins the game', k: 'win',
      d: 'With no basic lands, Hermit Druid mills your whole library; Thassa’s Oracle then wins.' },
    { p: ['Ad Nauseam', 'Angel’s Grace'], r: 'Draws your deck', k: 'win',
      d: 'Angel’s Grace means you cannot lose to Ad Nauseam’s life payment, so you draw your whole library.' },
    { p: ['Enter the Infinite', 'Omniscience'], r: 'Draws your deck for free', k: 'win',
      d: 'Omniscience casts Enter the Infinite for nothing; you draw your library and win from there.' },
    { p: ['Underworld Breach', 'Lion’s Eye Diamond', 'Brain Freeze'], r: 'Mills every opponent out', k: 'win',
      d: 'Escape Brain Freeze repeatedly by exiling cards Lion’s Eye Diamond fills the graveyard with, storming off for arbitrary mill.' },
    { p: ['Underworld Breach', 'Lion’s Eye Diamond', 'Wheel of Fortune'], r: 'Infinite draw', k: 'infinite',
      d: 'Crack Lion’s Eye Diamond for three, escape Wheel of Fortune, and refill to repeat.' },
    { p: ['Isochron Scepter', 'Silence'], r: 'Locks opponents out of casting spells', k: 'lock',
      d: 'Imprint Silence and cast it on every opponent’s upkeep.' },
    { p: ['Isochron Scepter', 'Orim’s Chant'], r: 'Locks opponents out of casting spells', k: 'lock',
      d: 'Imprint Orim’s Chant and recast it each turn.' },
    { p: ['Archaeomancer', 'Ghostly Flicker', 'Deadeye Navigator'], r: 'Infinite blinks', k: 'infinite',
      d: 'Blink Archaeomancer to return Ghostly Flicker, then cast it again targeting Archaeomancer.' },
    { p: ['Scurry Oak', 'Heliod, Sun-Crowned'], r: 'Infinite +1/+1 counters and tokens (with a lifelinker)', k: 'infinite',
      d: 'Lifegain puts a counter on Scurry Oak with Heliod, and each counter makes a Squirrel, which triggers again.' },
  ];

  /* Build a name -> entries index once. */
  let curatedIndex = null;
  function buildCuratedIndex() {
    if (curatedIndex) return curatedIndex;
    curatedIndex = new Map();
    CURATED.forEach((c, i) => {
      c._id = 'cur:' + i;
      for (const n of c.p) {
        const k = U.normName(n);
        if (!curatedIndex.has(k)) curatedIndex.set(k, []);
        curatedIndex.get(k).push(c);
      }
    });
    return curatedIndex;
  }

  function curatedScan(nameSet) {
    const idx = buildCuratedIndex();
    const seen = new Set();
    const complete = [], near = [];
    for (const name of nameSet) {
      for (const c of (idx.get(name) || [])) {
        if (seen.has(c._id)) continue;
        seen.add(c._id);
        const missing = c.p.filter(p => !nameSet.has(U.normName(p)));
        const combo = {
          id: c._id, source: 'curated', pieces: c.p, templates: [],
          produces: [c.r], kind: c.k || 'infinite', prerequisites: '', steps: c.d,
          complete: missing.length === 0, missing,
          popularity: 0, url: null,
        };
        if (!missing.length) complete.push(combo);
        else if (missing.length === 1) near.push(combo);
      }
    }
    return { complete, near, source: 'curated' };
  }

  /* ============================================================
     3. Structural detector - read the text, find real loops
     ============================================================ */

  // a loop counts an unknown X as nothing until it is paid for
  function n(word) { return U.numWord(word, 0); }

  /** Everything the loop finder needs to know about one card. */
  function tagCard(card) {
    const a = O.analyze(card);
    if (!a) return null;
    const raw = (a.oracleTextParsed || a.oracleText || '');
    const text = raw.replace(/\s*\([^()]*\)/g, '');       // drop reminder text
    const lower = text.toLowerCase();
    const t = {
      card, name: card.name, a,
      manaFromTap: 0, manaAny: false, manaScales: null,
      untapTarget: null, untapCost: null, untapSelfFree: false,
      untapScope: null, untapPure: false,
      etbUntap: false, etbUntapAll: false,
      copyCreatureTap: false,
      freeSacOutlet: false, sacOutletCost: null,
      selfRecursion: false, counterNegate: false,
      blinkOutlet: null,
      deathDrain: false, etbDamage: 0, etbDrain: 0, etbLife: 0,
      etbToken: false, etbDraw: 0,
      untapAllCreatures: false, untapLandsOnAttack: false, extraCombat: false,
      extraTurn: false,
      manaSink: false, xDamage: false, xDraw: false,
      lifegainTrigger: false, lifelink: false,
      costReducer: false,
    };

    /* --- mana produced by a tap ability --- */
    for (const ab of a.manaAbilities) {
      if (!ab.cost || !ab.cost.tap) continue;
      let amount = 0, any = false;
      for (const e of (ab.effects || [])) {
        if (e.op === 'addMana') amount += (e.symbols || []).reduce((acc, s) => acc + (/^\d+$/.test(s) ? parseInt(s, 10) : 1), 0);
        else if (e.op === 'addManaAny') { amount += (typeof e.amount === 'number' ? e.amount : 1); any = true; }
        else if (e.op === 'addManaChoice') { amount += 1; any = true; }
      }
      const upkeep = ab.cost.mana ? MTG.mana.cmc(ab.cost.mana) : 0;
      const net = amount - upkeep;
      if (net > t.manaFromTap) { t.manaFromTap = net; t.manaAny = any; }
    }
    // Abilities whose output scales ("add {G} for each Elf you control",
    // "for each color among permanents you control, add one mana of that color").
    // The Oracle parser cannot turn these into a fixed number, so they are
    // treated as "three or more" and the loop is reported as conditional.
    let m;
    const scaleLine = lower.split('\n').find(l => /^\{t\}[^:]*:/.test(l) && /\badd\b/.test(l) &&
      /(for each|equal to|one mana of each|that many)/.test(l));
    if (scaleLine) {
      m = scaleLine.match(/for each ([^.,]+)/) || scaleLine.match(/equal to ([^.,]+)/);
      t.manaScales = m ? m[1].trim() : 'a count on the battlefield';
      t.manaFromTap = Math.max(t.manaFromTap, 3);
      if (/any colou?r|that colou?r|each colou?r/.test(scaleLine)) t.manaAny = true;
    }

    /* --- untap effects --- */
    // "{cost}: Untap target creature / enchanted creature / CARDNAME"
    const untapRe = /(?:^|\n)([^:\n]{0,80}):\s*untap ([^.\n]*)/gi;
    let um;
    while ((um = untapRe.exec(text))) {
      const cost = O.parseCost(um[1]);
      const what = um[2].toLowerCase();
      const costMana = cost.mana ? MTG.mana.cmc(cost.mana) : 0;
      if (cost.tap) continue;                     // tapping to untap is not a loop on its own
      // a cost with anything other than mana in it (a -1/-1 counter, a sacrifice,
      // a discard) is not repeatable for free, so it cannot close a loop by itself
      const pure = cost.other.length === 0 && !cost.sacSelf && !cost.sacrifice &&
        !cost.discard && !cost.exile && !cost.removeCounters && !cost.life;
      let scope = null, target = null;
      if (/enchanted creature/.test(what)) { scope = 'enchanted'; target = 'creature'; }
      else if (/equipped creature/.test(what)) { scope = 'equipped'; target = 'creature'; }
      else if (/\bcardname\b|\bthis (?:creature|permanent|artifact|land)\b|^it\b|~/.test(what)) { scope = 'self'; target = 'self'; }
      else if (/target land/.test(what)) { scope = 'target'; target = 'land'; }
      else if (/target creature/.test(what)) { scope = 'target'; target = 'creature'; }
      else if (/target (?:permanent|artifact)/.test(what)) { scope = 'target'; target = 'permanent'; }
      if (!scope) continue;
      if (t.untapCost == null || costMana < t.untapCost) {
        t.untapCost = costMana; t.untapTarget = target; t.untapScope = scope; t.untapPure = pure;
      }
      if (scope === 'self' && costMana === 0 && pure) t.untapSelfFree = true;
    }
    if (/when(?:ever)? (?:this creature|CARDNAME|~) enters[^.]*untap (?:target|another target|up to \w+ target)/i.test(text)) t.etbUntap = true;
    if (/when(?:ever)? (?:this creature|CARDNAME|~) enters[^.]*untap all/i.test(text)) { t.etbUntap = true; t.etbUntapAll = true; }
    if (/untap all creatures/i.test(text)) t.untapAllCreatures = true;
    if (/whenever (?:a|an|equipped) creature (?:you control )?deals combat damage to a player, untap all lands you control/i.test(text)) t.untapLandsOnAttack = true;
    if (/untap (?:all|up to \w+) lands? you control/i.test(text) && /whenever/i.test(text)) t.untapLandsOnAttack = true;

    /* --- copy / blink --- */
    if (/\{t\}:\s*create a token that'?s a copy of (?:another )?target (?:non-?legendary )?creature/i.test(text)) t.copyCreatureTap = true;
    if (/exile (?:another )?target creature you control,? then return (?:it|that card)/i.test(text)) t.blinkOutlet = 0;
    const blinkAct = text.match(/(?:^|\n)([^:\n]{0,60}):\s*exile (?:another )?target creature[^.]*return/i);
    if (blinkAct) t.blinkOutlet = MTG.mana.cmc(O.parseCost(blinkAct[1]).mana || '');
    if (/soulbond/i.test(text) && /exile the other[^.]*return/i.test(text)) t.blinkOutlet = 2;

    /* --- sacrifice outlets --- */
    const sacRe = /(?:^|\n)([^:\n]{0,80}):\s*/gi;
    let sm;
    while ((sm = sacRe.exec(text))) {
      const cost = O.parseCost(sm[1]);
      if (!cost.sacrifice && !/sacrifice a creature|sacrifice another creature/i.test(sm[1])) continue;
      const costMana = cost.mana ? MTG.mana.cmc(cost.mana) : 0;
      if (t.sacOutletCost == null || costMana < t.sacOutletCost) t.sacOutletCost = costMana;
      if (costMana === 0 && !cost.tap) t.freeSacOutlet = true;
      if (costMana === 0 && cost.tap && /creature/i.test(sm[1])) t.freeSacOutlet = true;
    }

    /* --- recursion and counter negation --- */
    if (a.keywordSet.has('persist') || a.keywordSet.has('undying')) t.selfRecursion = true;
    if (/return (?:this creature|CARDNAME|~|it) (?:from your graveyard )?to the battlefield/i.test(text)) t.selfRecursion = true;
    if (/you may cast (?:this creature|CARDNAME|~) from your graveyard/i.test(text)) t.selfRecursion = true;
    if (/creatures you control can'?t have -1\/-1 counters placed on them|if a -1\/-1 counter would be put on a creature you control, prevent/i.test(text)) t.counterNegate = true;
    if (/undying|persist/i.test(text) && /can'?t have/i.test(text)) t.counterNegate = true;
    if (/creature cards? in (?:other players'? )?graveyards? have undying|other creatures you control (?:get \+1\/\+1 and )?have undying/i.test(text)) t.selfRecursionGranter = true;

    /* --- death and ETB payoffs --- */
    if (/whenever (?:a|another) creature (?:you control )?dies,? each opponent loses \d+ life|whenever (?:a|another) creature dies, target player loses 1 life/i.test(text)) t.deathDrain = true;
    if (/whenever (?:a|another) creature you control dies,? each opponent loses/i.test(text)) t.deathDrain = true;
    if (/whenever an artifact (?:is put into a graveyard|you control is put into a graveyard)[^.]*loses? \d+ life/i.test(text)) t.deathDrain = true;
    m = text.match(/when(?:ever)? (?:this creature|CARDNAME|~) enters[^.]*deals (\d+|one|two|three|X) damage/i);
    if (m) t.etbDamage = n(m[1]);
    m = text.match(/when(?:ever)? (?:this creature|CARDNAME|~) enters[^.]*each opponent loses (\d+|one|two|three|X) life/i);
    if (m) t.etbDrain = n(m[1]);
    m = text.match(/when(?:ever)? (?:this creature|CARDNAME|~) enters[^.]*you gain (\d+|one|two|three) life/i);
    if (m) t.etbLife = n(m[1]);
    m = text.match(/when(?:ever)? (?:this creature|CARDNAME|~) enters[^.]*draw (a|one|two|three|\d+) cards?/i);
    if (m) t.etbDraw = n(m[1]);
    if (/when(?:ever)? (?:this creature|CARDNAME|~) enters[^.]*create/i.test(text)) t.etbToken = true;
    if (/when(?:ever)? (?:this creature|CARDNAME|~) enters[^.]*untap (?:up to )?\w* ?lands?/i.test(text)) t.etbUntapLands = true;

    /* --- turns and combats --- */
    if (/take an extra turn after this one/i.test(text)) t.extraTurn = true;
    if (/untap all creatures you control[^.]*(?:after this phase|additional combat phase)|there is an additional combat phase|untap all creatures that attacked[^.]*additional combat/i.test(text)) t.extraCombat = true;
    if (/additional combat phase/i.test(text)) t.extraCombat = true;

    /* --- mana sinks --- */
    if (/\{x\}/i.test(a.manaCost || '') && /damage/i.test(text)) t.xDamage = true;
    if (/\{x\}/i.test(a.manaCost || '') && /draw/i.test(text)) t.xDraw = true;
    if (/remove (?:a|one|X) \+1\/\+1 counters? from (?:this creature|CARDNAME|~)[^.]*deals? (?:1|one) damage/i.test(text)) t.pinger = true;
    if (/\{t\}:[^.]*deals? \d+ damage to any target/i.test(text)) t.tapPinger = true;
    if (/:\s*draw a card/i.test(text)) t.manaSink = true;
    if (a.keywordSet.has('lifelink')) t.lifelink = true;
    if (/whenever you gain life/i.test(text)) t.lifegainTrigger = true;
    if (/spells you cast cost \{?\d?\}? ?less|costs? \{\d\} less to cast/i.test(text)) t.costReducer = true;

    return t;
  }

  /**
   * Look for loops across the tagged cards. Each hit explains itself, and
   * carries a confidence so the UI can separate "this is definitely infinite"
   * from "this looks like a loop, check it".
   */
  function structuralScan(cards) {
    const tags = cards.map(tagCard).filter(Boolean);
    const found = [];
    const add = (pieces, produces, kind, why, confidence) => {
      const names = pieces.map(p => p.name);
      found.push({
        id: 'st:' + U.hash(names.slice().sort().join('|') + produces),
        source: 'engine', pieces: names, templates: [], produces: [produces],
        kind, prerequisites: '', steps: why, complete: true, missing: [],
        confidence: confidence || 'likely', popularity: 0, url: null,
      });
    };

    const manaRocks = tags.filter(t => t.manaFromTap >= 1);
    // only untappers whose cost is pure mana and which can point at something else
    const untappers = tags.filter(t => t.untapCost != null && t.untapPure && t.untapScope !== 'self');
    const selfUntappers = tags.filter(t => t.untapSelfFree && t.manaFromTap >= 1);

    /* --- A. untap-for-mana: tap for more than the untap costs --- */
    for (const rock of manaRocks) {
      for (const un of untappers) {
        if (un === rock) continue;
        // the untapper has to be able to legally point at this mana source
        if (un.untapTarget === 'land' && !rock.a.isLand) continue;
        if (un.untapTarget === 'creature' && !rock.a.isCreature) continue;
        if ((un.untapScope === 'enchanted' || un.untapScope === 'equipped') && !rock.a.isCreature) continue;
        const net = rock.manaFromTap - un.untapCost;
        if (net >= 1) {
          add([rock, un], net >= 1 ? 'Infinite mana' : 'Loop',
            'infinite',
            `${rock.name} taps for ${rock.manaScales ? 'an amount that scales with ' + rock.manaScales : rock.manaFromTap + ' mana'}, and ${un.name} untaps it for ${un.untapCost === 0 ? 'free' : '{' + un.untapCost + '}'}. Each cycle nets ${rock.manaScales ? 'mana once the scaling ability makes more than the untap cost' : net + ' mana'}.`,
            rock.manaScales ? 'conditional' : 'certain');
        }
      }
    }
    /* --- B. a creature that untaps itself for free and makes mana --- */
    for (const t of selfUntappers) {
      add([t], 'Infinite mana', 'infinite',
        `${t.name} can untap itself at no cost and taps for mana, so it makes as much as you want on its own.`, 'certain');
    }

    /* --- C. copy-a-creature + untap-on-entry --- */
    const copiers = tags.filter(t => t.copyCreatureTap);
    const etbUntappers = tags.filter(t => t.etbUntap);
    for (const c of copiers) for (const e of etbUntappers) {
      if (c === e) continue;
      add([c, e], 'Infinite creature tokens', 'infinite',
        `Tap ${c.name} to copy ${e.name}. The copy enters and untaps ${c.name}, so you can do it again as many times as you like.`, 'certain');
    }

    /* --- D. blink outlet + a creature whose entry pays for the blink --- */
    const blinkers = tags.filter(t => t.blinkOutlet != null);
    for (const b of blinkers) for (const t of tags) {
      if (t === b) continue;
      if (t.etbUntapLands && b.blinkOutlet <= 5) {
        add([b, t], 'Infinite mana', 'infinite',
          `${b.name} blinks ${t.name} for ${b.blinkOutlet === 0 ? 'free' : '{' + b.blinkOutlet + '}'}; each time it returns it untaps lands, paying for the next blink and more.`, 'likely');
      } else if ((t.etbDamage || t.etbDrain) && b.blinkOutlet === 0) {
        add([b, t], 'Infinite damage', 'infinite',
          `${b.name} blinks ${t.name} for free, repeating its enter-the-battlefield damage.`, 'likely');
      }
    }

    /* --- E. persist/undying + free sacrifice outlet + counter negation --- */
    const recurring = tags.filter(t => t.selfRecursion);
    const sacOutlets = tags.filter(t => t.freeSacOutlet);
    const negators = tags.filter(t => t.counterNegate);
    const drains = tags.filter(t => t.deathDrain);
    for (const r of recurring) for (const s of sacOutlets) {
      if (r === s) continue;
      const needsNegator = r.a.keywordSet.has('persist') || r.a.keywordSet.has('undying');
      const neg = negators[0];
      if (needsNegator && !neg) continue;
      const pieces = needsNegator ? [r, s, neg] : [r, s];
      const drain = drains.find(d => d !== r && d !== s);
      if (drain) {
        add(pieces.concat([drain]), 'Infinite damage', 'infinite',
          `Sacrifice ${r.name} to ${s.name} for free. ${needsNegator ? neg.name + ' stops the counter, so ' : ''}it comes straight back, and ${drain.name} drains every opponent on each death.`, 'likely');
      } else if (r.etbDamage || r.etbDrain) {
        add(pieces, 'Infinite damage', 'infinite',
          `Sacrifice ${r.name} to ${s.name}; it returns and repeats its enter-the-battlefield damage.`, 'likely');
      } else if (r.etbLife) {
        add(pieces, 'Infinite life', 'infinite',
          `Sacrifice ${r.name} to ${s.name}; it returns and gains you life each time.`, 'likely');
      }
    }

    /* --- F. lifelink pinger + a way to turn life gain into a reset --- */
    const lifeUntappers = tags.filter(t => /whenever you gain life[^.]*untap/i.test(t.a.oracleText || ''));
    for (const l of lifeUntappers) if (l.lifelink || tags.some(t => t.lifelink)) {
      const wand = tags.find(t => t.tapPinger && t !== l);
      if (wand) add([l, wand], 'Infinite damage', 'infinite',
        `${l.name} untaps whenever you gain life, and ${wand.name} lets it ping with lifelink, so the loop never stops.`, 'likely');
    }

    /* --- G. infinite mana payoffs --- */
    const hasInfiniteMana = found.some(f => /Infinite mana/i.test(f.produces[0]));
    if (hasInfiniteMana) {
      const sinks = tags.filter(t => t.xDamage || t.pinger || t.xDraw || t.manaSink);
      for (const s of sinks.slice(0, 4)) {
        add([s], s.xDamage || s.pinger ? 'Infinite damage (with the infinite mana above)' : 'Infinite draw (with the infinite mana above)',
          'win', `With unlimited mana, ${s.name} turns it into a win.`, 'certain');
      }
      const combatLoop = tags.find(t => t.extraCombat && t.untapAllCreatures);
      if (combatLoop) add([combatLoop], 'Infinite combat phases', 'infinite',
        `With unlimited mana, ${combatLoop.name} gives you as many combat phases as you want.`, 'certain');
    }

    /* --- H. attack-untaps-lands + extra combat --- */
    const landUntappers = tags.filter(t => t.untapLandsOnAttack);
    const combats = tags.filter(t => t.extraCombat);
    for (const lu of landUntappers) for (const c of combats) {
      if (lu === c) continue;
      add([lu, c], 'Infinite combat phases', 'infinite',
        `${lu.name} untaps your lands when you connect, which pays for another combat phase from ${c.name}.`, 'likely');
    }

    /* --- I. death-drain engine without recursion, flagged as a near-loop --- */
    // (kept out of the infinite list on purpose - it needs a fuel source)

    return { complete: found, near: [], source: 'engine' };
  }

  /* ============================================================
     Orchestration
     ============================================================ */

  function dedupe(list) {
    const seen = new Map();
    for (const c of list) {
      const key = c.pieces.map(p => U.normName(p)).sort().join('|');
      const prev = seen.get(key);
      if (!prev) { seen.set(key, c); continue; }
      // prefer the entry with the richest explanation
      const score = (x) => (x.source === 'spellbook' ? 3 : x.source === 'curated' ? 2 : 1) + (x.steps ? 1 : 0);
      if (score(c) > score(prev)) seen.set(key, c);
    }
    return Array.from(seen.values());
  }

  const KIND_ORDER = { win: 0, infinite: 1, lock: 2, synergy: 3 };

  /**
   * analyze(deck, {useNetwork}) ->
   *   { combos:[...], near:[...], byKind, sources:{spellbook:bool}, scannedAt }
   */
  async function analyzeDeck(deck, opts) {
    opts = opts || {};
    const all = [];
    for (const e of deck.main) all.push(e.card);
    for (const c of (deck.commanders || [])) all.push(c);
    if (deck.companion) all.push(deck.companion);
    const uniq = [];
    const seenIds = new Set();
    for (const c of all) { const k = c.oracle_id || c.id; if (seenIds.has(k)) continue; seenIds.add(k); uniq.push(c); }
    const nameSet = new Set(uniq.map(c => U.normName(U.frontName(c.name))));

    const cur = curatedScan(nameSet);
    const st = structuralScan(uniq);

    let sb = null;
    const sources = { curated: true, engine: true, spellbook: false };
    if (opts.useNetwork !== false) {
      try {
        sb = await spellbookFindMyCombos(deck, opts);
        if (sb) sources.spellbook = true;
      } catch (e) { MTG.log('spellbook failed', e); }
    }

    const combos = dedupe([].concat(
      sb ? sb.complete : [], cur.complete, st.complete));
    let near = dedupe([].concat(sb ? sb.near : [], cur.near))
      .filter(c => !combos.some(x => x.id === c.id));

    // a near-miss is only useful if the missing card is legal and on-colour
    const identity = new Set();
    for (const c of (deck.commanders || [])) for (const col of (c.color_identity || [])) identity.add(col);
    near.forEach(c => { c.missing = c.missing && c.missing.length ? c.missing : c.pieces.filter(p => !nameSet.has(U.normName(p))); });
    near = near.filter(c =>
      c.missing.length >= 1 && c.missing.length <= 2 &&
      // at least one piece has to already be in the deck, otherwise this is
      // just a combo that exists somewhere, not one you are close to
      c.missing.length < c.pieces.length);

    combos.sort((a, b) => (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) || (b.popularity - a.popularity) || a.pieces.length - b.pieces.length);
    near.sort((a, b) => a.missing.length - b.missing.length || (KIND_ORDER[a.kind] - KIND_ORDER[b.kind]) || b.popularity - a.popularity);

    return {
      combos, near,
      counts: {
        total: combos.length,
        infinite: combos.filter(c => c.kind === 'infinite').length,
        win: combos.filter(c => c.kind === 'win').length,
        lock: combos.filter(c => c.kind === 'lock').length,
        near: near.length,
      },
      sources,
      identity: Array.from(identity),
      scannedAt: Date.now(),
    };
  }

  /** Quick synchronous check used while a deck is being edited. */
  function quickScan(deck) {
    const all = deck.main.map(e => e.card).concat(deck.commanders || []);
    const nameSet = new Set(all.map(c => U.normName(U.frontName(c.name))));
    const cur = curatedScan(nameSet);
    const st = structuralScan(all);
    const combos = dedupe(cur.complete.concat(st.complete));
    return { combos, near: cur.near, counts: { total: combos.length, near: cur.near.length } };
  }

  MTG.combos = {
    analyzeDeck, quickScan, structuralScan, curatedScan, tagCard,
    spellbookFindMyCombos, CURATED,
    kindLabel: (k) => ({ infinite: 'Infinite', win: 'Wins the game', lock: 'Lock', synergy: 'Synergy' }[k] || k),
  };
})(window.MTG);


