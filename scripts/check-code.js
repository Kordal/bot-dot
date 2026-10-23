#!/usr/bin/env node
// Code checks, part of `make lint` (#77), with nothing installed: every JavaScript file of the repository (tracked,
// or new and not ignored) parses (`node --check`), apart from the copies of others' code (vendor/) and the apps'
// own folders. Files given as arguments are checked instead. The type checks are scripts/typecheck.sh.
const path = require('path');
const os = require('os');
const { execFile, execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SKIP = /^(vendor|android|macos|marketing)\//;

const given = process.argv.slice(2);
const files = given.length ? given : execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '*.js', '*.mjs', '*.cjs'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter((f) => f && !SKIP.test(f));
// Whether file f parses; a file that doesn't is named with Node's reason.
const parses = (f) => new Promise((resolve) => execFile(process.execPath, ['--check', f], { cwd: ROOT, encoding: 'utf8' }, (err, _out, stderr) => {
  if (err) process.stderr.write(`${f}\n${stderr}\n`);
  resolve(!err);
}));

async function main() {
  // One Node per file, as many at once as the machine has cores: one after another took 16 s in CI.
  const failed = [];
  let next = 0;
  const worker = async () => { while (next < files.length) { const f = files[next++]; if (!(await parses(f))) failed.push(f); } };
  await Promise.all(Array.from({ length: os.availableParallelism() }, worker));
  if (failed.length) {
    console.error(`FAIL  ${failed.length} of ${files.length} JavaScript files don't parse`);
    process.exit(1);
  }
  console.log(`PASS  ${files.length} JavaScript files parse`);
}
main();
