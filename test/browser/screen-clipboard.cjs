// Optional browser check of copy and paste in botdot's own screen viewer (ADR 279, #1734):
//   NODE_PATH=<directory containing playwright> node test/browser/screen-clipboard.cjs
//   CLIPBOARD_SHOTS=<folder>  save screenshots of the chip and of Type it, wide and narrow
// The viewer at /computer/<bot>/vnc.html against a stand-in computer (botdot's server is real; the helper and the VNC
// server, RFB 3.8 with its clipboard, are stand-ins). It checks both clipboards, with the extended one (UTF-8, as
// TigerVNC speaks it) and with Latin-1 cut text: text copied on the bot's screen lands in the owner's clipboard, or
// behind a "Copied on the bot's screen, tap to copy" chip where the browser refuses it without a tap; Ctrl/⌘+V sends
// the owner's text and then Ctrl+V, once; "Type it" types Polish letters key by key; and while the owner only watches
// nothing crosses and there is nothing to tap. Scratch data only.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const zlib = require('node:zlib');
const { chromium } = require('playwright');
const { startServer, makeBot, heldRun, waitFor } = require('../helpers');
const { validate } = require('../../lib/docker-helper');

const W = 800, H = 500;
const SHOTS = process.env.CLIPBOARD_SHOTS;

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
function vncServer(sock, got, ext) {
  const ws = { buf: Buffer.alloc(0) };
  let rfb = Buffer.alloc(0), stage = 'version';
  const send = (b) => sock.write(frame(b));
  send(Buffer.from('RFB 003.008\n'));
  // The clipboard, as TigerVNC speaks it: with the extended clipboard (UTF-8, zlib) when \`ext\`, else Latin-1 cut text.
  const cutHead = (len) => { const h = Buffer.alloc(8); h[0] = 3; h.writeInt32BE(len, 4); return h; };
  const ACTION = { caps: 1 << 24, request: 1 << 25, notify: 1 << 27, provide: 1 << 28 };
  const extended = (flags, body = Buffer.alloc(0)) => { const f = Buffer.alloc(4); f.writeUInt32BE(flags >>> 0); return Buffer.concat([cutHead(-(4 + body.length)), f, body]); };
  let offered = null; // text the computer has copied, waiting to be asked for
  got.cut = (text) => {
    if (!ext) return send(Buffer.concat([cutHead(text.length), Buffer.from(text, 'latin1')]));
    offered = text;
    send(extended(ACTION.notify | 1));
  };
  function clipboardFromClient(msg) {
    const len = msg.readInt32BE(4);
    if (len >= 0) { got.clipboard = msg.subarray(8, 8 + len).toString('latin1'); return got.log.push('clipboard'); }
    const flags = msg.readUInt32BE(8);
    if (flags & ACTION.caps) return; // what the viewer can do, not a clipboard
    if (flags & ACTION.notify) send(extended(ACTION.request | 1));
    if (flags & ACTION.request && offered !== null) {
      const text = Buffer.from(offered, 'utf8'), size = Buffer.alloc(4);
      size.writeUInt32BE(text.length);
      send(extended(ACTION.provide | 1, zlib.deflateSync(Buffer.concat([size, text]))));
    }
    if (flags & ACTION.provide) {
      const data = zlib.inflateSync(msg.subarray(12), { finishFlush: zlib.constants.Z_SYNC_FLUSH });
      got.clipboard = data.subarray(4, 4 + data.readUInt32BE(0)).toString('utf8').replace(/\0$/, ''); // the protocol ends the text with a NUL
      got.log.push('clipboard');
    }
  }
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
          // The computer says what clipboard it can take: the extended one, or nothing (Latin-1 cut text).
          if (ext) send(extended(ACTION.caps | ACTION.request | ACTION.notify | ACTION.provide | 1, Buffer.from([0, 0, 0xff, 0xff])));
        }
        stage = { version: 'security', security: 'init', init: 'run' }[stage];
        continue;
      }
      const type = rfb[0];
      const size = { 0: 20, 3: 10, 4: 8, 5: 6 }[type] ?? (type === 2 && rfb.length >= 4 ? 4 + 4 * rfb.readUInt16BE(2) : type === 6 && rfb.length >= 8 ? 8 + Math.abs(rfb.readInt32BE(4)) : 0);
      if (!rfb.length || !size || rfb.length < size) return;
      const msg = rfb.subarray(0, size);
      rfb = rfb.subarray(size);
      if (type === 4) { got.keys.push({ down: msg[1], key: msg.readUInt32BE(4) }); got.log.push(`key ${msg[1] ? 'down' : 'up'} ${msg.readUInt32BE(4).toString(16)}`); }
      if (type === 6) clipboardFromClient(msg);
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-clipboard-'));
  const socket = path.join(dir, 'helper.sock');
  const got = { keys: [], pointers: [], log: [], clipboard: null, cut: null };
  const live = new Set();
  let ext = true; // the stand-in speaks the extended clipboard
  const helper = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { operation, args } = JSON.parse(body);
    if (!validate(operation, args)) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Invalid helper operation' })); }
    let value = null;
    if (operation === 'request') value = { ok: true, text: 'data: {"success": true}' };
    if (operation === 'inspect' || operation === 'details') value = { state: 'running' };
    if (operation === 'screenState') value = { state: 'running' };
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
      if (!key) return sock.destroy();
      const accept = crypto.createHash('sha1').update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`).digest('base64');
      sock.write(`HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
      live.add(sock);
      sock.on('close', () => live.delete(sock));
      vncServer(sock, got, ext);
    };
    sock.on('data', first);
  });
  await new Promise((r) => helper.listen(socket, r));
  const srv = await startServer({ env: { BOT_DOT_HELPER_SOCKET: socket } });
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const bot = await makeBot(srv, { name: 'Clipboard Bot', computer: 'linux' });
    const held = await heldRun(srv, bot);
    await srv.api('/vault/session/computer/cmd', { method: 'POST', headers: { 'X-Vault-Token': held.token }, body: { command: 'screenshot', params: {} } });
    const viewer = (control) => `${srv.base}/computer/${bot.id}/vnc.html?view_only=${control ? 0 : 1}`;
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const errors = [];
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, permissions: ['clipboard-read', 'clipboard-write'] });
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    // Safari refuses a clipboard write that is not the answer to a tap: the page can be told to be that browser.
    await page.addInitScript(() => {
      const write = navigator.clipboard.writeText.bind(navigator.clipboard);
      window.refuseUntilTap = false;
      // A Mac, for noVNC: it reads navigator.platform each time it turns a key (core/util/browser.js isMac).
      const platform = Object.getOwnPropertyDescriptor(Navigator.prototype, 'platform').get;
      window.fakeMac = false;
      Object.defineProperty(navigator, 'platform', { get() { return window.fakeMac ? 'MacIntel' : platform.call(this); } });
      // The pastes the page saw, to tell a real one from the one a test has to make where the host has no ⌘+V paste.
      window.pastes = 0;
      addEventListener('paste', () => { window.pastes++; }, true);
      // A tap is the owner's own click, while its handler runs (Playwright's evaluate counts as a gesture, so the
      // browser's own flag cannot tell).
      let tapping = false;
      addEventListener('click', (e) => { if (e.isTrusted) { tapping = true; setTimeout(() => { tapping = false; }); } }, true);
      navigator.clipboard.writeText = (text) => {
        if (window.refuseUntilTap && !tapping) return Promise.reject(new DOMException('needs a tap', 'NotAllowedError'));
        return write(text);
      };
    });
    const clip = () => page.evaluate(() => navigator.clipboard.readText());
    const setClip = (text) => page.evaluate((t) => navigator.clipboard.writeText(t), text);
    const reset = () => { got.keys.length = got.pointers.length = got.log.length = 0; got.clipboard = null; };
    const open = async (control) => {
      for (const s of live) s.destroy();
      reset();
      await page.goto(viewer(control));
      await waitFor(() => page.locator('#status').getAttribute('data-state').then((t) => t === (control ? 'control' : 'watching')), { what: 'the picture', timeout: 15_000 });
      // The extended clipboard is agreed in the first moments: nothing is copied before the computer has said it can.
      await page.waitForTimeout(300);
    };
    const mod = process.platform === 'darwin' ? 'Meta' : 'Control';
    const hex = (cp) => cp.toString(16);
    // A host that is not a Mac has no ⌘+V paste, and Chromium has no Ctrl+V paste on a Mac: the browser's paste event is then
    // made as the owner's browser makes it.
    const pasteEventIfNone = async (owner) => {
      await page.waitForTimeout(100);
      if (await page.evaluate(() => window.pastes)) return;
      await page.evaluate((t) => {
        const data = new DataTransfer();
        data.setData('text/plain', t);
        document.activeElement.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
      }, owner);
    };
    // The keys the computer has down after the log so far (what was pressed and not let go of).
    const downAfter = (log, until = log.length) => {
      const down = new Set();
      for (const e of log.slice(0, until)) {
        const m = /^key (down|up) ([0-9a-f]+)$/.exec(e);
        if (m) { if (m[1] === 'down') down.add(m[2]); else down.delete(m[2]); }
      }
      return [...down].sort();
    };

    for (const mode of ['extended', 'latin1']) {
      ext = mode === 'extended';
      const hello = ext ? 'Cześć, zażółć gęślą jaźń' : 'Hello from the bot';

      // Copied on the bot's screen: it lands in the owner's clipboard.
      await open(true);
      await setClip('before');
      got.cut(hello);
      await waitFor(async () => (await clip()) === hello, { what: `[${mode}] the text copied on the bot's screen to be in the owner's clipboard` });
      assert.equal(await page.locator('#clip-chip').isVisible(), false, 'no chip when the browser let it through');

      // Where the browser refuses without a tap: the chip, and the tap does it.
      await setClip('before');
      await page.evaluate(() => { window.refuseUntilTap = true; });
      await page.evaluate(() => { document.activeElement?.blur?.(); });
      got.cut(`${hello} again`);
      await waitFor(() => page.locator('#clip-chip').isVisible(), { what: `[${mode}] the chip` });
      assert.equal(await page.locator('#clip-chip').innerText(), "Copied on the bot's screen, tap to copy");
      if (SHOTS && ext) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, 'chip-1280.png') }); }
      assert.equal(await clip(), 'before', 'nothing is copied until the tap');
      await page.locator('#clip-chip').click();
      assert.equal(await clip(), `${hello} again`);
      assert.equal(await page.locator('#clip-chip').isVisible(), false, 'the chip is gone after the tap');
      await page.evaluate(() => { window.refuseUntilTap = false; });

      // Ctrl/⌘+V: the owner's text goes over, then Ctrl+V once, and no other V.
      const pasted = ext ? 'Zażółć gęślą jaźń' : 'Pasted text';
      await setClip(pasted);
      reset();
      await page.locator('#screen canvas').click({ position: { x: 100, y: 100 } });
      reset();
      await page.keyboard.press(`${mod}+KeyV`);
      await waitFor(() => got.log.filter((e) => e.startsWith('key up 76')).length >= 1, { what: `[${mode}] the paste to reach the computer` });
      assert.equal(got.clipboard, pasted, `[${mode}] the owner's text arrived`);
      assert.equal(got.log.filter((e) => e === 'key down 76').length, 1, 'one V press, not the owner\'s own and ours');
      assert.ok(got.log.indexOf('clipboard') >= 0 && got.log.indexOf('clipboard') < got.log.indexOf('key down 76'), 'the text came before the V');
      const seq = got.log.filter((e) => /key (down|up) (76|ffe3)/.test(e));
      const ctrlDown = seq.lastIndexOf('key down ffe3'), vDown = seq.indexOf('key down 76'), vUp = seq.indexOf('key up 76');
      assert.ok(ctrlDown >= 0 && ctrlDown < vDown && vDown < vUp, `Ctrl is held for the V: ${seq.join(', ')}`);
      assert.equal(got.log.some((e) => /^key down ffe[bc]$/.test(e)), false, 'no Super key reaches the computer');

      // The owner holds Ctrl through the paste and presses S: the computer still has Ctrl down when S arrives (the paste
      // does not let go of what the owner holds, because noVNC would not press it again), and nothing is left held after.
      reset();
      await page.evaluate(() => { window.pastes = 0; });
      await page.keyboard.down('ControlLeft');
      await waitFor(() => got.log.includes('key down ffe3'), { what: `[${mode}] the held Ctrl to reach the computer` });
      await page.keyboard.press('KeyV');
      await pasteEventIfNone(pasted);
      await waitFor(() => got.log.includes('key up 76'), { what: `[${mode}] the paste with Ctrl held` });
      await page.keyboard.press('KeyS');
      await waitFor(() => got.log.includes('key down 73'), { what: `[${mode}] the S after the paste` });
      assert.deepEqual(downAfter(got.log, got.log.indexOf('key down 73') + 1), ['73', 'ffe3'], `[${mode}] Ctrl is down on the computer when S arrives: ${got.log.join(', ')}`);
      await page.keyboard.up('ControlLeft');
      await waitFor(() => downAfter(got.log).length === 0, { what: `[${mode}] Ctrl to be let go of on the computer: ${got.log.join(', ')}` });
      await page.waitForTimeout(100);
      assert.deepEqual(downAfter(got.log), [], `[${mode}] nothing is left held: ${got.log.join(', ')}`);

      // Type it: Polish letters, capitals and a new line, key by key.
      reset();
      await page.locator('#type-open').click();
      const text = 'Zażółć\nOk 1';
      await page.locator('#type-field').fill(text);
      if (SHOTS && ext) {
        fs.mkdirSync(SHOTS, { recursive: true });
        for (const size of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
          await page.setViewportSize(size);
          await page.screenshot({ path: path.join(SHOTS, `type-it-${size.width}.png`) });
        }
        await page.setViewportSize({ width: 1280, height: 800 });
      }
      await page.locator('#type-go').click();
      const expected = [];
      for (const ch of text) {
        const cp = ch.codePointAt(0);
        const sym = cp === 10 ? 0xff0d : cp < 0x100 ? cp : 0x01000000 + cp;
        expected.push(`key down ${hex(sym)}`, `key up ${hex(sym)}`);
      }
      await waitFor(() => got.log.length >= expected.length, { what: `[${mode}] every key of the typed text` });
      assert.deepEqual(got.log.filter((e) => e.startsWith('key')), expected, 'the keys of the text, in order, with the Polish letters as Unicode keys');
      assert.equal(await page.locator('#type-form').isVisible(), false, 'the form closes once it typed');
    }

    // On a Mac: noVNC sends the held ⌘ as Alt_L (the left one) or Super_L (the right one), so what the paste releases is
    // those, and the computer sees Ctrl+V with nothing else held, whichever ⌘ the owner holds.
    ext = true;
    await open(true);
    await page.evaluate(() => { window.fakeMac = true; });
    for (const [cmd, held] of [['MetaLeft', 'ffe9'], ['MetaRight', 'ffeb']]) {
      const owner = `From a Mac, ${cmd}`;
      await setClip(owner);
      await page.locator('#screen canvas').click({ position: { x: 100, y: 100 } });
      reset();
      await page.evaluate(() => { window.pastes = 0; });
      await page.keyboard.down(cmd);
      await waitFor(() => got.log.includes(`key down ${held}`), { what: `[${cmd}] the held ⌘ to reach the computer as ${held}` });
      await page.keyboard.press('KeyV');
      await pasteEventIfNone(owner);
      await waitFor(() => got.log.includes('key up 76'), { what: `[${cmd}] the paste to reach the computer` });
      assert.equal(got.clipboard, owner, `[${cmd}] the owner's text arrived`);
      // Replay the keys the computer got: what is held when V goes down, and what the paste itself sent.
      const down = new Set();
      let atV = null;
      for (const e of got.log) {
        const m = /^key (down|up) ([0-9a-f]+)$/.exec(e);
        if (!m) continue;
        if (m[1] === 'down') down.add(m[2]); else down.delete(m[2]);
        if (e === 'key down 76') atV = [...down].sort();
      }
      assert.deepEqual(atV, ['76', 'ffe3'], `[${cmd}] only Ctrl is held for the V, no Alt and no Super: ${got.log.join(', ')}`);
      assert.deepEqual(got.log.filter((e) => e.startsWith('key')).slice(-5), ['key down ffe3', 'key down 76', 'key up 76', 'key up ffe3', `key down ${held}`], `[${cmd}] the paste is Ctrl down, V, V up, Ctrl up, and the ⌘ the owner holds is pressed again`);
      // The owner still holds ⌘ and presses S: the computer has the ⌘ keys down when S arrives, with no Ctrl.
      await page.keyboard.press('KeyS');
      await waitFor(() => got.log.includes('key down 73'), { what: `[${cmd}] the S after the paste` });
      assert.deepEqual(downAfter(got.log, got.log.indexOf('key down 73') + 1), ['73', held].sort(), `[${cmd}] ⌘ is down on the computer when S arrives: ${got.log.join(', ')}`);
      await page.keyboard.up(cmd);
      await waitFor(() => downAfter(got.log).length === 0, { what: `[${cmd}] ⌘ to be let go of on the computer: ${got.log.join(', ')}` });
      await page.waitForTimeout(100);
      assert.deepEqual(downAfter(got.log), [], `[${cmd}] nothing is left held: ${got.log.join(', ')}`);
      assert.equal(got.log.filter((e) => e === 'key down 76').length, 1, `[${cmd}] one V press`);
    }
    await page.evaluate(() => { window.fakeMac = false; });

    // Between connections nothing throws: a paste and Type it, with the computer gone.
    for (const s of live) s.destroy();
    await waitFor(() => page.locator('#status').getAttribute('data-state').then((t) => t === 'reconnecting'), { what: 'the viewer to see the connection end' });
    await page.evaluate(() => {
      const data = new DataTransfer();
      data.setData('text/plain', 'nobody there');
      document.body.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
    });
    await page.keyboard.press(`${mod}+KeyV`);
    await page.waitForTimeout(400);

    // Nothing crosses while the owner only watches: no copy, no paste, no Type it.
    ext = true;
    await open(false);
    await setClip('mine');
    await page.evaluate(() => { window.refuseUntilTap = true; });
    got.cut('from the bot');
    await page.waitForTimeout(500);
    assert.equal(await clip(), 'mine', 'a watcher gets nothing in the clipboard');
    assert.equal(await page.locator('#clip-chip').isVisible(), false, 'and no chip');
    assert.equal(await page.locator('#type-open').isVisible(), false, 'and no way to type');
    await page.evaluate(() => { window.refuseUntilTap = false; });
    await page.locator('#screen canvas').click({ position: { x: 100, y: 100 } });
    await page.keyboard.press(`${mod}+KeyV`);
    await page.waitForTimeout(600);
    assert.deepEqual([got.keys, got.pointers, got.clipboard], [[], [], null], 'a viewer that only watches sends nothing');

    // The words are the account's language.
    await srv.api('/settings', { method: 'PUT', body: { language: 'pl' } });
    await open(true);
    assert.equal(await page.locator('#type-open').innerText(), 'Wpisz to');
    await page.locator('#type-open').click();
    assert.equal(await page.locator('#type-go').innerText(), 'Wpisz to');
    assert.equal(await page.locator('#type-field').getAttribute('placeholder'), 'Tekst do wpisania na ekranie bota');
    await page.evaluate(() => { window.refuseUntilTap = true; });
    got.cut('x');
    await waitFor(() => page.locator('#clip-chip').isVisible(), { what: 'the chip, in Polish' });
    assert.equal(await page.locator('#clip-chip').innerText(), 'Skopiowano na ekranie bota, dotknij, aby skopiować');
    await srv.api('/settings', { method: 'PUT', body: { language: 'en' } });

    assert.deepEqual(errors, []);
    console.log('PASS: text copied on the bot\'s screen reaches the owner\'s clipboard or the chip, a paste sends the owner\'s text and one Ctrl+V, Type it types Polish letters, and a watcher crosses nothing, with the extended clipboard and with Latin-1 cut text.');
  } finally {
    await browser?.close();
    for (const s of live) s.destroy();
    srv.unhold?.();
    await srv.stop();
    await new Promise((r) => helper.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
