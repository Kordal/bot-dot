// What waits for a bot (BUSY-001, ADR 011), where no request reaches it: a bot can be deleted only while no run of
// it is going, and a waiting message whose turn came always finds its run startable through the API. So this file
// loads lib/bots.js itself, on a scratch data folder and the stand-in for Claude: a deleted bot takes its waiting
// work with it, and a message that cannot start is a failed run with its sentence, not a console line.
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-waits-'));
const out = path.join(dir, 'fake');
fs.mkdirSync(out);
Object.assign(process.env, {
  BOT_DOT_DATA: path.join(dir, 'data'), BOT_DOT_VAULT_KEY_FILE: path.join(dir, 'vault.key'), BOT_DOT_SEPARATE_USERS: '0',
  CLAUDE_BIN: path.join(__dirname, 'fixtures', 'fake-claude.js'), FAKE_OUT: out, HOME: path.join(dir, 'home'),
});
fs.mkdirSync(process.env.HOME);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { waitFor } = require('./helpers');
const B = require('../lib/bots');
const feed = require('../lib/events');

const queueFile = () => JSON.parse(fs.readFileSync(path.join(B.DATA_DIR, 'queue.json'), 'utf8')).queues;
const ended = (id) => waitFor(() => { const m = B.readMeta(id); return m && m.status !== 'running' ? m : null; }, { what: `run ${id} to end` });
const hold = () => fs.writeFileSync(path.join(out, 'hold'), '');
const letGo = () => fs.rmSync(path.join(out, 'hold'), { force: true });
after(() => { letGo(); B.stopAllRuns(); fs.rmSync(dir, { recursive: true, force: true }); });

test('a bot that is deleted takes its waiting messages with it', async () => {
  const bot = B.bots.create({ name: 'Short Lived', emoji: '🫧', prompt: 'Do the task.' });
  const other = B.bots.create({ name: 'Stays', emoji: '🪨', prompt: 'Do the task.' });
  hold();
  const first = B.askBot(bot, { prompt: 'Something long' }).run;
  const kept = B.askBot(other, { prompt: 'Something long' }).run;
  const mine = B.askBot(bot, { prompt: "The owner's message" }).queued;
  const chiefs = B.askBot(bot, { prompt: "The Chief's task", by: 'chief' }).queued;
  const others = B.askBot(other, { prompt: 'For the other bot' }).queued;
  assert.deepEqual([mine.status, chiefs.status, others.status], ['queued', 'queued', 'queued']);
  assert.deepEqual(queueFile()[bot.id].map((x) => x.runId), [mine.id, chiefs.id]);
  // Who waits for its run is told that it is gone.
  let told = 0;
  B.onLeftQueue(mine.id, () => { told++; });

  // Its run is stopped, as the owner does before deleting it, and the bot is deleted in the moment its run has
  // ended and the next waiting work has not started (a run's end is told here before the queue goes on).
  let removed = null;
  B.onRunEnded((meta) => { if (meta.id === first.id) removed = B.bots.remove(bot.id); });
  B.stopRun(first.id);
  await ended(first.id);
  B.onRunEnded(null);
  assert.equal(removed, true);
  assert.equal(B.isBotRunning(bot.id), false);
  assert.deepEqual([B.queuedOf(bot.id), B.waitingRun(mine.id), B.waitingRun(chiefs.id)], [[], null, null]);
  assert.deepEqual(Object.keys(queueFile()), [other.id], 'gone from disk too; the other bot keeps what waits for it');
  assert.equal(told, 1);
  // Nothing of it starts afterwards.
  letGo();
  await ended(kept.id);
  await ended(others.id);
  assert.deepEqual([B.readMeta(mine.id), B.readMeta(chiefs.id)], [null, null]);
  assert.deepEqual(queueFile(), {});
});

test("other work that comes up in the moment between two runs waits behind the owner's message", async () => {
  // A run has ended and the queue has not gone on yet: the bot is free. A memory review asked for just then
  // does not start in that gap: the owner's oldest message does, and the review waits its turn.
  const bot = B.bots.create({ name: 'In The Gap', emoji: '⏱️', prompt: 'Do the task.' });
  hold();
  const first = B.askBot(bot, { prompt: 'Something long' }).run;
  const mine = B.askBot(bot, { prompt: "The owner's message" }).queued;
  let asked = null;
  B.onRunEnded((meta) => { if (meta.id === first.id) asked = B.startReview(B.bots.get(bot.id)); });
  B.stopRun(first.id);
  await ended(first.id);
  B.onRunEnded(null);
  assert.equal(asked.queued, true, 'it did not start in the gap');
  assert.equal(B.readMeta(mine.id).status, 'running', "the owner's message started");
  assert.deepEqual(queueFile()[bot.id].map((x) => x.kind), ['review']);
  letGo();
  const [message, review] = [await ended(mine.id), await waitFor(() => B.listRuns({ botId: bot.id }).find((r) => r.trigger === 'review' && r.status !== 'running'), { what: 'the review to end' })];
  assert.ok(review.startedAt >= message.endedAt, 'the review ran after it');
});

test('a waiting message that cannot start is a failed run with its sentence', async () => {
  const bot = B.bots.create({ name: 'Blocked', emoji: '🧱', prompt: 'Do the task.' });
  const events = [];
  const unsub = feed.subscribe((ev) => { if (ev.data?.botId === bot.id) events.push(ev); });
  hold();
  const before = fs.readdirSync(out).filter((f) => f.startsWith('run-')).length;
  const first = B.askBot(bot, { prompt: 'Something long' }).run;
  const mine = B.askBot(bot, { prompt: 'What comes next?' }).queued;
  const after_ = B.askBot(bot, { prompt: 'And then?' }).queued;
  // Its workspace cannot be used when its turn comes: no run can be made in it. (Once the first run's process is
  // there: it was started in that folder.)
  await waitFor(() => fs.readdirSync(out).filter((f) => f.startsWith('run-')).length >= before + 1, { what: 'the first run to be going' });
  const workspace = path.join(B.DATA_DIR, 'workspaces', bot.id);
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.writeFileSync(workspace, 'not a folder');
  letGo();
  await ended(first.id);
  const failed = await ended(mine.id);
  assert.deepEqual([failed.id, failed.status, failed.trigger, failed.prompt, failed.sentAt], [mine.id, 'error', 'manual', 'What comes next?', mine.queuedAt]);
  assert.match(failed.error, /^It didn't start: /);
  assert.equal(failed.notificationAudience, 'owner');
  // Announced as a run that ended, and it left the list; the next message got its turn (and failed the same).
  const second = await ended(after_.id);
  assert.equal(second.status, 'error');
  assert.deepEqual(events.filter((e) => e.type === 'run_finished').map((e) => [e.data.id, e.data.status]).slice(-2), [[mine.id, 'error'], [after_.id, 'error']]);
  assert.deepEqual(B.queuedOf(bot.id), []);
  assert.equal(queueFile()[bot.id], undefined);
  unsub();
});

test('work that could not be written to the queue file does not wait in memory either: sent again, it runs once', async () => {
  const bot = B.bots.create({ name: 'Disk Full', emoji: '💾', prompt: 'Do the task.' });
  hold();
  const first = B.askBot(bot, { prompt: 'Something long' }).run;
  // The queue file cannot be written: a folder stands where it is.
  const file = path.join(B.DATA_DIR, 'queue.json');
  fs.rmSync(file, { force: true });
  fs.mkdirSync(file);
  assert.throws(() => B.askBot(bot, { prompt: 'Did this arrive?' }));
  assert.deepEqual(B.queuedOf(bot.id), [], 'nothing of it waits');
  fs.rmSync(file, { recursive: true });
  for (const tmp of fs.readdirSync(B.DATA_DIR).filter((f) => /^queue\.json\..*\.tmp$/.test(f))) fs.rmSync(path.join(B.DATA_DIR, tmp));
  // The owner sends it again: it waits once, and runs once.
  const again = B.askBot(bot, { prompt: 'Did this arrive?' }).queued;
  assert.deepEqual([B.queuedOf(bot.id).map((x) => x.id), queueFile()[bot.id].map((x) => x.runId)], [[again.id], [again.id]]);
  letGo();
  await ended(first.id);
  await ended(again.id);
  assert.deepEqual(B.listRuns({ botId: bot.id }).map((r) => r.prompt).sort(), ['Did this arrive?', 'Something long']);
  assert.deepEqual(queueFile(), {});
});

// With the sign-in everything that waited goes on, each bot by itself (BUSY-010, claudeIs): a bot whose queue
// cannot be started keeps no other bot's waiting message, and not the Chief's held messages (onClaudeBack), waiting.
test("at the sign-in a bot whose queue cannot be started keeps no other bot's message, and not the Chief's, from starting", async (t) => {
  const [broken, other] = ['Breaks', 'Goes On'].map((name) => B.bots.create({ name, emoji: '⏳', prompt: 'Do the task.' }));
  hold();
  const firsts = [broken, other].map((bot) => B.askBot(bot, { prompt: 'Something long' }).run);
  const [lost, mine] = [broken, other].map((bot) => B.askBot(bot, { prompt: 'And this' }).queued);
  B.claudeIs(false);
  t.after(() => B.claudeIs(true));
  letGo();
  for (const run of firsts) { B.stopRun(run.id); await ended(run.id); }
  assert.deepEqual([B.isClaudeOut(), B.queuedOf(broken.id).map((x) => x.id), B.queuedOf(other.id).map((x) => x.id)], [true, [lost.id], [mine.id]], 'held while signed out');

  // The first bot's turn fails where nothing catches it: whoever waited for its message to leave the list throws.
  B.onLeftQueue(lost.id, () => { throw new Error('nobody home'); });
  let chief = 0;
  B.onClaudeBack(() => { chief += 1; });
  const logged = t.mock.method(console, 'error', () => {});
  B.claudeIs(true);
  assert.deepEqual(B.queuedOf(other.id), [], "the other bot's message got its turn");
  assert.equal(chief, 1, "and the Chief's held messages theirs");
  assert.deepEqual(logged.mock.calls.map((c) => c.arguments[0]), [`[scheduler] ${broken.id}: nobody home`]);
  logged.mock.restore();
  assert.equal((await ended(mine.id)).status, 'success');
  await ended(lost.id);
});
