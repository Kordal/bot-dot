// The skill kit:i-have-adhd (ayghri/i-have-adhd, MIT): how every bot and the Chief write to the owner. It ships in
// bot-skills/ with its licence and is always on: its rules are part of the prompt, not a skill to load, and it is
// switched off for one bot as any kit skill (disabledSkills "kit:i-have-adhd").
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, waitFor, ROOT } = require('./helpers');
const { parseSkillMd, kitSkills, kitStyleNote, KIT_DIR } = require('../lib/skills');
const { chiefSkills } = require('../lib/chief');
const replay = require('../lib/replay');

const DIR = path.join(KIT_DIR, 'skills', 'i-have-adhd');

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.stop());

test('it ships with its MIT licence and is named in NOTICE', () => {
  const { meta } = parseSkillMd(fs.readFileSync(path.join(DIR, 'SKILL.md'), 'utf8'));
  assert.equal(meta.name, 'i-have-adhd');
  assert.equal(meta['disable-model-invocation'], 'true');
  const licence = fs.readFileSync(path.join(DIR, 'LICENSE'), 'utf8');
  assert.match(licence, /^MIT License/);
  assert.match(licence, /Copyright \(c\) 2026 Ayoub Ghriss/);
  assert.match(fs.readFileSync(path.join(ROOT, 'NOTICE'), 'utf8'), /bot-skills\/skills\/i-have-adhd: .*MIT, Copyright \(c\) 2026 Ayoub Ghriss/);
});

test('it is the kit\'s one always-on skill: its rules are the style note, not a line in the skills list', () => {
  assert.deepEqual(kitSkills().filter((k) => k.alwaysOn).map((k) => k.name), ['i-have-adhd']);
  const note = kitStyleNote();
  assert.match(note, /^How you write to the owner\./);
  assert.match(note, /### 1\. Lead with the next action/);
  assert.doesNotMatch(note, /disable-model-invocation|^---$/m, 'its frontmatter stays out');
  assert.equal(kitStyleNote(kitSkills(['kit:i-have-adhd'])), '', 'switched off: no note');
  assert.equal(kitStyleNote(kitSkills(['i-have-adhd'])), '', 'by its short name too');
  assert.ok(!chiefSkills().some((x) => x.includes('i-have-adhd')), 'the Chief is not told to load it');
  assert.ok(chiefSkills().some((x) => x.startsWith('- kit:pages: ')));
});

test('a replay writes as the bot does', () => {
  const text = replay.instructions({ bot: { name: 'R', prompt: 'p' }, style: kitStyleNote() });
  assert.match(text, /Lead with the next action/);
});

test("a bot's run has the rules in its prompt; one with it switched off does not", async () => {
  const bot = await makeBot(srv, { name: 'Focus Helper' });
  srv.reply('Done.');
  await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Plan my day' } });
  const run = await srv.nextRun((x) => x.args.includes(`${bot.emoji} ${bot.name}`), "the bot's run");
  assert.match(run.system, /How you write to the owner\.[\s\S]*Lead with the next action/);
  assert.doesNotMatch(run.system, /- kit:i-have-adhd:/);
  assert.match(run.system, /- kit:pages:/);
  await waitFor(async () => !(await srv.api(`/bots/${bot.id}`)).data.running, { what: 'the run to end' });

  await srv.api(`/bots/${bot.id}`, { method: 'PUT', body: { disabledSkills: ['kit:i-have-adhd'] } });
  srv.reply('Done.');
  await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'Again' } });
  const off = await srv.nextRun((x) => x.args.includes(`${bot.emoji} ${bot.name}`), "the bot's second run");
  assert.doesNotMatch(off.system, /How you write to the owner\./);
  await waitFor(async () => !(await srv.api(`/bots/${bot.id}`)).data.running, { what: 'the second run to end' });
});

test("the Chief's turn has the rules in its prompt", async () => {
  srv.reply('Done.');
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'What should I do first today?' } });
  const turn = await srv.nextRun((r) => !!r.botdot, "the Chief's turn");
  await waitFor(async () => !(await srv.api(`/chief/chats/${chat.id}`)).data.busy, { what: 'the Chief to reply' });
  assert.match(turn.system, /How you write to the owner\.[\s\S]*Lead with the next action/);
});
