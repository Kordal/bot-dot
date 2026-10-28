// A signed call (#37, section 2; docs/api.md "A signed call"): a job lets a sender in on an HMAC-SHA256 signature of
// the body under the job's secret instead of a key, in botdot's form (X-Botdot-Timestamp, X-Botdot-Signature-256 over
// "<timestamp>.<body>", five minutes either way) or GitHub's (X-Hub-Signature-256 over the body). Each signature is
// taken once. Set up as a call is: proposed by the Chief or by the bot on its own job, turned on by the owner's yes,
// which makes the secret in the Vault for no bot. lib/calls.js on its own, then a real server behind the tests'
// stand-in front door, which passes a call as the real one does.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const calls = require('../lib/calls');
const { startServer, makeBot, self, vaultSecret } = require('./helpers');
const { kit, isRunOf } = require('./carry-on-helpers');
const { rpcClient } = require('./memory-helpers');
const { call } = require('./call-helpers');

// What a sender writes, as docs/api.md says it.
const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');
const botdotSigned = (secret, body, t = Math.floor(Date.now() / 1000)) => ({ 'X-Botdot-Timestamp': String(t), 'X-Botdot-Signature-256': `sha256=${hmac(secret, `${t}.${body}`)}` });
const githubSigned = (secret, body) => ({ 'X-Hub-Signature-256': `sha256=${hmac(secret, body)}` });

test('checkSigned: both forms pass with the secret, and say why not otherwise', () => {
  const body = Buffer.from('{"action":"opened"}');
  const now = 1_800_000_000_000;
  const t = now / 1000;
  const lower = (h) => Object.fromEntries(Object.entries(h).map(([k, v]) => [k.toLowerCase(), v]));
  const ok = calls.checkSigned(lower(botdotSigned('s3cret', body, t)), body, 's3cret', now);
  assert.deepEqual(ok, { ok: true, signature: hmac('s3cret', `${t}.${body}`) });
  assert.equal(calls.checkSigned(lower(githubSigned('s3cret', body)), body, 's3cret', now).ok, true);
  const why = (headers, secret = 's3cret', at = now) => calls.checkSigned(lower(headers), body, secret, at).why;
  assert.equal(why({}), 'no signature');
  assert.equal(why({ Authorization: 'Bearer x' }), 'no signature');
  assert.equal(why({ 'X-Botdot-Signature-256': botdotSigned('s3cret', body, t)['X-Botdot-Signature-256'] }), 'no signature', 'no timestamp');
  assert.equal(why(botdotSigned('other', body, t)), 'wrong signature');
  assert.equal(why(githubSigned('other', body)), 'wrong signature');
  assert.equal(why({ 'X-Hub-Signature-256': 'sha1=abc' }), 'wrong signature');
  assert.equal(why(githubSigned('s3cret', body), null), 'wrong signature', 'a job without a secret lets nothing in');
  assert.equal(why({ ...botdotSigned('s3cret', body, t), 'X-Botdot-Timestamp': String(t + 1) }), 'wrong signature', 'the timestamp is signed');
  assert.equal(why(botdotSigned('s3cret', body, t - 301)), 'too old');
  assert.equal(why(botdotSigned('s3cret', body, t + 301)), 'too old');
  assert.equal(calls.checkSigned(lower(botdotSigned('s3cret', body, t - 299)), body, 's3cret', now).ok, true);
  assert.equal(calls.checkSigned(lower(githubSigned('s3cret', body)), body, 's3cret', now + 30 * 24 * 3600e3).ok, true, "GitHub's form has no time");
});

test('seenStore: a signature is taken once a day, per job, and one given back may come again', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-seen-'));
  try {
    const seen = calls.seenStore(dir);
    const now = 1_800_000_000_000;
    assert.equal(seen.take('b', 'j', 'aa', now), true);
    assert.equal(seen.take('b', 'j', 'aa', now + 1000), false);
    assert.equal(seen.take('b', 'other', 'aa', now), true, "another job's");
    seen.giveBack('b', 'j', 'aa');
    assert.equal(seen.take('b', 'j', 'aa', now + 2000), true);
    assert.equal(seen.take('b', 'j', 'aa', now + calls.SEEN_FOR_MS + 3000), true, 'after a day it is forgotten');
    assert.doesNotMatch(fs.readFileSync(path.join(dir, 'call-signatures.json'), 'utf8'), /body|key/);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the card of a signed call says the secret lets a sender in', () => {
  assert.match(calls.cardWords({ name: 'Gate', allowedTools: [] }, undefined, 'signed'), /^Anything that can reach this machine and has the job's secret can run this job now and send it text, signing what it sends with the secret\. Gate has no tools/);
  assert.match(calls.cardWords({ name: 'Gate', allowedTools: [] }), /^Anything that can reach this machine and has the key/);
});

test("web: a job's settings say it takes signed calls, beside the notify line; any other job says nothing", () => {
  const vm = require('vm');
  const { cut, esc, words } = require('./web-page');
  const ctx = vm.createContext({ ...words, esc });
  vm.runInContext(`${cut('const jobCallModeLine = ', 'function jobCardHTML(j, open = false) {')}\nthis.jobCallModeLine = jobCallModeLine;`, ctx);
  assert.equal(ctx.jobCallModeLine({ call: true, callMode: 'signed' }), '<div class="faint job-call-mode">Takes signed calls: each one is signed with the secret in the Vault, and runs once.</div>');
  assert.equal(ctx.jobCallModeLine({ call: true }), '');
  assert.equal(ctx.jobCallModeLine({ call: false, callMode: 'signed' }), '');
});

// ---------- on a real server ----------

let srv, carriedOn, lastRun;
before(async () => { srv = await startServer(); ({ carriedOn, lastRun } = kit(srv)); });
after(async () => { srv.unhold(); await srv.stop(); });

const at = (b, j) => `/bots/${b.id}/jobs/${j.id}`;
const approve = (b, j, yes = true) => srv.api(`${at(b, j)}/approve`, { method: 'POST', body: { approve: yes } });
const jobOf = async (b, j) => (await srv.api(`/bots/${b.id}/jobs`)).data.find((x) => x.id === j.id);
const secretName = (b, j) => `Call secret: ${b.name} / ${j.name}`;
const keyName = (b, j) => `Call key: ${b.name} / ${j.name}`;
const addScript = async (b, name, script = 'printf "got: "; cat') => (await srv.api(`/bots/${b.id}/jobs`, { method: 'POST', body: { name, kind: 'script', cron: '0 4 1 1 *', script } })).data;
const setup = async (b, j) => (await srv.asChief(`${at(b, j)}/call/setup`)).data;
const proposeSigned = (b, j, mode = 'signed') => srv.asChief(at(b, j), { method: 'PUT', body: { call: true, callMode: mode, summary: 'Runs when GitHub says a pull request opened.' } });
const signedCall = (b, j, headers, body) => call(srv, b, j, null, { body, headers: { 'Content-Type': 'application/json', ...headers } });

test("the Chief proposes a signed call: the card says the secret lets a sender in, and the owner's yes makes the secret for no bot", async () => {
  const bot = await makeBot(srv, { name: 'Repo Watch', allowedTools: ['Bash'] });
  const job = await addScript(bot, 'Opened');
  const p = await proposeSigned(bot, job);
  assert.equal(p.status, 200, JSON.stringify(p.data));
  const waiting = await jobOf(bot, job);
  assert.deepEqual([waiting.call, waiting.callMode, waiting.change.call, waiting.change.callMode], [false, undefined, true, 'signed']);
  assert.ok(waiting.change.summary.startsWith(`${calls.WARNING_SIGNED} Repo Watch can run commands. Runs when`), waiting.change.summary);
  assert.equal(vaultSecret(srv, secretName(bot, job)), null, 'no secret before the yes');
  assert.deepEqual([(await setup(bot, job)).waiting, (await setup(bot, job)).waitingMode], [true, 'signed']);

  const yes = await approve(bot, job);
  assert.equal(yes.status, 200, JSON.stringify(yes.data));
  assert.deepEqual([yes.data.call, yes.data.callMode], [true, 'signed']);
  const item = (await srv.api('/vault')).data.find((x) => x.name === secretName(bot, job));
  assert.deepEqual([item.type, item.allowedBots], ['api-token', []]);
  assert.equal(vaultSecret(srv, keyName(bot, job)), null, 'no key: a signed call has none');
  const secret = vaultSecret(srv, secretName(bot, job));
  const info = await setup(bot, job);
  assert.deepEqual([info.call, info.mode, info.waiting, info.vaultItem], [true, 'signed', false, secretName(bot, job)]);
  assert.ok(!JSON.stringify(info).includes(secret), 'never the secret');
  assert.ok(!fs.readFileSync(path.join(srv.data, 'call-secrets.json'), 'utf8').includes(secret), 'kept encrypted');
  assert.ok(!JSON.stringify((await srv.api(`/bots/${bot.id}/jobs`)).data).includes(secret));

  // GitHub's form and botdot's run the job with the body on its stdin.
  const body = '{"action":"opened","number":7}';
  const gh = await signedCall(bot, job, githubSigned(secret, body), body);
  assert.equal(gh.status, 202, JSON.stringify(gh.data));
  assert.equal((await srv.finished(gh.data.runId)).result.trim(), `got: ${body}`);
  const ours = await signedCall(bot, job, botdotSigned(secret, 'two'), 'two');
  assert.equal(ours.status, 202, JSON.stringify(ours.data));
  await srv.finished(ours.data.runId);
});

test('a signed job refuses a key, a wrong or old signature (401, kept as refusals), a request played again (409) and a large body', async () => {
  const bot = await makeBot(srv, { name: 'Hook Watch' });
  const job = await addScript(bot, 'Hook');
  await proposeSigned(bot, job);
  await approve(bot, job);
  const secret = vaultSecret(srv, secretName(bot, job));
  const runsBefore = (await srv.api(`/runs?botId=${bot.id}`)).data.length;
  const r = {
    key: await call(srv, bot, job, secret, { body: 'x' }),
    none: await signedCall(bot, job, {}, 'x'),
    wrong: await signedCall(bot, job, githubSigned('not it', 'x'), 'x'),
    old: await signedCall(bot, job, botdotSigned(secret, 'x', Math.floor(Date.now() / 1000) - 600), 'x'),
    large: await signedCall(bot, job, githubSigned(secret, 'y'.repeat(calls.BODY_MAX + 1)), 'y'.repeat(calls.BODY_MAX + 1)),
  };
  assert.deepEqual(Object.fromEntries(Object.entries(r).map(([k, v]) => [k, v.status])), { key: 401, none: 401, wrong: 401, old: 401, large: 413 });
  assert.match(r.none.data.error, /X-Hub-Signature-256/);
  assert.equal(r.wrong.data.error, 'Wrong signature.');
  assert.match(r.old.data.error, /5 minutes/);
  const headers = botdotSigned(secret, 'once');
  const first = await signedCall(bot, job, headers, 'once');
  assert.equal(first.status, 202, JSON.stringify(first.data));
  await srv.finished(first.data.runId);
  const again = await signedCall(bot, job, headers, 'once');
  assert.equal(again.status, 409);
  assert.match(again.data.error, /taken already/);
  assert.equal((await srv.api(`/runs?botId=${bot.id}`)).data.length, runsBefore + 1, 'only the one call ran');
  const refused = (await srv.asChief(`${at(bot, job)}/call/setup`)).data.refused.map((c) => c.why);
  assert.deepEqual(refused, ['repeated', 'too large', 'too old', 'wrong signature', 'no signature', 'no signature']);
});

test('a refused signed call gives its signature back: sent again once the job is switched on, it runs', async () => {
  const bot = await makeBot(srv, { name: 'Late Watch' });
  const job = await addScript(bot, 'Late');
  await proposeSigned(bot, job);
  await approve(bot, job);
  const secret = vaultSecret(srv, secretName(bot, job));
  await srv.api(at(bot, job), { method: 'PUT', body: { enabled: false } });
  const headers = githubSigned(secret, 'later');
  assert.equal((await signedCall(bot, job, headers, 'later')).status, 409);
  await srv.api(at(bot, job), { method: 'PUT', body: { enabled: true } });
  const r = await signedCall(bot, job, headers, 'later');
  assert.equal(r.status, 202, JSON.stringify(r.data));
  await srv.finished(r.data.runId);
});

test('a new secret stops the old one at once; switching to a key waits for the yes, which makes the key; off is at once', async () => {
  const bot = await makeBot(srv, { name: 'Turn Watch' });
  const job = await addScript(bot, 'Turn');
  await proposeSigned(bot, job);
  await approve(bot, job);
  const old = vaultSecret(srv, secretName(bot, job));
  const rotated = await srv.asChief(`${at(bot, job)}/call/setup`, { method: 'POST' });
  assert.equal(rotated.status, 200, JSON.stringify(rotated.data));
  const secret = vaultSecret(srv, secretName(bot, job));
  assert.notEqual(secret, old);
  assert.equal((await signedCall(bot, job, githubSigned(old, 'a'), 'a')).status, 401);
  const ok = await signedCall(bot, job, githubSigned(secret, 'b'), 'b');
  assert.equal(ok.status, 202);
  await srv.finished(ok.data.runId);

  // Back to a key: a card, and the signed call holds until the yes.
  const back = await proposeSigned(bot, job, 'bearer');
  assert.equal(back.status, 200, JSON.stringify(back.data));
  assert.ok((await jobOf(bot, job)).change.summary.startsWith(calls.WARNING), 'the key warning');
  const still = await signedCall(bot, job, githubSigned(secret, 'c'), 'c');
  assert.equal(still.status, 202, 'still signed until the yes');
  await srv.finished(still.data.runId);
  await approve(bot, job);
  const j = await jobOf(bot, job);
  assert.deepEqual([j.call, j.callMode], [true, undefined]);
  const key = vaultSecret(srv, keyName(bot, job));
  assert.equal((await signedCall(bot, job, githubSigned(secret, 'd'), 'd')).status, 401, 'the signature no longer lets in');
  const keyed = await call(srv, bot, job, key, { body: 'e' });
  assert.equal(keyed.status, 202);
  await srv.finished(keyed.data.runId);

  // Signed again, then off: refused, as calls off.
  await proposeSigned(bot, job);
  await approve(bot, job);
  const fresh = vaultSecret(srv, secretName(bot, job));
  assert.notEqual(fresh, secret, 'the yes makes a new secret');
  const off = await srv.asChief(`${at(bot, job)}/call/setup`, { method: 'DELETE' });
  assert.deepEqual([off.data.call, off.data.mode], [false, null]);
  assert.equal((await jobOf(bot, job)).callMode, undefined);
  assert.equal((await signedCall(bot, job, githubSigned(fresh, 'f'), 'f')).status, 401, 'a job whose calls are off is let in on nothing');
});

test('no signed call for a bot that skips every check, and an unknown mode is refused', async () => {
  const wild = await makeBot(srv, { name: 'Wild Hook', permissionMode: 'bypassPermissions' });
  const job = await addScript(wild, 'Ping');
  const r = await proposeSigned(wild, job);
  assert.equal(r.status, 400);
  assert.match(r.data.error, /bypassPermissions/);
  const bot = await makeBot(srv, { name: 'Odd Hook' });
  const odd = await addScript(bot, 'Odd');
  const bad = await proposeSigned(bot, odd, 'hmac');
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /callMode/);
});

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

test("a bot proposes a signed call on its own job; the yes tells it the address and where the secret is, never the secret; it turns it off and never rotates", async (t) => {
  const bot = await makeBot(srv, { name: 'Pull Watch', emoji: '🔀' });
  const job = await addScript(bot, 'Pulls');
  const asked = await inRun(bot, 'Let GitHub start Pulls', async (token, env) => {
    const mcp = rpcClient(t, 'self-mcp.js', env);
    const tool = (await mcp.request('tools/list')).tools.find((x) => x.name === 'propose_job_call');
    return {
      schema: tool.inputSchema.properties.mode,
      bad: await self(srv, token, 'jobs', { action: 'propose-call', jobId: job.id, mode: 'hmac', summary: 'x' }),
      proposed: await mcp.text('propose_job_call', { jobId: job.id, mode: 'signed', summary: 'Runs when a pull request opens.' }),
    };
  }, 'I asked for it.');
  assert.deepEqual(asked.did.schema.enum, ['bearer', 'signed']);
  assert.deepEqual([asked.did.bad.data.ok, /mode/.test(asked.did.bad.data.error)], [false, true]);
  assert.match(asked.did.proposed, /Proposed signed calls to job "Pulls"/);
  const waiting = await jobOf(bot, job);
  assert.deepEqual([waiting.change.by, waiting.change.callMode], ['bot', 'signed']);
  assert.ok(waiting.change.summary.startsWith(calls.WARNING_SIGNED));

  srv.reply('Tell GitHub the address.');
  const yes = await approve(bot, job);
  assert.equal(yes.status, 200, JSON.stringify(yes.data));
  const secret = vaultSecret(srv, secretName(bot, job));
  await carriedOn(bot, asked.run);
  const rec = await lastRun(bot);
  const address = `${srv.base}/call/${srv.account}/${bot.id}/${job.id}`;
  assert.ok(rec.stdin.includes(`The owner allowed you to: let the script “Pulls” take signed calls: its call address is ${address}, and its secret is in the Vault item “${secretName(bot, job)}”, which no bot is given.`), rec.stdin);
  assert.ok(!rec.stdin.includes(secret), 'never the secret');

  const { did } = await inRun(bot, 'Stop the GitHub calls', async (token) => ({
    rotate: await self(srv, token, 'jobs', { action: 'new-call-key', jobId: job.id }),
    info: await self(srv, token, 'jobs', { action: 'call', jobId: job.id }),
    off: await self(srv, token, 'jobs', { action: 'call-off', jobId: job.id }),
  }));
  assert.equal(did.rotate.status, 400, 'no new secret from a bot');
  assert.equal(vaultSecret(srv, secretName(bot, job)), secret);
  assert.deepEqual([did.info.data.call.mode, did.info.data.call.vaultItem], ['signed', secretName(bot, job)]);
  assert.ok(!JSON.stringify(did.info.data).includes(secret));
  assert.deepEqual([did.off.data.call.call, did.off.data.call.mode], [false, null]);
  assert.equal((await signedCall(bot, job, githubSigned(secret, 'x'), 'x')).status, 401);
});
