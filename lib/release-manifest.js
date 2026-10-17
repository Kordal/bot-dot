const crypto = require('node:crypto');
const net = require('node:net');
const pinnedKey = require('./release-trust');

// UTF-8, LF only, including the final LF. Every string is restricted to ASCII without whitespace.
function canonical(m) {
  if (!m || !/^(mac|android|server|desktop)$/.test(m.app)
    || !Number.isSafeInteger(m.version) || m.version < 1 || !/^[0-9a-f]{40}$/.test(m.revision)
    || !/^[A-Za-z0-9][A-Za-z0-9._/:@-]{0,255}$/.test(m.file) || !/^[0-9a-f]{64}$/.test(m.sha256)) throw new Error('Invalid release manifest');
  return Buffer.from(`botdot-release-v1\n${m.app}\n${m.version}\n${m.revision}\n${m.file}\n${m.sha256}\n`);
}

function verify(m, { app, installed, publicKey = pinnedKey }) {
  const bytes = canonical(m);
  if (m.app !== app) throw new Error('The release is for another app');
  if (!Number.isSafeInteger(installed) || m.version < installed) throw new Error('An older release cannot be installed');
  if (!publicKey) throw new Error('No release verification key is pinned');
  let valid = false;
  try {
    const key = crypto.createPublicKey({ key: Buffer.from(publicKey, 'base64'), type: 'spki', format: 'der' });
    valid = key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails.namedCurve === 'prime256v1'
      && crypto.verify('sha256', bytes, key, Buffer.from(m.signature || '', 'base64'));
  } catch { /* fail closed */ }
  if (!valid) throw new Error('The release signature is invalid');
  return m;
}

function secureURL(value) {
  try {
    const u = new URL(value);
    const host = u.hostname.replace(/^\[|\]$/g, '');
    return !u.username && !u.password && (u.protocol === 'https:' || u.protocol === 'http:' && (host === 'localhost' || host === '::1' || net.isIPv4(host) && host.startsWith('127.')));
  } catch { return false; }
}
module.exports = { canonical, verify, secureURL };
