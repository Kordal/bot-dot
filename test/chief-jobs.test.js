// The Chief of Staff's own scheduled jobs (#408, ADR 073): kept with a schedule or a moment, run when due by a run of
// the Chief's own that only reads (a look's session: web search, botdot's reading tools, the connected apps
// read-only), whose last words are the Chief's message in the chat the job was set up in. The store's clock is
// set here; the server's tests use the stand-in for Claude.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const jobsLib = require('../lib/chief-jobs');
const { startServer, feed, waitFor } = require('./helpers');

const store = () => jobsLib.create(fs.mkdtempSync(path.join(os.tmpdir(), 'chief-jobs-')));

test('a job needs a name, a task and a schedule or a moment, and at most 20 are kept', () => {
  const s = store();
  assert.throws(() => s.add({ task: 'x', cron: '0 8 * * *' }), /short name/);
  assert.throws(() => s.add({ name: 'News', cron: '0 8 * * *' }), /its task/);
  assert.throws(() => s.add({ name: 'News', task: 'x' }), /Say when it runs/);
  assert.throws(() => s.add({ name: 'News', task: 'x', cron: 'every day' }), /is not a schedule/);
  assert.throws(() => s.add({ name: 'News', task: 'x', cron: '0 8 * * *', at: '2099-01-01T08:00' }), /not both/);
  assert.throws(() => s.add({ name: 'News', task: 'x', at: '2000-01-01T08:00' }), /has passed/);
  const j = s.add({ name: '  Morning   news ', task: 'Tell me what is new on hn', cron: '0 8 * * 1-5' }, { chatId: 'c1' });
  assert.deepEqual([j.name, j.on, j.cron, typeof j.when], ['Morning news', true, '0 8 * * 1-5', 'string']);
  for (let i = 1; i < jobsLib.MAX; i++) s.add({ name: `J${i}`, task: 'x', cron: '0 8 * * *' });
  assert.throws(() => s.add({ name: 'One more', task: 'x', cron: '0 8 * * *' }), /Remove one first/);
});

test('a job is due in its minute once, paused it is not, and a one-time job goes after it ran', () => {
  const s = store();
  const j = s.add({ name: 'News', task: 'x', cron: '30 8 * * *' });
  const at = new Date(2030, 0, 7, 8, 30, 10);
  assert.equal(s.due(new Date(2030, 0, 7, 8, 29))?.id, undefined);
  assert.equal(s.due(at).id, j.id);
  s.ran(j.id, at);
  assert.equal(s.due(new Date(2030, 0, 7, 8, 30, 40)), null, 'not twice in its minute');
  assert.equal(s.due(new Date(2030, 0, 8, 8, 30)).id, j.id, 'the next day');
  s.update(j.id, { on: false });
  assert.equal(s.due(new Date(2030, 0, 9, 8, 30)), null, 'paused');
  const once = s.add({ name: 'Once', task: 'y', at: '2099-05-01T09:00' });
  assert.equal(s.due(new Date(2099, 4, 1, 9, 5)).id, once.id, 'a moment that passed while botdot was off runs once it is back');
  s.ran(once.id);
  assert.deepEqual(s.list().map((x) => x.name), ['News']);
  assert.throws(() => s.remove('nope'), /no job of yours/);
});

let srv, f;
before(async () => { srv = await startServer(); f = await feed(srv); await f.wait('hello'); });
after(async () => { srv.unhold(); f.close(); await srv.stop(); });

const isJobRun = (x) => x.args.includes('🧭 Chief of Staff · job');
const chatOf = async (id) => (await srv.api(`/chief/chats/${id}`)).data;

test('the server has Chief jobs; the owner sets one up, switches it and removes it, announced on the feed', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('chief-jobs'));
  const made = await srv.api('/chief/jobs', { method: 'POST', body: { name: 'Weekly sum-up', task: 'Sum up what my bots did', cron: '0 17 * * 5' } });
  assert.equal(made.status, 201);
  await f.wait('chief_jobs', (d) => d.jobs.some((j) => j.id === made.data.id));
  const off = await srv.api(`/chief/jobs/${made.data.id}`, { method: 'PUT', body: { on: false } });
  assert.equal(off.data.on, false);
  assert.equal((await srv.api('/chief/jobs', { method: 'POST', body: { name: 'Bad', task: 'x', cron: 'soon' } })).status, 400);
  assert.equal((await srv.api(`/chief/jobs/${made.data.id}`, { method: 'DELETE' })).status, 200);
  assert.deepEqual((await srv.api('/chief/jobs')).data.jobs, []);
  assert.equal((await srv.api('/chief/jobs/nope', { method: 'DELETE' })).status, 404);
});

test('the Chief sets up its jobs only in a turn the owner started', async () => {
  const c = (await srv.api('/chief/chats', { method: 'POST' })).data;
  const refused = await srv.asChief('/chief/jobs', { method: 'POST', headers: { 'X-Chief-Chat': c.id }, body: { name: 'Sneaky', task: 'x', cron: '0 8 * * *' } });
  assert.equal(refused.status, 403);
  assert.ok((await srv.asChief('/chief/jobs', { headers: { 'X-Chief-Chat': c.id } })).data.jobs, 'it may read them');
  srv.hold();
  await srv.api(`/chief/chats/${c.id}/messages`, { method: 'POST', body: { text: 'Every morning at 8 tell me the weather in Gdansk' } });
  const turn = await srv.nextRun((x) => x.stdin.includes('weather in Gdansk'), "the Chief's turn");
  try {
    const r = await srv.asChief('/chief/jobs', { method: 'POST', headers: { 'X-Chief-Chat': c.id }, body: { name: 'Weather', task: 'Tell me the weather in Gdansk', cron: '0 8 * * *' } });
    assert.equal(r.status, 201);
  } finally { srv.unhold(); srv.release(turn); }
  const job = (await srv.api('/chief/jobs')).data.jobs.find((j) => j.name === 'Weather');
  assert.ok(job);
  await srv.api(`/chief/jobs/${job.id}`, { method: 'DELETE' });
});

test("a job's run only reads, and its findings are the Chief's message in the chat it was set up in", async () => {
  const c = (await srv.api('/chief/chats', { method: 'POST' })).data;
  srv.hold();
  await srv.api(`/chief/chats/${c.id}/messages`, { method: 'POST', body: { text: 'Every Monday check hn for botdot' } });
  const turn = await srv.nextRun((x) => x.stdin.includes('check hn for botdot'), "the Chief's turn");
  let job;
  try {
    job = (await srv.asChief('/chief/jobs', { method: 'POST', headers: { 'X-Chief-Chat': c.id }, body: { name: 'HN watch', task: 'Look on Hacker News for posts about botdot', cron: '0 9 * * 1' } })).data;
  } finally { srv.release(turn); }
  await waitFor(async () => !(await chatOf(c.id)).busy || null, { what: 'the turn to end' });

  srv.reply('Two posts about botdot today: https://news.example/1');
  assert.equal((await srv.api(`/chief/jobs/${job.id}/run`, { method: 'POST' })).status, 202);
  const run = await srv.nextRun(isJobRun, "the job's run");
  const arg = (flag) => run.args[run.args.indexOf(flag) + 1];
  assert.equal(arg('--tools'), 'WebSearch', 'web search, no fetch of an address it picks');
  assert.ok(run.args.includes('--no-session-persistence'));
  const mcp = JSON.parse(fs.readFileSync(arg('--mcp-config'), 'utf8'));
  assert.equal(mcp.mcpServers.botdot.env.BOT_DOT_LOOK, '1', "botdot's reading tools only");
  assert.ok(!mcp.mcpServers.botdot.env.BOT_DOT_PAGE);
  assert.match(run.stdin, /<task>\nLook on Hacker News for posts about botdot\n<\/task>/);
  srv.unhold();
  srv.release(run);
  const chat = await waitFor(async () => { const ch = await chatOf(c.id); return ch.messages.some((m) => m.job) ? ch : null; }, { what: "the job's message" });
  const msg = chat.messages.find((m) => m.job);
  assert.deepEqual([msg.role, msg.text, msg.job.name], ['chief', 'Two posts about botdot today: https://news.example/1', 'HN watch']);
  assert.ok((await srv.api('/chief/jobs')).data.jobs.find((j) => j.id === job.id).lastRunAt);

  // Its next turn is told the message, as its own from a run that read the web.
  srv.reply('Yes.');
  await srv.api(`/chief/chats/${c.id}/messages`, { method: 'POST', body: { text: 'Anything else?' } });
  const next = await srv.nextRun((x) => x.stdin.includes('Anything else?') && !isJobRun(x), 'the next turn');
  assert.match(next.stdin, /scheduled job "HN watch" ran[\s\S]*<your-job-message>\nTwo posts about botdot today/);
  await waitFor(async () => !(await chatOf(c.id)).busy || null, { what: 'the turn to end' });

  // NOTHING sends nothing.
  srv.reply('NOTHING');
  const before = (await chatOf(c.id)).messages.length;
  await srv.api(`/chief/jobs/${job.id}/run`, { method: 'POST' });
  await srv.nextRun(isJobRun, "the job's second run");
  await waitFor(async () => (await srv.api(`/chief/jobs/${job.id}/run`, { method: 'POST' })).status !== 409 || null, { what: 'the run to end' });
  await srv.nextRun(isJobRun, "the job's third run");
  await new Promise((r) => setTimeout(r, 500));
  assert.equal((await chatOf(c.id)).messages.length, before);
  await srv.api(`/chief/jobs/${job.id}`, { method: 'DELETE' });
});
