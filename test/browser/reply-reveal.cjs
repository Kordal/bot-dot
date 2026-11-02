// Optional browser check of the paced reveal of a reply draft (#861, ADR 042 "The paced reveal"):
//   NODE_PATH=<directory containing playwright> node test/browser/reply-reveal.cjs
// It runs in no gate: the repository does not carry Playwright. A running run's stream sends a growing draft every
// 200 ms, as the server does; the bubble's text grows in many small steps between two drafts, not in one, never
// shows an open ** or [, keeps its first block in the page while the last one grows, goes at once when a tool call
// clears it, and is drawn whole as it comes with reduced motion. The run stream is stood in for in the page.
// Scratch data and fake Claude only.
//   REPLY_REVEAL_SHOTS=<folder>  also save screenshots there
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot } = require('../helpers');

const SHOTS = process.env.REPLY_REVEAL_SHOTS;
const t = (m) => new Date(Date.UTC(2026, 10, 2, 9, m)).toISOString();
const REPLY = '## Disks\n\nThe disk on staging has **41% free**, and the backups take 212 GB of the 500 GB disk. See [the log](https://example.com/log) for each night.';

// In the page: an EventSource for the running run's stream that sends REPLY as drafts every 200 ms, about 60
// characters each time, then (window.clearDraft()) a draft cleared by a tool call.
function fakeStream(reply) {
  const Real = window.EventSource;
  window.EventSource = class {
    constructor(url) {
      if (!/\/api\/runs\/r1\/stream/.test(url)) return new Real(url);
      this.url = url;
      const send = (ev) => this.onmessage?.({ data: JSON.stringify(ev) });
      let at = 0;
      const timer = setInterval(() => {
        at = Math.min(reply.length, at + 60);
        send({ type: 'reply_draft', text: reply.slice(0, at) });
        if (at === reply.length) clearInterval(timer);
      }, 200);
      window.clearDraft = () => send({ type: 'reply_draft', text: '' });
    }
    close() {}
  };
}

(async () => {
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const bot = await makeBot(srv, { name: 'Fleet Doctor', color: '#c2473d', description: 'Looks after the servers' });
    const runs = [{ id: 'r1', botId: bot.id, botName: 'Fleet Doctor', status: 'running', trigger: 'manual', prompt: 'How much room is on staging?', customPrompt: true, startedAt: t(0), openingLine: 'Checking the disk', steps: { count: 1, rows: [] } }];
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const errors = [];
    for (const motion of ['no-preference', 'reduce']) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 860 }, reducedMotion: motion });
      await context.addInitScript(fakeStream, REPLY);
      await context.route((url) => url.pathname === '/api/runs', (r) => r.fulfill({ json: runs }));
      await context.route((url) => url.pathname === '/api/features', async (r) => {
        const res = await r.fetch();
        const body = await res.json();
        const list = Array.isArray(body) ? body : body.features;
        if (!list.includes('reply-draft')) list.push('reply-draft');
        return r.fulfill({ response: res, json: body });
      });
      const page = await context.newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${srv.base}/#bot/${bot.id}`);
      await page.reload();
      await page.locator('#bot-thread .draft .md').waitFor();
      // Every frame's text of the bubble, until the whole reply is shown, and whether its heading stayed the same node.
      const seen = await page.evaluate(() => new Promise((done) => {
        const out = { texts: [], sameHead: true, start: performance.now() };
        let head = null;
        const look = () => {
          const md = document.querySelector('#bot-thread .draft .md');
          const text = md ? md.textContent : '';
          if (text !== out.texts.at(-1)) out.texts.push(text);
          const h = md?.querySelector('h2');
          if (h && head && h !== head && md.querySelector('p')) out.sameHead = false;
          if (h && md.querySelector('p')) head = h;
          if (/each night\.$/.test(text) || performance.now() - out.start > 8000) { out.ms = performance.now() - out.start; return done(out); }
          requestAnimationFrame(look);
        };
        requestAnimationFrame(look);
      }));
      const drafts = Math.ceil(REPLY.length / 60);
      if (motion === 'reduce') {
        assert.ok(seen.texts.length <= drafts + 1, `reduced motion: drawn as it comes (${seen.texts.length} steps for ${drafts} drafts)`);
      } else {
        assert.ok(seen.texts.length > drafts * 4, `many small steps between two drafts (${seen.texts.length} for ${drafts} drafts)`);
        assert.ok(seen.sameHead, 'the heading stays in the page while the paragraph grows');
      }
      assert.match(seen.texts.at(-1), /each night\.$/, 'the whole reply in the end');
      assert.ok(seen.texts.every((x) => !/\*\*|\[|\]\(/.test(x)), `no open mark shown: ${seen.texts.find((x) => /\*\*|\[|\]\(/.test(x))}`);
      if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `reveal-${motion}.png`) }); }
      assert.equal(await page.locator('#bot-thread .draft strong').innerText(), '41% free');
      assert.equal(await page.locator('#bot-thread .draft a').getAttribute('href'), 'https://example.com/log');
      await page.evaluate(() => window.clearDraft());
      await page.waitForFunction(() => !document.querySelector('#bot-thread .draft'), null, { timeout: 500 });
      await context.close();
    }
    assert.deepEqual(errors, []);
    console.log('ok: a reply draft is revealed at a steady pace');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
