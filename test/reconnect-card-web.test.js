// The Reconnect card on the web page (#431, public/connectors.js): under the reply of a job's run, the app it found signed
// out and a Reconnect button, which connects it as the Connectors page does and then says it is connected.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { read, esc } = require('./web-page');

function page() {
  const calls = [];
  const opened = { location: null, close() {} };
  let onClick = null;
  let drawn = 0;
  const ctx = vm.createContext({
    state: { view: 'bot', bots: [] }, esc, encodeURIComponent, toast() {}, confirm: () => true, location: {},
    $: () => ({ dataset: { sig: 'x' } }),
    window: { open: () => opened },
    document: { addEventListener: (type, fn) => { if (type === 'click') onClick = fn; } },
    setTimeout: (fn) => fn(), // the wait for the connection, at once
    api: async (p, opts = {}) => {
      calls.push([p, opts.method || 'GET', opts.body]);
      if (p === '/connectors/connect') return { redirectUrl: 'https://connect.example/gmail', connectionId: 'ca_1' };
      if (p === '/connectors/connections/ca_1') return { status: 'ACTIVE' };
      return {};
    },
    renderBotChat: () => { drawn++; },
    renderConnectors: () => { throw new Error('not the Connectors page'); },
  });
  vm.runInContext(`${read('connectors.js')}\nthis.reconnectCardsHTML = reconnectCardsHTML;`, ctx);
  return { ctx, calls, opened, click: (button) => onClick({ target: { closest: () => button } }), drawn: () => drawn };
}

test('web: a card per signed-out app, its name as text, and none for a run without one', () => {
  const { ctx } = page();
  const html = ctx.reconnectCardsHTML({ reconnect: [{ app: 'gmail', name: 'Gmail <b>x</b>' }] });
  assert.match(html, /<div class="reconnect-card"><span><b>Gmail &lt;b&gt;x&lt;\/b&gt;<\/b> is signed out<\/span><button class="btn sm primary" data-reconnect="gmail">Reconnect<\/button><\/div>/);
  for (const run of [{}, { reconnect: null }, { reconnect: [{ name: 'No slug' }] }, null]) assert.equal(ctx.reconnectCardsHTML(run), '');
});

test('web: Reconnect connects the app as the Connectors page does, and the card then says it is connected', async () => {
  const p = page();
  const button = { dataset: { reconnect: 'gmail' }, disabled: false };
  p.click(button);
  assert.equal(button.disabled, true);
  await new Promise((r) => setImmediate(r));
  await new Promise((r) => setImmediate(r));
  assert.equal(JSON.stringify(p.calls), JSON.stringify([['/connectors/connect', 'POST', { app: 'gmail' }], ['/connectors/connections/ca_1', 'GET', undefined]]));
  assert.equal(p.opened.location, 'https://connect.example/gmail');
  assert.equal(p.drawn(), 1, 'the chat is drawn again');
  assert.equal(button.disabled, false);
  assert.match(p.ctx.reconnectCardsHTML({ reconnect: [{ app: 'gmail', name: 'Gmail' }] }), /<b>Gmail<\/b> is connected<\/span><\/div>$/);
});

test('web: the chat draws the cards in the reply, and the page styles them', () => {
  assert.match(read('bot-chat.js'), /Pages\.chipsHTML\(r\) : ''\}\$\{globalThis\.reconnectCardsHTML\?\.\(r\) \|\| ''\}/);
  assert.match(read('style.css'), /\.reconnect-card \{/);
});
