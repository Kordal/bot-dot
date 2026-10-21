// The owner steers a waiting message into the run that is going (#173, ADR 040; docs/api.md "Steer"): a press on
// "Steer" marks it, and the run reads it at its next tool call, through the hook botdot gives the run. Here the
// test calls what the hook calls, with the run's key, as each tool call of the run would; the hook itself is
// run once against the server. Against a real botdot server and the stand-in for Claude, whose runs are held
// and released: no test here waits for a time to pass.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, restartServer, makeBot, heldRun, self, hookCall, waitFor, feed, readData, setQueue, sleep } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(() => { srv.unhold(); return srv.stop(); });

const send = (on, bot, body) => on.api(`/bots/${bot.id}/run`, { method: 'POST', body });
const steer = (on, bot, id) => on.api(`/bots/${bot.id}/queued/${id}/steer`, { method: 'POST' });
const takeBack = (on, bot, id) => on.api(`/bots/${bot.id}/queued/${id}`, { method: 'DELETE' });
const runsOf = async (on, bot) => (await on.api(`/runs?botId=${bot.id}`)).data;
const botOf = async (on, bot) => (await on.api(`/bots/${bot.id}`)).data;
const waitingIn = (on, bot) => (readData(on.data, 'queue.json').queues[bot.id] || []);
const ranAll = (on, bot, n) => waitFor(async () => { const r = await runsOf(on, bot); return r.length === n && r.every((x) => x.status !== 'running') ? r : null; }, { timeout: 30_000, what: `${n} runs of ${bot.name}` });
const isRunOf = (bot) => (x) => x.args.includes(`${bot.emoji} ${bot.name}`);
// What the hook asks after a tool call of the run: the context Claude is handed, or null for nothing.
const toolCall = async (on, token) => (await self(on, token, 'steer')).data.hookSpecificOutput?.additionalContext ?? null;
const upload = async (on, bot, name = 'where.txt') => (await on.api(`/uploads?to=bot:${bot.id}`, { method: 'POST', raw: Buffer.from('host: staging-vm\n'), headers: { 'X-File-Name': name } })).data;

test('the features name it', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('steer'));
});

test('a steered message is read by the run that is going at its next tool call, in the same run, and stands in its record', async (t) => {
  const bot = await makeBot(srv, { name: 'Buildr Migrator', emoji: '🏗️' });
  const f = await feed(srv);
  t.after(() => f.close());
  await f.wait('hello');
  srv.reply('Moved, with access from Homelab Admin.');
  const h = await heldRun(srv, bot, 'Move the build to staging-vm');
  const file = await upload(srv, bot);
  const w = (await send(srv, bot, { prompt: 'staging-vm access mozesz dostac od Homelab Admin', attachments: [file], key: 'steer-key-1' })).data;
  assert.equal(w.status, 'queued');
  // Nothing was steered yet: a tool call reads nothing.
  assert.equal(await toolCall(srv, h.token), null);

  const s = await steer(srv, bot, w.id);
  assert.equal(s.status, 200, JSON.stringify(s.data));
  assert.deepEqual(s.data.queued.map((q) => [q.id, q.steering]), [[w.id, true]]);
  // Still waiting, on disk, marked for the run that is going; the list and the feed say it is steered.
  assert.deepEqual(waitingIn(srv, bot).map((x) => [x.runId, x.steering]), [[w.id, h.run.id]]);
  assert.deepEqual((await botOf(srv, bot)).queued.map((q) => [q.id, q.text, q.steering]), [[w.id, 'staging-vm access mozesz dostac od Homelab Admin', true]]);
  await f.wait('queued', (d) => d.botId === bot.id && d.queued[0]?.steering === true);
  // Pressed again: steered once.
  assert.equal((await steer(srv, bot, w.id)).status, 200);

  // The run's next tool call: the hook is answered with the message, in botdot's words, and its file.
  const read = await toolCall(srv, h.token);
  assert.match(read, /The owner has sent you a message while you work/);
  assert.ok(read.includes('staging-vm access mozesz dostac od Homelab Admin'));
  assert.ok(read.includes(file.file), 'told of its file');
  // Read once: the next tool call reads nothing.
  assert.equal(await toolCall(srv, h.token), null);
  // It left the list, and is on the run's record, in order, with when it was sent and read.
  assert.deepEqual((await botOf(srv, bot)).queued, []);
  assert.deepEqual(waitingIn(srv, bot), []);
  const going = (await srv.api(`/runs/${h.run.id}?events=0`)).data;
  assert.deepEqual(going.steered.map((x) => [x.id, x.text, x.attachments.map((a) => a.file), x.at]), [[w.id, 'staging-vm access mozesz dostac od Homelab Admin', [file.file], w.queuedAt]]);
  assert.ok(Date.parse(going.steered[0].readAt) >= Date.parse(w.queuedAt));
  const said = (await f.wait('run_steered', (d) => d.runId === h.run.id)).data;
  assert.deepEqual([said.chat, said.botId, said.steered.map((x) => x.id)], [`bot:${bot.id}`, bot.id, [w.id]]);
  // After it was read, Steer and Take back find it started.
  assert.deepEqual([(await steer(srv, bot, w.id)).status, (await takeBack(srv, bot, w.id)).status], [409, 409]);
  // Sent again with its key: nothing more waits.
  const again = await send(srv, bot, { prompt: 'staging-vm access mozesz dostac od Homelab Admin', key: 'steer-key-1' });
  assert.deepEqual([again.status, again.data.again, again.data.id], [200, true, h.run.id]);
  assert.deepEqual(waitingIn(srv, bot), []);

  srv.unhold();
  srv.release(h.rec);
  const runs = await ranAll(srv, bot, 1);
  assert.deepEqual(runs.map((r) => [r.id, r.status, r.steered.length]), [[h.run.id, 'success', 1]], 'no second run for it');
  await sleep(300);
  assert.equal(srv.runs().filter(isRunOf(bot)).length, 1);
});

test('a message that is not steered waits and starts as its own run; one steered but not read before the end starts once, right after', async () => {
  const bot = await makeBot(srv, { name: 'Late Reader', emoji: '🐢' });
  const h = await heldRun(srv, bot, 'A long task');
  const one = (await send(srv, bot, { prompt: 'Steered but never read' })).data;
  const two = (await send(srv, bot, { prompt: 'Not steered' })).data;
  assert.equal((await steer(srv, bot, one.id)).status, 200);
  assert.deepEqual((await botOf(srv, bot)).queued.map((q) => [q.id, q.steering]), [[one.id, true], [two.id, undefined]]);
  srv.unhold();
  srv.release(h.rec);
  const runs = await ranAll(srv, bot, 3);
  const prompts = srv.runs().filter(isRunOf(bot)).map((x) => x.stdin.split('\n')[0]);
  assert.deepEqual(prompts, ['A long task', 'Steered but never read', 'Not steered'], 'each once, the owner\'s in the order sent');
  assert.deepEqual(runs.find((r) => r.id === h.run.id).steered, undefined);
  assert.equal(runs.find((r) => r.id === one.id).prompt, 'Steered but never read', 'under the id it waited with');
});

test('Take back after Steer, before the run read it: the text and files come back and the run never sees it', async () => {
  const bot = await makeBot(srv, { name: 'Taker', emoji: '🫳' });
  const h = await heldRun(srv, bot, 'Work');
  const file = await upload(srv, bot);
  const w = (await send(srv, bot, { prompt: 'Never mind this', attachments: [file] })).data;
  assert.equal((await steer(srv, bot, w.id)).status, 200);
  const back = await takeBack(srv, bot, w.id);
  assert.deepEqual([back.status, back.data.text, back.data.attachments.map((a) => a.file)], [200, 'Never mind this', [file.file]]);
  assert.equal(await toolCall(srv, h.token), null);
  assert.equal((await steer(srv, bot, w.id)).status, 404);
  srv.unhold();
  srv.release(h.rec);
  const [run] = await ranAll(srv, bot, 1);
  assert.equal(run.steered, undefined);
});

test('a run that cannot be steered, or a bot that is free, answers 409 and the message keeps waiting', async (t) => {
  const bot = await makeBot(srv, { name: 'Chief Worker', emoji: '🧑‍💼' });
  // A run the Chief asked for: its reply goes to the Chief.
  srv.hold();
  const byChief = await srv.asChief(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'The Chief asks' } });
  const rec = await srv.nextRun((x) => isRunOf(bot)(x) && x.stdin.startsWith('The Chief asks'));
  const w = (await send(srv, bot, { prompt: 'Mine' })).data;
  const s = await steer(srv, bot, w.id);
  assert.equal(s.status, 409);
  assert.match(s.data.error, /Chief Worker is working on a request of the Chief's/);
  assert.deepEqual((await botOf(srv, bot)).queued.map((q) => [q.id, q.steering]), [[w.id, undefined]]);
  // The Chief's tools may not steer the owner's message.
  assert.equal((await srv.asChief(`/bots/${bot.id}/queued/${w.id}/steer`, { method: 'POST' })).status, 403);
  // No hook is given to such a run.
  assert.ok(!rec.args.includes('--settings'));
  srv.unhold();
  srv.release(rec);
  await ranAll(srv, bot, 2);
  assert.equal(byChief.status, 201);
  // An id the bot does not know.
  assert.equal((await steer(srv, bot, 'nope')).status, 404);
  t.diagnostic('the run the Chief asked for ended, and the message ran as its own run');
});

test('the run is given an http hook, which hands Claude what was steered and says nothing when nothing was', async () => {
  const bot = await makeBot(srv, { name: 'Hooked', emoji: '🪝' });
  const h = await heldRun(srv, bot, 'Work with hooks');
  const at = h.rec.args.indexOf('--settings');
  assert.ok(at > 0, 'a settings file is given');
  const hooks = h.rec.settings?.hooks?.PostToolUse;
  assert.equal(hooks?.length, 1);
  assert.equal(hooks[0].matcher, '*');
  const hook = hooks[0].hooks[0];
  assert.deepEqual([hook.type, new URL(hook.url).hostname, new URL(hook.url).pathname], ['http', '127.0.0.1', '/api/self/session/steer']);
  assert.deepEqual(hook.headers, { 'X-Run-Token': h.token, 'X-Bot-Dot': '1' });
  assert.equal(h.rec.settingsMode, 0o600, 'its key only in a private file');
  assert.ok(!h.rec.args.some((a) => a.includes(h.token)), 'and on no command line');
  // Claude Code posts the call with the tool's output, which can be larger than any body botdot reads.
  const call = { hook_event_name: 'PostToolUse', tool_name: 'Read', tool_response: 'x'.repeat(2e6) };
  assert.deepEqual(await hookCall(h.rec.settings, call), {}, 'nothing steered: nothing said');
  const w = (await send(srv, bot, { prompt: 'Use port 2222' })).data;
  await steer(srv, bot, w.id);
  const out = await hookCall(h.rec.settings, call);
  assert.deepEqual(Object.keys(out), ['hookSpecificOutput']);
  assert.equal(out.hookSpecificOutput.hookEventName, 'PostToolUse');
  assert.ok(out.hookSpecificOutput.additionalContext.includes('Use port 2222'));
  assert.deepEqual(await hookCall(h.rec.settings, call), {}, 'read once');
  srv.unhold();
  srv.release(h.rec);
  await ranAll(srv, bot, 1);
});

test('a later run is told what the owner steered into an earlier one', async () => {
  const bot = await makeBot(srv, { name: 'Rememberer', emoji: '🧠' });
  srv.reply('First done.');
  const h = await heldRun(srv, bot, 'The first task');
  const w = (await send(srv, bot, { prompt: 'Also tidy the logs' })).data;
  await steer(srv, bot, w.id);
  await toolCall(srv, h.token);
  srv.unhold();
  srv.release(h.rec);
  await ranAll(srv, bot, 1);
  await send(srv, bot, { prompt: 'What did I ask?' });
  const rec = await srv.nextRun((x) => isRunOf(bot)(x) && x.stdin.startsWith('What did I ask?'));
  assert.match(rec.system, /The first task\nWhile you worked, the owner also wrote \(\d{4}-\d{2}-\d{2}[^)]*\):\nAlso tidy the logs\nYou replied:\nFirst done\./);
  await ranAll(srv, bot, 2);
});

test('after a restart a steered message that was not read is not lost and not delivered twice', async () => {
  let s2 = await startServer();
  try {
    const bot = await makeBot(s2, { name: 'Restarted', emoji: '🔁' });
    const h = await heldRun(s2, bot, 'Cut off');
    const w = (await send(s2, bot, { prompt: 'Steered before the restart' })).data;
    assert.equal((await steer(s2, bot, w.id)).status, 200);
    await s2.stop();
    s2.unhold();
    s2 = await restartServer(s2);
    const runs = await ranAll(s2, bot, 2);
    assert.deepEqual(runs.map((r) => [r.id, r.status]).sort(), [[h.run.id, 'interrupted'], [w.id, 'success']].sort());
    await sleep(300);
    assert.equal((await runsOf(s2, bot)).length, 2);
  } finally { s2.unhold(); await s2.stop(); }
});

test('after a restart a message the run read stays read: it starts nothing, and Steer, Take back and its key find that run', async () => {
  let s2 = await startServer();
  try {
    const bot = await makeBot(s2, { name: 'Read Before', emoji: '📖' });
    const h = await heldRun(s2, bot, 'Cut off after reading');
    const w = (await send(s2, bot, { prompt: 'Read before the restart', key: 'read-key-1' })).data;
    const waited = waitingIn(s2, bot);
    assert.equal((await steer(s2, bot, w.id)).status, 200);
    assert.match(await toolCall(s2, h.token), /Read before the restart/);
    await s2.stop();
    s2.unhold();
    // A crash after the run's record was written and before the queue was: the message is in both.
    s2 = await restartServer(s2, (data) => setQueue(data, (q) => { q.queues[bot.id] = waited.map((x) => ({ ...x, steering: h.run.id })); }));
    const runs = await ranAll(s2, bot, 1);
    assert.deepEqual(runs.map((r) => [r.id, r.status, r.steered.map((x) => x.id)]), [[h.run.id, 'interrupted', [w.id]]]);
    assert.deepEqual((await botOf(s2, bot)).queued, []);
    assert.deepEqual([(await steer(s2, bot, w.id)).status, (await takeBack(s2, bot, w.id)).status], [409, 409]);
    const again = await send(s2, bot, { prompt: 'Read before the restart', key: 'read-key-1' });
    assert.deepEqual([again.status, again.data.id], [200, h.run.id]);
    await sleep(300);
    assert.equal((await runsOf(s2, bot)).length, 1);
  } finally { s2.unhold(); await s2.stop(); }
});
