// Web Push, the protocol (issue #87): what botdot needs to hand a notification to a browser's push service itself,
// with Node's own crypto and no package. Three parts:
//   - VAPID (RFC 8292): the account's own key pair, and the signed token that says the push comes from its holder.
//     No relay and no developer account: the push service only checks that the key it was subscribed with signed it.
//   - The encryption (RFC 8291, aes128gcm of RFC 8188): only the browser that subscribed can read what is sent; the
//     push service passes on bytes.
//   - The request itself (RFC 8030): one POST to the subscription's endpoint, answered with its status.
const crypto = require('crypto');

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const unb64u = (s) => Buffer.from(String(s || ''), 'base64url');

const RECORD = 4096; // one record holds the whole message: the push services take at most 4096 bytes
const HEADER = 16 + 4 + 1 + 65; // salt, record size, key length, the server's key
const MAX_PLAINTEXT = RECORD - HEADER - 16 - 1; // less the tag and the padding delimiter

// A new VAPID key pair: { publicKey, privateKey }, base64url, the public one as the uncompressed point the browser
// takes as applicationServerKey.
function vapidKeys() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  return { publicKey: b64u(ecdh.getPublicKey()), privateKey: b64u(ecdh.getPrivateKey()) };
}

// The signing key of a pair, for ES256.
function signingKey({ publicKey, privateKey }) {
  const pub = unb64u(publicKey);
  return crypto.createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', d: b64u(unb64u(privateKey)), x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) } });
}

// The Authorization header of a push to `endpoint` (RFC 8292): a token for the push service's origin, valid for
// 12 hours, and the public key. `subject` is how the push service can reach the sender: botdot's https address.
function vapidAuth(endpoint, keys, subject, now = Date.now()) {
  const header = b64u(JSON.stringify({ typ: 'JWT', alg: 'ES256' }));
  const claims = b64u(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject }));
  const sig = crypto.sign('sha256', Buffer.from(`${header}.${claims}`), { key: signingKey(keys), dsaEncoding: 'ieee-p1363' });
  return `vapid t=${header}.${claims}.${b64u(sig)}, k=${keys.publicKey}`;
}

// Is this what a browser gives as a subscription's keys: a P-256 point and a 16-byte secret?
function validKeys(keys) {
  const pub = unb64u(keys?.p256dh);
  const auth = unb64u(keys?.auth);
  if (pub.length !== 65 || pub[0] !== 4 || auth.length !== 16) return false;
  try { crypto.ECDH.convertKey(pub, 'prime256v1'); return true; } catch { return false; } // a point off the curve throws
}

// The body of a push (RFC 8291): `plaintext` encrypted for the subscription's keys ({ p256dh, auth }). `salt` and
// `serverKey` (a private key, base64url) are for the RFC's test vector: a real push makes both new.
function encrypt(plaintext, keys, { salt = crypto.randomBytes(16), serverKey } = {}) {
  const text = Buffer.from(plaintext);
  if (text.length > MAX_PLAINTEXT) throw new Error(`A push holds at most ${MAX_PLAINTEXT} bytes.`);
  const uaPublic = unb64u(keys.p256dh);
  const authSecret = unb64u(keys.auth);
  const ecdh = crypto.createECDH('prime256v1');
  if (serverKey) ecdh.setPrivateKey(unb64u(serverKey)); else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const hkdf = (key, ikm, info, length) => Buffer.from(crypto.hkdfSync('sha256', ikm, key, info, length));
  const ikm = hkdf(authSecret, shared, Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32);
  const cek = hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16);
  const nonce = hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12);
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const body = Buffer.concat([cipher.update(Buffer.concat([text, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const rs = Buffer.alloc(4);
  rs.writeUInt32BE(RECORD);
  return Buffer.concat([salt, rs, Buffer.from([asPublic.length]), asPublic, body]);
}

// Sends `payload` (an object, sent as JSON) to one subscription ({ endpoint, keys }). Resolves to the push
// service's status: 201 taken, 404 or 410 the subscription is gone, anything else a failure for now.
// urgency: 'high' for what waits for the owner, 'normal' for a reply. ttl: how long the push service may keep it.
async function send(sub, payload, { vapid, subject, urgency = 'normal', ttl = 24 * 3600, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(sub.endpoint, {
    method: 'POST',
    redirect: 'error',
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: vapidAuth(sub.endpoint, vapid, subject),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(ttl),
      Urgency: urgency,
    },
    body: encrypt(JSON.stringify(payload), sub.keys),
  });
  await res.arrayBuffer().catch(() => null); // let the connection go
  return res.status;
}

module.exports = { vapidKeys, vapidAuth, validKeys, encrypt, send, MAX_PLAINTEXT, b64u, unb64u };
