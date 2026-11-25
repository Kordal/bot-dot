// install.sh on a stand-in machine (test/installer-helpers.js): a managed machine (BOT_DOT_MANAGED=1, ADR 154, #983),
// one account or several, on a public or tailnet reach, with no admin page and a guaranteed share per account.
// Part 5 of 5 of the managed machine tests: the parts run side by side, so that none takes more than about three minutes in CI (docs/decisions/2026-11-25-installer-tests-in-parts.md).
const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('install.sh uses GNU sed and stat')) return;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { installer } = require('./installer-helpers');

const PUBLIC = { BOT_DOT_REACH: 'public', BOT_DOT_DOMAIN: 'botdot.example.com' };

const MANAGED = { BOT_DOT_MANAGED: '1', ...PUBLIC };

const dotenvOf = (done) => fs.readFileSync(path.join(done.dir, 'front-door', '.env'), 'utf8');

// dpkg-query on a machine whose Docker is Docker's own packages (get.docker.com), at these versions.
const DOCKER_CE = { 'docker-ce': '5:29.0.1-1~ubuntu.24.04~noble', 'docker-ce-cli': '5:29.0.1-1~ubuntu.24.04~noble', 'docker-ce-rootless-extras': '5:29.0.1-1~ubuntu.24.04~noble',
  'containerd.io': '1.7.28-1~ubuntu.24.04~noble', 'docker-compose-plugin': '2.40.3-1~ubuntu.24.04~noble' };

const dpkg = (versions) => `#!/bin/sh\nfor p; do :; done\ncase "$p" in\n${Object.entries(versions).map(([p, v]) => `  ${p}) echo 'install ok installed ${v}' ;;`).join('\n')}\n  *) exit 1 ;;\nesac\n`;

test("a machine that isn't managed, or whose Docker isn't Docker's own packages, keeps its own update policy", (t) => {
  const server = installer(t, { dotenv: '', given: { ...PUBLIC, BOT_DOT_ADMIN: 'ann' }, bins: { 'dpkg-query': dpkg(DOCKER_CE) } });
  assert.equal(server.status, 0, server.stderr);
  const ubuntu = installer(t, { dotenv: '', given: MANAGED, bins: { 'dpkg-query': dpkg({ 'docker.io': '27.5.1-0ubuntu3' }) } });
  assert.equal(ubuntu.status, 0, ubuntu.stderr);
  // Nor does a run that is refused: a machine that isn't managed asked to be, or a managed one on this computer only.
  const late = installer(t, { dotenv: dotenvOf(server), again: server, given: { BOT_DOT_MANAGED: '1' }, bins: { 'dpkg-query': dpkg(DOCKER_CE) } });
  assert.equal(late.status, 1);
  assert.match(late.stderr, /This machine isn't managed, and that is chosen at its first install, so nothing was changed\./);
  const local = installer(t, { dotenv: '', given: { BOT_DOT_MANAGED: '1', BOT_DOT_REACH: 'local' }, bins: { 'dpkg-query': dpkg(DOCKER_CE) } });
  assert.equal(local.status, 1);
  assert.match(local.stderr, /not on this computer only/);
  for (const done of [server, ubuntu, late, local]) {
    assert.ok(!fs.existsSync(path.join(done.etc, 'apt', 'apt.conf.d', '51botdot-docker')));
    assert.ok(!fs.existsSync(path.join(done.etc, 'apt', 'preferences.d', 'botdot-docker')));
  }
});
