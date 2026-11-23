// install.sh on a stand-in machine (test/installer-helpers.js): a machine whose disk is smaller than botdot needs is
// warned and asked whether to go on (#1561), the default words of the install say nothing of "root" or "SELinux", and a
// download is one line, its layers in install.log. The README and docs/install-linux.md say the same disk.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { onLinux } = require('./linux');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const MIN = Number(/^MIN_DISK_GB=(\d+)$/m.exec(read('install.sh'))[1]);
const GIB = 1048576; // kB in a GiB

test('the README and the Linux install guide say the disk the installer checks', () => {
  assert.ok(MIN > 0);
  assert.match(read('README.md'), new RegExp(`\\| \\*\\*Size\\*\\* \\| \\d+ CPUs, \\d+ GB RAM recommended, ${MIN} GB disk for one account`));
  assert.match(read('docs/install-linux.md'), new RegExp(`${MIN} GB of disk for one account.* a disk under ${MIN} GB`));
});

const WARNING = /This machine's disk is (\d+) GB \((\d+) GB free\), and botdot needs \d+ GB\. With less, the install can run out of space\./;
const ASK = 'Continue anyway? [y/N] ';
const small = (gib, free = 14) => ({ STAND_IN_ROOT_TOTAL: String(gib * GIB), STAND_IN_ROOT_FREE: String(free * GIB) });
// df's whole GB (10^9 bytes) of n GiB.
const gb = (gib) => Math.floor((gib * 2 ** 30) / 1e9);

test('a 20 GB disk is warned, with its size and what is free, and installed once nobody answers', onLinux('install.sh uses GNU sed and stat'), (t) => {
  const { installer } = require('./installer-helpers');
  // The QA machine of #1561: an install on 20 GB failed.
  const done = installer(t, { given: small(20) });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  const [, total, free] = done.said.match(WARNING);
  assert.equal(Number(total), gb(20));
  assert.equal(Number(free), gb(14));
  assert.equal(done.said.split(ASK).length - 1, 1, 'one question');
  assert.ok(done.said.indexOf(ASK) > done.said.indexOf('This machine\'s disk'), 'asked after the warning');
  assert.match(done.said, /BOTDOT_READY /, 'the install completes');
});

test('a "no" stops the install before it changes anything, a "yes" goes on', onLinux('install.sh uses GNU sed and stat'), (t) => {
  const { installer } = require('./installer-helpers');
  const no = installer(t, { given: small(20), input: 'n\n' });
  assert.equal(no.status, 1);
  assert.match(no.said, WARNING);
  assert.match(no.stderr, /Nothing was changed\./);
  assert.deepEqual(no.docker, [], 'Docker was not asked anything');
  assert.doesNotMatch(no.said, /BOTDOT_READY /);
  // Enter alone is a "no" too: the default is no.
  const enter = installer(t, { given: small(20), input: '\n' });
  assert.equal(enter.status, 1, enter.said);
  const yes = installer(t, { given: small(20), input: 'y\n' });
  assert.equal(yes.status, 0, `${yes.said}\n${yes.stderr}`);
  assert.match(yes.said, /BOTDOT_READY /);
});

test('BOT_DOT_YES=1 warns and goes on without asking', onLinux('install.sh uses GNU sed and stat'), (t) => {
  const { installer } = require('./installer-helpers');
  const done = installer(t, { given: { ...small(20), BOT_DOT_YES: '1' }, input: 'n\n' });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  assert.match(done.said, WARNING);
  assert.doesNotMatch(done.said, /Continue anyway/);
});

test('a disk of 40 GB, as it is sold, is not warned, and a 32 GB one is', onLinux('install.sh uses GNU sed and stat'), (t) => {
  const { installer } = require('./installer-helpers');
  // A 40 GiB disk shows 42 GB; one of 40 GB shows about 38.
  for (const kb of [40 * GIB, 36 * GIB, 60 * GIB]) {
    const ok = installer(t, { given: { STAND_IN_ROOT_TOTAL: String(kb), STAND_IN_ROOT_FREE: String(30 * GIB) } });
    assert.equal(ok.status, 0, `${ok.said}\n${ok.stderr}`);
    assert.doesNotMatch(ok.said, /disk is|Continue anyway/, `${kb / GIB} GiB is enough`);
  }
  const under = installer(t, { given: small(32) });
  assert.match(under.said, new RegExp(`This machine's disk is ${gb(32)} GB`));
});

test('a small RAM and a small disk are one question', onLinux('install.sh uses GNU sed and stat'), (t) => {
  const { installer } = require('./installer-helpers');
  const proc = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'botdot-proc-'));
  t.after(() => fs.rmSync(proc, { recursive: true, force: true }));
  fs.writeFileSync(path.join(proc, 'meminfo'), 'MemTotal:       2044723 kB\nMemFree:         500000 kB\nMemAvailable:    1044723 kB\n');
  const both = installer(t, { given: { ...small(20), BOT_DOT_PROC: proc }, input: 'y\n' });
  assert.equal(both.status, 0, `${both.said}\n${both.stderr}`);
  assert.match(both.said, /This machine has 1\.9 GB of RAM/);
  assert.match(both.said, WARNING);
  assert.equal(both.said.split(ASK).length - 1, 1);
});

test('the desktop app\'s botdot, whose VM the app sizes, is not warned of its disk', onLinux('install.sh uses GNU sed and stat'), (t) => {
  const { installer } = require('./installer-helpers');
  const local = installer(t, { dotenv: '', given: { ...small(20), BOT_DOT_REACH: 'local' } });
  assert.equal(local.status, 0, `${local.said}\n${local.stderr}`);
  assert.doesNotMatch(local.said, /disk is|Continue anyway/);
});

test('a machine whose disk df can\'t read is not warned', onLinux('install.sh uses GNU sed and stat'), (t) => {
  const { installer } = require('./installer-helpers');
  const done = installer(t, { bins: { df: '#!/bin/sh\nexit 1\n' } });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  assert.doesNotMatch(done.said, /disk is|Continue anyway/);
});

test('the install says nothing of root or SELinux, and a download is one line', onLinux('install.sh uses GNU sed and stat'), (t) => {
  const { installer } = require('./installer-helpers');
  // Docker's pull, as it says it: a line for each layer.
  const layers = ['5f7a1c: Pulling fs layer', '5f7a1c: Downloading [=====>   ] 12.3MB/48MB', '5f7a1c: Download complete', '5f7a1c: Pull complete', 'Status: Downloaded newer image'];
  const pulling = layers.map((l) => `echo "${l}"`).join('; ');
  const done = installer(t, {
    dotenv: '', input: '1\nbotdot.example.com\nann\n',
    bins: { getenforce: '#!/bin/sh\necho Enforcing\n' },
    dockerFirst: [`[ "$1" = pull ] && { ${pulling}; }`],
  });
  const said = done.said.replace(/\u001b\[[0-9;]*m/g, '');
  assert.equal(done.status, 0, `${said}\n${done.stderr}`);
  assert.doesNotMatch(said, /\broot\b|SELinux/i, 'no jargon in what a person is shown');
  assert.match(said, /extra security layer is strict, and botdot isn't tested with it yet/);
  assert.match(said, /^ {2}Downloading bot-dot…$/m, 'one line for an image');
  assert.doesNotMatch(said, /Pulling fs layer|Pull complete|Download complete|Downloaded newer image/, 'the layers are hidden');
  const log = fs.readFileSync(path.join(done.dir, 'install.log'), 'utf8');
  assert.match(log, /== docker pull ghcr\.io\/ladrok\/bot-dot@/);
  assert.match(log, /5f7a1c: Pull complete/, 'and kept whole in the install log');
  assert.equal(fs.statSync(path.join(done.dir, 'install.log')).mode & 0o777, 0o600);
});

test('BOT_DOT_VERBOSE=1 shows the layers and the technical words', onLinux('install.sh uses GNU sed and stat'), (t) => {
  const { installer } = require('./installer-helpers');
  const done = installer(t, {
    dotenv: '', input: '1\nbotdot.example.com\nann\n', given: { BOT_DOT_VERBOSE: '1' },
    bins: { getenforce: '#!/bin/sh\necho Enforcing\n' },
    dockerFirst: ['[ "$1" = pull ] && { echo "5f7a1c: Pull complete"; }'],
  });
  assert.equal(done.status, 0, `${done.said}\n${done.stderr}`);
  assert.match(done.said, /5f7a1c: Pull complete/);
  assert.match(done.said, /SELinux is enforcing/);
  assert.match(fs.readFileSync(path.join(done.dir, 'install.log'), 'utf8'), /5f7a1c: Pull complete/, 'and the log has it all the same');
});
