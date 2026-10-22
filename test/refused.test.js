// A tool a run was refused because the bot's settings don't allow it asks nobody by itself (#279): a permission card
// appears only when the bot asks for it with ask_permission, once, and not again for a week after a no. The stand-in
// Claude asks for what it was refused, as a bot that follows its prompt does, unless $FAKE_OUT/no-ask exists. The ask
// keeps the run that asked, and its card says what a yes starts (test/ask-carries-on.test.js has what follows).
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

test('the bot asking for a command it was refused makes one permission card, with what it tried', async () => {
  const bot = await makeBot(srv, { name: 'Coder', emoji: '💻', allowedTools: ['Read'] });
  refuse([bash, { ...bash, tool_use_id: 't2' }, { tool_name: 'mcp__claude_ai_AgentMail__list_inboxes', tool_use_id: 't3', tool_input: {} }]);
  await run(bot);
  let list = await asksOf(bot);
  assert.equal(list.length, 1, 'one card for the commands; apps are left to the Connectors page');
  assert.equal(list[0].permission, 'commands');
  assert.match(list[0].reason, /List open pull requests/);
  assert.deepEqual(Object.keys(list[0]).sort(), ['at', 'bot', 'botId', 'forBots', 'id', 'kind', 'permission', 'reason', 'text', 'then', 'what'], 'what a card of a refused tool has');
  assert.deepEqual(list[0].then, { who: 'bot', text: 'It carries on with “Check the PRs” when you allow it.' });
  await run(bot);
  list = await asksOf(bot);
  assert.equal(list.length, 1, "it doesn't ask twice");
  assert.deepEqual(list[0].then, { who: 'bot', text: 'It carries on with “Check the PRs” when you allow it.' }, 'the owner asked again and was refused the same: the later request carries on');
  // Yes gives it the permission, and the bot carries on with the later request.
  const yes = (await srv.api(`/asks/${list[0].id}`, { method: 'POST', body: { yes: true } })).data;
  assert.deepEqual([yes.ok, yes.carriesOn], [true, { who: 'bot', text: 'it carries on' }]);
  assert.ok((await srv.api(`/bots/${bot.id}`)).data.allowedTools.includes('Bash'));
  const runs = (await srv.api(`/runs?botId=${bot.id}`)).data;
  assert.equal(runs.filter((r) => r.continues).length, 1, 'one run, for one of the two requests');
  await srv.finished(runs.find((r) => r.continues).id);
  await run(bot);
  assert.equal((await asksOf(bot)).length, 0, 'nothing to ask once it has it');
  refuse([]);
});

test('after a no, nobody asks for it again for a week', async () => {
  const bot = await makeBot(srv, { name: 'Surfer', emoji: '🏄', allowedTools: ['Read'] });
  refuse([{ tool_name: 'WebFetch', tool_use_id: 't1', tool_input: { url: 'https://example.com' } }]);
  await run(bot);
  const [card] = await asksOf(bot);
  assert.equal(card.permission, 'web');
  await srv.api(`/asks/${card.id}`, { method: 'POST', body: { yes: false } });
  await run(bot);
  assert.equal((await asksOf(bot)).length, 0, 'not asked again');
  refuse([]);
  // The bot asking itself is refused too, and told why.
  for (let i = 0; i < 2; i++) await srv.nextRun((x) => x.args.includes('🏄 Surfer'), 'the earlier runs'); // not the run to use below
  const h = await heldRun(srv, bot);
  const r = await self(srv, h.token, 'ask', { kind: 'permission', permission: 'web', reason: 'To read the page' });
  assert.match(r.data.error, /said no to this recently/);
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
