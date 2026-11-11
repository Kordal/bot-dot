const { test } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');
const { seed } = require('../deploy/seed-demo');
test('demo seeding uses fictional data and a second run keeps one project and its tasks', async (t) => {
  const server = await startServer();
  t.after(server.stop);
  const request = async (method, route, body) => {
    const r = await server.api(route.replace(/^\/api/, ''), { method, ...(body ? { body } : {}) });
    assert.ok(r.status < 300, `${route}: ${JSON.stringify(r.data)}`);
    return r.data;
  };
  await seed(request);
  await seed(request);
  const list = await request('GET', '/api/company/list');
  assert.equal(list.projects.length, 1);
  assert.equal(list.projects[0].name, 'Demo: community garden');
  const { company } = await request('GET', '/api/company');
  assert.equal(company.todos.length, 2);
});
