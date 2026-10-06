/* The event stream, checked against the game it describes.

   node tools/eventcheck.js [--games 6] [--players 2] [--format standard] [--seed 1]

   For bot games played headless, after every change:

   - Nothing hidden leaks. Every event each player is handed is checked
     against what that player may know: no card data for a card going into
     a library, or into somebody else's hand, or face down to a player who
     may not look at it.
   - The events add up. Following the zone events alone, every object ends
     up in the zone the engine says it is in, and every player's life total
     is the sum of their life events. */
'use strict';
const { load } = require('./engine');
const { playOne } = require('./sim');

function args() {
  const a = { games: 6, players: 2, format: 'standard', seed: 1, turns: 40 };
  const v = process.argv.slice(2);
  for (let i = 0; i < v.length; i++) {
    const k = v[i].replace(/^--/, '');
    const val = v[++i];
    a[k] = isNaN(Number(val)) ? val : Number(val);
  }
  return a;
}

async function main() {
  const a = args();
  const MTG = load();
  let leaks = 0, drift = 0, events = 0;
  for (let i = 0; i < a.games; i++) {
    const problems = [], stale = [];
    const r = await playOne(MTG, {
      formatId: a.format, seed: a.seed + i, diffA: 5, diffB: 5, maxTurns: a.turns, players: a.players, keepGame: true,
      onGame: (g) => {
        const seen = {};
        const zoneOf = new Map();          // what the zone events say, per object
        const life = {};
        g.on('state', () => {
          for (const p of g.players) {
            const list = g.eventsFor(p.id, seen[p.id]);
            seen[p.id] = g.eventSeq;
            if (!list) continue;
            for (const e of list) {
              events++;
              const card = e.card;
              if (e.type === 'zone' && card) {
                if (e.to === 'library') problems.push(`${p.id} told card of ${e.objId} going into a library`);
                if (e.to === 'hand' && (e.toOwner || e.owner) !== p.id) problems.push(`${p.id} told card of ${e.objId} going into ${e.toOwner}'s hand`);
                if (e.faceDown && p.id !== (e.to === 'battlefield' || e.to === 'stack' ? e.controller : e.owner)) problems.push(`${p.id} told face-down ${e.objId}`);
              }
              if ((e.type === 'enter' || e.type === 'token' || e.type === 'leave' || e.type === 'cast') && e.faceDown && card && p.id !== e.controller) {
                problems.push(`${p.id} told face-down ${e.type} ${e.objId}`);
              }
            }
          }
        });
        g.on('event', (e) => {
          if (e.type === 'zone') zoneOf.set(e.objId, e.to);
          if (e.type === 'life') life[e.player] = (life[e.player] || 0) + e.delta;
        });
        g._check = () => {
          /* Where an object is, is which list it is in: that is what every
             view shows. (An object's own zone field can disagree, when an
             effect moved it without saying so; that is reported apart.) */
          const where = g._evWhere();
          for (const o of g.objects.values()) {
            const said = zoneOf.get(o.id);
            if (said === undefined) continue;
            const w = where.get(o.id);
            const is = w ? w.slice(0, w.indexOf('|')) : null;
            if (is && said !== is) problems.push(`${o.id} ${o.name}: events say ${said}, it is in ${is}`);
            if (is && o.zone !== is) stale.push(`${o.id} ${o.name} is in ${is} but says ${o.zone}`);
          }
          for (const p of g.players) {
            const want = p.life - g.config.startingLife;
            if ((life[p.id] || 0) !== want) problems.push(`${p.id} life events add to ${life[p.id] || 0}, life moved ${want}`);
          }
        };
      },
    });
    r.game._check();
    const leak = problems.filter(x => /told/.test(x)).length;
    leaks += leak; drift += problems.length - leak;
    console.log(`game ${i + 1}: turns=${r.turns} events=${r.game.eventSeq} problems=${problems.length}`);
    for (const x of problems.slice(0, 6)) console.log('   ' + x);
    for (const x of stale.slice(0, 3)) console.log('   (engine) ' + x);
  }
  console.log('summary', JSON.stringify({ games: a.games, players: a.players, eventsHandedOut: events, leaks, drift }));
  process.exit(leaks || drift ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(1); });
