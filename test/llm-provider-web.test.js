// The web page's side of several model providers beside Claude (ADR 255, 267): Setup and Settings → Providers name
// Claude's connection and each provider connected (with its key's last four), offer "Connect another" and a way to
// remove each, and save and remove them with the server's routes (docs/api.md, Setup and updates). The key is typed in a
// password field and never drawn; the presets are the server's, not the page's. The Model picker lists every
// connected provider's models in a group each, searchable, and names a provider's model with its provider.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { app, read, cut, esc, element, finders, words } = require('./web-page');

const PRESETS = [
  { id: 'deepseek', name: 'DeepSeek', url: 'https://api.deepseek.com/anthropic', big: 'deepseek-v4-pro', small: 'deepseek-flash' },
  { id: 'ollama', name: 'Ollama', url: '', big: '', small: '', keyless: true, askUrl: true },
  { id: 'custom', name: 'Other', url: '', big: '', small: '', custom: true, askUrl: true },
];
const DEEPSEEK = { preset: 'deepseek', name: 'DeepSeek', key: '…wxyz', big: 'deepseek-v4-pro', small: 'deepseek-flash' };
const GLM = { preset: 'glm', name: 'Z.ai GLM', key: '…abcd', big: 'glm-5.3', small: 'glm-5.3-flash' };
const SUB = { installed: true, loggedIn: true, email: 'me@example.com', using: 'subscription', connection: 'subscription', apiKey: null, subscription: true, provider: null, providers: [] };
const SUB_AND_TWO = { ...SUB, providers: [DEEPSEEK, GLM] };
// The account default is a DeepSeek model: `using` and `provider` say so for the apps that knew one provider.
const DEFAULT_ON_PROVIDER = { ...SUB_AND_TWO, using: 'provider', provider: DEEPSEEK };
const PROVIDER_ONLY = { installed: true, loggedIn: true, email: null, using: 'provider', connection: 'subscription', apiKey: null, subscription: false, provider: DEEPSEEK, providers: [DEEPSEEK] };
const KEY_AND_ONE = { ...SUB, using: 'api-key', connection: 'api-key', apiKey: '…ghij', providers: [DEEPSEEK] };

function page(state = { setup: { providers: PRESETS } }) {
  const ctx = vm.createContext({ ...words, esc, toast() {}, state });
  vm.runInContext(`${cut('function setupItem(', 'function drawSetup()')}
    Object.assign(this, { claudeSetupItem, claudeProviderBox });`, ctx);
  return ctx;
}

test('web: Setup names Claude\'s connection and each provider connected, with a way to remove each and to connect another', () => {
  const ctx = page();
  const two = ctx.claudeSetupItem(SUB_AND_TWO, false);
  assert.match(two, /setup-item ok[\s\S]*Signed in with <b>me@example\.com<\/b>\. Connected: <b>DeepSeek<\/b>, <b>Z\.ai GLM<\/b>\./);
  assert.match(two, /id="claude-provider-remove-deepseek" data-remove-provider="deepseek">Remove DeepSeek<\/button>[\s\S]*data-remove-provider="glm">Remove Z\.ai GLM<\/button>[\s\S]*id="claude-provider-new">Connect another provider<\/button>/);
  assert.match(two, /id="claude-key-new">Use an API key instead/);
  assert.doesNotMatch(two, /claude-use-provider|Bots run on/, 'a provider is not "used": its models are picked');
  // The account default being a provider's model changes none of it: the card is about the connections.
  assert.equal(ctx.claudeSetupItem(DEFAULT_ON_PROVIDER, false), two);
  const none = ctx.claudeSetupItem(SUB, false);
  assert.match(none, /id="claude-provider-new">Connect a provider<\/button>/);
  assert.doesNotMatch(none, /Connected:/);
  assert.doesNotMatch(ctx.claudeSetupItem(SUB, true), /claude-provider-new/, 'not while a box is open');
  const old = page({ setup: {} }).claudeSetupItem({ installed: true, loggedIn: true, email: 'me@example.com', using: 'subscription', apiKey: null, subscription: true }, false);
  assert.doesNotMatch(old, /provider/i, 'nothing of a provider from a server that offers none');
});

test('web: Claude on an API key and a provider are both named, and a signed-out subscription says its models cannot run', () => {
  const ctx = page();
  const key = ctx.claudeSetupItem(KEY_AND_ONE, false);
  assert.match(key, /Claude runs on your Anthropic API key <b>…ghij<\/b>\. Your Claude subscription \(<b>me@example\.com<\/b>\) is signed in too; bots don't use it\. Connected: <b>DeepSeek<\/b>\./);
  assert.match(key, /id="claude-use-sub">Use the subscription instead<\/button>[\s\S]*id="claude-key-remove">Remove the key<\/button>[\s\S]*Remove DeepSeek/);
  const only = ctx.claudeSetupItem(PROVIDER_ONLY, false);
  assert.match(only, /setup-item ok[\s\S]*Not signed in, so Claude's models can't run\. Connected: <b>DeepSeek<\/b>\./, 'the default is a provider\'s model: bots run, Claude\'s do not');
  assert.match(only, /id="claude-switch"|id="claude-login"/);
});

test('web: the provider box lists the server\'s presets, hides what a preset does not need, and shows no key', () => {
  const box = page().claudeProviderBox(false);
  assert.match(box, /<form id="claude-provider-form"[\s\S]*<select name="preset" id="setup-provider-preset"><option value="deepseek" selected>DeepSeek<\/option><option value="ollama">Ollama<\/option><option value="custom">Other<\/option><\/select>/);
  assert.match(box, /<input type="password" name="key" autocomplete="off"/);
  assert.match(box, /data-provider-address hidden>/, 'the address only where the owner gives it');
  assert.match(box, /data-model-role="main"/);
  assert.match(box, /data-model-role="helper"/);
  assert.match(box, /type="search" role="combobox" aria-label="Search models"/);
  assert.match(box, /role="listbox"/);
  assert.doesNotMatch(box, /name="(?:big|small)"|Another model/);
  assert.match(box, /id="claude-provider-cancel"/);
  const again = page({ setup: { providers: PRESETS, claude: { providers: [DEEPSEEK] } } }).claudeProviderBox(true);
  assert.match(again, /<option value="ollama" selected>Ollama<\/option>/, 'the first one not connected yet is the one chosen');
});

// The model picker, cut out of public/settings.js.
function picker(state) {
  const ctx = vm.createContext({ ...words, esc, state });
  const source = read('settings.js');
  vm.runInContext(source.slice(source.indexOf('function shownModel'), source.indexOf('// ---------- the rows of a settings screen')) + '\nObject.assign(this, { llmFieldsHTML, llmSummary, llmValue, modelLabel, modelInherit, effortInherit });', ctx);
  return ctx;
}
const MODELS = [
  { id: 'opus', label: 'Opus (latest)', group: 'Always the newest' },
  { id: 'provider:deepseek:deepseek-v4-pro', label: 'DeepSeek V4 Pro', group: 'DeepSeek', provider: 'deepseek', effort: true, efforts: ['low', 'high', 'max'] },
  { id: 'provider:deepseek:deepseek-flash', label: 'DeepSeek V4.1 Flash', group: 'DeepSeek', provider: 'deepseek', effort: true, efforts: ['low', 'high', 'max'] },
  { id: 'provider:glm:glm-5.3', label: 'GLM 5.3', group: 'Z.ai GLM', provider: 'glm', effort: false, efforts: [] },
];
const EFFORTS = [{ id: 'low', label: 'Low' }, { id: 'high', label: 'High' }, { id: 'max', label: 'Max' }];

test('web: the Model picker groups every connected provider\'s models beside Claude\'s, and names a provider\'s model with its provider', () => {
  const ctx = picker({ models: MODELS, efforts: EFFORTS, settings: { defaultModel: 'opus' } });
  const form = ctx.llmFieldsHTML('bot', { model: 'provider:glm:glm-5.3', effort: '' });
  assert.match(form, /<optgroup label="Always the newest">[\s\S]*<optgroup label="DeepSeek">[\s\S]*<optgroup label="Z\.ai GLM"><option value="provider:glm:glm-5\.3" selected>GLM 5\.3<\/option>/);
  assert.match(form, /data-model-search/, 'one searchable list');
  assert.equal(ctx.llmSummary('provider:deepseek:deepseek-v4-pro', 'high'), 'DeepSeek · DeepSeek V4 Pro · High');
  assert.equal(ctx.llmSummary('opus', ''), 'Opus (latest)', 'no provider named for Claude');
  assert.equal(ctx.llmSummary('provider:glm:glm-5.3', 'high'), 'Z.ai GLM · GLM 5.3', 'a model with no levels names none');
  assert.equal(ctx.llmValue('', ''), 'Default');
  // A model of a provider that is gone is no choice: the bot follows the default.
  assert.equal(ctx.llmValue('provider:minimax:MiniMax-M3', ''), 'Default');
  assert.match(ctx.llmFieldsHTML('bot', { model: 'provider:minimax:MiniMax-M3' }), /<option value="" selected>/);
  const fields = ctx.llmFieldsHTML('default', { model: 'older-model' });
  assert.match(fields, /<option value="older-model" selected>older-model/, 'a saved Claude ID stays selectable');
  assert.doesNotMatch(fields, /__custom|ModelCustom|Full model name/);
});

// What "Default" of the Reasoning select comes to (lib/settings.js pick), and the Model's, for the model the select is about.
test('web: a bot\'s Reasoning "Default" says what its own model gets, not what the account default\'s model gets', () => {
  const state = { models: MODELS, efforts: EFFORTS, settings: { defaultModel: 'opus', defaultEffort: 'high' } };
  const ctx = picker(state);
  assert.equal(ctx.modelInherit(), 'Default (Opus (latest))');
  // The model the bot follows (the account default's) offers the account's level: it is named.
  assert.equal(ctx.effortInherit('bot', ''), 'Default (High)');
  assert.equal(ctx.effortInherit('bot', 'opus'), 'Default (High)');
  // A provider's model that offers the level takes it; one that does not runs on its own, and is named so.
  assert.equal(ctx.effortInherit('bot', 'provider:deepseek:deepseek-v4-pro'), 'Default (High)');
  state.settings.defaultEffort = 'medium';
  assert.equal(ctx.effortInherit('bot', 'provider:deepseek:deepseek-v4-pro'), "DeepSeek's own");
  assert.equal(ctx.effortInherit('chief', 'provider:glm:glm-5.3'), "Z.ai GLM's own");
  assert.equal(ctx.effortInherit('bot', 'opus'), 'Default (medium)', 'a level the list does not name is shown as it is');
  // With the default on a provider's model, a bot with none of its own follows it.
  state.settings = { defaultModel: 'provider:deepseek:deepseek-flash', defaultEffort: 'max' };
  assert.equal(ctx.effortInherit('bot', ''), 'Default (Max)');
  assert.equal(ctx.modelInherit(), 'Default (DeepSeek · DeepSeek V4.1 Flash)');
  state.settings.defaultEffort = '';
  assert.equal(ctx.effortInherit('bot', ''), "DeepSeek's own");
  state.settings = { defaultModel: '', defaultEffort: '' };
  assert.equal(ctx.effortInherit('bot', 'opus'), "Claude Code's default");
  assert.equal(ctx.modelInherit(), "Claude Code's default");
  // The account default's own select keeps "Claude Code's default".
  state.settings = { defaultModel: 'opus', defaultEffort: 'high' };
  assert.equal(ctx.effortInherit('default', 'provider:deepseek:deepseek-flash'), "Claude Code's default");
  // The select is drawn with it, for the bot and for the Chief.
  const own = ctx.llmFieldsHTML('chief', { model: 'provider:glm:glm-5.3', effort: '' });
  assert.match(own, /name="chiefModel"[^>]*><option value="" >Default \(Opus \(latest\)\)<\/option>/);
  assert.match(own, /name="chiefEffort"><option value="" selected>Z\.ai GLM&#39;s own<\/option>/);
  const follows = ctx.llmFieldsHTML('bot', {});
  assert.match(follows, /name="botModel"[^>]*><option value="" selected>Default \(Opus \(latest\)\)<\/option>/);
  assert.match(follows, /name="botEffort"><option value="" selected>Default \(High\)<\/option>/);
});

test('web: the Reasoning "Default" follows the Model select as the owner changes it', () => {
  const source = read('settings.js');
  const wire = source.slice(source.indexOf('function wireLlmFields'), source.indexOf('function readLlmFields'));
  assert.match(wire, /e\.options\[0\]\.textContent = effortInherit\(prefix, id\)/);
  assert.match(wire, /m\.onchange = \(\) => \{[\s\S]*update\(\)/);
});

test('web: the search box appears with the long list and filters by name, ID and provider', () => {
  const few = picker({ models: MODELS, efforts: EFFORTS });
  assert.match(few.llmFieldsHTML('default', {}), /data-model-search[^>]* hidden>/, 'four models need no search');
  const many = picker({ models: Array.from({ length: 12 }, (_, i) => ({ id: `m${i}`, label: `Model ${i}`, group: 'G' })), efforts: EFFORTS });
  assert.doesNotMatch(many.llmFieldsHTML('default', {}), /data-model-search[^>]* hidden>/);
  const source = read('settings.js');
  const wire = source.slice(source.indexOf('function wireLlmFields'), source.indexOf('function readLlmFields'));
  assert.match(wire, /option\.parentElement\?\.label/, 'the provider\'s name is searched too');
  assert.match(wire, /search\.oninput = filter/);
});

test('web: a provider\'s model offers only its own reasoning levels, and none where it has none', () => {
  const source = read('settings.js');
  const wire = source.slice(source.indexOf('function wireLlmFields'), source.indexOf('function readLlmFields'));
  assert.match(wire, /modelInfo\(effective\)\?\.efforts/);
  assert.match(wire, /option\.disabled = option\.hidden = !!levels && !!option\.value && !levels\.includes\(option\.value\)/);
  assert.match(wire, /prefix !== 'default' \? state\.settings\?\.defaultModel : ''/, 'a bot with no model of its own shows the levels of the default');
  assert.doesNotMatch(source, /modelProvider/, 'the picker holds no single provider');
});

test('web: opening Settings mounts the Providers card by the Updates row', () => {
  const outputs = [];
  const widget = { insertAdjacentHTML(where, html) { outputs.push(where, html); } };
  const state = { setup: { providers: PRESETS } };
  const ctx = vm.createContext({
    ...words, state, renderSettings() { outputs.push('settings'); },
    $: (sel) => sel === '#update-card' ? widget : null,
  });
  vm.runInContext(read('claude-card.js'), ctx);
  ctx.renderSettings();
  assert.deepEqual(outputs.slice(0, 2), ['settings', 'beforebegin']);
  assert.match(outputs[2], /id="claude-card"/);
});

test('web: the providers card is inside the Model row', () => {
  const outputs = [];
  const form = { insertAdjacentHTML(where, html) { outputs.push(where, html); } };
  const state = { setup: { providers: PRESETS }, models: [] };
  const ctx = vm.createContext({
    ...words, state, esc, renderSettings() {},
    $: (sel) => ({ '#settings-form': form, '#update-card': {} })[sel],
  });
  vm.runInContext(read('claude-card.js'), ctx);
  ctx.renderSettings();
  assert.equal(outputs[0], 'beforebegin');
  assert.match(outputs[1], /id="claude-card" data-in-model><summary>Providers<\/summary>/);
});

test('web: Settings → Providers names the connections, and the provider box opens there', async () => {
  const card = element();
  card.dataset = { inModel: '' };
  const state = { setup: { providers: PRESETS } };
  const ctx = vm.createContext({ ...words, ...finders(element({ '#claude-card': card })), esc, state, CHEV: '›', api: async () => ({ claude: ctx.claude }), toast() {} });
  vm.runInContext(`${cut('const claudeUnknown', '// First start, or Claude is known')}
    ${read('claude-card.js').slice(read('claude-card.js').indexOf('async function loadClaudeCard'))}
    this.loadClaudeCard = loadClaudeCard;`, ctx);
  ctx.claude = DEFAULT_ON_PROVIDER;
  await ctx.loadClaudeCard();
  assert.match(card.innerHTML, /<span data-provider-label>Providers<\/span><span class="muted">Claude subscription, DeepSeek, Z\.ai GLM<\/span>/);
  assert.match(card.innerHTML, /Connected: <b>DeepSeek<\/b>, <b>Z\.ai GLM<\/b>[\s\S]*data-remove-provider="deepseek"[\s\S]*id="claude-provider-new">Connect another provider/);
  ctx.claude = SUB;
  state.setupProvider = true;
  await ctx.loadClaudeCard(false);
  assert.match(card.innerHTML, /id="claude-provider-form"/);
  assert.doesNotMatch(card.innerHTML, /id="claude-provider-new"/, 'the box is open');
});

test('web: a provider is saved and removed with the server\'s routes, moving nothing, and the answer is drawn', () => {
  const wire = cut('function wireClaudeKey(', '// First start, or Claude is known');
  assert.match(wire, /api\('\/setup\/claude\/provider', \{ method: 'PUT', body \}\)/);
  const picked = cut('function wireProviderForm(', "// The key's links");
  assert.match(picked, /api\('\/setup\/claude\/provider\/models', \{ method: 'POST', body \}\)/);
  assert.match(picked, /big: models\.main, small: models\.helper \|\| models\.main/);
  assert.match(wire, /api\(`\/setup\/claude\/provider\/\$\{encodeURIComponent\(preset\)\}`, \{ method: 'DELETE' \}\)/);
  assert.doesNotMatch(wire, /use: 'provider'/, 'a provider is never "used": its models are picked');
  assert.match(wire, /state\.setup\.claude = r\.claude;/);
  assert.doesNotMatch(app + read('claude-card.js'), /console\.\w+\([^)]*key/i, 'the key is never logged');
});

test('web: saving a provider only redraws from the answer: the server decides whether it becomes the account default', () => {
  const wire = cut('function wireClaudeKey(', '// First start, or Claude is known');
  const grab = /const pform[\s\S]*?tr\('Connected\. Its models are in the Model list\.'\), true\)\);/.exec(wire);
  assert.ok(grab, 'the provider form saves through this');
  assert.match(grab[0], /api\('\/setup\/claude\/provider', \{ method: 'PUT', body \}\)/);
  assert.doesNotMatch(grab[0], /defaultModel|\/settings/, 'the page sets no default model of its own (docs/api.md, PUT /api/setup/claude/provider)');
});
