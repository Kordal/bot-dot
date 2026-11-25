// The Chief can say which model, provider and reasoning level each bot, it itself, the account default and the
// background calls run on (#1684, ADR 267): from what a run would use now, never from the saved field alone, and with
// no key, address or price. Real server with two model providers saved beside the Claude subscription.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const { spawn } = require('child_process');
const { startServer, makeBot, ROOT } = require('./helpers');

const KEY = 'sk-provider-KEY-0123456789-wxyz';
const stand = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(req.url.endsWith('/v1/models') ? { data: [{ id: 'model-a' }, { id: 'model-b' }] } : { content: [{ type: 'text', text: 'OK' }] }));
});

let srv;
let url;
before(async () => {
  await new Promise((r) => stand.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${stand.address().port}/first`;
  srv = await startServer({ env: { CLAUDE_CODE_OAUTH_TOKEN: 'subscription-token-AAAA', BOT_DOT_GROUP_ROUTER: 'on', BOT_DOT_GROUP_NOTES: 'on' } });
});
after(async () => { await srv?.stop(); stand.closeAllConnections(); stand.close(); });

const inUse = async () => (await srv.api('/settings/models-in-use')).data;
const by = (list, name) => list.find((x) => x.name === name || x.for === name);

test('every bot, the Chief, the account default and the background calls are named with model, provider and reasoning level', async () => {
  const claude = await makeBot(srv, { name: 'On Claude', model: 'opus', effort: 'high' });
  await makeBot(srv, { name: 'On the default' });
  const r = await inUse();
  assert.deepEqual(Object.keys(r), ['accountDefault', 'chief', 'bots', 'background', 'note']);
  assert.deepEqual([r.accountDefault.provider, r.accountDefault.reasoning], ['Claude subscription', "the model's own"]);
  assert.equal(r.accountDefault.model, "Claude Code's own choice");
  const opus = by(r.bots, 'On Claude');
  assert.equal(opus.id, claude.id);
  assert.deepEqual([opus.model, opus.provider, opus.reasoning], ['Opus (latest)', 'Claude subscription', 'high']);
  assert.equal(by(r.bots, 'On the default').provider, 'Claude subscription');
  assert.ok(r.background.length >= 6);
  for (const what of ['Who a group message is for', "A group's notes", 'What a message to a busy bot is', "Explaining an app's error", "Each bot's weekly memory review, and the Chief's"]) assert.ok(by(r.background, what), what);
  assert.match(by(r.background, "Each bot's weekly memory review, and the Chief's").model, /Opus/, 'the review keeps its own model');
  assert.equal(by(r.background, "Each bot's weekly memory review, and the Chief's").reasoning, 'medium');
});

test('a provider\'s model shows its name, a bot of a removed provider shows the account default it really runs on, and nothing secret is in the answer', async () => {
  const saved = await srv.api('/setup/claude/provider', { method: 'PUT', body: { preset: 'custom', url, key: KEY, big: 'model-a', small: 'model-b' } });
  assert.equal(saved.status, 200);
  await makeBot(srv, { name: 'On the provider', model: 'provider:custom:model-a' });
  await srv.api('/settings', { method: 'PUT', body: { chiefModel: 'provider:custom:model-b', defaultModel: 'provider:custom:model-a' } });
  let r = await inUse();
  assert.deepEqual([r.accountDefault.model, r.accountDefault.provider], ['model-a', 'Other']);
  assert.deepEqual([r.chief.model, r.chief.provider], ['model-b', 'Other']);
  assert.equal(by(r.bots, 'On the provider').provider, 'Other');
  assert.equal(by(r.bots, 'On Claude').provider, 'Claude subscription', 'a bot on a Claude model stays on the subscription');
  // The short calls follow the account default's provider, its small model for a Haiku ask.
  const router = by(r.background, 'Who a group message is for');
  assert.deepEqual([router.model, router.provider], ['model-b', 'Other']);
  for (const secret of [KEY, url, '…wxyz', '127.0.0.1']) assert.ok(!JSON.stringify(r).includes(secret), 'no key or address');
  assert.ok(!/price|cost|\$/i.test(JSON.stringify(r.bots)), 'no price');

  assert.equal((await srv.api('/setup/claude/provider/custom', { method: 'DELETE' })).status, 200);
  r = await inUse();
  const gone = by(r.bots, 'On the provider');
  assert.equal(gone.provider, 'Claude subscription', 'what it really runs on now');
  assert.match(gone.note, /not available any more/);
  assert.match(r.chief.note || '', /not available any more/);
  // The account default was on that provider too, so there is no account default to fall back on: Claude Code's own choice.
  for (const note of [gone.note, r.chief.note, r.accountDefault.note]) {
    assert.match(note, /so it runs on Claude Code's own choice\.$/);
    assert.ok(!/account default/.test(note), 'it does not claim an account default it does not have');
  }
  assert.match(r.accountDefault.note, /It asked for model-a/);
  assert.equal(r.accountDefault.model, "Claude Code's own choice");
});

test('the Chief has one read-only tool for it, which reads that route', async (t) => {
  const requests = [];
  const api = http.createServer((req, res) => { requests.push([req.method, req.url]); res.setHeader('Content-Type', 'application/json'); res.end('{"bots":[]}'); });
  await new Promise((r) => api.listen(0, '127.0.0.1', r));
  const child = spawn(process.execPath, ['lib/mcp-server.js'], { cwd: ROOT, env: { PATH: process.env.PATH, BOT_DOT_URL: `http://127.0.0.1:${api.address().port}` } });
  t.after(() => { child.kill(); api.close(); });
  const waiting = new Map();
  let buf = '';
  child.stdout.on('data', (c) => { buf += c; let nl; while ((nl = buf.indexOf('\n')) >= 0) { const msg = JSON.parse(buf.slice(0, nl)); buf = buf.slice(nl + 1); waiting.get(msg.id)?.(msg); } });
  let id = 0;
  const call = (method, params) => new Promise((resolve) => { waiting.set(++id, resolve); child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`); });
  const tool = (await call('tools/list')).result.tools.find((x) => x.name === 'models_in_use');
  assert.ok(tool);
  assert.match(tool.description, /which model, LLM or provider/i);
  assert.deepEqual(tool.inputSchema.properties, {});
  await call('tools/call', { name: 'models_in_use', arguments: {} });
  assert.deepEqual(requests, [['GET', '/api/settings/models-in-use']]);
});

test('with the admin\'s Jev, the calls it is asked first for say so, and an API key is named as the Claude connection', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'models-in-use-'));
  try {
    const settings = require('../lib/settings').create(dir, {});
    const { build } = require('../lib/models-in-use');
    const jev = build({ settings, bots: [], reviewModel: 'opus', router: 'jev' });
    assert.deepEqual(jev.background.filter((c) => c.triedFirst).map((c) => c.for), ['Who a group message is for', 'What a message to a busy bot is']);
    assert.ok(!JSON.stringify(build({ settings, bots: [], reviewModel: 'opus', router: 'haiku' })).includes('Jev'));
    fs.writeFileSync(path.join(dir, 'claude-key.json'), JSON.stringify({ use: 'api-key', key: require('../lib/vault').encrypt('sk-ant-api03-0123456789abcdefghij'), hint: '…ghij' }));
    const keyed = build({ settings, bots: [{ id: 'x', name: 'X', model: 'sonnet', effort: '' }], reviewModel: 'opus', router: 'haiku' });
    assert.equal(keyed.bots[0].provider, 'Anthropic API key');
    assert.ok(!JSON.stringify(keyed).includes('ghij'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a bot of a removed provider, with a Claude account default, says it runs on that default', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'models-in-use-'));
  try {
    const settings = require('../lib/settings').create(dir, {});
    settings.update({ defaultModel: 'sonnet' });
    const { build } = require('../lib/models-in-use');
    const r = build({ settings, bots: [{ id: 'x', name: 'X', model: 'provider:custom:gone', effort: '' }], reviewModel: 'opus', router: 'haiku' });
    assert.match(r.bots[0].note, /so it runs on the account default, Sonnet \(latest\)\.$/);
    assert.equal(r.accountDefault.note, undefined);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the group router, the wake gate and the busy-bot call report the model the machine override makes them ask for', () => {
  const fs = require('fs');
  const os = require('os');
  const path = require('path');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'models-in-use-'));
  const vars = ['BOT_DOT_GROUP_ROUTER_MODEL', 'BOT_DOT_WAKE_GATE_MODEL', 'BOT_DOT_FOLLOW_UP_MODEL', 'BOT_DOT_WAKE_GATE'];
  const before = vars.map((v) => process.env[v]);
  try {
    const settings = require('../lib/settings').create(dir, {});
    const { build } = require('../lib/models-in-use');
    const label = (r, what) => r.background.find((c) => c.for === what)?.model;
    const names = ['Who a group message is for', 'Whether a note needs a run (the wake gate)', 'What a message to a busy bot is'];
    process.env.BOT_DOT_WAKE_GATE = 'on'; // the wake gate is listed only when it is on
    const asked = (id) => settings.describer()(settings.forHelper({ model: id })).model;
    process.env.BOT_DOT_GROUP_ROUTER_MODEL = 'claude-sonnet-5-5';
    process.env.BOT_DOT_WAKE_GATE_MODEL = 'claude-opus-5-5';
    process.env.BOT_DOT_FOLLOW_UP_MODEL = 'claude-fable-5-2';
    const r = build({ settings, bots: [], reviewModel: 'opus', router: 'haiku' });
    assert.deepEqual(names.map((n) => label(r, n)), ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-2'].map(asked));
    for (const v of vars.slice(0, 3)) delete process.env[v];
    const base = build({ settings, bots: [], reviewModel: 'opus', router: 'haiku' });
    assert.deepEqual(names.map((n) => label(base, n)), ['claude-haiku-5-5', 'claude-haiku-5-5', 'claude-haiku-5-5'].map(asked));
    assert.notDeepEqual(names.map((n) => label(r, n)), names.map((n) => label(base, n)), 'the override changes what is reported');
    // What is reported is what the call itself asks for: one helper per module, read by create too.
    process.env.BOT_DOT_GROUP_ROUTER_MODEL = 'claude-sonnet-5-5';
    process.env.BOT_DOT_WAKE_GATE_MODEL = 'claude-opus-5-5';
    process.env.BOT_DOT_FOLLOW_UP_MODEL = 'claude-fable-5-2';
    assert.deepEqual([require('../lib/group-router').modelOf(), require('../lib/wake-gate').modelOf(), require('../lib/follow-up').modelOf()], ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-fable-5-2']);
  } finally {
    vars.forEach((v, i) => { if (before[i] === undefined) delete process.env[v]; else process.env[v] = before[i]; });
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
