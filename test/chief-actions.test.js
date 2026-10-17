const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, makeBot, waitFor } = require('./helpers');

test('Chief run actions identify the bot before the reply finishes and after reload', async () => {
  const srv = await startServer();
  try {
    const bot = await makeBot(srv, { name: 'Web Surfer', computer: 'linux' });
    const events = [
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool-1', name: 'mcp__botdot__run_bot', input: { id: bot.id } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool-1', content: JSON.stringify({ id: 'run-1', bot: bot.name }) }] } },
      // A second run_bot, on the bot that is now busy: its run waits its turn (ADR 011), as the tool's answer says.
      { type: 'assistant', message: { content: [{ type: 'tool_use', id: 'tool-2', name: 'mcp__botdot__run_bot', input: { id: bot.id } }] } },
      { type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: 'tool-2', content: JSON.stringify({ id: 'run-2', bot: bot.name, status: 'queued', note: `${bot.name} is busy: this starts when it is free.` }) }] } },
    ];
    fs.writeFileSync(path.join(srv.out, 'events.json'), JSON.stringify(events));
    srv.hold();
    const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
    await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Open the website' } });
    const pending = await waitFor(async () => {
      const c = (await srv.api(`/chief/chats/${chat.id}`)).data;
      return c.messages.at(-1)?.actions?.length === 2 ? c : null;
    });
    assert.equal(pending.messages.at(-1).pending, true);
    const action = { kind: 'run', text: 'Started Web Surfer', botId: bot.id, runId: 'run-1' };
    const asked = { kind: 'run', text: 'Asked Web Surfer · starts when it is free', botId: bot.id, runId: 'run-2' };
    assert.deepEqual(pending.messages.at(-1).actions, [action, asked]);
    srv.unhold();
    const finished = await waitFor(async () => {
      const c = (await srv.api(`/chief/chats/${chat.id}`)).data;
      return !c.busy && !c.messages.at(-1).pending ? c : null;
    });
    assert.deepEqual(finished.messages.at(-1).actions, [action, asked]);
  } finally { await srv.stop(); }
});
