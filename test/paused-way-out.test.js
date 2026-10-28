// A paused account's way out (#466): the front door's paused page has one action, "Use another account", which ends
// this browser's session and opens the sign-in page; the web page, open when the admin pauses the account, goes to
// that paused page on the front door's paused answer. The front door's half is walked in front-door-accounts.test.js.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const pages = require('../lib/front-door/pages');
const { cut, esc, element, finders, words } = require('./web-page');

// The paused page's script (/front-door/passkey.js) against a stand-in page, front door and browser.
function pausedPage(answer) {
  const listeners = {};
  const other = { disabled: false, addEventListener: (ev, f) => { listeners[ev] = f; } };
  const said = { textContent: '' };
  const posts = [];
  const went = [];
  const ctx = vm.createContext({
    document: { getElementById: (id) => ({ other, said }[id] || null) },
    location: { search: '', hash: '', pathname: '/', replace: (to) => went.push(to) },
    URLSearchParams,
    fetch: async (path, opts) => { posts.push({ path, ...opts }); return answer(); },
    navigator: {}, atob, btoa,
  });
  vm.runInContext(pages.SCRIPT, ctx);
  return { click: () => listeners.click(), other, said, posts, went };
}

test('the paused page: one message and one button, "Use another account"', () => {
  const html = pages.paused();
  assert.match(html, /<p>Your account is paused by the admin\.<\/p>\s*<button id="other" type="button">Use another account<\/button>/);
  assert.match(html, /<script src="\/front-door\/passkey\.js"><\/script>/);
  assert.equal((html.match(/<button/g) || []).length, 1);
  assert.equal((html.match(/<p>/g) || []).length, 1, 'no other text');
});

test('"Use another account" signs this browser out and opens the sign-in page', async () => {
  const p = pausedPage(() => ({ ok: true, json: async () => ({ ok: true }) }));
  await p.click();
  assert.equal(p.posts.length, 1);
  assert.equal(p.posts[0].path, '/sign-out');
  assert.equal(p.posts[0].method, 'POST');
  assert.equal(p.posts[0].headers['X-Bot-Dot'], '1');
  assert.deepEqual(p.went, ['/sign-in']);
});

test('a sign-out that fails says why and leaves the button to try again', async () => {
  const p = pausedPage(() => ({ ok: false, json: async () => ({ error: 'Too many tries.' }) }));
  await p.click();
  assert.deepEqual(p.went, []);
  assert.equal(p.said.textContent, 'Too many tries.');
  assert.equal(p.other.disabled, false);
});

test('web: the front door\'s paused answer reloads the page, which is then the paused page', async () => {
  const hidden = () => element({}, { classes: ['hidden'] });
  const doc = element({ '#away': hidden(), '.away-line': [hidden()] });
  let reloads = 0;
  const ctx = vm.createContext({
    ...finders(doc), ...words, esc, console: { warn() {} },
    location: { reload: () => { reloads++; }, assign() {} },
    fetch: async () => ({ ok: false, status: 503, json: async () => ({ error: 'Your account is paused by the admin.', paused: true }) }),
  });
  vm.runInContext(`${cut('const away = { on: false };', 'function esc(s)')}
    Object.assign(this, { api });`, ctx);
  await assert.rejects(ctx.api('/bots'));
  assert.equal(reloads, 1);
  // Any other 503 with words is said as before, with no reload.
  ctx.fetch = async () => ({ ok: false, status: 503, json: async () => ({ error: 'Your account is starting.', starting: true }) });
  await assert.rejects(ctx.api('/bots'), /Your account is starting\./);
  assert.equal(reloads, 1);
});
