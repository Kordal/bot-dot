#!/usr/bin/env node
// Stdio MCP server of a replay (#595, ADR 102): run_shell, read_file and write_file on the throwaway copy of the bot's
// computer that botdot made for this replay (lib/replay-computer.js). It only relays to botdot with the replay's key,
// which names that copy and nothing else: no screen, no saved login, no other computer.
const readline = require('readline');

const API = process.env.REPLAY_URL;
const KEY = process.env.REPLAY_KEY;

async function call(pathname, body, ms) {
  const res = await fetch(`${API}${pathname}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Bot-Dot': '1', 'X-Replay-Key': KEY },
    body: JSON.stringify(body || {}),
    signal: AbortSignal.timeout(ms),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || data.ok === false) throw new Error(data.error || `HTTP ${res.status}`);
  return data;
}

const text = (t) => [{ type: 'text', text: t }];
const COPY = ' This is a copy of your computer made for this replay, without network: nothing you change here stays or reaches anyone.';

const TOOLS = [
  {
    name: 'run_shell',
    description: `Run a shell command on your computer (Linux) and get its output. Waits until it finishes.${COPY}`,
    inputSchema: { type: 'object', properties: { command: { type: 'string' }, timeoutSeconds: { type: 'number', description: 'Default 120' } }, required: ['command'] },
    run: async ({ command, timeoutSeconds }) => {
      const seconds = Math.min(Math.max(Number(timeoutSeconds) || 120, 1), 600);
      const r = await call('/shell', { command, timeoutSeconds: seconds }, (seconds + 90) * 1000);
      const out = [r.stdout && `stdout:\n${r.stdout}`, r.stderr && `stderr:\n${r.stderr}`, r.exitCode != null && `exit code: ${r.exitCode}`,
        r.timedOut && `It ran out of time after ${seconds} seconds.`, r.error && !r.timedOut && `Note: ${r.error}`].filter(Boolean).join('\n');
      return text((out || '(no output)').slice(0, 20000));
    },
  },
  {
    name: 'read_file',
    description: `Read a text file from your computer.${COPY}`,
    inputSchema: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    run: async ({ path }) => text(String((await call('/read', { path }, 90_000)).content ?? '').slice(0, 50000)),
  },
  {
    name: 'write_file',
    description: `Write a text file on your computer.${COPY}`,
    inputSchema: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
    run: async ({ path, content }) => { await call('/write', { path, content }, 90_000); return text(`Wrote ${path}`); },
  },
];

const send = (msg) => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...msg }) + '\n');

async function handle({ id, method, params }) {
  if (id === undefined) return;
  if (method === 'initialize') return send({ id, result: { protocolVersion: params?.protocolVersion || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'computer', version: '0.1.0' } } });
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
