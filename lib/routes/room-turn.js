// A room turn (ADR 060, #315): the front door asks one of this account's bots for its reply in a shared room
// (lib/room-turn.js). Only the front door: on its socket, with the header it alone sets and strips from every request a
// person sends. Not the owner, the Chief or a bot.
// The owner's own mention starts the bot's run in its own chat instead (ADR 067, lib/room-runs.js), and what this
// account sends to rooms waits in its outbox until the front door collects it: POST /api/room-sync.
const { NEXT, send, readBody } = require('./http');
const B = require('../bots');
const roomTurn = require('../room-turn');

function create({ ACCOUNT, fromFrontDoor, roomRuns }) {
  const rooms = roomTurn.create({
    account: ACCOUNT,
    bot: (id) => B.bots.get(id),
    // The bot's room settings (#316); until they exist, no bot answers in a room.
    mayAnswer: (bot, how) => (typeof B.mayAnswerInRoom === 'function' ? B.mayAnswerInRoom(bot, how) : false),
    claudeOut: () => !B.CLAUDE_BIN || B.isClaudeOut(),
    ask: (prompt, opts) => require('../dresser').askClaude(prompt, opts),
    llmOf: (bot) => B.settings.forBot(bot),
    // A run in the bot's own chat, as a message of the owner's that may wait its turn there (ADR 011).
    ownerRun: (bot, asked) => {
      const text = asked.messages.at(-1).text;
      const room = { id: asked.room.id, name: asked.room.name, context: roomTurn.runContext(asked, ACCOUNT) };
      const r = B.askBot(bot, { prompt: text, text, room });
      const runId = (r.run || r.queued).id;
      roomRuns.started(bot.id, asked.room.id, runId);
      return runId;
    },
  });
  return async function routes(req, res, url, { parts, m }) {
    if ((parts[0] !== 'room-turn' && parts[0] !== 'room-sync') || parts[1]) return NEXT;
    if (!fromFrontDoor(req) || req.headers['x-botdot-room'] !== '1') return send(res, 403, { error: 'Only the front door asks for a room turn.' });
    if (m !== 'POST') return send(res, 405, { error: `A ${parts[0]} is a POST.` });
    if (parts[0] === 'room-sync') {
      const body = await readBody(req, 1e6);
      try { return send(res, 200, roomRuns.sync(body)); } catch (e) { return send(res, e.status || 500, { error: e.status ? e.message : 'Something went wrong' }); }
    }
    const body = await readBody(req, 2e6); // 50 messages of 4000 characters, each sign escaped at worst
    try {
      const out = await rooms.turn(body);
      return send(res, out.started ? 202 : 200, out);
    } catch (e) { return send(res, e.status || 500, { error: e.status ? e.message : 'Something went wrong' }); }
  };
}

module.exports = { create };
