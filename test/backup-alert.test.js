// A backup that stops working is said (#1017, lib/backup-alert.js): the owner's own backups once per failure streak
// after 48 hours, the machine's off-site backup in the admin's account once when it turns late and once when it works
// again, each as a plain Chief message held through quiet hours.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { startServer, waitFor } = require('./helpers');

const HOUR = 3600_000;
// 2026-11-05 12:00 UTC: outside the quiet hours below; 23:00 is inside them.
const NOON = Date.parse('2026-11-05T12:00:00Z');
const NIGHT = Date.parse('2026-11-05T23:00:00Z');
const QUIET = { start: 22, end: 7, timeZone: 'UTC' };

function setup(t, status) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-alert-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const posted = [];
  let at = NOON;
  const alert = require('../lib/backup-alert').create({ dataDir, backups: { status: () => status }, post: (text) => posted.push(text), quietHours: () => QUIET, now: () => at });
  const again = () => require('../lib/backup-alert').create({ dataDir, backups: { status: () => status }, post: (text) => posted.push(text), quietHours: () => QUIET, now: () => at });
  return { alert, again, posted, set: (ms) => { at = ms; } };
}

test("the owner hears once per streak when their backup hasn't finished for 48 hours, with the error", (t) => {
  const status = { configured: true, lastSuccess: new Date(NOON - 47 * HOUR).toISOString(), lastError: 'ENOSPC: no space left on device', since: '2026-10-01T00:00:00.000Z' };
  const s = setup(t, status);
  s.alert.check();
  assert.deepEqual(s.posted, [], 'not before 48 hours');
  status.lastSuccess = new Date(NOON - 49 * HOUR).toISOString();
  s.alert.check();
  assert.equal(s.posted.length, 1);
  assert.match(s.posted[0], /^Your backup hasn't finished since 2026-11-03 11:00 UTC\. The last try failed: ENOSPC: no space left on device$/);
  s.alert.check();
  s.again().check();
  assert.equal(s.posted.length, 1, 'once, also after a restart');
  // A good backup ends the streak; the next one is said again.
  status.lastSuccess = new Date(NOON).toISOString();
  s.alert.check();
  status.lastSuccess = new Date(NOON - 50 * HOUR).toISOString();
  s.alert.check();
  assert.equal(s.posted.length, 2);
});

test('never at night: what is late then is said when the quiet hours end', (t) => {
  const status = { configured: true, lastSuccess: null, lastError: null, since: new Date(NIGHT - 49 * HOUR).toISOString() };
  const s = setup(t, status);
  s.set(NIGHT);
  s.alert.check();
  assert.deepEqual(s.posted, []);
  s.set(NIGHT + 9 * HOUR);
  s.alert.check();
  assert.deepEqual(s.posted, ['Your backups are on, but none has finished yet.']);
});

test('backups that are off say nothing', (t) => {
  const s = setup(t, { configured: false, lastSuccess: null, since: null });
  s.alert.check();
  assert.deepEqual(s.posted, []);
});

test("the machine's off-site backup is said once when late and once when it works again", (t) => {
  const s = setup(t, { configured: false });
  s.alert.machine({ late: true, lastSuccess: '2026-11-04T02:10:00.000Z', error: 'Fatal: unable to open repository' });
  s.alert.machine({ late: true, lastSuccess: '2026-11-04T02:10:00.000Z', error: 'Fatal: unable to open repository' });
  assert.deepEqual(s.posted, ["The machine's off-site backup hasn't finished since 2026-11-04 02:10 UTC. The last run failed: Fatal: unable to open repository"]);
  s.again().machine({ late: true });
  assert.equal(s.posted.length, 1, 'kept across a restart');
  s.alert.machine({ late: false });
  assert.equal(s.posted.at(-1), "The machine's off-site backup works again.");
  assert.equal(s.posted.length, 2);
});

test('at night the machine\'s news waits, and good news before the bad was said says neither', (t) => {
  const s = setup(t, { configured: false });
  s.set(NIGHT);
  s.alert.machine({ late: true });
  s.alert.machine({ late: false });
  s.set(NIGHT + 9 * HOUR);
  s.alert.check();
  assert.deepEqual(s.posted, []);
  s.set(NIGHT);
  s.alert.machine({ late: true });
  s.set(NIGHT + 9 * HOUR);
  s.alert.check();
  assert.deepEqual(s.posted, ["The machine's off-site backup hasn't finished yet."]);
});

test('the front door alone says how the machine\'s backup goes, and the Chief says it in a chat', async (t) => {
  const a = await startServer();
  t.after(() => a.stop());
  assert.equal((await a.api('/backups/machine', { method: 'POST', body: { late: true } })).status, 403, 'not the owner');
  assert.equal((await a.api('/backups/machine', { method: 'POST', headers: { 'x-botdot-room': '1' }, body: {} })).status, 400);
  const r = await a.api('/backups/machine', { method: 'POST', headers: { 'x-botdot-room': '1' }, body: { late: true, lastSuccess: '2026-11-04T02:10:00Z', error: 'Fatal: unable to open repository' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  let text = '';
  await waitFor(async () => {
    for (const c of (await a.api('/chief')).data.chats || []) {
      const chat = (await a.api(`/chief/chats/${c.id}`)).data;
      const m = (chat.messages || []).find((x) => /off-site backup/.test(x.text || ''));
      if (m) { text = m.text; return true; }
    }
    return false;
  }, { what: 'the Chief\'s message' });
  assert.match(text, /^The machine's off-site backup hasn't finished since 2026-11-04 02:10 UTC\. The last run failed: Fatal: unable to open repository$/);
});
