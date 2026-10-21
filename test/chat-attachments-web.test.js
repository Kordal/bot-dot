// The web page draws a chip under the owner's message as a link wherever the file can be opened (#268): in a bot's
// chat, a Chief chat and a group, sent or waiting. It opens in the viewer (data-view) or downloads under its name; a
// file still uploading or failed, or one from a server without the route, stays a plain chip.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { cut, esc } = require('./web-page');

function page(features) {
  const ctx = vm.createContext({ esc, encodeURIComponent, state: { features } });
  vm.runInContext(`${cut('const fmtSize = ', '// Files a bot attached to its reply')}\nthis.filesHTML = filesHTML;`, ctx);
  return ctx.filesHTML;
}
const FILE = { name: 'qa-test.md', file: 'uploads/20261021-ab12-qa-test.md', size: 30 };
const ZIP = { name: 'pack.zip', file: 'uploads/20261021-cd34-pack.zip', size: 30 };
const link = (html) => html.match(/<a class="file-chip link" href="([^"]+)" download="([^"]+)"([^>]*)>/);

test('in a Chief chat, a chip opens the file in the viewer, and downloads it with its own name', () => {
  const html = page(['document-viewer', 'chat-attachments'])([FILE, ZIP], 'chief:c1');
  const a = link(html);
  assert.ok(a, html);
  assert.equal(a[1], '/api/chief/chats/c1/uploads/20261021-ab12-qa-test.md');
  assert.equal(a[2], 'qa-test.md');
  assert.match(a[3], /data-view="\/chief\/chats\/c1\/uploads\/20261021-ab12-qa-test\.md" data-view-name="qa-test\.md"/);
  assert.match(html, /href="\/api\/chief\/chats\/c1\/uploads\/20261021-cd34-pack\.zip" download="pack\.zip"/);
});

test('in a group the same, from the group', () => {
  const a = link(page(['document-viewer', 'chat-attachments'])([FILE], 'group:g1'));
  assert.equal(a[1], '/api/group-chats/g1/uploads/20261021-ab12-qa-test.md');
});

test("in a bot's chat, from its folder, as before", () => {
  const a = link(page(['document-viewer'])([FILE], 'bot:news'));
  assert.equal(a[1], `/api/bots/news/path?path=${encodeURIComponent(FILE.file)}`);
  assert.match(a[3], /data-view-bot="news"/);
});

test('a file still uploading or failed, no chat, or a server without the route: a plain chip', () => {
  const both = page(['document-viewer', 'chat-attachments']);
  for (const html of [
    both([{ ...FILE, status: 'uploading' }], 'chief:c1'),
    both([{ ...FILE, status: 'failed' }], 'group:g1'),
    both([FILE]),
    both([{ name: 'x.md', file: '../x.md' }], 'chief:c1'),
    page(['document-viewer'])([FILE], 'chief:c1'),
  ]) {
    assert.doesNotMatch(html, /<a /, html);
    assert.match(html, /<span class="file-chip/);
  }
  // A ready file from the composer links once it is uploaded.
  assert.ok(link(both([{ ...FILE, status: 'ready' }], 'chief:c1')));
});

test('without the viewer it still downloads', () => {
  const a = link(page(['chat-attachments'])([FILE], 'chief:c1'));
  assert.equal(a[1], '/api/chief/chats/c1/uploads/20261021-ab12-qa-test.md');
  assert.doesNotMatch(a[3], /data-view/);
});
