// A bot's login request outlives the run that gave up waiting for it, and once the owner adds the login that run's
// work carries on (ADR 189). This file loads lib/bots.js itself, on a scratch data folder and the stand-in for Claude.
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-login-later-'));
const out = path.join(dir, 'fake');
fs.mkdirSync(out);
Object.assign(process.env, {
  BOT_DOT_DATA: path.join(dir, 'data'), BOT_DOT_VAULT_KEY_FILE: path.join(dir, 'vault.key'), BOT_DOT_SEPARATE_USERS: '0',
  CLAUDE_BIN: path.join(__dirname, 'fixtures', 'fake-claude.js'), FAKE_OUT: out, HOME: path.join(dir, 'home'), TZ: 'UTC',
});
fs.mkdirSync(process.env.HOME);

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { waitFor } = require('./helpers');
const B = require('../lib/bots');
const requests = require('../lib/login-requests');

after(() => { B.stopAllRuns(); fs.rmSync(dir, { recursive: true, force: true }); });
const ended = (bot, count) => waitFor(() => { const all = B.listRuns({ botId: bot.id }); return all.length === count && all.every((m) => m.status !== 'running') ? all : null; }, { what: `${count} ended runs` });

test('a login added after its run gave up carries that run on, and the request stayed in Needs you meanwhile', async () => {
  const bot = B.bots.create({ name: 'Shop Watcher', emoji: '🧪', prompt: 'Watch the shop.' });
  const run = B.startRun(bot, { prompt: 'Check the prices on shop.example.com' });
  const [first] = await ended(bot, 1);
  assert.equal(first.id, run.id);
  const r = requests.create({ botId: bot.id, runId: run.id, site: 'https://shop.example.com', name: 'Shop', from: 'bot' });
  assert.equal(requests.waitsFor(run.id), true);
  const later = [];
  requests.onLater((x) => later.push(x.id));
  requests.cancelForRun(run.id);
  assert.equal(requests.get(r.id).status, 'pending', 'it stays in Needs you');
  assert.equal(requests.get(r.id).ranOut, true);
  assert.equal(requests.waitsFor(run.id), false, 'no run waits for it');
  assert.ok(requests.pending().some((x) => x.id === r.id));
  requests.settle(r.id, 'saved', 'Shop');
  assert.deepEqual(later, [r.id]);
  assert.equal(B.carryOnAfterLogin(requests.get(r.id)), true);
  const runs = await ended(bot, 2);
  const next = runs.find((m) => m.id !== run.id);
  assert.equal(next.continues, run.id, 'the run that gave up is carried on');
});

test('a card, or a request of the Chief, still ends with its run; a run of the bot that asks again takes it over', async () => {
  const card = requests.create({ botId: 'b1', runId: 'r1', site: 'https://pay.example.com', from: 'bot', kind: 'card' });
  const chief = requests.create({ botId: 'b1', runId: 'r1', site: 'https://chief.example.com', from: 'chief' });
  const mine = requests.create({ botId: 'b1', runId: 'r1', site: 'https://x.example.com', from: 'bot' });
  requests.cancelForRun('r1');
  assert.deepEqual([requests.get(card.id).status, requests.get(chief.id).status, requests.get(mine.id).status], ['expired', 'expired', 'pending']);
  const again = requests.create({ botId: 'b1', runId: 'r2', site: 'https://x.example.com', from: 'bot' });
  assert.equal(again.id, mine.id, 'the same request');
  assert.deepEqual([again.runId, again.ranOut, requests.waitsFor('r2')], ['r2', false, true]);
});
