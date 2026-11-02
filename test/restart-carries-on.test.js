// What a restart cut off carries on by itself (ADR 140, bots.js carryOnAfterRestart): the owner's request goes on
// from where it was, told so and handed its run's number; a run that carried on is not carried on a second time;
// and after botdot was off for longer than an hour nothing is started unasked.
// What a restart cut off carries on in this file (ADR 140): test/helpers.js leaves it off elsewhere.
process.env.BOT_DOT_RESTART_CARRY_ON = 'on';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, restartServer, readData, makeBot, sleep, waitFor } = require('./helpers');

const isRunOf = (bot) => (x) => x.args.includes(`${bot.emoji} ${bot.name}`);
const runsOf = async (srv, bot) => (await srv.api(`/runs?botId=${bot.id}`)).data;
const carriesOn = (x) => /was cut off because botdot was restarted/.test(x.stdin);

test('a run a restart cut off carries on once, with its request and its number; it is not carried on again when cut off itself', async () => {
  let srv = await startServer();
  try {
    const bot = await makeBot(srv, { name: 'Writer', emoji: '✍️' });
    srv.hold();
    const first = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Draft the report' } })).data;
    await srv.nextRun((x) => isRunOf(bot)(x) && /Draft the report/.test(x.stdin), 'the first run');

    // Stopped in the middle of it, as an update stops botdot; the run that carries on is held too.
    srv = await restartServer(srv);
    const rec = await srv.nextRun((x) => isRunOf(bot)(x) && carriesOn(x), 'the run that carries on');
    assert.ok(rec.stdin.includes('<request>\nDraft the report\n</request>'));
    assert.ok(rec.stdin.includes(`read_run with run "${first.id}"`));
    assert.doesNotMatch(rec.stdin, /answered on its card/);
    const runs = await runsOf(srv, bot);
    assert.equal(runs.find((r) => r.id === first.id).status, 'interrupted');
    const carried = runs.find((r) => r.continues === first.id);
    assert.ok(carried, 'a run that continues the one cut off');
    assert.equal(carried.trigger, 'manual');

    // Cut off a second time: it stays cut off, and the owner asks again if they want it.
    srv = await restartServer(srv);
    srv.unhold();
    await sleep(500);
    assert.equal(srv.runs().filter((x) => isRunOf(bot)(x) && carriesOn(x)).length, 1, 'carried on once');
    assert.equal((await runsOf(srv, bot)).find((r) => r.id === carried.id).status, 'interrupted');
    assert.ok(!fs.existsSync(path.join(srv.data, 'queue.json')) || !readData(srv.data, 'queue.json').queues?.[bot.id], 'nothing waits for it');
  } finally { srv.unhold(); await srv.stop(); }
});

test('after botdot was off for longer than an hour a run that was cut off stays cut off', async () => {
  let srv = await startServer();
  try {
    const bot = await makeBot(srv, { name: 'Sleeper', emoji: '😴' });
    srv.hold();
    const first = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Sort the inbox' } })).data;
    await srv.nextRun((x) => isRunOf(bot)(x) && /Sort the inbox/.test(x.stdin), 'the first run');
    srv = await restartServer(srv, (data) => {
      const file = path.join(data, 'scheduler.json');
      fs.writeFileSync(file, JSON.stringify({ ...readData(data, 'scheduler.json'), lookedAt: new Date(Date.now() - 2 * 3600_000).toISOString() }));
    });
    srv.unhold();
    await waitFor(async () => (await runsOf(srv, bot)).find((r) => r.id === first.id)?.status === 'interrupted', { what: 'the run to be marked cut off' });
    await sleep(500);
    assert.equal(srv.runs().filter((x) => isRunOf(bot)(x) && carriesOn(x)).length, 0);
    assert.equal((await runsOf(srv, bot)).length, 1);
  } finally { srv.unhold(); await srv.stop(); }
});
