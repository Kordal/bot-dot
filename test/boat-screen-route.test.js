// A boat bot's screen tools through botdot's routes (#563): they wait for its machine's screen, and when boat.dev
// can't give one (here: no key) they say so, and its computer stays its own. No Docker, no boat.dev.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, restartServer, makeBot, heldRun } = require('./helpers');

let srv;
let bot;
// A bot made on the account's computer, moved to boat.dev in its saved file: without a key the API refuses the move.
before(async () => {
  srv = await startServer();
  bot = await makeBot(srv, { name: 'Coder', computer: 'linux' });
  const file = path.join(srv.data, 'bots.json');
  srv = await restartServer(srv, () => fs.writeFileSync(file, JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8')).map((b) => (b.id === bot.id ? { ...b, computer: 'boat' } : b)))));
});
after(() => srv.stop());

test("a boat bot's screen tools wait for its machine's screen, and say why there is none", async () => {
  const { rec, run, token } = await heldRun(srv, bot);
  const call = (what, body = {}) => srv.api(`/vault/session/computer${what}`, { method: 'POST', body, headers: { 'X-Vault-Token': token } });
  assert.match(rec.system, /It also has a screen, one desktop \(1920x1080\) with one Camoufox browser, that those bots share/);
  assert.ok(rec.system.includes(`start in your folder there, /home/user/workspace/${bot.id},`));
  const screen = await call('', { screen: true });
  assert.equal(screen.data.ok, false);
  assert.match(screen.data.error, /^Couldn't start the screen: boat\.dev has no key/);
  const shot = await call('/cmd', { command: 'screenshot' });
  assert.match(shot.data.error, /^screenshot failed: boat\.dev has no key/);
  const browser = await call('/browser', { op: 'snapshot' });
  assert.match(browser.data.error, /boat\.dev has no key/);
  const kept = await call('/hold');
  assert.deepEqual([kept.data.ok, kept.data.text], [true, 'Your machine on boat.dev stays on after you reply, with everything open on your screen, while the owner watches it and until it is 30 minutes unused.']);
  srv.release(rec);
  await srv.finished(run.id);
  srv.unhold();
  assert.equal(fs.existsSync(path.join(srv.data, 'computer-holds.json')), false, 'nothing held on the account\'s computer');
});
