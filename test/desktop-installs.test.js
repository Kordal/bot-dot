// botdot-tailscale (deploy/desktop, ADR 032): the bot puts its computer on the owner's tailnet in userspace, without
// root, with shields up and no auth key. Run against a stand-in Tailscale build and package index.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const SCRIPT = path.join(__dirname, '..', 'deploy', 'desktop', 'botdot-tailscale');
const python = spawnSync('python3', ['--version']).status === 0;

// A stand-in build: tailscaled listens on its socket and notes its arguments, tailscale notes `up` and answers
// `status` with what STATUS holds.
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
case "$2" in up) echo "$@" > "$HOME/up.args";; status) cat "$HOME/STATUS";; esac
`, { mode: 0o755 });
  spawnSync('tar', ['-czf', path.join(dir, 'tailscale_9_amd64.tgz'), '-C', path.join(dir, 'pkg'), 'tailscale_9_amd64']);
}

// Runs `botdot-tailscale up NAME` with the package index answering from dir (sha: what its .sha256 says).
function up(dir, home, { sha } = {}) {
  const driver = `
import hashlib, importlib.machinery, json, sys
m = importlib.machinery.SourceFileLoader('bt', sys.argv[1]).load_module()
data = open(sys.argv[2], 'rb').read()
m.platform.machine = lambda: 'x86_64'
want = sys.argv[3] or hashlib.sha256(data).hexdigest()
m.fetch = lambda u: json.dumps({'Tarballs': {'amd64': 'tailscale_9_amd64.tgz'}}).encode() if u.endswith('mode=json') else (want.encode() if u.endswith('.sha256') else data)
m.up('helper-bot')
`;
  return spawnSync('python3', ['-I', '-B', '-c', driver, SCRIPT, path.join(dir, 'tailscale_9_amd64.tgz'), sha || ''], { env: { ...process.env, HOME: home }, encoding: 'utf8' });
}

function scratch(t) {
  // A short path: a Unix socket's path is at most about 100 characters.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ts-'));
  const home = path.join(dir, 'h');
  fs.mkdirSync(home);
  t.after(() => {
    spawnSync('pkill', ['-f', path.join(home, '.local', 'tailscale', 'bin', 'tailscaled')]);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  standIn(dir);
  return { dir, home };
}

test('up installs Tailscale in the home, starts it in userspace and prints the login link for the owner', { skip: !python }, (t) => {
  const { dir, home } = scratch(t);
  fs.writeFileSync(path.join(home, 'STATUS'), JSON.stringify({ BackendState: 'NeedsLogin', AuthURL: 'https://login.tailscale.com/a/abc' }));
  const out = up(dir, home);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /open this link and approve this computer: https:\/\/login\.tailscale\.com\/a\/abc/);
  assert.ok(fs.statSync(path.join(home, '.local', 'tailscale', 'bin', 'tailscaled')).mode & 0o100);
  const daemon = JSON.parse(fs.readFileSync(path.join(home, 'tailscaled.args'), 'utf8'));
  assert.ok(daemon.includes('--tun=userspace-networking'), 'no TUN device, no root');
  assert.ok(daemon.includes('--socks5-server=localhost:1055'));
  assert.ok(daemon.includes('--outbound-http-proxy-listen=localhost:1055'));
  const upArgs = fs.readFileSync(path.join(home, 'up.args'), 'utf8');
  assert.match(upArgs, / up --shields-up /, 'no tailnet device connects to the computer');
  assert.match(upArgs, /--hostname=helper-bot/);
  assert.doesNotMatch(upArgs, /auth-?key/i);
});

test('once approved, up prints the computer\'s tailnet name and address', { skip: !python }, (t) => {
  const { dir, home } = scratch(t);
  fs.writeFileSync(path.join(home, 'STATUS'), JSON.stringify({ BackendState: 'Running', Self: { DNSName: 'helper-bot.tail1234.ts.net.', TailscaleIPs: ['100.101.102.103'] } }));
  const out = up(dir, home);
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /On the tailnet as helper-bot\.tail1234\.ts\.net \(100\.101\.102\.103\)/);
  assert.match(out.stdout, /ALL_PROXY=socks5h:\/\/localhost:1055/);
});

test('a build that does not match its published SHA-256 is not installed', { skip: !python }, (t) => {
  const { dir, home } = scratch(t);
  const out = up(dir, home, { sha: '0'.repeat(64) });
  assert.notEqual(out.status, 0);
  assert.match(out.stderr, /does not match its published SHA-256/);
  assert.equal(fs.existsSync(path.join(home, '.local', 'tailscale', 'bin', 'tailscaled')), false);
});

// Runs `botdot-tailscale resume`, as botdot does when the computer starts (#68), with Tailscale installed from dir.
function resume(dir, home) {
  const bin = path.join(home, '.local', 'tailscale', 'bin');
  fs.mkdirSync(bin, { recursive: true });
  for (const n of ['tailscale', 'tailscaled']) fs.copyFileSync(path.join(dir, 'pkg', 'tailscale_9_amd64', n), path.join(bin, n));
  return spawnSync('python3', ['-I', '-B', SCRIPT, 'resume'], { env: { ...process.env, HOME: home }, encoding: 'utf8' });
}
// tailscaled's state file as it keeps it: each value base64; _profiles holds the logins it has.
function state(home, profiles) {
  const dir = path.join(home, '.local', 'tailscale', 'state');
  fs.mkdirSync(dir, { recursive: true });
  const b64 = (v) => Buffer.from(v).toString('base64');
  fs.writeFileSync(path.join(dir, 'tailscaled.state'), JSON.stringify({ _machinekey: b64('privkey:00'), ...(profiles && { _profiles: b64(JSON.stringify(profiles)) }) }));
}

test('resume starts Tailscale again on a computer that is signed in, with no new login (#68)', { skip: !python }, (t) => {
  const { dir, home } = scratch(t);
  state(home, { a1b2: { ID: 'a1b2', Name: 'owner@example.com' } });
  const out = resume(dir, home);
  assert.equal(out.status, 0, out.stderr);
  const daemon = JSON.parse(fs.readFileSync(path.join(home, 'tailscaled.args'), 'utf8'));
  assert.ok(daemon.includes(`--statedir=${path.join(home, '.local', 'tailscale', 'state')}`), 'with the login it keeps');
  assert.ok(daemon.includes('--tun=userspace-networking'));
  assert.equal(fs.existsSync(path.join(home, 'up.args')), false, 'no up, so no login link');
  assert.doesNotMatch(out.stdout, /login|approve/i);
});

test('resume starts nothing on a computer that never signed in, or was never approved (#68)', { skip: !python }, (t) => {
  const { dir, home } = scratch(t);
  for (const profiles of [undefined, null, {}]) {
    if (profiles !== undefined) state(home, profiles);
    const out = resume(dir, home);
    assert.equal(out.status, 0, out.stderr);
    assert.equal(fs.existsSync(path.join(home, 'tailscaled.args')), false, `nothing started with ${JSON.stringify(profiles)}`);
  }
});

test('the desktop image carries it, and a bot with a computer is told how to use it', () => {
  const dockerfile = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'desktop', 'Dockerfile'), 'utf8');
  assert.match(dockerfile, /^COPY botdot-tailscale \/usr\/local\/bin\/botdot-tailscale$/m);
  assert.match(dockerfile, /chmod 755 [^\n]*\/usr\/local\/bin\/botdot-tailscale/);
  assert.match(fs.readFileSync(path.join(__dirname, '..', 'lib', 'bots.js'), 'utf8'), /botdot-tailscale up <a short name>/);
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
