// iPhone notifications through the project's push relay (#964, ADR 150, docs/api.md "Notifications on this device").
// The iOS app's WKWebView has no Web Push, and Apple's push service (APNs) takes pushes only from the holder of the
// app's team key, which a self-hosted botdot doesn't have. So the project runs a relay (relay/) that holds that key,
// and a botdot sends it each notification sealed for the device alone:
//   - the app makes a random 32-byte key and gives it to its botdot with its APNs device token;
//   - botdot seals the same payload a Web Push carries ({ title, body, target, tag }) with AES-256-GCM under that key;
//   - the relay gets the token, the sealed bytes, a collapse id (the tag) and a thread id (the target), and forwards
//     a generic alert with `mutable-content: 1`; the app's Notification Service Extension opens the seal.
// The relay and Apple see whom a push is for and which chat it is about, never what it says.
const crypto = require('crypto');

const VERSION = 1; // the first byte of a seal; it is also the cipher's additional data
const TOKEN = /^[0-9a-f]{64,200}$/; // APNs device tokens are 32 bytes today; Apple says not to rely on the length
const ENVIRONMENTS = ['production', 'development'];
const COLLAPSE_MAX = 64; // bytes: APNs refuses a longer apns-collapse-id
const THREAD = /^[\w:.-]{1,100}$/;

const fail = (msg) => Object.assign(new Error(msg), { status: 400 });

// The device's key, base64 or base64url, as 32 bytes; null when it isn't one.
function keyBytes(key) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9+/_-]{43,44}={0,2}$/.test(key)) return null;
  const b = Buffer.from(key.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''), 'base64url');
  return b.length === 32 ? b : null;
}

// What the app registers: { token, key, environment }. The token is kept in lower case, the key as base64url.
function checkDevice(d) {
  const token = typeof d?.token === 'string' ? d.token.trim().toLowerCase() : '';
  if (!TOKEN.test(token)) throw fail('A device needs its APNs token, in hex.');
  const key = keyBytes(d.key);
  if (!key) throw fail('A device needs its key: 32 random bytes in base64.');
  const environment = d.environment == null ? 'production' : d.environment;
  if (!ENVIRONMENTS.includes(environment)) throw fail('environment is "production" or "development".');
  return { token, key: key.toString('base64url'), environment };
}

// The payload sealed for one device: base64url of version (1 byte) | nonce (12) | ciphertext | tag (16).
function seal(payload, key) {
  const k = keyBytes(key);
  if (!k) throw new Error('Not a device key.');
  const nonce = crypto.randomBytes(12);
  const head = Buffer.from([VERSION]);
  const c = crypto.createCipheriv('aes-256-gcm', k, nonce);
  c.setAAD(head);
  const body = Buffer.concat([c.update(JSON.stringify(payload), 'utf8'), c.final()]);
  return Buffer.concat([head, nonce, body, c.getAuthTag()]).toString('base64url');
}

// What the Notification Service Extension does, for the tests and as the reference of the format.
function open(sealed, key) {
  const b = Buffer.from(sealed, 'base64url');
  if (b[0] !== VERSION || b.length < 1 + 12 + 16) throw new Error('Not a seal of this version.');
  const d = crypto.createDecipheriv('aes-256-gcm', keyBytes(key), b.subarray(1, 13));
  d.setAAD(b.subarray(0, 1));
  d.setAuthTag(b.subarray(b.length - 16));
  return JSON.parse(Buffer.concat([d.update(b.subarray(13, b.length - 16)), d.final()]).toString('utf8'));
}

// A tag as APNs takes it for apns-collapse-id: itself when it fits, else its hash (the same tag, the same id).
function collapseId(tag) {
  const t = String(tag || '');
  if (t && Buffer.byteLength(t) <= COLLAPSE_MAX) return t;
  return `h:${crypto.createHash('sha256').update(t).digest('base64url').slice(0, 43)}`;
}

// What botdot posts to the relay for one notification and one device. Nothing else of the account goes there.
function relayRequest(device, { title, body, target, tag }) {
  const req = { token: device.token, environment: device.environment, sealed: seal({ title, body, target, tag }, device.key), collapseId: collapseId(tag || target) };
  if (THREAD.test(String(target || ''))) req.threadId = target;
  return req;
}

// Sends one notification to one device through the relay at `relay` (its address, no trailing slash).
// → { status, gone }: `gone` when Apple said the token is no longer the app's, so botdot forgets it.
async function send(relay, device, notice, { fetchImpl = (...a) => fetch(...a), timeoutMs = 10_000 } = {}) {
  const res = await fetchImpl(`${relay}/v1/push`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(relayRequest(device, notice)),
    signal: AbortSignal.timeout(timeoutMs),
  });
  await res.arrayBuffer().catch(() => {});
  return { status: res.status, gone: res.status === 410 };
}

// The relay's address from the setting: an https address (http only for the tests), without its trailing slash.
function relayAddress(value, { allowHttp = false } = {}) {
  const v = String(value || '').trim();
  if (!v) return null;
  let url;
  try { url = new URL(v); } catch { return null; }
  if (url.protocol !== 'https:' && !(allowHttp && url.protocol === 'http:')) return null;
  return url.href.replace(/\/+$/, '');
}

module.exports = { checkDevice, seal, open, collapseId, relayRequest, send, relayAddress, VERSION, COLLAPSE_MAX };
