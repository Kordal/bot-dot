// Memory tests use disposable databases and the actual MCP stdio servers.
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const readline = require('readline');
const { spawn } = require('child_process');
const { once } = require('events');
const { ROOT } = require('./helpers');

// options: what lib/memory.js create() takes beside the folder (a test's own source of note ids).
// dir: a folder an earlier store of this test was made in, for a second start on the same database.
function scratchMemory(t, options = {}, dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-memory-'))) {
  // embed.create installs process handlers but has no dispose method. Remove only this fixture's
  // handlers, so many independent databases do not accumulate listeners in the test process.
  const events = ['exit', 'SIGINT', 'SIGTERM'];
  const before = new Map(events.map((e) => [e, new Set(process.listeners(e))]));
  const memory = require('../lib/memory').create(dir, options);
  const added = events.flatMap((e) => process.listeners(e).filter((fn) => !before.get(e).has(fn)).map((fn) => [e, fn]));
  t.after(() => {
    memory.setSemanticSettings({ enabled: false });
    for (const [e, fn] of added) process.removeListener(e, fn);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  return { memory, dir };
}

const daysAgo = (days) => new Date(Date.now() - days * 864e5).toISOString();
const runMeta = (overrides = {}) => ({
  id: crypto.randomUUID(), botId: 'alpha', botName: 'Alpha', startedAt: daysAgo(0),
  status: 'success', trigger: 'manual', customPrompt: true,
  prompt: 'Inspect the orchard', result: 'The orchard is healthy.', ...overrides,
});

function rpcClient(t, filename, env) {
  const child = spawn(process.execPath, [path.join(ROOT, 'lib', filename)], {
    // TZ: the test server's (helpers.js SERVER_TZ). Without it the MCP server writes days in the machine's zone,
    // a day after the server's late in the evening east of UTC.
    env: { PATH: process.env.PATH, TZ: 'UTC', ...env }, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const exited = once(child, 'exit');
  const waiting = new Map();
  let serial = 0;
  let stderr = '';
  child.stderr.on('data', (b) => { stderr += b; });
  const failAll = (error) => {
    for (const p of waiting.values()) { clearTimeout(p.timer); p.reject(error); }
    waiting.clear();
  };
  child.on('error', failAll);
  child.on('exit', () => failAll(new Error(`MCP exited: ${stderr}`)));
  readline.createInterface({ input: child.stdout }).on('line', (line) => {
    const msg = JSON.parse(line);
    const pending = waiting.get(msg.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    waiting.delete(msg.id);
    if (msg.error) pending.reject(new Error(msg.error.message));
    else pending.resolve(msg.result);
  });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) child.kill();
    await exited;
  });
  const request = (method, params = {}) => new Promise((resolve, reject) => {
    const id = ++serial;
    const timer = setTimeout(() => {
      waiting.delete(id);
      reject(new Error(`MCP timed out: ${method} ${params.name || ''}; ${stderr}`));
    }, 15_000);
    waiting.set(id, { resolve, reject, timer });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
  const call = (name, args = {}) => request('tools/call', { name, arguments: args });
  const text = async (name, args = {}) => {
    const r = await call(name, args);
    assert.ok(!r.isError, JSON.stringify(r));
    return r.content.map((c) => c.text || '').join('\n');
  };
  return { request, call, text, json: async (name, args) => JSON.parse(await text(name, args)) };
}

// What a run learned as its record keeps it, each item read as learning.js learnedView reads it, from the store as
// it now stands. The apps are not sent a done memory change (ADR 024): its words are checked here, from the record.
const stores = new Map();
function storedLearned(srv, runId) {
  if (!stores.has(srv.data)) stores.set(srv.data, require('../lib/memory').create(srv.data));
  let log = '';
  try { log = fs.readFileSync(path.join(srv.data, 'runs', `${runId}.ndjson`), 'utf8'); } catch { /* not written yet */ }
  const items = log.split('\n').filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter((e) => e?.type === 'learned').map((e) => e.item);
  return items.map((x) => require('../lib/learning').learnedView(x, stores.get(srv.data)));
}

module.exports = { scratchMemory, daysAgo, runMeta, rpcClient, storedLearned };
