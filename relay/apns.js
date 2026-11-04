// The relay's side of Apple's push service (APNs): token authentication with the project's .p8 key, and one HTTP/2
// connection per environment, kept open as Apple asks. https://developer.apple.com/documentation/usernotifications
const crypto = require('crypto');
const http2 = require('http2');

const ORIGINS = { production: 'https://api.push.apple.com', development: 'https://api.sandbox.push.apple.com' };
const TOKEN_MINUTES = 40; // Apple refuses a provider token older than an hour and one renewed more than every 20 minutes
const TIMEOUT_MS = 10_000;

// keyPem: the .p8 key's text. keyId, teamId: from the Apple Developer account. topic: the app's bundle id.
// origins: where each environment's APNs is (a fake one in the tests). now(): milliseconds.
function create({ keyPem, keyId, teamId, topic, origins = ORIGINS, now = Date.now, timeoutMs = TIMEOUT_MS }) {
  const key = crypto.createPrivateKey(keyPem);
  let jwt = null;
  let jwtAt = 0;

  function providerToken() {
    if (jwt && now() - jwtAt < TOKEN_MINUTES * 60_000) return jwt;
    const iat = Math.floor(now() / 1000);
    const part = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const unsigned = `${part({ alg: 'ES256', kid: keyId })}.${part({ iss: teamId, iat })}`;
    const sig = crypto.sign('sha256', Buffer.from(unsigned), { key, dsaEncoding: 'ieee-p1363' });
    jwt = `${unsigned}.${sig.toString('base64url')}`;
    jwtAt = now();
    return jwt;
  }

  const sessions = new Map(); // environment -> ClientHttp2Session
  function session(environment) {
    const open = sessions.get(environment);
    if (open && !open.closed && !open.destroyed) return open;
    const s = http2.connect(origins[environment]);
    s.on('error', () => {});
    s.on('close', () => { if (sessions.get(environment) === s) sessions.delete(environment); });
    s.unref();
    sessions.set(environment, s);
    return s;
  }

  // One alert push. → { status, reason } as Apple answered (reason: its JSON's `reason`, when it gave one).
  function send({ token, environment, payload, collapseId, expiresAt }) {
    return new Promise((resolve, reject) => {
      const headers = {
        ':method': 'POST',
        ':path': `/3/device/${token}`,
        authorization: `bearer ${providerToken()}`,
        'apns-topic': topic,
        'apns-push-type': 'alert',
        'apns-priority': '10',
        'apns-expiration': String(expiresAt),
        'content-type': 'application/json',
      };
      if (collapseId) headers['apns-collapse-id'] = collapseId;
      let req;
      try { req = session(environment).request(headers); } catch (e) { reject(e); return; }
      const chunks = [];
      let status = 0;
      req.setTimeout(timeoutMs, () => req.close(http2.constants.NGHTTP2_CANCEL));
      req.on('response', (h) => { status = Number(h[':status']); });
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        let reason = null;
        try { reason = JSON.parse(Buffer.concat(chunks).toString('utf8')).reason || null; } catch { /* no body on 200 */ }
        if (reason === 'ExpiredProviderToken') jwt = null;
        if (status) resolve({ status, reason }); else reject(new Error('APNs did not answer.'));
      });
      req.on('error', reject);
      req.end(payload);
    });
  }

  function close() { for (const s of sessions.values()) s.close(); sessions.clear(); }

  return { send, close, providerToken };
}

module.exports = { create, ORIGINS };
