// A bot's computer may be in a place of its own (#1613, ADR 261): this machine (`linux`) or the External Virtual PC on
// boat.dev (`boat`), chosen by the owner in the bot's settings; '' follows the account's place (ADR 098, ADR 146), which
// only the admin moves. `computer` is where the bot works now, whichever of the two decided it.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { startServer } = require('./helpers');

const ADMIN = { 'X-Botdot-Room': '1' };
let srv, hang;
before(async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-bot-place-'));
  const data = path.join(dir, 'data');
  fs.mkdirSync(data, { recursive: true });
  const bot = (id, name, extra = {}) => ({ id, name, prompt: 'Build things.', allowedTools: ['Read'], computer: 'linux', jobs: [], ...extra });
  // Saved before a bot had a place of its own: none of them has computerPlace.
  fs.writeFileSync(path.join(data, 'bots.json'), JSON.stringify([bot('old', 'Old'), bot('coder', 'Coder'), bot('writer', 'Writer'), bot('asked', 'Asked'), bot('copied', 'Copied')]));
  // boat.dev here takes a request and never answers: a copy to it stays running.
  hang = net.createServer(() => {}).listen(0, '127.0.0.1');
  await new Promise((r) => hang.once('listening', r));
  srv = await startServer({ dir, env: { BOT_DOT_BOAT_URL: `http://127.0.0.1:${hang.address().port}` } });
});
after(async () => { await srv.stop(); hang.closeAllConnections?.(); hang.close(); });

const botOf = async (id) => (await srv.api(`/bots/${id}`)).data;
const put = (id, body, as = 'api') => (as === 'chief' ? srv.asChief(`/bots/${id}`, { method: 'PUT', body }) : srv.api(`/bots/${id}`, { method: 'PUT', body }));
async function until(check) {
  for (let i = 0; i < 100; i++) { const v = await check(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); }
  throw new Error('it never happened');
}

test('a bot from before follows the account, and the place is announced', async () => {
  assert.equal((await botOf('old')).computerPlace, '');
  assert.equal((await botOf('old')).computer, 'linux');
  assert.ok((await srv.api('/version')).data.features.includes('bot-computer-place'));
});

test('without a boat.dev key a bot cannot be put on the External Virtual PC', async () => {
  const r = await put('coder', { computerPlace: 'boat' });
  assert.equal(r.status, 400);
  assert.match(r.data.error, /External Virtual PC is not set up/);
  assert.equal((await botOf('coder')).computerPlace, '');
  assert.equal((await put('coder', { computerPlace: 'mars' })).status, 400, 'no such place');
  assert.equal((await put('coder', { computerPlace: 'linux' })).data.computerPlace, 'linux', 'this machine needs no key');
  assert.equal((await put('coder', { computerPlace: '' })).data.computerPlace, '');
});

test('a bot on the External Virtual PC works there while the account is on this machine, and the reverse', async () => {
  assert.equal((await srv.api('/boat', { method: 'POST', body: { key: 'boat_goodkey12345' }, headers: ADMIN })).status, 200);
  assert.equal((await srv.api('/settings/computer')).data.place, 'linux');

  const boat = await put('coder', { computerPlace: 'boat' });
  assert.deepEqual([boat.status, boat.data.computerPlace, boat.data.computer], [200, 'boat', 'boat']);
  assert.equal((await botOf('writer')).computer, 'linux', 'the others follow the account');
  assert.equal((await srv.api('/settings/computer')).data.place, 'linux', 'the account stays where it is');

  // The admin moves the account to boat.dev: those that follow it go, the bot with a place of its own stays.
  assert.equal((await put('writer', { computerPlace: 'linux' })).data.computer, 'linux');
  const moved = await srv.api('/settings/computer', { method: 'PUT', body: { place: 'boat' }, headers: ADMIN });
  assert.equal(moved.data.place, 'boat');
  assert.equal((await botOf('old')).computer, 'boat', 'it follows the account');
  assert.equal((await botOf('coder')).computer, 'boat');
  assert.deepEqual([(await botOf('writer')).computer, (await botOf('writer')).computerPlace], ['linux', 'linux'], 'a place of its own stays');

  // And back: the bot on boat.dev of its own stays there, the one on this machine of its own too.
  assert.equal((await srv.api('/settings/computer', { method: 'PUT', body: { place: 'linux' }, headers: ADMIN })).data.place, 'linux');
  assert.equal((await botOf('old')).computer, 'linux');
  assert.equal((await botOf('coder')).computer, 'boat', 'its own place: boat.dev');
  assert.equal((await botOf('writer')).computer, 'linux');
});

test('an older app that sends computer does not move a bot with a place of its own', async () => {
  const r = await put('coder', { computer: 'linux' });
  assert.deepEqual([r.data.computer, r.data.computerPlace], ['boat', 'boat']);
});

test('the owner makes a bot follow the account again, and it goes where the account is', async () => {
  const r = await put('coder', { computerPlace: '' });
  assert.deepEqual([r.status, r.data.computerPlace, r.data.computer], [200, '', 'linux']);
});

test("the Chief does not move a bot's computer, whatever it asks", async () => {
  const r = await put('asked', { computerPlace: 'boat' }, 'chief');
  assert.equal(r.status, 403);
  assert.match(r.data.error, /owner/);
  assert.deepEqual([(await botOf('asked')).computerPlace, (await botOf('asked')).computer], ['', 'linux']);
  const chiefly = await put('coder', { computerPlace: 'boat' }, 'chief');
  assert.equal(chiefly.status, 403, 'not for a bot either');
  // The Chief's change of computer leaves a bot with a place of its own where it is.
  await put('writer', { computerPlace: 'boat' });
  const same = await put('writer', { computer: 'linux' }, 'chief');
  assert.equal(same.data.computer, 'boat');
  await put('writer', { computerPlace: 'linux' });
});

test('"Copy files" with a bot\'s own place copies its files, "Start empty" copies none, and it waits while a copy runs', async () => {
  const empty = await put('asked', { computerPlace: 'boat' });
  assert.equal(empty.status, 200);
  assert.equal((await botOf('asked')).computerMove, undefined, 'no copy without moveFiles');

  const r = await put('copied', { computerPlace: 'boat', moveFiles: true });
  assert.deepEqual([r.status, r.data.computer], [200, 'boat']);
  const move = await until(async () => { const b = await botOf('copied'); return b.computerMove && b; });
  assert.deepEqual([move.computerMove.from, move.computerMove.to, move.computerMove.state], ['linux', 'boat', 'copying'], 'boat.dev never answers here');
  const wait = await put('copied', { computerPlace: 'linux' });
  assert.equal(wait.status, 409, 'not while its files are being copied');
  assert.equal((await botOf('copied')).computerPlace, 'boat');
});

test("a copy of a bot made by the owner keeps its place of its own", async () => {
  const copy = await srv.api('/bots/copied/duplicate', { method: 'POST', body: {} });
  assert.equal(copy.status, 201);
  assert.deepEqual([copy.data.computerPlace, copy.data.computer], ['boat', 'boat']);
});

test('a bot with a place of its own keeps it when the file is read again', async () => {
  const files = JSON.parse(fs.readFileSync(path.join(srv.data, 'bots.json'), 'utf8'));
  assert.equal(files.find((b) => b.id === 'asked').computerPlace, 'boat');
  assert.equal(files.find((b) => b.id === 'asked').computer, 'boat');
  assert.equal(files.find((b) => b.id === 'old').computerPlace, '');
});
