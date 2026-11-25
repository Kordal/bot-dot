// The installer on distributions other than Ubuntu (install.sh, step 1): Debian and Ubuntu through apt-get, Fedora and
// the RHEL family through dnf, gVisor from its release files where apt-get isn't, and a clear stop where a machine
// can't run botdot or its packages can't be installed by the installer.
// Part 2 of 2 of the distributions tests: the parts run side by side, so that none takes more than about three minutes in CI (docs/decisions/2026-11-25-installer-tests-in-parts.md).
const { test } = require('node:test');
if (require('./linux').linuxOnlyFile('install.sh uses GNU sed and stat')) return;
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { installer } = require('./installer-helpers');

const FEDORA = 'NAME="Fedora Linux"\nVERSION_ID=43\nID=fedora\nPRETTY_NAME="Fedora Linux 43 (Server Edition)"\n';

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
