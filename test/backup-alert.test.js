// A backup that stops working is said (#1017, lib/backup-alert.js): the machine's off-site backup in the admin's account
// once when it turns late and once when it works again, as a plain Chief message held through quiet hours. An account
// makes no backups of its own since ADR 158.
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

function setup(t) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-alert-'));
  t.after(() => fs.rmSync(dataDir, { recursive: true, force: true }));
  const posted = [];
  let at = NOON;
  const alert = require('../lib/backup-alert').create({ dataDir, post: (text) => posted.push(text), quietHours: () => QUIET, now: () => at });
  const again = () => require('../lib/backup-alert').create({ dataDir, post: (text) => posted.push(text), quietHours: () => QUIET, now: () => at });
  return { alert, again, posted, dataDir, set: (ms) => { at = ms; } };
}

test("what was told of the owner's own backups before ADR 158 is forgotten, and nothing more is said of them", (t) => {
  const s = setup(t);
  fs.writeFileSync(path.join(s.dataDir, 'backup-alerts.json'), JSON.stringify({ bdb: { told: '2026-11-01T03:00:00.000Z' } }));
  s.alert.check();
  assert.deepEqual(s.posted, []);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(s.dataDir, 'backup-alerts.json'), 'utf8')), {});
});

test("the machine's off-site backup is said once when late and once when it works again", (t) => {
  const s = setup(t);
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
  const s = setup(t);
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
