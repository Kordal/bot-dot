// One reset for the account's computer, what an update keeps, and a bot's old computer's files (#107). The owner
// resets or updates the account's computer for every bot, behind a confirmation whose words the server hands out,
// naming the bots that use it and what is lost; the Chief only asks for a reset, on a card in Needs you. A bot's old
// computer of its own is copied into /workspace/<bot>/old-computer, then erased. The Docker helper is a stand-in.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer, makeBot, heldRun } = require('./helpers');
const { rpcClient } = require('./memory-helpers');

// The Docker helper: what it was asked, the account computer's state, and which bots still have an old computer.
let asked = [];
let state = 'running';
let outdated = false;
const old = new Set();
let srv; let helper; let dir;
let coder; let scout;
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-computer-reset-'));
  const socket = path.join(dir, 'helper.sock');
  helper = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const { operation, args } = JSON.parse(body);
    asked.push([operation, ...args]);
    let value = null;
    if (operation === 'inspect') value = { state };
    if (operation === 'details') value = { state, outdated, diskBytes: 1, ...(old.has(args[0]) ? { old: 'stopped' } : {}) };
    if (operation === 'resetAll') { value = state === 'none' ? 'none' : 'erased'; state = 'none'; }
    if (operation === 'updateAll') value = 'updated';
    if (operation === 'copyOld') value = old.has(args[0]) ? { copied: `/workspace/${args[0]}/old-computer` } : null;
    if (operation === 'reset') value = old.delete(args[0]) ? 'erased' : 'none';
    if (operation === 'listAll') value = {};
    if (operation === 'update.status') value = { supported: false };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ value }));
  });
  await new Promise((r) => helper.listen(socket, r));
  srv = await startServer({ env: { BOT_DOT_HELPER_SOCKET: socket } });
  coder = await makeBot(srv, { name: 'Coder', computer: 'linux' });
  scout = await makeBot(srv, { name: 'Scout', computer: 'linux' });
  await makeBot(srv, { name: 'No Desk' });
});
after(async () => { await srv.stop(); await new Promise((r) => helper.close(r)); fs.rmSync(dir, { recursive: true, force: true }); });

const chief = (t) => rpcClient(t, 'mcp-server.js', { BOT_DOT_URL: srv.base, BOT_DOT_CHIEF_KEY: srv.chiefKey });
const ops = (name) => asked.filter(([op]) => op === name);


test('the server announces the reset and the copy in its features', async () => {
  const { features } = (await srv.api('/version')).data;
  assert.ok(features.includes('computer-reset'));
  assert.ok(features.includes('old-computer-copy'));
});

test("a bot's computer says which bots use it and what a reset erases, in the server's words", async () => {
  state = 'running'; outdated = false;
  const d = (await srv.api(`/bots/${coder.id}/computer`)).data;
  assert.deepEqual(d.bots.map((b) => b.name), ['Coder', 'Scout'], 'every bot with a computer, and no other');
  assert.equal(d.reset.title, "Reset the account's computer?");
  assert.match(d.reset.text, /Coder and Scout/);
  assert.match(d.reset.text, /\/home\/box and \/workspace/);
  assert.match(d.reset.text, /logins/);
  assert.match(d.reset.text, /installed/);
  assert.equal(d.reset.yes, 'Reset');
  assert.equal(d.update, undefined, 'no update is offered while the desktop is current');
  assert.equal(d.old, undefined, 'it has no old computer');
});

test('an update is offered with what it keeps and what it loses, and is done for every bot', async () => {
  state = 'running'; outdated = true;
  const d = (await srv.api(`/bots/${scout.id}/computer`)).data;
  assert.match(d.update.text, /keep/);
  assert.match(d.update.text, /\/home\/box and \/workspace/);
  assert.match(d.update.text, /installed with apt/);
  assert.equal(d.update.yes, 'Update');
  asked = [];
  const r = await srv.api('/computer/update', { method: 'POST' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { state: 'running', updated: true });
  assert.equal(ops('updateAll').length, 1);
  assert.equal((await srv.asChief('/computer/update', { method: 'POST' })).status, 403, 'the Chief does not update it');
  outdated = false;
});

test("the owner's reset erases the account's computer for every bot, not while one of them works", async () => {
  state = 'running';
  const { rec, run } = await heldRun(srv, scout);
  asked = [];
  const busy = await srv.api('/computer/reset', { method: 'POST' });
  assert.equal(busy.status, 409);
  assert.match(busy.data.error, /Scout/);
  assert.equal(ops('resetAll').length, 0);
  srv.release(rec);
  await srv.finished(run.id);
  srv.unhold();
  const r = await srv.api('/computer/reset', { method: 'POST' });
  assert.equal(r.status, 200);
  assert.deepEqual(r.data, { state: 'none', erased: true });
  assert.equal(ops('resetAll').length, 1);
  assert.deepEqual((await srv.api('/computers')).data, {}, 'none now, for every bot');
});

test("the Chief asks for the reset on a card in Needs you, and the owner's yes does it", async (t) => {
  state = 'running';
  asked = [];
  const said = await chief(t).json('reset_computer', {});
  assert.equal(said.held, true);
  assert.equal(ops('resetAll').length, 0, 'nothing is erased on the Chief\'s word');
  const cards = (await srv.api('/asks?vault-switch=1&chief-action=1')).data.filter((a) => a.kind === 'chief-action');
  assert.equal(cards.length, 1);
  const [card] = cards;
  assert.equal(card.title, "Reset the account's computer");
  assert.match(card.meta, /Coder and Scout/);
  assert.match(card.meta, /\/home\/box and \/workspace/);
  assert.equal(card.text, "Asks to reset the account's computer");
  assert.equal(card.yesOn, 'card');
  const yes = await srv.api(`/asks/${card.id}`, { method: 'POST', body: { yes: true } });
  assert.equal(yes.status, 200);
  assert.equal(yes.data.done, true);
  assert.equal(ops('resetAll').length, 1);
  // Its own route is still the owner's: the Chief's call without a card does nothing.
  assert.equal((await srv.asChief(`/bots/${coder.id}/computer`, { method: 'POST', body: { action: 'reset' } })).status, 403);
});

test("a bot's old computer: its screen says it is kept, stopped; its home is copied, then it is erased", async () => {
  old.add(coder.id);
  const d = (await srv.api(`/bots/${coder.id}/computer`)).data;
  assert.equal(d.old.state, 'stopped');
  assert.equal(d.old.folder, `/workspace/${coder.id}/old-computer`);
  assert.match(d.old.text, /Coder's old computer of its own is kept, stopped/);
  assert.match(d.old.text, new RegExp(`/workspace/${coder.id}/old-computer`));
  assert.equal(d.old.copy, 'Copy its files');
  assert.equal(d.old.erase, 'Erase it');
  assert.match(d.old.confirm, /^Erase Coder's old computer\? What is on it is lost/);
  asked = [];
  const copied = await srv.api(`/bots/${coder.id}/computer`, { method: 'POST', body: { action: 'copy-old' } });
  assert.equal(copied.status, 200);
  assert.deepEqual(copied.data, { copied: `/workspace/${coder.id}/old-computer` });
  assert.deepEqual(ops('copyOld'), [['copyOld', coder.id]]);
  assert.equal((await srv.asChief(`/bots/${coder.id}/computer`, { method: 'POST', body: { action: 'copy-old' } })).status, 403);
  // Then erased: the bot's own reset, which erases only its old computer.
  assert.equal((await srv.api(`/bots/${coder.id}/computer`, { method: 'POST', body: { action: 'reset' } })).status, 200);
  assert.equal((await srv.api(`/bots/${coder.id}/computer`)).data.old, undefined);
  assert.equal(ops('resetAll').length, 0, "the account's computer is not touched");
  const none = await srv.api(`/bots/${scout.id}/computer`, { method: 'POST', body: { action: 'copy-old' } });
  assert.equal(none.status, 409);
  assert.match(none.data.error, /no old computer/);
});

test("a computer made again or erased takes the unused desktop images with it, after its answer (#191)", async () => {
  const { createServer } = require('../lib/docker-helper');
  const answers = { updateAll: 'updated', resetAll: 'none', reset: 'erased', restartAll: 'restarted' };
  const computers = Object.fromEntries(Object.entries(answers).map(([op, value]) => [op, async () => value]));
  let cleaned = 0;
  const server = createServer({ computers, updates: { clean: async () => { cleaned++; throw new Error('Docker did not answer'); } } });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const call = (operation, args = []) => new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port: server.address().port, path: '/call', method: 'POST' }, (res) => {
      let body = ''; res.on('data', (d) => { body += d; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
    });
    req.on('error', reject);
    req.end(JSON.stringify({ operation, args }));
  });
  try {
    assert.deepEqual(await call('updateAll'), { status: 200, body: { value: 'updated' } }, 'a cleanup that fails changes nothing of the answer');
    assert.equal(cleaned, 1);
    await call('reset', ['pc']);
    assert.equal(cleaned, 2, "a bot's old computer erased");
    await call('resetAll');
    assert.equal(cleaned, 2, 'nothing was erased: nothing to clean');
    await call('restartAll');
    assert.equal(cleaned, 2, 'a restart keeps its image');
  } finally { server.close(); }
});
