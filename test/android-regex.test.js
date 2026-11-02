// Android's regular expressions run on ICU, not on the JVM's engine (#867): an inline flag ICU does not know, such as
// (?U), compiles in the app's unit tests and stops the app on the phone. ICU knows i, m, s, x and w.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const MAIN = path.join(__dirname, '..', 'android/app/src/main');

function kotlinFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    return e.isDirectory() ? kotlinFiles(p) : e.name.endsWith('.kt') ? [p] : [];
  });
}

// An inline flag group, (?flags) or (?flags:...), on a line that builds a regular expression.
const BUILDS = /Regex\(|toRegex\(|Pattern\.compile\(/;
const FLAGS = /\(\?([a-zA-Z]*)(?:-([a-zA-Z]*))?[):]/g;

test('no Android regular expression uses an inline flag ICU rejects', () => {
  const found = [];
  for (const f of kotlinFiles(MAIN)) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (!BUILDS.test(line) || /^\s*(\/\/|\*)/.test(line)) return;
      const code = line.split(' // ')[0]; // a comment after the code says what it likes
      for (const m of code.matchAll(FLAGS)) {
        if (/[^imsxw]/.test((m[1] || '') + (m[2] || ''))) found.push(`${path.relative(MAIN, f)}:${i + 1} ${m[0]}`);
      }
    });
  }
  assert.deepEqual(found, []);
});

test('the check finds (?U)', () => {
  const line = 'private val X = Regex("""(?U)\\S*""")';
  assert.ok(BUILDS.test(line));
  assert.ok([...line.matchAll(FLAGS)].some((m) => /[^imsxw]/.test(m[1])));
});
