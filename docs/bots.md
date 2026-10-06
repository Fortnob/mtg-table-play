# Bots: difficulty, personality, and looking ahead

Everything here lives in `src/08-bots.js` (`MTG.bots`), with the private game
copies a bot thinks in kept in `src/06d-sim.js` (`MTG.sim`).

A bot has two dials:

- **difficulty**, 1 to 10: how strong a deck it builds and how well it plays it
  (`MTG.bots.DIFFICULTY`, labels from "Goldfish" to "Cutthroat");
- **personality**: how it likes to play, whatever its level
  (`MTG.bots.PERSONALITIES`).

## Seating a bot

A bot seat is `{ difficulty, personality }`. `personality` is optional.

```js
// building its deck (the personality leans on archetype, colours, theme and card choice)
const deck = await MTG.bots.buildBotDeck({
  formatId, difficulty: seat.difficulty, personality: seat.personality,   // personality may be undefined
  rules, rng: new MTG.RNG(seed), name,
});
deck.plan.personality;      // always set: the one asked for, or one chosen to suit the deck

// seating it at the table
runner.add(playerId, { difficulty: seat.difficulty, personality: seat.personality });
// (the old form runner.add(playerId, difficulty) still works)
```

With no personality given, the bot plays the one its deck was built with
(`deck.plan.personality`, read off the player's deck), and failing that one
that suits its deck, chosen from the game seed and the seat so it is the same
every time. A personality the lobby asks for should be passed to both calls:
the deck build and the seat.

`bot.personality` is the key it ended up with, and `bot.pers` the entry.

## Personalities

`MTG.bots.PERSONALITIES` is keyed by id; each entry has a `label` and a
one-line `blurb` for a picker, and the leans the bot uses (`deck`, `play`,
`eval`), which the UI can ignore.

| id | label | blurb |
|---|---|---|
| `aggressive` | Aggressive | Attacks at every chance, races, and points its burn at your face. |
| `cautious` | Cautious | Keeps blockers home, saves its removal for what matters, and wins the long game. |
| `value` | Engine builder | Builds around a plan and puts its engines together piece by piece. |
| `chaotic` | Chaotic | Big creatures and splashy spells; never quite does what you expect. |
| `political` | Political | At a bigger table, goes after whoever is winning and spreads its threats around. |

A picker can list them with
`Object.entries(MTG.bots.PERSONALITIES).map(([id, p]) => ({ id, label: p.label, blurb: p.blurb }))`
plus a "Surprise me" entry that passes no personality.

The leans are deliberately small next to the gap between two difficulty
levels: a Cautious level 9 is still a level 9.

### Names and faces

- `MTG.bots.nameFor(personality, rng, takenNames)` gives a name in the
  personality's style ("Mara the Reckless", "Tobin the Diplomat"), avoiding
  the names already at the table.
- `MTG.bots.avatarFor(personality, deck)` gives the card to show as the bot's
  face: `{ card }`, a card from its own deck (its commander if it has one,
  else the most on-brand card: the fastest attacker for Aggressive, the best
  answer for Cautious, the biggest creature for Chaotic, the best card for the
  others), or `{ name }`, a card name to look up when the deck has nothing that
  fits.
- `MTG.bots.personalityFor(deck, rng)` is the "suits the deck" choice, if a
  lobby wants to show the personality before the game starts.

The app currently names a bot after its deck ("Boros Aggro", "Krenko"); using
`nameFor` instead, or as a subtitle, is the lobby's call.

## Looking ahead

From level 6 up, a bot plays its candidate moves out before making one: the
spell to cast in a main phase (or to wait), the attack, the blocks. Each
candidate is made in a few private copies of the game, with the cards the bot
cannot see (other hands, every library's order) dealt afresh in each, and each
copy is played on by plain bots to the start of the turn after next and then
judged (`MTG.bots.tableScore`). The best average wins; the ordinary judgement's
own move wins a tie.

`MTG.bots.LOOKAHEAD[level]` holds the numbers: copies per candidate (desktop
and phone), how many candidates, which decisions, and a time limit per
decision.

- **Responsiveness.** Thinking gives the page a breath every 12 ms, so the
  table never freezes. The time spent thinking comes off the bot's usual
  pause, so a thinking bot is no slower to watch than one that does not.
- **Determinism.** Every copy is seeded from the bot's own dice, and a level
  plays a fixed number of copies, so the same game makes the same decisions
  every time. The time limit is a safety net that a normal decision does not
  reach; a device slow enough to reach it decides on what it has, and that is
  the only way two machines can differ. A phone (`MTG.isPhone()`) plays fewer
  copies and candidates by design, so a phone and a desktop may differ, but
  each always agrees with itself. Replays record engine calls, so they never
  depend on this.
- **Isolation.** A copy has its own random generator, says nothing (no
  events, no log, no `state` notices), and is never recorded: a replay
  recorder wraps only the game it was given.
- `bot.lastLook` describes the last look ahead (candidates, copies played,
  ms, which was picked, the average score of each), for a debug overlay.

While a bot is thinking it holds the table as it does while pausing; if the
game moves under it (an undo, a concession) it drops the thought and looks
again.

## Events

Every move a bot makes is announced as `game.emit('bot:action', { playerId,
kind, objId, name, text, at })`, as before.

## Measuring

```
node tools/botsim.js --format standard --games 10 --a 5 --b 10 --localdb
node tools/ladder.js --format standard --pairs 9-10,5-10 --games 150 --procs 14 --localdb
node tools/ladder.js --format standard --pairs 10-10 --mode skill --deckd 8 --playA '{"look":null}' --localdb
node tools/ladder.js --format commander --ds 4,6,8,10 --games 40 --localdb
```

`--localdb` builds decks from the local card database, as the app does.
`--playA`/`--playB` override a side's numbers (`{"look":null}` turns looking
ahead off; `{"personality":"cautious"}` fixes a personality). The ladder
prints, per level, how many look aheads a game took, their mean and worst
time, and how often they overruled the ordinary judgement.
