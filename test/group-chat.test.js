// The owner writes once in a group and the botdot server gives the turns (GRP-002, ADR 019; docs/api.md, Groups):
// every member, or the members mentioned, one after another; a member answers or passes; a busy member is waited
// for; a restart and a signed-out Claude lose no turn and give none twice; one Stop ends them all. Against a real
// botdot server and the stand-in for Claude, which answers, passes, fails and is held for one bot by its name
// (test/fixtures/fake-claude.js). No test here waits for a time to pass, but for the moment past which a run
// would have started.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, waitFor, sleep, feed, readData, seedRuns } = require('./helpers');
const { shortName } = require('../public/mentions.js');
const { isPass, PASS, turnNote } = require('../lib/group-chat');

let srv;
before(async () => { srv = await startServer(); });
after(() => { letAllGo(srv); return srv.stop(); });

// What the stand-in does for one bot: its reply, its failure, and holding its runs.
const fileOf = (on, kind, bot, ext = '') => path.join(on.out, `${kind}-${shortName(bot.name)}${ext}`);
const reply = (on, bot, text) => fs.writeFileSync(fileOf(on, 'result', bot, '.txt'), text);
const fails = (on, bot, why) => fs.writeFileSync(fileOf(on, 'fail', bot, '.txt'), why);
const hold = (on, bot) => fs.writeFileSync(fileOf(on, 'hold', bot), '');
const letGo = (on, bot) => fs.rmSync(fileOf(on, 'hold', bot), { force: true });
const letAllGo = (on) => { for (const f of fs.readdirSync(on.out)) if (f === 'hold' || f.startsWith('hold-')) fs.rmSync(path.join(on.out, f), { force: true }); };
// The stand-in's runs of a bot, oldest first.
const ranOf = (on, bot) => on.runs().filter((x) => x.who === shortName(bot.name));

// Bots, and a group of them. Names are a test's own: the stand-in tells bots apart by name.
async function team(on, name, names) {
  const bots = [];
  for (const n of names) bots.push(await makeBot(on, { name: n, emoji: '🤖', prompt: `Do the work of ${n}.` }));
  const made = await on.api('/group-chats', { method: 'POST', body: { name, members: bots.map((b) => b.id) } });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  return { group: made.data, bots };
}
const send = (on, group, body, as = on.api) => as(`/group-chats/${group.id}/messages`, { method: 'POST', body });
const chatOf = async (on, group, query = '') => (await on.api(`/group-chats/${group.id}/chat${query}`)).data;
const groupOf = async (on, group) => (await on.api(`/group-chats/${group.id}`)).data;
const messageIn = (c, id) => c.items.find((x) => x.type === 'message' && x.id === id);
const repliesIn = (c) => c.items.filter((x) => x.type === 'reply');
// The chat once a message's line has ended: nobody at work, no turn to come and none waiting.
const settled = (on, group, id, timeout = 20_000) => waitFor(async () => {
  const c = await chatOf(on, group);
  const m = messageIn(c, id);
  return m && !c.working.length && !m.next.length && !m.waitsFor.length ? c : null;
}, { timeout, what: `the line of message ${id} to end` });
const atWork = (on, group, bots) => waitFor(async () => {
  const c = await chatOf(on, group);
  return JSON.stringify(c.working.map((w) => w.botId).sort()) === JSON.stringify(bots.map((b) => b.id).sort()) ? c : null;
}, { what: `${bots.map((b) => b.name).join(' and ')} to be at work` });
const kept = (on, group) => (fs.existsSync(path.join(on.data, 'group-messages', `${group.id}.json`)) ? readData(on.data, path.join('group-messages', `${group.id}.json`)) : []);
const waitingIn = (on, bot) => (readData(on.data, 'queue.json').queues[bot.id] || []);
const runOf = async (on, id) => (await on.api(`/runs/${id}?events=0`)).data;
// What an app from before groups acts on for a run or a bot's chat.
const OLD = ['run_started', 'run_finished', 'unread', 'asks', 'queued', 'opening_line', 'run_waits', 'chat_seen'];

test('the pass word: a reply that is nothing else', () => {
  assert.equal(PASS, 'PASS');
  for (const t of ['PASS', 'pass', ' Pass.\n', '**PASS**', '"PASS"', '`PASS`!']) assert.equal(isPass(t), true, t);
  for (const t of ['', null, 'PASS: nothing from me', 'I pass', 'Passed the tests.', 'PASS PASS', 'password']) assert.equal(isPass(t), false, String(t));
});

test('a turn is told who the members are, that it may answer or pass, and to be short', () => {
  const members = [{ id: 'a', name: 'Issue Writer', emoji: '📝', description: 'Writes the issue.' }, { id: 'b', name: 'Coder', emoji: '🧑‍💻', description: '' }, { id: 'c', name: '🙂', emoji: '🙂' }];
  const K = '0f1e2d3c4b5a6978'; // the mark of the prompt, on every line that holds a name (ADR 020, GRP-010)
  const note = turnNote(members[1], { group: { name: 'Dev' }, members, mentioned: false, mark: K });
  assert.match(note, /^You are in a group: one chat of the owner with several bots of their team\./);
  assert.ok(note.includes(`\n[botdot ${K} · the group's name] Dev\n[botdot ${K} · a member] 📝 Issue Writer (@IssueWriter): Writes the issue.\n[botdot ${K} · a member: you] 🧑‍💻 Coder (@Coder)\n[botdot ${K} · a member] 🙂 🙂\n`), note);
  assert.match(note, /Every member reads it and has one turn, one after another/);
  assert.match(note, /reply with the single word PASS and nothing else/);
  assert.match(note, /Be short/);
  assert.match(turnNote(members[1], { group: { name: 'Dev' }, members, mentioned: true }), /named you in it/);
});

test('a message without a mention is kept once and gives every member one turn, in order and one after another; a pass is in no chat, preview or count', async (t) => {
  const { group, bots: [writer, coder, reviewer] } = await team(srv, 'Dev', ['Issue Writer', 'Coder', 'Reviewer']);
  // Coder's own chat with the owner, which no turn is handed.
  reply(srv, coder, 'The branch is feature/secret-plan.');
  await srv.finished((await srv.api(`/bots/${coder.id}/run`, { method: 'POST', body: { prompt: 'Which branch?' } })).data.id);
  await srv.api('/read', { method: 'POST', body: { app: 'test-app', chat: `bot:${coder.id}` } });
  await srv.api('/read', { method: 'POST', body: { app: 'test-app', chat: null } });
  reply(srv, writer, 'I will write the issue.');
  reply(srv, coder, 'PASS');
  reply(srv, reviewer, 'I will review it when it is written.');
  const f = feed(srv);
  t.after(() => f.close());
  await f.wait('hello');

  const text = 'The settings page needs a dark mode switch.';
  const sent = await send(srv, group, { text, key: 'dark-mode-1' });
  assert.equal(sent.status, 201);
  const ids = [writer.id, coder.id, reviewer.id];
  assert.deepEqual(sent.data, { id: sent.data.id, text, at: sent.data.at, to: ids, waitsFor: [], next: [coder.id, reviewer.id], canTakeBack: false });
  // Sent again with its key: taken once.
  const again = await send(srv, group, { text, key: 'dark-mode-1' });
  assert.deepEqual([again.status, again.data.again, again.data.id], [200, true, sent.data.id]);
  const c = await settled(srv, group, sent.data.id);

  // Kept once, with the turns given: one each, in the group's order.
  const [m, ...others] = kept(srv, group);
  assert.deepEqual([others.length, m.text, m.key, m.to, m.line, m.turns.map((x) => x.botId), m.done], [0, text, 'dark-mode-1', ids, [], ids, true]);
  const turns = [];
  for (const x of m.turns) turns.push(await runOf(srv, x.runId));
  assert.deepEqual(turns.map((r) => [r.botId, r.groupId, r.groupMessageId, r.status, r.trigger, r.prompt]), ids.map((id) => [id, group.id, m.id, 'success', 'manual', text]));
  for (let i = 1; i < turns.length; i++) assert.ok(turns[i].startedAt >= turns[i - 1].endedAt, `turn ${i + 1} started when turn ${i} had ended`);
  // What each run was handed: the owner's message alone, and the group's rules in place of its own chat.
  for (const bot of [writer, coder, reviewer]) {
    const ran = ranOf(srv, bot).filter((x) => x.stdin === text);
    assert.equal(ran.length, 1, `${bot.name} had one turn`);
    assert.match(ran[0].system, /You are in a group: [^\n]+\n\[botdot [0-9a-f]{16} · the group's name\] Dev\n/);
    assert.ok(ran[0].system.includes('(@IssueWriter)') && ran[0].system.includes('(@Coder)') && ran[0].system.includes('(@Reviewer)'));
    assert.match(ran[0].system, /reply with the single word PASS and nothing else/);
    assert.match(ran[0].system, /Be short/);
    assert.match(ran[0].system, new RegExp(`<main-assignment>\\nDo the work of ${bot.name}\\.`));
    assert.doesNotMatch(ran[0].system, /secret-plan|Which branch|<conversation>|The owner has sent you a message/);
  }

  // The chat: the owner's message and the two replies, each with its bot, its time and how it ended. No pass.
  const [passed] = turns.filter((r) => r.botId === coder.id);
  assert.deepEqual(c.items.map((x) => [x.type, x.id]), [['message', m.id], ['reply', turns[0].id], ['reply', turns[2].id]]);
  assert.deepEqual(repliesIn(c).map((x) => [x.run.botId, x.run.botName, x.run.status, x.run.result, !!x.run.endedAt, x.at === x.run.startedAt]), [
    [writer.id, 'Issue Writer', 'success', 'I will write the issue.', true, true], [reviewer.id, 'Reviewer', 'success', 'I will review it when it is written.', true, true]]);
  assert.deepEqual([passed.passed, passed.quiet, passed.result], [true, true, 'PASS'], 'the pass has a run record, marked');
  assert.deepEqual((await srv.api(`/runs?group=${group.id}`)).data.map((r) => r.id).sort(), [turns[0].id, turns[2].id].sort());
  // New replies: two, the first of them the first reply; the list's preview names the bot of the newest.
  const g = await groupOf(srv, group);
  assert.deepEqual([g.unread, g.firstUnread, c.unread, c.firstUnread, g.working], [2, turns[0].id, 2, turns[0].id, []]);
  assert.deepEqual(g.last, { runId: turns[2].id, botId: reviewer.id, botName: 'Reviewer', status: 'success', at: turns[2].endedAt, text: 'I will review it when it is written.' });
  assert.deepEqual((await srv.api('/group-chats')).data.find((x) => x.id === group.id), g);
  // Nothing of it in a member's own chat.
  const own = (await srv.api(`/bots/${coder.id}`)).data;
  assert.deepEqual([own.unread, own.queued, (await srv.api(`/runs?botId=${coder.id}`)).data.map((r) => r.prompt)], [0, [], ['Which branch?']]);
  const hits = (await srv.api('/search?q=dark&groups=1')).data.map((h) => h.runId);
  assert.ok(hits.includes(turns[0].id) && !hits.includes(passed.id), 'a pass is no search hit');

  // The feed: events of a group, marked as ones that do not notify; nothing an app from before groups acts on.
  const ended = f.events.filter((e) => e.type === 'group_run_finished').map((e) => e.data);
  assert.deepEqual(ended.map((d) => [d.botId, d.botName, d.chat, d.notify, d.new, d.passed, d.quiet, d.result]), [
    [writer.id, 'Issue Writer', `group:${group.id}`, false, true, undefined, false, 'I will write the issue.'],
    [coder.id, 'Coder', `group:${group.id}`, false, undefined, true, true, ''],
    [reviewer.id, 'Reviewer', `group:${group.id}`, false, true, undefined, false, 'I will review it when it is written.']]);
  assert.deepEqual(f.events.filter((e) => e.type === 'group_run_started').map((e) => e.data.botId), ids);
  assert.deepEqual(f.events.filter((e) => e.type === 'group_unread').map((e) => [e.data.chat, e.data.groupId, e.data.unread, e.data.firstUnread]), [
    [`group:${group.id}`, group.id, 1, turns[0].id], [`group:${group.id}`, group.id, 2, turns[0].id]]);
  assert.deepEqual(f.events.filter((e) => OLD.includes(e.type)), []);
  const told = f.events.filter((e) => e.type === 'group_message').map((e) => e.data);
  assert.deepEqual([told[0].message.id, told[0].chat, told[0].groupId, told.at(-1).message.next], [m.id, `group:${group.id}`, group.id, []]);

  // One read position: an app that shows the group reads it, for every app, and a reply that lands meanwhile is read at once.
  const read = await srv.api('/read', { method: 'POST', body: { app: 'test-app', chat: `group:${group.id}` } });
  assert.equal(read.status, 200);
  assert.deepEqual([(await groupOf(srv, group)).unread, (await chatOf(srv, group)).firstUnread], [0, null]);
  const zero = (await f.wait('group_unread', (d) => d.unread === 0)).data;
  assert.deepEqual([zero.chat, zero.firstUnread, zero.readAt], [`group:${group.id}`, null, read.data.readAt]);
  const next = await send(srv, group, { text: '@IssueWriter and now?' });
  await settled(srv, group, next.data.id);
  const seen = (await f.wait('group_run_finished', (d) => d.groupMessageId === next.data.id)).data;
  assert.deepEqual([seen.new, seen.notify, (await groupOf(srv, group)).unread], [undefined, false, 0]);
  await srv.api('/read', { method: 'POST', body: { app: 'test-app', chat: null } });
  assert.deepEqual(f.events.filter((e) => OLD.includes(e.type)), []);
});

test('with mentions only the members named have a turn, in the group\'s order', async () => {
  const { group, bots: [alfa, bravo, charlie] } = await team(srv, 'Mentions', ['Alfa One', 'Bravo', 'Charlie']);
  const outside = await makeBot(srv, { name: 'Outsider', emoji: '🚪' });
  const one = await send(srv, group, { text: '@Bravo which branch are you on?' });
  assert.deepEqual([one.data.to, one.data.next], [[bravo.id], []]);
  await settled(srv, group, one.data.id);
  // Two, named in the other order, and one twice: the group's order, one turn each.
  const two = await send(srv, group, { text: '@charlie and @AlfaOne, and @Charlie again: have a look.' });
  assert.deepEqual(two.data.to, [alfa.id, charlie.id]);
  const c = await settled(srv, group, two.data.id);
  assert.deepEqual(repliesIn(c).map((x) => [x.run.botId, x.run.groupMessageId]), [[bravo.id, one.data.id], [alfa.id, two.data.id], [charlie.id, two.data.id]]);
  assert.deepEqual([ranOf(srv, alfa).length, ranOf(srv, bravo).length, ranOf(srv, charlie).length], [1, 1, 1]);
  // A bot that is no member names nobody: every member has a turn, and the outsider none.
  const three = await send(srv, group, { text: '@Outsider is not here.' });
  assert.deepEqual(three.data.to, [alfa.id, bravo.id, charlie.id]);
  await settled(srv, group, three.data.id);
  assert.equal(ranOf(srv, outside).length, 0);
});

test('a turn that fails says so under its bot\'s name, and the next member\'s turn starts; a paused member is skipped', async () => {
  const { group, bots: [first, broken, paused, last] } = await team(srv, 'Failing', ['First', 'Broken', 'Paused One', 'Last']);
  fails(srv, broken, 'It fell over.');
  // Paused: it has jobs, and all are switched off.
  const job = (await srv.api(`/bots/${paused.id}/jobs`, { method: 'POST', body: { name: 'Nightly', kind: 'ai', cron: '0 3 * * *', prompt: 'Do it.' } })).data;
  await srv.api(`/bots/${paused.id}/jobs/${job.id}`, { method: 'PUT', body: { enabled: false } });
  assert.equal((await srv.api(`/bots/${paused.id}`)).data.state, 'paused');
  const sent = await send(srv, group, { text: 'Is everything all right?' });
  const c = await settled(srv, group, sent.data.id);
  assert.deepEqual(repliesIn(c).map((x) => [x.run.botName, x.run.status]), [['First', 'success'], ['Broken', 'error'], ['Last', 'success']]);
  const failed = repliesIn(c)[1].run;
  assert.match(failed.error, /It fell over\./);
  assert.match(failed.problem, /Something went wrong and I couldn't finish/);
  assert.equal(ranOf(srv, paused).length, 0, 'the paused member had no turn');
  assert.deepEqual(kept(srv, group)[0].turns.map((x) => x.botId), [first.id, broken.id, last.id]);
  // A failed turn is a new reply, as in a bot's chat, and the newest reply of the list is the last member's.
  const g = await groupOf(srv, group);
  assert.deepEqual([g.unread, g.last.botName], [3, 'Last']);
});

test('a busy member is waited for, in its own queue as a kind of its own, and the members after it go ahead; a member deleted before its turn is skipped', async (t) => {
  const { group, bots: [early, busy, late] } = await team(srv, 'Busy', ['Early', 'Busy One', 'Late']);
  t.after(() => letGo(srv, busy));
  hold(srv, busy);
  const own = (await srv.api(`/bots/${busy.id}/run`, { method: 'POST', body: { prompt: 'Something long, in its own chat' } })).data;
  await waitFor(() => ranOf(srv, busy).length === 1, { what: 'its own run to be going' });
  const f = feed(srv);
  t.after(() => f.close());
  await f.wait('hello');
  const sent = await send(srv, group, { text: 'A question for all of you.' });
  // The line went past it: Early and Late had their turns while it works.
  const c = await waitFor(async () => { const x = await chatOf(srv, group); return repliesIn(x).length === 2 && !x.working.length ? x : null; }, { what: 'the two free members to answer' });
  assert.deepEqual(repliesIn(c).map((x) => x.run.botName), ['Early', 'Late']);
  // The chat says whom the message still waits for; the turn is in that member's queue, with its group and message.
  const m = messageIn(c, sent.data.id);
  assert.deepEqual([m.waitsFor, m.next, m.canTakeBack], [[busy.id], [], false]);
  const [item, ...rest] = waitingIn(srv, busy);
  const turn = kept(srv, group)[0].turns.find((x) => x.botId === busy.id);
  assert.deepEqual([rest.length, item.kind, item.key, item.runId, item.groupId, item.groupMessageId, item.prompt], [0, 'turn', `turn:${turn.runId}`, turn.runId, group.id, sent.data.id, 'A question for all of you.']);
  assert.ok((await f.wait('group_message', (d) => d.message.waitsFor.length === 1)).data.message.waitsFor.includes(busy.id));
  // It is no waiting message of the bot's own chat, and is not taken back there.
  assert.deepEqual((await srv.api(`/bots/${busy.id}`)).data.queued, []);
  assert.equal((await srv.api(`/bots/${busy.id}/queued/${turn.runId}`, { method: 'DELETE' })).status, 404);
  assert.deepEqual([(await runOf(srv, turn.runId)).status, (await runOf(srv, turn.runId)).groupId], ['queued', group.id]);
  // Free again: its turn starts by itself, and the message waits for nobody.
  letGo(srv, busy);
  await srv.finished(own.id);
  const done = await settled(srv, group, sent.data.id);
  assert.deepEqual(repliesIn(done).map((x) => [x.run.botName, x.run.id === turn.runId]), [['Early', false], ['Late', false], ['Busy One', true]]);
  assert.deepEqual(waitingIn(srv, busy), []);
  assert.deepEqual(f.events.filter((e) => OLD.includes(e.type) && e.data.id !== own.id && e.data.botId === busy.id && e.type !== 'queued' && e.type !== 'asks' && e.type !== 'unread'), []);

  // A member that is deleted while its turn was still to come is skipped: the line ends without it.
  t.after(() => letGo(srv, early));
  hold(srv, early);
  const second = await send(srv, group, { text: 'One more thing, all of you.' });
  await atWork(srv, group, [early]);
  assert.deepEqual(messageIn(await chatOf(srv, group), second.data.id).next, [busy.id, late.id]);
  assert.equal((await srv.api(`/bots/${busy.id}`, { method: 'DELETE' })).status, 200);
  assert.deepEqual(messageIn(await chatOf(srv, group), second.data.id).next, [late.id]);
  letGo(srv, early);
  const after = await settled(srv, group, second.data.id);
  assert.deepEqual(repliesIn(after).filter((x) => x.run.groupMessageId === second.data.id).map((x) => x.run.botName), ['Early', 'Late']);
  assert.deepEqual((await groupOf(srv, group)).members, [early.id, late.id]);
  assert.equal(ranOf(srv, busy).length, 2, 'no turn of the deleted bot started');
});

test("a turn that waited does not start beside another turn of its message, and holds up nothing else of its bot", async (t) => {
  const { group, bots: [, mid, end] } = await team(srv, 'One at a time', ['Head', 'Mid', 'End']);
  t.after(() => { letGo(srv, mid); letGo(srv, end); });
  hold(srv, mid);
  hold(srv, end);
  const own = (await srv.api(`/bots/${mid.id}/run`, { method: 'POST', body: { prompt: 'Something long' } })).data;
  await waitFor(() => ranOf(srv, mid).length === 1, { what: "Mid's own run to be going" });
  const sent = await send(srv, group, { text: 'All of you, please.' });
  // Head answered, Mid's turn waits for it, End is at work on the message.
  await atWork(srv, group, [end]);
  await waitFor(() => ranOf(srv, end).length === 1, { what: "End's turn to be going" });
  // The member at work is listed with its opening line, once it has one (docs/api.md, The opening line).
  const [rec] = ranOf(srv, end);
  fs.writeFileSync(path.join(srv.out, `events-${rec.n}.json`), JSON.stringify([
    { type: 'assistant', message: { content: [{ type: 'text', text: 'Reading the diff.' }] } },
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a.js' } }] } }]));
  const [working] = (await waitFor(async () => { const x = await chatOf(srv, group); return x.working[0]?.workingLine ? x : null; }, { what: "End's opening line" })).working;
  assert.deepEqual(working, { botId: end.id, runId: working.runId, messageId: sent.data.id, startedAt: working.startedAt, openingLine: 'Reading the diff', workingLine: 'Reading the diff' });
  // Mid is free again while End's turn is still going: its turn stays where it is.
  letGo(srv, mid);
  await srv.finished(own.id);
  await sleep(200); // past the moment its turn would have started
  let c = await chatOf(srv, group);
  assert.deepEqual([c.working.map((w) => w.botId), messageIn(c, sent.data.id).waitsFor, ranOf(srv, mid).length], [[end.id], [mid.id], 1]);
  assert.deepEqual(waitingIn(srv, mid).map((x) => x.kind), ['turn']);
  // What else is asked of Mid meanwhile starts at once: the held turn is not in its way.
  const other = (await srv.api(`/bots/${mid.id}/run`, { method: 'POST', body: { prompt: 'In your own chat' } })).data;
  assert.equal((await srv.finished(other.id)).status, 'success');
  assert.deepEqual(waitingIn(srv, mid).map((x) => x.kind), ['turn']);
  // End's turn ends: now Mid's starts.
  letGo(srv, end);
  c = await settled(srv, group, sent.data.id);
  const runs = repliesIn(c).map((x) => x.run);
  assert.deepEqual(runs.map((r) => r.botName), ['Head', 'End', 'Mid']);
  assert.ok(runs[2].startedAt >= runs[1].endedAt, "Mid's turn started when End's had ended");
});

test('a member that is paused, taken out of the group or deleted while its turn waited is skipped, and leaves nothing', async (t) => {
  const { group, bots: [lead, ben, cal, dan, eve] } = await team(srv, 'Leaving', ['Lead', 'Ben', 'Cal', 'Dan', 'Eve']);
  t.after(() => { for (const b of [ben, cal, dan, eve]) letGo(srv, b); });
  // Ben, Cal and Dan are busy in their own chats, so their turns wait; Eve is at work on the message.
  const own = [];
  for (const b of [ben, cal, dan]) {
    hold(srv, b);
    own.push((await srv.api(`/bots/${b.id}/run`, { method: 'POST', body: { prompt: 'Something long' } })).data);
    await waitFor(() => ranOf(srv, b).length === 1, { what: `${b.name}'s own run to be going` });
  }
  hold(srv, eve);
  const sent = await send(srv, group, { text: 'All five of you.' });
  await atWork(srv, group, [eve]);
  await waitFor(() => ranOf(srv, eve).length === 1, { what: "Eve's turn to be going" });
  assert.deepEqual(messageIn(await chatOf(srv, group), sent.data.id).waitsFor, [ben.id, cal.id, dan.id]);
  // Ben is paused, and Cal is taken out of the group: the message waits for neither of them any more.
  const job = (await srv.api(`/bots/${ben.id}/jobs`, { method: 'POST', body: { name: 'Nightly', kind: 'ai', cron: '0 3 * * *', prompt: 'Do it.' } })).data;
  await srv.api(`/bots/${ben.id}/jobs/${job.id}`, { method: 'PUT', body: { enabled: false } });
  assert.equal((await srv.api(`/group-chats/${group.id}`, { method: 'PUT', body: { members: [lead.id, ben.id, dan.id, eve.id] } })).status, 200);
  assert.deepEqual(messageIn(await chatOf(srv, group), sent.data.id).waitsFor, [ben.id, dan.id]);
  // All three are free again while Eve's turn still holds theirs. Dan is deleted: a free bot, with its turn waiting.
  for (const b of [ben, cal, dan]) letGo(srv, b);
  for (const r of own) await srv.finished(r.id);
  assert.deepEqual([waitingIn(srv, ben).length, waitingIn(srv, cal).length, waitingIn(srv, dan).length], [1, 1, 1]);
  assert.equal((await srv.api(`/bots/${dan.id}`, { method: 'DELETE' })).status, 200);
  // Eve's turn ends: none of the three has a turn, and the line is done.
  letGo(srv, eve);
  const c = await settled(srv, group, sent.data.id);
  assert.deepEqual(repliesIn(c).map((x) => x.run.botName), ['Lead', 'Eve']);
  assert.deepEqual([ranOf(srv, ben).length, ranOf(srv, cal).length, ranOf(srv, dan).length], [1, 1, 1], 'their own runs alone');
  assert.deepEqual([waitingIn(srv, ben), waitingIn(srv, cal)], [[], []]);
  const [m] = kept(srv, group);
  assert.deepEqual([m.done, m.turns.map((x) => [x.botId, !!x.dropped])], [true, [[lead.id, false], [ben.id, true], [cal.id, true], [dan.id, true], [eve.id, false]]]);
  assert.equal((await groupOf(srv, group)).unread, 2);
  assert.deepEqual((await srv.api(`/runs?botId=${ben.id}`)).data.length, 1, 'no failed run in its own chat either');
});

test('the owner takes back a message none of whose turns has started; ten of the owner\'s messages wait for one member, and the next is refused', async (t) => {
  const { group, bots: [slow, quick] } = await team(srv, 'Waiting', ['Slow One', 'Quick']);
  t.after(() => letGo(srv, slow));
  hold(srv, slow);
  const own = (await srv.api(`/bots/${slow.id}/run`, { method: 'POST', body: { prompt: 'Something long' } })).data;
  await waitFor(() => ranOf(srv, slow).length === 1, { what: 'its own run to be going' });
  const f = feed(srv);
  t.after(() => f.close());
  await f.wait('hello');

  // Only that member is named and it is busy: no turn has started, so the message can be taken back.
  const first = await send(srv, group, { text: '@SlowOne are you there?', key: 'are-you-there-1' });
  assert.deepEqual([first.status, first.data.waitsFor, first.data.canTakeBack], [201, [slow.id], true]);
  const back = await srv.api(`/group-chats/${group.id}/messages/${first.data.id}`, { method: 'DELETE' });
  assert.deepEqual([back.status, back.data], [200, { text: '@SlowOne are you there?', attachments: [] }]);
  assert.deepEqual([kept(srv, group), waitingIn(srv, slow), (await chatOf(srv, group)).items], [[], [], []]);
  const gone1 = (await f.wait('group_message_gone')).data;
  assert.deepEqual([gone1.chat, gone1.groupId, gone1.id], [`group:${group.id}`, group.id, first.data.id]);
  assert.equal((await srv.api(`/group-chats/${group.id}/messages/${first.data.id}`, { method: 'DELETE' })).status, 404);
  // Its key is free again: the same message may be sent anew.
  const anew = await send(srv, group, { text: '@SlowOne are you there?', key: 'are-you-there-1' });
  assert.deepEqual([anew.status, anew.data.id !== first.data.id, anew.data.again], [201, true, undefined]);
  // A message one of whose turns has started is not taken back.
  const both = await send(srv, group, { text: 'Both of you.' });
  await waitFor(async () => repliesIn(await chatOf(srv, group)).length === 1, { what: "Quick's reply" });
  const refused = await srv.api(`/group-chats/${group.id}/messages/${both.data.id}`, { method: 'DELETE' });
  assert.deepEqual([refused.status, refused.data.error], [409, 'It has already started.']);

  // Ten of the owner's wait for Slow One now or soon: two are there, eight more, and the eleventh is refused.
  for (let i = 3; i <= 10; i++) assert.equal((await send(srv, group, { text: `@SlowOne number ${i}` })).status, 201);
  assert.deepEqual(waitingIn(srv, slow).map((x) => x.kind), Array(10).fill('turn'));
  const eleventh = await send(srv, group, { text: '@SlowOne number 11', key: 'number-eleven-1' });
  assert.deepEqual([eleventh.status, eleventh.data.error], [429, 'Slow One already has 10 of your messages waiting. Take one back, or wait.']);
  assert.equal(kept(srv, group).length, 10, 'nothing of it was kept');
  // The ten are the owner's, in the bot's own chat too: a message there is refused the same way.
  assert.equal((await srv.api(`/bots/${slow.id}/run`, { method: 'POST', body: { prompt: 'And in your own chat' } })).status, 429);
  // A message for both is refused whole: Quick gets no turn on it.
  const quickRuns = ranOf(srv, quick).length;
  assert.equal((await send(srv, group, { text: 'Both of you, again.' })).status, 429);
  // A Stop on one waiting turn takes that turn away, and its message is done.
  const [gone] = waitingIn(srv, slow);
  assert.deepEqual((await srv.api(`/runs/${gone.runId}/stop`, { method: 'POST' })).data, { ok: true });
  assert.equal(waitingIn(srv, slow).length, 9);
  assert.deepEqual(kept(srv, group).find((x) => x.id === gone.groupMessageId).turns.map((x) => [x.runId, x.dropped]), [[gone.runId, true]]);
  // The refused key was not taken: with a place free the same message is taken.
  assert.equal((await send(srv, group, { text: '@SlowOne number 11', key: 'number-eleven-1' })).status, 201);
  assert.equal(ranOf(srv, quick).length, quickRuns);
  // Taken back, all but one; that one starts when the member is free.
  const still = kept(srv, group).filter((x) => !x.done && x.to.length === 1);
  for (const x of still.slice(1)) assert.equal((await srv.api(`/group-chats/${group.id}/messages/${x.id}`, { method: 'DELETE' })).status, 200);
  letGo(srv, slow);
  await srv.finished(own.id);
  await settled(srv, group, still[0].id);
  await settled(srv, group, both.data.id);
  assert.deepEqual(waitingIn(srv, slow), []);
});

test('"Stop all" ends every run of the group at work, each ended by the owner, and drops the turns behind them; a message none of whose turns started is untouched', async (t) => {
  const { group, bots: [anna, ben, cleo] } = await team(srv, 'Stopping', ['Anna', 'Ben', 'Cleo']);
  t.after(() => { letGo(srv, anna); letGo(srv, ben); });
  hold(srv, anna);
  hold(srv, ben);
  // Two lines side by side: Anna at work on the first, with Cleo to follow, and Ben on the second.
  const one = await send(srv, group, { text: '@Anna and @Cleo: the first thing.' });
  const two = await send(srv, group, { text: '@Ben the second thing.' });
  await atWork(srv, group, [anna, ben]);
  // A third message waits for Anna, who is busy: none of its turns has started.
  const three = await send(srv, group, { text: '@Anna the third thing.' });
  assert.deepEqual([three.data.waitsFor, three.data.canTakeBack], [[anna.id], true]);
  assert.deepEqual((await groupOf(srv, group)).working.sort(), [anna.id, ben.id].sort());

  const stopped = await srv.api(`/group-chats/${group.id}/stop`, { method: 'POST' });
  assert.deepEqual([stopped.status, stopped.data], [200, { ok: true, stopped: 2, dropped: 1 }]);
  // Both runs are ended by the owner, and Cleo's turn never starts.
  const c = await waitFor(async () => { const x = await chatOf(srv, group); return repliesIn(x).length === 2 ? x : null; }, { what: 'both runs to end' });
  assert.deepEqual(repliesIn(c).map((x) => [x.run.botName, x.run.status, x.run.endedBy, x.run.problem]), [
    ['Anna', 'stopped', 'owner', 'You stopped this run before it finished.'], ['Ben', 'stopped', 'owner', 'You stopped this run before it finished.']]);
  assert.deepEqual([messageIn(c, one.data.id).stopped, messageIn(c, one.data.id).next, messageIn(c, two.data.id).stopped], [true, [], true]);
  // The message that waited is the owner's: it starts now that Anna is free.
  await atWork(srv, group, [anna]);
  const waited = messageIn(await chatOf(srv, group), three.data.id);
  assert.deepEqual([waited.stopped, waited.waitsFor, waited.canTakeBack], [undefined, [], false]);
  letGo(srv, anna);
  const done = await settled(srv, group, three.data.id);
  assert.deepEqual(repliesIn(done).map((x) => [x.run.botName, x.run.status, x.run.groupMessageId]), [['Anna', 'stopped', one.data.id], ['Ben', 'stopped', two.data.id], ['Anna', 'success', three.data.id]]);
  assert.equal(ranOf(srv, cleo).length, 0, 'the turn to follow never started');
  assert.deepEqual(kept(srv, group).map((x) => [x.done, !!x.stopped]), [[true, true], [true, true], [true, false]]);
  // With nothing at work it stops nothing.
  assert.deepEqual((await srv.api(`/group-chats/${group.id}/stop`, { method: 'POST' })).data, { ok: true, stopped: 0, dropped: 0 });
});

test('what is refused, and whose routes these are', async () => {
  const { group, bots: [only, other] } = await team(srv, 'Refusals', ['Only', 'Other']);
  for (const body of [{}, { text: '' }, { text: '   ' }, { text: 7 }, null]) {
    const r = await send(srv, group, body);
    assert.deepEqual([r.status, r.data.error], [400, 'Write a message first.'], JSON.stringify(body));
  }
  assert.equal((await send(srv, group, { text: 'x'.repeat(20_001) })).status, 400);
  assert.equal((await send(srv, group, { text: 'Hello', key: 'short' })).status, 400, 'an ill-formed key');
  assert.deepEqual(kept(srv, group), []);
  for (const [method, p] of [['POST', 'messages'], ['GET', 'chat'], ['POST', 'stop'], ['DELETE', 'messages/m1']]) {
    assert.equal((await srv.api(`/group-chats/nope/${p}`, { method, ...(method === 'POST' ? { body: { text: 'Hello' } } : {}) })).status, 404, `${method} ${p} of no group`);
    assert.equal((await srv.asChief(`/group-chats/${group.id}/${p}`, { method, ...(method === 'POST' ? { body: { text: 'Hello' } } : {}) })).status, 403, `${method} ${p} by the Chief`);
  }
  // A group whose bots are all gone takes no message.
  await srv.api(`/bots/${only.id}`, { method: 'DELETE' });
  await srv.api(`/bots/${other.id}`, { method: 'DELETE' });
  const empty = await send(srv, group, { text: 'Anybody?' });
  assert.deepEqual([empty.status, empty.data.error], [400, 'Refusals has no bots left. Add one, or delete the group.']);
  // Deleting a group takes the owner's messages with it.
  const { group: gone, bots: [x] } = await team(srv, 'Going', ['Xavier', 'Yara']);
  const sent = await send(srv, gone, { text: '@Xavier hello' });
  await settled(srv, gone, sent.data.id);
  assert.equal(fs.existsSync(path.join(srv.data, 'group-messages', `${gone.id}.json`)), true);
  await srv.api(`/group-chats/${gone.id}`, { method: 'DELETE' });
  assert.equal(fs.existsSync(path.join(srv.data, 'group-messages', `${gone.id}.json`)), false);
  assert.equal((await srv.api(`/runs?botId=${x.id}`)).data.length, 0, "the turn is still no part of the bot's own chat");
});

test('a message that all six members pass on is finished in under 10 seconds', async () => {
  const own = await startServer();
  try {
    const { group } = await team(own, 'Six', ['One', 'Two', 'Three', 'Four', 'Five', 'Six']);
    own.reply('PASS');
    const from = Date.now();
    const sent = await send(own, group, { text: 'Anything to add?' });
    const c = await settled(own, group, sent.data.id, 10_000);
    const took = Date.now() - from;
    assert.ok(took < 10_000, `it took ${took} ms`);
    assert.deepEqual(c.items.map((x) => x.type), ['message']);
    const m = kept(own, group)[0];
    assert.deepEqual([m.turns.length, m.done], [6, true]);
    for (const x of m.turns) assert.equal((await runOf(own, x.runId)).passed, true);
    const g = await groupOf(own, group);
    assert.deepEqual([g.unread, g.firstUnread, g.last], [0, null, null]);
  } finally { await own.stop(); }
});

test('after a restart a waiting turn starts, a run that was cut says so, the line goes on with the next member, and no member has two turns', async () => {
  let own = await startServer();
  try {
    const { group, bots: [a, b, c, d] } = await team(own, 'Restart', ['Ada', 'Bob', 'Cyd', 'Dee']);
    hold(own, b);
    hold(own, c);
    const ownRun = (await own.api(`/bots/${b.id}/run`, { method: 'POST', body: { prompt: 'Something long' } })).data;
    await waitFor(() => ranOf(own, b).length === 1, { what: "Bob's own run to be going" });
    const text = 'Where do we stand?';
    const sent = await send(own, group, { text });
    // Ada answered, Bob's turn waits for him, Cyd is at work and Dee's turn has not come.
    await atWork(own, group, [c]);
    await waitFor(() => ranOf(own, c).length === 1, { what: "Cyd's turn to be going" });
    const before = messageIn(await chatOf(own, group), sent.data.id);
    assert.deepEqual([before.waitsFor, before.next], [[b.id], [d.id]]);
    const turns = () => kept(own, group)[0].turns;
    assert.deepEqual(turns().map((x) => x.botId), [a.id, b.id, c.id]);
    const cut = turns()[2].runId;

    await own.stop();
    letAllGo(own);
    own = await startServer({ dir: own.dir });
    const done = await settled(own, group, sent.data.id);
    assert.deepEqual(repliesIn(done).map((x) => [x.run.botName, x.run.status]).sort(), [['Ada', 'success'], ['Bob', 'success'], ['Cyd', 'interrupted'], ['Dee', 'success']]);
    assert.equal(repliesIn(done).find((x) => x.id === cut).run.problem, 'This run was cut off because botdot was restarted.');
    assert.equal((await runOf(own, ownRun.id)).status, 'interrupted');
    assert.deepEqual(turns().map((x) => x.botId), [a.id, b.id, c.id, d.id], 'one turn each');
    for (const bot of [a, b, c, d]) assert.equal(ranOf(own, bot).filter((x) => x.stdin === text).length, 1, `${bot.name} was started once on it`);
    assert.deepEqual(waitingIn(own, b), []);
    await sleep(300);
    assert.equal(own.runs().filter((x) => x.stdin === text).length, 4, 'and none again');

    // A turn that was written and never started (botdot stopped in between) is given again, under the same id,
    // and the line goes on after it: one turn at a time.
    await own.stop();
    const file = path.join(own.data, 'group-messages', `${group.id}.json`);
    const lost = { id: '20261008000000-lost00', text: 'A turn was lost here.', at: new Date().toISOString(), to: [a.id, d.id], line: [d.id], turns: [{ botId: a.id, runId: '20261008000000-lost01' }] };
    fs.writeFileSync(file, JSON.stringify([...JSON.parse(fs.readFileSync(file, 'utf8')), lost]));
    own = await startServer({ dir: own.dir });
    const found = repliesIn(await settled(own, group, lost.id)).filter((x) => x.run.groupMessageId === lost.id).map((x) => x.run);
    assert.deepEqual(found.map((r) => [r.botName, r.status, r.prompt]), [['Ada', 'success', lost.text], ['Dee', 'success', lost.text]]);
    assert.equal(found[0].id, '20261008000000-lost01');
    assert.ok(found[1].startedAt >= found[0].endedAt);
    assert.equal(own.runs().filter((x) => x.stdin === lost.text).length, 2);

    // While Claude is signed out a message is taken and its turns wait; they start after the sign-in.
    const signedOut = path.join(own.out, 'signed-out');
    fs.writeFileSync(signedOut, '');
    await own.api('/setup/claude', { method: 'DELETE' });
    const late = await send(own, group, { text: 'And now?' });
    assert.deepEqual([late.status, late.data.next, late.data.waitsFor, late.data.canTakeBack], [201, [a.id, b.id, c.id, d.id], [], true]);
    await sleep(300); // past the moment a turn would have started
    assert.equal(own.runs().filter((x) => x.stdin === 'And now?').length, 0);
    fs.rmSync(signedOut);
    assert.equal((await own.api('/setup?fresh')).data.claude.loggedIn, true);
    const after = await settled(own, group, late.data.id);
    assert.deepEqual(repliesIn(after).filter((x) => x.run.groupMessageId === late.data.id).map((x) => [x.run.botName, x.run.status]), [['Ada', 'success'], ['Bob', 'success'], ['Cyd', 'success'], ['Dee', 'success']]);
  } finally { letAllGo(own); await own.stop(); }
});

test('the chat is read in pages, and its new replies are counted whichever member wrote them, never a pass', async () => {
  let own = await startServer();
  try {
    const { group, bots: [p, q] } = await team(own, 'Pages', ['Pat', 'Quinn']);
    const sent = await send(own, group, { text: '@Pat hello' });
    await settled(own, group, sent.data.id);
    await own.api('/read', { method: 'POST', body: { app: 'test-app', chat: `group:${group.id}` } });
    await own.api('/read', { method: 'POST', body: { app: 'test-app', chat: null } });
    await own.stop();
    // Twenty-four replies written while it was off, by both members, and three passes among them.
    const turn = { groupId: group.id, groupMessageId: sent.data.id };
    const byPat = seedRuns(own, p, [{ ...turn, times: 12 }]);
    await sleep(20);
    seedRuns(own, q, [{ ...turn, passed: true, result: 'PASS', times: 3 }]);
    await sleep(20);
    const byQuinn = [];
    for (let i = 0; i < 12; i++) {
      const id = `seed-quinn-${String(i).padStart(4, '0')}`;
      const at = new Date(Date.now() + i).toISOString();
      fs.writeFileSync(path.join(own.data, 'runs', `${id}.json`), JSON.stringify({ id, botId: q.id, botName: 'Quinn', kind: 'ai', trigger: 'manual', status: i === 11 ? 'error' : 'success', prompt: '@Pat hello', customPrompt: true, startedAt: at, endedAt: at, result: i === 11 ? null : 'An answer.', error: i === 11 ? 'It broke.' : null, notificationAudience: 'owner', ...turn }));
      byQuinn.push(id);
    }
    own = await startServer({ dir: own.dir });
    const all = [...byPat, ...byQuinn];
    // The newest page, and the ones before it by the id of the oldest item held, until there is no more.
    const newest = await chatOf(own, group, '?limit=10');
    assert.deepEqual([newest.items.map((x) => x.id), newest.more], [all.slice(-10), true]);
    const middle = await chatOf(own, group, `?limit=10&before=${newest.items[0].id}`);
    assert.deepEqual([middle.items.map((x) => x.id), middle.more], [all.slice(-20, -10), true]);
    const oldest = await chatOf(own, group, `?limit=10&before=${middle.items[0].id}`);
    assert.deepEqual([oldest.items.length, oldest.items[0].type, oldest.items[0].id, oldest.items.slice(2).map((x) => x.id), oldest.more], [6, 'message', sent.data.id, all.slice(0, 4), false]);
    assert.deepEqual((await chatOf(own, group, '?before=no-such-item')).items, []);
    assert.equal((await chatOf(own, group)).items.length, 26, 'the message, its live reply and 24 more: no pass');
    // New: every reply of both members since the group was read, the failed one too, and no pass.
    const g = await groupOf(own, group);
    assert.deepEqual([g.unread, g.firstUnread, newest.unread, newest.firstUnread, g.last.botName, g.last.status], [24, byPat[0], 24, byPat[0], 'Quinn', 'error']);
    assert.match(g.last.text, /Something went wrong/);
    assert.equal((await own.api(`/bots/${q.id}`)).data.unread, 0);
  } finally { await own.stop(); }
});
