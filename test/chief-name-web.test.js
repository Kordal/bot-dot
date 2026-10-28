// The Chief's name on the web page (#41): the page's own code, cut out of public/app.js and run against stand-in
// elements and a stand-in server. The name comes from `GET /api/chief` and the feed's `chief_name`, a server from
// before it leaves "Chief of Staff"; the first-run setup asks for it once, and Done sends it with `done`; a name the
// server refuses keeps the page on Setup with the server's sentence.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { app, cut, esc, element, finders, words } = require('./web-page');

// The name's own part of the page, with the Chief's row in the list and its chat's head.
function names() {
  const head = element();
  const ctx = vm.createContext({ ...finders(element({ '#view-chief .chat-head h2': head })), esc, Mentions: { CHIEF: 'chief' }, CHIEF_COLOR: '#d85a30' });
  vm.runInContext(`${cut('const CHIEF_BOT = {', '\n')}
    ${cut('// ---------- the Chief\'s name', '// ---------- end of the Chief\'s name')}
    this.CHIEF_BOT = CHIEF_BOT; this.takeChiefName = takeChiefName; this.drawChiefName = drawChiefName; this.chiefName = chiefName; this.chiefMatches = chiefMatches;`, ctx);
  return { ctx, head };
}

test('the page calls the Chief what the server says, and Chief of Staff when it says nothing', () => {
  const { ctx, head } = names();
  assert.equal(ctx.chiefName(), 'Chief of Staff');
  assert.equal(ctx.takeChiefName('Ada'), true);
  assert.equal(ctx.chiefName(), 'Ada');
  assert.equal(ctx.CHIEF_BOT.name, 'Ada', 'the mentions and the chips use the same name');
  assert.equal(ctx.takeChiefName('Ada'), false, 'no change, nothing to redraw');
  ctx.drawChiefName();
  assert.equal(head.textContent, 'Ada');
  for (const none of [undefined, '', '  ', null, 7]) {
    ctx.takeChiefName('Ada');
    ctx.takeChiefName(none);
    assert.equal(ctx.chiefName(), 'Chief of Staff', String(none));
  }
});

test('a search finds the Chief by its name and by its role', () => {
  const { ctx } = names();
  ctx.takeChiefName('Ada');
  for (const q of ['ada', 'chief', 'staff']) assert.ok(ctx.chiefMatches(q), q);
  assert.ok(!ctx.chiefMatches('news'));
});

test('the list, the keys, the panel and the chat head say the name, never a fixed "Chief of Staff"', () => {
  for (const [from, to] of [['function drawContacts', '\n}\n'], ['function chiefKeyHTML', '\n}\n'], ['function drawPanelHead', '\n}\n'], ['function renderChief()', "wireComposer($('form', root)"]]) {
    const part = cut(from, to);
    assert.doesNotMatch(part, /Chief of Staff/, from);
    assert.match(part, /chief(Name|Title)\(\)/, from); // chiefTitle(): the name, or the role in the page's language (#647)
  }
});

// The setup page's question and its Done, with a stand-in server.
function setup({ s, answers = [] }) {
  const input = element({}, { value: '' });
  const root = element({ '#chief-name': input });
  const calls = [], toasts = [], views = [];
  const state = { setup: s };
  const ctx = vm.createContext({ ...words,
    ...finders(root), esc, state, JSON,
    toast: (...a) => toasts.push(a),
    setView: (v) => views.push(v),
    setupItem: ({ state: st, icon, title, body, action }) => `<item ${st} ${icon} ${title}>${body}|${action}</item>`,
    api: async (path, opts = {}) => {
      calls.push([opts.method || 'GET', path, opts.body && JSON.parse(JSON.stringify(opts.body))]);
      const a = answers.shift();
      if (a instanceof Error) throw a;
      return a;
    },
  });
  vm.runInContext(`${cut('// The question for the Chief\'s name', '// ---------- end of the setup question')}
    this.chiefNameSetupItem = chiefNameSetupItem; this.finishSetup = finishSetup;`, ctx);
  return { ctx, input, calls, toasts, views, state };
}

test('setup asks for the name until it is done, with the name kept as its value', () => {
  const { ctx } = setup({ s: {} });
  assert.match(ctx.chiefNameSetupItem({ done: false, chiefName: 'Chief of Staff' }), /<input[^>]*id="chief-name"[^>]*maxlength="40"[^>]*value=""/);
  assert.match(ctx.chiefNameSetupItem({ done: false, chiefName: 'Ada "A" <b>' }), /value="Ada &quot;A&quot; &lt;b&gt;"/);
  assert.match(ctx.chiefNameSetupItem({ done: false, chiefName: 'Chief of Staff' }), /Chief of Staff/, 'says what an empty name keeps');
  assert.equal(ctx.chiefNameSetupItem({ done: true, chiefName: 'Ada' }), '', 'not asked again once setup is done');
});

test('Done sends the name with done, and goes to the Chief', async () => {
  const t = setup({ s: { done: false }, answers: [{ done: true, chiefName: 'Ada', chiefNameAsked: true }] });
  t.input.value = ' Ada ';
  await t.ctx.finishSetup();
  assert.deepEqual(t.calls, [['PUT', '/setup', { done: true, chiefName: ' Ada ' }]]);
  assert.deepEqual(t.views, ['chief']);
  assert.equal(t.state.setup.chiefName, 'Ada');
});

test('a name the server refuses keeps Setup open, with its sentence', async () => {
  const t = setup({ s: { done: false }, answers: [Object.assign(new Error('A bot is called Ada already. Give the Chief of Staff another name.'), { status: 400 })] });
  t.input.value = 'Ada';
  await t.ctx.finishSetup();
  assert.deepEqual(t.views, []);
  assert.deepEqual(t.toasts, [['A bot is called Ada already. Give the Chief of Staff another name.', true]]);
});

test('Done without the question (setup done before) sends done alone, and goes on when the server cannot be reached', async () => {
  const t = setup({ s: { done: true }, answers: [new Error('offline')] });
  t.ctx.$ = () => null; // no name field on the page
  await t.ctx.finishSetup();
  assert.deepEqual(t.calls, [['PUT', '/setup', { done: true }]]);
  assert.deepEqual(t.views, ['chief'], 'as before: it still goes');
});

test('the feed\'s chief_name renames the Chief on the page at once', () => {
  const part = cut("es.addEventListener('chief_name'", '});');
  assert.match(part, /takeChiefName\(/);
  assert.match(part, /renderContacts\(\)/);
  assert.match(part, /drawChiefName\(\)/);
  assert.match(app, /takeChiefName\(chief\.chief\?\.name\)/, 'and from GET /api/chief');
});

// The name field of the Chief's settings (#379), with a stand-in server.
function rename({ answers = [], had = 'Chief of Staff' } = {}) {
  const field = element({}, { value: '' });
  const calls = [], toasts = [], drawn = [];
  const CHIEF_BOT = { name: had };
  const ctx = vm.createContext({
    CHIEF_BOT, CHIEF_ROLE: 'Chief of Staff', toast: (...a) => toasts.push(a),
    $: () => null, flashSaved: () => drawn.push('saved'), // "Saved" at the panel's top right
    chiefName: () => CHIEF_BOT.name,
    takeChiefName: (n) => { const v = n && n.trim() ? n.trim() : 'Chief of Staff'; if (v === CHIEF_BOT.name) return false; CHIEF_BOT.name = v; return true; },
    renderContacts: () => drawn.push('list'), drawChiefName: () => drawn.push('head'), drawPanelHead: () => drawn.push('panel'),
    api: async (path, opts = {}) => {
      calls.push([opts.method || 'GET', path, opts.body && JSON.parse(JSON.stringify(opts.body))]);
      const a = answers.shift();
      if (a instanceof Error) throw a;
      return a;
    },
  });
  vm.runInContext(`${cut('// Renames the Chief from its settings', '// The library skills you gave the Chief')}
    this.renameChief = renameChief;`, ctx);
  return { ctx, field, calls, toasts, drawn, CHIEF_BOT };
}

test('the Chief\'s settings rename it, as a bot is renamed, and every place says the new name at once', async () => {
  const t = rename({ answers: [{ name: 'Ada' }] });
  t.field.value = ' Ada ';
  await t.ctx.renameChief(t.field);
  assert.deepEqual(t.calls, [['PUT', '/settings/chief-name', { name: 'Ada' }]]);
  assert.equal(t.CHIEF_BOT.name, 'Ada');
  assert.deepEqual(t.drawn, ['list', 'head', 'panel', 'saved']);
  assert.equal(t.field.value, 'Ada');
  assert.deepEqual(t.toasts, [], 'no toast: "Saved" says it');
});

test('an emptied name gives back Chief of Staff, and the field shows its placeholder', async () => {
  const t = rename({ had: 'Ada', answers: [{ name: 'Chief of Staff' }] });
  t.field.value = '';
  await t.ctx.renameChief(t.field);
  assert.deepEqual(t.calls, [['PUT', '/settings/chief-name', { name: '' }]]);
  assert.equal(t.CHIEF_BOT.name, 'Chief of Staff');
  assert.equal(t.field.value, '');
});

test('a name the server refuses puts the field back, with its sentence', async () => {
  const t = rename({ had: 'Ada', answers: [Object.assign(new Error('Coder is the name of one of your bots.'), { status: 400 })] });
  t.field.value = 'Coder';
  await t.ctx.renameChief(t.field);
  assert.equal(t.CHIEF_BOT.name, 'Ada');
  assert.equal(t.field.value, 'Ada');
  assert.deepEqual(t.toasts, [['Coder is the name of one of your bots.', true]]);
  assert.deepEqual(t.drawn, []);
});

test('the Chief\'s settings have a name field only from a server that has names', () => {
  const part = cut('function renderChiefSettings()', '\n}\n');
  assert.match(part, /state\.features\.includes\('chief-name'\)/);
  assert.match(part, /id="chief-rename"[^>]*maxlength="40"/);
  assert.match(part, /renameChief\(rename\)/);
});
