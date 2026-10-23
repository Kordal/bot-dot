// Who a message without a mention in a group is for (ADR 081, #510): one short question to a small model, whose
// answer is checked and never trusted, and which falls back to every member when it fails, is late or unsure. The
// first tests are of lib/group-router.js alone; the others against a real botdot server and the stand-in for Claude
// (test/fixtures/fake-claude.js answers the router's question with $FAKE_OUT/route.txt).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const router = require('../lib/group-router');
const { startServer, restartServer, makeBot, waitFor, readData, writeData } = require('./helpers');
const { shortName } = require('../public/mentions.js');

const MEMBERS = [{ id: 'a', name: 'Infra Admin', description: 'Keeps the servers up.' }, { id: 'b', name: 'QA Tester', prompt: 'Test every build.', skills: ['playwright'] }, { id: 'c', name: 'Manager' }];

test('an answer picks members by their number, best first, and anything else picks none', () => {
  assert.deepEqual(router.parse('{"members":[2]}', 3), [1]);
  assert.deepEqual(router.parse('Sure: {"members": [3, 1]}', 3), [2, 0]);
  for (const bad of ['', 'Infra Admin', '{"members":[]}', '{"members":[4]}', '{"members":[0]}', '{"members":["1"]}', '{"members":[1,1]}', '{"members":[1,2,3]}', '{"members":1}', '{oops}']) {
    assert.deepEqual(router.parse(bad, 3), [], bad);
  }
  const q = router.question({ text: 'Disk is full', members: MEMBERS, recent: [{ who: 'QA Tester', text: 'Build 12 passed.' }] });
  assert.ok(q.includes('1. Infra Admin | Keeps the servers up.') && q.includes('2. QA Tester | job: Test every build. | skills: playwright') && q.includes('3. Manager'));
  assert.ok(q.includes('- QA Tester: Build 12 passed.') && q.includes('The message: Disk is full'));
  assert.ok(q.indexOf('<group>') < q.indexOf('1. Infra Admin') && q.lastIndexOf('</group>') > q.indexOf('The message:'), 'the chat\'s text is inside the block');
});

test('route answers the members it picked, or falls back with why, and never throws', async () => {
  const route = (ask, ms = 200) => router.create({ ask, ms }).route({ text: 'Disk is full', members: MEMBERS });
  assert.deepEqual((await route(async () => '{"members":[1]}')).picked, ['a']);
  assert.equal((await route(async () => '{"members":[]}')).fell, 'unsure');
  assert.equal((await route(async () => 'no idea')).fell, 'unsure');
  assert.equal((await route(async () => { throw new Error('overloaded'); })).fell, 'failed');
  assert.equal((await route(() => new Promise(() => {}), 50)).fell, 'late', 'an ask that never answers is cut off');
  assert.equal((await route(async () => { throw new Error("Claude couldn't be asked who a group message is for: no answer in time"); })).fell, 'late');
  let asked = 0;
  const one = await router.create({ ask: async () => { asked++; return '{"members":[1]}'; } }).route({ text: 'x', members: [MEMBERS[0]] });
  assert.deepEqual([one.fell, asked], ['one member', 0], 'a group of one is never asked about');
  let opts;
  await router.create({ ask: async (p, o) => { opts = o; return '{}'; } }).route({ text: 'x', members: MEMBERS });
  assert.deepEqual([opts.llm.model, opts.system], [router.MODEL, router.SYSTEM]);
  assert.equal(router.on({ BOT_DOT_GROUP_ROUTER: 'off' }), false);
  assert.equal(router.on({}), true);
});

let srv;
before(async () => { srv = await startServer({ env: { BOT_DOT_GROUP_ROUTER: 'on', BOT_DOT_GROUP_ROUTER_MS: '1500' } }); });
after(() => srv.stop());

const send = (on, group, body) => on.api(`/group-chats/${group.id}/messages`, { method: 'POST', body });
const chatOf = async (on, group) => (await on.api(`/group-chats/${group.id}/chat`)).data;
const ranOf = (on, bot) => on.runs().filter((x) => x.who === shortName(bot.name));
const routeAsks = (on) => fs.readdirSync(on.out).filter((f) => /^route-\d/.test(f)).map((f) => fs.readFileSync(path.join(on.out, f), 'utf8'));
const kept = (on, group) => readData(on.data, path.join('group-messages', `${group.id}.json`));
const settled = (on, group, id) => waitFor(async () => {
  const c = await chatOf(on, group);
  const m = c.items.find((x) => x.type === 'message' && x.id === id);
  return m && !c.working.length && !m.next.length && !m.waitsFor.length && kept(on, group).find((x) => x.id === id)?.done ? c : null;
}, { timeout: 20_000, what: `the line of message ${id} to end` });
const setRoute = (on, files) => {
  for (const f of ['route.txt', 'route-ms.txt', 'route-fails']) fs.rmSync(path.join(on.out, f), { force: true });
  for (const [f, text] of Object.entries(files)) fs.writeFileSync(path.join(on.out, f), text);
};
let n = 0;
async function team(on) {
  n++;
  const bots = [];
  for (const name of [`Infra${n}`, `Tester${n}`, `Boss${n}`]) bots.push(await makeBot(on, { name, emoji: '🤖', description: `The ${name} of the team.`, prompt: `Do the work of ${name}.` }));
  const group = (await on.api('/group-chats', { method: 'POST', body: { name: `Team ${n}`, members: bots.map((b) => b.id) } })).data;
  return { bots, group };
}

test('a message without a mention goes to the member the router picked; the decision is kept and the turn is told', async () => {
  const { bots: [infra, tester, boss], group } = await team(srv);
  setRoute(srv, { 'route.txt': '{"members":[2]}' });
  const before = routeAsks(srv).length;
  const sent = (await send(srv, group, { text: 'Run the regression suite on staging.' })).data;
  await settled(srv, group, sent.id);
  assert.deepEqual([ranOf(srv, infra).length, ranOf(srv, tester).length, ranOf(srv, boss).length], [0, 1, 0]);
  const m = kept(srv, group).find((x) => x.id === sent.id);
  assert.deepEqual([m.to, m.routed.picked, m.routing], [[tester.id], [tester.id], undefined]);
  assert.ok(Number.isInteger(m.routed.ms));
  const asked = routeAsks(srv).slice(before);
  assert.equal(asked.length, 1);
  assert.ok(asked[0].includes('The message: Run the regression suite on staging.') && asked[0].includes(`2. ${tester.name} | The ${tester.name} of the team.`));
  assert.ok(ranOf(srv, tester)[0].system.includes('botdot gave the turn to the members whose part it is: this turn is yours'));
  const message = (await chatOf(srv, group)).items.find((x) => x.id === sent.id);
  assert.deepEqual(message.to, [tester.id]);
});

test('a picked member still hands the work on to one the router left out', async () => {
  const { bots: [infra, tester, boss], group } = await team(srv);
  setRoute(srv, { 'route.txt': '{"members":[1]}' });
  fs.writeFileSync(path.join(srv.out, `result-${shortName(infra.name)}.txt`), `Deployed. @${shortName(tester.name)} please test it.`);
  const sent = (await send(srv, group, { text: 'Deploy 2.4.' })).data;
  await settled(srv, group, sent.id);
  assert.deepEqual([ranOf(srv, infra).length, ranOf(srv, tester).length, ranOf(srv, boss).length], [1, 1, 0]);
});

test('the member whose question is open keeps its first turn beside the one the router picked', async () => {
  const { bots: [infra, tester, boss], group } = await team(srv);
  fs.writeFileSync(path.join(srv.out, `result-${shortName(infra.name)}.txt`), 'Two old backups are left.\nShould I delete them?\n\n[[choices: Yes | No]]');
  const one = (await send(srv, group, { text: `@${shortName(infra.name)} check the backups` })).data;
  await settled(srv, group, one.id);
  await waitFor(async () => ((await chatOf(srv, group)).asks?.botId === infra.id ? true : null), { what: 'the question to be open' });
  fs.writeFileSync(path.join(srv.out, `result-${shortName(infra.name)}.txt`), 'Deleted.');
  setRoute(srv, { 'route.txt': '{"members":[3]}' });
  const two = (await send(srv, group, { text: 'Yes, and tell me what it saves' })).data;
  const c = await settled(srv, group, two.id);
  const order = c.items.filter((x) => x.type === 'reply' && x.run?.groupMessageId === two.id).map((x) => x.run.botId);
  assert.deepEqual(order, [infra.id, boss.id]);
  assert.equal(ranOf(srv, tester).length, 0);
  assert.deepEqual(kept(srv, group).find((x) => x.id === two.id).to, [infra.id, boss.id]);
});

test('a router that is unsure, fails or is late gives every member the turn, as before', async () => {
  for (const [files, fell] of [[{ 'route.txt': '{"members":[]}' }, 'unsure'], [{ 'route-fails': '' }, 'failed'], [{ 'route-ms.txt': '4000' }, 'late'], [{ 'route.txt': '{"members":[9]}' }, 'unsure']]) {
    const { bots, group } = await team(srv);
    setRoute(srv, files);
    const sent = (await send(srv, group, { text: 'Good morning, what is everyone doing?' })).data;
    await settled(srv, group, sent.id);
    assert.deepEqual(bots.map((b) => ranOf(srv, b).length), [1, 1, 1], fell);
    const m = kept(srv, group).find((x) => x.id === sent.id);
    assert.deepEqual([m.routed.fell, m.to], [fell, bots.map((b) => b.id)], fell);
  }
  setRoute(srv, {});
});

test('a mention and "@all" are never routed', async () => {
  const { bots: [infra, tester, boss], group } = await team(srv);
  setRoute(srv, { 'route.txt': '{"members":[3]}' });
  const before = routeAsks(srv).length;
  const one = (await send(srv, group, { text: `@${shortName(infra.name)} check the disk` })).data;
  await settled(srv, group, one.id);
  const two = (await send(srv, group, { text: '@all one risk each' })).data;
  await settled(srv, group, two.id);
  assert.equal(routeAsks(srv).length, before);
  assert.deepEqual([ranOf(srv, infra).length, ranOf(srv, tester).length, ranOf(srv, boss).length], [2, 1, 1]);
  for (const id of [one.id, two.id]) assert.equal(kept(srv, group).find((x) => x.id === id).routed, undefined);
});

test('a message botdot was routing as it stopped is every member\'s after the start', async () => {
  const { bots, group } = await team(srv);
  const file = path.join(srv.data, 'group-messages', `${group.id}.json`);
  srv = await restartServer(srv, () => {
    const ids = bots.map((b) => b.id);
    writeData(file, [{ id: '20261023190000-abcdef', text: 'Who is on call?', at: new Date().toISOString(), to: ids, routing: true, line: ids, turns: [] }]);
  });
  await settled(srv, group, '20261023190000-abcdef');
  assert.deepEqual(bots.map((b) => ranOf(srv, b).length), [1, 1, 1]);
  assert.equal(kept(srv, group)[0].routed.fell, 'restart');
});
