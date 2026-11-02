// A card on a project's board is changed from a chat (#907): a bot of the project's team sees the board's cards in
// its prompt, lists them and changes one by its title; the Chief changes one with its tool. The change keeps what the
// card was asked from. Only the owner adds or removes a card.
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
  writeData(path.join(srv.data, 'company.json'), { ...c, name: 'Quotz', phase: 'running', startedAt: new Date().toISOString(), teams: [{ id: 't1', name: 'Dev', bots: [a.id], lead: a.id }] });
  writeData(path.join(srv.data, 'project-cards.json'), { [pid]: [ready, { ...ready, id: 'c2', ask: 'Customer calls', title: 'Customer calls', answers: [] }] });
});
after(() => { srv.unhold(); return srv.stop(); });

const cardNow = async (id) => (await srv.api('/company')).data.company.cards.find((c) => c.id === id);

test("a bot of the project sees the board's cards, and changes the one the owner names, keeping what it was asked from", async (t) => {
  const { rec, token } = await heldRun(srv, a, 'Add a graph to the Buildr card');
  assert.match(rec.system, /The project's board has these cards: c1 "Buildr Open Issues", c2 "Customer calls"\. When the owner asks to change one, change it with change_project_card/);
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
  assert.deepEqual((await tools.request('tools/list')).tools.map((x) => x.name).filter((n) => /project_card/.test(n)), ['list_project_cards', 'change_project_card']);
  srv.unhold();
});

test('the Chief changes a card by its title; it never adds or removes one', async () => {
  const r = await srv.asChief('/company/cards/customer%20calls', { method: 'PUT', body: { ask: 'only this month' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await cardNow('c2')).ask, 'only this month');
  assert.equal((await srv.asChief('/company/cards/c2', { method: 'DELETE' })).status, 403);
  assert.equal((await srv.asChief('/company/cards', { method: 'POST', body: { ask: 'New one' } })).status, 403);
  assert.equal((await srv.asChief('/company/cards/c2/cancel', { method: 'POST' })).status, 403);
});

test('a bot in no team of the project is refused', async () => {
  const { token } = await heldRun(srv, loner, 'Hello.');
  const r = (await self(srv, token, 'cards', { action: 'list' })).data;
  assert.deepEqual([r.ok, r.error], [false, 'You are in no team of a project.']);
  srv.unhold();
});
