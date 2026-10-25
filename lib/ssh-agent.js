// An ssh-agent that botdot serves itself for one run of a script job (ADR 087) or of a bot's AI (ADR 090): it offers
// the Vault SSH keys of that run (its job's, or every one shared with the bot) and signs with them, and nothing else. The private keys stay in this process: never in a file, the script's
// environment or a process of the bot's user. It answers only "list your keys" and "sign this" (OpenSSH's
// draft-miller-ssh-agent); adding, removing and locking are refused. Its socket is in a folder nobody can list, under a
// name nobody can guess, and is gone when the run ends.
const crypto = require('crypto');
const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const { privateParts, sshString, reader } = require('./ssh-keys');

const FAILURE = 5;
const REQUEST_IDENTITIES = 11;
const IDENTITIES_ANSWER = 12;
const SIGN_REQUEST = 13;
const SIGN_RESPONSE = 14;
const RSA_SHA2_256 = 2;
const RSA_SHA2_512 = 4;
const MAX_MESSAGE = 256 * 1024;

const uint32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32BE(v >>> 0); return b; };
const b64u = (buf) => Buffer.from(buf).toString('base64url');
// An mpint's bytes without the zero that keeps it positive, padded to `size` bytes when given.
const unsigned = (buf, size = 0) => {
  let b = Buffer.from(buf);
  while (b.length > 1 && b[0] === 0) b = b.subarray(1);
  return size && b.length < size ? Buffer.concat([Buffer.alloc(size - b.length), b]) : b;
};
const mpint = (buf) => { const b = unsigned(buf); return sshString(b[0] & 0x80 ? Buffer.concat([Buffer.from([0]), b]) : b); };
const big = (buf) => BigInt(`0x${unsigned(buf).toString('hex') || '0'}`);
const bytesOf = (n) => { let h = n.toString(16); if (h.length % 2) h = `0${h}`; return Buffer.from(h, 'hex'); };

const CURVES = {
  'ecdsa-sha2-nistp256': { crv: 'P-256', size: 32, hash: 'sha256' },
  'ecdsa-sha2-nistp384': { crv: 'P-384', size: 48, hash: 'sha384' },
  'ecdsa-sha2-nistp521': { crv: 'P-521', size: 66, hash: 'sha512' },
};

// A key the agent signs with, from its OpenSSH private key: { blob, comment, sign(data, flags) → signature blob }.
function signerOf(privateKey, name = '') {
  const { type, blob, fields, comment } = privateParts(privateKey);
  let key;
  let sign;
  if (type === 'ssh-ed25519') {
    const [pub, secret] = fields;
    key = crypto.createPrivateKey({ key: { kty: 'OKP', crv: 'Ed25519', x: b64u(pub), d: b64u(secret.subarray(0, 32)) }, format: 'jwk' });
    sign = (data) => Buffer.concat([sshString(type), sshString(crypto.sign(null, data, key))]);
  } else if (type === 'ssh-rsa') {
    const [n, e, d, iqmp, p, q] = fields.map(big);
    key = crypto.createPrivateKey({ key: { kty: 'RSA', n: b64u(bytesOf(n)), e: b64u(bytesOf(e)), d: b64u(bytesOf(d)), p: b64u(bytesOf(p)), q: b64u(bytesOf(q)), dp: b64u(bytesOf(d % (p - 1n))), dq: b64u(bytesOf(d % (q - 1n))), qi: b64u(bytesOf(iqmp)) }, format: 'jwk' });
    sign = (data, flags) => {
      const [alg, hash] = flags & RSA_SHA2_512 ? ['rsa-sha2-512', 'sha512'] : flags & RSA_SHA2_256 ? ['rsa-sha2-256', 'sha256'] : ['ssh-rsa', 'sha1'];
      return Buffer.concat([sshString(alg), sshString(crypto.sign(hash, data, key))]);
    };
  } else if (CURVES[type]) {
    const { crv, size, hash } = CURVES[type];
    const [, point, d] = fields;
    if (point[0] !== 4 || point.length !== 1 + 2 * size) throw new Error(`The SSH key "${name}" is damaged`);
    key = crypto.createPrivateKey({ key: { kty: 'EC', crv, x: b64u(point.subarray(1, 1 + size)), y: b64u(point.subarray(1 + size)), d: b64u(unsigned(d, size)) }, format: 'jwk' });
    sign = (data) => {
      const rs = crypto.sign(hash, data, { key, dsaEncoding: 'ieee-p1363' });
      return Buffer.concat([sshString(type), sshString(Buffer.concat([mpint(rs.subarray(0, size)), mpint(rs.subarray(size))]))]);
    };
  } else {
    throw new Error(`The SSH key "${name}" is of type ${type}, which botdot can't sign with`);
  }
  return { blob, comment: name || comment, sign };
}

// One message of the agent's: its length, its type, its body.
const message = (type, ...parts) => { const body = Buffer.concat([Buffer.from([type]), ...parts]); return Buffer.concat([uint32(body.length), body]); };

// What the agent answers a request (a message without its length): the keys it offers, a signature, or failure.
// keys: a list of signerOf.
function answer(request, keys) {
  const type = request[0];
  if (type === REQUEST_IDENTITIES) return message(IDENTITIES_ANSWER, uint32(keys.length), ...keys.flatMap((k) => [sshString(k.blob), sshString(k.comment)]));
  if (type === SIGN_REQUEST) {
    try {
      const r = reader(request.subarray(1));
      const blob = r.bytes();
      const data = r.bytes();
      const flags = r.rest().length >= 4 ? r.uint32() : 0;
      const k = keys.find((x) => x.blob.equals(blob));
      if (k) return message(SIGN_RESPONSE, sshString(k.sign(data, flags)));
    } catch { /* a request it can't read */ }
  }
  return message(FAILURE);
}

// The folder of every run's agent socket: the server's own, which others may pass through but not list (0711).
const agentsDir = () => path.join(os.tmpdir(), `botdot-agents-${process.getuid?.() ?? 'x'}`);

// Open the agent of one run. keys: an async function that gives its keys, [{ name, privateKey }], when ssh first asks
// for them (so a run that never uses SSH reads no key, and a locked Bitwarden is asked to open only then). Returns
// { socket, ready, close() } at once: socket for SSH_AUTH_SOCK, ready a promise of its listening, close() ends it and
// removes the socket. A bot's AI run opens it as its Claude Code starts (ADR 090), which waits for nothing.
function open(keys) {
  const dir = agentsDir();
  fs.mkdirSync(dir, { recursive: true, mode: 0o711 });
  fs.chmodSync(dir, 0o711);
  const socket = path.join(dir, `${crypto.randomBytes(18).toString('base64url')}.sock`);
  let loaded = null;
  const signers = () => (loaded ||= Promise.resolve().then(keys).then((list) => (list || []).flatMap((k) => {
    try { return [signerOf(k.privateKey, k.name)]; } catch (e) { console.warn(`[ssh-agent] ${e.message}`); return []; } finally { k.privateKey = null; }
  }), () => []));
  const conns = new Set();
  let closed = false;
  const server = net.createServer((c) => {
    conns.add(c);
    c.on('close', () => conns.delete(c));
    c.on('error', () => {});
    let buf = Buffer.alloc(0);
    let busy = Promise.resolve();
    c.on('data', (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      while (buf.length >= 4) {
        const n = buf.readUInt32BE(0);
        if (n === 0 || n > MAX_MESSAGE) return c.destroy();
        if (buf.length < 4 + n) break;
        const request = buf.subarray(4, 4 + n);
        buf = buf.subarray(4 + n);
        busy = busy.then(async () => { const out = answer(request, await signers()); if (!c.destroyed) c.write(out); }).catch(() => c.destroy());
      }
    });
  });
  let settle;
  const ready = new Promise((resolve, reject) => {
    settle = resolve;
    server.once('error', reject);
    server.listen(socket, () => {
      if (closed) { server.close(); fs.rmSync(socket, { force: true }); return resolve(); } // closed before it listened
      fs.chmodSync(socket, 0o666); // the bot's user connects; nobody else knows the name
      resolve();
    });
  });
  return {
    socket,
    ready,
    close() {
      closed = true;
      settle(); // nobody waits for an agent that is gone
      for (const c of conns) c.destroy();
      server.close();
      fs.rmSync(socket, { force: true });
      loaded = null;
    },
  };
}

// The agent of one run, once it listens (a script job's, ADR 087): { socket, close() } as open's.
async function start(keys) {
  const agent = open(keys);
  await agent.ready;
  return agent;
}

module.exports = { open, start, signerOf, answer, agentsDir };
