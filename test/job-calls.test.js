// A job runs when called (ADR 026): a device or service sends POST to the job's call address at the front door
// (/call/<account>/<bot>/<job>, ADR 028) with the job's key, and its script runs now with the request's body on
// stdin. Raw requests through the tests' stand-in front door, which passes a call as the real one does
// (lib/front-door/calls.js); the front door's own part, routing and the limit on wrong keys, is front-door.test.js's.
// A call is turned on as the owner does it: the Chief proposes it, the owner says yes, and the key is read from the
// Vault (job-call-setup.test.js).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');
const { startServer, makeBot, waitFor, sleep, vaultSecret } = require('./helpers');
const calls = require('../lib/calls');

const keys = {}; // job id -> its key
const DEVICE = '100.101.102.103'; // the device that calls, behind Caddy or Tailscale Serve
let srv;
let bot;
let job; // a script job that prints what it was sent
let untouched; // a script job that must never start: every refusal is sent to it

const hashOf = (key) => crypto.createHash('sha256').update(key).digest('hex');
async function turnOn(srv, b, j, headers = {}) {
  const at = `/bots/${b.id}/jobs/${j.id}`;
  const proposed = await srv.asChief(at, { method: 'PUT', body: { call: true, summary: 'Runs on a call.' } });
  assert.equal(proposed.data.change?.call, true, JSON.stringify(proposed.data));
  const yes = await srv.api(`${at}/approve`, { method: 'POST', body: { approve: true }, headers });
  assert.equal(yes.data.call, true, JSON.stringify(yes.data));
  keys[j.id] = vaultSecret(srv, `Call key: ${b.name} / ${j.name}`);
  return keys[j.id];
}

// A raw request, so that X-Forwarded-For can be set. key: sent as Authorization: Bearer <key>. at: another path than
// the job's call address. port: the front door's (the stand-in's), or botdot's own. chunked: without Content-Length.
const call = (to, { key = keys[to.job.id], headers = {}, body = '', at = null, port = srv.port, chunked = false } = {}) => new Promise((resolve, reject) => {
  const req = http.request({
    host: '127.0.0.1', port, method: 'POST', path: at || `/call/${srv.account}/${to.bot.id}/${to.job.id}`,
    headers: { 'X-Forwarded-For': DEVICE, 'Content-Type': 'text/plain', ...(key ? { Authorization: `Bearer ${key}` } : {}), ...headers },
  }, (res) => {
    let text = '';
    res.on('data', (c) => (text += c));
    res.on('end', () => { let data = text; try { data = JSON.parse(text); } catch { /* text */ } resolve({ status: res.statusCode, data }); });
  });
  req.on('error', reject);
  if (chunked) req.write(body);
  req.end(chunked ? undefined : body);
});
const runsOf = async (j) => (await srv.api(`/runs?botId=${bot.id}`)).data.filter((r) => r.jobId === j.id);

before(async () => {
  srv = await startServer();
  bot = await makeBot(srv, { name: 'Garage Watch' });
  const add = async (name, script) => (await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name, kind: 'script', cron: '0 4 1 1 *', script } })).data;
  job = await add('Motion', 'printf "got: "; cat');
  untouched = await add('Never', 'echo started');
  await turnOn(srv, bot, job);
  await turnOn(srv, bot, untouched);
});
after(() => srv.stop());

test('the right key runs the script now, with the body on its stdin', async () => {
  const r = await call({ bot, job }, { body: '{"camera":"garage"}', headers: { 'Content-Type': 'application/json' } });
  assert.equal(r.status, 202, JSON.stringify(r.data));
  assert.match(r.data.runId, /\S/);
  const run = await srv.finished(r.data.runId);
  assert.equal(run.trigger, 'call');
  assert.equal(run.jobId, job.id);
  assert.equal(run.result.trim(), 'got: {"camera":"garage"}');
  // A script's log has `t` on every event too, as a run of Claude's (#204).
  assert.deepEqual(run.events.map((e) => [e.type, Number.isInteger(e.t) && e.t >= 0]), [['run_start', true], ['script_output', true], ['run_end', true]]);
});

test('a call from anywhere, with or without a Tailscale login, is let in on the key alone', async () => {
  for (const [what, headers] of [['the internet', { 'X-Forwarded-For': '203.0.113.9' }], ['a LAN', { 'X-Forwarded-For': '192.168.1.20' }], ['a login', { 'Tailscale-User-Login': 'someone@else.com' }]]) {
    const r = await call({ bot, job }, { body: what, headers });
    assert.equal(r.status, 202, `${what}: ${JSON.stringify(r.data)}`);
    assert.match((await srv.finished(r.data.runId)).result, new RegExp(`got: ${what}`));
  }
});

test('a missing or wrong key, or a key in the address, answers 401', async () => {
  const to = { bot, job: untouched };
  const none = await call(to, { key: null });
  assert.equal(none.status, 401);
  assert.match(none.data.error, /key/);
  const wrong = await call(to, { key: `${keys[untouched.id]}x` });
  assert.equal(wrong.status, 401);
  assert.equal((await call(to, { key: 'short' })).status, 401);
  const inAddress = await call(to, { key: null, at: `/call/${srv.account}/${bot.id}/${untouched.id}?key=${keys[untouched.id]}` });
  assert.equal(inAddress.status, 401);
  // A job with no call turned on, and one that does not exist, have no key that fits.
  const other = (await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Off', kind: 'script', cron: '0 4 1 1 *', script: 'echo x' } })).data;
  assert.equal((await call({ bot, job: other })).status, 401);
  assert.equal((await call({ bot, job: { id: 'jnope00' } })).status, 401);
  // Nor does the job's address in another account.
  assert.equal((await call(to, { at: `/call/someone-else/${bot.id}/${untouched.id}` })).status, 401);
});

test('on botdot\'s own port a call answers 403, whoever sends it: a bot, the Chief or anything else there', async () => {
  const to = { bot, job: untouched };
  const at = `/api/bots/${bot.id}/jobs/${untouched.id}/call`;
  for (const [who, headers] of [['anything', {}], ['the Chief', { 'X-Chief-Key': srv.chiefKey }], ['a bot', { 'X-Run-Token': 'any' }]]) {
    const r = await call(to, { port: srv.botdotPort, at, headers });
    assert.equal(r.status, 403, `${who}: ${JSON.stringify(r.data)}`);
    assert.match(r.data.error, /front door/, who);
  }
});

test('a body over the limit answers 413', async () => {
  const r = await call({ bot, job: untouched }, { body: 'x'.repeat(calls.BODY_MAX + 1) });
  assert.equal(r.status, 413);
  assert.match(r.data.error, /\S/);
  assert.equal((await call({ bot, job: untouched }, { body: 'x'.repeat(calls.BODY_MAX + 1), chunked: true })).status, 413);
});

test('a badly encoded address is no call address', async () => {
  const r = await call({ bot, job: untouched }, { at: `/call/${srv.account}/%zz/${untouched.id}` });
  assert.notEqual(r.status, 202);
  assert.equal((await call({ bot, job: untouched }, { port: srv.botdotPort, at: `/api/bots/%zz/jobs/${untouched.id}/call` })).status, 403);
});

test('only POST', async () => {
  const r = await new Promise((resolve) => http.request({ host: '127.0.0.1', port: srv.port, path: `/call/${srv.account}/${bot.id}/${untouched.id}`, headers: { 'X-Forwarded-For': DEVICE, Authorization: `Bearer ${keys[untouched.id]}` } }, (res) => { res.resume(); resolve(res.statusCode); }).end());
  assert.equal(r, 405);
});

test('no refusal started a run', async () => {
  await sleep(500);
  assert.deepEqual(await runsOf(untouched), []);
});

test('no route hands out the key or its hash', async () => {
  const hash = hashOf(keys[job.id]);
  const seen = JSON.stringify([
    (await srv.api('/bots')).data, (await srv.api(`/bots/${bot.id}`)).data, (await srv.api(`/bots/${bot.id}/jobs`)).data,
    (await srv.asChief(`/bots/${bot.id}`)).data, (await srv.asChief('/bots')).data, (await srv.api('/runs')).data,
  ]);
  assert.ok(!seen.includes(hash) && !seen.includes(keys[job.id]));
});

test('the owner\'s other routes keep their checks', async () => {
  // The owner's routes come through the front door alone (ADR 028), and the call path opens nothing else.
  const r = await new Promise((resolve) => http.request({ host: '127.0.0.1', port: srv.botdotPort, path: `/api/bots/${bot.id}/jobs/${untouched.id}/run`, method: 'POST', headers: { 'X-Forwarded-For': DEVICE, 'X-Bot-Dot': '1', Authorization: `Bearer ${keys[untouched.id]}` } }, (res) => { res.resume(); resolve(res.statusCode); }).end());
  assert.equal(r, 403);
});

test('version lists job-calls', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('job-calls'));
});

test('the call address is the front door\'s own, as it names itself, kept across a restart', () => {
  const dir = require('fs').mkdtempSync(require('path').join(require('os').tmpdir(), 'calls-'));
  const a = calls.addresses(dir, 'ann');
  assert.equal(a.of('b1', 'j1'), null, 'before the front door passed anything on');
  a.seen({ host: 'evil.example/x', 'x-forwarded-proto': 'https' });
  a.seen({ host: 'botdot.example.com', 'x-forwarded-proto': 'ftp' });
  a.seen({ host: 'botdot.example.com' });
  assert.equal(a.of('b1', 'j1'), null, 'nothing but a name and http or https');
  a.seen({ host: 'Botdot.Example.com', 'x-forwarded-proto': 'https' });
  assert.equal(a.of('b1', 'j1'), 'https://botdot.example.com/call/ann/b1/j1');
  assert.equal(a.host(), 'botdot.example.com');
  assert.equal(calls.addresses(dir, 'ann').of('b1', 'j1'), 'https://botdot.example.com/call/ann/b1/j1');
  assert.equal(calls.addresses(dir, '').of('b1', 'j1'), null, 'an account with no name has no call address');
});
