// ---------- the list's width ----------
// The owner drags the list's right edge (#side-grip) or moves it with the arrow keys; a double-click, or Home,
// puts it back. The width is kept on this device. Until the owner sets one the stylesheet decides (300, 260 in
// a narrower window), and the handle is only there while the list has its full layout (style.css). A narrow
// list leaves out the previews, and the narrowest shows figures only (style.css, @container side). The
// stylesheet also keeps the chat's room in a narrow window, so what is kept is not cut down to this window.
// Beside the keypad (a window wider than 1000) the same kind of handle (#chat-grip, #28) sets the chat's width
// instead, measured from the window's right edge: the keypad takes what the chat leaves, and the stylesheet
// keeps the keypad its room.
const SIDE = { min: 72, max: 480, step: 16, key: 'botdot.side.width', prop: '--side-w', from: 'left' };
const CHAT = { min: 400, max: 900, step: 16, key: 'botdot.chat.width', prop: '--chat-w', from: 'right' };
// A width `o`'s box may have.
const gripWidth = (o, w) => Math.round(Math.max(o.min, Math.min(w, o.max)));
const sideWidth = (w) => gripWidth(SIDE, w);
const chatWidth = (w) => gripWidth(CHAT, w);
// grip: the handle; box: what it sizes; o: its limits, where they are kept, and the edge the width runs from.
function initGrip(grip, box, o) {
  const app = $('#app');
  const now = () => Math.round(box.getBoundingClientRect().width);
  // w: the width the owner wants, or null for the stylesheet's.
  const show = (w) => {
    if (w == null) app.style.removeProperty(o.prop); else app.style.setProperty(o.prop, `${gripWidth(o, w)}px`);
    grip.setAttribute('aria-valuenow', now());
  };
  const keep = (w) => { try { if (w == null) localStorage.removeItem(o.key); else localStorage.setItem(o.key, String(w)); } catch { /* private mode */ } };
  const set = (w) => { show(w); keep(w == null ? null : now()); };
  let kept = 0;
  try { kept = Number(localStorage.getItem(o.key)); } catch { /* private mode */ }
  show(kept > 0 ? kept : null);
  window.addEventListener('resize', () => grip.setAttribute('aria-valuenow', now()));
  // The handle moved right: the list grows, the chat shrinks.
  const right = o.from === 'left' ? 1 : -1;

  // moved: a click on the handle that drags nowhere keeps nothing.
  let dragging = false, moved = false;
  grip.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    e.preventDefault(); // no text is selected on the way
    dragging = true;
    moved = false;
    grip.classList.add('dragging');
    grip.setPointerCapture(e.pointerId);
  });
  grip.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    moved = true;
    const r = box.getBoundingClientRect();
    show(o.from === 'left' ? e.clientX - r.left : r.right - e.clientX);
  });
  const drop = () => {
    if (!dragging) return;
    dragging = false;
    grip.classList.remove('dragging');
    if (moved) keep(now());
  };
  grip.addEventListener('pointerup', drop);
  grip.addEventListener('pointercancel', drop);
  grip.addEventListener('dblclick', () => set(null));
  grip.addEventListener('keydown', (e) => {
    const by = { ArrowLeft: -o.step, ArrowRight: o.step }[e.key];
    if (!by && e.key !== 'Home') return;
    e.preventDefault();
    set(by ? now() + by * right : null);
  });
}
const initSideGrip = () => initGrip($('#side-grip'), $('.sidebar'), SIDE);
const initChatGrip = () => initGrip($('#chat-grip'), $('.main'), CHAT);

// ---------- contacts (sidebar) ----------

function renderContacts() {
  tellTab();
  drawKeypad();
  if ($('#contacts')?.classList.contains('dragging')) return; // redrawing would cancel the drag
  glideContacts(drawContacts);
}

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
// Rows glide from where they were to where a redraw put them (a bot dropped, pinned or moved to a group).
function glideContacts(draw) {
  const was = new Map();
  if (!reducedMotion()) $$('#contacts [data-contact]').forEach((el) => was.set(el.dataset.contact, el.getBoundingClientRect().top));
  draw();
  if (!was.size) return;
  $$('#contacts [data-contact]').forEach((el) => {
    const dy = (was.get(el.dataset.contact) ?? NaN) - el.getBoundingClientRect().top;
    if (Math.abs(dy) > 1) el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 280, easing: 'cubic-bezier(.2, .8, .2, 1)' });
  });
}

// A bot's row in the list: its line, the class that colours it, and what stands after its time. r: its newest run.
// working: what it says it is doing. A bot that asks the owner something says so, "Asks: …" in the stronger colour
// with a mark in place of the dots, until the feed says the question ended (unread.js). While it works, its line
// says what it does.
function contactLine(b, r, working) {
  const asks = Unread.asks(b, b.running || r?.status === 'running');
  const prev = asks ? `Asks: ${asks}` : b.running ? working : r ? (r.status === 'success' ? plain(r.result) : r.status === 'running' ? working : "Couldn't finish") : b.description || 'No messages yet';
  return { prev, cls: asks ? 'asks' : b.running ? 'working' : '', after: asks ? Unread.mark(b.color) : Unread.dots(Unread.count(b), b.color) };
}

// A bot's line in the list and on its key: from its newest run, and while it works its line in the server's words when
// it has one.
function botLine(b) {
  const working = OpeningLine.preview(openingLines.of(`bot:${b.id}`)) || 'Working…'; // its line, in the server's words, when it has one
  return contactLine(b, state.runs.find((r) => r.botId === b.id), working);
}

function drawContacts() {
  const q = ($('#contact-search')?.value || '').trim().toLowerCase();
  const lastRun = (id) => state.runs.find((r) => r.botId === id);
  const bots = [...state.bots].sort(byPlace); // in the order you gave them (drag to change it)
  const chat = state.chats[0];
  const items = [];
  const top = []; // the Chief and the pinned bots
  if (!q) items.push(dashStrip());
  if (!q || chiefMatches(q)) {
    top.push(`
      <button class="contact ${state.view === 'chief' ? 'active' : ''}" data-contact="chief" title="${esc(chiefName())}">
        ${chiefFigure()}
        <div class="grow"><div class="top"><span class="name">${esc(chiefName())}</span><span class="time">${esc(shortTime(chat?.updatedAt))}</span>${Unread.dots(state.chiefUnread, CHIEF_COLOR)}</div>
        <div class="prev">${esc(plain(chat?.preview) || 'Your team of bots. Ask for anything.')}</div></div>
      </button>`);
  }
  const contact = (b) => {
    const r = lastRun(b.id);
    const line = botLine(b);
    return `
      <button class="contact ${state.view === 'bot' && state.botId === b.id ? 'active' : ''}" data-contact="${esc(b.id)}" ${b.pinned > 0 ? `data-pin="${b.pinned}"` : `data-group="${esc(b.group || '')}" data-place="${placeOf(b)}"`} draggable="true" title="${esc(b.name)}">
        ${botFigure(b.color, b.state, '', b.outfit)}
        <div class="grow"><div class="top"><span class="name">${esc(b.name)}</span><span class="time">${esc(shortTime(r?.startedAt))}</span>${line.after}</div>
        <div class="prev ${line.cls}">${esc(line.prev)}</div></div>
      </button>`;
  };
  const matching = bots.filter((b) => !q || `${b.name} ${b.description} ${b.group}`.toLowerCase().includes(q));
  // The groups (groups.js): one row each, found by its name, its category and its members' names. The pinned ones
  // share one order with the pinned bots (#276); a category's stand after its bots, counted among the groups.
  const chats = state.groups.filter((g) => !q || groupSearchText(g).includes(q));
  // The rows are the keypad's pages (keypad.js): the pinned bots and groups right below the Chief, in the order you
  // gave them; the rest by category.
  const row = (x) => (x.members ? groupContactHTML(x) : contact(x));
  const pages = Keypad.pages(matching, chats);
  top.push(...(pages.find((p) => p.kind === 'pinned')?.keys || []).map(row));
  items.push(...top);
  if (!q && typeof roomsRowHTML === 'function') items.push(roomsRowHTML()); // shared rooms, when they are on (rooms.js)
  if (items.length) items.push('<div class="contact-sep"></div>');
  const rest = pages.filter((p) => p.kind !== 'pinned');
  const cats = categoryNames(bots.filter((b) => !(b.pinned > 0)), state.groups.filter((g) => !(g.pinned > 0)));
  if (!cats.length) items.push(...rest.flatMap((p) => p.keys.map(row)));
  else {
    // Categories A–Z, then what is in none ("Other"). Folded ones stay folded, except while searching.
    const folded = foldedGroups();
    for (const p of rest) {
      const g = p.kind === 'other' ? '' : p.name;
      const isFolded = !q && folded.has(g || '\u0000');
      const busy = p.keys.some((x) => !x.members && x.running);
      items.push(`
        <div class="group-head" data-group-head="${esc(g)}">
          <button class="group-toggle" data-fold="${esc(g)}" title="${isFolded ? 'Show' : 'Hide'} this category"><span class="chev ${isFolded ? 'closed' : ''}">▾</span>${esc(p.name)} <span class="faint">${p.keys.length}</span>${isFolded && busy ? '<span class="dot busy inline"></span>' : ''}</button>
          ${g ? `<button class="icon-btn sm group-menu" data-group-menu="${esc(g)}" title="Rename or remove this category">⋯</button>` : ''}
        </div>`);
      if (!isFolded) items.push(...p.keys.map(row));
    }
  }
  // Messages that match, in every chat (see searchChats).
  const hits = q.length >= 2 && state.search?.q === q ? state.search.hits : [];
  if (hits.length) items.push('<div class="contact-sep"></div><div class="hits-head">Messages</div>', ...hits.map(hitHTML));
  $('#contacts').innerHTML = items.join('') || '<div class="faint" style="padding:16px;font-size:13px">No matches</div>';
  $('.sidebar')?.classList.toggle('searching', !!q); // a wide window shows the results in place of the keys
  fitStrip();
  $$('[data-hit]').forEach((el) => (el.onclick = () => openHit(hits[Number(el.dataset.hit)])));
  $$('[data-fold]').forEach((el) => (el.onclick = () => { toggleGroupFold(el.dataset.fold || '\u0000'); renderContacts(); }));
  $$('[data-group-menu]').forEach((el) => (el.onclick = () => openGroupMenu(el.dataset.groupMenu)));
  wireDrags();
  $$('[data-contact]').forEach((el) => (el.onclick = () => {
    if (el.dataset.contact === 'chief') openChief();
    else if (el.dataset.contact === 'dashboard') setView('dashboard');
    else if (el.dataset.contact === 'rooms') setView('rooms');
    else if (el.dataset.kind === 'group') setView('group', el.dataset.contact.slice(6));
    else setView('bot', el.dataset.contact);
  }));
}


// ---------- the keypad (keypad.js, ADR 029) ----------
// Where the window is wide enough the stylesheet shows the keypad in place of the list: the Board's values and Needs
// you on top, then every page one under the other (#508), its name over its bots and groups as keys, with the list's
// own heads and lines. The chat on the right is the one open chat. Both are drawn every time; the stylesheet decides
// which is seen.

// The Chief's row, its key (Esc) and the keypad's last place: the chat with new replies, else the one its preview shows.
const openChief = () => openChiefChat((state.chats.find((c) => Unread.count(c)) || state.chats[0])?.id || null);

const keypadPages = () => Keypad.pages(state.bots, state.groups);
// A category's page folds as the list's category does (#171), with the list's folded names: folding it in one folds it
// in the other. Pinned never folds; while searching nothing is folded.
const pageFoldName = (p) => (p.kind === 'other' ? '\u0000' : p.name);
const pageFolded = (p, folded = foldedGroups()) => p.kind !== 'pinned' && !($('#contact-search')?.value || '').trim() && folded.has(pageFoldName(p));
// Every key shown in reading order, page after page, with its page and its place there: the digits count them so. A
// folded page's keys are not shown, so not counted.
const keypadKeys = (pages) => { const folded = foldedGroups(); return pages.flatMap((p, page) => (pageFolded(p, folded) ? [] : p.keys.map((x, at) => ({ x, page, at })))); };
// Which key each digit opens (Keypad.digits, #366): a bot's own hotkey, else a free digit by its place among `all`.
const keypadDigits = (pages, all) => Keypad.digits(pages, all.map((k) => k.x));
const keypadShown = () => getComputedStyle($('#keypad')).display !== 'none';
// A key's line, its class and what stands after its name: the list's; a bot that asks shows its question alone, as its
// pill says Needs you (#397).
function keyLine(x) {
  if (x.members) return groupLine(x);
  const line = botLine(x);
  return line.cls === 'asks' ? { ...line, prev: line.prev.replace(/^Asks: /, '') } : line;
}
// The colour of the dot on a page's heading: the first bot on it that asks, or the member that asks in a group.
const askColor = (x) => (keyLine(x).cls !== 'asks' ? '' : x.members ? memberColor(x.asks.botId) : x.color);
const openKey = (x) => (x.members ? setView('group', x.id) : setView('bot', x.id));
// The bots a card in Needs you waits for (needs.js): their keys say "Needs you". Kept as drawKeypadNeeds last saw them.
let keysWaiting = new Set();
// A key's status (Keypad.status, #397): its pill, the time of its last action beside it (how long it has worked, while
// it works) and whether a run is going, which draws a thin line along its foot.
function keyStatus(x) {
  if (x.members) {
    const cls = groupLine(x).cls;
    return { ...Keypad.status({ running: cls === 'working', needs: cls === 'asks', unread: Unread.count(x), last: x.last?.status ?? null }), time: shortTime(x.last?.at) };
  }
  const r = state.runs.find((y) => y.botId === x.id);
  const running = !!x.running || r?.status === 'running';
  const s = Keypad.status({ running, needs: keyLine(x).cls === 'asks' || keysWaiting.has(x.id), unread: Unread.count(x), last: r?.status ?? null });
  // How long it has worked, from the run that is going; a run not in the list yet: no time.
  return { ...s, time: running ? (r?.status === 'running' && r.startedAt ? Keypad.since(Date.now() - Date.parse(r.startedAt)) : '') : shortTime(r?.startedAt) };
}
// The pill's colour by its kind: the block kit's levels, and two of the keys' own (unread, idle).
const PILL = { working: 'info', needs: 'warn', unread: 'unread', done: 'ok', failed: 'err', idle: 'idle' };
const statusHTML = (s) => `<div class="key-status"><span class="kit-pill ${PILL[s.kind]}">${esc(s.text)}</span>${s.time ? `<span class="key-time">${esc(s.time)}</span>` : ''}</div>${s.kind === 'working' ? '<i class="key-run" aria-hidden="true"></i>' : ''}`;
// section: on a phone, the place of the key's page; there the key has no digit. digit: the key's (0: none).
// A key: its digit, the head, the name, the line and its status; the mark of a bot that asks beside its name. A pinned
// key is larger (style.css).
function keyHTML(x, i, section = null, digit = 0) {
  const group = !!x.members;
  const line = keyLine(x);
  const on = group ? state.view === 'group' && state.groupId === x.id : state.view === 'bot' && state.botId === x.id;
  const where = section === null ? `data-key="${i}"` : `data-section-key="${section}.${i}"`;
  return `<button class="key${group ? ' is-group' : ''}${on ? ' active' : ''}" ${where}${section === null ? ' draggable="true"' : ''} title="${esc(x.name)}">${section === null && digit ? `<span class="key-n">${digit}</span>` : ''}${group ? groupPicture(x) : botFigure(x.color, x.state, '', x.outfit)}<div class="grow"><div class="top"><span class="name">${esc(x.name)}</span>${line.cls === 'asks' ? line.after : ''}</div><div class="prev ${line.cls}">${line.who ? `${esc(line.who)}: ` : ''}${esc(line.prev)}</div>${statusHTML(keyStatus(x))}</div></button>`;
}
// A tile as a card of the strip over the keys (#397): the block kit's kpi with the tile's title over its first number
// (a value, a kpi, a bar or a gauge on its face) and that block's sparkline and bar; a switch says On or Off, any other
// tile its dot. Live: it is drawn again whenever the Board is read or a value arrives on the feed.
function stripKpi(t) {
  const find = (list) => { for (const b of list || []) { if (['kpi', 'value', 'progress', 'gauge'].includes(b.type)) return b; const y = b.blocks && find(b.blocks); if (y) return y; } return null; };
  const b = find(t.look?.face);
  const c = tintOf(b?.color, t);
  const num = b ? { text: b.text || '', unit: b.type === 'kpi' || b.type === 'value' ? b.unit : '', of: b.of, points: b.points, ratio: b.ratio } : t.look?.short ? { text: t.look.short } : null;
  const dot = t.look?.dot;
  const card = num ? kitKpi({ label: t.title, ...num }, c)
    : `<div class="kit-kpi"><div class="kit-kpi-main"><div class="kit-label">${esc(t.title)}</div><div class="kit-num kp-card-dot">${tileMark(t)}${dot && dot.big ? `<span>${dot.filled === true ? 'On' : dot.filled === false ? 'Off' : '·'}</span>` : ''}</div></div></div>`;
  return `<span class="kp-card">${card}</span>`;
}
// The Board's strip: one small kpi card per tile, as many as fit and the rest sideways (on a phone too). A tap, or
// Enter on it, opens the Board. A box and not a button, which would not scroll. Not there until the Board is read.
function boardLine() {
  if (!state.dash) return '';
  return `<div class="kp-board-line ${state.view === 'dashboard' ? 'active' : ''}" role="button" tabindex="0" data-board title="Board">${boardTiles().map(stripKpi).join('') || BOARD_EMPTY}</div>`;
}
// The Board's line drawn in `el`: the keypad's, or a phone's.
function drawBoardLine(el) {
  el.innerHTML = boardLine();
  $$('[data-board]', el).forEach((b) => {
    b.onclick = () => setView('dashboard');
    b.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setView('dashboard'); } };
  });
}
// The Chief of Staff's key, first on Pinned: its row in the list as a key, with Esc where a bot's key has its digit,
// and its status: Working while it replies, its new replies, else Idle, and when it last wrote.
function chiefKeyHTML() {
  const chat = state.chats[0];
  const s = { ...Keypad.status({ running: !!state.chiefBusy, unread: state.chiefUnread || 0 }), time: shortTime(chat?.updatedAt) };
  return `<button class="key key-chief${state.view === 'chief' ? ' active' : ''}" data-key-chief title="${esc(chiefName())}"><span class="key-n">Esc</span>${chiefFigure()}<div class="grow"><div class="top"><span class="name">${esc(chiefName())}</span></div><div class="prev">${esc(plain(chat?.preview) || 'Your team of bots. Ask for anything.')}</div>${statusHTML(s)}</div></button>`;
}
// Every page as a section: its heading (name, count, dot) over its keys in rows of three. Pinned is always first, right
// under the Board, set apart from the categories on a panel of its own, with the Chief's key before the pinned bots,
// also when nothing is pinned. A key's number counts
// across the pages; the last place, after the last page's keys, asks the Chief for a bot.
function drawKeypad() {
  if (!$('#keypad') || keyDrag) return; // redrawing would cancel the drag; its end draws it again
  const found = keypadPages();
  const pages = found[0]?.kind === 'pinned' ? found : [{ name: 'Pinned', kind: 'pinned', keys: [] }, ...found];
  const all = keypadKeys(pages);
  const digits = keypadDigits(pages, all);
  const keys = $('#kp-keys');
  drawBoardLine($('#kp-board'));
  const ask = '<button class="key key-ask" data-key-ask>Ask the Chief for a bot</button>';
  const keysOf = (i) => all.map((k, n) => (k.page === i ? keyHTML(k.x, n, null, Keypad.digitOf(digits, k.x)) : '')).join('');
  keys.innerHTML = pages.map((p, i) => `<section class="kp-page${i === 0 ? ' kp-pinned' : ''}${pageFolded(p) ? ' folded' : ''}"><h3 class="kp-page-head" data-page="${i}">${pageHead(p, `data-page-fold="${i}"`)}</h3><div class="kp-page-keys">${i === 0 ? chiefKeyHTML() : ''}${keysOf(i)}${i === pages.length - 1 ? ask : ''}</div></section>`).join('');
  $$('[data-key]', keys).forEach((el) => (el.onclick = () => openKey(all[Number(el.dataset.key)].x)));
  $$('[data-page-fold]', keys).forEach((el) => (el.onclick = () => foldPage(pages[Number(el.dataset.pageFold)])));
  $$('[data-key-chief]', keys).forEach((el) => (el.onclick = openChief));
  $$('[data-key-ask]', keys).forEach((el) => (el.onclick = askChief));
  wireKeyDrags(pages, all, keys);
  drawKeypadSections(found);
  if (typeof drawRoomsKeys === 'function') drawRoomsKeys(); // shared rooms, beside Needs you (rooms.js)
}
// A page's dot, on its heading on the keypad or on a phone: in the colour of the first bot on it that asks.
function pageDot(p) {
  const dot = p.keys.map(askColor).find(Boolean);
  return dot ? `<i class="kp-dot" style="--c:${Unread.tint(dot)}"></i>` : '';
}
// What a page's heading holds: its name, its count and its dot. A category's is a button that folds it (#171), with the
// list's chevron, and folded it also shows the list's busy dot while one of its bots works. `fold`: the button's data.
function pageHead(p, fold) {
  const head = `${esc(p.name)} <b>${p.keys.length}</b>${pageDot(p)}`;
  if (p.kind === 'pinned') return head;
  const folded = pageFolded(p);
  const busy = folded && p.keys.some((x) => !x.members && x.running);
  return `<button class="kp-fold" ${fold} aria-expanded="${!folded}" title="${folded ? 'Show' : 'Hide'} this category"><span class="chev${folded ? ' closed' : ''}">▾</span>${head}${busy ? '<i class="kp-busy"></i>' : ''}</button>`;
}
const foldPage = (p) => { if (p) { toggleGroupFold(pageFoldName(p)); renderContacts(); } };
// The Chief's chat, ready to write in.
const askChief = () => { openChief(); requestAnimationFrame(() => $('#view-chief textarea')?.focus()); };
// A phone's home (#498): the Board line, every page as a section of keys under its name and count, and the Chief's
// message box. A key opens its chat full screen, as a row of the list does, and Back returns here. No digits, no keys.
function drawKeypadSections(pages) {
  const sections = $('#kp-sections'), chief = $('#kp-chief');
  if (!sections) return;
  drawBoardLine($('#kp-phone-board'));
  sections.innerHTML = pages.map((p, n) => `<section class="kp-section${p.kind === 'pinned' ? ' kp-sec-pinned' : ''}${pageFolded(p) ? ' folded' : ''}" data-section="${n}"><h3 class="kp-sec-head">${pageHead(p, `data-section-fold="${n}"`)}</h3><div class="kp-sec-keys">${pageFolded(p) ? '' : p.keys.map((x, i) => keyHTML(x, i, n)).join('')}</div></section>`).join('');
  $$('[data-section-fold]', sections).forEach((el) => (el.onclick = () => foldPage(pages[Number(el.dataset.sectionFold)])));
  $$('[data-section-key]', sections).forEach((el) => (el.onclick = () => { const [n, i] = el.dataset.sectionKey.split('.').map(Number); openKey(pages[n].keys[i]); }));
  chief.innerHTML = `<span>Ask the Chief…</span>${Unread.dots(state.chiefUnread, CHIEF_COLOR)}`;
  chief.onclick = askChief;
}
// Drag a key (#499): onto another key it takes that key's place, on its page or another; onto the last place it
// goes last on the last page; onto the Chief's key it is pinned first; onto a page's heading it goes last there (Keypad.move): Pinned pins it, a category
// moves it there, Other takes it out of its category. It is saved as the list's drag saves it (pinBot, moveBot, pinGroup, moveGroup), with the same updates.
const KEY_DRAG = 'application/x-botdot-key';
let keyDrag = null; // the bot or the group whose key is dragged
function wireKeyDrags(pages, all, keys) {
  if (!pages.length) return;
  const over = (el) => (e) => {
    if (!keyDrag || !e.dataTransfer.types.includes(KEY_DRAG)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    el.classList.add('drop-on');
  };
  const leave = (el) => () => el.classList.remove('drop-on');
  const drop = (to, n) => (e) => {
    if (!keyDrag) return;
    e.preventDefault();
    const x = keyDrag;
    keyDrag = null;
    const spot = Keypad.move(pages, x, to, n);
    if (!spot) return drawKeypad();
    if ('pinned' in spot) (x.members ? pinGroup : pinBot)(x, spot.pinned);
    else (x.members ? moveGroup : moveBot)(x, spot.group, spot.order);
  };
  const target = (el, to, n) => { el.ondragover = over(el); el.ondragleave = leave(el); el.ondrop = drop(to, n); };
  $$('[data-key]', keys).forEach((el) => {
    const { x, page, at } = all[Number(el.dataset.key)];
    el.ondragstart = (e) => {
      e.dataTransfer.setData(KEY_DRAG, String(x.id));
      e.dataTransfer.effectAllowed = 'move';
      keyDrag = x;
      setTimeout(() => el.classList.add('drag-ghost')); // after the browser took its picture of the key
    };
    el.ondragend = () => { if (keyDrag) { keyDrag = null; drawKeypad(); } };
    target(el, page, at);
  });
  $$('[data-key-chief]', keys).forEach((el) => target(el, 0, 0)); // onto the Chief: pinned first, as on its row in the list
  $$('[data-key-ask]', keys).forEach((el) => target(el, pages.length - 1, pages.at(-1).keys.length));
  $$('[data-page]', keys).forEach((el) => target(el, Number(el.dataset.page)));
}
// Needs you on the keypad and on a phone (#397): one warm card, "N need you", what waits in one line, and Review,
// which opens as the banner's does. The keys of the bots `waits` holds (all that waits, also while the card is not
// shown on the Needs you page) say Needs you, so they are drawn again when those bots change.
function drawKeypadNeeds(items, review, waits = items) {
  const lines = [...new Set(items.map(needLine).filter(Boolean))];
  const html = items.length ? `<svg class="kp-needs-ico" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.01"/></svg><span class="kp-needs-text"><b>${items.length} need${items.length === 1 ? 's' : ''} you</b><span>${esc(lines.join(' · '))}</span></span><span class="kp-review">Review</span>` : '';
  for (const id of ['#kp-needs', '#kp-phone-needs']) {
    const el = $(id);
    if (!el) continue;
    el.classList.toggle('hidden', !items.length);
    el.innerHTML = html;
    el.onclick = review;
  }
  const waiting = needsBots(waits);
  if ([...waiting].join() !== [...keysWaiting].join()) { keysWaiting = waiting; renderContacts(); }
}
// Digits, Esc and Ctrl+K (Keypad.press), while the keypad is shown and no dialog is open.
function onKeypadKey(e) {
  if (e.defaultPrevented || e.isComposing || $('#modal')?.open || !keypadShown()) return;
  const t = e.target;
  const inField = !!(t?.isContentEditable || t?.matches?.('input, textarea, select'));
  const pages = keypadPages();
  const digits = keypadDigits(pages, keypadKeys(pages));
  const act = Keypad.press({ key: e.key, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey, shift: e.shiftKey, inField }, { digits });
  if (!act || (act.action === 'chief' && state.view === 'chief')) return;
  e.preventDefault();
  if (act.action === 'open') openKey(digits.get(act.digit));
  else if (act.action === 'chief') openChief();
  else if (act.action === 'search') { $('#contact-search').focus(); $('#contact-search').select(); }
}

// ---------- search in every chat ----------

// What was said in the chats, for the search box: fetched a moment after you stop typing.
let searchTimer = null;
function searchChats() {
  const q = ($('#contact-search')?.value || '').trim().toLowerCase();
  clearTimeout(searchTimer);
  if (q.length < 2) { state.search = null; return; }
  searchTimer = setTimeout(async () => {
    const hits = await api(`/search?q=${encodeURIComponent(q)}${hasGroups() ? '&groups=1' : ''}`).catch(() => []); // with the replies in the groups, for a page that draws groups
    if (($('#contact-search')?.value || '').trim().toLowerCase() !== q) return; // typed on meanwhile
    state.search = { q, hits };
    renderContacts();
  }, 250);
}

// One match: whose chat, when, and the words around it (the matched ones marked). A reply in a group says whose
// it is and in which group.
function hitHTML(h, i) {
  const who = h.chatId ? `${botLabel(CHIEF_BOT)} · ${esc(h.title)}`
    : h.group ? `${botLabel(h.bot)} · ${esc(h.group.name)}`
    : h.fromBot ? `${botLabel(h.fromBot)} → ${botLabel(h.bot)}` : botLabel(h.bot);
  const text = esc(h.snippet || '').replace(/«/g, '<mark>').replace(/»/g, '</mark>');
  return `<button class="contact hit" data-hit="${i}"><div class="grow"><div class="top"><span class="name">${who}</span><span class="time">${esc(shortTime(h.at))}</span></div><div class="prev">${text}</div></div></button>`;
}

// The words in the search box, marked in the open chat (each word, and words it starts: "haiku" marks "haikus").
function searchTerms() {
  const q = ($('#contact-search')?.value || '').trim().toLowerCase();
  if (q.length < 2) return [];
  return [...new Set(q.match(/[\p{L}\p{N}]+/gu) || [])].filter((w) => w.length > 1);
}
function markSearch() {
  const terms = searchTerms();
  for (const root of [$('#bot-thread'), $('#chat-thread'), $('#group-thread')]) {
    if (!root) continue;
    $$('mark.hl', root).forEach((m) => m.replaceWith(...m.childNodes)); // the last search's marks
    root.normalize();
    if (!terms.length) continue;
    const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${terms.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|')})[\\p{L}\\p{N}]*`, 'giu');
    const walk = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.parentElement.closest('button, textarea, input') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    const nodes = [];
    while (walk.nextNode()) { re.lastIndex = 0; if (re.test(walk.currentNode.data)) nodes.push(walk.currentNode); }
    for (const n of nodes) {
      const frag = document.createDocumentFragment();
      let last = 0;
      n.data.replace(re, (w, at) => {
        frag.append(n.data.slice(last, at));
        const m = document.createElement('mark');
        m.className = 'hl';
        m.textContent = w;
        frag.append(m);
        last = at + w.length;
        return w;
      });
      frag.append(n.data.slice(last));
      n.replaceWith(frag);
    }
  }
}

// Open the chat a match is in, at that message.
function openHit(h) {
  if (!h) return;
  state.jump = h;
  if (h.chatId) openChiefChat(h.chatId);
  else if (h.group) setView('group', h.group.id); // a reply in a group opens the group
  else setView('bot', h.bot.id);
}

// After a chat is drawn: go to the message a search match pointed at, and mark it for a moment.
function jumpTo(el) {
  state.jump = null;
  if (!el) return false;
  el.scrollIntoView({ block: 'center' });
  el.classList.add('found');
  setTimeout(() => el.classList.remove('found'), 2000);
  return true;
}

// ---------- categories (the folders of the list; `group` on a bot is the API's older name for one) ----------

const groupNames = (bots = state.bots) => [...new Set(bots.map((b) => b.group).filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
function foldedGroups() {
  try { return new Set(JSON.parse(localStorage.getItem('botdot.groups.folded') || '[]')); } catch { return new Set(); }
}
function toggleGroupFold(g) {
  const f = foldedGroups();
  f.has(g) ? f.delete(g) : f.add(g);
  try { localStorage.setItem('botdot.groups.folded', JSON.stringify([...f])); } catch { /* private mode */ }
}

// The order you gave the bots: pinned ones by `pinned`, the rest by `order` in their group (A–Z before the first move, like the server).
const byPlace = Keypad.byPlace; // the keypad's pages and this list share it (keypad.js)
const inGroup = (g) => state.bots.filter((b) => !(b.pinned > 0) && (b.group || '') === g).sort(byPlace);
const placeOf = (bot) => inGroup(bot.group || '').indexOf(bot) + 1;

// Drag a bot or a group anywhere in the list: a gap opens where it would land, among the pinned ones or in a
// category (its heading = first there). Dropping it there pins, reorders or moves it to that category. The pinned
// bots and groups share one order (#276), so there it lands right where it is dropped. In a category a group's
// place is counted among the groups (docs/api.md, Groups): it lands among the groups there, after the bots, and a
// bot lands among the bots, before the groups.
const BOT_DRAG = 'application/x-botdot-bot';
let dragId = null; // the row being dragged, by its `data-contact`: a bot's id, or "group:<id>" (dragover can't read the drag's data)
const draggedGroup = () => (String(dragId || '').startsWith('group:') ? groupById(dragId.slice(6)) : null);
const dragged = () => draggedGroup() || state.bots.find((b) => b.id === dragId) || null;
// Where what is dragged stands now: its category, and its place there among its own kind.
const draggedIn = (x) => (x.members ? x.category : x.group) || '';
const draggedPlace = (x) => (x.members ? groupsIn(draggedIn(x)).indexOf(x) + 1 : placeOf(x));
// The last bot's row in a category: the groups there stand after it.
const lastBotRow = (cat) => $$(`#contacts [data-contact]:not([data-kind="group"])[data-group="${CSS.escape(cat)}"]`).pop() || null;
function wireDrags() {
  $$('#contacts [data-contact]:not([data-contact="chief"]):not([data-contact="dashboard"]):not([data-contact="rooms"])').forEach((el) => {
    el.ondragstart = (e) => {
      e.dataTransfer.setData(BOT_DRAG, el.dataset.contact);
      e.dataTransfer.effectAllowed = 'move';
      dragId = el.dataset.contact;
      $('#contacts').classList.add('dragging');
      setTimeout(() => el.classList.add('drag-ghost')); // after the browser took its picture of the row
    };
    el.ondragend = () => {
      dragId = null;
      closeGap();
      el.classList.remove('drag-ghost');
      $('#contacts').classList.remove('dragging');
      renderContacts();
    };
  });
  $$('#contacts [data-contact]:not([data-contact="dashboard"]):not([data-contact="rooms"]), #contacts [data-group-head]').forEach((el) => {
    el.ondragover = (e) => {
      if (!e.dataTransfer.types.includes(BOT_DRAG)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const d = el.dataset;
      const group = !!draggedGroup();
      const cat = d.contact === 'chief' || d.pin ? null : 'groupHead' in d ? d.groupHead : d.group;
      // In a category, over a row of the other kind: a group goes first among the groups there, a bot last among
      // the bots, and the gap opens between the two. Among the pinned ones either kind lands where it is dropped.
      if (cat !== null && d.contact && group !== (d.kind === 'group')) {
        const at = group ? 1 : inGroup(cat).length + 1;
        return openGap({ group: cat, order: at }, lastBotRow(cat) || $(`#contacts [data-group-head="${CSS.escape(cat)}"]`) || el, false);
      }
      // Above or below the row under the pointer (always below the Chief and a heading).
      const above = d.contact && d.contact !== 'chief' && e.clientY < el.getBoundingClientRect().top + el.offsetHeight / 2;
      const spot = d.contact === 'chief' ? { pinned: 1 }
        : 'groupHead' in d ? { group: d.groupHead, order: 1 }
        : d.pin ? { pinned: Number(d.pin) + (above ? 0 : 1) }
        : { group: d.group, order: Number(d.place) + (above ? 0 : 1) };
      // A group dropped on a heading is the first group there: after the bots that are drawn. On the Chief it is
      // pinned first, right below it.
      openGap(spot, (group && cat !== null && !d.kind && lastBotRow(cat)) || el, above);
    };
    el.ondrop = (e) => dropAt(e, gapSpot);
  });
}

// The gap that opens where the dragged row would land. spot: { pinned: n } (1 = first), counted among the pinned
// bots and groups together, or { group, order: n }, counted among its own kind. `group` there is a category, by the name a bot's field has in the API.
let gapSpot = null;
const sameSpot = (a, b) => !!a && !!b && a.pinned === b.pinned && a.group === b.group && a.order === b.order;
function openGap(spot, el, above) {
  const row = dragged(); // a bot, or a group
  if (!row) return;
  // Right where it is already: nothing to show.
  const stays = spot.pinned ? row.pinned > 0 && (spot.pinned === row.pinned || spot.pinned === row.pinned + 1)
    : !(row.pinned > 0) && draggedIn(row) === spot.group && (spot.order === draggedPlace(row) || spot.order === draggedPlace(row) + 1);
  if (stays) return closeGap();
  if (sameSpot(spot, gapSpot)) return;
  closeGap();
  gapSpot = spot;
  const gap = document.createElement('div');
  gap.className = 'drop-gap';
  gap.style.setProperty('--h', `${$(`#contacts [data-contact="${CSS.escape(dragId)}"]`)?.offsetHeight || 60}px`);
  gap.ondragover = (e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; };
  gap.ondrop = (e) => dropAt(e, spot);
  above ? el.before(gap) : el.after(gap);
  requestAnimationFrame(() => gap.classList.add('open'));
}
function closeGap() {
  gapSpot = null;
  $$('#contacts .drop-gap:not(.closing)').forEach((g) => {
    g.classList.add('closing');
    g.classList.remove('open');
    setTimeout(() => g.remove(), reducedMotion() ? 0 : 200);
  });
}
function dropAt(e, spot) {
  e.preventDefault();
  const row = dragged(); // a bot, or a group
  $('#contacts').classList.remove('dragging');
  if (!row || !spot) return closeGap();
  const isGroup = !!row.members; // a group is placed by its own route (groups.js)
  if (spot.pinned) return (isGroup ? pinGroup : pinBot)(row, spot.pinned - (row.pinned > 0 && row.pinned < spot.pinned ? 1 : 0)); // it leaves its own place first
  const own = !(row.pinned > 0) && draggedIn(row) === spot.group ? draggedPlace(row) : 0;
  (isGroup ? moveGroup : moveBot)(row, spot.group, spot.order - (own && own < spot.order ? 1 : 0));
}

// Unpinned ones get a place in their group back, as the server gives it.
function renumberGroup(g) { inGroup(g).forEach((b, i) => { b.order = i + 1; }); }

// Pin a bot at a place below the Chief (1 = first; 0 = unpin: last in its group), the other pinned bots and groups
// making room.
async function pinBot(bot, at) {
  if (bot.pinned === at) return renderContacts();
  const was = bot.pinned;
  Keypad.pin(state.bots, state.groups, bot, at);
  if (at > 0) { bot.order = 0; renumberGroup(bot.group || ''); } else if (was > 0) { bot.order = Infinity; renumberGroup(bot.group || ''); }
  renderContacts(); // right away; the save follows
  try { await api(`/bots/${bot.id}`, { method: 'PUT', body: { pinned: at } }); } catch (err) { toast(err.message, true); }
  refresh();
}

// Put a bot at a place in a group (1 = first), moving it there from another group or from the pinned ones.
async function moveBot(bot, group, at) {
  const from = bot.group || '';
  const wasPinned = bot.pinned > 0;
  if (wasPinned) Keypad.pin(state.bots, state.groups, bot, 0);
  const others = inGroup(group).filter((b) => b !== bot);
  others.splice(Math.min(at, others.length + 1) - 1, 0, bot);
  bot.group = group;
  others.forEach((b, i) => { b.order = i + 1; });
  if (from !== group) renumberGroup(from);
  renderContacts(); // right away; the save follows
  try {
    await api(`/bots/${bot.id}`, { method: 'PUT', body: { group, order: at, ...(wasPinned ? { pinned: 0 } : {}) } });
    if (from !== group) toast(group ? `${bot.name} moved to ${group}` : `${bot.name} moved to Other`);
  } catch (err) { toast(err.message, true); }
  refresh();
}

// Chips for picking a bot's category: None, the existing ones, and "+ New category" (typed in place). onChange: after a pick.
function groupPicker(box, input, onChange) {
  const typed = new Set(); // new names typed here stay available while the form is open
  const draw = (adding = false) => {
    if (input.value) typed.add(input.value);
    const names = [...new Set([...groupNames(), ...typed].filter(Boolean))].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    box.innerHTML = [
      `<button type="button" class="gchip ${!input.value ? 'on' : ''}" data-g="">None</button>`,
      ...names.map((g) => `<button type="button" class="gchip ${input.value === g ? 'on' : ''}" data-g="${esc(g)}">${esc(g)}</button>`),
      adding ? '<input type="text" class="gchip-input" maxlength="40" placeholder="Category name" aria-label="New category name">' : '<button type="button" class="gchip add" data-new>＋ New category</button>',
    ].join('');
    $$('[data-g]', box).forEach((c) => (c.onclick = () => { input.value = c.dataset.g; draw(); onChange?.(); }));
    const add = $('[data-new]', box);
    if (add) add.onclick = () => draw(true);
    const field = $('.gchip-input', box);
    if (field) {
      field.focus();
      const done = (keep) => {
        const v = field.value.replace(/\s+/g, ' ').trim();
        if (keep && v) input.value = names.find((n) => n.toLowerCase() === v.toLowerCase()) || v;
        draw();
        if (keep && v) onChange?.();
      };
      field.onkeydown = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); done(true); }
        if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(false); }
      };
      field.onblur = () => done(true);
    }
  };
  draw();
}

function openGroupMenu(group) {
  const members = [...state.bots.filter((b) => b.group === group), ...state.groups.filter((g) => g.category === group)];
  const m = openModal(`
    <form id="group-form" autocomplete="off">
      <div class="modal-head"><h2>Category: ${esc(group)}</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
      <div class="modal-body">
        <label class="field">Name<input type="text" name="name" value="${esc(group)}" maxlength="40" required></label>
        <div class="muted" style="font-size:12.5px">${members.map((b) => (b.members ? esc(b.name) : botLabel(b))).join(', ')}</div>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn danger left" id="group-remove">Remove category</button>
        <button type="button" class="btn" data-dismiss>Cancel</button>
        <button class="btn primary">Rename</button>
      </div>
    </form>`);
  const rename = async (to, msg) => {
    try { await api('/groups/rename', { method: 'POST', body: { from: group, to } }); m.close(); toast(msg); await refresh(); } catch (e) { toast(e.message, true); }
  };
  $('#group-form', m).onsubmit = (e) => { e.preventDefault(); const to = e.target.name.value.trim(); if (to && to !== group) rename(to, `Renamed to ${to}`); else m.close(); };
  $('#group-remove', m).onclick = () => rename('', 'Category removed'); // no question: its bots and groups move to Other, and a category is made again by naming it
}
