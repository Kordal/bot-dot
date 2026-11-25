// install.sh on a stand-in machine (test/installer-helpers.js): the fleet console pauses the whole machine with
// SUSPEND and starts it again with RESUME, root's alone. Root's step asks the front door to suspend or resume every
// account (`node front-door.js suspend|resume --by console`, its side in test/front-door-console-suspend.test.js), then
// makes each account match the front door's data, and says how it went in status/suspend.json.
// Part 1 of 2 of the suspend and resume tests: the parts run side by side, so that no one file sets the time of a shard (docs/decisions/2026-11-25-installer-tests-in-parts.md).
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

test('SUSPEND: the front door suspends every account, and each is stopped with its data kept', (t) => {
  const { door, step, home, upIn } = withBob(t);
  fs.writeFileSync(path.join(home, 'data', 'bots.json'), '[]');
  door({ accounts: { ann: {}, bob: { suspended: '2026-11-11T12:00:00.000Z' } } });
  const done = step('SUSPEND', { dockerFirst: frontDoor });
  assert.deepEqual(asked(done), ['front-door node front-door.js suspend --by console']);
  assert.match(done.system, /^systemctl disable --now botdot-account@bob$/m);
  assert.ok(!upIn(done, 'bob'), 'nothing of it is started');
  assert.ok(fs.existsSync(path.join(home, 'data', 'bots.json')), 'its data stays');
  const said = status(done, 'suspend.json');
  assert.equal(said.state, 'suspended');
  assert.match(said.at, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/);
  assert.match(done.said, /Every account of this machine is suspended/);
});

test('RESUME: every account starts again as it was', (t) => {
  const { door, step, started } = withBob(t);
  door({ accounts: { ann: {}, bob: { suspended: '2026-11-11T12:00:00.000Z' } } });
  step('SUSPEND', { dockerFirst: frontDoor });
  fs.rmSync(started, { force: true }); // stopped: its Docker doesn't answer
  door({ accounts: { ann: {}, bob: {} } });
  const done = step('RESUME', { dockerFirst: frontDoor });
  assert.deepEqual(asked(done), ['front-door node front-door.js resume --by console']);
  assert.match(done.said, /Starting the account \w+ again, which the admin resumed/);
  assert.match(done.said, /Every account of this machine is running again/);
  assert.equal(status(done, 'suspend.json').state, 'resumed');
});
