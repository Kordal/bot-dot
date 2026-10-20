// Files as secrets of the Vault (#157): the owner picks a .pem in the Vault, botdot keeps it in Bitwarden's bot-dot
// folder (a secure note with the file in hidden fields), shows only its name and size, and a bot it is shared with uses
// it in one command on its computer (run_with_file): a 0600 file at $BOTDOT_FILE that is gone when the command ends.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const util = require('node:util');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');

process.env.BOT_DOT_VAULT_KEY ||= crypto.randomBytes(32).toString('hex');
const FAKE_BW = path.join(__dirname, 'fixtures', 'fake-bw.js');
process.env.BW_BIN = FAKE_BW;
const vaultFiles = require('../lib/vault-files');
const bitwardenLib = require('../lib/bitwarden');
const { hideFile } = require('../lib/vault-http');
const { startServer, makeBot, heldRun } = require('./helpers');
const { rpcClient } = require('./memory-helpers');

const CLIENT_ID = 'user.00000000-0000-0000-0000-000000000000';
const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-files-'));
// A private key made for each run: none in the repository (gitleaks, tests.yml).
const PEM = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
const PEM_BYTES = Buffer.from(PEM);
const BODY = PEM.split('\n').filter((l) => l && !l.startsWith('-----'));
const holdsFile = (value) => BODY.some((line) => JSON.stringify(value).includes(line)) || JSON.stringify(value).includes(PEM_BYTES.toString('base64').slice(0, 40));
const b64 = (s) => Buffer.from(s).toString('base64');

// ---------- what botdot takes (lib/vault-files.js) ----------

test('a .pem up to 64 KB is taken; an empty, too big or other file is refused with a sentence', () => {
  assert.deepEqual(vaultFiles.readFile({ fileName: 'key.pem', content: PEM_BYTES.toString('base64') }), { fileName: 'key.pem', bytes: PEM_BYTES });
  assert.equal(vaultFiles.readFile({ fileName: 'C:\\Users\\me\\GitHub App.PEM', content: PEM_BYTES.toString('base64') }).fileName, 'GitHub_App.pem', 'its own name, made safe');
  const big = Buffer.concat([PEM_BYTES, Buffer.alloc(64 * 1024)]);
  assert.throws(() => vaultFiles.readFile({ fileName: 'key.pem', content: big.toString('base64') }), /bigger than 64 KB/);
  const justOver = Buffer.concat([PEM_BYTES, Buffer.alloc(64 * 1024 - PEM_BYTES.length + 1, 0x41)]);
  assert.throws(() => vaultFiles.readFile({ fileName: 'key.pem', content: justOver.toString('base64') }), /That file is 65 KB\. A file in the Vault can be at most 64 KB\./);
  const exactly = Buffer.concat([PEM_BYTES, Buffer.alloc(64 * 1024 - PEM_BYTES.length, 0x41)]);
  assert.equal(vaultFiles.readFile({ fileName: 'key.pem', content: exactly.toString('base64') }).bytes.length, 64 * 1024);
  assert.throws(() => vaultFiles.readFile({ fileName: 'key.pem', content: '' }), /^Error: Pick the file\.$/);
  assert.throws(() => vaultFiles.readFile({ fileName: 'id_ed25519', content: PEM_BYTES.toString('base64') }), /The Vault takes only \.pem files for now\./);
  assert.throws(() => vaultFiles.readFile({ fileName: 'notes.txt', content: b64('hello') }), /only \.pem files/);
  assert.throws(() => vaultFiles.readFile({ fileName: 'key.pem', content: b64('hello there') }), /isn't a PEM file/);
  assert.throws(() => vaultFiles.readFile({ fileName: 'key.pem', content: 'not base64!' }), /Couldn't read the file/);
  assert.deepEqual(vaultFiles.ACCEPTED, ['.pem']);
});

test('in Bitwarden fields the file comes back byte for byte, whatever order the fields are in', () => {
  const bytes = crypto.randomBytes(64 * 1024);
  const fields = vaultFiles.toFields('blob.pem', bytes);
  assert.equal(fields[0].name, 'botdot-file');
  assert.equal(fields[0].value, 'blob.pem');
  assert.ok(fields.slice(1).every((f) => f.type === 1 && f.value.length <= 3000), 'hidden, and small enough for a field');
  const back = vaultFiles.fromFields([...fields].reverse());
  assert.ok(Buffer.from(back.content, 'base64').equals(bytes));
  assert.equal(back.size, bytes.length);
  assert.equal(back.fileName, 'blob.pem');
});

test('hideFile blanks the file, its base64 and each line of its body', () => {
  const hide = hideFile(PEM_BYTES);
  assert.equal(hide(`got ${BODY[1]} and ${BODY[0]}`), 'got [hidden] and [hidden]');
  assert.equal(hide(PEM.trim()), '[hidden]');
  assert.equal(hide(PEM_BYTES.toString('base64')), '[hidden]');
  assert.equal(hide('Verified OK'), 'Verified OK');
});

// ---------- Bitwarden (lib/bitwarden.js), against the stand-in CLI ----------

async function unlocked(t) {
  const dir = scratch();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'bitwarden.json'), JSON.stringify({ server: 'https://vault.example.com', clientId: CLIENT_ID, folderId: 'folder-1' }));
  const bw = bitwardenLib.create(dir);
  fs.writeFileSync(path.join(dir, 'bitwarden-cli', 'items.json'), JSON.stringify([{ id: 'i-note', type: 2, folderId: 'folder-1', name: 'A note', notes: 'secret note', fields: [{ name: 'other', value: 'x', type: 1 }] }]));
  await bw.unlock('fixture-master');
  await bw.whenIdle();
  t.after(() => bw.lock());
  return { bw, saved: () => JSON.parse(fs.readFileSync(path.join(dir, 'bitwarden-cli', 'items.json'), 'utf8')) };
}

test('Bitwarden: an added file is a secure note of the bot-dot folder, listed by its name and size, and only a bot it is shared with gets it', async (t) => {
  const { bw, saved } = await unlocked(t);
  const item = await bw.addFile({ name: 'GitHub App', fileName: 'app.pem', content: PEM_BYTES.toString('base64'), allowedBots: ['bot1'] });
  assert.deepEqual({ kind: item.kind, type: item.type, name: item.name, fileName: item.fileName, size: item.size, allowedBots: item.allowedBots },
    { kind: 'file', type: 'file', name: 'GitHub App', fileName: 'app.pem', size: PEM_BYTES.length, allowedBots: ['bot1'] });
  assert.ok(!holdsFile(item), 'no content in the answer');
  const kept = saved().find((i) => i.id === item.id);
  assert.equal(kept.type, 2);
  assert.equal(kept.folderId, 'folder-1');
  assert.ok(!JSON.stringify(kept.notes).includes(BODY[0]), 'not in the note');
  assert.deepEqual(bw.list().map((i) => [i.name, i.kind]), [['GitHub App', 'file']], 'a secure note botdot did not make is still not read');
  assert.deepEqual(bw.forBot('bot1'), [{ kind: 'file', name: 'GitHub App', type: 'file', fileName: 'app.pem', size: PEM_BYTES.length }]);
  assert.deepEqual(bw.notSharedWith('bot2'), [{ kind: 'file', name: 'GitHub App', type: 'file' }]);

  const got = bw.file('bot1', 'github app');
  assert.ok(Buffer.from(got.content, 'base64').equals(PEM_BYTES), 'byte for byte');
  assert.equal(got.fileName, 'app.pem');
  assert.throws(() => bw.file('bot2', 'GitHub App'), /isn't allowed to use the file "GitHub App"\. Ask the owner to share it with you in the Vault/);
  assert.throws(() => bw.file('bot1', 'A note'), /No saved file called "A note"/);
  assert.throws(() => bw.credentials('bot1', 'GitHub App'), /No saved login/, 'a file is no login');

  // Shared with another bot, as any item: by its bots alone.
  await bw.update(item.id, { allowedBots: ['bot2'] });
  assert.equal(bw.file('bot2', 'GitHub App').name, 'GitHub App');

  const unnamed = await bw.addFile({ fileName: 'cert.pem', content: PEM_BYTES.toString('base64') });
  assert.equal(unnamed.name, 'cert.pem', 'named after its file');
  assert.deepEqual(unnamed.allowedBots, []);
  const before = saved().length;
  await assert.rejects(bw.addFile({ name: 'Bad', fileName: 'a.txt', content: b64('x') }), /only \.pem/);
  assert.equal(saved().length, before, 'nothing saved for a refusal');
  assert.equal(await bw.remove(item.id), true);
  await bw.lock();
  await assert.rejects(bw.addFile({ fileName: 'late.pem', content: PEM_BYTES.toString('base64') }), /locked/);
});

// ---------- the docker calls (lib/computers.js runWithFile), with a real sh for the file's own steps ----------

let calls = [];
let onRun = () => ({});
const START = (args) => args.some((a) => String(a).includes('botdot-file-XXXXXXXXXX'));
const REMOVE = (args) => args.includes('rm') && args.includes('-rf');
// The steps that make and remove the file run here for real, as the bot would in its computer; the command is onRun's.
function local(args, input) {
  const at = args.indexOf('sh');
  return childProcess.spawnSync(args[at], args.slice(at + 1), { input, encoding: 'utf8' });
}
function fakeExecFile(file, args, opts, cb) {
  const call = { file, args, opts, stdin: null };
  calls.push(call);
  setImmediate(() => {
    if (START(args)) { const r = local(args, call.stdin); return cb(r.status ? Object.assign(new Error('failed'), { code: r.status }) : null, r.stdout, r.stderr); }
    const out = onRun(call);
    if (out.code) return cb(Object.assign(new Error('failed'), { code: out.code }), out.stdout || '', out.stderr || '');
    cb(null, out.stdout || '', '');
  });
  return { stdin: { on() {}, end(data) { call.stdin = data ?? null; } } };
}
fakeExecFile[util.promisify.custom] = async (file, args, opts) => {
  calls.push({ file, args, opts, stdin: null });
  if (REMOVE(args)) childProcess.spawnSync(args[args.indexOf('rm')], args.slice(args.indexOf('rm') + 1));
  return { stdout: '', stderr: '' };
};
const realExecFile = childProcess.execFile;
childProcess.execFile = fakeExecFile;
delete require.cache[require.resolve('../lib/computers')];
const computers = require('../lib/computers');
childProcess.execFile = realExecFile;
delete require.cache[require.resolve('../lib/computers')];

const OPS = { bot: 'ops', screen: 1 };
const fileOf = (call) => (call.args.find((a) => String(a).startsWith('BOTDOT_FILE=')) || '').slice('BOTDOT_FILE='.length);

test('runWithFile: the file is there for the command, 0600 in a 0700 folder, and gone after it, also when it fails or runs out of time', { skip: process.platform === 'win32' }, async () => {
  for (const [ending, answer, expect] of [
    ['done', { stdout: 'Verified OK\n' }, { code: 0, stdout: 'Verified OK\n', timedOut: false }],
    ['failed', { code: 1, stderr: 'bad sig\n' }, { code: 1, timedOut: false }],
    ['ran out of time', { code: 124 }, { code: 124, timedOut: true }],
  ]) {
    calls = [];
    let seen = null;
    onRun = (call) => {
      const at = fileOf(call);
      seen = { at, mode: fs.statSync(at).mode & 0o777, dirMode: fs.statSync(path.dirname(at)).mode & 0o777, bytes: fs.readFileSync(at) };
      return answer;
    };
    const r = await computers.runWithFile(OPS, { command: 'openssl dgst -sha256 -sign "$BOTDOT_FILE" data', fileName: 'app.pem', content: PEM_BYTES.toString('base64'), timeoutSeconds: 30 });
    assert.equal(r.code, expect.code, ending);
    assert.equal(r.timedOut, expect.timedOut, ending);
    if (expect.stdout) assert.equal(r.stdout, expect.stdout);
    assert.match(seen.at, /^\/tmp\/botdot-file-[A-Za-z0-9]+\/app\.pem$/, 'at its own name, in a new folder');
    assert.equal(seen.mode, 0o600, ending);
    assert.equal(seen.dirMode, 0o700, ending);
    assert.ok(seen.bytes.equals(PEM_BYTES), 'byte for byte');
    assert.ok(!fs.existsSync(path.dirname(seen.at)), `gone after it ${ending}`);
    const name = computers.containerName('ops');
    const [start, run, remove] = calls;
    assert.deepEqual(start.args.slice(0, 5), ['exec', '-i', '-u', 'box', name], 'made as the bot user');
    assert.ok(Buffer.from(start.stdin).equals(PEM_BYTES), 'the bytes on stdin');
    assert.deepEqual(run.args.slice(0, 3), ['exec', '-u', 'box']);
    assert.deepEqual(run.args.slice(run.args.indexOf(name) + 1), ['timeout', '-k', '5', '30', 'sh', '-c', 'mkdir -p "$1" 2>/dev/null; cd "$1" 2>/dev/null; exec sh -c "$2"',
      'sh', '/workspace/ops', 'openssl dgst -sha256 -sign "$BOTDOT_FILE" data'], 'in its own folder (#105)');
    assert.deepEqual(remove.args.slice(0, 4), ['exec', '-u', 'box', name]);
    assert.equal(calls.length, 3);
    for (const c of calls) {
      assert.ok(!holdsFile(c.args), 'not on a command line');
      assert.ok(!holdsFile(c.opts?.env || {}), 'not in an environment');
    }
  }
});

const hasOpenssl = childProcess.spawnSync('openssl', ['version'], { stdio: 'ignore' }).status === 0;
test('runWithFile: a command signs with the file, the signature checks out against its public key, and the output holds no key', { skip: !hasOpenssl && 'no openssl here' }, async (t) => {
  const dir = scratch();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'data'), 'botdot #157');
  calls = [];
  // The command as the computer runs it, here: sh -c with BOTDOT_FILE, in the test's folder.
  onRun = (call) => {
    const r = childProcess.spawnSync('sh', ['-c', call.args.at(-1)], { cwd: dir, env: { ...process.env, BOTDOT_FILE: fileOf(call) }, encoding: 'latin1' });
    return { code: r.status, stdout: r.stdout, stderr: r.stderr };
  };
  const r = await computers.runWithFile(OPS, { command: 'openssl dgst -sha256 -sign "$BOTDOT_FILE" data | base64 -w0; cat "$BOTDOT_FILE"', fileName: 'app.pem', content: PEM_BYTES.toString('base64') });
  assert.equal(r.code, 0, r.stderr);
  const sig = Buffer.from(r.stdout.slice(0, r.stdout.indexOf('-----')), 'base64');
  assert.ok(crypto.verify('sha256', Buffer.from('botdot #157'), crypto.createPublicKey(PEM), sig), 'the signature verifies');
  assert.ok(holdsFile(r.stdout), 'the command printed the key');
  assert.ok(!holdsFile(hideFile(PEM_BYTES)(r.stdout)), 'which the route blanks out');
});

test('runWithFile: no command runs when the file could not be made, and a name that could leave its folder is not used', async () => {
  calls = [];
  onRun = () => ({ stdout: 'ran' });
  const fake = childProcess.spawnSync;
  childProcess.spawnSync = () => ({ status: 0, stdout: '/home/box/elsewhere\n', stderr: '' });
  let r;
  try { r = await computers.runWithFile(OPS, { command: 'true', fileName: 'app.pem', content: PEM_BYTES.toString('base64') }); } finally { childProcess.spawnSync = fake; }
  assert.deepEqual(r, { code: null, stdout: '', stderr: '', timedOut: false, error: "couldn't put the file in the computer" });
  assert.equal(calls.length, 1, 'only a folder of the shape botdot makes');

  calls = [];
  let at = '';
  onRun = (call) => { at = fileOf(call); return {}; };
  await computers.runWithFile(OPS, { command: 'true', fileName: '../../etc/passwd', content: PEM_BYTES.toString('base64') });
  assert.match(at, /^\/tmp\/botdot-file-[A-Za-z0-9]+\/file$/);
});

test('the Docker helper accepts runWithFile only in its fixed shape', async (t) => {
  const { createServer } = require('../lib/docker-helper');
  const dir = scratch();
  const socket = path.join(dir, 'helper.sock');
  const got = [];
  const server = createServer({ computers: { runWithFile: async (...args) => { got.push(args); return { code: 0, stdout: 'ok', stderr: '', timedOut: false }; } }, updates: {} });
  await new Promise((r) => server.listen(socket, r));
  t.after(async () => { await new Promise((r) => server.close(r)); fs.rmSync(dir, { recursive: true, force: true }); });
  const call = (value) => new Promise((resolve, reject) => {
    const req = http.request({ socketPath: socket, method: 'POST', path: '/call' }, (res) => {
      let data = ''; res.on('data', (b) => { data += b; }); res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(data) }));
    });
    req.on('error', reject); req.end(JSON.stringify(value));
  });
  const good = { command: 'openssl version', fileName: 'app.pem', content: PEM_BYTES.toString('base64'), timeoutSeconds: 60 };
  assert.equal((await call({ operation: 'runWithFile', args: [OPS, good] })).data.value.stdout, 'ok');
  assert.deepEqual(got, [[OPS, good]]);
  for (const args of [
    ['ops', good],
    [OPS, { ...good, user: 'root' }],
    [OPS, { ...good, command: '' }],
    [OPS, { ...good, fileName: '../app.pem' }],
    [OPS, { ...good, fileName: '.hidden' }],
    [OPS, { ...good, content: '' }],
    [OPS, { ...good, content: 'x'.repeat(100001) }],
    [OPS, { ...good, timeoutSeconds: 601 }],
  ]) assert.equal((await call({ operation: 'runWithFile', args })).status, 400, JSON.stringify(args).slice(0, 80));
  assert.equal(got.length, 1);
});

// ---------- the routes and the tools ----------

// A docker that always fails, first on PATH: the computer never starts, here and on a machine with a real Docker.
function noDocker(t) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-no-docker-'));
  fs.writeFileSync(path.join(bin, 'docker'), '#!/bin/sh\necho "no docker in this test" >&2\nexit 1\n', { mode: 0o755 });
  t.after(() => fs.rmSync(bin, { recursive: true, force: true }));
  return { PATH: `${bin}${path.delimiter}${process.env.PATH}` };
}

test('POST /api/vault/files: saves to Bitwarden, answers a name and a size, and refuses with a sentence', async (t) => {
  const srv = await startServer({ env: { BW_BIN: FAKE_BW, ...noDocker(t) } });
  t.after(() => srv.stop());
  assert.ok((await srv.api('/version')).data.features.includes('vault-files'));
  const add = (body) => srv.api('/vault/files', { method: 'POST', body });
  const pem = { fileName: 'app.pem', content: PEM_BYTES.toString('base64') };
  let r = await add(pem);
  assert.equal(r.status, 400);
  assert.match(r.data.error, /Files are kept in Bitwarden\. Connect it/);
  assert.equal((await srv.api('/vault/bitwarden/setup', { method: 'POST', body: { server: 'us', clientId: CLIENT_ID, clientSecret: 'fixture-client-secret' } })).status, 200);
  r = await add(pem);
  assert.equal(r.status, 423);
  assert.equal((await srv.api('/vault/bitwarden/unlock', { method: 'POST', body: { password: 'fixture-master' } })).status, 200);

  const ops = await makeBot(srv, { name: 'Ops', computer: 'linux', computerAlwaysOn: true });
  r = await add({ ...pem, name: 'GitHub App', allowedBots: [ops.id] });
  assert.equal(r.status, 201);
  assert.deepEqual([r.data.kind, r.data.type, r.data.name, r.data.fileName, r.data.size, r.data.allowedBots], ['file', 'file', 'GitHub App', 'app.pem', PEM_BYTES.length, [ops.id]]);
  r = await add({ fileName: 'big.pem', content: Buffer.concat([PEM_BYTES, Buffer.alloc(64 * 1024)]).toString('base64') });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /64 KB/);
  r = await add({ fileName: 'key.txt', content: PEM_BYTES.toString('base64') });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /only \.pem files/);

  const vault = (await srv.api('/vault')).data;
  assert.deepEqual(vault.map((i) => [i.name, i.kind]), [['GitHub App', 'file']]);
  assert.ok(!holdsFile(vault), 'the list holds no content');
  const chief = rpcClient(t, 'mcp-server.js', { BOT_DOT_URL: srv.base, BOT_DOT_CHIEF_KEY: srv.chiefKey });
  assert.deepEqual(await chief.json('list_vault'), [{ name: 'GitHub App', type: 'file', fileName: 'app.pem', allowedBots: ['Ops'] }]);

  // The bot's side: list_logins names it, and run_with_file goes on to the computer for a shared file only.
  const other = await makeBot(srv, { name: 'Other', computer: 'linux', computerAlwaysOn: true });
  const held = await heldRun(srv, ops);
  const tools = rpcClient(t, 'vault-mcp.js', { VAULT_URL: `${srv.base}/api/vault`, VAULT_TOKEN: held.token });
  assert.deepEqual(await tools.json('list_logins'), [{ kind: 'file', name: 'GitHub App', type: 'file', fileName: 'app.pem', size: PEM_BYTES.length }]);
  const run = (body) => srv.api('/vault/session/computer/run-with-file', { method: 'POST', headers: { 'X-Vault-Token': held.token }, body });
  assert.equal((await run({ file: 'GitHub App' })).status, 400, 'no command');
  r = await run({ file: 'Nothing', command: 'true' });
  assert.match(r.data.error, /No saved file called "Nothing"/);
  r = await run({ file: 'GitHub App', command: 'openssl dgst -sha256 -sign "$BOTDOT_FILE" data' });
  assert.equal(r.data.ok, false, 'the stand-in computer never starts');
  assert.doesNotMatch(r.data.error, /isn't allowed|Bitwarden/);
  assert.ok(!holdsFile(r.data));
  srv.release(held.rec);
  await srv.finished(held.run.id);
  srv.unhold();
  const notShared = await heldRun(srv, other);
  r = await srv.api('/vault/session/computer/run-with-file', { method: 'POST', headers: { 'X-Vault-Token': notShared.token }, body: { file: 'GitHub App', command: 'true' } });
  assert.match(r.data.error, /isn't allowed to use the file "GitHub App"/);
  srv.release(notShared.rec);
  await srv.finished(notShared.run.id);
  srv.unhold();
  assert.ok(!holdsFile(srv.log.join('')), 'nor the log');
});

test('the run_with_file tool names the file and the command, and shows what the command returned', async (t) => {
  const asked = [];
  const stub = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      asked.push({ path: req.url, body: body ? JSON.parse(body) : null });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/session/computer') return res.end('{"ok":true}');
      res.end(JSON.stringify({ ok: true, stdout: 'Verified OK\n', stderr: '', exitCode: 0 }));
    });
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  t.after(() => stub.close());
  const mcp = rpcClient(t, 'computer-mcp.js', { VAULT_URL: `http://127.0.0.1:${stub.address().port}`, VAULT_TOKEN: 'fixture', COMPUTER_CONTAINER: 'botdot-ops' });
  await mcp.request('initialize', {});
  const tool = (await mcp.request('tools/list')).tools.find((x) => x.name === 'run_with_file');
  assert.ok(tool, 'the tool is listed');
  assert.deepEqual(tool.inputSchema.required, ['file', 'command']);
  assert.match(tool.description, /BOTDOT_FILE/);
  assert.match(tool.description, /removed when the command ends/);
  assert.match(tool.description, /Every other bot/);
  const out = await mcp.request('tools/call', { name: 'run_with_file', arguments: { file: 'GitHub App', command: 'openssl dgst -sha256 -sign "$BOTDOT_FILE" data' } });
  assert.equal(out.content[0].text, 'stdout:\nVerified OK\n\nexit code: 0');
  assert.deepEqual(asked.at(-1), { path: '/session/computer/run-with-file', body: { file: 'GitHub App', command: 'openssl dgst -sha256 -sign "$BOTDOT_FILE" data', timeoutSeconds: 120 } });
});
