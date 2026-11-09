// The owner picks a bot's icon in its settings (ADR 169, docs/decisions/2026-11-09-the-owner-picks-a-bots-icon.md):
// a tap on the figure opens the kit's icons, a pick saves outfit.icon and keeps the hat. The web page's code is run
// cut out of its files; the Android app's is read as text (its build and unit tests run in `make android`).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { cut } = require('./web-page');
const { startServer, makeBot } = require('./helpers');
const DEF = require('../lib/figure.json');

function loadFigure() {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'figure.js'), 'utf8'), ctx);
  return ctx.Figure;
}
const copy = (v) => JSON.parse(JSON.stringify(v));

test('web: Figure.icons() is every kit icon but the Chief\'s, with what it shows, and none without a tile', () => {
  const Figure = loadFigure();
  Figure.use(copy(DEF));
  const icons = Figure.icons();
  const kit = Object.keys(DEF.kit.icon.pieces);
  assert.deepEqual([...icons.map((i) => i.name)], kit.filter((n) => n !== DEF.chief.outfit.icon));
  assert.ok(!icons.some((i) => i.name === 'compass'));
  const news = icons.find((i) => i.name === 'news');
  assert.ok(news.label && !news.label.includes(':'), news.label);
  const noTile = copy(DEF);
  delete noTile.tile;
  delete noTile.kit.icon;
  const Old = loadFigure();
  Old.use(noTile);
  assert.deepEqual([...Old.icons()], []);
});

test('web: the figure opens the icons, and a pick is saved as outfit.icon only once one is ticked', () => {
  const settings = cut('function renderBotSettings(', '// The bits of the settings page that follow');
  assert.match(settings, /id="bs-figure" class="bs-figure" aria-expanded="false" aria-controls="bs-icons"/);
  assert.match(settings, /\$\{iconPicks\(b\)\}/);
  const picks = cut('function iconPicks(', '// The icons drawn again');
  assert.match(picks, /type="radio" name="icon"/);
  const ctx = vm.createContext({ readDisabledSkills: () => [], readLlmFields: () => ({}), hotkeyChanged: () => false });
  vm.runInContext(`${cut('function readBotForm(', '// Switched-off machine/built-in skills')}\nthis.readBotForm = readBotForm;`, ctx);
  const field = (value, checked = false) => ({ value, checked });
  const form = (icon) => ({ name: field('Diary'), color: field('#1d9e75'), description: field(''), group: field(''), prompt: field(''), systemPrompt: field(''),
    computer: field(''), othersMayAsk: field('', true), tools: field(''), permissionMode: field('dontAsk'), ...(icon === undefined ? {} : { icon: field(icon) }) });
  const sel = { skills: [], connectors: [], others: [], mayMessage: new Set() };
  assert.equal(ctx.readBotForm(form(undefined), sel).outfit, undefined); // no picker drawn
  assert.equal(ctx.readBotForm(form(''), sel).outfit, undefined); // none ticked: nothing to send
  assert.deepEqual({ ...ctx.readBotForm(form('server'), sel).outfit }, { icon: 'server' });
});

test('server: the owner\'s pick changes the icon and keeps the hat; the Chief\'s compass and unknown names are refused', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const b = await makeBot(srv, { name: 'Diary', outfit: { hat: 'cap', icon: 'news' } });
  const r = await srv.api(`/bots/${b.id}`, { method: 'PUT', body: { outfit: { icon: 'server' } } });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data.outfit, { hat: 'cap', icon: 'server' });
  const bad = await srv.api(`/bots/${b.id}`, { method: 'PUT', body: { outfit: { icon: 'no-such-icon' } } });
  assert.equal(bad.status, 400);
  assert.deepEqual((await srv.api('/bots')).data.find((x) => x.id === b.id).outfit, { hat: 'cap', icon: 'server' });
});

test('android: the figure opens the icons, and a pick is sent as outfit.icon', () => {
  const app = path.join(__dirname, '..', 'android', 'app', 'src', 'main', 'java', 'dev', 'botdot', 'app');
  const screen = fs.readFileSync(path.join(app, 'ui', 'BotSettingsScreen.kt'), 'utf8');
  const figure = fs.readFileSync(path.join(app, 'data', 'Figure.kt'), 'utf8');
  assert.match(figure, /val iconChoices: List<Pair<String, String>>/);
  assert.match(figure, /if \(tile == null\) return@lazy emptyList\(\)/);
  assert.match(screen, /clickable\(onClickLabel = tr\("Icon"\)\) \{ picking = !picking \}/);
  assert.match(screen, /if \(picking && icons\.isNotEmpty\(\)\) IconPicker\(icons, icon, color\) \{ icon = it \}/);
  assert.match(screen, /if \(icon\.isNotEmpty\(\) && icon != iconOf\(b\.outfit\)\) put\("outfit", buildJsonObject \{ put\("icon", icon\) \}\)/);
  assert.match(screen, /LaunchedEffect\(color, icon, name,/);
});
