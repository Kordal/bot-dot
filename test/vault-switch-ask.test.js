// A bot that needs a switch of a saved login turned on ("Accept self-signed certificate", "Usable in its computer")
// asks the owner for it on a card (ask_vault_switch), in its chat and in Needs you, instead of telling them to go to
// the Vault. The owner's yes turns on that one switch of that one login, and the bot carries on. Only for a login
// shared with the bot, and nobody but the owner answers the card.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const { execFileSync } = require('child_process');
const { startServer, makeBot, heldRun, waitFor } = require('./helpers');
const { rpcClient } = require('./memory-helpers');

const PROXMOX = 'Proxmox read-only API token';
let srv; let bot; let other;
const vaultTools = (t, token) => rpcClient(t, 'vault-mcp.js', { VAULT_URL: `${srv.base}/api/vault`, VAULT_TOKEN: token });
const login = async (name) => (await srv.api('/vault')).data.find((l) => l.name === name);
const switchCards = async () => (await srv.api('/asks?vault-switch=1')).data.filter((a) => a.kind === 'vault-switch' && a.botId === bot.id);

before(async () => {
  srv = await startServer();
  bot = await makeBot(srv, { name: 'Proxmox Admin', emoji: '🖥' });
  other = await makeBot(srv, { name: 'Mail Sorter', emoji: '📬' });
  for (const body of [
    { name: PROXMOX, site: 'pve.example.ts.net', username: 'root@pam!botdot', password: 'secret-1', type: 'api-token', allowedBots: [bot.id] },
    { name: 'Proton Bridge', site: '127.0.0.1', username: 'bart@proton.me', password: 'secret-2', allowedBots: [bot.id, other.id] },
    { name: 'NAS', site: 'nas.local', username: 'admin', password: 'secret-3', allowedBots: [other.id] },
  ]) assert.equal((await srv.api('/vault', { method: 'POST', body })).status, 201);
});
after(async () => { srv.unhold(); await srv.stop(); });

test('the card names the login and the switch in plain words, in Needs you for an app that asks for it', async (t) => {
  const { token, rec } = await heldRun(srv, bot);
  const tools = vaultTools(t, token);
  const said = await tools.text('ask_vault_switch', { login: PROXMOX, switch: 'insecureTls', reason: 'Proxmox has a self-signed certificate, so I could not check its VMs.' });
  assert.match(said, /waits for the owner's OK/);
  assert.match(said, /Don't tell the owner to change it in the Vault/);
  await tools.text('ask_vault_switch', { login: PROXMOX, switch: 'insecureTls', reason: 'again' });

  const cards = await switchCards();
  assert.equal(cards.length, 1, 'asked twice, one card');
  const [card] = cards;
  assert.equal(card.title, `Let Proxmox Admin accept a self-signed certificate for “${PROXMOX}”?`);
  assert.deepEqual(card.parts, [
    { label: 'Login', now: `${PROXMOX} (pve.example.ts.net)` },
    { label: 'Switch', now: 'Accept self-signed certificate' },
    { label: 'Only for', now: 'this login, for every bot it is shared with' },
  ]);
  assert.equal(card.reason, 'Proxmox has a self-signed certificate, so I could not check its VMs.');
  assert.equal(card.yes, 'Allow');
  assert.equal(card.yesOn, 'card', 'the yes is given on the card, never from a notification');
  assert.equal(card.warning, undefined);
  assert.equal(card.text, `Asks to turn on “Accept self-signed certificate” for “${PROXMOX}”`);
  assert.equal(card.bot.id, bot.id, "it stands in the bot's chat");
  assert.equal((await login(PROXMOX)).insecureTls, false, 'nothing changes before the yes');

  // An app that does not ask for these cards (one from before them) is not handed one it would draw wrong.
  assert.ok(!(await srv.api('/asks')).data.some((a) => a.kind === 'vault-switch'));
  assert.ok((await srv.api('/version')).data.features.includes('vault-switch'));

  // The yes turns on that switch of that login only, and the bot carries on with what it was asked.
  srv.release(rec);
  await waitFor(async () => (await srv.api(`/runs?botId=${bot.id}`)).data.every((r) => r.status !== 'running'), { what: 'the run to end' });
  const before = { proton: await login('Proton Bridge'), nas: await login('NAS') };
  srv.unhold();
  const yes = await srv.api(`/asks/${card.id}`, { method: 'POST', body: { yes: true } });
  assert.equal(yes.status, 200, JSON.stringify(yes.data));
  assert.ok(yes.data.carriesOn, 'the bot carries on');
  const after = await login(PROXMOX);
  assert.deepEqual([after.insecureTls, after.inComputer], [true, false]);
  for (const [name, was] of [['Proton Bridge', before.proton], ['NAS', before.nas]]) {
    const now = await login(name);
    assert.deepEqual([now.insecureTls, now.inComputer], [was.insecureTls, was.inComputer], `${name} is as it was`);
  }
  const next = await srv.nextRun((x) => x.args.includes('🖥 Proxmox Admin') && /The owner allowed you to/.test(x.stdin), 'the run that carries on');
  assert.ok(next.stdin.includes(`The owner allowed you to: use “${PROXMOX}” with a self-signed certificate.`), next.stdin);
  assert.deepEqual(await switchCards(), []);
  // The run that carried on ends before the next test holds one.
  await waitFor(async () => (await srv.api(`/runs?botId=${bot.id}`)).data.length >= 2 && (await srv.api(`/runs?botId=${bot.id}`)).data.every((r) => !['running', 'queued'].includes(r.status)), { what: 'the run that carried on to end' });
});

test('"Usable in its computer" says that the bot\'s commands will be able to read the secret', async (t) => {
  srv.hold();
  const { token, rec } = await heldRun(srv, bot);
  t.after(() => srv.release(rec));
  await vaultTools(t, token).text('ask_vault_switch', { login: 'Proton Bridge', switch: 'inComputer', reason: 'To read mail through Proton Bridge on my computer.' });
  const [card] = await switchCards();
  assert.equal(card.title, 'Let Proxmox Admin use “Proton Bridge” in its computer?');
  assert.deepEqual(card.parts[1], { label: 'Switch', now: 'Usable in its computer' });
  assert.equal(card.warning, "Proxmox Admin's commands will be able to read this secret. Only for a secret that guards something on its own computer.");
  assert.equal((await srv.api(`/asks/${card.id}`, { method: 'POST', body: { yes: false } })).status, 200);
  assert.equal((await login('Proton Bridge')).inComputer, false, 'a no changes nothing');
  // After a no the bot does not ask for it again for a while.
  const again = await vaultTools(t, token).call('ask_vault_switch', { login: 'Proton Bridge', switch: 'inComputer', reason: 'Please.' });
  assert.ok(again.isError);
  assert.match(again.content[0].text, /said no to this recently/);
  assert.deepEqual(await switchCards(), []);
});

test('only for a login shared with the bot, a switch that is off, and one of the two switches', async (t) => {
  srv.hold();
  const { token, rec } = await heldRun(srv, bot);
  t.after(() => srv.release(rec));
  const tools = vaultTools(t, token);
  const refused = async (args, re) => {
    const r = await tools.call('ask_vault_switch', { reason: 'r', ...args });
    assert.ok(r.isError, JSON.stringify(r));
    assert.match(r.content[0].text, re);
  };
  await refused({ login: 'NAS', switch: 'insecureTls' }, /isn't allowed to use the \\?"NAS\\?" login/);
  await refused({ login: 'Nothing here', switch: 'insecureTls' }, /No saved login/);
  await refused({ login: PROXMOX, switch: 'insecureTls' }, /already on/);
  await refused({ login: PROXMOX, switch: 'allowedBots' }, /insecureTls or inComputer/);
  assert.deepEqual(await switchCards(), []);
});

test("nobody but the owner answers the card: not the bot's run, not the Chief", async (t) => {
  srv.hold();
  const { token, rec } = await heldRun(srv, other);
  t.after(() => srv.release(rec));
  await vaultTools(t, token).text('ask_vault_switch', { login: 'NAS', switch: 'insecureTls', reason: 'Self-signed.' });
  const card = (await srv.api('/asks?vault-switch=1')).data.find((a) => a.kind === 'vault-switch' && a.botId === other.id);
  // The bot's run reaches botdot on its own port, with its run's key: only its run's tools are there.
  for (const headers of [{ 'X-Run-Token': token }, { 'X-Vault-Token': token }]) {
    const r = await fetch(`http://127.0.0.1:${srv.botdotPort}/api/asks/${card.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bot-Dot': '1', ...headers }, body: JSON.stringify({ yes: true }) });
    assert.equal(r.status, 403);
  }
  for (const what of ['ask', 'asks']) {
    const r = await fetch(`http://127.0.0.1:${srv.botdotPort}/api/vault/session/${what}/${card.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bot-Dot': '1', 'X-Vault-Token': token }, body: JSON.stringify({ yes: true }) });
    assert.ok(r.status >= 400, `${what}: ${r.status}`);
  }
  assert.equal((await srv.asChief(`/asks/${card.id}`, { method: 'POST', body: { yes: true } })).status, 403);
  assert.equal((await login('NAS')).insecureTls, false);
  assert.equal((await switchCards()).length, 0);
  // A login that is no longer shared with the bot by the time of the yes: nothing changes, and the card goes.
  const nas = await login('NAS');
  await srv.api(`/vault/${nas.id}`, { method: 'PUT', body: { allowedBots: [] } });
  const yes = await srv.api(`/asks/${card.id}`, { method: 'POST', body: { yes: true } });
  assert.equal(yes.status, 409);
  assert.equal((await login('NAS')).insecureTls, false);
  assert.ok(!(await srv.api('/asks?vault-switch=1')).data.some((a) => a.id === card.id));
});

test('what a bot is told sends it to ask_vault_switch, not to the Vault', async (t) => {
  srv.hold();
  const { token, rec } = await heldRun(srv, bot);
  t.after(() => srv.release(rec));
  assert.match(rec.system, /ask_vault_switch/);
  assert.doesNotMatch(rec.system, /turn on "Usable in its computer" for it in the Vault/);
  const listed = (await vaultTools(t, token).request('tools/list')).tools;
  assert.match(listed.find((x) => x.name === 'ask_vault_switch').description, /Never tell the owner to change it in the Vault/);
  const computer = rpcClient(t, 'computer-mcp.js', { VAULT_URL: `${srv.base}/api/vault`, VAULT_TOKEN: token, COMPUTER_CONTAINER: 'none' });
  const runWithLogin = (await computer.request('tools/list')).tools.find((x) => x.name === 'run_with_login');
  assert.match(runWithLogin.description, /ask_vault_switch/);
  assert.doesNotMatch(runWithLogin.description, /in the Vault/);
});

test("api_request to a server with a self-signed certificate tells the bot to ask with ask_vault_switch", async (t) => {
  let pem;
  try {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-cert-'));
    execFileSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-keyout', path.join(dir, 'k.pem'), '-out', path.join(dir, 'c.pem'), '-days', '1', '-subj', '/CN=127.0.0.1'], { stdio: 'ignore' });
    pem = { key: fs.readFileSync(path.join(dir, 'k.pem')), cert: fs.readFileSync(path.join(dir, 'c.pem')) };
    fs.rmSync(dir, { recursive: true, force: true });
  } catch { return t.skip('openssl is not here'); }
  const server = https.createServer(pem, (req, res) => res.end('{"data":[]}'));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  srv.hold();
  const { token, rec } = await heldRun(srv, bot);
  t.after(() => srv.release(rec));
  const r = await vaultTools(t, token).call('api_request', { login: 'Proton Bridge', url: `https://127.0.0.1:${server.address().port}/api2/json/nodes` });
  assert.ok(r.isError);
  assert.match(r.content[0].text, /ask_vault_switch/);
  assert.match(r.content[0].text, /“Proton Bridge”|"Proton Bridge"/);
  assert.doesNotMatch(r.content[0].text, /tick/);
});
