// Read positions: how far the owner has read each chat, and what counts as a new reply (ADR 005).
//
// A chat is "bot:<id>", "chief:<chatId>" or "group:<id>" (a group, ADR 018). Its read position is a time; a reply after it that is meant
// for the owner is new. The positions are one file in the data folder (read-positions.json), so a restart
// keeps them and a backup carries them. A chat with no position of its own is read up to `since`, the
// moment this file was first made: on the first start with it, every existing chat is read.
//
// An app reports the chat it shows while it is in front (POST /api/read), repeats that, and says so
// when it shows it no longer. A report counts until the app's next one, at most REPORT_MS (an app that
// died never takes it back); a reply that lands meanwhile is read at once.
const path = require('path');
const { readJson, writeJson } = require('./jsonfile');
const { quietRun } = require('./problems');
const { holds, line } = require('./choices');

const REPORT_MS = Number(process.env.BOT_DOT_READ_REPORT_MS) || 15_000; // the variable is for the tests, which can't wait 15 s
const REPEAT_MS = Math.round(REPORT_MS * 2 / 3); // how often an app repeats its report
const CHAT = /^(bot|chief|group):[\w.-]{1,80}$/;
const APP = /^[\w.-]{1,80}$/; // the id an app makes up for itself
const NOTHING_NEW = Object.freeze({ unread: 0, firstUnread: null });

// ---------- what counts ----------

// Whom a run's reply addresses: 'owner' or 'internal' (another bot or the Chief started it, or it
// follows up on such a run). A delivered explicit report addresses the owner whatever began its work.
const audience = (meta) => (meta.reporting === 'delivered' && meta.ownerReport ? 'owner'
  : meta.notificationAudience || (meta.trigger === 'bot' || meta.fromBot || meta.startedBy === 'chief' ? 'internal' : 'owner'));

// Does this run's reply count as new once it is after the read position? A bot's answer to the owner,
// a scheduled report that reached the owner, or a run that didn't finish. Never a run another bot or
// the Chief started (the apps fold those), a quiet run, or a memory review. A quiet run can be a failed one:
// a scheduled job's failure counts once per row of failures (problems.js quietRun). A pass in a group is a quiet
// run (ADR 019): it never counts.
const runCounts = (meta) => !!meta && meta.status !== 'running' && meta.trigger !== 'review' && !quietRun(meta) && audience(meta) === 'owner';
// Does this run's reply ask the owner something (docs/api.md, "A bot that asks")? A reply that ended well with
// answer buttons or a card of questions, and that counts: not one another bot or the Chief started, and not a
// job's question while it is held for the morning.
const runAsks = (meta) => !!meta && meta.status === 'success' && holds(meta) && runCounts(meta);
// What the API says of such a run beside its own fields: `asks`, and `question`, the question in one line as the
// bot's `asks.text` words it. A notification says it: the reply's first words need not hold it. {} for any other run.
const asksFields = (meta) => (runAsks(meta) ? { asks: true, question: line(meta) } : {});
// Is this run a message of the owner to its bot, typed, tapped or sent from a Board tile? Not "Run now" of a job,
// and not a run botdot started again after a yes (ADR 009). Such a message answers the bot's open question.
// Not a turn in a group either: the owner wrote to the group, and the bot's own question stays open (ADR 018).
// "The owner wrote in this bot's own chat", and so named: what a yes on a card weighs is another question, with
// another answer for a turn in a group (lib/asks.js ownerWroteThere).
const ownChatMessage = (meta) => !!meta && meta.trigger === 'manual' && !meta.startedBy && !meta.fromBot && !meta.continues && !meta.jobId && !meta.groupId;
// When that reply reached the owner's chat (a report or a failure held overnight: when it was delivered).
const runAt = (meta) => meta.deliveredAt || meta.endedAt || '';

// A message of a Chief chat: the Chief's replies and reminders, and a bot's reply posted there.
const messageCounts = (m) => !!m && !m.pending && (m.role === 'chief' || m.role === 'report');
const messageAt = (m) => m.endedAt || m.at || '';

// Of the replies that count ([{ id, at, place }], in any order), those after `readAt`: how many, and the
// first as the chat shows them. `place` is where a reply sits in its chat (a run's start, a message's index):
// the "New" line goes above the first, so every new reply must be below it.
function unreadOf(replies, readAt) {
  let unread = 0;
  let first = null;
  for (const r of replies) {
    if (!(r.at > readAt)) continue;
    unread++;
    if (!first || r.place < first.place || (r.place === first.place && r.id < first.id)) first = r;
  }
  return unread ? { unread, firstUnread: first.id } : NOTHING_NEW;
}

// ---------- the store ----------

function create(dataDir) {
  const file = path.join(dataDir, 'read-positions.json');
  let store = readJson(file, null);
  const save = () => writeJson(file, store);
  if (!store || typeof store.since !== 'string' || !store.chats || typeof store.chats !== 'object') {
    store = { version: 1, since: new Date().toISOString(), chats: {} };
    save();
  }
  const reports = new Map(); // app -> { chat, until (ms) }: the chat that app shows, in front

  const readAt = (chat) => store.chats[chat] || store.since;
  // Move a chat's position forward to `at` (never back). Returns the position.
  function mark(chat, at = new Date().toISOString()) {
    if (at > readAt(chat)) { store.chats[chat] = at; save(); }
    return readAt(chat);
  }
  function forget(chat) {
    for (const [app, r] of reports) if (r.chat === chat) reports.delete(app);
    if (chat in store.chats) { delete store.chats[chat]; save(); }
  }
  function onScreen(chat) {
    const now = Date.now();
    for (const r of reports.values()) if (r.chat === chat && r.until > now) return true;
    return false;
  }
  // What an app shows now, in front: a chat, or null for none (it takes the place of that app's last report).
  // Returns whether a chat came on screen that no app was showing.
  function report(app, chat) {
    const now = Date.now();
    for (const [a, r] of reports) if (r.until <= now) reports.delete(a);
    const fresh = !!chat && !onScreen(chat);
    if (chat) reports.set(app, { chat, until: now + REPORT_MS }); else reports.delete(app);
    return fresh;
  }
  return { readAt, mark, forget, onScreen, report };
}

module.exports = { create, audience, runCounts, runAsks, asksFields, ownChatMessage, runAt, messageCounts, messageAt, unreadOf, NOTHING_NEW, CHAT, APP, REPORT_MS, REPEAT_MS };
