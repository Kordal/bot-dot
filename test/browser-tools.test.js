// The browser tools (#170): a bot reads its Camoufox page as an accessibility tree with refs and acts by ref, through
// the bridge of its own screen, instead of by screenshot. The bridge runs on a stand-in Camoufox here
// (test/fixtures/camoufox-browser-tools.py); Docker is a stand-in too.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const util = require('node:util');
const childProcess = require('node:child_process');
const screensLib = require('../lib/computer-screens');
const { rpcClient } = require('./memory-helpers');

const LAUNCHER = path.join(__dirname, '..', 'deploy', 'desktop', 'camoufox-browser');
const SEAT = { bot: 'ops', screen: 2 };

function hasPython() {
  try { childProcess.execFileSync('python3', ['-c', 'pass']); return true; } catch { return false; }
}

let out;
async function pageTools() {
  out ||= JSON.parse((await util.promisify(childProcess.execFile)('python3', [path.join(__dirname, 'fixtures', 'camoufox-browser-tools.py'), LAUNCHER], { timeout: 30_000 })).stdout);
  return out;
}

test('the snapshot gives every control a ref and shows no secret box\'s value', { skip: !hasPython() }, async () => {
  const { snapshot } = await pageTools();
  assert.equal(snapshot.ok, true);
  assert.equal(snapshot.snapshot, [
    'Page: Stand-in (https://example.com/login)',
    '- heading "Sign in"',
    '- textbox "Email" [ref=e1]: me@example.com',
    '- textbox "Password" [ref=e2]: ••••',
    '- textbox "CVC" [ref=e3]',
    '- button "Log in" [ref=e4]',
    '- button "Log in" [ref=e5]',
    '- \'link "Help: FAQ"\' [ref=e6]',
    '- button [ref=e7]',
  ].join('\n'));
  assert.doesNotMatch(JSON.stringify(out), /synthetic-password/, 'the password is in no answer');
});

test('a ref finds its own element: the second of two same buttons, a name with a colon, a nameless one', { skip: !hasPython() }, async () => {
  const { done, click_second: second, fill_email: email } = await pageTools();
  assert.deepEqual(done.slice(0, 3), [['click', 'button', 'Log in', 5], ['click', 'link', 'Help: FAQ', 6], ['click', 'button', '', 7]]);
  assert.equal(second.ok, true);
  assert.match(second.snapshot, /\[ref=e5\]/, 'each answer is the new snapshot');
  assert.deepEqual(done[3], ['fill', 'Email', 'you@example.com']);
  assert.match(email.snapshot, /textbox "Email" \[ref=e1\]: you@example\.com/);
});

test('browser_fill refuses password, card and two-step code boxes and sends the bot to the typing tools', { skip: !hasPython() }, async () => {
  const { fill_password: password, fill_cvc: cvc, done } = await pageTools();
  for (const r of [password, cvc]) {
    assert.equal(r.ok, false);
    assert.match(r.error, /password, card or two-step code box/);
    assert.match(r.error, /type_login, type_card or type_identity/);
  }
  assert.equal(done.length, 4, 'nothing was typed into them');
});

test('an unknown or stale ref gives a clear error and asks for a new snapshot', { skip: !hasPython() }, async () => {
  const { unknown, gone, moved, shifted } = await pageTools();
  assert.deepEqual(shifted, { ok: false, error: 'e2 is stale: the page has changed since your last snapshot. Take a new snapshot.' },
    'an earlier control of the same name went: never a click on the wrong one');
  assert.deepEqual(unknown, { ok: false, error: 'e99 is not a ref of your last browser_snapshot. Take a new snapshot.' });
  assert.deepEqual(gone, { ok: false, error: 'e5 is stale: the page has changed since your last snapshot. Take a new snapshot.' }, 'its element is gone');
  assert.deepEqual(moved, { ok: false, error: 'e4 is stale: the page has changed since your last snapshot. Take a new snapshot.' }, 'the page went elsewhere');
});

test('goto takes only web addresses, wait says what did not show, and a long page is cut', { skip: !hasPython() }, async () => {
  const { goto_file: file, goto, wait_missing: missing, wait_nothing: nothing, long, refs_long: refs } = await pageTools();
  assert.deepEqual(file, { ok: false, error: 'browser_goto takes an http or https address.' });
  assert.equal(goto.ok, true);
  assert.match(goto.snapshot, /^Page: Stand-in \(https:\/\/example\.org\/\)/);
  assert.equal(missing.ok, false);
  assert.match(missing.error, /did not show within 1 seconds/);
  assert.deepEqual(nothing, { ok: false, error: 'Say which text or ref to wait for.' });
  assert.ok(long.snapshot.length < 12300, `cut at the cap, ${long.snapshot.length} characters`);
  assert.match(long.snapshot, /The page goes on/);
  assert.equal(refs, 2000, 'a ref beyond the cut still works');
});

test('a browser tool goes through the bridge\'s queue on the browser\'s thread, as type_secret does', () => {
  const launcher = fs.readFileSync(LAUNCHER, 'utf8');
  assert.match(launcher, /result = browser_tool\(context, body\) if body\.get\("op"\) in BROWSER_OPS else type_secret\(context, body\)/);
  assert.match(launcher, /BROWSER_OPS = \{"snapshot", "click", "fill", "press", "goto", "wait"\}/);
});

test('the Docker helper takes a browser tool only in its fixed shape, and it starts the bot\'s screen', async (t) => {
  const { createServer } = require('../lib/docker-helper');
  const where = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-helper-page-'));
  const socket = path.join(where, 'helper.sock');
  const server = createServer({ computers: { browserTool: async () => ({ ok: true }) }, updates: {} });
  await new Promise((r) => server.listen(socket, r));
  t.after(async () => { await new Promise((r) => server.close(r)); fs.rmSync(where, { recursive: true, force: true }); });
  const status = (operation, args) => new Promise((resolve, reject) => {
    const req = http.request({ socketPath: socket, method: 'POST', path: '/call' }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); });
    req.on('error', reject); req.end(JSON.stringify({ operation, args }));
  });
  assert.equal(await status('browserTool', [SEAT, { op: 'snapshot' }]), 200);
  assert.equal(await status('browserTool', [SEAT, { op: 'fill', ref: 'e1', text: 'hi' }]), 200);
  assert.equal(await status('browserTool', [SEAT, { op: 'wait', text: 'Done', seconds: 15 }]), 200);
  assert.equal(await status('browserTool', [SEAT, { op: 'wait', text: 'Done', seconds: 16 }]), 400);
  assert.equal(await status('browserTool', [SEAT, { op: 'type', value: 'x' }]), 400, 'no other op');
  assert.equal(await status('browserTool', [SEAT, { op: 'fill', ref: 'e1', value: 'x' }]), 400, 'no secret\'s key');
  assert.equal(await status('browserTool', ['ops', { op: 'snapshot' }]), 400, 'a seat, never a bare id');

  const got = [];
  const raw = { ensure: async () => { got.push('ensure'); }, browserTool: async () => { got.push('browserTool'); return { ok: true }; } };
  const c = screensLib.facade(raw, screensLib.create(fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-page-screens-'))));
  await c.browserTool('ops', { op: 'snapshot' });
  assert.deepEqual(got, ['ensure', 'browserTool']);
});

test('the bot\'s browser_ tools ask botdot\'s browser route and answer with the snapshot, no screenshot', async (t) => {
  const asked = [];
  const stub = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      asked.push({ path: req.url, body: body ? JSON.parse(body) : null });
      res.setHeader('Content-Type', 'application/json');
      if (req.url !== '/session/computer/browser') return res.end('{"ok":true}');
      const b = JSON.parse(body);
      res.end(JSON.stringify(b.ref === 'e9' ? { ok: false, error: 'e9 is stale' } : { ok: true, snapshot: `Page: after ${b.op}` }));
    });
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  t.after(() => stub.close());
  const mcp = rpcClient(t, 'computer-mcp.js', { VAULT_URL: `http://127.0.0.1:${stub.address().port}`, VAULT_TOKEN: 'fixture' });
  await mcp.request('initialize', {});
  const { tools } = await mcp.request('tools/list');
  const names = tools.map((x) => x.name);
  for (const name of ['browser_snapshot', 'browser_click', 'browser_fill', 'browser_press', 'browser_goto', 'browser_wait_for']) assert.ok(names.includes(name), name);
  assert.match(tools.find((x) => x.name === 'browser_fill').description, /Refused for password, card and two-step code boxes/);
  const calls = [
    ['browser_snapshot', {}, { op: 'snapshot' }],
    ['browser_click', { ref: 'e1' }, { op: 'click', ref: 'e1' }],
    ['browser_fill', { ref: 'e2', text: 'me@example.com' }, { op: 'fill', ref: 'e2', text: 'me@example.com' }],
    ['browser_press', { key: 'Enter' }, { op: 'press', key: 'Enter' }],
    ['browser_goto', { url: 'https://example.com' }, { op: 'goto', url: 'https://example.com' }],
    ['browser_wait_for', { text: 'Welcome' }, { op: 'wait', text: 'Welcome' }],
  ];
  for (const [name, args, body] of calls) {
    const r = await mcp.request('tools/call', { name, arguments: args });
    assert.deepEqual(r.content, [{ type: 'text', text: `Page: after ${body.op}` }], name);
    assert.deepEqual(asked.filter((a) => a.path === '/session/computer/browser').at(-1).body, body, name);
  }
  const stale = await mcp.request('tools/call', { name: 'browser_click', arguments: { ref: 'e9' } });
  assert.equal(stale.isError, true);
  assert.equal(stale.content[0].text, 'Error: e9 is stale');
  assert.ok(!asked.some((a) => a.path === '/session/computer/cmd'), 'no screenshot was taken');
});
