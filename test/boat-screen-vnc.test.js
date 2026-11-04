// botdot's own viewer of a boat.dev machine's screen (ADR 149), for a browser that can't show boat.dev's stream
// (Safari, the Mac app): the page asks for it with { via: "vnc" }, gets botdot's noVNC at /computer/<bot>/, and
// botdot passes its WebSocket on to the address boat.dev carries the machine's websockify on, with a token only
// botdot holds. No boat.dev here: lib/boat.js's side is in boat-screen.test.js.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { startServer, restartServer, makeBot } = require('./helpers');
const boatStream = require('../lib/boat-stream');

let srv;
let bot;
before(async () => {
  srv = await startServer();
  bot = await makeBot(srv, { name: 'Coder', computer: 'linux' });
  const file = path.join(srv.data, 'bots.json');
  srv = await restartServer(srv, () => fs.writeFileSync(file, JSON.stringify(JSON.parse(fs.readFileSync(file, 'utf8')).map((b) => (b.id === bot.id ? { ...b, computer: 'boat' } : b)))));
});
after(() => srv.stop());

test('the server says it has the viewer, and a server without boat.dev says so for it too', async () => {
  const v = await srv.api('/version');
  assert.ok(v.data.features.includes('boat-desktop-vnc'));
  const asked = await srv.api(`/bots/${bot.id}/computer/desktop`, { method: 'POST', body: { via: 'vnc' } });
  assert.equal(asked.status, 409);
  assert.match(asked.data.error, /External Virtual PC is not set up/);
  const chief = await srv.asChief(`/bots/${bot.id}/computer/desktop`, { method: 'POST', body: { via: 'vnc' } });
  assert.equal(chief.status, 403);
});

test("a boat bot's viewer is off until its screen is up there, and its WebSocket goes nowhere before", async () => {
  const page = await fetch(`${srv.base}/computer/${bot.id}/vnc.html`);
  assert.equal(page.status, 503);
  assert.match(await page.text(), /turned off/);
  const u = new URL(srv.base);
  const closed = await new Promise((resolve) => {
    const s = net.connect(Number(u.port), u.hostname, () => {
      s.write(`GET /computer/${bot.id}/websockify HTTP/1.1\r\nHost: ${u.host}\r\nOrigin: ${srv.base}\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n\r\n`);
    });
    let got = '';
    s.on('data', (d) => { got += d; });
    s.on('close', () => resolve(got));
    s.on('error', () => resolve(got));
  });
  assert.doesNotMatch(closed, /101/, 'no screen to pass it on to');
});

test("the viewer's WebSocket goes on with the token as boat.dev's cookie, and nothing of the owner's", () => {
  const sent = [];
  let opened = null;
  const connect = (opts) => { opened = opts; const s = new PassThrough(); s.write = (d) => { sent.push(String(d)); return true; }; return s; };
  const req = { headers: { host: 'hq.example', cookie: 'botdot_session=secret', origin: 'https://hq.example', 'sec-websocket-key': 'abc==', 'sec-websocket-version': '13', 'sec-websocket-protocol': 'binary', 'x-evil': 'a\r\nb' } };
  boatStream.open({ host: 'swift-otter-9021-47110.on.boat.dev', token: 'tok' }, req, Buffer.from('early'), { connect });
  assert.deepEqual(opened, { host: 'swift-otter-9021-47110.on.boat.dev', port: 443, servername: 'swift-otter-9021-47110.on.boat.dev' });
  const [ask, early] = sent;
  assert.match(ask, /^GET \/websockify HTTP\/1\.1\r\nHost: swift-otter-9021-47110\.on\.boat\.dev\r\n/);
  assert.match(ask, /\r\nCookie: _port_auth=tok\r\n/);
  assert.match(ask, /\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n/);
  assert.match(ask, /\r\nsec-websocket-key: abc==\r\n/);
  assert.match(ask, /\r\nsec-websocket-protocol: binary\r\n/);
  assert.doesNotMatch(ask, /botdot_session|hq\.example|x-evil/, "never the owner's cookies or botdot's address");
  assert.ok(ask.endsWith('\r\n\r\n'));
  assert.equal(early, 'early', 'what the viewer sent after its own upgrade goes after it');
});
