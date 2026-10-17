// A run can carry the group and the owner's message it belongs to (GRP-001, ADR 018), and keeps both wherever a
// run is made again: one that starts, one that waits its turn, one that never started and one that carries on
// after the owner's yes. What such a run tells the feed is an event of a group, never one a bot's chat is drawn
// from. No route starts a turn yet, so this file loads lib/bots.js itself, on a scratch data folder and the
// stand-in for Claude.
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-group-runs-'));
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
const reply = (text) => (text === null ? fs.rmSync(path.join(out, 'result.txt'), { force: true }) : fs.writeFileSync(path.join(out, 'result.txt'), text));
after(() => { letGo(); B.stopAllRuns(); fs.rmSync(dir, { recursive: true, force: true }); });

// The feed's events from now on, until stop(): [type, data].
function listen() {
  const events = [];
  const stop = feed.subscribe((ev) => events.push([ev.type, ev.data]));
  return { events, stop, types: () => events.map(([type]) => type), of: (type) => events.filter(([t]) => t === type).map(([, d]) => d) };
}
// What an app from before groups acts on for a run or a bot's chat.
const OLD = ['run_started', 'run_finished', 'unread', 'asks', 'queued', 'opening_line', 'run_waits', 'bot_message', 'waiting'];

let coder, reviewer, dev;
test('a turn is a run of its member with its group and the message it belongs to; the feed says it as an event of the group', async () => {
  coder = B.bots.create({ name: 'Coder', emoji: '🧑‍💻', prompt: 'Write the code.' });
  reviewer = B.bots.create({ name: 'Reviewer', emoji: '🔎', prompt: 'Review the code.' });
  dev = B.groups.create({ name: 'Dev', members: [coder.id, reviewer.id] });
  const heard = listen();
  const run = B.startRun(coder, { prompt: 'The settings page needs a dark mode switch.', groupId: dev.id, groupMessageId: 'm1' });
  assert.deepEqual([run.botId, run.groupId, run.groupMessageId, run.trigger], [coder.id, dev.id, 'm1', 'manual']);
  assert.equal(B.isBotRunning(coder.id), true, 'a member at work in a group is at work: a bot does one thing at a time');
  assert.equal(B.groupOfRun(run.id), dev.id);
  const done = await ended(run.id);
  heard.stop();
  assert.deepEqual([done.status, done.groupId, done.groupMessageId], ['success', dev.id, 'm1']);
  assert.deepEqual(heard.types().filter((t) => OLD.includes(t)), [], 'nothing an app from before groups draws or rings for');
  const [started] = heard.of('group_run_started');
  const [finished] = heard.of('group_run_finished');
  assert.deepEqual([started.id, started.botId, started.chat, started.groupId, started.groupMessageId, started.status], [run.id, coder.id, `group:${dev.id}`, dev.id, 'm1', 'running']);
  // A new reply of the group, which never notifies (GRP-002, ADR 019).
  assert.deepEqual([finished.id, finished.chat, finished.groupId, finished.groupMessageId, finished.status, finished.new, finished.notify], [run.id, `group:${dev.id}`, dev.id, 'm1', 'success', true, false]);
  assert.equal(heard.of('bots').length, 2, "its own row is told that it works, and that it is free again");
  // Its bot's own chat has nothing of it; the group has it; and it is one of the bot's past runs.
  assert.deepEqual(B.listRuns({ botId: coder.id }), []);
  assert.deepEqual(B.listRuns().map((r) => r.id), []);
  assert.deepEqual(B.listRuns({ groupId: dev.id }).map((r) => r.id), [run.id]);
  assert.deepEqual(B.listRuns({ botId: coder.id, all: true }).map((r) => r.id), [run.id]);
  assert.deepEqual([B.unreadOfBot(coder.id).unread, B.lastStatuses()[coder.id]], [0, undefined]);
  // A run without a group carries none, and a message without its group is no link.
  const own = B.startRun(coder, { prompt: 'Hello', groupMessageId: 'm9' });
  const ownDone = await ended(own.id);
  assert.deepEqual([ownDone.groupId, ownDone.groupMessageId, B.groupOfRun(own.id)], [undefined, undefined, null]);
});

test("a question asked in a group is not the bot's own, and a turn does not answer the bot's own question", async () => {
  const asker = B.bots.create({ name: 'Asker', emoji: '❓', prompt: 'Ask.' });
  reply('Two drafts.\nShould I send it now?\n\n[[choices: Yes | No]]');
  const turn = await ended(B.startRun(asker, { prompt: 'In the group', groupId: dev.id, groupMessageId: 'm2' }).id);
  assert.deepEqual(turn.choices, ['Yes', 'No']);
  assert.equal(B.asksOfBot(asker.id), null);
  // Its own chat: it asks there, and a later turn in the group leaves that question open.
  const own = await ended(B.startRun(asker, { prompt: 'In its own chat' }).id);
  assert.equal(B.asksOfBot(asker.id).runId, own.id);
  reply(null);
  const heard = listen();
  await ended(B.startRun(asker, { prompt: 'In the group again', groupId: dev.id, groupMessageId: 'm3' }).id);
  assert.equal(B.asksOfBot(asker.id).runId, own.id);
  assert.deepEqual(heard.of('asks'), []);
  // The owner's message in its own chat answers it.
  await ended(B.startRun(asker, { prompt: 'Yes' }).id);
  heard.stop();
  assert.equal(B.asksOfBot(asker.id), null);
  assert.deepEqual(heard.of('asks').map((d) => [d.botId, d.asks]), [[asker.id, null]]);
});

test('a turn that waits for a busy member keeps the link, on disk too, and is no waiting message of the bot', async () => {
  const bot = B.bots.create({ name: 'Busy', emoji: '⏳', prompt: 'Do the task.' });
  // Its member: a turn that waited for a bot that is no member (any more) is skipped (GRP-002, ADR 019).
  const team = B.groups.create({ name: 'Busy team', members: [bot.id, coder.id] });
  hold();
  const first = B.askBot(bot, { prompt: 'Something long' }).run;
  const heard = listen();
  const waits = B.askBot(bot, { prompt: 'A turn in the group', groupId: team.id, groupMessageId: 'm4' }).queued;
  assert.deepEqual([waits.status, waits.botId, waits.groupId, waits.groupMessageId], ['queued', bot.id, team.id, 'm4']);
  assert.deepEqual(B.waitingRun(waits.id).groupId, team.id);
  assert.deepEqual(queueFile()[bot.id].map((x) => [x.runId, x.groupId, x.groupMessageId]), [[waits.id, team.id, 'm4']]);
  // Not in the bot's own chat: not among its waiting messages, not taken back there, and the feed says nothing of it.
  assert.deepEqual(B.queuedOf(bot.id), []);
  assert.equal(B.takeBack(bot.id, waits.id), null);
  assert.deepEqual(heard.types().filter((t) => OLD.includes(t)), []);
  // The bot's own waiting message is one, beside it.
  const mine = B.askBot(bot, { prompt: 'In its own chat' }).queued;
  assert.deepEqual(B.queuedOf(bot.id).map((x) => x.id), [mine.id]);
  assert.equal(mine.groupId, undefined);
  letGo();
  await ended(first.id);
  const [turn, own] = [await ended(waits.id), await ended(mine.id)];
  heard.stop();
  assert.deepEqual([turn.id, turn.groupId, turn.groupMessageId, turn.sentAt, turn.status], [waits.id, team.id, 'm4', waits.queuedAt, 'success']);
  assert.equal(own.groupId, undefined);
  assert.deepEqual(heard.of('group_run_finished').map((d) => d.id), [waits.id]);
  assert.deepEqual(heard.of('run_finished').map((d) => d.id).sort(), [first.id, mine.id].sort());
  assert.deepEqual(B.listRuns({ botId: bot.id }).map((r) => r.id).sort(), [first.id, mine.id].sort());
});

test('a turn that never started is a failed run of its group', async () => {
  const bot = B.bots.create({ name: 'Blocked', emoji: '🧱', prompt: 'Do the task.' });
  const team = B.groups.create({ name: 'Blocked team', members: [bot.id, coder.id] });
  hold();
  const before = fs.readdirSync(out).filter((f) => f.startsWith('run-')).length;
  const first = B.askBot(bot, { prompt: 'Something long' }).run;
  const waits = B.askBot(bot, { prompt: 'A turn in the group', groupId: team.id, groupMessageId: 'm5' }).queued;
  // Its workspace cannot be used when its turn comes (as test/message-waits-unit.test.js has it).
  await waitFor(() => fs.readdirSync(out).filter((f) => f.startsWith('run-')).length >= before + 1, { what: 'the first run to be going' });
  const workspace = path.join(B.DATA_DIR, 'workspaces', bot.id);
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.writeFileSync(workspace, 'not a folder');
  const heard = listen();
  letGo();
  await ended(first.id);
  const failed = await ended(waits.id);
  heard.stop();
  assert.deepEqual([failed.status, failed.groupId, failed.groupMessageId], ['error', team.id, 'm5']);
  assert.match(failed.error, /^It didn't start: /);
  assert.deepEqual(heard.of('group_run_finished').map((d) => [d.id, d.status, d.groupId]), [[waits.id, 'error', team.id]]);
  assert.deepEqual(heard.of('run_finished').map((d) => d.id), [first.id]);
  assert.deepEqual(B.listRuns({ botId: bot.id }).map((r) => r.id), [first.id]);
  assert.deepEqual(B.listRuns({ groupId: team.id, botId: bot.id }).map((r) => r.id), [waits.id]);
  assert.equal(B.lastStatuses()[bot.id], 'success', "its own chat's last run, not the turn that failed");
});

test("the run that carries on after the owner's yes is a turn of the same group, started at once or after a wait", async () => {
  const bot = B.bots.create({ name: 'Carries On', emoji: '🔁', prompt: 'Do the task.' });
  const stopped = await ended(B.startRun(bot, { prompt: 'Look it up on the web.', groupId: dev.id, groupMessageId: 'm6' }).id);
  const asked = new Date().toISOString();
  // Only a member carries on in its group (GRP-003, ADR 020): a bot that is none, or has left, starts nothing.
  const ask = { botId: bot.id, at: asked, runs: [{ id: stopped.id, at: asked }] };
  assert.deepEqual(B.whatCarriesOn(ask), []);
  assert.throws(() => B.carryOn({ run: stopped, who: 'owner', at: asked, asked }, { allowed: ['web access'] }), /no longer waits/);
  B.groups.update(dev.id, { members: [...B.groups.get(dev.id).members, bot.id] });
  assert.deepEqual(B.whatCarriesOn(ask).map((f) => f.run.id), [stopped.id]);
  // Free: it starts with the yes.
  assert.equal(B.carryOn({ run: stopped, who: 'owner', at: asked, asked }, { allowed: ['web access'] }), 'started');
  const next = await waitFor(() => B.listRuns({ groupId: dev.id, botId: bot.id }).find((r) => r.continues === stopped.id), { what: 'the run that carries on' });
  assert.deepEqual([next.groupId, next.groupMessageId, next.prompt], [dev.id, 'm6', 'Look it up on the web.']);
  const done = await ended(next.id);
  // Busy: the work waits its turn, and its run is the group's all the same.
  hold();
  const first = B.askBot(bot, { prompt: 'Something long' }).run;
  assert.equal(B.carryOn({ run: done, who: 'owner', at: asked, asked }, { allowed: ['commands'] }), 'queued');
  letGo();
  await ended(first.id);
  const later = await waitFor(() => B.listRuns({ groupId: dev.id, botId: bot.id }).find((r) => r.continues === done.id && r.status !== 'running'), { what: 'the run that carried on after the wait' });
  assert.deepEqual([later.groupId, later.groupMessageId], [dev.id, 'm6']);
  assert.deepEqual(B.listRuns({ botId: bot.id }).map((r) => r.id), [first.id], 'none of them in its own chat');
});

test('a turn a member handed on is a run a teammate started: what it saves is not the owner\'s word, waiting, started or carried on', async () => {
  const bot = B.bots.create({ name: 'Handed', emoji: '🤝', prompt: 'Take over.' });
  B.groups.update(dev.id, { members: [...B.groups.get(dev.id).members, bot.id] });
  const by = { id: reviewer.id, name: reviewer.name, emoji: reviewer.emoji, color: reviewer.color };
  // The owner's message gave it: a run the owner started, which has read nothing outside.
  hold();
  const owners = B.askBot(bot, { prompt: 'All clear?', groupId: dev.id, groupMessageId: 'm7' }).run;
  assert.deepEqual([B.runStanding(owners.id).startedBy, B.runStanding(owners.id).outside, B.runStanding(owners.id).waits, B.ownerStarted(owners.id)], ['owner', [], false, true]);
  // A member handed it on, and it waits behind that run: the waiting turn keeps who, on disk too.
  const waits = B.askBot(bot, { prompt: 'All clear?', groupId: dev.id, groupMessageId: 'm8', handedBy: by });
  assert.equal(waits.run, undefined);
  assert.deepEqual(queueFile()[bot.id].map((x) => [x.kind, x.groupMessageId, x.handedBy]), [['turn', 'm8', by]]);
  letGo();
  await ended(owners.id);
  const handed = await waitFor(() => B.listRuns({ groupId: dev.id, botId: bot.id }).find((r) => r.groupMessageId === 'm8' && r.status !== 'running'), { what: 'the handed-on turn to end' });
  assert.deepEqual([handed.handedBy, handed.trigger, handed.outside, handed.readOutside], [by, 'manual', ['teammate'], true]);
  assert.equal(B.ownerStarted(handed.id), false);
  assert.equal(owners.handedBy, undefined);
  // While it is going: a save is "after outside content", and a forget or a change to the owner's word waits on a card (server.js).
  hold();
  const going = B.startRun(bot, { prompt: 'Go on', groupId: dev.id, groupMessageId: 'm9', handedBy: by });
  assert.deepEqual(B.runStanding(going.id), { startedBy: 'teammate', outside: ['teammate'], fromOthers: true, waits: true });
  letGo();
  const stopped = await ended(going.id);
  // The run that carries on from it is handed on as it was.
  const asked = new Date().toISOString();
  assert.equal(B.carryOn({ run: stopped, who: 'owner', at: asked, asked }, { allowed: ['web access'] }), 'started');
  const next = await waitFor(() => B.listRuns({ groupId: dev.id, botId: bot.id }).find((r) => r.continues === stopped.id && r.status !== 'running'), { what: 'the run that carries on' });
  assert.deepEqual([next.handedBy, next.outside.includes('teammate'), B.ownerStarted(next.id)], [by, true, false]);
  // Outside a group nobody hands a turn on.
  const own = await ended(B.startRun(bot, { prompt: 'Hello', handedBy: by }).id);
  assert.deepEqual([own.handedBy, own.outside, B.ownerStarted(own.id)], [undefined, [], true]);
});

// The milestone review (GRP-010): a turn that waited for its member was dated by when it came to wait, and its run
// by when the owner wrote the message. So a message the owner wrote before a card was asked counted as a later one
// while its turn waited, and a yes on the card started nothing; once the turn had started the same yes carried on.
test('a waiting turn is dated by when the owner wrote its message, as its run is: a yes on a card starts the same while it waits and once it has started', async () => {
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const bot = B.bots.create({ name: 'One Clock', emoji: '⏱', prompt: 'Do the task.' });
  const clock = B.groups.create({ name: 'Clock', members: [bot.id, reviewer.id] });
  // The owner writes M1, and then M2, whose line has not come to this member yet.
  const stoppedId = B.startRun(bot, { prompt: 'List the pull requests.', groupId: clock.id, groupMessageId: 'c1' }).id;
  const wroteM2 = new Date().toISOString();
  await sleep(5);
  // The turn for M1 ends, and asks for a card: after M2 was written.
  const stopped = await ended(stoppedId);
  const asked = new Date().toISOString();
  const ask = { botId: bot.id, at: asked, runs: [{ id: stopped.id, at: asked }] };
  assert.deepEqual(B.whatCarriesOn(ask).map((f) => f.run.id), [stopped.id]);
  await sleep(5);
  // The member is busy in its own chat as M2's line reaches it: the turn waits, from a moment after the card.
  hold();
  const own = B.askBot(bot, { prompt: 'Something long' }).run;
  const turn = B.askBot(bot, { prompt: 'And the branches?', groupId: clock.id, groupMessageId: 'c2', id: '20261008120000-clock2', sentAt: wroteM2 });
  assert.equal(turn.run, undefined, 'it waits');
  const [item] = queueFile()[bot.id];
  assert.ok(item.sentAt === wroteM2 && item.queuedAt > asked, 'written before the card, and waiting since after it');
  assert.deepEqual(B.whatCarriesOn(ask).map((f) => f.run.id), [stopped.id], 'while it waits: the owner wrote nothing since the card');
  // Started, its run keeps the same moment, and the same yes carries on still.
  letGo();
  await ended(own.id);
  const started = await ended('20261008120000-clock2');
  assert.equal(started.sentAt, wroteM2);
  assert.deepEqual(B.whatCarriesOn(ask).map((f) => f.run.id), [stopped.id], 'and once it has started');
  // A message the owner wrote after the card stands for what they want now, waiting or started.
  hold();
  const busy = B.askBot(bot, { prompt: 'Something long again' }).run;
  B.askBot(bot, { prompt: 'Never mind the pull requests.', groupId: clock.id, groupMessageId: 'c3', id: '20261008120000-clock3', sentAt: new Date().toISOString() });
  assert.deepEqual(B.whatCarriesOn(ask), [], 'while it waits');
  letGo();
  await ended(busy.id);
  await ended('20261008120000-clock3');
  assert.deepEqual(B.whatCarriesOn(ask), [], 'and once it has started');
});

// A turn has one of the ten places of the owner's messages, also one a member handed on (GRP-010): when they are
// full, the refusal of a handed-on turn does not speak of "your messages", of which the owner then sent none.
test('a hand-on to a member whose ten places are full is refused in words that fit it', async () => {
  const bot = B.bots.create({ name: 'Full House', emoji: '🏠', prompt: 'Do the task.' });
  const full = B.groups.create({ name: 'Full', members: [bot.id, reviewer.id] });
  const by = { id: reviewer.id, name: reviewer.name, emoji: reviewer.emoji, color: reviewer.color };
  const holdFile = path.join(out, 'hold-FullHouse'); // this member alone is held: the other answers
  fs.writeFileSync(holdFile, '');
  const going = B.askBot(bot, { prompt: 'Something long' }).run;
  for (let i = 0; i < 10; i++) assert.ok(B.askBot(bot, { prompt: `Message ${i}` }).queued);
  assert.throws(() => B.askBot(bot, { prompt: 'Your part.', groupId: full.id, groupMessageId: 'f1', handedBy: by, id: '20261008120000-full01', sentAt: new Date().toISOString() }),
    (e) => e.status === 429 && e.message === 'Full House already has 10 messages waiting, so it could not take the work Reviewer handed on.');
  assert.throws(() => B.askBot(bot, { prompt: 'All of you.', groupId: full.id, groupMessageId: 'f2', id: '20261008120000-full02', sentAt: new Date().toISOString() }),
    (e) => e.status === 429 && e.message === 'Full House already has 10 of your messages waiting. Take one back, or wait.', "a turn the owner's message gave is the owner's message");
  assert.equal(queueFile()[bot.id].length, 10, 'neither was kept');
  // In the group it is a failed run under the member's name, with that reason, and the line goes on.
  reply('@FullHouse your part is next.');
  const sent = B.groupChat.send(full.id, { text: '@Reviewer hand it to the full one.' });
  const failed = await waitFor(() => B.listRuns({ groupId: full.id, botId: bot.id }).find((r) => r.groupMessageId === sent.id), { what: 'the turn that could not wait' });
  assert.deepEqual([failed.status, failed.error, failed.handedBy?.id], ['error', "It didn't start: Full House already has 10 messages waiting, so it could not take the work Reviewer handed on.", reviewer.id]);
  reply(null);
  fs.rmSync(holdFile, { force: true });
  await ended(going.id);
  await waitFor(() => !B.isBotRunning(bot.id) && !(queueFile()[bot.id] || []).length, { timeout: 30_000, what: 'the ten messages to be answered' });
});

// The mark of a turn's prompt is made in lib/bots.js startRun for the note and the block together (ADR 020,
// GRP-010), and what the note prints is asked for it there. The system's random source is stood in for, so that
// the mark botdot makes first is known: eight bytes of 0x12 are "1212121212121212". The last name holds it only
// as a mention writes that name, without its spaces.
test("the mark of a turn's prompt is in none of the names its note prints: a name that holds the mark made first gets the prompt another", async () => {
  const crypto = require('crypto');
  const real = crypto.randomBytes;
  const firstMark = '1212121212121212';
  const promptOf = async (botName, groupName) => {
    const bot = B.bots.create({ name: botName, emoji: '🎯', prompt: 'Do the task.' });
    const group = B.groups.create({ name: groupName, members: [bot.id, reviewer.id] });
    let fixed = true;
    crypto.randomBytes = (n, ...rest) => (n === 8 && fixed ? ((fixed = false), Buffer.alloc(8, 0x12)) : real(n, ...rest));
    let run;
    try { run = B.startRun(bot, { prompt: 'All clear?', groupId: group.id, groupMessageId: 'k1' }); } finally { crypto.randomBytes = real; }
    await ended(run.id);
    const rec = await waitFor(() => fs.readdirSync(out).filter((f) => f.startsWith('run-')).map((f) => JSON.parse(fs.readFileSync(path.join(out, f), 'utf8'))).find((r) => r.args.includes(`🎯 ${botName}`)), { what: `the prompt of ${botName}` });
    return rec.system;
  };
  // No text holds it: the mark made first is the prompt's, which shows that the stand-in is what makes the mark.
  const plain = await promptOf('Mark Plain', 'Marks');
  assert.ok(plain.includes(`that begin "[botdot ${firstMark} ·"`) && plain.includes(`[botdot ${firstMark} · a member: you] 🎯 Mark Plain (@MarkPlain)`));
  // A member's name holds it, and the group's name: the prompt has another mark, on every marked line.
  for (const [botName, groupName] of [[`Mark ${firstMark}`, 'Marks two'], ['Mark Third', `Marks ${firstMark}`], ['Mark 12121212 12121212', 'Marks four']]) {
    const sys = await promptOf(botName, groupName);
    const mark = sys.match(/that begin "\[botdot ([0-9a-f]{16}) ·"/)[1];
    assert.notEqual(mark, firstMark, `${botName} in ${groupName}`);
    assert.ok(!sys.includes(`[botdot ${firstMark} ·`), 'no line of botdot\'s begins with the mark a name holds');
    assert.ok(sys.includes(`[botdot ${mark} · the group's name] ${groupName}\n`) && sys.includes(`[botdot ${mark} · a member: you] 🎯 ${botName} (@`));
  }
});

test('an event about a run of a group has a name of its own', () => {
  const heard = listen();
  feed.emitRun('opening_line', 'g1', { chat: 'bot:b1', botId: 'b1', runId: 'r1', text: 'Reading the diff' });
  feed.emitRun('run_waits', 'g1', { chat: 'bot:b1', botId: 'b1', runId: 'r1', waitingFor: 'ok' });
  feed.emitRun('opening_line', null, { chat: 'bot:b1', botId: 'b1', runId: 'r2', text: 'Reading the diff' });
  heard.stop();
  assert.deepEqual(heard.events, [
    ['group_opening_line', { chat: 'group:g1', groupId: 'g1', botId: 'b1', runId: 'r1', text: 'Reading the diff' }],
    ['group_run_waits', { chat: 'group:g1', groupId: 'g1', botId: 'b1', runId: 'r1', waitingFor: 'ok' }],
    ['opening_line', { chat: 'bot:b1', botId: 'b1', runId: 'r2', text: 'Reading the diff' }],
  ]);
});
