// Who started the run that stopped decides what follows the owner's OK (ADR 009): a run the Chief started is
// handed back to the Chief in the chat that started it, a teammate's request carries on and its answer goes back
// as a message from the bot, and a job runs once more. The owner's own request: test/ask-carries-on.test.js.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, heldRun, self, waitFor, writeData } = require('./helpers');
const { kit, BASH, WEB, isRunOf } = require('./carry-on-helpers');

let srv, refuse, asksOf, runsOf, answer, lastRun, refused, carriedOn, startsNothing;
before(async () => {
  srv = await startServer();
  ({ refuse, asksOf, runsOf, answer, lastRun, refused, carriedOn, startsNothing } = kit(srv));
});
after(async () => { srv.unhold(); await srv.stop(); });

test('a run the Chief started is handed back to the Chief, in the chat that started it', async () => {
  const bot = await makeBot(srv, { name: 'News Watcher', emoji: '📰', allowedTools: ['Read'] });
  srv.hold();
  const run = (await srv.asChief(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Read the headlines' } })).data;
  const rec = await srv.nextRun(isRunOf(bot), 'News Watcher to start');
  // The Chief chat whose reply started the run (as its run_bot action records).
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  const file = path.join(srv.data, 'chief', `${chat.id}.json`);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  saved.title = 'Watch the news';
  saved.messages.push({ role: 'user', text: 'Make a news bot and start it', at: new Date().toISOString() },
    { role: 'chief', text: 'Started it.', at: new Date().toISOString(), actions: [{ kind: 'run', text: 'Started News Watcher', botId: bot.id, runId: run.id }] });
  writeData(file, saved);
  refuse([WEB]);
  srv.unhold();
  srv.release(rec);
  await srv.finished(run.id);
  refuse([]);

  const [card] = await asksOf(bot);
  assert.deepEqual(card.then, { who: 'chief', text: 'The Chief carries on in “Watch the news” when you allow it.', chatId: chat.id, here: 'The Chief carries on in this chat when you allow it.' });
  // The Chief's turn brings no reply this time: botdot's own line stands in the chat.
  fs.writeFileSync(path.join(srv.out, 'fail.txt'), 'Not logged in');
  const yes = await answer(card, true);
  assert.deepEqual(yes.data.carriesOn, { who: 'chief', text: 'the Chief carries on' });
  const turn = await srv.nextRun((x) => x.botdot && /may now browse the web/.test(x.stdin), "the Chief's turn");
  const notice = await waitFor(async () => (await srv.api(`/chief/chats/${chat.id}`)).data.messages.find((m) => m.notice), { what: "botdot's own line" }).finally(() => fs.rmSync(path.join(srv.out, 'fail.txt')));
  assert.equal(turn.botdot.env.CHIEF_CHAT_ID, chat.id);
  assert.match(turn.stdin, /botdot writes this, not the user: nobody typed it\. The user said yes on a card in Needs you\./);
  assert.ok(turn.stdin.includes(`📰 News Watcher (bot id ${bot.id}) may now browse the web.`));
  assert.ok(turn.stdin.includes(`Its run ${run.id}, which you started in this chat, stopped without being able to browse the web.`));
  assert.match(turn.stdin, /Start News Watcher again on that work with run_bot/);
  assert.equal(notice.text, 'News Watcher may now browse the web.');
  await startsNothing(bot, 1);

  // The chat that started it is gone: the OK only changes the setting.
  const lost = await makeBot(srv, { name: 'Lost', emoji: '🧭', allowedTools: ['Read'] });
  await refused(lost, [WEB], { prompt: 'Read the headlines' }, srv.asChief);
  const [alone] = await asksOf(lost);
  assert.equal(alone.then, undefined);
  assert.equal((await answer(alone, true)).data.carriesOn, undefined);
  await startsNothing(lost, 1);
});

test("a teammate's request carries on, and its answer goes back as a message from the bot", async () => {
  const asker = await makeBot(srv, { name: 'Fleet Doctor', emoji: '🩺', allowedTools: ['Read', 'WebSearch', 'WebFetch'] });
  const worker = await makeBot(srv, { name: 'Page Reader', emoji: '📖', allowedTools: ['Read'] });
  const origin = await heldRun(srv, asker, 'What does the status page say?');
  assert.equal((await self(srv, origin.token, 'message', { to: worker.id, message: 'Read the status page', priority: true })).data.delivered, 'started');
  const asked = await srv.nextRun(isRunOf(worker), 'Page Reader to start');
  refuse([WEB]);
  srv.unhold();
  srv.release(asked);
  const stopped = await waitFor(async () => (await runsOf(worker)).find((r) => r.status !== 'running'), { what: 'the refused run to end' });
  srv.release(origin.rec);
  // The asker is started again with how the hand-off ended (QW-004): it ends before the owner answers.
  await waitFor(async () => { const r = await runsOf(asker); return r.length === 2 && r.every((x) => x.status !== 'running'); }, { what: 'the asker to hear how it ended' });
  refuse([]);
  // Only a run that can carry on is told that it will: not the follow-up after a teammate's answer.
  const [told, followUp] = srv.runs().filter(isRunOf(asker));
  assert.match(told.system, /botdot starts you again on the same request by itself/);
  assert.match(followUp.stdin, /got no message back|have answered/);
  assert.doesNotMatch(followUp.system, /botdot starts you again on the same request by itself/);

  const [card] = await asksOf(worker);
  assert.deepEqual(card.then, { who: 'bot', text: "It carries on with Fleet Doctor's request when you allow it." });
  srv.reply('All systems are up.');
  assert.deepEqual((await answer(card, true)).data.carriesOn, { who: 'bot', text: 'it carries on' });
  const next = await carriedOn(worker, stopped);
  const rec = srv.runs().filter(isRunOf(worker)).at(-1);
  assert.ok(rec.stdin.includes('<request from="🩺 Fleet Doctor">\nRead the status page\n</request>'), 'naming the teammate as the one who asked');
  assert.match(rec.stdin, /Fleet Doctor is a bot of the owner's team, not the owner/);
  assert.match(rec.system, /It also reaches Fleet Doctor by itself when your run ends: botdot hands it over, so don't send it again\./);
  assert.deepEqual([next.trigger, next.fromBot.id, next.chainId, next.continues, next.notificationAudience], ['bot', asker.id, stopped.chainId, stopped.id, 'internal']);
  // Its final reply reaches the teammate as a message from the bot, which starts the teammate.
  const got = await waitFor(async () => (await runsOf(asker)).find((r) => r.trigger === 'bot' && r.fromBot?.id === worker.id), { what: 'the answer to reach the teammate' });
  assert.equal(got.prompt, 'All systems are up.');
  assert.equal((await srv.finished(next.id)).sentTo.id, asker.id, 'and the chat shows it was sent');
  await srv.finished(got.id);
  await startsNothing(worker, 2);

  // A run that carries on and messages the teammate itself: its reply is not sent a second time.
  srv.hold();
  await srv.api(`/bots/${asker.id}/run`, { method: 'POST', body: { prompt: 'And the uptime?' } });
  const again = await srv.nextRun((x) => isRunOf(asker)(x) && /And the uptime\?/.test(x.stdin), 'Fleet Doctor to start again');
  assert.equal((await self(srv, again.self.env.RUN_TOKEN, 'message', { to: worker.id, message: 'Count the uptime', priority: true })).data.delivered, 'started');
  const counting = await srv.nextRun((x) => isRunOf(worker)(x) && /Count the uptime/.test(x.stdin), 'Page Reader to start again');
  refuse([BASH]);
  srv.release(counting);
  const refusedRun = await waitFor(async () => (await runsOf(worker)).find((r) => r.prompt === 'Count the uptime' && r.status !== 'running'), { what: 'the second refused run to end' });
  refuse([]);
  const [commands] = await asksOf(worker);
  await answer(commands, true);
  const own = await srv.nextRun((x) => isRunOf(worker)(x) && /botdot writes this/.test(x.stdin) && /Count the uptime/.test(x.stdin), 'the run that carries on');
  assert.equal((await self(srv, own.self.env.RUN_TOKEN, 'message', { to: asker.id, message: '99.9 % this month.', priority: false })).data.delivered, 'inbox');
  srv.reply('Sent it to Fleet Doctor.');
  srv.unhold();
  srv.release(own);
  srv.release(again);
  const ended = await carriedOn(worker, refusedRun);
  assert.deepEqual(ended.sentToAll.map((t) => [t.id, t.text]), [[asker.id, '99.9 % this month.']], 'only its own message');
  await waitFor(async () => (await runsOf(asker)).every((r) => r.status !== 'running'), { what: "the asker's runs to end" });
  assert.equal((await runsOf(asker)).filter((r) => r.prompt === 'Sent it to Fleet Doctor.').length, 0);
});

test("a job's run is repeated once, with the job's own task", async () => {
  const bot = await makeBot(srv, { name: 'Watcher', emoji: '🔭', allowedTools: ['Read'] });
  const job = (await srv.asChief(`/bots/${bot.id}/jobs`, { method: 'POST', body: { kind: 'ai', name: 'Watch the feed', cron: '0 3 * * *', prompt: 'Check the feed for news.', notify: 'always', assessment: 'Needs AI' } })).data;
  refuse([WEB]);
  const started = await srv.api(`/bots/${bot.id}/jobs/${job.id}/run`, { method: 'POST' });
  const stopped = await srv.finished(started.data.run.id);
  refuse([]);
  const [card] = await asksOf(bot);
  assert.deepEqual(card.then, { who: 'bot', text: 'It runs “Watch the feed” again when you allow it.' });
  assert.deepEqual((await answer(card, true)).data.carriesOn, { who: 'bot', text: 'it carries on' });
  const next = await carriedOn(bot, stopped);
  assert.deepEqual([next.jobId, next.jobName, next.trigger, next.prompt, next.customPrompt, next.continues], [job.id, 'Watch the feed', 'manual', 'Check the feed for news.', true, stopped.id]);
  const rec = await lastRun(bot);
  assert.match(rec.stdin, /^Check the feed for news\./, "the job's own task");
  assert.doesNotMatch(rec.stdin, /botdot writes this/);
  await startsNothing(bot, 2);
});

test("a bot whose jobs are all switched off: its job is not repeated, and the owner's own request carries on (OK-010)", async () => {
  const bot = await makeBot(srv, { name: 'Dozer', emoji: '💤', allowedTools: ['Read'] });
  const job = (await srv.asChief(`/bots/${bot.id}/jobs`, { method: 'POST', body: { kind: 'ai', name: 'Morning check', cron: '0 3 * * *', prompt: 'Check the mail.', assessment: 'Needs AI' } })).data;
  // The job's run is refused a command. Then the owner switches the job, the bot's only one, off: it is paused.
  refuse([BASH]);
  await srv.finished((await srv.api(`/bots/${bot.id}/jobs/${job.id}/run`, { method: 'POST' })).data.run.id);
  refuse([]);
  assert.equal((await asksOf(bot))[0].then.text, 'It runs “Morning check” again when you allow it.');
  await srv.api(`/bots/${bot.id}/jobs/${job.id}`, { method: 'PUT', body: { enabled: false } });
  const [card] = await asksOf(bot);
  assert.equal(card.then, undefined, "a paused bot's job is not repeated, and its card promises nothing");
  const yes = await answer(card, true);
  assert.equal(yes.data.carriesOn, undefined);
  assert.ok(yes.data.bot.allowedTools.includes('Bash'), 'the setting changes');
  await startsNothing(bot, 1);
  // Paused stops a job's run from being repeated, not a request the owner sent the bot.
  const mine = await refused(bot, [WEB], { prompt: 'What does the status page say?' });
  const [web] = await asksOf(bot);
  assert.deepEqual(web.then, { who: 'bot', text: 'It carries on with “What does the status page say?” when you allow it.' });
  assert.deepEqual((await srv.api(`/bots/${bot.id}`)).data.jobs.map((j) => j.enabled), [false], 'its only job is still off');
  assert.deepEqual((await answer(web, true)).data.carriesOn, { who: 'bot', text: 'it carries on' });
  assert.equal((await carriedOn(bot, mine)).prompt, 'What does the status page say?');
  await startsNothing(bot, 3);
});
