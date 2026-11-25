// The model of the background calls is named once (lib/helper-model.js, #1685), and the built-in model list is the
// current four Claude models.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { HELPER_MODEL } = require('../lib/helper-model');

test('every background call asks for the one helper model, and none hard-codes a Haiku name', () => {
  assert.equal(HELPER_MODEL, 'claude-haiku-5-5');
  assert.equal(require('../lib/group-router').MODEL, HELPER_MODEL);
  assert.equal(require('../lib/follow-up').MODEL, HELPER_MODEL);
  assert.equal(require('../lib/wake-gate').MODEL, HELPER_MODEL);
  assert.equal(require('../lib/shadow').MODEL, HELPER_MODEL);
  assert.equal(require('../lib/group-notes').MODEL, HELPER_MODEL);
  for (const file of ['group-router', 'follow-up', 'wake-gate', 'shadow', 'group-notes', 'app-errors', 'identity']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'lib', `${file}.js`), 'utf8');
    assert.ok(src.includes("require('./helper-model')"), `${file} reads the helper model from lib/helper-model.js`);
    assert.ok(!/['"]claude-haiku-[\d-]+['"]|model: 'haiku'|'--model', 'haiku'/.test(src), `${file} names no Haiku model itself`);
  }
});

test('the env override of the group router still replaces the helper model', async () => {
  const members = [{ id: 'a', name: 'A' }, { id: 'b', name: 'B' }];
  const asked = async (make, env, run) => {
    const seen = [];
    process.env[env] = 'custom-model';
    try { await run(make({ ask: async (prompt, o) => { seen.push(o.llm.model); return ''; }, ms: 200 })); } finally { delete process.env[env]; }
    return seen;
  };
  assert.deepEqual(await asked(require('../lib/group-router').create, 'BOT_DOT_GROUP_ROUTER_MODEL', (r) => r.route({ text: 'Hi', members })), ['custom-model']);
  const plain = [];
  await require('../lib/group-router').create({ ask: async (prompt, o) => { plain.push(o.llm.model); return ''; }, ms: 200 }).route({ text: 'Hi', members });
  assert.deepEqual(plain, [HELPER_MODEL], 'without the override it is the helper model');
});

test('the built-in model list is Fable 5.2, Opus 5.5, Sonnet 5.5 and Haiku 5.5, without prices', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'helper-model-'));
  const { models } = require('../lib/settings').create(dir).choices('en');
  const ids = models.filter((m) => /^claude-/.test(m.id)).map((m) => m.id);
  assert.deepEqual(ids, ['claude-fable-5-2', 'claude-opus-5-5', 'claude-sonnet-5-5', 'claude-haiku-5-5']);
});
