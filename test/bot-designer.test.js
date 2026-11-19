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
  assert.match(turn.system, /Whenever you are about to make a new bot, load your skill chief:bot-designer with the Skill tool and follow it/);
  for (const path of ['the user\'s request', 'a checkup proposal they picked', 'a plan a bot handed you that they approved', 'added a bot from a project\'s suggestion']) assert.ok(turn.system.includes(path), path);
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

// What the server gives every bot whatever it is saved with (ADR 192, withEverything): the skill must say so, and
// must not tell the Chief to choose any of it.
test('the skill names no setting the server overrides', async () => {
  const saved = (await srv.api('/bots', { method: 'POST', body: { name: 'Read Only Hopeful', prompt: 'Read the logs.', allowedTools: ['Read', 'Grep', 'Glob'], permissionMode: 'dontAsk', computer: 'linux' } })).data;
  const forcedTools = ['WebSearch', 'WebFetch', 'Edit', 'Write'];
  for (const t of forcedTools) assert.ok(saved.allowedTools.includes(t), `the server gives every bot ${t}`);
  assert.equal(saved.permissionMode, 'acceptEdits', 'dontAsk is not kept');
  const text = skill();
  // It says what every bot has, naming each of them.
  const create = text.slice(text.indexOf('## Create'), text.indexOf('## Jobs and the first run'));
  for (const t of [...forcedTools, 'acceptEdits']) assert.ok(create.includes(t), `the skill says every bot has ${t}`);
  // What it tells the Chief to choose names none of them: no "dontAsk", no computer to set, no web or editing to add.
  const choices = create.slice(create.indexOf('What you do choose:'), create.indexOf('2. Read what was saved'));
  assert.ok(choices.length > 200, 'the list of what it does choose');
  for (const t of [...forcedTools, 'dontAsk', 'acceptEdits', 'permissionMode', 'computer']) assert.ok(!choices.includes(t), `"${t}" is not among what the Chief chooses`);
  assert.doesNotMatch(text, /dontAsk|computer "linux"|read-only work gets|research adds/i);
  assert.match(text, /A bot's limits live in what it never does/);
  assert.equal((await srv.api(`/bots/${saved.id}`, { method: 'DELETE' })).status, 200);
});
