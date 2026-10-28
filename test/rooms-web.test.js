// Shared rooms on the web page (#317, ADR 060; the front door's routes of #318): public/rooms.js loaded as the browser
// loads it, after the parts of the page it uses, and run against stand-ins for the front door. The Rooms place shown
// only while the session says rooms are on, the list with the invites, a room's messages labelled "name · account"
// with who mentioned whom, sending, the live events, the room's settings, and the Shared rooms row of a bot's settings.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('vm');
const { read, cut, esc, element, words } = require('./web-page');

const html = read('index.html');
const src = read('rooms.js');
const bots = read('bots.js');
const settings = read('settings.js');
const plain = (x) => JSON.parse(JSON.stringify(x));

const SCOUT = { account: 'ann', id: 'scout', name: 'Scout', color: '#1d9e75' };
const CODER = { account: 'me', id: 'coder', name: 'Coder', color: '#378add' };
const ROOM = { id: 'a'.repeat(32), name: 'Trip', created: '2026-10-22T10:00:00Z', by: 'me', members: [{ account: 'me' }, { account: 'ann' }], bots: [SCOUT, CODER], invites: [{ account: 'bob', by: 'me', at: '2026-10-22T10:01:00Z' }], last: null, working: [] };
const INVITE = { room: { id: 'b'.repeat(32), name: 'Books', by: 'ann' }, by: 'ann', at: '2026-10-22T11:00:00Z' };
const msg = (id, more = {}) => ({ id, at: `2026-10-22T12:0${id.length % 10}:00Z`, account: 'ann', bot: null, text: 'hi', mentions: [], kind: 'text', ...more });

// The page: its state, the helpers rooms.js draws with, and rooms.js. answer(path, opts) is the front door's reply,
// a status and a body; the requests it got are in said.calls.
function page({ answer = () => [200, { rooms: [ROOM], invites: [INVITE] }], myBots = [] } = {}) {
  const state = { view: 'chief', roomId: null, features: ['room-settings'], bots: plain(myBots) };
  const said = { calls: [], toasts: [], views: [], contacts: 0, modals: [], streams: [], confirms: [] };
  const els = { '#view-rooms': element({}, { querySelector: () => element() }), '#view-botsettings': element(), '#kp-rooms': element({}, { classes: ['hidden'] }), '#kp-phone-rooms': element({}, { classes: ['hidden'] }) };
  class EventSource {
    constructor(url) { this.url = url; this.on = {}; said.streams.push(this); }
    addEventListener(type, fn) { this.on[type] = fn; }
    close() { this.closed = true; }
    emit(type, data) { this.on[type]({ data: JSON.stringify(data) }); }
  }
  const store = {};
  const ctx = vm.createContext({
    state, esc, ...words, console, JSON, encodeURIComponent, EventSource,
    localStorage: { getItem: (k) => store[k] ?? null, setItem: (k, v) => { store[k] = v; } },
    document: { hidden: false }, getSelection: () => ({ isCollapsed: true }),
    fetch: async (url, opts = {}) => {
      said.calls.push([opts.method || 'GET', url, ...(opts.body ? [JSON.parse(opts.body)] : [])]);
      assert.equal(opts.headers['X-Bot-Dot'], '1');
      const a = await answer(url, opts);
      if (a instanceof Error) throw a;
      const [status, body] = a;
      return { ok: status >= 200 && status < 300, status, json: async () => body };
    },
    $: (sel, root) => (root ? root.querySelector(sel) : els[sel] || null), $$: () => [],
    toast: (t, bad) => said.toasts.push([t, !!bad]), setView: (v, sub) => said.views.push([v, sub ?? null]),
    writeHash() {}, panelPage: () => null, renderBotSettings() {}, renderContacts: () => { said.contacts++; },
    openModal: (h) => { said.modals.push(h); return element(); }, showBoxNote() {}, confirm: (t) => { said.confirms.push(t); return true; },
    md: (t) => `<p>${esc(t)}</p>`, copyBtn: () => '', msgTime: (iso) => String(iso).slice(11, 16), plain: (t) => t,
    escMentions: (t) => esc(t), botFigure: (c) => `<div class="avatar head" data-c="${c}"></div>`,
    Unread: { tint: (c) => c }, ICON: { back: '<back>' }, BACK_BTN: '<button data-back></button>',
    composerHTML: () => '<form class="composer"></form>', wireComposer() {},
  });
  vm.runInContext(`${src}\nObject.assign(this, { rooms, door, setRoomsOn, loadRooms, loadRoomChat, roomsRowHTML, drawRoomsKeys, roomsListHTML, roomThreadHTML, roomMessageHTML, roomMentionBots, roomWorkingHTML, sendToRoom, answerInvite, openRoomSettings, roomById, roomNews, markRoomSeen, joinFromLink, joinHash, roomLinkHTML, openRoomMaker });`, ctx);
  const flush = () => new Promise((r) => setImmediate(r));
  return { ctx, state, said, els, flush };
}

// ---------- where it is ----------

test('web: the page loads rooms.js after boot.js, and has a Rooms view and a Rooms button on both keypads', () => {
  const place = (s) => html.indexOf(`<script src="${s}">`);
  assert.ok(place('/rooms.js') > place('/boot.js') && place('/boot.js') > place('/feed.js'), 'not between feed.js and boot.js');
  assert.match(html, /<section id="view-rooms" class="view hidden"><\/section>/);
  assert.match(html, /id="kp-rooms"/);
  assert.match(html, /id="kp-phone-rooms"/);
  // The session says it: on or off, and whose session it is.
  assert.ok(settings.includes("if (typeof setRoomsOn === 'function') setRoomsOn(session?.rooms === true, session?.account, session?.roomLinks === true);"));
  // The view comes back from the address, with its room.
  assert.match(read('boot.js'), /'group', 'rooms', 'needs'/);
  assert.ok(cut('function setView(v, sub) {', '// The panel\'s own controls').includes("if (v === 'rooms') state.roomId = sub || null;"));
});

test('web: while rooms are off nothing of them is asked for or shown; on, the list and the invites are read', async () => {
  const p = page();
  assert.equal(p.ctx.roomsRowHTML(), '');
  p.ctx.drawRoomsKeys();
  assert.equal(p.els['#kp-rooms'].classList.contains('hidden'), true);
  assert.deepEqual(p.said.calls, []);
  assert.equal(p.said.streams.length, 0);

  p.ctx.setRoomsOn(true, 'me');
  await p.flush();
  assert.deepEqual(p.said.calls[0], ['GET', '/front-door/rooms']);
  assert.equal(p.said.streams[0].url, '/front-door/rooms/events');
  assert.equal(p.ctx.rooms.me, 'me');
  assert.match(p.ctx.roomsRowHTML(), /data-contact="rooms"/);
  assert.match(p.ctx.roomsRowHTML(), /1 invite/, 'the invite waiting is on the Rooms place');
  p.ctx.drawRoomsKeys();
  assert.equal(p.els['#kp-rooms'].classList.contains('hidden'), false);
  assert.match(p.els['#kp-phone-rooms'].innerHTML, /Rooms/);

  // Turned off: the stream closes, everything goes, and an open room view goes to the Chief.
  p.state.view = 'rooms';
  p.ctx.setRoomsOn(false);
  assert.equal(p.said.streams[0].closed, true);
  assert.equal(p.ctx.rooms.list.length, 0);
  assert.deepEqual(p.said.views.at(-1), ['chief', null]);
  assert.equal(p.ctx.roomsRowHTML(), '');
});

// ---------- the list and the invites ----------

test('web: the list shows the invites with Accept and Decline, and each room with its people and bots', async () => {
  const p = page();
  p.ctx.setRoomsOn(true, 'me');
  await p.flush();
  const h = p.ctx.roomsListHTML();
  assert.match(h, /<b>Books<\/b><div class="faint">ann invited you<\/div>/);
  assert.match(h, new RegExp(`data-accept="${'b'.repeat(32)}"`));
  assert.match(h, new RegExp(`data-decline="${'b'.repeat(32)}"`));
  assert.match(h, /<span class="name">Trip<\/span>/);
  assert.match(h, /me, ann · 2 bots/);
  assert.match(h, /id="room-new"/);
});

test('web: Accept posts to the front door and opens the room; Decline takes the invite away', async () => {
  const books = { ...ROOM, id: 'b'.repeat(32), name: 'Books', by: 'ann' };
  const p = page({ answer: (url) => (url.endsWith('/accept') ? [200, { room: books }] : url.endsWith('/decline') ? [200, { ok: true }] : [200, { rooms: [ROOM], invites: [INVITE, { ...INVITE, room: { id: 'c'.repeat(32), name: 'C', by: 'ann' } }] }]) });
  p.ctx.setRoomsOn(true, 'me');
  await p.flush();
  await p.ctx.answerInvite('b'.repeat(32), true, element());
  assert.deepEqual(p.said.calls.at(-1), ['POST', `/front-door/rooms/${'b'.repeat(32)}/accept`]);
  assert.ok(p.ctx.roomById('b'.repeat(32)));
  assert.deepEqual(p.said.views.at(-1), ['rooms', 'b'.repeat(32)]);
  await p.ctx.answerInvite('c'.repeat(32), false, element());
  assert.deepEqual(p.said.calls.at(-1), ['POST', `/front-door/rooms/${'c'.repeat(32)}/decline`]);
  assert.equal(p.ctx.rooms.invites.length, 0);
});

test("web: a refusal is said in the front door's words, and the button can be pressed again", async () => {
  const p = page({ answer: (url) => (url.endsWith('/accept') ? [409, { error: 'You are in that room already.' }] : [200, { rooms: [], invites: [INVITE] }]) });
  p.ctx.setRoomsOn(true, 'me');
  await p.flush();
  const button = element();
  await p.ctx.answerInvite('b'.repeat(32), true, button);
  assert.deepEqual(p.said.toasts.at(-1), ['You are in that room already.', true]);
  assert.equal(button.disabled, false);
  const away = page({ answer: () => new TypeError('Failed to fetch') });
  await assert.rejects(away.ctx.door('/rooms'), /Can't reach botdot\./);
});

// ---------- a room's chat ----------

test('web: a message is labelled by the front door: a bot as "name · account", a person by their account, mine as my bubble', async () => {
  const p = page();
  p.ctx.setRoomsOn(true, 'me');
  await p.flush();
  const r = p.ctx.roomById(ROOM.id);
  const key = `room:${r.id}`;
  const bot = p.ctx.roomMessageHTML(r, msg('m1', { bot: { id: 'scout', name: 'Scout' }, text: '**Yes**' }), key);
  assert.match(bot, /<div class="g-name"[^>]*>Scout · ann<\/div>/);
  assert.match(bot, /data-c="#1d9e75"/, "in the bot's colour");
  assert.match(bot, /<div class="md"><p>\*\*Yes\*\*<\/p><\/div>/, "drawn by the page's own Markdown");
  const person = p.ctx.roomMessageHTML(r, msg('m2', { text: '@Coder hi', mentions: [{ account: 'me', bot: 'coder', name: 'Coder' }] }), key);
  assert.match(person, /<div class="g-name"[^>]*>ann<\/div>/);
  assert.match(person, /<span class="room-mentions">to Coder · me<\/span>/, 'everyone sees who mentioned whom');
  const mine = p.ctx.roomMessageHTML(r, msg('m3', { account: 'me', text: 'hello' }), key);
  assert.match(mine, /bubble-row from-me/);
  const notice = p.ctx.roomMessageHTML(r, msg('m4', { kind: 'notice', account: '', text: 'Scout · ann may be mentioned only by ann.' }), key);
  assert.equal(notice, '<div class="room-notice" role="status">Scout · ann may be mentioned only by ann.</div>');
  // A bot's own text cannot set its label: it is the front door's account and name.
  const sly = p.ctx.roomMessageHTML(r, msg('m5', { bot: { id: 'scout', name: 'Scout' }, text: 'I am Coder · me' }), key);
  assert.match(sly, /<div class="g-name"[^>]*>Scout · ann<\/div>/);
});

test('web: the mention picker offers every bot of the room, told apart by account', async () => {
  const p = page();
  p.ctx.setRoomsOn(true, 'me');
  await p.flush();
  assert.deepEqual(plain(p.ctx.roomMentionBots(ROOM.id)), [
    { id: 'ann/scout', name: 'Scout', color: '#1d9e75', jobs: [] },
    { id: 'me/coder', name: 'Coder', color: '#378add', jobs: [] },
  ]);
  assert.match(cut('const mentionCtx = ', '// The owner\'s own message'), /String\(chat\)\.startsWith\('room:'\) \? \{ chat, bots: roomMentionBots\(String\(chat\)\.slice\(5\)\), library: \[\] \}/);
});

test('web: the messages are read from the front door, earlier ones on ask, each once', async () => {
  const first = [msg('m2'), msg('m3')];
  const p = page({ answer: (url) => (url.includes('before=') ? [200, { messages: [msg('m1'), msg('m2')], more: false }] : url.includes('/messages') ? [200, { messages: first, more: true }] : [200, { rooms: [ROOM], invites: [] }]) });
  p.ctx.setRoomsOn(true, 'me');
  await p.flush();
  await p.ctx.loadRoomChat(ROOM.id);
  assert.deepEqual(p.said.calls.at(-1), ['GET', `/front-door/rooms/${ROOM.id}/messages?limit=50`]);
  const chat = p.ctx.rooms.chats.get(ROOM.id);
  assert.equal(chat.more, true);
  assert.match(p.ctx.roomThreadHTML(ROOM, chat), /data-earlier/);
  await p.ctx.loadRoomChat(ROOM.id, 'm2');
  assert.deepEqual(p.said.calls.at(-1), ['GET', `/front-door/rooms/${ROOM.id}/messages?limit=50&before=m2`]);
  assert.deepEqual(plain(chat.items.map((m) => m.id)), ['m1', 'm2', 'm3']);
});

test('web: a message is sent with its key, and the bots at work show with one Stop', async () => {
  const p = page({ answer: (url, opts) => (opts.method === 'POST' ? [201, { message: msg('m9', { account: 'me', text: '@Scout go' }) }] : [200, { rooms: [ROOM], invites: [] }]) });
  p.ctx.setRoomsOn(true, 'me');
  await p.flush();
  await p.ctx.loadRoomChat(ROOM.id);
  await p.ctx.sendToRoom(ROOM.id, '@Scout go', 'k1');
  assert.deepEqual(p.said.calls.at(-1), ['POST', `/front-door/rooms/${ROOM.id}/messages`, { text: '@Scout go', key: 'k1' }]);
  assert.equal(p.ctx.roomById(ROOM.id).last.id, 'm9');
  const w = p.ctx.roomWorkingHTML(ROOM, [{ account: 'ann', bot: 'scout' }]);
  assert.match(w, /<b>Scout · ann<\/b> · Answering/);
  assert.equal((w.match(/data-room-stop/g) || []).length, 1);
  // A refused send rejects: the message box keeps the text (wireComposer).
  const no = page({ answer: (url, opts) => (opts.method === 'POST' ? [400, { error: 'At most 4000 characters.' }] : [200, { rooms: [ROOM], invites: [] }]) });
  no.ctx.setRoomsOn(true, 'me');
  await no.flush();
  await assert.rejects(no.ctx.sendToRoom(ROOM.id, 'x', 'k'), /At most 4000/);
});

test('web: the live events change the list, the invites and the messages', async () => {
  const p = page({ answer: (url) => (url.includes('/messages') ? [200, { messages: [], more: false }] : [200, { rooms: [ROOM], invites: [] }]) });
  p.ctx.setRoomsOn(true, 'me');
  await p.flush();
  await p.ctx.loadRoomChat(ROOM.id);
  const s = p.said.streams[0];
  s.emit('invite', INVITE);
  assert.equal(p.ctx.rooms.invites.length, 1);
  s.emit('invite_gone', { id: INVITE.room.id });
  assert.equal(p.ctx.rooms.invites.length, 0);
  s.emit('room_message', { roomId: ROOM.id, message: msg('m7', { bot: { id: 'scout', name: 'Scout' } }) });
  assert.deepEqual(plain(p.ctx.rooms.chats.get(ROOM.id).items.map((m) => m.id)), ['m7']);
  assert.equal(p.ctx.roomNews(p.ctx.roomById(ROOM.id)), true, 'news until it is read here');
  p.ctx.markRoomSeen(p.ctx.roomById(ROOM.id));
  assert.equal(p.ctx.roomNews(p.ctx.roomById(ROOM.id)), false);
  s.emit('room', { room: { ...ROOM, name: 'Trip 2' } });
  assert.equal(p.ctx.roomById(ROOM.id).name, 'Trip 2');
  p.state.view = 'rooms'; p.state.roomId = ROOM.id;
  s.emit('room_gone', { id: ROOM.id });
  assert.equal(p.ctx.roomById(ROOM.id), null);
  assert.equal(p.state.roomId, null, 'back to the list');
});

// ---------- a room's settings ----------

test("web: the room's settings: Remove only on this account's bots, Delete only for its maker, Add only bots that may join", async () => {
  const myBots = [{ id: 'coder', name: 'Coder', rooms: { allowRooms: true, whoMayMention: 'owner' } }, { id: 'diary', name: 'Diary', rooms: { allowRooms: true, whoMayMention: 'owner' } }, { id: 'vault', name: 'Vault keeper', rooms: { allowRooms: false, whoMayMention: 'owner' } }];
  const p = page({ myBots });
  p.ctx.setRoomsOn(true, 'me');
  await p.flush();
  const root = element();
  const modal = element({ '#room-panel': root });
  p.ctx.openModal = (h) => { p.said.modals.push(h); return modal; };
  const form = element({}, {});
  root.querySelector = (sel) => (sel === '#room-form' ? form : null);
  form.querySelector = () => element();
  form.querySelectorAll = () => [];
  p.ctx.openRoomSettings(ROOM.id);
  const h = root.innerHTML;
  assert.equal((h.match(/data-remove-bot="/g) || []).length, 1);
  assert.match(h, /data-remove-bot="coder"/);
  assert.match(h, /Scout · ann/);
  assert.match(h, /<option value="diary">Diary<\/option>/);
  assert.doesNotMatch(h, /value="coder"/, 'already in the room');
  assert.doesNotMatch(h, /value="vault"/, 'kept out of rooms by its settings');
  assert.match(h, /once "Shared rooms" is on in their settings/);
  assert.match(h, /bob · invited/);
  assert.match(h, /data-delete-room/);
  assert.match(h, /data-leave-room/);
  // Someone else's room: no Delete.
  p.ctx.rooms.list[0] = { ...ROOM, by: 'ann' };
  p.ctx.openRoomSettings(ROOM.id);
  assert.doesNotMatch(root.innerHTML, /data-delete-room/);
});

test("web: the room's settings close on their ✕, after every redraw", async () => {
  const p = page({ answer: (url) => (url.endsWith('/name') ? [200, { room: { ...ROOM, name: 'Trip 2' } }] : [200, { rooms: [ROOM], invites: [] }]) });
  p.ctx.setRoomsOn(true, 'me');
  await p.flush();
  const root = element();
  let closed = 0;
  const modal = element({ '#room-panel': root }, { close: () => { closed++; } });
  p.ctx.openModal = () => modal;
  const parts = {};
  const form = element({}, { querySelector: (sel) => (parts[sel] ||= element()), querySelectorAll: () => [], name: { value: 'Trip 2' } });
  root.querySelector = (sel) => (sel === '#room-form' ? form : null);
  p.ctx.openRoomSettings(ROOM.id);
  assert.match(root.innerHTML, /data-dismiss>✕<\/button>/);
  parts['[data-dismiss]'].onclick();
  assert.equal(closed, 1);
  // A change draws the panel again; its new ✕ still closes it.
  delete parts['[data-dismiss]'];
  parts['[data-rename]'].onclick({ target: parts['[data-rename]'] });
  for (let i = 0; i < 5 && !parts['[data-dismiss]']; i++) await p.flush();
  assert.match(root.innerHTML, /<h2>Trip 2<\/h2>/);
  parts['[data-dismiss]'].onclick();
  assert.equal(closed, 2);
});

test('web: rooms invite by link only (ADR 076): New room asks for a name, makes the link and opens the settings on it', async () => {
  const made = { ...ROOM, id: 'd'.repeat(32), name: 'Plans', members: [{ account: 'me' }], bots: [], invites: [] };
  const link = { url: `https://botdot.example/#rooms/join=${TOKEN}`, expires: '2026-10-29T12:00:00Z' };
  const p = page({ answer: (url, opts) => (url === '/front-door/rooms' && opts.method === 'POST' ? [201, { room: made }] : url.endsWith('/link') ? [200, { link }] : [200, { rooms: [], invites: [] }]) });
  p.ctx.setRoomsOn(true, 'me', true);
  await p.flush();
  const panel = element();
  const parts = {};
  const maker = element({}, { querySelector: (sel) => (parts[sel] ||= element()), name: { value: ' Plans ' } });
  p.ctx.openModal = (h) => { p.said.modals.push(h); return h.includes('room-maker') ? element({ '#room-maker': maker }, { close() {} }) : element({ '#room-panel': panel }); };
  const form = element({}, { querySelector: () => element(), querySelectorAll: () => [] });
  panel.querySelector = (sel) => (sel === '#room-form' ? form : null);
  p.ctx.openRoomMaker();
  const dialog = p.said.modals[0];
  assert.match(dialog, /name="name"/);
  assert.doesNotMatch(dialog, /name="account"|Invite/, 'no invite by name');
  await maker.onsubmit({ preventDefault() {} });
  for (let i = 0; i < 5; i++) await p.flush();
  const posts = p.said.calls.filter((c) => c[0] === 'POST').map((c) => c.slice(1));
  assert.deepEqual(posts, [['/front-door/rooms', { name: 'Plans' }], [`/front-door/rooms/${made.id}/link`]]);
  assert.deepEqual(p.said.views.at(-1), ['rooms', made.id]);
  assert.match(panel.innerHTML, /data-copy-link>Copy/, 'the settings open on the link');
  assert.doesNotMatch(panel.innerHTML, /data-invite|Account name/);
});

test('web: the Rooms screens carry no helper lines', () => {
  const p = page();
  p.ctx.rooms.known = true;
  const h = p.ctx.roomsListHTML();
  assert.doesNotMatch(h, /class="sub"|class="muted"/);
  assert.match(h, /No rooms yet/);
  assert.doesNotMatch(p.ctx.roomLinkHTML(null) + p.ctx.roomLinkHTML({ url: 'u', expires: '2026-10-29T12:00:00Z' }), /faint|Works until|Anyone/);
});

// ---------- a bot's settings ----------

test("web: a bot's settings have the Shared rooms row with room-settings and rooms on, and save sends rooms", () => {
  const draw = cut('function renderBotSettings(', '// The bits of the settings page that follow');
  assert.ok(draw.includes('${showsRoomSettings(b) ?'));
  assert.match(draw, /name="allowRooms" \$\{b\.rooms\.allowRooms \? 'checked' : ''\}/);
  assert.match(draw, /<select name="roomsWho" aria-label="\$\{esc\(tr\('Who may mention it'\)\)\}">/, "a row of its own, shown while it is on");
  assert.match(bots, /const ROOM_WHO = \[\['owner', tr\('Only you'\)\], \['anyone', tr\('Anyone in the room'\)\]\];/);
  const ctx = vm.createContext({ ...words, readDisabledSkills: () => [], readLlmFields: () => ({}), state: { features: ['room-settings'] }, rooms: { on: true } });
  vm.runInContext(`${cut('const ROOM_WHO = ', '// The page\'s form, in the shape the API takes.')}\n${cut('function readBotForm(', '// Switched-off machine/built-in skills')}\nthis.readBotForm = readBotForm; this.showsRoomSettings = showsRoomSettings;`, ctx);
  const field = (value, checked = false) => ({ value, checked });
  const base = { name: field('Coder'), color: field('#1d9e75'), description: field(''), group: field(''), prompt: field(''), systemPrompt: field(''), computer: field(''), othersMayAsk: field('', true), tools: field(''), permissionMode: field('dontAsk') };
  const sel = { skills: [], connectors: [], others: [], mayMessage: new Set() };
  assert.equal('rooms' in ctx.readBotForm(base, sel), false, 'no row, nothing of rooms is sent');
  assert.deepEqual(plain(ctx.readBotForm({ ...base, allowRooms: field('', true), roomsWho: field('anyone') }, sel).rooms), { allowRooms: true, whoMayMention: 'anyone' });
  const b = { rooms: { allowRooms: false, whoMayMention: 'owner' } };
  assert.equal(ctx.showsRoomSettings(b), true);
  assert.equal(ctx.showsRoomSettings({}), false, 'a botdot that sends no rooms');
  ctx.state.features = [];
  assert.equal(ctx.showsRoomSettings(b), false, 'a botdot without room-settings');
  ctx.state.features = ['room-settings'];
  ctx.rooms.on = false;
  assert.equal(ctx.showsRoomSettings(b), false, 'shared rooms off on this machine');
});

// ---------- an invite link (ADR 068) ----------

const TOKEN = 'T'.repeat(32);
test('web: an invite link opened waits for rooms, then asks to join; Join posts it and opens the room', async () => {
  const p = page({ answer: (url, opts) => (url.startsWith('/front-door/rooms/join/') ? (opts.method === 'POST' ? [200, { room: ROOM }] : [200, { room: { id: ROOM.id, name: 'Trip', by: 'ann' }, member: false }]) : [200, { rooms: [], invites: [] }]) });
  const form = element({}, {});
  form.querySelector = () => element();
  p.ctx.openModal = (h) => { p.said.modals.push(h); return element({ '#room-join': form }, { close() {} }); };
  assert.equal(p.ctx.joinFromLink('nothing'), false);
  assert.equal(p.ctx.joinFromLink(`join=${TOKEN}`), true);
  assert.equal(p.ctx.joinHash(), `#rooms/join=${TOKEN}`, 'kept for the sign-in page to come back to');
  assert.ok(read('app.js').includes("location.assign(`/sign-in${typeof joinHash === 'function' ? joinHash() : ''}`)"));
  assert.ok(require('../lib/front-door/pages').SCRIPT.includes("/^#rooms[/]join=[A-Za-z0-9_-]{1,100}$/.test(location.hash) ? location.hash : ''"), 'signed in, back to the link');
  assert.match(read('boot.js'), /view === 'rooms' && typeof joinFromLink === 'function' && joinFromLink\(hashSub\)/);
  await p.flush();
  assert.deepEqual(p.said.calls, [], 'nothing asked while rooms are off');
  p.ctx.setRoomsOn(true, 'me', true);
  await p.flush();
  assert.ok(p.said.calls.some((c) => c[0] === 'GET' && c[1] === `/front-door/rooms/join/${TOKEN}`));
  assert.match(p.said.modals.at(-1), /Join Trip\?/);
  assert.match(p.said.modals.at(-1), /ann made this room/);
  assert.equal(p.ctx.joinHash(), '', 'asked once');
  await form.onsubmit({ preventDefault() {} });
  assert.deepEqual(p.said.calls.at(-1), ['POST', `/front-door/rooms/join/${TOKEN}`]);
  assert.ok(p.ctx.roomById(ROOM.id));
  assert.deepEqual(p.said.views.at(-1), ['rooms', ROOM.id]);
});

test('web: an invite link of a room this account is in opens the room; one that ended says so', async () => {
  const p = page({ answer: (url) => (url.startsWith('/front-door/rooms/join/') ? [200, { room: { id: ROOM.id, name: 'Trip', by: 'me' }, member: true }] : [200, { rooms: [ROOM], invites: [] }]) });
  p.ctx.setRoomsOn(true, 'me', true);
  p.ctx.joinFromLink(`join=${TOKEN}`);
  await p.flush();
  assert.deepEqual(p.said.views.at(-1), ['rooms', ROOM.id]);
  const gone = page({ answer: (url) => (url.startsWith('/front-door/rooms/join/') ? [404, { error: 'This invite link was taken back or has ended. Ask for a new one.' }] : [200, { rooms: [], invites: [] }]) });
  gone.ctx.setRoomsOn(true, 'me', true);
  gone.ctx.joinFromLink(`join=${TOKEN}`);
  await gone.flush();
  assert.deepEqual(gone.said.toasts.at(-1), ['This invite link was taken back or has ended. Ask for a new one.', true]);
});

test("web: the room's maker sees its invite link in the settings, with Copy, New link and Take back; others see none", async () => {
  assert.equal(page().ctx.roomLinkHTML(undefined), '');
  assert.match(page().ctx.roomLinkHTML(null), /data-make-link>Make an invite link/);
  const h = page().ctx.roomLinkHTML({ url: `https://botdot.example/#rooms/join=${TOKEN}`, expires: '2026-10-29T12:00:00Z' });
  assert.match(h, new RegExp(`value="https://botdot.example/#rooms/join=${TOKEN}"`));
  assert.match(h, /data-copy-link>Copy/);
  assert.match(h, /data-make-link>New link/);
  assert.match(h, /data-drop-link>Take back/);

  const link = { url: `https://botdot.example/#rooms/join=${TOKEN}`, expires: '2026-10-29T12:00:00Z' };
  const p = page({ answer: (url) => (url.endsWith('/link') ? [200, { link }] : [200, { rooms: [ROOM, { ...ROOM, id: 'c'.repeat(32), by: 'ann' }], invites: [] }]) });
  p.ctx.setRoomsOn(true, 'me', true);
  await p.flush();
  const root = element();
  p.ctx.openModal = (x) => { p.said.modals.push(x); return element({ '#room-panel': root }); };
  const form = element({}, {});
  root.querySelector = (sel) => (sel === '#room-form' ? form : null);
  form.querySelector = () => element();
  form.querySelectorAll = () => [];
  p.ctx.openRoomSettings(ROOM.id);
  await p.flush();
  assert.match(root.innerHTML, /data-copy-link>Copy/, 'drawn again once read');
  assert.ok(p.said.calls.some((c) => c[0] === 'GET' && c[1] === `/front-door/rooms/${ROOM.id}/link`));
  const before = p.said.calls.length;
  p.ctx.openRoomSettings('c'.repeat(32));
  await p.flush();
  assert.equal(p.said.calls.slice(before).some((c) => c[1].endsWith('/link')), false, 'only the maker asks for it');
});
