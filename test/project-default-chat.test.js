// Run the real chat router: primary entry points must never pick a team or another project's Chief chat.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { read } = require('./web-page');

function page() {
  const opened = [];
  const state = { company: { id: 'p1', phase: 'running', chiefChat: 'chief-p1', teams: [{ id: 't1' }] }, botsKnown: true, features: ['company', 'project-chief', 'project-manager-bot'], bots: [{ id: 'manager' }], groups: [{ id: 'g1', team: 't1' }], groupsKnown: true };
  const ctx = vm.createContext({ state, document: { addEventListener() {} }, addEventListener() {}, localStorage: { getItem() { return null; } },
    botById: (id) => state.bots.find((b) => b.id === id), groupById: (id) => state.groups.find((g) => g.id === id),
    setView: (kind, id) => opened.push({ kind, id }), openChiefChat: (id) => opened.push({ kind: 'chief', id }),
    Company: { place: () => 'company', openProjectChief: () => opened.push({ kind: 'project-chief', id: state.company.id }) },
  });
  vm.runInContext(read('dock.js'), ctx);
  return { state, opened, dock: ctx.Dock, value: () => JSON.parse(JSON.stringify(ctx.Dock.defaultChat())) };
}

test('a project with teams opens its own Chief conversation when no manager was selected', () => {
  const p = page();
  assert.deepEqual(p.value(), { kind: 'chief', id: 'chief-p1' });
  p.dock.openDefault();
  assert.deepEqual(p.opened, [{ kind: 'chief', id: 'chief-p1' }]);
});

test('the selected manager is the primary contact; changing projects or the selection changes the destination', () => {
  const p = page();
  p.state.company.lead = 'manager';
  p.dock.openDefault();
  assert.deepEqual(p.opened.pop(), { kind: 'bot', id: 'manager' });
  p.state.company = { id: 'p2', phase: 'running', chiefChat: 'chief-p2', teams: [] };
  p.dock.openDefault();
  assert.deepEqual(p.opened.pop(), { kind: 'chief', id: 'chief-p2' });
  p.state.company.lead = 'deleted';
  assert.deepEqual(p.value(), { kind: 'chief', id: 'chief-p2' });
});

test('a project without a Chief chat creates its own on entry, while older servers keep the ordinary Chief', () => {
  const p = page();
  delete p.state.company.chiefChat;
  p.dock.openDefault();
  assert.deepEqual(p.opened.pop(), { kind: 'project-chief', id: 'p1' });
  p.state.company.lead = 'manager';
  p.state.features = ['company'];
  p.dock.openDefault();
  assert.deepEqual(p.opened.pop(), { kind: 'chief', id: undefined });
});

test('setup has no primary conversation and opening it does nothing', () => {
  const p = page();
  p.state.company.phase = 'setup';
  assert.equal(p.dock.defaultChat(), null);
  p.dock.openDefault();
  assert.deepEqual(p.opened, []);
});

test('a selected manager still loading does not fall through to another chat', () => {
  const p = page();
  p.state.company.lead = 'manager';
  p.state.botsKnown = false;
  assert.equal(p.dock.defaultChat(), null);
  p.dock.openDefault();
  assert.deepEqual(p.opened, []);
});

test('a delayed Chief chat creation keeps its project and cannot reopen it after the owner leaves', async () => {
  let resolve;
  const opened = [];
  const state = { company: { id: 'p1' } };
  const ctx = vm.createContext({ state, place: 'company', at: (path) => `${path}?project=${state.company.id}`,
    api: (path) => { assert.equal(path, '/company/chief-chat?project=p1'); return new Promise((done) => { resolve = done; }); },
    projects: () => [], changed() {}, toast: () => assert.fail('no error expected'), Dock: { openChief: (id) => opened.push(id) },
  });
  const source = read('company.js');
  vm.runInContext(source.slice(source.indexOf('  const openingChief ='), source.indexOf('  function wirePick')), ctx);
  const pending = ctx.openProjectChief();
  await ctx.openProjectChief(); // a redraw must not create another request
  state.company = { id: 'p2' };
  resolve({ chatId: 'chief-p1' });
  await pending;
  assert.deepEqual(opened, []);
});

test('a delayed Chief creation does not replace an explicitly opened bot conversation', async () => {
  let resolve;
  const opened = [];
  const state = { company: { id: 'p1' }, view: 'company' };
  const ctx = vm.createContext({ state, place: 'company', at: (path) => path,
    api: () => new Promise((done) => { resolve = done; }), changed() {}, toast() {},
    Dock: { openChief: (id) => opened.push(id) },
  });
  const source = read('company.js');
  vm.runInContext(source.slice(source.indexOf('  const openingChief ='), source.indexOf('  function wirePick')), ctx);
  const pending = ctx.openProjectChief();
  state.view = 'bot'; state.botId = 'manager';
  resolve({ chatId: 'chief-p1' });
  await pending;
  assert.deepEqual(opened, []);
});

test('failed automatic entry waits for an explicit retry instead of retrying on every redraw', async () => {
  const p = page();
  const { element } = require('./web-page');
  const app = element();
  const row = element();
  const main = { appendChild() {} };
  const ctx = vm.createContext({ state: p.state, botById() {}, groupById() {}, Company: { place: () => 'company' },
    localStorage: { getItem() { return null; } }, addEventListener() {}, queueMicrotask,
    matchMedia: () => ({ matches: true }), $: (sel) => ({ '#app': app, '#chat-row': row, '.main': main })[sel], $$: () => [],
    document: { addEventListener() {}, createElement: () => element({}, { setAttribute() {} }) }, tr: (x) => x,
  });
  ctx.state.view = 'company';
  delete ctx.state.company.chiefChat;
  vm.runInContext(read('dock.js'), ctx);
  let attempts = 0;
  ctx.Dock.kinds.chief.open = async () => { attempts++; return false; };
  ctx.Dock.draw();
  await new Promise((done) => setImmediate(done));
  ctx.Dock.draw();
  await new Promise((done) => setImmediate(done));
  assert.equal(attempts, 1);
  await ctx.Dock.openDefault();
  assert.equal(attempts, 2, 'the owner can retry');
  ctx.Dock.draw();
  await new Promise((done) => setImmediate(done));
  // A newly selected manager must not inherit a failed Chief entry.
  ctx.state.company.lead = 'manager';
  ctx.botById = (id) => ctx.state.bots.find((b) => b.id === id);
  let contact;
  ctx.Dock.kinds.bot.open = (id) => { contact = id; };
  ctx.Dock.draw();
  await new Promise((done) => setImmediate(done));
  assert.equal(contact, 'manager');
});

test('automatic Chief entry stops after the wide column disappears while explicit entry can still open', async () => {
  let resolve;
  let column = true;
  const opened = [];
  const state = { company: { id: 'p1' }, view: 'company' };
  const ctx = vm.createContext({ state, place: 'company', at: (path) => path,
    api: () => new Promise((done) => { resolve = done; }), changed() {}, toast() {},
    Dock: { openChief: (id) => opened.push(id) },
  });
  const source = read('company.js');
  vm.runInContext(source.slice(source.indexOf('  const openingChief ='), source.indexOf('  function wirePick')), ctx);
  const pending = ctx.openProjectChief(undefined, () => column);
  column = false;
  resolve({ chatId: 'chief-p1' });
  await pending;
  assert.deepEqual(opened, []);
  const explicit = ctx.openProjectChief();
  resolve({ chatId: 'chief-p1' });
  await explicit;
  assert.deepEqual(opened, ['chief-p1']);
});

test('finishing an empty bot-list load invalidates the project home so its Chief field can appear', () => {
  const state = { company: { lead: 'gone' }, bots: [], groups: [], botsKnown: false };
  const ctx = vm.createContext({ state, Company: { steps: {} }, window: {}, unfolded: () => [], needs: () => [],
    boardFor: null, teamOpen: null, changing: false, menuFor: null, sourceFor: null, apps: null, filter: 'all', menu: null, pick: null,
  });
  vm.runInContext(read('company-home.js').split('\n').find((line) => line.includes('Company.steps.sig =')), ctx);
  const before = JSON.stringify(ctx.Company.steps.sig());
  state.botsKnown = true;
  assert.notEqual(JSON.stringify(ctx.Company.steps.sig()), before);
});

test('changing the manager during Chief creation retains the new selection and rejects automatic Chief entry', async () => {
  let resolve;
  const opened = [];
  const state = { company: { id: 'p1' }, view: 'company' };
  const ctx = vm.createContext({ state, place: 'company', at: (path) => path,
    api: () => new Promise((done) => { resolve = done; }),
    changed: ({ company }) => { state.company = company; }, toast() {},
    Dock: { openChief: (id) => opened.push(id) },
  });
  const source = read('company.js');
  vm.runInContext(source.slice(source.indexOf('  const openingChief ='), source.indexOf('  function wirePick')), ctx);
  const pending = ctx.openProjectChief(undefined, () => !state.company.lead);
  state.company = { id: 'p1', lead: 'manager', name: 'New name' };
  resolve({ chatId: 'chief-p1', company: { id: 'p1', name: 'Old name' } });
  await pending;
  assert.deepEqual(opened, []);
  assert.equal(state.company.lead, 'manager');
  assert.equal(state.company.name, 'New name');
  assert.equal(state.company.chiefChat, 'chief-p1');
});
