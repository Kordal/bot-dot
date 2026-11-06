// Decisions are one file each in docs/decisions/, so two pull requests never conflict on a shared file (the old
// docs/DECISIONS.md did, on its last line, at almost every merge). ADR numbers are checked here too: two changes
// made side by side can each take the next free number.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const DIR = path.join(ROOT, 'docs', 'decisions');
const NAME = /^(\d{4}-\d{2}-\d{2})-[a-z0-9]+(-[a-z0-9]+)*\.md$/;

test('every decision is a file named YYYY-MM-DD-short-name.md holding one line that starts with its date', () => {
  const files = fs.readdirSync(DIR).filter((f) => f !== 'README.md');
  assert.ok(files.length > 0, 'docs/decisions/ has decisions');
  for (const f of files) {
    const m = f.match(NAME);
    assert.ok(m, `docs/decisions/${f} is named YYYY-MM-DD-short-name.md`);
    const text = fs.readFileSync(path.join(DIR, f), 'utf8').trim();
    assert.ok(text.startsWith(`${m[1]}: `) || text.startsWith(`${m[1]} (`), `docs/decisions/${f} starts with "${m[1]}: "`);
    assert.ok(!text.includes('\n'), `docs/decisions/${f} is one line`);
  }
});

test('docs/DECISIONS.md takes no decisions: a new one is a file in docs/decisions/', () => {
  const text = fs.readFileSync(path.join(ROOT, 'docs', 'DECISIONS.md'), 'utf8');
  assert.deepEqual(text.split('\n').filter((l) => /^- \d{4}-\d{2}-\d{2}/.test(l)), [], 'move these lines to files in docs/decisions/');
});

// 105 was taken twice before this check; both are linked as they are, so they keep it.
const SHARED_BEFORE = new Set([105]);

test('no two ADRs share a number', () => {
  const seen = new Map();
  for (const f of fs.readdirSync(path.join(ROOT, 'docs', 'adr'))) {
    const m = f.match(/^(\d+)-/);
    if (!m) continue;
    const n = Number(m[1]);
    assert.ok(!seen.has(n) || SHARED_BEFORE.has(n), `ADR ${n} is taken by both ${seen.get(n)} and ${f}: give the newer one the next free number`);
    seen.set(n, f);
  }
});
