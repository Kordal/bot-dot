// The owner's own remote MCP servers (ADR 265, #1636): the address is judged (https, no key in it, no machine's or
// network's own address), botdot is the MCP client, a bot's run, the Chief's turn and a replay reach a server only
// through the stdio relay (lib/custom-mcp.js), a tool that only reads goes at once and any other waits for the owner's
// card, and the key is in no file, environment, argument, log, chat or answer. Through the real server, the relay,
// the stand-in for Claude and a stand-in remote server (test/fixtures/fake-mcp-remote.js).
// Every bot has every server unless the owner took it from it (ADR 231).
process.env.BOT_DOT_RUNS_MAX = '1';
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const dns = require('node:dns');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, heldRun, waitFor, feed, fakeMcpRemote, fakeConnectedApp } = require('./helpers');
const { rpcClient } = require('./memory-helpers');
const mcp = require('../lib/mcp-client');
const { readKind } = require('../lib/chief-tools');

const KEY = 'tok-9f3a7c1d2b8e5a64';
const WAIT_MS = 700;
const said = (result) => result.content.map((c) => c.text).join('\n');
const isChief = (x) => !!x.botdot && x.args.includes('🧭 Chief of Staff');

let remote, srv, strict, server;
before(async () => {
  remote = await fakeMcpRemote({ key: KEY });
  srv = await startServer({ env: { BOT_DOT_MCP_ALLOW_LOCAL: '1', BOT_DOT_CONNECTOR_WAIT_MS: String(WAIT_MS) } });
  strict = await startServer(); // as botdot runs: no stand-in address is allowed
});
after(async () => {
  for (const s of [srv, strict]) { s.unhold(); await s.stop(); fs.rmSync(s.dir, { recursive: true, force: true }); }
  remote.close();
});

// ---------- the address ----------

test('an address that is not https, or is on this machine or its network, is refused in words', async () => {
  const refused = {
    'http://example.com/mcp': /must start with https:\/\//,
    'ftp://example.com/mcp': /must start with https:\/\//,
    'https://localhost/mcp': /on this machine or its own network/,
    'https://localhost./mcp': /on this machine or its own network/,
    'https://127.0.0.1/mcp': /on this machine or its own network/,
    'https://2130706433/mcp': /on this machine or its own network/,
    'https://10.0.0.5/mcp': /on this machine or its own network/,
    'https://192.168.1.10:8443/mcp': /on this machine or its own network/,
    'https://172.16.0.1/mcp': /on this machine or its own network/,
    'https://169.254.169.254/latest/meta-data': /on this machine or its own network/,
    'https://100.64.0.1/mcp': /on this machine or its own network/,
    'https://[::1]/mcp': /on this machine or its own network/,
    'https://[::ffff:127.0.0.1]/mcp': /on this machine or its own network/,
    'https://[fd00::1]/mcp': /on this machine or its own network/,
    'https://nas.local/mcp': /on this machine or its own network/,
    'https://intranet/mcp': /on this machine or its own network/,
    'https://user:pass@example.com/mcp': /Leave the key out of the address/,
    'https://example.com/mcp?api_key=abc': /Leave the part after/,
    'not a url': /isn't a web address/,
  };
  for (const [url, why] of Object.entries(refused)) {
    const r = await strict.api('/connectors/servers', { method: 'POST', body: { name: 'Bad', url } });
    assert.equal(r.status, 400, url);
    assert.equal(r.data.code, 'bad-address', url);
    assert.match(r.data.error, why, url);
    assert.ok(!r.data.error.includes('pass'), 'a password in an address is not repeated');
  }
  assert.deepEqual((await strict.api('/connectors/servers')).data.servers, [], 'nothing was added');
});

test('a name that resolves to a private address is refused where the connection is made too (DNS rebinding)', async (t) => {
  const real = dns.lookup;
  t.mock.method(dns, 'lookup', (host, options, cb) => {
    if (typeof options === 'function') { cb = options; options = {}; }
    if (host === 'rebind.example') return cb(null, options.all ? [{ address: '203.0.113.9', family: 4 }, { address: '10.1.2.3', family: 4 }] : '10.1.2.3', 4);
    return real(host, options, cb);
  });
  t.mock.method(dns.promises, 'lookup', async (host) => (host === 'rebind.example' ? [{ address: '10.1.2.3', family: 4 }] : [{ address: '93.184.216.34', family: 4 }]));
  await assert.rejects(mcp.assertPublic(mcp.parseAddress('https://rebind.example/mcp')), (e) => e.code === 'bad-address' && /on this machine or its own network/.test(e.message));
  // The connection itself: one of the host's addresses is private, so nothing connects (not even to the public one).
  await assert.rejects(mcp.create().tools({ url: 'https://rebind.example/mcp' }), (e) => e.code === 'bad-address');
});

test('the checks of an address are not on unless botdot is told it is a test', () => {
  assert.equal(process.env.BOT_DOT_MCP_ALLOW_LOCAL, undefined, 'this process runs as botdot does');
  assert.throws(() => mcp.parseAddress('http://127.0.0.1:9/mcp'), /must start with https/);
  for (const ip of ['127.0.0.1', '10.0.0.1', '172.31.255.255', '192.168.0.1', '169.254.1.1', '100.127.0.1', '0.0.0.0', '224.0.0.1', '::1', '::', 'fe80::1', 'fc00::1', '::ffff:10.0.0.1', '::ffff:a00:1', '64:ff9b::a00:1', '2002:a00:1::']) assert.equal(mcp.isBlockedAddress(ip), true, ip);
  for (const ip of ['8.8.8.8', '93.184.216.34', '172.32.0.1', '100.128.0.1', '2606:4700:4700::1111']) assert.equal(mcp.isBlockedAddress(ip), false, ip);
});

// ---------- adding one ----------

test('a server is added with its address and a key: checked first, listed without the key, kept encrypted', async (t) => {
  const f = await feed(srv);
  t.after(() => f.close());
  assert.ok((await f.wait('hello')).data.features.includes('custom-mcp-servers'), 'announced in features');
  // No key, or a wrong one: the server says no, and nothing is kept.
  const none = await srv.api('/connectors/servers', { method: 'POST', body: { name: 'Notes', url: remote.url } });
  assert.equal(none.status, 400);
  assert.match(none.data.error, /The server wants a key/);
  const wrong = await srv.api('/connectors/servers', { method: 'POST', body: { name: 'Notes', url: remote.url, key: 'not-the-key-0000' } });
  assert.equal(wrong.status, 400);
  assert.match(wrong.data.error, /The server refused the key/);
  assert.ok(!JSON.stringify(wrong.data).includes('not-the-key-0000'), 'a wrong key is not repeated');
  assert.deepEqual((await srv.api('/connectors/servers')).data.servers, []);
  // A path that is no MCP server.
  const lost = await srv.api('/connectors/servers', { method: 'POST', body: { name: 'Notes', url: remote.url.replace('/mcp', '/other'), key: KEY } });
  assert.equal(lost.status, 502, 'a server that does not answer as MCP does is not the owner\'s typing mistake');
  assert.match(lost.data.error, /doesn't speak MCP over HTTP/);

  const r = await srv.api('/connectors/servers', { method: 'POST', body: { name: 'Notes', url: remote.url, key: KEY } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  server = r.data;
  assert.match(server.id, /^mcp-[0-9a-f]{8}$/);
  assert.deepEqual([server.name, server.url, server.hasKey, server.toolCount], ['Notes', remote.url, true, 6]);
  assert.ok(!JSON.stringify(r.data).includes(KEY), 'no key in the answer');
  assert.ok(!JSON.stringify((await srv.api('/connectors/servers')).data).includes(KEY), 'no key in the list');
  assert.ok(!JSON.stringify((await srv.api('/bots')).data).includes(KEY));
  // On disk the key is encrypted with the Vault's key, in a file only the server reads.
  const file = path.join(srv.data, 'custom-mcp.json');
  assert.ok(!fs.readFileSync(file, 'utf8').includes(KEY), 'the key is not in the file as it was typed');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).servers[0].key.ct.length > 0, true);
  // The same address again is one server; the same name another.
  assert.equal((await srv.api('/connectors/servers', { method: 'POST', body: { name: 'Other', url: remote.url, key: KEY } })).status, 409);
  // The sessions botdot opened were closed, and the key went in the one header the server asked for.
  assert.equal(remote.sessions.size, 0);
  assert.ok(remote.seen.every((x) => x.headers.authorization === `Bearer ${KEY}` || x.headers.authorization === 'Bearer not-the-key-0000' || !x.headers.authorization));
});

// ---------- a bot's run ----------

// A run of the bot that is going on, with its relay for remote servers.
async function running(t, on, bot) {
  const { token, rec, run } = await heldRun(on, bot);
  const tools = rpcClient(t, 'custom-mcp.js', rec.remote.env);
  const call = (tool, args = {}, srvId = server.id) => tools.call('remote_call', { server: srvId, tool, arguments: args });
  const cards = async () => (await on.api('/asks')).data.filter((a) => a.botId === bot.id && a.kind === 'connector-action');
  const card = (not = null) => waitFor(async () => (await cards()).find((a) => a.id !== not), { what: 'the card of the tool' });
  const answer = (ask, body) => on.api(`/asks/${ask.id}`, { method: 'POST', body });
  const end = async () => { on.release(rec); return on.finished(run.id); };
  return { token, rec, run, tools, call, cards, card, answer, end };
}

test("a bot's run has the relay and no secret: the key is in no config file, environment, argument, prompt or log", async (t) => {
  const bot = await makeBot(srv, { name: 'Notebook', emoji: '📓' });
  const r = await running(t, srv, bot);
  assert.ok(r.rec.remote, 'every bot has every server the owner added, with nothing to give it');
  const env = r.rec.remote.env;
  assert.deepEqual(Object.keys(env).sort(), ['CUSTOM_MCP_SERVERS', 'CUSTOM_MCP_URL', 'RUN_TOKEN']);
  assert.deepEqual(JSON.parse(env.CUSTOM_MCP_SERVERS), [{ id: server.id, name: 'Notes' }], 'only the id and the name');
  assert.ok(env.CUSTOM_MCP_URL.endsWith('/api/connectors/session'));
  assert.match(env.RUN_TOKEN, /^[0-9a-f]{48}$/);
  assert.ok(r.rec.args.includes('mcp__remote'), 'its tools are allowed');
  assert.match(r.rec.system, /MCP servers of the owner's you can use: Notes \(mcp-[0-9a-f]{8}\)\. Find a tool with remote_tools, then call it with remote_call/);
  // What it was started with and handed: nothing of the key anywhere.
  for (const [what, text] of Object.entries({ config: r.rec.mcpText, environment: r.rec.envText, arguments: JSON.stringify(r.rec.args), prompt: r.rec.system, message: r.rec.stdin, relay: JSON.stringify(r.rec.remote) })) assert.ok(!text.includes(KEY), `no key in its ${what}`);
  // The relay lists tools and gives one's schema, with whether it only reads.
  const listed = JSON.parse(said(await r.tools.call('remote_tools', { server: server.id })));
  assert.deepEqual(listed.map((x) => [x.name, x.readOnly]), [['search_notes', true], ['create_note', false], ['delete_note', false], ['peek_then_wipe', false], ['explode', true], ['leak', true]]);
  const one = JSON.parse(said(await r.tools.call('remote_tools', { server: server.id, tool: 'create_note' })));
  assert.deepEqual(one[0].input.required, ['title']);
  assert.deepEqual(JSON.parse(said(await r.tools.call('remote_tools', { server: server.id, search: 'delete' }))).map((x) => x.name), ['delete_note']);
  assert.match(said(await r.tools.call('remote_tools', { server: server.id, tool: 'nope' })), /has no tool called nope/);
  // A tool that only reads goes at once, with the key in the one header, botdot's and no bot's.
  const before = remote.calls.length;
  const read = await r.call('search_notes', { query: 'milk' });
  assert.ok(!read.isError, said(read));
  assert.equal(said(read), 'search_notes done: {"query":"milk"}');
  assert.deepEqual(remote.calls.slice(before).map((c) => [c.name, c.auth]), [['search_notes', `Bearer ${KEY}`]]);
  assert.deepEqual(await r.cards(), [], 'a read makes no card');
  // A read that fails says so in the server's words; one that answers with the key shows the key as [key].
  assert.match(said(await r.call('explode')), /^Error: Notes reported an error: Something broke/);
  const leak = await r.call('leak');
  assert.ok(!said(leak).includes(KEY), 'a server that echoes the key does not hand it to the bot');
  assert.match(said(leak), /the key is \[key\]/);
  // A server or a tool that isn't there.
  assert.match(said(await r.call('search_notes', {}, 'mcp-00000000')), /You don't have that server/);
  assert.match(said(await r.call('no_such_tool')), /has no tool called no_such_tool/);
  assert.ok(!srv.log.join('').includes(KEY), 'the key is not in the server log');
  assert.ok(!srv.log.join('').includes(env.RUN_TOKEN), "nor the run's token");
  await r.end();
});

test('a server that puts the key in what it says of its tools hands the bot none of it: names, descriptions, schemas and titles are scrubbed', async (t) => {
  const KEY2 = 'tok-echo-6d1b0e94a7c3f528';
  const echo = await fakeMcpRemote({ key: KEY2, echoKey: true });
  t.after(() => echo.close());
  const added = await srv.api('/connectors/servers', { method: 'POST', body: { name: 'Echo', url: echo.url, key: KEY2 } });
  assert.equal(added.status, 201, JSON.stringify(added.data));
  t.after(() => srv.api(`/connectors/servers/${added.data.id}`, { method: 'DELETE' }));
  assert.ok(!JSON.stringify(added.data).includes(KEY2));
  const bot = await makeBot(srv, { name: 'Echoed', emoji: '🪞' });
  const r = await running(t, srv, bot);
  const ask = (args) => r.tools.call('remote_tools', { server: added.data.id, ...args });
  const names = JSON.parse(said(await ask({}))).map((x) => x.name);
  const outputs = [said(await ask({})), said(await ask({ search: 'notes' })), said(await ask({ tool: 'create_note' })), said(await ask({ tool: 'search_notes_[key]' }))];
  for (const out of outputs) assert.ok(!out.includes(KEY2), 'no key in what remote_tools returns');
  assert.ok(names.includes('search_notes_[key]'), `the name is scrubbed: ${names}`);
  const one = JSON.parse(outputs[2])[0];
  assert.match(one.description, /Sent with Bearer \[key\]/);
  assert.match(JSON.stringify(one.input), /key \[key\]/);
  assert.ok(Object.keys(one.input.properties).includes('p_[key]'), 'a property name too');
  // A tool the server does not have: the words of the error list only scrubbed names.
  const missing = said(await r.call('nope', {}, added.data.id));
  assert.match(missing, /has no tool called nope/);
  assert.ok(!missing.includes(KEY2), 'no key in the error that lists its tools');
  assert.ok(!srv.log.join('').includes(KEY2), 'nor in the server log');
  await r.end();
});

test("a tool that does not only read waits for the owner's card inside the run: Allow once, Decline and Always allow", async (t) => {
  const bot = await makeBot(srv, { name: 'Writer', emoji: '✍️' });
  const r = await running(t, srv, bot);
  const before = remote.calls.length;
  // A tool with no hint, one that is destructive, and one that says both: all wait.
  const waits = r.call('create_note', { title: 'Milk' });
  const ask = await r.card();
  assert.deepEqual([ask.app, ask.action, ask.arguments, ask.held], [server.id, 'create_note', { title: 'Milk' }, true]);
  assert.equal(ask.title, 'Create note with Notes?');
  assert.deepEqual(ask.rows, [{ label: 'Title', value: 'Milk' }]);
  assert.equal(ask.everyBot, undefined, "a remote server's tool is always allowed for this bot only");
  assert.equal(remote.calls.length, before, 'nothing was done while it waits');
  assert.equal((await srv.api('/asks')).data.find((a) => a.id === ask.id).always, 'Always allow');
  // Always allow for every bot is refused on it.
  const all = await r.answer(ask, { yes: true, always: 'all' });
  assert.equal(all.status, 409);
  // Allow once: the call goes through, once, with the exact arguments.
  assert.equal((await r.answer(ask, { yes: true })).status, 200);
  const done = await waits;
  assert.equal(said(done), 'create_note done: {"title":"Milk"}');
  assert.deepEqual(remote.calls.slice(before).map((c) => [c.name, c.arguments]), [['create_note', { title: 'Milk' }]]);
  // The same tool with other arguments asks again; a no is told to the bot in botdot's words.
  const again = r.call('create_note', { title: 'Eggs' });
  const second = await r.card(ask.id);
  assert.equal((await r.answer(second, { yes: false })).status, 200);
  assert.match(said(await again), /^Error: The owner declined this action, so it was not done\. Don't try it another way/);
  // Destructive, and a tool that says both: cards too.
  const wipe = r.call('delete_note', { id: '1' });
  const del = await r.card(second.id);
  assert.equal(del.action, 'delete_note');
  assert.equal((await r.answer(del, { yes: true, always: true })).status, 200);
  assert.equal(said(await wipe), 'delete_note done: {"id":"1"}');
  // Always allow is for this bot, this tool, any arguments: the next call goes at once.
  const grants = (await srv.api(`/bots/${bot.id}/connector-actions`)).data;
  assert.deepEqual(grants, [`${server.id}:delete_note`]);
  assert.deepEqual((await srv.api(`/bots/${bot.id}`)).data.alwaysAllowed?.map((g) => g.label) ?? ['Delete note with Notes'], ['Delete note with Notes']);
  assert.equal(said(await r.call('delete_note', { id: '2' })), 'delete_note done: {"id":"2"}');
  const both = r.call('peek_then_wipe');
  const conflict = await r.card(del.id);
  assert.equal(conflict.action, 'peek_then_wipe', 'a tool whose hints disagree is a write');
  await r.answer(conflict, { yes: false });
  await both;
  // Another bot is not covered by that grant.
  const other = await makeBot(srv, { name: 'Other', emoji: '🧪' });
  await r.end();
  const o = await running(t, srv, other);
  const asks = o.call('delete_note', { id: '3' });
  const card = await o.card();
  assert.equal(card.botId, other.id);
  await o.answer(card, { yes: false });
  await asks;
  await o.end();
  assert.ok(!srv.log.join('').includes(KEY));
});

test('the wait ends in words for the bot when the owner does not answer, and the card stays', async (t) => {
  const bot = await makeBot(srv, { name: 'Patient', emoji: '⏳' });
  const r = await running(t, srv, bot);
  const before = remote.calls.length;
  const out = await r.call('create_note', { title: 'Late' });
  assert.match(said(out), /^Error: The owner has not answered yet, so this action was not done\. Its card stays in Needs you/);
  assert.equal(remote.calls.length, before);
  assert.equal((await r.cards()).length, 1, 'the card stays');
  await r.end();
});

test('the owner takes a server from one bot and gives it back; a server added later is every bot\'s', async (t) => {
  const bot = await makeBot(srv, { name: 'Without', emoji: '🚫' });
  const all = (await srv.api('/bots')).data.map((b) => b.id);
  assert.deepEqual((await srv.api('/connectors/servers')).data.servers[0].usedBy.sort(), [...all].sort(), 'every bot has it');
  const off = await srv.api(`/connectors/servers/${server.id}/bots`, { method: 'PUT', body: { bots: all.filter((id) => id !== bot.id) } });
  assert.equal(off.status, 200);
  assert.ok(!off.data.usedBy.includes(bot.id));
  // Its run has no relay, and what the relay would have given is refused on botdot's side too, with the run's own token.
  const { token, rec } = await heldRun(srv, bot);
  assert.equal(rec.remote, null);
  assert.ok(!rec.args.includes('mcp__remote'));
  assert.doesNotMatch(rec.system, /MCP servers of the owner's/);
  const call = await srv.api('/connectors/session/custom-run', { method: 'POST', headers: { 'X-Run-Token': token }, body: { server: server.id, tool: 'search_notes', arguments: {} } });
  assert.match(call.data.error, /You don't have the server Notes\. Yours: none\./);
  srv.release(rec);
  await srv.finished((await srv.api(`/runs?botId=${bot.id}`)).data[0].id);
  // Given back.
  await srv.api(`/connectors/servers/${server.id}/bots`, { method: 'PUT', body: { bots: all } });
  const again = await running(t, srv, bot);
  assert.ok(again.rec.remote, 'it has it again');
  await again.end();
});

// ---------- the Chief ----------

async function ownerTurn(t, on, text) {
  on.hold();
  const chat = (await on.api('/chief/chats', { method: 'POST' })).data;
  await on.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text } });
  const rec = await on.nextRun((r) => isChief(r) && r.stdin.includes(text), "the Chief's turn");
  const relay = rec.remote ? rpcClient(t, 'custom-mcp.js', rec.remote.env) : null;
  return { chat, rec, relay, end: async () => { on.release(rec); await waitFor(async () => { const c = (await on.api(`/chief/chats/${chat.id}`)).data; return c.busy ? null : c; }, { what: 'the Chief to finish' }); } };
}

test("the Chief uses the servers in a turn the owner started: a read at once, a write on a card of its own", async (t) => {
  const turn = await ownerTurn(t, srv, 'Find my notes about milk.');
  assert.ok(turn.rec.remote, 'the turn has the relay, with no Composio app connected');
  assert.equal(turn.rec.connectors, null, 'and no connected apps');
  const env = turn.rec.remote.env;
  assert.equal(env.CONNECTOR_CALLER, 'chief');
  assert.notEqual(env.RUN_TOKEN, srv.chiefKey, "not the Chief's key");
  assert.ok(turn.rec.args.includes('mcp__remote'));
  assert.ok(!JSON.stringify([turn.rec.mcpText, turn.rec.envText, turn.rec.args, turn.rec.system, turn.rec.stdin]).includes(KEY), 'no key in anything the Chief gets');
  assert.match(turn.rec.system, /The user's own MCP servers/);
  const read = await turn.relay.call('remote_call', { server: server.id, tool: 'search_notes', arguments: { query: 'milk' } });
  assert.ok(!read.isError, said(read));
  assert.deepEqual((await srv.api('/asks')).data.filter((a) => a.kind === 'connector-action' && a.chief), []);
  // A write: the Chief's card, with its own grants.
  const writing = turn.relay.call('remote_call', { server: server.id, tool: 'create_note', arguments: { title: 'Milk' } });
  const card = await waitFor(async () => (await srv.api('/asks')).data.find((a) => a.kind === 'connector-action' && a.chief), { what: "the Chief's card" });
  assert.deepEqual([card.app, card.action, card.chief], [server.id, 'create_note', true]);
  await srv.api(`/asks/${card.id}`, { method: 'POST', body: { yes: true, always: true } });
  assert.equal(said(await writing), 'create_note done: {"title":"Milk"}');
  assert.deepEqual((await srv.asChief('/chief/connector-actions')).data.actions, [`${server.id}:create_note`], "the Chief's own lasting grant");
  assert.deepEqual((await srv.api('/connector-actions')).data.grants, [], 'not a grant for every bot');
  // After a server's answer the turn has read outside content: its changes in botdot wait, as after an app.
  assert.equal(readKind('mcp__remote__remote_call'), 'app');
  assert.equal(readKind('mcp__remote__remote_tools'), 'web');
  await turn.end();
  assert.equal((await srv.api('/connectors/session/custom-run', { method: 'POST', headers: { 'X-Run-Token': env.RUN_TOKEN }, body: { server: server.id, tool: 'search_notes', arguments: {} } })).status, 403, 'the token goes with the turn');
  // The Chief lists them, and proposes one on a card that opens the Apps page: the key is never asked in chat.
  const listing = rpcClient(t, 'mcp-server.js', { BOT_DOT_URL: srv.base, BOT_DOT_CHIEF_KEY: srv.chiefKey, BOT_DOT_TURN: 'owner' });
  const names = (await listing.request('tools/list')).tools.map((x) => x.name);
  assert.ok(names.includes('list_mcp_servers') && names.includes('offer_mcp_server'));
  const listed = await listing.json('list_mcp_servers', {});
  assert.deepEqual(listed.servers.map((s) => [s.id, s.name, s.address, s.hasKey, s.tools]), [[server.id, 'Notes', remote.url, true, 6]]);
  assert.ok(!JSON.stringify(listed).includes(KEY));
});

test('the Chief proposes a server by name and address: a card that opens the Apps page, answered by adding it', async (t) => {
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  const chief = rpcClient(t, 'mcp-server.js', { BOT_DOT_URL: srv.base, BOT_DOT_CHIEF_KEY: srv.chiefKey, BOT_DOT_TURN: 'owner', CHIEF_CHAT_ID: chat.id });
  // A server of botdot's as it runs: an address on this machine, or with a key in it, makes no card.
  const strictChief = rpcClient(t, 'mcp-server.js', { BOT_DOT_URL: strict.base, BOT_DOT_CHIEF_KEY: strict.chiefKey, BOT_DOT_TURN: 'owner', CHIEF_CHAT_ID: chat.id });
  assert.match(said(await strictChief.call('offer_mcp_server', { name: 'Local', url: 'http://127.0.0.1:8080/mcp' })), /must start with https/);
  assert.match(said(await strictChief.call('offer_mcp_server', { name: 'Local', url: 'https://127.0.0.1/mcp' })), /on this machine or its own network/);
  assert.match(said(await strictChief.call('offer_mcp_server', { name: 'In URL', url: 'https://example.com/mcp?token=1' })), /Leave the part after/);
  assert.deepEqual((await strict.api('/asks?connect-app=1')).data.filter((a) => a.mode === 'server'), []);
  const r = await chief.json('offer_mcp_server', { name: 'Linear', url: 'https://mcp.linear.example/mcp', reason: 'To read your issues.' });
  assert.equal(r.asked, true);
  const card = (await srv.api('/asks?connect-app=1')).data.find((a) => a.kind === 'connect-app' && a.mode === 'server');
  assert.deepEqual([card.name, card.serverUrl, card.botId ?? null], ['Linear', 'https://mcp.linear.example/mcp', null]);
  assert.deepEqual(card.act, { verb: 'open', screen: 'connectors', label: 'Open Apps' });
  assert.equal(card.title, 'Add the MCP server Linear?');
  assert.equal(card.body, 'https://mcp.linear.example/mcp');
  assert.ok(!JSON.stringify(card).toLowerCase().includes('key":'), 'the card holds no key');
  assert.equal((await chief.json('offer_mcp_server', { name: 'Linear', url: 'https://mcp.linear.example/mcp' })).joined, true, 'asked again, it is the same card');
  assert.equal((await srv.api('/asks?connect-app=1')).data.filter((a) => a.mode === 'server').length, 1);
  // The owner cannot say yes to it here (the key is pasted on the Apps page); a no is Not now.
  assert.equal((await srv.api(`/asks/${card.id}`, { method: 'POST', body: { yes: true } })).status, 200, 'it only closes');
  // The server that is added already is not proposed again, and the owner's own add answers a card.
  const again = await chief.json('offer_mcp_server', { name: 'Notes', url: remote.url });
  assert.equal(again.asked, false);
  assert.match(again.note, /already added/);
  const second = await chief.json('offer_mcp_server', { name: 'Third', url: 'https://mcp.third.example/mcp' });
  assert.equal(second.asked, true);
  await srv.api('/asks/' + (await srv.api('/asks?connect-app=1')).data.find((a) => a.mode === 'server').id, { method: 'POST', body: { yes: false } });
  assert.equal((await srv.api('/asks?connect-app=1')).data.filter((a) => a.mode === 'server').length, 0, 'Not now closes it');
});

// ---------- changing the key and removing it ----------

test('a key is replaced after a check; removing the server takes its grants and its tools from every run', async (t) => {
  const bad = await srv.api(`/connectors/servers/${server.id}`, { method: 'PUT', body: { key: 'wrong-key-12345' } });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /refused the key/);
  const good = await srv.api(`/connectors/servers/${server.id}`, { method: 'PUT', body: { key: KEY } });
  assert.equal(good.status, 200);
  assert.ok(!JSON.stringify(good.data).includes(KEY));
  const bot = await makeBot(srv, { name: 'Leaver', emoji: '👋' });
  const r = await running(t, srv, bot);
  const grants = JSON.parse(fs.readFileSync(path.join(srv.data, 'connector-actions.json'), 'utf8'));
  assert.ok(Object.values(grants).some((list) => list.some((g) => g.startsWith(`${server.id}:`))), 'grants of the server exist');
  assert.equal((await srv.api(`/connectors/servers/${server.id}`, { method: 'DELETE' })).status, 200);
  const after = JSON.parse(fs.readFileSync(path.join(srv.data, 'connector-actions.json'), 'utf8'));
  assert.ok(!Object.values(after).some((list) => list.some((g) => g.startsWith(`${server.id}:`))), 'its lasting grants went with it');
  assert.match(said(await r.call('search_notes')), /You don't have that server/);
  assert.deepEqual((await srv.api('/connectors/servers')).data.servers, []);
  assert.equal((await srv.api(`/connectors/servers/${server.id}`, { method: 'DELETE' })).status, 404);
  await r.end();
  // A run after it has no relay.
  const next = await heldRun(srv, bot);
  assert.equal(next.rec.remote, null);
  srv.release(next.rec);
  assert.ok(!fs.readFileSync(path.join(srv.data, 'custom-mcp.json'), 'utf8').includes('"key"'), 'no key is left');
});

test('a key in another header, an answer as a stream of events, and a server without a key', async () => {
  const other = await fakeMcpRemote({ key: 'plain-key-77', header: 'X-Api-Key', sse: true });
  try {
    const bad = await srv.api('/connectors/servers', { method: 'POST', body: { name: 'Streams', url: other.url, key: 'plain-key-77' } });
    assert.equal(bad.status, 400, 'the key goes in Authorization unless the owner names another header');
    const r = await srv.api('/connectors/servers', { method: 'POST', body: { name: 'Streams', url: other.url, key: 'plain-key-77', header: 'X-Api-Key' } });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.header, 'X-Api-Key');
    assert.ok(!JSON.stringify(r.data).includes('plain-key-77'));
    assert.equal((await srv.api('/connectors/servers', { method: 'POST', body: { name: 'x', url: other.url.replace('/mcp', '/mcp/'), key: 'plain-key-77', header: 'Host' } })).status, 400, 'a header of the connection is no key\'s');
    assert.equal((await srv.api(`/connectors/servers/${r.data.id}`, { method: 'DELETE' })).status, 200);
  } finally { other.close(); }
  const open = await fakeMcpRemote();
  try {
    const r = await srv.api('/connectors/servers', { method: 'POST', body: { url: open.url } });
    assert.equal(r.status, 201, JSON.stringify(r.data));
    assert.equal(r.data.hasKey, false);
    assert.equal(r.data.name, 'Notes Remote', "the server's own name when none is given");
    await srv.api(`/connectors/servers/${r.data.id}`, { method: 'DELETE' });
  } finally { open.close(); }
});

test("the Chief's write to a remote server that waits past the wait window carries on after a late yes: told remote_call, once", async (t) => {
  const added = await srv.api('/connectors/servers', { method: 'POST', body: { name: 'Notes', url: remote.url, key: KEY } }); // the test before took the first one away
  assert.equal(added.status, 201, JSON.stringify(added.data));
  server = added.data;
  const turn = await ownerTurn(t, srv, 'Add milk to my notes.');
  const before = remote.calls.length;
  const args = { title: 'Late milk' };
  const waited = await turn.relay.call('remote_call', { server: server.id, tool: 'create_note', arguments: args });
  assert.ok(waited.isError, 'the call waited past the window and was not done');
  assert.match(said(waited), /has not answered yet/);
  const late = await waitFor(async () => (await srv.api('/asks')).data.find((a) => a.kind === 'connector-action' && a.chief), { what: "the Chief's card" });
  assert.equal(late.held, false);
  assert.equal(late.then?.who, 'chief');
  await turn.end();
  assert.equal(remote.calls.length, before, 'nothing was done while it waited');

  // The late yes: a Chief turn of botdot's in that chat, told remote_call (not connector_run), with the grant bound to it.
  srv.hold();
  const yes = await srv.api(`/asks/${late.id}`, { method: 'POST', body: { yes: true } });
  assert.equal(yes.status, 200);
  assert.equal(yes.data.carriesOn?.who, 'chief');
  const rec = await srv.nextRun((x) => isChief(x) && x.stdin.includes('The user said yes on the card of your action in a connected app'), "the Chief's turn after the yes");
  assert.ok(rec.remote, 'the carry-on turn has the relay, with no Composio app connected');
  assert.equal(rec.connectors, null, 'and no connected apps');
  assert.ok(rec.args.includes('mcp__remote'));
  assert.match(rec.stdin, /Do it now with remote_call, and say in one line/);
  assert.match(rec.stdin, /Call remote_call with server "mcp-/);
  assert.ok(!/connector_run/.test(rec.stdin), 'connector_run is not named for a remote server');
  assert.match(rec.stdin, /"title": "Late milk"/);
  const relay = rpcClient(t, 'custom-mcp.js', rec.remote.env);
  // Its call goes through to the remote server once, without a new card.
  assert.equal(said(await relay.call('remote_call', { server: server.id, tool: 'create_note', arguments: args })), 'create_note done: {"title":"Late milk"}');
  assert.deepEqual(remote.calls.slice(before).map((c) => [c.name, c.arguments]), [['create_note', args]]);
  // Once: the same call again asks anew.
  const twice = relay.call('remote_call', { server: server.id, tool: 'create_note', arguments: args });
  const fresh = await waitFor(async () => (await srv.api('/asks')).data.find((a) => a.kind === 'connector-action' && a.chief && a.id !== late.id), { what: 'a new card for the second call' });
  await srv.api(`/asks/${fresh.id}`, { method: 'POST', body: { yes: false } });
  assert.match(said(await twice), /declined/);
  assert.equal(remote.calls.length, before + 1);
  srv.release(rec);
  await waitFor(async () => { const c = (await srv.api(`/chief/chats/${turn.chat.id}`)).data; return c.busy ? null : c; }, { what: 'the Chief to finish' });
});

// ---------- a turn botdot started has only the server it carries on (ADR 047, ADR 265) ----------

test("a turn botdot started has no remote servers but the one its late yes was for: no relay after a Composio yes or a connected app", async (t) => {
  const app = await fakeConnectedApp({ connected: ['gmail'] });
  const other = await fakeMcpRemote({ key: KEY });
  const mixed = await startServer({ env: { ...app.env, BOT_DOT_MCP_ALLOW_LOCAL: '1', BOT_DOT_CONNECTOR_WAIT_MS: String(WAIT_MS) } });
  t.after(async () => { mixed.unhold(); await mixed.stop(); fs.rmSync(mixed.dir, { recursive: true, force: true }); app.close(); other.close(); });
  await app.connect(mixed);
  const one = (await mixed.api('/connectors/servers', { method: 'POST', body: { name: 'Notes', url: remote.url, key: KEY } })).data;
  const two = (await mixed.api('/connectors/servers', { method: 'POST', body: { name: 'Wiki', url: other.url, key: KEY } })).data;
  assert.ok(one.id && two.id);
  const servers = (rec) => (rec.remote ? JSON.parse(rec.remote.env.CUSTOM_MCP_SERVERS).map((x) => x.id).sort() : null);
  const chiefCard = async (not = []) => waitFor(async () => (await mixed.api('/asks')).data.find((a) => a.kind === 'connector-action' && a.chief && !not.includes(a.id)), { what: "the Chief's card" });
  const boundTurn = async (text) => mixed.nextRun((x) => isChief(x) && x.stdin.includes(text), "the Chief's turn started by botdot");

  // An owner turn has every server.
  const owner = await ownerTurn(t, mixed, 'What is in my notes and my wiki?');
  assert.deepEqual(servers(owner.rec), [one.id, two.id].sort(), 'the owner turn has every server');
  assert.ok(owner.rec.args.includes('mcp__remote'));
  await owner.end();

  // A late yes on a Composio card: the carry-on turn has the app and no remote relay.
  const gmail = await ownerTurn(t, mixed, 'Tell Anna I am late.');
  const mail = { recipient_email: 'anna@example.com', subject: 'Late', body: 'Hi' };
  const apps = rpcClient(t, 'connectors-mcp.js', gmail.rec.connectors.env);
  assert.match(said(await apps.call('connector_run', { app: 'gmail', action: 'GMAIL_SEND_EMAIL', arguments: mail })), /has not answered yet/);
  const mailCard = await chiefCard();
  await gmail.end();
  mixed.hold();
  assert.equal((await mixed.api(`/asks/${mailCard.id}`, { method: 'POST', body: { yes: true } })).data.carriesOn?.who, 'chief');
  const carry = await boundTurn('The user said yes on the card of your action in a connected app');
  assert.ok(carry.connectors, 'the app is there');
  assert.ok(!carry.remote, 'and no remote relay');
  assert.ok(!carry.args.includes('mcp__remote'), 'nor its tools allowed');
  assert.ok(carry.args.includes('mcp__connectors'));
  mixed.release(carry);
  await waitFor(async () => { const c = (await mixed.api(`/chief/chats/${gmail.chat.id}`)).data; return c.busy ? null : c; }, { what: 'the Chief to finish' });

  // A late yes on a server's own card: that server alone, and the other is not reachable in the turn.
  const notes = await ownerTurn(t, mixed, 'Add milk to my notes.');
  const args = { title: 'Late milk' };
  assert.match(said(await notes.relay.call('remote_call', { server: one.id, tool: 'create_note', arguments: args })), /has not answered yet/);
  const noteCard = await chiefCard([mailCard.id]);
  await notes.end();
  mixed.hold();
  assert.equal((await mixed.api(`/asks/${noteCard.id}`, { method: 'POST', body: { yes: true } })).data.carriesOn?.who, 'chief');
  const late = await boundTurn('Call remote_call with server');
  assert.deepEqual(servers(late), [one.id], 'only the server of the card');
  assert.ok(late.args.includes('mcp__remote'));
  const relay = rpcClient(t, 'custom-mcp.js', late.remote.env);
  const wiki = await relay.call('remote_tools', { server: two.id });
  assert.match(said(wiki), /You don't have the server Wiki/);
  assert.equal(said(await relay.call('remote_call', { server: one.id, tool: 'create_note', arguments: args })), 'create_note done: {"title":"Late milk"}');
  // The session itself refuses the other server, whatever its relay is told.
  const direct = await mixed.api('/connectors/session/custom-tools', { method: 'POST', headers: { 'X-Run-Token': late.remote.env.RUN_TOKEN }, body: { server: two.id } });
  assert.equal(direct.data.ok, false);
  mixed.release(late);
  await waitFor(async () => { const c = (await mixed.api(`/chief/chats/${notes.chat.id}`)).data; return c.busy ? null : c; }, { what: 'the Chief to finish' });

  // An app connected from the Chief's Connect card: the turn that carries on has the app and no remote relay.
  const linear = await ownerTurn(t, mixed, 'What are my Linear issues?');
  const lapps = rpcClient(t, 'connectors-mcp.js', linear.rec.connectors.env);
  assert.match(said(await lapps.call('connector_run', { app: 'linear', action: 'LINEAR_LIST_ISSUES', arguments: {} })), /isn't connected/);
  await linear.end();
  app.connected.push('linear');
  mixed.hold();
  await mixed.api('/connectors');
  const connected = await boundTurn('The user connected Linear from the card you offered in this chat.');
  assert.ok(connected.connectors.env.CONNECTOR_APPS.split(',').includes('linear'));
  assert.ok(!connected.remote, 'no remote relay in the connected-app turn');
  assert.ok(!connected.args.includes('mcp__remote'));
  mixed.release(connected);
  await waitFor(async () => { const c = (await mixed.api(`/chief/chats/${linear.chat.id}`)).data; return c.busy ? null : c; }, { what: 'the Chief to finish' });
});
