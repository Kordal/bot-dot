// Claude on an Anthropic API key as well as a subscription (#35; docs/api.md, Setup and updates): the owner saves a
// key in Settings → Claude, botdot checks it with Anthropic (here a stand-in), keeps it encrypted with the Vault's
// key and never answers or logs it whole; runs and Chief turns get it in ANTHROPIC_API_KEY only while the owner
// picked it, and the setup checklist says which of the two is used when both are there.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { startServer, makeBot } = require('./helpers');

const KEY = 'sk-ant-api03-test-KEY-0123456789abcdefghij-wxyz';
const OTHER = 'sk-ant-api03-other-key-9876543210zyxwvutsrq-abcd';
const REFUSED = 'sk-ant-api03-refused-key-000000000000000000-0000';

// A stand-in for Anthropic's API: GET /v1/models answers 200 for a known key, 401 for any other.
const asked = [];
const anthropic = http.createServer((req, res) => {
  asked.push({ method: req.method, url: req.url, key: req.headers['x-api-key'], version: req.headers['anthropic-version'] });
  const ok = [KEY, OTHER].includes(req.headers['x-api-key']);
  res.writeHead(ok ? 200 : 401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(ok ? { data: [{ id: 'claude-x' }] } : { type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } }));
});

let srv;
before(async () => {
  await new Promise((r) => anthropic.listen(0, '127.0.0.1', r));
  srv = await startServer({ env: { BOT_DOT_ANTHROPIC_API_URL: `http://127.0.0.1:${anthropic.address().port}` } });
});
after(async () => { await srv?.stop(); anthropic.closeAllConnections(); anthropic.close(); });

const claude = async () => (await srv.api('/setup?fresh')).data.claude;
const runOf = async (bot, prompt) => {
  srv.reply('Done.');
  const r = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt } });
  await srv.finished(r.data.id);
  return srv.nextRun((x) => x.stdin.includes(prompt), `the run of "${prompt}"`);
};
// The server's log and every file in its data folder (one a run removes meanwhile is skipped).
const read = (f) => { try { return fs.statSync(f).isFile() ? fs.readFileSync(f, 'latin1') : ''; } catch { return ''; } };
const everything = () => [srv.log.join(''), ...fs.readdirSync(srv.data, { recursive: true }).map((f) => read(path.join(srv.data, f)))].join('\n');

test('a subscription only, as before: runs get no API key, and setup says the subscription is used', async () => {
  const c = await claude();
  assert.deepEqual([c.loggedIn, c.using, c.apiKey, c.subscription], [true, 'subscription', null, true]);
  const bot = await makeBot(srv, { name: 'Before Key' });
  assert.equal((await runOf(bot, 'no key yet')).apiKey, null);
});

test('a key Anthropic refuses, or one that is no Anthropic key, is not saved', async () => {
  const refused = await srv.api('/setup/claude/key', { method: 'PUT', body: { key: REFUSED } });
  assert.deepEqual([refused.status, refused.data.error], [400, 'Anthropic refused this API key. Check that you copied all of it.']);
  const wrong = await srv.api('/setup/claude/key', { method: 'PUT', body: { key: 'hello there' } });
  assert.equal(wrong.status, 400);
  assert.match(wrong.data.error, /^That isn't an Anthropic API key: it starts with sk-ant-\./);
  assert.equal(asked.filter((a) => a.key === 'hello there').length, 0, 'not even sent to Anthropic');
  const c = await claude();
  assert.deepEqual([c.using, c.apiKey], ['subscription', null]);
});

test('a saved key is checked with Anthropic, kept encrypted, answered only as its last four, and runs and the Chief get it', async () => {
  const r = await srv.api('/setup/claude/key', { method: 'PUT', body: { key: `  ${KEY}\n` } });
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.claude.using, r.data.claude.apiKey, r.data.claude.loggedIn, r.data.claude.subscription], ['api-key', '…wxyz', true, true]);
  const check = asked.find((a) => a.key === KEY);
  assert.deepEqual([check.method, check.url, check.version], ['GET', '/v1/models?limit=1', '2023-06-01']);

  const c = await claude();
  assert.deepEqual([c.using, c.apiKey, c.loggedIn], ['api-key', '…wxyz', true]);
  assert.doesNotMatch(JSON.stringify((await srv.api('/setup')).data), /sk-ant/, 'no answer holds the key');
  const stored = JSON.parse(fs.readFileSync(path.join(srv.data, 'claude-key.json'), 'utf8'));
  assert.equal(fs.statSync(path.join(srv.data, 'claude-key.json')).mode & 0o777, 0o600);
  assert.deepEqual(Object.keys(stored.key).sort(), ['ct', 'iv', 'tag'], 'encrypted as the Vault encrypts');

  const bot = await makeBot(srv, { name: 'On The Key' });
  const run = await runOf(bot, 'with the key');
  assert.equal(run.apiKey, KEY);
  assert.equal(run.env.CLAUDE_CODE_OAUTH_TOKEN, undefined, 'and no subscription token beside it');

  srv.reply('Hello.');
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'chief on the key' } });
  assert.equal((await srv.nextRun((x) => x.stdin.includes('chief on the key'), 'the Chief turn')).apiKey, KEY);

  assert.doesNotMatch(everything(), new RegExp(KEY), 'neither the log nor any file in the data folder holds it in the clear');
});

test('the owner picks which one runs use when both are there, and removing the key goes back to the subscription', async () => {
  const bot = await makeBot(srv, { name: 'Switches' });
  const sub = await srv.api('/setup/claude/use', { method: 'PUT', body: { use: 'subscription' } });
  assert.deepEqual([sub.status, sub.data.claude.using, sub.data.claude.apiKey], [200, 'subscription', '…wxyz'], 'the key stays saved');
  assert.equal((await runOf(bot, 'back on the subscription')).apiKey, null);

  const back = await srv.api('/setup/claude/use', { method: 'PUT', body: { use: 'api-key' } });
  assert.equal(back.data.claude.using, 'api-key');
  assert.equal((await runOf(bot, 'on the key again')).apiKey, KEY);
  assert.equal((await srv.api('/setup/claude/use', { method: 'PUT', body: { use: 'something' } })).status, 400);

  // A new key replaces the old one.
  assert.equal((await srv.api('/setup/claude/key', { method: 'PUT', body: { key: OTHER } })).data.claude.apiKey, '…abcd');
  assert.equal((await runOf(bot, 'on the other key')).apiKey, OTHER);

  const gone = await srv.api('/setup/claude/key', { method: 'DELETE' });
  assert.deepEqual([gone.status, gone.data.claude.using, gone.data.claude.apiKey], [200, 'subscription', null]);
  assert.equal((await runOf(bot, 'key removed')).apiKey, null);
  const none = await srv.api('/setup/claude/use', { method: 'PUT', body: { use: 'api-key' } });
  assert.deepEqual([none.status, none.data.error], [400, 'Save an Anthropic API key first.']);
});

test('on the key, a signed-out subscription still lets bots run', async () => {
  await srv.api('/setup/claude/key', { method: 'PUT', body: { key: KEY } });
  fs.writeFileSync(path.join(srv.out, 'signed-out'), '');
  try {
    const c = await claude();
    assert.deepEqual([c.using, c.loggedIn, c.subscription], ['api-key', true, false], 'ready, on the key');
    const bot = await makeBot(srv, { name: 'No Subscription' });
    assert.equal((await runOf(bot, 'no subscription at all')).apiKey, KEY);
  } finally { fs.rmSync(path.join(srv.out, 'signed-out'), { force: true }); }
  assert.ok((await srv.api('/version')).data.features.includes('claude-api-key'));
  await srv.api('/setup/claude/key', { method: 'DELETE' });
});
