// A changed bot of the Chief's and the cards of what every bot has now (ADR 009, OK-002, ADR 268). Every bot has the web,
// files, commands and helpers, so a change that adds a tool holds nothing and no run is refused one: the join of a run
// to a changed bot's card (one card per grant) has nothing left to join, and a card of such a grant that was waiting is
// answered yes when botdot starts, and the work it held carries on once. A proposal still binds the values it was made against
// (docs/archive/security-issue-90.md): a bot that changed since is not overwritten. Against the stand-in for Claude.
const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, restartServer, makeBot, writeData, withAlways, sleep } = require('./helpers');
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

// lib/asks.js settleGiven: a card of what every bot has, waiting in asks.json from before ADR 268, is answered yes at the first start.
describe('settleGiven: old commands/helpers cards at the first start (ADR 268)', () => {
  test('a card of what every bot has, waiting from before, is gone from the list of asks', async () => {
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

  test('an old card older than a week is removed at start and carries nothing on', async () => {
    const bot = await makeBot(srv, { name: 'Stale Waiter', allowedTools: ['Read'] });
    const first = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'List the files' } });
    const stopped = await srv.finished(first.data.id);
    const at = new Date(Date.now() - (asksLib.CARRY_HOURS + 1) * 3600e3).toISOString();
    const card = { id: 'old-stale', kind: 'permission', botId: bot.id, permission: 'commands', reason: 'To list them', at, runs: [{ id: stopped.id, at }] };
    srv = await restartServer(srv, (data) => writeData(path.join(data, 'asks.json'), [card]));
    ({ asksOf, answer } = kit(srv));
    const { runsOf, startsNothing } = kit(srv);
    const n = (await runsOf(bot)).length;
    assert.deepEqual(await asksOf(bot), [], 'the card is gone');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(srv.data, 'asks.json'), 'utf8')), [], 'and gone from the file');
    await startsNothing(bot, n);
  });

  test("an old card from a Chief chat starts the Chief's turn once at start, and the card is gone", async () => {
    const bot = await makeBot(srv, { name: 'Chief Waiter', emoji: '🧭', allowedTools: ['Read'] });
    const run = (await srv.asChief(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'List the files' } })).data;
    const stopped = await srv.finished(run.id);
    // The Chief chat whose reply started the run (as its run_bot action records).
    const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
    const file = path.join(srv.data, 'chief', `${chat.id}.json`);
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    saved.title = 'List the files';
    const sent = new Date(Date.now() - 60e3).toISOString();
    saved.messages.push({ role: 'user', text: 'List the files', at: sent },
      { role: 'chief', text: 'Started it.', at: sent, actions: [{ kind: 'run', text: 'Started Chief Waiter', botId: bot.id, runId: stopped.id }] });
    writeData(file, saved);
    const at = new Date().toISOString();
    const card = { id: 'old-chief', kind: 'permission', botId: bot.id, permission: 'commands', reason: 'To list them', at, chatId: chat.id, runs: [{ id: stopped.id, at }] };
    srv = await restartServer(srv, (data) => writeData(path.join(data, 'asks.json'), [card]));
    ({ asksOf, answer } = kit(srv));
    const { runsOf } = kit(srv);
    const turn = await srv.nextRun((x) => x.botdot && x.botdot.env.CHIEF_CHAT_ID === chat.id && x.stdin.includes('Chief Waiter can run commands now'), "the Chief's turn");
    assert.match(turn.stdin, new RegExp(`Run ${stopped.id} of Chief Waiter, which you started, stopped without it`), 'it is told of the run that waited');
    assert.deepEqual(await asksOf(bot), [], 'the card is gone');
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(srv.data, 'asks.json'), 'utf8')), [], 'and gone from the file');
    await sleep(60);
    assert.equal(srv.runs().filter((x) => x.botdot && x.botdot.env.CHIEF_CHAT_ID === chat.id && x.stdin.includes('Chief Waiter can run commands now')).length, 1, "the Chief's turn started exactly once");
    assert.equal((await runsOf(bot)).length, 1, 'and the bot is not started by botdot: the Chief starts it again');
    // Another start does not run it a second time.
    srv = await restartServer(srv);
    ({ asksOf, answer } = kit(srv));
    await sleep(100);
    assert.equal(srv.runs().filter((x) => x.botdot && x.botdot.env.CHIEF_CHAT_ID === chat.id && x.stdin.includes('Chief Waiter can run commands now')).length, 1, 'the next start finds no card: still the one turn');
  });

  // A Chief chat whose reply started `stopped`, a run of `bot` (as its run_bot action records).
  async function chiefChatOf(bot, stopped) {
    const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
    const file = path.join(srv.data, 'chief', `${chat.id}.json`);
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    saved.title = 'List the files';
    const sent = new Date(Date.now() - 60e3).toISOString();
    saved.messages.push({ role: 'user', text: 'List the files', at: sent },
      { role: 'chief', text: 'Started it.', at: sent, actions: [{ kind: 'run', text: `Started ${bot.name}`, botId: bot.id, runId: stopped.id }] });
    writeData(file, saved);
    return chat;
  }
  const fileAsks = () => JSON.parse(fs.readFileSync(path.join(srv.data, 'asks.json'), 'utf8'));
  const turnsOf = (chat, stopped) => srv.runs().filter((x) => x.botdot && x.botdot.env.CHIEF_CHAT_ID === chat.id && x.stdin.includes(`Run ${stopped.id} of`));

  test('a change of the Chief that only adds Bash (no permission card) starts the Chief\'s turn once at start, and the card is gone', async () => {
    const bot = await makeBot(srv, { name: 'Bash Waiter', emoji: '🧭', allowedTools: ['Read'] });
    const run = (await srv.asChief(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'List the files' } })).data;
    const stopped = await srv.finished(run.id);
    const chat = await chiefChatOf(bot, stopped);
    const at = new Date().toISOString();
    const card = { id: 'old-bash', kind: 'bot-change', botId: bot.id, by: 'chief', changes: { allowedTools: ['Read', 'Bash'] }, before: { allowedTools: ['Read'] }, reason: 'To list them', at, chatId: chat.id, runs: [{ id: stopped.id, at }] };
    srv = await restartServer(srv, (data) => writeData(path.join(data, 'asks.json'), [card]));
    ({ asksOf, answer } = kit(srv));
    const turn = await srv.nextRun((x) => x.botdot && x.botdot.env.CHIEF_CHAT_ID === chat.id && x.stdin.includes(`Run ${stopped.id} of`), "the Chief's turn");
    assert.match(turn.stdin, new RegExp(`Run ${stopped.id} of Bash Waiter, which you started, stopped without it`));
    assert.deepEqual(await asksOf(bot), [], 'the card is gone');
    assert.deepEqual(fileAsks(), [], 'and gone from the file');
    await sleep(60);
    assert.equal(turnsOf(chat, stopped).length, 1, "the Chief's turn started exactly once");
  });

  test('a rule narrower than a tool every bot has is as good as given; any other tool keeps its card', async () => {
    const bot = await makeBot(srv, { name: 'Narrow', allowedTools: ['Read'] });
    const at = new Date().toISOString();
    const change = (id, added) => ({ id, kind: 'bot-change', botId: bot.id, by: 'chief', changes: { allowedTools: ['Read', ...added] }, before: { allowedTools: ['Read'] }, reason: '', at });
    srv = await restartServer(srv, (data) => writeData(path.join(data, 'asks.json'), [
      change('narrow-bash', ['Bash(git log:*)']),
      change('narrow-both', ['Bash(git log:*)', 'WebFetch']),
      change('other-tool', ['mcp__x']),
      change('mixed', ['Bash', 'mcp__x']),
    ]));
    ({ asksOf, answer } = kit(srv));
    assert.deepEqual((await asksOf(bot)).map((a) => a.id).sort(), ['mixed', 'other-tool'], 'one tool that is not every bot\'s keeps the whole card');
    assert.deepEqual(fileAsks().map((a) => a.id).sort(), ['mixed', 'other-tool'], 'and the file holds exactly those');
  });

  test('a mix in asks.json at the first start: what waited carries on once, what must stay stays, and nothing runs again at the next start', async () => {
    const waiter = await makeBot(srv, { name: 'Mix Waiter', allowedTools: ['Read'] });
    const stale = await makeBot(srv, { name: 'Mix Stale', allowedTools: ['Read'] });
    const idle = await makeBot(srv, { name: 'Mix Idle', allowedTools: ['Read'] });
    const waiterStopped = await srv.finished((await srv.api(`/bots/${waiter.id}/run`, { method: 'POST', body: { prompt: 'List the files' } })).data.id);
    const staleStopped = await srv.finished((await srv.api(`/bots/${stale.id}/run`, { method: 'POST', body: { prompt: 'List the files' } })).data.id);
    const at = new Date().toISOString();
    const old = new Date(Date.now() - (asksLib.CARRY_HOURS + 1) * 3600e3).toISOString();
    const stays = { id: 'stays-mcp', kind: 'bot-change', botId: idle.id, by: 'chief', changes: { allowedTools: ['Read', 'mcp__x'] }, before: { allowedTools: ['Read'] }, reason: '', at };
    srv = await restartServer(srv, (data) => writeData(path.join(data, 'asks.json'), [
      { id: 'mix-cmd', kind: 'permission', botId: waiter.id, permission: 'commands', reason: 'To list them', at, runs: [{ id: waiterStopped.id, at }] },
      { id: 'mix-help', kind: 'permission', botId: idle.id, permission: 'helpers', reason: 'To split it', at },
      { id: 'mix-old', kind: 'permission', botId: stale.id, permission: 'commands', reason: 'To list them', at: old, runs: [{ id: staleStopped.id, at: old }] },
      stays,
    ]));
    ({ asksOf, answer } = kit(srv));
    const { carriedOn, runsOf } = kit(srv);
    assert.equal((await carriedOn(waiter, waiterStopped)).continues, waiterStopped.id, 'the run that waited carries on');
    assert.deepEqual(fileAsks(), [stays], 'the file holds exactly the card that must stay, as it was');
    assert.deepEqual((await asksOf(idle)).map((a) => a.id), ['stays-mcp']);
    assert.deepEqual([(await asksOf(waiter)).length, (await asksOf(stale)).length], [0, 0]);
    const counts = [(await runsOf(waiter)).length, (await runsOf(stale)).length, (await runsOf(idle)).length];
    assert.deepEqual(counts, [2, 1, 0], 'one run carried on; the card of a week ago and the helpers card started none');
    srv = await restartServer(srv);
    ({ asksOf, answer } = kit(srv));
    await kit(srv).startsNothing(waiter, 2);
    assert.deepEqual(fileAsks(), [stays], 'the next start finds the same file');
  });
});
