// The admin's choice of the group router (#513): Haiku, or Jev with an OpenRouter key that is checked with one call,
// kept by the front door alone and never answered, and handed to every account's botdot server (a stand-in here).
// OpenRouter is a stand-in too (BOT_DOT_OPENROUTER_URL).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const passkey = require('./fixtures/soft-passkey');
const { startFrontDoor, standIn } = require('./front-door-helpers');
const { waitFor } = require('./helpers');

const GOOD = 'sk-or-v1-goodgoodgoodgood';
const BAD = 'sk-or-v1-badbadbadbadbad';
const asked = []; // what OpenRouter's stand-in was sent: { auth, body }
let door, ann, openRouter;

before(async () => {
  openRouter = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      asked.push({ url: req.url, auth: req.headers.authorization, body: JSON.parse(Buffer.concat(chunks).toString('utf8')) });
      const ok = req.headers.authorization === `Bearer ${GOOD}`;
      res.writeHead(ok ? 200 : 401, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(ok ? { answers: { ok: { type: 'noul', noul: 0.9 } } } : { error: { message: 'No auth credentials found' } }));
    });
  });
  await new Promise((r) => openRouter.listen(0, '127.0.0.1', r));
  door = await startFrontDoor({ env: { FRONT_DOOR_ADMIN: 'ann', BOT_DOT_OPENROUTER_URL: `http://127.0.0.1:${openRouter.address().port}`, BOT_DOT_ROUTER_HAND_MS: '300' } });
  ann = await standIn(door, 'ann');
});
after(async () => { await door?.stop(); ann?.close(); openRouter?.close(); });

async function signUp(name, link) {
  const b = door.browser();
  const key = passkey.create({ rpId: door.rpId, origin: door.origin });
  const options = await b.post(`${link.path}/options`, { name });
  const done = await b.post(link.path, { name, credential: key.register(options.data.publicKey) });
  assert.equal(done.status, 201, done.text);
  return b;
}
const handed = () => ann.seen.filter((r) => r.url === '/api/group-router');

test('the admin chooses Jev with a key that OpenRouter takes; the key is never answered and every account is handed it', async () => {
  const a = await signUp('ann', door.firstLink);
  const bob = await signUp('bob', { path: new URL((await a.post('/admin/links', {})).data.url).pathname });
  assert.equal((await bob.get('/admin/group-router')).status, 404, 'only the admin');
  assert.deepEqual((await a.get('/admin/group-router')).data, { router: 'haiku', keySet: false, wakeGate: false });
  // The accounts are handed the choice every while: Haiku until the admin chooses.
  await waitFor(() => (handed().length ? true : null), { what: 'the account to be handed the router' });
  assert.deepEqual(JSON.parse(handed()[0].body), { router: 'haiku', key: null, wakeGate: false });
  assert.equal(handed()[0].headers['x-botdot-room'], '1', 'as the front door itself');

  assert.equal((await a.post('/admin/group-router', { router: 'jev' })).status, 400, 'Jev needs a key');
  assert.equal((await a.post('/admin/group-router', { router: 'gpt' })).status, 400);
  const refused = await a.post('/admin/group-router', { router: 'jev', key: BAD });
  assert.deepEqual([refused.status, refused.data.error], [400, 'OpenRouter refused this key.']);
  assert.deepEqual((await a.get('/admin/group-router')).data, { router: 'haiku', keySet: false, wakeGate: false }, 'a refused key is not kept');
  assert.equal(asked.at(-1).url, '/api/alpha/decisions');

  const chosen = await a.post('/admin/group-router', { router: 'jev', key: GOOD, wakeGate: false });
  assert.deepEqual([chosen.status, chosen.data], [200, { router: 'jev', keySet: true, wakeGate: false }]);
  assert.ok(!chosen.text.includes(GOOD) && !(await a.get('/admin/group-router')).text.includes(GOOD), 'the key is never answered');
  const file = path.join(door.data, 'group-router.json');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  await waitFor(() => (handed().some((r) => JSON.parse(r.body).router === 'jev') ? true : null), { what: 'the account to be handed Jev' });
  assert.deepEqual(JSON.parse(handed().find((r) => JSON.parse(r.body).router === 'jev').body), { router: 'jev', key: GOOD, wakeGate: false });
  // Jev again, without a key: the one set stays.
  assert.deepEqual((await a.post('/admin/group-router', { router: 'jev' })).data, { router: 'jev', keySet: true, wakeGate: false });
  assert.ok(!door.log.join('').includes(GOOD), 'nor written to the log');

  // Haiku drops the key.
  assert.deepEqual((await a.post('/admin/group-router', { router: 'haiku' })).data, { router: 'haiku', keySet: false, wakeGate: false });
  assert.ok(!fs.readFileSync(file, 'utf8').includes(GOOD));
  const n = handed().length;
  await waitFor(() => (handed().slice(n).some((r) => JSON.parse(r.body).router === 'haiku') ? true : null), { what: 'the account to be handed Haiku' });

  // The wake gate (ADR 083): off until the admin switches it on; each account is handed it, and a choice of router
  // that does not send it keeps it.
  assert.deepEqual((await a.post('/admin/group-router', { router: 'haiku', wakeGate: true })).data, { router: 'haiku', keySet: false, wakeGate: true });
  let m = handed().length;
  await waitFor(() => (handed().slice(m).some((r) => JSON.parse(r.body).wakeGate === true) ? true : null), { what: 'the account to be handed the wake gate' });
  assert.deepEqual((await a.post('/admin/group-router', { router: 'haiku' })).data.wakeGate, true, 'kept when not sent');
  assert.equal(JSON.parse(fs.readFileSync(path.join(door.data, 'group-router.json'), 'utf8')).wakeGate, true);
  assert.deepEqual((await a.post('/admin/group-router', { router: 'haiku', wakeGate: false })).data.wakeGate, false);
  m = handed().length;
  await waitFor(() => (handed().slice(m).some((r) => JSON.parse(r.body).wakeGate === false) ? true : null), { what: 'the account to be handed the wake gate off' });
});
