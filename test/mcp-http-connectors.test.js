// The tool servers that need a connected app, answered by botdot over HTTP (ADR 270, #1670): a bot's connectors server
// and the Chief's. The rest of the HTTP route is in mcp-http.test.js; this one needs the stand-in connected app
// started before the server.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { startServer, makeBot, waitFor, fakeConnectedApp } = require('./helpers');

let app, srv;
before(async () => {
  app = await fakeConnectedApp({ connected: ['gmail'] });
  srv = await startServer({ env: { ...app.env, BOT_DOT_MCP: 'http', BOT_DOT_MCP_KEEPALIVE_MS: '150' } });
  await app.connect(srv);
});
after(async () => { srv.unhold(); await srv.stop(); app.close(); fs.rmSync(srv.dir, { recursive: true, force: true }); });

// A held run of `bot`, with the tool servers of its MCP file (over HTTP they have no environment to read the token from).
async function heldRun(bot, prompt) {
  srv.hold();
  const run = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt } })).data;
  const rec = await srv.nextRun((x) => x.self && x.args.includes(`${bot.emoji} ${bot.name}`) && x.stdin.includes(prompt), `a run of ${bot.name}`);
  return { run, rec };
}

const call = async (entry, name, args = {}) => {
  const res = await fetch(entry.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', ...entry.headers }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }) });
  const data = (await res.text()).split('\n').find((l) => l.startsWith('data: '));
  return { status: res.status, ...JSON.parse(data.slice(6)) };
};
const said = (r) => r.result.content.map((c) => c.text).join('\n');

test("a bot's connectors server is an address and a token, and its call reaches the app with the run's own token", async () => {
  const bot = await makeBot(srv, { name: 'Mailer', emoji: '📮', connectors: ['gmail'] });
  const { rec, run } = await heldRun(bot, 'Read my mail');
  try {
    const e = rec.connectors;
    assert.deepEqual(Object.keys(e).sort(), ['headers', 'type', 'url']);
    assert.equal(e.url, `http://127.0.0.1:${srv.botdotPort}/api/mcp/connectors`);
    const before = app.executed.length;
    const r = await call(e, 'connector_run', { app: 'gmail', action: 'GMAIL_READ', arguments: { message_id: 'm1' } });
    assert.equal(r.result.isError, undefined, said(r));
    assert.equal(said(r), '{"done":true}');
    assert.deepEqual(app.executed.slice(before), [{ action: 'GMAIL_READ', args: { message_id: 'm1' } }]);
  } finally { srv.release(rec); await srv.finished(run.id); }
});

test("the Chief's turn has the connectors server over HTTP, and its call is the Chief's: no bot's grant, no bot's card", async () => {
  srv.hold();
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Read my mail please' } });
  const rec = await srv.nextRun((x) => x.botdot && x.args.includes('🧭 Chief of Staff') && x.stdin.includes('Read my mail please'), "the Chief's turn");
  try {
    assert.equal(rec.connectors.type, 'http');
    assert.equal(rec.connectors.url, `http://127.0.0.1:${srv.botdotPort}/api/mcp/connectors`);
    assert.ok(!JSON.stringify(rec.connectors).includes('CONNECTOR_CALLER'));
    const before = app.executed.length;
    const r = await call(rec.connectors, 'connector_run', { app: 'gmail', action: 'GMAIL_READ', arguments: {} });
    assert.equal(said(r), '{"done":true}', said(r));
    assert.equal(app.executed.length, before + 1);
    assert.deepEqual((await srv.api('/asks')).data, [], 'a reading action asks no one');
  } finally {
    srv.reply('Done.');
    srv.release(rec);
    await waitFor(async () => !(await srv.api(`/chief/chats/${chat.id}`)).data.busy, { what: 'the turn to end' });
  }
});
