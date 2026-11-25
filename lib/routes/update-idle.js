// Whether the account is idle (#1688, lib/update-idle.js): GET /api/update/idle → { idle, working, nextStartAt,
// lastOwnerMessageAt }, which the front door asks before it switches the account to a new version (ADR 053). Only the
// front door: on its socket, with the header it alone sets and strips from every request a person sends. Not the owner
// through it, the Chief or a bot.
const { NEXT, send } = require('./http');

function create({ fromFrontDoor, updateIdle }) {
  return async function routes(req, res, url, { parts, m }) {
    if (parts[0] !== 'update' || parts[1] !== 'idle' || parts[2]) return NEXT;
    if (!fromFrontDoor(req) || req.headers['x-botdot-room'] !== '1') return send(res, 403, { error: 'Only the front door asks whether the account is idle.' });
    if (m !== 'GET') return send(res, 405, { error: 'Whether the account is idle is read with a GET.' });
    return send(res, 200, updateIdle.report());
  };
}

module.exports = { create };
