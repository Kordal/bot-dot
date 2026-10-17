// How the Chief of Staff designs a bot: its task is one job, what it never does, its voice and when it
// wakes; the Chief confirms in one line and says what waits for the owner's OK (the answer of create_bot
// and update_bot lists it: no read-back since QW-004). These are the words it is started with.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot, waitFor } = require('./helpers');
const { rpcClient } = require('./memory-helpers');

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.stop());

const chiefTools = (t) => {
  const client = rpcClient(t, 'mcp-server.js', { BOT_DOT_URL: srv.base, BOT_DOT_CHIEF_KEY: srv.chiefKey });
  return { list: async () => (await client.request('tools/list')).tools, call: client.json };
};

// What a hand-written task of the old kind looks like; the Chief's update must leave such bots alone.
const OLD_TASK = 'Check the server logs for errors and summarise them. {{date}}';

test('the Chief is started with the four parts of a task, one example, and the one line after saving', async () => {
  srv.reply('Done.');
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Make me a bot that watches a price' } });
  const { system } = await srv.nextRun((r) => !!r.botdot);
  await waitFor(async () => !(await srv.api(`/chief/chats/${chat.id}`)).data.busy, { what: 'the Chief to reply' });

  // The four parts, in order, in one text in the prompt field.
  assert.match(system, /Write a bot's task \(the prompt field\) as one text of four parts, in this order: its one job, named in the first sentence; what it never does; its voice in a few words; when it wakes \(on request, on a schedule, or both\)/);
  // Waking on a schedule points at the existing rule about staying quiet; it isn't restated.
  assert.match(system, /A bot that wakes on a schedule reports only when there is something new, as under "Scheduled reports"/);
  assert.equal((system.match(/A scheduled AI job reaches the user only when its bot calls notify_owner/g) || []).length, 1);
  assert.match(system, /The wake line only says when; the schedule itself is a job you add with add_job/);
  // One example of a finished task, about five short lines.
  const example = system.match(/A finished task looks like this:\n((?: {2}.+\n)+)/);
  assert.ok(example, 'an example of a finished task');
  const lines = example[1].trimEnd().split('\n').map((l) => l.trim());
  assert.ok(lines.length >= 4 && lines.length <= 5, `${lines.length} lines`);
  assert.match(lines[0], /^You watch /);
  assert.match(lines[1], /^You never /);
  assert.match(lines[2], /^Voice: /);
  assert.match(lines[3], /^Wake: /);

  // One line after saving; a difference is said plainly; what waits is in the answer, not read back (QW-004).
  assert.match(system, /After create_bot or update_bot, tell the user in one line what the bot does and what it never does \("Price Watcher checks the three shops every morning and never buys anything\."\)/);
  assert.match(system, /Both answer with the bot as it was saved: when it differs from what you sent, say plainly what differs/);
  assert.match(system, /They also answer with `waiting`, the list of what waits for the user's OK on its card in Needs you \(a changed task or changed rules, .* the home network .*\): say that in one line/);
  assert.doesNotMatch(system, /read the bot back|reads back right|get_bot shows the old value/);
  // Questions, dictated tasks, two jobs, existing bots.
  assert.match(system, /Ask at most two short questions, and only what you cannot settle yourself/);
  assert.match(system, /Two is the limit for the whole request, before and after creating, also when it becomes several bots/);
  assert.match(system, /Once the job is clear, create the bot right away, without asking whether to/);
  assert.match(system, /A task the user dictates word for word is saved exactly as given/);
  assert.match(system, /When a request names two unrelated jobs, make one bot per job, or ask one question: which job comes first/);
  assert.match(system, /An existing bot keeps its task until the user asks you to change it/);
  // The sentence it replaces is gone; the opening line of MSG-005 stays.
  assert.doesNotMatch(system, /Design bots carefully/);
  assert.match(system, /Don't narrate your process\. One exception: when the request needs your tools/);
});

test("the Chief's tools say the same, and a bot gets no new field for it", async (t) => {
  const chief = chiefTools(t);
  const tools = await chief.list();
  const of = (name) => tools.find((x) => x.name === name);
  assert.match(of('create_bot').description, /Its task \(prompt\) is one text: its one job in the first sentence, what it never does, its voice in a few words, and when it wakes; a task the user dictates is saved as given\..* The answer is the bot as it was saved, with its task\. `waiting` in it lists what was not given yet/);
  assert.match(of('update_bot').description, /Only pass the fields to change\. A changed task \(prompt\) keeps the four parts: one job, what it never does, voice, when it wakes; a task the user dictates is saved as given\. The answer is the bot as it was saved, with its task\. `waiting` in it lists what of this call was not saved/);
  assert.deepEqual(of('create_bot').inputSchema.required, ['name', 'prompt']);
  const fields = Object.keys(of('create_bot').inputSchema.properties);
  for (const part of ['job', 'never', 'neverDoes', 'antiJobs', 'voice', 'wake']) assert.ok(!fields.includes(part), `no "${part}" field`);
});

test('a task is saved as given, in the prompt field, and get_bot reads it back whole', async (t) => {
  const chief = chiefTools(t);
  const task = 'You watch the price of one pair of headphones and tell me when it drops.\nYou never buy anything.\nVoice: brief.\nWake: every morning at 8:00, and whenever I ask.';
  const made = await chief.call('create_bot', { name: 'Price Watcher', prompt: task });
  assert.equal(made.prompt, task, 'create_bot answers the task as it was saved (QW-002), so the Chief sees it without a get_bot');
  assert.equal((await chief.call('get_bot', { id: made.id })).prompt, task);

  // Dictated word for word, odd as it is: stored untouched.
  const dictated = '  do the THING, exactly so.\n\n(no more)  ';
  const second = await chief.call('create_bot', { name: 'Dictated', prompt: dictated });
  assert.equal((await chief.call('get_bot', { id: second.id })).prompt, dictated);
  // A change to something else leaves the task alone.
  await chief.call('update_bot', { id: made.id, description: 'Watches a price' });
  assert.equal((await chief.call('get_bot', { id: made.id })).prompt, task);

  // A task the Chief changes waits for the owner's OK: update_bot's answer has the task as it is saved, and says what waits (QW-002).
  const changed = await chief.call('update_bot', { id: made.id, prompt: dictated });
  assert.equal(changed.prompt, task);
  assert.deepEqual(changed.waiting, ['new main assignment']);
  assert.equal((await chief.call('get_bot', { id: made.id })).prompt, task, 'still the old task: what was sent is not what is saved');
});

test('starting the server changes no stored bot', async () => {
  let a = await startServer();
  try {
    await makeBot(a, { name: 'Log Reader', prompt: OLD_TASK, description: 'Reads logs', systemPrompt: 'Be terse.' });
    await makeBot(a, { name: 'Vague', prompt: 'Help me.' });
    const stored = (x) => x.map(({ running, ...bot }) => bot).sort((p, q) => p.id.localeCompare(q.id));
    const before = stored((await a.api('/bots')).data);
    assert.ok(before.length >= 2);
    await a.stop();
    a = await startServer({ dir: a.dir });
    assert.deepEqual(stored((await a.api('/bots')).data), before);
    assert.equal(before.find((b) => b.name === 'Log Reader').prompt, OLD_TASK);
  } finally { await a.stop(); }
});
