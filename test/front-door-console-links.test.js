// The links root's step asks of the front door for the fleet console (#985, ADR 154), on a machine without an admin
// page: `node front-door.js sign-in-link|sign-up-link … --by console` prints one line of JSON, the link or why it was
// refused, and keeps an audit entry by the console that never holds the link (ADR 141).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const passkey = require('./fixtures/soft-passkey');
const { startFrontDoor, standIn } = require('./front-door-helpers');

const GB = 2 ** 30;
const SETUP_KEY = crypto.randomBytes(32).toString('base64url');

function loadDir(t, m) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-load-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  fs.writeFileSync(path.join(dir, 'machine.json'), JSON.stringify({ at: new Date().toISOString(), load: 0.2, ramUsed: 2 * GB, diskTotal: 100 * GB, diskUsed: 20 * GB, ...m }));
  return dir;
}
async function signUp(door, p, body) {
  const b = door.browser();
  const key = passkey.create({ rpId: door.rpId, origin: door.origin });
  const options = await b.post(`${p}/options`, body);
  if (options.status !== 200) return { b, done: options };
  return { b, key, done: await b.post(p, { ...body, credential: key.register(options.data.publicKey) }) };
}
// The command root's step runs in the front door's container, with the front door's own settings.
function ask(door, env, ...args) {
  const r = spawnSync(process.execPath, ['front-door.js', ...args, '--by', 'console'], {
    cwd: path.join(__dirname, '..'),
    env: { PATH: process.env.PATH, FRONT_DOOR_ORIGIN: door.origin, FRONT_DOOR_DATA: door.data, ...env },
    encoding: 'utf8',
  });
  assert.equal(r.stdout.split('\n').filter(Boolean).length, 1, `one line:\n${r.stdout}${r.stderr}`);
  return { status: r.status, said: JSON.parse(r.stdout), stderr: r.stderr };
}
const audit = (door) => fs.readFileSync(path.join(door.data, 'audit.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));

test('managed, one account: a sign-in link gives the account a new passkey, once, and no sign-up link is made', async (t) => {
  const env = { FRONT_DOOR_MANAGED: '1', FRONT_DOOR_ONE_ACCOUNT: 'owner', FRONT_DOOR_SETUP_KEY: SETUP_KEY };
  const door = await startFrontDoor({ env });
  const owner = await standIn(door, 'owner');
  t.after(async () => { await door.stop(); owner.close(); });
  const first = await signUp(door, `/sign-up/${SETUP_KEY}`, { name: 'owner' });
  assert.equal(first.done.status, 201, first.done.text);

  const made = ask(door, env, 'sign-in-link', '--account', 'owner');
  assert.equal(made.status, 0, made.stderr);
  assert.equal(made.said.state, 'made');
  assert.equal(made.said.kind, 'sign-in');
  assert.equal(made.said.account, 'owner');
  const p = new URL(made.said.url).pathname;
  assert.match(p, /^\/sign-up\/[A-Za-z0-9_-]+$/);
  assert.ok(Math.abs(Date.parse(made.said.expires) - Date.now() - 86400_000) < 60_000, 'a day, as the admin page\'s');

  // The owner who lost every device: a new passkey, and the old sessions end.
  const page = await door.browser().get(p);
  assert.equal(page.status, 200);
  assert.match(page.text, /new passkey/i);
  const again = await signUp(door, p, { name: 'owner' });
  assert.equal(again.done.status, 201, again.done.text);
  assert.equal(again.done.data.account, 'owner');
  assert.equal((await first.b.get('/api/bots')).status, 401, 'the lost devices\' sessions end');
  assert.equal((await again.b.get('/api/bots')).data.account, 'owner');
  assert.equal((await door.browser().get(p)).status, 410, 'it works once');

  // No sign-up link on a machine of one account: refused, and kept in the audit log.
  const signUpAsked = ask(door, env, 'sign-up-link');
  assert.equal(signUpAsked.status, 1);
  assert.deepEqual({ ...signUpAsked.said, error: undefined }, { state: 'refused', kind: 'sign-up', error: undefined });
  assert.match(signUpAsked.said.error, /holds one account, owner/);
  // Nor a sign-in link for an account it doesn't have.
  const nobody = ask(door, env, 'sign-in-link', '--account', 'nobody');
  assert.equal(nobody.status, 3);
  assert.equal(nobody.said.state, 'refused');
  assert.equal(nobody.said.account, 'nobody');

  const entries = audit(door).filter((e) => e.actor === 'console');
  assert.deepEqual(entries.map((e) => [e.action, e.account]), [['sign-in-link', 'owner'], ['link-refused', undefined], ['link-refused', 'nobody']]);
  assert.match(entries[0].detail, /^until 20\d\d-\d\d-\d\d \d\d:\d\d UTC$/);
  assert.match(entries[1].detail, /^sign-up link · /);
  assert.ok(audit(door).some((e) => e.action === 'passkey-added' && e.account === 'owner'), 'the new passkey too');
  // The link is in no log and no audit entry.
  const token = p.split('/').pop();
  assert.ok(!fs.readFileSync(path.join(door.data, 'audit.jsonl'), 'utf8').includes(token));
  assert.ok(!door.log.join('').includes(token));
});

test('managed, several: a sign-up link makes an account while its share fits, and a sign-up for a taken name is refused', async (t) => {
  const env = { FRONT_DOOR_MANAGED: '1', FRONT_DOOR_FIRST_ACCOUNT: 'owner', FRONT_DOOR_SETUP_KEY: SETUP_KEY };
  const load = loadDir(t, { cpus: 12, ramTotal: 23.4 * GB });
  const door = await startFrontDoor({ env: { ...env, FRONT_DOOR_LOAD: load } });
  t.after(() => door.stop());
  assert.equal((await signUp(door, `/sign-up/${SETUP_KEY}`, { name: 'owner' })).done.status, 201);

  const any = ask(door, env, 'sign-up-link');
  assert.equal(any.status, 0, any.stderr);
  assert.equal(any.said.state, 'made');
  assert.equal(any.said.kind, 'sign-up');
  assert.equal(any.said.account, undefined, 'for any name');
  assert.ok(Math.abs(Date.parse(any.said.expires) - Date.now() - 7 * 86400_000) < 60_000, 'seven days');
  const bea = await signUp(door, new URL(any.said.url).pathname, { name: 'bea' });
  assert.equal(bea.done.status, 201, bea.done.text);

  // A third share doesn't fit a 12-CPU, 24 GB machine: the link is made, and makes no account.
  const cleo = ask(door, env, 'sign-up-link', '--account', 'cleo');
  assert.equal(cleo.said.account, 'cleo');
  const full = await signUp(door, new URL(cleo.said.url).pathname, { name: 'cleo' });
  assert.equal(full.done.status, 409);
  assert.equal(full.done.data.full, true);

  const taken = ask(door, env, 'sign-up-link', '--account', 'bea');
  assert.equal(taken.status, 3);
  assert.equal(taken.said.state, 'refused');
  assert.match(taken.said.error, /exists already/);

  assert.deepEqual(audit(door).filter((e) => e.actor === 'console').map((e) => [e.action, e.account]),
    [['link-made', undefined], ['link-made', 'cleo'], ['link-refused', 'bea']]);
  for (const url of [any.said.url, cleo.said.url]) assert.ok(!door.log.join('').includes(url.split('/').pop()), 'no link in the log');
});

test('without --by console the command prints the link as before, and keeps no entry', async (t) => {
  const env = { FRONT_DOOR_MANAGED: '1', FRONT_DOOR_FIRST_ACCOUNT: 'owner', FRONT_DOOR_SETUP_KEY: SETUP_KEY };
  const door = await startFrontDoor({ env });
  t.after(() => door.stop());
  const r = spawnSync(process.execPath, ['front-door.js', 'sign-up-link'], {
    cwd: path.join(__dirname, '..'), env: { PATH: process.env.PATH, FRONT_DOOR_ORIGIN: door.origin, FRONT_DOOR_DATA: door.data, ...env }, encoding: 'utf8',
  });
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^\S+\/sign-up\/\S+\n\(works once, until /);
  assert.ok(!fs.existsSync(path.join(door.data, 'audit.jsonl')) || !audit(door).some((e) => e.actor === 'console'));
});
