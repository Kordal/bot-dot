// Projects in the web page's mentions (#700): mentionCtx, escMentions and the project's chip cut out of public/app.js
// and run with public/mentions.js as the page loads it. The rules themselves are the table's (test/fixtures/mentions.json).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { cut } = require('./web-page');

function page(features) {
  const ctx = vm.createContext({
    String, Date,
    state: {
      features, bots: [{ id: 'ops', name: 'Ops', jobs: [] }], skillLib: [],
      mentionPages: [], dash: { tiles: [] },
      mentionProjects: [{ id: 'p1', name: 'Fernhill', color: '#3aa76d' }, { id: 'p2', name: '', color: '#e0a03c' }],
    },
    CHIEF_BOT: { id: 'chief', name: 'Chief of Staff', jobs: [] },
    esc: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'),
    botLabel: (b) => `[${b.name}]`,
    markOf: () => null,
    groupMembers: () => [], groupById: () => null, roomMentionBots: () => [],
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'mentions.js'), 'utf8'), ctx);
  vm.runInContext(`${cut('const mentionCtx = (chat)', '// The account\'s projects, for mentions')}
    ${cut('function escMentions(text, chat)', '// The chip at the start')}
    ${cut('const projectChip = ', 'const markHTML = ')}
    this.mentionCtx = mentionCtx; this.escMentions = escMentions;`, ctx);
  return ctx;
}

test('web: a project is suggested and drawn as its letter and name on a botdot with project-mentions', () => {
  const p = page(['project-mentions']);
  assert.equal(p.escMentions('What is left in @fernhill?', 'ops'),
    'What is left in <span class="mention project-mention" title="@fernhill"><span class="pm-av" style="--c:#3aa76d">F</span>Fernhill</span>?');
  assert.deepEqual(JSON.parse(JSON.stringify(p.Mentions.suggest('@fe', p.mentionCtx('chief')).map((r) => r.text))), ['@Fernhill']);
  assert.equal(p.Mentions.suggest('@fe', p.mentionCtx('group:g1')).length, 1, 'in a group too');
  assert.equal(p.Mentions.suggest('@fe', p.mentionCtx('room:r1')).length, 0, 'never in a shared room');
});

test('web: without the feature, a project is plain text', () => {
  const p = page(['page-mentions']);
  assert.equal(p.escMentions('@Fernhill', 'chief'), '@Fernhill');
  assert.equal(p.Mentions.suggest('@fe', p.mentionCtx('chief')).length, 0);
});
