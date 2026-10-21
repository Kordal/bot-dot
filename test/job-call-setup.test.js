// The Chief sets up a call (ADR 026): it proposes one, a card waits beside the approved job, and the owner's yes
// makes the key, kept in the Vault as an API token no bot is given. A new key and turning a call off are at once.
// Through the Chief's routes (its key) and the owner's, on a real server; calls to the job's call address at the (stand-in) front door.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { startServer, makeBot, self, heldRun, feed, waitFor, vaultSecret } = require('./helpers');

const WARNING = 'Anything that can reach this machine and has the key can run this job now and send it text.';
let srv;
let bot;
let job;

// A call to `address`, by default job j's call address at the front door.
const call = (b, j, key, body = 'ping', address = `${srv.base}/call/${srv.account}/${b.id}/${j.id}`) => new Promise((resolve, reject) => {
  const { pathname } = new URL(address);
  const req = http.request({ host: '127.0.0.1', port: new URL(address).port, method: 'POST', path: pathname, headers: { Authorization: `Bearer ${key}` } }, (res) => {
    let text = '';
    res.on('data', (c) => (text += c));
    res.on('end', () => { let data = text; try { data = JSON.parse(text); } catch { /* text */ } resolve({ status: res.statusCode, data }); });
  });
  req.on('error', reject);
  req.end(body);
});
const at = (b, j) => `/bots/${b.id}/jobs/${j.id}`;
const propose = (b, j) => srv.asChief(at(b, j), { method: 'PUT', body: { call: true, summary: 'Runs when the garage camera sees motion.' } });
const approve = (b, j, yes = true) => srv.api(`${at(b, j)}/approve`, { method: 'POST', body: { approve: yes } });
const jobOf = async (b, j) => (await srv.api(at(b, j).replace(/\/jobs\/.*/, '/jobs'))).data.find((x) => x.id === j.id);
const keyName = (b, j) => `Call key: ${b.name} / ${j.name}`;
const addScript = async (b, name) => (await srv.api(`/bots/${b.id}/jobs`, { method: 'POST', body: { name, kind: 'script', cron: '0 4 1 1 *', script: 'cat' } })).data;

before(async () => {
  srv = await startServer();
  bot = await makeBot(srv, { name: 'Garage Watch', allowedTools: ['WebSearch', 'WebFetch', 'Bash'] });
  job = await addScript(bot, 'Motion');
});
after(() => srv.stop());

test('the Chief proposes a call: a card waits beside the job, with the warning and the bot\'s tools, and no call is taken yet', async () => {
  const r = await propose(bot, job);
  const live = await feed(srv); // its hello says what waits after the proposal
  try {
    assert.equal(r.status, 200, JSON.stringify(r.data));
    assert.equal(r.data.call, false, 'the approved job is not callable yet');
    assert.equal(r.data.change.call, true);
    assert.match(r.data.change.summary, new RegExp(WARNING.replace(/\./g, '\\.')));
    assert.match(r.data.change.summary, /Garage Watch can browse the web and run commands\./);
    assert.match(r.data.change.summary, /Runs when the garage camera sees motion\./);
    const hello = await live.wait('hello');
    assert.ok(hello.data.approvals.jobs.some((c) => c.jobId === job.id && c.change), 'a card in Needs you');
  } finally { live.close(); }
  assert.equal((await call(bot, job, 'anything')).status, 401);
  assert.equal(vaultSecret(srv, keyName(bot, job)), null, 'no key before the yes');
});

test('a call on an AI job waits for the owner too, and a later edit keeps it waiting', async () => {
  const ai = (await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Look', kind: 'ai', cron: '0 4 1 1 *', prompt: 'Look.' } })).data;
  const r = await propose(bot, ai);
  assert.equal(r.data.call, false);
  assert.equal(r.data.change?.call, true);
  const renamed = await srv.asChief(at(bot, ai), { method: 'PUT', body: { prompt: 'Look closer.', summary: 'Looks closer.' } });
  assert.equal(renamed.data.change?.call, true, 'the proposal still waits');
  // The owner's own edit is made at once, as always, and the proposal it overtook goes.
  const owners = await srv.api(at(bot, ai), { method: 'PUT', body: { prompt: 'Look again.' } });
  assert.equal(owners.data.prompt, 'Look again.');
  assert.equal(owners.data.call, false);
  assert.equal(owners.data.change, undefined);
});

test('the owner editing another job of the bot leaves a waiting proposal waiting', async () => {
  const other = await addScript(bot, 'Other');
  const waiting = await addScript(bot, 'Waiting');
  await propose(bot, waiting);
  await srv.api(at(bot, other), { method: 'PUT', body: { name: 'Other renamed' } });
  assert.equal((await jobOf(bot, waiting)).change?.call, true);
});

test('no call is proposed for a job that was never approved, nor for a bot that skips every check', async () => {
  const fresh = (await srv.asChief(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'New', kind: 'script', cron: '0 4 1 1 *', script: 'cat', assessment: 'No AI needed.' } })).data;
  const r = await propose(bot, fresh);
  assert.equal(r.status, 400);
  assert.match(r.data.error, /approved/);
  const wild = await makeBot(srv, { name: 'Wild', permissionMode: 'bypassPermissions' });
  const wildJob = await addScript(wild, 'Ping');
  const refused = await propose(wild, wildJob);
  assert.equal(refused.status, 400);
  assert.match(refused.data.error, /bypassPermissions/);
  assert.equal((await jobOf(wild, wildJob)).change, undefined);
});

test('a bot cannot turn a call on for its own job', async () => {
  const own = await addScript(bot, 'Own');
  const { rec, token } = await heldRun(srv, bot);
  const r = await self(srv, token, 'jobs', { action: 'update', jobId: own.id, call: true });
  srv.release(rec);
  srv.unhold();
  assert.ok(!r.data.job?.change?.call && !r.data.job?.call, JSON.stringify(r.data));
  assert.equal((await jobOf(bot, own)).call, false);
});

let key;
test('the yes saves the key in the Vault as an API token for no bot, and a call with it runs the job', async () => {
  const r = await approve(bot, job);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.call, true);
  const item = (await srv.api('/vault')).data.find((x) => x.name === keyName(bot, job));
  assert.equal(item.type, 'api-token');
  assert.deepEqual(item.allowedBots, []);
  key = vaultSecret(srv, keyName(bot, job));
  assert.ok(key && key.length >= 32);
  const called = await call(bot, job, key, 'motion');
  assert.equal(called.status, 202, JSON.stringify(called.data));
  assert.equal((await srv.finished(called.data.runId)).result, 'motion');
});

test('the Chief reads the call address and where the key is, and never the key or its hash', async () => {
  const info = await srv.asChief(`${at(bot, job)}/call/setup`);
  assert.equal(info.status, 200, JSON.stringify(info.data));
  assert.equal(info.data.call, true);
  // At the front door, naming the account: the address the front door passed the owner's requests on from.
  assert.equal(info.data.address, `${srv.base}/call/${srv.account}/${bot.id}/${job.id}`);
  const called = await call(bot, job, key, 'by its address', info.data.address);
  assert.equal(called.status, 202, JSON.stringify(called.data));
  assert.equal(info.data.vaultItem, keyName(bot, job));
  const hash = crypto.createHash('sha256').update(key).digest('hex');
  const seen = JSON.stringify([info.data, (await srv.asChief(`/bots/${bot.id}`)).data, (await srv.asChief('/bots')).data, (await srv.asChief('/vault')).data, (await srv.api(`/bots/${bot.id}/jobs`)).data]);
  assert.ok(!seen.includes(key) && !seen.includes(hash));
});

test('a new key replaces the one in the Vault at once: the old key answers 401', async () => {
  const r = await srv.asChief(`${at(bot, job)}/call/setup`, { method: 'POST' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.vaultItem, keyName(bot, job));
  assert.ok(!JSON.stringify(r.data).includes(key));
  const fresh = vaultSecret(srv, keyName(bot, job));
  assert.notEqual(fresh, key);
  assert.equal((await srv.api('/vault')).data.filter((x) => x.name === keyName(bot, job)).length, 1, 'the same item');
  assert.equal((await call(bot, job, key)).status, 401);
  assert.equal((await call(bot, job, fresh)).status, 202);
  key = fresh;
});

test('turning a call off is at once, and a call then answers 409', async () => {
  const r = await srv.asChief(`${at(bot, job)}/call/setup`, { method: 'DELETE' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.call, false);
  assert.equal((await jobOf(bot, job)).change, undefined, 'no card');
  const refused = await call(bot, job, key);
  assert.equal(refused.status, 409);
  assert.match(refused.data.error, /turned off/);
  assert.equal((await srv.asChief(`${at(bot, job)}/call/setup`, { method: 'POST' })).status, 409, 'no new key for a job that takes no calls');
});

test('turning a call off takes back a proposal that waits', async () => {
  const waiting = await addScript(bot, 'Taken back');
  await propose(bot, waiting);
  const r = await srv.asChief(`${at(bot, waiting)}/call/setup`, { method: 'DELETE' });
  assert.equal(r.data.waiting, false);
  assert.equal((await jobOf(bot, waiting)).change, undefined);
});

test('a later edit keeps the warning on the card, and a bot switched to bypassPermissions gets no call on a yes', async () => {
  const later = await addScript(bot, 'Later');
  await propose(bot, later);
  const edited = await srv.asChief(at(bot, later), { method: 'PUT', body: { script: 'cat; echo', summary: 'Prints a blank line too.' } });
  assert.ok(edited.data.change.summary.startsWith(WARNING), edited.data.change.summary);
  assert.match(edited.data.change.summary, /Prints a blank line too\./);
  const wild = await makeBot(srv, { name: 'Turned Wild' });
  const j = await addScript(wild, 'Ping');
  await propose(wild, j);
  await srv.api(`/bots/${wild.id}`, { method: 'PUT', body: { ...(await srv.api(`/bots/${wild.id}`)).data, permissionMode: 'bypassPermissions' } });
  const yes = await approve(wild, j);
  assert.equal(yes.status, 409);
  assert.match(yes.data.error, /bypassPermissions/);
  assert.equal((await jobOf(wild, j)).call, false);
  assert.equal(vaultSecret(srv, keyName(wild, j)), null);
});

test('the Chief is told in its chat that the job takes calls now', async () => {
  const told = await addScript(bot, 'Told');
  const chatId = (await srv.api('/chief/chats', { method: 'POST' })).data.id;
  await srv.asChief(at(bot, told), { method: 'PUT', body: { call: true, summary: 'Runs on a call.' }, headers: { 'X-Chief-Chat': chatId } });
  await approve(bot, told);
  const turn = await srv.nextRun((x) => x.args.includes('🧭 Chief of Staff') && /takes calls now/.test(x.stdin), 'the Chief told of the yes');
  assert.match(turn.stdin, /job_call/);
});

test('the Chief\'s instructions say how to explain the sender\'s setup', async () => {
  const chatId = (await srv.api('/chief/chats', { method: 'POST' })).data.id;
  await srv.api(`/chief/chats/${chatId}/messages`, { method: 'POST', body: { text: 'Hello' } });
  const turn = await srv.nextRun((x) => x.args.includes('🧭 Chief of Staff'), 'a Chief turn');
  assert.match(turn.system, /propose_job_call/);
  assert.match(turn.system, /front door/);
  assert.match(turn.system, /\.ts\.net/);
  assert.match(turn.system, /Home Assistant/);
  assert.match(turn.system, /Synology/);
});
