// The two ways a tool server of botdot (self, vault, connectors, computer, remote and the Chief's botdot) is spoken to,
// on one JSON-RPC handler each (ADR 267): over stdio, as its script is started (`BOT_DOT_MCP=stdio`, and the tests of the
// tools), and over HTTP, answered by botdot itself (lib/routes/mcp.js).
//
// A server module exports `create(env, { signal })`: `env` is what its script reads from the environment (`SELF_URL`,
// `RUN_TOKEN`, the flags that choose its tools…), `signal` is aborted when botdot closes the run's tools (none under
// stdio, where killing the process ends its calls), and what it returns has `handle(message)`, which answers a JSON-RPC message with
// the response object, or with nothing for a notification. Whatever state the server keeps (the computer is started
// once) lives in what `create` makes, so every run has its own.
const readline = require('readline');

// Newline-delimited JSON-RPC on standard input and output: `require.main === module` of a server's script.
function serveStdio(server) {
  readline.createInterface({ input: process.stdin }).on('line', (line) => {
    if (!line.trim()) return;
    let message;
    try { message = JSON.parse(line); } catch { return; /* ignore bad input */ }
    Promise.resolve().then(() => server.handle(message)).then((answer) => { if (answer) process.stdout.write(`${JSON.stringify(answer)}\n`); }, () => {});
  });
}

// A JSON-RPC response, as every server's `send` makes it.
const respond = (message) => ({ jsonrpc: '2.0', ...message });

// The signal of a call botdot makes for a tool: it ends when `ms` have passed (none: not by time) and when the run's
// tools are closed (ADR 267), `signal`, which a process of its own had in being killed.
const within = (signal, ms) => (ms === undefined ? signal : signal ? AbortSignal.any([AbortSignal.timeout(ms), signal]) : AbortSignal.timeout(ms));

module.exports = { serveStdio, respond, within };
