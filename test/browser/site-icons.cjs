// Optional browser check of site icons before links (#530): NODE_PATH=<directory containing playwright> node test/browser/site-icons.cjs [shot.png]
// A bot's reply in a real page: a Markdown link and a bare address each get the icon botdot keeps for their site, or
// a globe where it keeps none; an address in `code` and a file path get none, and the link's text stays as written.
// Scratch data and the stand-in Claude only; /api/favicon is answered by the test, so no site is asked.
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { chromium } = require('playwright');
const { startServer, makeBot } = require('../helpers');

// A 16×16 orange PNG.
function png() {
  const crc = (buf) => { let c = ~0; for (const b of buf) { c ^= b; for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1; } return ~c >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(16, 0); ihdr.writeUInt32BE(16, 4); ihdr[8] = 8; ihdr[9] = 2;
  const rows = Buffer.concat(Array.from({ length: 16 }, () => Buffer.concat([Buffer.from([0]), Buffer.from(Array(16).fill([0xd8, 0x5a, 0x30]).flat())])));
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}
const REPLY = 'Read [the news](https://news.example.com/a?b=1) and news.ycombinator.com/item?id=1, not `https://code.example.com`. Also https://quiet.example.org.';

(async () => {
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const bot = await makeBot(srv, { name: 'Linker' });
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const page = await (await browser.newContext({ viewport: { width: 900, height: 600 } })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const asked = [];
    await page.route('**/api/favicon?*', (route) => {
      const host = new URL(route.request().url()).searchParams.get('host');
      asked.push(host);
      return host === 'quiet.example.org' ? route.fulfill({ status: 404, body: '{}' }) : route.fulfill({ status: 200, contentType: 'image/png', body: png() });
    });

    srv.reply(REPLY);
    const run = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Links' } })).data;
    await srv.finished(run.id);
    await page.goto(`${srv.base}/#bot/${bot.id}`);
    const reply = page.locator('#bot-thread .bubble .md', { hasText: 'Read' }).last();
    await reply.locator('.site-icon.globe').waitFor({ timeout: 10000 });

    const links = await reply.locator('a').evaluateAll((as) => as.map((a) => ({ text: a.textContent, icon: !!a.querySelector('.site-icon img'), globe: !!a.querySelector('.site-icon.globe'), loaded: a.querySelector('img')?.naturalWidth || 0 })));
    assert.deepEqual(links.map((l) => [l.text, l.icon, l.globe]), [
      ['the news', true, false], ['news.ycombinator.com/item?id=1', true, false], ['https://quiet.example.org', false, true],
    ]);
    assert.ok(links.slice(0, 2).every((l) => l.loaded === 16), 'the icons are drawn');
    assert.deepEqual([...new Set(asked)].sort(), ['news.example.com', 'news.ycombinator.com', 'quiet.example.org']);
    assert.equal(await reply.locator('code .site-icon').count(), 0, 'no icon in code');
    const box = await reply.locator('.site-icon').first().boundingBox();
    assert.ok(box.width === 16 && box.height === 16, `16 px, got ${box.width}×${box.height}`);
    if (process.argv[2]) await reply.screenshot({ path: process.argv[2] });
    assert.deepEqual(errors, []);
    console.log('site icons: ok');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
