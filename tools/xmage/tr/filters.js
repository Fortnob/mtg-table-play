/* XMage filters, read into one neutral description and written out in the
   three shapes the engine uses for "which things": a target spec (what a
   target may be), a scope (which permanents a static or mass effect
   touches), and a trigger subject (what a trigger is watching for).

   The description (D) is built from the filter's class and the predicates
   added to it, never from its message text, so it says what the filter
   checks rather than what it is called. Anything a shape cannot express is
   refused rather than dropped: a filter that loses a restriction offers
   targets the card does not allow. */
'use strict';
const path = require('path');
const { def, tr, block, kindOf, calls, keyOf } = require('./core');
const { staticFields } = require('../model');
const fw = require('../framework');

const TYPES = ['creature', 'artifact', 'enchantment', 'land', 'planeswalker', 'battle', 'instant', 'sorcery', 'kindred'];
const PERM_TYPES = ['creature', 'artifact', 'enchantment', 'land', 'planeswalker', 'battle'];
const COLORS = { WHITE: 'W', BLUE: 'U', BLACK: 'B', RED: 'R', GREEN: 'G' };
const COLOR_WORD = { W: 'white', U: 'blue', B: 'black', R: 'red', G: 'green' };

function blank(base) {
  return { base, types: [], allTypes: [], notTypes: [], subtypes: [], notSubtypes: [], colors: [], notColors: [] };
}

/* The base classes: what each filter checks before anything is added. */
const BASES = {
  FilterPermanent: () => blank('permanent'),
  FilterCreaturePermanent: () => Object.assign(blank('permanent'), { types: ['creature'] }),
  FilterControlledPermanent: () => Object.assign(blank('permanent'), { controller: 'you' }),
  FilterControlledCreaturePermanent: () => Object.assign(blank('permanent'), { types: ['creature'], controller: 'you' }),
  FilterControlledLandPermanent: () => Object.assign(blank('permanent'), { types: ['land'], controller: 'you' }),
  FilterControlledArtifactPermanent: () => Object.assign(blank('permanent'), { types: ['artifact'], controller: 'you' }),
  FilterControlledEnchantmentPermanent: () => Object.assign(blank('permanent'), { types: ['enchantment'], controller: 'you' }),
  FilterControlledPlaneswalkerPermanent: () => Object.assign(blank('permanent'), { types: ['planeswalker'], controller: 'you' }),
  FilterLandPermanent: () => Object.assign(blank('permanent'), { types: ['land'] }),
  FilterBasicLandPermanent: () => Object.assign(blank('permanent'), { types: ['land'], basic: true }),
  FilterArtifactPermanent: () => Object.assign(blank('permanent'), { types: ['artifact'] }),
  FilterEnchantmentPermanent: () => Object.assign(blank('permanent'), { types: ['enchantment'] }),
  FilterPlaneswalkerPermanent: () => Object.assign(blank('permanent'), { types: ['planeswalker'] }),
  FilterBattlePermanent: () => Object.assign(blank('permanent'), { types: ['battle'] }),
  FilterNonlandPermanent: () => Object.assign(blank('permanent'), { notTypes: ['land'] }),
  FilterAttackingCreature: () => Object.assign(blank('permanent'), { types: ['creature'], attacking: true }),
  FilterBlockingCreature: () => Object.assign(blank('permanent'), { types: ['creature'], blocking: true }),
  FilterAttackingOrBlockingCreature: () => Object.assign(blank('permanent'), { types: ['creature'], inCombat: true }),
  FilterCreatureOrPlaneswalkerPermanent: () => Object.assign(blank('permanent'), { types: ['creature', 'planeswalker'] }),
  FilterArtifactOrEnchantmentPermanent: () => Object.assign(blank('permanent'), { types: ['artifact', 'enchantment'] }),
  FilterArtifactCreaturePermanent: () => Object.assign(blank('permanent'), { types: ['artifact'], allTypes: ['creature'] }),
  FilterOpponentsCreaturePermanent: () => Object.assign(blank('permanent'), { types: ['creature'], controller: 'opponent' }),
  FilterTeamPermanent: () => Object.assign(blank('permanent'), { controller: 'you' }),
  FilterTeamCreaturePermanent: () => Object.assign(blank('permanent'), { types: ['creature'], controller: 'you' }),
  FilterCard: () => blank('card'),
  FilterCreatureCard: () => Object.assign(blank('card'), { types: ['creature'] }),
  FilterLandCard: () => Object.assign(blank('card'), { types: ['land'] }),
  FilterBasicLandCard: () => Object.assign(blank('card'), { types: ['land'], basic: true }),
  FilterArtifactCard: () => Object.assign(blank('card'), { types: ['artifact'] }),
  FilterEnchantmentCard: () => Object.assign(blank('card'), { types: ['enchantment'] }),
  FilterInstantOrSorceryCard: () => Object.assign(blank('card'), { types: ['instant', 'sorcery'] }),
  FilterNonlandCard: () => Object.assign(blank('card'), { notTypes: ['land'] }),
  FilterPermanentCard: () => Object.assign(blank('card'), { types: PERM_TYPES.slice(), permanentCard: true }),
  FilterPlaneswalkerCard: () => Object.assign(blank('card'), { types: ['planeswalker'] }),
  FilterOwnedCard: () => Object.assign(blank('card'), { owner: 'you' }),
  FilterSpell: () => blank('spell'),
  FilterCreatureSpell: () => Object.assign(blank('spell'), { types: ['creature'] }),
  FilterNoncreatureSpell: () => Object.assign(blank('spell'), { notTypes: ['creature'] }),
  FilterInstantOrSorcerySpell: () => Object.assign(blank('spell'), { types: ['instant', 'sorcery'] }),
  FilterArtifactSpell: () => Object.assign(blank('spell'), { types: ['artifact'] }),
  FilterPermanentSpell: () => Object.assign(blank('spell'), { types: PERM_TYPES.slice(), permanentCard: true }),
  FilterStackObject: () => Object.assign(blank('spell'), { orAbility: true }),
  FilterPlayer: () => blank('player'),
  FilterOpponent: () => Object.assign(blank('player'), { opponent: true }),
};

let STATIC = null;
function staticFilter(name) {
  if (!STATIC) STATIC = staticFields(path.join(fw.FW, 'filter', 'StaticFilters.java'));
  return STATIC[name];
}

/** A filter value (an object, a StaticFilters reference, a copy) -> D. */
function describe(v, tc) {
  if (!v) block('filter:missing');
  if (v.t === 'ref' && /^StaticFilters\./.test(v.path)) {
    const f = staticFilter(v.path.split('.')[1]);
    if (!f || f.t !== 'obj') block(v.path);
    return describe(f, tc);
  }
  if (v.t === 'obj' && v.cls === 'FilterCopy') {
    const d = describe(v.args[0], tc);
    applyCalls(d, v, tc);
    return d;
  }
  if (v.t !== 'obj') block('filter:' + v.t);
  if (v.custom) block('custom filter', v.cls);
  const mk = BASES[v.cls];
  if (!mk) block(v.cls);
  const d = mk();
  const msg = v.args.find(a => a && a.t === 'lit' && typeof a.v === 'string');
  if (msg) d.message = msg.v;
  // FilterCreaturePermanent(SubType.ELF, "Elf") and friends
  for (const a of v.args) {
    if (a && a.t === 'ref' && /^SubType\./.test(a.path)) d.subtypes.push(subName(a.path));
  }
  applyCalls(d, v, tc);
  return d;
}

function applyCalls(d, v, tc) {
  for (const c of v.calls) {
    if (c.name === 'add') { for (const p of c.args) predicate(d, p, tc, false); continue; }
    if (/^(?:setLockedFilter|setMessage)$/.test(c.name)) continue;
    block('Filter.' + c.name);
  }
}

/* The printed names of XMage's enum constants ("ASSEMBLY_WORKER" is
   "Assembly-Worker", "P1P1" is "+1/+1"), read from the enum sources. */
const ENUM_NAMES = {};
function enumNames(file) {
  if (ENUM_NAMES[file]) return ENUM_NAMES[file];
  const fs = require('fs');
  const src = fs.readFileSync(path.join(fw.FW, file), 'utf8');
  const out = {};
  for (const m of src.matchAll(/^\s+([A-Z][A-Z0-9_]*)\("([^"]+)"/gm)) out[m[1]] = m[2];
  ENUM_NAMES[file] = out;
  return out;
}
function subtypeName(c) {
  const n = enumNames('constants/SubType.java')[c];
  return (n || c.replace(/_/g, ' ')).toLowerCase();
}
function subName(path) {
  return subtypeName(path.split('.')[1]);
}

/** Fold one predicate into D; `neg` when it sits under Predicates.not. */
function predicate(d, p, tc, neg) {
  const key = keyOf(p);
  // CardType.X.getPredicate(), SubType.X.getPredicate(), SuperType.X.getPredicate()
  let m;
  if (p.t === 'obj' && (m = /^CardType\.(\w+)\.getPredicate$/.exec(p.cls))) {
    const t = m[1].toLowerCase();
    if (neg) d.notTypes.push(t); else d.allTypes.push(t);
    return;
  }
  if (p.t === 'obj' && (m = /^SubType\.(\w+)\.getPredicate$/.exec(p.cls))) {
    const s = subtypeName(m[1]);
    if (neg) d.notSubtypes.push(s); else d.subtypes.push(s);
    return;
  }
  if (p.t === 'obj' && (m = /^SuperType\.(\w+)\.getPredicate$/.exec(p.cls))) {
    const s = m[1].toLowerCase();
    if (!['legendary', 'basic', 'snow'].includes(s)) block(p.cls);
    if (neg) d['non' + s] = true; else d[s] = true;
    return;
  }
  if (p.t === 'obj' && (m = /^TargetController\.(\w+)\.get(Controller|Owner)Predicate$/.exec(p.cls))) {
    if (neg) block('not ' + p.cls);
    const who = { YOU: 'you', OPPONENT: 'opponent', NOT_YOU: 'opponent' }[m[1]];
    if (!who) block(p.cls);
    if (m[2] === 'Controller') d.controller = who; else d.owner = who;
    return;
  }
  if (p.t === 'obj' && p.cls === 'Predicates.not') { predicate(d, p.args[0], tc, !neg); return; }
  if (p.t === 'obj' && p.cls === 'Predicates.or') {
    if (neg) block('not or');
    const items = p.args.length === 1 && p.args[0].t === 'array' ? p.args[0].items : p.args;
    // an "or" of card types, subtypes or colours is a list of alternatives
    const types = [], subs = [], cols = [];
    for (const x of items) {
      const k = keyOf(x);
      if ((m = /^CardType\.(\w+)\.getPredicate$/.exec(k))) types.push(m[1].toLowerCase());
      else if ((m = /^SubType\.(\w+)\.getPredicate$/.exec(k))) subs.push(subtypeName(m[1]));
      else if (x.t === 'obj' && x.cls === 'ColorPredicate' && x.args[0] && x.args[0].t === 'ref' && COLORS[x.args[0].path.split('.')[1]]) cols.push(COLORS[x.args[0].path.split('.')[1]]);
      else block('or of ' + k);
    }
    if ([types, subs, cols].filter(a => a.length).length !== 1) block('mixed or');
    if (types.length) {
      // an "or" that narrows a list of types already there
      if (d.types.length) { const both = d.types.filter(t => types.includes(t)); if (!both.length) block('or of types'); d.types = both; }
      else d.types = types;
    }
    if (subs.length) { if (d.subtypes.length) block('two subtype lists'); d.subtypes = subs; }
    if (cols.length) { if (d.colors.length) block('two colour lists'); d.colors = cols; }
    return;
  }
  if (p.t === 'obj' && p.cls === 'Predicates.and') {
    if (neg) block('not and');
    for (const x of p.args) predicate(d, x, tc, false);
    return;
  }
  if (p.t === 'obj' && p.cls === 'ColorPredicate') {
    const c = p.args[0] && p.args[0].t === 'ref' && COLORS[p.args[0].path.split('.')[1]];
    if (!c) block('ColorPredicate');
    if (neg) d.notColors.push(c); else { if (d.colors.length) block('two colours'); d.colors.push(c); }
    return;
  }
  const fn = PREDICATES[key] || PREDICATES[key.split('.')[0] + '.*'];
  if (!fn) block(key);
  fn(d, p, neg, tc);
}

const cmp = (p) => {
  const c = p.args[0] && p.args[0].t === 'ref' ? p.args[0].path.split('.')[1] : null;
  const n = p.args[1] && p.args[1].t === 'lit' ? p.args[1].v : null;
  if (c == null || typeof n !== 'number') block('comparison');
  switch (c) {
    case 'FEWER_THAN': return { max: n - 1 };
    case 'OR_LESS': return { max: n };
    case 'MORE_THAN': return { min: n + 1 };
    case 'OR_GREATER': return { min: n };
    case 'EQUAL_TO': return { min: n, max: n };
    default: block('comparison ' + c);
  }
  return null;
};
const KW_CLASSES = {
  FlyingAbility: 'flying', FirstStrikeAbility: 'first strike', DoubleStrikeAbility: 'double strike', DeathtouchAbility: 'deathtouch',
  LifelinkAbility: 'lifelink', MenaceAbility: 'menace', ReachAbility: 'reach', TrampleAbility: 'trample', VigilanceAbility: 'vigilance',
  HasteAbility: 'haste', DefenderAbility: 'defender', IndestructibleAbility: 'indestructible', HexproofAbility: 'hexproof',
  ShroudAbility: 'shroud', FlashAbility: 'flash', InfectAbility: 'infect', WitherAbility: 'wither',
};

const PREDICATES = {
  'AnotherPredicate.instance': (d, p, neg) => { if (neg) block('not another'); d.another = true; },
  'TokenPredicate.TRUE': (d, p, neg) => { d.token = !neg; },
  'TokenPredicate.FALSE': (d, p, neg) => { d.token = !!neg; },
  'TappedPredicate.TAPPED': (d, p, neg) => { d.tapped = !neg; },
  'TappedPredicate.UNTAPPED': (d, p, neg) => { d.tapped = !!neg; },
  'AttackingPredicate.instance': (d, p, neg) => { if (neg) block('not attacking'); d.attacking = true; },
  'BlockingPredicate.instance': (d, p, neg) => { if (neg) block('not blocking'); d.blocking = true; },
  'ColorlessPredicate.instance': (d, p, neg) => { if (neg) d.colored = true; else d.colorless = true; },
  'MulticoloredPredicate.instance': (d, p, neg) => { if (neg) block('not multicolored'); d.multicolored = true; },
  'MonocoloredPredicate.instance': (d, p, neg) => { if (neg) block('not monocolored'); d.monocolored = true; },
  'ManaValuePredicate': (d, p, neg) => { if (neg) block('not mv'); d.mv = Object.assign(d.mv || {}, cmp(p)); },
  'PowerPredicate': (d, p, neg) => { if (neg) block('not power'); d.power = Object.assign(d.power || {}, cmp(p)); },
  'ToughnessPredicate': (d, p, neg) => { if (neg) block('not toughness'); d.toughness = Object.assign(d.toughness || {}, cmp(p)); },
  'AbilityPredicate': (d, p, neg) => {
    const c = p.args[0] && p.args[0].t === 'classLit' ? String(p.args[0].path).split('.').pop() : null;
    const k = KW_CLASSES[c];
    if (!k) block('AbilityPredicate ' + c);
    if (neg) d.withoutKeyword = k; else d.withKeyword = k;
  },
  'CounterAnyPredicate.instance': (d, p, neg) => { if (neg) block('no counters'); d.anyCounter = true; },
  'CounterType.*': (d, p, neg) => {
    const m = /^CounterType\.(\w+)\.getPredicate$/.exec(p.cls || '');
    if (!m || neg) block(keyOf(p));
    d.withCounter = counterName(m[1]);
  },
  'FaceDownPredicate.instance': (d, p, neg) => { if (neg) block('not face down'); d.faceDown = true; },
  'HistoricPredicate.instance': (d, p, neg) => { if (neg) block('not historic'); d.historic = true; },
  'CommanderPredicate.instance': (d, p, neg) => { if (neg) block('not a commander'); d.commander = true; },
  'NamePredicate': (d, p, neg) => {
    const n = p.args[0] && p.args[0].t === 'lit' ? p.args[0].v : null;
    if (neg || typeof n !== 'string' || d.name) block('NamePredicate');
    d.name = n;
  },
};

/** XMage's counter constant name -> the name the engine keeps counters by. */
function counterName(c) {
  const map = { P1P1: '+1/+1', M1M1: '-1/-1', P0P1: '+0/+1', P1P0: '+1/+0', P2P2: '+2/+2', M0M1: '-0/-1', M1M0: '-1/-0',
    M2M2: '-2/-2', P0P2: '+0/+2', P1P2: '+1/+2' };
  return map[c] || (enumNames('counters/CounterType.java')[c] || c.replace(/_/g, ' ')).toLowerCase();
}

/* ---------------- D -> the engine's shapes ---------------- */

const SHAPE_FIELDS = new Set(['base', 'types', 'allTypes', 'notTypes', 'subtypes', 'notSubtypes', 'colors', 'notColors', 'message']);
/** Fields D sets that a converter did not use: those are restrictions it would lose. */
function leftover(d, used) {
  const out = [];
  for (const [k, v] of Object.entries(d)) {
    if (SHAPE_FIELDS.has(k) || used.includes(k)) continue;
    if (v === undefined || v === null || v === false && k !== 'token' && k !== 'tapped') continue;
    out.push(k);
  }
  return out;
}

/** The types D allows, collapsed: allTypes narrows a list, or is the list. */
function typeList(d) {
  let list = d.types.slice();
  const all = d.allTypes.slice();
  if (!list.length && all.length) list = [all.shift()];
  return { list, also: all };
}

/** A target spec, in the shape targetSpec() writes. */
function toSpec(d, zone) {
  const spec = { type: 'permanent', zone: zone || (d.base === 'card' ? 'graveyard' : d.base === 'spell' ? 'stack' : 'battlefield') };
  const used = ['controller', 'owner', 'another', 'token', 'tapped', 'attacking', 'blocking', 'inCombat', 'legendary', 'nonlegendary',
    'basic', 'nonbasic', 'colorless', 'multicolored', 'monocolored', 'mv', 'power', 'toughness', 'withKeyword', 'withoutKeyword',
    'withCounter', 'faceDown', 'opponent', 'permanentCard', 'orAbility', 'commander', 'name'];
  const bad = leftover(d, used);
  if (bad.length) block('filter:' + bad.join(','));
  const { list, also } = typeList(d);
  if (d.base === 'player') {
    spec.type = 'player'; delete spec.zone;
    if (d.opponent || d.controller === 'opponent') spec.opponent = true;
    return spec;
  }
  if (d.base === 'spell') {
    spec.type = 'spell'; spec.zone = 'stack';
    if (d.orAbility) block('spell or ability');
    if (list.length && !d.permanentCard) spec.cardTypes = list;
  } else if (d.base === 'card') {
    const perm = list.filter(t => PERM_TYPES.includes(t));
    if (d.permanentCard) { /* any permanent card: no narrowing beyond the zone */ }
    else if (list.some(t => !PERM_TYPES.includes(t))) { spec.cardTypes = list; }
    else if (perm.length === 1) spec.type = perm[0];
    else if (perm.length > 1) spec.anyOf = perm;
  } else {
    if (list.some(t => !PERM_TYPES.includes(t))) block('non-permanent type on a permanent');
    if (list.length === 1) spec.type = list[0];
    else if (list.length > 1) spec.anyOf = list;
  }
  if (also.length) {
    // "artifact creature": both. Only expressible as a narrowing type list.
    block('two types at once');
  }
  if (d.notTypes.length) spec.notType = d.notTypes.slice();
  if (d.notTypes.includes('land') && spec.zone === 'battlefield') spec.nonland = true;
  if (d.subtypes.length) spec.subtypes = d.subtypes.slice();
  if (d.notSubtypes.length > 1) block('several non-subtypes');
  if (d.notSubtypes.length) spec.notSubtype = d.notSubtypes[0];
  if (d.colors.length) spec.colors = d.colors.slice();
  if (d.notColors.length) spec.notColors = d.notColors.slice();
  if (d.controller) spec.controller = d.controller;
  if (d.owner) {
    if (d.base !== 'card') block('owner of a permanent');
    spec.controller = d.owner;          // a card in a graveyard: "your graveyard" is the owner's
  }
  if (d.another) spec.another = true;
  if (d.token === true) spec.token = true;
  if (d.token === false) spec.nontoken = true;
  if (d.tapped != null) spec.tapped = d.tapped;
  if (d.attacking) spec.attacking = true;
  if (d.blocking) spec.blocking = true;
  if (d.inCombat) spec.inCombat = true;
  for (const k of ['legendary', 'nonlegendary', 'basic', 'nonbasic', 'colorless', 'multicolored', 'monocolored', 'faceDown', 'commander']) if (d[k]) spec[k] = true;
  if (d.name) spec.name = d.name;
  if (d.mv) { if (d.mv.min === d.mv.max && d.mv.min != null) spec.mv = d.mv.min; else { if (d.mv.min != null) spec.minMv = d.mv.min; if (d.mv.max != null) spec.maxMv = d.mv.max; } }
  if (d.power) { if (d.power.min != null) spec.minPower = d.power.min; if (d.power.max != null) spec.maxPower = d.power.max; }
  if (d.toughness) { if (d.toughness.min != null) spec.minToughness = d.toughness.min; if (d.toughness.max != null) spec.maxToughness = d.toughness.max; }
  if (d.withKeyword) spec.withKeyword = d.withKeyword;
  if (d.withoutKeyword) spec.withoutKeyword = d.withoutKeyword;
  if (d.withCounter) spec.withCounter = d.withCounter;
  if (spec.zone === 'stack' && (spec.tapped != null || spec.attacking || spec.another || spec.token || spec.nontoken)) block('spell filter on permanent words');
  /* The words, as the parser writes them: a spell on the stack is matched
     by these alone ("noncreature", "instant or sorcery"), and the table
     shows them. */
  if (d.base === 'spell') {
    spec.filter = toWords(Object.assign({}, d, { controller: undefined, mv: undefined, orAbility: undefined }), { allow: ['permanentCard'] });
    if (spec.filter === 'spell') delete spec.filter;
    else spec.filter += ' spell';
  } else spec.filter = words(d);
  return spec;
}

/** A scope, in the shape scopeOf() writes; `who` is set from the controller. */
function toScope(d, opts) {
  opts = opts || {};
  if (d.base !== 'permanent') block('scope of ' + d.base);
  const used = ['controller', 'another', 'token', 'tapped', 'attacking', 'blocking', 'legendary', 'nonlegendary', 'nonbasic',
    'mv', 'power', 'withKeyword', 'withoutKeyword', 'withCounter', 'anyCounter', 'name'];
  const bad = leftover(d, used);
  if (bad.length) block('scope:' + bad.join(','));
  if (d.name) { /* set below */ }
  const sc = { who: d.controller === 'you' ? 'you' : d.controller === 'opponent' ? 'opponents' : 'all' };
  const { list, also } = typeList(d);
  if (list.length === 1) sc.what = list[0];
  else if (list.length > 1) { sc.what = 'permanent'; sc.anyOf = list; }
  else sc.what = 'permanent';
  if (also.length) sc.alsoType = also;
  if (d.notTypes.length) sc.notType = d.notTypes.slice();
  if (d.subtypes.length > 1) sc.subtypes = d.subtypes.slice();
  else if (d.subtypes.length) sc.subtype = d.subtypes[0];
  if (d.notSubtypes.length > 1) block('several non-subtypes');
  if (d.notSubtypes.length) sc.notSubtype = d.notSubtypes[0];
  if (d.colors.length > 1) block('several colours in a scope');
  if (d.colors.length) sc.color = d.colors[0];
  if (d.notColors.length > 1) block('several non-colours in a scope');
  if (d.notColors.length) sc.notColor = d.notColors[0];
  if (d.another) sc.other = true;
  if (d.token === true) sc.token = true;
  if (d.token === false) sc.nontoken = true;
  if (d.tapped === true) sc.tapped = true;
  if (d.tapped === false) sc.untapped = true;
  if (d.attacking) sc.attacking = true;
  if (d.blocking) sc.blocking = true;
  for (const k of ['legendary', 'nonlegendary', 'nonbasic']) if (d[k]) sc[k] = true;
  if (d.mv) { if (d.mv.min != null) sc.minMv = d.mv.min; if (d.mv.max != null) sc.maxMv = d.mv.max; }
  if (d.power) { if (d.power.min != null) sc.minPower = d.power.min; if (d.power.max != null) sc.maxPower = d.power.max; }
  if (d.withKeyword) sc.keyword = d.withKeyword;
  if (d.withoutKeyword) sc.withoutKeyword = d.withoutKeyword;
  if (d.withCounter) sc.withCounter = d.withCounter;
  if (d.anyCounter) sc.withAnyCounter = true;
  if (d.name) sc.name = d.name;
  return sc;
}

/** Words for _cardFitsWords: alternatives joined by "or", each a list of words that must all fit. */
function toWords(d, opts) {
  opts = opts || {};
  const used = ['legendary', 'basic', 'nonbasic', 'nonlegendary', 'token', 'colorless', 'multicolored', 'monocolored', 'permanentCard', 'snow']
    .concat(opts.allow || []);
  const bad = leftover(d, used);
  if (bad.length) block('words:' + bad.join(','));
  const common = [];
  if (d.legendary) common.push('legendary');
  if (d.nonlegendary) common.push('nonlegendary');
  if (d.basic) common.push('basic');
  if (d.nonbasic) common.push('nonbasic');
  if (d.snow) common.push('snow');
  if (d.token === true) common.push('token');
  if (d.token === false) common.push('nontoken');
  if (d.colorless) common.push('colorless');
  if (d.multicolored) common.push('multicolored');
  if (d.monocolored) common.push('monocolored');
  for (const c of d.notColors) common.push('non' + COLOR_WORD[c]);
  for (const t of d.notTypes) common.push('non' + t);
  if (d.notSubtypes.length) block('words: non-subtype');
  const { list, also } = typeList(d);
  for (const t of also) common.push(t);
  let alts = [[]];
  const cross = (opts2) => { const next = []; for (const a of alts) for (const o of opts2) next.push(a.concat(o)); alts = next; };
  if (d.colors.length) cross(d.colors.map(c => COLOR_WORD[c]));
  if (d.subtypes.length) cross(d.subtypes);
  if (d.permanentCard) cross(['permanent']);
  else if (list.length) cross(list);
  const out = alts.map(a => common.concat(a).join(' ').trim()).filter(Boolean);
  if (!out.length) return d.base === 'spell' ? 'spell' : d.base === 'card' ? 'card' : 'permanent';
  return out.join(' or ');
}

/** A trigger subject, in the shape subjectFilter() writes. */
function toSubject(d) {
  const used = ['controller', 'another', 'token', 'power', 'mv', 'withKeyword', 'withCounter', 'attacking', 'name',
    'legendary', 'basic', 'nonbasic', 'nonlegendary', 'colorless', 'multicolored', 'monocolored'];
  const bad = leftover(d, used);
  if (bad.length) block('subject:' + bad.join(','));
  const f = {};
  if (d.another) f.other = true;
  if (d.controller === 'you') f.who = 'you';
  if (d.controller === 'opponent') f.who = 'opponent';
  if (d.token === false) f.nontoken = true;
  if (d.token === true) f.token = true;
  if (d.power) { if (d.power.min != null) f.minPower = d.power.min; if (d.power.max != null) f.maxPower = d.power.max; }
  if (d.mv) { if (d.mv.min != null) f.minMv = d.mv.min; if (d.mv.max != null) f.maxMv = d.mv.max; }
  if (d.withKeyword) f.keyword = d.withKeyword;
  if (d.withCounter) f.withCounter = d.withCounter;
  if (d.attacking) f.attacking = true;
  if (d.name) f.name = d.name;
  const words = toWords(Object.assign({}, d, { token: undefined, another: undefined, controller: undefined, power: undefined,
    mv: undefined, withKeyword: undefined, withCounter: undefined, attacking: undefined, name: undefined }));
  f.words = words;
  return f;
}

/** A plain description of D, for reading. */
function words(d) { try { return toWords(d, { allow: Object.keys(d) }); } catch (e) { return d.message || '?'; } }

module.exports = { subtypeName, describe, toSpec, toScope, toWords, toSubject, words, counterName, KW_CLASSES, PERM_TYPES, COLORS, COLOR_WORD, staticFilter };
