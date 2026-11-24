// A slow remote MCP server (ADR 265, #1636): the relay (lib/custom-mcp.js) gives up on one request to botdot at 120 s, and
// botdot answers each in its own words before that, one deadline over the listing of the tools and the call together
// (BOT_DOT_CUSTOM_RUN_MS here, 100 s as botdot runs). A call that was not sent says it is not done; one that was sent says
// the outcome is unknown and that it must not be tried again, so a write is never sent twice because the relay said "aborted".
// Through the real server, the relay and a slow stand-in remote server (test/fixtures/fake-mcp-remote.js).
process.env.BOT_DOT_RUNS_MAX = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { startServer, makeBot, heldRun, waitFor, fakeMcpRemote } = require('./helpers');
const { rpcClient } = require('./memory-helpers');

const KEY = 'tok-9f3a7c1d2b8e5a64';
const RUN_MS = 1500; // the deadline of a request; the stand-in's pauses are longer
const SLOW_MS = 4000;
const said = (result) => result.content.map((c) => c.text).join('\n');

let remote, srv, server;
before(async () => {
  remote = await fakeMcpRemote({ key: KEY });
  srv = await startServer({ env: { BOT_DOT_MCP_ALLOW_LOCAL: '1', BOT_DOT_CUSTOM_RUN_MS: String(RUN_MS) } });
  const r = await srv.api('/connectors/servers', { method: 'POST', body: { name: 'Notes', url: remote.url, key: KEY } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  server = r.data;
});
after(async () => {
  srv.unhold(); await srv.stop(); fs.rmSync(srv.dir, { recursive: true, force: true });
  remote.close();
});

// What the bot reads: botdot's words, never the relay's own "aborted" or "timeout".
const botdotsWords = (text) => assert.ok(!/abort|TimeoutError|The operation was/i.test(text), `not the relay's own words: ${text}`);
const timed = async (p) => { const t = Date.now(); const r = await p; return [r, Date.now() - t]; };

test('a slow server that is asked for its tools or a call it has not been sent answers "not done" in botdot\'s words, within the deadline', async (t) => {
  const bot = await makeBot(srv, { name: 'Patient reader', emoji: '🐢' });
  const { rec, run } = await heldRun(srv, bot);
  const relay = rpcClient(t, 'custom-mcp.js', rec.remote.env);
  remote.delay['tools/list'] = SLOW_MS;
  const before = remote.calls.length;

  // The listing (/custom-tools) is held to the same deadline: it was a read, so nothing is at stake, but the answer is botdot's.
  const [listed, listMs] = await timed(relay.call('remote_tools', { server: server.id }));
  assert.ok(listed.isError);
  assert.match(said(listed), /too slow to list its tools/);
  botdotsWords(said(listed));
  assert.ok(listMs < SLOW_MS, `answered at the deadline, not when the server did (${listMs} ms)`);

  // A call whose tool is not known yet needs the listing first: the deadline ends it before anything is sent.
  const [call, callMs] = await timed(relay.call('remote_call', { server: server.id, tool: 'search_notes', arguments: { query: 'milk' } }));
  assert.ok(call.isError);
  assert.match(said(call), /was too slow to answer, and nothing was sent to it for search_notes, so this was not done/);
  assert.ok(!/outcome is unknown/.test(said(call)));
  botdotsWords(said(call));
  assert.ok(callMs < SLOW_MS, `answered at the deadline (${callMs} ms)`);
  assert.equal(remote.calls.length, before, 'the call was never sent');

  remote.delay['tools/list'] = 0;
  srv.release(rec); await srv.finished(run.id);
});

test('a call that was sent and is slow answers "outcome unknown, do not call it again", for a read and for a write after Allow once', async (t) => {
  const bot = await makeBot(srv, { name: 'Writer', emoji: '✍️' });
  const { rec, run } = await heldRun(srv, bot);
  const relay = rpcClient(t, 'custom-mcp.js', rec.remote.env);
  const before = remote.calls.length;
  remote.delay.search_notes = SLOW_MS;
  remote.delay.create_note = SLOW_MS;

  const [read, readMs] = await timed(relay.call('remote_call', { server: server.id, tool: 'search_notes', arguments: { query: 'milk' } }));
  assert.ok(read.isError);
  assert.match(said(read), /had been sent/);
  assert.match(said(read), /The outcome is unknown\. Don't call it again/);
  botdotsWords(said(read));
  assert.ok(readMs < SLOW_MS, `answered at the deadline (${readMs} ms)`);

  // A write: the card, the owner's Allow once, then the call that goes through to a server that answers too late.
  const write = relay.call('remote_call', { server: server.id, tool: 'create_note', arguments: { title: 'Milk' } });
  const card = await waitFor(async () => (await srv.api('/asks')).data.find((a) => a.botId === bot.id && a.kind === 'connector-action'), { what: 'the card of the write' });
  assert.equal((await srv.api(`/asks/${card.id}`, { method: 'POST', body: { yes: true } })).status, 200);
  const done = await write;
  assert.ok(done.isError);
  assert.match(said(done), /The outcome is unknown\. Don't call it again and don't try it another way/);
  assert.match(said(done), /should check Notes/);
  botdotsWords(said(done));
  assert.deepEqual(remote.calls.slice(before).map((c) => c.name), ['search_notes', 'create_note'], 'each was sent once: nothing was sent a second time');

  remote.delay.search_notes = 0;
  remote.delay.create_note = 0;
  srv.release(rec); await srv.finished(run.id);
});

test('a server that answers within the deadline is used as before', async (t) => {
  const bot = await makeBot(srv, { name: 'Quick reader', emoji: '🐇' });
  const { rec, run } = await heldRun(srv, bot);
  const relay = rpcClient(t, 'custom-mcp.js', rec.remote.env);
  assert.equal(said(await relay.call('remote_call', { server: server.id, tool: 'search_notes', arguments: { query: 'milk' } })), 'search_notes done: {"query":"milk"}');
  assert.match(said(await relay.call('remote_tools', { server: server.id, search: 'note' })), /search_notes/);
  srv.release(rec); await srv.finished(run.id);
});
