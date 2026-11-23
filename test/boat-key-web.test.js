// Settings → Computer on the web page (#1617, ADR 263): with Advanced on, the account's own boat.dev key is added,
// replaced or removed there (what boat.dev said of it, never the key), and while the account pays with it the owner
// chooses where its computer is and how big it is; a server that does not know it keeps the read-only row. A bot's
// machine of its own is a row of its settings, offered only while the account has its own key.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { read, esc } = require('./web-page');

const settings = read('settings.js');
const bots = read('bots.js');

function page(state) {
  const ctx = vm.createContext({ state, esc, tr: (s, v = {}) => String(s).replace(/\{(\w+)\}/g, (_, k) => v[k]), advanced: () => state.advanced !== false, CHEV: '' });
  const from = settings.indexOf('const ownKeyShown = ');
  const to = settings.indexOf('async function loadComputerCard');
  assert.ok(from > 0 && to > from);
  vm.runInContext(`${settings.slice(from, to)}; this.row = computerRowHTML; this.shown = ownKeyShown; this.KEY_STATE = KEY_STATE; this.sizeName = sizeName; this.PLACES = COMPUTER_PLACES;`, ctx);
  return ctx;
}

test('web: the Computer section is drawn with Advanced on and a server that knows the key; else the read-only row', () => {
  const on = { features: ['boat-own-key', 'boat-size'], advanced: true, status: { boat: true } };
  assert.match(page(on).row(), /<details class="bs-row bs-more" id="computer-card">/);
  assert.match(page({ ...on, advanced: false }).row(), /id="boat-size-card" hidden/, 'Advanced off: the row as before');
  assert.match(page({ ...on, features: ['boat-size'] }).row(), /id="boat-size-card" hidden/, 'an older server');
  assert.equal(page({ ...on, features: [], advanced: true }).row(), '', 'a server that knows neither');
  assert.equal(page({ ...on, status: { boat: false }, features: ['boat-size'] }).row(), '', 'no boat.dev here: no row');
});

test('web: what boat.dev said of the key is said in words, and a size shows its CPUs and memory, never a price', () => {
  const p = page({ features: ['boat-own-key'], advanced: true });
  assert.deepEqual(Object.keys(p.KEY_STATE), ['ok', 'refused', 'billing', 'unreachable']);
  assert.equal(p.KEY_STATE.refused, 'boat.dev refuses it');
  const name = p.sizeName({ id: 'large', cpus: 4, memoryGB: 8, price: 0.5, monthly: 20 });
  assert.equal(name, 'Large · 4 CPUs · 8 GB');
  assert.doesNotMatch(settings.split('\n').find((l) => l.startsWith('const sizeName')), /price|cost|€|usd/i, 'no price in the size line');
  assert.deepEqual(Object.keys(p.PLACES), ['linux', 'boat']);
});

test("web: the key is saved, removed and asked about with the server's routes, and never drawn back", () => {
  const card = settings.slice(settings.indexOf('async function loadComputerCard'), settings.indexOf('function askMovePlace'));
  assert.match(card, /api\('\/settings\/boat-key'\)/, 'its state is read');
  assert.match(card, /api\('\/settings\/boat-key', \{ method: 'PUT', body: \{ key: input\.value \} \}\)/);
  assert.match(card, /input\.value = ''/, 'the field is emptied once it is saved');
  assert.match(card, /type="password"/);
  assert.match(card, /autocomplete="off"/);
  assert.match(card, /\/settings\/boat-key\$\{how \? `\?machines=\$\{how\}` : ''\}`, \{ method: 'DELETE' \}/, 'removed with its machines deleted or kept');
  assert.match(card, /tr\('Delete its machines on boat\.dev'\), tr\('Keep them'\)/, 'asked which');
  assert.match(card, /key\.machines/, 'only when it made some');
  assert.doesNotMatch(card, /key\.key|value="\$\{[^}]*key/, 'no key in the page');
  // Where the computer is and its size: the owner's, only while the key is the account\'s own.
  assert.match(card, /where\?\.ownKey && where\.place === 'boat'/);
  assert.match(card, /api\('\/settings\/computer', \{ method: 'PUT', body: \{ place: to, moveFiles \} \}\)/);
  assert.match(card, /api\('\/settings\/boat-size', \{ method: 'PUT', body: \{ size: size\.value \} \}\)/);
  assert.match(card, /askMovePlace\(to\)/, 'its files: copy or start empty');
});

// ---- a bot's row ----
function botPage({ features = ['bot-own-machine'] } = {}) {
  const from = bots.indexOf('const botOwnMachineShown');
  const to = bots.indexOf("// Its copy's line under Computer");
  assert.ok(from > 0 && to > from);
  const ctx = vm.createContext({ state: { features }, tr: (t) => t, esc, CHEV: '' });
  vm.runInContext(`${bots.slice(from, to)}; this.shown = botOwnMachineShown; this.row = botOwnMachineRow;`, ctx);
  return ctx;
}
const bot = (extra = {}) => ({ id: 'a', computer: 'boat', boatOwnMachine: false, ...extra });

test("web: a bot's machine on the External Virtual PC is a row for a bot that works there, hidden until the account has its own key", () => {
  assert.equal(botPage().shown(bot()), true);
  assert.equal(botPage().shown(bot({ computer: 'linux' })), false, 'only the External Virtual PC');
  assert.equal(botPage({ features: [] }).shown(bot()), false, 'an older server');
  const html = botPage().row(bot());
  assert.match(html, /id="bs-own-machine" hidden/, 'drawn hidden: the page shows it once the server says the account has its own key');
  assert.match(html, /name="boatOwnMachine"/);
  assert.match(html, /<option value="shared" selected>Shared with the account's bots<\/option>/);
  assert.match(html, /<option value="own" >Its own machine<\/option>/);
  assert.match(botPage().row(bot({ boatOwnMachine: true })), /<option value="own" selected>Its own machine<\/option>/);
});

test('web: the page shows the row for an own key or a bot that has a machine of its own, and a switch asks about its files first', () => {
  assert.match(bots, /row\.hidden = !advanced\(\) \|\| !\(ownKey \|\| b\.boatOwnMachine === true\)/);
  assert.match(bots, /api\('\/settings\/computer'\)\.then\(\(r\) => show\(r\.ownKey === true\)/);
  assert.match(bots, /askMoveFiles\(to, OWN_MACHINE_COPY\)/);
  assert.match(bots, /boatOwnMachine: form\.boatOwnMachine\.value === 'own'/);
  assert.match(bots, /'boatOwnMachine' in changes\) && moveFiles/);
});
