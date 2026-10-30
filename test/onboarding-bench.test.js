// The onboarding bench (#805, scripts/onboarding-bench.js): ten asks, and the stand-in run passes every check, so the
// script and the fixture stay in step with lib/company-chief.js and lib/company-team.js. The live run is by hand.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { execFileSync } = require('child_process');

test('the bench has ten asks and its stand-in run passes them all', () => {
  const out = JSON.parse(execFileSync(process.execPath, [path.join(__dirname, '..', 'scripts', 'onboarding-bench.js'), '--json'], { encoding: 'utf8' }));
  assert.equal(out.of, 10);
  assert.equal(out.passed, 10, JSON.stringify(out.rows.filter((r) => !r.ok)));
  assert.deepEqual(new Set(out.rows.map((r) => r.shape)), new Set(['ops', 'site', 'venture', 'goal']));
});
