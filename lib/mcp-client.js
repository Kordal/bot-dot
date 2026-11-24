// botdot as a client of a remote MCP server (ADR 265): Streamable HTTP only (initialize, tools/list, tools/call, the
// Mcp-Session-Id header, an answer as JSON or as a stream of server-sent events), made with Node's own `https`, no
// dependency. Every call opens its own session and closes it: nothing is kept between two calls but the tools' list,
// which lib/custom-servers.js caches.
//
// The server is the owner's own pick, but its address is still untrusted input: a bot must not reach this machine's
// own services, or anything on its network, through it. So the address must be https, name a host and no key, and
// every address the host resolves to is checked where the connection is made (`lookup` below), so a name that
// answers a public address to the check and a private one to the connection (DNS rebinding) connects to nothing.
// A redirect is never followed. The key goes only in the one header the owner chose, and no word of an error that
// carries it leaves this file (`scrub`).
const https = require('node:https');
const http = require('node:http');
const dns = require('node:dns');
const net = require('node:net');

const VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const CLIENT = { name: 'botdot', version: '1' };
const MAX_BODY = 8 * 1024 * 1024; // what one answer may hold
const MAX_TOOLS = 500;
const SECONDS = 1000;

// A test's stand-in server is on this machine and speaks http: this switch (set by the test's environment only,
// never by botdot itself) lets it be reached. Without it, none of that is allowed.
const allowLocal = () => process.env.BOT_DOT_MCP_ALLOW_LOCAL === '1';

// ---------- which addresses are the machine's or its network's ----------

const blocked4 = new net.BlockList();
for (const [a, n] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.0.2.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['198.51.100.0', 24], ['203.0.113.0', 24], ['224.0.0.0', 4], ['240.0.0.0', 4]]) blocked4.addSubnet(a, n, 'ipv4');
const blocked6 = new net.BlockList();
for (const [a, n] of [['::', 128], ['::1', 128], ['fe80::', 10], ['fc00::', 7], ['ff00::', 8], ['2001:db8::', 32], ['2001::', 32], ['100::', 64]]) blocked6.addSubnet(a, n, 'ipv6');

// The 16 bytes of an IPv6 address, or null when it isn't one.
function bytes6(text) {
  let s = String(text).split('%')[0].toLowerCase();
  const dotted = s.match(/(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    if (net.isIPv4(dotted[1]) === false) return null;
    const p = dotted[1].split('.').map(Number);
    s = s.slice(0, -dotted[1].length) + `${((p[0] << 8) | p[1]).toString(16)}:${((p[2] << 8) | p[3]).toString(16)}`;
  }
  if (!net.isIPv6(s)) return null;
  const [head, tail] = s.split('::');
  const a = head ? head.split(':') : [];
  const b = tail === undefined ? [] : tail ? tail.split(':') : [];
  const groups = tail === undefined ? a : [...a, ...Array(8 - a.length - b.length).fill('0'), ...b];
  if (groups.length !== 8) return null;
  return groups.flatMap((g) => { const n = parseInt(g || '0', 16); return [n >> 8, n & 255]; });
}

// Whether an address is one this machine or its network owns: loopback, private, link-local, unique-local, carrier
// grade NAT, multicast, reserved and documentation ranges, and an IPv6 address that carries one of those (mapped,
// compatible, NAT64, 6to4).
function isBlockedAddress(address) {
  const ip = String(address).replace(/^\[|\]$/g, '');
  if (net.isIPv4(ip)) return blocked4.check(ip, 'ipv4');
  const b = bytes6(ip);
  if (!b) return true; // not an address at all: nothing to trust
  const v4 = (i) => b.slice(i, i + 4).join('.');
  const zero = (n) => b.slice(0, n).every((x) => x === 0);
  if (zero(10) && b[10] === 255 && b[11] === 255) return blocked4.check(v4(12), 'ipv4'); // ::ffff:a.b.c.d
  if (zero(12) && !zero(16)) return blocked4.check(v4(12), 'ipv4'); // ::a.b.c.d, and 0.x.y.z through the range ::/128
  if (b[0] === 0x00 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b.slice(4, 12).every((x) => x === 0)) return blocked4.check(v4(12), 'ipv4'); // 64:ff9b::/96
  if (b[0] === 0x20 && b[1] === 0x02) return blocked4.check(v4(2), 'ipv4'); // 6to4
  return blocked6.check(ip.split('%')[0], 'ipv6');
}

// The refusals the owner reads. An Error with `code: 'bad-address'`.
const refuse = (message) => Object.assign(new Error(message), { code: 'bad-address' });

// The address of a server as a URL, or throws a sentence the owner can act on. Only the address is judged here; the
// host's own addresses are checked where the connection is made (`lookup`) and by `assertPublic`.
function parseAddress(raw) {
  const text = String(raw ?? '').trim();
  if (!text) throw refuse('Give the address of the server, starting with https://');
  if (text.length > 2000) throw refuse('That address is too long.');
  let u;
  try { u = new URL(text); } catch { throw refuse(`That isn't a web address: ${text.slice(0, 80)}`); }
  const local = allowLocal();
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) throw refuse('The address must start with https://. botdot connects to a server only over a secure link.');
  if (u.username || u.password) throw refuse('Leave the key out of the address: paste it in the key field instead.');
  if (u.search || u.hash) throw refuse('Leave the part after "?" or "#" out of the address: botdot keeps a key in the key field, never in the address.');
  const host = u.hostname.replace(/^\[|\]$/g, '').replace(/\.$/, '').toLowerCase();
  if (!host) throw refuse('The address names no server.');
  if (!local) {
    if (net.isIP(host) ? isBlockedAddress(host) : (!host.includes('.') || /(^|\.)(localhost|local|localdomain|internal|intranet|lan|home|corp|home\.arpa)$/.test(host))) {
      throw refuse("That address is on this machine or its own network. botdot connects only to servers on the internet, so a bot can't reach this machine's own services through it.");
    }
  }
  return u;
}

// `lookup` for the connection: the host's every address must be a public one, or nothing connects.
function lookup(hostname, options, callback) {
  if (typeof options === 'function') { callback = options; options = {}; }
  dns.lookup(hostname, { ...options, all: true, verbatim: true }, (err, addresses) => {
    if (err) return callback(err);
    if (!addresses.length || addresses.some((a) => isBlockedAddress(a.address))) {
      return callback(refuse("That server's address is on this machine or its own network. botdot connects only to servers on the internet."));
    }
    return options.all ? callback(null, addresses) : callback(null, addresses[0].address, addresses[0].family);
  });
}
// The same check, before anything is saved: the address's host resolves to public addresses only.
async function assertPublic(url) {
  if (allowLocal()) return;
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host)) return; // parseAddress judged it
  let addresses;
  try { addresses = await dns.promises.lookup(host, { all: true, verbatim: true }); } catch { throw refuse(`botdot can't find a server called ${host}. Check the address.`); }
  if (!addresses.length || addresses.some((a) => isBlockedAddress(a.address))) throw refuse("That server's address is on this machine or its own network. botdot connects only to servers on the internet, so a bot can't reach this machine's own services through it.");
}

// ---------- the key ----------

// Header names that are the connection's own, never the key's.
const RESERVED = new Set(['host', 'content-length', 'content-type', 'accept', 'connection', 'transfer-encoding', 'mcp-session-id', 'mcp-protocol-version', 'cookie', 'upgrade', 'te', 'trailer', 'expect', 'proxy-authorization']);
const HEADER_RE = /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/;
// The header the key goes in: Authorization (as a bearer token) unless the owner named another (a key as it is).
function authHeader(key, header) {
  if (!key) return {};
  const name = String(header || 'Authorization').trim();
  if (!HEADER_RE.test(name) || RESERVED.has(name.toLowerCase())) throw refuse(`"${name.slice(0, 40)}" can't be the header of a key.`);
  const value = name.toLowerCase() === 'authorization' && !/^(bearer|basic)\s/i.test(key) ? `Bearer ${key}` : key;
  if (/[\r\n\0]/.test(value)) throw refuse("The key can't hold a line break.");
  return { [name]: value };
}

// Nothing of a key in a sentence that leaves this file: the key, and the value sent in its header.
const scrubber = (secrets) => (text) => {
  let out = String(text ?? '');
  for (const s of secrets.filter((x) => typeof x === 'string' && x.length >= 4)) out = out.split(s).join('[key]');
  return out;
};

// ---------- one request ----------

// Posts `body` (JSON-RPC) and waits for what answers it. A JSON answer is read whole; a stream of events is read until
// the answer to `expectId` arrives (the server may leave it open). Resolves { status, headers, message } with message
// the JSON-RPC answer, or null when none was expected or sent. Rejects for a transport failure.
function post(url, { headers, body, expectId = null, method = 'POST', timeoutMs = 60 * SECONDS }) {
  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'http:' ? http : https;
    const payload = body === undefined ? null : Buffer.from(JSON.stringify(body));
    const req = lib.request({
      protocol: url.protocol, hostname: url.hostname.replace(/^\[|\]$/g, ''), port: url.port || undefined, path: `${url.pathname}`, method, agent: false,
      headers: { ...headers, ...(payload ? { 'Content-Length': payload.length } : {}) },
      ...(allowLocal() ? {} : { lookup }),
    });
    let done = false;
    const finish = (fn, value) => { if (done) return; done = true; clearTimeout(timer); fn(value); };
    const timer = setTimeout(() => { req.destroy(); finish(reject, Object.assign(new Error('The server did not answer in time.'), { code: 'timeout' })); }, timeoutMs);
    req.on('error', (e) => finish(reject, e));
    req.on('response', (res) => {
      const type = String(res.headers['content-type'] || '').toLowerCase();
      const status = res.statusCode;
      let size = 0;
      let text = '';
      let found = null;
      let tail = '';
      // A stream of events: each is lines "data: …" ended by an empty line.
      const events = (chunk) => {
        tail += chunk;
        let at;
        while ((at = tail.search(/\r?\n\r?\n/)) >= 0) {
          const block = tail.slice(0, at);
          tail = tail.slice(at).replace(/^\r?\n\r?\n/, '');
          const data = block.split(/\r?\n/).filter((l) => l.startsWith('data:')).map((l) => l.slice(5).replace(/^ /, '')).join('\n');
          if (!data) continue;
          try {
            const m = JSON.parse(data);
            if (m && typeof m === 'object' && !Array.isArray(m) && expectId !== null && m.id === expectId && ('result' in m || 'error' in m)) found = m;
          } catch { /* an event that is not JSON: not ours */ }
        }
      };
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size > MAX_BODY) { req.destroy(); return finish(reject, Object.assign(new Error('The server answered with more than botdot takes.'), { code: 'too-big' })); }
        if (status >= 200 && status < 300 && type.includes('text/event-stream')) {
          events(chunk);
          if (found) { finish(resolve, { status, headers: res.headers, message: found }); req.destroy(); }
        } else text += chunk;
      });
      res.on('end', () => {
        if (done) return;
        if (type.includes('text/event-stream') && status < 300) { tail += '\n\n'; events(''); return finish(resolve, { status, headers: res.headers, message: found }); }
        let message = null;
        if (status < 300 && text.trim() && expectId !== null) {
          try {
            const j = JSON.parse(text);
            message = Array.isArray(j) ? j.find((m) => m && m.id === expectId) || null : j;
          } catch { return finish(reject, Object.assign(new Error('The server answered with something that is not MCP.'), { code: 'not-mcp' })); }
        }
        finish(resolve, { status, headers: res.headers, message, text: status >= 300 ? text.slice(0, 2000) : '' });
      });
      res.on('error', (e) => finish(reject, e));
    });
    if (payload) req.write(payload);
    req.end();
  });
}

// A value with the key taken out of every string in it.
const scrubbed = (v, scrub) => (typeof v === 'string' ? scrub(v) : Array.isArray(v) ? v.map((x) => scrubbed(x, scrub)) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [scrub(k), scrubbed(x, scrub)])) : v);

// ---------- the protocol ----------

const clip = (s, n) => { const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };

// What went wrong, in words for the owner or the bot, with no trace of the key. An Error with `code`:
// 'auth' (the server refused the key), 'bad-address', 'timeout', 'not-mcp', 'remote' (the server's own error).
function explain(e, scrub) {
  if (e?.code === 'bad-address') return e;
  const text = scrub(e?.message || String(e));
  const map = { ENOTFOUND: "botdot can't find that server. Check the address.", EAI_AGAIN: "botdot can't find that server right now.", ECONNREFUSED: 'The server refused the connection.', ECONNRESET: 'The server dropped the connection.', ETIMEDOUT: 'The server did not answer in time.', CERT_HAS_EXPIRED: "The server's certificate has expired.", DEPTH_ZERO_SELF_SIGNED_CERT: "The server's certificate is not one botdot can trust.", SELF_SIGNED_CERT_IN_CHAIN: "The server's certificate is not one botdot can trust.", UNABLE_TO_VERIFY_LEAF_SIGNATURE: "The server's certificate is not one botdot can trust.", ERR_TLS_CERT_ALTNAME_INVALID: "The server's certificate is not for that address." };
  return Object.assign(new Error(map[e?.code] || text || 'The server could not be reached.'), { code: e?.code && !map[e.code] ? e.code : 'unreachable' });
}

// `server`: { url, key, header }. The client's whole surface is check(), tools() and call(); each opens a session.
function create({ send = post } = {}) {
  async function withSession(server, fn) {
    const url = parseAddress(server.url);
    const scrub = scrubber([server.key, ...Object.values(authHeader(server.key, server.header))]);
    const base = { Accept: 'application/json, text/event-stream', 'Content-Type': 'application/json', ...authHeader(server.key, server.header) };
    let counter = 0;
    const state = { headers: { ...base }, sessionId: null };
    const fail = (e) => { throw explain(e, scrub); };

    // One request with its answer: the result, or an Error in words. A non-success status says why, never with the key.
    async function rpc(method, params, { timeoutMs } = {}) {
      const id = ++counter;
      let r;
      try { r = await send(url, { headers: state.headers, body: { jsonrpc: '2.0', id, method, params }, expectId: id, timeoutMs }); } catch (e) { return fail(e); }
      if (r.status === 401 || r.status === 403) throw Object.assign(new Error(server.key ? 'The server refused the key.' : 'The server wants a key. Add one in the key field.'), { code: 'auth' });
      if (r.status >= 300 && r.status < 400) throw Object.assign(new Error('The server sent botdot to another address. Use the address it redirects to.'), { code: 'redirect' });
      if (r.status === 404 || r.status === 405) throw Object.assign(new Error("That address doesn't speak MCP over HTTP (Streamable HTTP). Check the address, or the server may be an older kind."), { code: 'not-mcp' });
      if (r.status >= 400) throw Object.assign(new Error(`The server answered ${r.status}${r.text ? `: ${clip(scrub(r.text), 200)}` : ''}.`), { code: 'remote' });
      if (!r.message) throw Object.assign(new Error('The server did not answer the request.'), { code: 'not-mcp' });
      if (r.message.error) throw Object.assign(new Error(clip(scrub(r.message.error.message || 'The server reported an error.'), 400)), { code: 'remote', rpcCode: r.message.error.code });
      if (r.headers?.['mcp-session-id'] && !state.sessionId) { state.sessionId = String(r.headers['mcp-session-id']); state.headers['Mcp-Session-Id'] = state.sessionId; }
      return r.message.result;
    }

    const init = await rpc('initialize', { protocolVersion: VERSIONS[0], capabilities: {}, clientInfo: CLIENT });
    if (!init || typeof init !== 'object') throw Object.assign(new Error('The server did not say what it is.'), { code: 'not-mcp' });
    const version = VERSIONS.includes(init.protocolVersion) ? init.protocolVersion : VERSIONS[0];
    state.headers['MCP-Protocol-Version'] = version;
    try { await send(url, { headers: state.headers, body: { jsonrpc: '2.0', method: 'notifications/initialized' } }); } catch (e) { fail(e); }
    try {
      return await fn({ rpc, info: init, scrub });
    } finally {
      if (state.sessionId) send(url, { headers: state.headers, method: 'DELETE', timeoutMs: 5 * SECONDS }).catch(() => {});
    }
  }

  // The server's tools: [{ name, description, inputSchema, annotations }], at most MAX_TOOLS.
  const tools = (server) => withSession(server, async ({ rpc }) => {
    const out = [];
    let cursor;
    for (let page = 0; page < 20 && out.length < MAX_TOOLS; page++) {
      const r = await rpc('tools/list', cursor ? { cursor } : {});
      for (const t of Array.isArray(r?.tools) ? r.tools : []) {
        if (!t || typeof t.name !== 'string' || !t.name || t.name.length > 200) continue;
        out.push({ name: t.name, description: clip(t.description, 2000), inputSchema: t.inputSchema && typeof t.inputSchema === 'object' ? t.inputSchema : { type: 'object' }, annotations: t.annotations && typeof t.annotations === 'object' ? { readOnlyHint: t.annotations.readOnlyHint, destructiveHint: t.annotations.destructiveHint, idempotentHint: t.annotations.idempotentHint, openWorldHint: t.annotations.openWorldHint, title: typeof t.annotations.title === 'string' ? clip(t.annotations.title, 200) : undefined } : {} });
      }
      cursor = typeof r?.nextCursor === 'string' && r.nextCursor ? r.nextCursor : null;
      if (!cursor) break;
    }
    return out.slice(0, MAX_TOOLS);
  });

  // One call of one tool: { content, isError, structuredContent } as the server answered, its words scrubbed.
  const call = (server, name, args) => withSession(server, async ({ rpc, scrub }) => {
    const r = await rpc('tools/call', { name, arguments: args && typeof args === 'object' ? args : {} }, { timeoutMs: 100 * SECONDS });
    return { isError: r?.isError === true, content: scrubbed(Array.isArray(r?.content) ? r.content : [], scrub), ...(r?.structuredContent !== undefined ? { structuredContent: scrubbed(r.structuredContent, scrub) } : {}) };
  });

  // Whether the server is one: its name and how many tools it has, or an Error in words.
  const check = (server) => withSession(server, async ({ rpc, info }) => {
    const list = await rpc('tools/list', {});
    return { serverName: clip(info.serverInfo?.name, 80) || null, tools: Array.isArray(list?.tools) ? list.tools.length : 0 };
  });

  return { tools, call, check };
}

// A tool's answer as plain text for the bot: its text parts, a line for anything else, and its structured result when
// there is no text.
function resultText(r) {
  const parts = [];
  for (const c of Array.isArray(r?.content) ? r.content : []) {
    if (c?.type === 'text' && typeof c.text === 'string') parts.push(c.text);
    else if (c?.type === 'resource' && c.resource && typeof c.resource.text === 'string') parts.push(c.resource.text);
    else if (c?.type === 'resource' || c?.type === 'resource_link') parts.push(`[a resource: ${clip(c.uri || c.resource?.uri || c.name, 200)}]`);
    else if (c?.type) parts.push(`[${clip(c.type, 20)} content left out]`);
  }
  if (!parts.length && r?.structuredContent !== undefined) parts.push(JSON.stringify(r.structuredContent));
  return parts.join('\n') || '(the tool answered with nothing)';
}

module.exports = { create, resultText, parseAddress, assertPublic, isBlockedAddress, authHeader, scrubber, post, VERSIONS };
