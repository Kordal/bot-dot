// Bots messaging bots: a bot can hand a task to a teammate or tell it something, like texting a
// colleague. A priority message starts a run of the other bot (queued if it's busy) and its sender waits for the
// answer; anything else is a note in its inbox, read at the start of its next run. A note wakes the bot as soon as
// it is free (bots.js wakeForNotes, #225), so it never waits for a run that nothing starts. Replies are just
// messages back.
//
// What the server checks rather than trusting the AI:
//   - a bot may only message the bots in its "may message" list (and reply to whoever messaged it)
//   - a chain of hand-offs is at most MAX_HOPS long: a safety net so two bots can't answer each other forever
const path = require('path');
const crypto = require('crypto');
const { readJson, writeJson } = require('./jsonfile');

const MAX_HOPS = 20;
const INBOX_MAX = 20;
const INBOX_DAYS = 7;
const MAX_CHARS = 4000;

function create(dataDir) {
  const DIR = path.join(dataDir, 'inbox');
  const file = (botId) => path.join(DIR, `${String(botId).replace(/[^\w-]/g, '')}.json`);

  // ---------- inbox (messages that don't need the bot now) ----------

  const fresh = (list) => list.filter((m) => Date.now() - Date.parse(m.at) < INBOX_DAYS * 864e5).slice(-INBOX_MAX);

  function addToInbox(botId, msg) {
    const list = fresh(readJson(file(botId), []));
    const note = { id: crypto.randomUUID().slice(0, 8), at: new Date().toISOString(), ...msg };
    list.push(note);
    writeJson(file(botId), fresh(list));
    return note;
  }

  // A note the wake gate held (lib/wake-gate.js): it stays, wakes nothing, and the next run reads it. False when it
  // was read already.
  function holdNote(botId, id, later) {
    const list = fresh(readJson(file(botId), []));
    const note = list.find((m) => m.id === id);
    if (!note) return false;
    note.later = later;
    writeJson(file(botId), list);
    return true;
  }

  // Of the notes that match, the newest n stay: a job's calls the wake gate held (bots.js gateCall), so that a
  // service that calls every minute fills no inbox.
  function keepNewest(botId, match, n) {
    const list = fresh(readJson(file(botId), []));
    const drop = new Set(list.filter(match).slice(0, -n).map((m) => m.id));
    if (drop.size) writeJson(file(botId), list.filter((m) => !drop.has(m.id)));
  }

  // The messages waiting for a bot, emptied as its run reads them.
  function takeInbox(botId) {
    const list = fresh(readJson(file(botId), []));
    if (list.length) writeJson(file(botId), []);
    return list;
  }

  // The messages waiting for a bot, left where they are (the owner sees them in its chat).
  const peekInbox = (botId) => fresh(readJson(file(botId), []));
  const inboxCount = (botId) => peekInbox(botId).length;
  // Whether a note waits that wakes the bot: any but the answers a waiting bot collects (`answer`), which its
  // follow-up reads once everyone asked has answered (awaits.js), and the notes the wake gate held (`later`).
  // held: the held ones too, for the owner's "Run now".
  const wakes = (botId, { held = false } = {}) => peekInbox(botId).some((m) => !m.answer && (held || !m.later));

  return { addToInbox, holdNote, keepNewest, takeInbox, peekInbox, inboxCount, wakes };
}

// Clean up what a bot sends: plain text, not too long.
function cleanText(t) {
  return String(t || '').replace(/\r\n/g, '\n').trim().slice(0, MAX_CHARS);
}

module.exports = { create, cleanText, MAX_HOPS, MAX_CHARS };
