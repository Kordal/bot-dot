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
let reasoningAvailable = true;
let catalogAvailable = true;
const stand = http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => { body += c; });
  req.on('end', () => {
    let parsed = {};
    try { parsed = JSON.parse(body); } catch { /* none */ }
    asked.push({ method: req.method, url: req.url, auth: req.headers.authorization, xKey: req.headers['x-api-key'], model: parsed.model, max: parsed.max_tokens });
    const json = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
    if (req.url === '/v1/models?after_id=small-model') return json(200, { data: [{ id: 'third-model' }], has_more: false });
    if (req.url === '/v1/models' || req.url === '/api/tags') {
      if (!catalogAvailable) return json(403, {});
      if (req.headers.authorization === `Bearer ${REFUSED}`) return json(401, {});
      if (req.url === '/api/tags') return json(200, { models: [{ model: 'qwen3:8b' }] });
      return json(200, { data: [
        { id: 'big-model', display_name: 'Big Model' }, { id: 'small-model', name: 'Small Model' },
        { id: 'big-model' }, { id: 'a broken id' },
      ], has_more: true, last_id: 'small-model' });
    }
    if (req.url === '/api/show') {
      if (!reasoningAvailable) return json(503, {});
      return json(200, { thinking: { values: parsed.model === 'big-model' ? ['low', 'high'] : [false, true] } });
    }
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
  srv = await startServer({ env: { CLAUDE_CODE_OAUTH_TOKEN: 'subscription-token' } }); // the Claude connection: a run on it has the token, one on a provider has none
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

test('provider discovery returns choices by display name and does not pick the provider', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('provider-model-catalog'));
  const list = (body) => srv.api('/setup/claude/provider/models', { method: 'POST', body });
  const custom = await list({ preset: 'custom', url, key: KEY });
  assert.equal(custom.status, 200);
  assert.equal(custom.data.limited, false);
  assert.deepEqual(custom.data.models, [{ id: 'big-model', label: 'Big Model' }, { id: 'small-model', label: 'Small Model' }, { id: 'third-model', label: 'third-model' }]);
  assert.deepEqual((await list({ preset: 'ollama', url })).data.models, [{ id: 'qwen3:8b', label: 'qwen3:8b' }]);
  assert.equal((await list({ preset: 'custom', url, key: REFUSED })).status, 400);
  assert.equal((await list({ preset: 'custom', url: 'http://example.com', key: KEY })).status, 400);
  assert.equal((await claude()).provider, null);
});

test('OpenCode Go lists translated models and checks the two choices in one session', async () => {
  const key = 'sample-key';
  const catalog = await providers.catalog({ preset: 'opencode-go', key }, null, {
    fetchImpl: async (url) => {
      assert.equal(url, 'https://opencode.ai/inference/go/v1/models');
      return Response.json({ data: [
        { id: 'glm-5.3', name: 'GLM 5.3', type: 'chat', capabilities: { tools: { supported: true } } },
        { id: 'embeddings', type: 'embedding', capabilities: { tools: { supported: false } } },
      ] });
    },
  });
  assert.deepEqual(catalog.models, [{ id: 'glm-5.3', label: 'GLM 5.3', efforts: [] }]);
  const session = new Set();
  const models = new Set();
  await providers.check(providers.clean({ preset: 'opencode-go', key, big: 'glm-5.3', small: 'qwen3.8-flash' }), {
    fetchImpl: async (url, options) => {
      assert.equal(url, 'https://opencode.ai/inference/go/anthropic/v1/messages');
      assert.match(options.headers['x-opencode-session'], /^ses_/);
      session.add(options.headers['x-opencode-session']);
      models.add(JSON.parse(options.body).model);
      return Response.json({});
    },
  });
  assert.equal(session.size, 1);
  assert.deepEqual(models, new Set(['glm-5.3', 'qwen3.8-flash']));
});

// What https://opencode.ai/inference/go/v1/models reports per model (capabilities.reasoning), as the stand-in answers it.
const GO_MODELS = { data: [
  { id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', type: 'chat', capabilities: { tools: { supported: true }, reasoning: { supported: true, effort: ['low', 'high', 'max'] } } },
  { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', type: 'chat', capabilities: { tools: { supported: true }, reasoning: { supported: true, effort: ['high', 'max', 'turbo'] } } },
  { id: 'glm-5.3', name: 'GLM 5.3', type: 'chat', capabilities: { tools: { supported: true }, reasoning: { supported: false, effort: ['high'] } } },
  { id: 'qwen3.8-flash', name: 'Qwen3.8 Flash', type: 'chat', capabilities: { tools: { supported: true }, reasoning: { supported: true } } },
  { id: 'minimax-m3', name: 'MiniMax M3', type: 'chat', capabilities: { tools: { supported: true } } },
] };

test('OpenCode Go\'s catalog keeps each model\'s reasoning levels that Claude Code can send', async () => {
  const catalog = await providers.catalog({ preset: 'opencode-go', key: 'sample-key' }, null, { fetchImpl: async () => Response.json(GO_MODELS) });
  assert.deepEqual(catalog.models.map((m) => [m.id, m.efforts]), [
    ['deepseek-v4.1-flash', ['low', 'high', 'max']],
    ['deepseek-v4-pro', ['high', 'max']], // "turbo" is not a level Claude Code takes
    ['glm-5.3', []], // reasoning.supported false: none, whatever it lists
    ['qwen3.8-flash', []],
    ['minimax-m3', []],
  ]);
});

test('Settings show OpenCode Go\'s levels from the saved catalog, with no request, and a run passes only a level the model has', () => {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'llm-go-'));
  const realFetch = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('a Settings read made a request'); };
  try {
    const settings = settingsLib.create(dir, {});
    const provider = providers.clean({ preset: 'opencode-go', key: KEY, big: 'deepseek-v4-pro', small: 'deepseek-v4.1-flash' });
    const write = (catalog) => fs.writeFileSync(path.join(dir, 'claude-key.json'), JSON.stringify({ providers: { 'opencode-go': { ...provider, key: undefined, ...(catalog ? { catalog } : {}) } } }));
    const mine = () => settings.choices().models.filter((m) => m.provider === 'opencode-go');
    // Saved before this was kept: no levels, as before, and no --effort.
    write(null);
    assert.ok(mine().every((m) => m.effort === false));
    const none = mine()[0].id;
    assert.deepEqual(settings.args({ model: none, effort: 'high' }), ['--model', 'deepseek-v4-pro']);

    write({ checkedAt: null, limited: false, models: [
      { id: 'deepseek-v4-pro', label: 'DeepSeek V4 Pro', efforts: ['high', 'max'] },
      { id: 'deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash', efforts: ['low', 'high', 'max'] },
      { id: 'minimax-m3', label: 'MiniMax M3', efforts: [] },
    ] });
    const models = mine();
    assert.deepEqual(models.map((m) => [m.label, m.effort, m.efforts]), [
      ['DeepSeek V4 Pro', true, ['high', 'max']], ['DeepSeek V4.1 Flash', true, ['low', 'high', 'max']], ['MiniMax M3', false, []],
    ]);
    assert.deepEqual(settings.choices().efforts.map((e) => e.id), ['low', 'medium', 'high', 'xhigh', 'max'], 'Claude\'s levels stay: they are the union');
    const [pro, flash] = models.map((m) => m.id);
    assert.deepEqual(settings.args({ model: models[2].id, effort: 'high' }), ['--model', 'minimax-m3']);
    assert.deepEqual(settings.args({ model: flash, effort: 'low' }), ['--model', 'deepseek-v4.1-flash', '--effort', 'low']);
    assert.deepEqual(settings.args({ model: pro, effort: 'low' }), ['--model', 'deepseek-v4-pro'], 'low is not one of this model\'s levels');
    assert.deepEqual(settings.args({ model: pro, effort: 'max' }), ['--model', 'deepseek-v4-pro', '--effort', 'max']);
    assert.deepEqual(settings.forBot({ model: flash, effort: 'low' }), { model: flash, effort: 'low' });
    assert.deepEqual(settings.forBot({ model: pro, effort: 'low' }), { model: pro, effort: '' });
  } finally { globalThis.fetch = realFetch; fs.rmSync(dir, { recursive: true, force: true }); }
});

test('refreshing the saved OpenCode Go catalog gives an already saved provider its levels, and an outage keeps them', async () => {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'llm-go-refresh-'));
  const realFetch = globalThis.fetch;
  let up = true;
  globalThis.fetch = async (target) => {
    assert.equal(target, 'https://opencode.ai/inference/go/v1/models');
    return up ? Response.json(GO_MODELS) : new Response('{}', { status: 503 });
  };
  try {
    const claudeKey = require('../lib/claude-key').create(dir);
    await claudeKey.saveProvider({ preset: 'opencode-go', key: KEY, big: 'deepseek-v4-pro', small: 'deepseek-v4.1-flash' }, { fetchImpl: async () => Response.json({}) });
    assert.equal(claudeKey.providerModels('opencode-go').catalog, undefined, 'saved without levels, as before');
    assert.deepEqual(providers.effortsFor(claudeKey.providerModels('opencode-go'), 'deepseek-v4.1-flash'), []);

    const listed = await claudeKey.providerCatalog({ preset: 'opencode-go', key: KEY });
    assert.deepEqual(listed.models[0], { id: 'deepseek-v4.1-flash', label: 'DeepSeek V4.1 Flash' }, 'the setup answer stays { id, label }');
    await claudeKey.refreshProviderCatalog('opencode-go');
    const saved = claudeKey.providerModels('opencode-go');
    assert.deepEqual(providers.effortsFor(saved, 'deepseek-v4.1-flash'), ['low', 'high', 'max']);
    assert.deepEqual(providers.effortsFor(saved, 'deepseek-v4-pro'), ['high', 'max']);
    assert.deepEqual(providers.effortsFor(saved, 'minimax-m3'), []);
    assert.deepEqual(providers.effortsFor(saved, 'deepseek-v4.1-flash[1m]'), ['low', 'high', 'max']);
    assert.deepEqual(providers.effortsFor(saved, 'not-listed'), []);

    // The catalog is down: the list is incomplete, the saved choices are added without levels, and keep what they had.
    up = false;
    await claudeKey.refreshProviderCatalog('opencode-go');
    const after = claudeKey.providerModels('opencode-go');
    assert.equal(after.catalog.limited, true);
    assert.deepEqual(providers.effortsFor(after, 'deepseek-v4.1-flash'), ['low', 'high', 'max']);
    assert.deepEqual(providers.effortsFor(after, 'deepseek-v4-pro'), ['high', 'max']);

    // A model whose levels the catalog now drops has none.
    up = true;
    GO_MODELS.data[0].capabilities.reasoning = { supported: false };
    await claudeKey.refreshProviderCatalog('opencode-go');
    assert.deepEqual(providers.effortsFor(claudeKey.providerModels('opencode-go'), 'deepseek-v4.1-flash'), []);
  } finally {
    GO_MODELS.data[0].capabilities.reasoning = { supported: true, effort: ['low', 'high', 'max'] };
    globalThis.fetch = realFetch; fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('a key the provider refuses, a model it does not know, a bad address or no key is not saved', async () => {
  const refused = await save({ key: REFUSED });
  assert.deepEqual([refused.status, refused.data.error], [400, 'It refused this key. Check that you copied all of it.']);
  const unknown = await save({ big: 'nope', small: 'small-model' });
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
  assert.deepEqual(r.data.claude.providers, [{ preset: 'custom', name: 'Other', key: '…wxyz', big: 'big-model', small: 'small-model', url }]);
  assert.deepEqual([r.data.claude.using, r.data.claude.provider], ['subscription', null], 'saving a provider moves nothing: the account default is still Claude');
  const check = asked.find((a) => a.auth === `Bearer ${KEY}` && a.model === 'small-model');
  assert.deepEqual([check.method, check.url, check.max], ['POST', '/v1/messages', 16]);
  assert.doesNotMatch(JSON.stringify((await srv.api('/setup')).data), /sk-provider/, 'no answer holds the key');
  const file = path.join(srv.data, 'claude-key.json');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.deepEqual(Object.keys(JSON.parse(fs.readFileSync(file, 'utf8')).providers.custom.key).sort(), ['ct', 'iv', 'tag']);
  assert.doesNotMatch(everything(), new RegExp(KEY), 'neither the log nor any file in the data folder holds it in the clear');
  assert.deepEqual((await srv.api('/settings')).data.models.filter((m) => m.group === 'Other').map((m) => m.id), ['provider:custom:big-model', 'provider:custom:small-model']);
});

test('saved choices and the saved key work at the same address only', async () => {
  const list = (body) => srv.api('/setup/claude/provider/models', { method: 'POST', body });
  const reused = await list({ preset: 'custom', url, reuseKey: true });
  assert.equal(reused.status, 200);
  assert.deepEqual([reused.data.main, reused.data.helper], ['big-model', 'small-model']);
  assert.equal((await list({ preset: 'custom', url: url + '/other', reuseKey: true })).status, 400);
  const unavailable = await list({ preset: 'custom', url: url + '/unlisted', key: KEY });
  assert.deepEqual(unavailable.data.models, []);
  catalogAvailable = false;
  try {
    const fallback = await list({ preset: 'custom', url, reuseKey: true });
    assert.deepEqual(fallback.data.models.map((item) => item.id), ['big-model', 'small-model']);
    assert.equal(fallback.data.limited, true);
    assert.equal((await list({ preset: 'custom', url, key: REFUSED, reuseKey: true })).status, 400);
  } finally { catalogAvailable = true; }
  assert.equal((await save({ key: '', reuseKey: true })).status, 200);
  assert.equal((await claude()).provider, null, 'and saving it again picks nothing');
});

test('runs and Chief turns on a provider\'s model go to the provider with its models, and get no subscription token', async () => {
  const set = await srv.api('/settings', { method: 'PUT', body: { defaultModel: 'provider:custom:big-model' } });
  assert.equal(set.status, 200);
  const c = await claude();
  assert.deepEqual([c.using, c.provider.preset, c.loggedIn], ['provider', 'custom', true], 'the apps that knew one provider read the account default\'s');
  const bot = await makeBot(srv, { name: 'On The Provider' });
  const run = await runOf(bot, 'with the provider');
  assert.equal(run.anthropic.ANTHROPIC_BASE_URL, url);
  assert.equal(run.anthropic.ANTHROPIC_AUTH_TOKEN, KEY);
  assert.equal(run.anthropic.ANTHROPIC_API_KEY, '');
  assert.deepEqual([run.anthropic.ANTHROPIC_MODEL, run.anthropic.ANTHROPIC_DEFAULT_OPUS_MODEL, run.anthropic.ANTHROPIC_DEFAULT_SONNET_MODEL, run.anthropic.ANTHROPIC_DEFAULT_HAIKU_MODEL], ['big-model', 'big-model', 'big-model', 'small-model']);
  assert.equal(run.args[run.args.indexOf('--model') + 1], 'big-model');
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

test('a Claude model a bot asks for runs on Claude, a provider\'s on the provider, and no reasoning level is passed where it has none', async () => {
  const bot = await makeBot(srv, { name: 'Picks Model' });
  await srv.api(`/bots/${bot.id}`, { method: 'PUT', body: { model: 'opus', effort: 'high' } });
  const claudeRun = await runOf(bot, 'opus stays on Claude');
  assert.equal(claudeRun.args[claudeRun.args.indexOf('--model') + 1], 'opus');
  assert.deepEqual(claudeRun.anthropic, {}, 'no provider variable on a Claude run');
  assert.equal(claudeRun.env.CLAUDE_CODE_OAUTH_TOKEN, 'subscription-token', 'it is on the subscription');
  await srv.api(`/bots/${bot.id}`, { method: 'PUT', body: { model: 'provider:custom:small-model', effort: 'high' } });
  const small = await runOf(bot, 'small model on the provider');
  assert.equal(small.args[small.args.indexOf('--model') + 1], 'small-model');
  assert.ok(!small.args.includes('--effort'), 'this model has no levels');
  assert.equal(small.anthropic.ANTHROPIC_BASE_URL, url);
});

test('a model of a removed provider falls back to the account default, and the account default of a removed provider to Claude', async () => {
  const bot = await makeBot(srv, { name: 'Switches Provider', model: 'provider:custom:small-model' });
  assert.equal((await runOf(bot, 'on the provider')).anthropic.ANTHROPIC_BASE_URL, url);
  const gone = await srv.api('/setup/claude/provider/custom', { method: 'DELETE' });
  assert.deepEqual([gone.status, gone.data.claude.using, gone.data.claude.provider, gone.data.claude.providers], [200, 'subscription', null, []]);
  const after = await runOf(bot, 'provider removed');
  assert.deepEqual(after.anthropic, {}, 'the account default was the removed provider\'s: Claude');
  assert.ok(!after.args.includes('--model'));
  const none = await srv.api('/setup/claude/use', { method: 'PUT', body: { use: 'provider' } });
  assert.deepEqual([none.status, none.data.error], [400, 'Choose "api-key" or "subscription". A provider\'s models are picked in Settings → Model.']);
  assert.equal((await srv.api('/settings', { method: 'PUT', body: { defaultModel: '' } })).status, 200);
});

test('a keyless provider (Ollama on this machine) is saved without a key', async () => {
  const r = await srv.api('/setup/claude/provider', { method: 'PUT', body: { preset: 'ollama', url, big: 'big-model', small: 'small-model' } });
  assert.equal(r.status, 200);
  assert.deepEqual([r.data.claude.using, r.data.claude.providers[0].key], ['subscription', null]);
  const { models, providers: connected } = (await srv.api('/settings')).data;
  assert.deepEqual(connected, [{ preset: 'ollama', name: 'Ollama', refreshable: true }]);
  assert.deepEqual(models.filter((model) => model.group === 'Ollama').map((model) => model.efforts), [['low', 'high'], []]);
  assert.equal((await srv.api('/settings/refresh-models', { method: 'POST' })).status, 200);
  const run = await runOf(await makeBot(srv, { name: 'Local Model', model: 'provider:ollama:big-model' }), 'keyless');
  assert.equal(run.anthropic.ANTHROPIC_AUTH_TOKEN, 'none');
  await srv.api('/setup/claude/provider/ollama', { method: 'DELETE' });
});

test('a failed reasoning refresh reports the error and keeps the last known levels', async () => {
  const saved = await save({ preset: 'ollama', key: '' });
  assert.equal(saved.status, 200);
  try {
    reasoningAvailable = false;
    const refresh = await srv.api('/settings/refresh-models', { method: 'POST' });
    assert.deepEqual([refresh.status, refresh.data.error], [502, "Couldn't refresh the provider's reasoning levels."]);
    const { models } = (await srv.api('/settings')).data;
    assert.deepEqual(models.filter((model) => model.group === 'Ollama').map((model) => model.efforts), [['low', 'high'], []]);
    reasoningAvailable = true;
    assert.equal((await srv.api('/settings/refresh-models', { method: 'POST' })).status, 200);
  } finally {
    reasoningAvailable = true;
    await srv.api('/setup/claude/provider/ollama', { method: 'DELETE' });
  }
});

test('OpenRouter reasoning uses the advertised levels for each configured model', async () => {
  const p = providers.clean({ preset: 'openrouter', key: KEY, big: 'vendor/reasoning', small: 'vendor/auto' });
  const reasoning = await providers.discoverEfforts(p, { fetchImpl: async (target, init) => {
    assert.equal(target, 'https://openrouter.ai/api/v1/models');
    assert.equal(init.headers, undefined, 'a public catalog needs no key');
    return { ok: true, json: async () => ({ data: [
      { id: 'vendor/reasoning', reasoning: { supported_efforts: ['high', 'none', 'low', 'minimal'] } },
      { id: 'vendor/auto' },
    ] }) };
  } });
  assert.deepEqual(reasoning, [{ model: 'vendor/reasoning', levels: ['low', 'high'] }, { model: 'vendor/auto', levels: [] }]);
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

test('settings.args sends a provider\'s model by its own name and anything else as Claude\'s, whatever is saved', () => {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'llm-args-'));
  try {
    const settings = settingsLib.create(dir, {});
    assert.deepEqual(settings.args({ model: 'opus', effort: 'high' }), ['--model', 'opus', '--effort', 'high'], 'as before without a provider');
    fs.writeFileSync(path.join(dir, 'claude-key.json'), JSON.stringify({ providers: { custom: { preset: 'custom', url: 'https://x.example', big: 'b', small: 's' } } }));
    assert.deepEqual(settings.args({ model: 'sonnet', effort: 'high' }), ['--model', 'sonnet', '--effort', 'high'], 'a Claude name is Claude\'s: a provider saved beside it changes nothing');
    assert.deepEqual(settings.args({ model: 'provider:custom:s', effort: 'high' }), ['--model', 's'], 'a provider\'s model by its own name, no level it has none of');
    assert.deepEqual(settings.args({ model: 'provider:custom:nope', effort: '' }), [], 'a model it does not have is nobody\'s');
    assert.deepEqual(settings.args({ model: 'provider:glm:glm-5.3', effort: '' }), [], 'nor one of a provider that is not saved');
    assert.deepEqual(settings.args({ model: '', effort: '' }), []);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the Model row can discover and select models beyond provider setup', async () => {
  assert.equal((await save({})).status, 200);
  try {
    const refresh = await srv.api('/settings/refresh-models?catalog', { method: 'POST' });
    assert.equal(refresh.status, 200);
    const third = refresh.data.models.find((model) => model.id === 'provider:custom:third-model');
    assert.ok(third, 'Settings includes a model the provider listed beyond the two setup choices');
    assert.ok((await srv.api('/settings')).data.models.some((model) => model.id === third.id));
    const changed = await srv.api('/settings', { method: 'PUT', body: { defaultModel: third.id } });
    assert.equal(changed.data.settings.defaultModel, third.id);
    const run = await runOf(await makeBot(srv, { name: 'Uses Discovered Model' }), 'use the discovered model');
    assert.equal(run.args[run.args.indexOf('--model') + 1], 'third-model');
    catalogAvailable = false;
    const fallback = await srv.api('/settings/refresh-models?catalog', { method: 'POST' });
    assert.ok(fallback.data.catalog.error);
    assert.ok(fallback.data.models.some((model) => model.id === third.id), 'keep the last catalog when the provider is unavailable');
  } finally {
    catalogAvailable = true;
    await srv.api('/settings', { method: 'PUT', body: { defaultModel: '' } });
    await srv.api('/setup/claude/provider/custom', { method: 'DELETE' });
  }
});

test('Settings offers every connected provider\'s models beside Claude\'s and uses a bot\'s explicit selection', async () => {
  assert.equal((await save({})).status, 200);
  try {
    const { models, providers: connected } = (await srv.api('/settings')).data;
    assert.equal(models[0].group, 'Always the newest', 'Claude first');
    assert.deepEqual(models.filter((m) => m.group === 'Other').map((m) => m.label), ['big-model', 'small-model']);
    assert.deepEqual(connected, [{ preset: 'custom', name: 'Other', refreshable: false }]);
    const helper = 'provider:custom:small-model';
    const bot = await makeBot(srv, { name: 'Chooses Small', model: helper });
    const run = await runOf(bot, 'use the selected provider model');
    assert.equal(run.args[run.args.indexOf('--model') + 1], 'small-model');
    assert.equal((await save({ small: 'big-model' })).status, 200);
    const changed = await runOf(bot, 'fall back after the selected model is removed');
    assert.ok(!changed.args.includes('small-model'));
    assert.deepEqual(changed.anthropic, {}, 'its model is gone and the account default is Claude: Claude\'s run');
    await srv.api('/setup/claude/provider/custom', { method: 'DELETE' });
    const fallback = await runOf(bot, 'fall back to Claude');
    assert.ok(!fallback.args.includes(helper));
    assert.ok(!fallback.args.includes('small-model'));
  } finally { await srv.api('/setup/claude/provider/custom', { method: 'DELETE' }); }
});

test('provider reasoning levels are applied only to models that accept them', () => {
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'llm-effort-'));
  try {
    const settings = settingsLib.create(dir, {});
    const keep = (...saved) => fs.writeFileSync(path.join(dir, 'claude-key.json'), JSON.stringify({ providers: Object.fromEntries(saved.map((p) => [p.preset, { ...p, key: undefined }])) }));
    for (const [preset, big, small] of [
      ['deepseek', 'deepseek-v4-pro', 'deepseek-flash'],
      ['glm', 'glm-5.3', 'glm-5.3-flash'],
    ]) {
      const provider = providers.clean({ preset, key: KEY, big, small });
      keep(provider);
      const { efforts, models } = settings.choices();
      assert.ok(['low', 'high', 'max'].every((level) => efforts.some((e) => e.id === level)));
      const model = models.find((m) => m.label === small).id;
      const args = settings.args({ model, effort: 'max' });
      assert.deepEqual(args, ['--model', small, '--effort', 'max']);
      assert.deepEqual(providers.reasoningEnv(args, providers.envFor(provider)), {
        ANTHROPIC_CUSTOM_MODEL_OPTION: small,
        ANTHROPIC_CUSTOM_MODEL_OPTION_SUPPORTED_CAPABILITIES: 'effort,thinking,adaptive_thinking',
      });
      assert.deepEqual(settings.args({ model, effort: 'medium' }), ['--model', small]);
      settings.update({ defaultEffort: 'high' });
      assert.deepEqual(settings.forBot({ model, effort: 'medium' }), { model, effort: 'high' });
    }
    keep(providers.clean({ preset: 'minimax', key: KEY }));
    const models = settings.choices().models.filter((m) => m.provider === 'minimax');
    assert.deepEqual(models.map((m) => [m.label, m.effort]), [['MiniMax-M3', false], ['MiniMax-M3.1-Flash', true]]);
    assert.deepEqual(settings.args({ model: models[0].id, effort: 'high' }), ['--model', 'MiniMax-M3']);
    assert.deepEqual(settings.args({ model: models[1].id, effort: 'xhigh' }), ['--model', 'MiniMax-M3.1-Flash', '--effort', 'xhigh']);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
