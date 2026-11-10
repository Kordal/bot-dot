// Advanced on the web page (ADR 186): one switch at the end of Settings; while it is off the page leaves out the
// technical rows (the models, a bot's commands, helpers, exact tools and permission mode, a run's folder and
// `claude --resume`), and a server without the switch shows them all, as before.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { read, cut } = require('./web-page');

const settings = read('settings.js');
const bots = read('bots.js');

test('web: advanced() is on for a server without the switch, and follows the account otherwise', () => {
  const ctx = vm.createContext({ state: { features: [], settings: { advanced: false } } });
  vm.runInContext(`${cut('const advanced = ', '\n')}; this.advanced = advanced;`, ctx);
  assert.equal(ctx.advanced(), true, 'an older server: everything shows');
  ctx.state.features = ['advanced'];
  assert.equal(ctx.advanced(), false);
  ctx.state.settings.advanced = true;
  assert.equal(ctx.advanced(), true);
  ctx.state.settings = null;
  assert.equal(ctx.advanced(), true, 'before the settings are read nothing is taken away');
});

test('web: Settings ends with the Advanced switch, saved by itself, and draws again', () => {
  assert.match(settings, /state\.features\.includes\('advanced'\) \? `<label class="bs-row"><b>\$\{tr\('Advanced'\)\}<\/b><span class="switch"><input type="checkbox" id="settings-advanced"/);
  const wire = settings.slice(settings.indexOf('function wireAdvanced(root)'), settings.indexOf('// The interface\'s language'));
  assert.match(wire, /api\('\/settings', \{ method: 'PUT', body: \{ advanced: box\.checked \} \}\)/);
  assert.match(wire, /renderSettings\(\);/);
  assert.match(wire, /render\(\);/, 'every screen draws again');
});

test('web: without Advanced, Settings leaves out the model, the proxy and the bots with a model of their own', () => {
  const i = settings.indexOf('${advanced() ? `<details class="bs-row bs-more" id="settings-model">');
  assert.ok(i > 0);
  const j = settings.indexOf("` : ''}", settings.indexOf('Bots with their own model', i));
  const part = settings.slice(i, j);
  assert.match(part, /Proxies\.rowHTML\(\)/);
  assert.match(part, /Bots with their own model/);
  assert.match(settings, /const form = \$\('#settings-form', root\);\n  if \(!form\) return;/, 'no model row: nothing to wire');
  assert.match(settings, /id="chief-model"\$\{advanced\(\) \? '' : ' hidden'\}/, "the Chief's model too");
});

test('web: without Advanced, a bot keeps files and the web; commands, helpers, exact tools and its model are hidden, not dropped', () => {
  assert.match(bots, /key: 'bash'[^\n]*advanced: true/);
  assert.match(bots, /key: 'helpers'[^\n]*advanced: true/);
  assert.doesNotMatch(bots.match(/key: 'files'[^\n]*/)[0] + bots.match(/key: 'web'[^\n]*/)[0], /advanced/);
  assert.match(bots, /\$\{p\.advanced && !advanced\(\) \? ' hidden' : ''\}><input type="checkbox" data-perm=/, 'still in the form: what is saved stays');
  assert.match(bots, /<details class="bs-exact"\$\{advanced\(\) \? '' : ' hidden'\}/);
  assert.match(bots, /id="bs-model"\$\{advanced\(\) \? '' : ' hidden'\}/);
  assert.match(read('style.css'), /\.set-list \[hidden\] \{ display: none !important; \}/);
});

test("web: without Advanced, a run's details leave out its folder, model, steps and claude --resume", () => {
  const computers = read('computers.js');
  assert.match(computers, /function detailsInfo\(meta\) \{\n  if \(!advanced\(\)\) return '';/);
});
