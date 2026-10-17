// Every bot learns all it can and replies in plain words: a bot stored with "learning" or "friendly" (from when
// they could be switched, or in a restored backup, which is read the same way) is read without them, and saved
// so. Run in a process of its own, with its own data folder.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

test('a bot stored with "learning" and "friendly" is read without them, and saved without them', () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-learning-'));
  const bot = (id, learning, friendly) => ({ id, name: id, prompt: 'Do the task.', outfit: { hat: '' }, learning, friendly });
  fs.writeFileSync(path.join(data, 'bots.json'), JSON.stringify([bot('off', 'off', false), bot('memory', 'memory', true), bot('all', 'all', false)]));
  const script = `
    const { bots } = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'bots.js'))});
    const kept = (b) => ['learning', 'friendly'].filter((k) => k in b);
    const read = Object.fromEntries(bots.list().map((b) => [b.id, kept(b)]));
    bots.update('memory', { description: 'Saved again', friendly: false });
    console.log(JSON.stringify(read));
    process.exit(0);`;
  // The suite's sealed surroundings for a botdot process (helpers.js): the stand-in Claude, a home of its own, no separate users.
  const env = { PATH: process.env.PATH, HOME: data, TZ: 'UTC', BOT_DOT_DATA: data, CLAUDE_BIN: path.join(__dirname, 'fixtures', 'fake-claude.js'), BOT_DOT_SEPARATE_USERS: '0' };
  try {
    const out = JSON.parse(execFileSync(process.execPath, ['-e', script], { env, encoding: 'utf8', timeout: 30_000 }).trim().split('\n').pop());
    assert.deepEqual(out, { off: [], memory: [], all: [] });
    const saved = JSON.parse(fs.readFileSync(path.join(data, 'bots.json'), 'utf8'));
    assert.equal(saved.find((b) => b.id === 'memory').description, 'Saved again');
    for (const b of saved) assert.deepEqual(['learning', 'friendly'].filter((k) => k in b), [], `${b.id}: the file holds neither`);
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
  }
});
