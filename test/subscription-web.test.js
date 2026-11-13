// "Subscription" in Settings on the web page (ADR 234): a row only where the front door's session names an https
// billing page (a managed machine whose fleet console gave one), opened in a new tab, which the desktop app hands to
// the default browser. The page's own code, cut out of public/app.js and run against stand-ins.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { cut, esc, words } = require('./web-page');

function page(features = ['accounts']) {
  const ctx = vm.createContext({ ...words, esc, URL, state: { features }, CHEV: '', $: (sel, root) => root.parts[sel] });
  vm.runInContext(`${cut('// ---------- the subscription ----------', '// ---------- deleting the account ----------')}
    Object.assign(this, { subscriptionRowHTML, subscriptionRowInner, drawSubscriptionRow });`, ctx);
  return ctx;
}

test('web: Settings has a slot for it only behind a front door', () => {
  assert.match(page().subscriptionRowHTML(), /id="subscription-row"/);
  assert.equal(page([]).subscriptionRowHTML(), '');
  assert.match(cut('function renderSettings()', '// ---------- backups ----------'), /\$\{subscriptionRowHTML\(\)\}/);
  assert.match(cut('async function loadDeleteCard(root)', '// The confirmation'), /drawSubscriptionRow\(root, session\)/, 'filled from the same session');
});

test("web: the row opens the session's page in a new tab, with no other words", () => {
  const html = page().subscriptionRowInner({ account: 'solo', subscriptionPage: 'https://billing.example/p?a=solo&b=1' });
  assert.match(html, /<a class="bs-row bs-link" id="subscription" href="https:\/\/billing\.example\/p\?a=solo&amp;b=1" target="_blank" rel="noopener noreferrer"><b>Subscription<\/b><\/a>/);
});

test('web: no row without an https page: an older front door, a self-hosted machine, a wrong address', () => {
  const ctx = page();
  for (const s of [null, {}, { subscriptionPage: null }, { subscriptionPage: 42 }, { subscriptionPage: 'http://billing.example' }, { subscriptionPage: 'javascript:alert(1)' }, { subscriptionPage: 'nope' }]) {
    assert.equal(ctx.subscriptionRowInner(s), '', JSON.stringify(s));
  }
  const slot = { innerHTML: '', hidden: true };
  ctx.drawSubscriptionRow({ parts: { '#subscription-row': slot } }, { subscriptionPage: 'https://billing.example' });
  assert.equal(slot.hidden, false);
  ctx.drawSubscriptionRow({ parts: { '#subscription-row': slot } }, null);
  assert.equal(slot.hidden, true, 'hidden again when the session names none');
});
