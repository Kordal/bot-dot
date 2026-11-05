// Optional browser check of a table in a reply: NODE_PATH=<directory containing playwright> node test/browser/chat-table.cjs
// A table with a short first column and a long last one, in a chat as narrow as the desktop app's and on a phone: no
// word is broken inside, a column of numbers lines up on the right, and a table wider than the chat scrolls in its own
// box instead of widening the page. Scratch data and the stand-in Claude only. SHOTS=<dir> keeps screenshots.
const assert = require('node:assert/strict');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot } = require('../helpers');

const REPLY = `Here they are:

| Usługa | Ile | Zmienne |
|---|---|---|
| Stripe | 9 | STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY, 6× NEXT_PUBLIC_STRIPE_PRICE_* (STARTER/GROWTH/PRO, MONTHLY/ANNUAL) |
| Resend | 2 | RESEND_API_KEY, RESEND_FROM_EMAIL |
| Supabase | 2 | NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY |
| Turnstile | 2 | NEXT_PUBLIC_TURNSTILE_SITE_KEY, TURNSTILE_SECRET_KEY |
| Langfuse | 2 | LANGFUSE_PUBLIC_KEY, LANGFUSE_SECRET_KEY |

Done.`;

// Each cell's words, and whether any of them is drawn over more than one line.
const brokenWords = (table) => table.evaluate((t) => {
  const out = [];
  for (const cell of t.querySelectorAll('th, td')) {
    const walker = document.createTreeWalker(cell, NodeFilter.SHOW_TEXT);
    for (let n; (n = walker.nextNode());) {
      for (const m of n.data.matchAll(/\S+/g)) {
        const r = document.createRange();
        r.setStart(n, m.index); r.setEnd(n, m.index + m[0].length);
        const tops = new Set([...r.getClientRects()].map((x) => Math.round(x.top)));
        if (tops.size > 1) out.push(m[0]);
      }
    }
  }
  return out;
});

(async () => {
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const bot = await makeBot(srv, { name: 'Tabler' });
    srv.reply(REPLY);
    const run = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Which keys?' } })).data;
    await srv.finished(run.id);
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });

    for (const [name, viewport] of [['wide', { width: 1280, height: 900 }], ['narrow', { width: 760, height: 900 }], ['phone', { width: 390, height: 800 }]]) {
      const page = await (await browser.newContext({ viewport, deviceScaleFactor: 2 })).newPage();
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(`${srv.base}/#bot/${bot.id}`);
      const reply = page.locator('#bot-thread .bubble .md', { hasText: 'Here they are' }).last();
      await reply.waitFor({ timeout: 20000 });
      const box = reply.locator('.md-table');
      const table = box.locator('table');
      assert.equal(await table.count(), 1, name);

      assert.deepEqual(await brokenWords(table), [], `${name}: no word is broken inside`);
      assert.equal(await table.locator('th').nth(1).evaluate((c) => getComputedStyle(c).textAlign), 'right', `${name}: the numbers' header on the right`);
      assert.equal(await table.locator('td').nth(1).evaluate((c) => getComputedStyle(c).textAlign), 'right', `${name}: the numbers on the right`);
      assert.equal(await table.locator('td').first().evaluate((c) => getComputedStyle(c).textAlign), 'left', `${name}: words on the left`);
      // Never wider than the reply: what doesn't fit scrolls inside the box.
      const [b, r] = [await box.boundingBox(), await reply.boundingBox()];
      assert.ok(b.width <= r.width + 1, `${name}: the box fits the reply`);
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `${name}: the page doesn't scroll sideways`);
      if (name === 'phone') assert.ok(await box.evaluate((e) => e.scrollWidth > e.clientWidth), 'phone: the table scrolls in its box');
      if (process.env.SHOTS) await reply.screenshot({ path: path.join(process.env.SHOTS, `table-${name}.png`) });
      assert.deepEqual(errors, [], name);
    }
    console.log('chat-table: ok');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
