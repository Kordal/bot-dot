// SSH keys from the owner's Bitwarden (#44): an SSH key item (Bitwarden's type 5) in the bot-dot folder is listed
// with type `ssh-key`, by its name, fingerprint and public key only; a bot it is shared with runs a command on its
// computer with the key in an ssh-agent there (run_with_ssh_key), and never sees the private key. A bot it is not
// shared with sees its name and cannot use it. Docker is a stand-in here; the real ssh-agent is not run.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const net = require('node:net');
const util = require('node:util');
const crypto = require('node:crypto');
const childProcess = require('node:child_process');

process.env.BOT_DOT_VAULT_KEY ||= crypto.randomBytes(32).toString('hex');
const FAKE_BW = path.join(__dirname, 'fixtures', 'fake-bw.js');
process.env.BW_BIN = FAKE_BW;
const bitwardenLib = require('../lib/bitwarden');
const { hideSshKey } = require('../lib/vault-http');
const { startServer, makeBot, heldRun } = require('./helpers');
const { rpcClient } = require('./memory-helpers');

const CLIENT_ID = 'user.00000000-0000-0000-0000-000000000000';
const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-ssh-keys-'));
// A private key of OpenSSH's shape, made up for each run (no real key in the repository, nor its header in one piece).
const BODY = crypto.randomBytes(300).toString('base64').match(/.{1,70}/g);
const PRIVATE_KEY = [['-----BEGIN', 'OPENSSH PRIVATE KEY-----'].join(' '), ...BODY, ['-----END', 'OPENSSH PRIVATE KEY-----'].join(' '), ''].join('\n');
// The bot's seat on the account's computer: screen 1, display :11 (#105).
const OPS = { bot: 'ops', screen: 1 };
const PUBLIC_KEY = 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFakePublicKeyForTheTestsOnly0000000000000 tailnet';
const FINGERPRINT = 'SHA256:fakeFingerprintForTheTestsOnly0000000000000';
const SSH_ITEM = { id: 'i-ssh', type: 5, name: 'Tailnet servers', sshKey: { privateKey: PRIVATE_KEY, publicKey: PUBLIC_KEY, keyFingerprint: FINGERPRINT } };
const OTHER_SSH = { id: 'i-ssh2', type: 5, name: 'Backup box', sshKey: { privateKey: PRIVATE_KEY, publicKey: PUBLIC_KEY, keyFingerprint: FINGERPRINT } };
const holdsKey = (value) => BODY.some((line) => JSON.stringify(value).includes(line));

// ---------- Bitwarden (lib/bitwarden.js), against the stand-in CLI ----------

async function unlocked(t, items, access) {
  const dir = scratch();
  fs.writeFileSync(path.join(dir, 'bitwarden.json'), JSON.stringify({ server: 'https://vault.example.com', clientId: CLIENT_ID, folderId: 'folder-1' }));
  fs.writeFileSync(path.join(dir, 'bitwarden-access.json'), JSON.stringify(access));
  const bw = bitwardenLib.create(dir);
  fs.writeFileSync(path.join(dir, 'bitwarden-cli', 'items.json'), JSON.stringify(items));
  await bw.unlock('fixture-master');
  t.after(() => bw.lock());
  return bw;
}

test('Bitwarden: an SSH key item is listed with type ssh-key, its name, fingerprint and public key, and never its private key', async (t) => {
  const bw = await unlocked(t, [SSH_ITEM, OTHER_SSH, { id: 'i-note', type: 2, name: 'A note', notes: 'secret note' }], { 'i-ssh': { bots: ['bot1'] } });
  const listed = bw.list();
  assert.deepEqual(listed.map((i) => [i.name, i.kind, i.type]), [['Tailnet servers', 'ssh-key', 'ssh-key'], ['Backup box', 'ssh-key', 'ssh-key']], 'a secure note is still not read');
  assert.equal(listed[0].fingerprint, FINGERPRINT);
  assert.equal(listed[0].publicKey, PUBLIC_KEY);
  assert.deepEqual(listed[0].allowedBots, ['bot1']);
  assert.ok(!holdsKey(listed), 'no private key in the list');
  // The bot it is shared with sees it as one it may use; another bot sees its name and type only.
  assert.deepEqual(bw.forBot('bot1'), [{ kind: 'ssh-key', name: 'Tailnet servers', type: 'ssh-key', publicKey: PUBLIC_KEY, fingerprint: FINGERPRINT }]);
  assert.deepEqual(bw.notSharedWith('bot1'), [{ kind: 'ssh-key', name: 'Backup box', type: 'ssh-key' }]);
  assert.deepEqual(bw.notSharedWith('bot2').map((i) => i.name), ['Tailnet servers', 'Backup box']);
  assert.deepEqual(bw.forBot('bot2'), []);
});

test('Bitwarden: the private key is handed out for a bot it is shared with only', async (t) => {
  const reprompt = { ...SSH_ITEM, id: 'i-mine', name: 'Mine', reprompt: 1 };
  const empty = { id: 'i-empty', type: 5, name: 'Empty', sshKey: { publicKey: PUBLIC_KEY } };
  const bw = await unlocked(t, [SSH_ITEM, OTHER_SSH, reprompt, empty], { 'i-ssh': { bots: ['bot1'] }, 'i-mine': { bots: ['bot1'] }, 'i-empty': { bots: ['bot1'] } });
  assert.deepEqual(bw.sshKey('bot1', 'tailnet servers'), { name: 'Tailnet servers', fingerprint: FINGERPRINT, privateKey: PRIVATE_KEY });
  assert.equal(bw.sshKey('bot1', 'i-ssh').name, 'Tailnet servers', 'by its id too');
  assert.throws(() => bw.sshKey('bot2', 'Tailnet servers'), /isn't allowed to use the SSH key "Tailnet servers"\. Ask the owner to share it with you in the Vault/);
  assert.throws(() => bw.sshKey('bot1', 'Backup box'), /isn't allowed/);
  assert.throws(() => bw.sshKey('bot1', 'Mine'), /asks for the master password again/);
  assert.throws(() => bw.sshKey('bot1', 'Empty'), /has no private key/);
  assert.throws(() => bw.sshKey('bot1', 'Nothing'), /No saved ssh-key called "Nothing"/);
  // An SSH key is no login: a login's tools do not find it.
  assert.throws(() => bw.credentials('bot1', 'Tailnet servers'), /No saved login/);
  bw.lock();
  assert.throws(() => bw.sshKey('bot1', 'Tailnet servers'), /locked/);
});

test('hideSshKey blanks the key and each line of its body', () => {
  const hide = hideSshKey(PRIVATE_KEY);
  assert.equal(hide(`got ${BODY[2]} and ${BODY[0]}`), 'got [hidden] and [hidden]');
  assert.equal(hide(PRIVATE_KEY.trim()), '[hidden]');
  assert.equal(hide('Permission denied (publickey).'), 'Permission denied (publickey).');
});

// ---------- the docker calls (lib/computers.js runWithSshKey) ----------

let calls = [];
let answer = () => '';
function fakeExecFile(file, args, opts, cb) {
  const call = { file, args, opts, stdin: null };
  calls.push(call);
  // A caller writes its stdin right after the call, so it is there when the answer comes.
  setImmediate(() => {
    const out = answer(call);
    cb(null, typeof out === 'string' ? out : out?.stdout ?? '', out?.stderr ?? '');
  });
  return { stdin: { on() {}, end(data) { call.stdin = String(data ?? ''); } } };
}
fakeExecFile[util.promisify.custom] = async (file, args, opts) => {
  const call = { file, args, opts, stdin: null };
  calls.push(call);
  const out = answer(call);
  return { stdout: typeof out === 'string' ? out : '', stderr: '' };
};
const realExecFile = childProcess.execFile;
childProcess.execFile = fakeExecFile;
delete require.cache[require.resolve('../lib/computers')];
const computers = require('../lib/computers');
childProcess.execFile = realExecFile;
delete require.cache[require.resolve('../lib/computers')];

const HELPER = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'desktop', 'botdot-ssh-add'), 'utf8');
const AGENT_DIR = '/tmp/botdot-ssh-AbC123xYz9';
// A current computer whose agent starts, takes the key and runs the command; `change` alters one answer.
function computer(change = {}) {
  return (call) => {
    const { args } = call;
    if (args[0] === 'inspect') return change.labels ?? '2|2';
    if (args[0] !== 'exec') return '';
    if (args.some((a) => String(a).includes('ssh-agent -D'))) return change.agent ?? `${AGENT_DIR} 4242`;
    if (args.includes('/usr/bin/python3')) return change.load ?? '{"ok": true}';
    if (args.includes('timeout')) return change.run ?? { stdout: ' 10:00:00 up 3 days\n' };
    return '';
  };
}
const execs = () => calls.filter((c) => c.args[0] === 'exec');
const step = (name) => execs().find((c) => ({
  agent: () => c.args.some((a) => String(a).includes('ssh-agent -D')),
  load: () => c.args.includes('/usr/bin/python3'),
  run: () => c.args.includes('timeout'),
  stop: () => c.args.some((a) => String(a).startsWith('kill "$1"')),
}[name])());

test('runWithSshKey: the agent as the bot, the key as root on stdin only, the command with SSH_AUTH_SOCK, and the agent ended', async () => {
  calls = []; answer = computer();
  const r = await computers.runWithSshKey(OPS, { command: 'ssh admin@server.example.ts.net uptime', privateKey: PRIVATE_KEY, timeoutSeconds: 30 });
  assert.deepEqual(r, { code: 0, stdout: ' 10:00:00 up 3 days\n', stderr: '', timedOut: false });
  const name = computers.containerName('ops');
  const agent = step('agent');
  assert.deepEqual(agent.args.slice(0, 4), ['exec', '-u', 'box', name]);
  assert.equal(agent.args.at(-1), '90', 'the agent drops the key a minute after the time limit');
  const load = step('load');
  assert.deepEqual(load.args.slice(0, 11), ['exec', '-i', '-u', 'root', '-w', '/', name, '/usr/bin/python3', '-I', '-c', HELPER], "botdot's own copy of the loader, as root");
  assert.deepEqual(load.args.slice(11), [`${AGENT_DIR}/agent`, '4242', '90', 'box'], 'to that agent, its pid and its user');
  assert.equal(load.stdin, PRIVATE_KEY, 'the key on stdin');
  const run = step('run');
  assert.deepEqual(run.args.slice(0, 3), ['exec', '-u', 'box']);
  assert.equal(run.args[run.args.indexOf(`SSH_AUTH_SOCK=${AGENT_DIR}/agent`) - 1], '-e');
  assert.deepEqual(run.args.slice(run.args.indexOf(name) + 1), ['timeout', '-k', '5', '30', 'sh', '-c', 'mkdir -p "$1" 2>/dev/null; cd "$1" 2>/dev/null; exec sh -c "$2"',
    'sh', '/workspace/ops', 'ssh admin@server.example.ts.net uptime'], 'in its own folder (#105)');
  const stop = step('stop');
  assert.deepEqual(stop.args.slice(0, 4), ['exec', '-u', 'box', name]);
  assert.deepEqual(stop.args.slice(-2), ['4242', AGENT_DIR]);
  assert.equal(execs().length, 4);
  assert.deepEqual([agent, load, run, stop].map((c) => execs().indexOf(c)), [0, 1, 2, 3], 'in that order');
  // Nowhere but that one stdin: no command line, no environment, no other stdin.
  for (const c of calls) {
    assert.ok(!holdsKey(c.args), `not on a command line: ${c.args[0]} ${c.args[1]}`);
    assert.ok(!holdsKey(c.opts?.env || {}), 'not in an environment');
    if (c !== load) assert.ok(!c.stdin || !holdsKey(c.stdin), 'no other stdin');
  }
});

test('runWithSshKey: no command runs when the agent does not start or the key does not load, and the agent is ended', async () => {
  calls = []; answer = computer({ agent: '' });
  let r = await computers.runWithSshKey(OPS, { command: 'ssh host true', privateKey: PRIVATE_KEY });
  assert.equal(r.code, null);
  assert.match(r.error, /couldn't start an ssh-agent/);
  assert.ok(!step('load') && !step('run'), 'no key sent, no command run');

  calls = []; answer = computer({ agent: '/home/box/evil 1' });
  r = await computers.runWithSshKey(OPS, { command: 'ssh host true', privateKey: PRIVATE_KEY });
  assert.match(r.error, /couldn't start an ssh-agent/, 'only a folder of the shape botdot makes');
  assert.ok(!step('load'));

  calls = []; answer = computer({ load: '{"ok": false, "error": "the ssh-agent\'s socket was not the agent botdot started"}' });
  r = await computers.runWithSshKey(OPS, { command: 'ssh host true', privateKey: PRIVATE_KEY });
  assert.deepEqual(r, { code: null, stdout: '', stderr: '', timedOut: false, error: "the ssh-agent's socket was not the agent botdot started" });
  assert.ok(!step('run'), 'no command run');
  assert.ok(step('stop'), 'the agent is ended');

  calls = []; answer = computer({ load: 'Traceback…' });
  r = await computers.runWithSshKey(OPS, { command: 'ssh host true', privateKey: PRIVATE_KEY });
  assert.match(r.error, /couldn't load the key/);
  assert.ok(!step('run') && step('stop'));
});

test('runWithSshKey: a computer made before the bot lost root gets no key', async () => {
  calls = []; answer = computer({ labels: '2|' });
  const r = await computers.runWithSshKey({ bot: 'old', screen: 1 }, { command: 'ssh host true', privateKey: PRIVATE_KEY });
  assert.equal(r.code, null);
  assert.match(r.error, /older than botdot's SSH keys.*reset/);
  assert.equal(execs().length, 0, 'nothing ran in it');
});

// ---------- the Docker helper passes it on, in its fixed shape only ----------

test('the Docker helper accepts runWithSshKey only in its fixed shape', async (t) => {
  const { createServer } = require('../lib/docker-helper');
  const dir = scratch();
  const socket = path.join(dir, 'helper.sock');
  const got = [];
  const server = createServer({ computers: { runWithSshKey: async (...args) => { got.push(args); return { code: 0, stdout: 'ok', stderr: '', timedOut: false }; } }, updates: {} });
  await new Promise((r) => server.listen(socket, r));
  t.after(async () => { await new Promise((r) => server.close(r)); fs.rmSync(dir, { recursive: true, force: true }); });
  const call = (value) => new Promise((resolve, reject) => {
    const req = http.request({ socketPath: socket, method: 'POST', path: '/call' }, (res) => {
      let data = ''; res.on('data', (b) => { data += b; }); res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(data) }));
    });
    req.on('error', reject); req.end(JSON.stringify(value));
  });
  const good = { command: 'ssh host uptime', privateKey: PRIVATE_KEY, timeoutSeconds: 60 };
  assert.equal((await call({ operation: 'runWithSshKey', args: [OPS, good] })).data.value.stdout, 'ok');
  assert.deepEqual(got, [[OPS, good]]);
  for (const args of [
    ['../host', good],
    ['ops', good], // a bot id alone is no screen (#105)
    [OPS, { ...good, user: 'root' }],
    [OPS, { ...good, command: '' }],
    [OPS, { ...good, privateKey: '' }],
    [OPS, { ...good, privateKey: 42 }],
    [OPS, { ...good, privateKey: 'x'.repeat(65537) }],
    [OPS, { ...good, timeoutSeconds: 601 }],
    [OPS, good, 'extra'],
  ]) assert.equal((await call({ operation: 'runWithSshKey', args })).status, 400, JSON.stringify(args).slice(0, 80));
  assert.equal(got.length, 1);
});

// ---------- the loader in the computer (deploy/desktop/botdot-ssh-add) ----------

// Python as on the computer; skipped where there is none. The real ssh-agent and ssh-add are not here: this checks
// that the key goes to no program but the agent botdot started.
const PYTHON = ['/usr/bin/python3', '/usr/local/bin/python3'].find((p) => fs.existsSync(p));
test('the loader sends the key to no socket whose program is not the agent botdot started', { skip: !PYTHON && 'no python3' }, async (t) => {
  const dir = scratch();
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const sock = path.join(dir, 'agent');
  let received = 0;
  const fake = net.createServer((c) => c.on('data', (b) => { received += b.length; }));
  await new Promise((r) => fake.listen(sock, r));
  t.after(() => fake.close());
  const load = (pid, user = os.userInfo().username) => new Promise((resolve) => {
    const child = childProcess.execFile(PYTHON, ['-I', '-c', HELPER, sock, String(pid), '90', user], { timeout: 20_000 }, (err, stdout) => resolve(JSON.parse(String(stdout).trim())));
    child.stdin.end(PRIVATE_KEY);
  });
  // The listener is this test (its pid): any other pid is refused, before anything is sent.
  const wrong = await load(process.pid + 1);
  assert.deepEqual(wrong, { ok: false, error: "the ssh-agent's socket was not the agent botdot started" });
  const otherUser = await load(process.pid, 'root' === os.userInfo().username ? 'nobody' : 'root');
  assert.equal(otherUser.ok, false);
  assert.equal(received, 0, 'nothing reached the socket');
  assert.ok(!holdsKey([wrong, otherUser]), 'no key in the answer');
});

// ---------- the route and the bot's tools ----------

// A docker that always fails, first on PATH: the computer never starts, here and on a machine with a real Docker.
function noDocker(t) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-no-docker-'));
  fs.writeFileSync(path.join(bin, 'docker'), '#!/bin/sh\necho "no docker in this test" >&2\nexit 1\n', { mode: 0o755 });
  t.after(() => fs.rmSync(bin, { recursive: true, force: true }));
  return { PATH: `${bin}${path.delimiter}${process.env.PATH}` };
}

test('run_with_ssh_key: for a shared SSH key only; the Vault, the Chief and the bot see no private key', async (t) => {
  const srv = await startServer({ env: { BW_BIN: FAKE_BW, ...noDocker(t) } });
  t.after(() => srv.stop());
  const ops = await makeBot(srv, { name: 'Ops', computer: 'linux', computerAlwaysOn: true });
  assert.equal((await srv.api('/vault/bitwarden/setup', { method: 'POST', body: { server: 'us', clientId: CLIENT_ID, clientSecret: 'fixture-client-secret' } })).status, 200);
  assert.equal((await srv.api('/vault/bitwarden/unlock', { method: 'POST', body: { password: 'fixture-master' } })).status, 200);
  fs.writeFileSync(path.join(srv.data, 'bitwarden-cli', 'items.json'), JSON.stringify([SSH_ITEM, OTHER_SSH]));
  assert.equal((await srv.api('/vault/bitwarden/sync', { method: 'POST' })).status, 200);
  assert.equal((await srv.api('/vault/i-ssh', { method: 'PUT', body: { allowedBots: [ops.id] } })).status, 200);

  const vault = (await srv.api('/vault')).data;
  assert.deepEqual(vault.map((i) => [i.name, i.kind, i.type, i.fingerprint]), [['Tailnet servers', 'ssh-key', 'ssh-key', FINGERPRINT], ['Backup box', 'ssh-key', 'ssh-key', FINGERPRINT]]);
  assert.ok(!holdsKey(vault), 'the apps get no private key');
  assert.ok((await srv.api('/version')).data.features.includes('vault-ssh-keys'));
  const chief = rpcClient(t, 'mcp-server.js', { BOT_DOT_URL: srv.base, BOT_DOT_CHIEF_KEY: srv.chiefKey });
  const listed = await chief.json('list_vault');
  assert.deepEqual(listed, [
    { name: 'Tailnet servers', type: 'ssh-key', fingerprint: FINGERPRINT, allowedBots: ['Ops'] },
    { name: 'Backup box', type: 'ssh-key', fingerprint: FINGERPRINT, allowedBots: [] },
  ]);

  const held = await heldRun(srv, ops);
  const tools = rpcClient(t, 'vault-mcp.js', { VAULT_URL: `${srv.base}/api/vault`, VAULT_TOKEN: held.token });
  const logins = await tools.json('list_logins');
  assert.deepEqual(logins, [
    { kind: 'ssh-key', name: 'Tailnet servers', type: 'ssh-key', publicKey: PUBLIC_KEY, fingerprint: FINGERPRINT },
    { kind: 'ssh-key', name: 'Backup box', type: 'ssh-key', shared: false },
  ]);
  const run = (body) => srv.api('/vault/session/computer/run-with-ssh-key', { method: 'POST', headers: { 'X-Vault-Token': held.token }, body });
  assert.equal((await srv.api('/vault/session/computer/run-with-ssh-key', { method: 'POST', headers: { 'X-Vault-Token': 'made-up' }, body: { key: 'Tailnet servers', command: 'true' } })).status, 403);
  assert.equal((await run({ key: 'Tailnet servers' })).status, 400, 'no command');
  // Not shared with this bot: refused, and the owner is to share it.
  let r = await run({ key: 'Backup box', command: 'ssh host true' });
  assert.equal(r.data.ok, false);
  assert.match(r.data.error, /isn't allowed to use the SSH key "Backup box"\. Ask the owner to share it with you in the Vault/);
  // Shared: the route goes on to the computer (here a stand-in that never starts), and nothing of the key comes back.
  r = await run({ key: 'Tailnet servers', command: 'ssh host true' });
  assert.equal(r.data.ok, false);
  assert.doesNotMatch(r.data.error, /isn't allowed|Bitwarden/);
  assert.ok(!holdsKey(r.data));
  assert.ok(!holdsKey(srv.log.join('')), 'nor in the log');
  srv.release(held.rec);
  await srv.finished(held.run.id);
  srv.unhold();
});

test('run_with_ssh_key: without Bitwarden, the bot is told where SSH keys come from', async (t) => {
  const srv = await startServer({ env: noDocker(t) });
  t.after(() => srv.stop());
  const ops = await makeBot(srv, { name: 'Ops', computer: 'linux', computerAlwaysOn: true });
  const held = await heldRun(srv, ops);
  const r = await srv.api('/vault/session/computer/run-with-ssh-key', { method: 'POST', headers: { 'X-Vault-Token': held.token }, body: { key: 'Tailnet servers', command: 'ssh host true' } });
  assert.equal(r.data.ok, false);
  assert.match(r.data.error, /SSH keys come from the owner's Bitwarden/);
  srv.release(held.rec);
  await srv.finished(held.run.id);
  srv.unhold();
});

test('the run_with_ssh_key tool names the key and the command, and shows what the command returned', async (t) => {
  const asked = [];
  const stub = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      asked.push({ path: req.url, body: body ? JSON.parse(body) : null });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/session/computer') return res.end('{"ok":true}');
      res.end(JSON.stringify({ ok: true, stdout: ' 10:00:00 up 3 days\n', stderr: '', exitCode: 0 }));
    });
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  t.after(() => stub.close());
  const mcp = rpcClient(t, 'computer-mcp.js', { VAULT_URL: `http://127.0.0.1:${stub.address().port}`, VAULT_TOKEN: 'fixture', COMPUTER_CONTAINER: 'botdot-ops' });
  await mcp.request('initialize', {});
  const tool = (await mcp.request('tools/list')).tools.find((x) => x.name === 'run_with_ssh_key');
  assert.ok(tool, 'the tool is listed');
  assert.deepEqual(tool.inputSchema.required, ['key', 'command']);
  assert.match(tool.description, /ssh-agent/);
  assert.match(tool.description, /never see the private key/);
  assert.match(tool.description, /share it with you in the Vault/);
  const out = await mcp.request('tools/call', { name: 'run_with_ssh_key', arguments: { key: 'Tailnet servers', command: 'ssh admin@server uptime' } });
  assert.equal(out.content[0].text, 'stdout:\n 10:00:00 up 3 days\n\nexit code: 0');
  assert.deepEqual(asked.at(-1), { path: '/session/computer/run-with-ssh-key', body: { key: 'Tailnet servers', command: 'ssh admin@server uptime', timeoutSeconds: 120 } });
});
