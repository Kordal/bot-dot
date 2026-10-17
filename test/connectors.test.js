// Connectors set themselves up: the first visit makes botdot's own Composio account (the one
// `composio login --agent` makes), with stand-ins for Composio's agent sign-up and its API.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { startServer } = require('./helpers');

const AGENT_KEY = 'ak_test_agent_key_123';
const PROJECT_KEY = 'pk_test_project_key_456';
const OWN_KEY = 'pk_my_own_key_789';

// One stand-in for both agents.composio.dev and Composio's API.
const seen = { signups: 0, claims: [], keys: new Set() };
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', async () => {
    const json = (code, d) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };
    const url = new URL(req.url, 'http://x');
    if (req.method === 'POST' && url.pathname === '/api/signup') {
      seen.signups++;
      await new Promise((r) => setTimeout(r, 150)); // slow enough for two visits to overlap
      return json(200, { status: 'READY', slug: 'agent-x', email: 'agent-x@agents.composio.dev', agent_key: AGENT_KEY, composio_agent_key: AGENT_KEY, composio: { org_id: 'org_1', project_id: 'proj_1', member_id: 'm_1', api_key: PROJECT_KEY, user_api_key: 'uak_1' } });
    }
    if (req.method === 'POST' && url.pathname === '/api/claim') {
      if (req.headers.authorization !== `Bearer ${AGENT_KEY}`) return json(401, { message: 'Bad agent key' });
      const { email } = JSON.parse(body);
      seen.claims.push(email);
      return json(200, { status: 'invited', email, org_id: 'org_1' });
    }
    const key = req.headers['x-api-key'];
    if (![PROJECT_KEY, OWN_KEY].includes(key)) return json(401, { message: 'Bad key' });
    seen.keys.add(key);
    if (url.pathname === '/toolkits') return json(200, { items: [{ slug: 'gmail', name: 'Gmail', meta: { categories: [{ name: 'email' }] }, composio_managed_auth_schemes: ['OAUTH2'] }], next_cursor: null });
    if (url.pathname === '/connected_accounts') return json(200, { items: [] });
    return json(404, { message: 'Not here' });
  });
});

let srv;
before(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  const at = `http://127.0.0.1:${fake.address().port}`;
  srv = await startServer({ env: { COMPOSIO_AGENTS_URL: at, COMPOSIO_API_URL: at } });
});
after(async () => { await srv?.stop(); fake.close(); });

const file = () => fs.readFileSync(path.join(srv.data, 'connectors.json'), 'utf8');

test('a failed sign-up says so, and offers your own key', async () => {
  const other = await startServer(); // Composio can't be reached from this one
  try {
    const r = await other.api('/connectors');
    assert.equal(r.data.configured, false);
    assert.match(r.data.error, /couldn't set up Composio/);
  } finally { await other.stop(); }
});

test('the first visit makes botdot\'s own Composio account, once', async () => {
  const before = seen.signups;
  const [a, b] = await Promise.all([srv.api('/connectors'), srv.api('/connectors')]);
  assert.equal(seen.signups - before, 1, 'two visits at once make one account');
  for (const r of [a, b]) {
    assert.equal(r.data.configured, true);
    assert.equal(r.data.account, 'botdot');
    assert.equal(r.data.keyHint, null);
  }
  assert.ok(seen.keys.has(PROJECT_KEY), 'uses the new account\'s project key');
  const saved = file();
  assert.ok(!saved.includes(PROJECT_KEY) && !saved.includes(AGENT_KEY), 'keys are stored encrypted');

  const cat = await srv.api('/connectors/catalog');
  assert.equal(cat.data.items[0].slug, 'gmail');
  await srv.api('/connectors');
  assert.equal(seen.signups - before, 1, 'later visits reuse it');
});

test('claiming sends an invite with the account\'s own agent key', async () => {
  const bad = await srv.api('/connectors/claim', { method: 'POST', body: { email: 'nope' } });
  assert.notEqual(bad.status, 200);
  const r = await srv.api('/connectors/claim', { method: 'POST', body: { email: 'me@example.com' } });
  assert.equal(r.status, 200);
  assert.deepEqual(seen.claims, ['me@example.com']);
  assert.equal(r.data.claimInvite, 'me@example.com');
});

test('your own key replaces it, and removing yours goes back to botdot\'s account', async () => {
  const before = seen.signups;
  const own = await srv.api('/connectors/key', { method: 'PUT', body: { key: OWN_KEY } });
  assert.equal(own.data.account, 'own');
  assert.equal(own.data.keyHint, '…_789');
  assert.ok(seen.keys.has(OWN_KEY));

  await srv.api('/connectors/key', { method: 'DELETE' });
  const back = await srv.api('/connectors');
  assert.equal(back.data.configured, true);
  assert.equal(back.data.account, 'botdot');
  assert.equal(seen.signups, before, 'no new account');
});
