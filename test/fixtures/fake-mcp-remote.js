// A stand-in remote MCP server (Streamable HTTP) for the tests of ADR 266: `initialize`, `tools/list`, `tools/call`, the
// Mcp-Session-Id header, an answer as JSON or as a stream of events, and a key it can insist on. It is on this machine
// and speaks http, so a server of botdot that reaches it has BOT_DOT_MCP_ALLOW_LOCAL=1 (lib/mcp-client.js).
const http = require('node:http');

const TOOLS = [
  { name: 'search_notes', description: 'Search the notes.', inputSchema: { type: 'object', properties: { query: { type: 'string' } } }, annotations: { readOnlyHint: true } },
  { name: 'create_note', description: 'Make a note.', inputSchema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'] } },
  { name: 'delete_note', description: 'Delete a note.', inputSchema: { type: 'object', properties: { id: { type: 'string' } } }, annotations: { readOnlyHint: false, destructiveHint: true } },
  { name: 'peek_then_wipe', description: 'Says both.', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true, destructiveHint: true } },
  { name: 'explode', description: 'Always fails.', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } },
  { name: 'leak', description: 'Answers with the key it was given.', inputSchema: { type: 'object' }, annotations: { readOnlyHint: true } },
];

// opts: { key (the token it insists on, as a bearer token), header (insists on the key in this header, as it is), sse (answers as a stream),
//   echoKey (a server that puts the key it was given in every tool's name, description, schema and title, as a careless one could),
//   delay (a slow server: { 'tools/list': ms, create_note: ms, … }, a pause before the answer to that method or that tool's call; the
//   object is given back as `delay`, so a test can change it) }
async function fakeMcpRemote(opts = {}) {
  const delay = opts.delay || {};
  const calls = []; // what tools/call got: { name, arguments, auth, session }
  const seen = []; // every request: { method, headers }
  const sessions = new Set();
  const ok = (req) => {
    if (!opts.key) return true;
    return opts.header ? req.headers[opts.header.toLowerCase()] === opts.key : req.headers.authorization === `Bearer ${opts.key}`;
  };
  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (c) => { raw += c; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, headers: req.headers });
      if (req.url !== '/mcp') { res.statusCode = 404; return res.end('not here'); }
      if (!ok(req)) { res.statusCode = 401; return res.end(`no key (${req.headers.authorization || 'none'})`); }
      if (req.method === 'DELETE') { sessions.delete(req.headers['mcp-session-id']); res.statusCode = 200; return res.end(); }
      let msg;
      try { msg = JSON.parse(raw); } catch { res.statusCode = 400; return res.end('bad json'); }
      if (msg.id === undefined) { res.statusCode = 202; return res.end(); } // a notification
      const answer = (result) => {
        const wait = delay[msg.method === 'tools/call' ? msg.params?.name : msg.method];
        if (wait) return setTimeout(() => reply(result), wait);
        reply(result);
      };
      const reply = (result) => {
        if (res.destroyed) return;
        const body = { jsonrpc: '2.0', id: msg.id, result };
        if (msg.method === 'initialize') { const id = `s-${sessions.size + 1}-${Math.random().toString(16).slice(2, 8)}`; sessions.add(id); res.setHeader('Mcp-Session-Id', id); }
        if (opts.sse) {
          res.setHeader('Content-Type', 'text/event-stream');
          res.write(`event: message\ndata: ${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/message', params: { level: 'info', data: 'working' } })}\n\n`);
          res.write(`event: message\ndata: ${JSON.stringify(body)}\n\n`);
          return; // the stream stays open: botdot takes the answer and goes
        }
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify(body));
      };
      if (msg.method === 'initialize') return answer({ protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'Notes Remote', version: '1' } });
      if (!req.headers['mcp-session-id'] || !sessions.has(req.headers['mcp-session-id'])) { res.statusCode = 404; return res.end('no session'); }
      if (msg.method === 'tools/list') {
        if (!opts.echoKey) return answer({ tools: TOOLS });
        const k = req.headers.authorization || req.headers[(opts.header || '').toLowerCase()] || '';
        // The key as botdot sent it, and the bare token inside it.
        return answer({ tools: TOOLS.map((t) => ({ ...t, name: t.name === 'search_notes' ? `search_notes_${opts.key}` : t.name, description: `${t.description} Sent with ${k}`, inputSchema: { type: 'object', description: `key ${opts.key}`, properties: { [`p_${opts.key}`]: { type: 'string', description: k, enum: [k, opts.key] } } }, annotations: { ...t.annotations, title: `Title ${opts.key}` } })) });
      }
      if (msg.method === 'tools/call') {
        const { name, arguments: args } = msg.params || {};
        calls.push({ name, arguments: args, auth: req.headers.authorization || req.headers[(opts.header || '').toLowerCase()] || null, session: req.headers['mcp-session-id'] });
        if (name === 'explode') return answer({ isError: true, content: [{ type: 'text', text: 'Something broke' }] });
        if (name === 'leak') return answer({ content: [{ type: 'text', text: `the key is ${opts.key}` }] });
        return answer({ content: [{ type: 'text', text: `${name} done: ${JSON.stringify(args)}` }] });
      }
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: `no ${msg.method}` } }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/mcp`;
  return { url, calls, seen, sessions, delay, close: () => { server.closeAllConnections?.(); server.close(); } };
}

module.exports = { fakeMcpRemote, TOOLS };
