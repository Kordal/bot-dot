// A tool a run was refused asks nobody by itself (#279), and since ADR 268 no bot has a permission to ask for: every
// bot has the web, files, commands and helpers, so a refused Bash or Agent makes no card. The stand-in Claude asks
// for what it was refused, as a bot that follows its prompt does, unless $FAKE_OUT/no-ask exists.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, heldRun, self } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.stop());

const refuse = (denials) => fs.writeFileSync(path.join(srv.out, 'denials.json'), JSON.stringify(denials));
const bash = { tool_name: 'Bash', tool_use_id: 't1', tool_input: { command: 'gh pr list', description: 'List open pull requests' } };
const asksOf = async (bot) => (await srv.api('/asks')).data.filter((a) => a.botId === bot.id);
async function run(bot) {
  const r = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Check the PRs' } });
  return srv.finished(r.data.id);
}

test('a refused tool alone makes no card', async () => {
  const bot = await makeBot(srv, { name: 'Prober', emoji: '🔎', allowedTools: ['Read'] });
  fs.writeFileSync(path.join(srv.out, 'no-ask'), '');
  try {
    refuse([bash, { tool_name: 'WebFetch', tool_use_id: 't2', tool_input: { url: 'https://example.com' } }]);
    await run(bot);
    assert.equal((await asksOf(bot)).length, 0, 'botdot asks the owner nothing by itself');
  } finally { fs.rmSync(path.join(srv.out, 'no-ask'), { force: true }); refuse([]); }
});

test('a command it was refused makes no card, whoever asks: every bot has commands and helpers (ADR 268)', async () => {
  const bot = await makeBot(srv, { name: 'Coder', emoji: '💻', allowedTools: ['Read'] });
  refuse([bash, { ...bash, tool_use_id: 't2' }, { tool_name: 'Agent', tool_use_id: 't3', tool_input: {} }, { tool_name: 'mcp__claude_ai_AgentMail__list_inboxes', tool_use_id: 't4', tool_input: {} }]);
  await run(bot);
  refuse([]);
  assert.deepEqual(await asksOf(bot), [], 'a stand-in that asks for what it was refused finds nothing to ask for');
  assert.ok((await srv.api(`/bots/${bot.id}`)).data.allowedTools.includes('Bash'));
  // The bot asking itself is told it has them already, and no card is made.
  await srv.nextRun((x) => x.args.includes('💻 Coder'), 'the earlier run'); // not the run to use below
  const h = await heldRun(srv, bot);
  for (const permission of ['commands', 'helpers']) {
    const r = await self(srv, h.token, 'ask', { kind: 'permission', permission, reason: 'To list them' });
    assert.match(r.data.error, /already have/);
  }
  assert.deepEqual(await asksOf(bot), []);
  srv.release(h.rec);
  await srv.finished(h.run.id);
  srv.unhold();
});

test('the memory review never asks', async () => {
  const bot = await makeBot(srv, { name: 'Reviewer', emoji: '🧹', allowedTools: ['Read'] });
  refuse([bash]);
  const r = await srv.api(`/memory/review/${bot.id}`, { method: 'POST' });
  await srv.finished(r.data.run.id);
  assert.equal((await asksOf(bot)).length, 0);
  refuse([]);
});
