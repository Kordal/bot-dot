// A notice of a new message in a shared room (ADR 060): the front door tells each member's account of a person's or a
// bot's message there, and the account rings its owner, in the web page's push and the Android app, as it does for a
// reply. The room and its messages stay in the front door: what is kept here is one feed event, with the room's name,
// who wrote (as the front door labels it) and a short preview, nothing more.
//
// The owner's own words written in the room ring nothing: the owner wrote them. A reply of the owner's own bot does.
const { plain } = require('./push');

const ROOM_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
// An account's name, as the front door makes them (lib/front-door/store.js ACCOUNT_NAME).
const ACCOUNT_RE = /^[a-z][a-z0-9-]{1,23}$/;
const ROOM_NAME_MAX = 80;
const NAME_MAX = 60;
const TEXT_MAX = 4000;
const PREVIEW_MAX = 140;

const bad = (message) => Object.assign(new Error(message), { status: 400 });
const isText = (v, max) => typeof v === 'string' && v.trim() !== '' && v.length <= max;
const oneLine = (t) => String(t).replace(/\s+/g, ' ').trim();
const clip = (t, n) => (t.length > n ? `${t.slice(0, n - 1)}…` : t);

// The front door's body, checked: { room: { id, name }, message: { id?, at?, account, bot: { id, name } | null, text,
// kind: "text" } }. Throws a 400 for anything else; a notice of the front door's own (kind "notice") is one too.
function check(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw bad('A room notice is a JSON object.');
  const { room, message: m } = body;
  if (!room || typeof room !== 'object' || !ROOM_ID_RE.test(String(room.id)) || !isText(room.name, ROOM_NAME_MAX)) throw bad('A room is { id, name }.');
  if (!m || typeof m !== 'object' || m.kind !== 'text' || !ACCOUNT_RE.test(String(m.account)) || typeof m.text !== 'string' || m.text.length > TEXT_MAX) {
    throw bad('A message is { account, bot, text, kind: "text" } within its limits.');
  }
  const bot = m.bot == null ? null : m.bot;
  if (bot !== null && (typeof bot !== 'object' || typeof bot.id !== 'string' || !bot.id || bot.id.length > 80 || !isText(bot.name, NAME_MAX))) throw bad('A bot is { id, name }.');
  return {
    room: { id: room.id, name: oneLine(room.name) },
    message: {
      ...(typeof m.id === 'string' && m.id.length <= 64 ? { id: m.id } : {}),
      ...(typeof m.at === 'string' ? { at: m.at.slice(0, 40) } : {}),
      account: m.account, bot: bot && { id: bot.id, name: oneLine(bot.name) }, text: m.text,
    },
  };
}

// The feed event's data for a checked notice, or null when it rings nothing (the owner's own words). account: this
// account's name; ownBot(id): this account's bot of that id, for its colour, or null.
function eventOf({ room, message }, account, ownBot = () => null) {
  if (!message.bot && message.account === account) return null;
  const mine = message.bot && message.account === account ? ownBot(message.bot.id) : null;
  const from = {
    name: message.bot ? `${message.bot.name} · ${message.account}` : message.account,
    account: message.account,
    ...(message.bot ? { botId: message.bot.id } : {}),
    ...(mine?.color ? { color: mine.color } : {}),
  };
  return {
    roomId: room.id, roomName: room.name, from,
    preview: clip(oneLine(plain(message.text)), PREVIEW_MAX) || '…',
    ...(message.id ? { messageId: message.id } : {}),
    ...(message.at ? { sentAt: message.at } : {}),
  };
}

module.exports = { check, eventOf, PREVIEW_MAX };
