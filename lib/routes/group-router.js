// What the admin chose to pick who answers in a group (#513, lib/group-router.js): Haiku, or Jev with the admin's
// OpenRouter key. Only the front door: on its socket, with the header it alone sets and strips from every request a
// person sends. Not the owner, the Chief or a bot. The key is kept in memory alone and never answered.
const { NEXT, send, readBody } = require('./http');
const router = require('../group-router');

function create({ fromFrontDoor }) {
  return async function routes(req, res, url, { parts, m }) {
    if (parts[0] !== 'group-router' || parts[1]) return NEXT;
    if (!fromFrontDoor(req) || req.headers['x-botdot-room'] !== '1') return send(res, 403, { error: 'Only the front door sets the group router.' });
    if (m !== 'POST') return send(res, 405, { error: 'The group router is set with a POST.' });
    try { return send(res, 200, { router: router.setConfig((await readBody(req, 4e3)) || {}) }); } catch (e) { return send(res, e.status || 400, { error: e.message }); }
  };
}

module.exports = { create };
