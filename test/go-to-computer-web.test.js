// The "Go to <computer>" card on the web page (ADR 258): the card's own code cut out of public/computers.js and run against
// stand-ins. Waiting it has the steps and "I'm done", "Take over screen" and "Not now"; answered it is one line; one
// quick step is a one-line card; and a chat drawn again draws it as the run says, or as the owner just answered it.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { read, esc, words } = require('./web-page');

const source = read('computers.js');
const part = source.slice(source.indexOf('// ---------- the "Go to <computer>" card (ADR 258)'));
const fill = (s, v = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => v[k] ?? `{${k}}`);

const BOT = { id: 'qa', name: 'QA Tester' };
const STEPS = ['Browser window opened on its screen', 'Log in to Claude', "Come back and press I'm done"];
const run = (goTo, extra = {}) => ({ id: 'r1', botId: 'qa', goTo: { steps: STEPS, current: 2, bot: 'qa', place: 'linux', state: 'waiting', at: '2026-11-20T14:00:00Z', ...goTo }, ...extra });

function page({ answers = async () => ({ ok: true, state: 'done', text: 'QA Tester carries on.' }) } = {}) {
  const said = { api: [], toasts: [], screens: [], refreshes: 0, drawn: [] };
  const listeners = {};
  const cards = [];
  const ctx = vm.createContext({
    ...words, esc, Promise, Map, Date,
    tr: fill,
    msgTime: (iso) => `t:${iso.slice(11, 16)}`,
    ICON: { screen: '<svg screen/>' },
    botById: (id) => (id === BOT.id ? BOT : undefined),
    api: async (path, opts) => { said.api.push([path, JSON.parse(JSON.stringify(opts.body))]); return answers(path, opts); },
    toast: (...a) => said.toasts.push(a),
    refresh: () => { said.refreshes += 1; },
    openScreen: (id) => said.screens.push(id),
    document: {
      addEventListener: (type, fn) => { listeners[type] = fn; },
      querySelectorAll: () => cards,
    },
  });
  vm.runInContext(`${part}; this.goToCardHTML = goToCardHTML; this.goAnswers = goAnswers;`, ctx);
  // A card on the page, as the browser would hold it: replaced in place by outerHTML.
  const put = (html) => { const el = { dataset: { goRun: 'r1', goBot: 'qa' }, set outerHTML(h) { said.drawn.push(h); } }; cards.push(el); return el; };
  const press = async (what) => {
    const card = { dataset: { goRun: 'r1', goBot: 'qa' } };
    const b = { dataset: { goCard: what }, closest: () => card };
    await listeners.click({ target: { closest: () => b } });
  };
  return { ctx, said, put, press };
}

test('web: a waiting card has the steps, the one the owner is on, and its three buttons', () => {
  const { ctx } = page();
  const html = ctx.goToCardHTML(run({ minutes: 2 }));
  assert.match(html, /Go to QA Tester's computer/);
  assert.match(html, /Ubuntu · This machine/);
  assert.match(html, /Waiting for you/);
  assert.match(html, /class="ok"[^>]*><span class="go-n"><svg[^]*?Browser window opened on its screen/, 'a step before the current one is done');
  assert.match(html, /class="on" aria-current="step"><span class="go-n">2<\/span><span>Log in to Claude/);
  assert.match(html, /<li class=""><span class="go-n">3<\/span>/);
  assert.match(html, /Takes about 2 min\./);
  for (const what of ['done', 'screen', 'later']) assert.match(html, new RegExp(`data-go-card="${what}"`));
  assert.match(html, /class="btn primary" data-go-card="done"/);
  assert.doesNotMatch(ctx.goToCardHTML(run({})), /Takes about/, 'no time hint when the bot gave none');
  assert.match(ctx.goToCardHTML(run({ place: 'boat' })), /Linux · External Virtual PC/);
});

test('web: nothing a bot wrote is markup', () => {
  const { ctx } = page();
  const html = ctx.goToCardHTML(run({ steps: ['<img src=x onerror=alert(1)>'], current: 1 }));
  assert.doesNotMatch(html, /<img/);
  assert.match(html, /&lt;img/);
});

test('web: answered, the card is one line that stays in history', () => {
  const { ctx } = page();
  const done = ctx.goToCardHTML(run({ state: 'done', answeredAt: '2026-11-20T14:32:00Z' }));
  assert.match(done, /QA Tester's computer/);
  assert.match(done, /You confirmed · t:14:32/);
  assert.match(done, /Done/);
  assert.doesNotMatch(done, /go-steps|data-go-card/, 'no steps, no buttons');
  const later = ctx.goToCardHTML(run({ state: 'later', answeredAt: '2026-11-20T14:32:00Z' }));
  assert.match(later, /You said not now · t:14:32/);
  assert.doesNotMatch(later, /data-go-card/);
});

test('web: one quick step is a one-line card with only "I\'m done"', () => {
  const { ctx } = page();
  const html = ctx.goToCardHTML(run({ steps: ['Approve the sign-in prompt'], current: 1, compact: true }));
  assert.match(html, /Go to QA Tester's computer/);
  assert.match(html, /Approve the sign-in prompt/);
  assert.match(html, /data-go-card="done"/);
  assert.doesNotMatch(html, /data-go-card="(screen|later)"|go-steps/);
  assert.match(ctx.goToCardHTML(run({ steps: ['x'], current: 1, compact: true, title: 'Approve the prompt' })), /Approve the prompt/);
});

test('web: a run without a card, or one not made by botdot, draws nothing', () => {
  const { ctx } = page();
  assert.equal(ctx.goToCardHTML({ id: 'r1', botId: 'qa' }), '');
  assert.equal(ctx.goToCardHTML(run({ state: 'odd' })), '');
  assert.equal(ctx.goToCardHTML(run({ steps: [] })), '');
});

test('web: "I\'m done" sends the answer once, and a chat drawn again keeps the card answered', async () => {
  const { ctx, said, put, press } = page();
  put();
  ctx.goToCardHTML(run({}));
  await press('done');
  assert.deepEqual(said.api, [['/bots/qa/computer/card', { run: 'r1', answer: 'done' }]]);
  assert.deepEqual(JSON.parse(JSON.stringify(said.toasts)), [['QA Tester carries on.']]);
  assert.equal(said.refreshes, 1);
  // The run list has not caught up yet (it still says waiting): the redraw shows what was pressed.
  assert.match(ctx.goToCardHTML(run({})), /You confirmed/);
  assert.doesNotMatch(ctx.goToCardHTML(run({})), /data-go-card/);
  // The redraw in place at the press and at the answer.
  assert.equal(said.drawn.length, 2);
  assert.match(said.drawn[0], /aria-busy|disabled/, 'buttons wait while it is sent');
});

test('web: "Not now" sends its own answer; "Take over screen" opens the bot\'s screen and answers nothing', async () => {
  const { ctx, said, put, press } = page({ answers: async () => ({ ok: true, state: 'later', text: 'QA Tester carries on without it.' }) });
  put();
  ctx.goToCardHTML(run({}));
  await press('screen');
  assert.deepEqual(said.screens, ['qa']);
  assert.deepEqual(said.api, []);
  await press('later');
  assert.deepEqual(said.api, [['/bots/qa/computer/card', { run: 'r1', answer: 'later' }]]);
  assert.match(ctx.goToCardHTML(run({})), /You said not now/);
});

test('web: a refused answer says why and leaves the card waiting; one answered elsewhere shows as it was answered', async () => {
  const refused = page({ answers: async () => { throw Object.assign(new Error('QA Tester is working on it already.'), { status: 409 }); } });
  refused.put();
  refused.ctx.goToCardHTML(run({}));
  await refused.press('done');
  assert.deepEqual(JSON.parse(JSON.stringify(refused.said.toasts)), [['QA Tester is working on it already.', true]]);
  assert.match(refused.ctx.goToCardHTML(run({})), /data-go-card="done"/);
  const elsewhere = page({ answers: async () => { throw Object.assign(new Error('You answered that card already.'), { status: 409, state: 'done' }); } });
  elsewhere.put();
  elsewhere.ctx.goToCardHTML(run({}));
  await elsewhere.press('done');
  assert.match(elsewhere.ctx.goToCardHTML(run({})), /You confirmed/);
});

test("web: the bot's chat draws the card under the reply, and redraws when its state changes", () => {
  const chat = read('bot-chat.js');
  assert.match(chat, /\$\{shown\}\n\s+\$\{failed \? '' : globalThis\.goToCardHTML\?\.\(r\) \|\| ''\}/);
  assert.match(chat, /r\.goTo \? `:go-\$\{r\.goTo\.state\}` : ''/);
});
