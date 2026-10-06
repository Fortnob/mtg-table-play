/* Domain, discarding as a price, tap-or-untap, animating a target, fog,
   bolster, coloured mana with a spending rule. */
'use strict';
const { def, tr, block, kindOf, A, calls, keyOf, litOf } = require('./core');
const F = require('./filters');
const P = require('./parts');
const E = require('./effects');
const AB = require('./abilities');

def('value', 'DomainValue.REGULAR', () => ({ domain: true, mult: 1 }));

def('effect', 'MayTapOrUntapTargetEffect', (o, tc) => {
  E.checkCalls(o);
  const a = E.aimObject(o, tc);
  if (!a.targets) block('tap or untap something already chosen');
  return Object.assign({ op: 'tapOrUntap' }, a);
});

def('effect', 'BecomesCreatureTargetEffect', (o, tc) => {
  E.checkCalls(o, ['withDurationRuleAtStart']);
  if (tc.inStatic) block('becomes a creature in a static ability');
  const b = A(o).all('bool').map(x => x.v);
  // (loseAllAbilities, stillALand, loseName, keepAbilities, loseOtherCardTypes)
  if (b[0] || b[2] || b[4]) block('becomes a creature and loses something');
  const d = E.durationOf(o, 'EndOfTurn');
  if (d !== 'eot' && d !== 'permanent') block('becomes a creature for ' + d);
  const M3 = require('./more3');
  const eff = M3.animation(o.args[0], tc);
  return Object.assign({ op: 'becomes', duration: d, eff }, E.aimObject(o, tc));
});

/* Fog: "Prevent all combat damage that would be dealt this turn." */
def('effect', 'PreventAllDamageByAllPermanentsEffect', (o, tc) => {
  E.checkCalls(o);
  if (o.args.some(a => kindOf(a) === 'filter')) block('prevent damage by some permanents');
  if (E.durationOf(o, 'EndOfTurn') !== 'eot') block('prevent for longer');
  return { op: 'preventDamage', combatOnly: !!A(o).bool(0, false) };
});

def('effect', 'BolsterEffect', (o, tc) => {
  E.checkCalls(o);
  const v = o.args.find(a => ['int', 'value'].includes(kindOf(a)));
  return { op: 'bolster', n: P.amount(v, tc) };
});

def('ability', 'ConditionalColoredManaAbility', (o, tc) => {
  const m = o.args.find(a => a && a.t === 'obj' && (a.cls === 'Mana' || /^Mana\./.test(a.cls)));
  const builder = o.args.find(a => a && a.t === 'obj' && /ManaBuilder$/.test(a.cls));
  if (!m) block('ConditionalColoredManaAbility shape');
  const MORE = require('./more');
  const mana = MORE.manaOf(m);
  if (mana.any) block('conditional mana of any colour');
  const costs = o.args.filter(a => ['cost', 'manaCost'].includes(kindOf(a)));
  const parts = AB.partsOf(o, tc);
  const cost = P.costOf((costs.length ? costs : [{ t: 'obj', cls: 'TapSourceCost', args: [], calls: [] }]).concat(parts.costs), tc);
  const M4 = require('./more4');
  return { kind: 'mana', cost, effects: [{ op: 'addMana', symbols: mana.symbols }], auto: true, spendOnly: M4.spendOnly(builder, tc) };
});

module.exports = {};
