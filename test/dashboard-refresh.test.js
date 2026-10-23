const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { startServer, makeBot } = require('./helpers');

test('dashboard GETs only read cached values and pictures; refresh requires an owner POST', async (t) => {
  let calls = 0;
  const remote = http.createServer((req, res) => {
    calls++;
    res.writeHead(200, { 'Content-Type': req.url === '/picture' ? 'image/png' : 'application/json' });
    res.end(req.url === '/picture' ? Buffer.from('fixture picture') : '42');
  });
  await new Promise((r) => remote.listen(0, '127.0.0.1', r));
  t.after(() => remote.close());
  const srv = await startServer();
  t.after(() => srv.stop());
  const bot = await makeBot(srv);
  await srv.api('/vault', { method: 'POST', body: { name: 'Local', site: '127.0.0.1', password: 'fixture', allowedBots: [bot.id] } });
  const source = { type: 'http', login: 'Local', url: `http://127.0.0.1:${remote.address().port}/value` };
  const tile = (await srv.api('/dashboard/tiles', { method: 'POST', body: { bot: bot.id, kind: 'value', title: 'Read', read: source, reads: { camera: { ...source, url: source.url.replace('/value', '/picture'), image: true } } } })).data;
  const marker = path.join(srv.dir, 'ran-script');
  await srv.api('/dashboard/tiles', { method: 'POST', body: { bot: bot.id, kind: 'value', title: 'Script', read: { type: 'script', script: `touch '${marker}'; echo 1` } } });
  const image = `/dashboard/tiles/${tile.id}/image/camera`;
  for (const suffix of ['', '?quiet']) {
    const r = await fetch(`${srv.base}/api/dashboard${suffix}`, { headers: { Origin: 'https://foreign.example' } });
    assert.equal(r.status, 200);
  }
  assert.equal((await srv.api(image)).status, 404);
  assert.equal(calls, 0);
  assert.equal(fs.existsSync(marker), false);
  assert.equal((await fetch(`${srv.base}/api/dashboard/refresh`, { method: 'POST' })).status, 403);
  assert.equal((await srv.asChief('/dashboard/refresh', { method: 'POST' })).status, 403);
  const refresh = await srv.api('/dashboard/refresh', { method: 'POST' });
  assert.equal(refresh.status, 200);
  assert.equal(refresh.data.tiles.find((x) => x.id === tile.id).value.text, '42');
  assert.equal(calls, 2);
  assert.equal(fs.existsSync(marker), true);
  assert.equal((await srv.api(image)).status, 200);
  await srv.api('/dashboard');
  assert.equal(calls, 2);
});

test('the refresh button (all) reads every tile now over HTTP; a body without it is the plain refresh (#452)', async (t) => {
  let calls = 0;
  const remote = http.createServer((req, res) => { calls++; res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(String(calls)); });
  await new Promise((r) => remote.listen(0, '127.0.0.1', r));
  t.after(() => remote.close());
  const srv = await startServer();
  t.after(() => srv.stop());
  const bot = await makeBot(srv);
  await srv.api('/vault', { method: 'POST', body: { name: 'Local', site: '127.0.0.1', password: 'fixture', allowedBots: [bot.id] } });
  const read = { type: 'http', login: 'Local', url: `http://127.0.0.1:${remote.address().port}/value` };
  await srv.api('/dashboard/tiles', { method: 'POST', body: { bot: bot.id, kind: 'value', title: 'Hourly', every: 3600, read } });
  await srv.api('/dashboard/refresh', { method: 'POST' });
  const first = calls;
  assert.equal(first, 1);
  await srv.api('/dashboard/refresh', { method: 'POST', body: { all: false } });
  assert.equal(calls, first, 'not stale: a plain refresh leaves it');
  const r = await srv.api('/dashboard/refresh', { method: 'POST', body: { all: true } });
  assert.equal(r.status, 200);
  assert.equal(calls, first, 'read seconds ago: the button leaves it too');
  assert.equal((await srv.asChief('/dashboard/refresh', { method: 'POST', body: { all: true } })).status, 403, 'only the owner reads the tiles');
});
