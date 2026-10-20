// Stand-ins for the tests that run parts of the web page's own code (public/app.js) without a browser:
// a part of the file cut out by its first and last line, and elements that hold what the code sets on them.
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { webSource } = require('./web-source');

const PUBLIC = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');
const app = webSource();

// A part of app.js, from one line of it up to another.
function cut(from, to) {
  const a = app.indexOf(from), b = app.indexOf(to, a + from.length);
  assert.ok(a >= 0 && b > a, `app.js has "${from}" … "${to}"`);
  return app.slice(a, b);
}

// The page's reply drafts (app.js, "the reply draft") for code that draws none: no draft, and none kept.
const noDrafts = { draftHTML: () => '', replyDrafts: { of: () => '', say() {}, end() {} }, showsDrafts: () => false };

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// An element: its classes, its listeners, and whatever the page sets on it. parts: what querySelector finds in it.
function element(parts = {}, props = {}) {
  const classes = new Set(props.classes || []);
  const el = {
    classList: {
      add: (c) => classes.add(c),
      remove: (c) => classes.delete(c),
      contains: (c) => classes.has(c),
      toggle: (c, on = !classes.has(c)) => { if (on) classes.add(c); else classes.delete(c); return on; },
    },
    dataset: {}, style: {}, listeners: {}, innerHTML: '', textContent: '', value: '', disabled: false, removed: false,
    addEventListener(type, fn) { (el.listeners[type] ||= []).push(fn); },
    querySelector: (sel) => parts[sel] || null,
    querySelectorAll: (sel) => (Array.isArray(parts[sel]) ? parts[sel] : parts[sel] ? [parts[sel]] : []),
    closest: () => null,
    remove() { el.removed = true; },
    focus() {},
    ...props,
  };
  delete el.classes;
  return el;
}
// The page's $ and $$ over such elements: the parts of `root`, or of the page given.
const finders = (page = element()) => ({
  $: (sel, root = page) => root.querySelector(sel),
  $$: (sel, root = page) => root.querySelectorAll(sel),
});

// A stand-in fetch that answers with a status and a body; without a body, one that is no JSON, as a gateway's page.
const answer = (status, body) => async () => ({ ok: status >= 200 && status < 300, status, statusText: 'Browser Words', json: async () => { if (body === undefined) throw new SyntaxError('Unexpected token <'); return body; } });

// A chat thread that keeps what is put into it in order: the rows drawn as HTML, and the boxes the page makes
// itself (document.createElement). `make` stands in for that; `find` is the page's $ and $$ over the thread:
// a child by its class, the buttons of a row by their data attribute. names: the children's first class, or
// their HTML when they have none.
function thread() {
  const cls = (html) => (String(html).match(/^\s*<\w+ class="([^"]*)"/) || [])[1] || '';
  const make = (className = '', html = '') => {
    const n = { className, html, innerHTML: '', dataset: {}, parent: null, buttons: new Map(),
      remove() { if (n.parent) n.parent.children.splice(n.parent.children.indexOf(n), 1); n.parent = null; },
      before(x) { x.remove(); n.parent.children.splice(n.parent.children.indexOf(n), 0, x); x.parent = n.parent; },
      insertAdjacentHTML(where, h) { assert.equal(where, 'beforebegin'); n.before(make(cls(h), h)); },
    };
    Object.defineProperty(n, 'nextElementSibling', { get: () => (n.parent ? n.parent.children[n.parent.children.indexOf(n) + 1] || null : null) });
    Object.defineProperty(n, 'previousElementSibling', { get: () => (n.parent ? n.parent.children[n.parent.children.indexOf(n) - 1] || null : null) });
    Object.defineProperty(n, 'isConnected', { get: () => !!n.parent });
    return n;
  };
  const t = { children: [], dataset: {}, scrollHeight: 0, scrollTop: 0, clientHeight: 0,
    append(x) { x.remove(); t.children.push(x); x.parent = t; },
    insertAdjacentHTML(where, h) { assert.equal(where, 'beforeend'); t.append(make(cls(h), h)); },
  };
  Object.defineProperty(t, 'lastElementChild', { get: () => t.children[t.children.length - 1] || null });
  const has = (n, c) => n.className.split(' ').includes(c);
  // The buttons a node's HTML holds for `data-<attr>`, the same stand-in for the same value while the HTML stays.
  const buttons = (n, attr) => [...(n.html + n.innerHTML).matchAll(new RegExp(`data-${attr}="([^"]*)"`, 'g'))].map(([, value]) => {
    const key = `${attr}=${value}`;
    if (!n.buttons.has(key)) n.buttons.set(key, { dataset: { [attr.replace(/-(\w)/g, (_, c) => c.toUpperCase())]: value }, onclick: null, disabled: false });
    return n.buttons.get(key);
  });
  const all = (sel, root = t) => {
    const attr = (sel.match(/^\[data-([\w-]+)\]$/) || [])[1];
    const nodes = root === t ? t.children : [root];
    if (attr) return nodes.flatMap((n) => buttons(n, attr));
    return root === t && sel.startsWith('.') ? t.children.filter((n) => has(n, sel.slice(1))) : [];
  };
  const find = { $: (sel, root) => all(sel, root)[0] || null, $$: all };
  const names = () => t.children.map((n) => n.className.split(' ')[0] || n.html);
  return { thread: t, make, find, names };
}

// The page's own whileBusy (app.js), for the code that answers a press with it.
const whileBusy = require('vm').runInNewContext(`${cut('// A button whose answer waits on the server', 'function toast(')}; whileBusy`);

module.exports = { noDrafts, app, read, cut, esc, element, finders, answer, thread, whileBusy };
