// What a message invokes, drawn as a chip on the web page (Mentions.commandMark): a skill it runs or "/btw" at the
// start of the owner's bubble, the rest as typed. escMentions and markOf are cut out of public/app.js and run with
// public/mentions.js as the page loads it; the rules themselves are the table's (test/fixtures/mentions.json).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { cut } = require('./web-page');
const table = require('./fixtures/mentions.json');

function page(features = ['skill-commands']) {
  const ctx = vm.createContext({
    String, state: { features },
    esc: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
    botLabel: (b) => `[${b.name}]`,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'mentions.js'), 'utf8'), ctx);
  vm.runInContext(`const mentionCtx = (chat) => (String(chat).startsWith('group:') ? { chat, ...${JSON.stringify(table.worlds.group)} } : { chat, ...${JSON.stringify(table.worlds.team)} });
    ${cut('function escMentions(text, chat)', '// What mentions match against')}
    this.escMentions = escMentions;`, ctx);
  return ctx.escMentions;
}

test('web: a skill and "/btw" at the start of your bubble are chips, the rest as typed', () => {
  const draw = page();
  assert.equal(draw('/weekly-report for May', 'fleet'), '<span class="cmd">/weekly-report</span> for May');
  assert.equal(draw('/btw check also the backups', 'fleet'), '<span class="cmd">/btw</span> check also the backups');
  assert.equal(draw('  /BTW <b>', 'chief'), '  <span class="cmd">/BTW</span> &lt;b>');
  assert.equal(draw('/btw ask @FleetDoctor', 'todo'), '<span class="cmd">/btw</span> ask <span class="mention" title="@FleetDoctor">[Fleet Doctor]</span>');
});

test('web: anything else stays plain text', () => {
  const draw = page();
  assert.equal(draw('/tone please', 'fleet'), '/tone please', 'a skill the bot has not');
  assert.equal(draw('/digest', 'chief'), '/digest', 'the Chief chat runs no skill');
  assert.equal(draw('/btw hi', 'group:g1'), '/btw hi', 'a group');
  assert.equal(draw('hello /btw', 'fleet'), 'hello /btw');
  assert.equal(page([])('/digest now', 'fleet'), '/digest now', 'a botdot that runs no "/"');
});
