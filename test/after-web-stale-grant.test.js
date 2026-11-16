// A grant of "Always allow reminders" saved before reminders needed no card at all (ADR 249): the Chief's list
// leaves it out, a held change never matches it, and removing it still clears it.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, restartServer } = require('./helpers');

const servers = [];
after(async () => { for (const s of servers) await s.stop(); });

test('a saved "reminders" grant is not listed, and DELETE still clears it', async () => {
  let srv = await startServer();
  srv = await restartServer(srv, (data) => {
    const file = path.join(data, 'settings.json');
    let s = {};
    try { s = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { /* none yet */ }
    fs.writeFileSync(file, JSON.stringify({ ...s, chiefAfterWeb: ['reminders', 'quiet-hours'] }));
  });
  servers.push(srv);
  const quiet = [{ type: 'quiet-hours', label: 'changes to your quiet hours' }];
  assert.deepEqual((await srv.api('/chief/after-web')).data.types, quiet);
  const r = await srv.api('/chief/after-web', { method: 'DELETE', body: { type: 'reminders' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.types, quiet);
  assert.equal((await srv.api('/chief/after-web', { method: 'DELETE', body: { type: 'reminders' } })).status, 404, 'gone for good');
});
