// The installer's test helpers (install.sh, #466, ADR 028): install.sh on a stand-in machine, with stand-ins for
// docker, the machine's tools (useradd, chown, setfacl, systemctl, su, tailscale, curl…) and the account's rootless
// Docker. Nothing is installed and nothing runs: each stand-in writes down what it was asked, and the tests read what
// the installer did and said. The installer tests are in four files, so that they run side by side (installer*.test.js).
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { fakeDocker } = require('./helpers');

const ROOT = path.join(__dirname, '..');
const file = path.join(ROOT, 'install.sh');
const script = fs.readFileSync(file, 'utf8');
const code = script.split('\n').filter((line) => !/^\s*#/.test(line)).join('\n');

const PIN = `@sha256:${'a'.repeat(64)}`;
// What the stand-in signature check gives for an image it finds signed (test/fixtures/fake-docker.js).
const SIGNED = `@sha256:${'c'.repeat(64)}`;
// An install whose questions were answered before: a rerun asks nothing.
const ANSWERED = 'TZ=UTC\nBOT_DOT_REACH=public\nBOT_DOT_DOMAIN=botdot.example.com\nFRONT_DOOR_ORIGIN=https://botdot.example.com\nFRONT_DOOR_ADMIN=ann\n';
// The first sub-UID and sub-GID the stand-in useradd gives the account's user (as Ubuntu's useradd would).
const SUB = 165536;

// The machine's own tools, without those a test stands in for or leaves out: a Linux machine may have the real
// tailscale, runsc or setfacl, and a test that leaves one out must find it missing. Made once, as links.
const OWN = new Set(['docker', 'tailscale', 'dockerd-rootless.sh', 'rootlesskit', 'runsc', 'setfacl', 'newuidmap', 'slirp4netns', 'pasta', 'vpnkit',
  'apt-get', 'dpkg', 'dpkg-query', 'useradd', 'userdel', 'umount', 'id', 'chown', 'su', 'systemctl', 'nohup', 'apparmor_parser', 'gpg', 'curl', 'sleep', 'timedatectl', 'uname',
  'mkfs.ext4', 'losetup', 'mount', 'mountpoint', 'resize2fs', 'truncate', 'df', 'getconf']);
let systemTools = null;
function machineTools() {
  if (systemTools) return systemTools;
  systemTools = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-tools-'));
  process.on('exit', () => fs.rmSync(systemTools, { recursive: true, force: true }));
  for (const d of ['/usr/local/bin', '/usr/bin', '/bin', '/usr/sbin', '/sbin']) {
    let names = [];
    try { names = fs.readdirSync(d); } catch { continue; }
    for (const name of names) {
      if (OWN.has(name) || fs.existsSync(path.join(systemTools, name))) continue;
      try { fs.symlinkSync(path.join(d, name), path.join(systemTools, name)); } catch { /* another's name */ }
    }
  }
  return systemTools;
}

// A stand-in for tailscale: `status --json` gives `status`, `serve` says `serve` and ends with `exit`.
const tailscale = ({ status = { Self: { DNSName: 'vm.example.ts.net.' } }, serve = 'Available within your tailnet: https://vm.example.ts.net/', exit = 0 } = {}) => [
  '#!/bin/sh',
  'echo "tailscale $*" >> "$STAND_IN_LOG"',
  `[ "$1" = status ] && [ "$2" = --json ] && { printf '%s' '${JSON.stringify(status)}'; exit 0; }`,
  '[ "$1" = status ] && exit 0',
  `[ "$1" = serve ] && { echo "${serve}"; exit ${exit}; }`,
  'exit 0', '',
].join('\n');

// install.sh on a stand-in machine whose front door's .env holds `dotenv`, answering `input`.
//   given: the installer's environment; bins: more stand-ins, { name: script } (null leaves one out);
//   systemd: whether systemd runs the machine; old: the folders of a botdot from before accounts in its Docker;
//   exists: the admin's account exists already (the front door makes no link); failPull: a pull that fails;
//   noCompose: Docker has no Compose; signed / answers: steer the stand-in docker (fake-docker.js); script: another
//   copy of the installer, args: its arguments; dockerFirst: lines the stand-in docker runs first; runtimes: the
//   runtimes an account's Docker has besides runc and runsc.
function installer(t, { dotenv = ANSWERED, given = {}, bins = {}, input = '', systemd = true, old = '', exists = false, failPull = '', noCompose = false, caddy = true, signed = null, answers = {}, script = file, args = [], again = null, onlyStandIns = false, dockerFirst = [], runtimes = 'runsc-uds' } = {}) {
  const real = fakeDocker();
  t.after(() => real.remove());
  // `again`: a run before this one on the same machine, whose folders this one finds.
  const top = again ? again.top : fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-install-'));
  if (!again) t.after(() => fs.rmSync(top, { recursive: true, force: true }));
  const dir = path.join(top, 'botdot'), etc = path.join(top, 'etc'), run = path.join(top, 'run'), bin = path.join(top, 'bin');
  const log = path.join(top, 'system.log'), dockerLog = path.join(top, 'docker.log'), users = path.join(top, 'users');
  for (const d of [path.join(etc, 'systemd', 'system'), path.join(etc, 'apparmor.d'), run, bin]) fs.mkdirSync(d, { recursive: true });
  if (dotenv) {
    fs.mkdirSync(path.join(dir, 'front-door'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'front-door', '.env'), dotenv, { mode: 0o600 });
  }
  if (!again) {
    fs.writeFileSync(path.join(etc, 'subuid'), 'ubuntu:100000:65536\n');
    fs.writeFileSync(path.join(etc, 'subgid'), 'ubuntu:100000:65536\n');
    fs.writeFileSync(users, '');
    fs.writeFileSync(path.join(etc, 'passwd'), 'root:x:0:0:root:/root:/bin/bash\n');
  }
  // The account's Docker answers once systemd or su has started it.
  const started = path.join(top, 'started');
  if (signed) real.answer('signed.json', JSON.stringify(signed));
  for (const [name, text] of Object.entries(answers)) real.answer(name, text);

  const stand = (name, body) => fs.writeFileSync(path.join(bin, name), `#!/bin/sh\n${body}\n`, { mode: 0o755 });
  // docker: every call is written down with the Docker it went to (the machine's, or an account's socket). What the
  // installer reads back is answered here; the rest goes to the shared stand-in, which knows images and signatures.
  stand('docker', [
    `printf '%s\\t%s\\n' "\${DOCKER_HOST:-machine}" "$*" >> "${dockerLog}"`,
    ...dockerFirst,
    `[ "$1" = pull ] && [ "$3" = "${failPull}" ] && { echo 'failed to register layer: write /var/lib/docker/overlay2/l/x: no space left on device' >&2; exit 1; }`,
    noCompose ? `[ "$1" = compose ] && { echo "docker: 'compose' is not a docker command." >&2; exit 1; }` : '',
    `[ "$1" = run ] && [ "$4" = --entrypoint ] && [ "$5" = node ] && { shift 6; exec "${process.execPath}" "$@"; }`,
    `[ "$1" = run ] && [ "$5" = --entrypoint ] && [ "$6" = cat ] && { cat "${ROOT}$(echo "$8" | sed 's#^/opt/bot-dot##')"; exit; }`,
    `[ "$1" = info ] && [ -n "\${DOCKER_HOST:-}" ] && [ ! -e "${started}" ] && exit 1`,
    `[ "$1" = info ] && [ "$2" = --format ] && case "$3" in *Runtimes*) echo "runc runsc ${runtimes}"; exit 0 ;; esac`,
    `[ "$1" = info ] && [ "$2" = --format ] && { echo runsc; exit 0; }`,
    // An account's Docker has none of botdot's images until they are handed to it.
    `[ "$1" = image ] && [ "$2" = inspect ] && [ -n "\${DOCKER_HOST:-}" ] && exit 1`,
    `[ "$1" = load ] && { cat > /dev/null; exit 0; }`,
    `[ "$1" = ps ] && { printf '%s' '${old}'; exit 0; }`,
    // An account's compose up starts its botdot server, which makes its socket in the folder its .env names.
    `if [ "$1" = compose ] && [ "$4" = up ] && [ -n "\${DOCKER_HOST:-}" ]; then f="$(sed -n 's/^BOT_DOT_FRONT_DOOR_FOLDER=//p' "$3/.env")"; "${process.execPath}" -e "require('net').createServer().listen(process.argv[1], () => process.exit(0))" "$f/botdot.sock"; exit 0; fi`,
    `[ "$1" = compose ] && [ "$6" = front-door ] && [ "$8" = front-door.js ] && { ${exists ? 'echo "The account $11 exists already." >&2; exit 3' : 'echo "https://$(sed -n "s#^FRONT_DOOR_ORIGIN=https://##p" "$3/.env")/sign-up/T0KEN"; echo "(works once, until 2026-10-23T12:00:00.000Z)"; exit 0'}; }`,
    `exec "${path.join(real.bin, 'docker')}" "$@"`,
  ].join('\n'));
  // The machine's tools: each writes down what it was asked and does nothing else.
  const said = (name) => `echo "${name} $*" >> "$STAND_IN_LOG"`;
  stand('id', `case "$1" in
  -u|-g) [ -z "\${2:-}" ] && { echo 0; exit 0; }; line="$(grep "^$2:" "${users}")" || exit 1; [ "$1" = -u ] && echo "$line" | cut -d: -f2 || echo "$line" | cut -d: -f3 ;;
  -un) echo root ;;
esac`);
  // useradd: a system user gets a low UID; any other one also sub-IDs, as Ubuntu's useradd gives them.
  stand('useradd', `${said('useradd')}
name="$(eval echo "\\\${$#}")"; n="$(wc -l < "${users}" | tr -d ' ')"
case " $* " in *" --create-home "*) h="$(echo " $* " | sed 's/.* --home-dir \\([^ ]*\\) .*/\\1/')"; mkdir -p "$h" ;; esac
case " $* " in *" --system "*) echo "$name:$((990 - n)):$((990 - n))" >> "${users}" ;; *) echo "$name:$((1001 + n)):$((1001 + n))" >> "${users}"; echo "$name:${SUB}:65536" >> "${path.join(etc, 'subuid')}"; echo "$name:${SUB}:65536" >> "${path.join(etc, 'subgid')}" ;; esac
h=''; prev=''; for a in "$@"; do [ "$prev" = --home-dir ] && h="$a"; prev="$a"; done
echo "$name:x:$(grep "^$name:" "${users}" | cut -d: -f2-3):botdot:$h:/usr/sbin/nologin" >> "${path.join(etc, 'passwd')}"`);
  for (const name of ['chown', 'setfacl', 'apparmor_parser', 'gpg', 'nohup', 'umount', 'mkfs.ext4', 'resize2fs']) stand(name, said(name));
  // An account's disk: an image file the stand-in truncate writes its size in, mounted (as a mark) by mount.
  const mounts = path.join(top, 'mounts');
  stand('truncate', `${said('truncate')}\ndd if=/dev/zero of="$3" bs=1 count=0 seek="$(( \${2%G} * 1073741824 ))" 2>/dev/null`);
  stand('mount', `${said('mount')}\necho "$4" >> "${mounts}"`);
  stand('mountpoint', `grep -qx "$2" "${mounts}" 2>/dev/null`);
  stand('losetup', `${said('losetup')}\n[ "$1" = -j ] && echo "/dev/loop7: []: ($2)"\nexit 0`);
  stand('df', `case "$2" in *accounts/*) echo "Filesystem 1024-blocks Used Available Capacity Mounted on"; echo "/dev/loop7 31457280 10485760 \${STAND_IN_DISK_FREE:-20971520} 34% $2" ;; *) echo "Filesystem 1024-blocks Used Available Capacity Mounted on"; echo "/dev/sda1 62914560 17825792 45088768 29% /" ;; esac`);
  stand('getconf', 'echo 4');
  stand('userdel', `${said('userdel')}
grep -v "^$1:" "${users}" > "${users}.new"; mv "${users}.new" "${users}"
grep -v "^$1:" "${path.join(etc, 'passwd')}" > "${users}.new"; mv "${users}.new" "${path.join(etc, 'passwd')}"`);
  // dpkg-query: the packages in STAND_IN_PACKAGES are installed, no other.
  stand('dpkg-query', 'for p; do :; done; case " ${STAND_IN_PACKAGES:-} " in *" $p "*) echo "install ok installed" ;; *) exit 1 ;; esac');
  stand('su', `${said('su')}\ntouch "${started}"`);
  stand('systemctl', `${said('systemctl')}\n[ "$1" = show ] && exit ${systemd ? 0 : 1}\ncase "$1" in start|restart) touch "${started}" ;; esac\nexit 0`);
  stand('apt-get', said('apt-get'));
  stand('sleep', 'exit 0');
  stand('timedatectl', 'exit 1');
  stand('uname', '[ "$1" = -m ] && echo x86_64 || echo Linux');
  // curl: the front door answers on 127.0.0.1, Caddy on the domain (unless `caddy` is false).
  // An account's botdot server answers on its socket while the socket is there (a stopped one's is removed below), and
  // only a request that names its account, as the front door's do.
  stand('curl', `${said('curl')}\ncase "$*" in *https://*) exit ${caddy ? 0 : 7} ;; esac\ncase "$*" in *--unix-socket*) case "$*" in *"X-Botdot-Account: "[a-z]*) ;; *) exit 22 ;; esac; for a; do [ "$p" = --unix-socket ] && s="$a"; p="$a"; done; [ -S "$s" ]; exit $? ;; esac\nexit 0`);
  for (const name of ['dockerd-rootless.sh', 'newuidmap', 'slirp4netns']) stand(name, 'exit 0');
  stand('runsc', 'echo "runsc version release-20261005.0"');
  for (const [name, body] of Object.entries({ tailscale: tailscale(), ...bins })) {
    if (body === null) fs.rmSync(path.join(bin, name), { force: true });
    else fs.writeFileSync(path.join(bin, name), body, { mode: 0o755 });
  }
  // Detached, so without a terminal: the answers come from `input`, never from the terminal the tests run in.
  const result = spawnSync('/bin/sh', [script, ...args], {
    encoding: 'utf8', input, detached: true, timeout: 60_000,
    env: { PATH: onlyStandIns ? bin : [bin, machineTools()].join(':'), HOME: top, STAND_IN_LOG: log, BOT_DOT_DIR: dir, BOT_DOT_ETC: etc, BOT_DOT_RUN: run, BOT_DOT_PROC: path.join(top, 'proc'), BOT_DOT_CGROUP: path.join(top, 'cgroup'), ...given },
  });
  const read = (f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '');
  const envOf = (f) => Object.fromEntries(read(f).split('\n').filter(Boolean).map((line) => [line.split('=')[0], line.slice(line.indexOf('=') + 1)]));
  const docker = read(dockerLog).split('\n').filter(Boolean).map((line) => { const [host, ...rest] = line.split('\t'); return { host, call: rest.join('\t') }; });
  return {
    status: result.status, said: result.stdout, stderr: result.stderr, dir, etc, run, top,
    env: envOf(path.join(dir, 'front-door', '.env')),
    accountEnv: (name) => envOf(path.join(dir, 'accounts', name, '.env')),
    read: (f) => read(path.join(dir, f)),
    system: read(log),
    docker,
    // The calls to the machine's Docker, and those to an account's.
    calls: docker.filter((c) => c.host === 'machine').map((c) => c.call),
    accountCalls: (name) => docker.filter((c) => c.host === `unix://${run}/${name}/docker.sock`).map((c) => c.call),
    checks: real.calls().map((c) => c.args).filter((args) => args.includes('/check/lib/signed-image.js')),
  };
}
function rerun(t, env = '', given = {}, { refuse = false, ...options } = {}) {
  const done = installer(t, { dotenv: `${ANSWERED}${env}`, given, ...options });
  if (refuse ? done.status === 0 : done.status !== 0) assert.fail(`install.sh ended with ${done.status}:\n${done.said}\n${done.stderr}`);
  return done;
}


// The room an update needs in each account (#192): the new server image's layers, as the registry lists them, that the
// account's Docker lacks. Two layers of 2 GB and 0.5 GB to download; the account has the second already.
const NEW_LAYER = `sha256:${'d'.repeat(64)}`, KEPT_LAYER = `sha256:${'e'.repeat(64)}`;
const roomAnswers = (layers = `${NEW_LAYER} 2000000000\\n${KEPT_LAYER} 500000000\\n`) => [
  `case "$*" in *image-layers.js*) printf '${layers}'; exit 0 ;; esac`,
  `[ -n "\${DOCKER_HOST:-}" ] && case "$*" in 'image ls -q --no-trunc') echo sha256:${'1'.repeat(64)}; exit 0 ;; *RootFS.Layers*) echo ${KEPT_LAYER}; exit 0 ;; esac`,
];

// A self-built botdot server (CONTEXT.md): images named without a registry, built with `make images`.
const SELF = { BOT_DOT_IMAGE: 'bot-dot/server:latest', BOT_DOT_COMPUTER_IMAGE: 'bot-dot/desktop:latest' };

// An install whose root's step made bob from a sign-up link. door(data): what the front door's data says now.
// step(name): root's step for a request named `name`, with what it did to the machine since the last one.
function withBob(t) {
  const first = rerun(t);
  const requests = path.join(first.dir, 'front-door', 'requests');
  const data = path.join(first.dir, 'front-door', 'data', 'front-door.json');
  const door = (d) => fs.writeFileSync(data, typeof d === 'string' ? d : JSON.stringify({ accounts: {}, passkeys: {}, sessions: {}, signUpLinks: {}, deleted: {}, ...d }));
  let seen = { system: first.system.length, docker: first.docker.length };
  const step = (name, options = {}) => {
    fs.writeFileSync(path.join(requests, name), '');
    const done = installer(t, { again: first, dotenv: '', script: path.join(first.dir, 'bin', 'install.sh'), args: ['--requested'], ...options });
    assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
    assert.deepEqual(fs.readdirSync(requests), [], 'the request is taken');
    const since = { ...done, system: done.system.slice(seen.system), docker: done.docker.slice(seen.docker) };
    seen = { system: done.system.length, docker: done.docker.length };
    return since;
  };
  door({ accounts: { ann: {}, bob: {} } });
  step('bob');
  const home = path.join(first.dir, 'accounts', 'bob');
  assert.ok(fs.existsSync(path.join(home, 'compose.yaml')), 'bob is made');
  const upIn = (done, account) => done.docker.some((c) => c.host === `unix://${first.run}/${account}/docker.sock` && /^compose .* up -d/.test(c.call));
  return { first, door, step, home, upIn, started: path.join(first.top, 'started'), users: path.join(first.top, 'users') };
}

const status = (done, name) => { try { return JSON.parse(fs.readFileSync(path.join(done.dir, 'front-door', 'status', name), 'utf8')); } catch { return null; } };
// The stand-in Docker runs every compose service on IMAGE, as `docker ps` lists them; ACCOUNT's on OLD.
const running = (image, { account = '', old = '' } = {}) => [
  `[ "$1" = ps ] && [ "$2" = --format ] && { i='${image}'; case "\${DOCKER_HOST:-}" in *'/${account || '-'}/'*) i='${old}' ;; esac; for s in front-door bot-dot docker-helper; do echo "$s $i"; done; exit 0; }`,
];

module.exports = { ROOT, file, script, code, PIN, SIGNED, ANSWERED, SUB, tailscale, installer, rerun, KEPT_LAYER, roomAnswers, SELF, withBob, status, running };
