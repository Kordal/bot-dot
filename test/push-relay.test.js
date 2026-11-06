// The push relay (relay/, #964, ADR 150) against a stand-in Apple push service: what it forwards for a request,
// what it refuses, the rate limit per device, and that a token Apple calls gone comes back as 410.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const http2 = require('http2');
const crypto = require('crypto');
const relay = require('../relay/server');
const apnsClient = require('../relay/apns');

const TOKEN = 'ab'.repeat(32);
const SEALED = crypto.randomBytes(200).toString('base64url');

let fake; // the stand-in APNs: what it got, and what it answers next
let apns;
let server;
let base;
const logged = [];

before(async () => {
  fake = { got: [], answers: [] };
  fake.server = http2.createServer();
  fake.server.on('stream', (stream, headers) => {
    const chunks = [];
    stream.on('data', (c) => chunks.push(c));
    stream.on('end', () => {
      fake.got.push({ headers, body: Buffer.concat(chunks).toString('utf8') });
      const [status, reason] = fake.answers.shift() || [200];
      stream.respond({ ':status': status, 'apns-id': crypto.randomUUID() });
      stream.end(reason ? JSON.stringify({ reason }) : undefined);
    });
  });
  await new Promise((r) => fake.server.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${fake.server.address().port}`;
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  fake.publicKey = crypto.createPublicKey(privateKey);
  apns = apnsClient.create({ keyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }), keyId: 'KEY1234567', teamId: 'TEAM123456', topic: 'dev.botdot.ios', origins: { production: origin, development: origin } });
  const log = { log: (m) => logged.push(m), error: (m) => logged.push(m) };
  server = http.createServer(relay.create({ apns, limit: relay.limiter({ burst: 3, everyMs: 60_000 }), log }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => { apns?.close(); server?.close(); fake?.server.close(); });

const post = async (body, token = TOKEN) => {
  const res = await fetch(`${base}/v1/push`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: typeof body === 'string' ? body : JSON.stringify({ token, sealed: SEALED, ...body }) });
  return { status: res.status, data: await res.json().catch(() => null) };
};

test('a push goes to Apple as a generic alert with mutable-content, the seal, the collapse id and the thread, signed with the project key', async () => {
  const r = await post({ environment: 'development', collapseId: 'bot:b1', threadId: 'bot:b1' });
  assert.deepEqual(r, { status: 200, data: { ok: true } });
  const got = fake.got.at(-1);
  assert.equal(got.headers[':path'], `/3/device/${TOKEN}`);
  assert.equal(got.headers['apns-topic'], 'dev.botdot.ios');
  assert.equal(got.headers['apns-push-type'], 'alert');
  assert.equal(got.headers['apns-collapse-id'], 'bot:b1');
  assert.ok(Number(got.headers['apns-expiration']) > Date.now() / 1000 + 3600, 'kept for a day');
  assert.deepEqual(JSON.parse(got.body), { aps: { alert: relay.ALERT, sound: 'default', 'mutable-content': 1, 'thread-id': 'bot:b1' }, sealed: SEALED });
  // The provider token: ES256 over header.claims, with the key's id and the team.
  const [h, c, sig] = got.headers.authorization.replace(/^bearer /, '').split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h, 'base64url')), { alg: 'ES256', kid: 'KEY1234567' });
  assert.equal(JSON.parse(Buffer.from(c, 'base64url')).iss, 'TEAM123456');
  assert.ok(crypto.verify('sha256', Buffer.from(`${h}.${c}`), { key: fake.publicKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(sig, 'base64url')));
  assert.ok(!logged.some((l) => l.includes(SEALED) || l.includes(TOKEN)), 'no payload, no token in the log');
});

test('it refuses what botdot never sends: a bad token, no seal, a long collapse id, a body over 4 KB', async () => {
  const n = fake.got.length;
  const token = 'cd'.repeat(32);
  assert.equal((await post({}, 'not-hex')).status, 400);
  assert.equal((await post({ sealed: 'has spaces' }, token)).status, 400);
  assert.equal((await post({ environment: 'staging' }, token)).status, 400);
  assert.equal((await post({ collapseId: 'x'.repeat(65) }, token)).status, 400);
  assert.equal((await post('{nope')).status, 400);
  assert.equal((await post({ sealed: 'A'.repeat(5000) }, token)).status, 413);
  assert.equal((await fetch(`${base}/v1/push`)).status, 405);
  assert.equal((await fetch(`${base}/health`)).status, 200);
  assert.equal(fake.got.length, n, 'none of them reached Apple');
});

test('a device gets a burst, then 429 until its bucket fills again; another device is not held back', async () => {
  const token = 'ef'.repeat(32);
  for (let i = 0; i < 3; i++) assert.equal((await post({}, token)).status, 200);
  assert.equal((await post({}, token)).status, 429);
  assert.equal((await post({}, '12'.repeat(32))).status, 200);
  let t = 0;
  const lim = relay.limiter({ burst: 2, everyMs: 1000, now: () => t });
  assert.ok(lim.take('a') && lim.take('a') && !lim.take('a'));
  t = 1000;
  assert.ok(lim.take('a') && !lim.take('a'), 'one more a second later');
  const few = relay.limiter({ burst: 1, everyMs: 1000, maxTokens: 2, now: () => t });
  few.take('x'); few.take('y'); few.take('z');
  assert.equal(few.size(), 2, 'never more buckets than maxTokens');
});

test("a token Apple says is gone comes back as 410, Apple's other refusals as 502 or 429", async () => {
  fake.answers.push([410, 'Unregistered']);
  assert.deepEqual(await post({}, '34'.repeat(32)), { status: 410, data: { gone: true } });
  fake.answers.push([400, 'BadDeviceToken']);
  assert.deepEqual(await post({}, '56'.repeat(32)), { status: 410, data: { gone: true } });
  fake.answers.push([400, 'PayloadTooLarge']);
  assert.equal((await post({}, '78'.repeat(32))).status, 502);
  fake.answers.push([429, 'TooManyRequests']);
  assert.equal((await post({}, '9a'.repeat(32))).status, 429);
});

test('the provider token is renewed after 40 minutes and when Apple says it expired', async () => {
  const { privateKey } = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
  let t = 1_000_000;
  const c = apnsClient.create({ keyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }), keyId: 'K', teamId: 'T', topic: 'x', now: () => t });
  const first = c.providerToken();
  t += 39 * 60_000;
  assert.equal(c.providerToken(), first);
  t += 2 * 60_000;
  assert.notEqual(c.providerToken(), first);
  c.close();
});
