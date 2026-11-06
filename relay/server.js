// The push relay (#964, ADR 150): a botdot server posts a notification sealed for one iPhone, and the relay forwards
// it to Apple's push service with the project's APNs key, which self-hosted servers don't have.
//
// POST /v1/push { token, environment, sealed, collapseId, threadId }
//   200 { ok: true }    Apple took it
//   400                 something in the request is not what botdot sends
//   410 { gone: true }  Apple says the token is no longer the app's: botdot forgets the device
//   413                 the request, or the push it makes, is over 4 KB
//   429                 that token got too many pushes lately (a bucket per token)
//   502                 Apple didn't take it for another reason
// GET /health → 200 "ok"
//
// It keeps no accounts and nothing of a push: a token is held only as the hash its rate bucket is filed under, for
// as long as the bucket isn't full again. The log says the status and Apple's reason, never a payload or a token.
// What a push shows before the app's Notification Service Extension opens the seal is the generic ALERT.
const http = require('http');
const crypto = require('crypto');

const BODY_MAX = 4096; // bytes, the request; the push made from it must fit Apple's 4096 too
const TOKEN = /^[0-9a-f]{64,200}$/;
const SEALED = /^[A-Za-z0-9_-]{40,3600}$/;
const COLLAPSE = /^[\x21-\x7e]{1,64}$/;
const THREAD = /^[\w:.-]{1,100}$/;
const ENVIRONMENTS = new Set(['production', 'development']);
const ALERT = { title: 'botdot', body: 'New notification' };
const TTL_SECONDS = 24 * 3600; // as the Web Push of a botdot: a push not delivered in a day is dropped
const GONE = new Set(['BadDeviceToken', 'Unregistered', 'DeviceTokenNotForTopic']);

// A bucket per token: `burst` pushes at once, then one every `everyMs`. At most `maxTokens` buckets; past that the
// fullest go first (a full bucket is the same as none).
function limiter({ burst = 30, everyMs = 10_000, maxTokens = 100_000, now = Date.now } = {}) {
  const buckets = new Map();
  const level = (b, t) => Math.min(burst, b.left + (t - b.at) / everyMs);
  function prune(t) {
    for (const [k, b] of buckets) if (level(b, t) >= burst) buckets.delete(k);
    while (buckets.size >= maxTokens) buckets.delete(buckets.keys().next().value);
  }
  return {
    take(token) {
      const t = now();
      const k = crypto.createHash('sha256').update(token).digest('base64url');
      const b = buckets.get(k);
      const left = b ? level(b, t) : burst;
      if (left < 1) return false;
      if (!b && buckets.size >= maxTokens) prune(t);
      buckets.delete(k); // re-inserted last: the oldest stays first for prune
      buckets.set(k, { left: left - 1, at: t });
      return true;
    },
    size: () => buckets.size,
  };
}

const json = (res, status, body) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(body)); };

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      // Too big: the rest is read and dropped while the answer goes out on a connection that then closes.
      if (size > BODY_MAX) { req.removeAllListeners('data'); req.resume(); reject(Object.assign(new Error('Over 4 KB.'), { status: 413 })); return; }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

// What a request asks for, checked: { token, environment, sealed, collapseId, threadId }, or an error with status.
function check(body) {
  let d;
  try { d = JSON.parse(body.toString('utf8')); } catch { d = null; }
  const bad = (what) => Object.assign(new Error(what), { status: 400 });
  if (!d || typeof d !== 'object') throw bad('The body is JSON.');
  if (!TOKEN.test(String(d.token))) throw bad('token is an APNs device token in hex.');
  if (!ENVIRONMENTS.has(d.environment ?? 'production')) throw bad('environment is "production" or "development".');
  if (!SEALED.test(String(d.sealed))) throw bad('sealed is base64url.');
  if (d.collapseId != null && !COLLAPSE.test(String(d.collapseId))) throw bad('collapseId is at most 64 characters.');
  if (d.threadId != null && !THREAD.test(String(d.threadId))) throw bad('threadId is at most 100 characters.');
  return { token: d.token, environment: d.environment ?? 'production', sealed: d.sealed, collapseId: d.collapseId ?? null, threadId: d.threadId ?? null };
}

// The push Apple gets: a generic alert the extension replaces, and the seal it opens.
function apnsPayload({ sealed, threadId }) {
  const aps = { alert: ALERT, sound: 'default', 'mutable-content': 1 };
  if (threadId) aps['thread-id'] = threadId;
  return JSON.stringify({ aps, sealed });
}

// apns: relay/apns.js (or a stand-in): send({ token, environment, payload, collapseId, expiresAt }) → { status, reason }.
function create({ apns, limit = limiter(), now = Date.now, log = console } = {}) {
  return async function handle(req, res) {
    const url = new URL(req.url, 'http://relay');
    if (req.method === 'GET' && url.pathname === '/health') { res.writeHead(200, { 'Content-Type': 'text/plain' }); res.end('ok'); return; }
    if (url.pathname !== '/v1/push') return json(res, 404, { error: 'Not found.' });
    if (req.method !== 'POST') return json(res, 405, { error: 'POST only.' });
    let push;
    try {
      push = check(await readBody(req));
    } catch (e) {
      if (e.status === 413) res.setHeader('Connection', 'close');
      return json(res, e.status || 400, { error: e.message });
    }
    const payload = apnsPayload(push);
    if (Buffer.byteLength(payload) > BODY_MAX) return json(res, 413, { error: 'The push would be over 4 KB.' });
    if (!limit.take(push.token)) return json(res, 429, { error: 'Too many pushes for this device; try later.' });
    let r;
    try {
      r = await apns.send({ token: push.token, environment: push.environment, payload, collapseId: push.collapseId, expiresAt: Math.floor(now() / 1000) + TTL_SECONDS });
    } catch (e) {
      log.error(`[relay] APNs: ${e.message}`);
      return json(res, 502, { error: 'Apple did not answer.' });
    }
    if (r.status === 200) return json(res, 200, { ok: true });
    log.error(`[relay] APNs ${r.status}${r.reason ? ` ${r.reason}` : ''}`);
    if (r.status === 410 || GONE.has(r.reason)) return json(res, 410, { gone: true });
    if (r.status === 429) return json(res, 429, { error: 'Apple says too many pushes for this device.' });
    return json(res, 502, { error: `Apple answered ${r.status}${r.reason ? ` (${r.reason})` : ''}.` });
  };
}

// Started as a program: the APNs key and its ids from the environment (relay/README.md).
function main() {
  const fs = require('fs');
  const env = process.env;
  const keyPem = env.APNS_KEY || (env.APNS_KEY_FILE ? fs.readFileSync(env.APNS_KEY_FILE, 'utf8') : '');
  const missing = [['APNS_KEY_FILE or APNS_KEY', keyPem], ['APNS_KEY_ID', env.APNS_KEY_ID], ['APNS_TEAM_ID', env.APNS_TEAM_ID]].filter(([, v]) => !v).map(([n]) => n);
  if (missing.length) { console.error(`The relay needs ${missing.join(', ')} (relay/README.md).`); process.exit(1); }
  const origins = env.APNS_ORIGIN ? { production: env.APNS_ORIGIN, development: env.APNS_ORIGIN } : undefined;
  const apns = require('./apns').create({ keyPem, keyId: env.APNS_KEY_ID, teamId: env.APNS_TEAM_ID, topic: env.APNS_TOPIC || 'dev.botdot.ios', origins });
  const server = http.createServer(create({ apns }));
  const port = Number(env.PORT) || 8787;
  server.listen(port, env.HOST || '0.0.0.0', () => console.log(`[relay] on ${port}`));
  for (const sig of ['SIGINT', 'SIGTERM']) process.on(sig, () => { apns.close(); server.close(() => process.exit(0)); });
}

if (require.main === module) main();

module.exports = { create, limiter, check, apnsPayload, ALERT, BODY_MAX, TTL_SECONDS };
