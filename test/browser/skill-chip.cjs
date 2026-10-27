// Optional browser check of a skill's chip: NODE_PATH=<directory containing playwright> node test/browser/skill-chip.cjs
// A skill's chip under a reply, and the address #botsettings/<bot>/skill/<name>, open the bot's settings with the
// Skills open on that skill, its row open and in view (#619); also with the settings already open, and for a skill
// that is gone (the Skills in view, no error). Scratch data and the stand-in Claude only.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { startServer, makeBot } = require('../helpers');

(async () => {
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const bot = await makeBot(srv, { name: 'Coder' });
    const skills = Array.from({ length: 14 }, (_, i) => `skill-${String(i).padStart(2, '0')}`);
    for (const name of skills) await srv.api('/skills', { method: 'POST', body: { name, description: `What ${name} does.`, instructions: `Do ${name}.`, bots: [bot.id] } });
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 760 }]) {
      const page = await (await browser.newContext({ viewport, colorScheme: 'dark' })).newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      const opened = (name) => page.locator('#view-botsettings .skill-pick.open', { hasText: name });
      const inView = (loc) => loc.evaluate((el) => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; });

      // The address.
      await page.goto(`${srv.base}/#botsettings/${bot.id}/skill/skill-12`);
      await opened('skill-12').waitFor({ timeout: 20000 });
      assert.ok(await page.locator('#bs-skills.open').isVisible(), 'the Skills are open');
      await page.waitForTimeout(400);
      assert.ok(await inView(opened('skill-12')), 'the skill is in view');

      // A chip, with the settings already open, on another skill.
      const tap = (skill) => page.evaluate(([id, skill]) => {
        const el = document.createElement('button');
        el.dataset.learned = 'skill-updated';
        if (skill) el.dataset.skill = skill;
        openLearned(el, id);
      }, [bot.id, skill]);
      await tap('skill-03');
      await opened('skill-03').waitFor({ timeout: 10000 });
      assert.equal(await page.locator('#view-botsettings .skill-pick.open').count(), 1, 'only that skill is open');
      await page.waitForTimeout(400);
      assert.ok(await inView(opened('skill-03')), 'the skill is in view');

      // A skill that is gone: the Skills, open, and no error.
      await tap('gone-skill');
      await page.locator('#bs-skills.open .pick-list').waitFor({ timeout: 10000 });
      assert.equal(await page.locator('#view-botsettings .skill-pick.open').count(), 0);
      assert.deepEqual(errors, []);
      await page.screenshot({ path: `${process.env.SHOTS || '/tmp'}/skill-chip-${viewport.width}.png` });
      await tap('skill-12');
      await opened('skill-12').waitFor({ timeout: 10000 });
      await page.waitForTimeout(400);
      await page.screenshot({ path: `${process.env.SHOTS || '/tmp'}/skill-chip-${viewport.width}-open.png` });
    }
    console.log('ok: a skill chip opens its skill in the settings');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
