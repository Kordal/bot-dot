// The order of a bot's chat on the web page (#460): public/unread.js loaded the way the browser loads it, checked
// against the table the Android app is checked against too (test/fixtures/chat-order.json), and the chat drawn
// from it: a reply that ended after a "/btw" stands below the "/btw".
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const table = require('./fixtures/chat-order.json');
const { read, cut, esc } = require('./web-page');

const lib = vm.createContext({});
vm.runInContext(read('unread.js'), lib);
const { Unread } = lib;
const name = (p) => (p.part === 'asked' ? `a:${p.run.id}` : p.part === 'steered' ? `s:${p.run.id}:${p.i}` : `r:${p.run.id}`);

for (const c of table.cases) {
  test(`web table: ${c.name}`, () => {
    const pieces = Unread.order(c.runs);
    assert.deepEqual([...pieces.map(name)], c.pieces);
    assert.equal(pieces.filter((p) => p.part === 'reply').pop().run.id, c.last);
  });
}

test('web: no runs, no pieces', () => {
  assert.equal(Unread.order([]).length, 0);
  assert.equal(Unread.order(undefined).length, 0);
});

function page() {
  const ctx = vm.createContext({
    esc, Unread, state: { keepOpen: null }, CHIEF_BOT: { id: 'chief', name: 'Chief of Staff' }, ICON: { play: '▶' },
    botLabel: (b) => esc(b?.name || ''), botFigure: () => '', scriptRunHTML: () => '', msgTime: () => '11:45', dur: () => '6m',
    notesFoldHTML: () => '', filesHTML: () => '', botFilesHTML: () => '', copyBtn: () => '', draftHTML: () => '',
    replyDrafts: { of: () => '' }, escMentions: (t) => esc(t), md: (t) => esc(t), learnedChips: () => '', questionsHTML: () => '',
    choicesHTML: (c) => (c ? `<div class="choices">${c.map(esc).join('|')}</div>` : ''),
  });
  vm.runInContext(`${cut('function messagedLabel(r) {', '// Notes other bots left')}\n${cut('function botThreadHTML(bot, runs, newFirst = null) {', '// "Run now" under the notes that wait')}\nthis.botThreadHTML = botThreadHTML;`, ctx);
  return ctx;
}
const bot = { id: 'qm', name: 'Quotz Manager', color: '#48c' };
const run = (id, more) => ({ id, botId: 'qm', trigger: 'manual', customPrompt: true, status: 'success', ...more });
const long = run('long', { prompt: 'Deploy now', result: 'Deploy done. Shall I ask the tester?', choices: ['Yes', 'No'], startedAt: '2026-10-23T11:39:00.000Z', endedAt: '2026-10-23T11:45:15.000Z', durationMs: 375000 });
const btw = run('btw', { prompt: '/btw status?', result: 'Still waiting for the deploy.', btw: true, startedAt: '2026-10-23T11:42:00.000Z', endedAt: '2026-10-23T11:42:08.000Z' });
const order = (html, ...texts) => {
  const at = texts.map((t) => html.indexOf(t));
  at.forEach((n, i) => assert.ok(n >= 0, `${texts[i]} is drawn`));
  assert.deepEqual([...at].sort((a, b) => a - b), at, `in this order: ${texts.join(' / ')}`);
};

test('web: a long run with /btw in the middle: its reply and its answers come after the /btw exchange', () => {
  const html = page().botThreadHTML(bot, [long, btw]); // oldest first, as the chat hands them
  order(html, 'Deploy now', '/btw status?', 'Still waiting', 'Deploy done.', 'data-details="long"', 'class="choices"');
  assert.equal((html.match(/class="choices"/g) || []).length, 1, 'the answers stand once, under the reply that is last');
});

test('web: while the long run works, its place stays at the bottom, below the /btw', () => {
  const html = page().botThreadHTML(bot, [{ ...long, status: 'running', endedAt: null, result: null }, btw]);
  order(html, 'Deploy now', '/btw status?', 'Still waiting', 'data-live="long"');
});

test('web: the "New" line goes above the reply that ended last, below the owner\'s own message', () => {
  const html = page().botThreadHTML(bot, [long, btw], 'long');
  order(html, 'Deploy now', '/btw status?', 'class="new-line"', 'Deploy done.');
  assert.equal((html.match(/class="new-line"/g) || []).length, 1);
});
