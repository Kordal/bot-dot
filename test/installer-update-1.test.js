// install.sh on a stand-in machine (test/installer-helpers.js): the admin page's update, and whether a newer version
// exists.
// Part 1 of 4 of the update tests: the parts run side by side, so that no one file sets the time of a shard (docs/decisions/2026-11-25-installer-tests-in-parts.md).
const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('install.sh uses GNU sed and stat')) return;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { checked, ROOT, PIN, SIGNED, installer, rerun } = require('./installer-helpers');

// --- The admin page's update (#473): root's step updates the front door and every account together -------------

test("root's step has the installer and the release check it needs, and says the version installed", (t) => {
  const done = rerun(t);
  const lib = path.join(done.dir, 'bin', 'lib');
  for (const f of ['signed-image.js', 'registry.js', 'release-manifest.js', 'release-trust.js']) {
    assert.equal(fs.readFileSync(path.join(lib, f), 'utf8'), fs.readFileSync(path.join(ROOT, 'lib', f), 'utf8'), f);
  }
  const status = path.join(done.dir, 'front-door', 'status');
  assert.equal(fs.statSync(status).mode & 0o777, 0o755, 'the front door reads it, and only root writes it');
  const version = JSON.parse(fs.readFileSync(path.join(status, 'version.json'), 'utf8'));
  assert.equal(typeof version.selfBuilt, 'boolean');
  assert.ok(!Number.isNaN(Date.parse(version.at)));
  const compose = fs.readFileSync(path.join(ROOT, 'compose.front-door.yaml'), 'utf8');
  assert.match(compose, /^ {6}- \.\/status:\/status:ro\s/m);
  assert.match(compose, /^ {6}FRONT_DOOR_STATUS: \/status$/m);
});

test("the admin page's update takes the newest signed release of the repositories the install pinned", (t) => {
  const repo = 'registry.example:5000/team';
  const { env, checks } = rerun(t, `BOT_DOT_IMAGE=${repo}/bot-dot${PIN}\nBOT_DOT_COMPUTER_IMAGE=${repo}/bot-dot-desktop${PIN}\n`, {}, { args: ['--update'] });
  assert.deepEqual(checks.map((args) => checked(args).slice(0, 2)), [[`${repo}/bot-dot:latest`, 'server'], [`${repo}/bot-dot-desktop:latest`, 'desktop']]);
  assert.equal(env.BOT_DOT_IMAGE, `${repo}/bot-dot${SIGNED}`);
  // A person's rerun without names goes to botdot's own images, as before.
  const again = rerun(t, `BOT_DOT_IMAGE=${repo}/bot-dot${PIN}\n`);
  assert.equal(checked(again.checks[0])[0], 'ghcr.io/ladrok/bot-dot:latest');
});

test('an update asks nothing: what needs an answer stops it, and says to run the installer', (t) => {
  const none = installer(t, { dotenv: '', args: ['--update'], input: '1\nbotdot.example.com\nann\n' });
  assert.equal(none.status, 1);
  assert.match(none.stderr, /botdot isn't installed here/);
  assert.doesNotMatch(none.said, /How will people reach botdot/);
  const unanswered = installer(t, { dotenv: 'TZ=UTC\nBOT_DOT_REACH=public\n', args: ['--update'], input: 'botdot.example.com\nann\n' });
  assert.equal(unanswered.status, 1);
  assert.match(unanswered.stderr, /doesn't say how people reach botdot or the admin's name, so the update stopped\. Run the installer yourself: sudo sh install\.sh/);
  assert.doesNotMatch(unanswered.said, /The domain botdot answers on/);
  assert.ok(!unanswered.calls.some((c) => /^compose .* up/.test(c)), 'nothing was started');
});

test("an update runs none of the install's interactive steps: Docker, gVisor, Caddy, Tailscale, the admin's link (#195)", (t) => {
  const first = installer(t, { dotenv: '', input: '2\nann\n' });
  assert.equal(first.status, 0, `${first.said}\n${first.stderr}`);
  const seen = first.system.length;
  const done = installer(t, { again: first, dotenv: '', args: ['--update'] });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  const system = done.system.slice(seen);
  assert.deepEqual(system.split('\n').filter((l) => /^tailscale /.test(l)), ['tailscale serve status', 'tailscale serve --bg --https=8443 4701'],
    "Tailscale is neither asked nor served again, but for the sandbox's address an install before #399 lacks");
  assert.doesNotMatch(system, /^apt-get /m);
  assert.doesNotMatch(system, /^curl .*(get\.docker\.com|tailscale\.com|gvisor\.dev)/m);
  assert.doesNotMatch(done.said, /sign-up|Done\. botdot is at|Reachable on your tailnet/);
  assert.match(done.said, /The front door is running/, 'the front door runs the new version');
});

test('an update of a local install keeps it on localhost with its one account, and prints no line for the app (#882)', (t) => {
  const first = installer(t, { dotenv: '', given: { BOT_DOT_REACH: 'local', BOT_DOT_PORT: '5200' } });
  assert.equal(first.status, 0, `${first.said}\n${first.stderr}`);
  const before = first.env;
  const seen = first.system.length;
  const done = installer(t, { again: first, dotenv: '', args: ['--update'] });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  for (const k of ['BOT_DOT_REACH', 'FRONT_DOOR_ORIGIN', 'FRONT_DOOR_PORT', 'FRONT_DOOR_SITES_ORIGIN', 'FRONT_DOOR_SITES_PORT', 'FRONT_DOOR_ONE_ACCOUNT', 'FRONT_DOOR_SETUP_KEY']) assert.equal(done.env[k], before[k], k);
  assert.match(done.system.slice(seen), /^curl -fsS -o \/dev\/null -H Host: localhost:5200 http:\/\/127\.0\.0\.1:5200\/api\/version$/m);
  assert.doesNotMatch(done.system.slice(seen), /^tailscale /m);
  assert.doesNotMatch(done.said, /BOTDOT_LOCAL|sign-up/);
  assert.match(done.said, /The front door is running/);

  const broken = installer(t, { dotenv: 'TZ=UTC\nBOT_DOT_REACH=local\nFRONT_DOOR_ORIGIN=http://localhost:5200\nFRONT_DOOR_ADMIN=owner\n', args: ['--update'] });
  assert.equal(broken.status, 1, 'an origin without the port it names stops the update');
  assert.match(broken.stderr, /doesn't say how people reach botdot/);
});
