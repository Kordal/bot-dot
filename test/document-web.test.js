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
