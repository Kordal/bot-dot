// install.sh on a stand-in machine (test/installer-helpers.js): the off-site backup (#1016, ADR 157), root's step that
// streams a backup set's parts into a restic repository. A stand-in restic on PATH keeps each part it is given in a
// folder of its own, as the repository holds it, and writes down what it was asked.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { withBob, installer, status, extracts, code } = require('./installer-helpers');

const members = (tar) => spawnSync('tar', ['-tf', tar], { encoding: 'utf8' }).stdout.split('\n').filter(Boolean).sort();
const volume = (home, name) => path.join(home, '.local', 'share', 'docker', 'volumes', name, '_data');

// restic: `cat config` finds the repository once `init` made it, `backup --stdin-from-command` keeps the command's
// output as the part its --stdin-filename names (with its tags beside it), and a part named in STAND_IN_RESTIC_FAIL
// fails as a full repository would. STAND_IN_RESTIC_UNREACHABLE: the repository can't be reached. Each backup is also
// kept as a snapshot of its own (byid/ID, its name in ID.name, ID the sha256 of its name and its content), which dump,
// stats and restore read, and a manifest's id and tags are listed in manifests, which snapshots reads.
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
    echo "$(printf '%s %s' "$name" "$tags" | sha256sum | cut -c1-64) $tags $name" >> "${repo}/snaps"
    sid="$(printf '%s %s' "$name" "$(sha256sum < "${repo}/parts/$name")" | sha256sum | cut -c1-64)"
    mkdir -p "${repo}/byid"; cp "${repo}/parts/$name" "${repo}/byid/$sid"; echo "$name" > "${repo}/byid/$sid.name"
    [ "$name" != manifest.json ] || echo "$sid $tags" >> "${repo}/manifests"
    echo "{\\"message_type\\":\\"summary\\",\\"data_added_packed\\":100,\\"snapshot_id\\":\\"$sid\\"}" ;;
  check) echo "$2" >> "${repo}/checked"
    [ -z "\${STAND_IN_RESTIC_DAMAGED:-}" ] || { echo "Pack 3f1a: hash mismatch" >&2; exit 1; } ;;
  # With --tag account=…: every snapshot kept (snaps) whose tags hold all those asked, as restic lists them.
  snapshots) want=''; prev=''; for a in "$@"; do [ "$prev" != --tag ] || want="$a"; prev="$a"; done
    case "$want" in *account=*)
      out=''
      [ ! -f "${repo}/snaps" ] || while read -r id tags name; do
        ok=1; for w in $(echo "$want" | tr , ' '); do case ",$tags," in *",$w,"*) ;; *) ok='' ;; esac; done
        [ -z "$ok" ] || out="$out\${out:+,}{\\"time\\":\\"2026-11-01T03:00:00Z\\",\\"paths\\":[\\"/$name\\"],\\"tags\\":[\\"$(echo "$tags" | sed 's/,/","/g')\\"],\\"id\\":\\"$id\\",\\"short_id\\":\\"$(echo "$id" | cut -c1-8)\\"}"
      done < "${repo}/snaps"
      echo "[$out]"; exit 0 ;;
    esac
    # Otherwise the manifests of the machine --host names, oldest first, or its --latest N.
    host=''; latest=''; prev=''; for a in "$@"; do case "$prev" in --host) host="$a" ;; --latest) latest="$a" ;; esac; prev="$a"; done
    ids="$( [ ! -f "${repo}/manifests" ] || while read -r id tags; do case ",$tags," in *",instance=$host,"*) echo "$id" ;; esac; done < "${repo}/manifests")"
    [ -z "$latest" ] || ids="$(printf '%s\\n' "$ids" | grep . | tail -n "$latest")"
    out=''; for id in $ids; do out="$out\${out:+,}{\\"id\\":\\"$id\\",\\"paths\\":[\\"/manifest.json\\"]}"; done
    echo "[$out]" ;;
  # forget with snapshot ids: those gone from snaps.
  forget) case "$*" in *--keep-daily*) ;; *) [ -z "\${STAND_IN_RESTIC_NO_FORGET:-}" ] ;; esac || { echo "Fatal: unable to create lock in backend: repository is already locked" >&2; exit 1; }
    for a in "$@"; do case "$a" in ????????????????????????????????????????????????????????????????) grep -v "^$a " "${repo}/snaps" > "${repo}/snaps.new"; mv "${repo}/snaps.new" "${repo}/snaps"; echo "$a" >> "${repo}/forgotten" ;; esac; done ;;
  dump) [ -f "${repo}/byid/$2" ] || { echo "Fatal: no snapshot $2" >&2; exit 1; }
    [ -z "\${STAND_IN_RESTIC_SHORT:-}" ] || [ "$(cat "${repo}/byid/$2.name")" != "$STAND_IN_RESTIC_SHORT" ] || { head -c 3 "${repo}/byid/$2"; exit 0; }
    cat "${repo}/byid/$2" ;;
  stats) [ -f "${repo}/byid/$5" ] || exit 1
    echo "{\\"total_size\\":$(wc -c < "${repo}/byid/$5" | tr -d ' '),\\"total_file_count\\":1}" ;;
  # restore ID --target DIR [--verify]: the snapshot's one file at its name in DIR; one named in STAND_IN_RESTIC_RESTORE_FAIL
  # fails as a pack that can't be read would.
  restore) [ -f "${repo}/byid/$2" ] && [ "$3" = --target ] || { echo "Fatal: no snapshot $2" >&2; exit 1; }
    name="$(cat "${repo}/byid/$2.name")"
    [ "$name" != "\${STAND_IN_RESTIC_RESTORE_FAIL:-}" ] || { echo "Fatal: failed to load pack 3f1a: ciphertext verification failed" >&2; exit 1; }
    mkdir -p "$4/$(dirname "$name")"; cp "${repo}/byid/$2" "$4/$name" ;;
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
  assert.match(tags('accounts/bob/workspace.tar'), /^instance=[0-9a-f]{8},part=workspace,account=bob,born=\d{8}T\d{6}Z$/);
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
  assert.deepEqual(fs.readdirSync(m.secrets).sort(), ['cache', 'check-next', 'check.json', 'checked', 'keep', 'password', 'pruned']);
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
  assert.match(status(done, 'offsite.json').error, /Couldn't download restic 0\.19\.1 with its checksum \(its download did not match its sha256\), and this machine has no restic of 0\.17 or newer/);
  assert.ok(!fs.existsSync(path.join(m.dir, 'bin', 'restic')), 'nothing unchecked is kept');
  // An older restic of the machine's own isn't taken either.
  const old = m.offsite({ bins: { curl, restic: '#!/bin/sh\necho "restic 0.16.4 compiled with go1.22.2 on linux/amd64"\n' } });
  assert.match(status(old, 'offsite.json').error, /no restic of 0\.17 or newer/);
});

test('a restic download that fails is tried again over IPv4, and the error says GitHub could not be reached', (t) => {
  const m = machine(t);
  const curl = '#!/bin/sh\necho "curl $*" >> "$STAND_IN_LOG"\nexit 7\n';
  const done = m.offsite({ bins: { curl, restic: null } });
  assert.notEqual(done.status, 0);
  const calls = done.system.split('\n').filter((l) => /^curl .*restic_0\.19\.1_linux_amd64\.bz2/.test(l));
  assert.equal(calls.length, 2);
  assert.doesNotMatch(calls[0], / -4 /);
  assert.match(calls[1], /^curl -4 /);
  assert.match(status(done, 'offsite.json').error, /\(github\.com could not be reached, over IPv6 or IPv4\)/);
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

test('an OFFSITE request the front door made starts a run too: the admin page\'s "Back up now" (ADR 161)', { skip: process.getuid?.() !== 0 && 'chowning needs root' }, (t) => {
  const m = machine(t);
  fs.appendFileSync(path.join(m.dir, 'front-door', '.env'), `BOT_DOT_OFFSITE_REPO=${m.store}\n`);
  const request = path.join(m.dir, 'front-door', 'requests', 'OFFSITE');
  fs.writeFileSync(request, '');
  fs.chownSync(request, 990, 990);
  const done = m.step('bob');
  assert.match(done.system, /systemctl start --no-block botdot-offsite\.service/);
});

test('the number of latest backups the admin page set is what forget keeps, pruned at once when it changes (ADR 161)', (t) => {
  const m = machine(t);
  m.offsite();
  fs.writeFileSync(path.join(m.dir, 'front-door', 'data', 'offsite-keep.json'), '{"last":2}');
  const forget = (done) => resticCalls(done).find((c) => / forget .*--keep/.test(c));
  const two = m.offsite();
  assert.match(forget(two), /--host [0-9a-f]{8} --keep-last 2 --prune$/, 'a new number prunes now');
  assert.match(forget(m.offsite()), /--keep-last 2$/, 'not again within the week');
  fs.writeFileSync(path.join(m.dir, 'front-door', 'data', 'offsite-keep.json'), '{"last":"2; rm -rf /"}');
  assert.match(forget(m.offsite()), /--keep-daily 7 --keep-weekly 4 --keep-monthly 3 --prune$/, 'anything else is the default');
});

// The off-site backup set up from the admin page (ADR 161): the front door made a Storage Box sub-account and asks with
// OFFSITE-SET. A stand-in ssh says what it was given: its arguments, the password its askpass answers and the key.
const BOX = 'sftp://u1-sub1@u1-sub1.your-storagebox.de:23/botdot';
const keygen = '#!/bin/sh\necho "ssh-keygen $*" >> "$STAND_IN_LOG"\nwhile [ "$1" != -f ]; do shift; done\necho key > "$2"; echo "ssh-ed25519 AAAA botdot" > "$2.pub"\n';
const ssh = '#!/bin/sh\necho "ssh $* askpass=$("$SSH_ASKPASS") require=$SSH_ASKPASS_REQUIRE key=$(cat)" >> "$STAND_IN_LOG"\n[ -z "${STAND_IN_SSH_FAIL:-}" ] || { echo "Permission denied, please try again." >&2; exit 255; }\n';
const setUp = (m, { body = `${BOX}\n\nsub-secret-1\n`, given = {} } = {}) => m.step('OFFSITE-SET', { body, given: { OFFSITE_KEY_WAIT: '0', ...given }, bins: { restic: restic(m.store), ssh, 'ssh-keygen': keygen } });

test('the admin page\'s OFFSITE-SET puts the machine\'s key on the sub-account, opens the repository, leaves its password for the page and starts a run', (t) => {
  const m = machine(t);
  const done = setUp(m);
  const call = done.system.split('\n').find((l) => l.startsWith('ssh '));
  assert.ok(call, done.said);
  assert.match(call, /^ssh -p 23 .*-o PubkeyAuthentication=no .* u1-sub1@u1-sub1\.your-storagebox\.de install-ssh-key askpass=sub-secret-1 require=force key=ssh-ed25519 AAAA botdot$/);
  assert.ok(resticCalls(done).some((c) => / init --repository-version 2$/.test(c)), 'the repository is made');
  assert.match(fs.readFileSync(path.join(m.dir, 'front-door', '.env'), 'utf8'), /^BOT_DOT_OFFSITE_REPO=sftp:\/\/u1-sub1@u1-sub1\.your-storagebox\.de:23\/botdot$/m);
  assert.match(done.system, /systemctl start --no-block botdot-offsite\.service/);
  assert.equal(status(done, 'offsite.json').state, 'setting-up');
  // The sub-account's password is nowhere; the repository's is in the front door's data for the page, the front door's own.
  assert.deepEqual(fs.readdirSync(m.secrets).filter((f) => /subpass|askpass/.test(f)), []);
  const shown = path.join(m.dir, 'front-door', 'data', 'offsite-password.json');
  const password = fs.readFileSync(path.join(m.secrets, 'password'), 'utf8').trim();
  assert.equal(JSON.parse(fs.readFileSync(shown, 'utf8')).password, password);
  assert.equal(fs.statSync(shown).mode & 0o777, 0o600);
  assert.equal(fs.statSync(shown).uid, fs.statSync(path.join(m.dir, 'front-door', 'data')).uid);
  assert.ok(!JSON.stringify(fs.readdirSync(path.join(m.dir, 'front-door', 'status')).map((f) => fs.readFileSync(path.join(m.dir, 'front-door', 'status', f), 'utf8'))).includes('sub-secret-1'));
  assert.ok(!done.said.includes('sub-secret-1') && !done.said.includes(password), 'neither password is said');

  // Set up again (another box): the repository's password stays and isn't left for the page again.
  fs.rmSync(shown);
  const again = setUp(m, { body: `${BOX.replace(/u1-sub1/g, 'u1-sub2')}\n\nsub-secret-2\n` });
  assert.match(again.system, /askpass=sub-secret-2/);
  assert.equal(fs.readFileSync(path.join(m.secrets, 'password'), 'utf8').trim(), password);
  assert.ok(!fs.existsSync(shown));
});

test('a setup whose key can\'t be put on the sub-account says why, and leaves the machine without an off-site repository', (t) => {
  const m = machine(t);
  const done = setUp(m, { given: { STAND_IN_SSH_FAIL: '1', OFFSITE_KEY_TRIES: '2' } });
  assert.equal(done.system.split('\n').filter((l) => l.startsWith('ssh ')).length, 2, 'tried again');
  const said = status(done, 'offsite.json');
  assert.deepEqual({ state: said.state, setup: said.setup }, { state: 'off', setup: true });
  assert.match(said.error, /Couldn't put this machine's key on u1-sub1@u1-sub1\.your-storagebox\.de: Permission denied/);
  assert.doesNotMatch(fs.readFileSync(path.join(m.dir, 'front-door', '.env'), 'utf8'), /BOT_DOT_OFFSITE_REPO/);
  assert.ok(!fs.existsSync(path.join(m.secrets, 'password')), 'no password of a repository never opened');
  assert.ok(!fs.existsSync(path.join(m.dir, 'front-door', 'data', 'offsite-password.json')));
  assert.doesNotMatch(done.system, /botdot-offsite\.service/);
});

test('an OFFSITE-SET the front door made may name only a Storage Box, and gives no password', { skip: process.getuid?.() !== 0 && 'chowning needs root' }, (t) => {
  const m = machine(t);
  const request = path.join(m.dir, 'front-door', 'requests', 'OFFSITE-SET');
  fs.writeFileSync(request, 'sftp://evil@example.com:22/x\n\npw\n');
  fs.chownSync(request, 990, 990);
  const done = m.step('bob');
  assert.equal(status(done, 'offsite.json').state, 'off');
  assert.match(status(done, 'offsite.json').error, /Only a Hetzner Storage Box/);
  assert.doesNotMatch(fs.readFileSync(path.join(m.dir, 'front-door', '.env'), 'utf8'), /BOT_DOT_OFFSITE_REPO/);
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
  // A real database, as sqlite3's quick check (when the machine has it) opens it.
  const db = path.join(m.home, 'data', 'memory.db');
  fs.rmSync(db, { force: true });
  const { DatabaseSync } = require('node:sqlite');
  const memory = new DatabaseSync(db);
  memory.exec("CREATE TABLE memories (id INTEGER PRIMARY KEY, text TEXT); INSERT INTO memories (text) VALUES ('a fact');");
  memory.close();
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

// An erased account's snapshots (#1019): what the stand-in repository keeps of the account NAME, as "part born".
const kept = (m, name) => fs.readFileSync(path.join(m.store, 'snaps'), 'utf8').split('\n').filter(Boolean).map((l) => l.split(' '))
  .filter(([, tags]) => tags.split(',').includes(`account=${name}`)).map(([, tags, part]) => `${part} ${(tags.match(/born=(\S+)/) || [])[1] || '-'}`).sort();
const DAY = 86400;

test('an erased account\'s off-site snapshots are forgotten after the grace period and pruned, and one made again under its name is untouched', (t) => {
  const m = machine(t);
  fs.mkdirSync(path.join(m.dir, 'born'), { recursive: true });
  fs.writeFileSync(path.join(m.dir, 'born', 'bob'), '20260101T000000Z\n');
  m.offsite();
  // A part of bob's from before born stamps, as an earlier version kept it.
  const instance = fs.readFileSync(path.join(m.parts, 'front-door', 'data.tar.tags'), 'utf8').match(/instance=(\w+)/)[1];
  fs.appendFileSync(path.join(m.store, 'snaps'), `${'e'.repeat(64)} instance=${instance},part=env,account=bob accounts/bob/env\n`);
  assert.deepEqual(kept(m, 'bob').filter((k) => / -$/.test(k)), ['accounts/bob/env -']);

  m.door({ accounts: { ann: {} }, deleted: { bob: '2026-11-05T12:00:00.000Z' } });
  const erased = m.step('bob');
  assert.match(erased.said, /The account bob is erased/);
  const [name, born, epoch] = fs.readFileSync(path.join(m.secrets, 'erased'), 'utf8').trim().split(' ');
  assert.deepEqual([name, born], ['bob', '20260101T000000Z'], 'the erase is written down with its born stamp');
  assert.ok(Math.abs(Number(epoch) - Date.now() / 1000) < 60);
  assert.ok(!fs.existsSync(path.join(m.dir, 'born', 'bob')), 'its stamp goes with it');

  // Made again under the same name, and backed up, before the grace period ends: nothing of bob's is forgotten yet.
  m.door({ accounts: { ann: {}, bob: {} } });
  m.step('bob');
  const inGrace = m.offsite();
  assert.equal(inGrace.status, 0, inGrace.stderr);
  assert.ok(!resticCalls(inGrace).some((c) => / forget --quiet [0-9a-f]{64}/.test(c)), 'nothing forgotten in the grace period');
  const newBorn = fs.readFileSync(path.join(m.dir, 'born', 'bob'), 'utf8').trim();
  assert.notEqual(newBorn, '20260101T000000Z', 'the new bob has a stamp of its own');

  // The grace period over.
  fs.writeFileSync(path.join(m.secrets, 'erased'), `bob 20260101T000000Z ${Math.floor(Date.now() / 1000) - 15 * DAY} 2026-10-21T12:00:00Z\n`);
  const after = m.offsite();
  assert.equal(after.status, 0, after.stderr);
  assert.match(after.said, /The off-site snapshots of the account bob, erased 2026-10-21T12:00:00Z, are forgotten: 7/);
  const calls = resticCalls(after);
  assert.match(calls.find((c) => / snapshots /.test(c) && /account=bob/.test(c)), /--host [0-9a-f]{8} --tag instance=[0-9a-f]{8},account=bob$/);
  assert.match(calls.find((c) => / forget --quiet [0-9a-f]{64}/.test(c)), /forget --quiet( [0-9a-f]{64}){7}$/);
  assert.match(calls.find((c) => / forget --quiet --host /.test(c)), /--prune$/, 'pruned in the same run');
  assert.deepEqual(kept(m, 'bob').map((k) => k.split(' ')[1]).filter((b, i, a) => a.indexOf(b) === i), [newBorn], 'only the new bob\'s are kept');
  assert.ok(kept(m, 'ann').length > 0, "ann's are untouched");
  assert.equal(fs.readFileSync(path.join(m.secrets, 'erased'), 'utf8'), '', 'the erase is done');
  const forgotten = status(after, 'offsite-forgotten.json').forgotten;
  assert.equal(forgotten.length, 1);
  assert.deepEqual({ ...forgotten[0], at: null }, { account: 'bob', erased: '2026-10-21T12:00:00Z', at: null, snapshots: 7 });
  assert.equal(status(after, 'offsite.json').state, 'done');

  const later = m.offsite();
  assert.ok(!resticCalls(later).some((c) => / forget --quiet [0-9a-f]{64}/.test(c)), 'forgotten once');
});

test('a forget that fails keeps the erase for the next run, and fails this one', (t) => {
  const m = machine(t);
  m.offsite();
  m.door({ accounts: { ann: {} }, deleted: { bob: '2026-11-05T12:00:00.000Z' } });
  m.step('bob');
  const line = fs.readFileSync(path.join(m.secrets, 'erased'), 'utf8').trim().split(' ');
  line[2] = String(Math.floor(Date.now() / 1000) - 15 * DAY);
  fs.writeFileSync(path.join(m.secrets, 'erased'), `${line.join(' ')}\n`);
  const done = m.offsite({ given: { STAND_IN_RESTIC_NO_FORGET: '1' } });
  assert.match(done.stderr + done.said, /The off-site snapshots of the erased account bob weren't forgotten: .*already locked/);
  const said = status(done, 'offsite.json');
  assert.equal(said.state, 'failed');
  assert.match(said.error, /^forget bob: /);
  assert.equal(fs.readFileSync(path.join(m.secrets, 'erased'), 'utf8'), `${line.join(' ')}\n`, 'kept for the next run');
  const again = m.offsite();
  assert.match(again.said, /The off-site snapshots of the account bob, .* are forgotten: 6/);
});

test('a machine without the off-site backup writes no erase down', (t) => {
  const { first, door, step } = withBob(t);
  door({ accounts: { ann: {} }, deleted: { bob: '2026-11-05T12:00:00.000Z' } });
  step('bob');
  assert.ok(!fs.existsSync(path.join(first.dir, 'offsite', 'erased')));
});

// Root's restore requests from the fleet console (ADR 159, #1018): RESTORE-TEST runs the restore test from a request,
// and OFFSITE-RESTORE puts the machine back from its off-site repository through a scratch folder and the restore of a
// set (#986). The stand-in Docker of a restore writes into a bind folder what its tar is given (extracts).
const scratch = (m) => path.join(m.dir, 'offsite-restore');
const doorData = (m) => fs.readFileSync(path.join(m.dir, 'front-door', 'data', 'front-door.json'), 'utf8');
const instanceOf = (m) => fs.readFileSync(path.join(m.dir, 'front-door', '.env'), 'utf8').match(/^BOT_DOT_INSTANCE=(.*)$/m)[1];
// ask(m, NAME, BODY): root's step for the request NAME holding BODY, with what the machine was asked since the last run
// of any kind (an off-site backup's too).
const ask = (m, name, body, { given = {}, dockerFirst = [] } = {}) => {
  const log = path.join(m.first.top, 'system.log');
  const before = fs.readFileSync(log, 'utf8').length;
  const done = m.step(name, { body, given, dockerFirst, bins: { restic: restic(m.store) } });
  return { ...done, system: fs.readFileSync(log, 'utf8').slice(before) };
};
// holdLock(t, m): the off-site lock held, as a nightly backup that runs holds it, until the test ends.
function holdLock(t, m) {
  const file = path.join(m.first.run, 'offsite.lock');
  const child = spawn('flock', ['-n', file, 'sleep', '120'], { stdio: 'ignore', detached: true });
  t.after(() => { try { process.kill(-child.pid); } catch { /* gone */ } });
  for (let i = 0; i < 400 && spawnSync('flock', ['-n', file, 'true']).status === 0; i++) spawnSync('sleep', ['0.05']);
  assert.notEqual(spawnSync('flock', ['-n', file, 'true']).status, 0, 'the lock is held');
}

test('RESTORE-TEST from root runs the restore test of its account, and says it passed or failed as the command line does', (t) => {
  const m = machine(t);
  withBobsData(m);
  m.offsite();
  const passed = ask(m, 'RESTORE-TEST', 'bob\n');
  const said = status(passed, 'restore-test.json');
  assert.deepEqual({ state: said.state, account: said.account, bots: said.bots }, { state: 'passed', account: 'bob', bots: 2 }, passed.said);
  assert.match(said.snapshot, /^[0-9a-f]{64}$/);
  assert.ok(said.bytes > 4096);
  assert.ok(resticCalls(passed).some((c) => / dump \S+ accounts\/bob\/data\.tar$/.test(c)), 'bob\'s data is read back');
  assert.ok(!fs.existsSync(path.join(m.dir, 'restore-test')), 'the scratch folder is removed');

  const failed = ask(m, 'RESTORE-TEST', 'bob\n', { given: { STAND_IN_RESTIC_SHORT: 'accounts/bob/workspace.tar' } });
  const why = status(failed, 'restore-test.json');
  assert.deepEqual({ state: why.state, account: why.account }, { state: 'failed', account: 'bob' });
  assert.match(why.error, /^accounts\/bob\/workspace.tar came back with 3 bytes, and restic recorded \d+\.$/);
  assert.match(failed.said + failed.stderr, /The restore test of bob didn't pass: accounts\/bob\/workspace.tar came back with 3 bytes/);
  assert.ok(!fs.existsSync(path.join(m.dir, 'restore-test')));

  const none = ask(m, 'RESTORE-TEST', 'Bob; rm -rf /\n');
  assert.deepEqual(status(none, 'restore-test.json').state, 'refused');
  assert.equal(status(none, 'restore-test.json').error, 'The request named no account.');
  assert.ok(!resticCalls(none).length, 'nothing is read');
});

test('RESTORE-TEST is refused while an off-site backup holds the lock, and nothing is restored', (t) => {
  const m = machine(t);
  withBobsData(m);
  m.offsite();
  holdLock(t, m);
  const done = ask(m, 'RESTORE-TEST', 'bob\n');
  const said = status(done, 'restore-test.json');
  assert.deepEqual({ state: said.state, account: said.account }, { state: 'refused', account: 'bob' });
  assert.equal(said.error, 'An off-site backup runs now: test the restore when it is done.');
  assert.deepEqual(resticCalls(done), [], 'the repository isn\'t touched');
});

test('RESTORE-TEST and OFFSITE-RESTORE the front door made are refused, and neither touches the repository', { skip: process.getuid?.() !== 0 && 'chowning needs root' }, (t) => {
  const m = machine(t);
  m.offsite();
  const before = doorData(m);
  const requests = path.join(m.dir, 'front-door', 'requests');
  for (const [name, body] of [['RESTORE-TEST', 'bob\n'], ['OFFSITE-RESTORE', 'latest\n']]) {
    fs.writeFileSync(path.join(requests, name), body);
    fs.chownSync(path.join(requests, name), 990, 990);
  }
  const done = ask(m, 'bob', '');
  assert.deepEqual(status(done, 'restore-test.json'), { ...status(done, 'restore-test.json'), state: 'refused', account: 'bob', error: 'Only root asks for this.' });
  assert.deepEqual(status(done, 'restore.json'), { ...status(done, 'restore.json'), state: 'refused', from: 'offsite', error: 'Only root asks for this.' });
  assert.deepEqual(resticCalls(done), []);
  assert.equal(doorData(m), before);
});

// The machine as a fresh install of the same version finds it: its own front door's data, and bob's data its own.
function fresh(m) {
  m.door({ accounts: { ann: {} } });
  fs.writeFileSync(path.join(m.home, 'data', 'vault.json'), 'fresh');
}

test('OFFSITE-RESTORE of the latest backup restores it into a scratch folder, puts it back as a set and removes the folder', (t) => {
  const m = machine(t);
  m.offsite();
  const backedUp = doorData(m);
  const manifestId = status(m.first, 'offsite.json').snapshots['manifest.json'];
  fresh(m);
  const done = ask(m, 'OFFSITE-RESTORE', 'latest\n', { dockerFirst: extracts });
  const said = status(done, 'restore.json');
  assert.deepEqual({ state: said.state, from: said.from, snapshot: said.snapshot, version: said.version }, { state: 'restored', from: 'offsite', snapshot: manifestId, version: 'abc1234' }, done.said);
  assert.ok(!('instance' in said), 'no instance was named');
  assert.equal(doorData(m), backedUp, 'the front door\'s data is the backup\'s');
  assert.equal(fs.readFileSync(path.join(m.home, 'data', 'vault.json'), 'utf8'), '[]', 'bob\'s data is the backup\'s');
  const instance = instanceOf(m);
  const calls = resticCalls(done);
  assert.ok(calls.some((c) => c.endsWith(` snapshots --json --host ${instance} --tag instance=${instance},part=manifest --latest 1`)), calls.join('\n'));
  const restored = calls.filter((c) => / restore /.test(c));
  assert.equal(restored.length, 10, 'the manifest and its nine parts');
  for (const c of restored) assert.match(c, new RegExp(` restore [0-9a-f]{64} --target ${scratch(m)}(/\\.offsite)? --verify$`));
  assert.ok(!fs.existsSync(scratch(m)), 'the scratch folder is removed');
  const bob = done.docker.filter((c) => c.host.endsWith('/bob/docker.sock')).map((c) => c.call);
  assert.ok(bob.some((c) => / -v \S+:\/v /.test(c) && c.includes('computer-workspace')), 'bob\'s computer\'s volumes are put back');
});

test('OFFSITE-RESTORE of a named snapshot restores that one, not the latest', (t) => {
  const m = machine(t);
  fs.writeFileSync(path.join(m.home, 'data', 'vault.json'), '["first"]');
  m.offsite();
  const first = status(m.first, 'offsite.json').snapshots['manifest.json'];
  fs.writeFileSync(path.join(m.home, 'data', 'vault.json'), '["second"]');
  m.offsite();
  assert.notEqual(status(m.first, 'offsite.json').snapshots['manifest.json'], first);
  fresh(m);
  const done = ask(m, 'OFFSITE-RESTORE', `${first.slice(0, 12)}\n`, { dockerFirst: extracts });
  const said = status(done, 'restore.json');
  assert.deepEqual({ state: said.state, from: said.from, snapshot: said.snapshot }, { state: 'restored', from: 'offsite', snapshot: first }, done.said);
  assert.equal(fs.readFileSync(path.join(m.home, 'data', 'vault.json'), 'utf8'), '["first"]');
  assert.ok(!resticCalls(done).some((c) => /--latest/.test(c)));
  assert.ok(!fs.existsSync(scratch(m)));
});

test('OFFSITE-RESTORE reads another instance\'s backups when its second line names it, and the machine takes its instance', (t) => {
  const m = machine(t);
  m.offsite();
  const old = instanceOf(m);
  // A new machine of its own instance, given the old one's repository.
  const env = path.join(m.dir, 'front-door', '.env');
  fs.writeFileSync(env, fs.readFileSync(env, 'utf8').replace(/^BOT_DOT_INSTANCE=.*$/m, 'BOT_DOT_INSTANCE=0badcafe'));
  fresh(m);
  const own = ask(m, 'OFFSITE-RESTORE', 'latest\n', { dockerFirst: extracts });
  const none = status(own, 'restore.json');
  assert.deepEqual({ state: none.state, from: none.from, snapshot: none.snapshot, phase: none.phase }, { state: 'failed', from: 'offsite', snapshot: 'latest', phase: 'download' });
  assert.equal(none.error, 'The off-site repository holds no backup of the machine 0badcafe.');
  assert.ok(!fs.existsSync(scratch(m)), 'the scratch folder is removed after a failure');

  const done = ask(m, 'OFFSITE-RESTORE', `latest\n${old}\n`, { dockerFirst: extracts });
  const said = status(done, 'restore.json');
  assert.deepEqual({ state: said.state, from: said.from, instance: said.instance }, { state: 'restored', from: 'offsite', instance: old }, done.said);
  assert.match(said.snapshot, /^[0-9a-f]{64}$/);
  assert.ok(resticCalls(done).some((c) => c.endsWith(` snapshots --json --host ${old} --tag instance=${old},part=manifest --latest 1`)));
  assert.equal(instanceOf(m), old, 'the backup\'s instance, as a set\'s');
  assert.equal(fs.readFileSync(path.join(m.home, 'data', 'vault.json'), 'utf8'), '[]');
  assert.ok(!fs.existsSync(scratch(m)));
});

test('OFFSITE-RESTORE fails without an off-site repository, or with no room for the backup, or a request that names none, and changes nothing', (t) => {
  const m = machine(t);
  const noRepo = ask(m, 'OFFSITE-RESTORE', 'latest\n');
  assert.deepEqual(status(noRepo, 'restore.json'), { ...status(noRepo, 'restore.json'), state: 'failed', from: 'offsite', snapshot: 'latest', phase: 'download', error: 'This machine has no off-site repository: give it one with OFFSITE-SET.' });
  assert.deepEqual(resticCalls(noRepo), []);

  m.offsite();
  fresh(m);
  const before = doorData(m);
  const full = ask(m, 'OFFSITE-RESTORE', 'latest\n', { given: { STAND_IN_ROOT_FREE: '1024' }, dockerFirst: extracts });
  const said = status(full, 'restore.json');
  assert.deepEqual({ state: said.state, from: said.from, phase: said.phase }, { state: 'failed', from: 'offsite', phase: 'download' });
  assert.match(said.snapshot, /^[0-9a-f]{64}$/, 'the manifest it found');
  assert.match(said.error, /^It needs 0\.5 GB free in \S+ \(the backup, its data put back, and 512 MB to spare\), and has 0\.0 GB\.$/);
  assert.equal(resticCalls(full).filter((c) => / restore /.test(c)).length, 1, 'only the manifest is restored');
  assert.ok(!fs.existsSync(scratch(m)));
  assert.equal(doorData(m), before, 'nothing is put back');

  const bad = ask(m, 'OFFSITE-RESTORE', '../../etc\n');
  assert.equal(status(bad, 'restore.json').state, 'failed');
  assert.match(status(bad, 'restore.json').error, /named no snapshot/);
  const badInstance = ask(m, 'OFFSITE-RESTORE', 'latest\nnot-one\n');
  assert.match(status(badInstance, 'restore.json').error, /named no instance/);
  assert.deepEqual([...resticCalls(bad), ...resticCalls(badInstance)], []);
});

test('an OFFSITE-RESTORE whose part can\'t be restored fails, puts nothing back and removes the scratch folder', (t) => {
  const m = machine(t);
  m.offsite();
  fresh(m);
  const before = doorData(m);
  const done = ask(m, 'OFFSITE-RESTORE', 'latest\n', { given: { STAND_IN_RESTIC_RESTORE_FAIL: 'accounts/bob/workspace.tar' }, dockerFirst: extracts });
  const said = status(done, 'restore.json');
  assert.deepEqual({ state: said.state, from: said.from, phase: said.phase }, { state: 'failed', from: 'offsite', phase: 'download' });
  assert.equal(said.error, "Couldn't restore accounts/bob/workspace.tar: Fatal: failed to load pack 3f1a: ciphertext verification failed");
  assert.ok(!fs.existsSync(scratch(m)), 'the scratch folder is removed');
  assert.equal(doorData(m), before);
  assert.ok(!done.docker.some((c) => /compose .* (stop|down)$/.test(c.call)), 'nothing was stopped');
});

test('an OFFSITE-RESTORE of a backup of another version is refused by the set\'s checks, and fails while an off-site backup runs', (t) => {
  const m = machine(t);
  m.offsite();
  fresh(m);
  const before = doorData(m);
  fs.writeFileSync(path.join(m.dir, 'front-door', 'status', 'version.json'), '{"version":"def5678","selfBuilt":false}\n');
  const other = ask(m, 'OFFSITE-RESTORE', 'latest\n', { dockerFirst: extracts });
  const said = status(other, 'restore.json');
  assert.deepEqual({ state: said.state, from: said.from }, { state: 'refused', from: 'offsite' });
  assert.match(said.snapshot, /^[0-9a-f]{64}$/);
  assert.match(said.error, /The set is of version abc1234, and this machine runs def5678/);
  assert.ok(!fs.existsSync(scratch(m)));
  assert.equal(doorData(m), before);

  holdLock(t, m);
  const locked = ask(m, 'OFFSITE-RESTORE', 'latest\n', { dockerFirst: extracts });
  assert.deepEqual(status(locked, 'restore.json'), { ...status(locked, 'restore.json'), state: 'failed', from: 'offsite', snapshot: 'latest', error: 'An off-site backup runs now: restore from it when it is done.' });
  assert.deepEqual(resticCalls(locked), []);
});

test('an account\'s Docker, which an off-site restore may start, is started without the off-site lock\'s descriptor', () => {
  // Started with it, it would hold the lock after the restore, and every nightly backup would find one running.
  const docker = code.split('\n').filter((line) => /nohup '\$ROOTLESS'/.test(line));
  assert.equal(docker.length, 1);
  assert.match(docker[0], /9>&- 8>&-/, docker[0].trim());
});
