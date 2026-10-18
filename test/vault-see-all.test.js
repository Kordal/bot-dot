// Every bot sees every Vault entry (its name, address and type), and may use only the ones the owner shared with it.
// An entry not shared with it is listed with `shared: false` and nothing more: no username, no card digits, no email.
// To use one, the bot asks with request_login, and the owner approves it in the pop-up.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

process.env.BOT_DOT_VAULT_KEY = crypto.randomBytes(32).toString('hex');
process.env.BW_BIN = path.join(__dirname, 'fixtures', 'fake-bw.js');
const vaultLib = require('../lib/vault');
const bitwardenLib = require('../lib/bitwarden');
const { startServer, makeBot, heldRun } = require('./helpers');
const { rpcClient } = require('./memory-helpers');

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-vault-see-all-'));

test('the built-in vault: what is not shared with a bot is its name, address and type, and nothing else', () => {
  const store = vaultLib.create(scratch());
  store.add({ name: 'Proxmox', site: 'pve.example.ts.net', username: 'root@pam!botdot', password: 't', type: 'api-token', allowedBots: ['bot1'] });
  store.add({ name: 'Bart Macbook public ssh', site: 'macbook.local', password: 'ssh-ed25519 AAAA', type: 'other', allowedBots: ['bot2'] });
  store.add({ name: 'Albert Heijn', site: 'ah.be', username: 'bart@example.com', password: 'p' });
  assert.deepEqual(store.notSharedWith('bot1'), [
    { name: 'Bart Macbook public ssh', site: 'macbook.local', type: 'other' },
    { name: 'Albert Heijn', site: 'ah.be', type: 'login' },
  ]);
  assert.deepEqual(store.notSharedWith('bot2').map((e) => e.name), ['Proxmox', 'Albert Heijn']);
});

test('Bitwarden: what is not shared with a bot is its name, and a login\'s address and type; an item that asks for the master password again is not listed', async (t) => {
  const dir = scratch();
  fs.writeFileSync(path.join(dir, 'bitwarden.json'), JSON.stringify({ server: 'https://vault.example.com', clientId: 'user.00000000-0000-0000-0000-000000000000', folderId: 'folder-1' }));
  fs.writeFileSync(path.join(dir, 'bitwarden-access.json'), JSON.stringify({ 'i-portal': { bots: ['bot1'] } }));
  const bw = bitwardenLib.create(dir);
  fs.writeFileSync(path.join(dir, 'bitwarden-cli', 'items.json'), JSON.stringify([
    { id: 'i-portal', type: 1, name: 'Portal', login: { uris: [{ uri: 'https://portal.example.com' }], username: 'bart', password: 'secret' } },
    { id: 'i-shop', type: 1, name: 'Shop', login: { uris: [{ uri: 'https://shop.example.com' }], username: 'bart@example.com', password: 'secret' } },
    { id: 'i-card', type: 3, name: 'Visa', card: { number: '4111111111111111', brand: 'Visa' } },
    { id: 'i-me', type: 4, name: 'Me', identity: { firstName: 'Bart', email: 'bart@example.com' } },
    { id: 'i-mine', type: 1, name: 'Bank', reprompt: 1, login: { uris: [{ uri: 'https://bank.example.com' }], password: 'secret' } },
  ]));
  await bw.unlock('fixture-master');
  t.after(() => bw.lock());
  assert.deepEqual(bw.notSharedWith('bot1'), [
    { kind: 'login', name: 'Shop', type: 'login', site: 'shop.example.com' },
    { kind: 'card', name: 'Visa' },
    { kind: 'identity', name: 'Me' },
  ]);
  bw.lock();
  assert.deepEqual(bw.notSharedWith('bot1'), [], 'locked: nothing');
});

let srv; let bot; let token;
before(async () => {
  srv = await startServer();
  bot = await makeBot(srv);
  ({ token } = await heldRun(srv, bot));
  for (const body of [
    { name: 'Proxmox', site: 'pve.example.ts.net', username: 'root@pam!botdot', password: 'secret-1', type: 'api-token', allowedBots: [bot.id] },
    { name: 'Bart Macbook public ssh', site: 'macbook.local', password: 'ssh-ed25519 AAAA', type: 'other', allowedBots: [] },
    { name: 'Albert Heijn', site: 'ah.be', username: 'bart@example.com', password: 'secret-2', allowedBots: [] },
  ]) assert.equal((await srv.api('/vault', { method: 'POST', body })).status, 201);
});
after(() => srv.stop());

test("a bot's list_logins lists every entry: the ones shared with it as before, the others with shared: false", async (t) => {
  const tools = rpcClient(t, 'vault-mcp.js', { VAULT_URL: `${srv.base}/api/vault`, VAULT_TOKEN: token });
  assert.deepEqual(await tools.json('list_logins'), [
    { name: 'Proxmox', site: 'pve.example.ts.net', username: 'root@pam!botdot', type: 'api-token', allowedHosts: [] },
    { name: 'Bart Macbook public ssh', site: 'macbook.local', type: 'other', shared: false },
    { name: 'Albert Heijn', site: 'ah.be', type: 'login', shared: false },
  ]);
  const listed = (await tools.request('tools/list')).tools;
  assert.match(listed.find((x) => x.name === 'list_logins').description, /shared: false.*request_login/);
});

test('an entry not shared with the bot still cannot be used', async (t) => {
  const tools = rpcClient(t, 'vault-mcp.js', { VAULT_URL: `${srv.base}/api/vault`, VAULT_TOKEN: token });
  const r = await tools.text('api_request', { login: 'Albert Heijn', url: 'https://ah.be/' }).then(String, (e) => e.message);
  assert.doesNotMatch(r, /secret-2/);
  assert.match(r, /isn't allowed to use the \\?"Albert Heijn\\?" login\. Ask the owner with request_login/);
});
