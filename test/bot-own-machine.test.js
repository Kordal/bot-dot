// A bot's machine of its own on boat.dev (#1617, ADR 263): while the account uses its own boat.dev key, a bot on the
// External Virtual PC either shares the account's one machine (ADR 096, the default) or has a machine of its own. The
// owner switches it in the bot's settings, its files copied ("Copy files") or not ("Start empty", ADR 091); the Chief's
// request waits for the owner's card. boat.dev here answers the key's check and then never answers: a copy stays running.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { startServer } = require('./helpers');
const { fakeBoatHttp } = require('./fixtures/fake-boat-http');

const OWN = 'boat_ownkey1234567890';
let srv, boat, data;

before(async () => {
  boat = await fakeBoatHttp();
  boat.state.hang = true;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'botdot-own-machine-'));
  data = path.join(dir, 'data');
  fs.mkdirSync(data, { recursive: true });
  const bot = (id, name, extra = {}) => ({ id, name, prompt: 'Build things.', allowedTools: ['Read'], computer: 'boat', computerPlace: 'boat', jobs: [], ...extra });
  // `legacy` kept a machine of its own from before #579 removed it: that flag is dropped once, as the file is read.
  fs.writeFileSync(path.join(data, 'bots.json'), JSON.stringify([bot('coder', 'Coder'), bot('fresh', 'Fresh'), bot('asked', 'Asked'), bot('back', 'Back'),
    bot('legacy', 'Legacy', { boatOwnMachine: true }), bot('local', 'Local', { computer: 'linux', computerPlace: 'linux' })]));
  srv = await startServer({ dir, env: { BOT_DOT_BOAT_URL: boat.url } });
});
after(async () => { await srv.stop(); boat.close(); });

const botOf = async (id) => (await srv.api(`/bots/${id}`)).data;
const put = (id, body, as = 'api') => (as === 'chief' ? srv.asChief(`/bots/${id}`, { method: 'PUT', body }) : srv.api(`/bots/${id}`, { method: 'PUT', body }));
async function until(check) {
  for (let i = 0; i < 100; i++) { const v = await check(); if (v) return v; await new Promise((r) => setTimeout(r, 50)); }
  throw new Error('it never happened');
}
const setKey = async () => assert.equal((await srv.api('/settings/boat-key', { method: 'PUT', body: { key: OWN } })).status, 200);

test('a machine of its own from before #579 is no longer one, and a bot has none by default', async () => {
  assert.equal((await botOf('legacy')).boatOwnMachine, false);
  assert.equal((await botOf('coder')).boatOwnMachine, false);
  assert.ok(fs.existsSync(path.join(data, '.boat-own-machine')), 'dropped once');
  assert.equal(JSON.parse(fs.readFileSync(path.join(data, 'bots.json'), 'utf8')).find((b) => b.id === 'legacy').boatOwnMachine, false);
  assert.ok((await srv.api('/version')).data.features.includes('bot-own-machine'));
});

test("it needs the account's own key, and a bot on the External Virtual PC", async () => {
  const none = await put('coder', { boatOwnMachine: true });
  assert.equal(none.status, 400);
  assert.match(none.data.error, /own boat\.dev key/);
  await setKey();
  const local = await put('local', { boatOwnMachine: true });
  assert.equal(local.status, 400);
  assert.match(local.data.error, /External Virtual PC/);
  assert.equal((await put('coder', { boatOwnMachine: 'yes' })).data.boatOwnMachine, false, 'only true is yes');
  assert.equal((await botOf('local')).boatOwnMachine, false);
});

test('taking the key away puts the bots back on the account\'s one machine, and their place stays', async () => {
  const own = await put('back', { boatOwnMachine: true });
  assert.deepEqual([own.status, own.data.boatOwnMachine, own.data.computer], [200, true, 'boat']);
  assert.equal((await botOf('back')).computerMove, undefined, '"Start empty": nothing copied');
  const gone = await srv.api('/settings/boat-key?machines=keep', { method: 'DELETE' });
  assert.deepEqual([gone.status, gone.data.removed], [200, true]);
  const back = await botOf('back');
  assert.deepEqual([back.boatOwnMachine, back.computer, back.computerPlace], [false, 'boat', 'boat']);
  await setKey();
});

test('"Start empty": a bot gets a machine of its own and none of its files are copied; back to the account\'s the same', async () => {
  const r = await put('fresh', { boatOwnMachine: true });
  assert.deepEqual([r.status, r.data.boatOwnMachine, r.data.computer], [200, true, 'boat']);
  assert.equal((await botOf('fresh')).computerMove, undefined);
  const same = await put('fresh', { boatOwnMachine: true, moveFiles: true });
  assert.equal(same.status, 200);
  assert.equal((await botOf('fresh')).computerMove, undefined, 'it had one already: nothing to copy');
  const shared = await put('fresh', { boatOwnMachine: false });
  assert.deepEqual([shared.status, shared.data.boatOwnMachine], [200, false]);
  assert.equal((await botOf('fresh')).computerMove, undefined);
});

test('"Copy files": its files are copied from the account\'s machine to its own, and back; not while one runs', async () => {
  const r = await put('coder', { boatOwnMachine: true, moveFiles: true });
  assert.deepEqual([r.status, r.data.boatOwnMachine], [200, true]);
  const move = await until(async () => { const b = await botOf('coder'); return b.computerMove && b; });
  assert.deepEqual([move.computerMove.from, move.computerMove.to, move.computerMove.state], ['boat', 'boat', 'copying'], 'between two machines there; boat.dev never answers here');
  const wait = await put('coder', { boatOwnMachine: false });
  assert.equal(wait.status, 409, 'not while its files are being copied');
  assert.equal((await botOf('coder')).boatOwnMachine, true);
});

test("the owner's key choice is a copy: a bot made from one with a machine of its own shares the account's", async () => {
  const copy = await srv.api('/bots/coder/duplicate', { method: 'POST', body: {} });
  assert.equal(copy.status, 201);
  assert.deepEqual([copy.data.boatOwnMachine, copy.data.computer], [false, 'boat']);
  const made = await srv.api('/bots', { method: 'POST', body: { name: 'Newcomer', prompt: 'Build things.', computerPlace: 'boat', boatOwnMachine: true } });
  assert.equal(made.status, 201);
  assert.equal(made.data.boatOwnMachine, false, 'a new bot shares the account\'s machine');
});

test("the Chief's request waits for the owner's card, which says what it costs; a yes applies it with its files", async () => {
  const r = await put('asked', { boatOwnMachine: true, moveFiles: true }, 'chief');
  assert.equal(r.status, 200);
  assert.equal(r.data.boatOwnMachine, false, 'it waits for the owner');
  const ask = (await srv.api('/asks')).data.find((a) => a.botId === 'asked');
  assert.ok(ask, 'a card');
  const part = ask.parts.find((p) => p.label === 'Machine on the External Virtual PC');
  assert.match(part.now, /^a machine of its own on boat\.dev, which has costs, with its files$/);
  assert.equal((await botOf('asked')).computerMove, undefined, 'nothing copied before the yes');
  assert.equal((await srv.api(`/asks/${ask.id}`, { method: 'POST', body: { yes: true } })).status, 200);
  assert.equal((await botOf('asked')).boatOwnMachine, true);
  const move = await until(async () => { const b = await botOf('asked'); return b.computerMove && b; });
  assert.deepEqual([move.computerMove.from, move.computerMove.to, move.computerMove.state], ['boat', 'boat', 'copying']);
});

test('going back to the account\'s machine, the Chief needs no card: it costs nothing', async () => {
  assert.equal((await put('fresh', { boatOwnMachine: true })).status, 200);
  const r = await put('fresh', { boatOwnMachine: false }, 'chief');
  assert.equal(r.status, 200);
  assert.equal(r.data.boatOwnMachine, false);
  assert.equal((await srv.api('/asks')).data.filter((a) => a.botId === 'fresh').length, 0);
});

test('the Chief reads whether a bot has a machine of its own', async () => {
  const bots = (await srv.asChief('/bots')).data;
  assert.equal(bots.find((b) => b.id === 'asked').boatOwnMachine, true);
});
