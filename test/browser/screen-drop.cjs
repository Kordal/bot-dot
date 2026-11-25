// Optional browser check of a file dropped onto botdot's screen viewer (ADR 279, #1736):
//   NODE_PATH=<directory containing playwright> node test/browser/screen-drop.cjs
// The viewer at /computer/<bot>/vnc.html against botdot's real server and a stand-in for the helper that holds the
// computer (it answers the screen is on and takes the files put in the bot's folder). It checks that dragging files
// over the screen says where they go, that a dropped file reaches the bot's folder through the upload route with its
// bytes and a note names it, that a file over the size limit, a drop while only watching, a folder-less refusal of
// the computer and more files than one drop takes each say so in plain words and send nothing, that a drag that is
// not files is left alone, and that the words are the account's language. Scratch data only.
//   DROP_SHOTS=<folder>  save a screenshot of the drag and of the note
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, heldRun, waitFor } = require('../helpers');
const { validate } = require('../../lib/docker-helper');

const SHOTS = process.env.DROP_SHOTS;
const MAX = 25 * 1024 * 1024;

(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-drop-'));
  const socket = path.join(dir, 'helper.sock');
  const put = []; // what the computer was given: { name, data }
  let refuse = false; // the computer fails the next files
  const helper = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { operation, args } = JSON.parse(body);
    if (!validate(operation, args)) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Invalid helper operation' })); }
    let value = null;
    if (operation === 'request') value = { ok: true, text: 'data: {"success": true}' };
    if (operation === 'inspect' || operation === 'details' || operation === 'screenState') value = { state: 'running' };
    if (operation === 'listAll') value = {};
    if (operation === 'update.status') value = { supported: false };
    if (operation === 'putFile') {
      if (refuse) value = { code: 1, stdout: '', stderr: 'no' };
      else {
        const name = /^n='([^']*)'$/m.exec(args[1].script)?.[1];
        put.push({ name, data: Buffer.from(args[1].data, 'base64') });
        value = { code: 0, stdout: `ok ${name}\n`, stderr: '' };
      }
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ value }));
  });
  // The screen's own connection is not what this checks: the viewer keeps asking for it, and is turned away.
  helper.on('upgrade', (_req, sock) => { sock.on('error', () => {}); sock.destroy(); });
  await new Promise((r) => helper.listen(socket, r));
  const srv = await startServer({ env: { BOT_DOT_HELPER_SOCKET: socket } });
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const bot = await makeBot(srv, { name: 'Drop Bot', computer: 'linux' });
    // The bot's first computer tool gives it a screen of its own (#105).
    const held = await heldRun(srv, bot);
    await srv.api('/vault/session/computer/cmd', { method: 'POST', headers: { 'X-Vault-Token': held.token }, body: { command: 'screenshot', params: {} } });
    const viewer = (control) => `${srv.base}/computer/${bot.id}/vnc.html?view_only=${control ? 0 : 1}`;
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const errors = [];
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 } })).newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    const shot = async (name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${name}.png`) }); } };
    const noteOf = () => page.evaluate(() => { const n = document.getElementById('drop-note'); return n.hidden ? '' : n.textContent; });
    const hintOf = () => page.evaluate(() => { const o = document.getElementById('drop'); return o.hidden ? '' : document.getElementById('drop-hint').textContent; });
    const notes = (text) => waitFor(async () => (await noteOf()) === text, { what: `the note "${text}"`, timeout: 10_000 });

    // A drag or a drop of `files` ([{ name, size, text? }]) onto the screen, as the browser sends them.
    const drag = (type, files = [], kind = 'Files') => page.evaluate(({ type, files, kind }) => {
      const dt = new DataTransfer();
      if (kind === 'Files') for (const f of files) dt.items.add(new File([f.text ?? new Uint8Array(f.size)], f.name));
      else dt.setData('text/plain', 'just text');
      const e = new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true });
      document.body.dispatchEvent(e);
      return e.defaultPrevented;
    }, { type, files, kind });
    const dropped = (files) => drag('drop', files);
    const small = { name: 'Q3 report.txt', text: 'hello' };

    // With control: dragging a file over the screen says where it goes; dropping it puts it in the bot's folder.
    await page.goto(viewer(true));
    await page.evaluate(() => { window.marker = 'same page'; });
    assert.equal(await hintOf(), '', 'nothing is shown before a drag');
    assert.equal(await drag('dragenter', [small]), true);
    assert.equal(await hintOf(), "Drop the file to put it in the bot's folder");
    await shot('drag');
    await drag('dragleave', [small]);
    assert.equal(await hintOf(), '', 'the drag left: it is gone');
    await drag('dragenter', [small]);
    assert.equal(await dropped([small]), true, 'the browser is not left to open the file');
    assert.equal(await hintOf(), '', 'the drop ends the hint');
    await notes("Q3 report.txt is in the bot's folder.");
    await shot('done');
    assert.equal(put.length, 1);
    assert.deepEqual([put[0].name, put[0].data.toString()], ['Q3 report.txt', 'hello'], 'its bytes arrived under its name');
    assert.equal(await page.evaluate(() => window.marker), 'same page', 'the page stayed');

    // A drag of text is none of its business.
    assert.equal(await drag('dragenter', [], 'text'), false);
    assert.equal(await hintOf(), '');

    // Two files: both arrive and one note says so.
    put.length = 0;
    await dropped([{ name: 'a.txt', text: 'a' }, { name: 'b.txt', text: 'b' }]);
    await notes("2 files are in the bot's folder.");
    assert.deepEqual(put.map((p) => p.name).sort(), ['a.txt', 'b.txt']);

    // Over the size limit: a plain message and nothing is sent. One over the limit among others: the others go.
    put.length = 0;
    await dropped([{ name: 'big.bin', size: MAX + 1 }]);
    await notes("big.bin is over 25 MB: it wasn't sent.");
    assert.equal(put.length, 0, 'nothing was uploaded');
    await dropped([{ name: 'big.bin', size: MAX + 1 }, { name: 'ok.txt', text: 'ok' }]);
    await notes("ok.txt is in the bot's folder.\nbig.bin is over 25 MB: it wasn't sent.");
    assert.deepEqual(put.map((p) => p.name), ['ok.txt']);

    // More files than one drop takes (the route's, as the apps send at most 10): none is sent.
    put.length = 0;
    await dropped(Array.from({ length: 11 }, (_, i) => ({ name: `f${i}.txt`, text: 'x' })));
    await notes('Drop at most 10 files at once.');
    assert.equal(put.length, 0);

    // The computer refuses: the file is said not to have gone, with the server's own reason.
    refuse = true;
    await dropped([{ name: 'x.txt', text: 'x' }]);
    await notes("x.txt didn't go to the bot's folder. Couldn't do it on the computer.");
    refuse = false;
    assert.equal(put.length, 0);

    // Only watching: a drop sends nothing and says to take control.
    await page.goto(viewer(false));
    await drag('dragenter', [small]);
    assert.equal(await hintOf(), 'Take control to drop a file onto the screen.');
    assert.equal(await dropped([small]), true, 'the browser still does not open it');
    await notes('Take control to drop a file onto the screen.');
    await shot('watching');
    await page.waitForTimeout(300);
    assert.equal(put.length, 0, 'nothing was uploaded while only watching');

    // The account's language: Polish once it chose it.
    await srv.api('/settings', { method: 'PUT', body: { language: 'pl' } });
    await page.goto(viewer(true));
    await drag('dragenter', [small]);
    assert.equal(await hintOf(), 'Upuść plik, aby trafił do folderu bota');
    await dropped([small]);
    await notes('Plik Q3 report.txt jest w folderze bota.');
    assert.equal(put.length, 1);
    await dropped([{ name: 'big.bin', size: MAX + 1 }]);
    await notes('Plik big.bin ma ponad 25 MB: nie został wysłany.');
    await srv.api('/settings', { method: 'PUT', body: { language: 'en' } });

    assert.deepEqual(errors, []);
    console.log('PASS: a file dropped onto the screen with control reaches the bot\'s folder and a note names it; over the limit, too many files, a refusal of the computer and a drop while only watching say so and send nothing; a drag of text is left alone; words in English and Polish; no browser errors.');
  } finally {
    await browser?.close();
    srv.unhold?.();
    await srv.stop();
    await new Promise((r) => helper.close(r));
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
