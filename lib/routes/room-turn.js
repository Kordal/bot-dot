// A room turn (ADR 060, #315): the front door asks one of this account's bots for its reply in a shared room
// (lib/room-turn.js). Only the front door: on its socket, with the header it alone sets and strips from every request a
// person sends. Not the owner, the Chief or a bot.
const { NEXT, send, readBody } = require('./http');
const B = require('../bots');
const roomTurn = require('../room-turn');

function create({ ACCOUNT, fromFrontDoor }) {
  const rooms = roomTurn.create({
    account: ACCOUNT,
    bot: (id) => B.bots.get(id),
    // The bot's room settings (#316); until they exist, no bot answers in a room.
    mayAnswer: (bot, how) => (typeof B.mayAnswerInRoom === 'function' ? B.mayAnswerInRoom(bot, how) : false),
    claudeOut: () => !B.CLAUDE_BIN || B.isClaudeOut(),
    ask: (prompt, opts) => require('../dresser').askClaude(prompt, opts),
    llmOf: (bot) => B.settings.forBot(bot),
  });
  return async function routes(req, res, url, { parts, m }) {
    if (parts[0] !== 'room-turn' || parts[1]) return NEXT;
    if (!fromFrontDoor(req) || req.headers['x-botdot-room'] !== '1') return send(res, 403, { error: 'Only the front door asks for a room turn.' });
    if (m !== 'POST') return send(res, 405, { error: 'A room turn is a POST.' });
    const body = await readBody(req, 2e6); // 50 messages of 4000 characters, each sign escaped at worst
    try { return send(res, 200, await rooms.turn(body)); } catch (e) { return send(res, e.status || 500, { error: e.status ? e.message : 'Something went wrong' }); }
  };
}

module.exports = { create };
