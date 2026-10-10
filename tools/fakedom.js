/* A small pretend DOM, enough for the menus' windows to be built and
   clicked through without a browser (tools/socialtest.js). Elements,
   text, attributes, classes, events that bubble, and querySelector for
   tags, ids, classes and attributes joined by spaces or '>'. innerHTML is
   kept as its text with the tags taken out. Nothing is laid out. */
'use strict';

const ENTITIES = { '&times;': '×', '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'", '&nbsp;': '\u00a0' };

class Node0 {
  constructor(doc) { this.ownerDocument = doc; this.parentNode = null; this.childNodes = []; this._on = {}; }
  get firstChild() { return this.childNodes[0] || null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] || null; }
  get children() { return this.childNodes.filter(n => n.nodeType === 1); }
  get nextSibling() { const p = this.parentNode; return p ? p.childNodes[p.childNodes.indexOf(this) + 1] || null : null; }
  get isConnected() { let n = this; while (n) { if (n === this.ownerDocument) return true; n = n.parentNode; } return false; }
  _adopt(c) {
    // as a browser does: anything that is not a node goes in as its text ("null" included)
    if (c == null || typeof c !== 'object') c = this.ownerDocument.createTextNode(String(c));
    if (c.nodeType === 11) return c.childNodes.slice();
    if (c.parentNode) c.parentNode.removeChild(c);
    c.parentNode = this;
    return [c];
  }
  appendChild(c) { for (const n of this._adopt(c)) this.childNodes.push(n); return c; }
  append(...cs) { for (const c of cs) this.appendChild(c); }
  prepend(...cs) { for (const c of cs.reverse()) this.insertBefore(c, this.firstChild); }
  insertBefore(c, ref) {
    if (!ref) return this.appendChild(c);
    const nodes = this._adopt(c);
    const i = this.childNodes.indexOf(ref);
    this.childNodes.splice(i < 0 ? this.childNodes.length : i, 0, ...nodes);
    return c;
  }
  removeChild(c) { const i = this.childNodes.indexOf(c); if (i >= 0) this.childNodes.splice(i, 1); c.parentNode = null; return c; }
  remove() { if (this.parentNode) this.parentNode.removeChild(this); }
  replaceWith(n) { const p = this.parentNode; if (!p) return; p.insertBefore(n, this); p.removeChild(this); }
  contains(n) { while (n) { if (n === this) return true; n = n.parentNode; } return false; }
  get textContent() { return this.childNodes.map(n => n.textContent).join(''); }
  set textContent(v) { for (const c of this.childNodes) c.parentNode = null; this.childNodes = []; if (v !== '' && v != null) this.appendChild(this.ownerDocument.createTextNode(String(v))); }
  addEventListener(type, fn) { (this._on[type] = this._on[type] || []).push(fn); }
  removeEventListener(type, fn) { const l = this._on[type]; if (l) { const i = l.indexOf(fn); if (i >= 0) l.splice(i, 1); } }
  dispatchEvent(ev) {
    ev.target = ev.target || this;
    let n = this;
    while (n) {
      ev.currentTarget = n;
      for (const fn of (n._on[ev.type] || []).slice()) fn.call(n, ev);
      if (ev._stopped || ev.bubbles === false) break;
      n = n.parentNode || (n === n.ownerDocument ? null : null);
    }
    return !ev.defaultPrevented;
  }
}

class Text extends Node0 {
  constructor(doc, data) { super(doc); this.nodeType = 3; this.data = String(data); }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
}

function makeEvent(type, extra) {
  return Object.assign({
    type, bubbles: true, defaultPrevented: false, _stopped: false,
    stopPropagation() { this._stopped = true; }, stopImmediatePropagation() { this._stopped = true; },
    preventDefault() { this.defaultPrevented = true; },
  }, extra || {});
}

class Element extends Node0 {
  constructor(doc, tag) {
    super(doc);
    this.nodeType = 1;
    this.tagName = String(tag).toUpperCase();
    this.attrs = new Map();
    this.style = { setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; }, getPropertyValue(k) { return this[k] || ''; } };
    this.dataset = {};
    this.scrollTop = 0;
    const self = this;
    this.classList = {
      _get: () => (self.getAttribute('class') || '').split(/\s+/).filter(Boolean),
      _set: (list) => self.setAttribute('class', list.join(' ')),
      add(...c) { const l = this._get(); for (const x of c) if (!l.includes(x)) l.push(x); this._set(l); },
      remove(...c) { this._set(this._get().filter(x => !c.includes(x))); },
      contains(c) { return this._get().includes(c); },
      toggle(c, on) { const has = this.contains(c); const want = on === undefined ? !has : !!on; if (want && !has) this.add(c); if (!want && has) this.remove(c); return want; },
    };
  }
  get className() { return this.getAttribute('class') || ''; }
  set className(v) { this.setAttribute('class', String(v)); }
  get id() { return this.getAttribute('id') || ''; }
  set id(v) { this.setAttribute('id', String(v)); }
  get title() { return this.getAttribute('title') || ''; }
  set title(v) { this.setAttribute('title', String(v)); }
  get type() { return this.getAttribute('type') || ''; }
  get value() { return this._value !== undefined ? this._value : (this.getAttribute('value') || ''); }
  set value(v) { this._value = String(v); }
  get checked() { return this._checked !== undefined ? this._checked : this.hasAttribute('checked'); }
  set checked(v) { this._checked = !!v; }
  get disabled() { return this.hasAttribute('disabled'); }
  set disabled(v) { if (v) this.setAttribute('disabled', ''); else this.removeAttribute('disabled'); }
  get hidden() { return this.hasAttribute('hidden'); }
  set hidden(v) { if (v) this.setAttribute('hidden', ''); else this.removeAttribute('hidden'); }
  get tabIndex() { return +(this.getAttribute('tabindex') || 0); }
  set tabIndex(v) { this.setAttribute('tabindex', String(v)); }
  get offsetWidth() { return 0; }
  get offsetParent() { return this.isConnected ? this.parentNode : null; }
  get isContentEditable() { return false; }
  get innerHTML() { return this.textContent; }
  set innerHTML(v) {
    const text = String(v == null ? '' : v).replace(/<[^>]*>/g, '').replace(/&[#a-z0-9]+;/gi, m => ENTITIES[m] || m);
    this.textContent = text;
    this._html = String(v);
  }
  setAttribute(k, v) { this.attrs.set(String(k).toLowerCase(), String(v)); }
  getAttribute(k) { const v = this.attrs.get(String(k).toLowerCase()); return v === undefined ? null : v; }
  hasAttribute(k) { return this.attrs.has(String(k).toLowerCase()); }
  removeAttribute(k) { this.attrs.delete(String(k).toLowerCase()); }
  toggleAttribute(k, on) { const want = on === undefined ? !this.hasAttribute(k) : !!on; if (want) this.setAttribute(k, ''); else this.removeAttribute(k); return want; }
  focus() { this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = this.ownerDocument.body; }
  select() { this.ownerDocument._selected = this.value; }
  setSelectionRange() {}
  get selectionStart() { return this.value.length; }
  get selectionEnd() { return this.value.length; }
  getBoundingClientRect() { return { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 }; }
  scrollIntoView() {}
  setPointerCapture() {}
  click() { if (this.disabled) return; this.dispatchEvent(makeEvent('click')); }
  matches(sel) { return parseGroups(sel).some(g => matchChain(this, g)); }
  closest(sel) { let n = this; while (n && n.nodeType === 1) { if (n.matches(sel)) return n; n = n.parentNode; } return null; }
  querySelectorAll(sel) {
    const groups = parseGroups(sel);
    const out = [];
    const walk = (n) => { for (const c of n.childNodes) { if (c.nodeType !== 1) continue; if (groups.some(g => matchChain(c, g, this))) out.push(c); walk(c); } };
    walk(this);
    return out;
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  getElementsByTagName(t) { return this.querySelectorAll(t); }
}

/* ---- selectors: groups of chains of compounds ---- */
function parseCompound(s) {
  const c = { tag: null, id: null, classes: [], attrs: [] };
  const re = /([a-zA-Z][\w-]*)|#([\w-]+)|\.([\w-]+)|\[([\w-]+)(?:([~^$*|]?=)"?([^"\]]*)"?)?\]|:[\w-]+(?:\([^)]*\))?/g;
  let m;
  while ((m = re.exec(s))) {
    if (m[1]) c.tag = m[1].toUpperCase();
    else if (m[2]) c.id = m[2];
    else if (m[3]) c.classes.push(m[3]);
    else if (m[4]) c.attrs.push({ name: m[4].toLowerCase(), op: m[5] || null, value: m[6] });
    // pseudo-classes are taken as matching
  }
  return c;
}
function parseGroups(sel) {
  return String(sel).split(',').map(g => {
    const parts = g.trim().replace(/\s*>\s*/g, ' > ').split(/\s+/).filter(Boolean);
    const chain = [];
    let rel = ' ';
    for (const p of parts) {
      if (p === '>') { rel = '>'; continue; }
      if (p === ':scope') { chain.push({ scope: true, rel }); rel = ' '; continue; }
      chain.push(Object.assign(parseCompound(p), { rel }));
      rel = ' ';
    }
    return chain;
  });
}
function matchOne(n, c, scope) {
  if (c.scope) return n === scope;
  if (!n || n.nodeType !== 1) return false;
  if (c.tag && n.tagName !== c.tag) return false;
  if (c.id && n.id !== c.id) return false;
  const cls = (n.getAttribute('class') || '').split(/\s+/);
  for (const k of c.classes) if (!cls.includes(k)) return false;
  for (const a of c.attrs) {
    const v = a.name.startsWith('data-') && n.dataset[camel(a.name.slice(5))] !== undefined ? String(n.dataset[camel(a.name.slice(5))]) : n.getAttribute(a.name);
    if (v === null) return false;
    if (a.op === '=' && v !== a.value) return false;
    if (a.op === '^=' && !v.startsWith(a.value)) return false;
  }
  return true;
}
const camel = (s) => s.replace(/-([a-z])/g, (m, c) => c.toUpperCase());
function matchChain(n, chain, scope) {
  // right to left: the last compound is the element itself
  let i = chain.length - 1;
  if (!matchOne(n, chain[i], scope)) return false;
  let cur = n;
  while (i > 0) {
    const rel = chain[i].rel;
    i--;
    if (rel === '>') { cur = cur.parentNode; if (!matchOne(cur, chain[i], scope)) return false; }
    else {
      cur = cur.parentNode;
      while (cur && !matchOne(cur, chain[i], scope)) cur = cur.parentNode;
      if (!cur) return false;
    }
  }
  return true;
}

class Document extends Node0 {
  constructor() {
    super(null);
    this.ownerDocument = this;
    this.nodeType = 9;
    this.documentElement = this.createElement('html');
    this.head = this.createElement('head');
    this.body = this.createElement('body');
    this.documentElement.append(this.head, this.body);
    this.appendChild(this.documentElement);
    this.activeElement = this.body;
    this.visibilityState = 'visible';
    this.readyState = 'complete';
    this._selected = null;
    this.copied = [];
  }
  createElement(tag) { return new Element(this, tag); }
  createElementNS(ns, tag) { return new Element(this, tag); }
  createTextNode(t) { return new Text(this, t); }
  createDocumentFragment() { const f = new Element(this, '#fragment'); f.nodeType = 11; return f; }
  getElementById(id) { return this.documentElement.querySelector('#' + id); }
  querySelector(s) { return this.documentElement.querySelector(s); }
  querySelectorAll(s) { return this.documentElement.querySelectorAll(s); }
  execCommand(cmd) { if (cmd === 'copy') { this.copied.push(this._selected); return true; } return false; }
}

module.exports = { Document, makeEvent };
