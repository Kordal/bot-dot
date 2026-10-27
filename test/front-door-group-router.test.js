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
  const page = (await a.get('/admin')).text;
  assert.ok(page.includes('<h2>Decision model</h2>') && page.includes('<option value="jev">Jev latest</option>'), 'one choice of the model for every small decision (#536)');
  assert.deepEqual((await a.get('/admin/group-router')).data, { router: 'haiku', keySet: false, wakeGate: false, replaysPerHour: 0 });
  // The accounts are handed the choice every while: Haiku until the admin chooses.
  await waitFor(() => (handed().length ? true : null), { what: 'the account to be handed the router' });
  assert.deepEqual(JSON.parse(handed()[0].body), { router: 'haiku', key: null, wakeGate: false, replaysPerHour: 0 });
  assert.equal(handed()[0].headers['x-botdot-room'], '1', 'as the front door itself');

  assert.equal((await a.post('/admin/group-router', { router: 'jev' })).status, 400, 'Jev needs a key');
  assert.equal((await a.post('/admin/group-router', { router: 'gpt' })).status, 400);
  const refused = await a.post('/admin/group-router', { router: 'jev', key: BAD });
  assert.deepEqual([refused.status, refused.data.error], [400, 'OpenRouter refused this key.']);
  assert.deepEqual((await a.get('/admin/group-router')).data, { router: 'haiku', keySet: false, wakeGate: false, replaysPerHour: 0 }, 'a refused key is not kept');
  assert.equal(asked.at(-1).url, '/api/alpha/decisions');
  assert.equal(asked.at(-1).body.model, '~typesafe/jev-latest', 'the key is checked on the newest Jev (#536)');

  const chosen = await a.post('/admin/group-router', { router: 'jev', key: GOOD, wakeGate: false });
  assert.deepEqual([chosen.status, chosen.data], [200, { router: 'jev', keySet: true, wakeGate: false, replaysPerHour: 0 }]);
  assert.ok(!chosen.text.includes(GOOD) && !(await a.get('/admin/group-router')).text.includes(GOOD), 'the key is never answered');
  const file = path.join(door.data, 'group-router.json');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  await waitFor(() => (handed().some((r) => JSON.parse(r.body).router === 'jev') ? true : null), { what: 'the account to be handed Jev' });
  assert.deepEqual(JSON.parse(handed().find((r) => JSON.parse(r.body).router === 'jev').body), { router: 'jev', key: GOOD, wakeGate: false, replaysPerHour: 0 });
  // Jev again, without a key: the one set stays.
  assert.deepEqual((await a.post('/admin/group-router', { router: 'jev' })).data, { router: 'jev', keySet: true, wakeGate: false, replaysPerHour: 0 });
  assert.ok(!door.log.join('').includes(GOOD), 'nor written to the log');

  // Haiku drops the key.
  assert.deepEqual((await a.post('/admin/group-router', { router: 'haiku' })).data, { router: 'haiku', keySet: false, wakeGate: false, replaysPerHour: 0 });
  assert.ok(!fs.readFileSync(file, 'utf8').includes(GOOD));
  const n = handed().length;
  await waitFor(() => (handed().slice(n).some((r) => JSON.parse(r.body).router === 'haiku') ? true : null), { what: 'the account to be handed Haiku' });

  // The wake gate (ADR 083): off until the admin switches it on; each account is handed it, and a choice of router
  // that does not send it keeps it.
  assert.deepEqual((await a.post('/admin/group-router', { router: 'haiku', wakeGate: true })).data, { router: 'haiku', keySet: false, wakeGate: true, replaysPerHour: 0 });
  let m = handed().length;
  await waitFor(() => (handed().slice(m).some((r) => JSON.parse(r.body).wakeGate === true) ? true : null), { what: 'the account to be handed the wake gate' });
  assert.deepEqual((await a.post('/admin/group-router', { router: 'haiku' })).data.wakeGate, true, 'kept when not sent');
  assert.equal(JSON.parse(fs.readFileSync(path.join(door.data, 'group-router.json'), 'utf8')).wakeGate, true);
  assert.deepEqual((await a.post('/admin/group-router', { router: 'haiku', wakeGate: false })).data.wakeGate, false);
  m = handed().length;
  await waitFor(() => (handed().slice(m).some((r) => JSON.parse(r.body).wakeGate === false) ? true : null), { what: 'the account to be handed the wake gate off' });

  // Replays an hour (ADR 101): none until the admin sets them, a whole number from 0 to 60, kept when not sent, and
  // handed to each account. Its own section since #616, not in the decision model's form.
  const admin = (await a.get('/admin')).text;
  assert.ok(admin.includes('<section id="replays"><h2>Replays</h2>') && admin.includes('href="#replays"'));
  // Every section says in one line what it is for (#616).
  for (const id of ['machine', 'accounts', 'usage', 'sign-up-links', 'update-section', 'rooms', 'group-router', 'replays', 'boat', 'feedback']) {
    const at = admin.indexOf(`<section id="${id}">`);
    assert.ok(at >= 0 && admin.slice(at, admin.indexOf('</section>', at)).includes('class="note"'), id);
  }
  const routerForm = admin.slice(admin.indexOf('<form id="router-form"'), admin.indexOf('</form>', admin.indexOf('<form id="router-form"')));
  assert.ok(!routerForm.includes('replaysPerHour'), 'not in the decision model form');
  assert.ok(admin.slice(admin.indexOf('<form id="replays-form"')).includes('name="replaysPerHour"'));
  for (const bad of [-1, 61, 2.5, '6']) assert.equal((await a.post('/admin/group-router', { router: 'haiku', replaysPerHour: bad })).status, 400, String(bad));
  assert.equal((await a.post('/admin/group-router', { router: 'haiku', replaysPerHour: 12 })).data.replaysPerHour, 12);
  assert.equal((await a.post('/admin/group-router', { router: 'haiku' })).data.replaysPerHour, 12, 'kept when not sent');
  assert.equal(JSON.parse(fs.readFileSync(path.join(door.data, 'group-router.json'), 'utf8')).replaysPerHour, 12);
  m = handed().length;
  await waitFor(() => (handed().slice(m).some((r) => JSON.parse(r.body).replaysPerHour === 12) ? true : null), { what: 'the account to be handed the replays' });
  // POST /admin/replays (#616) sets them alone and keeps the decision model's choice.
  assert.deepEqual((await a.get('/admin/replays')).data, { replaysPerHour: 12 });
  for (const bad of [-1, 61, 2.5, '6', undefined]) assert.equal((await a.post('/admin/replays', { replaysPerHour: bad })).status, 400, String(bad));
  await a.post('/admin/group-router', { router: 'haiku', wakeGate: true });
  assert.deepEqual([(await a.post('/admin/replays', { replaysPerHour: 30 })).status, (await a.get('/admin/replays')).data], [200, { replaysPerHour: 30 }]);
  assert.deepEqual((await a.get('/admin/group-router')).data, { router: 'haiku', keySet: false, wakeGate: true, replaysPerHour: 30 });
  assert.equal(JSON.parse(fs.readFileSync(path.join(door.data, 'group-router.json'), 'utf8')).replaysPerHour, 30);
  m = handed().length;
  await waitFor(() => (handed().slice(m).some((r) => JSON.parse(r.body).replaysPerHour === 30) ? true : null), { what: 'the account to be handed the replays set alone' });
});
