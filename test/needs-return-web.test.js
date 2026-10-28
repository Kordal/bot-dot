// Needs you returns the owner to where they came from (#264): public/needs-return.js loaded the way the browser
// loads it, and the page's own code for the Needs you page (test/need-cards.js) run against stand-ins. After the
// last open card is answered on the page, it waits a moment and goes back to the chat, or the view, it was opened
// from; a page that opened with nothing waiting stays, and a card that comes in keeps the owner there.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { read, cut } = require('./web-page');
const { page, plain, NEWS } = require('./need-cards');

const lib = vm.createContext({});
vm.runInContext(read('needs-return.js'), lib);
const { NeedsReturn } = lib;

const memory = (id) => ({ id, action: 'add', text: `Note ${id}.`, at: '2026-10-21T10:00:00.000Z', bot: NEWS, botId: 'news', title: 'Add to the shared memory', yes: 'Approve', no: 'Decline' });
const live = (p) => p.timers.filter((t) => t.on);

test('web: the page gets it as window.NeedsReturn, before app.js', () => {
  const html = read('index.html');
  const at = (f) => html.indexOf(`<script src="${f}"></script>`);
  assert.ok(at('/needs-return.js') > 0 && at('/needs-return.js') < at('/app.js'));
});

test('web: where the page returns to is the view it was opened from, with its bot, group or Chief chat', () => {
  assert.deepEqual(plain(NeedsReturn.from({ view: 'bot', botId: 'qa' }, false)), { view: 'bot', id: 'qa' });
  assert.deepEqual(plain(NeedsReturn.from({ view: 'group', groupId: 'g1' }, false)), { view: 'group', id: 'g1' });
  assert.deepEqual(plain(NeedsReturn.from({ view: 'chief', chatId: 'c7' }, false)), { view: 'chief', id: 'c7' });
  assert.deepEqual(plain(NeedsReturn.from({ view: 'dashboard' }, false)), { view: 'dashboard', id: null }, 'the Board');
  assert.deepEqual(plain(NeedsReturn.from({ view: 'bot', botId: 'qa' }, true)), { view: 'bot', id: 'qa', list: true }, 'a phone showing the list of bots: the list, over that chat');
  assert.equal(NeedsReturn.from({ view: 'needs' }, false), null, 'opened again from itself: nowhere');
  assert.equal(NeedsReturn.from({}, false), null);
});

test('web: it leaves only when the cards went from some to none during the visit, answered on the page', () => {
  assert.deepEqual(plain(NeedsReturn.step(false, 0, false)), { seen: false, leave: false }, 'opened with nothing waiting: it stays');
  assert.deepEqual(plain(NeedsReturn.step(false, 2, false)), { seen: true, leave: false });
  assert.deepEqual(plain(NeedsReturn.step(true, 1, true)), { seen: true, leave: false });
  assert.deepEqual(plain(NeedsReturn.step(true, 0, true)), { seen: false, leave: true });
  assert.deepEqual(plain(NeedsReturn.step(false, 0, true)), { seen: false, leave: false }, 'and once only');
  assert.deepEqual(plain(NeedsReturn.step(true, 0, false)), { seen: false, leave: false }, 'all answered elsewhere while the owner reads: it stays');
  assert.ok(NeedsReturn.DELAY >= 800 && NeedsReturn.DELAY <= 2000, 'a moment to read the answer, not a wait');
});

test('web: three cards, two answered: the page stays; the third answered: back to the chat after the moment', () => {
  const p = page({ state: { view: 'needs', cameFrom: { view: 'bot', id: 'news' }, memPending: [memory('m1'), memory('m2'), memory('m3')] } });
  p.renderNeeds();
  p.needsDone.set('mem:m1', '<card>').set('mem:m2', '<card>'); // answered on the page
  p.state.memPending = [memory('m3')];
  p.renderNeeds();
  assert.equal(live(p).length, 0);
  p.needsDone.set('mem:m3', '<card>');
  p.state.memPending = [];
  p.renderNeeds();
  assert.match(p.needsPage.innerHTML, /All done\./, 'the answered cards are still to be read');
  assert.equal(live(p).length, 1);
  assert.equal(live(p)[0].ms, NeedsReturn.DELAY);
  assert.deepEqual(p.went, [], 'not at once');
  live(p)[0].fn();
  assert.deepEqual(plain(p.went), [['bot', 'news']]);
});

test('web: a card answered on the page (approved or declined) counts as gone', async () => {
  for (const yes of [true, false]) {
    const p = page({ state: { view: 'needs', cameFrom: { view: 'group', id: 'g1' }, memPending: [memory('m1')] } });
    p.renderNeeds();
    p.show('mem:m1');
    await p.decide(p.item('mem:m1'), yes);
    p.renderNeeds(); // what the refresh after the answer draws, the card still in the list until it arrives
    live(p)[0].fn();
    assert.deepEqual(plain(p.went), [['group', 'g1']]);
  }
});

test('web: from the Chief chat it opens that chat; from the Board, the Board; from a phone\'s list, the list', () => {
  for (const [cameFrom, went] of [[{ view: 'chief', id: 'c7' }, [['chief', 'c7']]], [{ view: 'dashboard', id: null }, [['dashboard', null]]], [{ view: 'bot', id: 'news', list: true }, [['bot', 'news'], ['list']]]]) {
    const p = page({ state: { view: 'needs', cameFrom, memPending: [memory('m1')] } });
    p.renderNeeds();
    p.needsDone.set('mem:m1', '<card>');
    p.state.memPending = [];
    p.renderNeeds();
    live(p)[0].fn();
    assert.deepEqual(plain(p.went), went);
  }
});

test('web: a card answered elsewhere while the owner reads the page keeps the owner there', () => {
  const p = page({ state: { view: 'needs', cameFrom: { view: 'bot', id: 'news' }, memPending: [memory('m1')] } });
  p.renderNeeds();
  p.state.memPending = [];
  p.renderNeeds();
  assert.equal(p.timers.length, 0);
});

test('web: opened with nothing waiting, it stays on "All done."', () => {
  const p = page({ state: { view: 'needs', cameFrom: { view: 'bot', id: 'news' }, memPending: [] } });
  p.renderNeeds();
  p.renderNeeds();
  assert.match(p.needsPage.innerHTML, /All done\./);
  assert.equal(p.timers.length, 0);
});

test('web: a card that comes in during the moment keeps the owner on the page', () => {
  const p = page({ state: { view: 'needs', cameFrom: { view: 'bot', id: 'news' }, memPending: [memory('m1')] } });
  p.renderNeeds();
  p.needsDone.set('mem:m1', '<card>');
  p.state.memPending = [];
  p.renderNeeds();
  assert.equal(live(p).length, 1);
  p.state.memPending = [memory('m2')];
  p.renderNeeds();
  assert.equal(live(p).length, 0, 'the wait is off');
});

test('web: the page left by hand during the moment, or opened from nowhere, goes nowhere by itself', () => {
  const p = page({ state: { view: 'needs', cameFrom: { view: 'bot', id: 'news' }, memPending: [memory('m1')] } });
  p.renderNeeds();
  p.needsDone.set('mem:m1', '<card>');
  p.state.memPending = [];
  p.renderNeeds();
  const t = live(p)[0];
  p.state.view = 'chief';
  t.fn();
  assert.deepEqual(p.went, []);
  const q = page({ state: { view: 'needs', cameFrom: null, memPending: [memory('m1')] } });
  q.renderNeeds();
  q.needsDone.set('mem:m1', '<card>');
  q.state.memPending = [];
  q.renderNeeds();
  assert.equal(q.timers.length, 0);
  assert.equal(q.leaveNeeds(), false, 'Back then goes to the list, as every page\'s Back on a phone');
});

test('web: the view it was opened from is kept as it opens, and its Back goes there too', () => {
  assert.match(cut('function show({ view: v', 'function threadToEnd'), /if \(changed && v === 'needs'\) state\.cameFrom = NeedsReturn\.from\(state, matchMedia\(PHONE\)\.matches && !\$\('#app'\)\.classList\.contains\('in-main'\)\);\n\s+const was/, 'before state.view changes');
  assert.match(cut('function show({ view: v', 'function threadToEnd'), /if \(changed\) \{[^\n]*stayOnNeeds\(\); \}/, 'a view changed: no wait carries over');
  const render = cut('function renderNeeds() {', '// The buttons on need cards');
  assert.match(render, /\$\{needsBack\(\)\}<h1>\$\{tr\('Needs you'\)\}<\/h1>/);
  assert.match(render, /back\.onclick = \(\) => \{ if \(!leaveNeeds\(\)\) showList\(\); \}/);
  assert.match(cut('const needsBack', 'let needsSeen'), /BACK_BTN\.replace\('data-back', 'data-needs-back'\)/, 'not the Back every page has, which shows the list');
});
