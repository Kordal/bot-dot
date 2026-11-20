// Feedback to the developers (#1566, ADR 259): with the machine's switch on, an owner's Send goes to the developers'
// Feedback relay instead of the admin page. Here a real front door runs against a stand-in relay on localhost that
// records what it receives, as the push relay's tests stand in for Apple's service.
const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const path = require('path');
const passkey = require('./fixtures/soft-passkey');
const { startFrontDoor, standIn } = require('./front-door-helpers');
const { waitFor } = require('./helpers');

const cleanups = [];
after(async () => { for (const fn of cleanups.reverse()) await fn(); });

// The stand-in relay: `got` is every request it saw, `down` makes it answer 503, `refuse` another status; a report sent
// twice under one id gets the same relay id (the relay treats the front door's id as idempotent).
async function relayStandIn() {
  const relay = { got: [], down: false, refuse: null, ids: new Map(), registered: 0 };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      let body = null;
      try { body = JSON.parse(text); } catch { /* none */ }
      relay.got.push({ method: req.method, url: req.url, auth: req.headers.authorization || null, body, text });
      const reply = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
      if (relay.down) return reply(503, { error: 'down' });
      if (relay.refuse) return reply(relay.refuse, { error: 'no' });
      if (req.method === 'POST' && req.url === '/v1/register') return reply(201, { token: `tok-${++relay.registered}-${'a'.repeat(40)}` });
      const m = req.url.match(/^\/v1\/reports\/([0-9a-f]{32})$/);
      if (req.method === 'PUT' && m) {
        if (!relay.ids.has(m[1])) relay.ids.set(m[1], `r-${relay.ids.size + 1}`);
        return reply(200, { id: relay.ids.get(m[1]) });
      }
      return reply(404, { error: 'unknown' });
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  cleanups.push(() => new Promise((r) => server.close(r)));
  relay.url = `http://127.0.0.1:${server.address().port}`;
  relay.reports = () => relay.got.filter((r) => r.method === 'PUT');
  return relay;
}

const FAST = { FRONT_DOOR_FEEDBACK_EVERY_MS: '150', FRONT_DOOR_FEEDBACK_BACKOFF_MS: '150' };

// A front door with an admin, `ann`, and the relay's address; env adds to it.
async function machine({ env = {}, relay = null } = {}) {
  relay ||= await relayStandIn();
  const status = fs.mkdtempSync(path.join(require('os').tmpdir(), 'fd-status-'));
  fs.writeFileSync(path.join(status, 'version.json'), JSON.stringify({ version: 'abc1234' }));
  const door = await startFrontDoor({ env: { FRONT_DOOR_STATUS: status, FRONT_DOOR_FEEDBACK_RELAY: relay.url, ...FAST, ...env } });
  cleanups.push(async () => { await door.stop(); fs.rmSync(status, { recursive: true, force: true }); });
  return { door, relay, stands: {} };
}
async function signUp(door, name, link) {
  const b = door.browser();
  const key = passkey.create({ rpId: door.rpId, origin: door.origin });
  const options = await b.post(`${link.path}/options`, { name });
  assert.equal(options.status, 200, options.text);
  const done = await b.post(link.path, { name, credential: key.register(options.data.publicKey) });
  assert.equal(done.status, 201, done.text);
  return b;
}
// The admin ann, and owners made by her links, each with a stand-in botdot server whose bots are `bots`.
async function withAdmin(opts) {
  const m = await machine({ ...opts, env: { FRONT_DOOR_ADMIN: 'ann', ...opts?.env } });
  m.ann = await signUp(m.door, 'ann', m.door.firstLink);
  m.owner = async (name, bots = []) => {
    const link = (await m.ann.post('/admin/links', {})).data.url;
    m.stands[name] = await standIn(m.door, name, { answer: (req) => (req.url === '/api/bots' ? [200, bots.map((b) => ({ id: b.toLowerCase(), name: b }))] : null) });
    cleanups.push(() => m.stands[name].close());
    return signUp(m.door, name, { path: new URL(link).pathname });
  };
  return m;
}
const flip = (m, on) => m.ann.post('/admin/feedback-to-developers', { on });
const keptFile = (door) => JSON.parse(fs.readFileSync(path.join(door.data, 'front-door.json'), 'utf8')).feedback;
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(32, 1)]);

test('never asked: Feedback goes to the admin page, the session says so, and the relay hears nothing', async () => {
  const m = await withAdmin();
  const bea = await m.owner('bea');
  assert.deepEqual((await m.ann.get('/admin/feedback-to-developers')).data, { on: null, relay: m.relay.url, registered: false });
  const session = (await bea.get('/front-door/session')).data;
  assert.equal(session.feedback, true);
  assert.equal(session.feedbackTo, 'admin');
  assert.equal((await bea.post('/front-door/feedback', { kind: 'bug', text: 'Goes to ann' })).status, 201);
  assert.equal((await m.ann.get('/admin/feedback')).data.reports.length, 1);
  await new Promise((r) => setTimeout(r, 500));
  assert.deepEqual(m.relay.got, [], 'nothing was sent to the relay');
});

test('the admin turns it on: one registration, the token kept at mode 600, and the owner is told the developers read it', async () => {
  const m = await withAdmin();
  const bea = await m.owner('bea');
  const on = await flip(m, true);
  assert.equal(on.status, 200, on.text);
  assert.deepEqual(on.data, { on: true, relay: m.relay.url, registered: true });
  assert.equal(m.relay.registered, 1);
  const file = path.join(m.door.data, 'feedback-relay.json');
  assert.equal(fs.statSync(file).mode & 0o777, 0o600);
  assert.equal((await bea.get('/front-door/session')).data.feedbackTo, 'developers');
  // Off and on again takes no new registration: the token is reused.
  assert.equal((await flip(m, false)).data.on, false);
  assert.equal((await bea.get('/front-door/session')).data.feedbackTo, 'admin');
  assert.equal((await flip(m, true)).data.on, true);
  assert.equal(m.relay.registered, 1);
});

test('a report goes to the relay with only its kind, text, app, version and screenshots, the names replaced, and is not on the admin page', async () => {
  const m = await withAdmin();
  const earlier = await m.owner('cal', ['Mailer', 'Tax Helper']);
  assert.equal((await earlier.post('/front-door/feedback', { kind: 'bug', text: 'Before the switch' })).status, 201);
  await flip(m, true);
  const sent = await earlier.post('/front-door/feedback', {
    kind: 'bug',
    text: 'cal here: my bot Mailer and tax helper fail, and Mailerless stays. Email a@b.co',
    screenshots: [{ data: PNG.toString('base64') }],
  });
  assert.equal(sent.status, 201, sent.text);
  await waitFor(() => m.relay.reports().length === 1, { what: 'the report to reach the relay' });
  const [got] = m.relay.reports();
  assert.equal(got.url, `/v1/reports/${sent.data.id}`);
  assert.match(got.auth, /^Bearer tok-1-/);
  assert.deepEqual(Object.keys(got.body).sort(), ['app', 'kind', 'screenshots', 'text', 'version']);
  assert.equal(got.body.kind, 'bug');
  assert.equal(got.body.app, 'web');
  assert.equal(got.body.version, 'abc1234');
  assert.deepEqual(got.body.screenshots, [{ type: 'image/png', data: PNG.toString('base64') }]);
  assert.match(got.body.text, /^\[account\] here: my bot \[bot\] and \[bot\] fail, and Mailerless stays\./);
  // Kept on the machine with the relay's id beside it, and not listed for the admin; the earlier report stays.
  await waitFor(() => keptFile(m.door).find((f) => f.id === sent.data.id)?.relayId === 'r-1', { what: 'the relay id to be kept' });
  const listed = (await m.ann.get('/admin/feedback')).data.reports;
  assert.deepEqual(listed.map((f) => f.text), ['Before the switch']);
  assert.equal(m.relay.reports().length, 1);
});

test('a report the relay did not take waits on the machine and is sent again with backoff, never twice for the same id', async () => {
  const m = await withAdmin();
  const dee = await m.owner('dee');
  await flip(m, true);
  m.relay.down = true;
  const sent = await dee.post('/front-door/feedback', { kind: 'feature', text: 'Dark theme' });
  assert.equal(sent.status, 201, 'the owner is not made to wait on a relay that is down');
  await waitFor(() => m.relay.reports().length >= 2, { what: 'a second try' });
  const times = m.relay.reports().length;
  assert.ok(times < 20, 'backed off, not hammering');
  m.relay.down = false;
  await waitFor(() => keptFile(m.door).find((f) => f.id === sent.data.id)?.relayId === 'r-1', { what: 'the report to be taken' });
  const after = m.relay.reports().length;
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(m.relay.reports().length, after, 'once taken, it is never sent again');
  assert.equal([...new Set(m.relay.reports().map((r) => r.url))].length, 1, 'always under the same id');
});

test('a report waits when the account\'s bots\' names cannot be asked: nothing goes unscrubbed', async () => {
  const m = await withAdmin();
  const eve = await m.owner('eve', ['Zed']);
  await flip(m, true);
  m.stands.eve.close();
  const sent = await eve.post('/front-door/feedback', { kind: 'bug', text: 'Zed broke' });
  assert.equal(sent.status, 201, sent.text);
  await new Promise((r) => setTimeout(r, 600));
  assert.deepEqual(m.relay.reports(), []);
  m.stands.eve = await standIn(m.door, 'eve', { answer: () => [200, [{ id: 'zed', name: 'Zed' }]] });
  cleanups.push(() => m.stands.eve.close());
  await waitFor(() => m.relay.reports().length === 1, { what: 'the report once the names are known' });
  assert.equal(m.relay.reports()[0].body.text, '[bot] broke');
});

test('with the switch off nothing is sent to the relay and Feedback goes to the admin page as before', async () => {
  const m = await withAdmin();
  const fay = await m.owner('fay');
  await flip(m, true);
  await flip(m, false);
  const before = m.relay.got.length;
  assert.equal((await fay.post('/front-door/feedback', { kind: 'bug', text: 'Back to ann' })).status, 201);
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(m.relay.got.length, before);
  assert.deepEqual((await m.ann.get('/admin/feedback')).data.reports.map((f) => f.text), ['Back to ann']);
});

test('only the admin reads or sets the switch; a body that is no boolean is refused; a relay that cannot register leaves it off', async () => {
  const m = await withAdmin();
  const gus = await m.owner('gus');
  assert.equal((await gus.get('/admin/feedback-to-developers')).status, 404);
  assert.equal((await gus.post('/admin/feedback-to-developers', { on: true })).status, 404);
  assert.equal((await m.door.browser().get('/admin/feedback-to-developers')).status, 401);
  assert.equal((await m.ann.post('/admin/feedback-to-developers', { on: 'yes' })).status, 400);
  m.relay.down = true;
  const failed = await flip(m, true);
  assert.equal(failed.status, 502);
  assert.match(failed.data.error, /relay/);
  assert.equal((await m.ann.get('/admin/feedback-to-developers')).data.on, null);
  assert.equal((await gus.get('/front-door/session')).data.feedbackTo, 'admin');
});

test('a machine of one account shows Feedback once the install said yes, and none when it said no or was never asked', async () => {
  const SETUP_KEY = 'k'.repeat(43);
  for (const [answer, feedback, to] of [['1', true, 'developers'], ['0', false, null], [undefined, false, null]]) {
    const m = await machine({ env: { FRONT_DOOR_ONE_ACCOUNT: 'solo', FRONT_DOOR_SETUP_KEY: SETUP_KEY, ...(answer ? { FRONT_DOOR_FEEDBACK_TO_DEVELOPERS: answer } : {}) } });
    const stand = await standIn(m.door, 'solo', { answer: (req) => (req.url === '/api/bots' ? [200, [{ id: 'x', name: 'Scout' }]] : null) });
    cleanups.push(() => stand.close());
    const b = await signUp(m.door, 'solo', { path: `/sign-up/${SETUP_KEY}` });
    const session = (await b.get('/front-door/session')).data;
    assert.equal(session.feedback, feedback, `answer ${answer}`);
    assert.equal(session.feedbackTo ?? null, to);
    if (feedback) {
      const sent = await b.post('/front-door/feedback', { kind: 'bug', text: 'Scout is slow' });
      assert.equal(sent.status, 201, sent.text);
      await waitFor(() => m.relay.reports().length === 1, { what: 'the report to reach the relay' });
      assert.equal(m.relay.reports()[0].body.text, '[bot] is slow');
    } else {
      assert.equal((await b.post('/front-door/feedback', { kind: 'bug', text: 'x' })).status, 404);
      assert.deepEqual(m.relay.got, []);
    }
  }
});

test("the install's answer is taken only while the front door has none: after that the admin page decides", () => {
  const relayLib = require('../lib/front-door/feedback-relay');
  const dir = fs.mkdtempSync(path.join(require('os').tmpdir(), 'fd-relay-'));
  cleanups.push(() => fs.rmSync(dir, { recursive: true, force: true }));
  assert.equal(relayLib.open(dir, { initial: null }).on(), null, 'never asked');
  assert.equal(relayLib.open(dir, { initial: true }).on(), true, 'the install said yes');
  relayLib.open(dir, { initial: true }).set(false);
  assert.equal(relayLib.open(dir, { initial: true }).on(), false, 'the admin turned it off: the environment no longer says');
  assert.equal(fs.statSync(path.join(dir, 'feedback-relay.json')).mode & 0o777, 0o600);
});

test("the admin page has the switch, its line and the relay's address, and a change is in the audit log", async () => {
  const m = await withAdmin();
  const page = await m.ann.get('/admin');
  assert.match(page.text, /Reports from every account on this machine go to botdot's developers instead of here\./);
  assert.match(page.text, /id="feedback-developers-switch"/);
  assert.match(page.text, /id="feedback-developers-relay"/);
  assert.match(require('../lib/front-door/pages').ADMIN_SCRIPT, /call\('GET', '\/admin\/feedback-to-developers'\)/);
  await flip(m, true);
  const entry = (await m.ann.get('/admin/audit?action=feedback-developers')).data.entries[0];
  assert.equal(entry.detail, 'on');
});

test('the names are replaced whatever their case, also letters whose lowercase has another length, and not inside other words', () => {
  const { neutral } = require('../lib/front-door/feedback-relay');
  assert.equal(neutral('İpek and IPEK, ipekler; Ann\'s MAILER', { account: ['ann'], bots: ['İpek', 'Mailer', 'x'] }), '[bot] and IPEK, ipekler; [account]\'s [bot]');
  assert.equal(neutral('nothing here', { account: [], bots: [] }), 'nothing here');
});
