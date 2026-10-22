// Notifications on this device (lib/push.js, issue #87): what of the feed becomes a push, with the phone's rules; the
// account's keys and the browsers' subscriptions; and a real botdot server that sends a bot's reply to a stand-in
// push service, which a browser's keys read back, and drops a subscription its push service says is gone.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const push = require('../lib/push');
const { startServer, makeBot, waitFor } = require('./helpers');

// A browser's side of a subscription: its keys, and how it reads a push.
function browser(endpoint) {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const auth = crypto.randomBytes(16);
  const sub = { endpoint, keys: { p256dh: ecdh.getPublicKey('base64url'), auth: auth.toString('base64url') } };
  const read = (message) => {
    const asPublic = message.subarray(21, 21 + message[20]);
    const body = message.subarray(21 + message[20]);
    const salt = message.subarray(0, 16);
    const hkdf = (key, ikm, info, n) => Buffer.from(crypto.hkdfSync('sha256', ikm, key, info, n));
    const ikm = hkdf(auth, ecdh.computeSecret(asPublic), Buffer.concat([Buffer.from('WebPush: info\0'), ecdh.getPublicKey(), asPublic]), 32);
    const d = crypto.createDecipheriv('aes-128-gcm', hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16), hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12));
    d.setAuthTag(body.subarray(body.length - 16));
    const out = Buffer.concat([d.update(body.subarray(0, body.length - 16)), d.final()]);
    return JSON.parse(out.subarray(0, out.length - 1).toString());
  };
  return { sub, read };
}

const ev = (type, data, extra = {}) => ({ type, data, ...extra });
const take = (f, e) => f.take(e).notices;

// ---------- what makes a notification ----------

test("a reply notifies when the server says it is new, in the bot's or the Chief's words, and opens its chat", () => {
  const f = push.follower({ rung: new Set(), chiefName: () => 'Ada' });
  assert.deepEqual(take(f, ev('run_finished', { botId: 'b1', botName: 'News', status: 'success', result: '## Today\nFound **3** articles.' })), [], 'not new: read already, quiet or held');
  assert.deepEqual(take(f, ev('run_finished', { botId: 'b1', botName: 'News', status: 'success', result: '## Today\nFound **3** articles.', new: true })),
    [{ title: 'News', body: 'Today\nFound 3 articles.', target: 'bot:b1', tag: 'bot:b1', urgency: undefined }]);
  const [failed] = take(f, ev('run_finished', { botId: 'b1', botName: 'News', status: 'error', jobName: 'Morning paper', problem: 'The site did not answer.', new: true }));
  assert.equal(failed.body, 'Morning paper\nThe site did not answer.');
  const [asks] = take(f, ev('run_finished', { botId: 'b2', botName: 'Mail Sorter', status: 'success', result: 'A long reply…', asks: true, title: 'Mail Sorter asks', question: 'Archive the 40 old ones?', new: true }));
  assert.deepEqual([asks.title, asks.body, asks.target], ['Mail Sorter asks', 'Archive the 40 old ones?', 'bot:b2']);
  assert.deepEqual(take(f, ev('chief_reply', { chatId: 'c1', title: 'Trip', status: 'success', text: 'Booked.', new: true })).map((n) => [n.title, n.body, n.target]), [['Ada', 'Booked.', 'chief:c1']]);
  assert.deepEqual(take(f, ev('chief_reply', { chatId: 'c1', status: 'error', text: 'Half', error: 'Claude was signed out.', from: { id: 'b1', name: 'News' }, new: true })).map((n) => [n.title, n.body]), [['News', 'Claude was signed out.']]);
  assert.deepEqual(take(f, ev('chief_reply', { chatId: 'c1', status: 'success', text: 'Read here.' })), []);
  assert.equal(take(f, ev('run_finished', { botId: 'b1', botName: 'News', status: 'success', result: 'x'.repeat(900), new: true }))[0].body.length, push.BODY_MAX);
  assert.deepEqual(take(f, ev('run_finished', { botId: '../x', botName: 'News', status: 'success', result: 'r', new: true })), [], 'a target is only what the page opens');
});

test('in a group only a question rings, and it opens the group', () => {
  const f = push.follower({ rung: new Set() });
  assert.deepEqual(take(f, ev('group_run_finished', { groupId: 'g1', botName: 'Coder', status: 'success', result: 'Done.', notify: false, new: true })), []);
  assert.deepEqual(take(f, ev('group_run_finished', { groupId: 'g1', botName: 'Coder', status: 'success', result: 'r', asks: true, title: 'Coder asks', question: 'Ship it?', notify: true })).map((n) => [n.title, n.body, n.target]),
    [['Coder asks', 'Ship it?', 'group:g1']]);
});

test('what needs the owner rings once, not while the web page is in use, and again only after it was answered and came back', () => {
  const rung = new Set();
  const f = push.follower({ rung, chiefName: () => 'Ada' });
  const job = { botId: 'b1', botName: 'News', jobId: 'j1', jobName: 'Digest', text: 'Wants to run “Digest” every morning' };
  const tile = { tileId: 't1', title: 'Weather', botId: null, botName: null, text: 'Waiting for your OK: “Weather” on your Board (a script)', yesOn: 'card' };
  const one = take(f, ev('approvals', { jobs: [job], tiles: [], memoryChanges: [] }));
  assert.deepEqual(one, [{ title: 'News', body: job.text, target: 'needs', tag: 'job:b1/j1', urgency: 'high' }]);
  assert.deepEqual(take(f, ev('approvals', { jobs: [job], tiles: [tile], memoryChanges: [] })).map((n) => [n.title, n.tag]), [['Ada', 'tile:t1']], 'the job rang already; the tile is the Chief’s');
  assert.deepEqual(take(f, ev('approvals', { jobs: [], tiles: [tile], memoryChanges: [] })), []);
  assert.ok(!rung.has('job:b1/j1'), 'answered: forgotten');
  assert.equal(take(f, ev('approvals', { jobs: [job], tiles: [tile], memoryChanges: [] })).length, 1, 'it came back');
  // While the web page is in use it shows there: no push, and it doesn't ring later either.
  const memory = { id: 'm1', botId: 'b1', botName: 'News', title: 'Keep a note: likes tea', text: 'likes tea', groupId: 'g1', groupName: 'Home' };
  assert.deepEqual(take(f, ev('approvals', { jobs: [job], tiles: [tile], memoryChanges: [memory] }, { webActive: true })), []);
  assert.deepEqual(take(f, ev('approvals', { jobs: [job], tiles: [tile], memoryChanges: [memory] })), []);
  // A card asked in a group names the group and opens it.
  const ask = { id: 'a1', kind: 'tool', botName: 'Coder', text: 'Asks to install gh', groupId: 'g1', groupName: 'Dev' };
  assert.deepEqual(take(f, ev('asks', { waiting: 1, list: [ask] })).map((n) => [n.title, n.body, n.target]), [['Coder in Dev', 'Asks to install gh', 'group:g1']]);
  assert.deepEqual(take(f, ev('asks', { botId: 'b1', asks: { text: 'Which one?' } })), [], "a bot's open question: its run notifies");
  assert.ok(rung.has('ask:a1'), 'that left the asks as they were');
  assert.deepEqual(take(f, ev('login_request', { id: 'l1', kind: 'card', botName: 'Shopper', site: 'shop.example', amount: '€12' })).map((n) => [n.title, n.body]), [['Shopper', 'Wants to pay on shop.example (€12)']]);
  assert.deepEqual(take(f, ev('login_request', { id: 'l1', kind: 'card', botName: 'Shopper', site: 'shop.example' })), []);
  take(f, ev('login_request_closed', { id: 'l1' }));
  assert.equal(take(f, ev('login_request', { id: 'l1', kind: 'login', botName: 'Shopper', site: 'shop.example' }))[0].body, 'Asks for the shop.example login');
});

test('what one run waits on rings once, as its card of several, also when an ask joins it or one is answered on its own', () => {
  const rung = new Set();
  const f = push.follower({ rung });
  const batch = { id: 'run-r1', title: 'Scout wants 2 things for “Find a flat”', count: 2 };
  const a1 = { id: 'a1', kind: 'permission', botName: 'Scout', text: 'Asks to browse the web', batch };
  const a2 = { id: 'a2', kind: 'connector-action', botName: 'Scout', text: 'Wants to send email with Gmail', batch };
  assert.deepEqual(take(f, ev('asks', { waiting: 2, list: [a1, a2] })).map((n) => [n.title, n.body, n.tag]), [['Scout', batch.title, 'ask:batch:run-r1']]);
  const a3 = { ...a2, id: 'a3', batch: { ...batch, count: 3 } };
  assert.deepEqual(take(f, ev('asks', { waiting: 3, list: [a1, a2, a3] })), [], 'an ask that joins the card rings nothing');
  assert.deepEqual(take(f, ev('asks', { waiting: 2, list: [a2, a3] })), [], 'nor does the first answered on its own');
  take(f, ev('asks', { waiting: 0, list: [] }));
  assert.equal(rung.size, 0, 'all answered: it may ring again');
});

test("a bot's plan rings unless its chat is on screen, and Claude's sign-out once per sign-out, also while the web page is in use", () => {
  const shown = new Set(['chief:c2']);
  const f = push.follower({ rung: new Set(), onScreen: (c) => shown.has(c) });
  assert.deepEqual(take(f, ev('chief_suggestion', { chatId: 'c1', title: 'A digest', from: { id: 'b1', name: 'News' } })).map((n) => [n.title, n.body, n.target]), [['News', 'A plan for the Chief: A digest', 'chief:c1']]);
  assert.deepEqual(take(f, ev('chief_suggestion', { chatId: 'c1', title: 'A digest', from: { id: 'b1', name: 'News' } })), []);
  assert.deepEqual(take(f, ev('chief_suggestion', { chatId: 'c2', title: 'Seen', from: { id: 'b1', name: 'News' } })), []);
  const out = ev('claude', { loggedIn: false }, { webActive: true });
  assert.deepEqual(take(f, out).map((n) => [n.body, n.target]), [["Claude is signed out: bots can't work.", 'app']]);
  assert.deepEqual(take(f, out), []);
  assert.deepEqual(take(f, ev('claude', { loggedIn: true })), []);
  assert.equal(take(f, out).length, 1, 'the next sign-out rings again');
});

// ---------- the keys and the subscriptions ----------

test('the keys are made once and kept privately, a subscription is checked, kept per endpoint and dropped on 404 or 410', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-push-'));
  const answers = [];
  const sent = [];
  const fetchImpl = async (url, opts) => { sent.push({ url, opts }); return new Response(null, { status: answers.shift() ?? 201 }); };
  const quiet = { log() {}, error() {} };
  const p = push.create(dir, { fetchImpl, log: quiet });
  assert.equal(fs.existsSync(path.join(dir, 'push.json')), false, 'nothing is made before a browser asks');
  const key = p.publicKey();
  assert.equal(Buffer.from(key, 'base64url').length, 65);
  assert.equal(fs.statSync(path.join(dir, 'push.json')).mode & 0o777, 0o600, 'it holds the private key');
  assert.equal(push.create(dir, { fetchImpl }).publicKey(), key, 'kept');
  for (const bad of [{}, { endpoint: 'http://push.example/x', keys: browser('x').sub.keys }, { endpoint: 'https://push.example/x', keys: { p256dh: 'AAAA', auth: 'AAAA' } }]) {
    assert.throws(() => p.add(bad), (e) => e.status === 400, JSON.stringify(bad));
  }
  const a = browser('https://push.example/a');
  const c = browser('https://push.example/c');
  p.add(a.sub, { subject: 'https://botdot.example', device: 'iPhone, Home Screen' });
  p.add(a.sub, { subject: 'https://botdot.example' });
  p.add(c.sub, { subject: 'javascript:alert(1)' });
  assert.equal(p.count(), 2, 'the same endpoint again replaces it');
  const results = await p.notify({ title: 'News', body: 'Found 3.', target: 'bot:b1', tag: 'bot:b1' });
  assert.deepEqual(results.map((r) => r.status), [201, 201]);
  assert.deepEqual(a.read(sent[0].opts.body), { title: 'News', body: 'Found 3.', target: 'bot:b1', tag: 'bot:b1' });
  const claims = (s) => JSON.parse(Buffer.from(s.opts.headers.Authorization.match(/t=[\w-]+\.([\w-]+)/)[1], 'base64url'));
  assert.equal(claims(sent[0]).sub, 'https://botdot.example');
  assert.equal(claims(sent[1]).sub, 'mailto:botdot@localhost', 'a subject that is no https address is not sent');
  answers.push(410, 404);
  await p.notify({ title: 'x', body: 'y', target: 'needs' });
  assert.equal(p.count(), 0, 'both push services said the subscription is gone');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'push.json'), 'utf8')).subscriptions, []);
  p.add(a.sub);
  answers.push(500);
  await p.notify({ title: 'x', body: 'y', target: 'needs' });
  assert.equal(p.count(), 1, 'a failure for now keeps it');
  assert.equal(p.remove(a.sub.endpoint), true);
  assert.equal(p.remove(a.sub.endpoint), false);
});

// ---------- a real botdot server ----------

let srv;
let service; // the stand-in push service: what it was sent, and what it answers next
before(async () => {
  service = { got: [], answers: [] };
  service.server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      service.got.push({ path: req.url, headers: req.headers, body: Buffer.concat(chunks) });
      res.writeHead(service.answers.shift() ?? 201);
      res.end();
    });
  });
  await new Promise((r) => service.server.listen(0, '127.0.0.1', r));
  service.url = `http://127.0.0.1:${service.server.address().port}`;
  srv = await startServer({ env: { BOT_DOT_PUSH_HTTP: '1' } });
});
after(async () => { await srv?.stop(); service?.server.close(); });

test('the routes are the owner’s alone, and the server says it has them', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('web-push'));
  const key = await srv.api('/push/key');
  assert.equal(key.status, 200);
  assert.equal(Buffer.from(key.data.publicKey, 'base64url').length, 65);
  assert.equal((await srv.api('/push/key')).data.publicKey, key.data.publicKey, 'made on first use, then kept');
  const b = browser(`${service.url}/sub/chief`);
  // The Chief's tools, with its key, and anything that did not come through the front door, are refused.
  assert.equal((await srv.asChief('/push/key')).status, 403);
  assert.equal((await srv.asChief('/push/subscriptions', { method: 'POST', body: b.sub })).status, 403);
  assert.equal((await srv.asChief('/push/subscriptions', { method: 'DELETE', body: { endpoint: b.sub.endpoint } })).status, 403);
  const direct = await fetch(`http://127.0.0.1:${srv.botdotPort}/api/push/subscriptions`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bot-Dot': '1' }, body: JSON.stringify(b.sub) });
  assert.equal(direct.status, 403);
  assert.equal((await srv.api('/push/subscriptions', { method: 'POST', body: { endpoint: 'not an address' } })).status, 400);
  assert.equal((await srv.api('/push/subscriptions', { method: 'POST', body: { ...b.sub, keys: { p256dh: 'AA', auth: 'AA' } } })).status, 400);
  const stored = () => JSON.parse(fs.readFileSync(path.join(srv.data, 'push.json'), 'utf8')).subscriptions;
  assert.deepEqual(stored(), [], 'nothing refused was kept');
});

test("a bot's reply reaches the browser that subscribed, opens its chat, and a 410 drops that subscription", async () => {
  const b = browser(`${service.url}/sub/one`);
  const ok = await srv.api('/push/subscriptions', { method: 'POST', body: { ...b.sub, device: 'Mac, Firefox' } });
  assert.deepEqual([ok.status, ok.data], [200, { ok: true }]);
  const bot = await makeBot(srv, { name: 'News' });
  srv.reply('Found **3** articles.');
  const run = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Anything new?' } });
  await srv.finished(run.data.runId || run.data.id);
  const got = await waitFor(() => service.got.find((g) => g.path === '/sub/one'), { what: 'the push' });
  assert.equal(got.headers['content-encoding'], 'aes128gcm');
  assert.match(got.headers.authorization, /^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
  assert.deepEqual(b.read(got.body), { title: 'News', body: 'Found 3 articles.', target: `bot:${bot.id}`, tag: `bot:${bot.id}` });
  // A chat on screen in an app is read as the reply lands: no push.
  const count = service.got.length;
  await srv.api('/read', { method: 'POST', body: { app: 'web-test', chat: `bot:${bot.id}` } });
  const seen = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'And now?' } });
  await srv.finished(seen.data.runId || seen.data.id);
  await srv.api('/read', { method: 'POST', body: { app: 'web-test', chat: null } });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(service.got.length, count, 'read at once, nothing sent');
  // The push service says the subscription is gone: botdot drops it, and sends it nothing more.
  service.answers.push(410);
  const gone = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Once more' } });
  await srv.finished(gone.data.runId || gone.data.id);
  await waitFor(() => service.got.length === count + 1, { what: 'the push that is answered 410' });
  const stored = () => JSON.parse(fs.readFileSync(path.join(srv.data, 'push.json'), 'utf8')).subscriptions;
  await waitFor(() => stored().length === 0, { what: 'the subscription to go' });
  const again = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Still there?' } });
  await srv.finished(again.data.runId || again.data.id);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(service.got.length, count + 1);
  // Turned off on the page: the subscription goes.
  await srv.api('/push/subscriptions', { method: 'POST', body: b.sub });
  assert.equal(stored().length, 1);
  assert.deepEqual((await srv.api('/push/subscriptions', { method: 'DELETE', body: { endpoint: b.sub.endpoint } })).data, { ok: true, removed: true });
  assert.equal(stored().length, 0);
});
