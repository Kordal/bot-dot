// Settings shows which botdot the owner runs, while Advanced is on (#1610, ADR 200/205): a read-only "Version" row with
// the server's version and short revision from GET /api/version. The desktop app shows this page and gets it too.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { read, cut, esc } = require('./web-page');

const settings = read('settings.js');
const replies = read('replies.js');

function page(state, extra = {}) {
  const ctx = vm.createContext({ state, esc, tr: (s) => s, advanced: () => state.advanced !== false, ...extra });
  const from = settings.indexOf('const versionLine = ');
  const code = settings.slice(from, settings.indexOf('\n\n', from));
  vm.runInContext(`${code}; this.versionLine = versionLine; this.versionRowHTML = versionRowHTML;`, ctx);
  return ctx;
}

test('web: the version line is the version and its short revision, or the version alone from an older server', () => {
  const { versionLine } = page({});
  assert.equal(versionLine({ version: '0.1.0', short: '659cb5e' }), '0.1.0 (659cb5e)');
  assert.equal(versionLine({ version: '0.1.0' }), '0.1.0');
  assert.equal(versionLine({ short: '659cb5e' }), '');
  assert.equal(versionLine({}), '');
  assert.equal(versionLine(null), '');
});

test('web: Settings has the Version row only while Advanced is on, and none when the server names no version', () => {
  const state = { advanced: true, version: { version: '0.1.0', short: '659cb5e' } };
  const ctx = page(state);
  const row = ctx.versionRowHTML();
  assert.match(row, /<b>Version<\/b>/);
  assert.match(row, /0\.1\.0 \(659cb5e\)/);
  assert.doesNotMatch(row, /<button|<input|<a /, 'read-only: no new control');
  state.advanced = false;
  assert.equal(ctx.versionRowHTML(), '', 'Advanced off: hidden');
  state.advanced = true;
  state.version = {};
  assert.equal(ctx.versionRowHTML(), '', 'neither field: no row');
  state.version = null;
  assert.equal(ctx.versionRowHTML(), '', 'not asked yet: no row');
  assert.match(settings, /\$\{versionRowHTML\(\)\}/, 'the Settings list draws it');
});

test("web: the page keeps the server's version and short revision with the features it reads from /api/version", async () => {
  const state = { features: [], version: null };
  const ctx = vm.createContext({ state, fresh: { seen() {} }, api: async () => ({ version: '0.1.0', short: '659cb5e', revision: 'x'.repeat(40), features: ['advanced'] }) });
  vm.runInContext(`${replies.slice(replies.indexOf('const loadFeatures = '), replies.indexOf('\n', replies.indexOf('const loadFeatures = ')))}; this.loadFeatures = loadFeatures;`, ctx);
  await ctx.loadFeatures();
  assert.deepEqual(ctx.state.features, ['advanced']);
  assert.deepEqual({ ...ctx.state.version }, { version: '0.1.0', short: '659cb5e' });
});
