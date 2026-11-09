#!/usr/bin/env node
// The stage `install-prereqs` (`make install-prereqs`): install.sh's first step on a fresh machine of each
// distribution botdot supports, with the real packages from the real repositories: Docker from Docker's own (through
// get.docker.com on Debian and Ubuntu, Docker's dnf repository on Fedora and the RHEL family), rootless Docker, the
// user-mode network, setfacl and gVisor at its pinned release (gVisor's apt repository, or its release files where
// apt-get isn't). install-real installs botdot end to end on machines that have all of that already.
//
// A machine is the distribution's own image (privileged, without systemd), with curl as a server has it, and a
// stand-in systemctl that starts Docker's daemon when the installer asks. The installer runs as a person runs it,
// answering yes, until it is past its first step: the images are not its concern. A second run
// finds everything and asks for nothing.
//
//   INSTALL_PREREQS_DISTRO=fedora-43 node tests/integration/install-prereqs.js   (one of DISTROS; all without it)
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '../..');
const GVISOR_RELEASE = fs.readFileSync(path.join(root, 'install.sh'), 'utf8').match(/^GVISOR_RELEASE=(\S+)$/m)[1];
// Each distribution's image, pinned, and what a server of it has that the image leaves out.
const APT_PREP = 'apt-get update -qq && DEBIAN_FRONTEND=noninteractive apt-get install -y -qq curl ca-certificates >/dev/null';
// A distribution's container image drops the file capabilities newuidmap and newgidmap have on a machine (the
// installer refuses them so); reinstalling shadow-utils gives them back, as a machine of it has them.
const DNF_PREP = 'dnf reinstall -y -q shadow-utils >/dev/null';
const DISTROS = {
  'ubuntu-22.04': { image: 'ubuntu:22.04@sha256:076e7bf82319619f28dd0aa9c02ab34b055ad37100395b4f49a2ffba04fb5e11', prep: APT_PREP },
  'ubuntu-24.04': { image: 'ubuntu:24.04@sha256:534baea6a22c03a63003dbc8dbe78fe34bc0d7e595d9a9dc9834884ff530eb55', prep: APT_PREP },
  'debian-12': { image: 'debian:12@sha256:268fb24c39bca92d326dd83ea3abebe4a3f7751c804ffef23bb6d857dd343ff8', prep: APT_PREP },
  'debian-13': { image: 'debian:13@sha256:9c6e381421d0f48d1b8133e573f33c185ee16cbf505eda9c4a8a4791b25ea8a6', prep: APT_PREP },
  'fedora-43': { image: 'fedora:43@sha256:f01112b9a1f1d0504ad962d9adfa401425033f8ab067e0a821904ebdde5b8ca5', prep: DNF_PREP },
  'rocky-10': { image: 'rockylinux/rockylinux:10@sha256:827d37bc128288ccf160ee318bb3cb92d591164cb217e92f8bc61e3982ae1834', prep: DNF_PREP },
  'alma-9': { image: 'almalinux:9@sha256:245f8aab832fe800aa42bdab5fad75ebbd8e0b4c9f24820a83c638b177857ae2', prep: DNF_PREP },
};
// systemctl without systemd: `start docker` starts Docker's daemon (with no network of its own: nothing runs in it
// here) and waits for it; `show`, which the installer asks whether systemd runs the machine, fails.
const SYSTEMCTL = `#!/bin/sh
case "$1 $2" in
  "start docker"|"restart docker")
    (dockerd --bridge=none --iptables=false --ip6tables=false >/var/log/dockerd.log 2>&1 9>&- &)
    i=0; until docker info >/dev/null 2>&1; do i=$((i + 1)); [ "$i" -lt 60 ] || exit 1; sleep 1; done; exit 0 ;;
esac
exit 1
`;
const ENV = { BOT_DOT_IMAGE: 'registry.invalid/kordal/bot-dot:none', BOT_DOT_REACH: 'public', BOT_DOT_DOMAIN: 'botdot.test', BOT_DOT_ADMIN: 'ann' };

const docker = (...args) => execFileSync('docker', args, { encoding: 'utf8', timeout: 15 * 60_000, maxBuffer: 64 * 1024 * 1024 }).trim();

function check(distro) {
  const { image, prep } = DISTROS[distro];
  const name = `botdot-install-prereqs-${distro}-${process.pid}`;
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-prereqs-'));
  fs.writeFileSync(path.join(temp, 'systemctl'), SYSTEMCTL, { mode: 0o755 });
  const step = (text) => console.log(`install-prereqs ${distro}: ${text}`);
  try {
    step('starting a fresh machine');
    docker('run', '-d', '--privileged', '--name', name, '-v', `${temp}/systemctl:/usr/local/sbin/systemctl:ro`, image, 'sleep', 'infinity');
    docker('cp', path.join(root, 'install.sh'), `${name}:/root/install.sh`);
    docker('exec', name, 'sh', '-c', prep);
    const install = () => {
      const vars = Object.entries(ENV).flatMap(([k, v]) => ['-e', `${k}=${v}`]);
      const r = spawnSync('docker', ['exec', '-i', ...vars, name, 'sh', '/root/install.sh'], { input: '', encoding: 'utf8', timeout: 15 * 60_000 });
      return { status: r.status, said: `${r.stdout}\n${r.stderr}` };
    };
    step('installing what botdot needs');
    const first = install();
    // The machine runs GitHub's Ubuntu kernel, which restricts user namespaces: a distribution whose AppArmor is older
    // than 4 (Ubuntu 22.04, Debian 12) is told to lift that, which its own kernel doesn't need.
    const hostRestricts = (() => { try { return fs.readFileSync('/proc/sys/kernel/apparmor_restrict_unprivileged_userns', 'utf8').trim() === '1'; } catch { return false; } })();
    const lift = /AppArmor is too old to name rootless Docker/.test(first.said);
    assert.ok(lift ? hostRestricts : new RegExp(`Rootless Docker and gVisor \\(release-${GVISOR_RELEASE.replace('.', '\\.')}\\)`).test(first.said), `the first step is done:\n${first.said}`);
    const have = docker('exec', name, 'sh', '-c', 'for t in docker dockerd-rootless.sh newuidmap setfacl; do command -v "$t" >/dev/null || echo "$t is missing"; done; command -v slirp4netns >/dev/null || command -v pasta >/dev/null || echo "slirp4netns is missing"; docker compose version >/dev/null || echo "docker compose is missing"; "$(command -v runsc || echo /usr/local/bin/runsc)" --version | head -n 1');
    assert.equal(have, `runsc version release-${GVISOR_RELEASE}`, have);

    step('running it again');
    const again = install();
    assert.doesNotMatch(again.said, /Install (them|Docker) now|needs:/, `a second run installs nothing:\n${again.said}`);
    if (!lift) assert.match(again.said, /Rootless Docker and gVisor/, again.said);
    step('passed');
  } finally {
    try { docker('rm', '-fv', name); } catch { /* not started */ }
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

const only = process.env.INSTALL_PREREQS_DISTRO;
assert.ok(!only || DISTROS[only], `INSTALL_PREREQS_DISTRO is one of ${Object.keys(DISTROS).join(', ')}, not "${only}"`);
for (const distro of only ? [only] : Object.keys(DISTROS)) check(distro);
console.log(JSON.stringify({ result: 'PASS', distros: only ? [only] : Object.keys(DISTROS) }));
