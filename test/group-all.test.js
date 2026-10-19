// "@all" in a group (#124, ADR 019 "Amended by #124"; docs/api.md, Groups): an owner's message that starts with
// "@all" goes to every member at once. Each member answers once and on its own, a busy member's turn waits in its
// own queue without holding up the others, mentions in the replies give nobody a turn, and "Stop all" ends them
// all. A message without it still goes one member after another. Against a real botdot server and the stand-in for
// Claude (test/fixtures/fake-claude.js), which answers and is held for one bot by its name.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, waitFor, readData } = require('./helpers');
const { shortName } = require('../public/mentions.js');
const { turnNote, togetherText } = require('../lib/group-chat');

let srv;
before(async () => { srv = await startServer(); });
after(() => { letAllGo(srv); return srv.stop(); });

const fileOf = (on, kind, bot, ext = '') => path.join(on.out, `${kind}-${shortName(bot.name)}${ext}`);
const reply = (on, bot, text) => fs.writeFileSync(fileOf(on, 'result', bot, '.txt'), text);
const hold = (on, bot) => fs.writeFileSync(fileOf(on, 'hold', bot), '');
const letGo = (on, bot) => fs.rmSync(fileOf(on, 'hold', bot), { force: true });
const letAllGo = (on) => { for (const f of fs.readdirSync(on.out)) if (f === 'hold' || f.startsWith('hold-')) fs.rmSync(path.join(on.out, f), { force: true }); };
const ranOf = (on, bot) => on.runs().filter((x) => x.who === shortName(bot.name));

async function team(on, name, names) {
  const bots = [];
  for (const n of names) bots.push(await makeBot(on, { name: n, emoji: '🤖', prompt: `Do the work of ${n}.` }));
  const made = await on.api('/group-chats', { method: 'POST', body: { name, members: bots.map((b) => b.id) } });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  return { group: made.data, bots };
}
const send = (on, group, body) => on.api(`/group-chats/${group.id}/messages`, { method: 'POST', body });
const chatOf = async (on, group) => (await on.api(`/group-chats/${group.id}/chat`)).data;
const messageIn = (c, id) => c.items.find((x) => x.type === 'message' && x.id === id);
const repliesIn = (c) => c.items.filter((x) => x.type === 'reply');
const settled = (on, group, id) => waitFor(async () => {
  const c = await chatOf(on, group);
  const m = messageIn(c, id);
  return m && !c.working.length && !m.next.length && !m.waitsFor.length ? c : null;
}, { timeout: 20_000, what: `the line of message ${id} to end` });
const atWork = (on, group, bots) => waitFor(async () => {
  const c = await chatOf(on, group);
  return JSON.stringify(c.working.map((w) => w.botId).sort()) === JSON.stringify(bots.map((b) => b.id).sort()) ? c : null;
}, { what: `${bots.map((b) => b.name).join(' and ')} to be at work` });
const kept = (on, group) => readData(on.data, path.join('group-messages', `${group.id}.json`));
const waitingIn = (on, bot) => (readData(on.data, 'queue.json').queues[bot.id] || []);

test('"@all" is the start of a message, in any case, followed by a space or a line', () => {
  assert.equal(togetherText('@all what is the status?'), 'what is the status?');
  assert.equal(togetherText('@ALL\nreport, please'), 'report, please');
  assert.equal(togetherText('@All'), '');
  for (const t of ['@allison look', 'Hi @all', '@all, look', '', null]) assert.equal(togetherText(t), null, String(t));
});

test('a turn of an all-at-once message is told the others answer at the same time, to answer once and hand nothing on', () => {
  const members = [{ id: 'a', name: 'Ops', emoji: '🛠' }, { id: 'b', name: 'Coder', emoji: '🧑‍💻' }];
  const note = turnNote(members[1], { group: { name: 'Dev' }, members, mentioned: false, together: true });
  assert.match(note, /to every member at once/);
  assert.match(note, /at the same time/);
  assert.match(note, /reply with the single word PASS/);
  assert.match(note, /Hand nothing on/);
  assert.match(note, /never change what another member owns/);
  assert.doesNotMatch(note, /one after another|To hand the work on/);
});

test('an "@all" message gives every active member a turn at once; the bots get it without "@all"; mentions in the replies start nothing', async (t) => {
  const { group, bots: [ops, coder, writer, paused] } = await team(srv, 'All at once', ['Ops', 'Coder', 'Writer', 'Sleeper']);
  const job = (await srv.api(`/bots/${paused.id}/jobs`, { method: 'POST', body: { name: 'Nightly', kind: 'ai', cron: '0 3 * * *', prompt: 'Do it.' } })).data;
  await srv.api(`/bots/${paused.id}/jobs/${job.id}`, { method: 'PUT', body: { enabled: false } });
  assert.equal((await srv.api(`/bots/${paused.id}`)).data.state, 'paused');
  t.after(() => letAllGo(srv));
  for (const b of [ops, coder, writer]) hold(srv, b);
  reply(srv, ops, 'All VMs are up. @Coder please check the build.');
  reply(srv, coder, 'The build is green, @Writer and @Ops.');
  reply(srv, writer, 'PASS');

  const sent = await send(srv, group, { text: '@all Whats the status of all vms?' });
  assert.equal(sent.status, 201, JSON.stringify(sent.data));
  assert.deepEqual([sent.data.text, sent.data.together, sent.data.to], ['@all Whats the status of all vms?', true, [ops.id, coder.id, writer.id, paused.id]]);
  // All three at work at once.
  await atWork(srv, group, [ops, coder, writer]);
  for (const b of [ops, coder, writer]) letGo(srv, b);
  const c = await settled(srv, group, sent.data.id);

  // One turn each, nobody handed on, the paused member skipped.
  const [m] = kept(srv, group);
  assert.deepEqual([m.together, m.done, m.handed, m.turns.map((x) => x.botId).sort()], [true, true, undefined, [ops.id, coder.id, writer.id].sort()]);
  assert.deepEqual(repliesIn(c).map((x) => x.run.botName).sort(), ['Coder', 'Ops']);
  for (const b of [ops, coder, writer]) {
    const ran = ranOf(srv, b);
    assert.equal(ran.length, 1, `${b.name} had one turn`);
    assert.equal(ran[0].stdin, 'Whats the status of all vms?');
    assert.match(ran[0].system, /to every member at once/);
  }
  assert.equal(ranOf(srv, paused).length, 0);
});

test('a busy member\'s turn of an "@all" message waits in its queue without holding up the others, and starts beside them', async (t) => {
  const { group, bots: [early, busy, late] } = await team(srv, 'All busy', ['Early All', 'Busy All', 'Late All']);
  t.after(() => letAllGo(srv));
  hold(srv, busy);
  hold(srv, early);
  const own = (await srv.api(`/bots/${busy.id}/run`, { method: 'POST', body: { prompt: 'Something long, in its own chat' } })).data;
  await waitFor(() => ranOf(srv, busy).length === 1, { what: 'its own run to be going' });

  const sent = await send(srv, group, { text: '@ALL report, please' });
  // Early is at work and Late has answered, while Busy's turn waits in its queue.
  await waitFor(async () => { const x = await chatOf(srv, group); return repliesIn(x).length === 1 ? x : null; }, { what: 'Late to answer' });
  const c = await atWork(srv, group, [early]);
  assert.deepEqual(messageIn(c, sent.data.id).waitsFor, [busy.id]);
  const [item] = waitingIn(srv, busy);
  assert.deepEqual([item.kind, item.groupMessageId], ['turn', sent.data.id]);

  // Free again: its turn starts and ends while Early's is still at work.
  letGo(srv, busy);
  await srv.finished(own.id);
  const both = await waitFor(async () => { const x = await chatOf(srv, group); return repliesIn(x).some((r) => r.run.botId === busy.id) ? x : null; }, { what: 'the busy member to answer' });
  assert.deepEqual(both.working.map((w) => w.botId), [early.id]);
  letGo(srv, early);
  const done = await settled(srv, group, sent.data.id);
  assert.deepEqual(repliesIn(done).map((x) => x.run.botName).sort(), ['Busy All', 'Early All', 'Late All']);
});

test('"Stop all" ends every turn of an "@all" message', async (t) => {
  const { group, bots } = await team(srv, 'All stop', ['Stop A', 'Stop B', 'Stop C']);
  t.after(() => letAllGo(srv));
  for (const b of bots) hold(srv, b);
  const sent = await send(srv, group, { text: '@all check your disks' });
  await atWork(srv, group, bots);
  const stopped = await srv.api(`/group-chats/${group.id}/stop`, { method: 'POST' });
  assert.deepEqual([stopped.status, stopped.data], [200, { ok: true, stopped: 3, dropped: 0 }]);
  const c = await settled(srv, group, sent.data.id);
  assert.deepEqual(repliesIn(c).map((x) => [x.run.status, x.run.endedBy]), [['stopped', 'owner'], ['stopped', 'owner'], ['stopped', 'owner']]);
  assert.equal(messageIn(c, sent.data.id).stopped, true);
});

test('a message without "@all" still goes one member after another; a member named All gets no mention', async (t) => {
  const { group, bots: [first, all, last] } = await team(srv, 'One by one', ['First One', 'All', 'Last One']);
  t.after(() => letAllGo(srv));
  hold(srv, first);
  const sent = await send(srv, group, { text: 'Hi @All, what is new?' });
  assert.deepEqual([sent.data.together, sent.data.to], [undefined, [first.id, all.id, last.id]]);
  const c = await atWork(srv, group, [first]);
  assert.deepEqual(messageIn(c, sent.data.id).next, [all.id, last.id]);
  letGo(srv, first);
  await settled(srv, group, sent.data.id);
  // "@all" alone, with nothing after it, is an empty message.
  const empty = await send(srv, group, { text: '@all' });
  assert.deepEqual([empty.status, empty.data.error], [400, 'Write a message first.']);
});
