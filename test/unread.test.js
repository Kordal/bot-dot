// Read positions and new replies (lib/read.js, ADR 005): what counts as new, how a chat becomes read,
// and that the positions survive a restart, a backup and a restore.
// The data is the milestone's: eight bots in three groups with two pinned, and thirty runs across them,
// with quiet, failed and bot-to-bot runs.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, makeBot, heldRun, self, feed, sleep, waitFor } = require('./helpers');
const readLib = require('../lib/read');
const { runCounts, runAt, messageCounts, unreadOf } = readLib;

const REPORT_MS = 1500; // how long a report counts here (15 s in the product)
const ENV = { BOT_DOT_READ_REPORT_MS: String(REPORT_MS) };
const T0 = Date.now() - 2 * 3600_000; // where the read positions start, once the test moves them back
const at = (minutes) => new Date(T0 + minutes * 60_000).toISOString();

let srv;
let bots; // the eight, in the order of TEAM
const positionsFile = () => path.join(srv.data, 'read-positions.json');
const positions = () => JSON.parse(fs.readFileSync(positionsFile(), 'utf8'));
const unreadNow = async (s = srv) => Object.fromEntries((await s.api('/bots')).data.map((b) => [b.name, b.unread]));
// An app's report of the chat it shows (null: none), as the web page, the phone and the Mac send it.
const read = (chat, app = 'web-1', s = srv) => s.api('/read', { method: 'POST', body: { app, chat } });
const chiefUnread = async (s = srv) => { const c = (await s.api('/chief')).data; return [c.unread, ...c.chats.map((x) => [x.id, x.unread, x.firstUnread])]; };

const TEAM = [
  { name: 'Answers', group: 'Home', pinned: true },
  { name: 'Many', group: 'Home', pinned: true },
  { name: 'Quiet', group: 'Home' },
  { name: 'Reports', group: 'Work' },
  { name: 'Teammate', group: 'Work' },
  { name: 'Failing', group: 'Work' },
  { name: 'Script', group: 'Lab' },
  { name: 'Mixed', group: 'Lab' },
];

// The thirty runs, as botdot keeps them (data/runs/<id>.json). `n`: minutes after T0.
function seedRuns() {
  const dir = path.join(srv.data, 'runs');
  const ids = {}; // bot name -> the ids of its runs, oldest first
  let count = 0;
  const put = (botName, n, fields) => {
    const bot = bots.find((b) => b.name === botName);
    const id = `seed-${String(++count).padStart(2, '0')}`;
    const meta = { id, botId: bot.id, botName: bot.name, kind: 'ai', trigger: 'manual', status: 'success', prompt: 'p', customPrompt: true, startedAt: at(n), endedAt: at(n + 0.5), result: 'An answer.', error: null, notificationAudience: 'owner', ...fields };
    fs.writeFileSync(path.join(dir, `${id}.json`), JSON.stringify(meta));
    (ids[botName] ||= []).push(id);
  };
  const scheduled = { trigger: 'schedule', notify: 'report-only', jobId: 'j1', jobName: 'Morning check', customPrompt: false };
  const fromBot = { trigger: 'bot', fromBot: { id: bots[0].id, name: bots[0].name }, notificationAudience: 'internal' };
  for (const n of [1, 2, 3]) put('Answers', n, {}); // answers to the owner
  for (const n of [1, 2, 3, 4, 5]) put('Many', n, {});
  for (const n of [1, 2, 3, 4]) put('Quiet', n, { ...scheduled, reporting: 'quiet', result: '' }); // nothing to say
  put('Reports', 1, { ...scheduled, reporting: 'delivered', ownerReport: { message: 'Your parcel arrived.', urgent: false }, result: 'Your parcel arrived.' });
  put('Reports', 2, { ...scheduled, reporting: 'held', ownerReport: { message: 'Later.', urgent: false }, result: 'Later.' }); // waits for the morning
  put('Reports', 3, { ...scheduled, reporting: 'suppressed', ownerReport: { message: 'Nothing new.', urgent: false }, result: '' });
  put('Reports', 4, { ...scheduled, reporting: 'delivered', ownerReport: { message: 'It rains at 5.', urgent: true }, result: 'It rains at 5.' });
  for (const n of [1, 2, 3]) put('Teammate', n, fromBot); // another bot's message started it
  put('Teammate', 4, { startedBy: 'chief', notificationAudience: 'internal' }); // the Chief handed it a task
  put('Teammate', 5, { ...fromBot, status: 'error', error: 'boom', result: null }); // failed, and still not the owner's
  put('Failing', 1, { status: 'error', error: 'boom', result: null });
  put('Failing', 2, { ...scheduled, status: 'interrupted', result: null });
  put('Failing', 3, { status: 'stopped', result: null });
  put('Script', 1, { kind: 'script', trigger: 'schedule', jobId: 'j2', jobName: 'Disk check', customPrompt: false, result: 'disk 91% full' });
  put('Script', 2, { trigger: 'review', jobId: 'memory-review', jobName: 'Memory review', customPrompt: false }); // housekeeping
  put('Script', 3, { status: 'running', endedAt: null, result: null }); // cut off by the restart: it becomes a failed run
  put('Mixed', -60, {}); // before the read position
  put('Mixed', 1, { trigger: 'replies', notificationAudience: 'internal' }); // its teammates' answers came in
  put('Mixed', 2, { ...scheduled, notify: 'always', result: 'Three new articles.' }); // a run from before reports were staged
  assert.equal(count, 30);
  // And a Chief chat with one reply.
  fs.writeFileSync(path.join(srv.data, 'chief', `${OLD_CHAT}.json`), JSON.stringify({ id: OLD_CHAT, title: 'Earlier', sessionId: null, createdAt: at(1), updatedAt: at(2), costUsd: 0,
    messages: [{ role: 'user', text: 'Anything new?', at: at(1) }, { role: 'chief', text: 'All is well.', at: at(1), endedAt: at(2) }] }));
  return ids;
}

const OLD_CHAT = '20260101000000-seeded';
let seeded;
before(async () => {
  srv = await startServer({ env: ENV });
  bots = [];
  for (const t of TEAM) bots.push(await makeBot(srv, { ...t }));
  // Quiet hours nearly all day, so the held report stays held for the whole test.
  const hour = new Date().getUTCHours();
  await srv.api('/settings', { method: 'PUT', body: { quietHours: { start: hour, end: (hour + 23) % 24, timeZone: 'UTC' } } });
  await srv.stop();
  seeded = seedRuns();
  fs.rmSync(positionsFile()); // as before this change: runs, and no read positions yet
  srv = await startServer({ dir: srv.dir, env: ENV });
});
after(() => srv?.stop());

test('the rule: what counts as a new reply', () => {
  const run = { kind: 'ai', trigger: 'manual', status: 'success', result: 'Hi', notificationAudience: 'owner' };
  assert.equal(runCounts(run), true);
  assert.equal(runCounts({ ...run, status: 'running' }), false);
  assert.equal(runCounts({ ...run, status: 'error' }), true, 'a failed run counts');
  // A scheduled job's failure is new once per row of failures (BUSY-004): the first, not the ones after it.
  const failed = { ...run, trigger: 'schedule', status: 'error', jobId: 'j1', result: null, error: 'boom', endedAt: '2026-01-01T23:00:00.000Z' };
  assert.equal(runCounts(failed), true, 'the first of a row');
  assert.equal(runCounts({ ...failed, reporting: 'quiet' }), false, 'a later one of the row');
  assert.equal(runCounts({ ...failed, reporting: 'held' }), false, 'the first, held at night');
  assert.deepEqual([runCounts({ ...failed, reporting: 'delivered', deliveredAt: '2026-01-02T07:00:00.000Z' }), runAt({ ...failed, reporting: 'delivered', deliveredAt: '2026-01-02T07:00:00.000Z' })], [true, '2026-01-02T07:00:00.000Z'], 'new from the morning');
  assert.equal(runCounts({ ...run, trigger: 'bot', fromBot: { id: 'x' }, notificationAudience: undefined }), false, 'bot to bot, also for runs from before the audience was kept');
  assert.equal(runCounts({ ...run, startedBy: 'chief', notificationAudience: undefined }), false);
  assert.equal(runCounts({ ...run, trigger: 'schedule', result: '' }), false, 'quiet');
  assert.equal(runCounts({ ...run, trigger: 'review' }), false);
  assert.equal(messageCounts({ role: 'chief', text: 'Hi' }), true);
  assert.equal(messageCounts({ role: 'chief', pending: true }), false);
  assert.equal(messageCounts({ role: 'report', text: 'Booked.' }), true, "a bot's reply posted in the Chief chat");
  assert.equal(messageCounts({ role: 'user', text: 'Hi' }), false);
  assert.equal(messageCounts({ role: 'suggestion', status: 'pending' }), false);
  // A report held overnight is quiet until it is delivered, and new from then.
  const held = { ...run, trigger: 'schedule', notify: 'report-only', reporting: 'held', ownerReport: { message: 'Hi' }, endedAt: '2026-01-01T23:00:00.000Z' };
  assert.equal(runCounts(held), false);
  const delivered = { ...held, reporting: 'delivered', deliveredAt: '2026-01-02T07:00:00.000Z' };
  assert.deepEqual([runCounts(delivered), runAt(delivered)], [true, '2026-01-02T07:00:00.000Z']);
  // The first new reply is the topmost in the chat, whenever it arrived.
  assert.deepEqual(unreadOf([{ id: 'b', at: '3', place: '2' }, { id: 'a', at: '4', place: '1' }, { id: 'old', at: '1', place: '0' }], '1'), { unread: 2, firstUnread: 'a' });
  assert.deepEqual(unreadOf([{ id: 'old', at: '1', place: '0' }], '1'), { unread: 0, firstUnread: null });
});

test('the store: a position only moves forward, and an app shows one chat at a time', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-read-'));
  const store = readLib.create(dir);
  const since = store.readAt('bot:a');
  assert.equal(store.mark('bot:a', '2000-01-01T00:00:00.000Z'), since, 'not back before the start');
  assert.equal(store.mark('bot:a', '2999-01-01T00:00:00.000Z'), '2999-01-01T00:00:00.000Z');
  assert.equal(store.mark('bot:a'), '2999-01-01T00:00:00.000Z', 'not back to now');
  assert.equal(readLib.create(dir).readAt('bot:a'), '2999-01-01T00:00:00.000Z', 'kept in the file');
  assert.equal(store.report('web', 'bot:a'), true);
  assert.equal(store.report('phone', 'bot:a'), false, 'already on screen somewhere');
  assert.equal(store.report('web', 'bot:b'), true, 'the web page moved on');
  assert.deepEqual([store.onScreen('bot:a'), store.onScreen('bot:b')], [true, true]);
  store.report('phone', null);
  assert.deepEqual([store.onScreen('bot:a'), store.onScreen('bot:b')], [false, true]);
  store.forget('bot:b');
  assert.equal(store.onScreen('bot:b'), false);
  fs.rmSync(dir, { recursive: true });
});

test('on the first start with read positions every existing chat is read', async () => {
  for (const b of (await srv.api('/bots')).data) assert.deepEqual([b.name, b.unread, b.firstUnread], [b.name, 0, null]);
  assert.deepEqual(await chiefUnread(), [0, [OLD_CHAT, 0, null]]);
  assert.ok((await srv.api('/version')).data.features.includes('unread'));
  const store = positions();
  assert.equal(store.version, 1);
  assert.ok(Date.parse(store.since) > T0 + 3600_000, 'read up to this start');
  assert.deepEqual(store.chats, {});
});

test('the bots say how many replies are new, uncapped, and which is the first', async () => {
  // Move the start of the read positions back, so the seeded runs come after it.
  await srv.stop();
  fs.writeFileSync(positionsFile(), JSON.stringify({ version: 1, since: at(0), chats: {} }));
  srv = await startServer({ dir: srv.dir, env: ENV });
  const all = (await srv.api('/bots')).data;
  const of = (name) => { const b = all.find((x) => x.name === name); return [b.unread, b.firstUnread]; };
  assert.deepEqual(of('Answers'), [3, seeded.Answers[0]]);
  assert.deepEqual(of('Many'), [5, seeded.Many[0]], 'not capped at three');
  assert.deepEqual(of('Quiet'), [0, null], 'quiet runs never count');
  assert.deepEqual(of('Reports'), [2, seeded.Reports[0]], 'the delivered reports, not the held or the suppressed one');
  assert.deepEqual(of('Teammate'), [0, null], 'runs another bot or the Chief started never count, failed or not');
  assert.deepEqual(of('Failing'), [3, seeded.Failing[0]], 'failed runs count');
  assert.deepEqual(of('Script'), [2, seeded.Script[0]], 'the script that found something and the run the restart cut off; not the memory review');
  assert.deepEqual(of('Mixed'), [1, seeded.Mixed[2]], 'not the run before the position, nor the follow-up among bots');
  // One bot says the same as the list.
  const one = (await srv.api(`/bots/${bots[1].id}`)).data;
  assert.deepEqual([one.unread, one.firstUnread], [5, seeded.Many[0]]);
  assert.deepEqual(await chiefUnread(), [1, [OLD_CHAT, 1, 1]], "the Chief's reply, message 1 of its chat");
});

test('a report that a chat is on screen reads it, and the feed says so within a second', async () => {
  const f = await feed(srv);
  await f.wait('hello');
  const chat = `bot:${bots[1].id}`;
  const started = Date.now();
  const r = await read(chat);
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.ok, r.data.chat, r.data.repeatMs], [true, chat, REPORT_MS * 2 / 3]);
  assert.ok(Date.parse(r.data.readAt) >= started);
  const ev = await f.wait('unread', (d) => d.chat === chat);
  assert.ok(Date.now() - started < 1000, 'within a second');
  assert.deepEqual([ev.data.unread, ev.data.firstUnread, ev.data.readAt], [0, null, r.data.readAt]);
  assert.ok(f.events.some((e) => e.type === 'chat_seen' && e.data.chat === chat), 'apps from before still hear chat_seen');
  const now = await unreadNow();
  assert.equal(now.Many, 0);
  assert.equal(now.Answers, 3, 'only that chat');
  assert.equal(positions().chats[chat], r.data.readAt);
  // Repeating the report is not news.
  await read(chat);
  await sleep(100);
  assert.equal(f.events.filter((e) => e.type === 'unread' && e.data.chat === chat).length, 1);
  f.close();
});

test('a report for a chat that does not exist is refused and changes nothing', async () => {
  const before = fs.readFileSync(positionsFile(), 'utf8');
  const f = await feed(srv);
  await f.wait('hello');
  for (const chat of ['bot:nobody', 'chief:20260101000000-nope00', 'bots', 'bot:../x', 42]) {
    const r = await read(chat);
    assert.equal(r.status, 400, `${chat}`);
    assert.match(r.data.error, /doesn't exist/);
  }
  // Nor a report that doesn't say which app sends it.
  for (const app of [null, '', 'a b', 7]) assert.equal((await read(`bot:${bots[0].id}`, app)).status, 400, `app ${app}`);
  await sleep(100);
  assert.equal(fs.readFileSync(positionsFile(), 'utf8'), before);
  assert.equal(f.events.filter((e) => e.type === 'unread' || e.type === 'chat_seen').length, 0);
  assert.equal((await unreadNow()).Answers, 3);
  f.close();
});

// A bot's reply to `prompt`, with `during()` called while it works. Returns the run and its run_finished event.
async function replyOf(bot, prompt, f, during = async () => {}) {
  const h = await heldRun(srv, bot, prompt);
  await during();
  srv.release(h.rec);
  // An app keeps reporting while the chat is on screen; `during` may have started that.
  const done = await srv.finished(h.run.id);
  srv.unhold();
  return { run: done, event: (await f.wait('run_finished', (d) => d.id === h.run.id)).data };
}

test('a reply that finishes while an app reports its chat on screen is not new', async () => {
  const bot = bots[2]; // Quiet: nothing new so far
  const chat = `bot:${bot.id}`;
  const f = await feed(srv);
  await f.wait('hello');
  let repeat;
  const watched = await replyOf(bot, 'While you watch', f, async () => { await read(chat); repeat = setInterval(() => read(chat).catch(() => {}), 300); });
  clearInterval(repeat);
  assert.equal(watched.event.new, undefined);
  assert.equal((await unreadNow()).Quiet, 0);
  assert.ok(positions().chats[chat] >= watched.run.endedAt, 'read up to that reply');
  assert.equal(f.events.filter((e) => e.type === 'unread' && e.data.chat === chat).length, 0, 'nothing changed for the other apps');
  await read(null); // the owner leaves the chat
  f.close();
});

test('a report stops counting when the app says it left, or stops repeating it; a reply after that is new', async () => {
  const bot = bots[2];
  const chat = `bot:${bot.id}`;
  const f = await feed(srv);
  await f.wait('hello');
  // The page is hidden (it says so): the answer that comes a moment later is new.
  await read(chat);
  await read(null);
  const first = await replyOf(bot, 'While you are away', f);
  assert.equal(first.event.new, true);
  assert.equal((await f.wait('unread', (d) => d.chat === chat && d.unread === 1)).data.firstUnread, first.run.id);
  // Two apps show the chat and one leaves: it is still on screen.
  await read(chat, 'web-1');
  await read(chat, 'mac-1');
  await read(null, 'web-1');
  assert.equal((await replyOf(bot, 'One app left', f)).event.new, undefined);
  // An app that opens another chat no longer shows this one.
  await read(`bot:${bots[0].id}`, 'mac-1');
  const second = await replyOf(bot, 'Looking elsewhere', f);
  assert.equal(second.event.new, true);
  await read(null, 'mac-1');
  // An app that died without a word: its report runs out by itself.
  await read(chat, 'phone-1');
  assert.equal((await unreadNow()).Quiet, 0);
  await sleep(REPORT_MS + 200);
  const third = await replyOf(bot, 'After the app died', f);
  assert.equal(third.event.new, true);
  const fourth = await replyOf(bot, 'And again', f);
  assert.equal((await f.wait('unread', (d) => d.chat === chat && d.unread === 2)).data.firstUnread, third.run.id);
  const b = (await srv.api(`/bots/${bot.id}`)).data;
  assert.deepEqual([b.unread, b.firstUnread, fourth.event.new], [2, third.run.id, true]);
  f.close();
});

test('a run the Chief or another bot started is not new', async () => {
  const [sender, target] = [bots[3], bots[4]]; // Reports messages Teammate
  await srv.api(`/bots/${sender.id}`, { method: 'PUT', body: { mayMessage: [target.id] } });
  const before = await unreadNow();
  const f = await feed(srv);
  await f.wait('hello');
  // A run the Chief started from a chat of its own (as its run_bot action records).
  srv.hold();
  const byChief = (await srv.asChief(`/bots/${target.id}/run`, { method: 'POST', body: { prompt: 'From the Chief' } })).data;
  const rec = await srv.nextRun((x) => x.stdin.startsWith('From the Chief'), 'the run the Chief started');
  const its = (await srv.api('/chief/chats', { method: 'POST' })).data;
  const file = path.join(srv.data, 'chief', `${its.id}.json`);
  fs.writeFileSync(file, JSON.stringify({ ...JSON.parse(fs.readFileSync(file, 'utf8')), messages: [{ role: 'user', text: 'Ask Teammate', at: new Date().toISOString() }, { role: 'chief', text: 'Asked.', at: new Date().toISOString(), actions: [{ kind: 'run', text: 'Started Teammate', runId: byChief.id }] }] }));
  srv.unhold();
  srv.release(rec);
  await srv.finished(byChief.id);
  assert.equal((await f.wait('run_finished', (d) => d.id === byChief.id)).data.new, undefined);
  // The Chief gets a turn about it in that chat (BUSY-002, test/chief-late.test.js). The chat goes again, with
  // what is new in it, so that the Chief's counts below are those of the chats this file means.
  await f.wait('chief_reply', (d) => d.chatId === its.id);
  assert.deepEqual((await srv.api(`/chief/chats/${its.id}`, { method: 'DELETE' })).data, { ok: true });
  const h = await heldRun(srv, sender, 'Ask your teammate');
  const sent = await self(srv, h.token, 'message', { to: target.id, message: 'What is new?', priority: true });
  assert.equal(sent.data.delivered, 'started', JSON.stringify(sent.data));
  const theirs = await waitFor(async () => (await srv.api(`/runs?botId=${target.id}`)).data.find((r) => r.trigger === 'bot' && r.prompt.includes('What is new?')), { what: 'the teammate to start' });
  srv.unhold();
  srv.release(h.rec);
  await srv.finished(theirs.id);
  await srv.finished(h.run.id);
  assert.equal((await f.wait('run_finished', (d) => d.id === theirs.id)).data.new, undefined);
  // The teammate sent no message back, so Reports is started once more with its reply (QW-004), and answers the owner.
  const follow = await waitFor(async () => (await srv.api(`/runs?botId=${sender.id}`)).data.find((r) => r.trigger === 'replies' && r.chainId === h.run.id && r.status !== 'running'), { what: "the sender's follow-up" });
  assert.equal((await f.wait('run_finished', (d) => d.id === follow.id)).data.new, true);
  const now = await unreadNow();
  assert.equal(now.Teammate, before.Teammate, 'nothing new for the bot that was asked');
  assert.equal(now.Reports, before.Reports + 2, 'both answers to the owner are new: "Asked…" and the result');
  f.close();
});

test("the Chief's chats count their replies the same way", async () => {
  const f = await feed(srv);
  await f.wait('hello');
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  const key = `chief:${chat.id}`;
  const replied = () => waitFor(async () => { const c = (await srv.api(`/chief/chats/${chat.id}`)).data; return !c.busy && c.messages.length && !c.messages.at(-1).pending ? c : null; }, { what: 'the Chief to reply' });
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Hello' } });
  let c = await replied();
  assert.deepEqual([c.unread, c.firstUnread], [1, 1], 'its reply is message 1');
  assert.equal((await f.wait('chief_reply', (d) => d.chatId === chat.id)).data.new, true);
  assert.deepEqual((await f.wait('unread', (d) => d.chat === key)).data.firstUnread, 1);
  let list = (await srv.api('/chief')).data;
  assert.equal(list.unread, 2, "all chats together (the seeded one too), for the Chief's row");
  assert.deepEqual([list.chats.find((x) => x.id === chat.id).unread, list.chats.find((x) => x.id === chat.id).firstUnread], [1, 1]);
  // The owner opens it: read. A reply while it stays on screen is not new.
  assert.equal((await read(key)).status, 200);
  assert.equal((await f.wait('unread', (d) => d.chat === key && d.unread === 0)).data.firstUnread, null);
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'And now?' } });
  c = await replied();
  assert.deepEqual([c.unread, c.firstUnread], [0, null]);
  assert.equal(f.events.filter((e) => e.type === 'chief_reply' && e.data.chatId === chat.id).at(-1).data.new, undefined);
  list = (await srv.api('/chief')).data;
  assert.equal(list.unread, 1, 'only the seeded chat');
  await read(null);
  // A reminder that goes off while the Chief is answering reaches the chat with the reply: two new messages,
  // the reply first, and one `unread` for both.
  srv.hold();
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Think about it' } });
  const turn = await srv.nextRun((x) => x.args.includes('🧭 Chief of Staff') && x.stdin.includes('Think about it'), 'the Chief to start');
  await srv.asChief('/chief/reminders', { method: 'POST', body: { text: 'Call the plumber', at: new Date().toISOString(), chatId: chat.id } });
  await sleep(200); // the reminder goes off, into the turn
  const seenBefore = f.events.filter((e) => e.type === 'unread' && e.data.chat === key).length;
  srv.release(turn);
  srv.unhold();
  c = await replied();
  assert.match(c.messages.at(-1).text, /Call the plumber/);
  assert.deepEqual([c.unread, c.firstUnread], [2, c.messages.length - 2]);
  await waitFor(() => f.events.filter((e) => e.type === 'chief_reply' && e.data.chatId === chat.id && e.data.new).length === 3, { what: 'both chief_reply events' });
  await sleep(100);
  assert.equal(f.events.filter((e) => e.type === 'unread' && e.data.chat === key).length, seenBefore + 1);
  await read(key);
  await read(null);
  // Deleting the chat takes its read position along.
  assert.ok(positions().chats[key]);
  await srv.api(`/chief/chats/${chat.id}`, { method: 'DELETE' });
  assert.equal(positions().chats[key], undefined);
  f.close();
});

test('deleting a bot removes its read position', async () => {
  const bot = bots[7]; // Mixed
  const chat = `bot:${bot.id}`;
  await read(chat);
  assert.ok(positions().chats[chat]);
  assert.equal((await srv.api(`/bots/${bot.id}`, { method: 'DELETE' })).data.ok, true);
  assert.equal(positions().chats[chat], undefined);
  assert.equal((await read(chat)).status, 400);
});

test('a restart keeps the read positions; a backup and a restore carry them', async () => {
  // A Chief chat with a position of its own, and one without.
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await read(`chief:${chat.id}`);
  await read(null);
  const before = await unreadNow();
  const chiefBefore = await chiefUnread();
  assert.equal(chiefBefore[0], 1, 'the seeded chat is still unread');
  const stored = positions();
  assert.ok(stored.chats[`chief:${chat.id}`] && Object.keys(stored.chats).length >= 3);
  await srv.stop();
  srv = await startServer({ dir: srv.dir, env: ENV });
  assert.deepEqual(await unreadNow(), before);
  assert.deepEqual(await chiefUnread(), chiefBefore);
  assert.deepEqual(positions(), stored);

  const PASS = 'correct horse battery';
  await srv.api('/backups/passphrase', { method: 'PUT', body: { passphrase: PASS } });
  const made = await srv.api('/backups/now', { method: 'POST' });
  // After the backup the owner reads one more chat here: the restored botdot must not know that.
  await read(`bot:${bots[0].id}`);
  assert.equal((await unreadNow()).Answers, 0);
  const other = await startServer({ env: ENV });
  try {
    assert.equal((await read(`bot:${bots[0].id}`, 'web-1', other)).status, 400, 'no such bot there yet');
    const up = await other.api('/backups/upload', { method: 'POST', raw: fs.readFileSync(path.join(srv.data, 'backups', made.data.last.name)) });
    const r = await other.api('/backups/restore', { method: 'POST', body: { file: up.data.file, passphrase: PASS } });
    assert.equal(r.data.ok, true, JSON.stringify(r.data));
    await other.exited; // it stops itself, to start again with the restored data
    const restored = await startServer({ dir: other.dir, env: ENV });
    try {
      assert.deepEqual(await unreadNow(restored), before);
      assert.deepEqual(await chiefUnread(restored), chiefBefore);
      assert.deepEqual(JSON.parse(fs.readFileSync(path.join(restored.data, 'read-positions.json'), 'utf8')), stored);
    } finally { await restored.stop(); }
  } finally { await other.stop(); }
});
