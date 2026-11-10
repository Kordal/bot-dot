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
  assert.deepEqual(installKeys.take(s.dir, s), { openrouter: true, boat: true, composio: false });
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
  assert.deepEqual(installKeys.take(s.dir, s), { openrouter: true, boat: false, composio: false });
  assert.equal(s.boat.forAccounts().key, 'boat_fromtheadminpage');
});

test('a file that is not JSON or holds no key takes nothing, and goes', (t) => {
  const s = stores(t);
  for (const text of ['not json', '{"openrouter":"x\\"y","boat":"short"}']) {
    fs.writeFileSync(s.file, text);
    assert.deepEqual(installKeys.take(s.dir, s), { openrouter: false, boat: false, composio: false });
    assert.ok(!fs.existsSync(s.file));
  }
  assert.equal(s.groupRouter.shown().router, 'haiku');
  assert.equal(s.boat.shown().keySet, false);
});

test('a machine of one account, which has no stores, takes nothing', (t) => {
  const s = stores(t);
  fs.writeFileSync(s.file, JSON.stringify({ openrouter: 'sk-or-v1-goodgoodgood', boat: 'boat_goodgoodgood' }));
  assert.deepEqual(installKeys.take(s.dir, { groupRouter: null, boat: null }), { openrouter: false, boat: false, composio: false });
});

test('the front door takes them when it starts and every minute after', () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'front-door.js'), 'utf8');
  assert.match(code, /takeInstallKeys\(\);\n\s*setInterval\(takeInstallKeys, 60_000\)/);
});

// The Composio key (ADR 206) is the machine's: kept in composio-key.json, which only the front door reads, and handed
// to every account; the admin page sets and removes it too.
test("the Composio key is the machine's: kept, on a machine of one account too, and set or removed from the admin page", (t) => {
  const s = stores(t);
  assert.equal(installKeys.composio(s.dir), null);
  assert.equal(installKeys.composioState(s.dir), null, 'never set: nothing to hand or take back');
  fs.writeFileSync(s.file, JSON.stringify({ openrouter: null, boat: null, composio: 'ak_goodgoodgood' }));
  assert.deepEqual(installKeys.take(s.dir, { groupRouter: null, boat: null }), { openrouter: false, boat: false, composio: true });
  assert.ok(!fs.existsSync(s.file));
  assert.equal(installKeys.composio(s.dir), 'ak_goodgoodgood');
  assert.equal(fs.statSync(path.join(s.dir, 'composio-key.json')).mode & 0o777, 0o600);
  assert.equal(s.groupRouter.shown().router, 'haiku', "Jev's key isn't touched");
  installKeys.setComposio(s.dir, 'ak_fromtheadmin');
  assert.equal(installKeys.composio(s.dir), 'ak_fromtheadmin');
  installKeys.setComposio(s.dir, null);
  assert.equal(installKeys.composio(s.dir), null);
  assert.deepEqual(installKeys.composioState(s.dir), { key: null }, 'removed: the accounts that took it remove theirs');
  fs.writeFileSync(s.file, JSON.stringify({ composio: 'x"y' }));
  assert.equal(installKeys.take(s.dir, s).composio, false);
  assert.equal(installKeys.composio(s.dir), null);
});

test("the front door hands the machine's Composio key to every account, once a key, and again an hour after a refusal", () => {
  const code = fs.readFileSync(path.join(__dirname, '..', 'front-door.js'), 'utf8');
  assert.match(code, /for \(const \{ name \} of doors\.listAccounts\(\)\) \{/);
  assert.match(code, /askAccount\(name, 'POST', '\/api\/connectors\/install-key', \{ key \}, 30_000\)/);
  assert.match(code, /if \(!r\.status \|\| r\.status >= 500\) return;/, 'not running or no answer: next minute');
  assert.match(code, /if \(r\.status === 400 && key\) \{\s*composioAnswered\.set\(name, \{ refused: Date\.now\(\) \}\);/, 'a refused key is handed again later');
  assert.match(code, /if \(mark !== composioMark\) \{ composioAnswered\.clear\(\);/, 'a new key is handed to every account again');
});
