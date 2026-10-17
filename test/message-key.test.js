// A message sent twice is taken once (QW-008, docs/api.md "A message sent twice"): an app that got no answer
// sends the message again with the key it gave it, and botdot, which took it the first time, starts nothing
// and adds nothing. For a Chief chat and for a bot; a message that waits its turn waits once (ADR 011); a refused
// request does not use its key up; the keys survive a restart and are forgotten after 24 hours.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, makeBot, waitFor } = require('./helpers');
const messageKeys = require('../lib/message-keys');

let srv, bot;
before(async () => {
  srv = await startServer();
  bot = await makeBot(srv, { name: 'Filer', emoji: '🗂️' });
});
after(() => srv.stop());

const post = (p, body) => srv.api(p, { method: 'POST', body });
const newChat = async () => (await post('/chief/chats')).data.id;
const chatOf = async (id) => (await srv.api(`/chief/chats/${id}`)).data;
const mine = (chat) => chat.messages.filter((m) => m.role === 'user').map((m) => m.text);
const replied = (id) => waitFor(async () => { const c = await chatOf(id); return !c.busy && !c.messages.at(-1).pending ? c : null; }, { what: 'the Chief to reply' });
const chiefTurns = () => srv.runs().filter((x) => x.args.includes('🧭 Chief of Staff'));
const runsOf = async () => (await srv.api(`/runs?botId=${bot.id}`)).data;
const allDone = (n) => waitFor(async () => { const r = await runsOf(); return r.length === n && r.every((x) => x.status !== 'running') ? r : null; }, { what: `${n} finished runs` });

test('the features name it', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('message-key'));
});

test('the Chief: a message sent again with its key is in the chat once and starts one turn; one that waits for the reply to end waits once', async () => {
  const id = await newChat();
  const turnsBefore = chiefTurns().length;
  srv.hold(); // the Chief keeps replying: the state in which an app that lost the answer sends again
  const first = await post(`/chief/chats/${id}/messages`, { text: 'File the invoices', key: 'invoice-key-0001' });
  assert.equal(first.status, 201);
  assert.equal(first.data.again, undefined);
  const turn = await srv.nextRun((x) => x.args.includes('🧭 Chief of Staff'), 'the Chief\'s turn');

  const second = await post(`/chief/chats/${id}/messages`, { text: 'File the invoices', key: 'invoice-key-0001' });
  assert.equal(second.status, 200, 'it has this message');
  assert.equal(second.data.again, true);
  assert.equal(second.data.id, id, 'answered with the chat, as the first was');
  assert.deepEqual(mine(second.data), ['File the invoices']);

  // Another message while the Chief replies is not refused: it waits its turn (ADR 011), and its key is kept
  // in the step that took it. Sent again, also several at once, it waits once.
  const waits = await post(`/chief/chats/${id}/messages`, { text: 'And the overdue ones?', key: 'overdue-key-0002' });
  assert.deepEqual([waits.status, waits.data.again, waits.data.queued.map((q) => q.text)], [201, undefined, ['And the overdue ones?']]);
  assert.deepEqual(mine(waits.data), ['File the invoices'], 'not in the chat until its turn starts');
  const together = await Promise.all([1, 2, 3].map(() => post(`/chief/chats/${id}/messages`, { text: 'And the overdue ones?', key: 'overdue-key-0002' })));
  assert.deepEqual(together.map((r) => [r.status, r.data.again, r.data.queued.map((q) => q.id)]), [1, 2, 3].map(() => [200, true, [waits.data.queued[0].id]]));
  srv.release(turn);
  srv.unhold();
  const chat = await waitFor(async () => { const c = await chatOf(id); return !c.busy && !c.queued.length && !c.messages.at(-1).pending && mine(c).length === 2 ? c : null; }, { what: 'the waiting message to be answered' });
  assert.deepEqual(mine(chat), ['File the invoices', 'And the overdue ones?']);

  // And once more, after its reply: still once.
  const late = await post(`/chief/chats/${id}/messages`, { text: 'And the overdue ones?', key: 'overdue-key-0002' });
  assert.deepEqual([late.status, late.data.again], [200, true]);
  assert.deepEqual(mine(await chatOf(id)), ['File the invoices', 'And the overdue ones?']);
  assert.equal(chiefTurns().length - turnsBefore, 2, 'one turn per message');

  // A key is one chat's: the same key in another chat is another message.
  const other = await newChat();
  assert.equal((await post(`/chief/chats/${other}/messages`, { text: 'File the invoices', key: 'invoice-key-0001' })).status, 201);
  assert.deepEqual(mine(await replied(other)), ['File the invoices']);
});

test('a bot: a message sent again with its key starts one run, and one that waits its turn waits once, also when all arrive together', async () => {
  const before = (await runsOf()).length;
  srv.hold(); // the bot keeps working: the second message waits its turn (ADR 011), and is still one message
  const first = await post(`/bots/${bot.id}/run`, { prompt: 'Sort the inbox', key: 'sort-inbox-key-1' });
  assert.equal(first.status, 201);
  assert.equal(first.data.again, undefined);
  assert.equal(first.data.status, 'running');
  const rec = await srv.nextRun((x) => /^Sort the inbox/.test(x.stdin), 'the first run');
  const second = await post(`/bots/${bot.id}/run`, { prompt: 'Sort the inbox', key: 'sort-inbox-key-1' });
  assert.equal(second.status, 200);
  assert.equal(second.data.again, true);
  assert.equal(second.data.id, first.data.id, 'answered with the run the first started');
  assert.equal(second.data.botId, bot.id);

  const together = await Promise.all([1, 2, 3].map(() => post(`/bots/${bot.id}/run`, { prompt: 'Sort the archive', key: 'sort-archive-key' })));
  assert.deepEqual(together.map((r) => r.status).sort(), [200, 200, 201]);
  assert.equal(new Set(together.map((r) => r.data.id)).size, 1);
  assert.deepEqual(together.filter((r) => r.status === 200).map((r) => r.data.again), [true, true]);
  assert.deepEqual(together.map((r) => r.data.status), ['queued', 'queued', 'queued'], 'no run beside the first: it waits');
  assert.deepEqual((await srv.api(`/bots/${bot.id}`)).data.queued.map((q) => [q.id, q.text]), [[together[0].data.id, 'Sort the archive']], 'and it waits once');
  assert.deepEqual((await runsOf()).filter((r) => r.status === 'running').map((r) => r.id), [first.data.id]);

  srv.unhold();
  srv.release(rec);
  const runs = await allDone(before + 2);
  assert.equal(runs.length - before, 2, 'two messages, two runs');
  assert.equal(runs[0].id, together[0].data.id, 'the run it was answered with');
  assert.ok(runs[0].startedAt >= runs[1].endedAt, 'started when the first had ended');
});

test('two keys are two messages, also with the same text, each its own run in its turn; without a key it is as before', async () => {
  const before = (await runsOf()).length;
  const sent = [];
  for (const body of [{ prompt: 'Same words', key: 'same-words-key-1' }, { prompt: 'Same words', key: 'same-words-key-2' }, { prompt: 'Same words' }, { prompt: 'Same words' }]) {
    const r = await post(`/bots/${bot.id}/run`, body);
    assert.equal(r.status, 201);
    assert.equal(r.data.again, undefined);
    sent.push(r.data.id);
  }
  assert.equal(new Set(sent).size, 4);
  // Four messages, four runs, in the order sent and never two at once: each started when the one before had ended.
  const runs = (await allDone(before + 4)).filter((r) => sent.includes(r.id)).sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  assert.deepEqual(runs.map((r) => r.id), sent);
  for (let i = 1; i < runs.length; i++) assert.ok(runs[i].startedAt >= runs[i - 1].endedAt, `message ${i + 1} started after message ${i} ended`);

  const id = await newChat();
  assert.equal((await post(`/chief/chats/${id}/messages`, { text: 'Thanks', key: 'thanks-key-00001' })).status, 201);
  await replied(id);
  assert.equal((await post(`/chief/chats/${id}/messages`, { text: 'Thanks', key: 'thanks-key-00002' })).status, 201);
  assert.deepEqual(mine(await replied(id)), ['Thanks', 'Thanks']);
});

test('an ill-formed key is refused with a sentence, and nothing is taken', async () => {
  const id = await newChat();
  const before = (await runsOf()).length;
  for (const key of ['short', 'x'.repeat(65), 'has a space in it', 'ünïcödé-këy-0001', 12345678, '', {}]) {
    for (const r of [await post(`/chief/chats/${id}/messages`, { text: 'Hello', key }), await post(`/bots/${bot.id}/run`, { prompt: 'Hello', key })]) {
      assert.equal(r.status, 400, JSON.stringify(key));
      assert.equal(r.data.error, "A message's key is 8 to 64 characters: letters, digits, - and _.");
    }
  }
  assert.deepEqual(mine(await chatOf(id)), []);
  assert.equal((await runsOf()).length, before);
  // The shortest and the longest key, and every kind of character.
  for (const key of ['abcDEF12', `${'a'.repeat(62)}_-`]) assert.equal((await post(`/bots/${bot.id}/run`, { prompt: 'Hello', key })).status, 201, key);
  await allDone(before + 2);
});

test('after a restart a key botdot took is still answered with again', async () => {
  let own = await startServer();
  try {
    const worker = await makeBot(own, { name: 'Worker', emoji: '🛠️' });
    const run = (await own.api(`/bots/${worker.id}/run`, { method: 'POST', body: { prompt: 'Once', key: 'restart-key-0001' } })).data;
    await own.finished(run.id);
    const id = (await own.api('/chief/chats', { method: 'POST' })).data.id;
    assert.equal((await own.api(`/chief/chats/${id}/messages`, { method: 'POST', body: { text: 'Once', key: 'restart-key-0002' } })).status, 201);
    await waitFor(async () => !(await own.api(`/chief/chats/${id}`)).data.busy, { what: 'the Chief to reply' });
    await own.stop();
    own = await startServer({ dir: own.dir });

    const again = await own.api(`/bots/${worker.id}/run`, { method: 'POST', body: { prompt: 'Once', key: 'restart-key-0001' } });
    assert.deepEqual([again.status, again.data.again, again.data.id], [200, true, run.id]);
    assert.equal((await own.api(`/runs?botId=${worker.id}`)).data.length, 1);
    const chat = await own.api(`/chief/chats/${id}/messages`, { method: 'POST', body: { text: 'Once', key: 'restart-key-0002' } });
    assert.deepEqual([chat.status, chat.data.again], [200, true]);
    assert.deepEqual(chat.data.messages.filter((m) => m.role === 'user').map((m) => m.text), ['Once']);
  } finally { await own.stop(); }
});

test('the keys: kept for 24 hours and with their chat or bot, read back from the file, and the old ones go with a write', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-keys-'));
  try {
    let clock = Date.parse('2026-10-05T08:00:00Z');
    const now = () => clock;
    const hour = 60 * 60e3;
    let keys = messageKeys.create(dir, { now });
    assert.equal(keys.taken('bot:filer', 'morning-key'), null);
    keys.take('bot:filer', 'morning-key', { runId: 'r1' });
    assert.equal(keys.taken('bot:filer', 'morning-key').runId, 'r1');
    assert.equal(keys.taken('bot:other', 'morning-key'), null, 'another bot never took it');
    assert.equal(keys.taken('chief:filer', 'morning-key'), null);

    clock += 23 * hour;
    keys.take('chief:c1', 'evening-key');
    keys = messageKeys.create(dir, { now }); // botdot starts again
    assert.equal(keys.taken('bot:filer', 'morning-key').runId, 'r1', 'still known after 23 hours');
    assert.ok(keys.taken('chief:c1', 'evening-key'));

    clock += hour;
    assert.equal(keys.taken('bot:filer', 'morning-key'), null, 'forgotten after 24 hours');
    assert.ok(keys.taken('chief:c1', 'evening-key'));
    const file = path.join(dir, 'message-keys.json');
    assert.equal(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8'))).length, 2, 'in the file until the next write');
    keys.take('chief:c1', 'night-key-01');
    assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8'))).sort(), ['chief:c1 evening-key', 'chief:c1 night-key-01']);

    // A key that could not be written is not kept: botdot says of it what it would say after a restart.
    fs.rmSync(file);
    fs.mkdirSync(file); // nothing can be written in its place
    assert.throws(() => keys.take('chief:c1', 'unwritten-key'));
    assert.equal(keys.taken('chief:c1', 'unwritten-key'), null);
    assert.ok(keys.taken('chief:c1', 'night-key-01'), 'and the others stay');
    fs.rmSync(file, { recursive: true });

    // A file that holds something else is not read as keys.
    fs.writeFileSync(file, '[1, 2]');
    assert.equal(messageKeys.create(dir, { now }).taken('chief:c1', 'evening-key'), null);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }

  assert.equal(messageKeys.read(undefined), null);
  assert.equal(messageKeys.read(null), null);
  assert.equal(messageKeys.read('abcDEF12'), 'abcDEF12');
  assert.throws(() => messageKeys.read('nope'), (e) => e.status === 400);
});
