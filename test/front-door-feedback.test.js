// Feedback (#216, ADR 048): beside Settings, an owner reports a bug or asks for a feature. The report goes to the front
// door, which keeps what they typed with the account, the time, the kind, the app and the version, and the admin reads
// the list on the admin page. It never reaches a botdot server, and no other session reads it.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const passkey = require('./fixtures/soft-passkey');
const { startFrontDoor, standIn } = require('./front-door-helpers');
const store = require('../lib/front-door/store');
const pages = require('../lib/front-door/pages');

let door, status;
const stands = {};
before(async () => {
  status = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-status-'));
  fs.writeFileSync(path.join(status, 'version.json'), JSON.stringify({ version: 'abc1234' }));
  door = await startFrontDoor({ env: { FRONT_DOOR_ADMIN: 'ann', FRONT_DOOR_STATUS: status } });
  stands.ann = await standIn(door, 'ann');
});
after(async () => {
  await door?.stop();
  for (const s of Object.values(stands)) s.close();
  fs.rmSync(status, { recursive: true, force: true });
});

// A new account's browser, signed in from `app` ('web' unless said).
async function signUp(name, link, app) {
  const b = door.browser();
  const key = passkey.create({ rpId: door.rpId, origin: door.origin });
  const options = await b.post(`${link.path}/options`, { name });
  assert.equal(options.status, 200, options.text);
  const done = await b.post(link.path, { name, credential: key.register(options.data.publicKey), ...(app ? { app } : {}) });
  assert.equal(done.status, 201, done.text);
  return b;
}
let annB = null;
const admin = async () => (annB ||= await signUp('ann', door.firstLink));
async function owner(name, app) {
  const link = (await (await admin()).post('/admin/links', {})).data.url;
  stands[name] = await standIn(door, name);
  return signUp(name, { path: new URL(link).pathname }, app);
}
const seen = () => Object.values(stands).map((s) => s.seen.length).join();
const kept = () => JSON.parse(fs.readFileSync(path.join(door.data, 'front-door.json'), 'utf8')).feedback;

test('a bug from the web page and a feature request from the Android app are listed on the admin page, newest first', async () => {
  const bea = await owner('bea');
  const cal = await owner('cal', 'android');
  const was = seen();
  const bug = await bea.post('/front-door/feedback', { kind: 'bug', text: 'Approve button does nothing on my phone' });
  assert.equal(bug.status, 201, bug.text);
  assert.match(bug.data.id, /^[0-9a-f]{32}$/);
  const wish = await cal.post('/front-door/feedback', { kind: 'feature', text: 'Add a dark theme' });
  assert.equal(wish.status, 201, wish.text);
  assert.equal(seen(), was, 'no botdot server saw either');

  const list = await (await admin()).get('/admin/feedback');
  assert.equal(list.status, 200, list.text);
  const [first, second] = list.data.reports;
  assert.deepEqual({ ...first, created: undefined }, { id: wish.data.id, account: 'cal', created: undefined, kind: 'feature', text: 'Add a dark theme', app: 'android', version: 'abc1234' });
  assert.deepEqual({ ...second, created: undefined }, { id: bug.data.id, account: 'bea', created: undefined, kind: 'bug', text: 'Approve button does nothing on my phone', app: 'web', version: 'abc1234' });
  assert.ok(Date.now() - Date.parse(first.created) < 60_000);
  // Kept with only these fields: nothing of the account goes with a report.
  for (const f of kept()) assert.deepEqual(Object.keys(f).sort(), ['account', 'app', 'created', 'id', 'kind', 'text', 'version']);
});

test('a report that is too long, empty or of no kind is refused in plain words', async () => {
  const dee = await owner('dee');
  const long = await dee.post('/front-door/feedback', { kind: 'bug', text: 'x'.repeat(store.FEEDBACK_MAX + 1) });
  assert.equal(long.status, 400);
  assert.match(long.data.error, /at most 2000/);
  assert.equal((await dee.post('/front-door/feedback', { kind: 'bug', text: 'x'.repeat(store.FEEDBACK_MAX) })).status, 201, 'the cap itself goes in');
  assert.match((await dee.post('/front-door/feedback', { kind: 'bug', text: '   ' })).data.error, /Write what happened/);
  assert.match((await dee.post('/front-door/feedback', { kind: 'praise', text: 'Nice' })).data.error, /Bug or Feature request/);
  assert.equal(kept().filter((f) => f.account === 'dee').length, 1);
});

test('the 11th report from one account within an hour is refused; another account still sends', async () => {
  const eve = await owner('eve');
  for (let i = 1; i <= store.FEEDBACK_PER_HOUR; i++) assert.equal((await eve.post('/front-door/feedback', { kind: 'feature', text: `Idea ${i}` })).status, 201);
  const more = await eve.post('/front-door/feedback', { kind: 'feature', text: 'Idea 11' });
  assert.equal(more.status, 429);
  assert.match(more.data.error, /10 reports in the last hour/);
  assert.equal((await (await admin()).post('/front-door/feedback', { kind: 'bug', text: 'Mine still goes' })).status, 201);
});

test('only the admin reads the list: another session gets 404, none is asked to sign in, and a write needs the header', async () => {
  const fay = await owner('fay');
  const id = (await fay.post('/front-door/feedback', { kind: 'bug', text: 'Mine' })).data.id;
  const was = seen();
  assert.equal((await fay.get('/admin/feedback')).status, 404);
  assert.equal((await fay.post(`/admin/feedback/${id}/done`, {})).status, 404);
  assert.equal((await fay.post(`/admin/feedback/${id}/delete`, {})).status, 404);
  const none = door.browser();
  assert.equal((await none.get('/admin/feedback')).status, 401);
  assert.equal((await none.post('/front-door/feedback', { kind: 'bug', text: 'Who am I' })).status, 401);
  assert.equal((await fay.post('/front-door/feedback', { kind: 'bug', text: 'No header' }, { 'X-Bot-Dot': '' })).status, 403);
  assert.equal(seen(), was, 'no botdot server saw any of it');
  assert.ok(kept().some((f) => f.id === id), 'still there');
});

test('marking a report done keeps it, shown as done; deleting it removes it', async () => {
  const gus = await owner('gus');
  const id = (await gus.post('/front-door/feedback', { kind: 'bug', text: 'Done soon' })).data.id;
  const b = await admin();
  const done = await b.post(`/admin/feedback/${id}/done`, {});
  assert.equal(done.status, 200, done.text);
  assert.ok(done.data.report.doneAt);
  const listed = (await b.get('/admin/feedback')).data.reports.find((f) => f.id === id);
  assert.equal(listed.doneAt, done.data.report.doneAt);
  assert.equal((await b.post(`/admin/feedback/${id}/delete`, {})).status, 200);
  assert.equal((await b.get('/admin/feedback')).data.reports.some((f) => f.id === id), false);
  assert.equal((await b.post(`/admin/feedback/${id}/done`, {})).status, 404);
  assert.equal((await b.post(`/admin/feedback/${id}/delete`, {})).status, 404);
});

test('a report that looks like markup is kept and drawn as that literal text', async () => {
  const hal = await owner('hal');
  const text = '<img src=x onerror=alert(1)>';
  const id = (await hal.post('/front-door/feedback', { kind: 'bug', text })).data.id;
  assert.equal((await (await admin()).get('/admin/feedback')).data.reports.find((f) => f.id === id).text, text);
  // The admin page draws everything as text: it sets no markup at all.
  assert.doesNotMatch(pages.ADMIN_SCRIPT, /innerHTML|insertAdjacentHTML|outerHTML/);
  assert.match(pages.ADMIN_SCRIPT, /el\('p', f\.text\)/);
  const page = await (await admin()).get('/admin');
  assert.match(page.text, /<a href="#feedback">/);
  assert.match(page.text, /<ul id="feedback-list" class="links"><\/ul>/);
});

test('the store keeps at most 1000 reports and counts an account\'s hour from the report times', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-store-'));
  try {
    const d = store.open(dir);
    const start = Date.parse('2026-10-21T00:00:00Z');
    for (let i = 0; i < store.FEEDBACK_KEPT + 5; i++) d.addFeedback({ account: `a${i}`, kind: 'bug', text: `n${i}`, app: 'web', now: start + i });
    const all = d.listFeedback();
    assert.equal(all.length, store.FEEDBACK_KEPT);
    assert.equal(all[0].text, `n${store.FEEDBACK_KEPT + 4}`, 'newest first');
    assert.equal(all.at(-1).text, 'n5', 'the oldest went');
    for (let i = 0; i < store.FEEDBACK_PER_HOUR; i++) d.addFeedback({ account: 'zed', kind: 'bug', text: 'x', app: 'android', now: start });
    assert.throws(() => d.addFeedback({ account: 'zed', kind: 'bug', text: 'x', now: start + 3599_000 }), { status: 429 });
    assert.equal(d.addFeedback({ account: 'zed', kind: 'bug', text: 'x', app: 'phone', now: start + 3600_000 }).app, 'web', 'an hour later it goes; an unknown app is the web');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test("a suspended account sends no Feedback, a body that is no object is refused, and a deleted account's reports go with it", async () => {
  const ivy = await owner('ivy');
  assert.equal((await ivy.post('/front-door/feedback', { kind: 'bug', text: 'Before' })).status, 201);
  assert.equal((await ivy.post('/front-door/feedback', null)).status, 400);
  const b = await admin();
  assert.equal((await b.post('/admin/accounts/ivy/suspend', {})).status, 200);
  const paused = await ivy.post('/front-door/feedback', { kind: 'bug', text: 'While paused' });
  assert.equal(paused.status, 503);
  assert.equal(paused.data.paused, true);
  assert.equal((await b.post('/admin/accounts/ivy/delete', { name: 'ivy' })).status, 200);
  assert.equal(kept().some((f) => f.account === 'ivy'), false);
});
