// install.sh on a stand-in machine (test/installer-helpers.js): the off-site backup (#1016, ADR 157), root's step that
// streams a backup set's parts into a restic repository. A stand-in restic on PATH keeps each part it is given in a
// folder of its own, as the repository holds it, and writes down what it was asked.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { withBob, installer, status } = require('./installer-helpers');

const members = (tar) => spawnSync('tar', ['-tf', tar], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean).sort();
const volume = (home, name) => path.join(home, '.local', 'share', 'docker', 'volumes', name, '_data');

// restic: `cat config` finds the repository once `init` made it, `backup --stdin-from-command` keeps the command's
// output as the part its --stdin-filename names (with its tags beside it), and a part named in STAND_IN_RESTIC_FAIL
// fails as a full repository would. STAND_IN_RESTIC_UNREACHABLE: the repository can't be reached.
const restic = (repo) => `#!/bin/sh
echo "restic $*" >> "$STAND_IN_LOG"
echo "restic-env $RESTIC_REPOSITORY $RESTIC_PASSWORD_FILE $RESTIC_CACHE_DIR" >> "$STAND_IN_LOG"
while [ "$1" = -o ]; do shift 2; done
case "$1" in
  version) echo "restic 0.19.1 compiled with go1.26.4 on linux/amd64" ;;
  cat) [ -z "\${STAND_IN_RESTIC_UNREACHABLE:-}" ] || { echo "Fatal: unable to open repository: ssh: Permission denied (publickey)" >&2; exit 1; }
    [ -f "${repo}/config" ] || { echo "Fatal: repository does not exist" >&2; exit 10; } ;;
  init) mkdir -p "${repo}"; touch "${repo}/config" ;;
  backup) name=''; tags=''
    while [ "$1" != -- ]; do case "$1" in --stdin-filename) name="$2"; shift ;; --tag) tags="$2"; shift ;; esac; shift; done
    shift
    mkdir -p "${repo}/parts/$(dirname "$name")"
    case " \${STAND_IN_RESTIC_FAIL:-} " in *" $name "*) "$@" > /dev/null; echo '{"message_type":"exit_error","code":1,"message":"Fatal: unable to save snapshot: no space left on device"}'; exit 1 ;; esac
    "$@" > "${repo}/parts/$name" || { s=$?; echo "{\\"message_type\\":\\"exit_error\\",\\"code\\":1,\\"message\\":\\"Fatal: unable to save snapshot: command failed: exit status $s\\"}"; exit 1; }
    echo "$tags" > "${repo}/parts/$name.tags"
    echo "{\\"message_type\\":\\"summary\\",\\"data_added_packed\\":100,\\"snapshot_id\\":\\"$(printf '%s' "$name" | sha256sum | cut -c1-64)\\"}" ;;
  check) echo "$2" >> "${repo}/checked"
    [ -z "\${STAND_IN_RESTIC_DAMAGED:-}" ] || { echo "Pack 3f1a: hash mismatch" >&2; exit 1; } ;;
  # A part's snapshot is the sha256 of its name, as backup says it: snapshots, dump and stats find the part by it.
  snapshots) [ -f "${repo}/parts/manifest.json" ] || { echo '[]'; exit 0; }
    echo "[{\\"id\\":\\"$(printf '%s' manifest.json | sha256sum | cut -c1-64)\\",\\"paths\\":[\\"/manifest.json\\"]}]" ;;
  dump) for f in $(cd "${repo}/parts" && find . -type f ! -name '*.tags' | sed 's#^./##'); do
      [ "$(printf '%s' "$f" | sha256sum | cut -c1-64)" = "$2" ] && { [ -z "\${STAND_IN_RESTIC_SHORT:-}" ] || [ "$f" != "$STAND_IN_RESTIC_SHORT" ] || { head -c 3 "${repo}/parts/$f"; exit 0; }; cat "${repo}/parts/$f"; exit 0; }
    done; echo "Fatal: no snapshot $2" >&2; exit 1 ;;
  stats) id="$5"; for f in $(cd "${repo}/parts" && find . -type f ! -name '*.tags' | sed 's#^./##'); do
      [ "$(printf '%s' "$f" | sha256sum | cut -c1-64)" = "$id" ] && { echo "{\\"total_size\\":$(wc -c < "${repo}/parts/$f" | tr -d ' '),\\"total_file_count\\":1}"; exit 0; }
    done; exit 1 ;;
esac
exit 0
`;

// A machine with ann and bob, as test/installer-backup.test.js makes it, with an off-site repository named.
function machine(t, { repo = null } = {}) {
  const m = withBob(t);
  const { dir } = m.first;
  const store = path.join(m.first.top, 'storage-box');
  const ann = path.join(dir, 'accounts', 'ann');
  fs.mkdirSync(path.join(ann, 'data', 'backups'), { recursive: true });
  fs.writeFileSync(path.join(ann, 'data', 'bots.json'), '[{"id":"b1"}]');
  fs.writeFileSync(path.join(ann, 'data', 'backups', 'bot-dot-20261101-0300.bdb'), 'an account backup');
  fs.writeFileSync(path.join(ann, 'data', 'backups', 'bot-dot-20261102-0300.bdb.part'), 'a backup cut off');
  fs.mkdirSync(path.join(ann, 'data', 'workspaces', 'b1', 'app', 'node_modules', 'left-pad'), { recursive: true });
  fs.writeFileSync(path.join(ann, 'data', 'workspaces', 'b1', 'app', 'package.json'), '{}');
  fs.writeFileSync(path.join(ann, 'data', 'workspaces', 'b1', 'app', 'node_modules', 'left-pad', 'index.js'), '');
  fs.mkdirSync(path.join(m.home, 'data'), { recursive: true });
  fs.writeFileSync(path.join(m.home, 'data', 'vault.json'), '[]');
  for (const f of ['memory.db', 'memory.db-wal', 'memory.db-shm']) fs.writeFileSync(path.join(m.home, 'data', f), 'live');
  fs.mkdirSync(volume(m.home, 'bob_bot-dot-config'), { recursive: true });
  fs.writeFileSync(path.join(volume(m.home, 'bob_bot-dot-config'), 'vault.key'), 'ab'.repeat(32));
  fs.mkdirSync(path.join(volume(m.home, 'botdot-bob.account.computer-workspace'), 'b1'), { recursive: true });
  fs.writeFileSync(path.join(volume(m.home, 'botdot-bob.account.computer-workspace'), 'b1', 'notes.md'), 'a bot file');
  const profile = path.join(volume(m.home, 'botdot-bob.account.computer-browser'), 'profiles', 'b1');
  fs.mkdirSync(profile, { recursive: true });
  for (const f of ['cookies.sqlite', 'lock', 'SingletonLock']) fs.writeFileSync(path.join(profile, f), f);
  fs.mkdirSync(volume(m.home, 'botdot-bob.account.computer-tailscale'), { recursive: true });
  fs.writeFileSync(path.join(volume(m.home, 'botdot-bob.account.computer-tailscale'), 'tailscaled.state'), '{}');
  fs.writeFileSync(path.join(dir, 'front-door', 'data', 'audit.jsonl'), '{"what":"sign-in"}\n');
  m.door({ accounts: { ann: {}, bob: {} } });
  fs.writeFileSync(path.join(dir, 'front-door', 'status', 'version.json'), '{"version":"abc1234","selfBuilt":false}\n');
  const address = repo ?? store;
  // offsite(): root's step's off-site backup, as its timer runs it.
  let seen = 0;
  const offsite = ({ given = {}, bins = {} } = {}) => {
    const done = installer(t, { again: m.first, dotenv: '', script: path.join(dir, 'bin', 'install.sh'), args: ['--offsite'], given: { BOT_DOT_OFFSITE_REPO: address, ...given }, bins: { restic: restic(store), ...bins } });
    const since = { ...done, system: done.system.slice(seen) };
    seen = done.system.length;
    return since;
  };
  // restoreTest(account): `install.sh --restore-test ACCOUNT` (#1018), as the admin runs it.
  const restoreTest = (account, { given = {} } = {}) => {
    const done = installer(t, { again: m.first, dotenv: '', script: path.join(dir, 'bin', 'install.sh'), args: ['--restore-test', account], given: { BOT_DOT_OFFSITE_REPO: address, ...given }, bins: { restic: restic(store) } });
    const since = { ...done, system: done.system.slice(seen) };
    seen = done.system.length;
    return since;
  };
  return { ...m, dir, store, parts: path.join(store, 'parts'), offsite, restoreTest, secrets: path.join(dir, 'offsite') };
}
const resticCalls = (done) => done.system.split('\n').filter((l) => l.startsWith('restic ')).map((l) => l.slice(7));

test('the off-site backup streams every part of a set into the repository, made on first use, and keeps no copy here', (t) => {
  const m = machine(t);
  const done = m.offsite();
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  assert.match(done.said, /The off-site repository .* is made/);
  assert.match(done.said, /This machine is backed up to /);
  const calls = resticCalls(done);
  assert.ok(calls.some((c) => /(^| )init --repository-version 2$/.test(c)), 'the repository is made, format 2');

  // Each part a backup of its own, in a set's order, with the manifest last.
  const backups = calls.filter((c) => / backup /.test(c)).map((c) => c.match(/--stdin-filename (\S+)/)[1]);
  assert.deepEqual(backups, [
    'front-door/data.tar',
    'accounts/ann/data.tar', 'accounts/ann/env',
    'accounts/bob/data.tar', 'accounts/bob/env', 'accounts/bob/config.tar', 'accounts/bob/workspace.tar', 'accounts/bob/browser.tar',
    'accounts/bob/tailscale.tar', 'manifest.json',
  ]);
  for (const c of calls.filter((c) => / backup /.test(c))) {
    assert.match(c, /--stdin-from-command -- /, 'streamed, from the command that makes it');
    assert.match(c, /--host [0-9a-f]{8} /);
  }
  const tags = (part) => fs.readFileSync(path.join(m.parts, `${part}.tags`), 'utf8').trim();
  assert.match(tags('accounts/bob/workspace.tar'), /^instance=[0-9a-f]{8},part=workspace,account=bob$/);
  assert.match(tags('front-door/data.tar'), /^instance=[0-9a-f]{8},part=front-door$/);

  assert.ok(members(path.join(m.parts, 'front-door', 'data.tar')).includes('./audit.jsonl'));
  const ann = members(path.join(m.parts, 'accounts', 'ann', 'data.tar'));
  assert.ok(ann.includes('./bots.json'));
  assert.ok(ann.includes('./workspaces/b1/app/package.json'));
  for (const left of ['./backups', 'node_modules', '.part']) {
    assert.ok(!ann.some((f) => f === left || f.startsWith(`${left}/`) || (!left.startsWith('./') && f.includes(left))), `without ${left}`);
  }
  // bob's memory is the consistent copy its server made (#1015), in the live file's place, and the copy goes after.
  const bobTar = path.join(m.parts, 'accounts', 'bob', 'data.tar');
  const bob = members(bobTar);
  assert.equal(spawnSync('tar', ['-xOf', bobTar, './memory.db'], { encoding: 'utf8' }).stdout, 'a consistent copy');
  assert.ok(!bob.includes('./memory.db-wal') && !bob.includes('./memory.db-shm') && !bob.includes('./.snapshot/memory.db'), bob.join(' '));
  assert.ok(!fs.existsSync(path.join(m.home, 'data', '.snapshot', 'memory.db')));
  assert.equal(fs.readFileSync(path.join(m.parts, 'accounts', 'bob', 'env'), 'utf8'), fs.readFileSync(path.join(m.home, '.env'), 'utf8'));
  assert.ok(members(path.join(m.parts, 'accounts', 'bob', 'config.tar')).includes('./vault.key'));
  const browser = members(path.join(m.parts, 'accounts', 'bob', 'browser.tar'));
  assert.ok(browser.includes('./profiles/b1/cookies.sqlite'));
  assert.deepEqual(browser.filter((f) => /lock$/i.test(f)), [], 'without a profile\'s lock files');

  const manifest = JSON.parse(fs.readFileSync(path.join(m.parts, 'manifest.json'), 'utf8'));
  assert.equal(manifest.kind, 'botdot-offsite');
  assert.equal(manifest.version, 'abc1234');
  assert.equal(manifest.admin, 'ann');
  assert.deepEqual(manifest.accounts, ['ann', 'bob']);
  assert.deepEqual(Object.keys(manifest.snapshots), backups.slice(0, -1), 'each part\'s snapshot');

  // Kept 7 days, 4 weeks and 3 months; pruned on the first run.
  const forget = calls.find((c) => / forget /.test(c));
  assert.match(forget, /--host [0-9a-f]{8} --keep-daily 7 --keep-weekly 4 --keep-monthly 3 --prune$/);

  const said = status(done, 'offsite.json');
  assert.equal(said.state, 'done');
  assert.equal(said.bytesAdded, 1000);
  assert.equal(said.lastSuccess, said.finished);
  assert.ok(said.started <= said.finished);
  assert.deepEqual(Object.keys(said.snapshots), backups);
  assert.match(said.snapshots['accounts/bob/data.tar'], /^[0-9a-f]{64}$/);
  assert.deepEqual(said.failed, []);
  assert.equal(said.error, undefined);

  // Its secrets are root's alone; nothing of the backup stays on the machine.
  assert.equal(fs.statSync(m.secrets).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(m.secrets, 'password')).mode & 0o777, 0o600);
  assert.match(fs.readFileSync(path.join(m.secrets, 'password'), 'utf8'), /^[0-9a-f]{64}$/, 'a new password, made at random');
  assert.match(done.said, new RegExp(`A new password for the off-site repository is in ${m.secrets}/password: keep a copy off this machine`));
  assert.ok(done.system.includes(`restic-env ${m.store} ${m.secrets}/password ${m.secrets}/cache`), 'the password from its file, never on the command line');
  assert.deepEqual(fs.readdirSync(m.secrets).sort(), ['cache', 'check-next', 'check.json', 'checked', 'password', 'pruned']);
  assert.ok(!fs.existsSync(path.join(m.dir, 'backup')), 'no set on the machine\'s disk');
  assert.match(fs.readFileSync(path.join(m.dir, 'front-door', '.env'), 'utf8'), new RegExp(`^BOT_DOT_OFFSITE_REPO=${m.store}$`, 'm'), 'the repository is kept in .env');

  // The next night finds the repository, keeps the password and doesn't prune again within the week.
  const password = fs.readFileSync(path.join(m.secrets, 'password'), 'utf8');
  const next = m.offsite();
  assert.equal(next.status, 0, next.said);
  assert.ok(!resticCalls(next).some((c) => / init /.test(c)));
  assert.doesNotMatch(resticCalls(next).find((c) => / forget /.test(c)), /--prune/);
  assert.equal(fs.readFileSync(path.join(m.secrets, 'password'), 'utf8'), password);
  assert.doesNotMatch(next.said, /new password/);
});

test('a part that fails doesn\'t stop the others, and the status names it and keeps the last success', (t) => {
  const m = machine(t);
  const first = status(m.offsite(), 'offsite.json');
  fs.rmSync(path.join(m.dir, 'accounts', 'ann', 'data'), { recursive: true });
  const done = m.offsite({ given: { STAND_IN_RESTIC_FAIL: 'accounts/bob/workspace.tar' } });
  assert.equal(done.status, 0, done.said);
  const backups = resticCalls(done).filter((c) => / backup /.test(c)).map((c) => c.match(/--stdin-filename (\S+)/)[1]);
  assert.ok(backups.includes('accounts/bob/browser.tar') && backups.includes('manifest.json'), 'the parts after them are backed up');
  const said = status(done, 'offsite.json');
  assert.equal(said.state, 'failed');
  assert.deepEqual(said.failed, ['accounts/ann/data.tar', 'accounts/bob/workspace.tar']);
  assert.equal(said.part, 'accounts/ann/data.tar');
  assert.match(said.error, /^accounts\/ann\/data\.tar: .*(exit status 2|Cannot open)/);
  assert.equal(said.lastSuccess, first.lastSuccess, 'the last success is still the one before');
  assert.ok(said.snapshots['accounts/bob/browser.tar']);
  assert.match(done.said, /The off-site backup of accounts\/bob\/workspace.tar failed: Fatal: unable to save snapshot: no space left on device/);
  const manifest = JSON.parse(fs.readFileSync(path.join(m.parts, 'manifest.json'), 'utf8'));
  assert.deepEqual(manifest.failed, said.failed);
});

test('a repository that can\'t be reached fails the run at its check, and says why', (t) => {
  const m = machine(t);
  const done = m.offsite({ given: { STAND_IN_RESTIC_UNREACHABLE: '1' } });
  assert.notEqual(done.status, 0);
  const said = status(done, 'offsite.json');
  assert.equal(said.state, 'failed');
  assert.equal(said.part, 'check');
  assert.match(said.error, /Couldn't open the off-site repository .*: Fatal: unable to open repository: ssh: Permission denied \(publickey\)/);
  assert.ok(!resticCalls(done).some((c) => / (init|backup) /.test(c)), 'nothing is made or written');
});

test('a Storage Box over SFTP gets a key of this machine\'s own, which restic signs in with, never asking', (t) => {
  const m = machine(t, { repo: 'sftp://u1-sub1@u1-sub1.your-storagebox.de:23/botdot' });
  const keygen = '#!/bin/sh\necho "ssh-keygen $*" >> "$STAND_IN_LOG"\nwhile [ "$1" != -f ]; do shift; done\necho key > "$2"; echo "ssh-ed25519 AAAA botdot" > "$2.pub"\n';
  const done = m.offsite({ bins: { 'ssh-keygen': keygen, ssh: '#!/bin/sh\nexit 0\n' } });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  assert.match(done.system, /ssh-keygen -q -t ed25519 -N {2}-C botdot-[0-9a-f]{8} -f \S+\/offsite\/ssh_key/);
  assert.match(done.said, /ssh-ed25519 AAAA botdot/);
  assert.match(done.said, new RegExp(`cat ${m.secrets}/ssh_key.pub \\| ssh -p 23 u1-sub1@u1-sub1.your-storagebox.de install-ssh-key`));
  const call = resticCalls(done).find((c) => / backup /.test(c));
  assert.ok(call.startsWith(`-o sftp.args=-i ${m.secrets}/ssh_key -o IdentitiesOnly=yes -o UserKnownHostsFile=${m.secrets}/known_hosts -o StrictHostKeyChecking=accept-new -o BatchMode=yes`), call);
  assert.equal(fs.statSync(path.join(m.secrets, 'ssh_key')).mode & 0o777, 0o600);
  // Made once.
  const next = m.offsite({ bins: { 'ssh-keygen': keygen, ssh: '#!/bin/sh\nexit 0\n' } });
  assert.doesNotMatch(next.system, /ssh-keygen/);
});

test('restic is the pinned release, checked by its sha256: a download that doesn\'t match is refused', (t) => {
  const m = machine(t);
  const curl = '#!/bin/sh\necho "curl $*" >> "$STAND_IN_LOG"\nwhile [ "$1" != -o ]; do shift; done\necho "not restic" > "$2"\n';
  const done = m.offsite({ bins: { curl, restic: null } });
  assert.notEqual(done.status, 0);
  assert.match(done.system, /curl .*https:\/\/github\.com\/restic\/restic\/releases\/download\/v0\.19\.1\/restic_0\.19\.1_linux_amd64\.bz2/);
  assert.match(status(done, 'offsite.json').error, /Couldn't download restic 0\.19\.1 with its checksum, and this machine has no restic of 0\.17 or newer/);
  assert.ok(!fs.existsSync(path.join(m.dir, 'bin', 'restic')), 'nothing unchecked is kept');
  // An older restic of the machine's own isn't taken either.
  const old = m.offsite({ bins: { curl, restic: '#!/bin/sh\necho "restic 0.16.4 compiled with go1.22.2 on linux/amd64"\n' } });
  assert.match(status(old, 'offsite.json').error, /no restic of 0\.17 or newer/);
});

test('root\'s OFFSITE request starts the backup in a run of its own, and the nightly timer is set between 02:00 and 04:00', (t) => {
  const m = machine(t);
  fs.appendFileSync(path.join(m.dir, 'front-door', '.env'), `BOT_DOT_OFFSITE_REPO=${m.store}\n`);
  const done = m.step('OFFSITE');
  assert.match(done.system, /systemctl start --no-block botdot-offsite\.service/);
  const timer = fs.readFileSync(path.join(m.first.etc, 'systemd', 'system', 'botdot-offsite.timer'), 'utf8');
  const [, hh, mm] = timer.match(/^OnCalendar=\*-\*-\* (\d\d):(\d\d):00$/m);
  const minute = Number(hh) * 60 + Number(mm);
  const instance = fs.readFileSync(path.join(m.dir, 'front-door', '.env'), 'utf8').match(/^BOT_DOT_INSTANCE=(.*)$/m)[1];
  assert.equal(minute, 120 + (parseInt(instance, 16) % 120), 'offset by the instance id');
  assert.match(timer, /^Persistent=true$/m);
  const service = fs.readFileSync(path.join(m.first.etc, 'systemd', 'system', 'botdot-offsite.service'), 'utf8');
  assert.match(service, /^ExecStart=\/bin\/sh \S+\/bin\/install\.sh --offsite$/m);
  assert.match(done.system, /systemctl enable --now botdot-offsite\.timer/);
});

test('a machine without an off-site repository has no timer, and an OFFSITE request says so', (t) => {
  const m = machine(t);
  assert.ok(!fs.existsSync(path.join(m.first.etc, 'systemd', 'system', 'botdot-offsite.timer')), 'the install set none');
  assert.equal(status(m.first, 'offsite.json'), null, 'nor any status');
  const done = m.step('OFFSITE');
  assert.doesNotMatch(done.system, /botdot-offsite/);
  const said = status(done, 'offsite.json');
  assert.equal(said.state, 'off', 'no backup to miss (#1017)');
  assert.match(said.error, /This machine has no off-site repository/);
});

test('an OFFSITE request root didn\'t make is refused', { skip: process.getuid?.() !== 0 && 'chowning needs root' }, (t) => {
  const m = machine(t);
  fs.appendFileSync(path.join(m.dir, 'front-door', '.env'), `BOT_DOT_OFFSITE_REPO=${m.store}\n`);
  const request = path.join(m.dir, 'front-door', 'requests', 'OFFSITE');
  fs.writeFileSync(request, '');
  fs.chownSync(request, 990, 990);
  const done = m.step('bob');
  assert.equal(status(done, 'offsite.json').state, 'refused');
  assert.doesNotMatch(done.system, /botdot-offsite\.service/);
});

// The restore drills (#1018): a weekly check of a rotating twentieth, and a restore test of one account.
test('once a week a run checks the next twentieth of the repository, and says so in its status', (t) => {
  const m = machine(t);
  m.offsite();
  assert.equal(fs.readFileSync(path.join(m.store, 'checked'), 'utf8'), '--read-data-subset=1/20\n');
  let said = status(m.offsite(), 'offsite.json');
  assert.equal(fs.readFileSync(path.join(m.store, 'checked'), 'utf8').split('\n').filter(Boolean).length, 1, 'not again within the week');
  assert.deepEqual({ subset: said.check.subset, ok: said.check.ok }, { subset: '1/20', ok: true }, 'the last check stays in the status');
  // A week later, the next twentieth; after the twentieth, the first again.
  fs.utimesSync(path.join(m.secrets, 'checked'), new Date(Date.now() - 8 * 86400_000), new Date(Date.now() - 8 * 86400_000));
  fs.writeFileSync(path.join(m.secrets, 'check-next'), '20\n');
  said = status(m.offsite(), 'offsite.json');
  assert.equal(said.check.subset, '20/20');
  assert.equal(fs.readFileSync(path.join(m.secrets, 'check-next'), 'utf8').trim(), '1');
});

test('a check that finds damage fails the run, as a part that fails does', (t) => {
  const m = machine(t);
  const done = m.offsite({ given: { STAND_IN_RESTIC_DAMAGED: '1' } });
  const said = status(done, 'offsite.json');
  assert.equal(said.state, 'failed');
  assert.equal(said.part, 'integrity');
  assert.match(said.error, /^check 1\/20: Pack 3f1a: hash mismatch/);
  assert.deepEqual({ ok: said.check.ok, error: said.check.error }, { ok: false, error: 'Pack 3f1a: hash mismatch' });
  assert.ok(!fs.existsSync(path.join(m.secrets, 'checked')), 'checked again at the next run');
});

// bob's memory as a real SQLite file begins, and his bots, before the backup the test restores.
// His server is down, so the set takes the file as it is rather than the stand-in server's copy.
function withBobsData(m) {
  const sock = fs.readFileSync(path.join(m.home, '.env'), 'utf8').match(/^BOT_DOT_FRONT_DOOR_FOLDER=(.*)$/m);
  if (sock) fs.rmSync(path.join(sock[1], 'botdot.sock'), { force: true });
  fs.writeFileSync(path.join(m.home, 'data', 'memory.db'), Buffer.concat([Buffer.from('SQLite format 3\0'), Buffer.alloc(4080)]));
  fs.writeFileSync(path.join(m.home, 'data', 'bots.json'), JSON.stringify([{ id: 'b1', jobs: [{ id: 'j1' }], rules: 'say {hi}' }, { id: 'b2' }]));
}

test('a restore test restores one account\'s parts of the latest backup, checks them, counts its bots and leaves nothing', (t) => {
  const m = machine(t);
  withBobsData(m);
  m.offsite();
  const done = m.restoreTest('bob');
  assert.equal(done.status, 0, done.stderr);
  assert.match(done.said, /The restore test of bob passed: 2 bots/);
  const said = status(done, 'restore-test.json');
  assert.deepEqual({ state: said.state, account: said.account, bots: said.bots }, { state: 'passed', account: 'bob', bots: 2 });
  assert.match(said.snapshot, /^[0-9a-f]{64}$/);
  assert.ok(said.bytes > 4096);
  const dumped = resticCalls(done).filter((c) => / dump /.test(c)).map((c) => c.split(' ').at(-1));
  assert.deepEqual(dumped.sort(), ['accounts/bob/browser.tar', 'accounts/bob/config.tar', 'accounts/bob/data.tar', 'accounts/bob/env', 'accounts/bob/tailscale.tar', 'accounts/bob/workspace.tar', 'manifest.json']);
  assert.ok(!fs.existsSync(path.join(m.dir, 'restore-test')), 'the scratch folder is removed');
});

test('a part that comes back short fails the test, which says so in its status', (t) => {
  const m = machine(t);
  withBobsData(m);
  m.offsite();
  const done = m.restoreTest('bob', { given: { STAND_IN_RESTIC_SHORT: 'accounts/bob/workspace.tar' } });
  assert.notEqual(done.status, 0);
  const said = status(done, 'restore-test.json');
  assert.equal(said.state, 'failed');
  assert.match(said.error, /^accounts\/bob\/workspace.tar came back with 3 bytes, and restic recorded \d+\.$/);
  assert.match(done.stderr, /came back with 3 bytes/);
  assert.ok(!fs.existsSync(path.join(m.dir, 'restore-test')));
});

test('a restore test the disk has no room for is refused before anything is restored, saying what it needs', (t) => {
  const m = machine(t);
  withBobsData(m);
  m.offsite();
  const done = m.restoreTest('bob', { given: { STAND_IN_ROOT_FREE: '1024' } });
  assert.notEqual(done.status, 0);
  const said = status(done, 'restore-test.json');
  assert.equal(said.state, 'refused');
  assert.match(said.error, /^It needs 0\.5 GB free in \S+ and has 0\.0 GB\.$/);
  assert.ok(!resticCalls(done).some((c) => / dump \S+ accounts\//.test(c)), 'nothing of the account is restored');
});

test('a restore test of an account the backup lacks, or with no name, says so', (t) => {
  const m = machine(t);
  m.offsite();
  const none = m.restoreTest('carol');
  assert.notEqual(none.status, 0);
  assert.match(status(none, 'restore-test.json').error, /holds no data of the account carol/);
  const bad = m.restoreTest('');
  assert.notEqual(bad.status, 0);
  assert.match(bad.stderr, /Name the account to test the restore of/);
});
