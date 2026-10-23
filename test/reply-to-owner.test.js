// A reply to a teammate's message that only the owner reads is the owner's (#465): a bot that the asker no longer
// waits for sends its late answer back, nobody then waits for a reply to it, and the asker's reply addresses the
// owner (`notificationAudience: "owner"`), so the apps draw it as a reply, not folded between bots. A reply that goes
// back to a waiting teammate stays between bots.
// Tests here count on work for a busy bot waiting its turn: one run of a bot at a time (ADR 062).
process.env.BOT_DOT_RUNS_MAX = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { startServer, makeBot, heldRun, self, waitFor } = require('./helpers');
const { read, cut, esc, noDrafts } = require('./web-page');

let srv, lead, tester;
before(async () => {
  srv = await startServer();
  tester = await makeBot(srv, { name: 'QA Tester', emoji: '🧪' });
  lead = await makeBot(srv, { name: 'Quotz Lead', emoji: '🎩' });
});
after(() => { srv.unhold(); return srv.stop(); });

const runsOf = async (bot) => (await srv.api(`/runs?botId=${bot.id}`)).data;
const isRunOf = (bot, words = '') => (x) => x.args.includes(`${bot.emoji} ${bot.name}`) && x.stdin.includes(words);
const waits = () => { try { return JSON.parse(fs.readFileSync(path.join(srv.data, 'awaits.json'), 'utf8')); } catch { return []; } };

test('a reply that goes back to the waiting teammate stays between bots', async () => {
  const { rec, run, token } = await heldRun(srv, lead, 'Have the switches tested');
  await self(srv, token, 'message', { to: tester.id, message: 'Test the four switches.', priority: true });
  const asked = await srv.nextRun(isRunOf(tester, 'Test the four switches.'));
  srv.reply('I asked the tester.');
  srv.release(rec);
  await srv.finished(run.id);
  srv.reply('All four work.');
  srv.release(asked);
  const answer = await waitFor(async () => (await runsOf(tester)).find((r) => r.status === 'success'), { what: "the tester's reply" });
  assert.equal(answer.notificationAudience, 'internal', 'its reply goes to the bot that waits');
  const follow = await srv.nextRun(isRunOf(lead, 'All four work.'), "the lead's follow-up");
  srv.reply('All four switches work.');
  srv.release(follow);
  await waitFor(async () => (await runsOf(lead)).every((r) => r.status !== 'running'), { what: 'the lead to finish' });
});

test("a late answer to the bot that asked: nobody waits for a reply to it, and that bot's reply is the owner's", async () => {
  // The lead leaves the tester a note: the tester's run it wakes answers the lead, which waits for nothing.
  const { rec, run, token } = await heldRun(srv, lead, 'Have the switches tested again');
  await self(srv, token, 'message', { to: tester.id, message: 'Test the switches again when you can.', priority: false });
  const woke = await srv.nextRun(isRunOf(tester, 'Test the switches again when you can.'), 'the tester woken by the note');
  srv.reply('I left the tester a note.');
  srv.release(rec);
  await srv.finished(run.id);

  const sent = await self(srv, woke.self.env.RUN_TOKEN, 'message', { to: lead.id, message: 'Partial results: 3 of 4 blocked, 1 passed.', priority: true });
  assert.equal(sent.data.delivered, 'started');
  assert.ok(!waits().some((w) => w.botId === tester.id), 'the tester waits for no reply to its answer');
  const late = await srv.nextRun(isRunOf(lead, 'Partial results'), "the lead's run with the late answer");
  assert.match(late.system, /It is 🧪 QA Tester's answer to what you asked it earlier|It is QA Tester's answer to what you asked it earlier/);
  assert.doesNotMatch(late.system, /They go back with your reply to QA Tester/);
  srv.reply('3 of 4 switches are blocked, one passed.\nTest them again?\n\n[[choices: Yes | No]]');
  srv.release(late);
  srv.release(woke);
  const reply = await waitFor(async () => (await runsOf(lead)).find((r) => r.trigger === 'bot' && r.status === 'success'), { what: "the lead's reply" });
  assert.equal(reply.fromBot.id, tester.id);
  assert.equal(reply.notificationAudience, 'owner', 'only the owner reads it');
  assert.deepEqual([reply.choices, reply.askedAsker, reply.asks], [['Yes', 'No'], undefined, true], 'it asks the owner in its own chat');
  assert.ok(!(await runsOf(tester)).some((r) => r.trigger === 'replies'), 'nothing goes back to the tester');
});

function chat() {
  const lib = vm.createContext({});
  vm.runInContext(read('unread.js'), lib);
  const ctx = vm.createContext({ ...noDrafts,
    esc, plain: (t) => String(t || ''), Unread: lib.Unread, state: { keepOpen: null }, CHIEF_BOT: { id: 'chief', name: 'Chief of Staff' }, ICON: { play: '▶' },
    botLabel: (b) => esc(b?.name || ''), botFigure: () => '', scriptRunHTML: () => '', msgTime: (at) => `t(${at})`, dur: () => '2 s',
    notesFoldHTML: () => '', filesHTML: () => '', botFilesHTML: () => '', copyBtn: () => '<copy>',
    escMentions: (t) => esc(t), md: (t) => esc(t), friendlyProblem: () => '', learnedChips: () => '', choicesHTML: () => '', questionsHTML: () => '',
  });
  vm.runInContext(`${cut('function messagedLabel(r) {', '// Notes other bots left')}\n${cut('function botThreadHTML(bot, runs, newFirst = null) {', '// "Run now" under the notes that wait')}\nthis.botThreadHTML = botThreadHTML;`, ctx);
  return ctx;
}

test('web: a teammate\'s message stays folded; its reply folds only when it is not the owner\'s', () => {
  const bot = { id: 'ql', name: 'Quotz Lead', color: '#1d9e75' };
  const run = { id: 'r1', botId: 'ql', trigger: 'bot', fromBot: { id: 'qa', name: 'QA Tester' }, prompt: 'Partial results.', status: 'success', result: 'Three of four are blocked.', startedAt: '2026-10-23T12:02:00.000Z', endedAt: '2026-10-23T12:04:00.000Z' };
  const internal = chat().botThreadHTML(bot, [{ ...run, notificationAudience: 'internal' }]);
  assert.match(internal, /<span class="fold-who">Message from QA Tester<\/span>/);
  assert.match(internal, /<details class="notes-fold theirs" ><summary class="fold-line"><span class="fold-who">Replied<\/span>/);
  const owners = chat().botThreadHTML(bot, [{ ...run, notificationAudience: 'owner' }]);
  assert.match(owners, /<span class="fold-who">Message from QA Tester<\/span>/, 'the message from the bot stays folded');
  assert.doesNotMatch(owners, /notes-fold theirs/, 'the reply is not folded');
  assert.match(owners, /<div class="bubble from-bot "><div class="md">Three of four are blocked\.<\/div>/);
});
