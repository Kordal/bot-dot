// A secret of the Vault kept in a file (#253): a bot asks with place_secret_file, the owner allows that one place on a
// card that warns who can read it there, and botdot writes the file itself; the bot never sees a value. The Vault lists
// where it lies, and "Remove the file" deletes it and the owner's yes with it.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const util = require('node:util');
const childProcess = require('node:child_process');
const secretFiles = require('../lib/secret-files');
const { startServer, makeBot, heldRun } = require('./helpers');
const { rpcClient } = require('./memory-helpers');

// ---------- what the bot may ask for, and the file's text (lib/secret-files.js) ----------

test('a place is a plain absolute path, an octal mode, a plain owner and, for another server, user@host and an SSH key', () => {
  const ok = secretFiles.request({ entries: ['OVH'], path: '/etc/traefik/.env' });
  assert.deepEqual(ok, { entries: ['OVH'], template: undefined, path: '/etc/traefik/.env', mode: '600', owner: 'box', target: 'computer', sshKey: null });
  assert.deepEqual(secretFiles.request({ entries: ['OVH'], path: '/srv/x.env', mode: '0640', host: 'admin@nas.example.ts.net', sshKey: 'NAS key' }),
    { entries: ['OVH'], template: undefined, path: '/srv/x.env', mode: '640', owner: '', target: 'admin@nas.example.ts.net', sshKey: 'NAS key' });
  for (const [body, re] of [
    [{ path: '/x' }, /which Vault entries/],
    [{ entries: Array(9).fill('a'), path: '/x' }, /At most 8/],
    [{ entries: ['a'], path: 'x.env' }, /absolute path/],
    [{ entries: ['a'], path: '/etc/../root/x' }, /absolute path/],
    [{ entries: ['a'], path: "/tmp/a'b" }, /absolute path/],
    [{ entries: ['a'], path: '/tmp/a b' }, /absolute path/],
    [{ entries: ['a'], path: '/x', mode: '999' }, /octal mode/],
    [{ entries: ['a'], path: '/x', owner: 'root;rm' }, /owner is user/],
    [{ entries: ['a'], path: '/x', host: '-oProxyCommand=x' }, /user@server/],
    [{ entries: ['a'], path: '/x', host: 'admin@nas' }, /SSH key/],
  ]) assert.match(secretFiles.request(body).error, re, JSON.stringify(body));
});

test('the template gets each value by its entry name; without one, one entry alone is the file', () => {
  const ovh = { name: 'OVH app', username: 'ak', password: 'aaaaaaaa' };
  const pem = { name: 'TLS key', content: Buffer.from('-----BEGIN-----\nabc\n').toString('base64') };
  assert.equal(secretFiles.render('V={{OVH app.password}}\nUSER={{ ovh APP.username }}\n', [ovh]).toString(), 'V=aaaaaaaa\nUSER=ak\n');
  assert.equal(secretFiles.render('{{TLS key.file}}', [pem]).toString(), '-----BEGIN-----\nabc\n');
  assert.equal(secretFiles.render(undefined, [ovh]).toString(), 'aaaaaaaa');
  assert.equal(secretFiles.render('', [pem]).toString(), '-----BEGIN-----\nabc\n');
  assert.throws(() => secretFiles.render(undefined, [ovh, pem]), /give the file's text as template/);
  assert.throws(() => secretFiles.render('{{Other.password}}', [ovh]), /"Other"/);
  assert.throws(() => secretFiles.render('{{TLS key.password}}', [pem]), /"TLS key.password"/);
  assert.throws(() => secretFiles.render('{{OVH app.password}}', [ovh, pem]), /Every entry must be used/);
});

// ---------- the file on the computer (lib/computers.js placeFile), its steps run by a real sh ----------

const calls = [];
function fakeExecFile(file, args, opts, cb) {
  const call = { file, args, opts };
  calls.push(call);
  return { stdin: { on() {}, end(input) {
    setImmediate(() => {
      const at = args.indexOf('sh');
      const r = at >= 0 ? childProcess.spawnSync(args[at], args.slice(at + 1), { input, encoding: 'utf8' }) : childProcess.spawnSync(args[args.indexOf('rm')], args.slice(args.indexOf('rm') + 1), { encoding: 'utf8' });
      cb(r.status ? Object.assign(new Error('failed'), { code: r.status }) : null, r.stdout, r.stderr);
    });
  } } };
}
fakeExecFile[util.promisify.custom] = async () => ({ stdout: '', stderr: '' });
const realExecFile = childProcess.execFile;
childProcess.execFile = fakeExecFile;
delete require.cache[require.resolve('../lib/computers')];
const computers = require('../lib/computers');
childProcess.execFile = realExecFile;
delete require.cache[require.resolve('../lib/computers')];
const OPS = { bot: 'ops', screen: 1 };

test('placeFile writes the file whole with its mode, in folders it makes, as root, with the bytes on stdin only', { skip: process.platform === 'win32' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-place-'));
  try {
    const file = path.join(dir, 'traefik', 'ovh.env');
    const bytes = Buffer.from('VALUE=bbbbbbbb\n');
    calls.length = 0;
    const r = await computers.placeFile(OPS, { path: file, mode: '640', owner: '', content: bytes.toString('base64') });
    assert.equal(r.code, 0, JSON.stringify(r));
    assert.equal(fs.readFileSync(file, 'utf8'), bytes.toString());
    assert.equal(fs.statSync(file).mode & 0o777, 0o640);
    assert.equal(fs.statSync(path.dirname(file)).mode & 0o777, 0o755, 'a folder on the way is readable, as folders are');
    assert.deepEqual(fs.readdirSync(path.dirname(file)), ['ovh.env'], 'no temporary file is left');
    const [call] = calls;
    assert.deepEqual(call.args.slice(0, 6), ['exec', '-i', '-u', 'root', '-w', '/']);
    assert.ok(!JSON.stringify(call.args).includes('bbbbbbbb'), 'the secret is on no command line');
    // Written again: the new value replaces the old one whole.
    await computers.placeFile(OPS, { path: file, mode: '600', owner: '', content: Buffer.from('NEW=1\n').toString('base64') });
    assert.equal(fs.readFileSync(file, 'utf8'), 'NEW=1\n');
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    assert.equal((await computers.removePlacedFile(OPS, { path: file })).code, 0);
    assert.ok(!fs.existsSync(file));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

test('the Docker helper takes placeFile and removePlacedFile only in their plain shape', () => {
  const { validate } = require('../lib/docker-helper');
  const good = { path: '/etc/traefik/ovh.env', mode: '600', owner: 'box', content: 'QQ==' };
  assert.equal(validate('placeFile', [OPS, good]), true);
  assert.equal(validate('placeFile', [OPS, { ...good, owner: '', host: 'admin@nas', privateKey: 'k' }]), true);
  assert.equal(validate('removePlacedFile', [OPS, { path: good.path }]), true);
  for (const bad of [{ ...good, path: '/etc/../x' }, { ...good, path: "/x'y" }, { ...good, mode: '7777' }, { ...good, owner: 'a b' }, { ...good, host: 'admin@nas' },
    { ...good, host: '-oProxyCommand=sh', privateKey: 'k' }, { ...good, extra: 1 }]) assert.equal(validate('placeFile', [OPS, bad]), false, JSON.stringify(bad));
});

// ---------- the server, the bot's tool, the card and the Vault ----------

let srv; let helper; let dir; let ops; let other;
const asked = [];
const PASSWORD = 'cccccccc';
before(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-secret-files-'));
  const socket = path.join(dir, 'helper.sock');
  helper = http.createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    const { operation, args } = JSON.parse(body);
    asked.push([operation, ...args]);
    let value = null;
    if (operation === 'inspect') value = { state: 'running' };
    if (operation === 'placeFile' || operation === 'removePlacedFile') value = { code: 0, stdout: '', stderr: '', timedOut: false };
    if (operation === 'listAll') value = {};
    if (operation === 'update.status') value = { supported: false };
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ value }));
  });
  await new Promise((r) => helper.listen(socket, r));
  srv = await startServer({ env: { BOT_DOT_HELPER_SOCKET: socket } });
  ops = await makeBot(srv, { name: 'Infra Admin', emoji: '🛠', computer: 'linux' });
  other = await makeBot(srv, { name: 'Mail Sorter', emoji: '📬', computer: 'linux' });
  assert.equal((await srv.api('/vault', { method: 'POST', body: { name: 'OVH app', site: 'eu.api.ovh.com', username: 'fixture-ak', password: PASSWORD, type: 'api-token', allowedBots: [ops.id] } })).status, 201);
});
after(async () => { srv.unhold(); await srv.stop(); await new Promise((r) => helper.close(r)); fs.rmSync(dir, { recursive: true, force: true }); });

const place = (token, body) => srv.api('/vault/session/computer/place-secret-file', { method: 'POST', headers: { 'X-Vault-Token': token }, body });
const ASK = { entries: ['OVH app'], template: 'OVH_ENDPOINT=ovh-eu\nVALUE={{OVH app.password}}\n', path: '/home/box/traefik/ovh.env', reason: 'Traefik needs the OVH keys for its DNS challenge.' };
const fileCards = async () => (await srv.api('/asks?vault-file=1')).data.filter((a) => a.kind === 'vault-file');
const holdsSecret = (v) => JSON.stringify(v).includes(PASSWORD) || JSON.stringify(v).includes(Buffer.from(PASSWORD).toString('base64'));
const audit = () => { try { return fs.readFileSync(path.join(srv.data, 'audit.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l)); } catch { return []; } };
async function endRun(held) { srv.release(held.rec); await srv.finished(held.run.id); srv.unhold(); }

test('without the owner\'s yes nothing is written: the bot gets a card that names the secret, the file and who can read it', async (t) => {
  assert.ok((await srv.api('/version')).data.features.includes('vault-file'));
  const held = await heldRun(srv, ops);
  t.after(() => endRun(held));
  const tools = rpcClient(t, 'computer-mcp.js', { VAULT_URL: `${srv.base}/api/vault`, VAULT_TOKEN: held.token });
  const tool = (await tools.request('tools/list')).tools.find((x) => x.name === 'place_secret_file');
  assert.ok(tool, 'the bot has the tool');
  const said = await tools.text('place_secret_file', ASK);
  assert.match(said, /waits for their OK on a card/);
  await place(held.token, ASK);
  assert.ok(!asked.some(([op]) => op === 'placeFile'), 'nothing written before the yes');

  const cards = await fileCards();
  assert.equal(cards.length, 1, 'asked twice, one card');
  const [card] = cards;
  assert.equal(card.title, 'Let Infra Admin keep “OVH app” in a file?');
  assert.deepEqual(card.parts.slice(0, 3), [
    { label: 'Secret', now: '“OVH app”' },
    { label: 'File', now: "the account's computer:/home/box/traefik/ovh.env" },
    { label: 'Mode', now: '600, owned by box' },
  ]);
  assert.match(card.warning, /every other bot on the account's computer can read it/);
  assert.equal(card.yes, 'Allow');
  assert.equal(card.yesOn, 'card');
  assert.equal(card.reason, ASK.reason);
  assert.match(card.text, /Asks to keep “OVH app” in a file at the account's computer:\/home\/box\/traefik\/ovh\.env/);
  assert.ok(!(await srv.api('/asks')).data.some((a) => a.kind === 'vault-file'), 'an app that does not ask for these cards is not handed one');
  assert.ok(!holdsSecret(cards), 'the card holds no secret');
});

test('only the owner answers the card; after the yes botdot writes the file, again without a card, and the Vault lists it', async (t) => {
  const [card] = await fileCards();
  assert.equal((await srv.asChief(`/asks/${card.id}`, { method: 'POST', body: { yes: true } })).status, 403);
  const held0 = await heldRun(srv, ops);
  const r0 = await fetch(`http://127.0.0.1:${srv.botdotPort}/api/asks/${card.id}`, { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Bot-Dot': '1', 'X-Vault-Token': held0.token }, body: JSON.stringify({ yes: true }) });
  assert.equal(r0.status, 403, "the bot's run can't answer it");
  await endRun(held0);
  const yes = await srv.api(`/asks/${card.id}`, { method: 'POST', body: { yes: true } });
  assert.equal(yes.status, 200, JSON.stringify(yes.data));
  assert.ok(audit().some((l) => l.action === 'secret-file.allowed' && l.bot === ops.id && l.where === "the account's computer:/home/box/traefik/ovh.env"));
  await new Promise((r) => setTimeout(r, 200));
  srv.unhold();

  const held = await heldRun(srv, ops);
  t.after(() => endRun(held));
  let r = await place(held.token, ASK);
  assert.equal(r.data.ok, true, JSON.stringify(r.data));
  assert.match(r.data.text, /Wrote the account's computer:\/home\/box\/traefik\/ovh\.env/);
  assert.ok(!holdsSecret(r.data), 'the bot gets no secret back');
  const wrote = asked.filter(([op]) => op === 'placeFile');
  assert.equal(wrote.length, 1);
  const [, seat, args] = wrote[0];
  assert.equal(seat.bot, ops.id);
  assert.deepEqual([args.path, args.mode, args.owner, args.host], ['/home/box/traefik/ovh.env', '600', 'box', undefined]);
  assert.equal(Buffer.from(args.content, 'base64').toString(), `OVH_ENDPOINT=ovh-eu\nVALUE=${PASSWORD}\n`);
  // The same place again (after the secret changed in the Vault): no new card.
  r = await place(held.token, ASK);
  assert.equal(r.data.ok, true);
  assert.equal(asked.filter(([op]) => op === 'placeFile').length, 2);
  assert.deepEqual(await fileCards(), []);
  // Another mode, or other text in the file, is another place: a card again, which shows the text.
  r = await place(held.token, { ...ASK, mode: '644' });
  assert.equal(r.data.asked, true);
  r = await place(held.token, { ...ASK, template: `${ASK.template}ExecStart=/bin/sh\n` });
  assert.equal(r.data.asked, true);
  const later = await fileCards();
  assert.equal(later.length, 2);
  assert.ok(later.some((c) => c.parts.some((p) => p.label === 'Text' && p.now.includes('ExecStart'))));
  for (const c of later) await srv.api(`/asks/${c.id}`, { method: 'POST', body: { yes: false } });
  assert.ok(audit().some((l) => l.action === 'secret-file.placed' && l.bot === ops.id));
  assert.ok(!holdsSecret(audit()) && !holdsSecret(srv.log.join('')), 'nor the audit log or the server log');

  const entry = (await srv.api('/vault')).data.find((e) => e.name === 'OVH app');
  assert.equal(entry.placedIn.length, 1);
  assert.equal(entry.placedIn[0].where, "the account's computer:/home/box/traefik/ovh.env");
  assert.equal(entry.placedIn[0].botId, ops.id);
  assert.equal(entry.placedIn[0].written, true);
});

test('"Remove the file" deletes it where it was written, and the bot must ask again', async (t) => {
  const entry = (await srv.api('/vault')).data.find((e) => e.name === 'OVH app');
  const [f] = entry.placedIn;
  assert.equal((await srv.asChief(`/vault/secret-files/${f.id}`, { method: 'DELETE' })).status, 403);
  const r = await srv.api(`/vault/secret-files/${f.id}`, { method: 'DELETE' });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const removed = asked.filter(([op]) => op === 'removePlacedFile');
  assert.equal(removed.length, 1);
  assert.deepEqual(removed[0][2], { path: '/home/box/traefik/ovh.env' });
  assert.equal((await srv.api('/vault')).data.find((e) => e.name === 'OVH app').placedIn, undefined);
  assert.ok(audit().some((l) => l.action === 'secret-file.removed'));
  const held = await heldRun(srv, ops);
  t.after(() => endRun(held));
  assert.equal((await place(held.token, ASK)).data.asked, true);
});

test('a no is final for a week; a secret not shared with the bot is refused before any card', async (t) => {
  for (const c of await fileCards()) assert.equal((await srv.api(`/asks/${c.id}`, { method: 'POST', body: { yes: false } })).status, 200);
  await new Promise((r) => setTimeout(r, 100));
  const held = await heldRun(srv, ops);
  let r = await place(held.token, ASK);
  assert.equal(r.data.ok, false);
  assert.match(r.data.error, /said no to this file recently/);
  await endRun(held);
  const theirs = await heldRun(srv, other);
  t.after(() => endRun(theirs));
  r = await place(theirs.token, ASK);
  assert.equal(r.data.ok, false);
  assert.match(r.data.error, /isn't allowed to use/);
  assert.deepEqual(await fileCards(), []);
});
