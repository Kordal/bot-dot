// install.sh on a stand-in machine (test/installer-helpers.js): the admin page's update, and whether a newer version
// exists.
// Part 4 of 4 of the update tests: the parts run side by side, so that none takes more than about three minutes in CI (docs/decisions/2026-11-25-installer-tests-in-parts.md).
const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('install.sh uses GNU sed and stat')) return;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { ROOT, code, PIN, SIGNED, installer, rerun, SELF, withBob, status, running } = require('./installer-helpers');

// --- Whether a newer version exists, and an update with nothing new (#193) ---------------------------------------

// The stand-in Docker's images carry the source revision they were built from, as botdot's signed images do.
const LABELLED = [`[ "$1" = image ] && [ "$2" = inspect ] && [ "$3" = --format ] && case "$4" in *revision*) echo ${'f'.repeat(40)}; exit 0 ;; esac`];

test("botdot's image carries the installer and its release check, for the admin page's update", () => {
  const allowed = fs.readFileSync(path.join(ROOT, '.dockerignore'), 'utf8').split('\n');
  assert.ok(allowed.includes('!install.sh'));
  assert.ok(allowed.includes('!lib/'));
});

test('every file install.sh reads back out of the image is in it (.dockerignore is an allowlist)', () => {
  // A path left out of the allowlist is missing from the image: cat fails and the update stops at its last step.
  const allowed = fs.readFileSync(path.join(ROOT, '.dockerignore'), 'utf8').split('\n').filter((l) => l.startsWith('!')).map((l) => l.slice(1));
  const inImage = (file) => allowed.some((a) => (a.endsWith('/') ? file.startsWith(a) : file === a));
  const read = [...code.matchAll(/image_file ([A-Za-z0-9_./-]+)/g)].map((m) => m[1]).filter((f) => !f.includes('$'));
  assert.ok(read.includes('deploy/prepare-computers.sh') && read.includes('deploy/seed-demo.js'), read.join(', '));
  for (const file of read) {
    assert.ok(inImage(file), `${file} is read with image_file but .dockerignore leaves it out of the image`);
    assert.ok(fs.existsSync(path.join(ROOT, file)), `${file} is read with image_file but is not in the repository`);
  }
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
  assert.equal(lasting.length, 4, 'an account\'s Docker, the loop without systemd and an off-site backup without systemd');
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
  assert.deepEqual(once.checks.map((args) => args.slice(-3)), [['ghcr.io/ladrok/bot-dot:latest', 'server', '--revision']], 'the repository the install pinned, by the release check');
  assert.ok(once.checks[0].includes(`${first.dir}/bin/lib:/check/lib:ro`), 'root\'s copy of it');
  const latest = status(once, 'latest.json');
  assert.equal(latest.version, 'eeeeeee');
  assert.equal(latest.revision, 'e'.repeat(40), 'the whole revision, for the fleet console');
  assert.match(latest.digest, /^sha256:[0-9a-f]{64}$/, 'the signed digest, for the fleet console');
  assert.ok(Date.now() - Date.parse(latest.at) < 60_000);

  assert.deepEqual(look().checks, [], 'not again within the hour');

  // An hour later the check is refused: the last version found stays.
  fs.rmSync(path.join(first.run, 'load', 'LATEST'));
  const refused = look({ signed: { 'ghcr.io/ladrok/bot-dot:latest': 'it has no botdot signature' } });
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
  const done = installer(t, { again: first, dotenv: '', script: path.join(first.dir, 'bin', 'install.sh'), args: ['--requested'], dockerFirst: running(`ghcr.io/ladrok/bot-dot${SIGNED}`) });
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
  const bobOld = installer(t, { again: first, dotenv: '', args: ['--update'], dockerFirst: running(`ghcr.io/ladrok/bot-dot${SIGNED}`, { account: 'bob', old: `ghcr.io/ladrok/bot-dot${PIN}` }) });
  assert.equal(bobOld.status, 0, `${bobOld.said}\n${bobOld.stderr}`);
  assert.doesNotMatch(bobOld.said, /It was the newest already/);
  const since = { docker: bobOld.docker.slice(first.docker.length) };
  assert.ok(upIn(since, 'ann') && upIn(since, 'bob'), 'every account is started on it');

  // The front door's .env pins another desktop: the update goes on, though every server runs the newest.
  const env = path.join(first.dir, 'front-door', '.env');
  fs.writeFileSync(env, fs.readFileSync(env, 'utf8').replace(/^BOT_DOT_COMPUTER_IMAGE=.*$/m, `BOT_DOT_COMPUTER_IMAGE=ghcr.io/ladrok/bot-dot-desktop${PIN}`));
  const desktop = installer(t, { again: first, dotenv: null, args: ['--update'], dockerFirst: running(`ghcr.io/ladrok/bot-dot${SIGNED}`) });
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
  assert.deepEqual({ ...machine, at: null }, { at: null, cpus: 6, load: 1.25, ramTotal: 8_192_000_000, ramUsed: 2_048_000_000, diskTotal: 62914560 * 1024, diskUsed: 17825792 * 1024 });
  const ann = JSON.parse(fs.readFileSync(path.join(load, 'account-ann.json'), 'utf8'));
  assert.equal(ann.ram, 1610612736, 'what its unit holds');
  assert.equal(ann.cpu, null, 'CPU is measured between two readings');
  assert.equal(ann.diskSize, 31457280 * 1024);
  assert.equal(ann.diskUsed, 10485760 * 1024);
  assert.equal(ann.full, false);
  assert.ok(Date.now() - Date.parse(ann.at) < 60_000);
  // Its disk, an image that only grows, gives the machine back what its files no longer hold, once a day.
  const trims = (done) => done.system.split('\n').filter((l) => l === `fstrim ${first.dir}/accounts/ann`).length;
  assert.equal(trims(once), 1, once.system);
  const sameDay = measure(1_000_000_000);
  assert.equal(trims(sameDay), trims(once), 'not again within the day');
  const stamp = path.join(first.run, 'load', 'ann.trimmed');
  const dayAgo = new Date(Date.now() - 25 * 3600_000);
  fs.utimesSync(stamp, dayAgo, dayAgo);
  assert.equal(trims(measure(1_000_000_000)), trims(once) + 1, 'again a day later');

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
