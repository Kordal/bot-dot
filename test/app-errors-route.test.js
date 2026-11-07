// A connected app's own error reaches a bot in plain words (lib/app-errors.js): what went wrong, what helps and the
// app's words after them, with its kind as `code`; a connection that lacks a permission is the owner's Reconnect card
// (ADR 168); and an action runs with the app's newest working connection, so one made again (Reconnect) replaces one
// that lacks a permission. Through the real server, the bot's tools for connected apps (lib/connectors-mcp.js) and the
// stand-in connected app.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot, heldRun, fakeConnectedApp, connectorEnv } = require('./helpers');
const { rpcClient } = require('./memory-helpers');

const SCOPES = JSON.stringify({ error: { code: 403, message: 'Request had insufficient authentication scopes.', status: 'PERMISSION_DENIED', details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] } });

let app, srv;
before(async () => {
  app = await fakeConnectedApp({
    fails: { GMAIL_FETCH_EMAILS: SCOPES, GMAIL_READ: JSON.stringify({ error: { code: 400, message: 'Invalid label id.', status: 'INVALID_ARGUMENT' } }) },
    accounts: [
      { id: 'ca_old', toolkit: { slug: 'gmail' }, status: 'ACTIVE', created_at: '2026-10-01T08:00:00Z' },
      { id: 'ca_new', toolkit: { slug: 'gmail' }, status: 'ACTIVE', created_at: '2026-10-23T08:00:00Z' },
      { id: 'ca_gone', toolkit: { slug: 'gmail' }, status: 'EXPIRED', created_at: '2026-10-24T08:00:00Z' },
    ],
  });
  srv = await startServer({ env: app.env });
  await app.connect(srv);
});
after(async () => { await srv.stop(); app.close(); });

test("a connection without a permission it needs is the owner's Reconnect card; the newest connection is used", async (t) => {
  const bot = await makeBot(srv, { name: 'Mail Reader', emoji: '📨', connectors: ['gmail'] });
  const { token, rec } = await heldRun(srv, bot);
  t.after(() => srv.release(rec));
  const tools = rpcClient(t, 'connectors-mcp.js', connectorEnv(srv, token));
  const r = await tools.call('connector_run', { app: 'gmail', action: 'GMAIL_FETCH_EMAILS', arguments: {} });
  const text = r.content.map((c) => c.text).join('\n');
  assert.equal(text, "Error: Gmail isn't connected, so nothing was done. The owner now has a card to reconnect it; botdot starts you again on this work once it is connected. Say so in one line, stop the work that needs it and don't try it another way.");
  assert.deepEqual(app.executed.at(-1), { action: 'GMAIL_FETCH_EMAILS', args: {}, account: 'ca_new' });
  const card = (await srv.api('/asks?connect-app=1')).data.find((a) => a.kind === 'connect-app' && a.botId === bot.id);
  assert.deepEqual([card.app, card.mode, card.title], ['gmail', 'reconnect', 'Reconnect Gmail']);
});

test("any other failure of the app reaches the bot in plain words, what helps and the app's own words", async (t) => {
  const bot = await makeBot(srv, { name: 'Label Reader', emoji: '🏷️', connectors: ['gmail'] });
  const { token, rec } = await heldRun(srv, bot);
  t.after(() => srv.release(rec));
  const tools = rpcClient(t, 'connectors-mcp.js', connectorEnv(srv, token));
  const r = await tools.call('connector_run', { app: 'gmail', action: 'GMAIL_READ', arguments: {} });
  const text = r.content.map((c) => c.text).join('\n');
  assert.match(text, /^Error: [^\n]*The app said: \{"error"/);
  assert.match(text, /Invalid label id/, "the app's words stay for the bot");
  assert.ok(!(await srv.api('/asks?connect-app=1')).data.some((a) => a.botId === bot.id), 'no card');
});
