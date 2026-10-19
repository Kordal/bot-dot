// make lint's code checks (#77): scripts/check-code.js fails on a file that doesn't parse, and every file the type
// checks include (tsconfig.json) is marked // @ts-check, so that tsc checks it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const { ROOT } = require('./helpers');

const check = (...files) => spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'check-code.js'), ...files], { cwd: ROOT, encoding: 'utf8' });

test("check-code.js passes code that parses and fails, naming it, a file that doesn't", (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-code-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'good.js'), 'const a = 1;\nmodule.exports = { a };\n');
  fs.writeFileSync(path.join(dir, 'bad.js'), 'const a = ;\n');
  const good = check(path.join(dir, 'good.js'));
  assert.equal(good.status, 0, good.stderr);
  assert.match(good.stdout, /PASS {2}1 JavaScript files parse/);
  const bad = check(path.join(dir, 'good.js'), path.join(dir, 'bad.js'));
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /bad\.js/);
  assert.match(bad.stderr, /FAIL {2}1 of 2 JavaScript files don't parse/);
});

test('every file the type checks include is marked // @ts-check', () => {
  const { include } = JSON.parse(fs.readFileSync(path.join(ROOT, 'tsconfig.json'), 'utf8'));
  const files = include.flatMap((g) => (g.endsWith('/*.js') ? fs.readdirSync(path.join(ROOT, path.dirname(g))).filter((f) => f.endsWith('.js')).map((f) => path.join(path.dirname(g), f)) : [g]));
  assert.ok(files.length >= 8);
  for (const f of files) assert.match(fs.readFileSync(path.join(ROOT, f), 'utf8'), /^(#!.*\n)?\/\/ @ts-check\n/, f);
});
