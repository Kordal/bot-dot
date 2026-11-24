// A job around its time, through a real server: the owner's and the Chief's routes take `around`, hand it out with the
// job and its words, a new time without it said again is a time that was named, and the Chief's own jobs take it too.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot } = require('./helpers');
const { create } = require('../lib/chief-jobs');
const fs = require('fs');
const os = require('os');
const path = require('path');

let srv;
let bot;
before(async () => { srv = await startServer(); bot = await makeBot(srv, { name: 'Morning' }); });
after(() => srv.stop());

test('the owner adds a job around its time: the job says so, and its words', async () => {
  const made = (await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Digest', cron: '0 8 * * *', around: true, prompt: 'Digest' } })).data;
  assert.equal(made.around, true);
  assert.equal(made.when, 'Daily around 08:00');
  assert.ok(made.nextRunAt);
  const exact = (await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Exact', cron: '0 8 * * *', prompt: 'Exact' } })).data;
  assert.equal(exact.around, undefined);
  assert.equal(exact.when, 'Daily at 08:00');
  assert.equal(exact.nextRunAt.slice(11, 16), '08:00');
});

test('an edit that does not name the time keeps it; a new time without "around" said again is exact', async () => {
  const made = (await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Digest2', cron: '0 7 * * *', around: true, prompt: 'D' } })).data;
  const renamed = (await srv.api(`/bots/${bot.id}/jobs/${made.id}`, { method: 'PUT', body: { name: 'Digest 2b' } })).data;
  assert.equal(renamed.around, true);
  const sameTime = (await srv.api(`/bots/${bot.id}/jobs/${made.id}`, { method: 'PUT', body: { cron: '0 7 * * *' } })).data;
  assert.equal(sameTime.around, true, 'the same time, still around');
  const named = (await srv.api(`/bots/${bot.id}/jobs/${made.id}`, { method: 'PUT', body: { cron: '30 7 * * *' } })).data;
  assert.equal(named.around, undefined, 'a time the owner named');
  assert.equal(named.when, 'Daily at 07:30');
  const again = (await srv.api(`/bots/${bot.id}/jobs/${made.id}`, { method: 'PUT', body: { cron: '0 9 * * *', around: true } })).data;
  assert.equal(again.around, true);
  assert.equal(again.when, 'Daily around 09:00');
  const hourly = (await srv.api(`/bots/${bot.id}/jobs/${made.id}`, { method: 'PUT', body: { cron: '0 * * * *', around: true } })).data;
  assert.equal(hourly.around, undefined, 'every hour has no time to be loose about');
});

test('the Chief sets it on a bot\'s job', async () => {
  const made = (await srv.asChief(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Chief digest', cron: '0 18 * * *', around: true, prompt: 'D', assessment: 'Needs AI.' } })).data;
  assert.equal(made.around, true);
  assert.equal(made.when, 'Daily around 18:00');
});

test('the Chief\'s own jobs take it: kept, shown in words, and run around the time', () => {
  const s = create(fs.mkdtempSync(path.join(os.tmpdir(), 'chief-jobs-around-')));
  const j = s.add({ name: 'News', task: 'x', cron: '30 8 * * *', around: true });
  assert.equal(j.around, true);
  assert.equal(j.when, 'Daily around 08:30');
  // due: at one minute of the day, within 15 minutes of 08:30, once
  const due = [];
  for (let k = 0; k < 1440; k++) { const m = new Date(2031, 5, 3, 0, k); if (s.due(m)) due.push(m); }
  assert.equal(due.length, 1);
  assert.ok(Math.abs((due[0].getHours() * 60 + due[0].getMinutes()) - (8 * 60 + 30)) <= 15);
  assert.equal(s.update(j.id, { name: 'News 2' }).around, true);
  const named = s.update(j.id, { cron: '0 9 * * *' });
  assert.equal(named.around, undefined);
  assert.equal(named.when, 'Daily at 09:00');
  assert.equal(s.add({ name: 'Hourly', task: 'x', cron: '0 * * * *', around: true }).around, undefined);
  assert.equal(s.add({ name: 'Once', task: 'x', at: '2099-05-01T09:00', around: true }).around, undefined);
});
