// A bot can ask to remove a Vault entry it sees in its list (remove_login), shared with it or not (#132). The owner
// answers on a card in the bot's chat and in Needs you that names the bot and the entry; only their Allow moves it to
// Bitwarden's Trash (`bw delete item`, never `--permanent`), through the one queue every bw command waits in. A bot
// never reads a secret for it, and nothing is removed without the owner's yes.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

process.env.BW_BIN = path.join(__dirname, 'fixtures', 'fake-bw.js');
const bitwardenLib = require('../lib/bitwarden');
const { startServer, makeBot, heldRun, waitFor } = require('./helpers');
const { rpcClient } = require('./memory-helpers');

const FAKE_BW = path.join(__dirname, 'fixtures', 'fake-bw.js');
const CLIENT_ID = 'user.00000000-0000-0000-0000-000000000000';
const KUMA = 'Uptime Kuma netcup API key';

let srv; let bot; let other;
const vaultTools = (t, token) => rpcClient(t, 'vault-mcp.js', { VAULT_URL: `${srv.base}/api/vault`, VAULT_TOKEN: token });
const entry = async (name) => (await srv.api('/vault')).data.find((l) => l.name === name);
const cli = () => path.join(srv.data, 'bitwarden-cli');
const inBitwarden = (name) => JSON.parse(fs.readFileSync(path.join(cli(), 'items.json'), 'utf8')).some((x) => x.name === name);
const bwCalls = () => fs.readFileSync(path.join(cli(), 'calls.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const removeCards = async (botId = bot.id) => (await srv.api('/asks?vault-remove=1')).data.filter((a) => a.kind === 'vault-remove' && a.botId === botId);
const add = async (body) => assert.equal((await srv.api('/vault', { method: 'POST', body })).status, 201);

before(async () => {
  srv = await startServer({ env: { BW_BIN: FAKE_BW, BOT_DOT_VAULT_WAIT_MS: '1500' } });
  bot = await makeBot(srv, { name: 'VPS Admin', emoji: '🛠' });
  other = await makeBot(srv, { name: 'Mail Sorter', emoji: '📬' });
});
after(async () => { srv.unhold(); await srv.stop(); });

test("Bitwarden: the entry a bot names is one of its list, by name or a login's address, without a secret", async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-vault-remove-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'bitwarden.json'), JSON.stringify({ server: 'https://vault.example.com', clientId: CLIENT_ID, folderId: 'folder-1' }));
  fs.writeFileSync(path.join(dir, 'bitwarden-access.json'), JSON.stringify({ 'i-portal': { bots: ['bot1'] } }));
  const bw = bitwardenLib.create(dir);
  fs.writeFileSync(path.join(dir, 'bitwarden-cli', 'items.json'), JSON.stringify([
    { id: 'i-portal', type: 1, name: 'Portal', login: { uris: [{ uri: 'https://portal.example.com' }], username: 'bart', password: 'secret' } },
    { id: 'i-card', type: 3, name: 'Visa', card: { number: '4111111111111111', brand: 'Visa' } },
    { id: 'i-mine', type: 1, name: 'Bank', reprompt: 1, login: { uris: [{ uri: 'https://bank.example.com' }], password: 'secret' } },
    { id: 'i-twin1', type: 1, name: 'Twin', login: { uris: [{ uri: 'https://a.example.com' }], password: 'secret' } },
    { id: 'i-twin2', type: 1, name: 'Twin', login: { uris: [{ uri: 'https://b.example.com' }], password: 'secret' } },
  ]));
  await bw.unlock('fixture-master');
  await bw.sync();
  t.after(() => bw.lock());
  const portal = { id: 'i-portal', kind: 'login', name: 'Portal', site: 'portal.example.com' };
  assert.deepEqual(bw.listedItem('portal'), portal);
  assert.deepEqual(bw.listedItem('https://portal.example.com/login'), portal, 'not shared with it: in its list all the same');
  assert.deepEqual(bw.listedItem('Visa'), { id: 'i-card', kind: 'card', name: 'Visa', site: '' });
  assert.throws(() => bw.listedItem('Bank'), /No entry called/, 'one that asks for the master password again is in no list');
  assert.throws(() => bw.listedItem('Twin'), /Several entries are called/);
  assert.equal(bw.listedItem('b.example.com').id, 'i-twin2', 'two of one name: told apart by the address');
  bw.lock();
  assert.throws(() => bw.listedItem('Portal'), /locked/);
});

test("botdot's built-in vault has no Trash, so a bot can't ask to remove from it", async (t) => {
  await add({ name: 'Old login', site: 'old.example.com', username: 'bart', password: 'old-secret', allowedBots: [bot.id] });
  const { token, rec } = await heldRun(srv, bot);
  t.after(() => srv.release(rec));
  const r = await vaultTools(t, token).call('remove_login', { entry: 'Old login', reason: 'Not used any more.' });
  assert.ok(r.isError, JSON.stringify(r));
  assert.match(r.content[0].text, /Bitwarden/);
  assert.deepEqual(await removeCards(), []);
  assert.ok(await entry('Old login'));
});

test('the card names the bot and the entry, and only the Allow moves the entry to Bitwarden\'s Trash', async (t) => {
  assert.equal((await srv.api('/vault/bitwarden/setup', { method: 'POST', body: { server: 'us', clientId: CLIENT_ID, clientSecret: 'fixture-client-secret' } })).status, 200);
  assert.equal((await srv.api('/vault/bitwarden/unlock', { method: 'POST', body: { password: 'fixture-master' } })).status, 200);
  // Not shared with the bot: it sees the entry in its list all the same (#47), and may ask to remove it.
  await add({ name: KUMA, site: 'api.netcup.example', password: 'kuma-secret', type: 'api-token', allowedBots: [] });
  await add({ name: 'Proxmox', site: 'pve.example.ts.net', username: 'root@pam', password: 'pve-secret', allowedBots: [bot.id] });
  srv.hold();
  const { token, rec } = await heldRun(srv, bot);
  const tools = vaultTools(t, token);
  const said = await tools.text('remove_login', { entry: KUMA, reason: 'Uptime Kuma is gone, so its key is not needed any more.' });
  assert.match(said, /waits for the owner's OK/);
  assert.match(said, /Trash/);
  assert.doesNotMatch(said, /kuma-secret/);
  await tools.text('remove_login', { entry: KUMA, reason: 'again' });

  const cards = await removeCards();
  assert.equal(cards.length, 1, 'asked twice, one card');
  const [card] = cards;
  assert.equal(card.title, `Let VPS Admin remove “${KUMA}” from the Vault?`);
  assert.deepEqual(card.parts, [
    { label: 'Entry', now: `${KUMA} (api.netcup.example)` },
    { label: 'Asked by', now: 'VPS Admin' },
    { label: 'Goes to', now: "Bitwarden's Trash, where you can restore it for 30 days" },
  ]);
  assert.equal(card.reason, 'Uptime Kuma is gone, so its key is not needed any more.');
  assert.equal(card.yes, 'Allow');
  assert.equal(card.yesOn, 'card', 'the yes is given on the card, never from a notification');
  assert.equal(card.text, `Asks to remove “${KUMA}” from the Vault`);
  assert.equal(card.bot.id, bot.id, "it stands in the bot's chat");
  assert.doesNotMatch(JSON.stringify(card), /kuma-secret/);
  assert.ok(await entry(KUMA), 'nothing is removed before the yes');
  // An app that does not ask for these cards (one from before them) is not handed one it would draw wrong.
  assert.ok(!(await srv.api('/asks')).data.some((a) => a.kind === 'vault-remove'));
  assert.ok((await srv.api('/version')).data.features.includes('vault-remove'));

  // Nobody but the owner answers it: not the bot's run, not the Chief.
  const r = await fetch(`http://127.0.0.1:${srv.botdotPort}/api/asks/${card.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bot-Dot': '1', 'X-Run-Token': token }, body: JSON.stringify({ yes: true }) });
  assert.equal(r.status, 403);
  assert.equal((await srv.asChief(`/asks/${card.id}`, { method: 'POST', body: { yes: true } })).status, 403);
  assert.ok(await entry(KUMA));

  srv.release(rec);
  await waitFor(async () => (await srv.api(`/runs?botId=${bot.id}`)).data.every((x) => x.status !== 'running'), { what: 'the run to end' });
  srv.unhold();
  const id = (await entry(KUMA)).id;
  const yes = await srv.api(`/asks/${card.id}`, { method: 'POST', body: { yes: true } });
  assert.equal(yes.status, 200, JSON.stringify(yes.data));
  assert.ok(yes.data.carriesOn, 'the bot carries on');
  assert.equal(await entry(KUMA), undefined);
  assert.equal(inBitwarden(KUMA), false);
  assert.ok(await entry('Proxmox'), 'the other entry stays');
  const deletes = bwCalls().filter((c) => c[0] === 'delete');
  assert.deepEqual(deletes, [['delete', 'item', id]], "to Bitwarden's Trash, never deleted for good");
  const next = await srv.nextRun((x) => x.args.includes('🛠 VPS Admin') && /The owner allowed you to/.test(x.stdin), 'the run that carries on');
  assert.ok(next.stdin.includes(`The owner allowed you to: remove “${KUMA}” from the Vault (it is in Bitwarden's Trash now).`), next.stdin);
  assert.deepEqual(await removeCards(), []);
  await waitFor(async () => (await srv.api(`/runs?botId=${bot.id}`)).data.every((x) => !['running', 'queued'].includes(x.status)), { what: 'the run that carried on to end' });
});

test('a no leaves the entry, and the bot does not ask for it again', async (t) => {
  await add({ name: 'Call key: VPS Admin / Alert Kumy', site: 'hq.botdot.app', password: 'call-secret', type: 'api-token', allowedBots: [] });
  srv.hold();
  const { token, rec } = await heldRun(srv, bot);
  t.after(() => srv.release(rec));
  const tools = vaultTools(t, token);
  await tools.text('remove_login', { entry: 'call key: vps admin / alert kumy', reason: 'The job is gone.' });
  const [card] = await removeCards();
  assert.equal(card.loginName, 'Call key: VPS Admin / Alert Kumy');
  assert.equal((await srv.api(`/asks/${card.id}`, { method: 'POST', body: { yes: false } })).status, 200);
  assert.ok(await entry('Call key: VPS Admin / Alert Kumy'), 'a no removes nothing');
  assert.ok(inBitwarden('Call key: VPS Admin / Alert Kumy'));
  const again = await tools.call('remove_login', { entry: 'Call key: VPS Admin / Alert Kumy', reason: 'Please.' });
  assert.ok(again.isError);
  assert.match(again.content[0].text, /said no to this recently/);
  assert.deepEqual(await removeCards(), []);
});

test('an entry that is not in the Vault is refused', async (t) => {
  srv.hold();
  const { token, rec } = await heldRun(srv, bot);
  t.after(() => srv.release(rec));
  const tools = vaultTools(t, token);
  const refused = async (args, re) => {
    const r = await tools.call('remove_login', { reason: 'r', ...args });
    assert.ok(r.isError, JSON.stringify(r));
    assert.match(r.content[0].text, re);
  };
  await refused({ entry: 'Nothing here' }, /No entry called/);
  await refused({ entry: '' }, /Say which entry/);
  assert.deepEqual(await removeCards(), []);
});

test('an entry gone by the time of the yes: nothing is removed and the card goes', async (t) => {
  await add({ name: 'Short lived', site: 'short.example.com', password: 'short-secret', allowedBots: [other.id] });
  srv.hold();
  const { token, rec } = await heldRun(srv, other);
  t.after(() => srv.release(rec));
  await vaultTools(t, token).text('remove_login', { entry: 'short.example.com', reason: 'Done with it.' });
  const [card] = await removeCards(other.id);
  assert.equal(card.loginName, 'Short lived', 'found by its address too');
  const id = (await entry('Short lived')).id;
  assert.equal((await srv.api(`/vault/${id}`, { method: 'DELETE' })).status, 200);
  const yes = await srv.api(`/asks/${card.id}`, { method: 'POST', body: { yes: true } });
  assert.equal(yes.status, 409, JSON.stringify(yes.data));
  assert.match(yes.data.error, /no longer in the Vault/);
  assert.deepEqual(await removeCards(other.id), []);
});

test("a yes while Bitwarden is slow answers in time, and a second press removes nothing twice", async (t) => {
  await add({ name: 'Slow one', site: 'slow.example.com', password: 'slow-secret', allowedBots: [] });
  srv.hold();
  const { token, rec } = await heldRun(srv, other);
  t.after(() => srv.release(rec));
  await vaultTools(t, token).text('remove_login', { entry: 'Slow one', reason: 'Not needed.' });
  const [card] = await removeCards(other.id);
  const slowFile = path.join(cli(), 'slow');
  fs.writeFileSync(slowFile, 'delete item');
  t.after(() => fs.rmSync(slowFile, { force: true }));
  const before = bwCalls().filter((c) => c[0] === 'delete').length;
  const started = Date.now();
  const late = await srv.api(`/asks/${card.id}`, { method: 'POST', body: { yes: true } });
  assert.ok(Date.now() - started < 3500, 'answered before Bitwarden did');
  assert.equal(late.status, 503, JSON.stringify(late.data));
  assert.match(late.data.error, /Bitwarden didn't answer in time/);
  const again = await srv.api(`/asks/${card.id}`, { method: 'POST', body: { yes: true } });
  assert.equal(again.status, 409, JSON.stringify(again.data));
  assert.match(again.data.error, /being moved to the Trash already/);
  const no = await srv.api(`/asks/${card.id}`, { method: 'POST', body: { yes: false } });
  assert.equal(no.status, 409, 'a no comes too late once it is being moved');
  await waitFor(async () => !(await entry('Slow one')), { what: 'the entry to go' });
  await waitFor(async () => (await removeCards(other.id)).length === 0, { what: 'the card to go' });
  assert.equal(bwCalls().filter((c) => c[0] === 'delete').length - before, 1, 'one bw delete');
});

test('what a bot is told: remove_login asks the owner, and no secret is read for it', async (t) => {
  srv.hold();
  const { token, rec } = await heldRun(srv, bot);
  t.after(() => srv.release(rec));
  assert.match(rec.system, /remove_login/);
  const listed = (await vaultTools(t, token).request('tools/list')).tools;
  const tool = listed.find((x) => x.name === 'remove_login');
  assert.match(tool.description, /Trash/);
  assert.match(tool.description, /owner/);
  assert.deepEqual(tool.inputSchema.required, ['entry', 'reason']);
});
