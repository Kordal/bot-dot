// Feedback to the developers (ADR 259, #1566): the admin's switch, and from then on an owner's Send takes the report to
// botdot's developers through the Feedback relay and not to the admin page. A real front door, pointed at a stand-in
// relay on localhost that records what it receives.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const passkey = require('./fixtures/soft-passkey');
const { waitFor } = require('./helpers');
const { startFrontDoor, standIn } = require('./front-door-helpers');
const store = require('../lib/front-door/store');
const relayLib = require('../lib/front-door/feedback-relay');
const pages = require('../lib/front-door/pages');

// The stand-in Feedback relay: registers an install, takes a report once per id, and says what it got. `down` answers 503.
async function standInRelay() {
  const got = [];
  const reports = new Map(); // the front door's id → { relayId, body }
  const me = { got, reports, down: false, installs: 0, server: null, address: '' };
  me.server = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const text = Buffer.concat(chunks).toString('utf8');
      let body = null;
      try { body = JSON.parse(text); } catch { /* not JSON */ }
      got.push({ method: req.method, url: req.url, headers: req.headers, body });
      const answer = (status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
      if (me.down) return answer(503, { error: 'down' });
      if (req.method === 'POST' && req.url === '/v1/install') { me.installs++; return answer(201, { token: `install-token-${me.installs}-${'x'.repeat(24)}` }); }
      const put = req.url.match(/^\/v1\/reports\/([0-9a-f]{32})$/);
      if (req.method === 'PUT' && put && /^Bearer install-token-/.test(req.headers.authorization || '')) {
        if (!reports.has(put[1])) reports.set(put[1], { relayId: `rep-${reports.size + 1}`, body });
        return answer(201, { id: reports.get(put[1]).relayId });
      }
      return answer(404, { error: 'no' });
    });
  });
  await new Promise((r) => me.server.listen(0, '127.0.0.1', r));
  me.address = `http://127.0.0.1:${me.server.address().port}`;
  me.puts = () => got.filter((r) => r.method === 'PUT');
  me.close = () => me.server.close();
  return me;
}

let door, relay, status;
const stands = {};
const ENV = { FRONT_DOOR_FEEDBACK_EVERY_MS: '100', FRONT_DOOR_FEEDBACK_RETRY_MS: '150' };
const botsOf = (names) => (req) => (req.url === '/api/bots' ? [200, names.map((name) => ({ name }))] : null);
const state = { bots: ['Weather', 'Inbox helper'] };
// A stand-in botdot server for a one-account door's account, with no bots.
const standInRelayless = (d) => standIn(d, 'owner', { answer: (req) => (req.url === '/api/bots' ? [200, []] : null) });

before(async () => {
  relay = await standInRelay();
  status = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-status-'));
  fs.writeFileSync(path.join(status, 'version.json'), JSON.stringify({ version: 'abc1234' }));
  door = await startFrontDoor({ env: { ...ENV, FRONT_DOOR_ADMIN: 'ann', FRONT_DOOR_STATUS: status, FRONT_DOOR_FEEDBACK_RELAY: relay.address } });
  stands.ann = await standIn(door, 'ann', { answer: (req) => botsOf(state.bots)(req) });
});
after(async () => {
  await door?.stop();
  for (const s of Object.values(stands)) s.close();
  relay?.close();
  fs.rmSync(status, { recursive: true, force: true });
});

async function signUp(name, link) {
  const b = door.browser();
  const key = passkey.create({ rpId: door.rpId, origin: door.origin });
  const options = await b.post(`${link.path}/options`, { name });
  assert.equal(options.status, 200, options.text);
  const done = await b.post(link.path, { name, credential: key.register(options.data.publicKey) });
  assert.equal(done.status, 201, done.text);
  return b;
}
let annB = null;
const admin = async () => (annB ||= await signUp('ann', door.firstLink));
async function owner(name) {
  const link = (await (await admin()).post('/admin/links', {})).data.url;
  stands[name] = await standIn(door, name, { answer: (req) => botsOf(state.bots)(req) });
  return signUp(name, { path: new URL(link).pathname });
}
const keptReports = () => JSON.parse(fs.readFileSync(path.join(door.data, 'front-door.json'), 'utf8')).feedback;
const tokenFile = () => path.join(door.data, 'feedback-relay.json');
const sessionOf = async (b) => (await b.get('/front-door/session')).data;

test('never asked: Feedback goes to the admin page as before, and the relay hears nothing', async () => {
  const bea = await owner('bea');
  const s = await sessionOf(bea);
  assert.equal(s.feedback, true);
  assert.equal(s.feedbackTo, 'admin');
  const b = await admin();
  assert.deepEqual((await b.get('/admin/feedback-to-developers')).data, { on: null, relay: relay.address });
  const sent = await bea.post('/front-door/feedback', { kind: 'bug', text: 'Before the switch' });
  assert.equal(sent.status, 201, sent.text);
  assert.equal((await b.get('/admin/feedback')).data.reports.some((f) => f.id === sent.data.id), true);
  assert.equal(relay.got.length, 0, 'nothing reached the relay');
  assert.equal(fs.existsSync(tokenFile()), false);
});

test('only the admin reads and sets the switch, and it takes on or off', async () => {
  const cat = await owner('cat');
  assert.equal((await cat.get('/admin/feedback-to-developers')).status, 404);
  assert.equal((await cat.post('/admin/feedback-to-developers', { on: true })).status, 404);
  assert.equal((await door.browser().get('/admin/feedback-to-developers')).status, 401);
  const b = await admin();
  assert.equal((await b.post('/admin/feedback-to-developers', { on: 'yes' })).status, 400);
  assert.equal((await b.post('/admin/feedback-to-developers', {})).status, 400);
  assert.equal((await b.get('/admin/feedback-to-developers')).data.on, null, 'still never asked');
  assert.equal(relay.got.length, 0);
});

test('the admin turns it on: one registration, the token kept at mode 600, every account is told the developers read it', async () => {
  const b = await admin();
  const on = await b.post('/admin/feedback-to-developers', { on: true });
  assert.equal(on.status, 200, on.text);
  assert.deepEqual(on.data, { on: true, relay: relay.address });
  assert.equal(relay.installs, 1);
  const registered = relay.got.find((r) => r.url === '/v1/install');
  assert.equal(registered.headers.authorization, undefined, 'asked with no token');
  assert.deepEqual(registered.body, {}, 'and with nothing of the machine');
  assert.match(JSON.parse(fs.readFileSync(tokenFile(), 'utf8')).token, /^install-token-1-/);
  assert.equal(fs.statSync(tokenFile()).mode & 0o777, 0o600);
  assert.equal((await b.get('/admin/feedback-to-developers')).data.on, true);
  for (const who of [await owner('dan'), b]) {
    const s = await sessionOf(who);
    assert.equal(s.feedback, true);
    assert.equal(s.feedbackTo, 'developers');
    assert.equal(s.feedbackScreenshots, true);
  }
});

test("with it on, a report goes to the relay with only its kind, text, app, version and screenshots, the account's and bots' names replaced; the machine keeps it with the relay's id and the admin page does not list it", async () => {
  const eve = await owner('eve');
  const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
  const text = 'Weather stops when eve asks the inbox helper to run; WEATHER again, Weathering is fine';
  const sent = await eve.post('/front-door/feedback', { kind: 'bug', text, screenshots: [{ data: PNG.toString('base64') }] });
  assert.equal(sent.status, 201, sent.text);
  assert.match(sent.data.id, /^[0-9a-f]{32}$/);
  await waitFor(() => relay.reports.has(sent.data.id), { what: 'the report to reach the relay' });
  const put = relay.puts().find((r) => r.url === `/v1/reports/${sent.data.id}`);
  assert.match(put.headers.authorization, /^Bearer install-token-1-/);
  assert.deepEqual(Object.keys(put.body).sort(), ['app', 'kind', 'screenshots', 'text', 'version']);
  assert.equal(put.body.kind, 'bug');
  assert.equal(put.body.app, 'web');
  assert.equal(put.body.version, 'abc1234');
  assert.equal(put.body.text, '[bot] stops when [account] asks the [bot] to run; [bot] again, Weathering is fine');
  assert.deepEqual(put.body.screenshots, [{ type: 'image/png', data: PNG.toString('base64') }]);
  assert.doesNotMatch(JSON.stringify(put), /\beve\b/i);
  // Kept on the machine with the relay's id beside it, and not on the admin page.
  await waitFor(() => keptReports().find((f) => f.id === sent.data.id)?.relayId, { what: 'the relay id to be kept' });
  const mine = keptReports().find((f) => f.id === sent.data.id);
  assert.equal(mine.relayId, relay.reports.get(sent.data.id).relayId);
  assert.equal(mine.account, 'eve');
  assert.equal(mine.text, text, 'the machine keeps what the owner wrote');
  assert.equal((await (await admin()).get('/admin/feedback')).data.reports.some((f) => f.id === sent.data.id), false);
  assert.equal((await (await admin()).get(`/admin/feedback/${sent.data.id}/screenshot/0`)).status, 404, 'no admin opens its screenshot');
  assert.equal((await (await admin()).post(`/admin/feedback/${sent.data.id}/delete`, {})).status, 404);
  // Asked of the account's botdot server, over its socket, for the bots' names.
  assert.ok(stands.eve.seen.some((r) => r.url === '/api/bots' && r.headers['x-botdot-account'] === 'eve'));
});

test("the admin page has the switch, its line and the relay's address, drawn as text", async () => {
  const page = await (await admin()).get('/admin');
  assert.equal(page.status, 200);
  assert.match(page.text, /<button id="feedback-dev-switch" type="button" disabled>Turn on<\/button>/);
  assert.match(page.text, /<p>Reports from every account on this machine go to botdot's developers instead of here\.<\/p>/);
  assert.match(page.text, /<p id="feedback-dev-relay"><\/p>/);
  assert.match(pages.ADMIN_SCRIPT, /call\('GET', '\/admin\/feedback-to-developers'\)/);
  assert.match(pages.ADMIN_SCRIPT, /call\('POST', '\/admin\/feedback-to-developers', \{ on \}\)/);
  assert.match(pages.ADMIN_SCRIPT, /'feedback-dev-relay'\)\.textContent = 'Relay: ' \+ r\.relay/);
});

test('reports that were on the admin page stay there when the switch is on', async () => {
  const listed = (await (await admin()).get('/admin/feedback')).data.reports;
  assert.ok(listed.some((f) => f.text === 'Before the switch'));
});

test('a report the relay did not take waits on the machine and is sent again, once, when the relay is back', async () => {
  const fay = await owner('fay');
  relay.down = true;
  const sent = await fay.post('/front-door/feedback', { kind: 'feature', text: 'Please add a dark theme' });
  assert.equal(sent.status, 201, 'Send is not held by the relay');
  await waitFor(() => relay.puts().filter((r) => r.url.endsWith(sent.data.id)).length >= 2, { what: 'the front door to try again' });
  const waiting = keptReports().find((f) => f.id === sent.data.id);
  assert.equal(waiting.relayId, undefined);
  assert.ok(waiting.tries >= 1);
  assert.equal(relay.reports.has(sent.data.id), false);
  relay.down = false;
  await waitFor(() => keptReports().find((f) => f.id === sent.data.id)?.relayId, { what: 'the report to be taken' });
  const before = relay.puts().filter((r) => r.url.endsWith(sent.data.id)).length;
  await new Promise((r) => setTimeout(r, 600));
  assert.equal(relay.puts().filter((r) => r.url.endsWith(sent.data.id)).length, before, 'never sent again once taken');
});

test("a report waits while the account's botdot server does not say its bots' names, so no name leaves the machine", async () => {
  const gus = await owner('gus');
  stands.gus.close(); // its botdot server is not running
  const sent = await gus.post('/front-door/feedback', { kind: 'bug', text: 'Gus is the name of my bot' });
  assert.equal(sent.status, 201, sent.text);
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(relay.reports.has(sent.data.id), false, 'not sent unclean');
  assert.ok(keptReports().find((f) => f.id === sent.data.id).tries >= 1);
  stands.gus = await standIn(door, 'gus', { answer: (req) => botsOf(state.bots)(req) });
  await waitFor(() => relay.reports.has(sent.data.id), { what: 'the report to go once the names are known' });
  assert.equal(relay.reports.get(sent.data.id).body.text, '[account] is the name of my bot');
});

test('off and on again reuses the install token; off, nothing is sent and Feedback goes to the admin page as today', async () => {
  const b = await admin();
  const hal = await owner('hal');
  assert.equal((await b.post('/admin/feedback-to-developers', { on: false })).data.on, false);
  const s = await sessionOf(hal);
  assert.equal(s.feedbackTo, 'admin');
  const puts = relay.puts().length;
  const sent = await hal.post('/front-door/feedback', { kind: 'bug', text: 'While it is off' });
  assert.equal(sent.status, 201);
  assert.equal((await b.get('/admin/feedback')).data.reports.some((f) => f.id === sent.data.id), true);
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(relay.puts().length, puts, 'nothing sent');
  assert.equal((await b.post('/admin/feedback-to-developers', { on: true })).data.on, true);
  assert.equal(relay.installs, 1, 'no new sign-up at the relay');
  const again = await hal.post('/front-door/feedback', { kind: 'bug', text: 'On again' });
  await waitFor(() => relay.reports.has(again.data.id), { what: 'the report to reach the relay' });
  assert.match(relay.puts().find((r) => r.url.endsWith(again.data.id)).headers.authorization, /^Bearer install-token-1-/);
});

test("when the relay doesn't take the machine, the switch stays as it was and the admin is told", async () => {
  const dead = await standInRelay();
  dead.down = true;
  const other = await startFrontDoor({ env: { ...ENV, FRONT_DOOR_ADMIN: 'amy', FRONT_DOOR_FEEDBACK_RELAY: dead.address } });
  try {
    const b = other.browser();
    const key = passkey.create({ rpId: other.rpId, origin: other.origin });
    const options = await b.post(`${other.firstLink.path}/options`, { name: 'amy' });
    assert.equal((await b.post(other.firstLink.path, { name: 'amy', credential: key.register(options.data.publicKey) })).status, 201);
    const r = await b.post('/admin/feedback-to-developers', { on: true });
    assert.equal(r.status, 502);
    assert.match(r.data.error, /relay/);
    assert.equal((await b.get('/admin/feedback-to-developers')).data.on, null);
    assert.equal(fs.existsSync(path.join(other.data, 'feedback-relay.json')), false);
  } finally { await other.stop(); dead.close(); }
});

test("a machine of one account shows no Feedback until the switch is on; the install's answer is taken only while the machine has none", async () => {
  const SETUP_KEY = 'k'.repeat(40);
  const one = await startFrontDoor({ env: { ...ENV, FRONT_DOOR_ONE_ACCOUNT: 'owner', FRONT_DOOR_SETUP_KEY: SETUP_KEY, FRONT_DOOR_FEEDBACK_TO_DEVELOPERS: '1', FRONT_DOOR_FEEDBACK_RELAY: relay.address } });
  const own = await standInRelayless(one);
  try {
    const b = one.browser();
    const key = passkey.create({ rpId: one.rpId, origin: one.origin });
    const options = await b.post(`/sign-up/${SETUP_KEY}/options`, { name: 'owner' });
    const made = await b.post(`/sign-up/${SETUP_KEY}`, { name: 'owner', credential: key.register(options.data.publicKey) });
    assert.equal(made.status, 201, made.text);
    const s = (await b.get('/front-door/session')).data;
    assert.equal(s.feedback, true, 'the icon shows once the switch is on');
    assert.equal(s.feedbackTo, 'developers');
    assert.equal(s.admin, false);
    const before = relay.puts().length;
    const sent = await b.post('/front-door/feedback', { kind: 'bug', text: 'owner here: Weather broke' });
    assert.equal(sent.status, 201, sent.text);
    await waitFor(() => relay.puts().length > before, { what: 'the report to reach the relay' });
    assert.equal(relay.puts().at(-1).body.text, '[account] here: Weather broke', 'the account is named, no bots');
  } finally { await one.stop(); own.close(); }
  // Off at the install and the machine has an answer already: the environment is not asked again.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-adopt-'));
  try {
    const d = store.open(dir);
    assert.equal(d.feedbackDevelopers(), null);
    assert.equal(d.adoptFeedbackDevelopers(true), true);
    assert.equal(d.adoptFeedbackDevelopers(false), false, 'the machine has an answer now');
    assert.equal(d.feedbackDevelopers(), true);
    d.setFeedbackDevelopers(false);
    assert.equal(d.adoptFeedbackDevelopers(true), false);
    assert.equal(d.feedbackDevelopers(), false);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('a machine of one account without the switch shows no Feedback', async () => {
  const SETUP_KEY = 'q'.repeat(40);
  const one = await startFrontDoor({ env: { ...ENV, FRONT_DOOR_ONE_ACCOUNT: 'owner', FRONT_DOOR_SETUP_KEY: SETUP_KEY, FRONT_DOOR_FEEDBACK_TO_DEVELOPERS: '0', FRONT_DOOR_FEEDBACK_RELAY: relay.address } });
  try {
    const b = one.browser();
    const key = passkey.create({ rpId: one.rpId, origin: one.origin });
    const options = await b.post(`/sign-up/${SETUP_KEY}/options`, { name: 'owner' });
    assert.equal((await b.post(`/sign-up/${SETUP_KEY}`, { name: 'owner', credential: key.register(options.data.publicKey) })).status, 201);
    const s = (await b.get('/front-door/session')).data;
    assert.equal(s.feedback, false);
    assert.equal(s.feedbackTo, null);
    assert.equal((await b.post('/front-door/feedback', { kind: 'bug', text: 'Nowhere to go' })).status, 404);
  } finally { await one.stop(); }
});

test('the relay address needs https, or a loopback address; a report is cleaned of names whole and longest first', () => {
  assert.equal(relayLib.addressOf('https://relay.example.com/'), 'https://relay.example.com');
  assert.equal(relayLib.addressOf('http://127.0.0.1:9000'), 'http://127.0.0.1:9000');
  assert.equal(relayLib.addressOf('http://relay.example.com'), null);
  assert.equal(relayLib.addressOf('https://user:pw@relay.example.com'), null);
  assert.equal(relayLib.addressOf('nonsense'), null);
  assert.equal(relayLib.neutral('Ann (ann) and Ann Lee', { account: 'ann', bots: ['Ann Lee', 'A', 'Bo.b'] }), '[account] ([account]) and [bot]');
  assert.equal(relayLib.neutral('A Bo.b bob', { account: 'ann', bots: ['A', 'Bo.b'] }), 'A [bot] bob', 'a name of one letter is left, a dot is no wildcard');
  assert.equal(relayLib.backoff(1, 1000), 1000);
  assert.equal(relayLib.backoff(3, 1000), 4000);
  assert.equal(relayLib.backoff(40, 1000), relayLib.RETRY_MAX_MS);
});
