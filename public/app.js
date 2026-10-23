// bot-dot front end: vanilla JS, no build step.
// This file holds the page's state, its helpers and its views; each feature is a file of its own, loaded after it in the
// order of index.html, and the start of the page (boot.js) comes last (#77).
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const state = {
  view: 'chief',
  panel: null, // the settings panel beside the chat: null (closed), 'settings' or 'jobs' (panel.js)
  botId: null,
  groups: [], // the groups, each with what its chat holds now (GET /api/group-chats, groups.js); none against a server without them
  groupId: null, // the group whose chat is open (view 'group')
  roomId: null, // the shared room whose chat is open (view 'rooms', rooms.js); none: the list of rooms
  inbox: {}, // bot id → notes waiting for its next run
  botStreams: [], // the streams of the bot's runs that are going (bot-chat.js followBotRuns)
  chatNew: false,
  chats: [],
  chatId: null,
  chatStream: null,
  chiefUnread: 0, // new replies in all the Chief's chats, for its one row (unread.js)
  features: [], // what this botdot server can do (GET /api/version)
  checkup: null, // the checkup's setting, as the server last said it (GET /api/settings/checkup, the feed's `checkup`)
  approvals: null, // what waits for the owner, as the live feed lists it (hello, approvals): a waiting job's `then` is there
  bots: [],
  runs: [],
  status: null,
  selectedRun: null,
  runStream: null,
};

// ---------- helpers ----------

// botdot does not answer: a request got no answer. One standing line says so, beside the logo and, where
// the list is hidden, above the message box (composerHTML). It goes when a request is answered again or the
// live feed opens again (followFeed). A failed request alone shows it: a proxy can hold the feed open.
const away = { on: false };
function setAway(on) {
  if (away.on === on) return;
  away.on = on;
  drawAway();
}
function drawAway() {
  $('#away')?.classList.toggle('hidden', !away.on);
  $$('.away-line').forEach((el) => el.classList.toggle('hidden', !away.on));
  const out = signedOut.on && !away.on; // "Can't reach botdot" wins: nobody knows then what Claude is
  $('#signed-out')?.classList.toggle('hidden', !out);
  $$('.claude-line').forEach((el) => el.classList.toggle('hidden', !out));
}
// Claude is signed out, as the feed says it (hello.claude, the `claude` event): no bot can work. One line stands
// where "Can't reach botdot" stands, with the way to sign in, until Claude is signed in again.
const signedOut = { on: false };
const SIGNED_OUT = "Claude is signed out: bots can't work.";
const signedOutHTML = () => `${esc(SIGNED_OUT)} <button type="button" data-sign-in>Sign in</button>`;
// claude: `{ loggedIn }`. Anything else says nothing, and the line stays as it is.
function setSignedOut(claude) {
  if (typeof claude?.loggedIn !== 'boolean' || signedOut.on === !claude.loggedIn) return;
  signedOut.on = !claude.loggedIn;
  drawAway();
}

// A request to the botdot server. What it throws is a sentence for the owner, never the browser's own:
// "Can't reach botdot." when botdot was not reached (unreached), else the server's sentence (refused), or
// the status when the answer had none: then nobody knows whether botdot did it (unsure, for a 5xx).
// Not reached: no answer came, or a gateway answered in botdot's place that it is not there (502, 503
// without botdot's sentence), as Tailscale Serve does while botdot is down. A 504 is a gateway that
// gave up waiting: botdot is away, and may have taken the request.
async function api(path, opts = {}) {
  const unreached = () => Object.assign(new Error("Can't reach botdot."), { unreached: true });
  let res;
  try {
    res = await fetch(`/api${path}`, {
      ...opts,
      headers: { 'Content-Type': 'application/json', 'X-Bot-Dot': '1', ...(opts.headers || {}) },
      body: opts.body ? JSON.stringify(opts.body) : undefined,
    });
  } catch {
    setAway(true);
    throw unreached();
  }
  const data = await res.json().catch(() => ({}));
  // The front door's session ended (signed out, or elsewhere): its sign-in page, the only way back in (ADR 028).
  if (res.status === 401 && data.signIn === '/sign-in') { location.assign(`/sign-in${typeof joinHash === 'function' ? joinHash() : ''}`); throw unreached(); }
  // The admin paused the account while this page was open: the front door's paused page, with its way out (#466).
  if (res.status === 503 && data.paused === true) { location.reload(); throw unreached(); }
  const said = !res.ok && typeof data.error === 'string' && data.error.trim();
  const notThere = !res.ok && !said && [502, 503].includes(res.status); // a gateway: botdot was not reached
  const gaveUp = !res.ok && !said && res.status === 504; // a gateway: botdot did not answer in time
  setAway(notThere || gaveUp);
  if (notThere) throw unreached();
  if (!res.ok) {
    // state: the server's word for what stands in the way (the viewer's "gone", "computer-off": #251).
    throw Object.assign(new Error(said || `botdot couldn't do that (${res.status}).`), { status: res.status, refused: !!said, unsure: !said && res.status >= 500 },
      typeof data.state === 'string' ? { state: data.state } : {});
  }
  return data;
}

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// A bot is a head in its colour whose face shows its state (idle, working, waiting, needs_you, failed,
// paused), with its hat. figure.js draws it from the server's figure definition. The Chief is coral.
const CHIEF_COLOR = '#d85a30';
// The Chief where it's shown like a bot: a sender, a mention.
const CHIEF_BOT = { id: Mentions.CHIEF, name: 'Chief of Staff', color: CHIEF_COLOR, jobs: [] };
// ---------- the Chief's name
// The name the owner gave the Chief (#41): `chief.name` of GET /api/chief and the feed's `chief_name`. Without one
// (also from a server from before it) it is the role's own. CHIEF_BOT carries it, so mentions and chips say it too.
const CHIEF_ROLE = 'Chief of Staff';
const chiefName = () => CHIEF_BOT.name;
// Takes the name the server said: true when it changed, and what shows it is to be drawn again.
function takeChiefName(name) {
  const n = typeof name === 'string' && name.trim() ? name.trim() : CHIEF_ROLE;
  if (n === CHIEF_BOT.name) return false;
  CHIEF_BOT.name = n;
  return true;
}
// The head of the Chief's chat, which is drawn once.
function drawChiefName() { const h = $('#view-chief .chat-head h2'); if (h) h.textContent = chiefName(); }
// A search in the list finds the Chief by its name and by its role.
const chiefMatches = (q) => CHIEF_ROLE.toLowerCase().includes(q) || chiefName().toLowerCase().includes(q);
// ---------- end of the Chief's name
const BOT_COLORS = [['#1d9e75', 'Teal'], ['#378add', 'Blue'], ['#7f77dd', 'Purple'], ['#d4537e', 'Pink'], ['#e24b4a', 'Red'], ['#ef9f27', 'Amber'], ['#639922', 'Green'], ['#888780', 'Grey']];
// outfit: its hat ({ hat }: the name of one in the server's kit, or one the Chief drew), when it has one.
// bot: its id, for a head that stays on the page while nothing draws it again (a run's): redrawMarks then finds it.
const botFigure = (color, st = 'idle', size = '', outfit = null, bot = '') => `<div class="avatar head ${size}"${bot ? ` data-bot="${esc(bot)}" data-st="${esc(st)}" data-size="${esc(size)}"` : ''}>${Figure.svg(st, color, outfit)}</div>`;
// The definition every bot is drawn from. Without it (an older server, a broken file) bots are bare
// heads; it's asked for again a few times, in case the server was only away for a moment. When it
// arrives late, Figure.use draws the bare heads on the page again from it.
async function loadFigure(triesLeft = 5) {
  try { Figure.use(await api('/figure')); } catch (e) {
    console.warn(e.message);
    if (triesLeft > 0) setTimeout(() => loadFigure(triesLeft - 1), 30_000);
  }
}
// The Chief wears the one outfit the figure definition gives it, also when the definition arrives late.
const chiefFigure = (size = '') => botFigure(CHIEF_COLOR, state.chiefBusy ? 'working' : 'idle', size, Figure.CHIEF);
// A bot (or { id, color, name } from the server) in running text: its small still head with its hat, and its name, escaped.
const botById = (id) => state.bots.find((x) => x.id === id);
const colorOf = (b) => botById(b?.id)?.color || b?.color || '#888780'; // its colour now, not when a run or message was saved
// Its hat now: the bot's own, the Chief's fixed one, or none for a bot that is gone.
const isChief = (b) => b?.id === CHIEF_BOT.id;
const outfitOf = (b) => botById(b?.id)?.outfit || (isChief(b) ? Figure.CHIEF : null);
const botMark = (b) => Figure.small(colorOf(b), outfitOf(b), botById(b?.id)?.id);
// A bot's colour or hat changed: its small heads on the page are drawn again where they stand, whatever
// they are part of (a folded line, a mention, a "Needs you" card, a tile's chat link), so that nothing
// around them is redrawn: a draft, the scroll position and an open fold stay as they are. So are the
// heads of its runs (an open run in Activity), each with the face it had.
const looks = new Map(); // bot id -> its colour and outfit when its marks were last drawn
function redrawMarks() {
  for (const b of state.bots) {
    const look = b.color + JSON.stringify(b.outfit || '');
    const was = looks.get(b.id);
    looks.set(b.id, look);
    if (was === undefined || was === look) continue;
    for (const el of $$(`svg.fig-small[data-bot="${CSS.escape(b.id)}"]`)) el.outerHTML = botMark(b);
    for (const el of $$(`.avatar.head[data-bot="${CSS.escape(b.id)}"]`)) el.outerHTML = botFigure(b.color, el.dataset.st, el.dataset.size, b.outfit, b.id);
  }
}
const botLabel = (b) => (b ? `${botMark(b)}${esc(b.name)}` : '');
// Mentions (mentions.js): "@" plus a bot, a bot's job or a skill in a chat, matched against the names now.
// chat is the Chief's id or the bot whose chat it is; it says which skills count. In a group's chat ("group:<id>")
// a mention names a member and gives it the turn: only its members, and their jobs, are matched and suggested, and
// "@all" is offered first at the start of a message on a botdot that knows it (feature `group-all`, #124).
// Every page and the Board's tiles can be named too, in the owner's own chats, on a botdot that hands them to the run
// (feature `page-mentions`, #473); never in a shared room, whose people are of other accounts.
const mentionCtx = (chat) => (String(chat).startsWith('group:') ? { chat, bots: groupMembers(groupById(String(chat).slice(6))), library: [], all: state.features.includes('group-all'), ...mentionables() }
  : String(chat).startsWith('room:') ? { chat, bots: roomMentionBots(String(chat).slice(5)), library: [] } // a shared room's bots (rooms.js)
  : { chat, bots: [CHIEF_BOT, ...state.bots], library: state.skillLib || [], account: state.skillAccount || [], ...mentionables() });
function mentionables() {
  if (!state.features.includes('page-mentions')) return {};
  return { pages: state.mentionPages || [], tiles: (state.dash?.tiles || []).filter((t) => t.approved !== false).map(({ id, title, kind }) => ({ id, title, kind })) };
}
// Every page of the account, for mentions (#473): fetched with the page's data, at most once a minute, and again after a
// page is saved (feed.js).
function loadMentionPages() {
  if (!state.features.includes('page-mentions') || Date.now() - (state.mentionPagesAt || 0) < 60000) return null;
  state.mentionPagesAt = Date.now();
  return api('/pages').then(({ pages }) => { state.mentionPages = pages.map((p) => ({ bot: p.botId, slug: p.slug, title: p.title })); })
    .catch(() => { state.mentionPagesAt = 0; });
}
// The owner's own message with its mentions drawn: a bot as its small head and name, a job or a skill tinted; anything
// else plain (escaped). Bot and Chief replies stay as they are.
// A skill it runs or a "/btw" at its start is a chip (markOf).
function escMentions(text, chat) {
  const s = String(text ?? '');
  const mark = markOf(s, chat);
  if (!mark && (!chat || !s.includes('@'))) return esc(s);
  const ctx = mentionCtx(chat);
  let out = mark ? `${esc(s.slice(0, mark.start))}${markHTML(mark)}` : '', at = mark ? mark.end : 0;
  for (const m of s.includes('@') ? Mentions.findMentions(s, ctx).filter((x) => x.start >= at) : []) {
    out += esc(s.slice(at, m.start)) + (m.kind === 'bot'
      ? `<span class="mention" title="${esc(m.text)}">${botLabel(ctx.bots.find((b) => b.id === m.bot))}</span>`
      : `<span class="mention tint">${esc(m.text)}</span>`);
    at = m.end;
  }
  return out + esc(s.slice(at));
}
// The chip at the start of the owner's message in a chat (Mentions.commandMark): the skill sending it runs, on a botdot
// that runs them, or "/btw". null for none.
function markOf(text, chat) {
  if (!chat || !String(text ?? '').trimStart().startsWith('/')) return null;
  const m = Mentions.commandMark(text, mentionCtx(chat));
  return m && (m.kind !== 'skill' || state.features.includes('skill-commands')) ? m : null;
}
const markHTML = (m) => `<span class="cmd">${esc(m.text)}</span>`;
// What mentions match against, so a chat redraws when a name changes (a renamed bot's old mentions go plain).
function mentionSig() {
  const bots = state.bots.map((b) => [b.name, ...(b.jobs || []).map((j) => j.name), b.useSkills === false ? '' : (b.skills || []).join(',')].join('/'));
  const more = mentionables();
  return [...bots, ...(state.skillLib || []).map((k) => k.name), ...(more.pages || []).map((p) => `${p.bot}/${p.title}`), ...(more.tiles || []).map((t) => t.title)].join('|');
}
// The skill library, for mentions: fetched with the page's data, at most once a minute.
function loadSkillLib() {
  if (Date.now() - (state.skillLibAt || 0) < 60000) return null;
  state.skillLibAt = Date.now();
  return api('/skills').then(({ library, machine }) => {
    const short = ({ name, description }) => ({ name, description });
    state.skillLib = library.map(short);
    state.skillAccount = (machine || []).map(short); // for "/" (#236)
  }).catch(() => { state.skillLibAt = 0; });
}
// "Messaged Coder, Home Keeper" (each with its small head) above a reply: every bot the run messaged, and how it gets there when that's the same for all.
function messagedLabel(r) {
  const to = r.sentToAll?.length ? r.sentToAll : r.sentTo ? [r.sentTo] : [];
  if (!to.length) return '';
  // A note wakes the bot once it is free (#225), as a message that waits does; it only gets no answer back.
  const how = to.every((t) => t.delivered === 'queued') ? (to.length === 1 ? ' · it picks it up when free' : ' · they pick it up when free')
    : to.every((t) => t.delivered?.startsWith('inbox')) ? (to.length === 1 ? ' · a note it reads when free' : ' · a note they read when free') : '';
  return `<div class="bot-msg-label">Messaged ${to.map(botLabel).join(', ')}${how}</div>`;
}
// Every bot a run messaged, each once.
const sentTo = (r) => (r.sentToAll?.length ? r.sentToAll : r.sentTo ? [r.sentTo] : []);
// The folded line of a run another bot or the Chief started: "Replied to Fleet Doctor" (with its small head), or whom else it messaged.
function exchangeLabel(r) {
  const to = sentTo(r);
  if (!to.length) return r.startedBy === 'chief' ? `Replied to ${botLabel(sender(r))}` : 'Replied'; // the Chief reads the reply itself
  return to.every((t) => t.id === sender(r)?.id) ? `Replied to ${botLabel(sender(r))}` : `Messaged ${to.map(botLabel).join(', ')}`;
}
// A folded line between bots: who, then the first words of what it opens to, cut to the line (gone once it is open).
const foldSummary = (who, text) => { const peek = plain(text).slice(0, 160); return `<summary class="fold-line"><span class="fold-who">${who}</span>${peek ? `<span class="fold-peek">${esc(peek)}</span>` : ''}</summary>`; };
// Who sent the task that started a run, when it wasn't the owner: another bot, or the Chief (it hands tasks to bots).
const sender = (r) => (r.trigger === 'bot' && r.fromBot ? r.fromBot : r.startedBy === 'chief' ? CHIEF_BOT : null);
// Notes other bots left: one folded line, "Read notes from Web Surfer, Coder" (each with its small head), that opens to what each said.
// foot: a line under it (the notes that wait: how long, and "Run now").
function notesFoldHTML(notes, heading, foot = '') {
  if (!notes?.length) return '';
  const who = [...new Map(notes.map((n) => [n.fromId || n.from, { id: n.fromId, name: n.from, color: n.color }])).values()];
  const fold = `<details class="notes-fold"><summary>${heading} ${who.map(botLabel).join(', ')}</summary>
    ${notes.map((n) => `<div class="note"><div class="bot-msg-label">${botLabel({ id: n.fromId, name: n.from, color: n.color })}${n.at ? ` · ${esc(msgTime(n.at))}` : ''}</div><div class="bubble from-other-bot">${esc(n.text)}</div></div>`).join('')}
  </details>`;
  return `<div class="bubble-row from-me">${foot ? `<div class="notes-wait">${fold}${foot}</div>` : fold}</div>`;
}
// The notes that wait for a bot, at the bottom of its chat (#225): how long the oldest has waited, and, from a botdot
// that wakes bots for their notes, "Run now", which starts it with them (or once it is free).
function waitingNotesHTML(botId, notes) {
  if (!notes?.length) return '';
  const oldest = notes.map((n) => n.at).filter(Boolean).sort()[0];
  const runNow = state.features.includes('notes-wake') ? `<button data-run-notes="${esc(botId)}">Run now</button>` : '';
  return notesFoldHTML(notes, 'Notes waiting:', oldest || runNow ? `<div class="bubble-meta">${oldest ? `<span>Oldest ${esc(ago(oldest))}</span>` : ''}${oldest && runNow ? ' · ' : ''}${runNow}</div>` : '');
}
// A run's bot: at work while the run goes on, with the failed face if it failed.
const runFigure = (r, size) => botFigure(botById(r.botId)?.color || r.botColor, r.status === 'running' ? 'working' : r.status === 'error' ? 'failed' : 'idle', size, botById(r.botId)?.outfit, botById(r.botId)?.id);

function ago(iso) {
  if (!iso) return '—';
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 0) return inFuture(iso);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(iso).toLocaleDateString();
}

function inFuture(iso) {
  const s = (new Date(iso) - Date.now()) / 1000;
  if (s < 60) return 'in <1m';
  if (s < 3600) return `in ${Math.round(s / 60)}m`;
  if (s < 86400) return `in ${Math.floor(s / 3600)}h ${Math.round((s % 3600) / 60)}m`;
  return `in ${Math.round(s / 86400)}d`;
}

function fmtTime(iso) {
  return iso ? new Date(iso).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit', month: 'short', day: 'numeric' }) : '—';
}

const dur = (ms) => (ms == null ? '—' : ms < 60000 ? `${Math.round(ms / 1000)}s` : `${Math.floor(ms / 60000)}m ${Math.round((ms % 60000) / 1000)}s`);

// The key of a message the owner sends (docs/api.md, "A message sent twice"): new for each message, and sent
// again with it when its send failed, so that botdot takes a message once whose answer was lost. The page
// always sends it: a server from before ignores it.
const messageKey = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('');

// Copy a whole message (its Markdown, as written) with the small copy icon under it.
// The text colour that reads best on a filled colour: near-black or white, whichever contrasts more (WCAG).
function inkOn(hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
  if (!m) return '#fff';
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const n = parseInt(m[1], 16);
  const l = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return 1.05 / (l + 0.05) >= (l + 0.05) / 0.0556 ? '#fff' : '#111'; // #111's luminance is about 0.0056
}
// Quick answers under the newest reply ([[choices: …]], see lib/choices.js): tap one to send it. The one at
// `yes` is filled with the colour of the bot that asks.
const choicesHTML = (choices, yes = -1, color = '') => (choices?.length
  ? `<div class="choices">${choices.map((c, i) => `<button class="btn${i === yes && color ? ' yes' : ''}" data-choice="${esc(c)}"${i === yes && color ? ` style="--yes:${esc(color)};--yes-ink:${inkOn(color)}"` : ''}>${esc(c)}</button>`).join('')}</div>`
  : '');
// Several questions at once ([[ask: …]]): a card under the newest reply, a box under each question.
const questionsHTML = (questions) => (questions?.length
  ? `<div class="ask-card card">${questions.map((q) => `<label><span>${esc(q)}</span><textarea rows="1" data-q="${esc(q)}"></textarea></label>`).join('')}<button class="btn primary sm" disabled>Send</button></div>`
  : '');
// send(text, key) resolves to whether it went (sendFrom). The buttons and the card go only then: after a send
// that failed they are still there to use, and send the same message again: an answer keeps its key for as
// long as it is drawn, a card for as long as its answers are the same.
function wireChoices(root, send) {
  $$('[data-choice]', root).forEach((b) => {
    const key = messageKey();
    b.onclick = async () => {
      const all = $$('[data-choice]', b.closest('.choices'));
      all.forEach((x) => { x.disabled = true; }); // one tap, one message
      if (await send(b.dataset.choice, key)) b.closest('.choices')?.remove();
      else all.forEach((x) => { x.disabled = false; });
    };
  });
  $$('.ask-card', root).forEach((card) => {
    const boxes = $$('textarea', card);
    const btn = $('button', card);
    boxes.forEach((ta, i) => {
      ta.oninput = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + ta.offsetHeight - ta.clientHeight, 200) + 'px'; btn.disabled = !boxes.some((b) => b.value.trim()); };
      // Enter goes to the next box, and sends from the last one (Shift+Enter: a new line). On a phone it's a new line.
      ta.onkeydown = (e) => {
        if (e.key !== 'Enter' || e.shiftKey || e.isComposing || matchMedia('(pointer: coarse)').matches) return;
        e.preventDefault();
        if (boxes[i + 1]) boxes[i + 1].focus(); else btn.click();
      };
    });
    let last = null; // { text, key }: what the card sent last, while it has not gone
    btn.onclick = async () => {
      btn.disabled = true;
      // Each question with its answer (see lib/choices.js). The answers stay in their boxes until it went.
      const text = boxes.map((b) => `${b.dataset.q}\n→ ${b.value.trim() || '–'}`).join('\n\n');
      if (last?.text !== text) last = { text, key: messageKey() }; // changed answers are a new message
      if (await send(text, last.key)) card.remove();
      else btn.disabled = false;
    };
  });
}
// What the document page draws with.
const docPageTools = () => ({ api, md, esc, toast, msgTime, mdBlocks, chiefName, features: state.features, botName: (id) => botById(id)?.name });
const copyBtn = (text) => `<button class="copy-btn" data-copy="${esc(text)}" title="Copy" aria-label="Copy">${ICON.copy}</button>`;
async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch { /* not a secure page: the old way */ }
  const t = Object.assign(document.createElement('textarea'), { value: text });
  t.style.cssText = 'position:fixed;opacity:0';
  document.body.append(t);
  t.select();
  const ok = document.execCommand('copy');
  t.remove();
  return ok;
}
// A Copy button: its data-copy, or a code block's text (#285), also while its diagram is drawn in its place.
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-copy], .code-copy');
  if (!b) return;
  e.stopPropagation();
  const text = b.dataset.copy ?? b.closest('.code-block')?.querySelector('pre')?.textContent ?? '';
  if (!(await copyText(text))) return toast("Couldn't copy", true);
  b.innerHTML = ICON.copied;
  setTimeout(() => (b.innerHTML = ICON.copy), 1500);
}, true);

// 👍 or 👎 on an unasked Chief message: filled at once, stored on the server, and back as it was when the server
// refuses or can't be reached. Every app hears the rating on the live feed (followFeed).
document.addEventListener('click', async (e) => {
  const b = e.target.closest('.rate [data-rating]');
  if (!b) return;
  const el = b.closest('.rate');
  const chatId = el.closest('#chat-thread')?.dataset.chat;
  if (!chatId) return;
  const before = Ratings.shown(el);
  const rating = Ratings.next(before, b.dataset.rating);
  Ratings.show(el, rating);
  try {
    await api(`/chief/chats/${encodeURIComponent(chatId)}/messages/${el.dataset.rate}/rating`, { method: 'PUT', body: { rating } });
  } catch {
    if (Ratings.shown(el) === rating) Ratings.show(el, before); // unless a later tap or the feed changed it since
    toast("Couldn't save your rating", true);
  }
});

// A button whose answer waits on the server (Bitwarden can take several seconds): it says `words` ("Approving…"),
// and it and the buttons beside it can't be pressed again, until `work` ends. A second press meanwhile does nothing.
// With `spin`, a spinner turns in it too: a yes that makes a call's key or a notify address's secret in the Vault (#154).
async function whileBusy(button, words, work, spin = false) {
  if (!button) return work();
  if (button.dataset.busy) return undefined;
  const beside = [...(button.parentElement?.querySelectorAll('button') || [button])];
  const was = button.textContent;
  const before = beside.map((b) => b.disabled);
  button.dataset.busy = '1';
  beside.forEach((b) => { b.disabled = true; });
  button.textContent = words;
  if (spin) button.classList.add('spin');
  try { return await work(); } finally {
    delete button.dataset.busy;
    beside.forEach((b, i) => { b.disabled = before[i]; });
    button.textContent = was;
    if (spin) button.classList.remove('spin');
  }
}

// A small pill in the corner for work that runs on after its dialog or button is done (Bitwarden's unlock, a page's
// schedule): `busy` while it runs, `ok` (gone by itself), or `err`, which a tap tries again with `retry`.
function cornerPill(kind, text, retry = null) {
  let el = $('#corner-pill');
  if (!el) { el = document.createElement('div'); el.id = 'corner-pill'; document.body.append(el); }
  clearTimeout(cornerPill.timer);
  el.className = `corner-pill ${kind}`;
  el.innerHTML = `<span class="dot"></span><span>${esc(text)}</span>${kind === 'err' ? '<button type="button" class="x" aria-label="Close">✕</button>' : ''}`;
  el.onclick = kind === 'err' ? (e) => { el.remove(); if (retry && !e.target.closest('.x')) retry(); } : null;
  if (kind === 'ok') cornerPill.timer = setTimeout(() => { el.classList.add('gone'); setTimeout(() => el.remove(), 400); }, 2500);
}

// The owner's tap is done at once (#475): `work` runs on with the corner pill saying `words`, then `ok` or the error,
// which a tap tries again with `retry`. Resolves true when it was done, false when it failed.
async function inBackground(words, work, { ok = 'Done', retry = null } = {}) {
  cornerPill('busy', words);
  try {
    const r = await work();
    cornerPill('ok', typeof ok === 'function' ? ok(r) : ok);
    return true;
  } catch (e) {
    cornerPill('err', e.message || "Couldn't do it", retry);
    return false;
  }
}

// A dialog whose save runs on (#478): it goes away at once and the corner pill says `words`, then `ok`. When the
// server refuses, the dialog comes back as it was, nothing typed lost, with the server's sentence in its
// `.req-error` (or a toast); with another dialog open meanwhile, the error pill's tap brings it back. `work` gets
// the dialog's own nodes, to read what they hold. Resolves true when it was saved.
async function setAside(m, words, work, { ok = 'Saved' } = {}) {
  const kept = document.createDocumentFragment();
  kept.append(...m.childNodes);
  m.close();
  cornerPill('busy', words);
  try {
    const r = await work(kept);
    cornerPill('ok', typeof ok === 'function' ? ok(r) : ok);
    return true;
  } catch (err) {
    const back = () => {
      if (m.open) return;
      m.replaceChildren(kept);
      m.showModal();
      const say = $('.req-error', m);
      if (say) { say.textContent = err.message; say.hidden = false; } else toast(err.message, true);
    };
    if (m.open) cornerPill('err', err.message, back); else { $('#corner-pill')?.remove(); back(); }
    return false;
  }
}

function toast(msg, isErr = false) {
  const t = $('#toast');
  t.textContent = msg;
  t.className = `toast${isErr ? ' err' : ''}`;
  // Shown again each time: the newest in the top layer, so over a dialog that opened since the last toast.
  if (t.showPopover) { t.hidePopover(); t.showPopover(); }
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.add('hidden'), 3200);
}

const statusPill = (s) => {
  const map = { running: 'accent pulse', success: 'ok', error: 'err', stopped: 'warn', interrupted: 'warn' };
  return `<span class="pill ${map[s] || ''}">${esc(s)}</span>`;
};

// The times the "When" list of a job offers. Their labels are the server's words for them (lib/cron-words.js).
const CRON_PRESETS = [
  { label: 'Every 30 min', cron: '*/30 * * * *' },
  { label: 'Hourly', cron: '0 * * * *' },
  { label: 'Daily at 09:00', cron: '0 9 * * *' },
  { label: 'Weekdays at 09:00', cron: '0 9 * * 1-5' },
  { label: 'Weekdays at 18:00', cron: '0 18 * * 1-5' },
  { label: 'Nightly at 02:00', cron: '0 2 * * *' },
  { label: 'Mondays at 10:00', cron: '0 10 * * 1' },
];

const MODE_INFO = {
  dontAsk: 'Only the allowed tools; everything else is denied',
  acceptEdits: 'Allowed tools + auto-accept file edits',
  auto: 'Claude decides with its auto-mode safety classifier',
  plan: 'Read-only planning; no changes',
  bypassPermissions: 'Everything allowed; no checks (use with care)',
};

// Tiny markdown renderer. Input is escaped first, so output is safe: mdBlocks reads the escaped text into blocks
// by the rules both apps share (test/fixtures/markdown-cases.json), and mdHTML writes them with its own tags.
// [botId]: a bot's reply, whose file paths open in the viewer (linkPaths, #251).
function md(src, botId) {
  const html = mdHTML(mdBlocks(src));
  return botId ? linkPaths(html, botId) : html;
}

// A reply draft (docs/api.md, "The reply draft") as it can be drawn while it still grows, by the rules both apps
// share (the `stream` cases of test/fixtures/markdown-cases.json; draftSource in Android's Markdown.kt): a code
// block that is not closed yet is drawn as code, a `mermaid` one is plain code even once closed (its fence loses the
// word: a diagram is drawn only once the reply is whole, ADR 041), a table row that is still being written waits, and
// so does the line of a fence that is still being opened. An unclosed ** or [ needs nothing: md draws it as the text it is.
function draftSource(src) {
  const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
  const fences = lines.filter((l) => /^\s*```/.test(l)).length;
  const last = lines.at(-1);
  if (fences % 2) {
    // In a code block: a fence that is still being opened (```mer) or closed (``) waits; the rest is code.
    if (/^\s*`+\w*$/.test(last)) lines.pop();
    if (lines.filter((l) => /^\s*```/.test(l)).length % 2) lines.push('```');
  } else if (/^\s*(\||`{1,2}$)/.test(last)) lines.pop(); // a row of a table is drawn once its line has ended
  return lines.map((l) => l.replace(/^(\s*```)mermaid$/, '$1')).join('\n');
}

// A flat list of blocks: heading (level, text), para (text), item (text, number or null, depth, and task: "done" or
// "todo" for a task item), quote (text),
// rule, code (text, lang: the word after its fence) and table (rows). Android's parseBlocks returns the same for the same text.
function mdBlocks(src) {
  const code = [];
  const lines = esc(src || '').replace(/\r\n?/g, '\n').replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, c) => {
    code.push({ text: c.replace(/\n$/, ''), lang });
    return `\n\u0000${code.length - 1}\u0000\n`;
  }).split('\n');
  const out = [];
  let para = [];
  // The open list: the marker columns of the open items, the last number at each depth, and the last item.
  let stack = [], nums = [], item = null, blank = false;
  const flush = () => { if (para.length) out.push({ type: 'para', text: para.join('\n') }); para = []; };
  const endList = () => { stack = []; nums = []; item = null; blank = false; };
  const isTable = (t) => /^\|.*\|$/.test(t);
  // A line that is only bold is a section title when it is short, is no sentence and something follows it.
  const title = (line, i) => {
    const m = line.match(/^\*\*([^*]+)\*\*:?\s*$/);
    const text = m ? m[1].replace(/:$/, '').trim() : '';
    if (!text || text.replace(/&(amp|lt|gt|quot|#39);/g, '.').length > 60 || /[.!?]$/.test(text)) return '';
    return lines.slice(i + 1).some((l) => l.trim()) ? text : '';
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], t = line.trim();
    let m;
    if ((m = t.match(/^\u0000(\d+)\u0000$/))) { flush(); endList(); out.push({ type: 'code', text: code[m[1]]?.text ?? '', lang: code[m[1]]?.lang ?? '' }); }
    else if (isTable(t)) {
      flush(); endList();
      const rows = [];
      for (; i < lines.length && isTable(lines[i].trim()); i++) {
        const r = lines[i].trim();
        if (!/^[|:\-\s]+$/.test(r)) rows.push(r.slice(1, -1).split('|').map((c) => c.trim()));
      }
      i--;
      if (rows.length) out.push({ type: 'table', rows });
    }
    else if (!t) { flush(); if (item) blank = true; }
    else if (/^(---|\*\*\*|___)$/.test(t)) { flush(); endList(); out.push({ type: 'rule' }); }
    else if ((m = t.match(/^(#{1,6})\s+(.*)$/))) { flush(); endList(); out.push({ type: 'heading', level: Math.min(m[1].length, 4), text: m[2] }); }
    else if (t.startsWith('&gt;')) {
      flush(); endList();
      const quoted = [];
      for (; i < lines.length && lines[i].trim().startsWith('&gt;'); i++) quoted.push(lines[i].trim().slice(4).trim());
      i--;
      out.push({ type: 'quote', text: quoted.join('\n') });
    }
    else if ((m = line.match(/^(\s*)(?:[-*•+]|(\d{1,9})[.)])\s+(.*)$/))) {
      flush();
      // An item is the child of the open item whose marker starts left of its own; depth stops at 3.
      while (stack.length && stack[stack.length - 1] >= m[1].length) stack.pop();
      if (stack.length > 3) stack.length = 3;
      const depth = stack.length;
      stack.push(m[1].length);
      nums.length = depth + 1;
      // The first number of a list is the one written; the next ones count up, whatever is written.
      const number = m[2] === undefined ? null : nums[depth] != null ? nums[depth] + 1 : parseInt(m[2], 10);
      nums[depth] = number;
      // An item that starts with [ ] or [x] is a task, drawn with a checkbox in place of its marker (#267).
      const task = m[3].trim().match(/^\[([ xX])\]\s+(.*)$/);
      item = task ? { type: 'item', text: task[2], number, depth, task: task[1] === ' ' ? 'todo' : 'done' } : { type: 'item', text: m[3].trim(), number, depth };
      out.push(item);
      blank = false;
    }
    // A text line right under an item, or indented under it after a blank line, belongs to that item.
    else if (item && (!blank || /^\s/.test(line))) { item.text += `\n${t}`; blank = false; }
    else if ((m = title(line, i))) { flush(); endList(); out.push({ type: 'heading', level: 3, text: m }); }
    else { endList(); para.push(t); }
  }
  flush();
  return out;
}

// The Copy button in a code block's corner (#285). The page's copy handler (copyText) copies the text of the block's
// <pre>, which is the text as written (the HTML holds it escaped), and shows a check for 1.5 s.
const COPY_ICON = '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M15 9V6.5A2.5 2.5 0 0 0 12.5 4h-6A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 6.5 15H9"/></svg>';
const CODE_COPY_BTN = `<button type="button" class="copy-btn code-copy" title="Copy code" aria-label="Copy code">${COPY_ICON}</button>`;

function mdHTML(blocks) {
  const inline = (t) =>
    t
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/(<code>[^<]*<\/code>)|~~([^~\s](?:[^~]*[^~\s])?)~~/g, (all, code, struck) => code || `<del>${struck}</del>`)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<em>$2</em>')
      .replace(/\[([^\]]+)\]\((https?:[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  const text = (t) => t.split('\n').map(inline).join('<br>');
  const isItem = (i) => i < blocks.length && blocks[i].type === 'item';
  // The list that starts at blocks[i], its sub-lists inside their items: its HTML and the block after it.
  const list = (i) => {
    const { depth, number } = blocks[i], tag = number == null ? 'ul' : 'ol';
    let html = tag === 'ol' && number !== 1 ? `<ol start="${number}">` : `<${tag}>`;
    // A numbered list is the items that count up: a number that starts again is the next list.
    for (let n = number; isItem(i) && blocks[i].depth === depth && (tag === 'ul' ? blocks[i].number == null : blocks[i].number === n); n++) {
      const { task } = blocks[i];
      html += task ? `<li class="task"><input type="checkbox" disabled${task === 'done' ? ' checked' : ''}> ` : '<li>';
      html += text(blocks[i++].text);
      while (isItem(i) && blocks[i].depth > depth) { const sub = list(i); html += sub.html; i = sub.next; }
      html += '</li>';
    }
    return { html: `${html}</${tag}>`, next: i };
  };
  const out = [];
  for (let i = 0; i < blocks.length; i++) {
    const b = blocks[i];
    if (b.type === 'item') { const l = list(i); out.push(l.html); i = l.next - 1; }
    else if (b.type === 'heading') out.push(`<h${b.level}>${inline(b.text)}</h${b.level}>`);
    else if (b.type === 'quote') out.push(`<blockquote>${text(b.text)}</blockquote>`);
    else if (b.type === 'rule') out.push('<hr>');
    // A diagram stays its code until the page draws it (diagrams.js), and is its code when it can't be. Its drawing
    // takes the place of the <pre> inside the box, so Copy stays in the corner and copies the source.
    else if (b.type === 'code') out.push(`<div class="code-block"><pre${b.lang === 'mermaid' ? ' class="mermaid-src"' : ''}><code>${b.text}</code></pre>${CODE_COPY_BTN}</div>`);
    else if (b.type === 'table') out.push('<table>' + b.rows.map((r, ri) => `<tr>${r.map((c) => (ri === 0 ? `<th>${inline(c)}</th>` : `<td>${inline(c)}</td>`)).join('')}</tr>`).join('') + '</table>');
    else out.push(`<p>${text(b.text)}</p>`);
  }
  return out.join('\n');
}

// Link bare web addresses after rendering, so existing Markdown links and code stay intact.
// DOM text nodes give us the original &, quotes, and query strings without HTML re-escaping.
// An address without https:// is a domain with a path, like x.com/dhh/status/1, on a common top-level domain, so that
// file names like README.md or lib/bots.js stay text (test/fixtures/chat-links.json, shared with the Android app).
const BARE_TLDS = 'com|org|net|io|dev|app|ai|co|pl|me|gg|tv|xyz|edu|gov|info|eu|uk|de|fr|ly|so|be|fm|to|tech|blog|news|page|site|social|cloud|art|link';
const WEB_URL = new RegExp(`https?://[^\\s<>"'\`]+|(?<![\\p{L}\\p{N}_@./:-])(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\\.)+(?:${BARE_TLDS})/[^\\s<>"'\`]*`, 'giu');
// The web addresses in a text, outside `code`: where each starts, how long it is, and where it goes.
function chatLinks(text) {
  const code = [...text.matchAll(/(`+)[\s\S]*?\1/g)].map((m) => [m.index, m.index + m[0].length]);
  const links = [];
  for (const match of text.matchAll(WEB_URL)) {
    if (code.some(([start, end]) => match.index < end && match.index + match[0].length > start)) continue;
    let url = match[0];
    // Sentence punctuation is outside the address; balanced parentheses can be part of it.
    for (;;) {
      const last = url.at(-1);
      const opening = { ')': '(', ']': '[', '}': '{' }[last];
      if (/[.,;:!?]/.test(last || '') || (opening && url.split(last).length > url.split(opening).length)) url = url.slice(0, -1);
      else break;
    }
    const href = /^https?:/i.test(url) ? url : `https://${url}`;
    try { const parsed = new URL(href); if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) continue; }
    catch { continue; }
    links.push({ index: match.index, text: url, href });
  }
  return links;
}
// File paths in a bot's reply (#251; test/fixtures/file-paths.json, shared with the Android app): a path under
// /home/box or /workspace, one that starts with ~/, or one relative to the bot's workspace, with an extension the
// apps know, no .. in it and no web address around it. A bare name that is one capitalised word (Node.js) stays text.
const FILE_EXTS = 'markdown|md|txt|text|log|jsonl|json|yaml|yml|toml|ini|conf|cfg|env|csv|tsv|xml|html|htm|css|mjs|cjs|js|tsx|ts|jsx|py|rb|go|rs|java|kts|kt|swift|cpp|hpp|c|h|sh|sql|pdf|png|jpeg|jpg|gif|webp|svg|docx|doc|xlsx|xls|pptx|ppt|odt|ods|zip|tgz|gz|tar';
const FILE_PATH = new RegExp(`(?<![\\p{L}\\p{N}_./:@~\\\\-])(?:~/|\\./|/)?(?:[\\p{L}\\p{N}_.-]+/)*[\\p{L}\\p{N}_-][\\p{L}\\p{N}_.-]*\\.(?:${FILE_EXTS})(?![\\p{L}\\p{N}_/-]|\\.[\\p{L}\\p{N}])`, 'giu');
function fileLinkOK(p) {
  if (p.split('/').includes('..')) return false;
  if (p.startsWith('/')) return /^\/(home\/box|workspace)\//.test(p);
  const stem = p.replace(/^(~|\.)\//, '').split('/').pop().replace(/\.[^.]+$/, '');
  if (!/\p{L}/u.test(stem)) return false;
  return p.includes('/') || !/^\p{Lu}\p{Ll}+$/u.test(stem);
}
// The paths in a text, outside `code` and web addresses: where each starts, and the path as written.
function filePaths(text) {
  const taken = [...text.matchAll(/(`+)[\s\S]*?\1/g)].map((m) => [m.index, m.index + m[0].length])
    .concat(chatLinks(text).map((l) => [l.index, l.index + l.text.length]));
  const out = [];
  for (const m of text.matchAll(FILE_PATH)) {
    if (taken.some(([a, b]) => m.index < b && m.index + m[0].length > a) || !fileLinkOK(m[0])) continue;
    out.push({ index: m.index, text: m[0] });
  }
  return out;
}
const isFilePath = (s) => { const f = filePaths(s); return f.length === 1 && f[0].text === s; };
// A link to open a path of `botId`'s reply in the viewer (viewer.js), or download it where there is none.
const FILE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z M14 3v5h5"/></svg>';
function filePathLink(p, inner, botId) {
  const src = `/bots/${encodeURIComponent(botId)}/path?path=${encodeURIComponent(p)}`;
  const name = p.split('/').pop();
  return `<a class="file-path" href="/api${esc(src)}" data-view="${esc(src)}" data-view-name="${esc(name)}" data-view-bot="${esc(botId)}" title="Open ${esc(name)}">${FILE_ICON}${inner}</a>`;
}
// The paths in a reply drawn by md(), as links: in its text and in a `code` that is one path, never in a code
// block or a link. Only from a server whose `features` name `document-viewer`. html is md()'s, its text escaped.
function linkPaths(html, botId) {
  if (!botId || !state.features.includes('document-viewer')) return html;
  const parts = String(html).split(/(<[^>]+>)/);
  let pre = 0, a = 0, code = 0;
  for (let i = 0; i < parts.length; i++) {
    const t = parts[i];
    if (t.startsWith('<')) {
      if (t === '<code>' && !pre && !a && !code && parts[i + 2] === '</code>' && isFilePath(parts[i + 1])) {
        parts[i] = filePathLink(parts[i + 1], `<code>${parts[i + 1]}</code>`, botId); parts[i + 1] = ''; parts[i + 2] = ''; i += 2;
      } else if (/^<pre[\s>]/.test(t)) pre++; else if (t === '</pre>') pre--;
      else if (/^<a[\s>]/.test(t)) a++; else if (t === '</a>') a--;
      else if (/^<code[\s>]/.test(t)) code++; else if (t === '</code>') code--;
      continue;
    }
    if (pre || a || code || !t) continue;
    let at = 0, out = '';
    for (const f of filePaths(t)) { out += t.slice(at, f.index) + filePathLink(f.text, f.text, botId); at = f.index + f.text.length; }
    parts[i] = out + t.slice(at);
  }
  return parts.join('');
}
function linkifyChat(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const parent = node.parentElement;
    if (parent?.closest('#chat-thread .bubble, #bot-thread .bubble') &&
        !parent.closest('a, code, pre, button, .mention, .diagram')) nodes.push(node);
  }
  for (const node of nodes) {
    const text = node.textContent;
    const fragment = document.createDocumentFragment();
    let at = 0;
    for (const { index, text: url, href } of chatLinks(text)) {
      fragment.append(document.createTextNode(text.slice(at, index)));
      const link = document.createElement('a');
      link.href = href;
      link.textContent = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      fragment.append(link);
      at = index + url.length;
    }
    if (at) {
      fragment.append(document.createTextNode(text.slice(at)));
      node.replaceWith(fragment);
    }
  }
}
// Covers loaded history, optimistic user messages, and live replies/files alike.
new MutationObserver((changes) => {
  for (const change of changes) for (const node of change.addedNodes) {
    if (node.nodeType === Node.ELEMENT_NODE) linkifyChat(node);
    else if (node.nodeType === Node.TEXT_NODE && node.parentElement) linkifyChat(node.parentElement);
  }
}).observe(document.getElementById('app'), { childList: true, subtree: true });
// A reply's diagrams, wherever a reply, a tile or a skill is drawn: on the page and in its dialog (diagrams.js).
Diagrams.watch(document.getElementById('app'));
Diagrams.watch(document.getElementById('modal'));

// ---------- the reply draft ----------

// A reply as it is written (docs/api.md, "The reply draft"; ADR 042): from a server whose `features` name
// `reply-draft`, a run's stream and a Chief chat's stream send the whole draft so far, and the page draws it in the
// row of the reply that is being written, the bubble its reply will have, in place. Its end takes it away: the
// reply is drawn as it always was. There is no animation: the text is drawn again, at most once a frame.
const showsDrafts = () => state.features.includes('reply-draft');
// The draft's bubble, or '' for none. alone: in a stack of its own, as a reply's bubble stands, for a row that has none.
const draftMd = (text) => `<div class="md">${md(draftSource(text))}</div>`;
const draftHTML = (text, alone = false) => {
  const bubble = text ? `<div class="bubble from-bot draft">${draftMd(text)}</div>` : '';
  return bubble && alone ? `<div class="stack draft-stack">${bubble}</div>` : bubble;
};
// The drafts the page holds, by their reply (a run's id, or chief:<chat>): kept so that a chat drawn again keeps
// its draft, and drawn at the next frame into the row where() finds, [row, thread]: in the row's .stack when it
// has one. The thread stays at its end when the owner is near it, and is not moved otherwise.
const replyDrafts = (() => {
  const texts = new Map();
  const where = new Map(); // what waits for the next frame
  const draw = (key) => {
    const [row, thread] = where.get(key)?.() || [];
    where.delete(key);
    if (!row?.isConnected) return;
    const near = !thread || thread.scrollHeight - thread.scrollTop - thread.clientHeight < 200;
    const text = texts.get(key);
    const own = $('.draft-stack', row); // the stack put in for it, in a row that had none
    const box = own || $('.stack', row);
    const old = box && $('.draft', box);
    if (old && text) old.innerHTML = draftMd(text);
    else if (old) (own || old).remove();
    else if (text) (box || row).insertAdjacentHTML('afterbegin', draftHTML(text, !box));
    if (near && thread) thread.scrollTop = thread.scrollHeight;
  };
  return {
    of: (key) => texts.get(key) || '',
    // Keep `text` as the draft of `key` ('' for none), and draw it where at() says at the next frame. Without `at`
    // it is only kept: whose chat draws it itself (a group's, drawGroupDrafts).
    say(key, text, at) {
      if (typeof text === 'string' && text) texts.set(key, text); else texts.delete(key);
      if (!at) return;
      if (!where.has(key)) requestAnimationFrame(() => draw(key));
      where.set(key, at);
    },
    end(key) { texts.delete(key); where.delete(key); },
  };
})();

// ---------- data ----------

async function refresh() {
  state.refreshedAt = Date.now();
  fresh.check();
  try {
    const skillLib = loadSkillLib(); // for mentions
    loadMentionPages(); // for mentions of pages (#473)
    const groupsRead = loadGroups(); // the groups, beside the bots (groups.js): never rejects
    const [bots, runs, activity, chief, computers, cfg] = await Promise.all([api('/bots'), api('/runs?limit=200'), api('/runs?groups&limit=200').catch(() => null), api('/chief'), api('/computers').catch(() => ({})), api('/settings').catch(() => null)]);
    if (!state.skillLib) await skillLib; // the first time, the chats wait for it
    Object.assign(state, { bots, runs, activity: Array.isArray(activity) ? activity : [], chats: chief.chats, chiefBusy: chief.busy, chiefUnread: Unread.count(chief), computers, groups: await groupsRead });
    if (takeChiefName(chief.chief?.name)) drawChiefName();
    if (state.view === 'group' && state.groupId) loadGroupChat(state.groupId);
    // The lines: those of runs and replies that are still going on stay, the rest go. A run's is its working line
    // from a server that has one (opening-line.js ofRun).
    openingLines.sync([
      ...runs.filter((r) => r.status === 'running').map((r) => ({ chat: `bot:${r.botId}`, runId: r.id, text: OpeningLine.ofRun(r, state.features) })),
      ...(chief.busy ? chief.chats.map((c) => ({ chat: `chief:${c.id}`, text: c.openingLine })) : []),
    ]);
    // The Chief replies nowhere: no working line is left over. A reply this page follows ends with its stream:
    // this answer may be older than its start.
    if (!chief.busy) for (const id of [...chiefTurns.keys()]) if (!(state.chatStream && id === state.chatId)) chiefTurns.delete(id);
    if (!state.features.length) loadFeatures().then(syncRead); // it could not be asked at the start
    // Counts that were fetched before this page said it shows the chat: ask the server again, now.
    if (report.shown() && Unread.count(unreadKnown(report.shown()))) report.again();
    redrawMarks();
    showJobApprovals();
    api(MEMORY_WAITS).then((p) => { state.memPending = p; showNeeds(); }).catch(() => {});
    api('/asks?vault-switch=1&vault-remove=1&vault-file=1&override=1&chief-action=1&room-tool=1&room-post=1').then((a) => { state.asks = a; showNeeds(); }).catch(() => {});
    api('/dashboard?quiet').then((d) => { state.dash = d; renderContacts(); showNeeds(); if (state.view === 'dashboard') renderDashboard(); }).catch(() => {});
    if (cfg) Object.assign(state, { settings: cfg.settings, models: cfg.models, efforts: cfg.efforts, catalog: cfg.catalog });
    if (state.view === 'bot' && state.botId) loadInbox(state.botId);
    render();
  } catch (e) {
    // No toast from the background: while botdot is away the standing line says it (setAway), once.
    console.warn(e.message);
  }
}

function render() {
  renderContacts();
  if (state.view === 'chief') renderChief();
  if (state.view === 'dashboard') renderDashboard();
  if (state.view === 'bot') renderBotChat();
  if (state.view === 'group') renderGroupChat();
  if (state.view === 'rooms') renderRooms();
  if (panelPage() === 'groupsettings') renderGroupSettings();
  if (panelPage() === 'botsettings') renderBotSettings();
  if (panelPage() === 'botjobs') renderBotJobs();
  if (panelPage() === 'chiefsettings') renderChiefSettings(); else delete $('#view-chiefsettings').dataset.always; // its Always approved is asked again when they open
  drawPanelHead();
  if (state.view === 'runs') renderRuns();
  if (state.view === 'vault' && !$('#view-vault').dataset.ready) renderVault(); // not on every refresh: it would wipe the forms
  if (state.view === 'skills') renderSkills();
  if (state.view === 'pages') Pages.renderAll();
  if (state.view === 'connectors') renderConnectors();
  if (state.view === 'settings') renderSettings();
  if (state.view === 'setup') renderSetup();
  placeStatusLines();
  showNeeds();
  markMore();
}

// The running tasks, shown beside Activity on Settings (settings.js). The Settings button itself carries no number.
const runningTasks = () => activityRuns().filter((r) => r.status === 'running').length;
const tasksRunning = (n) => `${n} ${n === 1 ? 'task' : 'tasks'} running`;
// The Settings button: marked while one of its pages is open.
function markMore() {
  $('#more-btn').classList.toggle('here', ['runs', 'skills', 'pages', 'connectors', 'vault', 'settings', 'setup'].includes(state.view));
  // The logo's dot pulses while the Chief or a bot is working.
  $('#brand').classList.toggle('busy', !!state.chiefBusy || state.bots.some((b) => b.running));
  const ca = $('#chief-avatar');
  if (ca && ca.dataset.busy !== String(!!state.chiefBusy)) { ca.dataset.busy = String(!!state.chiefBusy); ca.innerHTML = chiefFigure('sm'); }
}


function renderStatus() {
  if (!state.status?.claudeBin) toast('Claude Code CLI not found. Bots cannot run.', true);
}

// Views: chief | bot (with state.botId) | group (with state.groupId, groups.js) | rooms (with state.roomId, rooms.js) | runs | skills | vault | settings | setup | connectors | dashboard | needs.
// A bot's settings, its jobs and the Chief's settings are no views: they are drawn in the panel beside
// the chat (panel.js). setView still takes their names, botsettings, botjobs and chiefsettings, and the
// address keeps them. A group's panel is groupsettings.
const BOT_NAMES = ['bot', 'botsettings', 'botjobs']; // the names that come with a bot's id
const GROUP_NAMES = ['group', 'groupsettings']; // and those that come with a group's
const CHAT_VIEWS = ['bot', 'chief', 'group']; // the views that are a chat, with the panel beside them
const PHONE = '(max-width: 479px)'; // the style's phone width, where the list of bots and a view take turns
const panelPage = () => Panel.page(state.view, state.panel);
let covered = false; // the panel is over the chat, as last seen
function setView(v, sub) {
  if (BOT_NAMES.includes(v) && sub) state.botId = sub;
  if (GROUP_NAMES.includes(v) && sub) state.groupId = sub;
  if (v === 'rooms') state.roomId = sub || null; // a room, or the list of rooms (rooms.js)
  // Asked for by name, the panel is drawn fresh from what is saved.
  show(Panel.next(state, { view: v, covered: panelCovers() }), Panel.NAMES.includes(v));
}
// The panel's own controls: 'toggle' (the figure and name in a chat), 'close' and 'back'.
function setPanel(what) { show(Panel.next(state, { panel: what })); }
// The bot, or the group, of the open chat is gone: the Chief's chat, without the panel.
function leaveBot() { show(Panel.next(state, { gone: true })); }
function writeHash() {
  const v = state.view;
  const id = v === 'runs' ? state.selectedRun : v === 'chief' ? state.chatId : v === 'bot' ? state.botId : v === 'group' ? state.groupId : v === 'rooms' ? state.roomId : null;
  history.replaceState(null, '', `#${Panel.name(v, state.panel)}${id ? '/' + id : ''}`);
}
function show({ view: v, panel, via }, fresh = false) {
  if (v !== 'bot') for (const es of state.botStreams.splice(0)) es.close();
  if (v !== 'group') followGroupDrafts(null); // a group that is left follows no turn's draft (groups.js)
  const changed = state.view !== v;
  // Needs you goes back, after its last card, to where it was opened from (needs-return.js).
  if (changed && v === 'needs') state.cameFrom = NeedsReturn.from(state, matchMedia(PHONE).matches && !$('#app').classList.contains('in-main'));
  const was = panelPage();
  state.view = v;
  state.panel = panel;
  state.via = via; // the jobs came from the settings: Back returns there
  const now = panelPage();
  if (changed && v === 'connectors') delete $('#view-connectors').dataset.ready; // fresh data each visit
  if (changed && v === 'vault') delete $('#view-vault').dataset.ready;
  if (changed && v === 'dashboard') loadDash();
  if (changed && v === 'setup') { delete $('#view-setup').dataset.ready; state.setup = null; }
  if (changed) { needsDone.clear(); needsOpen.clear(); delete $('#view-needs').dataset.sig; stayOnNeeds(); }
  if (changed && v === 'group') loadGroupChat(state.groupId); // what was said there while another view was open
  $$('.view').forEach((el) => el.classList.toggle('hidden', el.id !== `view-${v}`));
  if (changed) { const page = $(`#view-${v}.page`); if (page) page.scrollTop = 0; } // open pages at the top
  // The panel: beside the chat, or over it where the column is too narrow for both (the style decides).
  $('#chat-row').classList.toggle('hidden', !CHAT_VIEWS.includes(v));
  $('#chat-row').classList.toggle('with-panel', !!now);
  $('#panel').classList.toggle('hidden', !now);
  $$('.panel-page').forEach((el) => el.classList.toggle('hidden', el.id !== `view-${now}`));
  if (now && (fresh || now !== was)) {
    const page = $(`#view-${now}`);
    delete page.dataset.ready; // fresh from what is saved each time it opens
    delete page.dataset.bot;
    page.scrollTop = 0;
  }
  $$('.nav-btn[data-view]').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
  $('#app').classList.add('in-main'); // phones: show the conversation instead of the list
  writeHash();
  render();
  const hid = covered;
  covered = panelCovers();
  sayPresent();
  syncRead();
  // A thread rendered while hidden (phones, or under the panel) has no height yet: jump to the "New" line,
  // or to the latest message, once visible. A panel that opens or closes beside the chat leaves it where it is.
  const panelOnly = !changed && was !== now;
  if (!panelOnly || (hid && !covered)) requestAnimationFrame(threadToEnd);
}
function threadToEnd() {
  const t = state.view === 'chief' ? $('#chat-thread') : state.view === 'bot' ? $('#bot-thread') : state.view === 'group' ? $('#group-thread') : state.view === 'rooms' ? $('#room-thread') : null;
  if (t && !scrollToNew(t, true)) t.scrollTop = t.scrollHeight;
}

// The panel's head: back where the panel covers the chat or shows the jobs, close where it is beside the chat.
function drawPanelHead() {
  const page = panelPage();
  if (!page) return;
  const bot = state.view === 'bot' ? botById(state.botId) : null;
  const fromSettings = state.panel === 'jobs' && state.via;
  const to = fromSettings ? 'Settings' : bot ? bot.name : state.view === 'group' ? groupById(state.groupId)?.name || 'Group' : chiefName();
  const panel = $('#panel');
  panel.dataset.kind = fromSettings ? 'jobs' : 'settings'; // the style shows Back beside the chat for 'jobs'
  const back = $('#panel-back');
  if (back.dataset.to !== to) { back.dataset.to = to; back.innerHTML = `${ICON.back} ${esc(to)}`; }
  back.onclick = () => setPanel('back');
  $('#panel-close').onclick = () => setPanel('close');
}

// Phones: back to the contact list.
function showList() { $('#app').classList.remove('in-main'); syncRead(); }

const ICON = {
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  copy: COPY_ICON,
  copied: '<svg viewBox="0 0 24 24"><path d="M5 12.5l4.5 4.5L19 7.5"/></svg>',
  send: '<svg viewBox="0 0 24 24"><path d="M12 19V5M6 11l6-6 6 6"/></svg>',
  clip: '<svg viewBox="0 0 24 24"><path d="M20.5 11.5l-8.2 8.2a5 5 0 0 1-7.1-7.1l8.6-8.6a3.4 3.4 0 0 1 4.8 4.8l-8.6 8.6a1.8 1.8 0 0 1-2.5-2.5l7.9-7.9"/></svg>',
  stop: '<svg viewBox="0 0 24 24"><rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none"/></svg>',
  compose: '<svg viewBox="0 0 24 24"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>',
  screen: '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/></svg>',
  play: '<svg viewBox="0 0 24 24"><path d="M7 5l12 7-12 7z" fill="currentColor" stroke="none"/></svg>',
};
const BACK_BTN = `<button class="icon-btn back-btn" data-back aria-label="Back">${ICON.back}</button>`;
const PAGE_BACK = `<button class="btn sm page-back" data-back>${ICON.back} Back</button>`;
// Activity, Skills, Connectors and Vault: back to Settings, where they open from.
const SUB_BACK = `<button class="btn sm sub-back" data-to-settings>${ICON.back} Settings</button>`;

// "18:32" today, "Mon" this week, "Sep 21" otherwise.
function shortTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  if (Math.abs(now - d) < 6 * 864e5) return d.toLocaleDateString([], { weekday: 'short' }); // ahead too: a job's next run
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

// When a message in a chat was sent: "18:32" today, "21 Sep, 18:32" before.
function msgTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })}, ${time}`;
}

const plain = (t) => String(t || '').replace(/[#*_`>|\[\]()-]+/g, ' ').replace(/\s+/g, ' ').trim();
