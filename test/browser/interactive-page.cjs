// Optional browser check of a bot's interactive page (#399, ADR 072):
//   NODE_PATH=<directory containing playwright> node test/browser/interactive-page.cjs [shots dir]
// The real front door with the sandbox's own address and an account's real botdot server; the web page signed in.
// The page opens beside the bot's chat in a frame on the sandbox's address, with the bar that says it is isolated.
// Inside it, a probe tries what a page must not do: read the app's cookies or storage, call the app's API with the
// owner's cookie, reach the internet, move the app's own window; and does what it may: read its own data.json, and
// ask for a link out, which the app shows before it opens. No request of the frame's reaches the app or the internet.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const passkey = require('../fixtures/soft-passkey');
const { startFrontDoor } = require('../front-door-helpers');
const { startServer, makeBot, freePort } = require('../helpers');

const probe = (app) => `
const out = {};
const show = () => { document.getElementById('out').textContent = JSON.stringify(out); };
const tryFetch = async (u, o) => { try { const r = await fetch(u, o); return 'reached ' + r.status; } catch (e) { return 'blocked'; } };
(async () => {
  try { out.cookie = document.cookie === '' ? 'empty' : document.cookie; } catch (e) { out.cookie = 'blocked'; }
  try { localStorage.setItem('a', '1'); out.storage = 'open'; } catch (e) { out.storage = 'blocked'; }
  out.origin = self.origin;
  out.api = await tryFetch(${JSON.stringify(app)} + '/api/bots', { credentials: 'include' });
  out.internet = await tryFetch('https://example.com/');
  out.data = await fetch('data.json').then((r) => r.json()).then((j) => 'read ' + j.done, () => 'failed');
  try { top.location.href = 'https://example.com/'; out.top = 'moved'; } catch (e) { out.top = 'blocked'; }
  out.done = true;
  show();
})();
document.getElementById('link').onclick = () => parent.postMessage({ botdot: 'open', url: 'https://github.com/Kordal/bot-dot/issues/399' }, '*');
`;
const PAGE = `<!doctype html><meta charset="utf-8"><title>Roadmap</title>
<style>body{font:15px system-ui;background:#141413;color:#ecebe8;margin:24px} .card{border:1px solid #333;border-radius:12px;padding:16px;margin:12px 0}</style>
<h1>Roadmap</h1><div class="card"><b>Now</b><p>Interactive pages in a sandbox (#399)</p></div>
<button id="link">Open the issue</button><pre id="out">running…</pre><script src="app.js"></script>`;

(async () => {
  const shots = process.argv[2] || null;
  const ann = await startServer({ account: 'ann' });
  const sitesPort = await freePort();
  const door = await startFrontDoor({ env: { FRONT_DOOR_ADMIN: 'ann', FRONT_DOOR_SITES_ORIGIN: `http://localhost:${sitesPort}`, FRONT_DOOR_SITES_PORT: String(sitesPort) } });
  let browser;
  try {
    fs.symlinkSync(path.dirname(ann.socket), path.join(door.sockets, 'ann'));
    const owner = door.browser();
    const key = passkey.create({ rpId: door.rpId, origin: door.origin });
    const options = await owner.post(`${door.firstLink.path}/options`, { name: 'ann' });
    assert.equal((await owner.post(door.firstLink.path, { name: 'ann', credential: key.register(options.data.publicKey) })).status, 201);
    await ann.api('/setup', { method: 'PUT', body: { done: true } });
    const bot = await makeBot(ann, { name: 'Ops', color: '#45c78e' });
    // As publish_interactive_page leaves it (lib/pages.js publish).
    const pages = require('../../lib/pages').create(path.join(ann.dir, 'data'));
    pages.publish(bot.id, { title: 'Roadmap', files: [
      { path: 'index.html', data: Buffer.from(PAGE) }, { path: 'app.js', data: Buffer.from(probe(door.origin)) }, { path: 'data.json', data: Buffer.from('{"done":7}') },
    ] });

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
    const [name, value] = owner.cookie().split('=');
    await context.addCookies([{ name, value, url: door.origin, httpOnly: false }]);
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const requests = [];
    page.on('request', (r) => requests.push({ url: r.url(), frame: r.frame()?.url() || '' }));
    await page.goto(`${door.origin}/#bot/${bot.id}`);
    await page.waitForFunction(() => typeof Pages !== 'undefined' && state.bots?.length);
    await page.evaluate((id) => Pages.openPage({ botId: id, slug: 'roadmap', title: 'Roadmap', bot: 'Ops' }), bot.id);
    const viewer = page.locator('#doc-viewer');
    await viewer.locator('.pg-isolated', { hasText: 'Isolated: runs on its own address, cannot see your account, cannot reach the internet.' }).waitFor({ timeout: 20000 });
    assert.match(await viewer.locator('.dv-title span').innerText(), /^Interactive page by Ops · updated just now$/);
    assert.equal(await viewer.locator('iframe.dv-site').getAttribute('sandbox'), 'allow-scripts');
    const frame = page.frameLocator('iframe.dv-site');
    await frame.locator('#out', { hasText: '"done":true' }).waitFor({ timeout: 20000 });
    const out = JSON.parse(await frame.locator('#out').innerText());
    console.log('the page found:', out);
    assert.equal(out.origin, 'null', 'an origin of its own: none');
    assert.equal(out.cookie, 'blocked', "the app's cookies can't be read");
    assert.equal(out.storage, 'blocked');
    assert.equal(out.api, 'blocked', "the app's API can't be called");
    assert.equal(out.internet, 'blocked', 'the internet is out of reach');
    assert.equal(out.data, 'read 7', 'its own data.json is');
    assert.equal(out.top, 'blocked');
    assert.equal(page.url(), `${door.origin}/#bot/${bot.id}`, 'the app stayed');
    const fromFrame = requests.filter((r) => r.frame.includes(`:${sitesPort}/`));
    assert.ok(fromFrame.length >= 2, 'its script and its data');
    assert.deepEqual(requests.filter((r) => /example\.com/.test(r.url)), [], 'nothing went to the internet');
    assert.deepEqual(fromFrame.filter((r) => !r.url.startsWith(`http://localhost:${sitesPort}/ann/`)), [], 'no request of the frame left its own address');
    if (shots) await page.screenshot({ path: path.join(shots, 'wide-interactive.png') });

    await frame.locator('#link').click();
    const modal = page.locator('#modal');
    await modal.locator('h2', { hasText: 'Open a link?' }).waitFor();
    assert.match(await modal.innerText(), /The page wants to open github\.com/);
    if (shots) await page.screenshot({ path: path.join(shots, 'wide-link.png') });
    await modal.locator('[data-dismiss]').first().click();

    await viewer.locator('[data-dv="versions"]').click();
    await modal.locator('h2', { hasText: 'Versions of “Roadmap”' }).waitFor();
    assert.match(await modal.innerText(), /Version 1 · on the page/);
    await modal.locator('[data-dismiss]').first().click();

    // Full screen and back keep the frame, and what the owner did in it.
    await page.evaluate(() => { document.querySelector('iframe.dv-site').dataset.mark = '1'; });
    await viewer.locator('[data-dv="full"].btn').click();
    await viewer.locator('[data-dv="full"].btn', { hasText: 'Back beside the chat' }).waitFor();
    assert.equal(await viewer.locator('iframe.dv-site').getAttribute('data-mark'), '1', 'the same frame, not loaded again');
    assert.ok(await viewer.evaluate((el) => el.classList.contains('full')));
    await viewer.locator('[data-dv="full"].btn').click();
    await viewer.locator('[data-dv="full"].btn', { hasText: 'Full screen' }).waitFor();
    assert.equal(await viewer.locator('iframe.dv-site').getAttribute('data-mark'), '1');
    assert.match(await viewer.locator('a[download]').first().getAttribute('download'), /^roadmap\.zip$/);

    await page.setViewportSize({ width: 390, height: 844 });
    if (shots) await page.screenshot({ path: path.join(shots, 'phone-interactive.png') });
    assert.deepEqual(errors, []);
    console.log('PASS  interactive page in the browser');
  } finally {
    await browser?.close();
    await door.stop();
    await ann.stop();
    fs.rmSync(ann.dir, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
