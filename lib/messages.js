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
    list.push({ id: crypto.randomUUID().slice(0, 8), at: new Date().toISOString(), ...msg });
    writeJson(file(botId), fresh(list));
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
  // follow-up reads once everyone asked has answered (awaits.js).
  const wakes = (botId) => peekInbox(botId).some((m) => !m.answer);

  return { addToInbox, takeInbox, peekInbox, inboxCount, wakes };
}

// Clean up what a bot sends: plain text, not too long.
function cleanText(t) {
  return String(t || '').replace(/\r\n/g, '\n').trim().slice(0, MAX_CHARS);
}

module.exports = { create, cleanText, MAX_HOPS, MAX_CHARS };
