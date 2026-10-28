// A check of Claude's sign-in that could not tell, on the web page (BUSY-010): the setup checklist's `claude` has
// an `error` then, a sentence, and its `loggedIn` says nothing (docs/api.md, GET /api/setup). The page does not
// open Setup for it and nowhere says "Not signed in": Setup and Settings → Claude show the sentence, and the answer
// to a sign-in or a sign-out that could not be checked is that sentence, not "Signed in" or "Signed out".
// The page's own code, cut out of public/app.js and public/claude-card.js and run against stand-ins.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { app, read, cut, esc, element, finders, words } = require('./web-page');

const COULD_NOT = 'Could not ask Claude Code whether it is signed in.';
const UNKNOWN = { installed: true, loggedIn: false, error: COULD_NOT };
const IN = { installed: true, loggedIn: true, email: 'me@example.com' };
const OUT = { installed: true, loggedIn: false };
const NONE = { installed: false, loggedIn: false };

function page() {
  const toasts = [];
  const ctx = vm.createContext({ ...words, esc, toast: (text, bad = false) => toasts.push([text, bad]) });
  vm.runInContext(`${cut('function setupItem(', 'function drawSetup()')}
    Object.assign(this, { claudeUnknown, opensSetup, claudeSetupItem, toastClaude });`, ctx);
  return { ctx, toasts };
}

test('web: the page opens on Setup at a first start or when Claude is signed out, not for a check that could not tell', () => {
  const { ctx } = page();
  assert.match(app, /const setupNow = await api\('\/setup'\)\.catch\(\(\) => null\);\n {2}if \(opensSetup\(setupNow\)\) \{\n {4}setView\('setup'\);/);
  assert.deepEqual([{ done: true, claude: IN }, { done: true, claude: UNKNOWN }, { done: true, claude: { ...IN, error: COULD_NOT } }, null].map(ctx.opensSetup), [false, false, false, false]);
  assert.deepEqual([{ done: true, claude: OUT }, { done: true, claude: NONE }, { done: true }, { done: false, claude: IN }, { done: false, claude: UNKNOWN }].map(ctx.opensSetup), [true, true, true, true, true]);
});

test('web: Setup shows the sentence of a check that could not tell, not the step "Sign in to Claude" as if it were signed out', () => {
  const { ctx } = page();
  const unknown = ctx.claudeSetupItem(UNKNOWN, false);
  assert.match(unknown, /<h3>✳︎ Claude<\/h3><div class="muted">Could not ask Claude Code whether it is signed in\.<\/div>/);
  assert.doesNotMatch(unknown, /Your bots run on your Claude subscription|Signed in|claude-logout/);
  assert.match(unknown, /id="claude-login"/, 'the way to sign in stays: Claude may be signed out');
  assert.doesNotMatch(ctx.claudeSetupItem(UNKNOWN, true), /id="claude-login"/, 'not while signing in');
  assert.match(ctx.claudeSetupItem({ ...UNKNOWN, error: '<b>x</b>' }, false), /&lt;b&gt;x&lt;\/b&gt;/, 'the sentence is text');
  // As before for what a check can tell.
  assert.match(ctx.claudeSetupItem(IN, false), /setup-item ok[\s\S]*Signed in with <b>me@example\.com<\/b>\.[\s\S]*id="claude-logout"/);
  assert.match(ctx.claudeSetupItem(OUT, false), /setup-item todo[\s\S]*<h3>✳︎ Sign in to Claude<\/h3>[\s\S]*id="claude-login"/);
  assert.match(ctx.claudeSetupItem(NONE, false), /Claude Code isn&#39;t installed|Claude Code isn't installed/);
  assert.doesNotMatch(ctx.claudeSetupItem(NONE, false), /id="claude-login"/);
  const draw = cut('function drawSetup()', "onClick('#restore-open'");
  assert.match(draw, /const unknown = !!claudeUnknown\(c\);\n {2}const keyOpen = !!state\.setupKey && !signingIn;\n {2}const claude = claudeSetupItem\(c, signingIn, keyOpen\)/);
  assert.match(draw, /id="setup-done" \$\{c\.loggedIn \|\| unknown \? '' : 'disabled'\}/, 'the way back to the bots is open');
  assert.match(draw, /<h1>\$\{tr\('Setup'\)\}<\/h1>\$\{unknown \? '' : `<p>\$\{c\.loggedIn \? tr\('botdot is ready\. The rest is up to you\.'\) : tr\('One step and botdot is ready\.'\)\}<\/p>`\}/, 'and no "one step" is asked for');
});

test('web: Settings → Claude shows the sentence, never "Not signed in", for a check that could not tell', async () => {
  const card = element();
  const ctx = vm.createContext({ ...words, ...finders(element({ '#claude-card': card })), esc, state: {}, api: async () => ({ claude: ctx.claude }), toast() {} });
  vm.runInContext(`${cut('const claudeUnknown', '// First start, or Claude is known')}
    ${read('claude-card.js').slice(read('claude-card.js').indexOf('async function loadClaudeCard'))}
    this.loadClaudeCard = loadClaudeCard;`, ctx);
  const drawn = async (claude) => { ctx.claude = claude; await ctx.loadClaudeCard(); return card.innerHTML; };
  const unknown = await drawn(UNKNOWN);
  assert.match(unknown, /<p class="muted settings-hint" style="margin:0">Could not ask Claude Code whether it is signed in\.<\/p>/);
  assert.doesNotMatch(unknown, /Not signed in|claude-logout/);
  assert.match(unknown, /id="claude-login"/);
  assert.match(await drawn(OUT), /Not signed in, so bots can't run\.[\s\S]*id="claude-login"/);
  assert.match(await drawn(IN), /Signed in with <b>me@example\.com<\/b>\.[\s\S]*id="claude-logout"/);
  assert.match(await drawn(NONE), /Claude Code isn't installed on this machine/);
});

test('web: a sign-in or a sign-out whose check could not tell is answered with its sentence, not "Signed in" or "Signed out"', () => {
  const { ctx, toasts } = page();
  ctx.toastClaude(IN, 'Signed in to Claude as me@example.com');
  ctx.toastClaude(OUT, 'Signed out of Claude');
  ctx.toastClaude(UNKNOWN, 'Signed in to Claude');
  ctx.toastClaude(UNKNOWN, 'Signed out of Claude');
  assert.deepEqual(toasts, [['Signed in to Claude as me@example.com', false], ['Signed out of Claude', false], [COULD_NOT, true], [COULD_NOT, true]]);
  for (const file of [app, read('claude-card.js')]) {
    assert.match(file, /toastClaude\(r\.claude, tr\('Signed out of Claude'\)\);/);
    assert.match(file, /toastClaude\(r\.claude, r\.claude\.email \? tr\('Signed in to Claude as \{email\}', \{ email: r\.claude\.email \}\) : tr\('Signed in to Claude'\)\);/);
    assert.doesNotMatch(file, /toast\(['`]Signed (in to|out of) Claude/);
  }
});
