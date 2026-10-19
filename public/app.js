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
  inbox: {}, // bot id → notes waiting for its next run
  botStream: null,
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
  if (res.status === 401 && data.signIn === '/sign-in') { location.assign('/sign-in'); throw unreached(); }
  const said = !res.ok && typeof data.error === 'string' && data.error.trim();
  const notThere = !res.ok && !said && [502, 503].includes(res.status); // a gateway: botdot was not reached
  const gaveUp = !res.ok && !said && res.status === 504; // a gateway: botdot did not answer in time
  setAway(notThere || gaveUp);
  if (notThere) throw unreached();
  if (!res.ok) {
    throw Object.assign(new Error(said || `botdot couldn't do that (${res.status}).`), { status: res.status, refused: !!said, unsure: !said && res.status >= 500 });
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
// a mention names a member and gives it the turn: only its members, and their jobs, are matched and suggested.
const mentionCtx = (chat) => (String(chat).startsWith('group:') ? { chat, bots: groupMembers(groupById(String(chat).slice(6))), library: [] }
  : { chat, bots: [CHIEF_BOT, ...state.bots], library: state.skillLib || [] });
// The owner's own message with its mentions drawn: a bot as its small head and name, a job or a skill tinted; anything
// else plain (escaped). Bot and Chief replies stay as they are.
function escMentions(text, chat) {
  const s = String(text ?? '');
  if (!chat || !s.includes('@')) return esc(s);
  const ctx = mentionCtx(chat);
  let out = '', at = 0;
  for (const m of Mentions.findMentions(s, ctx)) {
    out += esc(s.slice(at, m.start)) + (m.kind === 'bot'
      ? `<span class="mention" title="${esc(m.text)}">${botLabel(ctx.bots.find((b) => b.id === m.bot))}</span>`
      : `<span class="mention tint">${esc(m.text)}</span>`);
    at = m.end;
  }
  return out + esc(s.slice(at));
}
// What mentions match against, so a chat redraws when a name changes (a renamed bot's old mentions go plain).
function mentionSig() {
  const bots = state.bots.map((b) => [b.name, ...(b.jobs || []).map((j) => j.name), b.useSkills === false ? '' : (b.skills || []).join(',')].join('/'));
  return [...bots, ...(state.skillLib || []).map((k) => k.name)].join('|');
}
// The skill library, for mentions: fetched with the page's data, at most once a minute.
function loadSkillLib() {
  if (Date.now() - (state.skillLibAt || 0) < 60000) return null;
  state.skillLibAt = Date.now();
  return api('/skills').then(({ library }) => { state.skillLib = library.map(({ name, description }) => ({ name, description })); }).catch(() => { state.skillLibAt = 0; });
}
// "Messaged Coder, Home Keeper" (each with its small head) above a reply: every bot the run messaged, and how it gets there when that's the same for all.
function messagedLabel(r) {
  const to = r.sentToAll?.length ? r.sentToAll : r.sentTo ? [r.sentTo] : [];
  if (!to.length) return '';
  const how = to.every((t) => t.delivered === 'queued') ? (to.length === 1 ? ' · it picks it up when free' : ' · they pick it up when free')
    : to.every((t) => t.delivered?.startsWith('inbox')) ? ' · a note for their next run' : '';
  return `<div class="bot-msg-label">Messaged ${to.map(botLabel).join(', ')}${to.length === 1 ? how.replace('their', 'its') : how}</div>`;
}
// Every bot a run messaged, each once.
const sentTo = (r) => (r.sentToAll?.length ? r.sentToAll : r.sentTo ? [r.sentTo] : []);
// The folded line of a run another bot or the Chief started: "Replied to Fleet Doctor" (with its small head), or whom else it messaged.
function exchangeLabel(r) {
  const to = sentTo(r);
  if (!to.length) return r.startedBy === 'chief' ? `Replied to ${botLabel(sender(r))}` : 'Replied'; // the Chief reads the reply itself
  return to.every((t) => t.id === sender(r)?.id) ? `Replied to ${botLabel(sender(r))}` : `Messaged ${to.map(botLabel).join(', ')}`;
}
// Who sent the task that started a run, when it wasn't the owner: another bot, or the Chief (it hands tasks to bots).
const sender = (r) => (r.trigger === 'bot' && r.fromBot ? r.fromBot : r.startedBy === 'chief' ? CHIEF_BOT : null);
// Notes other bots left: one folded line, "Read notes from Web Surfer, Coder" (each with its small head), that opens to what each said.
function notesFoldHTML(notes, heading) {
  if (!notes?.length) return '';
  const who = [...new Map(notes.map((n) => [n.fromId || n.from, { id: n.fromId, name: n.from, color: n.color }])).values()];
  return `<div class="bubble-row from-me"><details class="notes-fold"><summary>${heading} ${who.map(botLabel).join(', ')}</summary>
    ${notes.map((n) => `<div class="note"><div class="bot-msg-label">${botLabel({ id: n.fromId, name: n.from, color: n.color })}${n.at ? ` · ${esc(msgTime(n.at))}` : ''}</div><div class="bubble from-other-bot">${esc(n.text)}</div></div>`).join('')}
  </details></div>`;
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
// Quick answers under the newest reply ([[choices: …]], see lib/choices.js): tap one to send it.
const choicesHTML = (choices) => (choices?.length ? `<div class="choices">${choices.map((c) => `<button class="btn" data-choice="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : '');
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
document.addEventListener('click', async (e) => {
  const b = e.target.closest('[data-copy]');
  if (!b) return;
  e.stopPropagation();
  if (!(await copyText(b.dataset.copy))) return toast("Couldn't copy", true);
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
function md(src) {
  return mdHTML(mdBlocks(src));
}

// A flat list of blocks: heading (level, text), para (text), item (text, number or null, depth), quote (text),
// rule, code (text) and table (rows). Android's parseBlocks returns the same for the same text.
function mdBlocks(src) {
  const code = [];
  const lines = esc(src || '').replace(/\r\n?/g, '\n').replace(/```(\w*)\n([\s\S]*?)```/g, (_, lang, c) => {
    code.push(c.replace(/\n$/, ''));
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
    if ((m = t.match(/^\u0000(\d+)\u0000$/))) { flush(); endList(); out.push({ type: 'code', text: code[m[1]] ?? '' }); }
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
      item = { type: 'item', text: m[3].trim(), number, depth };
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

function mdHTML(blocks) {
  const inline = (t) =>
    t
      .replace(/`([^`]+)`/g, '<code>$1</code>')
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
      html += `<li>${text(blocks[i++].text)}`;
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
    else if (b.type === 'code') out.push(`<pre><code>${b.text}</code></pre>`);
    else if (b.type === 'table') out.push('<table>' + b.rows.map((r, ri) => `<tr>${r.map((c) => (ri === 0 ? `<th>${inline(c)}</th>` : `<td>${inline(c)}</td>`)).join('')}</tr>`).join('') + '</table>');
    else out.push(`<p>${text(b.text)}</p>`);
  }
  return out.join('\n');
}

// Link bare web addresses after rendering, so existing Markdown links and code stay intact.
// DOM text nodes give us the original &, quotes, and query strings without HTML re-escaping.
function linkifyChat(root) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const parent = node.parentElement;
    if (parent?.closest('#chat-thread .bubble, #bot-thread .bubble') &&
        !parent.closest('a, code, pre, button, .mention')) nodes.push(node);
  }
  for (const node of nodes) {
    const text = node.textContent;
    const code = [...text.matchAll(/(`+)[\s\S]*?\1/g)].map((m) => [m.index, m.index + m[0].length]);
    const fragment = document.createDocumentFragment();
    let at = 0;
    for (const match of text.matchAll(/https?:\/\/[^\s<>"'`]+/gi)) {
      if (code.some(([start, end]) => match.index < end && match.index + match[0].length > start)) continue;
      let url = match[0];
      // Sentence punctuation is outside the address; balanced parentheses can be part of it.
      for (;;) {
        const last = url.at(-1);
        const opening = { ')': '(', ']': '[', '}': '{' }[last];
        if (/[.,;:!?]/.test(last || '') || (opening && url.split(last).length > url.split(opening).length)) url = url.slice(0, -1);
        else break;
      }
      try { const parsed = new URL(url); if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname) continue; }
      catch { continue; }
      fragment.append(document.createTextNode(text.slice(at, match.index)));
      const link = document.createElement('a');
      link.href = url;
      link.textContent = url;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      fragment.append(link);
      at = match.index + url.length;
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

// ---------- data ----------

async function refresh() {
  state.refreshedAt = Date.now();
  try {
    const skillLib = loadSkillLib(); // for mentions
    const groupsRead = loadGroups(); // the groups, beside the bots (groups.js): never rejects
    const [bots, runs, chief, computers, cfg] = await Promise.all([api('/bots'), api('/runs?limit=200'), api('/chief'), api('/computers').catch(() => ({})), api('/settings').catch(() => null)]);
    if (!state.skillLib) await skillLib; // the first time, the chats wait for it
    Object.assign(state, { bots, runs, chats: chief.chats, chiefBusy: chief.busy, chiefUnread: Unread.count(chief), computers, groups: await groupsRead });
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
    api('/asks?vault-switch=1&chief-action=1').then((a) => { state.asks = a; showNeeds(); }).catch(() => {});
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
  if (panelPage() === 'groupsettings') renderGroupSettings();
  if (panelPage() === 'botsettings') renderBotSettings();
  if (panelPage() === 'botjobs') renderBotJobs();
  if (panelPage() === 'chiefsettings') renderChiefSettings();
  drawPanelHead();
  if (state.view === 'runs') renderRuns();
  if (state.view === 'vault' && !$('#view-vault').dataset.ready) renderVault(); // not on every refresh: it would wipe the forms
  if (state.view === 'skills') renderSkills();
  if (state.view === 'connectors') renderConnectors();
  if (state.view === 'settings') renderSettings();
  if (state.view === 'setup') renderSetup();
  placeStatusLines();
  showNeeds();
  markMore();
}

// The Settings button: the number of running tasks.
function markMore() {
  const badge = $('#more-badge');
  if (!badge) return;
  const running = state.runs.filter((r) => r.status === 'running').length;
  badge.classList.toggle('num', running > 0);
  badge.textContent = running > 0 ? running : '';
  badge.classList.toggle('hidden', !running);
  $('#more-btn').classList.toggle('here', ['runs', 'skills', 'connectors', 'vault', 'settings', 'setup'].includes(state.view));
  // The logo's dot pulses while the Chief or a bot is working.
  $('#brand').classList.toggle('busy', !!state.chiefBusy || state.bots.some((b) => b.running));
  const ca = $('#chief-avatar');
  if (ca && ca.dataset.busy !== String(!!state.chiefBusy)) { ca.dataset.busy = String(!!state.chiefBusy); ca.innerHTML = chiefFigure('sm'); }
}


function renderStatus() {
  if (!state.status?.claudeBin) toast('Claude Code CLI not found. Bots cannot run.', true);
}

// Views: chief | bot (with state.botId) | group (with state.groupId, groups.js) | runs | skills | vault | settings | setup | connectors | dashboard | needs.
// A bot's settings, its jobs and the Chief's settings are no views: they are drawn in the panel beside
// the chat (panel.js). setView still takes their names, botsettings, botjobs and chiefsettings, and the
// address keeps them. A group's panel is groupsettings.
const BOT_NAMES = ['bot', 'botsettings', 'botjobs']; // the names that come with a bot's id
const GROUP_NAMES = ['group', 'groupsettings']; // and those that come with a group's
const CHAT_VIEWS = ['bot', 'chief', 'group']; // the views that are a chat, with the panel beside them
const panelPage = () => Panel.page(state.view, state.panel);
let covered = false; // the panel is over the chat, as last seen
function setView(v, sub) {
  if (BOT_NAMES.includes(v) && sub) state.botId = sub;
  if (GROUP_NAMES.includes(v) && sub) state.groupId = sub;
  // Asked for by name, the panel is drawn fresh from what is saved.
  show(Panel.next(state, { view: v, covered: panelCovers() }), Panel.NAMES.includes(v));
}
// The panel's own controls: 'toggle' (the figure and name in a chat), 'close' and 'back'.
function setPanel(what) { show(Panel.next(state, { panel: what })); }
// The bot, or the group, of the open chat is gone: the Chief's chat, without the panel.
function leaveBot() { show(Panel.next(state, { gone: true })); }
function writeHash() {
  const v = state.view;
  const id = v === 'runs' ? state.selectedRun : v === 'chief' ? state.chatId : v === 'bot' ? state.botId : v === 'group' ? state.groupId : null;
  history.replaceState(null, '', `#${Panel.name(v, state.panel)}${id ? '/' + id : ''}`);
}
function show({ view: v, panel, via }, fresh = false) {
  if (v !== 'bot' && state.botStream) { state.botStream.close(); state.botStream = null; }
  const changed = state.view !== v;
  const was = panelPage();
  state.view = v;
  state.panel = panel;
  state.via = via; // the jobs came from the settings: Back returns there
  const now = panelPage();
  if (changed && v === 'connectors') delete $('#view-connectors').dataset.ready; // fresh data each visit
  if (changed && v === 'vault') delete $('#view-vault').dataset.ready;
  if (changed && v === 'dashboard') loadDash();
  if (changed && v === 'setup') { delete $('#view-setup').dataset.ready; state.setup = null; }
  if (changed) { needsDone.clear(); needsOpen.clear(); delete $('#view-needs').dataset.sig; }
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
  const t = state.view === 'chief' ? $('#chat-thread') : state.view === 'bot' ? $('#bot-thread') : state.view === 'group' ? $('#group-thread') : null;
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
  copy: '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="11" height="11" rx="2.5"/><path d="M15 9V6.5A2.5 2.5 0 0 0 12.5 4h-6A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 6.5 15H9"/></svg>',
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
