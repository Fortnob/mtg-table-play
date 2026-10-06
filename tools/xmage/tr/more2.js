/* Sagas, characteristic-defining power and toughness, delayed triggers,
   and looking at the top of the library. */
'use strict';
const { def, tr, block, kindOf, A, calls, keyOf, litOf } = require('./core');
const F = require('./filters');
const P = require('./parts');
const E = require('./effects');
const AB = require('./abilities');

/* ---------------- Saga chapters ----------------
   A SagaAbility is one object with a call per chapter; each call is
   lined up with its own printed line ("I — ...") and translated alone. */

const ROMAN = { CHAPTER_I: 1, CHAPTER_II: 2, CHAPTER_III: 3, CHAPTER_IV: 4, CHAPTER_V: 5, CHAPTER_VI: 6 };

/** One addChapterEffect call -> a chapter ability. */
function chapter(call, tc) {
  const args = call.args.filter(a => a.t !== 'this' && a.t !== 'face');
  const ch = args.filter(a => a && a.t === 'ref' && /^SagaChapter\./.test(a.path)).map(a => ROMAN[a.path.split('.')[1]]);
  if (!ch.length || ch.some(x => !x)) block('saga chapter');
  const from = ch[0], to = ch[ch.length - 1];
  const chapters = [];
  for (let k = from; k <= to; k++) chapters.push(k);
  const rest = args.filter(a => !(a && a.t === 'ref' && /^SagaChapter\./.test(a.path)));
  const effects = [], targets = [];
  for (const a of rest) {
    const k = kindOf(a);
    if (k === 'effect' || k === 'custom') effects.push(a);
    else if (a.t === 'obj' && a.cls === 'Effects') effects.push(...a.args);
    else if (k === 'target') targets.push(a);
    else if (k === 'bool') { if (a.v) block('optional chapter'); }
    else if (a.t === 'lambdaAbility') {
      for (const c of a.obj.calls) {
        if (c.name === 'addEffect') effects.push(c.args[0]);
        else if (c.name === 'addTarget') targets.push(c.args[0]);
        else if (!/^(?:withFlavorWord|addHint|setAbilityWord)$/.test(c.name)) block('chapter lambda .' + c.name);
      }
    }
    else block('chapter argument ' + k);
  }
  if (!effects.length) block('chapter with no effect');
  tc.kind = 'chapter';
  const body = AB.body(effects[0], { effects: effects.slice(1), targets }, tc);
  return { kind: 'chapter', chapters, effects: body, auto: true };
}

/* ---------------- characteristic-defining power and toughness ---------------- */

def('effect', ['SetBasePowerToughnessSourceEffect', 'SetBasePowerSourceEffect', 'SetBaseToughnessSourceEffect'], (o, tc) => {
  E.checkCalls(o);
  const vals = o.args.filter(a => ['int', 'value'].includes(kindOf(a)));
  const dur = o.args.find(a => a && a.t === 'ref' && /^Duration\./.test(a.path));
  if (dur || o.args.some(a => kindOf(a) === 'str')) block(o.cls + ' with a duration');
  if (vals.length !== 1) block(o.cls + ' with two values');
  if (!tc.inCda) block(o.cls + ' outside a characteristic-defining ability');
  const v = P.amount(vals[0], tc);
  const setPt = o.cls === 'SetBasePowerSourceEffect' ? { p: v } : o.cls === 'SetBaseToughnessSourceEffect' ? { t: v } : { p: v, t: v };
  return { op: 'continuous', layer: 7, cda: true, scope: { self: true }, setPt };
});

/* ---------------- delayed triggers ---------------- */

const DELAYED = {
  AtTheBeginOfNextEndStepDelayedTriggeredAbility: (o) => {
    const who = A(o).enumv('TargetController') || 'ANY';
    if (o.args.some(a => kindOf(a) === 'condition') || A(o).bool(0, false)) block('delayed end step with a condition');
    if (who === 'ANY') return { event: 'eachEndStep' };
    if (who === 'YOU') return { event: 'yourEndStep', forPlayer: 'you' };
    block('next end step of ' + who);
    return null;
  },
  AtTheBeginOfYourNextUpkeepDelayedTriggeredAbility: (o) => {
    if (o.args.length > 1) block('your next upkeep, more than once');
    return { event: 'yourUpkeep', forPlayer: 'you', nextTurn: true };
  },
  AtTheBeginOfNextUpkeepDelayedTriggeredAbility: (o) => {
    if (o.args.length > 1) block('next upkeep, more than once');
    return { event: 'eachUpkeep', nextTurn: true };
  },
  AtTheEndOfCombatDelayedTriggeredAbility: () => ({ event: 'endOfCombat' }),
};
/* What a delayed effect may act on: nothing (draw a card), or the
   permanent whose ability made it (sacrifice this). Anything that acts on
   the first ability's targets is refused for now. */
const SELF_OPS = new Set(['sacrificeSelf', 'exileSelf', 'bounce', 'transformSelf']);
def('effect', 'CreateDelayedTriggeredAbilityEffect', (o, tc) => {
  E.checkCalls(o);
  const d = o.args[0];
  if (!d || d.t !== 'obj' || !DELAYED[d.cls]) block('delayed ' + keyOf(d));
  if (o.args.slice(1).some(a => kindOf(a) === 'bool' && a.v === false)) { /* targets not copied: fine */ }
  const when = DELAYED[d.cls](d);
  const parts = AB.partsOf(d, tc);
  if (parts.targets.length || parts.costs.length || parts.modes.length) block('delayed trigger with targets');
  const save = tc.ab;
  tc.ab = { targets: [], used: new Set() };
  let effects;
  try { effects = AB.body(d.args.find(a => kindOf(a) === 'effect' || kindOf(a) === 'custom'), { effects: parts.effects, targets: [] }, tc); }
  finally { tc.ab = save; }
  const selfish = effects.some(e => SELF_OPS.has(e.op) || e.scope === 'self');
  if (effects.some(e => e.scope === 'lastTarget' || e.scope === 'triggerObject' || e.who === 'target')) block('delayed effect on a target');
  return Object.assign({ op: 'delayed', name: 'Delayed trigger', nextTurn: false, effects }, when, selfish ? { subject: 'self' } : null);
});

/* ---------------- looking at the top of the library ---------------- */

const PICKED = { HAND: 'hand', BATTLEFIELD: 'battlefield', GRAVEYARD: 'graveyard' };
const RESTS = { BOTTOM_ANY: 'bottom', BOTTOM_RANDOM: 'bottomRandom', GRAVEYARD: 'graveyard' };
def('effect', 'LookLibraryAndPickControllerEffect', (o, tc) => {
  E.checkCalls(o);
  const vals = o.args.filter(a => ['int', 'value'].includes(kindOf(a)));
  const puts = o.args.filter(a => a && a.t === 'ref' && /^PutCards\./.test(a.path)).map(a => a.path.split('.')[1]);
  if (vals.length !== 2 || puts.length !== 2) block('LookLibraryAndPickControllerEffect shape');
  const look = P.amount(vals[0], tc);
  const pick = P.amount(vals[1], tc);
  if (typeof pick !== 'number') block('pick a count');
  const to = PICKED[puts[0]], rest = RESTS[puts[1]];
  if (!to) block('picked to ' + puts[0]);
  if (!rest) block('rest to ' + puts[1]);
  const f = o.args.find(a => kindOf(a) === 'filter');
  let filter = 'any';
  if (f) {
    filter = F.toWords(F.describe(f, tc));
    if (filter === 'card') filter = 'any';
    if (/\s/.test(filter)) block('pick filter ' + filter);
  }
  const bools = A(o).all('bool').map(x => x.v);
  const take = { op: 'takeFromLooked', n: pick, filter, to, rest };
  if (bools[0] || f) take.optional = true;
  return [{ op: 'lookAt', n: look, keep: 0 }, take];
});

module.exports = { chapter };
