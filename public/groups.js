// Groups on the web page (Milestone 10; docs/api.md, "Groups"). A group is one chat with two to six bots, its
// members: the owner writes once, the botdot server gives the turns, and every reply stands under its bot's name.
// This file draws what the server says and decides nothing: the group's row in the list, its chat, its panel,
// and the picker that makes one from a bot's chat. Against a server without `groups` in `features` there are no
// groups and nothing here is offered.
// Loaded after app.js, whose helpers it uses (api, state, esc, botById, the message box, the cards, the "New"
// line); app.js calls the functions of this file where a group takes part: the list, the views, the feed.

// ---------- what the server says ----------

const hasGroups = () => state.features.includes('groups');
const groupById = (id) => state.groups.find((g) => g.id === id) || null;
// Its members that exist, in the group's order.
const groupMembers = (g) => (Array.isArray(g?.members) ? g.members : []).map(botById).filter(Boolean);
// Every group, each with what its chat holds now. A list that could not be read leaves the one the page has.
function loadGroups() {
  if (!hasGroups()) { state.groupsKnown = true; return Promise.resolve([]); }
  return api('/group-chats').then((list) => { state.groupsKnown = true; return Array.isArray(list) ? list.filter((g) => g && typeof g.id === 'string') : []; }).catch(() => state.groups);
}
// A member's name and colour now, or as the server said them for a bot that is gone.
const memberName = (botId, said = '') => botById(botId)?.name || said || 'A bot';
const memberColor = (botId, said = '') => botById(botId)?.color || said || '#888780';

// The line of each member at work, by its run: { groupId, botId, text, held, works }. The feed says it
// (`group_working_line`, `group_opening_line`, `group_run_waits`), and the chat's `working` when it is read; a
// run's end takes it away. With `working-line` in the server's `features` a turn's line is its working line
// (docs/api.md, "The working line"): the server's words for what the member is doing now, drawn as they come.
// The page has no words of its own for a step. `works`: this turn has a working line, so its opening line, which
// the server sends as before, is not drawn in its place. Until then, and against a server that sends a turn no
// working line, the line is the opening line.
const turnLines = new Map();
function sayTurnLine(runId, groupId, botId, more) {
  if (!runId) return;
  turnLines.set(runId, { text: '', held: false, works: false, ...(turnLines.get(runId) || {}), groupId, botId, ...more });
}
const turnLineOf = (groupId, botId) => [...turnLines.values()].find((l) => l.groupId === groupId && l.botId === botId)?.text || '';

// ---------- the list ----------

// A group's place is counted among the groups only (docs/api.md, Groups): the pinned ones in the order of
// `pinned`, a category's in the order of `order`.
const pinnedGroups = (list = state.groups) => list.filter((g) => g.pinned > 0).sort(Keypad.byPin);
const groupsIn = (category, list = state.groups) => list.filter((g) => !(g.pinned > 0) && (g.category || '') === category).sort(byPlace);
// The categories of the list, A–Z: those of the bots and those of the groups. A category can hold groups and no bot.
const categoryNames = Keypad.categoryNames;
// What the search box finds a group by: its name, its category and its members' names.
const groupSearchText = (g) => `${g.name} ${g.category || ''} ${groupMembers(g).map((b) => b.name).join(' ')}`.toLowerCase();

// The picture of a group: its members' heads, the first three, each with the face of its state.
function groupPicture(g, size = '') {
  const heads = groupMembers(g).slice(0, 3).map((b) => `<i>${Figure.svg(b.state || 'idle', b.color, b.outfit)}</i>`);
  if (!heads.length) heads.push(`<i>${Figure.svg('idle', '#888780', null)}</i>`); // its bots are all gone
  return `<div class="group-pic ${size} n${heads.length}">${heads.join('')}</div>`;
}
// What the picture is drawn from: it is drawn again when a member, its state, colour or hat changes.
const groupLook = (g) => JSON.stringify(groupMembers(g).slice(0, 3).map((b) => [b.id, b.state, b.color, b.outfit || null]));

// A group's row in the list: the line under its name, the class that colours it, and what stands after its time.
// While a member works: who, and what it says it is doing. Else "… asks" when a member asks the owner something,
// with the mark in place of the dots. Else its newest reply, with the bot's name before it.
function groupLine(g) {
  const at = (Array.isArray(g.working) ? g.working : []).map(botById).find(Boolean);
  const dots = Unread.dots(Unread.count(g), memberColor(g.last?.botId, groupMembers(g)[0]?.color));
  if (at) return { who: at.name, prev: `${turnLineOf(g.id, at.id) || 'Working'}…`, cls: 'working', after: dots };
  if (g.asks && typeof g.asks === 'object') {
    const text = typeof g.asks.text === 'string' ? plain(g.asks.text) : '';
    return { who: '', prev: `${memberName(g.asks.botId, g.asks.botName)} asks${text ? `: ${text}` : ''}`, cls: 'asks', after: Unread.mark(memberColor(g.asks.botId)) };
  }
  if (g.last && typeof g.last === 'object') return { who: memberName(g.last.botId, g.last.botName), prev: plain(g.last.text) || (g.last.status === 'success' ? 'Done.' : "Couldn't finish"), cls: '', after: dots };
  return { who: '', prev: 'No messages yet', cls: '', after: dots };
}
function groupContactHTML(g) {
  const line = groupLine(g);
  const place = g.pinned > 0 ? `data-pin="${g.pinned}"` : `data-group="${esc(g.category || '')}" data-place="${groupsIn(g.category || '').indexOf(g) + 1}"`;
  return `
      <button class="contact ${state.view === 'group' && state.groupId === g.id ? 'active' : ''}" data-contact="group:${esc(g.id)}" data-kind="group" ${place} draggable="true" title="${esc(g.name)}">
        ${groupPicture(g)}
        <div class="grow"><div class="top"><span class="name">${esc(g.name)}</span><span class="time">${esc(shortTime(g.last?.at))}</span>${line.after}</div>
        <div class="prev ${line.cls}">${line.who ? `<span class="who">${esc(line.who)}:</span> ` : ''}${esc(line.prev)}</div></div>
      </button>`;
}

// A group dragged in the list: shown where it lands right away, then saved; the list is read again either way.
async function placeGroup(g, body, said = '') {
  renderContacts();
  try {
    await api(`/group-chats/${encodeURIComponent(g.id)}`, { method: 'PUT', body });
    if (said) toast(said);
  } catch (e) { toast(e.message, true); }
  refresh();
}
// Pin a group at a place among the pinned groups (1 = first), the others making room.
function pinGroup(g, at) {
  if (g.pinned === at) return renderContacts();
  const from = g.category || '';
  const others = pinnedGroups().filter((x) => x !== g);
  others.splice(Math.min(at, others.length + 1) - 1, 0, g);
  others.forEach((x, i) => { x.pinned = i + 1; });
  g.order = 0;
  groupsIn(from).forEach((x, i) => { x.order = i + 1; });
  return placeGroup(g, { pinned: at });
}
// Put a group at a place among the groups of a category (1 = first), from another category or from the pinned ones.
function moveGroup(g, category, at) {
  const from = g.category || '';
  const wasPinned = g.pinned > 0;
  if (wasPinned) { g.pinned = 0; pinnedGroups().forEach((x, i) => { x.pinned = i + 1; }); }
  const others = groupsIn(category).filter((x) => x !== g);
  others.splice(Math.min(at, others.length + 1) - 1, 0, g);
  g.category = category;
  others.forEach((x, i) => { x.order = i + 1; });
  if (from !== category) groupsIn(from).forEach((x, i) => { x.order = i + 1; });
  return placeGroup(g, { category, order: at, ...(wasPinned ? { pinned: 0 } : {}) }, from !== category ? `${g.name} moved to ${category || 'Other'}` : '');
}

// ---------- making and changing a group ----------

const GROUP_MAX = 6; // a group has two to six bots; the server refuses anything else in its own words
// "Add a bot to this chat" is offered where a group can be made: the server has groups, and there is another bot.
const canMakeGroup = (bot) => hasGroups() && state.bots.some((b) => b.id !== bot.id);

// The picker of bots, in the page's dialog: rows to tick, at most `max`, and with `name` a name to give.
// done(picked, name) saves and rejects with the server's sentence, which is then shown here, with nothing lost.
function openBotPicker({ title, bots, max, name = null, hint, action, done }) {
  const m = openModal(`
    <form id="bot-picker" autocomplete="off">
      <div class="modal-head"><h2>${esc(title)}</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
      <div class="modal-body">
        ${name === null ? '' : `<label class="field">Name<input type="text" name="name" maxlength="60" value="${esc(name)}" placeholder="What the group is called"></label>`}
        <div class="pick-bots">${bots.map((b) => `
          <button type="button" class="pick-bot" data-pick="${esc(b.id)}" aria-pressed="false">
            ${botFigure(b.color, 'idle', 'sm', b.outfit)}
            <span class="grow"><b>${esc(b.name)}</b>${b.description ? `<span class="faint">${esc(b.description)}</span>` : ''}</span>
            <i class="tick" aria-hidden="true"></i>
          </button>`).join('')}</div>
        <div class="faint pick-hint"></div>
        <div class="send-note hidden" role="alert"></div>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn" data-dismiss>Cancel</button>
        <button class="btn primary" disabled>${esc(action)}</button>
      </div>
    </form>`);
  const form = $('#bot-picker', m);
  const picked = []; // in the order they were ticked: the group's order
  const draw = () => {
    $$('[data-pick]', form).forEach((row) => {
      const on = picked.includes(row.dataset.pick);
      row.setAttribute('aria-pressed', String(on));
      row.disabled = !on && picked.length >= max; // full: nothing more can be ticked
    });
    $('.pick-hint', form).textContent = hint(picked.length);
    $('.btn.primary', form).disabled = !picked.length;
  };
  $$('[data-pick]', form).forEach((row) => (row.onclick = () => {
    const at = picked.indexOf(row.dataset.pick);
    if (at >= 0) picked.splice(at, 1); else if (picked.length < max) picked.push(row.dataset.pick);
    draw();
  }));
  form.onsubmit = async (e) => {
    e.preventDefault();
    const button = $('.btn.primary', form);
    if (button.disabled) return;
    button.disabled = true;
    showBoxNote(form, '');
    try { await done([...picked], name === null ? '' : form.name.value); m.close(); } catch (err) { showBoxNote(form, err.message); button.disabled = false; }
  };
  draw();
  return m;
}

// "Add a bot to this chat", the small plus right of the name in a bot's chat: a new group of that bot and those
// picked, one to five, with the name given. The bot's own chat stays as it is. The new group is in the list, in
// that bot's category, and open.
function openGroupMaker(bot) {
  openBotPicker({
    title: 'New group',
    name: '',
    bots: state.bots.filter((b) => b.id !== bot.id).sort((x, y) => ((y.group || '') === (bot.group || '')) - ((x.group || '') === (bot.group || '')) || byPlace(x, y)), // its category's bots first
    max: GROUP_MAX - 1,
    action: 'Create',
    hint: (n) => (n ? `${n + 1} bots in the group, with ${bot.name}.` : `Pick one to five bots to join ${bot.name}. Its own chat stays as it is.`),
    done: async (picked, name) => {
      const made = await api('/group-chats', { method: 'POST', body: { name, members: [bot.id, ...picked] } });
      await refresh();
      if (made?.id && groupById(made.id)) setView('group', made.id);
    },
  });
}

// A change to the open group, saved at once. What the server refuses is said in its words.
async function changeGroup(g, body) {
  try { await api(`/group-chats/${encodeURIComponent(g.id)}`, { method: 'PUT', body }); } catch (e) { toast(e.message, true); }
  await refresh();
}

// The group's panel, opened from the chat's title: its name, its members each with a way to take it out, "Add a
// bot", and "Delete this group", which deletes no bot. Every change saves by itself.
function renderGroupSettings() {
  const root = $('#view-groupsettings');
  const g = groupById(state.groupId);
  if (!root || !g) return;
  if (root.dataset.group !== g.id || !$('#gs-name', root)) {
    root.dataset.group = g.id;
    delete root.dataset.sig;
    root.innerHTML = `
      <div class="group-panel">
        <div id="gs-pic"></div>
        <label class="field">Name<input type="text" id="gs-name" maxlength="60" autocomplete="off"></label>
        <div class="card settings-card">
          <h3 class="page-sub" style="margin-top:0">Members</h3>
          <div id="gs-members"></div>
          <div><button type="button" class="btn sm" id="gs-add">＋ Add a bot</button></div>
        </div>
        <div class="bs-foot"><button type="button" class="btn danger" id="gs-delete">Delete this group</button>
          <p class="faint gs-note">Its chat is erased. No bot is deleted.</p></div>
      </div>`;
    const name = $('#gs-name', root);
    name.value = g.name;
    name.onkeydown = (e) => { if (e.key === 'Enter') { e.preventDefault(); name.blur(); } };
    name.onchange = () => {
      const now = groupById(root.dataset.group);
      const to = name.value.replace(/\s+/g, ' ').trim();
      if (!now || to === now.name) return;
      if (!to) { name.value = now.name; return; } // a group has a name: an emptied box takes the old one back
      changeGroup(now, { name: to });
    };
    $('#gs-add', root).onclick = () => {
      const now = groupById(root.dataset.group);
      if (!now) return;
      openBotPicker({
        title: 'Add a bot',
        bots: state.bots.filter((b) => !now.members.includes(b.id)).sort(byPlace),
        max: GROUP_MAX - now.members.length,
        action: 'Add',
        hint: (n) => (n ? `${now.members.length + n} bots in ${now.name}.` : 'A group has two to six bots.'),
        done: async (picked) => { await api(`/group-chats/${encodeURIComponent(now.id)}`, { method: 'PUT', body: { members: [...now.members, ...picked] } }); await refresh(); },
      });
    };
    $('#gs-delete', root).onclick = async () => {
      const now = groupById(root.dataset.group);
      if (!now || !confirm(`Delete the group ${now.name}?\n\nIts chat is erased. No bot is deleted: each keeps its own chat.`)) return;
      try { await api(`/group-chats/${encodeURIComponent(now.id)}`, { method: 'DELETE' }); toast(`${now.name} deleted`); } catch (e) { toast(e.message, true); return; }
      state.groups = state.groups.filter((x) => x.id !== now.id);
      leaveBot();
      refresh();
    };
  }
  const name = $('#gs-name', root);
  if (document.activeElement !== name && name.value !== g.name) name.value = g.name; // renamed elsewhere; not under the cursor
  const members = groupMembers(g);
  const sig = JSON.stringify([members.map((b) => [b.id, b.name, b.color, b.state, b.outfit || null]), state.bots.length]);
  if (root.dataset.sig === sig) return;
  root.dataset.sig = sig;
  $('#gs-pic', root).innerHTML = groupPicture(g, 'lg');
  $('#gs-members', root).innerHTML = members.map((b) => `
    <div class="member-row">${botFigure(b.color, b.state, 'sm', b.outfit)}<span class="grow">${esc(b.name)}</span>
      <button type="button" class="icon-btn sm" data-take-out="${esc(b.id)}" title="Take ${esc(b.name)} out of the group" aria-label="Take ${esc(b.name)} out of the group">✕</button></div>`).join('')
    || '<p class="faint">Its bots are all gone. Add one, or delete the group.</p>';
  $$('[data-take-out]', root).forEach((b) => (b.onclick = () => {
    const now = groupById(root.dataset.group);
    if (now) changeGroup(now, { members: now.members.filter((id) => id !== b.dataset.takeOut) });
  }));
  // Nothing to add: the group is full, or every bot is in it.
  $('#gs-add', root).classList.toggle('hidden', g.members.length >= GROUP_MAX || !state.bots.some((b) => !g.members.includes(b.id)));
}

// ---------- a group's chat ----------

// The chat that is open, as the server handed it out (GET /api/group-chats/:id/chat): the owner's messages and
// the replies by their id, the members at work, the open question and the stopped line. The page keeps none of
// its own: what the owner sends is drawn from the server's answer.
let groupChat = null; // { id, items: Map, more, working, asks, limit, loaded, want }
const GROUP_PAGE = 50;
const GROUP_REACH = 200; // the most one request reads: for a "New" line or a search match further back
const itemOrder = (a, b) => String(a.at).localeCompare(String(b.at)) || (a.type === b.type ? String(a.id).localeCompare(String(b.id)) : a.type === 'message' ? -1 : 1);
const chatItems = (chat) => [...chat.items.values()].sort(itemOrder);

// A page of the chat into what the page holds. The newest page says what is there now: an item it no longer has,
// from where it begins, is gone (a message taken back in another app). An older page only adds.
function takeGroupPage(chat, page, older = false) {
  const items = (Array.isArray(page?.items) ? page.items : []).filter((x) => x && typeof x.id === 'string' && (x.type === 'message' || (x.type === 'reply' && x.run)));
  if (!older) {
    const from = items[0]?.at;
    const ids = new Set(items.map((x) => x.id));
    for (const [id, x] of chat.items) if (!ids.has(id) && (!from || String(x.at) >= String(from))) chat.items.delete(id);
    const reaches = [...chat.items.values()].some((x) => from && String(x.at) < String(from)); // older pages are held: they say whether more is left
    if (!reaches) chat.more = page?.more === true;
    chat.working = (Array.isArray(page?.working) ? page.working : []).filter((w) => w && typeof w.botId === 'string');
    chat.asks = page?.asks && typeof page.asks === 'object' ? page.asks : null;
    chat.limit = page?.limit && typeof page.limit === 'object' ? page.limit : null;
    for (const w of chat.working) {
      const now = OpeningLine.follows(state.features) ? OpeningLine.text(w.workingLine) : '';
      if (now) sayTurnLine(w.runId, chat.id, w.botId, { text: now, works: true });
      else if (OpeningLine.text(w.openingLine) && !turnLines.get(w.runId)?.works) sayTurnLine(w.runId, chat.id, w.botId, { text: OpeningLine.text(w.openingLine) });
    }
  } else chat.more = page?.more === true;
  for (const x of items) chat.items.set(x.id, x);
  chat.loaded = true;
}
// A message of the owner's as the feed or an answer hands it to the page: kept when the page holds it already, or
// when it belongs to what the page holds. One from further back than that is left to the page that reads it:
// held alone, it would stand above replies that are not read yet, and "Earlier messages" would start from it.
function holdMessage(chat, m) {
  if (!m || typeof m.id !== 'string') return false;
  const oldest = chatItems(chat)[0];
  if (!chat.items.has(m.id) && chat.more && !(oldest && String(m.at) >= String(oldest.at))) return false;
  chat.items.set(m.id, { type: 'message', ...m });
  return true;
}
// Read the open group's chat (again). want: read this many of the newest, when more than the usual page.
async function loadGroupChat(id, want = 0) {
  if (!hasGroups() || !id) return;
  if (!groupChat || groupChat.id !== id) groupChat = { id, items: new Map(), more: false, working: [], asks: null, limit: null, loaded: false, want: GROUP_PAGE, asked: 0, taken: 0 };
  const chat = groupChat;
  chat.want = Math.min(Math.max(chat.want, want), GROUP_REACH);
  const mine = ++chat.asked;
  let page;
  try { page = await api(`/group-chats/${encodeURIComponent(id)}/chat?limit=${chat.want}`); } catch { return; } // away: the standing line says it
  if (groupChat !== chat || mine < chat.taken) return; // the chat was left, or a later answer is drawn already
  chat.taken = mine;
  takeGroupPage(chat, page);
  redrawGroup(id);
}
// The page before the oldest item held, put above it without moving what is on screen.
async function loadEarlier(button) {
  const chat = groupChat;
  const oldest = chat && chatItems(chat)[0];
  if (!oldest) return;
  if (button) button.disabled = true;
  let page;
  try { page = await api(`/group-chats/${encodeURIComponent(chat.id)}/chat?limit=${GROUP_PAGE}&before=${encodeURIComponent(oldest.id)}`); } catch (e) { toast(e.message, true); if (button) button.disabled = false; return; }
  if (groupChat !== chat) return;
  takeGroupPage(chat, page, true);
  const thread = $('#group-thread');
  const below = thread ? thread.scrollHeight - thread.scrollTop : 0;
  redrawGroup(chat.id);
  if (thread) thread.scrollTop = thread.scrollHeight - below;
}

// "Coder", "Coder and Reviewer", "Coder, Reviewer and Issue Writer".
const namesList = (names) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] || '');
// A message of the owner's waits for busy members: for whom. '' when it waits for nobody.
function waitsLine(m) {
  const names = (Array.isArray(m.waitsFor) ? m.waitsFor : []).map((id) => memberName(id));
  return names.length ? `Waits until ${namesList(names)} ${names.length > 1 ? 'are' : 'is'} free` : '';
}
// A message none of whose turns has started, and that waits: for a busy member, or for Claude to be signed in.
// It is drawn at the end of the chat, faded, with "Take back", as a waiting message in a bot's chat is.
const waitsWhole = (m) => m.canTakeBack === true && (!!waitsLine(m) || signedOut.on);

// One message of the owner's in its place in the chat. A message whose first turns went and that still waits for
// a busy member says for whom, under it.
function groupMessageHTML(m, chat) {
  const text = typeof m.text === 'string' ? m.text : '';
  const waits = waitsLine(m);
  return `<div class="bubble-row from-me" data-gmsg="${esc(m.id)}"><div class="stack mine">
    <div class="bubble from-me" data-expand><div class="clamp">${escMentions(text, chat)}</div>${filesHTML(Array.isArray(m.attachments) ? m.attachments : [])}</div>
    <div class="bubble-meta">${waits ? `<span>${esc(waits)}</span>` : ''}${text ? copyBtn(text) : ''}</div>
  </div></div>`;
}
// One waiting message, at the end of the chat: the owner's bubble, faded, for whom it waits, and the way back.
function groupWaitingHTML(m, chat) {
  const text = typeof m.text === 'string' ? m.text : '';
  return `<div class="bubble-row from-me"><div class="stack mine">
    <div class="bubble from-me waits">${escMentions(text, chat)}${filesHTML(Array.isArray(m.attachments) ? m.attachments : [])}</div>
    <div class="bubble-meta"><span>${esc(waitsLine(m) || 'Waits until Claude is signed in')}</span><button type="button" data-take-back="${esc(m.id)}">Take back</button></div>
  </div></div>`;
}
// One reply: its bot's head beside it and its bot's name above it, in the bot's colour. A reply that failed, was
// stopped or was cut says so under the same name. The answer buttons of the group's open question stand under
// the reply that asked (asks: that run's id).
function groupReplyHTML(r, asks = null) {
  const failed = ['error', 'stopped', 'interrupted'].includes(r.status);
  const body = failed ? r.problem || friendlyProblem(r, r.result) : r.result || 'Done. (No written reply.)';
  const color = memberColor(r.botId, r.botColor);
  const bot = botById(r.botId);
  const meta = [msgTime(r.endedAt || r.startedAt), r.durationMs != null ? dur(r.durationMs) : null].filter(Boolean);
  return `<div class="bubble-row from-bot g-row" data-reply="${esc(r.id)}">
    ${botFigure(color, r.status === 'error' ? 'failed' : 'idle', 'g-head', bot?.outfit || null, bot?.id || '')}
    <div class="stack">
      <div class="g-name" style="--c:${Unread.tint(color)}">${esc(memberName(r.botId, r.botName))}</div>
      <div class="bubble from-bot ${failed ? 'problem' : ''}"><div class="md">${md(body)}</div>${botFilesHTML(r.files)}</div>
      ${learnedChips(r)}
      <div class="bubble-meta">${meta.map(esc).join(' · ')} · <button data-details="${esc(r.id)}">Details</button>${copyBtn(body)}</div>
      ${asks === r.id && !failed ? choicesHTML(r.choices) + questionsHTML(r.questions) : ''}
    </div></div>`;
}
// A group with no message yet: its members, and that all of them read what is written there.
function groupEmptyHTML(g) {
  const names = groupMembers(g).map((b) => b.name);
  return `<div class="chat-empty">
    ${groupPicture(g, 'lg')}
    <h3>${esc(g.name)}</h3>
    <p class="muted">${names.length ? `${esc(namesList(names))}.<br>What you write here, all of them read.` : 'Its bots are all gone. Add one, or delete the group.'}</p>
  </div>`;
}
// The chat's rows, oldest first: the owner's messages and the replies, with the "New" line above the first new
// reply (newFirst: that run's id). The messages that wait whole are not among them: they stand at the end.
function groupThreadHTML(g, chat, newFirst = null) {
  const key = `group:${g.id}`;
  const rows = chatItems(chat).filter((x) => x.type !== 'message' || !waitsWhole(x));
  if (!rows.length && !chatItems(chat).length) return groupEmptyHTML(g);
  let lastDay = '';
  return (chat.more ? '<div class="g-earlier"><button type="button" class="btn sm" data-earlier>Earlier messages</button></div>' : '') + rows.map((x) => {
    const day = new Date(x.at).toDateString();
    const sep = day !== lastDay ? `<div class="day">${esc(new Date(x.at).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }))}</div>` : '';
    lastDay = day;
    if (x.type === 'message') return sep + groupMessageHTML(x, key);
    return sep + (newFirst !== null && x.id === newFirst ? Unread.line(memberColor(x.run.botId, x.run.botColor)) : '') + groupReplyHTML(x.run, chat.asks?.runId || null);
  }).join('');
}

// The end of the chat, under the last reply: the line that the group stopped at the limit, with "Go on"; one line
// per member at work, with its name and what it says it is doing, and one "Stop all"; the heads of who is next; then
// the messages that wait.
// The cards stand after it (updateChatNeeds).
function groupLimitHTML(limit) {
  const text = typeof limit?.text === 'string' ? limit.text.trim() : '';
  return limit ? `<div class="g-limit" role="status"><span>${esc(text || 'The group stopped.')}</span><button type="button" class="btn sm" data-go-on>Go on</button></div>` : '';
}
function groupWorkingHTML(working) {
  const lines = working.map((w, i) => {
    const said = turnLines.get(w.runId) || {};
    const held = said.held === true; // its run waits for the owner's OK
    const doing = held ? OpeningLine.WAITING : OpeningLine.text(said.text) || OpeningLine.ofRun(w, state.features) || 'Working';
    return `<div class="status-line${held ? ' held' : ''}" role="status" style="--c:${Unread.tint(memberColor(w.botId))}"><i></i><span><b>${esc(memberName(w.botId))}</b> · ${esc(doing)}</span>${i === working.length - 1 ? '<button type="button" data-stop-all>Stop all</button>' : ''}</div>`;
  });
  return lines.length ? `<div class="g-working">${lines.join('')}</div>` : '';
}
// Who is next in a group's chat: the members whose turn has not come, in the order they will have it, of the one
// message that is shown them of. messages: the owner's messages the chat holds, oldest first, each with the
// server's `next`. working: the members at work in the group, each with the message its turn is of. While a
// member works, only the messages whose turns are running count; while none works, every message does. Of
// those, it is the newest that "Stop all" did not end and whose `next` is not empty. Nobody otherwise: the
// last turn is at work or has ended, or the owner stopped them all. Android's Groups.next has the same rule.
function groupNext(messages, working) {
  const running = new Set(working.map((w) => w.messageId).filter((id) => typeof id === 'string'));
  const shown = messages.filter((m) => (!working.length || running.has(m.id)) && m.stopped !== true && Array.isArray(m.next) && m.next.length > 0).pop();
  return shown ? shown.next : [];
}
// The bots of who is next that exist, in that order: a bot the page does not know is given no head.
function groupHeads(next) {
  return (Array.isArray(next) ? next : []).map(botById).filter(Boolean);
}
// Their heads, under the working lines: the page's small figure, in each bot's colour with its hat, still, with
// no word and no digit. A screen reader is told their names: "Next: Reviewer and Issue Writer". Nothing when
// nobody is next.
function groupNextHTML(chat) {
  const heads = groupHeads(groupNext(chatItems(chat).filter((x) => x.type === 'message'), chat.working));
  return heads.length ? `<div class="g-next" role="img" aria-label="Next: ${esc(namesList(heads.map((b) => b.name)))}">${heads.map((b) => `<i>${botMark(b)}</i>`).join('')}</div>` : '';
}
// The owner's messages a group's chat holds, as the server has them: what a message on its way is looked for in.
const groupWords = (chat) => [...chat.items.values()].filter((x) => x.type === 'message');
// Its replies, oldest first, each by its turn's id: what counts as new on screen is told by these (app.js, "a reply arrives").
const groupReplyIds = (chat) => chatItems(chat).filter((x) => x.type === 'reply').map((x) => x.id);
// A message of the owner's that is on its way (app.js, sentAtOnce) stands here as the page's own bubble: with no
// member at work and nothing waiting, under the replies, with one plain "Working" under it: no name, until the
// server says who works. Otherwise at the end, under the messages that already wait, and the lines stay the members'.
// Under the lines, and above the messages that wait, stand the heads of who is next (groupNextHTML).
function groupTailHTML(g, chat) {
  const key = `group:${g.id}`;
  const waiting = chatItems(chat).filter((x) => x.type === 'message' && waitsWhole(x));
  const sent = sentIn(key, () => groupWords(chat));
  const last = !!sent && (chat.working.length > 0 || waiting.length > 0);
  const mine = sent ? sentHTML(sent, key) : '';
  return groupLimitHTML(chat.limit)
    + (sent && !last ? `<div class="chat-sent">${mine}</div><div class="g-working">${OpeningLine.status('Working', null, null)}</div>` : groupWorkingHTML(chat.working))
    + groupNextHTML(chat)
    + (waiting.length || last ? `<div class="chat-queued">${waiting.map((m) => groupWaitingHTML(m, key)).join('')}${last ? mine : ''}</div>` : '');
}

// A member named in a reply (a hand-on, "@Coder") is drawn as a mention is in the owner's message: its small head
// and its name. Only the text of the reply is read, and only a member's name makes one: the reply's own markup
// stays as the page drew it.
function drawReplyMentions(thread, chat) {
  if (typeof document.createTreeWalker !== 'function') return;
  const ctx = mentionCtx(chat);
  for (const box of $$('.g-row .md', thread)) {
    const walk = document.createTreeWalker(box, NodeFilter.SHOW_TEXT, { acceptNode: (n) => (n.data.includes('@') && !n.parentElement.closest('a, code, pre, button, .mention') ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT) });
    const nodes = [];
    while (walk.nextNode()) nodes.push(walk.currentNode);
    for (const n of nodes) {
      const found = Mentions.findMentions(n.data, ctx);
      if (!found.length) continue;
      const parts = document.createDocumentFragment();
      let at = 0;
      for (const m of found) {
        parts.append(n.data.slice(at, m.start));
        const span = document.createElement('span');
        span.title = m.text;
        if (m.kind === 'bot') { span.className = 'mention'; span.innerHTML = botLabel(ctx.bots.find((b) => b.id === m.bot)); }
        else { span.className = 'mention tint'; span.textContent = m.text; }
        parts.append(span);
        at = m.end;
      }
      parts.append(n.data.slice(at));
      n.replaceWith(parts);
    }
  }
}

function renderGroupChat() {
  const root = $('#view-group');
  const g = groupById(state.groupId);
  if (!g) { if (state.groupsKnown) leaveBot(); return; } // deleted, here or in another app
  const key = `group:${g.id}`;
  if (root.dataset.group !== g.id) {
    root.dataset.group = g.id;
    delete root.dataset.sig;
    root.innerHTML = `
      <div class="chat-head">
        ${BACK_BTN}
        <button class="chat-title" id="group-settings" title="Its name and its members">
          <div id="group-pic"></div>
          <div class="grow"><h2 id="group-name"></h2><div class="sub" id="group-sub"></div></div>
        </button>
      </div>
      <div class="chat-thread" id="group-thread"><div class="g-items"></div><div class="g-tail"></div></div>
      ${composerHTML(`Message ${g.name}…`)}`;
    wireComposer($('form', root), (text, files, k) => sendToGroup(g.id, text, files, k), () => key, key);
    $('#group-settings').onclick = () => setPanel('toggle');
    if (groupChat?.id !== g.id) loadGroupChat(g.id);
  }
  const pic = $('#group-pic');
  const look = groupLook(g);
  if (pic.dataset.sig !== look) { pic.dataset.sig = look; pic.innerHTML = groupPicture(g, 'sm'); }
  $('#group-name').textContent = g.name;
  $('#group-sub').textContent = groupMembers(g).map((b) => b.name).join(', ');
  const form = $('form', root);
  form.text.placeholder = `Message ${g.name}…`;
  const thread = $('#group-thread');
  const chat = groupChat?.id === g.id && groupChat.loaded ? groupChat : null;
  if (!chat) return; // not read yet: nothing is drawn in its place
  const newFirst = newLine.first(key); // the "New" line stays where it was put while the chat is open
  // The line's reply is further back than the page holds: read further, once.
  if (newFirst !== null && !chat.items.has(newFirst) && chat.more && chat.want < GROUP_REACH) loadGroupChat(g.id, GROUP_REACH);
  const items = $('.g-items', thread);
  const sig = JSON.stringify([chatItems(chat).map((x) => (x.type === 'message' ? [x.id, x.text, x.waitsFor, x.canTakeBack, x.attachments] : [x.id, x.run.status, x.run.endedAt])),
    chat.more, chat.asks?.runId || null, newFirst, signedOut.on, mentionSig(), g.name, look]);
  if (root.dataset.sig !== sig) {
    const atBottom = !root.dataset.sig || thread.scrollHeight - thread.scrollTop - thread.clientHeight < 120;
    root.dataset.sig = sig;
    items.innerHTML = groupThreadHTML(g, chat, newFirst);
    items.classList.toggle('empty', !!$('.chat-empty', items));
    drawReplyMentions(items, key);
    if (atBottom) thread.scrollTop = thread.scrollHeight;
    scrollToNew(thread);
    $$('[data-expand]', items).forEach((el) => (el.onclick = (e) => { if (!e.target.closest('a')) el.firstElementChild.classList.toggle('clamp'); }));
    $$('[data-details]', items).forEach((el) => (el.onclick = () => openRun(el.dataset.details)));
    // What a member learned in its turn opens that bot's jobs or settings, as in its own chat.
    $$('[data-learned]', items).forEach((el) => (el.onclick = () => {
      const run = chat.items.get(el.closest('[data-reply]')?.dataset.reply)?.run;
      const view = learnedOpens(el.dataset.learned);
      if (view && run && botById(run.botId)) setView(view, run.botId);
    }));
    const earlier = $('[data-earlier]', items);
    if (earlier) earlier.onclick = () => loadEarlier(earlier);
    // An answer to the group's open question is a message to the group: the member that asked has the first turn.
    wireChoices(items, (t, k) => sendFrom(form, () => sendToGroup(g.id, t, [], k)));
    markSearch();
  }
  // From a search match: that reply, also in a chat that is drawn already. One further back than the page holds
  // is read first, and opens on its own when it is not there.
  if (state.jump?.runId && state.jump.group?.id === g.id) {
    const id = state.jump.runId;
    const row = $(`[data-reply="${CSS.escape(id)}"]`, items);
    if (!row && chat.more && chat.want < GROUP_REACH) loadGroupChat(g.id, GROUP_REACH);
    else if (!jumpTo(row)) openRun(id);
  }
  // A reply that is new in the open chat arrives (app.js, "a reply arrives"): its whole row, once.
  for (const id of repliesArrive(arrivals.group, thread, key, groupReplyIds(chat))) arrive($(`[data-reply="${CSS.escape(id)}"]`, items));
  drawGroupTail(g, chat);
  updateChatNeeds(thread, key);
  setSendBusy(form, false);
}
// The end of the chat, drawn again only when it changed: a working line that changes moves nothing else.
function drawGroupTail(g, chat) {
  const thread = $('#group-thread');
  const tail = thread && $('.g-tail', thread);
  if (!tail) return;
  const html = groupTailHTML(g, chat);
  // The owner's message on its way arrives when it is first drawn, as a reply does: asked each time the end is
  // looked at, so that one drawn again later stands.
  const mine = sentArrives(arrivals.group, thread, `group:${g.id}`, sentIn(`group:${g.id}`, () => groupWords(chat)));
  if (tail.dataset.html === html) return;
  const atBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 160;
  tail.dataset.html = html;
  tail.innerHTML = html;
  if (mine) arrive($('[data-sent]', tail));
  const stop = $('[data-stop-all]', tail);
  if (stop) stop.onclick = () => stopGroup(g.id, stop);
  const on = $('[data-go-on]', tail);
  if (on) on.onclick = () => goOnGroup(g.id, on);
  $$('[data-take-back]', tail).forEach((b) => (b.onclick = () => takeBackInGroup(g.id, b.dataset.takeBack, b)));
  if (atBottom) thread.scrollTop = thread.scrollHeight;
}
// What waits for the owner is read after the page was drawn (refresh): when it arrives, the cards at the end of the
// open group follow at once, as the banner does (showNeeds).
function drawGroupCards() {
  const thread = $('#group-thread');
  if (state.view === 'group' && thread && groupChat?.loaded && groupChat.id === state.groupId) updateChatNeeds(thread, `group:${state.groupId}`);
}
// The open group's chat again, when it is the one drawn.
function redrawGroup(groupId) {
  if (state.view === 'group' && state.groupId === groupId && $('#view-group')?.dataset.group === groupId) renderGroupChat();
}

// "Go on", typed: these words and nothing else, in any case, with the signs typed around them, as the server reads
// them (lib/group-chat.js).
const isGoOn = (text) => /^[\s*_`"'.!]*go\s+on[\s*_`"'.!]*$/i.test(String(text ?? ''));

// The owner writes in the group: one message, and the server gives the turns. Rejects when it did not go, with
// nothing added to the chat (wireComposer, sendFrom). The words "Go on", typed while the group is stopped at the
// limit, are no message: the server answers `wentOn` and the messages that go on, and nothing is added.
// From Send until botdot answers the message stands in the chat as the page's own bubble (groupTailHTML); the
// answer puts the server's message in its place, and a send that failed takes it away. Nothing is drawn for
// "Go on" in a stopped group: it is no message.
async function sendToGroup(id, text, attachments = [], key = messageKey()) {
  const at = `group:${id}`;
  const chat = groupChat?.id === id ? groupChat : null;
  if (chat && !((chat.limit || groupById(id)?.limit) && isGoOn(text))) {
    sentAtOnce(at, { key, text, attachments }, () => groupWords(chat));
    redrawGroup(id);
    const thread = $('#group-thread');
    if (thread && state.groupId === id) thread.scrollTop = thread.scrollHeight;
  }
  let sent;
  try {
    sent = await api(`/group-chats/${encodeURIComponent(id)}/messages`, { method: 'POST', body: { text, attachments, key } });
  } catch (e) {
    sentOver(at, key, false); // it did not go: nothing of it stays in the chat
    redrawGroup(id);
    throw e;
  }
  sentOver(at, key);
  if (groupChat?.id === id) {
    for (const m of sent?.wentOn ? (Array.isArray(sent.messages) ? sent.messages : []) : [sent]) holdMessage(groupChat, m);
    if (sent?.wentOn) groupChat.limit = null;
    redrawGroup(id);
  }
  await loadGroupChat(id); // never rejects: the message went
  const thread = $('#group-thread');
  if (thread && state.groupId === id) thread.scrollTop = thread.scrollHeight;
}
// "Stop all": every run of the group at work ends, and the turns that would have followed never start.
async function stopGroup(id, button) {
  if (button) button.disabled = true;
  try { await api(`/group-chats/${encodeURIComponent(id)}/stop`, { method: 'POST' }); toast('Stopping…'); }
  catch (e) { toast(e.message, true); if (button) button.disabled = false; }
  loadGroupChat(id);
}
// "Go on": the group stopped at the limit gets twelve more replies. A group that is not stopped any more says so.
async function goOnGroup(id, button) {
  if (button) button.disabled = true;
  try {
    const went = await api(`/group-chats/${encodeURIComponent(id)}/go-on`, { method: 'POST' });
    if (groupChat?.id === id && went?.wentOn) { groupChat.limit = null; redrawGroup(id); }
  } catch (e) { toast(e.message, true); if (button) button.disabled = false; }
  loadGroupChat(id);
}
// Take a waiting message back: its text and files are in the message box again, and it starts nothing. When its
// turn came first (409), the line above the box says so and the chat shows what started.
async function takeBackInGroup(id, messageId, button) {
  const form = $('#view-group form');
  const here = () => $('#view-group')?.dataset.group === id;
  if (button) button.disabled = true;
  try {
    const back = await api(`/group-chats/${encodeURIComponent(id)}/messages/${encodeURIComponent(messageId)}`, { method: 'DELETE' });
    if (groupChat?.id === id) { groupChat.items.delete(messageId); redrawGroup(id); }
    const text = typeof back?.text === 'string' ? back.text : '';
    if (here()) form?._takeBack?.(text, back?.attachments);
    else {
      // The owner opened another group meanwhile: kept for this group's own box, as a send that failed there is.
      const kept = failedSends.get(`group:${id}`);
      failedSends.set(`group:${id}`, { text: withFailed(text, kept?.text || ''), held: [...readyFiles(back?.attachments), ...(kept?.held || [])], err: kept?.err || null, sent: null });
    }
  } catch (e) {
    if (button) button.disabled = false;
    if (e.status === 409) showBoxNote(here() ? form : null, 'It has already started.');
    else toast(e.message, true);
    loadGroupChat(id);
  }
}

// ---------- the live feed ----------

// What happens in the groups, as the feed says it (docs/api.md, "The live feed"). Each event changes what the
// page holds at once; the lists and the open chat are read again after it. No reply in a group rings here.
function followGroups(es) {
  let timer = null;
  const soon = () => { clearTimeout(timer); timer = setTimeout(() => { if (!$('#modal').open) refresh(); }, 300); };
  const on = (type, take) => es.addEventListener(type, (e) => {
    let d = null;
    try { d = JSON.parse(e.data); } catch { /* not ours */ }
    if (d && typeof d === 'object') take(d);
  });
  const open = (groupId) => (groupChat?.id === groupId ? groupChat : null);
  const again = (groupId) => { if (open(groupId) && state.view === 'group' && state.groupId === groupId) loadGroupChat(groupId); };
  // A group was made, changed or deleted, or a deleted bot left one.
  es.addEventListener('groups', soon);
  // A turn started: its member is at work in the group.
  on('group_run_started', (d) => {
    const g = groupById(d.groupId);
    if (!g || typeof d.botId !== 'string') return;
    for (const [runId, l] of turnLines) if (l.groupId === d.groupId && l.botId === d.botId && runId !== d.id) turnLines.delete(runId); // its earlier turn's line
    g.working = [...new Set([...(g.working || []), d.botId])];
    const chat = open(d.groupId);
    if (chat && !chat.working.some((w) => w.runId === d.id)) chat.working.push({ botId: d.botId, runId: d.id, messageId: d.groupMessageId, startedAt: d.startedAt });
    renderContacts();
    redrawGroup(d.groupId);
    again(d.groupId);
  });
  // A turn ended: its line goes, and its reply is the group's newest, unless it passed. A pass shows nothing.
  on('group_run_finished', (d) => {
    turnLines.delete(d.id);
    const g = groupById(d.groupId);
    if (!g) return;
    g.working = (g.working || []).filter((id) => id !== d.botId);
    if (!d.passed) g.last = { runId: d.id, botId: d.botId, botName: d.botName, status: d.status, at: d.endedAt || d.startedAt, text: String(d.result || d.problem || '').slice(0, 300) };
    const chat = open(d.groupId);
    if (chat) chat.working = chat.working.filter((w) => w.runId !== d.id);
    renderContacts();
    redrawGroup(d.groupId);
    again(d.groupId);
  });
  // The owner's message as it is now: taken, or whom it waits for changed. And one that was taken back.
  on('group_message', (d) => {
    const chat = open(d.groupId);
    if (chat && holdMessage(chat, d.message)) redrawGroup(d.groupId);
  });
  on('group_message_gone', (d) => {
    if (open(d.groupId)?.items.delete(d.id)) redrawGroup(d.groupId);
  });
  // The group's open question, and its stopped line.
  on('group_asks', (d) => {
    const g = groupById(d.groupId);
    if (!g) return;
    g.asks = d.asks && typeof d.asks === 'object' ? d.asks : null;
    if (open(d.groupId)) open(d.groupId).asks = g.asks;
    renderContacts();
    redrawGroup(d.groupId);
  });
  on('group_limit', (d) => {
    const g = groupById(d.groupId);
    if (!g) return;
    g.limit = d.limit && typeof d.limit === 'object' ? d.limit : null;
    if (open(d.groupId)) open(d.groupId).limit = g.limit;
    redrawGroup(d.groupId);
    again(d.groupId);
  });
  // Its new replies: the dots on its row and its "New" line; `unread: 0` reads it here too.
  on('group_unread', (d) => { if (typeof d.chat === 'string') setUnread(d.chat, d); });
  // A member's line, and whether its run waits for the owner's OK. Its working line, each time it changes, from a
  // server that has one; its opening line until the turn has a working line, and from a server that has none.
  on('group_working_line', (d) => {
    if (!OpeningLine.follows(state.features) || typeof d.runId !== 'string' || !OpeningLine.text(d.text)) return;
    sayTurnLine(d.runId, d.groupId, d.botId, { text: OpeningLine.text(d.text), works: true });
    renderContacts();
    redrawGroup(d.groupId);
  });
  on('group_opening_line', (d) => {
    if (typeof d.runId !== 'string' || !OpeningLine.text(d.text) || turnLines.get(d.runId)?.works) return;
    sayTurnLine(d.runId, d.groupId, d.botId, { text: OpeningLine.text(d.text) });
    renderContacts();
    redrawGroup(d.groupId);
  });
  on('group_run_waits', (d) => {
    if (typeof d.runId !== 'string') return;
    sayTurnLine(d.runId, d.groupId, d.botId, { held: d.waitingFor === 'ok' });
    redrawGroup(d.groupId);
  });
  es.addEventListener('reset', () => turnLines.clear()); // the feed could not say what was missed: the lists are read again
}

