// Optional browser check of a bot's chat as one block per run (#625), at 412 and at 1280 pixels wide:
//   NODE_PATH=<directory containing playwright> node test/browser/run-blocks.cjs
// It runs in no gate: the repository does not carry Playwright. A finished run is one frame with what was asked,
// one folded step line ("23 steps", a skill mark, a bot mark), the reply and its footer with Details; a tap on the
// step line opens the timeline. A run at work has its own line with what it does now and Stop in its footer. On the
// phone a long reply shows its first paragraph and More, and keeps a paragraph with a link. Nothing is cut.
// The server's side is stood in for on /api/runs. Scratch data and fake Claude only.
//   RUN_BLOCKS_SHOTS=<folder>  also save screenshots there
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot } = require('../helpers');

const SHOTS = process.env.RUN_BLOCKS_SHOTS;
const t = (m, s = 0) => new Date(Date.UTC(2026, 9, 27, 9, m, s)).toISOString();
const row = (m, text, extra = {}) => ({ at: t(m), text, ...extra });
const LONG = [
  'Done. The backup failed because /mnt/backup was not mounted after the reboot on Sunday night.',
  'I added the mount to fstab with nofail, mounted it again and ran the backup by hand. It took 14 minutes and wrote 38 GB. The snapshots of the last thirty days take 212 GB of the 500 GB disk, so tonight has room. I also checked that the timer is enabled and that the next run is at 02:00.',
  'The pull request with the fstab change: https://github.com/example/infra/pull/42',
  'If you want, I can add a check that warns you before the disk is 80% full, and a weekly report of how much each snapshot takes. Both would be jobs of their own, on the same computer, and would message you only when something is wrong.',
].join('\n\n');

(async () => {
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const doctor = await makeBot(srv, { name: 'Fleet Doctor', color: '#c2473d', description: 'Looks after the servers' });
    const runs = [
      { id: 'r1', botId: doctor.id, botName: 'Fleet Doctor', status: 'done', trigger: 'manual', prompt: 'Check why the backup failed last night.', customPrompt: true,
        startedAt: t(0), endedAt: t(7, 37), result: LONG,
        steps: { count: 23, rows: [row(0, 'Reading the backup log'), row(1, 'Running a command', { n: 6 }), row(3, 'Using the skill backup-check', { kind: 'skill' }), row(5, 'Editing fstab'), row(6, 'Messaging Infra Admin', { kind: 'message' })] },
        sentTo: { id: 'b2', name: 'Infra Admin', emoji: '🛠️', text: 'The backup disk was not mounted after the reboot; I fixed fstab.', at: t(6) },
        learned: [{ kind: 'skill-updated', text: 'Changed the skill backup-check', chip: 'Changed the skill backup-check', skill: 'backup-check', at: t(4) }] },
      { id: 'r2', botId: doctor.id, botName: 'Fleet Doctor', status: 'running', trigger: 'manual', prompt: 'And check the disk on the staging server.', customPrompt: true,
        startedAt: t(9), openingLine: 'Checking the disk on staging', workingLine: 'Running a command',
        steps: { count: 4, rows: [row(9, 'Connecting to staging'), row(10, 'Running a command', { n: 3 })] } },
    ];
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const errors = [];
    for (const [name, viewport] of [['phone', { width: 412, height: 915 }], ['wide', { width: 1280, height: 860 }]]) {
      const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
      await context.route((url) => url.pathname === '/api/bots', async (r) => {
        if (r.request().method() !== 'GET') return r.fallback();
        const res = await r.fetch();
        return r.fulfill({ response: res, json: (await res.json()).map((b) => (b.id === doctor.id ? { ...b, running: true, state: 'working' } : b)) });
      });
      await context.route((url) => url.pathname === '/api/runs', (r) => r.fulfill({ json: runs }));
      await context.route((url) => /^\/api\/runs\/[^/]+\/stream$/.test(url.pathname), (r) => r.fulfill({ status: 204 }));
      const page = await context.newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      const shot = async (what) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${name}-${what}.png`) }); } };
      await page.goto(`${srv.base}/#bot/${doctor.id}`);
      await page.reload();
      const thread = page.locator('#bot-thread');
      await thread.locator('.run-block').nth(1).waitFor();
      assert.equal(await thread.locator('.run-block').count(), 2, 'one block a run');
      const done = thread.locator('.run-block').first();
      const live = thread.locator('.run-block.live');
      assert.match(await done.locator('.run-steps summary').innerText(), /23 steps/);
      assert.equal(await done.locator('[data-details]').count(), 1);
      assert.match(await live.locator('.step-now').innerText(), /Running a command|Checking the disk/);
      assert.equal(await live.locator('[data-stop-run]').innerText(), 'Stop');
      if (name === 'phone') {
        assert.equal(await done.locator('.reply-more').count(), 1, 'a long reply folds on the phone');
        assert.ok(await done.getByText('pull/42').isVisible(), 'its link stays');
      }
      await page.waitForFunction(() => !document.querySelector('.main')?.getAnimations().length); // the chat's slide in
      const wide = await page.evaluate(() => [...document.querySelectorAll('#view-bot *')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 0.5 && e.getClientRects().length).map((e) => e.className).slice(0, 6).join(' | '));
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name}: no wider than the screen: ${wide}`);
      await done.scrollIntoViewIfNeeded();
      await shot('blocks');
      await done.locator('.run-steps summary').click();
      await done.locator('.step-rows').waitFor();
      await done.locator('.step-rows').scrollIntoViewIfNeeded();
      await shot('timeline');
      await context.close();
    }
    assert.deepEqual(errors, []);
    console.log('ok: a run is one block');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
