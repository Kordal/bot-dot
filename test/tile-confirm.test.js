// A bot changes its own tile on the Board (change_tile), and a tile can ask "are you sure" before a tap (confirm):
// the owner asked a Home Assistant bot to make its switch ask before turning off, and suggest_tile only said
// "It's already on the Board", so the bot could neither change nor replace it.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { startServer, makeBot, heldRun, self, ROOT } = require('./helpers');
const { TOOLS } = require('../lib/mcp-server');

let srv;
before(async () => { srv = await startServer(); });
after(() => srv.stop());

// A switch as a bot's tile: scripts, so no saved login is needed; the owner approves it as they would.
const tvSwitch = (bot) => ({
  kind: 'switch', title: 'TV i Shield', bot,
  read: { type: 'script', script: 'echo on' },
  turnOn: { type: 'script', script: 'echo turn on' },
  turnOff: { type: 'script', script: 'echo turn off' },
});
async function onBoard(body) {
  const made = await srv.asChief('/dashboard/tiles', { method: 'POST', body });
  assert.equal(made.status, 201, JSON.stringify(made.data));
  const ok = await srv.api(`/dashboard/tiles/${made.data.id}/approve`, { method: 'POST', body: { approve: true } });
  assert.equal(ok.status, 200, JSON.stringify(ok.data));
  return made.data;
}

test('a tile takes confirm: off, on or always; null stops it; the Board hands it to the apps', async () => {
  const bot = await makeBot(srv, { name: 'Home Keeper', emoji: '🏠' });
  const made = { data: await onBoard({ ...tvSwitch(bot.id), confirm: 'off' }) };
  assert.equal(made.data.confirm, 'off');
  const board = (await srv.api('/dashboard')).data;
  assert.equal(board.tiles.find((x) => x.id === made.data.id).confirm, 'off');

  const bad = await srv.asChief(`/dashboard/tiles/${made.data.id}`, { method: 'PUT', body: { confirm: 'maybe' } });
  assert.equal(bad.status, 400);
  assert.equal(bad.data.error, 'confirm is one of off, on, always (or null to stop asking)');
  const button = await srv.asChief('/dashboard/tiles', { method: 'POST', body: { kind: 'note', title: 'Hello', confirm: 'off' } });
  assert.equal(button.data.error, 'confirm "on" or "off" is for a switch; use "always"');

  const off = await srv.asChief(`/dashboard/tiles/${made.data.id}`, { method: 'PUT', body: { confirm: null } });
  assert.equal(off.status, 200, JSON.stringify(off.data));
  assert.equal('confirm' in (await srv.api('/dashboard')).data.tiles.find((x) => x.id === made.data.id), false);
  await srv.asChief(`/dashboard/tiles/${made.data.id}`, { method: 'DELETE' });

  assert.ok(TOOLS.find((x) => x.name === 'add_tile').inputSchema.properties.confirm, "add_tile's confirm");
});

test("a bot changes its own tile with change_tile, in a run the owner started, and suggest_tile points there", async (t) => {
  const bot = await makeBot(srv, { name: 'Home Assistant A', emoji: '🏡' });
  const tile = await onBoard(tvSwitch(bot.id));
  const { rec, token } = await heldRun(srv, bot, 'make sure that when turning it off it will ask are you sure');
  t.after(() => { srv.unhold(); srv.release(rec); });

  // The bot's tools: change_tile beside suggest_tile, and its prompt says to use it.
  assert.equal(rec.self.env.SELF_SUGGEST, '1');
  assert.match(rec.system, /Your tiles already there: "TV i Shield"\. When the owner asks to change one of your tiles \(ask before turning it off, rename it, another light\), change it with change_tile; never suggest it again\./);

  // Suggesting it again names the tile and the tool.
  const again = await self(srv, token, 'suggest', { tile: { ...tvSwitch(bot.id), confirm: 'off' }, reason: 'Asked to confirm.' });
  assert.equal(again.data.error, `Your tile "TV i Shield" (${tile.id}) is already on the Board. Change it with change_tile instead.`);

  const nope = await self(srv, token, 'change-tile', { tile: 'Lamp', changes: { confirm: 'off' } });
  assert.equal(nope.data.error, `No tile of yours called "Lamp". Yours: "TV i Shield" (${tile.id}).`);
  assert.equal((await self(srv, token, 'change-tile', { tile: 'TV i Shield', changes: {} })).data.error, 'Say what changes, e.g. { "confirm": "off" }.');

  const done = await self(srv, token, 'change-tile', { tile: 'tv i shield', changes: { confirm: 'off', bot: 'someone-else' } });
  assert.equal(done.status, 200, JSON.stringify(done.data));
  assert.deepEqual(done.data, { ok: true, id: tile.id, waits: false });
  const now = (await srv.api('/dashboard')).data.tiles.find((x) => x.id === tile.id);
  assert.equal(now.confirm, 'off');
  assert.equal(now.bot, bot.id, 'it stays its tile');
  assert.equal(now.approved, true);

  // A changed script waits for the owner beside the tile, which works on as it was.
  const script = await self(srv, token, 'change-tile', { tile: tile.id, changes: { turnOff: { type: 'script', script: 'echo off' } } });
  assert.deepEqual(script.data, { ok: true, id: tile.id, waits: true });
  const waiting = (await srv.api('/dashboard')).data.tiles.find((x) => x.id === tile.id);
  assert.equal(waiting.approved, true);
  assert.ok(waiting.change, 'the change waits beside it');

  // Another bot's tile, or the Chief's, is not its to change.
  const other = await makeBot(srv, { name: 'Other', emoji: '🔧' });
  const theirs = await onBoard({ ...tvSwitch(other.id), title: 'Their TV' });
  assert.match((await self(srv, token, 'change-tile', { tile: theirs.id, changes: { confirm: 'off' } })).data.error, /^No tile of yours called/);
});

test('web and Android ask before a tap of a tile with confirm', () => {
  const web = fs.readFileSync(path.join(ROOT, 'public/board.js'), 'utf8');
  assert.match(web, /const sure = tileAsksFirst\(t, tap, on\);\n  if \(sure && !\(await askFirst\(sure\.question, sure\.yes, \{ danger: sure\.danger \}\)\)\) return;\n  if \(tap === 'toggle'\)/, 'asked before the switch moves');
  const kt = fs.readFileSync(path.join(ROOT, 'android/app/src/main/java/dev/botdot/app/ui/DashboardScreen.kt'), 'utf8');
  assert.match(kt, /if \(!asked && tileAsksFirst\(t\.confirm, how, on\)\) \{ sure = t to on; return \}/);
  // The question as the web page asks it.
  const vm = require('vm');
  const fn = web.slice(web.indexOf('function tileAsksFirst'), web.indexOf('async function tapTile'));
  const ctx = { tr: (s, v = {}) => s.replace(/\{(\w+)\}/g, (_, k) => v[k]) };
  vm.runInNewContext(`${fn}; this.ask = tileAsksFirst;`, ctx);
  const tv = { title: 'TV', confirm: 'off' };
  const plain = (x) => JSON.parse(JSON.stringify(x));
  assert.deepEqual(plain(ctx.ask(tv, 'toggle', false)), { question: 'Turn off “TV”?', yes: 'Turn off', danger: true });
  assert.equal(ctx.ask(tv, 'toggle', true), null, 'turning on asks nothing');
  assert.equal(ctx.ask({ title: 'TV' }, 'toggle', false), null);
  assert.deepEqual(plain(ctx.ask({ title: 'Gate', confirm: 'always' }, 'act', null)), { question: 'Gate?', yes: 'OK', danger: false });
  assert.equal(ctx.ask({ title: 'Gate', confirm: 'always' }, 'panel', null), null);
});
