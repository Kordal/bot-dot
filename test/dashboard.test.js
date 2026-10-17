// The dashboard (lib/dashboard.js): tiles the Chief adds, their values read with a saved login,
// taps, scripts waiting for the owner's OK, and bots filling their own tiles.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { pickValue, parseOutput, shape } = require('../lib/dashboard');
const blocks = require('../lib/tile-blocks');
const { startServer, makeBot, feed, waitFor, heldRun, self } = require('./helpers');

test('pick gets a value out of an answer', () => {
  const ha = { state: 'on', attributes: { brightness: 180 }, list: [{ summary: 'Dentist' }, { summary: 'Gym' }] };
  assert.equal(pickValue(ha, 'state'), 'on');
  assert.equal(pickValue(ha, 'attributes.brightness'), 180);
  assert.deepEqual(pickValue(ha, 'list[].summary'), ['Dentist', 'Gym']);
  assert.equal(pickValue(ha, 'list[1].summary'), 'Gym');
  assert.deepEqual(pickValue([{ entity_id: 'a' }, { entity_id: 'b' }], '[].entity_id'), ['a', 'b']);
  assert.equal(pickValue(ha, 'nothing.here'), undefined);
  assert.equal(parseOutput('  72\n', ''), 72);
  assert.equal(parseOutput('plain text', ''), 'plain text');
});

test('a value is shaped for its tile', () => {
  assert.equal(shape({ kind: 'switch' }, 'on'), true);
  assert.equal(shape({ kind: 'switch' }, 'off'), false);
  assert.equal(shape({ kind: 'switch' }, 'unavailable'), null);
  assert.equal(shape({ kind: 'switch', onValue: 'heat' }, 'heat'), true);
  assert.deepEqual(shape({ kind: 'value', levels: { warn: 80, bad: 95 } }, 90), { text: '90', level: 'warn' });
  assert.deepEqual(shape({ kind: 'value', levels: { warn: 20, bad: 10 } }, '8'), { text: '8', level: 'bad' });
  assert.deepEqual(shape({ kind: 'value' }, 'Sunny'), { text: 'Sunny', level: null });
  assert.deepEqual(shape({ kind: 'list' }, 'a\n\nb'), ['a', 'b']);
  assert.equal(shape({ kind: 'list' }, Array.from({ length: 20 }, (_, i) => `x${i}`)).length, 8);
});

// A stand-in Home Assistant: a light, a colour LED, a door camera, and the token it wants.
let srv, ha, light = 'off', brightness = 0, calls = [];
const led = { state: 'off', brightness: null, rgb: null };
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da6364f8ffbf1e000506027f6e8b6f0e0000000049454e44ae426082', 'hex');
before(async () => {
  srv = await startServer();
  ha = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      calls.push({ method: req.method, url: req.url, auth: req.headers.authorization, body });
      if (req.headers.authorization !== 'Bearer ha-secret-token') { res.writeHead(401); return res.end('{"message":"Unauthorized"}'); }
      if (req.url === '/api/states/light.led') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ entity_id: 'light.led', state: led.state, attributes: { brightness: led.brightness, rgb_color: led.rgb } })); }
      if (req.url === '/api/camera_proxy/camera.door') { res.writeHead(200, { 'Content-Type': 'image/png' }); return res.end(PNG); }
      const ledCall = req.url.match(/^\/api\/services\/light\/turn_(on|off)$/) && JSON.parse(body || '{}');
      if (ledCall?.entity_id === 'light.led') {
        led.state = req.url.endsWith('turn_on') ? 'on' : 'off';
        if (led.state === 'off') Object.assign(led, { brightness: null, rgb: null });
        else Object.assign(led, { brightness: ledCall.brightness ?? led.brightness ?? 255, rgb: ledCall.rgb_color ?? led.rgb ?? [255, 255, 255] });
        res.writeHead(200); return res.end('[]');
      }
      if (req.url === '/api/states/light.living_room') { res.writeHead(200, { 'Content-Type': 'application/json' }); return res.end(JSON.stringify({ entity_id: 'light.living_room', state: light, attributes: { brightness_pct: brightness }, token: 'ha-secret-token' })); }
      const m = req.url.match(/^\/api\/services\/light\/turn_(on|off)$/);
      if (m && req.method === 'POST') {
        light = m[1];
        const step = Number(JSON.parse(body || '{}').brightness_step_pct) || 0;
        brightness = light === 'off' ? 0 : Math.min(Math.max(brightness + step, 0), 100);
        res.writeHead(200); return res.end('[]');
      }
      res.writeHead(404); res.end('{}');
    });
  });
  await new Promise((r) => ha.listen(0, '127.0.0.1', r));
});
after(() => { ha.close(); return srv.stop(); });

const haUrl = (p) => `http://127.0.0.1:${ha.address().port}${p}`;
const auth = { Authorization: 'Bearer {{password}}' };
const lightTile = (bot) => ({
  kind: 'switch', title: 'Living room light', section: 'Home', bot: bot.id,
  read: { type: 'http', login: 'Home Assistant', url: haUrl('/api/states/light.living_room'), headers: auth, pick: 'state' },
  turnOn: { type: 'http', login: 'Home Assistant', method: 'POST', url: haUrl('/api/services/light/turn_on'), headers: auth, body: { entity_id: 'light.living_room' } },
  turnOff: { type: 'http', login: 'Home Assistant', method: 'POST', url: haUrl('/api/services/light/turn_off'), headers: auth, body: { entity_id: 'light.living_room' } },
});

test('the Chief adds a light switch; the owner sees it and switches it', async () => {
  const bot = await makeBot(srv, { name: 'Home Keeper' });
  const login = await srv.api('/vault', { method: 'POST', body: { name: 'Home Assistant', site: '127.0.0.1', username: '', password: 'ha-secret-token', allowedBots: [bot.id] } });
  assert.equal(login.status, 201, JSON.stringify(login.data));

  const tried = await srv.asChief('/dashboard/test', { method: 'POST', body: { bot: bot.id, kind: 'switch', read: lightTile(bot).read } });
  assert.equal(tried.data.shows, false, JSON.stringify(tried.data));
  assert.ok(!tried.data.answer.includes('ha-secret-token'), 'the token never comes back');

  const added = await srv.asChief('/dashboard/tiles', { method: 'POST', body: lightTile(bot) });
  assert.equal(added.status, 201, JSON.stringify(added.data));
  assert.equal(added.data.approved, true, 'no script: on straight away');

  const f = feed(srv);
  await f.wait('hello');
  const d = await srv.api('/dashboard/refresh', { method: 'POST' });
  assert.deepEqual(d.data.sections, ['Home']);
  assert.equal(d.data.tiles.length, 1);
  assert.equal(d.data.tiles[0].read, undefined, "the owner's view leaves the requests out");
  await f.wait('dashboard', (x) => x.tile?.id === added.data.id && x.tile.value === false);

  // Only the owner taps.
  assert.equal((await srv.asChief(`/dashboard/tiles/${added.data.id}/tap`, { method: 'POST', body: {} })).status, 403);
  const tapped = await srv.api(`/dashboard/tiles/${added.data.id}/tap`, { method: 'POST', body: { on: true } });
  assert.equal(tapped.status, 200, JSON.stringify(tapped.data));
  assert.equal(tapped.data.value, true);
  assert.equal(light, 'on');
  const on = calls.find((c) => c.url.endsWith('/turn_on'));
  assert.equal(on.auth, 'Bearer ha-secret-token');
  assert.deepEqual(JSON.parse(on.body), { entity_id: 'light.living_room' });
  await f.wait('dashboard', (x) => x.tile?.id === added.data.id && x.tile.value === true);
  f.close();

  // Long-press → Remove.
  assert.equal((await srv.api(`/dashboard/tiles/${added.data.id}`, { method: 'DELETE' })).data.ok, true);
  assert.equal((await srv.api('/dashboard')).data.tiles.length, 0);
});

test('a tap reads again the other tiles showing the same light', async () => {
  const bot = await makeBot(srv, { name: 'Light Keeper' });
  await srv.api('/vault', { method: 'POST', body: { name: 'Home Assistant', site: '127.0.0.1', username: '', password: 'ha-secret-token', allowedBots: [bot.id] } });
  const level = await srv.asChief('/dashboard/tiles', { method: 'POST', body: {
    kind: 'value', title: 'LED brightness', section: 'Living room', bot: bot.id, unit: '%', every: 3600,
    read: { ...lightTile(bot).read, pick: 'attributes.brightness_pct' },
  } });
  const brighter = await srv.asChief('/dashboard/tiles', { method: 'POST', body: {
    kind: 'button', title: 'LED brighter', section: 'Living room', bot: bot.id,
    do: { ...lightTile(bot).turnOn, body: { entity_id: 'light.living_room', brightness_step_pct: 25 } },
  } });
  assert.equal(brighter.status, 201, JSON.stringify(brighter.data));
  light = 'off'; brightness = 0;
  await srv.api('/dashboard/refresh', { method: 'POST' });
  const f = feed(srv);
  await f.wait('hello');
  await waitFor(async () => (await srv.api('/dashboard?quiet')).data.tiles.find((t) => t.id === level.data.id).value?.text === '0');

  assert.equal((await srv.api(`/dashboard/tiles/${brighter.data.id}/tap`, { method: 'POST', body: {} })).status, 200);
  await f.wait('dashboard', (x) => x.tile?.id === level.data.id && x.tile.value?.text === '25');
  f.close();
  for (const t of [level, brighter]) await srv.api(`/dashboard/tiles/${t.data.id}`, { method: 'DELETE' });
});

test("a login the tile's bot may not use doesn't work", async () => {
  const other = await makeBot(srv, { name: 'Stranger' });
  const r = await srv.asChief('/dashboard/test', { method: 'POST', body: { bot: other.id, read: lightTile(other).read } });
  assert.ok(r.data.error, 'refused');
});

test('a script tile waits for the owner; then it runs as its bot', async () => {
  const bot = await makeBot(srv, { name: 'Disk Watcher' });
  const t = await srv.asChief('/dashboard/tiles', { method: 'POST', body: { kind: 'value', title: 'Disk', bot: bot.id, unit: '%', levels: { warn: 80, bad: 95 }, read: { type: 'script', script: 'echo 91' } } });
  assert.equal(t.data.approved, false);
  const d = await srv.api('/dashboard');
  assert.equal(d.data.pending.length, 1);
  assert.equal(d.data.pending[0].read.script, 'echo 91', 'the approval shows the script');
  assert.deepEqual(d.data.pending[0].scripts, ['echo 91'], 'and has every script of the tile as a string');
  const f = feed(srv);
  await f.wait('hello');
  assert.equal((await srv.api(`/dashboard/tiles/${t.data.id}/tap`, { method: 'POST', body: {} })).status, 400, "it doesn't run before the OK");
  assert.equal((await srv.asChief(`/dashboard/tiles/${t.data.id}/approve`, { method: 'POST', body: { approve: true } })).status, 403, 'the Chief never approves');
  await srv.api(`/dashboard/tiles/${t.data.id}/approve`, { method: 'POST', body: { approve: true } });
  const ev = await f.wait('dashboard', (x) => x.tile?.id === t.data.id && x.tile.value);
  assert.deepEqual(ev.data.tile.value, { text: '91', level: 'warn' });
  f.close();

  // A changed script needs the OK again; a new title doesn't. The change waits beside the approved tile (ADR 013).
  const tile = `/dashboard/tiles/${t.data.id}`;
  const only = async () => { const b = (await srv.api('/dashboard')).data; return { tile: b.tiles.find((x) => x.id === t.data.id), pending: b.pending.find((x) => x.id === t.data.id) }; };
  assert.equal((await srv.asChief(tile, { method: 'PUT', body: { title: 'Disk use' } })).data.approved, true);
  const changed = await srv.asChief(tile, { method: 'PUT', body: { read: { type: 'script', script: 'echo 12' } } });
  assert.deepEqual([changed.data.approved, changed.data.read.script, changed.data.change.scripts, changed.data.change.by, changed.data.no, changed.data.yes], [true, 'echo 91', ['echo 12'], 'chief', 'Keep as it is', 'Approve the change'], 'the tile stays approved, with the change beside it');
  let now = await only();
  assert.deepEqual([now.tile.change.scripts, now.pending.scripts, now.pending.change.scripts, now.pending.no], [['echo 12'], ['echo 91'], ['echo 12'], 'Keep as it is'], 'it is on the Board and among what waits, there with the approved scripts');
  await srv.api('/dashboard/refresh', { method: 'POST' });
  await srv.api(`${tile}/tap`, { method: 'POST', body: {} });
  assert.deepEqual((await only()).tile.value, { text: '91', level: 'warn' }, 'it reads with the approved script until the answer');
  // A second change replaces the first; the no keeps the tile and removes nothing.
  await srv.asChief(tile, { method: 'PUT', body: { read: { type: 'script', script: 'echo 13' } } });
  assert.deepEqual((await only()).tile.change.scripts, ['echo 13']);
  const kept = await srv.api(`${tile}/approve`, { method: 'POST', body: { approve: false } });
  assert.deepEqual(kept.data, { ok: true, kept: true, text: 'Kept as it was: Disk use' });
  now = await only();
  assert.deepEqual([now.tile.approved, now.tile.change, now.pending], [true, undefined, undefined], 'the no keeps the approved tile');
  assert.deepEqual((await srv.api(`${tile}/approve`, { method: 'POST', body: { approve: false } })).data.kept, true, 'a no from a card that is out of date removes nothing either');
  assert.ok((await only()).tile);
  // The yes puts the change in the approved one's place. The owner's own change of the script is approved at once.
  await srv.asChief(tile, { method: 'PUT', body: { read: { type: 'script', script: 'echo 12' } } });
  // What is changed meanwhile without touching a script is made at once, and the yes does not take it back.
  const renamed = await srv.api(tile, { method: 'PUT', body: { title: 'Disk space', color: '#112233' } });
  assert.deepEqual([renamed.data.title, renamed.data.color, renamed.data.read.script, renamed.data.change.title, renamed.data.change.scripts], ['Disk space', '#112233', 'echo 91', 'Disk space', ['echo 12']]);
  const yes = await srv.api(`${tile}/approve`, { method: 'POST', body: { approve: true } });
  assert.deepEqual(yes.data, { ok: true, text: 'Changed: Disk space' });
  await waitFor(async () => (await only()).tile.value?.text === '12', { what: 'the tile to read with the changed script' });
  now = await only();
  assert.deepEqual([now.tile.change, now.tile.title, now.tile.color], [undefined, 'Disk space', '#112233']);
  await srv.asChief(tile, { method: 'PUT', body: { read: { type: 'script', script: 'echo 14' } } });
  const mine = await srv.api(tile, { method: 'PUT', body: { read: { type: 'script', script: 'echo 15' } } });
  assert.deepEqual([mine.data.approved, mine.data.read.script, mine.data.change], [true, 'echo 15', undefined], "the owner's own edit is approved and drops the waiting change");
  const audit = fs.readFileSync(path.join(srv.data, 'audit.log'), 'utf8').trim().split('\n').map((l) => JSON.parse(l).action).filter((a) => a.startsWith('tile.'));
  assert.deepEqual(audit.slice(-3), ['tile.approved', 'tile.declined', 'tile.approved'], 'each answer on a script is in the audit log, as a new tile\'s is');
  await srv.api(tile, { method: 'DELETE' });
});

test('a bot fills its own tile; the Chief arranges headings', async () => {
  const bot = await makeBot(srv, { name: 'Morning Brief' });
  const note = await srv.asChief('/dashboard/tiles', { method: 'POST', body: { kind: 'note', title: 'Today', section: 'Me', bot: bot.id, wide: true } });
  await srv.asChief('/dashboard/tiles', { method: 'POST', body: { kind: 'value', title: 'Mood', section: 'Home', value: 'Sunny' } });
  const r = await srv.api(`/bots/${bot.id}/run`, { method: 'POST', body: { prompt: 'brief' } });
  const run = await srv.nextRun((x) => x.system?.includes('"Today" (note)'), 'a run told about its tile');
  assert.ok(run);
  await srv.finished(r.data.id);
  await srv.asChief('/dashboard/tiles/' + note.data.id + '/value', { method: 'PUT', body: { value: 'Rain at 3.' } });
  let d = await srv.api('/dashboard');
  assert.equal(d.data.tiles.find((t) => t.id === note.data.id).value, 'Rain at 3.');
  await srv.asChief('/dashboard/layout', { method: 'PUT', body: { sections: ['Home', 'Me'], rename: { from: 'Me', to: 'Today' } } });
  d = await srv.api('/dashboard');
  assert.deepEqual(d.data.sections, ['Home', 'Today']);
  await waitFor(async () => (await srv.api(`/bots/${bot.id}`, { method: 'DELETE' })).data.ok);
  d = await srv.api('/dashboard');
  assert.equal(d.data.tiles.length, 1, "a deleted bot's tiles go with it");
});

test("a bot suggests a tile; Add puts it on, ✕ means not again", async () => {
  const bot = await makeBot(srv, { name: 'Light Keeper', emoji: '💡' });
  await srv.api('/vault', { method: 'POST', body: { name: 'HA Keeper', site: '127.0.0.1', username: '', password: 'ha-secret-token', allowedBots: [bot.id] } });
  const { rec, token } = await heldRun(srv, bot);
  assert.ok(rec.system.includes('suggest_tile'), 'bots are told they can suggest tiles');
  assert.equal(rec.self.env.SELF_SUGGEST, '1');
  const tile = { ...lightTile(bot), section: 'Home' };
  for (const k of ['read', 'turnOn', 'turnOff']) tile[k] = { ...tile[k], login: 'HA Keeper' };
  delete tile.bot;

  assert.equal((await self(srv, token, 'suggest', { tile, reason: '' })).data.ok, false, 'it says why');
  const other = { ...tile, read: { ...tile.read, login: 'Home Assistant' } }; // a login it may not use
  assert.equal((await self(srv, token, 'suggest', { tile: other, reason: 'You ask a lot' })).data.ok, false);
  const r = await self(srv, token, 'suggest', { tile, reason: 'You asked me to switch it 5 times' });
  assert.equal(r.data.ok, true, JSON.stringify(r.data));
  assert.equal((await self(srv, token, 'suggest', { tile, reason: 'again' })).data.ok, false, 'not twice');

  let d = await srv.api('/dashboard?quiet');
  assert.equal(d.data.suggestions.length, 1);
  assert.equal(d.data.suggestions[0].bot, bot.id);
  assert.equal(d.data.tiles.some((t) => t.title === 'Living room light'), false, 'not a tile until you add it');
  assert.equal((await srv.asChief(`/dashboard/suggestions/${r.data.id}`, { method: 'POST', body: { add: true } })).status, 403, 'only the owner adds it');

  const added = await srv.api(`/dashboard/suggestions/${r.data.id}`, { method: 'POST', body: { add: true } });
  assert.equal(added.data.tile.approved, true);
  assert.equal(added.data.tile.createdBy, 'bot');
  d = await srv.api('/dashboard?quiet');
  assert.equal(d.data.suggestions.length, 0);
  assert.ok(d.data.tiles.some((t) => t.id === added.data.tile.id));
  assert.equal((await self(srv, token, 'suggest', { tile, reason: 'again' })).data.ok, false, "it's already there");

  // ✕: that bot doesn't suggest it again.
  const btn = { kind: 'button', title: 'All lights off', do: { type: 'bot', message: 'Switch every light off' } };
  const s2 = await self(srv, token, 'suggest', { tile: btn, reason: 'Every evening you ask' });
  assert.equal(s2.data.ok, true, JSON.stringify(s2.data));
  await srv.api(`/dashboard/suggestions/${s2.data.id}`, { method: 'POST', body: { add: false } });
  const again = await self(srv, token, 'suggest', { tile: btn, reason: 'Every evening you ask' });
  assert.match(again.data.error, /said no/);
  srv.unhold();
  srv.release(rec);
  await srv.api(`/dashboard/tiles/${added.data.tile.id}`, { method: 'DELETE' });
});

test('at most three suggestions wait at once', async () => {
  const bot = await makeBot(srv, { name: 'Eager', emoji: '🙋' });
  const { rec, token } = await heldRun(srv, bot);
  for (let i = 1; i <= 3; i++) assert.equal((await self(srv, token, 'suggest', { tile: { kind: 'note', title: `Note ${i}` }, reason: 'why not' })).data.ok, true);
  assert.match((await self(srv, token, 'suggest', { tile: { kind: 'note', title: 'Note 4' }, reason: 'why not' })).data.error, /already wait/);
  srv.unhold();
  srv.release(rec);
  await waitFor(async () => (await srv.api(`/bots/${bot.id}`, { method: 'DELETE' })).data.ok);
  assert.equal((await srv.api('/dashboard?quiet')).data.suggestions.length, 0, "a deleted bot's suggestions go too");
});

test('the memory review looks for tiles to suggest', async () => {
  const bot = await makeBot(srv, { name: 'Reviewed', emoji: '🧽' });
  const r = await srv.api(`/memory/review/${bot.id}`, { method: 'POST' });
  const rec = await srv.nextRun((x) => x.stdin.includes('memory review'), 'the review run');
  assert.match(rec.stdin, /suggest a tile for it with suggest_tile/);
  assert.match(rec.stdin, /<api-calls>/);
  assert.equal(rec.self.env.SELF_SUGGEST, '1', 'it can suggest from the review');
  await srv.finished(r.data.run.id);
});

test('tiles go into a group; removing it keeps them, or takes them along', async () => {
  const g = await srv.asChief('/dashboard/tiles', { method: 'POST', body: { kind: 'group', title: 'Lights', section: 'Home' } });
  assert.equal(g.status, 201, JSON.stringify(g.data));
  const a = await srv.asChief('/dashboard/tiles', { method: 'POST', body: { kind: 'note', title: 'Hall', parent: g.data.id, value: 'on' } });
  assert.equal(a.data.parent, g.data.id);
  assert.equal(a.data.section, 'Home', "it sits under its group's heading");
  const b = await srv.asChief('/dashboard/tiles', { method: 'POST', body: { kind: 'note', title: 'Porch' } });
  assert.equal((await srv.asChief(`/dashboard/tiles/${b.data.id}`, { method: 'PUT', body: { parent: g.data.id } })).data.parent, g.data.id);
  assert.match((await srv.asChief('/dashboard/tiles', { method: 'POST', body: { kind: 'group', title: 'Inner', parent: g.data.id } })).data.error, /another group/);
  assert.match((await srv.asChief('/dashboard/tiles', { method: 'POST', body: { kind: 'note', title: 'Nowhere', parent: 't_nope' } })).data.error, /No group/);
  assert.equal((await srv.asChief(`/dashboard/tiles/${g.data.id}`, { method: 'PUT', body: { section: 'Upstairs' } })).status, 200);
  let d = await srv.api('/dashboard?quiet');
  assert.equal(d.data.tiles.find((t) => t.id === a.data.id).section, 'Upstairs', 'its tiles move with it');

  await srv.api(`/dashboard/tiles/${g.data.id}`, { method: 'DELETE' });
  d = await srv.api('/dashboard?quiet');
  assert.equal(d.data.tiles.find((t) => t.id === a.data.id).parent, null, 'its tiles stay, loose');
  const g2 = await srv.asChief('/dashboard/tiles', { method: 'POST', body: { kind: 'group', title: 'Lights 2' } });
  await srv.asChief(`/dashboard/tiles/${a.data.id}`, { method: 'PUT', body: { parent: g2.data.id } });
  await srv.api(`/dashboard/tiles/${g2.data.id}?all`, { method: 'DELETE' });
  d = await srv.api('/dashboard?quiet');
  assert.equal(d.data.tiles.some((t) => t.id === a.data.id || t.id === g2.data.id), false, 'or they go with it');
  await srv.api(`/dashboard/tiles/${b.data.id}`, { method: 'DELETE' });
});

test('dragging a tile: another place, another heading, into a group and out', async () => {
  const mk = async (body) => (await srv.asChief('/dashboard/tiles', { method: 'POST', body: { kind: 'note', ...body } })).data;
  const a = await mk({ title: 'A', section: 'One' });
  const b = await mk({ title: 'B', section: 'One' });
  const g = await mk({ kind: 'group', title: 'G', section: 'Two' });
  const order = async () => (await srv.api('/dashboard?quiet')).data.tiles.filter((t) => ['A', 'B', 'G'].includes(t.title)).map((t) => `${t.title}:${t.section}:${t.parent ? 'in' : ''}`);
  await srv.api(`/dashboard/tiles/${b.id}/move`, { method: 'POST', body: { section: 'One', before: a.id } });
  assert.deepEqual(await order(), ['B:One:', 'A:One:', 'G:Two:']);
  await srv.api(`/dashboard/tiles/${a.id}/move`, { method: 'POST', body: { section: 'Two', before: g.id } });
  assert.deepEqual(await order(), ['B:One:', 'A:Two:', 'G:Two:']);
  await srv.api(`/dashboard/tiles/${b.id}/move`, { method: 'POST', body: { parent: g.id } });
  assert.deepEqual(await order(), ['A:Two:', 'G:Two:', 'B:Two:in']);
  assert.equal((await srv.api(`/dashboard/tiles/${g.id}/move`, { method: 'POST', body: { parent: g.id } })).status, 400, 'a group stays out of groups');
  await srv.api(`/dashboard/tiles/${b.id}/move`, { method: 'POST', body: { section: 'One' } });
  assert.deepEqual(await order(), ['B:One:', 'A:Two:', 'G:Two:']);
  for (const t of [a, b, g]) await srv.api(`/dashboard/tiles/${t.id}`, { method: 'DELETE' });
});

test('blocks are checked, and filled in with the data', () => {
  const t = { id: 't1', kind: 'custom', read: { type: 'http' }, reads: { forecast: { type: 'http' }, cam: { type: 'http', image: true } }, actions: { power: {}, level: {}, tint: {}, mode: {} } };
  const bad = (look, re) => assert.throws(() => blocks.check(look, t), re);
  bad({ face: [{ type: 'sparkles' }] }, /type must be one of/);
  bad({ face: [{ type: 'slider', bind: 'value.x', action: 'nope' }] }, /no action "nope"/);
  bad({ face: [{ type: 'text', text: '{{weather.now}}' }] }, /must start with "value" or "forecast"/);
  bad({ face: [{ type: 'text', text: '{{value|sparkle}}' }] }, /unknown filter/);
  bad({ face: [{ type: 'image', read: 'forecast' }] }, /image/);
  bad({ face: [{ type: 'row', blocks: [{ type: 'row', blocks: [{ type: 'row', blocks: [{ type: 'text', text: 'deep' }] }] }] }] }, /deep/);
  bad({ face: Array.from({ length: 41 }, () => ({ type: 'text', text: 'x' })) }, /at most 40/);
  bad({ tap: 'panel' }, /needs a panel/);
  bad({ tap: 'dance' }, /tap is/);

  Object.assign(t, blocks.check({
    dot: { on: 'value.state', color: '{{value.attributes.rgb_color}}' },
    face: [
      { type: 'value', text: '{{value.attributes.brightness|percent:255}}', unit: '%', rules: [{ when: 'value.state', is: 'off', set: { text: 'Off' } }] },
      { type: 'text', text: 'Tomorrow {{forecast.0.temp|round:1}}°', rules: [{ when: 'forecast', empty: true, set: { hidden: true } }] },
      { type: 'gauge', bind: 'value.attributes.brightness', max: 255, rules: [{ when: 'value.attributes.brightness', above: 200, set: { color: 'warn' } }] },
      { type: 'chart', bind: 'value.attributes.brightness' },
      { type: 'image', read: 'cam' },
    ],
    panel: [
      { type: 'switch', on: 'value.state', action: 'power' },
      { type: 'row', blocks: [{ type: 'slider', bind: 'value.attributes.brightness', min: 0, max: 255, step: 5, action: 'level' }, { type: 'color', bind: 'value.attributes.rgb_color', action: 'tint' }] },
      { type: 'choice', options: ['Relax', { label: 'Read', value: 'read' }], bind: 'value.attributes.mode', action: 'mode' },
    ],
  }, t));
  const on = blocks.look(t, { data: { value: { state: 'on', attributes: { brightness: 230, rgb_color: [255, 128, 0], mode: 'READ' } }, forecast: [{ temp: 17.26 }] }, history: { 'value.attributes.brightness': [10, 20, 30] } });
  assert.deepEqual(on.dot, { filled: true, color: '#ff8000' });
  assert.deepEqual(on.face[0], { type: 'value', text: '90', unit: '%' });
  assert.equal(on.face[1].text, 'Tomorrow 17.3°');
  assert.equal(on.face[2].color, 'warn');
  assert.deepEqual(on.face[3].points, [10, 20, 30]);
  assert.match(on.face[4].src, /^\/dashboard\/tiles\/t1\/image\/cam\?v=/);
  assert.equal(on.tap, 'panel', 'a panel: a tap opens it');
  assert.equal(on.short, '90 %');
  assert.deepEqual(on.panel[0], { type: 'switch', key: 'p0', on: true });
  assert.deepEqual(on.panel[1].blocks.map((b) => [b.key, b.value]), [['p1.0', 230], ['p1.1', '#ff8000']]);
  assert.equal(on.panel[2].value, 'read', 'the current choice, whatever its case');

  const off = blocks.look(t, { data: { value: { state: 'off', attributes: { brightness: null, rgb_color: null } } } });
  assert.deepEqual(off.dot, { filled: false }, "off: hollow, in the tile's colour");
  assert.equal(off.face[0].text, 'Off');
  assert.equal(off.face.some((b) => b.type === 'text'), false, 'a rule hid the forecast');
  assert.equal(off.panel[1].blocks[0].value, null);

  // What the owner picks is checked against the control, and fills in its action.
  assert.deepEqual(blocks.control(t, 'p1.0', 999), { action: 'level', vars: { value: 255 }, bind: 'value.attributes.brightness', value: 255 });
  assert.equal(blocks.control(t, 'p1.0', 122).value, 120, 'to its step');
  assert.deepEqual(blocks.control(t, 'p1.1', '#00FF00').vars, { value: '#00ff00', rgb: [0, 255, 0] });
  assert.deepEqual(blocks.control(t, 'p0', false).vars, { value: false, onoff: 'off' });
  assert.throws(() => blocks.control(t, 'p2', 'party'), /options/);
  assert.throws(() => blocks.control(t, 'p1.1', 'red; rm -rf'), /colour/);
  assert.throws(() => blocks.control(t, 'f0', 1), /gone/, 'not a control');
  const src = blocks.fillSource({ type: 'http', url: 'http://ha/api/services/light/turn_{{onoff}}', body: { rgb_color: '{{rgb}}', brightness: '{{value}}', note: 'set to {{value}}' } }, { value: 120, onoff: 'on', rgb: [1, 2, 3] });
  assert.equal(src.url, 'http://ha/api/services/light/turn_on');
  assert.deepEqual(src.body, { rgb_color: [1, 2, 3], brightness: 120, note: 'set to 120' }, 'a field that is only a placeholder keeps its type');
});

test('one LED tile: its colour on the dot, and a pop-up with on/off, brightness and a colour wheel', async () => {
  const bot = await makeBot(srv, { name: 'LED Keeper' });
  await srv.api('/vault', { method: 'POST', body: { name: 'Home Assistant', site: '127.0.0.1', username: '', password: 'ha-secret-token', allowedBots: [bot.id] } });
  const call = (service, body) => ({ type: 'http', login: 'Home Assistant', method: 'POST', url: haUrl(`/api/services/light/${service}`), headers: auth, body });
  const tile = {
    kind: 'custom', title: 'LED', section: 'Home', bot: bot.id, size: 'wide',
    read: { type: 'http', login: 'Home Assistant', url: haUrl('/api/states/light.led'), headers: auth },
    actions: {
      power: call('turn_{{onoff}}', { entity_id: 'light.led' }),
      brightness: call('turn_on', { entity_id: 'light.led', brightness: '{{value}}' }),
      colour: call('turn_on', { entity_id: 'light.led', rgb_color: '{{rgb}}' }),
    },
    dot: { on: 'value.state', color: '{{value.attributes.rgb_color}}', big: true },
    panel: [
      { type: 'switch', on: 'value.state', action: 'power', label: 'On' },
      { type: 'slider', bind: 'value.attributes.brightness', min: 1, max: 255, action: 'brightness' },
      { type: 'color', bind: 'value.attributes.rgb_color', action: 'colour' },
    ],
  };
  assert.match((await srv.asChief('/dashboard/tiles', { method: 'POST', body: { ...tile, actions: { ...tile.actions, power: { ...tile.actions.power, headers: { ...auth, X: '{{value}}' } } } } })).data.error, /not in a header/);
  const tried = await srv.asChief('/dashboard/test', { method: 'POST', body: tile });
  assert.deepEqual(tried.data.looks.panel[0], { type: 'switch', key: 'p0', on: false, label: 'On' }, JSON.stringify(tried.data));
  const added = await srv.asChief('/dashboard/tiles', { method: 'POST', body: tile });
  assert.equal(added.status, 201, JSON.stringify(added.data));
  assert.equal(added.data.size, 'wide');
  assert.equal(added.data.actions.colour.body.rgb_color, '{{rgb}}', 'the Chief sees it in full');
  const id = added.data.id;

  const f = feed(srv);
  await f.wait('hello');
  await srv.api('/dashboard/refresh', { method: 'POST' });
  await f.wait('dashboard', (x) => x.tile?.id === id && x.tile.look.dot.filled === false);
  const d = (await srv.api('/dashboard?quiet')).data.tiles.find((t) => t.id === id);
  assert.equal(d.actions, undefined, "the owner's view leaves the requests out");
  assert.equal(d.look.tap, 'panel');

  let r = await srv.api(`/dashboard/tiles/${id}/act`, { method: 'POST', body: { block: 'p0', value: true } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.look.panel[0].on, true, 'it shows at once');
  assert.equal(led.state, 'on');
  r = await srv.api(`/dashboard/tiles/${id}/act`, { method: 'POST', body: { block: 'p2', value: '#3366ff' } });
  assert.deepEqual(led.rgb, [51, 102, 255]);
  assert.deepEqual(JSON.parse(calls.at(-1).body), { entity_id: 'light.led', rgb_color: [51, 102, 255] });
  await srv.api(`/dashboard/tiles/${id}/act`, { method: 'POST', body: { block: 'p1', value: 128.4 } });
  assert.equal(led.brightness, 128);
  await f.wait('dashboard', (x) => x.tile?.id === id && x.tile.look.dot.color === '#3366ff' && x.tile.look.panel[1].value === 128);
  assert.equal((await srv.api(`/dashboard/tiles/${id}/act`, { method: 'POST', body: { block: 'p1', value: 'bright' } })).status, 400);
  assert.equal((await srv.asChief(`/dashboard/tiles/${id}/act`, { method: 'POST', body: { block: 'p0', value: false } })).status, 403, 'only the owner');
  f.close();
  await srv.api(`/dashboard/tiles/${id}`, { method: 'DELETE' });
});

test('a waiting tile has every script as a string: its read, a named read, a tap action and a named action', async () => {
  const bot = await makeBot(srv, { name: 'Fan Keeper' });
  const t = await srv.asChief('/dashboard/tiles', { method: 'POST', body: {
    kind: 'custom', title: 'Fan room', bot: bot.id,
    read: { type: 'script', script: 'echo main' },
    reads: { temp: { type: 'script', script: 'echo 21' }, door: { type: 'http', login: 'Home Assistant', url: haUrl('/api/states/light.living_room'), headers: auth, pick: 'state' } },
    do: { type: 'script', script: 'echo tapped' },
    actions: { speed: { type: 'script', script: '[ "$VALUE" = high ]' } },
    face: [{ type: 'value', bind: 'temp' }, { type: 'choice', options: ['low', 'high'], action: 'speed' }],
  } });
  assert.equal(t.status, 201, JSON.stringify(t.data));
  assert.equal(t.data.approved, false);
  const waiting = (await srv.api('/dashboard')).data.pending.find((x) => x.id === t.data.id);
  // In the order of a suggested tile's scripts: the read, the named reads, the tap actions, the named actions.
  assert.deepEqual(waiting.scripts, ['echo main', 'echo 21', 'echo tapped', '[ "$VALUE" = high ]']);
  assert.ok(waiting.scripts.every((x) => typeof x === 'string'));
  assert.equal(waiting.reads.temp.script, 'echo 21', 'the sources stay as they were');
  // The Chief reads the same list; a tile on the Board has no such field.
  assert.deepEqual((await srv.asChief('/dashboard')).data.pending.find((x) => x.id === t.data.id).scripts, waiting.scripts);
  await srv.api(`/dashboard/tiles/${t.data.id}/approve`, { method: 'POST', body: { approve: true } });
  const d = (await srv.api('/dashboard')).data;
  assert.ok(!d.pending.some((x) => x.id === t.data.id));
  assert.ok(!('scripts' in d.tiles.find((x) => x.id === t.data.id)));
  await srv.api(`/dashboard/tiles/${t.data.id}`, { method: 'DELETE' });
});

test('a picture, a script control, and the six kinds keep their look', async () => {
  const bot = await makeBot(srv, { name: 'Door Keeper' });
  await srv.api('/vault', { method: 'POST', body: { name: 'Home Assistant', site: '127.0.0.1', username: '', password: 'ha-secret-token', allowedBots: [bot.id] } });
  const cam = await srv.asChief('/dashboard/tiles', { method: 'POST', body: {
    kind: 'custom', title: 'Door', bot: bot.id, size: 'big',
    reads: { cam: { type: 'http', login: 'Home Assistant', url: haUrl('/api/camera_proxy/camera.door'), headers: auth, image: true } },
    face: [{ type: 'image', read: 'cam' }],
  } });
  assert.equal(cam.status, 201, JSON.stringify(cam.data));
  const src = cam.data.look.face[0].src;
  await srv.api('/dashboard/refresh', { method: 'POST' });
  const pic = await srv.api(src);
  assert.equal(pic.status, 200);
  assert.deepEqual(pic.data, PNG, 'the picture, fetched with its saved login');
  assert.match((await srv.asChief('/dashboard/tiles', { method: 'POST', body: { kind: 'custom', title: 'Bad', bot: bot.id, read: { ...lightTile(bot).read, image: true } } })).data.error, /named read/);

  // A script control waits for the OK, then gets what was picked as $VALUE.
  const fan = await srv.asChief('/dashboard/tiles', { method: 'POST', body: {
    kind: 'custom', title: 'Fan', bot: bot.id,
    actions: { speed: { type: 'script', script: '[ "$VALUE" = high ]' } },
    face: [{ type: 'choice', options: ['low', 'high'], action: 'speed' }],
  } });
  assert.equal(fan.data.approved, false, 'a script: it waits');
  assert.equal((await srv.api(`/dashboard/tiles/${fan.data.id}/act`, { method: 'POST', body: { block: 'f0', value: 'high' } })).status, 400);
  await srv.api(`/dashboard/tiles/${fan.data.id}/approve`, { method: 'POST', body: { approve: true } });
  const done = await srv.api(`/dashboard/tiles/${fan.data.id}/act`, { method: 'POST', body: { block: 'f0', value: 'high' } });
  assert.equal(done.status, 200, JSON.stringify(done.data));

  // Old tiles: their kind's look, now as blocks.
  const temp = await srv.asChief('/dashboard/tiles', { method: 'POST', body: { kind: 'value', title: 'Temp', unit: '°C', value: '21.5', wide: true } });
  assert.deepEqual(temp.data.look.face, [{ type: 'value', text: '21.5', unit: '°C' }]);
  assert.equal(temp.data.size, 'wide');
  assert.equal(temp.data.look.short, '21.5 °C');
  const note = await srv.asChief('/dashboard/tiles', { method: 'POST', body: { kind: 'note', title: 'Brief', value: 'Rain at 3' } });
  assert.equal(note.data.look.tap, 'panel');
  assert.deepEqual(note.data.look.panel.map((b) => b.type), ['text', 'chat']);
  // A bot gives a block tile an object.
  const brief = await srv.asChief('/dashboard/tiles', { method: 'POST', body: { kind: 'custom', title: 'Weather', face: [{ type: 'text', text: '{{value.summary}}' }, { type: 'chart', bind: 'value.rain' }], value: { summary: 'Showers', rain: [0, 2, 5] } } });
  assert.equal(brief.data.look.face[0].text, 'Showers');
  assert.deepEqual(brief.data.look.face[1].points, [0, 2, 5]);
  for (const t of [cam, fan, temp, note, brief]) await srv.api(`/dashboard/tiles/${t.data.id}`, { method: 'DELETE' });
});
