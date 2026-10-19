// Each bw command is a program of its own and takes a second or more, one at a time. So a save, a change and a
// delete in Bitwarden run that one command and keep what it answered, rather than download the whole vault again
// after it (bw sync and the reading of the folder): the periodic sync and the Vault page's Sync still do that.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.BW_BIN = path.join(__dirname, 'fixtures', 'fake-bw.js');
const bitwardenLib = require('../lib/bitwarden');

const CLIENT_ID = 'user.00000000-0000-0000-0000-000000000000';
const PORTAL = { id: 'i-portal', type: 1, folderId: 'folder-1', name: 'Portal', login: { uris: [{ uri: 'https://portal.example.com' }], username: 'bart', password: 'old-secret' } };

async function bitwarden(t, list = [PORTAL]) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-bw-writes-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'bitwarden.json'), JSON.stringify({ server: 'https://vault.example.com', clientId: CLIENT_ID, folderId: 'folder-1' }));
  fs.writeFileSync(path.join(dir, 'bitwarden-access.json'), JSON.stringify({ 'i-portal': { bots: ['bot1'] } }));
  const bw = bitwardenLib.create(dir);
  const cli = path.join(dir, 'bitwarden-cli');
  fs.writeFileSync(path.join(cli, 'items.json'), JSON.stringify(list));
  await bw.unlock('fixture-master');
  await bw.whenIdle(); // the sync the unlocking starts, so that the commands below are the writes' own
  t.after(() => bw.lock());
  const file = path.join(cli, 'calls.jsonl');
  const calls = () => fs.readFileSync(file, 'utf8').trim().split('\n').map((l) => JSON.parse(l));
  let seen = calls().length;
  // The commands run since the last look.
  const since = () => { const all = calls(); const fresh = all.slice(seen).map((c) => c.slice(0, 2)); seen = all.length; return fresh; };
  return { bw, since };
}

test('Bitwarden: a save, a change and a delete each run one bw command, and the Vault shows them at once', async (t) => {
  const { bw, since } = await bitwarden(t);
  const added = await bw.add({ name: 'NAS', site: 'nas.example.net', password: 'nas-secret', allowedBots: ['bot1'] });
  assert.deepEqual(since(), [['create', 'item']]);
  assert.deepEqual(bw.list().map((e) => e.name), ['Portal', 'NAS']);
  assert.equal(bw.credentials('bot1', 'NAS').password, 'nas-secret');

  await bw.update('i-portal', { password: 'new-secret' });
  assert.deepEqual(since(), [['edit', 'item']]);
  assert.equal(bw.credentials('bot1', 'Portal').password, 'new-secret');

  assert.equal(await bw.remove(added.id), true);
  assert.deepEqual(since(), [['delete', 'item']]);
  assert.deepEqual(bw.list().map((e) => e.name), ['Portal']);
});

test("Bitwarden: the owner's save goes before the background syncs waiting for bw, after the command running now", async (t) => {
  const { bw, since } = await bitwarden(t);
  // Two syncs nobody waits on (the 5-minute one, and one after a bot's request): the first one's bw sync starts now,
  // the second's waits behind it, and then the owner saves.
  const syncing = [bw.sync({ background: true }), bw.sync({ background: true })];
  const saving = bw.add({ name: 'NAS', site: 'nas.example.net', password: 'nas-secret', allowedBots: ['bot1'] });
  await Promise.all([...syncing, saving]);
  assert.deepEqual(since().slice(0, 2), [['sync'], ['create', 'item']]);
  assert.deepEqual(bw.list().map((e) => e.name), ['Portal', 'NAS']);
});

test('Bitwarden: syncs asked for while one runs are that one, and a login request\'s sync skips a vault synced a moment ago', async (t) => {
  const { bw, since } = await bitwarden(t);
  await Promise.all([bw.sync(), bw.sync(), bw.sync()]);
  assert.deepEqual(since(), [['sync'], ['list', 'folders'], ['list', 'items']], 'one sync, not three');
  await bw.sync({ ifOlderThan: 60_000 });
  assert.deepEqual(since(), [], 'synced a moment ago');
  await bw.sync();
  assert.deepEqual(since().map((c) => c[0]), ['sync', 'list', 'list'], 'the Vault page\'s Sync still syncs');
});

// RFC 6238's test values (appendix B): the ASCII secret 12345678901234567890, 8 digits, 30 seconds.
const RFC_SECRET = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
test('two-step codes: RFC 6238\'s values, from a secret or an otpauth address', () => {
  const { totp } = bitwardenLib;
  assert.equal(totp(`otpauth://totp/x?secret=${RFC_SECRET}&digits=8`, 59_000), '94287082');
  assert.equal(totp(`otpauth://totp/x?secret=${RFC_SECRET}&digits=8`, 1111111109_000), '07081804');
  assert.equal(totp(`otpauth://totp/x?secret=${RFC_SECRET}&digits=8`, 2000000000_000), '69279037');
  assert.equal(totp(RFC_SECRET.toLowerCase().replace(/(.{4})/g, '$1 '), 59_000), '287082', 'a bare secret: 6 digits, spaces and case as people paste it');
  assert.equal(totp(`otpauth://totp/x?secret=${RFC_SECRET}&period=60`, 59_000), totp(RFC_SECRET, 0), 'its own period');
  assert.equal(totp('steam://ABCDEFGH', 59_000), null, 'what it can\'t make is left to bw');
  assert.equal(totp('not base32 !', 59_000), null);
});

test('Bitwarden: a two-step code is made in botdot, without a bw command; one it can\'t make is bw\'s', async (t) => {
  const withCode = { ...PORTAL, login: { ...PORTAL.login, totp: RFC_SECRET } };
  const { bw, since } = await bitwarden(t, [withCode]);
  const { value } = await bw.reveal('bot1', 'Portal', 'totp');
  assert.equal(value, bitwardenLib.totp(RFC_SECRET, Date.now()));
  assert.deepEqual(since(), []);
});
