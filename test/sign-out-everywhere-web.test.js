// "Sign out everywhere" on the web page (#468, ADR 028): Settings has it behind a front door (`accounts` in
// features), and it asks the front door to end every session of the account, then opens the sign-in page.
// The page's own code, cut out of public/app.js and run against stand-ins.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { cut, answer, words } = require('./web-page');

function page({ features = ['accounts'], fetch = answer(200, { ok: true, ended: 2 }), confirmed = true } = {}) {
  const calls = [];
  const toasts = [];
  const went = [];
  const ctx = vm.createContext({
    ...words,
    state: { features },
    toast: (text, bad = false) => toasts.push([text, bad]),
    confirm: () => confirmed,
    fetch: async (url, opts) => { calls.push([url, opts]); return fetch(url, opts); },
    location: { assign: (to) => went.push(to) },
  });
  vm.runInContext(`${cut('const CHEV = ', '// A change on a settings screen saves by itself')}
    ${cut('// ---------- signing out everywhere ----------', '// ---------- backups ----------')}
    Object.assign(this, { signOutCardHTML, signOutEverywhere });`, ctx);
  return { ctx, calls, toasts, went };
}

test('web: Settings has "Sign out everywhere" behind a front door only', () => {
  assert.match(page().ctx.signOutCardHTML(), /<button[^>]*id="sign-out-everywhere"[^>]*>Sign out everywhere<\/button>/);
  assert.equal(page({ features: [] }).ctx.signOutCardHTML(), '', 'a botdot server without accounts has no sign-in');
  assert.match(cut('function renderSettings()', '// ---------- backups ----------'), /\$\{signOutCardHTML\(\)\}[\s\S]*onClick\('#sign-out-everywhere', signOutEverywhere\)|\$\('#sign-out-everywhere', root\)/);
});

test('web: "Sign out everywhere" asks the front door to end every session, then opens the sign-in page', async () => {
  const { ctx, calls, went, toasts } = page();
  await ctx.signOutEverywhere();
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/sign-out-everywhere', "the front door's own route, not botdot's /api");
  assert.equal(calls[0][1].method, 'POST');
  assert.equal(calls[0][1].headers['X-Bot-Dot'], '1');
  assert.deepEqual(went, ['/sign-in']);
  assert.deepEqual(toasts, []);
});

test('web: a session that had ended already opens the sign-in page too; a refusal is said', async () => {
  const ended = page({ fetch: answer(401, { error: 'Sign in first.', signIn: '/sign-in' }) });
  await ended.ctx.signOutEverywhere();
  assert.deepEqual(ended.went, ['/sign-in']);
  const refused = page({ fetch: answer(429, { error: 'Too many failed sign-ins. Try again in 2 seconds.' }) });
  await refused.ctx.signOutEverywhere();
  assert.deepEqual(refused.went, []);
  assert.deepEqual(refused.toasts, [['Too many failed sign-ins. Try again in 2 seconds.', true]]);
  const away = page({ fetch: async () => { throw new TypeError('Failed to fetch'); } });
  await away.ctx.signOutEverywhere();
  assert.deepEqual(away.toasts, [["Can't reach botdot.", true]]);
});

test('web: nothing is ended without a yes', async () => {
  const { ctx, calls, went } = page({ confirmed: false });
  await ctx.signOutEverywhere();
  assert.deepEqual([calls, went], [[], []]);
});
