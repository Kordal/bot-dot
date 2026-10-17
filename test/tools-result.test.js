// What botdot tells the Chief when an install the owner approved has ended (lib/tools.js, complete()): after a
// success that a bot's work stopped without the tool, so the Chief starts it again; after a failure nothing that
// names a run, so it starts nothing. And the one line botdot writes itself when the Chief's turn brings no reply.
// lib/tools.js on its own, with the stand-in for micromamba; the Chief chat's side of that line is in tools.test.js.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const PLATFORM = process.arch === 'arm64' ? 'linux-aarch64' : 'linux-64';
const sha = (text) => crypto.createHash('sha256').update(text).digest('hex');
const coder = { id: 'coder', name: 'Coder', emoji: '🧪', allowedTools: ['Read', 'Bash'] };

let dir, cache, tools, told, wake;
const steer = (how) => fs.writeFileSync(path.join(cache, 'fake.json'), JSON.stringify(how));
// The owner taps Install on a card for gh that Coder asked the Chief for in its run; resolves with what the Chief is told.
function installGh() {
  const next = new Promise((resolve) => { wake = resolve; });
  tools.approve({
    id: 'ask-1', kind: 'tool', botId: coder.id, reason: 'To open the pull request.', chatId: 'chat-1', askedBy: { bot: coder.id, runId: 'run-7' },
    tool: { name: 'gh', version: '2.101.0', summary: 'Github CLI.', source: { type: 'registry', registry: 'conda-forge' }, platform: PLATFORM, size: 13600000, list: [{ url: `https://conda.anaconda.org/conda-forge/${PLATFORM}/gh-2.101.0-h0_0.conda`, sha256: sha('gh-2.101.0-h0_0') }] },
  });
  return next;
}

before(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-tools-result-'));
  cache = path.join(dir, 'tools-cache');
  fs.mkdirSync(path.join(dir, 'data'));
  fs.mkdirSync(cache);
  const micromamba = path.join(dir, 'micromamba');
  fs.writeFileSync(micromamba, `#!/bin/sh\nexec "${process.execPath}" "${path.join(__dirname, 'fixtures', 'fake-micromamba.js')}" "$@"\n`, { mode: 0o755 });
  // The tests' installer: the worker as this user, never in the image (lib/tools.js, installer()).
  Object.assign(process.env, { BOT_DOT_TOOLS_UNPRIVILEGED: '1', MICROMAMBA_BIN: micromamba, BOT_DOT_TOOLS_CACHE: cache });
  delete process.env.BOT_DOT_PRIVILEGE_SOCKET;
  delete process.env.NODE_ENV;
  told = [];
  tools = require('../lib/tools').create({
    dataDir: path.join(dir, 'data'),
    bots: { get: (id) => (id === coder.id ? coder : null), list: () => [coder] },
    asks: { take: () => {}, list: () => [], add: (a) => a, toolDeclined: () => null },
    audit: () => {},
    starts: async () => true,
    tellChief: (turn) => { told.push(turn); wake(turn); return turn.chatId; },
    notify: () => {},
  });
});
after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('after a failed install the Chief is not told that a bot asked in a run, so it starts no bot; botdot has its own line ready', async () => {
  steer({ fail: 'network' });
  const turn = await installGh();
  steer({});
  assert.equal(turn.chatId, 'chat-1', 'the chat that asked');
  assert.match(turn.prompt, /^botdot writes this, not the user: nobody typed it\./);
  assert.match(turn.prompt, /Not installed: gh 2\.101\.0 for 🧪 Coder\. Reason: The registry could not be reached\./);
  assert.match(turn.prompt, /Nothing was changed: what the bot had, it still has\./);
  assert.match(turn.prompt, /Start no bot again because of this: the tool is not there\./);
  assert.ok(!/asked for it in its run|run-7/.test(turn.prompt), `nothing names the run that asked: ${turn.prompt}`);
  assert.equal(turn.otherwise, '⚠️ gh 2.101.0 was not installed for Coder: The registry could not be reached.', 'the tool, the bot and the reason');
});

test('after a successful install the Chief is told which run stopped without the tool; botdot has its own line ready', async () => {
  const turn = await installGh();
  assert.equal(turn.chatId, 'chat-1');
  assert.match(turn.prompt, /Installed: gh 2\.101\.0 for 🧪 Coder \(bot id coder\)\. Its commands: gh\./);
  assert.match(turn.prompt, /Coder asked for it in its run run-7: that work stopped without it\./);
  assert.equal(turn.otherwise, 'gh 2.101.0 is installed for Coder.', 'the tool, the bot, and installed');
  assert.equal(told.length, 2, 'one turn per result');
});
