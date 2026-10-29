// The skill kit:shopping (#682, ADR 113): how a bot or the Chief shows products to buy as product cards. It ships in
// bot-skills/ beside kit:pages, so every bot is told of it in one line and loads it only when it shops: the bot's
// own prompt does not grow by the rules.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { parseSkillMd, kitSkills, KIT_DIR } = require('../lib/skills');
const { read, esc, words } = require('./web-page');

const text = fs.readFileSync(path.join(KIT_DIR, 'skills', 'shopping', 'SKILL.md'), 'utf8');
const page = vm.createContext({ ...words, esc, URL });
vm.runInContext(`${read('products.js')}\nthis.Products = Products;`, page);

test('kit:shopping says when to use it, in one short line every bot is told', () => {
  const { meta, body } = parseSkillMd(text);
  assert.equal(meta.name, 'shopping');
  assert.match(meta.description, /product cards/);
  assert.match(meta.description, /find, compare or buy/);
  assert.ok(meta.description.length <= 200);
  assert.match(body, /^# /m);
  assert.ok(kitSkills().some((k) => k.name === 'shopping'));
});

test('its example is drawn whole: every product read, the pick first with its why', () => {
  const fences = [...text.matchAll(/```products\n([\s\S]*?)\n```/g)].map((m) => m[1]);
  assert.equal(fences.length, 1);
  const json = JSON.parse(fences[0]);
  const products = page.Products.parse(fences[0]);
  assert.equal(products.length, json.length);
  assert.ok(products[0].why && products[0].url && products[0].image);
  assert.equal(products[1].off, 15);
  // Every field the skill names is one the cards read.
  const named = [...text.matchAll(/^\| `([a-z]+)`(?:, `([a-z]+)`)? \|/gm)].flatMap((m) => m.slice(1).filter(Boolean));
  assert.deepEqual(named.sort(), ['arrives', 'image', 'name', 'price', 'rating', 'reviews', 'store', 'url', 'was', 'why']);
  for (const k of named) assert.ok(k in products[0], k);
});

test('a run with one kit skill switched off loads a copy of the kit without it, gone with the run', () => {
  const os = require('os');
  const skills = require('../lib/skills').create(fs.mkdtempSync(path.join(os.tmpdir(), 'kit-pack-')));
  assert.equal(skills.kitPack('run1', []), KIT_DIR, 'nothing off: the kit itself');
  assert.equal(skills.kitPack('run1', ['kit:pages', 'shopping']), null, 'all off: none');
  const dir = skills.kitPack('run1', ['kit:shopping']);
  assert.match(path.basename(dir), /^run1-kit$/);
  assert.deepEqual(fs.readdirSync(path.join(dir, 'skills')), ['pages']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, '.claude-plugin', 'plugin.json'), 'utf8')).name, 'kit');
  skills.removePack('run1');
  assert.equal(fs.existsSync(dir), false);
});
