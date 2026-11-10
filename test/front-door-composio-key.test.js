// The machine's Composio key (ADR 206): the admin sets it on /admin, checked with Composio first, and the front door
// hands it to every account at once; removed, every account is told to drop the one it took. It is never answered.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const passkey = require('./fixtures/soft-passkey');
const { startFrontDoor, standIn } = require('./front-door-helpers');
const { waitFor } = require('./helpers');

const GOOD = 'ak_good_good_good';
let door, composio;
const stands = {};
before(async () => {
  composio = http.createServer((req, res) => {
    req.resume();
    res.writeHead(req.headers['x-api-key'] === GOOD ? 200 : 401, { 'Content-Type': 'application/json' });
    res.end('{"items":[]}');
  });
  await new Promise((r) => composio.listen(0, '127.0.0.1', r));
  door = await startFrontDoor({ env: { FRONT_DOOR_ADMIN: 'ann', COMPOSIO_API_URL: `http://127.0.0.1:${composio.address().port}` } });
  for (const name of ['ann', 'bob']) stands[name] = await standIn(door, name);
});
after(async () => { await door?.stop(); for (const s of Object.values(stands)) s.close(); composio?.close(); });

async function signUp(name, link) {
  const b = door.browser();
  const key = passkey.create({ rpId: door.rpId, origin: door.origin });
  const options = await b.post(`${link.path}/options`, { name });
  const done = await b.post(link.path, { name, credential: key.register(options.data.publicKey) });
  assert.equal(done.status, 201, done.text);
  return b;
}
const handed = (name) => stands[name].seen.filter((r) => r.url === '/api/connectors/install-key').map((r) => ({ key: JSON.parse(r.body).key, room: r.headers['x-botdot-room'] }));

test("the admin's Composio key goes to every account, and its removal too", async () => {
  const a = await signUp('ann', door.firstLink);
  await signUp('bob', { path: new URL((await a.post('/admin/links', {})).data.url).pathname });
  assert.deepEqual((await a.get('/admin/composio')).data, { keySet: false });
  assert.deepEqual([handed('ann'), handed('bob')], [[], []], 'no key: nothing handed');

  const bad = await a.post('/admin/composio', { key: 'ak_bad_bad_bad' });
  assert.equal(bad.status, 400);
  assert.match(bad.data.error, /^Composio doesn't accept that key/);
  assert.equal((await a.post('/admin/composio', { key: '' })).status, 400);

  const set = await a.post('/admin/composio', { key: ` ${GOOD} ` });
  assert.deepEqual([set.status, set.data], [200, { keySet: true }]);
  assert.ok(!JSON.stringify((await a.get('/admin/composio')).data).includes(GOOD), 'never answered');
  await waitFor(() => (handed('ann').length && handed('bob').length ? true : null), { what: 'the key to reach both accounts' });
  assert.deepEqual([handed('ann'), handed('bob')], [[{ key: GOOD, room: '1' }], [{ key: GOOD, room: '1' }]], 'as the front door itself');
  assert.equal(fs.statSync(path.join(door.data, 'composio-key.json')).mode & 0o777, 0o600);

  assert.deepEqual((await a.post('/admin/composio', { key: null })).data, { keySet: false });
  await waitFor(() => (handed('ann').length === 2 && handed('bob').length === 2 ? true : null), { what: 'the removal to reach both accounts' });
  assert.deepEqual([handed('ann')[1], handed('bob')[1]], [{ key: null, room: '1' }, { key: null, room: '1' }]);

  const audit = (await a.get('/admin/audit')).data.entries.map((e) => e.action);
  assert.ok(audit.includes('composio-key-set') && audit.includes('composio-key-removed'), audit.join(', '));
  assert.equal((await door.browser().post('/admin/composio', { key: GOOD })).status === 200, false, 'only the admin');
});
