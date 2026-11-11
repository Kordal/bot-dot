// Categories of the Vault (ADR 213): any entry may be in one category, the owner's word for a group of entries. Both
// stores keep it (the built-in vault on the entry, Bitwarden beside the item's bots in data/bitwarden-access.json, never
// in the Bitwarden item), the API hands it out and takes it, and the bots' list of logins shows it. Bitwarden is the
// stand-in CLI (fixtures/fake-bw.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

process.env.BOT_DOT_VAULT_KEY ||= crypto.randomBytes(32).toString('hex');
process.env.BW_BIN = path.join(__dirname, 'fixtures', 'fake-bw.js');
const vaultLib = require('../lib/vault');
const bitwardenLib = require('../lib/bitwarden');

const scratch = (t) => { const d = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-vault-cat-')); t.after(() => fs.rmSync(d, { recursive: true, force: true })); return d; };

test('a category is one line of at most 40 characters; empty takes it off, and one in use but for its case is that one', () => {
  const { givenCategory, CATEGORY_MAX } = vaultLib;
  assert.equal(CATEGORY_MAX, 40);
  assert.equal(givenCategory(undefined), undefined, 'not sent: kept');
  assert.equal(givenCategory(null), '');
  assert.equal(givenCategory('   '), '');
  assert.equal(givenCategory('  Home \n  servers '), 'Home servers');
  assert.equal(givenCategory('x'.repeat(50)).length, 40);
  assert.equal(givenCategory('shopping', ['Shopping', undefined]), 'Shopping');
  assert.equal(givenCategory('Work', ['Shopping']), 'Work');
});

test('the built-in vault keeps a login\'s category, changes and takes it off, and bots see it', (t) => {
  const dir = scratch(t);
  const v = vaultLib.create(dir);
  const a = v.add({ name: 'Albert Heijn', site: 'ah.be', password: 'p', category: ' Shopping ', allowedBots: ['bot1'] });
  assert.equal(a.category, 'Shopping');
  const b = v.add({ name: 'Bol', site: 'bol.com', password: 'p', category: 'shopping' });
  assert.equal(b.category, 'Shopping', 'the group in use, not a second one');
  const c = v.add({ name: 'Router', site: 'router.lan', password: 'p' });
  assert.equal(c.category, '', 'none: an empty one');
  assert.equal(v.update(a.id, { name: 'AH' }).category, 'Shopping', 'a save without it keeps it');
  assert.equal(v.update(a.id, { category: 'Groceries' }).category, 'Groceries');
  assert.equal(v.update(b.id, { category: '' }).category, '');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'vault.json'), 'utf8')).entries.find((e) => e.id === b.id).category, undefined, 'none is kept as none');
  // A login request's save keeps it.
  assert.equal(v.upsert({ site: 'ah.be', username: '', password: 'q', allowedBots: ['bot2'] }).category, 'Groceries');
  assert.deepEqual(v.forBot('bot1').map((l) => [l.name, l.category]), [['AH', 'Groceries']]);
  assert.deepEqual(v.notSharedWith('bot1').map((l) => l.category), [undefined, undefined], 'no category: no field');
  assert.ok(!JSON.stringify(v.list()).includes('"p"'));
});

test('Bitwarden keeps the category of any item beside its bots: the item itself is never edited for it', async (t) => {
  const dir = scratch(t);
  fs.writeFileSync(path.join(dir, 'bitwarden.json'), JSON.stringify({ server: 'https://vault.example.com', clientId: 'user.00000000-0000-0000-0000-000000000000', folderId: 'folder-1' }));
  fs.mkdirSync(path.join(dir, 'bitwarden-cli'), { recursive: true });
  const card = { id: 'i-card', type: 3, folderId: 'folder-1', name: 'Main card', card: { brand: 'Visa', number: '4242424242424242', expMonth: '1', expYear: '2030' } };
  const login = { id: 'i-portal', type: 1, folderId: 'folder-1', name: 'Portal', login: { uris: [{ uri: 'https://portal.example.com' }], username: 'bart', password: 'secret' } };
  fs.writeFileSync(path.join(dir, 'bitwarden-cli', 'items.json'), JSON.stringify([card, login]));
  const bw = bitwardenLib.create(dir);
  await bw.unlock('fixture-master');
  await bw.whenIdle();
  t.after(() => bw.lock());
  const calls = () => { try { return fs.readFileSync(path.join(dir, 'bitwarden-cli', 'calls.jsonl'), 'utf8'); } catch { return ''; } };
  const before = calls();
  assert.equal((await bw.update('i-card', { category: 'Money' })).category, 'Money');
  assert.equal((await bw.update('i-portal', { category: 'money', allowedBots: ['bot1'] })).category, 'Money');
  assert.equal(calls(), before, 'no bw edit for a category');
  const access = JSON.parse(fs.readFileSync(path.join(dir, 'bitwarden-access.json'), 'utf8'));
  assert.deepEqual([access['i-card'].category, access['i-portal'].category], ['Money', 'Money']);
  assert.deepEqual(bw.list().map((i) => [i.name, i.category]), [['Main card', 'Money'], ['Portal', 'Money']]);
  assert.deepEqual(bw.forBot('bot1').map((i) => [i.name, i.category]), [['Portal', 'Money']]);
  assert.deepEqual(bw.notSharedWith('bot1'), [{ kind: 'card', name: 'Main card', category: 'Money' }]);
  assert.equal((await bw.update('i-card', { category: null })).category, '');
  assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'bitwarden-access.json'), 'utf8'))['i-card'].category, undefined);
  // A new login takes one, and a login request's save keeps it.
  const made = await bw.add({ name: 'Shop', site: 'shop.example.com', password: 'p', category: 'Shopping' });
  assert.equal(made.category, 'Shopping');
  assert.equal((await bw.upsert({ site: 'shop.example.com', username: '', password: 'q' })).category, 'Shopping');
});
