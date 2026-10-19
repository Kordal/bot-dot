// botdot-tailscale (deploy/desktop, #106): one device on the owner's tailnet for the account's computer, run by root
// in userspace with shields up and no auth key, its state in root's own folder. Run against a stand-in Tailscale
// build and package index, with its folder in a scratch directory.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'deploy', 'desktop', 'botdot-tailscale');
const python = spawnSync('python3', ['--version']).status === 0;

// A stand-in build: tailscaled listens on its socket and notes its arguments, tailscale notes `up` and `set` and
// answers `status` with what STATUS holds.
function standIn(dir) {
  const pkg = path.join(dir, 'pkg', 'tailscale_9_amd64');
  fs.mkdirSync(pkg, { recursive: true });
  fs.writeFileSync(path.join(pkg, 'tailscaled'), `#!/usr/bin/python3
import json, os, socket, sys, time
open(os.path.join(os.environ['HOME'], 'tailscaled.args'), 'w').write(json.dumps(sys.argv[1:]))
sock = [a.split('=', 1)[1] for a in sys.argv if a.startswith('--socket=')][0]
s = socket.socket(socket.AF_UNIX); s.bind(sock); s.listen(); time.sleep(10)
`, { mode: 0o755 });
  fs.writeFileSync(path.join(pkg, 'tailscale'), `#!/bin/sh
case "$2" in up) echo "$@" > "$HOME/up.args";; set) echo "$@" > "$HOME/set.args";; status) cat "$HOME/STATUS";; esac
`, { mode: 0o755 });
  spawnSync('tar', ['-czf', path.join(dir, 'tailscale_9_amd64.tgz'), '-C', path.join(dir, 'pkg'), 'tailscale_9_amd64']);
}

// Runs the script's main with argv, its folder at ts (instead of /var/lib/botdot-tailscale), the package index
// answering from dir (sha: what its .sha256 says), and uid as the user it runs as (sudo noted instead of run).
function botdotTailscale({ dir, home, ts }, argv, { sha, uid = 0 } = {}) {
  const driver = `
import hashlib, importlib.machinery, json, os, sys
m = importlib.machinery.SourceFileLoader('bt', sys.argv[1]).load_module()
data = open(sys.argv[2], 'rb').read()
m.DIR = sys.argv[4]
m.platform.machine = lambda: 'x86_64'
m.os.geteuid = lambda: int(sys.argv[5])
def execv(prog, args):
    open(os.path.join(os.environ['HOME'], 'sudo.args'), 'w').write(json.dumps(args))
    sys.exit(0)
m.os.execv = execv
want = sys.argv[3] or hashlib.sha256(data).hexdigest()
m.fetch = lambda u: json.dumps({'Tarballs': {'amd64': 'tailscale_9_amd64.tgz'}}).encode() if u.endswith('mode=json') else (want.encode() if u.endswith('.sha256') else data)
m.main(['/usr/local/bin/botdot-tailscale', *sys.argv[6:]])
`;
  return spawnSync('python3', ['-I', '-B', '-c', driver, SCRIPT, path.join(dir, 'tailscale_9_amd64.tgz'), sha || '', ts, String(uid), ...argv], { env: { ...process.env, HOME: home }, encoding: 'utf8' });
}

function scratch(t) {
  // A short path: a Unix socket's path is at most about 100 characters.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-'));
  const home = path.join(dir, 'h');
  const ts = path.join(dir, 'ts');
  fs.mkdirSync(home);
  t.after(() => {
    spawnSync('pkill', ['-f', path.join(ts, 'bin', 'tailscaled')]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  standIn(dir);
  return { dir, home, ts };
}

test('up installs Tailscale in root\'s own folder, starts it in userspace and prints the login link for the owner', { skip: !python }, (t) => {
  const s = scratch(t);
  fs.writeFileSync(path.join(s.home, 'STATUS'), JSON.stringify({ BackendState: 'NeedsLogin', AuthURL: 'https://login.tailscale.com/a/abc' }));
  const out = botdotTailscale(s, ['up', 'home-box']);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /open this link and approve this computer: https:\/\/login\.tailscale\.com\/a\/abc/);
  assert.ok(fs.statSync(path.join(s.ts, 'bin', 'tailscaled')).mode & 0o100);
  assert.equal(fs.statSync(s.ts).mode & 0o777, 0o700, 'its key and login are closed to a program that does not use sudo');
  assert.equal(fs.statSync(path.join(s.ts, 'state')).mode & 0o077, 0);
  const daemon = JSON.parse(fs.readFileSync(path.join(s.home, 'tailscaled.args'), 'utf8'));
  assert.ok(daemon.includes('--tun=userspace-networking'), 'no TUN device and no NET_ADMIN, so the firewall stays botdot\'s');
  assert.ok(daemon.includes(`--statedir=${path.join(s.ts, 'state')}`));
  assert.ok(daemon.includes(`--socket=${path.join(s.ts, 'tailscaled.sock')}`));
  assert.ok(daemon.includes('--socks5-server=localhost:1055'));
  assert.ok(daemon.includes('--outbound-http-proxy-listen=localhost:1055'));
  const upArgs = fs.readFileSync(path.join(s.home, 'up.args'), 'utf8');
  assert.match(upArgs, / up --shields-up /, 'no tailnet device connects to the computer');
  assert.match(upArgs, /--hostname=home-box/);
  assert.doesNotMatch(upArgs, /auth-?key/i);
});

test('once approved, up prints the computer\'s tailnet name and address, for every bot', { skip: !python }, (t) => {
  const s = scratch(t);
  fs.writeFileSync(path.join(s.home, 'STATUS'), JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'home-box.tail1234.ts.net.', TailscaleIPs: ['100.101.102.103'] } }));
  const out = botdotTailscale(s, ['up', 'home-box']);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /on the tailnet as home-box\.tail1234\.ts\.net \(100\.101\.102\.103\), for every bot on it/);
  assert.match(out.stdout, /ALL_PROXY=socks5h:\/\/localhost:1055/);
});

test('a bot runs it as box: it starts itself again as root through sudo, before it does anything', { skip: !python }, (t) => {
  const s = scratch(t);
  const out = botdotTailscale(s, ['up', 'home-box'], { uid: 1000 });
  assert.equal(out.status, 0, out.stderr);
  const args = JSON.parse(fs.readFileSync(path.join(s.home, 'sudo.args'), 'utf8'));
  assert.deepEqual([args[0], args[1], ...args.slice(3)], ['/usr/bin/sudo', '-n', '-I', '/usr/local/bin/botdot-tailscale', 'up', 'home-box']);
  assert.equal(fs.existsSync(s.ts), false, 'nothing installed or started as box');
  assert.equal(fs.existsSync(path.join(s.home, 'tailscaled.args')), false);
});

test('a build that does not match its published SHA-256 is not installed', { skip: !python }, (t) => {
  const s = scratch(t);
  const out = botdotTailscale(s, ['up'], { sha: '0'.repeat(64) });
  assert.notEqual(out.status, 0);
  assert.match(out.stderr, /does not match its published SHA-256/);
  assert.equal(fs.existsSync(path.join(s.ts, 'bin', 'tailscaled')), false);
});

// Tailscale installed into its folder from dir, as `up` leaves it.
function installed({ dir, ts }) {
  const bin = path.join(ts, 'bin');
  fs.mkdirSync(bin, { recursive: true, mode: 0o700 });
  for (const n of ['tailscale', 'tailscaled']) fs.copyFileSync(path.join(dir, 'pkg', 'tailscale_9_amd64', n), path.join(bin, n));
}
// tailscaled's state file as it keeps it: each value base64; _profiles holds the logins it has.
function state(ts, profiles) {
  const dir = path.join(ts, 'state');
  fs.mkdirSync(dir, { recursive: true });
  const b64 = (v) => Buffer.from(v).toString('base64');
  fs.writeFileSync(path.join(dir, 'tailscaled.state'), JSON.stringify({ _machinekey: b64('privkey:00'), ...(profiles && { _profiles: b64(JSON.stringify(profiles)) }) }));
}

test('resume starts Tailscale again on a computer that is signed in, with no new login, and puts its shields back up (#68)', { skip: !python }, (t) => {
  const s = scratch(t);
  installed(s);
  state(s.ts, { a1b2: { ID: 'a1b2', Name: 'owner@example.com' } });
  const out = botdotTailscale(s, ['resume']);
  assert.equal(out.status, 0, out.stderr);
  const daemon = JSON.parse(fs.readFileSync(path.join(s.home, 'tailscaled.args'), 'utf8'));
  assert.ok(daemon.includes(`--statedir=${path.join(s.ts, 'state')}`), 'with the login it keeps');
  assert.ok(daemon.includes('--tun=userspace-networking'));
  assert.equal(fs.existsSync(path.join(s.home, 'up.args')), false, 'no up, so no login link');
  assert.match(fs.readFileSync(path.join(s.home, 'set.args'), 'utf8'), / set --shields-up=true$/m, 'a bot that let connections in has them refused again');
  assert.doesNotMatch(out.stdout, /login|approve/i);
});

test('resume starts nothing on a computer that never signed in, or was never approved (#68)', { skip: !python }, (t) => {
  const s = scratch(t);
  installed(s);
  for (const profiles of [undefined, null, {}]) {
    if (profiles !== undefined) state(s.ts, profiles);
    const out = botdotTailscale(s, ['resume']);
    assert.equal(out.status, 0, out.stderr);
    assert.equal(fs.existsSync(path.join(s.home, 'tailscaled.args')), false, `nothing started with ${JSON.stringify(profiles)}`);
  }
});

test('a bot\'s userspace Tailscale in box\'s home is not carried over: resume looks only at root\'s folder', { skip: !python }, (t) => {
  const s = scratch(t);
  // A login made before #106, as box, in the shared home.
  const old = path.join(s.home, '.local', 'tailscale');
  installed({ dir: s.dir, ts: old });
  state(old, { a1b2: { ID: 'a1b2', Name: 'owner@example.com' } });
  const out = botdotTailscale(s, ['resume']);
  assert.equal(out.status, 0, out.stderr);
  assert.equal(fs.existsSync(path.join(s.home, 'tailscaled.args')), false);
});

test('the desktop image carries it, and a bot with a computer is told how to use it', () => {
  const dockerfile = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'desktop', 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /^COPY botdot-tailscale \/usr\/local\/bin\/botdot-tailscale$/m);
  assert.match(dockerfile, /chmod 755 [^\n]*\/usr\/local\/bin\/botdot-tailscale/);
  const bots = fs.readFileSync(path.join(__dirname, '..', 'lib', 'bots.js'), 'utf8');
  assert.match(bots, /botdot-tailscale up <a short name for the computer>/);
  assert.match(bots, /one device for the whole computer, which every bot on it uses/);
});

// botdot-install (deploy/desktop, ADR 032): programs the owner asks for, into the bot's home, without root.
const INSTALL = path.join(__dirname, '..', 'deploy', 'desktop', 'botdot-install');
function install(t, args) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bi-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const home = path.join(dir, 'h');
  fs.mkdirSync(home);
  // A stand-in micromamba: notes its arguments and makes the environment it is asked to create.
  const mamba = path.join(dir, 'micromamba');
  fs.writeFileSync(mamba, `#!/bin/sh
echo "$@" >> "$HOME/mamba.log"
[ "$1" = create ] && mkdir -p "$4/conda-meta" "$4/bin"
exit 0
`, { mode: 0o755 });
  const driver = `
import importlib.machinery, sys
m = importlib.machinery.SourceFileLoader('bi', sys.argv[1]).load_module()
m.MAMBA = sys.argv[2]
sys.exit(m.run(sys.argv[3:]) or 0)
`;
  const out = spawnSync('python3', ['-I', '-B', '-c', driver, INSTALL, mamba, ...args], { env: { ...process.env, HOME: home }, encoding: 'utf8' });
  const log = fs.existsSync(path.join(home, 'mamba.log')) ? fs.readFileSync(path.join(home, 'mamba.log'), 'utf8') : '';
  return { out, home, log };
}

test('botdot-install installs from conda-forge into ~/.local/env, on the PATH of new shells', { skip: !python }, (t) => {
  const { out, home, log } = install(t, ['ffmpeg', 'rclone']);
  assert.equal(out.status, 0, out.stderr);
  const env = path.join(home, '.local', 'env');
  assert.match(log, new RegExp(`^create -y -p ${env} -c conda-forge --override-channels$`, 'm'));
  assert.match(log, new RegExp(`^install -y -p ${env} -c conda-forge --override-channels ffmpeg rclone$`, 'm'));
  for (const rc of ['.profile', '.bashrc']) assert.match(fs.readFileSync(path.join(home, rc), 'utf8'), /export PATH="\$HOME\/\.local\/env\/bin:/);
  assert.match(out.stdout, /Installed/);
});

test('botdot-install takes package names only, never options for micromamba', { skip: !python }, (t) => {
  const { out, log } = install(t, ['ffmpeg', '--prefix=/']);
  assert.notEqual(out.status, 0);
  assert.equal(log, '');
});

test('the desktop image carries botdot-install and a pinned micromamba', () => {
  const dockerfile = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'desktop', 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /^COPY botdot-install \/usr\/local\/bin\/botdot-install$/m);
  assert.match(dockerfile, /^COPY --from=micromamba --chmod=0755 \/micromamba \/usr\/local\/bin\/micromamba$/m);
  assert.equal((dockerfile.match(/^ADD --checksum=sha256:[0-9a-f]{64} \\$/gm) || []).length >= 2, true);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'lib', 'bots.js'), 'utf8'), /botdot-install NAME/);
});

// Installing OpenSSH's client left SSH host keys in /etc/ssh: the same private keys in every bot's computer, and the
// image's secret scan refused them. They go in the same step, so no
// layer keeps them. Nothing in a computer runs an SSH server.
test("the desktop image keeps no SSH host keys from installing OpenSSH's client", () => {
  const dockerfile = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'desktop', 'Dockerfile'), 'utf8');
  const step = dockerfile.split(/\n(?=RUN |COPY |ADD |FROM |USER |ENV )/).find((s) => s.includes('openssh-client'));
  assert.match(step, /rm -f \/etc\/ssh\/ssh_host_\*/);
});
