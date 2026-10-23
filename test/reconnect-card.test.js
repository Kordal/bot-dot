// A job's scheduled run that finds a connected app signed out (#431): the owner gets a Reconnect card under that run's reply
// (`reconnect` on the run), at most once a day per app, again at once after the app was connected and signed out
// again, and never for a run the owner started. A run with the card reaches the owner as a report does.
process.env.BOT_DOT_RUNS_MAX = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, makeBot, heldRun, waitFor, fakeConnectedApp, connectorEnv } = require('./helpers');
const { rpcClient } = require('./memory-helpers');
const { finishReport } = require('../lib/reporting');
const { quietRun } = require('../lib/problems');

const said = (result) => result.content.map((c) => c.text).join('\n');
const fetchMail = (tools) => tools.call('connector_run', { app: 'gmail', action: 'GMAIL_FETCH_EMAILS', arguments: {} });
const CARD = /^Error: Gmail is signed out, so nothing was done\. The owner now has a Reconnect card for it under your reply/;

let app, srv;
before(async () => {
  app = await fakeConnectedApp();
  srv = await startServer({ env: app.env });
  await app.connect(srv);
  await srv.api('/settings', { method: 'PUT', body: { quietHours: { start: 0, end: 0, timeZone: 'UTC' } } });
});
after(async () => { await srv.stop(); app.close(); });

// One run of the bot's every-minute job, started by the scheduler and held: its tools for connected apps, and its end.
async function scheduled(t, bot) {
  srv.hold();
  await srv.tick();
  const rec = await srv.nextRun((x) => x.self?.env && x.args.includes(`${bot.emoji} ${bot.name}`), `a scheduled run of ${bot.name}`);
  const run = await waitFor(async () => (await srv.api(`/runs?botId=${bot.id}`)).data.find((r) => r.trigger === 'schedule' && r.status === 'running'), { what: 'the scheduled run' });
  const tools = rpcClient(t, 'connectors-mcp.js', connectorEnv(srv, rec.self.env.RUN_TOKEN));
  return { run, tools, end: async () => { srv.release(rec); return srv.finished(run.id); } };
}

test('a scheduled run on a signed-out app gets one Reconnect card a day, and one again after the app was connected', { timeout: 120_000 }, async (t) => {
  const bot = await makeBot(srv, { name: 'Mail Watcher', emoji: '📬', connectors: ['gmail'] });
  const job = (await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Check mail', kind: 'ai', cron: '* * * * *', prompt: 'Check my mail.' } })).data;
  t.after(() => srv.api(`/bots/${bot.id}/jobs/${job.id}`, { method: 'PUT', body: { enabled: false } }));
  srv.reply('Gmail needs reconnecting.');

  // The first: the bot is told the owner has the card, and the run, report-only, reaches the owner with it.
  const first = await scheduled(t, bot);
  assert.match(said(await fetchMail(first.tools)), CARD);
  assert.match(said(await fetchMail(first.tools)), /isn't connected/, 'asked again in the same run: one card');
  const done = await first.end();
  assert.deepEqual(done.reconnect, [{ app: 'gmail', name: 'Gmail' }]);
  assert.deepEqual([done.status, done.reporting, done.result, !!done.quiet], ['success', 'delivered', 'Gmail needs reconnecting.', false]);

  // The next scheduled run the same day: no new card, and the run is private as any report-only run.
  const second = await scheduled(t, bot);
  assert.match(said(await fetchMail(second.tools)), /isn't connected \(or its connection expired\)/);
  const quiet = await second.end();
  assert.equal(quiet.reconnect, undefined);
  assert.equal(quiet.quiet, true);

  // Connected again, the app works; signed out again, the next scheduled run has its card at once.
  app.connected.push('gmail');
  const third = await scheduled(t, bot);
  assert.equal(said(await fetchMail(third.tools)), '{"done":true}');
  app.connected.splice(0);
  assert.match(said(await fetchMail(third.tools)), CARD);
  assert.deepEqual((await third.end()).reconnect, [{ app: 'gmail', name: 'Gmail' }]);
});

test("a run the owner started gets no card, and leaves the day's card to a job's run", { timeout: 60_000 }, async (t) => {
  const other = await startServer({ env: app.env });
  t.after(() => other.stop());
  await app.connect(other);
  const bot = await makeBot(other, { name: 'Asked Reader', emoji: '📨', connectors: ['gmail'] });
  const { rec, run, token } = await heldRun(other, bot, 'Read my mail');
  const tools = rpcClient(t, 'connectors-mcp.js', connectorEnv(other, token));
  assert.match(said(await fetchMail(tools)), /isn't connected \(or its connection expired\)\. Ask the owner to connect it on the Connectors page\.$/);
  other.release(rec);
  assert.equal((await other.finished(run.id)).reconnect, undefined);
  const kept = JSON.parse(fs.readFileSync(path.join(other.data, 'connectors.json'), 'utf8'));
  assert.equal(kept.cards?.gmail, undefined, 'no card was counted');
});

test('the card comes once in 24 hours per app', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-cards-'));
  try {
    const C = require('../lib/connectors').create(dir);
    const t0 = Date.parse('2026-10-23T08:00:00Z');
    assert.equal(C.reconnectCardDue('gmail', t0), true);
    assert.equal(C.reconnectCardDue('gmail', t0 + 3600e3), false);
    assert.equal(C.reconnectCardDue('slack', t0 + 3600e3), true, 'another app has its own');
    assert.equal(C.reconnectCardDue('gmail', t0 + 24 * 3600e3 - 1), false);
    assert.equal(C.reconnectCardDue('gmail', t0 + 24 * 3600e3), true);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a run with a card is said as a report is: held at night, and after the first failure of a row too', () => {
  const night = { start: 0, end: 23, timeZone: 'UTC' };
  const day = { start: 0, end: 0, timeZone: 'UTC' };
  const now = new Date('2026-10-23T12:00:00Z');
  const ok = () => ({ trigger: 'schedule', jobId: 'j', status: 'success', notify: 'report-only', result: 'Gmail is signed out.', reconnect: [{ app: 'gmail', name: 'Gmail' }] });
  const a = ok(); finishReport(a, now, day);
  assert.deepEqual([a.reporting, a.result, quietRun(a)], ['delivered', 'Gmail is signed out.', false]);
  const b = ok(); finishReport(b, now, night);
  assert.deepEqual([b.reporting, quietRun(b)], ['held', true]);
  const c = { ...ok(), ownerReport: { message: 'Mail is stuck: Gmail signed out.', urgent: false } }; finishReport(c, now, day);
  assert.equal(c.result, 'Mail is stuck: Gmail signed out.', 'its report, when it sent one');
  const blank = { ...ok(), result: '' }; finishReport(blank, now, day);
  assert.equal(quietRun(blank), false, 'the card shows under an empty reply');
  const failed = { trigger: 'schedule', jobId: 'j', status: 'error', reconnect: [{ app: 'gmail', name: 'Gmail' }] };
  finishReport(failed, now, day, { failures: 2 });
  assert.equal(quietRun(failed), false);
  const plain = { trigger: 'schedule', jobId: 'j', status: 'error' };
  finishReport(plain, now, day, { failures: 2 });
  assert.equal(quietRun(plain), true, 'without a card, a later failure of a row stays quiet');
});
