// Consolidated project updates use the same public API and chats as the owner.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');
let srv;
before(async () => { srv = await startServer(); });
after(() => srv?.stop());

test('one project update preference replaces the report controls without deleting old schedules', async () => {
  const made = await srv.api('/company', { method: 'POST', body: { start: 'Launch the garden club' } });
  const id = made.data.id;
  const url = `/company/updates?project=${id}`;
  assert.ok((await srv.api('/version')).data.features.includes('project-updates'));
  const old = (await srv.api(`/company?project=${id}`)).data.company;
  assert.equal(old.updates.every, 'existing');
  const changed = await srv.api(url, { method: 'PUT', body: { every: 'weekly' } });
  assert.equal(changed.status, 200, JSON.stringify(changed.data));
  assert.equal(changed.data.updates.every, 'weekly');
  assert.deepEqual(changed.data.standup, old.standup, 'the old setting is retained for compatibility');
  assert.equal((await srv.api(url, { method: 'PUT', body: { every: 'hourly' } })).status, 400);
  assert.equal((await srv.api(url, { method: 'PUT', body: { every: 'off' } })).data.updates.every, 'off');
});

test('an update reaches the selected manager once and leaves its unanswered question open', async () => {
  const { makeBot, waitFor } = require('./helpers');
  const fs = require('fs');
  const path = require('path');
  const boss = await makeBot(srv, { name: 'Garden Manager', emoji: '🌿' });
  fs.writeFileSync(path.join(srv.out, 'result-GardenManager.txt'), 'Which date?\n[[choices: Monday | Friday]]');
  await srv.api(`/bots/${boss.id}/run`, { method: 'POST', body: { prompt: 'Ask me for the date' } });
  await waitFor(async () => (await srv.api(`/bots/${boss.id}`)).data.asks, { what: 'the manager question' });
  const question = (await srv.api(`/bots/${boss.id}`)).data.asks;
  const made = await srv.api('/company', { method: 'POST', body: { empty: true, name: 'Garden launch' } });
  const id = made.data.id;
  await srv.api(`/company?project=${id}`, { method: 'PATCH', body: { lead: boss.id } });
  const url = `/company/updates/now?project=${id}`;
  const sent = await srv.api(url, { method: 'POST', body: { key: 'garden-update-once' } });
  assert.equal(sent.status, 200, JSON.stringify(sent.data));
  assert.equal(sent.data.update.botId, boss.id);
  assert.match(sent.data.update.text, /Garden launch/);
  assert.match(sent.data.update.text, /Needs you/);
  assert.match(sent.data.update.text, /Which date/);
  assert.deepEqual((await srv.api(`/bots/${boss.id}`)).data.asks, question, 'a summary is no answer');
  const again = await srv.api(url, { method: 'POST', body: { key: 'garden-update-once' } });
  assert.equal(again.data.update.key, sent.data.update.key);
  const updates = (await srv.api(`/runs?botId=${boss.id}`)).data.filter((r) => r.kind === 'project-update');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].trigger, 'project');
  assert.equal(updates[0].numTurns, 0, 'an update starts no bot or team turn');
  assert.equal((await srv.api(`/bots/${boss.id}`)).data.unread, 2, 'the summary is a new reply');
  await srv.api(`/company?project=${id}`, { method: 'PATCH', body: { lead: null } });
  const fallback = await srv.api(url, { method: 'POST', body: { key: 'garden-chief-update' } });
  const company = (await srv.api(`/company?project=${id}`)).data.company;
  assert.equal(fallback.data.update.chatId, company.chiefChat);
  assert.ok((await srv.api(`/chief/chats/${company.chiefChat}`)).data.messages.some((m) => m.projectUpdate === 'garden-chief-update'));
  assert.equal((await srv.asChief(url, { method: 'POST', body: { key: 'unasked-loop' } })).status, 403);
});
