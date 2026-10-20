// The owner adds an SSH key in the Vault (#160): an OpenSSH private key, pasted or picked, or a new ed25519 key made
// by botdot. Its public key and fingerprint are worked out from the private key (lib/ssh-keys.js), as ssh-keygen
// does; it is saved as Bitwarden's own SSH key item in the bot-dot folder, the kind run_with_ssh_key uses, and no
// answer holds its private key. Another format, a passphrase or text that is no key is refused with a sentence.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');

process.env.BOT_DOT_VAULT_KEY ||= crypto.randomBytes(32).toString('hex');
const FAKE_BW = path.join(__dirname, 'fixtures', 'fake-bw.js');
process.env.BW_BIN = FAKE_BW;
const sshKeys = require('../lib/ssh-keys');
const bitwardenLib = require('../lib/bitwarden');
const { startServer, makeBot } = require('./helpers');

const CLIENT_ID = 'user.00000000-0000-0000-0000-000000000000';
const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-ssh-add-'));
const hasSshKeygen = spawnSync('ssh-keygen', ['-?'], { stdio: 'ignore' }).error === undefined;
// No private key in the repository, nor its header in one piece: each test makes its own.
const header = (what) => ['-----BEGIN', `${what}-----`].join(' ');
const footer = (what) => ['-----END', `${what}-----`].join(' ');
const bodyLines = (pem) => pem.split('\n').filter((l) => l && !l.startsWith('-----'));

test('a generated key is an OpenSSH ed25519 key without a passphrase, and reading it back gives its public key and fingerprint', () => {
  const k = sshKeys.generate('botdot:Tailnet');
  assert.ok(k.privateKey.startsWith(`${header('OPENSSH PRIVATE KEY')}\n`));
  assert.ok(k.privateKey.endsWith(`${footer('OPENSSH PRIVATE KEY')}\n`));
  assert.match(k.publicKey, /^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5[A-Za-z0-9+/]+=* botdot:Tailnet$/);
  assert.match(k.fingerprint, /^SHA256:[A-Za-z0-9+/]{43}$/);
  assert.deepEqual(sshKeys.readPrivateKey(k.privateKey), k);
  assert.notEqual(sshKeys.generate('x').fingerprint, k.fingerprint, 'a new key each time');
  assert.ok(sshKeys.generate('a\nb').publicKey.endsWith(' a b'), 'the comment stays on one line');
});

test('ssh-keygen reads a generated key, and agrees with the public key and fingerprint read from its own keys', { skip: !hasSshKeygen && 'no ssh-keygen here' }, (t) => {
  const dir = scratch();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const gen = sshKeys.generate('botdot:Backup');
  fs.writeFileSync(path.join(dir, 'gen'), gen.privateKey, { mode: 0o600 });
  assert.equal(execFileSync('ssh-keygen', ['-y', '-f', path.join(dir, 'gen')], { encoding: 'utf8' }).trim(), gen.publicKey);
  assert.equal(execFileSync('ssh-keygen', ['-l', '-f', path.join(dir, 'gen')], { encoding: 'utf8' }).split(' ')[1], gen.fingerprint);
  for (const [type, extra] of [['ed25519', []], ['rsa', ['-b', '2048']], ['ecdsa', []]]) {
    const file = path.join(dir, type);
    execFileSync('ssh-keygen', ['-q', '-t', type, ...extra, '-N', '', '-C', `me@${type}`, '-f', file]);
    const k = sshKeys.readPrivateKey(fs.readFileSync(file, 'utf8').replace(/\n/g, '\r\n')); // as a Windows editor saves it
    assert.equal(k.publicKey, fs.readFileSync(`${file}.pub`, 'utf8').trim(), type);
    assert.equal(k.fingerprint, execFileSync('ssh-keygen', ['-l', '-f', file], { encoding: 'utf8' }).split(' ')[1], type);
    assert.ok(!k.privateKey.includes('\r'));
  }
  // A key with a passphrase, and an RSA key in the old PEM format: refused, saying what to do.
  execFileSync('ssh-keygen', ['-q', '-t', 'ed25519', '-N', 'a passphrase', '-f', path.join(dir, 'locked')]);
  assert.throws(() => sshKeys.readPrivateKey(fs.readFileSync(path.join(dir, 'locked'), 'utf8')), /has a passphrase\. Remove it first/);
  execFileSync('ssh-keygen', ['-q', '-t', 'rsa', '-b', '2048', '-m', 'PEM', '-N', '', '-f', path.join(dir, 'pem')]);
  assert.throws(() => sshKeys.readPrivateKey(fs.readFileSync(path.join(dir, 'pem'), 'utf8')), /Only OpenSSH private keys are accepted.*ssh-keygen -p -f KEY/);
});

test('what is not an OpenSSH private key without a passphrase is refused with a sentence', () => {
  const k = sshKeys.generate('x');
  const lines = bodyLines(k.privateKey);
  assert.throws(() => sshKeys.readPrivateKey(''), /^Error: Paste the private key, or pick its file\.$/);
  assert.throws(() => sshKeys.readPrivateKey(k.publicKey), /That is a public key\. Paste the private key/);
  assert.throws(() => sshKeys.readPrivateKey('hunter2'), /That isn't an SSH private key\. It should start with/);
  assert.throws(() => sshKeys.readPrivateKey([header('RSA PRIVATE KEY'), 'MIIE', footer('RSA PRIVATE KEY')].join('\n')), /Only OpenSSH private keys are accepted/);
  assert.throws(() => sshKeys.readPrivateKey([header('PRIVATE KEY'), 'MIIE', footer('PRIVATE KEY')].join('\n')), /Only OpenSSH private keys are accepted/);
  assert.throws(() => sshKeys.readPrivateKey([header('ENCRYPTED PRIVATE KEY'), 'MIIE', footer('ENCRYPTED PRIVATE KEY')].join('\n')), /has a passphrase/);
  assert.throws(() => sshKeys.readPrivateKey('PuTTY-User-Key-File-3: ssh-ed25519\nEncryption: none\n'), /Only OpenSSH private keys are accepted.*puttygen/);
  // Cut short, or a line changed: damaged.
  assert.throws(() => sshKeys.readPrivateKey([header('OPENSSH PRIVATE KEY'), lines[0], footer('OPENSSH PRIVATE KEY')].join('\n')), /damaged or cut short/);
  assert.throws(() => sshKeys.readPrivateKey([header('OPENSSH PRIVATE KEY'), 'bm90IGEga2V5', footer('OPENSSH PRIVATE KEY')].join('\n')), /damaged or cut short/);
  // Pasted with text around it: the key alone is kept.
  assert.equal(sshKeys.readPrivateKey(`my key:\n${k.privateKey}\nthanks`).privateKey, k.privateKey);
});

// ---------- Bitwarden (lib/bitwarden.js), against the stand-in CLI ----------

async function unlocked(t) {
  const dir = scratch();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'bitwarden.json'), JSON.stringify({ server: 'https://vault.example.com', clientId: CLIENT_ID, folderId: 'folder-1' }));
  const bw = bitwardenLib.create(dir);
  await bw.unlock('fixture-master');
  await bw.whenIdle();
  t.after(() => bw.lock());
  return { bw, saved: () => JSON.parse(fs.readFileSync(path.join(dir, 'bitwarden-cli', 'items.json'), 'utf8')) };
}

test('Bitwarden: an added SSH key is an SSH key item in the bot-dot folder, shared with the bots chosen, and a bot can use it', async (t) => {
  const { bw, saved } = await unlocked(t);
  const pasted = sshKeys.generate('me@laptop');
  const item = await bw.addSshKey({ name: 'Laptop key', privateKey: pasted.privateKey, allowedBots: ['bot1'] });
  assert.deepEqual({ kind: item.kind, type: item.type, name: item.name, publicKey: item.publicKey, fingerprint: item.fingerprint, allowedBots: item.allowedBots },
    { kind: 'ssh-key', type: 'ssh-key', name: 'Laptop key', publicKey: pasted.publicKey, fingerprint: pasted.fingerprint, allowedBots: ['bot1'] });
  assert.ok(!JSON.stringify(item).includes(bodyLines(pasted.privateKey)[1]), 'no private key in the answer');
  const [kept] = saved();
  assert.equal(kept.type, 5);
  assert.equal(kept.folderId, 'folder-1');
  assert.deepEqual(kept.sshKey, { privateKey: pasted.privateKey, publicKey: pasted.publicKey, keyFingerprint: pasted.fingerprint });
  assert.equal(bw.sshKey('bot1', 'Laptop key').privateKey, pasted.privateKey, 'run_with_ssh_key gets it unchanged');
  assert.throws(() => bw.sshKey('bot2', 'Laptop key'), /isn't allowed/);

  const made = await bw.addSshKey({ name: 'Servers', generate: true });
  assert.match(made.publicKey, /^ssh-ed25519 \S+ botdot:Servers$/);
  assert.deepEqual(made.allowedBots, []);
  assert.deepEqual(bw.list().map((i) => i.name), ['Laptop key', 'Servers']);

  await assert.rejects(bw.addSshKey({ name: ' ', generate: true }), /Give the SSH key a name/);
  await assert.rejects(bw.addSshKey({ name: 'Bad', privateKey: pasted.publicKey }), /That is a public key/);
  assert.equal(saved().length, 2, 'nothing saved for a refusal');
  await bw.lock();
  await assert.rejects(bw.addSshKey({ name: 'Late', generate: true }), /locked/);
});

// ---------- the route ----------

test('POST /api/vault/ssh-keys: saves to Bitwarden, answers no private key, and refuses with a sentence', async (t) => {
  const srv = await startServer({ env: { BW_BIN: FAKE_BW } });
  t.after(() => srv.stop());
  assert.ok((await srv.api('/version')).data.features.includes('vault-ssh-key-add'));
  const add = (body) => srv.api('/vault/ssh-keys', { method: 'POST', body });
  let r = await add({ name: 'Servers', generate: true });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /SSH keys are kept in Bitwarden\. Connect it/);

  assert.equal((await srv.api('/vault/bitwarden/setup', { method: 'POST', body: { server: 'us', clientId: CLIENT_ID, clientSecret: 'fixture-client-secret' } })).status, 200);
  r = await add({ name: 'Servers', generate: true });
  assert.equal(r.status, 423);
  assert.match(r.data.error, /Bitwarden is locked/);
  assert.equal((await srv.api('/vault/bitwarden/unlock', { method: 'POST', body: { password: 'fixture-master' } })).status, 200);

  const ops = await makeBot(srv, { name: 'Ops' });
  const pasted = sshKeys.generate('me@laptop');
  r = await add({ name: 'Laptop key', privateKey: pasted.privateKey, allowedBots: [ops.id] });
  assert.equal(r.status, 201);
  assert.equal(r.data.kind, 'ssh-key');
  assert.equal(r.data.publicKey, pasted.publicKey);
  assert.equal(r.data.fingerprint, pasted.fingerprint);
  assert.deepEqual(r.data.allowedBots, [ops.id]);
  r = await add({ name: 'Servers', generate: true });
  assert.equal(r.status, 201);
  assert.match(r.data.publicKey, /^ssh-ed25519 \S+ botdot:Servers$/);

  r = await add({ name: 'Wrong', privateKey: [header('RSA PRIVATE KEY'), 'MIIE', footer('RSA PRIVATE KEY')].join('\n') });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /Only OpenSSH private keys are accepted/);
  r = await add({ name: 'Wrong', generate: 'yes', privateKey: '' });
  assert.equal(r.status, 400, 'only generate: true generates');
  assert.match(r.data.error, /Paste the private key/);

  const vault = (await srv.api('/vault')).data;
  assert.deepEqual(vault.map((i) => [i.name, i.kind]), [['Laptop key', 'ssh-key'], ['Servers', 'ssh-key']]);
  const secretLine = bodyLines(pasted.privateKey)[1];
  assert.ok(!JSON.stringify(vault).includes(secretLine), 'the list holds no private key');
  assert.ok(!srv.log.join('').includes(secretLine), 'nor the log');
});
