// #1103: the web page asks for what its first view needs side by side, and draws the list before the slow parts:
// /status (which can wait on docker), /setup and /settings are asked for at once, before the features and the
// language; the first refresh uses that /settings answer; the chats do not wait for /skills.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const read = (f) => fs.readFileSync(path.join(__dirname, '..', 'public', f), 'utf8');
const boot = read('boot.js');
const app = read('app.js');

test('boot asks for /status, /setup and /settings before it waits for anything', () => {
  const start = boot.slice(boot.indexOf('(async () => {'));
  const firstAwait = start.indexOf('await ');
  for (const asked of ["api('/status')", "api('/setup')", "api('/settings')"]) {
    const at = start.indexOf(asked);
    assert.ok(at > 0 && at < firstAwait, `${asked} is asked before the first await`);
  }
  assert.match(start, /await refresh\(\);\n\s+state\.status = await statusRead;\n\s+renderStatus\(\);/);
  assert.match(start, /const setupNow = await setupRead;/);
  assert.match(start, /I18n\.sync\(api, state\.features, settingsRead/);
});

test("the first refresh uses boot's /settings and does not wait for /skills", () => {
  const readAll = app.slice(app.indexOf('async function readAll()'), app.indexOf('function render()'));
  assert.match(readAll, /takeBootSettings\(\) \|\| api\('\/settings'\)/);
  assert.doesNotMatch(readAll, /await skillLib/);
  assert.match(readAll, /skillLib\.then\(\(\) => \{ if \(latest\(\) && state\.skillLib\) render\(\); \}\)/);
});

test('the language is read from the /settings answer it is given, without asking again', async () => {
  const asked = [];
  const ctx = vm.createContext({ document: { documentElement: {}, querySelectorAll: () => [] }, localStorage: { getItem: () => null, setItem() {} }, sessionStorage: { getItem: () => null, setItem() {} }, location: { reload() { asked.push('reload'); } } });
  vm.runInContext(`${read('i18n.js')}\nthis.I18n = I18n;`, ctx);
  const api = async (p) => { asked.push(p); return { strings: {} }; };
  await ctx.I18n.sync(api, ['language'], Promise.resolve({ settings: { language: 'en' } }));
  assert.deepEqual(asked, []);
  await ctx.I18n.sync(api, ['language'], Promise.resolve({ settings: { language: 'pl' } }));
  assert.deepEqual(asked, ['/i18n/pl', 'reload']);
});
