// install.sh on a stand-in machine (test/installer-helpers.js): the admin page's update, and whether a newer version
// exists.
// Part 2 of 3 of the update tests: the parts run side by side, so that none takes more than about three minutes in CI (docs/decisions/2026-11-25-installer-tests-in-parts.md).
const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('install.sh uses GNU sed and stat')) return;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { installer, roomAnswers, withBob } = require('./installer-helpers');

// An update through root's step, as the admin page asks for it, whose account Docker of bob answers with `bobFirst`
// first: what the run said, update.json and bob's home.
function updateWithBob(t, bobFirst) {
  const { first, home } = withBob(t);
  const sock = `${first.run}/bob/docker.sock`;
  fs.appendFileSync(path.join(home, 'compose.yaml'), '# the version before\n');
  fs.writeFileSync(path.join(first.dir, 'front-door', 'requests', 'UPDATE'), '');
  const before = fs.readFileSync(path.join(first.top, 'docker.log'), 'utf8').split('\n').filter(Boolean).length;
  const done = installer(t, { again: first, dotenv: '', script: path.join(first.dir, 'bin', 'install.sh'), args: ['--requested'], dockerFirst: [`if [ "\${DOCKER_HOST:-}" = "unix://${sock}" ]; then ${bobFirst}; fi`] });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  const update = JSON.parse(fs.readFileSync(path.join(first.dir, 'front-door', 'status', 'update.json'), 'utf8'));
  const calls = (name) => done.docker.slice(before).filter((c) => c.host === `unix://${first.run}/${name}/docker.sock`).map((c) => c.call);
  return { home, update, calls, log: fs.readFileSync(path.join(first.dir, 'update.log'), 'utf8') };
}

test("the admin's update runs in phases of its own: the front door moves last, and what it replaced goes after it (#195)", (t) => {
  const { first } = withBob(t);
  fs.writeFileSync(path.join(first.dir, 'front-door', 'requests', 'UPDATE'), '');
  const done = installer(t, { again: first, dotenv: '', script: path.join(first.dir, 'bin', 'install.sh'), args: ['--requested'], dockerFirst: roomAnswers() });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  const log = fs.readFileSync(path.join(first.dir, 'update.log'), 'utf8');
  const phases = [...log.matchAll(/^== (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(phases, ['check', 'clean', 'clean (ann)', 'preflight (ann)', 'clean (bob)', 'preflight (bob)', 'download', 'preflight',
    'download (ann)', 'download (bob)', 'switch (ann)', 'switch (bob)', 'front-door', 'clean (ann)', 'clean (bob)', 'clean', 'done'], log);
  const update = JSON.parse(fs.readFileSync(path.join(first.dir, 'front-door', 'status', 'update.json'), 'utf8'));
  assert.equal(update.state, 'updated');
  assert.equal(update.log, undefined, 'the log goes to the admin page only when the update stopped');
});

test('each phase is in update.json as it starts, and an update that stops names its phase and the last lines of its log (#195)', (t) => {
  const { first } = withBob(t);
  const status = path.join(first.dir, 'front-door', 'status');
  // The stand-in docker writes down what update.json said at each download, and bob's account's download fails.
  const seen = path.join(first.top, 'phases');
  const dockerFirst = [
    `[ "$1" = pull ] && { cat "${status}/update.json" >> "${seen}" 2>/dev/null; true; }`,
    '[ "$1" = pull ] && case "${DOCKER_HOST:-}" in *bob*) echo \'failed to register layer: write /var/lib/docker/overlay2/l/x: no space left on device\' >&2; exit 1 ;; esac',
  ];
  const before = fs.readFileSync(path.join(first.top, 'docker.log'), 'utf8').split('\n').filter(Boolean).length;
  fs.writeFileSync(path.join(first.dir, 'front-door', 'requests', 'UPDATE'), '');
  const done = installer(t, { again: first, dotenv: '', script: path.join(first.dir, 'bin', 'install.sh'), args: ['--requested'], dockerFirst });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  const during = fs.readFileSync(seen, 'utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line));
  assert.ok(during.some((u) => u.state === 'updating' && u.phase === 'download' && u.account === 'ann'), JSON.stringify(during));
  assert.ok(during.every((u) => u.state === 'updating' && !Number.isNaN(Date.parse(u.at))));
  const update = JSON.parse(fs.readFileSync(path.join(status, 'update.json'), 'utf8'));
  // bob is kept on the version it ran (#194), and the update ends failed once the rest is done.
  assert.equal(update.state, 'failed');
  assert.equal(update.phase, 'done');
  assert.match(update.error, /Not every account was updated: bob/);
  assert.match(update.accounts.find((a) => a.name === 'bob').error, /no space left on device/);
  assert.ok(Array.isArray(update.log) && update.log.length > 0 && update.log.length <= 40);
  assert.ok(update.log.every((line) => typeof line === 'string' && /^[\x20-\x7e]*$/.test(line) && line.length <= 300), 'plain lines, no colours');
  assert.match(update.log.at(-1), /^x Not every account was updated: bob/);
  assert.ok(update.log.includes('== download (bob)'));
  assert.ok(!done.docker.slice(before).some((c) => c.host.includes('/bob/') && /^compose .* up -d/.test(c.call)), 'bob was not restarted');
});

test("the admin's update: root's step updates the front door and every account, and says how it went", (t) => {
  const { first, upIn } = withBob(t);
  const requests = path.join(first.dir, 'front-door', 'requests');
  const status = path.join(first.dir, 'front-door', 'status');
  const before = fs.readFileSync(path.join(first.top, 'docker.log'), 'utf8').split('\n').filter(Boolean).length;
  fs.writeFileSync(path.join(requests, 'UPDATE'), '');
  const done = installer(t, { again: first, dotenv: '', script: path.join(first.dir, 'bin', 'install.sh'), args: ['--requested'] });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  assert.deepEqual(fs.readdirSync(requests), [], 'the request is taken');
  const since = { docker: done.docker.slice(before) };
  assert.ok(upIn(since, 'ann') && upIn(since, 'bob'), 'every account is started on the new version');
  assert.ok(since.docker.some((c) => c.host === 'machine' && /^compose .* up -d/.test(c.call)), 'and the front door');
  const update = JSON.parse(fs.readFileSync(path.join(status, 'update.json'), 'utf8'));
  assert.equal(update.state, 'updated', fs.readFileSync(path.join(first.dir, 'update.log'), 'utf8'));
  assert.ok(!Number.isNaN(Date.parse(update.at)));
  assert.equal(fs.statSync(path.join(first.dir, 'update.log')).mode & 0o777, 0o600, 'what it said stays root\'s');
});

test("an update that fails says so to the admin page, with the installer's reason", (t) => {
  const { first } = withBob(t);
  const requests = path.join(first.dir, 'front-door', 'requests');
  fs.writeFileSync(path.join(requests, 'UPDATE'), '');
  // The installer's copy of root's step stops at once: an unknown option, as a broken copy would.
  fs.writeFileSync(path.join(first.dir, 'bin', 'install.sh'), fs.readFileSync(path.join(first.dir, 'bin', 'install.sh'), 'utf8').replace('--update) MODE=update UNATTENDED=1 ;;', '--update) die "Couldn\'t download ghcr.io/ladrok/bot-dot." ;;'));
  const done = installer(t, { again: first, dotenv: '', script: path.join(first.dir, 'bin', 'install.sh'), args: ['--requested'] });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  const update = JSON.parse(fs.readFileSync(path.join(first.dir, 'front-door', 'status', 'update.json'), 'utf8'));
  assert.equal(update.state, 'failed');
  assert.match(update.error, /Couldn't download ghcr\.io\/ladrok\/bot-dot\./);
});

test("an account whose new server doesn't start runs its old version again, and the others are updated (#194)", (t) => {
  // bob's first `compose up` of the update starts a server that never answers: its socket goes, as a crashed one's
  // would not be made again. The second (its old version again) starts as before.
  const ups = '"$BOT_DOT_DIR/bob-ups"';
  const { home, update, log, calls } = updateWithBob(t, `[ "$1" = compose ] && [ "$4" = up ] && [ ! -e ${ups} ] && { touch ${ups}; rm -f "$(sed -n 's/^BOT_DOT_FRONT_DOOR_FOLDER=//p' "$3/.env")/botdot.sock"; exit 0; }`);
  assert.equal(update.state, 'failed', log);
  assert.match(update.error, /Not every account was updated: bob\. The others run the new version\./);
  assert.deepEqual(update.accounts, [
    { name: 'ann', result: 'updated' },
    { name: 'bob', result: 'kept', error: "Its new botdot server didn't start, so it runs the version it ran before." },
  ]);
  assert.match(log, /The account bob's new botdot server didn't start, so it goes back to the version it ran/);
  assert.equal(calls('bob').filter((c) => /^compose .* up -d/.test(c)).length, 2, 'started again on its old compose file');
  assert.match(fs.readFileSync(path.join(home, 'compose.yaml'), 'utf8'), /# the version before/, 'its compose file is the one it ran');
  assert.ok(!fs.existsSync(path.join(home, 'compose.yaml.before')) && !fs.existsSync(path.join(home, '.env.before')), 'what it ran before is put back, not left beside it');
  assert.ok(!calls('bob').some((c) => /update-install\.js --clean/.test(c)), "its old images stay: they aren't cleaned after a rollback");
  assert.ok(calls('ann').some((c) => /update-install\.js --clean/.test(c)), "the updated account's are");
});

test("an account whose new server starts slowly is waited for while its container runs, not rolled back (#519)", (t) => {
  // bob's first `compose up` starts a server that makes no socket yet, as one held at its memory limit; its container
  // runs, and its socket comes on the fifth look past the 90 seconds.
  const ups = '"$BOT_DOT_DIR/bob-ups"', looks = '"$BOT_DOT_DIR/bob-looks"';
  const folder = `"$(sed -n 's/^BOT_DOT_FRONT_DOOR_FOLDER=//p' "$3/.env")"`;
  const { update, log, calls, home } = updateWithBob(t, [
    `[ "$1" = compose ] && [ "$4" = up ] && [ ! -e ${ups} ] && { touch ${ups}; rm -f ${folder}/botdot.sock; exit 0; }`,
    `[ "$1" = compose ] && [ "$4" = ps ] && { echo x >> ${looks}; [ "$(wc -l < ${looks})" -lt 5 ] || "${process.execPath}" -e "require('net').createServer().listen(process.argv[1], () => process.exit(0))" ${folder}/botdot.sock; echo c0ffee; exit 0; }`,
  ].join('; '));
  assert.equal(update.state, 'updated', log);
  assert.match(log, /The account bob's botdot server is still starting\. Waiting up to 10 minutes\./);
  assert.equal(log.match(/still starting/g).length, 1, 'said once');
  assert.doesNotMatch(log, /goes back to the version it ran/);
  assert.equal(calls('bob').filter((c) => /^compose .* up -d/.test(c)).length, 1, 'started once, on the new version');
  assert.ok(calls('bob').some((c) => /^compose --project-directory \S+ ps -q --status running bot-dot$/.test(c)), 'it asked whether the container runs');
  assert.doesNotMatch(fs.readFileSync(path.join(home, 'compose.yaml'), 'utf8'), /# the version before/);
});
