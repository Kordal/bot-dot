// Optional browser check of diagrams (#177, ADR 041): NODE_PATH=<directory containing playwright> node test/browser/diagram.cjs
// The real Mermaid of vendor/mermaid in a real page, under the page's own policy (script-src 'self'): a page without a
// diagram asks for no Mermaid; a bot's reply and a Chief reply with a ```mermaid flowchart show it drawn, with "Show code"
// that switches to the code and back; a block Mermaid can't read is its code with "Diagram could not be drawn"; a
// diagram with a click handler, HTML and outside pictures in its labels runs nothing, and what it would load from
// another address is stopped in the frame Mermaid draws in and is not in the drawing; the drawing is light on black. Scratch data and the stand-in Claude only.
//   DIAGRAM_SHOTS=<folder>  save a picture of the bot's chat there
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { startServer, makeBot, waitFor } = require('../helpers');

const FLOW = '```mermaid\nflowchart LR\n  Ask[Owner asks] --> Chief{Chief of Staff}\n  Chief -->|runs| Bot[A bot]\n  Bot --> Reply[Reply]\n```';
const BAD = '```mermaid\nflowchart LR\n  A --> \n  ((( nope\n```';
// What strict must stop: a click that calls the page, a javascript: link and HTML in a label.
// And what would load from another address: a picture and a style in a label.
const HOSTILE = '```mermaid\nflowchart LR\n  A["<img src=https://example.invalid/a.png onerror=\'window.__ran=1\'>Label"] --> B["<b onmouseover=\'window.__ran=2\'>bold</b>"]\n'
  + '  B --> C["<span style=\'background:url(https://example.invalid/c.png)\'>styled</span>"]\n'
  + '  click A call alert(1)\n  click B "javascript:window.__ran=3"\n```';
const REPLY = `Here is how it goes:\n\n${FLOW}\n\nA broken one:\n\n${BAD}\n\nA careful one:\n\n${HOSTILE}\n\n\`\`\`js\nconst a = 1;\n\`\`\`\nThat's all.`;

(async () => {
  const srv = await startServer();
  let browser;
  try {
    await srv.api('/setup', { method: 'PUT', body: { done: true } });
    const bot = await makeBot(srv, { name: 'Drawer' });
    browser = await chromium.launch({ headless: true, ...(process.env.CHROME_PATH ? { executablePath: process.env.CHROME_PATH } : {}) });
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [], requests = [], dialogs = [];
    page.on('pageerror', (e) => errors.push(e.message));
    page.on('request', (r) => requests.push(r.url()));
    // What the frame's policy stopped before it left: the address and the page that asked.
    const stopped = [];
    page.on('requestfailed', (r) => { if (r.failure()?.errorText === 'csp') stopped.push({ url: r.url(), from: new URL(r.frame().url()).pathname }); });
    page.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
    const mermaidAsked = () => requests.filter((u) => u.includes('/vendor/mermaid/')).length;

    // A page without a diagram asks for no Mermaid.
    await page.goto(`${srv.base}/#bot/${bot.id}`);
    await page.locator('#bot-thread').waitFor();
    await page.waitForTimeout(500);
    assert.equal(mermaidAsked(), 0, 'no Mermaid for a page without a diagram');

    // A bot's reply with diagrams.
    srv.reply(REPLY);
    const run = (await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Draw it' } })).data;
    await srv.finished(run.id);
    await page.reload();
    const reply = page.locator('#bot-thread .bubble .md', { hasText: 'Here is how it goes' }).last();
    await reply.locator('.diagram').nth(1).waitFor({ timeout: 20000 });
    assert.equal(await reply.locator('.diagram-svg svg').count(), 2, 'the good diagram and the careful one are drawn');
    assert.equal(await reply.locator('.diagram-toggle').count(), 2);
    const words = await reply.locator('.diagram-svg svg').first().textContent();
    for (const w of ['Owner asks', 'Chief of Staff', 'runs', 'A bot', 'Reply']) assert.ok(words.includes(w), `the drawing says "${w}"`);

    // "Show code" and back.
    const first = reply.locator('.diagram').first();
    assert.equal(await first.locator('pre.mermaid-src').isVisible(), false);
    await first.locator('.diagram-toggle').click();
    assert.equal(await first.locator('.diagram-svg').isVisible(), false);
    assert.match(await first.locator('pre.mermaid-src').innerText(), /^flowchart LR\n {2}Ask\[Owner asks\] --> Chief\{Chief of Staff\}/);
    assert.equal(await first.locator('.diagram-toggle').innerText(), 'Show diagram');
    await first.locator('.diagram-toggle').click();
    assert.equal(await first.locator('.diagram-svg').isVisible(), true);
    assert.equal(await first.locator('.diagram-toggle').innerText(), 'Show code');

    // The broken one is its code, with the note, and the rest of the reply is there.
    const bad = reply.locator(':scope > pre.mermaid-src');
    assert.equal(await bad.count(), 1);
    assert.match(await bad.innerText(), /\(\(\( nope/);
    assert.equal(await reply.locator(':scope > .diagram-note').innerText(), 'Diagram could not be drawn');
    assert.equal(await reply.locator(':scope > pre:not(.mermaid-src)').innerText(), 'const a = 1;', 'other code as before');
    assert.match(await reply.innerText(), /That's all\./);

    // The careful one ran nothing, and has no HTML from its labels and no link to follow.
    const careful = reply.locator('.diagram').nth(1);
    for (const node of await careful.locator('.node').all()) { await node.dispatchEvent('mouseover'); await node.dispatchEvent('click'); }
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.__ran), undefined, 'no script from the diagram');
    assert.deepEqual(dialogs, []);
    assert.equal(await careful.locator('img, image, a, [onerror], [onmouseover], [href^="javascript"]').count(), 0, 'no picture, no link, no handler');
    assert.equal(await careful.locator('.diagram-svg').evaluate((el) => /url\(\s*(?!['"]?#)/.test(el.innerHTML.replace(/&quot;/g, '"'))), false, 'no address but its own');
    assert.match(await careful.innerText(), /Label[\s\S]*bold[\s\S]*styled/, 'the words stay');
    // Every part where Mermaid put it: a node that was a link stays in its place in the drawing.
    const { box, nodes } = await careful.locator('.diagram-svg svg').evaluate((svg) => ({
      box: svg.getBoundingClientRect().toJSON(), nodes: [...svg.querySelectorAll('.node')].map((n) => n.getBoundingClientRect().toJSON()),
    }));
    assert.equal(nodes.length, 3);
    for (const n of nodes) assert.ok(n.left >= box.left - 1 && n.right <= box.right + 1 && n.top >= box.top - 1 && n.bottom <= box.bottom + 1, 'inside the drawing');
    assert.ok(nodes[0].right <= nodes[1].left && nodes[1].right <= nodes[2].left, 'left to right, as drawn');

    // Light lines and text on black.
    const look = await page.evaluate(() => {
      const svg = document.querySelector('#bot-thread .diagram-svg svg');
      const lum = (c) => { const [r, g, b] = (c.match(/\d+(\.\d+)?/g) || []).map(Number); return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; };
      const label = svg.querySelector('.nodeLabel, .label text, text');
      const edge = svg.querySelector('.flowchart-link, .edgePath path, path.path');
      return { text: lum(getComputedStyle(label).color === 'rgb(0, 0, 0)' ? getComputedStyle(label).fill : getComputedStyle(label).color), line: lum(getComputedStyle(edge).stroke) };
    });
    assert.ok(look.text > 0.6, `labels light enough: ${look.text}`);
    assert.ok(look.line > 0.4, `lines light enough: ${look.line}`);
    if (process.env.DIAGRAM_SHOTS) {
      fs.mkdirSync(process.env.DIAGRAM_SHOTS, { recursive: true });
      await reply.screenshot({ path: path.join(process.env.DIAGRAM_SHOTS, 'bot-reply.png') });
    }

    // A Chief reply is drawn the same way.
    const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
    srv.reply(`The plan:\n\n${FLOW}`);
    await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'Show me the plan' } });
    await waitFor(async () => { const c = (await srv.api(`/chief/chats/${chat.id}`)).data; return !c.busy && !c.messages.at(-1).pending; }, { what: 'the Chief to reply' });
    await page.goto(`${srv.base}/#chief/${chat.id}`);
    await page.reload();
    await page.locator('#chat-thread .diagram-svg svg').first().waitFor({ timeout: 20000 });

    // Mermaid came once per page load, from the page's own address; nothing from anywhere else; no error.
    const origin = new URL(srv.base).origin;
    // The careful diagram's pictures were asked for while Mermaid drew it, and the frame's policy stopped them there.
    const away = requests.filter((u) => !u.startsWith(origin) && !u.startsWith('data:'));
    assert.deepEqual(away.sort(), ['https://example.invalid/a.png', 'https://example.invalid/c.png']);
    assert.deepEqual(stopped.filter((s) => away.includes(s.url)).map((s) => `${s.from} ${s.url}`).sort(), away.map((u) => `/diagram-frame.html ${u}`), 'none of them left');
    assert.ok(requests.includes(`${origin}/vendor/mermaid/mermaid.min.js`));
    assert.deepEqual(errors, []);
    console.log('diagram check passed');
  } finally {
    await browser?.close();
    await srv.stop();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
