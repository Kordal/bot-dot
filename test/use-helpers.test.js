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

test('ask_permission "helpers" makes a card naming the bot, and Allow gives the next run Agent and Task and the guidance', async () => {
  const bot = await makeBot(srv, { name: 'Coder', emoji: '💻', allowedTools: ['Read', 'Edit', 'Write', 'Bash'] });
  const h = await heldRun(srv, bot, 'Port the three services');
  const r = await self(srv, h.token, 'ask', { kind: 'permission', permission: 'helpers', reason: 'To port the three services in parallel' });
  assert.equal(r.data.ok, true, JSON.stringify(r.data));
  srv.release(h.rec);
  await srv.finished(h.run.id);
  srv.unhold();
  const [card] = await asksOf(bot);
  assert.deepEqual([card.kind, card.permission, card.reason], ['permission', 'helpers', 'To port the three services in parallel']);
  assert.equal(card.text, 'Asks to use helpers');
  assert.equal(card.bot.name, 'Coder');
  const yes = (await srv.api(`/asks/${card.id}`, { method: 'POST', body: { yes: true } })).data;
  assert.equal(yes.ok, true, JSON.stringify(yes));
  const tools = (await srv.api(`/bots/${bot.id}`)).data.allowedTools;
  assert.ok(tools.includes('Agent') && tools.includes('Task'), tools.join(', '));
  // The run that asked carries on with them.
  const next = await srv.nextRun((x) => x.self?.env && x.args.includes('💻 Coder'), 'the run that carries on');
  assert.ok(allowedOf(next).includes('Agent') && allowedOf(next).includes('Task'), allowedOf(next).join(' '));
  assert.match(next.system, HELPERS);
  assert.match(next.system, /its own git worktree and branch beside it/);
  assert.match(next.system, /Helpers keep no notes/);
  srv.release(next);
  await srv.finished((await srv.api(`/runs?botId=${bot.id}`)).data.find((x) => x.continues).id);
  // Asked again, it already has it.
  const again = await heldRun(srv, bot);
  const r2 = await self(srv, again.token, 'ask', { kind: 'permission', permission: 'helpers', reason: 'Again' });
  assert.match(r2.data.error, /already have that permission/);
  srv.release(again.rec);
  await srv.finished(again.run.id);
  srv.unhold();
});

test('a refused Agent call asks the owner for helpers', async () => {
  const bot = await makeBot(srv, { name: 'Researcher', emoji: '🔎', allowedTools: ['Read'] });
  refuse([{ tool_name: 'Agent', tool_use_id: 't1', tool_input: { description: 'Read the three reports', prompt: 'Summarise them' } }]);
  const r = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Compare the reports' } });
  await srv.finished(r.data.id);
  refuse([]);
  const list = await asksOf(bot);
  assert.equal(list.length, 1);
  assert.equal(list[0].permission, 'helpers');
  assert.match(list[0].reason, /Read the three reports/);
});
