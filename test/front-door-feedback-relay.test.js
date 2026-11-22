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
  // statuses: what it says of each relay id (#1568); raw: an answer to /v1/statuses as it is, for a test of a wrong shape.
  const relay = { got: [], down: false, refuse: null, ids: new Map(), registered: 0, statuses: {}, raw: null, refuseReports: null, revoked: false, deleted: [] };
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', async () => {
      const text = Buffer.concat(chunks).toString('utf8');
      let body = null;
      try { body = JSON.parse(text); } catch { /* none */ }
      relay.got.push({ method: req.method, url: req.url, auth: req.headers.authorization || null, body, text });
      const reply = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
      if (relay.revoked && req.headers.authorization) return reply(403, { revoked: true });
      if (relay.down) return reply(503, { error: 'down' });
      if (relay.refuse) return reply(relay.refuse, { error: 'no' });
      if (req.method === 'POST' && req.url === '/v1/register') return reply(201, { token: `tok-${++relay.registered}-${'a'.repeat(40)}` });
      if (req.method === 'POST' && req.url === '/v1/delete') {
        const ids = Array.isArray(body?.ids) ? body.ids : [];
        relay.deleted.push(...ids);
        return reply(200, { deleted: ids.length });
      }
      if (req.method === 'POST' && req.url === '/v1/statuses') {
        const asked = Array.isArray(body?.ids) ? body.ids : [];
        return reply(200, { statuses: relay.raw ?? Object.fromEntries(asked.filter((id) => relay.statuses[id]).map((id) => [id, relay.statuses[id]])) });
      }
      const m = req.url.match(/^\/v1\/reports\/([0-9a-f]{32})$/);
      if (req.method === 'PUT' && m) {
        if (relay.gate) await relay.gate; // a test holds the answer to a report, to delete its account meanwhile
        if (relay.refuseReports) return reply(relay.refuseReports, { error: 'no' });
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
  relay.deletes = () => relay.got.filter((r) => r.url === '/v1/delete');
  relay.asked = () => relay.got.filter((r) => r.url === '/v1/statuses');
  return relay;
}

const FAST = { FRONT_DOOR_FEEDBACK_EVERY_MS: '150', FRONT_DOOR_FEEDBACK_BACKOFF_MS: '150', FRONT_DOOR_FEEDBACK_STATUS_EVERY_MS: '150' };

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
  // versions: the newest What's new note each account's stand-in server says it ships, in its /api/version (#1569).
  m.versions = {};
  m.owner = async (name, bots = []) => {
    const link = (await m.ann.post('/admin/links', {})).data.url;
    m.stands[name] = await standIn(m.door, name, {
      answer: (req) => (req.url === '/api/bots' ? [200, bots.map((b) => ({ id: b.toLowerCase(), name: b }))] : req.url === '/api/version' && name in m.versions ? [200, { whatsNew: m.versions[name] }] : null),
    });
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
  assert.deepEqual((await m.ann.get('/admin/feedback-to-developers')).data, { on: null, relay: m.relay.url, registered: false, revoked: false });
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
  assert.deepEqual(on.data, { on: true, relay: m.relay.url, registered: true, revoked: false });
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
  // The relay holds the picture now: the machine keeps none, and the admin's room for screenshots is the admin's.
  const shots = path.join(m.door.data, 'feedback-screenshots');
  assert.deepEqual(fs.existsSync(shots) ? fs.readdirSync(shots).filter((n) => n.startsWith(sent.data.id)) : [], []);
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

// ---------- My reports: the statuses from the relay (#1568) ----------

const mine = async (b) => (await b.get('/front-door/feedback')).data.reports;
const sendOne = async (owner, m, text, kind = 'bug') => {
  const sent = await owner.post('/front-door/feedback', { kind, text });
  assert.equal(sent.status, 201, sent.text);
  await waitFor(() => keptFile(m.door).find((f) => f.id === sent.data.id)?.relayId, { what: 'the relay id to be kept' });
  return { id: sent.data.id, relayId: keptFile(m.door).find((f) => f.id === sent.data.id).relayId };
};

test('the front door asks the relay for the statuses of the ids it holds with the token, and My reports shows them newest first, the account\'s own alone', async () => {
  const m = await withAdmin();
  const gil = await m.owner('gil');
  const hal = await m.owner('hal');
  await flip(m, true);
  const one = await sendOne(gil, m, 'First bug');
  const two = await sendOne(gil, m, 'Second wish', 'feature');
  const other = await sendOne(hal, m, "Hal's bug");
  // Sent until the relay says otherwise; nothing but the id and the kind and text is shown of a report.
  const before = await mine(gil);
  assert.deepEqual(before.map((r) => [r.text, r.kind, r.status]), [['Second wish', 'feature', 'sent'], ['First bug', 'bug', 'sent']]);
  assert.deepEqual(Object.keys(before[0]).sort(), ['created', 'id', 'kind', 'status', 'text']);
  assert.equal(before[0].id, two.id);
  assert.match(before[0].created, /^\d{4}-\d\d-\d\dT/);
  assert.equal((await gil.get('/front-door/session')).data.feedbackReports, true);
  m.relay.statuses[one.relayId] = { status: 'fixed', fixedIn: '2026-11-25-the-fix', issue: 'https://github.com/Kordal/bot-dot/issues/1600', note: 'Thanks, it was the Approve button.' };
  m.relay.statuses[two.relayId] = { status: 'seen' };
  m.relay.statuses[other.relayId] = { status: 'wontfix', note: 'Not for us' };
  await waitFor(async () => (await mine(gil)).some((r) => r.status === 'fixed'), { what: 'the statuses to be applied' });
  const after = await mine(gil);
  assert.deepEqual(after.find((r) => r.id === one.id), { id: one.id, created: before[1].created, kind: 'bug', text: 'First bug', status: 'fixed', fixedIn: '2026-11-25-the-fix', issue: 'https://github.com/Kordal/bot-dot/issues/1600', note: 'Thanks, it was the Approve button.' });
  assert.equal(after.find((r) => r.id === two.id).status, 'seen');
  assert.deepEqual((await mine(hal)).map((r) => [r.status, r.note]), [['wontfix', 'Not for us']], "another account's report is never listed");
  // The relay was asked with the token alone and the relay ids, and nothing else.
  const ask = m.relay.asked()[0];
  assert.match(ask.auth, /^Bearer tok-1-/);
  assert.deepEqual(Object.keys(ask.body), ['ids']);
  assert.ok(ask.body.ids.every((id) => /^r-\d+$/.test(id)));
  // A closed report (fixed, won't fix) is no longer asked about; a seen one still is.
  const last = m.relay.asked().length;
  await waitFor(() => m.relay.asked().length > last + 1, { what: 'another round' });
  const latest = m.relay.asked().at(-1).body.ids;
  assert.deepEqual(latest, [two.relayId]);
});

test('a status field of the wrong shape is dropped, and so is a whole status without one of the four words', async () => {
  const m = await withAdmin();
  const ivy = await m.owner('ivy');
  await flip(m, true);
  const a = await sendOne(ivy, m, 'A');
  const b = await sendOne(ivy, m, 'B');
  const c = await sendOne(ivy, m, 'C');
  const d = await sendOne(ivy, m, 'D');
  m.relay.raw = {
    [a.relayId]: { status: 'seen', fixedIn: 'not a note id', issue: 'https://evil.example/Kordal/bot-dot/issues/1', note: 'x'.repeat(201) },
    [b.relayId]: { status: 'fixed', fixedIn: '2026-11-25-ok', issue: 'https://github.com/Kordal/bot-dot/issues/12', note: 'x'.repeat(200) },
    [c.relayId]: { status: 'done', note: 'not one of the words' },
    [d.relayId]: { status: 'seen', fixedIn: 5, issue: 'https://github.com/Kordal/bot-dot/issues/12/../../../x', note: ['<b>'] },
    'r-999': { status: 'fixed' },
  };
  await waitFor(async () => (await mine(ivy)).find((r) => r.id === b.id).status === 'fixed', { what: 'the statuses to be applied' });
  const got = Object.fromEntries((await mine(ivy)).map((r) => [r.text, r]));
  assert.deepEqual([got.A.status, got.A.fixedIn, got.A.issue, got.A.note], ['seen', undefined, undefined, undefined]);
  assert.deepEqual([got.B.fixedIn, got.B.issue, got.B.note.length], ['2026-11-25-ok', 'https://github.com/Kordal/bot-dot/issues/12', 200]);
  assert.equal(got.C.status, 'sent', 'a status that is none of the four is not kept');
  assert.deepEqual([got.D.status, got.D.fixedIn, got.D.issue, got.D.note], ['seen', undefined, undefined, undefined]);
  // Only the four words and the three fields are ever kept in the front door's data.
  assert.deepEqual(Object.keys(keptFile(m.door).find((f) => f.id === a.id)).filter((k) => ['status', 'fixedIn', 'issue', 'note'].includes(k)), ['status']);
});

test('statuses are still asked with the switch off, as long as open reports remain, and My reports stays; a note is text, never markup', async () => {
  const m = await withAdmin();
  const jon = await m.owner('jon');
  await flip(m, true);
  const sent = await sendOne(jon, m, 'Still open');
  await flip(m, false);
  assert.equal((await jon.get('/front-door/session')).data.feedbackTo, 'admin');
  assert.equal((await jon.get('/front-door/session')).data.feedbackReports, true, 'reports sent keep their statuses');
  m.relay.statuses[sent.relayId] = { status: 'wontfix', note: '<img src=x onerror=alert(1)>' };
  await waitFor(async () => (await mine(jon))[0].status === 'wontfix', { what: 'a status with the switch off' });
  assert.equal((await mine(jon))[0].note, '<img src=x onerror=alert(1)>', 'kept as the text it is: the apps draw it as text');
  // Closed now: nothing is asked any more.
  await new Promise((r) => setTimeout(r, 400));
  const n = m.relay.asked().length;
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(m.relay.asked().length, n, 'no open report, no request');
});

test('My reports is 404 where there is none to list: no reports and the switch off, and a report sent to an admin page is not listed', async () => {
  const m = await withAdmin();
  const kay = await m.owner('kay');
  assert.equal((await kay.get('/front-door/feedback')).status, 404, 'never asked');
  assert.equal((await kay.get('/front-door/session')).data.feedbackReports, false);
  assert.equal((await kay.post('/front-door/feedback', { kind: 'bug', text: 'To the admin page' })).status, 201);
  assert.equal((await kay.get('/front-door/feedback')).status, 404, 'a report on an admin page has no status');
  assert.equal((await m.door.browser().get('/front-door/feedback')).status, 401);
  await flip(m, true);
  assert.deepEqual(await mine(kay), [], 'on, and none sent yet: an empty list, and the admin-page report is not in it');
  assert.equal((await kay.get('/front-door/session')).data.feedbackReports, true);
  await new Promise((r) => setTimeout(r, 400));
  assert.deepEqual(m.relay.asked(), [], 'no report held: the relay is not asked');
});

test('a relay that is down or answers nonsense changes nothing, and the statuses come on the next round', async () => {
  const m = await withAdmin();
  const lee = await m.owner('lee');
  await flip(m, true);
  const sent = await sendOne(lee, m, 'Waiting');
  m.relay.raw = 'not an object';
  await waitFor(() => m.relay.asked().length >= 2, { what: 'two rounds' });
  assert.equal((await mine(lee))[0].status, 'sent');
  m.relay.raw = null;
  m.relay.statuses[sent.relayId] = { status: 'seen' };
  await waitFor(async () => (await mine(lee))[0].status === 'seen', { what: 'the status after the relay recovered' });
});

test('a report the relay refused for good is not listed in My reports as Sent', async () => {
  const m = await withAdmin();
  const max = await m.owner('max');
  await flip(m, true);
  m.relay.refuseReports = 400;
  const sent = await max.post('/front-door/feedback', { kind: 'bug', text: 'Refused' });
  assert.equal(sent.status, 201, sent.text);
  await waitFor(() => keptFile(m.door).find((f) => f.id === sent.data.id)?.refused === true, { what: 'the report to be refused' });
  assert.deepEqual(await mine(max), []);
  await flip(m, false);
  assert.equal((await max.get('/front-door/session')).data.feedbackReports, false, 'nothing taken, nothing to hear of');
  assert.equal((await max.get('/front-door/feedback')).status, 404);
});

// ---------- the one-time Fixed notice (#1569) ----------

const fixedBy = async (m, owner, text, status) => {
  const sent = await sendOne(owner, m, text);
  m.relay.statuses[sent.relayId] = status;
  await waitFor(async () => (await mine(owner)).find((r) => r.id === sent.id)?.status === status.status, { what: 'the status to be applied' });
  return sent;
};
const FIX = { status: 'fixed', fixedIn: '2026-11-25-the-fix' };

test('a fixed report is fixed: true only once the account\'s server ships the note of the fix, or a later one', async () => {
  const m = await withAdmin();
  const ian = await m.owner('ian');
  await flip(m, true);
  m.versions.ian = '2026-11-20-before-the-fix';
  const one = await fixedBy(m, ian, 'The Approve button', FIX);
  // An account that postponed its update runs the old version: Fixed in My reports, and no notice yet.
  let r = (await mine(ian)).find((x) => x.id === one.id);
  assert.equal(r.status, 'fixed');
  assert.equal(r.fixed, undefined, 'the server still ships an older note');
  m.versions.ian = '2026-11-25-the-fix';
  assert.equal((await mine(ian)).find((x) => x.id === one.id).fixed, true, 'the note of the fix is the newest it ships');
  m.versions.ian = '2026-12-02-something-later';
  assert.equal((await mine(ian)).find((x) => x.id === one.id).fixed, true, 'a later note too');
  // A server that says nothing of its newest note (older, or not answering) is never told the fix is there.
  delete m.versions.ian;
  assert.equal((await mine(ian)).find((x) => x.id === one.id).fixed, undefined);
  m.versions.ian = null;
  assert.equal((await mine(ian)).find((x) => x.id === one.id).fixed, undefined);
});

test('a report marked fixed with no note of the fix, and a report that is not fixed, never get fixed: true', async () => {
  const m = await withAdmin();
  const jo = await m.owner('jo');
  await flip(m, true);
  m.versions.jo = '2030-01-01-far-ahead';
  const bare = await fixedBy(m, jo, 'No note named', { status: 'fixed' });
  const seen = await fixedBy(m, jo, 'Only seen', { status: 'seen', fixedIn: '2026-11-25-the-fix' });
  const list = await mine(jo);
  assert.equal(list.find((x) => x.id === bare.id).status, 'fixed');
  assert.equal(list.find((x) => x.id === bare.id).fixed, undefined);
  assert.equal(list.find((x) => x.id === seen.id).fixed, undefined);
});

test('closing the notice keeps it closed for the account, once per report, and only the account\'s own fixed report can be closed', async () => {
  const m = await withAdmin();
  const kit = await m.owner('kit');
  const lou = await m.owner('lou');
  await flip(m, true);
  m.versions.kit = m.versions.lou = '2026-11-25-the-fix';
  const one = await fixedBy(m, kit, 'Kit first', FIX);
  const two = await fixedBy(m, kit, 'Kit second', FIX);
  const open = await sendOne(kit, m, 'Not fixed yet');
  const loud = await fixedBy(m, lou, 'Lou one', FIX);
  const shown = async () => (await mine(kit)).filter((r) => r.fixed && !r.fixedSeen).map((r) => r.id).sort();
  assert.deepEqual(await shown(), [one.id, two.id].sort());
  const closed = await kit.post(`/front-door/feedback/${one.id}/fixed-seen`, {});
  assert.equal(closed.status, 200, closed.text);
  assert.deepEqual(closed.data, { ok: true });
  assert.deepEqual(await shown(), [two.id], 'the other report still has its notice');
  assert.equal((await mine(kit)).find((r) => r.id === one.id).fixed, true, 'it is still a fixed report, listed as Fixed');
  assert.equal((await kit.post(`/front-door/feedback/${one.id}/fixed-seen`, {})).status, 200, 'closing again changes nothing');
  assert.equal(keptFile(m.door).find((f) => f.id === one.id).fixedSeen, true);
  assert.equal((await kit.post(`/front-door/feedback/${open.id}/fixed-seen`, {})).status, 409, 'not fixed: there is no notice');
  assert.equal((await kit.post(`/front-door/feedback/${loud.id}/fixed-seen`, {})).status, 404, "another account's report");
  assert.equal((await lou.get('/front-door/feedback')).data.reports[0].fixedSeen, undefined, "another account's notice is not closed");
  assert.equal((await kit.post(`/front-door/feedback/${'0'.repeat(32)}/fixed-seen`, {})).status, 404);
  assert.equal((await m.door.browser().post(`/front-door/feedback/${one.id}/fixed-seen`, {})).status, 401);
});

test('a report sent to an admin page, or on an account with no My reports, can close no notice', async () => {
  const m = await withAdmin();
  const mia = await m.owner('mia');
  const nan = await m.owner('nan');
  await flip(m, true);
  m.versions.mia = '2026-12-31-newest';
  const one = await fixedBy(m, mia, 'Fixed once', FIX);
  await flip(m, false);
  const noone = await m.owner('ova');
  assert.equal((await noone.post(`/front-door/feedback/${one.id}/fixed-seen`, {})).status, 404, 'no My reports for this account');
  assert.equal((await nan.post(`/front-door/feedback/${one.id}/fixed-seen`, {})).status, 404, "not nan's report");
  // The owner of the report keeps hearing of it with the switch off.
  assert.equal((await mia.post(`/front-door/feedback/${one.id}/fixed-seen`, {})).status, 200);

// ---------- account deletion and a revoked token (#1570) ----------

test("an owner deleting their account has the relay asked to delete that account's reports, and no other account's", async () => {
  const m = await withAdmin();
  const quin = await m.owner('quin');
  const rae = await m.owner('rae');
  await flip(m, true);
  const mineOne = await sendOne(quin, m, 'Quin one');
  const mineTwo = await sendOne(quin, m, 'Quin two');
  const hers = await sendOne(rae, m, 'Rae one');
  const gone = await quin.post('/front-door/delete-account', { name: 'quin' });
  assert.equal(gone.status, 200, gone.text);
  await waitFor(() => m.relay.deleted.length === 2, { what: 'the relay to be asked to delete' });
  assert.deepEqual([...m.relay.deleted].sort(), [mineOne.relayId, mineTwo.relayId].sort());
  const ask = m.relay.deletes()[0];
  assert.match(ask.auth, /^Bearer tok-1-/);
  assert.deepEqual(Object.keys(ask.body), ['ids']);
  assert.ok(!m.relay.deleted.includes(hers.relayId));
  assert.deepEqual((await mine(rae)).map((r) => r.text), ['Rae one']);
  // Taken: not asked again.
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(m.relay.deletes().length, 1);
});

test('the admin deleting an account asks the relay too, with the switch off, and a request that fails is kept and asked again until the relay takes it', async () => {
  const m = await withAdmin();
  const sol = await m.owner('sol');
  await flip(m, true);
  const sent = await sendOne(sol, m, 'Sol one');
  await flip(m, false);
  m.relay.down = true;
  const gone = await m.ann.post('/admin/accounts/sol/delete', { name: 'sol' });
  assert.equal(gone.status, 200, gone.text);
  await waitFor(() => m.relay.deletes().length >= 2, { what: 'a second try' });
  assert.deepEqual(m.relay.deleted, [], 'not taken while the relay is down');
  assert.ok(m.relay.deletes().length < 20, 'backed off, not hammering');
  m.relay.down = false;
  await waitFor(() => m.relay.deleted.length === 1, { what: 'the relay to take it' });
  assert.deepEqual(m.relay.deleted, [sent.relayId]);
  const taken = m.relay.deletes().length;
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(m.relay.deletes().length, taken, 'once taken, never asked again');
  assert.equal(JSON.parse(fs.readFileSync(path.join(m.door.data, 'feedback-relay.json'), 'utf8')).deleting, undefined);
});

test('a report nobody took is never asked to be deleted, and one the relay takes just after its account was deleted is deleted there too', async () => {
  const m = await withAdmin();
  const tia = await m.owner('tia');
  const ula = await m.owner('ula');
  await flip(m, true);
  // Never taken: nothing at the relay to delete.
  m.relay.down = true;
  assert.equal((await tia.post('/front-door/feedback', { kind: 'bug', text: 'Never taken' })).status, 201);
  await waitFor(() => m.relay.reports().length >= 1, { what: 'a try' });
  assert.equal((await tia.post('/front-door/delete-account', { name: 'tia' })).status, 200);
  m.relay.down = false;
  await new Promise((r) => setTimeout(r, 600));
  assert.deepEqual(m.relay.deleted, []);
  assert.deepEqual(m.relay.deletes(), [], 'the relay is not asked');
  // In flight: the relay is holding its answer when the account is deleted, then takes the report.
  let release;
  m.relay.gate = new Promise((r) => { release = r; });
  assert.equal((await ula.post('/front-door/feedback', { kind: 'bug', text: 'In flight' })).status, 201);
  await waitFor(() => m.relay.reports().length >= 2, { what: 'the report to reach the relay' });
  assert.equal((await ula.post('/front-door/delete-account', { name: 'ula' })).status, 200);
  release();
  await waitFor(() => m.relay.deleted.length === 1, { what: 'the report to be deleted at the relay' });
  assert.equal(m.relay.deleted[0], [...m.relay.ids.values()].at(-1));
});

test('a revoked token stops the front door: nothing more is sent, Feedback is hidden, the statuses it has stay and the admin page says so', async () => {
  const m = await withAdmin();
  const una = await m.owner('una');
  await flip(m, true);
  const taken = await sendOne(una, m, 'Taken before');
  m.relay.statuses[taken.relayId] = { status: 'seen' };
  await waitFor(async () => (await mine(una))[0].status === 'seen', { what: 'a status' });
  // Two reports wait while the relay is down; then it revokes the token.
  m.relay.down = true;
  assert.equal((await una.post('/front-door/feedback', { kind: 'bug', text: 'Waits one' })).status, 201);
  assert.equal((await una.post('/front-door/feedback', { kind: 'bug', text: 'Waits two' })).status, 201);
  m.relay.down = false;
  m.relay.revoked = true;
  await waitFor(async () => (await m.ann.get('/admin/feedback-to-developers')).data.revoked === true, { what: 'the revoked token to be noticed' });
  const puts = m.relay.reports().length;
  await new Promise((r) => setTimeout(r, 700));
  assert.equal(m.relay.reports().length, puts, 'no report is sent while the token is revoked');
  const session = (await una.get('/front-door/session')).data;
  assert.equal(session.feedback, false, 'Feedback is hidden where it would go to the developers');
  assert.equal(session.feedbackTo, null, 'and not sent to an admin page instead');
  assert.equal((await una.post('/front-door/feedback', { kind: 'bug', text: 'Not now' })).status, 404);
  assert.deepEqual((await mine(una)).map((r) => [r.text, r.status]).filter(([t]) => t === 'Taken before'), [['Taken before', 'seen']], 'the statuses it has stay in My reports');
  const sw = (await m.ann.get('/admin/feedback-to-developers')).data;
  assert.deepEqual([sw.on, sw.revoked], [true, true]);
  assert.match((await m.ann.get('/admin')).text, /id="feedback-developers-revoked"[^>]*hidden>The relay no longer takes this machine's reports\./);
  assert.match(require('../lib/front-door/pages').ADMIN_SCRIPT, /getElementById\('feedback-developers-revoked'\)\.hidden = r\.revoked !== true/);
});

test('a relay that takes the token again lifts it: the next statuses round says so and Feedback comes back', async () => {
  const m = await withAdmin();
  const val = await m.owner('val');
  await flip(m, true);
  const one = await sendOne(val, m, 'Open');
  m.relay.revoked = true;
  await waitFor(async () => (await m.ann.get('/admin/feedback-to-developers')).data.revoked === true, { what: 'the revoked token' });
  assert.equal((await val.get('/front-door/session')).data.feedbackTo, null);
  m.relay.revoked = false;
  await waitFor(async () => (await val.get('/front-door/session')).data.feedbackTo === 'developers', { what: 'the relay to take the token again' });
  assert.equal((await m.ann.get('/admin/feedback-to-developers')).data.revoked, false);
  assert.ok(one);
});
