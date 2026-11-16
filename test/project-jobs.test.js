// A project's jobs (#1512): a job a bot sets up for a project knows it, deleting the project deletes those jobs (Bart,
// 2026-11-16: deleted, not switched off) and says which in the Chief's chat, and the bots keep their other jobs.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, makeBot, waitFor } = require('./helpers');
const jobs = require('../lib/jobs');

const at = (p, id) => `${p}?project=${encodeURIComponent(id)}`;
const self = (srv, token, body) => srv.api('/self/session/jobs', { method: 'POST', body, headers: { 'X-Run-Token': token } });
const job = (name, more = {}) => ({ action: 'add', name, kind: 'ai', cron: '0 18 * * *', prompt: `Do ${name}.`, assessment: 'Needs AI: it writes.', ...more });
const chiefLines = async (srv) => (await Promise.all((await srv.api('/chief')).data.chats.map(async (c) => (await srv.api(`/chief/chats/${c.id}`)).data.messages))).flat().filter((m) => m.notice).map((m) => m.text);

test('a job keeps the project it serves; an edit that does not name it keeps it, and setting it asks no approval', () => {
  const j = jobs.normalizeJob({ name: 'Daily log', kind: 'ai', cron: '0 18 * * *', project: 'p1' }, null, 'you');
  assert.equal(j.project, 'p1');
  const renamed = jobs.normalizeJob({ name: 'Evening log' }, j, 'bot');
  assert.equal(renamed.project, 'p1');
  assert.equal(renamed.change, undefined, 'no change waits for a name');
  assert.equal(jobs.normalizeJob({ project: null }, j, 'you').project, undefined, 'null: no project');
  assert.equal(jobs.normalizeJob({ name: 'x', project: 'not an id!' }, null, 'you').project, undefined);
  assert.equal(jobs.normalizeJob({ name: 'Own job' }, null, 'you').project, undefined, 'a job of its own has none');
});

test("deleting a project deletes the jobs its bots set up for it, and says which in the Chief's chat; other jobs stay", async (t) => {
  const srv = await startServer();
  t.after(() => srv.stop());
  const writer = await makeBot(srv, { name: 'QA Writer', emoji: '✍️', prompt: 'Writes.' });
  const web = await makeBot(srv, { name: 'QA Web', emoji: '🌐', prompt: 'Reads the web.' });
  const weather = (await srv.api('/company', { method: 'POST', body: { start: 'Weather in Brussels' } })).data.id || (await srv.api('/company/list')).data.projects[0].id;
  await srv.api(at('/company', weather), { method: 'PATCH', body: { name: 'Weather' } });
  await srv.api(at('/company/teams', weather), { method: 'POST', body: { name: 'Weather', bots: [web.id, writer.id], lead: web.id } });
  const other = (await srv.api('/company', { method: 'POST', body: { start: 'Garden' } })).data.id || (await srv.api('/company/list')).data.projects[1].id;
  await srv.api(at('/company/teams', other), { method: 'POST', body: { name: 'Garden', bots: [writer.id], lead: writer.id } });

  // A run of QA Writer's own: one job named for the project, one of its own, one for the other project.
  srv.hold();
  await srv.api(`/bots/${writer.id}/run`, { method: 'POST', body: { prompt: 'Set up the evening log.' } });
  const rec = await srv.nextRun((x) => x.self?.env && x.args.includes('✍️ QA Writer'), 'a run of QA Writer');
  const token = rec.self.env.RUN_TOKEN;
  const forWeather = (await self(srv, token, job('Evening weather log', { project: 'Weather' }))).data;
  assert.equal(forWeather.ok, true, JSON.stringify(forWeather));
  assert.equal(forWeather.job.project, weather);
  const own = (await self(srv, token, job('Own digest'))).data.job;
  assert.equal(own.project, undefined, 'a run outside a team chat names no project by itself');
  const forGarden = (await self(srv, token, job('Water the plants', { project: other }))).data.job;
  assert.equal(forGarden.project, other);
  const wrong = (await self(srv, token, job('Nope', { project: 'Moon base' }))).data;
  assert.equal(wrong.ok, false);
  assert.match(wrong.error, /no team of a project called "Moon base"/);
  srv.release(rec);

  // A job added in the team's chat is for that team's project.
  const chat = await waitFor(async () => (await srv.api('/group-chats')).data.find((g) => g.team && g.members.includes(web.id)), { what: 'the team chat' });
  srv.hold();
  await srv.api(`/group-chats/${chat.id}/messages`, { method: 'POST', body: { text: '@QA Web check the weather each morning' } });
  const inTeam = await srv.nextRun((x) => x.self?.env && x.args.includes('🌐 QA Web'), 'a turn of QA Web in the team chat');
  const teamJob = (await self(srv, inTeam.self.env.RUN_TOKEN, job('Morning weather'))).data.job;
  assert.equal(teamJob.project, weather);
  srv.release(inTeam);
  srv.unhold();

  const before = await chiefLines(srv);
  assert.equal((await srv.api(at('/company', weather), { method: 'DELETE' })).status, 200);
  const names = async (bot) => (await srv.api(`/bots/${bot.id}/jobs`)).data.map((j) => j.name).sort();
  assert.deepEqual(await names(writer), ['Own digest', 'Water the plants'], 'deleted, not switched off; the others stay');
  assert.deepEqual(await names(web), []);
  const said = (await chiefLines(srv)).filter((x) => !before.includes(x));
  assert.equal(said.length, 1, JSON.stringify(said));
  assert.match(said[0], /^Deleted with the project "Weather": 2 scheduled jobs "Evening weather log" of QA Writer, "Morning weather" of QA Web\./);

  // A project with no jobs of its own: nothing is said.
  const lines = (await chiefLines(srv)).length;
  const third = (await srv.api('/company', { method: 'POST', body: { start: 'Empty one' } })).data.id || (await srv.api('/company/list')).data.projects.at(-1).id;
  assert.equal((await srv.api(at('/company', third), { method: 'DELETE' })).status, 200);
  assert.equal((await chiefLines(srv)).length, lines, 'no note when no job went');
});

test('the scheduler starts no job of an archived project', () => {
  const src = fs.readFileSync(path.join(__dirname, '..', 'lib', 'bots.js'), 'utf8');
  const tick = src.slice(src.indexOf('function tick(now = new Date())'), src.indexOf('// ---------- suggestions for the Board'));
  assert.match(tick, /archived = new Set\(company\.list\(\)\.filter\(\(c\) => c\.archived\)\.map\(\(c\) => c\.id\)\)/);
  assert.match(tick, /if \(job\.project && archived\.has\(job\.project\)\) continue;/);
});
