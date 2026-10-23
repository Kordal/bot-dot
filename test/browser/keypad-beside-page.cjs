// Optional browser check of the keypad beside an open page: NODE_PATH=<directory containing playwright> node test/browser/keypad-beside-page.cjs [shots dir]
// A page open beside a bot's chat leaves the keypad about 320px at 1280 and 1440. At 1920, 1440, 1280 and 1100 every
// key keeps its name and its status pill inside it, nothing scrolls sideways and the strip over the keys fits. Scratch
// data and the stand-in Claude only.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, heldRun, self } = require('../helpers');

(async () => {
  const shots = process.argv[2] || null;
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const bot = async (name, more) => { const b = await makeBot(srv, { name }); await srv.api(`/bots/${b.id}`, { method: 'PUT', body: more }); return b; };
    const ops = await bot('Infra Admin', { pinned: 1 });
    await bot('Home Assistant Admin', { pinned: 2 });
    for (const n of ['E-mail Assistant', 'Issue Writer', 'Media Watcher', 'bot-dot Manager', 'Day Planner', 'Quotz Manager']) await bot(n, { group: 'Infra' });
    await srv.api('/dashboard/tiles', { method: 'POST', body: { kind: 'value', title: 'Living room LED strip', section: 'Home', bot: ops.id, value: 'On' } });
    const { run, rec, token } = await heldRun(srv, ops, 'Make me a page');
    await self(srv, token, 'page', { title: 'Bot activity', markdown: '# Where the bots\' time goes\n\n| Bot | Runs |\n| --- | ---: |\n| E-mail Assistant | 19 |' });
    srv.reply('Done.');
    srv.release(rec);
    await srv.finished(run.id);
    srv.unhold();

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' })).newPage();
    await page.goto(`${srv.base}/#bot/${ops.id}`);
    const chip = page.locator('#bot-thread .page-chip', { hasText: 'Bot activity' });
    await chip.waitFor({ timeout: 20000 });
    await chip.click();
    await page.locator('#doc-viewer .dv-md h1').waitFor();
    const fails = [];
    for (const [w, h] of [[1920, 1080], [1440, 900], [1280, 800], [1100, 800]]) {
      await page.setViewportSize({ width: w, height: h });
      await page.waitForTimeout(250);
      const m = await page.evaluate(() => {
        const keys = document.querySelector('#kp-keys');
        const side = document.querySelector('.sidebar').getBoundingClientRect().width;
        const bad = [...keys.querySelectorAll('.key')].filter((k) => k.offsetParent).map((k) => {
          const name = k.querySelector('.name');
          const pill = k.querySelector('.kit-pill');
          const kr = k.getBoundingClientRect();
          const out = (el) => el && (el.getBoundingClientRect().right > kr.right + 0.5 || el.getBoundingClientRect().width < 30);
          return (out(name) || out(pill) || k.scrollWidth > k.clientWidth + 1) ? k.title : null;
        }).filter(Boolean);
        const head = document.querySelector('.kp-head');
        return { side: Math.round(side), sideways: keys.scrollWidth > keys.clientWidth + 1, headOver: head.scrollWidth > head.clientWidth + 1, bad };
      });
      console.log(w, JSON.stringify(m));
      if (m.sideways || m.headOver || m.bad.length) fails.push(w);
      if (shots) await page.screenshot({ path: path.join(shots, `page-open-${w}.png`) });
    }
    assert.deepEqual(fails, [], 'the keypad fits beside an open page');
    console.log('ok: the keypad fits beside an open page at 1920, 1440, 1280 and 1100');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
