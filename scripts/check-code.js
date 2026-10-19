#!/usr/bin/env node
// Code checks, part of `make lint` (#77), with nothing installed: every JavaScript file of the repository (tracked,
// or new and not ignored) parses (`node --check`), apart from the copies of others' code (vendor/) and the apps'
// own folders. Files given as arguments are checked instead. The type checks are scripts/typecheck.sh.
const path = require('path');
const { execFileSync, spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const SKIP = /^(vendor|android|macos|marketing)\//;

const given = process.argv.slice(2);
const files = given.length ? given : execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard', '*.js', '*.mjs', '*.cjs'], { cwd: ROOT, encoding: 'utf8' })
  .split('\n').filter((f) => f && !SKIP.test(f));
const failed = files.filter((f) => {
  const r = spawnSync(process.execPath, ['--check', f], { cwd: ROOT, encoding: 'utf8' });
  if (r.status !== 0) process.stderr.write(`${f}\n${r.stderr}\n`);
  return r.status !== 0;
});
if (failed.length) {
  console.error(`FAIL  ${failed.length} of ${files.length} JavaScript files don't parse`);
  process.exit(1);
}
console.log(`PASS  ${files.length} JavaScript files parse`);
