// Optional browser check of what waits, Stop on the line, who is signed out and why a job did not run
// (BUSY-005), at 412 and at 1280 pixels wide:
//   NODE_PATH=<directory containing playwright> node test/browser/message-waits.cjs
// It runs in no gate: the repository does not carry Playwright. The acceptance task runs it by hand.
// In a bot's chat a waiting message is the owner's bubble, faded, under the working line with Stop and above
// nothing else, with "Waits until Fleet Doctor is free" and "Take back" under it; Take back puts its text into
// the box and the bubble goes. The Chief's chat has the same line, "Waiting for Web Surfer" with Stop, no
// "Thinking" bubble and Send in the box, and its waiting message says "until the Chief is free". While Claude is
// signed out one line stands beside the logo on the wide screen and above the box on the narrow one, and "Sign
// in" opens Setup. A bot's jobs show the server's line, a long one whole, with the pills "failed 5 times" and
// "did not run". Nothing overlaps or is cut at either width.
// The server's side is stood in for on the page's own requests (/api/bots, /api/runs, the Chief's chat, the
// feed's first message), in the words of "The contract" of BUSY-001 to BUSY-004, so the walk needs no working
// bot, no replying Chief and no signed-out Claude. Scratch data and fake Claude only.
//   MESSAGE_WAITS_SHOTS=<folder>  also save screenshots there
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, waitFor } = require('../helpers');

const SHOTS = process.env.MESSAGE_WAITS_SHOTS;
const at = '2026-10-06T09:00:00.000Z';
const FIRST = 'Check why the backup failed last night.';
const SECOND = 'Also check that tonight\'s backup has enough room, and tell me how much the snapshots of the last thirty days take.';
const MORE = 'And what is the weather there on Friday?';
const FAILED = 'Last run at 14:00: failed, 5 times in a row since 02:00. Something went wrong and I couldn\'t finish. It said: “df: /mnt/backup: No such file or directory”.';
const MISSED = 'Did not run at 08:00: botdot was off.';
const SIGNED_OUT = 'Claude is signed out: bots can\'t work. Sign in';

(async () => {
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const doctor = await makeBot(srv, { name: 'Fleet Doctor', color: '#c2473d', description: 'Looks after the servers' });
    const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
    const job = (id, name, last) => ({ id, name, kind: 'ai', cron: '0 * * * *', when: 'every hour', prompt: '', enabled: true, approved: true, createdBy: 'you', nextRunAt: '2026-10-07T08:00:00.000Z', last });

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const errors = [];
    for (const [name, viewport] of [['phone', { width: 412, height: 915 }], ['wide', { width: 1280, height: 800 }]]) {
      const phone = name === 'phone';
      // What the page is told, and what it asked for.
      let queued = [{ id: 'q1', text: SECOND, attachments: [{ name: 'backup-2026-10-05.log', file: 'uploads/backup-2026-10-05.log', size: 20480 }], at }];
      let chiefQueued = [{ id: 'q7', text: MORE, attachments: [], at }];
      let claude = { loggedIn: true };
      const asked = [];
      const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
      await context.route((url) => url.pathname === '/api/bots', async (r) => {
        if (r.request().method() !== 'GET') return r.fallback();
        const res = await r.fetch();
        const bots = (await res.json()).map((b) => (b.id === doctor.id ? { ...b, running: true, state: 'working', queued,
          jobs: [job('j1', 'Disk check', { status: 'error', at, failures: 5, since: '2026-10-06T02:00:00.000Z', text: FAILED }), job('j2', 'Morning news', { status: 'missed', at, text: MISSED }), job('j3', 'Price watch', { status: 'quiet', at, text: 'Last run at 09:00: nothing to report.' })] } : b));
        return r.fulfill({ response: res, json: bots });
      });
      await context.route((url) => url.pathname === '/api/runs', (r) => r.fulfill({ json: [{ id: 'r1', botId: doctor.id, botName: 'Fleet Doctor', botColor: '#c2473d', status: 'running', trigger: 'manual', prompt: FIRST, customPrompt: true, startedAt: at, openingLine: 'Reading last night\'s backup log' }] }));
      await context.route((url) => /^\/api\/(runs\/[^/]+|chief\/chats\/[^/]+)\/stream$/.test(url.pathname), (r) => r.fulfill({ status: 204 })); // a stood-in run or reply has no stream
      await context.route((url) => url.pathname === `/api/bots/${doctor.id}/queued/q1`, (r) => {
        asked.push(`${r.request().method()} take back`);
        const [back] = queued;
        queued = [];
        return r.fulfill({ json: { text: back.text, attachments: back.attachments } });
      });
      await context.route((url) => url.pathname === '/api/chief', async (r) => {
        const res = await r.fetch();
        return r.fulfill({ response: res, json: { ...(await res.json()), busy: true } });
      });
      await context.route((url) => url.pathname === `/api/chief/chats/${chat.id}`, async (r) => {
        if (r.request().method() !== 'GET') return r.fallback();
        const res = await r.fetch();
        return r.fulfill({ response: res, json: { ...(await res.json()), busy: true, queued: chiefQueued,
          messages: [{ role: 'user', text: 'Ask Web Surfer for the cheapest flight to Lisbon on Friday.', at }, { role: 'chief', text: '', at, pending: true, actions: [], activity: { tool: 'wait_for_run', text: 'Waiting for Web Surfer' } }] } });
      });
      await context.route((url) => url.pathname === `/api/chief/chats/${chat.id}/stop`, (r) => { asked.push('stop the Chief'); return r.fulfill({ json: { ok: true } }); });
      await context.route((url) => url.pathname === '/api/runs/r1/stop', (r) => { asked.push('stop the run'); return r.fulfill({ json: { ok: true } }); });
      // The feed: its first message says whether Claude is signed in, then it is quiet (the page asks again by itself).
      await context.route((url) => url.pathname === '/api/events', (r) => r.fulfill({ status: 200, contentType: 'text/event-stream', body: `event: hello\ndata: ${JSON.stringify({ claude, approvals: { jobs: [], tiles: [], memory: 0, memoryChanges: [] } })}\n\n` }));

      const page = await context.newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      const shot = async (what) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${name}-${what}.png`) }); } };
      const open = async (hash, wait) => {
        await page.goto(`${srv.base}/#${hash}`);
        await page.reload();
        await page.locator(wait).first().waitFor();
      };
      const box = (sel) => page.locator(sel).first().boundingBox();
      // Nothing is cut: no part of the page is wider than its screen, and each of these lies inside the screen.
      const whole = async (...sels) => {
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), `${name}: the page is no wider than the screen`);
        for (const sel of sels) {
          const b = await box(sel);
          assert.ok(b, `${name}: ${sel} is drawn`);
          assert.ok(b.x >= 0 && b.x + b.width <= viewport.width + 0.5, `${name}: ${sel} is inside the screen (${Math.round(b.x)} to ${Math.round(b.x + b.width)})`);
        }
      };
      // One lies wholly above the other.
      const above = async (upper, lower) => { const [a, b] = [await box(upper), await box(lower)]; assert.ok(a.y + a.height <= b.y + 0.5, `${name}: ${upper} is above ${lower}`); };

      // ---- A bot's chat: the working line with Stop, then what waits.
      await open(`bot/${doctor.id}`, '#bot-thread .chat-queued .bubble.waits');
      const thread = page.locator('#bot-thread');
      assert.equal(await thread.locator('.status-line span').innerText(), 'Reading last night\'s backup log');
      assert.equal(await thread.locator('.status-line button').innerText(), 'Stop');
      const waits = thread.locator('.chat-queued .bubble.waits');
      assert.equal(await waits.count(), 1);
      assert.ok((await waits.innerText()).startsWith(SECOND));
      assert.equal(await waits.evaluate((el) => getComputedStyle(el).opacity), '0.5', 'faded');
      assert.equal(await waits.locator('.file-chip .fname').innerText(), 'backup-2026-10-05.log', 'its file, as on a sent message');
      assert.equal(await thread.locator('.chat-queued .bubble-meta span').innerText(), 'Waits until Fleet Doctor is free');
      assert.equal(await thread.locator('.chat-queued [data-take-back]').innerText(), 'Take back');
      await whole('#bot-thread .status-line', '#bot-thread .status-line button', '#bot-thread .chat-queued .bubble.waits', '#bot-thread .chat-queued .bubble-meta', '#bot-thread .chat-queued [data-take-back]', '#view-bot .composer-box');
      await above('#bot-thread .status-line', '#bot-thread .chat-queued');
      await above('#bot-thread .chat-queued .bubble.waits', '#bot-thread .chat-queued .bubble-meta');
      await above('#bot-thread .chat-queued', '#view-bot .composer-box');
      const send = page.locator('#view-bot .send-btn');
      assert.equal(await send.getAttribute('aria-label'), 'Send', 'Send stays while the bot works');
      assert.equal(await send.evaluate((el) => el.classList.contains('stop')), false);
      await shot('bot-waits');

      // Stop is the word on the line.
      await thread.locator('.status-line button').click();
      await waitFor(() => asked.includes('stop the run'), { what: 'Stop to stop the run' });

      // Take back: its text and file are in the box, and the bubble is gone.
      await thread.locator('.chat-queued [data-take-back]').click();
      await waitFor(async () => (await page.locator('#view-bot textarea').inputValue()) === SECOND, { what: 'the text back in the box' });
      assert.deepEqual(asked.filter((a) => a.endsWith('take back')), ['DELETE take back']);
      assert.equal(await page.locator('#view-bot .attach-list .file-chip.ready').count(), 1, 'its file, ready to send');
      await waitFor(async () => (await thread.locator('.chat-queued .bubble.waits').count()) === 0, { what: 'the waiting bubble to go' });
      assert.equal(await thread.locator('.status-line').count(), 1, 'the bot works on');
      await whole('#view-bot .composer-box', '#view-bot .attach-list');
      await shot('bot-taken-back');

      // ---- The Chief's chat: the same line, no bubble, Send in the box.
      await open(`chief/${chat.id}`, '#chat-thread .status-line');
      const chief = page.locator('#chat-thread');
      assert.equal(await chief.locator('.status-line span').innerText(), 'Waiting for Web Surfer');
      assert.equal(await chief.locator('.status-line [data-stop-chief]').innerText(), 'Stop');
      assert.equal(await chief.locator('.typing, .live-line').count(), 0, 'no "Thinking" bubble');
      assert.equal(await chief.locator('[data-pending]').isVisible(), false, 'the reply being written takes no room');
      assert.equal(await chief.locator('.chat-queued .bubble-meta span').innerText(), 'Waits until the Chief is free');
      assert.equal(await page.locator('#view-chief .send-btn').getAttribute('aria-label'), 'Send');
      await whole('#chat-thread .status-line', '#chat-thread .status-line button', '#chat-thread .chat-queued .bubble.waits', '#chat-thread .chat-queued .bubble-meta', '#view-chief .composer-box');
      await above('#chat-thread .status-line', '#chat-thread .chat-queued');
      await above('#chat-thread .chat-queued', '#view-chief .composer-box');
      await chief.locator('.status-line [data-stop-chief]').click();
      await waitFor(() => asked.includes('stop the Chief'), { what: 'Stop to stop the Chief\'s reply' });
      await shot('chief-waits');

      // ---- Claude is signed out: one standing line, beside the logo or above the box.
      assert.equal(await page.locator('#signed-out').isVisible(), false);
      assert.equal(await page.locator('#view-chief .claude-line').isVisible(), false);
      claude = { loggedIn: false };
      chiefQueued = [];
      await open(`chief/${chat.id}`, '#chat-thread .status-line');
      const beside = page.locator('#signed-out');
      const over = page.locator('#view-chief .claude-line');
      await (phone ? over : beside).waitFor();
      assert.equal(await beside.isVisible(), !phone, 'beside the logo on the wide screen');
      assert.equal(await over.isVisible(), phone, 'above the box on the narrow one');
      const line = phone ? over : beside;
      assert.equal((await line.innerText()).replace(/\s+/g, ' ').trim(), SIGNED_OUT);
      if (phone) {
        await whole('#view-chief .claude-line', '#view-chief .claude-line button');
        await above('#view-chief .claude-line', '#view-chief .composer-box');
        await above('#chat-thread .status-line', '#view-chief .claude-line');
      } else {
        await whole('#signed-out', '#signed-out button');
        const [logo, said, head] = [await box('#brand'), await box('#signed-out'), await box('.side-head')];
        assert.ok(logo.x + logo.width <= said.x + 0.5, 'beside the logo, not over it');
        assert.ok(said.x + said.width <= head.x + head.width + 0.5 && said.y >= head.y - 0.5 && said.y + said.height <= head.y + head.height + 0.5, 'inside the list\'s head');
      }
      assert.equal(await page.locator('#away').isVisible(), false);
      await shot('signed-out');
      await line.getByRole('button', { name: 'Sign in' }).click();
      await page.locator('#view-setup:not(.hidden)').waitFor();
      claude = { loggedIn: true };

      // ---- A bot's jobs: the server's line under each, a long one whole.
      await open(`botjobs/${doctor.id}`, '#view-botjobs .job-card');
      const cards = page.locator('#view-botjobs .job-card');
      assert.equal(await cards.count(), 3);
      assert.deepEqual(await page.locator('#view-botjobs .job-card summary .pill').allInnerTexts(), ['failed 5 times', 'did not run', (await cards.nth(2).locator('summary .pill').innerText())]);
      assert.equal(await cards.nth(1).locator('summary .pill').evaluate((el) => el.classList.contains('warn')), true, '"did not run" in the warning colour');
      for (let i = 0; i < 3; i++) await cards.nth(i).evaluate((el) => { el.open = true; });
      assert.deepEqual(await page.locator('#view-botjobs .job-last').allInnerTexts(), [FAILED, MISSED, 'Last run at 09:00: nothing to report.']);
      for (let i = 0; i < 3; i++) {
        const [card, last] = [await cards.nth(i).boundingBox(), await cards.nth(i).locator('.job-last').boundingBox()];
        assert.ok(last.x >= card.x - 0.5 && last.x + last.width <= card.x + card.width + 0.5, `${name}: the line of job ${i + 1} is inside its card`);
        const cut = await cards.nth(i).locator('.job-last').evaluate((el) => el.scrollWidth > el.clientWidth + 1);
        assert.equal(cut, false, `${name}: the line of job ${i + 1} is whole`);
        const [run, remove] = [await cards.nth(i).locator('[data-run-job]').boundingBox(), await cards.nth(i).locator('[data-remove-job]').boundingBox()];
        assert.ok(run.x + run.width <= card.x + card.width + 0.5 && remove.x + remove.width <= card.x + card.width + 0.5, `${name}: its buttons are inside its card`);
        const overlap = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
        assert.equal(overlap(last, run) || overlap(last, remove), false, `${name}: the line of job ${i + 1} is under or beside its buttons, not over them`);
      }
      await whole('#view-botjobs .job-card');
      await shot('jobs');
      await context.close();
    }
    assert.deepEqual(errors, []);
    console.log('PASS: what waits, at 412 and 1280 pixels: the faded bubble under the working line with Stop, Take back into the box, the Chief\'s line with Stop and no bubble, the standing line for a signed-out Claude beside the logo and above the box, and the jobs with the server\'s line and pills, nothing cut or over anything else');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
