// "Duplicate" on the web page (#227): the confirmation shows the server's list of what the copy gets, the name can
// be changed, and the copy's chat opens. The page's own code, cut out of public/bots.js and run against stand-ins.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { cut, element } = require('./web-page');

const PLAN = { name: 'Coder 2', copies: ['Its main assignment, rules and description', 'The Vault entries it may use: Portal <b>'], notCopied: 'Its memory, chats, runs, jobs, Board tiles, files and groups', logins: ['Portal <b>'], vaultLocked: false };

function page({ plan = PLAN, made = { id: 'c2', name: 'Coder 2' } } = {}) {
  const calls = []; const toasts = []; const views = [];
  const go = element({}); const name = element({}, { value: plan.name });
  const modal = element({ '#dup-go': go, '#dup-name': name }, { closed: false, close() { modal.closed = true; } });
  const ctx = vm.createContext({
    api: async (url, opts = {}) => { calls.push([url, opts]); return opts.method === 'POST' ? made : plan; },
    openModal: (html) => { modal.innerHTML = html; return modal; },
    $: (sel, root) => root.querySelector(sel),
    esc: (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
    toast: (t, bad) => toasts.push([t, !!bad]),
    refresh: async () => {},
    setView: (...a) => views.push(a),
  });
  vm.runInContext(`${cut('// "Duplicate" (#227)', '// The bits of the settings page')}
    Object.assign(this, { openDuplicate });`, ctx);
  return { ctx, calls, toasts, views, modal, go, name };
}

test('web: Duplicate lists what the copy gets as text, with the suggested name', async () => {
  const p = page();
  await p.ctx.openDuplicate({ id: 'c1', name: 'Coder' });
  assert.deepEqual(p.calls.map(([u]) => u), ['/bots/c1/duplicate']);
  assert.match(p.modal.innerHTML, /Duplicate Coder\?/);
  assert.match(p.modal.innerHTML, /value="Coder 2"/);
  assert.match(p.modal.innerHTML, /<li>The Vault entries it may use: Portal &lt;b&gt;<\/li>/, 'drawn as text');
  assert.match(p.modal.innerHTML, /Not copied: Its memory/);
  assert.doesNotMatch(p.modal.innerHTML, /disabled/);
});

test('web: Duplicate makes the copy with the name typed, then opens its chat', async () => {
  const p = page();
  await p.ctx.openDuplicate({ id: 'c1', name: 'Coder' });
  p.name.value = 'Reviewer';
  await p.go.onclick();
  assert.deepEqual(JSON.parse(JSON.stringify(p.calls[1])), ['/bots/c1/duplicate', { method: 'POST', body: { name: 'Reviewer' } }]);
  assert.equal(p.modal.closed, true);
  assert.deepEqual(p.views, [['bot', 'c2']]);
  assert.deepEqual(p.toasts, [['Coder 2 made', false]]);
});

test('web: with Bitwarden locked the button is off and the dialog says to unlock first', async () => {
  const p = page({ plan: { ...PLAN, logins: [], vaultLocked: true } });
  await p.ctx.openDuplicate({ id: 'c1', name: 'Coder' });
  assert.match(p.modal.innerHTML, /Bitwarden is locked: unlock it first/);
  assert.match(p.modal.innerHTML, /id="dup-go" disabled/);
});
