// "I'm done" on a bot's screen (ADR 225): the owner hands the screen back after a sign-in the bot asked them for, and
// the bot's last run carries on, told so. Against the stand-in for Claude.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot } = require('./helpers');
const { kit } = require('./carry-on-helpers');

let srv, lastRun, carriedOn, startsNothing, runsOf;
before(async () => { srv = await startServer(); ({ lastRun, carriedOn, startsNothing, runsOf } = kit(srv)); });
after(async () => { srv.unhold(); await srv.stop(); });

const done = (bot, opts) => srv.api(`/bots/${bot.id}/computer/done`, { method: 'POST', ...opts });

test("I'm done carries the bot's last run on, told the owner handed its screen back", async () => {
  assert.ok((await srv.api('/version')).data.features.includes('screen-done'));
  const bot = await makeBot(srv, { name: 'Form Maker', emoji: '🧪', computer: 'linux' });
  srv.reply('The Brevo sign-in waits on my screen: press I\'m done once you are signed in.');
  const first = await srv.finished((await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Make the waitlist form in Brevo' } })).data.id);
  const project = (await srv.api('/company', { method: 'POST', body: { empty: true, name: 'Waitlist forms' } })).data;
  await srv.api(`/company?project=${project.id}`, { method: 'PATCH', body: { lead: bot.id } });
  assert.equal((await srv.api(`/company/updates/now?project=${project.id}`, { method: 'POST', body: { key: 'screen-waits-update' } })).status, 200);
  const r = await done(bot);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual([r.data.ok, r.data.status, r.data.text], [true, 'started', 'Form Maker carries on.']);
  const next = await carriedOn(bot, first);
  assert.equal(next.prompt, 'Make the waitlist form in Brevo');
  assert.match((await lastRun(bot)).stdin, /handed it back to you with "I'm done"/);
  await startsNothing(bot, 3);
});

test("I'm done is the owner's alone, and says so when there is nothing to carry on", async () => {
  const bot = await makeBot(srv, { name: 'Idle', emoji: '🧪', computer: 'linux' });
  assert.equal((await srv.asChief(`/bots/${bot.id}/computer/done`, { method: 'POST' })).status, 403);
  const none = await done(bot);
  assert.equal(none.status, 409);
  assert.equal(none.data.error, 'Idle has nothing to carry on. Write to it in its chat.');
  assert.deepEqual(await runsOf(bot), []);
});
