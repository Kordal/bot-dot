// A report the owner asked for arrives (QW-004). The run of a one-time job ("at") delivers its final reply:
// not quiet, not taken for "nothing new", not held by quiet hours; a repeating job is as before. And
// attach_file says, in a run whose reply is private, that the file needs a report.
// The last test waits for no schedule: botdot is stopped, the one-time job's time is put into the past and the
// watch job is set to every minute, so that back on it runs both at once (QW-009).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { finishReport } = require('../lib/reporting');
const { quietRun } = require('../lib/problems');
const { runCounts } = require('../lib/read');
const { startServer, restartServer, setJobs, makeBot, feed, waitFor } = require('./helpers');
const { rpcClient } = require('./memory-helpers');

// Quiet hours that hold now, whatever the hour.
const quietNow = () => { const hour = new Date().getUTCHours(); return { start: hour, end: (hour + 23) % 24, timeZone: 'UTC' }; };
const scheduled = (fields) => ({ trigger: 'schedule', status: 'success', notify: 'report-only', notificationAudience: 'owner', result: 'The PRs are all merged.', ...fields });

test('a one-time run delivers its final reply; its report, when it sends one, goes as any report', () => {
  const now = new Date();
  for (const result of ['The PRs are all merged.', 'Nothing new.']) {
    const run = scheduled({ oneTime: true, result });
    finishReport(run, now, quietNow());
    assert.equal(run.reporting, 'delivered', `"${result}" inside quiet hours`);
    assert.equal(run.result, result, 'the reply as it is');
    assert.ok(!quietRun(run) && runCounts(run), 'not quiet, and a new reply');
    const day = scheduled({ oneTime: true, result });
    finishReport(day, now, { start: 0, end: 0 });
    assert.equal(day.reporting, 'delivered', `"${result}" outside quiet hours`);
    assert.equal(day.result, result);
  }
  // With a report, the report is delivered in place of the reply, by the rules for reports.
  const urgent = scheduled({ oneTime: true, ownerReport: { message: 'One PR needs you today.', urgent: true } });
  finishReport(urgent, now, quietNow());
  assert.deepEqual([urgent.reporting, urgent.result, urgent.rawResult], ['delivered', 'One PR needs you today.', 'The PRs are all merged.']);
  const held = scheduled({ oneTime: true, ownerReport: { message: 'One PR is open.', urgent: false } });
  finishReport(held, now, quietNow());
  assert.equal(held.reporting, 'held');
  const nothing = scheduled({ oneTime: true, ownerReport: { message: 'Nic nowego.', urgent: true } });
  finishReport(nothing, now, quietNow());
  assert.equal(nothing.reporting, 'suppressed');
  // A one-time run that failed, or was started by hand, is untouched, as any run.
  const failed = scheduled({ oneTime: true, status: 'error' });
  finishReport(failed, now, quietNow());
  assert.equal(failed.reporting, undefined);
});

test('a repeating job is as before: report-only is quiet, "always" drops nothing-new and waits out quiet hours', () => {
  const now = new Date();
  const quiet = scheduled({});
  finishReport(quiet, now, { start: 0, end: 0 });
  assert.deepEqual([quiet.reporting, quiet.result], ['quiet', '']);
  assert.ok(quietRun(quiet) && !runCounts(quiet));
  const always = scheduled({ notify: 'always', result: 'Nothing new.' });
  finishReport(always, now, { start: 0, end: 0 });
  assert.equal(always.reporting, 'suppressed');
  const night = scheduled({ notify: 'always' });
  finishReport(night, now, quietNow());
  assert.equal(night.reporting, 'held');
});

test('a one-time job at night reaches the owner, a watch job beside it stays quiet, and attach_file says which reply is private', async (t) => {
  let srv = await startServer();
  let f;
  try {
    assert.equal((await srv.api('/settings', { method: 'PUT', body: { quietHours: quietNow() } })).status, 200);
    srv.hold();
    srv.reply('Nothing new.');
    const once = await makeBot(srv, { name: 'Once' });
    const watch = await makeBot(srv, { name: 'Watch' });
    const at = new Date(Date.now() + 3 * 864e5).toISOString().slice(0, 16); // the test server runs on UTC
    const onceJob = (await srv.api(`/bots/${once.id}/jobs`, { method: 'POST', body: { name: 'PRs on Friday', at, prompt: 'Check the PRs once' } })).data;
    const watchJob = (await srv.api(`/bots/${watch.id}/jobs`, { method: 'POST', body: { name: 'Watch the PRs', cron: '0 3 * * *', prompt: 'Watch the PRs always' } })).data;
    assert.ok(onceJob.at && watchJob.notify === 'report-only' && onceJob.notify === 'report-only', 'both report-only: the one-time job needs no setting');
    // Back on, botdot finds the one-time job due an hour ago and the watch job due this minute.
    srv = await restartServer(srv, (data) => setJobs(data, { [onceJob.id]: { at: new Date(Date.now() - 3600e3).toISOString() }, [watchJob.id]: { cron: '* * * * *' } }));
    f = feed(srv);
    const find = (words) => srv.runs().find((r) => r.stdin.includes(words));
    await waitFor(() => find('Check the PRs once') && find('Watch the PRs always'), { what: 'both jobs to come up' });
    await srv.api(`/bots/${watch.id}/jobs/${watchJob.id}`, { method: 'PUT', body: { enabled: false } });
    const recs = { once: find('Check the PRs once'), watch: find('Watch the PRs always') };

    // What each run is told.
    assert.match(recs.once.system, /This run is a one-time job the owner asked for, at a time they chose: your final reply reaches the owner as it is, so put the result in it\. Don't use notify_owner in this run: a report sent with it replaces your reply, and may be held back until the morning\./);
    assert.doesNotMatch(recs.once.system, /Your final reply is private/);
    assert.match(recs.watch.system, /Scheduled run \(notify=report-only\): call notify_owner only when there is something new to report; otherwise just finish\. Your final reply is private unless notify=always\./);

    // attach_file, as the bot's own tool answers it.
    const answers = {};
    for (const [k, bot] of [['once', once], ['watch', watch]]) {
      fs.writeFileSync(path.join(srv.data, 'workspaces', bot.id, 'prs.txt'), 'three open');
      answers[k] = await rpcClient(t, 'self-mcp.js', recs[k].self.env).text('attach_file', { path: 'prs.txt' });
    }
    assert.equal(answers.watch, 'Attached prs.txt. The owner gets it only if you call notify_owner.');
    assert.equal(answers.once, 'Attached prs.txt. It shows under your reply; just say in a line what it is.');

    const done = {};
    for (const [k, bot] of [['once', once], ['watch', watch]]) {
      const run = (await srv.api(`/runs?botId=${bot.id}`)).data[0];
      srv.release(recs[k]);
      done[k] = await srv.finished(run.id);
      done[`${k}Event`] = (await f.wait('run_finished', (d) => d.id === run.id)).data;
    }
    assert.equal(done.once.oneTime, true);
    assert.equal(done.once.reporting, 'delivered', 'inside quiet hours, saying "Nothing new."');
    assert.equal(done.once.result, 'Nothing new.');
    assert.ok(!done.once.quiet);
    assert.deepEqual([done.onceEvent.quiet, done.onceEvent.new, done.onceEvent.notificationAudience], [false, true, 'owner'], 'a new reply for the owner');
    assert.equal((await srv.api(`/bots/${once.id}`)).data.unread, 1);
    assert.ok(!(await srv.api(`/bots/${once.id}`)).data.jobs.some((j) => j.id === onceJob.id), 'the job is gone once it ran');

    assert.equal(done.watch.oneTime, undefined);
    assert.equal(done.watch.reporting, 'quiet');
    assert.equal(done.watch.quiet, true);
    assert.equal(done.watchEvent.new, undefined);
    assert.equal((await srv.api(`/bots/${watch.id}`)).data.unread, 0);

    // In a run that is not scheduled, attach_file answers as it always did.
    const manual = await srv.api(`/bots/${watch.id}/run`, { method: 'POST', body: { prompt: 'by hand' } });
    const rec = await srv.nextRun((r) => r.stdin.includes('by hand'));
    assert.equal(await rpcClient(t, 'self-mcp.js', rec.self.env).text('attach_file', { path: 'prs.txt' }), 'Attached prs.txt. It shows under your reply; just say in a line what it is.');
    srv.release(rec);
    await srv.finished(manual.data.id);
  } finally { f?.close(); srv.unhold(); await srv.stop(); }
});
