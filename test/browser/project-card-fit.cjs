// Optional browser check of a card's content filling its tile: node test/browser/project-card-fit.cjs [shots dir]
// A list card holds up to 15 items. The row of cards shows its first 5; on an arranged board the card shows as many
// whole items as its tile's height holds, so a card resized taller shows more and one made shorter fewer, and no item
// is cut in half. Scratch data only.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, writeData, waitFor } = require('../helpers');

(async () => {
  const shots = process.argv[2] || null;
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const lead = await makeBot(srv, { name: 'Demo', color: '#1d9e75' });
    assert.equal((await srv.api('/company', { method: 'POST', body: { start: 'botdot.app' } })).status, 201);
    const c = (await srv.api('/company')).data.company;
    writeData(path.join(srv.data, 'company.json'), { ...c, name: 'Quotz', phase: 'running', startedAt: new Date(Date.now() - 3_600_000).toISOString(), teams: [{ id: 't1', name: 'Dev', color: '#34c759', bots: [lead.id], lead: lead.id }] });
    const list = Array.from({ length: 15 }, (_, i) => ({ ref: `#${300 - i}`, text: `Issue number ${i + 1}`, tag: i < 4 ? 'launch-blocker' : 'bug', level: i < 4 ? 'err' : 'info' }));
    writeData(path.join(srv.data, 'project-cards.json'), { [c.id]: [
      { id: 'k1', ask: 'Open issues', title: 'Buildr Open Issues', state: 'ready', at: new Date().toISOString(), triedAt: new Date().toISOString(), answers: [], apps: [], body: { show: 'list', value: '55', sub: '+2 today', list } },
    ] });

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark' })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const shown = () => page.locator('[data-pc-card="k1"] .pc-list li').evaluateAll((l) => l.filter((x) => x.offsetParent).length);
    // Every shown item inside the card, none cut by its bottom.
    const inside = () => page.locator('[data-pc-card="k1"]').evaluate((card) => {
      const bottom = card.getBoundingClientRect().bottom;
      return [...card.querySelectorAll('.pc-list li')].filter((x) => x.offsetParent).every((x) => x.getBoundingClientRect().bottom <= bottom + 0.5);
    });

    await page.goto(`${srv.base}/#company`);
    await page.locator('[data-pc-card="k1"]').waitFor({ timeout: 20000 });
    assert.equal(await shown(), 5, 'the row of cards shows the first 5');

    // An arranged board with the card short: fewer, whole.
    const put = async (h) => {
      const r = await srv.api('/company/layout', { method: 'PUT', body: { layout: { 'card:k1': [0, 0, 1000, h] } } });
      assert.equal(r.status, 200, JSON.stringify(r.data));
      await page.reload();
      await page.locator('.bc-tile[data-tile="card:k1"] [data-pc-card="k1"]').waitFor({ timeout: 20000 });
    };
    await put(160);
    const few = await shown();
    assert.ok(few >= 1 && few < 5, `a short card shows fewer: ${few}`);
    assert.ok(await inside(), 'no item cut in half');

    // Made tall: every item.
    await put(700);
    assert.equal(await shown(), 15, 'a tall card shows all it read');
    assert.ok(await inside());
    if (shots) await page.screenshot({ path: path.join(shots, 'wide-tall.png') });

    // Resized by its bottom edge, the card shows more as it grows, live.
    await put(300);
    const before = await shown();
    const r = await page.locator('.bc-tile[data-tile="card:k1"]').boundingBox();
    await page.mouse.move(r.x + r.width / 2, r.y + r.height - 3);
    await page.mouse.down();
    await page.mouse.move(r.x + r.width / 2, r.y + r.height + 200, { steps: 6 });
    const during = await shown();
    await page.mouse.up();
    assert.ok(during > before, `more while it grows: ${before} -> ${during}`);
    assert.ok(await inside());
    await waitFor(async () => (await srv.api('/company')).data.company.layout['card:k1'][3] > 300, { what: 'the taller card saved' });
    if (shots) await page.screenshot({ path: path.join(shots, 'wide-resized.png') });

    assert.deepEqual(errors, []);
    console.log('project-card-fit: ok');
  } finally {
    if (browser) await browser.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
