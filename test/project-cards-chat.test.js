// A card on a project's board is changed from a chat (#907): a bot of the project's team sees the board's cards in
// its prompt, lists them and changes one by its title; the Chief changes one with its tool. The change keeps what the
// card was asked from. A bot of the project and the Chief add a card from a chat; they remove a card or a goal only in
// a turn the owner started.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { startServer, makeBot, writeData, heldRun, self } = require('./helpers');
const { rpcClient } = require('./memory-helpers');

let srv; let a; let loner; let pid;
const ready = { id: 'c1', ask: 'Open issues of Buildr', title: 'Buildr Open Issues', state: 'ready', at: '2026-11-01T09:00:00.000Z', answers: [{ q: 'Which repository?', a: 'kordal/buildr' }], apps: [], body: { show: 'list', value: '12', sub: '+3 today', list: [{ text: 'Add a graph' }] }, how: 'Read github.com/kordal/buildr/issues.', triedAt: new Date().toISOString() };
before(async () => {
  srv = await startServer();
  a = await makeBot(srv, { name: 'Board Lead', emoji: '📣' });
  loner = await makeBot(srv, { name: 'Board Loner', emoji: '🚪' });
  assert.equal((await srv.api('/company', { method: 'POST', body: { start: 'Quotes for builders' } })).status, 201);
  const c = (await srv.api('/company')).data.company;
  pid = c.id;
  writeData(path.join(srv.data, 'company.json'), { ...c, name: 'Quotz', phase: 'running', startedAt: new Date().toISOString(), teams: [{ id: 't1', name: 'Dev', bots: [a.id], lead: a.id }], objectives: [{ id: 'o1', name: 'Grokbot bots migrated', current: 0, target: 50 }, { id: 'o2', name: 'Open-source installs', current: 3, target: 200 }, { id: 'o3', name: 'Hosted plans renewed', current: 0, target: 10 }], plan: { items: [{ text: 'Move the first bots', objective: 'o1' }] } });
  writeData(path.join(srv.data, 'project-cards.json'), { [pid]: [ready, { ...ready, id: 'c2', ask: 'Customer calls', title: 'Customer calls', answers: [] }] });
});
after(() => { srv.unhold(); return srv.stop(); });

const cardNow = async (id) => (await srv.api('/company')).data.company.cards.find((c) => c.id === id);

test("a bot of the project sees the board's cards, and changes the one the owner names, keeping what it was asked from", async (t) => {
  const { rec, token } = await heldRun(srv, a, 'Add a graph to the Buildr card');
  assert.match(rec.system, /The project's board has these cards: c1 "Buildr Open Issues", c2 "Customer calls"\. Add a card with add_project_card; when the owner asks to change one, change it with change_project_card, and to remove one, remove_project_card/);
  assert.match(rec.system, /The project's goals, the tiles at the top of its board: o1 "Grokbot bots migrated" \(0 of 50\), o2 "Open-source installs" \(3 of 200\), o3 "Hosted plans renewed" \(0 of 10\)\. When the owner asks to remove one, remove it with remove_project_goal\./);
  let r = (await self(srv, token, 'cards', { action: 'list' })).data;
  assert.match(r.text, /^card c1 "Buildr Open Issues"[\s\S]*\ncard c2 "Customer calls"/);
  r = (await self(srv, token, 'cards', { action: 'change', card: 'nothing like it', change: 'x' })).data;
  assert.equal(r.ok, false);
  assert.match(r.error, /No card on the board is called "nothing like it"\. Its cards: card c1/);
  r = (await self(srv, token, 'cards', { action: 'change', card: 'buildr', change: '' })).data;
  assert.equal(r.ok, false, 'a change says what');
  r = (await self(srv, token, 'cards', { action: 'change', card: 'buildr', change: 'add a graph' })).data;
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.text, /^Changing card c1 "Buildr Open Issues"/);
  const c = await cardNow('c1');
  assert.deepEqual([c.state, c.ask, c.changing, c.body.value], ['asking', 'add a graph', true, '12']);
  const stored = require('../lib/jsonfile').readJson(path.join(srv.data, 'project-cards.json'), {})[pid].find((x) => x.id === 'c1');
  assert.deepEqual(stored.earlier, [{ ask: 'Open issues of Buildr', answers: [{ q: 'Which repository?', a: 'kordal/buildr' }] }]);
  const tools = rpcClient(t, 'self-mcp.js', rec.self.env);
  assert.deepEqual((await tools.request('tools/list')).tools.map((x) => x.name).filter((n) => /project_card/.test(n)), ['list_project_cards', 'add_project_card', 'change_project_card', 'remove_project_card']);
  assert.ok((await tools.request('tools/list')).tools.some((x) => x.name === 'remove_project_goal'));
  srv.unhold();
});

test('a bot of the project adds a card, which asks its questions on the board', async () => {
  const { token } = await heldRun(srv, a, 'Put the open PRs of kordal/buildr on the board');
  let r = (await self(srv, token, 'cards', { action: 'add', ask: '  ' })).data;
  assert.equal(r.ok, false, 'an add says what');
  r = (await self(srv, token, 'cards', { action: 'add', ask: 'Open PRs of kordal/buildr' })).data;
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.text, /^Added card \w+ "Open PRs of kordal\/buildr" \(waits for the owner.s answers[^)]*\) to the board/);
  const added = (await srv.api('/company')).data.company.cards.find((c) => c.ask === 'Open PRs of kordal/buildr');
  assert.equal(added.state, 'asking');
  writeData(path.join(srv.data, 'project-cards.json'), { [pid]: require('../lib/jsonfile').readJson(path.join(srv.data, 'project-cards.json'), {})[pid].filter((c) => c.id !== added.id) });
  srv.unhold();
});

test('a bot removes the card or the goal the owner asks for, in a run the owner started', async () => {
  const { token, run } = await heldRun(srv, a, 'We no longer count migrations, remove that tile');
  let r = (await self(srv, token, 'goals', { action: 'remove', goal: 'nothing like it' })).data;
  assert.equal(r.ok, false);
  assert.match(r.error, /No goal of the project is called "nothing like it"\. Its goals: o1 "Grokbot bots migrated"/);
  r = (await self(srv, token, 'goals', { action: 'remove', goal: 'migrated' })).data;
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.text, /^Removed the goal o1 "Grokbot bots migrated"/);
  const c = (await srv.api('/company')).data.company;
  assert.deepEqual(c.objectives.map((o) => o.id), ['o2', 'o3']);
  assert.deepEqual(c.plan.items, [{ text: 'Move the first bots' }], 'the plan item keeps its text, not the tie');
  writeData(path.join(srv.data, 'project-cards.json'), { [pid]: [...require('../lib/jsonfile').readJson(path.join(srv.data, 'project-cards.json'), {})[pid], { ...ready, id: 'c3', ask: 'Days to launch', title: 'Days to launch', answers: [] }] });
  r = (await self(srv, token, 'cards', { action: 'remove', card: 'days to launch' })).data;
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.match(r.text, /^Removed card c3 "Days to launch"/);
  assert.equal(await cardNow('c3'), undefined);
  srv.unhold();
  await srv.finished(run.run?.id || run.id);
});

test('a run the owner did not start removes nothing', async () => {
  srv.hold();
  const job = (await srv.api(`/bots/${a.id}/jobs`, { method: 'POST', body: { name: 'Tidy', kind: 'ai', cron: '0 4 1 1 *', prompt: 'Tidy the board.' } })).data;
  const ran = (await srv.api(`/bots/${a.id}/jobs/${job.id}/run`, { method: 'POST' })).data;
  const rec = await srv.nextRun((x) => x.self?.env && x.stdin.includes('Tidy the board.'), 'the job run');
  const token = rec.self.env.RUN_TOKEN;
  let r = (await self(srv, token, 'goals', { action: 'remove', goal: 'o2' })).data;
  assert.deepEqual([r.ok, /only in a run the owner started/.test(r.error)], [false, true]);
  r = (await self(srv, token, 'cards', { action: 'remove', card: 'c1' })).data;
  assert.equal(r.ok, false);
  const c = (await srv.api('/company')).data.company;
  assert.deepEqual([c.objectives.length, !!c.cards.find((x) => x.id === 'c1')], [2, true]);
  srv.unhold();
  srv.release(rec);
  await srv.finished(ran.run.id);
  await srv.api(`/bots/${a.id}/jobs/${job.id}`, { method: 'DELETE' });
});

test('the Chief adds a card and changes one by its title; outside a turn the owner started it removes nothing', async () => {
  const r = await srv.asChief('/company/cards/customer%20calls', { method: 'PUT', body: { ask: 'only this month' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await cardNow('c2')).ask, 'only this month');
  assert.equal((await srv.asChief('/company/cards/c2', { method: 'DELETE' })).status, 403, 'no turn of the owner goes');
  assert.equal((await srv.asChief('/company/objectives/o2', { method: 'DELETE' })).status, 403);
  const made = await srv.asChief('/company/cards', { method: 'POST', body: { ask: 'Signups this week' } });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const added = made.data.cards.find((c) => c.ask === 'Signups this week');
  assert.equal(added.state, 'asking');
  assert.equal((await srv.asChief('/company/cards', { method: 'POST', body: {} })).status, 400, 'an add says what');
  writeData(path.join(srv.data, 'project-cards.json'), { [pid]: require('../lib/jsonfile').readJson(path.join(srv.data, 'project-cards.json'), {})[pid].filter((c) => c.id !== added.id) });
  assert.equal((await srv.asChief('/company/cards/c2/cancel', { method: 'POST' })).status, 403);
});

test('a bot in no team of the project is refused', async () => {
  const { token } = await heldRun(srv, loner, 'Hello.');
  const r = (await self(srv, token, 'cards', { action: 'list' })).data;
  assert.deepEqual([r.ok, r.error], [false, 'You are in no team of a project.']);
  srv.unhold();
});

test('in a turn the owner started, the Chief removes the card and the goal they ask for', async () => {
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  srv.hold();
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Remove the customer calls card and the renewals goal' } });
  const turn = await srv.nextRun((x) => x.stdin.includes('Remove the customer calls card'), "the Chief's turn");
  try {
    let r = await srv.asChief('/company/cards/customer%20calls', { method: 'DELETE', headers: { 'X-Chief-Chat': chat.id } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.cards.some((x) => x.id === 'c2'), false);
    r = await srv.asChief('/company/objectives/renewed', { method: 'DELETE', headers: { 'X-Chief-Chat': chat.id } });
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.deepEqual(r.data.objectives.map((o) => o.id), ['o2']);
  } finally { srv.unhold(); srv.release(turn); }
});
