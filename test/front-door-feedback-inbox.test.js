// A managed machine's statuses (#1572, ADR 259): the fleet console's agent writes the statuses of the machine's own
// reports to inbox/feedback-statuses.json in the front door's data, and the front door applies them to My reports and
// removes the file. Here a real front door runs as a managed machine, and the test writes the file as the agent does
// (whole, under a hidden name, renamed over the old one).
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const passkey = require('./fixtures/soft-passkey');
const { startFrontDoor, standIn } = require('./front-door-helpers');
const { waitFor } = require('./helpers');
const inboxLib = require('../lib/front-door/inbox');

const SETUP_KEY = crypto.randomBytes(32).toString('base64url');
const ORIGIN = 'https://bots.example.com';
const FAST = { FRONT_DOOR_FEEDBACK_INBOX_EVERY_MS: '100' };
const cleanups = [];
after(async () => { for (const fn of cleanups.reverse()) await fn(); });

// A managed machine of one account, `owner`, signed in; `reports` are sent as it sends them.
async function managed(env = {}) {
  const door = await startFrontDoor({ env: { FRONT_DOOR_ORIGIN: ORIGIN, FRONT_DOOR_MANAGED: '1', FRONT_DOOR_ONE_ACCOUNT: 'owner', FRONT_DOOR_SETUP_KEY: SETUP_KEY, ...FAST, ...env } });
  const stand = await standIn(door, 'owner');
  cleanups.push(async () => { await door.stop(); stand.close(); });
  const b = door.browser();
  const key = passkey.create({ rpId: door.rpId, origin: door.origin });
  const options = await b.post(`/sign-up/${SETUP_KEY}/options`, { name: 'owner' });
  assert.equal(options.status, 200, options.text);
  const done = await b.post(`/sign-up/${SETUP_KEY}`, { name: 'owner', credential: key.register(options.data.publicKey) });
  assert.equal(done.status, 201, done.text);
  return { door, b, inbox: path.join(door.data, 'inbox'), file: path.join(door.data, 'inbox', 'feedback-statuses.json') };
}
// `n` reports of the owner, answered by the front door's own ids.
async function send(m, n) {
  const ids = [];
  for (let i = 0; i < n; i++) {
    const r = await m.b.post('/front-door/feedback', { kind: 'bug', text: `Report ${i}` });
    assert.equal(r.status, 201, r.text);
    ids.push(r.data.id);
  }
  return ids;
}
// What each managed owner's yes (#1571) does to its reports: they are the developers', which My reports lists.
function forDevelopers(m, ids) {
  const file = path.join(m.door.data, 'front-door.json');
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  for (const f of data.feedback) if (ids.includes(f.id)) f.to = 'developers';
  fs.writeFileSync(`${file}.t`, JSON.stringify(data), { mode: 0o600 });
  fs.renameSync(`${file}.t`, file);
}
// The agent's way: the whole list under a hidden name in the folder, renamed over the old file, mode 600.
function agentWrites(m, content) {
  const hidden = path.join(m.inbox, '.feedback-statuses.json.tmp');
  fs.writeFileSync(hidden, typeof content === 'string' ? content : JSON.stringify(content), { mode: 0o600 });
  fs.renameSync(hidden, m.file);
}
const reports = async (m) => (await m.b.get('/front-door/feedback')).data.reports;
const said = (m) => m.door.log.join('');
const gone = (m) => waitFor(() => !fs.existsSync(m.file), { what: 'the statuses file to be removed' });
const troubles = (m) => said(m).split('\n').filter((l) => /couldn't apply the statuses file/.test(l));
const settle = (ms = 600) => new Promise((r) => setTimeout(r, ms));
const rid = () => crypto.randomBytes(16).toString('hex');

test('the front door makes the inbox folder at its start, mode 700, and leaves it alone otherwise', async () => {
  const m = await managed();
  assert.ok(fs.statSync(m.inbox).isDirectory());
  assert.equal(fs.statSync(m.inbox).mode & 0o777, 0o700);
  assert.deepEqual(fs.readdirSync(m.inbox), [], 'nothing in it');
});

test('statuses of this machine\'s reports reach My reports and the file is removed; other ids and wrong shapes are dropped', async () => {
  const m = await managed();
  const [one, two, three] = await send(m, 3);
  forDevelopers(m, [one, two, three]);
  const session = (await m.b.get('/front-door/session')).data;
  assert.equal(session.feedbackReports, true, 'a managed owner with reports to the developers has My reports');
  assert.deepEqual((await reports(m)).map((r) => r.status), ['sent', 'sent', 'sent']);

  agentWrites(m, [
    { id: one, status: 'fixed', fixedIn: '2026-11-22-my-reports', issue: 'https://github.com/Kordal/bot-dot/issues/12', note: 'Thanks, fixed' },
    { id: two, status: 'seen', fixedIn: 'not a note id', issue: 'https://evil.example/issues/1', note: 'x'.repeat(201), extra: '<b>no</b>' },
    { id: rid(), status: 'fixed' }, // a report of another machine
    { id: three, status: 'bogus' }, // not one of the four words: dropped whole
    { id: 'NOT-AN-ID', status: 'fixed' },
    { id: three.toUpperCase(), status: 'fixed' },
    'a string', null, 7, [], { status: 'fixed' },
  ]);
  await gone(m);

  const byId = Object.fromEntries((await reports(m)).map((r) => [r.id, r]));
  assert.deepEqual(byId[one], { id: one, created: byId[one].created, kind: 'bug', text: 'Report 0', status: 'fixed', fixedIn: '2026-11-22-my-reports', issue: 'https://github.com/Kordal/bot-dot/issues/12', note: 'Thanks, fixed' });
  assert.deepEqual(byId[two], { id: two, created: byId[two].created, kind: 'bug', text: 'Report 1', status: 'seen' }, 'each field that fails is dropped, the rest stays');
  assert.equal(byId[three].status, 'sent', 'a status of none of the four words changes nothing');
  assert.equal(JSON.parse(fs.readFileSync(path.join(m.door.data, 'front-door.json'), 'utf8')).feedback.length, 3, 'no report was made by the file');
  assert.deepEqual(troubles(m), []);
  assert.match(said(m), /applied the statuses file of the fleet console: 3 of 11 entries well-formed, 2 reports changed/);
});

test('a status replaces the one kept, and applying the same file twice changes nothing more', async () => {
  const m = await managed();
  const [one] = await send(m, 1);
  forDevelopers(m, [one]);
  const list = [{ id: one, status: 'fixed', fixedIn: '2026-11-22-my-reports', note: 'Done' }];
  agentWrites(m, list);
  await gone(m);
  const first = await reports(m);
  agentWrites(m, list);
  await gone(m);
  assert.deepEqual(await reports(m), first);
  // As the relay's answer does: the latest word replaces the kept one, its fixedIn and note included.
  agentWrites(m, [{ id: one, status: 'wontfix', note: 'Not planned' }]);
  await gone(m);
  const [now] = await reports(m);
  assert.equal(now.status, 'wontfix');
  assert.equal(now.note, 'Not planned');
  assert.ok(!('fixedIn' in now));
});

test('a report that went to an admin, not to the developers, is not touched: it is not listed in My reports', async () => {
  const m = await managed();
  const [one] = await send(m, 1);
  agentWrites(m, [{ id: one, status: 'fixed' }]);
  await gone(m);
  assert.equal((await m.b.get('/front-door/feedback')).status, 404);
  const kept = JSON.parse(fs.readFileSync(path.join(m.door.data, 'front-door.json'), 'utf8')).feedback;
  assert.equal(kept[0].status, undefined);
});

test('a file that is no JSON, or too large, is left in place and logged once, nothing applied', async () => {
  const m = await managed();
  const [one] = await send(m, 1);
  forDevelopers(m, [one]);
  agentWrites(m, `[{ "id": "${one}", "status": "fixed" }`); // cut off
  await waitFor(() => troubles(m).length > 0, { what: 'the trouble to be logged' });
  await settle();
  assert.ok(fs.existsSync(m.file), 'left in place');
  assert.equal(troubles(m).length, 1, 'said once, not at every round');
  assert.match(troubles(m)[0], /is not JSON/);
  assert.equal((await reports(m))[0].status, 'sent');

  // Too large: a valid list, padded past 1 MB.
  agentWrites(m, `[{ "id": "${one}", "status": "fixed" }]${' '.repeat(inboxLib.MAX_BYTES)}`);
  await waitFor(() => troubles(m).length > 1, { what: 'the second trouble to be logged' });
  assert.ok(fs.existsSync(m.file));
  assert.match(troubles(m)[1], /larger than/);
  assert.equal((await reports(m))[0].status, 'sent');

  // The console writes a good one over it: applied and removed.
  agentWrites(m, [{ id: one, status: 'seen' }]);
  await gone(m);
  assert.equal((await reports(m))[0].status, 'seen');
});

test('JSON that is no list holds nothing: it is removed and nothing is applied', async () => {
  const m = await managed();
  const [one] = await send(m, 1);
  forDevelopers(m, [one]);
  agentWrites(m, { id: one, status: 'fixed' });
  await gone(m);
  assert.equal((await reports(m))[0].status, 'sent');
  assert.deepEqual(troubles(m), []);
});

test('a link or a folder in the file\'s place is not followed or read, and is left', async () => {
  const m = await managed();
  const [one] = await send(m, 1);
  forDevelopers(m, [one]);
  const elsewhere = path.join(m.door.data, 'elsewhere.json');
  fs.writeFileSync(elsewhere, JSON.stringify([{ id: one, status: 'fixed' }]));
  fs.symlinkSync(elsewhere, m.file);
  await waitFor(() => troubles(m).length > 0, { what: 'the trouble to be logged' });
  await settle();
  assert.match(troubles(m)[0], /is a link, not a regular file/);
  assert.ok(fs.lstatSync(m.file).isSymbolicLink(), 'the link is left');
  assert.ok(fs.existsSync(elsewhere), 'what it names is untouched');
  assert.equal((await reports(m))[0].status, 'sent');

  fs.rmSync(m.file);
  fs.mkdirSync(m.file);
  await waitFor(() => troubles(m).length > 1, { what: 'the second trouble to be logged' });
  assert.match(troubles(m)[1], /is a folder, not a regular file/);
  assert.ok(fs.statSync(m.file).isDirectory());
  assert.equal((await reports(m))[0].status, 'sent');
});

test('a machine that is not managed never reads the file, and makes no inbox', async () => {
  const door = await startFrontDoor({ env: { FRONT_DOOR_ADMIN: 'ann', ...FAST } });
  cleanups.push(() => door.stop());
  assert.ok(!fs.existsSync(path.join(door.data, 'inbox')), 'no folder is made');
  const dir = path.join(door.data, 'inbox');
  fs.mkdirSync(dir);
  const file = path.join(dir, 'feedback-statuses.json');
  fs.writeFileSync(file, JSON.stringify([{ id: rid(), status: 'fixed' }]));
  await settle(800);
  assert.ok(fs.existsSync(file), 'never read, so never removed');
  assert.deepEqual(troubles({ door }), []);
  assert.doesNotMatch(door.log.join(''), /statuses file/);
});

test('the inbox folder is kept mode 700, and a link in its place is an error', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-inbox-'));
  cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
  const dir = path.join(root, 'inbox');
  const box = inboxLib.create(dir);
  box.ensure();
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700);
  fs.chmodSync(dir, 0o755);
  box.ensure();
  assert.equal(fs.statSync(dir).mode & 0o777, 0o700, 'put back');
  fs.rmSync(dir, { recursive: true });
  fs.mkdirSync(path.join(root, 'other'));
  fs.symlinkSync(path.join(root, 'other'), dir);
  assert.throws(() => box.ensure(), /is not a folder/);
});

test('the file is read only as it was: nothing applied is removed when apply fails, and a file the agent replaced meanwhile stays', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-inbox-'));
  cleanups.push(() => fs.rmSync(root, { recursive: true, force: true }));
  const box = inboxLib.create(path.join(root, 'inbox'));
  box.ensure();
  const id = rid();
  const write = (list) => { fs.writeFileSync(`${box.file}.t`, JSON.stringify(list)); fs.renameSync(`${box.file}.t`, box.file); };
  assert.equal(box.take(() => assert.fail('no file, nothing to apply')), null);

  write([{ id, status: 'seen' }, { id, status: 'fixed', note: 'last counts' }]);
  assert.throws(() => box.take(() => { throw new Error('the store failed'); }), /the store failed/);
  assert.ok(fs.existsSync(box.file), 'left when applying failed');

  let got;
  const took = box.take((s) => { got = s; write([{ id, status: 'wontfix' }]); return 1; });
  assert.deepEqual(got, { [id]: { status: 'fixed', note: 'last counts' } });
  assert.deepEqual([took.entries, took.kept, took.result], [2, 1, 1]);
  assert.ok(fs.existsSync(box.file), 'the console\'s newer list is not removed');
  assert.equal(box.take((s) => s[id].status).result, 'wontfix');
  assert.ok(!fs.existsSync(box.file));
});
