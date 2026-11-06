// Optional browser check that a bot's chat stays as it is while its run takes steps (#1063, #1064):
//   node test/browser/run-steps-grow.cjs
// A running run takes ten steps: its open step line grows in place, the rest of the chat is the same nodes (a reply
// opened with More stays open, a text selection stays), and its stream is opened once, in the simple form. The stream
// dropping comes back while the run runs. The run stream is stood in for in the page. Scratch data and fake Claude only.
// CHROME_PATH picks the browser.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { startServer, makeBot, sleep } = require('../helpers');

const t = (m) => new Date(Date.UTC(2026, 10, 6, 9, m)).toISOString();
const steps = (n) => ({ count: n, rows: Array.from({ length: n }, (_, i) => ({ at: t(i + 1), text: `Reading file ${i}` })) });

// In the page: the running run's streams, each counted, each able to drop.
function fakeStream() {
  const Real = window.EventSource;
  window.runStreams = [];
  window.EventSource = class {
    constructor(url) {
      if (!/\/api\/runs\/r1\/stream/.test(url)) return new Real(url);
      this.url = url;
      this.readyState = 1;
      window.runStreams.push(this);
      setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'reply_draft', text: 'Half a reply' }) }), 50);
    }
    close() { this.readyState = 2; }
  };
}

(async () => {
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const bot = await makeBot(srv, { name: 'Quotz' });
    const done = { id: 'r0', botId: bot.id, botName: 'Quotz', status: 'success', trigger: 'manual', prompt: 'Earlier task', customPrompt: true, startedAt: t(0), endedAt: t(0), result: 'Earlier reply. '.repeat(10) };
    const running = { id: 'r1', botId: bot.id, botName: 'Quotz', status: 'running', trigger: 'manual', prompt: 'Read the repo', customPrompt: true, startedAt: t(1), steps: steps(1) };
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
    await context.addInitScript(fakeStream);
    await context.route((url) => url.pathname === '/api/runs', (r) => r.fulfill({ json: [running, done] }));
    await context.route((url) => url.pathname === '/api/features', async (r) => {
      const res = await r.fetch();
      const body = await res.json();
      const list = Array.isArray(body) ? body : body.features;
      if (!list.includes('reply-draft')) list.push('reply-draft');
      return r.fulfill({ response: res, json: body });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${srv.base}/#bot/${bot.id}`);
    await page.reload();
    const line = page.locator('#bot-thread details.run-steps.now');
    await line.waitFor();
    await page.locator('#bot-thread .draft').waitFor();
    await line.locator('summary').click();
    // Marks on what stands in the chat, and a selection in the earlier reply.
    await page.evaluate(() => {
      document.querySelector('#bot-thread .run-block').dataset.mark = 'kept';
      document.querySelector('#bot-thread details.run-steps.now').dataset.mark = 'kept';
      const md = document.querySelector('#bot-thread .run-block .bubble.from-bot .md');
      getSelection().selectAllChildren(md);
    });
    // Ten steps, as the feed's run_steps lands them.
    for (let n = 2; n <= 11; n++) {
      await page.evaluate((s) => { const r = state.runs.find((x) => x.id === 'r1'); r.steps = s; renderBotChat(); }, steps(n));
      await sleep(30);
    }
    const seen = await page.evaluate(() => ({
      block: document.querySelector('#bot-thread .run-block')?.dataset.mark,
      line: document.querySelector('#bot-thread details.run-steps.now')?.dataset.mark,
      open: document.querySelector('#bot-thread details.run-steps.now').open,
      rows: document.querySelectorAll('#bot-thread details.run-steps.now .step-row').length,
      count: document.querySelector('#bot-thread details.run-steps.now .step-n')?.textContent,
      label: document.querySelector('#bot-thread details.run-steps.now summary').getAttribute('aria-label'),
      selected: getSelection().toString().length > 0,
      draft: document.querySelector('#bot-thread .draft')?.textContent,
      streams: window.runStreams.map((s) => s.url),
    }));
    assert.deepEqual([seen.block, seen.line], ['kept', 'kept'], 'the chat is not drawn again for a step');
    assert.equal(seen.open, true, 'the open step line stays open');
    assert.equal(seen.rows, 11, 'and grows a row per step');
    assert.equal(seen.count, '11 steps');
    assert.equal(seen.label, '11 steps');
    assert.ok(seen.selected, 'a text selection stays');
    assert.match(seen.draft, /Half a reply/);
    assert.deepEqual(seen.streams, ['/api/runs/r1/stream?simple'], 'one stream, in the simple form, for the whole run');

    // The stream drops and the browser gives up: it comes back 2 s later, and its replay draws the draft.
    await page.evaluate(() => { const s = window.runStreams[0]; s.readyState = 2; s.onerror(); });
    await sleep(2400);
    assert.equal(await page.evaluate(() => window.runStreams.length), 2, 'the stream came back');
    assert.match(await page.locator('#bot-thread .draft').innerText(), /Half a reply/);
    assert.deepEqual(errors, []);
    console.log('run-steps-grow: ok');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
