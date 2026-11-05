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
  door = await startFrontDoor({ env: { FRONT_DOOR_ADMIN: 'ann', FRONT_DOOR_STATUS: status, FRONT_DOOR_OFFSITE_EVERY_MS: '200' } });
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
  assert.deepEqual((await browser.get('/admin/offsite')).data, { offsite: null });
  said({ state: 'off', at: ago(0), error: 'This machine has no off-site repository: name one with BOT_DOT_OFFSITE_REPO.' });
  assert.deepEqual((await browser.get('/admin/offsite')).data, { offsite: null });
  await sleep(600);
  assert.deepEqual(told(), []);
  const script = await browser.get('/front-door/admin.js');
  assert.match(script.text, /'\/admin\/offsite'/);
  assert.match((await browser.get('/admin')).text, /<p id="offsite" hidden><\/p>/);
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

test('nobody signed out sees it', async () => {
  const other = door.browser();
  assert.notEqual((await other.get('/admin/offsite')).status, 200, 'not without the admin\'s session');
});
