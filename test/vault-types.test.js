// The types of a Vault item (VAULT-005): a login-kind item is a login, an API token or other. Both stores
// keep the type (the built-in vault on the entry, Bitwarden beside the item's bots in
// data/bitwarden-access.json), the API hands it out and takes it, a login request carries it, and the bots'
// and the Chief's tools show it and can ask for one. Bitwarden is the stand-in CLI (fixtures/fake-bw.js):
// nothing leaves the machine, and no key but the test's own is read.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

// The stores run in this process too: a key of their own, so nothing asks the Keychain.
process.env.BOT_DOT_VAULT_KEY = crypto.randomBytes(32).toString('hex');
const FAKE_BW = path.join(__dirname, 'fixtures', 'fake-bw.js');
process.env.BW_BIN = FAKE_BW;
const vaultLib = require('../lib/vault');
const bitwardenLib = require('../lib/bitwarden');
const loginRequests = require('../lib/login-requests');
const { startServer, makeBot, heldRun, waitFor } = require('./helpers');
const { rpcClient } = require('./memory-helpers');

const REFUSED = 'Type must be login, api-token or other';
const CLIENT_ID = 'user.00000000-0000-0000-0000-000000000000';
const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-vault-types-'));
const readJson = (file, none) => { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return none; } };

test('one list of the three types, and one check of a value', () => {
  assert.deepEqual(vaultLib.ITEM_TYPES, ['login', 'api-token', 'other']);
  for (const t of vaultLib.ITEM_TYPES) assert.equal(vaultLib.isItemType(t), true);
  for (const t of ['password', 'API-Token', '', null, undefined, 1, ['login'], 'toString']) assert.equal(vaultLib.isItemType(t), false, String(t));
  // A saved item or a request without a type, or with one this server does not know: a login.
  assert.equal(vaultLib.itemType(undefined), 'login');
  assert.equal(vaultLib.itemType('token'), 'login');
  assert.equal(vaultLib.itemType('other'), 'other');
  // A save: none named is none, an unknown one is refused.
  assert.equal(vaultLib.givenType(undefined), undefined);
  assert.equal(vaultLib.givenType(null), undefined);
  assert.equal(vaultLib.givenType('api-token'), 'api-token');
  for (const t of ['password', '', 0, false, {}]) assert.throws(() => vaultLib.givenType(t), { message: REFUSED }, JSON.stringify(t));
});

// ---------- the built-in vault (lib/vault.js) ----------

test('the built-in vault: an item saved before the types reads as a login, of kind login', () => {
  const dir = scratch();
  const store = vaultLib.create(dir);
  const made = store.add({ name: 'Old', site: 'old.example.com', username: 'bart', password: 'old-secret', allowedBots: ['bot1'] });
  // As the file held it before this feature: no type on the entry.
  const file = path.join(dir, 'vault.json');
  const kept = readJson(file);
  delete kept.entries[0].type;
  fs.writeFileSync(file, JSON.stringify(kept));
  const [e] = store.list();
  assert.equal(e.id, made.id);
  assert.equal(e.type, 'login');
  assert.equal(e.kind, 'login');
  assert.equal(store.forBot('bot1')[0].type, 'login');
  assert.equal(store.exportAll()[0].type, 'login');
  assert.equal(readJson(file).entries[0].type, undefined, 'reading guesses and writes nothing');
});

test('the built-in vault: add and update take each type; the kind stays login', () => {
  const store = vaultLib.create(scratch());
  assert.equal(store.add({ site: 'plain.example.com', password: 'p' }).type, 'login', 'none named: a login');
  for (const type of vaultLib.ITEM_TYPES) {
    const e = store.add({ name: type, site: `${type}.example.com`, password: 'p', type });
    assert.equal(e.type, type);
    assert.equal(e.kind, 'login');
    assert.equal(e.secret, undefined, 'never the secret');
  }
  const [first] = store.list();
  for (const type of ['api-token', 'other', 'login']) {
    assert.equal(store.update(first.id, { type }).type, type);
    assert.equal(store.list()[0].type, type, 'and it is kept');
    assert.equal(store.list()[0].kind, 'login');
  }
  // A change that names no type keeps it.
  store.update(first.id, { type: 'other' });
  assert.equal(store.update(first.id, { name: 'Renamed' }).type, 'other');
  assert.equal(store.update(first.id, { name: 'Again', type: null }).type, 'other', 'null is no type named');
});

test('the built-in vault: an unknown type is refused and nothing is saved', () => {
  const dir = scratch();
  const store = vaultLib.create(dir);
  const file = path.join(dir, 'vault.json');
  assert.throws(() => store.add({ site: 'new.example.com', password: 'p', type: 'password' }), { message: REFUSED });
  assert.deepEqual(store.list(), []);
  assert.equal(fs.existsSync(file), false, 'not even the file');
  const e = store.add({ name: 'Kept', site: 'kept.example.com', username: 'bart', password: 'p', type: 'api-token', allowedBots: ['bot1'] });
  const was = fs.readFileSync(file, 'utf8');
  // Nothing else of that change is kept either.
  assert.throws(() => store.update(e.id, { name: 'Changed', allowedBots: [], type: 'secret' }), { message: REFUSED });
  assert.throws(() => store.update(e.id, { type: '' }), { message: REFUSED });
  assert.equal(fs.readFileSync(file, 'utf8'), was);
  assert.throws(() => store.upsert({ site: 'kept.example.com', username: 'bart', password: 'other', type: 'nope' }), { message: REFUSED });
  assert.throws(() => store.upsert({ site: 'third.example.com', password: 'p', type: 'nope' }), { message: REFUSED });
  assert.equal(fs.readFileSync(file, 'utf8'), was);
});

test('the built-in vault: a type change alone changes nothing else of the item', () => {
  const store = vaultLib.create(scratch());
  const e = store.add({ name: 'Portal', site: 'portal.example.com', username: 'bart', password: 'portal-secret', allowedBots: ['bot1', 'bot2'], allowedHosts: ['app.example.org'], insecureTls: true });
  const { type: _type, updatedAt: _at, ...before } = store.list()[0];
  const changed = store.update(e.id, { type: 'other' });
  const { type, updatedAt: _at2, ...rest } = store.list()[0];
  assert.equal(type, 'other');
  assert.equal(changed.type, 'other');
  assert.deepEqual(rest, before, 'address, username, bots, additional hosts, the certificate: as they were');
  // A login changed to Other keeps its username, and its secret.
  assert.deepEqual(store.credentials('bot1', 'Portal'), { name: 'Portal', site: 'portal.example.com', allowedHosts: ['app.example.org'], username: 'bart', password: 'portal-secret', insecureTls: true, inComputer: false });
});

test('the built-in vault: a bot sees the type of each login, and a save from a pop-up carries it', () => {
  const store = vaultLib.create(scratch());
  store.add({ name: 'Proxmox', site: 'pve.example.ts.net', username: 'root@pam!botdot', password: 't', type: 'api-token', allowedBots: ['bot1'] });
  store.add({ name: 'NAS', site: 'nas.example.net', password: 's', type: 'other', allowedBots: ['bot1'] });
  store.add({ name: 'Food', site: 'food.example.org', username: 'bart', password: 'p', allowedBots: ['bot1'] });
  store.add({ name: 'Not shared', site: 'x.example.org', password: 'p', type: 'other' });
  assert.deepEqual(store.forBot('bot1'), [
    { name: 'Proxmox', site: 'pve.example.ts.net', username: 'root@pam!botdot', type: 'api-token', allowedHosts: [] },
    { name: 'NAS', site: 'nas.example.net', username: '', type: 'other', allowedHosts: [] },
    { name: 'Food', site: 'food.example.org', username: 'bart', type: 'login', allowedHosts: [] },
  ]);
  // upsert, as the "needs a login" pop-up saves: a new item gets the type, the one of that site and username changes to it.
  assert.equal(store.upsert({ site: 'new.example.org', username: 'id', password: 'p', type: 'api-token' }).type, 'api-token');
  assert.equal(store.upsert({ site: 'food.example.org', username: 'BART', password: 'p2', type: 'other' }).type, 'other');
  assert.equal(store.upsert({ site: 'food.example.org', username: 'bart', password: 'p3' }).type, 'other', 'none named: it keeps its type');
  assert.equal(store.list().length, 5);
  // A save that names none: a new item gets the type that was asked for, the one already saved keeps its own.
  assert.equal(store.upsert({ site: 'asked.example.org', password: 'p', typeIfNew: 'api-token' }).type, 'api-token');
  assert.equal(store.upsert({ site: 'food.example.org', username: 'bart', password: 'p4', typeIfNew: 'login' }).type, 'other');
  assert.equal(store.upsert({ site: 'plain.example.org', password: 'p' }).type, 'login', 'nothing named, nothing asked for');
});

test('the built-in vault: a save without a username leaves a secret of another type on that host as it is', () => {
  const store = vaultLib.create(scratch());
  const token = store.add({ name: 'NAS API token', site: 'nas.example.net', password: 'token-1', type: 'api-token', allowedBots: ['bot1'] });
  // Another secret for the same host, saved as Other: a second item, and the token keeps its name, type and secret.
  const key = store.upsert({ name: 'NAS key', site: 'nas.example.net', password: 'key-1', type: 'other', allowedBots: ['bot1'] });
  assert.notEqual(key.id, token.id);
  assert.deepEqual(store.list().map((e) => [e.name, e.type]), [['NAS API token', 'api-token'], ['NAS key', 'other']]);
  assert.equal(store.credentials('bot1', 'NAS API token').password, 'token-1');
  // The same type again is the same item, corrected.
  assert.equal(store.upsert({ site: 'nas.example.net', password: 'key-2', type: 'other' }).id, key.id);
  assert.equal(store.credentials('bot1', 'NAS key').password, 'key-2');
  assert.equal(store.credentials('bot1', 'NAS API token').password, 'token-1');
  // An app from before the types names none: the item of that site without a username, as before, with its type.
  const old = store.upsert({ site: 'nas.example.net', password: 'token-2' });
  assert.equal(old.id, token.id);
  assert.equal(old.type, 'api-token');
  // With a username the site and the username say which item it is, whatever its type.
  const login = store.add({ name: 'Portal', site: 'portal.example.com', username: 'bart', password: 'p' });
  assert.equal(store.upsert({ site: 'portal.example.com', username: 'Bart', password: 'p2', type: 'api-token' }).id, login.id);
  assert.equal(store.list().length, 3);
});

// ---------- Bitwarden (lib/bitwarden.js), against the stand-in CLI ----------

// An unlocked Bitwarden store over these items of the bot-dot folder, with what botdot keeps beside them.
async function bitwarden(t, items = [], access = {}) {
  const dir = scratch();
  fs.writeFileSync(path.join(dir, 'bitwarden.json'), JSON.stringify({ server: 'https://vault.example.com', clientId: CLIENT_ID, folderId: 'folder-1' }));
  fs.writeFileSync(path.join(dir, 'bitwarden-access.json'), JSON.stringify(access));
  const bw = bitwardenLib.create(dir);
  const cli = path.join(dir, 'bitwarden-cli');
  fs.writeFileSync(path.join(cli, 'items.json'), JSON.stringify(items));
  await bw.unlock('fixture-master');
  t.after(() => bw.lock());
  const calls = () => { try { return fs.readFileSync(path.join(cli, 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)); } catch { return []; } };
  return {
    bw,
    access: () => readJson(path.join(dir, 'bitwarden-access.json'), {}),
    kept: () => readJson(path.join(cli, 'items.json'), []),
    // The commands that change an item in Bitwarden.
    writes: () => calls().filter((c) => ['create', 'edit', 'delete'].includes(c[0])).map((c) => c.slice(0, 3)),
  };
}
const PORTAL = { id: 'i-portal', type: 1, name: 'Portal', revisionDate: '2026-01-01T00:00:00.000Z', login: { uris: [{ match: 1, uri: 'https://portal.example.com:8443/login' }, { uri: 'https://alt.example.com' }], username: 'bart', password: 'portal-secret', totp: 'seed' } };
const CARD = { id: 'i-card', type: 3, name: 'Visa', card: { number: '4111111111111111', brand: 'Visa' } };
const IDENTITY = { id: 'i-me', type: 4, name: 'Me', identity: { firstName: 'Bart', email: 'bart@example.com' } };

test('Bitwarden: a login without a type beside it is a login; a card and an identity have no type', async (t) => {
  // i-portal has an entry from before the types (its bots only); i-plain has none at all.
  const { bw } = await bitwarden(t, [PORTAL, { id: 'i-plain', type: 1, name: 'Plain', login: { uris: [{ uri: 'https://plain.example.com' }] } }, CARD, IDENTITY], { 'i-portal': { bots: ['bot1'], insecureTls: false }, 'i-card': { bots: ['bot1'], insecureTls: false } });
  const byId = Object.fromEntries(bw.list().map((e) => [e.id, e]));
  assert.equal(byId['i-portal'].type, 'login');
  assert.equal(byId['i-portal'].kind, 'login');
  assert.equal(byId['i-plain'].type, 'login');
  assert.equal(byId['i-card'].kind, 'card');
  assert.equal('type' in byId['i-card'], false, 'a card has no type');
  assert.equal(byId['i-me'].kind, 'identity');
  assert.equal('type' in byId['i-me'], false, 'an identity has no type');
  // What a bot sees: the type of a login, none for a card.
  assert.deepEqual(bw.forBot('bot1'), [
    { kind: 'login', name: 'Portal', type: 'login', site: 'portal.example.com', username: 'bart', hasTotp: true, allowedHosts: [] },
    { kind: 'card', name: 'Visa', brand: 'Visa', last4: '1111', expiry: '', holder: '' },
  ]);
});

test('Bitwarden: add keeps the type beside the bots in bitwarden-access.json, and not in the Bitwarden item', async (t) => {
  const { bw, access, kept } = await bitwarden(t);
  const token = await bw.add({ name: 'Proxmox', site: 'pve.example.ts.net', username: 'root@pam!botdot', password: 'token-secret', type: 'api-token', allowedBots: ['bot1'] });
  assert.equal(token.type, 'api-token');
  assert.equal(token.kind, 'login');
  assert.deepEqual(access()[token.id], { bots: ['bot1'], insecureTls: false, allowedHosts: [], type: 'api-token' });
  const other = await bw.add({ name: 'NAS', site: 'nas.example.net', password: 'nas-secret', type: 'other' });
  assert.equal(other.type, 'other');
  assert.equal(other.username, '');
  assert.equal((await bw.add({ site: 'plain.example.com', password: 'p' })).type, 'login', 'none named: a login');
  assert.deepEqual(bw.list().map((e) => e.type), ['api-token', 'other', 'login']);
  // The items as Bitwarden holds them say nothing about a type: it is botdot's own.
  assert.equal(kept().length, 3);
  assert.doesNotMatch(JSON.stringify(kept()), /api-token|"other"/);
  assert.ok(kept().every((it) => it.type === 1), 'each a Bitwarden login');
});

test('Bitwarden: "Usable in its computer" (inComputer) is kept beside the bots, off by default, and never edits the item', async (t) => {
  const { bw, access, kept, writes } = await bitwarden(t, [PORTAL], { 'i-portal': { bots: ['bot1'], insecureTls: false } });
  assert.equal(bw.list()[0].inComputer, false, 'off for an item from before');
  assert.equal(bw.credentials('bot1', 'Portal').inComputer, false);
  assert.equal(Object.hasOwn(bw.forBot('bot1')[0], 'inComputer'), false, 'a bot sees it only where it is on');
  assert.equal((await bw.update('i-portal', { inComputer: true })).inComputer, true);
  assert.deepEqual(access()['i-portal'], { bots: ['bot1'], insecureTls: false, inComputer: true });
  assert.deepEqual(writes(), [], 'Bitwarden was not asked to edit anything');
  assert.deepEqual(kept(), [PORTAL]);
  assert.equal(bw.credentials('bot1', 'Portal').inComputer, true);
  assert.equal(bw.forBot('bot1')[0].inComputer, true);
  assert.equal((await bw.update('i-portal', { name: 'Portal', allowedBots: ['bot1'] })).inComputer, true, 'a change that leaves it out keeps it');
  assert.equal((await bw.update('i-portal', { inComputer: false })).inComputer, false);
  // A new item: off unless asked, and kept beside its bots when on.
  const off = await bw.add({ name: 'NAS', site: 'nas.example.net', password: 'p', allowedBots: ['bot1'] });
  assert.equal(off.inComputer, false);
  assert.equal(Object.hasOwn(access()[off.id], 'inComputer'), false);
  const on = await bw.add({ name: 'Bridge', site: '127.0.0.1', username: 'bart@proton.me', password: 'bridge-secret', allowedBots: ['bot1'], inComputer: true });
  assert.equal(on.inComputer, true);
  assert.equal(access()[on.id].inComputer, true);
  assert.doesNotMatch(JSON.stringify(kept()), /inComputer/, 'botdot\'s own, not in Bitwarden');
});

test('Bitwarden: an unknown type is refused, and nothing is created, edited or kept', async (t) => {
  const { bw, access, kept, writes } = await bitwarden(t, [PORTAL], { 'i-portal': { bots: ['bot1'], insecureTls: false, type: 'api-token' } });
  await assert.rejects(bw.add({ site: 'new.example.com', password: 'p', type: 'password' }), { message: REFUSED });
  await assert.rejects(bw.update('i-portal', { name: 'Changed', allowedBots: [], type: 'secret' }), { message: REFUSED });
  await assert.rejects(bw.upsert({ site: 'portal.example.com', username: 'bart', password: 'p2', type: 'nope' }), { message: REFUSED });
  await assert.rejects(bw.upsert({ site: 'third.example.com', password: 'p', type: 'nope' }), { message: REFUSED });
  assert.deepEqual(writes(), [], 'no command that changes Bitwarden ran');
  assert.deepEqual(kept(), [PORTAL]);
  assert.deepEqual(access(), { 'i-portal': { bots: ['bot1'], insecureTls: false, type: 'api-token' } });
});

test('Bitwarden: a type change alone leaves the item unedited, with its address, username, secret, bots and hosts', async (t) => {
  const { bw, access, kept, writes } = await bitwarden(t, [PORTAL], { 'i-portal': { bots: ['bot1', 'bot2'], insecureTls: true, allowedHosts: ['app.example.org'] } });
  const { type: _was, ...before } = bw.list()[0];
  const changed = await bw.update('i-portal', { type: 'api-token' });
  assert.equal(changed.type, 'api-token');
  const { type, ...rest } = bw.list()[0];
  assert.equal(type, 'api-token');
  assert.deepEqual(rest, before, 'address, username, bots, additional hosts, the certificate, the date: as they were');
  assert.deepEqual(access(), { 'i-portal': { bots: ['bot1', 'bot2'], insecureTls: true, allowedHosts: ['app.example.org'], type: 'api-token' } }, 'the type beside the bots');
  assert.deepEqual(writes(), [], 'Bitwarden was not asked to edit anything');
  assert.deepEqual(kept(), [PORTAL], 'the item as it was, with every address of it');
  assert.deepEqual(bw.credentials('bot1', 'Portal'), { name: 'Portal', site: 'portal.example.com', allowedHosts: ['app.example.org'], username: 'bart', password: 'portal-secret', insecureTls: true, inComputer: false });

  // The editor sends the whole form. With the name, the address and the username as they are, the item is
  // still not edited: to Other (no username sent, the stored one stays) and back.
  const form = { name: 'Portal', site: 'portal.example.com', allowedHosts: ['app.example.org'], insecureTls: true, allowedBots: ['bot1', 'bot2'] };
  assert.equal((await bw.update('i-portal', { ...form, type: 'other' })).type, 'other');
  assert.equal(bw.list()[0].username, 'bart', 'a login changed to Other keeps its username');
  assert.equal((await bw.update('i-portal', { ...form, username: 'bart', type: 'login' })).type, 'login');
  assert.deepEqual(writes(), []);
  assert.deepEqual(kept(), [PORTAL]);

  // What does change the item is still sent to Bitwarden, and the type stays beside it.
  const renamed = await bw.update('i-portal', { ...form, name: 'Portal 2', username: 'bart', type: 'api-token' });
  assert.deepEqual(writes(), [['edit', 'item', 'i-portal']]);
  assert.equal(renamed.name, 'Portal 2');
  assert.equal(renamed.type, 'api-token');
  await bw.update('i-portal', { password: 'new-secret' });
  assert.equal(writes().length, 2, 'a new secret is an edit');
  assert.equal(bw.list()[0].type, 'api-token');
});

test('Bitwarden: what the form does change of the item is still written, an emptied username too', async (t) => {
  const { bw, kept, writes } = await bitwarden(t, [PORTAL], { 'i-portal': { bots: ['bot1'], insecureTls: false, type: 'api-token' } });
  const form = { name: 'Portal', site: 'portal.example.com', username: 'bart', allowedHosts: [], insecureTls: false, allowedBots: ['bot1'], type: 'api-token' };
  await bw.update('i-portal', form);
  assert.deepEqual(writes(), [], 'the form as the item is: no edit');
  // The token ID is optional: the owner empties it.
  const emptied = await bw.update('i-portal', { ...form, username: '' });
  assert.deepEqual(writes(), [['edit', 'item', 'i-portal']]);
  assert.equal(emptied.username, '');
  assert.equal(kept()[0].login.username, '', 'gone in Bitwarden too, so {{username}} no longer fills it in');
  assert.equal(kept()[0].login.password, 'portal-secret', 'the secret stays');
  assert.equal(emptied.type, 'api-token');
  // An emptied name falls back to the address, as before.
  assert.equal((await bw.update('i-portal', { ...form, username: '', name: '' })).name, 'portal.example.com');
  assert.equal(writes().length, 2);
  // Another address.
  assert.equal((await bw.update('i-portal', { ...form, username: '', name: 'portal.example.com', site: 'https://new.example.com/login' })).site, 'new.example.com');
  assert.equal(writes().length, 3);
  // The secret as it is, sent again: nothing to write.
  await bw.update('i-portal', { password: 'portal-secret' });
  assert.equal(writes().length, 3);
});

test('Bitwarden: a save from a pop-up carries the type, and a card takes none', async (t) => {
  const { bw, access, writes } = await bitwarden(t, [PORTAL, CARD], { 'i-portal': { bots: ['bot1'], insecureTls: false } });
  // upsert: the item of that site and username changes to the type; a new one gets it.
  assert.equal((await bw.upsert({ site: 'portal.example.com', username: 'bart', password: 'p2', type: 'api-token', allowedBots: ['bot2'] })).type, 'api-token');
  assert.deepEqual(access()['i-portal'].bots, ['bot1', 'bot2']);
  assert.equal((await bw.upsert({ site: 'portal.example.com', username: 'bart', password: 'p3' })).type, 'api-token', 'none named: it keeps its type');
  assert.equal((await bw.upsert({ site: 'new.example.org', password: 'p', type: 'other' })).type, 'other');
  // A save that names none: a new item gets the type that was asked for, the one already saved keeps its own.
  assert.equal((await bw.upsert({ site: 'asked.example.org', password: 'p', typeIfNew: 'api-token' })).type, 'api-token');
  assert.equal((await bw.upsert({ site: 'portal.example.com', username: 'bart', password: 'p4', typeIfNew: 'login' })).type, 'api-token');
  // Without a username, a save that names a type leaves an item of another type on that host as it is.
  const token = await bw.upsert({ name: 'NAS API token', site: 'nas.example.net', password: 'token-1', type: 'api-token', allowedBots: ['bot1'] });
  const key = await bw.upsert({ name: 'NAS key', site: 'nas.example.net', password: 'key-1', type: 'other', allowedBots: ['bot1'] });
  assert.notEqual(key.id, token.id);
  assert.equal(bw.credentials('bot1', 'NAS API token').password, 'token-1');
  assert.equal((await bw.upsert({ site: 'nas.example.net', password: 'key-2', type: 'other' })).id, key.id, 'the same type: the same item, corrected');
  assert.equal(bw.credentials('bot1', 'NAS API token').password, 'token-1');
  assert.equal((await bw.upsert({ site: 'nas.example.net', password: 'token-2' })).id, token.id, 'none named: as before the types');
  const card = await bw.update('i-card', { allowedBots: ['bot1'], type: 'other' });
  assert.equal(card.kind, 'card');
  assert.equal('type' in card, false);
  assert.deepEqual(access()['i-card'], { bots: ['bot1'], insecureTls: false });
  assert.ok(!writes().some((c) => c[2] === 'i-card'));
});

// ---------- a login request (lib/login-requests.js) ----------

test('a login request has a type, a login when none or an unknown one is named; a card request has none', () => {
  const make = (site, extra) => loginRequests.create({ botId: 'bot1', site, from: 'bot', ...extra });
  assert.equal(make('a.example.com', {}).type, 'login');
  assert.equal(make('b.example.com', { type: 'api-token' }).type, 'api-token');
  assert.equal(make('c.example.com', { type: 'other' }).type, 'other');
  assert.equal(make('d.example.com', { type: 'password' }).type, 'login');
  assert.equal(make('e.example.com', { type: null }).type, 'login');
  assert.equal('type' in make('f.example.com', { kind: 'card', type: 'other', card: { id: 'c', name: 'Visa', last4: '1111' } }), false);
  for (const r of loginRequests.pending()) loginRequests.settle(r.id, 'declined');
});

// ---------- through the server: the built-in vault ----------

let srv; let bot; let token;
const vault = async () => (await srv.api('/vault')).data;
const item = async (id) => (await vault()).find((e) => e.id === id);
const save = async (body) => { const r = await srv.api('/vault', { method: 'POST', body }); assert.equal(r.status, 201, JSON.stringify(r.data)); return r.data; };
const open = async (id) => (await srv.api('/vault/requests')).data.find((r) => r.id === id);
const answer = (id, body) => srv.api(`/vault/requests/${id}`, { method: 'POST', body });
const asBot = (p, body) => srv.api(`/vault/session/${p}`, { method: body ? 'POST' : 'GET', body, headers: { 'X-Vault-Token': token } });
const asked = async (r) => { assert.equal(r.status, 201, JSON.stringify(r.data)); return r.data.id; };
const chiefAsks = (site, extra = {}) => srv.asChief('/vault/requests', { method: 'POST', body: { site, forBot: bot.id, reason: 'To call its API.', ...extra } }).then(asked);
const botAsks = (site, extra = {}) => asBot('request', { site, reason: 'To call its API.', ...extra }).then(asked);

before(async () => {
  srv = await startServer();
  bot = await makeBot(srv);
  ({ token } = await heldRun(srv, bot));
});
after(() => srv.stop());

test('GET /api/version: features has vault-types', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('vault-types'));
});

test('POST and GET /api/vault: each type is saved and handed out, the kind stays login, none named is a login', async () => {
  const token_ = await save({ name: 'Proxmox', site: 'pve.example.ts.net', username: 'root@pam!botdot', password: 'token-secret', type: 'api-token', allowedBots: [bot.id] });
  const other = await save({ name: 'NAS', site: 'nas.example.net', password: 'nas-secret', type: 'other' });
  const login = await save({ name: 'Food', site: 'food.example.org', username: 'bart', password: 'food-secret', type: 'login' });
  const plain = await save({ name: 'Plain', site: 'plain.example.org', password: 'plain-secret' });
  assert.deepEqual([token_, other, login, plain].map((e) => [e.type, e.kind]), [['api-token', 'login'], ['other', 'login'], ['login', 'login'], ['login', 'login']]);
  assert.deepEqual((await vault()).map((e) => [e.name, e.type, e.kind]), [['Proxmox', 'api-token', 'login'], ['NAS', 'other', 'login'], ['Food', 'login', 'login'], ['Plain', 'login', 'login']]);
  assert.equal(other.username, '', 'Other was saved without a username');
  assert.ok(!JSON.stringify(await vault()).includes('secret'), 'no secret');
});

test('an item saved before this task is handed out as a login', async () => {
  const made = await save({ name: 'From before', site: 'before.example.org', username: 'bart', password: 'before-secret' });
  // As data/vault.json held it before the types.
  const file = path.join(srv.data, 'vault.json');
  const kept = readJson(file);
  delete kept.entries.find((e) => e.id === made.id).type;
  fs.writeFileSync(file, JSON.stringify(kept));
  const e = await item(made.id);
  assert.equal(e.type, 'login');
  assert.equal(e.kind, 'login');
});

test('an unknown type is refused with the sentence, 400, and nothing is saved', async () => {
  const before_ = await vault();
  for (const type of ['password', 'API token', '', 7]) {
    const r = await srv.api('/vault', { method: 'POST', body: { name: 'Refused', site: 'refused.example.org', password: 'p', type } });
    assert.equal(r.status, 400, JSON.stringify(type));
    assert.deepEqual(r.data, { error: REFUSED });
  }
  const food = before_.find((e) => e.name === 'Food');
  const r = await srv.api(`/vault/${food.id}`, { method: 'PUT', body: { name: 'Changed', allowedBots: [bot.id], type: 'secret' } });
  assert.equal(r.status, 400);
  assert.deepEqual(r.data, { error: REFUSED });
  assert.deepEqual(await vault(), before_, 'no new item, and nothing of the refused change');
  // As "Website is required" is refused.
  const none = await srv.api('/vault', { method: 'POST', body: { name: 'No site', password: 'p', type: 'other' } });
  assert.equal(none.status, 400);
  assert.deepEqual(none.data, { error: 'Website is required' });
});

test('PUT /api/vault/:id: a type change alone changes nothing else; a change without a type keeps it', async () => {
  const made = await save({ name: 'Portal', site: 'portal.example.com', username: 'bart', password: 'portal-secret', allowedBots: [bot.id], allowedHosts: ['app.example.org'], insecureTls: true });
  const { type: _t, updatedAt: _a, ...before_ } = await item(made.id);
  const r = await srv.api(`/vault/${made.id}`, { method: 'PUT', body: { type: 'other' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.type, 'other');
  const { type, updatedAt: _a2, ...rest } = await item(made.id);
  assert.equal(type, 'other');
  assert.deepEqual(rest, before_, 'address, username, bots and additional hosts stay');
  const renamed = await srv.api(`/vault/${made.id}`, { method: 'PUT', body: { name: 'Portal 2', allowedBots: [] } });
  assert.equal(renamed.data.type, 'other', 'an app from before the types changes an item: it keeps its type');
  assert.equal((await item(made.id)).username, 'bart', 'and Other kept the username it had');
});

test('a bot sees the type of the logins it may use (list_logins)', async () => {
  const r = await asBot('logins');
  assert.deepEqual(r.data.logins, [{ name: 'Proxmox', site: 'pve.example.ts.net', username: 'root@pam!botdot', type: 'api-token', allowedHosts: [] }]);
});

test('a login request carries the type the Chief or the bot asked for; none or an unknown one is a login', async () => {
  assert.equal((await open(await chiefAsks('chief-token.example.com', { type: 'api-token' }))).type, 'api-token');
  assert.equal((await open(await chiefAsks('chief-plain.example.com'))).type, 'login');
  assert.equal((await open(await chiefAsks('chief-odd.example.com', { type: 'password' }))).type, 'login');
  assert.equal((await open(await botAsks('bot-other.example.com', { type: 'other' }))).type, 'other');
  assert.equal((await open(await botAsks('bot-token.example.com', { type: 'api-token' }))).type, 'api-token');
  assert.equal((await open(await botAsks('bot-plain.example.com'))).type, 'login');
  assert.equal((await open(await botAsks('bot-odd.example.com', { type: 7 }))).type, 'login');
  for (const r of (await srv.api('/vault/requests')).data) await answer(r.id, { action: 'decline' });
});

test('save takes the type the owner chose; without one the item gets the type of the request', async () => {
  // The owner changed the type in the pop-up.
  const chosen = await chiefAsks('chosen.example.com');
  const a = await answer(chosen, { action: 'save', name: 'Chosen', type: 'api-token', username: 'id', password: 'chosen-secret' });
  assert.equal(a.status, 200, JSON.stringify(a.data));
  assert.equal(a.data.status, 'saved');
  assert.equal((await vault()).find((e) => e.name === 'Chosen').type, 'api-token');
  // An app from before the types saves without one: what was asked for.
  const asIs = await botAsks('asked.example.com', { type: 'api-token', name: 'Asked' });
  assert.equal((await answer(asIs, { action: 'save', username: 'id', password: 'asked-secret' })).status, 200);
  const saved = (await vault()).find((e) => e.name === 'Asked');
  assert.equal(saved.type, 'api-token');
  assert.deepEqual(saved.allowedBots, [bot.id]);
  // Other: saved without a username.
  const other = await botAsks('other.example.com', { name: 'Just a secret' });
  assert.equal((await answer(other, { action: 'save', type: 'other', password: 'other-secret' })).status, 200);
  const o = (await vault()).find((e) => e.name === 'Just a secret');
  assert.equal(o.type, 'other');
  assert.equal(o.username, '');
});

test('save for a site and username already saved changes that login: to the type the owner chose, and without one it keeps its own', async () => {
  const count = (await vault()).length;
  const id = (await vault()).find((e) => e.name === 'Asked').id; // asked.example.com, username "id", an API token
  // An app from before the types corrects the secret: no type is sent, and the request's (a login, none was asked
  // for) does not replace the one the item has.
  const again = await botAsks('asked.example.com', { name: 'Asked', username: 'id', reason: 'The site says the saved token is wrong.' });
  assert.equal((await open(again)).type, 'login');
  assert.equal((await answer(again, { action: 'save', username: 'id', password: 'asked-secret-2' })).status, 200);
  assert.equal((await item(id)).type, 'api-token', 'it keeps its type');
  const third = await botAsks('asked.example.com', { name: 'Asked', username: 'id' });
  assert.equal((await answer(third, { action: 'save', type: 'login', username: 'id', password: 'asked-secret-3' })).status, 200);
  assert.equal((await item(id)).type, 'login', 'the type the owner chose');
  const fourth = await botAsks('asked.example.com', { name: 'Asked', username: 'id' });
  assert.equal((await answer(fourth, { action: 'save', type: 'api-token', username: 'id', password: 'asked-secret-4' })).status, 200);
  assert.equal((await item(id)).type, 'api-token', 'and chose again');
  assert.equal((await vault()).length, count, 'the same login, not a second one');
});

test('save with an unknown type: 400 with the sentence, nothing saved, the request still open', async () => {
  const id = await chiefAsks('refused-save.example.com');
  const count = (await vault()).length;
  const r = await answer(id, { action: 'save', type: 'password', username: 'u', password: 'p' });
  assert.equal(r.status, 400);
  assert.deepEqual(r.data, { error: REFUSED });
  assert.equal((await vault()).length, count);
  assert.equal((await open(id)).status, 'pending');
  await answer(id, { action: 'decline' });
});

// ---------- the tools (lib/vault-mcp.js for a bot, lib/mcp-server.js for the Chief) ----------

test("a bot's tools: list_logins shows the type, request_login takes one and says when to ask for an API token", async (t) => {
  const tools = rpcClient(t, 'vault-mcp.js', { VAULT_URL: `${srv.base}/api/vault`, VAULT_TOKEN: token });
  const listed = (await tools.request('tools/list')).tools;
  const ask = listed.find((x) => x.name === 'request_login');
  assert.deepEqual(ask.inputSchema.properties.type.enum, vaultLib.ITEM_TYPES);
  assert.ok(!ask.inputSchema.required.includes('type'), 'optional');
  assert.match(ask.description, /ask for "api-token" when you need a token or key to call an API/);
  assert.match(listed.find((x) => x.name === 'list_logins').description, /type: "login", "api-token" or "other"/);
  assert.deepEqual((await tools.json('list_logins')).map((l) => [l.name, l.type]), [['Proxmox', 'api-token'], ['Chosen', 'api-token'], ['Asked', 'api-token'], ['Just a secret', 'other']]);
  // The request it opens has the type; the tool answers once the owner has.
  const waiting = tools.text('request_login', { site: 'tool-bot.example.com', type: 'api-token', reason: 'To read the nodes.' });
  const r = await waitFor(async () => (await srv.api('/vault/requests')).data.find((x) => x.site === 'tool-bot.example.com'), { what: 'the request of the tool' });
  assert.equal(r.type, 'api-token');
  assert.equal(r.from, 'bot');
  await answer(r.id, { action: 'decline' });
  assert.match(await waiting, /declined/);
});

test("the Chief's tools: list_vault shows the type, request_login takes one and says when to ask for an API token", async (t) => {
  const { TOOLS } = require('../lib/mcp-server');
  const ask = TOOLS.find((x) => x.name === 'request_login');
  assert.deepEqual(ask.inputSchema.properties.type.enum, vaultLib.ITEM_TYPES);
  assert.ok(!ask.inputSchema.required.includes('type'), 'optional');
  assert.match(ask.description, /ask for "api-token" when the bot needs a token or key to call an API/);
  assert.match(TOOLS.find((x) => x.name === 'list_vault').description, /type: "login", "api-token" or "other"/);

  const tools = rpcClient(t, 'mcp-server.js', { BOT_DOT_URL: srv.base, BOT_DOT_CHIEF_KEY: srv.chiefKey });
  const listed = await tools.json('list_vault');
  assert.deepEqual(listed.filter((l) => ['Proxmox', 'NAS', 'Food'].includes(l.name)).map((l) => [l.name, l.type]), [['Proxmox', 'api-token'], ['NAS', 'other'], ['Food', 'login']]);
  const refused = await tools.call('request_login', { site: 'tool-chief.example.com', forBot: bot.id, type: 'password', reason: 'x' });
  assert.equal(refused.isError, true, 'a type the tool does not have is not sent');
  const waiting = tools.json('request_login', { site: 'tool-chief.example.com', forBot: bot.id, type: 'other', reason: 'To open the NAS.' });
  const r = await waitFor(async () => (await srv.api('/vault/requests')).data.find((x) => x.site === 'tool-chief.example.com'), { what: 'the request of the tool' });
  assert.equal(r.type, 'other');
  assert.equal(r.from, 'chief');
  await answer(r.id, { action: 'decline' });
  assert.deepEqual(await waiting, { status: 'declined' });
});

// ---------- through the server: Bitwarden, and the move into it ----------

test('save without a username leaves a secret of another type on that host as it is', async () => {
  const token = await botAsks('two.example.com', { type: 'api-token', name: 'Two token' });
  assert.equal((await answer(token, { action: 'save', type: 'api-token', username: '', password: 'two-token' })).status, 200);
  // The bot asks for another secret of that host, and the owner saves it as Other: a second item.
  const key = await botAsks('two.example.com', { name: 'Two key' });
  assert.equal((await answer(key, { action: 'save', type: 'other', password: 'two-key' })).status, 200);
  const both = (await vault()).filter((e) => e.site === 'two.example.com');
  assert.deepEqual(both.map((e) => [e.name, e.type]).sort(), [['Two key', 'other'], ['Two token', 'api-token']]);
});

test('the move of the built-in vault into Bitwarden carries each type, kept beside the bots; the API then takes and hands out types there', async (t) => {
  const bw = await startServer({ env: { BW_BIN: FAKE_BW } });
  t.after(() => bw.stop());
  const b = await makeBot(bw);
  const add = (body) => bw.api('/vault', { method: 'POST', body });
  const list = async () => (await bw.api('/vault')).data;
  for (const body of [
    { name: 'Proxmox', site: 'pve.example.ts.net', username: 'root@pam!botdot', password: 'token-secret', type: 'api-token', allowedBots: [b.id], allowedHosts: ['pve2.example.ts.net'] },
    { name: 'NAS', site: 'nas.example.net', password: 'nas-secret', type: 'other' },
    { name: 'Food', site: 'food.example.org', username: 'bart', password: 'food-secret' },
  ]) assert.equal((await add(body)).status, 201);

  // Connect Bitwarden and unlock it: the logins move over.
  const setup = await bw.api('/vault/bitwarden/setup', { method: 'POST', body: { server: 'us', clientId: CLIENT_ID, clientSecret: 'fixture-client-secret' } });
  assert.equal(setup.status, 200, JSON.stringify(setup.data));
  const unlocked = await bw.api('/vault/bitwarden/unlock', { method: 'POST', body: { password: 'fixture-master' } });
  assert.equal(unlocked.status, 200, JSON.stringify(unlocked.data));
  assert.equal(unlocked.data.moved, 3);
  assert.deepEqual(readJson(path.join(bw.data, 'vault.json')).entries, [], 'the built-in vault is empty');

  const moved = await list();
  assert.deepEqual(moved.map((e) => [e.name, e.type, e.kind]), [['Proxmox', 'api-token', 'login'], ['NAS', 'other', 'login'], ['Food', 'login', 'login']]);
  const proxmox = moved.find((e) => e.name === 'Proxmox');
  const access = () => readJson(path.join(bw.data, 'bitwarden-access.json'));
  assert.deepEqual(access()[proxmox.id], { bots: [b.id], insecureTls: false, allowedHosts: ['pve2.example.ts.net'], type: 'api-token' });
  assert.doesNotMatch(fs.readFileSync(path.join(bw.data, 'bitwarden-cli', 'items.json'), 'utf8'), /api-token/, 'not in the Bitwarden items');

  // With Bitwarden connected: a new item with a type, a refused one, and a type change that edits no item.
  const made = await add({ name: 'Key', site: 'key.example.org', password: 'key-secret', type: 'other' });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  assert.equal(made.data.type, 'other');
  const refused = await add({ name: 'Refused', site: 'refused.example.org', password: 'p', type: 'password' });
  assert.equal(refused.status, 400);
  assert.deepEqual(refused.data, { error: REFUSED });
  assert.equal((await list()).length, 4);
  const calls = () => fs.readFileSync(path.join(bw.data, 'bitwarden-cli', 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  const edits = () => calls().filter((c) => c[0] === 'edit').length;
  const was = edits();
  const changed = await bw.api(`/vault/${proxmox.id}`, { method: 'PUT', body: { type: 'login' } });
  assert.equal(changed.status, 200, JSON.stringify(changed.data));
  assert.equal(changed.data.type, 'login');
  assert.equal(changed.data.username, 'root@pam!botdot');
  assert.deepEqual(changed.data.allowedHosts, ['pve2.example.ts.net']);
  assert.deepEqual(changed.data.allowedBots, [b.id]);
  assert.equal(edits(), was, 'the Bitwarden item was not edited');
  assert.equal(access()[proxmox.id].type, 'login');
});
