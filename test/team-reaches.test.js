// What a proposed bot must reach (#808, ADR 128): the Chief names the computer, the Vault logins and the SSH keys each
// bot needs, the server matches them to the Vault's entries, the owner picks one for a gap, and Create grants what
// the cards show: the computer, the tools and apps, and each picked entry shared with its bot.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer } = require('./helpers');
const teamLib = require('../lib/company-team');

let srv; let pve; let kuma;
const fake = (name, v) => fs.writeFileSync(path.join(srv.out, name), typeof v === 'string' ? v : JSON.stringify(v));
const asked = () => fs.readdirSync(srv.out).filter((f) => f.startsWith('company-') && /\d\.txt$/.test(f)).sort().map((f) => fs.readFileSync(path.join(srv.out, f), 'utf8'));
const TEAM = { bots: [
  { name: 'Homelab Keeper', description: 'Keeps the VMs up', prompt: 'Watch the VMs.', owns: [], connects: [], tools: ['WebFetch'], routines: 'Daily 7:00', cron: '0 7 * * *', asksFirst: 'rules', preview: '', team: 'Ops',
    computer: true, logins: ['proxmox pve', 'nas.lan', 'proxmox pve'], ssh: ['backup.lan'] },
  { name: 'Status Page', description: 'Reads the uptime board', prompt: 'Read it.', owns: [], connects: [], tools: [], routines: '', asksFirst: 'rules', preview: '', team: 'Ops',
    computer: 'yes', logins: ['https://kuma.lan/dashboard'] },
] };

before(async () => {
  srv = await startServer();
  pve = (await srv.api('/vault', { method: 'POST', body: { name: 'Proxmox pve', site: 'pve.lan', username: 'root@pam!botdot', password: 'pve-fixture-1' } })).data;
  kuma = (await srv.api('/vault', { method: 'POST', body: { name: 'Uptime Kuma', site: 'kuma.lan', password: 'kuma-fixture-2' } })).data;
});
after(async () => { await srv.stop(); });

test('a need is matched by its name, then by its host; one picked before is kept while it is there', () => {
  const entries = [{ id: 'a', name: 'Proxmox pve', site: 'https://pve.lan:8006', kind: 'login' }, { id: 'k', name: 'Home key', kind: 'ssh-key' }];
  assert.deepEqual(teamLib.matched(['PROXMOX PVE', 'pve.lan', 'nas.lan'], entries, 'logins'), [{ need: 'PROXMOX PVE', id: 'a' }, { need: 'pve.lan', id: 'a' }, { need: 'nas.lan' }]);
  assert.deepEqual(teamLib.matched(['Home key', 'Proxmox pve'], entries, 'ssh'), [{ need: 'Home key', id: 'k' }, { need: 'Proxmox pve' }], 'a login is no SSH key');
  assert.deepEqual(teamLib.matched([{ need: 'nas.lan', id: 'gone' }], entries, 'logins'), [{ need: 'nas.lan' }]);
  assert.deepEqual(teamLib.matched(['nas.lan'], entries, 'logins', [{ need: 'NAS.lan', id: 'a' }]), [{ need: 'nas.lan', id: 'a' }]);
  assert.equal(teamLib.hostOf('https://Kuma.lan:3001/x'), 'kuma.lan');
});

test('the Chief is told the saved entries by name, never a secret, and its needs land on the cards matched', async () => {
  await srv.api('/company', { method: 'POST', body: { start: 'Keep my homelab running' } });
  fake('company-team.txt', TEAM);
  const r = await srv.api('/company/proposal', { method: 'POST' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const q = asked().at(-1);
  assert.match(q, /Saved logins: Proxmox pve \(pve\.lan\); Uptime Kuma \(kuma\.lan\)\./);
  assert.match(q, /No saved SSH keys yet\./);
  assert.ok(!q.includes('pve-fixture-1') && !q.includes('root@pam'));
  const [keeper, page] = r.data.proposal;
  assert.equal(keeper.computer, true);
  assert.equal(page.computer, false, 'only true is a computer');
  assert.deepEqual(keeper.logins, [{ need: 'proxmox pve', id: pve.id, name: 'Proxmox pve' }, { need: 'nas.lan' }], 'once each; a gap has no id');
  assert.deepEqual(keeper.ssh, [{ need: 'backup.lan' }]);
  assert.deepEqual(page.logins, [{ need: 'https://kuma.lan/dashboard', id: kuma.id, name: 'Uptime Kuma' }]);
});

test('the owner fills a gap; only the owner changes the proposed team', async () => {
  const before = (await srv.api('/company')).data.company.proposal;
  const filled = before.map((p, i) => (i === 0 ? { ...p, logins: p.logins.map((n) => (n.need === 'nas.lan' ? { ...n, id: kuma.id } : n)) } : p));
  assert.equal((await srv.asChief('/company', { method: 'PATCH', body: { proposal: filled } })).status, 403);
  const r = await srv.api('/company', { method: 'PATCH', body: { proposal: filled } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(r.data.proposal[0].logins.map((n) => n.name), ['Proxmox pve', 'Uptime Kuma']);
  // "Change the team…" keeps what was picked for a need it keeps.
  fake('company-chat.txt', { say: 'Renamed it.', bots: r.data.proposal.map((p) => ({ ...p, name: p.name === 'Status Page' ? 'Uptime Reader' : p.name, logins: p.logins.map((n) => n.need), ssh: p.ssh.map((n) => n.need) })) });
  const c = await srv.api('/company/proposal/chat', { method: 'POST', body: { text: 'Rename Status Page' } });
  assert.deepEqual(c.data.proposal[0].logins.map((n) => n.id), [pve.id, kuma.id]);
  assert.match(asked().at(-1), /"logins":\["proxmox pve","nas\.lan"\]/);
});

test('Create grants what the cards show, shares the picked entries and leaves nothing in Needs you', async () => {
  const waiting = async () => ((await srv.api('/asks')).data || []).length;
  const n = await waiting();
  const r = await srv.api('/company/start', { method: 'POST' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const bots = (await srv.api('/bots')).data;
  const keeper = bots.find((b) => b.name === 'Homelab Keeper');
  const reader = bots.find((b) => b.name === 'Uptime Reader');
  assert.equal(keeper.computer, 'linux');
  assert.deepEqual(keeper.allowedTools, ['WebFetch']);
  assert.equal(reader.computer, 'none');
  const vault = (await srv.api('/vault')).data;
  assert.deepEqual(vault.find((e) => e.id === pve.id).allowedBots, [keeper.id]);
  assert.deepEqual(vault.find((e) => e.id === kuma.id).allowedBots.sort(), [keeper.id, reader.id].sort());
  assert.deepEqual((await srv.api(`/bots/${keeper.id}/jobs`)).data.map((j) => [j.cron, j.pending ? 'waits' : 'on']), [['0 7 * * *', 'on']]);
  assert.equal(await waiting(), n);
  assert.ok((await srv.api('/version')).data.features.includes('team-reaches'));
});
