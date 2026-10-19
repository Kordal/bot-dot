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

async function bitwarden(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-bw-writes-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'bitwarden.json'), JSON.stringify({ server: 'https://vault.example.com', clientId: CLIENT_ID, folderId: 'folder-1' }));
  fs.writeFileSync(path.join(dir, 'bitwarden-access.json'), JSON.stringify({ 'i-portal': { bots: ['bot1'] } }));
  const bw = bitwardenLib.create(dir);
  const cli = path.join(dir, 'bitwarden-cli');
  fs.writeFileSync(path.join(cli, 'items.json'), JSON.stringify([PORTAL]));
  await bw.unlock('fixture-master');
  await bw.sync(); // after the one unlocking starts, so that the commands below are the writes' own
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
