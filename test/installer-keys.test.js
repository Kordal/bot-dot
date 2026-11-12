// install.sh on a stand-in machine (test/installer-helpers.js): the fleet console's keys for a managed machine (ADR 162),
// KEYS, root's alone. Root's step hands them to the front door in data/install-keys.json, as the installer's keys are
// handed, says which it handed in status/keys.json, and writes no key in a log or a status file. The front door's side
// is in test/front-door-install-keys.test.js and test/front-door-managed.test.js.
const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('install.sh uses GNU sed and stat')) return;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { withBob, status, installer } = require('./installer-helpers');

const OPENROUTER = 'sk-or-v1-fromtheconsole01';
const COMPOSIO = 'ak_fromtheconsole01';

function keysStep(t, m, text) {
  const requests = path.join(m.first.dir, 'front-door', 'requests');
  fs.writeFileSync(path.join(requests, 'KEYS'), text, { mode: 0o600 });
  const done = installer(t, { again: m.first, dotenv: '', script: path.join(m.first.dir, 'bin', 'install.sh'), args: ['--requested'] });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  assert.deepEqual(fs.readdirSync(requests), [], 'the request is taken');
  return done;
}

test('KEYS: the keys reach the front door in install-keys.json (600), the status says which, and no log holds them', (t) => {
  const m = withBob(t);
  const done = keysStep(t, m, `openrouter ${OPENROUTER}\ncomposio ${COMPOSIO}\n`);
  const file = path.join(m.first.dir, 'front-door', 'data', 'install-keys.json');
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { openrouter: OPENROUTER, boat: null, composio: COMPOSIO });
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  const said = status(done, 'keys.json');
  assert.deepEqual([said.state, said.openrouter, said.composio], ['handed', true, true]);
  const all = `${done.said}${done.stderr}${JSON.stringify(said)}`;
  assert.ok(!all.includes(OPENROUTER) && !all.includes(COMPOSIO), 'no key in a log or the status');
});

test('KEYS with one key hands that one; a line that is no key is not handed, and none at all is refused', (t) => {
  const m = withBob(t);
  const file = path.join(m.first.dir, 'front-door', 'data', 'install-keys.json');
  const one = keysStep(t, m, `composio ${COMPOSIO}\nopenrouter has spaces in it\n`);
  assert.deepEqual(JSON.parse(fs.readFileSync(file, 'utf8')), { openrouter: null, boat: null, composio: COMPOSIO });
  assert.deepEqual([status(one, 'keys.json').openrouter, status(one, 'keys.json').composio], [false, true]);
  fs.rmSync(file);
  const none = keysStep(t, m, 'openrouter "x"\n');
  assert.equal(status(none, 'keys.json').state, 'refused');
  assert.equal(status(none, 'keys.json').error, 'The request named no key.');
  assert.ok(!fs.existsSync(file));
});

test("a KEYS request root didn't make is refused", { skip: process.getuid?.() !== 0 && 'chowning needs root' }, (t) => {
  const m = withBob(t);
  const requests = path.join(m.first.dir, 'front-door', 'requests');
  fs.writeFileSync(path.join(requests, 'KEYS'), `composio ${COMPOSIO}\n`);
  fs.chownSync(path.join(requests, 'KEYS'), 990, 990);
  const done = m.step('bob');
  assert.equal(status(done, 'keys.json').error, 'Only root asks for this.');
  assert.ok(!fs.existsSync(path.join(m.first.dir, 'front-door', 'data', 'install-keys.json')));
});
