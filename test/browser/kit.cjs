// Optional browser check of the kit: NODE_PATH=<directory containing playwright> node test/browser/kit.cjs
// Every hat of the figure definition's kit, each on a bot of its own in the list at phone width, light
// and dark: the sheets the hats are judged from. Scratch data only.
//   KIT_SHOTS=<folder>  save the sheets there
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, waitFor } = require('../helpers');
const { KIT } = require('../../lib/pieces');

const SHOTS = process.env.KIT_SHOTS;
const PAGE = 11; // bots on one sheet
const COLORS = ['#1d9e75', '#378add', '#7f77dd', '#d4537e', '#e24b4a', '#ef9f27', '#639922', '#888780'];

(async () => {
  const srv = await startServer({ dir: process.env.KIT_DIR });
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const hats = Object.entries(KIT.hat.pieces);
    const bots = [];
    // Each bot wears one hat and is named after it.
    for (const [i, [name, piece]] of hats.entries()) bots.push(await makeBot(srv, { name, description: piece.means.split(': ')[0], color: COLORS[i % COLORS.length], outfit: { hat: name } }));
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const errors = [];
    for (const scheme of ['light', 'dark']) {
      const context = await browser.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, colorScheme: scheme, reducedMotion: 'reduce' });
      const page = await context.newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      await page.goto(srv.base);
      await page.locator('#contacts [data-contact="chief"] svg.fig .hat').first().waitFor();
      for (const [i, bot] of bots.entries()) {
        // Every shape of the bot's hat is on the page and has a size (asked again while the list is being drawn).
        const shapes = hats[i][1].shapes.length;
        let drawn;
        await waitFor(async () => {
          // Looked at in one go inside the page: the list may be drawn again at any moment.
          drawn = await page.evaluate((id) => {
            const av = document.querySelector(`#contacts [data-contact="${id}"] .avatar`);
            const hat = av?.querySelector('.hat');
            if (!hat) return null;
            return { sized: [...hat.children].map((el) => { const r = el.getBoundingClientRect(); return r.width > 0 || r.height > 0; }), wide: hat.getBoundingClientRect().width / av.getBoundingClientRect().width };
          }, bot.id);
          return drawn && drawn.sized.length === shapes && drawn.sized.every(Boolean) && Number.isFinite(drawn.wide);
        }, { what: `bot ${i + 1} to wear its hat` }).catch((e) => { throw new Error(`${e.message}: ${JSON.stringify(drawn)}, wanted ${shapes}`); });
        // A hat is big enough to be seen in the list: at least a third of the avatar's width.
        assert.ok(drawn.wide >= 0.33, `${hats[i][0]} is ${Math.round(drawn.wide * 100)}% of the avatar's width`);
      }
      // One sheet per PAGE bots, so each can be read at its real size; the other bots are hidden for it.
      for (let from = 0, n = 1; SHOTS && from < bots.length; from += PAGE, n++) {
        const hidden = bots.filter((b, i) => i < from || i >= from + PAGE);
        const style = await page.addStyleTag({ content: `${hidden.map((b) => `#contacts [data-contact="${b.id}"]`).join(', ')} { display: none; }` });
        await page.setViewportSize({ width: 390, height: 200 + 62 * (Math.min(bots.length, from + PAGE) - from + 1) });
        fs.mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: path.join(SHOTS, `hats-${scheme}-${n}.png`) });
        await style.evaluate((el) => el.remove());
      }
      await context.close();
    }
    assert.deepEqual(errors, []);
    console.log(`PASS: ${hats.length} hats drawn in the phone list, light and dark, each on a head of its own; no browser errors.`);
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
