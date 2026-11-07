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

// What keeps a bot's browser steady (test/fixtures/camoufox-bridge-steady.py, on the stand-in Camoufox).
let steady;
async function steadyOut() {
  steady ||= JSON.parse((await util.promisify(childProcess.execFile)('python3', [path.join(__dirname, 'fixtures', 'camoufox-bridge-steady.py'), LAUNCHER], { timeout: 30_000 })).stdout);
  return steady;
}

test('a slow page answers with what it shows so far, and a step done on a page not readable yet is said as done', { skip: !hasPython() }, async () => {
  const out = await steadyOut();
  assert.equal(out.goto_slow.ok, true, 'a slow site is no failed goto');
  assert.match(out.goto_slow.snapshot, /^Page: Stand-in \(https:\/\/example\.com\/\)\nThe page did not finish loading in 15 s: this is what it shows so far\.\n- button/,
    'the page line stays first: it tells botdot the site');
  assert.deepEqual(out.click_unread, { ok: true, unread: true, snapshot: 'Done, but the page is still changing, so it could not be read yet. Take a browser_snapshot in a moment.' },
    'never "failed" for a click that happened: the bot would do it twice');
  assert.equal(out.snapshot_unread.ok, false, 'a snapshot alone still says it could not read the page');
  assert.match(out.click_covered.error, /Something covers it \(a pop-up, a cookie banner\?\): close that first\.$/);
  assert.ok(!out.click_covered.error.includes('cookie"'), "the page's markup is not passed on");
});

test('a request that waited too long in the queue is not done at all, and one in time is', { skip: !hasPython() }, async () => {
  const out = await steadyOut();
  assert.deepEqual(out.late, { ok: false, error: 'The browser was still busy with an earlier step, so this was not done. Take a new browser_snapshot, then try again.' });
  assert.deepEqual(out.in_time, { ok: true, host: '' });
});

test('an open while Camoufox starts adds no tab, and Camoufox 0.5.6 still opens with the newer bridge', { skip: !hasPython() }, async () => {
  const out = await steadyOut();
  assert.deepEqual(out.open_while_starting, { ok: true });
  assert.equal(out.queued_while_starting, 0, 'the browser that starts opens its own page');
  assert.equal(out.queued_after, 1);
  assert.equal(out.opened_on_056, true, 'a computer not yet updated to the newer desktop keeps its browser');
  assert.equal(out.screen_from, 'browserforge');
  assert.equal(out.humanize, 0.5, 'curved cursor moves of at most half a second');
});

test('a saved secret is typed a key at a time with uneven pauses, as a person types', { skip: !hasPython() }, async () => {
  const { typed_keys: keys, waits } = await steadyOut();
  assert.equal(keys.join(''), 'synthetic secret');
  assert.equal(keys.length, 16);
  assert.equal(waits.length, 16);
  assert.ok(waits.every((ms) => ms >= 40 && ms <= 300), String(waits));
  assert.ok(new Set(waits).size > 4, 'not one steady beat');
});

// open_browser waits until its Camoufox is open, however long that takes up to its limit, and answers with the page,
// not a screenshot after a fixed 7 s. When it is open already, it goes to the address in its tab.
function openBrowserStub(t, { openAfter = 1, page = 'Page: Example (https://example.com/)' } = {}) {
  const asked = [];
  let checks = 0;
  const stub = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      const b = body ? JSON.parse(body) : null;
      asked.push({ path: req.url, body: b });
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/session/computer/cmd' && b.command === 'run_command') {
        const open = ++checks > openAfter;
        return res.end(JSON.stringify({ ok: true, text: `data: ${JSON.stringify({ success: true, stdout: open ? 'yes\n' : 'no\n' })}` }));
      }
      if (req.url === '/session/computer/cmd') return res.end('{"ok": true, "text": "data: {\\"success\\": true, \\"image_data\\": \\"aGk=\\"}"}');
      if (req.url === '/session/computer/browser') return res.end(JSON.stringify(checks > openAfter ? { ok: true, snapshot: `${page}${b.op === 'goto' ? ` after goto ${b.url}` : ''}` } : { ok: false, error: "Camoufox isn't open." }));
      res.end('{"ok":true}');
    });
  });
  return new Promise((r) => stub.listen(0, '127.0.0.1', r)).then(() => {
    t.after(() => stub.close());
    return { asked, url: `http://127.0.0.1:${stub.address().port}` };
  });
}

test('open_browser answers with the page as soon as Camoufox is open, without a fixed wait', async (t) => {
  const { asked, url } = await openBrowserStub(t, { openAfter: 2 });
  const mcp = rpcClient(t, 'computer-mcp.js', { VAULT_URL: url, VAULT_TOKEN: 'fixture', COMPUTER_CONTAINER: 'botdot.account.computer' });
  await mcp.request('initialize', {});
  const began = Date.now();
  const out = await mcp.request('tools/call', { name: 'open_browser', arguments: { url: 'example.com' } });
  assert.ok(Date.now() - began < 5000, `${Date.now() - began} ms`);
  assert.equal(out.content.length, 1, 'the page as text, no screenshot');
  assert.equal(out.content[0].text, 'Opened Camoufox at https://example.com.\nPage: Example (https://example.com/)');
  const launches = asked.filter((a) => a.path === '/session/computer/launch');
  assert.deepEqual(launches.map((a) => a.body.command), ["camoufox-browser 'https://example.com' >/tmp/camoufox.log 2>&1"]);
  const probe = asked.findIndex((a) => a.path === '/session/computer/browser');
  assert.ok(probe >= 0 && probe < asked.indexOf(launches[0]), 'the bridge is asked first, which starts one that ended');
});

test('open_browser on an open Camoufox goes to the address in its tab and answers with that page', async (t) => {
  const { asked, url } = await openBrowserStub(t, { openAfter: 0 });
  const mcp = rpcClient(t, 'computer-mcp.js', { VAULT_URL: url, VAULT_TOKEN: 'fixture', COMPUTER_CONTAINER: 'botdot.account.computer' });
  await mcp.request('initialize', {});
  const out = await mcp.request('tools/call', { name: 'open_browser', arguments: { url: 'https://example.org/a' } });
  assert.equal(out.content[0].text, 'Camoufox is already open, so it went to https://example.org/a in its tab.\nPage: Example (https://example.com/) after goto https://example.org/a');
  assert.ok(!asked.some((a) => a.path === '/session/computer/launch'), 'nothing more was started');
});

test('open_browser says so when Camoufox does not open in time', async (t) => {
  const { asked, url } = await openBrowserStub(t, { openAfter: 1e9 });
  const mcp = rpcClient(t, 'computer-mcp.js', { VAULT_URL: url, VAULT_TOKEN: 'fixture', COMPUTER_CONTAINER: 'botdot.account.computer', BOT_DOT_OPEN_BROWSER_WAIT_MS: '3000' });
  await mcp.request('initialize', {});
  const out = await mcp.request('tools/call', { name: 'open_browser', arguments: {} });
  assert.match(out.content[0].text, /^Camoufox did not open within 3 seconds\. Call open_browser once more; if it fails again, tell the owner/);
  assert.equal(asked.filter((a) => a.path === '/session/computer/launch').length, 1, 'one open: a second would be a second tab');
});

test('open_browser takes an address as a person types it, and says when it stays where it is', async (t) => {
  const { asked, url } = await openBrowserStub(t, { openAfter: 0 });
  const mcp = rpcClient(t, 'computer-mcp.js', { VAULT_URL: url, VAULT_TOKEN: 'fixture', COMPUTER_CONTAINER: 'botdot.account.computer' });
  await mcp.request('initialize', {});
  const open = async (u) => (await mcp.request('tools/call', { name: 'open_browser', arguments: u === undefined ? {} : { url: u } })).content[0].text;
  assert.match(await open('localhost:3000/app'), /went to http:\/\/localhost:3000\/app in its tab/);
  assert.match(await open('example.com:8443/x'), /went to https:\/\/example\.com:8443\/x in its tab/);
  assert.match(await open(''), /^Camoufox is already open\.\n/, 'nothing is a blank page, never https://');
  assert.match(await open('file:///etc/hosts'), /^Camoufox is already open\. It goes only to http and https addresses, so it stayed where it is, not file:\/\/\/etc\/hosts\./);
  assert.deepEqual(asked.filter((a) => a.body?.op === 'goto').map((a) => a.body.url), ['http://localhost:3000/app', 'https://example.com:8443/x']);
});

test('open_browser says at once when the browser keeps stopping, instead of waiting for it', async (t) => {
  const http2 = require('node:http');
  const stub = http2.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      res.setHeader('Content-Type', 'application/json');
      if (req.url === '/session/computer/cmd') return res.end(JSON.stringify({ ok: true, text: `data: ${JSON.stringify({ success: true, stdout: 'no\n' })}` }));
      if (req.url === '/session/computer/browser') return res.end(JSON.stringify({ ok: false, error: "The browser keeps stopping, so botdot didn't start it again now. Tell the owner, and try again in ten minutes." }));
      if (req.url === '/session/computer/launch') throw new Error('not launched');
      res.end('{"ok":true}');
    });
  });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  t.after(() => stub.close());
  const mcp = rpcClient(t, 'computer-mcp.js', { VAULT_URL: `http://127.0.0.1:${stub.address().port}`, VAULT_TOKEN: 'fixture', COMPUTER_CONTAINER: 'botdot.account.computer' });
  await mcp.request('initialize', {});
  const out = await mcp.request('tools/call', { name: 'open_browser', arguments: { url: 'https://example.com' } });
  assert.match(out.content[0].text, /^The browser keeps stopping/);
});
