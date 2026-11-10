// A machine of one account updates itself at night (ADR 183): the front door asks root's step for the update, as the
// admin page's Update does, at 04:00 in the owner's time zone, for a newer signed release root's step found, once a night.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { waitFor } = require('./helpers');
const { startFrontDoor, standIn } = require('./front-door-helpers');
const { shouldUpdate, AGAIN_MS } = require('../lib/front-door/night-update');

test('the rule: only at night, only for a newer signed release, once a night', () => {
  const now = Date.parse('2026-11-10T04:10:00Z');
  const base = { installed: { version: 'abc1234' }, newest: { version: 'def5678' }, last: null, asked: false, hour: 4, now };
  assert.equal(shouldUpdate(base), true);
  assert.equal(shouldUpdate({ ...base, hour: 3 }), false, 'not before');
  assert.equal(shouldUpdate({ ...base, hour: 5 }), false, 'nor after');
  assert.equal(shouldUpdate({ ...base, newest: { version: 'abc1234' } }), false, 'it runs the newest');
  assert.equal(shouldUpdate({ ...base, newest: null }), false, 'no release found');
  assert.equal(shouldUpdate({ ...base, installed: { version: 'abc1234', selfBuilt: true } }), false, 'images built on the machine');
  assert.equal(shouldUpdate({ ...base, asked: true }), false, 'one is asked or going');
  assert.equal(shouldUpdate({ ...base, last: { version: 'def5678', at: new Date(now - 30 * 60_000).toISOString() } }), false, 'asked tonight');
  assert.equal(shouldUpdate({ ...base, last: { version: 'def5678', at: new Date(now - AGAIN_MS).toISOString() } }), true, 'a failed one, the next night');
});

test("a front door of one account asks for the update by itself, once, in the owner's night hour", async () => {
  const requests = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-requests-'));
  const status = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-status-'));
  fs.writeFileSync(path.join(status, 'version.json'), JSON.stringify({ version: 'abc1234' }));
  fs.writeFileSync(path.join(status, 'latest.json'), JSON.stringify({ version: 'def5678', at: '2026-11-10T03:00:00Z' }));
  // The night hour is the hour it is now in the owner's zone, which is not the machine's.
  const timeZone = 'Asia/Tokyo';
  const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
  const door = await startFrontDoor({ env: { FRONT_DOOR_ONE_ACCOUNT: 'owner', FRONT_DOOR_SETUP_KEY: crypto.randomBytes(32).toString('base64url'), FRONT_DOOR_REQUESTS: requests, FRONT_DOOR_STATUS: status, FRONT_DOOR_NIGHT_HOUR: String(hour), FRONT_DOOR_NIGHT_EVERY_MS: '100' } });
  const owner = await standIn(door, 'owner', { answer: (req) => (req.url === '/api/settings' ? [200, { settings: { quietHours: { start: 22, end: 7, timeZone } } }] : null) });
  const asked = path.join(requests, 'UPDATE');
  try {
    await waitFor(() => fs.existsSync(asked), { what: 'the update asked' });
    assert.equal(fs.readFileSync(asked, 'utf8'), '', 'the newest, as the admin page asks');
    // Root's step takes the request and the update fails: not asked again tonight.
    fs.rmSync(asked);
    fs.writeFileSync(path.join(status, 'update.json'), JSON.stringify({ state: 'failed', at: new Date().toISOString(), from: 'abc1234', to: 'def5678', error: 'no' }));
    await new Promise((r) => setTimeout(r, 800));
    assert.equal(fs.existsSync(asked), false);
  } finally {
    owner.close();
    await door.stop();
    fs.rmSync(requests, { recursive: true, force: true });
    fs.rmSync(status, { recursive: true, force: true });
  }
});

test('not in another hour of the owner, and never on a machine of several accounts', async () => {
  for (const one of [true, false]) {
    const requests = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-requests-'));
    const status = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-status-'));
    fs.writeFileSync(path.join(status, 'version.json'), JSON.stringify({ version: 'abc1234' }));
    fs.writeFileSync(path.join(status, 'latest.json'), JSON.stringify({ version: 'def5678', at: '2026-11-10T03:00:00Z' }));
    const timeZone = 'UTC';
    const hour = Number(new Intl.DateTimeFormat('en-GB', { timeZone, hour: 'numeric', hourCycle: 'h23' }).format(new Date()));
    const env = one
      ? { FRONT_DOOR_ONE_ACCOUNT: 'owner', FRONT_DOOR_SETUP_KEY: crypto.randomBytes(32).toString('base64url'), FRONT_DOOR_NIGHT_HOUR: String((hour + 12) % 24) }
      : { FRONT_DOOR_ADMIN: 'owner', FRONT_DOOR_NIGHT_HOUR: String(hour) };
    const door = await startFrontDoor({ env: { ...env, FRONT_DOOR_REQUESTS: requests, FRONT_DOOR_STATUS: status, FRONT_DOOR_NIGHT_EVERY_MS: '100' } });
    const owner = await standIn(door, 'owner', { answer: (req) => (req.url === '/api/settings' ? [200, { settings: { quietHours: { start: 22, end: 7, timeZone } } }] : null) });
    try {
      await new Promise((r) => setTimeout(r, 800));
      assert.equal(fs.existsSync(path.join(requests, 'UPDATE')), false, one ? 'another hour' : 'several accounts');
    } finally {
      owner.close();
      await door.stop();
      fs.rmSync(requests, { recursive: true, force: true });
      fs.rmSync(status, { recursive: true, force: true });
    }
  }
});
