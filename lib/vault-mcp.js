#!/usr/bin/env node
// Stdio MCP server giving every bot access to its saved logins without ever seeing the secrets:
// list them, ask the owner for a missing one (secure pop-up), for a switch of one, its removal or saving a secret the bot
// holds (a card), and make API calls with one.
const readline = require('readline');
const { TYPE_PARAMETER } = require('./vault-item-types'); // the types of a saved login

const VAULT_URL = process.env.VAULT_URL;
const VAULT_TOKEN = process.env.VAULT_TOKEN;
// A replay of a past task (ADR 102): only the tools that read, and api_request with GET alone going through.
const REPLAY = process.env.VAULT_REPLAY === '1';

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

const ALL = [
  {
    name: 'list_logins',
    description: 'List the saved logins you may use (name, address, username, type: "login", "api-token" or "other", which says what the owner saved and limits nothing, or "github-app", which your git on the server signs in to its GitHub with by itself; allowedHosts: the other hosts the owner approved it for; each login may also be used with run_with_login on the account\'s computer, where every bot on the account\'s computer can read it), plus any payment cards (name, last 4 digits), identities (name, email), SSH keys (kind and type "ssh-key": name, fingerprint and public key; use one with run_with_ssh_key on your own computer; on the server, ssh and git use them already) and files (kind and type "file": name, file name and size; use one with run_with_file on the account\'s computer). ' +
      'It also lists every other entry in the owner\'s Vault with shared: false (its name, and a login\'s address and type): you may not use those yet. To use one, call request_login with its address and name, and the owner approves it; for an SSH key or a file, ask the owner to share it with you in Passwords. ' +
      'Passwords, tokens, card numbers, codes and private keys are never shown.',
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
      'or {"Authorization": "Basic {{basic}}"}. For a login of type "github-app", {{token}} is a fresh installation token of that GitHub App (the app\'s key never leaves botdot). botdot fills them in and only sends the request to the login\'s own address or one of its allowedHosts. Returns the status and response body. ' +
      'For a header that needs several saved logins, give logins, a list of up to 8 names, instead of login, and name each value: {{NAME.password}}, {{NAME.username}}, {{NAME.token}} or {{NAME.basic}}, NAME a login of the list, ' +
      'e.g. {"X-Key": "{{OVH_APPLICATION_KEY.password}}"}; the address must then be one every login allows. Values go in headers only: for a request that must be signed (a hash over the URL, body and time), use run_with_login with logins on your computer instead.',
    inputSchema: {
      type: 'object',
      properties: {
        login: { type: 'string', description: 'Login name, address or one of its allowedHosts, from list_logins' },
        logins: { type: 'array', items: { type: 'string' }, maxItems: 8, description: 'Instead of login: up to 8 login names from list_logins, used as {{NAME.password}} in the headers' },
        method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'], default: 'GET' },
        url: { type: 'string', description: 'Full address, e.g. https://pve.example.ts.net:8006/api2/json/nodes' },
        headers: { type: 'object', additionalProperties: { type: 'string' }, description: 'Request headers; use the placeholders here' },
        body: { description: 'Optional request body: a string, or an object sent as JSON' },
        timeoutSeconds: { type: 'number', description: 'Default 30, max 120' },
      },
      required: ['url'],
    },
    run: async (args) => {
      const r = await vault('/session/http', args, 150_000);
      return text(r.text);
    },
  },
  {
    name: 'request_login',
    description: 'Ask the owner to add a missing login (a website login, an API token or another secret). They get a secure pop-up to type it; you never see it. Waits until they answer. ' +
      'Never for an app botdot connects (Google Calendar, Gmail, Slack, GitHub, Notion…): ask for that app with ask_chief_for_app. ' +
      'Say what you need with type: ask for "api-token" when you need a token or key to call an API with api_request, so the pop-up asks for a token (and its token ID, if it has one) and not for a username and password.',
    inputSchema: {
      type: 'object',
      properties: {
        site: { type: 'string', description: 'Address the login is for, e.g. recipes.example.com or pve.example.ts.net' },
        name: { type: 'string', description: 'Short name for the login, e.g. "Proxmox API token"' },
        username: { type: 'string', description: 'Username, email or token id if the task mentions it' },
        type: TYPE_PARAMETER,
        reason: { type: 'string', description: 'One sentence shown to the owner: why you need it' },
        again: { type: 'boolean', description: 'true only when the owner said no to this login before and has since asked you in a message to ask for it again' },
      },
      required: ['site', 'reason'],
    },
    run: async ({ site, name, username, type, reason, again }) => {
      const { id } = await vault('/session/request', { site, name, username, type, reason, again });
      const until = Date.now() + 14 * 60_000;
      while (Date.now() < until) {
        const r = await vault(`/session/request/${id}/wait`);
        if (r.status === 'saved' || r.status === 'allowed') return text(`The owner added the login "${r.loginName}". Use it by that name.`);
        if (r.status === 'declined') return text('The owner declined to add this login. Continue without it, or stop and explain.');
        if (r.status === 'expired') break;
      }
      return text('The owner did not answer in time. Stop, and say in one line that you need the login: the request stays in Needs you, and when the owner adds it, botdot carries this work on.');
    },
  },
  {
    name: 'save_to_vault',
    description: 'Ask the owner to save a secret in Passwords, as a login shared with you: one you made or found on your computer (a database password, an app secret, a key a service gave you), or a new random one botdot makes (generate). ' +
      'Never put the secret in a message, a tool argument or a command line: write it to a file on your computer without printing it (e.g. openssl rand -hex 32 > /tmp/db-pass, or from the server with run_with_ssh_key \'cat /root/.env\' > /tmp/x, cut to the value), and give its path as file; botdot reads it, and its whole text, one final newline dropped, is the secret. Remove the file once it is saved. ' +
      'With generate: true, botdot makes 43 random letters and digits and you never see them; use the entry afterwards with run_with_login, place_secret_file or api_request. ' +
      'A new name is saved at once, shared with you alone. A name of a login already shared with you replaces its secret: that waits on a card in your chat and in Needs you, where the owner can show the secret and taps Save. After their yes botdot starts you again on the same request by itself, so say in your reply that the card waits for their OK.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'The entry\'s name in Passwords, e.g. "Qwotz prod DB"' },
        site: { type: 'string', description: 'Address the secret is for, e.g. db.qwotz.com or 57.129.155.118' },
        username: { type: 'string', description: 'Username or key id that goes with it, if any' },
        type: TYPE_PARAMETER,
        file: { type: 'string', description: 'Path of a file on your computer whose text is the secret (relative to your folder, or absolute)' },
        generate: { type: 'boolean', description: 'true instead of file: botdot makes a new random secret' },
        reason: { type: 'string', description: 'One sentence the owner reads: what the secret is for, e.g. "The Postgres password of Qwotz prod, made for the launch on OVH"' },
      },
      required: ['name', 'reason'],
    },
    run: async (args) => {
      const r = await vault('/session/save', args, 120_000);
      if (r.saved) return text(`Saved "${r.name}" in Passwords, shared with you: use it by that name now. Never write the secret in your reply.`);
      return text(`Asked to ${r.replaces ? `replace the secret of "${r.name}"` : `save "${r.name}"`} in Passwords. It waits for the owner's OK on a card in your chat and in Needs you; it is not saved until they allow it. ` +
        "Tell the owner plainly that the card waits. Never write the secret in your reply.");
    },
  },
  {
    name: 'remove_login',
    description: 'Ask the owner to remove an entry from Passwords that is no longer needed, e.g. a key of a service you took down. Any entry list_logins shows, shared with you or not. ' +
      'The owner sees a card in your chat and in Needs you that names you and the entry, and taps Allow; only then does botdot move it to Bitwarden\'s Trash, where the owner can restore it for 30 days. Nothing is removed until they do, and you never see its secret. ' +
      'After their yes botdot starts you again on the same request by itself, so say in your reply that the card waits for their OK. ' +
      'Never tell the owner to remove it in Passwords themselves: ask with this tool.',
    inputSchema: {
      type: 'object',
      properties: {
        entry: { type: 'string', description: 'The entry\'s name from list_logins (or a login\'s address)' },
        reason: { type: 'string', description: 'One sentence the owner reads: why it is no longer needed, e.g. "Uptime Kuma is gone, so its netcup API key is not used any more"' },
      },
      required: ['entry', 'reason'],
    },
    run: async ({ entry, reason }) => {
      const r = await vault('/session/remove', { entry, reason });
      return text(`Asked to remove "${r.name}" from Passwords. It waits for the owner's OK on a card in your chat and in Needs you; it is still there until they allow it, and then it goes to Bitwarden's Trash. ` +
        "Tell the owner plainly that the card waits. Don't tell the owner to remove it in Passwords themselves.");
    },
  },
];
const TOOLS = REPLAY ? ALL.filter((t) => ['list_logins', 'api_request'].includes(t.name)) : ALL;

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
