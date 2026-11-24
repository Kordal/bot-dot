// The one sentence that sends a bot and the Chief to kit:ui for a chart, KPIs, a comparison or a table (ADR 264): a
// model picks a skill from its one-line description, and on a live server a bot asked for a table wrote a Markdown
// one without loading it. A bot with kit:ui switched off is not told of it.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot, waitFor } = require('./helpers');
const { kitSkills, kitUiNote } = require('../lib/skills');

const SENTENCE = /When the answer is a chart, KPIs, a comparison or a table, load kit:ui and draw a view instead of a Markdown table or a list of numbers\./;

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.stop());

test('the sentence is one line, and only for a kit that has kit:ui', () => {
  const note = kitUiNote(kitSkills());
  assert.match(note, SENTENCE);
  assert.ok(!note.includes('\n') && note.length < 200, 'one short sentence');
  assert.equal(kitUiNote(kitSkills(['ui'])), '');
  assert.equal(kitUiNote(kitSkills(['kit:ui'])), '');
  assert.equal(kitUiNote([]), '');
  assert.match(kitUiNote(kitSkills(['kit:pages'])), SENTENCE, 'another skill off leaves it');
});

test("a bot's run is told it; one with kit:ui switched off, or with skills off, is not", async () => {
  const bot = await makeBot(srv, { name: 'Table Maker' });
  const runOf = async (nth) => {
    srv.reply('Done.');
    await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: `Compare three databases (${nth})` } });
    const run = await srv.nextRun((x) => x.args.includes(`${bot.emoji} ${bot.name}`), `the bot's run ${nth}`);
    await waitFor(async () => !(await srv.api(`/bots/${bot.id}`)).data.running, { what: 'the run to end' });
    return run;
  };
  const on = await runOf(1);
  assert.match(on.system, SENTENCE);
  assert.equal(on.system.split('load kit:ui and draw a view').length, 2, 'said once');

  await srv.api(`/bots/${bot.id}`, { method: 'PUT', body: { disabledSkills: ['kit:ui'] } });
  const off = await runOf(2);
  assert.doesNotMatch(off.system, /load kit:ui/);

  await srv.api(`/bots/${bot.id}`, { method: 'PUT', body: { disabledSkills: [], useSkills: false } });
  const none = await runOf(3);
  assert.doesNotMatch(none.system, /load kit:ui/);
});

test('the Chief is told it too', async () => {
  srv.reply('Done.');
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Compare Postgres and MySQL.' } });
  const turn = await srv.nextRun((r) => !!r.botdot, "the Chief's turn");
  await waitFor(async () => !(await srv.api(`/chief/chats/${chat.id}`)).data.busy, { what: 'the Chief to reply' });
  assert.match(turn.system, SENTENCE);
});
