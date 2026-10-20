// ---------- presence ----------

// While you use this page (visible, and touched in the last 5 minutes), tell botdot every 30 s, so
// the phone app doesn't notify you about what you're already seeing here. It also says which chat is
// open (right away when that changes), so the phone takes away that chat's notification.
let lastTouch = Date.now();
let lastPresence = 0;
let presenceChat = null;
const chatInView = () => (state.view === 'chief' && state.chatId ? `chief:${state.chatId}` : state.view === 'bot' && state.botId ? `bot:${state.botId}`
  : state.view === 'group' && state.groupId ? `group:${state.groupId}` : null);
// The panel beside the chat leaves it on screen. In a column too narrow for both, the style takes the
// chat away under the panel: it is not on screen then, as it was not under the settings page.
const chatView = () => $(state.view === 'chief' ? '#view-chief' : state.view === 'group' ? '#view-group' : '#view-bot');
const panelCovers = () => !!panelPage() && getComputedStyle(chatView()).display === 'none';
const chatOnScreen = () => (panelCovers() ? null : chatInView());
function sayPresent() {
  if (document.visibilityState !== 'visible' || !document.hasFocus() || Date.now() - lastTouch > 5 * 60_000) return;
  const chat = chatOnScreen();
  if (Date.now() - lastPresence < 25_000 && chat === presenceChat) return;
  lastPresence = Date.now();
  presenceChat = chat;
  // Presence takes no group: it is for apps from before new replies, which know none (docs/api.md, Groups).
  api('/presence', { method: 'POST', body: { chat: chat?.startsWith('group:') ? null : chat } }).catch(() => {});
}
['pointerdown', 'keydown', 'wheel', 'touchstart', 'mousemove'].forEach((t) => addEventListener(t, () => { lastTouch = Date.now(); sayPresent(); }, { passive: true }));
addEventListener('focus', sayPresent);
document.addEventListener('visibilitychange', sayPresent);
setInterval(sayPresent, 30_000);

// ---------- new replies ----------

// The botdot server keeps what you have read and says what is new (unread.js, ADR 005). This page tells it
// which chat is on screen while the page is in front, again every few seconds, and "none" the moment it
// isn't: the chat was left, the page is hidden or another window is in front. Presence (above) is not
// part of it.
const newLine = Unread.lineKeeper();
const report = Unread.reporter({
  app: Unread.appId(),
  post: (body) => api('/read', { method: 'POST', body, keepalive: true }),
  // The server took it as read: its dots go here too, also while the live feed is down.
  onRead: (chat) => { if (report.shown() === chat) setUnread(chat, { unread: 0, firstUnread: null }); },
});
const inFront = () => document.visibilityState === 'visible' && document.hasFocus();
// The chat that is open and drawn: on a phone the list hides it.
function chatOpen() {
  const chat = chatOnScreen();
  return chat && chatView().getClientRects().length ? chat : null;
}
// The window was widened or narrowed with the panel open: the chat came out from under it, or went under.
function panelResized() {
  const now = panelCovers();
  if (now === covered) return;
  covered = now;
  sayPresent();
  syncRead();
  if (!now) threadToEnd(); // a thread drawn while it was covered has no height yet
}
addEventListener('resize', panelResized);
const chatParts = (chat) => { const at = String(chat || '').indexOf(':'); return [String(chat || '').slice(0, at), String(chat || '').slice(at + 1)]; };
// What the page knows about a chat's new replies, and what the server says right now.
function unreadKnown(chat) {
  const [kind, id] = chatParts(chat);
  return kind === 'bot' ? botById(id) : kind === 'group' ? groupById(id) : state.chats.find((c) => c.id === id);
}
function unreadNow(chat) {
  const [kind, id] = chatParts(chat);
  return kind === 'bot' ? api(`/bots/${encodeURIComponent(id)}`) : kind === 'group' ? api(`/group-chats/${encodeURIComponent(id)}`) : api(`/chief/chats/${encodeURIComponent(id)}?limit=1`);
}
const loadFeatures = () => api('/version').then((v) => { state.features = v.features || []; }).catch(() => {});
const loadChief = () => api('/chief').then((c) => { Object.assign(state, { chats: c.chats, chiefBusy: c.busy, chiefUnread: Unread.count(c) }); if (takeChiefName(c.chief?.name)) drawChiefName(); renderContacts(); }).catch(() => {});

let readChat = null; // the chat last seen on screen and in front
function syncRead() {
  if (!state.features.includes('unread')) return; // a server from before: nothing is new, nothing to report
  const open = chatOpen();
  if (newLine.open(open)) drawNewLine(); // the chat was left: its line goes
  const chat = inFront() ? open : null;
  if (chat === readChat) return;
  readChat = chat;
  if (!chat) { report.show(null); return; }
  Push.clear(window, chat); // its notifications on this device go (push.js)
  // It came on screen: place the line from what the server says is new, then say the chat is being read.
  placeNewLine(chat, unreadKnown(chat));
  unreadNow(chat).catch(() => null).then((now) => {
    if (readChat !== chat) return;
    if (now) placeNewLine(chat, now);
    report.show(chat);
  });
}
function placeNewLine(chat, model) { if (newLine.arrive(chat, model)) drawNewLine(); }
function drawNewLine() {
  if (state.view === 'bot') renderBotChat();
  if (state.view === 'group') renderGroupChat();
  placeChiefLine();
}
// The line in the Chief's chat: above the message the server named, or the next one that is drawn.
function placeChiefLine() {
  const thread = $('#chat-thread');
  if (!thread) return;
  $$('.new-line', thread).forEach((el) => el.remove());
  const id = thread.dataset.chat;
  const first = id ? newLine.first(`chief:${id}`) : null;
  if (first === null) return;
  const rows = $$('[data-msg]', thread);
  const row = rows[Unread.rowFrom(rows.map((el) => Number(el.dataset.msg)), first)];
  if (!row) {
    // The rows this page added itself (your message, the reply from its own stream) have no place yet:
    // draw the chat from the server once, which calls this again.
    if (thread.dataset.lineFor === `${id}:${first}` || state.chatId !== id) return;
    thread.dataset.lineFor = `${id}:${first}`;
    if (state.chatStream) state.chatReload = true; // after the reply that is still coming
    else showChat(id);
    return;
  }
  row.insertAdjacentHTML('beforebegin', Unread.line(CHIEF_COLOR));
  scrollToNew(thread);
}
// Bring a line that was just placed (or, when a chat opens, the line it has) to the top of the chat.
function scrollToNew(thread, opening = false) {
  const line = $('.new-line', thread);
  if (!line) return false;
  if (!newLine.takeJump() && !opening) return false;
  thread.scrollTop += line.getBoundingClientRect().top - thread.getBoundingClientRect().top - 28;
  return true;
}
// A chat's new replies changed (the live feed's `unread`, or this page's own report).
function setUnread(chat, now) {
  const [kind, id] = chatParts(chat);
  if (kind === 'chief') {
    const known = state.chats.find((c) => c.id === id);
    if (!known || Unread.count(known) !== Unread.count(now)) loadChief(); // the Chief's row shows the server's sum
    return;
  }
  const bot = kind === 'bot' ? botById(id) : kind === 'group' ? groupById(id) : null; // a group has one count and one line, as a bot has
  if (!bot || (Unread.count(bot) === Unread.count(now) && bot.firstUnread === now.firstUnread)) return;
  Object.assign(bot, { unread: Unread.count(now), firstUnread: now.firstUnread ?? null });
  renderContacts();
}
addEventListener('focus', syncRead);
addEventListener('blur', syncRead);
addEventListener('pagehide', () => { readChat = null; report.show(null); }); // closed or left while still in front
addEventListener('pageshow', syncRead);
addEventListener('resize', syncRead); // a narrow window shows the list or the chat, not both
document.addEventListener('visibilitychange', syncRead);

// ---------- the tab tells ----------

// The page's tab says that something is new or waits, also while another tab is in front: a mark before "botdot"
// in its title and a dot on its icon, while any chat has a new reply (the dots of the list) or anything waits in
// Needs you (its heads). A mark and never a count, and nothing the browser has to ask about: no notification.
const TAB_NAME = 'botdot';
const TAB_MARK = '●';
// The dot on the icon, in the icon's own measures (512 wide) and the colour of its own dot.
const TAB_DOT = '<circle cx="396" cy="116" r="92" fill="#d85a30"/>';

// Whether the mark is due, and the tab's title. bots, groups: the page's, each with the server's `unread`;
// chief: the new replies of all the Chief's chats; needs: what waits in Needs you.
function tabTells(held) {
  const { bots, groups, chief, needs } = held || {};
  const list = (x) => (Array.isArray(x) ? x : []);
  const due = Unread.count({ unread: chief }) > 0 || [...list(bots), ...list(groups)].some((c) => Unread.count(c) > 0) || list(needs).length > 0;
  return { due, title: due ? `${TAB_MARK} ${TAB_NAME}` : TAB_NAME };
}

// The icon with the mark: the page's own icon (the text of its SVG) with the dot drawn last, as an address the
// page makes itself. '' for anything that is no SVG: the plain icon stays.
function markedIcon(svg) {
  const text = typeof svg === 'string' ? svg.trim() : '';
  if (!text.startsWith('<svg') || !text.endsWith('</svg>')) return '';
  return `data:image/svg+xml,${encodeURIComponent(text.slice(0, -'</svg>'.length) + TAB_DOT + '</svg>')}`;
}

// plain: the icon the page came with. marked: the same with the dot, made the first time a mark is due.
const tabIcon = { plain: null, marked: '', reading: false, gone: false };
// Sets the title and the icon from what the page holds: called wherever the list and Needs you are drawn.
function tellTab() {
  const tab = tabTells({ bots: state.bots, groups: state.groups, chief: state.chiefUnread, needs: needsItems() });
  if (document.title !== tab.title) document.title = tab.title;
  const link = $('link[rel="icon"]');
  if (!link) return;
  tabIcon.plain ??= link.getAttribute('href');
  const href = tab.due && tabIcon.marked ? tabIcon.marked : tabIcon.plain;
  if (link.getAttribute('href') !== href) link.setAttribute('href', href);
  if (!tab.due || tabIcon.marked || tabIcon.reading || tabIcon.gone) return;
  // The first mark: read the icon and draw the dot on it. Until then, and when it cannot be read, the title tells.
  tabIcon.reading = true;
  Promise.resolve().then(() => fetch(tabIcon.plain)).then(async (r) => {
    tabIcon.marked = r.ok ? markedIcon(await r.text()) : '';
    tabIcon.gone = !tabIcon.marked; // no icon to mark: not asked for again
  }).catch(() => {}).then(() => { // offline: the next mark tries again
    tabIcon.reading = false;
    if (tabIcon.marked) tellTab();
  });
}

// An arrival is over (a reply arrives, below): its row is a row like any other again, so that a chat that is hidden
// and shown does not play it a second time.
document.addEventListener('animationend', (e) => { if (e.animationName === 'arrive') e.target.classList.remove('arrives'); });

// ---------- a message that waits ----------

// The owner's messages that wait their turn (docs/api.md, "A message that waits"): a list as the server hands
// it out, oldest first, each `{ id, text, attachments, at }`, and `steering` once the owner steered it into the
// run that is going (ADR 040). Anything else in it is left out.
const queuedList = (list) => (Array.isArray(list) ? list : []).filter((q) => q && typeof q.id === 'string' && q.id);
// Those of a chat, "bot:<id>" or "chief:<chatId>": a bot's come with the bots, a Chief chat's with the chat,
// and both with the feed's `queued`. The page keeps none of its own: what it draws is the server's list.
function queuedIn(chat) {
  const [kind, id] = chatParts(chat);
  return kind === 'bot' ? queuedList(botById(id)?.queued) : kind === 'chief' ? chiefQueued.get(id) || [] : [];
}
// The feed's list for a chat, or a list the page was answered with.
function setQueued(chat, list) {
  const [kind, id] = chatParts(chat);
  if (kind === 'chief') chiefQueued.set(id, queuedList(list));
  else if (kind === 'bot' && botById(id)) botById(id).queued = queuedList(list);
  else return;
  placeStatusLines();
}
// One waiting message: the owner's bubble, faded, with what it waits for and the way back. In a bot's chat, also
// Steer (ADR 040): the run that is going reads it at its next tool call; until then it shows "Steering…".
const canSteer = (kind) => kind === 'bot' && state.features.includes('steer');
function queuedHTML(q, chat) {
  const [kind, id] = chatParts(chat);
  const who = kind === 'chief' ? 'the Chief' : botById(id)?.name || 'the bot';
  const text = typeof q.text === 'string' ? q.text : '';
  const files = filesHTML(Array.isArray(q.attachments) ? q.attachments : []);
  const steering = canSteer(kind) && q.steering === true;
  const line = steering ? 'Steering…' : `Waits until ${who} is free`;
  const steer = canSteer(kind) && !steering ? `<button type="button" data-steer="${esc(q.id)}">Steer</button>` : '';
  return `<div class="bubble-row from-me"><div class="stack mine">
    <div class="bubble from-me waits">${escMentions(text, kind === 'chief' ? CHIEF_BOT.id : id)}${files}</div>
    <div class="bubble-meta"><span>${esc(line)}</span>${steer}<button type="button" data-take-back="${esc(q.id)}">Take back</button></div>
  </div></div>`;
}
// The waiting messages of a chat, at its end: after the working line and before the cards, which stay last
// (updateChatNeeds). Drawn again only when the list, or a name in it, changed.
// sent: the owner's message that is on its way while something is at work here (placeStatusLines): the last of them.
// arrives: that message is new on screen, and its row moves once (a reply arrives).
function updateChatQueued(thread, chat, sent = null, arrives = false) {
  if (!thread) return;
  const list = chat ? queuedIn(chat) : [];
  let box = $('.chat-queued', thread);
  if (!box && !list.length && !sent) return;
  if (!box) { box = document.createElement('div'); box.className = 'chat-queued'; }
  const cards = $('.chat-needs', thread);
  if (cards ? box.nextElementSibling !== cards : box !== thread.lastElementChild) { if (cards) cards.before(box); else thread.append(box); }
  const sig = JSON.stringify([chat, list.map((q) => [q.id, q.text, q.attachments, q.steering === true]), mentionSig(), sent]);
  if (box.dataset.sig === sig) return;
  const atBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 160;
  box.dataset.sig = sig;
  box.innerHTML = list.map((q) => queuedHTML(q, chat)).join('') + (sent ? sentHTML(sent, chat) : '');
  $$('[data-take-back]', box).forEach((b) => (b.onclick = () => takeBack(chat, b.dataset.takeBack, b)));
  $$('[data-steer]', box).forEach((b) => (b.onclick = () => steerQueued(chat, b.dataset.steer, b)));
  if (sent && arrives) arrive($('[data-sent]', box));
  if (atBottom) thread.scrollTop = thread.scrollHeight;
}
// Steer a waiting message into the run that is going (ADR 040): the server's list comes back with it marked. When
// it started meanwhile, or the run can't take it (409), the line above the message box says why, in the server's words.
async function steerQueued(chat, queuedId, button) {
  const [, id] = chatParts(chat);
  if (button) button.disabled = true;
  try {
    const back = await api(`/bots/${encodeURIComponent(id)}/queued/${encodeURIComponent(queuedId)}/steer`, { method: 'POST' });
    setQueued(chat, back?.queued);
  } catch (e) {
    if (button) button.disabled = false;
    if (e.status === 409) { showBoxNote(chatOpenIs(chat) ? $('#view-bot form') : null, e.message); await refresh(); return; }
    toast(e.message, true);
    if (e.status === 404) await refresh();
  }
}
// Take a waiting message back: its text and files are in the message box again, and it starts nothing. When its
// turn came first (409), the line above the box says so and the chat shows what started.
async function takeBack(chat, queuedId, button) {
  const [kind, id] = chatParts(chat);
  const form = $(kind === 'chief' ? '#view-chief form' : '#view-bot form');
  const again = () => (kind === 'chief' ? (state.chatId === id ? showChat(id) : null) : refresh());
  if (button) button.disabled = true;
  try {
    const back = await api(`${kind === 'chief' ? `/chief/chats/${encodeURIComponent(id)}` : `/bots/${encodeURIComponent(id)}`}/queued/${encodeURIComponent(queuedId)}`, { method: 'DELETE' });
    setQueued(chat, queuedIn(chat).filter((q) => q.id !== queuedId)); // gone at once; the feed's list follows
    // Into the message box. The Chief's chats share one; a bot's is built again for each bot, so when the owner
    // opened another bot meanwhile the message is kept for its own chat's box, as a send that failed there is.
    const text = typeof back?.text === 'string' ? back.text : '';
    if (kind === 'chief' || chatOpenIs(chat)) form?._takeBack?.(text, back?.attachments);
    else {
      const kept = failedSends.get(chat);
      failedSends.set(chat, { text: withFailed(text, kept?.text || ''), held: [...readyFiles(back?.attachments), ...(kept?.held || [])], err: kept?.err || null, sent: null });
    }
  } catch (e) {
    if (button) button.disabled = false;
    if (e.status === 409) { showBoxNote(chatOpenIs(chat) ? form : null, 'It has already started.'); await again(); return; }
    toast(e.message, true);
    if (e.status === 404) await again(); // it is not there any more: the list as the server has it
  }
}
// Whether the page's chat of that kind is this one (a bot's chat and the Chief's each keep one message box).
function chatOpenIs(chat) {
  const [kind, id] = chatParts(chat);
  return kind === 'chief' ? state.chatId === id : $('#view-bot')?.dataset.bot === id;
}

// ---------- a working bot's opening line ----------

// What each working bot, and the Chief, said it is about to do (opening-line.js): the server's words.
const openingLines = OpeningLine.keeper();

// The status line under the chats that are drawn, below the last message and above what waits: the owner's
// waiting messages, then the cards. A bot's is there while it works: its line in the server's words (its opening
// line, then what it is doing: the working line), or "Working", and Stop;
// "Waiting for your OK" while its run waits for the owner's answer on a card (the run's `waitingFor`, read with
// the runs). The Chief's is there while it replies: what it is doing, in the server's words (its opening line
// first, then "Reading nytimes.com", "Waiting for Web Surfer", "Thinking": the `activity` of its reply), and Stop.
// The waiting messages are placed first: the line stands on them.
// A message of the owner's that is on its way (sentIn) stands here too, as the page's own bubble: with nothing at
// work above the line, which then says "Working" with nothing to stop yet; with a bot at work or the Chief
// replying, at the end, under the messages that already wait, and the line stays theirs.
function placeStatusLines() {
  const botId = $('#view-bot')?.dataset.bot;
  const working = botId && state.runs.find((r) => r.botId === botId && r.status === 'running' && r.kind !== 'script');
  const task = botId ? sentIn(`bot:${botId}`) : null;
  const taskWaits = !!task && (!!working || queuedIn(`bot:${botId}`).length > 0);
  const taskNew = sentArrives(arrivals.bot, $('#bot-thread'), `bot:${botId}`, task); // it arrives, once (a reply arrives)
  updateChatQueued($('#bot-thread'), botId ? `bot:${botId}` : null, taskWaits ? task : null, taskNew);
  drawStatusLine($('#bot-thread'), botId ? `bot:${botId}` : null, botById(botId)?.color, working?.id, working?.waitingFor === 'ok');
  updateChatSent($('#bot-thread'), taskWaits ? null : task, `bot:${botId}`, taskNew);
  const chatId = $('#chat-thread')?.dataset.chat;
  chiefArrives($('#chat-thread')); // a reply that was just drawn there arrives
  const replying = !!chatId && chiefTurns.has(chatId);
  // The chat the thread shows; one that is not drawn yet (a new chat, made or not) is the one being opened.
  const message = $('#chat-thread') ? sentIn(`chief:${chatId || state.chatId || ''}`) : null;
  const messageWaits = !!message && !!chatId && (replying || queuedIn(`chief:${chatId}`).length > 0);
  const messageNew = sentArrives(arrivals.chief, $('#chat-thread'), chatId || null, message);
  updateChatQueued($('#chat-thread'), chatId ? `chief:${chatId}` : null, messageWaits ? message : null, messageNew);
  drawStatusLine($('#chat-thread'), chatId ? `chief:${chatId}` : null, CHIEF_COLOR, replying ? { chief: chatId } : null, false, replying ? chiefTurns.get(chatId) : message ? 'Working' : '');
  updateChatSent($('#chat-thread'), messageWaits ? null : message, `chief:${chatId || ''}`, messageNew);
  if (!onScreen($('#group-thread'))) arrivals.group.leave(); // a group's chat tells what it draws itself (groups.js): here, only that it was left
}
// stop: the bot's running run (its id), or the Chief's reply ({ chief: <chat id> }). held: the run waits for the
// owner's answer (its `waitingFor`), and the line says that until the field goes. doing: what the Chief is doing,
// which is its whole line; its opening line stands where that has no words (opening-line.js chiefLine).
function drawStatusLine(thread, chat, color, stop, held = false, doing = '') {
  if (!thread) return;
  // The owner's message is on its way and nothing is at work here yet: "Working", with nothing to stop.
  if (!doing && !stop && chat && sentIn(chat)) doing = 'Working';
  const kept = chat ? openingLines.of(chat) : '';
  const html = OpeningLine.status(stop && typeof stop === 'object' ? OpeningLine.chiefLine(doing, kept) : kept || doing, color, stop, held);
  const was = $('.status-line', thread);
  if (!was && !html) return;
  // What the line stands above: the waiting messages, else the cards, else nothing (it is last).
  const next = $('.chat-queued', thread) || $('.chat-needs', thread);
  const inPlace = was && (next ? was.nextElementSibling === next : was === thread.lastElementChild);
  if (was && inPlace && thread.dataset.statusLine === html) return;
  const atBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 160;
  was?.remove();
  thread.dataset.statusLine = html;
  if (!html) return;
  if (next) next.insertAdjacentHTML('beforebegin', html); else thread.insertAdjacentHTML('beforeend', html);
  const stopRunBtn = $('[data-stop-run]', thread);
  if (stopRunBtn) stopRunBtn.onclick = () => stopRun(stopRunBtn.dataset.stopRun);
  const stopChiefBtn = $('[data-stop-chief]', thread);
  if (stopChiefBtn) stopChiefBtn.onclick = () => stopChief(stopChiefBtn.dataset.stopChief);
  // "Waiting for your OK" in a bot's chat takes the owner to the card it waits for, else to Needs you.
  const waits = held && String(chat).startsWith('bot:') ? (next ? next.previousElementSibling : thread.lastElementChild) : null;
  if (waits) {
    waits.title = 'Show what it waits for';
    waits.onclick = (e) => { if (e.target.closest('button')) return; if (!toHeldCard(thread, chat.slice(4))) setView('needs'); };
  }
  if (atBottom) thread.scrollTop = thread.scrollHeight;
}

// ---------- the sent message, there at once ----------

// The owner's message from Send until the botdot server answered, by chat: "bot:<id>", "chief:<chatId>" ("chief:"
// for a chat that is not made yet) or "group:<id>". One message goes at a time in a chat (sendingIn), so a chat has
// at most one. The page draws the owner's own words and files, as a waiting message is drawn, and decides nothing
// else: this is the one place where it draws before the server spoke.
// key: the message's (messageKey). It ties the bubble to the answer of its own request, which puts the server's
// version in its place (sentOver): the run, the waiting message, the message of the chat.
// had: how many of the chat's own messages had these words and files on Send. The server's runs, waiting entries
// and messages carry no key, so when one more of them is there (the feed brought it before the request answered)
// the bubble gives way to it, and the message is drawn once.
const sentNow = new Map(); // chat -> { key, text, attachments, had }
// A message whose send failed, by its key: sent again as it is, it is the same message, and botdot may have taken
// it the first time. What the chat held before the first Send still counts, so its run that is there by now is it.
const sentBefore = new Map(); // key -> had
const sentFiles = (list) => (Array.isArray(list) ? list : []).map((f) => f?.file).join('\n');
const sentLike = (sent, m) => String(m?.text ?? '').trim() === sent.text && sentFiles(m?.attachments) === sentFiles(sent.attachments);
// theirs(chat): the owner's messages the chat holds, as the server has them, each `{ text, attachments }`.
function sentAtOnce(chat, { key, text, attachments }, theirs = ownWords) {
  const sent = { key, text: String(text || '').trim(), attachments: Array.isArray(attachments) ? attachments : [] };
  sent.had = sentBefore.get(key) ?? theirs(chat).filter((m) => sentLike(sent, m)).length;
  sentNow.set(chat, sent);
}
// Its chat was made, and has an id now.
function sentMoved(from, to) {
  const sent = sentNow.get(from);
  if (!sent) return;
  sentNow.delete(from);
  sentNow.set(to, sent);
}
// The request answered, or failed (went: false): that message's bubble is over.
function sentOver(chat, key, went = true) {
  const sent = sentNow.get(chat);
  if (sent?.key !== key) return;
  sentNow.delete(chat);
  if (went) { sentBefore.delete(key); return; }
  if (sentBefore.size > 50) sentBefore.clear(); // messages given up long ago
  sentBefore.set(key, sent.had);
}
// The message to draw in a chat: none, or none any more once the server's is among the chat's own.
function sentIn(chat, theirs = ownWords) {
  const sent = sentNow.get(chat);
  return sent && theirs(chat).filter((m) => sentLike(sent, m)).length <= sent.had ? sent : null;
}
// The owner's own messages in a bot's chat or a Chief chat, as the page holds them from the server: the runs the
// owner's message started and the messages that wait; in the Chief's chat what the thread was read with (showChat).
function ownWords(chat) {
  const [kind, id] = chatParts(chat);
  const waiting = queuedIn(chat);
  if (kind === 'bot') {
    const waits = new Set(waiting.map((q) => q.id));
    const mine = (r) => r.botId === id && !waits.has(r.id) && r.customPrompt !== false && !r.jobName && !r.continues
      && !['schedule', 'bot', 'replies'].includes(r.trigger) && r.startedBy !== 'chief';
    return [...state.runs.filter(mine).map((r) => ({ text: r.prompt, attachments: r.attachments })), ...waiting];
  }
  const thread = $('#chat-thread');
  return [...(kind === 'chief' && thread?.dataset.chat === id ? thread._mine || [] : []), ...waiting];
}
// Its bubble: the words and the files, faded as a waiting message is, and nothing under it. mentions: the chat its
// mentions are matched in.
function sentHTML(sent, mentions) {
  const [kind, id] = chatParts(mentions);
  return `<div class="bubble-row from-me" data-sent><div class="stack mine"><div class="bubble from-me waits">${escMentions(sent.text, kind === 'chief' ? CHIEF_BOT.id : kind === 'group' ? mentions : id)}${filesHTML(sent.attachments)}</div></div></div>`;
}
// The bubble in a bot's chat or the Chief's while nothing is at work there: above the working line, where the
// server's version will stand. Placed after the line is (placeStatusLines), which is then where a line stands:
// before the waiting messages, else the cards, else last. sent: null takes it away. arrives: it is new on screen,
// and its row moves once (a reply arrives); drawn again, also in a box that was built again, it stands.
function updateChatSent(thread, sent, chat, arrives = false) {
  if (!thread) return;
  let box = $('.chat-sent', thread);
  if (!sent) { box?.remove(); return; }
  if (!box) { box = document.createElement('div'); box.className = 'chat-sent'; }
  const next = $('.chat-queued', thread) || $('.chat-needs', thread);
  const line = thread.dataset.statusLine ? (next ? next.previousElementSibling : thread.lastElementChild) : null;
  const above = line && line !== box ? line : next;
  if (above ? box.nextElementSibling !== above : box !== thread.lastElementChild) { if (above) above.before(box); else thread.append(box); }
  const sig = JSON.stringify([chat, sent, mentionSig()]);
  if (box.dataset.sig === sig) return;
  box.dataset.sig = sig;
  box.innerHTML = sentHTML(sent, chat);
  if (arrives) arrive($('[data-sent]', box));
}
// On Send: the bubble and the line are drawn, and the chat shows its end.
function showSent(thread) {
  placeStatusLines();
  if (thread) thread.scrollTop = thread.scrollHeight;
}

// ---------- a reply arrives ----------

// A reply that is new on screen arrives: its row fades in and rises into its place, once (style.css, `.arrives`).
// A reply is told by its id: the run's in a bot's chat, the message's place in a Chief chat, the turn's in a group.
// It is new when its id was not drawn before in this open chat and it stands after every reply that was. In a chat
// that was open with no reply at all, the first ones are new. So nothing is new when the chat opens, when its
// lists are read again and its markup is built again, when older messages are loaded above, or when the chat is
// read from scratch. Android's Arrivals has the same rule.
// The owner's own messages are no replies and are not among the ids. The one on its way (sentAtOnce) arrives when
// it is first drawn, on Send; the server's version that takes its place stands where it stood and does not.

// The replies that are new among `replies` (ids, oldest first), in a chat that drew `seen` before: those after the
// last one it drew. In a chat that drew none, all of them. None when it drew some and none of those is left: the
// chat was read from scratch.
function newReplies(seen, replies) {
  if (!seen.size) return replies;
  const last = replies.findLastIndex((id) => seen.has(id));
  return last < 0 ? [] : replies.slice(last + 1);
}
// What one place on the page drew of the chat that is open in it. The chat says what it draws every time it
// draws: its replies first (replies), then the owner's message on its way (sent). chat: which chat; null for a
// new chat of the Chief's that has no id yet.
function arrivalsKeeper() {
  let chat; // undefined: no chat is open here
  let seen = null; // null until the chat was drawn once with what it holds
  let sent; // the key of the message on its way, as drawn last; undefined until the open chat said it once
  const leave = () => { chat = undefined; seen = null; sent = undefined; };
  const open = (to) => {
    if (to === chat) return;
    // A new chat that got its id by the message on its way is the same chat. Any other is another one.
    if (!(chat === null && sent != null)) leave();
    chat = to;
  };
  return {
    // The chat was left: another view, another page, or the list over it. Drawn again, it opens.
    leave,
    // The ids of the replies drawn, oldest first: those that are new with this draw.
    replies(to, ids) {
      open(to);
      if (!seen) { seen = new Set(ids); return []; } // the chat opens: what is there stands still
      const fresh = newReplies(seen, ids);
      for (const id of ids) seen.add(id);
      return fresh;
    },
    // The key of the owner's message on its way, or none: whether it is new with this draw. One that was on its
    // way when the chat opened is not, and a failed one sent again is.
    sent(to, key = null) {
      open(to);
      if (!seen) return false;
      const fresh = sent !== undefined && key != null && key !== sent;
      sent = key ?? null;
      return fresh;
    },
  };
}
// One for each place a chat is drawn in. Each is told its own chat only, so one never forgets for another.
const arrivals = { bot: arrivalsKeeper(), chief: arrivalsKeeper(), group: arrivalsKeeper() };

// The replies of a bot's chat, from its runs as they are drawn, oldest first: a run that ended. One at work has
// its working line, and a message that waits is no run yet.
const botReplyIds = (runs) => runs.filter((r) => r.status !== 'running' && r.status !== 'queued').map((r) => r.id);
// The replies of a Chief chat, each by its place in the whole chat (the chat may have come in part, from `from`
// on): every message but the owner's own and a reply that is still being written.
const chiefReplyIds = (messages, from = 0) => messages.flatMap((m, i) => (m.role === 'user' || m.pending ? [] : [String(from + i)]));

// A chat that is not on screen was left: under another view, under the panel or, on a phone, under the list.
const onScreen = (el) => !!el && el.getClientRects?.().length !== 0;
// What a chat's thread draws now: the ids of its replies that arrive with it.
function repliesArrive(keeper, thread, chat, ids) {
  if (!onScreen(thread)) { keeper.leave(); return []; }
  return keeper.replies(chat, ids);
}
// And whether the owner's message on its way (sentIn) arrives with it.
function sentArrives(keeper, thread, chat, sent) {
  if (!onScreen(thread)) { keeper.leave(); return false; }
  return keeper.sent(chat, sent?.key);
}
// The row moves. With reduced motion asked for it is not marked at all: the style switches the movement off too,
// and no mark is left to move when the setting changes.
function arrive(row) {
  if (row && !reducedMotion()) row.classList.add('arrives');
}
// The Chief's chat as it is drawn: one row for each message, the owner's own with `.mine` and a reply that is
// still being written with `data-pending`. A reply that is new arrives, its whole row. Called wherever a reply
// is drawn there (showChat, followChief) and each time the page places the chat's end.
function chiefArrives(thread) {
  if (!onScreen(thread)) { arrivals.chief.leave(); return; }
  const rows = $$(':scope > .bubble-row', thread);
  const from = thread._from || 0;
  const ids = chiefReplyIds(rows.map((row) => ({ role: $(':scope > .mine', row) ? 'user' : 'chief', pending: 'pending' in row.dataset })), from);
  const fresh = new Set(repliesArrive(arrivals.chief, thread, thread.dataset.chat || null, ids));
  if (fresh.size) rows.forEach((row, i) => { if (fresh.has(String(from + i))) arrive(row); });
}

// Stop a run. When it can't be (the server is away, the run is over) the chat stays as it is.
async function stopRun(id) {
  try { await api(`/runs/${encodeURIComponent(id)}/stop`, { method: 'POST' }); toast('Stopping…'); }
  catch (e) { toast(e.message, true); }
}
