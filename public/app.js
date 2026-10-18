// bot-dot front end: vanilla JS, no build step.
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
    api('/asks').then((a) => { state.asks = a; showNeeds(); }).catch(() => {});
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
  const to = fromSettings ? 'Settings' : bot ? bot.name : state.view === 'group' ? groupById(state.groupId)?.name || 'Group' : 'Chief of Staff';
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
  if (!q || 'chief of staff'.includes(q)) {
    top.push(`
      <button class="contact ${state.view === 'chief' ? 'active' : ''}" data-contact="chief" title="Chief of Staff">
        ${chiefFigure()}
        <div class="grow"><div class="top"><span class="name">Chief of Staff</span><span class="time">${esc(shortTime(chat?.updatedAt))}</span>${Unread.dots(state.chiefUnread, CHIEF_COLOR)}</div>
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
  // The groups (groups.js): one row each, found by its name, its category and its members' names. Their place is
  // counted among the groups only: the pinned ones stand after the pinned bots, a category's after its bots.
  const chats = state.groups.filter((g) => !q || groupSearchText(g).includes(q));
  // The rows are the keypad's pages (keypad.js): the pinned bots and groups right below the Chief, in the order you
  // gave them; the rest by category.
  const row = (x) => (x.members ? groupContactHTML(x) : contact(x));
  const pages = Keypad.pages(matching, chats);
  top.push(...(pages.find((p) => p.kind === 'pinned')?.keys || []).map(row));
  items.push(...top);
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
// Every key in reading order, page after page, with its page and its place there: the digits count them so.
const keypadKeys = (pages) => pages.flatMap((p, page) => p.keys.map((x, at) => ({ x, page, at })));
const keypadShown = () => getComputedStyle($('#keypad')).display !== 'none';
// A key's line, its class and what stands after its name: the list's, with "Asks you" for a bot that asks.
function keyLine(x) {
  if (x.members) return groupLine(x);
  const line = botLine(x);
  return line.cls === 'asks' ? { ...line, prev: 'Asks you' } : line;
}
// The colour of the dot on a page's heading: the first bot on it that asks, or the member that asks in a group.
const askColor = (x) => (keyLine(x).cls !== 'asks' ? '' : x.members ? memberColor(x.asks.botId) : x.color);
const openKey = (x) => (x.members ? setView('group', x.id) : setView('bot', x.id));
// section: on a phone, the place of the key's page; there the key has no digit.
function keyHTML(x, i, section = null) {
  const group = !!x.members;
  const line = keyLine(x);
  const on = group ? state.view === 'group' && state.groupId === x.id : state.view === 'bot' && state.botId === x.id;
  const where = section === null ? `data-key="${i}"` : `data-section-key="${section}.${i}"`;
  return `<button class="key${group ? ' is-group' : ''}${on ? ' active' : ''}" ${where}${section === null ? ' draggable="true"' : ''} title="${esc(x.name)}">${section === null && i < 9 ? `<span class="key-n">${i + 1}</span>` : ''}${group ? groupPicture(x) : botFigure(x.color, x.state, '', x.outfit)}<div class="grow"><div class="top"><span class="name">${esc(x.name)}</span>${line.after}</div><div class="prev ${line.cls}">${line.who ? `${esc(line.who)}: ` : ''}${esc(line.prev)}</div></div></button>`;
}
// The Board's line: each tile's name and value, or its dot. A tap opens the Board. Not there until the Board is read.
function boardLine() {
  if (!state.dash) return '';
  const tile = (t) => `<span class="t"><span class="lbl">${esc(t.title)}</span><b>${t.look?.short ? esc(t.look.short) : tileMark(t)}</b></span>`;
  return `<button class="kp-board-line ${state.view === 'dashboard' ? 'active' : ''}" data-board title="Board">${boardTiles().map(tile).join('') || BOARD_EMPTY}</button>`;
}
// The Board's line drawn in `el`: the keypad's, or a phone's.
function drawBoardLine(el) {
  el.innerHTML = boardLine();
  $$('[data-board]', el).forEach((b) => (b.onclick = () => setView('dashboard')));
}
// The Chief of Staff's key, first on Pinned: its row in the list as a key, with Esc where a bot's key has its digit.
function chiefKeyHTML() {
  const chat = state.chats[0];
  return `<button class="key key-chief${state.view === 'chief' ? ' active' : ''}" data-key-chief title="Chief of Staff"><span class="key-n">Esc</span>${chiefFigure()}<div class="grow"><div class="top"><span class="name">Chief of Staff</span>${Unread.dots(state.chiefUnread, CHIEF_COLOR)}</div><div class="prev">${esc(plain(chat?.preview) || 'Your team of bots. Ask for anything.')}</div></div></button>`;
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
  const keys = $('#kp-keys');
  drawBoardLine($('#kp-board'));
  const ask = '<button class="key key-ask" data-key-ask>Ask the Chief for a bot</button>';
  const keysOf = (i) => all.map((k, n) => (k.page === i ? keyHTML(k.x, n) : '')).join('');
  keys.innerHTML = pages.map((p, i) => `<section class="kp-page${i === 0 ? ' kp-pinned' : ''}"><h3 class="kp-page-head" data-page="${i}">${esc(p.name)} <b>${p.keys.length}</b>${pageDot(p)}</h3><div class="kp-page-keys">${i === 0 ? chiefKeyHTML() : ''}${keysOf(i)}${i === pages.length - 1 ? ask : ''}</div></section>`).join('');
  $$('[data-key]', keys).forEach((el) => (el.onclick = () => openKey(all[Number(el.dataset.key)].x)));
  $$('[data-key-chief]', keys).forEach((el) => (el.onclick = openChief));
  $$('[data-key-ask]', keys).forEach((el) => (el.onclick = askChief));
  wireKeyDrags(pages, all, keys);
  drawKeypadSections(found);
}
// A page's dot, on its heading on the keypad or on a phone: in the colour of the first bot on it that asks.
function pageDot(p) {
  const dot = p.keys.map(askColor).find(Boolean);
  return dot ? `<i class="kp-dot" style="--c:${Unread.tint(dot)}"></i>` : '';
}
// The Chief's chat, ready to write in.
const askChief = () => { openChief(); requestAnimationFrame(() => $('#view-chief textarea')?.focus()); };
// A phone's home (#498): the Board line, every page as a section of keys under its name and count, and the Chief's
// message box. A key opens its chat full screen, as a row of the list does, and Back returns here. No digits, no keys.
function drawKeypadSections(pages) {
  const sections = $('#kp-sections'), chief = $('#kp-chief');
  if (!sections) return;
  drawBoardLine($('#kp-phone-board'));
  sections.innerHTML = pages.map((p, n) => `<section class="kp-section" data-section="${n}"><h3 class="kp-sec-head">${esc(p.name)} <b>${p.keys.length}</b>${pageDot(p)}</h3><div class="kp-sec-keys">${p.keys.map((x, i) => keyHTML(x, i, n)).join('')}</div></section>`).join('');
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
// Needs you on the keypad: its heads and how many, opening as the banner's Review does.
function drawKeypadNeeds(items, review) {
  const el = $('#kp-needs');
  if (!el) return;
  el.classList.toggle('hidden', !items.length);
  el.innerHTML = items.length ? `${needsFigures(items)}<span>${items.length} waiting for your OK</span>` : '';
  el.onclick = review;
}
// Digits, Esc and Ctrl+K (Keypad.press), while the keypad is shown and no dialog is open.
function onKeypadKey(e) {
  if (e.defaultPrevented || e.isComposing || $('#modal')?.open || !keypadShown()) return;
  const t = e.target;
  const inField = !!(t?.isContentEditable || t?.matches?.('input, textarea, select'));
  const all = keypadKeys(keypadPages());
  const act = Keypad.press({ key: e.key, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey, shift: e.shiftKey, inField }, { keys: all.length });
  if (!act || (act.action === 'chief' && state.view === 'chief')) return;
  e.preventDefault();
  if (act.action === 'open') openKey(all[act.key].x);
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
// category (its heading = first there). Dropping it there pins, reorders or moves it to that category. A group's
// place is counted among the groups (docs/api.md, Groups): it lands among the groups of where it is dropped, after
// the bots there, and a bot lands among the bots, before the groups.
const BOT_DRAG = 'application/x-botdot-bot';
let dragId = null; // the row being dragged, by its `data-contact`: a bot's id, or "group:<id>" (dragover can't read the drag's data)
const draggedGroup = () => (String(dragId || '').startsWith('group:') ? groupById(dragId.slice(6)) : null);
const dragged = () => draggedGroup() || state.bots.find((b) => b.id === dragId) || null;
// Where what is dragged stands now: its category, and its place there among its own kind.
const draggedIn = (x) => (x.members ? x.category : x.group) || '';
const draggedPlace = (x) => (x.members ? groupsIn(draggedIn(x)).indexOf(x) + 1 : placeOf(x));
// The last bot's row among the pinned ones (cat null) or in a category: the groups there stand after it.
const lastBotRow = (cat) => $$(`#contacts [data-contact]:not([data-kind="group"])${cat === null ? '[data-pin]' : `[data-group="${CSS.escape(cat)}"]`}`).pop() || null;
function wireDrags() {
  $$('#contacts [data-contact]:not([data-contact="chief"]):not([data-contact="dashboard"])').forEach((el) => {
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
  $$('#contacts [data-contact]:not([data-contact="dashboard"]), #contacts [data-group-head]').forEach((el) => {
    el.ondragover = (e) => {
      if (!e.dataTransfer.types.includes(BOT_DRAG)) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      const d = el.dataset;
      const group = !!draggedGroup();
      const cat = d.contact === 'chief' || d.pin ? null : 'groupHead' in d ? d.groupHead : d.group;
      // Over a row of the other kind: a group goes first among the groups there, a bot last among the bots,
      // and the gap opens between the two.
      if (d.contact && d.contact !== 'chief' && group !== (d.kind === 'group')) {
        const bots = cat === null ? state.bots.filter((b) => b.pinned > 0).length : inGroup(cat).length;
        const at = group ? 1 : bots + 1;
        return openGap(cat === null ? { pinned: at } : { group: cat, order: at }, lastBotRow(cat) || $(`#contacts [data-group-head="${CSS.escape(cat || '')}"]`) || $('#contacts [data-contact="chief"]') || el, false);
      }
      // Above or below the row under the pointer (always below the Chief and a heading).
      const above = d.contact && d.contact !== 'chief' && e.clientY < el.getBoundingClientRect().top + el.offsetHeight / 2;
      const spot = d.contact === 'chief' ? { pinned: 1 }
        : 'groupHead' in d ? { group: d.groupHead, order: 1 }
        : d.pin ? { pinned: Number(d.pin) + (above ? 0 : 1) }
        : { group: d.group, order: Number(d.place) + (above ? 0 : 1) };
      // A group dropped on the Chief or on a heading is the first group there: after the bots that are drawn.
      openGap(spot, (group && !d.kind && lastBotRow(cat)) || el, above);
    };
    el.ondrop = (e) => dropAt(e, gapSpot);
  });
}

// The gap that opens where the dragged row would land. spot: { pinned: n } or { group, order: n } (1 = first),
// counted among its own kind. `group` there is a category, by the name a bot's field has in the API.
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

// Put the pinned ones in order again, as the server does; unpinned ones get a place in their group back.
function renumberPins() { state.bots.filter((b) => b.pinned > 0).sort((a, b) => a.pinned - b.pinned).forEach((b, i) => { b.pinned = i + 1; }); }
function renumberGroup(g) { inGroup(g).forEach((b, i) => { b.order = i + 1; }); }

// Pin a bot at a place below the Chief (1 = first; 0 = unpin: last in its group), the others making room.
async function pinBot(bot, at) {
  if (bot.pinned === at) return renderContacts();
  const others = state.bots.filter((b) => b.pinned > 0 && b !== bot).sort((a, b) => a.pinned - b.pinned);
  if (at > 0) others.splice(Math.min(at, others.length + 1) - 1, 0, bot);
  const was = bot.pinned;
  bot.pinned = 0;
  others.forEach((b, i) => { b.pinned = i + 1; });
  if (at > 0) { bot.order = 0; renumberGroup(bot.group || ''); } else if (was > 0) { bot.order = Infinity; renumberGroup(bot.group || ''); }
  renderContacts(); // right away; the save follows
  try { await api(`/bots/${bot.id}`, { method: 'PUT', body: { pinned: at } }); } catch (err) { toast(err.message, true); }
  refresh();
}

// Put a bot at a place in a group (1 = first), moving it there from another group or from the pinned ones.
async function moveBot(bot, group, at) {
  const from = bot.group || '';
  const wasPinned = bot.pinned > 0;
  if (wasPinned) { bot.pinned = 0; renumberPins(); }
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

// ---------- bots ----------

function openModal(html) {
  const m = $('#modal');
  m.innerHTML = html;
  m.showModal();
  $$('[data-dismiss]', m).forEach((b) => (b.onclick = () => m.close()));
  return m;
}

// The question before a bot gets the permission mode "Everything allowed" (bypassPermissions): whether the
// owner said yes. Closing it any other way is a no.
function askEverythingAllowed(name) {
  return new Promise((resolve) => {
    const m = openModal(`
      <div class="modal-head"><h2>Let ${esc(name)} do everything without checks?</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
      <div class="modal-body"><p style="margin:0">It will run any command and change any file without asking you. You can change this back here at any time.</p></div>
      <div class="modal-foot">
        <button type="button" class="btn" data-dismiss>Cancel</button>
        <button type="button" class="btn primary" id="allow-everything">Allow everything</button>
      </div>`);
    let yes = false;
    $('#allow-everything', m).onclick = () => { yes = true; m.close(); };
    m.addEventListener('close', () => resolve(yes), { once: true });
  });
}

function openRunDialog(botId) {
  const bot = botId && state.bots.find((b) => b.id === botId);
  const m = openModal(`
    <form method="dialog" id="run-form">
      <div class="modal-head"><h2>${bot ? `Run ${botLabel(bot)}` : 'Run a bot'}</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
      <div class="modal-body">
        ${bot ? '' : `<label class="field">Bot<select name="bot">${state.bots.map((b) => `<option value="${esc(b.id)}">${esc(b.name)}: ${esc(b.description.slice(0, 60))}</option>`).join('')}</select></label>`}
        <label class="field">Task <span class="hint">Edit it for this run only. {{date}} gets filled in.</span>
          <textarea name="prompt" rows="6"></textarea></label>
        <div class="faint" id="run-mode-info" style="font-size:12px"></div>
      </div>
      <div class="modal-foot"><button type="button" class="btn" data-dismiss>Cancel</button><button class="btn primary" type="submit">▶ Start run</button></div>
    </form>`);
  const form = $('#run-form', m);
  const sync = () => {
    const b = bot || state.bots.find((x) => x.id === form.bot.value);
    form.prompt.value = b.prompt;
    $('#run-mode-info', m).textContent = `Permission mode: ${b.permissionMode} (${MODE_INFO[b.permissionMode] || ''}) · Tools: ${b.allowedTools.join(', ') || 'default'}`;
  };
  if (form.bot) form.bot.onchange = sync;
  sync();
  form.onsubmit = async (e) => {
    e.preventDefault();
    const id = bot ? bot.id : form.bot.value;
    const b = state.bots.find((x) => x.id === id);
    try {
      await api(`/bots/${id}/run`, { method: 'POST', body: { prompt: form.prompt.value === b.prompt ? undefined : form.prompt.value } });
      m.close();
      toast(`${b.name} started`);
      await refresh();
      setView('bot', id);
    } catch (err) { toast(err.message, true); }
  };
}

// ---------- a bot's settings (its own page; every change saves by itself) ----------

// What a bot may do, as plain switches. Each adds or removes Claude Code tools; the exact list is under Advanced.
const PERMS = [
  { key: 'files', label: 'Can change files', hint: 'create and edit files in its folder', tools: ['Edit', 'Write'] },
  { key: 'web', label: 'Can browse the web', hint: 'search, and read web pages', tools: ['WebSearch', 'WebFetch'] },
  { key: 'bash', label: 'Can run commands', hint: 'any shell command in its folder', tools: ['Bash'] },
];

// The page's form, in the shape the API takes. sel: the picked skills, apps and teammates.
function readBotForm(form, sel) {
  return {
    name: form.name.value,
    color: form.color.value,
    description: form.description.value,
    group: form.group.value.trim(),
    prompt: form.prompt.value,
    systemPrompt: form.systemPrompt.value,
    computer: form.computer.checked ? 'linux' : 'none',
    computerAlwaysOn: form.computer.checked && form.computerAlwaysOn.checked,
    computerEgress: form.computerEgress.value,
    skills: [...sel.skills],
    disabledSkills: readDisabledSkills(form),
    connectors: [...sel.connectors],
    mayMessageAll: sel.others.every((id) => sel.mayMessage.has(id)),
    mayMessage: [...sel.mayMessage],
    allowedTools: form.tools.value.split('\n').map((s) => s.trim()).filter(Boolean),
    permissionMode: form.permissionMode.value,
    ...readLlmFields(form, 'bot'),
  };
}

// Switched-off machine/built-in skills: unticked switches, plus earlier ones that aren't shown right now.
function readDisabledSkills(form) {
  let before = [];
  try { before = JSON.parse(form.dataset.disabled || '[]'); } catch { /* none */ }
  return form._sysOff ? [...form._sysOff] : before; // the Skills list sets it once loaded; until then keep as is
}

// A row that folds open (Skills, Apps, May message): what's picked in one line, and a tap on the row
// shows everything with a checkbox. Ticking saves (onChange). items: [{ id, label, desc }].
// action: { label, run(id) } puts a button on each item instead of a checkbox (e.g. Revoke); it's taken off the list once run() succeeds.
// More about a library skill, for when its name is clicked: where it came from, what it has, who uses it.
function skillMoreHTML(k) {
  const bot = (id) => botById(id)?.name || 'a deleted bot';
  const from = k.source === 'github' ? `Installed by you from ${k.sourceUrl || 'GitHub'}` : k.createdBy?.startsWith('bot:') ? `Written by ${bot(k.createdBy.slice(4))}` : k.createdBy === 'chief' ? 'Written by the Chief' : 'Written by you';
  const lines = [
    from,
    k.fileCount > 1 ? `${k.fileCount} files${k.scripts?.length ? `, with scripts it can run (${k.scripts.slice(0, 3).join(', ')}${k.scripts.length > 3 ? ', …' : ''})` : ''}` : '',
    k.allowedTools?.length ? `Tools it uses: ${k.allowedTools.join(', ')}` : '',
    k.usedBy?.length ? `Used by ${k.usedBy.map(bot).join(', ')}` : 'No bot uses it yet',
  ].filter(Boolean);
  return `${lines.map(esc).join('<br>')}${k.instructions ? `<span class="pick-instructions">${esc(k.instructions.slice(0, 600))}${k.instructions.length > 600 ? '…' : ''}</span>` : ''}`;
}

function foldPicker(box, items, selected, onChange, { none = 'None', empty = 'Nothing to choose yet.', action = null, sum = null } = {}) {
  const row = box.closest('.bs-row');
  const label = (id) => items.find((x) => x.id === id)?.label || id;
  const summary = () => (sum ? sum() : [...selected].map(label).join(', ')) || none;
  let open = row.classList.contains('open');
  const draw = () => {
    row.classList.toggle('open', open);
    row.setAttribute('aria-expanded', open);
    const text = (x) => `<span class="grow"><span class="skill-name">${esc(x.label)}</span>${x.desc ? `<span class="desc">${esc(x.desc)}</span>` : ''}${x.more ? `<span class="pick-more">${x.more}</span>` : ''}</span>`;
    // Items can come in groups (a heading where the group changes), and with more to show when their name is clicked.
    const head = (x, i) => (x.group && x.group !== items[i - 1]?.group ? `<div class="pick-group">${esc(x.group)}</div>` : '');
    box.innerHTML = `<div class="faint bs-sum">${esc(summary())}</div>${open ? `<div class="pick-list">${items.length ? items.map((x, i) => head(x, i) + (action
      ? `<div class="skill-pick static-row">${text(x)}<button type="button" class="btn sm" data-pick-action="${esc(x.id)}">${esc(action.label)}</button></div>`
      : x.more
        ? `<div class="skill-pick has-more"><input type="checkbox" value="${esc(x.id)}" ${selected.has(x.id) ? 'checked' : ''} aria-label="${esc(x.label)}">${text(x)}</div>`
        : `<label class="skill-pick"><input type="checkbox" value="${esc(x.id)}" ${selected.has(x.id) ? 'checked' : ''}>${text(x)}</label>`)).join('') : `<div class="faint">${esc(empty)}</div>`}</div>` : ''}`;
    $$('.has-more > .grow', box).forEach((t) => (t.onclick = () => t.parentElement.classList.toggle('open')));
    $$('input', box).forEach((c) => (c.onchange = () => { c.checked ? selected.add(c.value) : selected.delete(c.value); onChange(); $('.bs-sum', box).textContent = summary(); }));
    $$('[data-pick-action]', box).forEach((btn) => (btn.onclick = async () => {
      btn.disabled = true;
      if (await action.run(btn.dataset.pickAction)) { items = items.filter((x) => x.id !== btn.dataset.pickAction); selected.delete(btn.dataset.pickAction); draw(); } else btn.disabled = false;
    }));
  };
  const toggle = () => { open = !open; draw(); };
  row.classList.add('bs-fold');
  row.tabIndex = 0;
  row.setAttribute('role', 'button');
  row.onclick = (e) => { if (!e.target.closest('.pick-list')) toggle(); };
  row.onkeydown = (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === row) { e.preventDefault(); toggle(); } };
  draw();
}

function renderBotSettings(force = false) {
  const root = $('#view-botsettings');
  const bot = state.bots.find((b) => b.id === state.botId);
  if (!bot) { if (state.bots.length) leaveBot(); return; }
  if (!force && root.dataset.bot === bot.id) { drawBotSettingsLive(bot); return; } // don't wipe what's being typed
  root.dataset.bot = bot.id;
  const b = bot;
  const docker = state.status?.docker?.ok;
  const knownTools = new Set(PERMS.flatMap((p) => p.tools));
  const has = (p) => p.tools.every((t) => b.allowedTools.includes(t));
  root.innerHTML = `
    <form id="bot-form" class="bot-settings" autocomplete="off">
      <div class="section-head"><div><h1>Settings</h1><p>Changes save by themselves. <span class="faint" id="bs-saved"></span></p></div></div>
      <div class="card settings-card">
        <label class="field">Name<input type="text" name="name" value="${esc(b.name)}" required maxlength="60"></label>
        <div class="field">Colour<div class="swatches">${BOT_COLORS.map(([c, n]) => `<label class="swatch" title="${n}"><input type="radio" name="color" value="${c}" ${b.color === c ? 'checked' : ''} aria-label="${n}"><i style="--c:${c}"></i></label>`).join('')}</div></div>
        <label class="field">What it does<input type="text" name="description" value="${esc(b.description)}" placeholder="One line, shown in the list"></label>
        <div class="field">Category
          <div class="group-picker" id="group-picker"></div>
          <input type="hidden" name="group" value="${esc(b.group || '')}">
        </div>
        <label class="field">Main assignment <span class="hint">what it does when a job runs it, and its guide for your messages</span>
          <textarea name="prompt" rows="5" required>${esc(b.prompt)}</textarea></label>
      </div>

      <div class="card settings-card bs-rows">
        <div class="bs-row ${docker || b.computer === 'linux' ? '' : 'hidden'}">
          <span class="bs-icon">🖥</span>
          <div class="grow"><b>Own computer</b><div class="faint">A desktop with a browser, for sites that need real clicking.${b.computer === 'linux' ? ' <button type="button" class="link-btn" data-bs-screen>See its screen</button>' : ''}</div></div>
          <label class="switch"><input type="checkbox" name="computer" ${b.computer === 'linux' ? 'checked' : ''} ${docker || b.computer === 'linux' ? '' : 'disabled'} aria-label="Own computer"><span></span></label>
        </div>
        <div class="bs-row">
          <span class="bs-icon">📌</span>
          <div class="grow"><b>Pinned below the Chief</b></div>
          <label class="switch"><input type="checkbox" id="bs-pinned" ${b.pinned > 0 ? 'checked' : ''} aria-label="Pinned below the Chief"><span></span></label>
        </div>
        <div class="bs-row" id="bs-skills">
          <span class="bs-icon">✦</span>
          <div class="grow"><b>Skills</b>${b.useSkills === false ? '<div class="faint">Skills are off for this bot. <button type="button" class="link-btn" data-skills-on>Turn them on</button></div>' : '<div id="skill-picks"><span class="faint">Loading…</span></div>'}</div>
          ${b.useSkills === false ? '' : '<span class="faint bs-chev">›</span>'}
        </div>
        <div class="bs-row hidden" id="bs-apps">
          <span class="bs-icon">🔌</span>
          <div class="grow"><b>Apps</b><div id="app-picks"></div></div>
          <span class="faint bs-chev">›</span>
        </div>
        <div class="bs-row ${state.bots.length > 1 ? '' : 'hidden'}">
          <span class="bs-icon">💬</span>
          <div class="grow"><b>May message</b><div id="bot-picks"></div></div>
          <span class="faint bs-chev">›</span>
        </div>
        <button type="button" class="bs-row bs-link" data-bs-jobs>
          <span class="bs-icon">⏰</span>
          <div class="grow"><b>Scheduled jobs</b><div class="faint" id="bs-jobs"></div></div>
          <span class="faint">›</span>
        </button>
        <div class="bs-row" id="bs-always">
          <span class="bs-icon">✓</span>
          <div class="grow"><b>Always approved</b><div id="always-picks"></div></div>
          <span class="faint bs-chev">›</span>
        </div>
      </div>

      <details class="card settings-card bs-advanced" id="bs-advanced">
        <summary><h3 class="page-sub" style="margin:0">Advanced</h3><span class="faint">What it may do, model, rules</span></summary>
        <div class="field">What it may do
          ${PERMS.map((p) => `<label class="toggle"><input type="checkbox" data-perm="${p.key}" ${has(p) ? 'checked' : ''}> ${p.label} <span class="hint muted" style="font-weight:400">${p.hint}</span></label>`).join('')}
          <details class="bs-exact" ${b.allowedTools.some((t) => !knownTools.has(t) && !['Read', 'Grep', 'Glob'].includes(t)) || !['dontAsk', 'acceptEdits'].includes(b.permissionMode) ? 'open' : ''}>
            <summary class="faint">Exact tools and permission mode</summary>
            <label class="field">Allowed tools <span class="hint">one per line, e.g. Bash(pytest:*) or mcp__github</span>
              <textarea class="mono" name="tools" rows="4">${esc(b.allowedTools.join('\n'))}</textarea></label>
            <label class="field">Permission mode<select name="permissionMode">${Object.entries(MODE_INFO).map(([k, v]) => `<option value="${k}" ${k === b.permissionMode ? 'selected' : ''}>${k}: ${v}</option>`).join('')}</select></label>
          </details>
        </div>
        <div class="field">Model and reasoning
          ${llmFieldsHTML('bot', { model: b.model, effort: b.effort }, `Default (${llmSummary(state.settings?.defaultModel, state.settings?.defaultEffort)})`)}
        </div>
        <label class="field">Personality / rules <span class="hint">added to Claude Code's system prompt</span>
          <textarea name="systemPrompt" rows="3">${esc(b.systemPrompt)}</textarea></label>
        <label>Computer network <select name="computerEgress"><option value="internet" ${b.computerEgress !== 'lan' ? 'selected' : ''}>Internet only</option><option value="lan" ${b.computerEgress === 'lan' ? 'selected' : ''}>Internet and local network</option></select><span class="hint muted">Local network access includes your router, NAS and other private services.</span></label>
        <label class="toggle"><input type="checkbox" name="computerAlwaysOn" ${b.computerAlwaysOn ? 'checked' : ''}> Keep its computer on all the time <span class="hint muted" style="font-weight:400">open apps keep running; uses memory all the time</span></label>
      </details>
      <div class="bs-foot"><button type="button" class="link-btn danger-text" id="delete-bot">Delete ${esc(b.name)}</button></div>
    </form>`;

  const form = $('#bot-form', root);
  form.dataset.disabled = JSON.stringify(b.disabledSkills || []);
  const others = state.bots.filter((x) => x.id !== b.id).map((x) => x.id);
  const sel = { skills: new Set(b.skills || []), connectors: new Set(b.connectors || []), mayMessage: new Set(b.mayMessageAll ? others : b.mayMessage || []), others };
  let saved = readBotForm(form, sel);
  let chain = Promise.resolve();
  let timer = null;
  // Send only what changed since the last save, one save at a time.
  const save = () => {
    clearTimeout(timer);
    chain = chain.then(async () => {
      const now = readBotForm(form, sel);
      const changes = Object.fromEntries(Object.entries(now).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(saved[k])));
      if (!Object.keys(changes).length) return;
      const note = $('#bs-saved', root);
      note.textContent = 'Saving…';
      try {
        const updated = await api(`/bots/${b.id}`, { method: 'PUT', body: changes });
        saved = { ...saved, ...changes };
        const i = state.bots.findIndex((x) => x.id === b.id);
        if (i >= 0) state.bots[i] = { ...state.bots[i], ...updated };
        note.textContent = 'Saved.';
        renderContacts();
        drawPanelHead(); // its name is the back button's
        if (state.view === 'bot' && state.botId === b.id) renderBotChat(); // and the chat's, beside the panel
      } catch (e) { note.textContent = ''; toast(e.message, true); }
    });
  };
  const saveSoon = () => { clearTimeout(timer); timer = setTimeout(save, 300); };
  form.addEventListener('change', (e) => { if (!e.target.matches('[data-perm]')) saveSoon(); });
  // "Everything allowed" asks first. Until the answer the select is back at its earlier mode, so that no
  // save, this one or another field's, carries the new one; Cancel leaves it there and saves nothing.
  let mode = form.permissionMode.value;
  form.permissionMode.addEventListener('change', async (e) => {
    const select = e.target;
    if (select.value !== 'bypassPermissions') { mode = select.value; return; }
    e.stopPropagation(); // not the form's listener above: nothing is saved before the answer
    select.value = mode;
    if (!(await askEverythingAllowed(form.name.value.trim() || b.name))) return;
    select.value = mode = 'bypassPermissions';
    saveSoon();
  });
  form.onsubmit = (e) => { e.preventDefault(); save(); };

  $('[data-bs-jobs]', root).onclick = () => setView('botjobs', b.id);
  const scr = $('[data-bs-screen]', root);
  if (scr) scr.onclick = () => openScreen(b.id);
  groupPicker($('#group-picker', root), form.group, saveSoon);
  // Saved on its own (not with the form), so a stale form never moves it.
  $('#bs-pinned', root).onchange = (e) => pinBot(state.bots.find((x) => x.id === b.id) || b, e.target.checked ? state.bots.filter((x) => x.pinned > 0 && x.id !== b.id).length + 1 : 0);
  wireLlmFields(form, 'bot');

  // The switches under "What it may do" add or remove their tools in the exact list (and the mode for files).
  const syncPerms = () => {
    const tools = new Set(form.tools.value.split('\n').map((s) => s.trim()).filter(Boolean));
    $$('[data-perm]', form).forEach((c) => { c.checked = PERMS.find((p) => p.key === c.dataset.perm).tools.every((t) => tools.has(t)); });
  };
  $$('[data-perm]', form).forEach((c) => (c.onchange = () => {
    const p = PERMS.find((x) => x.key === c.dataset.perm);
    const tools = form.tools.value.split('\n').map((s) => s.trim()).filter(Boolean).filter((t) => !p.tools.includes(t));
    if (c.checked) tools.push(...p.tools);
    form.tools.value = tools.join('\n');
    if (p.key === 'files') {
      if (c.checked && form.permissionMode.value === 'dontAsk') form.permissionMode.value = 'acceptEdits';
      if (!c.checked && form.permissionMode.value === 'acceptEdits') form.permissionMode.value = 'dontAsk';
      mode = form.permissionMode.value;
    }
    saveSoon();
  }));
  form.tools.addEventListener('input', syncPerms);

  const syncComputer = () => {
    form.computerAlwaysOn.disabled = !form.computer.checked;
    if (!form.computer.checked) form.computerAlwaysOn.checked = false;
  };
  form.computer.addEventListener('change', syncComputer);
  syncComputer();

  // Advanced stays open or closed as you last left it (this browser).
  const adv = $('#bs-advanced', root);
  try { adv.open = localStorage.getItem('botdot.bs.advanced') === '1'; } catch { /* private mode */ }
  adv.addEventListener('toggle', () => { try { localStorage.setItem('botdot.bs.advanced', adv.open ? '1' : '0'); } catch { /* private mode */ } });

  const on = $('[data-skills-on]', root);
  if (on) on.onclick = async () => {
    try { await api(`/bots/${b.id}`, { method: 'PUT', body: { useSkills: true } }); await refresh(); renderBotSettings(true); } catch (e) { toast(e.message, true); }
  };

  // Skills from your library: its own chips, and new ones written or imported for it right here.
  let ownSkills = []; // skills this bot wrote, which go with it when it's deleted
  const loadSkills = () => api('/skills').then(({ library, machine, builtin }) => {
    ownSkills = library.filter((k) => k.createdBy === `bot:${b.id}`);
    // One list: your library's skills (which it gets), and the ones from your Claude account and
    // Claude Code that every bot has unless you switch them off here.
    const box = $('#skill-picks', root);
    if (!box) return;
    const off = new Set(b.disabledSkills || []);
    const sys = [...machine.map((k) => ({ ...k, from: 'from your Claude account' })), ...(builtin || []).map((k) => ({ ...k, from: 'built into Claude Code' }))];
    const everyBot = 'Every bot has it unless you switch it off here.';
    // In each group the ones it has come first (as saved, so rows don't jump while you tick them).
    const has = new Set(b.skills || []);
    const first = (list, active) => [...list.filter(active), ...list.filter((k) => !active(k))];
    const items = [
      ...first(library, (k) => has.has(k.name)).map((k) => ({ id: `lib:${k.name}`, label: k.name, desc: k.description, group: 'Your skills', more: skillMoreHTML(k) })),
      ...['from your Claude account', 'built into Claude Code'].flatMap((from) => first(sys.filter((k) => k.from === from), (k) => !off.has(k.name))).map((k) => ({
        id: `sys:${k.name}`, label: k.name, desc: k.description,
        group: k.from === 'built into Claude Code' ? 'Built into Claude Code' : 'From your Claude account',
        more: esc(k.from === 'built into Claude Code' ? `Comes with Claude Code. ${everyBot}` : `Installed in your Claude account. ${everyBot}`),
      })),
    ];
    const on = new Set([...[...sel.skills].map((n) => `lib:${n}`), ...sys.filter((k) => !off.has(k.name)).map((k) => `sys:${k.name}`)]);
    form._sysOff = sys.filter((k) => off.has(k.name)).map((k) => k.name);
    const sum = () => {
      const lib = library.filter((k) => on.has(`lib:${k.name}`)).map((k) => k.name);
      const count = (from) => sys.filter((k) => k.from === from && on.has(`sys:${k.name}`)).length;
      const acc = count('from your Claude account'), built = count('built into Claude Code');
      return [...lib, acc ? `${acc} from your Claude account` : '', built ? `${built} built into Claude Code` : ''].filter(Boolean).join(', ');
    };
    foldPicker(box, items, on, () => {
      sel.skills.clear();
      library.forEach((k) => on.has(`lib:${k.name}`) && sel.skills.add(k.name));
      form._sysOff = sys.filter((k) => !on.has(`sys:${k.name}`)).map((k) => k.name);
      saveSoon();
    }, { empty: 'No skills yet. Ask the Chief to write one.', sum });
  }).catch(() => { const box = $('#skill-picks', root); if (box) box.innerHTML = '<span class="faint">Couldn\'t load skills.</span>'; });
  loadSkills();

  // Connected apps (Composio): shown once any are connected, or this bot already has some.
  api('/connectors').then((d) => {
    const apps = [...new Map(d.connections.filter((c) => c.status === 'ACTIVE').map((c) => [c.toolkit, c.app || { slug: c.toolkit, name: c.toolkit }])).values()];
    for (const s of sel.connectors) if (!apps.some((a) => a.slug === s)) apps.push({ slug: s, name: s }); // e.g. apps without sign-in
    if (!d.configured || !apps.length) return;
    $('#bs-apps', root).classList.remove('hidden');
    foldPicker($('#app-picks', root), apps.map((a) => ({ id: a.slug, label: a.name })), sel.connectors, saveSoon);
  }).catch(() => {});

  foldPicker($('#bot-picks', root), state.bots.filter((x) => x.id !== b.id).map((x) => ({ id: x.id, label: x.name, desc: x.description.slice(0, 120) })), sel.mayMessage, saveSoon,
    { none: 'Nobody', sum: () => (others.length > 1 && others.every((id) => sel.mayMessage.has(id)) ? 'Everyone' : [...sel.mayMessage].map((id) => botById(id)?.name || id).join(', ')) });
  // The jobs you said to always approve: their later changes need no OK. Untick one and it asks again.
  const trusted = (b.jobs || []).filter((j) => j.alwaysApprove);
  const alwaysBox = $('#always-picks', root);
  $('#bs-always', root).classList.toggle('hidden', !trusted.length);
  const trustedOn = new Set(trusted.map((j) => j.id));
  if (trusted.length) foldPicker(alwaysBox, trusted.map((j) => ({ id: j.id, label: j.name, desc: jobLine(j) })), trustedOn, () => {}, {
    action: { label: 'Revoke', run: async (id) => {
      try { await api(`/bots/${b.id}/jobs/${id}`, { method: 'PUT', body: { alwaysApprove: false } }); } catch (e) { toast(e.message, true); return false; }
      toast('Revoked: its next change waits for your OK');
      if (!trustedOn.size || (trustedOn.size === 1 && trustedOn.has(id))) $('#bs-always', root).classList.add('hidden');
      refresh();
      return true;
    } },
  });

  drawBotSettingsLive(b);

  $('#delete-bot', root).onclick = async () => {
    const hasComputer = !!state.computers?.[b.id];
    const ownOnly = ownSkills.filter((k) => !k.usedBy.some((x) => x !== b.id)).length;
    const gone = [
      hasComputer ? 'its computer (everything installed on it, its files and its browser logins)' : '',
      'its memory',
      ownOnly ? `the ${ownOnly === 1 ? 'skill' : `${ownOnly} skills`} it wrote` : '',
    ].filter(Boolean);
    const warning = `Delete ${b.name}?\n\nThis also erases ${gone.length > 1 ? `${gone.slice(0, -1).join(', ')} and ${gone[gone.length - 1]}` : gone[0]}. This can't be undone.\n\nIts run history is kept.`;
    if (!confirm(warning)) return;
    let r;
    try { r = await api(`/bots/${b.id}`, { method: 'DELETE' }); } catch (err) { return toast(err.message, true); }
    toast(r.computer === 'erased' ? 'Bot and its computer deleted' : r.computer === 'failed' ? "Bot deleted, but its computer couldn't be erased (is Docker running?)" : 'Bot deleted', r.computer === 'failed');
    delete root.dataset.bot;
    leaveBot();
    await refresh();
  };
}

// The bits of the settings page that follow the bot while it's open: its jobs.
function drawBotSettingsLive(bot) {
  const root = $('#view-botsettings');
  const jobs = bot.jobs || [];
  const waiting = jobs.filter(jobWaits).length;
  const jl = $('#bs-jobs', root);
  if (jl) jl.textContent = !jobs.length ? 'None. Ask it, or the Chief, e.g. "check the news every morning at 8".'
    : waiting ? `${waiting} waiting for your OK`
      : `${jobs.length} job${jobs.length === 1 ? '' : 's'}${bot.nextRunAt ? ` · next ${shortTime(bot.nextRunAt)}` : ''}`;
}

// ---------- a bot's scheduled jobs (their own page; each change saves by itself) ----------

function renderBotJobs(force = false) {
  const root = $('#view-botjobs');
  const bot = state.bots.find((b) => b.id === state.botId);
  if (!bot) { if (state.bots.length) leaveBot(); return; }
  if (!force && root.dataset.bot === bot.id) {
    // Don't wipe what's being typed: an open panel takes only what the server now says of each job, its pill and its line.
    for (const card of $$('.job-card', root)) { const j = (bot.jobs || []).find((x) => x.id === card.dataset.job); if (j) drawJobLine(card, j); }
    return;
  }
  root.dataset.bot = bot.id;
  const jobs = bot.jobs || [];
  root.innerHTML = `
    <div class="section-head"><div><h1>Scheduled jobs</h1><p>${botLabel(bot)} runs these on its own. Changes save by themselves. Easiest: ask it or the Chief, e.g. "check the news every morning at 8".</p></div></div>
    <div class="job-list" id="job-list">${jobs.map((j) => jobCardHTML(j)).join('') || `<div class="card empty" style="padding:28px 20px" id="jobs-empty">No jobs yet.</div>`}</div>
    <div style="margin-top:12px"><button type="button" class="btn" id="job-add">＋ Add job</button></div>`;
  $$('.job-card', root).forEach((card) => wireJobCard(card, bot));
  $('#job-add', root).onclick = async () => {
    let job;
    try { job = await api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: '', kind: 'ai', cron: '0 9 * * *', prompt: '' } }); } catch (e) { return toast(e.message, true); }
    $('#jobs-empty', root)?.remove();
    const list = $('#job-list', root);
    list.insertAdjacentHTML('beforeend', jobCardHTML(job, true));
    wireJobCard(list.lastElementChild, bot);
    const name = list.lastElementChild.querySelector('[name=jobName]');
    name.focus();
    name.select();
    refresh();
  };
}

// ---------- runs ----------

function renderRuns() {
  const root = $('#view-runs');
  if (!root.querySelector('.runs-layout')) {
    root.innerHTML = `
      ${SUB_BACK}
      <div class="section-head"><div><h1>Activity</h1><p>Every bot run, live and past.</p></div>
        <select id="run-filter" style="width:auto"><option value="">All bots</option></select></div>
      <div class="runs-layout">
        <div class="card run-list" id="run-list"></div>
        <div class="card run-view" id="run-view"><div class="empty">Pick a run, or message a bot to start one.</div></div>
      </div>`;
    $('#run-filter').onchange = renderRunList;
  }
  const f = $('#run-filter');
  const cur = f.value;
  f.innerHTML = '<option value="">All bots</option>' + state.bots.map((b) => `<option value="${esc(b.id)}" ${b.id === cur ? 'selected' : ''}>${esc(b.name)}</option>`).join('');
  renderRunList();
  if (state.selectedRun && !$('#run-view').dataset.id) showRun(state.selectedRun);
}

function renderRunList() {
  const filter = $('#run-filter')?.value;
  const runs = state.runs.filter((r) => !filter || r.botId === filter);
  $('#run-list').innerHTML = runs.length
    ? runs.map((r) => `
      <button class="run-item ${r.id === state.selectedRun ? 'active' : ''}" data-id="${esc(r.id)}" style="--bot-color:${esc(r.botColor || '#6c7cff')}">
        ${runFigure(r)}
        <div class="grow">
          <div class="title">${esc(r.botName)}</div>
          <div class="sub">${ago(r.startedAt)} · ${r.jobName ? `⏰ ${esc(r.jobName)} · ` : r.trigger === 'schedule' ? '⏰ ' : ''}${[r.kind === 'script' ? 'no AI' : null, r.durationMs ? dur(r.durationMs) : null].filter(Boolean).join(' · ')}</div>
        </div>
        ${statusPill(r.reporting === 'held' ? 'held' : r.quiet ? 'quiet' : r.status)}
      </button>`).join('')
    : '<div class="empty" style="padding:30px">No runs yet</div>';
  $$('.run-item').forEach((el) => (el.onclick = () => openRun(el.dataset.id)));
}

function openRun(id) {
  state.selectedRun = id;
  const view = $('#run-view');
  if (view) view.dataset.id = '';
  setView('runs'); // renderRuns() opens the selected run
}

function toolArg(input) {
  if (!input) return '';
  return input.command || input.file_path || input.pattern || input.path || input.url || input.query || input.description || JSON.stringify(input).slice(0, 120);
}

function contentText(c) {
  if (typeof c === 'string') return c;
  if (Array.isArray(c)) return c.map((x) => (x.type === 'text' ? x.text : x.type === 'image' ? '[image]' : JSON.stringify(x))).join('\n');
  return JSON.stringify(c, null, 2);
}

// Turn a stream-json event into transcript HTML.
function renderEvent(ev, ctx) {
  if (ev.type === 'assistant') {
    return (ev.message?.content || []).map((c) => {
      if (c.type === 'text' && c.text.trim()) return `<div class="msg text md">${md(c.text)}</div>`;
      if (c.type === 'tool_use') {
        ctx.tools[c.id] = true;
        return `<details class="tool" id="tool-${esc(c.id)}"><summary><span class="tname">${esc(c.name)}</span><span class="targ">${esc(toolArg(c.input))}</span><span class="tstatus faint">…</span></summary><pre>${esc(JSON.stringify(c.input, null, 2))}</pre></details>`;
      }
      return '';
    }).join('');
  }
  if (ev.type === 'user') {
    for (const c of ev.message?.content || []) {
      if (c.type !== 'tool_result') continue;
      const images = Array.isArray(c.content) ? c.content.filter((x) => x.type === 'image' && (x.source?.data || x.source?.url)) : [];
      const textPart = Array.isArray(c.content) ? c.content.filter((x) => x.type !== 'image') : c.content;
      ctx.results.push({ id: c.tool_use_id, isError: c.is_error, text: contentText(textPart), images });
    }
    return '';
  }
  if (ev.type === 'stderr') return `<div class="msg stderr">${esc(ev.text)}</div>`;
  if (ev.type === 'script_output') return `<pre class="msg script-out">${esc(ev.text || '(no output)')}</pre>`;
  if (ev.type === 'raw') return `<div class="msg stderr">${esc(ev.text)}</div>`;
  return '';
}

function applyToolResults(root, ctx) {
  for (const r of ctx.results.splice(0)) {
    const el = root.querySelector(`#tool-${CSS.escape(r.id)}`);
    if (!el) continue;
    el.classList.toggle('err', !!r.isError);
    el.querySelector('.tstatus').textContent = r.isError ? 'error' : '✓';
    if (r.text) el.insertAdjacentHTML('beforeend', `<pre>${esc(r.text.slice(0, 8000))}${r.text.length > 8000 ? '\n…(truncated)' : ''}</pre>`);
    for (const img of r.images || []) {
      const src = img.source.url && img.source.url.startsWith('/api/runs/') ? img.source.url : `data:${img.source.media_type || 'image/png'};base64,${String(img.source.data || '').replace(/[^A-Za-z0-9+/=]/g, '')}`;
      el.insertAdjacentHTML('beforeend', `<img class="shot" alt="Screenshot" loading="lazy" src="${esc(src)}">`);
    }
  }
}

// ---------- bot computers (live screen) ----------

const screenUrl = (botId, control = false) =>
  `/computer/${encodeURIComponent(botId)}/vnc.html?autoconnect=1&reconnect=1&resize=scale&show_dot=1&view_only=${control ? 0 : 1}&path=${encodeURIComponent(`computer/${botId}/websockify`)}`;

// The screen viewer (noVNC) only retries after it has connected once. If the first try fails (the
// computer was still starting) or the computer restarted, it would sit on "Failed to connect", so
// reload it every few seconds until it's connected.
function keepScreenConnected(iframe) {
  if (!iframe || iframe.dataset.kept) return;
  iframe.dataset.kept = '1';
  const t = setInterval(() => {
    if (!iframe.isConnected) return clearInterval(t);
    let doc;
    try { doc = iframe.contentDocument; } catch { return; }
    if (!doc || !doc.body) return;
    const dlgOpen = doc.getElementById('noVNC_connect_dlg')?.classList.contains('noVNC_open');
    const text = doc.body.innerText || '';
    if (dlgOpen || /Failed to connect|Screen not available|connection is closed/i.test(text)) iframe.src = iframe.src;
  }, 4000);
}

function computerLabel(botId) {
  const st = state.computers?.[botId];
  const always = state.bots.find((b) => b.id === botId)?.computerAlwaysOn;
  if (always) return st === 'running' ? 'on (always on)' : 'starting (always on)';
  return st === 'running' ? 'on' : st === 'stopped' ? 'off (files kept)' : 'not created yet';
}

function openScreen(botId) {
  const bot = state.bots.find((b) => b.id === botId);
  if (!bot) return;
  let control = false;
  const m = openModal(`
    <div class="modal-head"><h2>${botLabel(bot)}'s computer</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
    <div class="modal-body">
      <div class="screen-frame" id="screen-frame"><div class="muted">Loading…</div></div>
      <div class="screen-bar">
        <span class="muted" id="screen-state" style="font-size:12.5px"></span>
        <span style="flex:1"></span>
        <button class="btn sm" id="screen-control">🖱 Take control</button>
        <a class="btn sm" id="screen-full" target="_blank" rel="noopener">⤢ Full screen</a>
        <button class="btn sm" id="screen-power"></button>
        <button class="btn sm danger" id="screen-reset" title="Delete this computer. The next run starts from a fresh desktop.">Reset</button>
      </div>
      <div class="screen-steps hidden" id="screen-steps"><div class="muted" style="font-size:12.5px">What it's doing: <span id="screen-now"></span></div></div>
      <div class="req-note hidden" id="screen-update">A newer desktop is available. This computer keeps running the version it was made with, so nothing installed on it is lost. <b>Reset</b> switches to the new desktop but erases its apps and files.</div>
    </div>`);
  api(`/bots/${botId}/computer`).then((d) => {
    $('#screen-update', m)?.classList.toggle('hidden', !d.outdated);
    if (d.diskBytes != null) $('#screen-state', m).dataset.disk = ` Uses ${d.diskBytes > 1e9 ? (d.diskBytes / 1e9).toFixed(1) + ' GB' : Math.max(1, Math.round(d.diskBytes / 1e6)) + ' MB'} of disk.`;
    frame();
  }).catch(() => {});
  m.classList.add('wide');
  const frame = () => {
    const on = state.computers?.[botId] === 'running';
    $('#screen-state', m).textContent = `Computer is ${computerLabel(botId)}.${bot.running ? ' The bot is using it right now.' : ''}${$('#screen-state', m).dataset.disk || ''}`;
    $('#screen-power', m).textContent = bot.computerAlwaysOn ? 'Always on' : on ? 'Turn off' : 'Turn on';
    $('#screen-power', m).disabled = !!bot.computerAlwaysOn;
    $('#screen-power', m).title = bot.computerAlwaysOn ? 'Set to stay on. Change it in the bot settings.' : '';
    $('#screen-control', m).textContent = control ? '👁 Just watch' : '🖱 Take control';
    $('#screen-full', m).href = screenUrl(botId, control);
    $('#screen-control', m).disabled = !on;
    $('#screen-frame', m).innerHTML = on
      ? `<iframe src="${screenUrl(botId, control)}" title="Live screen"></iframe>`
      : `<div class="screen-off"><div class="big">🖥</div>${bot.computerAlwaysOn ? 'Starting its computer… It stays on all the time.' : 'The computer is off. It turns on by itself when the bot runs.'}</div>`;
    keepScreenConnected($('#screen-frame iframe', m));
  };
  const act = async (action, label) => {
    try {
      toast(label);
      const r = await api(`/bots/${botId}/computer`, { method: 'POST', body: { action } });
      state.computers = { ...state.computers, [botId]: r.state === 'none' ? undefined : r.state };
      frame();
    } catch (e) { toast(e.message, true); }
  };
  $('#screen-control', m).onclick = () => { control = !control; frame(); };
  $('#screen-power', m).onclick = () => (state.computers?.[botId] === 'running' ? act('stop', 'Turning off…') : act('start', 'Turning on…'));
  $('#screen-reset', m).onclick = () => { if (confirm(`Reset ${bot.name}'s computer?\n\nEverything installed on it, its files and its browser logins are erased. The next run starts from a fresh desktop.`)) act('reset', 'Resetting…'); };
  // Its line as it works, in the server's words, so a quiet screen (e.g. while it waits for you) still tells you
  // what's happening.
  const run = state.runs.find((r) => r.botId === botId && r.status === 'running');
  const stepsEs = run && watchRun(run.id, () => { const n = $('#screen-now', m); if (n) n.textContent = 'finished'; }, null, (line) => {
    const box = $('#screen-steps', m);
    if (!box || !OpeningLine.text(line)) return;
    box.classList.remove('hidden');
    $('#screen-now', m).textContent = OpeningLine.text(line);
  });
  m.addEventListener('close', () => { m.classList.remove('wide'); stepsEs?.close(); }, { once: true });
  frame();
}


// Plain-language explanation for a failed or stopped run; the raw error stays in the details. The server
// sends the same text as `problem` (lib/problems.js); this is for a run the page followed live.
// endedBy: who ended the run (docs/api.md): the owner, the Chief, a sign-out or the time limit.
const ENDED_BY = {
  owner: 'You stopped this run before it finished.',
  chief: 'The Chief stopped this run before it finished.',
  signout: 'This run was stopped because Claude was signed out.',
  limit: 'I stopped after 60 minutes: this took too long. Send it again, or break it into smaller pieces.',
};
function friendlyProblem(meta, resultText) {
  const text = `${resultText || ''} ${meta.error || ''}`;
  if (Object.hasOwn(ENDED_BY, meta.endedBy)) return ENDED_BY[meta.endedBy];
  // Stopped, and the server names nobody (a server from before `endedBy`): the owner did. With a name the page does not know, nobody is named.
  if (meta.status === 'stopped') return meta.endedBy ? 'This run was stopped before it finished.' : ENDED_BY.owner;
  if (meta.status === 'interrupted') return 'This run was cut off because botdot was restarted.';
  if (/not logged in|\/login/i.test(text)) return "I couldn't start because Claude isn't signed in yet. Open Settings → Setup and sign in to Claude, then try again.";
  // Claude's servers refused the sign-in (a revoked or expired token): Claude Code's "Failed to authenticate. API Error: 401".
  if (/Failed to authenticate|authentication_error|API Error: 401/i.test(text)) {
    return `Claude refused my sign-in, so I couldn't finish. ${meta.jobName ? 'I will try again at the next scheduled time' : 'Send it again'}; if this keeps happening, sign in to Claude again in Settings → Setup.`;
  }
  if (/max.?turns/i.test(text)) return 'The task took more steps than I was allowed. Try breaking it into smaller pieces.';
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ECONNRESET|ETIMEDOUT|reach the API server|network error|fetch failed/i.test(text)) {
    return `I couldn't reach Claude's servers, so I couldn't start. This computer had no internet connection, or couldn't look up the address (a DNS problem).${meta.jobName ? ' I will try again at the next scheduled time.' : ' Check the connection and send the message again.'}`;
  }
  if (/overloaded|529|rate.?limit|429|usage limit/i.test(text)) return "Claude's servers were busy or my usage limit was reached, so I stopped. Try again in a little while.";
  // Something else: say what it was, briefly.
  const why = String(meta.error || resultText || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  return `Something went wrong and I couldn't finish.${why ? ` It said: “${why}”.` : ''} The details show everything that happened.`;
}

function runHeader(meta) {
  const when = fmtTime(meta.startedAt);
  const facts = [
    `${meta.jobName ? `⏰ ${esc(meta.jobName)}, ${meta.trigger === 'schedule' ? 'scheduled' : meta.trigger === 'call' ? 'called' : 'started'}` : meta.trigger === 'schedule' ? '⏰ Scheduled' : 'Started'} ${when}`,
    meta.kind === 'script' ? `⚙️ script, no AI${meta.exitCode != null ? ` · exit code ${meta.exitCode}` : ''}` : null,
    meta.durationMs != null ? `took ${dur(meta.durationMs)}` : null,
  ].filter(Boolean).join(' · ');
  return `
    <div class="run-header" style="--bot-color:${esc(meta.botColor || '#6c7cff')}">
      ${runFigure(meta)}
      <div class="grow"><h2>${esc(meta.botName)}</h2>
        <div class="muted" style="font-size:12.5px">${facts}</div></div>
      ${statusPill(meta.status)}
      ${meta.status === 'running' ? `<button class="btn danger sm" id="stop-run">■ Stop</button>` : `<button class="btn sm" id="rerun">↻ Run again</button>`}
    </div>`;
}

function detailsInfo(meta) {
  return `
    <div class="run-facts">
      <span>Folder <code class="mono">${esc(meta.project)}</code></span>
      ${meta.modelUsed || meta.model ? `<span>Model <b>${esc(meta.modelUsed || meta.model)}</b>${meta.effort ? ` · reasoning <b>${esc(effortLabel(meta.effort))}</b>` : ''}</span>` : ''}
      <span>Steps <b>${meta.numTurns ?? '—'}</b></span>
      ${meta.sessionId ? `<span>Continue in Claude Code: <code class="mono">cd ${esc(meta.project)} && claude --resume ${esc(meta.sessionId)}</code> <button class="btn ghost sm" id="copy-resume">copy</button></span>` : ''}
    </div>`;
}

const detailsOpen = () => { try { return localStorage.getItem('botdot.details') === '1'; } catch { return false; } };

function showRun(id) {
  if (state.runStream) { state.runStream.close(); state.runStream = null; }
  const view = $('#run-view');
  if (!view) return;
  view.dataset.id = id;
  $$('.run-item').forEach((el) => el.classList.toggle('active', el.dataset.id === id));
  const meta = state.runs.find((r) => r.id === id);
  const showDetails = detailsOpen();
  view.innerHTML = `
    <div id="run-head">${meta ? runHeader(meta) : ''}</div>
    <div class="conversation" id="conversation">
      <div class="bubble-row from-me"><div class="bubble from-me" id="ask"></div></div>
      <div id="live-screen"></div>
      <div class="bubble-row from-bot" style="--bot-color:${esc(meta?.botColor || '#6c7cff')}">
        ${runFigure(meta || {}, 'sm')}
        <div class="bubble from-bot live" id="answer"><div class="live-line"><div class="typing"><span></span><span></span><span></span></div><span class="activity muted">Working…</span></div></div>
      </div>
      <button class="details-toggle" id="details-toggle">${showDetails ? 'Hide details' : 'Show details'}</button>
      <div id="details" class="${showDetails ? '' : 'hidden'}">
        <div id="details-info">${meta ? detailsInfo(meta) : ''}</div>
        <div class="transcript" id="transcript"></div>
      </div>
    </div>`;
  const conv = $('#conversation');
  const tr = $('#transcript');
  const answer = $('#answer');
  const ctx = { tools: {}, results: [] };
  let current = meta;
  let resultText = null;
  let resultIsError = false;
  let line = ''; // the run's line while it goes on, as the server says it: the page has no words of its own for a step
  // Follow live output; open finished runs at the top of the answer.
  let stick = meta?.status === 'running';
  conv.onscroll = () => { stick = conv.scrollTop + conv.clientHeight > conv.scrollHeight - 40; };

  $('#details-toggle').onclick = () => {
    const d = $('#details');
    d.classList.toggle('hidden');
    const open = !d.classList.contains('hidden');
    $('#details-toggle').textContent = open ? 'Hide details' : 'Show details';
    try { localStorage.setItem('botdot.details', open ? '1' : '0'); } catch { /* ignore */ }
  };

  const wire = () => {
    const stop = $('#stop-run');
    if (stop) stop.onclick = async () => { await api(`/runs/${id}/stop`, { method: 'POST' }); toast('Stopping…'); };
    const rerun = $('#rerun');
    if (rerun) rerun.onclick = () => {
      const bot = state.bots.find((b) => b.id === current.botId);
      if (!bot) return toast('That bot was deleted', true);
      openRunDialog(bot.id);
    };
    const copy = $('#copy-resume');
    if (copy) copy.onclick = () => { navigator.clipboard.writeText(`cd ${current.project} && claude --resume ${current.sessionId}`); toast('Copied'); };
  };
  const refreshMeta = (m) => {
    current = m;
    $('#run-head').innerHTML = runHeader(m);
    $('#details-info').innerHTML = detailsInfo(m);
    wire();
  };
  const setActivity = (label) => {
    const a = answer.querySelector('.activity');
    if (a) a.textContent = `${label}…`;
  };
  const showAnswer = () => {
    const failed = resultIsError || ['error', 'stopped', 'interrupted'].includes(current?.status);
    const body = failed ? current?.problem || friendlyProblem(current || {}, resultText) : resultText || 'Done. (No written reply.)';
    answer.classList.toggle('problem', failed);
    answer.classList.remove('live'); // the answer can wrap normally
    answer.innerHTML = `<div class="md">${md(body)}</div>`;
  };
  wire();

  const es = new EventSource(`/api/runs/${id}/stream`);
  state.runStream = es;
  es.onmessage = (msg) => {
    const ev = JSON.parse(msg.data);
    if (OpeningLine.says(ev.type, state.features)) { line = OpeningLine.text(ev.text); setActivity(line || 'Working'); }
    if (ev.type === 'phase') {
      setActivity(OpeningLine.text(ev.text) || line || 'Working');
    } else if (ev.type === 'run_start') {
      refreshMeta(ev.meta);
      $('#ask').textContent = ev.meta.prompt;
      if (ev.meta.computer && ev.meta.status === 'running') {
        $('#live-screen').innerHTML = `<div class="live-screen"><div class="live-label"><span class="pill accent pulse">live</span> ${esc(ev.meta.botName)}'s screen <button class="btn ghost sm" data-screen-open>open</button></div><iframe src="${screenUrl(ev.meta.botId)}" title="Live screen"></iframe></div>`;
        keepScreenConnected($('#live-screen iframe'));
        $('[data-screen-open]').onclick = () => openScreen(ev.meta.botId);
      }
      $('#ask').onclick = () => $('#ask').classList.toggle('expanded');
    } else if (ev.type === 'run_end') {
      if (ev.meta) {
        refreshMeta(ev.meta);
        if (!$('#ask').textContent) $('#ask').textContent = ev.meta.prompt || '';
        if (resultText == null && ev.meta.result) resultText = ev.meta.result;
        if (ev.meta.error) tr.insertAdjacentHTML('beforeend', `<div class="msg stderr">${esc(ev.meta.error)}</div>`);
        const i = state.runs.findIndex((r) => r.id === id);
        if (i >= 0) state.runs[i] = ev.meta;
        renderRunList();
        render();
      }
      showAnswer();
      $('#live-screen').innerHTML = '';
      es.close();
    } else if (ev.type === 'result') {
      resultText = ev.result || '';
      resultIsError = !!ev.is_error;
    } else {
      const html = renderEvent(ev, ctx);
      if (html) tr.insertAdjacentHTML('beforeend', html);
      applyToolResults(tr, ctx);
    }
    if (stick) conv.scrollTop = conv.scrollHeight;
  };
  es.onerror = () => es.close();
  history.replaceState(null, '', `#runs/${id}`);
}

// ---------- chief of staff ----------

const CHIEF_SUGGESTIONS = [
  'What bots do I have, and what is each one good at?',
  'Create a bot that checks the news on a topic every morning and sends me the highlights.',
  'Make a bot with its own computer that can use websites for me.',
  'Make a research bot that finds fresh game design ideas on the web.',
];

// A shared composer: textarea that grows, Enter sends, Shift+Enter adds a line.
function composerHTML(placeholder, ctx = '') {
  return `
    <form class="composer" autocomplete="off">
      <div class="composer-wrap">
        <div class="away-line${away.on ? '' : ' hidden'}" role="status">Can't reach botdot. Trying again…</div>
        <div class="claude-line${signedOut.on && !away.on ? '' : ' hidden'}" role="status">${signedOutHTML()}</div>
        ${ctx ? `<div class="ctx">${ctx}</div>` : ''}
        <div class="send-note hidden" role="status"></div>
        <div class="attach-list hidden"></div>
        <div class="composer-box">
          <button class="attach-btn" type="button" aria-label="Attach files" title="Attach files (or drop them here)">${ICON.clip}</button>
          <input type="file" name="files" multiple hidden>
          <textarea name="text" rows="1" placeholder="${esc(placeholder)}"></textarea>
          <button class="send-btn" type="submit" aria-label="Send">${ICON.send}</button>
        </div>
      </div>
    </form>`;
}

// Files attached in a composer: uploaded right away into the bot's (or the Chief's) workspace, and
// sent with the message. uploadTo() says where: 'bot:<id>' or 'chief'.
const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : n >= 1024 ? `${Math.round(n / 1024)} KB` : `${n} B`);
const fileIcon = (name) => ({ xlsx: '📊', xls: '📊', xlsm: '📊', csv: '📊', ods: '📊', tsv: '📊', pdf: '📕', docx: '📝', doc: '📝', odt: '📝', md: '📝', txt: '📝', pptx: '📽', odp: '📽', png: '🖼', jpg: '🖼', jpeg: '🖼', gif: '🖼', webp: '🖼', json: '🧾' }[String(name).split('.').pop().toLowerCase()] || '📄');
const fileChipHTML = (f, removable) => `<span class="file-chip ${f.status || ''}" title="${esc(f.name)}${f.size ? ` · ${fmtSize(f.size)}` : ''}">${fileIcon(f.name)} <span class="fname">${esc(f.name)}</span>${f.status === 'uploading' ? ' <i>uploading…</i>' : f.status === 'failed' ? ' <i>failed</i>' : ''}${removable ? `<button type="button" data-unattach="${esc(f.key)}" aria-label="Remove">×</button>` : ''}</span>`;
const filesHTML = (list) => (list?.length ? `<div class="bubble-files">${list.map((f) => fileChipHTML(f, false)).join('')}</div>` : '');
// Files a bot attached to its reply: tap to open (a PDF) or download.
const fileHref = (f) => `/api/files/${String(f.file).split('/').map(encodeURIComponent).join('/')}`;
const isImage = (f) => /\.(png|jpe?g|gif|webp)$/i.test(f.name);
// Pictures show as themselves (a QR code to scan can't wait for a download); tap for full size.
const botFilesHTML = (list) => (list?.length ? `<div class="bubble-files">${list.map((f) => isImage(f) ? `<a class="file-image" href="${esc(fileHref(f))}" target="_blank" rel="noopener" title="${esc(f.name)}"><img src="${esc(fileHref(f))}" alt="${esc(f.name)}" loading="lazy"></a>` : `<a class="file-chip link" href="${esc(fileHref(f))}" ${/\.pdf$/i.test(f.name) ? 'target="_blank" rel="noopener"' : `download="${esc(f.name)}"`} title="${esc(f.name)}${f.size ? ` · ${fmtSize(f.size)}` : ''}">${fileIcon(f.name)} <span class="fname">${esc(f.name)}</span></a>`).join('')}</div>` : '');

// Files botdot already has (those of a message taken back), as the list of a message box holds them: ready to send.
const readyFiles = (list) => (Array.isArray(list) ? list : []).filter((f) => f && typeof f.file === 'string')
  .map(({ name, file, size, readable }) => ({ key: Math.random().toString(36).slice(2), name: String(name ?? file), file, size, readable, status: 'ready' }));

function wireAttachments(form, uploadTo) {
  const list = $('.attach-list', form);
  const input = form.files;
  form._files = [];
  const draw = () => {
    list.classList.toggle('hidden', !form._files.length);
    list.innerHTML = form._files.map((f) => fileChipHTML(f, true)).join('');
    $$('[data-unattach]', list).forEach((b) => (b.onclick = () => { form._files = form._files.filter((f) => f.key !== b.dataset.unattach); draw(); }));
  };
  const add = (files) => {
    for (const file of files) {
      if (form._files.length >= 10) { toast('Attach at most 10 files at a time.', true); break; }
      if (file.size > 25 * 1024 * 1024) { toast(`${file.name} is over 25 MB.`, true); continue; }
      const f = { key: Math.random().toString(36).slice(2), name: file.name, size: file.size, status: 'uploading' };
      form._files.push(f);
      fetch(`/api/uploads?to=${encodeURIComponent(uploadTo())}`, {
        method: 'POST',
        headers: { 'X-Bot-Dot': '1', 'X-File-Name': encodeURIComponent(file.name), 'Content-Type': 'application/octet-stream' },
        body: file,
      }).then(async (r) => {
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(d.error || `Upload failed (${r.status})`);
        Object.assign(f, d, { name: file.name, status: 'ready' });
      }).catch((e) => { f.status = 'failed'; toast(`${file.name}: ${e.message}`, true); }).finally(draw);
    }
    draw();
  };
  $('.attach-btn', form).onclick = () => input.click();
  input.onchange = () => { add([...input.files]); input.value = ''; };
  form.text.addEventListener('paste', (e) => { if (e.clipboardData?.files?.length) { e.preventDefault(); add([...e.clipboardData.files]); } });
  // Drop files anywhere on the chat.
  const zone = form.closest('.view') || form;
  zone.ondragover = (e) => { if ([...(e.dataTransfer?.types || [])].includes('Files')) { e.preventDefault(); zone.classList.add('dropping'); } };
  zone.ondragleave = (e) => { if (!zone.contains(e.relatedTarget)) zone.classList.remove('dropping'); };
  zone.ondrop = (e) => { if (!e.dataTransfer?.files?.length) return; e.preventDefault(); zone.classList.remove('dropping'); add([...e.dataTransfer.files]); };
  return {
    busy: () => form._files.some((f) => f.status === 'uploading'),
    // What take() is about to send, and those files back in the list, in front of any attached since: for a send that failed.
    held: () => form._files.filter((f) => f.status === 'ready'),
    put: (held) => { form._files = [...held, ...form._files]; draw(); },
    take: () => { const ready = form._files.filter((f) => f.status === 'ready').map(({ name, file, size, readable }) => ({ name, file, size, readable })); form._files = []; draw(); return ready; },
    count: () => form._files.filter((f) => f.status === 'ready').length,
  };
}

// "@" suggestions above the message box (mentions.js): bots, then jobs, then skills, a few rows, no headings.
// ↑/↓ move, Enter or Tab picks, Esc closes; a tap or click picks too. chat is the Chief's id or a bot id.
function wireMentions(form, chat, grow) {
  const ta = form.text;
  const list = document.createElement('div');
  list.className = 'mention-list hidden';
  list.setAttribute('role', 'listbox');
  $('.composer-wrap', form).append(list);
  let rows = [], sel = 0, picked = -1; // picked: where a bot mention just put in (and its new space) ends
  const label = (r) => {
    const bot = r.bot && mentionCtx(chat).bots.find((b) => b.id === r.bot);
    if (r.kind === 'bot') return botLabel(bot);
    if (r.kind === 'job') return `${botLabel(bot)} · ${esc(bot.jobs.find((j) => j.id === r.job)?.name || '')}`;
    return esc(r.label);
  };
  const draw = () => {
    list.classList.toggle('hidden', !rows.length);
    list.innerHTML = rows.map((r, i) => `<button type="button" role="option" aria-selected="${i === sel}" data-i="${i}">${label(r)}</button>`).join('');
  };
  const close = () => { if (rows.length) { rows = []; draw(); } };
  const update = () => {
    rows = ta.selectionStart === ta.selectionEnd ? Mentions.suggest(ta.value.slice(0, ta.selectionStart), mentionCtx(chat)) : [];
    sel = 0;
    draw();
  };
  const pick = (r) => {
    const done = Mentions.pick(ta.value, ta.selectionStart, r);
    if (!done) return close();
    ta.value = done.text;
    ta.setSelectionRange(done.cursor, done.cursor);
    picked = done.jobsNext ? done.cursor : -1;
    close();
    grow();
  };
  list.onmousedown = (e) => e.preventDefault(); // keep the cursor (and a phone's keyboard) in the box
  list.onclick = (e) => { const b = e.target.closest('[data-i]'); if (b) { pick(rows[+b.dataset.i]); ta.focus(); } };
  ta.addEventListener('input', () => { picked = -1; update(); });
  ta.addEventListener('click', update);
  ta.addEventListener('keyup', (e) => { if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) update(); });
  ta.addEventListener('blur', close);
  return {
    close,
    // A key the list handles, or false.
    key(e) {
      // "/" right after a picked bot: its jobs (the space the pick added goes).
      if (e.key === '/' && picked >= 0 && ta.selectionStart === picked && ta.selectionEnd === picked) {
        e.preventDefault();
        ta.setRangeText('/', picked - 1, picked, 'end');
        picked = -1;
        update();
        return true;
      }
      if (!rows.length || e.isComposing) return false;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { sel = (sel + (e.key === 'ArrowDown' ? 1 : rows.length - 1)) % rows.length; draw(); }
      else if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') pick(rows[sel]);
      else if (e.key === 'Escape') { close(); e.stopPropagation(); }
      else return false;
      e.preventDefault();
      return true;
    },
  };
}

// The line above the message box after a send that failed: why, and that nothing is lost. A request that
// got no answer, a refusal with the server's sentence, and an answer nobody can read the outcome from.
function sendNoteText(err) {
  const kept = 'Your message is still here.';
  if (err?.unsure) return `It may have been sent: check the chat. ${kept}`;
  if (err?.unreached || !err?.message) return `Not sent: can't reach botdot. ${kept}`;
  const said = String(err.message).trim();
  return `Not sent: ${said}${/[.!?…]$/.test(said) ? '' : '.'} ${kept}`;
}
// The line above the message box: one sentence of the page's, or none.
function showBoxNote(form, text) {
  const note = form?.querySelector('.send-note');
  if (!note) return;
  note.textContent = text || '';
  note.classList.toggle('hidden', !text);
}
// err: why the send failed; nothing takes the line away.
function showSendNote(form, err) {
  showBoxNote(form, err ? sendNoteText(err) : '');
}
// The chats with a send under way, by their form: one message goes at a time, from the message box or from
// outside it. A second Send or tap meanwhile sends nothing, and loses nothing.
const sendingIn = new WeakSet();
// A send from outside the message box (a quick answer, a question card, a starter): whether it went. When
// it did not, the line above the box of that chat says why, and what was tapped stays.
async function sendFrom(form, send) {
  if (sendingIn.has(form)) return false;
  sendingIn.add(form);
  showSendNote(form, null);
  try { await send(); return true; } catch (e) { showSendNote(form, e); return false; } finally { sendingIn.delete(form); }
}
// One key for every send of what a button sends, for as long as the button is drawn (a starter, the plan's Approve).
const withKey = (send) => { const key = messageKey(); return () => send(key); };
// A failed message back in the box, in front of what was typed since.
const withFailed = (failed, typedSince) => (failed && typedSince.trim() ? `${failed}\n${typedSince}` : failed || typedSince);

// A message whose send failed after its chat was left (a bot's message box is built again for each bot): kept
// by chat, 'chief' or 'bot:<id>', and put into that chat's box when it is built again.
const failedSends = new Map(); // chat → { text, held, err, sent }

// onSend(text, attachments, key) sends: a promise that rejects when the message did not go. The box empties at
// once, so the next message can be typed, and gets the text and the files back when the send failed. The
// message keeps its key (messageKey) until it went or is changed: sent again as it is, botdot takes it once.
function wireComposer(form, onSend, uploadTo, chat) {
  const ta = form.text;
  const btn = form.querySelector('.send-btn');
  const files = uploadTo ? wireAttachments(form, uploadTo) : null;
  if (!uploadTo) $('.attach-btn', form)?.remove();
  const grow = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 200) + 'px'; };
  const mentions = chat ? wireMentions(form, chat, grow) : null;
  // The message that failed last, as it was sent: { text, files, key }. Sent again with this text and these files,
  // it is that message; an edit, or other files, makes a new one.
  let failed = null;
  const same = (a, b) => a.length === b.length && a.every((f, i) => f === b[i]);
  ta.oninput = () => { grow(); showSendNote(form, null); failed = null; }; // edited: the line goes, and its key
  const giveBack = ({ text, held, err, sent }) => {
    ta.value = withFailed(text, ta.value);
    grow();
    files?.put(held);
    showSendNote(form, err);
    failed = sent || null;
  };
  const key = uploadTo?.();
  if (failedSends.has(key)) { giveBack(failedSends.get(key)); failedSends.delete(key); }
  // A waiting message the owner took back (takeBack): its text in front of what was typed since, its files
  // ready to send. It is a new message: it has no key yet.
  form._takeBack = (text, attachments) => giveBack({ text, held: readyFiles(attachments), err: null, sent: null });
  ta.onkeydown = (e) => {
    if (mentions?.key(e)) return;
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing && !matchMedia('(pointer: coarse)').matches) { e.preventDefault(); form.requestSubmit(); }
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (btn.classList.contains('stop') || sendingIn.has(form)) return; // one message at a time: a second Send waits for the first
    const text = ta.value.trim();
    if (files?.busy()) return toast('Wait a moment: the files are still uploading.');
    if (!text && !files?.count()) return;
    if (looksLikeSecret(text) && !confirm('This looks like it contains a password.\n\nMessages are sent to the AI and saved on disk. Let the bot ask for it instead: it opens a secure box that goes straight into your Vault.\n\nSend anyway?')) return;
    const held = files ? files.held() : [];
    const sent = failed && failed.text === text && same(failed.files, held) ? failed : { text, files: held, key: messageKey() };
    failed = null;
    ta.value = '';
    grow();
    mentions?.close();
    showSendNote(form, null);
    sendingIn.add(form);
    btn.disabled = true;
    try {
      await onSend(text, files ? files.take() : [], sent.key);
    } catch (err) {
      if (form.isConnected === false) {
        // This box is gone: the owner opened another bot meanwhile. Said now, and back in the box with that chat.
        // Two messages that wait there together are one new message.
        const waiting = failedSends.get(key);
        failedSends.set(key, { text: withFailed(text, waiting?.text || ''), held: [...held, ...(waiting?.held || [])], err, sent: waiting ? null : sent });
        toast(sendNoteText(err), true);
      } else giveBack({ text, held, err, sent });
    } finally {
      sendingIn.delete(form);
      btn.disabled = false;
    }
  };
}

// Send stays (docs/api.md, "A message that waits"): a message to a working bot or a replying Chief waits its
// turn on the botdot server, and Stop is the word at the end of the working line (placeStatusLines).
const sendStays = () => state.features.includes('message-waits');
// The box of a server from before that: the Chief's shows Stop while it replies, and sends nothing meanwhile.
function setSendBusy(form, busy, onStop) {
  const btn = form?.querySelector('.send-btn');
  if (!btn) return;
  busy = !!busy && !sendStays();
  btn.classList.toggle('stop', busy);
  btn.innerHTML = busy ? ICON.stop : ICON.send;
  btn.type = busy ? 'button' : 'submit';
  btn.setAttribute('aria-label', busy ? 'Stop' : 'Send');
  btn.onclick = busy ? onStop : null;
}

function renderChief() {
  const root = $('#view-chief');
  if (!root.querySelector('#chat-thread')) {
    root.innerHTML = `
      <div class="chat-head">
        ${BACK_BTN}
        <button class="chat-title" id="chief-settings" title="Its settings">
          <div id="chief-avatar">${chiefFigure('sm')}</div>
          <div class="grow"><h2>Chief of Staff</h2><div class="sub" id="chief-sub"></div></div>
        </button>
        <div class="actions-right">
          <button class="icon-btn" id="chief-new" title="New chat">${ICON.compose}</button>
        </div>
      </div>
      <div class="chat-thread" id="chat-thread"></div>
      ${composerHTML('Message the Chief…')}`;
    wireComposer($('form', root), sendToChief, () => 'chief', CHIEF_BOT.id);
    $('#chief-new').onclick = () => { state.chatNew = true; showChat(null); };
    $('#chief-settings').onclick = () => setPanel('toggle');
    // Messenger feel: open the latest conversation unless a new one was asked for.
    if (!state.chatId && !state.chatNew && state.chats.length) state.chatId = state.chats[0].id;
    showChat(state.chatId);
  }
  if (state.chatId) updateChatNeeds($('#chat-thread'), 'chief');
  // Mentions in your messages follow renamed bots, jobs and skills (the bot thread does the same).
  const drawn = $('#chat-thread').dataset.mentions;
  if (state.chatId && drawn && drawn !== mentionSig()) showChat(state.chatId);
  const working = state.bots.filter((b) => b.running).length;
  $('#chief-sub').textContent = `${state.bots.length} bots${working ? ` · ${working} working` : ''}`;
  renderChatList();
}

// The Chief's previous chats, in its settings. Picking one shows it: a panel that covers the chat makes way.
function renderChatList() {
  const el = $('#chief-chats');
  if (!el) return;
  el.innerHTML = state.chats.length
    ? state.chats.map((c) => `
      <button type="button" class="settings-link ${c.id === state.chatId ? 'active' : ''}" data-chat="${esc(c.id)}">
        <span class="grow">${esc(c.title)}</span><span class="faint">${esc(shortTime(c.updatedAt))}</span>
      </button>`).join('')
    : '<div class="faint" style="padding:11px 0;font-size:12.5px">No previous chats</div>';
  $$('[data-chat]', el).forEach((b) => (b.onclick = () => { setView('chief'); showChat(b.dataset.chat); renderChatList(); }));
}

function actionBot(a) {
  const botId = a.botId || state.runs.find((r) => r.id === a.runId)?.botId;
  return state.bots.find((b) => b.id === botId);
}

function actionChip(a) {
  // from: a late result, a short turn of the Chief for what a bot found: "↩ From Web Surfer" opens that bot's chat.
  const icon = { created: '✨', updated: '✏️', run: '→', deleted: '🗑', stopped: '■', skill: '✦', job: '⏰', from: '↩' }[a.kind] || '';
  const screen = a.kind === 'run' && actionBot(a)?.computer === 'linux';
  // waits: what still waits for the owner's OK, in the server's words ("web access waits for your OK").
  const waits = typeof a.waits === 'string' && a.waits.trim() ? ` · <span class="waits">${esc(a.waits.trim())}</span>` : '';
  return `<button class="action-chip" data-kind="${esc(a.kind)}" ${a.botId ? `data-bot="${esc(a.botId)}"` : ''} ${a.runId ? `data-run-id="${esc(a.runId)}"` : ''}>${icon} ${esc(a.text)}${waits}${screen ? ' · View live screen' : ''}</button>`;
}

// What the Chief is doing in a reply it is still writing, in words: its activity as the server says it
// (`{ tool, text }`, in the chat's pending reply and on its stream), '' when it said none. The words are the
// server's, the same as a bot's line for the same step (docs/api.md, "The working line"): the page has none of
// its own for a tool. A server from before it had words for every tool names the tool alone: "Working".
const chiefActivity = (a) => (a ? OpeningLine.text(a.text) || OpeningLine.NO_WORDS : '');
// The Chief's replies that are going on, by chat: what it is doing, '' until it says ("Thinking" on the line).
// The working line of the Chief's chat is drawn from it (placeStatusLines): a replying Chief is that line, with Stop.
const chiefTurns = new Map();
// The owner's messages that wait for the Chief, by chat, as the server lists them (a chat's `queued`).
const chiefQueued = new Map();

// index: the message's place in the whole chat (the server's), where it has one: an unasked message gets 👍 and 👎.
// A reply that failed or was stopped has `error`: alone it is the problem bubble, after text it is a block
// of its own under the text: the server's sentence, which names the runs that were stopped with it. A reply with
// neither has no bubble: the page writes no words of its own. A reply that is still being written (`pending`) has
// none either, only its chips so far: the working line under the chat says what the Chief is doing.
// A reply about a bot's result carries that run's `files` (docs/api.md, A late result): they are drawn in the
// bubble as under a bot's own message, under the text and above the problem, and alone when the reply has no words.
function chiefBubble(m, last = false, index = null) {
  const files = !m.pending && Array.isArray(m.files) && m.files.length ? botFilesHTML(m.files) : '';
  const body = m.pending
    ? ''
    : m.error && !m.text
      ? `<div class="md">${md(m.error)}</div>${files}`
      : m.text
        ? `<div class="md">${md(m.text)}</div>${files}${m.error ? `<div class="problem-line"><div class="md">${md(m.error)}</div></div>` : ''}`
        : files;
  return `
    <div class="bubble-row from-bot"${m.pending ? ' data-pending' : ''}>
      <div class="stack">
        ${body ? `<div class="bubble from-bot ${m.error && !m.text ? 'problem' : ''}">${body}</div>` : ''}
        <div class="actions">${(m.actions || []).map(actionChip).join('')}</div>
        ${!m.pending && (m.text || m.error) ? `<div class="bubble-meta">${esc(msgTime(m.endedAt || m.at))}${copyBtn(m.text || m.error)}${Ratings.shows(m, state.features, index) ? Ratings.html(m.rating, index, CHIEF_COLOR) : ''}</div>` : ''}
        ${last && !m.pending ? choicesHTML(m.choices) + questionsHTML(m.questions) : ''}
      </div>
    </div>`;
}

// What Approve sends to answer a bot's plan for the Chief (the server knows it).
const PLAN_APPROVAL = 'Approved. Go ahead.';
// A bot's suggestion for the Chief: nothing happens until you answer it.
const suggestionBubble = (m) => `
  <div class="bubble-row from-me"><div class="stack from-bot-msg">
    <div class="bot-msg-label">Suggestion from ${m.from ? botLabel(m.from) : 'a bot'}</div>
    <div class="bubble from-other-bot suggestion-msg" data-expand><div class="md clamp">${md(m.text)}</div></div>
    <div class="bubble-meta">${copyBtn(m.text)}</div>
    ${m.status === 'pending' ? `<div class="suggestion-actions"><button class="btn" data-sug-dismiss>Decline</button><button class="btn primary" data-sug-build>Approve</button></div>` : m.status === 'dismissed' ? '<div class="bot-msg-label">You declined it</div>' : ''}
  </div></div>`;

// A bot the Chief handed a task, with its final reply once the teammates it asked had answered.
const reportBubble = (m) => `
  <div class="bubble-row from-me"><div class="stack from-bot-msg">
    <div class="bot-msg-label">Message from ${m.from ? botLabel(m.from) : 'a bot'}</div>
    ${m.text ? `<div class="bubble from-other-bot report-msg"><div class="md">${md(m.text)}</div>${botFilesHTML(m.files)}</div>
    <div class="bubble-meta">${copyBtn(m.text)}</div>` : `<div class="bubble from-other-bot report-msg">${botFilesHTML(m.files)}</div>`}
  </div></div>`;

// at: the message's place in the whole chat (the chat may have come in part, from `offset` on).
const messageHTML = (m, i, all, at = i) => (m.role === 'user' ? userBubble(m) : m.role === 'suggestion' ? suggestionBubble(m) : m.role === 'report' ? reportBubble(m) : chiefBubble(m, i === all.length - 1, at));

const userBubble = (m) => `<div class="bubble-row from-me"><div class="stack mine"><div class="bubble from-me">${escMentions(m.text, CHIEF_BOT.id)}${filesHTML(m.attachments)}</div>${m.text ? `<div class="bubble-meta">${copyBtn(m.text)}</div>` : ''}</div></div>`;

function wireActions(root) {
  $$('.action-chip', root).forEach((b) => {
    b.onclick = async () => {
      if (b.dataset.kind === 'skill') return setView('skills');
      const a = { botId: b.dataset.bot, runId: b.dataset.runId };
      let bot = actionBot(a);
      try {
        // Older chats only stored a run ID, which may be outside the recent-run list.
        if (!bot && a.runId) {
          const run = await api(`/runs/${encodeURIComponent(a.runId)}`);
          bot = state.bots.find((x) => x.id === run.botId);
        }
        if (bot) {
          setView('bot', bot.id);
          if (b.dataset.kind === 'run' && bot.computer === 'linux') openScreen(bot.id);
        } else if (a.runId) openRun(a.runId);
      } catch (e) { toast(e.message, true); }
    };
  });
}

// Open the Chief on this chat (null: a new one), whether or not its page is built yet.
function openChiefChat(id) {
  const built = !!$('#chat-thread');
  state.chatId = id;
  state.chatNew = !id;
  setView('chief');
  if (built) showChat(id);
}

async function showChat(id) {
  if (state.chatStream) { state.chatStream.close(); state.chatStream = null; }
  state.chatReload = false; // this is the chat read again
  state.chatId = id;
  if (id) state.chatNew = false;
  if (state.view === 'chief') writeHash();
  sayPresent();
  syncRead();
  const thread = $('#chat-thread');
  const form = $('#view-chief form');
  if (!thread) return;
  if (!id) {
    delete thread.dataset.mentions;
    delete thread.dataset.chat;
    thread.innerHTML = `
      <div class="chief-empty">
        ${chiefFigure('lg')}
        <h3>What should the team work on?</h3>
        <p class="muted">Ask for anything. I'll hand it to the right bot, or build a new one.</p>
        <div class="suggestions">${CHIEF_SUGGESTIONS.map((t) => `<button class="suggestion">${esc(t)}</button>`).join('')}</div>
      </div>`;
    $$('.suggestion', thread).forEach((b) => (b.onclick = withKey((key) => sendFrom(form, () => sendToChief(b.textContent, [], key)))));
    setSendBusy(form, false);
    placeStatusLines(); // a line of the chat that was here goes
    if (!matchMedia('(pointer: coarse)').matches) form.text.focus();
    return;
  }
  let chat;
  try { chat = await api(`/chief/chats/${id}`); } catch (e) { toast(e.message, true); return; }
  if (state.chatId !== id) return;
  thread.innerHTML = chat.messages.map((m, i, all) => messageHTML(m, i, all, (chat.offset || 0) + i).replace('class="bubble-row', `data-msg="${i}" class="bubble-row`)).join('');
  thread.dataset.mentions = mentionSig(); // what its mentions were matched against (see renderChief)
  thread.dataset.chat = id; // whose messages these are (see placeChiefLine)
  thread._mine = chat.messages.filter((m) => m.role === 'user'); // what the owner wrote in it, as botdot has it (see ownWords)
  thread._from = chat.offset || 0; // the place of its first row in the whole chat (see chiefArrives)
  wireActions(thread);
  wireChoices(thread, (t, key) => sendFrom(form, () => sendToChief(t, [], key)));
  $$('[data-expand]', thread).forEach((el) => (el.onclick = (e) => { if (!e.target.closest('a')) el.firstElementChild.classList.toggle('clamp'); }));
  const build = $('[data-sug-build]', thread);
  if (build) build.onclick = withKey(async (key) => { if (await sendFrom(form, () => sendToChief(PLAN_APPROVAL, [], key))) build.closest('.suggestion-actions')?.remove(); });
  const dismiss = $('[data-sug-dismiss]', thread);
  if (dismiss) dismiss.onclick = () => api(`/chief/chats/${id}/dismiss`, { method: 'POST' }).then(() => showChat(id)).catch((e) => toast(e.message, true));
  if (chat.busy) openingLines.say(`chief:${id}`, chat.openingLine); else openingLines.end(`chief:${id}`);
  // Its reply that is going on, and what waits for it: both as the server has them now.
  if (chat.busy) chiefTurns.set(id, chiefActivity(chat.messages.filter((m) => m.pending).pop()?.activity)); else chiefTurns.delete(id);
  chiefQueued.set(id, queuedList(chat.queued));
  placeStatusLines();
  updateChatNeeds(thread, 'chief');
  thread.scrollTop = thread.scrollHeight;
  placeChiefLine(); // the "New" line, when this chat was opened with new replies
  markSearch(); // what you searched for, marked in the chat
  if (state.jump?.chatId === id) jumpTo($(`[data-msg="${state.jump.index}"]`, thread)); // from a search match
  setSendBusy(form, chat.busy, stopChief);
  if (chat.busy) followChief(id);
}

// Stop the Chief's reply in a chat: the open one, from the box of a server that has no Send while it replies.
const stopChief = (id = state.chatId) => api(`/chief/chats/${encodeURIComponent(typeof id === 'string' ? id : state.chatId)}/stop`, { method: 'POST' }).catch(() => {});

// Rejects when the message did not go, with nothing added to the chat: the caller keeps what was typed or
// tapped and says why (wireComposer, sendFrom). key: the message's (messageKey), the same when it is sent again.
// From Send until botdot answers the message stands in the chat as the page's own bubble (sentAtOnce), with
// "Working" under it; the answer puts botdot's version in its place, and a send that failed takes it away.
async function sendToChief(text, attachments = [], key = messageKey()) {
  let id = state.chatId;
  const fresh = !id;
  let at = `chief:${id || ''}`; // the chat the bubble stands in: the new one has no id until it is made
  sentAtOnce(at, { key, text, attachments });
  showSent($('#chat-thread'));
  let took;
  try {
    if (fresh) {
      // No message was sent yet: whatever failed here, it was not sent.
      const chat = await api('/chief/chats', { method: 'POST' }).catch((e) => { throw Object.assign(e, { unsure: false }); });
      id = chat.id;
      state.chatId = id; // kept when the message then fails: sending again uses this chat
      state.chatNew = false;
      sentMoved(at, at = `chief:${id}`);
    }
    took = await api(`/chief/chats/${id}/messages`, { method: 'POST', body: { text, attachments, key } });
  } catch (e) {
    sentOver(at, key, false); // it did not go: nothing of it stays in the chat
    placeStatusLines();
    throw e;
  }
  // The message went. Nothing from here on may reject: the caller would put a sent message back into the box.
  try {
    // botdot had it already, from a send whose answer was lost: the chat as botdot has it, with the message once.
    if (took?.again) { await showChat(id); loadChief().then(markMore); return; }
    // The Chief is replying: the message waits its turn on the botdot server (the chat's `queued`). It is drawn
    // from that list, faded, and the page adds no bubble of its own. The reply that is going on is followed
    // already; a second stream is opened only when this page follows none.
    const queued = queuedList(took?.queued);
    if (queued.length) {
      if (state.chatId !== id) return;
      if (!state.chatStream || $('#chat-thread').dataset.chat !== id) { await showChat(id); return; }
      chiefQueued.set(id, queued);
      placeStatusLines();
      const t = $('#chat-thread');
      t.scrollTop = t.scrollHeight;
      return;
    }
    const thread = $('#chat-thread');
    // The page still follows a reply here, and botdot took this message at once: that reply ended a moment ago,
    // and its end has not reached the page. The chat as botdot has it shows both, and follows the new reply.
    if (state.chatStream && thread.dataset.chat === id) { await showChat(id); loadChief().then(markMore); return; }
    if (fresh || !thread.dataset.chat) {
      thread.innerHTML = ''; // the empty chat's greeting is gone, now that the message went
      thread.dataset.chat = id;
      thread._mine = [];
      thread._from = 0;
      syncRead(); // the new chat is on screen: its reply is read as it arrives
    }
    $$('.choices, .ask-card', thread).forEach((c) => c.remove()); // answered
    sentOver(at, key); // the message as botdot took it stands where the page's own stood
    thread.insertAdjacentHTML('beforeend', userBubble({ text: text || 'Have a look at the attached files.', attachments }) + chiefBubble({ pending: true }));
    (thread._mine ||= []).push({ text, attachments });
    updateChatNeeds(thread, 'chief'); // the cards stay last
    chiefTurns.set(id, ''); // its reply began: the working line says so, with Stop
    placeStatusLines();
    thread.scrollTop = thread.scrollHeight;
    setSendBusy($('#view-chief form'), true, stopChief);
    writeHash(); // state.chatId is this chat
    followChief(id);
    loadChief().then(markMore);
  } catch (e) { console.error(e); } finally {
    // Whichever way the chat was drawn from the answer: the page's own bubble is over.
    sentOver(at, key);
    placeStatusLines();
  }
}

// The Chief's reply in a chat as it happens: what it is doing goes to the working line, a chip under the reply's
// row, and the reply in that row's place when it is done. One stream at a time: the one before is closed.
function followChief(id) {
  const thread = $('#chat-thread');
  const rows = $$('[data-pending]', thread);
  const row = rows[rows.length - 1]; // the reply being written; none when this page did not draw it
  if (state.chatStream) state.chatStream.close();
  const es = new EventSource(`/api/chief/chats/${id}/stream`);
  state.chatStream = es;
  es.onmessage = (msg) => {
    if (state.chatId !== id) return es.close();
    const ev = JSON.parse(msg.data);
    if (ev.type === 'activity') {
      if (chiefTurns.get(id) !== chiefActivity(ev)) { chiefTurns.set(id, chiefActivity(ev)); placeStatusLines(); }
    } else if (ev.type === 'opening_line') {
      if (openingLines.say(`chief:${id}`, ev.text)) placeStatusLines();
    } else if (ev.type === 'action') {
      row?.querySelector('.actions')?.insertAdjacentHTML('beforeend', actionChip(ev.action));
      wireActions(row);
      refresh();
    } else if (ev.type === 'file') {
      row?.insertAdjacentHTML('beforebegin', reportBubble(ev.message)); // a bot's file, while the Chief still waits for it
      placeStatusLines(); // it arrives (chiefArrives)
    } else if (ev.type === 'done') {
      es.close();
      if (state.chatStream === es) state.chatStream = null;
      openingLines.end(`chief:${id}`);
      chiefTurns.delete(id);
      placeStatusLines(); // the reply is here, or it couldn't finish: the line goes
      // A bot's reply that came in meanwhile, or the next turn that began (see followFeed): show the whole chat again.
      if (state.chatReload) { state.chatReload = false; return showChat(id); }
      if (ev.message) {
        // In the place of the row this page drew for it; a reply it drew none for goes to the end.
        if (row && row.isConnected !== false) { row.outerHTML = chiefBubble(ev.message, true); placeStatusLines(); } // the reply arrives (chiefArrives)
        else { thread.insertAdjacentHTML('beforeend', chiefBubble(ev.message, true)); updateChatNeeds(thread, 'chief'); placeStatusLines(); }
        wireActions(thread);
        wireChoices(thread, (t, key) => sendFrom($('#view-chief form'), () => sendToChief(t, [], key)));
      }
      thread.scrollTop = thread.scrollHeight;
      setSendBusy($('#view-chief form'), false);
      refresh();
    }
    if (thread.scrollHeight - thread.scrollTop - thread.clientHeight < 160) thread.scrollTop = thread.scrollHeight;
  };
  // EventSource reconnects after transport errors; the server replays current activity.
  es.onerror = () => { if (state.chatId !== id) es.close(); };
}

// ---------- a bot's conversation ----------
// Each run is one exchange: the task you gave it, then its reply.

// newFirst: the run the "New" line goes above (the server's firstUnread when the chat was opened), or null.
function botThreadHTML(bot, runs, newFirst = null) {
  if (!runs.length) {
    return `
      <div class="chat-empty">
        ${botFigure(bot.color, bot.state, 'lg', bot.outfit)}
        <h3>${esc(bot.name)}</h3>
        <p class="muted">${esc(bot.description || '')}</p>
      </div>`;
  }
  let lastDay = '';
  return runs.map((r, i) => {
    const day = new Date(r.startedAt).toDateString();
    const sep = day !== lastDay ? `<div class="day">${esc(new Date(r.startedAt).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }))}</div>` : '';
    lastDay = day;
    const line = newFirst !== null && r.id === newFirst ? Unread.line(bot.color) : '';
    if (r.kind === 'script') return sep + line + scriptRunHTML(r);
    // Messages other bots left for it, read at the start of this run.
    const notes = notesFoldHTML(r.inbox, r.inbox?.length === 1 ? 'Read a note from' : 'Read notes from');
    let mine = false; // your own message started it: that isn't new, so the "New" line goes below it
    const asked = notes + (r.trigger === 'replies' ? '' // the answers it waited for: the notes above are what started it
      : sender(r) // a message from another bot or the Chief: one folded line that opens to what it said
      ? `<div class="bubble-row from-me"><details class="notes-fold" ${state.keepOpen === r.id ? 'open' : ''}><summary>Message from ${botLabel(sender(r))}</summary><div class="note"><div class="bubble from-other-bot">${esc(r.prompt)}${filesHTML(r.attachments)}</div><div class="bubble-meta">${copyBtn(r.prompt)}</div></div></details></div>`
      : r.jobName
      ? `<div class="bubble-row from-me"><span class="chip">${r.jobId === 'memory-review' ? '🧹' : '⏰'} ${esc(r.jobName)}${r.trigger === 'call' ? ', called' : ''}${r.parentRunId ? ' · its script found something' : ''} · ${esc(msgTime(r.startedAt))}</span></div>`
      : r.trigger === 'schedule'
      ? `<div class="bubble-row from-me"><span class="chip">⏰ Scheduled run · ${esc(msgTime(r.startedAt))}</span></div>`
      : r.trigger === 'hello' ? '' // a new bot's first message (#511): you asked nothing
      : r.continues ? '' // it carries on after your OK: the request stands once, above the reply of the run that stopped (docs/api.md, "What follows a yes")
      : r.customPrompt === false
        ? `<div class="bubble-row from-me"><span class="chip">${ICON.play} Ran its main assignment</span></div>`
        : (mine = true, `<div class="bubble-row from-me"><div class="stack mine"><div class="bubble from-me" data-expand><div class="clamp">${escMentions(r.prompt, r.botId)}</div>${filesHTML(r.attachments)}</div><div class="bubble-meta">${copyBtn(r.prompt)}</div></div></div>`));
    let reply;
    if (r.status === 'running') {
      // No bubble while it works: the status line under the chat says it (placeStatusLines). Only what it attached so far.
      reply = `<div class="bubble-row from-bot" data-live="${esc(r.id)}">${botFilesHTML(r.files)}</div>`;
    } else {
      const failed = ['error', 'stopped', 'interrupted'].includes(r.status);
      const body = failed ? r.problem || friendlyProblem(r, r.result) : r.result || 'Done. (No written reply.)';
      const meta = [msgTime(r.endedAt || r.startedAt), r.durationMs != null ? dur(r.durationMs) : null].filter(Boolean);
      // Keep the final answer visible. Only the raw messages sent to teammates fold away.
      const outgoing = sentTo(r).filter((t) => t.text);
      const exchange = sender(r) && !failed
        ? outgoing.length
          ? `<details class="notes-fold theirs" ${state.keepOpen === r.id ? 'open' : ''}><summary>${exchangeLabel(r)}</summary>
              ${outgoing.map((t) => `<div class="note"><div class="bot-msg-label">To ${botLabel(t)}</div><div class="bubble from-bot"><div class="md">${md(t.text)}</div></div></div>`).join('')}
            </details>`
          : `<div class="bot-msg-label">${exchangeLabel(r)}</div>`
        : messagedLabel(r);
      reply = `
        <div class="bubble-row from-bot"><div class="stack">
          ${exchange}
          <div class="bubble from-bot ${failed ? 'problem' : ''}"><div class="md">${md(body)}</div>${botFilesHTML(r.files)}</div>
          ${learnedChips(r)}
          <div class="bubble-meta">${meta.map(esc).join(' · ')} · <button data-details="${esc(r.id)}">Details</button>${copyBtn(body)}</div>
          ${i === runs.length - 1 && !failed ? choicesHTML(r.choices) + questionsHTML(r.questions) : ''}
        </div></div>`;
    }
    return sep + Unread.exchange({ asked, reply, mine }, line);
  }).join('');
}

// The notes other bots left for a bot, waiting for its next run (shown at the bottom of its chat).
function loadInbox(botId) {
  api(`/bots/${encodeURIComponent(botId)}/inbox`).then((notes) => {
    const before = JSON.stringify(state.inbox[botId] || []);
    state.inbox[botId] = notes;
    if (before !== JSON.stringify(notes) && state.view === 'bot' && state.botId === botId) renderBotChat();
  }).catch(() => {});
}

// The open chat's runs from further back than the page holds (state.runs is the newest 200 of all bots):
// read when its "New" line is above them, and kept while that line stays.
let reached = null; // { botId, first, runs }
function chatRuns(botId, first) {
  const held = state.runs.filter((r) => r.botId === botId);
  if (first === null) reached = null;
  if (!reached || reached.botId !== botId || reached.first !== first) return held;
  const known = new Set(held.map((r) => r.id));
  return held.concat(reached.runs.filter((r) => !r.quiet && !known.has(r.id)))
    .sort((a, b) => String(b.startedAt).localeCompare(String(a.startedAt)) || b.id.localeCompare(a.id));
}
function reachNew(botId, first) {
  if (reached && reached.botId === botId && reached.first === first) return; // being read, or it isn't there
  const mine = reached = { botId, first, runs: [] };
  const page = (before) => api(`/runs?botId=${encodeURIComponent(botId)}&limit=200${before ? `&before=${encodeURIComponent(before)}` : ''}`);
  Unread.reach(first, page).then((runs) => {
    if (reached !== mine || !runs) return; // not reached: the chat stays as it is, without a line
    mine.runs = runs;
    if (state.view === 'bot' && state.botId === botId) renderBotChat();
  }).catch(() => { if (reached === mine) reached = null; }); // the server couldn't be asked: the next draw asks again
}

function renderBotChat() {
  const bot = state.bots.find((b) => b.id === state.botId);
  const root = $('#view-bot');
  if (!bot) { if (state.bots.length) leaveBot(); return; }
  const newFirst = newLine.first(`bot:${bot.id}`); // the "New" line stays where it was put while the chat is open
  // Its newest runs, and with a line every run back to it: one further back is read first, and drawn then.
  const drawn = Unread.shown(chatRuns(bot.id, newFirst), newFirst);
  if (drawn.missing) reachNew(bot.id, newFirst);
  const runs = drawn.runs.reverse();
  if (root.dataset.bot !== bot.id) {
    root.dataset.bot = bot.id;
    delete root.dataset.sig; // not '': a bot with no runs yet has that signature too, and would never show its intro
    root.innerHTML = `
      <div class="chat-head">
        ${BACK_BTN}
        <button class="chat-title" id="bot-settings" title="Settings">
          <div id="bot-avatar"></div>
          <div class="grow"><h2 id="bot-name"></h2><div class="sub" id="bot-sub"></div></div>
        </button>
        <button type="button" class="icon-btn sm hidden" id="bot-add-to-chat" title="Add a bot to this chat" aria-label="Add a bot to this chat">＋</button>
        <div class="actions-right">
          <button class="icon-btn hidden" id="bot-screen" title="Its computer">${ICON.screen}</button>
        </div>
      </div>
      <div class="chat-thread" id="bot-thread"></div>
      <div class="pip hidden" id="bot-pip"></div>
      ${composerHTML(`Give ${bot.name} a task…`)}`;
    const form = $('form', root);
    wireComposer(form, (text, files, key) => runBot(bot.id, text, files, key), () => `bot:${bot.id}`, bot.id);
    $('#bot-settings').onclick = () => setPanel('toggle');
    // A group grown from this chat (groups.js): this bot and those picked. Its own chat stays as it is.
    $('#bot-add-to-chat').onclick = () => { const b = state.bots.find((x) => x.id === state.botId); if (b && canMakeGroup(b)) openGroupMaker(b); };
    $('#bot-screen').onclick = () => openScreen(state.botId);
    loadInbox(bot.id);
  }
  const av = $('#bot-avatar');
  const look = bot.color + bot.state + JSON.stringify(bot.outfit || '');
  if (av.dataset.sig !== look) { av.dataset.sig = look; av.innerHTML = botFigure(bot.color, bot.state, 'sm', bot.outfit); }
  $('#bot-name').textContent = bot.name;
  // Only what's happening now; its skills, jobs and computer are in its settings, behind its figure and name.
  $('#bot-sub').textContent = bot.running ? 'working…' : '';
  $('#bot-screen').classList.toggle('hidden', bot.computer !== 'linux');
  // The small plus right of the name (the owner at the test of Milestone 10): only where a group can be made.
  $('#bot-add-to-chat').classList.toggle('hidden', !canMakeGroup(bot));

  // Re-render the thread only when something changed, so live bits and scroll survive refreshes.
  const waiting = state.inbox[bot.id] || [];
  const sig = runs.map((r) => `${r.id}:${r.status}`).join('|') + `|notes:${waiting.map((n) => n.at).join(',')}|${mentionSig()}|new:${newFirst ?? ''}`;
  const thread = $('#bot-thread');
  if (root.dataset.sig !== sig) {
    const atBottom = !root.dataset.sig || thread.scrollHeight - thread.scrollTop - thread.clientHeight < 120;
    root.dataset.sig = sig;
    thread.innerHTML = botThreadHTML(bot, runs, newFirst) + notesFoldHTML(waiting, 'Notes waiting:');
    if (atBottom) thread.scrollTop = thread.scrollHeight;
    scrollToNew(thread);
    $$('[data-expand]', thread).forEach((el) => (el.onclick = (e) => { if (!e.target.closest('a')) el.firstElementChild.classList.toggle('clamp'); }));
    $$('[data-details]', thread).forEach((el) => (el.onclick = () => openRun(el.dataset.details)));
    wireChoices(thread, (t, key) => sendFrom($('form', root), () => runBot(bot.id, t, [], key)));
    $$('[data-screen-open]', thread).forEach((el) => (el.onclick = () => openScreen(el.dataset.screenOpen)));
    // What it learned: a job opens its jobs, a change to its task, rules or skills its settings. A note opens nothing.
    $$('[data-learned]', thread).forEach((el) => (el.onclick = () => { const view = learnedOpens(el.dataset.learned); if (view) setView(view, state.botId); }));
    followBotRun(runs.find((r) => r.status === 'running'));
    markSearch(); // what you searched for, marked in the chat
    // From a search match: that run (older runs than the chat shows open on their own).
    if (state.jump?.runId && state.jump.bot?.id === bot.id) {
      const id = state.jump.runId;
      const row = $(`[data-details="${CSS.escape(id)}"]`, thread)?.closest('.bubble-row');
      // Between bots it's folded: open it (and the message that started it) so the match shows, and keep it open.
      state.keepOpen = id;
      [row, row?.previousElementSibling].forEach((el) => el && $$('details.notes-fold', el).forEach((d) => { d.open = true; }));
      if (!jumpTo(row)) openRun(id);
    }
  }
  // A reply that is new in the open chat arrives (a reply arrives): the reply side of its run's row, with its
  // quick answers. What started the run stands still.
  for (const id of repliesArrive(arrivals.bot, thread, `bot:${bot.id}`, botReplyIds(runs))) arrive($(`[data-details="${CSS.escape(id)}"]`, thread)?.closest('.bubble-row'));
  // The large head of an empty chat follows the bot's state, colour and hat, like the one in the header.
  const big = $('.chat-empty .avatar', thread);
  if (big && thread.dataset.look !== look) big.outerHTML = botFigure(bot.color, bot.state, 'lg', bot.outfit);
  thread.dataset.look = look;
  updateChatNeeds($('#bot-thread'), bot.id);
  updatePip(bot, runs.find((r) => r.status === 'running' && r.computer));
  setSendBusy($('form', root), false);
  placeStatusLines();
}

// Rejects when the task did not go, with nothing added to the chat (wireComposer, sendFrom). key: as sendToChief's.
// From Send until botdot answers the task stands in the chat as the page's own bubble (sentAtOnce), with "Working"
// under it. The answer is drawn at once, from the answer itself (tookRun): the lists are read again after it, not
// before. A task botdot had already (again) answers the run it has, which the chat holds once.
// To a working bot the answer is a run that waits (`status: "queued"`): it is no run yet, so nothing is followed
// or opened for its id. It is drawn among the bot's `queued`, as every waiting message is.
async function runBot(botId, text, attachments = [], key = messageKey()) {
  const at = `bot:${botId}`;
  sentAtOnce(at, { key, text, attachments });
  showSent($('#bot-thread'));
  let took;
  try {
    took = await api(`/bots/${botId}/run`, { method: 'POST', body: { prompt: text || undefined, attachments, key } });
  } catch (e) {
    sentOver(at, key, false); // it did not go: nothing of it stays in the chat
    placeStatusLines();
    throw e;
  }
  // The task went. Nothing from here on may reject: the caller would put a sent message back into the box.
  try {
    sentOver(at, key);
    tookRun(botId, took, text, attachments);
    if (state.view === 'bot' && state.botId === botId) renderBotChat(); else placeStatusLines();
    const thread = $('#bot-thread');
    if (thread) thread.scrollTop = thread.scrollHeight;
  } catch (e) { console.error(e); }
  refresh(); // the bots, the list and the rest follow: never rejects, and nothing waits for it
}
// botdot's answer to a task, into what the page holds: the run it started, on top of the runs, or the message
// among those that wait for the bot, last. One the page holds already stays as it is: the feed brought it, maybe
// further on than this answer, or the same task was sent again and botdot took it once.
function tookRun(botId, run, text, attachments) {
  if (!run || typeof run.id !== 'string' || !run.id || state.runs.some((r) => r.id === run.id)) return;
  if (run.status !== 'queued') { state.runs = [run, ...state.runs]; return; }
  const at = `bot:${botId}`;
  if (queuedIn(at).some((q) => q.id === run.id)) return;
  setQueued(at, [...queuedIn(at), { id: run.id, text: String(text || '').trim(), attachments: Array.isArray(run.attachments) ? run.attachments : attachments, at: run.queuedAt }]);
}

// A bot's running run as it happens: a file it attaches shows at once, its line goes to the status line as the
// server says it (its steps are not put in words here), then refresh when it ends.
function followBotRun(run) {
  if (state.botStream) { state.botStream.close(); state.botStream = null; }
  if (!run) return;
  const es = watchRun(run.id, () => { state.botStream = null; refresh(); }, (file) => {
    const live = $(`[data-live="${CSS.escape(run.id)}"]`);
    if (!live || $(`a[href="${CSS.escape(fileHref(file))}"]`, live)) return; // shown already (the stream replays)
    const list = $('.bubble-files', live);
    const html = botFilesHTML([file]);
    if (list) list.insertAdjacentHTML('beforeend', html.replace(/^<div class="bubble-files">|<\/div>$/g, ''));
    else live.insertAdjacentHTML('beforeend', html);
    const t = $('#bot-thread');
    if (t && t.scrollHeight - t.scrollTop - t.clientHeight < 200) t.scrollTop = t.scrollHeight;
  }, (line) => { if (openingLines.say(`bot:${run.botId}`, line, run.id)) { renderContacts(); placeStatusLines(); } });
  state.botStream = es;
}

// Follow a running run (the stream replays what already happened first). onEnd() when the run finishes;
// onFile(file) for a file it attached; onLine(text) with its line, each time the server says one: its working
// line, or its opening line from a server without the working line. Its steps are not read: the words for what
// a run is doing are the server's.
function watchRun(runId, onEnd, onFile, onLine) {
  const es = new EventSource(`/api/runs/${runId}/stream`);
  es.onmessage = (msg) => {
    const ev = JSON.parse(msg.data);
    if (ev.type === 'file') onFile?.(ev.file); // a file it attached: shown at once
    if (OpeningLine.says(ev.type, state.features)) onLine?.(ev.text);
    if (ev.type === 'run_end') { es.close(); onEnd?.(); }
  };
  es.onerror = () => es.close();
  return es;
}

// ---------- live screen preview (top right of a bot's chat, while it uses its computer) ----------

const pip = { runId: null, control: false, large: false };
const pipHidden = () => { try { return localStorage.getItem('botdot.pip.hidden') === '1'; } catch { return false; } };
const setPipHidden = (v) => { try { v ? localStorage.setItem('botdot.pip.hidden', '1') : localStorage.removeItem('botdot.pip.hidden'); } catch { /* private mode */ } };

function updatePip(bot, run) {
  const el = $('#bot-pip');
  if (!el) return;
  if (!run) { el.classList.add('hidden'); el.innerHTML = ''; pip.runId = null; pip.control = false; return; }
  const ready = state.computers?.[bot.id] === 'running';
  const key = `${run.id}:${pip.control}:${pipHidden()}:${pip.large}:${ready}`;
  if (el.dataset.key === key) return; // keep the stream running across refreshes
  el.dataset.key = key;
  pip.runId = run.id;
  el.classList.remove('hidden');
  el.classList.toggle('large', pip.large && !pipHidden());
  el.classList.toggle('in-control', pip.control);
  if (pipHidden()) {
    el.classList.add('collapsed');
    el.innerHTML = `<button class="pip-show" data-pip="show" title="Show ${esc(bot.name)}'s screen">${ICON.screen} Screen <span class="pill accent pulse">live</span></button>`;
  } else {
    el.classList.remove('collapsed');
    el.innerHTML = `
      <div class="pip-bar">
        <span class="pill ${pip.control ? 'warn' : 'accent pulse'}">${pip.control ? 'you control it' : 'live'}</span>
        <span class="grow pip-title">${esc(bot.name)}'s screen</span>
        <button class="icon-btn sm" data-pip="control" title="${pip.control ? 'Give control back (just watch)' : 'Take control: use its mouse and keyboard'}">${pip.control ? '👁' : '🖱'}</button>
        <button class="icon-btn sm" data-pip="size" title="${pip.large ? 'Make it smaller' : 'Make it bigger'}">${pip.large ? '⤡' : '⤢'}</button>
        <button class="icon-btn sm" data-pip="open" title="Open in a window, with full screen">⧉</button>
        <button class="icon-btn sm" data-pip="hide" title="Hide">✕</button>
      </div>
      ${ready ? `<iframe src="${screenUrl(bot.id, pip.control)}" title="${esc(bot.name)}'s screen"></iframe>` : '<div class="pip-wait">🖥 Starting its computer…</div>'}`;
    keepScreenConnected($('iframe', el));
  }
  $$('[data-pip]', el).forEach((b) => (b.onclick = () => {
    const a = b.dataset.pip;
    if (a === 'show') setPipHidden(false);
    if (a === 'hide') setPipHidden(true);
    if (a === 'size') pip.large = !pip.large;
    if (a === 'control') pip.control = !pip.control; // no question: the same button gives control back
    if (a === 'open') return openScreen(bot.id);
    updatePip(bot, run);
  }));
}

// ---------- skills ----------

const SOURCE_LABEL = { created: 'Written here', github: 'From GitHub' };

// Where a library skill came from: imported, or written by you, the Chief or a bot (while learning).
function skillOrigin(k) {
  if (k.source !== 'created') return SOURCE_LABEL[k.source] || k.source;
  if (k.createdBy === 'chief') return 'Written by the Chief';
  if (String(k.createdBy).startsWith('bot:')) {
    const b = state.bots.find((x) => x.id === k.createdBy.slice(4));
    return b ? `Written by ${b.name}` : 'Written by a bot';
  }
  return 'Written here';
}

async function renderSkills() {
  const root = $('#view-skills');
  let data = { library: [], machine: [] };
  try { data = await api('/skills'); } catch (e) { toast(e.message, true); }
  if (state.view !== 'skills') return;
  const botChip = (id) => { const b = state.bots.find((x) => x.id === id); return b ? `<span class="chip" title="${esc(b.name)}">${botLabel(b)}</span>` : ''; };
  root.innerHTML = `
    ${SUB_BACK}
    <div class="section-head">
      <div><h1>Skills</h1></div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <button class="btn" id="import-skill">Import</button>
        <button class="btn primary" id="new-skill">＋ New skill</button>
      </div>
    </div>
    <h3 class="page-sub">Your library <span class="faint">· give each skill to the bots that need it</span></h3>
    ${data.library.length ? `<div class="grid">${data.library.map((k) => `
      <article class="card skill-card" data-skill="${esc(k.name)}">
        <div class="skill-top"><span class="skill-name">${esc(k.name)}</span><span class="pill">${esc(skillOrigin(k))}</span></div>
        <p class="skill-desc">${esc(k.description)}</p>
        ${k.scripts.length ? `<div class="skill-warn">Includes ${k.scripts.length} script${k.scripts.length === 1 ? '' : 's'} a bot may run</div>` : ''}
        ${k.allowedTools.length ? `<div class="skill-warn">Can use without asking: ${esc(k.allowedTools.join(', '))}</div>` : ''}
        <div class="chips">${k.usedBy.map(botChip).join('') || '<span class="faint" style="font-size:12.5px">No bot has it yet</span>'}</div>
      </article>`).join('')}</div>`
      : `<div class="card empty" style="padding:36px 20px"><div class="big">✦</div>No skills yet. Write one, import one from skills.sh or GitHub, or ask the Chief ("make a skill for how I like my weekly reports"). Bots also write their own as they learn.</div>`}
    <h3 class="page-sub">On this computer</h3>
    <div class="card machine-skills">${data.machine.length ? data.machine.map((k) => `
      <div class="machine-skill"><span class="skill-name">${esc(k.name)}</span><span class="muted">${esc(k.description.slice(0, 160))}${k.description.length > 160 ? '…' : ''}</span><span class="faint">${esc(k.origin)}</span></div>`).join('')
      : '<div class="faint" style="padding:14px 16px">None found in ~/.claude/skills.</div>'}</div>
    ${data.builtin?.length ? `<h3 class="page-sub">Built into Claude Code</h3>
    <div class="card builtin-skills">${data.builtin.map((k) => `<span class="chip mono">${esc(k.name)}</span>`).join('')}</div>` : ''}`;
  $('#new-skill').onclick = () => openSkillEditor();
  $('#import-skill').onclick = () => openSkillImport();
  $$('[data-skill]', root).forEach((el) => (el.onclick = async () => {
    try { openSkillEditor(await api(`/skills/${encodeURIComponent(el.dataset.skill)}`)); } catch (e) { toast(e.message, true); }
  }));
}

function botCheckboxes(selected = []) {
  return `<div class="tool-toggles">${state.bots.map((b) => `<label><input type="checkbox" name="bot" value="${esc(b.id)}" ${selected.includes(b.id) ? 'checked' : ''}${b.useSkills === false ? ' disabled title="Skills are turned off for this bot"' : ''}>${botLabel(b)}</label>`).join('')}</div>`;
}

// opts.forBot: pre-tick this bot. opts.onDone(name|null): called when the dialog closes (used by a bot's settings).
function openSkillEditor(skill, opts = {}) {
  const isNew = !skill;
  const k = skill || { name: '', description: '', instructions: '', usedBy: opts.forBot ? [opts.forBot] : [], source: 'created', scripts: [], allowedTools: [], fileCount: 0 };
  const m = openModal(`
    <form id="skill-form" autocomplete="off">
      <div class="modal-head"><h2>${isNew ? 'New skill' : esc(k.name)}</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
      <div class="modal-body">
        <div class="row">
          <label class="field">Name <span class="hint">lowercase-with-dashes</span><input type="text" name="name" value="${esc(k.name)}" placeholder="weekly-report" required pattern="[a-z0-9][a-z0-9-]*"></label>
          <label class="field">When to use it <span class="hint">bots decide from this</span><input type="text" name="description" value="${esc(k.description)}" placeholder="Use when writing the weekly status report" required></label>
        </div>
        <label class="field">Instructions <span class="hint">markdown: steps, rules, templates, examples</span>
          <textarea name="instructions" rows="12" class="mono" placeholder="# Weekly report&#10;1. Start with the three biggest wins…" required>${esc(k.instructions)}</textarea></label>
        ${String(k.createdBy).startsWith('bot:') ? `<div class="req-note">${esc(skillOrigin(k))} while learning. It may keep improving it, and its changes reach every bot that has this skill.</div>` : ''}
        ${k.source === 'github' ? `<div class="req-note">Imported from <a href="${esc(k.sourceUrl)}" target="_blank" rel="noopener">${esc(k.sourceUrl)}</a> · ${k.fileCount + 1} files${k.scripts.length ? ` · scripts: ${esc(k.scripts.join(', '))}` : ''}${k.allowedTools.length ? ` · can use without asking: ${esc(k.allowedTools.join(', '))}` : ''}</div>` : ''}
        <fieldset><legend>Bots with this skill</legend>${botCheckboxes(k.usedBy)}</fieldset>
      </div>
      <div class="modal-foot">
        ${isNew ? '' : '<button type="button" class="btn danger left" id="delete-skill">Delete</button>'}
        <button type="button" class="btn" data-dismiss>Cancel</button>
        <button class="btn primary" type="submit">${isNew ? 'Create skill' : 'Save'}</button>
      </div>
    </form>`);
  const form = $('#skill-form', m);
  let doneName = null;
  if (opts.onDone) m.addEventListener('close', () => opts.onDone(doneName), { once: true });
  const del = $('#delete-skill', m);
  if (del) del.onclick = async () => {
    if (!confirm(`Delete the skill "${k.name}"? Bots that have it will stop using it.`)) return;
    await api(`/skills/${encodeURIComponent(k.name)}`, { method: 'DELETE' });
    m.close();
    toast('Skill deleted');
    await refresh();
    renderSkills();
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const body = {
      name: form.name.value.trim().toLowerCase(),
      description: form.description.value.trim(),
      instructions: form.instructions.value,
      bots: $$('input[name=bot]:checked', form).map((c) => c.value),
    };
    try {
      const saved = await api(isNew ? '/skills' : `/skills/${encodeURIComponent(k.name)}`, { method: isNew ? 'POST' : 'PUT', body });
      doneName = saved.name;
      m.close();
      toast(isNew ? 'Skill created' : 'Saved');
      await refresh();
      if (state.view === 'skills') renderSkills();
    } catch (err) { toast(err.message, true); }
  };
}

function openSkillImport(opts = {}) {
  const m = openModal(`
    <form id="import-form" autocomplete="off">
      <div class="modal-head"><h2>Import a skill</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
      <div class="modal-body">
        <label class="field">Link to the skill <span class="hint">on skills.sh, or its folder on GitHub</span>
          <input type="text" name="url" placeholder="https://skills.sh/vercel-labs/skills/find-skills" required></label>
        <div id="import-preview"></div>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn" data-dismiss>Cancel</button>
        <button class="btn primary" type="submit" id="import-go">Preview</button>
      </div>
    </form>`);
  const form = $('#import-form', m);
  let preview = null;
  let doneName = null;
  if (opts.onDone) m.addEventListener('close', () => opts.onDone(doneName), { once: true });
  form.onsubmit = async (e) => {
    e.preventDefault();
    const go = $('#import-go', m);
    if (!preview) {
      go.disabled = true;
      go.textContent = 'Fetching…';
      try {
        preview = await api('/skills/import/preview', { method: 'POST', body: { url: form.url.value.trim() } });
      } catch (err) {
        toast(err.message, true);
        go.disabled = false;
        go.textContent = 'Preview';
        return;
      }
      form.url.readOnly = true;
      $('#import-preview', m).innerHTML = `
        <div class="row">
          <label class="field">Name<input type="text" name="name" value="${esc(preview.name)}" pattern="[a-z0-9][a-z0-9-]*"></label>
          <label class="field">Files<div class="muted" style="font-weight:400;padding-top:6px">${preview.files.length} file${preview.files.length === 1 ? '' : 's'} · ${(preview.totalBytes / 1024 / 1024).toFixed(1)} MB${preview.folder ? ` · from <span class="mono">${esc(preview.folder)}</span>` : ''}</div></label>
        </div>
        ${preview.exists ? '<div class="skill-warn">You already have a skill with this name. Importing replaces it.</div>' : ''}
        <div class="req-note"><b>${esc(preview.description || '(no description)')}</b></div>
        ${preview.scripts.length ? `<div class="skill-warn">⚠︎ Includes scripts a bot may run: ${esc(preview.scripts.join(', '))}. Only import skills from people you trust.</div>` : ''}
        ${preview.allowedTools.length ? `<div class="skill-warn">⚠︎ Lets a bot use these without asking while the skill is active: ${esc(preview.allowedTools.join(', '))}</div>` : ''}
        <details class="tool" open><summary><span class="tname">SKILL.md</span><span class="targ">what the bot will read</span></summary><div class="md skill-preview">${md(preview.instructions)}</div></details>
        <fieldset><legend>Give it to</legend>${botCheckboxes(opts.forBot ? [opts.forBot] : [])}</fieldset>`;
      go.disabled = false;
      go.textContent = 'Import skill';
      return;
    }
    try {
      const saved = await api('/skills/import/confirm', { method: 'POST', body: { id: preview.id, name: form.name.value.trim().toLowerCase(), bots: $$('input[name=bot]:checked', form).map((c) => c.value) } });
      doneName = saved.name;
      m.close();
      toast('Skill imported');
      await refresh();
      if (state.view === 'skills') renderSkills();
    } catch (err) { toast(err.message, true); }
  };
}

// ---------- scheduled jobs ----------

const AI_WHEN_TEXT = {
  output: 'Only when it prints something',
  failed: 'Only when it fails',
  always: 'Every time it runs',
  never: 'Never, just show its output',
};
const BY_WHO = { you: 'you', chief: 'the Chief', bot: 'the bot itself' };

// `last` as the server sends it with `job-line` (docs/api.md): `status` may be "missed" (its time passed and it
// did not run), `failures` counts the failed runs in a row, and `text` is the whole line for under the job.
function jobStatus(j) {
  if (!j.approved) return '<span class="pill warn">needs your OK</span>';
  if (!j.enabled) return '<span class="pill">paused</span>';
  if (j.last?.status === 'missed') return '<span class="pill warn">did not run</span>';
  if (j.last?.status === 'error') return Number.isInteger(j.last.failures) && j.last.failures > 1 ? `<span class="pill err">failed ${j.last.failures} times</span>` : '<span class="pill err">last run failed</span>';
  return j.nextRunAt ? `<span class="pill">next ${esc(shortTime(j.nextRunAt))}</span>` : '';
}

// The line under a job: the server's own (`last.text`: why it failed or did not run, with times in the owner's
// time zone), else the page's, for a server that sends none.
function jobLastText(j) {
  const l = j.last;
  if (!l) return 'Not run yet.';
  if (OpeningLine.text(l.text)) return OpeningLine.text(l.text);
  if (l.status === 'missed') return 'Did not run.';
  const what = { held: 'held till morning', quiet: 'nothing to report', success: 'done', error: 'failed', stopped: 'stopped', interrupted: 'cut off' }[l.status] || l.status;
  return `Last run ${ago(l.at)}: ${what}.`;
}
// A job's pill and its line, on its card: drawn again only when the server says something new about the job,
// so that the fields of an open card, and "Saved." after a change, stay as they are.
const jobLineSig = (j) => JSON.stringify([j.approved, j.enabled, j.last || null, j.nextRunAt || null, j.createdBy || null, changeOf(j)?.at || null]);
const jobFootText = (j) => `${jobLastText(j)}${j.createdBy && j.createdBy !== 'you' ? ` Set up by ${BY_WHO[j.createdBy] || j.createdBy}.` : ''}`;
const jobWarns = (j) => ['error', 'missed', 'stopped', 'interrupted'].includes(j.last?.status);
function drawJobLine(card, j, force = false) {
  const sig = jobLineSig(j);
  if (!force && card.dataset.line === sig) return;
  card.dataset.line = sig;
  $('summary .pill', card)?.remove();
  $('.switch', card)?.insertAdjacentHTML('beforebegin', jobStatus(j));
  drawJobChange(card, j);
  const line = $('.job-last', card);
  if (!line) return;
  line.textContent = jobFootText(j);
  line.classList.toggle('warn', jobWarns(j));
}

// A job with a change waiting is the approved job, and runs: its pill and its fields are the approved ones. One
// note says that a change waits, with the way to its card. '' for a job without one.
const jobChangeNote = (j) => (changeOf(j) ? `<div class="req-note job-change">A change waits for your OK. ${esc(RUNS_AS_APPROVED)} <button type="button" class="btn sm primary" data-review>Review the change</button></div>` : '');
// The note follows the job while its card is open: it comes with a change and goes with the answer.
function drawJobChange(card, j) {
  $('.job-change', card)?.remove();
  const note = jobChangeNote(j);
  if (!note) return;
  $('.job-body', card)?.insertAdjacentHTML('afterbegin', note);
  wireJobChange(card);
}
// "Review the change" opens the change as the server has it now: a second one may have taken the first one's place.
function wireJobChange(card) {
  const review = $('[data-review]', card);
  if (review) review.onclick = () => { const bot = botById(state.botId); const job = bot?.jobs?.find((x) => x.id === card.dataset.job); if (job && changeOf(job)) openJobApproval(bot, job); };
}

function jobCardHTML(j, open = false) {
  const script = j.kind === 'script';
  const preset = CRON_PRESETS.some((p) => p.cron === j.cron);
  return `
    <details class="job-card" data-job="${esc(j.id)}" data-line="${esc(jobLineSig(j))}" ${open || jobWaits(j) ? 'open' : ''}>
      <summary>
        <span class="job-icon">${script ? '⚙️' : '🧠'}</span>
        <span class="grow"><b class="job-title">${esc(j.name || 'New job')}</b> <span class="faint job-when">${esc(j.when)}</span></span>
        ${jobStatus(j)}
        <label class="switch" title="${j.enabled !== false ? 'On: click to pause' : 'Paused: click to resume'}"><input type="checkbox" name="jobEnabled" ${j.enabled !== false ? 'checked' : ''} aria-label="Job on"><span></span></label>
      </summary>
      <div class="job-body">
        ${jobChangeNote(j)}${!j.approved ? `<div class="req-note job-approve">${esc(j.changedBy === 'bot' ? 'The bot' : j.changedBy === 'chief' ? 'The Chief' : 'Someone')} set this up, so it waits for your OK before it runs. <button type="button" class="btn sm primary" data-approve>Approve</button></div>` : ''}
        ${j.assessment ? `<div class="job-why">💡 ${esc(j.assessment)}</div>` : ''}
        <div class="row">
          <label class="field">Name<input type="text" name="jobName" value="${esc(j.name)}" placeholder="e.g. Morning news" maxlength="60"></label>
          <label class="field">When<select name="jobWhen">
            ${CRON_PRESETS.map((p) => `<option value="${p.cron}" ${p.cron === j.cron ? 'selected' : ''}>${esc(p.label)}</option>`).join('')}
            <option value="" ${preset ? '' : 'selected'}>Another time…</option>
          </select></label>
        </div>
        <div class="job-cron ${preset ? 'hidden' : ''}">
          <label class="field">Schedule <span class="hint">cron: min hour day month weekday, e.g. 30 7 * * 1-5</span><input type="text" class="mono" name="jobCron" value="${esc(j.cron)}"></label>
          <div class="cron-preview"></div>
        </div>
        <div class="job-script ${script ? '' : 'hidden'}">
          <label class="field">Script <span class="hint">bash, runs in the bot's folder on this computer. Print nothing when there's nothing to report. $JOB_STATE_DIR keeps files between runs.</span>
            <textarea class="mono" name="jobScript" rows="6" placeholder="curl -fsS https://example.com > /dev/null || echo &quot;example.com is down&quot;">${esc(j.script || '')}</textarea></label>
          <label class="field">Then ask the AI<select name="jobAiWhen">${Object.entries(AI_WHEN_TEXT).map(([k, v]) => `<option value="${k}" ${(j.aiWhen || 'output') === k ? 'selected' : ''}>${esc(v)}</option>`).join('')}</select></label>
        </div>
        <label class="field"><span class="job-prompt-label">${script ? 'What the AI should do with the output' : 'Task'}</span> <span class="hint job-prompt-hint">${script ? 'when it is asked' : "leave empty for the bot's main assignment"}</span>
          <textarea name="jobPrompt" rows="3">${esc(j.prompt || '')}</textarea></label>
        <details class="job-more"><summary class="faint">More options</summary>
          <div class="row">
            <label class="field">Kind<select name="jobKind">
              <option value="ai" ${script ? '' : 'selected'}>🧠 AI: a run of the bot</option>
              <option value="script" ${script ? 'selected' : ''}>⚙️ Script, no AI</option>
            </select></label>
            <label class="field job-timeout ${script ? '' : 'hidden'}">Script time limit (seconds)<input type="number" name="jobTimeout" min="10" max="3600" value="${esc(j.timeoutSeconds || 300)}"></label>
          </div>
        </details>
        <div class="job-foot">
          <span class="faint grow job-last${jobWarns(j) ? ' warn' : ''}">${esc(jobFootText(j))}</span>
          <button type="button" class="btn sm" data-run-job>Run now</button>
          <button type="button" class="btn sm danger" data-remove-job>Remove</button>
        </div>
      </div>
    </details>`;
}

const readJob = (card) => {
  const v = (n) => card.querySelector(`[name=${n}]`);
  return {
    name: v('jobName').value.trim(),
    kind: v('jobKind').value,
    cron: v('jobCron').value.trim(),
    prompt: v('jobPrompt').value,
    script: v('jobScript').value,
    aiWhen: v('jobAiWhen').value,
    timeoutSeconds: Number(v('jobTimeout').value) || 300,
  };
};

// A job on the jobs page: every change saves by itself; the switch pauses or resumes it right away.
function wireJobCard(card, bot) {
  const $in = (n) => card.querySelector(`[name=${n}]`);
  const jobUrl = () => `/bots/${bot.id}/jobs/${card.dataset.job}`;
  const showStatus = (job) => {
    $('summary .pill', card)?.remove();
    if (job) $('.switch', card).insertAdjacentHTML('beforebegin', jobStatus(job));
    if (job) drawJobChange(card, job); // the owner's own edit is approved at once and drops a waiting change
  };
  wireJobChange(card);
  // The schedule in the field, as the server says it: its words in the header and, with its next runs, under
  // the field. Only the newest answer is shown: an earlier one can arrive after it.
  let asked = 0;
  const preview = async () => {
    const mine = ++asked;
    const r = await api('/cron/preview', { method: 'POST', body: { expr: $in('jobCron').value } }).catch((e) => ({ error: e.message }));
    if (mine !== asked) return;
    if (r.when) $('.job-when', card).textContent = r.when;
    const el = $('.cron-preview', card);
    el.classList.toggle('err', !!r.error);
    el.textContent = r.error ? r.error : r.next.length ? `${r.when}. Next: ${r.next.map(fmtTime).join(' · ')}` : r.when;
  };
  $in('jobCron').oninput = preview;
  $in('jobWhen').onchange = () => {
    const cron = $in('jobWhen').value;
    $('.job-cron', card).classList.toggle('hidden', !!cron);
    if (cron) $in('jobCron').value = cron;
    else $in('jobCron').focus();
    preview();
  };
  // A job on a listed time has its words from the server already; the others need their next runs.
  if (!$('.job-cron', card).classList.contains('hidden')) preview();
  $in('jobName').oninput = () => { $('.job-title', card).textContent = $in('jobName').value || 'New job'; };
  $in('jobKind').onchange = () => {
    const script = $in('jobKind').value === 'script';
    $('.job-script', card).classList.toggle('hidden', !script);
    $('.job-timeout', card).classList.toggle('hidden', !script);
    $('.job-icon', card).textContent = script ? '⚙️' : '🧠';
    $('.job-prompt-label', card).textContent = script ? 'What the AI should do with the output' : 'Task';
    $('.job-prompt-hint', card).textContent = script ? 'when it is asked' : "leave empty for the bot's main assignment";
    if (script) $in('jobScript').focus();
  };
  // Save what changed, a moment after the last change (a script job without its script waits until it has one).
  let saved = JSON.stringify(readJob(card));
  let timer = null;
  let savedTimer = null; // while "Saved." stands where the job's line is
  const save = async () => {
    const now = readJob(card);
    if (JSON.stringify(now) === saved || (now.kind === 'script' && !now.script.trim())) return;
    try {
      const job = await api(jobUrl(), { method: 'PUT', body: now });
      saved = JSON.stringify(now);
      showStatus(job);
      // Said where the job's line is, for a moment: then the line is the job's again.
      const line = $('.job-last', card);
      line.textContent = job.approved ? 'Saved.' : 'Saved. It waits for your OK again.';
      line.classList.remove('warn');
      card.dataset.line = jobLineSig(job); // what the server said with the save: a later change of it redraws the line at once
      clearTimeout(savedTimer);
      savedTimer = setTimeout(() => { const j = botById(bot.id)?.jobs?.find((x) => x.id === card.dataset.job) || job; drawJobLine(card, j, true); }, 2500);
      refresh();
    } catch (e) { toast(e.message, true); }
  };
  card.addEventListener('change', (e) => { if (e.target.name !== 'jobEnabled') { clearTimeout(timer); timer = setTimeout(save, 300); } });
  $('[data-remove-job]', card).onclick = async () => {
    if (!confirm('Remove this job?')) return;
    try { await api(jobUrl(), { method: 'DELETE' }); card.remove(); toast('Job removed'); refresh(); } catch (e) { toast(e.message, true); }
  };
  const sw = $('.switch', card);
  sw.onclick = async (e) => {
    e.preventDefault(); // a click in the summary would also open or close the job
    const input = $('input', sw);
    const on = !input.checked;
    input.checked = on;
    sw.title = on ? 'On: click to pause' : 'Paused: click to resume';
    try {
      const job = await api(jobUrl(), { method: 'PUT', body: { enabled: on } });
      showStatus(job);
      toast(on ? 'Job resumed' : 'Job paused. It won’t run until you turn it back on.');
      refresh();
    } catch (err) { input.checked = !on; toast(err.message, true); }
  };
  $('[data-run-job]', card).onclick = async () => {
    try {
      const r = await api(`${jobUrl()}/run`, { method: 'POST' });
      toast(OpeningLine.text(r.skipped) || (r.queued ? 'It will run as soon as the bot is free' : r.started === 'script' ? 'Script started. Nothing to report means nothing shows in the chat.' : 'Started')); // skipped: why it did not start, in the server's words
      refresh();
    } catch (e) { toast(e.message, true); }
  };
  const approve = $('[data-approve]', card);
  // Approve right here (the script is shown in the card).
  if (approve) approve.onclick = async () => {
    try {
      const job = await api(`${jobUrl()}/approve`, { method: 'POST', body: { approve: true } });
      $('.job-approve', card)?.remove();
      showStatus(job);
      toast('Approved');
      refresh();
    } catch (e) { toast(e.message, true); }
  };
}

// A script job's run in the chat: what it printed, no AI involved.
function scriptRunHTML(r) {
  const failed = r.status !== 'success';
  const meta = [msgTime(r.endedAt || r.startedAt), r.durationMs != null ? dur(r.durationMs) : null, 'no AI'];
  return `
    <div class="bubble-row from-me"><span class="chip">⏰ ${esc(r.jobName || 'Job')} · ${esc(msgTime(r.startedAt))}</span></div>
    <div class="bubble-row from-bot"><div class="stack">
      <div class="bubble from-bot ${failed ? 'problem' : ''}">
        <div class="faint" style="font-size:12px;margin-bottom:4px">⚙️ Ran its script${failed ? `: ${esc(r.error || 'it failed')}` : ''}</div>
        ${r.result && r.result.trim() ? `<pre class="script-out" data-expand><div class="clamp">${esc(r.result.trim())}</div></pre>` : '<div class="muted">No output.</div>'}
      </div>
      <div class="bubble-meta">${meta.map(esc).join(' · ')} · <button data-details="${esc(r.id)}">Details</button>${r.result?.trim() ? copyBtn(r.result.trim()) : ''}</div>
    </div></div>`;
}

// Jobs waiting for the owner's OK: in the Needs you banner and page.
const jobReq = { snoozed: new Set() };

// A change that waits beside an approved job or tile (docs/api.md, "A change that waits"): the job or the tile as
// proposed, or null. The approved one keeps running, so it is `approved` and found by its `change` alone.
const changeOf = (x) => (x && x.approved !== false && x.change && typeof x.change === 'object' ? x.change : null);
// Whether a job waits for the owner: one never approved, or an approved one with a change beside it.
const jobWaits = (j) => !j.approved || !!changeOf(j);
// Whether a yes on a waiting job approves a script: the job runs one, or its change says it would or carries one.
const touchesScript = (j) => j.kind === 'script' || changeOf(j)?.kind === 'script' || (typeof changeOf(j)?.script === 'string' && !!changeOf(j).script.trim());

function pendingJobs() {
  return state.bots.flatMap((b) => (b.jobs || []).filter(jobWaits).map((j) => ({ bot: b, job: j })));
}

function showJobApprovals() { showNeeds(); }

// What a yes on a waiting job approves, as one string: what the job does, and the change that waits beside it.
const jobShown = (j) => JSON.stringify([j.approved, j.kind, j.cron, j.at || null, j.script || '', j.prompt || '', j.aiWhen || null, j.notify || null, changeOf(j)]);

// The dialog of one waiting job, from the banner and from the jobs panel: a job before its first OK, or a change to
// an approved one, with what goes struck above what comes (jobCard). Its buttons and its answer read the server's
// words where it sends them; nothing is asked in between.
function openJobApproval(bot, job) {
  jobReq.snoozed.add(`${job.id}:${job.script}:${job.cron}`);
  const c = jobCard(job);
  const script = c.isScript;
  const by = changeOf(job)?.by;
  const lead = c.change ? (by === 'bot' ? `${bot.name} wants to change this job of its own` : by === 'chief' ? `The Chief wants to change this job of ${bot.name}` : `A change to this job of ${bot.name}`)
    : job.changedBy === 'bot' ? `${bot.name} set this up for itself` : job.changedBy === 'chief' ? `The Chief set this up for ${bot.name}` : `This job of ${bot.name} changed`;
  const block = (was, now, tag, style) => (goes(was, now) === null ? '' : `<${tag} class="${tag === 'pre' ? 'script-out ' : 'card '}faint-strike" style="${style}">${esc(was)}</${tag}>`)
    + (now ? `<${tag} class="${tag === 'pre' ? 'script-out' : 'card'}" style="${style}">${esc(now)}</${tag}>` : '');
  const scripts = block(c.scriptWas, c.script, 'pre', 'max-height:260px;overflow:auto');
  const prompts = block(c.promptWas, c.prompt, 'div', 'padding:10px 12px;white-space:pre-wrap;font-size:13px');
  const m = openModal(`
    <div class="modal-head"><h2>${c.change ? 'Approve this change?' : 'Approve this job?'}</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
    <div class="modal-body">
      <p style="margin:0">${esc(lead)}:</p>
      <div class="card" style="padding:12px 14px;display:grid;gap:6px">
        <div><b>${script ? '⚙️' : '🧠'} ${esc(c.name)}</b> · ${esc(c.change && c.when !== job.when ? `now ${job.when} → ${c.when}` : c.when)}</div>
        <div class="muted" style="font-size:13px">${script ? `A script that runs on this computer without AI. Then asks the AI: ${esc(AI_WHEN_TEXT[c.aiWhen] || c.aiWhen || '').toLowerCase()}.` : 'A run of the bot (uses AI each time).'}</div>
        ${c.summary ? `<div>${esc(c.summary)}</div>` : ''}
        ${c.also.map((l) => `<div class="muted" style="font-size:13px">${esc(l)}</div>`).join('')}
        ${c.assessment ? `<div class="job-why">💡 ${esc(c.assessment)}</div>` : ''}
        ${c.line ? `<div style="font-size:13px">${esc(c.line)}</div>` : ''}
      </div>
      ${scripts ? `<label class="field">The script${scripts}</label>
      ${script ? `<div class="req-note">It runs in ${esc(bot.name)}'s folder with your user's permissions. Only approve it if you're happy with what it does.</div>` : ''}` : ''}
      ${prompts ? `<label class="field">${script ? 'What the AI does with the output' : 'Task'}${prompts}</label>` : ''}
    </div>
    <div class="modal-foot">
      <button type="button" class="btn ${c.change ? '' : 'danger '}left" id="job-decline">${esc(c.change || said(job.no) ? c.no : 'Decline and remove')}</button>
      <button type="button" class="btn" data-dismiss>Not now</button>
      <button type="button" class="btn primary" id="job-approve">${esc(c.yes)}</button>
    </div>`);
  const answer = async (approve) => {
    try {
      // The page is not read again while a dialog is open, and the yes approves what waits at that moment: look
      // first whether it is still what this dialog shows. A job that changed meanwhile is shown again, not approved.
      if (approve) {
        const jobs = await api(`/bots/${bot.id}/jobs`);
        const now = Array.isArray(jobs) ? jobs.find((j) => j.id === job.id) : undefined; // an answer that is no list says nothing
        if (Array.isArray(jobs) && (!now || !jobWaits(now))) { m.close(); toast('This no longer waits for your OK.'); return refresh(); }
        if (now && jobShown(now) !== jobShown(job)) { m.close(); toast('It changed meanwhile: look at it again.'); refresh(); return openJobApproval(bot, now); }
      }
      const a = await api(`/bots/${bot.id}/jobs/${job.id}/approve`, { method: 'POST', body: { approve } });
      m.close();
      const carries = approve ? said(a?.carriesOn?.text) : '';
      const word = (approve && !c.change ? '' : said(a?.text)) || (c.change ? (approve ? 'Approved' : 'Declined') : approve ? `Approved. ${job.name}: ${job.when}.` : 'Declined and removed');
      toast(carries ? `${word} · ${carries}` : word);
      refresh();
    } catch (e) { toast(e.message, true); }
  };
  $('#job-approve', m).onclick = () => answer(true);
  $('#job-decline', m).onclick = () => answer(false); // the button says what it does
}

// ---------- connectors (apps through Composio) ----------

const conn = { data: null, catalog: [], next: null, total: 0, search: '', category: '', categories: [], loading: false };
const CONN_STATUS = { ACTIVE: ['ok', 'connected'], INITIATED: ['warn', 'waiting for sign-in'], INITIALIZING: ['warn', 'waiting for sign-in'], EXPIRED: ['err', 'expired, connect again'], FAILED: ['err', 'failed'], INACTIVE: ['warn', 'switched off'] };

const appLogo = (a) => (a?.logo ? `<img class="app-logo" src="${esc(a.logo)}" alt="" loading="lazy" referrerpolicy="no-referrer">` : `<span class="app-logo ph">${esc((a?.name || '?')[0])}</span>`);

// Only fetch when the page is opened or something changed, not on every regular refresh of the web page.
async function renderConnectors(force = false) {
  const root = $('#view-connectors');
  if (root.dataset.ready && !force) return; // the web page's regular refresh would wipe the search box
  root.dataset.ready = '1';
  try { conn.data = await api('/connectors'); } catch (e) { conn.data = { configured: false, error: e.message, connections: [] }; }
  if (conn.data.configured && !conn.catalog.length) await loadCatalog(true);
  if (conn.data.configured && !conn.categories.length) conn.categories = await api('/connectors/categories').catch(() => []);
  drawConnectors();
}

async function loadCatalog(reset) {
  if (conn.loading) return;
  conn.loading = true;
  try {
    const q = new URLSearchParams({ ...(conn.search ? { search: conn.search } : {}), ...(conn.category ? { category: conn.category } : {}), ...(!reset && conn.next ? { offset: conn.next } : {}) });
    const d = await api(`/connectors/catalog?${q}`);
    conn.catalog = reset ? d.items : [...conn.catalog, ...d.items];
    conn.next = d.nextOffset;
    conn.total = d.total;
  } catch (e) { toast(e.message, true); } finally { conn.loading = false; }
}

function drawConnectors() {
  const root = $('#view-connectors');
  if (state.view !== 'connectors' || !conn.data) return;
  const d = conn.data;
  const head = `${SUB_BACK}
    <div class="section-head"><div><h1>Connectors</h1></div></div>`;
  if (!d.configured) {
    // botdot sets up its own Composio account by itself; this shows only when that failed.
    root.innerHTML = `${head}
      <div class="card setup-card">
        <h3>Connectors aren't working yet</h3>
        ${d.error ? `<div class="faint">${esc(d.error)}</div>` : ''}
        <div style="margin:10px 0"><button class="btn" id="conn-retry">Try again</button></div>
        <div class="faint" style="font-size:12.5px">Or use your own Composio account: paste its project API key (composio.dev → Settings → API keys).</div>
        <form id="conn-key" class="memory-add" autocomplete="off"><input type="password" name="key" placeholder="Composio API key" required><button class="btn primary">Save</button></form>
      </div>`;
    $('#conn-retry').onclick = () => renderConnectors(true);
    $('#conn-key').onsubmit = async (e) => {
      e.preventDefault();
      const input = e.target.key;
      try { await api('/connectors/key', { method: 'PUT', body: { key: input.value } }); input.value = ''; toast('Saved'); renderConnectors(true); } catch (err) { toast(err.message, true); }
    };
    return;
  }
  const botName = (id) => { const b = state.bots.find((x) => x.id === id); return b ? `<span class="chip">${botLabel(b)}</span>` : ''; };
  const connectedSlugs = new Set(d.connections.filter((c) => c.status === 'ACTIVE').map((c) => c.toolkit));
  const pending = new Set(d.connections.filter((c) => c.status !== 'ACTIVE').map((c) => c.toolkit));
  root.innerHTML = `${head}
    ${d.error ? `<div class="req-note">${esc(d.error)}</div>` : ''}
    <h3 class="page-sub">Your apps <span class="faint">· choose which bots may use each one</span></h3>
    ${d.connections.length ? `<div class="grid">${d.connections.map((c) => {
      const [tone, label] = CONN_STATUS[c.status] || ['', c.status.toLowerCase()];
      return `<article class="card app-card" data-conn="${esc(c.id)}">
        <div class="app-top">${appLogo(c.app)}<div class="grow"><b>${esc(c.app?.name || c.toolkit)}</b><div><span class="pill ${tone}">${esc(label)}</span></div></div></div>
        <div class="chips">${c.usedBy.map(botName).join('') || '<span class="faint" style="font-size:12.5px">No bot uses it yet</span>'}</div>
        <div class="app-actions">
          ${c.status === 'ACTIVE' ? `<button class="btn sm" data-app-bots="${esc(c.toolkit)}">Bots…</button>` : `<button class="btn sm primary" data-connect="${esc(c.toolkit)}">Connect again</button>`}
          <button class="btn sm danger" data-disconnect="${esc(c.id)}">Disconnect</button>
        </div>
      </article>`;
    }).join('')}</div>` : '<div class="card empty" style="padding:26px 20px">No apps connected yet. Pick one below.</div>'}
    <h3 class="page-sub">Marketplace <span class="faint">· ${conn.search || conn.category ? `${conn.total} match${conn.total === 1 ? '' : 'es'}` : `${conn.total} apps`}</span></h3>
    <div class="conn-filters">
      <input type="search" id="conn-search" placeholder="Search apps, e.g. gmail, calendar, notion" value="${esc(conn.search)}">
      <select id="conn-cat"><option value="">All categories</option>${conn.categories.map((c) => `<option value="${esc(c.id)}" ${c.id === conn.category ? 'selected' : ''}>${esc(c.name)} (${c.count})</option>`).join('')}</select>
    </div>
    <div class="grid app-grid">${conn.catalog.map((t) => `
      <article class="card app-card">
        <div class="app-top">${appLogo(t)}<div class="grow"><b>${esc(t.name)}</b><div class="faint" style="font-size:12px">${esc([...t.categories.slice(0, 2), t.toolsCount ? `${t.toolsCount} action${t.toolsCount === 1 ? '' : 's'}` : ''].filter(Boolean).join(' · '))}</div></div></div>
        <p class="skill-desc">${esc(t.description)}</p>
        <div class="app-actions">
          ${connectedSlugs.has(t.slug) ? '<span class="pill ok">connected</span>'
            : t.noAuth ? `<button class="btn sm" data-app-bots="${esc(t.slug)}">Give to bots</button><span class="faint" style="font-size:12px">no sign-in needed</span>`
            : t.connect !== 'developer' ? `<button class="btn sm primary" data-connect="${esc(t.slug)}">${pending.has(t.slug) ? 'Finish connecting' : 'Connect'}</button>${t.connect === 'key' ? `<span class="faint" style="font-size:12px">asks for your ${esc(t.name)} API key</span>` : ''}`
            : `<button class="btn sm" data-connect="${esc(t.slug)}">Connect</button><span class="faint" style="font-size:12px">needs your own developer app in Composio</span>`}
        </div>
      </article>`).join('') || `<div class="faint">No apps match${conn.search ? ` "${esc(conn.search)}"` : ''}. Try another word.</div>`}</div>
    ${conn.next ? '<div style="text-align:center;margin:16px 0"><button class="btn" id="conn-more">Show more</button></div>' : ''}
    <details class="bs-history conn-account" style="margin:24px 0 8px" ${conn.accountOpen ? 'open' : ''}><summary class="faint">Composio account</summary>
      ${d.account === 'botdot' ? `
        <form id="conn-claim" class="memory-add" autocomplete="off"><input type="email" name="email" placeholder="Your email" required><button class="btn">Claim it</button></form>
        <div class="faint" style="font-size:12px">${d.claimInvite ? `Invite sent to ${esc(d.claimInvite)}.` : 'For Composio\'s dashboard. Your apps stay connected.'}</div>
        <form id="conn-key" class="memory-add" autocomplete="off" style="margin-top:10px"><input type="password" name="key" placeholder="Or your own Composio key" required><button class="btn">Use</button></form>`
      : `<div class="faint" style="font-size:12.5px">Your key ${esc(d.keyHint || '')} · <button class="link-btn" id="conn-forget">Remove</button></div>`}
    </details>`;

  let t;
  $('#conn-search').oninput = (e) => {
    clearTimeout(t);
    t = setTimeout(async () => {
      conn.search = e.target.value.trim();
      await loadCatalog(true);
      const pos = e.target.selectionStart;
      drawConnectors();
      const box = $('#conn-search');
      box.focus();
      box.setSelectionRange(pos, pos);
    }, 250);
  };
  $('#conn-cat').onchange = async (e) => { conn.category = e.target.value; await loadCatalog(true); drawConnectors(); };
  const more = $('#conn-more');
  if (more) more.onclick = async () => { more.disabled = true; await loadCatalog(false); drawConnectors(); };
  $$('[data-connect]', root).forEach((b) => (b.onclick = () => connectApp(b.dataset.connect)));
  $$('[data-app-bots]', root).forEach((b) => (b.onclick = () => chooseAppBots(b.dataset.appBots)));
  $$('[data-disconnect]', root).forEach((b) => (b.onclick = async () => {
    const c = d.connections.find((x) => x.id === b.dataset.disconnect);
    if (!confirm(`Disconnect ${c?.app?.name || c?.toolkit}? Bots lose access, and Composio revokes its access to your account.`)) return;
    try { await api(`/connectors/connections/${encodeURIComponent(b.dataset.disconnect)}`, { method: 'DELETE' }); toast('Disconnected'); await refresh(); renderConnectors(true); } catch (e) { toast(e.message, true); }
  }));
  $('.conn-account', root).ontoggle = (e) => { conn.accountOpen = e.target.open; };
  const claimForm = $('#conn-claim');
  if (claimForm) claimForm.onsubmit = async (e) => {
    e.preventDefault();
    try { await api('/connectors/claim', { method: 'POST', body: { email: e.target.email.value } }); toast('Invite sent. Check your email'); renderConnectors(true); } catch (err) { toast(err.message, true); }
  };
  const keyForm = $('#conn-key');
  if (keyForm) keyForm.onsubmit = async (e) => {
    e.preventDefault();
    if (d.connections.length && !confirm('Use your own Composio account? Apps connected so far need connecting again there.')) return;
    try { await api('/connectors/key', { method: 'PUT', body: { key: e.target.key.value } }); conn.catalog = []; toast('Saved'); renderConnectors(true); } catch (err) { toast(err.message, true); }
  };
  const forget = $('#conn-forget');
  if (forget) forget.onclick = async () => {
    if (!confirm('Stop using your Composio key? botdot uses its own Composio account instead, and apps connected with your key need connecting again.')) return;
    await api('/connectors/key', { method: 'DELETE' });
    conn.catalog = [];
    renderConnectors(true);
  };
}

// Composio's sign-in page opens in a new tab; this waits for the connection to become active.
async function connectApp(slug) {
  const win = window.open('about:blank', '_blank'); // opened now, so pop-up blockers allow it
  let r;
  try { r = await api('/connectors/connect', { method: 'POST', body: { app: slug } }); } catch (e) { win?.close(); return toast(e.message, true); }
  if (r.noAuth) { win?.close(); return chooseAppBots(slug); }
  if (win) win.location = r.redirectUrl; else location.assign(r.redirectUrl);
  toast('Sign in on the page that opened. botdot notices when you\'re done.');
  const until = Date.now() + 10 * 60_000;
  while (Date.now() < until) {
    await new Promise((res) => setTimeout(res, 3000));
    const c = await api(`/connectors/connections/${encodeURIComponent(r.connectionId)}`).catch(() => null);
    if (c?.status === 'ACTIVE') {
      toast('Connected');
      await renderConnectors(true);
      return chooseAppBots(slug, true);
    }
    if (c && ['FAILED', 'EXPIRED'].includes(c.status)) { toast(`Connecting didn't work${c.statusReason ? `: ${c.statusReason}` : ''}`, true); return renderConnectors(true); }
  }
}

function chooseAppBots(slug, justConnected = false) {
  const used = state.bots.filter((b) => (b.connectors || []).includes(slug)).map((b) => b.id);
  const app = conn.catalog.find((t) => t.slug === slug) || conn.data?.connections.find((c) => c.toolkit === slug)?.app || { name: slug };
  const m = openModal(`
    <form id="app-bots">
      <div class="modal-head"><h2>${justConnected ? `${esc(app.name)} is connected` : `Bots that may use ${esc(app.name)}`}</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
      <div class="modal-body">
        <p class="muted" style="margin:0">They act on your real account. They'll read freely, but only send, post, change or delete things when you (or their task) ask for it.</p>
        ${botCheckboxes(used).replaceAll(' disabled title="Skills are turned off for this bot"', '')}
      </div>
      <div class="modal-foot"><button type="button" class="btn" data-dismiss>Cancel</button><button class="btn primary">Save</button></div>
    </form>`);
  $('#app-bots', m).onsubmit = async (e) => {
    e.preventDefault();
    const bots = $$('input[name=bot]:checked', m).map((c) => c.value);
    try { await api(`/connectors/apps/${encodeURIComponent(slug)}/bots`, { method: 'PUT', body: { bots } }); m.close(); toast('Saved'); await refresh(); renderConnectors(true); } catch (err) { toast(err.message, true); }
  };
}

// ---------- learning ----------

const LEARN_ICON = { 'memory-pending': '⏳', 'skill-pending': '⏳', instructions: '✏️', skill: '✦', 'skill-updated': '✦', job: '⏰', connector: '🔌' };
// What a chip opens: a job the bot's jobs, a change to its task, its rules, a skill or a connected app its
// settings. Memory has no screen: a chip about a note opens nothing.
const learnedOpens = (kind) => (kind === 'job' ? 'botjobs' : kind === 'instructions' || kind === 'connector' || String(kind).startsWith('skill') ? 'botsettings' : '');

// What a run learned, a chip each under its reply. The line is the server's (docs/api.md, "What a run learned"):
// `chip`, whole, and the page adds no word to it. An item without one, a kind that has no chip (a job, a connected
// app), is drawn from its `text`. A memory change that is done is never sent (ADR 024).
function learnedChips(r) {
  const items = (r.learned || []).map((x) => ({ kind: x.kind, line: said(x.chip) || said(x.text) })).filter((x) => x.line);
  if (!items.length) return '';
  return `<div class="actions">${items.map((x) => {
    const line = `${LEARN_ICON[x.kind] || '🧠'} ${esc(x.line)}`;
    return learnedOpens(x.kind) ? `<button class="action-chip" data-learned="${esc(x.kind)}">${line}</button>` : `<span class="action-chip said">${line}</span>`;
  }).join('')}</div>`;
}

// ---------- model & reasoning ----------

const modelLabel = (id) => (!id ? "Claude Code's default" : state.models?.find((x) => x.id === id)?.label || id);
const effortLabel = (id) => (!id ? "Claude Code's default" : state.efforts?.find((x) => x.id === id)?.label || id);
// Whether a model takes a reasoning level (from Anthropic's model list; unknown names are assumed to).
const takesEffort = (id) => { const m = state.models?.find((x) => x.id === id); return m ? m.effort !== false : !/haiku/i.test(id || ''); };
const llmSummary = (model, effort) => (model || effort ? `${modelLabel(model)}${effort && takesEffort(model) ? ` · ${effortLabel(effort)}` : ''}` : "Claude Code's choice");

// Model + reasoning selects. inherit: label for the "use the default" choice ('' = Claude Code's default).
function llmFieldsHTML(prefix, { model = '', effort = '' }, inherit = '') {
  const models = state.models || [];
  const known = models.some((x) => x.id === model);
  const groups = [...new Set(models.map((x) => x.group))];
  const modelOpts = [
    `<option value="" ${!model ? 'selected' : ''}>${esc(inherit || "Claude Code's default")}</option>`,
    ...groups.map((g) => `<optgroup label="${esc(g)}">${models.filter((x) => x.group === g).map((x) => `<option value="${esc(x.id)}" ${x.id === model ? 'selected' : ''}>${esc(x.label)}</option>`).join('')}</optgroup>`),
    `<option value="__custom" ${model && !known ? 'selected' : ''}>Another model…</option>`,
  ].join('');
  const effortOpts = [`<option value="" ${!effort ? 'selected' : ''}>${esc(inherit || "Claude Code's default")}</option>`, ...(state.efforts || []).map((x) => `<option value="${esc(x.id)}" ${x.id === effort ? 'selected' : ''}>${esc(x.label)}</option>`)].join('');
  return `
    <div class="llm-fields" data-llm="${prefix}">
      <div class="row">
        <label class="field">Model<select name="${prefix}Model">${modelOpts}</select></label>
        <label class="field">Reasoning level<select name="${prefix}Effort">${effortOpts}</select></label>
      </div>
      <input type="text" class="mono ${model && !known ? '' : 'hidden'}" name="${prefix}ModelCustom" value="${model && !known ? esc(model) : ''}" placeholder="Full model name, e.g. claude-opus-4-8" autocomplete="off" spellcheck="false">
      <div class="llm-note" data-llm-note></div>
    </div>`;
}

function wireLlmFields(form, prefix) {
  const box = $(`[data-llm="${prefix}"]`, form);
  const m = form[`${prefix}Model`];
  const e = form[`${prefix}Effort`];
  const custom = form[`${prefix}ModelCustom`];
  const update = () => {
    custom.classList.toggle('hidden', m.value !== '__custom');
    const id = m.value === '__custom' ? custom.value.trim() : m.value;
    const info = state.models?.find((x) => x.id === id);
    const noEffort = !!id && !takesEffort(id);
    e.disabled = noEffort;
    const effort = state.efforts?.find((x) => x.id === e.value);
    const bits = [];
    if (info?.note) bits.push(esc(info.note));
    if (noEffort) bits.push(`${esc(info?.label || id)} doesn't use reasoning levels.`);
    else if (effort) bits.push(`<b>${esc(effort.label)}:</b> ${esc(effort.note)}`);
    $('[data-llm-note]', box).innerHTML = bits.join(' ');
  };
  m.onchange = update;
  e.onchange = update;
  custom.oninput = update;
  update();
}

function readLlmFields(form, prefix) {
  const m = form[`${prefix}Model`].value;
  const model = m === '__custom' ? form[`${prefix}ModelCustom`].value.trim() : m;
  return { model, effort: model && !takesEffort(model) ? '' : form[`${prefix}Effort`].value };
}

// ---------- settings ----------

function catalogLine() {
  const c = state.catalog || {};
  if (c.error) return `<span class="warn-text">${esc(c.error)}</span>`;
  if (c.source === 'docs') return `Model list from Anthropic's docs, checked ${esc(ago(c.checkedAt))}. Reasoning levels from your Claude Code.`;
  return 'Built-in model list (not checked online yet).';
}

// The checkup's two switches in the Chief's settings (docs/api.md, The Chief's checkup), from a server that has
// it. Its days and its time have no control: the line says them in the server's words, and the Chief changes them.
const CHECKUP_HTML = `
    <div class="card settings-card bs-rows hidden" id="chief-checkup">
      <div class="bs-row">
        <div class="grow"><b>Checkup</b><div class="faint" data-checkup-when></div></div>
        <label class="switch"><input type="checkbox" data-checkup="on" aria-label="Checkup"><span></span></label>
      </div>
      <div class="bs-row">
        <div class="grow"><b>Web search</b><div class="faint">Lets a checkup search the web to check a proposal. It never opens a page.</div></div>
        <label class="switch"><input type="checkbox" data-checkup="webSearch" aria-label="Web search"><span></span></label>
      </div>
    </div>`;

// The switches as the server has them; Web search is there but can't be used while checkups are off.
function drawCheckup() {
  const box = $('#chief-checkup');
  if (!box) return;
  const c = state.features.includes('checkup') ? state.checkup : null;
  box.classList.toggle('hidden', !c);
  if (!c) return;
  const [on, web] = ['on', 'webSearch'].map((k) => $(`[data-checkup="${k}"]`, box));
  on.checked = !!c.on;
  web.checked = !!c.webSearch;
  web.disabled = !c.on;
  $('[data-checkup-when]', box).textContent = `${c.when}. Ask the Chief to change it.`;
}

async function loadCheckup() {
  if (!state.features.includes('checkup')) return;
  try { state.checkup = (await api('/settings/checkup')).checkup; } catch { /* the switches stay as they were, or away */ }
  drawCheckup();
}

// A refused or failed change puts the switch back: it is drawn again from what the server last said.
async function setCheckup(key, value) {
  try { state.checkup = (await api('/settings/checkup', { method: 'PUT', body: { [key]: value } })).checkup; }
  catch (err) { toast(err.message, true); }
  drawCheckup();
}

// The Chief's settings (its figure and name in its chat): its model and reasoning, your rules for it, the
// checkup's switches, its previous chats. Its instructions and tools are botdot's.
function renderChiefSettings() {
  const root = $('#view-chiefsettings');
  if (root.dataset.ready) renderChatList();
  if (!state.settings || root.dataset.ready) return;
  root.dataset.ready = '1';
  const s = state.settings;
  root.innerHTML = `
    <div class="section-head"><div><h1>Settings</h1><p>Changes save by themselves.</p></div></div>
    <form class="card settings-card" id="chief-form" autocomplete="off">
      <h3 class="page-sub" style="margin-top:0">Model and reasoning</h3>
      <p class="muted settings-hint">What the Chief uses to plan, create and manage your bots.</p>
      ${llmFieldsHTML('chief', { model: s.chiefModel, effort: s.chiefEffort }, 'Same as the default')}
      <h3 class="page-sub">Your rules for it</h3>
      <textarea name="chiefRules" rows="4" maxlength="4000" placeholder="e.g. Always ask me before creating a bot. Talk to me like a colleague: short and direct.">${esc(s.chiefRules || '')}</textarea>
    </form>${CHECKUP_HTML}
    <h3 class="page-sub">Previous chats</h3>
    <div class="card settings-card settings-links" id="chief-chats"></div>`;
  renderChatList();
  $$('[data-checkup]', root).forEach((box) => (box.onchange = () => setCheckup(box.dataset.checkup, box.checked)));
  loadCheckup();
  const form = $('#chief-form', root);
  wireLlmFields(form, 'chief');
  form.onsubmit = (e) => e.preventDefault();
  form.onchange = async () => {
    const c = readLlmFields(form, 'chief');
    try {
      const r = await api('/settings', { method: 'PUT', body: { chiefModel: c.model, chiefEffort: c.effort, chiefRules: form.chiefRules.value } });
      state.settings = r.settings;
      toast('Saved. The Chief uses it from its next reply.');
    } catch (err) { toast(err.message, true); }
  };
}

// The pages that open from Settings.
const SETTINGS_PAGES = [
  ['runs', 'Activity', '<svg viewBox="0 0 24 24"><path d="M3 12h4l3-8 4 16 3-8h4"/></svg>'],
  ['skills', 'Skills', '<svg viewBox="0 0 24 24"><path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z"/><path d="M19 15l.8 2.2L22 18l-2.2.8L19 21l-.8-2.2L16 18l2.2-.8z"/></svg>'],
  ['connectors', 'Connectors', '<svg viewBox="0 0 24 24"><path d="M9 7V3M15 7V3M7 7h10v4a5 5 0 0 1-10 0V7zM12 16v5"/></svg>'],
  ['vault', 'Vault', '<svg viewBox="0 0 24 24"><rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/></svg>'],
];

function renderSettings() {
  const root = $('#view-settings');
  if (!state.settings) { root.innerHTML = '<div class="empty">Loading…</div>'; return; }
  if (root.querySelector('#settings-form')) return; // don't wipe unsaved edits on refresh
  const s = state.settings;
  const custom = state.bots.filter((b) => b.model || b.effort);
  const running = state.runs.filter((r) => r.status === 'running').length;
  root.innerHTML = `
    ${PAGE_BACK}
    <div class="section-head"><div><h1>Settings</h1><p>Defaults for your team. Each bot can override them in its own settings.</p></div></div>
    <div class="card settings-card settings-links">${SETTINGS_PAGES.map(([view, label, icon]) => `
      <button type="button" class="settings-link" data-go="${view}">${icon}<span class="grow">${label}</span>${view === 'runs' && running ? `<span class="faint">${running} running</span>` : ''}<span class="faint">›</span></button>`).join('')}
    </div>
    <form id="settings-form" autocomplete="off">
      <div class="card settings-card">
        <h3 class="page-sub" style="margin-top:0">Default model and reasoning</h3>
        <p class="muted settings-hint">Used by every bot that doesn't choose its own. A higher reasoning level thinks longer before answering: better results on hard tasks, but slower.</p>
        ${llmFieldsHTML('default', { model: s.defaultModel, effort: s.defaultEffort })}
        <div class="catalog-line">${catalogLine()} <button type="button" class="link-btn" id="refresh-models">Check for new models</button></div>
      </div>
    </form>
    <div class="card settings-card">
      <h3 class="page-sub" style="margin-top:0">Bots with their own choice</h3>
      ${custom.length
        ? custom.map((b) => `<button type="button" class="settings-bot" data-edit-bot="${esc(b.id)}"><span>${botLabel(b)}</span><span class="muted">${esc(llmSummary(b.model, b.effort))}</span></button>`).join('')
        : '<p class="muted settings-hint" style="margin:0">None: every bot uses the default. Change a bot in its settings (⚙ in its chat).</p>'}
    </div>
    <div class="card settings-card" id="backups-card">
      <h3 class="page-sub" style="margin-top:0">Backups</h3>
      <p class="muted settings-hint" style="margin:0">Checking…</p>
    </div>
    ${signOutCardHTML()}`;
  const signOut = $('#sign-out-everywhere', root);
  if (signOut) signOut.onclick = signOutEverywhere;
  $$('[data-go]', root).forEach((b) => (b.onclick = () => setView(b.dataset.go)));
  loadBackupsCard();
  const form = $('#settings-form', root);
  wireLlmFields(form, 'default');
  $('#refresh-models', root).onclick = async (e) => {
    e.target.textContent = 'Checking…';
    try {
      const r = await api('/settings/refresh-models', { method: 'POST' });
      Object.assign(state, { models: r.models, efforts: r.efforts, catalog: r.catalog });
      toast(r.catalog.error ? r.catalog.error : 'Model list is up to date', !!r.catalog.error);
    } catch (err) { toast(err.message, true); }
    root.innerHTML = '';
    renderSettings();
  };
  $$('[data-edit-bot]', root).forEach((b) => (b.onclick = () => setView('botsettings', b.dataset.editBot)));
  // Saves by itself, like a bot's settings.
  form.onsubmit = (e) => e.preventDefault();
  form.onchange = async () => {
    const d = readLlmFields(form, 'default');
    try {
      const r = await api('/settings', { method: 'PUT', body: { defaultModel: d.model, defaultEffort: d.effort } });
      state.settings = r.settings;
      toast('Saved. New runs use it.');
    } catch (err) { toast(err.message, true); }
  };
}

// ---------- signing out everywhere ----------

// Settings → "Sign out everywhere" (ADR 028): the front door ends every session of the account, in every browser
// and app, this one too, and the page opens its sign-in. Only behind a front door (`accounts` in features).
const signOutCardHTML = () => (state.features.includes('accounts') ? `
    <div class="card settings-card" id="sign-out-card">
      <h3 class="page-sub" style="margin-top:0">Sign-ins</h3>
      <p class="muted settings-hint">Signs out this browser and every browser and app signed in to your account. Each signs in again with your passkey.</p>
      <button type="button" class="btn" id="sign-out-everywhere">Sign out everywhere</button>
    </div>` : '');

async function signOutEverywhere() {
  if (!confirm('Sign out everywhere? Every browser and app signed in to your account, this one too, signs in again with your passkey.')) return;
  let res;
  // The front door's own route, not botdot's: no botdot server, and so no Chief or bot, reaches a session.
  try { res = await fetch('/sign-out-everywhere', { method: 'POST', headers: { 'X-Bot-Dot': '1' } }); } catch { toast("Can't reach botdot.", true); return; }
  if (res.ok || res.status === 401) { location.assign('/sign-in'); return; }
  const data = await res.json().catch(() => ({}));
  toast(typeof data.error === 'string' && data.error.trim() ? data.error : `Couldn't sign out (${res.status}).`, true);
}

// ---------- backups ----------

// Settings → Backups (lib/backup.js): nightly, encrypted with your passphrase, the last few kept.
async function loadBackupsCard() {
  const card = $('#backups-card');
  if (!card) return;
  let b;
  try { b = await api('/backups'); } catch (e) { card.querySelector('p').textContent = e.message; return; }
  const head = '<h3 class="page-sub" style="margin-top:0">Backups</h3>';
  if (!b.configured) {
    card.innerHTML = `${head}
      <p class="muted settings-hint">Set a passphrase and botdot backs up every night. Keep it safe, e.g. in Bitwarden: without it a backup can't be opened.</p>
      <form id="backup-pass" class="backup-pass" autocomplete="off">
        <input type="password" name="p1" placeholder="Passphrase" minlength="8" required autocomplete="new-password">
        <input type="password" name="p2" placeholder="Again" minlength="8" required autocomplete="new-password">
        <button class="btn primary sm">Turn on</button>
      </form>`;
    $('#backup-pass', card).onsubmit = async (e) => {
      e.preventDefault();
      const f = e.target;
      if (f.p1.value !== f.p2.value) return toast("The two don't match", true);
      try { await api('/backups/passphrase', { method: 'PUT', body: { passphrase: f.p1.value } }); f.reset(); toast('Backups are on'); await api('/backups/now', { method: 'POST' }); } catch (err) { toast(err.message, true); }
      loadBackupsCard();
    };
    return;
  }
  const last = b.last ? `Last backup ${esc(ago(b.last.at))} · ${b.count} kept` : 'No backup yet';
  card.innerHTML = `${head}
    <p class="muted settings-hint" style="margin:0">${b.running ? 'Backing up…' : last}. Every night at 03:00.</p>
    ${b.error ? `<div class="req-note">${esc(b.error)}</div>` : ''}
    <div class="backup-actions">
      <button class="btn sm" id="backup-now" ${b.running ? 'disabled' : ''}>Back up now</button>
      ${b.last ? `<a class="btn sm" href="/api/backups/${encodeURIComponent(b.last.name)}" download>Download</a>` : ''}
      <button class="link-btn" id="backup-change">Change passphrase</button>
    </div>`;
  $('#backup-now', card).onclick = async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Backing up…';
    try { await api('/backups/now', { method: 'POST' }); toast('Backed up'); } catch (err) { toast(err.message, true); }
    loadBackupsCard();
  };
  $('#backup-change', card).onclick = async () => {
    const p = prompt('New backup passphrase (at least 8 characters). Older backups still need the old one.');
    if (!p) return;
    try { await api('/backups/passphrase', { method: 'PUT', body: { passphrase: p } }); toast('Passphrase changed. The next backups use it.'); } catch (err) { toast(err.message, true); }
  };
}

// Setup → Restore a backup: upload it, check the passphrase, and botdot restarts with it.
function openRestoreDialog() {
  const m = openModal(`
    <form id="restore-form" autocomplete="off">
      <div class="modal-head"><h2>Restore a backup</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
      <div class="modal-body">
        <p class="muted" style="margin:0">Your bots, chats, memory, vault and settings come back. Afterwards, sign in to Claude (and Bitwarden) again. What's here now is kept aside, not deleted.</p>
        <label class="field">Backup file<input type="file" name="file" accept=".bdb" required></label>
        <label class="field">Its passphrase<input type="password" name="passphrase" required autocomplete="off"></label>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn" data-dismiss>Cancel</button>
        <button class="btn primary" id="restore-go">Restore</button>
      </div>
    </form>`);
  $('#restore-form', m).onsubmit = async (e) => {
    e.preventDefault();
    const f = e.target;
    const go = $('#restore-go', m);
    go.disabled = true;
    try {
      go.textContent = 'Uploading…';
      const up = await fetch('/api/backups/upload', { method: 'POST', headers: { 'X-Bot-Dot': '1', 'Content-Type': 'application/octet-stream' }, body: f.file.files[0] }).then(async (r) => { const d = await r.json(); if (!r.ok) throw new Error(d.error || 'Upload failed'); return d; });
      go.textContent = 'Checking…';
      const r = await api('/backups/restore', { method: 'POST', body: { file: up.file, passphrase: f.passphrase.value } });
      f.passphrase.value = '';
      go.textContent = 'Restarting…';
      toast(`Restoring ${r.bots} bot${r.bots === 1 ? '' : 's'} from ${new Date(r.createdAt).toLocaleString()}. botdot restarts.`);
      // Back up again: reload then (to the setup page, to sign in to Claude).
      const wait = setInterval(async () => { try { await api('/version'); clearInterval(wait); location.reload(); } catch { /* still restarting */ } }, 2000);
    } catch (err) { toast(err.message, true); go.disabled = false; go.textContent = 'Restore'; }
  };
}

// ---------- setup ----------

// A checklist of what botdot needs: Claude (required), then the bots' computers, your phone, the
// time zone, and optional extras. Shown on first start and while Claude isn't signed in; also in
// Settings → Setup.
const deviceTimezone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch { return ''; } };

async function renderSetup(fresh = false) {
  const root = $('#view-setup');
  if (root.dataset.ready && !fresh) return;
  root.dataset.ready = '1';
  if (!state.setup || fresh) {
    if (!state.setup) root.innerHTML = '<div class="empty">Checking…</div>';
    try { state.setup = await api(`/setup${fresh ? '?fresh' : ''}`); } catch (e) { root.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  }
  drawSetup();
}

function setupItem({ state: st, icon, title, body, action = '' }) {
  const mark = st === 'ok' ? '✓' : st === 'todo' ? '!' : st === 'off' ? '–' : '·';
  return `<div class="card setup-item ${st}">
    <div class="setup-mark">${mark}</div>
    <div class="setup-body"><h3>${icon} ${title}</h3><div class="muted">${body}</div>${action ? `<div class="setup-actions">${action}</div>` : ''}</div>
  </div>`;
}

// The setup checklist's `claude` when the server could not ask Claude Code or could not read its answer: its
// `error`, a sentence. The sign-in is unknown then, never "not signed in" (docs/api.md, GET /api/setup).
const claudeUnknown = (c) => (c && c.error ? String(c.error) : '');
// First start, or Claude is known not to be signed in: the page opens on Setup. Not for a check that could not tell.
const opensSetup = (s) => !!s && (!s.done || (!s.claude?.loggedIn && !claudeUnknown(s.claude)));
// Setup's Claude item: signed in, a check that could not tell (its sentence, and the way to sign in stays), or the step to do.
function claudeSetupItem(c, signingIn) {
  const signIn = c.installed === false || signingIn ? '' : '<button class="btn primary" id="claude-login">Sign in to Claude</button>';
  if (claudeUnknown(c)) return setupItem({ state: 'todo', icon: '✳︎', title: 'Claude', body: esc(claudeUnknown(c)), action: signIn });
  return c.loggedIn
    ? setupItem({
      state: 'ok', icon: '✳︎', title: 'Claude',
      body: c.fromEnv ? "Signed in with a token from the server's settings." : c.email ? `Signed in with <b>${esc(c.email)}</b>.` : 'Signed in.',
      action: c.fromEnv ? '' : '<button class="link-btn" id="claude-switch">Use another account</button> · <button class="link-btn" id="claude-logout">Sign out</button>',
    })
    : setupItem({
      state: 'todo', icon: '✳︎', title: 'Sign in to Claude',
      body: c.installed === false ? "Claude Code isn't installed on this machine, so bots can't run." : 'Your bots run on your Claude subscription. Sign in once; it stays signed in.',
      action: signIn,
    });
}
// What the page says after a sign-in or a sign-out, from the status the server answered: its own sentence when
// that check could not tell.
function toastClaude(c, said) {
  if (claudeUnknown(c)) toast(claudeUnknown(c), true); else toast(said);
}

function drawSetup() {
  const root = $('#view-setup');
  const s = state.setup;
  const c = s.claude || {};
  const a = s.access || {};
  const dev = deviceTimezone();
  const now = new Date().toLocaleTimeString([], { timeZone: s.timezone, hour: '2-digit', minute: '2-digit' });
  const signingIn = !!state.setupLogin;

  const unknown = !!claudeUnknown(c);
  const claude = claudeSetupItem(c, signingIn);
  const loginBox = signingIn ? `<div class="card setup-login">
      <ol>
        <li><a class="btn primary" href="${esc(state.setupLogin.url)}" target="_blank" rel="noopener">Open the sign-in page</a><span class="muted">Sign in, allow access, and copy the code it shows.</span></li>
        <li><form id="claude-code-form" class="setup-code"><input type="text" name="code" placeholder="Paste the code here" autocomplete="off" autocapitalize="off" spellcheck="false" required><button class="btn primary" type="submit">Sign in</button></form></li>
      </ol>
      <button class="link-btn muted" id="claude-cancel">Cancel</button>
    </div>` : '';

  const computers = !s.docker?.ok
    ? setupItem({ state: 'off', icon: '🖥', title: 'Bot computers', body: `${esc(s.docker?.error || 'Docker is not available')}, so bots can't have their own desktop. Everything else works.` })
    : setupItem({ state: 'ok', icon: '🖥', title: 'Bot computers', body: s.docker.image ? 'Ready. Any bot can get its own desktop with a browser (turn it on in the bot’s settings).' : 'Ready. The desktop downloads the first time a bot needs one, which takes a few minutes once.' });

  let phone;
  if (a.tailnet) {
    phone = setupItem({
      state: 'ok', icon: '📱', title: 'Your phone',
      body: `Private on your tailnet at <b>https://${esc(a.host)}</b>, and only your passkey signs in to your account.<br>On your phone, open it and choose <b>Add to Home Screen</b> to use it like an app.`,
    });
  } else if (a.tailnetHost) {
    phone = setupItem({ state: 'ok', icon: '📱', title: 'Your phone', body: `Also private on your tailnet at <b>https://${esc(a.tailnetHost)}</b>. Open it on your phone and choose <b>Add to Home Screen</b>.` });
  } else {
    phone = setupItem({
      state: 'off', icon: '📱', title: 'Your phone',
      body: `botdot only opens on this machine for now. To use it from your phone, privately, ${a.docker ? 'run the installer again: it sets up Tailscale for you.' : `install <a href="https://tailscale.com/download" target="_blank" rel="noopener">Tailscale</a>, then run <span class="mono">tailscale serve --bg ${esc(a.port)}</span> and add the address it shows to <span class="mono">BOT_DOT_ALLOWED_HOSTS</span>.`}`,
    });
  }

  const tz = setupItem({
    state: 'ok', icon: '🕒', title: 'Time zone',
    body: `Schedules run on <b>${esc(s.timezone)}</b> time (it's ${esc(now)} there).${dev && dev !== s.timezone ? ` Your device is on ${esc(dev)}.` : ''}`,
    action: dev && dev !== s.timezone ? `<button class="btn sm" id="tz-use">Use ${esc(dev)}</button>` : '',
  });

  const bw = s.bitwarden || {};
  const extras = [
    setupItem({ state: bw.configured ? 'ok' : 'off', icon: '🛡', title: 'Bitwarden <span class="setup-opt">optional</span>', body: bw.configured ? `Connected${bw.unlocked ? '' : ', locked: unlock it when botdot asks'}. Bots use its logins and cards without seeing them.` : 'Let bots use your logins, cards and identities without ever seeing them.', action: `<button class="btn sm" data-setup-go="vault">${bw.configured ? 'Open' : 'Set up'}</button>` }),
  ];

  root.innerHTML = `
    ${PAGE_BACK}
    <div class="section-head"><div><h1>Setup</h1>${unknown ? '' : `<p>${c.loggedIn ? 'botdot is ready. The rest is up to you.' : 'One step and botdot is ready.'}</p>`}</div></div>
    ${claude}${loginBox}
    ${computers}${phone}${tz}
    <h3 class="page-sub">Extras</h3>
    ${extras.join('')}
    ${state.bots.length ? '' : '<p class="muted settings-hint">Moving from another botdot? <button type="button" class="link-btn" id="restore-open">Restore a backup</button></p>'}
    <div class="settings-foot"><button class="btn primary" id="setup-done" ${c.loggedIn || unknown ? '' : 'disabled'}>${s.done ? 'Back to your bots' : 'Meet your Chief of Staff'}</button></div>`;

  const redraw = () => drawSetup();
  const onClick = (sel, fn) => { const el = $(sel, root); if (el) el.onclick = fn; };
  onClick('#restore-open', openRestoreDialog);
  onClick('#claude-login', async (e) => {
    e.target.disabled = true;
    e.target.textContent = 'Starting…';
    try { state.setupLogin = await api('/setup/claude/login', { method: 'POST' }); } catch (err) { toast(err.message, true); }
    redraw();
  });
  onClick('#claude-switch', async () => {
    try { state.setupLogin = await api('/setup/claude/login', { method: 'POST' }); state.setup.claude = { ...c, loggedIn: false }; } catch (err) { toast(err.message, true); }
    redraw();
  });
  onClick('#claude-logout', async () => {
    // Ask with a fresh count of what's running, since signing out stops it.
    let running = 0;
    try { running = (await api('/setup')).running || 0; } catch { /* ask anyway */ }
    const stops = running ? `\n\n${running === 1 ? 'A bot is working right now; it will be stopped.' : `${running} bots are working right now; they will be stopped.`}` : '';
    if (!confirm(`Sign out of Claude? Bots can't run until you sign in again.${stops}`)) return;
    try {
      const r = await api('/setup/claude', { method: 'DELETE' });
      state.setup.claude = r.claude;
      toastClaude(r.claude, 'Signed out of Claude');
    } catch (err) { toast(err.message, true); }
    renderSetup(true);
  });
  onClick('#claude-cancel', async () => {
    state.setupLogin = null;
    api('/setup/claude/login', { method: 'DELETE' }).catch(() => {});
    renderSetup(true);
  });
  const form = $('#claude-code-form', root);
  if (form) {
    form.code.focus();
    form.onsubmit = async (e) => {
      e.preventDefault();
      const btn = form.querySelector('button');
      btn.disabled = true;
      btn.textContent = 'Signing in…';
      try {
        const r = await api('/setup/claude/code', { method: 'POST', body: { code: form.code.value } });
        state.setupLogin = null;
        state.setup.claude = r.claude;
        toastClaude(r.claude, `Signed in to Claude${r.claude.email ? ` as ${r.claude.email}` : ''}`);
      } catch (err) {
        state.setupLogin = null; // a code works once: start over
        toast(err.message, true);
      }
      renderSetup(true);
    };
  }
  onClick('#tz-use', async () => {
    try { await api('/setup', { method: 'PUT', body: { timezone: dev } }); toast(`Schedules now run on ${dev} time`); } catch (err) { toast(err.message, true); }
    renderSetup(true);
  });
  $$('[data-setup-go]', root).forEach((b) => (b.onclick = () => setView(b.dataset.setupGo)));
  onClick('#setup-done', async () => {
    try { state.setup = { ...state.setup, ...(await api('/setup', { method: 'PUT', body: { done: true } })) }; } catch { /* still go */ }
    setView('chief');
  });
}

// ---------- vault ----------

// Heuristic, a hint before a message with a password in it is sent: "password: x", "pass=x", "hasło - x",
// "my password is Tr0ub4dor&3", "PIN 4821". It matches a password, not the word: after a word that means
// "password" comes a separator (":", "=", or "-" with a space beside it) or "is" (or "is:"), and then one token
// of four characters or more that holds a digit or a symbol (a hyphen is none: "case-sensitive"); after ":" or
// "=" a plain word counts too when the message ends with it. So "my password is wrong again" and "the password reset page" send without a question.
// A PIN only counts when a number follows, so phrases like "pin the version" don't trigger it.
const SECRET_AFTER = /(?:\b(?:password|passwd|pwd|hasło|haslo|passcode)(?:(?:\s+is\b)?\s*([:=])|\s+-|-(?=\s)|\s+is\b)|\bpass\s*([:=]))\s*(\S{4,})/gi; // "pass" only with ":" or "=": not the verb
function looksLikeSecret(t) {
  const text = String(t ?? '');
  if (/\bpin\b\s*(code)?\s*(is|:|=|-)?\s*\d{4,8}\b/i.test(text)) return true;
  for (const m of text.matchAll(SECRET_AFTER)) {
    const token = m[3].replace(/[.,;:!?)"'…]+$/, ''); // the sentence's own punctuation is no symbol
    if (token.length >= 4 && /[^\p{L}\s-]/u.test(token)) return true;
    if ((m[1] || m[2]) && !text.slice(m.index + m[0].length).trim()) return true;
  }
  return false;
}

// ---------- vault item types ----------

// A login-kind item of the Vault is a login, an API token or any other secret (docs/api.md, "The Vault's
// items"). The type is a label and the fields its form asks for, nothing else. An item or a request without
// one, or with one this page does not know, is a login.
const VAULT_TYPES = {
  login: { label: 'Login', username: 'Username or email', secret: 'Password', icon: '👤', none: '(no username)', saved: 'secret saved' },
  'api-token': { label: 'API token', username: 'Token ID', optional: true, secret: 'Token', icon: '🆔', none: '(no token ID)', saved: 'token saved' },
  other: { label: 'Other', secret: 'Secret', saved: 'secret saved' },
};
const vaultType = (type) => (Object.hasOwn(VAULT_TYPES, type) ? type : 'login');

// A login-kind item in the Vault's list: its type before its address, and the line under it.
const vaultItemAddr = (l) => `${VAULT_TYPES[vaultType(l.type)].label} · ${esc(l.site)}`;
function vaultItemLine(l) {
  const t = VAULT_TYPES[vaultType(l.type)];
  return `${t.username ? `${t.icon} ${esc(l.username || t.none)} · ` : ''}🔒 ${t.saved}${l.hasTotp ? ' · two-step code' : ''}${l.insecureTls ? ' · self-signed certificate OK' : ''}${l.inComputer ? ' · usable in its computer' : ''}`;
}

// The Type control, and the fields that hold the secret of a type, in the editor and in the "needs a login"
// dialog. username: what the username field starts with. isNew: a new item needs its secret; a saved one
// keeps it when the field is left empty. Other has the secret alone.
const vaultTypeControl = (type) => `<label class="field">Type<select name="type">${Object.entries(VAULT_TYPES).map(([value, t]) => `<option value="${value}"${value === vaultType(type) ? ' selected' : ''}>${t.label}</option>`).join('')}</select></label>`;
function vaultTypeFields(type, { username = '', isNew = true } = {}) {
  const t = VAULT_TYPES[vaultType(type)];
  const secret = `<label class="field">${t.secret}${isNew ? '' : ' <span class="hint">leave empty to keep the current one</span>'}<input type="password" name="password" autocomplete="new-password"${isNew ? ' required' : ' placeholder="••••••••"'}></label>`;
  if (!t.username) return `<div class="row one" data-type-fields>${secret}</div>`;
  return `<div class="row" data-type-fields><label class="field">${t.username}${t.optional ? ' <span class="hint">optional</span>' : ''}<input type="text" name="username" value="${esc(username)}" autocomplete="off" autocapitalize="off" spellcheck="false"></label>${secret}</div>`;
}

// The fields follow the Type control at once. What was typed stays: the secret, and the username also while
// Other shows no field for it, so a login changed to Other and back shows its username again.
function wireVaultType(form, { username = '', isNew = true } = {}) {
  let kept = username;
  form.type.onchange = () => {
    if (form.username) kept = form.username.value;
    const secret = form.password.value;
    $('[data-type-fields]', form).outerHTML = vaultTypeFields(form.type.value, { username: kept, isNew });
    form.password.value = secret;
  };
}

// What a form sends of its type: the type, and the username where the type has that field. Other sends none,
// so a new item has no username and a saved one keeps the one it has.
function vaultTypeBody(form) {
  const type = vaultType(form.type.value);
  return { type, ...(VAULT_TYPES[type].username ? { username: form.username.value } : {}) };
}

async function renderVault() {
  const root = $('#view-vault');
  root.dataset.ready = '1';
  let logins = [];
  try { [logins, state.bw] = await Promise.all([api('/vault'), api('/vault/bitwarden')]); } catch (e) { toast(e.message, true); }
  if (state.view !== 'vault') return;
  const bw = state.bw || {};
  const botName = (id) => { const b = state.bots.find((x) => x.id === id); return b ? `${b.name}` : id; };
  const locked = bw.configured && !bw.unlocked;
  root.innerHTML = `
    ${SUB_BACK}
    <div class="section-head">
      <div><h1>Vault</h1><p>${bw.configured ? `Your Bitwarden's <b>bot-dot</b> folder: logins, cards and identities your bots can use without ever seeing them.` : 'Saved logins your bots can use without ever seeing the password.'}</p></div>
      ${locked ? '' : '<button class="btn primary" id="add-login">＋ Add</button>'}
    </div>
    ${!bw.configured ? (bw.installed === false ? '<div class="req-note">To use Bitwarden, install its command-line tool first: <span class="mono">brew install bitwarden-cli</span>, then reload.</div>' : bitwardenSetupHTML()) : `
    <div class="card bw-bar">
      <span>🛡 Bitwarden · ${esc(bw.email || bw.server || '')} · ${bw.unlocked ? `unlocked · ${bw.items} item${bw.items === 1 ? '' : 's'} in bot-dot${bw.lastSync ? ` · synced ${esc(ago(bw.lastSync))}` : ''}` : '<b>locked</b>'}</span>
      <span class="grow"></span>
      ${bw.unlocked ? '<button class="btn sm" id="bw-sync">Sync</button><button class="btn sm" id="bw-lock">Lock</button>' : '<button class="btn sm primary" id="bw-unlock-btn">Unlock</button>'}
    </div>
    ${bw.error ? `<div class="req-note">${esc(bw.error)}</div>` : ''}`}
    ${locked ? '<div class="card empty"><div class="big">🔐</div>Unlock Bitwarden to see what bots can use.</div>' : `
    ${logins.length ? `<div class="grid">${logins.map((l) => {
      const kind = l.kind || 'login';
      const line = kind === 'card' ? `💳 ${esc(l.brand || 'Card')} •••• ${esc(l.last4)}${l.expiry ? ` · expires ${esc(l.expiry)}` : ''} · you approve each payment`
        : kind === 'identity' ? `🪪 ${esc(l.holder || '')}${l.email ? ` · ${esc(l.email)}` : ''}`
        : vaultItemLine(l);
      return `
      <article class="card vault-item">
        <div class="bot-head"><div class="avatar" style="--bot-color:#6c7cff">${KIND_ICON[kind] || '🔑'}</div>
          <div style="flex:1;min-width:0"><div class="bot-name">${esc(l.name)}</div><div class="addr">${kind === 'login' ? vaultItemAddr(l) : kind === 'card' ? 'Payment card' : 'Identity'}</div></div></div>
        <div class="bot-meta">
          <div>${line}</div>
          ${l.reprompt ? '<div class="faint">Asks for the master password again in Bitwarden, so bots can\'t use it.</div>' : ''}
          <div>${l.allowedBots.length ? `Can be used by: ${l.allowedBots.map((id) => esc(botName(id))).join(', ')}` : '<span class="faint">No bot may use it yet</span>'}</div>
        </div>
        <div class="bot-actions"><button class="btn" data-edit-login="${esc(l.id)}">${kind === 'login' ? 'Edit' : 'Bots…'}</button></div>
      </article>`;
    }).join('')}</div>`
      : `<div class="card empty"><div class="big">🔐</div>${bw.configured ? 'Nothing in the bot-dot folder yet. Move the logins, cards and identities bots may use into that folder in Bitwarden, or add a login here.' : 'No saved logins yet. Add one so a bot can sign in to a site for you.'}</div>`}`}`;
  const add = $('#add-login');
  if (add) add.onclick = () => openLoginEditor();
  $$('[data-edit-login]').forEach((b) => (b.onclick = () => {
    const l = logins.find((x) => x.id === b.dataset.editLogin);
    return (l.kind || 'login') === 'login' ? openLoginEditor(l) : openItemBots(l);
  }));
  wireBitwardenSetup(root);
  const u = $('#bw-unlock-btn'); if (u) u.onclick = () => { if (!bwUi.unlocking) openUnlock(); };
  const lk = $('#bw-lock'); if (lk) lk.onclick = async () => { await api('/vault/bitwarden/lock', { method: 'POST' }); toast('Locked'); bwUi.prompted = true; renderVault(); showBitwardenBanner(); };
  const sy = $('#bw-sync'); if (sy) sy.onclick = async () => { sy.disabled = true; try { await api('/vault/bitwarden/sync', { method: 'POST' }); toast('Synced'); } catch (e) { toast(e.message, true); } renderVault(); };
}

function openLoginEditor(login) {
  const isNew = !login;
  const l = login || { name: '', site: '', username: '', allowedBots: [] };
  const m = openModal(`
    <form id="login-form" autocomplete="off">
      <div class="modal-head"><h2>${isNew ? 'Add to the Vault' : `Edit ${esc(l.name)}`}</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
      <div class="modal-body">
        ${vaultTypeControl(l.type)}
        <div class="row">
          <label class="field">Name<input type="text" name="name" value="${esc(l.name)}" placeholder="e.g. Recipes"></label>
          <label class="field">Website or server <span class="hint">the secret is only used with this address</span><input type="text" name="site" value="${esc(l.site)}" placeholder="recipes.example.com or pve.example.ts.net" required></label>
        </div>
        ${vaultTypeFields(l.type, { username: l.username, isNew })}
        <label class="field">Additional exact hosts <input name="allowedHosts" value="${esc((l.allowedHosts || []).join(', '))}" placeholder="api.example.com, auth.example.com"><span class="hint">Only these hosts may receive this login. Subdomains are not included automatically.</span></label>
        <label class="toggle"><input type="checkbox" name="insecureTls" ${l.insecureTls ? 'checked' : ''}> Accept a self-signed certificate <span class="hint muted" style="font-weight:400">for your own servers, e.g. Proxmox or a NAS</span></label>
        <label class="toggle"><input type="checkbox" name="inComputer" ${l.inComputer ? 'checked' : ''}> Usable in its computer <span class="hint muted" style="font-weight:400">bots may use it in a command on their own computer, e.g. for Proton Bridge there. A bot could then read it: only for secrets that guard something on that computer</span></label>
        <div class="req-note">Bots can use this login to sign in on the website, or to call its API: they write <span class="mono">{{username}}</span> and <span class="mono">{{password}}</span> in the request and botdot fills them in, so they never see the secret.</div>
        <fieldset>
          <legend>Bots that may use it</legend>
          <div class="tool-toggles">${state.bots.map((b) => `<label title="${b.computer === 'linux' ? '' : 'This bot has no computer, so it can’t sign in to websites'}"><input type="checkbox" name="bot" value="${esc(b.id)}" ${l.allowedBots.includes(b.id) ? 'checked' : ''}>${botLabel(b)}${b.computer === 'linux' ? '' : ' <span class="faint">(no computer)</span>'}</label>`).join('')}</div>
        </fieldset>
        <div class="req-error" role="alert" hidden></div>
      </div>
      <div class="modal-foot">
        ${isNew ? '' : '<button type="button" class="btn danger left" id="delete-login">Delete</button>'}
        <button type="button" class="btn" data-dismiss>Cancel</button>
        <button class="btn primary" type="submit">Save</button>
      </div>
    </form>`);
  const form = $('#login-form', m);
  wireVaultType(form, { username: l.username, isNew });
  const del = $('#delete-login', m);
  if (del) del.onclick = async () => {
    if (!confirm(state.bw?.configured ? `Delete "${l.name}"? It moves to Bitwarden's trash, where you can restore it for 30 days.` : `Delete "${l.name}" from the Vault?`)) return;
    await api(`/vault/${l.id}`, { method: 'DELETE' });
    m.close();
    toast('Deleted');
    renderVault();
  };
  form.onsubmit = async (e) => {
    e.preventDefault();
    const refused = $('.req-error', form);
    refused.hidden = true;
    const body = {
      name: form.name.value.trim(),
      site: form.site.value.trim(),
      ...vaultTypeBody(form),
      allowedHosts: form.allowedHosts.value.split(',').map((s) => s.trim()).filter(Boolean),
      insecureTls: form.insecureTls.checked,
      inComputer: form.inComputer.checked,
      allowedBots: $$('input[name=bot]:checked', form).map((c) => c.value),
    };
    if (form.password.value) body.password = form.password.value;
    form.password.value = '';
    try {
      await api(isNew ? '/vault' : `/vault/${l.id}`, { method: isNew ? 'POST' : 'PUT', body });
      m.close();
      toast(state.bw?.configured ? (isNew ? 'Saved to Bitwarden (bot-dot folder)' : 'Saved in Bitwarden') : 'Saved');
      renderVault();
    } catch (err) {
      // Refused: the server's sentence, in the form, which stays open with what was typed, except the secret.
      refused.textContent = err.message;
      refused.hidden = false;
    }
  };
}

// ---------- Bitwarden ----------

const bwUi = { prompted: false, snoozed: new Set() };
const KIND_ICON = { login: '🔑', card: '💳', identity: '🪪' };

function bitwardenSetupHTML() {
  return `
    <div class="card setup-card">
      <h3>Use your Bitwarden</h3>
      <p class="muted" style="margin:0">Bots will use the logins, payment cards and identities in a folder called <b>bot-dot</b> in your Bitwarden, and nothing else in it.
      You approve every card payment in a pop-up. Your master password is only used to unlock (after each restart of botdot) and is never saved.</p>
      <ol>
        <li>In the Bitwarden web vault, open <b>Settings → Security → Keys → View API key</b>.</li>
        <li>Copy the <b>client_id</b> and <b>client_secret</b> here.</li>
      </ol>
      <form id="bw-setup" autocomplete="off" style="display:grid;gap:10px">
        <div class="row">
          <label class="field">Server<select name="server"><option value="us">bitwarden.com (US)</option><option value="eu">bitwarden.eu (EU)</option><option value="custom">Self-hosted…</option></select></label>
          <label class="field hidden" id="bw-url-field">Address<input type="text" name="serverUrl" placeholder="https://vault.example.com"></label>
        </div>
        <div class="row">
          <label class="field">client_id<input type="text" name="clientId" placeholder="user.xxxxxxxx-…" autocomplete="off" spellcheck="false"></label>
          <label class="field">client_secret<input type="password" name="clientSecret" autocomplete="new-password"></label>
        </div>
        <div><button class="btn primary">Connect Bitwarden</button></div>
      </form>
    </div>`;
}

function wireBitwardenSetup(root) {
  const f = $('#bw-setup', root);
  if (!f) return;
  f.server.onchange = () => $('#bw-url-field', root).classList.toggle('hidden', f.server.value !== 'custom');
  f.onsubmit = async (e) => {
    e.preventDefault();
    const btn = $('button.primary', f);
    btn.disabled = true; btn.textContent = 'Connecting…';
    try {
      await api('/vault/bitwarden/setup', { method: 'POST', body: { server: f.server.value, serverUrl: f.serverUrl.value, clientId: f.clientId.value, clientSecret: f.clientSecret.value } });
      f.clientSecret.value = '';
      toast('Connected. Now unlock it.');
      state.bw = await api('/vault/bitwarden');
      openUnlock();
      renderVault();
    } catch (err) { toast(err.message, true); btn.disabled = false; btn.textContent = 'Connect Bitwarden'; }
  };
}

function openUnlock(reason = '') {
  const s = state.bw || {};
  const m = openModal(`
    <form id="bw-unlock" autocomplete="off">
      <div class="modal-head"><h2>🔐 Unlock Bitwarden</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
      <div class="modal-body">
        <p class="muted" style="margin:0">${reason ? `${esc(reason)} ` : ''}Bots can use the <b>bot-dot</b> folder of ${esc(s.email || 'your vault')} once it's unlocked. It stays unlocked until botdot restarts or you lock it.</p>
        <label class="field">Master password<input type="password" name="password" autocomplete="current-password" required></label>
        <div class="req-note">🛡 Used once to unlock and then forgotten: it isn't saved, and the AI never sees it.</div>
      </div>
      <div class="modal-foot"><button type="button" class="btn" data-dismiss>Not now</button><button class="btn primary">Unlock</button></div>
    </form>`);
  const f = $('#bw-unlock', m);
  setTimeout(() => f.password.focus(), 50);
  f.onsubmit = (e) => {
    e.preventDefault();
    const pw = f.password.value;
    f.password.value = '';
    m.close();
    unlockInBackground(pw);
  };
  m.addEventListener('close', () => { f.password.value = ''; }, { once: true });
}

// Unlocking takes a few seconds: it runs in the background with a small pill in the corner, so the
// bots stay usable meanwhile.
async function unlockInBackground(password) {
  if (bwUi.unlocking) return;
  bwUi.unlocking = true;
  unlockPill('busy', 'Unlocking Password Manager…');
  try {
    const r = await api('/vault/bitwarden/unlock', { method: 'POST', body: { password } });
    state.bw = { ...state.bw, ...r };
    unlockPill('ok', r.moved ? `Unlocked. Moved ${r.moved} saved login${r.moved === 1 ? '' : 's'} into Bitwarden.` : 'Unlocked');
    showBitwardenBanner();
    if (state.view === 'vault') renderVault();
  } catch (err) {
    unlockPill('err', /not right/i.test(err.message) ? 'Wrong master password' : err.message);
  } finally { bwUi.unlocking = false; }
}

// retry: what tapping an error pill does (by default, open the unlock dialog again).
function unlockPill(kind, text, retry = () => openUnlock()) {
  let el = $('#unlock-pill');
  if (!el) { el = document.createElement('div'); el.id = 'unlock-pill'; document.body.append(el); }
  clearTimeout(unlockPill.timer);
  el.className = `unlock-pill ${kind}`;
  el.innerHTML = `<span class="dot"></span><span>${esc(text)}</span>${kind === 'err' ? '<button type="button" class="x" aria-label="Close">✕</button>' : ''}`;
  el.onclick = kind === 'err' ? (e) => { el.remove(); if (!e.target.closest('.x')) retry(); } : null;
  if (kind === 'ok') unlockPill.timer = setTimeout(() => { el.classList.add('gone'); setTimeout(() => el.remove(), 400); }, 2500);
}

async function pollBitwarden() {
  bwUi.polledAt = Date.now();
  try { state.bw = await api('/vault/bitwarden'); } catch { return; }
  showBitwardenBanner();
  const s = state.bw;
  if (!s.configured || s.unlocked || bwUi.unlocking || $('#modal').open) return;
  // Right after a restart, and whenever a bot is waiting for a login.
  if (s.wantedBy && !bwUi.snoozed.has(s.wantedBy.id)) { bwUi.snoozed.add(s.wantedBy.id); return openUnlock(`${s.wantedBy.name} needs a saved login.`); }
  if (!bwUi.prompted) { bwUi.prompted = true; openUnlock(); }
}

function showBitwardenBanner() { showNeeds(); }

// A bot wants to pay: the owner approves this card on this site (for this run, 15 minutes).
function openCardApproval(r) {
  loginReq.shown = r.id;
  const m = openModal(`
    <div class="modal-head"><h2>💳 ${botLabel(r.bot)} wants to pay</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
    <div class="modal-body">
      <div class="req-site">
        <div class="muted" style="font-size:12.5px">On</div>
        <div class="site">${esc(r.site)}</div>
        <div class="muted" style="font-size:12.5px">with ${esc(r.card?.name || 'a card')}${r.card?.last4 ? ` (${esc(r.card.brand || 'card')} •••• ${esc(r.card.last4)})` : ''}</div>
      </div>
      ${r.amount ? `<div class="req-reason"><span class="muted">Amount:</span> <b>${esc(r.amount)}</b></div>` : ''}
      ${r.reason ? `<div class="req-reason"><span class="muted">The bot says:</span> “${esc(r.reason)}”</div>` : ''}
      <div class="req-note">If you approve, botdot types the card details into the bot's browser on this site only (the bot never sees them). This covers this run on ${esc(r.site)} for 15 minutes. Only approve a purchase you asked for, and check the site is the one you expect.</div>
    </div>
    <div class="modal-foot">
      <button type="button" class="btn danger left" id="card-decline">Decline</button>
      <button type="button" class="btn" id="card-later">Later</button>
      <button type="button" class="btn primary" id="card-approve">Approve payment</button>
    </div>`);
  m.dataset.request = r.id;
  const answer = async (action) => {
    try {
      await api(`/vault/requests/${r.id}`, { method: 'POST', body: { action } });
      m.close();
      toast(action === 'approve' ? `Approved. ${r.bot.name} will continue.` : 'Declined');
    } catch (e) { toast(e.message, true); }
  };
  $('#card-approve', m).onclick = () => answer('approve');
  $('#card-decline', m).onclick = () => answer('decline');
  $('#card-later', m).onclick = () => { loginReq.snoozed.add(r.id); m.close(); };
  $('[data-dismiss]', m).onclick = () => { loginReq.snoozed.add(r.id); m.close(); };
  m.addEventListener('close', () => { loginReq.shown = null; delete m.dataset.request; pollLoginRequests(); }, { once: true });
}

function openItemBots(item) {
  const m = openModal(`
    <form id="item-bots">
      <div class="modal-head"><h2>${KIND_ICON[item.kind] || '🔑'} ${esc(item.name)}</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
      <div class="modal-body">
        <p class="muted" style="margin:0">${item.kind === 'card' ? 'Bots that may pay with this card. You still approve every payment in a pop-up.' : 'Bots that may type these details into forms.'} Change the details themselves in Bitwarden.</p>
        ${botCheckboxes(item.allowedBots).replaceAll(' disabled title="Skills are turned off for this bot"', '')}
      </div>
      <div class="modal-foot"><button type="button" class="btn" data-dismiss>Cancel</button><button class="btn primary">Save</button></div>
    </form>`);
  $('#item-bots', m).onsubmit = async (e) => {
    e.preventDefault();
    try { await api(`/vault/${item.id}`, { method: 'PUT', body: { allowedBots: $$('input[name=bot]:checked', m).map((c) => c.value) } }); m.close(); toast('Saved'); renderVault(); } catch (err) { toast(err.message, true); }
  };
}

// ---------- Needs you: everything waiting for the owner, as small heads in a banner and cards on a page ----------

// Jobs, memory changes, login and payment requests, and a locked Bitwarden, each with its bot (none: the Chief's).
// then: what a yes on it starts, as the botdot server says it (docs/api.md, "What follows a yes"): on an ask and on
// a waiting tile, and for a waiting job in the live feed's list of what waits.
// The memory changes that wait, guarded ones too (docs/api.md, "A guarded change"): each is a card here.
const MEMORY_WAITS = '/memory/pending?guarded=1';
// group: the group a card was asked in, `{ id, name }` (groupOfNeed): it stands at the end of that group's chat
// (groups.js) and in no bot's own.
function needsItems() {
  const bw = state.bw;
  return needsList(bw).map((x) => { const group = groupOfNeed(x); return group ? { ...x, group } : x; });
}
function needsList(bw) {
  return [
    ...(loginReq.pending || []).map((r) => {
      const chief = r.from === 'chief' && !botById(r.botId);
      return { key: `req:${r.id}`, kind: r.kind === 'card' ? 'pay' : 'login', r, bot: chief ? CHIEF_BOT : r.bot, color: chief ? CHIEF_COLOR : colorOf(r.bot) };
    }),
    ...(bw && bw.configured && !bw.unlocked ? [{ key: 'bitwarden', kind: 'bitwarden', bot: bw.wantedBy, color: bw.wantedBy ? colorOf(bw.wantedBy) : CHIEF_COLOR }] : []),
    ...pendingJobs().map(({ bot, job }) => ({ key: `job:${job.id}${changeKey(job)}`, kind: 'job', bot, job, color: bot.color, then: job.then || fedJobThen(bot.id, job.id) })),
    ...(state.memPending || []).map((p) => ({ key: `mem:${p.id}`, kind: 'memory', p, bot: p.bot, color: colorOf(p.bot) })),
    // A permission or a skill a bot (or the Chief) asked for, and a tool the Chief asks to install for a bot.
    ...(state.asks || []).map((a) => ({ key: `ask:${a.id}`, kind: 'ask', a, bot: a.bot || (a.kind === 'skill' ? CHIEF_BOT : null), color: a.bot ? colorOf(a.bot) : CHIEF_COLOR, then: a.then })),
    // A tile on the Board with a script: it runs on this computer, so it waits for you.
    ...(state.dash?.pending || []).map((t) => { const b = botById(t.bot); return { key: `tile:${t.id}:${tileScripts(t).join('').length}${changeKey(t)}`, kind: 'tile', t, bot: b || null, color: b ? b.color : CHIEF_COLOR, then: t.then }; }),
    // A bot's plan for the Chief: nothing happens until you approve it (here or in its chat).
    ...(state.chats || []).filter((c) => c.waiting).map((c) => ({ key: `sug:${c.id}`, kind: 'suggestion', chat: c, bot: c.waiting.from, color: colorOf(c.waiting.from) })),
  ];
}

// The group a card was asked in, `{ id, name }`, or null for a card of a bot's own chat (docs/api.md, "A card and
// a question in a group"). An ask, a login request and a memory change carry it; for a waiting job and a tile the
// feed's list of what waits does (`approvals`).
function groupOfNeed(x) {
  const fed = (list, same) => (Array.isArray(list) ? list : []).find((c) => c && same(c));
  const from = x.kind === 'ask' ? x.a : x.kind === 'login' || x.kind === 'pay' ? x.r : x.kind === 'memory' ? x.p
    : x.kind === 'job' ? fed(state.approvals?.jobs, (j) => j.botId === x.bot?.id && j.jobId === x.job?.id)
    : x.kind === 'tile' ? fed(state.approvals?.tiles, (t) => t.tileId === x.t?.id) : null;
  if (typeof from?.groupId !== 'string' || !from.groupId) return null;
  const name = (state.groups || []).find((g) => g.id === from.groupId)?.name || (typeof from.groupName === 'string' ? from.groupName : '');
  return { id: from.groupId, name: name || 'a group' };
}

// A change has a card of its own: a second change to the same job or tile, proposed after the first was answered
// on this page, is a new card and not the answered one.
const changeKey = (x) => (changeOf(x) ? `:change:${said(changeOf(x).at)}` : '');

// What a yes on a waiting job starts: the feed lists the waiting jobs (`approvals.jobs`), each with its `then`.
const fedJobThen = (botId, jobId) => (Array.isArray(state.approvals?.jobs) ? state.approvals.jobs : []).find((j) => j?.botId === botId && j.jobId === jobId)?.then;

const needsFigures = (items) => `<span class="needs-figs">${items.map((x, i) => `<i style="animation-delay:${(i * 0.15).toFixed(2)}s">${x.bot ? botMark(x.bot) : Figure.small(CHIEF_COLOR, Figure.CHIEF)}</i>`).join('')}</span>`;

// The banner: one small head per thing, in its bot's colour and hat, nothing to count. Review opens the one thing, or the page for several.
function showNeeds() {
  tellTab();
  const banner = $('#needs-banner');
  if (!banner) return;
  const items = needsItems();
  const review = () => (items.length === 1 ? openNeed(items[0]) : setView('needs'));
  banner.classList.toggle('hidden', !items.length || state.view === 'needs');
  if (items.length) {
    banner.innerHTML = `${needsFigures(items)}<span>Waiting for your OK</span><button class="btn sm primary" id="needs-open">Review</button>`;
    $('#needs-open').onclick = review;
  }
  drawKeypadNeeds(state.view === 'needs' ? [] : items, review); // the same, on the keypad
  if (state.view === 'needs') renderNeeds();
  if (state.view === 'group') drawGroupCards(); // the cards at the end of the open group (groups.js)
}

function openNeed(x) {
  if (x.kind === 'job') return openJobApproval(x.bot, x.job);
  if (x.kind === 'bitwarden') return bwUi.unlocking ? null : openUnlock();
  if (x.kind === 'suggestion') return openChiefChat(x.chat.id);
  if (x.kind === 'tile') return setView('needs'); // the script is on its card
  if (x.kind === 'login' || x.kind === 'pay') return openLoginRequest(x.r);
  return setView('needs'); // anything else (a permission or skill a bot asked for, a memory change) is answered on its card
}

// Decided cards stay on the page, faded, until you leave it.
const needsDone = new Map(); // key -> the card's HTML
const needsOpen = new Set(); // cards clicked open (the rest show a few lines each)

// here: the Chief chat the card stands in (its id), null on the Needs you page and in a bot's chat.
function needCardHTML(x, here = null) {
  // Whose it is, and for a card asked in a group, in which: the group's own chat says only the bot.
  const who = x.bot ? `${botLabel(x.bot)}${x.group && here !== `group:${x.group.id}` ? ` <span class="need-in">in ${esc(x.group.name)}</span>` : ''}` : '';
  // Under the body, one line that says who carries on after a yes, when the server says something does.
  const then = thenLine(x.then, here);
  const card = (title, meta, body, actions, cls = '') => `
    <div class="${['card', 'need-card', cls, needsOpen.has(x.key) ? 'open' : ''].filter(Boolean).join(' ')}" data-need="${esc(x.key)}" title="Click to see it all">
      ${who ? `<div class="need-who">${who}</div>` : ''}
      <div class="need-title">${title}</div>
      ${meta ? `<div class="need-meta">${meta}</div>` : ''}
      ${body || ''}${then ? `<div class="need-meta need-then">${esc(then)}</div>` : ''}
      <div class="need-actions">${actions}</div>
    </div>`;
  // A job: one that waits for its first OK, or a change to an approved one (jobCard). The no and the yes read the
  // server's words where it sends them: "Decline and remove", "Keep as it is", "Approve the change".
  if (x.kind === 'job') {
    const m = jobCard(x.job);
    return card(esc(m.title), esc(m.meta),
      `${summedHTML(m.summary, `${alsoHTML(m.also)}${changeBlocks([[m.scriptWas, m.script, 'pre'], [m.promptWas, m.prompt, 'div']])}`)}${m.assessment ? `<div class="job-why">${esc(m.assessment)}</div>` : ''}${untilHTML(m.line)}`,
      `<button class="btn sm" data-need-no>${esc(m.no)}</button><button class="btn sm" data-need-always>Always approve</button><button class="btn sm primary" data-need-yes>${esc(m.yes)}</button>`, [m.change ? 'need-changed' : '', m.summary ? 'need-summed' : ''].filter(Boolean).join(' '));
  }
  // A memory change: the title, why it waits and both buttons are the server's words (docs/api.md, "A waiting
  // memory change"), the same in every app. The body is the note: for a change one block, what goes, struck,
  // above what comes, so that a closed card shows the start of both; for a forget, what it would erase.
  if (x.kind === 'memory') {
    const p = x.p;
    const was = said(p.current?.text), now = said(p.text);
    return card(esc(said(p.title)), [shortTime(p.at), said(p.meta), said(p.reason)].filter(Boolean).map(esc).join(' · '),
      p.action === 'edit' ? changeBlock(was, now, 'div') : `<div class="need-body"><div class="nb">${esc(p.action === 'remove' ? was : now)}</div></div>`,
      `<button class="btn sm" data-need-no>${esc(said(p.no))}</button><button class="btn sm primary" data-need-yes>${esc(said(p.yes))}</button>`);
  }
  if (x.kind === 'ask' && x.a.kind === 'permission') return card(`Let it ${esc(x.a.what?.label || x.a.permission)}?`, x.a.reason ? esc(x.a.reason) : '',
    `<div class="need-body"><div class="nb">${esc((x.a.what?.hint || '').replace(/^./, (c) => c.toUpperCase()))}. It can't until you allow it; you can change this in its settings.</div></div>`,
    `<button class="btn sm" data-need-no>Decline</button><button class="btn sm primary" data-need-yes>Allow</button>`);
  // A changed bot: the server's title, and what changes as its `parts`. Without them, the details as they were written.
  // The yes button reads the server's `yes` where it sends one ("Allow", for a change that only gives permissions).
  if (x.kind === 'ask' && x.a.kind === 'bot-change') {
    const parts = partsHTML(x.a.parts);
    return card(esc(x.a.title), esc(x.a.reason || ''), parts || `<div class="need-body"><pre class="nb">${esc(x.a.details)}</pre></div>`,
      `<button class="btn sm" data-need-no>Decline</button><button class="btn sm primary" data-need-yes>${esc(said(x.a.yes) || 'Approve')}</button>`, parts ? 'need-rows' : '');
  }
  // An action in a connected app: the server's title, whether its run still waits for the answer, and the action's
  // `rows`, drawn as a tool's facts: every row, and every value in full on an opened card. Without them, the
  // details as they were written. Rows that were cut short (the feed's entry) are not all a yes approves: the card
  // then shows `details` under them and offers no yes, until the list has brought the whole rows.
  // An action too long to show in full (`more` on the ask) has the rows that fit and one line that says so. It
  // cannot be allowed once, since that would send what the card does not show: Decline and "Always allow this
  // action" are left. Its `details` are as long as the action and are not drawn.
  if (x.kind === 'ask' && x.a.kind === 'connector-action') {
    const rows = ToolCard.rows(x.a.rows);
    const cut = !!rows && rowsCut(x.a);
    const long = !cut && tooLong(x.a);
    const details = () => (said(x.a.details) || !rows ? `<div class="need-body"><pre class="nb">${esc(x.a.details)}</pre></div>` : '');
    const body = long ? `${rows}<div class="need-meta">Too long to show in full.</div>` : rows ? `${rows}${cut ? details() : ''}` : details();
    return card(esc(x.a.title), esc(heldLine(x.a) || x.a.reason || ''), body,
      `<button class="btn sm" data-need-no>Decline</button>${cut ? '' : `<button class="btn sm" data-need-always>Always allow this action</button>${long ? '' : '<button class="btn sm primary" data-need-yes>Allow once</button>'}`}`, rows ? 'need-rows' : '');
  }
  // A tool the Chief asks to install for a bot: the server's own fields (tool-card.js), no wording from here.
  if (x.kind === 'ask' && ToolCard.is(x.a)) {
    const t = ToolCard.parts(x.a);
    return card(t.title, t.meta, t.body, t.actions, 'need-tool');
  }
  // A skill a bot wrote after it read content from others (`written`): the server's line as the title, and the
  // whole text a yes would save.
  if (x.kind === 'ask' && x.a.kind === 'skill' && x.a.written) return card(esc(said(x.a.text)), esc(said(x.a.reason)),
    `<div class="need-body"><pre class="nb">${esc(x.a.skill?.instructions)}</pre></div>`,
    `<button class="btn sm" data-need-no>Decline</button><button class="btn sm primary" data-need-yes>Approve</button>`);
  if (x.kind === 'ask') {
    const k = x.a.skill || {};
    const who = x.a.forBots?.length ? ` · for ${x.a.forBots.map((b) => b.name).join(', ')}` : '';
    return card(`Install the skill "${esc(k.name)}"?`, `${esc(x.a.url.replace(/^https?:\/\/(www\.)?/, ''))}${esc(who)}`,
      `<div class="need-body"><div class="nb">${esc(k.description || 'No description.')}${k.files > 1 ? ` (${k.files} files)` : ''}${k.exists ? ' It replaces your skill of the same name.' : ''}${x.a.reason ? `\n\nWhy: ${esc(x.a.reason)}` : ''}</div></div>`,
      `<button class="btn sm" data-need-no>Decline</button><button class="btn sm primary" data-need-yes>Install</button>`);
  }
  if (x.kind === 'tilesug') {
    const t = x.s.tile;
    return card(`Put “${esc(t.title)}” on your Board?`, esc(x.s.reason),
      (t.scripts || []).map((sc) => `<div class="need-body"><pre class="nb">${esc(sc)}</pre></div>`).join(''),
      `<button class="btn sm" data-need-no>No</button><button class="btn sm primary" data-need-yes>Add</button>`);
  }
  // A tile: one that waits for its first OK, or a change to the scripts of an approved one (tileCard).
  if (x.kind === 'tile') {
    const m = tileCard(x.t);
    const rows = Math.max(m.scripts.length, m.scriptsWas.length);
    return card(esc(m.title), esc(m.meta),
      changeBlocks(Array.from({ length: rows }, (_, i) => [m.scriptsWas[i] ?? null, m.scripts[i] ?? null, 'pre'])) + untilHTML(m.line),
      `<button class="btn sm" data-need-no>${esc(m.no)}</button><button class="btn sm primary" data-need-yes>${esc(m.yes)}</button>`, m.change ? 'need-changed' : '');
  }
  if (x.kind === 'suggestion') return card(`A plan for the Chief: ${esc(x.chat.title)}`, 'Nothing happens until you approve it', `<div class="need-body"><div class="nb">${esc(plain(x.chat.waiting.text))}</div></div>`,
    `<button class="link-btn need-link" data-need-open>Open chat</button><button class="btn sm" data-need-no>Decline</button><button class="btn sm primary" data-need-yes>Approve</button>`);
  if (x.kind === 'bitwarden') return card('Bitwarden is locked', "Bots can't use your saved logins until you unlock it.", '', `<button class="btn sm primary" data-need-open>Unlock</button>`);
  if (x.kind === 'pay') return card(`Pay on ${esc(x.r.site)}`, x.r.amount ? esc(x.r.amount) : '', '', `<button class="btn sm primary" data-need-open>Review</button>`);
  return card(`A login for ${esc(x.r.site)}`, x.r.reason ? esc(x.r.reason) : '', '', `<button class="btn sm primary" data-need-open>Add it</button>`);
}

// Words of the server's that a card draws: a string, trimmed. '' for anything else.
const said = (v) => (typeof v === 'string' ? v.trim() : '');

// The line of a change's card: the approved job or tile is the one that works meanwhile.
const RUNS_AS_APPROVED = 'Runs as you approved it until you answer.';
const kindWords = (script) => (script ? 'a script, no AI' : 'uses AI');
const NOTIFY_WORDS = { always: 'after every run', 'report-only': 'only when it has something to report' };
const changedBy = (by) => (by === 'chief' ? 'changed by the Chief' : by === 'bot' ? 'changed by itself' : 'changed');
// "<label>: <was> → <now>" for a setting a change changes, '' for one it leaves. words: a value in words.
const changedLine = (label, was, now, words) => (typeof now !== 'string' || now === was ? '' : was ? `${label}: ${words(was)} → ${words(now)}` : `${label}: ${words(now)}`);

// What the card and the dialog of a waiting job show (docs/api.md, "Decline" and "A change that waits").
// A job before its first OK: its name, and the no in the server's words where it sends them (`no`).
// An approved job with a change beside it (`change`): "<name>: a change", the approved schedule and the new one,
// and what goes beside what comes: `promptWas` is the approved text where the text changes, `scriptWas` the
// approved script where the script changes, each null where it stays. `script` is null for a job that runs none
// after the yes. `also`: what else changes, a line each. `line`: that the approved job runs meanwhile.
// `summary`: what changes in the proposer's one sentence (`change-summary`), '' where the server sends none. A
// closed card with one shows it in place of what goes and what comes, which are behind the click.
function jobCard(j) {
  const c = changeOf(j);
  if (!c) {
    const script = j.kind === 'script';
    const by = j.changedBy === 'bot' ? 'added by itself' : j.changedBy === 'chief' ? 'added by the Chief' : 'changed';
    return { change: false, summary: '', title: j.name, name: j.name, when: j.when, meta: `${j.when} · ${kindWords(script)} · ${by}`, isScript: script, script: script ? j.script || '' : null, scriptWas: null,
      prompt: j.prompt || '', promptWas: null, also: [], aiWhen: j.aiWhen, assessment: j.assessment || '', line: '', no: said(j.no) || 'Decline', yes: 'Approve' };
  }
  const text = (v, or) => (typeof v === 'string' ? v : or); // a field the server left out did not change
  const script = text(c.kind, j.kind) === 'script';
  const when = said(c.when) || j.when;
  const name = said(c.name) || j.name;
  const scriptNow = script ? text(c.script, j.script || '') : null;
  const scriptWas = j.kind === 'script' ? j.script || '' : null;
  const prompt = text(c.prompt, j.prompt || '');
  const aiWhen = script ? text(c.aiWhen, j.aiWhen) : null;
  return {
    change: true, title: `${j.name}: a change`, name, when, isScript: script, summary: said(c.summary),
    meta: [when === j.when ? j.when : `now ${j.when} → ${when}`, name === j.name ? '' : `renamed “${name}”`, kindWords(script), changedBy(c.by)].filter(Boolean).join(' · '),
    script: scriptNow, scriptWas: scriptWas === scriptNow ? null : scriptWas,
    prompt, promptWas: (j.prompt || '').trim() && j.prompt !== prompt ? j.prompt : null,
    also: [
      changedLine('Tells you', j.notify || 'report-only', c.notify, (v) => NOTIFY_WORDS[v] || v),
      changedLine('Asks the AI', j.kind === 'script' ? j.aiWhen : '', aiWhen, (v) => (AI_WHEN_TEXT[v] || v).toLowerCase()),
    ].filter(Boolean),
    aiWhen, assessment: text(c.assessment, j.assessment) || '', line: RUNS_AS_APPROVED, no: said(j.no) || 'Keep as it is', yes: said(j.yes) || 'Approve the change',
  };
}

// The same for a waiting tile: before its first OK with its scripts, and an approved tile with a change beside it,
// "<title>: a change", with the scripts it runs today (`scriptsWas`, where they differ) beside those it would run.
function tileCard(t) {
  const c = changeOf(t);
  const strings = (list) => (Array.isArray(list) ? list.filter((sc) => typeof sc === 'string') : null);
  if (!c) return { change: false, title: `Put “${t.title}” on your Board?`, meta: `${t.section ? `${t.section} · ` : ''}a script, no AI · ${t.changedBy === 'bot' ? 'added by itself' : 'added by the Chief'}`,
    scripts: tileScripts(t), scriptsWas: [], line: '', no: said(t.no) || 'Decline', yes: 'Approve' };
  const own = strings(t.scripts) || tileScripts(t);
  const scripts = strings(c.scripts) || tileScripts(c); // a change that lists none: those of the tile as proposed, never the approved ones
  const title = said(c.title);
  return {
    change: true, title: `${t.title}: a change`,
    meta: [t.section, title && title !== t.title ? `renamed “${title}”` : '', scripts.length ? 'a script, no AI' : '', changedBy(c.by)].filter(Boolean).join(' · '),
    scripts, scriptsWas: own.length === scripts.length && own.every((sc, i) => sc === scripts[i]) ? [] : own,
    line: RUNS_AS_APPROVED, no: said(t.no) || 'Keep as it is', yes: said(t.yes) || 'Approve the change',
  };
}

// One block of a card's body: a text (`div`) or a script (`pre`). Where it changes, what goes stands struck above
// what comes, in one block, so that a closed card shows the start of both. '' with neither.
function changeBlock(was, now, tag) {
  const part = (t, cls = '') => (t ? `<${tag} class="nb${cls}">${esc(t)}</${tag}>` : '');
  const old = goes(was, now);
  if (old === null) return now ? `<div class="need-body">${part(now)}</div>` : '';
  return `<div class="need-body need-change">${part(old, ' faint-strike')}${part(now)}</div>`;
}
// What a change takes away of a text or a script: the approved one where it differs, null where it stays.
const goes = (was, now) => (typeof was === 'string' && was && was !== now ? was : null);
// The blocks of a change's card, those that change first: a closed card shows its first block only, and that is
// never one that stays while another changes. pairs: [what it was, what it becomes, 'div' or 'pre'].
const changeBlocks = (pairs) => [...pairs.filter(([was, now]) => goes(was, now) !== null), ...pairs.filter(([was, now]) => goes(was, now) === null)]
  .map(([was, now, tag]) => changeBlock(was, now, tag)).join('');
// What else a change changes, a line each, above the blocks: whole on a closed card too.
const alsoHTML = (lines) => lines.map((l) => `<div class="need-meta need-also">${esc(l)}</div>`).join('');
// A change with its proposer's sentence (`summary`): the sentence, and behind the click what goes and what comes
// (`full`), which a closed card leaves out. Without a sentence the card is `full` alone, as before.
const summedHTML = (summary, full) => (summary ? `<div class="need-summary">${esc(summary)}</div><div class="need-meta need-more">Click to see the full change</div><div class="need-full">${full}</div>` : full);
const untilHTML = (line) => (line ? `<div class="need-meta need-until">${esc(line)}</div>` : '');

// What "Approve all" takes of the cards that wait (open: not answered on this page yet): AI jobs and changes to
// the shared memory, which a card shows in words. A job that runs a script, or would after its change, and a tile,
// which waits for a script, are left for their own cards and named in one line. A guarded memory change (one to
// what the owner said, and a forget) is left for its own card too, and is neither taken nor counted. `label`
// counts what it approves; with fewer than two there is no button, and no line.
function approveAll(open) {
  const takes = open.filter((x) => (x.kind === 'memory' && x.p.guarded !== true) || (x.kind === 'job' && !touchesScript(x.job)));
  const left = open.flatMap((x) => (x.kind === 'job' && touchesScript(x.job) ? [x.job.name] : x.kind === 'tile' ? [`“${x.t.title}”`] : []));
  const on = takes.length > 1;
  const line = !on || !left.length ? '' : left.length === 1 ? `${left[0]} runs a script: approve it on its card.`
    : `${left.slice(0, -1).join(', ')} and ${left[left.length - 1]} run scripts: approve them on their cards.`;
  return { takes: on ? takes : [], label: on ? `Approve ${takes.length}` : '', line };
}

// Whether the page asks before it sends a no: only for a job whose no removes it and whose button does not say
// so, as a server from before `decline-words` sends it. A button that reads the server's words asks nothing.
const asksBeforeNo = (x) => x.kind === 'job' && !changeOf(x.job) && !said(x.job.no);

// Who carries on after a yes, in the server's words (docs/api.md, "What follows a yes"): `text`, or `here` on a
// card that stands in the Chief chat it names. '' when the server says nothing: the yes changes the setting only.
function thenLine(then, here = null) {
  return (here && then?.chatId === here && said(then.here)) || said(then?.text);
}

// What changes on a bot (an ask's `parts`), in the server's order. A text that changes (it has `was`) is one
// block: what goes, struck, above what comes, so that a closed card shows the start of both. Anything else is a
// row of its label and what it becomes. One changed text is named by the card's title; several each stand under
// their label. '' without a part.
function partsHTML(parts) {
  const list = (Array.isArray(parts) ? parts : [])
    .map((p) => ({ label: ToolCard.text(p?.label), now: ToolCard.text(p?.now), was: typeof p?.was === 'string' ? said(p.was) : null }))
    .filter((p) => p.now || (p.was === null ? p.label : p.was)); // a row has a label or a value, a changed text something that goes or comes
  const texts = list.filter((p) => p.was !== null).length;
  const lines = (text, cls = '') => (text ? `<div class="nb${cls}">${esc(text)}</div>` : '');
  let html = '';
  let rows = [];
  const drawRows = () => { html += ToolCard.rows(rows); rows = []; };
  for (const p of list) {
    if (p.was === null) { rows.push({ label: p.label, value: p.now }); continue; }
    drawRows();
    html += (texts > 1 && p.label ? `<div class="need-meta need-part">${esc(p.label)}</div>` : '')
      + `<div class="need-body need-change">${lines(p.was, ' faint-strike')}${lines(p.now)}</div>`;
  }
  drawRows();
  return html;
}

// Whether the run of a connected-app action still waits for the owner's answer, as the line under the card's
// title: `held`, or since when it does not (`stoppedAt`). '' for an ask that says neither.
function heldLine(a) {
  const name = said(a.bot?.name) || 'The bot';
  if (a.held === true) return `${name} waits for your answer`;
  if (a.held === false && typeof a.stoppedAt === 'string' && Number.isFinite(Date.parse(a.stoppedAt))) return `${name} stopped waiting at ${msgTime(a.stoppedAt)}`;
  return '';
}

// Whether a row of a connected-app action was clipped (docs/api.md): `more: true` on the row, as the feed's short
// form marks it. Such a value is less than the action sends.
const rowsCut = (a) => Array.isArray(a?.rows) && a.rows.some((r) => r?.more === true);
// Whether the action is too long to show in full: `more: true` on the ask, beside its rows. The page draws its
// cards from the list (GET /api/asks), where that is what it says.
const tooLong = (a) => a?.more === true;

// What a card draws beyond its key that can change while it waits: the page draws it again when this does.
const needLive = (x, here = null) => [thenLine(x.then, here), x.group?.name, x.a?.held, x.a?.stoppedAt, rowsCut(x.a), tooLong(x.a), x.job?.no, x.t?.no, changeOf(x.job || x.t) || null, x.p?.title, x.p?.guarded, x.p?.text];

function renderNeeds() {
  const root = $('#view-needs');
  const items = needsItems();
  const open = items.filter((x) => !needsDone.has(x.key));
  const all = approveAll(open);
  // Draw again only when the cards change: the regular refresh would otherwise swallow clicks.
  const sig = JSON.stringify([open.map((x) => [x.key, x.job?.cron, x.job?.prompt, x.job?.script, x.chat?.waiting?.text, needLive(x)]), [...needsDone.keys()], all.label, all.line]);
  if (root.dataset.sig === sig) return;
  root.dataset.sig = sig;
  root.innerHTML = `
    <div class="section-head"><div>${BACK_BTN}<h1>Needs you</h1>${open.length ? '' : '<p>All done.</p>'}${all.line ? `<p class="needs-left">${esc(all.line)}</p>` : ''}</div>
      ${all.label ? `<button class="btn primary" id="needs-all">${esc(all.label)}</button>` : ''}</div>
    <div class="need-grid">${open.map((x) => needCardHTML(x)).join('')}${[...needsDone.values()].join('')}</div>`;
  wireNeedCards(root, items);
  const button = $('#needs-all', root);
  if (button) button.onclick = async () => { for (const x of all.takes) await decide(x, true, false); refreshNeeds(); };
}

// The buttons on need cards (the Needs you page, and the cards in a chat).
function wireNeedCards(root, items) {
  const byKey = new Map(items.map((x) => [x.key, x]));
  $$('.need-card[data-need]', root).forEach((el) => {
    const x = byKey.get(el.dataset.need);
    if (!x) return;
    const yes = $('[data-need-yes]', el), no = $('[data-need-no]', el), op = $('[data-need-open]', el), always = $('[data-need-always]', el);
    if (yes) yes.onclick = () => decide(x, true);
    if (always) always.onclick = () => { if (x.a?.kind === 'connector-action') { if (confirm('Allow this exact connector action for this bot in future runs, with any arguments?')) decide(x, true, true, true); return; } if (!touchesScript(x.job) || confirm(scriptWarning(x.bot.name, x.job.name))) decide(x, true, true, true); };
    if (no) no.onclick = () => { if (!asksBeforeNo(x) || confirm('Remove this job?')) decide(x, false); };
    if (op) op.onclick = () => openNeed(x);
    el.onclick = (e) => { if (e.target.closest('button')) return; el.classList.toggle('open'); el.classList.contains('open') ? needsOpen.add(x.key) : needsOpen.delete(x.key); };
  });
}

// ---------- approvals in the chat ----------

// What waits for your OK also shows at the bottom of the chat it belongs to: a bot's own jobs, permissions,
// skills, memory changes and logins in its chat; what the Chief set up or asked for in the Chief's.
// A tool is in both: the Chief asked for it, and it is installed for that bot. So is a change to a bot that the
// Chief asked for (`by: "chief"`): the card stands where the owner asked, and in the chat of the bot it changes.
const chatDecided = new Map(); // chat and key -> { scope, title, label }: decided here, shown as a faded line until you leave the chat
const fromChief = (x) => (x.kind === 'job' ? (changeOf(x.job) ? changeOf(x.job).by : x.job.changedBy) === 'chief'
  : x.kind === 'tile' ? (changeOf(x.t) ? changeOf(x.t).by : x.t.changedBy) !== 'bot'
  : x.kind === 'ask' ? x.a.kind === 'skill' && !x.a.botId
  : x.kind === 'login' || x.kind === 'pay' ? x.r.from === 'chief' : false);
const inBothChats = (x) => x.kind === 'ask' && (ToolCard.is(x.a) || (x.a.kind === 'bot-change' && x.a.by === 'chief'));
function chatNeeds(scope) {
  const suggested = scope === 'chief' ? [] : tileSuggestions().filter((x) => x.s.bot === scope); // a group's id is no bot's: none there
  return [...suggested, ...needsItems().filter((x) => {
    if (x.kind === 'bitwarden' || x.kind === 'suggestion') return false; // Bitwarden isn't a bot's; a plan already has its buttons in the chat
    if (x.group || String(scope).startsWith('group:')) return !!x.group && scope === `group:${x.group.id}`; // asked in a group: at the end of that group, and in no bot's own chat
    if (inBothChats(x)) return scope === 'chief' || x.a.botId === scope;
    if (scope === 'chief') return fromChief(x);
    const botId = x.kind === 'job' ? x.bot.id : x.kind === 'tile' ? x.t.bot : x.kind === 'memory' ? x.p.botId : x.kind === 'ask' ? x.a.botId : x.r.botId;
    return botId === scope && !fromChief(x);
  })];
}
// Tiles bots suggested for the Board, as cards (in the bot's chat; on the Board they're faded tiles). `then`: the
// bot that suggested one in a run carries on after Add (docs/api.md, "What a bot proposed").
const tileSuggestions = () => (state.dash?.suggestions || []).map((s) => ({ key: `tsug:${s.id}`, kind: 'tilesug', s, bot: botById(s.bot) || null, color: botById(s.bot)?.color || CHIEF_COLOR, then: s.then }));

// Put the cards (and what you decided here) at the end of a chat thread; scope: a bot's id, 'chief' or "group:<id>".
function updateChatNeeds(thread, scope) {
  if (!thread) return;
  for (const [k, d] of chatDecided) if (d.scope !== scope) chatDecided.delete(k); // you left that chat
  const items = chatNeeds(scope);
  // Whose messages these are: the Chief's chats share their cards, and one says "in this chat" only in its own;
  // a group's cards do not repeat the group's name.
  const here = scope === 'chief' ? thread.dataset.chat || null : String(scope).startsWith('group:') ? scope : null;
  const done = [...chatDecided.values()];
  let box = $('.chat-needs', thread);
  if (!box) { box = document.createElement('div'); box.className = 'chat-needs'; }
  if (box !== thread.lastElementChild) thread.append(box); // new messages go above it
  const sig = JSON.stringify([scope, items.map((x) => [x.key, x.job?.cron, x.job?.script, x.job?.prompt, needLive(x, here)]), done]);
  if (box.dataset.sig === sig) return;
  const atBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 160;
  box.dataset.sig = sig;
  box.dataset.scope = scope;
  box.innerHTML = done.map((d) => `<div class="chat-decided">${esc(d.title)} · ${esc(d.label)}</div>`).join('') + items.map((x) => needCardHTML(x, here)).join('');
  wireNeedCards(box, items);
  if (atBottom) thread.scrollTop = thread.scrollHeight;
}

// "Always approve" a script job: its later changes run without you seeing them, so say what that means first.
const scriptWarning = (bot, job) => `Always approve "${job}" from ${bot}?\n\nIt's a script: it runs as commands on this computer with your permissions, without AI and without the bot's tool limits. If a web page or email ever tricks ${bot} into changing it, the new version would run on its schedule without you seeing it first.\n\nYou can take this back in ${bot}'s settings.`;

// A job in one line: when it runs and what kind it is.
const jobLine = (j) => `${j.when} · ${j.kind === 'script' ? 'a script, no AI' : 'uses AI'}`;

// Approve or decline one card; it fades and says so. always: approve the job and trust its later changes.
// After a yes the server may say who carries on (`carriesOn` in its answer, docs/api.md "What follows a yes"):
// its words follow the page's own, "Allowed · it carries on".
async function decide(x, yes, redraw = true, always = false) {
  let answer = null; // the server's: what a yes starts (a job, an ask, a tile, a suggested tile), and the words a card then reads
  try {
    if (x.kind === 'job') answer = await api(`/bots/${x.bot.id}/jobs/${x.job.id}/approve`, { method: 'POST', body: { approve: yes, always } });
    else if (x.kind === 'ask') answer = await api(`/asks/${x.a.id}`, { method: 'POST', body: { yes, always } });
    else if (x.kind === 'tile') { answer = await api(`/dashboard/tiles/${x.t.id}/approve`, { method: 'POST', body: { approve: yes } }); loadDash(true); }
    else if (x.kind === 'tilesug') { answer = await api(`/dashboard/suggestions/${x.s.id}`, { method: 'POST', body: { add: yes } }); loadDash(true); }
    // A bot's plan: Approve answers it in its Chief chat, like the button there; the Chief works on it in the background.
    else if (x.kind === 'suggestion') await (yes ? api(`/chief/chats/${x.chat.id}/messages`, { method: 'POST', body: { text: PLAN_APPROVAL } }) : api(`/chief/chats/${x.chat.id}/dismiss`, { method: 'POST' }));
    else answer = await api(`/memory/pending/${x.p.id}`, { method: 'POST', body: { approve: yes } });
  } catch (e) { toast(e.message, true); return; }
  const word = answeredWord(x, yes, always, answer);
  const carries = yes && typeof answer?.carriesOn?.text === 'string' ? answer.carriesOn.text.trim() : '';
  const label = carries ? `${word} · ${carries}` : word;
  // The same card can be on the Needs you page and in a chat.
  $$(`.need-card[data-need="${CSS.escape(x.key)}"]`).forEach((el) => {
    el.classList.add('done');
    $('.need-actions', el).innerHTML = `<span class="muted">${esc(label)}</span>`; // the server's words are text
    $('.need-then', el)?.remove(); // "when you allow it" is answered: the label says what follows now
    $('.need-until', el)?.remove(); // and so is "until you answer"
    const chat = el.closest('.chat-needs');
    if (chat) chatDecided.set(`${chat.dataset.scope} ${x.key}`, { scope: chat.dataset.scope, title: $('.need-title', el).textContent, label }); // a tool's card is in two chats
    else needsDone.set(x.key, el.outerHTML);
  });
  if (redraw) refreshNeeds();
}

// The word a card reads after its answer, before who carries on. The page's own where it has one; for a job and a
// tile the server's (`text` of the answer: "Declined and removed", "Kept as it was: …", "Changed: …") in place of
// "Declined", and of "Approved" on a change. A memory change always reads the server's: "Forgotten", "Kept".
function answeredWord(x, yes, always, answer) {
  if (always) return 'Always approved';
  if (x.kind === 'tilesug') return yes ? 'On your Board' : 'Not added';
  const waits = x.kind === 'job' ? x.job : x.kind === 'tile' ? x.t : null;
  const servers = x.kind === 'memory' || (waits && (!yes || changeOf(waits))) ? said(answer?.text) : '';
  if (servers) return servers;
  if (!yes) return 'Declined';
  if (x.kind === 'ask') return ToolCard.is(x.a) ? 'Installing' : x.a.kind === 'skill' ? (x.a.written ? 'Approved' : 'Installed') : 'Allowed';
  return x.kind === 'suggestion' ? 'Approved · the Chief is on it' : 'Approved';
}

async function refreshNeeds() {
  state.memPending = await api(MEMORY_WAITS).catch(() => state.memPending);
  state.asks = await api('/asks').catch(() => state.asks);
  await refresh();
}

// ---------- the Board ----------

// Tiles the Chief put together (lib/dashboard.js): switches, buttons, values, lists and notes, or tiles
// built from blocks. The server sends each tile's look filled in (dot, face, panel, tap); this only draws it.
// Values are read again while this page is open; new ones arrive on the live feed.
const tileScripts = (t) => [t.read, t.do, t.turnOn, t.turnOff, ...Object.values(t.reads || {}), ...Object.values(t.actions || {})].filter((x) => x?.type === 'script').map((x) => x.script);
// A group has no bot of its own: it takes the colour of the bot whose tiles are in it (the Chief's when they're mixed).
const tileColor = (t) => t.color || botById(t.bot || groupBot(t))?.color || CHIEF_COLOR;
function groupBot(t) {
  if (t.kind !== 'group') return null;
  const owners = new Set((state.dash?.tiles || []).filter((x) => x.parent === t.id && x.bot).map((x) => x.bot));
  return owners.size === 1 ? [...owners][0] : null;
}
// The tiles of the Board that the list's strip and the keypad's line show: those at its top, approved. A tile's mark
// is its dot (filled when a switch is on).
const boardTiles = () => (state.dash?.tiles || []).filter((t) => !t.parent && t.approved !== false);
const tileMark = (t) => { const dot = t.look?.dot; return `<i${dot && dot.filled !== true ? ' class="off"' : ''} style="--c:${tintOf(dot?.color, t)}"></i>`; };
const BOARD_EMPTY = '<span class="none"><b>Board</b> · Nothing on it yet</span>';
// The strip at the top of the list: each tile's dot and name, and a value's value (a switch's dot is filled
// when it's on). As many as fit; a tap opens the Board. With no tile to show, it says so beside the Board's
// name. Not there until the Board has loaded.
function dashStrip() {
  if (!state.dash) return '';
  const tile = (t) => `<span class="t">${tileMark(t)}${esc(t.title)}${t.look?.short ? ` <b>${esc(t.look.short)}</b>` : ''}</span>`;
  return `<button class="dash-strip ${state.view === 'dashboard' ? 'active' : ''}" data-contact="dashboard" title="Board">
    <svg class="board-ico" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/></svg>
    <span class="tiles">${boardTiles().map(tile).join('') || BOARD_EMPTY}</span><span class="more">›</span></button>`;
}
// The tiles that don't fit whole are left out, not cut off.
function fitStrip() {
  const row = $('#contacts .dash-strip .tiles');
  if (!row) return;
  const ts = $$('.t', row);
  ts.forEach((t) => (t.hidden = false));
  const end = row.getBoundingClientRect().right;
  let full = false;
  for (const t of ts) if (full || (full = t.getBoundingClientRect().right > end + 0.5)) t.hidden = true;
}
new ResizeObserver(() => fitStrip()).observe($('#contacts')); // a wider or narrower list, or the list shown again

let dashLoading = null;
function loadDash(quiet = false) {
  if (dashLoading) return dashLoading;
  dashLoading = api(quiet ? '/dashboard?quiet' : '/dashboard/refresh', quiet ? {} : { method: 'POST' }).then((d) => { state.dash = d; renderContacts(); showNeeds(); if (state.view === 'dashboard') renderDashboard(); })
    .catch(() => {}).finally(() => { dashLoading = null; });
  return dashLoading;
}
// While it's on screen, the stale tiles are read again every little while.
setInterval(() => { if (state.view === 'dashboard' && !document.hidden) loadDash(); }, 15_000);

const LEVEL = { ok: 'var(--ok)', warn: 'var(--warn)', bad: 'var(--err)' };
const TINT = { ...LEVEL, faint: 'var(--faint)', muted: 'var(--muted)', text: 'var(--text)' };
// Words take ok's and warn's text shades, which pass 4.5:1 where the dots' colours don't.
const TEXT_TINT = { ...TINT, ok: 'var(--ok-text)', warn: 'var(--warn-text)' };
// A colour from a tile's look: "#rrggbb", a theme name, or none (the tile's own colour).
const tintOf = (c, t, words = false) => (c && /^#[0-9a-f]{6}$/i.test(c) ? c : (words ? TEXT_TINT : TINT)[c] || esc(tileColor(t)));
const tapped = new Map(); // tile id → "Asked" and the like, for a moment after a tap
const popped = new Set(); // tiles whose tap just worked: the card pops once, no words

const dotHTML = (d, t) => (d ? `<i class="tile-dot ${d.big ? 'big' : ''} ${d.filled === false ? 'off' : d.filled == null ? 'unknown' : ''}" style="--c:${tintOf(d.color, t)}"></i>` : '');

// A tile's blocks (see lib/tile-blocks.js). where: "face" (on the tile) or "panel" (its pop-up).
function blocksHTML(list, t, where) {
  return (list || []).map((b) => blockHTML(b, t, where)).join('');
}
function blockHTML(b, t, where) {
  const faint = '<div class="faint">·</div>';
  const ctl = (kind) => `data-ctl="${esc(b.key)}" data-ctl-kind="${kind}"`;
  switch (b.type) {
    case 'text':
      if (!b.text) return faint;
      if (b.markdown) return `<div class="tile-note md ${b.lines ? 'folded' : ''} ${b.size || ''} ${b.muted ? 'muted' : ''}" ${b.lines ? `style="--lines:${b.lines}"` : ''}>${md(b.text)}</div>`;
      return `<div class="b-text ${b.size || ''} ${b.muted ? 'muted' : ''} ${b.lines ? 'clamp' : ''}" ${b.lines ? `style="--lines:${b.lines}"` : ''}>${esc(b.text)}</div>`;
    case 'value':
      return b.text ? `<div class="tile-val" ${b.color ? `style="color:${tintOf(b.color, t, true)}"` : ''}>${esc(b.text)}${b.unit ? `<span class="unit">${esc(b.unit)}</span>` : ''}</div>` : `<div class="tile-val">${faint}</div>`;
    case 'dot':
      return `<span class="b-dot">${dotHTML(b, t)}${b.label ? `<span>${esc(b.label)}</span>` : ''}</span>`;
    case 'list':
      return b.items.length ? `<ul class="tile-list">${b.items.slice(0, b.max).map((l) => `<li>${esc(l)}</li>`).join('')}${b.items.length > b.max ? '<li class="faint">…</li>' : ''}</ul>` : faint;
    case 'progress':
      return `<div class="b-progress"><div class="bar"><i style="width:${Math.round((b.ratio ?? 0) * 100)}%;--c:${tintOf(b.color, t)}"></i></div>${b.text ? `<span>${esc(b.text)}</span>` : ''}</div>`;
    case 'gauge': {
      const arc = 'M 8 48 A 40 40 0 0 1 88 48';
      return `<div class="b-gauge"><svg viewBox="0 0 96 54" aria-hidden="true"><path d="${arc}" class="track" pathLength="100"/><path d="${arc}" class="fill" pathLength="100" stroke-dasharray="${Math.round((b.ratio ?? 0) * 100)} 100" style="--c:${tintOf(b.color, t)}"/></svg><span>${esc(b.text || '·')}</span></div>`;
    }
    case 'chart': {
      const pts = b.points || [];
      if (pts.length < 2) return `<div class="b-chart">${b.text ? `<span>${esc(b.text)}</span>` : ''}${faint}</div>`;
      const lo = Math.min(...pts), hi = Math.max(...pts), span = hi - lo || 1;
      const line = pts.map((v, i) => `${((i / (pts.length - 1)) * 100).toFixed(2)},${(28 - ((v - lo) / span) * 26).toFixed(2)}`).join(' ');
      return `<div class="b-chart">${b.text ? `<span>${esc(b.text)}</span>` : ''}<svg viewBox="0 0 100 30" preserveAspectRatio="none" aria-hidden="true"><polyline points="${line}" style="--c:${tintOf(b.color, t)}" vector-effect="non-scaling-stroke"/></svg></div>`;
    }
    case 'image':
      return `<img class="b-img ${b.height || 'normal'} ${b.fit || 'cover'}" src="/api${esc(b.src)}" alt="" loading="lazy" draggable="false">`;
    case 'chat': {
      const bot = botById(t.bot);
      return bot ? `<button class="link-btn tile-chat" data-tile-chat>${b.label ? esc(b.label) : botLabel(bot)} ›</button>` : '';
    }
    case 'switch':
      return `<label class="b-switch" data-ctl-wrap>${b.label ? `<span>${esc(b.label)}</span>` : ''}<span class="switch"><input type="checkbox" ${b.on ? 'checked' : ''} ${ctl('switch')} aria-label="${esc(b.label || t.title)}"><span></span></span></label>`;
    case 'button':
      return `<button class="btn sm b-btn" ${ctl('button')}>${esc(b.label)}</button>`;
    case 'slider': {
      const v = b.value ?? b.min;
      return `<label class="b-slider ${b.value == null ? 'unset' : ''}" data-ctl-wrap><span class="lbl">${b.label ? `<span>${esc(b.label)}</span>` : ''}<b data-show>${b.value == null ? '·' : esc(sliderText(b, b.value))}</b></span><input type="range" min="${b.min}" max="${b.max}" step="${b.step}" value="${v}" ${ctl('slider')} aria-label="${esc(b.label || t.title)}"></label>`;
    }
    case 'color':
      if (where === 'face') return `<button class="b-swatch" ${ctl('color-open')} style="--c:${b.value || 'var(--line-2)'}" aria-label="${esc(b.label || 'Colour')}"></button>`;
      return `<div class="b-color" data-ctl-wrap>${b.label ? `<span class="lbl">${esc(b.label)}</span>` : ''}<div class="wheel" ${ctl('color')} role="slider" aria-label="${esc(b.label || 'Colour')}" tabindex="0">${b.value ? `<i class="mark" style="${wheelSpot(b.value)};--c:${b.value}"></i>` : ''}</div></div>`;
    case 'choice':
      return `<div class="b-choice" data-ctl-wrap>${b.label ? `<span class="lbl">${esc(b.label)}</span>` : ''}<div class="seg">${b.options.map((o) => `<button class="${String(o.value) === String(b.value) ? 'on' : ''}" ${ctl('choice')} data-v="${esc(JSON.stringify(o.value))}">${esc(o.label)}</button>`).join('')}</div></div>`;
    case 'row':
      return `<div class="b-row">${blocksHTML(b.blocks, t, where)}</div>`;
    case 'column':
      return `<div class="b-col">${blocksHTML(b.blocks, t, where)}</div>`;
    default:
      return '';
  }
}
const fmtNum = (n) => String(Math.round(n * 100) / 100);
const sliderText = (b, v) => (b.percent ? `${Math.round(((v - b.min) / (b.max - b.min)) * 100)} %` : `${fmtNum(v)}${b.unit ? ` ${b.unit}` : ''}`);

// The colour wheel: hue around it (red at the right, going clockwise), white in the middle. Brightness is a slider of its own.
function hsvHex(h, s) {
  const f = (n) => { const k = (n + h / 60) % 6; return Math.round(255 * (1 - s * Math.max(0, Math.min(k, 4 - k, 1)))); };
  return `#${[f(5), f(3), f(1)].map((x) => x.toString(16).padStart(2, '0')).join('')}`;
}
function hexHs(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  let h = 0;
  if (d) h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0 };
}
function wheelSpot(hex) {
  const { h, s } = hexHs(hex);
  const a = (h * Math.PI) / 180;
  return `left:${(50 + Math.cos(a) * s * 50).toFixed(1)}%;top:${(50 + Math.sin(a) * s * 50).toFixed(1)}%`;
}

function tileHTML(t, waiting) {
  const look = t.look || { dot: { filled: true }, face: [], tap: 'none' };
  let dot = dotHTML(look.dot, t);
  let body = blocksHTML(look.face, t, 'face');
  // A group: one dot per tile inside (filled when on, in its own colour).
  if (t.kind === 'group') {
    const inside = (state.dash?.tiles || []).filter((x) => x.parent === t.id);
    dot = '';
    body = `<div class="group-dots">${inside.map((x) => {
      const d = x.look?.dot;
      return `<i class="${d && d.filled !== true ? 'off' : ''}" style="--c:${tintOf(d?.color, x)}"></i>`;
    }).join('') || '<span class="faint">·</span>'}</div>`;
  }
  const note = waiting ? 'Waiting for your OK' : tapped.get(t.id) || (t.error ? "Couldn't update" : '');
  const pressed = look.tap === 'toggle' ? ` aria-pressed="${look.dot?.filled === true}"` : '';
  const open = t.kind === 'group' && openGroups.has(t.id);
  const size = t.size || (t.wide ? 'wide' : 'small');
  return `<div role="button" tabindex="0" class="tile kind-${t.kind} size-${size} ${look.dot?.big ? 'big-dot' : ''} ${waiting ? 'waiting' : ''} ${open ? 'open' : ''} ${popped.has(t.id) ? 'pop' : ''}" data-tile="${esc(t.id)}"${pressed}${t.kind === 'group' ? ` aria-expanded="${open}"` : ''} title="${esc(t.error || '')}">
    <div class="tile-head">${dot}<span class="tile-title">${esc(t.title)}</span></div>
    ${body}
    ${note ? `<div class="tile-sub">${esc(note)}</div>` : ''}
  </div>`;
}

function renderDashboard() {
  const root = $('#view-dashboard');
  const d = state.dash;
  if (!d) { root.innerHTML = '<div class="empty">Loading…</div>'; return; }
  if (tileDrag) return; // redrawing would drop the tile you're dragging
  if (ctlHeld) { ctlHeld.later = true; return; } // nor while a slider or the colour wheel is in your hand
  renderPanel();
  const waiting = new Set((d.pending || []).map((t) => t.id));
  const sig = JSON.stringify([d, [...tapped], [...popped], [...openGroups], state.bots.map((b) => b.color)]);
  if (root.dataset.sig === sig) return;
  root.dataset.sig = sig;
  const loose = d.tiles.filter((t) => !t.parent);
  const groups = [['', loose.filter((t) => !t.section)], ...d.sections.map((s) => [s, loose.filter((t) => t.section === s)])].filter(([, ts]) => ts.length);
  // A group tile, and when it's open, its tiles right below it across the whole width.
  const withInside = (t) => tileHTML(t, waiting.has(t.id)) + (t.kind === 'group' && openGroups.has(t.id)
    ? `<div class="dash-inside"><div class="dash-grid" data-section="${esc(t.section)}" data-parent="${esc(t.id)}">${d.tiles.filter((x) => x.parent === t.id).map((x) => tileHTML(x, waiting.has(x.id))).join('') || '<div class="faint">Nothing in it yet.</div>'}</div></div>` : '');
  root.innerHTML = `
    <div class="section-head"><div>${BACK_BTN}<h1>Board</h1></div></div>
    ${d.tiles.length ? '' : `<div class="dash-empty">
      <p>Tiles for the things you use most: a light switch, the temperature, a shopping list, a morning summary.</p>
      <p>Nothing is on it yet. Tell the Chief or any bot, for example: <i>“Put a shopping list on my board.”</i></p>
    </div>`}
    ${groups.map(([name, ts]) => `${name ? `<h3 class="dash-sec">${esc(name)}</h3>` : ''}<div class="dash-grid" data-section="${esc(name)}">${ts.map(withInside).join('')}</div>`).join('')}
    ${(d.suggestions || []).length ? `<h3 class="dash-sec">Suggested</h3><div class="dash-grid">${d.suggestions.map(suggestedHTML).join('')}</div>` : ''}`;
  $$('[data-tile]', root).forEach((el) => {
    const t = d.tiles.find((x) => x.id === el.dataset.tile);
    wireTile(el, t, waiting.has(el.dataset.tile));
    if (t && !waiting.has(t.id)) wireControls(el, t);
  });
  wireTileDrags(root);
  // A folded note that has more to it fades out at the bottom.
  $$('.tile-note.folded', root).forEach((el) => el.classList.toggle('more', el.scrollHeight > el.clientHeight + 2));
  $$('[data-sug]', root).forEach((el) => {
    const x = tileSuggestions().find((y) => y.s.id === el.dataset.sug);
    $('[data-sug-add]', el).onclick = () => answerSuggestion(x, true);
    $('[data-sug-no]', el).onclick = () => answerSuggestion(x, false);
  });
}

// A tile a bot suggested: faded, who and why, Add or ✕ (its script, if it has one, opens under it).
function suggestedHTML(s) {
  const t = s.tile;
  const b = botById(s.bot);
  return `<div class="tile suggested ${t.wide ? 'wide' : ''}" data-sug="${esc(s.id)}">
    <div class="tile-head"><i class="tile-dot" style="--c:${esc(b?.color || CHIEF_COLOR)}"></i><span class="tile-title">${esc(t.title)}</span></div>
    <div class="tile-why">${b ? `<b>${esc(b.name)}</b> · ` : ''}${esc(s.reason)}</div>
    ${(t.scripts || []).length ? `<details class="tile-script"><summary>Its script</summary>${t.scripts.map((sc) => `<pre>${esc(sc)}</pre>`).join('')}</details>` : ''}
    <div class="tile-actions"><button class="btn sm" data-sug-no aria-label="Not this one">✕</button><button class="btn sm primary" data-sug-add>Add</button></div>
  </div>`;
}
async function answerSuggestion(x, add) {
  if (!x) return;
  try { await api(`/dashboard/suggestions/${x.s.id}`, { method: 'POST', body: { add } }); } catch (e) { toast(e.message, true); }
  loadDash(true);
}

// A tap does the tile's thing; a long press (or right-click) offers to remove it.
function wireTile(el, t, waiting) {
  if (!t) return;
  let timer = null, long = false;
  const cancel = () => clearTimeout(timer);
  el.onpointerdown = (e) => { long = false; if (e.pointerType === 'touch') timer = setTimeout(() => { long = true; removeTile(t); }, 550); }; // a mouse drags instead
  el.onpointerup = cancel;
  el.onpointerleave = cancel;
  el.onpointercancel = cancel;
  el.oncontextmenu = (e) => { if (e.target.closest('[data-ctl-wrap], [data-ctl]')) return; e.preventDefault(); cancel(); if (!long) removeTile(t); long = true; };
  el.onkeydown = (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === el) { e.preventDefault(); el.click(); } };
  el.onclick = (e) => {
    if (e.target.closest('[data-ctl-wrap], [data-ctl], [data-tile-chat]')) return; // a control on the tile does its own thing
    if (long) { long = false; return; }
    if (t.kind === 'group') { openGroups.has(t.id) ? openGroups.delete(t.id) : openGroups.add(t.id); saveOpenGroups(); return renderDashboard(); }
    waiting ? setView('needs') : tapTile(t);
  };
}

// ---------- moving tiles by dragging ----------
// The tile moves live among the others while you drag (they make room); letting go saves its heading,
// its group and its place. Held over a closed group tile, it goes into that group.
const TILE_DRAG = 'application/x-botdot-tile';
let tileDrag = null; // { id, el, isGroup, into }
function wireTileDrags(root) {
  $$('[data-tile]', root).forEach((el) => {
    el.draggable = true;
    el.ondragstart = (e) => {
      const t = state.dash.tiles.find((x) => x.id === el.dataset.tile);
      e.dataTransfer.setData(TILE_DRAG, el.dataset.tile);
      e.dataTransfer.effectAllowed = 'move';
      tileDrag = { id: el.dataset.tile, el, isGroup: t?.kind === 'group', into: null };
      setTimeout(() => el.classList.add('drag-ghost'));
    };
    el.ondragend = () => { el.classList.remove('drag-ghost'); $$('.tile.drop-into').forEach((x) => x.classList.remove('drop-into')); if (tileDrag && !tileDrag.dropped) { tileDrag = null; delete root.dataset.sig; renderDashboard(); } };
    el.ondragover = (e) => {
      if (!tileDrag || !e.dataTransfer.types.includes(TILE_DRAG) || el === tileDrag.el) return;
      e.preventDefault();
      e.stopPropagation();
      const r = el.getBoundingClientRect();
      // Over the middle of a closed group: into it.
      const isGroup = el.classList.contains('kind-group');
      const middle = Math.abs(e.clientX - (r.left + r.width / 2)) < r.width / 4;
      $$('.tile.drop-into').forEach((x) => x !== el && x.classList.remove('drop-into'));
      if (isGroup && !tileDrag.isGroup && middle && !openGroups.has(el.dataset.tile)) { el.classList.add('drop-into'); tileDrag.into = el.dataset.tile; return; }
      el.classList.remove('drop-into');
      tileDrag.into = null;
      const grid = el.parentElement;
      if (tileDrag.isGroup && grid.dataset.parent) return; // a group stays out of groups
      const after = e.clientX > r.left + r.width / 2;
      let spot = after ? el.nextElementSibling : el;
      if (after && spot?.classList.contains('dash-inside')) spot = spot.nextElementSibling; // an open group keeps its tiles right below it
      if (spot === tileDrag.el) return;
      grid.insertBefore(tileDrag.el, spot);
      moveInsideAlong();
    };
    el.ondrop = (e) => dropTile(e);
  });
  // Over the empty part of a grid (or of an open group): at its end.
  $$('.dash-grid[data-section]', root).forEach((grid) => {
    grid.ondragover = (e) => {
      if (!tileDrag || !e.dataTransfer.types.includes(TILE_DRAG)) return;
      if (tileDrag.isGroup && grid.dataset.parent) return;
      e.preventDefault();
      if (e.target === grid && grid.lastElementChild !== tileDrag.el) { grid.append(tileDrag.el); moveInsideAlong(); }
    };
    grid.ondrop = (e) => dropTile(e);
  });
}
// A dragged open group takes its tiles' block along, right after it.
function moveInsideAlong() {
  const el = tileDrag?.el;
  if (!el?.classList.contains('open')) return;
  const inside = $$('.dash-inside').find((x) => x.querySelector(`[data-parent="${CSS.escape(el.dataset.tile)}"]`));
  if (inside && el.nextElementSibling !== inside) el.after(inside);
}
async function dropTile(e) {
  e.preventDefault();
  e.stopPropagation();
  const drag = tileDrag;
  if (!drag || drag.dropped) return;
  drag.dropped = true;
  let body;
  if (drag.into) body = { parent: drag.into };
  else {
    const grid = drag.el.parentElement;
    let next = drag.el.nextElementSibling;
    while (next && !next.dataset?.tile) next = next.nextElementSibling;
    body = { section: grid?.dataset.section || '', parent: grid?.dataset.parent || null, before: next?.dataset.tile || null };
  }
  try { await api(`/dashboard/tiles/${drag.id}/move`, { method: 'POST', body }); } catch (err) { toast(err.message, true); }
  tileDrag = null;
  delete $('#view-dashboard').dataset.sig;
  await loadDash(true);
  renderDashboard();
}

// A tile's panel: its pop-up in the middle (the Board stays as it is). A note or list shows all of it
// there, with a way into its bot's chat; a light its on/off, brightness and colour wheel. It follows the tile's new values.
let panelOpen = null; // { id, m, sig }
function openTilePanel(t, only = null) {
  const m = openModal(`
    <div class="modal-head"><h2>${esc(t.title)}</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
    <div class="modal-body tile-full tile-panel"></div>`);
  m.classList.add('tile-pop'); // the one dialog every pop-up uses: narrow only for this one
  panelOpen = { id: t.id, m, only, sig: null };
  // A click beside it closes it (the dialog's own backdrop; its padding counts as inside).
  const away = (e) => {
    if (e.target !== m) return;
    const r = m.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) m.close();
  };
  m.addEventListener('click', away);
  m.addEventListener('close', () => { m.classList.remove('tile-pop'); m.removeEventListener('click', away); panelOpen = null; }, { once: true });
  renderPanel();
}
function renderPanel() {
  if (!panelOpen || ctlHeld) return;
  const t = state.dash?.tiles.find((x) => x.id === panelOpen.id);
  if (!t) { panelOpen.m.close(); return; }
  const list = panelOpen.only ? [findBlock(t.look?.face, panelOpen.only)].filter(Boolean) : t.look?.panel;
  const sig = JSON.stringify(list);
  if (sig === panelOpen.sig) return;
  panelOpen.sig = sig;
  const body = $('.tile-panel', panelOpen.m);
  body.innerHTML = blocksHTML(list, t, 'panel') || '<div class="faint">·</div>';
  wireControls(body, t);
  const link = $('[data-tile-chat]', body);
  if (link) link.onclick = () => { panelOpen?.m.close(); setView('bot', t.bot); };
}
function findBlock(list, key) {
  for (const b of list || []) { if (b.key === key) return b; const x = findBlock(b.blocks, key); if (x) return x; }
  return null;
}

// ---------- a tile's controls: switches, buttons, sliders, the colour wheel, choices ----------
let ctlHeld = null; // a slider or the wheel being dragged: the page isn't redrawn under your finger
function holdCtl(tileEl) {
  ctlHeld = { later: false, tileEl };
  if (tileEl) tileEl.draggable = false; // a slider moves, not the tile
  const up = () => {
    window.removeEventListener('pointerup', up);
    window.removeEventListener('pointercancel', up);
    setTimeout(() => {
      const later = ctlHeld?.later;
      if (ctlHeld?.tileEl) ctlHeld.tileEl.draggable = true;
      ctlHeld = null;
      if (later) { delete $('#view-dashboard').dataset.sig; renderDashboard(); }
      renderPanel();
    }, 0);
  };
  window.addEventListener('pointerup', up);
  window.addEventListener('pointercancel', up);
}

function wireControls(root, t) {
  const tileEl = root.closest?.('[data-tile]') || (root.dataset?.tile ? root : null);
  $$('[data-ctl-wrap], [data-ctl], [data-tile-chat]', root).forEach((el) => {
    el.addEventListener('pointerdown', (e) => { e.stopPropagation(); holdCtl(tileEl); });
    el.addEventListener('dragstart', (e) => { e.preventDefault(); e.stopPropagation(); });
  });
  const chat = $('[data-tile-chat]', root);
  if (chat && tileEl) chat.onclick = (e) => { e.stopPropagation(); setView('bot', t.bot); };
  $$('[data-ctl]', root).forEach((el) => {
    const key = el.dataset.ctl;
    switch (el.dataset.ctlKind) {
      case 'switch':
        el.onchange = () => sendCtl(t, key, el.checked);
        break;
      case 'button':
        el.onclick = (e) => { e.stopPropagation(); sendCtl(t, key, null, { pop: true }); };
        break;
      case 'slider': {
        const show = $('[data-show]', el.closest('.b-slider'));
        const b = findBlock(t.look?.panel, key) || findBlock(t.look?.face, key) || {};
        el.oninput = () => { el.closest('.b-slider').classList.remove('unset'); show.textContent = sliderText(b, Number(el.value)); };
        el.onchange = () => sendCtl(t, key, Number(el.value));
        break;
      }
      case 'choice':
        el.onclick = (e) => {
          e.stopPropagation();
          $$('button', el.parentElement).forEach((b) => b.classList.toggle('on', b === el));
          sendCtl(t, key, JSON.parse(el.dataset.v));
        };
        break;
      case 'color-open':
        el.onclick = (e) => { e.stopPropagation(); openTilePanel(t, key); };
        break;
      case 'color':
        wireWheel(el, (hex, done) => sendCtl(t, key, hex, { quiet: !done }));
        break;
      default:
    }
  });
}

// Drag on the wheel: the mark follows, the light follows a few times a second, and once more when you let go.
function wireWheel(el, send) {
  let last = 0, timer = null, hex = null;
  const pick = (e) => {
    const r = el.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width - 0.5, y = (e.clientY - r.top) / r.height - 0.5;
    const sat = Math.min(Math.hypot(x, y) * 2, 1);
    hex = hsvHex(((Math.atan2(y, x) * 180) / Math.PI + 360) % 360, sat);
    let mark = $('.mark', el);
    if (!mark) { mark = document.createElement('i'); mark.className = 'mark'; el.append(mark); }
    mark.setAttribute('style', `${wheelSpot(hex)};--c:${hex}`);
    const now = Date.now();
    clearTimeout(timer);
    if (now - last > 350) { last = now; send(hex, false); } else timer = setTimeout(() => { last = Date.now(); send(hex, false); }, 350);
  };
  el.onpointerdown = (e) => { el.setPointerCapture(e.pointerId); pick(e); el.onpointermove = pick; };
  el.onpointerup = () => { el.onpointermove = null; clearTimeout(timer); if (hex) send(hex, true); };
  el.onpointercancel = el.onpointerup;
}

async function sendCtl(t, key, value, { pop: popIt = false, quiet = false } = {}) {
  try {
    const r = await api(`/dashboard/tiles/${t.id}/act`, { method: 'POST', body: { block: key, value } });
    if (quiet) return; // the wheel mid-drag: the last one updates the page
    state.dash.tiles = state.dash.tiles.map((x) => (x.id === t.id ? { ...x, ...r } : x));
    if (popIt) { popped.add(t.id); setTimeout(() => { popped.delete(t.id); renderDashboard(); }, 500); }
    renderDashboard();
    renderPanel();
  } catch (e) {
    toast(e.message, true);
    loadDash(true);
  }
}

// Groups you opened stay open (in this browser).
const openGroups = new Set((() => { try { return JSON.parse(localStorage.getItem('dash-open') || '[]'); } catch { return []; } })());
function saveOpenGroups() { try { localStorage.setItem('dash-open', JSON.stringify([...openGroups])); } catch { /* private window */ } }

function removeTile(t) {
  const inside = t.kind === 'group' ? (state.dash?.tiles || []).filter((x) => x.parent === t.id) : [];
  if (inside.length) return removeGroup(t, inside.length);
  if (!confirm(`Remove “${t.title}” from your Board?`)) return;
  api(`/dashboard/tiles/${t.id}`, { method: 'DELETE' }).then(() => loadDash(true)).catch((e) => toast(e.message, true));
}

// A group with tiles in it: only the group (its tiles stay, loose), or everything.
function removeGroup(t, n) {
  const m = openModal(`
    <div class="modal-head"><h2>Remove “${esc(t.title)}”?</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
    <div class="modal-body"><p style="margin:0">It holds ${n === 1 ? 'one tile' : `${n} tiles`}.</p></div>
    <div class="modal-foot">
      <button class="btn" data-dismiss>Cancel</button>
      <button class="btn" id="rm-group">Only the group</button>
      <button class="btn danger" id="rm-all">The group and its tiles</button>
    </div>`);
  const go = (all) => { m.close(); api(`/dashboard/tiles/${t.id}${all ? '?all' : ''}`, { method: 'DELETE' }).then(() => loadDash(true)).catch((e) => toast(e.message, true)); };
  $('#rm-group', m).onclick = () => go(false);
  $('#rm-all', m).onclick = () => go(true);
}

// What a tile says when its bot was busy: the request waits among the owner's messages (docs/api.md, "A message that waits").
const tileWaits = (t) => `${botById(t.bot)?.name || 'Its bot'} will do it when it is free`;
async function tapTile(t) {
  const tap = t.look?.tap || 'none';
  if (tap === 'panel') return openTilePanel(t);
  if (tap === 'chat' || tap === 'none') { if (tap === 'chat' && botById(t.bot)) setView('bot', t.bot); return; }
  const flash = (text) => { tapped.set(t.id, text); renderDashboard(); setTimeout(() => { tapped.delete(t.id); renderDashboard(); }, 2500); };
  const pop = () => { popped.add(t.id); renderDashboard(); setTimeout(() => { popped.delete(t.id); renderDashboard(); }, 500); };
  const on = t.look.dot?.filled !== true;
  if (tap === 'toggle') { state.dash.tiles = state.dash.tiles.map((x) => (x.id === t.id ? { ...x, value: on, look: { ...x.look, dot: { ...x.look.dot, filled: on } } } : x)); renderDashboard(); }
  if (t.asks) flash(`Asked ${botById(t.bot)?.name || 'its bot'}`);
  try {
    const { queued, ...r } = await api(`/dashboard/tiles/${t.id}/tap`, { method: 'POST', body: tap === 'toggle' ? { on } : {} });
    state.dash.tiles = state.dash.tiles.map((x) => (x.id === t.id ? { ...x, ...r } : x));
    if (t.asks && queued === true) flash(tileWaits(t)); // its bot is working: the request waits its turn
    if (tap === 'act' && !t.asks) pop();
    else renderDashboard();
  } catch (e) {
    toast(e.message, true);
    loadDash(true);
  }
}

// ---------- login requests (secure pop-up) ----------

const loginReq = { pending: [], shown: null, snoozed: new Set(), saving: new Set() };

async function pollLoginRequests() {
  loginReq.polledAt = Date.now();
  let list;
  try { list = await api('/vault/requests'); } catch { return; }
  // Ones being saved in the background are as good as answered.
  loginReq.pending = list.filter((r) => !loginReq.saving.has(r.id));
  showNeeds();
  // Pop it up straight away unless the user is busy in another dialog or put it aside.
  const next = loginReq.pending.find((r) => !loginReq.snoozed.has(r.id));
  if (next && !loginReq.shown && !$('#modal').open) openLoginRequest(next);
  if (loginReq.shown && !list.some((r) => r.id === loginReq.shown) && $('#modal').open && $('#modal').dataset.request === loginReq.shown) {
    $('#modal').close(); // answered elsewhere (e.g. on the phone) or expired
  }
}

// A list of other logins longer than this gets a search field and scrolls inside the dialog.
const LOGIN_SEARCH_ABOVE = 6;

// Whether a login of another website stays in the list for what was typed: every typed word is in its name,
// username or website, whatever the case. Nothing typed keeps every login.
function loginRequestMatches(e, q) {
  const hay = [e.name, e.username, e.site].map((v) => String(v ?? '').toLowerCase());
  return String(q ?? '').toLowerCase().split(/\s+/).filter(Boolean).every((w) => hay.some((h) => h.includes(w)));
}

// "Use another saved login": the line that opens the saved logins of other websites (r.others, docs/api.md),
// and their list, with a search field when it is long. Nothing when there are none, so the dialog is as it was.
function loginRequestOthers(r) {
  const others = r.others || [];
  if (!others.length) return '';
  const long = others.length > LOGIN_SEARCH_ABOVE;
  return `<div class="req-others">
          <button type="button" class="link-btn" id="req-others-open" aria-expanded="false" aria-controls="req-others-list">Use another saved login</button>
          <fieldset id="req-others-list" hidden><legend>Saved for another website</legend>
            ${long ? '<input type="search" id="req-others-search" placeholder="Search" aria-label="Search the saved logins" autocomplete="off" autocapitalize="off" spellcheck="false">' : ''}
            <div class="req-others-rows${long ? ' long' : ''}">
            ${others.map((e) => `<div class="req-existing"><span>🔑 <b>${esc(e.name)}</b>${e.username ? ` · ${esc(e.username)}` : ''}<span class="req-other-site">${esc(e.site)}</span></span><button type="button" class="btn sm" data-other="${esc(e.id)}">Use it</button></div>`).join('')}
            </div>
            ${long ? '<div class="req-others-none faint" hidden>No saved login matches.</div>' : ''}
          </fieldset>
        </div>`;
}

// The second question, before a login saved for another website is used on the requested one: it names the
// login, its website and the requested host. Only its button sends the answer.
function loginRequestConfirm(r, e) {
  return `<div class="req-confirm" id="req-confirm">
          <div class="req-site">
            <div class="muted" style="font-size:12.5px">Use the login</div>
            <div class="site">${esc(e.name)}</div>
            <div class="muted" style="font-size:12.5px">${e.site ? `saved for <b>${esc(e.site)}</b>` : 'saved without a website'}</div>
            <div class="muted" style="font-size:12.5px;margin-top:8px">on</div>
            <div class="site">${esc(r.site)}</div>
          </div>
          <div class="req-note req-warn">⚠️ Its password will also be used on <b>${esc(r.site)}</b>, by ${esc(r.bot.name)}. Only continue if ${esc(r.site)} really takes this login: web pages can try to trick bots into asking.</div>
          <div class="req-error" role="alert" hidden></div>
          <div class="req-confirm-actions">
            <button type="button" class="btn" data-back>Back</button>
            <button type="button" class="btn primary" id="req-confirm-yes">Use it on ${esc(r.site)}</button>
          </div>
        </div>`;
}

function openLoginRequest(r) {
  if (r.kind === 'card') return openCardApproval(r);
  loginReq.shown = r.id;
  const reusable = r.existing.filter((e) => !e.allowed);
  const m = openModal(`
    <form id="login-request" autocomplete="off">
      <div class="modal-head"><h2>🔐 ${botLabel(r.bot)} needs a login</h2><button type="button" class="btn ghost" data-dismiss>✕</button></div>
      <div class="modal-body">
        <div class="req-site">
          <div class="muted" style="font-size:12.5px">Website</div>
          <div class="site">${esc(r.site)}</div>
          <div class="muted" style="font-size:12.5px">It will only ever be used with this address, and only by ${esc(r.bot.name)}.</div>
        </div>
        ${r.reason ? `<div class="req-reason"><span class="muted">${r.from === 'chief' ? 'The Chief says' : 'The bot says'}:</span> “${esc(r.reason)}”</div>` : ''}
        ${reusable.length ? `
          <fieldset><legend>Already in your Vault</legend>
            ${reusable.map((e) => `<div class="req-existing"><span>🔑 <b>${esc(e.name)}</b> ${e.username ? `· ${esc(e.username)}` : ''}</span><button type="button" class="btn sm" data-allow="${esc(e.id)}">Let ${esc(r.bot.name)} use it</button></div>`).join('')}
          </fieldset>` : ''}
        ${loginRequestOthers(r)}
        ${reusable.length || (r.others || []).length ? '<div class="faint" style="font-size:12px;text-align:center">or save a new one:</div>' : ''}
        ${state.bw?.configured && state.bw.unlocked ? `<div class="req-note bw-hint">Already in your Bitwarden? Move it into the <b>bot-dot</b> folder there (edit the item → Folder), then <button type="button" class="link-btn" id="req-recheck">check Bitwarden again</button>.</div>` : ''}
        ${vaultTypeControl(r.type)}
        ${vaultTypeFields(r.type, { username: r.username })}
        <label class="toggle"><input type="checkbox" name="insecureTls"> Accept a self-signed certificate <span class="hint muted" style="font-weight:400">for your own servers</span></label>
        <label class="field">Save as<input type="text" name="name" value="${esc(r.name)}"></label>
        ${state.bw?.configured && !state.bw.unlocked ? '<label class="field">Bitwarden master password <span class="hint">Bitwarden is locked; this unlocks it so the login is saved there</span><input type="password" name="unlockPassword" autocomplete="current-password" required></label>' : ''}
        <div class="req-note">🛡 Goes straight into ${state.bw?.configured ? 'your Bitwarden (bot-dot folder)' : 'your encrypted Vault'}. The AI never sees it, and it isn't written to the chat or logs.
          Only continue if you expected this request: web pages can try to trick bots into asking.</div>
      </div>
      <div class="modal-foot">
        <button type="button" class="btn danger left" id="req-decline">Decline</button>
        <button type="button" class="btn" id="req-later">Later</button>
        <button class="btn primary" type="submit">Save and continue</button>
      </div>
    </form>`);
  m.dataset.request = r.id;
  const form = $('#login-request', m);
  wireVaultType(form, { username: r.username });
  setTimeout(() => (r.username || !form.username ? form.password : form.username).focus(), 50);
  const answer = async (body, msg) => {
    try {
      await api(`/vault/requests/${r.id}`, { method: 'POST', body });
      form.password.value = '';
      m.close();
      toast(msg);
      pollLoginRequests();
    } catch (e) { toast(e.message, true); }
  };
  $$('[data-allow]', m).forEach((b) => (b.onclick = () => answer({ action: 'allow', loginId: b.dataset.allow }, `${r.bot.name} can now use it and will continue`)));
  // A login of another website: its list opens from one line, and a pick is asked a second time in the dialog.
  const othersOpen = $('#req-others-open', m);
  if (othersOpen) othersOpen.onclick = () => {
    const list = $('#req-others-list', m);
    list.hidden = !list.hidden;
    othersOpen.setAttribute('aria-expanded', String(!list.hidden));
    if (!list.hidden) $('#req-others-search', m)?.focus();
  };
  // The search of a long list: the page filters the rows itself, each found by the login its button names.
  const othersSearch = $('#req-others-search', m);
  if (othersSearch) {
    othersSearch.oninput = () => {
      let left = 0;
      $$('#req-others-list .req-existing', m).forEach((row) => {
        const e = r.others.find((x) => x.id === $('[data-other]', row).dataset.other);
        row.hidden = !e || !loginRequestMatches(e, othersSearch.value);
        if (!row.hidden) left++;
      });
      $('.req-others-none', m).hidden = left > 0;
    };
    // Enter here searches; it must not save a new login.
    othersSearch.onkeydown = (e) => { if (e.key === 'Enter') e.preventDefault(); };
  }
  $$('[data-other]', m).forEach((b) => (b.onclick = () => {
    const e = r.others.find((x) => x.id === b.dataset.other);
    if (!e) return;
    $('.modal-body', m).insertAdjacentHTML('beforeend', loginRequestConfirm(r, e));
    form.classList.add('confirming');
    const c = $('#req-confirm', m);
    const yes = $('#req-confirm-yes', c);
    $('[data-back]', c).onclick = () => { c.remove(); form.classList.remove('confirming'); };
    $('[data-back]', c).focus();
    yes.onclick = async () => {
      yes.disabled = true;
      try {
        await api(`/vault/requests/${r.id}`, { method: 'POST', body: { action: 'allow', loginId: e.id } });
        m.close();
        toast(`${r.bot.name} can now use it on ${r.site} and will continue`);
        pollLoginRequests();
      } catch (err) {
        // The server's sentence (the login has 20 additional hosts already, say); the request stays open.
        const box = $('.req-error', c);
        box.textContent = err.message;
        box.hidden = false;
        yes.disabled = false;
      }
    };
  }));
  $('#req-decline', m).onclick = () => answer({ action: 'decline' }, 'Declined');
  const recheck = $('#req-recheck', m);
  if (recheck) recheck.onclick = async () => {
    recheck.disabled = true; recheck.textContent = 'checking…';
    try {
      await api('/vault/bitwarden/sync', { method: 'POST' });
      const fresh = (await api('/vault/requests')).find((x) => x.id === r.id);
      const found = fresh ? fresh.existing.filter((e) => !e.allowed).length : 0;
      m.close(); // the regular check reopens it with what's in Bitwarden now
      if (fresh) toast(found ? 'Found it. Choose it to let the bot use it.' : `Nothing for ${fresh.site} in the bot-dot folder yet. Check the item's website address in Bitwarden too.`, !found);
    } catch (e) { toast(e.message, true); recheck.disabled = false; recheck.textContent = 'check Bitwarden again'; }
  };
  $('#req-later', m).onclick = () => { loginReq.snoozed.add(r.id); m.close(); };
  $('[data-dismiss]', m).onclick = () => { loginReq.snoozed.add(r.id); m.close(); };
  form.onsubmit = (e) => {
    e.preventDefault();
    const body = { action: 'save', name: form.name.value.trim(), ...vaultTypeBody(form), password: form.password.value, insecureTls: form.insecureTls.checked };
    if (form.unlockPassword) { body.unlockPassword = form.unlockPassword.value; form.unlockPassword.value = ''; }
    loginReq.saving.add(r.id);
    m.close();
    saveLoginInBackground(r, body);
  };
  m.addEventListener('close', () => { loginReq.shown = null; delete m.dataset.request; form.password.value = ''; pollLoginRequests(); }, { once: true });
}

// Saving to Bitwarden (and unlocking it first, if it's locked) takes a few seconds: like unlocking,
// it runs in the background with the pill in the corner, and the bot continues once it's saved.
async function saveLoginInBackground(r, body) {
  unlockPill('busy', 'Saving login…');
  try {
    await api(`/vault/requests/${r.id}`, { method: 'POST', body });
    unlockPill('ok', `Saved. ${r.bot.name} will continue.`);
    if (body.unlockPassword) pollBitwarden();
  } catch (err) {
    // Opened again with the type the owner chose and the username they typed, so the next try saves what they meant.
    const again = () => { const x = loginReq.pending.find((y) => y.id === r.id); if (x && !$('#modal').open) openLoginRequest({ ...x, type: body.type, username: body.username ?? x.username }); };
    unlockPill('err', /not right/i.test(err.message) ? 'Wrong master password, login not saved' : `Login not saved: ${err.message}`, again);
    loginReq.snoozed.add(r.id); // reopened from the pill, not popped up again by itself
  } finally {
    body.password = body.unlockPassword = null;
    loginReq.saving.delete(r.id);
    pollLoginRequests();
  }
}

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
const loadChief = () => api('/chief').then((c) => { Object.assign(state, { chats: c.chats, chiefBusy: c.busy, chiefUnread: Unread.count(c) }); renderContacts(); }).catch(() => {});

let readChat = null; // the chat last seen on screen and in front
function syncRead() {
  if (!state.features.includes('unread')) return; // a server from before: nothing is new, nothing to report
  const open = chatOpen();
  if (newLine.open(open)) drawNewLine(); // the chat was left: its line goes
  const chat = inFront() ? open : null;
  if (chat === readChat) return;
  readChat = chat;
  if (!chat) { report.show(null); return; }
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
// it out, oldest first, each `{ id, text, attachments, at }`. Anything else in it is left out.
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
// One waiting message: the owner's bubble, faded, with what it waits for and the way back.
function queuedHTML(q, chat) {
  const [kind, id] = chatParts(chat);
  const who = kind === 'chief' ? 'the Chief' : botById(id)?.name || 'the bot';
  const text = typeof q.text === 'string' ? q.text : '';
  const files = filesHTML(Array.isArray(q.attachments) ? q.attachments : []);
  return `<div class="bubble-row from-me"><div class="stack mine">
    <div class="bubble from-me waits">${escMentions(text, kind === 'chief' ? CHIEF_BOT.id : id)}${files}</div>
    <div class="bubble-meta"><span>Waits until ${esc(who)} is free</span><button type="button" data-take-back="${esc(q.id)}">Take back</button></div>
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
  const sig = JSON.stringify([chat, list.map((q) => [q.id, q.text, q.attachments]), mentionSig(), sent]);
  if (box.dataset.sig === sig) return;
  const atBottom = thread.scrollHeight - thread.scrollTop - thread.clientHeight < 160;
  box.dataset.sig = sig;
  box.innerHTML = list.map((q) => queuedHTML(q, chat)).join('') + (sent ? sentHTML(sent, chat) : '');
  $$('[data-take-back]', box).forEach((b) => (b.onclick = () => takeBack(chat, b.dataset.takeBack, b)));
  if (sent && arrives) arrive($('[data-sent]', box));
  if (atBottom) thread.scrollTop = thread.scrollHeight;
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

// ---------- the live feed ----------

// botdot's live feed (/api/events): refresh right away when something happens, instead of waiting
// for the next periodic check (which stays, in case the feed drops).
function followFeed() {
  if (!window.EventSource) return;
  let timer = null;
  const soon = () => { clearTimeout(timer); timer = setTimeout(() => { if (!$('#modal').open) refresh(); }, 300); };
  const es = new EventSource('/api/events?guarded=1'); // with the guarded memory changes: each has a card here
  state.feed = es;
  es.onopen = () => { setAway(false); soon(); }; // back after a break: the line goes, and catch up
  // run_waits: a run began to wait for the owner's OK on an action in a connected app, or stopped waiting (its `waitingFor`).
  ['run_started', 'run_finished', 'run_waits', 'bot_message', 'waiting', 'chief_reply', 'chief_suggestion', 'approvals', 'asks', 'bots', 'reset'].forEach((t) => es.addEventListener(t, soon));
  ['login_request', 'login_request_closed'].forEach((t) => es.addEventListener(t, () => { pollLoginRequests(); soon(); })); // soon: the bot's face shows it needs you
  es.addEventListener('bitwarden', () => pollBitwarden());
  // A chat's new replies changed: its dots follow, in every app.
  es.addEventListener('unread', (e) => {
    let d = {};
    try { d = JSON.parse(e.data); } catch { /* not ours */ }
    if (d.chat) setUnread(d.chat, d);
  });
  // A bot's open question changed (`asks` with `botId`; the event of the same name without it lists what waits in
  // Needs you): its line in the list follows at once, also in a page that did not send the answer.
  es.addEventListener('asks', (e) => {
    let d = {};
    try { d = JSON.parse(e.data); } catch { /* not ours */ }
    if (Unread.asked(state.bots, d)) renderContacts();
  });
  es.addEventListener('reset', () => { if (openingLines.clear()) { renderContacts(); placeStatusLines(); } }); // the refresh reads them again
  // What waits for the owner, as the feed lists it, at the start and whenever it changes: a waiting job says
  // there what a yes on it starts (needsItems). The refresh that follows draws it.
  const waits = (of) => (e) => { try { state.approvals = of(JSON.parse(e.data)) || null; } catch { /* not ours */ } };
  es.addEventListener('hello', waits((d) => d.approvals));
  es.addEventListener('approvals', waits((d) => d));
  // Whether Claude is signed in, at the start and whenever it changes: the standing line follows (setSignedOut).
  const claude = (of) => (e) => { try { setSignedOut(of(JSON.parse(e.data))); } catch { /* not ours */ } };
  es.addEventListener('hello', claude((d) => d.claude));
  es.addEventListener('claude', claude((d) => d));
  // The owner's messages that wait in a chat changed: one was taken, started, or was taken back. The whole list
  // comes with it, also to a page that sent none of them.
  es.addEventListener('queued', (e) => {
    let d = {};
    try { d = JSON.parse(e.data); } catch { /* not ours */ }
    if (typeof d.chat === 'string') setQueued(d.chat, d.queued);
  });
  es.addEventListener('queued', soon); // and the bots are read again: a list fetched before this one may be drawn meanwhile
  // The Chief began a reply this page may not have asked for: after an OK, for a message that waited, for a late
  // result. Its working line shows, and the chat is read again so that the turn and its reply are followed.
  // While this page is sending there, or follows the reply before it, that is done when that ends.
  es.addEventListener('chief_started', (e) => {
    let d = {};
    try { d = JSON.parse(e.data); } catch { /* not ours */ }
    if (typeof d.chatId !== 'string' || !d.chatId) return;
    if (!chiefTurns.has(d.chatId)) chiefTurns.set(d.chatId, '');
    placeStatusLines();
    if (state.view !== 'chief' || d.chatId !== state.chatId || sendingIn.has($('#view-chief form'))) return;
    if (state.chatStream) state.chatReload = true;
    else showChat(d.chatId);
  });
  // A working bot said its opening line: under its chat and as its preview in the list, at once. From a server
  // with the working line a bot's line comes as `working_line` (below); the Chief's comes here as before.
  es.addEventListener('opening_line', (e) => {
    let d = {};
    try { d = JSON.parse(e.data); } catch { /* not ours */ }
    if (d.runId && !OpeningLine.says('opening_line', state.features)) return;
    if (openingLines.say(d.chat, d.text, d.runId ?? null)) { renderContacts(); placeStatusLines(); }
  });
  // A working bot's line changed: the server's words for what it is doing now, in the same two places.
  es.addEventListener('working_line', (e) => {
    let d = {};
    try { d = JSON.parse(e.data); } catch { /* not ours */ }
    if (openingLines.say(d.chat, d.text, d.runId ?? null)) { renderContacts(); placeStatusLines(); }
  });
  // Its run ended, with an answer or without: the line goes, before the refresh that shows the reply.
  es.addEventListener('run_finished', (e) => {
    let d = {};
    try { d = JSON.parse(e.data); } catch { /* not ours */ }
    if (openingLines.end(`bot:${d.botId}`, d.id)) { renderContacts(); placeStatusLines(); }
  });
  // A tile's new value, or the Board changed (the Chief added a tile).
  es.addEventListener('dashboard', (e) => {
    let d = {};
    try { d = JSON.parse(e.data); } catch { /* not ours */ }
    if (d.tile && state.dash) { state.dash.tiles = state.dash.tiles.map((t) => (t.id === d.tile.id ? d.tile : t)); if (state.view === 'dashboard') renderDashboard(); }
    else loadDash(state.view !== 'dashboard');
  });
  // A reply in the Chief chat that's open, which this page isn't following: a bot's reply posted there, an unasked
  // message, or the Chief answering a message sent from the phone. Show it (after the Chief's own reply, if that's
  // still coming).
  es.addEventListener('chief_reply', (e) => {
    let d = {};
    try { d = JSON.parse(e.data); } catch { /* not ours */ }
    // The Chief's own reply ended; a bot's file doesn't end it. A reply this page follows ends with its stream (followChief).
    if (!d.from) {
      const followed = state.chatStream && d.chatId === state.chatId;
      if ([openingLines.end(`chief:${d.chatId}`), !followed && chiefTurns.delete(d.chatId)].some(Boolean)) placeStatusLines();
    }
    if (state.view !== 'chief' || d.chatId !== state.chatId) return;
    // The Chief's own reply arrives through its stream; a bot's reply or an unasked message that waited for it doesn't.
    if (state.chatStream) { if (d.from || d.unasked) state.chatReload = true; }
    else showChat(d.chatId);
  });
  // An unasked message was rated, here or in another app: its thumbs follow, when its chat is on screen.
  es.addEventListener('rating', (e) => {
    let d = {};
    try { d = JSON.parse(e.data); } catch { /* not ours */ }
    const thread = $('#chat-thread');
    if (!thread || !d.chatId || thread.dataset.chat !== d.chatId || !Number.isInteger(d.index)) return;
    Ratings.show($(`.rate[data-rate="${d.index}"]`, thread), d.rating);
  });
  // The checkup's setting changed, in another app or by the Chief in a chat: the switches follow.
  es.addEventListener('checkup', (e) => {
    let d = {};
    try { d = JSON.parse(e.data); } catch { /* not ours */ }
    if (typeof d.on !== 'boolean') return;
    state.checkup = d;
    drawCheckup();
  });
}

// ---------- boot ----------

$('#more-btn').onclick = () => setView('settings');
initSideGrip();
initChatGrip();
// The pages opened from Settings go back to it.
document.addEventListener('click', (e) => { if (e.target.closest('[data-to-settings]')) setView('settings'); });
document.addEventListener('click', (e) => { if (e.target.closest('[data-sign-in]')) setView('setup'); }); // the standing line's "Sign in"
$('#contact-search').oninput = () => { searchChats(); renderContacts(); markSearch(); };
addEventListener('keydown', onKeypadKey); // the keypad's keys, where it is shown
document.addEventListener('click', (e) => { if (e.target.closest('[data-back]')) showList(); });
// A picture in a chat opens big on this page (served as a download, a plain link would save it).
document.addEventListener('click', (e) => {
  const a = e.target.closest('a.file-image, img.shot');
  if (!a || e.metaKey || e.ctrlKey || e.shiftKey) return;
  e.preventDefault();
  const src = a.tagName === 'IMG' ? a.src : a.getAttribute('href');
  const d = document.createElement('dialog');
  d.className = 'viewer';
  d.innerHTML = `<img src="${esc(src)}" alt="${esc(a.title || a.alt || '')}">`;
  d.onclick = () => d.close();
  d.onclose = () => d.remove();
  document.body.append(d);
  d.showModal();
});

(async () => {
  const figure = loadFigure();
  state.status = await api('/status').catch(() => null);
  await loadFeatures();
  await figure;
  const [view, sub] = location.hash.slice(1).split('/');
  if (sub && view === 'runs') state.selectedRun = sub;
  if (sub && (view === 'chief' || view === 'chiefsettings')) state.chatId = sub;
  await refresh();
  renderStatus();
  // First start, or Claude isn't signed in: open the setup page.
  const setupNow = await api('/setup').catch(() => null);
  if (opensSetup(setupNow)) {
    setView('setup');
  } else {
    const known = ['chief', 'dashboard', 'bot', 'group', ...Panel.NAMES, 'runs', 'vault', 'skills', 'settings', 'setup', 'connectors'].includes(view);
    setView(known ? view : 'chief', BOT_NAMES.includes(view) || GROUP_NAMES.includes(view) ? sub : undefined);
    if (!known) showList(); // phones start on the contact list
  }
  // Keep things fresh without clobbering an open dialog. The live feed says when something changed, so while
  // it's connected this only checks once a minute; nothing while the page is hidden.
  const live = () => state.feed?.readyState === 1;
  const due = (at, ms) => !live() || away.on || Date.now() - (at || 0) >= ms; // away: asked again soon, also when a proxy holds the feed open
  setInterval(() => { if (!document.hidden && !$('#modal').open && due(state.refreshedAt, 60_000)) refresh(); }, 8000);
  pollLoginRequests();
  setInterval(() => { if (!document.hidden && due(loginReq.polledAt, 60_000)) pollLoginRequests(); }, 3000);
  pollBitwarden();
  setInterval(() => { if (!document.hidden && due(bwUi.polledAt, 60_000)) pollBitwarden(); }, 4000);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    if (!$('#modal').open) refresh();
    pollLoginRequests();
    pollBitwarden();
  });
  followFeed();
  if (state.feed) followGroups(state.feed); // what happens in the groups (groups.js)
})();
