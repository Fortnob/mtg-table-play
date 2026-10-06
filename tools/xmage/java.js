/* A reader for the part of Java that XMage's card classes are written in.

   It is not a compiler. It reads a source file into its types, fields,
   constructors and methods; the bodies that matter (constructors, static
   blocks and field initialisers) are read down to expressions, and every
   other method body is skipped by matching braces, so a construct this does
   not know in a method nobody reads costs nothing. Anything it cannot read
   in a body it does read is kept as an `unparsed` statement rather than
   thrown away, so the translator can refuse the card instead of
   misreading it.

   Line comments are kept with their line numbers: XMage writes the printed
   text of each ability as a comment above the code that makes it, and the
   translator uses that to line abilities up with the card's own lines. */
'use strict';

const OPS = ['>>>=', '<<=', '>>=', '...', '->', '::', '++', '--', '&&', '||', '==', '!=', '<=', '>=', '+=', '-=', '*=',
  '/=', '%=', '&=', '|=', '^=', '<<', '{', '}', '(', ')', '[', ']', ';', ',', '.', '@', '=', '>', '<', '!', '~', '?',
  ':', '+', '-', '*', '/', '&', '|', '^', '%'];

function tokenize(src) {
  const toks = [];
  const comments = [];
  let i = 0, line = 1;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === '\n') { line++; i++; continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f') { i++; continue; }
    if (c === '/' && src[i + 1] === '/') {
      const end = src.indexOf('\n', i);
      const stop = end < 0 ? n : end;
      comments.push({ line, text: src.slice(i + 2, stop).trim() });
      i = stop;
      continue;
    }
    if (c === '/' && src[i + 1] === '*') {
      const end = src.indexOf('*/', i + 2);
      const stop = end < 0 ? n : end + 2;
      for (let k = i; k < stop; k++) if (src[k] === '\n') line++;
      i = stop;
      continue;
    }
    if (c === '"') {
      // a text block, """ ... """
      if (src.startsWith('"""', i)) {
        const end = src.indexOf('"""', i + 3);
        const stop = end < 0 ? n : end + 3;
        const body = src.slice(i + 3, stop - 3);
        toks.push({ t: 'str', v: body.replace(/^[^\n]*\n/, '').replace(/\n\s*/g, ' ').trim(), line });
        for (let k = i; k < stop; k++) if (src[k] === '\n') line++;
        i = stop;
        continue;
      }
      let j = i + 1, s = '';
      while (j < n && src[j] !== '"') {
        if (src[j] === '\\') { s += unescape(src[j + 1], src, j); j += escLen(src, j); continue; }
        s += src[j++];
      }
      toks.push({ t: 'str', v: s, line });
      i = j + 1;
      continue;
    }
    if (c === "'") {
      let j = i + 1, s = '';
      while (j < n && src[j] !== "'") {
        if (src[j] === '\\') { s += unescape(src[j + 1], src, j); j += escLen(src, j); continue; }
        s += src[j++];
      }
      toks.push({ t: 'chr', v: s, line });
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c) || (c === '.' && /[0-9]/.test(src[i + 1] || ''))) {
      const m = /^(?:0[xX][0-9a-fA-F_]+|[0-9][0-9_]*(?:\.[0-9_]*)?(?:[eE][+-]?[0-9]+)?|\.[0-9]+)[lLfFdD]?/.exec(src.slice(i, i + 40));
      toks.push({ t: 'num', v: Number(m[0].replace(/[lLfFdD_]$/g, '').replace(/_/g, '')), line });
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i + 1;
      while (j < n && /[A-Za-z0-9_$]/.test(src[j])) j++;
      toks.push({ t: 'id', v: src.slice(i, j), line });
      i = j;
      continue;
    }
    let op = null;
    for (const o of OPS) if (src.startsWith(o, i)) { op = o; break; }
    if (!op) { i++; continue; }        // a stray character (a BOM, say) is not worth failing over
    toks.push({ t: 'op', v: op, line });
    i += op.length;
  }
  toks.push({ t: 'eof', v: '', line });
  return { toks, comments };
}

function escLen(src, j) {
  if (src[j + 1] === 'u') { let k = j + 2; while (src[k] === 'u') k++; return k - j + 4; }
  return 2;
}
function unescape(ch, src, j) {
  switch (ch) {
    case 'n': return '\n';
    case 't': return '\t';
    case 'r': return '\r';
    case 'b': return '\b';
    case 'f': return '\f';
    case 's': return ' ';
    case 'u': {
      let k = j + 2; while (src[k] === 'u') k++;
      return String.fromCharCode(parseInt(src.slice(k, k + 4), 16));
    }
    default: return ch;
  }
}

const MODIFIERS = new Set(['public', 'private', 'protected', 'static', 'final', 'abstract', 'native', 'synchronized',
  'transient', 'volatile', 'strictfp', 'default', 'sealed', 'non-sealed']);
const PRIMS = new Set(['int', 'long', 'short', 'byte', 'char', 'boolean', 'double', 'float', 'void', 'var']);

class Parser {
  constructor(src) {
    const { toks, comments } = tokenize(src);
    this.toks = toks;
    this.comments = comments;
    this.p = 0;
  }
  peek(k = 0) { return this.toks[Math.min(this.p + k, this.toks.length - 1)]; }
  next() { return this.toks[this.p++]; }
  is(v, k = 0) { const t = this.peek(k); return t.t !== 'str' && t.t !== 'chr' && t.v === v; }
  isId(k = 0) { return this.peek(k).t === 'id'; }
  eat(v) { if (this.is(v)) { this.p++; return true; } return false; }
  expect(v) {
    if (!this.is(v)) throw new Error(`expected '${v}' at line ${this.peek().line}, got '${this.peek().v}'`);
    return this.next();
  }
  ident() {
    if (!this.isId()) throw new Error(`expected a name at line ${this.peek().line}, got '${this.peek().v}'`);
    return this.next().v;
  }

  /** Skip a balanced (), [], {} or <> group starting at the current token. */
  skipGroup() {
    const open = this.next().v;
    const close = { '(': ')', '[': ']', '{': '}', '<': '>' }[open];
    let depth = 1;
    while (depth > 0 && this.peek().t !== 'eof') {
      const t = this.next();
      if (t.t !== 'op') continue;
      if (t.v === open) depth++;
      else if (t.v === close) depth--;
      else if (open === '<' && t.v === '>>') depth -= 2;
      else if (open === '<' && t.v === '>>>') depth -= 3;
    }
  }

  skipAnnotations() {
    while (this.is('@') && !this.is('interface', 1)) {
      this.next();
      this.ident();
      while (this.eat('.')) this.ident();
      if (this.is('(')) this.skipGroup();
    }
  }
  modifiers() {
    const mods = [];
    for (;;) {
      this.skipAnnotations();
      if (this.isId() && MODIFIERS.has(this.peek().v)) { mods.push(this.next().v); continue; }
      return mods;
    }
  }

  /* ---------------- types ---------------- */
  typeArgs() {
    // after '<': read a list of type arguments, wildcards included
    const out = [];
    this.expect('<');
    if (this.eat('>')) return out;        // the diamond
    for (;;) {
      this.skipAnnotations();
      if (this.eat('?')) {
        if (this.eat('extends') || this.eat('super')) out.push(this.type());
        else out.push({ name: '?' });
      } else out.push(this.type());
      if (this.eat(',')) continue;
      break;
    }
    this.closeAngle();
    return out;
  }
  closeAngle() {
    const t = this.peek();
    if (t.v === '>') { this.next(); return; }
    // '>>' closing two levels: split the token
    if (t.v === '>>') { t.v = '>'; return; }
    if (t.v === '>>>') { t.v = '>>'; return; }
    if (t.v === '>=') { t.v = '='; return; }
    if (t.v === '>>=') { t.v = '>='; return; }
    throw new Error(`expected '>' at line ${t.line}`);
  }
  type() {
    this.skipAnnotations();
    let name = this.ident();
    let args = null;
    if (this.is('<')) args = this.typeArgs();
    while (this.is('.') && this.isId(1)) {
      this.next();
      name += '.' + this.ident();
      if (this.is('<')) args = this.typeArgs();
    }
    let dims = 0;
    while (this.is('[') && this.is(']', 1)) { this.next(); this.next(); dims++; }
    if (this.eat('...')) dims++;
    return { name, args, dims };
  }
  /** Does a type, then a name, start here? Restores the position either way. */
  looksLikeDecl() {
    const save = this.p;
    try {
      if (!this.isId()) return false;
      this.type();
      if (!this.isId()) return false;
      this.next();
      return this.is('=') || this.is(';') || this.is(',') || this.is(':') || this.is('[');
    } catch (e) {
      return false;
    } finally {
      this.p = save;
    }
  }

  /* ---------------- compilation unit ---------------- */
  unit() {
    const out = { pkg: null, imports: {}, staticImports: [], types: [] };
    this.skipAnnotations();
    if (this.eat('package')) {
      let n = this.ident();
      while (this.eat('.')) n += '.' + this.ident();
      this.expect(';');
      out.pkg = n;
    }
    while (this.is('import')) {
      this.next();
      const isStatic = this.eat('static');
      let n = this.ident();
      let star = false;
      while (this.eat('.')) {
        if (this.eat('*')) { star = true; break; }
        n += '.' + this.ident();
      }
      this.expect(';');
      if (isStatic) out.staticImports.push(n + (star ? '.*' : ''));
      else if (!star) out.imports[n.split('.').pop()] = n;
    }
    while (this.peek().t !== 'eof') {
      if (this.eat(';')) continue;
      const mods = this.modifiers();
      out.types.push(this.typeDecl(mods));
    }
    return out;
  }

  typeDecl(mods) {
    const line = this.peek().line;
    let kind = this.next().v;
    if (kind === '@') kind = this.next().v === 'interface' ? 'annotation' : kind;
    const name = this.ident();
    const decl = { kind, name, mods, line, ext: null, impl: [], fields: [], ctors: [], methods: [], types: [],
      statics: [], enumConsts: [], typeParams: null };
    if (this.is('<')) { decl.typeParams = true; this.skipGroup(); }
    if (kind === 'record' && this.is('(')) this.skipGroup();
    if (this.eat('extends')) {
      decl.ext = this.type();
      while (this.eat(',')) decl.impl.push(this.type());       // an interface extending several
    }
    if (this.eat('implements')) {
      decl.impl.push(this.type());
      while (this.eat(',')) decl.impl.push(this.type());
    }
    if (this.eat('permits')) { this.type(); while (this.eat(',')) this.type(); }
    this.classBody(decl);
    decl.endLine = this.toks[this.p - 1].line;
    return decl;
  }

  classBody(decl) {
    this.expect('{');
    if (decl.kind === 'enum') this.enumConstants(decl);
    while (!this.is('}')) {
      if (this.peek().t === 'eof') throw new Error('unexpected end of file in ' + decl.name);
      if (this.eat(';')) continue;
      const startLine = this.peek().line;
      const mods = this.modifiers();
      if (this.is('{')) {
        const body = this.block();
        if (mods.includes('static')) decl.statics.push({ line: startLine, body });
        else decl.statics.push({ line: startLine, body, instance: true });
        continue;
      }
      if (this.is('class') || this.is('interface') || this.is('enum') || this.is('record') || (this.is('@') && this.is('interface', 1))) {
        decl.types.push(this.typeDecl(mods));
        continue;
      }
      let typeParams = false;
      if (this.is('<')) { this.skipGroup(); typeParams = true; }
      // a constructor: the class's own name and a parameter list
      if (this.isId() && this.peek().v === decl.name && this.is('(', 1)) {
        this.next();
        const params = this.params();
        if (this.eat('throws')) { this.type(); while (this.eat(',')) this.type(); }
        const bodyStart = this.peek().line;
        const body = this.block();
        decl.ctors.push({ mods, params, body, line: bodyStart, endLine: this.toks[this.p - 1].line });
        continue;
      }
      const type = this.type();
      const name = this.ident();
      if (this.is('(')) {
        const params = this.params();
        while (this.is('[')) this.skipGroup();
        if (this.eat('throws')) { this.type(); while (this.eat(',')) this.type(); }
        if (this.eat('default')) { this.expr(); }
        let bodyText = null;
        const line = this.peek().line;
        if (this.is('{')) {
          const s = this.p;
          this.skipGroup();
          bodyText = { from: s, to: this.p };
        } else this.expect(';');
        decl.methods.push({ mods, type, name, params, line, endLine: this.toks[this.p - 1].line, body: bodyText, typeParams });
        continue;
      }
      // fields: name [= init] {, name [= init]};
      let fname = name;
      for (;;) {
        let dims = 0;
        while (this.is('[') && this.is(']', 1)) { this.next(); this.next(); dims++; }
        let init = null;
        if (this.eat('=')) init = this.is('{') ? this.arrayInit() : this.expr();
        decl.fields.push({ mods, type, name: fname, init, line: startLine });
        if (!this.eat(',')) break;
        fname = this.ident();
      }
      this.expect(';');
    }
    this.expect('}');
  }

  enumConstants(decl) {
    while (this.isId() || this.is('@')) {
      this.skipAnnotations();
      const name = this.ident();
      let args = [];
      if (this.is('(')) args = this.args();
      let body = null;
      if (this.is('{')) {
        body = { kind: 'class', name, fields: [], ctors: [], methods: [], types: [], statics: [], enumConsts: [], impl: [] };
        this.classBody(body);
      }
      decl.enumConsts.push({ name, args, body });
      if (!this.eat(',')) break;
    }
    this.eat(';');
  }

  params() {
    this.expect('(');
    const out = [];
    while (!this.is(')')) {
      this.modifiers();
      const type = this.type();
      const name = this.ident();
      while (this.is('[') && this.is(']', 1)) { this.next(); this.next(); }
      out.push({ type, name });
      if (!this.eat(',')) break;
    }
    this.expect(')');
    return out;
  }

  /* ---------------- statements ---------------- */
  block() {
    this.expect('{');
    const out = [];
    while (!this.is('}')) {
      if (this.peek().t === 'eof') throw new Error('unexpected end of file in a block');
      out.push(this.statement());
    }
    this.expect('}');
    return out;
  }

  statement() {
    const start = this.p;
    const line = this.peek().line;
    try {
      return this.statementInner(line);
    } catch (err) {
      // keep what could not be read, so the translator can refuse it
      this.p = start;
      this.skipStatement();
      return { k: 'unparsed', line, error: String(err.message || err) };
    }
  }

  skipStatement() {
    let depth = 0;
    for (;;) {
      const t = this.peek();
      if (t.t === 'eof') return;
      if (t.t === 'op') {
        if (t.v === '(' || t.v === '[' || t.v === '{') depth++;
        else if (t.v === ')' || t.v === ']') depth--;
        else if (t.v === '}') {
          if (depth === 0) return;               // the end of the enclosing block
          depth--;
          if (depth === 0) {
            this.next();
            // a statement that was a block ends here, unless more follows (a lambda argument, say)
            if (!(this.is(')') || this.is(',') || this.is('.') || this.is(';'))) return;
            continue;
          }
        } else if (t.v === ';' && depth === 0) { this.next(); return; }
      }
      this.next();
    }
  }

  statementInner(line) {
    if (this.is('{')) return { k: 'block', body: this.block(), line };
    if (this.eat(';')) return { k: 'empty', line };
    if (this.isId()) {
      const v = this.peek().v;
      if (v === 'if') {
        this.next();
        this.expect('(');
        const cond = this.expr();
        this.expect(')');
        const then = this.statement();
        let otherwise = null;
        if (this.eat('else')) otherwise = this.statement();
        return { k: 'if', cond, then, otherwise, line };
      }
      if (v === 'for' || v === 'while' || v === 'switch' || v === 'synchronized') {
        this.next();
        this.skipGroup();
        const body = this.is('{') ? (v === 'switch' ? (this.skipGroup(), []) : this.block()) : [this.statement()];
        return { k: 'loop', kind: v, body, line };
      }
      if (v === 'do') {
        this.next();
        const body = this.statement();
        this.expect('while');
        this.skipGroup();
        this.expect(';');
        return { k: 'loop', kind: 'do', body: [body], line };
      }
      if (v === 'try') {
        this.next();
        if (this.is('(')) this.skipGroup();
        const body = this.block();
        while (this.eat('catch')) { this.skipGroup(); this.block(); }
        if (this.eat('finally')) this.block();
        return { k: 'try', body, line };
      }
      if (v === 'return' || v === 'throw') {
        this.next();
        const e = this.is(';') ? null : this.expr();
        this.expect(';');
        return { k: v, e, line };
      }
      if (v === 'break' || v === 'continue') {
        this.next();
        if (this.isId()) this.next();
        this.expect(';');
        return { k: v, line };
      }
      if ((v === 'class' || v === 'final' || v === 'abstract') && (this.is('class', 1) || v === 'class')) {
        const mods = this.modifiers();
        return { k: 'class', decl: this.typeDecl(mods), line };
      }
      if (this.is(':', 1)) {            // a label
        this.next(); this.next();
        return this.statement();
      }
    }
    if (this.is('final') || this.is('@')) {
      this.modifiers();
    }
    if (this.looksLikeDecl()) {
      const type = this.type();
      const vars = [];
      for (;;) {
        const name = this.ident();
        while (this.is('[') && this.is(']', 1)) { this.next(); this.next(); }
        let init = null;
        if (this.eat('=')) init = this.is('{') ? this.arrayInit() : this.expr();
        vars.push({ name, init });
        if (!this.eat(',')) break;
      }
      this.expect(';');
      if (vars.length === 1) return { k: 'var', type, name: vars[0].name, init: vars[0].init, line };
      return { k: 'block', body: vars.map(x => ({ k: 'var', type, name: x.name, init: x.init, line })), line, flat: true };
    }
    const e = this.expr();
    this.expect(';');
    return { k: 'expr', e, line, endLine: this.toks[this.p - 1].line };
  }

  /* ---------------- expressions ---------------- */
  expr() { return this.assignment(); }

  assignment() {
    const l = this.ternary();
    const t = this.peek();
    if (t.t === 'op' && /^(?:=|\+=|-=|\*=|\/=|%=|&=|\|=|\^=|<<=|>>=|>>>=)$/.test(t.v)) {
      this.next();
      const r = this.is('{') ? this.arrayInit() : this.assignment();
      return { k: 'assign', op: t.v, l, r };
    }
    return l;
  }

  ternary() {
    const c = this.binary(0);
    if (this.eat('?')) {
      const a = this.ternaryArm();
      this.expect(':');
      const b = this.ternaryArm();
      return { k: 'tern', c, a, b };
    }
    return c;
  }
  ternaryArm() {
    if (this.lambdaAhead()) return this.lambda();
    return this.ternary();
  }

  binary(minPrec) {
    let l = this.unary();
    for (;;) {
      const t = this.peek();
      if (t.t === 'id' && t.v === 'instanceof') {
        if (minPrec > 9) break;
        this.next();
        this.eat('final');
        const type = this.type();
        let bind = null;
        if (this.isId()) bind = this.next().v;
        l = { k: 'instanceof', e: l, type, bind };
        continue;
      }
      if (t.t !== 'op') break;
      const prec = BIN_PREC[t.v];
      if (prec == null || prec < minPrec) break;
      this.next();
      const r = this.binary(prec + 1);
      l = { k: 'bin', op: t.v, l, r };
    }
    return l;
  }

  unary() {
    const t = this.peek();
    if (t.t === 'op' && (t.v === '+' || t.v === '-' || t.v === '!' || t.v === '~' || t.v === '++' || t.v === '--')) {
      this.next();
      const e = this.unary();
      if (t.v === '-' && e.k === 'lit' && typeof e.v === 'number') return { k: 'lit', v: -e.v, type: 'num' };
      return { k: 'un', op: t.v, e };
    }
    if (this.is('(') && this.castAhead()) {
      this.next();
      const type = this.type();
      while (this.eat('&')) this.type();
      this.expect(')');
      const e = this.lambdaAhead() ? this.lambda() : this.unary();
      return { k: 'cast', type, e };
    }
    return this.postfix(this.primary());
  }

  castAhead() {
    const save = this.p;
    try {
      this.next();
      if (!this.isId()) return false;
      const prim = PRIMS.has(this.peek().v);
      const type = this.type();
      while (this.eat('&')) this.type();
      if (!this.eat(')')) return false;
      if (prim) return true;
      if (!/^[A-Z]/.test(type.name.split('.').pop())) return false;
      const t = this.peek();
      if (t.t === 'id' || t.t === 'str' || t.t === 'num' || t.t === 'chr') return true;
      return t.t === 'op' && (t.v === '(' || t.v === '!' || t.v === '~');
    } catch (e) {
      return false;
    } finally {
      this.p = save;
    }
  }

  lambdaAhead() {
    if (this.isId() && this.is('->', 1)) return true;
    if (!this.is('(')) return false;
    const save = this.p;
    try {
      this.skipGroup();
      return this.is('->');
    } finally {
      this.p = save;
    }
  }

  lambda() {
    const params = [];
    if (this.isId()) params.push(this.next().v);
    else {
      this.expect('(');
      while (!this.is(')')) {
        this.modifiers();
        // either "x" or "Type x"
        if (this.isId() && (this.is(',', 1) || this.is(')', 1))) params.push(this.next().v);
        else { this.type(); params.push(this.ident()); }
        if (!this.eat(',')) break;
      }
      this.expect(')');
    }
    this.expect('->');
    if (this.is('{')) {
      const s = this.p;
      this.skipGroup();
      return { k: 'lambda', params, block: true, from: s, to: this.p };
    }
    return { k: 'lambda', params, body: this.expr() };
  }

  args() {
    this.expect('(');
    const out = [];
    while (!this.is(')')) {
      out.push(this.lambdaAhead() ? this.lambda() : (this.is('{') ? this.arrayInit() : this.expr()));
      if (!this.eat(',')) break;
    }
    this.expect(')');
    return out;
  }

  arrayInit() {
    this.expect('{');
    const items = [];
    while (!this.is('}')) {
      items.push(this.is('{') ? this.arrayInit() : this.expr());
      if (!this.eat(',')) break;
    }
    this.expect('}');
    return { k: 'array', items };
  }

  primary() {
    const t = this.peek();
    if (t.t === 'num') { this.next(); return { k: 'lit', v: t.v, type: 'num' }; }
    if (t.t === 'str') { this.next(); return { k: 'lit', v: t.v, type: 'str' }; }
    if (t.t === 'chr') { this.next(); return { k: 'lit', v: t.v, type: 'chr' }; }
    if (this.lambdaAhead()) return this.lambda();
    if (t.t === 'op' && t.v === '(') {
      this.next();
      const e = this.expr();
      this.expect(')');
      return { k: 'paren', e };
    }
    if (t.t === 'id') {
      switch (t.v) {
        case 'true': this.next(); return { k: 'lit', v: true, type: 'bool' };
        case 'false': this.next(); return { k: 'lit', v: false, type: 'bool' };
        case 'null': this.next(); return { k: 'lit', v: null, type: 'null' };
        case 'this': this.next(); return this.is('(') ? { k: 'call', obj: null, name: 'this', args: this.args() } : { k: 'this' };
        case 'super': this.next(); return this.is('(') ? { k: 'call', obj: null, name: 'super', args: this.args() } : { k: 'super' };
        case 'new': return this.creator();
        case 'switch': {
          this.next(); this.skipGroup(); this.skipGroup();
          return { k: 'switch' };
        }
        default:
          if (PRIMS.has(t.v) && this.is('.', 1) && this.is('class', 2)) {
            this.next(); this.next(); this.next();
            return { k: 'classLit', type: { name: t.v } };
          }
          this.next();
          if (this.is('(')) return { k: 'call', obj: null, name: t.v, args: this.args(), line: t.line };
          return { k: 'name', v: t.v, line: t.line };
      }
    }
    throw new Error(`unexpected '${t.v}' at line ${t.line}`);
  }

  creator() {
    const line = this.peek().line;
    this.expect('new');
    this.skipAnnotations();
    let name = this.ident();
    let targs = null;
    if (this.is('<')) targs = this.typeArgs();
    while (this.is('.') && this.isId(1)) {
      this.next();
      name += '.' + this.ident();
      if (this.is('<')) targs = this.typeArgs();
    }
    if (this.is('[')) {
      const dims = [];
      while (this.is('[')) {
        this.next();
        if (this.eat(']')) { dims.push(null); continue; }
        dims.push(this.expr());
        this.expect(']');
      }
      const init = this.is('{') ? this.arrayInit() : null;
      return { k: 'newArray', type: { name }, dims, init, line };
    }
    const args = this.args();
    let body = null;
    if (this.is('{')) {
      body = { kind: 'class', name: '(anonymous ' + name + ')', fields: [], ctors: [], methods: [], types: [], statics: [], enumConsts: [], impl: [] };
      this.classBody(body);
    }
    return { k: 'new', type: { name, args: targs }, args, body, line };
  }

  postfix(e) {
    for (;;) {
      if (this.is('.')) {
        this.next();
        if (this.is('<')) this.typeArgs();          // obj.<T>method()
        if (this.eat('new')) {                      // outer.new Inner()
          this.p--;
          const inner = this.creator();
          e = Object.assign(inner, { outer: e });
          continue;
        }
        if (this.eat('class')) { e = { k: 'classLit', type: e }; continue; }
        if (this.eat('this')) { e = { k: 'this', outer: e }; continue; }
        const nameTok = this.next();
        if (nameTok.t !== 'id') throw new Error(`expected a member name at line ${nameTok.line}`);
        if (this.is('(')) e = { k: 'call', obj: e, name: nameTok.v, args: this.args(), line: nameTok.line };
        else e = { k: 'field', obj: e, name: nameTok.v };
        continue;
      }
      if (this.is('::')) {
        this.next();
        const name = this.eat('new') ? 'new' : this.ident();
        e = { k: 'mref', obj: e, name };
        continue;
      }
      if (this.is('[') && this.is(']', 1)) {        // Foo[]::new
        this.next(); this.next();
        e = { k: 'arrayType', e };
        continue;
      }
      if (this.is('[')) {
        this.next();
        const idx = this.expr();
        this.expect(']');
        e = { k: 'index', obj: e, idx };
        continue;
      }
      if (this.is('++') || this.is('--')) { const op = this.next().v; e = { k: 'post', op, e }; continue; }
      // a generic type used as a value: Foo<Bar>::new, rare enough to stop at
      return e;
    }
  }
}

const BIN_PREC = {
  '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6,
  '<': 7, '>': 7, '<=': 7, '>=': 7, '<<': 8, '>>': 8, '>>>': 8,
  '+': 9, '-': 9, '*': 10, '/': 10, '%': 10,
};

/** Read a whole source file. Throws only when the file's outline itself cannot be read. */
function parseJava(src) {
  const ps = new Parser(src);
  const unit = ps.unit();
  unit.comments = ps.comments;
  unit.tokens = ps.toks;
  return unit;
}

/** The source text of a token range, roughly respaced: for skipped bodies that need looking at. */
function tokenText(unit, from, to) {
  return unit.tokens.slice(from, to).map(t => (t.t === 'str' ? JSON.stringify(t.v) : t.v)).join(' ');
}

module.exports = { parseJava, tokenize, tokenText };
