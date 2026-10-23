// The Reconnect card on the web page (#431, #464, public/connectors.js): under the reply of a job's run, the app it found
// signed out and a Reconnect button, which connects it as the Connectors page does. The card says where that is:
// opening, waiting for the sign-in, connected, or what went wrong, and the button is never stuck.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { read, esc } = require('./web-page');

// The page with one card of each run on it: a click is the document's click listener, the cards are redrawn in place.
function page({ connect = { redirectUrl: 'https://connect.example/gmail', connectionId: 'ca_1' }, statuses = ['ACTIVE'] } = {}) {
  const calls = [];
  const toasts = [];
  const tab = { location: null, closed: false, close() { this.closed = true; } };
  let onClick = null;
  const waits = [];
  const cards = [];
  const ctx = vm.createContext({
    state: { view: 'bot', bots: [] }, esc, encodeURIComponent, toast: (m) => toasts.push(m), confirm: () => true, location: {},
    $: () => ({ dataset: {} }),
    window: { open: () => tab },
    document: {
      addEventListener: (type, fn) => { if (type === 'click') onClick = fn; },
      querySelectorAll: () => cards,
    },
    setTimeout: (fn) => waits.push(fn), // the wait for the connection: one step at a time, by the test
    api: async (p, opts = {}) => {
      calls.push([p, opts.method || 'GET', opts.body]);
      if (p === '/connectors/connect') { if (connect instanceof Error) throw connect; return connect; }
      if (p === '/connectors/connections/ca_1') return { status: statuses.length > 1 ? statuses.shift() : statuses[0] };
      return {};
    },
    renderConnectors: () => { throw new Error('not the Connectors page'); },
  });
  vm.runInContext(`${read('connectors.js')}\nthis.reconnectCardsHTML = reconnectCardsHTML;`, ctx);
  // A card as the chat draws it, standing on the page: its outerHTML is what is drawn there now.
  const draw = (run) => {
    const html = ctx.reconnectCardsHTML(run);
    const m = html.match(/data-reconnect-card="([^"]*)" data-name="([^"]*)"/);
    const el = { outerHTML: html, dataset: { reconnectCard: m[1], name: m[2].replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&') } };
    cards.push(el);
    return el;
  };
  const settle = async () => { for (let i = 0; i < 5; i++) await new Promise((r) => setImmediate(r)); };
  const step = async () => { await settle(); const fn = waits.shift(); assert.ok(fn, 'it waits for the connection'); fn(); await settle(); };
  const press = async (el) => { onClick({ target: { closest: () => ({ dataset: { reconnect: el.dataset.reconnectCard } }) } }); };
  return { ctx, calls, toasts, tab, draw, press, step, settle, waits };
}
const GMAIL = { reconnect: [{ app: 'gmail', name: 'Gmail' }] };

test('web: a card per signed-out app, its name as text, and none for a run without one', () => {
  const { ctx } = page();
  const html = ctx.reconnectCardsHTML({ reconnect: [{ app: 'gmail', name: 'Gmail <b>x</b>' }] });
  assert.match(html, /<span><b>Gmail &lt;b&gt;x&lt;\/b&gt;<\/b> is signed out<\/span><button class="btn sm primary" data-reconnect="gmail">Reconnect<\/button><\/div>$/);
  for (const run of [{}, { reconnect: null }, { reconnect: [{ name: 'No slug' }] }, null]) assert.equal(ctx.reconnectCardsHTML(run), '');
});

test('web: Reconnect says it opens, then that it waits for the sign-in, then that the app is connected', async () => {
  const p = page({ statuses: ['INITIATED', 'ACTIVE'] });
  const card = p.draw(GMAIL);
  await p.press(card);
  assert.match(card.outerHTML, /<b>Gmail<\/b> is signed out<\/span><button class="btn sm primary" disabled>Opening…<\/button>/, 'at once, in the card');
  await p.settle();
  assert.equal(p.tab.location, 'https://connect.example/gmail');
  assert.match(card.outerHTML, /<b>Gmail<\/b> waits for sign-in<\/span><button class="btn sm primary" data-reconnect="gmail">Reconnect<\/button>/, 'pressed again, it opens a new sign-in');
  await p.step();
  assert.match(card.outerHTML, /waits for sign-in/);
  await p.step();
  assert.match(card.outerHTML, /<span><b>Gmail<\/b> is connected<\/span><\/div>$/);
  assert.deepEqual(p.toasts, [], 'the card says it all');
  assert.equal(JSON.stringify(p.calls.map((c) => c[0])), JSON.stringify(['/connectors/connect', '/connectors/connections/ca_1', '/connectors/connections/ca_1']));
  assert.match(p.ctx.reconnectCardsHTML(GMAIL), /is connected/, 'a chat drawn again keeps it');
});

test('web: an error stays in the card, and the button tries again', async () => {
  const p = page({ connect: new Error('GitHub only signs in through your own developer app.') });
  const card = p.draw({ reconnect: [{ app: 'github', name: 'GitHub MCP' }] });
  await p.press(card);
  await p.settle();
  assert.equal(p.tab.closed, true, 'the blank tab is closed');
  assert.match(card.outerHTML, /<b>GitHub MCP<\/b> is signed out<\/span><button class="btn sm primary" data-reconnect="github">Try again<\/button><div class="reconnect-error" role="alert">GitHub only signs in through your own developer app\.<\/div>/);
  assert.deepEqual(p.toasts, []);
});

test('web: a sign-in tab closed without connecting puts the card back as it was', async () => {
  const p = page({ statuses: ['INITIATED'] });
  const card = p.draw(GMAIL);
  await p.press(card);
  await p.settle();
  p.tab.closed = true;
  await p.step(); // one more look: it may have just finished
  await p.step();
  assert.match(card.outerHTML, /is signed out<\/span><button class="btn sm primary" data-reconnect="gmail">Reconnect<\/button><\/div>$/);
  await p.settle();
  assert.equal(p.waits.length, 0, 'no more waiting');
});

test('web: a second press ends the first wait', async () => {
  const p = page({ statuses: ['INITIATED'] });
  const card = p.draw(GMAIL);
  await p.press(card);
  await p.settle();
  await p.press(card);
  await p.settle();
  assert.equal(p.calls.filter((c) => c[0] === '/connectors/connect').length, 2);
  p.waits.shift()(); // the first wait's next step
  await p.settle();
  assert.equal(p.calls.filter((c) => c[0] === '/connectors/connections/ca_1').length, 0, 'the first wait asks nothing more');
  assert.match(card.outerHTML, /waits for sign-in/);
});

test('web: the Connectors page draws a connection without a status, and says why when it cannot draw at all', async () => {
  const root = { dataset: {}, innerHTML: '' };
  const el = () => ({ dataset: {}, focus() {}, setSelectionRange() {} });
  const data = { configured: true, account: 'own', keyHint: '…1234', connections: [{ id: 'ca_1', toolkit: 'github', app: { name: 'GitHub MCP' }, usedBy: [] }], reconnect: [] };
  const ctx = vm.createContext({
    state: { view: 'connectors', bots: [] }, esc, encodeURIComponent, URLSearchParams, toast() {}, SUB_BACK: '', botLabel: () => '',
    $: (q) => (q === '#view-connectors' ? root : el()), $$: () => [], document: { addEventListener() {} },
    api: async (p) => (p === '/connectors' ? data : p.startsWith('/connectors/catalog') ? { items: [], nextOffset: null, total: 0 } : []),
  });
  vm.runInContext(read('connectors.js'), ctx);
  await ctx.renderConnectors(true);
  assert.match(root.innerHTML, /<b>GitHub MCP<\/b><div><span class="pill ">unknown<\/span>/);
  data.connections = [{ id: 'ca_1', toolkit: 'github', app: null, usedBy: null }]; // something it can't draw
  await ctx.renderConnectors(true);
  assert.match(root.innerHTML, /<h1>Connectors<\/h1>.*<div class="req-note">Couldn't show your apps: /s);
});

test('web: the chat draws the cards in the reply, and the page styles them', () => {
  assert.match(read('bot-chat.js'), /Pages\.chipsHTML\(r\) : ''\}\$\{globalThis\.reconnectCardsHTML\?\.\(r\) \|\| ''\}/);
  assert.match(read('style.css'), /\.reconnect-card \{/);
  assert.match(read('style.css'), /\.reconnect-error \{/);
});
