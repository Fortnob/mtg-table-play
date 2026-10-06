/* Copies, flickers, restricted mana, opponents' graveyards, being
   targeted, and revealing the top of the library. */
'use strict';
const { def, tr, block, kindOf, A, calls, keyOf, litOf } = require('./core');
const F = require('./filters');
const P = require('./parts');
const E = require('./effects');
const AB = require('./abilities');

def('target', 'TargetCardInOpponentsGraveyard', (o, tc) => {
  if (A(o).bool(0, false)) block('all from one opponent');
  const d = F.describe(o.args.find(a => kindOf(a) === 'filter') || { t: 'ref', path: 'StaticFilters.FILTER_CARD' }, tc);
  if (d.base !== 'card') block('opponent graveyard filter of ' + d.base);
  d.owner = 'opponent';
  const ints = A(o).all('int').map(x => x.v);
  const shell = { args: ints.map(v => ({ t: 'lit', v })), calls: o.calls };
  const t = { specs: [], kind: 'object', notTarget: false, min: 1, max: 1, d };
  const spec = F.toSpec(d, 'graveyard');
  const min = ints.length >= 2 ? ints[0] : 1, max = ints.length >= 2 ? ints[1] : 1;
  if (max > 10 || (min !== 0 && min !== max)) block('opponent graveyard count');
  for (let i = 0; i < max; i++) t.specs.push(Object.assign({}, spec, min === 0 ? { upTo: true } : null));
  for (const c of shell.calls) if (!/^(?:withChooseHint|setTargetName|withTargetName)$/.test(c.name)) block('Target.' + c.name);
  return t;
});

def('effect', 'CreateTokenCopyTargetEffect', (o, tc) => {
  E.checkCalls(o);
  if (o.args.length && !(o.args.length === 1 && kindOf(o.args[0]) === 'bool')) block('token copy with changes');
  return Object.assign({ op: 'copyPermanent', n: 1, self: false, grant: [] }, E.aimObject(o, tc));
});
def('effect', 'ExileThenReturnTargetEffect', (o, tc) => {
  E.checkCalls(o);
  const b = A(o).all('bool').map(x => x.v);
  if (b[0]) block('return under your control');
  const to = o.args.find(a => a && a.t === 'ref' && /^PutCards\./.test(a.path));
  if (to && to.path !== 'PutCards.BATTLEFIELD') block('return to ' + to.path);
  return Object.assign({ op: 'blink', self: false }, E.aimObject(o, tc));
});

/* "Spend this mana only to cast a creature spell" */
function spendOnly(builder, tc) {
  if (!builder || builder.t !== 'obj' || builder.cls !== 'ConditionalSpellManaBuilder' || builder.calls.length) block('mana restriction ' + keyOf(builder));
  const d = F.describe(builder.args[0], tc);
  if (d.base !== 'spell') block('mana for a ' + d.base);
  const words = F.toWords(d);
  return { op: 'spendOnly', words: words === 'spell' ? 'spell' : words + ' spell', chosenType: false, uncounterable: false };
}
def('ability', 'ConditionalAnyColorManaAbility', (o, tc) => {
  const builder = o.args.find(a => a && a.t === 'obj' && /ManaBuilder$/.test(a.cls));
  const ints = A(o).all('int').map(x => x.v);
  if (ints.length !== 1 || o.args.some(a => kindOf(a) === 'value') || A(o).bool(0, false)) block('ConditionalAnyColorManaAbility shape');
  const costs = o.args.filter(a => ['cost', 'manaCost'].includes(kindOf(a)));
  const parts = AB.partsOf(o, tc);
  const cost = P.costOf((costs.length ? costs : [{ t: 'obj', cls: 'TapSourceCost', args: [], calls: [] }]).concat(parts.costs), tc);
  return { kind: 'mana', cost, effects: [{ op: 'addManaAny', amount: ints[0] }], auto: true, spendOnly: spendOnly(builder, tc) };
});

def('ability', 'BecomesTargetSourceTriggeredAbility', (o, tc) => {
  const f = o.args.find(a => kindOf(a) === 'filter');
  const pointer = AB.pointerArg(o);
  if (pointer) block('targeted trigger pointing at the spell');
  let extra = { bySpellOnly: false, byOpponent: false };
  if (f) {
    const p = f.t === 'ref' ? f.path : '';
    if (/FILTER_SPELL_OR_ABILITY_A$/.test(p)) extra = { bySpellOnly: false, byOpponent: false };
    else if (/FILTER_SPELL_OR_ABILITY_OPPONENTS$/.test(p)) extra = { bySpellOnly: false, byOpponent: true };
    else if (/FILTER_SPELL_A$/.test(p)) extra = { bySpellOnly: true, byOpponent: false };
    else block('targeted by ' + keyOf(f));
  }
  return AB.triggered(o, tc, { event: 'becomesTarget', self: true, optional: A(o).bool(0, false), extra });
});

def('effect', 'RevealLibraryPickControllerEffect', (o, tc) => tr('effect', Object.assign({}, o, { cls: 'LookLibraryAndPickControllerEffect' }), tc));

def('ability', 'BlocksOrBlockedByCreatureSourceTriggeredAbility', (o, tc) => {
  const f = o.args.find(a => kindOf(a) === 'filter');
  if (f && !(f.t === 'ref' && /FILTER_PERMANENT_CREATURE$/.test(f.path))) block('blocks or blocked by a kind of creature');
  if (A(o).bool(0, false)) block('optional');
  return AB.triggered(o, tc, { event: 'blocks', also: 'becomesBlocked', self: true });
});

module.exports = { spendOnly };
