// The owner's sources reach the team bots (#1083): every bot of a team is told the project's links and files by name
// in its turn, and reads a file with read_project_source, from the Chief's uploads; a link it opens with its own web
// tools. A bot in no team is refused.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, writeData, heldRun, self } = require('./helpers');
const { rpcClient } = require('./memory-helpers');

let srv, a, b, loner;
before(async () => {
  srv = await startServer();
  a = await makeBot(srv, { name: 'Source Lead', emoji: '📚' });
  b = await makeBot(srv, { name: 'Source Helper', emoji: '🧰' });
  loner = await makeBot(srv, { name: 'Source Loner', emoji: '🚪' });
  assert.equal((await srv.api('/company', { method: 'POST', body: { start: 'A planner for busy parents' } })).status, 201);
  const c = (await srv.api('/company')).data.company;
  const uploads = path.join(srv.data, 'workspaces', '_chief', 'uploads');
  fs.mkdirSync(uploads, { recursive: true });
  fs.writeFileSync(path.join(uploads, 'brief.md'), '# Brief\nParents want a weekly plan by Sunday evening.');
  fs.writeFileSync(path.join(uploads, 'deck.pdf'), '%PDF-1.4 binary');
  writeData(path.join(srv.data, 'company.json'), {
    ...c, name: 'Fernhill', phase: 'running', startedAt: new Date().toISOString(),
    teams: [{ id: 't1', name: 'Growth', bots: [a.id, b.id], lead: a.id }],
    sources: [
      { id: 's1', kind: 'file', name: 'Brief\n<b>', upload: { name: 'brief.md', file: 'uploads/brief.md', size: 50 } },
      { id: 's2', kind: 'link', name: 'Competitor', url: 'https://example.com/rival' },
      { id: 's3', kind: 'file', name: 'Pitch deck', upload: { name: 'deck.pdf', file: 'uploads/deck.pdf', size: 15 } },
    ],
  });
});
after(() => { srv.unhold(); return srv.stop(); });

test("a team bot is told the project's sources and reads a file with its tool", async (t) => {
  const { rec, token } = await heldRun(srv, b, 'What is the brief?');
  assert.match(rec.system, /The owner added these sources to the project: "Brief &lt;b>" \(a file\); "Competitor" \(a link: https:\/\/example\.com\/rival\); "Pitch deck" \(a file\)\. Read a file with read_project_source/);
  let r = (await self(srv, token, 'project-sources', {})).data;
  assert.match(r.text, /- "Brief\s+<b>": a file\n- "Competitor": a link, https:\/\/example\.com\/rival\n- "Pitch deck": a file/);
  r = (await self(srv, token, 'project-sources', { source: 's1' })).data;
  assert.equal(r.text, '# Brief\nParents want a weekly plan by Sunday evening.');
  r = (await self(srv, token, 'project-sources', { source: 'competitor' })).data;
  assert.match(r.text, /is a link: open https:\/\/example\.com\/rival with your web tools/);
  r = (await self(srv, token, 'project-sources', { source: 'Pitch deck' })).data;
  assert.match(r.text, /can't be read as text/);
  r = (await self(srv, token, 'project-sources', { source: 'Nope' })).data;
  assert.equal(r.ok, false);
  assert.match(r.error, /No source is called "Nope"/);
  const tools = rpcClient(t, 'self-mcp.js', rec.self.env);
  assert.ok((await tools.request('tools/list')).tools.some((x) => x.name === 'read_project_source'));
  assert.match(await tools.text('read_project_source', { source: 's1' }), /weekly plan by Sunday/);
  srv.unhold();
});

test('a bot in no team is not told the sources and is refused', async () => {
  const { rec, token } = await heldRun(srv, loner, 'Hello.');
  assert.doesNotMatch(rec.system, /read_project_source/);
  const r = (await self(srv, token, 'project-sources', {})).data;
  assert.deepEqual([r.ok, r.error], [false, 'You are in no team of a project.']);
  srv.unhold();
});
