// A login request answered with any saved login (VAULT-001): the request lists the logins of other websites
// (`others`), and `allow` with one of them adds the requested host to that login's additional hosts. The bot
// then finds the login by that host, calls the host's API with it, and its browser types it on exactly that
// host. Nothing here starts a computer: the browser is a stand-in.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

// The stores run in this process too: a key of their own, so nothing asks the Keychain.
process.env.BOT_DOT_VAULT_KEY = crypto.randomBytes(32).toString('hex');
process.env.BW_BIN = path.join(__dirname, 'fixtures', 'fake-bw.js');
const vaultLib = require('../lib/vault');
const bitwardenLib = require('../lib/bitwarden');
const loginRequests = require('../lib/login-requests');
const { siteToType } = require('../lib/vault-type');
const { startServer, makeBot, heldRun } = require('./helpers');

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-vault-'));
const auditLog = (s) => { try { return fs.readFileSync(path.join(s.data, 'audit.log'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; } };
const hostLines = (s) => auditLog(s).filter((l) => l.action === 'login.host-allowed').map(({ time, ...l }) => l);

let srv; let bot; let token; let api;
const saved = {}; // name -> the login as POST /api/vault answered
const save = async (body) => { const r = await srv.api('/vault', { method: 'POST', body }); assert.equal(r.status, 201, JSON.stringify(r.data)); saved[r.data.name] = r.data; return r.data; };
const login = async (id) => (await srv.api('/vault')).data.find((e) => e.id === id);
const ask = async (site) => { const r = await srv.api('/vault/requests', { method: 'POST', body: { site, forBot: bot.id, reason: 'To sign in.' } }); assert.equal(r.status, 201, JSON.stringify(r.data)); return r.data.id; };
const open = async (id) => (await srv.api('/vault/requests')).data.find((r) => r.id === id);
const answer = (id, body) => srv.api(`/vault/requests/${id}`, { method: 'POST', body });
const asBot = (p, body) => srv.api(`/vault/session/${p}`, { method: body ? 'POST' : 'GET', body, headers: { 'X-Vault-Token': token } });

before(async () => {
  srv = await startServer();
  bot = await makeBot(srv);
  ({ token } = await heldRun(srv, bot));
  // The requested host's API: it takes the token of the login saved for another website.
  api = http.createServer((req, res) => res.end(req.headers.authorization === 'Bearer portal-secret' ? 'accepted' : 'missing'));
  await new Promise((r) => api.listen(0, '127.0.0.1', r));
  await save({ name: 'Portal', site: 'portal.example.com', username: 'bart', password: 'portal-secret' });
  await save({ name: 'Local', site: '127.0.0.1', username: 'here', password: 'local-secret' });
  await save({ name: 'Full', site: 'full.example.com', username: 'f', password: 'full-secret', allowedHosts: Array.from({ length: 20 }, (_, i) => `h${i}.example.com`) });
});
after(async () => { api.close(); await srv.stop(); });

test('a login request lists the logins of its site in existing and every other saved login in others', async () => {
  const r = await open(await ask('127.0.0.1'));
  assert.deepEqual(r.existing, [{ id: saved.Local.id, name: 'Local', username: 'here', allowed: false }]);
  assert.deepEqual(r.others, [
    { id: saved.Portal.id, name: 'Portal', username: 'bart', site: 'portal.example.com' },
    { id: saved.Full.id, name: 'Full', username: 'f', site: 'full.example.com' },
  ], 'each as { id, name, username, site }, and never one of existing');
  assert.ok(!JSON.stringify(r).includes('secret'), 'no password');
});

test('before the pick the bot cannot use the login on the requested host', async () => {
  const r = await asBot('http', { login: 'Portal', url: `http://127.0.0.1:${api.address().port}/`, headers: { Authorization: 'Bearer {{password}}' } });
  assert.equal(r.data.ok, false);
  assert.match(r.data.error, /isn't allowed to use/);
});

test('allow with a login of the site: answered as before, the login gains no host', async () => {
  const id = await ask('127.0.0.1');
  const r = await answer(id, { action: 'allow', loginId: saved.Local.id });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.status, 'allowed');
  assert.equal(r.data.loginName, 'Local');
  const e = await login(saved.Local.id);
  assert.deepEqual(e.allowedHosts, []);
  assert.deepEqual(e.allowedBots, [bot.id]);
  assert.deepEqual(hostLines(srv), [], 'no audit line: no host was added');
  // Back to how it was, for the tests below: the bot may use the Portal login only.
  await srv.api(`/vault/${saved.Local.id}`, { method: 'PUT', body: { allowedBots: [] } });
});

test('allow with a login of another website: the host and the bot are added, the request settles, the audit log says so', async () => {
  const id = await ask('127.0.0.1');
  const r = await answer(id, { action: 'allow', loginId: saved.Portal.id });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.status, 'allowed');
  assert.equal(r.data.loginName, 'Portal');
  const e = await login(saved.Portal.id);
  assert.deepEqual(e.allowedHosts, ['127.0.0.1']);
  assert.deepEqual(e.allowedBots, [bot.id]);
  assert.equal(e.site, 'portal.example.com', 'its website stays');
  assert.deepEqual(hostLines(srv), [{ actor: 'owner', action: 'login.host-allowed', login: 'Portal', host: '127.0.0.1', bot: bot.id }]);
  assert.equal(await open(id), undefined, 'the request is answered');
  assert.equal((await answer(id, { action: 'allow', loginId: saved.Portal.id })).status, 409);
});

test('after the pick: list_logins shows the additional host, and api_request to the requested host succeeds with that login', async () => {
  const list = await asBot('logins');
  assert.deepEqual(list.data.logins, [{ name: 'Portal', site: 'portal.example.com', username: 'bart', type: 'login', allowedHosts: ['127.0.0.1'] }]);
  const url = `http://127.0.0.1:${api.address().port}/`;
  // By its name, and by the requested host (the Local login of that site is not this bot's).
  for (const name of ['Portal', '127.0.0.1']) {
    const r = await asBot('http', { login: name, url, headers: { Authorization: 'Bearer {{password}}' } });
    assert.equal(r.data.ok, true, `${name}: ${JSON.stringify(r.data)}`);
    assert.match(r.data.text, /accepted/);
    assert.ok(!r.data.text.includes('portal-secret'));
  }
});

test('a second pick of the same login for the same host adds the host once, and is logged for the second bot too', async () => {
  const other = await makeBot(srv, { name: 'Second Bot' });
  const made = await srv.api('/vault/requests', { method: 'POST', body: { site: '127.0.0.1', forBot: other.id } });
  const r = await answer(made.data.id, { action: 'allow', loginId: saved.Portal.id });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const e = await login(saved.Portal.id);
  assert.deepEqual(e.allowedHosts, ['127.0.0.1']);
  assert.deepEqual(e.allowedBots, [bot.id, other.id]);
  assert.deepEqual(hostLines(srv)[1], { actor: 'owner', action: 'login.host-allowed', login: 'Portal', host: '127.0.0.1', bot: other.id }, 'the second bot also got a login of another website');
  assert.equal(hostLines(srv).length, 2);
});

test('a login with 20 additional hosts: 400 with a sentence, the login unchanged, the request still open', async () => {
  const id = await ask('twentyfirst.example.com');
  const r = await answer(id, { action: 'allow', loginId: saved.Full.id });
  assert.equal(r.status, 400);
  assert.equal(r.data.error, '"Full" already has 20 additional hosts. Remove one in the Vault first.');
  const e = await login(saved.Full.id);
  assert.equal(e.allowedHosts.length, 20);
  assert.ok(!e.allowedHosts.includes('twentyfirst.example.com'));
  assert.deepEqual(e.allowedBots, [], 'the bot was not added either');
  assert.equal((await open(id)).status, 'pending');
  assert.equal(hostLines(srv).length, 2, 'nothing logged');
});

test('a request for an IPv6 address is answered with a login of another website too', async () => {
  const six = await save({ name: 'Six', site: 'six.example.com', password: 'six-secret', allowedHosts: ['[::1]'] });
  const id = await ask('http://[fd00::8]:8006');
  const r = await answer(id, { action: 'allow', loginId: six.id });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual((await login(six.id)).allowedHosts, ['::1', 'fd00::8']);
  assert.deepEqual(hostLines(srv).at(-1), { actor: 'owner', action: 'login.host-allowed', login: 'Six', host: 'fd00::8', bot: bot.id });
});

test('a host with a character outside letters, digits, dots and hyphens is added and logged like any other', async () => {
  const odd = await save({ name: 'Odd', site: 'odd.example.com', password: 'odd-secret' });
  const id = await ask('a~b.example.org');
  const r = await answer(id, { action: 'allow', loginId: odd.id });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual((await login(odd.id)).allowedHosts, ['a~b.example.org']);
  assert.deepEqual(hostLines(srv).at(-1), { actor: 'owner', action: 'login.host-allowed', login: 'Odd', host: 'a~b.example.org', bot: bot.id });
});

test('an unknown loginId: 404, and the request stays open', async () => {
  const id = await ask('nowhere.example.com');
  const r = await answer(id, { action: 'allow', loginId: 'made-up' });
  assert.equal(r.status, 404);
  assert.equal(r.data.error, 'Login not found');
  assert.equal((await open(id)).status, 'pending');
});

test("the Chief's tools cannot answer a request, with any login", async () => {
  const id = await ask('chief.example.com');
  assert.equal((await srv.asChief(`/vault/requests/${id}`, { method: 'POST', body: { action: 'allow', loginId: saved.Portal.id } })).status, 403);
  assert.deepEqual((await login(saved.Portal.id)).allowedHosts, ['127.0.0.1']);
});

test('with Bitwarden locked, others is empty, as existing is', async (t) => {
  const dir = scratch();
  fs.mkdirSync(path.join(dir, 'data'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'data', 'bitwarden.json'), JSON.stringify({ server: 'https://vault.example.com', clientId: 'user.00000000-0000-0000-0000-000000000000' }));
  const locked = await startServer({ dir });
  t.after(() => locked.stop());
  const b = await makeBot(locked);
  const made = await locked.api('/vault/requests', { method: 'POST', body: { site: 'shop.example.com', forBot: b.id } });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const r = (await locked.api('/vault/requests')).data.find((x) => x.id === made.data.id);
  assert.deepEqual(r.existing, []);
  assert.deepEqual(r.others, []);
});

// ---------- the request's logins (lib/login-requests.js), with the built-in store ----------

test('a card request has no others; a login request leaves out what a bot cannot use', () => {
  const store = vaultLib.create(scratch());
  const here = store.add({ name: 'Shop', site: 'shop.example.com', password: 'p' });
  const elsewhere = store.add({ name: 'Bank', site: 'bank.example.com', password: 'p' });
  const card = loginRequests.logins(store, { kind: 'card', site: 'shop.example.com' });
  assert.deepEqual(Object.keys(card), ['existing'], 'no others for a card');
  const r = loginRequests.logins(store, { kind: 'login', site: 'shop.example.com' });
  assert.deepEqual(r.existing.map((e) => e.id), [here.id]);
  assert.deepEqual(r.others.map((e) => e.id), [elsewhere.id]);
  // Bitwarden's list also has cards and identities, and logins that ask for the master password again.
  const bw = {
    findBySite: () => [{ id: 'a', kind: 'login' }],
    list: () => [{ id: 'a', kind: 'login' }, { id: 'b', kind: 'login' }, { id: 'c', kind: 'card' }, { id: 'd', kind: 'identity' }, { id: 'e', kind: 'login', reprompt: true }],
  };
  assert.deepEqual(loginRequests.logins(bw, { kind: 'login', site: 'x' }).others.map((e) => e.id), ['b']);
});

// ---------- the lookup by an additional host (findFor of both stores) ----------

test('the built-in store: a login is found by an additional host, exactly, after its id, name and website', () => {
  const store = vaultLib.create(scratch());
  const portal = store.add({ name: 'Portal', site: 'portal.example.com', username: 'bart', password: 'portal-secret', allowedBots: ['bot1'], allowedHosts: ['app.example.org'] });
  assert.equal(store.credentials('bot1', 'app.example.org').name, 'Portal');
  assert.equal(store.credentials('bot1', 'https://APP.example.org/login').name, 'Portal', 'an address is read as its host');
  assert.deepEqual(store.reveal('bot1', 'app.example.org', 'username'), { site: 'portal.example.com', allowedHosts: ['app.example.org'], name: 'Portal', value: 'bart' });
  assert.deepEqual(store.forBot('bot1'), [{ name: 'Portal', site: 'portal.example.com', username: 'bart', type: 'login', allowedHosts: ['app.example.org'] }]);
  assert.throws(() => store.credentials('bot1', 'sub.app.example.org'), /No saved login/, 'not a subdomain of an additional host');
  assert.throws(() => store.credentials('bot2', 'app.example.org'), /isn't allowed/, 'another bot is told it may not');
  // A login saved for that very host comes first; one the bot may use is preferred over one it may not.
  const own = store.add({ name: 'App', site: 'app.example.org', password: 'app-secret', allowedBots: [] });
  assert.equal(store.credentials('bot1', 'app.example.org').name, 'Portal', "the bot's own login by the additional host, not the site's login it may not use");
  store.update(own.id, { allowedBots: ['bot1'] });
  assert.equal(store.credentials('bot1', 'app.example.org').name, 'App', 'the website wins over an additional host');
  assert.equal(store.credentials('bot1', portal.id).name, 'Portal');
});

test('Bitwarden: a login is found by an additional host, exactly, and reveal and forBot carry the hosts', async () => {
  const dir = scratch();
  fs.writeFileSync(path.join(dir, 'bitwarden.json'), JSON.stringify({ server: 'https://vault.example.com', clientId: 'user.00000000-0000-0000-0000-000000000000', folderId: 'folder-1' }));
  const bw = bitwardenLib.create(dir);
  fs.writeFileSync(path.join(dir, 'bitwarden-cli', 'items.json'), JSON.stringify([
    { id: 'i-portal', type: 1, name: 'Portal', login: { uris: [{ uri: 'https://portal.example.com' }], username: 'bart', password: 'portal-secret' } },
    { id: 'i-app', type: 1, name: 'App', login: { uris: [{ uri: 'https://app.example.org' }], username: 'other', password: 'app-secret' } },
    { id: 'i-card', type: 3, name: 'Visa', card: { number: '4111111111111111' } },
  ]));
  await bw.unlock('fixture-master');
  assert.equal(bw.unlocked(), true);
  bw.setAccess('i-portal', { bots: ['bot1'], allowedHosts: ['app.example.org', 'api.example.net'] });
  assert.equal(bw.credentials('bot1', 'api.example.net').name, 'Portal');
  assert.deepEqual(bw.credentials('bot1', 'api.example.net').allowedHosts, ['app.example.org', 'api.example.net']);
  assert.deepEqual(await bw.reveal('bot1', 'api.example.net', 'username'), { site: 'portal.example.com', allowedHosts: ['app.example.org', 'api.example.net'], name: 'Portal', value: 'bart' });
  assert.throws(() => bw.credentials('bot1', 'sub.api.example.net'), /No saved login/, 'not a subdomain of an additional host');
  assert.equal(bw.credentials('bot1', 'app.example.org').name, 'Portal', "the bot's own login by the additional host, not the site's login it may not use");
  bw.setAccess('i-app', { bots: ['bot1'] });
  assert.equal(bw.credentials('bot1', 'app.example.org').name, 'App', 'the website wins over an additional host');
  assert.deepEqual(bw.forBot('bot1').find((e) => e.name === 'Portal'), { kind: 'login', name: 'Portal', type: 'login', site: 'portal.example.com', username: 'bart', hasTotp: false, allowedHosts: ['app.example.org', 'api.example.net'] });
  assert.throws(() => bw.card('bot1', 'api.example.net'), /No saved card/, 'additional hosts are for logins only');
  await bw.lock();
});

// ---------- the site handed to the bot's browser (lib/vault-type.js) ----------

// The browser as deploy/desktop/camoufox-browser answers: where it is, and whether it types (its host_matches).
function browser(pageHost) {
  const calls = [];
  const type = async (payload) => {
    calls.push(payload);
    if (payload.op === 'where') return { ok: true, host: pageHost };
    const ok = pageHost === payload.site || pageHost.endsWith(`.${payload.site}`);
    return ok ? { ok: true } : { ok: false, error: `The browser is on ${pageHost}, not ${payload.site}. Open the right site first.` };
  };
  return { type, calls };
}
const SECRET = { site: 'portal.example.com', allowedHosts: ['app.example.org'], name: 'Portal', value: 'portal-secret' };
const typeOn = async (pageHost, secret = SECRET) => {
  const b = browser(pageHost);
  const site = await siteToType(b.type, secret);
  return { site, calls: b.calls, result: await b.type({ site, field: 'password', value: secret.value, submit: false }) };
};

test('type_login: the website and its subdomains as before, and exactly an additional host', async () => {
  assert.equal((await typeOn('portal.example.com')).site, 'portal.example.com');
  const sub = await typeOn('login.portal.example.com');
  assert.equal(sub.site, 'portal.example.com');
  assert.equal(sub.result.ok, true, 'a subdomain of the website, as today');
  const extra = await typeOn('app.example.org');
  assert.equal(extra.site, 'app.example.org', 'the additional host itself is handed over');
  assert.equal(extra.result.ok, true);
  assert.equal((await typeOn('APP.example.org.')).site, 'app.example.org', 'however the browser spells the host');
});

test('type_login: a subdomain of an additional host, or any other host, is refused with the sentence of today', async () => {
  const sub = await typeOn('evil.app.example.org');
  assert.equal(sub.site, 'portal.example.com', "the login's website, so the browser refuses");
  assert.deepEqual(sub.result, { ok: false, error: 'The browser is on evil.app.example.org, not portal.example.com. Open the right site first.' });
  const foreign = await typeOn('attacker.example.net');
  assert.equal(foreign.site, 'portal.example.com');
  assert.equal(foreign.result.ok, false);
  assert.match(foreign.result.error, /The browser is on attacker\.example\.net, not portal\.example\.com\. Open the right site first\./);
  assert.equal((await typeOn('notapp.example.org')).site, 'portal.example.com', 'not a host that merely ends alike');
});

test('type_login: a login without additional hosts is typed as before, without asking the browser where it is', async () => {
  const plain = await typeOn('portal.example.com', { site: 'portal.example.com', name: 'Portal', value: 'x' });
  assert.equal(plain.site, 'portal.example.com');
  assert.deepEqual(plain.calls.map((c) => c.op || c.field), ['password']);
  // A browser that cannot say where it is: the website, and the browser gives its own answer.
  assert.equal(await siteToType(async () => ({ ok: false, error: 'Camoufox has no open page.' }), SECRET), 'portal.example.com');
  assert.equal(await siteToType(async () => ({ ok: true, host: '' }), SECRET), 'portal.example.com');
});

test('the server asks the browser where it is and hands it the chosen site (the type route)', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'lib', 'routes', 'vault.js'), 'utf8');
  const a = server.indexOf("if (parts[2] === 'type' && m === 'POST')");
  const route = server.slice(a, server.indexOf("if (parts[2] === 'card' && m === 'POST')", a));
  assert.match(route, /const site = await siteToType\(\(payload\) => typeInComputer\(session, payload\), secret\);/);
  assert.match(route, /typeInComputer\(session, \{ site, field: kind, value: secret\.value, submit: !!submit \}\)/);
  assert.doesNotMatch(route, /site: secret\.site/);
});
