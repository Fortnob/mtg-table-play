/* What an XMage card class builds, as plain data.

   A card's constructor is a short program: it makes ability objects, hangs
   effects, targets and costs off them, and adds them to the card. This runs
   that program symbolically. Every `new Foo(...)` becomes an object that
   remembers its class, its arguments and every method later called on it
   (`addEffect`, `addTarget`, `setText` ...), so the translator can read the
   finished structure without knowing anything about Java.

   Names declared in the card's own file (an effect or condition written for
   that one card) are marked `custom`: the translator cannot know what their
   code does and refuses them, which is what makes them show up as blockers.

   Each statement remembers the comment above it. XMage prints the card's
   rules text there, line by line, and that is how abilities are matched to
   the lines of the printed card. */
'use strict';
const fs = require('fs');
const { parseJava } = require('./java');

/* Methods that return the object they are called on, so a chain like
   `new DrawCardSourceControllerEffect(1).setText("...").concatBy(",")`
   is still one effect. Anything else called on an object is recorded too:
   these just say the result is the same object. */
const SELF_RETURNING = /^(?:set|with|add|concat|withTarget|withChooseHint|withFlavorWord|withInterveningIf|withTriggerCondition|setTriggerPhrase|withRuleTextReplacement|withRuleText|withDuration|withCondition|addHint|addWatcher|addCustomOutcome|addInfo|withTargetDescription|setOptional|withActivationRestriction|withCanActivateOnlyOnce|withMaxActivationsPerTurn|setTriggersLimitEachTurn|setTargetPointer|setOutcome|setDuration|setTiming|withTiming|setMayActivate|setTargetAdjuster|setCostAdjuster|withTargetAdjuster|withCostAdjuster|setAbilityWord|setAbilityWordValue|setAdditionalCostsRuleVisible|setTargetName|setRequired|setMinNumberOfTargets|setMaxNumberOfTargets|setNotTarget|setRandom|setValue|setLeavesTheBattlefieldTrigger|setRuleAtTheTop|setRuleVisible|withShowEffects|withConcatPrefix|withNotTarget|withAttachEffect|withAnyNumberOfTargets|setCountersOnly|setOnlyCreatures|withExpandedDescription|withChooseUpTo|setChooseUpTo|withMinModesForEachOpponent|withAlternateManaCost|withHint|withAlternativeName|setText|setStaticText|setTriggerPhrase|setAdditionalCost)/;

class Ctx {
  constructor(unit, file) {
    this.unit = unit;
    this.file = file;
    this.problems = [];
    this.customNames = new Set();
    this.fieldInits = new Map();
    this.fieldVals = new Map();
    this.vars = new Map();
    this.objCount = 0;
  }
  problem(p) { if (!this.problems.includes(p)) this.problems.push(p); }
}

function collectCustom(decl, set) {
  for (const t of decl.types || []) { set.add(t.name); collectCustom(t, set); }
}

/** Read a card file into its model. */
function loadCard(file) {
  const src = fs.readFileSync(file, 'utf8');
  return modelOf(src, file);
}

function modelOf(src, file) {
  const unit = parseJava(src);
  const base = String(file || '').replace(/^.*[\\/]/, '').replace(/\.java$/, '');
  const main = unit.types.find(t => t.name === base) || unit.types[0];
  const ctx = new Ctx(unit, file);
  for (const t of unit.types) if (t !== main) { ctx.customNames.add(t.name); collectCustom(t, ctx.customNames); }
  collectCustom(main, ctx.customNames);

  const card = {
    cls: main.name, file, superCls: main.ext ? main.ext.name : null, superArgs: [],
    abilities: [], calls: [], spell: null, faces: {}, problems: ctx.problems, imports: unit.imports,
    customDecls: [], subtypes: [], power: null, toughness: null, loyalty: null,
  };
  // the classes this file writes for itself, with what they extend
  const allDecls = [];
  const walkDecls = (d) => { for (const t of d.types || []) { allDecls.push(t); walkDecls(t); } };
  for (const t of unit.types) if (t !== main) { allDecls.push(t); walkDecls(t); }
  walkDecls(main);
  card.customDecls = allDecls.map(d => ({ name: d.name, kind: d.kind, ext: d.ext ? d.ext.name : null,
    impl: (d.impl || []).map(x => x.name), decl: d }));

  /* Comments in the constructor, merged into blocks of consecutive lines:
     each block is the printed text of the ability coded below it. */
  const ctor = main.ctors.find(c => c.params.length === 2 && /UUID/.test(c.params[0].type.name)) ||
    main.ctors.find(c => c.params.length >= 2) || main.ctors[0];
  if (!ctor) { ctx.problem('no constructor'); return card; }
  const blocks = [];
  for (const c of unit.comments) {
    if (c.line < ctor.line || c.line > ctor.endLine) continue;
    const last = blocks[blocks.length - 1];
    if (last && last.endLine === c.line - 1) { last.text += ' ' + c.text; last.endLine = c.line; }
    else blocks.push({ line: c.line, endLine: c.line, text: c.text });
  }
  ctx.commentFor = (line) => {
    let best = null;
    for (const b of blocks) if (b.endLine < line) best = b; else break;
    return best ? best.text : null;
  };
  card.comments = blocks;

  // fields first (static filters and the like), then static blocks that finish them
  for (const f of main.fields) ctx.fieldInits.set(f.name, f);
  const thisObj = { t: 'this', card };
  ctx.thisObj = thisObj;
  ctx.card = card;
  for (const s of main.statics) {
    if (s.instance) continue;
    runBlock(ctx, s.body, true);
  }
  ctx.vars = new Map();
  runBlock(ctx, ctor.body, false);
  return card;
}

function fieldValue(ctx, name) {
  if (ctx.fieldVals.has(name)) return ctx.fieldVals.get(name);
  const f = ctx.fieldInits.get(name);
  if (!f) return undefined;
  ctx.fieldVals.set(name, { t: 'pending' });
  const saveVars = ctx.vars;
  ctx.vars = new Map();
  const v = f.init ? evalExpr(ctx, f.init, f.line) : { t: 'lit', v: null };
  ctx.vars = saveVars;
  if (v && typeof v === 'object' && v.t === 'obj') v.field = name;
  ctx.fieldVals.set(name, v);
  return v;
}

function runBlock(ctx, body, isStatic) {
  for (const st of body || []) runStatement(ctx, st, isStatic);
}

function runStatement(ctx, st, isStatic) {
  ctx.line = st.line;
  ctx.cmt = isStatic ? null : ctx.commentFor(st.line);
  switch (st.k) {
    case 'expr': evalExpr(ctx, st.e, st.line); return;
    case 'var': {
      const v = st.init ? evalExpr(ctx, st.init, st.line) : { t: 'lit', v: null };
      if (v && v.t === 'obj' && !v.varName) v.varName = st.name;
      ctx.vars.set(st.name, v);
      return;
    }
    case 'block': runBlock(ctx, st.body, isStatic); return;
    case 'empty': return;
    case 'unparsed': ctx.problem('unparsed statement'); return;
    default: ctx.problem('statement:' + st.k); return;
  }
}

function newObj(ctx, cls, args, line) {
  const o = { t: 'obj', cls, args, calls: [], line, cmt: ctx.cmt, id: ++ctx.objCount };
  if (ctx.customNames.has(cls)) o.custom = true;
  return o;
}

/** What `Foo.bar` names: a static thing, unless Foo is a variable or field. */
function refPath(e) {
  if (e.k === 'name') return e.v;
  if (e.k === 'field') { const p = refPath(e.obj); return p == null ? null : p + '.' + e.name; }
  return null;
}

function evalExpr(ctx, e, line) {
  switch (e.k) {
    case 'lit': return { t: 'lit', v: e.v };
    case 'paren': return evalExpr(ctx, e.e, line);
    case 'this': return ctx.thisObj;
    case 'cast': return evalExpr(ctx, e.e, line);
    case 'name': {
      if (ctx.vars.has(e.v)) return ctx.vars.get(e.v);
      const fv = fieldValue(ctx, e.v);
      if (fv !== undefined) return fv;
      // import static mage.filter.StaticFilters.FILTER_X: the bare name is that field
      const si = (ctx.unit.staticImports || []).find(x => x.endsWith('.' + e.v));
      if (si) return { t: 'ref', path: si.split('.').slice(-2).join('.') };
      const star = (ctx.unit.staticImports || []).find(x => /\.\*$/.test(x));
      if (star && /^[A-Z][A-Z0-9_]+$/.test(e.v)) return { t: 'ref', path: star.split('.').slice(-2, -1)[0] + '.' + e.v };
      return { t: 'ref', path: e.v };
    }
    case 'field': {
      // this.power, this.toughness ... on the card
      if (e.obj.k === 'this') return { t: 'cardField', name: e.name };
      const o = evalExpr(ctx, e.obj, line);
      if (o && o.t === 'ref') return { t: 'ref', path: o.path + '.' + e.name };
      return { t: 'member', of: o, name: e.name };
    }
    case 'new': {
      const args = e.args.map(a => evalExpr(ctx, a, line));
      const cls = e.type.name.split('.').pop();
      const o = newObj(ctx, cls, args, e.line || line);
      if (e.body) { o.anon = true; ctx.problem('anonymous class ' + cls); }
      return o;
    }
    case 'newArray': {
      if (e.init) return { t: 'array', items: e.init.items.map(x => evalExpr(ctx, x, line)), type: e.type.name };
      return { t: 'array', items: [], type: e.type.name };
    }
    case 'array': return { t: 'array', items: e.items.map(x => evalExpr(ctx, x, line)) };
    case 'lambda': {
      /* ability -> { ability.addEffect(...); ability.addTarget(...); }: the
         way a Saga chapter is sometimes written. The body is run against a
         fresh object that records what was done to it. */
      if (e.block && Array.isArray(e.body) && e.params.length === 1) {
        const obj = { t: 'obj', cls: 'LambdaAbility', args: [], calls: [], line, cmt: ctx.cmt, id: ++ctx.objCount };
        const had = ctx.vars.has(e.params[0]) ? ctx.vars.get(e.params[0]) : undefined;
        ctx.vars.set(e.params[0], obj);
        const saveLine = ctx.line, saveCmt = ctx.cmt;
        for (const st of e.body) {
          if (st.k !== 'expr' && st.k !== 'var' && st.k !== 'block' && st.k !== 'empty') { ctx.problem('lambda statement ' + st.k); continue; }
          runStatement(ctx, st, false);
        }
        ctx.line = saveLine; ctx.cmt = saveCmt;
        if (had === undefined) ctx.vars.delete(e.params[0]); else ctx.vars.set(e.params[0], had);
        return { t: 'lambdaAbility', obj };
      }
      ctx.problem('lambda');
      return { t: 'lambda' };
    }
    case 'mref': return { t: 'mref', path: (refPath(e.obj) || '?') + '::' + e.name };
    case 'bin': {
      const l = evalExpr(ctx, e.l, line), r = evalExpr(ctx, e.r, line);
      if (l.t === 'lit' && r.t === 'lit') {
        switch (e.op) {
          case '+': return { t: 'lit', v: l.v + r.v };
          case '-': return { t: 'lit', v: l.v - r.v };
          case '*': return { t: 'lit', v: l.v * r.v };
        }
      }
      return { t: 'bin', op: e.op, l, r };
    }
    case 'un': {
      const v = evalExpr(ctx, e.e, line);
      if (e.op === '!' && v.t === 'lit') return { t: 'lit', v: !v.v };
      return { t: 'un', op: e.op, v };
    }
    case 'tern': ctx.problem('ternary'); return { t: 'tern' };
    case 'assign': {
      const r = evalExpr(ctx, e.r, line);
      if (e.l.k === 'field' && e.l.obj.k === 'this') {
        ctx.card.calls.push({ name: '=' + e.l.name, args: [r], line, cmt: ctx.cmt });
        if (e.l.name === 'power' || e.l.name === 'toughness') ctx.card[e.l.name] = r;
        return r;
      }
      if (e.l.k === 'name' && ctx.vars.has(e.l.v)) { ctx.vars.set(e.l.v, r); return r; }
      if (e.l.k === 'name' && (ctx.fieldInits.has(e.l.v) || ctx.fieldVals.has(e.l.v))) { ctx.fieldVals.set(e.l.v, r); return r; }
      ctx.problem('assignment');
      return r;
    }
    case 'call': return evalCall(ctx, e, line);
    case 'classLit': return { t: 'classLit', path: e.type.k ? refPath(e.type) : e.type.name };
    case 'instanceof': ctx.problem('instanceof'); return { t: 'unknown' };
    case 'index': ctx.problem('index'); return { t: 'unknown' };
    default: ctx.problem('expr:' + e.k); return { t: 'unknown' };
  }
}

function evalCall(ctx, e, line) {
  const args = () => e.args.map(a => evalExpr(ctx, a, line));
  // super(...) in the card constructor: the card types and the cost
  if (!e.obj && e.name === 'super') { ctx.card.superArgs = args(); return { t: 'lit', v: null }; }
  if (!e.obj && e.name === 'this') { ctx.problem('this() call'); return { t: 'unknown' }; }
  /* getLeftHalfCard() with no "this.": the card's own method all the same */
  if (!e.obj && /^(?:getLeftHalfCard|getRightHalfCard|getSpellCard|getSpellAbility|addAbility|getAbilities)$/.test(e.name)) {
    return callOn(ctx, ctx.thisObj, e.name, args(), line);
  }
  if (!e.obj) {
    // an unqualified call: a method of the card class (or a static import)
    ctx.problem('local method ' + e.name);
    return { t: 'unknown' };
  }
  // static calls: Foo.bar(...)
  const p = refPath(e.obj);
  const objIsVar = e.obj.k === 'name' && (ctx.vars.has(e.obj.v) || fieldValue(ctx, e.obj.v) !== undefined);
  let target;
  if (p != null && !objIsVar && /^[A-Z]/.test(p) && !(e.obj.k === 'field' && e.obj.obj.k === 'this')) {
    const cls = p.split('.').pop();
    if (e.name === 'copy' && !e.args.length) return newObj(ctx, 'FilterCopy', [{ t: 'ref', path: p }], line);
    if (e.name === 'getInstance') {
      const o = newObj(ctx, cls, args(), line);
      o.singleton = true;
      return o;
    }
    // CardType.CREATURE.getPredicate(), SubType.ELF.getPredicate()
    const o = newObj(ctx, p + '.' + e.name, args(), line);
    o.staticCall = true;
    if (ctx.customNames.has(p.split('.')[0])) o.custom = true;
    return o;
  }
  target = evalExpr(ctx, e.obj, line);
  const a = args();
  return callOn(ctx, target, e.name, a, line);
}

/** A method called on something the constructor holds. */
function callOn(ctx, target, name, a, line) {
  const card = ctx.card;
  const rec = { name, args: a, line, cmt: ctx.cmt };
  if (target.t === 'this' || target.t === 'face') {
    const holder = target.t === 'this' ? card : target.face;
    switch (name) {
      case 'getSpellAbility': {
        if (!holder.spell) holder.spell = { t: 'obj', cls: 'SpellAbility', args: [], calls: [], line, cmt: ctx.cmt, id: ++ctx.objCount, isSpell: true };
        return holder.spell;
      }
      case 'getSpellCard': case 'getLeftHalfCard': case 'getRightHalfCard': case 'getSecondFaceSpellAbility': {
        const key = name.replace(/^get/, '');
        if (!card.faces[key]) card.faces[key] = { abilities: [], calls: [], spell: null, name: key };
        return { t: 'face', face: card.faces[key] };
      }
      case 'addAbility': {
        holder.abilities.push({ obj: a[0], line, cmt: ctx.cmt, extra: a.slice(1) });
        return { t: 'lit', v: null };
      }
      // an emblem's constructor: getAbilities().add(ability)
      case 'getAbilities': return { t: 'abilities', holder };
      default:
        holder.calls.push(rec);
        if (/^(?:getSubtype|getSuperType|getColor|getCardType)$/.test(name)) return { t: 'cardProp', name, holder };
        return { t: 'lit', v: null };
    }
  }
  if (target.t === 'abilities' && name === 'add') {
    target.holder.abilities.push({ obj: a[0], line, cmt: ctx.cmt, extra: [] });
    return { t: 'lit', v: true };
  }
  if (target.t === 'cardField' || target.t === 'cardProp') {
    card.calls.push(Object.assign({ field: target.name }, rec));
    return { t: 'lit', v: null };
  }
  if (target.t === 'view') {
    target.of.calls.push(Object.assign({}, rec, { name: target.prefix + name }));
    if (name === 'get' || name === 'getMode') { ctx.problem('view.get'); return { t: 'unknown' }; }
    return target;
  }
  if (target.t === 'obj') {
    if (name === 'getModes') return { t: 'view', of: target, prefix: 'modes.' };
    if (name === 'getEffects') return { t: 'view', of: target, prefix: 'effects.' };
    if (name === 'getTargets') return { t: 'view', of: target, prefix: 'targets.' };
    if (name === 'getCosts') return { t: 'view', of: target, prefix: 'costs.' };
    if (name === 'getManaCostsToPay' || name === 'getManaCosts') return { t: 'view', of: target, prefix: 'manaCosts.' };
    if (name === 'copy') {
      const o = Object.assign({}, target, { calls: target.calls.slice(), id: ++ctx.objCount, copiedFrom: target.id });
      return o;
    }
    target.calls.push(rec);
    if (SELF_RETURNING.test(name)) return target;
    // a getter or anything else: the translator will not know what came back
    return { t: 'callResult', of: target, name, args: a };
  }
  if (target.t === 'ref') {
    const o = newObj(ctx, target.path + '.' + name, a, line);
    o.staticCall = true;
    return o;
  }
  ctx.problem('call on ' + target.t + ' .' + name);
  return { t: 'unknown' };
}

/**
 * The static fields of a framework class (StaticFilters, say), evaluated the
 * same way a card's are: initialisers first, then the static blocks that
 * finish them. Returns name -> value.
 */
function staticFields(file) {
  const unit = parseJava(fs.readFileSync(file, 'utf8'));
  const main = unit.types[0];
  const ctx = new Ctx(unit, file);
  ctx.card = { calls: [], abilities: [], faces: {}, problems: ctx.problems };
  ctx.thisObj = { t: 'this', card: ctx.card };
  ctx.commentFor = () => null;
  for (const f of main.fields) ctx.fieldInits.set(f.name, f);
  for (const s of main.statics) if (!s.instance) runBlock(ctx, s.body, true);
  const out = {};
  for (const f of main.fields) out[f.name] = fieldValue(ctx, f.name);
  return out;
}

module.exports = { loadCard, modelOf, staticFields };
