// Notifications on this device (issue #87, lib/push.js): the account's public key, and the subscriptions of the
// browsers that asked for them. The owner's alone: the Chief's tools are refused (CHIEF_ROUTES), a bot is stopped
// at the gate, and so is anything that did not come through the front door.
const { NEXT, send, readBody } = require('./http');

function create({ push }) {
  return async function routes(req, res, url, { parts, m, by }) {
    if (parts[0] !== 'push') return NEXT;
    if (by !== 'you') return send(res, 403, { error: 'Only the owner turns on notifications.' });
    if (parts[1] === 'key' && !parts[2] && m === 'GET') return send(res, 200, { publicKey: push.publicKey() });
    if (parts[1] === 'subscriptions' && !parts[2] && (m === 'POST' || m === 'DELETE')) {
      const body = await readBody(req, 16 * 1024);
      if (m === 'DELETE') return send(res, 200, { ok: true, removed: push.remove(String(body.endpoint || '')) });
      push.publicKey(); // the keys exist before the first push
      // The push service is told where a push comes from: botdot's address, as this browser reached it.
      const host = String(req.headers.host || '');
      push.add(body, { subject: /^[\w.-]+(:\d+)?$/.test(host) ? `https://${host}` : null, device: body.device });
      return send(res, 200, { ok: true });
    }
    return send(res, 404, { error: 'Unknown push route.' });
  };
}

module.exports = { create };
