// install.sh on a stand-in machine (test/installer-helpers.js): a machine with less RAM than botdot needs is warned,
// and installed all the same (#1555). The README and docs/install-linux.md say the same minimum the installer checks.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { onLinux } = require('./linux');

const ROOT = path.join(__dirname, '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');
const MIN = Number(/^MIN_RAM_GB=(\d+)$/m.exec(read('install.sh'))[1]);

test('the README and the Linux install guide say the RAM the installer checks', () => {
  assert.ok(MIN > 0);
  assert.match(read('README.md'), new RegExp(`\\| \\*\\*Size\\*\\* \\| \\d+ CPUs, ${MIN} GB RAM,`));
  assert.match(read('docs/install-linux.md'), new RegExp(`at least 4 CPUs, ${MIN} GB of RAM and .* less than ${MIN} GB of RAM`));
});

// A /proc of its own, with this much RAM in kB.
function proc(t, kb) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-proc-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'meminfo'), `MemTotal:       ${kb} kB\nMemFree:         500000 kB\nMemAvailable:    ${Math.max(kb - 1000000, 0)} kB\n`);
  return dir;
}
const WARNING = /This machine has [\d.]+ GB of RAM, and botdot needs at least \d+ GB for one account\. The install goes on/;

test('a machine below the minimum is warned, with its RAM and the minimum, and installed all the same', onLinux('install.sh uses GNU sed and stat'), (t) => {
  const { installer } = require('./installer-helpers');
  // The QA machine of #1555: 2 GB, 1.95 GB of it usable.
  const small = installer(t, { given: { BOT_DOT_PROC: proc(t, 2044723) } });
  assert.equal(small.status, 0, `${small.said}\n${small.stderr}`);
  assert.match(small.said, new RegExp(`This machine has 1\\.9 GB of RAM, and botdot needs at least ${MIN} GB for one account\\. The install goes on`));
  assert.equal(small.said.match(WARNING).length, 1, 'said once');
  assert.match(small.said, /BOTDOT_READY /, 'the install completes');
});

test('a machine at the minimum, as its /proc/meminfo has it, is not warned', onLinux('install.sh uses GNU sed and stat'), (t) => {
  const { installer } = require('./installer-helpers');
  // A VPS sold with 8 GB shows a little less in MemTotal.
  const eight = installer(t, { given: { BOT_DOT_PROC: proc(t, 8008720) } });
  assert.equal(eight.status, 0, `${eight.said}\n${eight.stderr}`);
  assert.doesNotMatch(eight.said, WARNING);
  const big = installer(t, { given: { BOT_DOT_PROC: proc(t, 16303564) } });
  assert.equal(big.status, 0, big.stderr);
  assert.doesNotMatch(big.said, WARNING);
  // 7.4 GB rounds to 7: below.
  const under = installer(t, { given: { BOT_DOT_PROC: proc(t, 7759462) } });
  assert.equal(under.status, 0, under.stderr);
  assert.match(under.said, /This machine has 7\.4 GB of RAM/);
});

test('no warning on the desktop app\'s botdot, whose VM the app sizes', onLinux('install.sh uses GNU sed and stat'), (t) => {
  const { installer } = require('./installer-helpers');
  const local = installer(t, { dotenv: '', given: { BOT_DOT_REACH: 'local', BOT_DOT_PROC: proc(t, 2044723) } });
  assert.equal(local.status, 0, `${local.said}\n${local.stderr}`);
  assert.doesNotMatch(local.said, WARNING, 'the desktop app sizes its own VM');
});
