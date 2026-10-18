// Slowing down whoever keeps failing to sign in (ADR 028): a wrong passkey, or a sign-up link that isn't one.
// Per client: the first FREE failures cost nothing; after them each try waits twice as long as the one before,
// from 1 second up to 15 minutes. A client that stops failing for an hour is forgotten, and one that signs in is
// forgotten at once.
const FREE = 5;
const MAX_WAIT = 15 * 60_000;
const FORGET = 3600_000;

function create({ now = () => Date.now() } = {}) {
  const fails = new Map(); // client → { count, last }

  const sweep = () => { for (const [k, f] of fails) if (now() - f.last > FORGET) fails.delete(k); };
  const timer = setInterval(sweep, 60_000);
  timer.unref();

  // How many milliseconds this client must still wait before it may try, or 0.
  function wait(client) {
    const f = fails.get(client);
    if (!f || f.count < FREE) return 0;
    const delay = Math.min(1000 * 2 ** (f.count - FREE), MAX_WAIT);
    return Math.max(0, f.last + delay - now());
  }
  function failed(client) {
    const f = fails.get(client) || { count: 0, last: 0 };
    fails.set(client, { count: f.count + 1, last: now() });
  }
  const succeeded = (client) => fails.delete(client);

  return { wait, failed, succeeded };
}

// Who is asking: the address that reached the front door, or, when that is this machine (Caddy or Tailscale Serve
// in front), the one address that Caddy or Serve added last. Never one the client wrote itself.
function clientOf(req) {
  const peer = String(req.socket.remoteAddress || '').replace(/^::ffff:/i, '');
  const local = peer === '::1' || peer.startsWith('127.');
  const added = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean).pop();
  return local && added ? added : peer;
}

module.exports = { create, clientOf, FREE };
