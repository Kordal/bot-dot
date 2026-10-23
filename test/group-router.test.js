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

test('Jev is asked one yes/no question per member and one for everyone; its answer picks the two likeliest at 0.5 or more', () => {
  const body = router.jevRequest({ text: 'Disk is full', members: MEMBERS, recent: [{ who: 'QA Tester', text: 'Build 12 passed.' }] });
  assert.equal(body.model, router.JEV_MODEL);
  assert.deepEqual(Object.keys(body.questions), ['everyone', 'm1', 'm2', 'm3']);
  assert.ok(Object.values(body.questions).every((q) => q.type === 'noul' && q.criteria.true && q.criteria.false));
  assert.ok(body.questions.m1.instructions.includes('Infra Admin') && body.questions.m1.instructions.includes('Keeps the servers up.'));
  assert.deepEqual([body.state.message, body.state.recent], ['Disk is full', [{ who: 'QA Tester', text: 'Build 12 passed.' }]]);
  const a = (everyone, ...m) => ({ everyone: { noul: everyone }, ...Object.fromEntries(m.map((v, i) => [`m${i + 1}`, { noul: v }])) });
  assert.deepEqual(router.jevPick(a(0.1, 0.9, 0.2, 0.6), 3), [0, 2]);
  assert.deepEqual(router.jevPick(a(0.1, 0.6, 0.9, 0.7), 3), [1, 2], 'at most two, the likeliest first');
  assert.deepEqual(router.jevPick(a(0.8, 0.9, 0.9, 0.9), 3), [], 'for everyone');
  assert.deepEqual(router.jevPick(a(0.1, 0.3, 0.2, 0.4), 3), [], 'none sure');
  assert.deepEqual(router.jevPick(a(0.1, 0.9, 0.2), 3), [], 'a member without an answer');
  assert.deepEqual(router.jevPick({ everyone: { noul: 'x' } }, 3), []);
});

test('with Jev chosen, Jev decides; when it fails Haiku does, and with no key Haiku alone', async () => {
  const jev = { router: 'jev', key: 'sk-or-v1-testtesttest' };
  const fetched = [];
  const fetchOk = async (url, opts) => { fetched.push([url, opts]); return { ok: true, json: async () => ({ answers: { everyone: { noul: 0.1 }, m1: { noul: 0.2 }, m2: { noul: 0.9 }, m3: { noul: 0.1 } } }) }; };
  let haiku = 0;
  const ask = async () => { haiku++; return '{"members":[1]}'; };
  const d = await router.create({ ask, config: () => jev, fetch: fetchOk }).route({ text: 'Test it', members: MEMBERS });
  assert.deepEqual([d.picked, d.by, haiku], [['b'], 'jev', 0]);
  assert.match(fetched[0][0], /\/api\/alpha\/decisions$/);
  assert.equal(fetched[0][1].headers.Authorization, `Bearer ${jev.key}`);
  const fails = async () => ({ ok: false, status: 500, json: async () => ({}) });
  const back = await router.create({ ask, config: () => jev, fetch: fails }).route({ text: 'Test it', members: MEMBERS });
  assert.deepEqual([back.picked, back.by, haiku], [['a'], 'haiku', 1]);
  const late = await router.create({ ask, config: () => jev, fetch: (u, o) => new Promise((_, reject) => o.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))), jevMs: 30 }).route({ text: 'Test it', members: MEMBERS });
  assert.deepEqual([late.by, haiku], ['haiku', 2]);
  const sure = async () => ({ ok: true, json: async () => ({ answers: { everyone: { noul: 0.9 }, m1: { noul: 0.9 }, m2: { noul: 0.9 }, m3: { noul: 0.9 } } }) });
  const all = await router.create({ ask, config: () => jev, fetch: sure }).route({ text: 'Morning all', members: MEMBERS });
  assert.deepEqual([all.fell, all.by, haiku], ['unsure', 'jev', 2], 'Jev saying everyone is an answer: Haiku is not asked');
  const none = await router.create({ ask, config: () => ({ router: 'haiku', key: null }), fetch: fetchOk }).route({ text: 'x', members: MEMBERS });
  assert.deepEqual([none.by, fetched.length], ['haiku', 1]);
  assert.throws(() => router.setConfig({ router: 'jev' }), /key/);
  assert.throws(() => router.setConfig({ router: 'gpt' }));
});

let srv, openRouter;
let jevAnswers = null; // what the stand-in for OpenRouter answers: answers, or null for a 500
before(async () => {
  openRouter = require('http').createServer((req, res) => {
    req.resume();
    req.on('end', () => {
      res.writeHead(jevAnswers ? 200 : 500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(jevAnswers ? { answers: jevAnswers } : { error: 'down' }));
    });
  });
  await new Promise((r) => openRouter.listen(0, '127.0.0.1', r));
  srv = await startServer({ env: { BOT_DOT_GROUP_ROUTER: 'on', BOT_DOT_GROUP_ROUTER_MS: '1500', BOT_DOT_OPENROUTER_URL: `http://127.0.0.1:${openRouter.address().port}` } });
});
after(() => { openRouter.close(); return srv.stop(); });

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

test('the front door alone sets the group router; with Jev chosen Jev decides, and Haiku when Jev is down', async () => {
  const set = (body, headers = { 'X-Botdot-Room': '1' }) => srv.api('/group-router', { method: 'POST', body, headers });
  const key = 'sk-or-v1-testtesttest';
  assert.equal((await set({ router: 'jev', key }, {})).status, 403, 'not the owner');
  assert.equal((await srv.asChief('/group-router', { method: 'POST', body: { router: 'jev', key }, headers: { 'X-Botdot-Room': '1' } })).status, 403, 'not the Chief');
  assert.equal((await set({ router: 'jev' })).status, 400);
  const done = await set({ router: 'jev', key });
  assert.deepEqual([done.status, done.data], [200, { router: 'jev' }], 'the key is never answered');

  const { bots: [infra, tester, boss], group } = await team(srv);
  setRoute(srv, { 'route.txt': '{"members":[1]}' }); // Haiku would pick Infra
  jevAnswers = { everyone: { noul: 0.1 }, m1: { noul: 0.1 }, m2: { noul: 0.2 }, m3: { noul: 0.95 } };
  const one = (await send(srv, group, { text: 'Should we raise the price?' })).data;
  await settled(srv, group, one.id);
  assert.deepEqual([ranOf(srv, infra).length, ranOf(srv, tester).length, ranOf(srv, boss).length], [0, 0, 1]);
  assert.deepEqual(kept(srv, group).find((x) => x.id === one.id).routed.by, 'jev');

  jevAnswers = null; // OpenRouter is down: Haiku decides
  const two = (await send(srv, group, { text: 'Is the backup ok?' })).data;
  await settled(srv, group, two.id);
  assert.deepEqual([ranOf(srv, infra).length, ranOf(srv, tester).length, ranOf(srv, boss).length], [1, 0, 1]);
  const m = kept(srv, group).find((x) => x.id === two.id);
  assert.deepEqual([m.routed.by, m.routed.picked], ['haiku', [infra.id]]);
  assert.equal((await set({ router: 'haiku' })).data.router, 'haiku');
  setRoute(srv, {});
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
