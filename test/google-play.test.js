// The Play listing and its App content answers (docs/google-play, ADR 173): within Play's limits, and in step with
// what the Play build asks for.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '../docs/google-play');
const png = require('../docs/google-play/png.cjs');
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
      // The heading says the block's length, so whoever pastes it sees the count without counting.
      const said = md.match(new RegExp(`^## ${heading} \\(${max}\\): (\\d+)$`, 'm'));
      assert.ok(said, `${file} ${heading}: the heading should read "## ${heading} (${max}): <length>"`);
      assert.equal(Number(said[1]), [...text].length, `${file} ${heading}: the heading's count is out of date`);
    }
  });
}

test('the icon and the feature graphics are the sizes and kinds Play takes', () => {
  const icon = png.info(fs.readFileSync(path.join(DIR, 'graphics', 'icon-512.png')));
  assert.deepEqual([icon.width, icon.height, icon.bitDepth, icon.colorType], [512, 512, 8, 6], 'the icon: 512 x 512, 32-bit PNG');
  for (const f of ['feature-1024x500.png', 'feature-1024x500-pl.png']) {
    const i = png.info(fs.readFileSync(path.join(DIR, 'graphics', f)));
    assert.deepEqual([i.width, i.height, i.alpha], [1024, 500, false], `${f}: 1024 x 500, no alpha`);
  }
});

test('the phone screenshots are what Play takes: 2 to 8 a language, 9:16, 320 to 3840 pixels a side, no alpha', () => {
  const sets = ['raw', 'en', 'pl'].map((d) => fs.readdirSync(path.join(DIR, 'screenshots', d)).filter((f) => f.endsWith('.png')).sort());
  assert.ok(sets[0].length >= 4 && sets[0].length <= 8, `${sets[0].length} screenshots`);
  assert.deepEqual(sets[1], sets[0], 'en/ has one captioned picture for each in raw/');
  assert.deepEqual(sets[2], sets[0], 'pl/ has one captioned picture for each in raw/');
  for (const d of ['raw', 'en', 'pl']) {
    for (const f of sets[0]) {
      const i = png.info(fs.readFileSync(path.join(DIR, 'screenshots', d, f)));
      assert.equal(i.width * 16, i.height * 9, `${d}/${f}: ${i.width} x ${i.height} is not 9:16`);
      assert.ok(Math.min(i.width, i.height) >= 320 && Math.max(i.width, i.height) <= 3840, `${d}/${f}: a side out of 320 to 3840`);
      assert.equal(i.alpha, false, `${d}/${f} has an alpha channel`);
    }
  }
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

test('Play Console names the site\'s privacy and deletion pages, the ones the App Store names', () => {
  const answers = read('console-answers.md');
  assert.match(answers, /`https:\/\/botdot\.app\/privacy`/);
  assert.match(answers, /deletion URL: `https:\/\/botdot\.app\/account-deletion`/);
  assert.doesNotMatch(answers, /github\.com\/(?:Kordal|ladrok)\/bot-dot\/blob/);
  const store = fs.readFileSync(path.join(__dirname, '../docs/app-store/connect-answers.md'), 'utf8');
  assert.match(store, /https:\/\/botdot\.app\/privacy\b/);
});

test('png.cjs saves a picture with or without alpha and keeps its pixels', () => {
  const rgba = Buffer.from([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 10, 20, 30, 255]);
  for (const alpha of [true, false]) {
    const file = png.encode({ width: 2, height: 2, rgba }, alpha);
    const i = png.info(file);
    assert.deepEqual([i.width, i.height, i.colorType, i.alpha], [2, 2, alpha ? 6 : 2, alpha]);
    assert.deepEqual(png.decode(file).rgba, rgba);
  }
  const seeThrough = Buffer.from(rgba); seeThrough[3] = 0;
  assert.throws(() => png.encode({ width: 2, height: 2, rgba: seeThrough }, false), /not opaque/);
  // A real picture, as Chromium filters its lines: decoded, saved again and decoded, the same pixels.
  const icon = fs.readFileSync(path.join(DIR, 'graphics', 'icon-512.png'));
  assert.deepEqual(png.decode(png.encode(png.decode(icon), false)).rgba, png.decode(icon).rgba);
});
