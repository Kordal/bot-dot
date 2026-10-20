// SSH keys the owner adds to the Vault (#160): an OpenSSH private key read for its public half and fingerprint, or a
// new ed25519 key pair made here. Node's crypto alone: the image has no ssh-keygen. Only OpenSSH's own format
// (its BEGIN line names OPENSSH, openssh-key-v1) is accepted, and only without a passphrase: a bot can't
// type one, and the key already sits encrypted in Bitwarden. Every refusal is a sentence for the owner.
const crypto = require('crypto');

// A PEM line, put together here: the whole line in the source reads as a key to secret scanners (gitleaks, tests.yml).
const pem = (edge, what) => `-----${edge} ${what} ${'PRIVATE'} KEY-----`;
const BEGIN = pem('BEGIN', 'OPENSSH');
const END = pem('END', 'OPENSSH');
const OTHER_PEM = new RegExp(`-----BEGIN (RSA |EC |DSA )?${'PRIVATE'} KEY-----`); // RSA, EC and DSA PEM, and PKCS#8
const ENCRYPTED_PEM = pem('BEGIN', 'ENCRYPTED');
const MAGIC = Buffer.from('openssh-key-v1\0', 'latin1');
const MAX_LENGTH = 64 * 1024; // far above an RSA 16384-bit key
const CONVERT = `Only OpenSSH private keys are accepted (they start with ${BEGIN}). Convert this one with: ssh-keygen -p -f KEY`;

// The strings an openssh-key-v1 key is made of: a 4-byte length, then that many bytes.
function reader(buf) {
  let at = 0;
  const need = (n) => { if (at + n > buf.length) throw new Error('short'); };
  return {
    uint32() { need(4); const v = buf.readUInt32BE(at); at += 4; return v; },
    bytes() { const n = this.uint32(); need(n); const v = buf.subarray(at, at + n); at += n; return v; },
    string() { return this.bytes().toString('latin1'); },
    rest: () => buf.subarray(at),
  };
}
const sshString = (b) => { const v = Buffer.isBuffer(b) ? b : Buffer.from(b, 'latin1'); const n = Buffer.alloc(4); n.writeUInt32BE(v.length); return Buffer.concat([n, v]); };
const uint32 = (v) => { const n = Buffer.alloc(4); n.writeUInt32BE(v >>> 0); return n; };

// As `ssh-keygen -l`: SHA256 of the public key's blob, base64 without its padding.
const fingerprintOf = (blob) => `SHA256:${crypto.createHash('sha256').update(blob).digest('base64').replace(/=+$/, '')}`;
// As `ssh-keygen -y`: the key's type, its blob in base64, and the comment when it has one.
const publicKeyOf = (type, blob, comment) => [type, blob.toString('base64'), comment].filter(Boolean).join(' ');
// What a comment may hold on the public key's one line.
const cleanComment = (c) => String(c || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200);

// The private section's fields after the key's type, before its comment, by type (OpenSSH's PROTOCOL.key).
const PRIVATE_FIELDS = { 'ssh-ed25519': 2, 'ssh-rsa': 6, 'ssh-dss': 5, 'ecdsa-sha2-nistp256': 3, 'ecdsa-sha2-nistp384': 3, 'ecdsa-sha2-nistp521': 3 };

// The text the owner pasted or picked: { privateKey, publicKey, fingerprint }, or a refusal.
function readPrivateKey(text) {
  const t = String(text ?? '').replace(/\r\n?/g, '\n').trim();
  if (!t) throw new Error('Paste the private key, or pick its file.');
  if (t.length > MAX_LENGTH) throw new Error('That is too long for an SSH private key.');
  if (/^(ssh-|ecdsa-|sk-)\S+ AAAA/.test(t)) throw new Error('That is a public key. Paste the private key (the file without .pub).');
  if (/^PuTTY-User-Key-File/m.test(t)) throw new Error(`${CONVERT} (for a PuTTY .ppk file: puttygen KEY.ppk -O private-openssh-new -o KEY)`);
  if (t.includes(ENCRYPTED_PEM) || /Proc-Type: 4,ENCRYPTED/.test(t)) throw new Error(`This key has a passphrase. Remove it first (ssh-keygen -p -f KEY, with an empty new passphrase), then add it again. ${CONVERT}`);
  if (OTHER_PEM.test(t)) throw new Error(CONVERT);
  const a = t.indexOf(BEGIN), b = t.indexOf(END);
  if (a < 0 || b < a) throw new Error(`That isn't an SSH private key. It should start with ${BEGIN}.`);
  const body = t.slice(a + BEGIN.length, b).replace(/\s+/g, '');
  const raw = Buffer.from(body, 'base64');
  const broken = new Error("That SSH private key is damaged or cut short. Copy the whole file, from its BEGIN line to its END line.");
  if (!/^[A-Za-z0-9+/]+=*$/.test(body) || !raw.subarray(0, MAGIC.length).equals(MAGIC)) throw broken;
  let type, blob, comment = '';
  try {
    const r = reader(raw.subarray(MAGIC.length));
    const cipher = r.string();
    const kdf = r.string();
    r.bytes(); // the kdf's options
    if (cipher !== 'none' || kdf !== 'none') throw Object.assign(new Error('This key has a passphrase. Remove it first (ssh-keygen -p -f KEY, with an empty new passphrase), then add it again.'), { owner: true });
    if (r.uint32() !== 1) throw Object.assign(new Error('That file holds more than one key. Add them one at a time.'), { owner: true });
    blob = r.bytes();
    type = reader(blob).string();
    const p = reader(r.bytes());
    if (p.uint32() !== p.uint32()) throw new Error('check'); // unencrypted, the two check numbers are the same
    if (p.string() !== type) throw new Error('type');
    const fields = PRIVATE_FIELDS[type];
    if (fields) {
      for (let i = 0; i < fields; i++) p.bytes();
      comment = p.string();
    }
  } catch (e) {
    if (e.owner) throw new Error(e.message);
    throw broken;
  }
  if (!/^[a-z0-9@.-]+$/.test(type)) throw broken;
  return { privateKey: `${t.slice(a, b + END.length)}\n`, publicKey: publicKeyOf(type, blob, cleanComment(comment)), fingerprint: fingerprintOf(blob) };
}

// A new ed25519 key pair without a passphrase, in OpenSSH's format, as `ssh-keygen -t ed25519 -N '' -C comment` makes it.
function generate(comment) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  const pub = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url');
  const seed = Buffer.from(privateKey.export({ format: 'jwk' }).d, 'base64url');
  const type = 'ssh-ed25519';
  const note = cleanComment(comment);
  const blob = Buffer.concat([sshString(type), sshString(pub)]);
  const check = crypto.randomBytes(4).readUInt32BE(0);
  let secret = Buffer.concat([uint32(check), uint32(check), sshString(type), sshString(pub), sshString(Buffer.concat([seed, pub])), sshString(note)]);
  const pad = (8 - (secret.length % 8)) % 8; // padded to the cipher's block size, 8 for none, with 1, 2, 3…
  secret = Buffer.concat([secret, Buffer.from(Array.from({ length: pad }, (_, i) => i + 1))]);
  const raw = Buffer.concat([MAGIC, sshString('none'), sshString('none'), sshString(''), uint32(1), sshString(blob), sshString(secret)]);
  const text = [BEGIN, ...raw.toString('base64').match(/.{1,70}/g), END, ''].join('\n');
  return { privateKey: text, publicKey: publicKeyOf(type, blob, note), fingerprint: fingerprintOf(blob) };
}

module.exports = { readPrivateKey, generate, fingerprintOf };
