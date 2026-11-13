// Consolidated project updates use the same public API and chats as the owner.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, restartServer, setQueue, waitFor, makeBot } = require('./helpers');
let srv;
before(async () => { srv = await startServer(); });
after(() => srv?.stop());

test('one project update preference replaces the report controls without deleting old schedules', async () => {
  const made = await srv.api('/company', { method: 'POST', body: { start: 'Launch the garden club' } });
  const id = made.data.id;
  const url = `/company/updates?project=${id}`;
  assert.ok((await srv.api('/version')).data.features.includes('project-updates'));
  const old = (await srv.api(`/company?project=${id}`)).data.company;
  assert.equal(old.updates.every, 'existing');
  const changed = await srv.api(url, { method: 'PUT', body: { every: 'weekly' } });
  assert.equal(changed.status, 200, JSON.stringify(changed.data));
  assert.equal(changed.data.updates.every, 'weekly');
  assert.deepEqual(changed.data.standup, old.standup, 'the old setting is retained for compatibility');
  assert.equal((await srv.api(url, { method: 'PUT', body: { every: 'hourly' } })).status, 400);
  assert.equal((await srv.api(url, { method: 'PUT', body: { every: 'off' } })).data.updates.every, 'off');
});

test('an update reaches the selected manager once and leaves its unanswered question open', async () => {
  const { makeBot, waitFor } = require('./helpers');
  const fs = require('fs');
  const path = require('path');
  const boss = await makeBot(srv, { name: 'Garden Manager', emoji: '🌿' });
  fs.writeFileSync(path.join(srv.out, 'result-GardenManager.txt'), 'Which date?\n[[choices: Monday | Friday]]');
  await srv.api(`/bots/${boss.id}/run`, { method: 'POST', body: { prompt: 'Ask me for the date' } });
  await waitFor(async () => (await srv.api(`/bots/${boss.id}`)).data.asks, { what: 'the manager question' });
  const question = (await srv.api(`/bots/${boss.id}`)).data.asks;
  const made = await srv.api('/company', { method: 'POST', body: { empty: true, name: 'Garden launch' } });
  const id = made.data.id;
  await srv.api(`/company?project=${id}`, { method: 'PATCH', body: { lead: boss.id, objectives: [{ id: 'signups', name: 'Sign-ups', current: 12, target: 50 }] } });
  await srv.api(`/company/objectives/signups?project=${id}`, { method: 'PUT', body: { source: { app: 'hubspot', what: 'Active members' } } });
  await waitFor(async () => (await srv.api(`/company?project=${id}`)).data.company.objectives[0].source.failed, { what: 'recorded source failure' });
  const job = (await srv.asChief(`/bots/${boss.id}/jobs`, { method: 'POST', body: { name: 'Disk check', kind: 'script', cron: '0 3 * * *', script: 'df -h', assessment: 'Read disk usage' } })).data;
  assert.equal(job.approved, false);
  const url = `/company/updates/now?project=${id}`;
  const sent = await srv.api(url, { method: 'POST', body: { key: 'garden-update-once' } });
  assert.equal(sent.status, 200, JSON.stringify(sent.data));
  assert.equal(sent.data.update.botId, boss.id);
  assert.match(sent.data.update.text, /Garden launch/);
  assert.match(sent.data.update.text, /Sign-ups: 12 \/ 50/);
  assert.match(sent.data.update.text, /is not connected/);
  assert.match(sent.data.update.text, /Needs you/);
  assert.match(sent.data.update.text, /Which date/);
  assert.deepEqual((await srv.api(`/bots/${boss.id}`)).data.asks, question, 'a summary is no answer');
  const again = await srv.api(url, { method: 'POST', body: { key: 'garden-update-once' } });
  assert.equal(again.data.update.key, sent.data.update.key);
  const updates = (await srv.api(`/runs?botId=${boss.id}`)).data.filter((r) => r.kind === 'project-update');
  assert.equal(updates.length, 1);
  assert.equal(updates[0].trigger, 'project');
  assert.equal(updates[0].numTurns, 0, 'an update starts no bot or team turn');
  assert.equal((await srv.api(`/bots/${boss.id}`)).data.unread, 2, 'the summary is a new reply');
  assert.equal((await srv.api(`/bots/${boss.id}/jobs`)).data.find((j) => j.id === job.id).approved, false, 'a summary grants nothing');
  await srv.api(`/memory/runs/${question.runId}`, { method: 'PUT', body: { excluded: true } });
  const privateQuestion = await srv.api(url, { method: 'POST', body: { key: 'garden-private-question' } });
  assert.doesNotMatch(privateQuestion.data.update.text, /Which date/);
  assert.match(privateQuestion.data.update.text, /A question waits in this chat/);
  assert.deepEqual((await srv.api(`/bots/${boss.id}`)).data.asks, question, 'the owner still sees the original question');
  const replacement = await makeBot(srv, { name: 'New Garden Manager' });
  await srv.api(`/company?project=${id}`, { method: 'PATCH', body: { lead: replacement.id } });
  assert.equal((await srv.api(url, { method: 'POST', body: { key: 'garden-new-manager' } })).data.update.botId, replacement.id);
  await srv.api(`/company/decisions?project=${id}`, { method: 'POST', body: { text: 'Keep the rainwater tank' } });
  const repeated = await srv.api(url, { method: 'POST', body: { key: 'garden-update-once' } });
  assert.equal(repeated.data.update.botId, boss.id, 'an old delivery key keeps its original destination');
  assert.equal((await srv.api(`/runs?botId=${replacement.id}`)).data.filter((r) => r.kind === 'project-update').length, 1);
  const fresh = await srv.api(url, { method: 'POST', body: { key: 'garden-after-replay' } });
  assert.match(fresh.data.update.text, /Keep the rainwater tank/, 'replaying an old key cannot skip newer activity');
  await srv.api(`/company?project=${id}`, { method: 'PATCH', body: { lead: null } });
  const fallback = await srv.api(url, { method: 'POST', body: { key: 'garden-chief-update' } });
  const company = (await srv.api(`/company?project=${id}`)).data.company;
  assert.equal(fallback.data.update.chatId, company.chiefChat);
  assert.ok((await srv.api(`/chief/chats/${company.chiefChat}`)).data.messages.some((m) => m.projectUpdate === 'garden-chief-update'));
  srv = await restartServer(srv);
  assert.deepEqual((await srv.api(`/bots/${boss.id}`)).data.asks, question, 'question survives restart after a summary');
  assert.equal((await srv.api(url, { method: 'POST', body: { key: 'garden-update-once' } })).data.update.botId, boss.id);
  assert.equal((await srv.asChief(url, { method: 'POST', body: { key: 'unasked-loop' } })).status, 403);
  await srv.api(`/bots/${boss.id}/run`, { method: 'POST', body: { prompt: 'Read the current goal' } });
  const next = await srv.nextRun((r) => r.stdin.includes('Read the current goal'), 'a fresh manager turn');
  assert.doesNotMatch(next.stdin + next.system, /Which date/, 'an earlier server summary cannot revive left-out chat text');
});


test('an upgrade removes only queued legacy report automation and preserves approved plan work', async () => {
  const lead = await makeBot(srv, { name: 'Migration Lead' });
  const made = (await srv.api('/company', { method: 'POST', body: { empty: true, name: 'Migrated project' } })).data;
  const id = made.id;
  const withTeam = (await srv.api(`/company/teams?project=${id}`, { method: 'POST', body: { name: 'Garden', bots: [lead.id], report: 'weekly' } })).data;
  const team = withTeam.teams[0];
  srv = await restartServer(srv, (data) => setQueue(data, (q) => {
    q.queues[lead.id] = [
      { kind: 'project', key: `project:ask:${team.id}`, prompt: 'OBSOLETE_REPORT_QUESTION' },
      { kind: 'project', key: `project:report:${team.id}`, prompt: 'OBSOLETE_SEPARATE_REPORT' },
      { kind: 'project', key: `project:plan:${team.id}:approved`, prompt: 'APPROVED_PLAN_WORK' },
    ];
  }));
  await waitFor(async () => (await srv.api(`/runs?botId=${lead.id}`)).data.some((r) => r.prompt === 'APPROVED_PLAN_WORK' && r.status !== 'running'), { what: 'approved plan survives upgrade' });
  const runs = (await srv.api(`/runs?botId=${lead.id}`)).data;
  assert.ok(runs.every((r) => !/OBSOLETE_/.test(r.prompt || '')));
  const migrated = (await srv.api(`/company?project=${id}`)).data.company;
  assert.ok(migrated.updatePendingAt, 'the old opted-in report becomes one pending consolidated update');
});


test('a failed delivery stays failed until the same key succeeds', { skip: process.getuid?.() === 0 && 'root bypasses filesystem permissions' }, async () => {
  const fs = require('fs');
  const path = require('path');
  const bot = await makeBot(srv, { name: 'Delivery Manager' });
  const c = (await srv.api('/company', { method: 'POST', body: { empty: true, name: 'Delivery retry' } })).data;
  await srv.api(`/company?project=${c.id}`, { method: 'PATCH', body: { lead: bot.id } });
  const url = `/company/updates/now?project=${c.id}`;
  const runs = path.join(srv.data, 'runs');
  const mode = fs.statSync(runs).mode & 0o777;
  try {
    fs.chmodSync(runs, 0o500);
    const failed = await srv.api(url, { method: 'POST', body: { key: 'failed-delivery-retry' } });
    assert.ok(failed.status >= 400);
    assert.ok((await srv.api(`/company?project=${c.id}`)).data.company.lastUpdate.error);
  } finally { fs.chmodSync(runs, mode); }
  const retried = await srv.api(url, { method: 'POST', body: { key: 'failed-delivery-retry' } });
  assert.equal(retried.status, 200, JSON.stringify(retried.data));
  assert.equal((await srv.api(`/company?project=${c.id}`)).data.company.lastUpdate.error, undefined);
  assert.equal((await srv.api(`/runs?botId=${bot.id}`)).data.filter((r) => r.kind === 'project-update').length, 1);
});


test('a report from a left-out run is not copied into a new bot-readable update', async () => {
  const { heldRun, self } = require('./helpers');
  const lead = await makeBot(srv, { name: 'Report Privacy Lead' });
  const c = (await srv.api('/company', { method: 'POST', body: { empty: true, name: 'Private report' } })).data;
  await srv.api(`/company/teams?project=${c.id}`, { method: 'POST', body: { name: 'Garden', bots: [lead.id] } });
  const held = await heldRun(srv, lead, 'Write the team report');
  await self(srv, held.token, 'team-report', { text: 'PRIVATE_REPORT_ORCHID', project: c.id });
  srv.unhold(); srv.release(held.rec);
  await waitFor(async () => !(await srv.api(`/bots/${lead.id}`)).data.running, { what: 'report run ends' });
  await srv.api(`/memory/runs/${held.run.id}`, { method: 'PUT', body: { excluded: true } });
  const after = (await srv.api('/company/updates/now?project=' + c.id, { method: 'POST', body: { key: 'report-after-forget' } })).data;
  assert.doesNotMatch(after.update.text, /PRIVATE_REPORT_ORCHID/);
});
