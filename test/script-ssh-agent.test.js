// A script job's own ssh-agent (ADR 087): botdot serves it for one run, offers only the Vault SSH keys its job lists,
// signs with them (ed25519, RSA with SHA-2 and SHA-1, ECDSA P-256/384/521), refuses everything else, and is gone with
// the run. The private keys never leave botdot's process.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const net = require('node:net');
const { execFile, execFileSync } = require('node:child_process');
const { promisify } = require('node:util');
const agent = require('../lib/ssh-agent');
const sshKeys = require('../lib/ssh-keys');
const { startServer, makeBot, waitFor } = require('./helpers');

const { sshString, reader } = sshKeys;
const uint32 = (v) => { const b = Buffer.alloc(4); b.writeUInt32BE(v); return b; };
const mpint = (b64) => { let b = Buffer.from(b64, 'base64url'); if (b[0] & 0x80) b = Buffer.concat([Buffer.from([0]), b]); return sshString(b); };
const PEM = (edge) => `-----${edge} OPENSSH ${'PRIVATE'} KEY-----`;

// A key pair of `type` in OpenSSH's format, as ssh-keygen writes it without a passphrase, and its public key for checking.
function opensshKey(type) {
  const curve = { 'ecdsa-sha2-nistp256': ['P-256', 'nistp256'], 'ecdsa-sha2-nistp384': ['P-384', 'nistp384'], 'ecdsa-sha2-nistp521': ['P-521', 'nistp521'] }[type];
  if (type === 'ssh-ed25519') return { ...sshKeys.generate('test'), type };
  const pair = type === 'ssh-rsa' ? crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }) : crypto.generateKeyPairSync('ec', { namedCurve: curve[0] });
  const j = pair.privateKey.export({ format: 'jwk' });
  const blob = type === 'ssh-rsa'
    ? Buffer.concat([sshString(type), mpint(j.e), mpint(j.n)])
    : Buffer.concat([sshString(type), sshString(curve[1]), sshString(Buffer.concat([Buffer.from([4]), Buffer.from(j.x, 'base64url'), Buffer.from(j.y, 'base64url')]))]);
  const fields = type === 'ssh-rsa'
    ? [mpint(j.n), mpint(j.e), mpint(j.d), mpint(j.qi), mpint(j.p), mpint(j.q)]
    : [sshString(curve[1]), sshString(Buffer.concat([Buffer.from([4]), Buffer.from(j.x, 'base64url'), Buffer.from(j.y, 'base64url')])), mpint(j.d)];
  let secret = Buffer.concat([uint32(7), uint32(7), sshString(type), ...fields, sshString('test')]);
  secret = Buffer.concat([secret, Buffer.from(Array.from({ length: (8 - (secret.length % 8)) % 8 }, (_, i) => i + 1))]);
  const raw = Buffer.concat([Buffer.from('openssh-key-v1\0', 'latin1'), sshString('none'), sshString('none'), sshString(''), uint32(1), sshString(blob), sshString(secret)]);
  return { type, privateKey: [PEM('BEGIN'), ...raw.toString('base64').match(/.{1,70}/g), PEM('END'), ''].join('\n'), publicKey: pair.publicKey, blob };
}

// The public key of an ed25519 key line, for checking its signatures.
const ed25519Public = (line) => {
  const r = reader(Buffer.from(line.split(' ')[1], 'base64'));
  r.string();
  return crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: r.bytes().toString('base64url') }, format: 'jwk' });
};

const request = (type, ...parts) => Buffer.concat([Buffer.from([type]), ...parts]);
const body = (msg) => msg.subarray(4);

test('the agent lists its keys and signs with each kind, and with nothing it does not hold', () => {
  const data = crypto.randomBytes(64);
  for (const type of ['ssh-ed25519', 'ssh-rsa', 'ecdsa-sha2-nistp256', 'ecdsa-sha2-nistp384', 'ecdsa-sha2-nistp521']) {
    const k = opensshKey(type);
    const signer = agent.signerOf(k.privateKey, 'Infra key');
    const blob = k.blob || Buffer.from(k.publicKey.split(' ')[1], 'base64');
    assert.ok(signer.blob.equals(blob), `${type}: the blob ssh knows the key by`);
    const ids = reader(body(agent.answer(request(11), [signer])).subarray(1));
    assert.equal(ids.uint32(), 1);
    assert.ok(ids.bytes().equals(blob));
    assert.equal(ids.string(), 'Infra key', 'the Vault name, as the comment');
    const flagsList = type === 'ssh-rsa' ? [0, 2, 4] : [0];
    for (const flags of flagsList) {
      const res = body(agent.answer(request(13, sshString(blob), sshString(data), uint32(flags)), [signer]));
      assert.equal(res[0], 14, `${type} ${flags}: signed`);
      const sig = reader(reader(res.subarray(1)).bytes());
      const alg = sig.string();
      const raw = sig.bytes();
      if (type === 'ssh-ed25519') { assert.equal(alg, type); assert.ok(crypto.verify(null, data, ed25519Public(k.publicKey), raw)); }
      else if (type === 'ssh-rsa') {
        const [want, hash] = flags === 4 ? ['rsa-sha2-512', 'sha512'] : flags === 2 ? ['rsa-sha2-256', 'sha256'] : ['ssh-rsa', 'sha1'];
        assert.equal(alg, want);
        assert.ok(crypto.verify(hash, data, k.publicKey, raw), alg);
      } else {
        assert.equal(alg, type);
        const rs = reader(raw);
        const size = { 'ecdsa-sha2-nistp256': 32, 'ecdsa-sha2-nistp384': 48, 'ecdsa-sha2-nistp521': 66 }[type];
        const pad = (b) => { let x = b; while (x.length > size) x = x.subarray(1); return Buffer.concat([Buffer.alloc(size - x.length), x]); };
        const p1363 = Buffer.concat([pad(rs.bytes()), pad(rs.bytes())]);
        assert.ok(crypto.verify({ 'ecdsa-sha2-nistp256': 'sha256', 'ecdsa-sha2-nistp384': 'sha384', 'ecdsa-sha2-nistp521': 'sha512' }[type], data, { key: k.publicKey, dsaEncoding: 'ieee-p1363' }, p1363), type);
      }
    }
    // A key it does not hold, a request it cannot read, and every other request: failure.
    const other = opensshKey('ssh-ed25519');
    assert.equal(body(agent.answer(request(13, sshString(Buffer.from(other.publicKey.split(' ')[1], 'base64')), sshString(data), uint32(0)), [signer]))[0], 5);
    assert.equal(body(agent.answer(request(13, Buffer.from([0, 0])), [signer]))[0], 5);
    for (const t of [17, 18, 19, 22, 23, 27]) assert.equal(body(agent.answer(request(t, sshString(k.privateKey)), [signer]))[0], 5, `request ${t} refused`);
  }
});

// One request on the agent's socket: its answer's body.
const ask = (socket, msg) => new Promise((resolve, reject) => {
  const c = net.connect(socket);
  let buf = Buffer.alloc(0);
  c.on('data', (d) => { buf = Buffer.concat([buf, d]); if (buf.length >= 4 && buf.length >= 4 + buf.readUInt32BE(0)) { c.end(); resolve(buf.subarray(4, 4 + buf.readUInt32BE(0))); } });
  c.on('error', reject);
  c.write(Buffer.concat([uint32(msg.length), msg]));
});

test('a run\'s agent reads its keys only when first asked, and its socket is gone when it ends', async () => {
  const key = opensshKey('ssh-ed25519');
  let asked = 0;
  const a = await agent.start(async () => { asked++; return [{ name: 'Infra key', privateKey: key.privateKey }]; });
  assert.equal(asked, 0, 'no key is read before ssh asks');
  assert.equal(fs.statSync(a.socket).mode & 0o777, 0o666);
  assert.equal(fs.statSync(agent.agentsDir()).mode & 0o777, 0o711, 'its folder can be passed through, not listed');
  const ids = reader((await ask(a.socket, request(11))).subarray(1));
  assert.equal(ids.uint32(), 1);
  await ask(a.socket, request(11));
  assert.equal(asked, 1, 'and once');
  a.close();
  assert.equal(fs.existsSync(a.socket), false);
  await assert.rejects(ask(a.socket, request(11)));
});

test('ssh-add lists the run agent\'s keys, where OpenSSH is installed', { timeout: 20_000 }, async (t) => {
  try { execFileSync('ssh-add', ['-h'], { stdio: 'ignore' }); } catch (e) { if (e.code === 'ENOENT') return t.skip('no ssh-add here'); }
  const key = opensshKey('ssh-ed25519');
  const a = await agent.start(async () => [{ name: 'Infra key', privateKey: key.privateKey }]);
  try {
    // Not execFileSync: the agent answers from this same process, whose event loop must keep running.
    const out = (await promisify(execFile)('ssh-add', ['-L'], { env: { ...process.env, SSH_AUTH_SOCK: a.socket }, timeout: 10_000 })).stdout;
    assert.equal(out.trim(), `${key.publicKey.split(' ').slice(0, 2).join(' ')} Infra key`);
  } finally { a.close(); }
});

// ---------- in a script job's run ----------

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.stop());

test('a run of a script job with logins has SSH_AUTH_SOCK to its own agent, gone after the run', { timeout: 30_000 }, async () => {
  const bot = await makeBot(srv, { name: 'Infra' });
  const add = await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Infra review', kind: 'script', cron: '0 6 * * *', aiWhen: 'never', logins: ['Infra key'], script: 'test -S "$SSH_AUTH_SOCK" && echo "sock=$SSH_AUTH_SOCK"' } });
  assert.equal(add.status, 201, JSON.stringify(add.data));
  const job = add.data.job || add.data;
  await srv.api(`/bots/${bot.id}/jobs/${job.id}/run`, { method: 'POST' });
  const run = await waitFor(async () => (await srv.api(`/runs?botId=${bot.id}`)).data.find((r) => r.kind === 'script' && r.status !== 'running'), { timeout: 20_000, what: 'the script' });
  const socket = run.result.match(/sock=(\S+)/)?.[1];
  assert.ok(socket, run.result);
  assert.equal(fs.existsSync(socket), false, 'gone with the run');
  // A job without logins gets none.
  const plain = await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Plain', kind: 'script', cron: '0 6 * * *', aiWhen: 'never', script: 'echo "sock=[$SSH_AUTH_SOCK]"' } });
  const pj = plain.data.job || plain.data;
  await srv.api(`/bots/${bot.id}/jobs/${pj.id}/run`, { method: 'POST' });
  const r2 = await waitFor(async () => (await srv.api(`/runs?botId=${bot.id}`)).data.find((r) => r.kind === 'script' && r.jobId === pj.id && r.status !== 'running'), { timeout: 20_000, what: 'the plain script' });
  assert.match(r2.result, /sock=\[\]/);
});

test('OpenSSH signs through the agent with keys ssh-keygen made, and its signatures verify', { timeout: 60_000 }, async (t) => {
  try { execFileSync('ssh-keygen', ['-?'], { stdio: 'ignore' }); } catch (e) { if (e.code === 'ENOENT') return t.skip('no ssh-keygen here'); }
  const dir = fs.mkdtempSync(require('node:path').join(require('node:os').tmpdir(), 'botdot-agent-'));
  const run = promisify(execFile);
  try {
    for (const type of ['ed25519', 'rsa', 'ecdsa']) {
      const f = `${dir}/${type}`;
      execFileSync('ssh-keygen', ['-q', '-t', type, '-N', '', '-f', f]);
      const privateKey = fs.readFileSync(f, 'utf8');
      fs.rmSync(f); // only the public key is left: ssh-keygen has to sign through the agent
      fs.writeFileSync(`${dir}/msg`, 'hello');
      const a = await agent.start(async () => [{ name: 'k', privateKey }]);
      try { await run('ssh-keygen', ['-Y', 'sign', '-f', `${f}.pub`, '-n', 'file', `${dir}/msg`], { env: { ...process.env, SSH_AUTH_SOCK: a.socket }, timeout: 10_000 }); } finally { a.close(); }
      const [kind, b64] = fs.readFileSync(`${f}.pub`, 'utf8').trim().split(' ');
      fs.writeFileSync(`${dir}/allowed`, `me ${kind} ${b64}\n`);
      const out = execFileSync('ssh-keygen', ['-Y', 'verify', '-f', `${dir}/allowed`, '-I', 'me', '-n', 'file', '-s', `${dir}/msg.sig`], { input: 'hello' }).toString();
      assert.match(out, /Good "file" signature for me/, type);
      fs.rmSync(`${dir}/msg.sig`);
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
