// The Claude account's skills reach a bot's run (#236): a run has its own home, where Claude Code finds none of
// ~/.claude/skills, so the per-run pack carries them, except ones switched off for the bot and names the library
// already has. They are listed once per name, a top-level copy winning over a synced one.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const md = (name, description) => `---\nname: ${name}\ndescription: ${description}\n---\nDo it well.`;
function put(dir, text, extra = {}) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'SKILL.md'), text);
  for (const [f, c] of Object.entries(extra)) fs.writeFileSync(path.join(dir, f), c);
}

function setup() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-skills-account-'));
  const config = path.join(tmp, 'claude');
  const sk = path.join(config, 'skills');
  put(path.join(sk, 'motivation-letter'), md('motivation-letter', 'Top-level copy.'), { 'guide.md': 'tone' });
  put(path.join(sk, 'synced', 'motivation-letter'), md('motivation-letter', 'Synced copy.'));
  put(path.join(sk, 'synced', 'pdf'), md('pdf', 'Makes PDFs.'));
  put(path.join(sk, 'synced', 'weekly-report'), md('weekly-report', 'Account copy of weekly-report.'));
  put(path.join(sk, 'synced', 'schedule'), md('schedule', 'Schedules things.'));
  const prev = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = config;
  delete require.cache[require.resolve('../lib/skills')];
  const S = require('../lib/skills').create(path.join(tmp, 'data'));
  S.save({ name: 'weekly-report', description: 'Library copy.', instructions: 'Write it.' });
  const done = () => { if (prev === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = prev; fs.rmSync(tmp, { recursive: true, force: true }); };
  return { S, done };
}

test('account skills: listed once per name, the top-level copy winning over a synced one', () => {
  const { S, done } = setup();
  try {
    const list = S.machineSkills();
    assert.deepEqual(list.map((k) => k.name), ['motivation-letter', 'pdf', 'schedule', 'weekly-report']);
    const letter = list.find((k) => k.name === 'motivation-letter');
    assert.equal(letter.description, 'Top-level copy.');
    assert.equal(letter.origin, 'Your Claude Code');
    assert.equal(list.find((k) => k.name === 'pdf').origin, 'Your Claude account');
    assert.ok(list.every((k) => !('dir' in k)), 'no paths of the server leave the list');
  } finally { done(); }
});

test('account skills: the run pack carries them, but not one switched off or one the library has', () => {
  const { S, done } = setup();
  try {
    const pack = S.buildPack('run1', [], { account: true, off: ['schedule', 'anthropic-skills:pdf'] });
    assert.ok(pack, 'a bot with no library skills still gets the account ones');
    const names = fs.readdirSync(path.join(pack.dir, 'skills')).sort();
    assert.deepEqual(names, ['motivation-letter']);
    assert.match(fs.readFileSync(path.join(pack.dir, 'skills', 'motivation-letter', 'SKILL.md'), 'utf8'), /Top-level copy/);
    assert.equal(fs.readFileSync(path.join(pack.dir, 'skills', 'motivation-letter', 'guide.md'), 'utf8'), 'tone');
    assert.deepEqual(pack.skills.map((k) => k.name), ['motivation-letter']);
    assert.equal(pack.skills[0].description, 'Top-level copy.');

    // The library's weekly-report wins over the account's, ticked or not.
    const withLib = S.buildPack('run2', ['weekly-report'], { account: true });
    assert.deepEqual(withLib.skills.map((k) => k.name).sort(), ['motivation-letter', 'pdf', 'schedule', 'weekly-report']);
    assert.match(fs.readFileSync(path.join(withLib.dir, 'skills', 'weekly-report', 'SKILL.md'), 'utf8'), /Library copy/);
    const without = S.buildPack('run3', [], { account: true });
    assert.ok(!fs.existsSync(path.join(without.dir, 'skills', 'weekly-report')));
  } finally { done(); }
});

test('account skills: without the option the pack is the library only, as for the Chief', () => {
  const { S, done } = setup();
  try {
    assert.equal(S.buildPack('run4', []), null);
    assert.deepEqual(S.buildPack('run5', ['weekly-report']).skills.map((k) => k.name), ['weekly-report']);
  } finally { done(); }
});
