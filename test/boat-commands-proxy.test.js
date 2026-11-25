// A bot's commands on the External Virtual PC go through the account's proxy (#1612, ADR 262): the account's proxy is
// handed to the bridge's forwarder on the machine (ADR 171), which is started for commands alone, without the screen, and
// a command gets the proxy variables to it. When the proxy can't be handed over or the forwarder doesn't answer, the
// command does not run. This file tests lib/boat.js and the facade against a stand-in boat.dev with a stand-in machine;
// test/boat-commands-proxy-run.test.js tests what botdot asks of them as a command starts.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const boatLib = require('../lib/boat');
const screensLib = require('../lib/computer-screens');

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-boat-proxy-'));
const KEY = `boat_${'x'.repeat(16)}`; // no real key
const PROXY = { type: 'socks5', host: 'proxy.example', port: 1080, username: 'kordal', password: 's3cret-pass', name: 'PL' };

// boat.dev with one machine as far as the proxy uses it: the kit, the bridge and its forwarder, the proxy the bridge keeps,
// and the commands it runs.
function fakeBoat({ kit = boatLib.KIT_VERSION, forwarderDead = false, bridgeRefuses = false, startFails = false } = {}) {
  const box = { id: 'bx_aaaaaaa1', state: 'ready', files: new Map(), kit, bridgeSha: kit ? boatLib.BRIDGE_SHA : null, bridge: false, server: false, forwarder: false, proxy: null, proxyFile: false, ran: [] };
  const calls = [];
  const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
  const ran = (stdout, exitCode = 0) => reply(200, { ok: true, exitCode, stdout, stderr: exitCode ? stdout : '', timedOut: false });
  const fetch = async (url, { method = 'GET', body } = {}) => {
    const p = new URL(url).pathname.replace(/^\/api\/v1/, '');
    const data = body ? JSON.parse(body) : null;
    calls.push({ method, path: p, body: data });
    if (startFails) return reply(500, { ok: false, code: 'boom', error: 'boat.dev is down' });
    if (p === '/sandboxes' && method === 'POST') return reply(202, { ok: true, sandbox: { id: box.id, state: 'provisioning' } });
    if (p === `/sandboxes/${box.id}` && method === 'GET') return reply(200, { ok: true, sandbox: { id: box.id, state: box.state } });
    if (p === `/sandboxes/${box.id}` && method === 'PATCH') return reply(200, { ok: true });
    if (p === `/sandboxes/${box.id}/files` && method === 'PUT') { box.files.set(data.path, Buffer.from(data.content, 'base64').toString()); return reply(200, { ok: true }); }
    if (p !== `/sandboxes/${box.id}/commands`) return reply(400, { ok: false });
    const c = data.command;
    if (data.detached) {
      if (c.includes('camoufox-browser --serve')) { box.bridge = true; box.forwarder = !!box.proxyFile && !forwarderDead; if (box.proxyFile) box.proxy = box.proxyFile; }
      else if (c.includes('computer_server')) box.server = true;
      return reply(200, { ok: true, type: 'command.started', processId: 1 });
    }
    if (c.includes('install -d -o browser')) {
      if (box.kit !== boatLib.KIT_VERSION) return ran('kit\n');
      return ran(`${box.server ? 'server\n' : ''}${box.bridge ? 'bridge\n' : ''}sha ${box.bridgeSha || ''}\n`);
    }
    if (c.includes('mkdir -p /tmp/botdot-kit-')) return ran('');
    if (c.includes('/opt/botdot/kit-failed ]')) return ran('done\n');
    if (c.startsWith('sudo -n test -S /run/botdot-browser/bridge-0.sock') && !c.includes('base64 -d')) return ran('', box.bridge ? 0 : 9);
    if (c.includes('exec 3< /tmp/botdot-secret-')) { // a request to the bridge, from a file
      if (!box.bridge) return ran(JSON.stringify({ ok: false, down: true }));
      const file = c.match(/exec 3< (\S+) &&/)[1];
      const sent = JSON.parse(box.files.get(file));
      assert.equal(sent.op, 'proxy');
      if (bridgeRefuses) return ran(JSON.stringify({ ok: false, error: 'a proxy has a type (socks5 or http), a host and a port' }));
      box.proxyFile = sent.proxy; box.proxy = sent.proxy; box.forwarder = !!sent.proxy && !forwarderDead;
      return ran(JSON.stringify({ ok: true, proxyTaken: true, proxy: sent.proxy ? 'set' : 'none' }));
    }
    if (c.includes('base64 -d') && c.includes('sudo -n -u browser')) { // the bridge told it has no proxy, with no file
      if (!box.bridge) return ran('', 9);
      box.proxyFile = null; box.proxy = null; box.forwarder = false;
      return ran(JSON.stringify({ ok: true, proxyTaken: true, proxy: 'none' }));
    }
    if (c.includes('socket.create_connection(("127.0.0.1", 47300)')) return ran('', box.forwarder ? 0 : 1);
    if (c.includes('rm -f -- /home/browser/proxy-0.json')) { box.proxyFile = null; return ran(''); }
    if (c.includes('install -m 0755 /tmp/')) { box.bridgeSha = boatLib.BRIDGE_SHA; box.bridge = false; return ran(''); }
    if (c.includes('botdot-run')) { box.ran.push(c); return ran('ok\n'); }
    return ran('');
  };
  return { fetch, calls, box, commands: () => calls.filter((x) => x.path.endsWith('/commands')).map((x) => x.body) };
}
const machine = (t, opts, boatOpts = {}) => {
  boatLib.setKey(KEY);
  t.after(() => boatLib.setKey(null));
  const b = fakeBoat(opts);
  return { b, boat: boatLib.create(dir(), { kitOnStart: false, fetch: b.fetch, sleep: async () => {}, ...boatOpts }) };
};

test("a command with a proxy gets the proxy variables to the machine's forwarder, and one without gets none", async (t) => {
  const { b, boat } = machine(t);
  await boat.runShell('coder', { command: 'curl -s https://example.com', proxied: true });
  const [cmd] = b.box.ran;
  for (const k of ['HTTP_PROXY', 'HTTPS_PROXY', 'ALL_PROXY', 'http_proxy', 'https_proxy', 'all_proxy']) assert.ok(cmd.includes(`${k}=http://127.0.0.1:47300`), `${k} points at the forwarder`);
  assert.ok(cmd.includes('NO_PROXY=localhost,127.0.0.1,::1'), 'the machine itself is not proxied');
  assert.match(cmd, /export [^;]*HTTP_PROXY=[^;]*; exec timeout/, 'exported before the command starts');
  assert.ok(!cmd.includes(PROXY.password) && !cmd.includes(PROXY.username), 'no login in the command');
  await boat.runShell('coder', { command: 'curl -s https://example.com' });
  assert.ok(!/_PROXY=|_proxy=/.test(b.box.ran[1]), 'without a proxy the command is as it was');
});

test("the proxy goes to the machine's bridge alone: no screen, no desktop, and the bridge is not started twice", async (t) => {
  const { b, boat } = machine(t);
  assert.deepEqual(await boat.setProxy('coder', PROXY), { ok: true });
  assert.deepEqual(b.box.proxy, PROXY, 'the bridge has it');
  assert.equal(b.box.forwarder, true);
  assert.equal(b.box.server, false, "computer-server is the screen's: not started");
  const sent = b.commands().map((c) => c.command);
  assert.ok(!sent.some((c) => c.includes('xhost')), "the desktop (:0) is not let in: it's the screen's");
  assert.equal(b.commands().filter((c) => c.detached).length, 1, 'the bridge, and nothing else');
  assert.match(b.commands().find((c) => c.detached).command, /env HOME=\/home\/browser DISPLAY=:0 BOTDOT_SCREEN=1024x768 /, 'told the screen even with no desktop to read: a boat.dev bot keeps its 1024x768 screen and its identity');
  for (const c of sent) assert.ok(!c.includes(PROXY.password), 'the login is on no command line');
  const [file, content] = [...b.box.files.entries()].find(([p]) => p.startsWith('/tmp/botdot-secret-'));
  assert.equal(JSON.parse(content).proxy.password, PROXY.password, 'it went through the file API, as a typed secret does');
  assert.ok(file);
  // The screen that starts later finds the bridge running and starts no other.
  await boat.ensureScreen('coder');
  assert.equal(b.commands().filter((c) => c.detached && c.command.includes('camoufox-browser --serve')).length, 1);
});

test('the next command with the same proxy only asks that the forwarder answers; another proxy is handed over again', async (t) => {
  const { b, boat } = machine(t);
  await boat.setProxy('coder', PROXY);
  const before = b.commands().length;
  assert.deepEqual(await boat.setProxy('coder', PROXY), { ok: true });
  const asked = b.commands().slice(before).map((c) => c.command);
  assert.equal(asked.length, 1, 'one question to the machine');
  assert.ok(asked[0].includes('47300'));
  const other = { ...PROXY, host: 'other.example', name: 'DE' };
  assert.deepEqual(await boat.setProxy('coder', other), { ok: true });
  assert.deepEqual(b.box.proxy, other, 'a changed proxy applies from the next command');
  // A machine that started again has a bridge that does not run and a forwarder that is gone: it is handed over again.
  b.box.bridge = false;
  b.box.forwarder = false;
  assert.deepEqual(await boat.setProxy('coder', other), { ok: true });
  assert.equal(b.box.forwarder, true);
});

test('a removed proxy is taken from the bridge, or from its file when the bridge is not running', async (t) => {
  const { b, boat } = machine(t);
  await boat.setProxy('coder', PROXY);
  assert.deepEqual(await boat.setProxy('coder', null), { ok: true });
  assert.equal(b.box.proxy, null);
  assert.equal(b.box.forwarder, false, 'nothing is forwarded now');
  assert.deepEqual(await boat.setProxy('coder', PROXY), { ok: true });
  b.box.bridge = false; // it ended: only its file is left, and the next start would read it
  assert.deepEqual(await boat.setProxy('coder', null), { ok: true });
  assert.equal(b.box.proxyFile, null, 'its file is gone');
});

test("a forwarder that doesn't answer, or a bridge that refuses the proxy, is said, and the proxy is not taken as handed over", async (t) => {
  const dead = machine(t, { forwarderDead: true });
  const r = await dead.boat.setProxy('coder', PROXY);
  assert.equal(r.ok, false);
  assert.equal(r.proxy, true, "the proxy's own failure: the owner may test it");
  assert.match(r.error, /nothing answers at 127\.0\.0\.1:47300/);
  const refused = machine(t, { bridgeRefuses: true });
  const noProxy = await refused.boat.setProxy('coder', PROXY);
  assert.match(noProxy.error, /a proxy has a type/);
  assert.equal(noProxy.proxy, true);
  // Not remembered: once it answers, the next command hands it over again.
  dead.b.box.forwarder = false;
  assert.equal((await dead.boat.setProxy('coder', PROXY)).ok, false);
});

test("a machine that boat.dev can't start can't take the proxy, and says why", async (t) => {
  const { boat } = machine(t, { startFails: true });
  const r = await boat.setProxy('coder', PROXY);
  assert.equal(r.ok, false);
  assert.ok(r.error);
  assert.notEqual(r.proxy, true, "the machine's fault, not the proxy's: a test of the proxy would not help");
});

test('the kit is waited for: a machine without it gets it first, then the bridge alone', async (t) => {
  boatLib.setKey(KEY);
  t.after(() => boatLib.setKey(null));
  const b = fakeBoat({ kit: null });
  // The install of the kit is what makes the machine's kit current.
  const fetch = async (url, init) => {
    const r = await b.fetch(url, init);
    const sent = init?.body ? JSON.parse(init.body) : {};
    if (sent.detached && sent.command.includes('botdot-boat-kit')) Object.assign(b.box, { kit: boatLib.KIT_VERSION, bridgeSha: boatLib.BRIDGE_SHA });
    return r;
  };
  const boat = boatLib.create(dir(), { kitOnStart: false, fetch, sleep: async () => {} });
  assert.deepEqual(await boat.setProxy('coder', PROXY), { ok: true });
  assert.ok(b.calls.some((c) => c.method === 'PUT' && /botdot-boat-kit/.test(c.body.path)), 'the kit went there');
  assert.equal(b.box.server, false, 'and no screen');
});

// The facade: a boat bot's proxy goes to boat.dev's machine; its proxied command is never run on the account's computer.
function facadeWith(boat) {
  const got = [];
  const raw = { ensure: async () => 'on', runShell: async (...a) => { got.push(['runShell', a]); return { code: 0, stdout: 'on the account', stderr: '', timedOut: false }; }, setProxy: async () => { got.push(['setProxy']); return { ok: true }; }, restScreen: async () => {}, inspect: async () => ({ state: 'running' }) };
  return { f: screensLib.facade(raw, screensLib.create(dir()), { boat, kindOf: () => 'boat' }), got };
}

test("a boat bot's proxy goes to its machine, never to the account's computer", async (t) => {
  const { b, boat } = machine(t);
  const { f, got } = facadeWith(boat);
  assert.deepEqual(await f.setProxy('coder', PROXY), { ok: true });
  assert.deepEqual(b.box.proxy, PROXY);
  assert.ok(!got.some(([n]) => n === 'setProxy'));
});

test("a proxied command is never run on the account's computer when the machine fails under it", async (t) => {
  const { f, got } = facadeWith({ runShell: async () => { throw new Error('boat.dev is down'); }, boxOf: () => 'x' });
  const proxied = await f.runShell('coder', { command: 'curl x', proxied: true });
  assert.equal(proxied.code, null);
  assert.match(proxied.error, /^Your External Virtual PC couldn't be reached.*this command did not run, so nothing went out directly$/);
  assert.ok(!/ran on this machine/.test(proxied.error), 'it does not say it ran');
  assert.ok(!got.some(([n]) => n === 'runShell'), 'it did not run on the account\'s computer');
  const plain = await f.runShell('coder', { command: 'ls' });
  assert.equal(plain.stdout, 'on the account', 'a command without a proxy still stands in, as before');
});

test("a machine that took the proxy after a failure is the one the command runs on, not the account's computer standing in", async (t) => {
  const { b, boat } = machine(t);
  // The machine failed once in this run: its commands stood in on the account's computer.
  const flaky = { ...boat, boxOf: boat.boxOf };
  let down = true;
  flaky.runShell = async (...a) => { if (down) throw new Error('boat.dev is down'); return boat.runShell(...a); };
  const g = facadeWith(flaky);
  assert.match((await g.f.runShell('coder', { command: 'curl x', proxied: true })).error, /couldn't be reached/);
  down = false;
  assert.deepEqual(await g.f.setProxy('coder', PROXY), { ok: true }, 'the machine is up and has the proxy');
  const r = await g.f.runShell('coder', { command: 'curl x', proxied: true });
  assert.equal(r.code, 0, 'it ran on the machine');
  assert.ok(b.box.ran.at(-1).includes('HTTP_PROXY=http://127.0.0.1:47300'));
  assert.ok(!g.got.some(([n]) => n === 'runShell'), "never on the account's computer");
});

test("a proxied command and a screen tool at the same time on a fresh machine put the kit there once and start one bridge", async (t) => {
  boatLib.setKey(KEY);
  t.after(() => boatLib.setKey(null));
  const b = fakeBoat({ kit: null });
  const fetch = async (url, init) => {
    const r = await b.fetch(url, init);
    const sent = init?.body ? JSON.parse(init.body) : {};
    if (sent.detached && sent.command.includes('botdot-boat-kit')) Object.assign(b.box, { kit: boatLib.KIT_VERSION, bridgeSha: boatLib.BRIDGE_SHA });
    return r;
  };
  const boat = boatLib.create(dir(), { kitOnStart: false, fetch, sleep: async () => {} });
  const [proxy, screen] = await Promise.all([boat.setProxy('coder', PROXY), boat.ensureScreen('coder')]);
  assert.deepEqual(proxy, { ok: true });
  assert.equal(screen, undefined);
  const detached = b.commands().filter((c) => c.detached).map((c) => c.command);
  assert.equal(detached.filter((c) => c.includes('botdot-boat-kit')).length, 1, 'the kit is put there once');
  assert.equal(detached.filter((c) => c.includes('camoufox-browser --serve')).length, 1, 'one bridge');
  assert.equal(b.box.forwarder, true);
});
