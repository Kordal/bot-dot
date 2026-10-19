// One update for every account, a backup per account (#473, ADR 028). On a machine of several accounts the admin
// updates botdot for all of them at once, on the admin page (test/front-door-update.test.js): an account's own
// botdot server has no update of its own, and its page shows none. The Mac's botdot (one account, BOT_DOT_PLATFORM
// mac) keeps its update. A backup holds the account it was made in alone, is named with it, and restores into it.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, ROOT } = require('./helpers');
const { webSource } = require('./web-source');

const PASS = 'a passphrase long enough';
const servers = [];
after(async () => { for (const s of servers) await s.stop?.(); });
const start = async (opts) => { const s = await startServer(opts); servers.push(s); return s; };

test('an account\'s botdot has no update of its own: the admin updates every account at once', async () => {
  const s = await start({ account: 'ann' });
  const v = (await s.api('/version')).data;
  assert.ok(!v.features.includes('updates'), 'the apps show no update');
  const u = await s.api('/updates');
  assert.equal(u.status, 200);
  assert.equal(u.data.supported, false);
  assert.equal(u.data.byAdmin, true);
  assert.equal(u.data.available, false);
  assert.equal((await s.api('/updates/check', { method: 'POST' })).data.byAdmin, true);
  const apply = await s.api('/updates/apply', { method: 'POST', body: {} });
  assert.equal(apply.status, 403);
  assert.match(apply.data.error, /admin updates botdot for every account at once/);
});

test('the Mac\'s botdot keeps its update', async () => {
  const s = await start({ account: 'ann', env: { BOT_DOT_PLATFORM: 'mac' } });
  assert.ok((await s.api('/version')).data.features.includes('updates'));
  assert.notEqual((await s.api('/updates')).data.byAdmin, true);
});

test('the web page has no update of botdot', () => {
  const app = webSource();
  assert.ok(!/['"`]\/updates/.test(app), 'calls no route of the update');
  assert.ok(!/Update botdot|upd-row|update_available/.test(app));
});

test('a backup holds the account it was made in, is named with it, and restores into it', async () => {
  const ann = await start({ account: 'ann' });
  assert.equal((await ann.api('/backups/passphrase', { method: 'PUT', body: { passphrase: PASS } })).status, 200);
  const made = await ann.api('/backups/now', { method: 'POST' });
  const name = made.data.last.name;
  const res = await fetch(`${ann.base}/api/backups/${name}`, { headers: { 'X-Bot-Dot': '1' } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get('content-disposition'), `attachment; filename="${name.replace(/^bot-dot-/, 'bot-dot-ann-')}"`);
  const file = Buffer.from(await res.arrayBuffer());

  // Restored into the same account (a fresh one of the same name, as after moving machines): the manifest names it.
  const again = await start({ account: 'ann' });
  const up = await again.api('/backups/upload', { method: 'POST', raw: file });
  const r = await again.api('/backups/restore', { method: 'POST', body: { file: up.data.file, passphrase: PASS } });
  assert.equal(r.data.ok, true, JSON.stringify(r.data));
  assert.equal(r.data.account, 'ann');
});
