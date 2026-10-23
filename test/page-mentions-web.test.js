// Pages and Board tiles in the web page's mentions (#473): mentionCtx and escMentions cut out of public/app.js and run
// with public/mentions.js as the page loads it. The rules themselves are the table's (test/fixtures/mentions.json).
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
      mentionPages: [{ bot: 'ops', slug: 'issue-list', title: 'Issue list' }],
      dash: { tiles: [{ id: 't1', title: 'Living room', kind: 'switch' }, { id: 't2', title: 'Draft', kind: 'note', approved: false }] },
    },
    CHIEF_BOT: { id: 'chief', name: 'Chief of Staff', jobs: [] },
    esc: (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;'),
    botLabel: (b) => `[${b.name}]`,
    markOf: () => null,
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'public', 'mentions.js'), 'utf8'), ctx);
  vm.runInContext(`${cut('const mentionCtx = (chat)', "// The owner's own message with its mentions drawn")}
    ${cut('function escMentions(text, chat)', '// The chip at the start')}
    this.mentionCtx = mentionCtx; this.escMentions = escMentions;`, ctx);
  return ctx;
}

test('web: a page and an approved tile are named and suggested on a botdot with page-mentions', () => {
  const p = page(['page-mentions']);
  const ctx = p.mentionCtx('ops');
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.tiles)), [{ id: 't1', title: 'Living room', kind: 'switch' }], 'a tile that waits is left out');
  assert.equal(p.escMentions('@IssueList and @LivingRoom', 'chief'), '<span class="mention tint">@IssueList</span> and <span class="mention tint">@LivingRoom</span>');
  assert.deepEqual(JSON.parse(JSON.stringify(p.Mentions.suggest('@iss', p.mentionCtx('chief')).map((r) => r.text))), ['@IssueList']);
});

test('web: without the feature, a page is plain text', () => {
  const p = page([]);
  assert.equal(p.escMentions('@IssueList', 'chief'), '@IssueList');
  assert.equal(p.Mentions.suggest('@iss', p.mentionCtx('chief')).length, 0);
});
