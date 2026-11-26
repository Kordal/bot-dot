// The Chief's note of a new version drawn as a card of the block kit on the web page (#1759, public/version-update.js): the
// head with the version, the line saying when the account moves, the What's new titles as plain text, and one button to the
// card in Needs you. The server hands it as `versionUpdate` beside the unchanged `text` (test/update-offer.test.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { read, esc, words } = require('./web-page');

const page = (extra = {}) => {
  const calls = [];
  const ctx = vm.createContext({ ...words, esc, setView: (...a) => calls.push(a), state: { asks: [{ id: 'deadbeef', kind: 'update' }] }, ...extra });
  vm.runInContext(`${read('version-update.js')}\nthis.VersionUpdate = VersionUpdate;`, ctx);
  return Object.assign(ctx.VersionUpdate, { calls });
};
const note = {
  head: 'A new version of botdot is ready', version: 'abc1234', body: 'Your account moves to it tonight, when your bots are idle.',
  heading: "What's new", notes: [{ title: 'A project update is a card' }, { title: 'The bot\'s screen works by touch' }], cardId: 'deadbeef',
};

test('web: the note is a head with its version, the line of when, the titles as a list and one button', () => {
  const html = page().html(note);
  assert.match(html, /<span class="pu-title">A new version of botdot is ready<\/span><span class="pu-sub">abc1234<\/span>/);
  assert.match(html, /<p class="vu-line">Your account moves to it tonight, when your bots are idle\.<\/p>/);
  assert.match(html, /<h3>What&#39;s new<\/h3><ul class="vu-notes"><li>A project update is a card<\/li><li>The bot&#39;s screen works by touch<\/li><\/ul>/);
  assert.match(html, /<button type="button" class="btn" data-vu-card="deadbeef">Open card<\/button>/);
  assert.doesNotMatch(html, /Now|Tonight<\/button>|update-now|update-tonight/, 'Now and Tonight stay on the card in Needs you');
});

test('web: no version, no titles or no card in Needs you leaves that part out', () => {
  const html = page().html({ head: 'A new version of botdot is ready', body: 'Your account moves to it as soon as your bots are idle.', notes: [] });
  assert.doesNotMatch(html, /pu-sub|<ul|<h3|<button/);
  assert.match(html, /vu-line/);
});

test('web: the button shows only while its card is in the asks the page holds, and goes when the card is dropped', () => {
  const state = { asks: [{ id: 'deadbeef', kind: 'update' }] };
  const v = page({ state });
  assert.doesNotMatch(v.html(note), /vu-act" hidden/, 'the card waits: the button shows');
  const stale = page({ state: { asks: [{ id: 'cafe0001', kind: 'update' }] } }).html(note);
  assert.match(stale, /class="pu-sec vu-act" hidden>/, 'another card waits, not this one: no button');
  assert.match(page({ state: { asks: null } }).html(note), /vu-act" hidden>/, 'no list yet: no button');
  assert.match(page({ state: undefined }).html(note), /vu-act" hidden>/);
  // The note is drawn, then the card goes (answered Now or Tonight, or dropped by sync()): the next sync hides the button.
  const wrap = { hidden: false };
  const el = { dataset: { vuCard: 'deadbeef' }, parentElement: wrap, onclick: null };
  const root = { querySelectorAll: (sel) => (sel === '[data-vu] [data-vu-card]' ? [el] : []) };
  v.wire(root);
  assert.equal(wrap.hidden, false);
  state.asks = [];
  v.sync(root);
  assert.equal(wrap.hidden, true, 'the card is gone: the button goes');
  state.asks = [{ id: 'deadbeef', kind: 'update' }];
  v.sync(root);
  assert.equal(wrap.hidden, false, 'and shows again if the card does');
  assert.match(read('needs.js'), /VersionUpdate\.sync\(\$\('#chat-thread'\)\)/, 'the Chief chat syncs it whenever the asks are drawn');
});

test('web: the Open card button opens Needs you', () => {
  const v = page();
  const el = { dataset: { vuCard: 'deadbeef' }, parentElement: {}, onclick: null };
  v.wire({ querySelectorAll: (sel) => (sel === '[data-vu] [data-vu-card]' ? [el] : []) });
  el.onclick();
  assert.deepEqual(v.calls, [['needs']]);
});

test('web: titles are plain text and a card id is held to its shape', () => {
  const evil = '<img src=x onerror=alert(1)> **bold** [card deadbeef] https://example.com';
  const html = page().html({ ...note, head: evil, version: evil, body: evil, heading: evil, notes: [{ title: evil }], cardId: 'a"b' });
  assert.doesNotMatch(html, /<img|<strong|<a |<b>/);
  assert.doesNotMatch(html, /onclick|data-vu-card/, 'an id that is not a card id is no button');
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt; \*\*bold\*\*/);
});

test('web: a note from before the feature, or with nothing to say, is no card and shows its text', () => {
  const { of, preview } = page();
  assert.equal(of({ text: 'A new version of botdot is ready. Your account moves to it tonight.' }), null);
  assert.equal(of({ versionUpdate: 'x' }), null);
  assert.equal(of({ versionUpdate: [] }), null);
  assert.equal(of({ versionUpdate: { head: ' ' } }), null);
  assert.equal(of({ versionUpdate: note })?.version, 'abc1234');
  assert.equal(preview({ versionUpdate: note, text: 'A new version of botdot is ready. Your account moves…' }), 'A new version of botdot is ready');
  assert.equal(preview({ text: 'Hello' }), null);
});

test('web: the card is drawn in the Chief chat in place of the text, wired, and no bot name inside it is linked', () => {
  const chief = read('chief.js'), index = read('index.html'), app = read('app.js');
  assert.match(chief, /VersionUpdate\.of\(m\)/);
  assert.match(chief, /VersionUpdate\.html\(version\)/);
  assert.match(chief, /VersionUpdate\.wire\(root\)/);
  assert.match(app, /\.vu-card/);
  assert.ok(index.indexOf('<script src="/blocks.js"></script>') < index.indexOf('<script src="/version-update.js"></script>'));
});
