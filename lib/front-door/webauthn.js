// @ts-check
// Passkeys (WebAuthn Level 2), the server's half: checking what a browser's navigator.credentials.create() and
// .get() return. Attestation is "none": the front door trusts no maker of authenticators, only that the
// same passkey signs again. Keys: ES256 (P-256), EdDSA (Ed25519) and RS256, the ones browsers offer.
const crypto = require('crypto');
const cbor = require('./cbor');

const ALGS = [-7, -8, -257]; // what the front door asks for, in its order of preference
const sha256 = (data) => crypto.createHash('sha256').update(data).digest();
const fromB64u = (s) => {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]*={0,2}$/.test(s)) throw refusal('Not base64url');
  return Buffer.from(s, 'base64url');
};
const refusal = (message) => Object.assign(new Error(message), { refused: true });
const same = (a, b) => a.length === b.length && crypto.timingSafeEqual(a, b);

// The client's data: of this type, for this challenge, from this origin (or one of these: the site's own and the
// Android app's), and not inside another site's frame.
function checkClientData(b64, { type, challenge, origin }) {
  let data;
  try { data = JSON.parse(fromB64u(b64).toString('utf8')); } catch { throw refusal('Unreadable client data'); }
  if (data.type !== type) throw refusal('Wrong type');
  if (typeof data.challenge !== 'string' || !same(Buffer.from(data.challenge), Buffer.from(challenge))) throw refusal('Wrong challenge');
  if (typeof data.origin !== 'string' || ![].concat(origin).includes(data.origin)) throw refusal('Wrong origin');
  if (data.crossOrigin === true) throw refusal('Made inside another site');
}

// Authenticator data: for this relying party, with the person present and verified (their device's PIN, face or
// fingerprint), so that a passkey is never only something someone holds. Returns its parts.
function parseAuthData(buf, rpId) {
  if (buf.length < 37) throw refusal('Authenticator data cut short');
  if (!same(buf.subarray(0, 32), sha256(rpId))) throw refusal('Made for another site');
  const flags = buf[32];
  if (!(flags & 0x01)) throw refusal('Nobody was present');
  if (!(flags & 0x04)) throw refusal('Nobody was verified');
  return { flags, signCount: buf.readUInt32BE(33), rest: buf.subarray(37) };
}

// A COSE public key (RFC 9053) as a Node key object, with its algorithm.
function coseKey(map) {
  if (!(map instanceof Map)) throw refusal('No public key');
  const kty = map.get(1);
  const alg = map.get(3);
  const b = (k) => { const v = map.get(k); if (!Buffer.isBuffer(v)) throw refusal('Public key cut short'); return v.toString('base64url'); };
  let jwk;
  if (alg === -7 && kty === 2 && map.get(-1) === 1) jwk = { kty: 'EC', crv: 'P-256', x: b(-2), y: b(-3) };
  else if (alg === -8 && kty === 1 && map.get(-1) === 6) jwk = { kty: 'OKP', crv: 'Ed25519', x: b(-2) };
  else if (alg === -257 && kty === 3) jwk = { kty: 'RSA', n: b(-1), e: b(-2) };
  else throw refusal('A kind of passkey the front door does not take');
  try { crypto.createPublicKey({ key: jwk, format: 'jwk' }); } catch { throw refusal('Not a public key'); }
  return { alg, jwk };
}

// What navigator.credentials.create() is asked, for one new account.
function creationOptions({ rpId, challenge, userId, name }) {
  return {
    challenge,
    rp: { id: rpId, name: 'botdot' },
    user: { id: userId, name, displayName: name },
    pubKeyCredParams: ALGS.map((alg) => ({ type: 'public-key', alg })),
    authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
    attestation: 'none',
    timeout: 300_000,
  };
}

// What navigator.credentials.get() is asked: any passkey of this site, which then says whose account it is.
const requestOptions = ({ rpId, challenge }) => ({ challenge, rpId, userVerification: 'required', timeout: 300_000 });

// A new passkey from create(): { id, alg, jwk, signCount }, or throws a refusal.
function verifyRegistration(credential, { rpId, origin, challenge }) {
  const r = credential?.response;
  if (credential?.type !== 'public-key' || !r) throw refusal('No passkey');
  checkClientData(r.clientDataJSON, { type: 'webauthn.create', challenge, origin });
  let att;
  try { att = cbor.decode(fromB64u(r.attestationObject)).value; } catch (e) { throw e.refused ? e : refusal('Unreadable attestation'); }
  if (!(att instanceof Map) || !Buffer.isBuffer(att.get('authData'))) throw refusal('Unreadable attestation');
  const { flags, signCount, rest } = parseAuthData(att.get('authData'), rpId);
  if (!(flags & 0x40) || rest.length < 18) throw refusal('No passkey in the attestation');
  const idLen = rest.readUInt16BE(16);
  if (idLen < 1 || idLen > 1023 || rest.length < 18 + idLen) throw refusal('No passkey in the attestation');
  const id = rest.subarray(18, 18 + idLen);
  let key;
  try { key = cbor.decode(rest, 18 + idLen).value; } catch { throw refusal('Unreadable public key'); }
  if (credential.id !== id.toString('base64url')) throw refusal("The passkey's id does not match");
  return { id: id.toString('base64url'), ...coseKey(key), signCount };
}

// A sign-in from get(), against the stored passkey: returns its new sign count, or throws a refusal.
function verifyAssertion(credential, stored, { rpId, origin, challenge }) {
  const r = credential?.response;
  if (credential?.type !== 'public-key' || !r) throw refusal('No passkey');
  checkClientData(r.clientDataJSON, { type: 'webauthn.get', challenge, origin });
  const authData = fromB64u(r.authenticatorData);
  const { signCount } = parseAuthData(authData, rpId);
  const signed = Buffer.concat([authData, sha256(fromB64u(r.clientDataJSON))]);
  const key = crypto.createPublicKey({ key: stored.jwk, format: 'jwk' });
  const signature = fromB64u(r.signature);
  const ok = stored.alg === -8 ? crypto.verify(null, signed, key, signature)
    : stored.alg === -257 ? crypto.verify('sha256', signed, { key, padding: crypto.constants.RSA_PKCS1_PADDING }, signature)
      : crypto.verify('sha256', signed, key, signature);
  if (!ok) throw refusal('Wrong signature');
  // A count that did not go up, where the authenticator counts at all, is a copy of the passkey.
  if ((signCount || stored.signCount) && signCount <= stored.signCount) throw refusal('A copied passkey');
  return signCount;
}

module.exports = { creationOptions, requestOptions, verifyRegistration, verifyAssertion };
