// The real dress() of lib/bots.js: it writes only the icon of bots without one, so an icon the Chief or the owner set
// while Claude was picking stays, and so does every hat. Run in a process of its own, with its own data folder.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

test('dress() gives an icon only to bots without one and keeps their hat; nothing held', () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-dress-'));
  const bot = (id, outfit) => ({ id, name: id, prompt: 'Do the task.', outfit });
  fs.writeFileSync(path.join(data, 'bots.json'), JSON.stringify([bot('never', null), bot('bare', { hat: '' }), bot('capped', { hat: 'cap' }), bot('old', { hat: 'beret', holds: 'pencil' }), bot('set', { hat: 'cap', icon: 'mail' })]));
  const script = `
    const { bots } = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'bots.js'))});
    const pick = { icon: 'chart', hat: 'crown' };
    const dressed = bots.dress({ never: pick, bare: pick, capped: pick, old: pick, set: pick });
    console.log(JSON.stringify({ dressed, outfits: Object.fromEntries(bots.list().map((b) => [b.id, b.outfit])) }));
    process.exit(0);`;
  // The suite's sealed surroundings for a botdot process (helpers.js): the stand-in Claude, a home of its own, no separate users.
  const env = { PATH: process.env.PATH, HOME: data, TZ: 'UTC', BOT_DOT_DATA: data, CLAUDE_BIN: path.join(__dirname, 'fixtures', 'fake-claude.js'), BOT_DOT_SEPARATE_USERS: '0' };
  try {
    const out = JSON.parse(execFileSync(process.execPath, ['-e', script], { env, encoding: 'utf8', timeout: 30_000 }).trim().split('\n').pop());
    assert.deepEqual(out.dressed, ['never', 'bare', 'capped', 'old']);
    assert.ok(!fs.readFileSync(path.join(data, 'bots.json'), 'utf8').includes('holds'), 'saved, a bot from the stick-figure build has lost what it held');
    assert.deepEqual(out.outfits, { never: { hat: '', icon: 'chart' }, bare: { hat: '', icon: 'chart' }, capped: { hat: 'cap', icon: 'chart' }, old: { hat: 'beret', icon: 'chart' }, set: { hat: 'cap', icon: 'mail' } });
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
  }
});
