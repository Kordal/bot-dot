// The Chief's create_bot and update_bot answer with `hints` (#1543): short plain sentences when the main
// assignment misses a part, the wake names a schedule the bot has no job for, or its icon or hat is another bot's.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, waitFor } = require('./helpers');
const { rpcClient } = require('./memory-helpers');
const { hintsFor } = require('../lib/bot-hints');

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.stop());

const chiefTools = (t) => rpcClient(t, 'mcp-server.js', { BOT_DOT_URL: srv.base, BOT_DOT_CHIEF_KEY: srv.chiefKey });

const GOOD = 'You watch one price and tell me when it drops.\nYou never buy anything.\nVoice: brief.\nWake: whenever I ask.';

test('a finished task, on request, gets no hints', () => {
  assert.deepEqual(hintsFor({ prompt: GOOD, jobs: [] }), []);
});

test('no "never" line is a hint, in English and Polish, and "does not" or "n\'t" count as one', () => {
  const [hint, ...rest] = hintsFor({ prompt: 'You watch one price and tell me when it drops.\nWake: whenever I ask.', jobs: [] });
  assert.equal(rest.length, 0);
  assert.match(hint, /never/);
  for (const ok of ['You summarise the news. It does not send mail.', "You summarise the news. You don't send mail.", 'Streszczasz newsy. Nigdy nie wysyłasz maili.', 'Streszczasz newsy. Nie wysyłasz maili.']) {
    assert.deepEqual(hintsFor({ prompt: ok, jobs: [] }), [], ok);
  }
});

test('a task the user dictated word for word gets no hint about its parts', () => {
  assert.deepEqual(hintsFor({ prompt: 'do the THING, exactly so.', verbatim: true, jobs: [] }), []);
  // …but a schedule with no job is a fact about the bot, not about the words.
  assert.equal(hintsFor({ prompt: 'Every morning at 8:00 list my tasks.', verbatim: true, jobs: [] }).length, 1);
});

test('a wake line that names a schedule with no job yet says to add one, not that it failed', () => {
  for (const prompt of [
    `${GOOD.replace('whenever I ask', 'every morning at 8:00, and whenever I ask')}`,
    'You list my tasks. You never delete one.\nWake: daily.',
    'You list my tasks. You never delete one. Wake: every 15 minutes.',
    'Wypisujesz moje zadania. Nigdy ich nie usuwasz.\nWake: codziennie rano.',
  ]) {
    const hints = hintsFor({ prompt, jobs: [] });
    assert.equal(hints.length, 1, prompt);
    assert.match(hints[0], /no job yet; add it with add_job/);
  }
  // A job already there, or a word that only looks like a schedule, is no hint.
  assert.deepEqual(hintsFor({ prompt: 'You list my tasks. You never delete one. Wake: daily.', jobs: [{ id: 'j1' }] }), []);
  assert.deepEqual(hintsFor({ prompt: 'You report every price drop you find. You never buy.\nWake: whenever I ask.', jobs: [] }), []);
});

test('an icon or hat another bot has is a hint; a hat the Chief drew, the bot itself and an empty one are not', () => {
  const others = [{ id: 'b1', name: 'News', outfit: { icon: 'news', hat: 'cap' } }, { id: 'b2', name: 'Drawn', outfit: { hat: { shapes: [] } } }];
  const own = (outfit, id = 'b9') => hintsFor({ prompt: GOOD, jobs: [], bot: { id, outfit }, others, outfitAsked: outfit });
  assert.match(own({ icon: 'news' })[0], /icon "news" is News's/);
  assert.match(own({ hat: 'cap' })[0], /hat "cap" is News's/);
  assert.equal(own({ icon: 'news', hat: 'cap' }).length, 2);
  assert.deepEqual(own({ icon: 'food', hat: 'chef' }), []);
  assert.deepEqual(own({ hat: { shapes: [] } }), []);
  assert.deepEqual(own({ icon: 'news' }, 'b1'), [], 'a bot is not another bot to itself');
  assert.deepEqual(hintsFor({ prompt: GOOD, jobs: [], bot: { id: 'b9', outfit: { icon: 'news' } }, others, outfitAsked: undefined }), [], 'only a piece this call set');
});

test('create_bot answers with hints, and none when there is nothing to say', async (t) => {
  const chief = chiefTools(t);
  const first = await chief.json('create_bot', { name: 'Hint A', prompt: GOOD, outfit: { icon: 'news', hat: 'cap' } });
  assert.equal(first.hints, undefined, 'no hints key when clean');

  const bad = await chief.json('create_bot', { name: 'Hint B', prompt: 'You watch a price every morning at 8:00.', outfit: { icon: 'news', hat: 'cap' } });
  assert.equal(bad.hints.length, 4, JSON.stringify(bad.hints));
  assert.ok(bad.hints.some((h) => /never/.test(h)));
  assert.ok(bad.hints.some((h) => /no job yet; add it with add_job/.test(h)));
  assert.ok(bad.hints.some((h) => /icon "news" is Hint A's/.test(h)));
  assert.ok(bad.hints.some((h) => /hat "cap" is Hint A's/.test(h)));
  assert.equal(bad.prompt, 'You watch a price every morning at 8:00.', 'the bot is saved as it was sent: hints only advise');

  const dictated = await chief.json('create_bot', { name: 'Hint C', prompt: 'do the THING, exactly so.', verbatim: true });
  assert.equal(dictated.hints, undefined);
  assert.equal(dictated.verbatim, undefined);
});

test('update_bot answers with hints when the prompt changes or an icon is set, and not for other changes', async (t) => {
  const chief = chiefTools(t);
  const a = await chief.json('create_bot', { name: 'Upd A', prompt: GOOD, outfit: { icon: 'server' } });
  const b = await chief.json('create_bot', { name: 'Upd B', prompt: GOOD });
  // An unrelated change says nothing, whatever the task is.
  assert.equal((await chief.json('update_bot', { id: a.id, description: 'Watches a price' })).hints, undefined);
  // A new icon another bot has.
  const icon = await chief.json('update_bot', { id: b.id, outfit: { icon: 'server' } });
  assert.match(icon.hints.join(' '), /icon "server" is Upd A's/);
  // A changed task is read as sent, though it waits for the owner's OK; the job it has counts.
  await srv.api(`/bots/${b.id}/jobs`, { method: 'POST', body: { name: 'Morning', cron: '0 8 * * *', prompt: 'Check.', kind: 'ai' } });
  const changed = await chief.json('update_bot', { id: b.id, prompt: 'You list tasks.\nWake: every morning.' });
  assert.equal(changed.hints.length, 1, JSON.stringify(changed.hints));
  assert.match(changed.hints[0], /never/);
  const dictated = await chief.json('update_bot', { id: b.id, prompt: 'just so', verbatim: true });
  assert.equal(dictated.hints, undefined);
  assert.equal((await chief.json('get_bot', { id: b.id })).verbatim, undefined);
});

test("the tools name `hints` and `verbatim`", async (t) => {
  const tools = (await chiefTools(t).request('tools/list')).tools;
  for (const name of ['create_bot', 'update_bot']) {
    const tool = tools.find((x) => x.name === name);
    assert.equal(tool.inputSchema.properties.verbatim.type, 'boolean');
    // update_bot takes the field without its words, as for every field (#1106).
    if (name === 'create_bot') assert.match(tool.inputSchema.properties.verbatim.description, /dictated.*`hints`/);
  }
});

test('the Chief is told to act on hints in the same turn, or say why not', async () => {
  srv.reply('Done.');
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Make me a bot' } });
  const { system } = await srv.nextRun((r) => !!r.botdot);
  await waitFor(async () => !(await srv.api(`/chief/chats/${chat.id}`)).data.busy, { what: 'the Chief to reply' });
  assert.match(system, /When create_bot or update_bot answers with `hints`, act on each in the same turn \(.*\), or tell the user in one line why you did not\. Pass verbatim: true when the user dictated the task word for word\./);
});
