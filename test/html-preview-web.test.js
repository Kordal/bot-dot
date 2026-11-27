// An HTML file in the document viewer on the web page (ADR 281): it is drawn in a frame on the sandbox's own address
// with `sandbox="allow-scripts"` and nothing more, never as markup of this page, with a Rendered / Source toggle like
// Markdown's. Without the server's `html-preview`, or when the view has no address for the frame, it is its source.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { read, esc, element, words } = require('./web-page');

const FRAME = 'https://botdot.example.com:8443/ann/eyJoIjoiYSJ9.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA/index.html';
const SOURCE = '<h1>Acme</h1>\n<script>alert(1)</script>\n</iframe><img src=x onerror=alert(2)>';
const HTML = (extra = {}) => ({ name: 'index.html', size: 120, at: '2026-11-26T09:14:00Z', kind: 'text', type: 'text/plain', truncated: false, text: SOURCE, preview: { frame: FRAME, expires: new Date(Date.now() + 3_600_000).toISOString() }, ...extra });

function viewer(answers, { features = ['document-viewer', 'html-preview'] } = {}) {
  const box = element({}, { classes: ['hidden'] });
  const row = element(); const main = element();
  const listeners = {};
  const calls = [];
  const copied = [];
  const ctx = vm.createContext({
    ...words, state: { features, bots: [{ id: 'web', name: 'Website Builder' }], view: 'bot', botId: 'web' },
    esc, md: (s) => esc(s), msgTime: () => '09:14', fmtSize: (n) => `${n} B`, toast() {}, copyText: async (t) => { copied.push(t); return true; }, encodeURIComponent,
    $: (sel) => ({ '#doc-viewer': box, '#chat-row': row, '.main': main }[sel] || null),
    matchMedia: () => ({ matches: false }),
    api: async (p, opts = {}) => { calls.push([p, opts.method || 'GET']); const a = typeof answers[p] === 'function' ? answers[p]() : answers[p]; if (a === undefined) throw Object.assign(new Error('not found'), { status: 404 }); return a; },
    document: { addEventListener: (type, fn) => (listeners[type] ||= []).push(fn) },
  });
  vm.runInContext(`${read('viewer.js')}
;this.DocViewer = DocViewer;`, ctx);
  const click = async (data) => {
    const el = { dataset: data };
    const e = { target: { closest: (sel) => (sel === '[data-view]' ? el : null) }, preventDefault() {}, stopPropagation() {} };
    for (const fn of listeners.click) fn(e);
    await new Promise((r) => setImmediate(r));
  };
  // A tap on one of the viewer's own buttons, as the page's click listener sees it.
  const press = async (dv, extra = {}) => {
    const btn = { dataset: { dv, ...extra } };
    const e = { target: { closest: (sel) => (sel === '#doc-viewer [data-dv]' ? btn : null) } };
    for (const fn of listeners.click) fn(e);
    await new Promise((r) => setImmediate(r));
  };
  return { ctx, box, calls, copied, click, press };
}
const open = (v) => v.click({ view: '/bots/web/path?path=index.html', viewName: 'index.html', viewBot: 'web' });
const API = '/bots/web/path?path=index.html&view=1';

test('web: an HTML file opens rendered, in a frame with allow-scripts and nothing more on the sandbox address', async () => {
  const v = viewer({ [API]: HTML() });
  await open(v);
  const html = v.box.innerHTML;
  const frames = [...html.matchAll(/<iframe\b[^>]*>/g)].map((m) => m[0]);
  assert.equal(frames.length, 1);
  assert.match(frames[0], /sandbox="allow-scripts"/);
  assert.doesNotMatch(html, /allow-same-origin|allow-top-navigation|allow-popups|allow-forms|allow-modals/);
  assert.ok(frames[0].includes(`src="${FRAME}"`));
  assert.match(frames[0], /referrerpolicy="no-referrer"/);
  assert.doesNotMatch(html, /dv-lines/, 'not the source');
  assert.doesNotMatch(html, /<script|<img|srcdoc/, "the file's own markup never becomes this page's");
  assert.match(html, /<button type="button" data-dv="mode" data-mode="rendered" class="on" aria-pressed="true">Rendered<\/button>/);
  assert.match(html, /data-mode="source" class="" aria-pressed="false">Source code<\/button>/);
  assert.match(html, /data-dv="copy"/);
  assert.match(html, /href="\/api\/bots\/web\/path\?path=index\.html" download="index\.html"/);
});

test('web: Source shows its lines, escaped, with Copy and Download, and Rendered brings the frame back', async () => {
  const v = viewer({ [API]: HTML() });
  await open(v);
  await v.press('mode', { mode: 'source' });
  let html = v.box.innerHTML;
  assert.doesNotMatch(html, /<iframe/);
  assert.match(html, /<ol class="dv-lines"><li>&lt;h1&gt;Acme&lt;\/h1&gt;<\/li><li>&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/li><li>&lt;\/iframe&gt;&lt;img/);
  assert.doesNotMatch(html, /<img|<script/);
  assert.match(html, /data-dv="copy"/);
  assert.match(html, /download="index\.html"/);
  assert.match(html, /data-mode="source" class="on" aria-pressed="true"/);
  await v.press('copy');
  assert.deepEqual(v.copied, [SOURCE], 'what is copied is the source, in either mode');
  await v.press('mode', { mode: 'rendered' });
  html = v.box.innerHTML;
  assert.match(html, /<iframe[^>]*sandbox="allow-scripts"/);
  assert.doesNotMatch(html, /dv-lines/);
  await v.press('copy');
  assert.deepEqual(v.copied, [SOURCE, SOURCE]);
});

test("web: an .htm file too, and an address that ran out is signed again when Rendered is chosen", async () => {
  let n = 0;
  const v = viewer({ [API]: () => (n++ ? HTML({ preview: { frame: FRAME.replace('AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'), expires: new Date(Date.now() + 3_600_000).toISOString() } }) : HTML({ preview: { frame: FRAME, expires: new Date(Date.now() - 1000).toISOString() } })) });
  await open(v);
  await v.press('mode', { mode: 'source' });
  await v.press('mode', { mode: 'rendered' });
  assert.equal(v.calls.length, 2, 'read again for a new address');
  assert.ok(v.box.innerHTML.includes('BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB/index.html'), 'the frame is the new address');
});

test('web: without the preview on the server, or without an address for it, an HTML file is its source as before', async () => {
  const old = viewer({ [API]: HTML() }, { features: ['document-viewer'] });
  await open(old);
  assert.doesNotMatch(old.box.innerHTML, /<iframe/);
  assert.match(old.box.innerHTML, /<ol class="dv-lines"><li>&lt;h1&gt;/);
  assert.doesNotMatch(old.box.innerHTML, /data-mode=/, 'no toggle: nothing to toggle to');
  const none = viewer({ [API]: HTML({ preview: undefined }) });
  await open(none);
  assert.doesNotMatch(none.box.innerHTML, /<iframe|data-mode=/);
  assert.match(none.box.innerHTML, /dv-lines/);
});

test('web: an address that is not the sandbox\'s own https or http address is never framed', async () => {
  for (const frame of ['javascript:alert(1)', 'data:text/html,<script>alert(1)</script>', '//evil.example/x', '/api/bots', 'blob:https://x/1', 'https://a"onload="x', 'file:///etc/passwd']) {
    const v = viewer({ [API]: HTML({ preview: { frame, expires: null } }) });
    await open(v);
    assert.doesNotMatch(v.box.innerHTML, /<iframe/, frame);
    assert.match(v.box.innerHTML, /dv-lines/, frame);
  }
});

test('web: a Markdown file, a CSV and a text file are drawn as before, whatever else the answer says', async () => {
  const md = viewer({ '/bots/web/path?path=a.md&view=1': { name: 'a.md', size: 3, at: null, kind: 'markdown', type: 'text/markdown', truncated: false, text: '# hi', preview: { frame: FRAME } } });
  await md.click({ view: '/bots/web/path?path=a.md', viewName: 'a.md', viewBot: 'web' });
  assert.doesNotMatch(md.box.innerHTML, /<iframe/);
  const txt = viewer({ '/bots/web/path?path=a.txt&view=1': { name: 'a.txt', size: 3, at: null, kind: 'text', type: 'text/plain', truncated: false, text: 'hi', preview: { frame: FRAME } } });
  await txt.click({ view: '/bots/web/path?path=a.txt', viewName: 'a.txt', viewBot: 'web' });
  assert.doesNotMatch(txt.box.innerHTML, /<iframe/);
});

// ADR 282: the files beside an HTML file load too, when the server could bundle its folder.
test('web: the note beside Rendered says the files beside it load for a folder, and only what is in the file for one file', async () => {
  const one = viewer({ [API]: HTML() });
  await open(one);
  assert.match(one.box.innerHTML, /<span class="dv-count faint">Only what is in this file loads<\/span>/);
  assert.doesNotMatch(one.box.innerHTML, /files beside it/);
  const folder = viewer({ [API]: HTML({ preview: { frame: FRAME, expires: new Date(Date.now() + 3_600_000).toISOString(), bundle: true } }) });
  await open(folder);
  assert.match(folder.box.innerHTML, /<span class="dv-count faint">The files beside it load, nothing from the internet<\/span>/);
  assert.doesNotMatch(folder.box.innerHTML, /Only what is in this file loads/);
  assert.match(folder.box.innerHTML, /<iframe[^>]*sandbox="allow-scripts"/);
  // In Source the note is not there at all.
  await folder.press('mode', { mode: 'source' });
  assert.doesNotMatch(folder.box.innerHTML, /dv-count faint">(The files|Only what)/);
});

test("web: a frame may end in the file's own plain name, beside an index.html of its own, and in no other kind of name", async () => {
  const named = FRAME.replace('index.html', 'about.html');
  const v = viewer({ '/bots/web/path?path=about.html&view=1': HTML({ name: 'about.html', preview: { frame: named, expires: null, bundle: true } }) });
  await v.click({ view: '/bots/web/path?path=about.html', viewName: 'about.html', viewBot: 'web' });
  assert.ok(v.box.innerHTML.includes(`src="${named}"`));
  for (const end of ['app.js', '.hidden.html', 'a%20b.html', '..%2Fx.html', 'a/b.html', 'a.html/x', 'a.html?x=1']) {
    const bad = viewer({ [API]: HTML({ preview: { frame: FRAME.replace('index.html', end), expires: null } }) });
    await open(bad);
    assert.doesNotMatch(bad.box.innerHTML, /<iframe/, end);
  }
});
