// What an account's share of the machine does to a run (#471, ADR 028), and all it shows: a run whose computer waits
// for a free one says "Waiting for a free computer" on its working line until it starts, a run stopped meanwhile
// starts no computer, and a run that fails on a full disk says "No space left on the server." and nothing of a size or
// a limit. This file loads lib/bots.js itself, on a scratch data folder and the stand-in for Claude, with the computers
// stubbed.
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-shares-'));
const out = path.join(dir, 'fake');
fs.mkdirSync(out);
Object.assign(process.env, {
  BOT_DOT_DATA: path.join(dir, 'data'), BOT_DOT_VAULT_KEY_FILE: path.join(dir, 'vault.key'), BOT_DOT_SEPARATE_USERS: '0',
  CLAUDE_BIN: path.join(__dirname, 'fixtures', 'fake-claude.js'), FAKE_OUT: out, HOME: path.join(dir, 'home'),
});
fs.mkdirSync(process.env.HOME);

const { test, beforeEach, after } = require('node:test');
const assert = require('node:assert/strict');
const { waitFor } = require('./helpers');
const B = require('../lib/bots');
const { withProblem, friendlyProblem, NO_SPACE } = require('../lib/problems');
const diskSpace = require('../lib/disk-space');

const ended = (id) => waitFor(() => { const m = B.readMeta(id); return m && m.status !== 'running' ? m : null; }, { what: `run ${id} to end` });
const hold = () => fs.writeFileSync(path.join(out, 'hold'), '');
const letGo = () => fs.rmSync(path.join(out, 'hold'), { force: true });
after(() => { letGo(); B.stopAllRuns(); fs.rmSync(dir, { recursive: true, force: true }); });

// The computers, stubbed: the bot's start waits while `waits` holds it, and finishes when `free()` is called.
let asked = [];
let waits = new Set();
let free = null;
Object.assign(B.computers, {
  ensure: (botId) => { asked.push(['ensure', botId]); waits.add(botId); return new Promise((resolve) => { free = () => { waits.delete(botId); resolve(); }; }); },
  waiting: async (botId) => waits.has(botId),
  stop: async (botId) => { asked.push(['stop', botId]); },
  inspect: async () => ({ state: 'stopped' }),
  setRestartPolicy: async () => {},
});
beforeEach(() => { asked = []; waits = new Set(); free = null; fs.rmSync(path.join(out, 'fail.txt'), { force: true }); });

test('a computer that waits for a free one says so on its run\'s line, until it starts', async () => {
  const bot = B.bots.create({ name: 'Waiting Bot', prompt: 'Look at a page.', computer: 'linux' });
  hold();
  const meta = B.startRun(bot, { prompt: 'Open the page' });
  await waitFor(() => B.readMeta(meta.id)?.status === 'running' && B.workingLineOf(meta.id) !== undefined, { what: 'the run to start' });
  const started = B.computerForRun(meta.id);
  assert.equal(B.readMeta(meta.id).phase, 'Starting its computer');
  await waitFor(() => B.readMeta(meta.id).phase === 'Waiting for a free computer', { what: 'the line to say it waits', timeout: 8000 });
  await waitFor(() => B.workingLineOf(meta.id) === 'Waiting for a free computer', { what: 'the working line', timeout: 8000 });
  free();
  await started;
  assert.equal(B.readMeta(meta.id).phase, undefined, 'the line is the run\'s own again');
  letGo();
  await ended(meta.id);
});

test('a run stopped while its computer waits starts no computer', async () => {
  const bot = B.bots.create({ name: 'Stopped Waiting', prompt: 'Look at a page.', computer: 'linux' });
  hold();
  const meta = B.startRun(bot, { prompt: 'Open the page' });
  await waitFor(() => B.readMeta(meta.id)?.status === 'running', { what: 'the run to start' });
  const started = B.computerForRun(meta.id).catch(() => {});
  await waitFor(() => free, { what: 'its computer to be asked for' });
  B.stopRun(meta.id);
  letGo();
  await ended(meta.id);
  assert.ok(asked.some(([what, id]) => what === 'stop' && id === bot.id), 'its waiting start is stopped');
  // Had it started all the same, it is stopped once it has.
  asked = [];
  free();
  await started;
  await waitFor(() => asked.some(([what, id]) => what === 'stop' && id === bot.id), { what: 'the computer that started late to stop' });
});

test('a run that fails on a full disk says "No space left on the server", and nothing else', async () => {
  const bot = B.bots.create({ name: 'Disk Filler', prompt: 'Save files.' });
  fs.writeFileSync(path.join(out, 'fail.txt'), "Error: ENOSPC: no space left on device, write '/data/bots/x/big.bin'");
  const meta = B.startRun(bot, { prompt: 'Save the video' });
  const done = await ended(meta.id);
  assert.equal(done.status, 'error');
  assert.equal(done.error, NO_SPACE);
  assert.equal(withProblem(done).problem, 'No space left on the server.');
  assert.doesNotMatch(withProblem(done).problem, /GB|limit|share|quota|device/i);
});

test('the words of a full disk', () => {
  assert.equal(friendlyProblem({ status: 'error', error: 'write EIO' }).startsWith('Something went wrong'), true);
  assert.equal(friendlyProblem({ status: 'error', error: 'ENOSPC: no space left on device' }), NO_SPACE);
  assert.equal(friendlyProblem({ status: 'error', error: 'Docker: no space left on device' }), NO_SPACE);
  const disk = diskSpace.create(dir, { spare: false });
  assert.equal(disk.full('ENOSPC'), true);
  assert.equal(disk.full('something else'), false, 'this test machine has room');
});

test('botdot keeps a spare in an account, and gives its room to the record of a run that failed on a full disk', () => {
  const data = fs.mkdtempSync(path.join(dir, 'spare-'));
  const none = diskSpace.create(data, { spare: false });
  none.keepSpare();
  assert.ok(!fs.existsSync(path.join(data, '.spare')), 'none on the Mac or in a test');
  const disk = diskSpace.create(data, { spare: true });
  disk.keepSpare();
  if ((disk.free() ?? 0) > 2 * 1024 ** 3) assert.ok(fs.existsSync(path.join(data, '.spare')));
  disk.useSpare();
  assert.ok(!fs.existsSync(path.join(data, '.spare')));
});
