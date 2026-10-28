// A bot's own key on the keypad (#366) in its settings: a choice on the web page, shown only from a server with
// `bot-hotkeys`, whose save sends hotkey; the same choice in the Android app, shown only when the server sends the
// field. The page's own code, cut out of public/app.js (test/web-page.js); the Android app's, read as text (its build
// and unit tests run in `make android-test`).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { cut, words } = require('./web-page');

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

test("web: the settings offer the key from a server with bot-hotkeys, each digit another bot holds named", () => {
  const settings = cut('function renderBotSettings(', '// The bits of the settings page that follow');
  assert.match(settings, /\$\{state\.features\.includes\('bot-hotkeys'\) \? hotkeyRow\(b\) : ''\}/);
  const ctx = vm.createContext({ ...words, esc, state: { bots: [{ id: 'a', name: 'Coder', hotkey: 0 }, { id: 'b', name: 'Mail', hotkey: 3 }] } });
  vm.runInContext(`${cut("const CHEV = ", '// A change on a settings screen saves by itself')}
    ${cut('function hotkeyRow(', 'function renderBotSettings(')}\nthis.hotkeyRow = hotkeyRow;`, ctx);
  const row = ctx.hotkeyRow({ id: 'a', hotkey: 0 });
  // A row of the flat list (#635): "Key" left, the choice right as its value; what the key does is its tooltip.
  assert.match(row, /^<label class="bs-row" title="Its digit on the keypad in a wide window[^"]*" aria-description="[^"]*"><b>Key<\/b>/);
  assert.match(row, /<select name="hotkey" aria-label="Key on the keypad">/, 'its full name for a screen reader');
  assert.match(row, /<option value="0" selected>By its place<\/option>/);
  assert.match(row, /<option value="3" >3 \(now Mail\)<\/option>/);
  assert.match(row, /<option value="5" >5<\/option>/);
  assert.match(ctx.hotkeyRow({ id: 'b', hotkey: 3 }), /<option value="3" selected>3<\/option>/, 'its own digit, not "now" its own');
});

test('web: the key\'s choice stands right of its label as its value, no wider than its share, in a wide window and on a phone', () => {
  const { read } = require('./web-page');
  const { rulesAt, winner } = require('./css-rules');
  const SELECT = [{ tag: 'div', classes: ['set-list'], index: 3 }, { tag: 'label', classes: ['bs-row'], index: 2 }, { tag: 'select', classes: [], index: 2 }];
  for (const wide of [1400, 900, 390]) {
    const rules = rulesAt(read('style.css'), wide);
    assert.equal(winner(rules, SELECT, 'width').value, 'auto', `${wide}: not the full width that covers the label`);
    assert.equal(winner(rules, SELECT, 'flex').value, 'none', `${wide}`);
    assert.equal(winner(rules, SELECT, 'max-width').value, '55%', `${wide}: the label keeps the rest`);
    assert.equal(winner(rules, SELECT, 'border').value, '0', `${wide}: a value, not a box`);
  }
});

test('web: saving sends hotkey as a number once it was chosen, and nothing where it was not or is not shown', () => {
  const ctx = vm.createContext({ ...words, readDisabledSkills: () => [], readLlmFields: () => ({}) });
  vm.runInContext(`${cut('function readBotForm(', '// Switched-off machine/built-in skills')}\nthis.readBotForm = readBotForm;`, ctx);
  const field = (value, checked = false) => ({ value, checked });
  const form = (more = {}) => ({ name: field('Coder'), color: field('#1d9e75'), description: field(''), group: field(''), prompt: field(''), systemPrompt: field(''),
    computer: field(''), othersMayAsk: field('', true), tools: field(''), permissionMode: field('dontAsk'), ...more });
  const sel = { skills: [], connectors: [], others: [], mayMessage: new Set() };
  // A select drawn with `drawn` selected, now showing `value`.
  const select = (drawn, value) => ({ value, options: ['0', '3', '7'].map((v) => ({ value: v, defaultSelected: v === drawn })) });
  assert.equal(ctx.readBotForm(form({ hotkey: select('0', '7') }), sel).hotkey, 7);
  assert.equal(ctx.readBotForm(form({ hotkey: select('3', '0') }), sel).hotkey, 0);
  assert.ok(!('hotkey' in ctx.readBotForm(form({ hotkey: select('3', '3') }), sel)), 'as drawn: not sent');
  assert.ok(!('hotkey' in ctx.readBotForm(form(), sel)));
});

test('android: the bot has hotkey, and its settings offer it only when the server sends it', () => {
  const app = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'java', 'dev', 'botdot', 'app');
  const models = fs.readFileSync(path.join(app, 'data', 'Models.kt'), 'utf8');
  const screen = fs.readFileSync(path.join(app, 'ui', 'BotSettingsScreen.kt'), 'utf8');
  assert.match(models, /val hotkey: Int\? = null/);
  assert.match(screen, /if \(b\.hotkey != null\) FoldSection\(tr\("Key on the keypad"\)/);
  assert.match(screen, /if \(b\.hotkey != null && hotkey != b\.hotkey\) put\("hotkey", hotkey\)/);
});
