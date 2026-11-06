// The Chief loads a shipped skill once in a chat (#1100): the prompt no longer says to load it again every time, and a
// SKILL.md whose text changed with an update changes the instructions' key, so the Chief is told and loads it again.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const chief = require('../lib/chief');

test("a skill's text that changed changes the hash the instructions' key is made with; its order and a folder with no SKILL.md do not", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'skills-'));
  const put = (name, text) => { fs.mkdirSync(path.join(dir, name), { recursive: true }); fs.writeFileSync(path.join(dir, name, 'SKILL.md'), text); };
  put('board', '---\nname: board\ndescription: d\n---\nOne');
  put('pages', '---\nname: pages\ndescription: d\n---\nTwo');
  const first = chief.hashSkillBodies([dir]);
  assert.equal(chief.hashSkillBodies([dir]), first);
  fs.mkdirSync(path.join(dir, 'empty'));
  assert.equal(chief.hashSkillBodies([dir]), first, 'a folder with no SKILL.md');
  put('board', '---\nname: board\ndescription: d\n---\nOne, changed');
  assert.notEqual(chief.hashSkillBodies([dir]), first, 'the same description, another body');
  fs.rmSync(dir, { recursive: true, force: true });
});

test("the prompt tells the Chief to load bot-designer, pages and board once in a chat", () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'chief.js'), 'utf8');
  assert.doesNotMatch(src, /even if you loaded it earlier in this chat/);
  for (const skill of ['chief:bot-designer', 'kit:pages', 'chief:board']) {
    assert.match(src, new RegExp(`load your skill ${skill} with the Skill tool and follow it\\. Load it once in a chat: when botdot says your instructions have changed, or you no longer have the skill's text in this chat, load it again\\.`), skill);
  }
});
