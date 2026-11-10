// Every run is told what of its bot waits in Needs you as it starts, read from the cards themselves: the chat a
// run reads can still say it asked for something the owner answered since (a turn in a group beside the run that
// carries on), and it must never say a card waits when none does.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot, heldRun, self, waitFor } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.stop());

async function run(bot, prompt) {
  const h = await heldRun(srv, bot, prompt);
  return { ...h, done: async () => { srv.release(h.rec); await srv.finished(h.run.id); srv.unhold(); } };
}

test('a run is told that nothing of its bot waits in Needs you, then what waits, then nothing once it is answered', async () => {
  const bot = await makeBot(srv, { name: 'Video Maker', emoji: '🎬', allowedTools: ['Read'] });
  const first = await run(bot, 'Make the video');
  assert.match(first.rec.system, /Nothing of yours waits in Needs you right now\. Never say that a card of yours waits there/);
  const r = await self(srv, first.token, 'ask', { kind: 'permission', permission: 'commands', reason: 'To render the video' });
  assert.equal(r.data.ok, true, JSON.stringify(r.data));
  await first.done();

  const second = await run(bot, 'Write in English from now on');
  assert.match(second.rec.system, /What of yours waits in Needs you right now: your OK to run commands\. Nothing else of yours waits there\./);
  await second.done();

  const [card] = (await srv.api('/asks')).data.filter((a) => a.botId === bot.id);
  const yes = (await srv.api(`/asks/${card.id}`, { method: 'POST', body: { yes: true } })).data;
  assert.equal(yes.ok, true, JSON.stringify(yes));
  // The video carries on after the yes, told of the message written since (ADR 180): let it end first.
  await srv.nextRun((x) => x.args.includes(`${bot.emoji} ${bot.name}`) && /Make the video/.test(x.stdin), 'the video carrying on');
  await waitFor(async () => { const runs = (await srv.api(`/runs?botId=${bot.id}`)).data; return runs.some((r) => r.continues === first.run.id && r.status !== 'running' && r.status !== 'queued'); }, { what: 'the video carrying on' });
  const third = await run(bot, 'How is the video going?');
  assert.match(third.rec.system, /Nothing of yours waits in Needs you right now/);
  assert.doesNotMatch(third.rec.system, /your OK to run commands/);
  await third.done();
});

test('a card of another kind is named by the line its notification says', async () => {
  const bot = await makeBot(srv, { name: 'Rule Keeper', emoji: '📏' });
  const first = await run(bot, 'Edit the config');
  const r = await self(srv, first.token, 'ask', { kind: 'override', rule: 'Never touch the config', action: 'Edit config.json', reason: 'You asked' });
  assert.equal(r.data.ok, true, JSON.stringify(r.data));
  await first.done();
  const second = await run(bot, 'Go on');
  assert.match(second.rec.system, /What of yours waits in Needs you right now: your OK on “Asks to lift a rule: Edit config\.json”/);
  await second.done();
});
