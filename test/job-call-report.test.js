// A called run reaches the owner like a scheduled run of its job (ADR 026): by the job's notify, a script by what
// it prints, and a report at night is held till morning while the run itself happens at once. The row of
// failures is in job-row.test.js. Through a real server and the stand-in for Claude.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot, sleep } = require('./helpers');
const { turnOn, call } = require('./call-helpers');

let srv;
let bot;
const isRunOf = (b) => (x) => !!x.self?.env && x.args.includes(`${b.emoji} ${b.name}`);
const hour = new Date().getUTCHours();
const quietHours = (q) => srv.api('/settings', { method: 'PUT', body: { quietHours: { ...q, timeZone: 'UTC' } } });
const day = () => quietHours({ start: 0, end: 0 });
const night = () => quietHours({ start: hour, end: (hour + 2) % 24 }); // now, and the hour after

async function callable(name, fields) {
  const job = (await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name, cron: '0 4 1 1 *', ...fields } })).data;
  return { job, key: await turnOn(srv, bot, job) };
}

before(async () => {
  srv = await startServer();
  bot = await makeBot(srv, { name: 'Porch Watch', emoji: '🏡' });
  await day();
});
after(async () => { srv.unhold(); await srv.stop(); });

test('report-only: the reply stays private, and only a report reaches the owner', async () => {
  const { job, key } = await callable('Quiet', { kind: 'ai', prompt: 'Look.', notify: 'report-only' });
  srv.reply('A cat walked by.');
  const quiet = await srv.finished((await call(srv, bot, job, key, { body: 'motion' })).data.runId);
  await srv.nextRun(isRunOf(bot), 'the quiet run');
  assert.deepEqual([quiet.trigger, quiet.notify, quiet.reporting, quiet.quiet], ['call', 'report-only', 'quiet', true]);

  srv.hold();
  const r = await call(srv, bot, job, key, { body: 'motion' });
  const rec = await srv.nextRun(isRunOf(bot), 'the called run');
  assert.match(rec.system, /Called run \(notify=report-only\): call notify_owner only when there is something new/);
  assert.equal((await srv.api('/self/session/notify', { method: 'POST', headers: { 'X-Run-Token': rec.self.env.RUN_TOKEN }, body: { message: 'A person is at the door.' } })).status, 200);
  srv.release(rec);
  srv.unhold();
  const told = await srv.finished(r.data.runId);
  assert.deepEqual([told.reporting, told.result, !!told.quiet], ['delivered', 'A person is at the door.', false]);
});

test('always: the reply reaches the owner; at night it is held till morning, and the run happens at once', async () => {
  const { job, key } = await callable('Loud', { kind: 'ai', prompt: 'Look.', notify: 'always' });
  srv.reply('The porch light is on.');
  const loud = await srv.finished((await call(srv, bot, job, key)).data.runId);
  assert.deepEqual([loud.reporting, loud.result, !!loud.quiet], ['delivered', 'The porch light is on.', false]);
  await night();
  try {
    const held = await srv.finished((await call(srv, bot, job, key)).data.runId);
    assert.deepEqual([held.status, held.reporting, held.quiet], ['success', 'held', true]);
  } finally { await day(); }
});

test('a called script that prints reaches the owner; one that prints nothing is quiet', async () => {
  const { job, key } = await callable('Echo', { kind: 'script', script: 'cat' });
  const said = await srv.finished((await call(srv, bot, job, key, { body: 'The garage is open.' })).data.runId);
  assert.deepEqual([said.trigger, said.result, !!said.quiet], ['call', 'The garage is open.', false]);
  const silent = await call(srv, bot, job, key);
  assert.equal(silent.status, 202);
  await sleep(500);
  assert.equal((await srv.api(`/runs/${silent.data.runId}`)).status, 404, 'a script that printed nothing leaves no run');
});
