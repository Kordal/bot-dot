// POST /api/update/offer is the front door's alone (#1690): on its socket with the header it sets and strips from every
// request a person sends. The account then keeps the `update` card in Needs you, for an app that asks for it by name
// (`?update=1`), and says the version once in the Chief's chat with a note that names the card (ADR 252).
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const passkey = require('./fixtures/soft-passkey');
const { startFrontDoor } = require('./front-door-helpers');
const { startServer, waitFor } = require('./helpers');

const ROOM = { 'x-botdot-room': '1' };
const offer = (over = {}) => ({ state: 'ready', version: 'abc1234', from: '0123456', when: 'manual', plan: null, deadline: '2999-01-01T10:00:00.000Z', notes: [{ title: 'Updates wait for idle' }], busy: true, ...over });

let srv;
before(async () => {
  srv = await startServer();
  // No quiet hours: the note would wait through the default night (22-7) when CI runs then.
  await srv.api('/settings', { method: 'PUT', body: { quietHours: { start: 0, end: 0, timeZone: 'UTC' } } });
});
after(async () => { await srv?.stop(); });

const cards = async () => (await srv.api('/asks?update=1')).data.filter((a) => a.kind === 'update');
const noteOf = async () => {
  for (const c of (await srv.api('/chief')).data.chats || []) {
    const chat = (await srv.api(`/chief/chats/${c.id}`)).data;
    const m = (chat.messages || []).find((x) => /new version of botdot/.test(x.text || ''));
    if (m) return m;
  }
  return null;
};

test('the front door alone tells the account its update: others get 403, and a wrong entry 400', async () => {
  assert.equal((await srv.api('/update/offer', { method: 'POST', body: offer() })).status, 403, 'a person through the front door');
  assert.equal((await srv.api('/update/offer', { method: 'POST', headers: ROOM, body: { state: 'soon' } })).status, 400);
  assert.equal((await srv.api('/update/offer', { method: 'GET', headers: ROOM })).status, 405);
  assert.deepEqual(await cards(), []);
});

test('the real front door strips the header from a person, so the owner through it is refused too', async () => {
  const ann = await startServer({ account: 'ann' });
  const door = await startFrontDoor({ env: { FRONT_DOOR_ADMIN: 'ann' } });
  try {
    fs.symlinkSync(require('path').dirname(ann.socket), require('path').join(door.sockets, ann.account));
    const owner = door.browser();
    const key = passkey.create({ rpId: door.rpId, origin: door.origin });
    const options = await owner.post(`${door.firstLink.path}/options`, { name: 'ann' });
    assert.equal((await owner.post(door.firstLink.path, { name: 'ann', credential: key.register(options.data.publicKey) })).status, 201);
    const r = await owner.post('/api/update/offer', offer(), { 'x-botdot-room': '1' });
    assert.equal(r.status, 403, r.text);
  } finally { await door.stop(); await ann.stop(); fs.rmSync(ann.dir, { recursive: true, force: true }); }
});

test('a version that waits is a card for an app that asks for it, a note in the Chief\'s chat once, and `update-offer` in the features', async () => {
  assert.ok((await srv.api('/version')).data.features.includes('update-offer'));
  const r = await srv.api('/update/offer', { method: 'POST', headers: ROOM, body: offer() });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.deepEqual((await srv.api('/asks')).data.filter((a) => a.kind === 'update'), [], 'an app that does not ask for it by name draws no card it would take for a skill');
  const [card] = await cards();
  assert.equal(card.bot, null);
  assert.equal(card.title, 'A new version is ready');
  assert.deepEqual(card.act, { verb: 'update-now', label: 'Now' });
  assert.deepEqual(card.acts.map((a) => a.verb), ['update-now', 'update-tonight']);
  assert.equal(card.busy, true);
  assert.equal(card.yesOn, 'card');
  assert.ok(card.text, 'a line for a notification');
  let note;
  await waitFor(async () => (note = await noteOf()), { what: 'the note' });
  assert.equal(note.role, 'chief');
  assert.equal(note.notice, true);
  assert.deepEqual(note.cards, [card.id]);
  assert.match(note.text, /- Updates wait for idle/);
  // Told again (every change, and after a failure): one card, one note.
  await srv.api('/update/offer', { method: 'POST', headers: ROOM, body: offer({ busy: false }) });
  assert.equal((await cards()).length, 1);
  assert.equal((await cards())[0].id, card.id);
  assert.equal((await cards())[0].busy, false);
  const all = [];
  for (const c of (await srv.api('/chief')).data.chats || []) all.push(...((await srv.api(`/chief/chats/${c.id}`)).data.messages || []).filter((x) => /new version of botdot/.test(x.text || '')));
  assert.equal(all.length, 1);
});

test('the card is answered on the front door, not here: a yes or a no on this server only says so', async () => {
  const [card] = await cards();
  assert.equal((await srv.api(`/asks/${card.id}`, { method: 'POST', body: { yes: true } })).status, 409);
  assert.equal((await srv.api(`/asks/${card.id}`, { method: 'POST', body: { yes: false } })).status, 409);
  assert.equal((await cards()).length, 1);
});

test('moving says it on the card, and none takes it away', async () => {
  await srv.api('/update/offer', { method: 'POST', headers: ROOM, body: { state: 'moving', version: 'abc1234' } });
  const [moving] = await cards();
  assert.equal(moving.title, 'Moving to the new version');
  assert.deepEqual(moving.acts, []);
  await srv.api('/update/offer', { method: 'POST', headers: ROOM, body: { state: 'none' } });
  assert.deepEqual(await cards(), []);
});
