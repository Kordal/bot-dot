// Bots don't give up after one failed route (#156, ADR 037): every run a bot does for the owner, a job, a teammate
// or a group is told to try up to 3 different routes before it reports, inside its permissions, and how to report.
// It is server text, so a fresh data directory with no notes and no shared memory has it.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot, heldRun, self } = require('./helpers');

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.stop());

const RULE = /Before you report a failure, try other reasonable routes: another tool, command, source or teammate, a smaller step, a fix and a retry\. Up to 3 attempts, each a different route;/;

function hasRule(system) {
  assert.match(system, RULE);
  assert.match(system, /stop sooner when the next needs the owner \(a permission, a login, a decision\)\./);
  // Its limits: the owner's cards and permissions, "leave others out", secrets; and the bot's own rules, as before.
  assert.match(system, /A declined or waiting card, a refused permission and "leave others out" are final for this run: don't look for another way, and never guess a secret\./);
  assert.match(system, /Never change your own main assignment, rules or skills to cover a failure/);
  // The report: the failure first, then the routes tried, then what it needs.
  assert.match(system, /Then report: what failed, what you tried, what you need\./);
}

test("an owner's message on a fresh data directory (no notes, no shared memory) carries the rule, once, after the rule to say what didn't work", async () => {
  const bot = await makeBot(srv, { name: 'Fetcher', emoji: '🪝' });
  const h = await heldRun(srv, bot, 'Get me the jq manual.');
  try {
    hasRule(h.rec.system);
    assert.equal(h.rec.system.match(new RegExp(RULE.source, 'g')).length, 1);
    assert.ok(h.rec.system.indexOf("When something doesn't work") < h.rec.system.search(RULE));
  } finally { srv.release(h.rec); await srv.finished(h.run.id); srv.unhold(); }
});

test("a scheduled job's run, a teammate's message and a turn in a group carry it too", async () => {
  const bot = await makeBot(srv, { name: 'Watcher', emoji: '🔭' });
  const mate = await makeBot(srv, { name: 'Asker', emoji: '🙋' });

  const job = (await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Look', kind: 'ai', cron: '0 4 1 1 *', prompt: 'Look for the feed.' } })).data;
  const ran = (await srv.api(`/bots/${bot.id}/jobs/${job.id}/run`, { method: 'POST' })).data;
  hasRule((await srv.nextRun((x) => x.args.includes('🔭 Watcher') && x.stdin.includes('Look for the feed.'), "the job's run")).system);
  await srv.finished(ran.run.id);

  const h = await heldRun(srv, mate);
  try {
    assert.equal((await self(srv, h.token, 'message', { to: bot.id, message: 'Is the feed up?', priority: true })).data.ok, true);
    const asked = await srv.nextRun((x) => x.args.includes('🔭 Watcher') && x.stdin.includes('Is the feed up?'), "the teammate's message");
    assert.match(asked.system, /started by a message from another bot/);
    hasRule(asked.system);
    srv.release(asked);
  } finally { srv.release(h.rec); await srv.finished(h.run.id); srv.unhold(); }

  const group = (await srv.api('/group-chats', { method: 'POST', body: { name: 'Feeds', members: [bot.id, mate.id] } })).data;
  assert.equal((await srv.api(`/group-chats/${group.id}/messages`, { method: 'POST', body: { text: 'Who has the feed?' } })).status, 201);
  const turn = await srv.nextRun((x) => x.args.includes('🔭 Watcher') && x.stdin === 'Who has the feed?', 'its turn in the group');
  assert.match(turn.system, /You are in a group/);
  hasRule(turn.system);
});
