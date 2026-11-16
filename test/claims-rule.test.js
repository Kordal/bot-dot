// What a bot or the Chief may tell the owner as fact: only what it checked at the source. A claim from another bot, a
// note, a past run or a file is a report: checked first, or passed on with who said it and when; a test mode's data is
// never given as live; an owner's "you are wrong" is checked again, not defended. A test shows what they are told;
// that a model follows it is seen in use.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { CLAIMS_RULE } = require('../lib/prompt-text');
const { startServer, makeBot, waitFor } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.stop());

const once = (text) => text.split(CLAIMS_RULE).length - 1;

test('the rule says what counts as fact, who and when for the rest, the mode of an app, and to check again when told it is wrong', () => {
  assert.match(CLAIMS_RULE, /only what you checked yourself, at its source/);
  assert.match(CLAIMS_RULE, /another bot, a note, a past run or a file says is a report, not a fact/);
  assert.match(CLAIMS_RULE, /say who said it and when/);
  assert.match(CLAIMS_RULE, /test mode and a live mode \(Stripe/);
  assert.match(CLAIMS_RULE, /always says which mode you read it in/);
  assert.match(CLAIMS_RULE, /says you are wrong, check again at the source before you answer/);
  assert.doesNotMatch(CLAIMS_RULE, /[<>]/, 'no markup in a rule');
});

test("a bot's run is told the rule once, before its own instructions and the run's task", async () => {
  const bot = await makeBot(srv, { name: 'Claim Checker', emoji: '🔎', systemPrompt: 'OWN-RULES' });
  srv.reply('Fine.');
  const r = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'What are the prices?' } });
  const rec = await srv.nextRun((x) => x.args.includes(`${bot.emoji} ${bot.name}`), `a run of ${bot.name}`);
  await srv.finished(r.data.id);
  assert.equal(once(rec.system), 1);
  assert.ok(rec.system.indexOf(CLAIMS_RULE) < rec.system.indexOf('OWN-RULES'), 'it is botdot\'s rule, ahead of the bot\'s own');
  assert.ok(rec.system.indexOf(CLAIMS_RULE) < rec.system.indexOf('The owner has sent you a message.'), 'and ahead of the run');
});

test("the memory review's words, which no person reads, go without it", async () => {
  const bot = await makeBot(srv, { name: 'Review Subject', emoji: '📝' });
  srv.reply('Nothing to change.');
  const r = (await srv.api(`/memory/review/${bot.id}`, { method: 'POST' })).data.run;
  const rec = await srv.nextRun((x) => x.args.includes(`${bot.emoji} ${bot.name}`), 'the memory review');
  await srv.finished(r.id);
  assert.equal(once(rec.system), 0);
});

test("the Chief's standing instructions hold the rule once", async () => {
  srv.reply('Done.');
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Hello' } });
  const { system } = await srv.nextRun((r) => !!r.botdot);
  await waitFor(async () => !(await srv.api(`/chief/chats/${chat.id}`)).data.busy, { what: 'the Chief to reply' });
  assert.equal(once(system), 1);
});
