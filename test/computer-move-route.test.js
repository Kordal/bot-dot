// A bot's files copied when its computer moves (#556, ADR 091), through botdot's API: the owner's switch with
// "Copy files" starts the copy and the bot shows how it went; without it nothing is copied; the Chief's switch carries
// it on its card. Here boat.dev has no key, so a copy from there fails and says why, and the machine stays the bot's.
// The same between a bot's own machine on boat.dev and the account's one there (#568).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer } = require('./helpers');

let srv;
before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-move-route-'));
  const data = path.join(dir, 'data');
  fs.mkdirSync(data, { recursive: true });
  const bot = (id, name) => ({ id, name, prompt: 'Build things.', allowedTools: ['Read'], computer: 'boat', jobs: [] });
  fs.writeFileSync(path.join(data, 'bots.json'), JSON.stringify([bot('coder', 'Coder'), bot('fresh', 'Fresh'), bot('asked', 'Asked'),
    { ...bot('alone', 'Alone'), boatOwnMachine: true }, { ...bot('apart', 'Apart'), boatOwnMachine: true }, bot('older', 'Older')]));
  const machine = (n) => ({ id: `bx_${String(n).padStart(8, 'a')}`, type: 'default' });
  fs.writeFileSync(path.join(data, 'boat-machines.json'), JSON.stringify({ coder: machine(1), alone: machine(2), apart: machine(3), older: machine(4) }));
  srv = await startServer({ dir });
});
after(() => srv.stop());

const botOf = async (id) => (await srv.api(`/bots/${id}`)).data;
async function until(check) {
  for (let i = 0; i < 100; i++) { const v = await check(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); }
  throw new Error('it never happened');
}

test('"Copy files" starts the copy; one that fails says why, keeps the boat.dev machine and is tried again', async () => {
  const r = await srv.api('/bots/coder', { method: 'PUT', body: { computer: 'linux', moveFiles: true } });
  assert.equal(r.status, 200);
  assert.equal(r.data.computer, 'linux');
  const failed = await until(async () => { const b = await botOf('coder'); return b.computerMove?.state === 'failed' && b; });
  assert.equal(failed.computerMove.from, 'boat');
  assert.equal(failed.computerMove.to, 'linux');
  assert.match(failed.computerMove.error, /boat\.dev has no key/);
  assert.ok(JSON.parse(fs.readFileSync(path.join(srv.data, 'boat-machines.json'), 'utf8')).coder, 'its machine is kept for another try');
  assert.equal((await srv.api('/bots/coder/computer/move', { method: 'POST', headers: { 'X-Chief-Key': srv.chiefKey } })).status, 403, 'only the owner');
  assert.equal((await srv.api('/bots/coder/computer/move', { method: 'POST' })).status, 200);
  await until(async () => (await botOf('coder')).computerMove?.state === 'failed');
  const none = await srv.api('/bots/coder', { method: 'PUT', body: { computer: 'none' } });
  assert.equal(none.status, 200);
  assert.equal((await botOf('coder')).computerMove, undefined, 'a changed computer forgets the failed copy');
  assert.equal((await srv.api('/bots/coder/computer/move', { method: 'POST' })).status, 409);
});

test('"Start empty" copies nothing', async () => {
  const r = await srv.api('/bots/fresh', { method: 'PUT', body: { computer: 'linux' } });
  assert.equal(r.status, 200);
  assert.equal((await botOf('fresh')).computerMove, undefined);
});

test("the Chief's switch with its files waits on a card that says so", async () => {
  const r = await srv.asChief('/bots/asked', { method: 'PUT', body: { computer: 'linux', moveFiles: true } });
  assert.equal(r.status, 200);
  assert.equal(r.data.computer, 'boat', 'it waits for the owner');
  const ask = (await srv.api('/asks')).data.find((a) => a.botId === 'asked');
  assert.ok(ask.moveFiles);
  assert.match(ask.parts.find((p) => p.label === 'Computer').now, /, with its files$/);
  assert.equal((await botOf('asked')).computerMove, undefined, 'nothing copied before the yes');
  assert.equal((await srv.api(`/asks/${ask.id}`, { method: 'POST', body: { yes: true } })).status, 200);
  await until(async () => (await botOf('asked')).computerMove?.state === 'failed');
});

const machines = () => JSON.parse(fs.readFileSync(path.join(srv.data, 'boat-machines.json'), 'utf8'));

test("off its own machine onto the account's: \"Copy files\" keeps its own until the copy succeeded, \"Start empty\" lets it go", async () => {
  const copied = await srv.api('/bots/alone', { method: 'PUT', body: { boatOwnMachine: false, moveFiles: true } });
  assert.equal(copied.status, 200);
  assert.equal(copied.data.boatOwnMachine, false);
  const failed = await until(async () => { const b = await botOf('alone'); return b.computerMove?.state === 'failed' && b; });
  assert.deepEqual([failed.computerMove.from, failed.computerMove.to], ['boat', 'boat'], 'both boat.dev, as the apps know it');
  assert.ok(machines().alone, 'its own machine is kept for another try');
  assert.equal((await srv.api('/bots/apart', { method: 'PUT', body: { boatOwnMachine: false } })).status, 200);
  await until(async () => !machines().apart);
  assert.equal((await botOf('apart')).computerMove, undefined);
});

test('a machine of its own from before stays its own, its files untouched, while boat.dev has no key', async () => {
  assert.equal((await srv.api('/bots/older', { method: 'PUT', body: { name: 'Older one' } })).status, 200);
  assert.ok(machines().older);
  assert.equal((await botOf('older')).computerMove, undefined, 'no copy without a key');
});
