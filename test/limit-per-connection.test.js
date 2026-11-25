// A usage limit holds only the runs that go on the connection that reached it (ADR 267 amended, #1668): Claude's
// limit the runs on the Claude connection, a provider's limit that provider's runs, and a sign-out of the subscription
// the Claude runs only. The apps are told each held connection (`held` of the `claude` event); a held run says which
// connection it waits for. A different credential of a connection ends its hold, and no other's.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { startServer, makeBot, heldRun, feed, waitFor } = require('./helpers');
const claudeKeyLib = require('../lib/claude-key');

const SUBSCRIPTION = 'subscription-token-AAAA';
const KEY_A = 'sk-first-provider-KEY-0123456789-wxyz';
const KEY_A2 = 'sk-first-provider-KEY-replaced-9876-qrst';
const API_KEY = 'sk-ant-api03-limit-0123456789abcdefghij';

const providerStand = http.createServer((req, res) => {
  const ok = [`Bearer ${KEY_A}`, `Bearer ${KEY_A2}`].includes(req.headers.authorization);
  res.writeHead(ok ? 200 : 401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ data: [{ id: 'model-a' }, { id: 'model-b' }], content: [{ type: 'text', text: 'OK' }] }));
});
const anthropicStand = http.createServer((req, res) => {
  res.writeHead(req.headers['x-api-key'] === API_KEY ? 200 : 401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ data: [{ id: 'claude-x' }], has_more: false }));
});

let srv;
let f;
let onProvider;
let onClaude;
before(async () => {
  await Promise.all([providerStand, anthropicStand].map((s) => new Promise((r) => s.listen(0, '127.0.0.1', r))));
  srv = await startServer({ env: { CLAUDE_CODE_OAUTH_TOKEN: SUBSCRIPTION, BOT_DOT_ANTHROPIC_API_URL: `http://127.0.0.1:${anthropicStand.address().port}` } });
  f = await feed(srv);
  const saved = await srv.api('/setup/claude/provider', { method: 'PUT', body: { preset: 'custom', url: `http://127.0.0.1:${providerStand.address().port}`, key: KEY_A, big: 'model-a', small: 'model-b' } });
  assert.equal(saved.status, 200);
  onProvider = await makeBot(srv, { name: 'On provider', model: 'provider:custom:model-a' });
  onClaude = await makeBot(srv, { name: 'On Claude' });
});
after(async () => { f?.close(); await srv?.stop(); for (const s of [providerStand, anthropicStand]) { s.closeAllConnections(); s.close(); } });

// The connection reaches its limit: a run of `bot` ends with the words Claude Code says, resetting `inSeconds` from now.
const hitLimit = async (bot, inSeconds) => {
  // Nothing of an earlier step is still running: the words below are for this run alone.
  await waitFor(async () => (await srv.api('/runs')).data.every((x) => x.status !== 'running'), { what: 'the runs to end' });
  const said = path.join(srv.out, 'error-result.txt');
  fs.writeFileSync(said, `Claude AI usage limit reached|${Math.ceil(Date.now() / 1000) + inSeconds}`);
  try {
    const r = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: `hit the limit ${bot.name}` } });
    return await srv.finished(r.data.id);
  } finally { fs.rmSync(said, { force: true }); }
};
const heldNow = () => f.events.filter((e) => e.type === 'claude').at(-1)?.data;
const ask = async (bot, prompt) => srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt } });

test('a provider\'s limit holds that provider\'s runs only, and the apps hear which connection it is', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('connection-limits'));
  const ended = await hitLimit(onProvider, 3600);
  assert.equal(ended.status, 'error');
  assert.equal(ended.carriesOnAfterLimit, true, 'the run that hit it carries on after the reset');
  assert.equal(ended.limitOf, 'Other');
  assert.equal(ended.problem, "Other's usage limit was reached, so I stopped. I'll carry on by myself once it resets.", 'the provider is named, not Claude');
  const told = (await f.wait('claude', (d) => (d.held || []).some((h) => h.connection === 'custom'))).data;
  assert.deepEqual(told.held.map((h) => [h.connection, h.name, typeof h.backAt]), [['custom', 'Other', 'string']]);
  assert.equal(told.backAt, undefined, 'the account default is Claude: an app from before is told of no limit');
  assert.equal(told.loggedIn, true);

  // Its bot's message waits, naming the connection; a bot on Claude, and the Chief, run as they did.
  const waits = (await ask(onProvider, 'for the provider, after the limit')).data;
  assert.equal(waits.status, 'queued');
  const says = await srv.api(`/bots/${onProvider.id}/queued/${waits.id}/steer`, { method: 'POST' });
  assert.equal(says.data.error, "Other's usage limit was reached: On provider reads this once it resets.", 'a held message says which connection it waits for');
  srv.reply('Done.');
  const free = await ask(onClaude, 'for claude, while the provider waits');
  assert.notEqual(free.data.status, 'queued', 'a run on Claude is not held');
  assert.equal((await srv.finished(free.data.id)).status, 'success');
  srv.reply('Hello.');
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  const sent = (await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'the chief while the provider waits' } })).data;
  assert.ok(!sent.queued?.length, 'the Chief runs on Claude: its message does not wait');
  assert.ok(await srv.nextRun((x) => x.stdin.includes('the chief while the provider waits'), 'the Chief turn'));
  assert.ok(!srv.runs().some((x) => x.stdin?.includes('for the provider, after the limit')), 'nothing of the provider started');

  // A key of the provider that is a different one starts without the hold: what waited goes on. Claude's was never held.
  const replaced = await srv.api('/setup/claude/provider', { method: 'PUT', body: { preset: 'custom', url: `http://127.0.0.1:${providerStand.address().port}`, key: KEY_A2, big: 'model-a', small: 'model-b' } });
  assert.equal(replaced.status, 200);
  assert.ok(await srv.nextRun((x) => x.stdin.includes('for the provider, after the limit'), 'the waiting message of the provider'));
  await waitFor(() => !(heldNow()?.held || []).length, { what: 'the event that nothing is held' });
});

test('Claude\'s limit holds the Claude runs only: the Chief and a bot on Claude wait, a bot on a provider runs', async () => {
  const ended = await hitLimit(onClaude, 3600);
  assert.equal(ended.carriesOnAfterLimit, true);
  assert.equal(ended.limitOf, undefined);
  assert.match(ended.problem, /^Claude's usage limit was reached/);
  const claudeAt = (await f.wait('claude', (d) => !!d.backAt && !(d.held || []).length)).data;
  assert.equal(claudeAt.held, undefined, 'the account default runs on Claude: its limit is `backAt`, as an app from before reads it');
  assert.ok(Date.parse(claudeAt.backAt) > Date.now());

  const waits = (await ask(onClaude, 'for claude, after the limit')).data;
  assert.equal(waits.status, 'queued');
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  const sent = (await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'the chief after the limit' } })).data;
  assert.equal(sent.queued.length, 1, 'the Chief runs on Claude: its message waits');
  srv.reply('Done.');
  const free = await ask(onProvider, 'for the provider, while claude waits');
  assert.notEqual(free.data.status, 'queued', 'a run on the provider is not held');
  assert.equal((await srv.finished(free.data.id)).status, 'success');
  assert.ok(!srv.runs().some((x) => x.stdin?.includes('for claude, after the limit') || x.stdin?.includes('the chief after the limit')));

  // Only a different Claude credential ends it: a provider saved or replaced does not.
  const other = await srv.api('/setup/claude/provider', { method: 'PUT', body: { preset: 'custom', url: `http://127.0.0.1:${providerStand.address().port}`, key: KEY_A, big: 'model-a', small: 'model-b' } });
  assert.equal(other.status, 200);
  assert.ok(heldNow().backAt, 'a provider\'s key does not release Claude');
  assert.equal((await srv.api('/setup/claude/key', { method: 'PUT', body: { key: API_KEY } })).status, 200);
  assert.ok(await srv.nextRun((x) => x.stdin.includes('for claude, after the limit'), 'the waiting message on Claude'));
  assert.ok(await srv.nextRun((x) => x.stdin.includes('the chief after the limit'), 'the Chief turn'));
  await srv.api('/setup/claude/use', { method: 'PUT', body: { use: 'subscription' } });
});

test('the limits of two connections are held and ended apart', async () => {
  await hitLimit(onProvider, 3600);
  await hitLimit(onClaude, 3600);
  await waitFor(() => (heldNow()?.held || []).some((h) => h.connection === 'custom') && heldNow().backAt, { what: 'both limits told' });
  assert.deepEqual(heldNow().held.map((h) => h.connection), ['custom'], 'the other connection beside the account default\'s `backAt`');
  // Removing the provider ends its hold, and not Claude's.
  assert.equal((await srv.api('/setup/claude/provider/custom', { method: 'DELETE' })).status, 200);
  await waitFor(() => (heldNow().held || []).length === 0, { what: 'the provider\'s line to go' });
  assert.ok(heldNow().backAt, 'Claude is still held');
});

test('signing out of the subscription stops and holds the Claude runs, and not a bot on a provider', async (t) => {
  const own = await startServer({ env: { BOT_DOT_RUNS_MAX: '1', BOT_DOT_ANTHROPIC_API_URL: `http://127.0.0.1:${anthropicStand.address().port}` } }); // one run of a bot at a time: its next message waits
  const signedOut = path.join(own.out, 'signed-out');
  const ownFeed = await feed(own);
  t.after(async () => { fs.rmSync(signedOut, { force: true }); own.unhold(); ownFeed.close(); await own.stop(); });
  assert.equal((await own.api('/setup/claude/provider', { method: 'PUT', body: { preset: 'custom', url: `http://127.0.0.1:${providerStand.address().port}`, key: KEY_A, big: 'model-a', small: 'model-b' } })).status, 200);
  const claudeBot = await makeBot(own, { name: 'Claude bot', emoji: '🅲', model: 'opus' });
  const providerBot = await makeBot(own, { name: 'Provider bot', emoji: '🅿', model: 'provider:custom:model-a' });
  assert.equal((await own.api('/settings', { method: 'PUT', body: { defaultModel: 'provider:custom:model-a' } })).status, 200); // the account default is a provider
  const going = await heldRun(own, claudeBot, 'Something long on claude');
  const staying = await heldRun(own, providerBot, 'Something long on the provider');
  const waits = (await own.api(`/bots/${claudeBot.id}/run`, { method: 'POST', body: { prompt: 'And this, on claude' } })).data;
  assert.equal(waits.status, 'queued');

  fs.writeFileSync(signedOut, '');
  const out = await own.api('/setup/claude', { method: 'DELETE' });
  assert.deepEqual([out.status, out.data.stopped], [200, 1], 'the run on Claude is stopped although the account default is a provider, and the provider\'s is not');
  const ended = await own.finished(going.run.id);
  assert.deepEqual([ended.status, ended.endedBy], ['error', 'signout']);
  const held = (await ownFeed.wait('claude', (d) => (d.held || []).some((h) => h.signedOut))).data;
  assert.deepEqual(held.held.map((h) => [h.connection, h.name, h.signedOut]), [['claude', 'Claude', true]]);
  assert.equal(held.loggedIn, true, 'what the account default runs on is not signed out');
  await new Promise((r) => setTimeout(r, 100)); // past the moment the queue would have gone on
  assert.equal((await own.api(`/runs/${waits.id}?events=0`)).data.status, 'queued', 'a bot on Claude waits for the sign-in');
  assert.equal((await own.api(`/runs/${staying.run.id}?events=0`)).data.status, 'running', 'the bot on the provider goes on');
  const sentence = (await own.api(`/bots/${claudeBot.id}/queued/${waits.id}/steer`, { method: 'POST' })).data;
  assert.match(sentence.error, /^Claude is signed out: Claude bot reads this once it is signed in\.$/, 'a held message says which connection it waits for');

  // Signed in again, which the server learns as Setup is opened: what waited starts.
  fs.rmSync(signedOut);
  own.unhold();
  assert.equal((await own.api('/setup?fresh')).data.claude.loggedIn, true);
  assert.ok(await own.nextRun((x) => x.stdin.startsWith('And this, on claude'), 'the waiting message to start'));
});

test('each connection has its credential: the Claude key, and a provider\'s address and key', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'limit-credentials-'));
  try {
    const key = claudeKeyLib.create(dir);
    assert.deepEqual(key.credentials(), { claude: null });
    const file = (providers) => fs.writeFileSync(path.join(dir, 'claude-key.json'), JSON.stringify({ providers }));
    file({ custom: { preset: 'custom', url: 'https://x.example', big: 'b', small: 's' } });
    const one = key.credentials();
    assert.deepEqual(Object.keys(one), ['claude', 'custom']);
    file({ custom: { preset: 'custom', url: 'https://y.example', big: 'b', small: 's' } });
    assert.notEqual(key.credentials().custom, one.custom, 'another address is another credential');
    assert.equal(key.credentials().claude, one.claude);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
