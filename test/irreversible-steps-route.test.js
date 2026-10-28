// An irreversible step on a bot's computer (#638, ADR 107), end to end through botdot and its Docker helper (a stand-in
// here, whose Camoufox shows a dialog that cannot be undone): the click waits on a card in Needs you, a no is final for
// the run, the screen's own clicks don't get round it, a yes lets it through once, and taking control is a no.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const os = require('node:os');
const path = require('node:path');
const { startServer, makeBot, heldRun } = require('./helpers');
const { validate } = require('../lib/docker-helper');

const DIALOG = [
  'Page: Settings (https://pay.example.com/settings)',
  '- paragraph: Closing an account is irreversible.',
  '- button "Next" [ref=e1]',
  '- dialog "Close account":',
  '  - paragraph: This cannot be undone.',
  '  - button "Cancel" [ref=e2]',
  '  - button "Close account" [ref=e3]',
].join('\n');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-steps-route-'));
const socket = path.join(dir, 'helper.sock');
let clicks = [];
let screenInput = [];
const on = new Set();
let helper;
let srv;

before(async () => {
  helper = http.createServer(async (req, res) => {
    let body = '';
    for await (const chunk of req) body += chunk;
    const { operation, args } = JSON.parse(body);
    if (!validate(operation, args)) { res.writeHead(400, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ error: 'Invalid helper operation' })); }
    const [seat, payload] = args;
    let value = null;
    if (operation === 'ensure' && seat) on.add(seat.screen);
    if (operation === 'inspect' || operation === 'details') value = { state: 'running' };
    if (operation === 'screenState') value = { state: on.has(seat.screen) ? 'running' : 'off' };
    if (operation === 'browserTool') {
      if (payload.op === 'click') clicks.push(`${seat.bot}:${payload.ref}`);
      value = { ok: true, snapshot: DIALOG };
    }
    if (operation === 'request') { screenInput.push(payload.command); value = { ok: true, text: 'data: {"success": true}' }; }
    if (operation === 'listAll') value = {};
    if (operation === 'update.status') value = { supported: false };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ value }));
  });
  await new Promise((r) => helper.listen(socket, r));
  srv = await startServer({ env: { BOT_DOT_HELPER_SOCKET: socket } });
});
after(async () => { await srv.stop(); await new Promise((r) => helper.close(r)); fs.rmSync(dir, { recursive: true, force: true }); });

const browser = (held, body) => srv.api('/vault/session/computer/browser', { method: 'POST', headers: { 'X-Vault-Token': held.token }, body });
const screen = (held, command) => srv.api('/vault/session/computer/cmd', { method: 'POST', headers: { 'X-Vault-Token': held.token }, body: { command, params: {} } });
const waitOn = (held, id) => srv.api(`/vault/session/computer/step/${id}/wait`, { headers: { 'X-Vault-Token': held.token } });
const cards = async () => (await srv.api('/asks?computer-step=1')).data.filter((a) => a.kind === 'computer-step');
const viewer = (botId, control) => new Promise((resolve, reject) => {
  http.get({ host: '127.0.0.1', port: srv.port, path: `/computer/${botId}/vnc.html?autoconnect=1&view_only=${control ? 0 : 1}` }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); }).on('error', reject);
});

test('the click waits on a card; after a no it is refused for the run, by the browser and by the screen', async (t) => {
  const bot = await makeBot(srv, { name: 'Payer', computer: 'linux' });
  const held = await heldRun(srv, bot);
  t.after(() => { srv.unhold(); srv.release(held.rec); });
  clicks = [];
  assert.equal((await browser(held, { op: 'snapshot' })).data.snapshot, DIALOG);
  assert.equal((await browser(held, { op: 'click', ref: 'e1' })).data.ok, true, 'an ordinary button beside the word goes');

  const asked = (await browser(held, { op: 'click', ref: 'e3' })).data;
  assert.ok(asked.waits, 'the confirming click waits');
  assert.deepEqual(clicks, [`${bot.id}:e1`], 'and was not clicked');
  const [card] = await cards();
  assert.equal(card.title, 'Let Payer click “Close account” on pay.example.com?');
  assert.equal(card.yes, 'Allow once');
  assert.equal(card.yesOn, 'card');
  assert.ok(!(await srv.api('/asks')).data.some((a) => a.kind === 'computer-step'), 'an app from before is not sent it');
  assert.equal((await srv.api(`/runs/${card.runId}`)).data.waitingFor, 'ok', 'its run says it waits for the OK');

  assert.equal((await srv.api(`/asks/${card.id}`, { method: 'POST', body: { yes: false } })).status, 200);
  assert.equal((await waitOn(held, asked.waits)).data.status, 'declined');
  const again = (await browser(held, { op: 'click', ref: 'e3' })).data;
  assert.equal(again.ok, false);
  assert.match(again.error, /declined/);
  assert.match((await browser(held, { op: 'press', key: 'Enter' })).data.error, /declined/);
  screenInput = [];
  const byScreen = (await screen(held, 'left_click')).data;
  assert.equal(byScreen.ok, false, 'a click on the screen while the step is on the page');
  assert.match(byScreen.error, /declined/);
  assert.deepEqual(screenInput, [], 'nothing reached the screen');
  assert.equal((await screen(held, 'screenshot')).data.ok, true, 'looking goes');
  assert.deepEqual(clicks, [`${bot.id}:e1`]);
  assert.deepEqual(await cards(), [], 'no new card');
});

test('a yes lets the step through once; taking control of the screen while it waits is a no', async (t) => {
  const bot = await makeBot(srv, { name: 'Closer', computer: 'linux' });
  const held = await heldRun(srv, bot);
  t.after(() => { srv.unhold(); srv.release(held.rec); });
  clicks = [];
  await browser(held, { op: 'snapshot' });
  const first = (await browser(held, { op: 'click', ref: 'e3' })).data;
  const [card] = await cards();
  assert.deepEqual((await srv.api(`/asks/${card.id}`, { method: 'POST', body: { yes: true } })).data, { ok: true, held: true });
  assert.equal((await waitOn(held, first.waits)).data.status, 'allowed');
  assert.equal((await browser(held, { op: 'click', ref: 'e3' })).data.ok, true);
  assert.deepEqual(clicks, [`${bot.id}:e3`], 'clicked once, after the yes');

  const second = (await browser(held, { op: 'click', ref: 'e3' })).data;
  assert.ok(second.waits, 'the yes was for one click');
  assert.equal(await viewer(bot.id, false), 200);
  assert.equal((await cards()).length, 1, 'watching is no answer');
  assert.equal(await viewer(bot.id, true), 200);
  assert.deepEqual(await cards(), [], 'taking control took the card');
  const told = (await waitOn(held, second.waits)).data;
  assert.equal(told.status, 'declined');
  assert.match(told.text, /took control/);
  assert.match((await browser(held, { op: 'click', ref: 'e3' })).data.error, /took control/);
  assert.deepEqual(clicks, [`${bot.id}:e3`]);
});
