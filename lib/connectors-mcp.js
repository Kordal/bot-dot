#!/usr/bin/env node
// Stdio MCP server that lets a bot use its connected apps (Gmail, Slack, GitHub… through Composio), and the Chief
// in a turn the owner started (ADR 047). It only relays to botdot, which checks the caller may use the app and makes
// the call itself, so the Composio key and the app tokens never reach the bot or the Chief.
const readline = require('readline');

const API = process.env.CONNECTORS_URL;
const TOKEN = process.env.RUN_TOKEN;
const APPS = String(process.env.CONNECTOR_APPS || '').split(',').filter(Boolean);
// 'chief': the Chief's turn, which has no workspace: a file it hands an app is one the user attached in its chat.
const CHIEF = process.env.CONNECTOR_CALLER === 'chief';

// What botdot answers, also when it says no: { ok: false, error, … }.
async function post(pathname, body) {
  const res = await fetch(`${API}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Bot-Dot': '1', 'X-Run-Token': TOKEN },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(120_000),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok && data.ok !== false) return { ok: false, error: data.error || `HTTP ${res.status}` };
  return data;
}
async function call(pathname, body) {
  const data = await post(pathname, body);
  if (data.ok === false) throw new Error(data.error || 'botdot did not answer');
  return data;
}

// A write needs the owner's OK (ADR 010). botdot makes its card and says that the call waits; the call is then
// left unanswered while botdot is asked for the owner's answer, in slices of a long poll, as for a missing login
// (vault-mcp.js). A yes: the same call is sent again and goes through. A no, or ten minutes without an answer:
// the bot is told in botdot's own words. botdot keeps the ten minutes; this loop only gives up after 14, inside
// the 15 that Claude Code allows a tool call.
const GIVE_UP_MS = 14 * 60_000;
const NO_ANSWER = "The owner has not answered yet, so this action was not done. Don't call it again in this run and don't try it another way. Say in your reply that it is not done yet and waits for the owner's OK.";
async function runAction(args) {
  const until = Date.now() + GIVE_UP_MS;
  let r = await post('/run', args);
  while (r.ok === false && r.waits && r.requestId && Date.now() < until) {
    const w = await post('/wait', { id: r.requestId });
    if (w.ok === false) throw new Error(w.error || NO_ANSWER);
    if (w.status === 'waiting') continue;
    if (w.status !== 'allowed') throw new Error(w.text || NO_ANSWER);
    r = await post('/run', args); // the owner said yes: this call is the one that goes through
  }
  if (r.ok === false) throw new Error(r.waits ? NO_ANSWER : r.error || 'botdot did not answer');
  return r.result;
}

const text = (t) => [{ type: 'text', text: t }];
const appSchema = { type: 'string', enum: APPS, description: 'The app' };

const TOOLS = [
  {
    name: 'connector_actions',
    description: `Find actions of a connected app (${APPS.join(', ')}). Without "action" it lists the app's actions (optionally filtered by "search", e.g. "send email"). With "action" (its slug) it returns that action's full input schema. Always get the schema before running an action.`,
    inputSchema: { type: 'object', properties: { app: appSchema, search: { type: 'string' }, action: { type: 'string', description: 'Action slug, e.g. GMAIL_FETCH_EMAILS' } }, required: ['app'] },
    run: async (args) => text(JSON.stringify((await call('/actions', args)).actions, null, 1)),
  },
  {
    name: 'connector_run',
    description: "Run an action of a connected app on the owner's account, with arguments that match its input schema. " +
      "An action that sends, posts, changes or deletes waits for the owner's OK on a card: this call then takes up to ten minutes to answer, which is expected. Wait with it, and its answer says whether it was done. " +
      (CHIEF ? 'For a file (an email attachment, a file to upload), write {"$file": "<the name of a file the user attached in this chat>"} as that argument\'s value; botdot puts the file in. No other file can go. '
        : 'For a file (an email attachment, a file to upload), write {"$file": "<path in your workspace, or the name of a file you attached>"} as that argument\'s value; botdot puts the file in. ') +
      'Never type out file contents or base64 yourself.',
    inputSchema: { type: 'object', properties: { app: appSchema, action: { type: 'string', description: 'Action slug' }, arguments: { type: 'object' } }, required: ['app', 'action'] },
    run: async (args) => text(await runAction(args)),
  },
];

const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');

async function handle({ id, method, params }) {
  if (id === undefined) return;
  if (method === 'initialize') return send({ id, result: { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'connectors', version: '0.1.0' } } });
  if (method === 'ping') return send({ id, result: {} });
  if (method === 'tools/list') return send({ id, result: { tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) } });
  if (method === 'tools/call') {
    const tool = TOOLS.find((t) => t.name === params.name);
    if (!tool) return send({ id, error: { code: -32602, message: `Unknown tool ${params.name}` } });
    try { return send({ id, result: { content: await tool.run(params.arguments || {}) } }); } catch (e) { return send({ id, result: { content: text(`Error: ${e.message}`), isError: true } }); }
  }
  send({ id, error: { code: -32601, message: `Method not found: ${method}` } });
}

readline.createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  try { handle(JSON.parse(line)); } catch { /* ignore bad input */ }
});
