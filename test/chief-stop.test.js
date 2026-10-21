// Stop in a Chief chat ends what it started (BUSY-003, ADR 012; docs/api.md "Stop in a Chief chat"): the reply,
// and every bot run that reply started and that is still going. A run of it that still waits to start never
// starts; the reply says which runs were stopped too. A run an earlier reply started and a teammate's run go on,
// what waits behind the reply and behind each stopped run starts, and the Chief gets no turn for what Stop ended.
// The turns are played by the stand-in for Claude; the runs are real runs, asked for as the Chief's tools ask.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, self, feed, waitFor } = require('./helpers');

let srv; let quick; let f;
before(async () => {
  // quick: a process that does not end when asked to is killed after a moment there, not after five seconds.
  [srv, quick] = await Promise.all([startServer(), startServer({ env: { BOT_DOT_KILL_AFTER_MS: '300' } })]);
  f = await feed(srv);
  await f.wait('hello');
});
after(async () => { f?.close(); await Promise.all([srv.stop(), quick.stop()]); });

const isRunOf = (bot) => (x) => x.args.includes(`${bot.emoji} ${bot.name}`);
const chatOf = async (id, on = srv) => (await on.api(`/chief/chats/${id}`)).data;
const settled = (id, on = srv) => waitFor(async () => { const c = await chatOf(id, on); return !c.busy && !c.messages.some((m) => m.pending) ? c : null; }, { what: 'the chat to be quiet' });
const runOf = async (id) => (await srv.api(`/runs/${id}?events=0`)).data;
const stop = (chat, on = srv) => on.api(`/chief/chats/${chat.id}/stop`, { method: 'POST' });

// A Chief turn that is going in a chat (held), and what its tools do: run(bot) asks for a run as run_bot does
// and, unless `chip: false`, lets the turn read the tool's answer, so that the reply has the run as its action.
let calls = 0;
async function turn(text, chat = null) {
  srv.hold();
  chat ||= (await srv.api('/chief/chats', { method: 'POST' })).data;
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text } });
  const rec = await srv.nextRun((x) => !!x.botdot && x.stdin.includes(text), 'the Chief turn');
  const events = [];
  const play = (...more) => { events.push(...more); fs.writeFileSync(path.join(srv.out, `events-${rec.n}.json`), JSON.stringify(events)); };
  const chips = (n) => waitFor(async () => ((await chatOf(chat.id)).messages.at(-1).actions || []).length >= n, { what: `${n} chips` });
  async function run(bot, prompt, { chip = true } = {}) {
    const asked = (await srv.asChief(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt }, headers: { 'X-Chief-Chat': chat.id } })).data;
    if (chip) {
      const id = `call-${++calls}`;
      play({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'mcp__botdot__run_bot', input: { id: bot.id } }] } },
        { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: JSON.stringify({ id: asked.id, bot: bot.name, status: asked.status }) }] } });
    }
    return asked;
  }
  return { chat, rec, run, chips, play };
}

test('Stop ends the reply and the runs it started that are still going; one that waited never starts; a finished run, an earlier reply\'s run and a teammate\'s run are left alone', async () => {
  const [surfer, mail, done, earlier, mate] = await Promise.all(['Web Surfer', 'Mail Bot', 'Done Bot', 'Earlier Bot', 'Team Mate'].map((name, i) => makeBot(srv, { name, emoji: ['🏄', '📬', '✅', '🕰️', '🤝'][i] })));
  // An earlier reply of this chat started a run that is still going.
  const first = await turn('Have Earlier Bot dig');
  const old = await first.run(earlier, 'Dig');
  await first.chips(1);
  first.play({ type: 'result', subtype: 'success', is_error: false, result: 'Earlier Bot is digging.', total_cost_usd: 0.01 });
  srv.release(first.rec);
  await settled(first.chat.id);
  // This reply starts three runs and asks for a fourth on a bot that is busy; one of the three has finished.
  const t = await turn('Now have the others look', first.chat);
  const surfing = await t.run(surfer, 'Surf');
  const surferRec = await srv.nextRun(isRunOf(surfer), 'Web Surfer to start');
  const mailing = await t.run(mail, 'Read the mail');
  const finished = await t.run(done, 'Be quick');
  srv.release(await srv.nextRun(isRunOf(done), 'Done Bot to start'));
  assert.equal((await srv.finished(finished.id)).status, 'success');
  await srv.asChief(`/runs/${finished.id}?seen=chief&events=0`); // the Chief read how it ended, as its wait_for_run does: no turn about it follows
  const waiting = await t.run(surfer, 'Surf some more');
  assert.equal(waiting.status, 'queued');
  await t.chips(4);
  // Web Surfer's run asked a teammate, whose run belongs to its own exchange. The owner's own message waits for Mail Bot.
  await self(srv, surferRec.self.env.RUN_TOKEN, 'message', { to: mate.id, message: 'Help me surf.', priority: true });
  const mateRec = await srv.nextRun(isRunOf(mate), 'Team Mate to start');
  const mateRun = (await srv.api(`/runs?botId=${mate.id}`)).data[0];
  const mine = (await srv.api(`/bots/${mail.id}/run`, { method: 'POST', body: { prompt: 'My own question' } })).data;
  assert.equal(mine.status, 'queued');

  assert.deepEqual((await stop(t.chat)).data, { ok: true });
  const chat = await settled(t.chat.id);
  const reply = chat.messages.at(-1);
  assert.equal(reply.error, 'You stopped this reply. The runs of Web Surfer and Mail Bot were stopped too.');
  assert.deepEqual(reply.stopped, [
    { botId: surfer.id, name: 'Web Surfer', runId: surfing.id },
    { botId: mail.id, name: 'Mail Bot', runId: mailing.id },
    { botId: surfer.id, name: 'Web Surfer', runId: waiting.id },
  ]);
  assert.equal((await f.wait('chief_reply', (d) => d.chatId === t.chat.id && d.error === reply.error)).data.status, 'stopped');
  // The runs that were going: stopped, by the owner, and not passed on to the Chief.
  for (const run of [surfing, mailing]) {
    const ended = await srv.finished(run.id);
    assert.deepEqual([ended.status, ended.endedBy, ended.problem], ['stopped', 'owner', 'You stopped this run before it finished.']);
    assert.equal((await f.wait('run_finished', (d) => d.id === run.id)).data.passedOn, undefined);
  }
  // The one that waited: gone. Web Surfer is free and starts nothing.
  assert.equal((await srv.api(`/runs/${waiting.id}`)).status, 404);
  // The owner's message that waited for Mail Bot starts, now that its run has ended.
  const mineRec = await srv.nextRun((x) => isRunOf(mail)(x) && x.stdin.startsWith('My own question'), "the owner's message to start");
  // Left alone: the run that had finished, the earlier reply's run, the teammate's run.
  assert.deepEqual([(await runOf(finished.id)).status, (await runOf(old.id)).status, (await runOf(mateRun.id)).status], ['success', 'running', 'running']);
  assert.deepEqual((await srv.api(`/runs?botId=${surfer.id}`)).data.map((r) => r.status), ['stopped'], 'nothing started behind the stopped run');
  // The Chief gets no turn for what Stop ended.
  const after = await chatOf(t.chat.id);
  assert.deepEqual([after.busy, after.messages.length], [false, chat.messages.length]);
  for (const rec of [mineRec, mateRec]) srv.release(rec);
  srv.unhold();
  await Promise.all([srv.finished(mine.id), srv.finished(old.id), srv.finished(mateRun.id)]);
  await settled(t.chat.id);
});

test("one run: the reply names its bot; none: the sentence stands alone, with no list", async () => {
  const bot = await makeBot(srv, { name: 'Lone Runner', emoji: '🏃' });
  const t = await turn('Have Lone Runner go');
  const run = await t.run(bot, 'Go');
  await t.chips(1);
  await stop(t.chat);
  const reply = (await settled(t.chat.id)).messages.at(-1);
  assert.deepEqual([reply.error, reply.stopped], ["You stopped this reply. Lone Runner's run was stopped too.", [{ botId: bot.id, name: 'Lone Runner', runId: run.id }]]);
  assert.equal((await srv.finished(run.id)).endedBy, 'owner');
  const none = await turn('Just think');
  await stop(none.chat);
  const alone = (await settled(none.chat.id)).messages.at(-1);
  assert.deepEqual([alone.error, 'stopped' in alone], ['You stopped this reply.', false]);
  srv.unhold();
});

test("a job's run the reply started with run_job is ended too", async () => {
  const bot = await makeBot(srv, { name: 'Job Runner', emoji: '⏰' });
  const job = (await srv.asChief(`/bots/${bot.id}/jobs`, { method: 'POST', body: { kind: 'ai', name: 'Morning check', cron: '0 3 * * *', prompt: 'Check the mail.', assessment: 'Needs AI' } })).data;
  if (!job.approved) await srv.api(`/bots/${bot.id}/jobs/${job.id}/approve`, { method: 'POST', body: { approve: true } });
  const t = await turn('Run the morning check now');
  const ran = (await srv.asChief(`/bots/${bot.id}/jobs/${job.id}/run`, { method: 'POST', headers: { 'X-Chief-Chat': t.chat.id } })).data;
  await srv.nextRun(isRunOf(bot), "the job's run");
  t.play({ type: 'assistant', message: { content: [{ type: 'tool_use', id: 'job-1', name: 'mcp__botdot__run_job', input: { botId: bot.id, jobId: job.id } }] } },
    { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'job-1', content: JSON.stringify(ran) }] } });
  await t.chips(1);
  await stop(t.chat);
  const reply = (await settled(t.chat.id)).messages.at(-1);
  assert.deepEqual([reply.error, reply.stopped], ["You stopped this reply. Job Runner's run was stopped too.", [{ botId: bot.id, name: 'Job Runner', runId: ran.run.id }]]);
  const ended = await srv.finished(ran.run.id);
  assert.deepEqual([ended.status, ended.endedBy, ended.jobName], ['stopped', 'owner', 'Morning check']);
  srv.unhold();
});

test("a job's run that run_job left waiting behind a busy bot is taken away, when that call put it there", async () => {
  const bot = await makeBot(srv, { name: 'Busy With Jobs', emoji: '🗓️' });
  const mk = async (name) => {
    const job = (await srv.asChief(`/bots/${bot.id}/jobs`, { method: 'POST', body: { kind: 'ai', name, cron: '0 3 * * *', prompt: `Do the ${name}.`, assessment: 'Needs AI' } })).data;
    if (!job.approved) await srv.api(`/bots/${bot.id}/jobs/${job.id}/approve`, { method: 'POST', body: { approve: true } });
    return job;
  };
  const [theirs, mine] = [await mk('night check'), await mk('day check')];
  const t = await turn('Run the checks now');
  // The bot is busy with the owner's message, and the owner's own "Run now" of one job waits already.
  const busy = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'First this' } })).data;
  const busyRec = await srv.nextRun(isRunOf(bot), 'the bot to be busy');
  assert.deepEqual((await srv.api(`/bots/${bot.id}/jobs/${mine.id}/run`, { method: 'POST' })).data, { queued: true });
  for (const job of [theirs, mine]) assert.deepEqual((await srv.asChief(`/bots/${bot.id}/jobs/${job.id}/run`, { method: 'POST', headers: { 'X-Chief-Chat': t.chat.id } })).data, { queued: true }, 'the answer is as before');
  await stop(t.chat);
  const reply = (await settled(t.chat.id)).messages.at(-1);
  assert.deepEqual([reply.error, 'stopped' in reply], ['You stopped this reply.', false], 'it had no run yet: nothing names it');
  // The bot is free: the owner's own "Run now" starts, the Chief's never does.
  srv.unhold();
  srv.release(busyRec);
  await srv.finished(busy.id);
  const ran = await waitFor(async () => { const all = (await srv.api(`/runs?botId=${bot.id}`)).data; return all.length > 1 && all.every((r) => r.status !== 'running') && !(await srv.api('/bots')).data.find((b) => b.id === bot.id).running ? all : null; }, { what: 'the bot to be done' });
  assert.deepEqual(ran.map((r) => r.jobName || 'the message').sort(), ['day check', 'the message']);
});

// A script job of a bot (one without AI), approved, whose output goes to the AI.
async function scriptJob(bot, script) {
  const job = (await srv.asChief(`/bots/${bot.id}/jobs`, { method: 'POST', body: { kind: 'script', name: 'Look it up', cron: '0 3 * * *', script, aiWhen: 'always', prompt: 'Say what it found.', timeoutSeconds: 60, assessment: 'A lookup' } })).data;
  if (!job.approved) await srv.api(`/bots/${bot.id}/jobs/${job.id}/approve`, { method: 'POST', body: { approve: true } });
  return job;
}
const runJobAsChief = (bot, job, chat) => srv.asChief(`/bots/${bot.id}/jobs/${job.id}/run`, { method: 'POST', headers: { 'X-Chief-Chat': chat.id } });
const runsOf = async (bot) => (await srv.api(`/runs?botId=${bot.id}`)).data;

test('a script job the reply started with run_job is ended, its run says who ended it, and the AI never looks at what it printed', async () => {
  const bot = await makeBot(srv, { name: 'Script Runner', emoji: '📜' });
  // It prints, then goes on for as long as it is let: only a Stop ends it before its time limit.
  const job = await scriptJob(bot, 'echo "three new rows"; while :; do sleep 0.05; done');
  // The owner's own "Run now" of another script job, while that reply is going: not the reply's to end.
  const own = await makeBot(srv, { name: 'Own Script', emoji: '🗂️' });
  const ownJob = await scriptJob(own, 'while [ ! -f "$BOT_WORKSPACE/go" ]; do sleep 0.05; done; echo "the owner\'s rows"');
  const t = await turn('Run the lookup now');
  assert.deepEqual((await runJobAsChief(bot, job, t.chat)).data, { started: 'script' }, 'the answer is as before');
  assert.deepEqual((await srv.api(`/bots/${own.id}/jobs/${ownJob.id}/run`, { method: 'POST' })).data, { started: 'script' });
  assert.deepEqual((await stop(t.chat)).data, { ok: true });
  const reply = (await settled(t.chat.id)).messages.at(-1);
  assert.equal(reply.error, "You stopped this reply. Script Runner's run was stopped too.");
  assert.deepEqual(reply.stopped.map((r) => [r.botId, r.name]), [[bot.id, 'Script Runner']]);
  const ended = await srv.finished(reply.stopped[0].runId);
  assert.deepEqual([ended.kind, ended.status, ended.endedBy, ended.problem, ended.jobName], ['script', 'stopped', 'owner', 'You stopped this run before it finished.', 'Look it up']);
  // Nothing follows it: no run of Claude for that bot, then or later, and the job says how its run ended.
  await new Promise((r) => setTimeout(r, 100));
  assert.deepEqual([(await runsOf(bot)).map((r) => r.id), srv.runs().filter(isRunOf(bot)).length], [[ended.id], 0]);
  assert.match((await srv.api(`/bots/${bot.id}`)).data.jobs[0].last.text, /: stopped\.$/);
  // The owner's script went on through the Stop, and the AI looks at what it printed.
  assert.deepEqual((await srv.api(`/bots/${own.id}/jobs/${ownJob.id}/run`, { method: 'POST' })).data, { skipped: 'Its last run is still going.' });
  fs.writeFileSync(path.join(srv.data, 'workspaces', own.id, 'go'), '');
  srv.unhold();
  const looked = await srv.nextRun(isRunOf(own), "the look at the owner's script");
  assert.match(looked.stdin, /the owner's rows/);
  // Nothing of the stopped run is left going: "Run now" would answer that its last run is, and the script's process is gone.
  assert.equal((await srv.api(`/bots/${bot.id}/jobs/${job.id}`, { method: 'PUT', body: { script: 'true', aiWhen: 'never' } })).status, 200);
  assert.deepEqual((await srv.api(`/bots/${bot.id}/jobs/${job.id}/run`, { method: 'POST' })).data, { started: 'script' });
  srv.unhold();
});

test("a script that was done when Stop came: the AI's look at what it printed is taken away where it waits, and ended where it is going", async () => {
  const [busy, free] = await Promise.all([makeBot(srv, { name: 'Busy Looker', emoji: '🔭' }), makeBot(srv, { name: 'Free Looker', emoji: '🔬' })]);
  const [waits, goes] = [await scriptJob(busy, 'echo "found behind a busy bot"'), await scriptJob(free, 'echo "found by a free bot"')];
  const t = await turn('Run both lookups now');
  // One bot is busy with the owner's message, so the look at its script's output waits; the other's starts.
  const mine = (await srv.api(`/bots/${busy.id}/run`, { method: 'POST', body: { prompt: 'First this' } })).data;
  const mineRec = await srv.nextRun(isRunOf(busy), 'the bot to be busy');
  for (const [bot, job] of [[busy, waits], [free, goes]]) assert.deepEqual((await runJobAsChief(bot, job, t.chat)).data, { started: 'script' });
  const waiting = await waitFor(async () => (await runsOf(busy)).find((r) => r.kind === 'script'), { what: 'the first script to be done' });
  await srv.nextRun(isRunOf(free), 'the look of the free bot');
  const look = (await runsOf(free)).find((r) => r.kind !== 'script');
  assert.equal(waiting.handedOver, true, 'the AI is to say what it found');

  await stop(t.chat);
  const reply = (await settled(t.chat.id)).messages.at(-1);
  assert.deepEqual([reply.error, reply.stopped], ["You stopped this reply. Free Looker's run was stopped too.", [{ botId: free.id, name: 'Free Looker', runId: look.id }]], 'the look that waited had no run: nothing names it');
  const ended = await srv.finished(look.id);
  assert.deepEqual([ended.status, ended.endedBy], ['stopped', 'owner']);
  // The busy bot goes on with the owner's message, and no look follows it: the script's own run shows what it found.
  srv.unhold();
  srv.release(mineRec);
  await srv.finished(mine.id);
  await new Promise((r) => setTimeout(r, 100)); // past the moment the queue would have gone on
  const after_ = await runsOf(busy);
  assert.deepEqual(after_.map((r) => [r.kind || 'ai', r.status, !!r.handedOver]).sort(), [['ai', 'success', false], ['script', 'success', false]]);
  assert.equal(srv.runs().filter(isRunOf(busy)).length, 1, 'only the message');
});

test('a run whose tool call had not answered when Stop came is ended too', async () => {
  const bot = await makeBot(srv, { name: 'No Chip Yet', emoji: '🫥' });
  const t = await turn('Have No Chip Yet go');
  const run = await t.run(bot, 'Go', { chip: false });
  await srv.nextRun(isRunOf(bot), 'the run');
  assert.deepEqual((await chatOf(t.chat.id)).messages.at(-1).actions, [], 'the reply has no chip of it');
  await stop(t.chat);
  const reply = (await settled(t.chat.id)).messages.at(-1);
  assert.equal(reply.error, "You stopped this reply. No Chip Yet's run was stopped too.");
  assert.deepEqual([(await srv.finished(run.id)).status, (await runOf(run.id)).endedBy], ['stopped', 'owner']);
  srv.unhold();
});

test("after Stop the owner's message that waited in the chat starts at once", async () => {
  const bot = await makeBot(srv, { name: 'Stopped First', emoji: '🥇' });
  const t = await turn('Have Stopped First go');
  const run = await t.run(bot, 'Go');
  await t.chips(1);
  const kept = (await srv.api(`/chief/chats/${t.chat.id}/messages`, { method: 'POST', body: { text: 'Never mind, do this instead' } })).data;
  assert.equal(kept.queued.length, 1);
  await stop(t.chat);
  const next = await srv.nextRun((x) => !!x.botdot && x.stdin.includes('Never mind, do this instead'), "the waiting message's turn");
  assert.equal((await srv.finished(run.id)).endedBy, 'owner');
  srv.reply('Doing that instead.');
  srv.release(next);
  const chat = await settled(t.chat.id);
  assert.deepEqual(chat.messages.map((m) => [m.role, m.error || m.text]), [
    ['user', 'Have Stopped First go'], ['chief', "You stopped this reply. Stopped First's run was stopped too."],
    ['user', 'Never mind, do this instead'], ['chief', 'Doing that instead.'],
  ]);
  assert.deepEqual(chat.queued, []);
  fs.rmSync(path.join(srv.out, 'result.txt'), { force: true });
  srv.unhold();
});

test('a process that does not end when asked to is killed: the Chief\'s as a bot\'s', async () => {
  const bot = await makeBot(quick, { name: 'Stubborn', emoji: '🪨' });
  quick.hold();
  fs.writeFileSync(path.join(quick.out, 'ignore-term'), '');
  const chat = (await quick.api('/chief/chats', { method: 'POST' })).data;
  await quick.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Think for ever' } });
  await quick.nextRun((x) => !!x.botdot && x.stdin.includes('Think for ever'), 'the Chief turn');
  const run = (await quick.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Work for ever' } })).data;
  await quick.nextRun(isRunOf(bot), 'the run');
  await stop(chat, quick);
  await quick.api(`/runs/${run.id}/stop`, { method: 'POST' });
  assert.equal((await settled(chat.id, quick)).messages.at(-1).error, 'You stopped this reply.');
  assert.deepEqual([(await quick.finished(run.id)).status, (await quick.api(`/runs/${run.id}?events=0`)).data.endedBy], ['stopped', 'owner']);
  fs.rmSync(path.join(quick.out, 'ignore-term'), { force: true });
  quick.unhold();
});
