// The Company's Team step (#671): the Chief proposes the team from the About answers, "Change the team…" changes it
// with Undo, Duplicate puts a copy "<bot> (<company>)" in it, and Create makes the bots and teams once.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot } = require('./helpers');
const teamLib = require('../lib/company-team');

let srv; let helper;
const TEAM = { bots: [
  { name: 'Market Scout', description: 'Finds who else does this', prompt: 'Find competitors. Never contacts anyone.', owns: ['Research notes'], connects: [], tools: ['WebSearch', 'Bash'], routines: 'Mondays 8:00', cron: '0 8 * * 1', asksFirst: 'rules', preview: 'Brief on 12 apps', team: 'Growth' },
  { name: 'Landing Page', description: 'Builds the landing page', prompt: 'Build the page.', owns: ['Landing page'], connects: [], routines: 'Daily 7:00', cron: 'every day', asksFirst: 'every', preview: 'Page live', team: 'Growth' },
  { name: 'Outreach', description: 'Drafts interview invites', prompt: 'Draft invites.', owns: ['Your Gmail'], connects: ['Gmail', '<b>'], routines: 'Daily 9:00', cron: '0 9 * * *', asksFirst: 'nope', preview: '', team: 'Sales' },
] };
const fake = (name, v) => fs.writeFileSync(path.join(srv.out, name), typeof v === 'string' ? v : JSON.stringify(v));
const asked = () => fs.readdirSync(srv.out).filter((f) => f.startsWith('company-') && /\d\.txt$/.test(f)).sort().map((f) => fs.readFileSync(path.join(srv.out, f), 'utf8'));

before(async () => {
  srv = await startServer();
  helper = await makeBot(srv, { name: 'Inbox Helper', emoji: '📥', description: 'Sorts your Gmail' });
});
after(async () => { await srv.stop(); });

test('the question carries what the owner said, and a copy is named for the company', () => {
  const c = { kind: 'idea', start: 'A meal planner for parents', name: 'Mealwise', about: [{ question: 'Who is it for?', answer: 'Parents' }], stories: [], swot: { strengths: [], weaknesses: [], opportunities: [], threats: [], firstTest: 'Ask 10 parents' }, goal: '10 parents a week', never: ['Spend money'], time: '' };
  const q = teamLib.question(c, { apps: ['gmail'] });
  for (const s of ['A new idea: A meal planner', 'Who is it for? Parents', 'First test: Ask 10 parents', '90-day goal: 10 parents a week', 'Spend money', 'gmail', 'first week']) assert.ok(q.includes(s), s);
  assert.ok(teamLib.question({ ...c, kind: 'site' }).includes('yesterday'));
  assert.equal(teamLib.copyOf({ id: 'x', name: 'Research Assistant' }, { name: 'Mealwise' }).name, 'Research Assistant (Mealwise)');
  assert.equal(teamLib.copyOf({ id: 'x', name: 'Research Assistant' }, { name: '' }).name, 'Research Assistant 2');
  assert.deepEqual(teamLib.json('Sure: {"bots": []} done'), { bots: [] });
  assert.equal(teamLib.json('no'), null);
});

test('the Chief proposes the team; what it wrote is cut to the shape', async () => {
  assert.equal((await srv.api('/company/proposal', { method: 'POST' })).status, 404);
  await srv.api('/company', { method: 'POST', body: { start: 'A meal planner for busy parents' } });
  await srv.api('/company', { method: 'PATCH', body: { name: 'Mealwise', never: ['E-mail someone new'], goal: '10 parents use it every week', swot: { firstTest: 'Ask 10 parents to pre-order' } } });
  fake('company-fails', '');
  assert.equal((await srv.api('/company/proposal', { method: 'POST' })).status, 502);
  fs.rmSync(path.join(srv.out, 'company-fails'));
  fake('company-team.txt', 'nothing useful');
  assert.equal((await srv.api('/company/proposal', { method: 'POST' })).status, 502);
  fake('company-team.txt', TEAM);
  assert.equal((await srv.asChief('/company/proposal', { method: 'POST' })).status, 403);
  const r = await srv.api('/company/proposal', { method: 'POST' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const p = r.data.proposal;
  assert.deepEqual(p.map((x) => x.name), ['Market Scout', 'Landing Page', 'Outreach']);
  assert.deepEqual(p[0].tools, ['WebSearch']);
  assert.equal(p[0].cron, '0 8 * * 1');
  assert.equal(p[1].cron, undefined);
  assert.deepEqual(p[2].connects, ['gmail']);
  assert.equal(p[2].asksFirst, 'rules');
  assert.ok(p.every((x) => x.key && /^#[0-9a-f]{6}$/.test(x.color)));
  assert.equal(r.data.canUndo, false);
  assert.equal(r.data.facts, 3);
  assert.ok(asked().at(-1).includes('10 parents use it every week'));
});

test('"Change the team…" changes it with the Chief\'s line, and Undo takes it back', async () => {
  const before = (await srv.api('/company')).data.company.proposal;
  fake('company-chat.txt', { say: 'Renamed Market Scout to Research.', bots: before.map((b) => (b.name === 'Market Scout' ? { ...b, name: 'Research', bot: 'sneaky', from: 'nobody' } : b)) });
  let r = await srv.api('/company/proposal/chat', { method: 'POST', body: { text: 'Rename Market Scout to Research' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.proposal.map((x) => x.name), ['Research', 'Landing Page', 'Outreach']);
  assert.equal(r.data.proposal[0].key, before[0].key);
  assert.equal(r.data.proposal[0].bot, undefined);
  assert.equal(r.data.proposal[0].from, undefined);
  assert.deepEqual(r.data.teamChat, [{ who: 'you', text: 'Rename Market Scout to Research' }, { who: 'chief', text: 'Renamed Market Scout to Research.', undo: true }]);
  assert.equal(r.data.canUndo, true);
  assert.ok(asked().at(-1).includes('"Rename Market Scout to Research"'));
  // An answer without a team changes nothing and says why.
  fake('company-chat.txt', { say: 'I can only change the team.' });
  r = await srv.api('/company/proposal/chat', { method: 'POST', body: { text: 'Order pizza' } });
  assert.deepEqual(r.data.proposal.map((x) => x.name), ['Research', 'Landing Page', 'Outreach']);
  assert.equal(r.data.teamChat.at(-1).text, 'I can only change the team.');
  assert.equal(r.data.teamChat.at(-3).undo, true); // the change before it is still the one Undo takes back
  r = await srv.api('/company/proposal/undo', { method: 'POST' });
  assert.deepEqual(r.data.proposal.map((x) => x.name), ['Market Scout', 'Landing Page', 'Outreach']);
  assert.ok(r.data.teamChat.every((m) => !m.undo));
  assert.equal((await srv.api('/company/proposal/undo', { method: 'POST' })).status, 409);
  assert.equal((await srv.api('/company/proposal/chat', { method: 'POST', body: { text: ' ' } })).status, 400);
});

test("Duplicate puts a copy named for the company in the team once; the owner's own edits undo too", async () => {
  assert.equal((await srv.api('/company/proposal/duplicate', { method: 'POST', body: { bot: 'gone' } })).status, 404);
  let r = await srv.api('/company/proposal/duplicate', { method: 'POST', body: { bot: helper.id } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const copy = r.data.proposal.at(-1);
  assert.deepEqual([copy.name, copy.from, copy.description], ['Inbox Helper (Mealwise)', helper.id, 'Sorts your Gmail']);
  assert.equal(r.data.teamChat.at(-1).text, 'Added a copy of Inbox Helper.');
  r = await srv.api('/company/proposal/duplicate', { method: 'POST', body: { bot: helper.id } });
  assert.equal(r.data.proposal.filter((x) => x.from === helper.id).length, 1);
  // Removing a card and toggling a routine are the owner's PATCH, and Undo brings the card back.
  const all = r.data.proposal;
  r = await srv.api('/company', { method: 'PATCH', body: { proposal: all.filter((x) => x.name !== 'Landing Page').map((x) => ({ ...x, bot: helper.id })) } });
  assert.equal(r.data.proposal.length, 3);
  assert.ok(r.data.proposal.every((x) => !x.bot));
  r = await srv.api('/company/proposal/undo', { method: 'POST' });
  assert.deepEqual(r.data.proposal.map((x) => x.name), ['Market Scout', 'Landing Page', 'Outreach', 'Inbox Helper (Mealwise)']);
});

test('Create makes the bots, their teams with the first bot the lead and plan item 1, once', async () => {
  const count = async () => (await srv.api('/bots')).data.length;
  const n = await count();
  let r = await srv.api('/company/start', { method: 'POST' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const c = r.data;
  assert.equal(c.phase, 'running');
  assert.ok(c.startedAt);
  assert.equal(c.day, 1);
  assert.equal(await count(), n + 4);
  const bots = (await srv.api('/bots')).data;
  const byName = (name) => bots.find((b) => b.name === name);
  assert.deepEqual(c.teams.map((t) => [t.name, t.bots.length, t.lead]), [['Growth', 2, byName('Market Scout').id], ['Sales', 1, byName('Outreach').id], ['Mealwise', 1, byName('Inbox Helper (Mealwise)').id]]);
  assert.deepEqual(c.plan.items[0], { text: 'Ask 10 parents to pre-order' });
  // As create_bot: the web tool waits for the owner's OK; "Asks first" is in its rules; a copy has the original's settings.
  assert.deepEqual(byName('Market Scout').allowedTools, []);
  assert.match(byName('Market Scout').systemPrompt, /Never do these without asking the owner first: E-mail someone new/);
  assert.match(byName('Landing Page').systemPrompt, /before every action/);
  assert.equal(byName('Inbox Helper (Mealwise)').description, 'Sorts your Gmail');
  const jobs = (await srv.api(`/bots/${byName('Market Scout').id}/jobs`)).data;
  // Its routine is named for what it does, as the calendar shows it: never its time ("Mondays 8:00").
  assert.deepEqual(jobs.map((j) => [j.name, j.cron]), [['Finds who else does this', '0 8 * * 1']]);
  r = await srv.api('/company/start', { method: 'POST' });
  assert.equal(r.status, 200);
  assert.equal(await count(), n + 4);
  assert.deepEqual(r.data.teams, c.teams);
  assert.equal((await srv.api('/company/proposal/undo', { method: 'POST' })).status, 409);
  assert.ok((await srv.api('/version')).data.features.includes('company-team'));
});
