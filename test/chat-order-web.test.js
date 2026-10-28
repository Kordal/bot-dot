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
  vm.runInContext(`${cut('function messagedLabel(r) {', '// Notes other bots left')}\n${cut('function botThreadHTML(bot, runs, newFirst = null) {', '// "Run now" under the notes that wait')}\nthis.botThreadHTML = botThreadHTML; this.tookFor = tookFor;`, ctx);
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

test('web: while the long run works, its block stays at the bottom, below the /btw, with its line and Stop at the line\'s end', () => {
  const html = page().botThreadHTML(bot, [{ ...long, status: 'running', endedAt: null, result: null, steps: { count: 4, rows: [] } }, btw]);
  assert.deepEqual(blocks(html), ['btw', 'long']);
  order(html, '/btw status?', 'Still waiting', 'Deploy now', 'class="steps-row"', 'class="step-now">Working<', 'step-n">4 steps', 'data-stop-run="long"', 'data-live="long"');
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

// Quiet keys (#635): no frame round a run, one step line that ends in how long it took, and the time, Details,
// Copy and Reply shown on hover or focus (the style), never at rest.
test('web: a run\'s step line ends in how long it took, its skills in the accent; its footer and the owner\'s Copy wait for a hover', () => {
  const done = run('done', { prompt: 'Check the backup', result: 'Done.', startedAt: '2026-10-23T11:28:00.000Z', endedAt: '2026-10-23T11:35:00.000Z', durationMs: 7 * 60000 + 9000,
    steps: { count: 23, rows: [] }, learned: [{ kind: 'skill-updated', skill: 'backup-check' }] });
  const html = page().botThreadHTML(bot, [done]);
  assert.match(html, /<summary aria-label="23 steps, the skill backup-check">[\s\S]*?<span class="step-n">23 steps<\/span><span class="step-dot">·<\/span><span class="step-pip skill"><span>backup-check<\/span><\/span><span class="step-dot">·<\/span><span class="step-took">7 min<\/span><\/summary>/);
  assert.match(html, /<div class="bubble from-me" data-expand><div class="clamp">Check the backup<\/div><\/div><div class="bubble-meta on-hover">/);
  assert.match(html, /<div class="bubble-meta block-foot on-hover">11:45 · 6m <button data-details="done">Details<\/button>/);
  const ctx = page();
  assert.deepEqual([45e3, 60e3, 7 * 60e3, 65 * 60e3, 120 * 60e3].map((ms) => ctx.tookFor(ms)), ['45 s', '1 min', '7 min', '1 h 5 min', '2 h']);
  // At work: the line has no time yet, and Stop stands at its end.
  const working = page().botThreadHTML(bot, [{ ...done, status: 'running', endedAt: null, durationMs: null, result: null, steps: { count: 4, rows: [] } }]);
  assert.match(working, /<div class="steps-row"><details class="run-steps now"[\s\S]*?<\/details><button type="button" class="block-stop" data-stop-run="done">Stop<\/button><\/div>/);
  assert.doesNotMatch(working, /step-took|bubble-meta block-foot">/);
  // The style: no frame round a block, no bubble round a reply, and what waits for a hover is there for a key and a touch.
  const css = read('style.css');
  assert.match(css, /\.run-block \{ display: flex; flex-direction: column; gap: 10px; \}/);
  assert.match(css, /\.chat-thread \.bubble\.from-bot:not\(\.problem\) \{[^}]*background: none; border: 0;/);
  assert.match(css, /\.chat-thread \.on-hover \{ opacity: 0;/);
  assert.match(css, /\.run-block:is\(:hover, :focus-within, \.tapped\) \.on-hover, \.bubble-row:is\(:hover, :focus-within, \.tapped\) \.on-hover \{ opacity: 1; \}/);
  assert.match(read('bot-chat.js'), /at\?\.classList\.add\('tapped'\);/, 'a tap shows them where there is no hover');
});

test('web: a reply to a run is a further round of its block, which stands where its newest reply does; Reply is on its last round (#627)', () => {
  const ctx = page();
  const first = run('first', { prompt: 'Check the backup disk', result: 'It is 80% full.', startedAt: '2026-10-23T10:00:00.000Z', endedAt: '2026-10-23T10:05:00.000Z' });
  const other = run('other', { prompt: 'Weather?', result: 'Sunny.', startedAt: '2026-10-23T10:10:00.000Z', endedAt: '2026-10-23T10:10:05.000Z' });
  const again = run('again', { prompt: 'Clean the old snapshots', result: 'Freed 90 GB.', replyTo: 'first', startedAt: '2026-10-23T10:20:00.000Z', endedAt: '2026-10-23T10:25:00.000Z' });
  const html = ctx.botThreadHTML(bot, [first, other, again]);
  assert.deepEqual(blocks(html), ['other', 'again'], 'one block for the two rounds, after the block that ended between');
  order(html, 'Weather?', 'Check the backup disk', 'It is 80% full.', 'class="round-rule"', 'Clean the old snapshots', 'Freed 90 GB.');
  assert.doesNotMatch(html, /data-reply-run/, 'no Reply against a botdot that does not take it');
  ctx.state.features = ['reply-to'];
  const withReply = ctx.botThreadHTML(bot, [first, other, again]);
  assert.deepEqual([...withReply.matchAll(/data-reply-run="([^"]+)"/g)].map((m) => m[1]), ['other', 'again'], 'on each block, for its last round');
  const lost = ctx.botThreadHTML(bot, [other, again]); // the run it replies to is further back than the chat shows
  assert.deepEqual(blocks(lost), ['other', 'again']);
});
