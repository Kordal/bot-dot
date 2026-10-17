const { test } = require('node:test');
const assert = require('node:assert/strict');
const { noNews, finishReport, inQuietHours, quietHours } = require('../lib/reporting');
const { normalizeJob } = require('../lib/jobs');
const { quietRun } = require('../lib/problems');
const { startServer, makeBot, feed, waitFor } = require('./helpers');

test('no-news safety net matches whole messages in several languages', () => {
  for (const s of ['', 'Nothing new.', '**No updates!**', 'No changes', 'All quiet', 'Nic nowego.', 'Brak zmian', 'Rien de nouveau', 'Nichts Neues', 'Nada nuevo', 'Geen nieuws', '没有更新']) assert.ok(noNews(s), s);
  for (const s of ['No updates. But your package is overdue.', 'Nothing new costs £30', 'The package has arrived.']) assert.ok(!noNews(s), s);
});
test('explicit reporting gates text and files; manual runs and a failure outside a row stay visible', () => {
  const run = { trigger: 'schedule', status: 'success', notify: 'report-only', result: 'Nothing new.', files: [{ name: 'a.pdf' }] };
  finishReport(run, new Date(), { start: 0, end: 0 });
  assert.equal(run.reporting, 'quiet'); assert.ok(quietRun(run)); assert.equal(run.rawResult, 'Nothing new.');
  for (const extra of [{ trigger: 'manual' }, { status: 'error' }]) {
    const m = { ...run, ...extra, reporting: undefined, result: 'Original' };
    finishReport(m, new Date()); assert.equal(m.result, 'Original'); assert.ok(!quietRun(m));
  }
  // A repeating job's failure is said once: the first of its row shows, the next are quiet, and the first is held
  // at night (BUSY-004, test/job-row.test.js). Its text stays as it is.
  const failed = (row, config = { start: 0, end: 0 }) => { const m = { ...run, status: 'error', jobId: 'j1', reporting: undefined, result: 'Original' }; finishReport(m, new Date(), config, row); return m; };
  assert.deepEqual([failed(null).reporting, quietRun(failed(null))], [undefined, false]);
  assert.deepEqual([failed({ failures: 1 }).reporting, quietRun(failed({ failures: 1 })), failed({ failures: 1 }).result], ['quiet', true, 'Original']);
  const hour = new Date().getUTCHours();
  const now = { start: hour, end: (hour + 2) % 24, timeZone: 'UTC' };
  assert.deepEqual([failed(null, now).reporting, quietRun(failed(null, now)), failed({ failures: 1 }, now).reporting], ['held', true, 'quiet']);
  const always = { trigger: 'schedule', status: 'success', notify: 'always', result: 'Nothing new.' };
  finishReport(always, new Date()); assert.equal(always.reporting, 'suppressed');
  assert.equal(normalizeJob({}).notify, 'report-only');
  assert.throws(() => normalizeJob({ notify: 'invalid' }));
});
test('quiet hours use the owner timezone, boundaries, and DST', () => {
  const q = { start: 22, end: 7, timeZone: 'Europe/Brussels' };
  for (const [at, expected] of [['2026-09-28T19:59:00Z', false], ['2026-09-28T20:00:00Z', true], ['2026-09-29T04:59:00Z', true], ['2026-09-29T05:00:00Z', false], ['2026-12-01T05:59:00Z', true], ['2026-12-01T06:00:00Z', false]]) assert.equal(inQuietHours(new Date(at), q), expected, at);
  assert.equal(inQuietHours(new Date(), { start: 0, end: 0 }), false);
  assert.throws(() => quietHours({ start: 24 })); assert.throws(() => quietHours({ timeZone: 'bogus' }));
});

test('scheduled reporting is quiet by default, emits once, and recovers held reports on restart', { timeout: 60_000 }, async () => {
  let srv = await startServer(); let f = feed(srv);
  try {
    const hour = new Date().getUTCHours();
    await srv.api('/settings', { method: 'PUT', body: { quietHours: { start: hour, end: (hour + 23) % 24, timeZone: 'UTC' } } });
    srv.hold(); srv.reply('Nothing new.');
    const cases = [
      { name: 'Unreported' },
      { name: 'Suppressed', report: { message: 'Nic nowego.', urgent: true } },
      { name: 'Urgent', report: { message: 'Your parcel needs collecting today.', urgent: true } },
      { name: 'Held', report: { message: 'Your parcel arrived.' } },
    ];
    for (const c of cases) {
      c.bot = await makeBot(srv, { name: c.name });
      c.job = (await srv.api(`/bots/${c.bot.id}/jobs`, { method: 'POST', body: { name: c.name, cron: '* * * * *', prompt: `Check ${c.name}` } })).data;
    }
    await srv.tick();
    await waitFor(() => srv.runs().length >= cases.length, { timeout: 30_000, every: 100, what: 'scheduled jobs' });
    for (const c of cases) {
      const rec = srv.runs().find(r => r.stdin.includes(`Check ${c.name}`));
      assert.ok(rec); assert.equal(rec.self.env.SELF_NOTIFY, '1'); assert.match(rec.system, /notify_owner/);
      await srv.api(`/bots/${c.bot.id}/jobs/${c.job.id}`, { method: 'PUT', body: { enabled: false } });
      if (c.report) {
        const headers = { 'X-Run-Token': rec.self.env.RUN_TOKEN };
        for (let i = 0; i < 2; i++) assert.equal((await srv.api('/self/session/notify', { method: 'POST', headers, body: c.report })).status, 200);
      }
      const run = (await srv.api(`/runs?botId=${c.bot.id}`)).data[0];
      srv.release(rec); c.done = await srv.finished(run.id);
      const ev = await f.wait('run_finished', d => d.id === run.id);
      assert.equal(ev.data.quiet, c.name !== 'Urgent');
      assert.equal(ev.data.notificationAudience, 'owner');
      assert.equal(f.events.filter(e => e.type === 'run_finished' && e.data.id === run.id).length, 1);
    }
    assert.equal(cases[0].done.reporting, 'quiet');
    assert.equal(cases[1].done.reporting, 'suppressed');
    assert.equal(cases[2].done.result, cases[2].report.message);
    assert.equal(cases[3].done.reporting, 'held');
    srv.unhold();
    // A manual chat retains its ordinary final reply, and cannot stage scheduled reports.
    srv.hold();
    const manual = await srv.api(`/bots/${cases[0].bot.id}/run`, { method: 'POST', body: { prompt: 'manual chat' } });
    const rec = await srv.nextRun(r => r.stdin.includes('manual chat'));
    assert.equal(rec.self.env.SELF_NOTIFY, '0');
    assert.equal((await srv.api('/self/session/notify', { method: 'POST', headers: { 'X-Run-Token': rec.self.env.RUN_TOKEN }, body: { message: 'no' } })).data.ok, false);
    srv.release(rec); assert.ok(!(await srv.finished(manual.data.id)).quiet); srv.unhold();
    // End quiet hours while offline, then recover from durable run records.
    const dir = srv.dir; f.close(); await srv.stop();
    const fs = require('fs'), path = require('path');
    const file = path.join(srv.data, 'settings.json');
    const settings = JSON.parse(fs.readFileSync(file)); settings.quietHours.start = settings.quietHours.end;
    fs.writeFileSync(file, JSON.stringify(settings));
    srv = await startServer({ dir }); f = feed(srv);
    const recovered = (await srv.api(`/runs/${cases[3].done.id}`)).data;
    assert.equal(recovered.reporting, 'delivered'); assert.ok(!recovered.quiet); assert.ok(recovered.deliveredAt);
    assert.equal(recovered.result, cases[3].report.message);
    assert.equal(recovered.notificationAudience, 'owner');
    await srv.stop(); srv = await startServer({ dir });
    assert.equal((await srv.api(`/runs/${recovered.id}`)).data.deliveredAt, recovered.deliveredAt, 'restart does not deliver twice');
  } finally { f.close(); await srv.stop(); }
});
