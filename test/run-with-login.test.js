// run_with_login: one shell command in the bot's own computer with a saved login in BOTDOT_USERNAME and
// BOTDOT_PASSWORD, for a login the owner shared with the bot and marked "Usable in its computer" (inComputer).
// The values reach `docker exec` through the docker CLI's own environment, never its command line, and every
// form of the secret is blanked out of what comes back. No Docker needed: docker is a stand-in.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const util = require('node:util');
const childProcess = require('node:child_process');
const vaultLib = require('../lib/vault');
const { hideLogin } = require('../lib/vault-http');
const { startServer, makeBot, heldRun, REAPED } = require('./helpers');
const { rpcClient } = require('./memory-helpers');

const SECRET = 'br1dge-S3cret/+=';
const USER = 'bart@proton.me';
// The bot's seat on the account's computer: screen 1, display :11 (#105).
const MAIL = { bot: 'mail', screen: 1 };

// ---------- the docker call (lib/computers.js) ----------

// computers.js takes execFile when it loads, so it loads once, with a stand-in that records each call.
let calls = [];
let reply = () => ({ stdout: '', stderr: '' });
function fakeExecFile(file, args, opts, cb) {
  const call = { file, args, opts };
  calls.push(call);
  setImmediate(() => {
    const r = reply(call);
    cb(r.error || null, r.stdout ?? '', r.stderr ?? '');
  });
  return { stdin: { on() {}, end() {} } };
}
fakeExecFile[util.promisify.custom] = async (file, args, opts) => { calls.push({ file, args, opts }); return { stdout: '', stderr: '' }; };
const realExecFile = childProcess.execFile;
childProcess.execFile = fakeExecFile;
delete require.cache[require.resolve('../lib/computers')];
const computers = require('../lib/computers');
childProcess.execFile = realExecFile;
delete require.cache[require.resolve('../lib/computers')];

test('the login goes to docker exec in its own environment, never on its command line', async () => {
  calls = [];
  reply = () => ({ stdout: '* OK IMAP4rev1 ready\n', stderr: '' });
  const r = await computers.runWithLogin(MAIL, { command: 'curl --user "$BOTDOT_USERNAME:$BOTDOT_PASSWORD" imap://127.0.0.1:1143/INBOX', username: USER, password: SECRET });
  assert.deepEqual(r, { code: 0, stdout: '* OK IMAP4rev1 ready\n', stderr: '', timedOut: false });
  assert.equal(calls.length, 1);
  const { file, args, opts } = calls[0];
  assert.equal(file, 'docker');
  assert.deepEqual(args.slice(0, 3), ['exec', '-u', 'box']);
  // `-e NAME` without a value: docker takes the value from its own environment.
  for (const name of ['BOTDOT_USERNAME', 'BOTDOT_PASSWORD']) assert.equal(args[args.indexOf(name) - 1], '-e', name);
  assert.ok(!args.some((a) => a.includes(SECRET) || a.includes(USER) || /BOTDOT_(USERNAME|PASSWORD)=/.test(a)), `argv holds no value: ${JSON.stringify(args)}`);
  assert.equal(opts.env.BOTDOT_USERNAME, USER);
  assert.equal(opts.env.BOTDOT_PASSWORD, SECRET);
  assert.equal(opts.env.PATH, process.env.PATH, "the rest of botdot's environment, so docker is found");
  // The command runs as given, in sh, inside `timeout`, in this bot's computer, in its own folder and on its own
  // screen (#105).
  const at = args.indexOf(computers.containerName('mail'));
  assert.deepEqual(args.slice(at + 1), ['timeout', '-k', '5', '120', ...REAPED, 'sh', '-c', 'mkdir -p "$1" 2>/dev/null; cd "$1" 2>/dev/null; exec sh -c "$2"',
    'sh', '/workspace/mail', 'curl --user "$BOTDOT_USERNAME:$BOTDOT_PASSWORD" imap://127.0.0.1:1143/INBOX']);
  assert.ok(args.includes('DISPLAY=:11'));
});

test('several logins (#228): each variable goes to docker exec in its own environment, and BOTDOT_PASSWORD is not set', async () => {
  calls = [];
  reply = () => ({ stdout: 'signed\n', stderr: '' });
  const env = { BOTDOT_OVH_APPLICATION_KEY_USERNAME: '', BOTDOT_OVH_APPLICATION_KEY_PASSWORD: 'app-key-0001', BOTDOT_OVH_CONSUMER_KEY_USERNAME: '', BOTDOT_OVH_CONSUMER_KEY_PASSWORD: SECRET };
  const r = await computers.runWithLogin(MAIL, { command: 'echo "$BOTDOT_OVH_CONSUMER_KEY_PASSWORD" | wc -c', env });
  assert.equal(r.code, 0);
  const { args, opts } = calls[0];
  for (const name of Object.keys(env)) {
    assert.equal(args[args.indexOf(name) - 1], '-e', name);
    assert.equal(opts.env[name], env[name]);
  }
  assert.ok(!args.includes('BOTDOT_PASSWORD') && !('BOTDOT_PASSWORD' in opts.env), 'the single form is not set');
  assert.ok(!args.some((a) => a.includes(SECRET) || a.includes('app-key-0001')), `argv holds no value: ${JSON.stringify(args)}`);
});

test('the time limit is 120 s by default and 600 s at most; a command that ran out says so', async () => {
  reply = () => ({ stdout: 'partial', stderr: '', error: Object.assign(new Error('Command failed'), { code: 124 }) });
  const seconds = async (timeoutSeconds) => {
    calls = [];
    const r = await computers.runWithLogin(MAIL, { command: 'sleep 9999', username: '', password: SECRET, timeoutSeconds });
    const { args, opts } = calls[0];
    return { limit: args[args.indexOf('timeout') + 3], killAfter: opts.timeout, r };
  };
  assert.equal((await seconds(undefined)).limit, '120');
  assert.equal((await seconds(30)).limit, '30');
  const most = await seconds(5000);
  assert.equal(most.limit, '600');
  assert.ok(most.killAfter > 600_000 && most.killAfter <= 640_000, 'docker itself is stopped a little after');
  assert.deepEqual(most.r, { code: 124, stdout: 'partial', stderr: '', timedOut: true });
  // A failing command is its exit code and output, not an error.
  reply = () => ({ stdout: '', stderr: 'auth failed', error: Object.assign(new Error('Command failed'), { code: 1 }) });
  assert.deepEqual(await computers.runWithLogin(MAIL, { command: 'false', username: USER, password: SECRET }), { code: 1, stdout: '', stderr: 'auth failed', timedOut: false });
});

// ---------- every form of the secret is blanked out ----------

test('hideLogin blanks the password plain, URL-encoded, in base64 and as base64 of "username:password"', () => {
  const hide = hideLogin({ username: USER, password: SECRET });
  const basic = Buffer.from(`${USER}:${SECRET}`).toString('base64');
  const text = [SECRET, encodeURIComponent(SECRET), Buffer.from(SECRET).toString('base64'), basic].map((f) => `[${f}]`).join(' ');
  const out = hide(text);
  assert.equal(out, '[[hidden]] [[hidden]] [[hidden]] [[hidden]]');
  assert.equal(hide(`logged in as ${USER}`), `logged in as ${USER}`, 'the username is no secret');
  assert.equal(hideLogin({ username: '', password: '' })('nothing to hide'), 'nothing to hide');
});

// ---------- the docker helper passes it on, with nothing more ----------

test('the Docker helper accepts run_with_login only in its fixed shape', async (t) => {
  const { createServer } = require('../lib/docker-helper');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-helper-run-'));
  const socket = path.join(dir, 'helper.sock');
  const got = [];
  const server = createServer({ computers: { runWithLogin: async (...args) => { got.push(args); return { code: 0, stdout: 'ok', stderr: '', timedOut: false }; } }, updates: {} });
  await new Promise((r) => server.listen(socket, r));
  t.after(async () => { await new Promise((r) => server.close(r)); fs.rmSync(dir, { recursive: true, force: true }); });
  const call = (value) => new Promise((resolve, reject) => {
    const req = http.request({ socketPath: socket, method: 'POST', path: '/call' }, (res) => {
      let data = ''; res.on('data', (b) => { data += b; }); res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(data) }));
    });
    req.on('error', reject); req.end(JSON.stringify(value));
  });
  const good = { command: 'echo hi', username: USER, password: SECRET, timeoutSeconds: 60 };
  assert.equal((await call({ operation: 'runWithLogin', args: [MAIL, good] })).data.value.stdout, 'ok');
  assert.deepEqual(got, [[MAIL, good]]);
  for (const args of [
    ['../host', good],
    ['mail', good], // a bot id alone is no screen (#105)
    [{ bot: 'mail', screen: 90 }, good],
    [MAIL, { ...good, user: 'root' }],
    [MAIL, { ...good, command: '' }],
    [MAIL, { ...good, command: 'x'.repeat(4001) }],
    [MAIL, { ...good, password: 42 }],
    [MAIL, { ...good, timeoutSeconds: 601 }],
    [MAIL, good, 'extra'],
    // Several logins' variables (#228): only BOTDOT_<NAME>_USERNAME and BOTDOT_<NAME>_PASSWORD, for at most 8 logins.
    [MAIL, { command: 'true', env: { PATH: '/tmp' } }],
    [MAIL, { command: 'true', env: { LD_PRELOAD: '/tmp/x.so' } }],
    [MAIL, { command: 'true', env: { BOTDOT_A_PASSWORD: 42 } }],
    [MAIL, { command: 'true', env: { BOTDOT_a_PASSWORD: 'x' } }],
    [MAIL, { command: 'true', env: {} }],
    [MAIL, { command: 'true', env: { BOTDOT_A_PASSWORD: 'x' }, password: 'y' }],
    [MAIL, { command: 'true', env: Object.fromEntries(Array.from({ length: 17 }, (_, i) => [`BOTDOT_L${i}_PASSWORD`, 'x'])) }],
  ]) assert.equal((await call({ operation: 'runWithLogin', args })).status, 400, JSON.stringify(args).slice(0, 120));
  assert.equal(got.length, 1);
  const several = { command: 'true', env: { BOTDOT_OVH_APPLICATION_KEY_USERNAME: '', BOTDOT_OVH_APPLICATION_KEY_PASSWORD: SECRET }, timeoutSeconds: 60 };
  assert.equal((await call({ operation: 'runWithLogin', args: [MAIL, several] })).status, 200);
  assert.deepEqual(got[1], [MAIL, several]);
});

// ---------- the built-in vault keeps the opt-in ----------

test('the built-in vault: "Usable in its computer" is off by default, saved, returned, and seen by the bot', () => {
  const store = vaultLib.create(fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-in-computer-')));
  const plain = store.add({ name: 'Bridge', site: '127.0.0.1', username: USER, password: SECRET, allowedBots: ['bot1'] });
  assert.equal(plain.inComputer, false, 'off by default');
  assert.equal(store.credentials('bot1', 'Bridge').inComputer, false);
  assert.equal(store.update(plain.id, { inComputer: true }).inComputer, true);
  assert.equal(store.list()[0].inComputer, true);
  assert.equal(store.credentials('bot1', 'Bridge').inComputer, true);
  assert.deepEqual(store.forBot('bot1'), [{ name: 'Bridge', site: '127.0.0.1', username: USER, type: 'login', allowedHosts: [], inComputer: true }]);
  assert.equal(store.update(plain.id, { name: 'Bridge' }).inComputer, true, 'a change that leaves it out keeps it');
  assert.equal(store.update(plain.id, { inComputer: false }).inComputer, false);
  assert.deepEqual(Object.keys(store.forBot('bot1')[0]).includes('inComputer'), false, 'a bot sees it only where it is on');
  assert.equal(store.add({ site: 'nas.example.net', password: 'p', inComputer: true }).inComputer, true);
});

// ---------- the route: who may run what ----------

// A docker that always fails, first on PATH: the computer never starts, here and on a machine with a real Docker.
function noDocker(t) {
  const bin = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-no-docker-'));
  fs.writeFileSync(path.join(bin, 'docker'), '#!/bin/sh\necho "no docker in this test" >&2\nexit 1\n', { mode: 0o755 });
  t.after(() => fs.rmSync(bin, { recursive: true, force: true }));
  return { PATH: `${bin}${path.delimiter}${process.env.PATH}` };
}

test('run_with_login: refused without a computer, for a login not shared with the bot, and without "Usable in its computer"', async (t) => {
  const srv = await startServer({ env: noDocker(t) });
  t.after(() => srv.stop());
  const run = (token, body) => srv.api('/vault/session/computer/run-with-login', { method: 'POST', headers: { 'X-Vault-Token': token }, body });
  assert.equal((await run('made-up', { login: 'Bridge', command: 'true' })).status, 403);

  const mail = await makeBot(srv, { name: 'Mail Triage', computer: 'linux', computerAlwaysOn: true });
  const other = await makeBot(srv, { name: 'Other' });
  const shared = (await srv.api('/vault', { method: 'POST', body: { name: 'Bridge', site: '127.0.0.1', username: USER, password: SECRET, allowedBots: [mail.id] } })).data;
  await srv.api('/vault', { method: 'POST', body: { name: 'Bank', site: 'bank.example.com', password: 'bank-secret', allowedBots: [other.id], inComputer: true } });

  const held = await heldRun(srv, mail);
  // Not usable in its computer yet: the owner is asked to turn it on.
  let r = await run(held.token, { login: 'Bridge', command: 'echo "$BOTDOT_PASSWORD" | wc -c' });
  assert.equal(r.data.ok, false);
  assert.match(r.data.error, /"Bridge".*Ask the owner for it with ask_vault_switch \(switch "inComputer"\); don't tell them to change it in the Vault themselves/);
  assert.doesNotMatch(JSON.stringify(r.data), new RegExp(SECRET.replace(/[/+]/g, '\\$&')));
  // Shared with another bot only: refused as any other use of it is.
  r = await run(held.token, { login: 'Bank', command: 'true' });
  assert.equal(r.data.ok, false);
  assert.match(r.data.error, /isn't allowed to use the "Bank" login/);
  // No command: refused before anything else.
  assert.equal((await run(held.token, { login: 'Bridge' })).status, 400);
  // The owner turns it on: the route goes on to the computer (here a stand-in that never starts).
  assert.equal((await srv.api(`/vault/${shared.id}`, { method: 'PUT', body: { inComputer: true } })).data.inComputer, true);
  r = await run(held.token, { login: 'Bridge', command: 'true' });
  assert.equal(r.data.ok, false);
  assert.doesNotMatch(r.data.error, /Usable in its computer|isn't allowed/);
  srv.release(held.rec);
  await srv.finished(held.run.id);
  srv.unhold();
});

test('run_with_login: a bot without a computer is told so', async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const bot = await makeBot(srv, { name: 'No Desk' });
  await srv.api('/vault', { method: 'POST', body: { name: 'Bridge', site: '127.0.0.1', password: SECRET, allowedBots: [bot.id], inComputer: true } });
  const held = await heldRun(srv, bot);
  const r = await srv.api('/vault/session/computer/run-with-login', { method: 'POST', headers: { 'X-Vault-Token': held.token }, body: { login: 'Bridge', command: 'true' } });
  assert.equal(r.data.ok, false);
  assert.match(r.data.error, /doesn't have a computer/);
  srv.release(held.rec);
  await srv.finished(held.run.id);
  srv.unhold();
});

// ---------- the bot's tool (lib/computer-mcp.js) ----------

test('the run_with_login tool says how to use the values, and shows what the command returned', async (t) => {
  const asked = [];
  const stub = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      asked.push({ path: req.url, body: body ? JSON.parse(body) : null });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/session/computer') return res.end('{"ok":true}');
      res.end(JSON.stringify({ ok: true, stdout: '* OK [hidden]\n', stderr: '', exitCode: 0 }));
    });
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  t.after(() => stub.close());
  const mcp = rpcClient(t, 'computer-mcp.js', { VAULT_URL: `http://127.0.0.1:${stub.address().port}`, VAULT_TOKEN: 'fixture', COMPUTER_CONTAINER: 'botdot-mail' });
  await mcp.request('initialize', {});
  const { tools } = await mcp.request('tools/list');
  const tool = tools.find((x) => x.name === 'run_with_login');
  assert.ok(tool, 'the tool is listed');
  assert.deepEqual(tool.inputSchema.required, ['command'], 'login or logins (#228)');
  assert.equal(tool.inputSchema.properties.logins.maxItems, 8);
  assert.match(tool.description, /BOTDOT_<NAME>_USERNAME and BOTDOT_<NAME>_PASSWORD/);
  assert.match(tool.description, /OVH_APPLICATION_KEY gives "\$BOTDOT_OVH_APPLICATION_KEY_PASSWORD"/);
  assert.match(tool.description, /BOTDOT_USERNAME/);
  assert.match(tool.description, /"\$BOTDOT_PASSWORD"/);
  assert.match(tool.description, /[Nn]ever print, store or encode/);
  assert.match(tool.description, /Usable in its computer/);
  const out = await mcp.request('tools/call', { name: 'run_with_login', arguments: { login: 'Bridge', command: 'curl --user "$BOTDOT_USERNAME:$BOTDOT_PASSWORD" imap://127.0.0.1:1143/INBOX' } });
  assert.equal(out.content[0].text, 'stdout:\n* OK [hidden]\n\nexit code: 0');
  assert.deepEqual(asked.at(-1), { path: '/session/computer/run-with-login', body: { login: 'Bridge', command: 'curl --user "$BOTDOT_USERNAME:$BOTDOT_PASSWORD" imap://127.0.0.1:1143/INBOX', timeoutSeconds: 120 } });
});
