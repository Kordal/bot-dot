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
  assert.equal('goal' in result, false); // the overview has no Goal section (2026-11-15)
  assert.ok(result.work.some((x) => x.id === 'work' && x.state === 'working' && x.text === '')); // an original request is not a recorded action line
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
    assert.equal('goal' in response.data, false);
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

test('an entry keeps the Markdown and lines the bot wrote, cut at 600 characters never inside a link or an open code block', () => {
  const { overview } = require('../lib/project-overview');
  const at = '2026-11-13T12:00:00Z';
  const of = (result) => overview({ id: 'p', bots: ['b'] }, { bots: [{ id: 'b', name: 'B' }], runs: [{ id: 'r', botId: 'b', status: 'success', result, endedAt: at }], now: at }).replies[0].text;
  const list = 'Done:\r\n- close [#252](https://github.com/o/r/issues/252)   \n\n\n\n- review **PR #374**';
  assert.equal(of(list), 'Done:\n- close [#252](https://github.com/o/r/issues/252)\n\n- review **PR #374**');
  const link = `${'word '.repeat(115)}[#23](https://github.com/o/r/issues/23) after`;
  assert.equal(of(link), `${'word '.repeat(114)}word…`, 'a link that does not fit is left out whole');
  const fence = `${'word '.repeat(100)}\n\`\`\`\n${'code '.repeat(40)}\n\`\`\``;
  assert.equal(of(fence), `${'word '.repeat(99)}word…`, 'a code block that does not fit is left out whole');
  assert.equal(of(`${'word '.repeat(118)}**bold text here** end`), `${'word '.repeat(117)}word…`, 'an open bold is left out');
  assert.equal(of(`${'word '.repeat(118)}\`code here\` end`), `${'word '.repeat(117)}word…`, 'an open code is left out');
  const block = '```\nls src/**/*.js `x\n```';
  assert.equal(of(`${block}\n${'word '.repeat(120)}`), `${block}\n${'word '.repeat(113)}word…`, 'a mark inside a closed code block is no open mark');
  const log = `\`\`\`\n${'error at line 12\n'.repeat(60)}\`\`\``;
  const cut = of(log);
  assert.match(cut, /^```\nerror at line 12\n[\s\S]*error at line 12…\n```$/, 'a reply that opens with a long code block keeps its lines, closed');
  assert.ok(cut.length <= 605);
  assert.ok(of('x'.repeat(700)).length <= 601);
});
