// A run's tool servers answered by botdot itself over MCP's Streamable HTTP (ADR 267, #1670): what the run's MCP file
// holds, what the route answers (initialize, tools/list, a tools/call as a stream with keep-alive comments), who it lets
// in, that the Chief's key never reaches the file, and that BOT_DOT_MCP=stdio brings the processes back. Through the real
// server and the stand-in Claude; the end-to-end check with the real Claude Code is in the ADR.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, waitFor } = require('./helpers');

let srv, stdio, bot, other, stdioBot;
before(async () => {
  [srv, stdio] = await Promise.all([
    startServer({ env: { BOT_DOT_MCP: 'http', BOT_DOT_MCP_KEEPALIVE_MS: '150', BOT_DOT_LOOK_ON_DEMAND: '1' } }),
    startServer({ env: { BOT_DOT_MCP: 'stdio' } }),
  ]);
  bot = await makeBot(srv, { name: 'Alpha Bot', emoji: '🅰️' });
  other = await makeBot(srv, { name: 'Beta Bot', emoji: '🅱️' });
  stdioBot = await makeBot(stdio, { name: 'Alpha Bot', emoji: '🅰️' });
  await makeBot(stdio, { name: 'Beta Bot', emoji: '🅱️' }); // the same team as the other server's: the tools follow it
});
after(async () => {
  for (const s of [srv, stdio]) { s.unhold(); await s.stop(); fs.rmSync(s.dir, { recursive: true, force: true }); }
});

// A held run of `b` on `on`, with the tool servers of its MCP file: { run, rec, end() }.
async function heldRun(on, b, prompt) {
  on.hold();
  const run = (await on.api(`/bots/${b.id}/run`, { method: 'POST', body: { prompt } })).data;
  const rec = await on.nextRun((x) => x.self && x.args.includes(`${b.emoji} ${b.name}`) && x.stdin.includes(prompt), `a run of ${b.name}`);
  let ended = false;
  const end = async () => { if (ended) return; ended = true; on.release(rec); await on.finished(run.id); };
  return { run, rec, end };
}

// One tool server as Claude Code calls it: the entry of the MCP file, with its url and headers.
function client(entry) {
  let serial = 0;
  const post = (body, { accept = 'application/json, text/event-stream', headers } = {}) => fetch(entry.url, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: accept, ...(headers || entry.headers) }, body: JSON.stringify(body) });
  const message = (method, params) => ({ jsonrpc: '2.0', id: ++serial, method, params });
  return {
    post,
    // initialize, tools/list…: one JSON answer.
    async rpc(method, params) { const res = await post(message(method, params)); return { status: res.status, type: res.headers.get('content-type'), body: await res.json() }; },
    // tools/call: the stream's text, and its events' data.
    async call(name, args = {}, options) {
      const res = await post(message('tools/call', { name, arguments: args }), options);
      const text = await res.text();
      return { status: res.status, type: res.headers.get('content-type'), text, events: events(text) };
    },
    // tools/call, with the stream as it comes: for a call that is not over yet.
    async open(name, args = {}, meta) {
      const res = await post(message('tools/call', { name, arguments: args, ...(meta ? { _meta: meta } : {}) }));
      return { status: res.status, type: res.headers.get('content-type'), reader: res.body.getReader() };
    },
  };
}
const events = (text) => text.split('\n\n').map((b) => b.split('\n').find((l) => l.startsWith('data: '))).filter(Boolean).map((l) => JSON.parse(l.slice(6)));
const names = (list) => list.body.result.tools.map((t) => t.name);
const said = (r) => r.result.content.map((c) => c.text).join('\n');

test("a run's MCP file names botdot's own address and a token for each server, and starts no process", async () => {
  const a = await heldRun(srv, bot, 'First run');
  try {
    for (const name of ['self', 'vault', 'computer']) {
      const e = a.rec[name];
      assert.equal(e.type, 'http', name);
      assert.equal(e.url, `http://127.0.0.1:${srv.botdotPort}/api/mcp/${name}`);
      assert.deepEqual(Object.keys(e).sort(), ['headers', 'type', 'url'], 'no command, no environment');
      assert.match(e.headers.Authorization, /^Bearer [0-9a-f]{48}$/);
      assert.equal(e.headers['X-Bot-Dot'], '1');
    }
    assert.notEqual(a.rec.self.headers.Authorization, a.rec.vault.headers.Authorization, 'a token for each server');
    assert.ok(!a.rec.connectors && !a.rec.remote, 'a bot with no connected app and no remote server of the owner\'s has neither');
    for (const word of ['RUN_TOKEN', 'VAULT_TOKEN', 'SELF_URL', 'SELF_MEMORY', 'COMPUTER_CONTAINER', 'command', 'self-mcp.js']) assert.ok(!a.rec.mcpText.includes(word), `${word} is not in the file`);
    // Every run has tokens of its own.
    const b = await heldRun(srv, other, 'Second run');
    try { assert.notEqual(b.rec.self.headers.Authorization, a.rec.self.headers.Authorization); } finally { await b.end(); }
  } finally { await a.end(); }
});

test('initialize, ping and tools/list answer as JSON; a notification is accepted; a GET is refused', async () => {
  const a = await heldRun(srv, bot, 'Protocol run');
  try {
    const self = client(a.rec.self);
    const init = await self.rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '1' } });
    assert.equal(init.status, 200);
    assert.match(init.type, /^application\/json/);
    assert.deepEqual([init.body.jsonrpc, init.body.id, init.body.result.protocolVersion, init.body.result.serverInfo.name], ['2.0', 1, '2025-06-18', 'self']);
    assert.deepEqual((await self.rpc('ping')).body.result, {});
    const listed = await self.rpc('tools/list');
    assert.match(listed.type, /^application\/json/);
    assert.ok(names(listed).includes('recall') && names(listed).includes('list_jobs'));
    assert.ok(!names(listed).includes('set_tile'), 'a bot with no tile has no tile tool: the flags are the run\'s');
    assert.deepEqual(names(await client(a.rec.vault).rpc('tools/list')).slice(0, 2), ['list_logins', 'api_request']);
    const note = await self.post({ jsonrpc: '2.0', method: 'notifications/initialized' });
    assert.equal(note.status, 202);
    assert.equal(await note.text(), '');
    const unknown = await self.rpc('nonsense');
    assert.equal(unknown.body.error.code, -32601);
    const get = await fetch(a.rec.self.url, { headers: { ...a.rec.self.headers, Accept: 'text/event-stream' } });
    assert.equal(get.status, 405);
    assert.equal(get.headers.get('allow'), 'POST');
    assert.equal((await fetch(a.rec.self.url, { method: 'DELETE', headers: a.rec.self.headers })).status, 405);
    const bad = await fetch(a.rec.self.url, { method: 'POST', headers: { ...a.rec.self.headers, 'Content-Type': 'application/json' }, body: '{nope' });
    assert.equal(bad.status, 400);
  } finally { await a.end(); }
});

test('the tools are the ones the stdio process offers for the same run: the flags come from botdot', async (t) => {
  const [a, s] = await Promise.all([heldRun(srv, bot, 'Same run'), heldRun(stdio, stdioBot, 'Same run')]);
  try {
    const { rpcClient } = require('./memory-helpers');
    for (const [name, script] of [['self', 'self-mcp.js'], ['vault', 'vault-mcp.js']]) {
      const process_ = rpcClient(t, script, s.rec[name].env);
      const there = (await process_.request('tools/list')).tools;
      const here = (await client(a.rec[name]).rpc('tools/list')).body.result.tools;
      assert.deepEqual(here, there, `${name}: the same list, descriptions and schemas`);
    }
  } finally { await Promise.all([a.end(), s.end()]); }
});

test('what a tool server reads from its environment is what it is made with: the flags choose its tools, and its state is its own', async () => {
  const list = async (file, env) => (await require(`../lib/${file}`).create(env).handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).result.tools.map((t) => t.name);
  const plain = await list('self-mcp', { SELF_URL: 'http://x', RUN_TOKEN: 't' });
  const withTiles = await list('self-mcp', { SELF_URL: 'http://x', RUN_TOKEN: 't', SELF_TILES: '1' });
  assert.ok(withTiles.length > plain.length && withTiles.includes('set_tile') && !plain.includes('set_tile'));
  assert.deepEqual(await list('vault-mcp', { VAULT_REPLAY: '1' }), ['list_logins', 'api_request'], 'a replay reads only');
  assert.ok((await list('computer-mcp', {})).includes('place_secret_file'));
  assert.ok(!(await list('computer-mcp', { COMPUTER_KIND: 'boat' })).includes('place_secret_file'), 'not on a boat.dev machine');
  const connectors = require('../lib/connectors-mcp');
  const description = async (env) => (await connectors.create(env).handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).result.tools.find((t) => t.name === 'connector_run').description;
  assert.match(await description({ CONNECTOR_APPS: 'gmail,slack' }), /waits for the owner's OK/);
  assert.match(await description({ CONNECTOR_APPS: 'gmail', CONNECTOR_CALLER: 'look' }), /refuses every action that sends/, 'a look reads only');
  // Two runs' servers made side by side do not share what they remember.
  const one = connectors.create({ CONNECTOR_APPS: 'gmail' });
  const two = connectors.create({ CONNECTOR_APPS: 'slack' });
  const app = async (s) => (await s.handle({ jsonrpc: '2.0', id: 1, method: 'tools/list' })).result.tools[0].inputSchema.properties.app.enum;
  assert.deepEqual([await app(one), await app(two)], [['gmail'], ['slack']]);
});

test("a tools/call answers as a stream, at once, and ends with the tool's result; a client that does not take one gets JSON", async () => {
  const a = await heldRun(srv, bot, 'Call run');
  try {
    const job = (await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Alpha job', kind: 'ai', cron: '0 4 1 1 *', prompt: 'Alpha work.' } })).data;
    const self = client(a.rec.self);
    const r = await self.call('list_jobs');
    assert.equal(r.status, 200);
    assert.match(r.type, /^text\/event-stream/);
    assert.equal(r.events.length, 1);
    assert.match(r.text, /\nevent: message\ndata: /);
    assert.equal(r.events[0].id, 1);
    assert.ok(!r.events[0].result.isError, said(r.events[0]));
    assert.match(said(r.events[0]), /Alpha job/);
    // The headers are out before the tool has answered: a call that takes a while is read as it goes.
    const plain = await self.call('list_jobs', {}, { accept: 'application/json' });
    assert.match(plain.type, /^application\/json/);
    assert.match(said(JSON.parse(plain.text)), new RegExp(job.id));
    // A tool's own failure is its result, not an error of the protocol.
    const failed = await self.call('remove_job', { id: 'nope' });
    assert.equal(failed.status, 200);
    assert.equal(failed.events[0].result.isError, true);
    const missing = await self.call('no_such_tool');
    assert.equal(missing.events[0].error.code, -32602);
  } finally { await a.end(); }
});

test('a tool that takes long sends keep-alive comments until it answers, and a client that goes away ends nothing else', async () => {
  const a = await heldRun(srv, bot, 'Slow run');
  try {
    const vault = client(a.rec.vault);
    // request_login waits for the owner's answer, as long as they take.
    const slow = await vault.open('request_login', { site: 'slow.example.com', reason: 'To check the stream.' });
    assert.equal(slow.status, 200);
    assert.match(slow.type, /^text\/event-stream/, 'the headers came before the answer');
    const request = await waitFor(async () => (await srv.api('/vault/requests')).data.find((x) => x.site === 'slow.example.com'), { what: 'the login request' });
    const decoder = new TextDecoder();
    let seen = '';
    const read = async (until) => {
      while (!until(seen)) {
        const { value, done } = await slow.reader.read();
        if (done) break;
        seen += decoder.decode(value);
      }
    };
    await read((s) => (s.match(/: keep-alive/g) || []).length >= 2);
    assert.ok((seen.match(/: keep-alive/g) || []).length >= 2, `keep-alive comments came while it waited: ${JSON.stringify(seen)}`);
    assert.ok(!seen.includes('event: message'), 'and no answer yet: a call that gave no progress token gets comments only');
    await srv.api(`/vault/requests/${request.id}`, { method: 'POST', body: { action: 'decline' } });
    await read((s) => s.includes('event: message'));
    const answer = events(seen)[0];
    assert.match(said(answer), /declined/);
    // A client that closes its connection mid-call: botdot is still serving, and the run's other tools still answer.
    const gone = await vault.open('request_login', { site: 'gone.example.com', reason: 'To close the stream.' });
    await waitFor(async () => (await srv.api('/vault/requests')).data.find((x) => x.site === 'gone.example.com'), { what: 'the second request' });
    await gone.reader.cancel();
    assert.equal((await client(a.rec.self).rpc('ping')).status, 200);
    for (const r of (await srv.api('/vault/requests')).data) await srv.api(`/vault/requests/${r.id}`, { method: 'POST', body: { action: 'decline' } });
  } finally { await a.end(); }
});

test("a call that gives a progress token gets progress notifications while it waits: Claude Code gives up on a call with no response or progress for 300 s", async () => {
  const a = await heldRun(srv, bot, 'Progress run');
  try {
    const slow = await client(a.rec.vault).open('request_login', { site: 'progress.example.com', reason: 'To see progress.' }, { progressToken: 7 });
    const request = await waitFor(async () => (await srv.api('/vault/requests')).data.find((x) => x.site === 'progress.example.com'), { what: 'the login request' });
    const decoder = new TextDecoder();
    let seen = '';
    const read = async (until) => { while (!until(seen)) { const { value, done } = await slow.reader.read(); if (done) break; seen += decoder.decode(value); } };
    await read((s) => events(s).filter((e) => e.method === 'notifications/progress').length >= 2);
    const progress = events(seen).filter((e) => e.method === 'notifications/progress');
    assert.ok(progress.length >= 2, `progress came while it waited: ${JSON.stringify(seen)}`);
    assert.deepEqual(progress.slice(0, 2).map((e) => [e.jsonrpc, e.params.progressToken, e.params.progress]), [['2.0', 7, 1], ['2.0', 7, 2]], "the call's own token, rising");
    assert.ok(!progress[0].id, 'a notification, not a response');
    await srv.api(`/vault/requests/${request.id}`, { method: 'POST', body: { action: 'decline' } });
    await read((s) => events(s).some((e) => e.id !== undefined));
    const last = events(seen).at(-1);
    assert.equal(last.id, 1, 'the result follows the progress, on the same stream');
    assert.match(said(last), /declined/);
  } finally { await a.end(); }
});

test("a token of another run, another server, or a run that ended is refused with 401, and one run's tools are its own", async () => {
  const a = await heldRun(srv, bot, 'Mine');
  const b = await heldRun(srv, other, 'Theirs');
  try {
    await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Alpha job', kind: 'ai', cron: '0 4 1 1 *', prompt: 'Alpha work.' } });
    await srv.api(`/bots/${other.id}/jobs`, { method: 'POST', body: { name: 'Beta job', kind: 'ai', cron: '0 5 1 1 *', prompt: 'Beta work.' } });
    const jobsOf = async (r) => said((await client(r.rec.self).call('list_jobs')).events[0]);
    const mine = await jobsOf(a);
    const theirs = await jobsOf(b);
    assert.ok(mine.includes('Alpha job') && !mine.includes('Beta job'), 'its own bot, whatever the other run asks');
    assert.ok(theirs.includes('Beta job') && !theirs.includes('Alpha job'));

    const attempt = (url, token) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bot-Dot': '1', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) });
    const token = (r, name) => r.rec[name].headers.Authorization.slice(7);
    const url = (name) => `${a.rec.self.url.replace(/self$/, name)}`;
    assert.equal((await attempt(url('self'), null)).status, 401, 'no token');
    assert.equal((await attempt(url('self'), 'f'.repeat(48))).status, 401, 'an unknown token');
    assert.equal((await attempt(url('self'), `${token(a, 'self').slice(0, -1)}${token(a, 'self').endsWith('0') ? '1' : '0'}`)).status, 401, 'a token that is nearly one');
    assert.equal((await attempt(url('vault'), token(a, 'self'))).status, 401, "a server's token is for that server");
    assert.equal((await attempt(url('self'), token(a, 'vault'))).status, 401);
    assert.equal((await attempt(url('self'), token(a, 'self'))).status, 200, 'its own');
    assert.equal((await attempt(url('nothing'), token(a, 'self'))).status, 404, 'no such server');
    await a.end();
    await waitFor(async () => (await attempt(url('self'), token(a, 'self'))).status === 401, { what: "the run's token to stop working" });
    assert.equal((await attempt(url('vault'), token(a, 'vault'))).status, 401, 'none of its servers answers any more');
    assert.equal((await attempt(b.rec.self.url, token(b, 'self'))).status, 200, "the other run's tools go on");
  } finally { await a.end(); await b.end(); }
});

test("the Chief's turn reaches botdot's tools by a token, and its key is in no file", async () => {
  srv.hold();
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'List my bots please' } });
  const rec = await srv.nextRun((x) => x.botdot && x.args.includes('🧭 Chief of Staff') && x.stdin.includes('List my bots please'), "the Chief's turn");
  try {
    const e = rec.botdot;
    assert.deepEqual(Object.keys(e).sort(), ['headers', 'type', 'url']);
    assert.equal(e.url, `http://127.0.0.1:${srv.botdotPort}/api/mcp/botdot`);
    assert.ok(!JSON.stringify([rec.mcpText, rec.args, rec.system, rec.stdin, rec.botdot]).includes(srv.chiefKey), "the Chief's key is in no file, argument or prompt it was given");
    assert.ok(!rec.mcpText.includes('BOT_DOT_CHIEF_KEY'));
    const tools = client(e);
    const listed = await tools.rpc('tools/list');
    assert.ok(names(listed).includes('list_bots') && names(listed).includes('create_bot'));
    const r = await tools.call('list_bots');
    const bots = JSON.parse(said(r.events[0]));
    assert.deepEqual(bots.map((b) => b.name).sort(), ['Alpha Bot', 'Beta Bot'], 'the call reached botdot with the Chief\'s key, kept here');
    assert.equal((await tools.call('stop_run', { runId: 5 })).events[0].result.isError, true, 'arguments are checked against the schema');
  } finally {
    srv.reply('Done.');
    srv.release(rec);
    await waitFor(async () => !(await srv.api(`/chief/chats/${chat.id}`)).data.busy, { what: 'the turn to end' });
  }
  const res = await fetch(rec.botdot.url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...rec.botdot.headers }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) });
  assert.equal(res.status, 401, 'the turn is over: so is its token');
});

test("a look's tools are the reading ones only, with the same token and no key", async () => {
  srv.hold();
  const started = srv.api('/chief/checkup/now', { method: 'POST' });
  const rec = await srv.nextRun((x) => x.botdot && x.args.includes('🧭 Chief of Staff · checkup'), 'the checkup');
  try {
    assert.equal(rec.botdot.type, 'http');
    assert.ok(!JSON.stringify([rec.mcpText, rec.args, rec.system, rec.stdin, rec.botdot]).includes(srv.chiefKey));
    const listed = names(await client(rec.botdot).rpc('tools/list'));
    assert.ok(listed.includes('list_bots') && listed.includes('recall'));
    assert.ok(!listed.includes('create_bot') && !listed.includes('stop_run'), 'it only reads');
  } finally { srv.release(rec); srv.reply('NOTHING'); await started; }
  assert.equal((await fetch(rec.botdot.url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...rec.botdot.headers }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) })).status, 401);
});

test('BOT_DOT_MCP=stdio brings the processes back: the file names a command and its environment, and the routes answer 401', async () => {
  const s = await heldRun(stdio, stdioBot, 'Stdio run');
  try {
    for (const [name, script] of [['self', 'self-mcp.js'], ['vault', 'vault-mcp.js']]) {
      const e = s.rec[name];
      assert.equal(e.type, undefined);
      assert.equal(e.command, process.execPath);
      assert.equal(path.basename(e.args[0]), script);
      assert.match(e.env.RUN_TOKEN || e.env.VAULT_TOKEN, /^[0-9a-f]{48}$/);
    }
    const res = await fetch(`${stdio.base.replace(/:\d+$/, '')}:${stdio.botdotPort}/api/mcp/self`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bot-Dot': '1', Authorization: `Bearer ${s.rec.self.env.RUN_TOKEN}` }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }) });
    assert.equal(res.status, 401, "a run's token is no key to the route when the processes serve");
  } finally { await s.end(); }
});
