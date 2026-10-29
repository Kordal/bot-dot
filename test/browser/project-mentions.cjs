// Optional browser check of project mentions (#700): NODE_PATH=<directory containing playwright> node test/browser/project-mentions.cjs [shots dir]
// In a bot's chat "@" offers the account's projects, a pick puts its name, and the owner's sent bubble draws it as its
// letter in its colour and its name. Scratch data and the stand-in Claude only.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, writeData } = require('../helpers');

(async () => {
  const shots = process.argv[2] || null;
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const bot = await makeBot(srv, { name: 'Shop Lead' });
    const base = { kind: 'idea', start: 'A planner', phase: 'running', startedAt: new Date().toISOString(), createdAt: new Date().toISOString() };
    writeData(path.join(srv.data, 'company.json'), { projects: [
      { ...base, id: 'p1', name: 'Botdot', color: '#3aa76d', goal: '100 users' },
      { ...base, id: 'p2', name: 'Bakery shop', color: '#e0a03c' },
    ] });
    srv.reply('Two to-dos are open.');
    srv.unhold();
    const sent = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'What is open in @Botdot?' } });
    await srv.finished(sent.data.id);

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    for (const [w, h, name] of [[1280, 800, 'wide'], [390, 800, 'phone']]) {
      const page = await (await browser.newContext({ viewport: { width: w, height: h }, colorScheme: 'dark' })).newPage();
      await page.goto(`${srv.base}/#bot/${bot.id}`);
      const chip = page.locator('#bot-thread .bubble.from-me .project-mention', { hasText: 'Botdot' });
      await chip.waitFor({ timeout: 20000 });
      assert.equal(await chip.locator('.pm-av').textContent(), 'B');
      const ta = page.locator('.composer textarea:visible').first();
      await ta.click();
      await ta.fill('Plan @bak');
      await ta.dispatchEvent('input');
      const row = page.locator('.mention-list button', { hasText: 'Bakery shop' });
      await row.waitFor({ timeout: 10000 });
      if (shots) await page.screenshot({ path: path.join(shots, `project-mention-${name}.png`) });
      await row.click();
      assert.equal(await ta.inputValue(), 'Plan @BakeryShop ');
      console.log(name, 'ok');
    }
    console.log('ok: projects offered, picked and drawn as a chip');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
