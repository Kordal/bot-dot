// A missing app's card on the web page (`connect-app`, #1183, ADR 168): the page's own code for the cards
// (test/need-cards.js) and for Connect (public/connectors.js) against the ask as the server sends it (docs/api.md,
// "A missing connected app"). The card is the server's title, Not now and the button its `act` names; its Connect
// opens the sign-in tab on the press, asks the server through the card, and says where that is.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const Keypad = require('../public/keypad.js');
const { app, read, esc, words } = require('./web-page');
const { page, titleOf, metaOf, BAD } = require('./need-cards');

const MAIL = { id: 'mail', name: 'Mail Writer', color: '#9b59d0' };
const CONNECT = {
  id: 'c1', kind: 'connect-app', botId: 'mail', bot: MAIL, app: 'gmail', name: 'Gmail', mode: 'connect', reason: 'To send the weekly summary.',
  title: 'Connect Gmail for Mail Writer', act: { verb: 'connect', label: 'Connect' }, no: 'Not now', text: 'Needs Gmail connected', yesOn: 'card', at: '2026-11-07T09:00:00.000Z',
};
const RECONNECT = { ...CONNECT, id: 'c2', mode: 'reconnect', title: 'Reconnect Gmail', act: { verb: 'connect', label: 'Reconnect' }, text: 'Needs Gmail reconnected' };
const SETUP = { ...CONNECT, id: 'c3', mode: 'setup', key: true, title: 'Add your Composio key', act: { verb: 'open', screen: 'connectors', label: 'Open Apps' }, body: 'Composio refused the key.' };
// Every button of a card, the act button too, in the order drawn.
const buttons = (html) => [...html.matchAll(/<button class="btn sm[^"]*"( data-need-(?:no|yes|always|act))?( disabled)?>(.*?)<\/button>/g)].map((m) => m[3]);

// The page with one ask, Connect's own code loaded, a sign-in tab, and the server's answers to the card's two routes.
function connectPage(ask, { features = ['connect-cards'], post = { redirectUrl: 'https://connect.example/gmail', connectionId: 'ca_1', expiresAt: new Date(Date.now() + 600e3).toISOString() }, statuses = ['ACTIVE'] } = {}) {
  const calls = [], order = [];
  const tab = { location: null, closed: false, close() { this.closed = true; } };
  const p = page({ state: { asks: [ask], bots: [MAIL], features }, extra: {
    window: { open: () => { order.push('tab'); return tab; } }, location: {}, encodeURIComponent,
    document: { createElement: () => ({}), addEventListener() {}, querySelectorAll: () => [] },
    api: async (url, opts = {}) => {
      calls.push([url, opts.method || 'GET']);
      order.push(url);
      if (url === `/asks/${ask.id}/connect` && opts.method === 'POST') { if (post instanceof Error) throw post; return post; }
      if (url === `/asks/${ask.id}/connect`) { const s = statuses.length > 1 ? statuses.shift() : statuses[0]; if (s instanceof Error) throw s; return { status: s }; }
      return {};
    },
  } });
  vm.runInContext(read('connectors.js'), p.ctx);
  const settle = async () => { for (let i = 0; i < 6; i++) await new Promise((r) => setImmediate(r)); };
  // The wait for the connection: its next look, by the test.
  const step = async () => { await settle(); const t = p.timers.filter((x) => x.on && x.ms === 3000).shift(); assert.ok(t, 'it waits for the connection'); t.on = false; t.fn(); await settle(); };
  const draw = () => p.needCardHTML(p.item(`ask:${ask.id}`));
  return { ...p, calls, order, tab, settle, step, draw, press: () => p.actNeed(p.item(`ask:${ask.id}`)) };
}

test("web: the card is the server's title, Not now and its Connect, no more", () => {
  const html = connectPage(CONNECT).draw();
  assert.equal(titleOf(html), 'Connect Gmail for Mail Writer');
  assert.equal(metaOf(html), null, 'no line under the title: the reason is not drawn');
  assert.deepEqual(buttons(html), ['Not now', 'Connect']);
  assert.match(html, /<button class="btn sm" data-need-no>Not now<\/button><button class="btn sm primary" data-need-act>Connect<\/button>/);
  assert.doesNotMatch(html, /need-body|weekly summary|Install|skill/);
});

test('web: a Reconnect reads the server\'s word, and the page\'s own by the mode when it sends none', () => {
  assert.deepEqual(buttons(connectPage(RECONNECT).draw()), ['Not now', 'Reconnect']);
  assert.deepEqual(buttons(connectPage({ ...RECONNECT, act: { verb: 'connect' }, no: undefined }).draw()), ['Not now', 'Reconnect']);
  assert.deepEqual(buttons(connectPage({ ...CONNECT, act: { verb: 'connect' } }).draw()), ['Not now', 'Connect']);
});

test("web: in setup the card opens Connectors and shows Composio's words; a verb the page does not know draws no card", () => {
  const html = connectPage(SETUP).draw();
  assert.equal(titleOf(html), 'Add your Composio key');
  assert.deepEqual(buttons(html), ['Not now', 'Open Apps']);
  assert.match(html, /<div class="need-body"><div class="nb">Composio refused the key\.<\/div><\/div>/);
  assert.equal(connectPage({ ...CONNECT, act: { verb: 'sing', label: 'Sing' } }).draw(), '');
  assert.equal(connectPage({ ...SETUP, act: { verb: 'open', screen: 'claude', label: 'Open' } }).draw(), '');
});

test('web: what the server sent is text on the card', () => {
  const html = connectPage({ ...CONNECT, title: BAD, act: { verb: 'connect', label: BAD }, no: BAD }).draw();
  assert.doesNotMatch(html, /<img|<script/);
});

test('web: Connect opens the tab on the press, then asks through the card, waits, and the card goes once connected', async () => {
  const p = connectPage(CONNECT, { statuses: ['INITIATED', 'ACTIVE'] });
  p.press();
  assert.deepEqual(p.order, ['tab', '/asks/c1/connect'], 'the tab opens on the press, before the request, so pop-up blockers allow it');
  assert.deepEqual(buttons(p.draw()), ['Not now', 'Opening…']);
  await p.settle();
  assert.deepEqual(p.calls[0], ['/asks/c1/connect', 'POST']);
  assert.equal(p.tab.location, 'https://connect.example/gmail');
  assert.equal(metaOf(p.draw()), 'Waiting for sign-in');
  assert.deepEqual(buttons(p.draw()), ['Not now', 'Connect'], 'pressed again, it opens a new sign-in');
  await p.step();
  assert.equal(p.refreshed(), 0);
  await p.step();
  assert.deepEqual(p.calls.map((c) => c.join(' ')), ['/asks/c1/connect POST', '/asks/c1/connect GET', '/asks/c1/connect GET']);
  assert.equal(p.refreshed(), 1, 'the list of what waits is read again: the card goes with it');
  assert.equal(p.connecting.has('c1'), false);
  assert.deepEqual(p.toasts, [], 'the card says it all');
  assert.ok(!p.calls.some(([u]) => u.startsWith('/connectors')), 'not the Apps page\'s own routes, and no question of which bots');
});

test('web: an app with no sign-in is done at once', async () => {
  const p = connectPage(CONNECT, { post: { noAuth: true, ok: true, settled: true } });
  p.press();
  await p.settle();
  assert.equal(p.tab.closed, true);
  assert.equal(p.refreshed(), 1);
  assert.equal(p.timers.filter((t) => t.ms === 3000).length, 0, 'nothing to wait for');
});

test("web: Composio's refusal stays on the card, the button tries again, and the list is read for its setup", async () => {
  const p = connectPage(CONNECT, { post: Object.assign(new Error('Gmail could not be connected: the app is switched off in Composio.'), { status: 502 }) });
  p.show('ask:c1'); // the card stands on the page
  p.press();
  await p.settle();
  assert.equal(p.tab.closed, true, 'the blank tab is closed');
  const html = p.draw();
  assert.match(html, /<div class="req-error" role="alert">Gmail could not be connected: the app is switched off in Composio\.<\/div>/);
  assert.deepEqual(buttons(html), ['Not now', 'Try again']);
  assert.equal(p.refreshed(), 1);
  assert.deepEqual(p.toasts, []);
});

test('web: a refusal for a card not on the page (its row on a project\'s page) is a toast', async () => {
  const p = connectPage(CONNECT, { post: new Error('No.') });
  p.press();
  await p.settle();
  assert.deepEqual(p.toasts, [['No.', true]]);
});

test('web: a card answered elsewhere meanwhile ends the wait', async () => {
  const p = connectPage(CONNECT, { statuses: [Object.assign(new Error('That request was already answered.'), { status: 404 })] });
  p.press();
  await p.settle();
  await p.step();
  assert.equal(p.refreshed(), 1);
  assert.equal(p.timers.filter((t) => t.on && t.ms === 3000).length, 0);
});

test('web: a server without connect-cards is never sent the Connect (it would take it for a no): Connectors opens', () => {
  const p = connectPage(CONNECT, { features: [] });
  p.press();
  assert.deepEqual(p.calls, []);
  assert.deepEqual(p.order, []);
  assert.deepEqual(p.went, [['connectors', undefined]]);
});

test('web: Open Connectors opens the Connectors view', () => {
  const p = connectPage(SETUP);
  p.press();
  assert.deepEqual(p.calls, []);
  assert.deepEqual(p.went, [['connectors', undefined]]);
});

test('web: the page asks for these cards wherever it reads the asks, and wires their button', () => {
  assert.equal(app.match(/api\('\/asks\?vault-switch=1&vault-remove=1&vault-save=1&vault-file=1&override=1&chief-action=1&room-tool=1&room-post=1&computer-step=1&connect-app=1'\)/g).length, 2);
  assert.match(read('needs.js'), /if \(act\) act\.onclick = \(\) => actNeed\(x\);/);
});

// ---------- the run's Reconnect card ----------

test("web: a run's Reconnect card is not drawn for an app whose missing app's card of that bot waits", () => {
  const ctx = vm.createContext({ ...words, state: { asks: [CONNECT, { ...CONNECT, id: 'c9', botId: null, app: 'notion' }] }, esc, encodeURIComponent, document: { addEventListener() {} } });
  vm.runInContext(`${read('connectors.js')}\nthis.reconnectCardsHTML = reconnectCardsHTML;`, ctx);
  const run = (botId) => ({ botId, reconnect: [{ app: 'gmail', name: 'Gmail' }, { app: 'slack', name: 'Slack' }, { app: 'notion', name: 'Notion' }] });
  const apps = (html) => [...html.matchAll(/data-reconnect-card="([^"]*)"/g)].map((m) => m[1]);
  assert.deepEqual(apps(ctx.reconnectCardsHTML(run('mail'))), ['slack', 'notion'], "the Chief's own card is not this bot's");
  assert.deepEqual(apps(ctx.reconnectCardsHTML(run('news'))), ['gmail', 'slack', 'notion'], "another bot's card hides nothing");
  ctx.state.asks = undefined;
  assert.deepEqual(apps(ctx.reconnectCardsHTML(run('mail'))), ['gmail', 'slack', 'notion']);
});

// ---------- a project's Needs you ----------

test("a project's Needs you puts what stops the work first: a missing app, and an app a bot asks to be given", () => {
  const ask = (id, a) => ({ key: `ask:${id}`, kind: 'ask', a: { id, ...a } });
  const items = [
    ask('p1', { kind: 'permission' }), ask('p2', { kind: 'bot-change', asked: 'message' }), { key: 'job:j', kind: 'job' },
    ask('c1', { kind: 'connect-app' }), ask('g1', { kind: 'bot-change', asked: 'app' }),
    { key: 'batch:b', kind: 'batch', items: [ask('x', { kind: 'skill' })] }, { key: 'batch:c', kind: 'batch', items: [ask('y', { kind: 'skill' }), ask('c2', { kind: 'connect-app' })] },
  ];
  assert.deepEqual(Keypad.blockersFirst(items).map((x) => x.key), ['ask:c1', 'ask:g1', 'batch:c', 'ask:p1', 'ask:p2', 'job:j', 'batch:b']);
  assert.deepEqual(Keypad.blockersFirst([]), []);
  const home = read('company-home.js');
  assert.match(home, /const projectNeeds = \(c\) => Keypad\.blockersFirst\(Keypad\.asksOf\(/, 'the strip, its wiring and the To-do read the same order');
  // The row's button is the card's own (Connect, Open Connectors), in place of Review, in the strip and the To-do.
  assert.match(home, /: actLabel\(x\) \? `<button type="button" class="kp-allow" data-kp-act="\$\{i\}">\$\{esc\(actLabel\(x\)\)\}<\/button>`/);
  assert.match(home, /\$\$\('\[data-kp-act\]', box\)\.forEach\(\(b\) => \(b\.onclick = \(\) => actNeed\(asks\[Number\(b\.dataset\.kpAct\)\]\)\)\);/);
  assert.match(home, /answersInline\(x\) \? tr\('Approve'\) : esc\(actLabel\(x\)\) \|\| tr\('Review'\)/);
  assert.match(home, /else if \(actLabel\(x\)\) actNeed\(x\); else openNeed\(x\);/);
});

test("a row's button word: the card's own for a verb the page knows, none otherwise", () => {
  const p = connectPage(CONNECT);
  assert.equal(p.actLabel(p.item('ask:c1')), 'Connect');
  assert.equal(p.actLabel({ kind: 'ask', a: SETUP }), 'Open Apps');
  assert.equal(p.actLabel({ kind: 'ask', a: { kind: 'permission' } }), '');
  assert.equal(p.actLabel({ kind: 'ask', a: { ...CONNECT, act: { verb: 'sing' } } }), '');
  assert.equal(p.actLabel({ kind: 'job', job: {} }), '');
});

// ---------- the chats a card stands in ----------

test("web: a card stands in the chat it is for: the Chief's own in the Chief's, one offered for a bot in a chat in both, a run's in its bot's or group's", () => {
  const base = { kind: 'connect-app', app: 'gmail', name: 'Gmail', mode: 'connect', act: { verb: 'connect', label: 'Connect' }, no: 'Not now', title: 'T', text: 'x', yesOn: 'card', at: '2026-11-07T09:00:00.000Z' };
  const asks = [
    { ...base, id: 'own', botId: null, bot: null, chatId: 'ch1' },
    { ...base, id: 'forbot', botId: 'mail', bot: MAIL, chatId: 'ch1' },
    { ...base, id: 'run', botId: 'mail', bot: MAIL },
    { ...base, id: 'grp', botId: 'mail', bot: MAIL, groupId: 'g1' },
  ];
  const p = page({ state: { asks, bots: [MAIL], groups: [{ id: 'g1', name: 'G' }], features: ['connect-cards'] } });
  const keys = (scope) => [...p.chatNeeds(scope).map((x) => x.key)].sort();
  assert.deepEqual(keys('chief'), ['ask:forbot', 'ask:own']);
  assert.deepEqual(keys('mail'), ['ask:forbot', 'ask:run']);
  assert.deepEqual(keys('group:g1'), ['ask:grp']);
  assert.deepEqual([...p.needsItems().map((x) => x.key)].sort(), ['ask:forbot', 'ask:grp', 'ask:own', 'ask:run'], 'Needs you lists every one');
});
