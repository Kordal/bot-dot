// The Chief's skill chief:bot-designer (#33): how it turns "I need a bot that does X" into a working bot. It ships
// in chief-skills/ like chief:board and chief:memory-setup, the Chief is told to load it for a new bot, and it
// names only tools the Chief has.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, waitFor, ROOT } = require('./helpers');
const { TOOLS } = require('../lib/mcp-server');
const { parseSkillMd } = require('../lib/skills');
const { chiefSkills } = require('../lib/chief');

const FILE = path.join(ROOT, 'chief-skills', 'skills', 'bot-designer', 'SKILL.md');
const skill = () => fs.readFileSync(FILE, 'utf8');

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.stop());

test('the skill parses, is named bot-designer and is listed among the Chief\'s skills', () => {
  const { meta, body } = parseSkillMd(skill());
  assert.equal(meta.name, 'bot-designer');
  assert.match(meta.description, /new bot/);
  assert.match(body, /^# /m);
  const line = chiefSkills().find((x) => x.startsWith('- chief:bot-designer: '));
  assert.ok(line, 'chief:bot-designer is listed');
  for (const other of ['board', 'memory-setup']) assert.ok(chiefSkills().some((x) => x.startsWith(`- chief:${other}: `)), other);
});

test("the Chief's instructions tell it to load chief:bot-designer for a new bot", async () => {
  srv.reply('Done.');
  const chat = (await srv.api('/chief/chats', { method: 'POST' })).data;
  await srv.api(`/chief/chats/${chat.id}/messages`, { method: 'POST', body: { text: 'I need a bot that watches my server.' } });
  const turn = await srv.nextRun((r) => !!r.botdot, "the Chief's turn");
  await waitFor(async () => !(await srv.api(`/chief/chats/${chat.id}`)).data.busy, { what: 'the Chief to reply' });
  assert.match(turn.system, /When the user asks for a new bot or agent, load your skill chief:bot-designer with the Skill tool and follow it/);
});

test('every tool the skill names in backticks is a tool of the Chief', () => {
  const names = new Set(TOOLS.map((x) => x.name));
  const named = [...new Set([...skill().matchAll(/`([a-z]+(?:_[a-z]+)+)`/g)].map((m) => m[1]))];
  assert.ok(named.length >= 8, `it names the tools it uses (${named.join(', ')})`);
  assert.deepEqual(named.filter((name) => !names.has(name)), []);
  for (const name of ['list_bots', 'create_bot', 'update_bot', 'get_bot', 'add_job', 'run_bot', 'request_login', 'list_vault', 'list_connectors']) {
    assert.ok(named.includes(name), name);
  }
});

test('the skill is generic, plain and keeps the known setup traps', () => {
  const text = skill();
  assert.doesNotMatch(text, /—/, 'no em dashes');
  assert.doesNotMatch(text, /\b\d{1,3}(\.\d{1,3}){3}\b/, 'no addresses');
  assert.doesNotMatch(text, /Info \/ Research|House \/ Life|Writing \/ Mail/, "no one person's folders");
  assert.doesNotMatch(text, /section id|manual drag/i, 'a category is a name set at create, not a section to drag into');
  for (const trap of ['Discord', 'Message Content Intent', 'GitHub', 'classic token', 'New VPS', 'Box updates']) assert.ok(text.includes(trap), trap);
});
