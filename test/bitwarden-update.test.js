// Bitwarden stays unlocked across an update (ADR 178): the session is kept for the one start that brings other
// code, encrypted with the Vault's key, for at most 15 minutes, and never across a plain restart.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

process.env.BW_BIN = path.join(__dirname, 'fixtures', 'fake-bw.js');
process.env.BOT_DOT_VAULT_KEY ||= crypto.randomBytes(32).toString('hex');
const bitwardenLib = require('../lib/bitwarden');

const PORTAL = { id: 'i-portal', type: 1, folderId: 'folder-1', name: 'Portal', login: { uris: [{ uri: 'https://portal.example.com' }], username: 'bart', password: 'secret' } };

function folder(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-bw-update-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'bitwarden.json'), JSON.stringify({ server: 'https://vault.example.com', clientId: 'user.00000000-0000-0000-0000-000000000000', folderId: 'folder-1' }));
  fs.mkdirSync(path.join(dir, 'bitwarden-cli'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'bitwarden-cli', 'items.json'), JSON.stringify([PORTAL]));
  return dir;
}
const CARRY = (dir) => path.join(dir, 'bitwarden-carry.json');

async function unlockedThenExit(t, stamp = 'old-code') {
  const dir = folder(t);
  const before = bitwardenLib.create(dir);
  await before.unlock('fixture-master');
  await before.whenIdle();
  assert.equal(before.keepForUpdate(stamp), true);
  return dir;
}

test('an update finds Bitwarden unlocked, and the kept session is gone from the disk', async (t) => {
  const dir = await unlockedThenExit(t);
  const kept = fs.readFileSync(CARRY(dir), 'utf8');
  assert.ok(!kept.includes('fixture-session'), 'the session is not on the disk in the clear');
  assert.equal(fs.statSync(CARRY(dir)).mode & 0o777, 0o600);
  const after = bitwardenLib.create(dir);
  assert.equal(after.unlocked(), false);
  assert.equal(await after.resumeAfterUpdate('new-code'), true);
  assert.equal(after.unlocked(), true);
  assert.deepEqual(after.list().map((e) => e.name), ['Portal']);
  assert.equal(fs.existsSync(CARRY(dir)), false, 'read once, and removed');
  await after.whenIdle();
  await after.lock();
});

test('a restart on the same code, an old note, a locked vault or a session bw refuses: it stays locked, and the note goes', async (t) => {
  // The same code: a plain restart or a reboot.
  let dir = await unlockedThenExit(t, 'same');
  let after = bitwardenLib.create(dir);
  assert.equal(await after.resumeAfterUpdate('same'), false);
  assert.equal(after.unlocked(), false);
  assert.equal(fs.existsSync(CARRY(dir)), false);
  // More than 15 minutes old.
  dir = await unlockedThenExit(t);
  after = bitwardenLib.create(dir);
  assert.equal(await after.resumeAfterUpdate('new-code', Date.now() + 15 * 60_000 + 1), false);
  assert.equal(after.unlocked(), false);
  // Locked by the owner before it exited: nothing is kept.
  dir = folder(t);
  const locked = bitwardenLib.create(dir);
  await locked.unlock('fixture-master');
  await locked.whenIdle();
  await locked.lock();
  assert.equal(locked.keepForUpdate('old-code'), false);
  assert.equal(fs.existsSync(CARRY(dir)), false);
  // A session bw no longer takes (it was locked elsewhere since): locked, with no error.
  dir = await unlockedThenExit(t);
  const note = JSON.parse(fs.readFileSync(CARRY(dir), 'utf8'));
  const { encrypt } = require('../lib/vault');
  fs.writeFileSync(CARRY(dir), JSON.stringify({ ...note, box: encrypt('a-session-bw-never-gave') }));
  after = bitwardenLib.create(dir);
  assert.equal(await after.resumeAfterUpdate('new-code'), false);
  assert.equal(after.unlocked(), false);
  // A note that is no note.
  fs.writeFileSync(CARRY(dir), '{"box":{"iv":"x","tag":"y","ct":"z"},"stamp":"old","at":"2026-01-01T00:00:00Z"}');
  assert.equal(await bitwardenLib.create(dir).resumeAfterUpdate('new-code'), false);
});
