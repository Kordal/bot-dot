// Optional browser check of botdot's own screen viewer (ADR 279, #1733):
//   NODE_PATH=<directory containing playwright> node test/browser/screen-viewer.cjs
// The viewer at /computer/<bot>/vnc.html against a stand-in computer: botdot's server is real, the helper behind it
// and the VNC server (RFB 3.8, one raw picture of 800x500) are stand-ins. It checks the states in words (Starting the
// computer…, Watching, You have control, Reconnecting…, Turned off), that it connects by itself once the computer is
// up and again after it dropped, that the picture is the desktop's own shape and fits the window, that it sends no
// mouse or key until the owner has control, that the web page's frame is told the state (data-screen) and that
// noVNC's own page is gone. Scratch data only.
//   VIEWER_SHOTS=<folder>  save a screenshot of each state
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, heldRun, waitFor } = require('../helpers');
const { validate } = require('../../lib/docker-helper');

const SHOTS = process.env.VIEWER_SHOTS;
const W = 800, H = 500;

// A WebSocket frame, as the server sends it (binary, unmasked), and the frames of what the browser sends (masked).
const frame = (payload) => {
  const n = payload.length;
  let head = Buffer.from([0x82, n]);
  if (n >= 126) head = Buffer.from([0x82, 126, n >> 8, n & 255]);
  if (n >= 65536) { head = Buffer.alloc(10); head[0] = 0x82; head[1] = 127; head.writeUInt32BE(n, 6); }
  return Buffer.concat([head, payload]);
};
function* frames(state) {
  for (;;) {
    const b = state.buf;
    if (b.length < 2) return;
    let n = b[1] & 127, at = 2;
    if (n === 126) { if (b.length < 4) return; n = b.readUInt16BE(2); at = 4; }
    if (b.length < at + 4 + n) return;
    const mask = b.subarray(at, at + 4), data = Buffer.from(b.subarray(at + 4, at + 4 + n));
    for (let i = 0; i < n; i++) data[i] ^= mask[i % 4];
    state.buf = b.subarray(at + 4 + n);
    if ((b[0] & 15) === 2) yield data;
  }
}

// The computer's VNC server, as far as noVNC needs: no password, one picture, and a record of what it was sent.
function vncServer(sock, got) {
  const ws = { buf: Buffer.alloc(0) };
  let rfb = Buffer.alloc(0), stage = 'version';
  const send = (b) => sock.write(frame(b));
  send(Buffer.from('RFB 003.008\n'));
  const need = { version: 12, security: 1, init: 1 };
  const step = () => {
    for (;;) {
      if (stage in need) {
        if (rfb.length < need[stage]) return;
        rfb = rfb.subarray(need[stage]);
        if (stage === 'version') send(Buffer.from([1, 1]));
        if (stage === 'security') send(Buffer.alloc(4));
        if (stage === 'init') {
          const name = Buffer.from('stand-in');
          const init = Buffer.alloc(24 + name.length);
          init.writeUInt16BE(W, 0); init.writeUInt16BE(H, 2);
          init.set([32, 24, 0, 1], 4); init.writeUInt16BE(255, 8); init.writeUInt16BE(255, 10); init.writeUInt16BE(255, 12);
          init.set([16, 8, 0], 14); init.writeUInt32BE(name.length, 20); init.set(name, 24);
          send(init);
        }
        stage = { version: 'security', security: 'init', init: 'run' }[stage];
        continue;
      }
      const type = rfb[0];
      const size = { 0: 20, 3: 10, 4: 8, 5: 6 }[type] ?? (type === 2 && rfb.length >= 4 ? 4 + 4 * rfb.readUInt16BE(2) : type === 6 && rfb.length >= 8 ? 8 + rfb.readUInt32BE(4) : 0);
      if (!rfb.length || !size || rfb.length < size) return;
      const msg = rfb.subarray(0, size);
      rfb = rfb.subarray(size);
      if (type === 4) got.keys.push({ down: msg[1], key: msg.readUInt32BE(4) });
      if (type === 5) got.pointers.push({ mask: msg[1], x: msg.readUInt16BE(2), y: msg.readUInt16BE(4) });
      if (type === 3 && !msg[1]) {
        // The first full request: the picture, as one raw rectangle (blue, with a lighter bar to tell its edges).
        const px = Buffer.alloc(W * H * 4);
        for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) px.set(y < 40 ? [200, 160, 90, 0] : [120, 60, 30, 0], (y * W + x) * 4);
        const head = Buffer.alloc(16);
        head.writeUInt16BE(1, 2); head.writeUInt16BE(W, 8); head.writeUInt16BE(H, 10);
        sock.write(frame(Buffer.concat([head, px])));
      }
    }
  };
  sock.on('data', (d) => {
    ws.buf = Buffer.concat([ws.buf, d]);
    for (const m of frames(ws)) { rfb = Buffer.concat([rfb, m]); step(); }
  });
}

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-viewer-'));
  const socket = path.join(dir, 'helper.sock');
  const got = { keys: [], pointers: [] };
  const live = new Set();
  let computerOn = false; // the computer's screen answers
  let vncUp = false; // and its VNC server accepts
  const helper = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { operation, args } = JSON.parse(body);
    if (!validate(operation, args)) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Invalid helper operation' })); }
    let value = null;
    if (operation === 'request') value = { ok: true, text: 'data: {"success": true}' };
    if (operation === 'inspect' || operation === 'details') value = { state: 'running' };
    if (operation === 'screenState') value = { state: computerOn ? 'running' : 'off' };
    if (operation === 'listAll') value = {};
    if (operation === 'update.status') value = { supported: false };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ value }));
  });
  helper.on('upgrade', (_req, sock) => {
    sock.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: botdot-screen\r\n\r\n');
    sock.on('error', () => {});
    let asked = '';
    const first = (d) => {
      asked += d;
      if (!asked.includes('\r\n\r\n')) return;
      sock.off('data', first);
      const key = /sec-websocket-key: (\S+)/i.exec(asked)?.[1];
      if (!vncUp || !key) return sock.destroy();
      const accept = crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
      sock.write(`HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
      live.add(sock);
      sock.on('close', () => live.delete(sock));
      vncServer(sock, got);
    };
    sock.on('data', first);
  });
  await new Promise((r) => helper.listen(socket, r));
  const srv = await startServer({ env: { BOT_DOT_HELPER_SOCKET: socket } });
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const bot = await makeBot(srv, { name: 'Viewer Bot', computer: 'linux' });
    // The bot's first computer tool gives it a screen of its own (#105).
    const held = await heldRun(srv, bot);
    await srv.api('/vault/session/computer/cmd', { method: 'POST', headers: { 'X-Vault-Token': held.token }, body: { command: 'screenshot', params: {} } });
    const viewer = (control) => `${srv.base}/computer/${bot.id}/vnc.html?view_only=${control ? 0 : 1}`;
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const errors = [];
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    const said = () => page.locator('#status').innerText();
    const shot = async (name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); } };
    const sees = (text) => waitFor(async () => (await said()) === text, { what: `the viewer to say "${text}"`, timeout: 15_000 });

    // noVNC's own page is not served any more, and nothing outside the viewer's folders is.
    computerOn = true;
    for (const p of ['app/ui.js', 'package.json', 'vnc.html.bak', 'viewer/../viewer.html/x', 'core/../package.json']) {
      assert.equal((await fetch(`${srv.base}/computer/${bot.id}/${p}`)).status, 404, p);
    }
    computerOn = false;

    // The computer is off: the page says so (and asks again by itself); the frame's page is told nothing but the words.
    const off = await fetch(viewer(false));
    assert.equal(off.status, 503);
    assert.match(await off.text(), /turned off|starts when it first uses/);

    // On, but the computer's VNC server is not up yet: starting, with the words of it, and it keeps asking.
    computerOn = true;
    await page.goto(viewer(false));
    await page.evaluate(() => { window.marker = 'same page'; });
    await sees('Starting the computer…');
    assert.equal(await page.evaluate(() => document.getElementById('status').dataset.state), 'starting');
    await shot('starting');
    vncUp = true;
    await sees('Watching');
    assert.equal(await page.evaluate(() => window.marker), 'same page', 'it came up without a reload');

    // The picture is the desktop's own shape and all of it is in the window, in a wide, and in a narrow, window.
    const picture = () => page.evaluate(() => { const r = document.querySelector('#screen canvas').getBoundingClientRect(); return { w: r.width, h: r.height, l: r.left, t: r.top, r: r.right, b: r.bottom, winW: innerWidth, winH: innerHeight }; });
    for (const size of [{ width: 1280, height: 800 }, { width: 1100, height: 300 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(size);
      let p;
      await waitFor(async () => { p = await picture(); return p.r <= p.winW + 1 && p.b <= p.winH + 1 && (p.w >= p.winW - 2 || p.h >= p.winH - 2); }, { what: `the picture to fill ${size.width}x${size.height}` });
      assert.ok(Math.abs(p.w / p.h - W / H) < 0.02, `the picture keeps the desktop's shape at ${size.width}x${size.height}: ${JSON.stringify(p)}`);
      assert.ok(p.l >= -1 && p.t >= -1, `inside the window: ${JSON.stringify(p)}`);
      await shot(`watching-${size.width}x${size.height}`);
    }
    await page.setViewportSize({ width: 1280, height: 800 });

    // Watching only: clicks and keys never reach the computer.
    await page.mouse.click(300, 300);
    await page.keyboard.press('a');
    await page.waitForTimeout(300);
    assert.deepEqual([got.keys, got.pointers], [[], []], 'a viewer that only watches sends nothing');

    // The same address with view_only=0: the owner has control, and the mouse and keys arrive.
    await page.goto(viewer(true));
    await sees('You have control');
    await shot('control');
    await page.mouse.click(300, 300);
    await page.keyboard.press('a');
    await waitFor(() => got.keys.length >= 2 && got.pointers.some((p) => p.mask === 1), { what: 'the click and the key to reach the computer' });
    assert.deepEqual(got.keys.map((k) => k.key), [0x61, 0x61]);
    const click = got.pointers.find((p) => p.mask === 1);
    assert.ok(click.x > 0 && click.x < W && click.y > 0 && click.y < H, `the click is in the desktop's own pixels: ${JSON.stringify(click)}`);

    // The computer's VNC server goes away (a restart): Reconnecting…, then the picture again, on the same page.
    await page.goto(viewer(false));
    await sees('Watching');
    await page.evaluate(() => { window.marker = 'same page'; });
    vncUp = false;
    for (const s of live) s.destroy();
    await sees('Reconnecting…');
    await shot('reconnecting');
    vncUp = true;
    await sees('Watching');
    assert.equal(await page.evaluate(() => window.marker), 'same page', 'it came back without a reload');

    // The computer is turned off: Turned off, and the picture again once it is on.
    computerOn = false; vncUp = false;
    for (const s of live) s.destroy();
    await sees('Turned off');
    await shot('off');
    computerOn = true; vncUp = true;
    await sees('Watching');

    // The web page's frame is told the state: it wears it as data-screen, and nothing reloads it.
    await context.close();
    // (Playwright's own waiting evaluates text, which the page's policy refuses, so this page is opened without it.)
    const hostContext = await browser.newContext({ viewport: { width: 1280, height: 800 }, bypassCSP: true });
    const host = await hostContext.newPage();
    host.on('pageerror', (e) => errors.push(e.message));
    await host.goto(srv.base);
    await host.waitForFunction((id) => state.bots?.some((b) => b.id === id), bot.id);
    await host.evaluate((id) => {
      document.body.insertAdjacentHTML('beforeend', `<iframe id="frame" style="position:fixed;right:0;bottom:0;width:320px;height:200px" src="${screenUrl(id)}"></iframe>`);
    }, bot.id);
    await waitFor(() => host.evaluate(() => document.getElementById('frame').dataset.screen === 'watching'), { what: 'the frame to be told: watching' });
    vncUp = false;
    for (const s of live) s.destroy();
    await waitFor(() => host.evaluate(() => ['reconnecting', 'starting'].includes(document.getElementById('frame').dataset.screen)), { what: 'the frame to be told it is reconnecting' });
    vncUp = true;
    await waitFor(() => host.evaluate(() => document.getElementById('frame').dataset.screen === 'watching'), { what: 'the frame to be told: watching again' });
    // A message from any other page is not believed.
    await host.evaluate(() => { window.postMessage({ type: 'botdot-screen', state: 'off' }, location.origin); });
    await host.waitForTimeout(200);
    assert.equal(await host.evaluate(() => document.getElementById('frame').dataset.screen), 'watching', 'only the frame itself speaks for the frame');

    await hostContext.close();
    assert.deepEqual(errors, []);
    console.log('PASS: the viewer says starting, watching, control, reconnecting and turned off; connects and reconnects by itself; fits the desktop\'s own shape; sends nothing until control; tells its frame its state; no browser errors.');
  } finally {
    await browser?.close();
    for (const s of live) s.destroy();
    srv.unhold?.();
    await srv.stop();
    await new Promise((r) => helper.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
