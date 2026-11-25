// What the off-site backup's installer tests (installer-offsite-N.test.js) share: a stand-in restic, and a machine with ann and bob and their data.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');
const { withBob, installer } = require('./installer-helpers');

// restic: `cat config` finds the repository once `init` made it, `backup --stdin-from-command` keeps the command's
// output as the part its --stdin-filename names (with its tags beside it), and a part named in STAND_IN_RESTIC_FAIL
// fails as a full repository would. STAND_IN_RESTIC_UNREACHABLE: the repository can't be reached. Each backup is also
// kept as a snapshot of its own (byid/ID, its name in ID.name, ID the sha256 of its name and its content), which dump,
// stats and restore read, and a manifest's id and tags are listed in manifests, which snapshots reads; snapshots given
// ids lists those, with their tags. STAND_IN_RESTIC_NO_SIZE: stats says no total_size.
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
    mkdir -p "${repo}/byid"; cp "${repo}/parts/$name" "${repo}/byid/$sid"; echo "$name" > "${repo}/byid/$sid.name"; echo "$tags" > "${repo}/byid/$sid.tags"
    [ "$name" != manifest.json ] || echo "$sid $tags" >> "${repo}/manifests"
    echo "{\\"message_type\\":\\"summary\\",\\"data_added_packed\\":100,\\"snapshot_id\\":\\"$sid\\"}" ;;
  check) echo "$2" >> "${repo}/checked"
    [ -z "\${STAND_IN_RESTIC_DAMAGED:-}" ] || { echo "Pack 3f1a: hash mismatch" >&2; exit 1; } ;;
  # With --tag account=…: every snapshot kept (snaps) whose tags hold all those asked, as restic lists them.
  snapshots) want=''; prev=''; for a in "$@"; do [ "$prev" != --tag ] || want="$a"; prev="$a"; done
    ids="$(for a in "$@"; do echo "$a"; done | grep -Ex '[0-9a-f]{64}' || true)"
    if [ -n "$ids" ]; then out=''
      for id in $ids; do [ -f "${repo}/byid/$id" ] || { echo "Fatal: no snapshot $id" >&2; exit 1; }
        out="$out\${out:+,}{\\"time\\":\\"2026-11-01T03:00:00Z\\",\\"tags\\":[\\"$(sed 's/,/","/g' "${repo}/byid/$id.tags")\\"],\\"id\\":\\"$id\\"}"; done
      echo "[$out]"; exit 0
    fi
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
    [ -z "\${STAND_IN_RESTIC_NO_SIZE:-}" ] || { echo '{"total_file_count":1}'; exit 0; }
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

// A machine with ann and bob, as test/installer-backup-helpers.js makes it, with an off-site repository named.
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

const volume = (home, name) => path.join(home, '.local', 'share', 'docker', 'volumes', name, '_data');

const resticCalls = (done) => done.system.split('\n').filter((l) => l.startsWith('restic ')).map((l) => l.slice(7));

const keygen = '#!/bin/sh\necho "ssh-keygen $*" >> "$STAND_IN_LOG"\nwhile [ "$1" != -f ]; do shift; done\necho key > "$2"; echo "ssh-ed25519 AAAA botdot" > "$2.pub"\n';

const ssh = '#!/bin/sh\necho "ssh $* askpass=$("$SSH_ASKPASS") require=$SSH_ASKPASS_REQUIRE key=$(cat)" >> "$STAND_IN_LOG"\n[ -z "${STAND_IN_SSH_FAIL:-}" ] || { echo "Permission denied, please try again." >&2; exit 255; }\n';

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

// holdLock(t, m): the off-site lock held, as a nightly backup that runs holds it, until the test ends or the function
// it returns lets it go.
function holdLock(t, m) {
  const file = path.join(m.first.run, 'offsite.lock');
  const acquired = path.join(m.first.run, 'test-offsite-lock-acquired');
  fs.rmSync(acquired, { force: true });
  // Wait for the previous process to release its descriptor, then acknowledge that this child owns the lock.
  const child = spawn('flock', [file, 'sh', '-c', 'touch "$1"; exec sleep 120', 'hold-offsite-lock', acquired], { stdio: 'ignore', detached: true });
  const release = () => { try { process.kill(-child.pid); } catch { /* gone */ } };
  t.after(release);
  for (let i = 0; i < 400 && !fs.existsSync(acquired); i++) spawnSync('sleep', ['0.05']);
  assert.ok(fs.existsSync(acquired), 'the child acquired the off-site lock');
  assert.notEqual(spawnSync('flock', ['-n', file, 'true']).status, 0, 'the lock is held');
  return () => {
    release();
    for (let i = 0; i < 400 && spawnSync('flock', ['-n', file, 'true']).status !== 0; i++) spawnSync('sleep', ['0.05']);
  };
}

// The machine as a fresh install of the same version finds it: its own front door's data, and bob's data its own.
function fresh(m) {
  m.door({ accounts: { ann: {} } });
  fs.writeFileSync(path.join(m.home, 'data', 'vault.json'), 'fresh');
}

// An account moved between machines (ADR 254): IMPORT-<account> restores one account of another machine's latest
// off-site backup here, after the front door made it (`front-door.js import-account`, its side in
// test/front-door-console-move.test.js), and DELETE-<account> deletes it from the machine it left. The stand-in front
// door keeps the record it was handed and writes the data its change leaves.
const moveDoor = (m, { refuse = false } = {}) => {
  const data = path.join(m.dir, 'front-door', 'data', 'front-door.json');
  const record = path.join(m.first.top, 'import-record.json');
  return [
    'case "$*" in',
    `  *"front-door.js import-account --account bob --record /dev/stdin --by console"*) cat > ${record}; if flock -n ${path.join(m.first.run, 'offsite.lock')} true; then echo free; else echo held; fi > ${path.join(m.first.top, 'import-lock')}; ${refuse ? `echo '{"state":"refused","account":"bob","error":"This machine holds one account, ann, and takes no other."}'; exit 3` : `printf '%s' '{"accounts":{"ann":{},"bob":{}}}' > ${data}; echo '{"state":"imported","account":"bob"}'; exit 0`} ;;`,
    `  *"front-door.js delete-account --account bob --by console"*) printf '%s' '{"accounts":{"ann":{}},"deleted":{"bob":"2026-11-16T12:00:00.000Z"}}' > ${data}; echo '{"state":"deleted","account":"bob"}'; exit 0 ;;`,
    'esac',
  ];
};

// The machine bob moves to: an instance of its own, without bob.
function elsewhere(m) {
  const env = path.join(m.dir, 'front-door', '.env');
  fs.writeFileSync(env, fs.readFileSync(env, 'utf8').replace(/^BOT_DOT_INSTANCE=.*$/m, 'BOT_DOT_INSTANCE=0badcafe'));
  m.door({ accounts: { ann: {} } });
  fs.writeFileSync(path.join(m.home, 'data', 'vault.json'), 'fresh');
}

module.exports = { restic, machine, volume, resticCalls, keygen, ssh, withBobsData, scratch, doorData, instanceOf, ask, holdLock, fresh, moveDoor, elsewhere };
