// The account's computer on the web page and in the Android app (#109): its screen dialog shows what each bot uses
// of it, in the server's words, and nothing turns the computer off or keeps it on, since it is always on. Deleting a
// bot says what goes: its screen and its browser's logins, not a computer of its own. The page's own code, cut out
// of public/app.js (test/web-page.js); the Android app's, read as text (its build and unit tests run in `make android`).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { app, cut } = require('./web-page');

const screen = cut('function computerLabel(', '// Plain-language explanation for a failed or stopped run');
const settings = cut('function renderBotSettings(', '// The bits of the settings page that follow');

test('web: the screen dialog has no "Turn off", "Turn on" or "Always on", and asks the server to stop nothing', () => {
  assert.doesNotMatch(screen, /screen-power|Turn off|Turn on|Always on|always on/);
  assert.doesNotMatch(screen, /act\('stop'|computerAlwaysOn/);
});

test('web: a bot\'s settings have no "Keep its computer on", and saving sends no computerAlwaysOn', () => {
  assert.doesNotMatch(app, /Keep its computer on|computerAlwaysOn/);
  const ctx = vm.createContext({ readDisabledSkills: () => [], readLlmFields: () => ({}) });
  vm.runInContext(`${cut('function readBotForm(', '// Switched-off machine/built-in skills')}\nthis.readBotForm = readBotForm;`, ctx);
  const field = (value, checked = false) => ({ value, checked });
  const form = { name: field('Coder'), color: field('#1d9e75'), description: field(''), group: field(''), prompt: field(''), systemPrompt: field(''),
    computer: field('', true), othersMayAsk: field('', true), tools: field(''), permissionMode: field('dontAsk') };
  const sent = ctx.readBotForm(form, { skills: [], connectors: [], others: [], mayMessage: new Set() });
  assert.equal(sent.computer, 'linux');
  assert.equal('computerAlwaysOn' in sent, false);
  // Once boat.dev is set up it is one choice (#541): none, this machine or boat.dev.
  for (const where of ['none', 'linux', 'boat']) {
    assert.equal(ctx.readBotForm({ ...form, computer: { type: 'select-one', value: where } }, { skills: [], connectors: [], others: [], mayMessage: new Set() }).computer, where);
  }
});

test("web: deleting a bot says its screen and its browser's logins go, and its folder stays, not that its computer goes", () => {
  assert.doesNotMatch(settings, /its computer \(everything installed on it/);
  assert.doesNotMatch(settings, /Bot and its computer deleted/);
  assert.match(settings, /its screen and its browser's logins on the account's computer/);
  assert.match(settings, /\/workspace\//);
});

test("web: the screen dialog lists each bot's memory and CPU as the server words them, and nothing without them", () => {
  const ctx = vm.createContext({ esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`) });
  vm.runInContext(`${cut('function usageRows(', 'function openScreen(')}\nthis.usageRows = usageRows;`, ctx);
  const html = ctx.usageRows({
    text: "What each bot's programs use now. 100% CPU is one CPU.",
    bots: [{ id: 's', name: 'Scout <b>', text: '1.6 GB memory · 88% CPU' }, { id: 'c', name: 'Coder', text: 'nothing running' }],
    other: { text: '300 MB memory · 1% CPU' },
  });
  assert.match(html, /Scout &#60;b&#62;/, 'a name is text, never markup');
  assert.match(html, /1\.6 GB memory · 88% CPU/);
  assert.match(html, /nothing running/);
  assert.match(html, /300 MB memory · 1% CPU/);
  assert.match(html, /100% CPU is one CPU/);
  assert.ok(html.indexOf('Scout') < html.indexOf('Coder'), "in the server's order");
  assert.equal(ctx.usageRows(undefined), '', 'an older server, or a stopped computer');
});

// ---------- Android ----------
const UI = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'java', 'dev', 'botdot', 'app');
const kt = (f) => fs.readFileSync(path.join(UI, f), 'utf8');

test('Android: a bot\'s settings have no "Keep its computer on" and send no computerAlwaysOn; the delete dialog is right', () => {
  const s = kt('ui/BotSettingsScreen.kt');
  assert.doesNotMatch(s, /Keep its computer on|computerAlwaysOn|alwaysOn/);
  assert.doesNotMatch(s, /so do its computer/);
  assert.match(s, /its screen and its browser's logins on the account's computer/);
});

test("Android: its screen shows each bot's memory and CPU from the server", () => {
  assert.match(kt('ui/LiveScreen.kt'), /info\?\.usage/);
  assert.match(kt('data/Models.kt'), /val usage: ComputerUsage\? = null/);
});

test("web: a bot on boat.dev opens its own machine's desktop and line, with nothing of the account's computer (#564)", () => {
  const boat = cut('function openBoatComputer(', 'function openScreen(');
  assert.doesNotMatch(boat, /screen-reset|screen-update|usage|vnc\.html/, "nothing of the account's computer");
  assert.match(boat, /d\.text/, "the server's words");
  assert.match(boat, /\/computer\/desktop`, \{ method: 'POST' \}/, 'a new address from the server each time');
  assert.match(boat, /boatFrameUrl\(d\.url\)/, 'in the frame of its own');
  assert.match(boat, /screen-shield/, 'watching until Take control');
  assert.match(cut('const boatFrameUrl', 'function openBoatComputer('), /\/boat-desktop\.html#u=\$\{encodeURIComponent\(url\)\}/, 'the address in the fragment, never sent to botdot');
  assert.match(cut('function openScreen(', '// Plain-language explanation for a failed or stopped run'), /bot\.computer === 'boat'\) return openBoatComputer\(bot\)/);
  // Its runs show no screen: the picture-in-picture and the run's live screen are for the account's computer only.
  assert.match(app, /updatePip\(bot, bot\.computer === 'linux' \?/);
  assert.match(app, /ev\.meta\.computer && ev\.meta\.status === 'running' && state\.bots\.find\(\(b\) => b\.id === ev\.meta\.botId\)\?\.computer === 'linux'/);
  assert.match(app, /'#bot-screen'\)\.classList\.toggle\('hidden', bot\.computer !== 'linux' && bot\.computer !== 'boat'\)/);
});
