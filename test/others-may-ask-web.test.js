// "Other bots may ask it" (#136) in a bot's settings: a switch on the web page whose save sends othersMayAsk, and
// the same switch in the Android app, shown only when the server sends the field. The page's own code, cut out of
// public/app.js (test/web-page.js); the Android app's, read as text (its build and unit tests run in `make android`).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { cut } = require('./web-page');

test('web: the settings have the switch, and saving sends othersMayAsk as it is ticked', () => {
  const settings = cut('function renderBotSettings(', '// The bits of the settings page that follow');
  assert.match(settings, /<b>\$\{tr\('Other bots may ask it'\)\}<\/b>/);
  assert.match(settings, /name="othersMayAsk" \$\{b\.othersMayAsk !== false \? 'checked' : ''\}/);
  const ctx = vm.createContext({ readDisabledSkills: () => [], readLlmFields: () => ({}) });
  vm.runInContext(`${cut('function readBotForm(', '// Switched-off machine/built-in skills')}\nthis.readBotForm = readBotForm;`, ctx);
  const field = (value, checked = false) => ({ value, checked });
  const form = (ask) => ({ name: field('Diary'), color: field('#1d9e75'), description: field(''), group: field(''), prompt: field(''), systemPrompt: field(''),
    computer: field(''), othersMayAsk: field('', ask), tools: field(''), permissionMode: field('dontAsk') });
  const sel = { skills: [], connectors: [], others: [], mayMessage: new Set() };
  assert.equal(ctx.readBotForm(form(false), sel).othersMayAsk, false);
  assert.equal(ctx.readBotForm(form(true), sel).othersMayAsk, true);
});

test('android: the bot has othersMayAsk, and its settings show the switch only when the server sends it', () => {
  const app = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'java', 'dev', 'botdot', 'app');
  const models = fs.readFileSync(path.join(app, 'data', 'Models.kt'), 'utf8');
  const screen = fs.readFileSync(path.join(app, 'ui', 'BotSettingsScreen.kt'), 'utf8');
  assert.match(models, /val othersMayAsk: Boolean\? = null/);
  assert.match(screen, /if \(others\.isNotEmpty\(\) && b\.othersMayAsk != null\) SwitchRow\(tr\("Other bots may ask it"\), checked = othersMayAsk\)/, 'a row of its group (#728)');
  assert.match(screen, /if \(b\.othersMayAsk != null && othersMayAsk != b\.othersMayAsk\) put\("othersMayAsk", othersMayAsk\)/);
});
