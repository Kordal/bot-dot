// A bot's part in shared rooms (ADR 060, #316): off until its owner turns it on, and only its owner may mention it.
// Kept on the bot as `rooms` (docs/api.md, Shared rooms); the account is the last word on it, whatever the front door asks.
const ROOM_MENTIONERS = ['owner', 'anyone'];
const ROOM_DEFAULTS = { allowRooms: false, whoMayMention: 'owner' };
// A bot's room settings after a change: what was saved, with the keys given merged in. Throws a sentence (400).
function roomsAfter(input, existing) {
  const was = { ...ROOM_DEFAULTS, ...(existing && typeof existing === 'object' ? existing : {}) };
  const now = { allowRooms: was.allowRooms === true, whoMayMention: ROOM_MENTIONERS.includes(was.whoMayMention) ? was.whoMayMention : 'owner' };
  if (input === undefined) return now;
  const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw bad('rooms must be an object, e.g. { "allowRooms": true }.');
  if ('allowRooms' in input) {
    if (typeof input.allowRooms !== 'boolean') throw bad('rooms.allowRooms must be true or false.');
    now.allowRooms = input.allowRooms;
  }
  if ('whoMayMention' in input) {
    if (!ROOM_MENTIONERS.includes(input.whoMayMention)) throw bad('rooms.whoMayMention must be "owner" or "anyone".');
    now.whoMayMention = input.whoMayMention;
  }
  return now;
}
// Whether a bot answers a mention in a shared room: rooms on, and the mention is its owner's or anyone may mention it.
// byOwner: the mention was written by this bot's own account. The account is the last word on it (ADR 060).
function mayAnswerInRoom(bot, { byOwner = false } = {}) {
  const r = roomsAfter(undefined, bot?.rooms);
  return !!bot && r.allowRooms && (byOwner === true || r.whoMayMention === 'anyone');
}

module.exports = { ROOM_DEFAULTS, ROOM_MENTIONERS, roomsAfter, mayAnswerInRoom };
