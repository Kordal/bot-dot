// Optional browser check of a project's chat column (#825): node test/browser/project-chat.cjs [shots dir]
// A wide window shows a project's board and, on its right, one chat as a fixed column, as wide as the bot view's chat
// (#828: 38vw from 400 to 560 px).
// Entering the project opens its team's chat; a bot's key, the team's row (#838) and Esc (the Chief) each put their
// chat in the column, and the key or row on screen is highlighted. Teams are folded (ADR 196): the chevron shows the
// keys and is kept over a reload. 1-9 open the teams' chats. Hide gives the board the
// whole width, kept over a reload; Show brings the chat back. No row of docked chats. Scratch data only.
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
    const unseen = (await srv.api('/whats-new')).data.entries;
    if (unseen.length) await srv.api('/whats-new/seen', { method: 'POST', body: { id: unseen[0].id } });
    const a = await makeBot(srv, { name: 'Ops Watchkeeper', color: '#1d9e75' });
    const b = await makeBot(srv, { name: 'Release Planner', color: '#7f77dd' });
    assert.equal((await srv.api('/company', { method: 'POST', body: { start: 'quotz.it' } })).status, 201);
    await srv.api('/company', { method: 'PATCH', body: { name: 'Quotz IT' } });
    const team = (await srv.api('/company/teams', { method: 'POST', body: { name: 'Quotz IT team', bots: [a.id, b.id], lead: a.id } })).data.teams[0];
    const c = { ...(await srv.api('/company')).data.company, board: undefined };
    writeData(path.join(srv.data, 'company.json'), { ...c, phase: 'running', startedAt: new Date(Date.now() - 86_400_000).toISOString(), objectives: [], todos: [] });

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${srv.base}/#company`);
    await page.locator('.cf-top h1', { hasText: 'Quotz IT' }).waitFor({ timeout: 20000 });
    const row = page.locator('#chat-row');
    const width = async () => Math.round((await row.boundingBox()).width);
    const here = () => page.$$eval('.sp-teams .sp-chip.here, .sp-teams .key.active', (els) => els.map((el) => el.dataset.cfBot || el.dataset.cfTeamChat));

    // Entering the project: its team's chat, in the column on the right, the board beside it.
    await page.locator('#view-group #group-name', { hasText: 'Quotz IT team' }).waitFor();
    assert.ok(await page.locator('#view-company').isVisible(), 'the board stays');
    assert.equal(await width(), 547);
    const main = await page.locator('.main').boundingBox();
    const box = await row.boundingBox();
    assert.ok(Math.abs(main.x + main.width - (box.x + box.width)) < 2, 'the column stands at the right edge');
    assert.ok((await page.locator('#view-company').boundingBox()).x + (await page.locator('#view-company').boundingBox()).width <= box.x + 1, 'the board is left of it');
    assert.ok(!(await page.locator('#dock').isVisible()), 'no row of docked chats');
    assert.deepEqual(await here(), [team.id]);
    if (shots) await page.screenshot({ path: path.join(shots, 'project-chat-team.png') });

    // The team is folded (ADR 196): one row, no keys. Its chevron shows the keys, the lead first with a crown.
    assert.equal(await page.locator('.sp-keys').count(), 0, 'folded by default');
    assert.equal(await page.locator(`[data-cf-fold="${team.id}"]`).getAttribute('aria-expanded'), 'false');
    await page.locator(`[data-cf-fold="${team.id}"]`).click();
    await page.locator('.sp-keys .key').first().waitFor();
    assert.deepEqual(await here(), [team.id], 'unfolding keeps the team chat');
    // A bot's key: its chat in the column, its key highlighted, with a crown on the lead.
    assert.equal(await page.locator(`.sp-keys [data-cf-bot="${a.id}"] .cf-crown`).count(), 1, 'the lead\'s crown');
    assert.equal(await page.locator('#company-side').isVisible(), false, 'no tree beside the rail');
    assert.equal(await page.locator('.cf-desk, .cf-room, .cf-chief').count(), 0, 'no floor desks');
    await page.locator(`.sp-keys [data-cf-bot="${a.id}"]`).click();
    await page.locator('#view-bot #bot-name', { hasText: 'Ops Watchkeeper' }).waitFor();
    assert.equal(await width(), 547);
    assert.deepEqual(await here(), [a.id]);
    await page.locator('#view-bot textarea').fill('hello');
    await page.locator('#view-bot textarea').press('Enter');
    await page.waitForFunction((bot) => state.runs.some((r) => r.botId === bot && r.prompt === 'hello'), a.id);
    if (shots) await page.screenshot({ path: path.join(shots, 'project-chat-bot.png') });

    // 1: the page's first team's chat.
    await page.locator('#view-bot textarea').blur();
    await page.keyboard.press('1');
    await page.locator('#view-group #group-name', { hasText: 'Quotz IT team' }).waitFor();
    assert.deepEqual(await here(), [team.id]);
    // Folded again from its chevron; kept over a reload.
    await page.locator(`[data-cf-fold="${team.id}"]`).click();
    await page.waitForFunction(() => !document.querySelector('.sp-keys'));
    await page.locator(`[data-cf-bot="${a.id}"]`).count().then((n) => assert.equal(n, 0));
    await page.locator(`[data-cf-fold="${team.id}"]`).click();
    await page.locator('.sp-keys .key').first().waitFor();
    await page.locator(`[data-cf-bot="${b.id}"]`).click();
    await page.locator('#view-bot #bot-name', { hasText: 'Release Planner' }).waitFor();
    // The team's name.
    await page.locator(`.sp-chip[data-cf-team-chat="${team.id}"]`).click();
    await page.locator('#view-group #group-name', { hasText: 'Quotz IT team' }).waitFor();
    assert.deepEqual(await here(), [team.id]);
    // Esc: the Chief, in the column.
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => state.view === 'chief');
    assert.ok(await page.locator('#view-company').isVisible(), 'the board stays beside the Chief');
    assert.equal(await width(), 547);
    assert.deepEqual(await here(), []);

    // Hide: the board takes the whole width, and stays so over a reload; Show brings the team's chat back.
    await page.locator('#view-chief [data-dock-hide]').click();
    await page.waitForFunction(() => state.view === 'company');
    assert.ok(!(await row.isVisible()), 'no chat column');
    const board = await page.locator('#view-company').boundingBox();
    assert.ok(Math.abs(board.width - main.width) < 2, 'the board has the whole width');
    await page.locator('#project-chat-show').waitFor();
    if (shots) await page.screenshot({ path: path.join(shots, 'project-chat-hidden.png') });
    await page.reload();
    await page.locator('.cf-top h1', { hasText: 'Quotz IT' }).waitFor({ timeout: 20000 });
    await page.locator('.sp-keys .key').first().waitFor(); // still unfolded
    await page.locator('#project-chat-show').waitFor();
    assert.equal(await page.evaluate(() => state.view), 'company');
    await page.locator('#project-chat-show').click();
    await page.locator('#view-group #group-name', { hasText: 'Quotz IT team' }).waitFor();
    assert.ok(!(await page.locator('#project-chat-show').isVisible()));

    // A narrower window: 38vw.
    await page.setViewportSize({ width: 1180, height: 820 });
    await page.waitForFunction(() => Math.round(document.querySelector('#chat-row').getBoundingClientRect().width) === 448);
    if (shots) await page.screenshot({ path: path.join(shots, 'project-chat-narrow.png') });
    // A bot's settings cover the chat in the column, not squeeze it.
    await page.locator(`[data-cf-bot="${a.id}"]`).first().click();
    await page.locator('#view-bot #bot-name', { hasText: 'Ops Watchkeeper' }).waitFor();
    await page.locator('#view-bot .chat-title, #view-bot #bot-name').first().click();
    await page.locator('#panel:not(.hidden)').waitFor();
    assert.ok(!(await page.locator('#view-bot').isVisible()), 'the settings take the chat\'s place');
    assert.equal(await width(), 448);

    assert.deepEqual(errors, []);
    console.log('project chat column: ok');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
