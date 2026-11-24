// Every bot has the web, changing files, commands, helpers, a computer and every other bot to ask (ADR 192, ADR 268): the web page draws no
// switch for any of them and its save sends none; the Android app hides theirs from a server that says so.
// The page's own code, cut out of public/app.js (test/web-page.js); the Android app's, read as text.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { cut } = require('./web-page');

test('web: no switch for messaging, being asked, the web, files, commands, helpers or the computer, and the save sends none of them, nor the tools or the mode', () => {
  const settings = cut('function renderBotSettings(', '// The bits of the settings page that follow');
  for (const words of ['May message', 'Other bots may ask it', 'Uses the computer', 'othersMayAsk', 'bot-picks']) assert.ok(!settings.includes(words), words);
  for (const words of ['What it may do', 'data-perm', 'Allowed tools', 'Permission mode']) assert.ok(!settings.includes(words), `${words}: every bot has commands and helpers too (ADR 268)`);
  const ctx = vm.createContext({ readDisabledSkills: () => [], readLlmFields: () => ({}), hotkeyChanged: () => false });
  vm.runInContext(`${cut('function readBotForm(', '// Its icon (ADR 169)')}\nthis.readBotForm = readBotForm;`, ctx);
  const field = (value, checked = false) => ({ value, checked });
  const form = { name: field('Diary'), color: field('#1d9e75'), description: field(''), group: field(''), prompt: field(''), systemPrompt: field('') };
  const sent = ctx.readBotForm(form, { skills: [], connectors: [], accounts: {} });
  for (const key of ['computer', 'mayMessage', 'mayMessageAll', 'othersMayAsk', 'allowedTools', 'permissionMode']) assert.ok(!(key in sent), key);
});

test('android: the switches for messaging and the computer show only for a server without everything-allowed', () => {
  const app = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'java', 'dev', 'botdot', 'app');
  const screen = fs.readFileSync(path.join(app, 'ui', 'BotSettingsScreen.kt'), 'utf8');
  // The rules are the shared layer's (BotSettings, for both phones): the screen asks them, and has no copy of its own.
  assert.match(screen, /val limits = dev\.botdot\.app\.data\.BotSettings\.limits\(server\?\.features\)/);
  assert.match(screen, /if \(limits && others\.isNotEmpty\(\)\) FoldSection\(tr\("May message"\)/);
  assert.match(screen, /if \(dev\.botdot\.app\.data\.BotSettings\.showsOthersMayAsk\(b, others, server\?\.features\)\) SwitchRow\(tr\("Other bots may ask it"\)/);
  assert.match(screen, /else if \(dev\.botdot\.app\.data\.BotSettings\.showsBrowser\(server\?\.features\)\) SwitchRow\(tr\("Browser"\)/);
  assert.ok(!screen.includes('"everything-allowed"'), 'no inline copy of the rule left in the screen');
  // And the shared rules keep it: a server with everything-allowed limits nothing, and shows neither switch.
  const shared = fs.readFileSync(path.join(__dirname, '..', 'android', 'shared', 'src', 'commonMain', 'kotlin', 'dev', 'botdot', 'app', 'data', 'BotSettings.kt'), 'utf8');
  assert.match(shared, /fun limits\(features: Collection<String>\?\): Boolean = "everything-allowed" !in features\.orEmpty\(\)/);
  assert.match(shared, /fun showsBrowser\(features: Collection<String>\?\): Boolean = features != null && limits\(features\)/);
  assert.match(shared, /features != null && limits\(features\) && others\.isNotEmpty\(\) && b\.othersMayAsk != null/);
});
