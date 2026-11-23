// boat.dev as an HTTP server for tests that start the account's server (BOT_DOT_BOAT_URL): `GET /me` says what the key is
// worth (boat_refusedkey…: 401, boat_billingkey…: 402, boat_downkey…: 500, any other: ok); machines are made, found and
// deleted by the key that made them (another key finds none, as at boat.dev). `hang` makes every other call wait for ever.
const http = require('node:http');

async function fakeBoatHttp() {
  const seen = []; // { method, path, key }
  const machines = new Map(); // id -> { key, name }
  const state = { hang: false, failDelete: false, n: 0 };
  const server = http.createServer((req, res) => {
    const key = String(req.headers.authorization || '').replace(/^Bearer /, '');
    const path = new URL(req.url, 'http://x').pathname.replace(/^\/api\/v1/, '');
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      let body = null;
      try { body = raw ? JSON.parse(raw) : null; } catch { /* none */ }
      seen.push({ method: req.method, path, key, body });
      const reply = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
      if (path === '/me') {
        if (key.startsWith('boat_refusedkey')) return reply(401, { ok: false, code: 'unauthorized' });
        if (key.startsWith('boat_billingkey')) return reply(402, { ok: false, code: 'payment_required' });
        if (key.startsWith('boat_downkey')) return reply(500, { ok: false });
        return reply(200, { ok: true });
      }
      if (state.hang) return;
      if (path === '/sandboxes' && req.method === 'POST') {
        const id = `bx_${String(++state.n).padStart(8, 'f')}`;
        machines.set(id, { key, name: body?.name });
        return reply(202, { ok: true, sandbox: { id, state: 'provisioning' } });
      }
      const m = path.match(/^\/sandboxes\/(bx_[a-z0-9]+)(?:\/(.+))?$/);
      const box = m && machines.get(m[1]);
      if (!box || box.key !== key) return reply(404, { ok: false, code: 'not_found' });
      if (!m[2] && req.method === 'DELETE') {
        if (state.failDelete) return reply(500, { ok: false, code: 'internal' });
        machines.delete(m[1]);
        return reply(200, { ok: true });
      }
      if (!m[2]) return reply(200, { ok: true, sandbox: { id: m[1], state: 'ready' } });
      if (m[2] === 'stop') return reply(202, { ok: true });
      return reply(200, { ok: true, exitCode: 0, stdout: '', stderr: '', timedOut: false });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    seen, machines, state,
    close: () => { server.closeAllConnections?.(); server.close(); },
  };
}

module.exports = { fakeBoatHttp };
