// The App Store listing and its App Store Connect answers (docs/app-store, #1374): within Apple's limits, free of what
// review rejects in metadata, and in step with the data types the app's privacy manifests declare.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const DIR = path.join(__dirname, '../docs/app-store');
const read = (f) => fs.readFileSync(path.join(DIR, f), 'utf8');
/** The text of the code block under a heading. */
const block = (md, heading) => {
  const m = md.match(new RegExp(`^## ${heading}[^\\n]*\\n+\`\`\`\\n([\\s\\S]*?)\\n\`\`\``, 'm'));
  assert.ok(m, `no block under "${heading}"`);
  return m[1];
};

const LIMITS = [['App name', 30], ['Subtitle', 30], ['Promotional text', 170], ['Description', 4000], ['Keywords', 100]];

for (const file of ['listing-en.md', 'listing-pl.md']) {
  test(`${file} keeps to the App Store's lengths and says nothing review rejects`, () => {
    const md = read(file);
    for (const [heading, max] of LIMITS) {
      const text = block(md, heading);
      assert.ok(text.trim().length > 0, `${file} ${heading} is empty`);
      assert.ok([...text].length <= max, `${file} ${heading}: ${[...text].length} > ${max}`);
    }
    // 3.1.1 and 2.3.10: no price, purchase or other platform; 2.3.7: no other company's trademark as a keyword.
    const all = LIMITS.map(([h]) => block(md, h)).join('\n');
    assert.doesNotMatch(all, /€|\$|\bprice|\bcena|\bsubscribe now|google play|android/i);
    assert.doesNotMatch(block(md, 'Keywords'), /claude|anthropic|openai|chatgpt|apple|iphone/i);
    assert.doesNotMatch(block(md, 'Keywords'), /, /, 'keywords are separated by commas alone');
    for (const heading of ['Support URL', 'Marketing URL']) assert.match(block(md, heading), /^https:\/\/\S+$/);
  });
}

test('App Privacy names every data type the privacy manifests declare, and no tracking', () => {
  const answers = read('connect-answers.md');
  for (const target of ['BotDot', 'BotDotShare']) {
    const manifest = fs.readFileSync(path.join(__dirname, '../ios', target, 'PrivacyInfo.xcprivacy'), 'utf8');
    const types = [...manifest.matchAll(/<string>(NSPrivacyCollectedDataType(?!Purpose)\w+)<\/string>/g)].map((m) => m[1]);
    assert.ok(types.length > 0, target);
    for (const type of types) assert.match(answers, new RegExp('`' + type + '`'), `${target}: ${type} is not in connect-answers.md`);
    assert.match(manifest, /<key>NSPrivacyTracking<\/key>\s*<false\/>/, `${target} tracks nobody`);
  }
  assert.match(answers, /Used for tracking\? \*\*No\*\*/);
  assert.match(answers, /^`https:\/\/botdot\.app\/privacy`$/m);
});

test('the app links the same privacy policy App Store Connect names, on the address screen and in Settings (5.1.1(i))', () => {
  const url = read('connect-answers.md').match(/## Privacy Policy URL\n+`([^`]+)`/)[1];
  const ios = (f) => fs.readFileSync(path.join(__dirname, '../ios/BotDot', f), 'utf8');
  assert.ok(ios('Screens.swift').includes(`static let privacyPolicy = URL(string: "${url}")!`), 'Legal.privacyPolicy');
  const address = ios('Screens.swift').match(/struct AddressView: View \{[\s\S]*?\n\}\n/)[0];
  assert.match(address, /Link\(tr\("Privacy policy"\), destination: Legal\.privacyPolicy\)/, 'the address screen');
  assert.match(ios('SettingsView.swift'), /Link\(tr\("Privacy policy"\), destination: Legal\.privacyPolicy\)/, 'Settings');
});
