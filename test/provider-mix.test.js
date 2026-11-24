// Several model providers beside Claude, a bot's model deciding which one it runs on (ADR 267, #1664; docs/api.md,
// Another model provider). Two providers are saved and the Claude subscription is signed in: the Chief, bot A and bot B
// each run on a different one at once, and each process's environment holds its own connection's credential and
// nothing of another's. Removing a provider sends its bots to the account default; an account saved with one provider,
// as before ADR 267, keeps running on it.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { startServer, makeBot } = require('./helpers');
const settingsLib = require('../lib/settings');
const claudeKeyLib = require('../lib/claude-key');

const SUBSCRIPTION = 'subscription-token-AAAA';
const KEY_A = 'sk-first-provider-KEY-0123456789-wxyz';
const KEY_B = 'sk-second-provider-KEY-9876543210-abcd';
const API_KEY = 'sk-ant-api03-mix-0123456789abcdefghij';

// One stand-in for both providers: it answers a short request for a model it knows to the key it knows. The path says
// which provider it is.
const providerStand = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    let parsed = {};
    try { parsed = JSON.parse(body); } catch { /* none */ }
    const key = req.headers.authorization;
    const owns = req.url.startsWith('/first/') ? key === `Bearer ${KEY_A}` : req.url.startsWith('/second/') ? key === `Bearer ${KEY_B}` : false;
    if (req.url.endsWith('/v1/models') || req.url.endsWith('/api/tags')) return json(owns ? 200 : 401, { data: [{ id: 'model-a' }, { id: 'model-b' }] });
    if (!owns) return json(401, { error: { message: 'bad key' } });
    if (!['model-a', 'model-b'].includes(parsed.model)) return json(404, {});
    json(200, { content: [{ type: 'text', text: 'OK' }] });
  });
});
const anthropicStand = http.createServer((req, res) => {
  const ok = req.headers['x-api-key'] === API_KEY;
  res.writeHead(ok ? 200 : 401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ data: [{ id: 'claude-x' }], has_more: false }));
});

let srv;
let first;
let second;
before(async () => {
  await Promise.all([providerStand, anthropicStand].map((s) => new Promise((r) => s.listen(0, '127.0.0.1', r))));
  const base = `http://127.0.0.1:${providerStand.address().port}`;
  first = `${base}/first`;
  second = `${base}/second`;
  srv = await startServer({ env: { CLAUDE_CODE_OAUTH_TOKEN: SUBSCRIPTION, BOT_DOT_ANTHROPIC_API_URL: `http://127.0.0.1:${anthropicStand.address().port}` } });
});
after(async () => { await srv?.stop(); for (const s of [providerStand, anthropicStand]) { s.closeAllConnections(); s.close(); } });

const connect = (preset, url, key) => srv.api('/setup/claude/provider', { method: 'PUT', body: { preset, url, key, big: 'model-a', small: 'model-b' } });
const runOf = async (bot, prompt) => {
  srv.reply('Done.');
  const r = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt } });
  await srv.finished(r.data.id);
  return srv.nextRun((x) => x.stdin.includes(prompt), `the run of "${prompt}"`);
};
const chiefTurn = async (text) => {
  srv.reply('Hello.');
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text } });
  return srv.nextRun((x) => x.stdin.includes(text), `the Chief turn "${text}"`);
};
// What the process was started with of every connection: nothing of a connection it does not run on.
const holds = (run, secret) => run.envText.includes(secret);

test('two providers are saved beside Claude without moving anything, and the apps are told of both', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('provider-mix'));
  const one = await connect('custom', first, KEY_A);
  assert.equal(one.status, 200);
  const two = await connect('ollama', second, KEY_B); // a keyed address on the preset that has a place of its own
  assert.equal(two.status, 200);
  const { using, provider, providers } = two.data.claude;
  assert.deepEqual([using, provider], ['subscription', null], 'the account default is still Claude: saving a provider picks nothing');
  assert.deepEqual(providers.map((p) => [p.preset, p.name, p.key, p.big, p.small]), [['custom', 'Other', '…wxyz', 'model-a', 'model-b'], ['ollama', 'Ollama', '…abcd', 'model-a', 'model-b']]);
  const { models, providers: listed } = (await srv.api('/settings')).data;
  assert.deepEqual(listed.map((p) => p.preset), ['ollama', 'custom'], 'by name');
  assert.deepEqual([...new Set(models.map((m) => m.group))].slice(-2), ['Ollama', 'Other'], 'Claude first, then each connected provider by name');
  assert.deepEqual(models.filter((m) => m.group === 'Other').map((m) => m.id), ['provider:custom:model-a', 'provider:custom:model-b']);
  assert.ok(models.find((m) => m.id === 'opus'), 'Claude\'s models stay in the list');
  assert.doesNotMatch(JSON.stringify((await srv.api('/setup')).data), /sk-first|sk-second/, 'no answer holds a key');
});

test('the Chief, bot A and bot B run on the subscription and on each provider at the same time, each with its own credential only', async () => {
  const [a, b] = await Promise.all([
    makeBot(srv, { name: 'Bot A', model: 'provider:custom:model-a' }),
    makeBot(srv, { name: 'Bot B', model: 'provider:ollama:model-b' }),
  ]);
  const settled = await srv.api('/settings', { method: 'PUT', body: { chiefModel: 'sonnet' } });
  assert.equal(settled.data.settings.chiefModel, 'sonnet');

  const turn = await chiefTurn('the chief on claude');
  assert.equal(turn.env.CLAUDE_CODE_OAUTH_TOKEN, SUBSCRIPTION, 'the Chief runs on the subscription');
  assert.deepEqual(turn.anthropic, {}, '… with no provider\'s address, token or model');
  for (const secret of [KEY_A, KEY_B, first, second]) assert.ok(!holds(turn, secret), 'the Chief holds nothing of a provider');

  const runA = await runOf(a, 'bot a on the first provider');
  assert.equal(runA.anthropic.ANTHROPIC_BASE_URL, first);
  assert.equal(runA.anthropic.ANTHROPIC_AUTH_TOKEN, KEY_A);
  assert.equal(runA.anthropic.ANTHROPIC_API_KEY, '');
  assert.equal(runA.args[runA.args.indexOf('--model') + 1], 'model-a');
  assert.equal(runA.env.CLAUDE_CODE_OAUTH_TOKEN, undefined, 'no subscription token on a provider\'s run');
  assert.ok(!holds(runA, KEY_B) && !holds(runA, second) && !holds(runA, SUBSCRIPTION), 'nor the other provider\'s key or address');

  const runB = await runOf(b, 'bot b on the second provider');
  assert.equal(runB.anthropic.ANTHROPIC_BASE_URL, second);
  assert.equal(runB.anthropic.ANTHROPIC_AUTH_TOKEN, KEY_B);
  assert.equal(runB.args[runB.args.indexOf('--model') + 1], 'model-b');
  assert.equal(runB.env.CLAUDE_CODE_OAUTH_TOKEN, undefined);
  assert.ok(!holds(runB, KEY_A) && !holds(runB, first) && !holds(runB, SUBSCRIPTION));

  const onClaude = await runOf(await makeBot(srv, { name: 'Bot C' }), 'bot c on claude');
  assert.equal(onClaude.env.CLAUDE_CODE_OAUTH_TOKEN, SUBSCRIPTION);
  assert.deepEqual(onClaude.anthropic, {});
  for (const secret of [KEY_A, KEY_B, first, second]) assert.ok(!holds(onClaude, secret), 'a Claude run holds nothing of a provider');
});

test('a run on each connection in the same moment keeps to its own', async () => {
  const bots = await Promise.all([
    makeBot(srv, { name: 'Parallel A', model: 'provider:custom:model-a' }),
    makeBot(srv, { name: 'Parallel B', model: 'provider:ollama:model-b' }),
    makeBot(srv, { name: 'Parallel C', model: 'opus' }),
  ]);
  srv.reply('Done.');
  const started = await Promise.all(bots.map((bot, i) => srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: `at once ${i}` } })));
  await Promise.all(started.map((r) => srv.finished(r.data.id)));
  const [ra, rb, rc] = await Promise.all([0, 1, 2].map((i) => srv.nextRun((x) => x.stdin.includes(`at once ${i}`), `run ${i}`)));
  assert.deepEqual([ra.anthropic.ANTHROPIC_BASE_URL, rb.anthropic.ANTHROPIC_BASE_URL, rc.anthropic.ANTHROPIC_BASE_URL], [first, second, undefined]);
  assert.deepEqual([ra.env.CLAUDE_CODE_OAUTH_TOKEN, rb.env.CLAUDE_CODE_OAUTH_TOKEN, rc.env.CLAUDE_CODE_OAUTH_TOKEN], [undefined, undefined, SUBSCRIPTION]);
});

test('the account default model, and a provider\'s model on the Chief, send those runs to that provider', async () => {
  await srv.api('/settings', { method: 'PUT', body: { defaultModel: 'provider:ollama:model-a', chiefModel: 'provider:custom:model-b' } });
  const old = (await srv.api('/setup')).data.claude;
  assert.deepEqual([old.using, old.provider.preset, old.loggedIn], ['provider', 'ollama', true], 'an app that knows one provider reads the account default\'s');
  const read = (await srv.api('/settings')).data;
  assert.deepEqual([read.provider.name, read.provider.main, read.provider.helper], ['Ollama', 'provider:ollama:model-a', 'provider:ollama:model-b'], 'and so does the settings answer');
  const turn = await chiefTurn('the chief on the first provider');
  assert.equal(turn.anthropic.ANTHROPIC_BASE_URL, first);
  assert.equal(turn.anthropic.ANTHROPIC_AUTH_TOKEN, KEY_A);
  assert.ok(!holds(turn, KEY_B) && !holds(turn, SUBSCRIPTION));
  const noModel = await runOf(await makeBot(srv, { name: 'Follows Default' }), 'follows the account default');
  assert.equal(noModel.anthropic.ANTHROPIC_BASE_URL, second, 'a bot with no model of its own runs on the account default\'s provider');
  assert.ok(!holds(noModel, KEY_A) && !holds(noModel, SUBSCRIPTION));
  const claudeNamed = await runOf(await makeBot(srv, { name: 'Wants Claude', model: 'sonnet' }), 'asks for a claude model');
  assert.deepEqual(claudeNamed.anthropic, {}, 'a Claude name runs on Claude, whatever the default is');
  assert.equal(claudeNamed.env.CLAUDE_CODE_OAUTH_TOKEN, SUBSCRIPTION);
});

test('on an Anthropic API key, a Claude run gets the key and no provider\'s, and a provider run gets no Anthropic key', async () => {
  const saved = await srv.api('/setup/claude/key', { method: 'PUT', body: { key: API_KEY } });
  assert.equal(saved.status, 200);
  assert.deepEqual([saved.data.claude.apiKey, saved.data.claude.providers.length], ['…ghij', 2], 'the providers stay saved');
  const claudeRun = await runOf(await makeBot(srv, { name: 'On The Key', model: 'opus' }), 'claude on the api key');
  assert.equal(claudeRun.apiKey, API_KEY);
  assert.equal(claudeRun.env.CLAUDE_CODE_OAUTH_TOKEN, undefined, 'no subscription token beside the key');
  assert.deepEqual(Object.keys(claudeRun.anthropic), ['ANTHROPIC_API_KEY']);
  for (const secret of [KEY_A, KEY_B, first, second]) assert.ok(!holds(claudeRun, secret));
  const providerRun = await runOf(await makeBot(srv, { name: 'Provider With Key', model: 'provider:custom:model-a' }), 'provider with an api key saved');
  assert.equal(providerRun.anthropic.ANTHROPIC_API_KEY, '', 'Claude Code sends the provider\'s token, not an Anthropic key');
  assert.equal(providerRun.apiKey, null);
  assert.ok(!holds(providerRun, API_KEY) && !holds(providerRun, SUBSCRIPTION) && !holds(providerRun, KEY_B));
  await srv.api('/setup/claude/key', { method: 'DELETE' });
});

test('removing a provider sends its bots to the account default, and the account default of a removed provider to Claude', async () => {
  const bot = await makeBot(srv, { name: 'Loses Provider', model: 'provider:custom:model-a' });
  assert.equal((await runOf(bot, 'before the removal')).anthropic.ANTHROPIC_BASE_URL, first);
  const gone = await srv.api('/setup/claude/provider/custom', { method: 'DELETE' });
  assert.deepEqual(gone.data.claude.providers.map((p) => p.preset), ['ollama']);
  const after = await runOf(bot, 'after the removal');
  assert.equal(after.anthropic.ANTHROPIC_BASE_URL, second, 'the account default is the other provider\'s');
  assert.equal(after.anthropic.ANTHROPIC_AUTH_TOKEN, KEY_B);
  assert.ok(!holds(after, KEY_A), 'the removed provider\'s key is nowhere');
  const chief = await chiefTurn('the chief after its provider went');
  assert.equal(chief.anthropic.ANTHROPIC_BASE_URL, second, 'the Chief\'s model was the removed provider\'s: it falls back to the account default, which is the other provider\'s');
  assert.ok(!holds(chief, KEY_A));
  await srv.api('/setup/claude/provider/ollama', { method: 'DELETE' });
  const last = await runOf(bot, 'no provider left');
  assert.deepEqual(last.anthropic, {}, 'the account default was the removed provider\'s: Claude');
  assert.equal(last.env.CLAUDE_CODE_OAUTH_TOKEN, SUBSCRIPTION);
  assert.ok(!last.args.includes('model-a'));
  assert.deepEqual((await srv.api('/setup')).data.claude.providers, []);
  await srv.api('/settings', { method: 'PUT', body: { defaultModel: '', chiefModel: '' } });
});

test('removing a provider that is not saved, or naming none, is 404 and changes nothing', async () => {
  assert.equal((await connect('ollama', second, KEY_B)).status, 200);
  for (const segment of ['glm', 'models', 'nope']) {
    const gone = await srv.api(`/setup/claude/provider/${segment}`, { method: 'DELETE' });
    assert.equal(gone.status, 404, segment);
    assert.equal(gone.data.error, "That provider isn't connected.");
  }
  assert.deepEqual((await srv.api('/setup')).data.claude.providers.map((p) => p.preset), ['ollama'], 'the saved one is still there');
  const removed = await srv.api('/setup/claude/provider/ollama', { method: 'DELETE' });
  assert.equal(removed.status, 200, 'a saved one still goes');
  assert.deepEqual(removed.data.claude.providers, []);
});

test('an account saved with one provider before ADR 267 keeps running on it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mix-legacy-'));
  try {
    // As it was written then: the one provider, picked.
    fs.writeFileSync(path.join(dir, 'claude-key.json'), JSON.stringify({ use: 'provider', provider: { preset: 'ollama', name: 'Ollama', url: 'http://ollama:11434', big: 'qwen3:8b', small: 'qwen3:1b', savedAt: '2026-11-17T10:00:00.000Z' } }));
    const settings = settingsLib.create(dir, {});
    const model = 'provider:ollama:qwen3:8b';
    assert.equal(settings.get().defaultModel, model, 'that provider\'s main model is the account default');
    assert.deepEqual(settings.forBot({ model: '', effort: '' }), { model, effort: '' });
    assert.deepEqual(settings.args(settings.forChief()), ['--model', 'qwen3:8b']);
    const kept = JSON.parse(fs.readFileSync(path.join(dir, 'claude-key.json'), 'utf8'));
    assert.deepEqual([Object.keys(kept.providers), 'provider' in kept, kept.use], [['ollama'], false, 'subscription'], 'written in the new shape: saved beside the Claude connection');
    const key = claudeKeyLib.create(dir);
    assert.deepEqual([key.status({ defaultModel: model }).using, key.status({ defaultModel: model }).provider.preset], ['provider', 'ollama']);
    assert.equal(key.routeFor(model).provider.url, 'http://ollama:11434');
    // A start again changes nothing, and an owner's own choice is not taken back.
    settings.update({ defaultModel: 'opus' });
    assert.equal(settingsLib.create(dir, {}).get().defaultModel, 'opus');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('an account saved on a provider keeps its Haiku and Claude defaults translated, and one on the subscription is untouched', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mix-legacy2-'));
  try {
    fs.writeFileSync(path.join(dir, 'claude-key.json'), JSON.stringify({ use: 'provider', provider: { preset: 'custom', name: 'Other', url: 'https://x.example', big: 'b', small: 's' } }));
    fs.writeFileSync(path.join(dir, 'settings.json'), JSON.stringify({ defaultModel: 'haiku', language: 'pl' }));
    const settings = settingsLib.create(dir, {});
    assert.equal(settings.get().defaultModel, 'provider:custom:s', 'a Claude name the account had on a provider ran on its models: Haiku on the small one');
    assert.equal(settings.get().language, 'pl');
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), 'mix-legacy3-'));
    try {
      fs.writeFileSync(path.join(plain, 'claude-key.json'), JSON.stringify({ use: 'subscription', provider: { preset: 'custom', name: 'Other', url: 'https://x.example', big: 'b', small: 's' } }));
      assert.equal(settingsLib.create(plain, {}).get().defaultModel, '', 'a provider saved but not picked is only saved');
    } finally { fs.rmSync(plain, { recursive: true, force: true }); }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a short call that asks for Haiku goes where the account default does', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mix-helper-'));
  try {
    fs.writeFileSync(path.join(dir, 'claude-key.json'), JSON.stringify({ providers: {
      glm: { preset: 'glm', name: 'Z.ai GLM', url: 'https://api.z.ai/api/anthropic', big: 'glm-5.3', small: 'glm-5.3-flash' },
      deepseek: { preset: 'deepseek', name: 'DeepSeek', url: 'https://api.deepseek.com/anthropic', big: 'deepseek-v4-pro', small: 'deepseek-flash' },
    } }));
    const settings = settingsLib.create(dir, {});
    assert.deepEqual(settings.forHelper({ model: 'claude-haiku-5-5' }), { model: 'claude-haiku-5-5', effort: '' }, 'a Claude default: Haiku, as asked');
    settings.update({ defaultModel: 'provider:deepseek:deepseek-v4-pro' });
    assert.deepEqual(settings.forHelper({ model: 'claude-haiku-5-5' }), { model: 'provider:deepseek:deepseek-flash', effort: '' }, 'that provider\'s helper model');
    assert.deepEqual(settings.forHelper({ model: 'sonnet', effort: 'high' }), { model: 'provider:deepseek:deepseek-v4-pro', effort: 'high' }, 'a bigger ask: its main model, with a level it takes');
    assert.deepEqual(settings.forHelper({ model: 'provider:glm:glm-5.3' }), { model: 'provider:glm:glm-5.3', effort: '' }, 'a provider\'s model asked for is asked for');
    assert.deepEqual(settings.args(settings.forHelper({ model: 'haiku' })), ['--model', 'deepseek-flash']);
    settings.update({ defaultModel: 'provider:glm:glm-5.3' });
    assert.equal(settings.forHelper({ model: 'haiku' }).model, 'provider:glm:glm-5.3-flash', 'and it follows the default');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the usage-limit hold clears only when the Claude connection changes, not when a provider is saved or removed', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mix-credential-'));
  try {
    const key = claudeKeyLib.create(dir);
    const before = key.credential();
    fs.writeFileSync(path.join(dir, 'claude-key.json'), JSON.stringify({ providers: { custom: { preset: 'custom', url: 'https://x.example', big: 'b', small: 's' } } }));
    assert.equal(key.credential(), before, 'a provider saved beside it is not the Claude connection');
    assert.equal(key.credential(), null, 'on the subscription');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
