// GET /api/update/idle is the front door's alone (#1688): the real front door strips x-botdot-room from every request it
// passes on for a person, so the owner's own session, on the front door's socket, is refused by the account's real
// botdot server; the front door itself, with the header, is answered.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const passkey = require('./fixtures/soft-passkey');
const { startFrontDoor } = require('./front-door-helpers');
const { startServer } = require('./helpers');

let door, ann, owner;
before(async () => {
  ann = await startServer({ account: 'ann' });
  door = await startFrontDoor({ env: { FRONT_DOOR_ADMIN: 'ann' } });
  fs.symlinkSync(path.dirname(ann.socket), path.join(door.sockets, ann.account));
  owner = door.browser();
  const key = passkey.create({ rpId: door.rpId, origin: door.origin });
  const options = await owner.post(`${door.firstLink.path}/options`, { name: 'ann' });
  const done = await owner.post(door.firstLink.path, { name: 'ann', credential: key.register(options.data.publicKey) });
  assert.equal(done.status, 201, done.text);
});
after(async () => {
  await door?.stop();
  await ann?.stop();
  if (ann) fs.rmSync(ann.dir, { recursive: true, force: true });
});

test("the owner's session through the front door gets 403, even naming the header itself", async () => {
  assert.equal((await owner.get('/api/bots')).status, 200, 'the session works: it is the route that refuses');
  const r = await owner.get('/api/update/idle');
  assert.equal(r.status, 403, r.text);
  const named = await owner.get('/api/update/idle', { 'x-botdot-room': '1' });
  assert.equal(named.status, 403, 'the front door strips what a person sends, so naming it does not help');
});

test('the front door itself is answered, on its socket with the header', async () => {
  const r = await new Promise((resolve, reject) => {
    const req = http.request({ socketPath: ann.socket, path: '/api/update/idle', headers: { Host: 'botdot.example.com', 'X-Botdot-Account': 'ann', 'x-botdot-room': '1' } }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(Buffer.concat(chunks).toString('utf8')) }));
    });
    req.on('error', reject);
    req.end();
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual(Object.keys(r.data).sort(), ['idle', 'lastOwnerMessageAt', 'nextStartAt', 'working']);
});
