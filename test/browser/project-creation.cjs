// One description and optional sources become a real Chief conversation, then an explicit first-step review.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { startServer, makeBot } = require('../helpers');
const { goSpace } = require('../space-helpers');
(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const srv = await startServer();
      let page;
      try {
        await makeBot(srv, { name: 'Existing Helper' });
        await srv.api('/setup', { method: 'PUT', body: { done: true } });
        const unseen = (await srv.api('/whats-new')).data.entries;
        if (unseen.length) await srv.api('/whats-new/seen', { method: 'POST', body: { id: unseen[0].id } });
        page = await browser.newPage({ viewport });
        const errors = []; page.on('pageerror', (e) => errors.push(e.message));
        await page.goto(`${srv.base}/#company`);
        await goSpace(page, 'new');
        await page.locator('#co-what').waitFor();
        assert.equal(await page.locator('[data-start-empty]').count(), 0, 'one creation path');
        await page.locator('#co-what').fill('Prepare my conference talk');
        await page.locator('#co-files').setInputFiles({ name: 'brief.txt', mimeType: 'text/plain', buffer: Buffer.from('The audience already knows the basics.') });
        await page.locator('#co-sources .co-src:not(.busy)').waitFor();
        const keys = [];
        await page.route('**/api/company', async (route) => {
          if (route.request().method() !== 'POST') return route.continue();
          keys.push(route.request().postDataJSON().key);
          if (keys.length === 1) return route.fulfill({ status: 503, json: { error: 'Creation failed fixture' } });
          await route.continue();
        });
        await page.locator('#co-ask .co-go').click();
        await page.getByText('Creation failed fixture', { exact: true }).waitFor();
        assert.equal(await page.locator('#co-what').inputValue(), 'Prepare my conference talk');
        assert.match(await page.locator('#co-sources').innerText(), /brief.txt/);
        await page.locator('#co-ask .co-go').click();
        await page.waitForFunction(() => state.company?.conversation && state.view === 'chief');
        assert.equal(keys[0], keys[1], 'retry keeps its creation key');
        const c = (await srv.api('/company')).data.company;
        assert.equal(c.phase, 'setup');
        assert.equal((await srv.api('/bots')).data.length, 1);
        const chat = (await srv.api(`/chief/chats/${c.chiefChat}`)).data;
        assert.equal(chat.messages.filter((m) => m.role === 'user').length, 1);
        assert.equal(chat.messages.find((m) => m.role === 'user').attachments[0].name, 'brief.txt');
        // A deterministic Chief proposal exercises the real review and owner-only approval API.
        const proposed = await srv.asChief(`/company/teams?project=${c.id}`, { method: 'POST', headers: { 'X-Chief-Chat': c.chiefChat }, body: {
          firstStep: 'Draft a five-minute opening for review',
          proposal: [{ name: 'Talk Writer', description: 'Drafts the opening', prompt: 'Draft the opening. Never publish it.', tools: ['Read', 'Write'], connects: [], computer: false, team: 'Talk' }],
        } });
        assert.equal(proposed.status, 200, JSON.stringify(proposed.data));
        if (viewport.width < 1001) await page.locator('#chat-row [data-back]:visible').first().click();
        await page.locator('[data-creation-review]').click();
        await page.locator('[data-create]').waitFor();
        await page.getByText('Draft a five-minute opening for review', { exact: true }).waitFor();
        assert.equal(await page.locator('.co-steps-line .co-step').count(), 0, 'no mandatory wizard');
        await page.locator('[data-create]').click();
        await page.waitForFunction(() => state.company?.phase === 'running');
        assert.equal((await srv.api('/bots')).data.length, 2);
        assert.deepEqual(errors, []);
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'phone stays within the viewport');
      } finally { await page?.close(); await srv.stop(); }
    }
    console.log('conversational project creation: ok');
  } finally { await browser.close(); }
})().catch((e) => { console.error(e); process.exit(1); });
