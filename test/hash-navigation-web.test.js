// Exercise the page's real boot-time event registration, then change the address as a browser does: typed in, or
// Back and Forward between the entries typed addresses left (#1271, #1500).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { cut, element } = require('./web-page');

const PANELS = ['botsettings', 'botjobs', 'chiefsettings', 'groupsettings'];

// The page, its first view drawn (routed) or not yet. opened: each view setView opened, with its id.
function page(view = 'chief', { routed = true, sub, built = true } = {}) {
  const listeners = {};
  const opened = [];
  const drawn = []; // the chats drawn on a page built already
  const els = {}; // the page's elements, one per selector
  const state = { view, chatId: 'chat-1', selectedRun: 'run-1', botId: null, routed, hash: `#${view}${sub ? '/' + sub : ''}` };
  if (view === 'bot') state.botId = sub;
  const location = { hash: state.hash };
  const noop = () => {};
  const ctx = vm.createContext({
    state, location,
    Panel: { NAMES: PANELS },
    BOT_NAMES: ['bot', 'botsettings', 'botjobs'], GROUP_NAMES: ['group', 'groupsettings'],
    // The Chief's page and the run view, built already or not yet.
    $: (sel) => (built || !['#chat-thread', '#run-view'].includes(sel) ? (els[sel] ||= element()) : null),
    document: { documentElement: { dataset: {} }, addEventListener: noop },
    showChat: (id) => { state.chatId = id; drawn.push(`chat/${id}`); },
    matchMedia: () => ({ matches: false }), requestAnimationFrame: noop,
    addEventListener: (type, fn) => { listeners[type] = fn; },
    // As app.js: the id goes with its view, and the address then says the view (writeHash).
    setView: (next, id) => {
      if (['bot', 'botsettings', 'botjobs'].includes(next) && id) state.botId = id;
      if (['group', 'groupsettings'].includes(next) && id) state.groupId = id;
      state.view = next;
      opened.push(id ? `${next}/${id}` : next);
    },
    initSideGrip: noop, initChatGrip: noop, initSearch: noop, initQuote: noop, onKeypadKey: noop,
  });
  // The page's own openChiefChat (chief.js) and openRun (runs.js), with what they draw.
  vm.runInContext(cut('// Open the Chief on this chat', '// The owner reads at the end'), ctx);
  vm.runInContext(cut('function openRun(id) {', 'function toolArg('), ctx);
  ctx.getComputedStyle = () => ({ gridTemplateColumns: 'a b' });
  vm.runInContext(cut('// ---------- boot ----------', '(async () => {'), ctx);
  return { state, opened, drawn, els, ctx, navigate(hash) { location.hash = hash; listeners.hashchange?.(); } };
}

test('web: typing #setup into an open tab opens Setup without a reload', () => {
  for (const view of ['chief', 'bot', 'group', 'runs', 'settings']) {
    for (const routed of [true, false]) {
      const p = page(view, { routed });
      p.navigate('#setup');
      assert.equal(p.state.view, 'setup', `from ${view}`);
      assert.deepEqual(p.opened, ['setup']);
    }
  }
});

test('web: Back or a typed address opens the view it names (#1500)', () => {
  // Settings > Skills, then Back to Settings, or Activity typed in.
  for (const [hash, view] of [['#settings', 'settings'], ['#runs', 'runs'], ['#chief', 'chief'], ['#dashboard', 'dashboard'], ['#vault', 'vault']]) {
    const p = page('skills');
    p.navigate(hash);
    assert.equal(p.state.view, view, hash);
    assert.deepEqual(p.opened, [view], hash);
  }
});

test('web: #chief typed with a bot chat open opens the Chief, so the next message goes to the Chief (#1500)', () => {
  const p = page('bot', { sub: 'qa-echo' });
  p.navigate('#chief');
  assert.deepEqual(p.opened, ['chief']);
  // The composer that sends is the one of the view on screen: the Chief's chat, not the bot's.
  assert.equal(p.state.view, 'chief');
  assert.equal(p.state.chatId, 'chat-1', 'the Chief chat that was open');
});

test('web: an address with an id opens that chat, run, bot, group or skill', () => {
  let p = page('bot', { sub: 'qa-echo' });
  p.navigate('#chief/chat-2');
  assert.deepEqual(p.opened, ['chief']);
  assert.equal(p.state.chatId, 'chat-2');

  p = page('settings');
  p.navigate('#runs/run-2');
  assert.deepEqual(p.opened, ['runs']);
  assert.equal(p.state.selectedRun, 'run-2');

  p = page('chief');
  p.navigate('#bot/bot-2');
  assert.deepEqual(p.opened, ['bot/bot-2']);
  assert.equal(p.state.botId, 'bot-2');

  p = page('chief');
  p.navigate('#group/group-2');
  assert.deepEqual(p.opened, ['group/group-2']);

  p = page('chief');
  p.navigate('#botsettings/bot-3/skill/My%20skill');
  assert.deepEqual(p.opened, ['botsettings/bot-3']);
  assert.deepEqual({ ...p.state.openSkill }, { bot: 'bot-3', name: 'My skill' });
});

test('web: a chat or run named in the address is drawn on a page built already, so a message goes where it shows', () => {
  // The Chief's page shows chat-1; Back or a typed address names chat-2.
  let p = page('chief', { sub: 'chat-1' });
  p.navigate('#chief/chat-2');
  assert.deepEqual(p.drawn, ['chat/chat-2'], 'chat-2 drawn, not only selected');
  assert.equal(p.state.chatId, 'chat-2');
  // Not built yet: setView builds it on the selected chat, nothing is drawn twice.
  p = page('bot', { sub: 'qa-echo', built: false });
  p.navigate('#chief/chat-2');
  assert.deepEqual(p.drawn, []);
  assert.deepEqual(p.opened, ['chief']);
  assert.equal(p.state.chatId, 'chat-2');
  // A run open beside the list: its view is cleared, so the run named in the address is drawn (runs.js).
  p = page('runs', { sub: 'run-1' });
  p.els['#run-view'] = element();
  p.els['#run-view'].dataset.id = 'run-1';
  p.navigate('#runs/run-2');
  assert.equal(p.els['#run-view'].dataset.id, '', 'the open run cleared, so renderRuns draws run-2');
  assert.deepEqual(p.opened, ['runs']);
  assert.equal(p.state.selectedRun, 'run-2');
});

test('web: the address the page wrote itself, an unknown one, a document and a room invite change nothing', () => {
  const p = page('bot', { sub: 'qa-echo' });
  for (const hash of ['#bot/qa-echo', '#unknown', '', '#doc/abc', '#rooms/join=tok123']) p.navigate(hash);
  assert.deepEqual(p.opened, []);
  assert.equal(p.state.view, 'bot');
  assert.equal(p.state.chatId, 'chat-1');
  assert.equal(p.state.selectedRun, 'run-1');
});

test('web: before the first view is drawn, only #setup opens from the address', () => {
  const p = page('chief', { routed: false });
  for (const hash of ['#chief/chat-2', '#runs/run-2', '#bot/bot-2', '#group/group-2', '#settings']) p.navigate(hash);
  assert.deepEqual(p.opened, []);
  assert.equal(p.state.chatId, 'chat-1');
  assert.equal(p.state.selectedRun, 'run-1');
});

test('web: boot reads the address with the same route as the listener', () => {
  const p = page();
  assert.deepEqual({ ...p.ctx.readRoute('#botsettings/b/skill/x%2Fy') }, { view: 'botsettings', sub: 'b', skill: 'x/y', known: true });
  assert.deepEqual({ ...p.ctx.readRoute('#runs/r1') }, { view: 'runs', sub: 'r1', skill: undefined, known: true });
  assert.equal(p.ctx.readRoute('#nope').known, false);
  assert.equal(p.ctx.readRoute('#chiefsettings').known, true, 'the panels are known views');
});
