# tools

Headless tools for building, testing and measuring the table. Most read the
engine straight from `src/` (see `engine.js`) and Scryfall's oracle-cards
bulk file (`oracle-cards.jsonl.gz`, fetched by `fetch-bulk.py`). Run them
with `OFFLINE=1` to stay off the network.

| tool | what it does |
| --- | --- |
| `check.py` | everything below in one go (`--quick` for the short run) |
| `coverage.js` | share of cards the engine runs without a person, by format and popularity |
| `cardtest.js` | behaviour tests in `cardtests/` |
| `smoke.js` | plays every automated card once (`--generated` for every card using a translated line) |
| `sim.js`, `botsim.js` | bot games |
| `limited.js` | a booster draft, sealed or Jumpstart among bots, then games between their decks |
| `dumpauto.js`, `opaudit.js`, `misses.js` | what the parser made of cards, and what it could not |
| `langtest.js` | card pictures in another language, against a made-up Scryfall |
| `accesstest.js` | the table by keyboard and screen reader: what is read out, the labels, the keys |
| `lessontest.js` | the tutorials, each played through the right way and the wrong ways |
| `tutorialtest.js` | the first-game walkthrough on a real table on a pretend DOM: lands tapped by hand, then by the game, and your own setting back after; hiding the Tutorials; what a tutorial's result offers |
| `xmage/` | the XMage translator, below |
| `socialtest.js` | friends, invites, trades and moving a save: devices against a pretend PeerJS broker, and their windows clicked through on a pretend DOM (`fakedom.js`) |
| `tournamenttest.js` | friends tournaments: Swiss pairing and the standings on their own, whole tournaments between devices (hostile messages and apps closed part way included), the windows on the pretend DOM; and the draft that waits for every deck |

## xmage/: card scripts translated from XMage

`src/19-cardlib.js` is generated from [XMage](https://github.com/magefree/mage)'s
card implementations. XMage builds each card out of framework objects
(abilities, effects, targets, costs, conditions); the translator reads those
constructors and writes the same behaviour in this engine's vocabulary, one
printed line at a time. The game uses a translated line only where its own
text parser could not read that line.

XMage is MIT licensed, Copyright (c) 2010 BetaSteward and the XMage authors.
Its sources are not part of this repository: they are a sparse, shallow clone
in `vendor/xmage/` (`Mage.Sets/src/mage/cards`, `Mage/src/main/java/mage` and
`Mage.Tests/src/test/java/org/mage/test/cards`).

Re-running it:

```
node tools/xmage/build.js --write          # translate, verify, write src/19-cardlib.js and xmage/blockers.json
node tools/xmage/build.js --compare        # also translate lines the parser reads, and compare (tools/out/xmage-compare.json)
node tools/xmage/build.js --card "Name"    # one card, printing what was written
node tools/xmage/why.js "Name"             # how a card's XMage class lines up with its printed lines
node tools/xmage/diffs.js [pattern]        # summarise the --compare differences
node tools/xmage/sig.js ClassName ...      # the constructors of XMage framework classes
node tools/smoke.js --generated            # play every card that uses a translated line
```

How it fits together:

- `java.js` reads Java source: types, fields, constructors, expressions.
  Method bodies nobody reads are skipped by matching braces.
- `model.js` runs a card's constructor symbolically: every `new Foo(...)`
  becomes an object that remembers its class, arguments and the calls made on
  it. Classes the card file declares itself are marked `custom`.
- `framework.js` indexes the framework classes (what each extends), cached in
  `tools/.cache/xmage-framework.json`.
- `align.js` matches each ability to the printed line it implements, using
  the comment XMage writes above it and the order of the code.
- `tr/` holds one translator per XMage class: `filters.js` (filters and
  predicates, into target specs, scopes and trigger subjects), `parts.js`
  (targets, numbers, conditions, costs, counters, tokens), `effects.js`,
  `abilities.js`. A class with no translator is a blocker.
- `verify.js` checks each translated line against the printed words: kind of
  ability, number of targets, the numbers, "may", conditions, durations.
- `pack.js` writes the packed table.
- `blockers.json` ranks what stops the most lines, weighted by popularity
  (Standard's most-played first); `build.js` prints the top of it.
