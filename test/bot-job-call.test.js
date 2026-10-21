// A bot proposes a call on its own job (#37, section 4; ADR 026): the same change and card as the Chief's
// proposal, the same refusals, and the owner's yes makes the key in the Vault for no bot. The bot is told the
// address and where the key is, never the key; it may turn the call off at once, and never makes a new key.
// Through the bot's own routes (its run token) and its MCP tools, on a real server.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const { startServer, makeBot, self, feed, vaultSecret } = require('./helpers');
const { kit, isRunOf } = require('./carry-on-helpers');
const { rpcClient } = require('./memory-helpers');
const { call } = require('./call-helpers');

const WARNING = 'Anything that can reach this machine and has the key can run this job now and send it text.';
const SUMMARY = 'Runs when the garage camera sees motion.';
let srv, carriedOn, lastRun;
before(async () => { srv = await startServer(); ({ carriedOn, lastRun } = kit(srv)); });
after(async () => { srv.unhold(); await srv.stop(); });

const at = (b, j) => `/bots/${b.id}/jobs/${j.id}`;
const approve = (b, j, yes = true) => srv.api(`${at(b, j)}/approve`, { method: 'POST', body: { approve: yes } });
const jobOf = async (b, j) => (await srv.api(`/bots/${b.id}/jobs`)).data.find((x) => x.id === j.id);
const keyName = (b, j) => `Call key: ${b.name} / ${j.name}`;
const addScript = async (b, name) => (await srv.api(`/bots/${b.id}/jobs`, { method: 'POST', body: { name, kind: 'script', cron: '0 4 1 1 *', script: 'cat' } })).data;
// The owner asks the bot something, and in that run the bot does `what` with its run token; the run as it ended.
async function inRun(bot, request, what, reply = 'Proposed it. It waits for your OK.') {
  srv.hold();
  const started = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: request } });
  const rec = await srv.nextRun((x) => x.self?.env && isRunOf(bot)(x) && x.stdin.includes(request), `the run about “${request}”`);
  let did;
  try { did = await what(rec.self.env.RUN_TOKEN, rec.self.env); } finally {
    srv.reply(reply);
    srv.release(rec);
  }
  const run = await srv.finished(started.data.id);
  srv.unhold();
  return { run, did };
}

test('a bot proposes a call on its own approved job: the card waits with the warning first, and no call is taken yet', async () => {
  const bot = await makeBot(srv, { name: 'Garage Watch', emoji: '🚗', allowedTools: ['WebSearch', 'WebFetch', 'Bash'] });
  const job = await addScript(bot, 'Motion');
  const { did } = await inRun(bot, 'Let Home Assistant start Motion', (token) => self(srv, token, 'jobs', { action: 'propose-call', jobId: job.id, summary: SUMMARY }));
  assert.equal(did.status, 200, JSON.stringify(did.data));
  assert.equal(did.data.needsApproval, true);
  const waiting = await jobOf(bot, job);
  assert.equal(waiting.call, false, 'the approved job takes no call yet');
  assert.equal(waiting.change.call, true);
  assert.equal(waiting.change.by, 'bot');
  assert.equal(waiting.change.summary, `${WARNING} Garage Watch can browse the web and run commands. ${SUMMARY}`);
  const live = await feed(srv);
  try { assert.ok((await live.wait('hello')).data.approvals.jobs.some((c) => c.jobId === job.id && c.change), 'a card in Needs you'); } finally { live.close(); }
  assert.equal(vaultSecret(srv, keyName(bot, job)), null, 'no key before the yes');
});

test("a bot proposes no call on another bot's job, on a job never approved, without a sentence, or when it skips every check", async () => {
  const bot = await makeBot(srv, { name: 'Porch Watch' });
  const other = await makeBot(srv, { name: 'Other Watch' });
  const theirs = await addScript(other, 'Theirs');
  const fresh = (await srv.asChief(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'New', kind: 'script', cron: '0 4 1 1 *', script: 'cat', assessment: 'No AI needed.' } })).data;
  const mine = await addScript(bot, 'Mine');
  const { did } = await inRun(bot, 'Try them all', async (token) => ({
    theirs: await self(srv, token, 'jobs', { action: 'propose-call', jobId: theirs.id, summary: SUMMARY }),
    fresh: await self(srv, token, 'jobs', { action: 'propose-call', jobId: fresh.id, summary: SUMMARY }),
    bare: await self(srv, token, 'jobs', { action: 'propose-call', jobId: mine.id, summary: ' ' }),
  }));
  assert.match(did.theirs.data.error, /No job with id/);
  assert.equal((await jobOf(other, theirs)).change, undefined);
  assert.match(did.fresh.data.error, /approved/);
  assert.match(did.bare.data.error, /summary/);
  assert.equal((await jobOf(bot, mine)).change, undefined);

  const wild = await makeBot(srv, { name: 'Wild', permissionMode: 'bypassPermissions' });
  const wildJob = await addScript(wild, 'Ping');
  const refused = await inRun(wild, 'Take calls', (token) => self(srv, token, 'jobs', { action: 'propose-call', jobId: wildJob.id, summary: SUMMARY }));
  assert.match(refused.did.data.error, /bypassPermissions/);
  assert.equal((await jobOf(wild, wildJob)).change, undefined);
});

test("the owner's yes makes the key for no bot; the bot carries on told the address and the Vault item, never the key", async () => {
  const bot = await makeBot(srv, { name: 'Gate Watch', emoji: '🚪' });
  const job = await addScript(bot, 'Gate');
  const asked = await inRun(bot, 'Let the gate box call you', (token) => self(srv, token, 'jobs', { action: 'propose-call', jobId: job.id, summary: 'Runs when the gate opens.' }), 'I asked for it.');
  srv.reply('Tell your gate box the address.');
  const yes = await approve(bot, job);
  assert.equal(yes.status, 200, JSON.stringify(yes.data));
  assert.deepEqual([yes.data.call, yes.data.carriesOn], [true, { who: 'bot', text: 'it carries on' }]);
  const item = (await srv.api('/vault')).data.find((x) => x.name === keyName(bot, job));
  assert.deepEqual([item.type, item.allowedBots], ['api-token', []]);
  const key = vaultSecret(srv, keyName(bot, job));
  assert.equal((await call(srv, bot, job, key, { body: 'open' })).status, 202, 'the key runs the job');

  await carriedOn(bot, asked.run);
  const rec = await lastRun(bot);
  const address = `${srv.base}/call/${srv.account}/${bot.id}/${job.id}`;
  assert.ok(rec.stdin.includes(`The owner allowed you to: let the script “Gate” take calls: its call address is ${address}, and its key is in the Vault item “${keyName(bot, job)}”, which no bot is given.`), rec.stdin);
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  assert.ok(!rec.stdin.includes(key) && !rec.stdin.includes(hash), 'never the key');

  // Later, through its own tool: the address and where the key is, never the key.
  const { did } = await inRun(bot, 'What was the address?', (token) => self(srv, token, 'jobs', { action: 'call', jobId: job.id }));
  assert.deepEqual(did.data.call, { name: 'Gate', call: true, waiting: false, mode: 'bearer', waitingMode: null, address, vaultItem: keyName(bot, job), notifyUrl: null, notifyWaiting: null, notifySecretItem: null, notifyFailed: [] });
  assert.ok(!JSON.stringify(did.data).includes(key) && !JSON.stringify(did.data).includes(hash));
});

test('a bot turns off a call on its own job at once, takes back a proposal that waits, and makes no new key', async () => {
  const bot = await makeBot(srv, { name: 'Shed Watch' });
  const on = await addScript(bot, 'On');
  const waits = await addScript(bot, 'Waits');
  const first = await inRun(bot, 'Propose both', async (token) => {
    await self(srv, token, 'jobs', { action: 'propose-call', jobId: on.id, summary: SUMMARY });
    await self(srv, token, 'jobs', { action: 'propose-call', jobId: waits.id, summary: SUMMARY });
  });
  await approve(bot, on);
  await carriedOn(bot, first.run); // the yes carries the run on: it ends before the next is asked
  const key = vaultSecret(srv, keyName(bot, on));
  const { did } = await inRun(bot, 'Stop the calls', async (token) => ({
    off: await self(srv, token, 'jobs', { action: 'call-off', jobId: on.id }),
    back: await self(srv, token, 'jobs', { action: 'call-off', jobId: waits.id }),
    rotate: await self(srv, token, 'jobs', { action: 'new-call-key', jobId: on.id }),
  }));
  assert.deepEqual([did.off.status, did.off.data.call.call, did.off.data.call.waiting], [200, false, false]);
  assert.equal((await call(srv, bot, on, key, { body: 'x' })).status, 409, 'a call is refused now');
  assert.deepEqual([did.back.data.call.call, did.back.data.call.waiting], [false, false]);
  assert.equal((await jobOf(bot, waits)).change, undefined, 'the proposal is taken back');
  assert.equal(did.rotate.status, 400, 'no new key from a bot');
  assert.equal(vaultSecret(srv, keyName(bot, on)), key);
});

test("a bot's MCP tools: propose_job_call, job_call and job_call_off, and its prompt says when to propose one", async (t) => {
  const bot = await makeBot(srv, { name: 'Barn Watch', emoji: '🐄' });
  const job = await addScript(bot, 'Barn');
  const { did } = await inRun(bot, 'Let the NAS call Barn', async (token, env) => {
    const mcp = rpcClient(t, 'self-mcp.js', env);
    const names = (await mcp.request('tools/list')).tools.map((x) => x.name);
    return {
      names,
      proposed: await mcp.text('propose_job_call', { jobId: job.id, summary: 'Runs when the NAS finishes a backup.' }),
      info: await mcp.json('job_call', { jobId: job.id }),
      off: await mcp.text('job_call_off', { jobId: job.id }),
    };
  });
  const prompt = (await lastRun(bot)).system;
  assert.ok(['propose_job_call', 'job_call', 'job_call_off'].every((n) => did.names.includes(n)), did.names.join());
  assert.ok(['propose_job_notify', 'job_notify_off'].every((n) => did.names.includes(n)), did.names.join());
  assert.ok(!did.names.includes('new_job_call_key') && !did.names.includes('new_job_notify_secret'));
  assert.match(did.proposed, /waits for the owner's OK on a card in Needs you/);
  assert.deepEqual([did.info.call, did.info.waiting], [false, true]);
  assert.match(did.off, /Calls to the job "Barn" are off/);
  assert.match(prompt, /propose_job_call/);
  assert.match(prompt, /never ask for the key/i);
});
