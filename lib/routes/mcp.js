// A run's tool servers, answered by botdot itself over MCP's Streamable HTTP (ADR 270): POST /api/mcp/<server>, with the
// run's token for that server as `Authorization: Bearer <token>` (lib/mcp-sessions.js). Claude Code calls it as it would
// call a process it had started; the tools themselves do what they did there, and call botdot's own routes.
const { send, readBody } = require('./http');
const mcp = require('../mcp-sessions');
const B = require('../bots');

// A tool may run as long as Claude Code waits for it (MCP_TOOL_TIMEOUT: 15 minutes for a bot's run, 10 to 15 for a Chief's
// turn), but Claude Code gives up on a call that has sent "no response or progress" for 300 seconds, and a comment in a
// stream is neither (measured with 2.1.330 and 2.1.331). So the answer to a call begins at once, as a stream, and every
// KEEP_ALIVE_MS a comment goes down it and, for a call that gave a progress token, a progress notification: that is what
// Claude Code counts. The notification is the call's own, which MCP allows a server to send before its result.
const KEEP_ALIVE_MS = () => Number(process.env.BOT_DOT_MCP_KEEPALIVE_MS) || 20_000;
// The biggest message a tool call may be (a file a computer tool writes): a process on stdin had no limit.
const BODY_MAX = 64 * 1024 * 1024;

const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

function create(ctx) {
  return async function routes(req, res, url) {
    const name = url.pathname.slice(mcp.PATH.length);
    if (!mcp.SERVERS[name]) return send(res, 404, { error: 'Unknown endpoint' });
    // Only the run's own tools come here, never the owner's request through the front door.
    if (ctx.fromFrontDoor(req)) return send(res, 404, { error: 'Unknown endpoint' });
    // The server has nothing to say that is not an answer: no stream of its own (GET), and no session to end (DELETE).
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return send(res, 405, { error: 'This server answers POST requests only.' }); }
    const session = mcp.find(mcp.bearer(req.headers), name);
    // A run of a bot's own user reaches its own tools only (server.js gate has let the address through).
    const who = B.identity.identify(req.socket);
    const other = who && typeof who === 'object' && who.bot !== session?.botId;
    if (!session || other) return send(res, 401, { error: 'This run is over, or this is not its token.' });

    let message;
    try { message = await readBody(req, BODY_MAX); } catch (e) { return send(res, e.status || 400, { error: e.message }); }
    if (!message || typeof message !== 'object' || Array.isArray(message) || typeof message.jsonrpc !== 'string') return send(res, 400, rpcError(null, -32600, 'Send one JSON-RPC message.'));
    // A notification, or an answer to something botdot did not ask: accepted, and nothing to say.
    if (message.method === undefined || message.id === undefined) { res.writeHead(202); return res.end(); }

    const answer = () => Promise.resolve().then(() => session.server.handle(message)).then((a) => a || rpcError(message.id, -32600, 'Nothing to answer.'), (e) => rpcError(message.id, -32603, e.message));
    const streams = message.method === 'tools/call' && /text\/event-stream/.test(String(req.headers.accept || ''));
    if (!streams) {
      const a = await answer();
      return send(res, 200, a);
    }
    res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-store, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
    res.flushHeaders();
    res.write(': botdot\n\n');
    // A client that went away ends nothing here: the tool runs on to its own end, and its answer has nowhere to go.
    const progressToken = message.params?._meta?.progressToken;
    let progress = 0;
    const beat = setInterval(() => {
      if (res.destroyed) return;
      res.write(': keep-alive\n\n');
      if (progressToken !== undefined) res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/progress', params: { progressToken, progress: ++progress, message: 'The tool is still working.' } })}\n\n`);
    }, KEEP_ALIVE_MS());
    res.on('close', () => clearInterval(beat));
    const a = await answer();
    clearInterval(beat);
    if (!res.destroyed && !res.writableEnded) res.end(`event: message\ndata: ${JSON.stringify(a)}\n\n`);
  };
}

module.exports = { create };
