// The real dress() of lib/bots.js: it writes only to bots never given an outfit, so what the Chief or the owner set
// while Claude was picking, also "nothing", stays. Run in a process of its own, with its own data folder.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

test('dress() leaves a bot that was given an outfit meanwhile, also one given none; hats only', () => {
  const data = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-dress-'));
  const bot = (id, outfit) => ({ id, name: id, prompt: 'Do the task.', outfit });
  fs.writeFileSync(path.join(data, 'bots.json'), JSON.stringify([bot('never', null), bot('bare', { hat: '' }), bot('capped', { hat: 'cap' }), bot('old', { hat: 'beret', holds: 'pencil' })]));
  const script = `
    const { bots } = require(${JSON.stringify(path.join(__dirname, '..', 'lib', 'bots.js'))});
    const pick = { hat: 'crown' };
    const dressed = bots.dress({ never: pick, bare: pick, capped: pick, old: pick });
    console.log(JSON.stringify({ dressed, outfits: Object.fromEntries(bots.list().map((b) => [b.id, b.outfit])) }));
    process.exit(0);`;
  // The suite's sealed surroundings for a botdot process (helpers.js): the stand-in Claude, a home of its own, no separate users.
  const env = { PATH: process.env.PATH, HOME: data, TZ: 'UTC', BOT_DOT_DATA: data, CLAUDE_BIN: path.join(__dirname, 'fixtures', 'fake-claude.js'), BOT_DOT_SEPARATE_USERS: '0' };
  try {
    const out = JSON.parse(execFileSync(process.execPath, ['-e', script], { env, encoding: 'utf8', timeout: 30_000 }).trim().split('\n').pop());
    assert.deepEqual(out.dressed, ['never']);
    assert.ok(!fs.readFileSync(path.join(data, 'bots.json'), 'utf8').includes('holds'), 'saved, a bot from the stick-figure build has lost what it held');
    assert.deepEqual(out.outfits, { never: { hat: 'crown' }, bare: { hat: '' }, capped: { hat: 'cap' }, old: { hat: 'beret' } });
  } finally {
    fs.rmSync(data, { recursive: true, force: true });
  }
});
