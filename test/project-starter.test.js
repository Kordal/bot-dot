// The starter board (#810, ADR 129): the Chief proposes objectives and cards with the team, the owner unticks what
// they don't want, and Create makes the ticked ones and puts what it made on the board. Start from scratch stays empty.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, waitFor } = require('./helpers');
const companyLib = require('../lib/company');
const teamLib = require('../lib/company-team');

let srv;
before(async () => { srv = await startServer(); });
after(async () => { await srv.stop(); });

const fake = (name, v) => fs.writeFileSync(path.join(srv.out, name), typeof v === 'string' ? v : JSON.stringify(v));
const at = (p, id) => `${p}?project=${encodeURIComponent(id)}`;
const TEAM = {
  bots: [{ name: 'Lab Keeper', description: 'Keeps the homelab running', prompt: 'Watch the VMs.', routines: 'Daily 7:00', cron: '0 7 * * *', team: 'Lab', computer: true }],
  goals: [{ name: 'All VMs up', target: 0 }, { name: 'Backups every night', target: 7 }, { name: 'Disk under 80%', target: -5 }, { name: 'One too many', target: 1 }, { target: 3 }],
  cards: [{ ask: 'VMs up on Proxmox', apps: ['github', 'nope'] }, 'Free space on the NAS', { ask: 'Last backup of each VM', apps: 'x' }, { ask: '' }, { ask: 'Fourth' }, { ask: 'Fifth' }],
};

test('the server says it makes a starter board, and the Chief is asked for one', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('project-starter'));
  assert.match(teamLib.question({ kind: 'idea', start: 'Manage my homelab', about: [], stories: [], never: [] }), /"goals": one to three objectives/);
});

test('a starter board is cut to its shape: three goals, four cards, apps by slug, each ticked', () => {
  const s = companyLib.starter(TEAM);
  assert.deepEqual(s.goals.map((g) => [g.name, g.target, g.on]), [['All VMs up', 0, true], ['Backups every night', 7, true], ['Disk under 80%', 0, true]]);
  assert.deepEqual(s.cards.map((c) => [c.ask, c.apps]), [['VMs up on Proxmox', ['github', 'nope']], ['Free space on the NAS', []], ['Last backup of each VM', []], ['Fourth', []]]);
  assert.ok([...s.goals, ...s.cards].every((x) => x.key));
  assert.equal(companyLib.starter({ goals: [], cards: [] }), null);
  assert.equal(companyLib.starter('no'), null);
});

let pid;
test('the proposal brings the starter board; only apps that are connected are kept; only the owner unticks', async () => {
  const r0 = await srv.api('/company', { method: 'POST', body: { start: 'Manage my homelab' } });
  pid = r0.data.id;
  fake('company-team.txt', TEAM);
  let r = await srv.api(at('/company/proposal', pid), { method: 'POST' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.starter.goals.length, 3);
  assert.deepEqual(r.data.starter.cards[0].apps, [], 'no app is connected');
  const { goals, cards } = r.data.starter;
  const off = { goals: goals.map((g, i) => ({ ...g, on: i !== 2 })), cards: cards.map((c, i) => ({ ...c, on: i < 2 })) };
  assert.equal((await srv.asChief(at('/company', pid), { method: 'PATCH', body: { starter: off } })).status, 403);
  r = await srv.api(at('/company', pid), { method: 'PATCH', body: { starter: off } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.starter.goals.map((g) => g.on), [true, true, false]);
  assert.deepEqual(r.data.starter.goals.map((g) => g.key), goals.map((g) => g.key), 'the keys stay');
  // "Change the team…" keeps the board as the owner left it.
  fake('company-chat.txt', { say: 'Renamed it.', bots: [{ ...r.data.proposal[0], name: 'Lab Warden' }] });
  r = await srv.api(at('/company/proposal/chat', pid), { method: 'POST', body: { text: 'Rename it Lab Warden' } });
  assert.deepEqual(r.data.starter.goals.map((g) => g.on), [true, true, false]);
});

test('Create makes the ticked objectives and cards, and the board shows what it made', async () => {
  srv.reply('Read it.\n```card\n{"title":"VMs","show":"number","value":"5","how":"Read Proxmox."}\n```');
  const r = await srv.api(at('/company/start', pid), { method: 'POST' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.objectives.map((o) => [o.name, o.target, o.current]), [['All VMs up', 0, 0], ['Backups every night', 7, 0]]);
  assert.deepEqual(r.data.board, ['goals', 'teams']);
  assert.equal(r.data.starter, undefined);
  assert.deepEqual(r.data.cards.map((c) => c.ask), ['VMs up on Proxmox', 'Free space on the NAS']);
  assert.ok(r.data.cards.every((c) => c.state !== 'asking' || (Array.isArray(c.questions) && !c.questions.length)), 'no questions: the setup answered them');
  await waitFor(async () => ((await srv.api(at('/company', pid))).data.company.cards.every((c) => c.state === 'ready') ? true : null), { what: 'the cards built' });
  // A second Create makes nothing more.
  const again = await srv.api(at('/company/start', pid), { method: 'POST' });
  assert.equal(again.data.objectives.length, 2);
  assert.equal(again.data.cards.length, 2);
});

test('a starter board can no longer be changed once the project runs', async () => {
  assert.equal((await srv.api(at('/company', pid), { method: 'PATCH', body: { starter: TEAM } })).status, 409);
});

test('the To-do joins the board when Create puts a first item in the plan; nothing ticked leaves the goals off', async () => {
  const id = (await srv.api('/company', { method: 'POST', body: { start: 'A meal planner for parents' } })).data.id;
  await srv.api(at('/company', id), { method: 'PATCH', body: { swot: { firstTest: 'Ask 10 parents' } } });
  fake('company-team.txt', { bots: [{ name: 'Scout', description: 'Finds parents', prompt: 'Find parents.', team: 'Growth' }], goals: [{ name: 'Ten parents', target: 10 }] });
  let r = await srv.api(at('/company/proposal', id), { method: 'POST' });
  r = await srv.api(at('/company', id), { method: 'PATCH', body: { starter: { goals: r.data.starter.goals.map((g) => ({ ...g, on: false })) } } });
  r = await srv.api(at('/company/start', id), { method: 'POST' });
  assert.deepEqual(r.data.objectives, []);
  assert.deepEqual(r.data.board, ['teams', 'todo']);
  assert.deepEqual(r.data.cards, []);
});

test('Start from scratch still starts empty', async () => {
  const r = await srv.api('/company', { method: 'POST', body: { empty: true } });
  assert.deepEqual(r.data.board, []);
  assert.deepEqual(r.data.objectives, []);
});
