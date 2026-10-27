// A replay's computer tools (#595, ADR 104, lib/replay-computer-mcp.js): run_shell, read_file and write_file on the copy
// of the bot's computer that botdot made for that one replay. The replay's key (X-Replay-Key) names the copy; there is
// no way from here to the bot's own computer, a screen or a saved login.
const { NEXT, send, readBody } = require('./http');
const B = require('../bots');

const FILE_MAX_BYTES = 1024 * 1024;
const cut = (t) => String(t || '').slice(0, 20000);

function create() {
  return async function routes(req, res, url, { parts, m }) {
    if (parts[0] !== 'replay' || parts[1] !== 'session') return NEXT;
    const copy = B.replayComputers.byKey(req.headers['x-replay-key']);
    if (!copy) return send(res, 401, { ok: false, error: 'This replay has ended.' });
    const what = parts[2];
    if (!['shell', 'read', 'write'].includes(what) || parts[3] || m !== 'POST') return send(res, 404, { ok: false, error: 'No such tool' });
    const body = (await readBody(req, 3e6)) || {};
    if (what === 'shell' && (!body.command || typeof body.command !== 'string' || body.command.length > 100_000)) return send(res, 400, { ok: false, error: 'Say which command to run' });
    if (what !== 'shell' && (!body.path || typeof body.path !== 'string' || body.path.length > 4096 || body.path.includes('\0'))) return send(res, 400, { ok: false, error: 'Say which file' });
    if (what === 'write' && (typeof body.content !== 'string' || Buffer.byteLength(body.content) > FILE_MAX_BYTES)) return send(res, 400, { ok: false, error: 'Say what to write, at most 1 MB at once' });
    let r;
    try {
      if (what === 'shell') r = await copy.runShell({ command: body.command, timeoutSeconds: Math.min(Math.max(Number(body.timeoutSeconds) || 120, 1), 600) });
      else if (what === 'read') r = await copy.readFile({ path: body.path });
      else r = await copy.writeFile({ path: body.path, content: body.content });
    } catch (e) { r = { code: null, error: e.message }; }
    if (what === 'shell') return send(res, 200, { ok: true, stdout: cut(r.stdout), stderr: cut(r.stderr), exitCode: r.code ?? null, timedOut: !!r.timedOut, ...(r.error ? { error: r.error } : {}) });
    if (r.code !== 0) return send(res, 200, { ok: false, error: `Couldn't ${what} ${body.path}: ${(r.stderr || r.error || 'no answer from the copy').trim().slice(0, 300)}` });
    return send(res, 200, what === 'read' ? { ok: true, content: r.stdout } : { ok: true });
  };
}

module.exports = { create };
