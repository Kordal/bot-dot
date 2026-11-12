// A bot with an app of two or more accounts (ADR 221): its prompt lists every account by its address, its own marked
// and one that is signed out said so; connector_run names another by its address and goes through it; an unknown one
// is refused with the list; an app's failure says which account it went through; a write's card names its account;
// and a bot set to an account that stopped working moves to a connection made again for the same address.
// A stand-in for Composio's API.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { startServer, makeBot, heldRun, connectorEnv, waitFor } = require('./helpers');
const { rpcClient } = require('./memory-helpers');

const ADDRESS = { ca_home: 'bart@home.example', ca_work: 'bart@work.example', ca_work2: 'bart@work.example' };
const composio = { accounts: {}, executed: [], fail: null };
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const json = (code, d) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };
    const p = new URL(req.url, 'http://x').pathname;
    const b = body ? JSON.parse(body) : {};
    if (p === '/connected_accounts' && req.method === 'GET') return json(200, { items: Object.entries(composio.accounts).map(([id, a]) => ({ id, toolkit: { slug: 'gmail' }, status: a.status, created_at: a.created_at })) });
    if (p.startsWith('/connected_accounts/')) return json(200, { success: true });
    if (p.startsWith('/toolkits/')) return json(200, { slug: 'gmail', name: 'Gmail', composio_managed_auth_schemes: ['OAUTH2'] });
    if (p === '/tools/execute/GMAIL_GET_PROFILE') return json(200, { successful: true, data: { emailAddress: ADDRESS[b.connected_account_id] } });
    if (p.startsWith('/tools/execute/')) {
      composio.executed.push(b.connected_account_id);
      return json(200, composio.fail ? { successful: false, error: composio.fail } : { successful: true, data: { messages: [] } });
    }
    if (p === '/tools/GMAIL_SEND_EMAIL') return json(200, { slug: 'GMAIL_SEND_EMAIL', toolkit: { slug: 'gmail' }, no_auth: false, tags: [] });
    if (p.startsWith('/tools/')) { const slug = p.split('/').at(-1); return json(200, { slug, toolkit: { slug: 'gmail' }, no_auth: false, tags: ['readOnlyHint'] }); }
    if (p === '/toolkits') return json(200, { items: [], next_cursor: null });
    if (p === '/auth_configs') return json(200, { items: [{ id: 'ac_gmail', status: 'ENABLED' }] });
    return json(404, { message: 'Not here' });
  });
});

let srv;
let bot;
before(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  srv = await startServer({ env: { COMPOSIO_API_URL: `http://127.0.0.1:${fake.address().port}` } });
  assert.equal((await srv.api('/connectors/key', { method: 'PUT', body: { key: 'pk_test_key_1' } })).status, 200);
  composio.accounts.ca_home = { status: 'ACTIVE', created_at: '2026-10-01T08:00:00Z' };
  composio.accounts.ca_work = { status: 'ACTIVE', created_at: '2026-11-11T08:00:00Z' };
  bot = await makeBot(srv, { name: 'Mailer', emoji: '📬' });
  await srv.api('/connectors/apps/gmail/bots', { method: 'PUT', body: { account: 'ca_home', bots: [bot.id] } });
  // Both labels learnt from Gmail's own profile.
  await waitFor(async () => { const l = (await srv.api('/connectors')).data.connections; return l.every((c) => c.label?.includes('@')) || null; }, { what: 'the labels' });
});
after(async () => { srv.unhold(); await srv?.stop(); fake.close(); });

async function inRun(t, fn) {
  const { token, rec, run } = await heldRun(srv, bot);
  const tools = rpcClient(t, 'connectors-mcp.js', connectorEnv(srv, token));
  try { await fn(tools, rec); } finally { srv.release(rec); await srv.finished(run.id); srv.unhold(); }
}
const said = (r) => r.content[0].text;

test('the prompt lists every account; a named one is acted through; an unknown one is refused with the list', { timeout: 60_000 }, async (t) => {
  await inRun(t, async (tools, rec) => {
    assert.match(rec.system, /gmail \(accounts: bart@home\.example \(yours\); bart@work\.example\)/);
    assert.match(rec.system, /put its address \(as listed\) in connector_run's account/);
    await tools.call('connector_run', { app: 'gmail', action: 'GMAIL_FETCH_EMAILS', arguments: {} });
    assert.equal(composio.executed.at(-1), 'ca_home', 'its own without a name');
    await tools.call('connector_run', { app: 'gmail', action: 'GMAIL_FETCH_EMAILS', arguments: {}, account: 'Bart@Work.example' });
    assert.equal(composio.executed.at(-1), 'ca_work', 'the one it named');
    const r = await tools.call('connector_run', { app: 'gmail', action: 'GMAIL_FETCH_EMAILS', arguments: {}, account: 'nobody@example.com' });
    assert.equal(r.isError, true);
    assert.match(said(r), /no account "nobody@example\.com"\. Its accounts: bart@home\.example \(yours\), bart@work\.example\./);
  });
});

test("an app's failure says which account it went through; another mailbox in the arguments is said plainly", { timeout: 60_000 }, async (t) => {
  composio.fail = '{"error":{"code":403,"message":"Delegation denied for bart@work.example"}}';
  try {
    await inRun(t, async (tools) => {
      const r = await tools.call('connector_run', { app: 'gmail', action: 'GMAIL_FETCH_EMAILS', arguments: { user_id: 'bart@work.example' } });
      assert.equal(r.isError, true);
      assert.match(said(r), /can't act as another account/);
      assert.match(said(r), /went through Gmail bart@home\.example; its accounts: bart@home\.example \(yours\), bart@work\.example\. Name another in account/);
    });
  } finally { composio.fail = null; }
});

test("a write's card names the account it goes through", () => {
  const { proposalView } = require('../lib/asks');
  const a = { kind: 'connector-action', botId: 'b1', runId: 'r1', app: 'gmail', action: 'GMAIL_SEND_EMAIL', arguments: { to: 'x@example.com' } };
  assert.equal(proposalView({ ...a, account: 'bart@work.example' }, 'Mailer', { appName: () => 'Gmail' }).title, 'Send email with Gmail (bart@work.example)?');
  assert.equal(proposalView(a, 'Mailer', { appName: () => 'Gmail' }).title, 'Send email with Gmail?', 'one account: as before');
});

test('a bot set to an account that expired moves to the connection made again for the same address', { timeout: 60_000 }, async () => {
  await srv.api('/connectors/apps/gmail/bots', { method: 'PUT', body: { account: 'ca_work', bots: [bot.id] } });
  assert.deepEqual((await srv.api(`/bots/${bot.id}`)).data.accounts, { gmail: 'ca_work' });
  composio.accounts.ca_work.status = 'EXPIRED';
  composio.accounts.ca_work2 = { status: 'ACTIVE', created_at: '2026-11-12T08:00:00Z' };
  const moved = await waitFor(async () => {
    await srv.api('/connectors');
    const b = (await srv.api(`/bots/${bot.id}`)).data;
    return b.accounts?.gmail === 'ca_work2' ? b : null;
  }, { what: 'the bot on the connection made again' });
  assert.deepEqual(moved.connectors, ['gmail']);
});
