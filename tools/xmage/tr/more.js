/* More translators, added in the order the blockers report asked for
   them: mana abilities, library and price effects, and the triggers the
   first pass did not know. */
'use strict';
const { def, tr, block, kindOf, A, calls, keyOf, litOf } = require('./core');
const F = require('./filters');
const P = require('./parts');
const E = require('./effects');
const AB = require('./abilities');

const amt = (o, tc, i) => {
  const v = o.args.filter(a => ['int', 'value'].includes(kindOf(a)))[i || 0];
  if (!v) block(o.cls + ' amount');
  return P.amount(v, tc);
};

/* ---------------- mana ---------------- */

/** An XMage Mana value -> the engine's symbols, or { any: n } for mana of any colour. */
function manaOf(v) {
  if (!v || v.t !== 'obj') block('mana ' + keyOf(v));
  const one = { 'Mana.WhiteMana': 'W', 'Mana.BlueMana': 'U', 'Mana.BlackMana': 'B', 'Mana.RedMana': 'R', 'Mana.GreenMana': 'G',
    'Mana.ColorlessMana': 'C', 'Mana.GenericMana': 'C' };
  if (one[v.cls]) return { symbols: new Array(litOf(v.args[0])).fill(one[v.cls]) };
  if (v.cls === 'Mana.AnyMana') return { any: litOf(v.args[0]) };
  if (v.cls === 'Mana' && v.args.length === 8) {
    const n = v.args.map(a => litOf(a));
    const out = [];
    ['W', 'U', 'B', 'R', 'G', 'C'].forEach((c, i) => { for (let k = 0; k < n[i]; k++) out.push(c); });
    for (let k = 0; k < n[7]; k++) out.push('C');
    if (n[6]) { if (out.length) block('mixed any mana'); return { any: n[6] }; }
    return { symbols: out };
  }
  block('mana ' + v.cls);
  return null;
}
function manaEffect(m) {
  if (m.any) return { op: 'addManaAny', amount: m.any };
  if (!m.symbols.length) block('no mana');
  return { op: 'addMana', symbols: m.symbols };
}
def('effect', 'BasicManaEffect', (o) => {
  E.checkCalls(o);
  if (o.args.length !== 1) block('BasicManaEffect with a net amount');
  return manaEffect(manaOf(o.args[0]));
});
def('effect', 'AddManaOfAnyColorEffect', (o) => {
  E.checkCalls(o);
  const n = A(o).int(0);
  if (A(o).bool(0, false) || o.args.some(a => kindOf(a) === 'value')) block('AddManaOfAnyColorEffect flags');
  return { op: 'addManaAny', amount: n == null ? 1 : n };
});

const TAP = () => ({ t: 'obj', cls: 'TapSourceCost', args: [], calls: [] });
const BASIC_MANA = { WhiteManaAbility: 'W', BlueManaAbility: 'U', BlackManaAbility: 'B', RedManaAbility: 'R', GreenManaAbility: 'G', ColorlessManaAbility: 'C' };
for (const [cls, c] of Object.entries(BASIC_MANA)) {
  def('ability', cls, (o, tc) => {
    if (o.args.length || o.calls.length) block(cls + ' with arguments');
    return { kind: 'mana', cost: P.costOf([TAP()], tc), effects: [{ op: 'addMana', symbols: [c] }], auto: true };
  });
}
function manaAbility(o, tc, effect, costs) {
  const parts = AB.partsOf(o, tc);
  if (parts.targets.length || parts.modes.length || parts.effects.length) block('mana ability with more');
  const zone = A(o).enumv('Zone') || 'BATTLEFIELD';
  if (zone !== 'BATTLEFIELD') block('mana ability in ' + zone);
  const cost = P.costOf(costs.concat(parts.costs), tc);
  if (!AB.MANA_OPS.has(effect.op)) block('mana ability making ' + effect.op);
  return { kind: 'mana', cost, effects: [effect], auto: true };
}
def('ability', 'SimpleManaAbility', (o, tc) => {
  const m = o.args.find(a => a && a.t === 'obj' && (a.cls === 'Mana' || /^Mana\./.test(a.cls)));
  const eff = o.args.find(a => kindOf(a) === 'effect' || kindOf(a) === 'custom');
  const costs = o.args.filter(a => ['cost', 'manaCost'].includes(kindOf(a)));
  if (o.args.some(a => kindOf(a) === 'value')) block('mana ability with a net amount');
  if (A(o).bool(0, true) === false) block('unpredictable mana ability');
  const effect = m ? manaEffect(manaOf(m)) : E.effect(eff, tc)[0];
  return manaAbility(o, tc, effect, costs);
});
def('ability', 'AnyColorManaAbility', (o, tc) => {
  if (o.args.some(a => kindOf(a) === 'value' || (kindOf(a) === 'bool' && a.v))) block('AnyColorManaAbility flags');
  const costs = o.args.filter(a => ['cost', 'manaCost'].includes(kindOf(a)));
  return manaAbility(o, tc, { op: 'addManaAny', amount: 1 }, costs.length ? costs : [TAP()]);
});

/**
 * Several mana abilities on one printed line with the same price ("{R/W},
 * {T}: Add {R}{R}, {R}{W}, or {W}{W}.") are one ability with a choice.
 */
function mergeMana(abilities) {
  const mana = abilities.filter(a => a.kind === 'mana');
  if (mana.length < 2 || mana.length !== abilities.length) return abilities;
  const key = JSON.stringify(mana[0].cost);
  if (!mana.every(a => JSON.stringify(a.cost) === key && a.effects.length === 1 && a.effects[0].op === 'addMana')) return abilities;
  return [{ kind: 'mana', cost: mana[0].cost, auto: true, effects: [{ op: 'addManaChoice', choices: mana.map(a => a.effects[0].symbols) }] }];
}

/* ---------------- libraries, hands, prices ---------------- */

def('effect', 'PutOnLibraryTargetEffect', (o, tc) => {
  E.checkCalls(o);
  return Object.assign({ op: 'toLibrary', where: A(o).bool(0, true) ? 'top' : 'bottom' }, E.aimObject(o, tc));
});
def('effect', 'ReturnToHandSourceEffect', (o) => {
  E.checkCalls(o);
  if (!A(o).bool(0, false)) block('return to hand from any zone');
  if (A(o).bool(1, false)) block('return from the next zone');
  return { op: 'bounce', scope: 'self' };
});
def('effect', 'DiscardHandControllerEffect', (o) => { E.checkCalls(o); if (o.args.length) block('DiscardHandControllerEffect args'); return { op: 'discard', n: 'all', who: 'you' }; });
def('effect', 'LoseLifeAllPlayersEffect', (o, tc) => {
  E.checkCalls(o);
  const n = amt(o, tc);
  return [{ op: 'loseLife', n, who: 'you' }, { op: 'loseLife', n, who: 'opponents' }];
});
def('effect', 'GetEnergyCountersControllerEffect', (o, tc) => { E.checkCalls(o); return { op: 'energy', n: amt(o, tc) }; });
def('effect', 'CantBeBlockedTargetEffect', (o, tc) => {
  E.checkCalls(o);
  if (o.args.some(a => kindOf(a) === 'filter')) block('cant be blocked except');
  if (E.durationOf(o, 'EndOfTurn') !== 'eot') block('unblockable for longer');
  return Object.assign({ op: 'restrict', flag: 'unblockable' }, E.aimObject(o, tc));
});
/** A price written as the parser writes one ("{3}", or { life }), for "unless" effects. */
function unlessCost(v, tc) {
  if (kindOf(v) === 'value' || kindOf(v) === 'int') {
    const n = P.amount(v, tc);
    if (typeof n !== 'number') block('unless pays a count');
    return '{' + n + '}';
  }
  const c = P.costOf([v], tc);
  if (c.mana && !c.life && !c.tap && !c.sacSelf && !c.sacrifice && !c.discard && !c.exile && !c.removeCounters) return c.mana;
  if (c.life && !c.mana) return { life: c.life };
  block('unless pays ' + (c.raw || '?'));
  return null;
}
def('effect', 'CounterUnlessPaysEffect', (o, tc) => {
  E.checkCalls(o);
  if (A(o).bool(0, false)) block('counter and exile');
  const a = E.aim(o, tc, 'object');
  if (a.pointer) block('counter that spell unless');
  if (!a.targets || a.targets[0].type !== 'spell') block('counter of a non-spell');
  return { op: 'unlessPays', who: 'spellController', cost: unlessCost(o.args[0], tc), then: [Object.assign({ op: 'counterSpell' }, a)] };
});
def('effect', 'SacrificeSourceUnlessPaysEffect', (o, tc) => {
  E.checkCalls(o);
  return { op: 'unlessPays', who: 'you', cost: unlessCost(o.args[0], tc), then: [{ op: 'sacrificeSelf' }] };
});
def('effect', 'DoWhenCostPaid', (o, tc) => {
  E.checkCalls(o);
  const r = o.args[0];
  if (!r || r.t !== 'obj' || r.cls !== 'ReflexiveTriggeredAbility') block('DoWhenCostPaid of ' + keyOf(r));
  if (A(o).bool(0, true) === false) block('DoWhenCostPaid not optional');
  if (A(r).bool(0, false)) block('optional reflexive trigger');
  if (r.args.some(a => kindOf(a) === 'condition')) block('reflexive trigger with a condition');
  const parts = AB.partsOf(r, tc);
  const save = tc.ab;
  tc.ab = null;
  let then;
  try { then = AB.body(r.args[0], parts, tc); } finally { tc.ab = save; }
  const c = P.costOf([o.args[1]], tc);
  const pay = {};
  if (c.mana) pay.mana = c.mana;
  if (c.life) pay.life = c.life;
  if (c.tap || c.sacSelf || c.sacrifice || c.discard || c.exile || c.removeCounters || c.untap || c.tapCreatures || c.putCounters) block('DoWhenCostPaid with ' + (c.raw || '?'));
  if (!Object.keys(pay).length) block('DoWhenCostPaid with nothing to pay');
  return { op: 'mayPay', pay, then };
});

/* ---------------- triggers ---------------- */

def('ability', 'LimitedTimesPerTurnActivatedAbility', (o, tc) => {
  const ints = A(o).all('int').map(x => x.v);
  if (ints.length && ints[0] !== 1) block('activate more than once a turn');
  if (o.args.some(a => kindOf(a) === 'condition')) block('limited ability with a condition');
  return AB.activated(Object.assign({}, o, { args: o.args.filter(a => kindOf(a) !== 'int') }), tc, { once: true });
});
def('ability', 'DiscardCardControllerTriggeredAbility', (o, tc) => {
  const f = o.args.find(a => kindOf(a) === 'filter');
  if (f && !(f.t === 'ref' && /FILTER_CARD_A$|FILTER_CARD$/.test(f.path))) block('discard trigger for a kind of card');
  return AB.triggered(o, tc, { event: 'youDiscard' });
});
def('ability', 'AttacksWithCreaturesTriggeredAbility', (o, tc) => {
  const n = A(o).int(0);
  const f = o.args.find(a => kindOf(a) === 'filter');
  if (n !== 1) block('attack with ' + n + ' or more');
  if (f && !(f.t === 'ref' && /FILTER_PERMANENT_CREATURES$/.test(f.path))) block('attack with a kind of creature');
  if (A(o).bool(0, false)) block('attack trigger pointing at the attackers');
  const zone = A(o).enumv('Zone');
  if (zone && zone !== 'BATTLEFIELD') block('attack trigger from ' + zone);
  return AB.triggered(o, tc, { event: 'youAttack', optional: A(o).bool(1, false) });
});
def('ability', 'DiesAttachedTriggeredAbility', (o, tc) => {
  const desc = A(o).str(0);
  if (!/^(?:equipped|enchanted) creature$/.test(desc || '')) block('dies attached to ' + desc);
  const bools = A(o).all('bool').map(x => x.v);
  return AB.triggered(o, tc, { event: 'equippedDies', optional: !!bools[0], pointer: AB.pointerArg(o) });
});
def('ability', 'AttacksAttachedTriggeredAbility', (o, tc) => {
  return AB.triggered(o, tc, { event: 'permAttacks', objFilter: { words: 'creature', equipped: true }, optional: A(o).bool(0, false), pointer: AB.pointerArg(o) });
});
def('ability', 'BecomesBlockedSourceTriggeredAbility', (o, tc) => {
  if (A(o).bool(1, false)) block('blocked trigger pointing at the blocker');
  return AB.triggered(o, tc, { event: 'becomesBlocked', self: true });
});
def('ability', 'TurnedFaceUpSourceTriggeredAbility', (o, tc) => {
  if (o.args.some(a => kindOf(a) === 'bool' && a.v)) block('face-up trigger flags');
  return AB.triggered(o, tc, { event: 'turnedFaceUp', self: true, optional: false });
});
def('ability', 'EntersBattlefieldThisOrAnotherTriggeredAbility', (o, tc) => {
  const f = o.args.find(a => kindOf(a) === 'filter');
  const d = F.describe(f, tc);
  const bools = A(o).all('bool').map(x => x.v);
  if (bools[bools.length - 1]) d.controller = 'you';
  d.another = true;
  const subj = F.toSubject(d);
  subj.selfOk = true;
  return AB.triggered(o, tc, { event: 'permEnters', objFilter: subj, optional: !!bools[0], pointer: AB.pointerArg(o) });
});
def('ability', 'SacrificePermanentTriggeredAbility', (o, tc) => {
  const who = A(o).enumv('TargetController') || 'YOU';
  if (who !== 'YOU') block('sacrifice trigger for ' + who);
  const zone = A(o).enumv('Zone');
  if (zone && zone !== 'BATTLEFIELD') block('sacrifice trigger from ' + zone);
  const d = F.describe(o.args.find(a => kindOf(a) === 'filter'), tc);
  const f = F.toSubject(d);
  delete f.who;
  return AB.triggered(o, tc, { event: 'youSacrifice', objFilter: f.words === 'permanent' ? undefined : f, optional: A(o).bool(0, false), pointer: AB.pointerArg(o) });
});
def('ability', 'PutIntoGraveFromBattlefieldAllTriggeredAbility', (o, tc) => {
  const bools = A(o).all('bool').map(x => x.v);
  if (bools[2]) block('only to its controller\'s graveyard');
  const d = F.describe(o.args.find(a => kindOf(a) === 'filter'), tc);
  return AB.triggered(o, tc, { event: 'permDies', objFilter: F.toSubject(d), optional: !!bools[0], pointer: bools[1] ? 'card' : null });
});
def('ability', 'EntersBattlefieldWithCountersAbility', (o, tc) => {
  if (o.calls.length || o.args.length !== 1) block('enters with counters, and more');
  const c = P.counterOf(o.args[0], tc);
  const said = tc.an && tc.an.entersWithCounters;
  // the engine adds them from the printed words as the permanent enters; this only stands for the line
  if (!said || said.kind !== c.kind || said.n !== c.n) block('enters with counters the text reading did not see');
  return { kind: 'static', auto: true, effects: [{ op: 'noop', entersWith: { kind: c.kind, n: c.n } }] };
});

module.exports = { mergeMana, manaOf };
