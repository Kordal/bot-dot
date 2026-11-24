// A bot's part in shared rooms (ADR 060, #316): every bot may be in them, always (ADR 269), and only its owner may mention
// it until its owner says anyone in the room may. Kept on the bot as `rooms` (docs/api.md, Shared rooms); the account is
// the last word on it, whatever the front door asks.
const ROOM_MENTIONERS = ['owner', 'anyone'];
const ROOM_DEFAULTS = { allowRooms: true, whoMayMention: 'owner' };
// A bot's room settings after a change: what was saved, with the keys given merged in. Throws a sentence (400).
// `allowRooms` is true whatever was saved or given: no setting turns it off (ADR 269), and a value of it is still checked
// as a boolean so an app on an older server's way of saving keeps working.
function roomsAfter(input, existing) {
  const was = { ...ROOM_DEFAULTS, ...(existing && typeof existing === 'object' ? existing : {}) };
  const now = { allowRooms: true, whoMayMention: ROOM_MENTIONERS.includes(was.whoMayMention) ? was.whoMayMention : 'owner' };
  if (input === undefined) return now;
  const bad = (msg) => Object.assign(new Error(msg), { status: 400 });
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw bad('rooms must be an object, e.g. { "whoMayMention": "anyone" }.');
  if ('allowRooms' in input && typeof input.allowRooms !== 'boolean') throw bad('rooms.allowRooms must be true or false.');
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
