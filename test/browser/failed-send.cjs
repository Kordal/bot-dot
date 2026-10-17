// Optional browser check of a send that fails and of the question before "Everything allowed" (QW-001), at
// desktop and at phone width:
//   NODE_PATH=<directory containing playwright> node test/browser/failed-send.cjs
// With botdot unreachable (every request of the page refused, as when the server is stopped), a message with
// a file comes back into the box with its file and one line, nothing is added to the chat and no toast shows;
// "Can't reach botdot" stands beside the logo on a wide screen and above the message box on a phone; once
// botdot answers again Send delivers the message once and the lines go. Then, in a bot's settings, choosing
// "bypassPermissions" asks first: Cancel puts the select back and saves nothing, Allow everything saves.
// Scratch data and fake Claude only.
//   FAILED_SEND_SHOTS=<folder>  save screenshots there
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, waitFor } = require('../helpers');

const SHOTS = process.env.FAILED_SEND_SHOTS;
const at = '2026-10-05T09:00:00.000Z';
const MSG = 'Have Mail Sorter file the attached invoices under Finance.';
const NOTE = "Not sent: can't reach botdot. Your message is still here.";

(async () => {
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const bot = await makeBot(srv, { name: 'Coder' });
    fs.mkdirSync(path.join(srv.data, 'chief'), { recursive: true });
    const chatFile = (id) => path.join(srv.data, 'chief', `${id}.json`);
    for (const id of ['wide', 'phone']) {
      fs.writeFileSync(chatFile(id), JSON.stringify({ id, title: 'Last night', sessionId: null, createdAt: at, updatedAt: at, costUsd: 0, messages: [
        { role: 'user', text: 'Which bots ran last night?', at },
        { role: 'chief', text: 'Two: News Watcher and Fleet Doctor.', at },
      ] }));
    }
    const mine = async (id) => (await srv.api(`/chief/chats/${id}`)).data.messages.filter((m) => m.role === 'user' && m.text === MSG);

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const errors = [];
    for (const [id, viewport] of [['wide', { width: 1280, height: 800 }], ['phone', { width: 390, height: 844 }]]) {
      const phone = id === 'phone';
      const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
      const page = await context.newPage();
      page.on('pageerror', (e) => errors.push(e.message));
      const shot = async (name) => { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, `${id}-${name}.png`) }); } };
      await page.goto(`${srv.base}/#chief/${id}`);
      const thread = page.locator('#chat-thread');
      await thread.locator('[data-msg="1"]').waitFor();
      const form = page.locator('#view-chief form');
      const box = form.locator('textarea');
      const note = form.locator('.send-note');
      const awayBeside = page.locator('#away');
      const awayAbove = form.locator('.away-line');
      const rows = () => thread.locator('.bubble-row').count();
      assert.equal(await awayBeside.isVisible(), false);
      assert.equal(await awayAbove.isVisible(), false);

      // A message with a file, uploaded while botdot still answers.
      await box.fill(MSG);
      await form.locator('input[name=files]').setInputFiles({ name: 'invoices-september.pdf', mimeType: 'application/pdf', buffer: Buffer.from('%PDF-1.4 test') });
      await form.locator('.attach-list .file-chip.ready').waitFor();
      const before = await rows();

      // botdot stops answering: every request of the page is refused, the live feed too.
      await context.route('**/api/**', (r) => r.abort('connectionrefused'));
      await form.locator('.send-btn').click();
      await note.waitFor();
      assert.equal(await note.innerText(), NOTE);
      assert.equal(await box.inputValue(), MSG, 'the text is back in the box');
      assert.equal(await form.locator('.attach-list .file-chip.ready').count(), 1, 'and its file');
      assert.equal(await rows(), before, 'nothing was added to the chat');
      assert.equal(await page.locator('#toast').isVisible(), false, 'no toast for it');
      const warn = await page.evaluate(() => getComputedStyle(document.documentElement).getPropertyValue('--warn').trim());
      const rgb = await note.evaluate((el, hex) => { const d = document.createElement('i'); d.style.color = hex; document.body.append(d); const want = getComputedStyle(d).color; d.remove(); return [getComputedStyle(el).color, want]; }, warn);
      assert.equal(rgb[0], rgb[1], 'in the warning colour');
      const above = await page.evaluate(() => document.querySelector('#view-chief .send-note').getBoundingClientRect().bottom <= document.querySelector('#view-chief .composer-box').getBoundingClientRect().top);
      assert.ok(above, 'above the box');
      await shot('not-sent');

      // "Can't reach botdot": beside the logo where the list shows; above the box on a phone, once the longer line went.
      if (!phone) {
        assert.equal(await awayBeside.isVisible(), true);
        assert.equal(await awayBeside.innerText(), "Can't reach botdot");
        assert.equal(await awayAbove.isVisible(), false);
      } else {
        assert.equal(await awayBeside.isVisible(), false, 'the list is hidden behind the chat');
        assert.equal(await awayAbove.isVisible(), false, 'the line of the failed send says it already');
      }
      // No toast from the background while botdot stays away (the page asks again every few seconds).
      await page.waitForTimeout(9000);
      assert.equal(await page.locator('#toast').isVisible(), false, 'no repeating message');
      assert.equal(await note.innerText(), NOTE, 'the line stays until the owner sends or edits');
      await box.press('End');
      await box.type(' Today.');
      assert.equal(await note.isVisible(), false, 'edited: the line goes');
      assert.equal(await awayAbove.isVisible(), phone);
      if (phone) assert.equal(await awayAbove.innerText(), "Can't reach botdot. Trying again…");
      await shot('away');
      await box.fill(MSG);

      // botdot is back: Send delivers it once, with its file, and the lines go.
      await context.unroute('**/api/**');
      await form.locator('.send-btn').click();
      await waitFor(async () => (await mine(id)).length === 1, { what: 'the message to arrive' });
      await thread.locator('.bubble.from-me', { hasText: MSG }).waitFor();
      assert.equal(await thread.locator('.bubble.from-me', { hasText: MSG }).count(), 1);
      assert.deepEqual((await mine(id))[0].attachments.map((f) => f.name), ['invoices-september.pdf']);
      assert.equal(await box.inputValue(), '');
      assert.equal(await form.locator('.attach-list .file-chip').count(), 0);
      assert.equal(await note.isVisible(), false);
      await waitFor(async () => !(await awayBeside.isVisible()) && !(await awayAbove.isVisible()), { what: 'the line to go' });
      await page.waitForTimeout(1500);
      assert.equal((await mine(id)).length, 1, 'once');

      // The question before "Everything allowed", in the bot's settings.
      await page.goto(`${srv.base}/#bot/${bot.id}`);
      await page.locator('#bot-settings').click();
      const select = page.locator('#bot-form select[name=permissionMode]');
      await page.locator('#bot-form details.bs-exact').evaluate((d) => { d.open = true; });
      const earlier = await select.inputValue();
      const saved = async () => (await srv.api(`/bots/${bot.id}`)).data.permissionMode;
      assert.notEqual(earlier, 'bypassPermissions');
      await select.selectOption('bypassPermissions');
      const modal = page.locator('#modal');
      await modal.locator('#allow-everything').waitFor();
      assert.equal(await modal.locator('h2').innerText(), 'Let Coder do everything without checks?');
      assert.match(await modal.locator('.modal-body').innerText(), /^It will run any command and change any file without asking you\. You can change this back here at any time\.$/);
      await shot('everything-allowed');
      await modal.getByRole('button', { name: 'Cancel' }).click();
      assert.equal(await select.inputValue(), earlier, 'Cancel: the select is back');
      await page.waitForTimeout(800); // longer than the form waits before it saves
      assert.equal(await saved(), earlier, 'and nothing was saved');
      // Another mode asks nothing.
      const other = earlier === 'acceptEdits' ? 'dontAsk' : 'acceptEdits';
      await select.selectOption(other);
      await waitFor(async () => (await saved()) === other, { what: 'the other mode to be saved' });
      assert.equal(await modal.evaluate((m) => m.open), false);
      await select.selectOption('bypassPermissions');
      await modal.locator('#allow-everything').click();
      await waitFor(async () => (await saved()) === 'bypassPermissions', { what: '"Everything allowed" to be saved' });
      assert.equal(await select.inputValue(), 'bypassPermissions');
      await srv.api(`/bots/${bot.id}`, { method: 'PUT', body: { permissionMode: earlier } }); // as it was, for the next width
      await context.close();
    }
    assert.deepEqual(errors, []);
    console.log('PASS: a failed send is back in the box with its file and one line, at desktop and phone width; "Can\'t reach botdot" beside the logo and above the box, with no toast; sent once when botdot is back; and the question before "Everything allowed".');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
