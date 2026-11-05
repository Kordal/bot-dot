// Optional browser check of the page's own questions: node test/browser/ask-first.cjs [shots dir]
// The desktop app's WebKit on the Mac shows no confirm() or prompt() and answers no, so a step that asked that way
// never happened. Delete bot asks on the page: Cancel keeps the bot; Delete makes the row say "Deleting…", and it can't
// be pressed again, until the bot is gone. A name asked for (a new folder) is typed on the page too, Enter its yes.
// The browser's own dialog never opens. Wide and phone. In WebKit where Playwright has it (BROWSER=webkit), else
// Chromium. Scratch data only.
const assert = require('node:assert/strict');
const path = require('node:path');
const playwright = require('playwright');
const { startServer, makeBot, waitFor } = require('../helpers');

const SHOTS = process.argv[2];

(async () => {
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const engine = playwright[process.env.BROWSER || 'chromium'];
    browser = await engine.launch({ headless: true, ...(process.env.CHROME_PATH && !process.env.BROWSER ? { executablePath: process.env.CHROME_PATH } : {}) });
    const errors = [];
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const at = `${viewport.width} wide`;
      const bot = await makeBot(srv, { name: `Migration Builder ${viewport.width}` });
      const page = await (await browser.newContext({ viewport })).newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('dialog', (d) => { errors.push(`${at}: the browser's own ${d.type()}: ${d.message()}`); d.dismiss(); });
      const shot = (name) => SHOTS && page.screenshot({ path: path.join(SHOTS, `${viewport.width}-${name}.png`) });
      const ask = page.locator('#ask-first');
      const exists = async () => (await srv.api('/bots')).data.some((b) => b.id === bot.id);

      await page.goto(`${srv.base}/#bot/${bot.id}`);
      await page.locator('#bot-thread').waitFor();
      await page.evaluate((id) => setView('botsettings', id), bot.id);
      const del = page.locator('#delete-bot');
      await del.waitFor();
      await page.waitForLoadState('networkidle');

      // Cancel: asked, nothing deleted.
      await del.click();
      await ask.locator('h2', { hasText: `Delete ${bot.name}?` }).waitFor();
      await waitFor(() => ask.evaluate((m) => m.open && m.getBoundingClientRect().height > 80 && getComputedStyle(m).opacity === '1'), { what: `${at}: the question shown in full` });
      assert.deepEqual(await ask.locator('button').allInnerTexts(), ['Cancel', 'Delete'], `${at}: Cancel and Delete`);
      assert.match(await ask.locator('.modal-body').innerText(), /can't be undone/, `${at}: what goes`);
      await shot('delete-asks');
      await ask.locator('[data-ask-no]').click();
      assert.equal(await ask.evaluate((m) => m.open), false);
      assert.ok(await exists(), `${at}: Cancel keeps the bot`);

      // Delete: the row says it is deleting, and can't be pressed again, until the server answers.
      let release;
      const held = new Promise((r) => { release = r; });
      await page.route(`**/api/bots/${bot.id}`, async (route) => { if (route.request().method() === 'DELETE') await held; await route.fallback(); });
      await del.click();
      await ask.locator('[data-ask-yes]').click();
      await waitFor(async () => (await del.innerText()) === 'Deleting…', { what: 'Deleting… on the row' });
      assert.equal(await del.isDisabled(), true, `${at}: pressed once`);
      assert.equal(await del.getAttribute('aria-busy'), '', `${at}: busy`);
      await shot('deleting');
      release();
      await waitFor(async () => !(await exists()), { what: 'the bot deleted' });
      await page.locator('#toast', { hasText: 'Bot deleted' }).waitFor();

      // A name asked on the page: typed, Enter.
      const typed = page.evaluate(() => askName('Name of the new folder', '', 'Create'));
      await ask.locator('input').waitFor();
      assert.equal(await ask.locator('input').evaluate((i) => i === document.activeElement), true, `${at}: the field has the focus`);
      await page.keyboard.type('reports');
      await shot('name');
      await page.keyboard.press('Enter');
      assert.equal(await typed, 'reports');
      const cancelled = page.evaluate(() => askName('Name of the new folder'));
      await ask.locator('input').waitFor();
      await ask.locator('[data-ask-no]').click();
      assert.equal(await cancelled, null, `${at}: Cancel gives no name`);
      await page.close();
    }
    assert.deepEqual(errors, []);
    console.log("PASS: Delete bot asks on the page (Cancel keeps it), says Deleting… and can't be pressed twice until it is gone; a name is typed on the page; the browser's own dialog never opened, wide and phone.");
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
