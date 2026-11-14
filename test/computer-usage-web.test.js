// The account's computer on the web page and in the Android app (#109): its screen dialog lists no bot's memory or CPU
// (the Chief's computer_status has them), and nothing turns the computer off or keeps it on, since it is always on. Deleting a
// bot says what goes: its screen and its browser's logins, not a computer of its own. The page's own code, cut out
// of public/app.js (test/web-page.js); the Android app's, read as text (its build and unit tests run in `make android`).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { app, cut } = require('./web-page');

const screen = cut('function openScreen(', '// Plain-language explanation for a failed or stopped run');
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
    tools: field(''), permissionMode: field('dontAsk') };
  const sent = ctx.readBotForm(form, { skills: [], connectors: [] });
  assert.equal('computer' in sent, false, 'every bot has one (ADR 192): nothing to send');
  assert.equal('computerAlwaysOn' in sent, false);
  // A server that still chooses per bot (#541): this machine or boat.dev.
  for (const where of ['linux', 'boat']) {
    assert.equal(ctx.readBotForm({ ...form, computer: { type: 'select-one', value: where } }, { skills: [], connectors: [] }).computer, where);
  }
});

test("web: deleting a bot says its screen and its browser's logins go, and its folder stays, not that its computer goes", () => {
  assert.doesNotMatch(settings, /its computer \(everything installed on it/);
  assert.doesNotMatch(settings, /Bot and its computer deleted/);
  assert.match(settings, /its screen and its browser's logins on the account's computer/);
  assert.match(settings, /\/workspace\//);
});

test('web: the screen dialog lists no bot\'s memory or CPU', () => {
  assert.doesNotMatch(screen, /usage/);
  assert.doesNotMatch(app, /usageRows|screen-usage/);
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

test("Android: its screen lists no bot's memory or CPU", () => {
  assert.doesNotMatch(kt('ui/LiveScreen.kt'), /\.usage/);
  assert.doesNotMatch(fs.readFileSync(path.join(__dirname, '..', 'android', 'shared', 'src', 'commonMain', 'kotlin', 'dev', 'botdot', 'app', 'data', 'Models.kt'), 'utf8'), /ComputerUsage/);
});

test("web: a bot on boat.dev opens its own machine's desktop and line, with nothing of the account's computer (#564)", () => {
  const boat = cut('function openBoatComputer(', 'function openScreen(');
  assert.doesNotMatch(boat, /screen-reset|screen-update|usage|vnc\.html/, "nothing of the account's computer");
  assert.match(boat, /d\.text/, "the server's words");
  assert.match(boat, /\/computer\/desktop`, \{ method: 'POST'/, 'a new address from the server each time');
  assert.match(boat, /boatFrameUrl\(d\.url\)/, 'in the frame of its own');
  assert.match(boat, /screen-shield/, 'watching until Take control');
  assert.match(cut('const boatFrameUrl', 'function openBoatComputer('), /\/boat-desktop\.html#u=\$\{encodeURIComponent\(url\)\}/, 'the address in the fragment, never sent to botdot');
  assert.match(cut('function openScreen(', '// Plain-language explanation for a failed or stopped run'), /bot\.computer === 'boat'\) return openBoatComputer\(bot\)/);
  // Its runs show no screen: the picture-in-picture and the run's live screen are for the account's computer only.
  assert.match(app, /updatePip\(bot, bot\.computer === 'linux' \?/);
  assert.match(app, /ev\.meta\.computer && ev\.meta\.status === 'running' && state\.bots\.find\(\(b\) => b\.id === ev\.meta\.botId\)\?\.computer === 'linux'/);
  assert.match(app, /part\('bot-screen'\)\.classList\.toggle\('hidden', bot\.computer !== 'linux' && bot\.computer !== 'boat'\)/);
});

test("web: outside Chromium a boat machine's screen is botdot's own viewer, asked with via: vnc, as on the account's computer (ADR 149)", () => {
  const boat = cut('function openBoatComputer(', 'function openScreen(');
  assert.match(cut('const boatViaVnc', 'function openBoatComputer('), /state\.features\.includes\('boat-desktop-vnc'\) && !navigator\.userAgentData/, 'Chromium keeps the stream; an older server keeps it too');
  assert.match(boat, /vnc \? \{ body: \{ via: 'vnc' \} \} : \{\}/);
  assert.match(boat, /<iframe src="\$\{screenUrl\(bot\.id, control\)\}"/, "botdot's noVNC, watching until Take control");
  assert.match(boat, /keepScreenConnected\(/);
  assert.match(boat, /href = vnc \? screenUrl\(bot\.id, control\) : d\.url/, 'full screen is the viewer too');
});
