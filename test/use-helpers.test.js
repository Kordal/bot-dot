// A bot may use helpers (#226): Claude Code's Agent tool (Task in older versions). Every bot has both, and is told how to
// use helpers, from its first run: nothing to switch on, nothing to ask for (ADR 268, which took over from ADR 178).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, heldRun, self } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.stop());

const asksOf = async (bot) => (await srv.api('/asks')).data.filter((a) => a.botId === bot.id);
const refuse = (denials) => fs.writeFileSync(path.join(srv.out, 'denials.json'), JSON.stringify(denials));
// The tools a run was given: what follows --allowedTools, up to the next flag.
const allowedOf = (rec) => {
  const from = rec.args.indexOf('--allowedTools') + 1;
  const end = rec.args.findIndex((a, i) => i >= from && a.startsWith('--'));
  return rec.args.slice(from, end < 0 ? undefined : end);
};
const HELPERS = /Helpers: the Agent tool starts a helper/;

test('every bot has the Agent and Task tools and the guidance on helpers from its first run, with no card (ADR 268)', async () => {
  const bot = await makeBot(srv, { name: 'Coder', emoji: '💻', allowedTools: ['Read', 'Edit', 'Write', 'Bash'] });
  const h = await heldRun(srv, bot, 'Port the three services');
  assert.ok(allowedOf(h.rec).includes('Agent') && allowedOf(h.rec).includes('Task'), allowedOf(h.rec).join(' '));
  assert.match(h.rec.system, HELPERS);
  assert.match(h.rec.system, /its own git worktree and branch beside it/);
  assert.match(h.rec.system, /Helpers keep no notes/);
  // It has no permission to ask for.
  const r = await self(srv, h.token, 'ask', { kind: 'permission', permission: 'helpers', reason: 'To port the three services in parallel' });
  assert.match(r.data.error, /already have/);
  srv.release(h.rec);
  await srv.finished(h.run.id);
  srv.unhold();
  assert.deepEqual(await asksOf(bot), [], 'no card');
  // One made with the Read tool alone has them too, and keeps them when a save drops them.
  const reader = await makeBot(srv, { name: 'Reader', emoji: '📖', allowedTools: ['Read'] });
  const tools = (await srv.api(`/bots/${reader.id}`)).data.allowedTools;
  assert.ok(['Agent', 'Task', 'Bash'].every((t) => tools.includes(t)), tools.join(', '));
  const dropped = (await srv.api(`/bots/${reader.id}`, { method: 'PUT', body: { allowedTools: ['Read'] } })).data.allowedTools;
  assert.ok(['Agent', 'Task', 'Bash'].every((t) => dropped.includes(t)), dropped.join(', '));
});

test('a refused Agent call makes no card: the bot has helpers already', async () => {
  const bot = await makeBot(srv, { name: 'Researcher', emoji: '🔎', allowedTools: ['Read'] });
  refuse([{ tool_name: 'Agent', tool_use_id: 't1', tool_input: { description: 'Read the three reports', prompt: 'Summarise them' } }]);
  const r = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Compare the reports' } });
  await srv.finished(r.data.id);
  refuse([]);
  assert.deepEqual(await asksOf(bot), []);
  const tools = (await srv.api(`/bots/${bot.id}`)).data.allowedTools;
  assert.ok(tools.includes('Agent'), tools.join(', '));
});
