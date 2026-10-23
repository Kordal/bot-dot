// A long turn in a group goes on in the background (#509): a member still at work when its turn's time is up
// (BOT_DOT_GROUP_TURN_MS, short here) no longer holds up its line nor the owner's next message. Its reply lands in
// the group as it ends, hands on as any reply does, and counts towards the limit. The members after it are told
// that its part is taken. Against a real botdot server and the stand-in for Claude (test/fixtures/fake-claude.js).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, waitFor } = require('./helpers');
const { shortName } = require('../public/mentions.js');
const { RULES, LIMIT } = require('../lib/group-chat');

const TURN_MS = 1500;
let srv;
before(async () => { srv = await startServer({ env: { BOT_DOT_GROUP_TURN_MS: String(TURN_MS) } }); });
after(() => { for (const f of fs.readdirSync(srv.out)) if (f.startsWith('hold')) fs.rmSync(path.join(srv.out, f), { force: true }); return srv.stop(); });

const fileOf = (on, kind, bot, ext = '') => path.join(on.out, `${kind}-${shortName(bot.name)}${ext}`);
const reply = (on, bot, text) => fs.writeFileSync(fileOf(on, 'result', bot, '.txt'), text);
const hold = (on, bot) => fs.writeFileSync(fileOf(on, 'hold', bot), '');
const letGo = (on, bot) => fs.rmSync(fileOf(on, 'hold', bot), { force: true });
const ranOf = (on, bot) => on.runs().filter((x) => x.who === shortName(bot.name));
const send = (on, group, body) => on.api(`/group-chats/${group.id}/messages`, { method: 'POST', body });
const chatOf = async (on, group) => (await on.api(`/group-chats/${group.id}/chat?limit=200`)).data;
const messageIn = (c, id) => c.items.find((x) => x.type === 'message' && x.id === id);
const repliesOf = (c, id) => c.items.filter((x) => x.type === 'reply' && x.run?.groupMessageId === id).map((x) => x.run);

test('a turn still at work when its time is up goes on in the background: the line goes on, the next message does not wait, and its reply hands on when it lands', async () => {
  const bots = [];
  for (const n of ['Slow Builder', 'Quick Writer', 'Quick Checker']) bots.push(await makeBot(srv, { name: n, emoji: '🤖', prompt: `Do the work of ${n}.` }));
  const [slow, writer, checker] = bots;
  const group = (await srv.api('/group-chats', { method: 'POST', body: { name: 'Background', members: bots.map((b) => b.id) } })).data;
  reply(srv, slow, `The build is ready. @${shortName(checker.name)} check it, please.`);
  reply(srv, writer, 'I wrote the notes.');
  reply(srv, checker, 'Checked.');
  hold(srv, slow);
  const started = Date.now();
  const one = (await send(srv, group, { text: 'Build it and write the notes.' })).data;

  // The two quick members answer while the slow one still works, after its time is up and not before.
  const c1 = await waitFor(async () => { const c = await chatOf(srv, group); return repliesOf(c, one.id).length === 2 ? c : null; }, { timeout: 20_000, what: 'the two quick replies' });
  assert.deepEqual(repliesOf(c1, one.id).map((r) => r.botName), ['Quick Writer', 'Quick Checker']);
  assert.ok(repliesOf(c1, one.id)[0].startedAt >= new Date(started + TURN_MS - 100).toISOString(), 'the next turn waited for the time of the first');
  assert.deepEqual(c1.working.map((w) => [w.botId, w.messageId]), [[slow.id, one.id]], 'the slow member is still at work, on one working line');
  assert.deepEqual(messageIn(c1, one.id).next, []);
  const onDisk = JSON.parse(fs.readFileSync(path.join(srv.data, 'group-messages', `${group.id}.json`), 'utf8')).find((m) => m.id === one.id);
  assert.equal(typeof onDisk.turns.find((t) => t.botId === slow.id).background, 'string');
  assert.equal(onDisk.done, undefined, 'the message is not done while its member works in the background');

  // The turns after it were told that its part is taken; the first turn was not.
  const [slowSys] = ranOf(srv, slow).map((r) => r.system);
  const [writerSys] = ranOf(srv, writer).map((r) => r.system);
  const [checkerSys] = ranOf(srv, checker).map((r) => r.system);
  assert.ok(!slowSys.includes(RULES.working));
  for (const sys of [writerSys, checkerSys]) {
    assert.ok(/· a member still working on its part of this message\] 🤖 Slow Builder\n/.test(sys));
    assert.ok(sys.includes(RULES.working));
  }

  // The owner's next message to every member does not wait for the slow one, which works in the background.
  const two = (await send(srv, group, { text: `@${shortName(writer.name)} and the changelog?` })).data;
  assert.deepEqual(two.waitsFor, []);
  await waitFor(async () => { const c = await chatOf(srv, group); return repliesOf(c, two.id).length === 1 && c.working.length === 1 ? true : null; }, { timeout: 20_000, what: 'the reply to the second message' });
  const three = (await send(srv, group, { text: 'Anything else?' })).data;
  assert.deepEqual(three.waitsFor, [], 'a later message for every member does not wait for the member in the background');
  await waitFor(async () => { const c = await chatOf(srv, group); return repliesOf(c, three.id).length === 2 ? true : null; }, { timeout: 20_000, what: 'the two quick replies to the third message' });

  // The slow reply lands as a reply of its message and hands the work on to the member it names.
  letGo(srv, slow);
  const c2 = await waitFor(async () => {
    const c = await chatOf(srv, group);
    return repliesOf(c, one.id).some((r) => r.botName === 'Slow Builder') && repliesOf(c, one.id).filter((r) => r.botName === 'Quick Checker').length === 2 && !c.working.length ? c : null;
  }, { timeout: 20_000, what: 'the slow reply and the hand-on it gives' });
  const handed = repliesOf(c2, one.id).filter((r) => r.botName === 'Quick Checker').at(-1);
  assert.deepEqual([handed.handedBy?.id], [slow.id]);
  await waitFor(async () => { const c = await chatOf(srv, group); return [one, two, three].every((m) => !messageIn(c, m.id).next.length && !messageIn(c, m.id).waitsFor.length) && !c.working.length ? true : null; }, { timeout: 20_000, what: 'every line to end' });
});

test('a reply from the background counts towards the limit as any', async () => {
  const bots = [];
  for (const n of ['Ping Late', 'Pong Late']) bots.push(await makeBot(srv, { name: n, emoji: '🏓', prompt: `Be ${n}.` }));
  const [ping, pong] = bots;
  const group = (await srv.api('/group-chats', { method: 'POST', body: { name: 'Late', members: bots.map((b) => b.id) } })).data;
  reply(srv, ping, `@${shortName(pong.name)} your turn.`);
  reply(srv, pong, `@${shortName(ping.name)} your turn.`);
  hold(srv, ping);
  const sent = (await send(srv, group, { text: `@${shortName(ping.name)} start.` })).data;
  // Ping's first turn goes on in the background: nothing else is on the line, so nothing starts meanwhile.
  await new Promise((r) => setTimeout(r, TURN_MS + 300));
  letGo(srv, ping);
  const c = await waitFor(async () => { const x = await chatOf(srv, group); const m = messageIn(x, sent.id); return m?.atLimit && !x.working.length ? x : null; }, { timeout: 40_000, what: 'the line to stop at the limit' });
  assert.equal(repliesOf(c, sent.id).length, LIMIT);
  assert.equal(c.limit.replies, LIMIT);
});
