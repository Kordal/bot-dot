// The keys the installer took (install.sh, lib/front-door/install-keys.js): the front door takes them into its stores
// once and removes the file, so that what the admin sets later on the admin page stays.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const installKeys = require('../lib/front-door/install-keys');
const groupRouterStore = require('../lib/front-door/group-router');
const boatStore = require('../lib/front-door/boat');

function stores(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'install-keys-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return { dir, groupRouter: groupRouterStore.open(dir), boat: boatStore.open(dir), file: path.join(dir, 'install-keys.json') };
}

test('both keys are taken: Jev becomes the decision model and boat.dev has its key, and the file goes', (t) => {
  const s = stores(t);
  fs.writeFileSync(s.file, JSON.stringify({ openrouter: 'sk-or-v1-goodgoodgood', boat: 'boat_goodgoodgood' }));
  assert.deepEqual(installKeys.take(s.dir, s), { openrouter: true, boat: true });
  assert.deepEqual(s.groupRouter.shown(), { router: 'jev', keySet: true, wakeGate: false, replaysPerHour: 0 });
  assert.equal(s.groupRouter.forAccounts().key, 'sk-or-v1-goodgoodgood');
  assert.equal(s.boat.forAccounts().key, 'boat_goodgoodgood');
  assert.ok(!fs.existsSync(s.file));
  assert.equal(installKeys.take(s.dir, s), null, 'nothing more to take');
  const again = { ...s, groupRouter: groupRouterStore.open(s.dir), boat: boatStore.open(s.dir) };
  assert.equal(again.groupRouter.shown().router, 'jev', 'kept in group-router.json');
  assert.equal(again.boat.shown().keySet, true, 'kept in boat.json');
});

test('a key left out is not touched, and what the admin set stays', (t) => {
  const s = stores(t);
  s.boat.set('boat_fromtheadminpage');
  fs.writeFileSync(s.file, JSON.stringify({ openrouter: 'sk-or-v1-goodgoodgood', boat: null }));
  assert.deepEqual(installKeys.take(s.dir, s), { openrouter: true, boat: false });
  assert.equal(s.boat.forAccounts().key, 'boat_fromtheadminpage');
});

test('a file that is not JSON or holds no key takes nothing, and goes', (t) => {
  const s = stores(t);
  for (const text of ['not json', '{"openrouter":"x\\"y","boat":"short"}']) {
    fs.writeFileSync(s.file, text);
    assert.deepEqual(installKeys.take(s.dir, s), { openrouter: false, boat: false });
    assert.ok(!fs.existsSync(s.file));
  }
  assert.equal(s.groupRouter.shown().router, 'haiku');
  assert.equal(s.boat.shown().keySet, false);
});

test('a machine of one account, which has no stores, takes nothing', (t) => {
  const s = stores(t);
  fs.writeFileSync(s.file, JSON.stringify({ openrouter: 'sk-or-v1-goodgoodgood', boat: 'boat_goodgoodgood' }));
  assert.deepEqual(installKeys.take(s.dir, { groupRouter: null, boat: null }), { openrouter: false, boat: false });
});

test('the front door takes them when it starts and every minute after', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'front-door.js'), 'utf8');
  assert.match(code, /takeInstallKeys\(\);\n\s*setInterval\(takeInstallKeys, 60_000\)/);
});
