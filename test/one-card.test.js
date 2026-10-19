// One card per grant (ADR 009, OK-002): while a changed bot that gives a permission waits, a run that lacks that
// permission joins its card, and a changed bot takes over the permission's own card. A yes on the one card
// carries the run on and tells the Chief. A proposal still binds the values it was made against
// (docs/archive/security-issue-90.md): a bot that changed since is not overwritten. Against the stand-in for Claude.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, heldRun, self, waitFor } = require('./helpers');
const { heldPermissions, grantWords, staleChange } = require('../lib/asks');
const { kit, BASH, WEB, isRunOf } = require('./carry-on-helpers');

let srv, asksOf, runsOf, answer, refuse, refused, carriedOn, startsNothing;
before(async () => {
  srv = await startServer();
  ({ asksOf, runsOf, answer, refuse, refused, carriedOn, startsNothing } = kit(srv));
});
after(async () => { srv.unhold(); await srv.stop(); });

const quiet = (chat) => waitFor(async () => { const c = (await srv.api(`/chief/chats/${chat.id}`)).data; return c.busy ? null : c; }, { what: 'the Chief to finish' });
async function chatAbout(text) {
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text } });
  return quiet(chat);
}
const from = (chat, opts = {}) => ({ ...opts, headers: { 'X-Chief-Chat': chat.id } });
// The Chief's turns after the owner's yes; not the turn it gets when a run it started has ended (BUSY-002).
const told = (re) => srv.runs().filter((r) => r.botdot && /^botdot writes this, not the user: nobody typed it\. The user said yes on /m.test(r.stdin) && re.test(r.stdin));
const CARRIES = { who: 'chief', text: 'the Chief carries on' };
const WITH_WEB = { allowedTools: ['Read', 'WebSearch', 'WebFetch'] };
const kinds = async (bot) => (await asksOf(bot)).map((a) => a.kind).sort();

test('the permissions a changed bot holds are those of the tools it adds', () => {
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

test('a refused tool while a changed bot for that permission waits: no second card, and one yes carries the run on and tells the Chief', async () => {
  const chat = await chatAbout('Give News Watcher the web');
  const bot = await makeBot(srv, { name: 'News Watcher', emoji: '📰', allowedTools: ['Read'] });
  const change = await srv.asChief(`/bots/${bot.id}`, from(chat, { method: 'PUT', body: WITH_WEB }));
  // The owner asks the bot meanwhile, and it is refused the web.
  const stopped = await refused(bot, [WEB], { prompt: 'What is the headline?' });
  const cards = await asksOf(bot);
  assert.deepEqual(cards.map((a) => [a.id, a.kind, a.title]), [[change.data.pendingChange, 'bot-change', 'Let News Watcher browse the web?']], 'one card');
  assert.deepEqual(cards[0].then.who, 'chief', 'it says the Chief carries on; the run is carried on as well');

  // Another permission is another grant: its own card.
  await refused(bot, [BASH], { prompt: 'And the open pull requests?' });
  assert.deepEqual(await kinds(bot), ['bot-change', 'permission']);
  await answer((await asksOf(bot)).find((a) => a.kind === 'permission'), false);

  // The owner sent the bot a second request after the first asked: that first request does not carry on (A10).
  // So a bot of its own for the run that does.
  const lone = await makeBot(srv, { name: 'Page Reader', emoji: '📖', allowedTools: ['Read'] });
  const wait = await srv.asChief(`/bots/${lone.id}`, from(chat, { method: 'PUT', body: WITH_WEB }));
  const asked = await refused(lone, [WEB], { prompt: 'Read the status page' });
  srv.reply('All systems are up.');
  const yes = await answer({ id: wait.data.pendingChange }, true);
  assert.deepEqual([yes.status, yes.data.carriesOn], [200, CARRIES], "no \"The bot changed since this proposal\", and the Chief's turn is named first");
  const next = await carriedOn(lone, asked);
  assert.deepEqual([next.continues, next.result], [asked.id, 'All systems are up.']);
  const rec = srv.runs().filter(isRunOf(lone)).at(-1);
  assert.match(rec.stdin, /The owner allowed you to: browse the web\./);
  assert.ok(rec.stdin.includes('<request>\nRead the status page\n</request>'));
  const turn = await waitFor(() => told(/Page Reader/)[0], { what: "the Chief's turn" });
  assert.ok(turn.stdin.includes(`botdot itself starts Page Reader again on the work that stopped without it (its run ${asked.id}), now or as soon as it is free: don't start it for that.`));
  await quiet(chat);
  assert.deepEqual(await asksOf(lone), []);

  const both = await answer({ id: change.data.pendingChange }, true);
  assert.deepEqual([both.status, both.data.carriesOn], [200, CARRIES]);
  await waitFor(() => told(/News Watcher/)[0], { what: "the Chief's turn" });
  await quiet(chat);
  await startsNothing(bot, 2);
  assert.ok(!told(/News Watcher/)[0].stdin.includes(stopped.id), 'the Chief is told of no run');
});

test('ask_permission while a changed bot for that permission waits joins its card, also after a no to the permission', async () => {
  const bot = await makeBot(srv, { name: 'Coder', emoji: '🛠', allowedTools: ['Read'] });
  // The owner said no to commands this week; then the Chief proposes them (from no chat: an older tools server).
  await refused(bot, [BASH], { prompt: 'List the pull requests' });
  await srv.nextRun(isRunOf(bot), 'that run'); // looked at: the run held below is the next one
  await answer((await asksOf(bot))[0], false);
  const change = await srv.asChief(`/bots/${bot.id}`, { method: 'PUT', body: { allowedTools: ['Read', 'Bash'] } });
  const h = await heldRun(srv, bot, 'Check the build');
  assert.deepEqual((await self(srv, h.token, 'ask', { kind: 'permission', permission: 'commands', reason: 'To run the build' })).data, { ok: true });
  assert.equal((await self(srv, h.token, 'ask', { kind: 'permission', permission: 'web', reason: 'To read the docs' })).data.ok, true);
  assert.deepEqual(await kinds(bot), ['bot-change', 'permission'], 'commands joined the change; the web is another grant');
  srv.unhold(); srv.release(h.rec);
  await srv.finished(h.run.id);
  const card = (await asksOf(bot)).find((a) => a.id === change.data.pendingChange);
  assert.deepEqual(card.then, { who: 'bot', text: 'It carries on with “Check the build” when you allow it.' });
  // The run waits for two answers: it carries on with the last, told both.
  assert.ok(!('carriesOn' in (await answer(card, true)).data));
  assert.deepEqual((await answer((await asksOf(bot))[0], false)).data, { ok: true, declined: true });
  await carriedOn(bot, h.run);
  const rec = srv.runs().filter(isRunOf(bot)).at(-1);
  assert.match(rec.stdin, /The owner allowed you to: run commands\./);
  assert.match(rec.stdin, /The owner declined: browse the web\./);
});

test('a changed bot takes over the card of a permission that waits: its runs move, and the card of the permission goes', async () => {
  const chat = await chatAbout('Give Fleet Doctor commands');
  const bot = await makeBot(srv, { name: 'Fleet Doctor', emoji: '🩺', allowedTools: ['Read'] });
  const stopped = await refused(bot, [BASH], { prompt: 'Check why the backup failed' });
  const [first] = await asksOf(bot);
  assert.deepEqual([first.kind, first.then.who], ['permission', 'bot']);
  const change = await srv.asChief(`/bots/${bot.id}`, from(chat, { method: 'PUT', body: { allowedTools: ['Read', 'Bash'], systemPrompt: 'Never restart a server.' } }));
  const cards = await asksOf(bot);
  assert.deepEqual(cards.map((a) => [a.id, a.kind, a.title]), [[change.data.pendingChange, 'bot-change', 'Change Fleet Doctor: commands and new rules?']]);
  assert.deepEqual(cards[0].parts, [{ label: 'Rules', was: '', now: 'Never restart a server.' }, { label: 'What it may do', now: 'run commands' }]);

  srv.reply('The disk was full.');
  const yes = await answer(cards[0], true);
  assert.deepEqual([yes.status, yes.data.carriesOn], [200, CARRIES]);
  assert.deepEqual([yes.data.bot.allowedTools, yes.data.bot.systemPrompt], [['Read', 'Bash'], 'Never restart a server.']);
  const next = await carriedOn(bot, stopped);
  assert.equal(next.result, 'The disk was full.');
  await waitFor(() => told(/Fleet Doctor/)[0], { what: "the Chief's turn" });
  await quiet(chat);
  // The permission was not declined: nothing remembers a no.
  await refused(bot, [WEB], { prompt: 'And the status page?' });
  assert.deepEqual(await kinds(bot), ['permission']);
});

test('a run the Chief started that joins its changed bot is started again by the one turn, not by a second', async () => {
  const chat = await chatAbout('Make Scout, give it the web and start it');
  const bot = await makeBot(srv, { name: 'Scout', emoji: '🔭', allowedTools: ['Read'] });
  const change = await srv.asChief(`/bots/${bot.id}`, from(chat, { method: 'PUT', body: WITH_WEB }));
  // The chat's reply started that run (as its run_bot action records), before the run ended refused the web.
  srv.hold();
  const run = (await srv.asChief(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Look around' } })).data;
  const rec = await srv.nextRun((x) => x.args.includes(`${bot.emoji} ${bot.name}`), 'Scout to start');
  const file = path.join(srv.data, 'chief', `${chat.id}.json`);
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  saved.messages.at(-1).actions = [{ kind: 'run', text: 'Started Scout', botId: bot.id, runId: run.id }];
  fs.writeFileSync(file, JSON.stringify(saved));
  refuse([WEB]);
  srv.unhold();
  srv.release(rec);
  const stopped = await srv.finished(run.id);
  refuse([]);
  // The Chief is told how the run ended, in a turn of its own in that chat (BUSY-002), before the owner answers.
  await srv.nextRun((x) => !!x.botdot && x.stdin.includes(`has ended its run ${run.id}.`), "the Chief's turn about the run");
  await quiet(chat);

  assert.deepEqual((await answer({ id: change.data.pendingChange }, true)).data.carriesOn, CARRIES);
  const [turn] = await waitFor(() => (told(/Scout/).length ? told(/Scout/) : null), { what: "the Chief's turn" });
  assert.ok(turn.stdin.includes(`Run ${stopped.id} of Scout, which you started, stopped without it: start Scout again on that work with run_bot.`));
  await quiet(chat);
  assert.equal(told(/Scout/).length, 1, 'one turn');
  await startsNothing(bot, 1);
});

test('a changed bot whose bot changed since holds nothing: the permission gets its own card, and the stale card promises nothing', async () => {
  const chat = await chatAbout('Give Librarian the web');
  const bot = await makeBot(srv, { name: 'Librarian', allowedTools: ['Read'] });
  const change = await srv.asChief(`/bots/${bot.id}`, from(chat, { method: 'PUT', body: WITH_WEB }));
  // Another permission is allowed first, on its own card: the Chief's proposal no longer fits the bot.
  const first = await refused(bot, [{ tool_name: 'Edit', tool_use_id: 't3', tool_input: { file_path: 'notes.md' } }], { prompt: 'Write it down' });
  assert.equal((await answer((await asksOf(bot)).find((a) => a.kind === 'permission'), true)).status, 200);
  await carriedOn(bot, first); // it has ended before the next request: a bot still at work carries on "when it is free"
  const stale = (await asksOf(bot)).find((a) => a.id === change.data.pendingChange);
  assert.equal(stale.then, undefined, 'its yes would be refused: it says nothing of what follows');
  // A run that is refused the web now does not wait for that card: the web gets a card that can be allowed.
  const stopped = await refused(bot, [WEB], { prompt: 'Look it up' });
  assert.deepEqual(await kinds(bot), ['bot-change', 'permission']);
  assert.equal((await answer(stale, true)).status, 409);
  const yes = await answer((await asksOf(bot)).find((a) => a.kind === 'permission'), true);
  assert.deepEqual([yes.status, yes.data.carriesOn], [200, { who: 'bot', text: 'it carries on' }]);
  await carriedOn(bot, stopped);
  assert.deepEqual((await answer(stale, false)).data, { ok: true, declined: true });
  await quiet(chat);
});

test('a proposal still binds what it was made against: a bot the owner changed since answers 409, and the card stays', async () => {
  const bot = await makeBot(srv, { name: 'Writer', allowedTools: ['Read'], prompt: 'Write the notes.' });
  const change = await srv.asChief(`/bots/${bot.id}`, { method: 'PUT', body: { ...WITH_WEB, prompt: 'Write the notes and look things up.' } });
  await srv.api(`/bots/${bot.id}`, { method: 'PUT', body: { prompt: 'Write the notes, briefly.' } });
  const stale = await answer({ id: change.data.pendingChange }, true);
  assert.deepEqual([stale.status, stale.data.error], [409, 'The bot changed since this proposal. Decline it and ask for a fresh proposal.']);
  const now = (await srv.api(`/bots/${bot.id}`)).data;
  assert.deepEqual([now.prompt, now.allowedTools], ['Write the notes, briefly.', ['Read']], 'nothing of it was applied');
  assert.deepEqual(await kinds(bot), ['bot-change'], 'the card stays, to be declined');
  // So does a proposal whose tools the owner changed themselves.
  const tools = await srv.asChief(`/bots/${bot.id}`, { method: 'PUT', body: { allowedTools: ['Read', 'Bash'] } });
  await srv.api(`/bots/${bot.id}`, { method: 'PUT', body: { allowedTools: ['Read', 'Edit', 'Write'] } });
  assert.equal((await answer({ id: tools.data.pendingChange }, true)).status, 409);
  assert.deepEqual((await srv.api(`/bots/${bot.id}`)).data.allowedTools, ['Read', 'Edit', 'Write']);
});
