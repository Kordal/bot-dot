// The "Go to <computer>" card (ADR 258): a bot's go_to_computer puts a card on its run; "I'm done" and "Not now" are kept
// on that run, and the bot carries on from it, told which. Against the stand-in for Claude, with no Docker.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, restartServer, makeBot, heldRun } = require('./helpers');
const { kit } = require('./carry-on-helpers');
const card = require('../lib/computer-card');

let srv, lastRun, carriedOn, startsNothing;
before(async () => { srv = await startServer(); ({ lastRun, carriedOn, startsNothing } = kit(srv)); });
after(async () => { srv.unhold(); await srv.stop(); });

const go = (token, body) => srv.api('/vault/session/computer/go', { method: 'POST', body, headers: { 'X-Vault-Token': token } });
const answer = (bot, run, a) => srv.api(`/bots/${bot.id}/computer/card`, { method: 'POST', body: { run, answer: a } });
const STEPS = ['Browser window opened on its screen', 'Log in to Claude', "Come back and press I'm done"];

// A run of `bot` that asks the owner to go to its computer and then ends: the run as it ended.
async function asks(bot, body = { steps: STEPS, current: 2, minutes: 2 }) {
  const { rec, run, token } = await heldRun(srv, bot, 'Log in to Claude on the computer');
  const made = await go(token, body);
  srv.release(rec);
  srv.unhold();
  return { made, ended: await srv.finished(run.id) };
}
const bot = (name) => makeBot(srv, { name, emoji: '🧪', computer: 'linux', computerAlwaysOn: true });

test('go_to_computer puts a card on the run: steps, the one the owner is on, how long, waiting', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('computer-card'));
  const b = await bot('QA Tester');
  const { made, ended } = await asks(b);
  assert.equal(made.data.ok, true, JSON.stringify(made.data));
  assert.deepEqual({ ...ended.goTo, at: undefined }, { steps: STEPS, current: 2, minutes: 2, bot: b.id, place: 'linux', state: 'waiting', at: undefined });
  // It is the run's own, so a chat that reads its runs again draws it as it was.
  assert.equal((await srv.api(`/runs/${ended.id}`)).data.goTo.state, 'waiting');
  assert.equal((await srv.api(`/runs?botId=${b.id}`)).data.find((r) => r.id === ended.id).goTo.current, 2);
});

test('the bot is told what the card asks of it: no list in prose, one line', async () => {
  const b = await bot('Prompted');
  const { rec } = await heldRun(srv, b);
  assert.ok(rec.system.includes('call go_to_computer with the steps they do'));
  srv.release(rec);
  srv.unhold();
});

test('a card with no steps, too many, or a current step that is not one is refused in the bot\'s words', () => {
  assert.throws(() => card.make({ steps: [] }), /Give steps/);
  assert.throws(() => card.make({ steps: Array(7).fill('x') }), /At most 6 steps/);
  assert.throws(() => card.make({ steps: ['a', 'b'], current: 3 }), /from 1 to 2/);
  assert.throws(() => card.make({ steps: ['a'], minutes: 90 }), /from 1 to 60/);
  // Lines are one line each, never longer than a line: nothing a bot writes is markup.
  assert.deepEqual(card.make({ steps: ['  <b>Log in</b>\n\n now  '], compact: true, title: 'x'.repeat(200) }).steps, ['<b>Log in</b> now']);
  assert.equal(card.make({ steps: ['a'], title: 'x'.repeat(200) }).title.length, 80);
});

test('the tool needs the run\'s key', async () => {
  assert.equal((await go('made-up', { steps: ['a'] })).status, 403);
});

test('"I\'m done" is kept on the run, the card stays as one line, and the bot carries on told so', async () => {
  const b = await bot('Done Bot');
  const { ended } = await asks(b);
  const r = await answer(b, ended.id, 'done');
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual([r.data.ok, r.data.state, r.data.status, r.data.text], [true, 'done', 'started', 'Done Bot carries on.']);
  const kept = (await srv.api(`/runs/${ended.id}`)).data.goTo;
  assert.equal(kept.state, 'done');
  assert.ok(Date.parse(kept.answeredAt) > 0);
  assert.deepEqual(kept.steps, STEPS, 'the card stays in history, steps and all');
  const next = await carriedOn(b, ended);
  assert.equal(next.prompt, 'Log in to Claude on the computer');
  assert.match((await lastRun(b)).stdin, /pressed "I'm done" on your card/);
  // It is the owner's answer once: a second one changes nothing and starts nothing.
  const again = await answer(b, ended.id, 'later');
  assert.equal(again.status, 409);
  assert.equal(again.data.state, 'done');
  assert.equal((await srv.api(`/runs/${ended.id}`)).data.goTo.state, 'done');
  await startsNothing(b, 2);
});

test('"Not now" is kept too, and the bot carries on without the step, told it was declined', async () => {
  const b = await bot('Later Bot');
  const { ended } = await asks(b);
  const r = await answer(b, ended.id, 'later');
  assert.deepEqual([r.status, r.data.state, r.data.status, r.data.text], [200, 'later', 'started', 'Later Bot carries on without it.']);
  assert.equal((await srv.api(`/runs/${ended.id}`)).data.goTo.state, 'later');
  await carriedOn(b, ended);
  assert.match((await lastRun(b)).stdin, /The owner declined: the step you asked them to do on your screen: they pressed "Not now" on your card/);
});

test("the screen's own \"I'm done\" answers a waiting card of the run it carries on", async () => {
  const b = await bot('Screen Bot');
  const { ended } = await asks(b);
  assert.equal((await srv.api(`/bots/${b.id}/computer/done`, { method: 'POST' })).status, 200);
  assert.equal((await srv.api(`/runs/${ended.id}`)).data.goTo.state, 'done');
});

test('only the owner answers, only a card that is there, and not while the bot works', async () => {
  const b = await bot('Guarded');
  const { ended } = await asks(b);
  assert.equal((await srv.asChief(`/bots/${b.id}/computer/card`, { method: 'POST', body: { run: ended.id, answer: 'done' } })).status, 403);
  assert.equal((await answer(b, ended.id, 'maybe')).status, 400);
  assert.equal((await answer(b, 'nothing-here', 'done')).status, 404);
  const other = await bot('Other Bot');
  assert.equal((await answer(other, ended.id, 'done')).status, 404, "another bot's run is no card of this bot");
  // The bot works on something: nothing is kept, and the owner presses again later.
  srv.hold();
  await srv.api(`/bots/${b.id}/run`, { method: 'POST', body: { prompt: 'Something else' } });
  const busy = await answer(b, ended.id, 'done');
  assert.equal(busy.status, 409);
  assert.equal(busy.data.error, 'Guarded is working on it already.');
  assert.equal((await srv.api(`/runs/${ended.id}`)).data.goTo.state, 'waiting');
  srv.unhold();
});

test('the card is in the run record: it waits, and is answered, after botdot restarts', async () => {
  const b = await bot('Restarted');
  const { ended } = await asks(b);
  srv = await restartServer(srv);
  ({ lastRun, carriedOn, startsNothing } = kit(srv));
  assert.equal((await srv.api(`/runs/${ended.id}`)).data.goTo.state, 'waiting');
  assert.equal((await answer(b, ended.id, 'done')).data.state, 'done');
  assert.equal((await srv.api(`/runs/${ended.id}`)).data.goTo.state, 'done');
});
