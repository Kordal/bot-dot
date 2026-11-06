// Upload from phone's codes (lib/drops.js, ADR 165) and their address at the front door (lib/front-door/drops.js).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const dropsLib = require('../lib/drops');
const { dropOf, dropHeaders } = require('../lib/front-door/drops');
const { addressOf } = require('../lib/routes/drops');

test('a code is good for ten minutes and 20 files, then only looked at, then gone', () => {
  let t = 1_000_000;
  const drops = dropsLib.create({ now: () => t });
  const d = drops.make({ to: '/api/uploads?to=chief', name: 'Chief\nof Staff' });
  assert.equal(d.name, 'Chiefof Staff', 'no control characters');
  assert.ok(drops.open(drops.get(d.token)));
  for (let i = 0; i < dropsLib.MAX_FILES; i++) drops.arriving(d, `f${i}`, 1);
  assert.ok(drops.full(d));
  t += dropsLib.DROP_MS;
  assert.equal(drops.open(drops.get(d.token)), false, 'expired');
  assert.equal(drops.view(d).open, false);
  t += dropsLib.DROP_MS + 1;
  assert.equal(drops.get(d.token), null, 'gone');
  assert.equal(drops.get('../../etc'), null);
});

test('no more than 20 codes at once: a new one ends the oldest', () => {
  const drops = dropsLib.create();
  const first = drops.make({ to: '/api/uploads?to=chief' });
  for (let i = 0; i < 20; i++) drops.make({ to: '/api/uploads?to=chief' });
  assert.equal(drops.get(first.token), null);
});

test('the front door knows a phone\'s address and passes on only what the upload needs', () => {
  const token = 'A'.repeat(32);
  assert.deepEqual(dropOf(`/drop/bart/${token}`), { account: 'bart', token, path: `/api/drop/${token}` });
  assert.deepEqual(dropOf(`/drop/bart/${token}/files`), { account: 'bart', token, path: `/api/drop/${token}/files` });
  for (const p of [`/drop/Bart!/${token}`, `/drop/bart/${token}x`, `/drop/bart/${token}/other`, '/drop/bart/short', `/api/drop/${token}`]) assert.equal(dropOf(p), null, p);
  const req = { headers: { cookie: 'botdot_session=x', authorization: 'Bearer y', 'x-chief-key': 'k', 'x-file-name': 'a.jpg', 'x-bot-dot': '1', 'content-length': '3', host: 'hq.example' } };
  assert.deepEqual(dropHeaders(/** @type {any} */ (req), 'bart', '1.2.3.4', 'https'), {
    'x-bot-dot': '1', 'x-file-name': 'a.jpg', 'content-length': '3', host: 'hq.example',
    'x-forwarded-for': '1.2.3.4', 'x-forwarded-proto': 'https', 'x-botdot-account': 'bart', 'x-botdot-drop': '1',
  });
});

test('a phone reaches the front door\'s own address, unless that is this machine alone', () => {
  assert.deepEqual(addressOf('https://hq.botdot.app', 'bart', 't'), { url: 'https://hq.botdot.app/drop/bart/t', reachable: true });
  assert.equal(addressOf('https://botdot.tail1234.ts.net', 'bart', 't').reachable, true);
  for (const o of ['http://localhost:4700', 'http://127.0.0.1:4700', 'http://botdot.localhost', 'http://[::1]:4700']) assert.equal(addressOf(o, 'bart', 't').reachable, false, o);
  assert.deepEqual(addressOf(null, 'bart', 't'), { url: null, reachable: false });
});
