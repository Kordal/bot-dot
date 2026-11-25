// The pencil on a board tile, on the web page (ADR 273, public/board-edit.js): a pencil on each tile that has a title,
// shown only when the server has `card-edit`; pressing it rings the tile and puts a chip naming it above the project
// chat's message box; sending carries the tile and clears both; taking the chip off sends a plain message. Android
// draws the same from the same feature (ui/CardEditUi.kt and the tiles of the board).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { read, esc, element, finders } = require('./web-page');

const ROOT = path.join(__dirname, '..');
const source = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// The page around it: a project with a card, the Dock open on the manager bot's chat, elements that hold what is set on them.
function page({ features = ['card-edit'], chat = 'open' } = {}) {
  const state = { features, view: 'bot', botId: 'pm', company: { id: 'p1', phase: 'running', chiefChat: 'cc', cards: [{ id: 'k7f2' }] } };
  const composer = element({ '.composer-box': element(), '.card-chip': null }, { text: element() });
  composer.inserted = [];
  composer.contains = (x) => composer.inserted.includes(x);
  composer.querySelector = (sel) => (sel === '.card-chip' ? composer.inserted[0] || null : sel === '.composer-box' ? { before: (chip) => composer.inserted.unshift(chip) } : null);
  const chips = () => composer.inserted;
  const opened = [];
  const Dock = { defaultChat: () => ({ kind: 'bot', id: 'pm' }), docked: () => chat === 'open', openDefault: async () => { opened.push('default'); } };
  const made = [];
  const document = { createElement: () => { const el = element({ button: element() }, { setAttribute(k, v) { this[k] = v; }, after() {}, append() {}, remove() { composer.inserted = composer.inserted.filter((x) => x !== this); } }); el.dataset = {}; made.push(el); return el; } };
  const tiles = (root) => root;
  const ctx = vm.createContext({
    state, Dock, document, esc, tr: (t, v) => String(t).replace(/\{(\w+)\}/g, (m, k) => v?.[k] ?? m), CSS: { escape: (x) => x },
    Company: { onBoard: (c, k) => ['work', 'replies'].includes(k) },
    window: {}, requestAnimationFrame: (f) => f(), queueMicrotask,
    $: (sel, root) => (sel === '#chat-row .view:not(.hidden) form.composer' ? composer : root.querySelector(sel)),
    $$: (sel, root) => (sel === '.card-chip' ? chips() : root?.querySelectorAll?.(sel) || []),
  });
  vm.runInContext(read('board-edit.js'), ctx);
  return { ctx, state, composer, chips, opened, made, BoardEdit: ctx.window.BoardEdit, document };
}

test('the chip names the tile, a message about it carries the tile and its project, and sending clears it', async () => {
  const p = page();
  assert.equal(p.BoardEdit.cardFor('bot', 'pm'), null, 'no chip, a plain message');
  // The pencil's own press, as board-edit.js wires it to a tile: the tile of the board named by its head.
  const tile = element({ h2: element({}, { textContent: ' Latest replies ' }) }, { append() {} });
  tile.dataset = { cfOv: 'replies' };
  const root = element({ '[data-cf-ov="work"], [data-cf-ov="blockers"], [data-cf-ov="replies"]': tile });
  p.BoardEdit.apply(root, p.state.company);
  const pencil = p.made.find((el) => el.className.includes('be-pencil'));
  assert.ok(pencil, 'a pencil on the tile');
  assert.match(pencil['aria-label'], /^Edit Latest replies$/);
  assert.match(pencil.className, /be-abs/);
  await pencil.onclick({ stopPropagation() {} });
  assert.deepEqual(p.opened, ['default'], "the project's own chat opened");
  assert.equal(p.chips().length, 1, 'one chip above the message box');
  assert.match(p.chips()[0].innerHTML, /Latest replies/);
  assert.deepEqual({ ...p.BoardEdit.cardFor('bot', 'pm') }, { card: 'replies', project: 'p1', label: 'Latest replies' });
  assert.equal(p.BoardEdit.cardFor('bot', 'someone-else'), null, 'only the project manager\'s chat carries it');
  assert.equal(p.BoardEdit.cardFor('chief', 'cc'), null, 'and not the Chief chat while the manager is a bot');
  p.BoardEdit.sent({ card: 'replies', project: 'p1' });
  assert.equal(p.chips().length, 0, 'sent: the chip is gone');
  assert.equal(p.BoardEdit.cardFor('bot', 'pm'), null);
});

test('taking the chip off sends a plain message, and a tile that left the board takes the chip with it', async () => {
  const p = page();
  const tile = element({ h2: element({}, { textContent: 'Current work' }) }, { append() {} });
  tile.dataset = { cfOv: 'work' };
  const root = element({ '[data-cf-ov="work"], [data-cf-ov="blockers"], [data-cf-ov="replies"]': tile });
  p.BoardEdit.apply(root, p.state.company);
  await p.made.find((el) => el.className.includes('be-pencil')).onclick({ stopPropagation() {} });
  assert.equal(p.BoardEdit.cardFor('bot', 'pm').card, 'work');
  p.BoardEdit.clear();
  assert.equal(p.BoardEdit.cardFor('bot', 'pm'), null);
  // Pointing at Blockers (not on this board's pieces) is no tile: the board drawn again without it clears the chip.
  await p.made.find((el) => el.className.includes('be-pencil')).onclick({ stopPropagation() {} });
  p.state.company = { ...p.state.company, phase: 'running' };
  const gone = { ...p.state.company };
  p.BoardEdit.apply(element(), { ...gone, id: 'p1' });
  assert.equal(p.BoardEdit.cardFor('bot', 'pm')?.card, 'work', 'still on the board: kept');
  p.ctx.Company.onBoard = () => false;
  p.BoardEdit.apply(element(), gone);
  assert.equal(p.BoardEdit.cardFor('bot', 'pm'), null);
});

test('no pencil without the feature, and none while the project has no chat to open', () => {
  const tile = () => { const t = element({ h2: element({}, { textContent: 'Current work' }) }, { append() {} }); t.dataset = { cfOv: 'work' }; return t; };
  const rootOf = (t) => element({ '[data-cf-ov="work"], [data-cf-ov="blockers"], [data-cf-ov="replies"]': t });
  const off = page({ features: [] });
  off.BoardEdit.apply(rootOf(tile()), off.state.company);
  assert.equal(off.made.length, 0, 'an older server has no pencil');
  const none = page();
  none.ctx.Dock.defaultChat = () => null;
  none.BoardEdit.apply(rootOf(tile()), none.state.company);
  assert.equal(none.made.length, 0);
  const stopped = page();
  stopped.state.company.phase = 'setup';
  stopped.BoardEdit.apply(rootOf(tile()), stopped.state.company);
  assert.equal(stopped.made.length, 0, 'a project that is not running has no board to edit');
});

test("the tile's name above a message is drawn as text", () => {
  const { BoardEdit } = page();
  assert.equal(BoardEdit.aboutHTML(null), '');
  assert.equal(BoardEdit.aboutHTML({ id: 'replies' }), '');
  assert.equal(BoardEdit.aboutHTML({ id: 'card:k', label: '</span><b>x' }), '<span class="card-about">&lt;/span&gt;&lt;b&gt;x</span>');
});

test('the chats send the tile, keep it on the waiting and the sent bubble, and clear it when the message went', () => {
  const bot = source('public/bot-chat.js');
  assert.match(bot, /runBot\(bot\.id, text, files, key, replyingTo\.get\(bot\.id\)\?\.runId, null, window\.BoardEdit\?\.cardFor\('bot', bot\.id\)\)/);
  assert.match(bot, /\.\.\.\(card \? \{ card: card\.card, project: card\.project \} : \{\}\)/);
  assert.match(bot, /window\.BoardEdit\?\.sent\(card\)/);
  assert.match(bot, /window\.BoardEdit\?\.aboutHTML\(r\.card\)/);
  const chief = source('public/chief.js');
  assert.match(chief, /sendToChief\(text, attachments, key, window\.BoardEdit\?\.cardFor\('chief', state\.chatId\)\)/);
  assert.match(chief, /body: \{ text, attachments, key, \.\.\.\(card \? \{ card: card\.card, project: card\.project \} : \{\}\) \}/);
  assert.match(chief, /window\.BoardEdit\?\.aboutHTML\(m\.card\)/);
  const replies = source('public/replies.js');
  assert.match(replies, /aboutHTML\(sent\.card\)/);
  assert.match(replies, /aboutHTML\(q\.card\)/);
  assert.match(source('public/index.html'), /<script src="\/board-edit\.js"><\/script>/);
  assert.match(source('public/company-home.js'), /window\.BoardEdit\?\.apply\(root, c\)/);
});

test('the styles follow the mockup: a 28px round pencil in the faint colour, a ring of the muted colour, a chip on --fill', () => {
  const css = source('public/style.css');
  assert.match(css, /\.be-pencil \{[^}]*width: 28px; height: 28px;[^}]*border-radius: 50%;[^}]*color: var\(--faint\)/);
  assert.match(css, /\.be-pencil:hover[^{]*\{[^}]*background: var\(--fill\)/);
  assert.match(css, /\[data-be-ring\] \{ box-shadow: var\(--lift\), 0 0 0 1px var\(--muted\); \}/);
  assert.match(css, /\.card-chip \{[^}]*border-radius: var\(--r-8\); background: var\(--fill\); font-size: var\(--fs-12\)/);
});

test('the server announces it, and Android asks for it', () => {
  assert.match(source('server.js'), /'card-edit'\];/);
  assert.match(source('android/shared/src/commonMain/kotlin/dev/botdot/app/data/ManyProjects.kt'), /CARD_EDIT = "card-edit"/);
});
