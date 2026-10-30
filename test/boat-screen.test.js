// A bot's screen on its boat.dev machine (#563, ADR 094): its screen and browser tools go to the machine's own desktop,
// where botdot puts its screen kit the first time and starts computer-server and Camoufox's bridge, through boat.dev's
// command and file API. Never to the account's computer, also when the machine can't start.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const boatLib = require('../lib/boat');
const screensLib = require('../lib/computer-screens');
const { rpcClient } = require('./memory-helpers');

const ROOT = path.join(__dirname, '..');
const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-boat-screen-'));
const KEY = `boat_${'x'.repeat(16)}`; // no real key
const SECRET = 'hunter2-pass';

// boat.dev with a machine as far as the screen uses it: the kit on its disk, computer-server and the bridge running
// until it stops, detached commands, files.
function fakeBoat({ failed = false, kit = null, bridgeSha = kit ? boatLib.BRIDGE_SHA : null, kitFails = false, desktopRefuses = false, installing = false, slow = false, bridgeDies = false, silent = 0, unreachable = 0, notReady = 0 } = {}) {
  const machines = new Map();
  const calls = [];
  let n = 0;
  const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
  const ran = (stdout, exitCode = 0) => reply(200, { ok: true, exitCode, stdout, stderr: exitCode ? stdout : '', timedOut: false });
  const fetch = async (url, { method = 'GET', headers, body } = {}) => {
    const u = new URL(url);
    const p = u.pathname.replace(/^\/api\/v1/, '');
    const data = body ? JSON.parse(body) : null;
    calls.push({ method, path: p, body: data });
    if (headers.Authorization !== `Bearer ${KEY}`) return reply(401, { ok: false, code: 'unauthorized' });
    if (p === '/sandboxes' && method === 'POST') {
      const id = `bx_${String(++n).padStart(8, 'a')}`;
      machines.set(id, { id, state: 'ready', files: new Map(), kit, bridgeSha, server: false, bridge: false, installing: installing ? boatLib.KIT_VERSION : false, failed, programs: [], asked: [] });
      return reply(202, { ok: true, sandbox: { id, state: 'provisioning' } });
    }
    const m = p.match(/^\/sandboxes\/(bx_[a-z0-9]+)(?:\/(.+))?$/);
    const box = m && machines.get(m[1]);
    if (!box) return reply(404, { ok: false, code: 'not_found' });
    if (!m[2] && method === 'GET') return reply(200, { ok: true, sandbox: { id: box.id, state: box.state } });
    if (!m[2] && method === 'PATCH') return reply(200, { ok: true });
    if (m[2] === 'stop') { Object.assign(box, { state: 'archived', server: false, bridge: false }); return reply(202, { ok: true }); }
    if (m[2] === 'resume') { box.state = 'ready'; return reply(202, { ok: true }); }
    if (m[2] === 'files' && method === 'PUT') { box.files.set(data.path, Buffer.from(data.content, data.encoding === 'base64' ? 'base64' : 'utf8').toString()); return reply(200, { ok: true }); }
    if (m[2] !== 'commands') return reply(400, { ok: false });
    const c = data.command;
    // boat.dev restarted a running machine under botdot (seen live): its commands are refused until it is back.
    if (notReady > 0) { notReady -= 1; return reply(409, { ok: false, code: 'sandbox_not_ready' }); }
    if (data.detached) {
      if (c.includes('botdot-boat-kit')) box.installing = c.match(/botdot-boat-kit (\S+)/)[1];
      else if (c.includes('computer_server')) box.server = true;
      else if (c.includes('camoufox-browser --serve')) box.bridge = !bridgeDies;
      else box.programs.push(c);
      return reply(200, { ok: true, type: 'command.started', processId: 1 });
    }
    if (c.includes('mkdir -p /tmp/botdot-kit-')) { if (!box.installing) box.failed = false; return ran(box.installing ? 'installing\n' : ''); }
    if (c.includes('/opt/botdot/kit-failed ]')) {
      if (!box.installing) return ran(box.failed ? "failed\nthe system's packages (exit 100)\n" : box.kit === boatLib.KIT_VERSION ? 'done\n' : '');
      if (kitFails) { box.installing = false; return ran("failed\nthe system's packages (exit 100)\nE: Unable to locate package libgtk-3-0t64\n"); }
      Object.assign(box, { kit: box.installing, bridgeSha: boatLib.BRIDGE_SHA, installing: false });
      return ran('done\n');
    }
    if (c.includes('xhost')) {
      // boat.dev's way to the machine broke (seen on a live machine): its start of the screen gets no answer.
      if (unreachable > 0) { unreachable -= 1; return reply(502, { ok: false, code: 'sandbox_direct_failed' }); }
      if (silent > 0) { silent -= 1; return reply(200, { ok: true, stdout: '', stderr: '', timedOut: true }); }
      if (box.kit !== boatLib.KIT_VERSION) return ran('kit\n');
      if (desktopRefuses) return ran("the machine's desktop (:0) did not let botdot in", 3);
      return ran(`${box.server ? 'server\n' : ''}${box.bridge ? 'bridge\n' : ''}sha ${box.bridgeSha || ''}\n`);
    }
    if (c.includes('install -m 0755 /tmp/')) { Object.assign(box, { bridgeSha: boatLib.BRIDGE_SHA, bridge: false }); return ran(''); }
    if (c.includes('botdot-bridge.log')) return ran(`${box.bridge ? '' : "Camoufox's bridge is not running\nModuleNotFoundError: No module named 'camoufox'\n"}${box.server ? '' : 'computer-server is not answering\n'}`);
    if (c.includes('test -S /run/botdot-browser/bridge-0.sock')) return ran('', !box.bridge ? 9 : !box.server ? 7 : 0);
    if (c.includes('urllib.request')) {
      if (!box.server) return ran('[Errno 111] Connection refused', 7);
      if (slow) { box.asked.push(c); return ran('timed out', 28); }
      const [, pathname, b64] = c.match(/ '(\/[a-z]*)' \d+ 47100 '([A-Za-z0-9+/=]*)'$/);
      const sent = b64 ? JSON.parse(Buffer.from(b64, 'base64').toString()) : null;
      box.sent = sent;
      return ran(pathname === '/status' ? '{"status": "ok"}' : `data: ${JSON.stringify({ success: true, image_data: 'iVBOR', command: sent?.command })}\n`);
    }
    if (c.includes('sudo -n -u browser /usr/bin/python3')) {
      if (!box.bridge) return ran(JSON.stringify({ ok: false, error: "Camoufox isn't open." }));
      return ran(JSON.stringify({ ok: true, snapshot: 'button "Log in" [ref=e1]' }));
    }
    return ran('');
  };
  return { fetch, calls, machines, setNotReady: (n) => { notReady = n; }, commands: () => calls.filter((x) => x.path.endsWith('/commands')).map((x) => x.body) };
}

const machine = (opts, boatOpts = {}) => {
  const b = fakeBoat(opts);
  const boat = boatLib.create(dir(), { fetch: b.fetch, sleep: async () => {}, account: '', ...boatOpts });
  return { b, boat };
};

test('the screen kit carries the versions the desktop image pins', () => {
  const kit = fs.readFileSync(path.join(ROOT, 'deploy', 'desktop', 'botdot-boat-kit'), 'utf8');
  const image = fs.readFileSync(path.join(ROOT, 'deploy', 'desktop', 'Dockerfile'), 'utf8');
  const pins = (text) => [...text.matchAll(/'([A-Za-z][\w.[\]-]*==[\w.]+)'/g)].map((x) => x[1]);
  const imagePins = pins(image).filter((x) => !x.startsWith('proxy-addr'));
  assert.ok(imagePins.includes('cua-computer-server==0.3.46') || imagePins.some((x) => x.startsWith('cua-computer-server==')), 'the image pins computer-server');
  assert.ok(imagePins.includes('fastapi==0.144.0'), 'FastAPI is pinned: computer-server 0.3.46 ends at its start on 0.145 or newer (#601)');
  for (const pin of imagePins) assert.ok(pins(kit).includes(pin), `the kit installs ${pin}, as the image does`);
  const browsers = (text) => [...text.matchAll(/official\/[\w./-]+/g)].map((x) => x[0]).sort();
  assert.deepEqual(browsers(kit), browsers(image), "the kit fetches and sets the image's Camoufox");
});

test('the screen kit takes off the mount that stops boat.dev saving a machine, and the admin hears of a machine it cannot save', async () => {
  const kit = fs.readFileSync(path.join(ROOT, 'deploy', 'desktop', 'botdot-boat-kit'), 'utf8');
  assert.match(kit, /umount -l \/home\/browser\/\.gvfs/);
  assert.match(kit, /apt-get remove -y -q gvfs-fuse/);

  const asked = [];
  const fetch = async (url) => {
    asked.push(String(url));
    return new Response(JSON.stringify({ sandboxes: [
      { id: 'bx_aaaaaaaa', name: 'botdot-a', snapshotCompletedAt: '2026-10-29T10:07:19.567Z', stop: { status: 'failing' } },
      { id: 'bx_bbbbbbbb', name: 'botdot-b', stop: null },
    ] }), { status: 200 });
  };
  assert.deepEqual(await boatLib.unsaved(KEY, { fetch }), [{ name: 'botdot-a', since: '2026-10-29T10:07:19.567Z' }]);
  assert.match(asked[0], /\/sandboxes\?limit=200$/);
  assert.deepEqual(await boatLib.unsaved(null, { fetch }), [], 'no key, no call');
  assert.equal(asked.length, 1);
  assert.deepEqual(await boatLib.unsaved(KEY, { fetch: async () => { throw new Error('down'); } }), [], 'boat.dev down leaves the page as it is');
});

test("a bot's first screen tool puts the kit on its machine, starts its screen there, and the next ones only use it", async (t) => {
  boatLib.setKey(KEY);
  t.after(() => boatLib.setKey(null));
  const { b, boat } = machine();
  const r = await boat.request('coder', '/cmd', { command: 'screenshot', params: {} });
  assert.equal(r.ok, true);
  assert.match(r.text, /"image_data":"iVBOR"/);
  const [box] = b.machines.values();
  assert.equal(box.kit, boatLib.KIT_VERSION, 'the kit is on its disk');
  for (const f of ['botdot-boat-kit', 'camoufox-browser', 'camoufox.desktop']) {
    const sent = [...box.files.entries()].find(([p]) => p.startsWith('/tmp/botdot-kit-') && p.endsWith(`/${f}`));
    assert.ok(sent, `${f} went through the file API`);
    assert.equal(sent[1], fs.readFileSync(path.join(ROOT, 'deploy', 'desktop', f), 'utf8'));
  }
  const detached = b.commands().filter((c) => c.detached).map((c) => c.command);
  assert.match(detached[0], /^exec sudo -n sh \/tmp\/botdot-kit-[0-9a-f]+\/botdot-boat-kit [0-9a-f]{16} \/tmp\/botdot-kit-/);
  assert.match(detached[1], /DISPLAY=:0 .*computer_server --host 127\.0\.0\.1 --port 47100/);
  assert.match(detached[2], /sudo -n -u browser env .*DISPLAY=:0 .*BOTDOT_DOWNLOADS=\/home\/user\/Downloads \/usr\/local\/bin\/camoufox-browser --serve :0 'coder'$/);
  const before = b.calls.length;
  await boat.request('coder', '/cmd', { command: 'left_click', params: { x: 1, y: 2 } });
  assert.deepEqual(box.sent, { command: 'left_click', params: { x: 1, y: 2 } }, 'the body reached computer-server');
  assert.equal(b.calls.length - before, 1, 'one command, nothing installed or started again');
});

test("the kit makes Camoufox the desktop's browser, as the image does, in place of the machine's Chrome (#582)", () => {
  const kit = fs.readFileSync(path.join(ROOT, 'deploy', 'desktop', 'botdot-boat-kit'), 'utf8');
  const image = fs.readFileSync(path.join(ROOT, 'deploy', 'desktop', 'Dockerfile'), 'utf8');
  assert.match(image, /COPY camoufox\.desktop \/usr\/share\/applications\/camoufox\.desktop/);
  assert.match(kit, /install -m 0644 "\$FROM\/camoufox\.desktop" \/usr\/share\/applications\/camoufox\.desktop/, 'its launcher');
  for (const line of ['update-alternatives --install /usr/bin/x-www-browser x-www-browser /usr/local/bin/camoufox-browser 300', 'update-alternatives --set x-www-browser /usr/local/bin/camoufox-browser']) {
    assert.ok(image.includes(line) && kit.includes(line), `both run ${line}`);
  }
  // The machine user's defaults for web pages, its other defaults (and Chrome's other kinds) kept.
  const script = kit.match(/<<'PY'\n([\s\S]*?)\nPY\n/)[1];
  const d = dir();
  const list = path.join(d, 'mimeapps.list');
  fs.writeFileSync(list, '[Default Applications]\ntext/html=google-chrome.desktop\nx-scheme-handler/https=google-chrome.desktop\napplication/pdf=evince.desktop\nx-scheme-handler/mailto=google-chrome.desktop\n');
  fs.writeFileSync(path.join(d, 'set.py'), script);
  require('node:child_process').execFileSync('python3', ['-I', path.join(d, 'set.py'), list]);
  const out = fs.readFileSync(list, 'utf8');
  for (const kind of ['text/html', 'x-scheme-handler/http', 'x-scheme-handler/https']) assert.match(out, new RegExp(`^${kind.replace('/', '\\/')}=camoufox\\.desktop$`, 'm'), kind);
  assert.match(out, /^application\/pdf=evince\.desktop$/m);
  assert.match(out, /^x-scheme-handler\/mailto=google-chrome\.desktop$/m);
  assert.match(out, /^\[Added Associations\]$/m);
});

const settle = async (until) => { for (let i = 0; i < 200 && !until(); i++) await new Promise((r) => setImmediate(r)); };

test('the kit goes on a machine as soon as it starts, before any screen tool, and the first screen tool waits for it (#582)', async (t) => {
  boatLib.setKey(KEY);
  t.after(() => boatLib.setKey(null));
  const { b, boat } = machine();
  const kitStarts = () => b.commands().filter((c) => c.detached && c.command.includes('botdot-boat-kit'));
  await boat.runShell('coder', { command: 'which camoufox-browser' });
  await settle(() => kitStarts().length);
  assert.equal(kitStarts().length, 1, 'started by the first command');
  assert.ok(!b.commands().some((c) => c.detached && /computer_server|--serve/.test(c.command)), 'no screen started for it');
  await boat.request('coder', '/cmd', { command: 'screenshot', params: {} });
  assert.equal(kitStarts().length, 1, 'the screen tool waited for that install');
  assert.equal(b.commands().filter((c) => c.detached).length, 3, 'then computer-server and the bridge');
});

test('a machine that has the kit, or whose kit failed, gets none at its start: a screen tool tries a failed one again', async (t) => {
  boatLib.setKey(KEY);
  t.after(() => boatLib.setKey(null));
  const ready = machine({ kit: boatLib.KIT_VERSION });
  await ready.boat.runShell('coder', { command: 'true' });
  await settle(() => false);
  assert.ok(!ready.b.commands().some((c) => c.detached), 'nothing sent');
  const failed = machine({ failed: true });
  await failed.boat.runShell('coder', { command: 'true' });
  await settle(() => false);
  assert.ok(!failed.b.commands().some((c) => c.detached), 'a failed kit waits for a screen tool');
  await failed.boat.ensureScreen('coder');
  assert.equal(failed.b.commands().filter((c) => c.detached && c.command.includes('botdot-boat-kit')).length, 1, 'which puts it there again');
});

test('a machine that has the kit only starts its screen, and one that stopped starts it again', async (t) => {
  boatLib.setKey(KEY);
  t.after(() => boatLib.setKey(null));
  let now = 1e6;
  const { b, boat } = machine({ kit: boatLib.KIT_VERSION }, { now: () => now });
  await boat.ensureScreen('coder');
  assert.ok(!b.calls.some((c) => c.method === 'PUT'), 'no kit sent');
  assert.equal(b.commands().filter((c) => c.detached).length, 2, 'computer-server and the bridge');
  now += 31 * 60_000;
  assert.deepEqual(await boat.restIdle(), ['coder'], 'screen tools are use like any other; unused, the machine stops');
  const r = await boat.browserTool('coder', { op: 'snapshot' });
  assert.equal(r.ok, true);
  assert.equal(b.commands().filter((c) => c.detached).length, 4, 'both started again after the machine started again');
});

test("a kit that can't be put there says which step failed, and the next screen tool tries again", async (t) => {
  boatLib.setKey(KEY);
  t.after(() => boatLib.setKey(null));
  const { b, boat } = machine({ kitFails: true });
  await assert.rejects(boat.ensureScreen('coder'), /couldn't put the screen kit on your machine, at the system's packages \(exit 100\)/);
  await assert.rejects(boat.request('coder', '/cmd', { command: 'screenshot' }), /screen kit/);
  assert.equal(b.commands().filter((c) => c.detached).length, 2, 'tried twice');
});

test("a desktop that won't let botdot in is said, and nothing is started", async (t) => {
  boatLib.setKey(KEY);
  t.after(() => boatLib.setKey(null));
  const { b, boat } = machine({ kit: boatLib.KIT_VERSION, desktopRefuses: true });
  await assert.rejects(boat.ensureScreen('coder'), /screen didn't start: the machine's desktop \(:0\) did not let botdot in/);
  assert.equal(b.commands().filter((c) => c.detached).length, 0);
});

test("a machine that doesn't answer the screen's start is asked once more, and is never said to miss its kit", async (t) => {
  boatLib.setKey(KEY);
  t.after(() => boatLib.setKey(null));
  const once = machine({ kit: boatLib.KIT_VERSION, silent: 1 });
  assert.equal((await once.boat.request('coder', '/cmd', { command: 'screenshot', params: {} })).ok, true, 'the second ask started the screen');
  const silent = machine({ kit: boatLib.KIT_VERSION, silent: 2 });
  await assert.rejects(silent.boat.ensureScreen('coder'), (e) => /screen didn't start: your machine didn't answer in time/.test(e.message) && !/kit/.test(e.message));
  const cut = machine({ kit: boatLib.KIT_VERSION, unreachable: 2 });
  await assert.rejects(cut.boat.ensureScreen('coder'), (e) => /screen didn't start: boat\.dev couldn't reach your machine/.test(e.message) && !/kit/.test(e.message));
  assert.equal(cut.b.commands().filter((c) => c.detached).length, 0, 'nothing started');
});

test("a machine boat.dev says is not ready is waited for and the call made once more; one that stays so says so", async (t) => {
  boatLib.setKey(KEY);
  t.after(() => boatLib.setKey(null));
  const { b, boat } = machine({ kit: boatLib.KIT_VERSION });
  assert.equal((await boat.runShell('coder', { command: 'echo ok' })).code, 0);
  const [box] = b.machines.values();
  b.setNotReady(2);
  const r = await boat.runShell('coder', { command: 'echo ok' });
  assert.equal(r.code, 0, `came back: ${r.error}`);
  assert.equal([...b.machines.values()].length, 1, 'the same machine, no new one');
  assert.equal(box.id, [...b.machines.keys()][0]);
  let at = 0;
  const stuck = machine({ kit: boatLib.KIT_VERSION }, { now: () => (at += 10_000) });
  assert.equal((await stuck.boat.runShell('coder', { command: 'echo ok' })).code, 0);
  stuck.b.setNotReady(1000);
  const s = await stuck.boat.runShell('coder', { command: 'echo ok' });
  assert.match(s.error, /your machine at boat\.dev isn't ready/);
});

test("a screen that doesn't come up says which part of it didn't, with the end of its log", async (t) => {
  boatLib.setKey(KEY);
  t.after(() => boatLib.setKey(null));
  let at = 0;
  const { b, boat } = machine({ kit: boatLib.KIT_VERSION, bridgeDies: true }, { now: () => (at += 10_000) });
  await assert.rejects(boat.ensureScreen('coder'), /screen didn't start in time: Camoufox's bridge is not running\nModuleNotFoundError: No module named 'camoufox'$/);
  const detached = b.commands().filter((c) => c.detached).map((c) => c.command);
  assert.ok(detached.some((c) => /^exec >\/tmp\/botdot-computer-server\.log 2>&1\n.*computer_server/s.test(c)), "computer-server's output goes to a log");
  assert.ok(detached.some((c) => /^exec >\/tmp\/botdot-bridge\.log 2>&1\n.*camoufox-browser --serve/s.test(c)), "the bridge's first output goes to a log");
});

test('a typed secret reaches the bridge through a file that is gone before the helper starts, never on a command line', async (t) => {
  boatLib.setKey(KEY);
  t.after(() => boatLib.setKey(null));
  const { b, boat } = machine({ kit: boatLib.KIT_VERSION });
  const r = await boat.typeSecret('coder', { site: 'example.com', field: 'password', value: SECRET, submit: false });
  assert.equal(r.ok, true);
  for (const c of b.commands()) assert.ok(!c.command.includes(SECRET), 'not on a command line');
  const [box] = b.machines.values();
  const [file, content] = [...box.files.entries()].find(([p]) => p.startsWith('/tmp/botdot-secret-'));
  assert.equal(JSON.parse(content).value, SECRET, 'it went through the file API');
  const typed = b.commands().find((c) => c.command.includes(file)).command;
  assert.match(typed, new RegExp(`exec 3< ${file} && rm -f -- ${file} \\|\\|`), 'opened and removed first');
  assert.ok(typed.indexOf(`rm -f -- ${file}`) < typed.indexOf('sudo -n -u browser'), 'before the helper runs');
  assert.match(typed, /cat <&3 \| sudo -n -u browser \/usr\/bin\/python3 -I -c '.*' \/run\/botdot-browser\/bridge-0\.sock$/s);
});

test("a browser tool answers the bridge's words, and an unreachable boat.dev is said, not thrown", async (t) => {
  boatLib.setKey(KEY);
  t.after(() => boatLib.setKey(null));
  const { boat } = machine({ kit: boatLib.KIT_VERSION });
  assert.deepEqual(await boat.browserTool('coder', { op: 'snapshot' }), { ok: true, snapshot: 'button "Log in" [ref=e1]' });
  const down = boatLib.create(dir(), { fetch: async () => { throw new Error('down'); }, sleep: async () => {} });
  assert.match((await down.browserTool('coder', { op: 'snapshot' })).error, /Couldn't reach the browser: boat.dev can't be reached/);
  assert.match((await down.typeSecret('coder', { op: 'where' })).error, /boat.dev can't be reached/);
});

test("a program started on the screen runs detached on the machine's display", async (t) => {
  boatLib.setKey(KEY);
  t.after(() => boatLib.setKey(null));
  const { b, boat } = machine({ kit: boatLib.KIT_VERSION });
  await boat.startProgram('coder', "camoufox-browser 'https://example.com'");
  const [box] = b.machines.values();
  assert.deepEqual(box.programs, ["cd /home/user && exec env DISPLAY=:0 sh -c 'camoufox-browser '\\''https://example.com'\\'''"]);
});

test("a boat bot's screen calls go to its machine and never to the account's computer, also when boat.dev refuses", async (t) => {
  const got = [];
  const record = (name) => async () => { got.push(name); return { ok: true, text: 'on the account' }; };
  const raw = { ensure: record('ensure'), request: record('request'), typeSecret: record('typeSecret'), browserTool: record('browserTool'), startProgram: record('startProgram'), restScreen: async () => {}, inspect: async () => ({ state: 'running' }) };
  boatLib.setKey(KEY);
  t.after(() => boatLib.setKey(null));
  const { boat } = machine({ kit: boatLib.KIT_VERSION });
  const f = screensLib.facade(raw, screensLib.create(dir()), { boat, kindOf: () => 'boat' });
  await f.ensure('coder');
  assert.equal((await f.request('coder', '/cmd', { command: 'screenshot', params: {} })).ok, true);
  assert.equal((await f.browserTool('coder', { op: 'snapshot' })).ok, true);
  boatLib.setKey(null); // boat.dev can't be used now
  const off = screensLib.facade(raw, screensLib.create(dir()), { boat: boatLib.create(dir(), { fetch: async () => { throw new Error('down'); } }), kindOf: () => 'boat' });
  await assert.rejects(off.ensure('coder'), /boat.dev has no key/);
  await assert.rejects(off.request('coder', '/cmd', { command: 'screenshot' }), /boat.dev has no key/);
  assert.match((await off.typeSecret('coder', { op: 'where' })).error, /boat.dev has no key/);
  await assert.rejects(off.startProgram('coder', 'xterm'), /boat.dev has no key/);
  assert.deepEqual(got, [], "nothing reached the account's computer");
});

test("a boat bot's tools include the screen and browser, say no word of other bots, and keep no secret on disk", async (t) => {
  const mcp = rpcClient(t, 'computer-mcp.js', { VAULT_URL: 'http://127.0.0.1:9', VAULT_TOKEN: 'fixture', COMPUTER_KIND: 'boat' });
  await mcp.request('initialize', {});
  const { tools } = await mcp.request('tools/list');
  const names = tools.map((x) => x.name);
  for (const name of ['screenshot', 'send_screenshot', 'screen_size', 'click', 'move_mouse', 'drag', 'type_text', 'press_keys', 'scroll', 'open_browser', 'browser_snapshot', 'browser_click', 'browser_fill', 'browser_press', 'browser_goto', 'browser_wait_for', 'start_program', 'keep_computer_on', 'type_login', 'type_card', 'type_identity', 'run_shell']) {
    assert.ok(names.includes(name), name);
  }
  assert.ok(!names.includes('place_secret_file'));
  for (const x of tools) assert.doesNotMatch(x.description, /other bots|account's computer/, x.name);
});

test('a newer bridge alone goes to a machine that has the kit, and the old one running ends', async (t) => {
  boatLib.setKey(KEY);
  t.after(() => boatLib.setKey(null));
  const { b, boat } = machine({ kit: boatLib.KIT_VERSION, bridgeSha: 'old' });
  await boat.ensureScreen('coder');
  const [box] = b.machines.values();
  assert.ok(![...box.files.keys()].some((p) => p.includes('botdot-kit-')), 'no kit sent');
  const swap = b.commands().find((c) => c.command.includes('install -m 0755')).command;
  assert.match(swap, /\/usr\/local\/bin\/camoufox-browser/);
  assert.match(swap, /pkill -f 'camoufox-\[b\]rowser --serve :0 '/);
  assert.equal([...box.files.values()].find((v) => v.startsWith('#!/opt/camoufox/bin/python')), fs.readFileSync(path.join(ROOT, 'deploy', 'desktop', 'camoufox-browser'), 'utf8'));
  assert.equal(b.commands().filter((c) => c.detached).length, 2, 'computer-server and the new bridge');
});

test('an install still running is waited for, never started twice', async (t) => {
  boatLib.setKey(KEY);
  t.after(() => boatLib.setKey(null));
  const { b, boat } = machine({ installing: true });
  await boat.ensureScreen('coder');
  assert.ok(!b.commands().some((c) => c.detached && c.command.includes('botdot-boat-kit')), 'no second install');
  assert.ok(!b.calls.some((c) => c.method === 'PUT'));
});

test('a request that took too long is not asked again', async (t) => {
  boatLib.setKey(KEY);
  t.after(() => boatLib.setKey(null));
  const { b, boat } = machine({ kit: boatLib.KIT_VERSION, slow: true });
  // computer-server answers /status, but every request runs out of time.
  const box = () => [...b.machines.values()][0];
  await boat.ensureScreen('coder').catch(() => {});
  const r = await boat.request('coder', '/cmd', { command: 'type_text', params: { text: 'once' } });
  assert.equal(r.ok, false);
  assert.equal(box().asked.filter((c) => !c.includes("'/status'")).length, 1, 'typed once');
});
