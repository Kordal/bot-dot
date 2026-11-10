// Every bot has the web, changing files, a computer and every other bot to ask (ADR 186): the web page draws no
// switch for any of them and its save sends none; the Android app hides theirs from a server that says so.
// The page's own code, cut out of public/app.js (test/web-page.js); the Android app's, read as text.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { cut } = require('./web-page');

test('web: no switch for messaging, being asked, the web, files or the computer, and the save sends none of them', () => {
  const settings = cut('function renderBotSettings(', '// The bits of the settings page that follow');
  for (const words of ['May message', 'Other bots may ask it', 'Uses the computer', 'othersMayAsk', 'bot-picks']) assert.ok(!settings.includes(words), words);
  const perms = cut('const PERMS = [', '];');
  assert.ok(!/key: '(web|files)'/.test(perms), 'no switch for the web or files');
  const ctx = vm.createContext({ readDisabledSkills: () => [], readLlmFields: () => ({}), hotkeyChanged: () => false });
  vm.runInContext(`${cut('function readBotForm(', '// Its icon (ADR 169)')}\nthis.readBotForm = readBotForm;`, ctx);
  const field = (value, checked = false) => ({ value, checked });
  const form = { name: field('Diary'), color: field('#1d9e75'), description: field(''), group: field(''), prompt: field(''), systemPrompt: field(''), tools: field(''), permissionMode: field('acceptEdits') };
  const sent = ctx.readBotForm(form, { skills: [], connectors: [], accounts: {} });
  for (const key of ['computer', 'mayMessage', 'mayMessageAll', 'othersMayAsk']) assert.ok(!(key in sent), key);
});

test('android: the switches for messaging and the computer show only for a server without everything-allowed', () => {
  const app = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'java', 'dev', 'botdot', 'app');
  const screen = fs.readFileSync(path.join(app, 'ui', 'BotSettingsScreen.kt'), 'utf8');
  assert.match(screen, /val limits = "everything-allowed" !in server\?\.features\.orEmpty\(\)/);
  assert.match(screen, /if \(limits && others\.isNotEmpty\(\)\) FoldSection\(tr\("May message"\)/);
  assert.match(screen, /if \(limits && others\.isNotEmpty\(\) && b\.othersMayAsk != null\) SwitchRow\(tr\("Other bots may ask it"\)/);
  assert.match(screen, /else if \("everything-allowed" !in server\?\.features\.orEmpty\(\)\) SwitchRow\(tr\("Uses the computer"\)/);
});
