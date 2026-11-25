// install.sh on a stand-in machine (test/installer-helpers.js): a first install, botdot's signed images, and what
// the installer tells a stranger. The other installer tests are in installer-*.test.js, so that they run side by side.
// Part 5 of 6 of the install tests: the parts run side by side, so that no one file sets the time of a shard (docs/decisions/2026-11-25-installer-tests-in-parts.md).
const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('install.sh uses GNU sed and stat')) return;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { SIGNED, installer, rerun, KEPT_LAYER, roomAnswers, withBob } = require('./installer-helpers');

test('what the room made first is said: how many images went and how much space came back', (t) => {
  const first = rerun(t);
  const answer = (json) => `case "$*" in *image-cleanup.js*) echo '${json}'; exit 0 ;; esac`;
  const freed = installer(t, { again: first, dotenv: '', args: ['--update'], dockerFirst: [answer('{"removed":3,"skipped":0,"failed":0,"bytes":7400000000}')] });
  assert.equal(freed.status, 0, freed.stderr);
  assert.match(freed.said, /Made room first: removed 3 old images \(7\.4 GB freed\)/);
  const none = installer(t, { again: first, dotenv: '', args: ['--update'], dockerFirst: [answer('{"removed":0,"skipped":1,"failed":0,"bytes":0}')] });
  assert.equal(none.status, 0, none.stderr);
  assert.doesNotMatch(none.said, /Made room first|Couldn't remove the old images first/);
});

test("a download that fails says Docker's own reason, as far as the admin page (#190)", (t) => {
  const server = `ghcr.io/ladrok/bot-dot${SIGNED}`;
  const done = rerun(t, '', {}, { failPull: server, refuse: true });
  assert.match(done.stderr, new RegExp(`Couldn't download ${server.replace(/[.]/g, '\\.')}: failed to register layer: write \\S+: no space left on device\\.`));
  // The same through root's step, for the admin page.
  const { first } = withBob(t);
  fs.writeFileSync(path.join(first.dir, 'front-door', 'requests', 'UPDATE'), '');
  const step = installer(t, { again: first, dotenv: '', script: path.join(first.dir, 'bin', 'install.sh'), args: ['--requested'], failPull: server });
  assert.equal(step.status, 0, `${step.said}\n${step.stderr}`);
  const update = JSON.parse(fs.readFileSync(path.join(first.dir, 'front-door', 'status', 'update.json'), 'utf8'));
  assert.equal(update.state, 'failed');
  assert.match(update.error, /no space left on device\.$/);
});

test("an update pins the bots' computer's new image but doesn't download it into an account whose computer is kept (#191)", (t) => {
  const first = rerun(t);
  const has = `[ -n "\${DOCKER_HOST:-}" ] && [ "$1" = ps ] && [ "$4" = label=botdot.computer=account ] && { echo 4f1c2a; exit 0; }`;
  const done = installer(t, { again: first, dotenv: '', args: ['--update'], dockerFirst: [has] });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  const own = done.accountCalls('ann').slice(first.accountCalls('ann').length);
  assert.ok(own.includes(`pull ghcr.io/ladrok/bot-dot${SIGNED}`), 'the server is downloaded');
  assert.ok(!own.some((c) => c.startsWith('pull ghcr.io/ladrok/bot-dot-desktop')), own.join('\n'));
  assert.equal(done.accountEnv('ann').BOT_DOT_COMPUTER_IMAGE, `ghcr.io/ladrok/bot-dot-desktop${SIGNED}`, 'and pinned for its next update or reset');
  assert.match(done.said, /The bots' computer keeps its image; its Update or reset takes the newest/);
});

test('an update stops before any download when an account\'s disk is short of room, and the admin page says it (#192)', (t) => {
  const { first } = withBob(t);
  const before = fs.readFileSync(path.join(first.top, 'docker.log'), 'utf8').split('\n').filter(Boolean).length;
  fs.writeFileSync(path.join(first.dir, 'front-door', 'requests', 'UPDATE'), '');
  // 1 GB free; the update needs 2 GB downloaded and unpacked (6 GB) and 1 GB to go on working.
  const step = installer(t, { again: first, dotenv: '', script: path.join(first.dir, 'bin', 'install.sh'), args: ['--requested'], dockerFirst: roomAnswers(), given: { STAND_IN_DISK_FREE: '1048576' } });
  assert.equal(step.status, 0, `${step.said}\n${step.stderr}`);
  const update = JSON.parse(fs.readFileSync(path.join(first.dir, 'front-door', 'status', 'update.json'), 'utf8'));
  assert.equal(update.state, 'failed');
  assert.equal(update.error, 'The account ann needs 7.0 GB free for this update and has 1.1 GB. Give it a bigger disk share, or update or reset its computer so the old computer image can go, then update again. No account was changed.');
  assert.equal(update.phase, 'preflight', 'the admin page names the phase it stopped in (#195)');
  assert.equal(update.account, 'ann');
  const since = step.docker.slice(before);
  assert.ok(since.some((c) => /lib\/image-layers\.js ghcr\.io\/ladrok\/bot-dot@/.test(c.call)), 'the registry is asked for the signed image\'s layers');
  assert.ok(since.some((c) => c.call.includes(`-v ${first.run}/ann/docker.sock:/var/run/docker.sock`) && c.call.includes('image-cleanup.js')), 'after the account\'s unused images went');
  assert.deepEqual(since.filter((c) => /^pull /.test(c.call)).map((c) => c.call), [], 'nothing is downloaded');
  assert.deepEqual(since.filter((c) => /^compose .* up/.test(c.call)).map((c) => c.call), [], 'nothing is restarted');
});

test('an update with room in every account goes on, and so does one whose registry gives no sizes (#192)', (t) => {
  const first = rerun(t);
  // Downloaded into the machine's Docker and the account's.
  const downloads = (done) => [...new Set(done.docker.slice(first.docker.length).filter((c) => /^pull ghcr\.io\/ladrok\/bot-dot@/.test(c.call)).map((c) => c.host))].length;
  const roomy = installer(t, { again: first, dotenv: '', args: ['--update'], dockerFirst: roomAnswers() });
  assert.equal(roomy.status, 0, `${roomy.said}\n${roomy.stderr}`);
  assert.equal(downloads(roomy), 2);
  // Short of room, but nothing to download: the account has every layer. The snapshot of its data isn't counted: one
  // without room is skipped at its switch.
  const has = installer(t, { again: first, dotenv: '', args: ['--update'], dockerFirst: roomAnswers(`${KEPT_LAYER} 500000000\\n`), given: { STAND_IN_DISK_FREE: '64' } });
  assert.equal(has.status, 0, `${has.said}\n${has.stderr}`);
  // An older registry's answer: no layers, no check.
  const unknown = installer(t, { again: first, dotenv: '', args: ['--update'], given: { STAND_IN_DISK_FREE: '1' } });
  assert.equal(unknown.status, 0, `${unknown.said}\n${unknown.stderr}`);
  assert.match(unknown.said, /Couldn't tell how much room the update needs in each account; it goes on without that check\./);
  assert.equal(downloads(unknown), 2);
});
