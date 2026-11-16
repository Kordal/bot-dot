// Back from a chat below a wide window (#1507): on the Projects screen it is the project, however the chat opened
// there, and the browser's Back does the same as the chat's own Back.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const PUBLIC = path.join(__dirname, '..', 'public');
const read = (f) => fs.readFileSync(path.join(PUBLIC, f), 'utf8');
const app = read('app.js');
const boot = read('boot.js');
const cut = (src, from, to) => src.slice(src.indexOf(from), src.indexOf(to, src.indexOf(from)));

// A small history: entries of { state, url }, at an index, with popstate as the browser fires it.
function makeHistory(ctx) {
  const h = {
    entries: [{ state: null, url: '#company' }], at: 0,
    get state() { return h.entries[h.at].state; },
    pushState(s, _t, url) { h.entries.splice(h.at + 1); h.entries.push({ state: s, url }); h.at++; },
    replaceState(s, _t, url) { h.entries[h.at] = { state: s, url }; },
    back() { if (h.at === 0) return; h.at--; ctx.popped({ state: h.state }); },
  };
  return h;
}

function load({ place = 'company', narrow = true, phone = false } = {}) {
  const said = [];
  const appEl = { classes: new Set(['in-main', 'has-rail']), classList: null };
  appEl.classList = { contains: (c) => appEl.classes.has(c), add: (c) => appEl.classes.add(c), remove: (c) => appEl.classes.delete(c) };
  const ctx = {
    state: { view: 'company', panel: null, features: ['company'], chatId: 'c1', botId: 'b1' },
    Company: { place: () => place },
    Panel: { name: (v) => v },
    matchMedia: (q) => ({ matches: q.includes('1000px') ? narrow : phone }),
    $: () => appEl,
    showList() { said.push('list'); appEl.classes.delete('in-main'); },
    popped: () => {},
  };
  ctx.history = makeHistory(ctx);
  ctx.setView = (v) => {
    const from = ctx.state.view;
    const inMain = appEl.classes.has('in-main');
    ctx.state.view = v;
    said.push(v);
    // show()'s own rule, as it is in app.js
    const over = vm.runInContext(`(${showOver})`, ctx)(v, from, phone, inMain);
    appEl.classes.add('in-main');
    ctx.writeHash(over);
  };
  vm.createContext(ctx);
  vm.runInContext(`const CHAT_VIEWS = ['bot', 'chief', 'group']; const CHAT_OVER = '(max-width: 1000px)';
    ${cut(app, '// over: the view is a chat', 'function show(')}
    ${cut(app, '// The Projects screen is up', '// Phones: back to the contact list')}
    this.writeHash = writeHash; this.backFromChat = backFromChat; this.leaveChat = leaveChat;`, ctx);
  // boot.js's popstate route
  const onPop = cut(boot, "addEventListener('popstate', ", '\n});') + '\n});';
  vm.runInContext(onPop.replace("addEventListener('popstate', ", 'this.popped = ('), ctx);
  return { ctx, said, appEl };
}
const showOver = (() => {
  const line = app.match(/const over = (CHAT_VIEWS\.includes\(v\) && [^;]+);/);
  assert.ok(line, "show() decides whether a chat is a step of its own");
  return `(v, from, phone, inMain) => ${line[1]}`;
})();

test('a chat opened on the Projects screen below a wide window is a step: its Back goes to the project', () => {
  const { ctx, said } = load();
  ctx.setView('chief');
  assert.equal(ctx.history.entries.length, 2, 'the chat is an entry of its own');
  assert.equal(ctx.history.state?.over, true);
  ctx.backFromChat();
  assert.equal(ctx.state.view, 'company', 'back on the project');
  assert.equal(ctx.history.at, 0);
  assert.equal(ctx.history.state, null);
  assert.deepEqual([...said], ['chief', 'company']);
});

test("the browser's Back from that chat does the same as the chat's Back", () => {
  const { ctx } = load();
  ctx.setView('bot');
  ctx.history.back(); // the browser's Back
  assert.equal(ctx.state.view, 'company');
});

test('a chat that came on the Projects screen another way (a link, a typed or reloaded address) still leaves to the project', () => {
  const { ctx, said } = load();
  ctx.state.view = 'chief'; // up without a step of its own
  ctx.backFromChat();
  assert.equal(ctx.state.view, 'company', 'not the list, which the Projects screen does not have');
  assert.ok(!said.includes('list'));
});

test('moving from one chat to another keeps one step, and leaving to a page that is no chat unmarks it', () => {
  const { ctx } = load();
  ctx.setView('chief');
  ctx.setView('bot');
  assert.equal(ctx.history.entries.length, 2, 'no second step for a chat opened from a chat');
  ctx.setView('settings');
  assert.equal(ctx.history.state, null, 'a page that is no chat is an ordinary entry');
});

test('on Home on a phone, a chat opened from the list is a step, and Back is the list', () => {
  const { ctx, said, appEl } = load({ place: 'home', narrow: true, phone: true });
  appEl.classes.delete('in-main'); // the list is shown
  ctx.state.view = 'chief';
  ctx.setView('bot');
  assert.equal(ctx.history.state?.over, true);
  ctx.history.back();
  assert.equal(said.at(-1), 'list');
});

test('a wide window adds no step: the chat is beside the project', () => {
  const { ctx } = load({ narrow: false });
  ctx.setView('chief');
  assert.equal(ctx.history.entries.length, 1);
});

test("the chat's Back is one handler for every chat, and the style shows it on the Projects screen below a wide window", () => {
  assert.match(boot, /if \(e\.target\.closest\('#chat-row'\) && CHAT_VIEWS\.includes\(state\.view\)\) backFromChat\(\); else showList\(\);/);
  assert.doesNotMatch(read('dock.js'), /\[data-back\]'\)/, 'no second Back handler in dock.js');
  assert.match(read('style.css'), /\.app\.has-rail\.place-company #chat-row \.back-btn \{ display: grid; \}/);
});
