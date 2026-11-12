// Cancelling unused sign-up links on a machine without an admin page (#1279): `node front-door.js revoke-links
// --account NAME [--by console]` revokes every open sign-up link for NAME, a new `sign-up-link --account NAME` closes
// NAME's older ones, and a revoked link says it was cancelled, while a used or ended one says what it always said.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const store = require('../lib/front-door/store');
const passkey = require('./fixtures/soft-passkey');
const { startFrontDoor } = require('./front-door-helpers');

const SETUP_KEY = crypto.randomBytes(32).toString('base64url');
const CANCELLED = 'This sign-up link was cancelled. Ask for a new one.';
const ENDED = 'This sign-up link was used or has ended.';

function run(door, env, ...args) {
  return spawnSync(process.execPath, ['front-door.js', ...args], {
    cwd: path.join(__dirname, '..'),
    env: { PATH: process.env.PATH, FRONT_DOOR_ORIGIN: door.origin, FRONT_DOOR_DATA: door.data, ...env },
    encoding: 'utf8',
  });
}
function ask(door, env, ...args) {
  const r = run(door, env, ...args, '--by', 'console');
  assert.equal(r.stdout.split('\n').filter(Boolean).length, 1, `one line:\n${r.stdout}${r.stderr}`);
  return { status: r.status, said: JSON.parse(r.stdout), stderr: r.stderr };
}
const audit = (door) => fs.readFileSync(path.join(door.data, 'audit.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
async function signUp(door, p, body) {
  const b = door.browser();
  const key = passkey.create({ rpId: door.rpId, origin: door.origin });
  const options = await b.post(`${p}/options`, body);
  if (options.status !== 200) return options;
  return b.post(p, { ...body, credential: key.register(options.data.publicKey) });
}

test('store: revokeSignUpLinks closes the account\'s open sign-up links alone, and replace closes the older ones', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-revoke-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const doors = store.open(dir);
  const origin = 'https://x.example';
  const token = (made) => made.url.split('/').pop();
  const bob1 = doors.newSignUpLink({ origin, account: 'bob' });
  const bob2 = doors.newSignUpLink({ origin, account: 'bob' });
  assert.equal(bob2.revoked, 0, 'without replace, the older one stays');
  const any = doors.newSignUpLink({ origin });
  const cleo = doors.newSignUpLink({ origin, account: 'cleo' });
  const old = doors.newSignUpLink({ origin, account: 'bob', now: Date.now() - 8 * 86400_000 });

  assert.equal(doors.revokeSignUpLinks('bob'), 2);
  assert.equal(doors.openLink(token(bob1)), null);
  assert.equal(doors.openLink(token(bob2)), null);
  assert.deepEqual(doors.revokedLink(token(bob1)), { signIn: false });
  assert.equal(doors.revokedLink(token(old)), null, 'an ended one is not revoked');
  assert.ok(doors.openLink(token(any)), 'a link for any name is not touched');
  assert.ok(doors.openLink(token(cleo)), 'another account\'s is not');
  assert.equal(doors.revokeSignUpLinks('bob'), 0, 'none left: 0, no error');
  assert.equal(doors.revokeSignUpLinks('nobody'), 0);
  assert.throws(() => doors.revokeSignUpLinks('../x'), (e) => e.status === 400);
  assert.throws(() => doors.revokeSignUpLinks(''), (e) => e.status === 400);

  const cleo2 = doors.newSignUpLink({ origin, account: 'cleo', replace: true });
  assert.equal(cleo2.revoked, 1);
  assert.equal(doors.openLink(token(cleo)), null);
  assert.ok(doors.openLink(token(cleo2)), 'the newest works');
  assert.equal(doors.newSignUpLink({ origin, replace: true }).revoked, 0, 'a link for any name replaces nothing');
  assert.ok(doors.openLink(token(any)));
});

test('managed: the console revokes an account\'s link, which then says it was cancelled; a second link closes the first', async (t) => {
  const env = { FRONT_DOOR_MANAGED: '1', FRONT_DOOR_FIRST_ACCOUNT: 'owner', FRONT_DOOR_SETUP_KEY: SETUP_KEY };
  const door = await startFrontDoor({ env });
  t.after(() => door.stop());

  const first = ask(door, env, 'sign-up-link', '--account', 'bob');
  assert.equal(first.said.state, 'made');
  const second = ask(door, env, 'sign-up-link', '--account', 'bob');
  assert.equal(second.said.state, 'made');
  const p1 = new URL(first.said.url).pathname;
  const p2 = new URL(second.said.url).pathname;
  const page = await door.browser().get(p1);
  assert.equal(page.status, 410);
  assert.ok(page.text.includes(CANCELLED), page.text);
  assert.equal((await door.browser().get(p2)).status, 200, 'the newest one works');

  const revoked = ask(door, env, 'revoke-links', '--account', 'bob');
  assert.equal(revoked.status, 0, revoked.stderr);
  assert.deepEqual(revoked.said, { state: 'revoked', account: 'bob', count: 1 });
  const api = await door.browser().post(`${p2}/options`, { name: 'bob' });
  assert.equal(api.status, 410);
  assert.equal(api.data.error, CANCELLED);
  assert.deepEqual(ask(door, env, 'revoke-links', '--account', 'bob').said, { state: 'revoked', account: 'bob', count: 0 });

  const bad = ask(door, env, 'revoke-links', '--account', 'Bob!');
  assert.equal(bad.status, 2);
  assert.equal(bad.said.state, 'refused');
  assert.equal(ask(door, env, 'revoke-links').status, 2, 'no name');

  const entries = audit(door).filter((e) => e.actor === 'console').map((e) => [e.action, e.account, e.detail]);
  assert.deepEqual(entries.filter(([a]) => a === 'link-revoked'), [
    ['link-revoked', 'bob', '1 older sign-up link'],
    ['link-revoked', 'bob', '1 sign-up link'],
    ['link-revoked', 'bob', '0 sign-up links'],
  ]);
  const log = fs.readFileSync(path.join(door.data, 'audit.jsonl'), 'utf8');
  for (const p of [p1, p2]) assert.ok(!log.includes(p.split('/').pop()), 'no token in the audit log');

  // Without --by console: plain words, and no entry.
  const before = audit(door).length;
  const plain = run(door, env, 'revoke-links', '--account', 'cleo');
  assert.equal(plain.status, 0, plain.stderr);
  assert.equal(plain.stdout, '0 sign-up links for cleo revoked.\n');
  assert.equal(audit(door).length, before);
  assert.equal(run(door, env, 'revoke-links', '--account', '../x').status, 2);
});

test('used and ended links say what they always said', async (t) => {
  const env = { FRONT_DOOR_MANAGED: '1', FRONT_DOOR_FIRST_ACCOUNT: 'owner', FRONT_DOOR_SETUP_KEY: SETUP_KEY };
  const door = await startFrontDoor({ env });
  t.after(() => door.stop());
  assert.equal((await signUp(door, `/sign-up/${SETUP_KEY}`, { name: 'owner' })).status, 201);
  const made = ask(door, env, 'sign-up-link', '--account', 'bea');
  const p = new URL(made.said.url).pathname;
  assert.equal((await signUp(door, p, { name: 'bea' })).status, 201);
  // Used, then asked to revoke: it stays used.
  assert.equal(ask(door, env, 'revoke-links', '--account', 'bea').said.count, 0);
  const used = await door.browser().post(`${p}/options`, { name: 'bea' });
  assert.equal(used.status, 410);
  assert.equal(used.data.error, ENDED);
  const ended = door.newLink({ ageDays: 8 });
  const old = await door.browser().post(`${ended.path}/options`, { name: 'dan' });
  assert.equal(old.status, 410);
  assert.equal(old.data.error, ENDED);
  const unknown = await door.browser().get('/sign-up/nothing-like-a-link');
  assert.equal(unknown.status, 410);
  assert.ok(!unknown.text.includes('cancelled'));
});
