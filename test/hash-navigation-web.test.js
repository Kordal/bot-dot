// Exercise the page's real boot-time event registration, then change the address as a browser does.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { cut, element } = require('./web-page');

function page(view = 'chief') {
  const listeners = {};
  const opened = [];
  const state = { view, chatId: 'chat-1', selectedRun: 'run-1' };
  const location = { hash: `#${view}` };
  const noop = () => {};
  const ctx = vm.createContext({
    state, location,
    $: () => element(), document: { documentElement: { dataset: {} }, addEventListener: noop },
    addEventListener: (type, fn) => { listeners[type] = fn; },
    setView: (next) => { state.view = next; opened.push(next); },
    initSideGrip: noop, initChatGrip: noop, initSearch: noop, initQuote: noop, onKeypadKey: noop,
  });
  vm.runInContext(cut('// ---------- boot ----------', '(async () => {'), ctx);
  return { state, opened, navigate(hash) { location.hash = hash; listeners.hashchange?.(); } };
}

test('web: typing #setup into an open tab opens Setup without a reload', () => {
  for (const view of ['chief', 'bot', 'group', 'runs', 'settings']) {
    const p = page(view);
    p.navigate('#setup');
    assert.equal(p.state.view, 'setup', `from ${view}`);
    assert.deepEqual(p.opened, ['setup']);
  }
});

test('web: the Setup address listener leaves other routes and their selected content alone', () => {
  const p = page();
  for (const hash of ['#chief/chat-2', '#runs/run-2', '#bot/bot-2', '#group/group-2', '#unknown', '']) p.navigate(hash);
  assert.deepEqual(p.opened, []);
  assert.equal(p.state.chatId, 'chat-1');
  assert.equal(p.state.selectedRun, 'run-1');
});
