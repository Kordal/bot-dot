#!/usr/bin/env node
// Stdio MCP server giving every bot access to its saved logins without ever seeing the secrets:
// list them, ask the owner for a missing one (secure pop-up), and make API calls with one.
const readline = require('readline');
const { TYPE_PARAMETER } = require('./vault-item-types'); // the types of a saved login

const VAULT_URL = process.env.VAULT_URL;
const VAULT_TOKEN = process.env.VAULT_TOKEN;

async function vault(pathname, body, timeoutMs = 60_000) {
  if (!VAULT_URL || !VAULT_TOKEN) throw new Error('Saved logins are not available in this run');
  const res = await fetch(`${VAULT_URL}${pathname}`, {
    method: body ? 'POST' : 'GET',
    headers: { 'Content-Type': 'application/json', 'X-Bot-Dot': '1', 'X-Vault-Token': VAULT_TOKEN },
    body: body ? JSON.stringify(body) : undefined,
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || data.text || `HTTP ${res.status}`);
  return data;
}

const text = (t) => [{ type: 'text', text: t }];

const TOOLS = [
  {
    name: 'list_logins',
    description: 'List the saved logins you may use (name, address, username, type: "login", "api-token" or "other", which says what the owner saved and limits nothing; allowedHosts: the other hosts the owner approved it for; and inComputer: true when you may use it with run_with_login on your own computer), plus any payment cards (name, last 4 digits) and identities (name, email). ' +
      'It also lists every other entry in the owner\'s Vault with shared: false (its name, and a login\'s address and type): you may not use those yet. To use one, call request_login with its address and name, and the owner approves it. ' +
      'Passwords, tokens, card numbers and codes are never shown.',
    inputSchema: { type: 'object', properties: {} },
    run: async () => {
      const { logins, notShared = [] } = await vault('/session/logins');
      const all = [...logins, ...notShared.map((e) => ({ ...e, shared: false }))];
      return text(all.length ? JSON.stringify(all, null, 1) : 'The Vault is empty. Use request_login to ask the owner for a login.');
    },
  },
  {
    name: 'api_request',
    description:
      'Call an HTTP API using a saved login, without seeing its secret. Put {{username}} and {{password}} (or {{token}}) where the values go in a header, ' +
      'e.g. {"Authorization": "Bearer {{password}}"}, {"Authorization": "PVEAPIToken={{username}}={{password}}"} for Proxmox, {"X-API-Key": "{{password}}"}, ' +
      'or {"Authorization": "Basic {{basic}}"}. botdot fills them in and only sends the request to the login\'s own address or one of its allowedHosts. Returns the status and response body.',
    inputSchema: {
      type: 'object',
      properties: {
        login: { type: 'string', description: 'Login name, address or one of its allowedHosts, from list_logins' },
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'], default: 'GET' },
        url: { type: 'string', description: 'Full address, e.g. https://pve.example.ts.net:8006/api2/json/nodes' },
        headers: { type: 'object', additionalProperties: { type: 'string' }, description: 'Request headers; use the placeholders here' },
        body: { description: 'Optional request body: a string, or an object sent as JSON' },
        timeoutSeconds: { type: 'number', description: 'Default 30, max 120' },
      },
      required: ['login', 'url'],
    },
    run: async (args) => {
      const r = await vault('/session/http', args, 150_000);
      return text(r.text);
    },
  },
  {
    name: 'request_login',
    description: 'Ask the owner to add a missing login (a website login, an API token or another secret). They get a secure pop-up to type it; you never see it. Waits until they answer. ' +
      'Never for an app botdot connects (Google Calendar, Gmail, Slack, GitHub, Notion…): ask the Chief for that app with ask_chief_for_app. ' +
      'Say what you need with type: ask for "api-token" when you need a token or key to call an API with api_request, so the pop-up asks for a token (and its token ID, if it has one) and not for a username and password.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Address the login is for, e.g. recipes.example.com or pve.example.ts.net' },
        name: { type: 'string', description: 'Short name for the login, e.g. "Proxmox API token"' },
        username: { type: 'string', description: 'Username, email or token id if the task mentions it' },
        type: TYPE_PARAMETER,
        reason: { type: 'string', description: 'One sentence shown to the owner: why you need it' },
      },
      required: ['site', 'reason'],
    },
    run: async ({ site, name, username, type, reason }) => {
      const { id } = await vault('/session/request', { site, name, username, type, reason });
      const until = Date.now() + 14 * 60_000;
      while (Date.now() < until) {
        const r = await vault(`/session/request/${id}/wait`);
        if (r.status === 'saved' || r.status === 'allowed') return text(`The owner added the login "${r.loginName}". Use it by that name.`);
        if (r.status === 'declined') return text('The owner declined to add this login. Continue without it, or stop and explain.');
        if (r.status === 'expired') break;
      }
      return text('The owner did not answer in time. Stop and explain that you need the login.');
    },
  },
];

// ---------- JSON-RPC plumbing ----------

const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');

async function handle({ id, method, params }) {
  if (id === undefined) return;
  if (method === 'initialize') {
    return send({ id, result: { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'vault', version: '0.1.0' } } });
  }
  if (method === 'ping') return send({ id, result: {} });
  if (method === 'tools/list') return send({ id, result: { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } });
  if (method === 'tools/call') {
    const tool = TOOLS.find((t) => t.name === params.name);
    if (!tool) return send({ id, error: { code: -32602, message: `Unknown tool ${params.name}` } });
    try {
      return send({ id, result: { content: await tool.run(params.arguments || {}) } });
    } catch (e) {
      return send({ id, result: { content: text(`Error: ${e.message}`), isError: true } });
    }
  }
  send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  try { handle(JSON.parse(line)); } catch { /* ignore bad input */ }
});
