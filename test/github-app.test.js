// A GitHub App in the Vault (#155): its App ID and private key are saved as a login of type "github-app", and
// wherever a login's secret goes (api_request, run_with_login) botdot hands an installation token it made from the
// key instead, so the key never leaves botdot. GitHub is a stand-in fetch; nothing leaves the machine.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const http = require('node:http');
const githubApp = require('../lib/github-app');
const { apiRequest, hideLogin } = require('../lib/vault-http');
const { startServer, makeBot, heldRun } = require('./helpers');

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
// As GitHub hands it out: PKCS#1, "BEGIN RSA PRIVATE KEY", with its line breaks.
const PEM = privateKey.export({ type: 'pkcs1', format: 'pem' });
const APP = { name: 'Issue Writer', type: 'github-app', site: 'api.github.com', allowedHosts: [], username: '5237335', password: PEM, insecureTls: false, inComputer: true };

// A stand-in GitHub: the calls it got, and what it answers. installations: the app's installations.
function fakeGitHub({ installations = [{ id: 81, account: { login: 'Kordal' } }], status = 200, expiresIn = 60 * 60_000, now = () => Date.now() } = {}) {
  const calls = [];
  let made = 0;
  const fetch = async (url, init) => {
    calls.push({ url, method: init.method, auth: init.headers.Authorization });
    const json = (code, body) => ({ status: code, ok: code < 400, json: async () => body });
    if (status !== 200) return json(status, { message: 'A JSON web token could not be decoded' });
    if (url.endsWith('/app/installations?per_page=100')) return json(200, installations);
    const m = /\/app\/installations\/(\d+)\/access_tokens$/.exec(url);
    if (m && init.method === 'POST') return json(201, { token: `ghs_token${++made}_for_${m[1]}`, expires_at: new Date(now() + expiresIn).toISOString() });
    return json(404, { message: 'Not Found' });
  };
  return { fetch, calls };
}

// The app's JWT a call carried: its claims, after checking its signature with the app's public key.
function claims(auth) {
  const [head, body, sig] = auth.replace(/^Bearer /, '').split('.');
  assert.deepEqual(JSON.parse(Buffer.from(head, 'base64url')), { alg: 'RS256', typ: 'JWT' });
  assert.ok(crypto.verify('sha256', Buffer.from(`${head}.${body}`), publicKey, Buffer.from(sig, 'base64url')), 'signed with the app\'s key');
  return JSON.parse(Buffer.from(body, 'base64url'));
}

test('the App ID, with an installation ID after a slash or not', () => {
  assert.deepEqual(githubApp.appIds('5237335'), { appId: '5237335', installationId: '' });
  assert.deepEqual(githubApp.appIds(' 5237335 / 81 '), { appId: '5237335', installationId: '81' });
  for (const bad of ['', 'abc', '5237335/', '/81', '5237335/x', '-1', '1.5', null, undefined]) assert.equal(githubApp.appIds(bad), null, String(bad));
});

test('a save is refused without an App ID or with a key it cannot sign with, and a PKCS#1 or PKCS#8 RSA key is taken', () => {
  githubApp.check({ username: '5237335', password: PEM });
  githubApp.check({ username: '5237335', password: privateKey.export({ type: 'pkcs8', format: 'pem' }) });
  assert.throws(() => githubApp.check({ username: '5237335/81' }), /private key/, 'no key at all');
  assert.throws(() => githubApp.check({ username: 'kordal-issue-writer', password: PEM }), /App ID \(a number/);
  assert.throws(() => githubApp.check({ username: '5237335', password: PEM.replace(/\n/g, ' ') }), /isn't a private key/, 'a key whose line breaks were lost');
  assert.throws(() => githubApp.check({ username: '5237335', password: 'ghp_notakey' }), /isn't a private key/);
  const ed = crypto.generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' });
  assert.throws(() => githubApp.check({ username: '5237335', password: ed }), /RSA key/);
});

test('GitHub Enterprise Server: its own address with /api/v3', () => {
  assert.equal(githubApp.apiBase('api.github.com'), 'https://api.github.com');
  assert.equal(githubApp.apiBase('github.com'), 'https://api.github.com');
  assert.equal(githubApp.apiBase('github.example.com'), 'https://github.example.com/api/v3');
});

test('a token: a JWT signed with the key finds the only installation, and that installation gets a token', async () => {
  const gh = fakeGitHub();
  const app = githubApp.create({ fetch: gh.fetch });
  assert.equal(await app.token(APP), 'ghs_token1_for_81');
  assert.deepEqual(gh.calls.map((c) => [c.method, c.url]), [['GET', 'https://api.github.com/app/installations?per_page=100'], ['POST', 'https://api.github.com/app/installations/81/access_tokens']]);
  for (const c of gh.calls) {
    const { iss, iat, exp } = claims(c.auth);
    assert.equal(iss, '5237335');
    assert.equal(exp - iat, 600, 'ten minutes, as GitHub takes at most');
    assert.ok(iat <= Date.now() / 1000 - 59, 'a minute back, for a clock that is ahead');
  }
  assert.ok(!JSON.stringify(gh.calls).includes('PRIVATE KEY'), 'the key itself goes nowhere');
});

test('a token is kept until five minutes before it expires, then made again; another key is another token', async () => {
  let clock = Date.parse('2026-10-20T10:00:00Z');
  const now = () => clock;
  const gh = fakeGitHub({ now });
  const app = githubApp.create({ fetch: gh.fetch, now });
  assert.equal(await app.token(APP), 'ghs_token1_for_81');
  assert.equal(await app.token(APP), 'ghs_token1_for_81');
  assert.equal(gh.calls.length, 2, 'the installation and the token were asked for once');
  clock += 54 * 60_000;
  assert.equal(await app.token(APP), 'ghs_token1_for_81');
  clock += 2 * 60_000;
  assert.equal(await app.token(APP), 'ghs_token2_for_81', 'less than five minutes left: a new one');
  assert.equal(gh.calls.length, 3, 'the installation is not looked up again');
  const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' });
  assert.equal(await app.token({ ...APP, password: other }), 'ghs_token3_for_81');
});

test('an installation found and then refused is looked up again (the app was installed again)', async () => {
  let installations = [{ id: 81, account: { login: 'Kordal' } }];
  const calls = [];
  const fetch = async (url, init) => {
    calls.push(url);
    const json = (code, body) => ({ status: code, ok: code < 400, json: async () => body });
    if (url.endsWith('/app/installations?per_page=100')) return json(200, installations);
    return url.includes('/81/') ? json(404, { message: 'Not Found' }) : json(201, { token: 'ghs_new', expires_at: new Date(Date.now() + 3_600_000).toISOString() });
  };
  const app = githubApp.create({ fetch });
  await assert.rejects(app.token(APP), /GitHub said 404/);
  installations = [{ id: 90, account: { login: 'Kordal' } }];
  assert.equal(await app.token(APP), 'ghs_new');
});

test('an installation written after the App ID is used without looking it up', async () => {
  const gh = fakeGitHub({ installations: [] });
  const app = githubApp.create({ fetch: gh.fetch });
  assert.equal(await app.token({ ...APP, username: '5237335/99' }), 'ghs_token1_for_99');
  assert.deepEqual(gh.calls.map((c) => c.url), ['https://api.github.com/app/installations/99/access_tokens']);
});

test('no installation, several, or a key GitHub refuses: a sentence that says what to do', async () => {
  await assert.rejects(githubApp.create({ fetch: fakeGitHub({ installations: [] }).fetch }).token(APP), /not installed anywhere yet/);
  const several = fakeGitHub({ installations: [{ id: 81, account: { login: 'Kordal' } }, { id: 82, account: { login: 'other-org' } }] });
  await assert.rejects(githubApp.create({ fetch: several.fetch }).token(APP), { message: 'This GitHub App is installed on several accounts (Kordal: 81, other-org: 82). Ask the owner to write the installation ID after the App ID in the Vault, e.g. 5237335/81.' });
  await assert.rejects(githubApp.create({ fetch: fakeGitHub({ status: 401 }).fetch }).token(APP), /refused the app's key \(HTTP 401\)/);
  await assert.rejects(githubApp.create({ fetch: fakeGitHub().fetch }).token({ ...APP, password: 'not a key' }), /not a private key botdot can sign with/);
  const down = async () => { throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }); };
  await assert.rejects(githubApp.create({ fetch: down }).token(APP), /Couldn't reach GitHub for the app's token: ENOTFOUND/);
});

test('used as a login: its token in place of its key, with x-access-token as the username; any other login as it is', async () => {
  const app = githubApp.create({ fetch: fakeGitHub().fetch });
  const used = await app.asLogin(APP);
  assert.deepEqual(used, { name: 'Issue Writer', type: 'github-app', site: 'api.github.com', allowedHosts: [], username: 'x-access-token', password: 'ghs_token1_for_81', insecureTls: false, inComputer: true });
  assert.ok(!JSON.stringify(used).includes('PRIVATE KEY'));
  const login = { ...APP, type: 'login', password: 'p' };
  assert.equal(await app.asLogin(login), login);
  // What run_with_login blanks out of a command's output is that token, in each form.
  assert.equal(hideLogin(used)('t=ghs_token1_for_81'), 't=[hidden]');
});

test('a key of several lines given to run_with_login (type Other) is blanked out whole, line by line, and as echo prints it', () => {
  const hide = hideLogin({ username: '', password: PEM });
  const lines = PEM.trim().split('\n');
  assert.ok(!hide(PEM).includes(lines[1]));
  assert.ok(!hide(lines.slice(1, 4).join('\n')).includes(lines[2]), 'head -3 of it');
  assert.ok(!hide(lines.join(' ')).includes(lines[1]), 'an unquoted echo $BOTDOT_PASSWORD');
  assert.equal(hide('-----BEGIN RSA PRIVATE KEY-----'), '-----BEGIN RSA PRIVATE KEY-----', 'its armour is no secret');
});

test('api_request with a GitHub App: {{token}} is its installation token, and only the token reaches the API', async (t) => {
  const seen = [];
  const server = http.createServer((req, res) => { seen.push(req.headers.authorization); res.end(`{"echo":"${req.headers.authorization}"}`); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  t.after(() => server.close());
  const gh = fakeGitHub();
  t.mock.method(globalThis, 'fetch', gh.fetch); // the GitHub the default instance asks
  const creds = { ...APP, username: '5237335/7', site: '127.0.0.1' };
  const r = await apiRequest(creds, { method: 'POST', url: `http://127.0.0.1:${server.address().port}/repos/Kordal/bot-dot/issues`, headers: { Authorization: 'Bearer {{token}}' }, body: { title: 'x' } });
  assert.equal(r.ok, true, r.text);
  assert.deepEqual(seen, ['Bearer ghs_token1_for_7']);
  assert.match(r.text, /\[hidden\]/, 'the token is blanked out of what comes back');
  assert.ok(!r.text.includes('ghs_token1'));
  assert.equal(gh.calls[0].url, 'https://127.0.0.1/api/v3/app/installations/7/access_tokens');
  // An address the login may not reach: refused before any token is made.
  await assert.rejects(apiRequest(creds, { url: 'https://evil.example.com/' }), /only be used with/);
  assert.equal(gh.calls.length, 1);
});

// ---------- through the API ----------

let srv;
let bot;
let token;
before(async () => {
  srv = await startServer();
  bot = await makeBot(srv);
  ({ token } = await heldRun(srv, bot));
});
after(() => srv.stop());

test('GET /api/version: features has vault-github-app', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('vault-github-app'));
});

test('POST /api/vault: a GitHub App is saved with its key byte for byte, refused without an App ID or a key', async () => {
  const bad = await srv.api('/vault', { method: 'POST', body: { name: 'App', site: 'api.github.com', username: 'my-app', password: PEM, type: 'github-app' } });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /App ID/);
  const flat = await srv.api('/vault', { method: 'POST', body: { name: 'App', site: 'api.github.com', username: '5237335', password: PEM.replace(/\n/g, ''), type: 'github-app' } });
  assert.equal(flat.status, 400);
  assert.match(flat.data.error, /isn't a private key/);
  const saved = await srv.api('/vault', { method: 'POST', body: { name: 'Issue Writer', site: 'api.github.com', username: '5237335', password: PEM, type: 'github-app', allowedBots: [bot.id] } });
  assert.equal(saved.status, 201, JSON.stringify(saved.data));
  assert.equal(saved.data.type, 'github-app');
  assert.ok(!JSON.stringify(saved.data).includes('PRIVATE KEY'), 'the key is write-only');
  // A bot sees it, by its type, and never its key.
  const listed = await srv.api('/vault/session/logins', { headers: { 'X-Vault-Token': token } });
  const mine = listed.data.logins.find((l) => l.name === 'Issue Writer');
  assert.equal(mine.type, 'github-app');
  assert.ok(!JSON.stringify(listed.data).includes('PRIVATE KEY'));
  // Any other secret of several lines (type Other) is kept as it is, its line breaks and its last one too.
  const other = await srv.api('/vault', { method: 'POST', body: { name: 'Signing key', site: 'sign.example.com', password: PEM, type: 'other', allowedBots: [bot.id] } });
  assert.equal(other.status, 201);
});
