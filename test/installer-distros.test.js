// The installer on distributions other than Ubuntu (install.sh, step 1): Debian and Ubuntu through apt-get, Fedora and
// the RHEL family through dnf, gVisor from its release files where apt-get isn't, and a clear stop where a machine
// can't run botdot or its packages can't be installed by the installer.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { installer, script, ROOT } = require('./installer-helpers');

const FEDORA = 'NAME="Fedora Linux"\nVERSION_ID=43\nID=fedora\nPRETTY_NAME="Fedora Linux 43 (Server Edition)"\n';
const ROCKY = 'NAME="Rocky Linux"\nVERSION_ID="10.0"\nID="rocky"\nID_LIKE="rhel centos fedora"\nPRETTY_NAME="Rocky Linux 10.0 (Red Quartz)"\n';
const DEBIAN = 'PRETTY_NAME="Debian GNU/Linux 12 (bookworm)"\nNAME="Debian GNU/Linux"\nVERSION_ID="12"\nID=debian\n';

// dnf: writes down what it was asked; an install puts back the tools of the packages it names, which the test left
// out (NAME.removed beside them), or fails with `fail`.
const dnf = (fail = false) => [
  '#!/bin/sh',
  'echo "dnf $*" >> "$STAND_IN_LOG"',
  fail ? 'exit 1' : '',
  'bin="$(dirname "$0")"',
  'back() { [ ! -f "$bin/$1.removed" ] || mv "$bin/$1.removed" "$bin/$1"; }',
  'for p; do case "$p" in docker-ce) back docker ;; docker-ce-rootless-extras) back dockerd-rootless.sh ;; shadow-utils) back newuidmap ;; acl) back setfacl ;; esac; done',
  'exit 0', '',
].join('\n');
// rpm: the packages in STAND_IN_PACKAGES are installed, no other; -e writes down what it removes.
const RPM = '#!/bin/sh\necho "rpm $*" >> "$STAND_IN_LOG"\n[ "$1" = -e ] && exit 0\nfor p; do :; done\ncase " ${STAND_IN_PACKAGES:-} " in *" $p "*) exit 0 ;; *) exit 1 ;; esac\n';
const RPM_MACHINE = { 'apt-get': null, dpkg: null, 'dpkg-query': null, dnf: dnf(), rpm: RPM };

// gVisor's release files as a stand-in: runsc of the pinned release and its helpers, as a tar (the stand-in zstd
// passes it through), and a copy of the installer that pins its sha256.
function gvisorRelease(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-gvisor-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(dir, 'files', 'gvisor-bin'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'files', 'runsc'), '#!/bin/sh\necho "runsc version release-20261102.0"\n', { mode: 0o755 });
  fs.writeFileSync(path.join(dir, 'files', 'gvisor-bin', 'gvisor_sentry'), '#!/bin/sh\n', { mode: 0o755 });
  const tar = path.join(dir, 'gvisor.tar.zstd');
  execFileSync('tar', ['-c', '-f', tar, '-C', path.join(dir, 'files'), 'runsc', 'gvisor-bin']);
  const sum = crypto.createHash('sha256').update(fs.readFileSync(tar)).digest('hex');
  const copy = path.join(dir, 'install.sh');
  // Beside botdot's source, which checks the images' signatures.
  for (const name of ['lib', 'package.json']) fs.symlinkSync(path.join(ROOT, name), path.join(dir, name));
  fs.writeFileSync(copy, script.replace(/^GVISOR_SHA256_X86_64=\w+$/m, `GVISOR_SHA256_X86_64=${sum}`));
  return { tar, copy };
}
const ZSTD = '#!/bin/sh\nexec cat "$2"\n';

test("the machine's distribution is named, and a kernel older than 5.11 is refused before anything is installed", (t) => {
  const debian = installer(t, { osRelease: DEBIAN });
  assert.equal(debian.status, 0, debian.stderr);
  assert.match(debian.said, /✓\S* Debian GNU\/Linux 12 \(bookworm\) on Intel\/AMD/);

  const old = installer(t, { bins: { uname: '#!/bin/sh\ncase "$1" in -m) echo x86_64 ;; -r) echo 5.10.0-35-amd64 ;; *) echo Linux ;; esac\n' } });
  assert.equal(old.status, 1);
  assert.match(old.stderr, /botdot needs Linux 5\.11 or newer for each account's rootless Docker, and this machine runs 5\.10\.0-35-amd64\. Install a newer release \(Ubuntu 22\.04, Debian 12, Fedora, RHEL 9 or newer\) and run this again\./);
  assert.deepEqual(old.docker, [], 'Docker is not even asked');

  const newer = installer(t, { bins: { uname: '#!/bin/sh\ncase "$1" in -m) echo x86_64 ;; -r) echo 6.12.48+deb13-amd64 ;; *) echo Linux ;; esac\n' } });
  assert.equal(newer.status, 0, newer.stderr);
});

test("Fedora gets Docker from Docker's own dnf repository, the RHEL family from its CentOS one, started at every boot", (t) => {
  const fedora = installer(t, { osRelease: FEDORA, bins: { ...RPM_MACHINE, docker: null }, input: 'y\n' });
  assert.equal(fedora.status, 0, `${fedora.said}\n${fedora.stderr}`);
  assert.match(fedora.said, /Install Docker now, from Docker's repository \(download\.docker\.com\/linux\/fedora\)\?/);
  assert.match(fedora.system, /^curl -fsSL https:\/\/download\.docker\.com\/linux\/fedora\/docker-ce\.repo -o \S+\/yum\.repos\.d\/docker-ce\.repo$/m);
  assert.match(fedora.system, /^dnf install -y -q docker-ce docker-ce-cli containerd\.io docker-compose-plugin docker-buildx-plugin docker-ce-rootless-extras$/m);
  assert.match(fedora.system, /^systemctl enable --now docker$/m);
  assert.doesNotMatch(fedora.system, /get\.docker\.com/);

  const rocky = installer(t, { osRelease: ROCKY, bins: { ...RPM_MACHINE, docker: null, dnf: dnf(true) }, input: 'y\n' });
  assert.equal(rocky.status, 1);
  assert.match(rocky.system, /^curl -fsSL https:\/\/download\.docker\.com\/linux\/centos\/docker-ce\.repo /m);
  assert.match(rocky.stderr, /dnf couldn't install Docker from download\.docker\.com\/linux\/centos\. Install Docker Engine yourself \(https:\/\/docs\.docker\.com\/engine\/install\/\) and run this again\./);
  assert.equal(fs.existsSync(path.join(rocky.etc, 'yum.repos.d', 'docker-ce.repo')), false, "a repository that didn't install is taken away");
});

test('a machine without apt-get or dnf is told to install Docker and what botdot needs itself', (t) => {
  const none = { 'apt-get': null, dpkg: null, 'dpkg-query': null };
  const noDocker = installer(t, { bins: { ...none, docker: null } });
  assert.equal(noDocker.status, 1);
  assert.match(noDocker.stderr, /Docker isn't installed, and this installer installs it only with apt-get or dnf\. Install Docker Engine with rootless Docker \(https:\/\/docs\.docker\.com\/engine\/install\/\) and run this again\./);

  const noRunsc = installer(t, { bins: { ...none, runsc: null } });
  assert.equal(noRunsc.status, 1);
  assert.match(noRunsc.said, /needs: runsc/);
  assert.match(noRunsc.stderr, /Install them with your system's packages \(rootless Docker: https:\/\/docs\.docker\.com\/engine\/security\/rootless\/, gVisor: https:\/\/gvisor\.dev\/docs\/user_guide\/install\/\) and run this again\./);
});

test("Podman's docker command is refused with how to remove it", (t) => {
  const done = installer(t, { osRelease: FEDORA, bins: RPM_MACHINE, dockerFirst: ['[ "$1" = --version ] && { echo "podman version 5.6.2"; exit 0; }'] });
  assert.equal(done.status, 1);
  assert.match(done.stderr, /This machine's docker command is Podman's\. botdot needs Docker Engine: remove podman-docker \(sudo dnf remove podman-docker\) and run this again\./);
});

test("a distribution's own Docker, without rootless Docker, is refused before anything is installed", (t) => {
  const apt = installer(t, { bins: { 'dockerd-rootless.sh': null }, given: { STAND_IN_PACKAGES: 'docker.io' }, input: 'y\n' });
  assert.equal(apt.status, 1);
  assert.match(apt.stderr, /This machine's Docker isn't Docker's own \(docker-ce\), so it has no rootless Docker\. Remove it and install Docker Engine from Docker's repository \(https:\/\/docs\.docker\.com\/engine\/install\/\), or remove it and run this again to have it installed\./);
  assert.doesNotMatch(apt.system, /^apt-get/m);

  const dnfDone = installer(t, { osRelease: FEDORA, bins: { ...RPM_MACHINE, 'dockerd-rootless.sh': null }, given: { STAND_IN_PACKAGES: 'moby-engine' }, input: 'y\n' });
  assert.equal(dnfDone.status, 1);
  assert.match(dnfDone.stderr, /This machine's Docker isn't Docker's own \(docker-ce\)/);
  assert.doesNotMatch(dnfDone.system, /^dnf/m);
});

test("on dnf, the prerequisites come by their dnf names, and gVisor from its release files, checked by their sha256", (t) => {
  const { tar, copy } = gvisorRelease(t);
  const bins = { ...RPM_MACHINE, zstd: ZSTD, 'dockerd-rootless.sh': null, newuidmap: null, setfacl: null, runsc: null };
  const declined = installer(t, { osRelease: ROCKY, bins, script: copy, input: 'n\n', given: { STAND_IN_PACKAGES: 'docker-ce', STAND_IN_GVISOR: tar } });
  assert.equal(declined.status, 1);
  assert.match(declined.said, /Each account runs in a rootless Docker under gVisor, which needs: docker-ce-rootless-extras uidmap acl runsc/);
  assert.match(declined.said, /Install them now with dnf \(gVisor's runsc from gVisor's release 20261102\.0\)\?/);
  assert.doesNotMatch(declined.system, /^dnf/m);

  const done = installer(t, { osRelease: ROCKY, bins, script: copy, input: 'y\n', given: { STAND_IN_PACKAGES: 'docker-ce', STAND_IN_GVISOR: tar } });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  assert.match(done.system, /^dnf install -y -q docker-ce-rootless-extras shadow-utils acl$/m);
  assert.match(done.system, /^curl -fsSL --retry 2 -o \S+ https:\/\/storage\.googleapis\.com\/gvisor\/releases\/release\/20261102\.0\/x86_64\/gvisor\.tar\.zstd$/m);
  const local = path.join(done.top, 'local-bin');
  assert.equal(fs.statSync(path.join(local, 'runsc')).mode & 0o777, 0o755);
  assert.ok(fs.existsSync(path.join(local, 'gvisor-bin', 'gvisor_sentry')), "runsc's helpers beside it");
  assert.equal(fs.readFileSync(path.join(done.etc, 'botdot-gvisor'), 'utf8'), `# botdot (install.sh): gVisor 20261102.0, installed from its release files.\n${local}/runsc\n${local}/gvisor-bin\n`);
  assert.match(done.said, /Rootless Docker and gVisor \(release-20261102\.0\)/);
  assert.match(fs.readFileSync(path.join(done.dir, 'accounts', 'ann', 'share', 'runsc'), 'utf8'), new RegExp(`^RUNSC='${local}/runsc'$`, 'm'), "each account's runsc is the one in /usr/local/bin, also where sudo's PATH leaves it out");
  assert.doesNotMatch(done.said + done.stderr, /botdot is tested with/);
});

test("gVisor's download that doesn't match its pinned sha256 is not installed", (t) => {
  const { tar } = gvisorRelease(t);
  const done = installer(t, { osRelease: FEDORA, bins: { ...RPM_MACHINE, zstd: ZSTD, runsc: null }, input: 'y\n', given: { STAND_IN_GVISOR: tar } });
  assert.equal(done.status, 1);
  assert.match(done.stderr, /gVisor's download doesn't match the sha256 botdot pins for 20261102\.0\. Nothing was installed from it\./);
  assert.equal(fs.existsSync(path.join(done.top, 'local-bin', 'runsc')), false);
});

test('on dnf, a runsc of another release is named with how to install the pinned one', (t) => {
  const done = installer(t, { osRelease: FEDORA, bins: { ...RPM_MACHINE, runsc: '#!/bin/sh\necho "runsc version release-20261005.0"\n' }, args: ['--update'] });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  assert.match(done.said + done.stderr, /gVisor 20261005\.0 is installed; botdot is tested with 20261102\.0\. Once no account is busy: sudo rm \S+\/runsc && sudo sh install\.sh/);
});

test("the uninstaller offers gVisor's files and Docker's rootless package on dnf, and removes only what it named", (t) => {
  const first = installer(t, { osRelease: FEDORA, bins: RPM_MACHINE });
  assert.equal(first.status, 0, first.stderr);
  const local = path.join(first.top, 'local-bin');
  fs.mkdirSync(path.join(local, 'gvisor-bin'), { recursive: true });
  fs.writeFileSync(path.join(local, 'runsc'), '');
  fs.writeFileSync(path.join(first.etc, 'botdot-gvisor'), `# botdot (install.sh): gVisor 20261102.0, installed from its release files.\n${local}/runsc\n${local}/gvisor-bin\n/etc/passwd\n`);
  const kept = installer(t, { again: first, dotenv: '', args: ['--uninstall'], bins: RPM_MACHINE, given: { BOT_DOT_YES: '1', STAND_IN_PACKAGES: 'docker-ce-rootless-extras' } });
  assert.equal(kept.status, 0, kept.stderr);
  assert.match(kept.said, new RegExp(`botdot's installer may have installed these: docker-ce-rootless-extras and gVisor's runsc in ${local}\\.`));
  assert.ok(kept.said.includes(`The packages stay. Remove them yourself with: sudo rpm -e docker-ce-rootless-extras && sudo rm -r ${local}/runsc ${local}/gvisor-bin ${first.etc}/botdot-gvisor`), kept.said);

  const removed = installer(t, { again: first, dotenv: '', args: ['--uninstall'], bins: RPM_MACHINE, input: 'y\n', given: { STAND_IN_PACKAGES: 'docker-ce-rootless-extras' } });
  assert.equal(removed.status, 0, `${removed.said}\n${removed.stderr}`);
  assert.match(removed.system, /^rpm -e docker-ce-rootless-extras$/m);
  assert.equal(fs.existsSync(path.join(local, 'runsc')), false);
  assert.equal(fs.existsSync(path.join(local, 'gvisor-bin')), false);
  assert.equal(fs.existsSync(path.join(first.etc, 'botdot-gvisor')), false);
  assert.ok(fs.existsSync('/etc/passwd'), 'a path the mark names that is not gVisor is never removed');
  assert.match(removed.said, /Removed gVisor's runsc from/);
});

test("a kernel that restricts user namespaces gets AppArmor's profile, or, under an AppArmor too old for one, how to lift it", (t) => {
  const restricted = (done) => { const d = path.join(done.top, 'proc', 'sys', 'kernel'); fs.mkdirSync(d, { recursive: true }); fs.writeFileSync(path.join(d, 'apparmor_restrict_unprivileged_userns'), '1\n'); };
  const bins = { rootlesskit: '#!/bin/sh\n', apparmor_parser: '#!/bin/sh\necho "apparmor_parser $*" >> "$STAND_IN_LOG"\n' };
  const first = installer(t, { bins });
  assert.equal(first.status, 0, first.stderr);
  restricted(first);
  const old = installer(t, { again: first, args: ['--update'], bins });
  assert.equal(old.status, 1);
  assert.match(old.stderr, /this system's AppArmor is too old to name rootless Docker\. Lift the restriction \(echo kernel\.apparmor_restrict_unprivileged_userns=0 \| sudo tee \/etc\/sysctl\.d\/60-botdot-userns\.conf && sudo sysctl --system\)/);

  fs.mkdirSync(path.join(first.etc, 'apparmor.d', 'abi'), { recursive: true });
  fs.writeFileSync(path.join(first.etc, 'apparmor.d', 'abi', '4.0'), '');
  const ok = installer(t, { again: first, args: ['--update'], bins });
  assert.equal(ok.status, 0, `${ok.said}\n${ok.stderr}`);
  assert.match(fs.readFileSync(path.join(first.etc, 'apparmor.d', 'botdot-rootlesskit'), 'utf8'), /^profile botdot-rootlesskit \S+\/rootlesskit flags=\(unconfined\) \{\n {2}userns,\n\}$/m);
  assert.match(ok.system, /^apparmor_parser -r \S+\/botdot-rootlesskit$/m);
});

test('a newuidmap without its file capability, as a system made from a container image may have, is refused with how to fix it', (t) => {
  const lost = installer(t, { osRelease: FEDORA, bins: { ...RPM_MACHINE, getcap: '#!/bin/sh\nexit 0\n' } });
  assert.equal(lost.status, 1);
  assert.match(lost.stderr, /\/newuidmap can't map each account's IDs: it is neither setuid nor has its file capability\. Reinstall it \(sudo dnf reinstall shadow-utils\) and run this again\./);

  const kept = installer(t, { osRelease: FEDORA, bins: { ...RPM_MACHINE, getcap: '#!/bin/sh\ncase "$1" in *newuidmap) echo "$1 cap_setuid=ep" ;; *) echo "$1 cap_setgid=ep" ;; esac\n', newgidmap: '#!/bin/sh\n' } });
  assert.equal(kept.status, 0, `${kept.said}\n${kept.stderr}`);
});
