// A dated to-do of the owner's starts its bot on its day as the owner's message (ADR 190). Its words are the
// owner's only while the owner wrote them: once the Chief changed its text, a quote of it makes no note the
// owner's (ADR 278). Through the real server, its own tick, and the stand-in for Claude; the second run waits its
// turn (one run at a time), so the mark goes through the queue too.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { startServer, makeBot, writeData, self, serverDay, waitFor } = require('./helpers');

let srv, b;
before(async () => {
  srv = await startServer({ env: { BOT_DOT_COMPANY_EVERY_MS: '200', BOT_DOT_RUNS_MAX: '1' } });
  await srv.api('/settings/quiet-hours', { method: 'PUT', body: { start: 0, end: 0 } }); // a to-do starts at any hour
  b = await makeBot(srv, { name: 'Todo Quoter', emoji: '📌', mayMessage: [] });
  assert.equal((await srv.api('/company', { method: 'POST', body: { start: 'A planner for busy parents' } })).status, 201);
  const c = (await srv.api('/company')).data.company;
  writeData(path.join(srv.data, 'company.json'), { ...c, name: 'Fernhill', phase: 'running', startedAt: new Date().toISOString(), teams: [{ id: 't1', name: 'Growth', bots: [b.id], lead: b.id }] });
});
after(() => { srv.unhold(); return srv.stop(); });

const isRunOf = (x) => !!x.self?.env && x.args.includes(`${b.emoji} ${b.name}`);
const add = async (text) => (await srv.api('/company/todos', { method: 'POST', body: { text, bot: b.id, due: '2099-01-01' } })).data.todos.at(-1);
const source = async (rec, text, quote) => (await self(srv, rec.self.env.RUN_TOKEN, 'memory', { action: 'add', text, quote })).data.note.source;

test("ADR 278: an owner's to-do starts with their words; one whose text the Chief changed starts with the Chief's, through the queue too", async () => {
  srv.hold();
  const mine = await add('Remember that I live in Lodz');
  await srv.api(`/company/todos/${mine.id}`, { method: 'PUT', body: { due: serverDay() } });
  const first = await srv.nextRun((x) => isRunOf(x) && x.stdin.includes('I live in Lodz'), "the owner's to-do on its day");
  assert.equal(await source(first, 'The owner lives in Lodz', 'I live in Lodz'), 'owner');

  // The bot is busy: this one waits its turn.
  const changed = await add('Call the bank');
  const r = await srv.asChief(`/company/todos/${changed.id}`, { method: 'PUT', body: { text: 'Remember that I work from Gdansk', due: serverDay() } });
  assert.equal(r.data.todos.find((x) => x.id === changed.id).textBy, 'chief');
  // Started by the tick while the first run goes: it waits in the queue for its turn.
  await waitFor(async () => (await srv.api('/company')).data.company.todos.find((x) => x.id === changed.id)?.started === serverDay(), { what: 'the tick to start it' });
  assert.equal(srv.runs().filter(isRunOf).length, 1, 'it waits behind the first');
  srv.release(first);
  const second = await srv.nextRun((x) => isRunOf(x) && x.stdin.includes('I work from Gdansk'), "the Chief's text on its day");
  assert.equal(await source(second, 'The owner works from Gdansk', 'I work from Gdansk'), 'bot', "the Chief's words are not the owner's");
  srv.release(second);
});
