// Where each account's computer is (ADR 146): this machine or its External Virtual PC on boat.dev, chosen by the admin
// alone on the admin page, per account. The front door asks the account (a stand-in here), which keeps it; the admin's
// list shows it while boat.dev has a key, and a move is in the audit log. The account itself refuses its owner (see
// computer-move-route.test.js).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const passkey = require('./fixtures/soft-passkey');
const { startFrontDoor, standIn } = require('./front-door-helpers');

let door, stub;
const stands = {};
const places = { ann: 'linux', bob: 'linux' };
const sizes = { ann: 'default', bob: 'default' };
const SIZES = [{ id: 'default', cpus: 4, memoryGB: 8, diskGB: 50, perHour: 0.1, available: true }, { id: 'large', cpus: 8, memoryGB: 16, diskGB: 100, perHour: 0.2, available: false, reason: 'limit' }];
// An account's botdot server: answers where its computer is, and moves it when the front door itself asks.
const answer = (name) => (req) => {
  if (req.url !== '/api/settings/computer') return null;
  if (req.method === 'GET') return [200, { place: places[name], boat: true }];
  if (req.headers['x-botdot-room'] !== '1') return [403, { error: 'not the front door' }];
  return null;
};
before(async () => {
  stub = http.createServer((req, res) => { req.resume(); res.writeHead(200, { 'Content-Type': 'application/json' }); res.end('{"sandboxes":[]}'); });
  await new Promise((r) => stub.listen(0, '127.0.0.1', r));
  door = await startFrontDoor({ env: { FRONT_DOOR_ADMIN: 'ann', BOT_DOT_BOAT_URL: `http://127.0.0.1:${stub.address().port}` } });
  for (const name of ['ann', 'bob']) {
    stands[name] = await standIn(door, name, {
      answer: (req) => {
        const a = answer(name)(req);
        if (a) return a;
        if (req.url === '/api/settings/computer' && req.method === 'PUT') { places[name] = places.next; return [200, { place: places[name], boat: true }]; }
        if (req.url === '/api/settings/boat-size') {
          if (req.method !== 'GET') { if (req.headers['x-botdot-room'] !== '1') return [403, { error: 'not the front door' }]; sizes[name] = sizes.next; }
          return [200, { size: sizes[name], sizes: SIZES }];
        }
        return null;
      },
    });
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
const listed = async (b) => Object.fromEntries((await b.get('/admin/accounts')).data.accounts.map((a) => [a.name, a.computer]));

test("the admin moves an account's computer on the admin page; its owner can't; the list shows it while boat.dev has a key", async () => {
  const a = await signUp('ann', door.firstLink);
  const bob = await signUp('bob', { path: new URL((await a.post('/admin/links', {})).data.url).pathname });
  assert.deepEqual(await listed(a), { ann: undefined, bob: undefined }, 'no boat.dev key: nothing to choose');
  assert.equal((await a.post('/admin/boat', { key: 'boat_goodkey12345' })).status, 200);
  assert.deepEqual(await listed(a), { ann: 'linux', bob: 'linux' });

  assert.equal((await bob.post('/admin/accounts/bob/computer', { place: 'boat' })).status, 404, 'only the admin');
  assert.equal((await a.post('/admin/accounts/bob/computer', { place: 'mars' })).status, 400);
  assert.equal((await a.post('/admin/accounts/nobody/computer', { place: 'boat' })).status, 404);

  places.next = 'boat';
  const moved = await a.post('/admin/accounts/bob/computer', { place: 'boat', moveFiles: true });
  assert.deepEqual([moved.status, moved.data], [200, { ok: true, computer: 'boat' }]);
  const put = stands.bob.seen.find((r) => r.method === 'PUT' && r.url === '/api/settings/computer');
  assert.deepEqual(JSON.parse(put.body), { place: 'boat', moveFiles: true });
  assert.equal(put.headers['x-botdot-room'], '1', 'as the front door itself');
  assert.equal(stands.ann.seen.some((r) => r.method === 'PUT' && r.url === '/api/settings/computer'), false, 'the other account is untouched');
  assert.deepEqual(await listed(a), { ann: 'linux', bob: 'boat' });

  const entry = (await a.get('/admin/audit?action=computer')).data.entries[0];
  assert.deepEqual([entry.account, entry.detail], ['bob', 'the External Virtual PC · files copied']);

  // The owner's own request, passed on by the front door, never carries the front door's header.
  const own = await bob.post('/api/settings/computer', { place: 'linux' }, { 'X-Botdot-Room': '1' });
  assert.equal(own.status, 403);
  assert.equal(stands.bob.seen.at(-1).headers['x-botdot-room'], undefined);

  // The size of its External Virtual PC (ADR 163): the admin's too, and in the list only while the computer is there.
  const rows = Object.fromEntries((await a.get('/admin/accounts')).data.accounts.map((x) => [x.name, x.boatSize]));
  assert.equal(rows.ann, undefined, 'on this machine: no size');
  assert.deepEqual(rows.bob, { size: 'default', sizes: [{ id: 'default', cpus: 4, memoryGB: 8, available: true }, { id: 'large', cpus: 8, memoryGB: 16, available: false }] }, 'no prices');
  assert.equal((await bob.post('/admin/accounts/bob/boat-size', { size: 'large' })).status, 404, 'only the admin');
  assert.equal((await a.post('/admin/accounts/bob/boat-size', {})).status, 400);
  sizes.next = 'large';
  const sized = await a.post('/admin/accounts/bob/boat-size', { size: 'large' });
  assert.deepEqual([sized.status, sized.data], [200, { ok: true, size: 'large' }]);
  const sizePut = stands.bob.seen.find((r) => r.method === 'PUT' && r.url === '/api/settings/boat-size');
  assert.deepEqual([JSON.parse(sizePut.body), sizePut.headers['x-botdot-room']], [{ size: 'large' }, '1']);
  const sizeEntry = (await a.get('/admin/audit?action=boat-size')).data.entries[0];
  assert.deepEqual([sizeEntry.account, sizeEntry.detail], ['bob', 'large']);
  assert.equal((await bob.post('/api/settings/boat-size', { size: 'default' }, { 'X-Botdot-Room': '1' })).status, 403, "the owner's own request never carries the header");
});

