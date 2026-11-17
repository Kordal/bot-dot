// The web page's side of Claude on another model provider (ADR 255): Setup and Settings → Claude say which one bots
// run on (the provider, with its key's last four), name a saved one or a signed-in subscription as not used, offer the
// provider as one more way to run, and save, pick and remove it with the server's routes (docs/api.md, Setup and
// updates). The key is typed in a password field and never drawn; the presets are the server's, not the page's.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { app, read, cut, esc, element, finders, words } = require('./web-page');

const PRESETS = [
  { id: 'deepseek', name: 'DeepSeek', url: 'https://api.deepseek.com/anthropic', big: 'deepseek-v4-pro', small: 'deepseek-flash' },
  { id: 'ollama', name: 'Ollama', url: '', big: '', small: '', keyless: true, askUrl: true },
  { id: 'custom', name: 'Other', url: '', big: '', small: '', custom: true, askUrl: true },
];
const SAVED = { preset: 'deepseek', name: 'DeepSeek', key: '…wxyz', big: 'deepseek-v4-pro', small: 'deepseek-flash' };
const SUB = { installed: true, loggedIn: true, email: 'me@example.com', using: 'subscription', apiKey: null, subscription: true, provider: null };
const ON_PROVIDER = { ...SUB, using: 'provider', provider: SAVED };
const PROVIDER_ONLY = { installed: true, loggedIn: true, email: null, using: 'provider', apiKey: null, subscription: false, provider: SAVED };
const SUB_AND_PROVIDER = { ...SUB, provider: SAVED };

function page(state = { setup: { providers: PRESETS } }) {
  const ctx = vm.createContext({ ...words, esc, toast() {}, state });
  vm.runInContext(`${cut('function setupItem(', 'function drawSetup()')}
    Object.assign(this, { claudeSetupItem, claudeProviderBox });`, ctx);
  return ctx;
}

test('web: on a provider Setup says so with its key, and names a signed-in subscription as not used', () => {
  const ctx = page();
  const on = ctx.claudeSetupItem(ON_PROVIDER, false);
  assert.match(on, /setup-item ok[\s\S]*Bots run on DeepSeek \(<b>…wxyz<\/b>\)\. Your Claude subscription \(<b>me@example\.com<\/b>\) is signed in too; bots don't use it\./);
  assert.match(on, /id="claude-use-sub">Use the subscription instead<\/button>[\s\S]*id="claude-provider-new">Change provider<\/button>[\s\S]*id="claude-provider-remove">Remove the provider<\/button>/);
  assert.doesNotMatch(on, /claude-logout|claude-use-provider|claude-key-new/);
  const only = ctx.claudeSetupItem(PROVIDER_ONLY, false);
  assert.match(only, /Bots run on DeepSeek \(<b>…wxyz<\/b>\)\.<\/div>/, 'no word of a subscription that is not there');
  assert.doesNotMatch(only, /claude-use-sub/);
});

test('web: on the subscription a saved provider is named as not used, and another can be chosen', () => {
  const ctx = page();
  const saved = ctx.claudeSetupItem(SUB_AND_PROVIDER, false);
  assert.match(saved, /Signed in with <b>me@example\.com<\/b>\. DeepSeek is saved too; bots don't use it\./);
  assert.match(saved, /id="claude-use-provider">Use DeepSeek instead<\/button>/);
  const none = ctx.claudeSetupItem(SUB, false);
  assert.match(none, /id="claude-key-new">Use an API key instead<\/button>[\s\S]*id="claude-provider-new">Use another provider<\/button>/);
  assert.doesNotMatch(ctx.claudeSetupItem(SUB, true), /claude-provider-new/, 'not while a box is open');
  const old = page({ setup: {} }).claudeSetupItem({ installed: true, loggedIn: true, email: 'me@example.com', using: 'subscription', apiKey: null, subscription: true }, false);
  assert.doesNotMatch(old, /provider/i, 'nothing of a provider from a server that offers none');
});

test('web: the provider box lists the server\'s presets, hides what a preset does not need, and shows no key', () => {
  const box = page().claudeProviderBox(false);
  assert.match(box, /<form id="claude-provider-form"[\s\S]*<select name="preset"><option value="deepseek">DeepSeek<\/option><option value="ollama">Ollama<\/option><option value="custom">Other<\/option><\/select>/);
  assert.match(box, /<input type="password" name="key" placeholder="API key" autocomplete="off"/);
  assert.match(box, /name="url"[^>]* hidden>/, 'the address only where the owner gives it');
  assert.match(box, /<select name="bigChoice" aria-label="Main model"/);
  assert.match(box, /<select name="smallChoice" aria-label="Helper model"/);
  assert.match(box, /id="claude-provider-cancel"/);
  const again = page({ setup: { providers: PRESETS, claude: { provider: { ...SAVED, preset: 'custom' } } } }).claudeProviderBox(true);
  assert.match(again, /<option value="custom" selected>Other<\/option>/, 'the saved provider is the one chosen');
});

test('web: model settings show the active provider and its reasoning levels', () => {
  const main = 'provider:deepseek:deepseek-v4-pro';
  const helper = 'provider:deepseek:deepseek-flash';
  const state = {
    models: [
      { id: main, label: 'deepseek-v4-pro', group: 'DeepSeek', effort: true },
      { id: helper, label: 'deepseek-flash', group: 'DeepSeek', effort: true },
    ],
    efforts: [{ id: 'max', label: 'Max' }],
    modelProvider: { name: 'DeepSeek', main, helper },
  };
  const ctx = vm.createContext({ ...words, esc, state });
  const source = read('settings.js');
  vm.runInContext(source.slice(source.indexOf('function shownModel'), source.indexOf('// ---------- the rows of a settings screen')) + '\nthis.llmFieldsHTML = llmFieldsHTML;', ctx);
  const form = ctx.llmFieldsHTML('bot', { model: 'haiku', effort: 'max' });
  assert.match(form, /value="provider:deepseek:deepseek-flash" selected>deepseek-flash/);
  assert.match(form, /value="max" selected>Max/);
  assert.doesNotMatch(form, /Another model|Claude Code's default/);
});

test('web: Settings → Claude says the same, and the provider box opens there', async () => {
  const card = element();
  const state = { setup: { providers: PRESETS } };
  const ctx = vm.createContext({ ...words, ...finders(element({ '#claude-card': card })), esc, state, api: async () => ({ claude: ctx.claude }), toast() {} });
  vm.runInContext(`${cut('const claudeUnknown', '// First start, or Claude is known')}
    ${read('claude-card.js').slice(read('claude-card.js').indexOf('async function loadClaudeCard'))}
    this.loadClaudeCard = loadClaudeCard;`, ctx);
  ctx.claude = ON_PROVIDER;
  await ctx.loadClaudeCard();
  assert.match(card.innerHTML, /Bots run on DeepSeek \(<b>…wxyz<\/b>\)\.[\s\S]*id="claude-provider-new"/);
  ctx.claude = SUB;
  state.setupProvider = true;
  await ctx.loadClaudeCard(false);
  assert.match(card.innerHTML, /id="claude-provider-form"/);
  assert.doesNotMatch(card.innerHTML, /id="claude-provider-new"/, 'the box is open');
});

test('web: the provider is saved, picked and removed with the server\'s routes, and the answer is drawn', () => {
  const wire = cut('function wireClaudeKey(', '// First start, or Claude is known');
  assert.match(wire, /api\('\/setup\/claude\/provider', \{ method: 'PUT', body \}\)/);
  assert.match(wire, /body = \{ preset: pform\.preset\.value, key: pform\.key\.value, big: pform\.big\.value, small: pform\.small\.value \}/);
  assert.match(wire, /api\('\/setup\/claude\/use', \{ method: 'PUT', body: \{ use: 'provider' \} \}\)/);
  assert.match(wire, /api\('\/setup\/claude\/provider', \{ method: 'DELETE' \}\)/);
  assert.match(wire, /state\.setup\.claude = r\.claude;/);
  assert.doesNotMatch(app + read('claude-card.js'), /console\.\w+\([^)]*key/i, 'the key is never logged');
});

test('web: switching a provider from Settings rebuilds the Settings panel immediately', async () => {
  const use = {};
  const settings = element({ '#claude-use-provider': use });
  const state = { setup: { claude: SUB_AND_PROVIDER } };
  const calls = [];
  const ctx = vm.createContext({
    ...words, ...finders(element({ '#view-settings': settings })),
    state, toastClaude() {}, toast() {},
    api: async (path) => path === '/settings' ? { provider: { name: 'DeepSeek' } } : { claude: ON_PROVIDER },
    panelPage: () => 'settings',
    renderSettings: () => calls.push('settings'),
  });
  vm.runInContext(cut('function wireClaudeKey(', '// First start, or Claude is known') + '\nthis.wireClaudeKey = wireClaudeKey;', ctx);
  ctx.wireClaudeKey(settings, SUB_AND_PROVIDER, () => calls.push('card'));
  await use.onclick();
  assert.deepEqual(calls, ['settings', 'card']);
  assert.equal(state.modelProvider.name, 'DeepSeek');
});
