// Optional browser check of a fresh skill in "/": NODE_PATH=<directory containing playwright> node test/browser/skill-picker-fresh.cjs
// With a bot's chat open, a skill written and picked for that bot just now is in its "/" list within seconds (#486),
// not only after the page's minute-long hold on the skill library. Scratch data and the stand-in Claude only.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { startServer, makeBot } = require('../helpers');

(async () => {
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const bot = await makeBot(srv, { name: 'Grok Coder' });
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const page = await (await browser.newContext({ viewport: { width: 1280, height: 800 }, colorScheme: 'dark' })).newPage();
    await page.goto(`${srv.base}/#bot/${bot.id}`);
    const ta = page.locator('.composer textarea:visible').first();
    await ta.waitFor({ timeout: 20000 });
    await page.waitForFunction(() => state.feed?.readyState === 1); // the skill comes with the feed's "bots" event
    await page.waitForTimeout(1000);
    await srv.api('/skills', { method: 'POST', body: { name: 'grill-with-docs', description: 'A relentless interview.', instructions: 'Ask.', bots: [bot.id] } });
    const row = page.locator('.mention-list:not(.hidden) [role=option]', { hasText: '/grill-with-docs' });
    let seen = false;
    for (let i = 0; i < 20 && !seen; i++) {
      await ta.fill('');
      await ta.pressSequentially('/gr');
      seen = await row.isVisible();
      if (!seen) await page.waitForTimeout(500);
    }
    assert.ok(seen, 'the new skill is in the "/" list');
    console.log('ok: a skill picked just now is in "/"');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
