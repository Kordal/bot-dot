// What runs only on Linux is tested on Linux only (#1273): install.sh and the bots' computers use GNU sed, stat,
// realpath and find, /proc, prctl and SO_PEERCRED, which macOS does not have. Off Linux those tests skip, saying why,
// so that `make test` on a Mac fails only for what is broken. CI runs them all on Linux.
const nodeTest = require('node:test');

const LINUX = process.platform === 'linux';
// onLinux(why): a test's options that skip it off Linux.
const onLinux = (why) => (LINUX ? {} : { skip: `Linux only: ${why}` });
// linuxOnlyFile(why): true off Linux, after one skipped test says why; the file then returns before it does anything.
function linuxOnlyFile(why) {
  if (LINUX) return false;
  nodeTest.test(require('node:path').basename(require.main?.filename || 'this file'), onLinux(why), () => {});
  return true;
}

module.exports = { LINUX, onLinux, linuxOnlyFile };
