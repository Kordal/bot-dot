// The document viewer on the web page (#251): a tap on a file chip opens public/viewer.js's viewer instead of a
// download, Markdown is drawn by the chat's own md() so HTML in a file stays text, a CSV is a table to sort and
// search, and a path in a bot's reply is a link (filePaths and linkPaths in public/app.js, against the cases the
// Android app shares, test/fixtures/file-paths.json), never one in a code block.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { cut, read, esc, element, words } = require('./web-page');

const fixture = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'file-paths.json'), 'utf8'));

// md() and the links of a reply, cut out of app.js, with the features the server named.
function chat(features = ['document-viewer']) {
  const ctx = vm.createContext({ ...words, URL, esc, state: { features } });
  vm.runInContext(`${cut('function md(src, botId)', 'function linkifyChat(root)')}
    Object.assign(this, { md, filePaths, isFilePath, linkPaths });`, ctx);
  return ctx;
}

for (const c of fixture.cases) {
  test(`web: file paths in ${JSON.stringify(c.text)}`, () => {
    const found = JSON.parse(JSON.stringify(chat().filePaths(c.text)));
    assert.deepEqual(found.map((f) => f.text), c.paths);
    for (const f of found) assert.equal(c.text.slice(f.index, f.index + f.text.length), f.text);
  });
}
test('web: a `code` span is a path only when it is exactly one', () => {
  const page = chat();
  for (const [text, yes] of fixture.code) assert.equal(page.isFilePath(text), yes, text);
});

test("web: a path in a bot's reply becomes a link to open it, a path in a code block does not", () => {
  const page = chat();
  const reply = 'Saved to /workspace/news/report.md and `out/raw.csv`. A folder /workspace/news/ stays.\n\n```\ncat /workspace/news/secret.md\n```';
  const html = page.md(reply, 'news');
  const links = [...html.matchAll(/<a class="file-path" href="([^"]+)" data-view="([^"]+)"/g)].map((m) => m[2]);
  assert.deepEqual(links, ['/bots/news/path?path=%2Fworkspace%2Fnews%2Freport.md', '/bots/news/path?path=out%2Fraw.csv']);
  assert.match(html, /<pre><code>cat \/workspace\/news\/secret\.md<\/code><\/pre>/, 'the code block stays as it was');
  assert.match(html, /href="\/api\/bots\/news\/path\?path=%2Fworkspace%2Fnews%2Freport\.md"/, 'without the viewer, the link downloads');
  assert.match(html, /title="Open report\.md"/);
  // A server without the viewer: no links.
  const old = chat([]);
  assert.doesNotMatch(old.md(reply, 'news'), /file-path/);
});

// The viewer: viewer.js run against stand-ins, with what botdot answers for each path.
function viewer(answers, { features = ['document-viewer'] } = {}) {
  const md = chat().md;
  const box = element({}, { classes: ['hidden'] });
  const row = element(); const main = element();
  const listeners = {};
  const calls = [];
  const ctx = vm.createContext({
    ...words, state: { features, bots: [{ id: 'news', name: 'News Monitor' }], view: 'bot', botId: 'news' },
    esc, md, msgTime: () => '09:14', fmtSize: (n) => `${n} B`, toast() {}, copyText: async () => true, encodeURIComponent,
    $: (sel) => ({ '#doc-viewer': box, '#chat-row': row, '.main': main }[sel] || null),
    api: async (p, opts = {}) => { calls.push([p, opts.method || 'GET']); const a = answers[p]; if (a instanceof Error || a?.constructor?.name === 'Error') throw a; if (a === undefined) throw Object.assign(new Error('not found'), { status: 404 }); return a; },
    document: { addEventListener: (type, fn) => (listeners[type] ||= []).push(fn) },
  });
  vm.runInContext(`${read('viewer.js')}
;this.DocViewer = DocViewer;`, ctx);
  // A click on an element that holds `data` (its data-view attributes), as the page's capture listener sees it.
  const click = async (data) => {
    const el = { dataset: data };
    const e = { target: { closest: (sel) => (sel === '[data-view]' ? el : null) }, prevented: false, stopped: false, preventDefault() { this.prevented = true; }, stopPropagation() { this.stopped = true; } };
    for (const fn of listeners.click) fn(e);
    await new Promise((r) => setImmediate(r));
    return e;
  };
  return { ctx, box, row, calls, click, listeners };
}

const REPORT = { name: 'weekly-report.md', size: 12000, at: '2026-10-21T09:14:00Z', kind: 'markdown', type: 'text/markdown', truncated: false, text: '# Weekly report\n\n<script>alert(1)</script>\n\n- **EU AI rules** take effect\n- [x] ~~draft~~ sent' };

test('web: a file chip opens the viewer, which draws Markdown with the chat\'s renderer and runs no HTML from the file', async () => {
  const v = viewer({ '/files/r1/weekly-report.md?view=1': REPORT });
  const e = await v.click({ view: '/files/r1/weekly-report.md', viewName: 'weekly-report.md' });
  assert.ok(e.prevented && e.stopped, 'no download, and no other handler');
  assert.deepEqual(v.calls, [['/files/r1/weekly-report.md?view=1', 'GET']]);
  assert.equal(v.box.classList.contains('hidden'), false);
  assert.equal(v.row.classList.contains('with-viewer'), true);
  const html = v.box.innerHTML;
  assert.match(html, /<b>weekly-report\.md<\/b><span>From News Monitor · 12000 B · 09:14<\/span>/);
  assert.match(html, /<h1>Weekly report<\/h1>/);
  assert.match(html, /<strong>EU AI rules<\/strong>/);
  assert.match(html, /<li class="task"><input type="checkbox" disabled checked> <del>draft<\/del> sent<\/li>/, 'a task and a strikethrough too (#267)');
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/, 'the file\'s HTML is text');
  assert.doesNotMatch(html, /<script/);
  assert.match(html, /aria-label="Open in full window"/);
  assert.match(html, /href="\/api\/files\/r1\/weekly-report\.md" download="weekly-report\.md"/);
  // Source: its text with line numbers, still escaped.
  v.ctx.DocViewer.now().mode = 'source';
  const src = v.ctx.DocViewer.html(v.ctx.DocViewer.now());
  assert.match(src, /<ol class="dv-lines"><li># Weekly report<\/li><li> <\/li><li>&lt;script&gt;/);
});

test('web: without the viewer on the server, a chip downloads as before', async () => {
  const v = viewer({}, { features: [] });
  const e = await v.click({ view: '/files/r1/a.md', viewName: 'a.md' });
  assert.equal(e.prevented, false);
  assert.deepEqual(v.calls, []);
});

test('web: a CSV is a table with its rows and columns counted, sorted by a column, and searched', async () => {
  const csv = { name: 'sources.csv', size: 300, at: null, kind: 'csv', type: 'text/csv', truncated: false, text: 'source,stories,note\nReuters,6,"big, fast"\nLocal paper,12,"says ""hi"""\nBlogs,3,x\n' };
  const v = viewer({ '/files/r1/sources.csv?view=1': csv });
  await v.click({ view: '/files/r1/sources.csv', viewName: 'sources.csv' });
  const D = v.ctx.DocViewer;
  let html = v.box.innerHTML;
  assert.match(html, /3 rows · 3 columns/);
  assert.match(html, /placeholder="Find in table"/);
  assert.match(html, /<td>big, fast<\/td>/, 'a quoted comma stays in its cell');
  assert.match(html, /<td>says &quot;hi&quot;<\/td>/);
  const order = (h) => [...h.matchAll(/<tr><td class="dv-n">(\d+)<\/td><td>([^<]*)<\/td>/g)].map((m) => m[2]);
  assert.deepEqual(order(html), ['Reuters', 'Local paper', 'Blogs']);
  D.now().sort = { col: 1, dir: 1 };
  assert.deepEqual(order(D.html(D.now())), ['Blogs', 'Reuters', 'Local paper'], 'by number, not by text');
  D.now().sort = null; D.now().find = 'paper';
  html = D.html(D.now());
  assert.deepEqual(order(html), ['Local paper']);
  D.now().mode = 'source';
  assert.match(D.html(D.now()), /<li>source,stories,note<\/li>/);
  assert.deepEqual(JSON.parse(JSON.stringify(D.csvRows('a;b\r\n1;2', ';'))), [['a', 'b'], ['1', '2']]);
});

// The page's own api(), cut out of app.js, against one answer of botdot.
async function apiError(status, body) {
  const ctx = vm.createContext({ fetch: async () => ({ ok: false, status, json: async () => body }), setAway: () => {}, location: {}, JSON });
  vm.runInContext(`${cut('async function api(path, opts = {})', 'function esc(s)')}\nthis.api = api;`, ctx);
  return ctx.api('/x').then(() => null, (e) => e);
}

test('web: the states: gone, too large, no preview, and a computer that is off with a way to start it', async () => {
  // The server's word for the state reaches the viewer through the page's api().
  const off = await apiError(409, { error: 'The computer is off.', state: 'computer-off' });
  assert.equal(off.state, 'computer-off');
  assert.equal(off.status, 409);
  assert.equal((await apiError(500, { error: 'No.' })).state, undefined);
  const big = { ...REPORT, kind: 'text', name: 'all.log', truncated: true, text: 'a\nb' };
  const pdf = { name: 'contract.pdf', size: 9, at: null, kind: 'none', type: 'application/pdf', truncated: false };
  const v = viewer({ '/bots/news/path?path=x.log&view=1': big, '/files/r1/contract.pdf?view=1': pdf, '/bots/news/path?path=%2Fworkspace%2Fa.md&view=1': off });
  await v.click({ view: '/files/r1/gone.md', viewName: 'gone.md' });
  assert.match(v.box.innerHTML, /This file is gone/);
  await v.click({ view: '/bots/news/path?path=x.log', viewName: 'x.log', viewBot: 'news' });
  assert.match(v.box.innerHTML, /Too large to show whole\.<\/b> Showing its start/);
  await v.click({ view: '/files/r1/contract.pdf', viewName: 'contract.pdf' });
  assert.match(v.box.innerHTML, /No preview for this kind of file/);
  assert.match(v.box.innerHTML, /href="\/api\/files\/r1\/contract\.pdf" target="_blank"/, 'a PDF still opens in the browser');
  await v.click({ view: '/bots/news/path?path=%2Fworkspace%2Fa.md', viewName: 'a.md', viewBot: 'news' });
  assert.match(v.box.innerHTML, /The computer is off/);
  assert.match(v.box.innerHTML, /data-dv="start">Start the computer</);
  assert.ok(!v.calls.some(([p]) => p.includes('/computer')), 'nothing started by opening it');
  // A file on the computer over 1 MB: no Download, which botdot would refuse.
  const huge = { name: 'screen.png', size: 3e6, at: null, kind: 'none', type: 'image/png', truncated: false, downloadable: false };
  const h = viewer({ '/bots/news/path?path=%2Fhome%2Fbox%2Fscreen.png&view=1': huge });
  await h.click({ view: '/bots/news/path?path=%2Fhome%2Fbox%2Fscreen.png', viewName: 'screen.png', viewBot: 'news' });
  assert.match(h.box.innerHTML, /Too large to bring out of the computer/);
  assert.doesNotMatch(h.box.innerHTML, /Download/);
});
