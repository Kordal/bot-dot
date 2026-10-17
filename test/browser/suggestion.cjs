// Optional browser check of a bot's suggestion in a Chief chat (#442):
//   NODE_PATH=<directory containing playwright> node test/browser/suggestion.cjs
// A long Bot Designer-style plan (headings, a list, a code fence with a long line, a long unbroken word) shows
// its text inside its bubble at 1024 wide with the sidebar open, folded and unfolded, never under the bot list;
// a tap unfolds and folds it, and Approve still answers the plan. Scratch data only.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, waitFor } = require('../helpers');

const PLAN = [
  '# Staging Tester',
  '',
  'Build Staging Tester: a bot that checks the staging site every morning and tells you what broke.',
  '',
  '## What it does',
  '',
  '- Opens https://staging.example.com/a/very/long/path/that/goes/on/and/on/without/a/single/break/in/it/at/all',
  '- Runs the smoke tests',
  '- Writes a short report',
  '',
  '## Its job',
  '',
  '```',
  'curl --fail --silent --show-error --retry 3 --header "Authorization: Bearer $STAGING_TOKEN" https://staging.example.com/api/health/everything/at/once',
  '```',
  '',
  '## What it never does',
  '',
  'It never deploys anything.',
].join('\n');

(async () => {
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    // A bot's plan waits in a new chat, as send_to_chief leaves it.
    const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
    const file = path.join(srv.data, 'chief', `${chat.id}.json`);
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    saved.messages.push({ role: 'suggestion', from: { id: 'designer', name: 'Bot Designer', emoji: '🎨', color: '#888' }, text: PLAN, at: new Date().toISOString(), status: 'pending' });
    fs.writeFileSync(file, JSON.stringify(saved));

    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(`${srv.base}/#chief/${chat.id}`);
    const bubble = page.locator('#chat-thread .suggestion-msg');
    await bubble.waitFor();

    // Where the bubble, its first line and the thread are, and what is drawn at the middle of that first line.
    const layout = () => page.evaluate(() => {
      const box = (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height }; };
      const bubble = document.querySelector('#chat-thread .suggestion-msg');
      const first = bubble.querySelector('.md > :first-child');
      const f = box(first);
      const hit = document.elementFromPoint(f.left + Math.min(f.width, 40) / 2, f.top + Math.min(f.height, 20) / 2);
      // Anything in it that reaches past its edges (what is inside a code block scrolls with it).
      const outside = [...bubble.querySelectorAll('.md *')].filter((el) => !el.parentElement.closest('pre')).filter((el) => {
        const r = box(el);
        return r.width && (r.left < box(bubble).left - 0.5 || r.right > box(bubble).right + 0.5);
      }).map((el) => el.tagName);
      return { sidebar: box(document.querySelector('.sidebar')), thread: box(document.querySelector('#chat-thread')), bubble: box(bubble), first: f, firstText: first.textContent, hitInBubble: !!hit && bubble.contains(hit), outside };
    });
    const inside = (what, l) => {
      assert.ok(l.sidebar.width > 0, `${what}: the sidebar is open`);
      assert.ok(l.bubble.left >= l.thread.left - 0.5 && l.bubble.right <= l.thread.right + 0.5, `${what}: the bubble is inside the thread: ${JSON.stringify({ bubble: l.bubble, thread: l.thread })}`);
      assert.ok(l.bubble.left >= l.sidebar.right, `${what}: the bubble is not under the bot list: ${JSON.stringify({ bubble: l.bubble, sidebar: l.sidebar })}`);
      assert.equal(l.firstText, 'Staging Tester', `${what}: the plan's first line comes first`);
      assert.ok(l.first.width > 0 && l.first.height > 0, `${what}: the first line has a size`);
      assert.ok(l.first.left >= l.bubble.left && l.first.right <= l.bubble.right && l.first.top >= l.bubble.top && l.first.bottom <= l.bubble.bottom, `${what}: the first line is inside the bubble: ${JSON.stringify({ first: l.first, bubble: l.bubble })}`);
      assert.ok(l.hitInBubble, `${what}: the first line is what is drawn there`);
      assert.deepEqual(l.outside, [], `${what}: nothing in the bubble reaches past its edges (a code block scrolls inside it)`);
    };

    const folded = await layout();
    inside('folded', folded);
    assert.ok(folded.bubble.height < 260, `folded: the bubble shows a few lines, not the whole plan (${folded.bubble.height}px)`);

    // A tap unfolds it to the whole plan, still inside the thread, and a second tap folds it again.
    await bubble.click();
    const open = await layout();
    inside('unfolded', open);
    assert.ok(open.bubble.height > folded.bubble.height + 100, `unfolded: the whole plan shows (${open.bubble.height}px against ${folded.bubble.height}px)`);
    await bubble.click();
    assert.equal(Math.round((await layout()).bubble.height), Math.round(folded.bubble.height), 'a second tap folds it again');

    // Approve still answers the plan with the same words.
    await page.locator('#chat-thread [data-sug-build]').click();
    await waitFor(async () => (await srv.api(`/chief/chats/${chat.id}`)).data.messages.some((m) => m.role === 'user' && m.text === 'Approved. Go ahead.'), { what: 'the approval to reach the Chief' });
    assert.deepEqual(errors, []);
    console.log('PASS: a long plan shows inside its suggestion bubble at 1024 wide with the sidebar open, folded and unfolded; Approve answers it; no browser errors.');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
