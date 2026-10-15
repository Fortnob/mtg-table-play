'use strict';
/* ============================================================
   02f-planes.js - the plane and phenomenon cards, and planar decks

   Planechase (CR 901, src/06f-planechase.js) is played with a planar deck
   beside each player's deck: at least ten plane and phenomenon cards, no
   two with the same name, no more than two phenomena (CR 901.3). The
   cards are listed here (written by tools/planes.js from Scryfall's bulk
   file: id|name|set|P for a plane, H for a phenomenon) so a planar deck
   can be checked, dealt at random or built without a search; each is
   looked up through the card cache like any other card, and read by the
   engine from its words.

   A player at a Planechase table with no planar deck, or with one the
   rules don't allow, plays with one made legal: their own cards kept as
   far as the rules allow, the rest dealt at random from the planes the
   game runs by itself (complete).
   ============================================================ */
(function (MTG) {
  const DATA = [
    /* @@DATA@@ */
    "ed4f4210-9871-4cec-9b46-100c80f93cd4|Academy at Tolaria West|opca|P",
    "6caf8b21-1807-442c-a461-c89c7591df70|Agyrem|opca|P",
    "a1c7f2eb-0654-46f9-ae3d-11efcac837b8|Akoum|opca|P",
    "ac0615cc-860a-4fed-9e9c-4377ba8ed22a|Amy's Home|who|P",
    "3cc61f60-2f9d-4f67-8390-62873b4b8ddb|Antarctic Research Base|who|P",
    "855978a6-c81c-4e5e-a34f-41a54fef0c10|Aplan Mortarium|who|P",
    "d6dc655e-d8ef-443a-bb3e-46c7ca1555ba|Aretopolis|opca|P",
    "56c735c0-9346-431b-869f-3accfa193016|Astral Arena|opca|P",
    "a068875e-9294-403d-a6db-15092b6c42d3|Bad Wolf Bay|who|P",
    "434a2d09-5776-4168-b863-f3b0a736d19b|Bant|opca|P",
    "8bb62bd5-79e5-4af0-aafd-c1bd53765c67|Besieged Viking Village|who|P",
    "9944763b-07b1-447d-b07c-b585ec00e883|Bloodhill Bastion|moc|P",
    "22e3ec5a-4bd5-452f-873a-3801253754dd|Bowie Base One|who|P",
    "d8ddc6d0-50cc-4914-a6f2-00fb93d4402a|Caught in a Parallel Universe|who|H",
    "0cf339cb-04c0-40e8-a64c-b80229a32cec|Celestine Reef|opca|P",
    "e6632cd1-aa23-46d0-8e72-0850de4873e1|Chaotic Aether|moc|H",
    "4f82f5b7-b4b9-489a-bbd7-98faaa566515|City of the Daleks|who|P",
    "ff65643b-e8bb-49d6-8887-13a146ee5174|Cliffside Market|opca|P",
    "82e09673-c7f0-4377-abbd-b1ea4922d4b3|Coal Hill School|who|P",
    "13dd9d2c-f1d3-4dbf-8101-e4fab9f42e40|Dalek Intensive Care|who|P",
    "6d241115-60b8-4fab-9877-4e2d35d638b9|Deceptive Divination|pssc|P",
    "ca4c429a-ca40-4656-aea5-86eb450e47b7|Edge of Malacol|opca|P",
    "bec61f7a-cf02-4150-aff9-9465fa14c779|Eloren Wilds|opca|P",
    "a4400c14-2aed-4018-a3fb-7de2b0456c07|Enigma Ridges|moc|P",
    "ffdf27d3-80b4-4aa1-b943-d247e502d32c|Esper|moc|P",
    "56826f4f-2bbe-464a-b023-faa83aa1c392|Fblthp: Completely, Utterly, Totally Lost|pssc|P",
    "1dde33fa-f748-43c9-9ead-9461332e9e67|Feeding Grounds|opca|P",
    "b52a233b-cc51-4f3e-94d0-a4b75ecb248e|Fields of Summer|opca|P",
    "4c2d1022-3aaa-4139-bd11-ddc18a7c9cef|Finally! Left-Handed Magic Cards|pssc|P",
    "a05478f9-3a9a-4887-a8e7-63550eaa6030|Fixed Point in Time|who|H",
    "d89133d1-06e7-4b8f-8f42-e0551fd93a5b|Furnace Layer|opca|P",
    "eb753c00-303d-49f3-ad98-b7772cc4a274|Gardens of Tranquil Repose|who|P",
    "cb03f60c-d317-4b4c-9747-380abf5fa7ef|Gavony|moc|P",
    "0c8456bd-d290-43af-b2b9-06823bab65a2|Ghirapur|moc|P",
    "fdaaef56-0c95-404a-8de5-e8f21e0282d3|Glen Elendra|opca|P",
    "a075316c-eb94-46a5-98f2-061b1674186f|Glimmervoid Basin|moc|P",
    "830c7c81-335e-4f0b-81b9-209732408093|Goldmeadow|opca|P",
    "3dfccef2-4d55-423f-8375-4e349bbf615e|Grand Ossuary|opca|P",
    "ecbe3339-2cd1-45e2-bac1-8ea995238c30|Grixis|opca|P",
    "c2cd3e28-cc48-416d-83d2-74208d2f4aa9|Grove of the Dreampods|moc|P",
    "d0ff1a68-0424-4a9d-b07e-8426a38f86a6|Happy Yargle Day!|pssc|P",
    "2588d0a3-0e63-4976-8fcc-cd6bc52b61aa|Hedron Fields of Agadeem|moc|P",
    "61471ab4-749a-40e4-b06b-153edec80daa|Horizon Boughs|opca|P",
    "8b164271-6438-4135-b7a9-8573c3921052|Hotel of Fears|who|P",
    "f5def75a-f511-42e8-a652-7de4abfbd968|Human—Time Lord Meta-Crisis|who|H",
    "f82a89a6-f558-476c-a57d-5a1e5405320a|Imaginary Friends (Plane)|pssc|P",
    "d44a959c-7a04-4342-8827-882349f786fc|Immersturm|opca|P",
    "56e4874c-9d3d-4a1c-a027-186a33ce0da7|Interplanar Tunnel|opca|H",
    "6a9b4ba6-12cb-488c-b9d5-245e094f72c3|Inys Haen|moc|P",
    "5fa27faa-f72c-4925-8ad5-c984113245bf|Isle of Vesuva|moc|P",
    "d01d1b4f-5ac5-40b0-b4ad-34ac70aeb488|Izzet Steam Maze|opca|P",
    "585fde63-4cb5-4235-8c95-2a7a511e7c3f|Jund|moc|P",
    "4c46b6c1-0c84-4bd3-b317-9b8191ad937e|Kerblam! Warehouse|who|P",
    "5271d8fd-3657-45a3-8147-00cc1d19425f|Kessig|opca|P",
    "8d63dc8a-101c-4b12-bf56-06a8a3cea64e|Ketria|moc|P",
    "f9724517-9e6b-4cb3-a3f7-ea8706f49fe9|Kharasha Foothills|moc|P",
    "93f386a5-08ce-4f76-944f-f38620a41027|Kilnspire District|opca|P",
    "86b5e553-c871-4750-a839-82b7581c5a2d|Krosa|moc|P",
    "b6078774-f681-46dd-a68e-1cefa8261d16|Lair of the Ashen Idol|opca|P",
    "45091d2b-d872-4beb-af87-7675aaf0c2c8|Lake Silencio|who|P",
    "7a049235-2fda-48a7-b46e-d150a4893397|Lethe Lake|opca|P",
    "a10f326e-51eb-44b8-9208-ee9db7e7c328|Li'l Giri Saves the Day|pssc|P",
    "2a098e3b-00e7-48d5-bc0d-f153e7cc5dfd|Littjara|moc|P",
    "00832a47-dec8-411e-9708-b3ebbd3a2dfc|Llanowar|opca|P",
    "ed9d28e4-e317-458f-a5ab-40faedc53826|Math is for Blockers (Plane)|pssc|P",
    "53f91325-e95a-4b68-9491-4249c2e940b4|Megaflora Jungle|moc|P",
    "9c155a59-afee-4821-9715-10dafb9f9d9a|Minamo|opca|P",
    "d7a2b02e-3ff2-4c71-9022-b08472f53664|Mirrored Depths|opca|P",
    "ba6728e1-12f0-40a7-90f9-520f3572b190|Mondassian Colony Ship|who|P",
    "54327aa2-319d-4430-a266-03cadeed6146|Morphic Tide|opca|H",
    "a4d3edeb-4a78-4de3-a167-4565c494ba23|Mount Keralia|opca|P",
    "46daa243-7c4e-4b0c-8ec2-e70cba8e72c3|Murasa|opca|P",
    "be4da23c-bc51-4601-8f86-4e6f4eb27e6a|Mutual Epiphany|moc|H",
    "9935490b-9bc7-48f5-9a11-59a043e346fb|Mycosynthwave|pssc|P",
    "f63b82f9-ebc4-465c-b25e-5ee710525143|Naar Isle|opca|P",
    "7ff092bb-e284-4397-a584-6a046145424b|Naktamun|moc|P",
    "15611e29-6f96-4c5c-a919-c8fe590581b0|Naya|opca|P",
    "9f4b51ac-3e56-494f-aad7-ff5b0c3ed6ed|Nephalia|opca|P",
    "e22ac94f-03a7-49ee-a059-fc123708962e|New Argive|moc|P",
    "5185dfce-d3ad-4509-b356-f6750d7c6a09|New New York|who|P",
    "20d23638-74fb-481d-a3c4-d7f5fd666211|Norn's Dominion|opca|P",
    "1a4238ce-2a8f-404f-a893-9bb8b3f26835|Norn's Seedcore|moc|P",
    "6489955c-1571-41dd-9419-5c071a8b3e30|North Pole Research Base|who|P",
    "d8da872d-55e0-4596-ba8e-f9ff7b2c0a86|Nyx|moc|P",
    "2eef332f-d47f-4bc3-b39d-572dce4997b2|Onakke Catacomb|opca|P",
    "642c9e68-4d5f-4e7f-894b-56dec4081fc7|Ood Sphere|who|P",
    "12655e0d-bb32-4aff-940a-fe14675629ca|Orochi Colony|moc|P",
    "be92be0a-e10d-478b-bc09-9cd09bfb269e|Orzhova|opca|P",
    "35add85f-a70a-497d-9a11-593325a1a4ef|Otaria|opca|P",
    "fe509cef-83e5-48d9-a9ec-e187ab65b5e0|Paliano|moc|P",
    "ecab1a2d-a47a-4572-a133-aca40384a908|Panopticon|moc|P",
    "0518b7a0-3bbb-4802-9faf-3f4256671e9e|Planewide Disaster|moc|H",
    "a549ee7a-276b-45eb-a2c7-f74c85dc6a0d|Pompeii|who|P",
    "559007a6-c515-413a-8d3c-8ce1df0742ff|Pools of Becoming|opca|P",
    "86ff49dd-9845-459e-baaf-f65126ccb648|Prahv|opca|P",
    "291478b8-a8f6-4449-8cd8-9d70484d3398|Prime Minister's Cabinet Room|who|P",
    "072c1a59-dbdc-469c-9743-e083e52b0b6d|Quicksilver Sea|opca|P",
    "de770524-9afc-4971-842a-6ee0b81176fb|Raven's Run|opca|P",
    "203c69fe-2ca5-45b2-9be8-e0443733c821|Reality Shaping|moc|H",
    "618dbae8-7e3f-47ba-8f02-292047e86a05|Riptide Island|moc|P",
    "4c20e1cd-c541-4b44-8e20-adaa45a989a2|Sanctum of Serra|opca|P",
    "0693024b-7eed-4aa5-a890-66c947db6b73|Sea of Sand|opca|P",
    "ea1537e5-b1a8-4735-acd4-9df627a8946c|Selesnya Loft Gardens|moc|P",
    "8ce18193-76d6-4357-80e3-67ab453f47ac|Shiv|opca|P",
    "b30f88bd-426a-48fb-a921-c7c5831120bd|Singing Towers of Darillium|who|P",
    "24ad1b98-17ef-4c58-a947-384ef39f1193|Skybreen|opca|P",
    "a70f7633-0851-4205-a736-3b11d4823f10|Sokenzan|moc|P",
    "ac3d5e6a-64e6-4888-915f-874109e7830a|Spatial Merging|moc|H",
    "84933e48-8b10-4ccf-a7e8-140fbb9c0c9b|Spectrox Mines|who|P",
    "eceba6df-8821-499b-b3c2-4d54c6eab257|Stairs to Infinity|opca|P",
    "c31b0240-38c7-4f0b-a851-cbfdfee9d193|Stensia|moc|P",
    "5665c85f-f564-47fe-a123-4e5a70e179d9|Stormcage Containment Facility|who|P",
    "6a8a8752-6849-4abc-9acb-bafffe685e94|Strixhaven|moc|P",
    "0ff946f3-a536-4b35-b953-e66667314afa|Stronghold Furnace|moc|P",
    "0e2d8456-6e3c-42ee-8bd4-215db5fbda98|TARDIS Bay|who|P",
    "0dadba2e-1d9a-4f04-b9d5-a3edff017662|Takenuma|opca|P",
    "09feed09-96de-4208-b6b9-cac0ec150e70|Talon Gates|opca|P",
    "18c94ada-d864-4e94-9d95-e796ab0d0cff|Tazeem|opca|P",
    "ec65904f-c0dd-45ab-a85a-af4a6a631e11|Tember City|opca|P",
    "75481e04-ab27-4fdd-b789-4a53ffc92430|Temple of Atropos|who|P",
    "d2603e7a-1b1b-4f71-81d9-7e84c766312d|Ten Wizards Mountain|moc|P",
    "a22dfe5f-82cc-4d99-b454-82157ffd6a59|The Aether Flues|moc|P",
    "de4c566d-85ef-49af-a5cb-bcfa4aaba245|The Caldaia|moc|P",
    "74560139-0870-4184-887b-72d67c57b6ed|The Cave of Skulls|who|P",
    "4b6bd680-18c6-46d9-b747-825fb0fee6dd|The Cheetah Planet|who|P",
    "0b8a0cad-92df-45a1-a3cc-561be2f06778|The Dark Barony|opca|P",
    "bf6193ea-4906-4097-8e30-431220f9e35c|The Dining Car|who|P",
    "f4c583ab-ad15-436b-9151-8b4d212cbeda|The Doctor's Childhood Barn|who|P",
    "2456bb33-6380-4b4d-bf23-7b071fc22be2|The Doctor's Tomb|who|P",
    "9fdb7dca-017a-49a7-b8de-4a8ccf7ac679|The Drum, Mining Facility|who|P",
    "501268b6-878b-4725-be1f-a64c90f79b87|The Eon Fog|opca|P",
    "fe2e52fb-4633-46c1-a48a-cde89d709e07|The Fertile Lands of Saulvinia|moc|P",
    "decef464-d1d3-4459-a1c4-fbad684d5d02|The Fourth Sphere|opca|P",
    "03a2c40d-6adb-4ad7-ba8e-3954d33f0e09|The Golden City of Orazca|moc|P",
    "4afe8c95-efeb-4f7d-834d-fa5b095c9a06|The Great Aerie|moc|P",
    "04075c37-1c1c-439c-9c54-770185fc0af1|The Great Forest|moc|P",
    "4ba7ce8f-e11d-4e06-8cb6-668de2a43a4e|The Hippodrome|opca|P",
    "c3cd9db0-b417-42e8-b3be-00fdc9330014|The Lux Foundation Library|who|P",
    "6223caca-e993-4834-a673-3eee65b8afe1|The Maelstrom|opca|P",
    "c343b9dd-edce-46ee-bdd6-f240cf061d59|The Matrix of Time|who|P",
    "b715df92-e504-4844-9d74-6f4965fd32ee|The Moonbase|who|P",
    "fd571dc7-b0b0-49a2-938a-d4336efe5e76|The Pit|moc|P",
    "8aec22c6-4986-45aa-9b6b-8517bbbaed4e|The Pyramid of Mars|who|P",
    "4a0e558d-cfd7-4ecf-b951-50016e8cc569|The Western Cloud|moc|P",
    "1fccd76c-cce9-4ae3-84c1-000e54ca4734|The Wilds|moc|P",
    "4c9dc306-92e9-46e1-a67c-d4f2a65ce339|The Zephyr Maze|opca|P",
    "ba38fb01-ea16-4a2d-964a-41f7b4d74024|Time Distortion|opca|H",
    "6d37cf73-e128-4367-b030-313d987fda7a|Towashi|moc|P",
    "f5f307bf-80ac-46cb-9003-3e70a0703e71|Trail of the Mage-Rings|opca|P",
    "bd6aa726-9979-42a5-a9ad-5c3f40b599ae|Truga Jungle|moc|P",
    "70d12cff-ba93-4673-832c-f9261c1501cd|Turri Island|moc|P",
    "40732207-291c-4cea-be87-dd4dbb8b6259|Two Streams Facility|who|P",
    "9f7ec46f-1499-4c75-8568-d9266a3d1e69|UNIT Headquarters|who|P",
    "87a6b20d-93f8-4af4-936c-11606e9efd87|Undercity Reaches|moc|P",
    "8e3c04ad-a8b5-453a-aff4-dce743b1c693|Unleash the Flux|who|H",
    "6ef8454d-1aac-4907-91cf-535ea679042c|Unyaro|moc|P",
    "450ed99e-7fb6-45d3-b043-27ff58fe8dbb|Valor's Reach|moc|P",
    "621a8224-7ea2-4ca4-be74-e460d05ad12b|Velis Vel|opca|P",
    "7514322e-a277-43db-80b4-7ee189040d32|We Hope You Like Squirrels|pssc|P",
    "27f3c16a-34f9-497d-835c-5942e395ded8|Windriddle Palaces|opca|P",
    "690ee95a-39b9-4e8e-af43-b7a133249a45|sAnS mERcY|pssc|P",
    /* @@END@@ */
  ];
  const MIN = 10, MAX_PHENOMENA = 2;

  let LIST = null;
  /** Every plane and phenomenon: { id, name, set, phenomenon }. */
  function list() {
    if (!LIST) LIST = DATA.map(r => { const [id, name, set, k] = r.split('|'); return { id, name, set, phenomenon: k === 'H' }; });
    return LIST;
  }
  const isPlanar = (c) => !!c && (c.layout === 'planar' || /^(?:Plane|Phenomenon)\b/.test(String(c.type_line || '')));
  const isPhenomenon = (c) => !!c && /^Phenomenon\b/.test(String(c.type_line || ''));
  const cardsOf = (deck) => (deck || []).map(e => (e && e.card) || e).filter(Boolean);

  /**
   * What the rules say of a planar deck (CR 901.3): [] when it may be played, else each thing wrong with it, said
   * for the deck builder.
   */
  function problems(deck) {
    const cards = cardsOf(deck);
    const out = [];
    const notPlanar = cards.filter(c => !isPlanar(c));
    if (notPlanar.length) out.push(`${notPlanar.map(c => c.name).join(', ')} ${notPlanar.length > 1 ? 'are not planes or phenomena' : 'is not a plane or a phenomenon'}.`);
    const n = cards.filter(isPlanar).length;
    if (n < MIN) out.push(`A planar deck needs at least ${MIN} cards (this one has ${n}).`);
    const seen = new Map();
    for (const c of cards) seen.set(c.name, (seen.get(c.name) || 0) + 1);
    const twice = Array.from(seen).filter(([, k]) => k > 1).map(([nm]) => nm);
    if (twice.length) out.push(`Each card in a planar deck must have a different name: ${twice.join(', ')}.`);
    const ph = cards.filter(isPhenomenon).length;
    if (ph > MAX_PHENOMENA) out.push(`No more than ${MAX_PHENOMENA} phenomena (this one has ${ph}).`);
    return out;
  }

  let ALL = null;
  /** Every plane and phenomenon as a card, looked up once (through the card cache). */
  async function cards() {
    if (ALL) return ALL;
    const { cards: got } = await MTG.scry.collection(list().map(x => ({ id: x.id })));
    ALL = got.filter(Boolean);
    return ALL;
  }

  /** The planes the game runs by itself, to deal from: every line of them automated. */
  function playable(pool) {
    return pool.filter(c => { try { const a = MTG.oracle.analyze(c); return !!(a && a.fullyAutomated); } catch (e) { return false; } });
  }

  /**
   * A legal planar deck from what a player brought (CR 901.3): their planes and phenomena kept, one of each name and
   * no more than two phenomena, and topped up to ten with planes dealt at random (`rng`: MTG.RNG) from those the game
   * runs by itself — at most one phenomenon among those dealt. `pool`: the cards to deal from (all of them, looked up,
   * when left out).
   */
  async function complete(deck, rng, pool) {
    const kept = [];
    const names = new Set();
    let ph = 0;
    for (const c of cardsOf(deck)) {
      if (!isPlanar(c) || names.has(c.name)) continue;
      if (isPhenomenon(c)) { if (ph >= MAX_PHENOMENA) continue; ph++; }
      names.add(c.name);
      kept.push(c);
    }
    if (kept.length >= MIN) return kept;
    const from = playable(pool || await cards()).filter(c => !names.has(c.name));
    const order = from.slice();
    if (rng && rng.shuffle) rng.shuffle(order);
    let dealtPh = 0;
    for (const c of order) {
      if (kept.length >= MIN) break;
      if (isPhenomenon(c)) { if (ph >= MAX_PHENOMENA || dealtPh >= 1) continue; ph++; dealtPh++; }
      names.add(c.name);
      kept.push(c);
    }
    return kept;
  }

  MTG.planes = { list, problems, cards, complete, playable, isPlanar, isPhenomenon, MIN, MAX_PHENOMENA };
})(window.MTG);
