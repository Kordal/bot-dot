// What carries on survives (ADR 009, bots.js carryOn and startQueued): behind a busy bot the work waits in the
// bot's queue under a key of its own, is still there after a restart and starts once; with the queue full the yes
// only changes the setting; and a one-time job that is gone from the bot's jobs still runs again.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, restartServer, readData, setQueue, makeBot, seedRuns, sleep, waitFor } = require('./helpers');

const BASH = { tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: 'gh pr list' } };
const isRunOf = (bot) => (x) => x.args.includes(`${bot.emoji} ${bot.name}`);
const runsOf = async (srv, bot) => (await srv.api(`/runs?botId=${bot.id}`)).data;
const asksOf = async (srv, bot) => (await srv.api('/asks')).data.filter((a) => a.botId === bot.id);
const answer = (srv, ask) => srv.api(`/asks/${ask.id}`, { method: 'POST', body: { yes: true } });
// An ask as botdot keeps it, for a run that asked just now.
const askFor = (bot, runId, id) => ({ id, kind: 'permission', botId: bot.id, permission: 'commands', reason: '', at: new Date().toISOString(), runs: [{ id: runId, at: new Date().toISOString() }] });

test('behind a busy bot the work waits in the queue, survives a restart and starts once; a full queue takes none; a one-time job that is gone runs again', async () => {
  let srv = await startServer();
  try {
    const bot = await makeBot(srv, { name: 'Coder', emoji: '💻', allowedTools: ['Read'] });
    const full = await makeBot(srv, { name: 'Swamped', emoji: '🌊', allowedTools: ['Read'] });
    const once = await makeBot(srv, { name: 'Planner', emoji: '🗓️', allowedTools: ['Read'] });
    const sender = await makeBot(srv, { name: 'Sender', emoji: '📤' });

    // The owner's request is refused a tool; then the bot is busy with a task the Chief gave it.
    fs.writeFileSync(path.join(srv.out, 'denials.json'), JSON.stringify([BASH]));
    const first = await srv.finished((await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Check the PRs' } })).data.id);
    fs.writeFileSync(path.join(srv.out, 'denials.json'), '[]');
    srv.hold();
    const busy = (await srv.asChief(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Something long' } })).data;
    await srv.nextRun((x) => isRunOf(bot)(x) && /Something long/.test(x.stdin), 'the long run');
    const [card] = await asksOf(srv, bot);
    assert.ok(card.then, 'a task of the Chief is not the owner asking again');
    const yes = await answer(srv, card);
    assert.deepEqual(yes.data.carriesOn, { who: 'bot', text: 'it carries on when it is free' });
    const item = readData(srv.data, 'queue.json').queues[bot.id];
    assert.deepEqual(item.map((x) => [x.key, x.kind, x.runId, x.allowed, x.declined]), [[`carry:${first.id}`, 'carry-on', first.id, ['run commands'], []]], 'under a key of its own');
    assert.equal((await runsOf(srv, bot)).length, 2, 'nothing started yet');

    // botdot is stopped and started. While it is down, as it would have left them:
    //  - Swamped has ten tasks waiting behind a run, and an ask of a refused run;
    //  - Planner's one-time job ran at its time, was refused, and is gone from its jobs.
    let swampedRun, onceRun;
    srv = await restartServer(srv, (data) => {
      const fromBot = { id: sender.id, name: sender.name, emoji: sender.emoji, color: sender.color, hop: 1, chainId: 'chain-1' };
      setQueue(data, (q) => { q.queues[full.id] = Array.from({ length: 11 }, (_, i) => ({ key: `msg:seed:${i}`, kind: 'message', prompt: `Task ${i}`, fromBot, queuedAt: new Date().toISOString() })); });
      [swampedRun] = seedRuns(srv, full, [{ prompt: 'Check the PRs' }]);
      [onceRun] = seedRuns(srv, once, [{ trigger: 'schedule', jobId: 'once-1', jobName: 'Call the plumber', oneTime: true, notify: 'always', prompt: 'Remind me to call the plumber.', reporting: 'delivered' }]);
      fs.writeFileSync(path.join(data, 'asks.json'), JSON.stringify([askFor(full, swampedRun, 'swamped1'), askFor(once, onceRun, 'once1')]));
    });

    // The work that waited starts by itself, once; the run the restart cut off is not repeated.
    const rec = await srv.nextRun((x) => isRunOf(bot)(x) && /botdot writes this, not the owner/.test(x.stdin), 'the run that carries on');
    assert.ok(rec.stdin.includes('<request>\nCheck the PRs\n</request>'));
    assert.match(rec.stdin, /The owner allowed you to: run commands\./);
    srv.release(rec);
    await waitFor(async () => { const r = await runsOf(srv, bot); return r.length === 3 && r.every((x) => x.status !== 'running'); }, { what: 'the three runs of Coder to have ended' });
    const runs = await runsOf(srv, bot);
    assert.equal(runs.find((r) => r.id === busy.id).status, 'interrupted');
    assert.deepEqual(runs.filter((r) => r.continues).map((r) => r.continues), [first.id]);
    await sleep(200);
    assert.equal((await runsOf(srv, bot)).length, 3, 'it started once');
    assert.equal(readData(srv.data, 'queue.json').queues[bot.id], undefined, 'and left the queue as it started');

    // A full queue: the yes changes the setting, starts nothing, says nothing of carrying on, and the server logs why.
    await waitFor(async () => (await runsOf(srv, full)).some((r) => r.status === 'running'), { what: "Swamped's first task to start" });
    assert.equal(readData(srv.data, 'queue.json').queues[full.id].length, 10);
    const [swamped] = await asksOf(srv, full);
    assert.ok(swamped.then, 'the card cannot know the queue is full');
    const taken = await answer(srv, swamped);
    assert.equal(taken.data.carriesOn, undefined);
    assert.ok(taken.data.bot.allowedTools.includes('Bash'), 'the setting changed');
    assert.equal(readData(srv.data, 'queue.json').queues[full.id].length, 10, 'nothing was added');
    assert.match(srv.log.join(''), new RegExp(`Swamped: its OK changed the setting, and run ${swampedRun} does not carry on: too much is waiting for the bot`));

    // A one-time job that is gone from the bot's jobs: the work carries the job, and it runs once more.
    assert.deepEqual((await srv.api(`/bots/${once.id}`)).data.jobs, []);
    const [plumber] = await asksOf(srv, once);
    assert.deepEqual(plumber.then, { who: 'bot', text: 'It runs “Call the plumber” again when you allow it.' });
    assert.deepEqual((await answer(srv, plumber)).data.carriesOn, { who: 'bot', text: 'it carries on' });
    const again = (await runsOf(srv, once)).find((r) => r.continues === onceRun);
    assert.deepEqual([again.jobId, again.jobName, again.trigger, again.oneTime, again.notify, again.prompt], ['once-1', 'Call the plumber', 'schedule', true, 'always', 'Remind me to call the plumber.']);
    const said = await srv.nextRun(isRunOf(once), "the one-time job's run");
    assert.match(said.stdin, /^Remind me to call the plumber\./);
    assert.match(said.system, /This run is a one-time job the owner asked for/);
  } finally { await srv.stop(); }
});
