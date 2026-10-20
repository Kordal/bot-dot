// Diagrams in replies on the web page (#177, ADR 041): public/diagrams.js and public/diagram-frame.js loaded the way the
// browser loads them (plain scripts), against a small stand-in page, a stand-in frame and a stand-in Mermaid. A
// ```mermaid block (mdHTML's <pre class="mermaid-src">) becomes its drawing with "Show code" under it; the frame Mermaid
// draws in is made the first time a block is on the page, and never for a page without one; Mermaid is set to its
// strict security level; a block it can't draw stays its code with "Diagram could not be drawn". The real Mermaid in a
// real browser, under the page's and the frame's policies, is walked in test/browser/diagram.cjs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PUBLIC = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');
const ORIGIN = 'https://box.tail.ts.net';
const tick = () => new Promise((r) => setImmediate(r));
const settle = async () => { for (let i = 0; i < 5; i++) await tick(); };

// A stand-in page: elements in a tree, as much of the DOM as diagrams.js uses.
function page() {
  const doc = { frames: [] };
  const make = (tag) => {
    const el = {
      tagName: tag.toUpperCase(), className: '', dataset: {}, hidden: false, children: [], parent: null, listeners: {}, attrs: {}, type: '',
      _text: '', innerHTML: '', ownerDocument: doc,
      get textContent() { return this.children.length ? this.children.map((c) => c.textContent).join('') : this._text; },
      set textContent(v) { this._text = String(v); this.children = []; },
      get isConnected() { let e = this; while (e.parent) e = e.parent; return e === doc.root; },
      append(...kids) {
        for (const k of kids) {
          if (k.tagName === '#FRAGMENT') { this.innerHTML += k.innerHTML; continue; }
          k.parent?.children.splice(k.parent.children.indexOf(k), 1);
          k.parent = this;
          this.children.push(k);
          if (k.tagName === 'IFRAME') doc.frames.push(k);
        }
      },
      after(k) { const sib = this.parent.children; k.parent = this.parent; sib.splice(sib.indexOf(this) + 1, 0, k); },
      replaceWith(k) { const sib = this.parent.children; k.parent = this.parent; sib[sib.indexOf(this)] = k; this.parent = null; },
      remove() { if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1); this.parent = null; },
      setAttribute(n, v) { this.attrs[n] = String(v); },
      matches(sel) { return sel === 'pre.mermaid-src' && this.tagName === 'PRE' && this.className.split(' ').includes('mermaid-src'); },
      querySelector(sel) { return this.querySelectorAll(sel)[0] || null; },
      querySelectorAll(sel) { const out = []; const walk = (e) => { for (const c of e.children) { if (c.matches(sel)) out.push(c); walk(c); } }; walk(this); return out; },
      addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); },
      click() { for (const fn of this.listeners.click || []) fn({}); },
    };
    // A <template>'s markup is its content's, which the page adds as it is (the stand-in has no SVG to clean).
    if (tag === 'template') Object.defineProperty(el, 'innerHTML', { set(v) { el.content = Object.assign(make('#fragment'), { innerHTML: v }); } });
    // A frame's window, which keeps what the page sends it.
    if (tag === 'iframe') el.contentWindow = { sent: [], postMessage(data, origin) { this.sent.push({ data, origin }); } };
    return el;
  };
  doc.createElement = make;
  doc.root = make('html');
  doc.head = make('head');
  doc.body = make('body');
  doc.root.append(doc.head, doc.body);
  return doc;
}
// A reply as mdHTML draws it: a paragraph, then each source as <pre class="mermaid-src"><code>…</code></pre>.
function reply(doc, ...sources) {
  const md = doc.createElement('div');
  md.className = 'md';
  const p = doc.createElement('p');
  p.textContent = 'Here it is:';
  md.append(p);
  for (const s of sources) {
    const pre = doc.createElement('pre');
    pre.className = 'mermaid-src';
    const code = doc.createElement('code');
    code.textContent = s;
    pre.append(code);
    md.append(pre);
  }
  doc.body.append(md);
  return md;
}
// diagrams.js in a page of its own, with its console's errors kept. The frame answers as diagram-frame.js would:
// ready (or not), then each source drawn as an SVG that holds it, and a source that says "oops" not read.
function load() {
  const doc = page();
  const errors = [], listeners = [];
  const ctx = vm.createContext({
    document: doc, console: { error: (...a) => errors.push(a.join(' ')) }, setTimeout, clearTimeout, location: { origin: ORIGIN },
    addEventListener: (type, fn) => { if (type === 'message') listeners.push(fn); },
    removeEventListener: (type, fn) => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); },
  });
  vm.runInContext(read('diagrams.js'), ctx);
  const message = (source, data) => { for (const fn of [...listeners]) fn({ source, data }); };
  const frame = () => doc.frames.at(-1);
  const ready = (ok = true) => message(frame().contentWindow, ok ? { ready: true } : { ready: false, error: 'Mermaid did not load: mermaid is not defined' });
  // Every drawing asked of the frame so far, answered.
  const drawn = [];
  const answer = () => {
    const w = frame().contentWindow;
    for (const { data } of w.sent.splice(0)) {
      drawn.push(data.source);
      message(w, data.source.includes('oops') ? { id: data.id, error: 'Parse error on line 1' } : { id: data.id, svg: `<svg id="diagram-${data.id}">${data.source}</svg>` });
    }
  };
  return { doc, errors, Diagrams: ctx.Diagrams, frame, ready, answer, drawn, message };
}
const figureOf = (md) => md.children.find((c) => c.className === 'diagram');
const noteOf = (md) => md.children.find((c) => c.className === 'diagram-note');

test('index.html loads diagrams.js before app.js, and the page draws what is added to it and to the dialog', () => {
  const html = read('index.html');
  const at = (f) => html.indexOf(`<script src="/${f}"></script>`);
  assert.ok(at('diagrams.js') > 0 && at('diagrams.js') < at('app.js'));
  assert.match(read('app.js'), /Diagrams\.watch\(document\.getElementById\('app'\)\);\nDiagrams\.watch\(document\.getElementById\('modal'\)\);/);
});

test('a page without a diagram block makes no frame and loads no Mermaid', () => {
  const { doc, Diagrams } = load();
  const md = reply(doc);
  const plain = doc.createElement('pre');
  plain.append(Object.assign(doc.createElement('code'), { textContent: 'flowchart LR' }));
  md.append(plain);
  Diagrams.draw(md);
  assert.equal(doc.frames.length, 0);
});

test('a diagram block makes the frame once, out of sight, and is drawn in its place from what the frame sends back', async () => {
  const { doc, Diagrams, frame, ready, answer, drawn } = load();
  const md = reply(doc, 'flowchart LR\n  A --> B');
  Diagrams.draw(md);
  Diagrams.draw(md); // drawn again by a second change of the page: still one frame, one drawing
  assert.equal(doc.frames.length, 1);
  assert.equal(frame().src, '/diagram-frame.html');
  assert.equal(frame().parent, doc.body);
  assert.equal(frame().className, 'diagram-frame');
  assert.equal(frame().attrs['aria-hidden'], 'true');
  assert.equal(frame().tabIndex, -1);
  ready();
  await settle();
  assert.deepEqual(frame().contentWindow.sent.map((s) => s.origin), [ORIGIN], 'sent to the frame of its own address only');
  answer();
  await settle();
  assert.deepEqual(drawn, ['flowchart LR\n  A --> B'], 'drawn from the text of the code, once');
  const figure = figureOf(md);
  assert.ok(figure, 'the drawing is where the block was');
  const [svg, pre, toggle] = figure.children;
  assert.equal(svg.className, 'diagram-svg');
  assert.match(svg.innerHTML, /^<svg id="diagram-\d+">/);
  assert.equal(svg.hidden, false);
  assert.ok(pre.matches('pre.mermaid-src') && pre.hidden, 'the code stays, hidden');
  assert.equal(toggle.tagName, 'BUTTON');
  assert.equal(toggle.type, 'button');
  assert.equal(toggle.textContent, 'Show code');
  assert.equal(md.children[0].textContent, 'Here it is:', 'the rest of the reply as it was');
});

test('"Show code" switches to the code and "Show diagram" back', async () => {
  const { doc, Diagrams, ready, answer } = load();
  const md = reply(doc, 'sequenceDiagram\n  A->>B: hi');
  Diagrams.draw(md);
  ready();
  await settle();
  answer();
  await settle();
  const [svg, pre, toggle] = figureOf(md).children;
  toggle.click();
  assert.deepEqual([svg.hidden, pre.hidden, toggle.textContent], [true, false, 'Show diagram']);
  toggle.click();
  assert.deepEqual([svg.hidden, pre.hidden, toggle.textContent], [false, true, 'Show code']);
});

test('a block Mermaid cannot read stays its code with a note, says why in the console, and the next block is still drawn', async () => {
  const { doc, Diagrams, ready, answer, errors } = load();
  const md = reply(doc, 'flowchart oops', 'flowchart LR\n  A --> B');
  Diagrams.draw(md);
  ready();
  await settle();
  answer();
  await settle();
  const pres = md.querySelectorAll('pre.mermaid-src');
  assert.equal(pres[0].parent, md, 'the bad block is not moved');
  assert.equal(pres[0].hidden, false);
  assert.equal(noteOf(md).textContent, 'Diagram could not be drawn');
  assert.equal(md.children[md.children.indexOf(pres[0]) + 1], noteOf(md), 'right under the code');
  assert.equal(md.children.filter((c) => c.tagName === 'BUTTON').length, 0, 'no "Show code" on it');
  assert.ok(figureOf(md), 'the good block is drawn');
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Parse error on line 1/);
});

test('only the frame answers: a message from anywhere else draws nothing', async () => {
  const { doc, Diagrams, frame, ready, message } = load();
  const md = reply(doc, 'flowchart LR\n  A --> B');
  Diagrams.draw(md);
  message({}, { ready: true }); // another window says it is ready
  await settle();
  assert.equal(frame().contentWindow.sent.length, 0);
  ready();
  await settle();
  const { id } = frame().contentWindow.sent[0].data;
  message({}, { id, svg: '<svg>not from the frame</svg>' });
  await settle();
  assert.equal(figureOf(md), undefined);
});

test('a thread drawn again draws no diagram again, and a block gone before its drawing came is left alone', async () => {
  const { doc, Diagrams, ready, answer, drawn } = load();
  const gone = reply(doc, 'flowchart LR\n  X --> Y');
  Diagrams.draw(gone);
  gone.remove();
  ready();
  await settle();
  answer();
  await settle();
  assert.equal(figureOf(gone), undefined, 'nothing put in a reply that is no longer on the page');
  const first = reply(doc, 'flowchart LR\n  A --> B');
  Diagrams.draw(first);
  await settle();
  answer();
  await settle();
  first.remove();
  const again = reply(doc, 'flowchart LR\n  A --> B');
  Diagrams.draw(again);
  await settle();
  answer();
  await settle();
  assert.ok(figureOf(again));
  assert.equal(drawn.filter((s) => s === 'flowchart LR\n  A --> B').length, 1, 'the same source is drawn once');
  assert.equal(figureOf(again).children[0].innerHTML, figureOf(first).children[0].innerHTML);
});

test('a frame without Mermaid leaves the code with the note, and the next block makes a new frame', async () => {
  const { doc, Diagrams, frame, ready, answer, errors } = load();
  const md = reply(doc, 'flowchart LR\n  A --> B');
  Diagrams.draw(md);
  const failed = frame();
  ready(false);
  await settle();
  assert.equal(noteOf(md).textContent, 'Diagram could not be drawn');
  assert.equal(failed.parent, null, 'the failed frame is taken away');
  assert.match(errors[0], /Mermaid did not load/);
  const next = reply(doc, 'flowchart LR\n  A --> B');
  Diagrams.draw(next);
  assert.equal(doc.frames.length, 2);
  ready();
  await settle();
  answer();
  await settle();
  assert.ok(figureOf(next), 'drawn now');
});

// diagram-frame.js in a frame of its own, after a stand-in Mermaid (or none), with the page that holds it.
function frameWith(mermaid) {
  const said = [], listeners = [];
  const parent = { postMessage: (data, origin) => said.push({ data, origin }) };
  const settings = [];
  const ctx = vm.createContext({
    parent, location: { origin: ORIGIN },
    addEventListener: (type, fn) => { if (type === 'message') listeners.push(fn); },
    mermaid: mermaid && {
      initialize: (s) => settings.push(s),
      async render(id, source) { if (source.includes('oops')) throw new Error('Parse error on line 1'); return { svg: `<svg id="${id}">${source}</svg>` }; },
    },
  });
  vm.runInContext(read('diagram-frame.js'), ctx);
  const send = async (data, { source = parent, origin = ORIGIN } = {}) => { for (const fn of listeners) await fn({ source, origin, data }); };
  return { said, settings, send };
}

test('the frame sets Mermaid to strict, says it is ready, and draws what its page sends', async () => {
  const { said, settings, send } = frameWith(true);
  assert.equal(settings.length, 1);
  assert.equal(settings[0].securityLevel, 'strict');
  assert.equal(settings[0].startOnLoad, false);
  assert.equal(settings[0].suppressErrorRendering, true);
  assert.equal(settings[0].theme, 'dark');
  assert.deepEqual(JSON.parse(JSON.stringify(said)), [{ data: { ready: true }, origin: ORIGIN }]);
  await send({ id: 1, source: 'flowchart LR\n  A --> B' });
  await send({ id: 2, source: 'flowchart oops' });
  assert.deepEqual(JSON.parse(JSON.stringify(said.slice(1))), [
    { data: { id: 1, svg: '<svg id="diagram-1">flowchart LR\n  A --> B</svg>' }, origin: ORIGIN },
    { data: { id: 2, error: 'Parse error on line 1' }, origin: ORIGIN },
  ]);
});

test('the frame answers only its page, from the same address, and says so when Mermaid is not there', async () => {
  const { said, send } = frameWith(true);
  await send({ id: 1, source: 'flowchart LR' }, { source: {} });
  await send({ id: 1, source: 'flowchart LR' }, { origin: 'https://elsewhere.example' });
  await send({ id: 'x', source: 'flowchart LR' });
  assert.equal(said.length, 1, 'only "ready"');
  const none = frameWith(null);
  assert.equal(none.said.length, 1);
  assert.equal(none.said[0].data.ready, false);
  assert.match(none.said[0].data.error, /^Mermaid did not load/);
});

test('the frame loads only its own scripts: Mermaid, then diagram-frame.js', () => {
  const html = read('diagram-frame.html');
  assert.deepEqual([...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]), ['/vendor/mermaid/mermaid.min.js', '/diagram-frame.js']);
  assert.doesNotMatch(html, /<script>/, 'no script of its own in the page');
});

test('a diagram has room on the page: its drawing fits the bubble, what is hidden is not shown, the frame is out of sight', () => {
  const css = read('style.css');
  assert.match(css, /\n\.md \.diagram \[hidden\] \{ display: none; \}/);
  assert.match(css, /\n\.md \.diagram-svg svg \{[^}]*max-width: 100%;[^}]*\}/);
  assert.match(css, /\n\.md \.diagram-note \{[^}]*color: var\(--muted\);[^}]*\}/);
  assert.match(css, /\n\.diagram-frame \{[^}]*position: fixed; left: -10000px;[^}]*visibility: hidden;[^}]*\}/);
});
