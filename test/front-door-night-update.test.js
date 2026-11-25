// A machine of one account updates itself in two steps (ADR 183, ADR 271, #1689). (1) The front door asks root's step to
// download, as the admin page's Update does: at 04:00 in the owner's time zone for "at night" and "when I say", as soon as
// root's step found the release for "as soon as it's ready", never while the account waits for a version, once a night.
// (2) The account is left waiting, and the front door switches it by the same plan as every account's (switch-plan.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { waitFor } = require('./helpers');
const { startFrontDoor, standIn, zoneWhere, updateAnswers } = require('./front-door-helpers');
const passkey = require('./fixtures/soft-passkey');
const store = require('../lib/front-door/store');
const { shouldUpdate, AGAIN_MS } = require('../lib/front-door/night-update');

const hourIn = (timeZone) => Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
const SETUP_KEY = () => crypto.randomBytes(32).toString('base64url');

test('the rule: only at night, only for a newer signed release, once a night, never while the account waits', () => {
  const now = Date.parse('2026-11-10T04:10:00Z');
  const base = { installed: { version: 'abc1234' }, newest: { version: 'def5678' }, last: null, asked: false, hour: 4, now };
  assert.equal(shouldUpdate(base), true);
  assert.equal(shouldUpdate({ ...base, hour: 3 }), false, 'not before');
  assert.equal(shouldUpdate({ ...base, hour: 5 }), false, 'nor after');
  assert.equal(shouldUpdate({ ...base, newest: { version: 'abc1234' } }), false, 'it runs the newest');
  assert.equal(shouldUpdate({ ...base, newest: null }), false, 'no release found');
  assert.equal(shouldUpdate({ ...base, installed: { version: 'abc1234', selfBuilt: true } }), false, 'images built on the machine');
  assert.equal(shouldUpdate({ ...base, asked: true }), false, 'one is asked or going');
  assert.equal(shouldUpdate({ ...base, waits: true }), false, 'the account waits for a version already: root\'s step would switch it');
  assert.equal(shouldUpdate({ ...base, last: { version: 'def5678', at: new Date(now - 30 * 60_000).toISOString() } }), false, 'asked tonight');
  assert.equal(shouldUpdate({ ...base, last: { version: 'def5678', at: new Date(now - AGAIN_MS).toISOString() } }), true, 'a failed one, the next night');
});

test('"as soon as it\'s ready" does not wait for the night hour; the others do', () => {
  const now = Date.parse('2026-11-10T12:10:00Z');
  const base = { installed: { version: 'abc1234' }, newest: { version: 'def5678' }, last: null, asked: false, hour: 12, now };
  assert.equal(shouldUpdate({ ...base, when: 'ready' }), true);
  assert.equal(shouldUpdate({ ...base, when: 'night' }), false);
  assert.equal(shouldUpdate({ ...base, when: 'manual' }), false);
  assert.equal(shouldUpdate({ ...base, when: 'manual', hour: 4 }), true, 'at night, "when I say" downloads too: the owner switches it');
  // The rest holds for it as for the others.
  assert.equal(shouldUpdate({ ...base, when: 'ready', waits: true }), false);
  assert.equal(shouldUpdate({ ...base, when: 'ready', asked: true }), false);
  assert.equal(shouldUpdate({ ...base, when: 'ready', newest: { version: 'abc1234' } }), false);
  assert.equal(shouldUpdate({ ...base, when: 'ready', last: { version: 'def5678', at: new Date(now - 60_000).toISOString() } }), false, 'a failed one is asked again in 20 hours, not at once');
});

// One account's machine: the requests and status folders, root's step's say of the version (and the newest it found), the
// front door and the stand-in account. owner: what its entry says ({ updateWhen }); null leaves it unmade.
async function oneAccount(t, { hour, when = null, answer = null, env = {}, newest = 'def5678' } = {}) {
  const requests = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-requests-'));
  const status = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-status-'));
  fs.writeFileSync(path.join(status, 'version.json'), JSON.stringify({ version: 'abc1234' }));
  if (newest) fs.writeFileSync(path.join(status, 'latest.json'), JSON.stringify({ version: newest, at: '2026-11-10T03:00:00Z' }));
  const door = await startFrontDoor({ env: { FRONT_DOOR_ONE_ACCOUNT: 'owner', FRONT_DOOR_SETUP_KEY: SETUP_KEY(), FRONT_DOOR_REQUESTS: requests, FRONT_DOOR_STATUS: status, FRONT_DOOR_NIGHT_EVERY_MS: '100', FRONT_DOOR_SWITCH_EVERY_MS: '100', ...(hour === undefined ? {} : { FRONT_DOOR_NIGHT_HOUR: String(hour) }), ...env } });
  if (when) store.open(door.data).importAccount('owner', { updateWhen: when });
  const owner = await standIn(door, 'owner', { answer: answer || updateAnswers() });
  t.after(async () => {
    owner.close();
    await door.stop();
    fs.rmSync(requests, { recursive: true, force: true });
    fs.rmSync(status, { recursive: true, force: true });
  });
  const said = (name, value) => fs.writeFileSync(path.join(status, name), JSON.stringify(value));
  const asked = () => fs.readdirSync(requests).sort();
  return { door, owner, requests, status, said, asked, quiet: (ms = 700) => new Promise((r) => setTimeout(r, ms)) };
}
// What root's step says of an account that waits for the version it downloaded.
const waiting = (since = new Date().toISOString()) => ({ state: 'waiting', at: since, since, version: 'def5678', from: 'abc1234' });

test("step one: the download is asked once, in the owner's night hour, and not again tonight", async (t) => {
  // The night hour is the hour it is now in the owner's zone, which is not the machine's.
  const timeZone = 'Asia/Tokyo';
  const m = await oneAccount(t, { hour: hourIn(timeZone), answer: updateAnswers({ quietHours: { start: 22, end: 7, timeZone } }) });
  await waitFor(() => m.asked().includes('UPDATE'), { what: 'the update asked' });
  assert.equal(fs.readFileSync(path.join(m.requests, 'UPDATE'), 'utf8'), '', 'the newest, as the admin page asks');
  assert.match(m.door.log.join(''), /botdot downloads its update at night: abc1234 to def5678/);
  // Root's step takes the request and the update fails: not asked again tonight.
  fs.rmSync(path.join(m.requests, 'UPDATE'));
  m.said('update.json', { state: 'failed', at: new Date().toISOString(), from: 'abc1234', to: 'def5678', error: 'no' });
  await m.quiet();
  assert.deepEqual(m.asked(), []);
});

test('step one: not in another hour of the owner\'s, and never on a machine of several accounts', async (t) => {
  const timeZone = 'UTC';
  const hour = hourIn(timeZone);
  const one = await oneAccount(t, { hour: (hour + 12) % 24, answer: updateAnswers({ quietHours: { start: 22, end: 7, timeZone } }) });
  await one.quiet();
  assert.deepEqual(one.asked(), [], 'another hour');
  // Several accounts: the admin chooses when, as before.
  const requests = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-requests-'));
  const status = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-status-'));
  fs.writeFileSync(path.join(status, 'version.json'), JSON.stringify({ version: 'abc1234' }));
  fs.writeFileSync(path.join(status, 'latest.json'), JSON.stringify({ version: 'def5678', at: '2026-11-10T03:00:00Z' }));
  const door = await startFrontDoor({ env: { FRONT_DOOR_ADMIN: 'owner', FRONT_DOOR_NIGHT_HOUR: String(hour), FRONT_DOOR_REQUESTS: requests, FRONT_DOOR_STATUS: status, FRONT_DOOR_NIGHT_EVERY_MS: '100' } });
  const owner = await standIn(door, 'owner', { answer: updateAnswers({ quietHours: { start: 22, end: 7, timeZone } }) });
  try {
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(fs.existsSync(path.join(requests, 'UPDATE')), false, 'several accounts');
  } finally {
    owner.close();
    await door.stop();
    fs.rmSync(requests, { recursive: true, force: true });
    fs.rmSync(status, { recursive: true, force: true });
  }
});

test('step one: "as soon as it\'s ready" asks for the download as soon as root\'s step found the release, at any hour', async (t) => {
  const m = await oneAccount(t, { when: 'ready', hour: (hourIn('UTC') + 12) % 24 });
  await waitFor(() => m.asked().includes('UPDATE'), { what: 'the update asked, not at night' });
  assert.match(m.door.log.join(''), /botdot downloads its update: abc1234 to def5678/);
});

test('step one: "when I say" downloads at night too, so that the owner has the version to switch to', async (t) => {
  const timeZone = 'Asia/Tokyo';
  const m = await oneAccount(t, { when: 'manual', hour: hourIn(timeZone), answer: updateAnswers({ quietHours: { start: 22, end: 7, timeZone } }) });
  await waitFor(() => m.asked().includes('UPDATE'), { what: 'the update asked' });
  const other = await oneAccount(t, { when: 'manual', hour: (hourIn(timeZone) + 12) % 24, answer: updateAnswers({ quietHours: { start: 22, end: 7, timeZone } }) });
  await other.quiet();
  assert.deepEqual(other.asked(), [], 'only in the night hour');
});

test('step one: never while the account waits for a version already, whatever the owner chose', async (t) => {
  for (const when of ['ready', 'night']) {
    const timeZone = 'UTC';
    const m = await oneAccount(t, { when, hour: hourIn(timeZone), answer: updateAnswers({ idle: () => false, quietHours: { start: 22, end: 7, timeZone } }) });
    m.said('account-owner.json', waiting());
    await m.quiet();
    assert.ok(!m.asked().includes('UPDATE'), `${when}: root's step would switch it, two versions behind`);
    fs.rmSync(path.join(m.status, 'account-owner.json'));
    await waitFor(() => m.asked().includes('UPDATE'), { what: `${when}: the update asked once nothing waits` });
  }
});

test('step two: the account left waiting is switched by the same plan: "as soon as it\'s ready" at the first idle check', async (t) => {
  let idle = false;
  const m = await oneAccount(t, { when: 'ready', newest: null, answer: updateAnswers({ idle: () => idle }) });
  m.said('account-owner.json', waiting());
  await m.quiet(400);
  assert.deepEqual(m.asked(), [], 'busy: it tries again later');
  assert.ok(m.owner.seen.some((r) => r.url === '/api/update/idle' && r.headers['x-botdot-room'] === '1' && r.headers['x-botdot-account'] === 'owner'), 'asked as the front door, as the account\'s server needs');
  idle = true;
  await waitFor(() => m.asked().includes('SWITCH-owner'), { what: 'the switch asked' });
  assert.match(m.door.log.join(''), /the machine is asked to switch the account owner to the new version: idle\n/);
  assert.equal(m.asked().includes('UPDATE'), false);
});

test('step two: "at night" switches in the night, and "when I say" never, on a machine of one account too', async (t) => {
  const quietHours = (timeZone) => ({ start: 22, end: 9, timeZone });
  const night = zoneWhere(5, 7);
  const day = zoneWhere(13, 19);
  const cases = [
    ['night', night, true], ['night', day, false], ['manual', night, false], ['manual', day, false],
  ];
  for (const [when, timeZone, switches] of cases) {
    const m = await oneAccount(t, { when, newest: null, answer: updateAnswers({ quietHours: quietHours(timeZone) }) });
    m.said('account-owner.json', waiting());
    if (switches) await waitFor(() => m.asked().includes('SWITCH-owner'), { what: `${when} in ${timeZone}: switched` });
    else { await m.quiet(); assert.deepEqual(m.asked(), [], `${when} in ${timeZone}`); }
  }
});

test('step two: past its deadline, 7 days there, an account that waits is switched whatever the owner chose', async (t) => {
  const quiet = { start: 22, end: 9, timeZone: zoneWhere(13, 19) };
  const late = (days) => new Date(Date.now() - days * 24 * 3600_000).toISOString();
  // 7 days and a few hours: idle, then switched at the first idle check, at any hour.
  let m = await oneAccount(t, { when: 'manual', newest: null, answer: updateAnswers({ quietHours: quiet }) });
  m.said('account-owner.json', waiting(late(7.1)));
  await waitFor(() => m.asked().includes('SWITCH-owner'), { what: 'switched past the deadline' });
  // Busy: it waits for an idle moment, up to 24 hours after the deadline.
  m = await oneAccount(t, { when: 'manual', newest: null, answer: updateAnswers({ idle: () => false, quietHours: quiet }) });
  m.said('account-owner.json', waiting(late(7.1)));
  await m.quiet();
  assert.deepEqual(m.asked(), [], 'busy within the 24 hours');
  // A day past the deadline it switches anyway.
  m = await oneAccount(t, { when: 'manual', newest: null, answer: updateAnswers({ idle: () => false, quietHours: quiet }) });
  m.said('account-owner.json', waiting(late(8.1)));
  await waitFor(() => m.asked().includes('SWITCH-owner'), { what: 'switched anyway' });
  assert.match(m.door.log.join(''), /to the new version: past the deadline\n/);
  // Within 7 days on this machine: the deadline is the default, there is no admin page to set it.
  m = await oneAccount(t, { when: 'manual', newest: null });
  m.said('account-owner.json', waiting(late(6)));
  await m.quiet();
  assert.deepEqual(m.asked(), []);
});

test('its owner has the setting: the one account of a machine reaches /front-door/update (#1689)', async (t) => {
  const key = SETUP_KEY();
  const m = await oneAccount(t, { newest: null, env: { FRONT_DOOR_SETUP_KEY: key }, answer: updateAnswers({ idle: () => false }) });
  const sheet = m.door.browser();
  const k = passkey.create({ rpId: m.door.rpId, origin: m.door.origin });
  const options = await sheet.post(`/sign-up/${key}/options`, { name: 'owner', login: 'owner' });
  assert.equal(options.status, 200, options.text);
  const made = await sheet.post(`/sign-up/${key}`, { name: 'owner', login: 'owner', credential: k.register(options.data.publicKey) });
  assert.equal(made.status, 201, made.text);
  const b = m.door.browser();
  const o = await b.post('/sign-in/options', {});
  assert.equal((await b.post('/sign-in', { credential: k.signIn(o.data.publicKey) })).status, 200);
  assert.equal((await b.get('/front-door/session')).data.updates, true, 'the front door plans its switches, so the apps draw the Updates card (#1691)');
  const u = await b.get('/front-door/update');
  assert.equal(u.status, 200, u.text);
  assert.equal(u.data.when, 'night', 'the default');
  assert.equal((await b.post('/front-door/update', { when: 'ready' })).data.when, 'ready');
  assert.equal(JSON.parse(fs.readFileSync(path.join(m.door.data, 'front-door.json'), 'utf8')).accounts.owner.autoUpdate, false, 'root\'s step leaves it waiting');
  // With a version waiting, the same answer carries `busy` from the account's idle answer (#1690): the Settings warning and the card's ask read it.
  m.said('account-owner.json', waiting());
  const waits = (await b.get('/front-door/update')).data;
  assert.equal(waits.canUpdate, true);
  assert.equal(waits.busy, true, 'the account said it is not idle, on a machine of one account too');
});

test('a managed machine of one account plans no switch: nothing is pinned, nothing asked, `updates` stays false', async (t) => {
  const m = await oneAccount(t, { when: 'night', env: { FRONT_DOOR_MANAGED: '1' } });
  m.said('account-owner.json', waiting());
  await m.quiet(1000);
  assert.deepEqual(m.asked().filter((f) => f.startsWith('SWITCH-')), [], 'the fleet console is its admin: no one asks for a switch');
  const accounts = JSON.parse(fs.readFileSync(path.join(m.door.data, 'front-door.json'), 'utf8')).accounts;
  assert.equal(accounts.owner.autoUpdate, undefined, 'the account is not pinned: root\'s step switches it as before');
});
