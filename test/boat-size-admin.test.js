// The size of the account's External Virtual PC on boat.dev (ADR 163): the admin chooses it on the admin page, through
// the front door's own header, as where the computer is (ADR 146). The owner reads it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { startServer } = require('./helpers');

const ADMIN = { 'X-Botdot-Room': '1' };
let srv;
// boat.dev itself is nowhere here: its sizes are offered as they are.
test.before(async () => { srv = await startServer({ env: { BOT_DOT_BOAT_URL: 'http://127.0.0.1:9' } }); });
test.after(async () => { srv.unhold(); await srv.stop(); });

test("only the admin chooses the External Virtual PC's size; the owner reads it", async () => {
  assert.equal((await srv.api('/settings/boat-size')).status, 404, 'no boat.dev key here');
  assert.equal((await srv.api('/boat', { method: 'POST', body: { key: 'boat_goodkey12345' }, headers: ADMIN })).status, 200);

  const read = await srv.api('/settings/boat-size');
  assert.equal(read.data.size, 'default');
  assert.deepEqual(read.data.sizes.map((s) => s.id), ['small', 'default', 'large', 'xlarge']);

  const owner = await srv.api('/settings/boat-size', { method: 'PUT', body: { size: 'large' } });
  assert.deepEqual([owner.status, owner.data.error], [403, "Not done: the admin chooses the size of the account's External Virtual PC, on the admin page. Nothing was changed."]);
  assert.equal((await srv.asChief('/settings/boat-size', { method: 'PUT', body: { size: 'large' }, headers: ADMIN })).status, 403, 'not the Chief');
  assert.equal((await srv.api('/settings', { method: 'PUT', body: { boatSize: 'large' } })).data.settings.boatSize, 'default', 'nor through the settings');
  assert.equal((await srv.api('/settings/boat-size')).data.size, 'default');

  assert.equal((await srv.api('/settings/boat-size', { method: 'PUT', body: { size: 'huge' }, headers: ADMIN })).status, 400);
  const set = await srv.api('/settings/boat-size', { method: 'PUT', body: { size: 'large' }, headers: ADMIN });
  assert.deepEqual([set.status, set.data.size], [200, 'large']);
  assert.equal((await srv.api('/settings/boat-size')).data.size, 'large', 'the owner reads the admin\'s choice');
  assert.ok((await srv.api('/version')).data.features.includes('boat-size-admin'));
});
