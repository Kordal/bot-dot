// The tool servers of a run (self, vault, connectors, computer, remote) and of the Chief's turns and looks (botdot,
// connectors, remote): how Claude Code is told to reach them, and what botdot keeps for each (ADR 267).
//
// By default botdot serves them itself, over MCP's Streamable HTTP, at /api/mcp/<server> (lib/routes/mcp.js): the run's
// MCP file names that address and a token of the run's and the server's own, and no process is started. What the server
// would have read from its environment (the run's key, the flags that choose its tools) stays here, in botdot, and the
// file holds none of it. `BOT_DOT_MCP=stdio` brings back a Node process for each server, started by Claude Code.
const crypto = require('crypto');
const path = require('path');

// The server of each name in a run's MCP file, and the module that is it.
const SERVERS = {
  self: 'self-mcp',
  vault: 'vault-mcp',
  connectors: 'connectors-mcp',
  computer: 'computer-mcp',
  remote: 'custom-mcp',
  botdot: 'mcp-server',
};
const PATH = '/api/mcp/';

const sessions = new Map(); // token -> { name, env, botId, server }

const stdio = () => String(process.env.BOT_DOT_MCP || '').trim().toLowerCase() === 'stdio';
const port = () => Number(process.env.PORT) || 4747;

// The entry of server `name` for a run's MCP file, and what ends it: { config, close }. `env` is what its script reads
// from the environment; `botId` is the bot whose run it is (none for the Chief's). close() is called once, when the run
// ends: from then on its token is refused.
function serve(name, env, { botId = null } = {}) {
  if (!SERVERS[name]) throw new Error(`No tool server called ${name}`);
  if (stdio()) return { config: { command: process.execPath, args: [path.join(__dirname, `${SERVERS[name]}.js`)], env }, close() {} };
  const token = crypto.randomBytes(24).toString('hex');
  sessions.set(token, { name, env, botId, server: null });
  return {
    config: { type: 'http', url: `http://127.0.0.1:${port()}${PATH}${name}`, headers: { 'X-Bot-Dot': '1', Authorization: `Bearer ${token}` } },
    close() { sessions.delete(token); },
  };
}

// The run's tools for a request's token, or null: an unknown token, one whose run ended, and one of another server.
// Its server is made at the first request, from the module and its `env`.
function find(token, name) {
  const s = token ? sessions.get(String(token)) : null;
  if (!s || s.name !== name) return null;
  s.server ||= require(`./${SERVERS[name]}`).create(s.env);
  return s;
}

// The token of a request's `Authorization: Bearer <token>`.
const bearer = (headers) => (/^Bearer ([0-9a-f]+)$/i.exec(String(headers.authorization || '')) || [])[1] || '';

module.exports = { serve, find, bearer, stdio, PATH, SERVERS };
