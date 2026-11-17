// Claude Code on another model provider (ADR 255; docs/api.md, Setup and updates): the owner saves DeepSeek, GLM,
// MiniMax, OpenCode Go, OpenRouter, Ollama or an address of their own in Settings → Claude; botdot checks it with a short
// real request (here a stand-in), keeps its key encrypted and never answers it whole; runs and Chief turns get its
// address, key and models in the variables Claude Code reads, a model asked for is turned into the provider's, and the
// Claude subscription is never sent to it.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { startServer, makeBot } = require('./helpers');
const providers = require('../lib/llm-providers');
const settingsLib = require('../lib/settings');

const KEY = 'sk-provider-test-KEY-0123456789-wxyz';
const REFUSED = 'sk-provider-refused-000000000';

const asked = [];
const stand = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let parsed = {};
    try { parsed = JSON.parse(body); } catch { /* none */ }
    asked.push({ method: req.method, url: req.url, auth: req.headers.authorization, xKey: req.headers['x-api-key'], model: parsed.model, max: parsed.max_tokens });
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (req.headers.authorization !== `Bearer ${KEY}` && req.headers.authorization !== 'Bearer none') return json(401, { error: { message: 'bad key' } });
    if (!['big-model', 'small-model'].includes(parsed.model)) return json(404, { error: { message: `no model ${parsed.model}` } });
    json(200, { content: [{ type: 'text', text: 'OK' }] });
  });
});

let srv;
let url;
before(async () => {
  await new Promise((r) => stand.listen(0, '127.0.0.1', r));
  url = `http://127.0.0.1:${stand.address().port}`;
  srv = await startServer({});
});
after(async () => { await srv?.stop(); stand.closeAllConnections(); stand.close(); });

const claude = async () => (await srv.api('/setup?fresh')).data.claude;
const save = (body) => srv.api('/setup/claude/provider', { method: 'PUT', body: { preset: 'custom', url, big: 'big-model', small: 'small-model', key: KEY, ...body } });
const runOf = async (bot, prompt) => {
  srv.reply('Done.');
  const r = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt } });
  await srv.finished(r.data.id);
  return srv.nextRun((x) => x.stdin.includes(prompt), `the run of "${prompt}"`);
};
const read = (f) => { try { return fs.statSync(f).isFile() ? fs.readFileSync(f, 'latin1') : ''; } catch { return ''; } };
const everything = () => [srv.log.join(''), ...fs.readdirSync(srv.data, { recursive: true }).map((f) => read(path.join(srv.data, f)))].join('\n');

test('the setup checklist offers the presets, and nothing is on a provider until one is saved', async () => {
  const s = (await srv.api('/setup')).data;
  assert.deepEqual(s.providers.map((p) => p.id), ['deepseek', 'glm', 'minimax', 'opencode-go', 'openrouter', 'ollama', 'custom']);
  assert.deepEqual(s.providers.find((p) => p.id === 'deepseek'), { id: 'deepseek', name: 'DeepSeek', url: 'https://api.deepseek.com/anthropic', big: 'deepseek-v4-pro', small: 'deepseek-flash' });
  assert.deepEqual(s.providers.find((p) => p.id === 'ollama'), { id: 'ollama', name: 'Ollama', url: '', big: '', small: '', keyless: true, askUrl: true }, 'no address to suggest: none of this machine\'s resolves inside the server\'s container');
  assert.deepEqual([s.claude.using, s.claude.provider], ['subscription', null]);
  assert.ok((await srv.api('/version')).data.features.includes('llm-provider'));
  const bot = await makeBot(srv, { name: 'Before Provider' });
  const run = await runOf(bot, 'no provider yet');
  assert.deepEqual(run.anthropic, {}, 'no provider variable');
});

test('a key the provider refuses, a model it does not know, a bad address or no key is not saved', async () => {
  const refused = await save({ key: REFUSED });
  assert.deepEqual([refused.status, refused.data.error], [400, 'It refused this key. Check that you copied all of it.']);
  const unknown = await save({ big: 'nope', small: 'nope' });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.data.error, "It doesn't know that address or model.");
  assert.equal((await save({ small: 'bad name!' })).data.error, "That isn't a model name.");
  assert.equal((await save({ key: '' })).status, 400);
  assert.equal((await save({ url: 'http://example.com/anthropic' })).data.error, 'A key goes over https. Plain http works only for this machine or your own network.');
  assert.equal((await save({ url: 'not an address' })).status, 400);
  assert.equal((await save({ preset: 'nothing' })).status, 400);
  assert.equal((await save({ preset: 'openrouter', big: '' })).data.error, 'Name the model bots run on.');
  const c = await claude();
  assert.deepEqual([c.using, c.provider], ['subscription', null]);
});

test('a saved provider is checked with a real request, kept encrypted and answered only as its last four', async () => {
  const r = await save({ key: `  ${KEY}\n` });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.claude.provider, { preset: 'custom', name: 'Other', key: '…wxyz', big: 'big-model', small: 'small-model' });
  assert.deepEqual([r.data.claude.using, r.data.claude.loggedIn, r.data.claude.subscription], ['provider', true, true]);
  const check = asked.find((a) => a.auth === `Bearer ${KEY}` && a.model === 'small-model');
  assert.deepEqual([check.method, check.url, check.max], ['POST', '/v1/messages', 16]);
  assert.doesNotMatch(JSON.stringify((await srv.api('/setup')).data), /sk-provider/, 'no answer holds the key');
  const file = path.join(srv.data, 'claude-key.json');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).provider.key).sort(), ['ct', 'iv', 'tag']);
  assert.doesNotMatch(everything(), new RegExp(KEY), 'neither the log nor any file in the data folder holds it in the clear');
});

test('runs and Chief turns go to the provider with its models, and get no subscription token', async () => {
  const bot = await makeBot(srv, { name: 'On The Provider' });
  const run = await runOf(bot, 'with the provider');
  assert.equal(run.anthropic.ANTHROPIC_BASE_URL, url);
  assert.equal(run.anthropic.ANTHROPIC_AUTH_TOKEN, KEY);
  assert.equal(run.anthropic.ANTHROPIC_API_KEY, '');
  assert.deepEqual([run.anthropic.ANTHROPIC_MODEL, run.anthropic.ANTHROPIC_DEFAULT_OPUS_MODEL, run.anthropic.ANTHROPIC_DEFAULT_SONNET_MODEL, run.anthropic.ANTHROPIC_DEFAULT_HAIKU_MODEL], ['big-model', 'big-model', 'big-model', 'small-model']);
  assert.equal(run.env.CLAUDE_CODE_OAUTH_TOKEN, undefined, 'no subscription token beside it');
  assert.equal(run.env.CLAUDE_CODE_DISABLE_EXPERIMENTAL_BETAS, '1');
  assert.equal(run.apiKey, null);

  srv.reply('Hello.');
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'chief on the provider' } });
  const turn = await srv.nextRun((x) => x.stdin.includes('chief on the provider'), 'the Chief turn');
  assert.equal(turn.anthropic.ANTHROPIC_BASE_URL, url);
  assert.equal(turn.env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
});

test('a model a bot asks for is the provider\'s, and no reasoning level is passed', async () => {
  const bot = await makeBot(srv, { name: 'Picks Model' });
  await srv.api(`/bots/${bot.id}`, { method: 'PUT', body: { model: 'opus', effort: 'high' } });
  const run = await runOf(bot, 'opus on the provider');
  const at = run.args.indexOf('--model');
  assert.equal(run.args[at + 1], 'big-model');
  assert.ok(!run.args.includes('--effort'));
  await srv.api(`/bots/${bot.id}`, { method: 'PUT', body: { model: 'claude-haiku-5-5' } });
  const small = await runOf(bot, 'haiku on the provider');
  assert.equal(small.args[small.args.indexOf('--model') + 1], 'small-model');
});

test('the owner picks which one runs use, and removing the provider goes back to the subscription', async () => {
  const bot = await makeBot(srv, { name: 'Switches Provider' });
  const sub = await srv.api('/setup/claude/use', { method: 'PUT', body: { use: 'subscription' } });
  assert.deepEqual([sub.status, sub.data.claude.using, sub.data.claude.provider.key], [200, 'subscription', '…wxyz'], 'the provider stays saved');
  assert.deepEqual((await runOf(bot, 'back on the subscription')).anthropic, {});

  assert.equal((await srv.api('/setup/claude/use', { method: 'PUT', body: { use: 'provider' } })).data.claude.using, 'provider');
  assert.equal((await runOf(bot, 'on the provider again')).anthropic.ANTHROPIC_BASE_URL, url);

  const gone = await srv.api('/setup/claude/provider', { method: 'DELETE' });
  assert.deepEqual([gone.status, gone.data.claude.using, gone.data.claude.provider], [200, 'subscription', null]);
  assert.deepEqual((await runOf(bot, 'provider removed')).anthropic, {});
  const none = await srv.api('/setup/claude/use', { method: 'PUT', body: { use: 'provider' } });
  assert.deepEqual([none.status, none.data.error], [400, 'Save a provider first.']);
});

test('a keyless provider (Ollama on this machine) is saved without a key', async () => {
  const r = await srv.api('/setup/claude/provider', { method: 'PUT', body: { preset: 'ollama', url, big: 'big-model', small: 'small-model' } });
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.claude.using, r.data.claude.provider.key], ['provider', null]);
  const run = await runOf(await makeBot(srv, { name: 'Local Model' }), 'keyless');
  assert.equal(run.anthropic.ANTHROPIC_AUTH_TOKEN, 'none');
  await srv.api('/setup/claude/provider', { method: 'DELETE' });
});

test('the models of a preset are its own unless the owner names others, and a small one falls back to the big', () => {
  const p = providers.clean({ preset: 'deepseek', key: 'abcdefgh' });
  assert.deepEqual([p.url, p.big, p.small], ['https://api.deepseek.com/anthropic', 'deepseek-v4-pro', 'deepseek-flash']);
  assert.equal(providers.clean({ preset: 'deepseek', key: 'abcdefgh', big: 'x-model' }).small, 'deepseek-flash');
  const o = providers.clean({ preset: 'openrouter', key: 'abcdefgh', big: 'vendor/model-a' });
  assert.deepEqual([o.big, o.small], ['vendor/model-a', 'vendor/model-a']);
  assert.equal(providers.clean({ preset: 'glm', key: 'abcdefgh', url: 'https://evil.example/x' }).url, 'https://api.z.ai/api/anthropic', 'a preset\'s address is not the request\'s');
  assert.equal(providers.cleanUrl('https://gateway.example.com/anthropic/'), 'https://gateway.example.com/anthropic');
  assert.equal(providers.cleanUrl('http://192.168.1.20:11434'), 'http://192.168.1.20:11434');
  assert.equal(providers.cleanUrl('http://ollama:11434'), 'http://ollama:11434', 'a name with no dot is on a private network');
  assert.throws(() => providers.cleanUrl('http://8.8.8.8/x'));
  assert.throws(() => providers.cleanUrl('http://example.com/x'));
  assert.throws(() => providers.cleanUrl('https://user:pw@example.com/x'));
});

test('settings.args turns a model into the provider\'s only while a provider is picked', () => {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'llm-args-'));
  try {
    const settings = settingsLib.create(dir, {});
    assert.deepEqual(settings.args({ model: 'opus', effort: 'high' }), ['--model', 'opus', '--effort', 'high'], 'as before without a provider');
    fs.writeFileSync(path.join(dir, 'claude-key.json'), JSON.stringify({ use: 'provider', provider: { url: 'https://x.example', big: 'b', small: 's' } }));
    assert.deepEqual(settings.args({ model: 'sonnet', effort: 'high' }), ['--model', 'b']);
    assert.deepEqual(settings.args({ model: 'haiku', effort: '' }), ['--model', 's']);
    assert.deepEqual(settings.args({ model: '', effort: 'high' }), [], 'no model: the provider\'s default in ANTHROPIC_MODEL');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
