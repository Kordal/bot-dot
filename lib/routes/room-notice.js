// A new message in a shared room (ADR 060): the front door tells this account, which rings its owner
// (lib/room-notice.js). Only the front door: on its socket, with the header it alone sets and strips from every request
// a person sends. Not the owner, the Chief or a bot.
const { NEXT, send, readBody } = require('./http');
const B = require('../bots');
const feed = require('../events');
const roomNotice = require('../room-notice');

function create({ ACCOUNT, fromFrontDoor }) {
  return async function routes(req, res, url, { parts, m }) {
    if (parts[0] !== 'room-notice' || parts[1]) return NEXT;
    if (!fromFrontDoor(req) || req.headers['x-botdot-room'] !== '1') return send(res, 403, { error: 'Only the front door sends a room notice.' });
    if (m !== 'POST') return send(res, 405, { error: 'A room notice is a POST.' });
    let notice;
    try { notice = roomNotice.check(await readBody(req, 64e3)); } catch (e) { return send(res, e.status || 400, { error: e.message }); }
    const data = roomNotice.eventOf(notice, ACCOUNT, (id) => B.bots.get(id) || null);
    if (data) feed.emit('room_notice', data);
    return send(res, 200, { ok: true, rung: !!data });
  };
}

module.exports = { create };
