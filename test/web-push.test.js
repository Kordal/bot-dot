// Web Push, the protocol (lib/web-push.js, issue #87): the encryption against RFC 8291's own test vector, a message a
// browser can read back, and a VAPID token the push service can check with the public key alone (RFC 8292).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const webPush = require('../lib/web-push');

const b = (s) => Buffer.from(s, 'base64url');

// RFC 8291, Appendix A.
const RFC = {
  plaintext: 'V2hlbiBJIGdyb3cgdXAsIEkgd2FudCB0byBiZSBhIHdhdGVybWVsb24',
  asPublic: 'BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8',
  asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw',
  uaPublic: 'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4',
  uaPrivate: 'q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94',
  salt: 'DGv6ra1nlYgDCS1FRnbzlw',
  auth: 'BTBZMqHH6r4Tts7J_aSIgg',
  message: 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN',
};

// What a browser does with a push (RFC 8291 section 3, from its side): the message read back with its own keys.
function decrypt(message, uaPrivate, auth) {
  const salt = message.subarray(0, 16);
  const keyLength = message[20];
  const asPublic = message.subarray(21, 21 + keyLength);
  const body = message.subarray(21 + keyLength);
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(b(uaPrivate));
  const uaPublic = ecdh.getPublicKey();
  const hkdf = (key, ikm, info, n) => Buffer.from(crypto.hkdfSync('sha256', ikm, key, info, n));
  const ikm = hkdf(b(auth), ecdh.computeSecret(asPublic), Buffer.concat([Buffer.from('WebPush: info\0'), uaPublic, asPublic]), 32);
  const decipher = crypto.createDecipheriv('aes-128-gcm', hkdf(salt, ikm, Buffer.from('Content-Encoding: aes128gcm\0'), 16), hkdf(salt, ikm, Buffer.from('Content-Encoding: nonce\0'), 12));
  decipher.setAuthTag(body.subarray(body.length - 16));
  const padded = Buffer.concat([decipher.update(body.subarray(0, body.length - 16)), decipher.final()]);
  assert.equal(padded[padded.length - 1], 2, 'the last record ends with the delimiter 2');
  return padded.subarray(0, padded.length - 1);
}

test("the encryption gives RFC 8291's test vector byte for byte", () => {
  const out = webPush.encrypt(b(RFC.plaintext), { p256dh: RFC.uaPublic, auth: RFC.auth }, { salt: b(RFC.salt), serverKey: RFC.asPrivate });
  assert.equal(out.toString('base64url'), RFC.message);
  assert.equal(decrypt(out, RFC.uaPrivate, RFC.auth).toString(), 'When I grow up, I want to be a watermelon');
});

test('a push is new every time and only its browser reads it', () => {
  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  const keys = { p256dh: ua.getPublicKey('base64url'), auth: crypto.randomBytes(16).toString('base64url') };
  const payload = JSON.stringify({ title: 'News', body: 'Found 3 articles.', target: 'bot:b1' });
  const one = webPush.encrypt(payload, keys);
  const two = webPush.encrypt(payload, keys);
  assert.notDeepEqual(one, two, 'a new salt and a new key each time');
  assert.equal(one.readUInt32BE(16), 4096, 'one record of 4096');
  assert.equal(decrypt(one, ua.getPrivateKey('base64url'), keys.auth).toString(), payload);
  const other = crypto.createECDH('prime256v1');
  other.generateKeys();
  assert.throws(() => decrypt(one, other.getPrivateKey('base64url'), keys.auth));
  assert.throws(() => webPush.encrypt('x'.repeat(webPush.MAX_PLAINTEXT + 1), keys), /at most/);
});

test("the VAPID token is for the push service's origin, signed with the account's key, and says the public key", () => {
  const keys = webPush.vapidKeys();
  assert.equal(b(keys.publicKey).length, 65);
  assert.equal(b(keys.publicKey)[0], 4, 'the uncompressed point a browser takes as applicationServerKey');
  const now = Date.UTC(2026, 9, 19, 12);
  const header = webPush.vapidAuth('https://web.push.apple.com/QGuQyavXutnMH9mpv/abc?x=1', keys, 'https://botdot.example.ts.net', now);
  const m = header.match(/^vapid t=([\w-]+)\.([\w-]+)\.([\w-]+), k=([\w-]+)$/);
  assert.ok(m, header);
  assert.equal(m[4], keys.publicKey);
  assert.deepEqual(JSON.parse(b(m[1])), { typ: 'JWT', alg: 'ES256' });
  assert.deepEqual(JSON.parse(b(m[2])), { aud: 'https://web.push.apple.com', exp: now / 1000 + 12 * 3600, sub: 'https://botdot.example.ts.net' });
  const pub = b(keys.publicKey);
  const key = crypto.createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') } });
  const sig = b(m[3]);
  assert.equal(sig.length, 64, 'ES256 as JWS has it: r and s, 32 bytes each');
  assert.ok(crypto.verify('sha256', Buffer.from(`${m[1]}.${m[2]}`), { key, dsaEncoding: 'ieee-p1363' }, sig));
});

test('only keys a browser gives are taken', () => {
  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  const auth = crypto.randomBytes(16).toString('base64url');
  assert.ok(webPush.validKeys({ p256dh: ua.getPublicKey('base64url'), auth }));
  const off = ua.getPublicKey();
  off[50] ^= 1;
  for (const keys of [null, {}, { p256dh: ua.getPublicKey('base64url') }, { p256dh: ua.getPublicKey('base64url'), auth: 'short' }, { p256dh: off.toString('base64url'), auth }, { p256dh: ua.getPublicKey('base64url', 'compressed'), auth }]) {
    assert.equal(webPush.validKeys(keys), false, JSON.stringify(keys));
  }
});

test('a send is one POST with the headers RFC 8030 and 8188 ask for', async () => {
  const ua = crypto.createECDH('prime256v1');
  ua.generateKeys();
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/abc', keys: { p256dh: ua.getPublicKey('base64url'), auth: crypto.randomBytes(16).toString('base64url') } };
  let seen;
  const fetchImpl = async (url, opts) => { seen = { url, opts }; return new Response(null, { status: 201 }); };
  const status = await webPush.send(sub, { title: 'A', body: 'B', target: 'needs' }, { vapid: webPush.vapidKeys(), subject: 'https://x.example', urgency: 'high', fetchImpl });
  assert.equal(status, 201);
  assert.equal(seen.url, sub.endpoint);
  assert.equal(seen.opts.method, 'POST');
  assert.equal(seen.opts.redirect, 'error');
  assert.equal(seen.opts.headers['Content-Encoding'], 'aes128gcm');
  assert.equal(seen.opts.headers.Urgency, 'high');
  assert.equal(seen.opts.headers.TTL, '86400');
  assert.match(seen.opts.headers.Authorization, /^vapid t=/);
  assert.deepEqual(JSON.parse(decrypt(seen.opts.body, ua.getPrivateKey('base64url'), sub.keys.auth)), { title: 'A', body: 'B', target: 'needs' });
});
