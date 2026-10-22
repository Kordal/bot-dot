// The keypad's rules (public/keypad.js, #495): the pages, built from the list's own order, and what a key press
// does. Pure functions, run in node as the page loads them.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const Keypad = require('../public/keypad.js');

const bot = (name, more = {}) => ({ id: name.toLowerCase(), name, group: '', pinned: 0, order: 0, ...more });
const grp = (name, more = {}) => ({ id: `g-${name.toLowerCase()}`, name, members: ['a', 'b'], category: '', pinned: 0, order: 0, ...more });
// Each page as "name: key, key" (a group's key with a # before it).
const shape = (pages) => pages.map((p) => `${p.kind}:${p.name}: ${p.keys.map((k) => (k.members ? `#${k.name}` : k.name)).join(', ')}`);

// ---------- pages ----------

test('pages: with no categories every bot and group is on one page, Other', () => {
  assert.deepEqual(shape(Keypad.pages([bot('Writer'), bot('Coder')], [grp('Dev')])), ['other:Other: Coder, Writer, #Dev']);
});

test('pages: the pinned bots and groups are the first page, in the one order of `pinned` (#276)', () => {
  const pages = Keypad.pages(
    [bot('Coder', { group: 'Work' }), bot('Lights', { pinned: 3, group: 'Home' }), bot('News', { pinned: 1 })],
    [grp('Dev', { pinned: 4 }), grp('Evening', { pinned: 2, category: 'Home' }), grp('Ops', { category: 'Work' })],
  );
  assert.deepEqual(shape(pages), ['pinned:Pinned: News, #Evening, Lights, #Dev', 'category:Work: Coder, #Ops']);
  // A bot and a group on the same place (kept from before one order): the bot first, as the page stood then.
  assert.deepEqual(shape(Keypad.pages([bot('News', { pinned: 1 })], [grp('Dev', { pinned: 1 })])), ['pinned:Pinned: News, #Dev']);
});

test('pages: categories A to Z, whatever their case, and Other last', () => {
  const pages = Keypad.pages(
    [bot('A', { group: 'work' }), bot('B'), bot('C', { group: 'Home' }), bot('D', { group: 'money' })],
    [grp('Lab', { category: 'Lab' })],
  );
  assert.deepEqual(shape(pages), ['category:Home: C', 'category:Lab: #Lab', 'category:money: D', 'category:work: A', 'other:Other: B']);
});

test('pages: keys in the order of `order`, and A to Z where `order` is 0; groups after the bots of their category', () => {
  const pages = Keypad.pages(
    [bot('Zed', { group: 'Home', order: 1 }), bot('beta', { group: 'Home' }), bot('Alpha', { group: 'Home' }), bot('Yak', { group: 'Home', order: 2 })],
    [grp('Two', { category: 'Home', order: 2 }), grp('One', { category: 'Home', order: 1 }), grp('Free', { category: 'Home' })],
  );
  assert.deepEqual(shape(pages), ['category:Home: Zed, Yak, Alpha, beta, #One, #Two, #Free']);
});

test('pages: an empty page is left out: no pinned page without pins, no Other without loose bots', () => {
  assert.deepEqual(shape(Keypad.pages([bot('A', { group: 'Home' })], [])), ['category:Home: A']);
  assert.deepEqual(Keypad.pages([], []), []);
  // A category whose only bot is pinned has no page of its own.
  assert.deepEqual(shape(Keypad.pages([bot('A', { group: 'Home', pinned: 1 }), bot('B', { group: 'Work' })], [])), ['pinned:Pinned: A', 'category:Work: B']);
});

test('pages: a page holds every key of its category, more than nine too', () => {
  const many = Array.from({ length: 12 }, (_, i) => bot(`Bot ${String(i + 1).padStart(2, '0')}`, { group: 'Home' }));
  const [home] = Keypad.pages(many, []);
  assert.equal(home.keys.length, 12);
  assert.equal(home.keys[11].name, 'Bot 12');
});

test('pages: the list and the keypad share one order: byPlace and categoryNames are the list\'s', () => {
  assert.equal(typeof Keypad.byPlace, 'function');
  const sorted = [bot('b'), bot('A', { order: 2 }), bot('c', { order: 1 })].sort(Keypad.byPlace).map((b) => b.name);
  assert.deepEqual(sorted, ['c', 'A', 'b']);
  assert.deepEqual(Keypad.categoryNames([bot('x', { group: 'work' }), bot('y', { group: 'Home' }), bot('z')], [grp('g', { category: 'Lab' })]), ['Home', 'Lab', 'work']);
});

// ---------- keys ----------

// A press: the key, its modifiers, and whether a text field has focus. The keypad: how many keys it shows, on every
// page together (#508).
const press = (key, more = {}, at = { keys: 4 }) => Keypad.press({ key, ctrl: false, alt: false, meta: false, shift: false, inField: false, ...more }, at);

test('keys: 1 to 9 open the n-th key of the keypad, counted across its pages', () => {
  assert.deepEqual(press('1'), { action: 'open', key: 0 });
  assert.deepEqual(press('4'), { action: 'open', key: 3 });
  assert.deepEqual(press('9', {}, { keys: 12 }), { action: 'open', key: 8 }, 'twelve keys: 9 is the ninth');
});

test('keys: a digit past the keys, 0, or a digit with Ctrl, Alt or Meta does nothing', () => {
  assert.equal(press('5'), null);
  assert.equal(press('0'), null);
  assert.equal(press('1', {}, { keys: 0 }), null, 'no key');
  for (const mod of ['ctrl', 'alt', 'meta']) assert.equal(press('2', { [mod]: true }), null, mod);
});

test('keys: while a text field has focus a digit stays in the field', () => {
  for (const key of ['1', '2', '3', '9']) assert.equal(press(key, { inField: true }), null, key);
});

test('keys: Tab is the browser\'s: every page is shown, so there is none to move to (#508)', () => {
  assert.equal(press('Tab'), null);
  assert.equal(press('Tab', { shift: true }), null);
});

test('keys: Esc opens the Chief, a text field focused or not', () => {
  assert.deepEqual(press('Escape'), { action: 'chief' });
  assert.deepEqual(press('Escape', { inField: true }), { action: 'chief' });
});

test('keys: Ctrl+K goes to search, a text field focused or not; K alone is a letter', () => {
  assert.deepEqual(press('k', { ctrl: true }), { action: 'search' });
  assert.deepEqual(press('K', { ctrl: true, inField: true }), { action: 'search' });
  assert.equal(press('k'), null);
  assert.equal(press('k', { ctrl: true, alt: true }), null);
  assert.equal(press('a'), null);
  assert.equal(press('Enter'), null);
});

// ---------- moves (#499) ----------

// A keypad of three pages: Pinned (News, Lights, #Evening), Home (Garden, Mail, Cook, #Kitchen, #Porch), Other (Notes).
const MOVE_BOTS = [
  bot('News', { pinned: 1, group: 'Work' }), bot('Lights', { pinned: 2 }),
  bot('Garden', { group: 'Home', order: 1 }), bot('Mail', { group: 'Home', order: 2 }), bot('Cook', { group: 'Home', order: 3 }),
  bot('Notes'),
];
const MOVE_GROUPS = [grp('Evening', { pinned: 3 }), grp('Kitchen', { category: 'Home', order: 1 }), grp('Porch', { category: 'Home', order: 2 })];
const movePages = () => Keypad.pages(MOVE_BOTS, MOVE_GROUPS);
// Drag the key called `name` and drop it on page `to`: on its key at `at`, or on its heading (no `at`).
const move = (name, to, at) => { const pages = movePages(); return Keypad.move(pages, pages.flatMap((p) => p.keys).find((k) => k.name === name), to, at); };

test('moves: the pages the moves below start from', () => {
  assert.deepEqual(shape(movePages()), ['pinned:Pinned: News, Lights, #Evening', 'category:Home: Garden, Mail, Cook, #Kitchen, #Porch', 'other:Other: Notes']);
});

test('moves: a key dropped on another key of its page takes that key\'s place, counted among its own kind', () => {
  assert.deepEqual(move('Cook', 1, 0), { group: 'Home', order: 1 }, 'onto the first: first');
  assert.deepEqual(move('Garden', 1, 2), { group: 'Home', order: 3 }, 'onto the third: third, the others move up');
  assert.deepEqual(move('Garden', 1, 1), { group: 'Home', order: 2 });
  assert.deepEqual(move('Porch', 1, 3), { group: 'Home', order: 1 }, 'a group onto the first group: the first group');
  assert.deepEqual(move('Lights', 0, 0), { pinned: 1 }, 'among the pinned ones: its pin');
  assert.deepEqual(move('News', 0, 1), { pinned: 2 });
});

test('moves: bots stay before groups: a bot dropped on a group is the last bot, a group on a bot the first group', () => {
  assert.deepEqual(move('Garden', 1, 4), { group: 'Home', order: 3 });
  assert.deepEqual(move('Porch', 1, 0), { group: 'Home', order: 1 });
});

test('moves: dropped where it is, or on its own page\'s heading when it is last there already, a key does not move', () => {
  assert.equal(move('Mail', 1, 1), null);
  assert.equal(move('Kitchen', 1, 3), null);
  assert.equal(move('Lights', 0, 1), null);
  assert.equal(move('Cook', 1), null, 'the last bot of its page');
  assert.equal(move('Evening', 0), null);
});

test('moves: on the Pinned heading a key is pinned last; on a category\'s it goes last there; on Other\'s it leaves its category', () => {
  assert.deepEqual(move('Mail', 0), { pinned: 4 });
  assert.deepEqual(move('Kitchen', 0), { pinned: 4 }, 'a group: last of everything pinned');
  assert.deepEqual(move('Notes', 1), { group: 'Home', order: 4 });
  assert.deepEqual(move('Evening', 1), { group: 'Home', order: 3 }, 'a pinned group to a category: last among its groups');
  assert.deepEqual(move('Lights', 2), { group: '', order: 2 }, 'a pinned bot onto Other');
  assert.deepEqual(move('Cook', 2), { group: '', order: 2 });
});

test('moves: on its own page\'s heading a key goes last there (#508)', () => {
  assert.deepEqual(move('Mail', 1), { group: 'Home', order: 3 });
  assert.deepEqual(move('Kitchen', 1), { group: 'Home', order: 2 });
  assert.deepEqual(move('News', 0), { pinned: 3 });
});

test('moves: on Pinned bots and groups share one order: a group goes before a bot, a bot after a group (#276)', () => {
  assert.deepEqual(move('Evening', 0, 0), { pinned: 1 }, 'a group onto the first bot: first');
  assert.deepEqual(move('Evening', 0, 1), { pinned: 2 }, 'a group between two bots');
  assert.deepEqual(move('News', 0, 2), { pinned: 3 }, 'a bot onto the group after it: below the group');
  assert.deepEqual(move('Lights', 0, 2), { pinned: 3 }, 'the last bot onto the group after it');
  assert.deepEqual(move('Kitchen', 0, 1), { pinned: 2 }, 'a group from a category, between two pinned bots');
  assert.deepEqual(move('Kitchen', 0, 0), { pinned: 1 }, 'onto the first key, as onto the Chief: pinned first');
  assert.deepEqual(move('Mail', 0, 2), { pinned: 3 }, 'a bot from a category, onto a pinned group: before it');
  // The issue's two moves, each from what the one before left.
  const team = (name, pinned) => grp(name, { pinned });
  let pages = Keypad.pages([bot('Builder', { pinned: 1 }), bot('Quoter', { pinned: 2 })], [team('Builder Team', 3), team('Quoter Team', 4)]);
  const key = (name) => pages[0].keys.find((k) => k.name === name);
  assert.deepEqual(Keypad.move(pages, key('Builder Team'), 0, 0), { pinned: 1 });
  pages = Keypad.pages([bot('Builder', { pinned: 2 }), bot('Quoter', { pinned: 3 })], [team('Builder Team', 1), team('Quoter Team', 4)]);
  assert.deepEqual(shape(pages), ['pinned:Pinned: #Builder Team, Builder, Quoter, #Quoter Team']);
  assert.deepEqual(Keypad.move(pages, key('Quoter Team'), 0, 1), { pinned: 2 });
  assert.equal(Keypad.move(pages, key('Builder'), 0, 1), null, 'onto its own key');
});

test('moves: a key dropped on a key of another page takes that key\'s place there', () => {
  assert.deepEqual(move('Notes', 1, 1), { group: 'Home', order: 2 });
  assert.deepEqual(move('Mail', 0, 0), { pinned: 1 });
});

test('moves: a key that is on no page, or a page that is not there, moves nothing', () => {
  const pages = movePages();
  assert.equal(Keypad.move(pages, bot('Ghost', { group: 'Home' }), 1), null);
  assert.equal(Keypad.move(pages, pages[1].keys[0], 7), null);
});
