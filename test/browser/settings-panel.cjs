// Optional browser check of the settings panel: NODE_PATH=<directory containing playwright> node test/browser/settings-panel.cjs
// At 1440px a bot's settings, its jobs and the Chief's settings open right of the chat, which stays in
// view and in use; at 900px (a main column under 780px) the panel covers the chat, with a back button.
// SHOTS=<folder> keeps a picture of each. Scratch data and the stand-in Claude only.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, waitFor } = require('../helpers');

(async () => {
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const bot = await makeBot(srv, { name: 'Web Surfer' });
    const other = await makeBot(srv, { name: 'Writer' });
    await srv.api(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name: 'Morning news', kind: 'ai', cron: '0 8 * * *', prompt: 'Check the news' } });
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('dialog', (d) => d.accept());
    const shot = async (name) => { if (process.env.SHOTS) await page.screenshot({ path: path.join(process.env.SHOTS, `${name}.png`) }); };
    const hash = () => new URL(page.url()).hash;
    const box = (sel) => page.locator(sel).boundingBox();
    const seen = (sel) => page.locator(sel).isVisible();
    // Nothing in the panel is wider than the panel.
    const fits = (sel) => page.evaluate((s) => { const el = document.querySelector(s); return el.scrollWidth <= el.clientWidth; }, sel);
    const chatOpen = () => page.evaluate(() => chatOpen());

    // ---- 1440px: side by side ----
    await page.goto(`${srv.base}/#bot/${bot.id}`);
    await page.locator('#bot-settings').click();
    await page.locator('#bot-form input[name=name]').waitFor();
    assert.equal(hash(), `#botsettings/${bot.id}`);
    assert.ok(await seen('#bot-thread'), 'the chat stays in view');
    assert.ok(await seen('#view-bot textarea'), 'with its composer');
    const [chat, panel] = [await box('#view-bot'), await box('#panel')];
    assert.equal(Math.round(panel.width), 380);
    assert.ok(Math.abs(chat.x + chat.width - panel.x) < 1, 'the panel is right of the chat');
    assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('#panel')).borderLeftWidth), '1px', 'with a line between them');
    assert.ok(await seen('#panel-close'));
    assert.equal(await seen('#panel-back'), false, 'no back button beside the chat');
    assert.ok(await fits('#view-botsettings'), 'the settings fit in 380px');
    assert.equal(await chatOpen(), `bot:${bot.id}`, 'side by side, the chat counts as open');
    await shot('1440-bot-settings');

    // The chat is in use: a message sent with the panel open is answered in the thread beside it.
    await page.locator('#view-bot textarea').fill('Say hello');
    await page.locator('#view-bot .send-btn').click();
    await waitFor(async () => (await srv.api(`/runs?botId=${bot.id}`)).data.some((r) => r.status !== 'running'), { what: 'the run' });
    await page.locator('#bot-thread .bubble.from-me', { hasText: 'Say hello' }).waitFor();
    await waitFor(async () => (await page.locator('#bot-thread .bubble.from-bot:not(.live)').count()) > 0, { what: 'the reply in the thread' });
    assert.ok(await seen('#bot-form input[name=name]'), 'the panel is still open');

    // A change saves by itself, and the chat beside it shows it.
    await page.locator('#bot-form input[name=name]').fill('Web Surfer 2');
    await page.locator('#bot-form input[name=name]').blur();
    await waitFor(async () => (await srv.api(`/bots/${bot.id}`)).data.name === 'Web Surfer 2', { what: 'the saved name' });
    await waitFor(async () => (await page.locator('#bot-name').innerText()) === 'Web Surfer 2', { what: 'the name in the chat header' });

    // Jobs in the panel, and back to the settings.
    await page.locator('[data-bs-jobs]').click();
    await page.locator('#view-botjobs .job-card').waitFor();
    assert.equal(hash(), `#botjobs/${bot.id}`);
    assert.ok(await seen('#bot-thread'));
    assert.equal(await seen('#view-botsettings'), false);
    await page.locator('#view-botjobs .job-card > summary').click();
    assert.ok(await fits('#view-botjobs'), 'an open job card fits in 380px');
    await shot('1440-bot-jobs');
    assert.match(await page.locator('#panel-back').innerText(), /Settings/);
    await page.locator('#panel-back').click();
    await page.locator('#bot-form input[name=name]').waitFor();
    assert.equal(hash(), `#botsettings/${bot.id}`);

    // Another bot in the list: the panel stays, on that bot's settings; from the jobs too.
    await page.locator('[data-bs-jobs]').click();
    await page.locator('#view-botjobs .job-card').waitFor();
    await page.locator(`.contact[data-contact="${other.id}"]`).click();
    assert.equal(hash(), `#botsettings/${other.id}`);
    assert.equal(await page.locator('#bot-form input[name=name]').inputValue(), 'Writer');
    assert.equal(await page.locator('#bot-name').innerText(), 'Writer');

    // The Chief in the list: its settings in the panel; its figure and name close and open it.
    await page.locator('.contact[data-contact="chief"]').click();
    await page.locator('#chief-form').waitFor();
    assert.match(hash(), /^#chiefsettings/);
    assert.ok(await seen('#view-chief textarea'));
    assert.equal(Math.round((await box('#panel')).width), 380);
    assert.ok(await fits('#view-chiefsettings'), 'the Chief\'s settings fit in 380px');
    await shot('1440-chief-settings');
    // A message to the Chief with the panel open: answered beside it, and the address keeps the panel.
    await page.locator('#view-chief textarea').fill('Hello Chief');
    await page.locator('#view-chief .send-btn').click();
    await page.locator('#chat-thread .bubble.from-me', { hasText: 'Hello Chief' }).waitFor();
    await waitFor(async () => /^#chiefsettings\/.+/.test(hash()), { what: 'the address of the Chief\'s chat with its panel' });
    assert.ok(await seen('#chief-form'));
    await waitFor(async () => (await page.locator('#chat-thread .bubble.from-bot:not(.live)').count()) > 0, { what: 'the Chief\'s reply' });
    // The narrowest column that holds both: the chat, 400px of it, still fits.
    await page.setViewportSize({ width: 1080, height: 900 });
    assert.equal(Math.round((await box('main')).width), 780);
    assert.ok(await seen('#view-chief textarea'));
    assert.equal(Math.round((await box('#view-chief')).width), 400);
    assert.ok(await fits('#view-chief') && await fits('#chat-thread'), 'the chat fits beside the panel');
    await shot('1080-chief-settings');
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('#chief-settings').click();
    assert.equal(await seen('#panel'), false);
    assert.match(hash(), /^#chief(\/|$)/);
    assert.ok(Math.abs((await box('#view-chief')).width - (await box('main')).width) < 1, 'the chat takes the full column again');
    await page.locator('#chief-settings').click();
    await page.locator('#chief-form').waitFor();
    await page.locator('#panel-close').click();
    assert.equal(await seen('#panel'), false);

    // A closed panel stays closed in another chat; the figure and name open and close it.
    await page.locator(`.contact[data-contact="${bot.id}"]`).click();
    assert.equal(hash(), `#bot/${bot.id}`);
    assert.equal(await seen('#panel'), false);
    await page.locator('#bot-settings').click();
    await page.locator('#bot-form').waitFor();
    await page.locator('#bot-settings').click();
    assert.equal(await seen('#panel'), false);
    assert.equal(hash(), `#bot/${bot.id}`);

    // The address keeps the panel over a reload.
    for (const [at, sel, chatSel] of [[`#botsettings/${bot.id}`, '#bot-form', '#bot-thread'], [`#botjobs/${bot.id}`, '#view-botjobs .job-card', '#bot-thread'], ['#chiefsettings', '#chief-form', '#view-chief textarea']]) {
      await page.goto(`${srv.base}/${at}`);
      await page.reload();
      await page.locator(sel).waitFor();
      assert.ok(await seen(chatSel), `${at}: the chat with the panel`);
      assert.match(hash(), new RegExp(`^${at}`));
    }

    // The other ways in: the bot's row in Settings, and a link of a run.
    await page.evaluate((id) => openBotMemory(id), bot.id);
    await page.locator('#bot-form').waitFor();
    assert.ok(await seen('#bot-thread'), 'openBotMemory: the chat with the panel');
    await page.evaluate(() => setView('settings'));
    assert.equal(await seen('#panel'), false, 'no panel beside a page that is no chat');
    assert.equal(await seen('#chat-row'), false);
    await page.evaluate((id) => setView('botsettings', id), other.id);
    await page.locator('#bot-form').waitFor();
    assert.equal(await page.locator('#bot-name').innerText(), 'Writer');

    // ---- 900px: the panel covers the chat ----
    await page.setViewportSize({ width: 900, height: 800 });
    assert.ok((await box('main')).width < 780, 'the main column is under 780px');
    await page.locator('#bot-form').waitFor();
    assert.equal(await seen('#view-bot'), false, 'narrowed: the panel covers the chat, without a reload');
    assert.ok(Math.abs((await box('#panel')).width - (await box('main')).width) < 1, 'the panel fills the chat\'s place');
    assert.ok(await seen('#panel-back'));
    assert.equal(await seen('#panel-close'), false);
    assert.match(await page.locator('#panel-back').innerText(), /Writer/);
    await waitFor(async () => (await chatOpen()) === null, { what: 'the covered chat not counting as open' });
    await shot('900-bot-settings');
    await page.locator('[data-bs-jobs]').click();
    await page.locator('#job-add').waitFor();
    await page.locator('#panel-back').click();
    await page.locator('#bot-form').waitFor();
    await page.locator('#panel-back').click();
    assert.ok(await seen('#bot-thread'), 'back shows the chat');
    assert.equal(await seen('#panel'), false);
    assert.equal(hash(), `#bot/${other.id}`);
    assert.equal(await chatOpen(), `bot:${other.id}`);
    await shot('900-chat');

    // Covered, another bot chosen in the list shows that bot's chat, not its settings.
    await page.locator('#bot-settings').click();
    await page.locator('#bot-form').waitFor();
    await page.locator(`[data-contact="${bot.id}"]`).click();
    await page.locator('#bot-thread').waitFor();
    assert.equal(await seen('#panel'), false, 'the panel made way for the chat');
    assert.equal(hash(), `#bot/${bot.id}`);
    await page.locator(`[data-contact="${other.id}"]`).click();
    await waitFor(async () => hash() === `#bot/${other.id}`, { what: 'the other bot\'s chat' });

    // Widened with the panel open: side by side, without a reload.
    await page.locator('#bot-settings').click();
    await page.locator('#bot-form').waitFor();
    assert.equal(await seen('#view-bot'), false);
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.locator('#bot-thread').waitFor();
    assert.ok(await seen('#bot-form'));
    assert.equal(Math.round((await box('#panel')).width), 380);
    await waitFor(async () => (await chatOpen()) === `bot:${other.id}`, { what: 'the uncovered chat counting as open' });

    // The Chief's settings covering its chat, on a phone.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => setView('chiefsettings'));
    await page.locator('#chief-form').waitFor();
    assert.equal(await seen('#view-chief'), false);
    assert.ok(await fits('#view-chiefsettings'));
    await shot('390-chief-settings');
    await page.locator('#panel-back').click();
    assert.ok(await seen('#view-chief textarea'));

    // Deleting the bot from the panel closes the panel and opens the Chief's chat.
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.evaluate((id) => setView('botsettings', id), other.id);
    await page.locator('#delete-bot').click();
    await waitFor(async () => (await srv.api('/bots')).data.every((b) => b.id !== other.id), { what: 'the bot deleted' });
    await page.locator('#view-chief textarea').waitFor();
    assert.equal(await seen('#panel'), false);
    assert.match(hash(), /^#chief(\/|$)/);

    assert.deepEqual(errors, []);
    console.log('PASS: the settings panel beside the chat at 1440px (settings, jobs, the Chief, another chat, a reload, a message answered beside it), over it at 900px and 390px with a back button, widened and narrowed without a reload, and a deleted bot; no browser errors.');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
