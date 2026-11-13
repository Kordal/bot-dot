// Exercise the production interval through the API, with an overdue saved-project fixture.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { startServer, makeBot, writeData, waitFor } = require('./helpers');

test('quiet hours hold automatic delivery, then one recorded update reaches the selected manager', async () => {
  const srv = await startServer({ env: { BOT_DOT_PROJECT_UPDATES_EVERY_MS: '25' } });
  try {
    const manager = await makeBot(srv, { name: 'Scheduled Garden Manager' });
    const hour = new Date().getUTCHours();
    assert.equal((await srv.api('/settings/quiet-hours', { method: 'PUT', body: { start: hour, end: (hour + 1) % 24, timeZone: 'UTC' } })).status, 200);
    const c = (await srv.api('/company', { method: 'POST', body: { empty: true, name: 'Scheduled garden' } })).data;
    const before = new Date(Date.now() - 2 * 864e5).toISOString();
    writeData(path.join(srv.data, 'company.json'), { ...c, lead: manager.id, startedAt: before, updates: { every: 'daily' }, updatesFrom: before });
    await new Promise((resolve) => setTimeout(resolve, 150)); // several real interval looks inside quiet hours
    assert.equal((await srv.api('/company')).data.company.lastUpdate, undefined);
    assert.equal((await srv.api(`/runs?botId=${manager.id}`)).data.length, 0);
    assert.equal((await srv.api('/settings/quiet-hours', { method: 'PUT', body: { start: 0, end: 0 } })).status, 200);
    const receipt = await waitFor(async () => (await srv.api('/company')).data.company.lastUpdate, { what: 'the overdue scheduled update' });
    assert.equal(receipt.botId, manager.id);
    assert.match(receipt.key, /^scheduled:/);
    await new Promise((resolve) => setTimeout(resolve, 150)); // further looks must not deliver it again
    const messages = (await srv.api(`/runs?botId=${manager.id}`)).data;
    assert.equal(messages.length, 1);
    assert.equal(messages[0].kind, 'project-update');
    assert.equal(messages[0].numTurns, 0);
    assert.match(messages[0].result, /Project update: Scheduled garden/);
  } finally { await srv.stop(); }
});
