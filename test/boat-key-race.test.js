// A check of the account's own boat.dev key (#1617, ADR 263) that finishes after the key was removed or replaced says
// nothing about the key the account has now: it must not put the old key back into use.
process.env.BOT_DOT_VAULT_KEY = 'ab'.repeat(32);
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const boatKeyLib = require('../lib/boat-key');

function setup() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-key-race-'));
  const keys = [];
  const boat = { setOwnKey: (k) => keys.push(k), isOwnRefused: () => false, checkKey: async () => 'ok' };
  let release = null;
  let slow = false; // the next check waits until `finish`
  let now = 0;
  const checkKey = () => (slow ? new Promise((r) => { slow = false; release = () => r('ok'); }) : Promise.resolve('ok'));
  const key = boatKeyLib.create(dir, { boat, checkKey, now: () => now });
  return { dir, keys, key, finish: () => release(), slowly: () => { slow = true; }, tick: (ms) => { now += ms; } };
}

test('a check that finishes after the key was removed does not put the key back into use', async () => {
  const s = setup();
  await s.key.set('boat_slowkey1234567890');
  s.tick(11 * 60_000);
  s.keys.length = 0;
  s.slowly();
  const checking = s.key.refresh(); // boat.dev is asked about it…
  s.key.remove(); // …and the owner removes it meanwhile
  s.finish();
  assert.deepEqual(await checking, { set: false });
  assert.deepEqual(s.keys, [null], 'only the removal reached lib/boat.js: the old key is not set again');
  assert.equal(fs.existsSync(path.join(s.dir, 'boat-key.json')), false, 'and nothing was written back');
});

test('a check that finishes after the key was replaced leaves the new key as it is', async () => {
  const s = setup();
  await s.key.set('boat_slowkey1234567890');
  s.tick(11 * 60_000);
  s.keys.length = 0;
  s.slowly();
  const checking = s.key.refresh();
  await s.key.set('boat_newkey1234567890');
  s.finish();
  await checking;
  assert.deepEqual(s.keys, ['boat_newkey1234567890'], 'the old key is never set again');
  assert.equal(s.key.isSame('boat_newkey1234567890'), true);
});

test('a check of the key that is still there is kept, as before', async () => {
  const s = setup();
  await s.key.set('boat_goodkey1234567890');
  s.tick(11 * 60_000);
  assert.equal((await s.key.refresh()).check, 'ok');
});
