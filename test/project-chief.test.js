// The Chief's own chat of a project (project-chief): a project's view names it once it exists, the owner's tap makes it
// (the same chat botdot's turns about the project go to), and a second tap finds it.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { startServer, writeData } = require('./helpers');

let srv;
before(async () => { srv = await startServer({ env: { BOT_DOT_COMPANY_EVERY_MS: '300', BOT_DOT_LEAD_DELAY_MS: 'off' } }); });
after(async () => { await srv.stop(); });

const at = (p, id) => `${p}?project=${encodeURIComponent(id)}`;

test('the server says projects have a Chief chat', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('project-chief'));
});

test('a project has no Chief chat until it is asked for, then one, the same each time', async () => {
  writeData(path.join(srv.data, 'company.json'), { projects: [
    { id: 'p1', name: 'Botdot', start: 'botdot.app', kind: 'site', phase: 'running', startedAt: '2026-10-01T00:00:00.000Z', color: '#ff6b35' },
    { id: 'p2', name: 'Mealwise', start: 'A meal planner', kind: 'idea', phase: 'running', startedAt: '2026-10-01T00:00:00.000Z', color: '#34c759' },
  ] });
  assert.equal((await srv.api(at('/company', 'p1'))).data.company.chiefChat, null);
  const a = await srv.api(at('/company/chief-chat', 'p1'), { method: 'POST' });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  assert.match(a.data.chatId, /\S/);
  assert.equal(a.data.company.chiefChat, a.data.chatId);
  const b = await srv.api(at('/company/chief-chat', 'p1'), { method: 'POST' });
  assert.equal(b.data.chatId, a.data.chatId);
  assert.equal((await srv.api(at('/company', 'p1'))).data.company.chiefChat, a.data.chatId);
  // Another project has its own, and the chat is one of the Chief's chats.
  assert.equal((await srv.api(at('/company', 'p2'))).data.company.chiefChat, null);
  const c = await srv.api(at('/company/chief-chat', 'p2'), { method: 'POST' });
  assert.notEqual(c.data.chatId, a.data.chatId);
  const chats = (await srv.api('/chief')).data.chats;
  assert.ok(chats.some((x) => x.id === a.data.chatId));
});

test('a project that is not there has none to make', async () => {
  const r = await srv.api(at('/company/chief-chat', 'nope'), { method: 'POST' });
  assert.equal(r.status, 404);
});
