// A bot's question is never lost, and Decline says that it removes (SURE-001; docs/api.md, "A bot that asks" and
// "Decline"). A reply that ends with answer buttons or a card of questions makes its bot ask: `asks` on the bot, the
// feed's `asks` event with `botId`, `needs_you`, until the owner writes to that bot. A scheduled run's question is
// never a quiet run, and waits out quiet hours as a report does. A run the Chief started asks the owner nothing:
// its questions stay in the reply as text, for the Chief. A job or tile that waits for its first approval says
// "Decline and remove".
// Nothing here waits for a schedule: botdot is stopped, a job is set to every minute, and back on it runs at once.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const choices = require('../lib/choices');
const { finishReport } = require('../lib/reporting');
const { quietRun } = require('../lib/problems');
const { runCounts, runAsks, asksFields, ownChatMessage } = require('../lib/read');
const { runSummary } = require('../lib/events');
const { startServer, restartServer, setJobs, makeBot, feed, waitFor, heldRun, self, seedRuns, readData } = require('./helpers');

const DAY = { start: 0, end: 0, timeZone: 'UTC' }; // equal hours: nothing is held
// Quiet hours that hold now, whatever the hour.
const nightNow = () => { const hour = new Date().getUTCHours(); return { start: hour, end: (hour + 23) % 24, timeZone: 'UTC' }; };
const BUTTONS = 'I found two drafts.\nShould I send the digest now?\n\n[[choices: Yes | No]]';
const CARD = '[[ask: Which account should I send it from?]]\n[[ask: Who is in copy?]]\n[[ask: When?]]';
const scheduled = (fields) => ({ id: 'r1', botName: 'Mail Sorter', trigger: 'schedule', status: 'success', notify: 'report-only', notificationAudience: 'owner', result: '', ...fields });
// A run of this bot that the stand-in started, by what it was handed (`words`: in its prompt).
const isRunOf = (bot, words = '') => (x) => x.args.includes(`${bot.emoji} ${bot.name}`) && x.stdin.includes(words);
// The feed, once it is connected: an event sent before that reaches nobody.
const listen = async (srv) => { const f = feed(srv); await f.wait('hello'); return f; };
const botOf = async (srv, bot) => (await srv.api(`/bots/${bot.id}`)).data;
const listed = async (srv, bot) => (await srv.api('/bots')).data.find((b) => b.id === bot.id);
// The owner's message to a bot, and its run once it ended.
const say = async (srv, bot, prompt) => srv.finished((await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt } })).data.id);
// The feed's events about a bot's open question, oldest first: each the run that asks, or null.
const asked = (f, bot) => f.events.filter((e) => e.type === 'asks' && e.data.botId === bot.id).map((e) => e.data.asks?.runId || null);

test('the question in one line, and a reply\'s questions as text', () => {
  assert.equal(choices.line({ result: 'I found v2.1. Should I install v2.1 now?', choices: ['Yes', 'No'] }), 'Should I install v2.1 now?', 'the last sentence that ends in a question mark');
  assert.equal(choices.line({ result: '**Send it?**\n\nIt has 3 pages.', choices: ['Yes', 'No'] }), 'Send it?');
  assert.equal(choices.line({ result: 'Pick one:\n- the first plan', choices: ['A', 'B'] }), 'the first plan', 'no question mark: the last line');
  assert.equal(choices.line({ result: '', choices: ['A', 'B'] }), 'A / B', 'a reply that is only its buttons');
  assert.equal(choices.line({ result: 'Two things.', questions: ['Which account?', 'Who is in copy?', 'When?'] }), 'Which account? (+2 more)');
  assert.equal(choices.line({ result: `${'long '.repeat(80)}?`, choices: ['A', 'B'] }).length, 201, 'at most 200 characters and "…"');
  assert.equal(choices.asText(choices.split('Send it?\n[[choices: Yes | No]]')), 'Send it?\n\nPossible answers: Yes | No');
  assert.equal(choices.asText(choices.split('[[ask: A?]]\n[[ask: B?]]')), 'Questions:\n- A?\n- B?');
  assert.equal(choices.asText(choices.split('No question.')), 'No question.');
});

test('a scheduled run with a question is never private: delivered as a reply, held at night, the report above it', () => {
  const now = new Date();
  // A report-only job whose reply is only a card: not quiet, new, and it asks.
  const card = scheduled({ questions: ['Which account?', 'Who is in copy?'] });
  finishReport(card, now, DAY);
  assert.deepEqual([card.reporting, card.result], ['delivered', '']);
  assert.ok(!quietRun(card) && runCounts(card) && runAsks(card));
  assert.deepEqual((({ asks, title, result, quiet }) => ({ asks, title, result, quiet }))(runSummary(card)), { asks: true, title: 'Mail Sorter asks', result: 'Which account? (+1 more)', quiet: false });
  assert.equal(runSummary(card).question, 'Which account? (+1 more)');
  // A long reply asks at its end: `result` is its first 300 characters, and `question` says the question.
  const long = { id: 'r2', botName: 'Mail Sorter', trigger: 'manual', status: 'success', result: `${'I read the inbox. '.repeat(30)}Should I archive the newsletters?`, choices: ['Yes', 'No'] };
  const told = runSummary(long);
  assert.deepEqual([told.result.length, told.result.includes('archive'), told.asks, told.title, told.question], [301, false, true, 'Mail Sorter asks', 'Should I archive the newsletters?']);
  assert.deepEqual(asksFields(long), { asks: true, question: 'Should I archive the newsletters?' });
  // A run that does not ask has neither field.
  assert.deepEqual([asksFields({ ...long, choices: undefined }), 'question' in runSummary({ ...long, choices: undefined })], [{}, false]);
  // Its text is the reply's; "nothing new" before a question is not dropped.
  const buttons = scheduled({ result: 'Nothing new. Should I keep watching?', choices: ['Yes', 'No'] });
  finishReport(buttons, now, DAY);
  assert.deepEqual([buttons.reporting, buttons.result], ['delivered', 'Nothing new. Should I keep watching?']);
  // In quiet hours it is held as a report is: quiet, not new, and it does not ask yet.
  const night = scheduled({ questions: ['Which account?', 'Who is in copy?'] });
  finishReport(night, now, nightNow());
  assert.equal(night.reporting, 'held');
  assert.ok(quietRun(night) && !runCounts(night) && !runAsks(night));
  assert.equal(runSummary(night).asks, undefined);
  const morning = { ...night, reporting: 'delivered', deliveredAt: now.toISOString() };
  assert.ok(!quietRun(morning) && runAsks(morning), 'delivered when they end');
  // The report it sent stands above the reply; an urgent one is not held.
  const both = scheduled({ result: 'Should I pay them?', choices: ['Yes', 'No'], ownerReport: { message: 'Three new invoices.', urgent: true } });
  finishReport(both, now, nightNow());
  assert.deepEqual([both.reporting, both.result, both.rawResult], ['delivered', 'Three new invoices.\n\nShould I pay them?', 'Should I pay them?']);
  // A one-time job's reply that is only a question is no quiet run either.
  const once = scheduled({ oneTime: true, choices: ['Yes', 'No'] });
  finishReport(once, now, nightNow());
  assert.ok(once.reporting === 'delivered' && !quietRun(once) && runAsks(once));
  // With no question and nothing to report it is quiet, as before.
  const nothing = scheduled({ result: 'Checked: all fine.' });
  finishReport(nothing, now, DAY);
  assert.deepEqual([nothing.reporting, nothing.result, quietRun(nothing), runAsks(nothing)], ['quiet', '', true, false]);
  // A run an earlier botdot stored as quiet, or kept without saying how it was reported, stays quiet: no old
  // question comes back.
  assert.ok(quietRun(scheduled({ reporting: 'quiet', choices: ['Yes', 'No'] })));
  assert.ok(quietRun(scheduled({ choices: ['Yes', 'No'] })));
});

test('who is asked: the owner by their own bot\'s reply, also in a run a teammate started (#233), never in a run the Chief started', () => {
  const reply = { status: 'success', trigger: 'manual', result: 'Send it?', choices: ['Yes', 'No'] };
  assert.equal(runAsks(reply), true);
  assert.equal(runAsks({ ...reply, choices: undefined }), false, 'no question');
  assert.equal(runAsks({ ...reply, status: 'error' }), false, 'a run that failed asks nothing');
  const request = { ...reply, trigger: 'bot', fromBot: { id: 'b2' }, notificationAudience: 'internal' };
  assert.equal(runAsks(request), true, "a teammate's request that needs the owner's word asks the owner");
  assert.equal(runCounts(request), true, 'and is new for the owner');
  assert.equal(runCounts({ ...request, choices: undefined }), false, 'a plain reply to a teammate stays folded');
  assert.equal(runAsks({ ...reply, startedBy: 'chief' }), false, 'a run the Chief started');
  assert.equal(ownChatMessage({ trigger: 'manual' }), true);
  assert.equal(ownChatMessage({ trigger: 'manual', jobId: 'j1' }), false, '"Run now" is no message');
  assert.equal(ownChatMessage({ trigger: 'manual', continues: 'r0' }), false, 'a run botdot started again after a yes');
  assert.equal(ownChatMessage({ trigger: 'manual', startedBy: 'chief' }), false);
  assert.equal(ownChatMessage({ trigger: 'schedule' }), false);
});

test("a bot asks until the owner writes to it: asks on the bot, the feed's event, needs_you, and the same after a restart", async () => {
  let srv = await startServer();
  let f = await listen(srv);
  try {
    const bot = await makeBot(srv, { name: 'Mail Sorter', emoji: '📬' });
    const job = (await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Digest', cron: '0 3 1 1 *', prompt: 'Compile the weekly digest', notify: 'always' } })).data;
    assert.equal(job.approved, true);
    assert.ok((await srv.api('/version')).data.features.includes('asks-you'));
    assert.equal((await botOf(srv, bot)).asks, undefined);

    // A reply with answer buttons: the bot asks.
    srv.reply(BUTTONS);
    const first = await say(srv, bot, 'make the digest');
    assert.deepEqual([first.asks, first.question, first.choices, first.result], [true, 'Should I send the digest now?', ['Yes', 'No'], 'I found two drafts.\nShould I send the digest now?']);
    const ended = (await f.wait('run_finished', (d) => d.id === first.id)).data;
    assert.deepEqual([ended.asks, ended.title, ended.question, ended.result], [true, 'Mail Sorter asks', 'Should I send the digest now?', 'I found two drafts.\nShould I send the digest now?']);
    assert.equal((await srv.api(`/runs?botId=${bot.id}`)).data.find((r) => r.id === first.id).question, 'Should I send the digest now?', 'in the list of runs too');
    const asks = { text: 'Should I send the digest now?', runId: first.id, at: first.endedAt };
    for (const b of [await botOf(srv, bot), await listed(srv, bot)]) assert.deepEqual([b.asks, b.state], [asks, 'needs_you']);
    assert.deepEqual((await f.wait('asks', (d) => d.botId === bot.id)).data.asks, asks);
    assert.equal((await srv.api(`/runs?botId=${bot.id}`)).data[0].asks, true, 'in the list of runs');

    // The same after botdot is stopped and started.
    f.close();
    srv = await restartServer(srv);
    f = await listen(srv);
    for (const b of [await botOf(srv, bot), await listed(srv, bot)]) assert.deepEqual([b.asks, b.state], [asks, 'needs_you']);

    // A tapped answer ends it, as the message is taken; its reply asks again, with a card: the new question.
    srv.hold();
    srv.reply(`Two things first.\n\n${CARD}`);
    const tapped = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Yes' } })).data;
    const rec = await srv.nextRun(isRunOf(bot, 'Yes'));
    assert.equal(tapped.answers, first.id, 'the tapped answer');
    assert.deepEqual([(await botOf(srv, bot)).asks, (await listed(srv, bot)).asks], [undefined, undefined]);
    assert.notEqual((await botOf(srv, bot)).state, 'needs_you');
    assert.equal((await f.wait('asks', (d) => d.botId === bot.id)).data.asks, null, 'the feed says so');
    srv.release(rec);
    const second = await srv.finished(tapped.id);
    assert.deepEqual([second.asks, second.questions.length], [true, 3]);
    assert.deepEqual((await botOf(srv, bot)).asks, { text: 'Which account should I send it from? (+2 more)', runId: second.id, at: second.endedAt });
    await waitFor(() => asked(f, bot).at(-1) === second.id, { what: 'the new question on the feed' });

    // While the bot is busy with something else the question stays; a message that waits its turn ends it, and
    // taken back it is open again.
    srv.reply('Done.');
    const going = (await srv.api(`/bots/${bot.id}/jobs/${job.id}/run`, { method: 'POST' })).data;
    const jobRec = await srv.nextRun(isRunOf(bot, 'Compile the weekly digest'));
    assert.equal((await botOf(srv, bot)).asks.runId, second.id, '"Run now" is no message of the owner');
    const waits = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Use the work account, nobody in copy, today' } })).data;
    assert.equal(waits.status, 'queued');
    assert.equal((await botOf(srv, bot)).asks, undefined, 'a message that waits its turn ends it');
    await waitFor(() => asked(f, bot).at(-1) === null, { what: 'the end of the question on the feed' });
    assert.equal((await srv.api(`/bots/${bot.id}/queued/${waits.id}`, { method: 'DELETE' })).status, 200);
    assert.equal((await botOf(srv, bot)).asks.runId, second.id, 'taken back: not answered after all');
    await waitFor(() => asked(f, bot).at(-1) === second.id, { what: 'the question on the feed again' });

    // A newer reply without a question ends it: here the job's, which nobody answered anything with.
    srv.release(jobRec);
    await srv.finished(going.run.id);
    assert.equal((await botOf(srv, bot)).asks, undefined);
    await waitFor(() => asked(f, bot).at(-1) === null, { what: 'the end of the question on the feed' });
    assert.notEqual((await botOf(srv, bot)).state, 'needs_you');
    assert.deepEqual(asked(f, bot), [null, second.id, null, second.id, null], 'each change once');

    // A typed message ends it too.
    srv.unhold();
    srv.reply(BUTTONS);
    const third = await say(srv, bot, 'and the digest of today?');
    assert.equal((await botOf(srv, bot)).asks.runId, third.id);
    srv.reply('Sent.');
    const typed = await say(srv, bot, 'send it, but only to me');
    assert.equal(typed.answers, undefined, 'typed, not one of the answers');
    assert.equal((await botOf(srv, bot)).asks, undefined);
  } finally { f.close(); srv.unhold(); await srv.stop(); }
});

test("a job's question is never quiet: it is in the chat with its answers, new, and at night it is held and delivered when quiet hours end", async () => {
  let srv = await startServer();
  let f;
  try {
    await srv.api('/settings', { method: 'PUT', body: { quietHours: DAY } });
    const asker = await makeBot(srv, { name: 'Mail Sorter', emoji: '📬' });
    const watcher = await makeBot(srv, { name: 'Watcher', emoji: '👀' });
    const jobs = {};
    for (const bot of [asker, watcher]) jobs[bot.id] = (await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Morning check', cron: '0 3 1 1 *', prompt: `Check for ${bot.name}` } })).data;
    assert.equal(jobs[asker.id].notify, 'report-only');
    // Both jobs come due as botdot starts; each run is held until its reply is set.
    srv.hold();
    const due = (list) => (data) => setJobs(data, Object.fromEntries(list.map((b) => [jobs[b.id].id, { cron: '* * * * *' }])));
    const had = new Set(); // the stand-in's runs this test has looked at, over its restarts
    const once = async (bot) => { // its scheduled run, started; the job runs no second time
      const rec = await srv.nextRun((x) => !had.has(x.n) && isRunOf(bot, `Check for ${bot.name}`)(x), `the job of ${bot.name}`);
      had.add(rec.n);
      await srv.api(`/bots/${bot.id}/jobs/${jobs[bot.id].id}`, { method: 'PUT', body: { enabled: false } });
      return { rec, id: (await srv.api(`/runs?botId=${bot.id}`)).data[0].id };
    };
    srv = await restartServer(srv, due([asker, watcher]));
    f = await listen(srv);
    const [a, w] = [await once(asker), await once(watcher)];
    assert.match(a.rec.system, /A final reply that ends with a question for the owner, marked with \[\[choices: …\]\] or \[\[ask: …\]\] lines, always reaches the owner/);

    // The reply is only a question: a reply to the owner all the same.
    srv.reply(CARD);
    srv.release(a.rec);
    const question = await srv.finished(a.id);
    assert.deepEqual([question.trigger, question.notify, question.reporting, question.result, question.quiet, question.asks], ['schedule', 'report-only', 'delivered', '', undefined, true]);
    assert.equal(question.questions.length, 3, 'its chat shows the reply with its answers');
    const told = (await f.wait('run_finished', (d) => d.id === a.id)).data;
    assert.deepEqual([told.quiet, told.new, told.asks, told.title, told.result], [false, true, true, 'Mail Sorter asks', 'Which account should I send it from? (+2 more)']);
    const bot = await botOf(srv, asker);
    assert.deepEqual([bot.unread, bot.state, bot.asks], [1, 'needs_you', { text: 'Which account should I send it from? (+2 more)', runId: a.id, at: question.endedAt }]);
    assert.equal(bot.jobs[0].last.status, 'success');

    // No question and nothing to report: quiet as today.
    srv.reply('Checked: all fine.');
    srv.release(w.rec);
    const nothing = await srv.finished(w.id);
    assert.deepEqual([nothing.reporting, nothing.quiet, nothing.asks], ['quiet', true, undefined]);
    const quiet = await botOf(srv, watcher);
    assert.deepEqual([quiet.unread, quiet.asks, quiet.jobs[0].last.status], [0, undefined, 'quiet']);

    // At night the watcher's job asks: held, like a report.
    f.close();
    await srv.api('/settings', { method: 'PUT', body: { quietHours: nightNow() } });
    await srv.api(`/bots/${watcher.id}/jobs/${jobs[watcher.id].id}`, { method: 'PUT', body: { enabled: true } });
    srv = await restartServer(srv, due([watcher]));
    const n = await once(watcher);
    srv.reply(BUTTONS);
    srv.release(n.rec);
    const held = await srv.finished(n.id);
    assert.deepEqual([held.reporting, held.quiet, held.asks, held.choices], ['held', true, undefined, ['Yes', 'No']]);
    const waiting = await botOf(srv, watcher);
    assert.deepEqual([waiting.unread, waiting.asks, waiting.jobs[0].last.status], [0, undefined, 'held']);
    assert.notEqual(waiting.state, 'needs_you');

    // Quiet hours end while botdot is off: delivered as it starts, and now the bot asks.
    srv = await restartServer(srv, (data) => {
      const file = path.join(data, 'settings.json');
      fs.writeFileSync(file, JSON.stringify({ ...readData(data, 'settings.json'), quietHours: DAY }));
    });
    const morning = await waitFor(async () => { const r = (await srv.api(`/runs/${n.id}`)).data; return r.reporting === 'delivered' ? r : null; }, { what: 'the held question to be delivered' });
    assert.deepEqual([morning.quiet, morning.asks, !!morning.deliveredAt], [undefined, true, true]);
    const now = await botOf(srv, watcher);
    assert.deepEqual([now.unread, now.state, now.asks], [1, 'needs_you', { text: 'Should I send the digest now?', runId: n.id, at: morning.deliveredAt }]);
  } finally { f?.close(); srv.unhold(); await srv.stop(); }
});

test("a run the Chief started gets no note for answer buttons; a question it writes all the same goes to the Chief as text, and a teammate's request is as before", async () => {
  const srv = await startServer();
  try {
    const bot = await makeBot(srv, { name: 'Mail Sorter', emoji: '📬' });
    const helper = await makeBot(srv, { name: 'Fleet Helper', emoji: '🛟' });
    const isChief = (x) => x.args.includes('🧭 Chief of Staff');

    // The Chief's run_bot, in a chat whose reply started it.
    srv.hold();
    const run = (await srv.asChief(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Send the digest' } })).data;
    const rec = await srv.nextRun(isRunOf(bot, 'Send the digest'));
    assert.ok(!rec.system.includes(choices.NOTE) && !/\[\[choices|\[\[ask/.test(rec.system), 'no note that asks for the lines');
    assert.ok(rec.system.includes('When they ask you to put something on it, or you notice') && !rec.system.includes('first ask them exactly one short question'), 'its Board note asks no question of the owner, who sees none of this run (#31)');
    const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
    const file = path.join(srv.data, 'chief', `${chat.id}.json`);
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    saved.messages.push({ role: 'user', text: 'do it', at: new Date().toISOString() }, { role: 'chief', text: "It's still going.", at: new Date().toISOString(), actions: [{ kind: 'run', text: 'Started a bot', runId: run.id }] });
    fs.writeFileSync(file, JSON.stringify(saved));
    srv.reply('Which account should I use?\n\n[[choices: Work | Private]]');
    srv.release(rec);
    const done = await srv.finished(run.id);
    assert.deepEqual([done.result, done.choices, done.questions, done.asks], ['Which account should I use?\n\nPossible answers: Work | Private', undefined, undefined, undefined]);
    const asked = await botOf(srv, bot);
    assert.equal(asked.asks, undefined, 'the bot gets no open question');
    assert.notEqual(asked.state, 'needs_you');
    // The Chief's turn about that run holds the question and its answers.
    const turn = await srv.nextRun((x) => isChief(x) && x.stdin.includes(`run ${run.id}`), "the Chief's turn");
    assert.match(turn.stdin, /<bot-reply>\nWhich account should I use\?\n\nPossible answers: Work \| Private\n<\/bot-reply>/);
    assert.match(turn.stdin, /That reply ends with a question, and the answers Mail Sorter offers\. The user has not been asked it/);
    srv.reply('Done.');
    for (const r of srv.runs().filter(isChief)) srv.release(r);
    await waitFor(async () => !(await srv.api(`/chief/chats/${chat.id}`)).data.busy, { what: 'the Chief to finish' });

    // A task of the Chief's in which the bot asks a teammate: the run that finishes it after the answer is the
    // Chief's too. No note, and its question stays text.
    const task = (await srv.asChief(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Find the VM with the helper' } })).data;
    const taskRec = await srv.nextRun(isRunOf(bot, 'Find the VM with the helper'));
    await self(srv, taskRec.self.env.RUN_TOKEN, 'message', { to: helper.id, message: 'Which VM runs the mail?', priority: true });
    const helpRec = await srv.nextRun(isRunOf(helper, 'Which VM runs the mail?'));
    srv.reply('I asked the helper.');
    srv.release(taskRec);
    await srv.finished(task.id);
    srv.reply('VM 103.');
    srv.release(helpRec);
    const lastRec = await srv.nextRun((x) => isRunOf(bot)(x) && x.at > helpRec.at, 'the run that finishes the task');
    assert.ok(!lastRec.system.includes(choices.NOTE));
    srv.reply('Shall I restart VM 103?\n\n[[choices: Yes | No]]');
    srv.release(lastRec);
    const last = await waitFor(async () => (await srv.api(`/runs?botId=${bot.id}`)).data.find((r) => r.trigger === 'replies' && r.status !== 'running'), { what: 'the run that finishes the task to end' });
    assert.deepEqual([last.result, last.choices, last.asks, last.askedChief], ['Shall I restart VM 103?\n\nPossible answers: Yes | No', undefined, undefined, true]);
    assert.equal((await botOf(srv, bot)).asks, undefined);

    // An owner's own message gets the note, and so does a teammate's request (#233): what it needs from the owner, an
    // OK on a change or an answer only they can give, it asks them in the reply, which asks the owner.
    const origin = await heldRun(srv, bot, 'Ask the helper');
    assert.ok(origin.rec.system.includes(choices.NOTE));
    await self(srv, origin.token, 'message', { to: helper.id, message: 'Make the VM', priority: true });
    const helped = await srv.nextRun(isRunOf(helper));
    assert.ok(helped.system.includes(choices.NOTE));
    assert.match(helped.system, /needs the owner's OK .*ask them at the end of your reply/);
    srv.reply('I plan VM 107. Should I make it?\n\n[[choices: Yes | No]]');
    srv.release(helped);
    const answer = await srv.finished((await srv.api(`/runs?botId=${helper.id}`)).data[0].id);
    assert.deepEqual([answer.result, answer.choices, answer.asks, answer.trigger], ['I plan VM 107. Should I make it?', ['Yes', 'No'], true, 'bot']);
    assert.equal((await botOf(srv, helper)).asks?.runId, answer.id, 'the helper asks the owner');
    srv.reply('Done.');
  } finally { srv.unhold(); await srv.stop(); }
});

test('a job and a tile that wait for their first approval say "Decline and remove", and the decline answers "Declined and removed"', async () => {
  const srv = await startServer();
  try {
    assert.ok((await srv.api('/version')).data.features.includes('decline-words'));
    const bot = await makeBot(srv, { name: 'Watcher', emoji: '👀' });
    const script = (await srv.asChief(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Disk check', kind: 'script', cron: '0 * * * *', script: 'df -h', assessment: 'A clear rule: no AI needed.' } })).data;
    const own = (await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Digest', cron: '0 3 * * *', prompt: 'Make the digest' } })).data;
    const tile = (await srv.asChief('/dashboard/tiles', { method: 'POST', body: { kind: 'value', title: 'Door', read: { type: 'script', script: 'cat /tmp/door-state' }, bot: bot.id } })).data;
    assert.deepEqual([script.approved, script.no, own.approved, own.no], [false, 'Decline and remove', true, undefined], 'only what waits has it');
    assert.equal((await botOf(srv, bot)).jobs.find((j) => j.id === script.id).no, 'Decline and remove');
    assert.equal((await srv.api('/dashboard')).data.pending.find((t) => t.id === tile.id).no, 'Decline and remove');
    // The feed's waiting items, as an app that just connected reads them.
    const f = feed(srv);
    const waits = (await f.wait('hello')).data.approvals;
    f.close();
    assert.equal(waits.jobs.find((j) => j.jobId === script.id).no, 'Decline and remove');
    assert.equal(waits.tiles.find((t) => t.tileId === tile.id).no, 'Decline and remove');

    // The answers: their other fields are as an app from before reads them.
    const job = await srv.api(`/bots/${bot.id}/jobs/${script.id}/approve`, { method: 'POST', body: { approve: false } });
    assert.deepEqual(job.data, { ok: true, removed: true, text: 'Declined and removed' });
    assert.ok(!(await botOf(srv, bot)).jobs.some((j) => j.id === script.id), 'removed');
    const gone = await srv.api(`/dashboard/tiles/${tile.id}/approve`, { method: 'POST', body: { approve: false } });
    assert.deepEqual(gone.data, { ok: true, text: 'Declined and removed' });
    assert.ok(!(await srv.api('/dashboard')).data.pending.length);
    // A yes says nothing of the kind.
    const second = (await srv.asChief(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Disk check', kind: 'script', cron: '0 * * * *', script: 'df -h', assessment: 'A clear rule: no AI needed.' } })).data;
    const yes = (await srv.api(`/bots/${bot.id}/jobs/${second.id}/approve`, { method: 'POST', body: { approve: true } })).data;
    assert.deepEqual([yes.approved, yes.no, yes.text], [true, undefined, undefined]);
  } finally { await srv.stop(); }
});

test('an open question found on disk: the newest reply to the owner decides, and a run stored as quiet brings no old question back', async () => {
  let srv = await startServer();
  try {
    const bot = await makeBot(srv, { name: 'Mail Sorter', emoji: '📬' });
    const other = await makeBot(srv, { name: 'Watcher', emoji: '👀' });
    let ids;
    srv = await restartServer(srv, () => {
      // A question, then a run of the Chief's and a quiet run, which are no replies to the owner: still open.
      ids = seedRuns(srv, bot, [{ result: 'Send it?', choices: ['Yes', 'No'] }, { startedBy: 'chief', notificationAudience: 'internal', result: 'Done for the Chief.' }, { trigger: 'schedule', notify: 'report-only', jobId: 'j1', customPrompt: false, reporting: 'quiet', result: '' }]);
      // A questions-only run that an earlier botdot stored as quiet.
      seedRuns(srv, other, [{ trigger: 'schedule', notify: 'report-only', jobId: 'j1', customPrompt: false, reporting: 'quiet', result: '', choices: ['Yes', 'No'] }]);
    });
    assert.equal((await botOf(srv, bot)).asks.runId, ids[0]);
    assert.deepEqual([(await botOf(srv, other)).asks, (await botOf(srv, other)).unread], [undefined, 0]);
  } finally { await srv.stop(); }
});
