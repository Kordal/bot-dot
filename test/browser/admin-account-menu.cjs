// Optional browser check of the admin page's account card (#725): NODE_PATH=<directory containing playwright> node test/browser/admin-account-menu.cjs
// The admin page and its script as the front door serves them, with stand-in answers for its routes. Each card shows
// "Change share" and ⋯; ⋯ opens a menu under it, the arrows move in it, Escape closes it and gives the focus back,
// a click outside closes it; Delete opens the box with the red button. At 1440px and on a phone (390px) the card has
// no horizontal overflow and the menu stays in the window. SHOTS=<folder> keeps a picture of each.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const pages = require('../../lib/front-door/pages');

const HOUR = 3600_000;
const now = Date.now();
const iso = (ago) => new Date(now - ago).toISOString();
const ACCOUNTS = [
  { name: 'ann', admin: true, state: 'running', created: iso(11 * 24 * HOUR), lastSeen: iso(2 * HOUR), share: { cpu: 2, ram: 5, disk: 40 }, ownShare: false,
    use: { cpu: 1.1, ram: 2.5e9, diskUsed: 16e9, diskSize: 40e9, computers: 1 }, update: { autoUpdate: true } },
  { name: 'bob', state: 'running', created: iso(3 * 24 * HOUR), lastSeen: iso(5 * 60_000), share: { cpu: 1, ram: 3, disk: 20 }, ownShare: true,
    use: { cpu: 0.2, ram: 1e9, diskUsed: 2e9, diskSize: 20e9, computers: 0 }, update: { autoUpdate: true } },
  { name: 'cat', state: 'suspended', created: iso(HOUR), share: { cpu: 2, ram: 5, disk: 30 }, ownShare: false, use: null },
];
const ANSWERS = {
  '/admin/accounts': { accounts: ACCOUNTS }, '/admin/links': { links: [] }, '/admin/share': { share: { cpu: 2, ram: 5, disk: 30 }, machine: null },
  '/admin/update': { update: {} }, '/admin/feedback': { reports: [] }, '/admin/usage': { usage: null }, '/admin/rooms': { on: false },
  '/admin/group-router': {}, '/admin/replays': {}, '/admin/boat': {},
};

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
  try {
    for (const [width, height, tag] of [[1440, 900, 'wide'], [390, 844, 'phone']]) {
      const page = await browser.newPage({ viewport: { width, height } });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      await page.route('http://admin.test/**', (route) => {
        const p = new URL(route.request().url()).pathname;
        if (p === '/admin') return route.fulfill({ contentType: 'text/html', body: pages.admin() });
        if (p === '/front-door/admin.js') return route.fulfill({ contentType: 'text/javascript', body: pages.ADMIN_SCRIPT });
        if (p.startsWith('/front-door/fonts/')) return route.fulfill({ contentType: 'font/ttf', body: fs.readFileSync(path.join(__dirname, '../../public/fonts', path.basename(p))) });
        return route.fulfill({ contentType: 'application/json', body: JSON.stringify(ANSWERS[p] || {}) });
      });
      await page.goto('http://admin.test/admin');
      await page.waitForSelector('#account-list .card');
      const shot = async (name) => {
        if (!process.env.SHOTS) return;
        // The accounts on a wide window, bob's card on a phone, with room under it for the menu.
        const b = await page.locator(tag === 'wide' ? '#accounts' : '#account-list .card:nth-child(2)').boundingBox();
        const y = b.y + await page.evaluate(() => scrollY) - 16;
        await page.screenshot({ path: path.join(process.env.SHOTS, `${tag}-${name}.png`), fullPage: true, clip: { x: 0, y, width, height: b.height + 200 } });
      };
      const bob = page.locator('#account-list .card').nth(1);
      assert.deepEqual(await bob.locator('.acts > .btn, .acts .more > .btn').allInnerTexts(), ['Change share', '⋯']);
      assert.equal(await page.locator('.pill').count(), 0, 'no pill on the cards');
      assert.match(await bob.locator('.meta').innerText(), /^Joined \S+ \d+ · seen 5 min ago$/);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      assert.ok(overflow <= 0, `no horizontal scroll (${overflow}px)`);
      await shot('cards');

      const more = bob.getByRole('button', { name: 'More for bob' });
      await more.focus();
      await page.keyboard.press('Enter');
      const menu = bob.getByRole('menu');
      await menu.waitFor();
      assert.deepEqual(await menu.getByRole('menuitem').allInnerTexts(), ['Suspend', 'New sign-in link', 'Delete']);
      assert.equal(await page.evaluate(() => document.activeElement.textContent), 'Suspend');
      await page.keyboard.press('ArrowDown');
      assert.equal(await page.evaluate(() => document.activeElement.textContent), 'New sign-in link');
      const box = await menu.boundingBox();
      assert.ok(box.x >= 0 && box.x + box.width <= width, 'the menu stays in the window');
      assert.equal(await menu.getByRole('menuitem', { name: 'Delete' }).evaluate((b) => getComputedStyle(b).color), await page.evaluate(() => getComputedStyle(document.body).color), 'Delete is plain in the menu');
      await shot('menu');
      await page.keyboard.press('Escape');
      assert.equal(await menu.count(), 0, 'Escape closes it');
      assert.equal(await page.evaluate(() => document.activeElement.getAttribute('aria-label')), 'More for bob');

      await more.click();
      await page.mouse.click(5, height - 5);
      assert.equal(await bob.getByRole('menu').count(), 0, 'a click outside closes it');

      await more.click();
      await bob.getByRole('menuitem', { name: 'Delete' }).click();
      const del = bob.locator('.confirm').getByRole('button', { name: 'Delete bob' });
      await del.waitFor();
      assert.notEqual(await del.evaluate((b) => getComputedStyle(b).color), await page.evaluate(() => getComputedStyle(document.body).color), 'red in its box');
      await shot('delete');
      assert.deepEqual(errors, []);
      await page.close();
    }
    console.log('OK  the admin account card: one action, the ⋯ menu by mouse and keyboard, Delete red only in its box, wide and phone');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exit(1); });
