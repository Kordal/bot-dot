// A run that was ended keeps who ended it (BUSY-003, ADR 012; docs/api.md "Who ended it"): `endedBy`, with the
// status and the sentence that go with it, in the run, the list of runs and the feed. The owner's and the Chief's
// Stop make a run `stopped`; a sign-out of Claude makes it a run that failed, which is passed on to the Chief's
// chat that started it, keeps its connected-app card and can carry on after an OK. The limit is in
// test/run-limit.test.js, Stop in a Chief chat in test/chief-stop.test.js.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, restartServer, makeBot, heldRun, feed, waitFor, fakeConnectedApp, connectorEnv } = require('./helpers');
const { rpcClient } = require('./memory-helpers');
const { friendlyProblem, ENDED, REPLY_ENDED } = require('../lib/problems');
const { whatCarriesOn } = require('../lib/asks');

const OWNER = 'You stopped this run before it finished.';
const CHIEF = 'The Chief stopped this run before it finished.';
const SIGNOUT = 'This run was stopped because Claude was signed out.';
const IDLE = 'I stopped because nothing happened for 20 minutes: I seemed stuck. Send it again, or break it into smaller pieces.';
const LIMIT = 'I stopped after 4 hours: this took too long. Send it again, or break it into smaller pieces.';
const MAIL = { recipient_email: 'anna@example.com', subject: 'Running late', body: 'I will be late.' };

let app; let srv; let f;
before(async () => {
  app = await fakeConnectedApp();
  srv = await startServer({ env: app.env });
  await app.connect(srv);
  f = feed(srv);
  await f.wait('hello');
});
after(async () => { f?.close(); await srv.stop(); app.close(); });

const isRunOf = (bot) => (x) => x.args.includes(`${bot.emoji} ${bot.name}`);
const chatOf = async (id) => (await srv.api(`/chief/chats/${id}`)).data;
// The run as each of the three places gives it: the run itself, the list of runs and the feed's `run_finished`.
async function everywhere(run) {
  const one = await srv.finished(run.id);
  const listed = (await srv.api(`/runs?botId=${one.botId}`)).data.find((r) => r.id === run.id);
  const event = (await f.wait('run_finished', (d) => d.id === run.id)).data;
  return { one, listed, event };
}
const said = ({ one, listed, event }) => [one, listed, event].map((r) => [r.status, r.endedBy, r.problem]);
const thrice = (status, by, problem) => [[status, by, problem], [status, by, problem], [status, by, problem]];
// A run of the bot that waits for the owner's OK on an action in a connected app, and the asks of its bot.
async function waitingForOk(t, bot) {
  const r = await heldRun(srv, bot);
  const tools = rpcClient(t, 'connectors-mcp.js', connectorEnv(srv, r.token));
  const call = tools.call('connector_run', { app: 'gmail', action: 'GMAIL_SEND_EMAIL', arguments: MAIL }).catch(() => null);
  const cards = async () => (await srv.api('/asks')).data.filter((a) => a.botId === bot.id);
  await waitFor(async () => (await cards()).length, { what: 'the card of the action' });
  return { ...r, call, cards };
}

test('the sentences, word for word', () => {
  assert.deepEqual(ENDED, { owner: OWNER, chief: CHIEF, signout: SIGNOUT, idle: IDLE, limit: LIMIT });
  assert.deepEqual(REPLY_ENDED, { owner: 'You stopped this reply.', signout: 'This reply was stopped because Claude was signed out.', idle: IDLE, limit: LIMIT });
  assert.equal(friendlyProblem({ status: 'stopped', endedBy: 'owner' }), OWNER);
  assert.equal(friendlyProblem({ status: 'stopped', endedBy: 'chief' }), CHIEF);
  assert.equal(friendlyProblem({ status: 'error', endedBy: 'signout', error: 'Claude is not logged in' }), SIGNOUT, 'not the sentence of a run that started signed out');
  assert.equal(friendlyProblem({ status: 'error', endedBy: 'limit', error: 'max turns' }), LIMIT);
  assert.equal(friendlyProblem({ status: 'error', endedBy: 'idle', error: 'max turns' }), IDLE);
  // A run from before botdot kept who, and one that names somebody this botdot does not know.
  assert.equal(friendlyProblem({ status: 'stopped' }), OWNER);
  assert.equal(friendlyProblem({ status: 'stopped', endedBy: 'someone' }), OWNER);
  assert.equal(friendlyProblem({ status: 'interrupted' }), 'This run was cut off because botdot was restarted.');
});

test('the features name it', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('ended-by'));
});

test('a run the owner stopped: stopped, endedBy owner, in the run, the list and the feed; a run that ended by itself names nobody', async () => {
  const bot = await makeBot(srv, { name: 'Owner Stops', emoji: '🛑' });
  const r = await heldRun(srv, bot);
  assert.equal((await srv.api(`/runs/${r.run.id}?events=0`)).data.endedBy, undefined, 'nobody yet');
  assert.deepEqual((await srv.api(`/runs/${r.run.id}/stop`, { method: 'POST' })).data, { ok: true });
  assert.deepEqual(said(await everywhere(r.run)), thrice('stopped', 'owner', OWNER));
  srv.unhold();
  const fine = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Once more' } })).data;
  const ended = await everywhere(fine);
  assert.deepEqual([ended.one.status, 'endedBy' in ended.one, 'endedBy' in ended.listed, 'endedBy' in ended.event], ['success', false, false, false]);
});

test("a run the Chief's stop_run stopped: stopped, endedBy chief, and for the three rules as one the owner stopped", async (t) => {
  const bot = await makeBot(srv, { name: 'Chief Stops', emoji: '✋', connectors: ['gmail'] });
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  // The Chief started it from a chat, and it waits for the owner's OK on an action in a connected app.
  srv.hold();
  const run = (await srv.asChief(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Send the mail' }, headers: { 'X-Chief-Chat': chat.id } })).data;
  const rec = await srv.nextRun(isRunOf(bot), 'the run');
  const tools = rpcClient(t, 'connectors-mcp.js', connectorEnv(srv, rec.self.env.RUN_TOKEN));
  tools.call('connector_run', { app: 'gmail', action: 'GMAIL_SEND_EMAIL', arguments: MAIL }).catch(() => null);
  const cards = async () => (await srv.api('/asks')).data.filter((a) => a.botId === bot.id);
  await waitFor(async () => (await cards()).length, { what: 'the card of the action' });
  // stop_run, as the Chief's tools call it.
  assert.deepEqual((await srv.asChief(`/runs/${run.id}/stop`, { method: 'POST' })).data, { ok: true });
  const ended = await everywhere(run);
  assert.deepEqual(said(ended), thrice('stopped', 'chief', CHIEF));
  // Not passed on to the chat that started it, its card goes, and it never carries on (ADR 012).
  assert.equal(ended.event.passedOn, undefined);
  assert.deepEqual(await cards(), []);
  const now = await chatOf(chat.id);
  assert.deepEqual([now.busy, now.messages.length], [false, 0], 'the Chief gets no turn for it, and no message of the bot is posted');
  srv.unhold();
});

test('the rule of what carries on after an OK: a run a sign-out or the limit ended does, a run the owner or the Chief stopped does not', () => {
  const now = Date.parse('2026-10-06T12:00:00.000Z');
  const ago = (minutes) => new Date(now - minutes * 60e3).toISOString();
  const bot = { id: 'b1', name: 'Coder', jobs: [] };
  const carries = (fields) => {
    const run = { id: 'r1', botId: 'b1', trigger: 'manual', prompt: 'Check the PRs', startedAt: ago(10), ...fields };
    return whatCarriesOn({ ask: { kind: 'permission', botId: 'b1', permission: 'commands', at: ago(9), runs: [{ id: 'r1', at: ago(9) }] }, bot, stopped: { r1: run }, now }).map((x) => `${x.who}:${x.run.id}`);
  };
  assert.deepEqual(carries({ status: 'error', endedBy: 'signout' }), ['owner:r1']);
  assert.deepEqual(carries({ status: 'error', endedBy: 'limit' }), ['owner:r1']);
  assert.deepEqual(carries({ status: 'stopped', endedBy: 'owner' }), []);
  assert.deepEqual(carries({ status: 'stopped', endedBy: 'chief' }), []);
});

test('Stop on a run that still waits to start takes it away: it never starts, and its key is free again', async () => {
  const bot = await makeBot(srv, { name: 'Waits', emoji: '⏳' });
  const first = await heldRun(srv, bot, 'The first');
  const key = 'k-ended-by-0001';
  const waiting = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'The second', key } })).data;
  const asked = (await srv.asChief(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: "The Chief's" } })).data;
  assert.deepEqual([waiting.status, asked.status], ['queued', 'queued']);
  // The owner's waiting message is the owner's: the Chief's stop_run does not take it.
  assert.equal((await srv.asChief(`/runs/${waiting.id}/stop`, { method: 'POST' })).status, 404);
  assert.deepEqual((await srv.api(`/bots/${bot.id}`)).data.queued.map((q) => q.id), [waiting.id]);
  // The owner's Stop does, and the Chief's takes what the Chief asked for.
  const gone = await srv.api(`/runs/${waiting.id}/stop`, { method: 'POST' });
  assert.deepEqual([gone.status, gone.data], [200, { ok: true }]);
  assert.deepEqual((await srv.asChief(`/runs/${asked.id}/stop`, { method: 'POST' })).data, { ok: true });
  assert.deepEqual((await f.wait('queued', (d) => d.botId === bot.id && !d.queued.length)).data.queued, []);
  for (const id of [waiting.id, asked.id]) {
    assert.equal((await srv.api(`/runs/${id}`)).status, 404, 'no run is left of it');
    assert.equal((await srv.api(`/runs/${id}/stop`, { method: 'POST' })).status, 404, 'and a second Stop finds none');
  }
  // The run that was going ends: nothing starts behind it.
  srv.release(first.rec);
  await srv.finished(first.run.id);
  srv.unhold();
  const again = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'The second', key } })).data;
  assert.notEqual(again.id, waiting.id, 'the same key is a new message');
  assert.equal(again.again, undefined);
  await srv.finished(again.id);
  assert.deepEqual((await srv.api(`/runs?botId=${bot.id}`)).data.map((r) => r.prompt).sort(), ['The first', 'The second']);
});

test("with a message of the owner waiting for a bot, Stop on its run starts that message at once", async () => {
  const bot = await makeBot(srv, { name: 'Next Up', emoji: '⏭️' });
  const first = await heldRun(srv, bot, 'The long one');
  const waiting = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'And this' } })).data;
  assert.equal(waiting.status, 'queued');
  await srv.api(`/runs/${first.run.id}/stop`, { method: 'POST' });
  const rec = await srv.nextRun((x) => isRunOf(bot)(x) && x.stdin.startsWith('And this'), 'the waiting message to start');
  assert.equal((await srv.finished(first.run.id)).endedBy, 'owner');
  assert.equal((await srv.api(`/runs/${waiting.id}?events=0`)).data.status, 'running');
  srv.release(rec);
  assert.equal((await srv.finished(waiting.id)).status, 'success');
  srv.unhold();
});

// The last three end every run of this server, the third the server itself.
test('a sign-out that comes as a run ends by itself, its reply whole, ended nothing; a Stop makes it stopped all the same', async () => {
  const bot = await makeBot(srv, { name: 'Just Done', emoji: '🏁' });
  // The stand-in does not end when asked to, and then ends by itself with its reply.
  fs.writeFileSync(path.join(srv.out, 'ignore-term'), '');
  try {
    const whole = await heldRun(srv, bot, 'Nearly done');
    await srv.api('/setup/claude', { method: 'DELETE' });
    srv.release(whole.rec);
    const ended = await srv.finished(whole.run.id);
    assert.deepEqual([ended.status, ended.result, 'endedBy' in ended, 'problem' in ended], ['success', 'Done.', false, false]);
    const stopped = await heldRun(srv, bot, 'Nearly done too');
    await srv.api(`/runs/${stopped.run.id}/stop`, { method: 'POST' });
    srv.release(stopped.rec);
    const after = await srv.finished(stopped.run.id);
    assert.deepEqual([after.status, after.endedBy], ['stopped', 'owner']);
  } finally { fs.rmSync(path.join(srv.out, 'ignore-term'), { force: true }); srv.unhold(); }
});

test('a sign-out of Claude: the runs are failed runs with endedBy signout, the Chief\'s chat is told without a turn, the card stays, and a reply says so', async (t) => {
  const own = await makeBot(srv, { name: 'Signed Out', emoji: '🚪', connectors: ['gmail'] });
  const asked = await makeBot(srv, { name: 'Asked Bot', emoji: '📮' });
  // The owner's run waits for an OK; the Chief's run was started from a chat whose reply is still going.
  const waits = await waitingForOk(t, own);
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Have Asked Bot look' } });
  await srv.nextRun((x) => !!x.botdot && x.stdin.includes('Have Asked Bot look'), 'the Chief turn');
  const run = (await srv.asChief(`/bots/${asked.id}/run`, { method: 'POST', body: { prompt: 'Look' }, headers: { 'X-Chief-Chat': chat.id } })).data;
  await srv.nextRun(isRunOf(asked), "the Chief's run");
  // The stand-in Claude stays signed in, so the route answers that it could not sign out: what was going is ended all the same.
  await srv.api('/setup/claude', { method: 'DELETE' });
  const mine = await everywhere(waits.run);
  const theirs = await everywhere(run);
  assert.deepEqual(said(mine), thrice('error', 'signout', SIGNOUT));
  assert.deepEqual(said(theirs), thrice('error', 'signout', SIGNOUT));
  assert.equal(mine.one.error, SIGNOUT, "the run's own error where it brought none");
  // The card stays for a late yes, as for any run that failed (ADR 010).
  const [card] = await waits.cards();
  assert.deepEqual([card.held, typeof card.stoppedAt], [false, 'string']);
  // The reply that was going says who ended it, and is a failed reply, not a stopped one.
  const now = await waitFor(async () => { const c = await chatOf(chat.id); return !c.busy && !c.messages.some((m) => m.pending) ? c : null; }, { what: 'the reply to end' });
  const reply = now.messages.find((m) => m.role === 'chief');
  assert.deepEqual([reply.error, reply.stopped], ['This reply was stopped because Claude was signed out.', undefined]);
  assert.equal((await f.wait('chief_reply', (d) => d.chatId === chat.id && !d.from)).data.status, 'error');
  // The Chief's run is passed on to the chat that started it, as the bot's own message: the Chief takes no turn while signed out.
  assert.equal(theirs.event.passedOn, true);
  assert.deepEqual(now.messages.map((m) => m.role), ['user', 'chief', 'report']);
  const report = now.messages.at(-1);
  assert.deepEqual([report.from.id, report.runId, report.text, report.error], [asked.id, run.id, SIGNOUT, true]);
  // The owner's late yes on the card starts the bot again on the work the sign-out ended (ADR 009, ADR 010).
  srv.unhold();
  assert.equal((await srv.api(`/asks/${card.id}`, { method: 'POST', body: { yes: true } })).data.ok, true);
  const next = await waitFor(async () => (await srv.api(`/runs?botId=${own.id}`)).data.find((x) => x.continues === waits.run.id), { what: 'the run that carries on' });
  assert.equal((await srv.finished(next.id)).status, 'success');
});

test('a run cut off by a restart keeps its sentence and names nobody', async () => {
  const bot = await makeBot(srv, { name: 'Cut Off', emoji: '✂️' });
  const r = await heldRun(srv, bot);
  f.close();
  srv = await restartServer(srv);
  const one = (await srv.api(`/runs/${r.run.id}?events=0`)).data;
  assert.deepEqual([one.status, one.problem, 'endedBy' in one], ['interrupted', 'This run was cut off because botdot was restarted.', false]);
});
