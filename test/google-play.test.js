// The Play listing and its App content answers (docs/google-play, ADR 172): within Play's limits, and in step with
// what the Play build asks for.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '../docs/google-play');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
/** The text of the code block under a heading. */
const block = (md, heading) => {
  const m = md.match(new RegExp(`^## ${heading}[^\\n]*\\n+\`\`\`\\n([\\s\\S]*?)\\n\`\`\``, 'm'));
  assert.ok(m, `no block under "${heading}"`);
  return m[1];
};

for (const file of ['listing-en.md', 'listing-pl.md']) {
  test(`${file} keeps to Play's lengths`, () => {
    const md = read(file);
    for (const [heading, max] of [['App name', 30], ['Short description', 80], ['Full description', 4000]]) {
      const text = block(md, heading);
      assert.ok(text.trim().length > 0, `${file} ${heading} is empty`);
      assert.ok([...text].length <= max, `${file} ${heading}: ${[...text].length} > ${max}`);
    }
  });
}

test('the graphics are the sizes Play takes', () => {
  const size = (f) => { const b = fs.readFileSync(path.join(DIR, 'graphics', f)); return [b.readUInt32BE(16), b.readUInt32BE(20)]; };
  assert.deepEqual(size('icon-512.png'), [512, 512]);
  assert.deepEqual(size('feature-1024x500.png'), [1024, 500]);
});

test('the privacy policy names every permission the Play build asks for', () => {
  const manifest = fs.readFileSync(path.join(__dirname, '../android/app/src/main/AndroidManifest.xml'), 'utf8');
  const removed = fs.readFileSync(path.join(__dirname, '../android/app/src/play/AndroidManifest.xml'), 'utf8');
  const gone = [...removed.matchAll(/android:name="android\.permission\.(\w+)" tools:node="remove"/g)].map((m) => m[1]);
  assert.deepEqual(gone.sort(), ['REQUEST_IGNORE_BATTERY_OPTIMIZATIONS', 'REQUEST_INSTALL_PACKAGES']);
  const asked = [...manifest.matchAll(/<uses-permission android:name="android\.permission\.(\w+)"/g)].map((m) => m[1]).filter((p) => !gone.includes(p));
  const words = { INTERNET: /Internet/, ACCESS_NETWORK_STATE: /network state/, POST_NOTIFICATIONS: /Notifications/, FOREGROUND_SERVICE: /Foreground service/, FOREGROUND_SERVICE_SPECIAL_USE: /Foreground service/, RECEIVE_BOOT_COMPLETED: /start at boot/ };
  const policy = read('privacy.md');
  for (const p of asked) {
    assert.ok(words[p], `${p} is new: say why in privacy.md and console-answers.md, then add it here`);
    assert.match(policy, words[p], p);
  }
});
