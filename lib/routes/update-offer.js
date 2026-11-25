// What the front door tells the account of its update (#1690, lib/update-offer.js): POST /api/update/offer → { ok: true }.
// Only the front door: on its socket, with the header it alone sets and strips from every request a person sends. Not the
// owner through it, the Chief or a bot.
const { NEXT, send, readBody } = require('./http');

function create({ fromFrontDoor, updateOffer }) {
  return async function routes(req, res, url, { parts, m }) {
    if (parts[0] !== 'update' || parts[1] !== 'offer' || parts[2]) return NEXT;
    if (!fromFrontDoor(req) || req.headers['x-botdot-room'] !== '1') return send(res, 403, { error: 'Only the front door tells the account about its update.' });
    if (m !== 'POST') return send(res, 405, { error: 'The update is told with a POST.' });
    try { updateOffer.tell(await readBody(req)); } catch (e) { return send(res, e.status || 500, { error: e.message }); }
    return send(res, 200, { ok: true });
  };
}

module.exports = { create };
