// A bot's computer and the secrets botdot types into it (#311): the bot works as a normal user, the browser's
// bridge runs as another, and botdot runs its own copy of the typing helper. Docker is a stand-in here.
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const util = require('node:util');
const childProcess = require('node:child_process');

const HELPER = fs.readFileSync(path.join(__dirname, '..', 'deploy', 'desktop', 'botdot-type-secret'), 'utf8');

// The stand-in docker: every call is recorded with what went to its stdin; `answer` decides each reply.
let calls = [];
let answer = () => '';
function fakeExecFile(file, args, opts, cb) {
  const call = { args, stdin: '' };
  calls.push(call);
  const reply = () => {
    try { cb(null, answer(args, call) ?? '', ''); } catch (e) { cb(e, '', e.message); }
  };
  return { stdin: { on() {}, end(data) { call.stdin = String(data ?? ''); setImmediate(reply); } } };
}
fakeExecFile[util.promisify.custom] = async (file, args) => {
  const call = { args, stdin: '' };
  calls.push(call);
  return { stdout: answer(args, call) ?? '', stderr: '' };
};

// computers.js takes execFile when it loads, so it loads once, after the stand-in is in place.
const realExecFile = childProcess.execFile;
childProcess.execFile = fakeExecFile;
delete require.cache[require.resolve('../lib/computers')];
const computers = require('../lib/computers');
childProcess.execFile = realExecFile;

// A Docker with the image, and a computer in the given state with the given labels.
function docker({ state = 'none', network = '2', users = '2', fail = () => false } = {}) {
  return (args, call) => {
    if (fail(args, call)) throw new Error('docker failed');
    const [cmd] = args;
    if (cmd === 'info') return '27.0.0';
    if (cmd === 'images') return 'sha256:image';
    if (cmd === 'image') return '2'; // the image's botdot.user-version
    if (cmd === 'inspect' && args[2] === '--format' && args[3].includes('.State.Status')) {
      if (state === 'none') throw new Error('No such object');
      return `"${state}"|"bot-dot/desktop:latest"|"sha256:image"`;
    }
    if (cmd === 'inspect' && args[3]?.includes('.State.Running')) return 'true';
    if (cmd === 'inspect' && args[3]?.includes('user-version')) return `${network}|${users}`;
    if (cmd === 'exec' && args.includes('python3') && args.includes('-c') && !args.includes('-I')) return '{}'; // computer-server /status
    if (cmd === 'exec' && args.includes('-I')) return '{"ok": true}';
    return '';
  };
}
const execs = () => calls.filter((c) => c.args[0] === 'exec');
const bridgeCall = () => execs().find((c) => c.args.includes('--serve'));
// A bot's seat: screen 1, display :11 (#105).
const seat = (bot) => ({ bot, screen: 1 });
const helperCalls = () => calls.filter((c) => c.args[0] === 'exec' && c.args.includes('-I'));

beforeEach(() => { calls = []; answer = docker(); });

test("the account's computer runs as box and is marked as such (#311, ADR 035)", async () => {
  answer = docker({ state: 'none' });
  await computers.ensure(seat('newbot'));
  const runCall = calls.find((c) => c.args[0] === 'run' && c.args.includes('botdot.account.computer'));
  assert.ok(runCall, 'the computer was made');
  const args = runCall.args;
  assert.equal(args[args.indexOf('--user') + 1], 'box');
  assert.ok(args.includes('HOME=/home/box'));
  assert.ok(args.includes('botdot.user-version=2'));
});

test("the browser's bridge is started as the browser user when the computer starts (#311)", async () => {
  answer = docker({ state: 'none' });
  await computers.ensure(seat('bridgebot'));
  const bridge = bridgeCall();
  assert.ok(bridge, 'the bridge was started');
  assert.deepEqual(bridge.args.slice(0, 4), ['exec', '-d', '-u', 'browser']);
  assert.ok(bridge.args.includes('HOME=/home/browser'));
  assert.ok(bridge.args.includes(`TZ=${computers.timeZone()}`), "the browser it opens shows botdot's time zone");
  assert.ok(bridge.args.includes('XDG_CACHE_HOME=/opt/camoufox-cache'), "it runs root's copy of the browser");
  assert.deepEqual(bridge.args.slice(-4), ['/usr/local/bin/camoufox-browser', '--serve', ':11', 'bridgebot'],
    "the bot's own screen and profile (#105); the launcher keeps its own log, bounded (#355), and nothing else appends to it");
  assert.ok(bridge.args.includes('DISPLAY=:11'), "Camoufox shows on the bot's own screen");
  assert.ok(!bridge.args.some((a) => a.includes('>>') || a.includes('bridge.log')), 'no shell appends to bridge.log (#355)');
});

test("botdot's browser launcher is written into the computer by root from stdin, not copied with its owner (#311)", async () => {
  answer = docker({ state: 'none' });
  await computers.ensure(seat('copybot'));
  assert.ok(!calls.some((c) => c.args[0] === 'cp'), 'no docker cp');
  const copy = execs().find((c) => c.args.at(-1).includes('/usr/local/bin/camoufox-browser'));
  assert.ok(copy, 'the launcher was written');
  assert.deepEqual(copy.args.slice(0, 7), ['exec', '-i', '-u', 'root', 'botdot.account.computer', 'sh', '-c']);
  assert.equal(copy.args.at(-1), 'rm -f /usr/local/bin/.camoufox-browser.new && cat > /usr/local/bin/.camoufox-browser.new'
    + ' && chmod 755 /usr/local/bin/.camoufox-browser.new && mv -f /usr/local/bin/.camoufox-browser.new /usr/local/bin/camoufox-browser');
  assert.equal(copy.stdin, fs.readFileSync(path.join(__dirname, '..', 'deploy', 'desktop', 'camoufox-browser'), 'utf8'), 'the launcher went on stdin');
  assert.ok(execs().indexOf(copy) < execs().indexOf(bridgeCall()), 'before the bridge starts');
});

test('a computer older than the account computer is kept but stopped, with what to do (#311)', async () => {
  answer = docker({ state: 'stopped', network: '1', users: '' });
  await assert.rejects(computers.ensure(seat('oldbot')), /kept but stopped\. Export its files and reset it/);
  assert.ok(calls.some((c) => c.args[0] === 'stop' && c.args.includes('botdot.account.computer')), 'it was stopped');
  assert.ok(!calls.some((c) => c.args[0] === 'start'), 'it was not started');
});

test('a failed copy of the browser into the computer stops the start instead of going on (#311)', async () => {
  answer = docker({ state: 'none', fail: (args) => args.at(-1).includes('.camoufox-browser.new') });
  await assert.rejects(computers.ensure(seat('cpbot')), /Could not copy botdot's browser into the computer/);
  assert.ok(!bridgeCall(), 'no bridge was started');
});

test("typeSecret runs botdot's own copy of the helper as the browser user, the secret only on stdin (#311)", async () => {
  const payload = { site: 'example.com', field: 'password', value: 'synthetic-secret', submit: false };
  const result = await computers.typeSecret(seat('typebot'), payload);
  assert.deepEqual(result, { ok: true });
  const [call] = helperCalls();
  assert.ok(call, 'the helper ran');
  assert.deepEqual(call.args.slice(0, 7), ['exec', '-i', '-u', 'browser', '-w', '/', 'botdot.account.computer']);
  assert.deepEqual(call.args.slice(7), ['/usr/bin/python3', '-I', '-c', HELPER, '/run/botdot-browser/bridge-11.sock'],
    "to the bridge of the bot's own screen (#105)");
  assert.ok(!call.args.some((a) => a.includes('synthetic-secret')), 'the secret is not in the command line');
  assert.deepEqual(JSON.parse(call.stdin), payload);
  assert.ok(!calls.some((c) => c.args.includes('/usr/local/bin/botdot-type-secret')), 'no file of the computer is run');
});

test("a browser tool (#170) takes typeSecret's way: botdot's helper, as the browser user, to the bot's own screen, on stdin", async () => {
  answer = docker({ state: 'running' });
  calls = [];
  const result = await computers.browserTool(seat('pagebot'), { op: 'fill', ref: 'e2', text: 'me@example.com' });
  assert.deepEqual(result, { ok: true });
  const [call] = helperCalls();
  assert.deepEqual(call.args.slice(0, 7), ['exec', '-i', '-u', 'browser', '-w', '/', 'botdot.account.computer']);
  assert.deepEqual(call.args.slice(7), ['/usr/bin/python3', '-I', '-c', HELPER, '/run/botdot-browser/bridge-11.sock']);
  assert.deepEqual(JSON.parse(call.stdin), { op: 'fill', ref: 'e2', text: 'me@example.com' });
  answer = docker({ state: 'running', users: '' });
  assert.match((await computers.browserTool(seat('pagebot'), { op: 'snapshot' })).error, /older than botdot's browser tools/);
});

test('typeSecret types nothing into a computer older than the account computer (#311)', async () => {
  answer = docker({ state: 'running', users: '' });
  const result = await computers.typeSecret(seat('oldbot'), { site: 'example.com', field: 'password', value: 'synthetic-secret' });
  assert.equal(result.ok, false);
  assert.match(result.error, /reset/);
  assert.equal(helperCalls().length, 0, 'nothing was sent');
});

test("typeSecret sends nothing when botdot's copy of the helper cannot be read (#311)", async (t) => {
  t.mock.method(fs.promises, 'readFile', async () => { throw new Error('EACCES'); });
  const result = await computers.typeSecret(seat('typebot'), { op: 'where' });
  assert.equal(result.ok, false);
  assert.equal(helperCalls().length, 0, 'nothing was sent');
});

test("start_program runs as box, on the bot's own screen and in its own folder (#311, ADR 035, #105)", async () => {
  await computers.startProgram(seat('progbot'), 'xfce4-terminal');
  await computers.startProgram({ bot: 'other', screen: 2 }, 'xterm');
  const [call, other] = execs();
  assert.deepEqual(call.args.slice(0, 4), ['exec', '-d', '-u', 'box']);
  assert.ok(call.args.includes('HOME=/home/box'));
  assert.ok(!call.args.includes('HOME=/root'));
  assert.ok(call.args.includes('DISPLAY=:11') && other.args.includes('DISPLAY=:12'), 'each on its own screen');
  assert.deepEqual(call.args.slice(-6), ['sh', '-c', 'mkdir -p "$1" 2>/dev/null; cd "$1" 2>/dev/null; exec sh -c "$2"', 'sh', '/workspace/progbot', 'xfce4-terminal']);
  assert.deepEqual(other.args.slice(-2), ['/workspace/other', 'xterm']);
});

// The wrapper as it runs: the command starts in the bot's folder, made if it is gone, and is run as given.
test("a bot's command starts in its own folder, made again if it is gone (#105)", async (t) => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'workspace-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  await computers.startProgram(seat('progbot'), 'true');
  const wrapper = execs()[0].args.at(-4);
  const { stdout } = await util.promisify(realExecFile)('sh', ['-c', wrapper, 'sh', path.join(dir, 'alice'), 'pwd; echo "$0"']);
  assert.deepEqual(stdout.trim().split('\n'), [fs.realpathSync(path.join(dir, 'alice')), 'sh']);
});

test('a changed time zone ends the browser and its bridge as the browser user, and the bridge starts again (#311)', async () => {
  answer = (args, call) => (args.includes('-u') && args[args.indexOf('-u') + 1] === 'root' && args.includes('sh') ? 'changed' : docker({ state: 'running' })(args, call));
  await computers.ensure(seat('tzbot'));
  const close = execs().findIndex((c) => c.args.at(-1).includes('pkill'));
  assert.ok(close >= 0, 'the browser was closed');
  assert.deepEqual(execs()[close].args.slice(0, 3), ['exec', '-u', 'browser']);
  assert.match(execs()[close].args.at(-1), /pkill -f "camoufox-\[b\]"/, 'the bridge ends with the browser');
  assert.ok(execs().indexOf(bridgeCall()) > close, 'the bridge starts again after');
});

test('a desktop image made before the account computer is made again before a computer is (#311, ADR 035)', async () => {
  const old = docker({ state: 'none' });
  answer = (args, call) => (args[0] === 'image' ? '' : old(args, call));
  await computers.ensureImage();
  assert.ok(calls.some((c) => c.args[0] === 'build' || c.args[0] === 'pull'), 'the image was made again');
});

// The installer and the updater pin the computer image by digest, and `docker images <repo>@sha256:…` lists
// nothing for it: the image is asked for with `docker image inspect`, which knows it (#430).
test('a computer image pinned by digest counts as there, and is not made again', async () => {
  const pinned = docker();
  answer = (args, call) => (args[0] === 'images' ? '' : pinned(args, call));
  assert.equal((await computers.dockerStatus(true)).image, true);
  calls = [];
  await computers.ensureImage();
  assert.ok(!calls.some((c) => c.args[0] === 'build' || c.args[0] === 'pull'), 'the image is used as it is');
});

// The helper as botdot runs it (python3 -I -c), against a stand-in bridge socket. In the computer it takes the
// bridge's own path; here the path is its first argument.
function runHelper(socketPath, payload) {
  return new Promise((resolve) => {
    const child = realExecFile('python3', ['-I', '-c', HELPER, socketPath], { timeout: 20_000 }, (err, stdout) => resolve(JSON.parse(String(stdout).trim())));
    child.stdin.end(JSON.stringify(payload));
  });
}

// The helper asks who answers with SO_PEERCRED, which Linux has and macOS does not: it runs in the bot's computer,
// a Linux container. Without it the helper says the browser is not open and closes before it sends.
test("the helper hands the payload to the bridge's socket and returns its answer (#311)", { skip: !hasPeerCred() }, async (t) => {
  const net = require('node:net');
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'bridge-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const socketPath = path.join(dir, 'bridge.sock');
  let received = '';
  // A helper that has gone before the answer fails the assertions below, not the run with an EPIPE.
  const bridge = net.createServer((s) => { s.on('error', () => {}); s.on('data', (d) => { received += d; }); s.on('end', () => s.end(JSON.stringify({ ok: true, host: 'example.com' }))); });
  await new Promise((r) => bridge.listen(socketPath, r));
  t.after(() => bridge.close());
  const answer = await runHelper(socketPath, { op: 'where' });
  assert.deepEqual(answer, { ok: true, host: 'example.com' });
  assert.deepEqual(JSON.parse(received), { op: 'where' });
});

test('the helper sends nothing and asks for the browser when no bridge answers (#311)', { skip: !hasPython() }, async () => {
  const answer = await runHelper(path.join(require('node:os').tmpdir(), `no-bridge-${process.pid}.sock`), { field: 'password', value: 'synthetic-secret' });
  assert.equal(answer.ok, false);
  assert.match(answer.error, /open_browser/);
});

function hasPython() {
  try { childProcess.execFileSync('python3', ['-c', '']); return true; } catch { return false; }
}
function hasPeerCred() {
  try { childProcess.execFileSync('python3', ['-c', 'import socket; socket.SO_PEERCRED']); return true; } catch { return false; }
}

// The bridge with a stand-in Camoufox (test/fixtures/camoufox-bridge.py): secrets and "where" come only over
// its socket; the port the bot's programs reach opens pages and nothing else.
test("the browser's bridge takes secrets only on its socket, and its port only opens pages (#311)", { skip: !hasPython() }, async (t) => {
  const dir = fs.mkdtempSync(path.join(require('node:os').tmpdir(), 'bridge-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const { stdout } = await util.promisify(realExecFile)('python3', [path.join(__dirname, 'fixtures', 'camoufox-bridge.py'),
    path.join(__dirname, '..', 'deploy', 'desktop', 'camoufox-browser'), dir], { timeout: 30_000 });
  const out = JSON.parse(stdout);
  assert.equal(out.where_closed.ok, false, 'no browser yet');
  assert.match(out.where_closed.error, /open_browser/);
  assert.equal(out.secret_on_port.ok, false);
  assert.equal(out.where_on_port.ok, false);
  assert.equal(out.where_on_port.host, undefined, 'the port tells no one where the browser is');
  assert.deepEqual(out.open, { ok: true });
  assert.equal(out.launches, 1, 'opening a page started the browser');
  assert.deepEqual(out.where_open, { ok: true, host: 'example.com' });
  assert.deepEqual(out.secret, { ok: true });
  assert.deepEqual(out.typed, ['synthetic-secret'], 'only the secret from the socket was typed');
  assert.deepEqual(out.is_open_closed, { ok: true, open: false }, 'open_browser asks whether its own Camoufox is open (#105)');
  assert.deepEqual(out.is_open, { ok: true, open: true });
  assert.equal(out.prefs['signon.rememberSignons'], false, 'no typed password is stored');
  assert.deepEqual([out.prefs['fission.autostart'], out.prefs['dom.ipc.processCount'], out.prefs['dom.ipc.processPrelaunch.enabled'],
    out.prefs['network.process.enabled']], [false, 1, false, false], 'one content process and no spare or Socket process (#152)');
  assert.equal(out.prefs['browser.cache.memory.capacity'], 16384, 'a small memory cache (#152)');
  assert.equal(out.prefs['browser.sessionhistory.max_total_viewers'], 0, 'no pages kept for Back (#152)');
});

// Each bot's screen has a bridge of its own (#105): its socket, log and port follow the screen's display, and its
// Camoufox the bot's own profile. A program on a screen reaches that screen's bridge, through its DISPLAY.
test("each screen's bridge has its own socket, log, port and the bot's own profile (#105)", { skip: !hasPython() }, async () => {
  const script = `
import importlib.machinery, importlib.util, json, sys
sys.dont_write_bytecode = True
loader = importlib.machinery.SourceFileLoader("camoufox_browser", sys.argv[1])
spec = importlib.util.spec_from_loader("camoufox_browser", loader)
m = importlib.util.module_from_spec(spec)
loader.exec_module(m)
m.for_screen(":21", "alice")
out = {"socket": m.BRIDGE_SOCKET, "log": m.BRIDGE_LOG, "port": m.OPEN_PORT, "profile": m.PROFILE,
       "of_display": m.port_of_display(":21"), "of_screen": m.port_of_display(":21.0"), "none": m.port_of_display(None)}
try:
    m.for_screen(":21", "../browser")
    out["bad"] = "taken"
except SystemExit:
    out["bad"] = "refused"
print(json.dumps(out))`;
  const { stdout } = await util.promisify(realExecFile)('python3', ['-c', script, path.join(__dirname, '..', 'deploy', 'desktop', 'camoufox-browser')], { timeout: 30_000 });
  const ports = computers.screenPorts({ bot: 'alice', screen: 11 });
  assert.deepEqual(JSON.parse(stdout), {
    socket: '/run/botdot-browser/bridge-21.sock', log: '/home/browser/bridge-21.log', port: 47221, profile: '/home/browser/profiles/alice',
    of_display: 47221, of_screen: 47221, none: 47221, bad: 'refused',
  });
  assert.equal(ports.display, ':21');
  assert.equal(ports.browser, 47221, 'botdot and the launcher agree on the port');
  assert.equal(ports.socket, '/run/botdot-browser/bridge-21.sock', 'and on the socket');
});
