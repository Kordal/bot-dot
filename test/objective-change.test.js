// Changing a project's goal by chat (#819): POST /api/company/objectives/:id/change starts a Chief chat whose message
// names the goal (name, id, where it stands, project) above the owner's words; the Chief renames a goal with
// set_company_objective and moves the project's start day and delivery date with PUT /api/company/dates. The web
// page draws the pencil and opens the chat as a popup on the Projects screen (test/browser/objective-change.cjs).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, waitFor } = require('./helpers');
const { objectiveAsk } = require('../lib/tile-change');

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.stop());

test('the ask names the goal in one quoted line, then the owner’s words', () => {
  assert.equal(objectiveAsk({ id: 'o1', name: 'Sets logged', current: 0, target: 100 }, { id: 'p1' }, ' make it 150\n'), '> Project goal “Sets logged” · id o1 · 0 of 100 · project p1\n\nmake it 150');
  assert.equal(objectiveAsk({ id: 'o2', name: 'Plan\ndone', current: 0, target: 0, done: true }, { id: 'p1' }, 'x'), '> Project goal “Plan done” · id o2 · done · project p1\n\nx');
  assert.equal(objectiveAsk({ id: 'o3', name: 'Plan', current: 0, target: 0 }, { id: 'p1' }, 'x'), '> Project goal “Plan” · id o3 · project p1\n\nx');
});

let project, goal;
test('a change ask starts a Chief chat with the goal named; the features say objective-change', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('objective-change'));
  assert.ok((await srv.api('/version')).data.features.includes('objective-remove'), 'the apps show Remove in a goal\'s menu');
  assert.equal((await srv.api('/company', { method: 'POST', body: { name: 'My Gym Advisor', empty: true } })).status, 201);
  project = (await srv.api('/company', { method: 'PATCH', body: { objectives: [{ name: 'Sets logged with weight and reps', target: 100, current: 0 }] } })).data;
  goal = project.objectives[0];
  srv.reply('On it.');
  const r = await srv.api(`/company/objectives/${goal.id}/change`, { method: 'POST', body: { text: 'Make it 150' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  const quoted = `> Project goal “Sets logged with weight and reps” · id ${goal.id} · 0 of 100 · project ${project.id}`;
  const turn = await srv.nextRun((x) => !!x.botdot, "the Chief's turn");
  assert.ok(JSON.stringify(turn).includes(quoted));
  await waitFor(async () => !(await srv.api(`/chief/chats/${r.data.chatId}`)).data.busy, { what: 'the Chief to reply' });
  assert.equal((await srv.api(`/chief/chats/${r.data.chatId}`)).data.messages[0].text, `${quoted}\n\nMake it 150`);
});

test('a change ask needs words and a goal, and only the owner sends one', async () => {
  assert.equal((await srv.api(`/company/objectives/${goal.id}/change`, { method: 'POST', body: { text: '  ' } })).status, 400);
  assert.equal((await srv.api('/company/objectives/nope/change', { method: 'POST', body: { text: 'x' } })).status, 404);
  assert.equal((await srv.asChief(`/company/objectives/${goal.id}/change`, { method: 'POST', body: { text: 'x' } })).status, 403);
});

test('the Chief renames a goal; an empty name is refused', async () => {
  let r = await srv.asChief(`/company/objectives/${goal.id}`, { method: 'PUT', body: { name: 'Sets logged', target: 150 } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.objectives[0].name, 'Sets logged');
  assert.equal(r.data.objectives[0].target, 150);
  r = await srv.asChief(`/company/objectives/${goal.id}`, { method: 'PUT', body: { name: '  ' } });
  assert.equal(r.status, 400);
});

test('the Chief moves the start day and the delivery date; nothing else goes through that route', async () => {
  const start = new Date(Date.now() - 9 * 86_400_000).toISOString().slice(0, 10);
  let r = await srv.asChief('/company/dates', { method: 'PUT', body: { startDay: start, deliverBy: '2027-01-31', name: 'Renamed' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.startedAt, `${start}T00:00:00.000Z`);
  assert.equal(r.data.day, 10);
  assert.equal(r.data.deliverBy, '2027-01-31');
  assert.equal(r.data.name, 'My Gym Advisor', 'only the dates change');
  assert.equal((await srv.asChief('/company/dates', { method: 'PUT', body: { startDay: 'soon' } })).status, 400);
  assert.equal((await srv.asChief('/company/dates', { method: 'PUT', body: {} })).status, 400);
  assert.equal((await srv.asChief('/company/dates', { method: 'PUT', body: { deliverBy: 'none' } })).data.deliverBy, 'none');
});

test('the Chief changes the goal sentence and adds an objective with set_project_goal', async (t) => {
  const { rpcClient } = require('./memory-helpers');
  srv.reply('Done.');
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Change the goal.' } });
  const turn = await srv.nextRun((r) => !!r.botdot, "the Chief's turn");
  await waitFor(async () => !(await srv.api(`/chief/chats/${chat.id}`)).data.busy, { what: 'the Chief to reply' });
  const tools = rpcClient(t, 'mcp-server.js', turn.botdot.env);
  let c = await tools.json('set_project_goal', { goal: 'Help 500 lifters log every set' });
  assert.equal(c.goal, 'Help 500 lifters log every set');
  c = await tools.json('set_project_goal', { add: { name: 'Weekly lifters', target: 500 } });
  assert.deepEqual(c.objectives.map((o) => [o.name, o.current, o.target]), [['Sets logged', 0, 150], ['Weekly lifters', 0, 500]]);
  assert.equal(c.objectives[0].id, goal.id, 'the goals there were keep their ids');
  assert.equal(c.goal, 'Help 500 lifters log every set');
  const none = await tools.call('set_project_goal', {});
  assert.ok(none.isError && /Say goal or add/.test(JSON.stringify(none.content)), JSON.stringify(none));
});

test('PUT /api/company/goal: the goal sentence and one new objective, nothing else', async () => {
  assert.equal((await srv.asChief('/company/goal', { method: 'PUT', body: {} })).status, 400);
  assert.equal((await srv.asChief('/company/goal', { method: 'PUT', body: { add: { name: ' ' } } })).status, 400);
  const r = await srv.asChief('/company/goal', { method: 'PUT', body: { goal: 'Help 600 lifters', name: 'Renamed' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.goal, 'Help 600 lifters');
  assert.equal(r.data.name, 'My Gym Advisor', 'only the goal changes');
  for (let i = r.data.objectives.length; i < 6; i++) await srv.asChief('/company/goal', { method: 'PUT', body: { add: { name: `Goal ${i}` } } });
  const full = await srv.asChief('/company/goal', { method: 'PUT', body: { add: { name: 'One more' } } });
  assert.equal(full.status, 409);
  assert.equal(full.data.state, 'full');
});
