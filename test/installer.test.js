// install.sh (#466, ADR 028) on a stand-in machine: stand-ins for docker, the machine's tools (useradd, chown,
// setfacl, systemctl, su, tailscale, curl…) and the account's rootless Docker. Nothing is installed and nothing runs:
// each stand-in writes down what it was asked, and the tests read what the installer did and said.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
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
  stand('curl', `${said('curl')}\ncase "$*" in *https://*) exit ${caddy ? 0 : 7} ;; esac\nexit 0`);
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

// --- A first install ------------------------------------------------------------------------------

test('a first install asks how botdot is reached and the admin\'s name, and remembers both', (t) => {
  const done = installer(t, { dotenv: '', input: '1\nBotdot.Example.com\nann\n' });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  assert.match(done.said, /How will people reach botdot\?\n {2}1\) a public domain: HTTPS from Caddy, which fetches its own certificate \(ports 80 and 443 must be free\)\n {2}2\) a tailnet only: Tailscale Serve gives it an HTTPS name, and nothing is on the internet\n/);
  assert.match(done.said, /The domain botdot answers on \(its DNS must point at this machine\)/);
  assert.match(done.said, /Your own account's name, the admin's \(2 to 24 lowercase letters, digits and dashes, starting with a letter\)/);
  assert.equal(done.env.BOT_DOT_REACH, 'public');
  assert.equal(done.env.BOT_DOT_DOMAIN, 'botdot.example.com', 'in lowercase');
  assert.equal(done.env.FRONT_DOOR_ORIGIN, 'https://botdot.example.com');
  assert.equal(done.env.FRONT_DOOR_ADMIN, 'ann');

  const again = installer(t, { dotenv: fs.readFileSync(path.join(done.dir, 'front-door', '.env'), 'utf8') });
  assert.equal(again.status, 0, again.stderr);
  assert.doesNotMatch(again.said, /How will people reach|The domain botdot|account's name/, 'a rerun asks nothing again: a passkey belongs to one address');
});

test('the answers can be given beforehand, and a wrong one is asked again', (t) => {
  const given = installer(t, { dotenv: '', given: { BOT_DOT_REACH: 'public', BOT_DOT_DOMAIN: 'bots.example.org', BOT_DOT_ADMIN: 'bea' } });
  assert.equal(given.status, 0, given.stderr);
  assert.doesNotMatch(given.said, /How will people reach|The domain botdot|account's name/);
  assert.equal(given.env.FRONT_DOOR_ORIGIN, 'https://bots.example.org');
  assert.equal(given.env.FRONT_DOOR_ADMIN, 'bea');

  const wrong = installer(t, { dotenv: '', input: '3\n1\nnot a domain\nbots.example.org\nAnn Smith\na\nann\n' });
  assert.equal(wrong.status, 0, wrong.stderr);
  assert.equal(wrong.said.match(/How will people reach botdot\?/g).length, 2);
  assert.match(wrong.said, /not a domain isn't a domain name\./);
  assert.equal(wrong.said.match(/An account's name is 2 to 24 lowercase letters/g).length, 2, '"Ann Smith" and "a"');
  assert.equal(wrong.env.FRONT_DOOR_ADMIN, 'ann');

  const sudo = installer(t, { dotenv: '', input: '1\nbots.example.org\n\n', given: { SUDO_USER: 'Ann_Smith' } });
  assert.match(sudo.said, /letter\) \[ann-smith\]: /, 'the one who ran sudo is suggested');
  assert.equal(sudo.env.FRONT_DOOR_ADMIN, 'ann-smith');

  const none = installer(t, { dotenv: '', input: '' });
  assert.equal(none.status, 1);
  assert.match(none.stderr, /No answer, so nothing more was changed\./);
  assert.equal(none.docker.filter((c) => /^compose .* up/.test(c.call)).length, 0, 'nothing was started');
});

test('a public install puts Caddy in front of the front door, on the domain alone', (t) => {
  const done = rerun(t);
  assert.equal(done.env.COMPOSE_PROFILES, 'public', 'Caddy starts with the front door');
  assert.equal(done.read('front-door/Caddyfile'), '# botdot (install.sh): HTTPS for the front door on its public domain. Caddy fetches the certificate.\nbotdot.example.com {\n\treverse_proxy 127.0.0.1:4700\n\theader Strict-Transport-Security "max-age=31536000"\n}\n');
  assert.equal(done.read('front-door/compose.yaml'), fs.readFileSync(path.join(ROOT, 'compose.front-door.yaml'), 'utf8'), 'the front door\'s compose file, from the image');
  assert.ok(done.calls.includes(`compose --project-directory ${done.dir}/front-door up -d --remove-orphans`));
  assert.match(done.system, /^curl -fsSk -o \/dev\/null --resolve botdot\.example\.com:443:127\.0\.0\.1 https:\/\/botdot\.example\.com\/api\/version$/m);
  assert.match(done.said, /Caddy answers on https:\/\/botdot\.example\.com/);
  assert.doesNotMatch(done.system, /^tailscale/m, 'no Tailscale');

  const test = rerun(t, '', { BOT_DOT_TLS: 'internal' });
  assert.match(test.read('front-door/Caddyfile'), /botdot\.example\.com \{\n\ttls internal\n\treverse_proxy/, 'a test machine\'s own certificate authority');
  assert.equal(test.env.BOT_DOT_TLS, 'internal', 'kept for a rerun');

  const late = rerun(t, '', {}, { caddy: false });
  assert.match(late.said, /Caddy doesn't answer on https:\/\/botdot\.example\.com yet\. Point the domain's DNS at this machine and keep ports 80 and 443 open: it fetches the certificate by itself\./);
  assert.match(late.said, /\/sign-up\/T0KEN/, 'and the installer goes on to the link');
});

test('a tailnet install gives the front door its Tailscale name with Serve, and nothing on the internet', (t) => {
  const done = installer(t, { dotenv: '', input: '2\nann\n' });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  assert.equal(done.env.BOT_DOT_REACH, 'tailnet');
  assert.equal(done.env.FRONT_DOOR_ORIGIN, 'https://vm.example.ts.net');
  assert.equal(done.env.COMPOSE_PROFILES, '', 'no Caddy');
  assert.equal(done.read('front-door/Caddyfile'), '');
  assert.match(done.system, /^tailscale serve --bg 4700$/m, 'Serve passes the tailnet name\'s HTTPS to the front door on 127.0.0.1');
  assert.match(done.said, /Reachable on your tailnet only, at https:\/\/vm\.example\.ts\.net/);
  assert.match(done.said, /Done\. botdot is at https:\/\/vm\.example\.ts\.net/);

  const serve = 'Serve is not enabled on your tailnet. To enable, visit: https://login.tailscale.com/f/serve?node=n1';
  const failed = installer(t, { dotenv: '', input: '2\nann\n', bins: { tailscale: tailscale({ serve, exit: 1 }) } });
  assert.equal(failed.status, 1);
  assert.ok(failed.said.includes(serve), 'what tailscale serve said is on the screen');
  assert.match(failed.stderr, /Tailscale Serve didn't start \(its message is above\)\. Fix that and run this installer again\./);

  const without = installer(t, { dotenv: '', input: '2\nn\n', bins: { tailscale: null } });
  assert.equal(without.status, 1);
  assert.match(without.said, /botdot on a tailnet needs Tailscale\. Install it now\?/);
  assert.match(without.stderr, /botdot on a tailnet needs Tailscale \(https:\/\/tailscale\.com\/download\)/);
});

test('the front door runs as its own user, with the accounts\' socket folders and its data', (t) => {
  const done = rerun(t);
  assert.match(done.system, /^useradd --system --user-group --no-create-home --home-dir \/nonexistent --shell \/usr\/sbin\/nologin botdot-door$/m);
  assert.equal(done.env.FRONT_DOOR_USER, '990:990');
  assert.equal(done.env.BOT_DOT_SOCKETS, `${done.dir}/sockets`);
  assert.equal(done.env.COMPOSE_PROJECT_NAME, 'botdot');
  assert.match(done.system, new RegExp(`^chown 990:990 ${done.dir}/front-door/data$`, 'm'));
  assert.equal(fs.statSync(path.join(done.dir, 'front-door', 'data')).mode & 0o777, 0o700);
  assert.equal(fs.statSync(path.join(done.dir, 'front-door', '.env')).mode & 0o777, 0o600);
  assert.equal(done.env.FRONT_DOOR_ANDROID_KEYS, undefined, 'no Android app signs in until its keys are given');

  const keys = `${'AB:'.repeat(31)}AB`;
  const android = rerun(t, '', { FRONT_DOOR_ANDROID_KEYS: keys });
  assert.equal(android.env.FRONT_DOOR_ANDROID_KEYS, keys, 'the Android app\'s signing keys are kept for the front door');
  // An update from the admin page is given no keys: it keeps the ones given before (#82).
  const update = rerun(t, `FRONT_DOOR_ANDROID_KEYS=${keys}\n`, {}, { args: ['--update'] });
  assert.equal(update.env.FRONT_DOOR_ANDROID_KEYS, keys, 'an update keeps them');
  assert.match(fs.readFileSync(path.join(ROOT, 'compose.front-door.yaml'), 'utf8'), /FRONT_DOOR_ANDROID_KEYS: \$\{FRONT_DOOR_ANDROID_KEYS:-\}/);
});

test("the admin's account gets its own Linux user, rootless Docker under gVisor, and botdot server", (t) => {
  const done = rerun(t);
  const home = `${done.dir}/accounts/ann`;
  assert.match(done.system, new RegExp(`^useradd --no-create-home --home-dir ${home} --shell /usr/sbin/nologin --comment botdot account ann botdot-ann$`, 'm'));
  assert.match(done.system, new RegExp(`^chown 1002:1002 ${home}$`, 'm'), 'its home, its disk, is its own');
  assert.ok(done.system.indexOf(`mount -o loop ${done.dir}/disks/ann.img ${home}`) < done.system.indexOf('useradd --no-create-home'), 'its disk is its home before anything is in it');
  const daemon = JSON.parse(fs.readFileSync(path.join(home, '.config', 'docker', 'daemon.json'), 'utf8'));
  assert.equal(daemon['default-runtime'], 'runsc');
  assert.deepEqual(daemon.runtimes.runsc.runtimeArgs, ['--ignore-cgroups', '--net-raw', '--overlay2=none'],
    'the spike\'s flags (ADR 028), and a computer\'s files are written to its disk, so they outlive a stop (#68): no host sockets for a bot\'s computer (#72)');
  assert.deepEqual(daemon.runtimes['runsc-uds'], { path: daemon.runtimes.runsc.path, runtimeArgs: ['--ignore-cgroups', '--net-raw', '--overlay2=none', '--host-uds=all'] },
    'the server and the helper meet through Unix sockets in their mounts');
  const compose = fs.readFileSync(path.join(ROOT, 'compose.yaml'), 'utf8');
  for (const service of ['bot-dot', 'docker-helper']) {
    assert.match(compose, new RegExp(`\\n  ${service}:\\n(    .*\\n)*?    runtime: runsc-uds\\b`), service);
  }
  assert.deepEqual(daemon['exec-opts'], ['native.cgroupdriver=cgroupfs']);

  // Started by systemd as the account's own user.
  const unit = fs.readFileSync(path.join(done.etc, 'systemd', 'system', 'botdot-account@.service'), 'utf8');
  assert.match(unit, /^User=botdot-%i$/m);
  assert.match(unit, new RegExp(`^Environment=XDG_RUNTIME_DIR=${done.run}/%i$`, 'm'));
  assert.match(unit, /^ExecStart=.*\/dockerd-rootless\.sh$/m);
  assert.match(unit, /^Delegate=yes$/m);
  assert.match(unit, new RegExp(`^ExecStartPre=\\+/bin/sh -c '\\[ ! -f ${done.dir}/disks/%i\\.img \\] \\|\\| mountpoint -q ${done.dir}/accounts/%i \\|\\| mount -o loop ${done.dir}/disks/%i\\.img ${done.dir}/accounts/%i'$`, 'm'), 'it starts only on its disk, mounted by root');
  assert.match(done.system, /^systemctl enable botdot-account@ann$/m);
  assert.match(done.system, /^systemctl restart botdot-account@ann$/m, 'its Docker settings are new');

  // Its socket folder: botdot's server user of its containers owns it, the front door may only pass through.
  const folder = `${done.dir}/sockets/ann`;
  assert.match(done.system, new RegExp(`^chown ${SUB + 59999}:${SUB + 59999} ${folder}$`, 'm'));
  assert.equal(fs.statSync(folder).mode & 0o777, 0o700);
  assert.match(done.system, new RegExp(`^setfacl -m g:botdot-door:x,m::x ${folder}$`, 'm'));

  // Its botdot server, in its own Docker.
  assert.equal(done.read('accounts/ann/compose.yaml').trim(), fs.readFileSync(path.join(ROOT, 'compose.yaml'), 'utf8').trim());
  const env = done.accountEnv('ann');
  assert.equal(env.BOT_DOT_ACCOUNT, 'ann');
  assert.equal(env.BOT_DOT_FRONT_DOOR_FOLDER, folder);
  assert.equal(env.DOCKER_SOCKET, `${done.run}/ann/docker.sock`);
  assert.equal(env.TZ, 'UTC');
  assert.ok(done.accountCalls('ann').includes(`compose --project-directory ${home} up -d --remove-orphans`));
  assert.ok(!done.calls.some((c) => /^compose --project-directory .*accounts/.test(c)), 'never in the machine\'s Docker');
  assert.match(done.said, /The account ann is running/);
});

test("an account's Docker without a runtime the compose file names stops the installer before the server starts", (t) => {
  const done = installer(t, { runtimes: '' });
  assert.notEqual(done.status, 0);
  assert.match(done.stderr, /The account ann's Docker has no runsc-uds runtime, which this version's compose file needs\. Restart it \(systemctl restart botdot-account@ann\) and run this again\./);
  assert.ok(!done.accountCalls('ann').some((c) => / up\b/.test(c)), done.accountCalls('ann').join('\n'));
});

test('a rerun keeps its Docker running when nothing of its settings changed', (t) => {
  const first = rerun(t);
  const again = installer(t, { again: first });
  assert.equal(again.status, 0, again.stderr);
  const after = again.system.slice(first.system.length);
  assert.match(after, /^systemctl start botdot-account@ann$/m);
  assert.doesNotMatch(after, /^systemctl restart/m, 'its bots keep running');
  assert.doesNotMatch(after, /^useradd .*botdot-ann$/m, 'its user is there already');
  assert.match(first.system, /^chown \d+:\d+ \S+\/accounts\/ann\/data$/m, 'its data folder is the account\'s when it is made');
  assert.doesNotMatch(after, /\/accounts\/ann\/data$/m, 'and then the server\'s: its running server keeps writing it');
});

test('an installer older than the image stops before it changes an account, and says to take the newer one (#142)', (t) => {
  const first = rerun(t);
  const file = path.join(first.dir, 'accounts', 'ann', '.config', 'docker', 'daemon.json');
  const before = fs.readFileSync(file, 'utf8');
  // The image's compose names a runtime this installer doesn't set up in an account's Docker.
  const newer = `[ "$1" = run ] && [ "$8" = /opt/bot-dot/compose.yaml ] && { printf 'services:\\n  bot-dot:\\n    runtime: runsc-next\\n'; exit 0; }`;
  const again = installer(t, { again: first, dockerFirst: [newer] });
  assert.notEqual(again.status, 0);
  assert.match(again.stderr, /runtime runsc-next/);
  assert.match(again.stderr, /older than the image/);
  assert.equal(fs.readFileSync(file, 'utf8'), before, 'the account\'s Docker keeps its settings');
  const after = again.system.slice(first.system.length);
  assert.doesNotMatch(after, /^systemctl (restart|stop) botdot-account@ann$/m, 'its containers keep running');
  assert.ok(!again.accountCalls('ann').slice(first.accountCalls('ann').length).some((c) => /^compose .* up /.test(c)), 'nothing of the account is made again');
});

test('the runtimes compose.yaml names are the ones an account\'s Docker gets', () => {
  const named = [...fs.readFileSync(path.join(ROOT, 'compose.yaml'), 'utf8').matchAll(/^\s*runtime:\s*([\w.-]+)/gm)].map((m) => m[1]);
  assert.ok(named.length > 0);
  const known = /^RUNTIMES='([^']*)'/m.exec(script)[1].split(' ');
  for (const r of named) assert.ok(known.includes(r), r);
});

test('an account installed before computers kept their files gets --overlay2=none, and its Docker restarts with it (#68)', (t) => {
  const first = rerun(t);
  const file = path.join(first.dir, 'accounts', 'ann', '.config', 'docker', 'daemon.json');
  fs.writeFileSync(file, fs.readFileSync(file, 'utf8').replace(', "--overlay2=none"', ''));
  const again = installer(t, { again: first });
  assert.equal(again.status, 0, again.stderr);
  assert.ok(JSON.parse(fs.readFileSync(file, 'utf8')).runtimes.runsc.runtimeArgs.includes('--overlay2=none'));
  assert.match(again.system.slice(first.system.length), /^systemctl restart botdot-account@ann$/m, 'its computers keep their files from their next start');
});

test('without systemd the account\'s Docker is started now, as its own user, and the installer says it won\'t come back by itself', (t) => {
  const done = rerun(t, '', {}, { systemd: false });
  assert.match(done.system, /^su -s \/bin\/sh botdot-ann -c cd '.+\/accounts\/ann' && exec env HOME='.+\/accounts\/ann' XDG_RUNTIME_DIR='.+\/run\/ann' PATH=\S+ nohup '.+\/dockerd-rootless\.sh' >> '.+\/accounts\/ann\/docker\.log' 2>&1 &$/m);
  assert.doesNotMatch(done.system, /^systemctl (enable|start|restart)/m);
  assert.match(done.said, /This machine has no systemd, so the account ann's Docker was started now and doesn't start again after a restart\./);
});

test('the install prints the admin\'s sign-up link, after it says that root reaches every account', (t) => {
  const done = rerun(t);
  const root = done.said.indexOf('Whoever is root on this machine can reach every account on it: its data, its bots and the logins they hold. Keep root to yourself.');
  const link = done.said.indexOf('\n  https://botdot.example.com/sign-up/T0KEN\n');
  assert.ok(root > 0 && link > root, done.said);
  assert.ok(done.calls.includes(`compose --project-directory ${done.dir}/front-door exec -T front-door node front-door.js sign-up-link --account ann`));
  assert.match(done.said, /Done\. botdot is at https:\/\/botdot\.example\.com\u001b\[0m\nOpen this link to make your account, ann, the admin's \(it works once, for 7 days\):\n/);
  assert.match(done.said, /Until it is used, botdot shows only "Open the link from your server's install"\./);

  const made = rerun(t, '', {}, { exists: true });
  assert.doesNotMatch(made.said, /\/sign-up\/|Open this link/, 'once the account exists there is no link');
  assert.match(made.said, /Whoever is root on this machine can reach every account/, 'and the warning stays');
});

test('a machine without rootless Docker, gVisor or setfacl is offered them, and told what they are', (t) => {
  const missing = { 'dockerd-rootless.sh': null, runsc: null, setfacl: null };
  const declined = installer(t, { bins: missing, input: 'n\n' });
  assert.equal(declined.status, 1);
  assert.match(declined.said, /Each account runs in a rootless Docker under gVisor, which needs: docker-ce-rootless-extras acl runsc/);
  assert.match(declined.said, /Install them now with apt-get \(gVisor's runsc from gVisor's own repository\)\?/);
  assert.match(declined.stderr, /botdot needs them\. Install them and run this again\./);
  assert.doesNotMatch(declined.system, /apt-get/);

  const agreed = installer(t, { bins: { ...missing, dpkg: '#!/bin/sh\necho amd64\n' }, input: 'y\n' });
  assert.match(agreed.system, /^apt-get install -y -qq docker-ce-rootless-extras acl runsc$/m);
});

test('a botdot from before accounts is never updated: it is stopped only if asked, and its folder is left as it is', (t) => {
  const old = '/home/ann/bot-dot\n';
  const no = installer(t, { dotenv: '', old, input: 'n\n' });
  assert.equal(no.status, 1);
  assert.match(no.said, /botdot from before accounts is installed in \/home\/ann\/bot-dot\. This version can't update it: it is installed again, and you sign in with a passkey\. Its data folder stays as it is; delete it yourself once you're sure you don't need it\./);
  assert.match(no.stderr, /Nothing was changed\./);
  assert.deepEqual(no.calls.filter((c) => !c.startsWith('compose version') && !c.startsWith('version') && !c.startsWith('ps ') && !c.startsWith('info')), [], 'nothing else was done');

  const yes = installer(t, { dotenv: '', old, input: 'y\n1\nbotdot.example.com\nann\n' });
  assert.equal(yes.status, 0, yes.stderr);
  assert.ok(yes.calls.includes('compose --project-directory /home/ann/bot-dot stop'), 'stopped, not removed');
  assert.ok(!yes.docker.some((c) => c.call.includes('/home/ann/bot-dot') && !c.call.endsWith(' stop')), 'and nothing else of it is touched');
  assert.match(yes.said, /The old botdot is stopped\. Its data is still in its folder\./);

  const into = installer(t, { dotenv: '', old: '/srv/old-botdot\n', given: { BOT_DOT_DIR: '/srv/old-botdot' }, input: 'y\n' });
  assert.equal(into.status, 1);
  assert.match(into.stderr, /BOT_DOT_DIR is that old install's folder/);
});

test('the installer runs as root, and says so first', (t) => {
  const { status, stderr, docker } = installer(t, { bins: { id: '#!/bin/sh\necho 1000\n' } });
  assert.equal(status, 1);
  assert.match(stderr, /The installer makes a Linux user for each account, so it runs as root\. Run it with: sudo sh install\.sh/);
  assert.deepEqual(docker, []);
});

// --- The images: botdot's signed images, checked before any download (lib/signed-image.js) --------

const DOWNLOADS = /^pull -q ghcr\.io\//;

test('a rerun installs the newest signed images, into the machine\'s Docker and the account\'s, pinned by digest', (t) => {
  const done = rerun(t, `BOT_DOT_IMAGE=ghcr.io/kordal/bot-dot${PIN}\nBOT_DOT_COMPUTER_IMAGE=ghcr.io/kordal/bot-dot-desktop${PIN}\n`);
  assert.equal(done.env.BOT_DOT_IMAGE, `ghcr.io/kordal/bot-dot${SIGNED}`);
  assert.equal(done.env.BOT_DOT_COMPUTER_IMAGE, `ghcr.io/kordal/bot-dot-desktop${SIGNED}`);
  assert.equal(done.accountEnv('ann').BOT_DOT_IMAGE, `ghcr.io/kordal/bot-dot${SIGNED}`);
  assert.equal(done.accountEnv('ann').BOT_DOT_COMPUTER_IMAGE, `ghcr.io/kordal/bot-dot-desktop${SIGNED}`);
  assert.ok(done.calls.includes(`pull -q ghcr.io/kordal/bot-dot${SIGNED}`), 'the front door\'s');
  const own = done.accountCalls('ann');
  assert.ok(own.includes(`pull -q ghcr.io/kordal/bot-dot${SIGNED}`) && own.includes(`pull -q ghcr.io/kordal/bot-dot-desktop${SIGNED}`), own.join('\n'));
  assert.ok(!done.calls.includes(`pull -q ghcr.io/kordal/bot-dot-desktop${SIGNED}`), 'the computer only where it runs');
  assert.ok(!done.docker.some((c) => /^pull .*:latest$/.test(c.call)), 'never the tag, which may have moved since the check');
  const at = (call) => own.indexOf(call);
  assert.ok(at(`compose --project-directory ${done.dir}/accounts/ann up -d --remove-orphans`) > at(`pull -q ghcr.io/kordal/bot-dot-desktop${SIGNED}`));
  assert.ok(at(`compose --project-directory ${done.dir}/accounts/ann exec -T --user 60000:60000 bot-dot node /opt/bot-dot/lib/update-install.js --clean`) > at(`compose --project-directory ${done.dir}/accounts/ann up -d --remove-orphans`), 'the cleanup comes after the new containers');
  // The stand-in gives the cleanup no answer: one warning, and the installer ends as always.
  assert.match(done.said, /Couldn't remove every old image now; the next update tries again\./);
});

test('an update makes room first: the images no container uses go before the new ones are downloaded (#190)', (t) => {
  const was = `ghcr.io/kordal/bot-dot${PIN}`, desk = `ghcr.io/kordal/bot-dot-desktop${PIN}`;
  const first = rerun(t, `BOT_DOT_IMAGE=${was}\nBOT_DOT_COMPUTER_IMAGE=${desk}\n`);
  const done = installer(t, { again: first, dotenv: '', args: ['--update'] });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  const calls = done.docker.slice(first.docker.length);
  const at = (host, re) => calls.findIndex((c) => c.host === host && re.test(c.call));
  const cleanup = (sock) => new RegExp(`^run --rm --pull never --network none --user 0:0 -v ${sock}:/var/run/docker\\.sock --entrypoint node \\S+ /opt/bot-dot/lib/image-cleanup\\.js `);
  const own = `unix://${done.run}/ann/docker.sock`;
  // The account's Docker: by the new version's rule, keeping what the account runs now and what is about to come.
  const inAccount = at('machine', cleanup(`${done.run}/ann/docker\\.sock`));
  assert.ok(inAccount >= 0, calls.map((c) => c.call).join('\n'));
  assert.ok(inAccount < at(own, new RegExp(`^pull -q ghcr\\.io/kordal/bot-dot@`)), 'before the account\'s download');
  const args = calls[inAccount].call.split(' ');
  assert.equal(args[12], `ghcr.io/kordal/bot-dot${SIGNED}`, 'run from the new version, already in the machine\'s Docker');
  assert.deepEqual(args.slice(14), [`ghcr.io/kordal/bot-dot${SIGNED}`, `ghcr.io/kordal/bot-dot-desktop${SIGNED}`, `ghcr.io/kordal/bot-dot${SIGNED}`, `ghcr.io/kordal/bot-dot-desktop${SIGNED}`]);
  // The machine's Docker: by the rule of the version it runs now, before the front door's download.
  const inMachine = at('machine', cleanup('/var/run/docker\\.sock'));
  assert.ok(inMachine >= 0 && inMachine < at('machine', /^pull -q ghcr\.io\/kordal\/bot-dot@/), 'before the machine\'s download');
  const machine = calls[inMachine].call.split(' ');
  assert.equal(machine[12], first.env.BOT_DOT_IMAGE, 'run from what the machine runs now');
  assert.deepEqual(machine.slice(14), [first.env.BOT_DOT_IMAGE, first.env.BOT_DOT_COMPUTER_IMAGE]);
  // The stand-in's cleanup answers nothing: a warning, and the update goes on.
  assert.match(done.said, /Couldn't remove the old images first; the download goes on\./);
});

test('a first install has nothing to make room for in the machine\'s Docker', (t) => {
  const fresh = installer(t, { dotenv: '', input: '1\nbotdot.example.com\nann\n' });
  assert.equal(fresh.status, 0, fresh.stderr);
  const download = fresh.calls.findIndex((c) => c.startsWith('pull -q ghcr.io/kordal/bot-dot@'));
  const cleanup = fresh.calls.findIndex((c) => c.includes('-v /var/run/docker.sock:/var/run/docker.sock') && c.includes('image-cleanup.js'));
  assert.ok(download >= 0);
  assert.ok(cleanup === -1 || cleanup > download, 'nothing runs before the first download');
});

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
  const server = `ghcr.io/kordal/bot-dot${SIGNED}`;
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

test('a computer image that could not be downloaded now is downloaded by botdot later', (t) => {
  const { said, accountEnv } = rerun(t, '', {}, { failPull: `ghcr.io/kordal/bot-dot-desktop${SIGNED}` });
  assert.match(said, /Couldn't download the bots' computer now; botdot tries again when a bot needs it\./);
  assert.equal(accountEnv('ann').BOT_DOT_COMPUTER_IMAGE, `ghcr.io/kordal/bot-dot-desktop${SIGNED}`);
});

test('the image it is given is installed as its repository\'s signed release, as the updater does', (t) => {
  const mine = `ghcr.io/kordal/bot-dot@sha256:${'b'.repeat(64)}`;
  const { env, checks } = rerun(t, `BOT_DOT_IMAGE=ghcr.io/kordal/bot-dot${PIN}\n`, { BOT_DOT_IMAGE: mine });
  assert.equal(checks[0].at(-2), mine);
  assert.equal(env.BOT_DOT_IMAGE, `ghcr.io/kordal/bot-dot${SIGNED}`);
});

test('compose starts what .env names, not the names the installer was given', () => {
  const unset = code.indexOf('unset BOT_DOT_IMAGE BOT_DOT_COMPUTER_IMAGE');
  assert.ok(unset > code.lastIndexOf('set_env "$ENV" BOT_DOT_COMPUTER_IMAGE') && unset < code.indexOf('up -d --remove-orphans'), 'after .env has them, before compose reads them');
});

test('both images\' signatures are checked before anything of botdot\'s is downloaded', (t) => {
  const { docker, checks } = rerun(t);
  assert.deepEqual(checks.map((args) => args.slice(-2)), [['ghcr.io/kordal/bot-dot:latest', 'server'], ['ghcr.io/kordal/bot-dot-desktop:latest', 'desktop']]);
  const lastCheck = docker.reduce((last, c, i) => (c.call.includes('/check/lib/signed-image.js') ? i : last), -1);
  assert.ok(docker.findIndex((c) => DOWNLOADS.test(c.call)) > lastCheck, docker.map((c) => c.call).join('\n'));
});

test('the check is the source\'s own, on the Node of botdot\'s image, as nobody, with nothing to write', (t) => {
  const args = rerun(t).checks[0].join(' ');
  const node = fs.readFileSync(path.join(ROOT, 'Dockerfile'), 'utf8').match(/^ARG NODE_IMAGE=(.+)$/m)[1];
  assert.ok(args.startsWith('run --rm -i '), args);
  assert.ok(args.includes(` -v ${ROOT}/lib:/check/lib:ro `), `the source next to the installer: ${args}`);
  assert.ok(args.includes(` ${node} node /check/lib/signed-image.js `), `the Dockerfile's Node, pinned by its digest: ${args}`);
  for (const flag of ['--pull never', '--network host', '--read-only', '--cap-drop ALL', '--security-opt no-new-privileges', '--user 65534:65534']) assert.ok(args.includes(` ${flag} `), flag);
});

test('an unsigned image stops the installer before any download, with a sentence that says why', (t) => {
  const { said, stderr, docker, env } = rerun(t, '', {}, { signed: { 'ghcr.io/kordal/bot-dot:latest': 'it has no botdot signature' }, refuse: true });
  assert.match(stderr, /Refused ghcr\.io\/kordal\/bot-dot:latest: it has no botdot signature\. Nothing was downloaded or started\./);
  assert.ok(!docker.some((c) => DOWNLOADS.test(c.call) || /^compose .*(up|exec)/.test(c.call)), docker.map((c) => c.call).join('\n'));
  assert.doesNotMatch(said, /up to date|running/);
  assert.equal(env.BOT_DOT_IMAGE, undefined);
});

test('a computer image signed with another key stops the installer before the server is downloaded too', (t) => {
  const { stderr, docker } = rerun(t, '', {}, { signed: { 'ghcr.io/kordal/bot-dot-desktop:latest': "it is signed, but not with botdot's release key" }, refuse: true });
  assert.match(stderr, /Refused ghcr\.io\/kordal\/bot-dot-desktop:latest: it is signed, but not with botdot's release key\. Nothing was downloaded or started\./);
  assert.ok(!docker.some((c) => DOWNLOADS.test(c.call) || /^compose .*(up|exec)/.test(c.call)));
});

test('the registry token goes to the check on its input, never on its command line', (t) => {
  const { checks, docker, accountEnv } = rerun(t, 'BOT_DOT_REGISTRY_TOKEN=ghp_stored\n', {}, { answers: { private: '', 'good-token': 'ghp_stored' } });
  assert.equal(checks.length, 2);
  assert.ok(!docker.some((c) => c.call.includes('ghp_stored')));
  assert.equal(accountEnv('ann').BOT_DOT_REGISTRY_TOKEN, 'ghp_stored', 'the account\'s botdot downloads newer computers with it');
});

test('a stored token the registry refuses ends the installer before any download', (t) => {
  const { stderr, docker } = rerun(t, 'BOT_DOT_REGISTRY_TOKEN=ghp_old\n', {}, { answers: { private: '', 'good-token': 'ghp_new' }, refuse: true });
  assert.match(stderr, /That token didn't work for ghcr\.io\. Check that it has the read:packages scope\./);
  assert.ok(!docker.some((c) => DOWNLOADS.test(c.call)));
});

test('without botdot\'s source next to it, the installer says where to get it and downloads nothing', (t) => {
  const alone = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-installer-'));
  t.after(() => fs.rmSync(alone, { recursive: true, force: true }));
  fs.copyFileSync(file, path.join(alone, 'install.sh'));
  const { stderr, docker } = rerun(t, '', {}, { script: path.join(alone, 'install.sh'), refuse: true });
  assert.match(stderr, /checks the signature of botdot's images with botdot's source/);
  assert.ok(!docker.some((c) => c.call.startsWith('pull') || c.call.startsWith('run')));
});

// A self-built botdot server (CONTEXT.md): images named without a registry, built with `make images`.
const SELF = { BOT_DOT_IMAGE: 'bot-dot/server:latest', BOT_DOT_COMPUTER_IMAGE: 'bot-dot/desktop:latest' };
const touchesRegistry = (docker) => docker.filter((c) => /^(pull|login|push)\b/.test(c.call));

test('a self-built install asks for no token, downloads nothing, and hands both images to the account', (t) => {
  const { env, docker, said, accountCalls, accountEnv } = rerun(t, '', SELF);
  assert.deepEqual(touchesRegistry(docker), []);
  assert.doesNotMatch(said, /Token:|private|Downloading/);
  assert.match(said, /Using the local image bot-dot\/server:latest/);
  assert.match(said, /Using the local image bot-dot\/desktop:latest for the bots' computer/);
  assert.equal(env.BOT_DOT_IMAGE, 'bot-dot/server:latest');
  assert.equal(accountEnv('ann').BOT_DOT_IMAGE, 'bot-dot/server:latest');
  assert.equal(accountEnv('ann').BOT_DOT_COMPUTER_IMAGE, 'bot-dot/desktop:latest');
  assert.equal(env.BOT_DOT_REGISTRY_TOKEN, undefined);
  assert.ok(docker.some((c) => c.host === 'machine' && c.call === 'save bot-dot/server:latest'));
  assert.ok(docker.some((c) => c.host === 'machine' && c.call === 'save bot-dot/desktop:latest'));
  assert.equal(accountCalls('ann').filter((c) => c === 'load -q').length, 2);
});

test('a rerun after a rebuild keeps the self-built images, and still downloads nothing', (t) => {
  const { env, docker } = rerun(t, 'BOT_DOT_IMAGE=bot-dot/server:latest\nBOT_DOT_COMPUTER_IMAGE=bot-dot/desktop:latest\n');
  assert.deepEqual(touchesRegistry(docker), []);
  assert.equal(env.BOT_DOT_IMAGE, 'bot-dot/server:latest');
  assert.equal(env.BOT_DOT_COMPUTER_IMAGE, 'bot-dot/desktop:latest');
});

test('naming botdot\'s images goes back from self-built to them', (t) => {
  const { env, calls } = rerun(t, 'BOT_DOT_IMAGE=bot-dot/server:latest\nBOT_DOT_COMPUTER_IMAGE=bot-dot/desktop:latest\n', { BOT_DOT_IMAGE: 'ghcr.io/kordal/bot-dot:latest' });
  assert.ok(calls.includes(`pull -q ghcr.io/kordal/bot-dot${SIGNED}`));
  assert.equal(env.BOT_DOT_IMAGE, `ghcr.io/kordal/bot-dot${SIGNED}`);
  assert.equal(env.BOT_DOT_COMPUTER_IMAGE, `ghcr.io/kordal/bot-dot-desktop${SIGNED}`);
});

// --- What the installer tells a stranger, and what it leaves to botdot ------------------------------

test('a missing curl is said at the start, before anything is installed', (t) => {
  const { status, stderr, docker } = installer(t, { bins: { curl: null }, onlyStandIns: true });
  assert.equal(status, 1);
  assert.match(stderr, /The installer needs curl\./);
  assert.deepEqual(docker, [], 'Docker is not even asked');
});

test('a missing docker compose names the package for each Docker', (t) => {
  const { status, stderr } = installer(t, { noCompose: true });
  assert.equal(status, 1);
  assert.match(stderr, /Docker Compose \(docker compose\) is missing\. Install the package for your Docker and run this again:/);
  assert.match(stderr, /Docker's own packages \(docker-ce, from Docker's repository\): docker-compose-plugin/);
  assert.match(stderr, /Ubuntu's docker\.io: docker-compose-v2/);
  assert.match(stderr, /Debian's docker\.io: docker-compose on Debian 13\. Debian 12 has none/);
  const fine = rerun(t);
  assert.doesNotMatch(fine.said + fine.stderr, /Compose/, 'and nothing when it is there');
});

test('the installer removes no image of botdot by name: botdot decides which old ones go', () => {
  // The one removal: in an account's Docker of a self-built install, the images a newer build left without a name,
  // each by its id and never forced (lib/image-cleanup.js knows only the signed images).
  const removals = code.split('\n').filter((l) => /\bimage\s+(rm|prune)\b|\brmi\b|\bprune\b/.test(l)).map((l) => l.trim());
  assert.deepEqual(removals, ['case "$was" in sha256:*) $A image rm "$was" </dev/null >/dev/null 2>&1 || true ;; esac']);
  assert.match(code, /for was in \$\(\$A image ls -q --no-trunc --filter dangling=true/);
});

// The sentence is made by the image's own Node, as install.sh's json() does it.
function sentence(result) {
  const expression = script.match(/CLEANED="\$\(printf '%s' "\$CLEANED" \| json '(.+)' \|\| true\)"/)[1];
  const program = `let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{const j=JSON.parse(s);process.stdout.write(String((${expression})??''))}catch{}})`;
  return execFileSync(process.execPath, ['-e', program], { input: result, encoding: 'utf8' });
}

test('the cleanup line says how many images went and how much space came back, or warns', () => {
  assert.equal(sentence('{"removed":3,"skipped":1,"failed":0,"bytes":4200000000}'), 'Removed 3 old images (4.2 GB freed)');
  assert.equal(sentence('{"removed":1,"skipped":0,"failed":0,"bytes":90000000}'), 'Removed 1 old image (0.1 GB freed)');
  assert.equal(sentence('{"removed":2,"skipped":0,"failed":0,"bytes":2000002}'), 'Removed 2 old images (2 MB freed)');
  assert.equal(sentence('{"removed":1,"skipped":0,"failed":0,"bytes":0}'), 'Removed 1 old image', 'Docker did not tell the size');
  assert.equal(sentence('{"removed":0,"skipped":2,"failed":0,"bytes":0}'), 'No old images to remove');
  assert.equal(sentence('{"removed":2,"skipped":0,"failed":1,"bytes":10}'), '');
  assert.equal(sentence(''), '');
  assert.equal(sentence('not json'), '');
});

// A function of install.sh, run on its own in sh.
function shell(name, args = [], env = {}) {
  const body = script.match(new RegExp(`^${name}\\(\\) \\{\\n[^]*?\\n\\}$`, 'm'));
  assert.ok(body, `install.sh has the function ${name}`);
  return execFileSync('/bin/sh', ['-c', `${body[0]}\n${name} "$@"`, name, ...args], { encoding: 'utf8', env: { PATH: '/usr/bin:/bin', ...env } }).trim();
}
// A folder of files; a text that starts with -> is a symbolic link to the rest.
function folder(t, files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-etc-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) {
    if (text.startsWith('->')) fs.symlinkSync(text.slice(2), path.join(dir, name));
    else fs.writeFileSync(path.join(dir, name), text, { mode: text.startsWith('#!') ? 0o755 : 0o644 });
  }
  return dir;
}

test('botdot takes the machine\'s time zone, or UTC when it has none', (t) => {
  const chicago = folder(t, { timedatectl: '#!/bin/sh\necho America/Chicago\n' });
  const none = folder(t, { timedatectl: '#!/bin/sh\nexit 1\n' });
  const zone = (etc, bin = none) => shell('host_time_zone', [etc], { PATH: `${bin}:/usr/bin:/bin` });
  assert.equal(zone(folder(t, { timezone: 'Asia/Tokyo\n' }), chicago), 'America/Chicago', 'timedatectl first, where there is one');
  assert.equal(zone(folder(t, { timezone: 'Asia/Tokyo\n' })), 'Asia/Tokyo');
  assert.equal(zone(folder(t, { localtime: '->/usr/share/zoneinfo/Europe/Lisbon' })), 'Europe/Lisbon');
  assert.equal(zone(folder(t, { localtime: '->../usr/share/zoneinfo/Etc/GMT+5' })), 'Etc/GMT+5');
  assert.equal(zone(folder(t, {})), 'UTC', 'none at all');
  assert.equal(zone(folder(t, { localtime: '->/opt/clock/here' })), 'UTC', 'a link that names no zone');
  assert.equal(zone(folder(t, { timezone: 'not a zone\n' })), 'UTC');

  const { env, said, accountEnv } = installer(t, { dotenv: ANSWERED.replace('TZ=UTC\n', ''), bins: { timedatectl: '#!/bin/sh\necho America/Chicago\n' } });
  assert.equal(env.TZ, 'America/Chicago');
  assert.equal(accountEnv('ann').TZ, 'America/Chicago', 'the account\'s botdot server gets it');
  assert.match(said, /Time zone America\/Chicago/);
  assert.equal(rerun(t, '', {}, { bins: { timedatectl: '#!/bin/sh\necho America/Chicago\n' } }).env.TZ, 'UTC', 'a time zone in .env stays');
});

test('compose gives the server, the helper and the front door the time zone of .env, or UTC', () => {
  for (const [name, services] of [['compose.yaml', ['bot-dot', 'docker-helper']], ['compose.mac.yaml', ['bot-dot', 'docker-helper']], ['compose.front-door.yaml', ['front-door']]]) {
    const compose = fs.readFileSync(path.join(ROOT, name), 'utf8');
    for (const service of services) {
      const block = compose.slice(compose.indexOf(`\n  ${service}:\n`) + 1).split(/\n {2}(?=\S)/)[0];
      assert.match(block, /\n {6}TZ: \$\{TZ:-UTC\}/, `${name}: ${service}`);
    }
  }
});

test('an account\'s botdot server keeps a network of its own, and its helper the account\'s Docker', () => {
  const compose = fs.readFileSync(path.join(ROOT, 'compose.yaml'), 'utf8');
  // The account's Docker's default network, never the machine's (ADR 028): under gVisor only there do names resolve.
  assert.deepEqual(compose.match(/^ {4}network_mode: \S+/gm), ['    network_mode: bridge', '    network_mode: bridge']);
  assert.doesNotMatch(compose, /network_mode: host|^networks:/m);
  assert.match(compose, /- \$\{DOCKER_SOCKET:-\/var\/run\/docker\.sock\}:\/var\/run\/docker\.sock/);
  assert.match(compose, /- \$\{BOT_DOT_FRONT_DOOR_FOLDER:-\.\/front-door\}:\/run\/front-door/);
  assert.match(compose, /BOT_DOT_FRONT_DOOR_SOCKET: \/run\/front-door\/botdot\.sock/);
  for (const name of ['compose.yaml', 'compose.mac.yaml', 'compose.front-door.yaml', 'install.sh', 'README.md', 'docs/install-linux.md']) {
    assert.doesNotMatch(fs.readFileSync(path.join(ROOT, name), 'utf8'), /BOT_DOT_ALLOWED_USERS/, `${name}: the variable does nothing since the front door`);
  }
});

// --- New accounts from sign-up links (#467) -----------------------------------------------------------

test('the front door asks for new accounts in a folder of its own, and root\'s step is a copy of the installer that systemd starts', (t) => {
  const done = rerun(t);
  const requests = `${done.dir}/front-door/requests`;
  assert.match(done.system, new RegExp(`^chown 0:990 ${requests}$`, 'm'), 'root owns it, the front door\'s group may write in it');
  assert.equal(fs.statSync(requests).mode & 0o777, 0o770);
  const compose = fs.readFileSync(path.join(ROOT, 'compose.front-door.yaml'), 'utf8');
  assert.match(compose, /^ {6}- \.\/requests:\/requests /m);
  assert.match(compose, /^ {6}FRONT_DOOR_REQUESTS: \/requests$/m);

  // Root's copy of the installer, which only root can change.
  const bin = `${done.dir}/bin`;
  assert.equal(fs.readFileSync(`${bin}/install.sh`, 'utf8'), script);
  assert.equal(fs.statSync(bin).mode & 0o777, 0o700);
  assert.equal(fs.statSync(`${bin}/install.sh`).mode & 0o777, 0o600);
  assert.match(done.system, new RegExp(`^chown 0:0 ${bin}$`, 'm'));

  const unit = (name) => fs.readFileSync(path.join(done.etc, 'systemd', 'system', name), 'utf8');
  assert.match(unit('botdot-accounts.path'), new RegExp(`^DirectoryNotEmpty=${requests}$`, 'm'));
  assert.match(unit('botdot-accounts.service'), /^Type=oneshot$/m);
  assert.match(unit('botdot-accounts.service'), new RegExp(`^ExecStart=/bin/sh ${bin}/install.sh --requested$`, 'm'), 'one fixed command, nothing from the front door on it');
  assert.doesNotMatch(unit('botdot-accounts.service'), /^User=/m, 'root');
  assert.match(unit('botdot-accounts.service'), new RegExp(`^Environment=BOT_DOT_DIR=${done.dir} BOT_DOT_RUN=${done.run} BOT_DOT_ETC=${done.etc}$`, 'm'), 'the folders this install has');
  assert.match(done.system, /^systemctl enable --now botdot-accounts\.path$/m);
  assert.match(done.said, /Make sign-up links for other people on the admin page: https:\/\/botdot\.example\.com\/admin/);
});

test('without systemd a loop started now takes the requests, and the installer says it won\'t come back by itself', async (t) => {
  const done = rerun(t, '', {}, { systemd: false });
  // Started in the background: the stand-in writes it down a moment after the installer ends.
  const log = path.join(done.top, 'system.log');
  for (let i = 0; i < 50 && !/^nohup /m.test(fs.readFileSync(log, 'utf8')); i++) await new Promise((r) => setTimeout(r, 100));
  assert.match(fs.readFileSync(log, 'utf8'), /^nohup sh -c i=0; while :; do \[ -z "\$\(ls -A '.+\/front-door\/requests' 2>\/dev\/null\)" \] \|\| BOT_DOT_DIR='.+' BOT_DOT_RUN='.+' BOT_DOT_ETC='.+' sh '.+\/bin\/install\.sh' --requested; \[ \$\(\(i % 20\)\) != 0 \] \|\| BOT_DOT_DIR='.+' BOT_DOT_RUN='.+' BOT_DOT_ETC='.+' sh '.+\/bin\/install\.sh' --load; i=\$\(\(i \+ 1\)\); sleep 3; done$/m, 'and every minute measures the load');
  assert.match(done.said, /This machine has no systemd, so the accounts sign-up links make are made by a loop started now, which doesn't start again after a restart\./);
});

test("root's step makes each account the front door made and asked for, as the install made the admin's, and nothing else", (t) => {
  const first = rerun(t);
  const requests = path.join(first.dir, 'front-door', 'requests');
  fs.writeFileSync(path.join(first.dir, 'front-door', 'data', 'front-door.json'), JSON.stringify({ accounts: { ann: {}, bob: {} }, passkeys: {}, sessions: {}, signUpLinks: {} }));
  for (const name of ['bob', 'carl', 'ann', 'Bad Name', '.hidden', '..dots', 'dan\nab']) fs.writeFileSync(path.join(requests, name), '');
  fs.mkdirSync(path.join(requests, 'eve'));
  const before = { system: first.system.length, docker: first.docker.length };

  const done = installer(t, { again: first, dotenv: '', script: path.join(first.dir, 'bin', 'install.sh'), args: ['--requested'] });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  assert.deepEqual(fs.readdirSync(requests), [], 'every request is taken');
  const system = done.system.slice(before.system);
  const docker = done.docker.slice(before.docker);

  // bob: made as the admin's account was.
  const home = `${done.dir}/accounts/bob`;
  assert.match(system, new RegExp(`^useradd --no-create-home --home-dir ${home} --shell /usr/sbin/nologin --comment botdot account bob botdot-bob$`, 'm'));
  assert.match(system, /^systemctl enable botdot-account@bob$/m);
  assert.match(system, new RegExp(`^setfacl -m g:botdot-door:x,m::x ${done.dir}/sockets/bob$`, 'm'));
  assert.equal(JSON.parse(fs.readFileSync(path.join(home, '.config', 'docker', 'daemon.json'), 'utf8'))['default-runtime'], 'runsc');
  const env = done.accountEnv('bob');
  assert.equal(env.BOT_DOT_ACCOUNT, 'bob');
  assert.equal(env.DOCKER_SOCKET, `${done.run}/bob/docker.sock`);
  assert.equal(env.BOT_DOT_IMAGE, first.accountEnv('ann').BOT_DOT_IMAGE, 'the images the install pinned');
  assert.equal(env.BOT_DOT_COMPUTER_IMAGE, first.accountEnv('ann').BOT_DOT_COMPUTER_IMAGE);
  assert.ok(docker.some((c) => c.host === `unix://${done.run}/bob/docker.sock` && c.call === `compose --project-directory ${home} up -d --remove-orphans`));
  assert.match(done.said, /Making the account bob, which a sign-up link made at the front door/);
  assert.match(done.said, /The account bob is running/);

  // Nothing else: no account the front door doesn't have, no name that isn't one, nothing made twice.
  assert.doesNotMatch(system, /useradd .*botdot-(carl|ann|dan|eve)/);
  assert.match(done.said, /Not an account's name, so nothing was done: danab/, 'a name of two lines is no name');
  assert.match(done.said, /The front door has no account carl, so nothing was done\./);
  assert.match(done.said, /Not an account's name, so nothing was done: BadName/);
  assert.match(done.said, /The account ann is made already/);
  assert.ok(!docker.some((c) => c.host === `unix://${done.run}/ann/docker.sock` && /^compose .* up/.test(c.call)), "ann's botdot server is left as it is");
  // And nothing of the machine: no package, no front door, no Caddy or Tailscale, no unit, no link.
  assert.doesNotMatch(system, /^(apt-get|apparmor_parser|tailscale|systemctl daemon-reload|useradd --system)/m);
  assert.ok(!docker.some((c) => c.host === 'machine' && /^compose --project-directory/.test(c.call)), JSON.stringify(docker));
  assert.doesNotMatch(done.said, /botdot installer|\/sign-up\//);
});

// --- Suspend, resume and delete from the admin page (#470) -------------------------------------------

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

test("root's step stops a suspended account's Docker, and with it all it runs, and keeps its data and user", (t) => {
  const { door, step, home, upIn, users } = withBob(t);
  fs.writeFileSync(path.join(home, 'data', 'bots.json'), '[]');
  door({ accounts: { ann: {}, bob: { suspended: '2026-10-16T12:00:00.000Z' } } });
  const done = step('bob');
  assert.match(done.system, /^systemctl disable --now botdot-account@bob$/m, "its Docker stops, and doesn't start with the machine");
  assert.ok(!upIn(done, 'bob'), 'nothing of it is started');
  assert.match(done.said, /The account bob is suspended: it is stopped, and its data kept/);
  assert.ok(fs.existsSync(path.join(home, 'data', 'bots.json')), 'its data stays');
  assert.match(fs.readFileSync(users, 'utf8'), /^botdot-bob:/m, 'its Linux user stays');
  assert.doesNotMatch(done.system, /^(userdel|useradd)/m);
});

test("root's step starts a resumed account again as it was, and leaves a running one as it is", (t) => {
  const { door, step, upIn, started } = withBob(t);
  door({ accounts: { ann: {}, bob: {} } });
  const running = step('bob');
  assert.match(running.said, /The account bob is made already, and runs/);
  assert.ok(!upIn(running, 'bob'));

  fs.rmSync(started); // suspended: its Docker doesn't answer
  const done = step('bob');
  assert.match(done.said, /Starting the account bob again, which the admin resumed/);
  assert.match(done.system, /^systemctl enable botdot-account@bob$/m);
  assert.match(done.system, /^systemctl (re)?start botdot-account@bob$/m);
  assert.ok(upIn(done, 'bob'), 'its botdot server starts');
  assert.doesNotMatch(done.system, /^useradd/m, 'the same user, made once');
  assert.doesNotMatch(done.system, /\/accounts\/bob\/data$/m, 'the data folder its restarted server owns stays its');
  assert.match(done.said, /The account bob is running/);
});

test("root's step reads the front door again when it is done, so the admin's resume meanwhile isn't lost", (t) => {
  const { first, door, step, upIn, started } = withBob(t);
  door({ accounts: { ann: {}, bob: { suspended: '2026-10-16T12:00:00.000Z' } } });
  // While bob's Docker stops, the admin resumes bob: the front door's data says so, and its request found this one.
  const data = path.join(first.dir, 'front-door', 'data', 'front-door.json');
  const resumed = JSON.stringify({ accounts: { ann: {}, bob: {} }, passkeys: {}, sessions: {}, signUpLinks: {}, deleted: {} });
  const systemctl = ['#!/bin/sh', 'echo "systemctl $*" >> "$STAND_IN_LOG"', '[ "$1" = show ] && exit 0',
    `[ "$1" = disable ] && { rm -f "${started}"; printf '%s' '${resumed}' > "${data}"; }`,
    `case "$1" in start|restart) touch "${started}" ;; esac`, 'exit 0', ''].join('\n');
  const done = step('bob', { bins: { systemctl } });
  assert.match(done.said, /The account bob is suspended: it is stopped/);
  assert.match(done.said, /Starting the account bob again, which the admin resumed/);
  assert.ok(upIn(done, 'bob'), 'bob runs again');
});

test("root's step keeps a request made while it read the front door once more, and the next run takes it", (t) => {
  const { first, door, step, upIn, started } = withBob(t);
  door({ accounts: { ann: {}, bob: { suspended: '2026-10-16T12:00:00.000Z' } } });
  const requests = path.join(first.dir, 'front-door', 'requests');
  const data = path.join(first.dir, 'front-door', 'data', 'front-door.json');
  const resumed = JSON.stringify({ accounts: { ann: {}, bob: {} }, passkeys: {}, sessions: {}, signUpLinks: {}, deleted: {} });
  fs.writeFileSync(path.join(requests, 'bob'), '');
  // The front door's data is read once more after bob is stopped: while it is read (the file it reads is the one from
  // before), the admin resumes bob, and the front door asks again.
  const resumes = [
    `if [ "$1" = run ] && [ "$5" = node ] && [ "$7" = -e ] && [ ! -e "${requests}/bob" ] && [ ! -e "${first.top}/resumed" ]; then`,
    `  touch "${first.top}/resumed"; printf '%s' '${resumed}' > "${data}.new"; mv "${data}.new" "${data}"; touch "${requests}/bob"`,
    'fi',
  ];
  const suspended = installer(t, { again: first, dotenv: '', script: path.join(first.dir, 'bin', 'install.sh'), args: ["--requested"], dockerFirst: resumes });
  assert.equal(suspended.status, 0, `${suspended.said}\n${suspended.stderr}`);
  assert.match(suspended.said, /The account bob is suspended: it is stopped/);
  assert.ok(fs.existsSync(path.join(requests, 'bob')), 'the new request stays');
  fs.rmSync(started, { force: true });
  const done = step('bob');
  assert.match(done.said, /Starting the account bob again, which the admin resumed/);
  assert.ok(upIn(done, 'bob'), 'bob runs again');
});

test("root's step erases a deleted account: its Docker, data, socket folder, Linux user and sub-IDs", (t) => {
  const { first, door, step, home, users } = withBob(t);
  fs.mkdirSync(path.join(first.run, 'bob'), { recursive: true });
  door({ accounts: { ann: {} }, deleted: { bob: '2026-10-16T12:00:00.000Z' } });
  const done = step('bob');
  assert.match(done.system, /^systemctl disable --now botdot-account@bob$/m);
  assert.match(done.system, /^userdel botdot-bob$/m);
  assert.ok(fs.existsSync(path.join(first.dir, 'disks', 'bob.img')) === false, 'its disk is gone');
  assert.ok(fs.existsSync(path.join(first.dir, 'disks', 'ann.img')), "ann's stays");
  for (const gone of [home, path.join(first.dir, 'sockets', 'bob'), path.join(first.run, 'bob')]) assert.ok(!fs.existsSync(gone), `${gone} is gone`);
  for (const map of ['subuid', 'subgid']) {
    const ids = fs.readFileSync(path.join(first.etc, map), 'utf8');
    assert.doesNotMatch(ids, /^botdot-bob:/m, `${map} has nothing of bob`);
    assert.match(ids, /^botdot-ann:/m, "ann's stay");
  }
  assert.doesNotMatch(fs.readFileSync(users, 'utf8'), /^botdot-bob:/m);
  assert.match(done.said, /The account bob is erased: its data, containers and Linux user/);
  assert.ok(fs.existsSync(path.join(first.dir, 'accounts', 'ann', 'compose.yaml')), "ann's account is untouched");

  const again = step('bob');
  assert.match(again.said, /The account bob is deleted, and nothing of it is on this machine/);
  assert.doesNotMatch(again.system, /^userdel/m);
});

test("root's step erases nothing the front door doesn't say it deleted, and never the admin's account", (t) => {
  const { first, door, step, home } = withBob(t);
  for (const data of ['{"accounts": {"ann": {}, "bo', JSON.stringify({ accounts: { ann: {} } })]) {
    door(data);
    const done = step('bob');
    assert.match(done.said, /The front door has no account bob, so nothing was done\./);
    assert.doesNotMatch(done.system, /^(userdel|systemctl disable)/m);
    assert.ok(fs.existsSync(path.join(home, 'compose.yaml')));
  }
  door({ accounts: {}, deleted: { ann: '2026-10-16T12:00:00.000Z' } });
  const admin = step('ann');
  assert.match(admin.stderr, /The account ann is the admin's own, so it wasn't erased\./);
  assert.doesNotMatch(admin.system, /^(userdel|systemctl disable)/m);
  assert.ok(fs.existsSync(path.join(first.dir, 'accounts', 'ann', 'compose.yaml')));
});

test('an update leaves a suspended account stopped, and erases one the admin deleted', (t) => {
  const { first, door, upIn } = withBob(t);
  door({ accounts: { ann: {}, bob: { suspended: '2026-10-16T12:00:00.000Z' } } });
  const before = fs.readFileSync(path.join(first.top, 'docker.log'), 'utf8').split('\n').filter(Boolean).length;
  const update = installer(t, { again: first });
  assert.equal(update.status, 0, `${update.said}\n${update.stderr}`);
  assert.match(update.said, /The account bob is suspended, so it stays stopped/);
  const since = { docker: update.docker.slice(before) };
  assert.ok(upIn(since, 'ann'), "ann's account is updated");
  assert.ok(!upIn(since, 'bob'), "bob's isn't started");

  door({ accounts: { ann: {} }, deleted: { bob: '2026-10-16T12:00:00.000Z' } });
  const later = installer(t, { again: first });
  assert.equal(later.status, 0, `${later.said}\n${later.stderr}`);
  assert.match(later.said, /The account bob is erased/);
  assert.ok(!fs.existsSync(path.join(first.dir, 'accounts', 'bob')));
});

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
  const done = installer(t, { dotenv: '', args: ['--update'], input: '1\nbotdot.example.com\nann\n' });
  assert.equal(done.status, 1);
  assert.match(done.stderr, /The update needs an answer to ".+", so it stopped\. Run the installer yourself: sudo sh install\.sh/);
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
  fs.writeFileSync(path.join(first.dir, 'bin', 'install.sh'), fs.readFileSync(path.join(first.dir, 'bin', 'install.sh'), 'utf8').replace('--update) UNATTENDED=1 ;;', '--update) die "Couldn\'t download ghcr.io/kordal/bot-dot." ;;'));
  const done = installer(t, { again: first, dotenv: '', script: path.join(first.dir, 'bin', 'install.sh'), args: ['--requested'] });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  const update = JSON.parse(fs.readFileSync(path.join(first.dir, 'front-door', 'status', 'update.json'), 'utf8'));
  assert.equal(update.state, 'failed');
  assert.match(update.error, /Couldn't download ghcr\.io\/kordal\/bot-dot\./);
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

// --- Shares of the machine (#471) -------------------------------------------------------------------

test('each account gets its share: CPU and RAM on its unit and, for its computer, in a file only root writes, and its disk', (t) => {
  const done = rerun(t);
  const home = `${done.dir}/accounts/ann`;
  // The default share (DEFAULT_SHARE, as the front door's): 2 CPUs, 5 GB of RAM (no RAM measured here), 30 GB of disk.
  assert.match(done.system, /^systemctl set-property botdot-account@ann\.service CPUQuota=200% MemoryHigh=4608M MemoryMax=5G$/m, 'hard limits, applied at once and kept');
  assert.equal(fs.readFileSync(path.join(home, 'share', 'share.json'), 'utf8'), '{"cpu":2,"ram":5}\n');
  assert.match(done.system, new RegExp(`^chown 0:0 ${home}/share$`, 'm'), 'root writes it, not the account');
  assert.equal(fs.statSync(path.join(home, 'share', 'share.json')).mode & 0o777, 0o644);
  assert.match(done.system, new RegExp(`^truncate -s 30G ${done.dir}/disks/ann\\.img\\.new$`, 'm'));
  assert.match(done.system, new RegExp(`^mkfs\\.ext4 -q -F -m 0 ${done.dir}/disks/ann\\.img\\.new$`, 'm'));
  assert.match(done.system, new RegExp(`^mount -o loop ${done.dir}/disks/ann\\.img ${home}$`, 'm'));
  assert.equal(fs.statSync(path.join(done.dir, 'disks')).mode & 0o777, 0o700, "only root reaches the accounts' disks");
  // The account's docker-helper reads the file, read-only, and nothing else of the account does.
  const compose = fs.readFileSync(path.join(ROOT, 'compose.yaml'), 'utf8');
  assert.match(compose, /^ {6}- \.\/share:\/run\/botdot-share:ro$/m);
  assert.match(compose, /^ {6}BOT_DOT_SHARE_FILE: \/run\/botdot-share\/share\.json$/m);
  assert.equal(compose.match(/botdot-share/g).length, 2, 'only the helper has it');

  // A rerun keeps its disk as it is: it makes none and mounts none again.
  const again = rerun(t, '', {}, { again: done, dotenv: null });
  const since = again.system.slice(done.system.length);
  assert.doesNotMatch(since, /^(truncate|mkfs\.ext4|mount -o loop|resize2fs)/m);
});

test("the share in the installer is the front door's default", () => {
  const { DEFAULT_SHARE } = require('../lib/front-door/store');
  assert.match(script, new RegExp(`^DEFAULT_SHARE="${DEFAULT_SHARE.cpu} \\$\\{DEFAULT_RAM:-${DEFAULT_SHARE.ram}\\} ${DEFAULT_SHARE.disk}"$`, 'm'));
  // Its RAM from the machine's (#126), by the front door's rule.
  const awk = script.match(/^DEFAULT_RAM="\$\(awk '([^']+)'/m)[1];
  const { defaultRam } = require('../lib/front-door/store');
  for (const kb of [4_000_000, 8_000_000, 16_300_000, 65_800_000, 131_000_000]) {
    const out = require('child_process').execFileSync('awk', [awk], { input: `MemTotal:       ${kb} kB\n` }).toString().trim();
    assert.equal(Number(out), defaultRam(kb * 1024), `${kb} kB`);
  }
  assert.doesNotMatch(script, /computers at once|COMPUTERS/, 'a share has no computers at once (#108)');
  // The admin page's use counts the account's one computer, not the bots' old ones.
  assert.match(script, /docker ps -q --filter label=botdot\.computer=account --filter status=running/);
});

test("root's step gives an account the share the front door names, its own or the default, and grows its disk", (t) => {
  const { first, door, step } = withBob(t);
  // A share the front door kept before #108 still has its computers at once: it is read without them.
  door({ accounts: { ann: {}, bob: { share: { cpu: 1, ram: 3, computers: 1, disk: 40 } } } });
  const own = step('bob');
  assert.match(own.system, /^systemctl set-property botdot-account@bob\.service CPUQuota=100% MemoryHigh=2764M MemoryMax=3G$/m);
  assert.equal(fs.readFileSync(path.join(first.dir, 'accounts', 'bob', 'share', 'share.json'), 'utf8'), '{"cpu":1,"ram":3}\n');
  assert.match(own.system, new RegExp(`^truncate -s 40G ${first.dir}/disks/bob\\.img$`, 'm'), 'a bigger disk grows at once');
  assert.match(own.system, /^losetup -c \/dev\/loop7$/m);
  assert.match(own.system, /^resize2fs \/dev\/loop7$/m);
  assert.match(own.said, /The account bob is made already, and runs, with its share: 1 CPUs, 3 GB of RAM, 40 GB of disk$/m);
  assert.doesNotMatch(own.said, /at once/);

  door({ share: { cpu: 3, ram: 6, disk: 20 }, accounts: { ann: {}, bob: {} } });
  const byDefault = step('bob');
  assert.match(byDefault.system, /^systemctl set-property botdot-account@bob\.service CPUQuota=300% MemoryHigh=5529M MemoryMax=6G$/m, 'the default the admin set');
  assert.equal(fs.readFileSync(path.join(first.dir, 'accounts', 'bob', 'share', 'share.json'), 'utf8'), '{"cpu":3,"ram":6}\n');
  assert.doesNotMatch(byDefault.system, /^(truncate|resize2fs)/m, 'a smaller disk is never shrunk');
});

test('without systemd the CPU and RAM share are said not to be applied', (t) => {
  const done = rerun(t, '', {}, { systemd: false });
  assert.match(done.said, /This machine has no systemd, so the CPU and RAM share of the account ann aren't applied\./);
  assert.doesNotMatch(done.system, /set-property/);
  assert.equal(fs.readFileSync(path.join(done.dir, 'accounts', 'ann', 'share', 'share.json'), 'utf8'), '{"cpu":2,"ram":5}\n', 'its computer is sized all the same');
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

// --- Uninstall (#76) -------------------------------------------------------------------------------

// install.sh --uninstall, run from the source on the machine `first` installed, answering `input`.
const uninstall = (t, first, options = {}) => installer(t, { again: first, dotenv: '', args: ['--uninstall'], ...options });
// The AppArmor profile the installer writes on Ubuntu 24.04, where rootless Docker needs one.
const PROFILE = '# botdot (install.sh): rootless Docker for each account needs user namespaces.\nabi <abi/4.0>,\ninclude <tunables/global>\n\nprofile botdot-rootlesskit /usr/bin/rootlesskit flags=(unconfined) {\n  userns,\n}\n';
// A userdel on the machine `first` that removes every user but `refused`, which a process still uses.
const refusingUserdel = (first, refused) => ['#!/bin/sh', 'echo "userdel $*" >> "$STAND_IN_LOG"',
  `[ "$1" = ${refused} ] && { echo "userdel: user ${refused} is currently used by process 42" >&2; exit 8; }`,
  `grep -v "^$1:" "${path.join(first.top, 'users')}" > "${first.top}/users.new"; mv "${first.top}/users.new" "${path.join(first.top, 'users')}"`, 'exit 0', ''].join('\n');
const UNITS = ['botdot-account@.service', 'botdot-accounts.path', 'botdot-accounts.service', 'botdot-load.timer', 'botdot-load.service'];

test('the uninstaller lists what it removes, and removes nothing without a typed yes', (t) => {
  const { first, home } = withBob(t);
  fs.writeFileSync(path.join(first.etc, 'apparmor.d', 'botdot-rootlesskit'), PROFILE);
  // ann's share on her unit, as systemctl set-property keeps it.
  fs.mkdirSync(path.join(first.etc, 'systemd', 'system.control', 'botdot-account@ann.service.d'), { recursive: true });
  const before = first.system.length;
  for (const input of ['y\n', '']) {
    const done = uninstall(t, first, { input });
    assert.equal(done.status, 1, `${done.said}\n${done.stderr}`);
    assert.match(done.said, /botdot uninstaller/);
    assert.ok(done.said.includes([
      'This removes botdot from this machine for good:',
      "  - the front door: its containers and volumes in this machine's Docker, and its Linux user botdot-door",
      "  - the account ann: its botdot server, its bots' computers, its rootless Docker, its Linux user botdot-ann, its disk and its data",
      "  - the account bob: its botdot server, its bots' computers, its rootless Docker, its Linux user botdot-bob, its disk and its data",
      `  - botdot's systemd units: ${UNITS.join(', ')}, and the accounts' shares`,
      '  - the AppArmor profile botdot-rootlesskit',
      `  - ${first.dir}: every account's bots, chats, memory, vault and backups, and the passkeys`,
      'Docker and Tailscale stay. This can\'t be undone.', '',
      'Type yes to remove all of it: ',
    ].join('\n')), done.said);
    assert.match(done.stderr, /Nothing was removed\./);
    assert.doesNotMatch(done.system.slice(before), /^(userdel|systemctl disable|apparmor_parser -R|umount|apt-get)/m);
    assert.ok(!done.calls.some((c) => / down /.test(c)), 'the front door runs on');
    assert.ok(fs.existsSync(path.join(home, 'compose.yaml')) && fs.existsSync(path.join(first.dir, 'front-door', '.env')));
  }
});

test('a typed yes removes the front door, every account, root\'s step, the AppArmor profile and botdot\'s folder', (t) => {
  const { first } = withBob(t);
  const profile = path.join(first.etc, 'apparmor.d', 'botdot-rootlesskit');
  fs.writeFileSync(profile, PROFILE);
  fs.writeFileSync(path.join(first.etc, 'apparmor.d', 'usr.bin.man'), '# not botdot\'s');
  const before = first.system.length;
  const done = uninstall(t, first, { input: 'yes\nn\n', given: { STAND_IN_PACKAGES: 'runsc' } });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  const system = done.system.slice(before);
  assert.match(system, /^systemctl disable --now botdot-accounts\.path botdot-load\.timer$/m, "root's step stops first");
  assert.ok(done.calls.includes(`compose --project-directory ${first.dir}/front-door down -v --remove-orphans`), JSON.stringify(done.calls));
  for (const name of ['ann', 'bob']) {
    assert.match(system, new RegExp(`^systemctl disable --now botdot-account@${name}$`, 'm'));
    assert.match(system, new RegExp(`^userdel botdot-${name}$`, 'm'));
    assert.match(done.said, new RegExp(`The account ${name} is erased: its data, containers and Linux user`));
  }
  assert.match(system, /^userdel botdot-door$/m);
  assert.match(system, new RegExp(`^apparmor_parser -R ${profile}$`, 'm'));
  assert.ok(!fs.existsSync(profile));
  assert.ok(fs.existsSync(path.join(first.etc, 'apparmor.d', 'usr.bin.man')), 'another profile stays');
  for (const unit of UNITS) assert.ok(!fs.existsSync(path.join(first.etc, 'systemd', 'system', unit)), `${unit} is gone`);
  assert.ok(!fs.existsSync(first.dir), `${first.dir} is gone`);
  assert.ok(!fs.existsSync(first.run), `${first.run} is gone`);
  for (const map of ['subuid', 'subgid']) assert.equal(fs.readFileSync(path.join(first.etc, map), 'utf8'), 'ubuntu:100000:65536\n', `${map} keeps the others' IDs`);
  assert.equal(fs.readFileSync(path.join(first.etc, 'passwd'), 'utf8'), 'root:x:0:0:root:/root:/bin/bash\n');
  assert.match(done.said, /Remove them too\? Docker itself and Tailscale stay\. \[y\/N\]/);
  assert.doesNotMatch(system, /^apt-get/m, 'the packages stay when the answer is no');
  assert.doesNotMatch(system, /^tailscale serve .*off/m, 'a public install has no Serve setting');
  assert.match(done.said, /botdot is removed from this machine\. Docker and Tailscale stay\./);
});

test('BOT_DOT_YES=1 asks nothing, and keeps the packages', (t) => {
  const first = rerun(t);
  fs.mkdirSync(path.join(first.etc, 'apt', 'sources.list.d'), { recursive: true });
  fs.writeFileSync(path.join(first.etc, 'apt', 'sources.list.d', 'gvisor.list'), 'deb [arch=amd64 signed-by=/etc/apt/keyrings/gvisor.gpg] https://storage.googleapis.com/gvisor/releases release main\n');
  const before = first.system.length;
  const done = uninstall(t, first, { given: { BOT_DOT_YES: '1', STAND_IN_PACKAGES: 'runsc docker-ce-rootless-extras' } });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  assert.doesNotMatch(done.said, /Type yes|\[y\/N\]/);
  assert.match(done.said, /This removes botdot from this machine for good:/, 'it still says what it removes');
  assert.ok(done.said.includes(`The packages stay. Remove them yourself with: sudo apt-get remove runsc docker-ce-rootless-extras && sudo rm ${first.etc}/apt/sources.list.d/gvisor.list ${first.etc}/apt/keyrings/gvisor.gpg\n`), done.said);
  assert.match(done.system.slice(before), /^userdel botdot-ann$/m);
  assert.doesNotMatch(done.system.slice(before), /^apt-get/m);
  assert.ok(fs.existsSync(path.join(first.etc, 'apt', 'sources.list.d', 'gvisor.list')));
  assert.ok(!fs.existsSync(first.dir));
});

test('the packages go when asked, never Docker itself or Tailscale', (t) => {
  const first = rerun(t);
  for (const [folder, name] of [['sources.list.d', 'gvisor.list'], ['keyrings', 'gvisor.gpg'], ['sources.list.d', 'docker.list']]) {
    fs.mkdirSync(path.join(first.etc, 'apt', folder), { recursive: true });
    fs.writeFileSync(path.join(first.etc, 'apt', folder, name), '');
  }
  const before = first.system.length;
  const done = uninstall(t, first, { input: 'yes\ny\n', given: { STAND_IN_PACKAGES: 'docker-ce docker-ce-cli runsc docker-ce-rootless-extras tailscale uidmap' } });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  assert.match(done.said, /botdot's installer may have installed these: runsc, docker-ce-rootless-extras and gVisor's apt source\./);
  const system = done.system.slice(before);
  assert.match(system, /^apt-get -s remove runsc docker-ce-rootless-extras$/m, 'apt-get is asked first what else it would remove');
  assert.deepEqual(system.match(/^apt-get remove .*/gm), ['apt-get remove -y -qq runsc docker-ce-rootless-extras']);
  assert.ok(!fs.existsSync(path.join(first.etc, 'apt', 'sources.list.d', 'gvisor.list')));
  assert.ok(!fs.existsSync(path.join(first.etc, 'apt', 'keyrings', 'gvisor.gpg')));
  assert.ok(fs.existsSync(path.join(first.etc, 'apt', 'sources.list.d', 'docker.list')), "Docker's apt source stays");

  // apt-get would take Docker with them: nothing is removed, and the uninstaller says so.
  const other = rerun(t);
  const aptGet = ['#!/bin/sh', 'echo "apt-get $*" >> "$STAND_IN_LOG"', '[ "$1" = -s ] && { echo "Remv runsc [20261005.0]"; echo "Remv docker-ce [5:29.9.1-1]"; }', 'exit 0', ''].join('\n');
  const refused = uninstall(t, other, { input: 'yes\ny\n', bins: { 'apt-get': aptGet }, given: { STAND_IN_PACKAGES: 'runsc docker-ce' } });
  assert.equal(refused.status, 1, `${refused.said}\n${refused.stderr}`);
  assert.doesNotMatch(refused.system, /^apt-get remove/m);
  assert.match(refused.said, / {2}- the packages runsc: apt-get would remove docker-ce with them/);
});

test("a tailnet install's Serve setting for botdot goes, and Tailscale's others stay", (t) => {
  const serving = (to) => ['#!/bin/sh', 'echo "tailscale $*" >> "$STAND_IN_LOG"', `[ "$1" = serve ] && [ "$2" = status ] && { echo "https://vm.example.ts.net (tailnet only)"; echo "|-- / proxy http://127.0.0.1:${to}"; }`, 'exit 0', ''].join('\n');
  const first = installer(t, { dotenv: '', input: '2\nann\n' });
  assert.equal(first.status, 0, first.stderr);
  const other = uninstall(t, first, { given: { BOT_DOT_YES: '1' }, bins: { tailscale: serving(8080) } });
  assert.equal(other.status, 0, `${other.said}\n${other.stderr}`);
  assert.doesNotMatch(other.said, /Tailscale Serve's setting/);
  assert.doesNotMatch(other.system, /^tailscale serve --https=443 off$/m, 'Serve passes to something else: not botdot\'s');

  const again = installer(t, { dotenv: '', input: '2\nann\n' });
  assert.equal(again.status, 0, again.stderr);
  const before = again.system.length;
  const done = uninstall(t, again, { input: 'yes\n', bins: { tailscale: serving(4700) } });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  assert.match(done.said, / {2}- Tailscale Serve's setting for botdot\n/);
  assert.match(done.system.slice(before), /^tailscale serve --https=443 off$/m);
  assert.doesNotMatch(done.system.slice(before), /^tailscale (down|logout|up)/m);
});

test("the uninstaller never touches what isn't botdot's, and says what it couldn't remove", (t) => {
  const { first } = withBob(t);
  fs.appendFileSync(path.join(first.etc, 'passwd'), 'botdot-zed:x:1500:1500:not an account:/home/zed:/bin/sh\n');
  fs.writeFileSync(path.join(first.dir, 'notes.txt'), "the admin's");
  const before = first.system.length;
  const done = uninstall(t, first, { input: 'yes\n', bins: { userdel: refusingUserdel(first, 'botdot-door') } });
  assert.equal(done.status, 1, `${done.said}\n${done.stderr}`);
  assert.doesNotMatch(done.said, /account zed/, "a user named botdot-… whose home isn't an account's is no account");
  assert.doesNotMatch(done.system.slice(before), /^userdel botdot-zed$/m);
  assert.match(done.system.slice(before), /^userdel botdot-bob$/m, 'the others go on');
  assert.ok(fs.existsSync(path.join(first.dir, 'notes.txt')), "a file botdot didn't make stays");
  for (const gone of ['accounts', 'front-door', 'sockets', 'disks', 'bin']) assert.ok(!fs.existsSync(path.join(first.dir, gone)), `${gone} is gone`);
  assert.ok(done.said.includes([
    "These couldn't be removed:",
    '  - the Linux user botdot-door',
    `  - ${first.dir}, which holds files botdot didn't make: notes.txt`,
  ].join('\n')), done.said);
  assert.doesNotMatch(done.said, /botdot is removed from this machine/);
});

test("an account that couldn't be removed keeps botdot's folder, and a second run finishes", (t) => {
  const { first } = withBob(t);
  const done = uninstall(t, first, { input: 'yes\n', bins: { userdel: refusingUserdel(first, 'botdot-bob') } });
  assert.equal(done.status, 1, `${done.said}\n${done.stderr}`);
  assert.match(done.stderr, /Couldn't remove the Linux user botdot-bob\./);
  assert.ok(done.said.includes([
    "These couldn't be removed:",
    '  - the account bob (see above)',
    `  - ${first.dir}, as an account in it wasn't removed: run the uninstaller again`,
  ].join('\n')), done.said);
  assert.ok(fs.existsSync(first.dir));

  const again = uninstall(t, first, { input: 'yes\n' });
  assert.equal(again.status, 0, `${again.said}\n${again.stderr}`);
  assert.match(again.said, /The account bob is erased/);
  assert.ok(!fs.existsSync(first.dir));
});

test('on a machine without botdot the uninstaller removes nothing', (t) => {
  const done = installer(t, { dotenv: '', args: ['--uninstall'], input: 'yes\n' });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  assert.match(done.said, /Nothing of botdot is on this machine\./);
  assert.doesNotMatch(done.system, /^(userdel|systemctl disable|apt-get)/m);
});
