// Web addresses in a chat message on the web page: chatLinks() cut out of public/app.js, read against the cases the
// Android app shares (test/fixtures/chat-links.json). An address may come without https://, but a file name stays text.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { cut } = require('./web-page');

const { cases, labels } = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'chat-links.json'), 'utf8'));
const page = vm.createContext({ URL });
vm.runInContext(`${cut('// What a web address shows in a chat', '// The Copy button')}${cut('const BARE_TLDS', 'function linkifyChat(root)')}
  this.chatLinks = chatLinks; this.linkLabel = linkLabel;`, page);

for (const c of cases) {
  test(`web: links in ${JSON.stringify(c.text)}`, () => {
    const links = JSON.parse(JSON.stringify(page.chatLinks(c.text)));
    assert.deepEqual(links.map((l) => [l.text, l.href, page.linkLabel(l.text)]), c.links);
    for (const l of links) assert.equal(c.text.slice(l.index, l.index + l.text.length), l.text);
  });
}

// A bare address shows its site, so a long address reads as a short link.
for (const [url, label] of labels) {
  test(`web: ${url} shows as ${label}`, () => assert.equal(page.linkLabel(url), label));
}
