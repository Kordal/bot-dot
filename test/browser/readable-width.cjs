// Optional browser check of readable answers and Board text values (#726), at 390 and at 1440 pixels wide:
//   NODE_PATH=<directory containing playwright> node test/browser/readable-width.cjs
// A bot's long answer stops its lines at about 62 characters while its table is not held to that, the owner's
// bubble keeps 76%; a Board value in words ("Eco until 17:00") is drawn at 20px on one line, a number stays big.
// The runs are stood in for on /api/runs. Scratch data and fake Claude only.
//   SHOTS=<folder>  also save screenshots there
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot } = require('../helpers');

const SHOTS = process.env.SHOTS;
const t = (m) => new Date(Date.UTC(2026, 9, 29, 9, m)).toISOString();
const ANSWER = [
  'The backup disk was not mounted after the reboot, so last night\'s backup wrote nothing and the job said it had finished. I fixed the mount entry, mounted the disk and ran the backup by hand; it took eleven minutes and every check passed.',
  '| Disk | Free | State |\n| --- | --- | --- |\n| backup-1 | 380 GB | mounted |\n| backup-2 | 1.2 TB | mounted |\n| scratch | 40 GB | mounted after the fix, kept for temporary files |',
  'Tonight\'s run will use the same disk. If it fails again I will tell you before the morning.',
].join('\n\n');

(async () => {
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const doctor = await makeBot(srv, { name: 'Fleet Doctor', color: '#c2473d' });
    const add = async (body) => { const r = await srv.api('/dashboard/tiles', { method: 'POST', body }); assert.equal(r.status, 201, JSON.stringify(r.data)); return r.data; };
    const pump = await add({ kind: 'value', title: 'Heat pump', section: 'Home', bot: doctor.id });
    await srv.asChief(`/dashboard/tiles/${pump.id}/value`, { method: 'PUT', body: { value: 'Eco until 17:00' } });
    const temp = await add({ kind: 'value', title: 'Living room', section: 'Home', bot: doctor.id, unit: '°C' });
    await srv.asChief(`/dashboard/tiles/${temp.id}/value`, { method: 'PUT', body: { value: 21.5 } });
    const runs = [{ id: 'r1', botId: doctor.id, status: 'success', trigger: 'manual', prompt: 'Check why the backup failed last night and tell me what you changed, and whether tonight\'s run is safe.', customPrompt: true, startedAt: t(0), endedAt: t(7), result: ANSWER, steps: { count: 12, rows: [] } }];
    browser = await chromium.launch({ headless: true });
    const errors = [];
    for (const [name, viewport] of [['phone', { width: 390, height: 844 }], ['wide', { width: 1440, height: 900 }]]) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
      await context.route((url) => url.pathname === '/api/runs', (r) => r.fulfill({ json: runs }));
      await context.route((url) => /^\/api\/runs\/[^/]+\/stream$/.test(url.pathname), (r) => r.fulfill({ status: 204 }));
      const page = await context.newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      const shot = async (what) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${what}-${name}.png`) }); } };
      await page.goto(`${srv.base}/#bot/${doctor.id}`);
      await page.reload();
      const answer = page.locator('#bot-thread .bubble.from-bot .md').first();
      await answer.waitFor();
      await page.waitForFunction(() => !document.querySelector('.main')?.getAnimations().length);
      const m = await answer.evaluate((md) => {
        const p = md.querySelector('p');
        const probe = document.createElement('div');
        probe.style.width = '62ch';
        p.append(probe);
        const cap = probe.getBoundingClientRect().width;
        probe.remove();
        return { cap, max: parseFloat(getComputedStyle(p).maxWidth), p: p.getBoundingClientRect().width, table: getComputedStyle(md.querySelector('table')?.closest('.md > *')).maxWidth, md: md.getBoundingClientRect().width };
      });
      assert.ok(Math.abs(m.max - m.cap) < 1 && m.p <= m.cap + 1, `${name}: a paragraph is at most 62ch (${JSON.stringify(m)})`);
      assert.equal(m.table, 'none', `${name}: a table keeps the chat's width`);
      const mine = await page.evaluate(() => { const b = document.querySelector('#bot-thread .stack.mine'); return b && getComputedStyle(b).maxWidth; });
      if (mine) assert.equal(mine, '76%', 'the owner\'s bubble keeps its width');
      await shot('chat');
      await page.goto(srv.base);
      await page.waitForFunction(() => typeof setView === 'function' && state.bots?.length === 1);
      await page.waitForFunction(() => document.querySelectorAll('.kp-card .kit-num').length === 2, null, { timeout: 5000 }).catch(() => {});
      const strip = await page.evaluate(() => [...document.querySelectorAll('.kp-card .kit-num')].map((v) => ({ text: v.textContent, size: getComputedStyle(v).fontSize })));
      assert.equal(strip.find((v) => v.text.startsWith('Eco'))?.size, '20px', `${name}: words at 20px on the home strip too: ${JSON.stringify(strip)}`);
      assert.ok(parseFloat(strip.find((v) => v.text.startsWith('21.5'))?.size) > 20, `${name}: the number stays big on the strip`);
      await shot('home');
      await page.locator('[data-board]:visible').first().click(); // the keypad's line of the Board
      await page.waitForFunction(() => document.querySelectorAll('#view-dashboard [data-tile]').length === 2);
      await page.waitForFunction(() => !document.querySelector('.main')?.getAnimations({ subtree: true }).length);
      const vals = await page.evaluate(() => [...document.querySelectorAll('#view-dashboard :is(.tile-val, .kit-num)')].map((v) => ({ text: v.textContent, words: v.classList.contains('words'), size: getComputedStyle(v).fontSize, lines: Math.round(v.getBoundingClientRect().height / parseFloat(getComputedStyle(v).lineHeight)) })));
      const words = vals.find((v) => v.text.startsWith('Eco'));
      const number = vals.find((v) => v.text.startsWith('21.5'));
      assert.ok(words?.words && words.size === '20px', `${name}: the words at 20px: ${JSON.stringify(vals)}`);
      assert.equal(words.lines, 1, `${name}: on one line`);
      assert.ok(number && !number.words && parseFloat(number.size) > 20, `${name}: the number stays big: ${JSON.stringify(vals)}`);
      await shot('board');
      const over = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth, ...[...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 1 && e.getClientRects().length).slice(0, 6).map((e) => e.className + ':' + Math.round(e.getBoundingClientRect().right))]);
      assert.ok(over[0] <= over[1], `${name}: no wider than the screen ${JSON.stringify(over)}`);
      await context.close();
    }
    assert.deepEqual(errors, []);
    console.log('ok: readable answers and Board text values');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
