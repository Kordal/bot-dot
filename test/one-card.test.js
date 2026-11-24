// A changed bot of the Chief's and the cards of what every bot has now (ADR 009, OK-002, ADR 268). Every bot has the web,
// files, commands and helpers, so a change that adds a tool holds nothing and no run is refused one: the join of a run
// to a changed bot's card (one card per grant) has nothing left to join, and a card of such a grant that was waiting is
// dropped when the asks are read. A proposal still binds the values it was made against
// (docs/archive/security-issue-90.md): a bot that changed since is not overwritten. Against the stand-in for Claude.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, restartServer, makeBot, writeData, withAlways } = require('./helpers');
const asksLib = require('../lib/asks');
const { heldPermissions, grantWords, staleChange } = asksLib;
const { kit } = require('./carry-on-helpers');

let srv, asksOf, answer;
before(async () => {
  srv = await startServer();
  ({ asksOf, answer } = kit(srv));
});
after(async () => { srv.unhold(); await srv.stop(); });

const WITH_WEB = { allowedTools: ['Read', 'WebSearch', 'WebFetch'] };
const kinds = async (bot) => (await asksOf(bot)).map((a) => a.kind).sort();

test('a card made before ADR 268 still says the permissions its tools give: the words of a change that holds some', () => {
  const change = (changes, before = { allowedTools: ['Read'] }) => heldPermissions({ kind: 'bot-change', changes, before });
  assert.deepEqual(change(WITH_WEB), ['web']);
  assert.deepEqual(change({ allowedTools: ['Read', 'WebSearch'] }), ['web'], 'one of its tools is enough, as its words say "web access"');
  assert.deepEqual(change({ allowedTools: ['Read', 'Bash(git log:*)', 'WebFetch'] }), ['web', 'commands'], 'a narrower rule is that permission too');
  assert.deepEqual(change({ allowedTools: ['Read', 'Bash'] }, { allowedTools: ['Read', 'Bash'] }), [], 'what the bot has already is not held');
  assert.deepEqual(change({ prompt: 'A new task' }, { prompt: 'The task' }), []);
  assert.deepEqual(heldPermissions({ kind: 'permission', permission: 'web' }), [], 'only a changed bot holds any');
  // A run that waited is told what the change gave: a permission given in part with the rules themselves.
  const grant = (allowedTools) => grantWords({ kind: 'bot-change', changes: { allowedTools }, before: { allowedTools: ['Read'] } });
  assert.deepEqual(grant(['Read', 'WebSearch', 'WebFetch', 'Bash']), ['browse the web', 'run commands']);
  assert.deepEqual(grant(['Read', 'WebFetch', 'Bash(git log:*)']), ['browse the web (only WebFetch)', 'run commands (only Bash(git log:*))']);
  // A change is stale once a field it changes is no longer as it was; a field it leaves alone does not count.
  const web = { kind: 'bot-change', changes: WITH_WEB, before: { allowedTools: ['Read'] } };
  assert.equal(staleChange(web, { allowedTools: ['Read'], prompt: 'Anything' }), false);
  assert.equal(staleChange(web, { allowedTools: ['Read', 'Edit'] }), true);
  assert.equal(staleChange(web, null), false, 'nothing is known of a bot that is not at hand');
});

test('a proposal still binds what it was made against: a bot the owner changed since answers 409, and the card stays', async () => {
  const bot = await makeBot(srv, { name: 'Writer', allowedTools: ['Read'], prompt: 'Write the notes.' });
  const change = await srv.asChief(`/bots/${bot.id}`, { method: 'PUT', body: { prompt: 'Write the notes and look things up.' } });
  await srv.api(`/bots/${bot.id}`, { method: 'PUT', body: { prompt: 'Write the notes, briefly.' } });
  const stale = await answer({ id: change.data.pendingChange }, true);
  assert.deepEqual([stale.status, stale.data.error], [409, 'The bot changed since this proposal. Decline it and ask for a fresh proposal.']);
  const now = (await srv.api(`/bots/${bot.id}`)).data;
  assert.deepEqual([now.prompt, now.allowedTools], ['Write the notes, briefly.', withAlways('Read')], 'nothing of it was applied');
  assert.deepEqual(await kinds(bot), ['bot-change'], 'the card stays, to be declined');
  // So does a proposal whose rules the owner changed themselves.
  const rules = await srv.asChief(`/bots/${bot.id}`, { method: 'PUT', body: { systemPrompt: 'Never delete mail.' } });
  await srv.api(`/bots/${bot.id}`, { method: 'PUT', body: { systemPrompt: 'Never delete anything.' } });
  assert.equal((await answer({ id: rules.data.pendingChange }, true)).status, 409);
  assert.equal((await srv.api(`/bots/${bot.id}`)).data.systemPrompt, 'Never delete anything.');
});

test('a Chief change that adds Bash, the web or helpers holds nothing: it is saved at once, with no card', async () => {
  const bot = await makeBot(srv, { name: 'Runner', allowedTools: ['Read'] });
  const saved = await srv.asChief(`/bots/${bot.id}`, { method: 'PUT', body: { allowedTools: ['Read', 'Bash(git log:*)', 'WebFetch', 'Agent'] } });
  assert.equal(saved.status, 200);
  assert.deepEqual([saved.data.pendingChange, saved.data.waiting], [undefined, undefined]);
  assert.deepEqual([...saved.data.allowedTools].sort(), [...new Set([...withAlways('Read', 'Bash(git log:*)', 'WebFetch', 'Agent')])].sort(), 'the tools it sent, and the ones every bot has');
  assert.deepEqual(await kinds(bot), []);
});

test('a card of what every bot has, waiting from before, is dropped when the asks are read', async () => {
  const bot = await makeBot(srv, { name: 'Old Timer', allowedTools: ['Read'] });
  const at = new Date().toISOString();
  srv = await restartServer(srv, (data) => {
    writeData(path.join(data, 'asks.json'), [
      { id: 'old-cmd', kind: 'permission', botId: bot.id, permission: 'commands', reason: 'To list them', at },
      { id: 'old-help', kind: 'permission', botId: bot.id, permission: 'helpers', reason: 'To split it', at },
      { id: 'old-tools', kind: 'bot-change', botId: bot.id, by: 'chief', changes: { allowedTools: ['Read', 'Bash', 'WebFetch'] }, before: { allowedTools: ['Read'] }, reason: '', at },
      { id: 'old-rules', kind: 'bot-change', botId: bot.id, by: 'chief', changes: { systemPrompt: 'Never delete mail.', allowedTools: ['Read', 'Bash'] }, before: { systemPrompt: '', allowedTools: ['Read'] }, reason: '', at },
    ]);
  });
  ({ asksOf, answer } = kit(srv));
  assert.deepEqual((await asksOf(bot)).map((a) => a.id), ['old-rules'], 'a change that also holds something else stays');
  assert.equal((await srv.api('/asks/old-cmd', { method: 'POST', body: { yes: true } })).status, 404, 'nothing to answer');
});

test('an old card of commands that held a run: the run carries on once at start, and the card is gone', async () => {
  const bot = await makeBot(srv, { name: 'Waiter', allowedTools: ['Read'] });
  const first = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'List the files' } });
  const stopped = await srv.finished(first.data.id);
  const at = new Date().toISOString();
  const card = { id: 'old-held', kind: 'permission', botId: bot.id, permission: 'commands', reason: 'To list them', at, runs: [{ id: stopped.id, at }] };
  srv = await restartServer(srv, (data) => writeData(path.join(data, 'asks.json'), [card]));
  ({ asksOf, answer } = kit(srv));
  const { carriedOn, runsOf } = kit(srv);
  const next = await carriedOn(bot, stopped);
  assert.equal(next.continues, stopped.id, 'its yes was as good as given: the run it held carries on');
  assert.deepEqual(await asksOf(bot), [], 'the card is gone');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(srv.data, 'asks.json'), 'utf8')), [], 'and gone from the file');
  const n = (await runsOf(bot)).length;
  srv = await restartServer(srv);
  ({ asksOf, answer } = kit(srv));
  await kit(srv).startsNothing(bot, n);
});
