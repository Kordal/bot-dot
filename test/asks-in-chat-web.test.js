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
    plain: (t) => String(t ?? ''), fmtTime: () => '09:41', runFigure: () => '', statusPill: () => '', renderBotChat: () => {}, pages: [],
  });
  ctx.api = (url) => Promise.resolve(ctx.pages.shift() || []);
  vm.runInContext(`${cut('const ENDED_BY = {', 'function detailsInfo(meta) {')}\n${cut('function messagedLabel(r) {', '// Notes other bots left')}\n${cut('function botThreadHTML(bot, runs, newFirst = null) {', '// "Run now" under the notes that wait')}\n${cut('// The run a bot\'s chat reaches back to', '// The plan under a reply that is done')}\nObject.assign(this, { botThreadHTML, chatBack, chatRuns, reachNew });`, ctx);
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
