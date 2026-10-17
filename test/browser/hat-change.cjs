// Optional browser regression: NODE_PATH=<directory containing playwright> node test/browser/hat-change.cjs
// A bot's hat is changed while the web page is open: every place the bot is drawn shows the new hat without
// a reload. The small heads in a chat's folded lines and mentions, in the banner, on a "Needs you" card and
// in a dashboard tile's chat link; the heads of an open run in Activity; the large head of an open empty chat,
// and the one in the chat's header.
// Nothing around them is redrawn: a typed draft, the scroll position and an open folded line stay.
// Uses only scratch data and fake Claude; no Docker, model calls or production server.
//   FIGURE_DIR=<folder>    the scratch folder for the server's data (default: a fresh temporary one)
//   FIGURE_SHOTS=<folder>  also save screenshots there
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, makeBot, heldRun, self, waitFor } = require('../helpers');

const SHOTS = process.env.FIGURE_SHOTS;

(async () => {
  const srv = await startServer({ dir: process.env.FIGURE_DIR });
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const make = (name, color, description, hat) => makeBot(srv, { name, color, description, outfit: { hat } });
    const doctor = await make('Fleet Doctor', '#1d9e75', 'Checks the servers every morning', 'nurse');
    const mail = await make('Mail Keeper', '#ef9f27', 'Keeps an eye on the mail', 'cap');
    const quietBot = await make('News Reader', '#639922', 'Reads the morning news', 'beret'); // never ran: its chat is empty
    // Mail Keeper's chat: a message from Fleet Doctor and its answer (two folded lines), then the owner's
    // messages, one of which mentions Fleet Doctor, and enough of them to scroll.
    const asker = await heldRun(srv, doctor, 'Ask Mail Keeper for its status');
    assert.equal((await self(srv, asker.token, 'message', { to: mail.id, message: 'Your status, please?', priority: true })).data.delivered, 'started');
    const answering = await srv.nextRun((x) => x.args.includes(`${mail.emoji} ${mail.name}`), 'Mail Keeper to start');
    await self(srv, answering.self.env.RUN_TOKEN, 'message', { to: doctor.id, message: 'Three new letters, none urgent.' });
    srv.reply('Told Fleet Doctor.');
    srv.unhold();
    srv.release(answering);
    srv.release(asker.rec);
    await srv.finished(asker.run.id);
    const quiet = () => waitFor(async () => (await srv.api('/runs')).data.every((r) => r.status !== 'running'), { what: 'every run to finish' });
    await quiet();
    srv.reply(Array.from({ length: 12 }, (_, i) => `Line ${i + 1} of a long answer.`).join('\n\n'));
    for (const prompt of ['Ask @FleetDoctor how the servers are', 'And the letters?', 'Anything else?']) {
      await srv.finished((await srv.api(`/bots/${mail.id}/run`, { method: 'POST', body: { prompt } })).data.id);
      await quiet();
    }
    // Something of Fleet Doctor's waits for the owner, and a dashboard tile links to its chat.
    // (Two things wait, so that "Review" opens the Needs you page.)
    for (const [bot, name] of [[doctor, 'Server check'], [mail, 'Mail round']]) {
      assert.equal((await srv.asChief(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name, kind: 'script', cron: '0 7 * * *', script: 'echo ok', assessment: 'No AI needed: a script does it.' } })).status, 201);
    }
    const tile = await srv.asChief('/dashboard/tiles', { method: 'POST', body: { kind: 'custom', title: 'Servers', bot: doctor.id, face: [{ type: 'text', text: 'All up' }, { type: 'chat' }] } });
    assert.equal(tile.status, 201, JSON.stringify(tile.data));

    const { chromium } = require('playwright');
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const context = await browser.newContext({ viewport: { width: 1180, height: 620 }, deviceScaleFactor: 2 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const shot = async (name, target = page) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await target.screenshot({ path: path.join(SHOTS, `${name}.png`) }); } };
    // The hat a head on the page wears, as its shapes; and the shapes of a kit hat, drawn by the page's own renderer.
    const worn = (locator) => locator.evaluateAll((all) => all.map((el) => el.querySelector('.hat')?.innerHTML || ''));
    const shapesOf = (hat) => page.evaluate((h) => {
      const t = document.createElement('div');
      t.innerHTML = window.Figure.small('#000000', { hat: h });
      return t.querySelector('.hat').innerHTML;
    }, hat);
    const dress = async (bot, hat) => assert.equal((await srv.asChief(`/bots/${bot.id}`, { method: 'PUT', body: { outfit: { hat } } })).status, 200);
    // Every head of the place wears the hat, and there are as many as before: checked again and again until so.
    const wears = async (locator, hat, count, what) => {
      const want = await shapesOf(hat);
      let seen;
      await waitFor(async () => { seen = await worn(locator); return seen.length === count && seen.every((h) => h === want); }, { what: `${what} to wear the ${hat}` })
        .catch((e) => { throw new Error(`${e.message}: ${seen?.length} head(s), ${seen?.filter((h) => h === want).length} with it`); });
    };

    // --- An open chat: the folded lines, a mention, and the banner above it.
    await page.goto(`${srv.base}/#bot/${mail.id}`);
    const folds = page.locator('#view-bot details.notes-fold');
    await folds.first().locator('summary svg.fig-small').waitFor();
    const inFolds = page.locator(`#view-bot details.notes-fold > summary svg.fig-small[data-bot="${doctor.id}"]`);
    const inMention = page.locator(`#view-bot .bubble.from-me .mention svg.fig-small[data-bot="${doctor.id}"]`);
    const inBanner = page.locator(`#needs-banner .needs-figs svg.fig-small[data-bot="${doctor.id}"]`);
    await inBanner.waitFor();
    assert.deepEqual([await inFolds.count(), await inMention.count(), await inBanner.count()], [2, 1, 1]);
    await wears(inFolds, 'nurse', 2, 'the folded lines');
    // What must survive: an open fold, a typed draft, where the chat is scrolled to, and the thread itself.
    await folds.first().locator('summary').click();
    assert.equal(await folds.first().evaluate((d) => d.open), true);
    const draft = page.locator('#view-bot form.composer textarea');
    await draft.fill('Half a thought, not sent');
    const thread = page.locator('#bot-thread');
    await thread.evaluate((el) => { el.scrollTop = 40; el.firstElementChild.dataset.kept = 'yes'; });
    const at = await thread.evaluate((el) => el.scrollTop);
    assert.ok(at > 0, 'the chat is long enough to scroll');
    await shot('web-chat-hat-before');

    await dress(doctor, 'crown');
    await wears(inFolds, 'crown', 2, 'the folded lines');
    await wears(inMention, 'crown', 1, 'the mention');
    await wears(inBanner, 'crown', 1, 'the banner');
    assert.equal(await folds.first().evaluate((d) => d.open), true, 'the open fold stays open');
    assert.equal(await draft.inputValue(), 'Half a thought, not sent', 'the draft stays');
    assert.deepEqual(await thread.evaluate((el) => [el.scrollTop, el.firstElementChild.dataset.kept]), [at, 'yes'], 'the chat is not drawn again, and stays where it was scrolled to');
    await shot('web-chat-hat-after');

    // --- An open run in Activity: the head in its header and the one beside its reply.
    const run = (await srv.api(`/runs?botId=${doctor.id}`)).data[0];
    await page.goto(`${srv.base}/#runs/${run.id}`);
    await page.reload();
    const inRun = page.locator(`#run-view .avatar.head[data-bot="${doctor.id}"] svg.fig`);
    await inRun.first().waitFor();
    await wears(inRun, 'crown', 2, 'the open run');
    await dress(doctor, 'party');
    await wears(inRun, 'party', 2, 'the open run');
    await dress(doctor, 'crown');
    await wears(inRun, 'crown', 2, 'the open run');

    // --- The Needs you page: the card names its bot.
    await page.locator('#needs-open').click();
    const onCard = page.locator(`#view-needs .need-card .need-who svg.fig-small[data-bot="${doctor.id}"]`);
    await onCard.waitFor();
    await wears(onCard, 'crown', 1, 'the card');
    await page.locator('#view-needs .need-card').first().evaluate((el) => { el.dataset.kept = 'yes'; });
    await dress(doctor, 'viking');
    await wears(onCard, 'viking', 1, 'the card');
    assert.equal(await page.locator('#view-needs .need-card').first().evaluate((el) => el.dataset.kept), 'yes', 'the card itself is not drawn again');

    // --- The dashboard: a tile's link to its bot's chat.
    await page.goto(`${srv.base}/#dashboard`);
    await page.reload();
    const onTile = page.locator(`#view-dashboard [data-tile-chat] svg.fig-small[data-bot="${doctor.id}"]`);
    await onTile.waitFor();
    await wears(onTile, 'viking', 1, 'the tile');
    await dress(doctor, 'chef');
    await wears(onTile, 'chef', 1, 'the tile');
    await wears(inBanner, 'chef', 1, 'the banner');

    // --- An open empty chat: the large head, and the small one in the header.
    await page.goto(`${srv.base}/#bot/${quietBot.id}`);
    await page.reload();
    const large = page.locator('#view-bot .chat-empty .avatar.lg svg.fig');
    const header = page.locator('#bot-avatar svg.fig');
    await large.waitFor();
    await wears(large, 'beret', 1, 'the large head');
    await draft.fill('A task I am still writing');
    await shot('web-empty-chat-hat-before');
    await dress(quietBot, 'wizard');
    await wears(large, 'wizard', 1, 'the large head');
    await wears(header, 'wizard', 1, 'the head in the header');
    assert.equal(await draft.inputValue(), 'A task I am still writing', 'the draft stays');
    assert.equal(await page.locator('#view-bot .chat-empty [data-run-default]').count(), 0, 'the empty chat has no button that runs the main assignment');
    assert.equal(await page.locator('#view-bot .chat-empty button').count(), 0, 'the empty chat has no button at all');
    await shot('web-empty-chat-hat-after');
    // The hat taken off, and the colour changed: the same heads follow.
    await dress(quietBot, '');
    await waitFor(async () => (await worn(large)).join('') === '' && (await worn(header)).join('') === '', { what: 'the hat to come off' });
    assert.equal((await srv.asChief(`/bots/${quietBot.id}`, { method: 'PUT', body: { color: '#7f77dd' } })).status, 200);
    await waitFor(async () => (await large.evaluate((el) => getComputedStyle(el.querySelector('circle')).fill)) === 'rgb(127, 119, 221)', { what: 'the large head to change colour' });
    assert.equal(await draft.inputValue(), 'A task I am still writing');

    assert.deepEqual(errors, []);
    console.log('PASS: a changed hat shows without a reload in the folded lines, a mention, the banner, a Needs you card, a tile\'s chat link, an open run, the large head of an empty chat and the chat header; an open fold, a draft and the scroll position stay; no browser errors.');
  } finally {
    if (browser) await browser.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
