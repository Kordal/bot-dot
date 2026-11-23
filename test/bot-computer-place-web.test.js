// A bot's place of its own on the web page (#1613, ADR 261): under Settings → Advanced a bot is put on this machine or
// the External Virtual PC, or follows the account; offered only where boat.dev has a key; asked about its files first.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { read } = require('./web-page');

const bots = read('bots.js');
// The row's own code, run with stand-ins for what the page gives it.
function page({ features = ['bot-computer-place'], boat = true, advanced = true } = {}) {
  const from = bots.indexOf('const PLACE_NAME');
  const to = bots.indexOf('// Its copy\'s line under Computer');
  assert.ok(from > 0 && to > from);
  const ctx = vm.createContext({
    state: { features, status: { boat } }, tr: (t) => t, esc: (t) => String(t), CHEV: '', advanced: () => advanced,
  });
  vm.runInContext(`${bots.slice(from, to)}; this.shown = botPlaceShown; this.row = botPlaceRow;`, ctx);
  return ctx;
}
const bot = (extra = {}) => ({ id: 'a', computer: 'linux', computerPlace: '', ...extra });

test('web: the row is offered with a boat.dev key and not without one, nor to a server that does not know it', () => {
  assert.equal(page().shown(bot()), true);
  assert.equal(page({ boat: false }).shown(bot()), false, 'no boat.dev key');
  assert.equal(page({ features: [] }).shown(bot()), false, 'an older server');
  assert.equal(page({ boat: false }).shown(bot({ computer: 'boat', computerPlace: 'boat' })), true, 'already there: it can come back');
});

test('web: the row has the account, this machine and the External Virtual PC, and is hidden while Advanced is off', () => {
  const html = page().row(bot({ computerPlace: 'boat', computer: 'boat' }), true);
  assert.match(html, /name="computerPlace"/);
  assert.match(html, /<option value="" +>Account's choice<\/option>/);
  assert.match(html, /<option value="linux" +>This machine<\/option>/);
  assert.match(html, /<option value="boat" selected +>External Virtual PC<\/option>/);
  assert.doesNotMatch(html, /<label class="bs-row" id="bs-place" hidden>/, 'Advanced on');
  assert.match(page({ advanced: false }).row(bot(), true), /<label class="bs-row" id="bs-place" hidden>/, 'Advanced off: hidden, not dropped');
  assert.match(page({ boat: false }).row(bot(), true), /<option value="boat" +disabled>/, 'no key: not chosen');
});

test('web: a save sends the place of its own, with its files when asked, and the move is asked first', () => {
  assert.match(bots, /\.\.\.\(form\.computerPlace \? \{ computerPlace: form\.computerPlace\.value \} : \{\}\)/);
  assert.match(bots, /const copy = \('computer' in changes \|\| 'computerPlace' in changes\) && moveFiles;/);
  assert.match(bots, /form\.computerPlace\.addEventListener\('change', async/);
  assert.match(bots, /askMoveFiles\(where\)/);
});
