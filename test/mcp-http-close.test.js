// What ending a run does to its tool servers (ADR 270, #1670), and who may use a token, tried on the route itself: the
// MCP route of botdot with the tokens of lib/mcp-sessions.js, in this process, and a stand-in for botdot's own routes
// that the Chief's tools call. In-process, because the route's guard reads `identity.identify`, which can tell a bot's
// Linux user from another's only on Linux with the broker: here the caller is whoever the test says.
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-mcp-close-'));
const data = path.join(dir, 'data');
fs.mkdirSync(data, { recursive: true });
Object.assign(process.env, { BOT_DOT_DATA: data, BOT_DOT_VAULT_KEY_FILE: path.join(dir, 'vault.key'), BOT_DOT_SEPARATE_USERS: '0', HOME: path.join(dir, 'home') });
fs.mkdirSync(process.env.HOME);

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const B = require('../lib/bots');
const mcp = require('../lib/mcp-sessions');
const { create } = require('../lib/routes/mcp');

let caller = 'owner'; // what `identity.identify` says of the next request's socket
let fromFrontDoor = false;
const identify = B.identity.identify;
let routes, server, base, stub, stubBase;
const polls = []; // the paths botdot's stand-in was asked for
const stubOpen = new Set(); // its requests still waiting

before(async () => {
  B.identity.identify = () => caller;
  routes = create({ fromFrontDoor: () => fromFrontDoor });
  server = http.createServer((req, res) => routes(req, res, new URL(req.url, 'http://x')));
  // A stand-in for botdot's routes the Chief's tools wait on: a run that never ends, and a login request nobody answers.
  stub = http.createServer((req, res) => {
    polls.push(`${req.method} ${req.url.split('?')[0]}`);
    if (req.method === 'POST') { req.resume(); return req.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(JSON.stringify({ id: 'r1' })); }); }
    stubOpen.add(res);
    res.on('close', () => stubOpen.delete(res)); // botdot's side hangs up: the poll is over
  });
  await Promise.all([server, stub].map((s) => new Promise((r) => s.listen(0, '127.0.0.1', r))));
  base = `http://127.0.0.1:${server.address().port}${mcp.PATH}`;
  stubBase = `http://127.0.0.1:${stub.address().port}`;
});
after(async () => {
  B.identity.identify = identify;
  for (const res of stubOpen) res.destroy();
  await Promise.all([server, stub].map((s) => new Promise((r) => s.close(r))));
  fs.rmSync(dir, { recursive: true, force: true });
});

const post = (name, token, body) => fetch(`${base}${name}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bot-Dot': '1', ...(token ? { Authorization: `Bearer ${token}` } : {}) }, body: JSON.stringify(body) });
const ping = (name, token) => post(name, token, { jsonrpc: '2.0', id: 1, method: 'ping' });
const tokenOf = (config) => config.headers.Authorization.slice(7);
const call = (name, token, tool, args) => post(name, token, { jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: tool, arguments: args } });
// A call that should have ended fails the test instead of hanging it.
const ends = (promise, what) => Promise.race([promise, new Promise((_, no) => setTimeout(() => no(new Error(`${what} did not end`)), 3000).unref())]);
const eventually = async (what, ok) => { for (let i = 0; i < 100; i++) { if (await ok()) return; await new Promise((r) => setTimeout(r, 20)); } assert.fail(`${what} did not happen`); };

test("a bot's own user reaches its own tools only: another bot's token and a Chief turn's both get 401", async () => {
  const a = mcp.group({ botId: 'bot-a' });
  const b = mcp.group({ botId: 'bot-b' });
  const chief = mcp.group();
  try {
    const own = tokenOf(a.serve('self', {}));
    const theirs = tokenOf(b.serve('self', {}));
    const theChiefs = tokenOf(chief.serve('botdot', {}));
    caller = { bot: 'bot-a' };
    assert.equal((await ping('self', own)).status, 200, 'its own');
    assert.equal((await ping('self', theirs)).status, 401, "another bot's token for the same server");
    assert.equal((await ping('botdot', theChiefs)).status, 401, "a Chief turn's token");
    // The same tokens, from a caller that is not a bot's user (the owner, or where users are not told apart), work.
    caller = 'owner';
    assert.equal((await ping('self', theirs)).status, 200);
    assert.equal((await ping('botdot', theChiefs)).status, 200);
  } finally { caller = 'owner'; a.close(); b.close(); chief.close(); }
});

test('a request through the front door never reaches a tool server, with a good token or without', async () => {
  const run = mcp.group({ botId: 'bot-a' });
  try {
    const token = tokenOf(run.serve('self', {}));
    assert.equal((await ping('self', token)).status, 200);
    fromFrontDoor = true;
    assert.equal((await ping('self', token)).status, 404);
    assert.equal((await ping('self', null)).status, 404);
  } finally { fromFrontDoor = false; run.close(); }
});

test("closing a run's tools ends a Chief call that is waiting for a run, and later requests get 401", async () => {
  const chief = mcp.group();
  const token = tokenOf(chief.serve('botdot', { BOT_DOT_URL: stubBase, BOT_DOT_CHIEF_KEY: 'k', BOT_DOT_TURN: 'owner' }));
  polls.length = 0;
  const answer = call('botdot', token, 'wait_for_run', { runId: 'run1', timeoutSeconds: 540 }).then((r) => r.json());
  await eventually('the first poll', () => stubOpen.size === 1);
  const closedAt = Date.now();
  chief.close();
  const r = await ends(answer, 'the call');
  assert.ok(Date.now() - closedAt < 2000, 'the call ended with the run, not at its 9 minutes');
  assert.ok(r.error || r.result?.isError, `it ended as a failed call: ${JSON.stringify(r)}`);
  await eventually("botdot's poll to be hung up", () => stubOpen.size === 0);
  await new Promise((res) => setTimeout(res, 100));
  assert.equal(polls.filter((p) => p.includes('/wait')).length, 1, 'and it polled no more');
  assert.equal((await ping('botdot', token)).status, 401, 'a later request is refused');
});

test("closing a run's tools ends a Chief call that is waiting for the owner's login", async () => {
  const chief = mcp.group();
  const token = tokenOf(chief.serve('botdot', { BOT_DOT_URL: stubBase, BOT_DOT_CHIEF_KEY: 'k', BOT_DOT_TURN: 'owner' }));
  polls.length = 0;
  const answer = call('botdot', token, 'request_login', { site: 'example.com', forBot: 'bot-a', reason: 'To log in.' }).then((r) => r.json());
  await eventually('the first wait', () => stubOpen.size === 1);
  const closedAt = Date.now();
  chief.close();
  const r = await ends(answer, 'the call');
  assert.ok(Date.now() - closedAt < 2000, 'the call ended with the run, not at its 14 minutes');
  assert.ok(r.error || r.result?.isError, `it ended as a failed call: ${JSON.stringify(r)}`);
  await new Promise((res) => setTimeout(res, 100));
  assert.equal(polls.filter((p) => p.endsWith('/wait')).length, 1, 'and it asked no more');
  assert.equal((await ping('botdot', token)).status, 401);
});

test('closing a run whose server was never made makes none, and ends the run all the same', async () => {
  const vault = require('../lib/vault-mcp');
  const made = vault.create;
  let makes = 0;
  vault.create = (...args) => { makes++; return made(...args); };
  const run = mcp.group({ botId: 'bot-a' });
  const config = run.serve('vault', { VAULT_URL: stubBase, VAULT_TOKEN: 't' });
  const token = tokenOf(config);
  assert.equal(mcp.find(token, 'self'), null, 'a server of another name is not made either');
  try {
    run.close();
    assert.equal(mcp.find(token, 'vault'), null, 'and its token is no longer one');
    assert.equal((await ping('vault', token)).status, 401);
    run.close(); // twice is nothing
    assert.equal(makes, 0, 'closing made no server, and nothing after it did');
  } finally { vault.create = made; }
});
