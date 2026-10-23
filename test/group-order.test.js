// Two messages of the owner's to the same members of a group go one after the other (#489): the line of the second
// begins once the line of the first has ended, so that each turn reads every reply before it and no member works on
// both at once, also while a bot may run several runs side by side (ADR 062). A later turn is told who answered
// before it, and to repeat none of them. Against a real botdot server and the stand-in for Claude
// (test/fixtures/fake-claude.js).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, waitFor } = require('./helpers');
const { shortName } = require('../public/mentions.js');
const { RULES } = require('../lib/group-chat');

let srv;
before(async () => { srv = await startServer(); });
after(() => { for (const f of fs.readdirSync(srv.out)) if (f.startsWith('hold-')) fs.rmSync(path.join(srv.out, f), { force: true }); return srv.stop(); });

const fileOf = (on, kind, bot, ext = '') => path.join(on.out, `${kind}-${shortName(bot.name)}${ext}`);
const reply = (on, bot, text) => fs.writeFileSync(fileOf(on, 'result', bot, '.txt'), text);
const hold = (on, bot) => fs.writeFileSync(fileOf(on, 'hold', bot), '');
const letGo = (on, bot) => fs.rmSync(fileOf(on, 'hold', bot), { force: true });
const ranOf = (on, bot) => on.runs().filter((x) => x.who === shortName(bot.name));
const send = (on, group, body) => on.api(`/group-chats/${group.id}/messages`, { method: 'POST', body });
const chatOf = async (on, group) => (await on.api(`/group-chats/${group.id}/chat`)).data;
const messageIn = (c, id) => c.items.find((x) => x.type === 'message' && x.id === id);
const repliesIn = (c) => c.items.filter((x) => x.type === 'reply');
const settled = (on, group, id) => waitFor(async () => {
  const c = await chatOf(on, group);
  const m = messageIn(c, id);
  return m && !c.working.length && !m.next.length && !m.waitsFor.length ? c : null;
}, { timeout: 20_000, what: `the line of message ${id} to end` });

test('a second message to the same members waits for the line of the first, and its turns read every reply of it', async () => {
  const bots = [];
  for (const n of ['Order Lead', 'Order Infra']) bots.push(await makeBot(srv, { name: n, emoji: '🤖', prompt: `Do the work of ${n}.` }));
  const [lead, infra] = bots;
  const group = (await srv.api('/group-chats', { method: 'POST', body: { name: 'Order', members: bots.map((b) => b.id) } })).data;
  reply(srv, lead, 'Lead takes issue 1, Infra takes issue 2.');
  reply(srv, infra, 'Issue 2 needs the server first.');
  hold(srv, lead);
  const one = (await send(srv, group, { text: 'Pick the issues you can work on.' })).data;
  await waitFor(async () => ((await chatOf(srv, group)).working.length === 1 ? true : null), { what: 'Lead at work' });
  // The second message, while Lead is at work on the first: Lead could start beside it (ADR 062), and does not.
  const two = (await send(srv, group, { text: 'Only the ones assigned to me.' })).data;
  assert.deepEqual([two.waitsFor, two.canTakeBack], [[lead.id, infra.id], true]);
  assert.deepEqual((await chatOf(srv, group)).working.map((w) => w.messageId), [one.id]);
  letGo(srv, lead);
  await settled(srv, group, one.id);
  const c = await settled(srv, group, two.id);
  const runs = repliesIn(c).map((x) => x.run);
  assert.deepEqual(runs.map((r) => [r.botName, r.groupMessageId]), [['Order Lead', one.id], ['Order Infra', one.id], ['Order Lead', two.id], ['Order Infra', two.id]]);
  for (let i = 1; i < runs.length; i++) assert.ok(runs[i].startedAt >= runs[i - 1].endedAt, `${runs[i].botName} started after the one before it ended`);

  // The first turn of the second message reads both replies to the first; the second turn is told Lead answered
  // this message before it, and not to repeat it. The first turn of a message is told of nobody before it.
  const [leadOne, leadTwo] = ranOf(srv, lead).map((r) => r.system);
  const [infraOne, infraTwo] = ranOf(srv, infra).map((r) => r.system);
  assert.ok(leadTwo.includes('Issue 2 needs the server first.') && leadTwo.includes('Lead takes issue 1'));
  for (const sys of [leadOne, leadTwo]) assert.ok(!sys.includes(RULES.after), 'nobody answered before the first turn');
  for (const sys of [infraOne, infraTwo]) {
    assert.ok(/· a member that answered this message before you\] 🤖 Order Lead\nThe members on the lines above have already answered this message\./.test(sys));
    assert.ok(sys.includes(RULES.after));
    assert.ok(sys.includes('🤖 Order Lead, a teammate (a bot, not the owner), replied to the message you are answering now:\nLead takes issue 1'));
  }
});
