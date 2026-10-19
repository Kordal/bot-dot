// Settings → Updates (lib/updates.js); on a machine of accounts the admin updates botdot (ADR 028).
const { NEXT, send, readBody } = require('./http');

function create(ctx) {
  const { UPDATES_BY_ADMIN, BY_ADMIN, updates } = ctx;
  return async function routes(req, res, url, { parts, m }) {
    if (parts[0] === 'updates') {
      if (UPDATES_BY_ADMIN) {
        if (parts[1] === 'apply' && m === 'POST') return send(res, 403, { error: BY_ADMIN });
        const quiet = { supported: false, byAdmin: true, state: 'idle', available: false, error: null, selfBuilt: false, version: (await updates.status().catch(() => null))?.version || null };
        if ((!parts[1] && m === 'GET') || (parts[1] === 'check' && m === 'POST')) return send(res, 200, quiet);
      }
      if (!parts[1] && m === 'GET') return send(res, 200, await updates.status());
      if (parts[1] === 'check' && m === 'POST') return send(res, 200, await updates.check());
      if (parts[1] === 'apply' && m === 'POST') return send(res, 202, await updates.apply(await readBody(req)));
    }
    return NEXT;
  };
}

module.exports = { create };
