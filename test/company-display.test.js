// How the home shows each objective (#690): `display` (pace, bar or status) is kept per objective and changed by the
// owner or the Chief's tool; an objective with no number has steps or one tick; a new `current` of a running company
// is kept in its history as the value of that day, for the pace chart.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer } = require('./helpers');
const companyLib = require('../lib/company');

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.stop(); });

test('features name company-display', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('company-display'));
});

test('display, steps and done are kept per objective; a wrong display is refused', async () => {
  assert.equal((await srv.api('/company', { method: 'POST', body: { start: 'fernhill.app' } })).status, 201);
  let r = await srv.api('/company', { method: 'PATCH', body: { objectives: [{ name: 'Active users', target: 100, current: 0 }, { name: 'Launch page live', display: 'chart' }] } });
  const [users, launch] = r.data.objectives;
  assert.equal(users.display, undefined);
  assert.equal(launch.display, undefined);
  r = await srv.api(`/company/objectives/${users.id}`, { method: 'PUT', body: { display: 'bar' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.objectives[0].display, 'bar');
  assert.equal((await srv.api('/company')).data.company.objectives[0].display, 'bar'); // kept
  assert.equal((await srv.api(`/company/objectives/${users.id}`, { method: 'PUT', body: { display: 'pie' } })).status, 400);
  r = await srv.asChief(`/company/objectives/${users.id}`, { method: 'PUT', body: { display: null } });
  assert.equal(r.status, 200);
  assert.equal(r.data.objectives[0].display, undefined);
  r = await srv.asChief(`/company/objectives/${launch.id}`, { method: 'PUT', body: { steps: [{ text: 'Write the copy', done: true }, { text: 'Pick a domain' }, { text: '' }] } });
  assert.deepEqual(r.data.objectives[1].steps, [{ text: 'Write the copy', done: true }, { text: 'Pick a domain', done: false }]);
  assert.equal((await srv.api(`/company/objectives/${launch.id}`, { method: 'PUT', body: { steps: 'all' } })).status, 400);
  r = await srv.api(`/company/objectives/${launch.id}`, { method: 'PUT', body: { done: true } });
  assert.equal(r.data.objectives[1].done, true);
  assert.equal((await srv.api(`/company/objectives/${users.id}`, { method: 'PUT', body: { current: null } })).status, 400);
});

test("a running company's objective keeps one value a day in its history", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'company-display-'));
  let at = new Date('2026-10-01T09:00:00Z');
  const store = companyLib.create({ file: path.join(dir, 'company.json'), now: () => at });
  store.start({ start: 'fernhill.app' });
  store.patch({ objectives: [{ name: 'Active users', target: 100, current: 0 }] });
  const id = store.read().objectives[0].id;
  store.setObjective(id, { current: 3 });
  assert.equal(store.read().objectives[0].history, undefined, 'not before it runs');
  store.begin({});
  store.setObjective(id, { current: 4 });
  store.setObjective(id, { current: 7 });
  at = new Date('2026-10-05T09:00:00Z');
  store.setObjective(id, { current: 12 });
  store.setObjective(id, { target: 120 });
  const o = store.read().objectives[0];
  assert.deepEqual(o.history, [{ day: 1, value: 7 }, { day: 5, value: 12 }]);
  assert.equal(o.target, 120);
  assert.match(store.promptNote(), /Active users, 12 of 120/);
  fs.rmSync(dir, { recursive: true, force: true });
});
