// A login request, a card payment and a locked Bitwarden open in their card in the chat, not as a dialog over the
// page (#1185): where their cards stand, that Needs you's rows and the banner take the owner there, that the forms
// open inside the card (openInline) and are not drawn away while they are filled in, and that nothing pops up by
// itself over a page that shows no such card. The page's own code, cut out of public/app.js and run on stand-ins.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { page, plain, CODER, MAIL } = require('./need-cards');
const { cut, element } = require('./web-page');

const LOGIN = { id: 'r1', kind: 'login', site: 'app.example.org', name: 'app.example.org', username: '', from: 'bot', botId: 'coder', bot: CODER, existing: [] };
const PAY = { id: 'r2', kind: 'card', site: 'shop.example.com', amount: '12 EUR', from: 'bot', botId: 'mail', bot: MAIL, card: { name: 'Visa' } };
const IN_GROUP = { ...LOGIN, id: 'r3', groupId: 'g1', groupName: 'Writers' };

const withRequests = (requests, state = {}) => {
  const p = page({ state: { bots: [CODER, MAIL], groups: [{ id: 'g1', name: 'Writers' }], ...state } });
  p.ctx.loginReq.pending = requests;
  return p;
};

test('web: a login and a payment stand in the asking bot\'s chat, one asked in a group in that group\'s', () => {
  const p = withRequests([LOGIN, PAY, IN_GROUP]);
  const keys = (scope) => plain(p.chatNeeds(scope).map((x) => x.key));
  assert.deepEqual(keys('coder'), ['req:r1']);
  assert.deepEqual(keys('mail'), ['req:r2']);
  assert.deepEqual(keys('group:g1'), ['req:r3']);
  assert.deepEqual(keys('chief'), []);
});

test('web: a locked Bitwarden stands in the chat of the bot that waits for it, and in no chat when none does', () => {
  const wanted = withRequests([], { bw: { configured: true, unlocked: false, wantedBy: { id: 'coder', name: 'Coder', color: '#7f77dd' } } });
  assert.deepEqual(plain(wanted.chatNeeds('coder').map((x) => x.key)), ['bitwarden']);
  assert.deepEqual(plain(wanted.chatNeeds('mail')), []);
  assert.deepEqual(plain(wanted.chatNeeds('chief')), []);
  const nobody = withRequests([], { bw: { configured: true, unlocked: false, wantedBy: null } });
  for (const scope of ['coder', 'mail', 'chief']) assert.deepEqual(plain(nobody.chatNeeds(scope)), [], scope);
});

test('web: Needs you\'s row of a login, a payment or a locked Bitwarden opens its chat, and its form there', () => {
  for (const [requests, state, key, to] of [
    [[LOGIN], {}, 'req:r1', ['bot', 'coder']],
    [[PAY], {}, 'req:r2', ['bot', 'mail']],
    [[IN_GROUP], {}, 'req:r3', ['group', 'g1']],
    [[], { bw: { configured: true, unlocked: false, wantedBy: { id: 'coder', name: 'Coder' } } }, 'bitwarden', ['bot', 'coder']],
  ]) {
    const p = withRequests(requests, state);
    p.openNeedInChat(p.item(key));
    assert.deepEqual(plain(p.went), [to], key);
  }
});

test('web: a locked Bitwarden that no bot waits for still opens its dialog', () => {
  const p = withRequests([], { bw: { configured: true, unlocked: false, wantedBy: null } });
  p.openNeedInChat(p.item('bitwarden'));
  assert.deepEqual(plain(p.went), [['need', 'bitwarden']]);
});

test('web: the card a chat scrolls to opens its form in itself, once', () => {
  const app = cut('function toSeenNeed(thread) {', '// card: the card it was opened from');
  assert.match(app, /const form = formNeed === card\.dataset\.need && needsItems\(\)\.find\(\(x\) => x\.key === formNeed\);\n {2}formNeed = null;\n {2}if \(form\) openNeed\(form, card\);/);
  const open = cut('function openNeed(x, card = null) {', '// Decided cards stay');
  assert.match(open, /if \(x\.kind === 'bitwarden'\) return bwUi\.unlocking \? null : openUnlock\('', card\);/);
  assert.match(open, /if \(x\.kind === 'login' \|\| x\.kind === 'pay'\) return openLoginRequest\(x\.r, card\);/);
  assert.match(cut('function wireNeedCards(root, items) {', '// ---------- approvals in the chat ----------'), /if \(op\) op\.onclick = \(\) => openNeed\(x, el\);/, 'Review and Add it open the form in their own card');
});

test('web: the banner\'s Review of one thing opens it where it stands', () => {
  assert.match(cut('function showNeeds() {', 'function openNeed(x, card = null) {'), /const review = \(\) => \(items\.length === 1 \? openNeedInChat\(items\[0\]\) : setView\('needs'\)\);/);
});

test('web: a card with its form open is not drawn again until the form closes, in a chat and on Needs you', () => {
  const ctx = vm.createContext({ $: (sel, root) => root.querySelector(sel) });
  vm.runInContext(`${cut('const filling = ', '// The buttons on need cards')}\nthis.filling = filling;`, ctx);
  const items = [{ key: 'req:r1' }];
  const box = (panel) => element({ '.need-inline': panel });
  assert.equal(ctx.filling(box(null), items), false, 'no form open');
  assert.equal(ctx.filling(box({ open: true, dataset: { need: 'req:r1' } }), items), true, 'its form is being filled in');
  assert.equal(ctx.filling(box({ open: true, dataset: { need: 'req:gone' } }), items), false, 'answered elsewhere: the cards follow');
  assert.equal(ctx.filling(box({ open: false, dataset: { need: 'req:r1' } }), items), false, 'closed');
  assert.match(cut('function updateChatNeeds(thread, scope) {', '// "Always approve" a script job'), /if \(filling\(box, items\)\) return;/);
  assert.match(cut('function renderNeeds() {', '// A form open in a card'), /if \(root\.dataset\.sig === sig \|\| filling\(root, open\)\) return;/);
});

test('web: the form opens inside its card, as a dialog would, and goes when it closes', () => {
  const made = [];
  const host = element({}, { classes: [], dataset: { need: 'req:r1' } });
  const appended = [];
  host.append = (x) => appended.push(x);
  const ctx = vm.createContext({
    $: (sel, root) => (sel === '.need-inline' ? appended.find((x) => !x.removed) || null : root.querySelector(sel)),
    $$: () => [],
    Event: class { constructor(type) { this.type = type; } },
    document: { createElement: () => { const p = element(); p.dispatchEvent = (e) => (p.listeners[e.type] || []).forEach((fn) => fn(e)); made.push(p); return p; } },
  });
  vm.runInContext(`${cut('function openInline(host, html) {', '// The question before a bot gets the permission mode')}\nthis.openInline = openInline;`, ctx);
  const p = ctx.openInline(host, '<form id="login-request"></form>');
  assert.equal(p.className, 'need-inline');
  assert.equal(p.dataset.need, 'req:r1', 'which card it is in, for the redraw');
  assert.equal(p.innerHTML, '<form id="login-request"></form>');
  assert.ok(p.open && appended.includes(p));
  assert.ok(host.classList.contains('inline-open') && host.classList.contains('open'), 'the card opens whole and its own buttons step aside');
  let closed = 0;
  p.addEventListener('close', () => closed++);
  p.close();
  p.close();
  assert.equal(closed, 1, 'its "close" event fires once, as a dialog\'s does');
  assert.ok(p.removed && !p.open && !host.classList.contains('inline-open'));
});

test('web: the login, payment and unlock forms open in a card when given one, else as a dialog', () => {
  for (const [from, to] of [
    ['function openLoginRequest(r, host = null) {', 'async function saveLoginInBackground'],
    ['function openCardApproval(r, host = null) {', 'function openItemBots'],
    ["function openUnlock(reason = '', host = null) {", '// Unlocking takes a few seconds'],
  ]) assert.match(cut(from, to), /const m = \(host \? \(html\) => openInline\(host, html\) : openModal\)\(`/, from);
  assert.match(cut('function openLoginRequest(r, host = null) {', 'async function saveLoginInBackground'), /if \(r\.kind === 'card'\) return openCardApproval\(r, host\);/);
});

test('web: a new login request opens by itself only in its card in the chat on screen, never as a dialog', () => {
  const poll = cut('async function pollLoginRequests() {', '// A list of other logins longer than this');
  assert.match(poll, /const next = loginReq\.pending\.find\(\(r\) => !loginReq\.snoozed\.has\(r\.id\) && shownCardOf\(r\)\);/);
  assert.match(poll, /if \(next && !loginReq\.shown && !\$\('#modal'\)\.open\) openLoginRequest\(next, shownCardOf\(next\)\);/);
  assert.doesNotMatch(poll, /openLoginRequest\(next\)/, 'no dialog over a page without its card');
  assert.match(poll, /if \(gone\) \$\$\(`\.need-inline\[data-request="\$\{CSS\.escape\(loginReq\.shown\)\}"\]`\)\.forEach\(\(p\) => p\.close\(\)\);/, 'answered elsewhere: its form in a card closes too');
  assert.match(poll, /const shownCardOf = \(r\) => \$\$\(`\.chat-needs \.need-card\[data-need="\$\{CSS\.escape\(`req:\$\{r\.id\}`\)\}"\]`\)\.find\(\(el\) => el\.offsetParent\) \|\| null;/);
  const bw = cut('async function pollBitwarden() {', 'function showBitwardenBanner()');
  assert.match(bw, /if \(card && !bwUi\.snoozed\.has\(s\.wantedBy\.id\)\) \{ bwUi\.snoozed\.add\(s\.wantedBy\.id\); openUnlock\(tr\('\{name\} needs a saved login\.', \{ name: s\.wantedBy\.name \}\), card\); \}\n {4}return;/, 'a bot that waits for Bitwarden: in its card, no dialog');
});
