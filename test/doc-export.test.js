// A reply or a Markdown file taken out as a document (#348): the blocks are the chat's (the same cases as both apps,
// test/fixtures/markdown-cases.json), Word is a zip botdot writes itself, the PDF is WeasyPrint's from escaped HTML, and
// only the owner exports.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const zlib = require('zlib');
const doc = require('../lib/doc-export');
const { startServer } = require('./helpers');

const { cases } = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'markdown-cases.json'), 'utf8'));
// The blocks with their text as written: they are read from the escaped text (as on the web page).
const unesc = (s) => s.replace(/&(amp|lt|gt|quot|#39);/g, (_, e) => ({ amp: '&', lt: '<', gt: '>', quot: '"', '#39': "'" }[e]));
const plain = (v) => JSON.parse(JSON.stringify(v), (k, x) => (typeof x === 'string' && k !== 'type' ? unesc(x) : x));

// The parts of a zip, as text: the local headers read in order.
function unzip(buf) {
  const files = {};
  for (let at = 0; buf.readUInt32LE(at) === 0x04034b50;) {
    const size = buf.readUInt32LE(at + 18), nameLen = buf.readUInt16LE(at + 26), extra = buf.readUInt16LE(at + 28);
    const name = buf.subarray(at + 30, at + 30 + nameLen).toString();
    const data = buf.subarray(at + 30 + nameLen + extra, at + 30 + nameLen + extra + size);
    const text = zlib.inflateRawSync(data);
    assert.equal(zlib.crc32(text), buf.readUInt32LE(at + 14), `${name}: its crc`);
    files[name] = text.toString();
    at += 30 + nameLen + extra + size;
  }
  return files;
}

const REPORT = `# Ads budget

**Recommendation: use Meta.** It is the only one where €150 buys enough clicks.

## What €150 buys

| Channel | Cost |
| --- | --- |
| Meta | CPM $7–10 |
| <script>alert(1)</script> | [x](https://example.com/?a=1&b=2) |

- one
  - two
1. first

\`\`\`
a < b
\`\`\``;

test('the blocks are the chat\'s, case by case', () => {
  for (const c of cases) assert.deepEqual(plain(doc.mdBlocks(c.source)), c.blocks, c.name);
});

test('inline runs: bold, italic, code, struck and links, with the escaped text back as written', () => {
  assert.deepEqual(doc.runsOf(doc.mdBlocks('a **b** *c* `d &lt;` ~~e~~ [f](https://g.h/?i=1&j=2) <k>')[0].text), [
    { text: 'a ' }, { text: 'b', bold: true }, { text: ' ' }, { text: 'c', italic: true }, { text: ' ' }, { text: 'd &lt;', code: true }, { text: ' ' },
    { text: 'e', strike: true }, { text: ' ' }, { text: 'f', link: 'https://g.h/?i=1&j=2' }, { text: ' <k>' }]);
});

test('the title is the one asked for, else the first heading; a file name is its plain words', () => {
  assert.equal(doc.titleOf('  Mine  ', doc.mdBlocks('# Other')), 'Mine');
  assert.equal(doc.titleOf('', doc.mdBlocks('text\n\n## **Their** report')), 'Their report');
  assert.equal(doc.titleOf('', doc.mdBlocks('just text')), 'Document');
  assert.equal(doc.fileName('Prąd: 9 kW / "PV"?', 'pdf'), 'Prad-9-kW-PV.pdf');
  assert.equal(doc.fileName('???', 'md'), 'document.md');
});

test('Word: a zip Word opens, with the title, headings, a table with a header row, a link and nothing as markup', async () => {
  const { name, type, body } = await doc.exportDoc({ text: REPORT, format: 'docx' });
  assert.equal(name, 'Ads-budget.docx');
  assert.match(type, /wordprocessingml/);
  const files = unzip(body);
  assert.deepEqual(Object.keys(files).sort(), ['[Content_Types].xml', '_rels/.rels', 'docProps/core.xml', 'word/_rels/document.xml.rels', 'word/document.xml', 'word/styles.xml']);
  const d = files['word/document.xml'];
  assert.match(d, /<w:pStyle w:val="Title"\/><\/w:pPr><w:r><w:t xml:space="preserve">Ads budget<\/w:t>/);
  assert.equal(d.match(/Ads budget/g).length, 1, 'the first heading is the title, written once');
  assert.match(d, /<w:pStyle w:val="Heading2"\/>.*What €150 buys/);
  assert.match(d, /<w:tblHeader\/>/);
  assert.match(d, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(d, /<script/);
  assert.match(d, /<w:hyperlink r:id="rIdL1">/);
  assert.match(files['word/_rels/document.xml.rels'], /Target="https:\/\/example.com\/\?a=1&amp;b=2" TargetMode="External"/);
  assert.match(d, /a &lt; b/);
});

test('the PDF\'s HTML is escaped, links nothing to fetch, and its list keeps depth and numbers', () => {
  const html = doc.htmlOf('T <b>', doc.mdBlocks(REPORT));
  assert.match(html, /<title>T &lt;b&gt;<\/title>/);
  assert.match(html, /<td>&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/td>/);
  assert.doesNotMatch(html, /<(script|img|link|iframe)/);
  assert.match(html, /margin-left:1.4em"><span class="mk">•<\/span><span>two/);
  assert.match(html, /<span class="mk">1\.<\/span>/);
});

test('the PDF is WeasyPrint\'s output; without WeasyPrint it is a 501 that says so', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-'));
  const fake = path.join(dir, 'weasyprint');
  fs.writeFileSync(fake, '#!/bin/sh\necho "$@" > "$(dirname "$0")/args"\ncat > "$(dirname "$0")/in.html"\nprintf "%%PDF-1.7 fake"\n', { mode: 0o755 });
  const pdf = await doc.exportDoc({ title: 'R', text: REPORT, format: 'pdf' }, { bin: fake });
  assert.equal(pdf.body.toString(), '%PDF-1.7 fake');
  assert.equal(fs.readFileSync(path.join(dir, 'args'), 'utf8').trim(), '--base-url /nonexistent/ - -');
  assert.match(fs.readFileSync(path.join(dir, 'in.html'), 'utf8'), /<h1>R<\/h1>/);
  await assert.rejects(doc.exportDoc({ text: 'x', format: 'pdf' }, { bin: path.join(dir, 'none') }), (e) => e.status === 501 && e.state === 'no-pdf');
  const broken = path.join(dir, 'broken');
  fs.writeFileSync(broken, '#!/bin/sh\ncat >/dev/null\necho no >&2\nexit 1\n', { mode: 0o755 });
  await assert.rejects(doc.exportDoc({ text: 'x', format: 'pdf' }, { bin: broken }), (e) => e.status === 502);
});

test('Markdown is the text as sent; nothing, too much or an unknown format is a 400', async () => {
  const md = await doc.exportDoc({ title: 'Notes', text: 'a\n# b', format: 'md' });
  assert.deepEqual([md.name, md.body.toString()], ['Notes.md', 'a\n# b']);
  for (const bad of [{ text: ' ', format: 'md' }, { text: 'x', format: 'html' }, { text: 'x'.repeat(1024 * 1024 + 1), format: 'md' }, {}]) {
    await assert.rejects(doc.exportDoc(bad), (e) => e.status === 400);
  }
});

test('POST /api/export: the owner gets the file as an attachment; the Chief may not; the feature is announced', async () => {
  const srv = await startServer();
  try {
    assert.ok((await srv.api('/version')).data.features.includes('document-export'));
    const res = await fetch(`${srv.base}/api/export`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bot-Dot': '1' }, body: JSON.stringify({ title: 'Ads budget', text: REPORT, format: 'docx' }) });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /^attachment; filename\*=UTF-8''Ads-budget\.docx$/);
    assert.equal(res.headers.get('cache-control'), 'no-store');
    assert.ok(unzip(Buffer.from(await res.arrayBuffer()))['word/document.xml']);
    const md = await srv.api('/export', { method: 'POST', body: { text: 'hi', format: 'md' } });
    assert.equal(md.data.toString(), 'hi');
    assert.equal((await srv.api('/export', { method: 'POST', body: { text: 'hi', format: 'exe' } })).status, 400);
    assert.equal((await srv.asChief('/export', { method: 'POST', body: { text: 'hi', format: 'md' } })).status, 403);
  } finally { await srv.stop(); }
});
