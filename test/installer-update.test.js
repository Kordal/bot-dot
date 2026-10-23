// install.sh on a stand-in machine (test/installer-helpers.js): the admin page's update, and whether a newer version
// exists.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ROOT, script, code, PIN, SIGNED, installer, rerun, roomAnswers, SELF, withBob, status, running } = require('./installer-helpers');

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
  assert.deepEqual(checks.map((args) => args.slice(-2)), [[`${repo}/bot-dot:latest`, 'server'], [`${repo}/bot-dot-desktop:latest`, 'desktop']]);
  assert.equal(env.BOT_DOT_IMAGE, `${repo}/bot-dot${SIGNED}`);
  // A person's rerun without names goes to botdot's own images, as before.
  const again = rerun(t, `BOT_DOT_IMAGE=${repo}/bot-dot${PIN}\n`);
  assert.equal(again.checks[0].at(-2), 'ghcr.io/kordal/bot-dot:latest');
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
  fs.writeFileSync(path.join(first.dir, 'bin', 'install.sh'), fs.readFileSync(path.join(first.dir, 'bin', 'install.sh'), 'utf8').replace('--update) MODE=update UNATTENDED=1 ;;', '--update) die "Couldn\'t download ghcr.io/kordal/bot-dot." ;;'));
  const done = installer(t, { again: first, dotenv: '', script: path.join(first.dir, 'bin', 'install.sh'), args: ['--requested'] });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  const update = JSON.parse(fs.readFileSync(path.join(first.dir, 'front-door', 'status', 'update.json'), 'utf8'));
  assert.equal(update.state, 'failed');
  assert.match(update.error, /Couldn't download ghcr\.io\/kordal\/bot-dot\./);
});

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

test("an account whose download fails keeps its version, and the update goes on with the others (#194)", (t) => {
  const { update, log, home, calls } = updateWithBob(t, `[ "$1" = pull ] && case "$3" in *bot-dot@*) echo 'write /var/lib/docker/x: no space left on device' >&2; exit 1 ;; esac`);
  assert.equal(update.state, 'failed', log);
  assert.ok(update.accounts, `${JSON.stringify(update)}\n${log}`);
  assert.equal(update.accounts.find((a) => a.name === 'ann').result, 'updated');
  assert.ok(!calls('bob').some((c) => /^compose .* up -d/.test(c)), 'it is not restarted');
  const bob = update.accounts.find((a) => a.name === 'bob');
  assert.equal(bob.result, 'kept');
  assert.match(bob.error, /Couldn't download \S+ for the account bob: write \S+: no space left on device\./);
  assert.match(log, /The account bob wasn't updated, and runs the version it ran/);
  assert.match(fs.readFileSync(path.join(home, 'compose.yaml'), 'utf8'), /# the version before/, 'nothing of it was switched');
});

test("an account whose old version doesn't start again either is said to run no version (#194)", (t) => {
  const { update } = updateWithBob(t, `[ "$1" = compose ] && [ "$4" = up ] && { rm -f "$(sed -n 's/^BOT_DOT_FRONT_DOOR_FOLDER=//p' "$3/.env")/botdot.sock"; exit 0; }`);
  assert.equal(update.state, 'failed');
  const bob = update.accounts.find((a) => a.name === 'bob');
  assert.equal(bob.result, 'failed');
  assert.match(bob.error, /neither the new version nor the one it ran/);
});

test("the admin's update goes on in the installer of the version it installs, from that version's image", (t) => {
  const { first } = withBob(t);
  const bin = path.join(first.dir, 'bin');
  // Root's copy is the version before's: one that wrote no host sockets for the server and the helper, and an older
  // release check beside it.
  const old = fs.readFileSync(path.join(bin, 'install.sh'), 'utf8').replace('RUNSC_UDS_FLAGS="$RUNSC_FLAGS, \\"--host-uds=all\\""', 'RUNSC_UDS_FLAGS="$RUNSC_FLAGS"');
  assert.notEqual(old, script, 'the copy is an older installer');
  fs.writeFileSync(path.join(bin, 'install.sh'), old);
  fs.appendFileSync(path.join(bin, 'lib', 'registry.js'), '// the version before\n');
  fs.writeFileSync(path.join(first.dir, 'front-door', 'requests', 'UPDATE'), '');
  const done = installer(t, { again: first, dotenv: '', script: path.join(bin, 'install.sh'), args: ['--requested'] });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  const log = fs.readFileSync(path.join(first.dir, 'update.log'), 'utf8');
  assert.equal(JSON.parse(fs.readFileSync(path.join(first.dir, 'front-door', 'status', 'update.json'), 'utf8')).state, 'updated', log);
  assert.equal(fs.readFileSync(path.join(bin, 'install.sh'), 'utf8'), script, 'root\'s copy is the new version\'s installer');
  assert.equal(fs.readFileSync(path.join(bin, 'lib', 'registry.js'), 'utf8'), fs.readFileSync(path.join(ROOT, 'lib', 'registry.js'), 'utf8'), 'and its release check');
  assert.match(log, /The installer is the new version's/);
  for (const account of ['ann', 'bob']) {
    const daemon = JSON.parse(fs.readFileSync(path.join(first.dir, 'accounts', account, '.config', 'docker', 'daemon.json'), 'utf8'));
    assert.ok(daemon.runtimes['runsc-uds'].runtimeArgs.includes('--host-uds=all'), `${account}'s Docker is set up as the new version needs`);
  }
  // A copy that is the version's own goes on as it is.
  fs.writeFileSync(path.join(first.dir, 'front-door', 'requests', 'UPDATE'), '');
  const again = installer(t, { again: first, dotenv: '', script: path.join(bin, 'install.sh'), args: ['--requested'] });
  assert.equal(again.status, 0, `${again.said}\n${again.stderr}`);
  assert.doesNotMatch(fs.readFileSync(path.join(first.dir, 'update.log'), 'utf8'), /The installer is the new version's/);
});

test("botdot's image carries the installer and its release check, for the admin page's update", () => {
  const allowed = fs.readFileSync(path.join(ROOT, '.dockerignore'), 'utf8').split('\n');
  assert.ok(allowed.includes('!install.sh'));
  assert.ok(allowed.includes('!lib/'));
});

test('one installer runs at a time: another waits for it, and then runs', async (t) => {
  const first = rerun(t);
  const lock = path.join(first.run, 'install.lock');
  const holder = require('node:child_process').spawn('flock', [lock, 'sleep', '1'], { stdio: 'ignore' });
  const ended = new Promise((resolve) => holder.on('exit', resolve));
  // Until the holder has it.
  for (let i = 0; i < 100 && spawnSync('flock', ['-n', lock, 'true']).status === 0; i += 1) await new Promise((r) => setTimeout(r, 10));
  const done = installer(t, { again: first, dotenv: '' });
  await ended;
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  assert.match(done.said, /Another botdot installer is running here: this one waits for it to finish/);
});

test('what the installer leaves running holds no lock: an account\'s Docker and the loop without systemd', () => {
  // Started with the lock's descriptor, either would hold it after the run, and the next installer would wait for ever.
  const lasting = code.split('\n').filter((line) => /nohup/.test(line));
  assert.equal(lasting.length, 2);
  for (const line of lasting) assert.match(line, /9>&-/, line.trim());
  assert.doesNotMatch(code, /export BOT_DOT_LOCKED/, 'only the update root\'s step starts, and the installer it hands over to, go on under its hold');
});

test("root's step takes no option but its own, and needs an install", (t) => {
  const wrong = installer(t, { args: ['--account', 'eve'] });
  assert.equal(wrong.status, 1);
  assert.match(wrong.stderr, /Unknown option --account\. Run it as: sudo sh install\.sh/);
  const none = installer(t, { dotenv: '', args: ['--requested'] });
  assert.equal(none.status, 1);
  assert.match(none.stderr, /botdot isn't installed here \(.+\.env is missing\)\./);
});

// --- Whether a newer version exists, and an update with nothing new (#193) ---------------------------------------


// The stand-in Docker's images carry the source revision they were built from, as botdot's signed images do.
const LABELLED = [`[ "$1" = image ] && [ "$2" = inspect ] && [ "$3" = --format ] && case "$4" in *revision*) echo ${'f'.repeat(40)}; exit 0 ;; esac`];

test('an install says the signed release it installed is the newest, and a self-built one has none', (t) => {
  const done = rerun(t, '', {}, { dockerFirst: LABELLED });
  const latest = status(done, 'latest.json');
  assert.ok(latest, 'latest.json is written');
  assert.equal(status(done, 'version.json').version, 'fffffff');
  assert.equal(latest.version, 'fffffff');
  assert.ok(Date.now() - Date.parse(latest.at) < 60_000);
  assert.equal(fs.statSync(path.join(done.dir, 'front-door', 'status', 'latest.json')).mode & 0o777, 0o644, 'root\'s, read by the front door');
  const self = rerun(t, '', SELF);
  assert.equal(status(self, 'latest.json'), null);
  // An image without a revision label has none to say, nor does its id stand for one.
  const unlabelled = rerun(t);
  assert.doesNotMatch(status(unlabelled, 'version.json').version, /^[0-9a-f]{7}$/);
  assert.equal(status(unlabelled, 'latest.json'), null);
});

test("root's step looks for the newest signed version at most once an hour, and keeps the last one found", (t) => {
  const first = rerun(t);
  const look = (options = {}) => {
    const done = installer(t, { again: first, dotenv: null, script: path.join(first.dir, 'bin', 'install.sh'), args: ['--load'], ...options });
    assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
    return done;
  };
  const once = look({ answers: { revision: 'e'.repeat(40) } });
  assert.deepEqual(once.checks.map((args) => args.slice(-3)), [['ghcr.io/kordal/bot-dot:latest', 'server', '--revision']], 'the repository the install pinned, by the release check');
  assert.ok(once.checks[0].includes(`${first.dir}/bin/lib:/check/lib:ro`), 'root\'s copy of it');
  const latest = status(once, 'latest.json');
  assert.equal(latest.version, 'eeeeeee');
  assert.ok(Date.now() - Date.parse(latest.at) < 60_000);

  assert.deepEqual(look().checks, [], 'not again within the hour');

  // An hour later the check is refused: the last version found stays.
  fs.rmSync(path.join(first.run, 'load', 'LATEST'));
  const refused = look({ signed: { 'ghcr.io/kordal/bot-dot:latest': 'it has no botdot signature' } });
  assert.equal(refused.checks.length, 1);
  assert.equal(status(refused, 'latest.json').version, 'eeeeeee');

  // A self-built install has no signed release to look for.
  const self = rerun(t, '', SELF);
  const none = installer(t, { again: self, dotenv: null, script: path.join(self.dir, 'bin', 'install.sh'), args: ['--load'] });
  assert.equal(none.status, 0, none.stderr);
  assert.deepEqual(none.checks, []);
  assert.equal(status(none, 'latest.json'), null);
});

test("an update that finds what every account and the front door run already restarts nothing, and says it was the newest", (t) => {
  const { first } = withBob(t);
  fs.writeFileSync(path.join(first.dir, 'front-door', 'requests', 'UPDATE'), '');
  const before = fs.readFileSync(path.join(first.top, 'docker.log'), 'utf8').split('\n').filter(Boolean).length;
  // As root's step said it of signed images, which carry their revision.
  const was = '1234567';
  fs.writeFileSync(path.join(first.dir, 'front-door', 'status', 'version.json'), JSON.stringify({ version: was, selfBuilt: false, at: '2026-10-20T12:00:00Z' }));
  const done = installer(t, { again: first, dotenv: '', script: path.join(first.dir, 'bin', 'install.sh'), args: ['--requested'], dockerFirst: running(`ghcr.io/kordal/bot-dot${SIGNED}`) });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  const log = fs.readFileSync(path.join(first.dir, 'update.log'), 'utf8');
  assert.match(log, /It was the newest already: the front door and every account run it, so nothing was restarted/);
  const since = done.docker.slice(before).map((c) => c.call);
  assert.deepEqual(since.filter((c) => /^(compose|pull|load|save|stop|rm)\b/.test(c) && c !== 'compose version'), [], 'nothing downloaded, started or stopped');
  const update = status(done, 'update.json');
  assert.equal(update.state, 'updated', log);
  assert.equal(update.from, was);
  assert.equal(update.to, was, 'from equal to to: "It was the newest already"');
  assert.equal(status(done, 'latest.json').version, was, 'and it is the newest there is');
});

test('an update with something new to run still updates: an account on an older image, or a pin that is not the newest', (t) => {
  const { first, upIn } = withBob(t);
  const bobOld = installer(t, { again: first, dotenv: '', args: ['--update'], dockerFirst: running(`ghcr.io/kordal/bot-dot${SIGNED}`, { account: 'bob', old: `ghcr.io/kordal/bot-dot${PIN}` }) });
  assert.equal(bobOld.status, 0, `${bobOld.said}\n${bobOld.stderr}`);
  assert.doesNotMatch(bobOld.said, /It was the newest already/);
  const since = { docker: bobOld.docker.slice(first.docker.length) };
  assert.ok(upIn(since, 'ann') && upIn(since, 'bob'), 'every account is started on it');

  // The front door's .env pins another desktop: the update goes on, though every server runs the newest.
  const env = path.join(first.dir, 'front-door', '.env');
  fs.writeFileSync(env, fs.readFileSync(env, 'utf8').replace(/^BOT_DOT_COMPUTER_IMAGE=.*$/m, `BOT_DOT_COMPUTER_IMAGE=ghcr.io/kordal/bot-dot-desktop${PIN}`));
  const desktop = installer(t, { again: first, dotenv: null, args: ['--update'], dockerFirst: running(`ghcr.io/kordal/bot-dot${SIGNED}`) });
  assert.equal(desktop.status, 0, `${desktop.said}\n${desktop.stderr}`);
  assert.doesNotMatch(desktop.said, /It was the newest already/);
});

test("an account's home made before disk shares keeps it, and the installer says it has none", (t) => {
  const first = rerun(t);
  fs.rmSync(path.join(first.dir, 'disks', 'ann.img'));
  fs.writeFileSync(path.join(first.top, 'mounts'), '');
  const done = rerun(t, '', {}, { again: first, dotenv: null });
  assert.match(done.said, /The account ann was made before disk shares, so it has none: it may fill this machine's disk\./);
  assert.doesNotMatch(done.system.slice(first.system.length), /^(truncate|mkfs|mount -o loop)/m);
});

test("root's step measures the machine's load and each account's use, from outside it, for the admin page", (t) => {
  const first = rerun(t);
  const proc = path.join(first.top, 'proc');
  fs.mkdirSync(proc, { recursive: true });
  fs.writeFileSync(path.join(proc, 'loadavg'), '1.25 0.80 0.50 2/300 4000\n');
  fs.writeFileSync(path.join(proc, 'meminfo'), 'MemTotal:        8000000 kB\nMemFree:         1000000 kB\nMemAvailable:    6000000 kB\n');
  const systemctl = (ns) => ['#!/bin/sh', 'echo "systemctl $*" >> "$STAND_IN_LOG"',
    // As systemd answers: each property asked, in systemd's own order (MemoryCurrent before CPUUsageNSec), not the order asked.
    `[ "$1" = show ] && [ "$2" = -p ] && { case "$*" in *MemoryCurrent*) echo 1610612736 ;; esac; case "$*" in *ControlGroup*) echo /system.slice/botdot-account@ann.service ;; esac; case "$*" in *CPUUsageNSec*) echo ${ns} ;; esac; exit 0; }`, '[ "$1" = show ] && exit 0', 'exit 0', ''].join('\n');
  const measure = (ns, given = {}) => installer(t, { again: first, dotenv: null, script: path.join(first.dir, 'bin', 'install.sh'), args: ['--load'], bins: { systemctl: systemctl(ns) }, given });
  const once = measure(1_000_000_000);
  assert.equal(once.status, 0, `${once.said}\n${once.stderr}`);
  const load = path.join(first.dir, 'front-door', 'load');
  assert.equal(fs.statSync(load).mode & 0o777, 0o750);
  assert.match(once.system, new RegExp(`^chown 0:990 ${load}$`, 'm'), "root's, read by the front door's group");
  const machine = JSON.parse(fs.readFileSync(path.join(load, 'machine.json'), 'utf8'));
  assert.deepEqual({ ...machine, at: null }, { at: null, cpus: 4, load: 1.25, ramTotal: 8_192_000_000, ramUsed: 2_048_000_000, diskTotal: 62914560 * 1024, diskUsed: 17825792 * 1024 });
  const ann = JSON.parse(fs.readFileSync(path.join(load, 'account-ann.json'), 'utf8'));
  assert.equal(ann.ram, 1610612736, 'what its unit holds');
  assert.equal(ann.cpu, null, 'CPU is measured between two readings');
  assert.equal(ann.diskSize, 31457280 * 1024);
  assert.equal(ann.diskUsed, 10485760 * 1024);
  assert.equal(ann.full, false);
  assert.ok(Date.now() - Date.parse(ann.at) < 60_000);

  // Its file cache is left out, as the machine's RAM leaves it out; its shared memory (gVisor's) stays in (#126).
  const cg = path.join(first.top, 'cgroup', 'system.slice', 'botdot-account@ann.service');
  fs.mkdirSync(cg, { recursive: true });
  fs.writeFileSync(path.join(cg, 'memory.stat'), 'anon 268435456\nfile 1073741824\nkernel 67108864\nshmem 536870912\n');
  assert.equal(measure(1_000_000_000).status, 0);
  assert.equal(JSON.parse(fs.readFileSync(path.join(load, 'account-ann.json'), 'utf8')).ram, 1610612736 - 536870912);
  fs.rmSync(path.join(first.top, 'cgroup'), { recursive: true, force: true });

  // A full disk is marked.
  const full = measure(1_000_000_000, { STAND_IN_DISK_FREE: '1000' });
  assert.equal(full.status, 0, `${full.said}\n${full.stderr}`);
  assert.equal(JSON.parse(fs.readFileSync(path.join(load, 'account-ann.json'), 'utf8')).full, true);
  // It asks for nothing and starts nothing.
  assert.doesNotMatch(full.system.slice(once.system.length), /^(useradd|systemctl (start|restart|enable|set-property)|mount|truncate)/m);
  assert.ok(!full.docker.slice(once.docker.length).some((c) => /^(compose|run|pull)/.test(c.call)), 'no container is started for it');
});

test("the timer that measures the load every minute runs root's copy of the installer", (t) => {
  const done = rerun(t);
  const unit = (name) => fs.readFileSync(path.join(done.etc, 'systemd', 'system', name), 'utf8');
  assert.match(unit('botdot-load.timer'), /^OnUnitActiveSec=1min$/m);
  assert.match(unit('botdot-load.service'), new RegExp(`^ExecStart=/bin/sh ${done.dir}/bin/install.sh --load$`, 'm'));
  assert.match(done.system, /^systemctl enable --now botdot-load\.timer$/m);
  const compose = fs.readFileSync(path.join(ROOT, 'compose.front-door.yaml'), 'utf8');
  assert.match(compose, /^ {6}- \.\/load:\/load:ro /m, 'the front door reads it, and writes nothing there');
  assert.match(compose, /^ {6}FRONT_DOOR_LOAD: \/load$/m);
});
