// #1105: the runs are listed newest first from an order kept as they are saved, not sorted on every list, and what
// GET /bots reads for each bot comes from one pass over the index. Here the run files are written out of order before
// botdot loads them, one of them left "running" by a server that stopped (botdot marks it interrupted as it starts).
const fs = require('fs');
const os = require('os');
const path = require('path');

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-run-order-'));
const data = path.join(dir, 'data');
const runsDir = path.join(data, 'runs');
for (const d of [data, runsDir, path.join(dir, 'home')]) fs.mkdirSync(d, { recursive: true });
Object.assign(process.env, {
  BOT_DOT_DATA: data, BOT_DOT_VAULT_KEY_FILE: path.join(dir, 'vault.key'), BOT_DOT_SEPARATE_USERS: '0',
  CLAUDE_BIN: path.join(__dirname, 'fixtures', 'fake-claude.js'), HOME: path.join(dir, 'home'),
});
const at = (min) => new Date(Date.UTC(2026, 10, 6, 10, min)).toISOString();
const run = (id, botId, min, status = 'success', more = {}) => fs.writeFileSync(path.join(runsDir, `${id}.json`), JSON.stringify({ id, botId, startedAt: at(min), endedAt: at(min + 1), status, prompt: 'x', ...more }));
run('r-c', 'alpha', 30, 'error');
run('r-a', 'alpha', 10);
run('r-e', 'beta', 50, 'running');
run('r-b', 'beta', 20);
run('r-d', 'alpha', 30); // the same start as r-c: the larger id is the newer
run('r-g', 'alpha', 60, 'success', { groupId: 'team' }); // a turn in a group: in no bot's own chat

const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const B = require('../lib/bots');

after(() => fs.rmSync(dir, { recursive: true, force: true }));

test('runs are listed newest first, with before and limit', () => {
  assert.deepEqual(B.runSummaries().map((r) => r.id), ['r-e', 'r-d', 'r-c', 'r-b', 'r-a']);
  assert.deepEqual(B.runSummaries({ all: true }).map((r) => r.id), ['r-g', 'r-e', 'r-d', 'r-c', 'r-b', 'r-a']);
  assert.deepEqual(B.runSummaries({ botId: 'alpha', limit: 2 }).map((r) => r.id), ['r-d', 'r-c']);
  assert.deepEqual(B.runSummaries({ before: 'r-d', limit: 2 }).map((r) => r.id), ['r-c', 'r-b']);
  assert.deepEqual(B.runSummaries({ before: 'r-g' }), [], 'a run that is not in this list');
  assert.deepEqual(B.runSummaries({ groupId: 'team' }).map((r) => r.id), ['r-g']);
});

test("each bot's latest finished run of its own chat", () => {
  assert.equal(B.runSummaries({ botId: 'beta' })[0].status, 'interrupted', 'marked as botdot started');
  assert.deepEqual(B.lastStatuses(), { alpha: 'success', beta: 'interrupted' });
});
