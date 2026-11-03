// A daily limit of new accounts per address, and blocked addresses (#913): one address makes at most `limit` accounts
// a day (3 unless the admin says, an IPv6 address counted as its /64); a `sign-up` block refuses a sign-up link and
// lets a session through, an `access` block refuses both, and its sign-in, and its calls; a block with an end ends by
// itself; the admin is never shut out by a block of their own address; every change and refusal is in the audit log.
// The address is the one limits.clientOf reads: the tests reach the front door from this machine, so it takes the one
// X-Forwarded-For names, as it does behind Caddy. A sign-up from this machine itself is never limited.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const passkey = require('./fixtures/soft-passkey');
const { startFrontDoor, standIn } = require('./front-door-helpers');
const blocks = require('../lib/front-door/blocks');

let door;
const stands = {};
const browsers = {};
const keys = {};
before(async () => {
  door = await startFrontDoor({ env: { FRONT_DOOR_ADMIN: 'ann' } });
  stands.ann = await standIn(door, 'ann', { answer: () => [200, { account: 'ann' }] });
  browsers.ann = (await trySignUp('ann', door.firstLink)).b;
});
after(async () => {
  await door?.stop();
  for (const s of Object.values(stands)) s.close();
});

const from = (address) => (address ? { 'X-Forwarded-For': address } : {});
const pathOf = (link) => (typeof link === 'string' ? new URL(link).pathname : link.path);
const newLink = async () => (await browsers.ann.post('/admin/links', {})).data.url;
// A sign-up from `address`: { b, options, done }, done the last answer.
async function trySignUp(name, link, address) {
  const p = pathOf(link);
  const b = door.browser();
  const key = passkey.create({ rpId: door.rpId, origin: door.origin });
  const options = await b.post(`${p}/options`, { name }, from(address));
  if (options.status !== 200) return { b, options, done: options };
  const done = await b.post(p, { name, credential: key.register(options.data.publicKey) }, from(address));
  if (done.status === 201) keys[name] = key;
  return { b, options, done };
}
async function signUp(name, address) {
  const r = await trySignUp(name, await newLink(), address);
  assert.equal(r.done.status, 201, r.done.text);
  return r.b;
}
async function signIn(name, address) {
  const b = door.browser();
  const options = await b.post('/sign-in/options', {}, from(address));
  assert.equal(options.status, 200, options.text);
  return { b, r: await b.post('/sign-in', { credential: keys[name].signIn(options.data.publicKey) }, from(address)) };
}
const audit = async (action) => (await browsers.ann.get(`/admin/audit?action=${action}`)).data.entries;
const addBlock = (body) => browsers.ann.post('/admin/blocks', body);
const removeAll = async () => { for (const b of (await browsers.ann.get('/admin/blocks')).data.blocks) await browsers.ann.post(`/admin/blocks/${b.id}/remove`, {}); };

test('addresses and ranges, IPv4 and IPv6, are read, written short and matched', () => {
  assert.equal(blocks.checkCidr('203.0.113.7'), '203.0.113.7/32');
  assert.equal(blocks.checkCidr('203.0.113.77/24'), '203.0.113.0/24');
  assert.equal(blocks.checkCidr('2001:DB8:0:0::1/32'), '2001:db8::/32');
  assert.equal(blocks.checkCidr('::1'), '::1/128');
  assert.equal(blocks.checkCidr('::ffff:203.0.113.7'), '203.0.113.7/32', 'IPv4 written as IPv6 is IPv4, as clientOf reads it');
  for (const bad of ['', '203.0.113', '203.0.113.256', '203.0.113.0/33', '2001:db8::1::2', '2001:db8::/129', 'example.com', '1.2.3.4/24/1', 7]) {
    assert.throws(() => blocks.checkCidr(bad), { status: 400 }, String(bad));
  }
  assert.equal(blocks.covers('203.0.113.0/24', '203.0.113.200'), true);
  assert.equal(blocks.covers('203.0.113.0/24', '203.0.114.1'), false);
  assert.equal(blocks.covers('2001:db8::/32', '2001:db8:ffff::9'), true);
  assert.equal(blocks.covers('2001:db8::/32', '2001:db9::9'), false);
  assert.equal(blocks.covers('0.0.0.0/0', '2001:db8::1'), false, 'an IPv4 range never covers an IPv6 address');
  assert.equal(blocks.limitKey('2001:db8:1:2:3:4:5:6'), '2001:db8:1:2::/64');
  assert.equal(blocks.limitKey('198.51.100.4'), '198.51.100.4');
  // The machine itself (the install, npm start) isn't limited; an address from outside is.
  assert.deepEqual(['127.0.0.1', '127.8.9.10', '::1', '10.0.0.1', '2001:db8::1'].map(blocks.local), [true, true, true, false, false]);
  // An access block stops sign-ups too; a sign-up block doesn't stop access; one that ended stops nothing.
  const list = [{ cidr: '198.51.100.0/24', level: 'sign-up' }, { cidr: '192.0.2.0/24', level: 'access' }, { cidr: '203.0.113.0/24', level: 'access', until: new Date(Date.now() - 1).toISOString() }];
  assert.equal(blocks.blocking(list, '198.51.100.1', 'sign-up')?.level, 'sign-up');
  assert.equal(blocks.blocking(list, '198.51.100.1', 'access'), null);
  assert.equal(blocks.blocking(list, '192.0.2.1', 'sign-up')?.level, 'access');
  assert.equal(blocks.blocking(list, '203.0.113.1', 'access'), null);
});

test('the fourth account from one address in a day is refused, and another address is not', async () => {
  assert.equal((await browsers.ann.get('/admin/blocks')).data.limit, 3);
  for (const name of ['al', 'bo', 'cy']) await signUp(name, '198.51.100.1');
  const link = await newLink();
  const page = await door.browser().get(pathOf(link), from('198.51.100.1'));
  assert.equal(page.status, 429);
  assert.match(page.text, /Too many new accounts from here today/);
  assert.ok(Number(page.headers['retry-after']) > 23 * 3600);
  const refused = await trySignUp('di', link, '198.51.100.1');
  assert.equal(refused.options.status, 429, refused.options.text);
  assert.equal(refused.options.data.error, 'Too many new accounts from here today. Try again tomorrow.');
  // The link stays open, and another address makes its account with it.
  const other = await trySignUp('di', link, '198.51.100.2');
  assert.equal(other.done.status, 201, other.done.text);
  // Kept once an hour for each address, however often it tries.
  const entries = await audit('sign-up-limited');
  assert.equal(entries.length, 1);
  assert.deepEqual([entries[0].actor, entries[0].detail], ['front-door', '198.51.100.1 · 3 accounts in a day']);
});

test('the admin sets the limit; an IPv6 address counts as its /64', async () => {
  for (const bad of [{}, { limit: 0 }, { limit: 1001 }, { limit: '2' }, { limit: 1.5 }]) {
    const r = await browsers.ann.post('/admin/blocks/limit', bad);
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal(r.data.error, blocks.LIMIT_RULE);
  }
  const set = await browsers.ann.post('/admin/blocks/limit', { limit: 1 });
  assert.equal(set.status, 200, set.text);
  assert.equal(set.data.limit, 1);
  await signUp('ed', '2001:db8:1:1::a');
  assert.equal((await trySignUp('fi', await newLink(), '2001:db8:1:1::b')).options.status, 429, 'the same /64');
  await signUp('fi', '2001:db8:1:2::a');
  assert.deepEqual((await audit('sign-up-limit')).map((e) => [e.actor, e.detail]), [['ann', '1 account a day']]);
  await browsers.ann.post('/admin/blocks/limit', { limit: 3 });
  assert.equal(JSON.parse(fs.readFileSync(path.join(door.data, 'front-door.json'), 'utf8')).signUpLimit, undefined, 'the default is not written');
});

test('a sign-up block refuses a sign-up link and lets a signed-in session through', async () => {
  stands.al = await standIn(door, 'al', { answer: () => [200, { account: 'al' }] });
  const add = await addBlock({ cidr: '198.51.100.0/24', level: 'sign-up', note: 'bulk sign-ups from a script' });
  assert.equal(add.status, 201, add.text);
  assert.equal(add.data.block.cidr, '198.51.100.0/24');
  const link = await newLink();
  const page = await door.browser().get(pathOf(link), from('198.51.100.77'));
  assert.equal(page.status, 403);
  assert.match(page.text, /This machine takes no new accounts from here/);
  assert.doesNotMatch(page.text, /bulk|198\.51/, 'nothing of the block');
  const r = await trySignUp('gu', link, '198.51.100.77');
  assert.equal(r.options.status, 403);
  assert.deepEqual(Object.keys(r.options.data).sort(), ['error', 'refused']);
  // A session and signing in still work from there.
  const { b, r: signedIn } = await signIn('al', '198.51.100.1');
  assert.equal(signedIn.status, 200, signedIn.text);
  assert.equal((await b.get('/api/whatever', from('198.51.100.1'))).status, 200);
  // Another address signs up with the same link.
  assert.equal((await trySignUp('gu', link, '192.0.2.10')).done.status, 201);
  const entry = (await audit('blocked'))[0];
  assert.equal(entry.detail, '198.51.100.77 · no sign-up');
  assert.match((await audit('block-added'))[0].detail, /^198\.51\.100\.0\/24 · no sign-up · until removed · bulk sign-ups from a script$/);
  await removeAll();
});

test('an access block refuses a session, signing in, a sign-up and a call, and lets the admin through', async () => {
  const add = await addBlock({ cidr: '2001:db8:dead::/48', level: 'access' });
  assert.equal(add.status, 201, add.text);
  const bad = '2001:db8:dead:1::5';
  const { b } = await signIn('al', '2001:db8:beef::1');
  const api = await b.get('/api/whatever', from(bad));
  assert.equal(api.status, 403);
  assert.deepEqual(api.data, { error: "You can't reach this machine from here.", refused: true });
  const page = await b.get('/', from(bad));
  assert.equal(page.status, 403);
  assert.match(page.text, /You can(&#39;|')t reach this machine from here/);
  // Signing in: a right passkey makes no session.
  const tried = await signIn('al', bad);
  assert.equal(tried.r.status, 403, tried.r.text);
  assert.equal(tried.r.headers['set-cookie'], undefined);
  assert.equal((await door.browser().get(pathOf(await newLink()), from(bad))).status, 403);
  assert.equal((await door.request('POST', '/call/al/bot/job', { body: {}, headers: from(bad) })).status, 403);
  // Elsewhere the same session works.
  assert.equal((await b.get('/api/whatever', from('2001:db8:beef::1'))).status, 200);
  // The admin's session, and the admin signing in, get through.
  assert.equal((await browsers.ann.get('/admin/blocks', from(bad))).status, 200);
  const admin = await signIn('ann', bad);
  assert.equal(admin.r.status, 200, admin.r.text);
  assert.deepEqual((await audit('blocked')).slice(0, 1).map((e) => e.detail), [`${bad} · no access`]);
  await removeAll();
  assert.equal((await b.get('/api/whatever', from(bad))).status, 200, 'removed, it stops nothing');
});

test('a block with an end ends by itself', async () => {
  const past = await addBlock({ cidr: '192.0.2.0/24', level: 'access', until: new Date(Date.now() - 1000).toISOString() });
  assert.equal(past.status, 400);
  const add = await addBlock({ cidr: '192.0.2.0/24', level: 'access', until: Date.now() + 1500 });
  assert.equal(add.status, 201, add.text);
  assert.ok(add.data.block.until);
  const { b } = await signIn('al', '203.0.113.1');
  assert.equal((await b.get('/api/whatever', from('192.0.2.9'))).status, 403);
  await new Promise((r) => setTimeout(r, 1600));
  assert.equal((await b.get('/api/whatever', from('192.0.2.9'))).status, 200);
  assert.deepEqual((await browsers.ann.get('/admin/blocks')).data.blocks, []);
});

test("the admin is never shut out by an access block of their own address: warned, and nothing is kept", async () => {
  // The admin's own address is the one this test reaches the front door from.
  const own = (await browsers.ann.get('/admin/blocks')).data.address;
  assert.equal(own, '127.0.0.1');
  for (const cidr of ['127.0.0.1', '127.0.0.0/8', '0.0.0.0/0']) {
    const r = await addBlock({ cidr, level: 'access' });
    assert.equal(r.status, 409, r.text);
    assert.match(r.data.error, /your own address, 127\.0\.0\.1/);
  }
  assert.deepEqual((await browsers.ann.get('/admin/blocks')).data.blocks, []);
  // A sign-up block of it shuts nobody out.
  assert.equal((await addBlock({ cidr: '127.0.0.0/8', level: 'sign-up' })).status, 201);
  assert.equal((await browsers.ann.get('/admin')).status, 200);
  await removeAll();
});

test('blocks are checked, listed and removed, each in the audit log', async () => {
  for (const body of [{}, { cidr: 'nope', level: 'access' }, { cidr: '192.0.2.0/24', level: 'all' }, { cidr: '192.0.2.0/24', level: 'access', until: 'soon' }, { cidr: '192.0.2.0/24', level: 'access', note: 7 }]) {
    assert.equal((await addBlock(body)).status, 400, JSON.stringify(body));
  }
  const add = await addBlock({ cidr: '192.0.2.0/25', level: 'sign-up', note: '  spam\n wave ' });
  const { block } = add.data;
  assert.equal(block.note, 'spam wave');
  assert.deepEqual(add.data.blocks.map((b) => b.id), [block.id]);
  const removed = await browsers.ann.post(`/admin/blocks/${block.id}/remove`, {});
  assert.equal(removed.status, 200, removed.text);
  assert.deepEqual(removed.data.blocks, []);
  assert.equal((await browsers.ann.post(`/admin/blocks/${block.id}/remove`, {})).status, 404);
  assert.equal((await audit('block-removed'))[0].detail, '192.0.2.0/25 · no sign-up · until removed · spam wave');
});

test("only the admin reaches the blocks, and a write needs the web page's header", async () => {
  const { b } = await signIn('al', '203.0.113.1');
  for (const r of [await b.get('/admin/blocks'), await b.post('/admin/blocks', { cidr: '192.0.2.1', level: 'access' }), await b.post('/admin/blocks/limit', { limit: 9 })]) assert.equal(r.status, 404, r.text);
  const bare = await browsers.ann.post('/admin/blocks', { cidr: '192.0.2.1', level: 'access' }, { 'X-Bot-Dot': '' });
  assert.equal(bare.status, 403);
  assert.deepEqual((await browsers.ann.get('/admin/blocks')).data.blocks, []);
  assert.ok(!stands.al.seen.some((s) => /blocks/.test(s.url)), 'nothing of it reaches a botdot server');
});

test('the admin page draws the limit and the blocks under Sign-ups', async () => {
  const page = await browsers.ann.get('/admin');
  assert.match(page.text, /<form id="capacity"[\s\S]*name="perDay"[\s\S]*<\/form>/);
  assert.match(page.text, /<section id="sign-up-links">[\s\S]*<div id="blocks"><h2>Blocked addresses<\/h2>[\s\S]*<form id="block-form"[\s\S]*name="cidr"[\s\S]*<\/section>/);
  const script = (await browsers.ann.get('/front-door/admin.js')).text;
  assert.match(script, /'GET', '\/admin\/blocks'/);
  assert.match(script, /'block-added': 'Address blocked'/);
});
