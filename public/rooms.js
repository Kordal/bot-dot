// Shared rooms on the web page (ADR 060; docs/api.md, "Shared rooms"). A room is one chat on this machine with
// people of several accounts and their bots, kept by the front door: this file draws what the front door says and
// decides nothing. The Rooms place in the list and on the keypad, the list of rooms with the invites waiting, a
// room's chat, its settings (people, bots, invite, leave, delete), and "New room". A bot answers in a room only when
// it is @mentioned, and only talks there. Nothing is shown unless the front door's session says `rooms: true`.
// Loaded after app.js and boot.js, whose helpers it uses (esc, md, botFigure, openModal, toast, the message box);
// list.js and settings.js call the functions of this file where a room takes part.

// ---------- what the front door says ----------

// on: the session says rooms are on for this account. me: this account's name, as the front door labels it.
// list: the rooms this account is in. invites: the invitations waiting for it. chats: room id → its messages read
// so far, { items, more, loaded }. seen: room id → the id of its last message read here (this browser).
// links: the front door makes invite links (ADR 068). joining: the token of an invite link opened, until it is answered.
const rooms = { on: false, me: '', links: false, list: [], invites: [], known: false, chats: new Map(), stream: null, seen: {}, joining: null };
try { rooms.seen = JSON.parse(localStorage.getItem('botdot.rooms.seen') || '{}') || {}; } catch { /* private mode */ }

const ROOM_GREY = '#888780';
const roomById = (id) => rooms.list.find((r) => r.id === id) || null;
// "name · account": how every bot of a room is shown, with the front door's account name.
const roomBotLabel = (b) => `${b?.name || 'A bot'} · ${b?.account || ''}`;
const roomBots = (r) => (Array.isArray(r?.bots) ? r.bots : []);
const roomPeople = (r) => (Array.isArray(r?.members) ? r.members.map((m) => m.account).filter(Boolean) : []);
const isMine = (b) => !!rooms.me && b?.account === rooms.me;

// A request to the front door's own routes (never passed to botdot). What it throws is a sentence for the owner:
// the front door's, or that it could not be reached.
async function door(path, opts = {}) {
  let res;
  try {
    res = await fetch(`/front-door${path}`, {
      method: opts.method || 'GET',
      headers: { 'Content-Type': 'application/json', 'X-Bot-Dot': '1' },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch { throw Object.assign(new Error("Can't reach botdot."), { unreached: true }); }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const said = typeof data.error === 'string' && data.error.trim();
    throw Object.assign(new Error(said || `botdot couldn't do that (${res.status}).`), { status: res.status, refused: !!said });
  }
  return data;
}

// The session's word (settings.js, showAdminLink): on or off, and whose session it is. Off takes every room away.
function setRoomsOn(on, account = '', links = false) {
  const was = rooms.on;
  rooms.on = on === true;
  rooms.me = typeof account === 'string' ? account : '';
  rooms.links = rooms.on && links === true;
  if (rooms.on && !was) { loadRooms(); followRooms(); }
  if (rooms.on) openJoin();
  if (!rooms.on) {
    rooms.stream?.close();
    Object.assign(rooms, { stream: null, list: [], invites: [], known: false });
    rooms.chats.clear();
    if (state.view === 'rooms') setView('chief');
  }
  // A bot's settings show its Shared rooms row only while rooms are on: drawn again if open.
  if (was !== rooms.on && panelPage() === 'botsettings') renderBotSettings(true);
  drawRooms();
}

// Every room and every invite. One that could not be read leaves what the page has.
async function loadRooms() {
  if (!rooms.on) return;
  try {
    const got = await door('/rooms');
    rooms.list = (Array.isArray(got?.rooms) ? got.rooms : []).filter((r) => r && typeof r.id === 'string');
    rooms.invites = (Array.isArray(got?.invites) ? got.invites : []).filter((i) => i?.room && typeof i.room.id === 'string');
    rooms.known = true;
  } catch (e) { if (!rooms.known) toast(e.message, true); }
  drawRooms();
}

// A room's messages, oldest first: the newest, or with `before` those before the oldest the page holds.
async function loadRoomChat(id, before = '') {
  const chat = rooms.chats.get(id) || { items: [], more: false, loaded: false };
  rooms.chats.set(id, chat);
  try {
    const got = await door(`/rooms/${encodeURIComponent(id)}/messages?limit=50${before ? `&before=${encodeURIComponent(before)}` : ''}`);
    const list = (Array.isArray(got?.messages) ? got.messages : []).filter((m) => m && typeof m.id === 'string');
    const have = new Set(chat.items.map((m) => m.id));
    chat.items = before ? [...list.filter((m) => !have.has(m.id)), ...chat.items] : mergeMessages(chat.items, list);
    chat.more = got?.more === true;
    chat.loaded = true;
  } catch (e) { toast(e.message, true); }
  drawRooms();
}
// What the page holds and what was read, each message once, oldest first.
function mergeMessages(have, got) {
  const by = new Map(have.map((m) => [m.id, m]));
  for (const m of got) by.set(m.id, m);
  return [...by.values()].sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

// The live events of the rooms (docs/api.md): a room changed or is gone, an invite came or went, a new message.
function followRooms() {
  if (rooms.stream || typeof EventSource !== 'function') return;
  const s = new EventSource('/front-door/rooms/events');
  rooms.stream = s;
  const on = (type, fn) => s.addEventListener(type, (e) => { let d; try { d = JSON.parse(e.data); } catch { return; } fn(d); drawRooms(); });
  on('room', (d) => takeRoom(d?.room));
  on('room_gone', (d) => dropRoom(d?.id));
  on('invite', (d) => { if (d?.room?.id && !rooms.invites.some((i) => i.room.id === d.room.id)) rooms.invites.push(d); });
  on('invite_gone', (d) => { rooms.invites = rooms.invites.filter((i) => i.room.id !== d?.id); });
  on('room_message', (d) => takeMessage(d?.roomId, d?.message));
  // Back after a break: what changed meanwhile.
  s.addEventListener('open', () => { if (rooms.known) loadRooms(); });
}
function takeRoom(room) {
  if (!room || typeof room.id !== 'string') return;
  const i = rooms.list.findIndex((r) => r.id === room.id);
  if (i >= 0) rooms.list[i] = room; else rooms.list.push(room);
  rooms.invites = rooms.invites.filter((x) => x.room.id !== room.id); // accepted, here or in another app
}
function dropRoom(id) {
  rooms.list = rooms.list.filter((r) => r.id !== id);
  rooms.chats.delete(id);
  if (state.view === 'rooms' && state.roomId === id) { state.roomId = null; writeHash(); }
}
function takeMessage(roomId, m) {
  if (!m || typeof m.id !== 'string') return;
  const r = roomById(roomId);
  if (r) r.last = m;
  const chat = rooms.chats.get(roomId);
  if (chat?.loaded) chat.items = mergeMessages(chat.items, [m]);
}

// ---------- read and unread ----------

// A room has news when its last message is not the one last read here, and was not this account's own.
const roomNews = (r) => !!r?.last?.id && rooms.seen[r.id] !== r.last.id && !(r.last.account === rooms.me && !r.last.bot) && !(state.view === 'rooms' && state.roomId === r.id && !document.hidden);
function markRoomSeen(r) {
  if (!r?.last?.id || rooms.seen[r.id] === r.last.id) return;
  rooms.seen[r.id] = r.last.id;
  try { localStorage.setItem('botdot.rooms.seen', JSON.stringify(rooms.seen)); } catch { /* private mode */ }
}
// What the Rooms place says: the invites waiting, else the rooms with news.
function roomsBadge() {
  if (rooms.invites.length) return `${rooms.invites.length} ${rooms.invites.length === 1 ? 'invite' : 'invites'}`;
  const news = rooms.list.filter(roomNews).length;
  return news ? `${news} new` : '';
}

// ---------- the Rooms place in the list and on the keypad ----------

const ROOMS_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h11v8H8l-4 3zM15 10h5v7l-3-2h-6v-1"/></svg>';
// Its row in the list, under the Chief and the pinned bots. None while rooms are off.
function roomsRowHTML() {
  if (!rooms.on) return '';
  const badge = roomsBadge();
  const n = rooms.list.length;
  return `
      <button class="contact rooms-row ${state.view === 'rooms' ? 'active' : ''}" data-contact="rooms" title="Rooms">
        <div class="avatar rooms-pic">${ROOMS_ICON}</div>
        <div class="grow"><div class="top"><span class="name">Rooms</span>${badge ? `<span class="rooms-badge">${esc(badge)}</span>` : ''}</div>
        <div class="prev">${n ? `${n} ${n === 1 ? 'room' : 'rooms'} with other accounts` : 'Chat with the bots of other accounts'}</div></div>
      </button>`;
}
// Its button on the keypad, beside Needs you, and on a phone's home.
function drawRoomsKeys() {
  for (const id of ['#kp-rooms', '#kp-phone-rooms']) {
    const el = $(id);
    if (!el) continue;
    el.classList.toggle('hidden', !rooms.on);
    if (!rooms.on) continue;
    const badge = roomsBadge();
    el.innerHTML = `${ROOMS_ICON}<span>Rooms</span>${badge ? `<span class="rooms-badge">${esc(badge)}</span>` : ''}`;
    el.classList.toggle('active', state.view === 'rooms');
    el.onclick = () => setView('rooms');
  }
}

// ---------- the view ----------

// What is shown changed: the view, if it is open, and the Rooms place.
function drawRooms() {
  if (state.view === 'rooms') renderRooms();
  renderContacts();
}

// The Rooms view: the list with the invites, or one room's chat (state.roomId).
function renderRooms() {
  const root = $('#view-rooms');
  if (!root) return;
  if (!rooms.on) { root.innerHTML = ''; return; }
  const r = state.roomId ? roomById(state.roomId) : null;
  if (state.roomId && !r && rooms.known) { state.roomId = null; writeHash(); } // gone, here or in another app
  if (r) return renderRoomChat(root, r);
  if (root.dataset.room !== '') { root.dataset.room = ''; delete root.dataset.sig; }
  const sig = JSON.stringify([rooms.list.map((x) => [x.id, x.name, x.last?.id, roomNews(x), roomPeople(x), roomBots(x).length]), rooms.invites, rooms.known]);
  if (root.dataset.sig === sig) return;
  root.dataset.sig = sig;
  root.innerHTML = roomsListHTML();
  $('#room-new', root).onclick = openRoomMaker;
  $$('[data-room]', root).forEach((el) => (el.onclick = () => setView('rooms', el.dataset.room)));
  $$('[data-accept]', root).forEach((el) => (el.onclick = () => answerInvite(el.dataset.accept, true, el)));
  $$('[data-decline]', root).forEach((el) => (el.onclick = () => answerInvite(el.dataset.decline, false, el)));
}

function roomsListHTML() {
  const invites = rooms.invites.map((i) => `
      <div class="room-invite">
        <div class="grow"><b>${esc(i.room.name)}</b><div class="faint">${esc(i.by || i.room.by || 'Someone')} invited you</div></div>
        <button type="button" class="btn sm" data-decline="${esc(i.room.id)}">Decline</button>
        <button type="button" class="btn sm primary" data-accept="${esc(i.room.id)}">Accept</button>
      </div>`).join('');
  const list = rooms.list.map((r) => {
    const last = r.last ? `${r.last.kind === 'notice' ? '' : `<span class="who">${esc(roomAuthor(r.last))}:</span> `}${esc(plain(r.last.text || ''))}` : 'No messages yet';
    return `
      <button type="button" class="room-row" data-room="${esc(r.id)}">
        <div class="avatar rooms-pic">${ROOMS_ICON}</div>
        <div class="grow"><div class="top"><span class="name">${esc(r.name)}</span>${roomNews(r) ? '<i class="room-dot"></i>' : ''}</div>
        <div class="faint">${esc(roomPeople(r).join(', '))}${roomBots(r).length ? ` · ${roomBots(r).length} ${roomBots(r).length === 1 ? 'bot' : 'bots'}` : ''}</div>
        <div class="prev">${last}</div></div>
      </button>`;
  }).join('');
  return `
    <div class="chat-head">${BACK_BTN}<div class="grow"><h2>Rooms</h2><div class="sub">Chats with people of other accounts on this machine and their bots</div></div>
      <button type="button" class="btn sm primary" id="room-new">New room</button></div>
    <div class="rooms-page">
      ${invites ? `<h3 class="page-sub">Invites</h3><div class="card rooms-card">${invites}</div>` : ''}
      ${list ? `<div class="card rooms-card">${list}</div>` : rooms.known ? `<div class="chat-empty"><div class="avatar rooms-pic lg">${ROOMS_ICON}</div><h3>No rooms yet</h3>
        <p class="muted">Make one and invite another account by its name.<br>A bot there answers only when it is @mentioned, and only talks: no tools, no notes.</p></div>` : '<p class="faint">Loading…</p>'}
    </div>`;
}

// Who wrote a message: a bot as "name · account", a person as their account, "You" for this account.
const roomAuthor = (m) => (m.bot ? roomBotLabel({ ...m.bot, account: m.account }) : m.account === rooms.me ? 'You' : m.account || 'Someone');

async function answerInvite(id, yes, button) {
  button.disabled = true;
  try {
    const got = await door(`/rooms/${encodeURIComponent(id)}/${yes ? 'accept' : 'decline'}`, { method: 'POST' });
    rooms.invites = rooms.invites.filter((i) => i.room.id !== id);
    if (yes && got?.room) { takeRoom(got.room); setView('rooms', got.room.id); }
  } catch (e) { toast(e.message, true); button.disabled = false; }
  drawRooms();
}

// ---------- joining with an invite link (ADR 068) ----------

// "#rooms/join=<token>": the link a room's maker shares. True when `sub` is one, kept to open "Join" once rooms are on.
const JOIN = /^join=([A-Za-z0-9_-]{1,100})$/;
function joinFromLink(sub) {
  const m = JOIN.exec(String(sub || ''));
  if (!m) return false;
  rooms.joining = m[1];
  openJoin();
  return true;
}
// The link's fragment, while one waits, for the sign-in page to come back to.
const joinHash = () => (rooms.joining ? `#rooms/join=${rooms.joining}` : '');
// A link opened in a page that is open already.
if (typeof addEventListener === 'function') addEventListener('hashchange', () => {
  const [view, sub] = location.hash.slice(1).split('/');
  if (view === 'rooms' && joinFromLink(sub)) setView('rooms');
});

// Asks once whether to join the room the waiting link opens; a member is taken to the room. A link that doesn't work
// says so. Nothing while rooms are off: an account of this machine without them sees that it can't join.
async function openJoin() {
  const token = rooms.joining;
  if (!token || !rooms.on) return;
  rooms.joining = null;
  let seen;
  try { seen = await door(`/rooms/join/${encodeURIComponent(token)}`); } catch (e) { toast(e.message, true); return; }
  const room = seen?.room;
  if (!room?.id) return;
  if (seen.member) { setView('rooms', room.id); return; }
  const m = openModal(`
    <form id="room-join">
      <div class="modal-head"><h2>Join ${esc(room.name)}?</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
      <div class="modal-body">
        <p>${esc(room.by || 'Someone')} made this room and shared its invite link.</p>
        <p class="muted">Everyone in it reads what is written there. Bots you add answer only when @mentioned, and only talk.</p>
        <div class="send-note hidden" role="alert"></div>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn" data-dismiss>Not now</button>
        <button class="btn primary">Join</button>
      </div>
    </form>`);
  const form = $('#room-join', m);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const button = $('.btn.primary', form);
    if (button.disabled) return;
    button.disabled = true;
    showBoxNote(form, '');
    try {
      const got = await door(`/rooms/join/${encodeURIComponent(token)}`, { method: 'POST' });
      if (got?.room?.id) { takeRoom(got.room); m.close(); setView('rooms', got.room.id); }
    } catch (err) { showBoxNote(form, err.message); button.disabled = false; }
    drawRooms();
  };
  return m;
}

// ---------- a room's chat ----------

function renderRoomChat(root, r) {
  const key = `room:${r.id}`;
  if (root.dataset.room !== r.id) {
    root.dataset.room = r.id;
    delete root.dataset.sig;
    root.innerHTML = `
      <div class="chat-head">
        <button class="icon-btn rooms-back" data-rooms-back aria-label="Rooms" title="Rooms">${ICON.back}</button>
        <button class="chat-title" id="room-settings" title="People, bots, invite, leave">
          <div class="avatar rooms-pic sm">${ROOMS_ICON}</div>
          <div class="grow"><h2 id="room-name"></h2><div class="sub" id="room-sub"></div></div>
        </button>
      </div>
      <div class="chat-thread" id="room-thread"><div class="g-items r-items"></div><div class="g-tail r-tail"></div></div>
      ${composerHTML('')}`;
    $('[data-rooms-back]', root).onclick = () => setView('rooms');
    $('#room-settings', root).onclick = () => openRoomSettings(r.id);
    wireComposer($('form', root), (text, files, k) => sendToRoom(r.id, text, k), null, key);
    if (!rooms.chats.get(r.id)?.loaded) loadRoomChat(r.id);
  }
  $('#room-name', root).textContent = r.name;
  $('#room-sub', root).textContent = [roomPeople(r).join(', '), roomBots(r).map(roomBotLabel).join(', ')].filter(Boolean).join(' · ');
  $('form', root).text.placeholder = roomBots(r).length ? `Message ${r.name}… @ names a bot` : `Message ${r.name}…`;
  const thread = $('#room-thread', root);
  const chat = rooms.chats.get(r.id);
  const working = Array.isArray(r.working) ? r.working : [];
  $('.r-tail', thread).innerHTML = roomWorkingHTML(r, working);
  const stop = $('[data-room-stop]', thread);
  if (stop) stop.onclick = () => stopRoom(r.id);
  if (!chat?.loaded) return;
  markRoomSeen(r);
  const sig = JSON.stringify([chat.items.map((m) => [m.id, m.text]), chat.more, roomBots(r).map((b) => [b.account, b.id, b.name, b.color]), rooms.me]);
  if (root.dataset.sig === sig) return;
  const atBottom = !root.dataset.sig || thread.scrollHeight - thread.scrollTop - thread.clientHeight < 120;
  root.dataset.sig = sig;
  const items = $('.r-items', thread);
  items.innerHTML = roomThreadHTML(r, chat);
  $$('[data-expand]', items).forEach((el) => (el.onclick = (e) => { if (!e.target.closest('a') && getSelection().isCollapsed) el.firstElementChild.classList.toggle('clamp'); }));
  const earlier = $('[data-earlier]', items);
  if (earlier) earlier.onclick = () => { earlier.disabled = true; loadRoomChat(r.id, chat.items[0]?.id || ''); };
  if (atBottom) thread.scrollTop = thread.scrollHeight;
}

// The bots a mention can name in a room (app.js, mentionCtx): every bot in it, told apart by account.
function roomMentionBots(id) {
  return roomBots(roomById(id)).map((b) => ({ id: `${b.account}/${b.id}`, name: b.name, color: b.color || ROOM_GREY, jobs: [] }));
}

function roomThreadHTML(r, chat) {
  const key = `room:${r.id}`;
  if (!chat.items.length) {
    return `<div class="chat-empty"><div class="avatar rooms-pic lg">${ROOMS_ICON}</div><h3>${esc(r.name)}</h3>
      <p class="muted">Everyone in the room reads what is written here.<br>A bot answers when you @mention it, if its owner lets you.</p></div>`;
  }
  let lastDay = '';
  return (chat.more ? '<div class="g-earlier"><button type="button" class="btn sm" data-earlier>Earlier messages</button></div>' : '') + chat.items.map((m) => {
    const day = new Date(m.at).toDateString();
    const sep = day !== lastDay ? `<div class="day">${esc(new Date(m.at).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }))}</div>` : '';
    lastDay = day;
    return sep + roomMessageHTML(r, m, key);
  }).join('');
}

// Who a message named, so that everyone sees who mentioned whom.
function roomMentionsHTML(m) {
  const named = (Array.isArray(m.mentions) ? m.mentions : []).filter((x) => x && x.name);
  return named.length ? `<span class="room-mentions">to ${named.map((x) => esc(roomBotLabel(x))).join(', ')}</span>` : '';
}

// One message: the front door's notice as a line; this account's own as the owner's bubble; another person's and
// every bot's on the left, under "name · account". A bot's text is drawn as Markdown by the page's own code.
function roomMessageHTML(r, m, key) {
  const text = typeof m.text === 'string' ? m.text : '';
  const time = msgTime(m.at);
  if (m.kind === 'notice') return `<div class="room-notice" role="status">${esc(text)}</div>`;
  const mentions = roomMentionsHTML(m);
  if (!m.bot && m.account === rooms.me) {
    return `<div class="bubble-row from-me" data-rmsg="${esc(m.id)}"><div class="stack mine">
      <div class="bubble from-me" data-expand><div class="clamp">${escMentions(text, key)}</div></div>
      <div class="bubble-meta">${mentions}<span>${esc(time)}</span>${text ? copyBtn(text) : ''}</div>
    </div></div>`;
  }
  const bot = m.bot ? roomBots(r).find((b) => b.account === m.account && b.id === m.bot.id) || { ...m.bot, account: m.account } : null;
  const color = bot ? bot.color || ROOM_GREY : ROOM_GREY;
  const head = bot ? botFigure(color, 'idle', 'g-head') : `<div class="avatar room-person">${esc((m.account || '?').slice(0, 1).toUpperCase())}</div>`;
  return `<div class="bubble-row from-bot g-row${bot ? '' : ' from-person'}" data-rmsg="${esc(m.id)}">
    ${head}
    <div class="stack">
      <div class="g-name" style="--c:${Unread.tint(color)}">${esc(roomAuthor(m))}</div>
      <div class="bubble from-bot"><div class="md">${md(text)}</div></div>
      <div class="bubble-meta">${mentions}<span>${esc(time)}</span>${text ? copyBtn(text) : ''}</div>
    </div></div>`;
}

// The bots at work in the room, one line each, and one Stop that drops the turns still waiting.
function roomWorkingHTML(r, working) {
  const lines = working.map((w, i) => {
    const b = roomBots(r).find((x) => x.account === w.account && x.id === w.bot) || { name: 'A bot', account: w.account };
    return `<div class="status-line" role="status" style="--c:${Unread.tint(b.color || ROOM_GREY)}"><i></i><span><b>${esc(roomBotLabel(b))}</b> · Answering</span>${i === working.length - 1 ? '<button type="button" data-room-stop>Stop</button>' : ''}</div>`;
  });
  return lines.length ? `<div class="g-working">${lines.join('')}</div>` : '';
}

// Send: the front door names the bots from the @names in the text. The key makes a resend the same message.
async function sendToRoom(id, text, key) {
  const got = await door(`/rooms/${encodeURIComponent(id)}/messages`, { method: 'POST', body: { text, key } });
  takeMessage(id, got?.message);
  drawRooms();
}
async function stopRoom(id) {
  try { await door(`/rooms/${encodeURIComponent(id)}/stop`, { method: 'POST' }); } catch (e) { toast(e.message, true); }
}

// ---------- making a room ----------

function openRoomMaker() {
  const m = openModal(`
    <form id="room-maker" autocomplete="off">
      <div class="modal-head"><h2>New room</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
      <div class="modal-body">
        <label class="field">Name<input type="text" name="name" maxlength="60" required placeholder="What the room is about"></label>
        <label class="field">Invite <span class="hint">an account on this machine, by its name; you can invite more later</span><input type="text" name="account" maxlength="60" placeholder="Account name"></label>
        <div class="send-note hidden" role="alert"></div>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn" data-dismiss>Cancel</button>
        <button class="btn primary">Create</button>
      </div>
    </form>`);
  const form = $('#room-maker', m);
  form.onsubmit = async (e) => {
    e.preventDefault();
    const button = $('.btn.primary', form);
    if (button.disabled) return;
    button.disabled = true;
    showBoxNote(form, '');
    try {
      const got = await door('/rooms', { method: 'POST', body: { name: form.name.value.trim() } });
      const room = got?.room;
      if (room?.id) takeRoom(room);
      const account = form.account.value.trim();
      // The room is made: an invite it refuses is said there, and the room opens all the same.
      if (room?.id && account) {
        try { takeRoom((await door(`/rooms/${encodeURIComponent(room.id)}/invite`, { method: 'POST', body: { account } }))?.room); } catch (err) { toast(err.message, true); }
      }
      m.close();
      if (room?.id) setView('rooms', room.id);
    } catch (err) { showBoxNote(form, err.message); button.disabled = false; }
  };
  return m;
}

// ---------- a room's settings ----------

// The room's people (with the invites waiting), its bots each as "name · account" with Remove on this account's
// own, "Add a bot" of this account's bots that may take part, inviting another account, its name, "Leave", and
// "Delete" for the one who made it. Every change is the front door's to refuse, in its words.
function openRoomSettings(id) {
  const r = roomById(id);
  if (!r) return;
  const m = openModal('<div id="room-panel"></div>');
  const root = $('#room-panel', m);
  let link; // the room's invite link, for its maker: undefined until read, null for none
  const draw = () => {
    const room = roomById(id);
    if (!room) { m.close(); return; }
    const inRoom = new Set(roomBots(room).filter(isMine).map((b) => b.id));
    const mayAdd = state.bots.filter((b) => b.rooms?.allowRooms === true && !inRoom.has(b.id));
    const keptOut = state.bots.filter((b) => b.rooms && b.rooms.allowRooms !== true).length;
    const invited = Array.isArray(room.invites) ? room.invites : [];
    const maker = rooms.links && room.by === rooms.me;
    root.innerHTML = `
      <form id="room-form" autocomplete="off">
        <div class="modal-head"><h2>${esc(room.name)}</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
        <div class="modal-body">
          <label class="field">Name<span class="room-inline"><input type="text" name="name" maxlength="60" value="${esc(room.name)}"><button type="button" class="btn sm" data-rename>Rename</button></span></label>
          <div class="field">People
            <div class="room-list">${roomPeople(room).map((a) => `<div class="room-item"><span class="grow">${esc(a)}${a === rooms.me ? ' <span class="faint">(you)</span>' : ''}${a === room.by ? ' <span class="faint">made the room</span>' : ''}</span></div>`).join('')}
            ${invited.map((i) => `<div class="room-item"><span class="grow faint">${esc(i.account)} · invited</span></div>`).join('')}</div>
            <span class="room-inline"><input type="text" name="account" maxlength="60" placeholder="Account name to invite"><button type="button" class="btn sm" data-invite>Invite</button></span>
            ${maker ? roomLinkHTML(link) : ''}
          </div>
          <div class="field">Bots <span class="hint">each answers only when @mentioned, and only talks</span>
            <div class="room-list">${roomBots(room).map((b) => `<div class="room-item">${botFigure(b.color || ROOM_GREY, 'idle', 'sm')}<span class="grow">${esc(roomBotLabel(b))}</span>${isMine(b) ? `<button type="button" class="link-btn" data-remove-bot="${esc(b.id)}">Remove</button>` : ''}</div>`).join('') || '<div class="faint">No bot yet.</div>'}</div>
            ${mayAdd.length ? `<span class="room-inline"><select name="bot">${mayAdd.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}</option>`).join('')}</select><button type="button" class="btn sm" data-add-bot>Add your bot</button></span>` : ''}
            ${keptOut ? `<div class="faint">${mayAdd.length ? 'More' : 'Your'} bots can join once "Shared rooms" is on in their settings.</div>` : ''}
          </div>
          <div class="send-note hidden" role="alert"></div>
        </div>
        <div class="modal-foot">
          ${room.by === rooms.me ? '<button type="button" class="link-btn danger-text" data-delete-room>Delete the room</button>' : ''}
          <button type="button" class="btn" data-leave-room>Leave the room</button>
        </div>
      </form>`;
    const form = $('#room-form', root);
    // The panel is drawn after openModal wired its dismiss buttons, so the ✕ is wired here, on every draw.
    $('[data-dismiss]', form).onclick = () => m.close();
    const act = async (button, fn) => {
      button.disabled = true;
      showBoxNote(form, '');
      try { await fn(); draw(); drawRooms(); } catch (e) { showBoxNote(form, e.message); button.disabled = false; }
    };
    const post = (path, body) => door(`/rooms/${encodeURIComponent(id)}${path}`, { method: 'POST', body });
    $('[data-rename]', form).onclick = (e) => act(e.target, async () => takeRoom((await post('/name', { name: form.name.value.trim() }))?.room));
    $('[data-invite]', form).onclick = (e) => act(e.target, async () => { takeRoom((await post('/invite', { account: form.account.value.trim() }))?.room); });
    const makeLink = $('[data-make-link]', form);
    if (makeLink) makeLink.onclick = () => act(makeLink, async () => { link = (await post('/link'))?.link || null; });
    const dropLink = $('[data-drop-link]', form);
    if (dropLink) dropLink.onclick = () => act(dropLink, async () => { await post('/link/remove'); link = null; });
    const copyLink = $('[data-copy-link]', form);
    if (copyLink) copyLink.onclick = () => navigator.clipboard?.writeText(link.url).then(() => toast('Link copied'), () => $('[name=link]', form)?.select());
    const add = $('[data-add-bot]', form);
    if (add) add.onclick = () => act(add, async () => takeRoom((await post('/bots', { bot: form.bot.value }))?.room));
    $$('[data-remove-bot]', form).forEach((el) => (el.onclick = () => act(el, async () => takeRoom((await post('/bots/remove', { bot: el.dataset.removeBot }))?.room))));
    $('[data-leave-room]', form).onclick = (e) => {
      if (!confirm(`Leave ${room.name}? Your bots leave with you; the room stays with the others.`)) return;
      act(e.target, async () => { await post('/leave'); dropRoom(id); m.close(); setView('rooms'); });
    };
    const del = $('[data-delete-room]', form);
    if (del) del.onclick = () => {
      if (!confirm(`Delete ${room.name} for everyone in it? Its messages go too.`)) return;
      act(del, async () => { await post('/delete'); dropRoom(id); m.close(); setView('rooms'); });
    };
    form.onsubmit = (e) => e.preventDefault();
  };
  draw();
  if (rooms.links && r.by === rooms.me) door(`/rooms/${encodeURIComponent(id)}/link`).then((got) => { link = got?.link || null; draw(); }, () => {});
  return m;
}

// The maker's invite link: the link with Copy, a new one and Take back; or "Make an invite link". Nothing until read.
function roomLinkHTML(link) {
  if (link === undefined) return '';
  const hint = '<div class="faint">Anyone with an account on this machine who opens it can join. It works for 7 days.</div>';
  if (!link) return `<span class="room-inline"><button type="button" class="btn sm" data-make-link>Make an invite link</button></span>${hint}`;
  const until = new Date(link.expires).toLocaleDateString([], { month: 'short', day: 'numeric' });
  return `<span class="room-inline"><input type="text" name="link" readonly value="${esc(link.url)}" aria-label="Invite link"><button type="button" class="btn sm" data-copy-link>Copy</button></span>
            <span class="room-inline"><span class="faint grow">Works until ${esc(until)}.</span><button type="button" class="link-btn" data-make-link>New link</button><button type="button" class="link-btn danger-text" data-drop-link>Take back</button></span>`;
}

