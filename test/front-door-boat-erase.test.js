// Erasing an account removes its machines on boat.dev (#982): before the machine erases an account the admin deleted,
// the front door asks its botdot server (a stand-in here) to delete them. What failed is in the audit entry and the
// admin's answer, and the account is deleted all the same.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const passkey = require('./fixtures/soft-passkey');
const { startFrontDoor, standIn } = require('./front-door-helpers');

let door, stub;
const stands = {};
const erases = {
  bob: [200, { deleted: 2, failed: [] }],
  cid: [200, { deleted: 1, failed: [{ id: 'bx_aaaaaaa1', error: 'boat.dev answered 500 (internal)' }] }],
  dan: [500, { error: 'broken' }],
  eve: [200, { deleted: 0, failed: [] }],
};
before(async () => {
  stub = http.createServer((req, res) => { req.resume(); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{}'); });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  door = await startFrontDoor({ env: { FRONT_DOOR_ADMIN: 'ann', BOT_DOT_BOAT_URL: `http://127.0.0.1:${stub.address().port}` } });
  for (const name of ['ann', ...Object.keys(erases)]) {
    stands[name] = await standIn(door, name, { answer: (req) => (req.url === '/api/boat/erase' ? erases[name] : null) });
  }
});
after(async () => { await door?.stop(); for (const s of Object.values(stands)) s.close(); stub?.close(); });

async function signUp(name, link) {
  const b = door.browser();
  const key = passkey.create({ rpId: door.rpId, origin: door.origin });
  const options = await b.post(`${link.path}/options`, { name });
  const done = await b.post(link.path, { name, credential: key.register(options.data.publicKey) });
  assert.equal(done.status, 201, done.text);
  return b;
}
const erasesSeen = (name) => stands[name].seen.filter((r) => r.url === '/api/boat/erase');

test("deleting an account deletes its boat.dev machines first; a failure is said and the account goes all the same", async () => {
  const a = await signUp('ann', door.firstLink);
  for (const name of Object.keys(erases)) await signUp(name, { path: new URL((await a.post('/admin/links', {})).data.url).pathname });
  const del = (name) => a.post(`/admin/accounts/${name}/delete`, { name });

  // No boat.dev key on this machine: nothing to ask.
  assert.deepEqual((await del('eve')).data, { ok: true });
  assert.equal(erasesSeen('eve').length, 0);

  assert.equal((await a.post('/admin/boat', { key: 'boat_goodkey12345' })).status, 200);
  const bob = await del('bob');
  assert.deepEqual([bob.status, bob.data], [200, { ok: true }]);
  const [asked] = erasesSeen('bob');
  assert.equal(asked.method, 'POST');
  assert.equal(asked.headers['x-botdot-room'], '1', 'as the front door itself');

  const cid = await del('cid');
  assert.equal(cid.status, 200);
  assert.equal(cid.data.boat, 'boat.dev: 1 machine not deleted (boat.dev answered 500 (internal)), 1 deleted');
  const dan = await del('dan');
  assert.equal(dan.status, 200);
  assert.equal(dan.data.boat, "boat.dev: its machines not deleted (its server gave no answer)");

  const accounts = (await a.get('/admin/accounts')).data.accounts.map((x) => x.name);
  assert.deepEqual(accounts, ['ann'], 'every one deleted');

  const details = Object.fromEntries((await a.get('/admin/audit?action=delete')).data.entries.map((e) => [e.account, e.detail]));
  assert.deepEqual(details, {
    bob: 'boat.dev: 2 machines deleted',
    cid: 'boat.dev: 1 machine not deleted (boat.dev answered 500 (internal)), 1 deleted',
    dan: 'boat.dev: its machines not deleted (its server gave no answer)',
    eve: undefined,
  });
});
