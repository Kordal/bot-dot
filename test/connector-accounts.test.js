// Two accounts of one app (ADR 174): the Chief offers a card for another account of an app that is connected; its
// Connect keeps every bot on the account it uses now; once the new one is ACTIVE, the card's bot uses it. Connectors
// lists each account with its label and the bots that act through it, sets a label, and gives an account's bots. A
// bot's actions go through its own account. A stand-in for Composio's API.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { startServer, makeBot, heldRun, connectorEnv, waitFor } = require('./helpers');
const { rpcClient } = require('./memory-helpers');

// accounts: { id: { app, status, created_at, alias } }; executed: the connection each action went through.
const composio = { accounts: {}, executed: [], links: 0, aliases: {} };
const fake = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const json = (code, d) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(d)); };
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    const b = body ? JSON.parse(body) : {};
    if (p === '/connected_accounts' && req.method === 'GET') return json(200, { items: Object.entries(composio.accounts).map(([id, a]) => ({ id, user_id: a.user, toolkit: { slug: a.app }, status: a.status, created_at: a.created_at, alias: composio.aliases[id] || null })) });
    if (p.startsWith('/toolkits/')) { const slug = p.split('/').at(-1); return json(200, { slug, name: slug === 'gmail' ? 'Gmail' : slug, composio_managed_auth_schemes: ['OAUTH2'] }); }
    if (p === '/auth_configs') return json(200, { items: [{ id: `ac_${url.searchParams.get('toolkit_slug')}`, status: 'ENABLED' }] });
    if (p === '/connected_accounts/link') {
      const id = `ca_new_${++composio.links}`;
      composio.accounts[id] = { app: b.auth_config_id.slice(3), status: 'INITIATED', user: b.user_id, created_at: new Date(Date.now() + 1000).toISOString() };
      return json(200, { redirect_url: 'https://connect.example/x', connected_account_id: id, expires_at: new Date(Date.now() + 600e3).toISOString() });
    }
    if (p.startsWith('/connected_accounts/')) {
      const id = p.split('/').at(-1);
      const a = composio.accounts[id];
      if (!a) return json(404, { message: 'Not here' });
      if (req.method === 'PATCH') { composio.aliases[id] = b.alias; return json(200, { success: true, id }); }
      return json(200, { id, user_id: a.user, toolkit: { slug: a.app }, status: a.status });
    }
    if (p === '/tools/execute/GMAIL_GET_PROFILE') {
      const who = { ca_old: 'old@example.com', ca_new_1: 'new@example.com' }[b.connected_account_id];
      return json(200, who ? { successful: true, data: { emailAddress: who } } : { successful: false, error: 'no' });
    }
    if (p.startsWith('/tools/execute/')) { composio.executed.push(b.connected_account_id); return json(200, { successful: true, data: { messages: [] } }); }
    if (p.startsWith('/tools/')) { const slug = p.split('/').at(-1); return json(200, { slug, toolkit: { slug: slug.split('_')[0].toLowerCase() }, no_auth: false, tags: ['readOnlyHint'] }); }
    if (p === '/toolkits') return json(200, { items: [], next_cursor: null });
    return json(404, { message: 'Not here' });
  });
});

let srv;
before(async () => {
  await new Promise((r) => fake.listen(0, '127.0.0.1', r));
  srv = await startServer({ env: { COMPOSIO_API_URL: `http://127.0.0.1:${fake.address().port}` } });
  const r = await srv.api('/connectors/key', { method: 'PUT', body: { key: 'pk_test_key_1' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  composio.accounts.ca_old = { app: 'gmail', status: 'ACTIVE', user: null, created_at: '2026-10-01T08:00:00Z' };
});
after(async () => { srv.unhold(); await srv?.stop(); fake.close(); });

const gmail = async () => (await srv.api('/connectors')).data.connections.filter((c) => c.toolkit === 'gmail');

test('another account: its card keeps the bots on the account they use, and the new one is the card\'s bot\'s', { timeout: 60_000 }, async (t) => {
  const reader = await makeBot(srv, { name: 'Reader', emoji: '📖' });
  await srv.api('/connectors/apps/gmail/bots', { method: 'PUT', body: { bots: [reader.id] } });
  const writer = await makeBot(srv, { name: 'Writer', emoji: '✍️' });

  // Without another, an app that works draws no card.
  const plain = await srv.asChief('/asks', { method: 'POST', body: { kind: 'connect-app', app: 'gmail', bot: writer.id, reason: 'Its new inbox.' } });
  assert.equal(plain.status, 409);
  const made = await srv.asChief('/asks', { method: 'POST', body: { kind: 'connect-app', app: 'gmail', bot: writer.id, reason: 'Its new inbox.', another: true } });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  assert.deepEqual([made.data.mode, made.data.title, made.data.act], ['another', 'Connect another Gmail account for Writer', { verb: 'connect', label: 'Connect' }]);

  // The old account works: the card waits for one made for it.
  await srv.api('/connectors');
  assert.ok((await srv.api('/asks?connect-app=1')).data.some((a) => a.id === made.data.id), 'not settled by the account there');

  const c = await srv.api(`/asks/${made.data.id}/connect`, { method: 'POST', body: {} });
  assert.equal(c.status, 200, JSON.stringify(c.data));
  assert.deepEqual((await srv.api(`/bots/${reader.id}`)).data.accounts, { gmail: 'ca_old' }, 'Reader keeps the account it used');

  composio.accounts[c.data.connectionId].status = 'ACTIVE';
  const done = await srv.api(`/asks/${made.data.id}/connect`);
  assert.equal(done.data.settled, true);
  const w = (await srv.api(`/bots/${writer.id}`)).data;
  assert.deepEqual([w.connectors, w.accounts], [['gmail'], { gmail: c.data.connectionId }]);
  assert.deepEqual((await srv.api(`/bots/${reader.id}`)).data.accounts, { gmail: 'ca_old' });

  // Each account with its label (learnt from Gmail's own profile) and the bots that act through it.
  const list = await waitFor(async () => { const l = await gmail(); return l.every((x) => x.label?.includes('@')) ? l : null; }, { what: 'the labels' });
  assert.deepEqual(list.map((x) => [x.id, x.label, x.accounts, x.usedBy]).sort(), [['ca_new_1', 'new@example.com', 2, [writer.id]], ['ca_old', 'old@example.com', 2, [reader.id]]]);
  assert.equal(composio.aliases.ca_old, 'old@example.com', 'kept in Composio as its alias');

  // A run of each bot acts through its own account.
  for (const [bot, id] of [[reader, 'ca_old'], [writer, 'ca_new_1']]) {
    const { token, rec, run } = await heldRun(srv, bot);
    if (bot === writer) assert.match(rec.system, /Connected apps you can use: gmail \(accounts: old@example\.com; new@example\.com \(yours\)\)/);
    // Any service botdot connects is asked for before the owner gets steps by hand (ADR 223).
    assert.match(rec.system, /Before you give the owner steps to do by hand in one, or ask them to copy something out of it, ask for it with ask_chief_for_app/);
    const tools = rpcClient(t, 'connectors-mcp.js', connectorEnv(srv, token));
    await tools.call('connector_run', { app: 'gmail', action: 'GMAIL_FETCH_EMAILS', arguments: {} });
    assert.equal(composio.executed.at(-1), id);
    srv.release(rec);
    await srv.finished(run.id);
    srv.unhold();
  }
});

test("an account's label and bots are set on Connectors; removing an account takes it from the bots set to it", async () => {
  const set = await srv.api('/connectors/connections/ca_new_1', { method: 'PUT', body: { label: 'Work' } });
  assert.deepEqual(set.data, { ok: true, label: 'Work' });
  assert.equal((await gmail()).find((x) => x.id === 'ca_new_1').label, 'Work');

  const [reader] = (await srv.api('/bots')).data.filter((b) => b.name === 'Reader');
  const [writer] = (await srv.api('/bots')).data.filter((b) => b.name === 'Writer');
  // Reader moves to Work; the old account has no bot left.
  const moved = await srv.api('/connectors/apps/gmail/bots', { method: 'PUT', body: { account: 'ca_new_1', bots: [writer.id, reader.id] } });
  assert.deepEqual(moved.data.usedBy.sort(), [reader.id, writer.id].sort());
  assert.deepEqual((await srv.api(`/bots/${reader.id}`)).data.accounts, { gmail: 'ca_new_1' });
  assert.deepEqual((await gmail()).find((x) => x.id === 'ca_old').usedBy, []);
  assert.equal((await srv.api('/connectors/apps/gmail/bots', { method: 'PUT', body: { account: 'ca_nope', bots: [] } })).status, 404);

  // Writer leaves Work: it loses Gmail.
  await srv.api('/connectors/apps/gmail/bots', { method: 'PUT', body: { account: 'ca_new_1', bots: [reader.id] } });
  assert.deepEqual((await srv.api(`/bots/${writer.id}`)).data.connectors, []);

  // Work removed: Reader, set to it, loses Gmail although the old account is still there.
  const gone = await srv.api('/connectors/connections/ca_new_1', { method: 'DELETE' });
  assert.equal(gone.status, 200);
  const r = (await srv.api(`/bots/${reader.id}`)).data;
  assert.deepEqual([r.connectors, r.accounts], [[], {}]);
});

test("the Chief's change of a bot's account waits for the owner, as a new app does", () => {
  const { pendingChanges, waitingWords } = require('../lib/bot-changes');
  const before = { prompt: '', systemPrompt: '', allowedTools: [], computer: 'none', connectors: ['gmail'], accounts: { gmail: 'ca_a' } };
  const moved = pendingChanges(before, { ...before, accounts: { gmail: 'ca_b' } });
  assert.deepEqual([moved.changes.accounts, moved.safe.accounts], [{ gmail: 'ca_b' }, { gmail: 'ca_a' }]);
  assert.deepEqual(waitingWords(moved.changes, moved.safe, () => 'Gmail'), ['another Gmail account']);
  // A new app with its account: both wait, together.
  const fresh = pendingChanges({ ...before, connectors: [], accounts: {} }, { ...before, connectors: ['gmail'], accounts: { gmail: 'ca_b' } });
  assert.deepEqual([fresh.changes.connectors, fresh.changes.accounts, fresh.safe.connectors, fresh.safe.accounts], [['gmail'], { gmail: 'ca_b' }, [], {}]);
  assert.deepEqual(waitingWords(fresh.changes, fresh.safe, () => 'Gmail'), ['Gmail']);
  // Its account dropped, or unchanged: nothing waits.
  assert.deepEqual(pendingChanges(before, { ...before, accounts: {} }).changes, {});
});
