// The off-site backup set up from the admin page (ADR 161): with a Hetzner API token the front door makes the Storage
// Box's sub-account for this machine, named after it, asks root's step with OFFSITE-SET, shows the repository's new
// password until the admin says it is saved, and asks for a run now with OFFSITE. A stand-in of Hetzner's API answers.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const passkey = require('./fixtures/soft-passkey');
const { startFrontDoor } = require('./front-door-helpers');

const TOKEN = 'hetzner-token-0123456789';
let door, status, requests, browser, api, hetzner;
const seen = [];
// Hetzner: one project's Storage Boxes (boxes), their sub-accounts, and actions that finish at once.
const state = { boxes: [{ id: 7, name: 'backups', server: 'u1.your-storagebox.de' }], subs: [], next: 1 };
before(async () => {
  hetzner = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      seen.push({ method: req.method, url: req.url, auth: req.headers.authorization, body: body ? JSON.parse(body) : null });
      const out = (code, v) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(v)); };
      if (req.headers.authorization !== `Bearer ${TOKEN}`) return out(401, { error: { code: 'unauthorized', message: 'unable to authenticate' } });
      const action = { id: 99, status: 'success' };
      if (req.url.startsWith('/storage_boxes?')) return out(200, { storage_boxes: state.boxes });
      let m = req.url.match(/^\/storage_boxes\/(\d+)\/subaccounts$/);
      if (m && req.method === 'GET') return out(200, { subaccounts: state.subs });
      if (m && req.method === 'POST') {
        const n = state.next++;
        const sub = { id: 100 + n, name: JSON.parse(body).name, username: `u1-sub${n}`, server: `u1-sub${n}.your-storagebox.de`, access_settings: { ssh_enabled: true, reachable_externally: true } };
        state.subs.push(sub);
        return out(201, { subaccount: { id: sub.id, storage_box: Number(m[1]) }, action: { id: 98, status: 'running' } });
      }
      if (req.url === '/storage_boxes/actions/98') return out(200, { action: { id: 98, status: 'success' } });
      m = req.url.match(/^\/storage_boxes\/\d+\/subaccounts\/(\d+)$/);
      if (m) return out(200, { subaccount: state.subs.find((s) => s.id === Number(m[1])) });
      if (/\/actions\/reset_subaccount_password$/.test(req.url)) return out(201, { action });
      return out(404, { error: { message: 'not found' } });
    });
  });
  await new Promise((r) => hetzner.listen(0, '127.0.0.1', r));
  api = `http://127.0.0.1:${hetzner.address().port}`;
  status = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-status-'));
  requests = fs.mkdtempSync(path.join(os.tmpdir(), 'fd-requests-'));
  door = await startFrontDoor({ env: { FRONT_DOOR_ADMIN: 'ann', FRONT_DOOR_STATUS: status, FRONT_DOOR_REQUESTS: requests, FRONT_DOOR_HETZNER_API: api, FRONT_DOOR_ORIGIN: 'https://hq.botdot.test', FRONT_DOOR_HETZNER_WAIT_MS: '5000' } });
  browser = door.browser();
  const key = passkey.create({ rpId: door.rpId, origin: door.origin });
  const options = await browser.post(`${door.firstLink.path}/options`, { name: 'ann' });
  assert.equal((await browser.post(door.firstLink.path, { name: 'ann', credential: key.register(options.data.publicKey) })).status, 201);
});
after(async () => {
  await door?.stop();
  hetzner?.close();
  for (const d of [status, requests]) fs.rmSync(d, { recursive: true, force: true });
});
// Root's requests of the off-site backup (signing ann up asked for her account, too).
const asked = () => fs.readdirSync(requests).filter((f) => f.startsWith('OFFSITE')).sort();
const said = (value) => fs.writeFileSync(path.join(status, 'offsite.json'), JSON.stringify(value));
const files = (dir) => fs.readdirSync(dir, { recursive: true }).filter((f) => fs.statSync(path.join(dir, f)).isFile()).map((f) => fs.readFileSync(path.join(dir, f), 'utf8')).join('\n');

test('a machine without an off-site backup offers the Storage Box form; a token Hetzner refuses is said, and nothing asked', async () => {
  const r = (await browser.get('/admin/offsite')).data;
  assert.equal(r.offsite, null);
  assert.deepEqual(r.setup, { can: true, busy: false, now: false, error: null, password: null, keep: null });
  const page = (await browser.get('/admin')).text;
  assert.match(page, /<form id="offsite-form" class="panel share" hidden>/);
  assert.match(page, /<input name="token" type="password"/);
  const refused = await browser.post('/admin/offsite', { token: 'not-the-token-at-all' });
  assert.deepEqual({ status: refused.status, error: refused.data.error }, { status: 400, error: 'Hetzner refused this token.' });
  assert.equal((await browser.post('/admin/offsite', { token: '' })).status, 400);
  assert.deepEqual(asked(), []);
});

test('with two boxes the admin picks one; the sub-account is made for this machine and root is asked, the token kept nowhere', async () => {
  state.boxes.push({ id: 8, name: 'archive', server: 'u2.your-storagebox.de' });
  const pick = await browser.post('/admin/offsite', { token: TOKEN });
  assert.equal(pick.status, 200);
  assert.deepEqual(pick.data.boxes.map((b) => b.name), ['backups', 'archive']);
  assert.deepEqual(asked(), [], 'nothing asked before a box is picked');

  const done = await browser.post('/admin/offsite', { token: TOKEN, box: 7 });
  assert.equal(done.status, 202, JSON.stringify(done.data));
  assert.equal(done.data.setup.busy, true);
  const made = seen.find((s) => s.method === 'POST' && s.url === '/storage_boxes/7/subaccounts');
  assert.equal(made.body.name, 'botdot-hq', 'named after the machine');
  assert.equal(made.body.home_directory, 'botdot-hq');
  assert.deepEqual({ ssh: made.body.access_settings.ssh_enabled, out: made.body.access_settings.reachable_externally }, { ssh: true, out: true });
  assert.match(made.body.password, /^(?=.*[A-Z])(?=.*[a-z])(?=.*\d)(?=.*-).{40,}$/, "a password Hetzner's policy takes");
  const [repo, pass, sub, ...rest] = fs.readFileSync(path.join(requests, 'OFFSITE-SET'), 'utf8').split('\n');
  assert.equal(repo, 'sftp://u1-sub1@u1-sub1.your-storagebox.de:23/botdot');
  assert.equal(pass, '', 'the repository\'s password is root\'s to make');
  assert.equal(sub, made.body.password);
  assert.deepEqual(rest, ['']);
  assert.equal(fs.statSync(path.join(requests, 'OFFSITE-SET')).mode & 0o777, 0o640);
  assert.ok(!files(door.data).includes(TOKEN) && !files(door.data).includes(made.body.password), 'neither the token nor the password is kept');
  const audit = (await browser.get('/admin/audit?action=offsite-connected')).data.entries;
  assert.equal(audit[0].detail, 'backups · u1-sub1');
  assert.equal((await browser.post('/admin/offsite', { token: TOKEN, box: 7 })).status, 409, 'not twice while it is set up');
});

test('a setup tried again reuses the sub-account with a new password; a failed one is said under the form', async () => {
  fs.rmSync(path.join(requests, 'OFFSITE-SET'));
  said({ state: 'off', at: new Date().toISOString(), setup: true, error: "Couldn't put this machine's key on u1-sub1@u1-sub1.your-storagebox.de: Permission denied" });
  const r = (await browser.get('/admin/offsite')).data.setup;
  assert.deepEqual({ busy: r.busy, error: r.error }, { busy: false, error: "Couldn't put this machine's key on u1-sub1@u1-sub1.your-storagebox.de: Permission denied" });
  const again = await browser.post('/admin/offsite', { token: TOKEN, box: 7 });
  assert.equal(again.status, 202);
  assert.ok(seen.some((s) => s.url === '/storage_boxes/7/subaccounts/101/actions/reset_subaccount_password'));
  assert.equal(state.subs.length, 1, 'no second sub-account');
  assert.match(fs.readFileSync(path.join(requests, 'OFFSITE-SET'), 'utf8'), /^sftp:\/\/u1-sub1@/);
  fs.rmSync(path.join(requests, 'OFFSITE-SET'));
});

test('the repository\'s password is shown until the admin says it is saved, and "Back up now" asks root for a run', async () => {
  said({ state: 'backing-up', at: new Date().toISOString(), started: new Date().toISOString() });
  fs.writeFileSync(path.join(door.data, 'offsite-password.json'), JSON.stringify({ password: 'ab'.repeat(32), at: new Date().toISOString() }));
  let r = (await browser.get('/admin/offsite')).data;
  assert.equal(r.setup.password, 'ab'.repeat(32));
  assert.equal(r.offsite.state, 'backing-up');
  assert.equal((await browser.post('/admin/offsite', { token: TOKEN })).status, 409, 'one off-site backup is enough');
  r = (await browser.post('/admin/offsite/password-saved', {})).data;
  assert.equal(r.setup.password, null);
  assert.ok(!fs.existsSync(path.join(door.data, 'offsite-password.json')));

  // A run under way isn't asked for twice.
  assert.equal((await browser.post('/admin/offsite/now', {})).status, 202);
  assert.deepEqual(asked(), []);
  said({ state: 'done', at: new Date().toISOString(), lastSuccess: new Date().toISOString() });
  const now = await browser.post('/admin/offsite/now', {});
  assert.equal(now.status, 202);
  assert.equal(now.data.setup.now, true);
  assert.deepEqual(asked(), ['OFFSITE']);
});

test('the admin sets how many latest backups are kept, for root\'s step to read; the default is none', async () => {
  assert.equal((await browser.get('/admin/offsite')).data.setup.keep, null);
  assert.equal((await browser.post('/admin/offsite/keep', { last: 2 })).data.setup.keep, 2);
  assert.equal(fs.readFileSync(path.join(door.data, 'offsite-keep.json'), 'utf8'), '{"last":2}');
  assert.equal((await browser.post('/admin/offsite/keep', { last: 0 })).status, 400);
  assert.equal((await browser.post('/admin/offsite/keep', { last: '2' })).status, 400);
  assert.equal((await browser.post('/admin/offsite/keep', { last: null })).data.setup.keep, null);
  assert.ok(!fs.existsSync(path.join(door.data, 'offsite-keep.json')));
  assert.match((await browser.get('/admin')).text, /<select id="offsite-keep" aria-label="Backups kept"><option value="">7 days · 4 weeks · 3 months<\/option><option value="1">Latest only<\/option><option value="2">2 latest<\/option>/);
});

test('nobody else reaches it', async () => {
  const other = door.browser();
  assert.notEqual((await other.post('/admin/offsite', { token: TOKEN })).status, 202);
  assert.notEqual((await other.post('/admin/offsite/now', {})).status, 202);
});
