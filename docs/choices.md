# Generic choices

When the rules engine needs a decision from a player, it puts a question on
the table as `game.pendingChoice`. Most questions used to come in one of 17
fixed shapes (`discard`, `scry`, `pickCard`, `mode` and so on), and each shape
needed its own panel in `src/12c-ui-table-ask.js`, its own click handling in
`src/12-ui-table.js`, and its own answer in `BotPlayer.doChoice`. So a rule
that wanted to ask something new had to wait for all three.

The `choose` question is the way round that. It says what is being chosen
from, how many, and what the picks must add up to. The table, the bots and
the engine's own checks all read the question itself, so a new rule can ask a
new question without new code anywhere else.

Everything about the shape lives in `src/06a-choice.js` (`MTG.choice`). That
module is plain data in and plain data out, so a question can cross the
network, sit in an undo snapshot, and be read the same way by the host, a
guest and a bot.

## The question

```js
{
  type: 'choose',
  playerId: 'A',                 // who answers
  purpose: 'conspire',           // what it is for; bots and the table may specialise on it
  prompt: 'Conspire? Tap two untapped creatures that share a colour with Burn Trail to copy it.',

  kind: 'objects',               // 'objects' | 'players' | 'options' | 'number'
  items: [ ... ],                // objects or players (see below)
  options: [ ... ],              // plain options (see below)
  number: { min: 0, max: 3, step: 1 },   // for kind 'number'

  min: 2, max: 2,                // how many picks
  optional: true,                // an empty answer is also fine ("two, or none")
  repeat: false,                 // an option may be picked more than once (options only)
  ordered: false,                // the order of the picks matters

  constraints: [ ... ],          // what the picks must add up to (see below)

  // presentation hints, none of which change what is legal
  zone: 'battlefield', reveal: false, panel: false, compact: false,
  sourceName: 'Burn Trail', sourceId: 'o42', sourceCard: { ... },
  prefer: 'best', harmful: false, default: 0, noneLabel: 'Don’t', confirmLabel: 'Tap them',
}
```

`MTG.choice.normalize(spec)` fills in every default and never changes what it
is given. The engine normalises a question before it asks it, so what is on
the table is always the full form.

### What is chosen from

| `kind`    | Picks are                   | Described by |
|-----------|-----------------------------|--------------|
| `objects` | object ids                  | `items: [{ id, name, zone, controller, owner, card, power, toughness, mv, colors, tapped, cost?, label? }]` |
| `players` | player ids                  | `items: [{ id, name, life }]` |
| `options` | indexes into `options`      | `options: [{ label, cost?, card?, weight?, i?, primary? }]` |
| `number`  | (none; the answer is a number) | `number: { min, max, step }` |

Objects can be anywhere: on the battlefield, in a hand, in a graveyard,
revealed from a library, or a spell on the stack. Each item carries what the
table needs to show it (`card`) and what constraints read (`power`, `mv`,
`colors`, `controller`, `name`, and anything else the asker adds, such as
`cost` for splice). Cards from a hidden zone may travel with the question,
because only the player answering is sent it; everyone else sees
`{ type, playerId, waiting: true }`.

The engine builds items with `game._chooseItems(objects)` and
`game._choosePlayers(players)`.

An option's `cost` is shown beside it as mana symbols, or as paw prints for
`{P}`. `weight` is a number constraints can add up. `i` is kept for an asker
that wants its own index back (the older `mode` question does).

### How many

`min` and `max` count picks. They default to one; `max` is cut down to what is
on offer (unless `repeat`), and `min` to `max`. `optional: true` means the empty
answer is legal as well as anything between `min` and `max`: that is how "tap
two creatures, or none" is said. With `repeat`, the same option can be picked
again (Season of the Burrow's "you may choose the same mode more than once");
objects and players can never be picked twice. With `ordered`, the picks are
taken in the order given.

### Constraints

Each constraint is checked against the items (or options) picked. Ceilings
are checked while a selection is being made, so the table can grey out what
would break one; floors only when the answer is sent.

| Constraint | Meaning |
|------------|---------|
| `{ kind: 'distinct', key: 'controller' }` | no two picks share this value (`key: 'name'` is "different names") |
| `{ kind: 'distinctTypes', key: 'types' }` | each pick stands for one value from its list, no two for the same one ("for each card type, a card of that type") |
| `{ kind: 'sum', key: 'power', min?, max?, label? }` | the picks' values add up to at least `min` and at most `max` |
| `{ kind: 'shareColour', with?: ['R'] }` | with `with`: each pick shares a colour with those; without: the picks share a colour with each other |
| `{ kind: 'mana', key: 'cost', base?: '{1}{R}' }` | the picks' costs, on top of `base`, can be paid (engine only; the table shows the total) |

Every constraint takes an optional `reason`, the words used when it is broken,
and an optional `label` for the running total.

### Presentation hints

* `zone` says where the things are, and `reveal: true` that whatever is chosen
  is shown to everyone (splice).
* `prompt` is the question in words, and may contain mana symbols.
  `sourceName`, `sourceId` and `sourceCard` say what is asking; `_ask` fills
  them in from the resolving effect.
* `purpose` names the question. Bots and the table may treat a purpose they
  know specially; one they do not know is answered generically.
* `panel: true` asks for objects to be laid out in a panel even when they are
  on the battlefield. `compact: true` asks for options as plain buttons.
* `prefer: 'worst'` tells a bot the picks are being given up; `harmful: true`
  that being picked is bad for what is picked; `prefer: 'min'` that a smaller
  number is better. `default` is where a number starts.
* `noneLabel` and `confirmLabel` name the buttons.

## The answer

```js
{ picks: ['o12', 'o15'] }      // objects or players
{ picks: [0, 0, 2] }           // option indexes, repeats allowed when `repeat`
{ number: 2 }                  // kind 'number'
{ picks: [...], order: [...] } // `order` may be given instead of picks when `ordered`
```

It goes to the engine as the data of a `choice` intent, like every other
answer: `{ kind: 'choice', data: { picks: [...] } }`.

## Checking answers

`MTG.choice.check(spec, answer, hooks)` returns the answer cleaned up,
`{ ok: true, picks, number, order }`, or `{ ok: false, reason }`. `hooks` is what
only the engine knows: `canPay(cost)` for a `mana` constraint, and `alive(id)`
for whether an object is still there. `game._chooseHooks(playerId)` makes them.

`resolveChoice` checks every `choose` answer. An illegal one is refused with
the reason (`game.fail(reason)`), and the question stays on the table. Two
things never hold the table up:

* when nothing legal is left to choose (what was offered has gone since), an
  empty answer is accepted;
* when a bot's answer is refused, the first legal answer is used instead.

`MTG.choice.progress(spec, picks, number)` says how a selection in progress
stands, for the table: `{ ok, reason, text }`.

`MTG.choice.solve(spec, { order, most, hooks })` finds a legal answer: the
fewest picks, or with `most` as many as fit, trying candidates in `order`. It
returns null when there is none. The engine uses it to decide whether a
question needs asking at all, bots use it as their last resort, and the test
harness uses it as the default answer.

## Asking from the engine

From inside an effect, ask with `_choose`, the generic form of `_ask`:

```js
case 'cipher': {
  const mine = this.battlefield.filter(x => x.controller === ctx.controller && (this.characteristics(x) || {}).isCreature);
  const got = this._choose({ playerId: ctx.controller, purpose: 'cipher', kind: 'objects', zone: 'battlefield',
    items: this._chooseItems(mine), min: 0, max: 1, prompt: 'Encode it on a creature you control?' });
  if (got === SUSPEND) return SUSPEND;        // waiting for the answer
  const host = got && got.picks.length ? this.obj(got.picks[0]) : null;
  ...
}
```

`_choose(spec, sub)` returns the checked answer, `SUSPEND` while it waits, or
null when nothing could be chosen (then nobody is asked). It does not ask when
there is nothing to decide: a number with one value, or "choose all of these".
Outside a resolution it answers on the spot through `_decideChoose`.

While a spell is being cast (CR 601.2b–c), ask with `_castChoose(playerId, o,
opts, spec)` from `_castChoices`. The answer can come with the cast already, in
`opts.choices[purpose]`; a bot decides on the spot; a person is asked, and the
question carries `then: { kind: 'cast', objId, opts }` so that answering it
starts the cast again with the answer added to `opts.choices`.

## The table

`choiceBuilder` hands every `choose` question to `choosePanel`. The selection
lives on the table (`this.choosing`), so the board, the panel and the big
button all see the same picks.

* Permanents on the battlefield are chosen by clicking them on the board.
  `markInteractive` marks them as candidates and picks, and the banner says
  what to click and how the picks stand. Cards in your hand that are on offer
  can be clicked there too.
* Players are chosen by clicking their life orbs (`.life-orb[data-player]`), or
  the chips in the banner for a seat whose orb is out of sight.
* Objects anywhere else are pick tiles in a panel, with copies of the same card
  sharing a tile. Options are a list (two or three short ones are just
  buttons), and a number is a stepper.
* Only the picks are kept on the client; every view is just JSON, so a guest
  over the network answers exactly as the host does.
* A question with one pick and nothing else to weigh is answered by one click.
  Otherwise the panel and the big button both confirm, and are only enabled
  when `check` would accept the answer.

`chooseBody(spec, sel, opts)` is the middle of the panel on its own; the
casting panel (`askExtras`) uses it for the generic questions that come with
a spell's extra costs (`extraCostsFor` gives them a `choose` spec), and sends
the answers with the cast as `choices`.

## Bots

`BotPlayer.doChoice` answers `choose` with `chooseGeneric`, and if that is
refused, with `MTG.choice.solve`. `chooseGeneric` first asks
`CHOOSE_PURPOSES[purpose]` (replicate, splice, conspire, cipher, paw-print
modes, choosing an opponent), and otherwise scores each candidate: what a card
or permanent is worth (`rateCard`, `permanentValue`), whose it is, and whether
being chosen is good for it (`harmful`, `prefer`). It takes what is worth
taking while the constraints allow, makes up the numbers with the least bad,
and asks `solve` when that does not make a legal answer. A number is taken at
its most unless `prefer: 'min'`. `MTG.bots.answerChoose(game, playerId, spec)`
is the same judgement for a question answered on the spot.

## The older shapes

`confirm`, `vote`, `mode` and `pickCard` are simple enough to be generic
questions. `MTG.choice.fromLegacy(ch)` says them the new way, and
`MTG.choice.legacyData(ch, answer)` turns a generic answer back into the old
one. The table shows all four with the generic renderer and still sends the
old answer shape; the engine takes either. The other shapes (combat, scry and
surveil, arranging, ordering triggers, paying) keep their own screens.

## Questions in use

| `purpose` | Kind | Asked by |
|-----------|------|----------|
| `replicate` | number | casting a spell with replicate: how many copies (CR 702.56) |
| `splice` | objects (hand) | casting an Arcane spell: which cards to splice onto it (CR 702.47) |
| `conspire` | objects (battlefield), two or none | casting a spell with conspire (CR 702.78) |
| `cipher` | objects (battlefield), up to one | a cipher spell resolving (CR 702.99) |
| `pawprint` | options, repeatable, `sum` of `weight` | "Choose up to five {P} worth of modes" (the Season cycle) |
| `effectObject` | objects (battlefield) | "Put a +1/+1 counter on a creature you control": chosen, not targeted |
| `chooseOpponent` | players | "Choose an opponent." |
| `textFrom`, `textTo` | options (`word`, `kind`; `present` on the words its text uses) | a text-changing effect resolving (CR 612): the color word, basic land type or creature type replaced, then what it becomes (Sleight of Mind, Mind Bend, Artificial Evolution). `targetId` is what is changed |
| `exchangeText` | objects (battlefield), one or none | Deadpool, Trading Card entering: the creature to exchange text boxes with |
| `confirm`, `vote`, `mode`, `pickCard` | options or objects | the older shapes, through `fromLegacy` |
