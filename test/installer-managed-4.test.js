// install.sh on a stand-in machine (test/installer-helpers.js): a managed machine (BOT_DOT_MANAGED=1, ADR 154, #983),
// one account or several, on a public or tailnet reach, with no admin page and a guaranteed share per account.
// Part 4 of 5 of the managed machine tests: the parts run side by side, so that none takes more than about three minutes in CI (docs/decisions/2026-11-25-installer-tests-in-parts.md).
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

// dpkg-query on a machine whose Docker is Docker's own packages (get.docker.com), at these versions.
const DOCKER_CE = { 'docker-ce': '5:29.0.1-1~ubuntu.24.04~noble', 'docker-ce-cli': '5:29.0.1-1~ubuntu.24.04~noble', 'docker-ce-rootless-extras': '5:29.0.1-1~ubuntu.24.04~noble',
  'containerd.io': '1.7.28-1~ubuntu.24.04~noble', 'docker-compose-plugin': '2.40.3-1~ubuntu.24.04~noble' };

const dpkg = (versions) => `#!/bin/sh\nfor p; do :; done\ncase "$p" in\n${Object.entries(versions).map(([p, v]) => `  ${p}) echo 'install ok installed ${v}' ;;`).join('\n')}\n  *) exit 1 ;;\nesac\n`;

const ORIGIN_FILE = 'Unattended-Upgrade::Origins-Pattern { "origin=Docker,label=Docker CE"; };\n';

const PINS = `Package: docker-ce
Pin: version 5:29.*
Pin-Priority: 990

Package: docker-ce-cli
Pin: version 5:29.*
Pin-Priority: 990

Package: docker-ce-rootless-extras
Pin: version 5:29.*
Pin-Priority: 990

Package: containerd.io
Pin: version 1.*
Pin-Priority: 990

Package: docker-compose-plugin
Pin: version 2.*
Pin-Priority: 990
`;

test("a managed machine's Docker gets its security updates by itself, each package within its major version, also once an update reaches a machine made before", (t) => {
  const done = installer(t, { dotenv: '', given: MANAGED, bins: { 'dpkg-query': dpkg(DOCKER_CE) } });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  const origin = path.join(done.etc, 'apt', 'apt.conf.d', '51botdot-docker');
  const pins = path.join(done.etc, 'apt', 'preferences.d', 'botdot-docker');
  assert.equal(fs.readFileSync(origin, 'utf8'), ORIGIN_FILE, "Docker's origin, beside its pins");
  assert.equal(fs.readFileSync(pins, 'utf8'), PINS);
  for (const f of [origin, pins]) assert.equal(fs.statSync(f).mode & 0o777, 0o644);
  assert.match(done.said, /Docker's security updates install by themselves, each package within its major version/);

  // A machine installed before: its next update writes both.
  fs.rmSync(origin);
  fs.rmSync(pins);
  accounts(done, 'owner');
  const update = installer(t, { dotenv: dotenvOf(done), again: done, args: ['--update'], bins: { 'dpkg-query': dpkg(DOCKER_CE) } });
  assert.equal(update.status, 0, `${update.said}\n${update.stderr}`);
  assert.equal(fs.readFileSync(origin, 'utf8'), ORIGIN_FILE);
  assert.equal(fs.readFileSync(pins, 'utf8'), PINS);

  // Again: nothing changes, and nothing is said. Docker moved to a new major by hand is kept on that one.
  const before = fs.statSync(pins).mtimeMs;
  const again = installer(t, { dotenv: dotenvOf(done), again: done, args: ['--update'], bins: { 'dpkg-query': dpkg(DOCKER_CE) } });
  assert.equal(again.status, 0, again.stderr);
  assert.equal(fs.statSync(pins).mtimeMs, before, 'not written again');
  assert.doesNotMatch(again.said, /Docker's security updates/);
  const moved = installer(t, { dotenv: dotenvOf(done), again: done, args: ['--update'], bins: { 'dpkg-query': dpkg({ ...DOCKER_CE, 'docker-ce': '5:30.0.0-1~ubuntu.24.04~noble' }) } });
  assert.equal(moved.status, 0, moved.stderr);
  assert.match(fs.readFileSync(pins, 'utf8'), /^Package: docker-ce\nPin: version 5:30\.\*\n/);

  // The uninstaller takes them away with botdot; Docker stays.
  const gone = installer(t, { again: done, dotenv: '', args: ['--uninstall'], input: 'yes\nn\n' });
  assert.equal(gone.status, 0, `${gone.said}\n${gone.stderr}`);
  assert.ok(!fs.existsSync(origin) && !fs.existsSync(pins));
});
