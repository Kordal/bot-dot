// Optional browser check of Reply on a run's block (#627), at 412 and at 1280 pixels wide:
//   NODE_PATH=<directory containing playwright> node test/browser/reply-to.cjs
// It runs in no gate: the repository does not carry Playwright. A run that replies to another is a further round of
// its block. Reply on the block puts "Reply to: <its request>" with ✕ above the box; the next message carries `replyTo`
// and the chip goes. The server's side is stood in for on /api/runs. Scratch data and fake Claude only.
//   REPLY_TO_SHOTS=<folder>  also save screenshots there
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot } = require('../helpers');

const SHOTS = process.env.REPLY_TO_SHOTS;
const t = (m) => new Date(Date.UTC(2026, 9, 27, 9, m)).toISOString();

(async () => {
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const doctor = await makeBot(srv, { name: 'Fleet Doctor', color: '#c2473d' });
    const runs = [
      { id: 'r1', botId: doctor.id, status: 'success', trigger: 'manual', prompt: 'Check why the backup failed last night.', customPrompt: true, startedAt: t(0), endedAt: t(7),
        result: 'The backup disk was not mounted after the reboot. I fixed fstab and ran the backup by hand.', steps: { count: 23, rows: [] } },
      { id: 'r2', botId: doctor.id, status: 'success', trigger: 'manual', prompt: 'Clean the snapshots older than 30 days.', customPrompt: true, replyTo: 'r1', startedAt: t(10), endedAt: t(12),
        result: 'Removed 14 snapshots, 90 GB free now.', steps: { count: 6, rows: [] } },
    ];
    browser = await chromium.launch({ headless: true });
    const errors = [];
    for (const [name, viewport] of [['phone', { width: 412, height: 915 }], ['wide', { width: 1280, height: 860 }]]) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
      const sent = [];
      await context.route((url) => url.pathname === '/api/runs', (r) => r.fulfill({ json: runs }));
      await context.route((url) => url.pathname === `/api/bots/${doctor.id}/run`, async (r) => {
        sent.push(r.request().postDataJSON());
        return r.fulfill({ status: 201, json: { id: 'r3', botId: doctor.id, status: 'running', prompt: 'x', replyTo: 'r2', startedAt: t(20) } });
      });
      await context.route((url) => /^\/api\/runs\/[^/]+\/stream$/.test(url.pathname), (r) => r.fulfill({ status: 204 }));
      const page = await context.newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      const shot = async (what) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${name}-${what}.png`) }); } };
      await page.goto(`${srv.base}/#bot/${doctor.id}`);
      await page.reload();
      const thread = page.locator('#bot-thread');
      await thread.locator('.run-block').first().waitFor();
      await page.waitForFunction(() => !document.querySelector('.main')?.getAnimations().length);
      assert.equal(await thread.locator('.run-block').count(), 1, 'two rounds, one block');
      assert.equal(await thread.locator('.round-rule').count(), 1);
      const block = thread.locator('.run-block');
      await block.hover();
      const reply = block.locator('[data-reply-run="r2"]');
      assert.ok(await reply.isVisible(), 'Reply on the block');
      await shot('block');
      await reply.click();
      const chip = page.locator('#view-bot .reply-chip');
      assert.equal(await chip.locator('.grow').innerText(), 'Reply to: Check why the backup failed last night.');
      await shot('chip');
      await page.locator('#view-bot textarea').fill('Also check tonight\'s run.');
      await page.locator('#view-bot .send-btn').click();
      await chip.waitFor({ state: 'hidden' });
      assert.equal(sent[0].replyTo, 'r2');
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name}: no wider than the screen`);
      await context.close();
    }
    assert.deepEqual(errors, []);
    console.log('ok: Reply on a block');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
