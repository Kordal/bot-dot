// One boat.dev machine per account (#568, ADR 095): the account's boat bots share one machine there, each in a folder
// of its own; a bot that wants one has a machine of its own, and one made before is used until its files moved over.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const boatLib = require('../lib/boat');
const moveLib = require('../lib/computer-move');
const asks = require('../lib/asks');

const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-boat-acct-'));
const KEY = `boat_${'x'.repeat(16)}`; // no real key

// boat.dev as far as these tests need it: machines made, stopped and started again, and commands that echo.
function fakeBoat() {
  const machines = new Map();
  const calls = [];
  let n = 0;
  const reply = (status, body) => ({ ok: status < 400, status, json: async () => body });
  const fetch = async (url, { method = 'GET', body } = {}) => {
    const p = new URL(url).pathname.replace(/^\/api\/v1/, '');
    const data = body ? JSON.parse(body) : null;
    calls.push({ method, path: p, body: data });
    if (p === '/sandboxes' && method === 'POST') {
      const id = `bx_${String(++n).padStart(8, 'a')}`;
      machines.set(id, { id, state: 'ready', name: data.name });
      return reply(202, { ok: true, sandbox: { id, state: 'provisioning' } });
    }
    const m = p.match(/^\/sandboxes\/(bx_[a-z0-9]+)(?:\/(.+))?$/);
    const box = m && machines.get(m[1]);
    if (!box) return reply(404, { ok: false, code: 'not_found' });
    if (!m[2] && method === 'GET') return reply(200, { ok: true, sandbox: { id: box.id, state: box.state } });
    if (!m[2]) return reply(200, { ok: true });
    if (m[2] === 'stop') { box.state = 'archived'; return reply(202, { ok: true }); }
    if (m[2] === 'resume') { box.state = 'ready'; return reply(202, { ok: true }); }
    if (m[2] === 'files') return reply(200, { ok: true, content: '' });
    if (m[2] === 'commands') return reply(200, { ok: true, exitCode: 0, stdout: data.command.includes('stat -c %s') ? '42\n' : `ran: ${data.command}`, stderr: '', timedOut: false });
    return reply(400, { ok: false });
  };
  const commandsOn = (id) => calls.filter((c) => c.path === `/sandboxes/${id}/commands`).map((c) => c.body.command);
  return { fetch, calls, machines, commandsOn };
}
const keyed = (t) => { boatLib.setKey(KEY); t.after(() => boatLib.setKey(null)); };

test("bots without a machine of their own share the account's one, named for the account, each in its own folder", async (t) => {
  keyed(t);
  const b = fakeBoat();
  const boat = boatLib.create(dir(), { fetch: b.fetch, sleep: async () => {}, account: 'Kordal', ownOf: () => false });
  await boat.runShell('coder', { command: 'git status' });
  await boat.runShell('writer', { command: 'ls' });
  assert.equal(b.machines.size, 1, 'one machine for the account');
  const [m] = b.machines.values();
  assert.equal(m.name, 'botdot-kordal');
  const [coder, writer] = b.commandsOn(m.id);
  assert.equal(coder, "mkdir -p -- '/home/user/workspace/coder' && cd -- '/home/user/workspace/coder' || exit 1\ngit status");
  assert.match(writer, /cd -- '\/home\/user\/workspace\/writer' \|\| exit 1\nls$/);
  assert.equal(boat.has('coder'), false, 'no machine of its own');
  assert.equal(boat.info('writer').shared, true);
  assert.equal(boatLib.machineName(boatLib.ACCOUNT, { account: '' }), 'botdot');
});

test("a file, a folder and a Vault command start in the bot's folder on the account's machine", async (t) => {
  keyed(t);
  const b = fakeBoat();
  const boat = boatLib.create(dir(), { fetch: b.fetch, sleep: async () => {}, ownOf: () => false });
  await boat.readFile('coder', { path: 'notes.md' });
  await boat.writeFile('coder', { path: 'notes.md', content: 'x' });
  await boat.runWithLogin('coder', { command: 'deploy', username: 'u', password: 'p' });
  await boat.runWithSshKey('coder', { command: 'git pull', privateKey: 'k' });
  await boat.runWithFile('coder', { command: 'use', fileName: 'a.pem', content: 'eA==' });
  const [m] = b.machines.values();
  const sent = b.commandsOn(m.id).filter((c) => !c.startsWith('rm -rf'));
  for (const c of sent) assert.ok(c.includes("cd -- '/home/user/workspace/coder'"), c);
  assert.ok(sent.every((c) => !c.includes(' p\n') && !c.includes("'p'")), 'no secret on a command line');
});

test('the shared machine stops only once every bot on it left it unused', async (t) => {
  keyed(t);
  const b = fakeBoat();
  let now = 0;
  const boat = boatLib.create(dir(), { fetch: b.fetch, sleep: async () => {}, now: () => now, restAfterMs: 1000, ownOf: () => false });
  await boat.runShell('coder', { command: 'ls' });
  now = 900;
  await boat.runShell('writer', { command: 'ls' });
  now = 1500;
  assert.deepEqual(await boat.restIdle(), [], 'writer used it a moment ago');
  now = 2500;
  assert.deepEqual(await boat.restIdle(), [boatLib.ACCOUNT]);
  assert.equal(boat.isUp('coder'), false);
});

test('a bot that wants one has a machine of its own, and one made before is used until it is let go', async (t) => {
  keyed(t);
  const b = fakeBoat();
  const data = dir();
  const own = new Set(['private']);
  const boat = boatLib.create(data, { fetch: b.fetch, sleep: async () => {}, ownOf: (id) => own.has(id) });
  await boat.runShell('private', { command: 'ls' });
  await boat.runShell('coder', { command: 'ls' });
  assert.equal(b.machines.size, 2);
  assert.equal(boat.has('private'), true);
  assert.equal(boat.info('private').shared, false);
  assert.equal(b.commandsOn('bx_aaaaaaa1')[0], 'ls', 'its own machine: its home, as before');
  // It no longer wants one: until its own machine is let go (after its files moved), it works there.
  own.delete('private');
  await boat.runShell('private', { command: 'pwd' });
  assert.equal(b.commandsOn('bx_aaaaaaa1').at(-1), 'pwd');
  await boat.forget('private');
  await boat.runShell('private', { command: 'pwd' });
  assert.match(b.commandsOn('bx_aaaaaaa2').at(-1), /workspace\/private' \|\| exit 1\npwd$/);
  assert.equal(b.machines.get('bx_aaaaaaa1').state, 'archived', 'its own machine stopped, its disk kept by boat.dev');
  await boat.forget(boatLib.ACCOUNT);
  assert.equal(b.machines.get('bx_aaaaaaa2').state, 'ready', "the account's machine is no one bot's to let go");
});

test("a copy's steps go to the side asked for: the bot's own machine, or its folder on the account's", async (t) => {
  keyed(t);
  const b = fakeBoat();
  const boat = boatLib.create(dir(), { fetch: b.fetch, sleep: async () => {}, ownOf: () => false });
  const ownPack = await boat.moveFiles('coder', { op: 'pack' }, { own: true });
  assert.equal(ownPack.size, 42);
  const acctPack = await boat.moveFiles('coder', { op: 'pack' }, { own: false });
  assert.equal(acctPack.size, 42);
  await boat.moveFiles('coder', { op: 'unpack' }, { own: false });
  assert.equal(b.machines.size, 2);
  assert.match(b.commandsOn('bx_aaaaaaa1')[0], /-C '\/home\/user' --exclude=\.\/\.cache/);
  const [pack, unpack] = b.commandsOn('bx_aaaaaaa2');
  assert.match(pack, /tar --ignore-failed-read -czf \/tmp\/botdot-move-coder\.tgz -C '\/home\/user\/workspace\/coder' \./);
  assert.match(unpack, /tar -xzf \/tmp\/botdot-move-coder\.tgz -C '\/home\/user\/workspace\/coder'/);
});

test("files move between this machine, the account's machine on boat.dev and a bot's own; the apps see both as boat.dev", async () => {
  assert.ok(moveLib.isMove('boat-own', 'boat'));
  assert.ok(moveLib.isMove('boat', 'boat-own'));
  assert.ok(moveLib.isMove('linux', 'boat-own'));
  const data = dir();
  const ok = { moveFiles: async (id, { op }) => (op === 'pack' ? { code: 0, size: 3 } : op === 'read' ? { code: 0, data: 'YWJj' } : { code: 0 }) };
  const fail = { moveFiles: async (id, { op }) => (op === 'unpack' ? { code: 1, stderr: 'full' } : { code: 0 }) };
  const moves = moveLib.create(data, { sides: { 'boat-own': ok, boat: fail } });
  await moves.start('coder', 'boat-own', 'boat');
  assert.deepEqual(moves.of('coder').from, 'boat');
  assert.equal(moves.raw('coder').from, 'boat-own');
  assert.equal(moves.holdsBoat('coder'), true, 'a failed copy keeps its own machine');
});

test("a copy kept from before #568 was from or to the bot's own machine", () => {
  const data = dir();
  fs.writeFileSync(path.join(data, 'computer-moves.json'), JSON.stringify({ coder: { from: 'boat', to: 'linux', state: 'failed', done: 0, total: 0, error: 'x', at: 1 } }));
  const moves = moveLib.create(data, { sides: {} });
  assert.equal(moves.raw('coder').from, 'boat-own');
  assert.equal(moves.holdsBoat('coder'), true);
});

test("the Chief's card names which machine on boat.dev", () => {
  const part = (a) => asks.proposalView({ kind: 'bot-change', botId: 'b1', ...a }, 'Coder').parts[0].now;
  assert.match(part({ changes: { computer: 'boat' }, before: { computer: 'none' } }), /^the account's machine on boat\.dev, which has costs$/);
  assert.match(part({ changes: { computer: 'boat' }, before: { computer: 'none' }, ownMachine: true, moveFiles: true }), /^a machine of its own on boat\.dev, which has costs, with its files$/);
});
