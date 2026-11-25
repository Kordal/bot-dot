// install.sh on a stand-in machine (test/installer-helpers.js): the fleet console pauses the whole machine with
// SUSPEND and starts it again with RESUME, root's alone. Root's step asks the front door to suspend or resume every
// account (`node front-door.js suspend|resume --by console`, its side in test/front-door-console-suspend.test.js), then
// makes each account match the front door's data, and says how it went in status/suspend.json.
// Part 2 of 2 of the suspend and resume tests: the parts run side by side, so that no one file sets the time of a shard (docs/decisions/2026-11-25-installer-tests-in-parts.md).
const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('install.sh uses GNU sed and stat')) return;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { withBob, status } = require('./installer-helpers');

// The stand-in front door: it says what it changed; the test writes the data that change leaves.
const frontDoor = [
  'case "$*" in',
  '  *"front-door.js suspend --by console"*) echo \'{"state":"suspended","accounts":["bob"]}\'; exit 0 ;;',
  '  *"front-door.js resume --by console"*) echo \'{"state":"resumed","accounts":["bob"]}\'; exit 0 ;;',
  'esac',
];

const asked = (done) => done.docker.map((c) => c.call).filter((c) => / front-door\.js (suspend|resume)/.test(c)).map((c) => c.split(' exec -T ')[1]);

test('with SUSPEND and RESUME both there, only the newer is taken', (t) => {
  const { first, door, step } = withBob(t);
  door({ accounts: { ann: {}, bob: {} } });
  const requests = path.join(first.dir, 'front-door', 'requests');
  fs.writeFileSync(path.join(requests, 'SUSPEND'), '');
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(path.join(requests, 'SUSPEND'), old, old);
  const done = step('RESUME', { dockerFirst: frontDoor });
  assert.deepEqual(asked(done), ['front-door node front-door.js resume --by console']);
  assert.equal(status(done, 'suspend.json').state, 'resumed');
});

test('a front door that answers nothing leaves a failed status, and stops nothing', (t) => {
  const { step } = withBob(t);
  const done = step('SUSPEND', { dockerFirst: ['case "$*" in *"front-door.js suspend"*) echo "service \\"front-door\\" is not running" >&2; exit 1 ;; esac'] });
  const said = status(done, 'suspend.json');
  assert.equal(said.state, 'failed');
  assert.equal(said.error, 'The front door changed nothing: service front-door is not running');
  assert.doesNotMatch(done.system, /^systemctl disable --now/m);
});

test('a suspend root didn\'t make is refused', { skip: process.getuid?.() !== 0 && 'chowning needs root' }, (t) => {
  const { first, step } = withBob(t);
  const file = path.join(first.dir, 'front-door', 'requests', 'SUSPEND');
  fs.writeFileSync(file, '');
  fs.chownSync(file, 990, 990);
  const done = step('ann', { dockerFirst: frontDoor });
  assert.equal(asked(done).length, 0, 'the front door was asked for nothing');
  assert.equal(status(done, 'suspend.json').state, 'refused');
  assert.equal(status(done, 'suspend.json').error, 'Only root asks for this.');
});
