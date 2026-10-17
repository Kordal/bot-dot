// A bot carries on after the owner's OK (ADR 009): an ask keeps the runs that wait for it, and a yes starts the
// bot again on the owner's request, with the request, the earlier reply and what was allowed. Nothing starts
// twice. Against the stand-in for Claude. The other starters (the Chief, a teammate, a job) are in
// test/ask-carries-on-starters.test.js.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, heldRun, self, waitFor, sleep } = require('./helpers');
const { kit, fakeGithub, BASH, WEB, isRunOf } = require('./carry-on-helpers');

let srv, github, refuse, asksOf, runsOf, answer, lastRun, refused, carriedOn, startsNothing;
before(async () => {
  github = await fakeGithub(); // a skill from a link is read from it
  srv = await startServer({ env: github.env });
  ({ refuse, asksOf, runsOf, answer, lastRun, refused, carriedOn, startsNothing } = kit(srv));
});
after(async () => { srv.unhold(); await srv.stop(); github.close(); });

// What an app of Milestone 5 draws as the owner's own message (public/app.js botThreadHTML, Android Unread.asked).
const ownersBubble = (r) => r.trigger !== 'replies' && !r.fromBot && r.startedBy !== 'chief' && !r.jobName && r.trigger !== 'schedule' && r.customPrompt !== false;

test("after Allow the bot goes on with the owner's request, once, and the chat shows the request once", async () => {
  const bot = await makeBot(srv, { name: 'Coder', emoji: '💻', allowedTools: ['Read'] });
  const up = await srv.api(`/uploads?to=bot:${bot.id}`, { method: 'POST', raw: Buffer.from('repo: acme/site\n'), headers: { 'X-File-Name': 'which.txt' } });
  srv.reply(`I can't run commands yet. ${'x'.repeat(4100)}`);
  const first = await refused(bot, [BASH], { prompt: 'Check the PRs of {{date}}\nand say which are stale', attachments: [up.data] });
  const [card] = await asksOf(bot);
  assert.deepEqual(card.then, { who: 'bot', text: `It carries on with “${first.prompt.replace('\n', ' ')}” when you allow it.` });
  assert.equal(card.runs, undefined, 'the runs that wait stay on the server');
  const kept = JSON.parse(fs.readFileSync(path.join(srv.data, 'asks.json'), 'utf8')).find((a) => a.id === card.id);
  assert.deepEqual(kept.runs.map((r) => r.id), [first.id], 'the ask records the run that asked');
  assert.ok((await srv.api('/version')).data.features.includes('ask-continues'));

  srv.reply('Two are stale: #4 and #9.');
  const yes = await answer(card, true);
  assert.deepEqual(yes.data.carriesOn, { who: 'bot', text: 'it carries on' });
  assert.ok(yes.data.bot.allowedTools.includes('Bash'), 'the setting changed');
  const next = await carriedOn(bot, first);
  const rec = await lastRun(bot);

  // What it is handed: botdot's own words, the request word for word, its reply clipped, what was allowed, the run's number.
  assert.match(rec.stdin, /^botdot writes this, not the owner: nobody typed it\./);
  assert.ok(rec.stdin.includes(`<request>\n${first.prompt}\n</request>`), 'the request as it was written');
  const reply = rec.stdin.match(/<your-reply>\n([\s\S]*)\n<\/your-reply>/)[1];
  assert.equal(reply.length, 4001, 'the earlier reply, clipped at 4,000 characters');
  assert.ok(reply.startsWith("I can't run commands yet.") && reply.endsWith('…'));
  assert.match(rec.stdin, /The owner allowed you to: run commands\./);
  assert.doesNotMatch(rec.stdin, /The owner declined/);
  assert.ok(rec.stdin.includes(`read_run with run "${first.id}"`), "the stopped run's number");
  assert.match(rec.stdin, /Go on with that request now[^\n]*Don't repeat what that run already did[^\n]*If nothing is left to do, say so in one line\./);
  assert.match(rec.stdin, /which\.txt/, 'the files of the request are attached again');
  assert.ok(rec.args[rec.args.indexOf('--allowedTools') + 1] && rec.args.includes('Bash'), 'it runs with what was allowed');
  assert.match(rec.system, /botdot has started you again on a request the owner sent you earlier/);
  assert.match(rec.system, /Once the owner allows it on that card, botdot starts you again on the same request by itself: so say what is missing and that the card waits for their OK, and never ask them to send the request again\./);

  // The run that carries on: the first run's in everything that decides how it is treated, and a new reply.
  assert.deepEqual([next.continues, next.trigger, next.startedBy, next.fromBot, next.jobId, next.notificationAudience], [first.id, 'manual', undefined, undefined, null, 'owner']);
  assert.deepEqual([next.prompt, next.customPrompt, next.result, next.status], [first.prompt, false, 'Two are stale: #4 and #9.', 'success']);
  assert.deepEqual(next.attachments.map((a) => a.name), ['which.txt']);
  const runs = await runsOf(bot);
  assert.equal(runs.length, 2);
  assert.equal(runs.filter(ownersBubble).length, 1, 'one bubble of the owner');
  assert.equal((await srv.api(`/bots/${bot.id}`)).data.unread, 2, 'its reply is a new reply, as the first was');
  assert.deepEqual(await asksOf(bot), []);
  await startsNothing(bot, 2);
});

test('a decline starts nothing, and two yeses on one ask start one run', async () => {
  const no = await makeBot(srv, { name: 'Surfer', emoji: '🏄', allowedTools: ['Read'] });
  await refused(no, [WEB]);
  const [declined] = await asksOf(no);
  assert.ok(declined.then);
  assert.deepEqual((await answer(declined, false)).data, { ok: true, declined: true });
  await startsNothing(no, 1);

  const bot = await makeBot(srv, { name: 'Twice', emoji: '👯', allowedTools: ['Read'] });
  const first = await refused(bot, [BASH]);
  const [card] = await asksOf(bot);
  const both = await Promise.all([answer(card, true), answer(card, true)]);
  assert.deepEqual(both.map((r) => r.status).sort(), [200, 404], 'the web page and the phone: one is too late');
  assert.equal(both.filter((r) => r.data.carriesOn).length, 1);
  await carriedOn(bot, first);
  await startsNothing(bot, 2);
});

test('a run that waits for two asks carries on once, after the last answer, told what was allowed and declined', async () => {
  const bot = await makeBot(srv, { name: 'Both', emoji: '🧰', allowedTools: ['Read'] });
  const first = await refused(bot, [BASH, WEB]);
  const cards = await asksOf(bot);
  assert.deepEqual(cards.map((a) => a.permission).sort(), ['commands', 'web']);
  for (const a of cards) assert.match(a.then.text, /^It carries on with “Check the PRs”/, 'each card says what follows');
  const commands = cards.find((a) => a.permission === 'commands');
  const yes = await answer(commands, true);
  assert.equal(yes.data.carriesOn, undefined, 'it still waits for the other answer');
  await startsNothing(bot, 1);
  assert.ok((await asksOf(bot))[0].then, 'the card that is left still says it carries on');
  // The last answer is a no: it carries on with what was allowed, and is told what was not.
  assert.deepEqual((await answer(cards.find((a) => a.permission === 'web'), false)).data, { ok: true, declined: true });
  await carriedOn(bot, first);
  const rec = await lastRun(bot);
  assert.match(rec.stdin, /The owner allowed you to: run commands\./);
  assert.match(rec.stdin, /The owner declined: browse the web\. Do without it, and don't ask for it again\./);
  await startsNothing(bot, 2);

  // Both declined: nothing starts.
  const none = await makeBot(srv, { name: 'Neither', emoji: '🙅', allowedTools: ['Read'] });
  await refused(none, [BASH, WEB]);
  for (const a of await asksOf(none)) await answer(a, false);
  await startsNothing(none, 1);

  // Both allowed: one run, told both.
  const all = await makeBot(srv, { name: 'Everything', emoji: '🎒', allowedTools: ['Read'] });
  const stopped = await refused(all, [BASH, WEB]);
  const answers = [];
  for (const a of await asksOf(all)) answers.push((await answer(a, true)).data.carriesOn);
  assert.deepEqual(answers, [undefined, { who: 'bot', text: 'it carries on' }]);
  await carriedOn(all, stopped);
  assert.match((await lastRun(all)).stdin, /The owner allowed you to: run commands and browse the web\./);
  await startsNothing(all, 2);
});

test('a second run that asks for the same thing joins the card, and each waiting run carries on', async () => {
  const bot = await makeBot(srv, { name: 'Again', emoji: '🔁', allowedTools: ['Read'] });
  const job = (await srv.asChief(`/bots/${bot.id}/jobs`, { method: 'POST', body: { kind: 'ai', name: 'Morning check', cron: '0 3 * * *', prompt: 'Check the mail.', assessment: 'Needs AI' } })).data;
  const first = await refused(bot, [BASH], { prompt: 'Check the PRs' });
  refuse([BASH]);
  const second = await srv.finished((await srv.api(`/bots/${bot.id}/jobs/${job.id}/run`, { method: 'POST' })).data.run.id);
  refuse([]);
  const cards = await asksOf(bot);
  assert.equal(cards.length, 1, 'one card');
  const kept = JSON.parse(fs.readFileSync(path.join(srv.data, 'asks.json'), 'utf8')).find((a) => a.id === cards[0].id);
  assert.deepEqual(kept.runs.map((r) => r.id), [first.id, second.id], 'every waiting run is kept');
  assert.equal(cards[0].then.text, 'It runs “Morning check” again when you allow it.', 'the card speaks of the run that asked last');
  assert.deepEqual((await answer(cards[0], true)).data.carriesOn, { who: 'bot', text: 'it carries on' });
  // The job's run starts at once; the owner's request waits behind it, and both run once.
  await waitFor(async () => { const r = await runsOf(bot); return r.length === 4 && r.every((x) => x.status !== 'running'); }, { what: 'both to carry on' });
  assert.deepEqual((await runsOf(bot)).filter((r) => r.continues).map((r) => r.continues).sort(), [first.id, second.id].sort());
  await startsNothing(bot, 4);
});

test('the owner asked again and was refused the same: Allow carries on with the later request only; a later message that was not refused leaves the yes to change the setting', async () => {
  const bot = await makeBot(srv, { name: 'Moved on', emoji: '🚶', allowedTools: ['Read'] });
  const first = await refused(bot, [BASH], { prompt: 'Check the PRs' });
  assert.ok((await asksOf(bot))[0].then);
  // The second request is refused the same thing and joins the card: it is what carries on, and the first, which
  // the owner sent a message after, is not (OK-010).
  const second = await refused(bot, [BASH], { prompt: 'And the issues?' });
  const cards = await asksOf(bot);
  assert.equal(cards.length, 1);
  const kept = JSON.parse(fs.readFileSync(path.join(srv.data, 'asks.json'), 'utf8')).find((a) => a.id === cards[0].id);
  assert.deepEqual(kept.runs.map((r) => r.id), [first.id, second.id]);
  assert.deepEqual(cards[0].then, { who: 'bot', text: 'It carries on with “And the issues?” when you allow it.' }, 'then names the later request');
  const yes = await answer(cards[0], true);
  assert.deepEqual(yes.data.carriesOn, { who: 'bot', text: 'it carries on' });
  assert.ok(yes.data.bot.allowedTools.includes('Bash'), 'the setting changes');
  const next = await carriedOn(bot, second);
  assert.equal(next.prompt, 'And the issues?');
  await startsNothing(bot, 3);
  assert.deepEqual((await runsOf(bot)).filter((r) => r.continues).map((r) => r.continues), [second.id], 'one run, and none for the request the owner has since replaced');

  // The later message was not refused, so it is on no card: then goes, and Allow starts nothing (scenario A10).
  const done = await makeBot(srv, { name: 'Answered', emoji: '✅', allowedTools: ['Read'] });
  await refused(done, [BASH], { prompt: 'Check the PRs' });
  assert.ok((await asksOf(done))[0].then);
  await refused(done, [], { prompt: 'Never mind: what time is it?' });
  const [card] = await asksOf(done);
  assert.equal(card.then, undefined, 'then goes when the owner sent the bot a message after its run asked');
  const only = await answer(card, true);
  assert.equal(only.data.carriesOn, undefined);
  assert.ok(only.data.bot.allowedTools.includes('Bash'), 'the setting still changes');
  await startsNothing(done, 2);
});

test("a job's run asked first and the owner's request was refused the same: Allow starts one run, for the request, and the job is not repeated", async () => {
  const bot = await makeBot(srv, { name: 'Early Bird', emoji: '🐦', allowedTools: ['Read'] });
  const job = (await srv.asChief(`/bots/${bot.id}/jobs`, { method: 'POST', body: { kind: 'ai', name: 'Morning news', cron: '0 7 * * *', prompt: 'Read the news.', assessment: 'Needs AI' } })).data;
  // 7:00: the job's run is refused the web, and the card appears.
  refuse([WEB]);
  const atSeven = await srv.finished((await srv.api(`/bots/${bot.id}/jobs/${job.id}/run`, { method: 'POST' })).data.run.id);
  refuse([]);
  assert.equal((await asksOf(bot))[0].then.text, 'It runs “Morning news” again when you allow it.');
  // 8:00: the owner asks the bot something, which is refused the same and joins the card.
  const atEight = await refused(bot, [WEB], { prompt: 'What is new today?' });
  const [card, ...more] = await asksOf(bot);
  assert.deepEqual(more, [], 'one card');
  const kept = JSON.parse(fs.readFileSync(path.join(srv.data, 'asks.json'), 'utf8')).find((a) => a.id === card.id);
  assert.deepEqual(kept.runs.map((r) => r.id), [atSeven.id, atEight.id]);
  assert.deepEqual(card.then, { who: 'bot', text: 'It carries on with “What is new today?” when you allow it.' }, 'the card names the 8:00 request');
  srv.reply('Three things are new.');
  assert.deepEqual((await answer(card, true)).data.carriesOn, { who: 'bot', text: 'it carries on' });
  const next = await carriedOn(bot, atEight);
  assert.deepEqual([next.prompt, next.jobId, next.result], ['What is new today?', null, 'Three things are new.']);
  assert.ok((await lastRun(bot)).stdin.includes('<request>\nWhat is new today?\n</request>'), 'the 8:00 request is in its prompt');
  await startsNothing(bot, 3);
  assert.deepEqual((await runsOf(bot)).filter((r) => r.continues).map((r) => r.continues), [atEight.id], 'the job is not repeated');

  // Two requests of the owner after the job's run, all three on one card: one run, for the later request.
  const two = await makeBot(srv, { name: 'Night Owl', emoji: '🦉', allowedTools: ['Read'] });
  const nightly = (await srv.asChief(`/bots/${two.id}/jobs`, { method: 'POST', body: { kind: 'ai', name: 'Night watch', cron: '0 1 * * *', prompt: 'Watch the logs.', assessment: 'Needs AI' } })).data;
  refuse([WEB]);
  const watch = await srv.finished((await srv.api(`/bots/${two.id}/jobs/${nightly.id}/run`, { method: 'POST' })).data.run.id);
  refuse([]);
  const earlier = await refused(two, [WEB], { prompt: 'What is new today?' });
  const later = await refused(two, [WEB], { prompt: 'And the weather?' });
  const [three] = await asksOf(two);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(srv.data, 'asks.json'), 'utf8')).find((a) => a.id === three.id).runs.map((r) => r.id), [watch.id, earlier.id, later.id]);
  assert.equal(three.then.text, 'It carries on with “And the weather?” when you allow it.');
  assert.deepEqual((await answer(three, true)).data.carriesOn, { who: 'bot', text: 'it carries on' });
  assert.equal((await carriedOn(two, later)).prompt, 'And the weather?');
  await startsNothing(two, 4);
  assert.deepEqual((await runsOf(two)).filter((r) => r.continues).map((r) => r.continues), [later.id]);
});

test("behind a busy bot the later request waits its turn though its card is older, and goes when the owner sends the bot a message meanwhile", async () => {
  // As above, a job's run made the card and the owner's request joined it; the bot is busy when the yes comes.
  // The owner's message meanwhile starts no run beside the one that is going (ADR 011): it waits, starts before
  // the work that carries on, and counts as sent from when it was sent, so that work then starts nothing.
  for (const meanwhile of [false, true]) {
    const bot = await makeBot(srv, meanwhile ? { name: 'Interrupted', emoji: '✋', allowedTools: ['Read'] } : { name: 'Patient', emoji: '⏳', allowedTools: ['Read'] });
    const job = (await srv.asChief(`/bots/${bot.id}/jobs`, { method: 'POST', body: { kind: 'ai', name: 'Morning news', cron: '0 7 * * *', prompt: 'Read the news.', assessment: 'Needs AI' } })).data;
    refuse([WEB]);
    await srv.finished((await srv.api(`/bots/${bot.id}/jobs/${job.id}/run`, { method: 'POST' })).data.run.id);
    refuse([]);
    const request = await refused(bot, [WEB], { prompt: 'What is new today?' });
    srv.hold();
    const held = [(await srv.asChief(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Something long' } })).data];
    const recs = [await srv.nextRun((x) => isRunOf(bot)(x) && /Something long/.test(x.stdin), 'the long run')];
    const [card] = await asksOf(bot);
    assert.equal(card.then.text, 'It carries on with “What is new today?” when you allow it.');
    assert.deepEqual((await answer(card, true)).data.carriesOn, { who: 'bot', text: 'it carries on when it is free' });
    if (meanwhile) {
      await sleep(5); // a later moment than the yes, on any clock
      held.push((await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Never mind: what time is it?' } })).data);
      assert.equal(held[1].status, 'queued', 'one run at a time: it waits behind the long run');
      assert.equal((await runsOf(bot)).filter((r) => r.status === 'running').length, 1);
    }
    srv.unhold();
    for (const rec of recs) srv.release(rec);
    for (const run of held) await srv.finished(run.id);
    if (meanwhile) assert.deepEqual((await runsOf(bot)).map((r) => [r.prompt, r.status]), [['Never mind: what time is it?', 'success'], ['Something long', 'success'], ['What is new today?', 'success'], ['Read the news.', 'success']], "the owner's message ran next; the work that waited was dropped, and the request it would have carried on is as it was");
    if (!meanwhile) assert.equal((await carriedOn(bot, request)).prompt, 'What is new today?');
    await startsNothing(bot, 4);
    assert.deepEqual((await runsOf(bot)).filter((r) => r.continues).map((r) => r.continues), meanwhile ? [] : [request.id], meanwhile ? 'the owner has since sent the bot a message' : 'one run, for the request');
  }
});

test('a run that already carried on does not carry on a second time', async () => {
  // The bot asks for the web while it works, the owner allows it at once, and the run then ends refused a
  // command: the run that carries on is refused the command too. One Allow on that card starts one run.
  const bot = await makeBot(srv, { name: 'Looper', emoji: '➰', allowedTools: ['Read'] });
  const h = await heldRun(srv, bot, 'Fetch and build');
  await self(srv, h.token, 'ask', { kind: 'permission', permission: 'web', reason: 'To fetch it' });
  assert.deepEqual((await answer((await asksOf(bot))[0], true)).data.carriesOn, { who: 'bot', text: 'it carries on when it is free' });
  refuse([BASH]);
  srv.unhold();
  srv.release(h.rec);
  const second = await carriedOn(bot, h.run);
  refuse([]);
  const cards = await asksOf(bot);
  assert.deepEqual(cards.map((a) => a.permission), ['commands']);
  const kept = JSON.parse(fs.readFileSync(path.join(srv.data, 'asks.json'), 'utf8')).find((a) => a.id === cards[0].id);
  assert.deepEqual(kept.runs.map((r) => r.id), [h.run.id, second.id], 'both were refused the command');
  await answer(cards[0], true);
  const third = await carriedOn(bot, second);
  assert.equal(third.prompt, 'Fetch and build');
  await startsNothing(bot, 3);
  assert.deepEqual((await runsOf(bot)).map((r) => r.continues || null).sort(), [h.run.id, null, second.id].sort(), 'one request, three runs: none carried on twice');
});

test('work that waits already is told of a second yes, and a message the owner sent before the run asked for that does not take it away', async () => {
  // The bot asks for the web while it works and the owner allows it: the work waits for the bot to be free. The
  // owner then sends the bot something else, while that run is still going: it waits its turn (ADR 011) and
  // starts first when the run ends. That run ends refused a command, and the owner allows that too: their
  // message was sent before the run asked for it, though it started after, so the one run still follows.
  const bot = await makeBot(srv, { name: 'Juggler', emoji: '🤹', allowedTools: ['Read'] });
  const h = await heldRun(srv, bot, 'Fetch and build');
  await self(srv, h.token, 'ask', { kind: 'permission', permission: 'web', reason: 'To fetch it' });
  assert.deepEqual((await answer((await asksOf(bot))[0], true)).data.carriesOn, { who: 'bot', text: 'it carries on when it is free' });
  await sleep(5); // a later moment than the yes, on any clock
  const other = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Any news meanwhile?' } })).data;
  assert.equal(other.status, 'queued');
  refuse([BASH]);
  srv.release(h.rec);
  await srv.finished(h.run.id);
  refuse([]);
  const otherRec = await srv.nextRun((x) => isRunOf(bot)(x) && /Any news meanwhile/.test(x.stdin), "the owner's other message");
  const [card, ...more] = await asksOf(bot);
  assert.deepEqual([card.permission, more.length], ['commands', 0]);
  assert.equal(card.then.text, 'It carries on with “Fetch and build” when you allow it.');
  assert.deepEqual((await answer(card, true)).data.carriesOn, { who: 'bot', text: 'it carries on when it is free' });
  srv.unhold();
  srv.release(otherRec);
  await srv.finished(other.id);
  const next = await carriedOn(bot, h.run);
  assert.equal(next.prompt, 'Fetch and build');
  assert.match((await lastRun(bot)).stdin, /The owner allowed you to: browse the web and run commands\./);
  await startsNothing(bot, 3);
});

test('an ask from before, with no run, only changes the setting', async () => {
  const bot = await makeBot(srv, { name: 'Old', emoji: '🕰️', allowedTools: ['Read'] });
  await refused(bot, [BASH]);
  // As an older botdot left it: the ask without its runs.
  const file = path.join(srv.data, 'asks.json');
  fs.writeFileSync(file, JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8')).map(({ runs, ...a }) => a)));
  const [card] = await asksOf(bot);
  assert.equal(card.then, undefined);
  const yes = await answer(card, true);
  assert.equal(yes.data.carriesOn, undefined);
  assert.ok(yes.data.bot.allowedTools.includes('Bash'));
  await startsNothing(bot, 1);
});

test('ask_permission and ask_skill record the run, and a skill carries on after Install', async () => {
  const bot = await makeBot(srv, { name: 'Asker', emoji: '🙋', allowedTools: ['Read'] });
  const h = await heldRun(srv, bot, 'Tidy my desk');
  assert.equal((await self(srv, h.token, 'ask', { kind: 'permission', permission: 'web', reason: 'To read the page' })).data.ok, true);
  assert.equal((await self(srv, h.token, 'ask', { kind: 'skill', url: 'https://github.com/acme/skills', reason: 'It knows how' })).data.skill, 'tidy-desk');
  const cards = await asksOf(bot);
  assert.deepEqual(cards.map((a) => a.kind).sort(), ['permission', 'skill']);
  for (const a of cards) assert.equal(a.then.text, 'It carries on with “Tidy my desk” when you allow it.');
  // Answered while the run is still going: the work waits for the bot to be free.
  await answer(cards.find((a) => a.kind === 'permission'), false);
  const yes = await answer(cards.find((a) => a.kind === 'skill'), true);
  assert.deepEqual([yes.data.skill, yes.data.carriesOn], ['tidy-desk', { who: 'bot', text: 'it carries on when it is free' }]);
  srv.unhold();
  srv.release(h.rec);
  const next = await carriedOn(bot, h.run);
  const rec = await lastRun(bot);
  assert.match(rec.stdin, /The owner allowed you to: use the skill “tidy-desk”\./);
  assert.match(rec.stdin, /The owner declined: browse the web\./);
  assert.equal(next.prompt, 'Tidy my desk');
  await startsNothing(bot, 2);
});
