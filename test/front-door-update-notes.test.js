// What a waiting version brings (#303): GET /front-door/update/notes answers the notes of the front door's version
// after the newest one the account's botdot server ships (its /api/version `whatsNew`), for that account's owner only,
// and none while nothing waits or when the account's server doesn't say.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const passkey = require('./fixtures/soft-passkey');
const { startFrontDoor, standIn } = require('./front-door-helpers');
const whatsNew = require('../lib/whats-new');

const note = (title) => `${title}\n- Point one\n- Point two\n`;
let door, requests, status, notes, stand, owner;
let version = { version: '0123456', whatsNew: '2026-10-20-old' };
before(async () => {
  requests = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-requests-'));
  status = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-status-'));
  notes = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-notes-'));
  for (const id of ['2026-10-20-old', '2026-10-21-first', '2026-10-22-second']) fs.writeFileSync(path.join(notes, `${id}.md`), note(`Note ${id}`));
  fs.writeFileSync(path.join(notes, '2026-10-22-zz-broken.md'), 'No points');
  door = await startFrontDoor({ env: { FRONT_DOOR_ADMIN: 'ann', FRONT_DOOR_REQUESTS: requests, FRONT_DOOR_STATUS: status, BOT_DOT_WHATS_NEW_DIR: notes } });
  stand = await standIn(door, 'ann', { answer: (req) => (req.url === '/api/version' ? [200, version] : null) });
  owner = door.browser();
  const key = passkey.create({ rpId: door.rpId, origin: door.origin });
  const options = await owner.post(`${door.firstLink.path}/options`, { name: 'ann' });
  const done = await owner.post(door.firstLink.path, { name: 'ann', credential: key.register(options.data.publicKey) });
  assert.equal(done.status, 201, done.text);
});
after(async () => {
  await door?.stop();
  stand?.close();
  for (const d of [requests, status, notes]) fs.rmSync(d, { recursive: true, force: true });
});
const waiting = () => { const since = new Date().toISOString(); fs.writeFileSync(path.join(status, 'account-ann.json'), JSON.stringify({ state: 'waiting', at: since, since, version: 'abc1234', from: '0123456' })); };

test('the notes after the newest one the account runs, newest first; a broken note is left out', async () => {
  waiting();
  const r = await owner.get('/front-door/update/notes');
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.data.entries, [
    { id: '2026-10-22-second', title: 'Note 2026-10-22-second', points: ['Point one', 'Point two'] },
    { id: '2026-10-21-first', title: 'Note 2026-10-21-first', points: ['Point one', 'Point two'] },
  ]);
  const asked = stand.seen.at(-1);
  assert.equal(asked.url, '/api/version');
  assert.equal(asked.headers['x-botdot-account'], 'ann');
  assert.equal(asked.headers.cookie, undefined, "the owner's cookie isn't passed on");
});

test("none while nothing waits, when the account's server doesn't say, or for nobody signed in", async () => {
  fs.rmSync(path.join(status, 'account-ann.json'), { force: true });
  const asked = stand.seen.length;
  assert.deepEqual((await owner.get('/front-door/update/notes')).data, { entries: [] });
  assert.equal(stand.seen.length, asked, 'nothing waits: its server is not asked');
  waiting();
  for (const v of [{ version: '0123456' }, { whatsNew: '../etc' }, { whatsNew: null }]) {
    version = v;
    assert.deepEqual((await owner.get('/front-door/update/notes')).data, { entries: [] }, JSON.stringify(v));
  }
  version = { whatsNew: '2026-10-22-second' };
  assert.deepEqual((await owner.get('/front-door/update/notes')).data, { entries: [] }, 'it has every note already');
  assert.equal((await door.browser().get('/front-door/update/notes')).status, 401);
  assert.equal((await owner.post('/front-door/update/notes', {})).status, 404);
});

test("whatsNew.after and newest read the notes' folder", () => {
  assert.equal(whatsNew.newest(notes), '2026-10-22-second');
  assert.deepEqual(whatsNew.after('2026-10-21-first', { dir: notes }).map((n) => n.id), ['2026-10-22-second']);
  assert.deepEqual(whatsNew.after('2026-10-19-gone', { dir: notes }).map((n) => n.id), ['2026-10-22-second', '2026-10-21-first', '2026-10-20-old'], 'all of them, no cap (#380)');
  assert.deepEqual(whatsNew.after(null, { dir: notes }), []);
  assert.equal(whatsNew.newest(path.join(notes, 'none')), null);
});
