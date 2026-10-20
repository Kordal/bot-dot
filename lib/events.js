// One live feed of what happens in botdot (GET /api/events, Server-Sent Events), for the web page and
// the Android app: runs starting and finishing, the Chief's replies, login requests, Bitwarden
// locking, and things waiting for the owner's OK.
//
// Every event has a number. The last few hundred are kept, so a client that lost its connection
// (a phone going through a tunnel) reconnects with Last-Event-ID and gets what it missed. Of the changes of a
// run's working line only the newest is kept (LINES).
const { withProblem, quietRun } = require('./problems');
const { audience, asksFields } = require('./read');

const KEEP = 500;

// Event ids are "<start>.<n>": numbering starts again when botdot restarts (e.g. after an update),
// so an id from an earlier start tells the client to reload instead of silently missing events.
const BOOT = Date.now().toString(36);
let nextId = 1;
const idOf = (n) => `${BOOT}.${n}`;
const recent = []; // [{ id, type, at, data }]
const listeners = new Set();

// Is the owner using the web page right now (visible, and touched in the last few minutes)? The page
// says so every 30 s (POST /api/presence). Events carry it, so the phone stays quiet meanwhile.
let webSeenAt = 0;
const WEB_QUIET_MS = 75_000;
const seenOnWeb = () => { webSeenAt = Date.now(); };
const webActive = () => Date.now() - webSeenAt < WEB_QUIET_MS;

// What a line reads now (docs/api.md, "The working line"): of these only the newest of each run is kept. A line
// changes up to once a second for every run that is going on, so with a few busy bots the changes alone would turn
// the kept events over in minutes, and an app that came back would be told to reload everything. An earlier
// change of the same run says nothing its newest does not, so the newest takes its place: a run holds one place
// among the kept events, as its opening line does, and what is replayed ends with the line as it reads now.
const LINES = new Set(['working_line', 'group_working_line']);
let lost = 0; // the number of the newest event that went because the list was full: before it, nothing can be replayed

function emit(type, data = {}) {
  const n = nextId++;
  const ev = { id: idOf(n), n, type, at: new Date().toISOString(), data, ...(webActive() ? { webActive: true } : {}) };
  if (LINES.has(type)) {
    const was = recent.findLastIndex((e) => e.type === type && e.data.runId === data.runId);
    if (was >= 0) recent.splice(was, 1);
  }
  recent.push(ev);
  if (recent.length > KEEP) lost = recent.shift().n;
  for (const fn of listeners) { try { fn(ev); } catch { /* a broken client doesn't stop the others */ } }
  return ev;
}

// An event about a run: its start, its end, its opening line, its wait for an OK. A run of a group (ADR 018) is
// announced under a name of its own, "group_" before the name, with its group and the group's chat as its `chat`.
// An app from before groups knows none of these names: it draws no turn in a bot's own chat and rings for none.
function emitRun(type, groupId, data = {}) {
  return groupId ? emit(`group_${type}`, { ...data, chat: `group:${groupId}`, groupId }) : emit(type, data);
}

// Events after `id`; null when they can't be replayed (from an earlier start, or too long ago):
// the client should reload everything.
function since(id) {
  const m = String(id || '').match(/^([0-9a-z]+)\.(\d+)$/);
  if (!m || m[1] !== BOOT) return id ? null : [];
  const n = Number(m[2]);
  if (n > nextId - 1) return null;
  if (n < lost) return null; // an event after it went because the list was full (a line's earlier change is no loss)
  return recent.filter((e) => e.n > n);
}

function subscribe(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

const lastId = () => idOf(nextId - 1);
const clip = (t, n = 300) => { t = String(t || '').trim(); return t.length > n ? `${t.slice(0, n)}…` : t; };

// What a feed event says about a run: enough for a notification, not the whole run.
// A reply that asks the owner something (read.js runAsks) says so: `asks`, the notification's `title`, its
// `question` in one line, which is what the notification says, since `result` is the reply's first 300 characters
// and a long reply asks at its end, and the question as its `result` too when the reply is nothing but its buttons
// or its card (docs/api.md, "A bot that asks").
function runSummary(meta) {
  const asked = asksFields(meta); // {} for a run that asks nothing
  return {
    id: meta.id,
    botId: meta.botId,
    // A turn in a group (ADR 018): the group, and the owner's message there that it belongs to.
    groupId: meta.groupId || undefined,
    groupMessageId: meta.groupMessageId || undefined,
    passed: meta.passed || undefined, // that turn ended as a pass (ADR 019): nothing to draw, and `quiet`
    botName: meta.botName,
    botEmoji: meta.botEmoji,
    botColor: meta.botColor || null,
    kind: meta.kind || 'ai',
    trigger: meta.trigger,
    notificationAudience: audience(meta), // whom its reply addresses (read.js)
    jobName: meta.jobName || null,
    status: meta.status,
    endedBy: meta.endedBy || undefined, // who ended it, for a run that was ended (ADR 012)
    startedAt: meta.startedAt,
    endedAt: meta.endedAt || null,
    costUsd: meta.costUsd ?? null,
    result: meta.status === 'running' ? null : meta.passed ? '' : clip(meta.result) || asked.question || '',
    ...(asked.asks ? { ...asked, title: `${meta.botName} asks` } : {}),
    error: meta.error ? clip(meta.error) : null,
    files: meta.files?.length ? meta.files : undefined, // what it attached; a notification opens a single file
    steered: meta.steered?.length ? meta.steered : undefined, // what the owner steered into it and it read (ADR 040)
    problem: withProblem(meta).problem || null, // the error said plainly
    quiet: quietRun(meta), // nothing for the owner: no notification
  };
}

module.exports = { emit, emitRun, since, subscribe, lastId, runSummary, clip, seenOnWeb, webActive };
