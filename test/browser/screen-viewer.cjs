// Optional browser check of botdot's own screen viewer (ADR 279, #1733):
//   NODE_PATH=<directory containing playwright> node test/browser/screen-viewer.cjs
// The viewer at /computer/<bot>/vnc.html against a stand-in computer: botdot's server is real, the helper behind it
// and the VNC server (RFB 3.8, one raw picture of 800x500) are stand-ins. It checks the states in words (Starting the
// computer…, Viewing, You have control, Reconnecting…, Turned off), that it connects by itself once the computer is
// up and again after it dropped, that the picture is the desktop's own shape and fits the window, that it sends no
// mouse or key until the owner has control, that a computer that stays off stays on "Turned off" across the retries,
// that the words are the account's language (Polish when it chose it) and that the web page's frame is told the state
// (data-screen) and that noVNC's own page is gone. In a phone-sized touch window (#1735): a tap clicks, a hold is a right
// click, a finger drags, two fingers scroll, a pinch zooms and moves the picture (and a tap still lands on the right
// pixel), the phone's keyboard types on the desktop, and the keys menu sends each key, on the phone and with a mouse,
// and is not there while the viewer only watches. Scratch data only.
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
    await sees('Viewing');
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

    // By touch, in a phone-sized window (#1735): tap, hold, drag, two fingers, pinch, the phone's keyboard, the keys menu.
    const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });
    const phone = await phoneContext.newPage();
    phone.on('pageerror', (e) => errors.push(e.message));
    const cdp = await phoneContext.newCDPSession(phone);
    const touch = (type, ...points) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: points.map(([x, y], id) => ({ x, y, id })) });
    const clear = () => { got.keys.length = 0; got.pointers.length = 0; };
    const canvasBox = () => phone.evaluate(() => { const r = document.querySelector('#screen canvas').getBoundingClientRect(); return { l: r.left, t: r.top, w: r.width, h: r.height }; });
    // Where a point of the window is on the desktop, from the picture as it is now.
    const desktop = async (x, y) => { const c = await canvasBox(); return { x: (x - c.l) * W / c.w, y: (y - c.t) * H / c.h }; };
    const near = (got_, want, what) => assert.ok(Math.abs(got_.x - want.x) <= 3 && Math.abs(got_.y - want.y) <= 3, `${what}: ${JSON.stringify(got_)} is not ${JSON.stringify(want)}`);
    const phoneSees = (text) => waitFor(async () => (await phone.locator('#status').innerText()) === text, { what: `the phone's viewer to say "${text}"`, timeout: 15_000 });

    // Watching only: the keys are not on screen, and a tap sends nothing.
    await phone.goto(viewer(false));
    await phoneSees('Viewing');
    await phone.waitForSelector('#screen canvas');
    assert.equal(await phone.locator('#tools').isVisible(), false, 'no keys while only watching');
    clear();
    await touch('touchStart', [195, 300]); await touch('touchEnd');
    await phone.waitForTimeout(300);
    assert.deepEqual([got.keys, got.pointers], [[], []], 'a tap on a viewer that only watches sends nothing');

    await phone.goto(viewer(true));
    await phoneSees('You have control');
    await phone.waitForSelector('#screen canvas');
    assert.equal(await phone.locator('#tools').isVisible(), true);
    await waitFor(async () => (await canvasBox()).w > 300, { what: 'the picture on the phone' });

    // A tap is a click at that point of the desktop.
    clear();
    await touch('touchStart', [100, 420]); await touch('touchEnd');
    await waitFor(() => got.pointers.some((p) => p.mask === 1) && got.pointers.at(-1).mask === 0, { what: 'a tap to click' });
    near(got.pointers.find((p) => p.mask === 1), await desktop(100, 420), 'the click');
    assert.equal(got.pointers.filter((p) => p.mask === 1).length, 1, `one click, not two (no emulated mouse after the touch): ${JSON.stringify(got.pointers)}`);

    // Holding is a right click.
    clear();
    await touch('touchStart', [150, 350]);
    await waitFor(() => got.pointers.some((p) => p.mask === 4), { what: 'a hold to right click', timeout: 3000 });
    await touch('touchEnd');
    await phone.waitForTimeout(200);
    assert.ok(!got.pointers.some((p) => p.mask === 1), 'a hold is not also a left click');
    near(got.pointers.find((p) => p.mask === 4), await desktop(150, 350), 'the right click');

    // One finger moving drags: the button goes down where it started and up where it ended.
    clear();
    await touch('touchStart', [100, 420]);
    for (const [x, y] of [[120, 320], [160, 360], [200, 400]]) await touch('touchMove', [x, y]);
    await touch('touchEnd');
    await waitFor(() => got.pointers.at(-1)?.mask === 0 && got.pointers.some((p) => p.mask === 1), { what: 'a drag' });
    near(got.pointers.find((p) => p.mask === 1), await desktop(100, 420), 'the drag starts');
    near(got.pointers.at(-1), await desktop(200, 400), 'the drag ends');

    // Two fingers moving up scroll down (the wheel's button 5), and move the pointer nowhere near a click.
    clear();
    await touch('touchStart', [150, 500], [250, 500]);
    for (const y of [480, 440, 400, 360]) await touch('touchMove', [150, y], [250, y]);
    await touch('touchEnd');
    await waitFor(() => got.pointers.some((p) => p.mask === 16), { what: 'two fingers to scroll' });
    assert.ok(!got.pointers.some((p) => p.mask === 1), 'scrolling is not a click');
    assert.ok(!got.pointers.some((p) => p.mask === 8), 'moving up scrolls down only');

    // A pinch zooms the picture, and one finger then moves it (and clicks nothing).
    const before = await canvasBox();
    clear();
    await touch('touchStart', [175, 420], [215, 420]);
    for (let g = 50; g <= 150; g += 25) await touch('touchMove', [195 - g / 2, 420], [195 + g / 2, 420]);
    await touch('touchEnd');
    await waitFor(async () => (await canvasBox()).w > before.w * 1.8, { what: 'the pinch to zoom the picture' });
    const zoomed = await canvasBox();
    assert.ok(zoomed.w <= before.w * 5.1, `zoom has a limit: ${zoomed.w}`);
    assert.ok(zoomed.l <= 1 && zoomed.l + zoomed.w >= 389, 'a zoomed picture still covers the window');
    assert.deepEqual(got.pointers.filter((p) => p.mask), [], 'a pinch sends no buttons');
    await touch('touchStart', [100, 400]);
    for (const x of [120, 160, 200]) await touch('touchMove', [x, 400]);
    await touch('touchEnd');
    await waitFor(async () => (await canvasBox()).l > zoomed.l + 50 || zoomed.l >= -1, { what: 'one finger to move the zoomed picture' });
    assert.equal(got.pointers.filter((p) => p.mask).length, 0, 'moving a zoomed picture drags nothing');
    // A tap still lands on the right pixel of the zoomed picture.
    clear();
    await touch('touchStart', [195, 422]); await touch('touchEnd');
    await waitFor(() => got.pointers.some((p) => p.mask === 1), { what: 'a tap on the zoomed picture' });
    near(got.pointers.find((p) => p.mask === 1), await desktop(195, 422), 'the click on the zoomed picture');
    // Pinching back in to the whole picture puts it back.
    await touch('touchStart', [100, 420], [290, 420]);
    for (let g = 190; g >= 20; g -= 30) await touch('touchMove', [195 - g / 2, 420], [195 + g / 2, 420]);
    await touch('touchEnd');
    await waitFor(async () => Math.abs((await canvasBox()).w - before.w) < 2, { what: 'the picture back to the whole desktop' });

    // The phone's keyboard: the button gives the typing field the focus, and what is typed reaches the desktop.
    clear();
    await phone.tap('#keyboard-button');
    assert.equal(await phone.evaluate(() => document.activeElement.id), 'typing');
    assert.equal(await phone.getAttribute('#keyboard-button', 'aria-pressed'), 'true');
    await phone.keyboard.type('hi');
    await phone.keyboard.press('Backspace');
    await phone.keyboard.press('Enter');
    await phone.keyboard.insertText('ż');
    await waitFor(() => got.keys.length >= 10, { what: 'the typing to reach the desktop' });
    assert.deepEqual(got.keys.map((k) => [k.down, k.key]), [
      [1, 0x68], [0, 0x68], [1, 0x69], [0, 0x69], [1, 0xff08], [0, 0xff08], [1, 0xff0d], [0, 0xff0d], [1, 0x01000000 + 0x17c], [0, 0x01000000 + 0x17c],
    ], 'the keys typed on the phone');
    await phone.tap('#keyboard-button');
    assert.notEqual(await phone.evaluate(() => document.activeElement.id), 'typing', 'the second press puts the keyboard away');

    // The keys menu: each of its keys is sent as a chord, and the menu closes.
    const chords = { 'Ctrl+Alt+Del': [0xffe3, 0xffe9, 0xffff], 'Esc': [0xff1b], 'Alt+Tab': [0xffe9, 0xff09], 'Super': [0xffeb], 'Ctrl+L': [0xffe3, 0x6c] };
    await phone.tap('#keys-button');
    assert.deepEqual(await phone.locator('#keys-menu button').allInnerTexts(), Object.keys(chords));
    if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await phone.screenshot({ path: path.join(SHOTS, 'phone-keys.png') }); }
    await phone.tap('#keys-button');
    assert.equal(await phone.locator('#keys-menu').isVisible(), false, 'the button closes the menu');
    for (const [label, keys] of Object.entries(chords)) {
      clear();
      await phone.tap('#keys-button');
      await phone.tap(`#keys-menu button[data-key="${label}"]`);
      await waitFor(() => got.keys.length >= keys.length * 2, { what: `${label} to reach the desktop` });
      await phone.waitForTimeout(100);
      assert.deepEqual(got.keys.map((k) => [k.down, k.key]), [...keys.map((k) => [1, k]), ...[...keys].reverse().map((k) => [0, k])], label);
      assert.equal(await phone.locator('#keys-menu').isVisible(), false, `${label} closes the menu`);
    }
    // On a desktop too: the same menu, by mouse.
    await phoneContext.close();
    await page.goto(viewer(true));
    await sees('You have control');
    clear();
    await page.click('#keys-button');
    await page.click('#keys-menu button[data-key="Ctrl+Alt+Del"]');
    await waitFor(() => got.keys.length >= 6, { what: 'Ctrl+Alt+Del from a desktop' });
    assert.deepEqual(got.keys.map((k) => k.key), [0xffe3, 0xffe9, 0xffff, 0xffff, 0xffe9, 0xffe3]);

    // The computer's VNC server goes away (a restart): Reconnecting…, then the picture again, on the same page.
    await page.goto(viewer(false));
    await sees('Viewing');
    await page.evaluate(() => { window.marker = 'same page'; });
    vncUp = false;
    for (const s of live) s.destroy();
    await sees('Reconnecting…');
    await shot('reconnecting');
    vncUp = true;
    await sees('Viewing');
    assert.equal(await page.evaluate(() => window.marker), 'same page', 'it came back without a reload');

    // The computer is turned off: Turned off, and the picture again once it is on.
    computerOn = false; vncUp = false;
    for (const s of live) s.destroy();
    await sees('Turned off');
    await shot('off');
    // It stays turned off across several retries (every 2 seconds): the state is set once and never flickers to
    // "Reconnecting…" while the HEAD is out.
    const heads = [];
    page.on('request', (r) => { if (r.method() === 'HEAD') heads.push(r.url()); });
    await page.evaluate(() => {
      window.seen = [];
      new MutationObserver(() => window.seen.push(document.getElementById('status').dataset.state + ':' + document.getElementById('status').textContent))
        .observe(document.getElementById('status'), { childList: true, characterData: true, subtree: true, attributes: true });
    });
    await waitFor(() => heads.length >= 3, { what: 'three more retries of the turned-off viewer', timeout: 15_000 });
    assert.deepEqual(await page.evaluate(() => window.seen), [], 'it never left "Turned off" while the retries went on');
    assert.equal(await said(), 'Turned off');
    computerOn = true; vncUp = true;
    await sees('Viewing');

    // The account's language: Polish, once it chose it in Settings. Every state, on a fresh page.
    await srv.api('/settings', { method: 'PUT', body: { language: 'pl' } });
    computerOn = true; vncUp = false;
    await page.goto(viewer(false));
    assert.equal(await page.evaluate(() => document.documentElement.lang), 'pl');
    await sees('Uruchamianie komputera…');
    assert.equal(await page.evaluate(() => document.getElementById('status').dataset.state), 'starting', 'the state the frame is told keeps its name');
    assert.equal(await page.title(), 'Uruchamianie komputera…');
    vncUp = true;
    await sees('Podgląd');
    vncUp = false;
    for (const s of live) s.destroy();
    await sees('Łączenie ponownie…');
    computerOn = false;
    await sees('Wyłączony');
    computerOn = true; vncUp = true;
    await sees('Podgląd');
    await page.goto(viewer(true));
    await sees('Masz kontrolę');
    await shot('control-pl');
    // The note the server shows in the frame while the computer is off.
    computerOn = false;
    assert.match(await (await fetch(viewer(false))).text(), /Ekran tego bota włącza się, gdy po raz pierwszy użyje komputera/);
    computerOn = true;
    await srv.api('/settings', { method: 'PUT', body: { language: 'en' } });
    await page.goto(viewer(false));
    await sees('Viewing');

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
    console.log('PASS: the viewer says starting, viewing, control, reconnecting and turned off, in English and in Polish; stays turned off across retries; connects and reconnects by itself; fits the desktop\'s own shape; sends nothing until control; works by touch (tap, hold, drag, scroll, pinch, keyboard, keys menu); tells its frame its state; no browser errors.');
  } finally {
    await browser?.close();
    for (const s of live) s.destroy();
    srv.unhold?.();
    await srv.stop();
    await new Promise((r) => helper.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
