// The owner's activity per UTC day, as counts alone, for the front door's daily usage summary (ADR 105): whether they
// used botdot, from which app, how many messages they sent, how many cards Needs you showed them and how fast they
// answered. Nothing of what they wrote or answered, and no address: a count, an app's kind and a number of
// milliseconds. Kept in the account's data folder (activity.json) for KEEP_DAYS, which covers the days the front door
// may still ask for.
//
// activity.json: { days: { "YYYY-MM-DD": { web, android, messages, shown, answered, waits: [ms, …] } } }
const path = require('path');
const { readJson, writeJson } = require('./jsonfile');

const KEEP_DAYS = 14;
const WAITS_MAX = 500; // answer times kept per day, enough for a median
const SAVE_MS = 30_000; // a burst of requests is written once

// Which app a request came from, by what its client calls itself: the Android app's HTTP client (OkHttp) or a
// browser. Anything else (a script, curl) is neither.
function clientOf(userAgent) {
  const ua = String(userAgent || '');
  if (/okhttp|; wv\)/i.test(ua)) return 'android'; // its client, or a page it shows in a WebView
  if (/mozilla/i.test(ua)) return 'web';
  return null;
}

// The owner's message to a bot, the Chief or a group: the routes that send one.
const MESSAGE = /^\/api\/(bots\/[^/]+\/run|chief\/chats\/[^/]+\/messages|group-chats\/[^/]+\/messages)$/;
const isMessage = (method, pathname) => method === 'POST' && MESSAGE.test(pathname);

function median(list) {
  if (!list.length) return null;
  const s = [...list].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

function create(dataDir, { now = () => Date.now() } = {}) {
  const file = path.join(dataDir, 'activity.json');
  let state = null;
  let timer = null;
  const load = () => {
    if (!state) {
      const read = readJson(file, {});
      state = { days: read && typeof read.days === 'object' && read.days ? read.days : {} };
    }
    return state;
  };
  const save = () => {
    timer = null;
    const cutoff = new Date(now() - KEEP_DAYS * 864e5).toISOString().slice(0, 10);
    const s = load();
    for (const d of Object.keys(s.days)) if (d < cutoff) delete s.days[d];
    try { writeJson(file, s); } catch (e) { console.error(`[activity] couldn't save: ${e.message}`); }
  };
  const soon = () => { if (!timer) { timer = setTimeout(save, SAVE_MS); timer.unref?.(); } };
  const today = () => {
    const d = new Date(now()).toISOString().slice(0, 10);
    const s = load();
    return (s.days[d] ||= { web: 0, android: 0, messages: 0, shown: 0, answered: 0, waits: [] });
  };

  // A request of the owner's, passed on by the front door.
  function saw(method, pathname, userAgent) {
    const t = today();
    const client = clientOf(userAgent);
    if (client) t[client]++;
    if (isMessage(method, pathname)) t.messages++;
    soon();
  }
  // A new card in Needs you, and the owner's answer on one shown at `shownAt` (ISO).
  function cardShown() { today().shown++; soon(); }
  function cardAnswered(shownAt) {
    const t = today();
    t.answered++;
    const wait = now() - Date.parse(shownAt || '');
    if (Number.isFinite(wait) && wait >= 0 && t.waits.length < WAITS_MAX) t.waits.push(Math.round(wait));
    soon();
  }

  // One day's counts: { active, web, android, messages, cards: { shown, answered, medianAnswerMs } }.
  function day(d) {
    const r = load().days[d] || {};
    const n = (k) => (Number.isInteger(r[k]) && r[k] > 0 ? r[k] : 0);
    return {
      active: n('web') + n('android') > 0, web: n('web'), android: n('android'), messages: n('messages'),
      cards: { shown: n('shown'), answered: n('answered'), medianAnswerMs: median(Array.isArray(r.waits) ? r.waits.filter(Number.isFinite) : []) },
    };
  }

  return { saw, cardShown, cardAnswered, day, flush: () => { if (timer) { clearTimeout(timer); save(); } } };
}

module.exports = { create, clientOf, isMessage, median, KEEP_DAYS };
