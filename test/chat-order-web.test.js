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
    esc, Unread, CHIEF_BOT: { id: 'chief', name: 'Chief of Staff' }, ICON: { play: '▶' },
    botLabel: (b) => esc(b?.name || ''), botFigure: () => '', scriptRunHTML: () => '', msgTime: () => '11:45', dur: () => '6m',
    notesFoldHTML: () => '', filesHTML: () => '', botFilesHTML: () => '', copyBtn: () => '', draftHTML: () => '',
    replyDrafts: { of: () => '' }, escMentions: (t) => esc(t), md: (t) => esc(t), learnedChips: () => '', questionsHTML: () => '',
    choicesHTML: (c) => (c ? `<div class="choices">${c.map(esc).join('|')}</div>` : ''),
    said: (v) => (typeof v === 'string' ? v.trim() : ''), plain: (t) => String(t || ''), OpeningLine: { WAITING: 'Waiting for your OK', ofRun: () => '' }, state: { keepOpen: null, features: [] },
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

// Each run is one block (#625): the blocks stand in the order their replies ended, so a block stays whole.
const blocks = (html) => [...html.matchAll(/<section class="run-block[^"]*" data-run="([^"]+)">/g)].map((m) => m[1]);

test('web: a long run with /btw in the middle: its block comes after the /btw block, whole, with its answers', () => {
  const html = page().botThreadHTML(bot, [long, btw]); // oldest first, as the chat hands them
  assert.deepEqual(blocks(html), ['btw', 'long']);
  order(html, '/btw status?', 'Still waiting', 'Deploy now', 'Deploy done.', 'class="choices"', 'data-details="long"');
  assert.equal((html.match(/class="choices"/g) || []).length, 1, 'the answers stand once, under the reply that is last');
});

test('web: while the long run works, its block stays at the bottom, below the /btw, with its line and Stop', () => {
  const html = page().botThreadHTML(bot, [{ ...long, status: 'running', endedAt: null, result: null, steps: { count: 4, rows: [] } }, btw]);
  assert.deepEqual(blocks(html), ['btw', 'long']);
  order(html, '/btw status?', 'Still waiting', 'Deploy now', 'class="step-now">Working<', 'step-n">4 steps', 'data-live="long"', 'data-stop-run="long"');
});

test('web: the "New" line goes in the block that ended last, below the owner\'s own message', () => {
  const html = page().botThreadHTML(bot, [long, btw], 'long');
  order(html, '/btw status?', 'Deploy now', 'class="new-line"', 'Deploy done.');
  assert.equal((html.match(/class="new-line"/g) || []).length, 1);
});

test('web: a finished block folds its steps into one line: the count, the skills it changed and the bots it messaged; open, a row each', () => {
  const done = run('done', { prompt: 'Try now', result: 'PR opened.', startedAt: '2026-10-23T11:28:00.000Z', endedAt: '2026-10-23T11:35:00.000Z',
    steps: { count: 23, rows: [{ at: '2026-10-23T11:28:10.000Z', text: 'Reading a.js', n: 2 }, { at: '2026-10-23T11:31:00.000Z', text: 'Run the tests' }] },
    learned: [{ kind: 'skill-updated', skill: 'buildr-pr-workflow', chip: 'Changed the skill buildr-pr-workflow', at: '2026-10-23T11:35:00.000Z' }, { kind: 'memory-pending', chip: 'Asked to add a note' }],
    sentToAll: [{ id: 'ia', name: 'Infra Admin', text: 'Where is the token?\nThanks', at: '2026-10-23T11:30:00.000Z' }] });
  const html = page().botThreadHTML(bot, [done]);
  assert.match(html, /<details class="run-steps" data-steps="done"><summary aria-label="23 steps, the skill buildr-pr-workflow, Infra Admin">/);
  order(html, 'Try now', '23 steps', 'buildr-pr-workflow', 'Infra Admin', 'Reading a.js', '×2', 'Messaged Infra Admin', 'Where is the token?', 'Run the tests', 'Changed the skill buildr-pr-workflow', 'PR opened.', 'data-details="done"');
  assert.doesNotMatch(html, /Thanks/, 'a message\'s first line');
  assert.doesNotMatch(html, /bot-msg-label">Messaged/, 'no loose "Messaged" row above the reply');
  const plainBlock = page().botThreadHTML(bot, [run('quiet', { prompt: 'Hi', result: 'Hello.', startedAt: '2026-10-23T11:28:00.000Z', endedAt: '2026-10-23T11:28:05.000Z' })]);
  assert.doesNotMatch(plainBlock, /run-steps/, 'a run without a step, a skill or a message has no step line');
});

// A run the owner started with Reply is a further round of the block it replied to (#627), from the table the
// Android app is checked against too (test/fixtures/reply-blocks.json).
for (const c of require('./fixtures/reply-blocks.json').cases) {
  test(`web reply blocks: ${c.name}`, () => {
    assert.deepEqual(JSON.parse(JSON.stringify(Unread.blocks(c.runs).map((b) => b.map((r) => r.id)))), c.blocks);
  });
}

test('web: a reply is a round of its block, which stands where it ended; Reply is in the last round\'s footer only', () => {
  const ctx = page();
  ctx.state.features = ['reply-to'];
  const first = run('first', { prompt: 'Plan my Thursday', result: 'Gym at 7.', startedAt: '2026-10-27T10:00:00.000Z', endedAt: '2026-10-27T10:05:00.000Z' });
  const other = run('other', { prompt: 'Any news?', result: 'None.', startedAt: '2026-10-27T10:06:00.000Z', endedAt: '2026-10-27T10:07:00.000Z' });
  const more = run('more', { prompt: 'move the gym to 8', result: 'Moved.', replyTo: 'first', startedAt: '2026-10-27T10:08:00.000Z', endedAt: '2026-10-27T10:09:00.000Z' });
  const html = ctx.botThreadHTML(bot, [first, other, more]);
  assert.deepEqual(blocks(html), ['other', 'first']);
  order(html, 'Any news?', 'Plan my Thursday', 'Gym at 7.', 'data-round="more"', 'move the gym to 8', 'Moved.', 'data-reply="more"');
  assert.deepEqual([...html.matchAll(/data-reply="([^"]+)"/g)].map((m) => m[1]), ['other', 'more']);
  const live = ctx.botThreadHTML(bot, [first, { ...more, status: 'running', endedAt: null, result: null }]);
  assert.match(live, /<section class="run-block live" data-run="first">/);
  order(live, 'Gym at 7.', 'move the gym to 8', 'data-reply="more"', 'data-stop-run="more"');
  ctx.state.features = [];
  assert.doesNotMatch(ctx.botThreadHTML(bot, [first]), /data-reply/, 'a server without reply-to: no Reply');
});
