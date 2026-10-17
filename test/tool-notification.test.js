// What the notification of a tool ask says and offers (server.js askBrief, docs/api.md "A tool to install"):
// the entry of the live feed's `asks` has the line the apps show under the bot's name, and for a tool from a
// link `yesOn: "card"`: its yes is given on the card, where the warning, whose link it is, the address and the
// checksum are, so its notification has Decline and no Install (the owner's decision of 2026-10-03). A registry
// tool's entry is as it was. With the stand-ins of tools.test.js (the registry, micromamba) and of
// tools-link.test.js (the file server).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { startServer, makeBot, feed } = require('./helpers');
const { elf, fileServer } = require('./link-helpers');
const REGISTRY = require('./fixtures/tools-registry.json');

let srv, files, registry, dir, coder, chat;

// The registry's API as botdot reads it for one ask: a package's record by its name.
function registryStub() {
  const server = http.createServer((req, res) => {
    const name = /^\/package\/conda-forge\/([^/?]+)/.exec(req.url)?.[1];
    const t = REGISTRY.tools[name];
    res.writeHead(t ? 200 : 404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(t ? { name, owner: 'conda-forge', summary: t.summary, latest_version: t.latest, conda_platforms: t.platforms, files: [] } : { error: 'not found' }));
  });
  return new Promise((resolve) => server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => server.close() })));
}
const ask = (body) => srv.asChief('/asks', { method: 'POST', body: { kind: 'tool', bot: coder.id, reason: 'It needs it for the work.', chatId: chat.id, ...body } });
// An entry of the feed without its time.
const entry = (e) => ({ ...e, at: null });

before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-tool-notification-'));
  files = await fileServer({ dir });
  registry = await registryStub();
  const micromamba = path.join(dir, 'micromamba');
  fs.writeFileSync(micromamba, `#!/bin/sh\nexec "${process.execPath}" "${path.join(__dirname, 'fixtures', 'fake-micromamba.js')}" "$@"\n`, { mode: 0o755 });
  srv = await startServer({ dir, env: { BOT_DOT_TOOLS_UNPRIVILEGED: '1', MICROMAMBA_BIN: micromamba, BOT_DOT_TOOLS_CACHE: path.join(dir, 'tools-cache'), BOT_DOT_TOOL_REGISTRY_URL: registry.url, BOT_DOT_TOOLS_TEST_CA: files.ca } });
  coder = await makeBot(srv, { name: 'Coder', allowedTools: ['Read', 'Bash'] });
  chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
});
after(async () => { await srv?.stop(); registry?.close(); files?.close(); fs.rmSync(dir, { recursive: true, force: true }); });

test('a tool from a link says so in its notification and is answered on its card; a registry tool keeps Install', async () => {
  const live = feed(srv);
  await live.wait('hello');
  const gh = await ask({ name: 'gh' });
  assert.equal(gh.status, 201, JSON.stringify(gh.data));
  const stripe = await ask({ link: files.put('/stripe/releases/v1.31.0/stripe', elf()), command: 'stripe' });
  assert.equal(stripe.status, 201, JSON.stringify(stripe.data));

  const who = { kind: 'tool', botId: coder.id, botName: 'Coder', botColor: coder.color, what: null, skill: null, at: null };
  const registryEntry = { id: gh.data.id, ...who, tool: 'gh', text: 'Asks to install gh' };
  const linkEntry = { id: stripe.data.id, ...who, tool: 'stripe', text: 'Asks to install stripe from a link', yesOn: 'card' };

  // The `asks` event, as each ask is added.
  const both = await live.wait('asks', (d) => d.waiting === 2);
  live.close();
  assert.deepEqual(both.data.list.map(entry), [registryEntry, linkEntry]);
  assert.ok(!('yesOn' in both.data.list[0]), 'a registry tool is answered from its notification, as before');

  // `hello`, for an app that connects while they wait.
  const later = feed(srv);
  const hello = await later.wait('hello');
  later.close();
  assert.deepEqual(hello.data.asks.map(entry), [registryEntry, linkEntry]);

  // The ask itself says the same, for an app that builds its notification from the card.
  const cards = (await srv.api('/asks')).data;
  assert.deepEqual(cards.map((c) => [c.tool.name, c.yesOn]), [['gh', undefined], ['stripe', 'card']]);
  assert.equal(stripe.data.yesOn, 'card');
  assert.ok(cards[1].warning, 'the card is where the warning is');

  // The owner's answer is the same request from the card and from a notification: Decline needs no card.
  assert.equal((await srv.api(`/asks/${stripe.data.id}`, { method: 'POST', body: { yes: false } })).status, 200);
  assert.deepEqual((await srv.api('/asks')).data.map((c) => c.tool.name), ['gh']);
});

test('a link the Chief proposed is answered on its card too', async () => {
  const other = await makeBot(srv, { name: 'Runner', allowedTools: ['Read', 'Bash'] });
  const proposed = await srv.asChief('/asks', { method: 'POST', body: { kind: 'tool', bot: other.id, link: files.put('/kubectl/v1.34.1/kubectl', elf()), command: 'kubectl', reason: 'It needs it.' } });
  assert.equal(proposed.status, 201, JSON.stringify(proposed.data));
  assert.equal(proposed.data.tool.source.from, 'chief');
  const f = feed(srv);
  const hello = await f.wait('hello');
  f.close();
  const mine = hello.data.asks.find((a) => a.id === proposed.data.id);
  assert.deepEqual([mine.text, mine.yesOn], ['Asks to install kubectl from a link', 'card']);
});

test('a changed bot is answered on its card too, and says in one line what would change', async () => {
  const proposed = await srv.asChief(`/bots/${coder.id}`, { method: 'PUT', body: { systemPrompt: 'Never push to main.' } });
  assert.ok(proposed.data.pendingChange);
  const f = feed(srv);
  const hello = await f.wait('hello');
  f.close();
  const mine = hello.data.asks.find((a) => a.id === proposed.data.pendingChange);
  // Its entry also has who proposed it and the card's title and parts (docs/api.md, "A changed bot"); the line stays one line.
  assert.deepEqual(entry(mine), { id: mine.id, kind: 'bot-change', botId: coder.id, botName: 'Coder', botColor: coder.color, what: null, skill: null, by: 'chief', title: 'Change Coder: new rules?',
    parts: [{ label: 'Rules', was: '', now: 'Never push to main.' }], text: 'The Chief wants to change its rules', yesOn: 'card', at: null });
  const card = (await srv.api('/asks')).data.find((a) => a.id === mine.id);
  assert.deepEqual([card.text, card.yesOn], ['The Chief wants to change its rules', 'card']);
  assert.match(card.details, /Never push to main/, 'the card is where the proposed rules show');
  // The answer is the same request from the card and from a notification, as before.
  assert.equal((await srv.api(`/asks/${mine.id}`, { method: 'POST', body: { yes: false } })).status, 200);
});
