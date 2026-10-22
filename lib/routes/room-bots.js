// The account's bots as a shared room sees them (ADR 060, #316): GET /api/room-bots, asked by the front door alone,
// which sets x-botdot-room itself and strips it from every request a person sends. It checks an owner's bot when
// they add it to a room and before each turn; the room turn (POST /api/room-turn) checks the settings again.
const { NEXT, send } = require('./http');
const B = require('../bots');

function create({ fromFrontDoor }) {
  return async function routes(req, res, url, { parts, m }) {
    if (parts[0] !== 'room-bots' || parts[1]) return NEXT;
    if (!fromFrontDoor(req) || req.headers['x-botdot-room'] !== '1') return send(res, 403, { error: 'Only the front door asks for the room bots.' });
    if (m !== 'GET') return send(res, 405, { error: 'Not here' });
    // Only the bots their owner let into rooms, with their settings: nothing of the others, nothing else of a bot.
    const bots = B.bots.list().map((b) => ({ id: b.id, name: b.name, emoji: b.emoji, color: b.color, rooms: B.bots.roomSettings(b.id) }))
      .filter((b) => b.rooms.allowRooms);
    return send(res, 200, { bots });
  };
}

module.exports = { create };
