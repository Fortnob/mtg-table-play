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

def('ability', 'CardsLeaveGraveyardTriggeredAbility', (o, tc) => {
  const f = o.args.find(a => kindOf(a) === 'filter');
  const d = F.describe(f || { t: 'ref', path: 'StaticFilters.FILTER_CARD_CARDS' }, tc);
  if (d.base !== 'card') block('leaving the graveyard: ' + d.base);
  const words = F.toWords(Object.assign({}, d, { owner: undefined }));
  // one trigger for the lot, from your own graveyard
  const ev = { event: 'leftGraveyard', optional: false, objFilter: { words: words === 'card' ? 'card' : words, who: 'you', batch: true } };
  if (A(o).bool(0, false)) ev.condition = { kind: 'yourTurn' };
  return AB.triggered(o, tc, ev);
});
def('ability', 'DealsDamageToAPlayerAttachedTriggeredAbility', (o, tc) => {
  const desc = A(o).str(0);
  if (!/^(?:equipped|enchanted)(?: creature)?$/.test(desc || '')) block('damage by ' + desc);
  const b = A(o).all('bool').map(x => x.v);
  const onlyCombat = b.length > 2 ? b[2] : true;
  if (!onlyCombat) block('any damage by the equipped creature');
  if (A(o).enumv('TargetController') && A(o).enumv('TargetController') !== 'ANY') block('damage to a kind of player');
  return AB.triggered(o, tc, { event: 'equippedCombatDamage', optional: !!b[0], pointer: b[1] ? 'player' : null });
});

def('effect', 'SearchLibraryGraveyardPutInHandEffect', (o, tc) => {
  E.checkCalls(o);
  const b = A(o).all('bool').map(x => x.v);
  if (b[0]) block('must search both');
  const d = F.describe(o.args.find(a => kindOf(a) === 'filter'), tc);
  const named = d.name;
  d.name = undefined;
  const words = F.toWords(d);
  const out = { op: 'tutor', n: 1, filter: words === 'card' && !named ? 'any' : words, to: 'hand', alsoGraveyard: true };
  if (named) { if (words !== 'card') block('named and more'); out.named = named; }
  if (b[1]) out.optional = true;
  return out;
});
def('effect', 'LoseAbilityTargetEffect', (o, tc) => {
  E.checkCalls(o);
  if (E.durationOf(o, 'EndOfTurn') !== 'eot') block('lose for longer');
  return Object.assign({ op: 'loseKeyword', keywords: E.keywordsOf(o.args[0], tc), duration: 'eot' }, E.aimObject(o, tc));
});
def('effect', 'DamageAllControlledTargetEffect', (o, tc) => {
  E.checkCalls(o);
  const v = o.args.find(a => ['int', 'value'].includes(kindOf(a)));
  const f = o.args.find(a => kindOf(a) === 'filter');
  const d = F.describe(f || { t: 'ref', path: 'StaticFilters.FILTER_PERMANENT_CREATURE' }, tc);
  const scope = F.toScope(d);
  if (scope.who !== 'all') block('controlled damage with its own controller');
  scope.who = 'target';
  const a = E.aim(o, tc, 'player');
  if (!a.targets) block('controlled damage to a player chosen before');
  return { op: 'damage', n: P.amount(v, tc), scope, targets: a.targets };
});
def('effect', 'CantBeBlockedSourceEffect', (o, tc) => {
  E.checkCalls(o);
  if (tc.inStatic) block('cant be blocked as a static');
  if (E.durationOf(o, 'WhileOnBattlefield') !== 'eot') block('cant be blocked for longer');
  return { op: 'restrict', flag: 'unblockable', scope: 'self' };
});

def('ability', 'SimpleEvasionAbility', (o, tc) => {
  if (o.calls.length) block('evasion with more');
  const zone = A(o).enumv('Zone');
  if (zone && zone !== 'BATTLEFIELD') block('evasion from ' + zone);
  const e = o.args[0];
  if (!e || e.t !== 'obj' || e.cls !== 'CantBeBlockedByCreaturesSourceEffect' || e.calls.some(c => !/^(?:setText|withTargetDescription)$/.test(c.name))) block('evasion by ' + keyOf(e));
  if (E.durationOf(e, 'WhileOnBattlefield') !== 'static') block('evasion for a while');
  const d = F.describe(e.args.find(a => kindOf(a) === 'filter'), tc);
  const spec = F.toSpec(d, 'battlefield');
  delete spec.filter;
  return { kind: 'static', auto: true, effects: [{ op: 'evasion', notBy: spec }] };
});

def('effect', 'CopyTargetStackObjectEffect', (o, tc) => {
  E.checkCalls(o);
  const b = A(o).all('bool').map(x => x.v);
  if (b[0] || o.args.some(a => kindOf(a) === 'int' || (a && a.t === 'obj'))) block('copy with changes');
  const a = E.aimObject(o, tc);
  if (!a.targets || a.targets[0].type !== 'spell') block('copy of something other than a spell');
  return Object.assign({ op: 'copySpell' }, a);
});
def('target', 'TargetCardInASingleGraveyard', (o, tc) => {
  const ints = A(o).all('int').map(x => x.v);
  // one card is from one graveyard however it is read
  if (ints[1] !== 1) block('several cards from one graveyard');
  return tr('target', Object.assign({}, o, { cls: 'TargetCardInGraveyard' }), tc);
});

/* Amount targets: "N counters among one, two or three target creatures" */
def('target', ['TargetCreaturePermanentAmount', 'TargetPermanentAmount'], (o, tc) => {
  const ints = A(o).all('int').map(x => x.v);
  if (!ints.length || o.args.some(a => kindOf(a) === 'value')) block('amount from a count');
  const amount = ints[0];
  let min = ints.length > 1 ? ints[1] : (amount > 3 ? 0 : 1), max = ints.length > 2 ? ints[2] : amount;
  if (o.cls === 'TargetPermanentAmount' && ints.length === 2) max = amount;
  if (max > 6 || o.calls.length) block('amount among many');
  const f = o.args.find(a => kindOf(a) === 'filter');
  const d = F.describe(f || { t: 'ref', path: o.cls === 'TargetPermanentAmount' ? 'StaticFilters.FILTER_PERMANENT' : 'StaticFilters.FILTER_PERMANENT_CREATURE' }, tc);
  if (o.cls === 'TargetCreaturePermanentAmount' && !d.types.includes('creature') && !d.allTypes.includes('creature')) d.types = ['creature'];
  const spec = F.toSpec(d, 'battlefield');
  const specs = [];
  for (let i = 0; i < max; i++) specs.push(Object.assign({}, spec, i >= Math.max(1, min) ? { upTo: true } : null));
  return { specs, kind: 'object', notTarget: false, min, max, amount, d };
});
def('effect', 'DistributeCountersEffect', (o, tc) => {
  E.checkCalls(o);
  const c = o.args[0] && o.args[0].t === 'ref' ? o.args[0].path.split('.')[1] : 'P1P1';
  const ab = tc.ab;
  const t = ab && ab.targets[0];
  if (!t || t.amount == null || ab.targets.length !== 1 || ab.used.has(0)) block('distribution without its target');
  ab.used.add(0);
  return { op: 'countersDivided', kind: F.counterName(c), n: t.amount, targets: t.specs };
});

def('effect', 'GoadAllEffect', (o, tc) => {
  E.checkCalls(o);
  const f = o.args.find(a => kindOf(a) === 'filter');
  if (!f || o.args.length !== 1) block('GoadAllEffect shape');
  return { op: 'goad', scope: F.toScope(F.describe(f, tc)) };
});

module.exports = {};
