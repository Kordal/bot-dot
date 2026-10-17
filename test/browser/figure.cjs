// Optional browser regression: NODE_PATH=<directory containing playwright> node test/browser/figure.cjs
// Every bot avatar on the web page is a head in the bot's colour with two eyes and its hat, drawn from the
// server's figure definition, at phone width, with nine bots put into the six states the way the server
// tests do it. Each state has its own face, moving and standing still.
// Uses only scratch data and fake Claude; no Docker, model calls or production server.
//   FIGURE_DIR=<folder>    the scratch folder for the server's data (default: a fresh temporary one)
//   FIGURE_SHOTS=<folder>  also save screenshots there
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, heldRun, self, waitFor } = require('../helpers');

const SHOTS = process.env.FIGURE_SHOTS;
const PHONE = { width: 390, height: 844 };

(async () => {
  const srv = await startServer({ dir: process.env.FIGURE_DIR });
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const make = (name, color, description, hat) => makeBot(srv, { name, color, description, ...(hat === undefined ? {} : { outfit: { hat } }) });
    const bots = {
      surfer: await make('Web Surfer', '#378add', 'Looks things up on the web', 'cowboy'),
      backup: await make('Backup Bot', '#e24b4a', 'Backs up the family photos', 'viking'),
      coder: await make('Coder', '#7f77dd', 'Writes and fixes code', 'headphones'),
      doctor: await make('Fleet Doctor', '#1d9e75', 'Checks the servers every morning', 'nurse'),
      mail: await make('Mail Keeper', '#ef9f27', 'Keeps an eye on the mail', 'cap'),
      todo: await make('Todo Keeper', '#d4537e', 'Keeps the to-do list in order', 'bow'),
      news: await make('News Reader', '#639922', 'Reads the morning news', ''), // no hat, on purpose
      night: await make('Night Watch', '#888780', 'Watches the house at night', 'nightcap'),
      writer: await make('Writer', '#378add', 'Drafts letters and posts'), // never given a hat: a bare head
    };
    const hats = { surfer: 1, backup: 1, coder: 1, doctor: 1, mail: 1, todo: 1, news: 0, night: 1, writer: 0 };
    const run = (bot, prompt) => srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt } });
    // idle after a run that went well; failed after one that didn't.
    await srv.finished((await run(bots.surfer, 'Find the opening hours')).data.id);
    fs.writeFileSync(path.join(srv.out, 'fail.txt'), 'The disk is full.');
    await srv.finished((await run(bots.backup, 'Back up the photos')).data.id);
    fs.rmSync(path.join(srv.out, 'fail.txt'));
    // paused: it has jobs and none is switched on.
    assert.equal((await srv.api(`/bots/${bots.night.id}/jobs`, { method: 'POST', body: { name: 'Night round', kind: 'ai', cron: '0 2 * * *', prompt: 'Check the doors.', enabled: false } })).status, 201);
    // needs you: a script job the Chief added waits for the owner's OK; a bot asks for a permission.
    assert.equal((await srv.asChief(`/bots/${bots.todo.id}/jobs`, { method: 'POST', body: { name: 'Morning list', kind: 'script', cron: '0 7 * * *', script: 'echo sorted', assessment: 'No AI needed: a script sorts it.' } })).status, 201);
    const asking = await heldRun(srv, bots.news, 'Read the news');
    assert.equal((await self(srv, asking.token, 'ask', { kind: 'permission', permission: 'web', reason: 'To open the news sites' })).data.ok, true);
    srv.release(asking.rec);
    await srv.finished(asking.run.id);
    // waiting: Fleet Doctor asked Mail Keeper and its answer isn't in. Mail Keeper and Coder are working.
    const asker = await heldRun(srv, bots.doctor, 'Ask Mail Keeper for its status');
    assert.equal((await self(srv, asker.token, 'message', { to: bots.mail.id, message: 'Your status, please?', priority: true })).data.delivered, 'started');
    await srv.nextRun((x) => x.args.includes(`${bots.mail.emoji} ${bots.mail.name}`), 'Mail Keeper to start');
    srv.release(asker.rec);
    await srv.finished(asker.run.id);
    await heldRun(srv, bots.coder, 'Fix the build');

    const want = { surfer: 'idle', writer: 'idle', backup: 'failed', night: 'paused', todo: 'needs_you', news: 'needs_you', doctor: 'waiting', mail: 'working', coder: 'working' };
    let got;
    const states = await waitFor(async () => {
      const all = (await srv.api('/bots')).data;
      got = Object.fromEntries(Object.entries(bots).map(([k, b]) => [k, all.find((x) => x.id === b.id).state]));
      return Object.keys(want).every((k) => got[k] === want[k]) ? got : null;
    }, { what: 'the nine bots to be in their states' }).catch((e) => { throw new Error(`${e.message}: ${JSON.stringify(got)}`); });
    assert.deepEqual(new Set(Object.values(states)), new Set(['idle', 'working', 'waiting', 'needs_you', 'failed', 'paused']));

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const context = await browser.newContext({ viewport: PHONE, deviceScaleFactor: 3 });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    const shot = async (name, target = page) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await target.screenshot({ path: path.join(SHOTS, `${name}.png`) }); } };
    // Look at a bot's head in the list inside the page, in one go: the list may be drawn again at any moment.
    const figureOf = (key) => ({ evaluate: (fn) => page.evaluate(`(${fn})(document.querySelector('#contacts [data-contact="${bots[key].id}"] .avatar svg.fig'))`) });

    // The list at phone width: the Chief and nine bots, every one a head in its state and colour, no dot, no body.
    await page.goto(srv.base);
    await page.locator('#contacts [data-contact="chief"] svg.fig .hat').waitFor();
    assert.equal(await page.locator('#contacts .contact .avatar svg.fig').count(), 10);
    assert.equal(await page.locator('.bd, .bd-av, .fig-plain, [class^="b-"]').count(), 0);
    const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;
    for (const [key, state] of Object.entries(want)) {
      const drawn = await figureOf(key).evaluate((el) => ({
        cls: el.getAttribute('class'), head: getComputedStyle(el.querySelector('.l-head > circle')).fill, behind: getComputedStyle(el.parentElement).backgroundColor,
        eyes: el.querySelectorAll('.l-head > .l-eyes > *:not(g)').length, hats: el.querySelectorAll('.l-head > .hat').length,
        // The head fills the avatar: more than 60% of its width.
        fills: el.querySelector('.l-head > circle').getBoundingClientRect().width / el.parentElement.getBoundingClientRect().width,
      }));
      assert.deepEqual([drawn.cls, drawn.head, drawn.behind], [`fig fig-${state}`, rgb(bots[key].color), 'rgba(0, 0, 0, 0)'], `${bots[key].name}: a head in its colour, with no circle behind it`);
      assert.ok(drawn.eyes >= 2, `${bots[key].name} has two eyes`);
      assert.equal(drawn.hats, hats[key], `${bots[key].name}'s hat`);
      assert.ok(drawn.fills >= 0.6, `${bots[key].name}'s head fills its avatar (${drawn.fills.toFixed(2)})`);
    }
    // The hat is in two tones of the bot's colour; the eyes are white with ink pupils.
    const worn = await figureOf('mail').evaluate((el) => {
      const fills = (sel) => [...new Set([...el.querySelectorAll(sel)].map((x) => getComputedStyle(x).fill))];
      return { shapes: el.querySelectorAll('.hat > *').length, main: fills('.hat .f-main'), deep: fills('.hat .f-deep'), white: fills('.l-eyes .f-white'), ink: fills('.l-pupils .f-ink') };
    });
    assert.equal(worn.shapes, 3, 'a cap of three shapes');
    assert.deepEqual(worn.main, [rgb(bots.mail.color)], 'main is the colour itself');
    assert.equal(worn.deep.length, 1);
    assert.match(worn.deep[0], /^color\(srgb 0\.51\d* 0\.34\d* 0\.08\d*\)$/, 'deep is the colour mixed 45% towards black on a light page');
    assert.deepEqual([worn.white, worn.ink], [['rgb(255, 255, 255)'], ['rgb(36, 35, 31)']], 'the definition\'s white and ink');
    // The Chief is a coral head in its fixed hat, from the definition.
    assert.equal(await page.locator('#contacts [data-contact="chief"] svg.fig .hat').count(), 1);
    assert.equal(await page.locator('#contacts [data-contact="chief"] svg.fig').evaluate((el) => el.style.getPropertyValue('--c')), '#d85a30', 'the Chief is coral');
    // What moves, moves: every face but the paused one, and only the layers its state names.
    const moving = (key) => figureOf(key).evaluate((el) => el.getAnimations({ subtree: true }).filter((a) => a.playState === 'running').map((a) => a.effect.target.getAttribute('class')).sort().join());
    const layers = { idle: 'l-eyes', working: 'l-pupils', waiting: 'l-pupils', needs_you: 'l-head', failed: 'l-head', paused: '' };
    for (const [key, state] of Object.entries(want)) assert.equal(await moving(key), layers[state], `${bots[key].name} (${state})`);
    await shot('list-phone-nine-bots');

    // A new hat shows without a reload; an unknown hat and something to hold are refused and change nothing.
    assert.equal((await srv.asChief(`/bots/${bots.writer.id}`, { method: 'PUT', body: { outfit: { hat: 'beret' } } })).status, 200);
    await page.waitForFunction((id) => document.querySelectorAll(`#contacts [data-contact="${id}"] .hat`).length === 1, bots.writer.id);
    const refused = await srv.asChief(`/bots/${bots.writer.id}`, { method: 'PUT', body: { outfit: { hat: 'sombrero' } } });
    assert.equal(refused.status, 400);
    assert.match(refused.data.error, /no hat called "sombrero" in the kit\. outfit\.hat is one of: cap, /);
    const held = await srv.asChief(`/bots/${bots.writer.id}`, { method: 'PUT', body: { outfit: { hat: 'cap', holds: 'pencil' } } });
    assert.equal(held.status, 400);
    assert.match(held.data.error, /An outfit has no "holds"/);
    assert.deepEqual((await srv.api(`/bots/${bots.writer.id}`)).data.outfit, { hat: 'beret' });

    // Drawing the list again leaves a moving face where it was.
    const step = await page.evaluate(async (id) => {
      const pupils = () => document.querySelector(`#contacts [data-contact="${id}"] .l-pupils`);
      const progress = (el) => el.getAnimations()[0].effect.getComputedTiming().progress; // 0 to 1 through the look from side to side
      while (Math.abs(progress(pupils()) - 0.5) > 0.25) await new Promise(requestAnimationFrame); // mid-way, far from where a new movement starts
      const old = pupils();
      const before = progress(old);
      renderContacts();
      return { redrawn: pupils() !== old, before, after: progress(pupils()) };
    }, bots.coder.id);
    assert.ok(step.redrawn, 'the list was drawn again');
    assert.ok(Math.abs(step.after - step.before) < 0.05, `it carries on where it was (${step.before} → ${step.after})`);

    // Reduced motion: nothing moves, and each state still has its own face.
    await page.emulateMedia({ reducedMotion: 'reduce' });
    for (const key of Object.keys(want)) assert.equal(await moving(key), '', `${bots[key].name} is still`);
    // What is drawn of a face, without its hat and colour: the eyes' shapes, where the layers are, and the fade.
    const face = (key) => figureOf(key).evaluate((el) => {
      const eyes = el.querySelector('.l-eyes');
      return [eyes.innerHTML, ...[...el.querySelectorAll('g:not(.hat)')].map((g) => getComputedStyle(g).transform), el.getAttribute('opacity')].join(' ');
    });
    const still = await Promise.all(['surfer', 'backup', 'night', 'todo', 'doctor', 'coder'].map(face));
    assert.equal(new Set(still).size, 6, 'six states, six faces');
    // Working and "needs you" differ by more than where the pupils are: by the shape and the size of the eyes.
    const eyes = (key) => figureOf(key).evaluate((el) => [...el.querySelectorAll('.l-eyes > *:not(g)')].map((x) => `${x.tagName}:${Math.round(x.getBoundingClientRect().width)}`).join());
    assert.notEqual(await eyes('coder'), await eyes('todo'));
    assert.notEqual(await eyes('surfer'), await eyes('todo'));
    // Standing still, the whole head with its hat is inside its avatar, give or take the lean of a tilted hat.
    for (const key of Object.keys(want)) {
      const out = await figureOf(key).evaluate((el) => {
        const box = el.parentElement.getBoundingClientRect();
        return Math.max(...[...el.querySelectorAll('line, circle, rect, path')].map((m) => { const r = m.getBoundingClientRect(); return Math.max(box.left - r.left, r.right - box.right, box.top - r.top, r.bottom - box.bottom); }));
      });
      assert.ok(out <= (want[key] === 'failed' ? 6 : 3), `${bots[key].name} fits its avatar (${out.toFixed(1)}px past it)`);
    }
    await shot('list-phone-reduced-motion');
    // A dark page: the deep tone is mixed towards white; the eyes stay white and ink.
    await page.emulateMedia({ colorScheme: 'dark', reducedMotion: 'reduce' });
    assert.match(await figureOf('mail').evaluate((el) => getComputedStyle(el.querySelector('.hat .f-deep')).fill), /^color\(srgb 0\.96\d* 0\.79\d* 0\.53\d*\)$/);
    assert.equal(await figureOf('mail').evaluate((el) => getComputedStyle(el.querySelector('.l-eyes .f-white')).fill), 'rgb(255, 255, 255)');
    await shot('list-phone-dark');
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'no-preference' });

    // A bot's chat: its head in the header, large in an empty chat.
    await page.locator(`#contacts [data-contact="${bots.writer.id}"]`).click();
    await page.locator('#bot-avatar svg.fig-idle').waitFor();
    assert.equal(await page.locator('#view-bot .chat-empty .avatar.lg svg.fig-idle').count(), 1);
    assert.equal(await page.locator('#bot-avatar .hat').count(), 1, 'the hat in the chat header');
    assert.equal(await page.locator('#view-bot .chat-empty .avatar.lg .hat').count(), 1, 'and on the large head');
    await shot('bot-chat-phone');
    await page.goto(`${srv.base}/#bot/${bots.coder.id}`);
    await page.reload();
    await page.locator('#bot-avatar svg.fig-working').waitFor();
    // The Chief's chat.
    await page.goto(`${srv.base}/#chief`);
    await page.reload();
    await page.locator('#chief-avatar svg.fig').waitFor();
    await page.locator('#view-chief .chief-empty .avatar.lg svg.fig').waitFor();
    assert.equal(await page.locator('#chief-avatar .hat').count(), 1, "the Chief's own hat");
    await shot('chief-chat-phone');
    // Activity: each run's bot, looking about while it runs and with crosses for eyes when it failed.
    await page.goto(`${srv.base}/#runs`);
    await page.reload();
    await page.locator('#run-list .run-item .avatar svg.fig').first().waitFor();
    assert.equal(await page.locator('#run-list .run-item .avatar').count(), await page.locator('#run-list .run-item .avatar svg.fig').count());
    assert.ok(await page.locator('#run-list .avatar svg.fig-working').count() >= 2);
    assert.equal(await page.locator('#run-list .avatar svg.fig-failed').count(), 1);
    assert.equal(await page.locator('#run-list .avatar svg.fig-failed .hat').count(), 1, 'the bot of a run wears its hat');
    assert.equal(await page.locator('.bd, .bd-av, .fig-plain').count(), 0);
    await shot('activity-phone');

    // A wide window: the list beside a chat.
    await page.setViewportSize({ width: 1180, height: 820 });
    await page.goto(`${srv.base}/#bot/${bots.doctor.id}`);
    await page.reload();
    await page.locator('#bot-avatar svg.fig-waiting').waitFor();
    await shot('desktop-list-and-chat');

    // The server names a hat this page's definition lacks (a newer kit), a hat with a shape it can't draw, and
    // a state it doesn't know: the head is drawn without the hat, and as idle.
    await page.setViewportSize(PHONE);
    await page.route('**/api/bots', async (route) => {
      const res = await route.fetch();
      const all = await res.json();
      all.find((b) => b.id === bots.mail.id).outfit = { hat: 'bonnet' };
      all.find((b) => b.id === bots.todo.id).outfit = { hat: { shapes: [{ shape: 'spiral', turns: 3 }] } };
      all.find((b) => b.id === bots.surfer.id).state = 'dreaming';
      await route.fulfill({ response: res, json: all });
    });
    await page.goto(srv.base);
    await page.reload();
    await page.locator(`#contacts [data-contact="${bots.coder.id}"] svg.fig .hat`).waitFor({ state: 'attached' });
    await page.evaluate(() => showList());
    assert.equal(await page.locator(`#contacts [data-contact="${bots.mail.id}"] .hat`).count(), 0, 'no hat it does not know');
    assert.equal(await page.locator(`#contacts [data-contact="${bots.mail.id}"] svg.fig-working .l-eyes`).count(), 1, 'the head and its face are still there');
    assert.equal(await page.locator(`#contacts [data-contact="${bots.todo.id}"] .hat`).count(), 0, 'a shape it cannot draw drops the hat');
    assert.equal(await page.locator(`#contacts [data-contact="${bots.surfer.id}"] svg.fig-idle .hat`).count(), 1, 'a state it does not know is idle');
    assert.equal(await page.locator('#contacts .contact .avatar svg.fig').count(), 10);
    await shot('list-phone-unknown-hat');
    await page.unroute('**/api/bots');

    // The definition doesn't load: every bot is the built-in bare head, and the page still works.
    await page.route('**/api/figure', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"gone"}' }));
    await page.goto(srv.base);
    await page.reload();
    await page.locator('#contacts [data-contact="chief"] svg.fig-plain').waitFor({ state: 'attached' });
    await page.evaluate(() => showList());
    assert.equal(await page.locator('#contacts .contact .avatar svg.fig-plain').count(), 10);
    assert.equal(await page.locator('#contacts .contact .avatar svg.fig-plain .hat').count(), 0);
    assert.equal(await page.locator('#contacts .contact .avatar svg.fig-plain .l-eyes').count(), 10, 'a bare head has its eyes');
    assert.equal(await page.locator('#contacts .contact .name').count(), 10);
    assert.equal(await page.locator(`#contacts [data-contact="${bots.mail.id}"] svg.fig-plain .l-head > circle`).evaluate((el) => getComputedStyle(el).fill), rgb(bots.mail.color));
    await shot('list-phone-no-definition');
    await page.unroute('**/api/figure');

    // An older server, or one whose definition is of a format this page doesn't know: bare heads too.
    await page.route('**/api/figure', async (route) => {
      const res = await route.fetch();
      await route.fulfill({ response: res, json: { ...(await res.json()), version: 1 } });
    });
    await page.goto(srv.base);
    await page.reload();
    await page.locator('#contacts [data-contact="chief"] svg.fig-plain').waitFor({ state: 'attached' });
    await page.unroute('**/api/figure');

    // The definition arrives late: the first load fails, the retry half a minute later works. Every bare
    // head on screen is drawn again from it, in its state and hat, with nothing done by the owner.
    let late = false;
    await page.route('**/api/figure', (route) => (late ? route.continue() : route.fulfill({ status: 500, contentType: 'application/json', body: '{"error":"gone"}' })));
    await page.clock.install();
    await page.goto(srv.base);
    await page.reload();
    await page.locator('#contacts [data-contact="chief"] svg.fig-plain').waitFor({ state: 'attached' });
    await page.evaluate(() => showList());
    assert.equal(await page.locator('#contacts .contact .avatar svg.fig-plain').count(), 10);
    late = true;
    await page.clock.fastForward(31_000);
    await page.locator('#contacts [data-contact="chief"] svg.fig-plain').waitFor({ state: 'detached' });
    assert.equal(await page.locator('#chief-avatar .hat').count(), 1, 'the Chief above its chat has its hat at once, though nothing drew it again');
    assert.equal(await page.locator('svg.fig-plain, svg.fig[data-asked]').count(), 0, 'no bare head is left anywhere on the page');
    assert.equal(await page.locator('#contacts .contact .avatar svg.fig').count(), 10);
    const now = (await srv.api('/bots')).data; // as they are now: a hat changed further up
    for (const [key, state] of Object.entries(want)) {
      const bot = now.find((b) => b.id === bots[key].id);
      assert.equal(await page.locator(`#contacts [data-contact="${bot.id}"] .avatar svg.fig-${state}`).count(), 1, `${key} is drawn ${state}`);
      assert.equal(await page.locator(`#contacts [data-contact="${bot.id}"] .avatar .hat`).count(), bot.outfit?.hat ? 1 : 0, `${key} wears its hat`);
    }
    assert.equal(await page.locator('#contacts [data-contact="chief"] .avatar .hat').count(), 1, 'the Chief wears its own');
    assert.ok((await page.locator('#figure-moves').textContent()).includes('@keyframes fig-working-'), 'and the movements are on the page');
    await page.unroute('**/api/figure');

    assert.deepEqual(errors, []);
    console.log('PASS: ten heads and no dot or body in the phone list, six states in their colours with a face each, hats in two tones, a new hat without a reload, a held object refused, an unknown hat left out, an unknown state drawn idle, movement kept across a redraw, six still faces with reduced motion, heads in the chats and Activity, the bare head without the definition or with one of another format, heads drawn again when it arrives late; no browser errors.');
  } finally {
    srv.unhold();
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
