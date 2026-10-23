// Connectors run only on a Composio key the owner made and pasted: botdot makes no Composio account of its own.
// A key of an account botdot made before keeps working until Composio refuses it. A stand-in for Composio's API.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { startServer } = require('./helpers');

const OWN_KEY = 'pk_my_own_key_789';
const OWN_KEY_2 = 'pk_mine_mine_mine_2';
const OLD_KEY = 'pk_old_old_old_old'; // the project key of an account botdot made before

const seen = { requests: [], keys: new Set(), dead: new Set(), accounts: {} };
const fake = http.createServer((req, res) => {
  const json = (code, d) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };
  const url = new URL(req.url, 'http://x');
  seen.requests.push(url.pathname);
  const key = req.headers['x-api-key'];
  // Composio still lists its catalogue on a key it otherwise refuses.
  if (url.pathname === '/toolkits' && seen.dead.has(key)) return json(200, { items: [{ slug: 'gmail', name: 'Gmail', meta: { categories: [] } }], next_cursor: null });
  if (![OWN_KEY, OWN_KEY_2, OLD_KEY].includes(key) || seen.dead.has(key)) return json(401, { message: 'Bad key' });
  seen.keys.add(key);
  if (url.pathname === '/toolkits') return json(200, { items: [{ slug: 'gmail', name: 'Gmail', meta: { categories: [{ name: 'email' }] }, composio_managed_auth_schemes: ['OAUTH2'] }], next_cursor: null });
  // Connecting GitHub (#464): an auth config is there, and Composio refuses the sign-in link in its own words.
  if (url.pathname === '/toolkits/github') return json(200, { slug: 'github', name: 'GitHub MCP', composio_managed_auth_schemes: ['OAUTH2'] });
  if (url.pathname === '/auth_configs') return json(200, { items: url.searchParams.get('toolkit_slug') === 'github' ? [{ id: 'ac_github', status: 'ENABLED' }] : [] });
  if (url.pathname === '/connected_accounts/link') return json(400, { error: { message: '{"code":1803,"detail":"ConnectedAccount_MultipleAccountsNotAllowed for ac_github"}' } });
  if (url.pathname === '/toolkits/devapp') return json(200, { slug: 'devapp', name: 'Dev App', auth_schemes: ['OAUTH2'] });
  if (url.pathname === '/connected_accounts' && seen.odd) return json(200, { items: [{ id: 'ca_notion', toolkit: { slug: 'notion' } }, { id: 'ca_none' }, { id: 'ca_gmail', toolkit: { slug: 'gmail' }, status: 'ACTIVE' }] });
  if (url.pathname === '/connected_accounts') return json(200, { items: (seen.accounts[key] || []).map((slug) => ({ id: `ca_${slug}`, toolkit: { slug }, status: 'ACTIVE' })) });
  return json(404, { message: 'Not here' });
});

let srv;
before(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const at = `http://127.0.0.1:${fake.address().port}`;
  srv = await startServer({ env: { COMPOSIO_API_URL: at } });
});
after(async () => { await srv?.stop(); fake.close(); });

const FILE = () => path.join(srv.data, 'connectors.json');
const file = () => fs.readFileSync(FILE(), 'utf8');

test('without a key, Connectors ask for one and botdot makes no Composio account', async () => {
  const r = await srv.api('/connectors');
  assert.equal(r.status, 200);
  assert.equal(r.data.configured, false);
  assert.equal(r.data.error, null);
  assert.deepEqual(r.data.connections, []);
  assert.deepEqual(seen.requests, [], 'nothing was asked of Composio');
  assert.ok(!('claimInvite' in r.data) && !('claimed' in r.data), 'no claim of an account botdot made');
  for (const [p, method] of [['/connectors/catalog', 'GET'], ['/connectors/categories', 'GET'], ['/connectors/connect', 'POST']]) {
    const x = await srv.api(p, { method, body: method === 'POST' ? { app: 'gmail' } : undefined });
    assert.equal(x.status, 409, `${p} waits for a key`);
    assert.match(x.data.error, /need a Composio key/);
  }
});

test('an older app\'s "New Composio account" and Claim are refused, saying to paste a key', async () => {
  for (const p of ['/connectors/renew', '/connectors/claim']) {
    const r = await srv.api(p, { method: 'POST', body: { email: 'me@example.com' } });
    assert.equal(r.status, 400);
    assert.match(r.data.error, /no longer makes Composio accounts\. Paste your own Composio API key/);
  }
  assert.deepEqual(seen.requests, []);
});

test('your own key is checked, saved encrypted, and removing it leaves Connectors waiting for a key', async () => {
  const bad = await srv.api('/connectors/key', { method: 'PUT', body: { key: 'pk_nope' } });
  assert.notEqual(bad.status, 200);
  assert.match(bad.data.error, /doesn't accept that key/);
  const own = await srv.api('/connectors/key', { method: 'PUT', body: { key: OWN_KEY } });
  assert.equal(own.data.configured, true);
  assert.equal(own.data.account, 'own');
  assert.equal(own.data.keyHint, '…_789');
  assert.ok(!file().includes(OWN_KEY), 'kept encrypted');
  assert.equal((await srv.api('/connectors/catalog')).data.items[0].slug, 'gmail');

  await srv.api('/connectors/key', { method: 'DELETE' });
  const gone = await srv.api('/connectors');
  assert.equal(gone.data.configured, false);
  assert.equal(gone.data.account, null);
});

test('a key of an account botdot made before keeps working, and refused it is replaced by your own', async () => {
  // As an earlier botdot left it: the key, and the account it made.
  process.env.BOT_DOT_VAULT_KEY_FILE = path.join(path.dirname(srv.data), 'config', 'vault.key');
  const { encrypt } = require('../lib/vault');
  const d = JSON.parse(file());
  const key = encrypt(OLD_KEY);
  Object.assign(d, { key, own: false, keyHint: null, agent: { key, agentKey: encrypt('ak_old_old_old'), createdAt: '2026-10-18T17:39:00Z' } });
  fs.writeFileSync(FILE(), JSON.stringify(d));
  seen.accounts[OLD_KEY] = ['github', 'gmail'];

  const r = await srv.api('/connectors');
  assert.equal(r.data.configured, true);
  assert.equal(r.data.account, 'botdot');
  assert.equal(r.data.keyRejected, false);
  assert.equal(r.data.connections.length, 2);

  seen.dead.add(OLD_KEY);
  const refused = await srv.api('/connectors');
  assert.equal(refused.data.keyRejected, true);
  assert.equal(refused.data.account, 'botdot');
  assert.match(refused.data.error, /no longer accepts the key of the Composio account botdot made earlier\. Paste your own Composio key on the Connectors page/);
  assert.deepEqual(refused.data.connections, []);
  assert.ok(!seen.requests.some((p) => p.startsWith('/api/')), 'nothing asked of Composio\'s agent sign-up');

  const good = await srv.api('/connectors/key', { method: 'PUT', body: { key: OWN_KEY_2 } });
  assert.equal(good.data.keyRejected, false);
  assert.equal(good.data.account, 'own');
  assert.equal(good.data.keyHint, '…ne_2');
  assert.ok(!('agent' in JSON.parse(file())), 'the old account\'s keys are dropped');
  const after = await srv.api('/connectors');
  assert.deepEqual(after.data.reconnect.map((a) => a.slug), ['github', 'gmail'], 'the apps of the old account are offered again');

  seen.accounts[OWN_KEY_2] = ['github'];
  assert.deepEqual((await srv.api('/connectors')).data.reconnect.map((a) => a.slug), ['gmail'], 'connected again, it leaves the list');
  await srv.api('/connectors/reconnect/gmail', { method: 'DELETE' });
  assert.deepEqual((await srv.api('/connectors')).data.reconnect, []);
});

test('your own key refused shows its end, and a new key fixes it', async () => {
  seen.dead.add(OWN_KEY_2);
  const r = await srv.api('/connectors');
  assert.equal(r.data.keyRejected, true);
  assert.equal(r.data.account, 'own');
  assert.match(r.data.error, /no longer accepts your Composio key …ne_2/);
  const cat = await srv.api('/connectors/catalog');
  assert.equal(cat.status, 409, 'no marketplace on a refused key, though Composio still lists it');
  assert.match(cat.data.error, /no longer accepts your Composio key/);
  assert.equal((await srv.api('/connectors')).data.keyRejected, true, 'a listed catalogue does not make the key work again');
  const good = await srv.api('/connectors/key', { method: 'PUT', body: { key: OWN_KEY } });
  assert.equal(good.data.keyRejected, false);
  assert.equal((await srv.api('/connectors')).data.keyRejected, false);
  assert.equal((await srv.api('/connectors/catalog')).status, 200);
});

test('a sign-in Composio refuses is answered in one plain sentence, for the Reconnect card and the Connectors page (#464)', async () => {
  await srv.api('/connectors/key', { method: 'PUT', body: { key: OWN_KEY } });
  srv.reply('GitHub is already connected once; remove the old connection in Connectors and try again.');
  const r = await srv.api('/connectors/connect', { method: 'POST', body: { app: 'github' } });
  assert.equal(r.status, 502);
  assert.equal(r.data.error, 'GitHub is already connected once; remove the old connection in Connectors and try again.');
  assert.equal(r.data.code, 'app-failed');
  // botdot's own sentence is said as it is.
  const own = await srv.api('/connectors/connect', { method: 'POST', body: { app: 'devapp' } });
  assert.equal(own.status, 400);
  assert.match(own.data.error, /^Dev App only signs in through your own developer app/);
});

test('a connection Composio lists without a status reads "UNKNOWN", and one without an app is left out (#464)', async () => {
  seen.odd = true;
  try {
    const r = await srv.api('/connectors');
    assert.deepEqual(r.data.connections.map((c) => [c.id, c.toolkit, c.status]), [['ca_notion', 'notion', 'UNKNOWN'], ['ca_gmail', 'gmail', 'ACTIVE']]);
  } finally { seen.odd = false; }
});
