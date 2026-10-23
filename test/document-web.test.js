// A long reply opened as a document on the web page (#348, public/document.js): which reply is long (the cases the
// Android app shares, test/fixtures/document-cases.json), the button under it from a server with `document-export`
// only, and the document's own address, read back to what it names and nothing else.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { cut, read, esc } = require('./web-page');

const { cases } = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'document-cases.json'), 'utf8'));
const page = vm.createContext({ esc });
vm.runInContext(`${cut('function md(src, botId)', '// Link bare web addresses after rendering')}
  this.mdBlocks = mdBlocks;`, page);
vm.runInContext(read('document.js'), page);
const { DocPage, mdBlocks } = page;

for (const c of cases) {
  test(`long: ${c.name}`, () => assert.equal(DocPage.isLong(c.text, mdBlocks), c.long));
}

test('the button: under a long reply, from a server that exports, opening a tab of its own', () => {
  const long = cases.find((c) => c.long).text;
  const html = DocPage.button({ run: 'r-1' }, long, { features: ['document-export'], blocks: mdBlocks });
  assert.match(html, /<a class="btn sm doc-open" href="\/#doc\/run\/r-1" target="_blank" rel="noopener">/);
  assert.match(html, />Open as document<\/a>/);
  assert.equal(DocPage.button({ run: 'r-1' }, long, { features: [], blocks: mdBlocks }), '', 'an older server: none');
  assert.equal(DocPage.button({ run: 'r-1' }, 'Short.', { features: ['document-export'], blocks: mdBlocks }), '', 'a short reply: none');
});

test('an address names a run, a Chief message or a file, and reads back to it', () => {
  const plain = (v) => JSON.parse(JSON.stringify(v));
  for (const src of [{ run: '2026-10-22T10-00-00-abc' }, { chat: 'c 1', at: 12 }, { file: '/bots/b1/path?path=notes%2Fplan.md' }, { file: '/files/r1/Report Q3.md' }]) {
    const a = DocPage.address(src);
    assert.match(a, /^#doc\/(run|chief|file)\//);
    assert.deepEqual(plain(DocPage.parse(a)), src, a);
  }
  for (const bad of ['#chief', '#doc/run/', '#doc/run/a/b', '#doc/chief/c/x', '#doc/file/relative.md', `#doc/file/${encodeURIComponent('/files/../../etc')}`, '#doc/file/%E0%A4%A', '#doc/other/x']) {
    assert.equal(DocPage.parse(bad), null, bad);
  }
});

test('the boot opens a document address as the document alone; every chat draws the button under a long reply', () => {
  assert.match(read('boot.js'), /if \(location\.hash\.startsWith\('#doc\/'\)\) return DocPage\.show\(location\.hash, docPageTools\(\)\);/);
  assert.match(read('bot-chat.js'), /\$\{failed \? '' : globalThis\.docButton\?\.\(\{ run: r\.id \}, body\) \|\| ''\}/);
  assert.match(read('groups.js'), /\$\{failed \? '' : globalThis\.docButton\?\.\(\{ run: r\.id \}, body\) \|\| ''\}/);
  assert.match(read('chief.js'), /globalThis\.docButton\?\.\(\{ chat: state\.chatId, at: index \}, m\.text\)/);
  assert.match(read('chief.js'), /globalThis\.docButton\?\.\(\{ chat: state\.chatId, at \}, m\.text\)/);
  assert.match(read('viewer.js'), /v\.kind === 'markdown' && globalThis\.DocPage && state\.features\.includes\('document-export'\)/);
  const html = read('index.html');
  assert.ok(html.indexOf('/document.js') < html.indexOf('/app.js'), 'loaded before app.js');
  assert.match(read('style.css'), /body\.doc-mode > \.app \{ display: none; \}/);
});

// Save to Google Docs from the Export menu (#378): the tap used to set the address to /#connectors, which changed nothing
// on a document page, so it looked dead. Now it connects Google Docs right there and saves, or says why it can't.
function gdHarness({ answers = {}, popup = true } = {}) {
  const calls = [];
  const said = [];
  const rows = [];
  const win = { closed: false, location: null, close() { this.closed = true; } };
  const g = {
    esc,
    api: async (p, opts = {}) => {
      calls.push(`${opts.method || 'GET'} ${p}`);
      const a = answers[`${opts.method || 'GET'} ${p}`];
      const v = typeof a === 'function' ? a() : a;
      if (v instanceof Error) throw v;
      return v;
    },
  };
  const ui = { open: () => (popup ? win : null), row: (t) => rows.push(t), status: (t, o = {}) => said.push({ t, ...o }), wait: async () => {} };
  return { calls, said, rows, win, g, ui };
}
const doc = { title: 'Plan', text: '# Plan\n\nx' };
const plain = (v) => JSON.parse(JSON.stringify(v));

test('Google Docs row: what it says for each answer of the server', () => {
  assert.equal(DocPage.gdLabel({ configured: true, connected: true }), 'connected');
  assert.equal(DocPage.gdLabel({ configured: true, connected: false }), 'Connect…');
  assert.equal(DocPage.gdLabel({ configured: false, connected: false }), 'Not set up');
  assert.equal(DocPage.gdLabel({ connected: false }), 'Connect…', 'an older server, without configured');
  assert.equal(DocPage.gdLabel({}), '', 'not asked yet');
});

test('Google Docs not connected: the tap opens the sign-in tab, waits for the connection and then saves', async () => {
  const states = ['INITIATED', 'ACTIVE'];
  const h = gdHarness({ answers: {
    'POST /connectors/connect': { redirectUrl: 'https://backend.composio.dev/s/abc', connectionId: 'ca_1' },
    'GET /connectors/connections/ca_1': () => ({ id: 'ca_1', status: states.shift() }),
    'POST /export/google-docs': { url: 'https://docs.google.com/document/d/1AbCdEfGhIjK/edit' },
  } });
  const st = { configured: true, connected: false };
  await DocPage.googleDocs(doc, st, h.g, h.ui);
  assert.deepEqual(h.calls, ['POST /connectors/connect', 'GET /connectors/connections/ca_1', 'GET /connectors/connections/ca_1', 'POST /export/google-docs']);
  assert.equal(h.win.location, 'https://backend.composio.dev/s/abc', 'the sign-in in the tab opened on the tap');
  assert.equal(st.connected, true);
  assert.deepEqual(plain(h.rows), ['Connecting…', 'Saving…', 'connected']);
  const last = h.said.at(-1);
  assert.equal(last.t, 'Saved to Google Docs');
  assert.equal(last.link.href, 'https://docs.google.com/document/d/1AbCdEfGhIjK/edit');
  assert.ok(h.said.some((s) => /Sign in to Google in the tab that opened/.test(s.t)), 'says what to do meanwhile');
});

test('Google Docs: no Composio on this server says so; a blocked pop-up, a failed connect and a failed sign-in say what went wrong', async () => {
  let h = gdHarness();
  await DocPage.googleDocs(doc, { configured: false, connected: false }, h.g, h.ui);
  assert.deepEqual(h.calls, [], 'nothing to ask');
  assert.match(h.said[0].t, /connected apps aren't set up on this server/);
  assert.equal(h.said[0].link.href, '/#connectors');
  assert.equal(h.said[0].error, true);

  h = gdHarness({ popup: false });
  await DocPage.googleDocs(doc, { configured: true, connected: false }, h.g, h.ui);
  assert.deepEqual(h.calls, []);
  assert.match(h.said[0].t, /blocked the Google sign-in tab/);

  h = gdHarness({ answers: { 'POST /connectors/connect': new Error('Composio rejected the API key') } });
  await DocPage.googleDocs(doc, { configured: true, connected: false }, h.g, h.ui);
  assert.equal(h.win.closed, true, 'the empty tab closes');
  assert.match(h.said.at(-1).t, /Couldn't start connecting Google Docs: Composio rejected the API key/);
  assert.equal(h.rows.at(-1), 'Connect…');

  h = gdHarness({ answers: { 'POST /connectors/connect': { redirectUrl: 'https://x.test/s', connectionId: 'ca_2' }, 'GET /connectors/connections/ca_2': { status: 'FAILED', statusReason: 'denied' } } });
  await DocPage.googleDocs(doc, { configured: true, connected: false }, h.g, h.ui);
  assert.ok(!h.calls.includes('POST /export/google-docs'));
  assert.equal(h.said.at(-1).t, "Connecting Google Docs didn't work: denied");
});

test('Google Docs connected: saves at once; a connection gone since says to tap again to connect', async () => {
  let h = gdHarness({ answers: { 'POST /export/google-docs': { url: 'https://docs.google.com/document/d/1AbCdEfGhIjK/edit' } } });
  await DocPage.googleDocs(doc, { configured: true, connected: true }, h.g, h.ui);
  assert.deepEqual(h.calls, ['POST /export/google-docs']);
  assert.equal(h.said.at(-1).t, 'Saved to Google Docs');
  const st = { configured: true, connected: true };
  h = gdHarness({ answers: { 'POST /export/google-docs': Object.assign(new Error('Google Docs is not connected.'), { state: 'not-connected' }) } });
  await DocPage.googleDocs(doc, st, h.g, h.ui);
  assert.equal(st.connected, false);
  assert.match(h.said.at(-1).t, /Tap Google Docs again to connect it/);
  assert.equal(h.rows.at(-1), 'Connect…');
});

test('Google Docs without the access to make documents: the plain sentence and a Reconnect button that connects it again', async () => {
  const st = { configured: true, connected: true };
  const h = gdHarness({ answers: { 'POST /export/google-docs': Object.assign(new Error("Google Docs wasn't allowed to do this."), { state: 'reconnect' }) } });
  await DocPage.googleDocs(doc, st, h.g, h.ui);
  assert.deepEqual(h.said.at(-1), { t: "Google Docs wasn't allowed to do this.", error: true, reconnect: true });
  assert.equal(st.connected, false, 'the next tap connects it first');
  assert.equal(h.rows.at(-1), 'Connect…');
  assert.match(read('document.js'), /data-doc="gdocs-reconnect">Reconnect<\/button>/);
  assert.match(read('document.js'), /if \(what === 'gdocs-reconnect'\) gd\.connected = false;/);
});

test('the Export menu no longer sends a document page to /#connectors, which does nothing there', () => {
  assert.doesNotMatch(read('document.js'), /location\.href = '\/#connectors'/);
  assert.match(read('document.js'), /try \{ await googleDocs\(doc, gd, g, ui\); \}/);
});
