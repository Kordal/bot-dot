// The web page's side of Claude on an Anthropic API key (#35): Setup and Settings → Claude say which of the two
// bots run on, name the other as not used when both are there, offer the key as the other way to run, and save,
// pick and remove it with the server's routes (docs/api.md, Setup and updates). The key is typed in a password
// field and never drawn. The page's own code, cut out of public/app.js and public/claude-card.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { app, read, cut, esc, element, finders } = require('./web-page');

const SUB = { installed: true, loggedIn: true, email: 'me@example.com', using: 'subscription', apiKey: null, subscription: true };
const SUB_AND_KEY = { ...SUB, apiKey: '…wxyz' };
const KEY_AND_SUB = { ...SUB_AND_KEY, using: 'api-key' };
const KEY_ONLY = { installed: true, loggedIn: true, email: null, using: 'api-key', apiKey: '…wxyz', subscription: false };
const NOTHING = { installed: true, loggedIn: false, using: 'subscription', apiKey: null, subscription: false };
const OLD_SERVER = { installed: true, loggedIn: false }; // a status with no `using`

function page() {
  const ctx = vm.createContext({ esc, toast() {}, state: {} });
  vm.runInContext(`${cut('function setupItem(', 'function drawSetup()')}
    Object.assign(this, { claudeSetupItem, claudeKeyBox });`, ctx);
  return ctx;
}

test('web: Setup says which one bots run on, and names the other as not used when both are there', () => {
  const ctx = page();
  const onKey = ctx.claudeSetupItem(KEY_AND_SUB, false);
  assert.match(onKey, /setup-item ok[\s\S]*Bots run on your Anthropic API key <b>…wxyz<\/b>\. Your Claude subscription \(<b>me@example\.com<\/b>\) is signed in too; bots don't use it\./);
  assert.match(onKey, /id="claude-use-sub">Use the subscription instead<\/button>[\s\S]*id="claude-key-remove">Remove the key<\/button>/);
  assert.doesNotMatch(onKey, /claude-logout|claude-use-key/);

  const onSub = ctx.claudeSetupItem(SUB_AND_KEY, false);
  assert.match(onSub, /Signed in with <b>me@example\.com<\/b>\. An Anthropic API key \(<b>…wxyz<\/b>\) is saved too; bots don't use it\./);
  assert.match(onSub, /id="claude-logout"[\s\S]*id="claude-use-key">Use the API key instead<\/button>/);

  const keyOnly = ctx.claudeSetupItem(KEY_ONLY, false);
  assert.match(keyOnly, /Bots run on your Anthropic API key <b>…wxyz<\/b>\.<\/div>/, 'no word of a subscription that is not there');
  assert.doesNotMatch(keyOnly, /claude-use-sub/);
  assert.match(keyOnly, /id="claude-key-remove"/);
});

test('web: with neither, Setup offers the key beside the sign-in; one subscription alone offers it as the other way', () => {
  const ctx = page();
  const none = ctx.claudeSetupItem(NOTHING, false);
  assert.match(none, /setup-item todo[\s\S]*Or run them on an Anthropic API key\.[\s\S]*id="claude-login"[\s\S]*id="claude-key-new">Use an API key instead<\/button>/);
  assert.match(ctx.claudeSetupItem(SUB, false), /id="claude-key-new">Use an API key instead<\/button>/);
  assert.doesNotMatch(ctx.claudeSetupItem(NOTHING, true), /claude-key-new/, 'not while signing in');
  assert.doesNotMatch(ctx.claudeSetupItem(OLD_SERVER, false), /claude-key|API key/, 'nothing of a key from a server that says nothing of one');
  const box = ctx.claudeKeyBox(false);
  assert.match(box, /<form id="claude-key-form"[\s\S]*<input type="password" name="key" placeholder="sk-ant-…" autocomplete="off"/);
  assert.match(box, /id="claude-key-cancel"/);
});

test('web: Settings → Claude says the same, and the key box opens there', async () => {
  const card = element();
  const ctx = vm.createContext({ ...finders(element({ '#claude-card': card })), esc, state: {}, api: async () => ({ claude: ctx.claude }), toast() {} });
  vm.runInContext(`${cut('const claudeUnknown', '// First start, or Claude is known')}
    ${read('claude-card.js').slice(read('claude-card.js').indexOf('async function loadClaudeCard'))}
    this.loadClaudeCard = loadClaudeCard;`, ctx);
  const drawn = async (claude) => { ctx.claude = claude; await ctx.loadClaudeCard(); return card.innerHTML; };
  assert.match(await drawn(KEY_AND_SUB), /Bots run on your Anthropic API key <b>…wxyz<\/b>\. Your Claude subscription \(<b>me@example\.com<\/b>\) is signed in too; bots don't use it\.[\s\S]*id="claude-use-sub"[\s\S]*id="claude-key-remove"/);
  assert.match(await drawn(SUB_AND_KEY), /An Anthropic API key \(<b>…wxyz<\/b>\) is saved too; bots don't use it\.[\s\S]*id="claude-use-key"/);
  assert.match(await drawn(NOTHING), /Not signed in, so bots can't run\.[\s\S]*id="claude-login"[\s\S]*id="claude-key-new"/);
  ctx.state.setupKey = true;
  ctx.claude = NOTHING;
  await ctx.loadClaudeCard(false);
  assert.match(card.innerHTML, /id="claude-key-form"/);
  assert.doesNotMatch(card.innerHTML, /id="claude-key-new"/, 'the box is open');
});

test('web: the key is saved, picked and removed with the server\'s routes, and the answer is drawn', () => {
  const wire = cut('function wireClaudeKey(', '// First start, or Claude is known');
  assert.match(wire, /api\('\/setup\/claude\/key', \{ method: 'PUT', body: \{ key: form\.key\.value \} \}\)/);
  assert.match(wire, /api\('\/setup\/claude\/use', \{ method: 'PUT', body: \{ use: 'api-key' \} \}\)/);
  assert.match(wire, /api\('\/setup\/claude\/use', \{ method: 'PUT', body: \{ use: 'subscription' \} \}\)/);
  assert.match(wire, /api\('\/setup\/claude\/key', \{ method: 'DELETE' \}\)/);
  assert.match(wire, /state\.setup\.claude = r\.claude;/);
  for (const file of [cut('function drawSetup()', "onClick('#tz-use'"), read('claude-card.js')]) assert.match(file, /wireClaudeKey\(/);
  assert.doesNotMatch(app + read('claude-card.js'), /console\.\w+\([^)]*key/i, 'the key is never logged');
});
