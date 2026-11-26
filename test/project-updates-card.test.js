// A project update is also structured data, drawn as a card of the block kit (#1755, docs/api.md "Consolidated project updates").
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { clean } = require('../lib/company');
const { card, text } = require('../lib/project-updates');

const base = (extra = {}) => clean({ id: 'qwotz', name: 'Qwotz Development', phase: 'running', startedAt: '2026-11-12T00:00:00Z', teams: [{ id: 't1', name: 'Dev', bots: ['infra', 'qa'], lead: 'infra' }], ...extra });
const snap = (extra = {}) => ({ work: [], blockers: [], replies: [], ...extra });
const since = '2026-11-24T09:00:00.000Z';
const make = (c, s, extra = {}) => card(c, s, { since, language: 'en', ...extra });

test('a quiet update says nothing needs you, names what is in progress and folds the empty sections', () => {
  const c = base();
  const s = snap({
    work: [{ id: 'r1', botId: 'infra', name: 'Infra Admin', state: 'working', text: 'Plan the **database** copy' }, { id: 'todo1', name: 'Mail', state: 'planned', text: 'Decide on Brevo' }],
    replies: [{ id: 'r9', botId: 'qa', name: 'QA Tester', state: 'reply', text: 'Three new issues', at: '2026-11-25T08:41:00.000Z' }],
  });
  const u = make(c, s);
  assert.deepEqual(u.project, { id: 'qwotz', name: 'Qwotz Development' });
  assert.equal(u.since, since);
  assert.equal(u.summary, 'Nothing needs you, 2 in progress');
  assert.deepEqual(u.pills, [{ level: 'ok', text: 'Nothing needs you' }, { level: 'ok', text: 'No blockers' }, { level: 'info', text: '2 in progress' }]);
  assert.deepEqual(u.needs, []);
  assert.deepEqual(u.blockers, []);
  assert.deepEqual(u.goals, []);
  assert.deepEqual(u.done, []);
  assert.deepEqual(u.decisions, []);
  assert.deepEqual(u.work, [
    { botId: 'infra', runId: 'r1', name: 'Infra Admin', text: 'Plan the **database** copy', state: 'working' },
    { name: 'Mail', text: 'Decide on Brevo', state: 'planned' },
  ]);
  assert.deepEqual(u.replies, [{ botId: 'qa', runId: 'r9', name: 'QA Tester', text: 'Three new issues', at: '2026-11-25T08:41:00.000Z' }]);
  assert.equal(u.quiet, 'Nothing marked done, no goal figures, no new decisions.');
});

test('an update with nothing at all is one pill row and one faint line', () => {
  const u = make(base(), snap());
  assert.equal(u.summary, 'Nothing needs you');
  assert.deepEqual(u.pills, [{ level: 'ok', text: 'Nothing needs you' }, { level: 'ok', text: 'No blockers' }]);
  assert.equal(u.quiet, 'Nothing marked done, no goal figures, no new decisions, nothing in progress, no new replies or reports.');
});

test('a busy update carries every section with the ids the apps link by', () => {
  const c = base({
    objectives: [{ id: 'v1', name: 'Version 1.0', steps: [{ text: 'a', done: true }, { text: 'b', done: true }, { text: 'c', done: true }, { text: 'd', done: true }, { text: 'e' }, { text: 'f' }] }, { id: 'issues', name: 'Open issues', current: 19, target: 10 }],
    todos: [{ id: 'old', text: 'Done long ago', done: true, doneAt: '2026-11-20T10:00:00.000Z' }, { id: 'a', text: 'Groq removed from staging (PR #708)', done: true, doneAt: '2026-11-25T07:00:00.000Z' }, { id: 'b', text: 'QA tests written up', done: true, doneAt: '2026-11-25T08:00:00.000Z' }],
    decisions: [{ id: 'd1', text: 'Mail goes through Brevo', at: '2026-11-25T09:00:00.000Z', by: 'you' }, { id: 'd0', text: 'Before the period', at: '2026-11-01T09:00:00.000Z', by: 'you' }],
    teams: [{ id: 't1', name: 'Dev', bots: ['infra', 'qa'], lead: 'infra', lastReport: { text: 'Weekly report: all green', at: '2026-11-25T08:00:00.000Z', bot: 'infra', runId: 'rep1' } }],
  });
  const s = snap({
    work: [{ id: 'r1', botId: 'infra', name: 'Infra Admin', state: 'working', text: 'Plan the copy' }, { id: 'r2', botId: 'qa', name: 'QA Tester', state: 'working', text: 'Regression of the quote' }],
    blockers: [
      { id: 'r5', botId: 'infra', name: 'Infra Admin', state: 'failed', text: 'No access to OVH', at: '2026-11-25T08:00:00.000Z' },
      { id: 'r6', botId: 'qa', name: 'QA Tester', state: 'asks', text: 'May I sign in to staging?', at: '2026-11-25T08:10:00.000Z' },
    ],
    replies: [{ id: 'chief-0', chatId: 'chat1', name: 'Chief', state: 'reply', text: 'Hello', at: '2026-11-25T07:00:00.000Z' }],
  });
  const needs = [{ botId: 'infra', name: 'Infra Admin', text: 'your OK to read the web', cardId: 'ask9' }];
  const u = make(c, s, { needs });
  assert.equal(u.summary, '2 need you, 1 blocker, 2 done, 2 in progress');
  assert.deepEqual(u.pills.map((p) => [p.level, p.text]), [['warn', '2 need you'], ['err', '1 blocker'], ['ok', '2 done'], ['info', '2 in progress']]);
  assert.deepEqual(u.needs, [
    { botId: 'infra', name: 'Infra Admin', text: 'your OK to read the web', cardId: 'ask9' },
    { botId: 'qa', runId: 'r6', name: 'QA Tester', text: 'May I sign in to staging?' },
  ]);
  assert.deepEqual(u.blockers, [{ botId: 'infra', runId: 'r5', name: 'Infra Admin', text: 'No access to OVH' }]);
  assert.deepEqual(u.goals, [
    { id: 'v1', name: 'Version 1.0', value: '4', of: 'of 6 steps', ratio: 4 / 6, level: 'ok' },
    { id: 'issues', name: 'Open issues', value: '19', of: '/ 10', ratio: 1, level: 'warn' },
  ]);
  assert.deepEqual(u.done, [{ id: 'b', text: 'QA tests written up' }, { id: 'a', text: 'Groq removed from staging (PR #708)' }]);
  assert.deepEqual(u.decisions, [{ id: 'd1', text: 'Mail goes through Brevo' }]);
  assert.equal(u.work.find((x) => x.botId === 'qa').state, 'asks', 'a bot that asks says so in its progress row');
  assert.equal(u.work.find((x) => x.botId === 'infra').state, 'working');
  assert.deepEqual(u.replies.map((x) => [x.name, x.botId, x.chatId]), [['Dev', 'infra', undefined], ['Chief', undefined, 'chat1']]);
  assert.equal(u.quiet, undefined, 'nothing is empty but the replies it has');
});

test('a source failure of a goal is a blocker and a goal with no figures is not drawn', () => {
  const c = base({ objectives: [{ id: 'members', name: 'Members', current: 12, target: 50, source: { app: 'hubspot', what: 'Active members', failed: 'HubSpot is not connected' } }, { id: 'tidy', name: 'Tidy up' }] });
  const u = make(c, snap());
  assert.deepEqual(u.blockers, [{ name: 'Members', text: 'HubSpot is not connected' }]);
  assert.deepEqual(u.goals.map((g) => [g.id, g.value, g.of]), [['members', '12', '/ 50']]);
});

test('the text stays as it was for older apps, memory and export', () => {
  const t = text(base(), snap(), { since, language: 'en' });
  assert.match(t, /^Project update: Qwotz Development\n\nMarked done\nNo newly completed items recorded\./);
  assert.match(t, /This update uses recorded activity\. It starts no work and answers or approves nothing\.$/);
});

test('the polish card speaks polish', () => {
  const u = card(base(), snap({ work: [{ id: 'r1', botId: 'infra', name: 'Infra', state: 'working', text: 'x' }] }), { since, language: 'pl' });
  assert.equal(u.summary, 'Nic na ciebie nie czeka, 1 w toku');
  assert.equal(u.pills[1].text, 'Brak blokad');
});

const { startServer, makeBot } = require('./helpers');
test('the update reaches the manager and the Chief chat as data beside its text', async () => {
  const srv = await startServer();
  try {
    assert.ok((await srv.api('/version')).data.features.includes('project-update-card'));
    const boss = await makeBot(srv, { name: 'Garden Manager' });
    const made = (await srv.api('/company', { method: 'POST', body: { empty: true, name: 'Garden launch' } })).data;
    await srv.api(`/company?project=${made.id}`, { method: 'PATCH', body: { lead: boss.id } });
    await srv.api(`/company/decisions?project=${made.id}`, { method: 'POST', body: { text: 'Keep the rainwater tank' } });
    const sent = await srv.api(`/company/updates/now?project=${made.id}`, { method: 'POST', body: { key: 'card-one' } });
    assert.equal(sent.status, 200, JSON.stringify(sent.data));
    assert.match(sent.data.update.text, /^Project update: Garden launch/);
    const run = (await srv.api(`/runs?botId=${boss.id}`)).data.find((r) => r.kind === 'project-update');
    assert.match(run.result, /^Project update: Garden launch/, 'the text stays for older apps');
    assert.equal(run.update.project.name, 'Garden launch');
    assert.equal(run.update.project.id, made.id);
    assert.equal(run.update.summary, 'Nothing needs you');
    assert.deepEqual(run.update.decisions.map((d) => d.text), ['Keep the rainwater tank']);
    // With no manager the Chief's own chat carries it, and the chat's preview says the outcome.
    await srv.api(`/company?project=${made.id}`, { method: 'PATCH', body: { lead: null } });
    const chat = await srv.api(`/company/updates/now?project=${made.id}`, { method: 'POST', body: { key: 'card-two' } });
    const message = (await srv.api(`/chief/chats/${chat.data.update.chatId}`)).data.messages.find((m) => m.projectUpdate === 'card-two');
    assert.match(message.text, /^Project update: Garden launch/);
    assert.equal(message.update.summary, 'Nothing needs you');
    const listed = (await srv.api('/chief')).data.chats.find((x) => x.id === chat.data.update.chatId);
    assert.equal(listed.preview, 'Nothing needs you');
  } finally { await srv.stop(); }
});

test('a team whose report is missing or unavailable is named in notes, as text names it', () => {
  const teams = [
    { id: 't1', name: 'Dev', bots: ['infra'], lead: 'infra', lastReport: { text: 'All green', at: '2026-11-25T08:00:00.000Z', bot: 'infra', runId: 'rep1' } },
    { id: 't2', name: 'Ops', bots: ['qa'], lead: 'qa' },
    { id: 't3', name: 'Sales', bots: ['x'], lead: 'x', lastReport: { unavailable: true, at: '2026-11-25T08:00:00.000Z' } },
    { id: 't4', name: 'Old', bots: ['y'], lead: 'y', lastReport: { text: 'Stale', at: '2026-11-01T08:00:00.000Z', bot: 'y', runId: 'rep0' } },
  ];
  const c = { ...base(), teams };
  const u = make(c, snap());
  assert.deepEqual(u.notes, ['No new recorded team report: Ops.', 'Saved report unavailable for this update: Sales.', 'No new recorded team report: Old.']);
  const t = text(c, snap(), { since, language: 'en' });
  for (const n of u.notes) assert.ok(t.includes(n), `text says it too: ${n}`);
  assert.equal(make({ ...base(), teams: [teams[0]] }, snap()).notes, undefined, 'every team reported: no notes');
});
