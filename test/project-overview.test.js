const { test } = require('node:test');
const assert = require('node:assert/strict');

test('the overview separates recorded work, blockers and replies without inventing progress or mixing team chats', () => {
  const { overview } = require('../lib/project-overview');
  const c = { id: 'p1', goal: 'Launch the site', bots: ['writer'], lead: 'manager', teams: [{ id: 't1', bots: ['scout'] }], todos: [{ id: 'todo', text: 'Review copy' }] };
  const result = overview(c, {
    bots: [{ id: 'writer', name: '<Writer>' }, { id: 'manager', name: 'Manager' }, { id: 'scout', name: 'Scout' }],
    groups: [{ id: 'g1', team: 't1' }, { id: 'g2', team: 'other' }],
    runs: [
      { id: 'wrong', botId: 'scout', groupId: 'g2', status: 'success', result: 'Other project', startedAt: '2026-11-13T15:00:00Z' },
      { id: 'work', botId: 'manager', status: 'running', prompt: 'Coordinate launch', startedAt: '2026-11-13T14:00:00Z' },
      { id: 'bad', botId: 'scout', groupId: 'g1', status: 'error', error: 'Cannot connect', startedAt: '2026-11-13T13:00:00Z' },
      { id: 'reply', botId: 'writer', status: 'success', result: '<b>Draft ready</b>', endedAt: '2026-11-13T12:00:00Z' },
      { id: 'unfinished', botId: 'writer', status: 'running', result: 'Still writing', startedAt: '2026-11-13T11:00:00Z' },
    ],
    asks: new Map([['writer', { text: 'Which headline?', runId: 'reply', at: '2026-11-13T12:00:00Z' }]]),
    now: '2026-11-13T16:00:00Z',
  });
  assert.equal(result.goal, 'Launch the site');
  assert.ok(result.work.some((x) => x.id === 'work' && x.state === 'working'));
  assert.ok(result.work.some((x) => x.id === 'todo' && x.state === 'planned'));
  assert.ok(result.blockers.some((x) => x.id === 'bad' && x.state === 'failed'));
  assert.ok(result.blockers.some((x) => x.text === 'Which headline?'));
  assert.deepEqual(result.replies.map((x) => x.id), ['reply']);
  assert.equal(result.replies[0].text, '<b>Draft ready</b>'); // text, never markup
  assert.equal(JSON.stringify(result).includes('Other project'), false);
});

test('the owner reads the overview over the API without changing the saved Board or creating a Chief chat', async () => {
  const path = require('node:path');
  const { startServer, makeBot, writeData, heldRun } = require('./helpers');
  const srv = await startServer();
  try {
    const bot = await makeBot(srv, { name: 'Writer' });
    writeData(path.join(srv.data, 'company.json'), { id: 'overview', name: 'Launch', start: 'A launch', phase: 'running', goal: 'Publish the site', bots: [bot.id], board: ['goals'], layout: { 'goal:g1': [0, 0, 400, 200] }, objectives: [{ id: 'g1', name: 'Draft', current: 0, target: 1 }] });
    const before = (await srv.api('/company')).data.company;
    const response = await srv.api('/company/overview?project=overview');
    assert.equal(response.status, 200, JSON.stringify(response.data));
    assert.equal(response.data.projectId, 'overview');
    assert.equal(response.data.goal, 'Publish the site');
    assert.deepEqual(response.data.work, []);
    assert.deepEqual(response.data.replies, []);
    assert.ok((await srv.api('/version')).data.features.includes('project-overview'));
    const after = (await srv.api('/company')).data.company;
    assert.deepEqual(after.board, before.board);
    assert.deepEqual(after.layout, before.layout);
    assert.equal(after.chiefChat, before.chiefChat);
    assert.equal((await srv.asChief('/company/overview?project=overview')).status, 403);
    assert.equal((await srv.api('/company/overview?project=gone')).status, 404);
    const running = await heldRun(srv, bot, 'Draft the launch');
    const active = (await srv.api('/company/overview?project=overview')).data;
    assert.ok(active.work.some((x) => x.id === running.run.id && x.state === 'working'));
    assert.equal(active.replies.some((x) => x.id === running.run.id), false);
    srv.unhold(); srv.release(running.rec); await srv.finished(running.run.id);
    const finished = (await srv.api('/company/overview?project=overview')).data;
    assert.ok(finished.replies.some((x) => x.id === running.run.id && x.state === 'reply'));

  } finally { await srv.stop(); }
});

test('current team questions and file-only replies are visible, while internal or unfinished output is not a result', () => {
  const { overview } = require('../lib/project-overview');
  const result = overview({ id: 'p', bots: ['b'], teams: [{ id: 't', bots: ['b'] }] }, {
    bots: [{ id: 'b', name: 'Writer' }],
    groups: [{ id: 'g', team: 't', asks: { runId: 'q', botId: 'b', botName: 'Writer', text: 'Publish it?', at: '2026-11-13T12:00:00Z' } }],
    runs: [
      { id: 'file', botId: 'b', status: 'success', files: [{ name: 'report.pdf' }], endedAt: '2026-11-13T12:00:00Z' },
      { id: 'internal', botId: 'b', status: 'success', result: 'Internal note', notificationAudience: 'internal' },
      { id: 'quiet', botId: 'b', status: 'success', result: 'Quiet check', reporting: 'quiet' },
    ],
    chief: { chatId: 'chief-p', name: 'Chief', messages: [{ role: 'chief', pending: true, text: 'Still writing' }] },
  });
  assert.deepEqual(result.replies.map((r) => r.text), ['report.pdf']);
  assert.ok(result.blockers.some((r) => r.groupId === 'g' && r.text === 'Publish it?'));
});
