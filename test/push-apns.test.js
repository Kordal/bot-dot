// iPhone notifications through the push relay (lib/apns.js, #964, ADR 150): the seal the app's extension opens, the
// request botdot posts to the relay, and a real botdot server that registers a device, sends a bot's reply to a
// stand-in relay, and forgets a device the relay says is gone. Without a relay set there is no route and no feature.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const apns = require('../lib/apns');
const push = require('../lib/push');
const { startServer, makeBot, waitFor } = require('./helpers');

const device = (token = 'a1'.repeat(32)) => ({ token, key: crypto.randomBytes(32).toString('base64'), environment: 'development' });

test('a seal opens with its key only, and says what a Web Push says', () => {
  const d = apns.checkDevice(device());
  const notice = { title: 'News', body: 'Found 3 articles.', target: 'bot:b1', tag: 'bot:b1' };
  const sealed = apns.seal(notice, d.key);
  assert.deepEqual(apns.open(sealed, d.key), notice);
  assert.equal(Buffer.from(sealed, 'base64url')[0], apns.VERSION);
  assert.notEqual(apns.seal(notice, d.key), sealed, 'a fresh nonce each time');
  assert.throws(() => apns.open(sealed, crypto.randomBytes(32).toString('base64url')));
  const tampered = Buffer.from(sealed, 'base64url');
  tampered[20] ^= 1;
  assert.throws(() => apns.open(tampered.toString('base64url'), d.key));
});

test("the relay gets the token, the seal, the tag as collapse id and the target as thread, and nothing it could read", () => {
  const d = apns.checkDevice(device());
  const req = apns.relayRequest(d, { title: 'Mail Sorter asks', body: 'Archive the 40 old ones?', target: 'needs', tag: 'ask:a1', urgency: 'high' });
  assert.deepEqual(Object.keys(req).sort(), ['collapseId', 'environment', 'sealed', 'threadId', 'token']);
  assert.deepEqual([req.token, req.environment, req.collapseId, req.threadId], [d.token, 'development', 'ask:a1', 'needs']);
  assert.ok(!JSON.stringify(req).includes('Archive'));
  const long = `ask:batch:${'x'.repeat(80)}`;
  assert.equal(apns.collapseId(long), apns.collapseId(long), 'the same tag, the same id');
  assert.ok(Buffer.byteLength(apns.collapseId(long)) <= apns.COLLAPSE_MAX);
});

test('a device is checked: a hex token, a 32-byte key, an environment', () => {
  assert.equal(apns.checkDevice({ ...device('AB'.repeat(32)) }).token, 'ab'.repeat(32), 'kept in lower case');
  assert.equal(apns.checkDevice({ token: 'ab'.repeat(32), key: crypto.randomBytes(32).toString('base64url') }).environment, 'production');
  assert.throws(() => apns.checkDevice({ ...device(), token: 'xyz' }), { status: 400 });
  assert.throws(() => apns.checkDevice({ ...device(), key: crypto.randomBytes(16).toString('base64') }), { status: 400 });
  assert.throws(() => apns.checkDevice({ ...device(), environment: 'staging' }), { status: 400 });
  assert.equal(apns.relayAddress('http://relay.test/'), null, 'https only');
  assert.equal(apns.relayAddress('https://push.botdot.dev/'), 'https://push.botdot.dev');
  assert.equal(apns.relayAddress(''), null);
});

test('without a relay set a device is refused, and with one the account keeps at most ten', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-apns-'));
  const off = push.create(dir, { relay: '' });
  assert.equal(off.relayOn(), false);
  assert.throws(() => off.addDevice(device()), { status: 409 });
  const on = push.create(dir, { relay: 'https://push.botdot.dev' });
  for (let i = 0; i < 12; i++) on.addDevice(device(i.toString(16).padStart(2, '0').repeat(32)));
  assert.equal(on.deviceCount(), push.MAX_DEVICES);
  on.addDevice(device('0b'.repeat(32)));
  assert.equal(on.deviceCount(), push.MAX_DEVICES, 'the same token again replaces it');
  assert.equal(on.removeDevice('0B'.repeat(32)), true);
  assert.equal(on.removeDevice('0b'.repeat(32)), false);
});

// ---------- a real botdot server and a stand-in relay ----------

let relay; // the stand-in relay: what it got, and the statuses it answers next
let srv;
let plain; // a botdot without a relay
before(async () => {
  relay = { got: [], answers: [] };
  relay.server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      relay.got.push({ path: req.url, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
      const status = relay.answers.shift() || 200;
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(status === 410 ? { gone: true } : { ok: true }));
    });
  });
  await new Promise((r) => relay.server.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${relay.server.address().port}`;
  [srv, plain] = await Promise.all([startServer({ env: { BOT_DOT_PUSH_HTTP: '1', BOT_DOT_PUSH_RELAY: url } }), startServer()]);
});
after(async () => { await Promise.all([srv?.stop(), plain?.stop()]); relay?.server.close(); });

test('the route is announced only with a relay set, and is the owner’s alone', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('apns-push'));
  assert.ok(!(await plain.api('/version')).data.features.includes('apns-push'));
  assert.equal((await plain.api('/push/apns', { method: 'POST', body: device() })).status, 409);
  assert.equal((await srv.asChief('/push/apns', { method: 'POST', body: device() })).status, 403);
  assert.equal((await srv.api('/push/apns', { method: 'POST', body: { ...device(), key: 'short' } })).status, 400);
  assert.ok(!fs.existsSync(path.join(srv.data, 'push.json')), 'nothing refused was kept');
});

test("a bot's reply reaches the iPhone sealed through the relay, and a device the relay says is gone is forgotten", async () => {
  const d = device('c3'.repeat(32));
  const ok = await srv.api('/push/apns', { method: 'POST', body: { ...d, device: 'iPhone' } });
  assert.deepEqual([ok.status, ok.data], [200, { ok: true }]);
  const bot = await makeBot(srv, { name: 'News' });
  srv.reply('Found **3** articles.');
  const run = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Anything new?' } });
  await srv.finished(run.data.runId || run.data.id);
  const got = await waitFor(() => relay.got.find((g) => g.body.token === d.token), { what: 'the relay request' });
  assert.equal(got.path, '/v1/push');
  assert.deepEqual([got.body.collapseId, got.body.threadId, got.body.environment], [`bot:${bot.id}`, `bot:${bot.id}`, 'development']);
  assert.deepEqual(apns.open(got.body.sealed, d.key), { title: 'News', body: 'Found 3 articles.', target: `bot:${bot.id}`, tag: `bot:${bot.id}` });
  // The relay says Apple dropped the token: botdot forgets the device and sends it nothing more.
  relay.answers.push(410);
  const count = relay.got.length;
  const gone = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Once more' } });
  await srv.finished(gone.data.runId || gone.data.id);
  const stored = () => JSON.parse(fs.readFileSync(path.join(srv.data, 'push.json'), 'utf8')).apns;
  await waitFor(() => stored().length === 0, { what: 'the device to go' });
  const again = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Still there?' } });
  await srv.finished(again.data.runId || again.data.id);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(relay.got.length, count + 1);
  // Turned off in the app: the device goes.
  await srv.api('/push/apns', { method: 'POST', body: d });
  assert.deepEqual((await srv.api('/push/apns', { method: 'DELETE', body: { token: d.token } })).data, { ok: true, removed: true });
  assert.equal(stored().length, 0);
});
