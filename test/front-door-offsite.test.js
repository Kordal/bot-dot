// The machine's off-site backup on the admin page and in the admin's account (#1017): the front door reads what root's
// step says in status/offsite.json (#1016), shows a line on /admin, and tells the admin's account once when the backup
// turns late (its last run failed, or its last good one is older than 26 hours) and once when it works again.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const passkey = require('./fixtures/soft-passkey');
const { startFrontDoor, standIn } = require('./front-door-helpers');
const { waitFor, sleep } = require('./helpers');

let door, status, ann, browser;
before(async () => {
  status = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-status-'));
  door = await startFrontDoor({ env: { FRONT_DOOR_ADMIN: 'ann', FRONT_DOOR_STATUS: status, FRONT_DOOR_OFFSITE_EVERY_MS: '200', FRONT_DOOR_OFFSITE_TELL_MS: '200' } });
  ann = await standIn(door, 'ann');
  browser = door.browser();
  const key = passkey.create({ rpId: door.rpId, origin: door.origin });
  const options = await browser.post(`${door.firstLink.path}/options`, { name: 'ann' });
  assert.equal((await browser.post(door.firstLink.path, { name: 'ann', credential: key.register(options.data.publicKey) })).status, 201);
});
after(async () => {
  await door?.stop();
  ann?.close();
  fs.rmSync(status, { recursive: true, force: true });
});

const said = (value) => fs.writeFileSync(path.join(status, 'offsite.json'), JSON.stringify(value));
const told = () => ann.seen.filter((r) => r.url === '/api/backups/machine').map((r) => ({ ...JSON.parse(r.body), room: r.headers['x-botdot-room'] }));
const ago = (hours) => new Date(Date.now() - hours * 3600_000).toISOString();

test('a machine without an off-site backup shows no line and tells nobody, also after a request for one', async () => {
  assert.equal((await browser.get('/admin/offsite')).data.offsite, null);
  said({ state: 'off', at: ago(0), error: 'This machine has no off-site repository: name one with BOT_DOT_OFFSITE_REPO.' });
  const off = (await browser.get('/admin/offsite')).data;
  assert.equal(off.offsite, null);
  assert.equal(off.setup.error, null, 'not a setup that failed');
  await sleep(600);
  assert.deepEqual(told(), []);
  const script = await browser.get('/front-door/admin.js');
  assert.match(script.text, /'\/admin\/offsite'/);
  assert.match((await browser.get('/admin')).text, /<div class="panel update" id="offsite-state" hidden><div><p id="offsite"><\/p><\/div>/);
});

test('a good backup is a line and no message; a failed one tells the admin once, and a good one again says it works', async () => {
  said({ state: 'done', at: ago(2), lastSuccess: ago(2) });
  const good = (await browser.get('/admin/offsite')).data.offsite;
  assert.equal(good.late, false);
  assert.equal(good.state, 'done');
  await sleep(600);
  assert.deepEqual(told(), [], 'nothing was ever late');

  said({ state: 'failed', at: ago(0), lastSuccess: ago(30), error: 'Fatal: unable to open repository' });
  const bad = (await browser.get('/admin/offsite')).data.offsite;
  assert.deepEqual({ late: bad.late, error: bad.error }, { late: true, error: 'Fatal: unable to open repository' });
  await waitFor(() => told().length === 1, { what: 'the admin told' });
  await sleep(600);
  assert.equal(told().length, 1, 'once');
  assert.deepEqual(told()[0], { late: true, lastSuccess: bad.lastSuccess, error: 'Fatal: unable to open repository', room: '1' });

  said({ state: 'done', at: ago(0), lastSuccess: ago(0) });
  await waitFor(() => told().length === 2, { what: 'the admin told it works again' });
  assert.equal(told()[1].late, false);
});

test('a backup whose last good run is older than 26 hours is late though none failed', async () => {
  said({ state: 'backing-up', at: ago(0), started: ago(0), lastSuccess: ago(27) });
  assert.equal((await browser.get('/admin/offsite')).data.offsite.late, true);
  said({ state: 'backing-up', at: ago(0), started: ago(0), lastSuccess: ago(25) });
  assert.equal((await browser.get('/admin/offsite')).data.offsite.late, false);
  said({ state: 'backing-up', at: ago(0), started: ago(1) });
  assert.equal((await browser.get('/admin/offsite')).data.offsite.late, false, 'the first run, under way');
});

test('a failed restore test is late too, until one passes, and the weekly check is shown (#1018)', async () => {
  said({ state: 'done', at: ago(1), lastSuccess: ago(1), check: { at: ago(1), subset: '3/20', ok: true } });
  const write = (v) => fs.writeFileSync(path.join(status, 'restore-test.json'), JSON.stringify(v));
  write({ state: 'failed', at: ago(0), account: 'ann', error: 'accounts/ann/data.tar came back with 3 bytes, and restic recorded 4096.' });
  let o = (await browser.get('/admin/offsite')).data.offsite;
  assert.equal(o.late, true);
  assert.deepEqual(o.check, { at: o.check.at, subset: '3/20', ok: true });
  assert.deepEqual({ state: o.restoreTest.state, account: o.restoreTest.account }, { state: 'failed', account: 'ann' });
  const before = told().length;
  await waitFor(() => told().length > before && told().at(-1).late === true, { what: 'the admin told of the failed test' });
  assert.match(told().at(-1).error, /^the restore test of ann failed: accounts\/ann\/data.tar came back/);
  write({ state: 'passed', at: ago(0), account: 'ann', bots: 3 });
  o = (await browser.get('/admin/offsite')).data.offsite;
  assert.equal(o.late, false);
  assert.equal(o.restoreTest.bots, 3);
});

test('nobody signed out sees it', async () => {
  const other = door.browser();
  assert.notEqual((await other.get('/admin/offsite')).status, 200, 'not without the admin\'s session');
});

test('an erased account\'s off-site snapshots that root\'s step forgot are kept in the audit log, once each (#1019)', async () => {
  const entries = () => fs.readFileSync(path.join(door.data, 'audit.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((e) => e.action === 'offsite-forgotten');
  const forgot = { account: 'bob', erased: '2026-10-21T12:00:00Z', at: '2026-11-05T03:10:00Z', snapshots: 7 };
  fs.writeFileSync(path.join(status, 'offsite-forgotten.json'), JSON.stringify({ forgotten: [forgot, { account: '../x', erased: 'no', at: 'no' }] }));
  await waitFor(() => entries().length === 1, { what: 'the audit entry' });
  assert.deepEqual(entries().map(({ actor, account, detail }) => ({ actor, account, detail })), [{ actor: 'front-door', account: 'bob', detail: 'erased 2026-10-21 12:00 UTC · 7 snapshots' }]);
  fs.writeFileSync(path.join(status, 'offsite-forgotten.json'), JSON.stringify({ forgotten: [forgot, { ...forgot, account: 'carol', at: '2026-11-06T03:10:00Z' }] }));
  await waitFor(() => entries().length === 2, { what: 'the next one' });
  await sleep(600);
  assert.deepEqual(entries().map((e) => e.account), ['bob', 'carol'], 'each once');
  const audit = await browser.get('/admin/audit?action=offsite-forgotten');
  assert.equal(audit.status, 200);
  assert.ok(audit.data.actions.includes('offsite-forgotten'));
});

test("each account is told its own off-site backup: off, then when its data last went off-site, kept from run to run (ADR 158)", async () => {
  const mine = () => ann.seen.filter((r) => r.url === '/api/backups/offsite').map((r) => ({ ...JSON.parse(r.body), room: r.headers['x-botdot-room'] }));
  fs.rmSync(path.join(status, 'restore-test.json'), { force: true });
  said({ state: 'off', at: ago(0) });
  await waitFor(() => mine().at(-1)?.state === 'off', { what: 'ann told it is off' });
  assert.deepEqual(mine().at(-1), { state: 'off', lastSuccess: null, late: false, room: '1' });
  const n = mine().length;
  await sleep(600);
  assert.equal(mine().length, n, 'told once while nothing changes');

  const first = ago(2);
  said({ state: 'done', at: first, started: ago(3), finished: first, lastSuccess: first, snapshots: { 'front-door/data.tar': 'a1', 'accounts/ann/data.tar': 'b2', 'accounts/ann/env': 'c3' }, failed: [] });
  await waitFor(() => mine().at(-1)?.state === 'done', { what: 'ann told it is done' });
  assert.deepEqual(mine().at(-1), { state: 'done', lastSuccess: first, late: false, room: '1' });

  said({ state: 'backing-up', at: ago(0), started: ago(0), part: 'accounts/ann/data.tar', lastSuccess: first });
  await waitFor(() => mine().at(-1)?.state === 'backing-up', { what: 'ann told it is running' });
  assert.equal(mine().at(-1).lastSuccess, first, 'the last success stays while a run is under way');

  // A run in which ann's data failed: failed, late, with the last success of before.
  said({ state: 'failed', at: ago(0), started: ago(1), finished: ago(0), lastSuccess: first, snapshots: { 'front-door/data.tar': 'a9' }, failed: ['accounts/ann/data.tar'], part: 'accounts/ann/data.tar', error: 'accounts/ann/data.tar: tar exited 2' });
  await waitFor(() => mine().at(-1)?.state === 'failed', { what: 'ann told it failed' });
  assert.deepEqual(mine().at(-1), { state: 'failed', lastSuccess: first, late: true, room: '1' });
  // One that failed elsewhere: done for ann.
  const later = ago(0);
  said({ state: 'failed', at: later, started: ago(1), finished: later, lastSuccess: first, snapshots: { 'accounts/ann/data.tar': 'd4' }, failed: ['accounts/bob/data.tar'], error: 'accounts/bob/data.tar: tar exited 2' });
  await waitFor(() => mine().at(-1)?.state === 'done', { what: 'ann told hers is done' });
  assert.deepEqual(mine().at(-1), { state: 'done', lastSuccess: later, late: false, room: '1' });
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(door.data, 'offsite-accounts.json'), 'utf8')), { ann: later });
});
