// A bot that asks shows the question in its own chat (docs/api.md, "A bot that asks"): "Needs you" on its key points
// at something to answer. The run it asks from is read back however far it is (the page holds the newest 200 runs of
// all bots), and its answers stand under it also when newer runs the Chief or another bot started came after it.
// The web page's own code cut out of public/ and run against stand-ins.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { read, cut, esc, words } = require('./web-page');

const at = (m) => `2026-10-23T09:${String(m).padStart(2, '0')}:00.000Z`;
const run = (id, m, more = {}) => ({ id, botId: 'iw', trigger: 'manual', prompt: 'Hi', customPrompt: true, status: 'success', result: `Reply ${id}`, startedAt: at(m), endedAt: at(m), ...more });

function page() {
  const lib = vm.createContext({});
  vm.runInContext(read('unread.js'), lib);
  const ctx = vm.createContext({ ...words,
    esc, Unread: lib.Unread, state: { keepOpen: null, runs: [], view: 'bot', botId: 'iw' }, CHIEF_BOT: { id: 'chief', name: 'Chief of Staff' }, ICON: { play: '▶' },
    botLabel: (b) => esc(b?.name || ''), botFigure: () => '', scriptRunHTML: () => '', msgTime: () => '09:41', dur: () => '2 s',
    notesFoldHTML: () => '', filesHTML: () => '', botFilesHTML: () => '', copyBtn: () => '',
    escMentions: (t) => esc(t), md: (t) => esc(t), learnedChips: () => '', questionsHTML: () => '',
    choicesHTML: (c) => (c ? `<div class="choices">${c.map(esc).join('|')}</div>` : ''),
    plain: (t) => String(t ?? ''), fmtTime: () => '09:41', runFigure: () => '', statusPill: () => '', renderBotChat: () => {}, pages: [], asked: [], redrawn: 0,
    redrawBotChat: () => { ctx.redrawn++; },
  });
  ctx.api = (url) => { ctx.asked.push(url); return Promise.resolve(ctx.pages.shift() || []); };
  vm.runInContext(`${cut('const ENDED_BY = {', 'function detailsInfo(meta) {')}\n${cut('function messagedLabel(r) {', '// Notes other bots left')}\n${cut('function botThreadHTML(bot, runs, newFirst = null) {', '// "Run now" under the notes that wait')}\n${cut('// The run a bot\'s chat reaches back to', '// The plan under a reply that is done')}\nObject.assign(this, { botThreadHTML, chatBack, chatRuns, reachNew, readOwnRuns });`, ctx);
  return ctx;
}

test('web: the answers stand under the run the bot asks from, also with newer runs the Chief started after it', () => {
  const ctx = page();
  const asked = run('r1', 1, { choices: ['Yes', 'No'] });
  const chief = run('r2', 40, { startedBy: 'chief', prompt: 'Read only.', result: '0' });
  const bot = { id: 'iw', name: 'Issue Writer', color: '#c46', asks: { text: 'Open question: yes or no?', runId: 'r1', at: at(1) } };
  const html = ctx.botThreadHTML(bot, [asked, chief]);
  assert.match(html, /Reply r1/, 'the question stands in the chat');
  assert.match(html, /<div class="choices">Yes\|No<\/div>/, 'and its answers under it');
  // Answered (the owner wrote): no open question, and the old run's answers are gone.
  assert.doesNotMatch(ctx.botThreadHTML({ ...bot, asks: undefined }, [asked, chief]), /class="choices"/);
});

test('web: the last reply that asked loses its answers once its question ended in another chat; one that asks nothing keeps them (ADR 211)', () => {
  const ctx = page();
  const asked = run('r1', 1, { choices: ['One', 'Two'], asks: true });
  const bot = { id: 'iw', name: 'Load Tester', color: '#c46' };
  assert.match(ctx.botThreadHTML({ ...bot, asks: { text: 'One or two?', runId: 'r1', at: at(1) } }, [asked]), /<div class="choices">One\|Two<\/div>/);
  assert.doesNotMatch(ctx.botThreadHTML(bot, [asked]), /class="choices"/, 'answered in a group: no buttons');
  assert.match(ctx.botThreadHTML(bot, [run('r1', 1, { choices: ['Yes', 'No'] })]), /<div class="choices">Yes\|No<\/div>/, 'a reply the Chief or a teammate asked for keeps them under the last reply');
});

test('web: the chat reads back to the run its open question is from when the page does not hold it', async () => {
  const ctx = page();
  const bot = { id: 'iw', asks: { text: 'What problem should it solve?', runId: 'old', at: at(1) } };
  assert.equal(ctx.chatBack(bot, null), 'old', 'no "New" line: back to the question');
  assert.equal(ctx.chatBack(bot, 'new1'), 'new1', 'a "New" line is never below the question');
  assert.equal(ctx.chatBack({ id: 'iw' }, null), null);

  // The page's newest runs of all bots hold none of this bot's: its chat was empty with "Needs you" on its key.
  ctx.state.runs = [run('x', 50, { botId: 'other' })];
  assert.deepEqual([...ctx.chatRuns('iw', 'old')].map((r) => r.id), []);
  const drawn = ctx.Unread.shown(ctx.chatRuns('iw', 'old'), 'old');
  assert.equal(drawn.missing, true);
  ctx.pages.push([run('old', 1, { result: 'What problem should it solve?' })]);
  ctx.reachNew('iw', 'old');
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(ctx.chatRuns('iw', 'old').map((r) => r.id), ['old'], 'the question is in the chat');
});

test('web: a bot\'s chat reads its own newest runs: other bots\' runs do not push the owner\'s messages out of it', async () => {
  const ctx = page();
  // The page's newest runs of all bots hold none of this bot's: a busy account's other bots (their jobs, quiet ones too).
  ctx.state.runs = [run('x', 50, { botId: 'other' })];
  assert.deepEqual([...ctx.chatRuns('iw', null)].map((r) => r.id), [], 'read, with no "New" line: the chat was empty');
  ctx.pages.push([run('mine', 2, { prompt: "Why I don't see those files?" }), run('quiet', 1, { quiet: true })]);
  ctx.readOwnRuns('iw');
  assert.deepEqual([...ctx.asked], ['/runs?botId=iw&limit=40']);
  await new Promise((r) => setImmediate(r));
  assert.deepEqual([...ctx.chatRuns('iw', null)].map((r) => r.id), ['mine'], 'its own run is in its chat; a quiet one is not');
  assert.equal(ctx.redrawn, 1, 'the chat is drawn again');
  // The page's copy of a run it holds is the newest: it stands once.
  ctx.state.runs = [run('mine', 2, { status: 'running', result: null }), run('x', 50, { botId: 'other' })];
  assert.deepEqual([...ctx.chatRuns('iw', null)].map((r) => [r.id, r.status]), [['mine', 'running']]);
  // Read again with nothing new: not drawn again. Another bot's chat does not take them.
  ctx.pages.push([run('mine', 2, { prompt: "Why I don't see those files?" }), run('quiet', 1, { quiet: true })]);
  ctx.readOwnRuns('iw');
  await new Promise((r) => setImmediate(r));
  assert.equal(ctx.redrawn, 1);
  assert.deepEqual([...ctx.chatRuns('other', null)].map((r) => r.id), ['x']);
  // A chat that was left meanwhile does not keep what came for it.
  ctx.pages.push([run('late', 3)]);
  ctx.readOwnRuns('iw');
  ctx.state.botId = 'other';
  await new Promise((r) => setImmediate(r));
  ctx.state.botId = 'iw';
  assert.ok(![...ctx.chatRuns('iw', null)].some((r) => r.id === 'late'));
});
