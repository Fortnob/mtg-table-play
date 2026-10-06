# MTG Table

A Magic: The Gathering table that runs in the browser: play against bots
or, peer to peer, against friends, with card data and art from Scryfall.
The whole app is one file, `index.html`.

## Build and run

```
python tools/build.py                       # src/ -> index.html
python -m http.server 8765                  # then open http://localhost:8765/
```

`index.html` is generated: edit `src/`, never `index.html` or
`original.html`.

## Test

```
npm ci                                      # TypeScript, for the type check
python tools/fetch-bulk.py                  # Scryfall's card file, into tools/
python tools/check.py --quick               # everything, briefly (a few minutes)
python tools/check.py                       # everything, at length
```

`check.py` builds, syntax-checks the bundled script, runs the card tests,
a smoke run over automated cards, bot-vs-bot games (standard, pauper,
four-player commander), a bot game at browser pacing, the runtime contract
checks and the type check, and exits non-zero if any fail. `--only
cardtest,types` runs some of them.

Card tests and the smoke run read only the bulk file. The bots build their
decks from Scryfall searches, cached in `tools/.cache`; with a cache present
the check runs offline, and `--online` fetches what is missing, two
requests a second as Scryfall asks. CI (`.github/workflows/check.yml`) runs
the quick check online, keeping the cache between runs.

The tools can be run on their own too; each says how at the top of the file:

| tool | what it does |
|---|---|
| `tools/cardtest.js [filter]` | behaviour tests for single cards (`tools/cardtests/`) |
| `tools/smoke.js --from N --to M` | plays every automated card and reports what breaks |
| `tools/sim.js` | bot-vs-bot games (`--players 4`, `--contracts`) |
| `tools/botsim.js`, `tools/ladder.js` | bot strength by difficulty, browser pacing (`--speed 300`) |
| `tools/contracts.js` | runtime checks of views, questions, intents and net messages |
| `tools/coverage.js` | how much of the card pool the engine runs by itself |

`OFFLINE=1` keeps any of them off the network; `CONTRACTS=1` makes
`cardtest.js` and `smoke.js` check every view and question as well;
`FETCH_LOG=1` lists live Scryfall requests.

## Where things live

| | |
|---|---|
| `src/*.js` | plain scripts, each hanging its part off `window.MTG`, joined in `src/order.json` order |
| `src/00-core.js` | helpers, settings, mana, the event bus |
| `src/02-scryfall.js` | Scryfall client and its IndexedDB cache |
| `src/03-oracle.js`, `src/18-scripts.js` | reading rules text into effects; hand-written scripts for cards the reader gets wrong |
| `src/06-rules.js` | the game engine: turns, priority, the stack, combat, effects, `viewFor` |
| `src/08-bots.js` | bot deck building and play |
| `src/09-net.js` | peer-to-peer play (PeerJS); the host runs the game and sends each player their own view |
| `src/1x-ui-*.js` | the screens; `12-ui-table*.js` is the game table |
| `src/14-app.js` | screens, sessions, and `handleIntent`, where the table's intents reach the engine |
| `src/types.d.ts` | types for the view, questions, intents and net messages (type check only, not bundled) |
| `src/*.css`, `src/styles.json` | stylesheets, in order |
| `tools/` | build, checks and headless tools (`tools/engine.js` loads the engine into Node) |
