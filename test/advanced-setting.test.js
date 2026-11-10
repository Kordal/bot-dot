// Advanced (ADR 186): one switch of the account that shows the apps' technical rows. A new account starts with it off,
// an account that had settings before the switch existed keeps seeing what it saw, and only true or false is taken.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, restartServer } = require('./helpers');

const servers = [];
after(async () => { for (const s of servers) await s.stop(); });

test('a new account starts with Advanced off; the owner turns it on and off; the features say so', async () => {
  const srv = await startServer();
  servers.push(srv);
  assert.ok((await srv.api('/version')).data.features.includes('advanced'));
  assert.equal((await srv.api('/settings')).data.settings.advanced, false);
  let r = await srv.api('/settings', { method: 'PUT', body: { advanced: true } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.settings.advanced, true);
  r = await srv.api('/settings', { method: 'PUT', body: { advanced: 'yes' } });
  assert.equal(r.status, 400);
  assert.equal((await srv.api('/settings')).data.settings.advanced, true, 'a wrong value changes nothing');
  r = await srv.api('/settings', { method: 'PUT', body: { advanced: false } });
  assert.equal(r.data.settings.advanced, false);
});

test('an account with settings from before the switch starts with Advanced on, and keeps a choice once made', async () => {
  let srv = await startServer();
  srv = await restartServer(srv, (data) => fs.writeFileSync(path.join(data, 'settings.json'), JSON.stringify({ language: 'pl', defaultModel: '' })));
  servers.push(srv);
  const s = (await srv.api('/settings')).data.settings;
  assert.equal(s.advanced, true);
  assert.equal(s.language, 'pl', 'the rest is kept');
  await srv.api('/settings', { method: 'PUT', body: { advanced: false } });
  const again = await restartServer(srv);
  servers[servers.length - 1] = again;
  assert.equal((await again.api('/settings')).data.settings.advanced, false, 'off stays off after a restart');
});
