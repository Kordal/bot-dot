// A software passkey for the front door's tests: what a browser and its authenticator send for WebAuthn's
// navigator.credentials.create() and .get(), made with a P-256 key in this process. Attestation "none".
const crypto = require('crypto');

const b64u = (buf) => Buffer.from(buf).toString('base64url');
const sha256 = (data) => crypto.createHash('sha256').update(data).digest();

// The CBOR WebAuthn needs (RFC 8949): unsigned and negative integers, byte and text strings, arrays, maps.
function cbor(value) {
  const head = (major, n) => {
    if (n < 24) return Buffer.from([(major << 5) | n]);
    if (n < 256) return Buffer.from([(major << 5) | 24, n]);
    if (n < 65536) { const b = Buffer.alloc(3); b[0] = (major << 5) | 25; b.writeUInt16BE(n, 1); return b; }
    const b = Buffer.alloc(5); b[0] = (major << 5) | 26; b.writeUInt32BE(n, 1); return b;
  };
  if (Number.isInteger(value)) return value >= 0 ? head(0, value) : head(1, -1 - value);
  if (Buffer.isBuffer(value)) return Buffer.concat([head(2, value.length), value]);
  if (typeof value === 'string') { const b = Buffer.from(value, 'utf8'); return Buffer.concat([head(3, b.length), b]); }
  if (Array.isArray(value)) return Buffer.concat([head(4, value.length), ...value.map(cbor)]);
  if (value instanceof Map) return Buffer.concat([head(5, value.size), ...[...value].flatMap(([k, v]) => [cbor(k), cbor(v)])]);
  throw new TypeError(`No CBOR for ${typeof value}`);
}

// The public key as COSE writes it (RFC 9053), and how the authenticator signs, per algorithm.
const KINDS = {
  ES256: {
    keys: () => crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }),
    cose: (jwk) => new Map([[1, 2], [3, -7], [-1, 1], [-2, Buffer.from(jwk.x, 'base64url')], [-3, Buffer.from(jwk.y, 'base64url')]]),
    sign: (data, key) => crypto.sign('sha256', data, key),
  },
  EdDSA: {
    keys: () => crypto.generateKeyPairSync('ed25519'),
    cose: (jwk) => new Map([[1, 1], [3, -8], [-1, 6], [-2, Buffer.from(jwk.x, 'base64url')]]),
    sign: (data, key) => crypto.sign(null, data, key),
  },
  RS256: {
    keys: () => crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }),
    cose: (jwk) => new Map([[1, 3], [3, -257], [-1, Buffer.from(jwk.n, 'base64url')], [-2, Buffer.from(jwk.e, 'base64url')]]),
    sign: (data, key) => crypto.sign('sha256', data, { key, padding: crypto.constants.RSA_PKCS1_PADDING }),
  },
};

// One passkey on one authenticator. rpId: the front door's name; origin: its address, as the browser saw it.
// alg: ES256 (what most authenticators make), EdDSA or RS256.
function create({ rpId, origin, alg = 'ES256' }) {
  const kind = KINDS[alg];
  const { privateKey, publicKey } = kind.keys();
  const id = crypto.randomBytes(16);
  let userHandle = null;
  let count = 0;
  const flags = (attested, verified = true) => Buffer.from([0x01 | (verified ? 0x04 : 0) | (attested ? 0x40 : 0)]); // user present, verified
  const counter = () => { const b = Buffer.alloc(4); b.writeUInt32BE(count, 0); return b; };
  const clientData = (type, challenge, extra = {}) => Buffer.from(JSON.stringify({ type, challenge, origin, crossOrigin: false, ...extra }));

  const key = {
    id: b64u(id),
    // What navigator.credentials.create(options) gives the page, as the page sends it on. over: what a
    // test changes to make it wrong ({ origin, type, challenge, rpId }).
    register(options, over = {}) {
      userHandle = Buffer.from(options.user.id, 'base64url');
      const jwk = publicKey.export({ format: 'jwk' });
      const cose = cbor(kind.cose(jwk));
      const idLen = Buffer.alloc(2); idLen.writeUInt16BE(id.length, 0);
      const authData = Buffer.concat([sha256(over.rpId || rpId), flags(true), counter(), Buffer.alloc(16), idLen, id, cose]);
      const attestationObject = cbor(new Map([['fmt', 'none'], ['attStmt', new Map()], ['authData', authData]]));
      const cd = clientData(over.type || 'webauthn.create', over.challenge || options.challenge, over.origin ? { origin: over.origin } : {});
      return { id: b64u(id), rawId: b64u(id), type: 'public-key', response: { clientDataJSON: b64u(cd), attestationObject: b64u(attestationObject) } };
    },
    // What navigator.credentials.get(options) gives the page. over: as for register, { signature } to break it,
    // { count } for the sign count a copy of this passkey would send, { unverified } for no PIN, face or fingerprint.
    signIn(options, over = {}) {
      count = over.count ?? count + 1;
      const authData = Buffer.concat([sha256(over.rpId || rpId), flags(false, !over.unverified), counter()]);
      const cd = clientData(over.type || 'webauthn.get', over.challenge || options.challenge, over.origin ? { origin: over.origin } : {});
      const signature = over.signature || kind.sign(Buffer.concat([authData, sha256(cd)]), privateKey);
      return {
        id: b64u(id), rawId: b64u(id), type: 'public-key',
        response: { clientDataJSON: b64u(cd), authenticatorData: b64u(authData), signature: b64u(signature), userHandle: userHandle ? b64u(userHandle) : null },
      };
    },
  };
  return key;
}

module.exports = { create, cbor };
