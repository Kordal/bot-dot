// The owner's dated item for a bot starts that bot on its day (ADR 190, #1118): once for its due day, outside the
// quiet hours, and never for an item the Chief or a bot added (ADR 115).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { startServer, makeBot, writeData, waitFor } = require('./helpers');
const { today } = require('../lib/company');

let srv; let mine; let theirs; let old;
before(async () => {
  srv = await startServer({ env: { BOT_DOT_COMPANY_EVERY_MS: '300', BOT_DOT_LEAD_DELAY_MS: 'off' } });
  await srv.api('/settings/quiet-hours', { method: 'PUT', body: { start: 0, end: 0 } }); // the tests run at any hour
  mine = await makeBot(srv, { name: 'Due Bot', emoji: '📅' });
  theirs = await makeBot(srv, { name: 'Chief Item Bot', emoji: '🗂' });
  old = await makeBot(srv, { name: 'Old Item Bot', emoji: '🗃' });
  assert.equal((await srv.api('/company', { method: 'POST', body: { start: 'A planner for busy parents' } })).status, 201);
  const c = (await srv.api('/company')).data.company;
  const day = today(new Date());
  writeData(path.join(srv.data, 'company.json'), {
    ...c, name: 'Fernhill', phase: 'running', startedAt: new Date().toISOString(),
    teams: [{ id: 't1', name: 'Growth', bots: [mine.id, theirs.id, old.id], lead: mine.id }],
    todos: [
      { id: 'due1', text: 'Send the weekly numbers', bot: mine.id, due: day, by: 'you', done: false, at: new Date().toISOString() },
      { id: 'chief1', text: 'Tidy the board', bot: theirs.id, due: day, by: 'chief', done: false, at: new Date().toISOString() },
      { id: 'old1', text: 'Something from last month', bot: old.id, due: '2026-01-05', by: 'you', done: false, at: new Date().toISOString() },
    ],
  });
});
after(() => srv.stop());

// The runs of a bot on an item: a lead's own question (ADR 118) is not one.
const runsOf = async (bot) => (await srv.api(`/runs?botId=${bot.id}`)).data.filter((r) => /Send the weekly numbers|Tidy the board|Something from last month/.test(r.prompt || ''));
const item = async (id) => (await srv.api('/company')).data.company.todos.find((t) => t.id === id);

test("the owner's item due today starts its bot once, as the owner's message", async () => {
  const runs = await waitFor(async () => { const r = await runsOf(mine); return r.length ? r : null; }, { what: 'the bot started on its item' });
  assert.equal(runs.length, 1);
  assert.match(runs[0].prompt, /Send the weekly numbers/);
  assert.equal((await item('due1')).started, today(new Date()));
  await new Promise((r) => setTimeout(r, 1200)); // a few more rounds
  assert.equal((await runsOf(mine)).length, 1, 'once for its day');
});

test("the Chief's item and an old one start nothing", async () => {
  assert.equal((await runsOf(theirs)).length, 0);
  assert.equal((await runsOf(old)).length, 0);
  assert.equal((await item('chief1')).started, undefined);
});
