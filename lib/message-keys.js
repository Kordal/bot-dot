// A message is taken once (docs/api.md, "A message sent twice"). An app gives every message the owner sends a
// key and sends the same key when it sends that message again, because it cannot tell a request that never
// arrived from one whose answer was lost. botdot keeps the key of a message it took, with the chat it was for
// (a Chief chat, a bot's chat or a group's), for 24 hours and across a restart (data/message-keys.json): the same key there again starts
// nothing and adds nothing. A key is kept when the message is taken, never for a request that was refused.
const path = require('path');
const { readJson, writeJson } = require('./jsonfile');

const KEY = /^[A-Za-z0-9_-]{8,64}$/;
const KEPT_MS = 24 * 60 * 60e3;
const ILL_FORMED = "A message's key is 8 to 64 characters: letters, digits, - and _.";

// A request's `key`: null when it has none, the key, or an error with status 400 for one that is ill-formed.
function read(key) {
  if (key === undefined || key === null) return null;
  if (typeof key !== 'string' || !KEY.test(key)) throw Object.assign(new Error(ILL_FORMED), { status: 400 });
  return key;
}

// now: the clock, for the tests.
function create(dataDir, { now = Date.now } = {}) {
  const file = path.join(dataDir, 'message-keys.json');
  // "<where> <key>" → { at, ...what was kept with it }. where: the chat's key, "chief:<chatId>", "bot:<botId>" or "group:<groupId>"; none holds a space.
  let kept = readJson(file, {});
  if (!kept || typeof kept !== 'object' || Array.isArray(kept)) kept = {};
  const fresh = (e) => e && typeof e.at === 'number' && now() - e.at < KEPT_MS;

  // What was kept with this key when its message was taken there, or null: never taken, or more than 24 hours ago.
  function taken(where, key) {
    const e = kept[`${where} ${key}`];
    return fresh(e) ? e : null;
  }

  // The message with this key was taken there. `with_`: what the answer to the same key needs later (a run's id).
  // The keys older than 24 hours go with every write, so the file holds a day of messages at most. A key that
  // could not be written is not kept in memory either: what botdot says of a key is what a restart would say.
  function take(where, key, with_ = {}) {
    const next = Object.fromEntries(Object.entries(kept).filter(([, e]) => fresh(e)));
    next[`${where} ${key}`] = { ...with_, at: now() };
    writeJson(file, next);
    kept = next;
  }

  // A message that waited was taken back (ADR 011): its key is free again, so the same message may be sent anew.
  function forget(where, key) {
    if (!kept[`${where} ${key}`]) return;
    const next = Object.fromEntries(Object.entries(kept).filter(([k, e]) => k !== `${where} ${key}` && fresh(e)));
    writeJson(file, next);
    kept = next;
  }

  return { taken, take, forget };
}

module.exports = { create, read, KEPT_MS };
