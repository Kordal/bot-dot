// New replies on the web page (ADR 005, docs/api.md "New replies"). The botdot server says what is new:
// a bot and a Chief chat carry `unread` (how many) and `firstUnread` (where they begin). This file only
// draws that and reports the chat on screen; it counts nothing. Against a server without the fields
// everything here is zero: no dots, no line, no report.
//   - dots: one per new reply, at most three, in the bot's colour, after the time in the list. No number.
//   - a bot that asks: "Asks: …" in its line, and a round mark with "?" in its colour in place of the dots.
//   - the "New" line: above the first new reply of the chat that was opened. When that reply is older than the
//     runs the chat draws, the chat reads back to it.
//   - the report: POST /api/read with the chat on screen, again every `repeatMs`, and null when it is not.
// A plain <script>, as window.Unread; the tests load it the same way.

(function (root) {

const MAX_DOTS = 3;
const REPEAT_MS = 10_000; // until the server names its own
const CHAT_RUNS = 40; // a bot's chat draws its newest runs, this many
const REACH_PAGES = 5; // how many pages of older runs are read to get to the "New" line

// How many new replies a bot, a Chief chat or the Chief has: a whole number, 0 when the server sent none.
const count = (x) => (Number.isInteger(x?.unread) && x.unread > 0 ? x.unread : 0);

// A colour is the server's, and goes into a style attribute: only #rgb / #rrggbb gets there.
const tint = (color) => (/^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(color || '')) ? color : '#888780');

// The dots of a row in the list: '' when nothing is new.
function dots(n, color) {
  const shown = Math.min(MAX_DOTS, Number.isInteger(n) && n > 0 ? n : 0);
  if (!shown) return '';
  return `<span class="unread-dots" style="--c:${tint(color)}" aria-label="New ${shown === 1 ? 'reply' : 'replies'}">${'<i></i>'.repeat(shown)}</span>`;
}

// A bot that asks the owner something (docs/api.md, "A bot that asks"): the server says it with `asks` on the bot,
// and this file draws it. The question in one line, '' for a bot that asks nothing or a server that says nothing,
// and for a bot that is working (`busy`): its row then says what it does.
const asks = (bot, busy = false) => (!busy && typeof bot?.asks?.text === 'string' ? bot.asks.text.trim() : '');

// The mark of a row whose bot asks: a round one in the bot's colour, where the dots are.
const mark = (color) => `<span class="asks-mark" style="--c:${tint(color)}" aria-label="Asks you">?</span>`;

// The feed's event about one bot's question, `{ botId, asks }`: `asks` is the question, or null when it ended. The
// event that lists what waits in Needs you has the same name and no `botId`: it changes nothing here. Sets it on
// that bot of `bots` and says whether the list has to be drawn again.
function asked(bots, event) {
  if (!event || typeof event.botId !== 'string' || !('asks' in event)) return false;
  const bot = (Array.isArray(bots) ? bots : []).find((b) => b?.id === event.botId);
  if (!bot) return false;
  const was = asks(bot);
  if (event.asks && typeof event.asks === 'object') bot.asks = event.asks;
  else delete bot.asks;
  return asks(bot) !== was;
}

// The line above the first new reply.
const line = (color) => `<div class="new-line" style="--c:${tint(color)}">New</div>`;

// One exchange of a bot's chat (what started the run, then its reply) with the line where the new part
// begins: above the whole exchange, or below the owner's own message when that started it.
function exchange({ asked = '', reply = '', mine = false }, lineHTML = '') {
  return mine ? asked + lineHTML + reply : lineHTML + asked + reply;
}

// In a Chief chat the line goes above the message at place `first`, or above the next one that is drawn.
// places: the place of each drawn row, in order. Returns the row's index, or -1 when none is drawn.
const rowFrom = (places, first) => (Number.isInteger(first) ? places.findIndex((p) => p >= first) : -1);

// Which of a bot's runs its chat draws. runs: the bot's, newest first. The newest `limit`; with a "New" line
// (`first`, a run's id) every run back to that one, so the line is drawn however far back it is. `missing`:
// the line's run is not among `runs`, and older ones must be read first (reach).
function shown(runs, first = null, limit = CHAT_RUNS) {
  const at = first === null || first === undefined ? -1 : runs.findIndex((r) => r.id === first);
  return { runs: runs.slice(0, Math.max(limit, at + 1)), missing: first !== null && first !== undefined && at < 0 };
}

// Reads a bot's runs back until run `first` is among them. page(before) resolves to a page of its runs,
// newest first: the newest when `before` is undefined, else those older than the run with that id.
// Resolves to every run read, newest first, or to null when the run was not reached: it is gone, or it is
// further back than `pages` pages.
async function reach(first, page, pages = REACH_PAGES) {
  const all = [];
  const known = new Set();
  for (let i = 0; i < pages; i++) {
    const next = await page(all.length ? all[all.length - 1].id : undefined);
    const fresh = (Array.isArray(next) ? next : []).filter((r) => r && !known.has(r.id));
    if (!fresh.length) return null; // nothing older (or a server that sends the newest again)
    for (const r of fresh) { known.add(r.id); all.push(r); }
    if (known.has(first)) return all;
  }
  return null;
}

// What a chat's "New" line is drawn from: `first` is the server's firstUnread (a run id, or a message's
// place in a Chief chat). Set when a chat with new replies comes on screen; kept until the chat is left.
function lineKeeper() {
  let chat = null;
  let first = null;
  let jump = false; // the line was just placed: scroll to it once
  return {
    // The chat came on screen, and the server says this about it.
    arrive(c, model) {
      if (c !== chat) { chat = c; first = null; jump = false; }
      if (!count(model) || model.firstUnread === null || model.firstUnread === undefined) return false;
      if (first === model.firstUnread) return false;
      first = model.firstUnread;
      jump = true;
      return true;
    },
    // The chat that is open now (null: none). Leaving a chat takes its line away.
    open(c) {
      if (c === chat) return false;
      const had = first !== null;
      chat = c; first = null; jump = false;
      return had;
    },
    first: (c) => (c === chat ? first : null),
    takeJump() { const j = jump; jump = false; return j; },
  };
}

// The report of the chat on screen. post(body) sends POST /api/read and resolves to its answer.
// show(chat) says what is on screen and in front now (null: nothing); it sends when that changes and
// repeats a chat every repeatMs. onRead(chat, answer) is called when the server took a chat as read.
function reporter({ app, post, onRead = () => {}, every = setInterval, stop = clearInterval }) {
  let shown = null;
  let sent = null; // the last chat the server was told; null also before the first report
  let timer = null;
  let repeatMs = REPEAT_MS;
  const say = (chat) => {
    sent = chat;
    return new Promise((resolve) => resolve(post({ app, chat }))).then((answer) => {
      if (answer?.repeatMs > 0 && answer.repeatMs !== repeatMs) { repeatMs = answer.repeatMs; arm(); }
      if (chat && answer?.ok) onRead(chat, answer);
      return answer;
    }).catch(() => null); // offline: the next repeat tries again, and a lost report runs out by itself
  };
  function arm() {
    if (timer) stop(timer);
    timer = shown ? every(() => { if (shown) say(shown); }, repeatMs) : null;
  }
  return {
    show(chat) {
      chat = chat || null;
      if (chat === shown) return null;
      shown = chat;
      arm();
      if (!chat && !sent) return null; // nothing was on screen, and nothing is
      return say(chat);
    },
    // Say it once more now, for a page that holds counts from before its report.
    again: () => (shown ? say(shown) : null),
    shown: () => shown,
  };
}

// An id this page makes up for itself, so the server can tell two apps on one chat apart.
const appId = (random = Math.random) => `web-${Array.from({ length: 12 }, () => Math.floor(random() * 36).toString(36)).join('')}`;

const api = { MAX_DOTS, REPEAT_MS, CHAT_RUNS, count, tint, dots, asks, mark, asked, line, exchange, rowFrom, shown, reach, lineKeeper, reporter, appId };
if (typeof module === 'object' && module.exports) module.exports = api;
else root.Unread = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
