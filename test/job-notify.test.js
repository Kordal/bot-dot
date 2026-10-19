// A job tells an address when its run ends (#37, section 1; docs/api.md "Telling an address when a run ends"): the
// address only through a card the owner approves, the secret made by that yes and kept in the Vault for no bot, each
// run's end POSTed signed (HMAC-SHA256 over "<timestamp>.<body>"), never to a private address, a few tries, failures
// kept for the Chief and its checkup. lib/notify.js on its own, and a real server whose receiver is on 127.0.0.1
// (BOT_DOT_NOTIFY_LOCAL=1, the tests' only way past the public-address rule).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const crypto = require('crypto');
const notify = require('../lib/notify');
const { facts } = require('../lib/checkup');
const { startServer, makeBot, self, vaultSecret, waitFor, sleep } = require('./helpers');
const { kit, isRunOf } = require('./carry-on-helpers');

// A receiver on 127.0.0.1: what it was sent, and what it answers (`answer(req)`: a status, 0 for no answer).
async function receiver(answer = () => 200) {
  const got = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      got.push({ headers: req.headers, body, path: req.url });
      const status = answer(req, got.length);
      if (!status) return; // never answers
      if (status >= 300 && status < 400) res.setHeader('Location', 'http://127.0.0.1:1/elsewhere');
      res.writeHead(status).end('ok');
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${server.address().port}/hook`;
  return { got, url, close: () => { server.closeAllConnections(); server.close(); } };
}
// How a receiver checks a request, as docs/api.md says it.
const verifies = (secret, { headers, body }) => {
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(`${headers['x-botdot-timestamp']}.${body}`).digest('hex')}`;
  const given = String(headers['x-botdot-signature-256'] || '');
  return given.length === expected.length && crypto.timingSafeEqual(Buffer.from(given), Buffer.from(expected));
};
const noWait = { sleep: async () => {}, local: true };

test('a notify address is https and public: no http, no name or password in it, no private or local host', () => {
  assert.equal(notify.checkUrl('https://hooks.example.com/botdot?x=1'), 'https://hooks.example.com/botdot?x=1');
  assert.equal(notify.checkUrl('https://203.0.113.9/hook'), 'https://203.0.113.9/hook');
  for (const [url, why] of [
    ['http://hooks.example.com/', /https/], ['ftp://hooks.example.com/', /https/], ['not an address', /isn't an address/],
    ['https://user:pw@hooks.example.com/', /name or password/], ['https://localhost/x', /local or private/],
    ['https://10.1.2.3/x', /local or private/], ['https://192.168.1.5/x', /local or private/], ['https://169.254.169.254/latest', /local or private/],
    ['https://[::1]/x', /local or private/], ['https://nas/x', /local or private/], ['https://nas.local/x', /local or private/],
    ['https://box.home.arpa/x', /local or private/], ['http://127.0.0.1:9/x', /https/],
  ]) assert.throws(() => notify.checkUrl(url), why, url);
  assert.equal(notify.checkUrl('http://127.0.0.1:9/x', { local: true }), 'http://127.0.0.1:9/x', "the tests' receiver");
  assert.throws(() => notify.checkUrl('http://10.0.0.1/x', { local: true }), /https/);
});

test('deliver: one signed POST that the documented recipe verifies, with the same delivery id on each try', async () => {
  const r = await receiver((_req, n) => (n < 3 ? 503 : 200));
  try {
    const payload = notify.payloadOf({ bot: { id: 'b1', name: 'Gate' }, job: { id: 'j1', name: 'Open' }, runId: 'r1', status: 'success', text: 'Opened.' });
    const out = await notify.deliver({ url: r.url, secret: 's3cret', payload }, noWait);
    assert.deepEqual([out.ok, out.tries], [true, 3]);
    assert.equal(r.got.length, 3);
    for (const g of r.got) {
      assert.ok(verifies('s3cret', g), 'the signature checks out');
      assert.ok(!verifies('other', g));
      assert.equal(g.headers['content-type'], 'application/json');
      assert.match(g.headers['x-botdot-timestamp'], /^\d{10}$/);
    }
    assert.equal(new Set(r.got.map((g) => g.headers['x-botdot-delivery'])).size, 1);
    const body = JSON.parse(r.got[0].body);
    assert.deepEqual({ ...body, at: undefined }, { event: 'run.ended', bot: { id: 'b1', name: 'Gate' }, job: { id: 'j1', name: 'Open' }, runId: 'r1', status: 'success', text: 'Opened.', at: undefined });
    assert.equal(notify.sign('s3cret', r.got[0].headers['x-botdot-timestamp'], r.got[0].body), r.got[0].headers['x-botdot-signature-256']);
  } finally { r.close(); }
});

test('deliver: two retries with a wait between, none after a 4xx or a redirect, which is not followed', async () => {
  const waits = [];
  const down = await receiver(() => 500);
  const refusing = await receiver(() => 403);
  const moving = await receiver(() => 302);
  try {
    const a = await notify.deliver({ url: down.url, secret: 's', payload: {} }, { local: true, sleep: async (ms) => { waits.push(ms); } });
    assert.deepEqual([a.ok, a.tries, down.got.length], [false, 3, 3]);
    assert.deepEqual(waits, notify.BACKOFF_MS);
    assert.match(a.why, /answered 500/);
    const b = await notify.deliver({ url: refusing.url, secret: 's', payload: {} }, noWait);
    assert.deepEqual([b.ok, b.tries, refusing.got.length], [false, 1, 1]);
    const c = await notify.deliver({ url: moving.url, secret: 's', payload: {} }, noWait);
    assert.deepEqual([c.ok, c.tries, moving.got.length], [false, 1, 1]);
    assert.match(c.why, /redirect/);
  } finally { down.close(); refusing.close(); moving.close(); }
});

test('deliver: a receiver that does not answer is given up on after the short timeout, three times', async () => {
  const silent = await receiver(() => 0);
  try {
    const started = Date.now();
    const out = await notify.deliver({ url: silent.url, secret: 's', payload: {} }, { ...noWait, timeoutMs: 150 });
    assert.deepEqual([out.ok, out.tries], [false, 3]);
    assert.match(out.why, /did not answer/);
    assert.ok(Date.now() - started < 3000);
  } finally { silent.close(); }
});

test('deliver: a host whose name points to a private address is not sent to, checked after DNS', async () => {
  let asked = 0;
  const lookup = async (host) => { asked++; return host === 'mixed.example.com' ? [{ address: '203.0.113.5', family: 4 }, { address: '10.0.0.7', family: 4 }] : [{ address: '169.254.169.254', family: 4 }]; };
  for (const url of ['https://meta.example.com/x', 'https://mixed.example.com/x']) {
    const out = await notify.deliver({ url, secret: 's', payload: {} }, { lookup, sleep: async () => {} });
    assert.deepEqual([out.ok, out.tries], [false, 1], url);
    assert.match(out.why, /private or local address/);
  }
  assert.equal(asked, 2);
  // Without the tests' switch even 127.0.0.1 is private.
  const r = await receiver();
  try {
    const out = await notify.deliver({ url: r.url, secret: 's', payload: {} }, { sleep: async () => {} });
    assert.equal(out.ok, false);
    assert.equal(r.got.length, 0);
  } finally { r.close(); }
});

test("the checkup's digest says when a job's notify address could not be told", () => {
  const text = facts({ timeZone: 'UTC', bots: [{ name: 'Gate', description: 'Watches the gate.', jobs: [{ name: 'Open', kind: 'script', when: 'When called', enabled: true, last: '', runs: 2, quiet: 0, failed: 0, wrongKeys: [], notifyFailed: [{ at: '2026-10-18T09:00:00.000Z', why: 'The receiver answered 500. Tried 3 times.' }] }] }] });
  assert.match(text, /Its notify address could not be told once, the last at 2026-10-18 09:00: The receiver answered 500\. Tried 3 times\./);
});

test("web: a job's settings show its notify address, read-only; a job without one shows nothing", () => {
  const vm = require('vm');
  const { cut, esc } = require('./web-page');
  const ctx = vm.createContext({ esc });
  vm.runInContext(`${cut('const jobNotifyLine = ', 'function jobCardHTML(j, open = false) {')}\nthis.jobNotifyLine = jobNotifyLine;`, ctx);
  assert.equal(ctx.jobNotifyLine({ name: 'x' }), '');
  assert.equal(ctx.jobNotifyLine({ notifyUrl: 'https://hooks.example.com/a?b=<c>' }), '<div class="faint job-notify">Tells <span class="mono">https://hooks.example.com/a?b=&lt;c&gt;</span> when a run ends, signed with the secret in the Vault.</div>');
});

// ---------- on a real server ----------

let srv;
before(async () => { srv = await startServer({ env: { BOT_DOT_NOTIFY_LOCAL: '1' } }); });
after(async () => { srv.unhold?.(); await srv.stop(); });

const at = (b, j) => `/bots/${b.id}/jobs/${j.id}`;
const jobOf = async (b, j) => (await srv.api(`/bots/${b.id}/jobs`)).data.find((x) => x.id === j.id);
const secretName = (b, j) => `Notify secret: ${b.name} / ${j.name}`;
const addScript = async (b, name, script = 'echo "the gate opened"') => (await srv.api(`/bots/${b.id}/jobs`, { method: 'POST', body: { name, kind: 'script', cron: '0 4 1 1 *', script } })).data;
const runNow = (b, j) => srv.api(`${at(b, j)}/run`, { method: 'POST' });
const setup = async (b, j) => (await srv.asChief(`${at(b, j)}/notify/setup`)).data;

test("the Chief proposes a notify address: it waits on a card that says where replies go; the owner's yes makes the secret for no bot, and each run's end is sent signed", async () => {
  const r = await receiver();
  try {
    const bot = await makeBot(srv, { name: 'Gate Watch' });
    const job = await addScript(bot, 'Gate');
    const proposed = await srv.asChief(at(bot, job), { method: 'PUT', body: { notifyUrl: r.url, summary: 'Tells Home Assistant when the gate opened.' } });
    assert.equal(proposed.status, 200, JSON.stringify(proposed.data));
    assert.equal(proposed.data.notifyUrl, undefined, 'not on yet');
    assert.equal(proposed.data.change.notifyUrl, r.url);
    assert.equal(proposed.data.change.summary, `${notify.cardWords(r.url)} Tells Home Assistant when the gate opened.`);
    assert.deepEqual([(await setup(bot, job)).notifyUrl, (await setup(bot, job)).notifyWaiting], [null, r.url]);
    await runNow(bot, job);
    await sleep(300);
    assert.equal(r.got.length, 0, 'nothing is sent before the yes');
    assert.equal(vaultSecret(srv, secretName(bot, job)), null);

    const yes = await srv.api(`${at(bot, job)}/approve`, { method: 'POST', body: { approve: true } });
    assert.equal(yes.status, 200, JSON.stringify(yes.data));
    assert.equal(yes.data.notifyUrl, r.url);
    const item = (await srv.api('/vault')).data.find((x) => x.name === secretName(bot, job));
    assert.deepEqual([item.type, item.allowedBots], ['api-token', []]);
    const secret = vaultSecret(srv, secretName(bot, job));
    const info = await setup(bot, job);
    assert.deepEqual([info.notifyUrl, info.notifyWaiting, info.notifySecretItem, info.notifyFailed], [r.url, null, secretName(bot, job), []]);
    assert.ok(!JSON.stringify(info).includes(secret), 'never the secret');

    const ran = await runNow(bot, job);
    await waitFor(() => r.got.length === 1, { what: 'the notification' });
    assert.ok(verifies(secret, r.got[0]));
    const body = JSON.parse(r.got[0].body);
    assert.deepEqual([body.event, body.bot, body.job, body.status, body.text.trim()], ['run.ended', { id: bot.id, name: 'Gate Watch' }, { id: job.id, name: 'Gate' }, 'success', 'the gate opened']);
    assert.equal(body.runId, ran.data.scriptRun || body.runId);
    assert.ok(body.runId);
  } finally { r.close(); }
});

test('nobody turns a notify address on alone: the owner\'s own edit waits for the card too; never on a job not approved, never a private one', async () => {
  const bot = await makeBot(srv, { name: 'Shed Watch' });
  const job = await addScript(bot, 'Shed');
  const own = await srv.api(at(bot, job), { method: 'PUT', body: { notifyUrl: 'https://hooks.example.com/shed', summary: 'Mine.' } });
  assert.equal(own.status, 200, JSON.stringify(own.data));
  assert.equal(own.data.notifyUrl, undefined);
  assert.equal(own.data.change.notifyUrl, 'https://hooks.example.com/shed');
  const fresh = (await srv.asChief(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'New', kind: 'ai', cron: '0 4 1 1 *', prompt: 'x', assessment: 'Needs AI.', notifyUrl: 'https://hooks.example.com/new' } }));
  assert.match(fresh.data.error, /approved/);
  for (const url of ['https://10.0.0.8/hook', 'http://hooks.example.com/x', 'https://router.lan/x']) {
    const refused = await srv.asChief(at(bot, job), { method: 'PUT', body: { notifyUrl: url, summary: 'x' } });
    assert.equal(refused.status, 400, url);
  }
});

test('turning it off is at once, takes back a proposal that waits, and sends nothing more; the Chief makes a new secret', async () => {
  const r = await receiver();
  try {
    const bot = await makeBot(srv, { name: 'Porch Watch' });
    const on = await addScript(bot, 'On');
    const waits = await addScript(bot, 'Waits');
    await srv.asChief(at(bot, on), { method: 'PUT', body: { notifyUrl: r.url, summary: 'x' } });
    await srv.api(`${at(bot, on)}/approve`, { method: 'POST', body: { approve: true } });
    await srv.asChief(at(bot, waits), { method: 'PUT', body: { notifyUrl: r.url, summary: 'y' } });
    const first = vaultSecret(srv, secretName(bot, on));
    const rotated = (await srv.asChief(`${at(bot, on)}/notify/setup`, { method: 'POST' })).data;
    assert.equal(rotated.notifySecretItem, secretName(bot, on));
    const second = vaultSecret(srv, secretName(bot, on));
    assert.notEqual(second, first);
    await runNow(bot, on);
    await waitFor(() => r.got.length === 1, { what: 'the notification' });
    assert.ok(verifies(second, r.got[0]) && !verifies(first, r.got[0]), 'signed with the new secret');

    const off = (await srv.asChief(`${at(bot, on)}/notify/setup`, { method: 'DELETE' })).data;
    assert.deepEqual([off.notifyUrl, off.notifyWaiting], [null, null]);
    assert.equal((await jobOf(bot, on)).notifyUrl, undefined);
    const back = (await srv.asChief(`${at(bot, waits)}/notify/setup`, { method: 'DELETE' })).data;
    assert.equal(back.notifyWaiting, null);
    assert.equal((await jobOf(bot, waits)).change, undefined, 'the proposal is taken back');
    await runNow(bot, on);
    await sleep(500);
    assert.equal(r.got.length, 1, 'nothing more is sent');
    assert.equal((await srv.asChief(`${at(bot, on)}/notify/setup`, { method: 'POST' })).status, 409);
  } finally { r.close(); }
});

test('a notification that fails never holds up the run, and is kept for the Chief', async () => {
  const r = await receiver(() => 400);
  try {
    const bot = await makeBot(srv, { name: 'Barn Watch' });
    const job = await addScript(bot, 'Barn');
    await srv.asChief(at(bot, job), { method: 'PUT', body: { notifyUrl: r.url, summary: 'x' } });
    await srv.api(`${at(bot, job)}/approve`, { method: 'POST', body: { approve: true } });
    await runNow(bot, job);
    const failed = await waitFor(async () => (await setup(bot, job)).notifyFailed[0], { what: 'the failure' });
    assert.match(failed.why, /The receiver answered 400\./);
    assert.ok(failed.runId);
    assert.equal((await jobOf(bot, job)).last.status, 'success', 'the run itself ended well');
  } finally { r.close(); }
});

test('a bot proposes a notify address only through propose_job_notify, on its own job; the yes tells it where the secret is, never the secret', async () => {
  const { carriedOn, lastRun } = kit(srv);
  const bot = await makeBot(srv, { name: 'Coop Watch' });
  const job = await addScript(bot, 'Coop');
  const url = 'https://hooks.example.com/coop';
  srv.hold();
  const started = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Tell my server when Coop runs' } });
  const rec = await srv.nextRun((x) => x.self?.env && isRunOf(bot)(x) && x.stdin.includes('Tell my server'), 'the run');
  let did;
  try {
    const token = rec.self.env.RUN_TOKEN;
    did = {
      sneaky: await self(srv, token, 'jobs', { action: 'update', id: job.id, notifyUrl: url, name: 'Coop' }),
      bare: await self(srv, token, 'jobs', { action: 'propose-notify', jobId: job.id, summary: 'x' }),
      proposed: await self(srv, token, 'jobs', { action: 'propose-notify', jobId: job.id, notifyUrl: url, summary: 'Tells my server.' }),
    };
  } finally { srv.reply('I asked.'); srv.release(rec); }
  const run = await srv.finished(started.data.id);
  srv.unhold();
  assert.match(did.bare.data.error, /notifyUrl/);
  assert.equal(did.proposed.data.needsApproval, true);
  const waiting = await jobOf(bot, job);
  assert.deepEqual([waiting.notifyUrl, waiting.change.notifyUrl, waiting.change.by], [undefined, url, 'bot']);
  assert.ok(waiting.change.summary.startsWith(notify.cardWords(url)));

  srv.reply('Done.');
  await srv.api(`${at(bot, job)}/approve`, { method: 'POST', body: { approve: true } });
  await carriedOn(bot, run);
  const told = await lastRun(bot);
  const secret = vaultSecret(srv, secretName(bot, job));
  assert.ok(told.stdin.includes(`The owner allowed you to: tell ${url} when a run of the script “Coop” ends, signed with the secret in the Vault item “${secretName(bot, job)}”, which no bot is given.`), told.stdin);
  assert.ok(!told.stdin.includes(secret));
});
