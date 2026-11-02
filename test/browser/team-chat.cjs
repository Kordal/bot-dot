// Optional browser check of a team's chat (#697): node test/browser/team-chat.cjs [shots dir]
// A team's name on a project's page opens its chat, full screen below a wide window (#839): three faces, the lead
// first with the crown, "5 bots · 1 working", the team's colour on top. A message without a mention is answered by the
// lead, whose reply names a member, who answers next; each reply under its bot's face and name. Back is the project
// again, and a bot's key opens that one chat in its place. A phone opens it the same way. Scratch data only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, writeData, waitFor } = require('../helpers');
const { shortName } = require('../../public/mentions.js');

(async () => {
  const shots = process.argv[2] || null;
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const unseen = (await srv.api('/whats-new')).data.entries;
    if (unseen.length) await srv.api('/whats-new/seen', { method: 'POST', body: { id: unseen[0].id } }); // no What's new over the screen
    const names = ['Demo Scheduler', 'Launch Poster', 'Weekly Tracker', 'Feedback Collector', 'Landing Page Builder'];
    const colors = ['#1d9e75', '#d4537e', '#ef9f27', '#e24b4a', '#7f77dd'];
    const bots = [];
    for (const [i, name] of names.entries()) bots.push(await makeBot(srv, { name, color: colors[i] }));
    const id = (name) => bots[names.indexOf(name)].id;
    const reply = (name, text) => fs.writeFileSync(path.join(srv.out, `result-${shortName(name)}.txt`), text);
    assert.equal((await srv.api('/company', { method: 'POST', body: { start: 'botdot.app' } })).status, 201);
    await srv.api('/company', { method: 'PATCH', body: { name: 'Botdot' } });
    const team = (await srv.api('/company/teams', { method: 'POST', body: { name: 'Botdot Growth', bots: names.map(id), lead: id('Demo Scheduler') } })).data.teams[0];
    // Running, as after Create: the team's chat was made with the team, through the route.
    const c = { ...(await srv.api('/company')).data.company, board: undefined }; // every piece on the board (#780)
    writeData(path.join(srv.data, 'company.json'), { ...c, phase: 'running', startedAt: new Date(Date.now() - 2 * 86_400_000).toISOString(), objectives: [{ id: 'o1', name: 'Active users', current: 7, target: 100, color: '#34c759' }], todos: [] });
    // Weekly Tracker is at work in its own chat.
    srv.hold();
    await srv.api(`/bots/${id('Weekly Tracker')}/run`, { method: 'POST', body: { prompt: 'Count active users' } });
    await waitFor(async () => (await srv.api('/bots')).data.find((b) => b.id === id('Weekly Tracker'))?.running, { what: 'Weekly Tracker at work' });

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const page = await (await browser.newContext({ viewport: { width: 1000, height: 1000 }, colorScheme: 'dark' })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${srv.base}/#company`);
    const name = page.locator(`[data-cf-team-chat="${team.id}"]`);
    await name.waitFor({ timeout: 20000 });
    await name.click();
    const panel = page.locator('#view-group');
    await panel.locator('#group-name', { hasText: 'Botdot Growth' }).waitFor();
    assert.ok(!(await page.locator('#view-company').isVisible()), 'one chat, full screen');
    assert.equal(await panel.locator('#group-sub').innerText(), '5 bots · 1 working');
    assert.equal(await panel.locator('#group-pic .team-pic > i').count(), 3);
    assert.equal(await panel.locator('#group-pic .team-pic > i:first-child .team-crown').count(), 1, 'the lead first, with the crown');
    assert.ok((await panel.locator('.chat-head').evaluate((el) => getComputedStyle(el).boxShadow)).includes('inset'), "the team's colour on top");

    srv.unhold(); // Weekly Tracker's run stays held; the turns run
    reply('Demo Scheduler', '@LaunchPoster please draft the 3 launch posts.');
    reply('Launch Poster', 'The 3 launch posts are ready.');
    await panel.locator('textarea').fill('Get the launch posts ready.');
    await panel.locator('textarea').press('Enter');
    await panel.locator('[data-reply]', { hasText: 'The 3 launch posts are ready.' }).waitFor({ timeout: 30000 });
    const who = await panel.locator('[data-reply]').evaluateAll((els) => els.map((el) => el.innerText));
    assert.ok(who[0].includes('Demo Scheduler') && who[1].includes('Launch Poster'), JSON.stringify(who));
    if (shots) await page.screenshot({ path: path.join(shots, 'wide-team-chat.png') });

    // Back is the project; a bot's key opens its one chat.
    await panel.locator('[data-back]').click();
    await page.waitForFunction(() => state.view === 'company');
    await page.locator(`[data-cf-bot="${id('Feedback Collector')}"]`).first().click();
    await page.locator('#view-bot #bot-name', { hasText: 'Feedback Collector' }).waitFor();
    assert.ok(!(await panel.isVisible()), "the team's chat made way");
    assert.equal(await page.locator('#dock').count(), 0, 'no row of docked chats');
    await page.locator('#view-bot [data-back]').click();
    await page.waitForFunction(() => state.view === 'company');
    assert.deepEqual(errors, []);

    const phone = await (await browser.newContext({ viewport: { width: 390, height: 844 }, colorScheme: 'dark', hasTouch: true })).newPage();
    phone.on('pageerror', (e) => errors.push(e.message));
    await phone.goto(`${srv.base}/#company`);
    await phone.locator(`[data-cf-team-chat="${team.id}"]`).click({ timeout: 20000 });
    await phone.locator('#view-group #group-name', { hasText: 'Botdot Growth' }).waitFor();
    await phone.waitForTimeout(400);
    if (shots) await phone.screenshot({ path: path.join(shots, 'phone-team-chat.png') });
    assert.ok(await phone.evaluate(() => document.documentElement.scrollWidth) <= 390, 'no sideways scroll');
    assert.deepEqual(errors, []);
    console.log('team chat: ok');
  } finally {
    if (browser) await browser.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
