// The admin's boat.dev key (#529, lib/boat.js, ADR 086): what a bot whose computer is on boat.dev works with. Only the
// front door: on its socket, with the header it alone sets and strips from every request a person sends. Not the
// owner, the Chief or a bot. The key is kept in memory alone and never answered.
const { NEXT, send, readBody } = require('./http');
const boat = require('../boat');

function create({ fromFrontDoor }) {
  return async function routes(req, res, url, { parts, m }) {
    if (parts[0] !== 'boat' || parts[1]) return NEXT;
    if (!fromFrontDoor(req) || req.headers['x-botdot-room'] !== '1') return send(res, 403, { error: 'Only the front door sets the boat.dev key.' });
    if (m !== 'POST') return send(res, 405, { error: 'The boat.dev key is set with a POST.' });
    try { return send(res, 200, { set: boat.setKey(((await readBody(req, 4e3)) || {}).key ?? null) }); } catch (e) { return send(res, e.status || 400, { error: e.message }); }
  };
}

module.exports = { create };
