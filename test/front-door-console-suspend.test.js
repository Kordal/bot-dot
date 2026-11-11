// The whole machine paused by the fleet console through root's step (install.sh's SUSPEND and RESUME, in
// test/installer-suspend.test.js): `node front-door.js suspend|resume --by console` suspends or resumes every account in
// the front door's data, as the admin page does for one, with an audit entry by the console for each.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const passkey = require('./fixtures/soft-passkey');
const { startFrontDoor, standIn } = require('./front-door-helpers');

const SETUP_KEY = crypto.randomBytes(32).toString('base64url');

function ask(door, env, kind) {
  const r = spawnSync(process.execPath, ['front-door.js', kind, '--by', 'console'], {
    cwd: path.join(__dirname, '..'),
    env: { PATH: process.env.PATH, FRONT_DOOR_ORIGIN: door.origin, FRONT_DOOR_DATA: door.data, ...env },
    encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.stdout.split('\n').filter(Boolean).length, 1, `one line:\n${r.stdout}${r.stderr}`);
  return JSON.parse(r.stdout);
}
const audit = (door) => fs.readFileSync(path.join(door.data, 'audit.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('managed, one account: suspend pauses the owner, who signs in to "paused" only, and resume lets them in again', async (t) => {
  const env = { FRONT_DOOR_MANAGED: '1', FRONT_DOOR_ONE_ACCOUNT: 'owner', FRONT_DOOR_SETUP_KEY: SETUP_KEY };
  const door = await startFrontDoor({ env });
  const owner = await standIn(door, 'owner');
  t.after(async () => { await door.stop(); owner.close(); });
  const b = door.browser();
  const key = passkey.create({ rpId: door.rpId, origin: door.origin });
  const options = await b.post(`/sign-up/${SETUP_KEY}/options`, { name: 'owner' });
  assert.equal((await b.post(`/sign-up/${SETUP_KEY}`, { name: 'owner', credential: key.register(options.data.publicKey) })).status, 201);
  assert.equal((await b.get('/api/bots')).status, 200);

  assert.deepEqual(ask(door, env, 'suspend'), { state: 'suspended', accounts: ['owner'] });
  const paused = await b.get('/api/bots');
  assert.equal(paused.status, 503);
  assert.equal(paused.data.paused, true);
  const page = await b.get('/');
  assert.equal(page.status, 503);
  assert.match(page.text, /paused by the admin/);
  const before = owner.seen.length;
  await b.get('/api/bots');
  assert.equal(owner.seen.length, before, 'no request reaches its botdot server');
  assert.deepEqual(ask(door, env, 'suspend'), { state: 'suspended', accounts: [] }, 'suspended already: nothing changes');

  assert.deepEqual(ask(door, env, 'resume'), { state: 'resumed', accounts: ['owner'] });
  assert.equal((await b.get('/api/bots')).status, 200);
  assert.deepEqual(ask(door, env, 'resume'), { state: 'resumed', accounts: [] });

  const entries = audit(door).filter((e) => e.actor === 'console');
  assert.deepEqual(entries.map((e) => [e.action, e.account]), [['suspend', 'owner'], ['resume', 'owner']]);
});
