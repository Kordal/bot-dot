#!/usr/bin/env node
// npm test: the tests, then a check that they left no stand-in Claude (fixtures/fake-claude.js) of this
// checkout running. One that outlives its test server goes on for hours, and they add up run after run.
// Those already there before the tests began (an earlier run's) are not counted. Arguments go to node --test.
const os = require('os');
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const FAKE_CLAUDE = path.join(__dirname, 'fixtures', 'fake-claude.js');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// The stand-in Claudes of this checkout that are running now: [{ pid, command }].
function fakes() {
  const out = execFileSync('ps', ['-A', '-ww', '-o', 'pid=', '-o', 'command='], { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return out.split('\n').map((line) => line.match(/^\s*(\d+)\s+(.*)$/)).filter((m) => m && m[2].includes(FAKE_CLAUDE))
    .map((m) => ({ pid: Number(m[1]), command: m[2] }));
}

async function main() {
  let before;
  try { before = new Set(fakes().map((f) => f.pid)); } catch (e) { console.error(`No check for leftover stand-in Claudes: ps did not run (${e.message})`); }
  // Two test files per core: most of a test's time is spent waiting on its server, not computing.
  const concurrency = Math.max(4, os.availableParallelism() * 2);
  const tests = spawn(process.execPath, ['--test', `--test-concurrency=${concurrency}`, 'test/*.test.js', 'tests/*.test.js', ...process.argv.slice(2)], { cwd: ROOT, stdio: 'inherit' });
  const code = await new Promise((resolve) => { tests.on('error', () => resolve(1)); tests.on('exit', (c) => resolve(c ?? 1)); });
  if (!before) process.exit(code);
  // One whose server has just gone ends within a moment by itself; what is still there after that was left.
  let left = [];
  for (const end = Date.now() + 5000; ;) {
    left = fakes().filter((f) => !before.has(f.pid));
    if (!left.length || Date.now() > end) break;
    await sleep(200);
  }
  if (left.length) {
    console.error(`\nThe tests left ${left.length} stand-in Claude${left.length === 1 ? '' : 's'} running (test/fixtures/fake-claude.js):`);
    for (const f of left) console.error(`  ${f.pid}  ${f.command.slice(0, 200)}`);
    console.error(`A test ended, or lost its server, with a run still going. Stop them with: kill ${left.map((f) => f.pid).join(' ')}`);
    process.exit(code || 1);
  }
  process.exit(code);
}

module.exports = { fakes };
if (require.main === module) main();
