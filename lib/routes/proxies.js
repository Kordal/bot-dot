// The account's proxies (/api/proxies, ADR 171): the owner adds, changes, tests and removes them in Settings → Proxy
// and picks the one every bot uses (`default`); the Chief may read them, test one and pick the default, never add one
// or see a login's password. A bot's own choice is its `proxy` (PUT /api/bots/:id).
const { NEXT, send, readBody } = require('./http');
const B = require('../bots');
const proxiesLib = require('../proxies');
const check = require('../proxy-check');
const feed = require('../events');

const OWNER_ONLY = 'Only the owner adds, changes or removes a proxy, in Settings → Proxy: its login never reaches the Chief.';

function create() {
  const list = () => ({ proxies: B.proxies.list(), default: proxiesLib.cleanRef(B.settings.get().proxy) });
  const changed = () => feed.emit('bots', {}); // the apps read Settings and the bots again
  return async function routes(req, res, url, { parts, m, by }) {
    if (parts[0] !== 'proxies') return NEXT;
    if (!parts[1] && m === 'GET') return send(res, 200, list());
    // The account's proxy, '' for none: what a bot uses that has no choice of its own.
    if (parts[1] === 'default' && !parts[2] && m === 'PUT') {
      const { proxy = '' } = (await readBody(req)) || {};
      const ref = proxiesLib.cleanRef(proxy) === 'none' ? '' : proxiesLib.cleanRef(proxy);
      if (String(proxy ?? '').trim() !== ref && proxy !== 'none') return send(res, 400, { error: 'proxy must be "" or the id of a saved proxy' });
      if (ref && !B.proxies.get(ref)) return send(res, 404, { error: 'No such proxy' });
      B.settings.update({ proxy: ref });
      changed();
      return send(res, 200, list());
    }
    // A form's proxy before it is saved: its test, with the saved password when the form leaves it empty.
    if (parts[1] === 'test' && !parts[2] && m === 'POST') {
      if (by === 'chief') return send(res, 403, { error: OWNER_ONLY });
      const body = (await readBody(req)) || {};
      let draft;
      try { draft = B.proxies.draft(body, typeof body.id === 'string' ? body.id : null); } catch (e) { return send(res, 400, { error: e.message }); }
      return send(res, 200, await check.check(draft));
    }
    if (!parts[1] && m === 'POST') {
      if (by === 'chief') return send(res, 403, { error: OWNER_ONLY });
      let p;
      try { p = B.proxies.add((await readBody(req)) || {}); } catch (e) { return send(res, 400, { error: e.message }); }
      changed();
      return send(res, 201, { proxy: p });
    }
    const id = parts[1];
    if (!B.proxies.get(id)) return send(res, 404, { error: 'No such proxy' });
    // Its test, kept with it: { ok, ip, country, city, ms } or { ok: false, error }.
    if (parts[2] === 'test' && !parts[3] && m === 'POST') {
      const result = await check.check(B.proxies.forBridge(id));
      const proxy = B.proxies.tested(id, result);
      changed();
      return send(res, 200, { ...result, proxy });
    }
    if (parts[2]) return NEXT;
    if (m === 'GET') return send(res, 200, { proxy: B.proxies.get(id) });
    if (by === 'chief') return send(res, 403, { error: OWNER_ONLY });
    if (m === 'PUT') {
      let p;
      try { p = B.proxies.update(id, (await readBody(req)) || {}); } catch (e) { return send(res, 400, { error: e.message }); }
      changed();
      return send(res, 200, { proxy: p });
    }
    // Removed: the account and the bots that used it go back to none and the account's.
    if (m === 'DELETE') {
      B.proxies.remove(id);
      if (proxiesLib.cleanRef(B.settings.get().proxy) === id) B.settings.update({ proxy: '' });
      for (const b of B.bots.list().filter((x) => x.proxy === id)) B.bots.update(b.id, { proxy: '' }, { by });
      changed();
      return send(res, 200, list());
    }
    return send(res, 405, { error: 'GET, PUT or DELETE' });
  };
}

module.exports = { create };
