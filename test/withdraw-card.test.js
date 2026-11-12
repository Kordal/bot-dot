// A bot withdraws a card it no longer needs (withdraw_card, ADR 228): the owner changed plans and the card must not
// stay in Needs you, nor its run go on waiting for it. Its prompt names each card of its own with the id to give.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot, heldRun, self } = require('./helpers');
const loginRequests = require('../lib/login-requests');

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.stop());

async function run(bot, prompt) {
  const h = await heldRun(srv, bot, prompt);
  return { ...h, done: async () => { srv.release(h.rec); await srv.finished(h.run.id); srv.unhold(); } };
}
const withdraw = (token, id) => self(srv, token, 'withdraw-card', { id });

test('a login request of a run that ended is named with its id in the next run, which withdraws it', async () => {
  const bot = await makeBot(srv, { name: 'Billing Builder', emoji: '💳', allowedTools: ['Read'] });
  const first = await run(bot, 'Make the live payment links');
  const asked = await srv.api('/vault/session/request', { method: 'POST', headers: { 'X-Vault-Token': first.rec.vault.env.VAULT_TOKEN }, body: { site: 'api.stripe.com', type: 'api-token', reason: 'The live key' } });
  assert.equal(asked.data.ok, true, JSON.stringify(asked.data));
  await first.done();
  assert.equal((await srv.api('/vault/requests')).data.length, 1, 'it stays in Needs you after its run (ADR 189)');

  const second = await run(bot, "Change of plans, we won't need it");
  assert.match(second.rec.system, new RegExp(`your login for api\\.stripe\\.com \\[card ${asked.data.id}\\]`));
  assert.match(second.rec.system, /withdraw it with withdraw_card and the id after it/);
  const out = await withdraw(second.token, `[card ${asked.data.id}]`);
  assert.equal(out.data.ok, true, JSON.stringify(out.data));
  assert.match(out.data.text, /^Withdrawn: the login request for api\.stripe\.com/);
  assert.deepEqual((await srv.api('/vault/requests')).data, [], 'gone from Needs you');
  const again = await withdraw(second.token, asked.data.id);
  assert.equal(again.data.ok, false);
  assert.match(again.data.error, /Nothing to withdraw/);
  await second.done();

  const third = await run(bot, 'And now?');
  assert.match(third.rec.system, /Nothing of yours waits in Needs you right now/);
  await third.done();
});

test("an ask card goes unanswered, and another bot's card is not one to withdraw", async () => {
  const bot = await makeBot(srv, { name: 'Video Maker', emoji: '🎬', allowedTools: ['Read'] });
  const other = await makeBot(srv, { name: 'Stranger', emoji: '🕵️', allowedTools: ['Read'] });
  const first = await run(bot, 'Make the video');
  assert.equal((await self(srv, first.token, 'ask', { kind: 'permission', permission: 'commands', reason: 'To render' })).data.ok, true);
  const [card] = (await srv.api('/asks')).data.filter((a) => a.botId === bot.id);
  await first.done();

  const theirs = await run(other, 'Tidy up');
  const no = await withdraw(theirs.token, card.id);
  assert.equal(no.data.ok, false, 'not its card, nor a teammate\'s');
  await theirs.done();
  assert.equal((await srv.api('/asks')).data.filter((a) => a.botId === bot.id).length, 1);

  const second = await run(bot, 'Forget the video');
  assert.match(second.rec.system, new RegExp(`your OK to run commands \\[card ${card.id}\\]`));
  assert.equal((await withdraw(second.token, card.id)).data.ok, true);
  assert.equal((await srv.api('/asks')).data.filter((a) => a.botId === bot.id).length, 0);
  await second.done();
});

test('a run that waits for a withdrawn login request is told so, and nothing carries on', async () => {
  const later = [];
  loginRequests.onLater((r) => later.push(r.id));
  const r = loginRequests.create({ botId: 'b9', runId: 'r9', site: 'api.stripe.com', name: 'Stripe', from: 'bot' });
  const waiting = loginRequests.wait(r.id, 5_000);
  assert.equal(loginRequests.withdraw(r.id).status, 'withdrawn');
  assert.equal((await waiting).status, 'withdrawn');
  assert.equal(loginRequests.waitsFor('r9'), false);
  assert.equal(loginRequests.withdraw(r.id), null, 'once');
  assert.deepEqual(later, []);
});

test('a wait ends early, still pending, when early() says the owner wrote to the run', async () => {
  const r = loginRequests.create({ botId: 'b8', runId: 'r8', site: 'shop.example', name: 'Shop', from: 'bot' });
  let wrote = false;
  setTimeout(() => { wrote = true; }, 200);
  const t = Date.now();
  const got = await loginRequests.wait(r.id, 10_000, () => wrote);
  assert.equal(got.status, 'pending');
  assert.ok(Date.now() - t < 3_000, 'within about a second of the message');
  loginRequests.settle(r.id, 'expired');
});
