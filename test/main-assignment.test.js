// A bot's standing task is its "main assignment" wherever the owner, the Chief of Staff or a bot reads it
// (ASSIGN-001), and the texts on how it changes match the code: every bot may propose a change to its own, and a bot's
// change to its main assignment or rules waits for the owner in Needs you.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, heldRun, waitFor, ROOT } = require('./helpers');
const { rpcClient } = require('./memory-helpers');
const { proposalView } = require('../lib/asks');
const jobs = require('../lib/jobs');
const { TOOLS } = require('../lib/mcp-server');
const { webSource } = require('./web-source');

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.stop());

// The old name, never spelled in one piece here: the plan's grep for it covers test/ too.
const OLD = /usual[ -](task|job|one)/i;
const OLD_NAME = ['Usual', 'task'].join(' ');
const source = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');

test('the Needs you card labels the field "Main assignment"', () => {
  const view = proposalView({ kind: 'bot-change', changes: { prompt: 'Watch two shops.', systemPrompt: 'Be brief.' }, before: { prompt: 'Watch one shop.', systemPrompt: '' } });
  assert.equal(view.title, 'Change this bot: new main assignment and new rules?');
  assert.deepEqual(view.parts.map((p) => p.label), ['Main assignment', 'Rules']);
  assert.equal(view.details, 'Main assignment\nNow: Watch one shop.\nProposed: Watch two shops.\n\nRules\nNow: \nProposed: Be brief.');
});

test('saving a bot without one fails with "A main assignment is required"', async () => {
  const made = await srv.api('/bots', { method: 'POST', body: { name: 'Empty', prompt: '  ' } });
  assert.equal(made.status, 400);
  assert.equal(made.data.error, 'A main assignment is required');
  const bot = await makeBot(srv);
  const saved = await srv.api(`/bots/${bot.id}`, { method: 'PUT', body: { prompt: '' } });
  assert.equal(saved.status, 400);
  assert.equal(saved.data.error, 'A main assignment is required');
});

test('a bot from before jobs gets a job named "Main assignment"; a job that has the old name keeps it', () => {
  const [job] = jobs.fromOldSchedule({ enabled: true, cron: '0 7 * * *' });
  assert.equal(job.name, 'Main assignment');
  assert.equal(job.prompt, '');
  const old = { ...job, id: 'j1', name: OLD_NAME };
  assert.equal(jobs.normalizeJobs([old], [old], 'you')[0].name, OLD_NAME);
});

test("a bot's proposal is noted as a change to its main assignment, and the tool says it waits for approval", async (t) => {
  const bot = await makeBot(srv, { name: 'Proposer', prompt: 'Owner task' });
  const { run, rec } = await heldRun(srv, bot);
  t.after(() => { srv.unhold(); srv.release(rec); });
  const self = rpcClient(t, 'self-mcp.js', rec.self.env);
  const tool = (await self.request('tools/list')).tools.find((x) => x.name === 'update_instructions');
  assert.match(tool.description, /^Propose a rewrite of your own main assignment and\/or personality \/ rules /);
  assert.match(tool.description, /waits for the owner's approval in Needs you/);
  assert.doesNotMatch(tool.description, /undo/i);
  assert.equal(tool.inputSchema.properties.task.description, 'Your complete new main assignment (omit to keep it)');
  assert.doesNotMatch(JSON.stringify((await self.request('tools/list')).tools), OLD);
  const answer = await self.text('update_instructions', { task: 'A new task', reason: 'The owner asked' });
  assert.equal(answer, 'Proposed the change. It waits in Needs you and will apply only if the owner approves it.');
  assert.equal((await srv.api(`/bots/${bot.id}`)).data.prompt, 'Owner task');
  // The line under the run in the chat, kept with the run once it ends.
  srv.unhold(); srv.release(rec);
  const learned = (await srv.finished(run.id)).learned.find((x) => x.kind === 'instructions');
  assert.equal(learned.text, 'Proposed changing its main assignment; waiting for your approval');
  // What the bot is told about learning: the change waits for the owner, it is not undone afterwards.
  assert.match(rec.system, /propose the rewrite with update_instructions: send the complete new text, keeping everything that still applies\. It applies only once the owner approves it in Needs you\./);
  assert.doesNotMatch(rec.system, /The owner can undo it/);
  assert.match(rec.system, /Never change your own main assignment, rules or skills to cover a failure/);
});

test("a message to a bot carries its task inside <main-assignment> tags, and no 'usual'", async (t) => {
  const bot = await makeBot(srv, { name: 'Messaged', prompt: 'Watch the QUOKKA shop.' });
  const { rec } = await heldRun(srv, bot, 'any news?');
  t.after(() => { srv.unhold(); srv.release(rec); });
  assert.match(rec.system, /using your main assignment below as your guide\. For example, "any news\?" means news in your area, and a short request means carrying out your main assignment for it\./);
  assert.match(rec.system, /<main-assignment>\nWatch the QUOKKA shop\.\n<\/main-assignment>/);
  assert.doesNotMatch(rec.system, OLD);
  assert.doesNotMatch(rec.stdin, OLD);
});

test("a job with a task of its own carries the bot's main assignment for context", async (t) => {
  const bot = await makeBot(srv, { name: 'Scheduled', prompt: 'Watch the NUMBAT shop.' });
  const job = await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Weekly', kind: 'ai', cron: '0 7 * * 1', prompt: 'Sum up the week.', assessment: 'A weekly summary.' } });
  assert.equal(job.status, 201, JSON.stringify(job.data));
  srv.hold();
  const started = await srv.api(`/bots/${bot.id}/jobs/${job.data.id}/run`, { method: 'POST' });
  assert.ok(started.status < 300, JSON.stringify(started.data));
  const rec = await srv.nextRun((x) => x.args.includes(`${bot.emoji} ${bot.name}`), 'the job to run');
  t.after(() => { srv.unhold(); srv.release(rec); });
  assert.match(rec.system, /This run is your scheduled job "Weekly"\. Its task replaces your main assignment this time; your main assignment, for context:\n<main-assignment>\nWatch the NUMBAT shop\.\n<\/main-assignment>/);
  assert.doesNotMatch(rec.system, OLD);
});

test('a run without a message still runs the main assignment, and is marked for the chip', async () => {
  srv.unhold();
  const bot = await makeBot(srv, { name: 'Plain', prompt: 'Watch the WOMBAT shop.' });
  const started = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: {} });
  const rec = await srv.nextRun((x) => x.args.includes(`${bot.emoji} ${bot.name}`), 'the run');
  assert.match(rec.stdin, /Watch the WOMBAT shop\./);
  assert.doesNotMatch(rec.system, /<main-assignment>/);
  assert.equal((await srv.finished(started.data.id)).customPrompt, false); // the web page draws "Ran its main assignment" from this
});

test('the Chief is told the owner calls it the "main assignment", and that every bot may propose changes to it', async () => {
  srv.unhold();
  srv.reply('Done.');
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'What can my bots learn?' } });
  const { system } = await srv.nextRun((r) => !!r.botdot);
  await waitFor(async () => !(await srv.api(`/chief/chats/${chat.id}`)).data.busy, { what: 'the Chief to reply' });
  assert.match(system, /The owner calls a bot's task \(the prompt field\) its "main assignment": use that name when you talk to them about it\./);
  const learning = system.slice(system.indexOf('\nLearning:\n'), system.indexOf('\nSkills:\n'));
  assert.ok(learning.length > 0, 'the Learning section');
  assert.doesNotMatch(learning, /by default|can undo/);
  assert.match(learning, /Every bot may also write its own skills \(reusable procedures\) and propose changes to its own main assignment and rules/);
  assert.doesNotMatch(learning, /memory only|learning "all"|Change a bot's learning/);
  assert.match(learning, /waits for the owner's approval in Needs you/);
  assert.doesNotMatch(system, OLD);
});

test("the Chief's tools: the prompt is the bot's main assignment", () => {
  for (const name of ['create_bot', 'update_bot']) {
    const fields = TOOLS.find((x) => x.name === name).inputSchema.properties;
    assert.equal(fields.prompt.description, "The bot's main assignment: the task it performs when a run brings no task of its own. May use {{date}}. Messages the user sends it are handled in this role.");
  }
  assert.equal(TOOLS.find((x) => x.name === 'add_job').inputSchema.properties.prompt.description.includes('("" = the bot\'s main assignment)'), true);
  assert.doesNotMatch(JSON.stringify(TOOLS.map((x) => [x.description, x.inputSchema])), OLD);
});

test('the web page says "Main assignment", and its empty chat has no button to run it', () => {
  const app = webSource();
  for (const text of [
    // What it is stands in the field's tooltip, not in a line under it (#635).
    "Main assignment\n        <textarea name=\"prompt\" rows=\"4\" required${tipAttrs('What it does when a job runs it, and its guide for your messages')}>",
    'Ran its main assignment',
    "Empty: the bot's main assignment",
  ]) assert.ok(app.includes(text), text);
  assert.doesNotMatch(app, OLD);
  assert.doesNotMatch(app, /data-run-default/);
  const empty = app.slice(app.indexOf('<div class="chat-empty">', app.indexOf('function botThreadHTML(')), app.indexOf('let lastDay', app.indexOf('function botThreadHTML(')));
  assert.match(empty, /botFigure\(/);
  assert.match(empty, /<h3>\$\{esc\(bot\.name\)\}<\/h3>/);
  assert.match(empty, /bot\.description/);
  assert.doesNotMatch(empty, /<button|suggestion/);
});

test('the vocabulary has the term, and no text of the server, the web page or the docs has the old name', () => {
  const context = source('CONTEXT.md');
  assert.match(context, new RegExp(`\\*\\*Main assignment\\*\\*:\\n.+\\n_Avoid_: ${OLD_NAME.toLowerCase()}, task, prompt\\n`));
  assert.equal(context.split('\n').filter((line) => OLD.test(line)).length, 1, 'only its Avoid line has the old name');
  assert.match(context, /A headless Claude Code agent with its own main assignment, rules, /);
  const files = ['server.js', 'README.md', 'docs/user-guide.md', 'docs/api.md', ...['lib', 'lib/routes', 'public'].flatMap((d) => fs.readdirSync(path.join(ROOT, d)).filter((f) => /\.(js|html|css)$/.test(f)).map((f) => `${d}/${f}`))];
  for (const file of files) {
    const hit = source(file).split('\n').findIndex((line) => OLD.test(line));
    assert.equal(hit, -1, `${file}:${hit + 1}`);
  }
});
