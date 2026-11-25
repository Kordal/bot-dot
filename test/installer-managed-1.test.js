// install.sh on a stand-in machine (test/installer-helpers.js): a managed machine (BOT_DOT_MANAGED=1, ADR 154, #983),
// one account or several, on a public or tailnet reach, with no admin page and a guaranteed share per account.
// Part 1 of 5 of the managed machine tests: the parts run side by side, so that none takes more than about three minutes in CI (docs/decisions/2026-11-25-installer-tests-in-parts.md).
const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('install.sh uses GNU sed and stat')) return;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { installer } = require('./installer-helpers');

const PUBLIC = { BOT_DOT_REACH: 'public', BOT_DOT_DOMAIN: 'botdot.example.com' };

const MANAGED = { BOT_DOT_MANAGED: '1', ...PUBLIC };

const dotenvOf = (done) => fs.readFileSync(path.join(done.dir, 'front-door', '.env'), 'utf8');

// The front door's data, as it is once the account `names` exist.
const accounts = (done, ...names) => fs.writeFileSync(path.join(done.dir, 'front-door', 'data', 'front-door.json'),
  JSON.stringify({ accounts: Object.fromEntries(names.map((n) => [n, { created: '2026-11-04T12:00:00.000Z', userId: n }])), passkeys: {}, sessions: {}, signUpLinks: {}, deleted: {} }));

test('a managed machine of one account: no admin, its passkey from the setup key, and a share of 6 CPUs and 9 GB', (t) => {
  const done = installer(t, { dotenv: '', given: MANAGED });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  assert.doesNotMatch(done.said, /How will people reach|account's name|Use Jev|boat\.dev/, 'it asks nothing');
  assert.equal(done.env.BOT_DOT_MANAGED, '1', 'kept');
  assert.equal(done.env.BOT_DOT_VARIANT, 'one', 'one account unless told otherwise');
  assert.equal(done.env.FRONT_DOOR_MANAGED, '1', 'the front door has no admin page');
  assert.equal(done.env.FRONT_DOOR_ONE_ACCOUNT, 'owner');
  assert.equal(done.env.FRONT_DOOR_FIRST_ACCOUNT, '');
  assert.equal(done.env.FRONT_DOOR_ADMIN, 'owner', "the installer's name for its first account");
  assert.equal(done.env.FRONT_DOOR_ORIGIN, 'https://botdot.example.com');
  assert.equal(done.env.COMPOSE_PROFILES, 'public,embed', 'Caddy as on any public install, and the shared embedding server');
  const key = done.env.FRONT_DOOR_SETUP_KEY;
  assert.match(key, /^[0-9a-f]{64}$/);
  assert.ok(!done.calls.some((c) => /sign-up-link/.test(c)), 'no sign-up link is made');
  const ready = JSON.parse(done.said.trim().split('\n').at(-1).replace(/^BOTDOT_READY /, ''));
  assert.equal(ready.signUp, `https://botdot.example.com/sign-up/${key}`, "the setup key's link, for the fleet console");
  assert.equal(ready.variant, 'one');
  assert.equal(ready.reach, 'public');
  assert.deepEqual(ready.accounts, ['owner']);
  assert.equal(done.said.split(key).length, 2, 'the key is on the screen in that line alone');
  assert.doesNotMatch(done.said, /admin page|\/admin/);
  assert.match(done.system, /^systemctl set-property botdot-account@owner\.service CPUQuota=600% MemoryHigh=infinity MemoryMax=9G$/m, 'the managed share');
  assert.equal(done.read('accounts/owner/share/share.json'), '{"cpu":6,"ram":9}\n');
  assert.ok(fs.existsSync(path.join(done.dir, 'bin', 'install.sh')), "root's step as on any server");

  // A rerun keeps it all, and the link goes once the account exists.
  accounts(done, 'owner');
  const again = installer(t, { dotenv: dotenvOf(done), again: done, given: { BOT_DOT_MANAGED: '0', BOT_DOT_REACH: 'tailnet' } });
  assert.equal(again.status, 0, `${again.said}\n${again.stderr}`);
  assert.equal(again.env.BOT_DOT_MANAGED, '1', 'managed is chosen once');
  assert.equal(again.env.BOT_DOT_REACH, 'public');
  assert.equal(again.env.FRONT_DOOR_SETUP_KEY, key);
  assert.doesNotMatch(again.said, /sign-up/);
  assert.match(again.said, /\nBOTDOT_READY \{"origin":"https:\/\/botdot\.example\.com","version":"[^"]*","reach":"public","variant":"one","accounts":\["owner"\]\}\n$/, 'its last line');
});
