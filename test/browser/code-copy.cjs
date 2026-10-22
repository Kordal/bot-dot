// Optional browser check of Copy on code blocks (#285): NODE_PATH=<directory containing playwright> node test/browser/code-copy.cjs
// A bot's reply in a real page: each fenced block has Copy in its corner, which puts the block's text as written on the
// clipboard (with < & and quotes, no newline added) and shows a check for a moment; a diagram's block copies its
// source; an inline code has none; with a mouse the button shows on hover and on a keyboard's focus. Scratch data and the stand-in Claude only.
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { startServer, makeBot } = require('../helpers');

const CODE = `echo "<a href='x'>" && cat a.txt > b.txt && echo ${'a very long line that is wider than the bubble '.repeat(4)}`;
const FLOW = 'flowchart LR\n  A[Ask] --> B[Reply]';
const REPLY = `Run \`npm test\` first, then:\n\n\`\`\`sh\n${CODE}\n\`\`\`\n\nAnd the picture:\n\n\`\`\`mermaid\n${FLOW}\n\`\`\`\nDone.`;

(async () => {
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const bot = await makeBot(srv, { name: 'Copier' });
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: srv.base });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));

    srv.reply(REPLY);
    const run = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Show me' } })).data;
    await srv.finished(run.id);
    await page.goto(`${srv.base}/#bot/${bot.id}`);
    const reply = page.locator('#bot-thread .bubble .md', { hasText: 'Run' }).last();
    await reply.locator('.diagram').waitFor({ timeout: 20000 });

    assert.equal(await reply.locator('.code-block').count(), 2);
    assert.equal(await reply.locator('p .code-copy, p button').count(), 0, 'an inline code has no Copy');
    const block = reply.locator('.code-block').first();
    const btn = block.locator('.code-copy');
    assert.equal(await btn.getAttribute('aria-label'), 'Copy code');

    // With a mouse: out of sight until the block is hovered.
    assert.equal(await btn.evaluate((b) => getComputedStyle(b).opacity), '0');
    await block.hover();
    assert.equal(await btn.evaluate((b) => getComputedStyle(b).opacity), '1');
    // Its corner: top right of the block.
    const [box, b] = [await block.boundingBox(), await btn.boundingBox()];
    assert.ok(b.x + b.width <= box.x + box.width && b.x + b.width > box.x + box.width - 20 && b.y - box.y < 20, 'top right');
    // The code scrolls beside it, so a long line is never under it.
    const pre = await block.locator('pre').boundingBox();
    assert.ok(pre.x + pre.width <= b.x, 'the code ends left of the button');
    // A diagram's block: the drawing beside it too.
    const pic = await reply.locator('.diagram-svg').boundingBox(), db = await reply.locator('.code-block').nth(1).locator('.code-copy').boundingBox();
    assert.ok(pic.x + pic.width <= db.x, 'the drawing ends left of the button');

    await btn.click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), CODE, 'the text as written');
    assert.match(await btn.innerHTML(), /M5 12\.5l4\.5 4\.5L19 7\.5/, 'a check');
    await page.waitForTimeout(1700);
    assert.match(await btn.innerHTML(), /<rect/, 'the copy icon again');

    // The diagram's block: its Copy copies the source, the drawing shown.
    const drawn = reply.locator('.code-block').nth(1);
    await drawn.hover();
    await drawn.locator('.code-copy').click();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), FLOW, 'the diagram\'s source');

    // A keyboard reaches it, and its focus shows it.
    await page.mouse.move(0, 0);
    await btn.focus();
    await page.keyboard.press('Shift+Tab');
    await page.keyboard.press('Tab');
    assert.equal(await btn.evaluate((x) => document.activeElement === x), true);
    assert.equal(await btn.evaluate((x) => getComputedStyle(x).opacity), '1', 'shown on a keyboard\'s focus');
    await page.evaluate(() => navigator.clipboard.writeText(''));
    await page.keyboard.press('Enter');
    await page.waitForTimeout(100);
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), CODE, 'Enter copies too');

    // A touch screen: always in sight.
    const phone = await browser.newContext({ viewport: { width: 390, height: 800 }, hasTouch: true, isMobile: true });
    const tp = await phone.newPage();
    await tp.goto(`${srv.base}/#bot/${bot.id}`);
    const pb = tp.locator('#bot-thread .bubble .md .code-block .code-copy').first();
    await pb.waitFor();
    assert.equal(await pb.evaluate((x) => getComputedStyle(x).opacity), '1', 'in sight on a phone');

    assert.deepEqual(errors, []);
    console.log('code copy check passed');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
