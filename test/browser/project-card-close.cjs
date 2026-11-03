// Optional browser check of closing and removing a card (#775): node test/browser/project-card-close.cjs
// X on a new card's questions takes it off the row at once, before botdot answers; X on a Change's questions shows the
// card it was at once; Remove takes a card off at once; a refusal puts the card back. Scratch data only.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, writeData, waitFor } = require('../helpers');

(async () => {
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const lead = await makeBot(srv, { name: 'Demo', color: '#1d9e75' });
    assert.equal((await srv.api('/company', { method: 'POST', body: { start: 'botdot.app' } })).status, 201);
    const c = (await srv.api('/company')).data.company;
    writeData(path.join(srv.data, 'company.json'), { ...c, phase: 'running', startedAt: new Date(Date.now() - 3_600_000).toISOString(), teams: [{ id: 't1', name: 'T', color: '#34c759', bots: [lead.id], lead: lead.id }] });
    const at = new Date().toISOString();
    const questions = [{ q: 'Which repository should the card track?', choices: ['Mine', 'apache/buildr'] }];
    const body = { show: 'number', value: '7' };
    writeData(path.join(srv.data, 'project-cards.json'), { [c.id]: [
      { id: 'k1', ask: 'Open issues', title: 'Open issues', state: 'asking', at, questions, answers: [], apps: [] },
      { id: 'k2', ask: 'Open bugs only', title: 'Bugs', state: 'asking', at, questions, answers: [], apps: [], body,
        was: { ask: 'Open bugs', answers: [], apps: [], state: 'ready', title: 'Bugs' } },
      { id: 'k3', ask: 'Stars', title: 'Stars', state: 'ready', at, answers: [], apps: [], body },
    ] });
    const ids = async () => (await srv.api('/company')).data.company.cards.map((k) => k.id);

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const page = await (await browser.newContext({ viewport: { width: 1440, height: 1000 }, colorScheme: 'dark' })).newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    // botdot answers slowly: the row must not wait for it.
    let hold = null;
    await page.route(/\/api\/company\/cards\//, async (route) => {
      await new Promise((r) => { hold = r; });
      await route.continue();
    });
    const release = async () => { await waitFor(async () => !!hold, { what: 'the request' }); const r = hold; hold = null; r(); };
    await page.goto(`${srv.base}/#company`);
    await page.locator('[data-pc-cancel="k1"]').waitFor({ timeout: 20000 });

    await page.locator('[data-pc-cancel="k1"]').click();
    await page.locator('[data-pc-asking="k1"]').waitFor({ state: 'detached', timeout: 1000 });
    await release();
    await waitFor(async () => !(await ids()).includes('k1'), { what: 'k1 gone' });

    await page.locator('[data-pc-cancel="k2"]').click();
    await page.locator('[data-pc-card="k2"]').waitFor({ timeout: 1000 });
    assert.equal(await page.locator('[data-pc-asking="k2"]').count(), 0, 'a closed Change is the card it was at once');
    await release();
    await waitFor(async () => (await srv.api('/company')).data.company.cards.find((k) => k.id === 'k2')?.state === 'ready', { what: 'k2 back' });

    await page.locator('[data-pc-menu="k3"]').click();
    await page.locator('[data-pc-remove="k3"]').click();
    await page.locator('[data-pc-card="k3"]').waitFor({ state: 'detached', timeout: 1000 });
    await release();
    await waitFor(async () => !(await ids()).includes('k3'), { what: 'k3 gone' });

    // A refusal puts the card back.
    await page.unroute(/\/api\/company\/cards\//);
    await page.route(/\/api\/company\/cards\//, (route) => route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: 'No.' }) }));
    await page.locator('[data-pc-menu="k2"]').click();
    await page.locator('[data-pc-remove="k2"]').click();
    await page.locator('[data-pc-card="k2"]').waitFor({ timeout: 5000 });
    assert.deepEqual(errors, []);
    console.log('project-card-close: ok');
  } finally {
    await browser?.close();
    await srv.stop?.();
  }
})().catch((e) => { console.error(e); process.exit(1); });
