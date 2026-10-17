// Refused calls are kept (ADR 026): the server keeps the last ones of each job, with when, why and from which
// address, and never a key a call sent; the Chief reads them with job_call, and a checkup names the calls
// that came with a wrong key. Through a real server, the Chief's routes and the stand-in for Claude.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { startServer, makeBot } = require('./helpers');
const { DEVICE, turnOn, call } = require('./call-helpers');
const calls = require('../lib/calls');

let srv;
let bot;
let job;
let key;
const setup = async () => (await srv.asChief(`/bots/${bot.id}/jobs/${job.id}/call/setup`)).data;
const checkupNow = async () => (await srv.api('/chief/checkup/now', { method: 'POST' })).data;
const checkupRuns = () => srv.runs().filter((x) => x.args.includes('🧭 Chief of Staff · checkup'));

before(async () => {
  srv = await startServer({ env: { BOT_DOT_LOOK_ON_DEMAND: '1' } });
  await srv.api('/settings/quiet-hours', { method: 'PUT', body: { start: 0, end: 0 } });
  bot = await makeBot(srv, { name: 'Garage Watch' });
  job = (await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Motion', kind: 'script', cron: '0 4 1 1 *', script: 'cat' } })).data;
  key = await turnOn(srv, bot, job);
});
after(() => srv.stop());

test('a checkup with no wrong key says nothing of calls', async () => {
  srv.reply('NOTHING');
  assert.equal((await checkupNow()).ran, true);
  const { stdin, system } = checkupRuns().at(-1);
  assert.doesNotMatch(stdin, /wrong key/);
  assert.match(system, /Calls to a job that came with a wrong key/);
});

test('a refused call is kept with when, why and the device; never the key it sent', async () => {
  const wrong = `${key}-not-it`;
  assert.equal((await call(srv, bot, job, wrong)).status, 401);
  assert.equal((await call(srv, bot, job, null, { headers: { 'Tailscale-User-Login': 'someone@example.com' } })).status, 401);
  // On botdot's own port, not through the front door.
  const onPort = await new Promise((resolve) => http.request({ host: '127.0.0.1', port: srv.botdotPort, method: 'POST', path: `/api/bots/${bot.id}/jobs/${job.id}/call`, headers: { 'X-Forwarded-For': '127.0.0.9', Authorization: `Bearer ${key}` } }, (res) => { res.resume(); resolve(res.statusCode); }).end());
  assert.equal(onPort, 403);
  await srv.api(`/bots/${bot.id}/jobs/${job.id}`, { method: 'PUT', body: { enabled: false } });
  assert.equal((await call(srv, bot, job, key)).status, 409);
  await srv.api(`/bots/${bot.id}/jobs/${job.id}`, { method: 'PUT', body: { enabled: true } });
  // An address that names no job keeps nothing.
  assert.equal((await call(srv, bot, { id: 'jnope00' }, wrong)).status, 401);

  const { refused } = await setup();
  assert.deepEqual(refused.map((c) => [c.why, c.device, c.login]), [
    ['paused', DEVICE, undefined], // its one job switched off: the bot is paused
    ['refused origin', '127.0.0.9', undefined],
    ['no key', DEVICE, undefined], // a Tailscale login is not passed on: anyone could write one
    ['wrong key', DEVICE, undefined],
  ], 'newest first');
  for (const c of refused) assert.ok(Date.parse(c.at) > Date.now() - 60_000);
  const kept = fs.readFileSync(path.join(srv.data, 'call-refusals.json'), 'utf8');
  assert.ok(!kept.includes(key) && !kept.includes(wrong), 'no key is kept');
  assert.ok(!kept.includes('jnope00'));
});

test('a checkup after wrong-key calls names them, with the device', async () => {
  srv.reply('NOTHING');
  assert.equal((await checkupNow()).ran, true);
  assert.match(checkupRuns().at(-1).stdin, new RegExp(`- "Motion" \\(a script, [^\\n]*1 call came with a wrong key, the last at \\S+ \\S+, from ${DEVICE.replace(/\./g, '\\.')}\\.`));
});

test('only the last ones are kept, and calls without a key do not push the wrong keys out', async () => {
  for (let i = 0; i < calls.REFUSALS_KEPT + 2; i++) await call(srv, bot, job, 'wrong');
  for (let i = 0; i < calls.REFUSALS_KEPT + 2; i++) await call(srv, bot, job, null);
  const { refused } = await setup();
  assert.equal(refused.filter((c) => c.why === 'wrong key').length, calls.REFUSALS_KEPT);
  assert.equal(refused.filter((c) => c.why !== 'wrong key').length, calls.REFUSALS_KEPT);
  assert.equal(refused[0].why, 'no key', 'newest first');
});
