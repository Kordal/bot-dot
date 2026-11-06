// The Chief's tools put a bot's id in the path; a bot's name there is taken as its id when one bot has it (#1098),
// and a word no bot has says what to pass instead. The owner's routes take ids only, as before.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { startServer, makeBot } = require('./helpers');

let srv; let clicker; let twins;
before(async () => {
  srv = await startServer();
  clicker = await makeBot(srv, { name: 'Web Clicker', emoji: '🖱️' });
  twins = [await makeBot(srv, { name: 'Twin', emoji: '1️⃣' }), await makeBot(srv, { name: 'Twin', emoji: '2️⃣' })];
});
after(async () => { await srv.stop(); });

test("a bot's name in a Chief tool's path is that bot's id, also for the routes under it", async () => {
  let r = await srv.asChief(`/bots/${encodeURIComponent('web clicker')}`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.id, clicker.id);
  r = await srv.asChief(`/bots/${encodeURIComponent('Web Clicker')}/files`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal((await srv.api(`/bots/${encodeURIComponent('Web Clicker')}`)).status, 404, "the owner's apps send ids");
});

test('a name two bots have, or no bot has, says what to pass', async () => {
  let r = await srv.asChief('/bots/Twin');
  assert.equal(r.status, 404);
  assert.equal(r.data.error, `Bot not found: 2 bots are called "Twin". Name it by its id: ${twins.map((b) => b.id).join(', ')}.`);
  r = await srv.asChief(`/bots/${encodeURIComponent('Nobody Here')}`);
  assert.equal(r.status, 404);
  assert.match(r.data.error, /no bot has the id or name "Nobody Here".*list_bots shows each bot's id/);
});
