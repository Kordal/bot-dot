// Optional browser check of a bot's live runs above its message box (#501), at 412 and at 1280 pixels wide:
//   NODE_PATH=<directory containing playwright> node test/browser/live-runs.cjs
// It runs in no gate: the repository does not carry Playwright. The acceptance task runs it by hand.
// With three runs going, a card stands above the message box with a row each: what it was asked, what it is doing
// now, its time on the wide screen, and Stop, which stops that run; the run that waits for the owner's OK has a
// still dot and says so, and there is no status line under the chat. When one run ends its row folds away; with
// one run left the card goes and the status line is back, with Stop. Nothing overlaps or is cut at either width.
// The server's side is stood in for on the page's own requests (/api/bots, /api/runs, the feed's first message),
// so the walk needs no working bot. Scratch data and fake Claude only.
//   LIVE_RUNS_SHOTS=<folder>  also save screenshots there
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, waitFor } = require('../helpers');

const SHOTS = process.env.LIVE_RUNS_SHOTS;
const ago = (s) => new Date(Date.now() - s * 1000).toISOString();

(async () => {
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const quotz = await makeBot(srv, { name: 'Quotz Manager', color: '#4f86d9', description: 'Looks after Quotz' });
    const run = (id, startedS, more) => ({ id, botId: quotz.id, botName: 'Quotz Manager', botColor: '#4f86d9', status: 'running', kind: 'ai', trigger: 'manual', customPrompt: true, startedAt: ago(startedS), ...more });

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const errors = [];
    for (const [name, viewport] of [['phone', { width: 412, height: 915 }], ['wide', { width: 1280, height: 800 }]]) {
      let runs = [
        run('r1', 262, { prompt: 'Fix the +alias normalisation for passmail.net', workingLine: 'Using github_mcp' }),
        run('r2', 95, { prompt: 'Check why the staging deploy is slow', workingLine: 'Reading the deploy logs', waitingFor: 'ok' }),
        run('r3', 18, { prompt: 'Look at PR #241 and tell me if it is safe to merge', workingLine: 'Looking at PR #241' }),
      ];
      const asked = [];
      const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
      await context.route((url) => url.pathname === '/api/bots', async (r) => {
        if (r.request().method() !== 'GET') return r.fallback();
        const res = await r.fetch();
        const n = runs.length;
        return r.fulfill({ response: res, json: (await res.json()).map((b) => (b.id === quotz.id ? { ...b, running: n > 0, runningCount: n, state: n ? 'working' : 'idle' } : b)) });
      });
      await context.route((url) => url.pathname === '/api/runs', (r) => r.fulfill({ json: runs }));
      await context.route((url) => /^\/api\/runs\/[^/]+\/stream$/.test(url.pathname), (r) => r.fulfill({ status: 204 }));
      await context.route((url) => /^\/api\/runs\/[^/]+\/stop$/.test(url.pathname), (r) => { asked.push(r.request().url().split('/').at(-2)); return r.fulfill({ json: { ok: true } }); });
      await context.route((url) => url.pathname === '/api/events', (r) => r.fulfill({ status: 200, contentType: 'text/event-stream', body: `event: hello\ndata: ${JSON.stringify({ claude: { loggedIn: true }, features: ['working-line', 'message-waits', 'connector-waits'], approvals: { jobs: [], tiles: [], memory: 0, memoryChanges: [] } })}\n\n` }));

      const page = await context.newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      const shot = async (what) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${name}-${what}.png`) }); } };
      const box = (sel) => page.locator(sel).first().boundingBox();
      const whole = async (...sels) => {
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name}: the page is no wider than the screen`);
        for (const sel of sels) {
          const b = await box(sel);
          assert.ok(b, `${name}: ${sel} is drawn`);
          assert.ok(b.x >= 0 && b.x + b.width <= viewport.width + 0.5, `${name}: ${sel} is inside the screen`);
        }
      };
      const above = async (upper, lower) => { const [a, b] = [await box(upper), await box(lower)]; assert.ok(a.y + a.height <= b.y + 0.5, `${name}: ${upper} is above ${lower}`); };
      const again = () => page.evaluate(() => refresh());

      await page.goto(`${srv.base}/#bot/${quotz.id}`);
      await page.reload();
      await page.locator('#view-bot .live-runs').waitFor();
      const card = page.locator('#view-bot .live-runs');
      assert.equal(await card.locator('.live-run').count(), 3);
      assert.deepEqual(await card.locator('.live-ask').allInnerTexts(), ['Fix the +alias normalisation for passmail.net', 'Check why the staging deploy is slow', 'Look at PR #241 and tell me if it is safe to merge']);
      assert.deepEqual(await card.locator('em').allInnerTexts(), ['Using github_mcp', 'Waiting for your OK', 'Looking at PR #241']);
      assert.equal(await card.locator('.live-run.held .plan-spin').count(), 0, 'the run that waits has a still dot');
      assert.equal(await card.locator('.live-run.doing .plan-spin').count(), 2);
      assert.equal(await card.locator('time').first().isVisible(), name === 'wide', 'its time on the wide screen only');
      assert.equal(await page.locator('#bot-thread .status-line').count(), 0, 'no status line under the chat');
      assert.equal(await page.locator('#bot-sub').innerText(), 'working ×3…');
      await whole('#view-bot .live-runs', '#view-bot .live-run button', '#view-bot .composer-box');
      await above('#view-bot .live-runs', '#view-bot .composer-box');
      await shot('three');

      // Stop on a row stops that run.
      await card.locator('[data-stop-live="r3"]').click();
      await waitFor(() => asked.includes('r3'), { what: 'Stop to stop r3' });

      // It ends: its row shows a check, then folds away.
      runs = runs.filter((r) => r.id !== 'r3');
      await again();
      await page.locator('#view-bot .live-run.done[data-live-run="r3"]').waitFor();
      await shot('one-ends');
      await waitFor(async () => (await card.locator('.live-run').count()) === 2, { what: 'the row to fold away', timeout: 4000 });

      // One left: the status line is back, with Stop, and the card goes.
      runs = runs.filter((r) => r.id !== 'r2');
      await again();
      await waitFor(async () => (await page.locator('#view-bot .live-runs').count()) === 0, { what: 'the card to go', timeout: 4000 });
      await page.locator('#bot-thread .status-line').waitFor();
      assert.equal(await page.locator('#bot-thread .status-line span').innerText(), 'Using github_mcp');
      assert.equal(await page.locator('#bot-thread .status-line button').innerText(), 'Stop');
      await shot('one-left');
      await context.close();
    }
    assert.deepEqual(errors, [], 'no errors on the page');
    console.log('live runs: ok at 412 and 1280 pixels');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
