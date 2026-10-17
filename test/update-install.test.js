// The release CLI runs in a root updater container; the HTTP server writes as UID 60000.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const ROOT_LINUX = process.platform === 'linux' && process.getuid?.() === 0;
const CLI = path.resolve(__dirname, '../lib/update-install.js');
const AUDIT = path.resolve(__dirname, '../lib/audit.js');

function installation(t, { multiple = false, starting = false } = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'update-audit-'));
  fs.chmodSync(dir, 0o711);
  const install = path.join(dir, 'install'); fs.mkdirSync(install, { mode: 0o700 });
  const data = path.join(dir, 'data'); fs.mkdirSync(data, { mode: 0o700 });
  fs.chownSync(data, 60000, 60000);
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const bin = path.join(dir, 'bin'); fs.mkdirSync(bin);
  const calls = path.join(dir, 'docker-calls.jsonl');
  fs.writeFileSync(path.join(bin, 'docker'), `#!${process.execPath}
const fs=require('node:fs'),cp=require('node:child_process');
const args=process.argv.slice(2);fs.appendFileSync(process.env.AUDIT_TEST_CALLS,JSON.stringify(args)+'\\n');
if(args[0]==='ps')console.log(process.env.AUDIT_TEST_MULTIPLE==='1'?'a'.repeat(64)+'\\n'+'b'.repeat(64):'a'.repeat(64));
else if(args[0]==='inspect'){
 const count=fs.readFileSync(process.env.AUDIT_TEST_CALLS,'utf8').trim().split('\\n').map(JSON.parse).filter(c=>c[0]==='inspect').length;
 console.log(process.env.AUDIT_TEST_STARTING==='1'&&count===1?'starting':'healthy');
}
else if(args[0]==='exec'){
 const expected=['exec','--user','60000:60000','a'.repeat(64),'node','/opt/bot-dot/lib/update-install.js','--record'];
 if(JSON.stringify(args)!==JSON.stringify(expected))throw Error('Unexpected Docker exec');
 const p=cp.spawnSync(process.execPath,[process.env.AUDIT_TEST_CLI,'--record'],{uid:60000,gid:60000,env:{PATH:process.env.PATH,BOT_DOT_DATA:process.env.AUDIT_TEST_DATA},stdio:'inherit'});
 process.exit(p.status===null?1:p.status);
}else throw Error('Unexpected Docker command');
`, { mode: 0o755 });
  const env = { PATH: `${bin}:${process.env.PATH}`, AUDIT_TEST_CALLS: calls, AUDIT_TEST_DATA: data, AUDIT_TEST_CLI: CLI, AUDIT_TEST_MULTIPLE: multiple ? '1' : '0', AUDIT_TEST_STARTING: starting ? '1' : '0' };
  return { dir, install, data, calls, env };
}

test('the root release recorder leaves an audit log the nonroot server can append', { skip: !ROOT_LINUX && 'needs isolated Linux root' }, t => {
  const { install, data, calls, env } = installation(t);
  const recorded = spawnSync(process.execPath, [CLI, '--record'], { cwd: install, env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(recorded.status, 0, recorded.stderr);
  assert.equal(fs.statSync(path.join(data, 'audit.log')).uid, 60000);
  const commands = fs.readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse);
  assert.ok(commands[0].includes(`label=com.docker.compose.project.working_dir=${install}`));
  assert.ok(commands[0].includes('label=com.docker.compose.service=bot-dot'));
  assert.ok(commands[0].includes('--no-trunc'));
  assert.equal(commands[1][0], 'inspect');
  assert.equal(commands[2][0], 'exec');
  const appended = spawnSync(process.execPath, ['-e', 'require(process.argv[1]).create(process.argv[2])("backup.created", "owner")', AUDIT, data], { uid: 60000, gid: 60000, encoding: 'utf8' });
  assert.equal(appended.status, 0, appended.stderr);
  // The cleanup the recorder starts writes its own line whenever it ends (below).
  const events = fs.readFileSync(path.join(data, 'audit.log'), 'utf8').trim().split('\n').map(JSON.parse).filter(e => e.action !== 'update.cleaned');
  assert.deepEqual(events.map(e => [e.action, e.actor]), [['update.applied', 'owner'], ['backup.created', 'owner']]);
});


test('the legacy root recorder waits for new-server health before recording', { skip: !ROOT_LINUX && 'needs isolated Linux root' }, t => {
  const { install, calls, env } = installation(t, { starting: true });
  const result = spawnSync(process.execPath, [CLI, '--record'], { cwd: install, env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, 0, result.stderr);
  const commands = fs.readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse);
  assert.deepEqual(commands.map(c => c[0]), ['ps', 'inspect', 'ps', 'inspect', 'exec']);
});

test('the root recorder cannot follow an audit symlink into a root-only file', { skip: !ROOT_LINUX && 'needs isolated Linux root' }, t => {
  const { dir, install, data, env } = installation(t);
  const protectedFile = path.join(dir, 'root-only');
  fs.writeFileSync(protectedFile, 'synthetic root-only state', { mode: 0o600 });
  fs.symlinkSync(protectedFile, path.join(data, 'audit.log'));
  const result = spawnSync(process.execPath, [CLI, '--record'], { cwd: install, env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, 1);
  assert.equal(fs.readFileSync(protectedFile, 'utf8'), 'synthetic root-only state');
  assert.equal(fs.statSync(protectedFile).uid, 0);
  assert.equal(fs.statSync(protectedFile).mode & 0o777, 0o600);
});

test('the recorder refuses ambiguous matching server containers', { skip: !ROOT_LINUX && 'needs isolated Linux root' }, t => {
  const { install, data, calls, env } = installation(t, { multiple: true });
  const result = spawnSync(process.execPath, [CLI, '--record'], { cwd: install, env, encoding: 'utf8', timeout: 30_000 });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Cannot identify one running server/);
  assert.equal(fs.existsSync(path.join(data, 'audit.log')), false);
  assert.deepEqual(fs.readFileSync(calls, 'utf8').trim().split('\n').map(JSON.parse).map(c => c[0]), ['ps']);
});

// The server's side of the cleanup (the plan of IMG-001): `--record` and `--clean` as the server's user. The
// tests are not that user, so a preload answers 60000 for them; everything else is the real CLI.
const http = require('node:http');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');
const { waitFor } = require('./helpers');
const AS_SERVER = path.resolve(__dirname, 'fixtures/as-server-user.js');

// A server's data folder and a Docker helper whose `update.clean` is `answer`. Returns how to run the CLI.
async function server(t, answer) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'update-clean-'));
  const data = path.join(dir, 'data'); fs.mkdirSync(data);
  const socket = path.join(dir, 'helper.sock');
  const asked = [];
  const helper = require('../lib/docker-helper').createServer({ computers: {}, updates: { clean: async (...args) => { asked.push(args); return answer(); } } });
  await new Promise(r => helper.listen(socket, r));
  t.after(async () => { helper.closeAllConnections(); await new Promise(r => helper.close(r)); fs.rmSync(dir, { recursive: true, force: true }); });
  const env = { PATH: process.env.PATH, BOT_DOT_DATA: data, BOT_DOT_HELPER_SOCKET: socket, NODE_OPTIONS: `--require ${AS_SERVER}` };
  const cli = async (flag, extra = {}) => {
    try { const { stdout, stderr } = await promisify(execFile)(process.execPath, [CLI, flag], { env: { ...env, ...extra }, timeout: 10_000 }); return { status: 0, stdout, stderr }; }
    catch (e) { return { status: e.code, stdout: e.stdout, stderr: e.stderr }; }
  };
  const events = () => (fs.existsSync(path.join(data, 'audit.log')) ? fs.readFileSync(path.join(data, 'audit.log'), 'utf8').trim().split('\n').map(JSON.parse).map(({ time, ...rest }) => rest) : []);
  return { cli, events, asked, socket };
}
const CLEANED = { removed: 3, skipped: 4, failed: 0, bytes: 6500 };
const FAILED = { removed: 0, skipped: 0, failed: 1, bytes: 0 };

test('--record writes update.applied, then update.cleaned with the helper\'s numbers', async t => {
  const { cli, events, asked } = await server(t, () => CLEANED);
  const recorded = await cli('--record');
  assert.equal(recorded.status, 0, recorded.stderr);
  assert.equal(events()[0].action, 'update.applied', 'written before --record ends');
  await waitFor(() => events().length === 2, { what: 'the cleanup to be recorded' });
  assert.deepEqual(events(), [{ actor: 'owner', action: 'update.applied' }, { actor: 'owner', action: 'update.cleaned', ...CLEANED }]);
  assert.deepEqual(asked, [[]], 'one cleanup, without arguments');
});

test('a helper that refuses, does not answer or answers something else gives failed 1 and the same exit code', async t => {
  for (const [answer, extra] of [
    [() => { throw new Error('An update is in progress'); }, {}],
    [() => CLEANED, { BOT_DOT_HELPER_SOCKET: path.join(os.tmpdir(), 'no-such-helper.sock') }],
    [() => CLEANED, { BOT_DOT_HELPER_SOCKET: '' }],
    [() => ({ ...CLEANED, removed: 1.5 }), {}],
    [() => ({ ...CLEANED, images: ['ghcr.io/kordal/bot-dot@sha256:1'] }), {}],
    [() => 'done', {}],
  ]) {
    const { cli, events } = await server(t, answer);
    const recorded = await cli('--record', extra);
    assert.equal(recorded.status, 0, recorded.stderr);
    await waitFor(() => events().length === 2, { what: 'the failed cleanup to be recorded' });
    assert.deepEqual(events(), [{ actor: 'owner', action: 'update.applied' }, { actor: 'owner', action: 'update.cleaned', ...FAILED }]);
  }
});

test('--clean runs the same cleanup without update.applied and prints the four numbers as one JSON line', async t => {
  const { cli, events } = await server(t, () => CLEANED);
  const cleaned = await cli('--clean');
  assert.equal(cleaned.status, 0, cleaned.stderr);
  assert.deepEqual(JSON.parse(cleaned.stdout), CLEANED);
  assert.equal(cleaned.stdout.trim().split('\n').length, 1);
  assert.deepEqual(events(), [{ actor: 'owner', action: 'update.cleaned', ...CLEANED }]);
  const failed = await cli('--clean', { BOT_DOT_HELPER_SOCKET: '' });
  assert.equal(failed.status, 0, failed.stderr);
  assert.deepEqual(JSON.parse(failed.stdout), FAILED);
  assert.deepEqual(events().at(-1), { actor: 'owner', action: 'update.cleaned', ...FAILED });
});

test('on a Mac-hosted botdot the cleanup does nothing and writes no event', async t => {
  // The server knows its platform, and so does the helper: either one is enough.
  for (const [answer, extra] of [[() => CLEANED, { BOT_DOT_PLATFORM: 'mac' }], [() => null, {}]]) {
    const { cli, events, asked } = await server(t, answer);
    const cleaned = await cli('--clean', extra);
    assert.equal(cleaned.status, 0, cleaned.stderr);
    assert.deepEqual(JSON.parse(cleaned.stdout), { removed: 0, skipped: 0, failed: 0, bytes: 0 });
    assert.deepEqual(events(), []);
    assert.equal(asked.length, extra.BOT_DOT_PLATFORM ? 0 : 1);
  }
});

test('--clean refuses to run as anyone but the server, and without its data folder', async t => {
  const { cli, events, asked } = await server(t, () => CLEANED);
  const stranger = await cli('--clean', { NODE_OPTIONS: '' });
  assert.equal(stranger.status, 1);
  assert.match(stranger.stderr, /server identity/);
  const nowhere = await cli('--clean', { BOT_DOT_DATA: 'data' });
  assert.equal(nowhere.status, 1);
  assert.match(nowhere.stderr, /absolute server data directory/);
  assert.deepEqual(events(), []);
  assert.deepEqual(asked, []);
});

test('the audit log takes exactly four whole numbers for update.cleaned', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'update-cleaned-audit-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const audit = require(AUDIT).create(dir);
  audit('update.cleaned', 'owner', CLEANED);
  for (const detail of [
    { ...CLEANED, images: 3 }, // a fifth field
    { ...CLEANED, bytes: 6500.5 }, { ...CLEANED, removed: '3' }, { ...CLEANED, failed: -1 }, { ...CLEANED, skipped: NaN }, // not a whole number
    { removed: 3, skipped: 4, failed: 0 }, { removed: 3, skipped: 4, failed: 0, size: 1 }, null, undefined, [3, 4, 0, 6500],
  ]) assert.throws(() => audit('update.cleaned', 'owner', detail), /Invalid audit detail/, JSON.stringify(detail));
  assert.throws(() => audit('update.applied', 'owner', CLEANED), /Invalid audit detail/);
  const lines = fs.readFileSync(path.join(dir, 'audit.log'), 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(lines.length, 1);
  assert.deepEqual(Object.keys(lines[0]), ['time', 'actor', 'action', 'removed', 'skipped', 'failed', 'bytes']);
});
