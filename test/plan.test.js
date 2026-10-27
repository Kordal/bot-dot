// The plan (lib/plan.js; docs/api.md, "The plan"; ADR 057): the steps of a bot's or the Chief's work of several steps,
// read from Claude Code's TodoWrite calls. It is on the running run and the Chief's pending reply as it changes, on
// the streams that follow them, kept with the run or the reply when it ends, and never in the run's log as an event
// of its own. Against a real botdot server and the stand-in Claude, which plays recorded streams.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const plan = require('../lib/plan');
const { startServer, makeBot, heldRun, waitFor, sleep } = require('./helpers');

const todos = (...steps) => ({ todos: steps.map(([content, status, activeForm]) => ({ content, status, activeForm: activeForm || content })) });
const use = (name, input = {}, extra = {}) => ({ type: 'assistant', message: { content: [{ type: 'tool_use', id: `t${Math.random()}`, name, input }] }, ...extra });
const write = (...steps) => use('TodoWrite', todos(...steps));

// ---------- reading it ----------

test('a TodoWrite call is the whole plan, in botdot\'s words for each status', () => {
  assert.deepEqual(plan.fromTodos(todos(['Read last week\'s prices', 'completed'], ['Fetch each price page', 'in_progress', 'Fetching the price pages'], ['Write the report', 'pending'])), {
    steps: [
      { text: 'Read last week\'s prices', status: 'done' },
      { text: 'Fetch each price page', status: 'doing', doing: 'Fetching the price pages' },
      { text: 'Write the report', status: 'todo' },
    ],
  });
});

test('a plan is plain text: one line per step, cut, and a list cut to its most steps', () => {
  const got = plan.fromTodos({ todos: [{ content: ' Fetch\n the <b>pages</b>\u2028 ', status: 'in_progress', activeForm: 'Fetch\n the <b>pages</b>' }, { content: '', status: 'pending' }, { content: 5 }, { content: 'x'.repeat(500), status: 'weird' }] });
  assert.deepEqual(got.steps[0], { text: 'Fetch the <b>pages</b>', status: 'doing' }, 'the step\'s words alone, as text the apps draw as text; its `doing` only when it says more');
  assert.equal(got.steps.length, 2, 'a step without words is left out');
  assert.equal(got.steps[1].status, 'todo', 'a status Claude Code does not have is a step to do');
  assert.equal([...got.steps[1].text].length, plan.MAX_TEXT);
  assert.ok(got.steps[1].text.endsWith('…'));
  const many = plan.fromTodos({ todos: Array.from({ length: 80 }, (_, i) => ({ content: `Step ${i}`, status: 'pending' })) });
  assert.equal(many.steps.length, plan.MAX_STEPS);
});

test('an empty list clears the plan; other events and a helper\'s own plan say nothing of it', () => {
  assert.equal(plan.read(use('TodoWrite', { todos: [] })), null);
  assert.equal(plan.read(use('TodoWrite', {})), null);
  assert.equal(plan.read(use('WebSearch', { query: 'x' })), undefined);
  assert.equal(plan.read({ type: 'user', message: { content: [] } }), undefined);
  assert.equal(plan.read(write(["Look", "pending"]))?.steps.length, 1);
  assert.equal(plan.read(write(['Look', 'pending'], ['Write', 'pending'])).steps.length, 2);
  assert.equal(plan.read({ ...write(['A helper step', 'pending']), parent_tool_use_id: 'toolu_1' }), undefined, 'a helper\'s plan is not its bot\'s');
  assert.deepEqual(plan.progress(plan.fromTodos(todos(['a', 'completed'], ['b', 'in_progress'], ['c', 'pending']))), { done: 1, total: 3 });
});

test('of a run\'s plan on the feed only the newest is replayed to an app that comes back (#629)', () => {
  const events = require('../lib/events');
  const first = events.emit('run_started', { id: 'r1', botId: 'b1' });
  for (let i = 0; i < 300; i++) {
    events.emit('run_plan', { chat: 'bot:b1', botId: 'b1', runId: 'r1', plan: { steps: [{ text: `Step ${i}`, status: 'doing' }] } });
    events.emit('run_plan', { chat: 'bot:b2', botId: 'b2', runId: 'r2', plan: null });
  }
  const replay = events.since(first.id);
  assert.deepEqual(replay.map((e) => [e.type, e.data.runId]), [['run_plan', 'r1'], ['run_plan', 'r2']]);
  assert.equal(replay[0].data.plan.steps[0].text, 'Step 299');
  assert.equal(replay[1].data.plan, null, 'a cleared plan is said too');
});

test('a bot and the Chief are told to plan work of several steps with TodoWrite', () => {
  assert.match(plan.PROMPT, /TodoWrite/);
  assert.match(plan.PROMPT, /above the message box/);
});

// ---------- a bot's run and a Chief's turn ----------

let srv;
before(async () => { srv = await startServer(); });
after(() => srv?.stop());

const player = (rec) => { const events = []; return (...evs) => { events.push(...evs); fs.writeFileSync(path.join(srv.out, `events-${rec.n}.json`), JSON.stringify(events)); }; };
async function streamOf(p, until, ms = 2000) {
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), ms);
  let got = '';
  try {
    const res = await fetch(`${srv.base}/api${p}`, { signal: abort.signal });
    for await (const chunk of res.body) { got += Buffer.from(chunk).toString(); if (until.test(got)) break; }
  } catch { /* timed out: what came is what there is */ } finally { clearTimeout(timer); abort.abort(); }
  return got;
}
const feedPlans = (got) => got.split('\n\n').filter((b) => /^event: run_plan$/m.test(b)).map((b) => JSON.parse(b.match(/^data: (.*)$/m)[1]));
const planEvents = (got) => got.split('\n\n').map((b) => b.match(/^data: (.*)$/m)?.[1]).filter(Boolean).map((d) => JSON.parse(d)).filter((e) => e.type === 'plan');

test('the features name it, and Claude Code is started with TodoWrite as its plan tool', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('plan'));
  const bot = await makeBot(srv, { name: 'Switches' });
  const { run, rec } = await heldRun(srv, bot);
  assert.equal(rec.env.CLAUDE_CODE_ENABLE_TODO_TOOLS, '1');
  assert.equal(rec.env.CLAUDE_CODE_ENABLE_TASKS, 'false');
  srv.release(rec);
  await srv.finished(run.id);
  srv.unhold();
});

test('a bot\'s plan is on its running run and its stream as it changes, and stays with the run when it ends', async () => {
  const bot = await makeBot(srv, { name: 'Price Checker' });
  srv.reply('Two suppliers changed their prices.');
  const { run, rec } = await heldRun(srv, bot, 'Compare the prices');
  const play = player(rec);
  const runOf = async () => (await srv.api(`/runs/${run.id}?events=0`)).data;
  await sleep(150);
  assert.equal((await runOf()).plan, undefined, 'no plan before the bot makes one');

  const live = streamOf(`/runs/${run.id}/stream?simple`, /"status":"done".*"status":"doing"/s, 4000);
  const onFeed = streamOf('/events', /event: run_plan[^]*event: run_plan/, 4000); // #629: the feed has it too
  await sleep(150);
  play(write(['Read the prices', 'in_progress', 'Reading the prices'], ['Fetch the pages', 'pending'], ['Write the report', 'pending']));
  await waitFor(async () => (await runOf()).plan?.steps?.[0]?.status === 'doing', { what: 'the plan on the running run' });
  play(write(['Read the prices', 'in_progress', 'Reading the prices'], ['Fetch the pages', 'pending'], ['Write the report', 'pending'])); // the same again: no change
  play(write(['Read the prices', 'completed'], ['Fetch the pages', 'in_progress', 'Fetching the pages'], ['Write the report', 'pending']));
  await waitFor(async () => (await runOf()).plan?.steps?.[1]?.status === 'doing', { what: 'the second step at work' });
  const sent = planEvents(await live);
  assert.equal(sent.length, 2, 'each change once, and a call that changes nothing sends nothing');
  assert.deepEqual(sent[1].plan.steps.map((s) => s.status), ['done', 'doing', 'todo']);
  assert.equal(sent[1].plan.steps[1].doing, 'Fetching the pages');
  // On the feed, which reconnects and replays: each change, with the run it is of.
  const fed = feedPlans(await onFeed);
  assert.equal(fed.length, 2);
  assert.deepEqual({ ...fed[1], at: undefined }, { chat: `bot:${bot.id}`, botId: bot.id, runId: run.id, plan: sent[1].plan, at: undefined });

  // A reload, and an app that opens the chat later: the plan as it reads now, wherever the run is read.
  for (const got of [await runOf(), (await srv.api(`/runs?botId=${bot.id}`)).data[0]]) assert.deepEqual(got.plan.steps.map((s) => s.status), ['done', 'doing', 'todo']);
  for (const q of ['', '?simple']) {
    const late = planEvents(await streamOf(`/runs/${run.id}/stream${q}`, /"type":"plan"/));
    assert.equal(late.length, 1, `stream${q}: a client that connects later is given the plan once`);
    assert.deepEqual(late[0].plan.steps.map((s) => s.status), ['done', 'doing', 'todo']);
  }
  assert.doesNotMatch(await streamOf(`/runs/${run.id}/stream?simple`, /"type":"plan"/), /"type":"step"[^}]*TodoWrite/, 'TodoWrite is no step of its own');

  play(write(['Read the prices', 'completed'], ['Fetch the pages', 'completed'], ['Write the report', 'completed']));
  await waitFor(async () => (await runOf()).plan?.steps?.[2]?.status === 'done', { what: 'every step done' });
  srv.release(rec);
  const done = await srv.finished(run.id);
  assert.equal(done.status, 'success');
  assert.deepEqual(done.plan.steps.map((s) => s.status), ['done', 'done', 'done'], 'the reply keeps the plan');
  const log = (await srv.api(`/runs/${run.id}`)).data.events;
  assert.equal(log.some((e) => e.type === 'plan'), false, 'the log holds the TodoWrite calls, not the plan');
  srv.unhold();
});

test('a bot that is stopped keeps the plan as it was, at the step it was on', async () => {
  const bot = await makeBot(srv, { name: 'Inbox Sweeper' });
  const { run, rec } = await heldRun(srv, bot, 'Sort my inbox');
  player(rec)(write(['Read the inbox', 'completed'], ['Flag the invoices', 'in_progress'], ['Archive the rest', 'pending']));
  await waitFor(async () => (await srv.api(`/runs/${run.id}?events=0`)).data.plan, { what: 'the plan' });
  await srv.api(`/runs/${run.id}/stop`, { method: 'POST' });
  const done = await srv.finished(run.id);
  assert.equal(done.status, 'stopped');
  assert.deepEqual(done.plan.steps.map((s) => s.status), ['done', 'doing', 'todo']);
  srv.unhold();
});

test('a bot that clears its plan has none', async () => {
  const bot = await makeBot(srv, { name: 'Clearer' });
  const { run, rec } = await heldRun(srv, bot);
  const play = player(rec);
  play(write(['One', 'in_progress'], ['Two', 'pending']));
  await waitFor(async () => (await srv.api(`/runs/${run.id}?events=0`)).data.plan, { what: 'the plan' });
  play(use('TodoWrite', { todos: [] }));
  await waitFor(async () => !(await srv.api(`/runs/${run.id}?events=0`)).data.plan, { what: 'no plan' });
  srv.release(rec);
  assert.equal((await srv.finished(run.id)).plan, undefined);
  srv.unhold();
});

test('the Chief\'s plan is on its pending reply and its chat\'s stream, and stays with the reply', async () => {
  srv.hold();
  srv.reply('Your three bots are set up.');
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Set up three bots for me' } });
  const rec = await srv.nextRun((r) => !!r.botdot, 'the Chief\'s turn');
  const play = player(rec);
  const last = async () => (await srv.api(`/chief/chats/${chat.id}`)).data.messages.at(-1);
  assert.equal(rec.env.CLAUDE_CODE_ENABLE_TODO_TOOLS, '1');
  play(write(['Make the news bot', 'completed'], ['Make the inbox bot', 'in_progress', 'Making the inbox bot'], ['Make the price bot', 'pending']));
  await waitFor(async () => (await last()).plan, { what: 'the plan on the pending reply' });
  const pending = await last();
  assert.equal(pending.pending, true);
  assert.deepEqual(pending.plan.steps.map((s) => s.status), ['done', 'doing', 'todo']);
  const late = planEvents(await streamOf(`/chief/chats/${chat.id}/stream`, /"type":"plan"/));
  assert.equal(late.length, 1, 'a client that connects later is given the plan once');
  assert.equal(late[0].plan.steps[1].doing, 'Making the inbox bot');
  srv.release(rec);
  await waitFor(async () => !(await last()).pending, { what: 'the reply' });
  const reply = await last();
  assert.equal(reply.text, 'Your three bots are set up.');
  assert.deepEqual(reply.plan.steps.map((s) => s.status), ['done', 'doing', 'todo'], 'the reply keeps the plan as it was last written');
  srv.unhold();
});
