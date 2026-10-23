// Optional browser check of command chips: NODE_PATH=<directory containing playwright> node test/browser/command-chips.cjs [shots dir]
// In a bot's chat a skill and "/btw" at the start of the message box sit on a chip that lines up with the text over it,
// and the owner's sent bubble draws them as a chip. Scratch data and the stand-in Claude only.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot } = require('../helpers');

(async () => {
  const shots = process.argv[2] || null;
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    await srv.api('/skills', { method: 'POST', body: { name: 'weekly-infra-check', description: 'Weekly review of all servers.', instructions: 'Check each server.' } });
    const bot = await makeBot(srv, { name: 'Infra Admin' });
    await srv.api(`/bots/${bot.id}`, { method: 'PUT', body: { skills: ['weekly-infra-check'] } });
    srv.reply('Checked netcup, OVH and STG.');
    srv.unhold();
    const sent = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: '/weekly-infra-check all servers' } });
    await srv.finished(sent.data.id);

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    for (const [w, h, name] of [[1280, 800, 'wide'], [390, 800, 'phone']]) {
      const page = await (await browser.newContext({ viewport: { width: w, height: h }, colorScheme: 'dark' })).newPage();
      await page.goto(`${srv.base}/#bot/${bot.id}`);
      const chip = page.locator('#bot-thread .bubble.from-me .cmd', { hasText: '/weekly-infra-check' });
      await chip.waitFor({ timeout: 20000 });
      const ta = page.locator('.composer textarea:visible').first();
      await ta.click();
      await ta.fill('/btw how long still');
      await ta.dispatchEvent('input');
      const m = await page.evaluate(() => {
        const t = [...document.querySelectorAll('.composer textarea')].find((x) => x.offsetParent);
        const c = t?.parentElement.querySelector('.ta-mark .cmd');
        if (!c) return null;
        const r = c.getBoundingClientRect(), tr = t.getBoundingClientRect();
        return { text: c.textContent, left: Math.round(r.left - tr.left), top: Math.round(r.top - tr.top), width: Math.round(r.width) };
      });
      console.log(name, JSON.stringify(m));
      assert.ok(m && m.text === '/btw' && Math.abs(m.left) <= 1 && m.width > 20, 'the chip sits under "/btw"');
      if (shots) await page.screenshot({ path: path.join(shots, `chips-${name}.png`) });
    }
    console.log('ok: chips in the bubble and in the message box');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
