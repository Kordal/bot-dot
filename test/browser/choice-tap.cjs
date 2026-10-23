// Optional browser check of a tapped answer button (#495), against the real page and server:
//   NODE_PATH=<directory containing playwright> node test/browser/choice-tap.cjs
// A bot's reply asks with answer buttons. A tap shows the owner's message and "Working" at once and the buttons go;
// they stay gone while the bot list is slow to say the question was answered (the chat is drawn again from the
// answer before that), so there is nothing to tap twice and the bot gets one message. A send that fails brings the
// buttons back, and tapped again it is the same message: botdot takes it once.
// Scratch data and fake Claude only. BROKER=1 runs the server under the privilege broker (root only), as hq does.
const assert = require('node:assert/strict');
const { execSync } = require('node:child_process');
const { chromium } = require('playwright');
const { startServer, makeBot, seedRuns } = require('../helpers');

const broker = !!process.env.BROKER;
const ANSWER = 'Yes, merge #241';

(async () => {
  let srv = await startServer({ broker });
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const bot = await makeBot(srv, { name: 'Quotz' });
    await srv.stop();
    seedRuns(srv, bot, [{ prompt: 'Merge?', result: 'Merge #241 into staging?', choices: [ANSWER, 'No'] }]);
    if (broker) execSync(`chown -R 60000:60000 ${srv.data}/runs`);
    srv = await startServer({ dir: srv.dir, broker });
    srv.hold(); // the run it starts stays at work
    const runs = async () => (await srv.api(`/runs?botId=${bot.id}`)).data.filter((r) => r.prompt === ANSWER);

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${srv.base}/#bot/${bot.id}`);
    const buttons = page.locator('#bot-thread .choices:visible [data-choice]');
    await buttons.first().waitFor();

    // The send fails: the buttons come back, ready to tap again.
    await page.route('**/api/bots/*/run', (r) => r.abort('connectionrefused'));
    await buttons.first().click();
    await page.locator('#view-bot .send-note').waitFor();
    assert.equal(await buttons.count(), 2, 'back after a failed send');
    assert.equal(await page.locator('#bot-thread [data-choice]:disabled').count(), 0, 'and usable');
    await page.unroute('**/api/bots/*/run');

    // The bot list is slow to say the question was answered, as on a busy server.
    await page.route('**/api/bots', async (r) => { await new Promise((ok) => setTimeout(ok, 4000)); r.continue().catch(() => {}); });
    await buttons.first().click();
    await page.waitForTimeout(150);
    assert.equal(await buttons.count(), 0, 'the buttons go at the tap');
    assert.ok((await page.locator('#bot-thread .bubble.from-me').allInnerTexts()).includes(ANSWER), 'the message shows');
    assert.match(await page.locator('#bot-thread .status-line').innerText(), /Working/);
    await page.waitForTimeout(1000); // the answer is in and the chat drawn again, the bot list not read yet
    assert.equal(await buttons.count(), 0, 'and they do not come back before the bot list says it');
    await page.waitForTimeout(4000);
    assert.equal(await buttons.count(), 0, 'nor after');
    assert.equal((await runs()).length, 1, 'one run');
    assert.deepEqual(errors, []);
    console.log('choice-tap: ok');
  } finally {
    await browser?.close();
    srv.unhold?.();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
