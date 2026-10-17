// Optional browser regression: NODE_PATH=<directory containing playwright> node test/browser/small-figure.cjs
// Wherever a small dot stood for a bot on the web page (beside its name in running text, one per thing
// that waits in "Needs you") there is a small still head in the bot's colour, with its hat and without
// eyes, and no dot.
// Uses only scratch data and fake Claude; no Docker, model calls or production server.
//   FIGURE_DIR=<folder>    the scratch folder for the server's data (default: a fresh temporary one)
//   FIGURE_SHOTS=<folder>  also save screenshots there
//   FIGURE_KEEP=1          make the bots, chats and waiting things, print the server's address and keep it
//                          running (no browser): for looking at the same data in the Android and Mac apps
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, makeBot, heldRun, self, waitFor } = require('../helpers');

const SHOTS = process.env.FIGURE_SHOTS;
const PHONE = { width: 390, height: 844 };
const CHIEF = '#d85a30';

(async () => {
  const srv = await startServer({ dir: process.env.FIGURE_DIR });
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const make = (name, color, description, hat) => makeBot(srv, { name, color, description, outfit: { hat } });
    const bots = {
      doctor: await make('Fleet Doctor', '#1d9e75', 'Checks the servers every morning', 'nurse'),
      mail: await make('Mail Keeper', '#ef9f27', 'Keeps an eye on the mail', 'cap'),
      todo: await make('Todo Keeper', '#d4537e', 'Keeps the to-do list in order', 'bow'),
      news: await make('News Reader', '#639922', 'Reads the morning news', ''),
      coder: await make('Coder', '#7f77dd', 'Writes and fixes code', 'headphones'),
    };
    // Mail Keeper's chat: a message from Fleet Doctor and its answer, a task from the Chief and its answer
    // (all four folded), and the owner's own message that mentions a bot.
    const asker = await heldRun(srv, bots.doctor, 'Ask Mail Keeper for its status');
    assert.equal((await self(srv, asker.token, 'message', { to: bots.mail.id, message: 'Your status, please?', priority: true })).data.delivered, 'started');
    const answering = await srv.nextRun((x) => x.args.includes(`${bots.mail.emoji} ${bots.mail.name}`), 'Mail Keeper to start');
    await self(srv, answering.self.env.RUN_TOKEN, 'message', { to: bots.doctor.id, message: 'Three new letters, none urgent.' });
    srv.reply('Told Fleet Doctor.');
    srv.unhold();
    srv.release(answering);
    srv.release(asker.rec);
    await srv.finished(asker.run.id);
    const mailRuns = async () => (await srv.api(`/runs?botId=${bots.mail.id}`)).data;
    await waitFor(async () => { const all = await mailRuns(); return all.length === 1 && all.every((r) => r.status !== 'running'); }, { what: "Mail Keeper's answer to Fleet Doctor" });
    const quiet = () => waitFor(async () => (await srv.api('/runs')).data.every((r) => r.status !== 'running'), { what: 'every run to finish' });
    await quiet();
    srv.reply('Sorted: two bills and a letter from school.');
    await srv.finished((await srv.asChief(`/bots/${bots.mail.id}/run`, { method: 'POST', body: { prompt: 'Sort today’s mail.' } })).data.id);
    await quiet();
    srv.reply('Fleet Doctor says all servers are up.');
    await srv.finished((await srv.api(`/bots/${bots.mail.id}/run`, { method: 'POST', body: { prompt: 'Ask @FleetDoctor how the servers are' } })).data.id);
    await quiet();
    // "Needs you": four things wait, of four bots (script jobs the Chief added, and a permission a bot asks for).
    const job = (bot, name) => srv.asChief(`/bots/${bot.id}/jobs`, { method: 'POST', body: { name, kind: 'script', cron: '0 7 * * *', script: 'echo sorted', assessment: 'No AI needed: a script does it.' } });
    for (const [bot, name] of [[bots.todo, 'Morning list'], [bots.mail, 'Mail round'], [bots.doctor, 'Server check']]) assert.equal((await job(bot, name)).status, 201);
    const asking = await heldRun(srv, bots.news, 'Read the news');
    assert.equal((await self(srv, asking.token, 'ask', { kind: 'permission', permission: 'web', reason: 'To open the news sites' })).data.ok, true);
    srv.unhold();
    srv.release(asking.rec);
    await srv.finished(asking.run.id);
    const waiting = [bots.todo, bots.mail, bots.doctor, bots.news].map((b) => b.color).sort();

    if (process.env.FIGURE_KEEP) {
      console.log(JSON.stringify({ base: srv.base, pid: srv.pid, dir: srv.dir, bots: Object.fromEntries(Object.entries(bots).map(([k, b]) => [k, b.id])) }));
      await srv.exited;
      return;
    }

    const { chromium } = require('playwright');
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const context = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 3 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const shot = async (name, target = page) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await target.screenshot({ path: path.join(SHOTS, `${name}.png`) }); } };
    const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
    const noDots = async (where) => assert.equal(await page.locator('.name-dot, .needs-dots').count(), 0, `no dot for a bot ${where}`);
    // What a small head looks like on screen: its colour, how tall it is, its hat, that it has no eyes and doesn't move.
    const look = (locator) => locator.evaluate((el) => {
      const head = el.querySelector(':scope > circle');
      return {
        cls: el.getAttribute('class'), head: getComputedStyle(head).fill, behind: getComputedStyle(el).backgroundColor,
        height: el.getBoundingClientRect().height, across: head.getBoundingClientRect().width,
        hats: el.querySelectorAll(':scope > .hat').length, hatWide: el.querySelector('.hat')?.getBoundingClientRect().width || 0,
        eyes: el.querySelectorAll('.l-eyes, .f-white, .f-ink').length, moving: el.getAnimations({ subtree: true }).length,
      };
    });
    const small = (drawn, color, hat, what) => {
      assert.equal(drawn.cls, 'fig fig-small', what);
      assert.equal(drawn.head, rgb(color), `${what}: its head is in its colour`);
      assert.equal(drawn.hats, hat ? 1 : 0, `${what}: ${hat ? 'its hat' : 'no hat'}`);
      assert.equal(drawn.eyes, 0, `${what}: no eyes`);
      assert.equal(drawn.moving, 0, `${what}: it is still`);
      assert.ok(drawn.height >= 16 && drawn.across >= 10, `${what}: large enough to show its colour (${drawn.height.toFixed(1)}px tall, the head ${drawn.across.toFixed(1)}px across)`);
      if (hat) assert.ok(drawn.hatWide >= 6, `${what}: a hat one can see (${drawn.hatWide.toFixed(1)}px wide)`);
    };
    const waitingBots = [bots.todo, bots.mail, bots.doctor, bots.news];
    const hatOf = (bot) => bot.outfit.hat;

    // The banner over every page: one small head per thing that waits, in its bot's colour and hat, hopping. No number in words.
    await page.goto(`${srv.base}/#chief`);
    await page.locator('#needs-banner .needs-figs svg.fig-small').first().waitFor();
    const banner = page.locator('#needs-banner .needs-figs > i');
    assert.equal(await banner.count(), 4, 'one figure per thing that waits');
    const colours = [];
    for (let i = 0; i < 4; i++) {
      const drawn = await look(banner.nth(i).locator('svg'));
      colours.push(drawn.head);
      const bot = waitingBots.find((b) => rgb(b.color) === drawn.head);
      small(drawn, bot?.color, bot && hatOf(bot), `waiting thing ${i + 1}`);
    }
    assert.deepEqual(colours.sort(), waiting.map(rgb).sort(), 'each in the colour of its bot');
    assert.equal((await page.locator('#needs-banner').innerText()).replace(/\s+/g, ' ').trim(), 'Waiting for your OK Review', 'the words do not repeat the number');
    const hopping = () => banner.evaluateAll((all) => all.filter((el) => el.getAnimations().some((a) => a.playState === 'running')).length);
    assert.equal(await hopping(), 4, 'each hops');
    await noDots("in the Chief's chat");
    await shot('web-needs-banner-phone');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    assert.equal(await hopping(), 0, 'with reduced motion they stand still');
    assert.equal(await banner.count(), 4);
    await page.emulateMedia({ reducedMotion: 'no-preference' });

    // Mail Keeper's chat: the folded lines keep their fold, and each bot named in them has its small head.
    await page.goto(`${srv.base}/#bot/${bots.mail.id}`);
    await page.reload();
    await page.locator('#view-bot details.notes-fold > summary svg.fig-small').first().waitFor();
    const folds = page.locator('#view-bot details.notes-fold');
    assert.equal(await folds.evaluateAll((all) => all.filter((d) => d.open).length), 0, 'every fold is closed');
    const lines = (await page.locator('#view-bot details.notes-fold > summary, #view-bot .bot-msg-label').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').trim());
    assert.deepEqual(lines, ['Message from Fleet Doctor', 'Replied to Fleet Doctor', '', 'Message from Chief of Staff', 'Replied to Chief of Staff'], 'the folded lines say what they said, and what is inside a fold is not shown');
    const marks = page.locator('#view-bot details.notes-fold > summary svg.fig-small, #view-bot .bot-msg-label svg.fig-small');
    assert.equal(await marks.count(), 5, 'one head per bot named');
    small(await look(marks.nth(0)), bots.doctor.color, 'nurse', 'Message from Fleet Doctor');
    small(await look(marks.nth(1)), bots.doctor.color, 'nurse', 'Replied to Fleet Doctor');
    small(await look(marks.nth(3)), CHIEF, 'top-hat', 'Message from Chief of Staff');
    small(await look(marks.nth(4)), CHIEF, 'top-hat', 'Replied to Chief of Staff');
    // The owner's own message: the bot it mentions.
    small(await look(page.locator('#view-bot .bubble.from-me .mention svg.fig-small')), bots.doctor.color, 'nurse', 'a mention in your own message');
    await noDots('in a chat');
    await shot('web-chat-folds-phone');
    await page.emulateMedia({ colorScheme: 'dark' });
    small(await look(marks.nth(0)), bots.doctor.color, 'nurse', 'on a dark page');
    await shot('web-chat-folds-phone-dark');
    await page.goto(`${srv.base}/#chief`);
    await page.reload();
    await page.locator('#needs-banner .needs-figs svg.fig-small').first().waitFor();
    await shot('web-needs-banner-phone-dark');
    await page.emulateMedia({ colorScheme: 'light' });

    // The Needs you page: each card names its bot, with its small head.
    await page.locator('#needs-open').click();
    await page.locator('#view-needs svg.fig-small').first().waitFor();
    assert.ok(await page.locator('#view-needs svg.fig-small').count() >= 4);
    await noDots('on the Needs you page');
    await shot('web-needs-page-phone');

    // A wide window: the banner over the chat.
    await page.setViewportSize({ width: 1180, height: 820 });
    await page.goto(`${srv.base}/#bot/${bots.mail.id}`);
    await page.reload();
    await marks.first().waitFor();
    await page.locator('#needs-banner .needs-figs svg.fig-small').first().waitFor();
    await shot('web-desktop-chat-and-banner');
    await page.emulateMedia({ colorScheme: 'dark' });
    await shot('web-desktop-chat-and-banner-dark');
    await page.emulateMedia({ colorScheme: 'light' });

    // No definition from the server: the small head is the bare one built in, and nothing is a dot.
    await page.setViewportSize(PHONE);
    await page.route('**/api/figure', (route) => route.fulfill({ status: 500, json: { error: 'no figure' } }));
    await page.goto(`${srv.base}/#bot/${bots.mail.id}`);
    await page.reload();
    await marks.first().waitFor();
    assert.equal(await marks.count(), 5);
    assert.deepEqual(await marks.first().evaluate((el) => [getComputedStyle(el.querySelector('circle')).fill, el.querySelectorAll('.hat').length, el.children.length]), [rgb(bots.doctor.color), 0, 1]);
    await noDots('without the definition');

    assert.deepEqual(errors, []);
    console.log('PASS: a small still head for each waiting thing (hopping, still with reduced motion) and beside every bot named in a chat, in its colour, with its hat and without eyes; the folds stay folded; no dot; a bare small head without the definition; no browser errors.');
  } finally {
    if (browser) await browser.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exit(1); });
