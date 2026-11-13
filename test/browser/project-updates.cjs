// Wide/phone: one saved preference, primary chat updates and a question that survives them.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, waitFor } = require('../helpers');
const { goSpace } = require('../space-helpers');
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const srv = await startServer();
      let page;
      try {
        await makeBot(srv, { name: 'Helper' });
        await srv.api('/setup', { method: 'PUT', body: { done: true } });
        const unseen = (await srv.api('/whats-new')).data.entries;
        if (unseen.length) await srv.api('/whats-new/seen', { method: 'POST', body: { id: unseen[0].id } });
        const made = (await srv.api('/company', { method: 'POST', body: { empty: true, name: 'Garden launch' } })).data;
        const id = made.id;
        const chatId = (await srv.api(`/company/chief-chat?project=${id}`, { method: 'POST' })).data.chatId;
        fs.writeFileSync(path.join(srv.out, 'result.txt'), 'Which date?\n[[choices: Monday | Friday]]');
        await srv.api(`/chief/chats/${chatId}/messages`, { method: 'POST', body: { text: 'Ask for a date' } });
        await waitFor(async () => !(await srv.api(`/chief/chats/${chatId}`)).data.busy, { what: 'Chief question' });
        page = await browser.newPage({ viewport });
        const errors = []; page.on('pageerror', (e) => errors.push(e.message));
        await page.goto(srv.base);
        await page.waitForFunction(() => state.botsKnown && state.status != null && state.features.includes('project-updates'));
        if (viewport.width < 1001) { const back = page.locator('#chat-row [data-back]:visible').first(); if (await back.count()) await back.click(); }
        await goSpace(page);
        await page.locator('[data-project-settings]:visible').first().click();
        await page.locator('[data-ps-updates]').selectOption('weekly');
        await page.waitForFunction(() => state.company?.updates.every === 'weekly');
        assert.equal(await page.locator('[data-ps-report], [data-ps-standup-on]').count(), 0);
        await page.locator('[data-ps-back]').click();
        await srv.api(`/company/updates/now?project=${id}`, { method: 'POST', body: { key: `browser-update-${viewport.width}` } });
        if (viewport.width < 1001) await page.locator('[data-po-chat]').first().click();
        await page.locator('#view-chief .bubble:visible').filter({ hasText: 'Project update: Garden launch' }).first().waitFor();
        await page.locator('#view-chief [data-choice="Monday"]:visible').waitFor();
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        assert.deepEqual(errors, []);
        // An older server keeps its original report controls; no unsupported request is sent.
        await page.route('**/api/version', async (route) => { const response = await route.fetch(); const data = await response.json(); data.features = data.features.filter((f) => f !== 'project-updates'); await route.fulfill({ response, json: data }); });
        await page.goto(srv.base);
        await page.waitForFunction(() => state.botsKnown && state.status != null && !state.features.includes('project-updates'));
        if (viewport.width < 1001) { const back = page.locator('#chat-row [data-back]:visible').first(); if (await back.count()) await back.click(); }
        await goSpace(page);
        if (viewport.width < 1001) { const back = page.locator('#chat-row [data-back]:visible').first(); if (await back.count()) await back.click(); }
        await page.locator('[data-project-settings]:visible').first().click();
        await page.locator('[data-ps-standup-on]').waitFor();
        assert.equal(await page.locator('[data-ps-updates]').count(), 0);
      } finally { await page?.close(); await srv.stop(); }
    }
    process.stdout.write('project updates: ok\n');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exitCode = 1; });
