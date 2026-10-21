// A change to an approved job waits beside it, and a bot carries on after the owner's yes on its own proposal
// (SURE-002, ADR 013 and ADR 009; docs/api.md, "A change that waits" and "What follows a yes"). Through the API,
// against the stand-in for Claude. The scheduler's side is in test/staged-changes-scheduler.test.js, a tile's
// in test/dashboard.test.js, and what the Chief asked for in a chat in test/chief-carries-on.test.js.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, restartServer, makeBot, self, feed } = require('./helpers');
const { kit, isRunOf } = require('./carry-on-helpers');

let srv, runsOf, carriedOn, startsNothing, lastRun;
const use = (s) => { srv = s; ({ runsOf, carriedOn, startsNothing, lastRun } = kit(srv)); };
before(async () => use(await startServer()));
after(async () => { srv.unhold(); await srv.stop(); });

const REPORT = { name: 'Morning report', kind: 'ai', cron: '0 9 * * *', prompt: 'Write the report.' };
const SCRIPT = { name: 'Disk check', kind: 'script', cron: '0 * * * *', script: 'df -h', assessment: 'A clear rule: no AI needed.' };
const waitingOf = async (bot) => { const f = await feed(srv); const h = await f.wait('hello'); f.close(); return h.data.approvals.jobs.filter((j) => j.botId === bot.id); };
const jobsOf = async (bot) => (await srv.api(`/bots/${bot.id}/jobs`)).data;
const approve = (bot, job, yes) => srv.api(`/bots/${bot.id}/jobs/${job.id}/approve`, { method: 'POST', body: { approve: yes } });
// The owner asks the bot something, and in that run the bot does `what` with its own tools; the run as it ended.
async function inRun(bot, request, what, reply = 'Proposed it. It waits for your OK.') {
  srv.hold();
  const started = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: request } });
  const rec = await srv.nextRun((x) => x.self?.env && isRunOf(bot)(x) && x.stdin.includes(request), `the run about “${request}”`);
  const did = await what(rec.self.env.RUN_TOKEN);
  srv.reply(reply);
  srv.release(rec);
  const run = await srv.finished(started.data.id);
  srv.unhold();
  return { run, did };
}
const thenOf = (request) => ({ who: 'bot', text: `It carries on with “${request}” when you allow it.` });
// What "Run now" runs: the task of the run it started.
async function runNow(bot, job, as = srv.api) {
  const r = await as(`/bots/${bot.id}/jobs/${job.id}/run`, { method: 'POST' });
  return (await srv.finished(r.data.run.id)).prompt;
}

test('a bot changes the text and the time of its approved job: the change waits beside it, the no keeps it, the yes changes it', async () => {
  const features = (await srv.api('/version')).data.features;
  assert.ok(features.includes('staged-changes') && features.includes('proposal-carries-on'));
  const bot = await makeBot(srv, { name: 'Reporter', emoji: '📰' });
  const job = (await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: REPORT })).data;
  const change = (fields) => (token) => self(srv, token, 'jobs', { action: 'update', id: job.id, ...fields });

  const first = await inRun(bot, 'Make the report shorter and earlier', change({ prompt: 'Write a short report.', cron: '0 6 * * *' }));
  assert.equal(first.did.data.needsApproval, true, JSON.stringify(first.did.data));
  const [waiting] = await jobsOf(bot);
  assert.deepEqual([waiting.approved, waiting.prompt, waiting.when, new Date(waiting.nextRunAt).getUTCHours()], [true, 'Write the report.', 'Daily at 09:00', 9], 'the job is as approved, and runs next at the approved time');
  const { at, ...proposed } = waiting.change;
  assert.deepEqual(proposed, { name: 'Morning report', kind: 'ai', script: '', prompt: 'Write a short report.', cron: '0 6 * * *', aiWhen: null, notify: 'report-only', timeoutSeconds: 300, assessment: '', when: 'Daily at 06:00', once: null, by: 'bot' });
  assert.ok(Date.parse(at) > Date.parse(first.run.startedAt), 'and when it was proposed');
  assert.deepEqual([waiting.no, waiting.yes, waiting.then, waiting.runId], ['Keep as it is', 'Approve the change', thenOf('Make the report shorter and earlier'), undefined]);
  assert.deepEqual(await waitingOf(bot), [{ botId: bot.id, botName: 'Reporter', botEmoji: '📰', botColor: bot.color, jobId: job.id, jobName: 'Morning report', kind: 'ai', when: 'Daily at 06:00', text: 'Wants to change a job: Morning report, Daily at 06:00', change: true, no: 'Keep as it is', yes: 'Approve the change', then: thenOf('Make the report shorter and earlier') }]);
  assert.equal((await srv.api(`/bots/${bot.id}`)).data.state, 'needs_you');
  assert.equal(await runNow(bot, job), 'Write the report.', '"Run now" runs the approved one');
  assert.equal(await runNow(bot, job, srv.asChief), 'Write the report.', "and so does the Chief's run_job");

  // A second change replaces the first: one change, one waiting item. A new name that comes with it waits with
  // it, and one that turns the job into a one-time job says the moment (`once`), since `at` is when it was proposed.
  const once = `${new Date().getUTCFullYear() + 1}-03-04T07:00`;
  await inRun(bot, 'Only once, next March', change({ at: once, name: 'March report' }));
  const [second] = await jobsOf(bot);
  assert.deepEqual([second.name, second.at, second.prompt, second.change.name, second.change.prompt, second.change.when, second.change.once], ['Morning report', null, 'Write the report.', 'March report', 'Write the report.', '4 Mar at 07:00', new Date(`${once}Z`).toISOString()]);
  const entries = await waitingOf(bot);
  assert.deepEqual(entries.map((j) => [j.jobName, j.text]), [['Morning report', 'Wants to change a job: Morning report, 4 Mar at 07:00']], 'by the name the owner knows it by');

  // The no, also the Decline of an app from before: the job is kept as approved, and nothing starts.
  let n = (await runsOf(bot)).length;
  assert.deepEqual((await approve(bot, job, false)).data, { ok: true, kept: true, text: 'Kept as it was: Daily at 09:00' });
  const [kept] = await jobsOf(bot);
  assert.deepEqual([kept.approved, kept.name, kept.at, kept.prompt, kept.when, kept.change, kept.no, kept.then], [true, 'Morning report', null, 'Write the report.', 'Daily at 09:00', undefined, undefined, undefined]);
  assert.deepEqual(await waitingOf(bot), []);
  await startsNothing(bot, n);
  assert.deepEqual((await approve(bot, job, false)).data.kept, true, 'a no from a card that is out of date removes nothing');
  assert.equal(await runNow(bot, job), 'Write the report.', 'it still runs');

  // The yes: the job is as changed, and the bot carries on with the request it proposed the change in.
  const asked = await inRun(bot, 'Earlier and shorter after all', change({ prompt: 'Write a short report.', cron: '0 6 * * *' }), 'I proposed the change.');
  srv.reply('The report is short and comes at six now.');
  const yes = await approve(bot, job, true);
  assert.deepEqual([yes.data.approved, yes.data.prompt, yes.data.when, yes.data.change, yes.data.text, yes.data.carriesOn], [true, 'Write a short report.', 'Daily at 06:00', undefined, 'Changed: Daily at 06:00', { who: 'bot', text: 'it carries on' }]);
  const next = await carriedOn(bot, asked.run);
  const rec = await lastRun(bot);
  assert.ok(rec.stdin.includes('<request>\nEarlier and shorter after all\n</request>'), 'the request');
  assert.ok(rec.stdin.includes('<your-reply>\nI proposed the change.\n</your-reply>'), 'its reply');
  assert.match(rec.stdin, /The owner allowed you to: change the job “Morning report”\./, 'and what was approved');
  assert.deepEqual([next.continues, next.result], [asked.run.id, 'The report is short and comes at six now.']);
  assert.equal(await runNow(bot, job), 'Write a short report.', 'it runs as changed');
  assert.equal((await srv.api(`/bots/${bot.id}`)).data.state, 'idle');
});

test("the owner's own edit, \"always approve\", a job never approved, and a job or bot that goes while a change waits", async () => {
  const bot = await makeBot(srv, { name: 'Disk Keeper' });
  const job = (await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: SCRIPT })).data;
  const at = `/bots/${bot.id}/jobs/${job.id}`;
  const propose = (script = 'df -h /data') => srv.asChief(at, { method: 'PUT', body: { script } });
  const waits = await propose();
  assert.deepEqual([waits.data.approved, waits.data.script, waits.data.change.script, waits.data.change.kind, waits.data.then], [true, 'df -h', 'df -h /data', 'script', undefined]);
  assert.deepEqual((await waitingOf(bot)).map((j) => [j.change, j.kind, j.text, j.yesOn, j.no, j.yes]), [[true, 'script', 'Wants to change a script: Disk check, Hourly', 'card', 'Keep as it is', 'Approve the change']], 'a change that touches a script is approved on its card');
  // What needs no OK is changed at once and leaves the change waiting.
  const off = await srv.asChief(at, { method: 'PUT', body: { enabled: false } });
  assert.deepEqual([off.data.enabled, off.data.script, off.data.change.script], [false, 'df -h', 'df -h /data']);
  // The owner's own edit of what it does is approved at once, and drops the change.
  const mine = await srv.api(at, { method: 'PUT', body: { script: 'df -h /home', enabled: true } });
  assert.deepEqual([mine.data.approved, mine.data.script, mine.data.change, mine.data.no], [true, 'df -h /home', undefined, undefined]);
  assert.deepEqual(await waitingOf(bot), []);
  // "Always approve": a change is made at once, as before.
  await propose();
  assert.equal((await srv.api(`${at}/approve`, { method: 'POST', body: { approve: true, always: true } })).data.script, 'df -h /data');
  const trusted = await propose('df -h /var');
  assert.deepEqual([trusted.data.script, trusted.data.change], ['df -h /var', undefined]);
  await srv.api(at, { method: 'PUT', body: { alwaysApprove: false } });

  // A job that was never approved is as before: it does not run, a change writes it over, and its no removes it.
  const fresh = (await srv.asChief(`/bots/${bot.id}/jobs`, { method: 'POST', body: { ...SCRIPT, name: 'Log size', script: 'du -sh .' } })).data;
  const again = await srv.asChief(`/bots/${bot.id}/jobs/${fresh.id}`, { method: 'PUT', body: { script: 'du -sh /var/log' } });
  assert.deepEqual([again.data.approved, again.data.script, again.data.change, again.data.no, again.data.yes, again.data.nextRunAt], [false, 'du -sh /var/log', undefined, 'Decline and remove', undefined, null]);
  assert.equal((await srv.api(`/bots/${bot.id}/jobs/${fresh.id}/run`, { method: 'POST' })).status, 400);
  assert.deepEqual((await approve(bot, fresh, false)).data, { ok: true, removed: true, text: 'Declined and removed' });
  assert.deepEqual((await jobsOf(bot)).map((j) => j.id), [job.id]);

  // The job removed, or its bot deleted, while a change waits: nothing waits.
  await propose('df -h /srv');
  assert.equal((await waitingOf(bot)).length, 1);
  await srv.api(at, { method: 'DELETE' });
  assert.deepEqual(await waitingOf(bot), []);
  const other = (await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: SCRIPT })).data;
  await srv.asChief(`/bots/${bot.id}/jobs/${other.id}`, { method: 'PUT', body: { script: 'df -h /tmp' } });
  assert.equal((await waitingOf(bot)).length, 1);
  assert.equal((await srv.api(`/bots/${bot.id}`, { method: 'DELETE' })).data.ok, true);
  assert.deepEqual(await waitingOf(bot), []);
});

test("a bot carries on after the yes on a job it added, a tile it suggested and a change to its instructions", async () => {
  const bot = await makeBot(srv, { name: 'Planner', emoji: '🗓', prompt: 'Plan the week.' });
  const carries = { who: 'bot', text: 'it carries on' };
  const handed = async (stopped, allowed) => {
    const next = await carriedOn(bot, stopped);
    const rec = await lastRun(bot);
    assert.ok(rec.stdin.includes(`<request>\n${stopped.prompt}\n</request>`) && rec.stdin.includes('<your-reply>\nProposed it. It waits for your OK.\n</your-reply>'), 'the request and its reply');
    assert.ok(rec.stdin.includes(`The owner allowed you to: ${allowed}.`), rec.stdin);
    return next;
  };

  // A job it adds in a run the owner started.
  const added = await inRun(bot, 'Remind me of the plan every Monday', (token) => self(srv, token, 'jobs', { action: 'add', name: 'Monday plan', kind: 'ai', cron: '0 8 * * 1', prompt: 'Send the plan.', assessment: 'It writes: it needs AI.' }));
  const job = added.did.data.job;
  assert.deepEqual([job.approved, job.then, job.runId], [false, thenOf('Remind me of the plan every Monday'), undefined]);
  assert.deepEqual((await waitingOf(bot))[0].then, thenOf('Remind me of the plan every Monday'), 'on its entry of the feed');
  let n = (await runsOf(bot)).length;
  const yes = await approve(bot, job, true);
  assert.deepEqual([yes.data.approved, yes.data.carriesOn, yes.data.then], [true, carries, undefined]);
  await handed(added.run, 'add the job “Monday plan”');
  await startsNothing(bot, n + 1);
  assert.ok(!('carriesOn' in (await approve(bot, job, true)).data), 'a second yes starts nothing');

  // A tile it suggests.
  const tile = await inRun(bot, 'Put my week on the Board', (token) => self(srv, token, 'suggest', { tile: { kind: 'note', title: 'This week' }, reason: 'You ask for it every morning.' }));
  const suggestion = (await srv.api('/dashboard')).data.suggestions.find((s) => s.id === tile.did.data.id);
  assert.deepEqual([suggestion.then, suggestion.runId], [thenOf('Put my week on the Board'), undefined]);
  const put = await srv.api(`/dashboard/suggestions/${suggestion.id}`, { method: 'POST', body: { add: true } });
  assert.deepEqual([put.data.ok, put.data.tile.title, put.data.carriesOn], [true, 'This week', carries]);
  await handed(tile.run, 'put the tile “This week” on their Board');

  // A change to its instructions.
  const rules = await inRun(bot, 'Always plan Fridays lightly', (token) => self(srv, token, 'instructions', { task: 'Plan the week. Keep Fridays light.', reason: 'The owner asked for it.' }));
  const card = (await srv.api('/asks')).data.find((a) => a.id === rules.did.data.requestId);
  assert.deepEqual(card.then, thenOf('Always plan Fridays lightly'));
  const changed = await srv.api(`/asks/${card.id}`, { method: 'POST', body: { yes: true } });
  assert.deepEqual([changed.data.bot.prompt, changed.data.carriesOn], ['Plan the week. Keep Fridays light.', carries]);
  await handed(rules.run, 'change your main assignment');
});

test('nothing starts after a decline, once the owner wrote to the bot after the proposal, or for a proposal made in a job\'s own run', async () => {
  const bot = await makeBot(srv, { name: 'Tidy', emoji: '🧹' });
  const add = (name) => (token) => self(srv, token, 'jobs', { action: 'add', name, kind: 'ai', cron: '0 8 * * *', prompt: 'Tidy up.', assessment: 'It needs judgement.' });

  // A decline.
  const no = await inRun(bot, 'Tidy up every morning', add('Morning tidy'));
  assert.ok(no.did.data.job.then);
  assert.deepEqual((await approve(bot, no.did.data.job, false)).data, { ok: true, removed: true, text: 'Declined and removed' });
  await startsNothing(bot, 1);

  // The owner wrote to the bot after the proposal: they have taken it up themselves.
  const taken = await inRun(bot, 'Tidy up every evening', add('Evening tidy'));
  const later = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Never mind the evenings' } });
  await srv.finished(later.data.id);
  assert.equal((await jobsOf(bot))[0].then, undefined, 'its card says nothing of what follows');
  const yes = await approve(bot, taken.did.data.job, true);
  assert.deepEqual([yes.data.approved, yes.data.carriesOn], [true, undefined]);
  await startsNothing(bot, 3);

  // A job's own run that adds a job: the yes only adds it.
  srv.hold();
  const started = await srv.api(`/bots/${bot.id}/jobs/${taken.did.data.job.id}/run`, { method: 'POST' });
  const rec = await srv.nextRun((x) => x.self?.env && isRunOf(bot)(x) && x.stdin.includes('Tidy up.'), 'the run of the job');
  const own = await add('Night tidy')(rec.self.env.RUN_TOKEN);
  srv.release(rec);
  await srv.finished(started.data.run.id);
  srv.unhold();
  assert.deepEqual([own.data.job.approved, own.data.job.then], [false, undefined]);
  const added = await approve(bot, own.data.job, true);
  assert.deepEqual([added.data.approved, added.data.carriesOn], [true, undefined]);
  await startsNothing(bot, 4);
});

test('botdot stopped and started with a change waiting: the approved job runs and the change still waits', async () => {
  const bot = await makeBot(srv, { name: 'Keeper', emoji: '🗝' });
  const job = (await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: REPORT })).data;
  await inRun(bot, 'Report at six', (token) => self(srv, token, 'jobs', { action: 'update', id: job.id, prompt: 'Write a short report.', cron: '0 6 * * *' }));
  use(await restartServer(srv));
  const [kept] = await jobsOf(bot);
  assert.deepEqual([kept.approved, kept.prompt, new Date(kept.nextRunAt).getUTCHours(), kept.change.prompt, kept.change.when, kept.no], [true, 'Write the report.', 9, 'Write a short report.', 'Daily at 06:00', 'Keep as it is']);
  assert.deepEqual((await waitingOf(bot)).map((j) => [j.change, j.text]), [[true, 'Wants to change a job: Morning report, Daily at 06:00']]);
  assert.equal(await runNow(bot, job), 'Write the report.');
  assert.equal((await approve(bot, job, true)).data.prompt, 'Write a short report.');
});
