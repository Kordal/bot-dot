const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, makeBot, heldRun, waitFor } = require('./helpers');

test('Chief waiting activity survives HTTP reload and SSE reconnect, then clears on tool results and stop', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const bot = await makeBot(srv, { name: 'Proxmox Keeper' });
  const { run } = await heldRun(srv, bot);
  const otherBot = await makeBot(srv, { name: 'Backup Keeper' });
  const { run: otherRun } = await heldRun(srv, otherBot);
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Check Proxmox' } });
  const rec = await srv.nextRun((r) => !!r.botdot);
  const events = [];
  const send = (event) => { events.push(event); fs.writeFileSync(path.join(srv.out, `events-${rec.n}.json`), JSON.stringify(events)); };
  const use = (id, name, input = {}) => send({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name, input }] } });
  const result = (id) => send({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content: 'Done' }] } });
  const message = async () => (await srv.api(`/chief/chats/${chat.id}`)).data.messages.at(-1);
  const activity = (text) => waitFor(async () => (await message()).activity?.text === text, { what: text, timeout: 2000 });
  use('wait1', 'mcp__botdot__wait_for_run', { runId: run.id });
  await activity('Waiting for Proxmox Keeper');
  for (let connection = 0; connection < 2; connection++) {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 2000);
    try {
      const response = await fetch(`${srv.base}/api/chief/chats/${chat.id}/stream`, { signal: abort.signal });
      let stream = '';
      for await (const chunk of response.body) {
        stream += Buffer.from(chunk).toString();
        if (stream.includes('Waiting for Proxmox Keeper')) break;
      }
      assert.match(stream, /Waiting for Proxmox Keeper/);
    } finally { clearTimeout(timer); abort.abort(); }
  }
  use('read', 'Read', { file_path: '/tmp/example' });
  use('wait2', 'mcp__botdot__wait_for_run', { runId: otherRun.id });
  result('wait1');
  await activity('Waiting for Backup Keeper');
  result('wait2');
  await waitFor(async () => (await message()).activity?.tool === 'Read');
  result('read');
  await activity('Thinking');
  use('unknown', 'mcp__botdot__wait_for_run', { runId: 'missing' });
  await activity('Waiting for the bot to finish');
  await srv.api(`/chief/chats/${chat.id}/stop`, { method: 'POST' });
  await waitFor(async () => !(await message()).pending);
  assert.equal((await message()).activity, undefined);

  // Normal completion also drops a pending tool's activity, even without a tool result.
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Try again' } });
  const next = await srv.nextRun((r) => !!r.botdot);
  fs.writeFileSync(path.join(srv.out, `events-${next.n}.json`), JSON.stringify([
    { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'last', name: 'mcp__botdot__wait_for_run', input: { runId: run.id } }] } },
  ]));
  await activity('Waiting for Proxmox Keeper');
  srv.release(next);
  await waitFor(async () => !(await message()).pending);
  assert.equal((await message()).activity, undefined);
  assert.equal((await message()).text, 'Done.');
});
