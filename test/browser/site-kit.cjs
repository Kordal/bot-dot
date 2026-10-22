// Optional browser check of the style kit's templates (#400):
//   NODE_PATH=<directory containing playwright> node test/browser/site-kit.cjs [shots dir]
// Each plain template, unpacked as start_interactive_page leaves it, served with the sandbox's own rules (the CSP and
// the open CORS header of front-door.js sitesHeaders) and framed with sandbox="allow-scripts" from another address, as
// the app frames an interactive page. It must draw from its data.json in Geist, with no request off its own address;
// the roadmap's chips filter, its cards open, its views switch, live values reach the html template, and a phone gets
// one column.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright');
const siteKit = require('../../lib/site-kit');
const sites = require('../../lib/sites');

const SHOTS = process.argv[2];
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-site-kit-'));

function unpack(template) {
  const at = path.join(dir, template);
  fs.mkdirSync(at);
  fs.writeFileSync(path.join(dir, `${template}.tar`), siteKit.tar(siteKit.files(template)));
  execFileSync('tar', ['-xf', path.join(dir, `${template}.tar`), '-C', at]);
  return at;
}

function serve(handler) {
  return new Promise((resolve) => {
    const s = http.createServer(handler).listen(0, '127.0.0.1', () => resolve({ server: s, origin: `http://127.0.0.1:${s.address().port}` }));
  });
}

(async () => {
  const roots = { html: unpack('html'), roadmap: unpack('roadmap') };
  const offsite = [];
  let app;
  const site = await serve((req, res) => {
    const m = req.url.match(/^\/(html|roadmap)\/([^?#]*)$/);
    const file = m && path.join(roots[m[1]], m[2] || 'index.html');
    if (!file || !file.startsWith(roots[m[1]]) || !fs.existsSync(file)) { res.writeHead(404); return res.end(); }
    const own = `${site.origin}/${m[1]}/`;
    res.writeHead(200, {
      'Content-Type': sites.TYPES[path.extname(file).slice(1)],
      'Content-Security-Policy': ['sandbox allow-scripts', "default-src 'none'", `script-src ${own} 'unsafe-inline'`, `style-src ${own} 'unsafe-inline'`, `img-src ${own} data: blob:`,
        `font-src ${own} data:`, `connect-src ${own}`, "form-action 'none'", "base-uri 'none'", `frame-ancestors ${app.origin}`].join('; '),
      'Access-Control-Allow-Origin': '*',
    });
    fs.createReadStream(file).pipe(res);
  });
  app = await serve((req, res) => {
    const t = req.url.slice(1).split('?')[0] || 'roadmap';
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!doctype html><body style="margin:0;background:#000"><iframe id="f" sandbox="allow-scripts" src="${site.origin}/${t}/index.html" style="border:0;width:100vw;height:100vh"></iframe>
      <script>window.asked = []; addEventListener('message', (e) => window.asked.push(e.data));
      document.getElementById('f').onload = () => document.getElementById('f').contentWindow.postMessage({ botdot: 'values', values: { Disk: { title: 'Disk', data: { value: 83 }, at: 'now' } } }, '*');</script>`);
  });

  const browser = await chromium.launch();
  try {
    for (const [name, size] of [['wide', { width: 1440, height: 900 }], ['phone', { width: 390, height: 844 }]]) {
      const page = await browser.newPage({ viewport: size });
      page.on('request', (r) => { if (!r.url().startsWith(site.origin) && !r.url().startsWith(app.origin) && !r.url().startsWith('data:')) offsite.push(r.url()); });
      await page.goto(`${app.origin}/roadmap`);
      const frame = page.frameLocator('#f');
      await frame.locator('.fc').first().waitFor();
      assert.equal(await frame.locator('.col').count(), 3, 'three columns');
      assert.equal(await frame.locator('.fc').count(), 9, 'every card of data.json');
      assert.match(await frame.locator('h1').innerText(), /Everything bot-dot does/);
      assert.match(await frame.locator('.ring b').innerText(), /72%/);
      const font = await frame.locator('h1').evaluate((h) => document.fonts.check('650 44px Geist') && getComputedStyle(h).fontFamily);
      assert.match(String(font), /^Geist/, 'drawn in Geist, from the kit');
      const cols = await frame.locator('.kanban').evaluate((k) => getComputedStyle(k).gridTemplateColumns.split(' ').length);
      assert.equal(cols, name === 'phone' ? 1 : 3, `${name}: ${cols} columns`);
      if (name === 'wide') {
        await frame.locator('.fc', { hasText: 'Retest #267' }).click();
        await frame.locator('.fc.open .more').waitFor();
        if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, 'roadmap-wide.png') }); }
        await frame.locator('[data-area="Rooms"]').click();
        assert.equal(await frame.locator('.fc').count(), 1, 'a chip filters by area');
        await frame.locator('[data-area="All"]').click();
        await frame.locator('input.search').fill('hotkey');
        assert.equal(await frame.locator('.fc').count(), 1, 'the search finds a card');
        await frame.locator('[data-view="releases"]').click();
        assert.equal(await frame.locator('table.table tbody tr').count(), 2, 'the Releases view');
        assert.equal(await frame.locator('.kanban').isVisible(), false);
      } else if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'roadmap-phone.png'), fullPage: true });
      await page.close();
    }

    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    await page.goto(`${app.origin}/html`);
    const frame = page.frameLocator('#f');
    await frame.locator('.kpi').first().waitFor();
    await frame.locator('.kpi', { hasText: '83' }).waitFor();
    assert.match(await frame.locator('.kpi', { hasText: 'Disk' }).innerText(), /live from the Board/, 'a live value from the app reaches the page');
    await frame.locator('[data-view="items"]').click();
    assert.equal(await frame.locator('table.table tbody tr').count(), 4);
    await frame.locator('th[data-sort="name"]').click();
    assert.equal(await frame.locator('table.table tbody tr td').first().innerText(), 'Final texts', 'sorted by name');
    if (SHOTS) await page.screenshot({ path: path.join(SHOTS, 'html-wide.png') });
    // A link out goes to the app as the one request a page may make.
    await frame.locator('body').evaluate(() => { const a = document.createElement('a'); a.href = 'https://example.com/x'; a.id = 'out'; a.textContent = 'out'; document.body.append(a); });
    await frame.locator('#out').click();
    await page.waitForFunction(() => window.asked.length > 0);
    assert.deepEqual(await page.evaluate(() => window.asked), [{ botdot: 'open', url: 'https://example.com/x' }]);
    assert.deepEqual(offsite, [], 'no request off the page\'s own address');
    console.log('site kit: roadmap and html templates draw in the sandbox, wide and on a phone');
  } finally {
    await browser.close();
    site.server.close();
    app.server.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
