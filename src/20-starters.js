/* ============================================================
   20-starters.js - starter decks
   Ready-made decks for a first game, or a quick one: for Standard, one
   for every pair of colours and a few in a single colour; for Modern,
   eight of the format's well-known plans. Each has a plain plan, a
   sensible curve and enough lands, and every card is one the game runs
   from start to finish. They were started by the bot deck builder at its
   top level, or from the format's own lists, and then picked through by
   hand. The menus show a format's own starters only (forFormat).

   A deck is kept as card names and counts and turned into cards when it
   is wanted, through the card cache like any other list, so it follows
   whatever the card data says today. tools/starters.js checks them all
   (every card automated, every card legal, sixty cards) and is the thing
   to run when the engine learns or loses a card.
   ============================================================ */
'use strict';
(function (MTG) {
  const LIST = [
    /* ---------------- one colour ---------------- */
    {
      id: 'w-cats', name: 'Pride of Cats', colors: ['W'], format: 'standard', cover: 'Arahbo, the First Fang',
      blurb: 'Cats that make each other bigger and gain you life. Go wide, then pounce.',
      cards: [[4, 'Savannah Lions'], [2, 'Basri, Tomorrow\'s Champion'], [2, 'Joust Through'],
        [4, 'Ajani\'s Pridemate'], [3, 'Gloryheath Lynx'], [4, 'Leonin Skyhunter'], [2, 'Helpful Hunter'], [2, 'Get Lost'],
        [3, 'Arahbo, the First Fang'], [3, 'Prideful Parent'],
        [2, 'Eager Glyphmage'], [2, 'Malamet War Scribe'], [3, 'Regal Caracal'],
        [24, 'Plains']],
    },
    {
      id: 'r-goblins', name: 'Goblin Mob', colors: ['R'], format: 'standard', cover: 'Krenko, Mob Boss',
      blurb: 'Cheap goblins and burn. Hit hard and early, before they can set up.',
      cards: [[4, 'Reckless Lackey'], [3, 'Fanatical Firebrand'], [4, 'Shock'],
        [4, 'Searslicer Goblin'], [4, 'Draconautics Engineer'], [3, 'Hexing Squelcher'], [4, 'Lightning Strike'],
        [3, 'Elder Auntie'],
        [3, 'Boneclub Berserker'], [3, 'Krenko, Mob Boss'], [2, 'Redcap Gutter-Dweller'],
        [23, 'Mountain']],
    },
    {
      id: 'g-elves', name: 'Elf Kin', colors: ['G'], format: 'standard', cover: 'Imperious Perfect',
      blurb: 'Elves that make mana and pump each other. A forest that keeps on growing.',
      cards: [[4, 'Llanowar Elves'], [3, 'Virulent Emissary'],
        [3, 'Thornweald Archer'], [3, 'Sarkhan\'s Resolve'], [3, 'Warg Tactics'],
        [4, 'Elvish Archdruid'], [4, 'Imperious Perfect'], [4, 'Thornfist Striker'],
        [3, 'Dwynen, Gilt-Leaf Daen'], [2, 'Elvish Regrower'],
        [3, 'Tajuru Pathwarden'], [2, 'Rampaging Baloths'],
        [22, 'Forest']],
    },

    /* ---------------- two colours ---------------- */
    {
      id: 'wu-skies', name: 'Azorius Skies', colors: ['W', 'U'], format: 'standard', cover: 'Empyrean Eagle',
      blurb: 'Fliers, and a lord to lead them. Take to the air and stay out of reach.',
      cards: [[4, 'Harrier Strix'], [1, 'Spectral Sailor'], [2, 'Fleeting Distraction'],
        [4, 'Leonin Skyhunter'], [3, 'Mischievous Mystic'], [2, 'Plumecreed Escort'], [3, 'Get Lost'], [2, 'Valorous Stance'],
        [4, 'Empyrean Eagle'], [2, 'Plumecreed Mentor'], [2, 'Resplendent Angel'],
        [2, 'Exemplar of Light'], [2, 'High Fae Trickster'],
        [1, 'Lyra Dawnbringer'], [2, 'Cloudblazer'],
        [4, 'Floodfarm Verge'], [3, 'Tranquil Cove'], [9, 'Plains'], [8, 'Island']],
    },
    {
      id: 'ub-shadows', name: 'Dimir Shadows', colors: ['U', 'B'], format: 'standard', cover: 'Dreadwing Scavenger',
      blurb: 'Evasive creatures backed by removal. Pick off their threats and win in the air.',
      cards: [[3, 'Spectral Sailor'],
        [3, 'Mischievous Mystic'], [2, 'Knowledge Seeker'], [2, 'Gatekeeper of Malakir'], [3, 'Bitter Triumph'],
        [2, 'Theorix Charm'], [2, 'Feed the Swarm'], [2, 'Epic Downfall'], [1, 'An Offer You Can\'t Refuse'],
        [4, 'Vampire Nighthawk'], [3, 'Dreadwing Scavenger'], [2, 'Locke Cole'],
        [2, 'Morbius the Living Vampire'], [2, 'Enduring Curiosity'],
        [2, 'Bloodthirsty Conqueror'], [1, 'Voracious Greatshark'],
        [4, 'Gloomlake Verge'], [3, 'Dismal Backwater'], [9, 'Swamp'], [8, 'Island']],
    },
    {
      id: 'br-raiders', name: 'Rakdos Raiders', colors: ['B', 'R'], format: 'standard', cover: 'Sunset Saboteur',
      blurb: 'Fast, aggressive creatures, with burn to clear the way and finish the job.',
      cards: [[3, 'Gas Guzzler'], [3, 'Reckless Lackey'], [4, 'Shock'],
        [4, 'Sunset Saboteur'], [4, 'Viashino Pyromancer'], [2, 'Boggart Cursecrafter'], [2, 'Gastal Thrillseeker'],
        [4, 'Lightning Strike'], [2, 'Stingerquill Charm'], [2, 'Bitter Triumph'],
        [3, 'Charging Strifeknight'],
        [2, 'Redcap Gutter-Dweller'], [2, 'Nova Hellkite'],
        [4, 'Blazemire Verge'], [3, 'Bloodfell Caves'], [8, 'Swamp'], [8, 'Mountain']],
    },
    {
      id: 'rg-dinosaurs', name: 'Gruul Dinosaurs', colors: ['R', 'G'], format: 'standard', cover: 'Regal Imperiosaur',
      blurb: 'Ramp into huge dinosaurs that make each other bigger, and stomp.',
      cards: [[4, 'Ixalli\'s Lorekeeper'],
        [2, 'Tyrox, Saurid Tyrant'], [3, 'Spider Manifestation'], [3, 'Lightning Strike'], [2, 'Abrade'], [2, 'Konstrari Charm'],
        [4, 'Regal Imperiosaur'], [3, 'Giant Cindermaw'], [2, 'Scytheclaw Raptor'], [2, 'Thrashing Brontodon'],
        [3, 'Hulking Raptor'], [2, 'Colossadactyl'],
        [2, 'Panicked Altisaur'], [2, 'Earthshaker Dreadmaw'],
        [4, 'Thornspire Verge'], [3, 'Rugged Highlands'], [9, 'Forest'], [8, 'Mountain']],
    },
    {
      id: 'gw-tokens', name: 'Selesnya Tokens', colors: ['G', 'W'], format: 'standard', cover: 'Sandstorm Salvager',
      blurb: 'Fill the board with creature tokens, then make them all stronger at once.',
      cards: [[3, 'Stampeding Scurryfoot'],
        [3, 'Tender Wildguide'], [2, 'Burrowguard Mentor'], [2, 'Get Lost'], [2, 'Anthem of Champions'],
        [4, 'Sandstorm Salvager'], [2, 'Caretaker\'s Talent'], [3, 'Oltec Matterweaver'], [2, 'Prideful Parent'],
        [2, 'Sentinel of the Nameless City'], [2, 'United Front'],
        [3, 'Okoye, Dora Milaje Leader'], [2, 'Warren Warleader'],
        [2, 'Exalted Sunborn'], [1, 'Elspeth, Storm Slayer'], [1, 'Rampaging Baloths'],
        [4, 'Hushwood Verge'], [3, 'Blossoming Sands'], [9, 'Plains'], [8, 'Forest']],
    },
    {
      id: 'wb-lifelink', name: 'Orzhov Lifelink', colors: ['W', 'B'], format: 'standard', cover: 'Resplendent Angel',
      blurb: 'Lifelink creatures, and angels that grow every time you gain life.',
      cards: [[3, 'Sun-Blessed Healer'], [4, 'Ajani\'s Pridemate'], [3, 'Nullpriest of Oblivion'], [2, 'Starscape Cleric'],
        [2, 'Get Lost'], [2, 'Silverquill Charm'],
        [3, 'Vampire Nighthawk'], [2, 'Resplendent Angel'], [2, 'Lyra, Archangel of Dawn'], [2, 'Angel of Vitality'],
        [2, 'Aerith Gainsborough'], [2, 'Imperious Inkmage'], [2, 'Mortify'],
        [2, 'Exemplar of Light'],
        [2, 'Bloodthirsty Conqueror'], [1, 'Lyra Dawnbringer'],
        [4, 'Bleachbone Verge'], [3, 'Scoured Barrens'], [10, 'Plains'], [7, 'Swamp']],
    },
    {
      id: 'ur-spells', name: 'Izzet Spellslingers', colors: ['U', 'R'], format: 'standard', cover: 'Stormsplitter',
      blurb: 'Creatures that power up whenever you cast an instant or sorcery, and plenty to cast.',
      cards: [[4, 'Shock'], [2, 'Fleeting Distraction'], [1, 'Spectral Sailor'],
        [3, 'Kitsa, Otterball Elite'], [3, 'Heartfire Immolator'], [3, 'Lightning Strike'], [2, 'Vibrant Outburst'], [2, 'Balmor, Battlemage Captain'],
        [3, 'Frolicking Familiar'], [2, 'Guttersnipe'], [2, 'Broadside Barrage'], [2, 'Traumatic Critique'], [1, 'Tweeze'], [2, 'Frostbite Pyromental'],
        [2, 'Stormsplitter'], [2, 'Stadium Tidalmage'],
        [1, 'Archmage of Runes'],
        [4, 'Riverpyre Verge'], [3, 'Swiftwater Cliffs'], [8, 'Island'], [8, 'Mountain']],
    },
    {
      id: 'bg-deathtouch', name: 'Golgari Deathtouch', colors: ['B', 'G'], format: 'standard', cover: 'Axebane Ferox',
      blurb: 'Deathtouch and reach: every block is a bad trade for them. Grind them down with removal.',
      cards: [[2, 'Virulent Emissary'], [2, 'Radioactive Spider'],
        [3, 'Kraul Whipcracker'], [3, 'Vinereap Mentor'], [2, 'Noxious Newt'], [3, 'Bitter Triumph'], [2, 'Assassin\'s Trophy'], [2, 'Feed the Swarm'], [1, 'Witherbloom Charm'],
        [2, 'The Serpent Society'], [3, 'Vampire Nighthawk'], [2, 'Primal Witchstalker'], [2, 'Scrapshooter'],
        [2, 'Axebane Ferox'], [2, 'Pestbrood Sloth'],
        [2, 'Large Bear'], [1, 'Balustrade Wurm'],
        [4, 'Wastewood Verge'], [3, 'Jungle Hollow'], [9, 'Forest'], [8, 'Swamp']],
    },
    {
      id: 'rw-charge', name: 'Boros Charge', colors: ['R', 'W'], format: 'standard', cover: 'Basri, Tomorrow\'s Champion',
      blurb: 'Cheap attackers and burn. Attack every turn and finish them with Lightning Helix.',
      cards: [[3, 'Basri, Tomorrow\'s Champion'], [4, 'Savannah Lions'], [3, 'Shock'],
        [3, 'Viashino Pyromancer'], [3, 'Dog Walker'], [2, 'Sun-Blessed Healer'], [2, 'Tyrox, Saurid Tyrant'],
        [4, 'Lightning Helix'], [2, 'Boros Charm'], [2, 'Lightning Strike'], [2, 'Frontline Rush'],
        [3, 'Charging Strifeknight'],
        [2, 'Warren Warleader'], [2, 'Wartime Protestors'],
        [4, 'Sunbillow Verge'], [3, 'Wind-Scarred Crag'], [8, 'Plains'], [8, 'Mountain']],
    },
    {
      id: 'gu-ramp', name: 'Simic Ramp', colors: ['G', 'U'], format: 'standard', cover: 'Ambling Stormshell',
      blurb: 'Mana creatures first, then sea monsters and wurms far bigger than anything they have.',
      cards: [[4, 'Llanowar Elves'],
        [3, 'Hermitic Herbalist'], [2, 'Pond Prophet'], [2, 'Biomechan Engineer'], [2, 'Druid of the Cowl'], [2, 'Pawpatch Formation'], [2, 'Wild Hypothesis'],
        [2, 'Scrapshooter'], [2, 'Simulacrum Shaper'],
        [2, 'Ouroboroid'], [2, 'Colossal Rattlewurm'], [2, 'Tempest Hart'], [1, 'Enduring Curiosity'],
        [2, 'Ambling Stormshell'], [1, 'The Unagi of Kyoshi Island'],
        [2, 'Fractal Mascot'], [2, 'Rampaging Baloths'], [1, 'Koma, World-Eater'],
        [4, 'Willowrush Verge'], [3, 'Thornwood Falls'], [10, 'Forest'], [7, 'Island']],
    },

    /* ---------------- Modern ----------------
       The older, deeper pool: shock lands and fetch lands where a deck
       wants them, and the cards the format is known for. */
    {
      id: 'm-burn', name: 'Burn', colors: ['R'], format: 'modern', cover: 'Lightning Bolt',
      blurb: 'Hasty goblins and a fistful of bolts. Twenty damage, as fast as it will go.',
      cards: [[4, 'Goblin Guide'], [4, 'Monastery Swiftspear'], [2, 'Ragavan, Nimble Pilferer'], [4, 'Lightning Bolt'],
        [4, 'Lava Spike'], [4, 'Burst Lightning'],
        [4, 'Eidolon of the Great Revel'], [4, 'Searing Spear'], [2, 'Viashino Pyromancer'],
        [4, 'Rift Bolt'], [2, 'Goblin Rabblemaster'], [2, 'Magma Jet'],
        [20, 'Mountain']],
    },
    {
      id: 'm-affinity', name: 'Affinity', colors: ['U'], format: 'modern', cover: 'Master of Etherium',
      blurb: 'Free robots, then bigger robots. Empty your hand onto the table by turn three.',
      cards: [[4, 'Memnite'], [4, 'Ornithopter'], [2, 'Mox Opal'],
        [4, 'Steel Overseer'], [4, 'Etherium Sculptor'], [3, 'Arcbound Ravager'],
        [4, 'Master of Etherium'], [4, 'Frogmite'], [4, 'Myr Enforcer'],
        [3, 'Thought Monitor'], [2, 'Thoughtcast'], [2, 'Somber Hoverguard'],
        [4, 'Darksteel Citadel'], [2, 'Inkmoth Nexus'], [14, 'Island']],
    },
    {
      id: 'm-elves', name: 'Modern Elves', colors: ['G'], format: 'modern', cover: 'Elvish Archdruid',
      blurb: 'A turn-one elf, then a dozen more. Make silly amounts of mana and trample over.',
      cards: [[4, 'Llanowar Elves'], [4, 'Elvish Mystic'], [4, 'Nettle Sentinel'], [2, 'Heritage Druid'],
        [4, 'Dwynen\'s Elite'], [3, 'Elvish Visionary'], [3, 'Priest of Titania'],
        [4, 'Elvish Archdruid'], [4, 'Imperious Perfect'], [2, 'Elvish Harbinger'],
        [2, 'Lys Alana Huntmaster'], [2, 'Masked Admirers'], [2, 'Craterhoof Behemoth'],
        [1, 'Pendelhaven'], [19, 'Forest']],
    },
    {
      id: 'm-spirits', name: 'Spirit Squadron', colors: ['W', 'U'], format: 'modern', cover: 'Drogskol Captain',
      blurb: 'Ghostly fliers under two captains, and a counterspell when it matters.',
      cards: [[4, 'Spectral Sailor'], [4, 'Path to Exile'],
        [4, 'Supreme Phantom'], [3, 'Selfless Spirit'], [2, 'Rattlechains'], [2, 'Shacklegeist'], [2, 'Mana Leak'],
        [4, 'Drogskol Captain'], [4, 'Empyrean Eagle'], [2, 'Spectral Procession'], [2, 'Nebelgast Herald'], [2, 'Brazen Borrower'],
        [3, 'Restoration Angel'], [1, 'Lyra Dawnbringer'],
        [4, 'Hallowed Fountain'], [4, 'Glacial Fortress'], [2, 'Moorland Haunt'], [5, 'Plains'], [6, 'Island']],
    },
    {
      id: 'm-jund', name: 'Jund', colors: ['B', 'R', 'G'], format: 'modern', cover: 'Tarmogoyf',
      blurb: 'Kill their best creature, then their next one, and win with whatever is left.',
      cards: [[4, 'Lightning Bolt'], [2, 'Bloodchief\'s Thirst'],
        [4, 'Tarmogoyf'], [3, 'Scavenging Ooze'], [2, 'Bloodtithe Harvester'], [3, 'Terminate'], [2, 'Abrupt Decay'],
        [2, 'Kolaghan\'s Command'], [2, 'Tireless Tracker'], [2, 'Courser of Kruphix'],
        [4, 'Bloodbraid Elf'], [2, 'Chandra, Torch of Defiance'], [2, 'Ravenous Chupacabra'], [1, 'Thrun, the Last Troll'],
        [2, 'Thragtusk'],
        [2, 'Verdant Catacombs'], [2, 'Overgrown Tomb'], [2, 'Blood Crypt'], [1, 'Stomping Ground'], [2, 'Blooming Marsh'],
        [2, 'Woodland Cemetery'], [2, 'Dragonskull Summit'], [2, 'Rootbound Crag'], [4, 'Forest'], [2, 'Swamp'], [2, 'Mountain']],
    },
    {
      id: 'm-faeries', name: 'Dimir Faeries', colors: ['U', 'B'], format: 'modern', cover: 'Bitterblossom',
      blurb: 'Little fliers, flash and counterspells. Play on their turn and nibble them to death.',
      cards: [[3, 'Faerie Seer'], [2, 'Thoughtseize'], [3, 'Bloodchief\'s Thirst'], [2, 'Consider'],
        [3, 'Bitterblossom'], [3, 'Faerie Mastermind'], [3, 'Ledger Shredder'], [3, 'Orcish Bowmasters'], [3, 'Counterspell'], [2, 'Hypnotic Sprite'],
        [3, 'Brazen Borrower'], [2, 'Scion of Oona'], [2, 'Hero\'s Downfall'],
        [2, 'Ninja of the Deep Hours'], [2, 'Sheoldred, the Apocalypse'],
        [4, 'Watery Grave'], [4, 'Darkslick Shores'], [2, 'Drowned Catacomb'], [2, 'Sunken Hollow'], [5, 'Island'], [5, 'Swamp']],
    },
    {
      id: 'm-tokens', name: 'Boros Legion', colors: ['R', 'W'], format: 'modern', cover: 'Hero of Bladehold',
      blurb: 'Spirits, goblins and soldiers by the handful, then an anthem to make them count.',
      cards: [[3, 'Path to Exile'], [3, 'Lightning Bolt'],
        [3, 'Raise the Alarm'], [3, 'Intangible Virtue'], [2, 'Honor of the Pure'], [3, 'Lightning Helix'],
        [4, 'Spectral Procession'], [4, 'Hordeling Outburst'], [3, 'Adeline, Resplendent Cathar'], [2, 'Brimaz, King of Oreskos'],
        [3, 'Hero of Bladehold'], [2, 'Pia and Kiran Nalaar'], [2, 'Battle Screech'],
        [4, 'Sacred Foundry'], [4, 'Inspiring Vantage'], [2, 'Clifftop Retreat'], [10, 'Plains'], [3, 'Mountain']],
    },
    {
      id: 'm-ramp', name: 'Simic Titans', colors: ['G', 'U'], format: 'modern', cover: 'Primeval Titan',
      blurb: 'Grow your lands two at a time, then drop something far too big to answer.',
      cards: [[4, 'Llanowar Elves'],
        [4, 'Sakura-Tribe Elder'], [4, 'Growth Spiral'], [3, 'Coiling Oracle'], [2, 'Sylvan Caryatid'],
        [3, 'Wood Elves'],
        [2, 'Oracle of Mul Daya'], [2, 'Mystic Snake'],
        [3, 'Thragtusk'], [2, 'Mulldrifter'],
        [2, 'Primeval Titan'], [2, 'Carnage Tyrant'],
        [2, 'Simic Sky Swallower'], [1, 'Avenger of Zendikar'],
        [4, 'Breeding Pool'], [4, 'Hinterland Harbor'], [2, 'Botanical Sanctum'], [2, 'Yavimaya Coast'], [8, 'Forest'], [4, 'Island']],
    },
  ];

  const byId = new Map(LIST.map(s => [s.id, s]));
  const built = new Map();        // id -> Promise<deck>

  /**
   * A starter as a deck: the cards looked up by name, through the card
   * cache, and the cover chosen. Built once per visit; a failed lookup is
   * forgotten so it can be tried again.
   */
  function build(id) {
    const s = byId.get(id);
    if (!s) return Promise.reject(new Error('No starter deck called ' + id + '.'));
    if (built.has(id)) return built.get(id);
    const p = (async () => {
      const { cards } = await MTG.scry.collection(s.cards.map(([, name]) => ({ name })));
      const main = [];
      const missing = [];
      s.cards.forEach(([qty, name], i) => {
        if (cards[i]) main.push({ card: cards[i], qty });
        else missing.push(name);
      });
      if (missing.length) throw new Error('Could not find ' + missing.join(', ') + '. Scryfall may be unreachable.');
      const cover = main.map(e => e.card).find(c => c.name === s.cover);
      return {
        id: 'starter-' + s.id, name: s.name, format: s.format,
        main, sideboard: [], commanders: [], companion: null,
        colors: s.colors.slice(), source: 'starter', starter: s.id,
        cover: cover ? (cover.oracle_id || cover.id) : null,
      };
    })();
    built.set(id, p);
    p.catch(() => built.delete(id));
    return p;
  }

  /** A copy of the deck for your own decks: a fresh id, so editing it never touches the starter. */
  async function copy(id) {
    const d = await build(id);
    return Object.assign({}, d, {
      id: MTG.uid('deck'), source: 'starter',
      main: d.main.map(e => ({ card: e.card, qty: e.qty })), sideboard: [], commanders: [],
    });
  }

  MTG.starters = {
    list: LIST,
    get: (id) => byId.get(id) || null,
    /** The starters that play in a format. */
    forFormat: (fmtId) => LIST.filter(s => s.format === fmtId),
    build,
    copy,
  };
})(window.MTG);
