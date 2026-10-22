// The cards that wait for the owner, as the web page draws and answers them (OK-004): the page's own code for
// them, cut out of public/app.js and run against stand-ins (test/web-page.js), with the asks, the jobs and the
// tiles a botdot server sends. Used by the tests of who carries on, the Chief's bot change, a connected-app
// action and the feed's list of what waits.
const vm = require('vm');
const { read, cut, esc, element, whileBusy } = require('./web-page');

const CHIEF_COLOR = '#d85a30';
const plain = (x) => JSON.parse(JSON.stringify(x)); // out of the page's realm, for deepEqual

// The page's code for the cards, in the order it needs itself.
const CODE = [
  cut('function shortTime(iso) {', '// When a message in a chat was sent'),
  cut('function msgTime(iso) {', 'const plain = '),
  cut('const plain = (t) =>', '// ---------- contacts (sidebar) ----------'),
  cut('const AI_WHEN_TEXT = {', 'const BY_WHO'),
  cut('// A change that waits beside an approved job or tile', 'function showJobApprovals()'),
  cut('const tileScripts = ', '// A group has no bot of its own'),
  cut('function needsItems() {', '// The banner:'),
  cut('const needsDone = new Map();', '// The buttons on need cards'),
  cut('const chatDecided = new Map();', '// "Always approve" a script job'),
  cut('async function decide(x, yes', 'async function refreshNeeds() {'),
  'this.page = { batched, decideBatch, needsItems, needCardHTML, renderNeeds, leaveNeeds, stayOnNeeds, chatNeeds, updateChatNeeds, decide, thenLine, partsHTML, heldLine, msgTime, needsDone, needsOpen, chatDecided, answeredAway, drawChatCards, toHeldCard, jobCard, tileCard, approveAll, asksBeforeNo, answeredWord, changeOf, jobWaits, touchesScript };',
].join('\n');

// The page with what the server sent. state: asks, bots (with their jobs), dash, approvals.
// answer(url, body): what the server answers a yes or a no with; an Error is a request that failed.
// screen: the page's elements the code finds by their selector ('#view-bot', '#bot-thread', '#chat-thread').
function page({ state = {}, answer = () => ({ ok: true }), screen = {} } = {}) {
  const calls = [], toasts = [], onScreen = [], timers = [], went = [];
  let refreshed = 0;
  const st = { bw: null, asks: [], memPending: [], dash: null, chats: [], bots: [], approvals: null, view: 'chief', ...state };
  const needsPage = element();
  const ctx = vm.createContext({
    esc, state: st, loginReq: { pending: [] }, CHIEF_COLOR, CHIEF_BOT: { id: 'chief', name: 'Chief of Staff', color: CHIEF_COLOR }, BACK_BTN: '',
    botById: (id) => st.bots.find((b) => b.id === id), colorOf: (b) => b?.color || '#888780',
    botLabel: (b) => (b ? `<svg class="fig fig-small"></svg>${esc(b.name)}` : ''),
    CSS: { escape: (s) => s }, PLAN_APPROVAL: '', loadDash() {}, wireNeedCards() {}, wireBatchCards() {},
    api: async (url, opts) => { calls.push([url, opts.method, opts.body]); const a = answer(url, opts.body); if (a instanceof Error) throw a; return a; },
    toast: (text, bad) => toasts.push([text, !!bad]), whileBusy,
    refreshNeeds: () => { refreshed++; },
    // The moment's wait before Needs you leaves after its last card (needs-return.js): kept, run by the test.
    setTimeout: (fn, ms) => { timers.push({ fn, ms, on: true }); return timers.length; }, clearTimeout: (n) => { if (timers[n - 1]) timers[n - 1].on = false; },
    showList: () => went.push(['list']), setView: (v, id) => went.push([v, id]), openChiefChat: (id) => went.push(['chief', id]),
    document: { createElement: () => element() },
    $: (sel, root) => (root ? root.querySelector(sel) : sel === '#view-needs' ? needsPage : screen[sel] || null),
    $$: (sel) => onScreen.filter((c) => sel === `.need-card[data-need="${c.key}"]`),
  });
  vm.runInContext(read('tool-card.js'), ctx);
  vm.runInContext(read('needs-return.js'), ctx);
  vm.runInContext(CODE, ctx);
  const p = ctx.page;
  // The item of one thing that waits, as the page's own needsItems makes it.
  const item = (key) => { const x = p.needsItems().find((i) => i.key === key); if (!x) throw new Error(`nothing waits as ${key}`); return x; };
  // A card of `key` that is on screen: on the Needs you page (scope null), or in the box of cards of a chat.
  const show = (key, scope = null, title = 'A title') => {
    const actions = { innerHTML: '<button data-need-no>Decline</button><button data-need-yes>Allow</button>' };
    const then = element(); // the line that says who carries on, when the card has one
    const card = element({ '.need-actions': actions, '.need-title': { textContent: title }, '.need-then': then }, { key, actions, then, outerHTML: `<card ${key}>`, closest: (sel) => (sel === '.chat-needs' && scope ? { dataset: { scope } } : null) });
    onScreen.push(card);
    return card;
  };
  // A chat's thread with its box of cards, for updateChatNeeds. chatId: the Chief chat whose messages it shows.
  const thread = (chatId = null) => {
    const box = element();
    const t = element({ '.chat-needs': box }, { lastElementChild: box, append() {}, scrollHeight: 0, scrollTop: 0, clientHeight: 0 });
    if (chatId) t.dataset.chat = chatId;
    return { box, thread: t };
  };
  return { ...p, ToolCard: ctx.ToolCard, state: st, item, show, thread, needsPage, calls, toasts, timers, went, refreshed: () => refreshed };
}

// What a card holds, in the order it is drawn: its classes, the head, the title, the lines under it, the blocks, the buttons.
const titleOf = (html) => html.match(/<div class="need-title">([\s\S]*?)<\/div>/)?.[1];
const metaOf = (html) => html.match(/<div class="need-meta">([\s\S]*?)<\/div>/)?.[1] ?? null;
const thenOf = (html) => html.match(/<div class="need-meta need-then">([\s\S]*?)<\/div>/)?.[1] ?? null;
const buttonsOf = (html) => [...html.matchAll(/<button class="btn sm[^"]*" data-need-(?:no|yes|always)>(.*?)<\/button>/g)].map((m) => m[1]);
const rowsOf = (html) => [...html.matchAll(/<dt>(.*?)<\/dt><dd>([\s\S]*?)<\/dd>/g)].map((m) => [m[1], m[2]]);

// Bots, and asks as GET /api/asks hands them out.
const CODER = { id: 'coder', name: 'Coder', color: '#7f77dd' };
const MAIL = { id: 'mail', name: 'Mail Writer', color: '#9b59d0' };
const NEWS = { id: 'news', name: 'News Watcher', color: '#e0703a' };
// A permission a bot's run asked for, as a botdot server of Milestone 5 sends it: no `then`.
const PERMISSION = { id: 'p1', kind: 'permission', botId: 'coder', bot: CODER, permission: 'bash', what: { label: 'run commands', hint: 'run commands in its own workspace' }, reason: 'To read last night\'s backup log', text: 'Wants to run commands', at: '2026-10-05T09:00:00.000Z' };
const BAD = '<img src=x onerror="alert(1)">\'&</div><script>alert(2)</script>';

module.exports = { page, plain, titleOf, metaOf, thenOf, buttonsOf, rowsOf, CODER, MAIL, NEWS, PERMISSION, BAD };
