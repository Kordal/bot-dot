// Web addresses in a chat message on the web page: chatLinks() cut out of public/app.js, read against the cases the
// Android app shares (test/fixtures/chat-links.json). An address may come without https://, but a file name stays text.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { cut } = require('./web-page');

const { cases } = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'chat-links.json'), 'utf8'));
const page = vm.createContext({ URL });
vm.runInContext(`${cut('const BARE_TLDS', 'function linkifyChat(root)')}
  this.chatLinks = chatLinks;`, page);

for (const c of cases) {
  test(`web: links in ${JSON.stringify(c.text)}`, () => {
    const links = JSON.parse(JSON.stringify(page.chatLinks(c.text)));
    assert.deepEqual(links.map((l) => [l.text, l.href]), c.links);
    for (const l of links) assert.equal(c.text.slice(l.index, l.index + l.text.length), l.text);
  });
}
