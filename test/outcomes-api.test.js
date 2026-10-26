// The outcome ledger on a real server (ADR 099): a run of Claude records its failed tools, the owner's message soon
// after re-asks it, and GET /api/bots/:id/outcomes answers the rows and the worst patterns.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, waitFor } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.stop(); });

const send = async (bot, prompt) => srv.finished((await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt } })).data.id);
const ledger = async (bot, q = '') => (await srv.api(`/bots/${bot.id}/outcomes${q}`)).data;

test("a run's failed tool calls, and the owner's correction right after it, are in the bot's ledger", async () => {
  const bot = await makeBot(srv, { name: 'Ledger Scout' });
  const events = path.join(srv.out, 'events.json');
  fs.writeFileSync(events, JSON.stringify([
    { type: 'assistant', message: { role: 'assistant', content: [{ type: 'tool_use', id: 'tu1', name: 'WebFetch', input: { url: 'https://example.com' } }] } },
    { type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'tu1', is_error: true, content: 'SECRETERROR 403' }] } },
  ]));
  let first;
  try { first = await send(bot, 'Check the tide table'); } finally { fs.rmSync(events, { force: true }); }
  assert.equal(first.status, 'success');
  const row = await waitFor(async () => (await ledger(bot)).outcomes.find((o) => o.runId === first.id));
  assert.equal(row.outcome, 'done');
  assert.equal(row.source, 'owner');
  assert.equal(row.toolErrors, 1);
  assert.deepEqual(row.failedTools, ['WebFetch']);
  assert.equal(row.kind, 'claude');

  await send(bot, 'No, the one for Gdynia');
  const after = await ledger(bot);
  const corrected = after.outcomes.find((o) => o.runId === first.id);
  assert.equal(corrected.reasked, true);
  assert.equal(corrected.corrected, true);
  assert.equal(after.outcomes.length, 2);
  assert.equal(after.days, 7);
  assert.ok(after.worst.some((w) => w.signal === 'corrected' && w.task === 'owner' && w.runs === 1 && w.of === 2), JSON.stringify(after.worst));
  assert.ok(after.worst.some((w) => w.signal === 'tool errors' && w.tools?.includes('WebFetch')), JSON.stringify(after.worst));
  assert.ok(!JSON.stringify(after).includes('SECRETERROR') && !JSON.stringify(after).includes('Gdynia'), 'no text of a run');
});

test('the ledger takes days from 1 to 90, and an unknown bot is 404', async () => {
  const bot = await makeBot(srv, { name: 'Ledger Days' });
  assert.equal((await srv.api(`/bots/${bot.id}/outcomes?days=0`)).status, 400);
  assert.equal((await srv.api(`/bots/${bot.id}/outcomes?days=91`)).status, 400);
  assert.equal((await srv.api(`/bots/${bot.id}/outcomes?days=x`)).status, 400);
  assert.deepEqual(await ledger(bot, '?days=30'), { days: 30, outcomes: [], worst: [] });
  assert.equal((await srv.api('/bots/nobody/outcomes')).status, 404);
});
