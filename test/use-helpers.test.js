// A bot may use helpers (#226): Claude Code's Agent tool (Task in older versions) is the permission "use helpers",
// off by default. Its card turns both on, the next run is given them, and only a bot that has them is told how to
// use helpers. A bot refused the Agent tool asks the owner for helpers with ask_permission, as for any refused tool (ADR 054).
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

test('a bot without the permission has no Agent tool and no word of helpers', async () => {
  const bot = await makeBot(srv, { name: 'Plain Coder', emoji: '🧑‍💻', allowedTools: ['Read', 'Edit', 'Write', 'Bash'] });
  const h = await heldRun(srv, bot);
  assert.ok(!allowedOf(h.rec).includes('Agent'));
  assert.doesNotMatch(h.rec.system, HELPERS);
  srv.release(h.rec);
  await srv.finished(h.run.id);
  srv.unhold();
});

test('ask_permission "helpers" gives them at once, with no card, and the next run has Agent and Task and the guidance (ADR 178)', async () => {
  const bot = await makeBot(srv, { name: 'Coder', emoji: '💻', allowedTools: ['Read', 'Edit', 'Write', 'Bash'] });
  const h = await heldRun(srv, bot, 'Port the three services');
  const r = await self(srv, h.token, 'ask', { kind: 'permission', permission: 'helpers', reason: 'To port the three services in parallel' });
  assert.deepEqual([r.data.ok, r.data.given], [true, true], JSON.stringify(r.data));
  assert.match(r.data.say, /from your next run/);
  srv.release(h.rec);
  await srv.finished(h.run.id);
  srv.unhold();
  assert.deepEqual(await asksOf(bot), [], 'no card');
  const tools = (await srv.api(`/bots/${bot.id}`)).data.allowedTools;
  assert.ok(tools.includes('Agent') && tools.includes('Task'), tools.join(', '));
  const next = await heldRun(srv, bot, 'Port them now');
  assert.ok(allowedOf(next.rec).includes('Agent') && allowedOf(next.rec).includes('Task'), allowedOf(next.rec).join(' '));
  assert.match(next.rec.system, HELPERS);
  assert.match(next.rec.system, /its own git worktree and branch beside it/);
  assert.match(next.rec.system, /Helpers keep no notes/);
  // Asked again, it already has it.
  const r2 = await self(srv, next.token, 'ask', { kind: 'permission', permission: 'helpers', reason: 'Again' });
  assert.match(r2.data.error, /already have that permission/);
  srv.release(next.rec);
  await srv.finished(next.run.id);
  srv.unhold();
});

test('a refused Agent call gives the bot helpers, with no card', async () => {
  const bot = await makeBot(srv, { name: 'Researcher', emoji: '🔎', allowedTools: ['Read'] });
  refuse([{ tool_name: 'Agent', tool_use_id: 't1', tool_input: { description: 'Read the three reports', prompt: 'Summarise them' } }]);
  const r = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Compare the reports' } });
  await srv.finished(r.data.id);
  refuse([]);
  assert.deepEqual(await asksOf(bot), []);
  const tools = (await srv.api(`/bots/${bot.id}`)).data.allowedTools;
  assert.ok(tools.includes('Agent'), tools.join(', '));
});

